import { mkdir } from "node:fs/promises";
import type { Locator, Page } from "playwright-core";
import { dbConnect } from "@/lib/mongodb";
import TaskModel from "@/lib/models/Task";
import TaskLogModel from "@/lib/models/TaskLog";
import ProfileModel from "@/lib/models/Profile";
import { connectToProfile, disconnectProfile } from "./browser";
import { parseFacebookCommentTarget } from "@/lib/commentLinks";

type Step = {
  action:
    | "goto"
    | "click"
    | "hover"
    | "fill"
    | "type"
    | "press"
    | "waitForSelector"
    | "waitForTimeout"
    | "screenshot"
    | "scroll"
    | "uploadFile"
    | "likeComment"
    | "captureComment"
    | "replyComment";
  selector?: string;
  value?: string;
  url?: string;
  key?: string;
  ms?: number;
  // Para "likeComment" y "replyComment".
  commentId?: string;
  reactionSelector?: string;
  /**
   * El `commentId` —y la `url` del goto— salen del comentario que publicó la
   * tarea padre, no se saben al crear la campaña. Los resuelve runTask antes
   * de ejecutar. Ver Ramificaciones.
   */
  fromParent?: boolean;
  // Si el step falla (ej. un selector que no siempre aparece, como un
  // interstitial de "una sola vez"), se loguea como advertencia y la tarea
  // sigue en vez de terminar en "failed".
  optional?: boolean;
};

const DEFAULT_ACTION_TIMEOUT_MS = 30000;
const DEFAULT_CLICK_TIMEOUT_MS = 8000;
const DEFAULT_GOTO_TIMEOUT_MS = 60000;
const GOTO_DOMCONTENTLOADED_GRACE_MS = 10000;
const VISIBLE_POLL_MS = 250;
const BLOCKER_CHECK_INTERVAL_MS = 1000;

const FACEBOOK_COMMENT_BOX_SELECTOR = [
  'div[role="textbox"][contenteditable="true"][aria-label*="Write a comment"]',
  'div[role="textbox"][contenteditable="true"][aria-label*="Escribe un comentario"]',
  'div[role="textbox"][contenteditable="true"][aria-placeholder*="Write a comment"]',
  'div[role="textbox"][contenteditable="true"][aria-placeholder*="Escribe un comentario"]',
  'div[aria-label*="Write a comment"]',
  'div[aria-label*="Escribe un comentario"]',
  'form div[role="textbox"][contenteditable="true"]',
].join(", ");

/**
 * Cómo se llama el botón que abre los comentarios.
 *
 * Va por coincidencia parcial (`*=`) y no exacta a propósito. En un post normal
 * el botón se llama "Comentar" a secas, pero en el visor de Reels —donde el
 * panel arranca cerrado y hay que abrirlo sí o sí— el rótulo trae el conteo o
 * el contexto ("398 comentarios", "Comentar en el reel"). Con `=` no matcheaba
 * ninguno, el panel nunca se abría, y el fallo aparecía un paso más tarde: como
 * un timeout de la caja de texto, que efectivamente no existía todavía.
 */
const FACEBOOK_COMMENT_OPEN_LABELS = ["Comentario", "Comentar", "Comment"];

const FACEBOOK_COMMENT_OPEN_SELECTOR = FACEBOOK_COMMENT_OPEN_LABELS.flatMap((label) => [
  `[role="button"][aria-label*="${label}"]`,
  `[aria-label*="${label}"]`,
  `div[role="button"]:has(svg[aria-label*="${label}"])`,
  `svg[aria-label*="${label}"]`,
]).join(", ");

/** Igual, pero solo lo enfocable: para el intento por teclado hace falta un botón real, no el <svg> de adentro. */
const FACEBOOK_COMMENT_OPEN_FOCUSABLE_SELECTOR = FACEBOOK_COMMENT_OPEN_LABELS.map(
  (label) => `[role="button"][aria-label*="${label}"]`,
).join(", ");

/**
 * La X de las capas que Facebook encima sobre la publicación.
 *
 * En el visor de Reels aparece un "cuadro de sugerencias" que cubre la columna
 * de acciones: el botón "Comentar" queda visible pero deja de recibir el
 * puntero, así que el click nunca llega y el panel no abre.
 *
 * Se apunta al rótulo específico y NUNCA a un "Cerrar" pelado: ese es el de la
 * X del propio visor de Reels, y clickearlo cerraría la publicación entera,
 * dejando a la tarea escribiendo en cualquier lado. La `i` del final hace la
 * comparación insensible a mayúsculas.
 */
const FACEBOOK_OVERLAY_DISMISS_SELECTOR = [
  '[aria-label*="cuadro de sugerencias" i]',
  '[aria-label*="suggestions box" i]',
  '[aria-label*="suggestion box" i]',
].join(", ");

/**
 * Cómo se llama el botón de reaccionar, por idioma de la interfaz.
 *
 * Facebook rotula sus botones en el idioma del perfil, no en el del país, y los
 * perfiles de AdsPower heredan el idioma que traiga su huella. Un perfil con la
 * huella en francés muestra "J'aime" aunque la cuenta sea mexicana, y el paso
 * fallaba con "0 match(es)" sin ninguna pista de por qué: el botón estaba ahí,
 * con otro nombre.
 */
const FACEBOOK_LIKE_LABELS = [
  "Like",
  "React",
  "Me gusta",
  "Reaccionar",
  "Reacciona",
  "J'aime",
  "Réagir",
  "Curtir",
  "Reagir",
  "Mi piace",
  "Gefällt mir",
];

/** Las que aparecen cuando la reacción YA está puesta — señal de trabajo hecho. */
const FACEBOOK_UNLIKE_LABELS = [
  "Remove Like",
  "Unlike",
  "Quitar Me gusta",
  "Ya no me gusta",
  "Retirer J'aime",
  "Je n'aime plus",
  "Descurtir",
  "Remover Curtir",
  "Non mi piace più",
];

/** Las cinco formas en que Facebook expone el mismo botón según el layout. */
function labelSelectors(labels: string[]): string {
  return labels
    .flatMap((label) => [
      `div[role="dialog"] [aria-label="${label}"]`,
      `[role="button"][aria-label="${label}"]`,
      `[aria-label="${label}"]`,
      `div[role="button"]:has(svg[aria-label="${label}"])`,
      `svg[aria-label="${label}"]`,
    ])
    .join(", ");
}

const FACEBOOK_LIKE_SELECTOR = labelSelectors(FACEBOOK_LIKE_LABELS);


/**
 * Atributo temporal con el que el runner marca, dentro de la página, el botón
 * de "Me gusta" del comentario buscado.
 *
 * Reaccionar a un comentario no se puede expresar con un selector CSS suelto:
 * el botón de un comentario es idéntico al del post y al de los demás
 * comentarios, y lo único que los distingue es el ancestro en el que viven.
 * Playwright no sabe subir por el árbol, así que la búsqueda se hace en el
 * navegador (localizar el permalink del comentario → subir a su contenedor →
 * bajar a su botón), se marca el resultado con este atributo y desde ahí se
 * vuelve a la maquinaria normal de clicks, que ya resuelve scroll, visibilidad
 * y capas encima.
 */
const FACEBOOK_COMMENT_LIKE_MARK = "data-godeye-comment-like";

/**
 * El mismo truco, para el botón de reaccionar de la publicación.
 *
 * Hizo falta porque Facebook tiene builds en los que la barra de acciones del
 * post no lleva `aria-label`: el botón es un `div[role="button"]` con el texto
 * "Me gusta" adentro y nada más. Ahí los once idiomas mapeados daban igual —el
 * selector devolvía "0 match(es)" con el botón en pantalla— y encima la barra
 * suele quedar por debajo del scroll interno del dialog, sin renderizar todavía.
 *
 * Buscarlo por texto suelto sería peligroso: los comentarios también tienen un
 * "Me gusta". Lo que lo distingue es la compañía —el botón del post vive en la
 * misma fila que "Comentar" y "Compartir", el de un comentario vive al lado de
 * "Responder"—, así que la búsqueda exige esa fila.
 */
const FACEBOOK_POST_LIKE_MARK = "data-godeye-post-like";

/** El de la publicación que YA tiene la reacción puesta. Ver FACEBOOK_POST_LIKE_MARK. */
const FACEBOOK_POST_LIKED_MARK = "data-godeye-post-liked";

/**
 * Cómo se llama el botón de reaccionar cuando Facebook lo rotula con una frase
 * entera en vez de con una palabra.
 *
 * FACEBOOK_LIKE_LABELS —los rótulos sueltos, "Me gusta"/"Like"— sirvió mientras
 * el botón se llamó así. En el build que está sirviendo ahora el rótulo es
 * "Reaccionar a la publicación de Dale Poder al Poder": lleva el nombre del
 * autor adentro, así que no hay lista de rótulos exactos que lo alcance y el
 * selector devolvía "0 match(es)" con el botón a la vista.
 *
 * Van anclados al principio de la frase y no como subcadena suelta a propósito.
 * "Me gusta" aparece también en "Me gusta: 8 personas" —el contador, que abre
 * la lista de quién reaccionó— y clickear eso daría la tarea por hecha sin
 * haber reaccionado a nada. Las anclas son las que separan el botón del
 * contador.
 *
 * Se comparan contra el rótulo normalizado: en minúsculas y sin acentos.
 */
const FACEBOOK_LIKE_ARIA_PATTERNS = [
  "^reaccionar\\b",
  "^react\\b",
  "^reagir\\b",
  "^reagire\\b",
  "^reagieren\\b",
  "^indicar que te gusta",
  "^me gusta$",
  "^like$",
  "^j'aime$",
  "^curtir$",
  "^mi piace$",
  "^gefallt mir$",
];

/**
 * Y cómo se llama cuando la reacción YA está puesta.
 *
 * Se miran antes que los de arriba: "Quitar Me gusta de la publicación de X"
 * empieza por otra palabra, pero un patrón mal escrito que lo dejara pasar
 * haría que la tarea quitara la reacción en vez de ponerla — un fallo que se
 * reporta como éxito.
 */
const FACEBOOK_UNLIKE_ARIA_PATTERNS = [
  "quitar me gusta",
  "quitar la reaccion",
  "ya no me gusta",
  "^unlike",
  "remove like",
  "descurtir",
  "remover curtir",
  "je n'aime plus",
  "retirer j'aime",
  "non mi piace piu",
  "gefallt mir nicht mehr",
];

/** Los vecinos que delatan a la barra de acciones de una publicación. */
const FACEBOOK_ACTION_ROW_LABELS = [
  "Comentar",
  "Comment",
  "Comentario",
  "Commenter",
  "Compartir",
  "Share",
  "Partager",
  "Compartilhar",
  "Condividi",
  "Teilen",
];

/** Cómo se rotula el botón de responder, por idioma de la interfaz. */
/**
 * "Compartir" es el vecino decisivo: identifica la barra de acciones de una
 * publicación porque un comentario no se comparte. Sale de
 * FACEBOOK_ACTION_ROW_LABELS, que mezclaba esto con los rótulos de comentar —
 * y esos aparecen también alrededor de un comentario ("Escribe un comentario",
 * "Comentar como X"), así que como señal valen menos.
 */
const FACEBOOK_SHARE_LABELS = ["Compartir", "Share", "Partager", "Compartilhar", "Condividi", "Teilen"];

/**
 * Cómo se presenta el contenedor de un comentario. Facebook le pone al
 * `role="article"` de cada comentario un aria-label con el autor: "Comentario
 * de Fulano", "Comment by Fulano".
 */
