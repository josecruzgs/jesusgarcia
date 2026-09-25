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

type JoinState = "join" | "pending" | "member" | "unknown";

type FormControl = {
  id: string;
  kind: "text" | "radio" | "checkbox";
  /** Solo para radio: las opciones del mismo grupo comparten `group`. */
  group?: string;
  label: string;
  /** El texto alrededor del control: de ahí sale la pregunta. */
  context: string;
  checked?: boolean;
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
 * En qué estado ve la página al perfil respecto del grupo, y marca el botón de
 * unirse si lo hay. Se toma el primero en orden de documento: el del encabezado
 * del grupo va antes que los "Unirte" de los grupos sugeridos de la columna.
 */
async function leerEstado(page: Page): Promise<JoinState> {
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

      const controls: {
        id: string;
        kind: "text" | "radio" | "checkbox";
        group?: string;
        label: string;
        context: string;
        checked?: boolean;
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
        controls.push({ id, kind: "text", label: etiqueta(el), context: contexto(el) });
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
          label: etiqueta(el),
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
          label: etiqueta(el),
          context: contexto(el),
          checked: (el as HTMLInputElement).checked || el.getAttribute("aria-checked") === "true",
        });
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

Recibes el texto del diálogo y la lista de controles, cada uno con un id. Devuelve:
- "texts": una respuesta por cada campo de texto (kind "text"), con su id.
- "select": los ids de las opciones a marcar. En cada grupo de radios (mismo "group") elige exactamente una. En casillas marca las que correspondan, y siempre la de aceptar las reglas del grupo si existe.

Cómo responder:
- Como lo escribiría esa persona: primera persona, natural, breve (una o dos frases), en el idioma de la pregunta. Sin sonar a plantilla ni a vendedor.
- Usa el contexto que te den (de dónde es, por qué le interesa el grupo). Si una pregunta pide algo que el contexto no dice, contesta algo verosímil y genérico que sea coherente con la persona y con el tema del grupo.
- Nunca inventes correos, teléfonos, números de identificación ni enlaces. Si un campo pide eso, deja su value vacío.
- Si el grupo pide aceptar reglas, acéptalas.`;

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
    await log("info", `Marcado: ${control.label || control.context.slice(0, 80)}`);
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

    const dialogo = await leerDialogo(page);
    if (!dialogo.found) continue;
    await log(
      "info",
      `Diálogo "${dialogo.title || "sin título"}" con ${dialogo.controls.length} campo(s); botones: ${dialogo.buttons.join(", ") || "—"}`,
    );

    if (dialogo.controls.some((c) => !c.checked || c.kind === "text")) {
      const answers = soloReglas(dialogo) ?? (await responderConClaude(dialogo, persona, contexto));
      await llenar(page, dialogo, answers, log);
      await page.waitForTimeout(800);
    }

    const boton = await avanzar(page);
    if (!boton) {
      throw new Error(
        `El diálogo "${dialogo.title}" no tiene un botón para enviar habilitado (botones: ${dialogo.buttons.join(", ") || "ninguno"}). ` +
          "Puede que falte una respuesta obligatoria.",
      );
    }
    await log("info", `Clic en "${boton}".`);
    await page.waitForTimeout(1500);
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
      "Puede que haya rechazado el formulario o que el perfil esté limitado para unirse a grupos.",
  );
}
