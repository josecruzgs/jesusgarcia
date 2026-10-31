/**
 * La plataforma de un link pegado como objetivo de tarea.
 *
 * Sirve para que el formulario elija solo la plataforma y filtre los perfiles:
 * mandar perfiles de Facebook a una tarea de Instagram —o al revés— no falla
 * de forma evidente, la tarea abre la publicación con un perfil sin sesión ahí.
 *
 * Se mira el dominio y no una subcadena del link entero, porque la ruta puede
 * nombrar a otra plataforma ("instagram.com/facebook"). `null` cuando el link
 * todavía no es una URL o es de un sitio que no conocemos.
 */
const DOMINIOS: [string, string[]][] = [
  ["facebook", ["facebook.com", "fb.com", "fb.watch", "fb.me"]],
  ["instagram", ["instagram.com", "instagr.am"]],
  ["tiktok", ["tiktok.com"]],
  ["x", ["x.com", "twitter.com"]],
];

export function platformFromUrl(valor: string): string | null {
  // "facebook.com/..." sin esquema también: así se copia de algunos lados.
  const limpio = valor.trim();
  const conEsquema = /^[a-z][a-z0-9+.-]*:\/\//i.test(limpio) ? limpio : `https://${limpio}`;

  let host: string;
  try {
    host = new URL(conEsquema).hostname.toLowerCase();
  } catch {
    return null;
  }

  for (const [plataforma, dominios] of DOMINIOS) {
    if (dominios.some((d) => host === d || host.endsWith(`.${d}`))) return plataforma;
  }
  return null;
}