const FACEBOOK_COMMENT_ARTICLE_LABELS = [
  "Comentario de",
  "Comment by",
  "Respuesta de",
  "Reply by",
  "Commentaire de",
  "Commento di",
  "Kommentar von",
];

const FACEBOOK_REPLY_LABELS = [
  "Responder",
  "Reply",
  "Répondre",
  "Rispondi",
  "Antworten",
  "Responder a",
];

/** El mismo truco del marcado, para el botón de responder. Ver FACEBOOK_COMMENT_LIKE_MARK. */
const FACEBOOK_COMMENT_REPLY_MARK = "data-godeye-comment-reply";

/**
 * La caja de una respuesta, que NO es la del post.
 *
 * Al abrir "Responder" aparece un segundo `textbox` rotulado con "respuesta"
 * en vez de "comentario". Reutilizar el selector del comentario escribía en la
 * caja del post —o sea, un comentario suelto en vez de una respuesta al hilo—,
 * que es justo lo que Ramificaciones no quiere.
 */
const FACEBOOK_REPLY_BOX_SELECTOR = [
  'div[role="textbox"][contenteditable="true"][aria-label*="respuesta" i]',
  'div[role="textbox"][contenteditable="true"][aria-label*="reply" i]',
  'div[role="textbox"][contenteditable="true"][aria-placeholder*="respuesta" i]',
  'div[role="textbox"][contenteditable="true"][aria-placeholder*="reply" i]',
  'div[role="textbox"][contenteditable="true"][aria-label*="responde" i]',
].join(", ");

/** Botones de "ver más comentarios/respuestas" que pueden estar escondiendo el comentario. */
const FACEBOOK_MORE_COMMENTS_SELECTOR = [
  "más comentarios",
  "more comments",
  "comentarios anteriores",
  "previous comments",
  "más respuestas",
  "respuesta más",
  "respuestas más",
  "more replies",
]
  .map((text) => `div[role="button"]:has-text("${text}")`)
  .join(", ");

const FACEBOOK_MAX_COMMENT_EXPANSIONS = 4;

type CommentLikeProbe = {
  status: "ready" | "already_liked" | "not_found" | "no_article" | "no_button";
  detail: string;
};

const FACEBOOK_BLOCKERS = [
  {
    label: "cuenta bloqueada",
    text: ["desbloquear tu cuenta", "bloqueamos tu cuenta", "unlock your account", "locked your account"],
  },
  {
    label: "checkpoint de persona real",
    text: [
      "confirma que eres una persona real",
      "ingresa el texto de la imagen",
      "confirm that you are a real person",
      "confirm that you're a real person",
      "enter the text from the image",
    ],
  },
  {
    label: "sesion requerida",
    text: ["iniciar sesion en facebook", "log in to facebook"],
  },
  {
    label: "revision de seguridad",
    text: ["checkpoint", "suspicious activity", "actividad sospechosa"],
  },
];

type ClickableTarget = {
  locator: Locator;
  position: { x: number; y: number };
};

type StepContext = {
  taskId: string;
  profileName: string;
  taskType: string;
  /** Lo llama "captureComment" con el permalink del comentario y el perfil del autor. */
  onResult?: (r: { url: string | null; perfilUrl: string | null }) => void;
  /** La publicación a la que la tarea navegó al arrancar. Ver ensureOnTargetUrl. */
  targetUrl?: string;
};

function normalizePageText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

async function knownFacebookBlocker(page: Page): Promise<string | null> {
  const url = page.url();
  if (!url.includes("facebook.com")) return null;

  const normalizedUrl = url.toLowerCase();
  const bodyText = await page
    .locator("body")
    .innerText({ timeout: 1000 })
    .then(normalizePageText)
    .catch(() => "");

  for (const blocker of FACEBOOK_BLOCKERS) {
    if (blocker.text.some((pattern) => bodyText.includes(pattern) || normalizedUrl.includes(pattern))) {
      return `Facebook detuvo este perfil por ${blocker.label}. Requiere accion manual en la cuenta antes de volver a usarla.`;
    }
  }

  return null;
}

async function assertNoKnownBlocker(page: Page) {
  const blocker = await knownFacebookBlocker(page);
  if (blocker) throw new Error(blocker);
}

function isFacebookCommentBoxSelector(selector: string) {
  return /Write a comment|Escribe un comentario/i.test(selector);
}

function isFacebookLikeSelector(selector: string) {
  return FACEBOOK_LIKE_LABELS.some((label) => selector.includes(`aria-label="${label}"`));
}

/**
 * El selector con el que se va a buscar de verdad, ya preparada la página.
 *
 * Se resuelve DESPUÉS de `prepareSelectorTarget` y no antes, porque lo que
 * decide es si el sondeo llegó a marcar el botón de la publicación.
 *
 * Con marca se usa solo esa: unir la marca con el selector ancho no servía de
 * nada, porque quien clickea se queda con el primero del documento y el rótulo
 * "Me gusta" lo llevan también los botones de cada comentario —que en el
 * dialog suelen aparecer antes—. Se marcaba bien el botón correcto y se
 * clickeaba otro.
 *
 * Sin marca se cae al selector ancho, que es como funcionaba: si el sondeo no
 * encontró la barra de acciones, es mejor intentarlo que rendirse.
 */
async function selectorForStep(page: Page, selector: string, ctx: StepContext) {
  if (ctx.taskType === "comment" && isFacebookCommentBoxSelector(selector)) {
    return `${selector}, ${FACEBOOK_COMMENT_BOX_SELECTOR}`;
  }
  if (ctx.taskType === "like" && isFacebookLikeSelector(selector)) {
    const marcado = await page
      .locator(`[${FACEBOOK_POST_LIKE_MARK}]`)
      .count()
      .catch(() => 0);
    if (marcado > 0) return `[${FACEBOOK_POST_LIKE_MARK}]`;
    return `${selector}, ${FACEBOOK_LIKE_SELECTOR}`;
  }
  return selector;
}

async function hasVisibleLocator(page: Page, selector: string) {
  const locator = page.locator(selector);
  const count = await locator.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    if (await locator.nth(i).isVisible().catch(() => false)) return true;
  }
  return false;
}

/**
 * Los rótulos de los botones visibles de la página.
 *
 * Es puro diagnóstico. Cuando un selector no matchea, el log dice "0 match(es)"
 * y no hay forma de saber si el botón no está o si se llama distinto — averiguarlo
 * costaba bajarse la captura de fallo del servidor y mirarla a ojo. Con esto el
 * propio log trae los nombres reales y el arreglo es agregar el que falte.
 */
async function describeVisibleButtons(page: Page) {
  await defineEsbuildNameHelper(page);
  const labels = await page
    .evaluate(() => {
      const vistos = new Set<string>();
      for (const el of Array.from(document.querySelectorAll('[role="button"], button, svg[aria-label]'))) {
        const rect = el.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        const label = (el.getAttribute("aria-label") ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
        if (label) vistos.add(label.slice(0, 40));
      }
      return Array.from(vistos).slice(0, 40);
    })
    .catch(() => [] as string[]);

  return labels.length ? labels.map((l) => `"${l}"`).join(", ") : "(ninguno)";
}

/**
 * Vuelve a la publicación de la tarea si el navegador se fue a otra.
 *
 * El visor de Reels se pasa solo al siguiente video cuando termina el actual, y
 * los reels duran segundos. Entre que la tarea abre la página, espera, cierra
 * capas e intenta comentar, es normal que ya esté parada en otro reel: se vio
 * en el log a un perfil buscando el botón de comentar sobre una publicación de
 * otra cuenta.
 *
 * Sin esto, el mejor caso es que falle; el peor, que comente en la publicación
 * equivocada — un error silencioso y mucho más caro que un timeout.
 *
 * Se comparan solo los pathname: el visor le agrega y le saca parámetros a la
 * URL sin cambiar de publicación.
 */
/**
 * Frena el autoavance del visor de Reels.
 *
 * El visor pasa al siguiente video cuando el actual termina, y un reel dura
 * segundos: entre abrir la página, cerrar capas, abrir comentarios y escribir,
 * la tarea se quedaba comentando en otra publicación. Volver desde ahí ya
 * costaba perder el texto escrito.
 *
 * Se toca el elemento <video> directo en vez de buscar un botón de pausa: no
 * depende de rótulos ni de idioma, y `loop` evita el evento "ended", que es el
 * que dispara el salto. Es idempotente y hay que repetirlo, porque Facebook
 * monta elementos nuevos a medida que uno navega el visor.
 */
async function freezeReelPlayback(page: Page) {
  await page
    .evaluate(() => {
      for (const video of Array.from(document.querySelectorAll("video"))) {
        video.loop = true;
        video.pause();
      }
    })
    .catch(() => {});
}

function rutaDePublicacion(valor: string) {
  try {
    return new URL(valor).pathname.replace(/\/+$/, "");
  } catch {
    return valor;
  }
}

/**
 * Corta la tarea si el navegador ya no está en la publicación pedida.
 *
 * Se usa donde volver ya no sirve porque el daño sería irreversible: una vez
 * escrito el comentario, renavegar lo pierde, y enviarlo lo publica en la
 * publicación equivocada. Fallar es el único desenlace honesto.
 */
async function assertOnTargetUrl(page: Page, ctx: StepContext) {
  const objetivo = ctx.targetUrl;
  if (!objetivo) return;

  const actual = page.url();
  if (rutaDePublicacion(actual) === rutaDePublicacion(objetivo)) return;

  throw new Error(
    `El navegador quedó en otra publicación (${actual}) en vez de la de la tarea (${objetivo}) con el ` +
      `comentario ya escrito. Se aborta para no publicarlo donde no corresponde. Suele pasar en reels, que ` +
      `se pasan solos al siguiente video.`,
  );
}

async function ensureOnTargetUrl(page: Page, ctx: StepContext) {
  const objetivo = ctx.targetUrl;
  if (!objetivo) return;

  const actual = page.url();
  if (rutaDePublicacion(actual) === rutaDePublicacion(objetivo)) return;

  await log(ctx.taskId, "warn", `El visor se movió a otra publicación (${actual}); se vuelve a la de la tarea.`);
  await gotoPage(page, objetivo, DEFAULT_GOTO_TIMEOUT_MS, ctx);
  await page.waitForTimeout(2500);
  await freezeReelPlayback(page);
}

/** Cierra la capa de sugerencias, si la hay. Devuelve si cerró alguna. */
async function dismissFacebookOverlays(page: Page, ctx: StepContext) {
  const locator = page.locator(FACEBOOK_OVERLAY_DISMISS_SELECTOR);
  const count = await locator.count().catch(() => 0);

  for (let i = 0; i < count; i += 1) {
    const candidate = locator.nth(i);
    if (!(await candidate.isVisible().catch(() => false))) continue;

    await candidate.click({ timeout: 2000 }).catch(() => {});
    await log(ctx.taskId, "info", "Se cerró una capa de sugerencias que tapaba la publicación.");
    await page.waitForTimeout(800);
    return true;
  }
  return false;
}

/**
 * Abre los comentarios con el teclado en vez del mouse.
 *
 * Último recurso para cuando el botón está pero algo lo tapa: enfocarlo y
 * mandarle Enter no depende de que reciba el puntero. Es el mismo truco que ya
 * usa el paso de "like" cuando detecta que el botón está cubierto.
 */
async function openCommentsWithKeyboard(page: Page, ctx: StepContext) {
  const locator = page.locator(FACEBOOK_COMMENT_OPEN_FOCUSABLE_SELECTOR);
  const count = await locator.count().catch(() => 0);

  for (let i = 0; i < count; i += 1) {
    const candidate = locator.nth(i);
    if (!(await candidate.isVisible().catch(() => false))) continue;

    try {
      await candidate.focus({ timeout: 2000 });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1000);
    } catch {
      continue;
    }

    if (await hasVisibleLocator(page, FACEBOOK_COMMENT_BOX_SELECTOR)) {
      await log(ctx.taskId, "info", "Se abrieron los comentarios con el teclado (el botón estaba cubierto).");
      return true;
    }
  }
  return false;
}

