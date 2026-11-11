import Anthropic from "@anthropic-ai/sdk";
import type { Page } from "playwright-core";

/**
 * Unirse a un grupo de Facebook, con o sin formulario de ingreso.
 *
 * El botón es lo fácil. Lo que rompe una automatización de pasos fijos es lo
 * que viene después: muchos grupos abren un diálogo con preguntas propias
 * ("¿de qué municipio eres?", "¿aceptas las reglas?", casillas, opciones), y
 * cada grupo pregunta otra cosa. Por eso esto no es una lista de steps sino un
 * solo step que lee el formulario que haya y le pide a Claude las respuestas.
 *
 * Termina bien solo si Facebook deja constancia: el botón pasa a "Solicitud
 * enviada"/"Cancelar solicitud" (grupo con aprobación) o a "Unido" (grupo
 * abierto). Enviar el formulario no alcanza — igual que con los comentarios,
 * el fallo caro es la tarea en verde que no hizo nada.
 */

export type Persona = { name: string; age?: number | null; gender?: string | null };

export type JoinGroupResult = "joined" | "pending" | "already_member" | "already_pending";

type Logger = (level: "info" | "warn" | "error", message: string) => Promise<unknown>;

const MODEL = "claude-opus-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

// El perfil de AdsPower hereda el idioma de su huella: la misma cuenta aparece
// en español o en inglés según el perfil. Se comparan ya normalizados (sin
// acentos, minúsculas) — ver normalizar().
const JOIN_LABELS = ["unirte al grupo", "unirse al grupo", "unirme al grupo", "join group"];
const PENDING_LABELS = [
  "cancelar solicitud",
  "solicitud enviada",
  "solicitud pendiente",
  "cancel request",
  "request sent",
  "pending",
];
const MEMBER_LABELS = ["unido", "unida", "unido(a)", "joined", "miembro", "member"];

// Botones que avanzan un diálogo, por orden de preferencia. "Cancelar" y
// "Cerrar" no están a propósito: cerrar el formulario es abandonar la solicitud.
const ADVANCE_LABELS = [
  "enviar",
  "enviar respuestas",
  "submit",
  "unirte al grupo",
  "unirse al grupo",
  "join group",
  "aceptar",
  "acepto",
  "agree",
  "i agree",
  "continuar",
  "continue",
  "siguiente",
  "next",
  "listo",
  "done",
  "entendido",
  "ok",
];

const DIALOG_ROUNDS = 4;
const STATE_TIMEOUT_MS = 15000;

export type JoinState = "join" | "pending" | "member" | "unknown";

type FormControl = {
  id: string;
  kind: "text" | "radio" | "checkbox";
  /** Solo para radio: las opciones del mismo grupo comparten `group`. */
  group?: string;
  label: string;
  /** El texto alrededor del control: de ahí sale la pregunta. */
  context: string;
  checked?: boolean;
  /** Solo para text: lo que ya tiene escrito. */
  value?: string;
};

type DialogProbe = {
  found: boolean;
  title: string;
  text: string;
  controls: FormControl[];
  buttons: string[];
};

type Answers = {
  texts: { id: string; value: string }[];
  select: string[];
};

const MARK = "data-adsfroy-q";
const BUTTON_MARK = "data-adsfroy-join";

/**
 * El helper `__name` que esbuild (vía `tsx`, en el worker) mete en cada
 * función con nombre y que no viaja con el `evaluate` al navegador. Mismo
 * arreglo que defineEsbuildNameHelper en runner.ts, que tiene la explicación
 * completa; se repite acá para no importar del runner, que importa de acá.
 */
async function definirNameHelper(page: Page) {
  await page.evaluate("void (globalThis.__name = globalThis.__name || ((fn) => fn))");
}

