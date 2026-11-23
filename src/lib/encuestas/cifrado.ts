import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

/**
 * LOS DATOS PERSONALES DE LA BASE, CIFRADOS.
 *
 * Teléfono, nombre y colonia se guardan en Mongo cifrados con AES-256-GCM. Quien entre a Atlas o tenga un respaldo ve
 * texto cifrado, no personas. La llave sale de ENCUESTAS_CLAVE, que vive solo en el .env.local del servidor: sin ella
 * no se puede leer nada, ni siquiera desde el panel. Si se pierde, la base se pierde con ella; respaldarla aparte.
 *
 * El número no se puede buscar cifrado (cada cifrado sale distinto), así que además se guarda su HUELLA: un HMAC con
 * otra llave derivada de la misma. Con la huella se evitan duplicados, se respeta a quien pidió que no le llamen y se
 * liga cada llamada de ElevenLabs con su contacto, sin guardar el número en claro.
 *
 * El límite, dicho tal cual: para marcar, el servidor tiene que descifrar el número y mandárselo a ElevenLabs. Quien
 * administra el servidor y tiene la llave podría leerlo; lo que esto garantiza es que no se lea desde el panel ni desde
 * la base de datos.
 */
const VERSION = "c1";

/** Si hay llave para cifrar la base. Sin ella se avisa en pantalla en vez de tronar al subir o llamar. */
export const hayClaveDeBase = () => (process.env.ENCUESTAS_CLAVE ?? "").length >= 32;
export const FALTA_CLAVE = "Falta ENCUESTAS_CLAVE en el .env.local (32 caracteres o más): sin ella no se puede cifrar la base de teléfonos.";

let llaves: { cifrar: Buffer; huella: Buffer } | null = null;
function llave() {
  if (llaves) return llaves;
  const crudo = process.env.ENCUESTAS_CLAVE ?? "";
  if (crudo.length < 32) throw new Error(FALTA_CLAVE);
  const deriva = (uso: string) => Buffer.from(hkdfSync("sha256", crudo, "godeye-encuestas", uso, 32));
  llaves = { cifrar: deriva("cifrar"), huella: deriva("huella") };
  return llaves;
}

export function cifrar(texto: string | null | undefined): string | null {
  if (texto === null || texto === undefined || texto === "") return null;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", llave().cifrar, iv);
  const datos = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return [VERSION, iv.toString("base64url"), c.getAuthTag().toString("base64url"), datos.toString("base64url")].join(":");
}

/** Lo que no se pueda descifrar (otra llave, texto dañado) sale como null en vez de tumbar la página. */
export function descifrar(guardado: string | null | undefined): string | null {
  if (!guardado) return null;
  const [v, iv, tag, datos] = guardado.split(":");
  if (v !== VERSION || !iv || !tag || datos === undefined) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", llave().cifrar, Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(datos, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** La huella de un celular de 10 dígitos. Empieza con «h1:» para no confundirla nunca con un número en claro. */
export function huella(diez: string): string {
  const t = diez.replace(/\D/g, "").slice(-10);
  return "h1:" + createHmac("sha256", llave().huella).update(t).digest("base64url");
}

export const esHuella = (x: string | null | undefined) => !!x?.startsWith("h1:");
/** Los últimos 4 dígitos: bastan para distinguir una llamada de otra sin exponer a la persona. */
export const finDe = (diez: string) => diez.replace(/\D/g, "").slice(-4);

/** Cómo se guarda el número en una llamada: completo solo si es de prueba (el celular del propio equipo). */
export function telefonoDeLlamada(diez: string | null, prueba: boolean) {
  if (!diez) return { telefono: null, huella: null, telFin: null };
  return { telefono: prueba ? diez : null, huella: huella(diez), telFin: finDe(diez) };
}
