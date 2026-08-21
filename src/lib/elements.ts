// Los cuatro elementos son la columna vertebral del producto: cada módulo
// pertenece a uno y hereda su ícono y su lema.
//
// Lo que YA NO heredan es un color propio. Agua, Viento, Tierra y Fuego se
// pintan todos con el acento —el oro de la casa, o el color que el usuario
// haya elegido en /ajustes—, y la sección se reconoce por el ícono, el título
// y qué está marcado en el menú. Los tokens --el-* siguen existiendo en
// globals.css como alias del acento: ahí está el único punto de reversión.
export type ElementKey = "agua" | "viento" | "tierra" | "fuego";

// Color crudo (no clase Tailwind) para degradados, filos de tarjeta y glows
// radiales — se usan directo por style inline, así que necesitan el valor
// real de la variable CSS, no una clase.
export const ELEMENT_COLOR: Record<ElementKey, string> = {
  agua: "var(--el-agua)",
  viento: "var(--el-viento)",
  tierra: "var(--el-tierra)",
  fuego: "var(--el-fuego)",
};

// Nombre, rol y lema de cada elemento — el copy de la sala de inteligencia.
export const ELEMENT_META: Record<ElementKey, { name: string; title: string; lead: string }> = {
  viento: { name: "Viento", title: "Inteligencia y monitoreo", lead: "El viento todo lo observa." },
  agua: { name: "Agua", title: "Narrativa y comunicación", lead: "La marea define el cauce." },
  tierra: { name: "Tierra", title: "Operación territorial", lead: "La fuerza está en el terreno." },
  fuego: { name: "Fuego", title: "Jornada decisiva", lead: "El día decisivo." },
};

// Orden canónico de presentación (viento → agua → tierra → fuego).
export const ELEMENT_ORDER: ElementKey[] = ["viento", "agua", "tierra", "fuego"];

const ELEMENT_PATH_PREFIXES: { prefix: string; key: ElementKey }[] = [
  { prefix: "/campanas", key: "agua" },
  { prefix: "/tasks", key: "agua" },
  { prefix: "/scrapping", key: "viento" },
  { prefix: "/actividades", key: "tierra" },
  { prefix: "/dia-d", key: "fuego" },
];

// Rutas que quedan dentro de un prefijo de arriba pero en realidad viven en
// Recursos (general) — ej. Warmup se movió de Agua a Recursos mientras se
// queda en /tasks/warmup por compatibilidad de URL.
const ELEMENT_PATH_EXCLUSIONS = ["/tasks/warmup"];

// A qué elemento pertenece una ruta (para el fondo de sección), o null si la
// página no pertenece a ningún elemento (Dashboard, Perfiles, Grupos...).
export function getElementForPath(pathname: string): ElementKey | null {
  if (ELEMENT_PATH_EXCLUSIONS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;
  for (const { prefix, key } of ELEMENT_PATH_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return key;
  }
  return null;
}