function normalizar(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * El nombre del grupo tal como lo muestra el encabezado. Facebook no lo da sin
 * sesión (ni a los crawlers de previews), así que la única forma de tenerlo es
 * leerlo acá, con el perfil logueado y parado en el grupo.
 *
 * Va primero el h1 del área principal y, si no está, el <title> —que trae
 * "(3) Nombre | Facebook" y hay que limpiarlo—. Vacío si no se pudo leer.
 */
export async function leerNombreGrupo(page: Page): Promise<string> {
  await definirNameHelper(page);
  const nombre = await page
    .evaluate(() => {
      const h1 = document.querySelector('[role="main"] h1') as HTMLElement | null;
      const deH1 = h1?.innerText?.trim() ?? "";
      if (deH1) return deH1;
      return document.title
        .replace(/^\(\d+\+?\)\s*/, "")
        .replace(/\s*[|·-]\s*Facebook\s*$/i, "")
        .trim();
    })
    .catch(() => "");
  return /^(facebook|error)$/i.test(nombre) ? "" : nombre.slice(0, 200);
}

/**
 * En qué estado ve la página al perfil respecto del grupo, y marca el botón de
 * unirse si lo hay. Se toma el primero en orden de documento: el del encabezado
 * del grupo va antes que los "Unirte" de los grupos sugeridos de la columna.
 */
export async function leerEstado(page: Page): Promise<JoinState> {
  await definirNameHelper(page);
  return page.evaluate(
    ({ join, pending, member, mark }) => {
      const norm = (v: string) =>
        v.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
      document.querySelectorAll(`[${mark}]`).forEach((el) => el.removeAttribute(mark));

      const main = document.querySelector('[role="main"]') ?? document.body;
      const botones = Array.from(main.querySelectorAll<HTMLElement>('[role="button"], button, a[role="link"]'));
      for (const b of botones) {
        const r = b.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (b.closest('[role="dialog"]')) continue;
        const etiquetas = [b.getAttribute("aria-label") ?? "", b.innerText ?? ""].map(norm).filter(Boolean);
        if (etiquetas.some((e) => pending.includes(e))) return "pending" as const;
        if (etiquetas.some((e) => member.includes(e))) return "member" as const;
        if (etiquetas.some((e) => join.includes(e))) {
          b.setAttribute(mark, "join");
          return "join" as const;
        }
      }
      return "unknown" as const;
    },
    { join: JOIN_LABELS, pending: PENDING_LABELS, member: MEMBER_LABELS, mark: BUTTON_MARK },
  );
}

/**
 * Lee el diálogo que esté abierto encima: título, texto y cada control de
 * formulario, marcado con un id para poder llenarlo después sin volver a
 * buscarlo. Facebook no pone <label for> ni nombres estables, así que la
 * pregunta de cada campo se reconstruye con el texto de sus contenedores.
 */
async function leerDialogo(page: Page): Promise<DialogProbe> {
  await definirNameHelper(page);
  return page.evaluate(
    ({ mark }) => {
      const norm = (v: string) => v.replace(/\s+/g, " ").trim();
      const visible = (el: Element) => {
        const target = (el.closest("label") as Element | null) ?? el;
        const r = target.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };

      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).filter(visible);
      const dialog = dialogs[dialogs.length - 1];
      if (!dialog) return { found: false, title: "", text: "", controls: [], buttons: [] };

      document.querySelectorAll(`[${mark}]`).forEach((el) => el.removeAttribute(mark));

      // El texto del contenedor más cercano que diga algo más que el propio
      // control: ahí suele estar la pregunta. Se corta a 400 caracteres para
      // no mandarle al modelo el diálogo entero repetido por cada campo.
      const contexto = (el: Element) => {
        let node: Element | null = el.parentElement;
        let depth = 0;
        while (node && node !== dialog && depth < 8) {
          const t = norm((node as HTMLElement).innerText ?? "");
          if (t.length > 12) return t.slice(0, 400);
          node = node.parentElement;
          depth++;
        }
        return "";
      };
      const etiqueta = (el: Element) =>
        norm(
          el.getAttribute("aria-label") ??
            (el.closest("label") as HTMLElement | null)?.innerText ??
            el.getAttribute("placeholder") ??
            (el.parentElement as HTMLElement | null)?.innerText ??
            "",
        ).slice(0, 200);

      // El texto de la opción misma ("Sí", "No", "Acepto las reglas"): el
      // ancestro más cercano con texto que no envuelva a otro control. Antes
      // se tomaba el innerText del padre, que en Facebook es el bloque de
      // opciones entero ("Puedes elegir una sola opción Sí No") y dejaba al
      // Sí y al No con la misma etiqueta: Claude no podía distinguirlos.
      const SELECTOR_OPCION = 'input[type="radio"], [role="radio"], input[type="checkbox"], [role="checkbox"], [role="switch"]';
      // Cuántas opciones distintas hay dentro de `node`. Un <input> envuelto
      // en un [role="radio"] es una sola opción, no dos.
      const opcionesEn = (node: Element) =>
        Array.from(node.querySelectorAll(SELECTOR_OPCION)).filter((x) => {
          const envoltorio = x.parentElement?.closest(SELECTOR_OPCION);
          return !envoltorio || !node.contains(envoltorio);
        }).length;
      const textoDeOpcion = (el: Element) => {
        const aria = el.getAttribute("aria-label");
        if (aria) return norm(aria);
        const porId = el.getAttribute("aria-labelledby");
        if (porId) {
          const t = norm(
            porId
              .split(/\s+/)
              .map((id) => document.getElementById(id)?.innerText ?? "")
              .join(" "),
          );
          if (t) return t;
        }
        let node: Element | null = el;
        while (node && node !== dialog) {
          if (node !== el && opcionesEn(node) > 1) break;
          const t = norm((node as HTMLElement).innerText ?? "");
          if (t) return t.slice(0, 200);
          node = node.parentElement;
        }
        return "";
      };

      const controls: {
        id: string;
        kind: "text" | "radio" | "checkbox";
        group?: string;
        label: string;
        context: string;
        checked?: boolean;
        value?: string;
      }[] = [];
      let n = 0;

      const textos = dialog.querySelectorAll(
        'textarea, input[type="text"], input:not([type]), [contenteditable="true"], [role="textbox"]',
      );
      for (const el of Array.from(textos)) {
        if (!visible(el)) continue;
        // Un contenteditable anidado en otro ya contado es el mismo campo.
        if (el.parentElement?.closest('[contenteditable="true"]')) continue;
        const id = `q${n++}`;
        el.setAttribute(mark, id);
        const value = norm(
          (el as HTMLInputElement).value ?? (el as HTMLElement).innerText ?? "",
        );
        controls.push({ id, kind: "text", label: etiqueta(el), context: contexto(el), value });
      }

      const grupos = new Map<Element | string, string>();
      const radios = dialog.querySelectorAll('input[type="radio"], [role="radio"]');
      for (const el of Array.from(radios)) {
        if (!visible(el)) continue;
        const clave: Element | string =
          el.closest('[role="radiogroup"]') || (el as HTMLInputElement).name || el.parentElement?.parentElement || "";
        if (!grupos.has(clave)) grupos.set(clave, `g${grupos.size}`);
        const id = `q${n++}`;
        el.setAttribute(mark, id);
        const group = el.closest('[role="radiogroup"]');
        controls.push({
          id,
          kind: "radio",
          group: grupos.get(clave),
          label: textoDeOpcion(el),
          context: group ? contexto(group) : contexto(el),
          checked: (el as HTMLInputElement).checked || el.getAttribute("aria-checked") === "true",
        });
      }

      const casillas = dialog.querySelectorAll('input[type="checkbox"], [role="checkbox"], [role="switch"]');
      for (const el of Array.from(casillas)) {
        if (!visible(el)) continue;
        const id = `q${n++}`;
        el.setAttribute(mark, id);
        controls.push({
          id,
          kind: "checkbox",
          label: textoDeOpcion(el),
          context: contexto(el),
          checked: (el as HTMLInputElement).checked || el.getAttribute("aria-checked") === "true",
        });
      }

      // La pregunta de cada control: el bloque más grande que lo contiene
      // sin contener controles de otra pregunta. El contenedor inmediato de
      // un radio de Facebook solo dice "Puedes elegir una sola opción Sí No";
      // la pregunta está un nivel más arriba, como hermana de las opciones.
      const grupoDe = new Map(controls.map((c) => [c.id, c.group ?? c.id]));
      for (const c of controls) {
        const el = dialog.querySelector(`[${mark}="${c.id}"]`);
        if (!el) continue;
        const propio = c.group ?? c.id;
        let mejor = "";
        let node: Element | null = el.parentElement;
        while (node && node !== dialog) {
          const ajeno = Array.from(node.querySelectorAll(`[${mark}]`)).some(
            (o) => grupoDe.get(o.getAttribute(mark) ?? "") !== propio,
          );
          if (ajeno) break;
          const t = norm((node as HTMLElement).innerText ?? "");
          if (t) mejor = t;
          node = node.parentElement;
        }
        if (mejor.length > c.context.length) c.context = mejor.slice(0, 500);
      }

      const buttons = Array.from(dialog.querySelectorAll<HTMLElement>('[role="button"], button'))
        .filter(visible)
        .map((b) => norm(b.getAttribute("aria-label") || b.innerText || ""))
        .filter(Boolean);

      const heading = dialog.querySelector('h1, h2, h3, [role="heading"]') as HTMLElement | null;
      return {
        found: true,
        title: norm(dialog.getAttribute("aria-label") || heading?.innerText || ""),
        text: norm(dialog.innerText ?? "").slice(0, 6000),
        controls,
        buttons,
      };
    },
    { mark: MARK },
  );
}

