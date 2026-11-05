import type { Locator, Page } from "playwright-core";
import { leerEstado } from "./groupJoin";

/**
 * Publicar en un grupo de Facebook: texto y, opcionalmente, una imagen.
 *
 * El camino es el de una persona: en el muro del grupo se toca "Escribe
 * algo…", se abre el diálogo "Crear publicación", se escribe, se adjunta la
 * foto y se pulsa "Publicar". Todo se busca por rótulo en español e inglés —el
 * perfil de AdsPower hereda el idioma de su huella— y siempre dentro del
 * diálogo que se abrió, porque Facebook deja otros [role="dialog"] ocultos en
 * el DOM.
 *
 * La confirmación de que quedó publicada no se hace acá: el runner escucha la
 * respuesta del servidor (ver vigilarEnvioComentario) desde `antesDePublicar`.
 * Esto solo garantiza que el diálogo se envió y se cerró sin error.
 */

type Logger = (level: "info" | "warn" | "error", message: string) => Promise<unknown>;

export type ImagenParaPublicar = { name: string; mimeType: string; buffer: Buffer };

export type PublicacionEnGrupo = {
  /** Si el grupo la retuvo para que la aprueben los admins. */
  pendienteDeAprobacion: boolean;
};

// Normalizados: minúsculas, sin acentos, sin "…" ni puntos finales.
const COMPOSER_LABELS = [
  "escribe algo",
  "write something",
  "crea una publicacion",
  "crear publicacion",
  "create a public post",
  "create post",
  "que estas pensando",
  "whats on your mind",
  "what's on your mind",
  "comparte algo",
];
const PHOTO_LABELS = ["foto/video", "photo/video", "fotos/videos", "photos/videos", "foto", "photo"];
const POST_LABELS = ["publicar", "post", "publish"];
const PENDING_TEXTS = [
  "pendiente de aprobacion",
  "esta pendiente",
  "estan pendientes",
  "pending approval",
  "is pending",
  "awaiting approval",
  "submitted for approval",
  "enviada para aprobacion",
];

const DIALOG_MARK = "data-lotificadora-post-dialog";
const COMPOSER_MARK = "data-lotificadora-post-composer";

const ABRIR_TIMEOUT_MS = 15000;
const IMAGEN_TIMEOUT_MS = 45000;
const PUBLICAR_HABILITADO_MS = 60000;
const CERRAR_TIMEOUT_MS = 45000;

async function definirNameHelper(page: Page) {
  await page.evaluate("void (globalThis.__name = globalThis.__name || ((fn) => fn))");
}

