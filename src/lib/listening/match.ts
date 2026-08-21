import { createHash } from "crypto";
import type { RawMention, EntityTarget } from "./types";

/** Minúsculas y sin acentos: "Peña" y "Pena" tienen que colisionar. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    // \p{Diacritic} en vez del rango literal U+0300–U+036F: el rango escrito
    // con los caracteres combinantes reales sobrevive mal a copiar/pegar y a
    // editores que renormalizan el archivo.
    .replace(/\p{Diacritic}/gu, "");
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Quita los parámetros de tracking antes de hashear. Sin esto, la misma nota
 * compartida con `?utm_source=twitter` y sin él entran como dos menciones
 * distintas, que es el modo más común de inflar los conteos.
 */
const TRACKING_PARAMS = /^(utm_|fbclid|gclid|mc_|ref|ref_src|igshid|si)$/i;

export function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) parsed.searchParams.delete(key);
    }
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

/**
 * Clave de deduplicación. El segundo componente es la clave estable de la
 * figura (`entity.key`), NO su nombre visible: si fuera el nombre, corregirlo
 * cambiaría el hash de todo su historial y la corrida siguiente reingresaría
 * cada nota ya guardada como si fuera nueva.
 */
export function mentionHash(projectId: string, entityKey: string, url: string): string {
  return createHash("sha1").update(`${projectId}|${entityKey}|${canonicalUrl(url)}`).digest("hex");
}

/** ¿El texto nombra realmente al personaje? */
export function mentionsEntity(mention: RawMention, entity: EntityTarget): boolean {
  const haystack = normalize(`${mention.title ?? ""} ${mention.text}`);
  return [entity.name, ...entity.aliases]
    .filter(Boolean)
    .some((phrase) => haystack.includes(normalize(phrase)));
}

export type TextFilters = {
  includeTerms: string[];
  excludeTerms: string[];
  whitelistDomains: string[];
  blacklistDomains: string[];
};

/**
 * Un dominio de la lista matchea también sus subdominios: "eluniversal.com.mx"
 * cubre "deportes.eluniversal.com.mx". Sin eso, cada whitelist habría que
 * escribirla subdominio por subdominio.
 */
function domainMatches(domain: string, list: string[]): boolean {
  const d = domain.toLowerCase();
  return list.some((raw) => {
    const entry = raw.trim().replace(/^www\./, "").toLowerCase();
    if (!entry) return false;
    return d === entry || d.endsWith(`.${entry}`);
  });
}

export type FilterResult = { ok: true } | { ok: false; reason: string };

/** Dominio a efectos de filtros y reportes: el real le gana al del redirector. */
export function effectiveDomain(mention: RawMention): string {
  return mention.sourceDomain ? domainOf(`https://${mention.sourceDomain.replace(/^https?:\/\//, "")}`) : domainOf(mention.url);
}

export function passesFilters(mention: RawMention, filters: TextFilters): FilterResult {
  const domain = effectiveDomain(mention);

  if (filters.blacklistDomains.length > 0 && domainMatches(domain, filters.blacklistDomains)) {
    return { ok: false, reason: `dominio en blacklist (${domain})` };
  }

  // Whitelist no vacía = modo restrictivo: todo lo que no esté, se descarta.
  if (filters.whitelistDomains.length > 0 && !domainMatches(domain, filters.whitelistDomains)) {
    return { ok: false, reason: `dominio fuera de la whitelist (${domain})` };
  }

  const haystack = normalize(`${mention.title ?? ""} ${mention.text}`);

  if (filters.excludeTerms.some((term) => term.trim() && haystack.includes(normalize(term)))) {
    return { ok: false, reason: "contiene un término excluido" };
  }

  if (
    filters.includeTerms.length > 0 &&
    !filters.includeTerms.some((term) => term.trim() && haystack.includes(normalize(term)))
  ) {
    return { ok: false, reason: "no contiene ningún término requerido" };
  }

  return { ok: true };
}
