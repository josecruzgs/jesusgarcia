/**
 * La palomita de las etiquetas: el perfil está aprobado.
 *
 * No es una marca del sistema sino una convención de quien administra los
 * perfiles en AdsPower — le pone un ✅ a los que ya probó y sabe que rinden.
 * El panel la respeta en dos lugares: /profiles arranca filtrando por ella, y
 * cualquier lista donde se elijan perfiles para una tarea los pone primero.
 *
 * Se aceptan las cuatro variantes de Unicode porque cada teclado y cada
 * selector de emoji ofrece la suya, y a simple vista son la misma palomita:
 * ✅ (U+2705), ✔ (U+2714), ☑ (U+2611) y ✓ (U+2713).
 */
export const CHECK_TAG_PATTERN = /[✅✔☑✓]/;

/** El nombre de la primera etiqueta con palomita, o "" si no hay ninguna. */
export function findCheckTag(tags: { name: string }[]): string {
  return tags.find((t) => CHECK_TAG_PATTERN.test(t.name))?.name ?? "";
}

/** Si este perfil está aprobado. */
export function hasCheckTag(tags: { name: string }[] | undefined): boolean {
  return (tags ?? []).some((t) => CHECK_TAG_PATTERN.test(t.name));
}