function normalizar(valor: string) {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[….]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function palabras(valor: string) {
  return valor
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Marca el disparador del composer en el muro del grupo. */
async function marcarComposer(page: Page): Promise<boolean> {
  await definirNameHelper(page);
  return page
    .evaluate(
      ({ labels, mark }) => {
        const norm = (v: string) =>
          v
            .normalize("NFD")
            .replace(/[̀-ͯ]/g, "")
            .replace(/[….]+$/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
        document.querySelectorAll(`[${mark}]`).forEach((el) => el.removeAttribute(mark));
        const main = document.querySelector('[role="main"]') ?? document.body;
        for (const el of Array.from(main.querySelectorAll<HTMLElement>('[role="button"], [role="textbox"], span'))) {
          if (el.closest('[role="dialog"]')) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 40 || r.height < 10) continue;
          const texto = norm(el.getAttribute("aria-label") || el.innerText || "");
          if (!texto || texto.length > 60) continue;
          if (!labels.some((l) => texto.startsWith(l))) continue;
          const objetivo = (el.closest('[role="button"]') as HTMLElement | null) ?? el;
          objetivo.setAttribute(mark, "1");
          return true;
        }
        return false;
      },
      { labels: COMPOSER_LABELS, mark: COMPOSER_MARK },
    )
    .catch(() => false);
}

/** Marca el diálogo de "Crear publicación": el visible que tiene un editor. */
async function marcarDialogo(page: Page): Promise<boolean> {
  await definirNameHelper(page);
  return page
    .evaluate((mark) => {
      document.querySelectorAll(`[${mark}]`).forEach((el) => el.removeAttribute(mark));
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).filter((d) => {
        const r = d.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && d.querySelector('[contenteditable="true"][role="textbox"], [contenteditable="true"]');
      });
      const d = dialogs[dialogs.length - 1];
      if (!d) return false;
      d.setAttribute(mark, "1");
      return true;
    }, DIALOG_MARK)
    .catch(() => false);
}

const DIALOGO = `[${DIALOG_MARK}]`;

async function esperar(cond: () => Promise<boolean>, ms: number, pausa = 500) {
  const hasta = Date.now() + ms;
  for (;;) {
    if (await cond()) return true;
    if (Date.now() >= hasta) return false;
    await new Promise((r) => setTimeout(r, pausa));
  }
}

/** Los botones del diálogo con alguno de los rótulos; el primero visible y habilitado. */
async function botonDelDialogo(page: Page, labels: string[], soloHabilitado: boolean): Promise<Locator | null> {
  const botones = page.locator(`${DIALOGO} [role="button"], ${DIALOGO} button`);
  const total = await botones.count().catch(() => 0);
  for (let i = 0; i < total; i++) {
    const b = botones.nth(i);
    if (!(await b.isVisible().catch(() => false))) continue;
    const label = normalizar(
      (await b.getAttribute("aria-label").catch(() => null)) || (await b.innerText().catch(() => "")),
    );
    if (!labels.includes(label)) continue;
    if (soloHabilitado) {
      const deshabilitado =
        (await b.getAttribute("aria-disabled").catch(() => null)) === "true" ||
        (await b.isDisabled().catch(() => false));
      if (deshabilitado) continue;
    }
    return b;
  }
  return null;
}

async function textoDelDialogo(page: Page) {
  return normalizar(await page.locator(DIALOGO).first().innerText({ timeout: 2000 }).catch(() => ""));
}

async function contarPrevistas(page: Page) {
  return page
    .locator(`${DIALOGO} img[src^="blob:"], ${DIALOGO} img[src^="data:"], ${DIALOGO} video`)
    .count()
    .catch(() => 0);
}

async function adjuntarImagen(page: Page, imagen: ImagenParaPublicar, log: Logger) {
  const archivo = { name: imagen.name, mimeType: imagen.mimeType, buffer: imagen.buffer };
  const antes = await contarPrevistas(page);

  // 1) Un input de archivo ya montado en el diálogo.
  const enDialogo = page.locator(`${DIALOGO} input[type="file"]`);
  let adjuntada = false;
  if (await enDialogo.count().catch(() => 0)) {
    adjuntada = await enDialogo
      .first()
      .setInputFiles(archivo)
      .then(() => true)
      .catch(() => false);
  }

  // 2) El botón "Foto/video": abre el selector de archivos del sistema, o
  // monta el input recién después del clic.
  if (!adjuntada) {
    const boton = await botonDelDialogo(page, PHOTO_LABELS, true);
    if (!boton) {
      throw new Error(
        'No apareció el botón "Foto/video" en el diálogo de publicar. Puede que el grupo no permita fotos.',
      );
    }
    const selector = page.waitForEvent("filechooser", { timeout: 6000 }).catch(() => null);
    await boton.click({ timeout: 5000 });
    const chooser = await selector;
    if (chooser) {
      await chooser.setFiles(archivo);
      adjuntada = true;
    } else if (await enDialogo.count().catch(() => 0)) {
      adjuntada = await enDialogo
        .first()
        .setInputFiles(archivo)
        .then(() => true)
        .catch(() => false);
    }
  }
  if (!adjuntada) throw new Error("No se encontró dónde adjuntar la imagen en el diálogo de publicar.");

  const vista = await esperar(async () => (await contarPrevistas(page)) > antes, IMAGEN_TIMEOUT_MS);
  if (!vista) {
    // Publicar sin la foto sería cumplir a medias en silencio: se corta.
    throw new Error("La imagen no apareció en la publicación después de adjuntarla; no se publica sin ella.");
  }
  await log("info", `Imagen adjuntada: ${imagen.name}.`);
}

export async function publicarEnGrupo(
  page: Page,
  opts: {
    texto: string;
    imagen?: ImagenParaPublicar | null;
    log: Logger;
    assertNoBlocker: () => Promise<void>;
    /** Se llama justo antes de pulsar "Publicar"; ahí el runner empieza a escuchar la red. */
    antesDePublicar?: () => void;
  },
): Promise<PublicacionEnGrupo> {
  const { texto, imagen, log, assertNoBlocker } = opts;
  await assertNoBlocker();

  let estado = await leerEstado(page).catch(() => "unknown" as const);
  if (estado === "unknown") {
    await page.waitForTimeout(3000);
    estado = await leerEstado(page).catch(() => "unknown" as const);
  }
  if (estado === "join") {
    throw new Error('El perfil no es miembro de este grupo. Primero hay que unirlo desde "Unirse a grupos".');
  }
  if (estado === "pending") {
    throw new Error("El perfil todavía tiene la solicitud de ingreso pendiente; no puede publicar hasta que lo acepten.");
  }

  // Abrir el composer.
  const hayComposer = await esperar(() => marcarComposer(page), ABRIR_TIMEOUT_MS, 700);
  if (!hayComposer) {
    throw new Error(
      'No apareció el cuadro "Escribe algo…" del grupo. Puede que el grupo no deje publicar a los miembros.',
    );
  }
  await page.locator(`[${COMPOSER_MARK}]`).first().click({ timeout: 8000 });
  await log("info", 'Se abrió "Escribe algo…" del grupo.');

  if (!(await esperar(() => marcarDialogo(page), ABRIR_TIMEOUT_MS))) {
    throw new Error('Se tocó "Escribe algo…" pero no se abrió el diálogo para crear la publicación.');
  }

  // Escribir. Mismo criterio que con los comentarios: insertText de una vez
  // (el editor se re-renderiza y se come teclas sueltas) y releer antes de
  // seguir, porque publicar un texto mutilado no se deshace.
  const editor = page.locator(`${DIALOGO} [contenteditable="true"]`).first();
  const esperado = palabras(texto);
  for (let intento = 1; ; intento++) {
    await editor.click({ timeout: 5000 }).catch(() => {});
    await editor.focus({ timeout: 5000 }).catch(() => {});
    await page.keyboard.insertText(texto);
    await page.waitForTimeout(800);
    const escrito = palabras(await editor.innerText().catch(() => ""));
    if (escrito.includes(esperado)) break;
    if (intento === 2) {
      throw new Error(`El texto quedó incompleto en la publicación ("${escrito.slice(0, 120)}"); no se publica.`);
    }
    await log("warn", "El texto quedó incompleto; se limpia y se vuelve a escribir.");
    await page.keyboard.press("ControlOrMeta+A").catch(() => {});
    await page.keyboard.press("Delete").catch(() => {});
    await page.waitForTimeout(400);
  }

  if (imagen) await adjuntarImagen(page, imagen, log);

  // "Publicar" se habilita cuando terminó de subir la imagen.
  let publicar: Locator | null = null;
  await esperar(async () => {
    publicar = await botonDelDialogo(page, POST_LABELS, true);
    return Boolean(publicar);
  }, PUBLICAR_HABILITADO_MS);
  if (!publicar) {
    throw new Error('El botón "Publicar" no se habilitó. ' + (imagen ? "Puede que la imagen no haya terminado de subir." : ""));
  }

  await assertNoBlocker();
  opts.antesDePublicar?.();
  await (publicar as Locator).click({ timeout: 8000 });
  await log("info", 'Clic en "Publicar".');

  // Se da por enviada cuando el diálogo se cierra. Si se queda abierto, lo que
  // diga es el motivo.
  const cerrado = await esperar(
    async () => !(await page.locator(DIALOGO).first().isVisible().catch(() => false)),
    CERRAR_TIMEOUT_MS,
  );
  if (!cerrado) {
    const motivo = (await textoDelDialogo(page)).slice(0, 300);
    throw new Error(`La publicación no se envió: el diálogo siguió abierto. Facebook mostraba: "${motivo}"`);
  }

  await page.waitForTimeout(2500);
  const cuerpo = normalizar(await page.locator("body").innerText({ timeout: 3000 }).catch(() => ""));
  const pendienteDeAprobacion = PENDING_TEXTS.some((t) => cuerpo.includes(t));
  return { pendienteDeAprobacion };
}