const ABRIR_COMENTARIOS_INTENTOS = 3;

/**
 * Escribe en una caja de comentario y comprueba que quedó completo.
 *
 * `type()` manda tecla por tecla, y el editor de Facebook se re-renderiza
 * mientras tanto —al expandirse la caja, al aparecer el autocompletado de
 * menciones o el de emojis— y se come caracteres del medio. Se vio publicado
 * "Excelente, aestaremos!" donde debía decir "Excelente, ahi estaremos!".
 *
 * `insertText` mete el texto entero de una sola vez, así que no hay ventana
 * para perder nada. Y aun así se relee la caja antes de enviar: publicar un
 * comentario mutilado no se puede deshacer, y el intento anterior terminaba
 * además culpando a Facebook de haberlo descartado.
 */
async function escribirEnCaja(page: Page, caja: Locator, texto: string, ctx: StepContext) {
  const normalizar = (valor: string) =>
    valor
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const esperado = normalizar(texto);

  for (let intento = 1; intento <= 2; intento += 1) {
    await caja.click({ timeout: 5000 }).catch(() => {});
    await caja.focus({ timeout: 5000 }).catch(() => {});
    await page.keyboard.insertText(texto);
    await page.waitForTimeout(600);

    const escrito = normalizar(await caja.innerText().catch(() => ""));
    if (escrito.includes(esperado)) return;

    if (intento === 2) {
      throw new Error(
        `La caja quedó con "${escrito}" en vez de "${esperado}". No se envía para no publicar un comentario ` +
          `incompleto; suele pasar cuando el editor de Facebook se re-renderiza mientras se escribe.`,
      );
    }

    await log(ctx.taskId, "warn", `El texto quedó incompleto en la caja ("${escrito}"); se limpia y se reintenta.`);
    await page.keyboard.press("Control+A").catch(() => {});
    await page.keyboard.press("Delete").catch(() => {});
    await page.waitForTimeout(400);
  }
}

/**
 * Si la tarea publica un comentario en una publicación.
 *
 * El padre de una ramificación hace exactamente eso —lo único distinto es que
 * después se le cuelgan hijos—, así que necesita el mismo trato que una tarea
 * de comentario: abrir el panel, escribir con la caja tapada, y las guardias
 * que evitan publicar en la publicación equivocada.
 */
function esTareaDeComentario(taskType: string) {
  return taskType === "comment" || taskType === "ramificacion";
}

/**
 * Frases con las que Facebook responde cuando la publicación ya no se puede
 * ver: borrada, con la privacidad cambiada, o de una cuenta que bloqueó al
 * perfil. La página carga bien y sin bloqueo de seguridad, pero no trae ningún
 * botón de reaccionar — y el fallo salía como un timeout de selector, que hace
 * pensar en un selector roto cuando lo que no hay es publicación.
 */
const FACEBOOK_UNAVAILABLE_TEXT = [
  "este contenido no esta disponible",
  "contenido no disponible",
  "this content isn't available",
  "this content isnt available",
  "esta pagina no esta disponible",
  "this page isn't available",
  "this page isnt available",
];

async function facebookContentUnavailable(page: Page) {
  const texto = await page
    .locator("body")
    .innerText({ timeout: 1000 })
    .then(normalizePageText)
    .catch(() => "");
  return FACEBOOK_UNAVAILABLE_TEXT.some((frase) => texto.includes(frase));
}

/**
 * Por qué no apareció el botón de reaccionar.
 *
 * El timeout pelado dice "0 match(es)" y ahí se corta: no distingue entre la
 * publicación que ya no existe, el perfil con la interfaz en un idioma sin
 * mapear y el botón que Facebook movió de lugar. Las tres se arreglan distinto,
 * y averiguar cuál era costaba bajarse la captura del VPS. Ahora el propio
 * error lo dice, y en el caso del idioma trae los rótulos reales de la página
 * para agregar el que falte a FACEBOOK_LIKE_LABELS.
 */
async function explicarFalloDeLike(page: Page, message: string) {
  if (await facebookContentUnavailable(page)) {
    return new Error(
      "La publicación no está disponible para este perfil (borrada, con la privacidad cambiada, o la cuenta " +
        `bloqueó al perfil). No hay botón de reaccionar que buscar. Detalle: ${message}`,
    );
  }

  return new Error(
    `${message}. Botones visibles en la página: ${await describeVisibleButtons(page)}. Si alguno es el de ` +
      "reaccionar con otro nombre, hay que agregar ese rótulo a FACEBOOK_LIKE_ARIA_PATTERNS en runner.ts.",
  );
}

type PostLikeProbe = {
  status: "ready" | "already_liked" | "not_found";
  detail: string;
};

/**
 * Busca en la página el botón de reaccionar de la publicación y lo deja marcado.
 *
 * Corre dentro del navegador porque necesita subir por el árbol (`parentElement`)
 * para comprobar la fila de acciones, y Playwright no sabe hacer eso desde un
 * selector. Reconoce el botón por su nombre accesible —`aria-label` si lo tiene,
 * el texto renderizado si no— y solo acepta el que comparte fila con "Comentar"
 * o "Compartir".
 *
 * El texto se usa únicamente como respaldo, y con una salvaguarda: cuando la
 * reacción ya está puesta el rótulo sigue diciendo "Me gusta" (en azul), así que
 * clickearlo la quitaría en vez de ponerla. `aria-pressed="true"` es lo que
 * separa un caso del otro sobre un botón que ya sabemos cuál es —como pista
 * para encontrarlo no sirve, porque medio Facebook lo lleva.
 */
async function markFacebookPostLike(page: Page): Promise<PostLikeProbe> {
  await defineEsbuildNameHelper(page);
  return page.evaluate(
    ({ likeMark, likedMark, likePatterns, unlikePatterns, rowLabels, shareLabels, replyLabels, commentArticleLabels }): PostLikeProbe => {
      // Sin acentos y en minúsculas: "Gefällt mir" y "gefallt mir" son el mismo
      // botón, y el rótulo no siempre respeta el capitalizado entre layouts.
      const normalizar = (valor: string) =>
        valor
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim();

      const coincide = (valor: string, patrones: string[]) => {
        const limpio = normalizar(valor);
        return Boolean(limpio) && patrones.some((patron) => new RegExp(patron).test(limpio));
      };

      const contiene = (valor: string, palabras: string[]) => {
        const limpio = normalizar(valor);
        return Boolean(limpio) && palabras.some((palabra) => limpio.includes(normalizar(palabra)));
      };

      for (const marked of Array.from(document.querySelectorAll(`[${likeMark}], [${likedMark}]`))) {
        marked.removeAttribute(likeMark);
        marked.removeAttribute(likedMark);
      }

      const ariaOf = (el: Element) => (el.getAttribute("aria-label") ?? "").trim();
      const textOf = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
      const nombreDe = (el: Element) => ariaOf(el) || textOf(el);

      // El post abierto en dialog manda: en esa vista la página de atrás sigue
      // montada con su propio feed, y sus botones son los de otras publicaciones.
      const root: ParentNode = document.querySelector('div[role="dialog"]') ?? document;
      const botones = (Array.from(root.querySelectorAll('[role="button"], button')) as HTMLElement[]).filter(
        (el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        },
      );

      // La fila de acciones a la que pertenece un botón.
      //
      // Se sube por el árbol mientras el ancestro siga siendo "chico" en
      // botones. Ese corte es lo que evita el error de antes: subiendo un
      // número fijo de niveles, el barrido desde un comentario terminaba
      // alcanzando la barra del post y lo daba por bueno. Una fila de acciones
      // tiene tres botones; en cuanto el ancestro tiene muchos más, ya salimos
      // de la fila y estamos mirando el post entero.
      const filaDe = (el: HTMLElement) => {
        let fila: HTMLElement = el;
        let nodo: HTMLElement | null = el.parentElement;
        for (let i = 0; i < 6 && nodo; i += 1) {
          if (nodo.querySelectorAll('[role="button"], button').length > 6) break;
          fila = nodo;
          nodo = nodo.parentElement;
        }
        return fila;
      };

      const vecinosDe = (el: HTMLElement) =>
        (Array.from(filaDe(el).querySelectorAll('[role="button"], button')) as HTMLElement[])
          .filter((v) => v !== el)
          .map(nombreDe);

      // Un comentario se anuncia solo: su contenedor lleva un aria-label del
      // tipo "Comentario de Fulano". Se mira eso y no la anidación de
      // `role="article"`, porque Facebook también anida artículos por otros
      // motivos —una publicación compartida dentro de otra, sin ir más lejos—
      // y con esa regla se descartaba el botón bueno.
      const enComentario = (el: HTMLElement) => {
        let nodo: Element | null = el.closest('[role="article"]');
        for (let i = 0; i < 4 && nodo; i += 1) {
          if (contiene(ariaOf(nodo), commentArticleLabels)) return true;
          nodo = nodo.parentElement?.closest('[role="article"]') ?? null;
        }
        return false;
      };

      // Cuánto se parece al botón del post. Ninguna señal alcanza sola, así que
      // se suman y gana la mejor: si la evidencia fuerte no aparece —porque
      // Facebook cambió un rótulo— todavía queda la débil, y antes de rendirse
      // se acepta un candidato sin señales, que es lo que se hacía siempre.
      const puntajeDe = (el: HTMLElement) => {
        if (enComentario(el)) return -1;
        const vecinos = vecinosDe(el);
        // "Compartir" es la señal decisiva: un comentario no se comparte.
        if (vecinos.some((n) => contiene(n, shareLabels))) return 3;
        // "Responder" al lado es de un comentario, aunque no lo dijera el
        // contenedor.
        if (vecinos.some((n) => contiene(n, replyLabels))) return -1;
        if (vecinos.some((n) => contiene(n, rowLabels))) return 2;
        return 1;
      };

      const mejor = (candidatos: HTMLElement[]) => {
        let elegido: HTMLElement | null = null;
        let mejorPuntaje = 0;
        for (const el of candidatos) {
          const puntaje = puntajeDe(el);
          // Estrictamente mayor: ante empate gana el primero del documento,
          // que en una publicación abierta es el de arriba de todo.
          if (puntaje > mejorPuntaje) {
            mejorPuntaje = puntaje;
            elegido = el;
          }
        }
        return { elegido, puntaje: mejorPuntaje };
      };

      const comoSeEligio = (puntaje: number) =>
        puntaje >= 3 ? "fila con Compartir" : puntaje === 2 ? "fila de acciones" : "sin señales de fila";

      const puesto = mejor(botones.filter((el) => coincide(nombreDe(el), unlikePatterns)));
      if (puesto.elegido) {
        puesto.elegido.setAttribute(likedMark, "1");
        puesto.elegido.scrollIntoView({ block: "center" });
        return {
          status: "already_liked",
          detail: `${nombreDe(puesto.elegido).slice(0, 60)} (${comoSeEligio(puesto.puntaje)})`,
        };
      }

      const candidatos = botones.filter((el) => coincide(nombreDe(el), likePatterns));
      const { elegido, puntaje } = mejor(candidatos);
      if (!elegido) {
        // El detalle es para el registro de la tarea: si todos los candidatos
        // quedaron descartados por vivir en un comentario, se ve acá y no hay
        // que adivinar.
        const descartados = candidatos
          .slice(0, 4)
          .map((el) => `"${nombreDe(el).slice(0, 30)}"${enComentario(el) ? " [en comentario]" : ""}`)
          .join(", ");
        return {
          status: "not_found",
          detail: `${botones.length} boton(es) mirados, ${candidatos.length} con rótulo de reaccionar${
            descartados ? `: ${descartados}` : ""
          }`,
        };
      }
      const boton = elegido;

      // Hay builds donde el rótulo no cambia al reaccionar: sigue diciendo
      // "Me gusta", solo que en azul. Clickearlo ahí quitaría la reacción en vez
      // de ponerla. `aria-pressed` no sirve para encontrar el botón —medio
      // Facebook lo lleva— pero sobre uno que ya sabemos cuál es dice exactamente
      // eso: si está presionado o no.
      if (boton.closest('[aria-pressed="true"]')) {
        boton.setAttribute(likedMark, "1");
        boton.scrollIntoView({ block: "center" });
        return { status: "already_liked", detail: `${nombreDe(boton).slice(0, 60)} (aria-pressed)` };
      }

      boton.setAttribute(likeMark, "1");
      boton.scrollIntoView({ block: "center" });
      return { status: "ready", detail: `"${nombreDe(boton).slice(0, 60)}" (${comoSeEligio(puntaje)})` };
    },
    {
      likeMark: FACEBOOK_POST_LIKE_MARK,
      likedMark: FACEBOOK_POST_LIKED_MARK,
      likePatterns: FACEBOOK_LIKE_ARIA_PATTERNS,
      unlikePatterns: FACEBOOK_UNLIKE_ARIA_PATTERNS,
      rowLabels: FACEBOOK_ACTION_ROW_LABELS,
      shareLabels: FACEBOOK_SHARE_LABELS,
      replyLabels: FACEBOOK_REPLY_LABELS,
      commentArticleLabels: FACEBOOK_COMMENT_ARTICLE_LABELS,
    },
  );
}

