/**
 * Los selectores con los que el runner encuentra el botón de reacción y la
 * caja de comentario de cada red.
 *
 * Viven acá y no en cada página porque son la parte más frágil del sistema —
 * Facebook les cambia el árbol cada tanto— y estaban copiados en tres wizards
 * distintos. Con tres copias, arreglar uno dejaba los otros dos rotos y el
 * síntoma era una tarea que termina en "success" sin haber hecho nada.
 *
 * Cada `aria-label` trae español e inglés juntos: el perfil de AdsPower hereda
 * el idioma de su huella, así que la misma cuenta puede aparecer en cualquiera
 * de los dos. La lista separada por comas SÍ funciona como OR en selectores de
 * atributo CSS planos (a diferencia del engine `text=` de Playwright).
 */

export function selectorForAriaLabels(labels: string[]): string {
  return labels
    .flatMap((label) => [
      `div[role="dialog"] [aria-label="${label}"]`,
      `[role="button"][aria-label="${label}"]`,
      `div[role="button"]:has(svg[aria-label="${label}"])`,
      `svg[aria-label="${label}"]`,
      `[aria-label="${label}"]`,
    ])
    .join(", ");
}

// Facebook no monta siempre el botón de reacción en el mismo árbol: algunos
// permalinks lo dejan dentro del dialog y otros links de foto/post lo exponen
// en la página. El runner escoge el match visible antes de clickear/hover.
export const FACEBOOK_REACTION_TRIGGER_SELECTOR = selectorForAriaLabels([
  "Like",
  "Me gusta",
  "React",
  "Reaccionar",
  "Reacciona",
]);

export const FACEBOOK_COMMENT_BOX_SELECTOR = [
  'div[role="textbox"][contenteditable="true"][aria-label*="Write a comment"]',
  'div[role="textbox"][contenteditable="true"][aria-label*="Escribe un comentario"]',
  'div[role="textbox"][contenteditable="true"][aria-placeholder*="Write a comment"]',
  'div[role="textbox"][contenteditable="true"][aria-placeholder*="Escribe un comentario"]',
  'div[aria-label*="Write a comment"]',
  'div[aria-label*="Escribe un comentario"]',
  'form div[role="textbox"][contenteditable="true"]',
].join(", ");

/** Presets del botón de reacción, por plataforma. */
export const REACTION_PRESETS: Record<string, { label: string; selector: string }> = {
  facebook: { label: "Facebook", selector: FACEBOOK_REACTION_TRIGGER_SELECTOR },
  instagram: { label: "Instagram", selector: 'svg[aria-label="Like"], svg[aria-label="Me gusta"]' },
  tiktok: { label: "TikTok", selector: '[data-e2e="like-icon"]' },
  x: { label: "X / Twitter", selector: '[data-testid="like"]' },
  custom: { label: "Personalizado", selector: "" },
};

export type CommentPreset = {
  label: string;
  selector: string;
  submitMethod: "enter" | "button";
  submitSelector: string;
};

/** Presets de la caja de comentario y de cómo se envía, por plataforma. */
export const COMMENT_PRESETS: Record<string, CommentPreset> = {
  facebook: {
    label: "Facebook",
    selector: FACEBOOK_COMMENT_BOX_SELECTOR,
    submitMethod: "enter",
    submitSelector: "",
  },
  instagram: {
    label: "Instagram",
    selector: 'textarea[aria-label="Add a comment…"], textarea[aria-label="Añade un comentario..."]',
    submitMethod: "enter",
    submitSelector: "",
  },
  tiktok: {
    label: "TikTok",
    selector: '[data-e2e="comment-input"]',
    submitMethod: "button",
    submitSelector: '[data-e2e="comment-post"]',
  },
  x: {
    label: "X / Twitter",
    selector: '[data-testid="tweetTextarea_0"]',
    submitMethod: "button",
    submitSelector: '[data-testid="tweetButtonInline"]',
  },
  custom: { label: "Personalizado", selector: "", submitMethod: "enter", submitSelector: "" },
};

// El picker de reacciones (mantener el cursor sobre "Me gusta" para que
// aparezcan las demás) es un patrón exclusivo de Facebook — las otras
// plataformas solo tienen like/no-like.
export const REACTIONS: { key: string; label: string; ariaLabels?: string[] }[] = [
  { key: "like", label: "👍 Me gusta (default)" },
  { key: "love", label: "❤️ Me encanta", ariaLabels: ["Me encanta", "Love"] },
  { key: "care", label: "🤗 Me importa", ariaLabels: ["Me importa", "Care"] },
  { key: "haha", label: "😆 Me divierte", ariaLabels: ["Me divierte", "Haha"] },
  { key: "wow", label: "😮 Me asombra", ariaLabels: ["Me asombra", "Wow"] },
  { key: "sad", label: "😢 Me entristece", ariaLabels: ["Me entristece", "Sad"] },
  { key: "angry", label: "😡 Me enoja", ariaLabels: ["Me enoja", "Angry"] },
];

/** Vacío para "like": ese no abre el picker, se clickea el botón directo. */
export function reactionSelectorFor(key: string): string {
  const reaction = REACTIONS.find((r) => r.key === key);
  if (!reaction?.ariaLabels) return "";
  return selectorForAriaLabels(reaction.ariaLabels);
}

/**
 * A qué red pertenece una URL. `null` cuando es una nota de prensa o un medio
 * cualquiera: ahí no hay nada que likear ni comentar con un perfil.
 */
export function platformFromUrl(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }

  if (host.endsWith("facebook.com") || host === "fb.com" || host === "fb.watch") return "facebook";
  if (host.endsWith("instagram.com")) return "instagram";
  if (host.endsWith("tiktok.com")) return "tiktok";
  if (host === "x.com" || host.endsWith("twitter.com")) return "x";
  return null;
}
