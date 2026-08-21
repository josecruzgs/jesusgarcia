/**
 * Límite de intentos por IP, en memoria del proceso.
 *
 * Existe para el login: sin freno se puede probar el diccionario entero contra
 * una cuenta en minutos. En local daba igual —nadie más llega a localhost—,
 * pero en un VPS público el login es la única puerta del panel.
 *
 * En memoria y no en Mongo a propósito: el objetivo es frenar la fuerza bruta,
 * no llevar una auditoría, y una consulta a la base por cada intento sería un
 * amplificador de carga en vez de una defensa. Se pierde al reiniciar, que es
 * un costo aceptable frente a la complejidad de coordinarlo entre procesos.
 */

type Window = { hits: number[]; blockedUntil?: number };

const windows = new Map<string, Window>();

/** Sin esto, un atacante rotando IPs haría crecer el mapa sin techo. */
const MAX_TRACKED = 5_000;

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSec: number };

export function rateLimit(
  key: string,
  { limit, windowMs, blockMs }: { limit: number; windowMs: number; blockMs: number },
): RateLimitResult {
  const now = Date.now();
  const entry = windows.get(key) ?? { hits: [] };

  if (entry.blockedUntil && entry.blockedUntil > now) {
    return { ok: false, retryAfterSec: Math.ceil((entry.blockedUntil - now) / 1000) };
  }

  entry.hits = entry.hits.filter((t) => now - t < windowMs);
  entry.hits.push(now);

  if (entry.hits.length > limit) {
    entry.blockedUntil = now + blockMs;
    entry.hits = [];
    windows.set(key, entry);
    return { ok: false, retryAfterSec: Math.ceil(blockMs / 1000) };
  }

  if (windows.size > MAX_TRACKED) {
    for (const [k, v] of windows) {
      const idle = v.blockedUntil ? v.blockedUntil < now : v.hits.every((t) => now - t >= windowMs);
      if (idle) windows.delete(k);
    }
  }

  windows.set(key, entry);
  return { ok: true };
}

/** Limpia el registro de una IP — se llama cuando el intento fue correcto. */
export function rateLimitReset(key: string) {
  windows.delete(key);
}

/**
 * IP del cliente. Detrás de Nginx la conexión siempre viene de 127.0.0.1, así
 * que el dato real está en `x-forwarded-for` — que solo es confiable porque el
 * proxy lo reescribe; si la app quedara expuesta directo, cualquiera podría
 * falsificarlo y saltarse el límite cambiándolo en cada intento.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "desconocida";
}