/**
 * Baja un tramo dentro de la publicación.
 *
 * Con el post abierto en dialog, el scroll que importa no es el de la ventana
 * sino el del contenedor interno: la barra de acciones queda debajo de la
 * imagen, fuera de la vista y —cuando Facebook la monta tarde— fuera del DOM.
 * Mover la rueda del mouse no alcanza si el puntero no está encima del dialog.
 */
async function scrollFacebookPost(page: Page) {
  await page
    .evaluate(() => {
      const dialog = document.querySelector('div[role="dialog"]');
      const contenedores = (Array.from((dialog ?? document.body).querySelectorAll("*")) as HTMLElement[]).filter(
        (el) => {
          const estilo = getComputedStyle(el);
          return /(auto|scroll)/.test(estilo.overflowY) && el.scrollHeight > el.clientHeight + 40;
        },
      );

      if (!contenedores.length) {
        window.scrollBy(0, Math.round(window.innerHeight * 0.6));
        return;
      }

      const objetivo = contenedores.sort((a, b) => b.clientHeight - a.clientHeight)[0];
      objetivo.scrollTop = Math.min(objetivo.scrollTop + objetivo.clientHeight * 0.8, objetivo.scrollHeight);
    })
    .catch(() => {});
}

const BUSCAR_LIKE_INTENTOS = 4;

/**
 * Deja la publicación en condiciones de que se pueda reaccionar.
 *
 * Es el equivalente, para el like, de lo que prepareSelectorTarget ya hacía
 * para la caja de comentario: el visor de reels se pasa solo al siguiente video
 * y el cuadro de sugerencias tapa la columna de acciones. Sin esto, el paso
 * esperaba quince segundos un botón que estaba en otra publicación o debajo de
 * una capa.
 */
async function prepareFacebookLike(page: Page, ctx: StepContext) {
  await ensureOnTargetUrl(page, ctx);
  await freezeReelPlayback(page);
  await dismissFacebookOverlays(page, ctx);

  // Acá había tres atajos: si ya se veía algo que casara con el selector de
  // "Me gusta", se daba por resuelto sin sondear. El problema es que ese
  // selector es por `aria-label`, y ese rótulo lo llevan igual los botones de
  // cada comentario: el atajo se cumplía con el botón de un comentario, se
  // saltaba el sondeo, y el click terminaba reaccionando ahí.
  //
  // El sondeo es el único que sabe distinguirlos —mira el ancestro, no el
  // rótulo—, así que ahora corre siempre. Cuesta un `evaluate`, nada al lado de
  // lo que ya se pagó cargando la página.
  //
  // Lo mismo valía para el atajo de "ya reaccionada": el botón de quitar la
  // reacción de un comentario ajeno daba la tarea por hecha sin haber tocado la
  // publicación. El sondeo también resuelve ese caso, y con el post a la vista.
  let ultimo: PostLikeProbe | null = null;

  for (let intento = 1; intento <= BUSCAR_LIKE_INTENTOS; intento += 1) {
    const probe = await markFacebookPostLike(page);
    ultimo = probe;

    if (probe.status === "ready") {
      await log(ctx.taskId, "info", `Botón de reaccionar localizado por ${probe.detail}.`);
      return;
    }
    if (probe.status === "already_liked") {
      await log(ctx.taskId, "info", `La publicación ya tenía la reacción puesta (${probe.detail}).`);
      return;
    }

    if (intento < BUSCAR_LIKE_INTENTOS) {
      await scrollFacebookPost(page);
      await page.waitForTimeout(900);
    }
  }

  // Ni bajando apareció. No se corta acá —el paso siguiente todavía lo intenta
  // con el selector ancho— pero queda escrito qué se miró: sin esta línea, un
  // like que no sale se ve en el registro como un montón de scroll y nada más,
  // que es exactamente lo que no deja arreglarlo.
  await log(
    ctx.taskId,
    "warn",
    `No se pudo distinguir el botón de la publicación tras ${BUSCAR_LIKE_INTENTOS} intentos (${ultimo?.detail ?? "sin datos"}).`,
  );
}

