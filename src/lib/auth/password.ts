import { randomBytes, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";

// scrypt viene en Node y es una KDF con costo de memoria: sirve exactamente
// igual que bcrypt para esto y evita sumar una dependencia nativa (que además
// habría que recompilar en el VPS en cada actualización de Node).
//
// Este módulo usa `node:crypto`, así que solo puede importarse desde código que
// corra en Node — route handlers y scripts, nunca desde proxy.ts.
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const SCHEME = "scrypt";

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scryptAsync(plain, salt, KEY_LENGTH);
  return `${SCHEME}$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== SCHEME || !salt || !hash) return false;

  const derived = await scryptAsync(plain, salt, KEY_LENGTH);
  const expected = Buffer.from(hash, "hex");
  // timingSafeEqual tira si los largos difieren, así que se compara antes.
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

/** Requisito mínimo, aplicado tanto al alta como al cambio de contraseña. */
export const MIN_PASSWORD_LENGTH = 10;

export function passwordProblem(plain: string): string | null {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`;
  }
  return null;
}
