/**
 * La forma canónica del grupo: `https://www.facebook.com/groups/<id o alias>/`.
 *
 * Se descarta todo lo que venga después del id (`/posts/...`, `?ref=share`)
 * porque la tarea necesita el encabezado del grupo, que es donde está el botón
 * de unirse, y porque así dos links distintos al mismo grupo se reconocen como
 * el mismo al buscar perfiles que ya lo pidieron.
 */
export function grupoCanonico(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (!/(^|\.)facebook\.com$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/groups\/([^/?#]+)/i);
    if (!m) return null;
    return `https://www.facebook.com/groups/${m[1]}/`;
  } catch {
    return null;
  }
}

/**
 * Las tareas que cuentan como "este perfil ya está (o va a estar) en el
 * grupo": las que terminaron bien y las que siguen en curso. Las fallidas y
 * canceladas no, para que se puedan reintentar.
 */
export const JOIN_ACTIVE_STATUSES = ["pending", "queued", "running", "paused", "success"] as const;

/** Qué dejó Facebook al terminar la tarea. Ver unirseAlGrupo(). */
export const JOIN_STATES = ["joined", "pending", "already_member", "already_pending"] as const;
export type JoinState = (typeof JOIN_STATES)[number];