async function prepareSelectorTarget(page: Page, rawSelector: string, ctx: StepContext) {
  if (ctx.taskType === "like" && isFacebookLikeSelector(rawSelector)) {
    await prepareFacebookLike(page, ctx);
    return;
  }

  if (!esTareaDeComentario(ctx.taskType) || !isFacebookCommentBoxSelector(rawSelector)) return;

  // La comprobación de publicación va ANTES de darse por satisfecho con la
  // caja visible. Al revés —que es como estaba— el visor podía haberse pasado
  // a otro reel, y como ese otro reel también muestra su caja de comentarios,
  // la función salía por acá contenta y se terminaba comentando en la
  // publicación equivocada.
  await ensureOnTargetUrl(page, ctx);

  // Congelar el video antes de tocar nada: si sigue corriendo, cualquier
  // espera de las que vienen es una oportunidad para que el visor derive.
  await freezeReelPlayback(page);

  if (await hasVisibleLocator(page, FACEBOOK_COMMENT_BOX_SELECTOR)) return;

  // Se reintenta porque en el visor de Reels esto no es determinista: los
  // mismos pasos sobre el mismo reel a veces abren el panel y a veces no,
  // según qué capa haya aparecido, si el video ya se pasó al siguiente, o si
  // la interfaz todavía estaba animando. Un solo intento fallaba seguido.
  for (let intento = 1; intento <= ABRIR_COMENTARIOS_INTENTOS; intento += 1) {
    await ensureOnTargetUrl(page, ctx);

    // Destapar: en los reels el botón de comentar está visible pero debajo del
    // cuadro de sugerencias, y así el click nunca le llega.
    await dismissFacebookOverlays(page, ctx);
    if (await hasVisibleLocator(page, FACEBOOK_COMMENT_BOX_SELECTOR)) return;

    let target: ClickableTarget | null = null;
    try {
      target = await firstClickableLocator(page, FACEBOOK_COMMENT_OPEN_SELECTOR, 2500);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith("Facebook detuvo este perfil")) throw err;
    }

    if (target) {
      await log(ctx.taskId, "info", "Abriendo panel/caja de comentarios de Facebook.");
      await target.locator.click({ position: target.position, timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(1000);
      if (await hasVisibleLocator(page, FACEBOOK_COMMENT_BOX_SELECTOR)) return;
    }

    // El botón puede seguir tapado por una capa que no sabemos cerrar; el
    // teclado no necesita que reciba el puntero.
    if (await openCommentsWithKeyboard(page, ctx)) return;

    if (intento < ABRIR_COMENTARIOS_INTENTOS) {
      await log(ctx.taskId, "info", `No se abrieron los comentarios; reintento ${intento + 1} de ${ABRIR_COMENTARIOS_INTENTOS}.`);
      await page.waitForTimeout(1500);
    }
  }

  // Salir en silencio dejaba el fallo apareciendo dos pasos después, como un
  // timeout de la caja de texto — que era una consecuencia, no la causa.
  await log(
    ctx.taskId,
    "warn",
    `No se pudo abrir los comentarios. Botones visibles en la página: ${await describeVisibleButtons(page)}`,
  );
}

function isNavigationTimeout(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return /page\.goto: Timeout|Timeout .* exceeded|waiting until "domcontentloaded"/i.test(message);
}

async function gotoPage(page: Page, url: string, timeoutMs: number, ctx: StepContext) {
  const beforeUrl = page.url();
  try {
    await page.goto(url, { waitUntil: "commit", timeout: timeoutMs });
  } catch (err) {
    const currentUrl = page.url();
    const hasUsableDocument =
      currentUrl !== "about:blank" && currentUrl !== beforeUrl && (await page.locator("body").count().catch(() => 0)) > 0;
    if (!isNavigationTimeout(err) || !hasUsableDocument) throw err;

    await log(
      ctx.taskId,
      "warn",
      "La navegacion tardo demasiado, pero la pagina ya tiene documento cargado; se continua con los selectores.",
    );
  }

  await page
    .locator("body")
    .waitFor({ state: "attached", timeout: Math.min(10000, timeoutMs) })
    .catch(() => {});

  await page.waitForLoadState("domcontentloaded", { timeout: GOTO_DOMCONTENTLOADED_GRACE_MS }).catch(() =>
    log(
      ctx.taskId,
      "warn",
      "Facebook no termino domcontentloaded a tiempo; se continua porque la navegacion ya inicio.",
    ),
  );

  await assertNoKnownBlocker(page);
}

async function clickablePosition(locator: Locator): Promise<{ x: number; y: number } | null> {
  const box = await locator.boundingBox().catch(() => null);
  if (!box || box.width <= 0 || box.height <= 0) return null;

  const rawPoints = [
    { x: box.width / 2, y: box.height / 2 },
    { x: Math.min(12, box.width - 1), y: box.height / 2 },
    { x: Math.max(box.width - 12, 1), y: box.height / 2 },
    { x: box.width / 2, y: Math.min(12, box.height - 1) },
    { x: box.width / 2, y: Math.max(box.height - 12, 1) },
  ];
  const points = rawPoints
    .filter((point) => point.x >= 0 && point.y >= 0 && point.x <= box.width && point.y <= box.height)
    .map((point) => ({ ...point, viewportX: box.x + point.x, viewportY: box.y + point.y }));

  if (!points.length) return null;

  return locator
    .evaluate((element, candidates) => {
      for (const point of candidates) {
        if (point.viewportX < 0 || point.viewportY < 0) continue;
        if (point.viewportX > window.innerWidth || point.viewportY > window.innerHeight) continue;

        const topElement = document.elementFromPoint(point.viewportX, point.viewportY);
        if (topElement && (topElement === element || element.contains(topElement))) {
          return { x: point.x, y: point.y };
        }
      }
      return null;
    }, points)
    .catch(() => null);
}

async function firstVisibleLocator(page: Page, selector: string, timeoutMs: number): Promise<Locator> {
  const locator = page.locator(selector);
  const deadline = Date.now() + timeoutMs;
  let lastCount = 0;
  let lastBlockerCheckAt = 0;

  while (Date.now() <= deadline) {
    if (Date.now() - lastBlockerCheckAt >= BLOCKER_CHECK_INTERVAL_MS) {
      lastBlockerCheckAt = Date.now();
      await assertNoKnownBlocker(page);
    }

    lastCount = await locator.count();

    for (let i = 0; i < lastCount; i += 1) {
      const candidate = locator.nth(i);
      if (await candidate.isVisible().catch(() => false)) {
        return candidate;
      }
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await page.waitForTimeout(Math.min(VISIBLE_POLL_MS, remainingMs));
  }

  await assertNoKnownBlocker(page);
  throw new Error(
    `Timeout ${timeoutMs}ms esperando elemento visible para selector "${selector}" (${lastCount} match(es), ninguno visible)`,
  );
}

async function firstClickableLocator(page: Page, selector: string, timeoutMs: number): Promise<ClickableTarget> {
  const locator = page.locator(selector);
  const deadline = Date.now() + timeoutMs;
  let lastCount = 0;
  let visibleCount = 0;
  let lastBlockerCheckAt = 0;

  while (Date.now() <= deadline) {
    if (Date.now() - lastBlockerCheckAt >= BLOCKER_CHECK_INTERVAL_MS) {
      lastBlockerCheckAt = Date.now();
      await assertNoKnownBlocker(page);
    }

    lastCount = await locator.count();
    visibleCount = 0;

    for (let i = 0; i < lastCount; i += 1) {
      const candidate = locator.nth(i);
      if (!(await candidate.isVisible().catch(() => false))) continue;
      visibleCount += 1;

      await candidate.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
      const position = await clickablePosition(candidate);
      if (position) return { locator: candidate, position };
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await page.waitForTimeout(Math.min(VISIBLE_POLL_MS, remainingMs));
  }

  await assertNoKnownBlocker(page);
  throw new Error(
    `Timeout ${timeoutMs}ms esperando elemento clickeable para selector "${selector}" (${lastCount} match(es), ${visibleCount} visible(s), ninguno recibe el puntero)`,
  );
}

/**
 * Busca el comentario en el DOM y deja marcado su botón de reaccionar.
 *
 * Corre entero dentro del navegador porque necesita `closest()`: se parte del
 * ancla del permalink (el "hace 2 h" de cada comentario, cuyo href lleva el
 * `comment_id`), se sube al `role="article"` que lo contiene — que es el
 * comentario, no el post — y ahí adentro se busca el botón cuyo rótulo o texto
 * sea "Me gusta" en alguno de los idiomas conocidos, descartando los que
 * pertenecen a respuestas anidadas.
 */
/**
 * Define en la página el helper `__name` que espera el código compilado.
 *
 * El worker corre bajo `tsx`, que transpila con esbuild, y esbuild envuelve
 * cada función con nombre en `__name(fn, "fn")` para que `fn.name` sobreviva a
 * la minificación. Ese helper se declara arriba del módulo, en Node — pero
 * Playwright serializa la función que se le pasa a `evaluate` y la manda sola
 * al navegador, sin el helper, así que la página revienta con "__name is not
 * defined" apenas el cuerpo declara una función con nombre. La web no lo sufre
 * porque el runner solo se ejecuta en el worker.
 *
 * Se manda como string a propósito: un string no pasa por esbuild, así que no
 * puede arrastrar la misma dependencia que viene a resolver. Y se reinyecta en
 * cada llamada porque cada navegación estrena el contexto de la página.
 */
async function defineEsbuildNameHelper(page: Page) {
  await page.evaluate("void (globalThis.__name = globalThis.__name || ((fn) => fn))");
}

/**
 * Busca en la página el comentario que contiene un texto y devuelve su
 * permalink.
 *
 * Se usa para comprobar que un comentario recién publicado existe de verdad.
 * Antes de esto la tarea se daba por exitosa apenas terminaba de teclear: si
 * Facebook lo descartaba en silencio —cosa que hace— quedaba como "EXITOSA"
 * igual.
 *
 * Corre entero dentro del navegador porque necesita `closest()` y comparar el
 * texto renderizado. Dos detalles del DOM de Facebook:
 *
 * - El post entero también es un `role="article"` y contiene el texto de todos
 *   sus comentarios, así que matchea igual que el comentario buscado. Por eso
 *   se descarta cualquier candidato que contenga a otro: el bueno es el más
 *   adentro.
 * - El `comment_id` no está en el comentario sino en el href del ancla de la
 *   fecha ("hace 2 h"), el mismo del que se cuelga markFacebookCommentLike.
 *
 * Devuelve null si no lo encuentra; el que llama decide si eso es un fallo.
 */
type CommentProbe = { encontrado: boolean; url: string | null; perfilUrl: string | null };

async function findPublishedComment(page: Page, texto: string): Promise<CommentProbe> {
  await defineEsbuildNameHelper(page);
  return page.evaluate((texto: string): CommentProbe => {
    const ausente: CommentProbe = { encontrado: false, url: null, perfilUrl: null };

    // Se comparan solo letras y números. Facebook reescribe lo que uno tipea
    // antes de renderizarlo —":)" sale como 🙂, y ahí una comparación literal
    // deja de encontrar el comentario que sí se publicó— y también toca
    // espacios y puntuación. Lo que sobrevive intacto son las palabras.
    const normalizar = (valor: string) =>
      valor
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();

    const buscado = normalizar(texto);
    if (!buscado) return ausente;
    if (!normalizar(document.body?.textContent ?? "").includes(buscado)) return ausente;

    // Se baja desde <body> al descendiente más chico que sigue conteniendo el
    // texto, en vez de recorrer todos los nodos preguntando por su contenido:
    // eso sería cuadrático sobre una página de Facebook.
    let comentario: Element = document.body;
    descender: for (;;) {
      for (const hijo of Array.from(comentario.children)) {
        if (normalizar(hijo.textContent ?? "").includes(buscado)) {
          comentario = hijo;
          continue descender;
        }
      }
      break;
    }

    // Los enlaces del comentario están fuera del texto (son hermanos, no
    // descendientes), así que se sube hasta el primer contenedor que tenga
    // alguno con `comment_id`.
    let contenedor: Element | null = comentario;
    let anclas: HTMLAnchorElement[] = [];
    for (let nivel = 0; nivel < 6 && contenedor; nivel += 1) {
      const encontradas = Array.from(contenedor.querySelectorAll("a[href]")) as HTMLAnchorElement[];
      if (encontradas.some((el) => /(^|[?&])(reply_)?comment_id=/.test(el.getAttribute("href") ?? ""))) {
        anclas = encontradas;
        break;
      }
      contenedor = contenedor.parentElement;
    }

    const absoluta = (el: HTMLAnchorElement) => {
      try {
        return new URL(el.getAttribute("href") ?? "", location.origin).href;
      } catch {
        return null;
      }
    };

    // Dentro de un comentario hay al menos dos enlaces y los DOS llevan
    // `comment_id`: el del nombre del autor y el de la hora. Solo el de la hora
    // es el permalink; el del nombre abre el perfil. Se distinguen por el
    // texto: la hora es corta y relativa ("2 min", "18 h", "Ahora").
    // Exige un número (o "ahora"). Sin eso, "Responder" —que también es un
    // enlace dentro del comentario— pasaba por hora.
    const esHora = (valor: string) =>
      valor.length <= 14 && /^(ahora|just now|now|(hace\s+)?\d+\s*[a-záéíóú]{0,10})$/i.test(valor);

    // Al enviar, Facebook pinta el comentario al instante con un id provisorio
    // del navegador (`comment_id=client:4fc59b57-…`) y recién después lo
    // reemplaza por el definitivo que asigna el servidor. Guardar el provisorio
    // deja un enlace que no le sirve a nadie, así que se descarta y se sigue
    // esperando al de verdad.
    const esProvisorio = (href: string) => /(^|[?&])(reply_)?comment_id=client(%3A|:)/i.test(href);

    const conComentario = anclas.filter((el) => {
      const href = el.getAttribute("href") ?? "";
      return /(^|[?&])(reply_)?comment_id=/.test(href) && !esProvisorio(href);
    });

    // El permalink apunta a la publicación; el link del nombre, al perfil del
    // autor. Comparar la ruta es lo que mejor los separa —no depende del idioma
    // ni de que la hora ya se haya renderizado— y es justo lo que faltaba
    // cuando se guardó un `profile.php` como si fuera el comentario.
    const rutaActual = location.pathname.replace(/\/+$/, "");
    const mismaRuta = (el: HTMLAnchorElement) => {
      try {
        return new URL(el.getAttribute("href") ?? "", location.origin).pathname.replace(/\/+$/, "") === rutaActual;
      } catch {
        return false;
      }
    };

    // Sin candidato bueno se prefiere no devolver nada: un permalink
    // equivocado es peor que ninguno, porque el resto del sistema lo cree.
    const permalink =
      conComentario.find((el) => mismaRuta(el) && esHora((el.textContent ?? "").trim())) ??
      conComentario.find((el) => mismaRuta(el)) ??
      null;

    // El perfil del que comentó: el enlace del nombre. Se le sacan los
    // parámetros, que traen el comment_id y basura de seguimiento.
    const autor = anclas.find((el) => {
      const texto = (el.textContent ?? "").trim();
      return texto.length > 0 && !esHora(texto);
    });

    let perfilUrl: string | null = null;
    if (autor) {
      const cruda = absoluta(autor);
      if (cruda) {
        try {
          const u = new URL(cruda);
          // Se conserva `id` y se descarta todo lo demás. Los perfiles sin
          // nombre de usuario son `/profile.php?id=100058…`: ahí el
          // identificador está en la query, y limpiarla entera deja un
          // `profile.php` pelado que abre el perfil de quien esté logueado.
          // El resto de los parámetros son el comment_id y seguimiento.
          const id = u.searchParams.get("id");
          perfilUrl = id ? `${u.origin}${u.pathname}?id=${encodeURIComponent(id)}` : `${u.origin}${u.pathname}`;
        } catch {
          perfilUrl = cruda;
        }
      }
    }

    // Que no haya permalink no significa que el comentario no esté: recién
    // publicado Facebook tarda en darle enlace propio, y en el panel de un reel
    // a veces no se lo da nunca. Por eso el hallazgo y el link van separados.
    return { encontrado: true, url: permalink ? absoluta(permalink) : null, perfilUrl };
  }, texto);
}

/**
 * Lo mismo, pero reintentando: el comentario tarda en aparecer en el DOM
 * después de enviarlo, y cuánto depende de la red y de lo cargada que esté la
 * publicación. Un timeout fijo sería o muy corto o desperdicio de tiempo.
 */
async function waitForPublishedComment(page: Page, texto: string, timeoutMs: number): Promise<CommentProbe> {
  const limite = Date.now() + timeoutMs;
  let ultimo: CommentProbe = { encontrado: false, url: null, perfilUrl: null };
  for (;;) {
    ultimo = await findPublishedComment(page, texto);
    // Con el comentario ya encontrado se sigue esperando un poco por su
    // enlace, que aparece después — pero sin dejar que la falta de enlace
    // consuma todo el tiempo restante.
    if (ultimo.url) return ultimo;
    if (Date.now() >= limite) return ultimo;
    await page.waitForTimeout(VISIBLE_POLL_MS * 4);
  }
}

async function markFacebookCommentLike(page: Page, commentId: string): Promise<CommentLikeProbe> {
  await defineEsbuildNameHelper(page);
  return page.evaluate(
    ({ commentId, mark, likeLabels, unlikeLabels }): CommentLikeProbe => {
      // Comparación insensible a mayúsculas y a acentos ("Gefällt mir" vs
      // "gefallt mir"): la interfaz de Facebook no siempre respeta el
      // capitalizado del rótulo entre layouts.
      const sameLabel = (value: string, label: string) =>
        value.trim().localeCompare(label, undefined, { sensitivity: "base" }) === 0;
      const matchesAny = (value: string, labels: string[]) =>
        Boolean(value.trim()) && labels.some((label) => sameLabel(value, label));

      for (const marked of Array.from(document.querySelectorAll(`[${mark}]`))) {
        marked.removeAttribute(mark);
      }

      // El href del DOM puede traer el id escapado (`%3D` del padding base64)
      // y el link del que salió, decodificado — o al revés. Se prueban las dos
      // formas contra las dos versiones del href.
      const wantedIds = [commentId];
      const encoded = encodeURIComponent(commentId);
      if (encoded !== commentId) wantedIds.push(encoded);

      const patterns = wantedIds.map(
        (id) => new RegExp(`(^|[?&])(reply_)?comment_id=${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(&|#|$)`),
      );

      const hrefMatches = (href: string) => {
        const variants = [href];
        try {
          const decoded = decodeURIComponent(href);
          if (decoded !== href) variants.push(decoded);
        } catch {
          // href con escapes inválidos: basta con la forma cruda
        }
        return variants.some((variant) => patterns.some((pattern) => pattern.test(variant)));
      };

      const anchors = Array.from(document.querySelectorAll("a[href]")).filter((a) =>
        hrefMatches(a.getAttribute("href") ?? ""),
      );
      if (!anchors.length) {
        const articles = document.querySelectorAll('[role="article"]').length;
        return { status: "not_found", detail: `${articles} comentario(s) renderizado(s) en la página` };
      }

      // El mismo id puede aparecer en más de un link (el permalink del
      // comentario, un "responder", el menú de compartir): sirve el primero que
      // esté realmente dentro de un comentario.
      const article = anchors.map((a) => a.closest('[role="article"]')).find(Boolean);
      if (!article) {
        return {
          status: "no_article",
          detail: `${anchors.length} link(s) con ese id, ninguno dentro de un contenedor de comentario`,
        };
      }

      // Los botones de las respuestas viven en artículos anidados: solo cuentan
      // los que tienen a este artículo como contenedor más cercano.
      const buttons = Array.from(article.querySelectorAll('[role="button"]')).filter(
        (button) => button.closest('[role="article"]') === article,
      );

      const labelOf = (el: Element) => el.getAttribute("aria-label") ?? "";
      const textOf = (el: Element) => (el as HTMLElement).innerText || el.textContent || "";
      const isLikeButton = (el: Element) =>
        matchesAny(labelOf(el), likeLabels) || matchesAny(textOf(el), likeLabels);

      const liked = buttons.find(
        (button) =>
          matchesAny(labelOf(button), unlikeLabels) ||
          (button.getAttribute("aria-pressed") === "true" && isLikeButton(button)),
      );
      if (liked) return { status: "already_liked", detail: "" };

      const likeButton = buttons.find(isLikeButton);
      if (!likeButton) {
        return {
          status: "no_button",
          detail: `${buttons.length} botón(es) en el comentario, ninguno rotulado como "Me gusta"`,
        };
      }

      likeButton.setAttribute(mark, "1");
      // El picker de reacciones se abre hacia arriba: el comentario tiene que
      // quedar a media pantalla para que quepa.
      article.scrollIntoView({ block: "center" });
      return { status: "ready", detail: "" };
    },
    {
      commentId,
      mark: FACEBOOK_COMMENT_LIKE_MARK,
      likeLabels: FACEBOOK_LIKE_LABELS,
      unlikeLabels: FACEBOOK_UNLIKE_LABELS,
    },
  );
}

/**
 * Reintenta la búsqueda mientras el comentario no aparezca: Facebook carga los
 * comentarios de a poco y el que se busca puede estar detrás de un "Ver más
 * comentarios", sobre todo en publicaciones con mucha conversación.
 */
async function resolveFacebookCommentLike(
  page: Page,
  commentId: string,
  timeoutMs: number,
  ctx: StepContext,
): Promise<CommentLikeProbe> {
  const deadline = Date.now() + timeoutMs;
  let probe = await markFacebookCommentLike(page, commentId);
  let expansions = 0;

  while (probe.status === "not_found" && Date.now() < deadline) {
    await assertNoKnownBlocker(page);

    if (expansions < FACEBOOK_MAX_COMMENT_EXPANSIONS && (await hasVisibleLocator(page, FACEBOOK_MORE_COMMENTS_SELECTOR))) {
      expansions += 1;
      await log(ctx.taskId, "info", `El comentario aún no está cargado; abriendo más comentarios (intento ${expansions}).`);
      const target = await firstClickableLocator(page, FACEBOOK_MORE_COMMENTS_SELECTOR, 3000).catch(() => null);
      if (target) await target.locator.click({ position: target.position, timeout: 3000 }).catch(() => {});
    }

    await page.waitForTimeout(1000);
    probe = await markFacebookCommentLike(page, commentId);
  }

  return probe;
}

/**
 * Igual que markFacebookCommentLike pero marcando el botón de responder.
 *
 * Comparte con aquella la parte difícil —ubicar el comentario por su
 * `comment_id`, que puede venir escapado o en base64, y subir a su contenedor—
 * porque es exactamente el mismo problema. Lo que cambia es a qué botón se
 * baja después.
 */
async function markFacebookCommentReply(page: Page, commentId: string): Promise<CommentLikeProbe> {
  await defineEsbuildNameHelper(page);
  return page.evaluate(
    ({ commentId, mark, replyLabels }): CommentLikeProbe => {
      const sameLabel = (value: string, label: string) =>
        value.trim().localeCompare(label, undefined, { sensitivity: "base" }) === 0;
      const matchesAny = (value: string, labels: string[]) =>
        Boolean(value.trim()) && labels.some((label) => sameLabel(value, label));

      for (const marked of Array.from(document.querySelectorAll(`[${mark}]`))) {
        marked.removeAttribute(mark);
      }

      const wantedIds = [commentId];
      const encoded = encodeURIComponent(commentId);
      if (encoded !== commentId) wantedIds.push(encoded);

      const patterns = wantedIds.map(
        (id) => new RegExp(`(^|[?&])(reply_)?comment_id=${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(&|#|$)`),
      );

      const hrefMatches = (href: string) => {
        const variants = [href];
        try {
          const decoded = decodeURIComponent(href);
          if (decoded !== href) variants.push(decoded);
        } catch {
          // href con escapes inválidos: basta con la forma cruda
        }
        return variants.some((variant) => patterns.some((pattern) => pattern.test(variant)));
      };

      const anchors = Array.from(document.querySelectorAll("a[href]")).filter((a) =>
        hrefMatches(a.getAttribute("href") ?? ""),
      );
      if (!anchors.length) {
        const articles = document.querySelectorAll('[role="article"]').length;
        return { status: "not_found", detail: `${articles} comentario(s) renderizado(s) en la página` };
      }

      const article = anchors.map((a) => a.closest('[role="article"]')).find(Boolean);
      if (!article) {
        return {
          status: "no_article",
          detail: `${anchors.length} link(s) con ese id, ninguno dentro de un contenedor de comentario`,
        };
      }

      // Solo los botones de este comentario, no los de sus respuestas anidadas:
      // responderle a una respuesta cuelga la rama del lugar equivocado.
      const buttons = Array.from(article.querySelectorAll('[role="button"]')).filter(
        (button) => button.closest('[role="article"]') === article,
      );

      const labelOf = (el: Element) => el.getAttribute("aria-label") ?? "";
      const textOf = (el: Element) => (el as HTMLElement).innerText || el.textContent || "";
      const replyButton = buttons.find(
        (el) => matchesAny(labelOf(el), replyLabels) || matchesAny(textOf(el), replyLabels),
      );

      if (!replyButton) {
        return {
          status: "no_button",
          detail: `${buttons.length} botón(es) en el comentario, ninguno rotulado como "Responder"`,
        };
      }

      replyButton.setAttribute(mark, "1");
      article.scrollIntoView({ block: "center" });
      return { status: "ready", detail: "" };
    },
    { commentId, mark: FACEBOOK_COMMENT_REPLY_MARK, replyLabels: FACEBOOK_REPLY_LABELS },
  );
}

/** Reintenta abriendo "ver más comentarios", igual que para los likes. */
async function resolveFacebookCommentReply(
  page: Page,
  commentId: string,
  timeoutMs: number,
  ctx: StepContext,
): Promise<CommentLikeProbe> {
  const deadline = Date.now() + timeoutMs;
  let probe = await markFacebookCommentReply(page, commentId);
  let expansions = 0;

  while (probe.status === "not_found" && Date.now() < deadline) {
    await assertNoKnownBlocker(page);

    if (expansions < FACEBOOK_MAX_COMMENT_EXPANSIONS && (await hasVisibleLocator(page, FACEBOOK_MORE_COMMENTS_SELECTOR))) {
      expansions += 1;
      await log(ctx.taskId, "info", `El comentario aún no está cargado; abriendo más comentarios (intento ${expansions}).`);
      const target = await firstClickableLocator(page, FACEBOOK_MORE_COMMENTS_SELECTOR, 3000).catch(() => null);
      if (target) await target.locator.click({ position: target.position, timeout: 3000 }).catch(() => {});
    }

    await page.waitForTimeout(1000);
    probe = await markFacebookCommentReply(page, commentId);
  }

  return probe;
}

function commentProbeError(probe: CommentLikeProbe, commentId: string) {
  const suffix = probe.detail ? ` (${probe.detail})` : "";
  switch (probe.status) {
    case "not_found":
      return `No se encontró el comentario ${commentId} en la página${suffix}. Revisa que el link siga vivo y que el perfil pueda ver la publicación.`;
    case "no_article":
      return `Se encontró el link del comentario ${commentId} pero no su contenedor${suffix}.`;
    case "no_button":
      return `El comentario ${commentId} está en la página pero no expone un botón de "Me gusta" reconocible${suffix}. Suele ser la interfaz del perfil en un idioma que el runner no tiene mapeado.`;
    default:
      return `No se pudo preparar el like del comentario ${commentId}${suffix}.`;
  }
}

async function runStep(page: Page, step: Step, ctx: StepContext) {
  switch (step.action) {
    case "goto":
      if (!step.url) throw new Error("Step 'goto' requiere 'url'");
      await gotoPage(page, step.url, step.ms ?? DEFAULT_GOTO_TIMEOUT_MS, ctx);
      return;
    case "click":
      if (!step.selector) throw new Error("Step 'click' requiere 'selector'");
      {
        const timeoutMs = step.ms ?? DEFAULT_CLICK_TIMEOUT_MS;
        await prepareSelectorTarget(page, step.selector, ctx);
        const selector = await selectorForStep(page, step.selector, ctx);
        try {
          const target = await firstClickableLocator(page, selector, timeoutMs);
          await target.locator.click({ position: target.position, timeout: timeoutMs });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);

          // Una publicación que ya tiene la reacción no muestra el botón de
          // dar like, sino el de quitarla. Eso es la tarea cumplida, no un
          // fallo: reportarlo como error obliga a revisar a mano algo que ya
          // estaba hecho.
          //
          // Se pregunta por el sondeo y no por el selector de "quitar me gusta":
          // ese rótulo lo tiene también cada comentario ya reaccionado por
          // otros, y con él un like que nunca se dio se reportaba como hecho.
          if (ctx.taskType === "like" && (await markFacebookPostLike(page)).status === "already_liked") {
            await log(ctx.taskId, "info", "La publicación ya tenía la reacción puesta; nada que hacer.");
            return;
          }

          const pointerBlocked = /ninguno recibe el puntero|intercepts pointer events/i.test(message);

          // La caja de comentario visible pero cubierta. Alcanza con enfocarla:
          // el paso `type` que viene después escribe con el teclado, que no
          // necesita el puntero, y su propio click ya va con catch. Se enfoca
          // en vez de mandar Enter como en el like — acá Enter enviaría un
          // comentario vacío.
          //
          // Antes de rendirse se reintenta destapar: al abrir el panel de
          // comentarios Facebook a veces encima una capa nueva, distinta de la
          // que se cerró para llegar hasta acá.
          if (esTareaDeComentario(ctx.taskType) && pointerBlocked && isFacebookCommentBoxSelector(step.selector)) {
            if (await dismissFacebookOverlays(page, ctx)) {
              const reintento = await firstClickableLocator(page, selector, 3000).catch(() => null);
              if (reintento) {
                await reintento.locator.click({ position: reintento.position, timeout: timeoutMs });
                return;
              }
            }

            await log(
              ctx.taskId,
              "warn",
              "La caja de comentario está visible pero cubierta por otra capa; se la enfoca con teclado y se escribe igual.",
            );
            const fallback = await firstVisibleLocator(page, selector, Math.min(3000, timeoutMs));
            await fallback.focus({ timeout: 3000 });
            return;
          }

          if (ctx.taskType !== "like") throw err;
          if (!pointerBlocked) throw await explicarFalloDeLike(page, message);

          await log(
            ctx.taskId,
            "warn",
            "El botón de like está visible pero cubierto por otra capa; se intenta activarlo con teclado.",
          );
          const fallback = await firstVisibleLocator(page, selector, Math.min(3000, timeoutMs));
          await fallback.focus({ timeout: 3000 });
          await page.keyboard.press("Enter");
          await page.waitForTimeout(700);
        }
      }
      return;
    case "replyComment": {
      const commentId = step.commentId?.trim();
      const texto = step.value?.trim();
      if (!commentId) throw new Error("Step 'replyComment' requiere 'commentId'");
      if (!texto) throw new Error("Step 'replyComment' requiere 'value' con el texto de la respuesta");

      const timeoutMs = step.ms ?? DEFAULT_ACTION_TIMEOUT_MS;
      const probe = await resolveFacebookCommentReply(page, commentId, timeoutMs, ctx);
      if (probe.status !== "ready") {
        throw new Error(commentProbeError(probe, commentId).replace('"Me gusta"', '"Responder"'));
      }

      const marcado = `[${FACEBOOK_COMMENT_REPLY_MARK}]`;
      const boton = await firstClickableLocator(page, marcado, DEFAULT_CLICK_TIMEOUT_MS);
      await boton.locator.click({ position: boton.position, timeout: DEFAULT_CLICK_TIMEOUT_MS });
      await page.waitForTimeout(1200);

      // Facebook suele dejar el cursor dentro de la caja de respuesta apenas se
      // abre. Se prefiere igual el selector —es más explícito y deja el error
      // claro si algo cambió— y solo se cae al teclado cuando no aparece, que
      // pasa cuando la caja está tapada por alguna capa.
      const caja = await firstVisibleLocator(page, FACEBOOK_REPLY_BOX_SELECTOR, 12000).catch(() => null);
      if (caja) {
        await escribirEnCaja(page, caja, texto, ctx);
        await page.waitForTimeout(500);
        await caja.press("Enter", { timeout: timeoutMs });
      } else {
        const enfocada = await page
          .evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            return Boolean(el && (el.isContentEditable || el.getAttribute("role") === "textbox"));
          })
          .catch(() => false);

        if (!enfocada) {
          throw new Error(
            `Se abrió "Responder" en el comentario ${commentId} pero no apareció la caja de respuesta. ` +
              `Botones visibles: ${await describeVisibleButtons(page)}`,
          );
        }

        await log(ctx.taskId, "warn", "La caja de respuesta no matcheó ningún selector; se escribe sobre el foco actual.");
        await page.keyboard.insertText(texto);
        await page.waitForTimeout(800);
        await page.keyboard.press("Enter");
      }

      await page.waitForTimeout(1500);

      // Misma verificación que para un comentario suelto: sin esto la respuesta
      // se daría por puesta apenas se termina de teclear.
      const publicada = await waitForPublishedComment(page, texto, timeoutMs);
      if (!publicada.encontrado) {
        throw new Error(
          "La respuesta no apareció en el hilo después de enviarla. Puede que Facebook la haya descartado, " +
            "que el perfil esté limitado, o que el comentario ya no acepte respuestas.",
        );
      }

      ctx.onResult?.({ url: publicada.url, perfilUrl: publicada.perfilUrl });
      await log(
        ctx.taskId,
        "info",
        publicada.url
          ? `Respuesta publicada y verificada: ${publicada.url}`
          : "Respuesta publicada y verificada (Facebook no le dio enlace propio).",
      );
      return;
    }
    case "captureComment": {
      const texto = step.value?.trim();
      if (!texto) throw new Error("Step 'captureComment' requiere 'value' con el texto publicado");

      const probe = await waitForPublishedComment(page, texto, step.ms ?? DEFAULT_ACTION_TIMEOUT_MS);
      if (!probe.encontrado) {
        throw new Error(
          "El comentario no apareció en la publicación después de enviarlo. Puede que Facebook lo haya " +
            "descartado, que el perfil esté limitado, o que la publicación no permita comentar.",
        );
      }

      // Encontrar el comentario no alcanza: hay que confirmar que quedó en la
      // publicación pedida. Sin esto, un comentario publicado en el reel al que
      // el visor derivó daba la tarea por EXITOSA — el error más caro posible,
      // porque no deja rastro de que algo salió mal.
      if (ctx.targetUrl && probe.url && rutaDePublicacion(probe.url) !== rutaDePublicacion(ctx.targetUrl)) {
        throw new Error(
          `El comentario se publicó en otra publicación (${probe.url}) en vez de la pedida. El visor se movió ` +
            `durante la tarea. Hay que borrarlo a mano.`,
        );
      }

      ctx.onResult?.({ url: probe.url, perfilUrl: probe.perfilUrl });

      // Lo que se verifica es que el comentario esté. El permalink es un
      // extra: en el panel de un reel Facebook a veces no le da enlace propio,
      // y quedarse sin él no es motivo para dar la tarea por fallida.
      await log(
        ctx.taskId,
        "info",
        probe.url
          ? `Comentario publicado y verificado: ${probe.url}`
          : "Comentario publicado y verificado (Facebook no le dio enlace propio).",
      );
      return;
    }
    case "likeComment": {
      const commentId = step.commentId?.trim();
      if (!commentId) throw new Error("Step 'likeComment' requiere 'commentId'");

      const timeoutMs = step.ms ?? DEFAULT_ACTION_TIMEOUT_MS;
      const probe = await resolveFacebookCommentLike(page, commentId, timeoutMs, ctx);

      // Volver a clickear un "Me gusta" ya puesto lo quita: si el comentario
      // ya trae la reacción, la tarea está cumplida y no se toca nada.
      if (probe.status === "already_liked") {
        await log(ctx.taskId, "info", "El comentario ya tenía la reacción puesta; nada que hacer.");
        return;
      }
      if (probe.status !== "ready") throw new Error(commentProbeError(probe, commentId));

      const markedSelector = `[${FACEBOOK_COMMENT_LIKE_MARK}]`;
      const target = await firstClickableLocator(page, markedSelector, DEFAULT_CLICK_TIMEOUT_MS);

      if (step.reactionSelector) {
        await target.locator.hover({ position: target.position, timeout: DEFAULT_CLICK_TIMEOUT_MS });
        await page.waitForTimeout(800);
        const reaction = await firstClickableLocator(page, step.reactionSelector, 5000);
        await reaction.locator.click({ position: reaction.position, timeout: DEFAULT_CLICK_TIMEOUT_MS });
        return;
      }

      try {
        await target.locator.click({ position: target.position, timeout: DEFAULT_CLICK_TIMEOUT_MS });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!/intercepts pointer events/i.test(message)) throw err;

        await log(
          ctx.taskId,
          "warn",
          "El botón de like del comentario está cubierto por otra capa; se intenta activarlo con teclado.",
        );
        await target.locator.focus({ timeout: 3000 });
        await page.keyboard.press("Enter");
        await page.waitForTimeout(700);
      }
      return;
    }
    case "hover":
      // Dispara el picker de reacciones de Facebook (aparece al mantener el
      // cursor sobre el botón de "Me gusta" en vez de clickearlo directo).
      // Usa firstClickableLocator (igual que "click") en vez de
      // firstVisibleLocator: un post abierto en dialog suele tener la barra
      // de reacciones fuera del scroll interno del modal, y isVisible() no
      // detecta eso — hacía falta el scrollIntoViewIfNeeded + validación de
      // "recibe el puntero" que ya tiene firstClickableLocator.
      if (!step.selector) throw new Error("Step 'hover' requiere 'selector'");
      {
        const timeoutMs = step.ms ?? DEFAULT_ACTION_TIMEOUT_MS;
        await prepareSelectorTarget(page, step.selector, ctx);
        const selector = await selectorForStep(page, step.selector, ctx);
        const target = await firstClickableLocator(page, selector, timeoutMs);
        await target.locator.hover({ position: target.position, timeout: timeoutMs });
      }
      return;
    case "fill":
      if (!step.selector) throw new Error("Step 'fill' requiere 'selector'");
      {
        await prepareSelectorTarget(page, step.selector, ctx);
        const selector = await selectorForStep(page, step.selector, ctx);
        const target = await firstVisibleLocator(page, selector, step.ms ?? DEFAULT_ACTION_TIMEOUT_MS);
        await target.fill(step.value ?? "", { timeout: step.ms ?? DEFAULT_ACTION_TIMEOUT_MS });
      }
      return;
    case "type":
      if (!step.selector) throw new Error("Step 'type' requiere 'selector'");
      {
        await prepareSelectorTarget(page, step.selector, ctx);
        const selector = await selectorForStep(page, step.selector, ctx);
        const target = await firstVisibleLocator(page, selector, step.ms ?? DEFAULT_ACTION_TIMEOUT_MS);

        // Solo la caja de comentario pasa por la escritura verificada: es la
        // que se re-renderiza mientras uno tipea. En un formulario común
        // conviene seguir mandando teclas de verdad, que es lo que esperan sus
        // validaciones al vuelo.
        if (esTareaDeComentario(ctx.taskType) && isFacebookCommentBoxSelector(step.selector)) {
          await escribirEnCaja(page, target, step.value ?? "", ctx);
        } else {
          await target.click({ timeout: 5000 }).catch(() => {});
          await target.type(step.value ?? "", { delay: 60, timeout: step.ms ?? DEFAULT_ACTION_TIMEOUT_MS });
        }
      }
      return;
    case "press":
      if (!step.key) throw new Error("Step 'press' requiere 'key'");
      // Enviar es el punto de no retorno: si el visor derivó mientras se
      // escribía, el texto está en la caja de otra publicación y presionar
      // Enter lo publica ahí.
      if (esTareaDeComentario(ctx.taskType)) await assertOnTargetUrl(page, ctx);
      if (step.selector) {
        await prepareSelectorTarget(page, step.selector, ctx);
        const selector = await selectorForStep(page, step.selector, ctx);
        const target = await firstVisibleLocator(page, selector, step.ms ?? DEFAULT_ACTION_TIMEOUT_MS);
        await target.press(step.key, { timeout: step.ms ?? DEFAULT_ACTION_TIMEOUT_MS });
      } else {
        await page.keyboard.press(step.key);
      }
      return;
    case "waitForSelector":
      if (!step.selector) throw new Error("Step 'waitForSelector' requiere 'selector'");
      {
        await prepareSelectorTarget(page, step.selector, ctx);
        const selector = await selectorForStep(page, step.selector, ctx);
        try {
          await firstVisibleLocator(page, selector, step.ms ?? DEFAULT_ACTION_TIMEOUT_MS);
        } catch (err) {
          if (ctx.taskType !== "like" || !isFacebookLikeSelector(step.selector)) throw err;

          // Una publicación que ya tiene la reacción no muestra el botón de
          // ponerla, así que este paso no puede pasar nunca: lo que hay es el
          // de quitarla. Es la tarea cumplida, no un fallo — se deja seguir y
          // el "click" que viene después lo reconoce igual y sale por éxito.
          if ((await markFacebookPostLike(page)).status === "already_liked") {
            await log(ctx.taskId, "info", "La publicación ya tenía la reacción puesta; nada que esperar.");
            return;
          }

          throw await explicarFalloDeLike(page, err instanceof Error ? err.message : String(err));
        }
      }
      return;
    case "waitForTimeout":
      await page.waitForTimeout(step.ms ?? 1000);
      await assertNoKnownBlocker(page);
      return;
    case "scroll":
      await page.mouse.wheel(0, step.ms ?? 800);
      return;
    case "uploadFile":
      if (!step.selector) throw new Error("Step 'uploadFile' requiere 'selector'");
      if (!step.value) throw new Error("Step 'uploadFile' requiere 'value' (ruta del archivo)");
      await page.setInputFiles(step.selector, step.value);
      return;
    case "screenshot": {
      await mkdir("./screenshots", { recursive: true });
      const safeProfileName = ctx.profileName.replace(/[^a-z0-9-_]+/gi, "_");
      await page.screenshot({ path: `./screenshots/${ctx.taskId}_${safeProfileName}_${Date.now()}.png` });
      return;
    }
    default:
      throw new Error(`Acción desconocida: ${(step as Step).action}`);
  }
}