const ANSWERS_SCHEMA = {
  type: "object",
  properties: {
    texts: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, value: { type: "string" } },
        required: ["id", "value"],
        additionalProperties: false,
      },
    },
    select: { type: "array", items: { type: "string" } },
  },
  required: ["texts", "select"],
  additionalProperties: false,
};

const SYSTEM = `Llenas el formulario de ingreso a un grupo de Facebook en nombre de la persona dueña de la cuenta.

Recibes el texto del diálogo y la lista de controles, cada uno con un id. En radios y casillas, "label" es el texto de esa opción ("Sí", "No", "Acepto las reglas") y "context" el bloque de la pregunta a la que pertenece. Devuelve:
- "texts": una respuesta por cada campo de texto (kind "text"), con su id.
- "select": los ids de las opciones a marcar. En cada grupo de radios (mismo "group") elige exactamente una. En casillas marca las que correspondan, y siempre la de aceptar las reglas del grupo si existe.

Cómo responder:
- Como lo escribiría esa persona: primera persona, natural, breve (una o dos frases), en el idioma de la pregunta. Sin sonar a plantilla ni a vendedor.
- Usa el contexto que te den (de dónde es, por qué le interesa el grupo). Si una pregunta pide algo que el contexto no dice, contesta algo verosímil y genérico que sea coherente con la persona y con el tema del grupo.
- Nunca inventes correos, teléfonos, números de identificación ni enlaces. Si un campo pide eso, deja su value vacío.
- Si el grupo pide aceptar reglas, acéptalas. A las preguntas de sí/no sobre estar de acuerdo con el grupo, respetar a los demás o no publicar insultos, spam o información falsa, responde que sí.`;

