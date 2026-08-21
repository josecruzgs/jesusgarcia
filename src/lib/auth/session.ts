// Sesión en una cookie firmada, sin estado en el servidor.
//
// El valor es `userId.expiración.firma`, donde la firma es un HMAC-SHA256 del
// resto sobre SESSION_SECRET. Nadie puede fabricarla ni estirarle el
// vencimiento sin conocer el secreto, y verificarla no cuesta una consulta a
// Mongo — importante porque proxy.ts la revisa en CADA request.
//
// Usa WebCrypto a propósito (no `node:crypto`): este módulo lo importa
// proxy.ts, que corre en el runtime Edge, donde `node:crypto` no existe.

export const SESSION_COOKIE = "godeye_session";

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type SessionPayload = { userId: string; expiresAt: number };

// importKey es asíncrono y se llamaría en cada request; se memoiza contra el
// secreto para que rotarlo no siga usando la clave vieja.
let cachedKey: { secret: string; key: CryptoKey } | null = null;

async function hmacKey(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET no está definido. Revisa tu .env.local");
  }
  if (cachedKey?.secret === secret) return cachedKey.key;

  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  cachedKey = { secret, key };
  return key;
}

async function sign(data: string): Promise<string> {
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    await hmacKey(),
    new TextEncoder().encode(data),
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Comparación de tiempo constante; `timingSafeEqual` no existe en Edge. */
function sameSignature(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(userId: string, now = Date.now()): Promise<string> {
  const expiresAt = now + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = `${userId}.${expiresAt}`;
  return `${payload}.${await sign(payload)}`;
}

/** Devuelve el payload si la firma es válida y no venció; si no, null. */
export async function readSessionToken(
  token: string | undefined,
  now = Date.now(),
): Promise<SessionPayload | null> {
  if (!token) return null;

  const [userId, rawExpiry, signature] = token.split(".");
  if (!userId || !rawExpiry || !signature) return null;

  const expiresAt = Number(rawExpiry);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;

  const expected = await sign(`${userId}.${rawExpiry}`);
  if (!sameSignature(signature, expected)) return null;

  return { userId, expiresAt };
}

/** Opciones de la cookie, iguales al setearla y al borrarla. */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
} as const;