async function log(taskId: string, level: "info" | "warn" | "error", message: string) {
  await TaskLogModel.create({ taskId, level, message });
}

async function captureFailureScreenshot(page: Page | undefined, taskId: string, profileName: string) {
  if (!page) return;
  await mkdir("./screenshots/errors", { recursive: true });
  const safeProfileName = profileName.replace(/[^a-z0-9-_]+/gi, "_");
  const path = `./screenshots/errors/${taskId}_${safeProfileName}_${Date.now()}.png`;
  await page.screenshot({ path, fullPage: false });
  await log(taskId, "info", `Screenshot de fallo guardado en ${path}`);
}

/**
 * Ejecuta una tarea de principio a fin: abre el perfil en AdsPower,
 * corre cada step contra la página y cierra el navegador al terminar
 * (éxito o error).
 */
/**
 * Rellena en los steps del hijo el comentario que publicó su padre.
 *
 * Devuelve `null` si quedó todo resuelto, o el motivo por el que la rama no se
 * puede colgar. Ese motivo cancela la tarea en vez de dejarla fallar: no es que
 * la automatización se haya roto, es que no hay comentario al que responder.
 *
 * El caso más común de cancelación no es que el padre falle sino que Facebook
 * no le dé enlace propio a su comentario — pasa seguido en los reels. Sin
 * `comment_id` no hay a qué apuntar, y adivinar sería responderle al comentario
 * de otro.
 */
