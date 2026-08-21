/**
 * Dónde mirar la pantalla del servidor.
 *
 * AdsPower es una app de escritorio corriendo contra una pantalla virtual en el
 * VPS (Xvfb en :99, ver sección 6 de DEPLOY.md). x11vnc publica esa pantalla y
 * websockify la sirve por WebSocket junto con noVNC, que es el cliente web.
 *
 * En producción nginx expone ese noVNC en /vnc/ del mismo dominio, con el
 * portero de /api/vnc/authorize delante: mismo origen que el panel, así que la
 * cookie de sesión viaja sola y el marco se puede embeber sin pelear con
 * contenido mixto. Por eso el valor por defecto es una ruta relativa.
 *
 * En una máquina de escritorio no hay nginx: ahí se abre el túnel SSH de
 * DEPLOY.md y se apunta VNC_URL a `http://127.0.0.1:6080/vnc.html?...`.
 *
 * Es una variable de servidor a propósito (nada de NEXT_PUBLIC_): se lee en
 * cada request, así que cambiarla en el .env.local del servidor surte efecto
 * con un reinicio y no exige recompilar.
 */
const DEFAULT_VNC_URL = "/vnc/vnc.html?autoconnect=1&resize=scale&reconnect=1";

/** Donde escucha websockify en el VPS, que es a lo que nginx le pasa /vnc/. */
const LOOPBACK_NOVNC = "http://127.0.0.1:6080/";

export function vncUrl(): string {
  return process.env.VNC_URL?.trim() || DEFAULT_VNC_URL;
}

/** Una URL relativa solo puede funcionar si hay un nginx que sirva /vnc/. */
export function isRelative(url: string): boolean {
  return !/^https?:\/\//i.test(url);
}

/**
 * ¿Hay alguien del otro lado?
 *
 * Sin esto, cuando el visor no está levantado el marco se llena con el 404 de
 * Next o con un error de nginx, que no le dicen a nadie qué hacer. Preguntando
 * antes, la página puede explicar el caso concreto.
 *
 * Se pregunta por el noVNC de atrás y no por la URL del marco: la del marco,
 * cuando es relativa, pasa por el portero de nginx, que a esta consulta —que no
 * lleva la cookie del usuario— le contestaría 401 y haría parecer caído algo
 * que está perfecto.
 */
export async function vncIsUp(url: string): Promise<boolean> {
  const target = isRelative(url) ? LOOPBACK_NOVNC : new URL(url).origin + "/";
  try {
    const res = await fetch(target, { cache: "no-store", signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}