function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "El grupo pide contestar preguntas y falta ANTHROPIC_API_KEY en .env.local del worker, así que no hay quién las responda.",
    );
  }
  return new Anthropic();
}

async function responderConClaude(dialogo: DialogProbe, persona: Persona, contexto: string): Promise<Answers> {
  const anthropic = client();
  const quien = [
    `Nombre: ${persona.name}`,
    persona.age ? `Edad: ${persona.age}` : null,
    persona.gender ? `Género: ${persona.gender}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await anthropic.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    system: SYSTEM,
    // Contestar cuatro preguntas cortas no es trabajo de razonamiento largo:
    // con effort bajo responde en segundos, que es lo que importa con el
    // navegador abierto esperando.
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: ANSWERS_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: `La persona:
${quien}

Contexto que dio el operador para responder:
${contexto.trim() || "(ninguno)"}

Título del diálogo: ${dialogo.title}

Texto completo del diálogo:
${dialogo.text}

Controles:
${JSON.stringify(dialogo.controls.map(({ checked, ...c }) => ({ ...c, yaMarcado: checked ?? false })))}`,
      },
    ],
  } as Parameters<typeof anthropic.beta.messages.create>[0]);

  const r = response as unknown as { stop_reason: string | null; content: { type: string; text?: string }[] };
  if (r.stop_reason === "refusal") throw new Error("Claude declinó contestar el formulario de este grupo");
  const text = r.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("Claude no devolvió respuestas para el formulario del grupo");
  return JSON.parse(text) as Answers;
}

/**
 * Respuestas sin IA, para cuando el diálogo solo pide aceptar reglas: marcar
 * las casillas alcanza y no hace falta gastar una llamada ni exigir la key.
 */
function soloReglas(dialogo: DialogProbe): Answers | null {
  if (dialogo.controls.some((c) => c.kind !== "checkbox")) return null;
  return { texts: [], select: dialogo.controls.map((c) => c.id) };
}

async function llenar(page: Page, dialogo: DialogProbe, answers: Answers, log: Logger) {
  const byId = new Map(dialogo.controls.map((c) => [c.id, c]));

  for (const { id, value } of answers.texts ?? []) {
    const control = byId.get(id);
    if (!control || control.kind !== "text" || !value.trim()) continue;
    const campo = page.locator(`[${MARK}="${id}"]`).first();
    await campo.click({ timeout: 5000 });
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
    // Tecleado y no `fill`: los campos de Facebook son React y algunos son
    // contenteditable, que `fill` no siempre dispara como input de verdad.
    await page.keyboard.type(value, { delay: 35 });
    await log("info", `Respuesta a "${(control.context || control.label).slice(0, 80)}": ${value}`);
  }

  for (const id of answers.select ?? []) {
    const control = byId.get(id);
    if (!control || control.kind === "text" || control.checked) continue;
    const el = page.locator(`[${MARK}="${id}"]`).first();
    // Los <input> de Facebook suelen estar ocultos detrás del dibujo de la
    // casilla: se clickea su <label> si lo tiene, y si no el propio control.
    const label = el.locator("xpath=ancestor::label[1]");
    if (await label.count()) await label.click({ timeout: 5000 });
    else await el.click({ timeout: 5000, force: true });
    const pregunta = control.context.replace(control.label, "").trim().slice(0, 100);
    await log("info", `Marcado: ${control.label}${pregunta ? ` (${pregunta})` : ""}`);
  }
}

/** Clickea el botón que avanza el diálogo abierto. Devuelve el texto del botón o null. */
async function avanzar(page: Page): Promise<string | null> {
  const dialog = page.locator('[role="dialog"]').last();
  const botones = dialog.locator('[role="button"], button');
  const total = await botones.count();
  const candidatos: { i: number; rank: number; label: string }[] = [];
  for (let i = 0; i < total; i++) {
    const b = botones.nth(i);
    if (!(await b.isVisible().catch(() => false))) continue;
    const label = normalizar((await b.getAttribute("aria-label").catch(() => null)) || (await b.innerText().catch(() => "")));
    const rank = ADVANCE_LABELS.indexOf(label);
    if (rank >= 0 && (await b.getAttribute("aria-disabled")) !== "true") candidatos.push({ i, rank, label });
  }
  candidatos.sort((a, b) => a.rank - b.rank);
  const elegido = candidatos[0];
  if (!elegido) return null;
  await botones.nth(elegido.i).click({ timeout: 5000 });
  return elegido.label;
}

async function esperarCambio(page: Page, timeoutMs: number): Promise<{ state: JoinState; dialog: boolean }> {
  const hasta = Date.now() + timeoutMs;
  while (Date.now() < hasta) {
    const dialog = await page
      .locator('[role="dialog"]')
      .last()
      .isVisible()
      .catch(() => false);
    if (dialog) return { state: "unknown", dialog: true };
    const state = await leerEstado(page);
    if (state === "pending" || state === "member") return { state, dialog: false };
    await page.waitForTimeout(500);
  }
  return { state: await leerEstado(page), dialog: false };
}

export async function unirseAlGrupo(
  page: Page,
  opts: { persona: Persona; contexto: string; log: Logger; assertNoBlocker: () => Promise<void> },
): Promise<JoinGroupResult> {
  const { persona, contexto, log, assertNoBlocker } = opts;
  await assertNoBlocker();

  let estado = await leerEstado(page);
  if (estado === "member") {
    await log("info", "El perfil ya era miembro del grupo; no hay nada que hacer.");
    return "already_member";
  }
  if (estado === "pending") {
    await log("info", "El perfil ya tenía una solicitud pendiente en este grupo.");
    return "already_pending";
  }
  if (estado !== "join") {
    // Pasa cuando la página todavía no terminó de pintar el encabezado.
    await page.waitForTimeout(4000);
    estado = await leerEstado(page);
    if (estado === "member") return "already_member";
    if (estado === "pending") return "already_pending";
    if (estado !== "join") {
      throw new Error(
        "No apareció el botón \"Unirte al grupo\". Puede que el enlace no sea de un grupo, que el grupo " +
          "no exista o que Facebook no le muestre el grupo a este perfil.",
      );
    }
  }

  await page.locator(`[${BUTTON_MARK}="join"]`).first().click({ timeout: 8000 });
  await log("info", "Clic en \"Unirte al grupo\".");

  // Lo que decía el último diálogo sin preguntas (un aviso con "OK"). Si al
  // final no quedó la solicitud, ese texto es casi siempre el porqué.
  let ultimoAviso = "";
  // Títulos de los formularios ya contestados en esta tarea.
  const respondidos = new Set<string>();

  for (let ronda = 0; ronda < DIALOG_ROUNDS; ronda++) {
    const cambio = await esperarCambio(page, STATE_TIMEOUT_MS);
    await assertNoBlocker();
    if (cambio.state === "pending") {
      await log("info", "Solicitud enviada: queda pendiente de aprobación de los admins del grupo.");
      return "pending";
    }
    if (cambio.state === "member") {
      await log("info", "Unido al grupo.");
      return "joined";
    }
    if (!cambio.dialog) break;

    const dialogo = await esperarDialogoCargado(page);
    if (!dialogo.found) continue;
    await log(
      "info",
      `Diálogo "${dialogo.title || "sin título"}" con ${dialogo.controls.length} campo(s); botones: ${dialogo.buttons.join(", ") || "—"}`,
    );
    if (!dialogo.controls.length) {
      ultimoAviso = dialogo.text.slice(0, 300);
      await log("info", `Texto del diálogo: ${ultimoAviso || "(vacío)"}`);
    }

    // Se contesta la primera vez que aparece el formulario, y después solo si
    // quedó algo sin responder. Antes se volvía a llamar a Claude en cada
    // vuelta porque los "No" de cada pregunta siempre quedan desmarcados.
    const primeraVez = !respondidos.has(dialogo.title);
    if (dialogo.controls.length && (primeraVez || faltaResponder(dialogo))) {
      const answers = soloReglas(dialogo) ?? (await responderConClaude(dialogo, persona, contexto));
      await llenar(page, dialogo, answers, log);
      respondidos.add(dialogo.title);
      await page.waitForTimeout(800);
    }

    let boton = await avanzar(page);
    if (!boton) {
      // El "Enviar" se deshabilita mientras Facebook procesa el envío
      // anterior: esperar a que el diálogo se cierre o el botón vuelva.
      const tras = await esperarDialogoListo(page, ENVIO_TIMEOUT_MS);
      if (tras === "cerrado") continue;
      boton = await avanzar(page);
    }
    if (!boton) {
      const releido = await leerDialogo(page);
      const pendientes = preguntasSinResponder(releido);
      throw new Error(
        `El diálogo "${dialogo.title}" no tiene un botón para enviar habilitado (botones: ${dialogo.buttons.join(", ") || "ninguno"}). ` +
          (pendientes.length
            ? `Quedó sin responder: ${pendientes.join(" | ")}.`
            : "Puede que falte una respuesta obligatoria."),
      );
    }
    await log("info", `Clic en "${boton}".`);
    await page.waitForTimeout(1500);
    if (/^(enviar|enviar respuestas|submit)$/.test(boton)) {
      await esperarDialogoListo(page, ENVIO_TIMEOUT_MS);
    }
  }

  // Último intento: recargar y leer el botón de cero. A veces el diálogo se
  // cierra y el encabezado no se repinta hasta navegar.
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
  await page.waitForTimeout(4000);
  const final = await leerEstado(page);
  if (final === "pending") {
    await log("info", "Solicitud enviada (confirmada al recargar).");
    return "pending";
  }
  if (final === "member") {
    await log("info", "Unido al grupo (confirmado al recargar).");
    return "joined";
  }
  throw new Error(
    "Se enviaron los pasos pero Facebook no muestra la solicitud: el botón sigue en \"Unirte al grupo\". " +
      (ultimoAviso
        ? `Facebook mostró este aviso: "${ultimoAviso}".`
        : "Puede que haya rechazado el formulario o que el perfil esté limitado para unirse a grupos."),
  );
}

const ENVIO_TIMEOUT_MS = 15000;

/** Preguntas que siguen sin respuesta: grupos de radios sin marcar y campos de texto vacíos. */
function preguntasSinResponder(dialogo: DialogProbe): string[] {
  const out: string[] = [];
  const grupos = new Map<string, FormControl[]>();
  for (const c of dialogo.controls) {
    if (c.kind === "text" && !c.value) out.push((c.context || c.label).slice(0, 80));
    if (c.kind === "radio" && c.group) grupos.set(c.group, [...(grupos.get(c.group) ?? []), c]);
  }
  for (const opciones of grupos.values()) {
    if (!opciones.some((o) => o.checked)) out.push(opciones[0].context.slice(0, 80));
  }
  return out;
}

function faltaResponder(dialogo: DialogProbe) {
  return preguntasSinResponder(dialogo).length > 0;
}

/**
 * Después de "Enviar": espera a que el diálogo se cierre o a que vuelva a
 * tener un botón habilitado para seguir. Leerlo enseguida lo encontraba con
 * el "Enviar" deshabilitado (Facebook procesando) y la tarea fallaba como si
 * faltara una respuesta.
 */
async function esperarDialogoListo(page: Page, timeoutMs: number): Promise<"cerrado" | "abierto"> {
  const hasta = Date.now() + timeoutMs;
  while (Date.now() < hasta) {
    const abierto = await page
      .locator('[role="dialog"]')
      .last()
      .isVisible()
      .catch(() => false);
    if (!abierto) return "cerrado";
    const habilitado = await page
      .locator('[role="dialog"]')
      .last()
      .locator('[role="button"]:not([aria-disabled="true"]), button:not([disabled])')
      .filter({ hasText: /^(enviar|submit|aceptar|ok|listo|done|continuar|continue|siguiente|next)$/i })
      .first()
      .isVisible()
      .catch(() => false);
    if (habilitado) return "abierto";
    await page.waitForTimeout(700);
  }
  return "abierto";
}

const CARGANDO = /^(loading|cargando)\b/i;
const CARGA_MAX_MS = 12000;

/**
 * Lee el diálogo cuando terminó de cargar.
 *
 * Facebook abre el formulario del grupo enseguida con el título "Loading…" y
 * lo llena después. Leerlo en ese momento daba 0 campos y solo "Close", y la
 * tarea seguía con lo que hubiera aparecido mientras tanto, sin leerlo: se vio
 * clickear un "OK" que no estaba en la lectura y terminar sin solicitud.
 */
async function esperarDialogoCargado(page: Page): Promise<DialogProbe> {
  const hasta = Date.now() + CARGA_MAX_MS;
  for (;;) {
    const dialogo = await leerDialogo(page);
    const cargando =
      dialogo.found &&
      (CARGANDO.test(dialogo.title) ||
        (!dialogo.controls.length && dialogo.buttons.every((b) => /^(close|cerrar)$/i.test(b))));
    if (!cargando || Date.now() >= hasta) return dialogo;
    await page.waitForTimeout(600);
  }
}