async function resolverPasosDelHijo(task: InstanceType<typeof TaskModel>): Promise<string | null> {
  const padre = await TaskModel.findById(task.parentTaskId);
  if (!padre) return "La tarea del comentario padre ya no existe.";
  if (padre.status !== "success") {
    return `El comentario padre no se publicó (quedó en "${padre.status}"), así que no hay a qué responder.`;
  }
  if (!padre.resultUrl) {
    return (
      "El comentario padre se publicó pero Facebook no le dio un enlace propio, así que no se puede " +
      "identificar para responderle. Suele pasar en reels."
    );
  }

  const target = parseFacebookCommentTarget(padre.resultUrl);
  if (!target) return `El enlace del comentario padre no trae comment_id (${padre.resultUrl}).`;

  for (const step of task.steps as Step[]) {
    if (!step.fromParent) continue;
    if (step.action === "goto") step.url = padre.resultUrl;
    else step.commentId = target.commentId;
  }
  task.markModified("steps");

  return null;
}

/**
 * Abre o cierra las ramas que dependen de esta tarea.
 *
 * Los hijos nacen en "pending" justamente para que nadie los tome antes de
 * tiempo: la cola solo mira "queued". Al terminar el padre pasan a la cola, o
 * se cancelan con el motivo si no hay comentario al que colgarse.
 */
async function resolverRamasDe(task: InstanceType<typeof TaskModel>) {
  const pendientes = await TaskModel.find({ parentTaskId: task._id, status: "pending" }).sort({ scheduledAt: 1 });
  const hijos = pendientes.length;
  if (!hijos) return;

  if (task.status === "success" && task.resultUrl) {
    // Se reprograman desde ahora conservando la separación original entre
    // ramas. Sus horarios se fijaron al crear la campaña, contando que el
    // padre tardaría poco; si tardó más que eso —y publicar un comentario
    // puede llevar minutos— ya habrían vencido todos y las ramas saldrían una
    // atrás de otra, que es justo lo que el escalonado viene a evitar.
    const base = pendientes[0].scheduledAt?.getTime() ?? Date.now();
    const ahora = Date.now();
    for (const hijo of pendientes) {
      hijo.status = "queued";
      hijo.scheduledAt = new Date(ahora + ((hijo.scheduledAt?.getTime() ?? base) - base));
      await hijo.save();
    }
    await log(String(task._id), "info", `Comentario padre listo: ${hijos} rama(s) hija(s) pasan a la cola.`);
    return;
  }

  const motivo =
    task.status === "success"
      ? "El comentario padre se publicó pero sin enlace propio, así que no se le pueden colgar ramas."
      : `El comentario padre terminó en "${task.status}".`;

  await TaskModel.updateMany(
    { parentTaskId: task._id, status: "pending" },
    { $set: { status: "cancelled", error: motivo, finishedAt: new Date() } },
  );
  await log(String(task._id), "warn", `${hijos} rama(s) hija(s) cancelada(s): ${motivo}`);
}

export async function runTask(taskId: string) {
  await dbConnect();
  const task = await TaskModel.findById(taskId);
  if (!task) throw new Error(`Task ${taskId} no encontrada`);

  const profile = await ProfileModel.findById(task.profileId);
  if (!profile) throw new Error(`Profile ${task.profileId} no encontrado`);

  // Ramificaciones: los steps de un hijo apuntan al comentario que publicó su
  // padre, que al crear la campaña todavía no existía. Se resuelve acá, contra
  // el permalink que el padre guardó al verificarse.
  if (task.parentTaskId) {
    const motivo = await resolverPasosDelHijo(task);
    if (motivo) {
      task.status = "cancelled";
      task.error = motivo;
      task.finishedAt = new Date();
      await task.save();
      await log(taskId, "error", motivo);
      return task;
    }
  }

  task.status = "running";
  task.startedAt = new Date();
  await task.save();
  await log(taskId, "info", `Iniciando tarea "${task.name}" en perfil ${profile.name}`);

  // La publicación de la tarea: a dónde volver si el navegador se va a otra
  // mientras la tarea trabaja. Arranca siendo la que pidió la campaña y se
  // reemplaza por la que quedó de verdad apenas se navega — ver el bucle de
  // steps.
  let targetUrl = (task.steps as Step[]).find((s) => s.action === "goto" && s.url)?.url;

  let browser;
  let page: Page | undefined;
  try {
    const connection = await connectToProfile(profile.adsPowerProfileId);
    browser = connection.browser;
    page = connection.page;

    for (const [i, step] of task.steps.entries()) {
      const s = step as Step;
      await log(taskId, "info", `Step ${i + 1}/${task.steps.length}: ${s.action}${s.optional ? " (opcional)" : ""}`);
      try {
        await runStep(page, s, {
          taskId,
          profileName: profile.name,
          taskType: task.type,
          targetUrl,
          onResult: ({ url, perfilUrl }) => {
            if (url) task.resultUrl = url;
            if (perfilUrl) task.resultProfileUrl = perfilUrl;
          },
        });

        // Después de navegar manda la URL que quedó, no la que se pidió.
        // Facebook reescribe los enlaces —los de "compartir" a la forma
        // canónica del post, y le agrega un `?rdid=` al redirigir—, y comparar
        // contra la pedida daba por deriva lo que era la misma publicación de
        // siempre: la tarea se abortaba con el comentario ya escrito.
        if (s.action === "goto") targetUrl = page.url();
      } catch (err) {
        if (!s.optional) throw err;
        const message = err instanceof Error ? err.message : String(err);
        await log(taskId, "warn", `Step opcional ${i + 1} no aplicó, se continúa: ${message}`);
      }
    }

    task.status = "success";
    await log(taskId, "info", "Tarea completada con éxito");
  } catch (err) {
    task.status = "failed";
    task.error = err instanceof Error ? err.message : String(err);
    await log(taskId, "error", task.error);
    await captureFailureScreenshot(page, taskId, profile.name).catch((screenshotErr) =>
      log(
        taskId,
        "warn",
        `No se pudo guardar screenshot de fallo: ${
          screenshotErr instanceof Error ? screenshotErr.message : String(screenshotErr)
        }`,
      ),
    );
  } finally {
    task.finishedAt = new Date();
    await task.save();
    // Después de guardar el estado definitivo: las ramas se abren o se cierran
    // según cómo haya terminado el padre.
    await resolverRamasDe(task).catch((err) =>
      log(taskId, "warn", `No se pudieron resolver las ramas hijas: ${err instanceof Error ? err.message : String(err)}`),
    );
    if (browser) await disconnectProfile(browser, profile.adsPowerProfileId);
  }

  return task;
}
