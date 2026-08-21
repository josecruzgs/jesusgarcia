import type { MentionProvider, RawMention } from "../types";
import { orQuery } from "../types";

// GDELT indexa prensa mundial y es gratis sin credencial. Complementa a
// Google News: cubre medios locales y regionales que Google no siempre
// sindica, que es justo donde aparece la cobertura de figuras estatales.
const ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc";

const GDELT_LANG: Record<string, string> = { es: "spanish", en: "english" };

type GdeltArticle = {
  url?: string;
  title?: string;
  domain?: string;
  language?: string;
  seendate?: string;
  sourcecountry?: string;
};

/** GDELT devuelve `20260805T143000Z`, que `new Date()` no sabe leer. */
function parseSeenDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) {
    const fallback = new Date(raw);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  const [, y, mo, d, h, mi, s] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GDELT limita por IP de forma agresiva y sin cabecera `Retry-After`: con dos
 * figuras en un proyecto, las consultas seguidas devuelven 429. Se espacian y
 * se reintenta una vez con más espera antes de darlo por caído.
 */
const THROTTLE_MS = 1500;
const RETRY_MS = 6000;

async function gdeltFetch(url: string, signal?: AbortSignal): Promise<Response> {
  const headers = { "User-Agent": "Mozilla/5.0 (compatible; OjoDeDios/1.0)" };

  let res = await fetch(url, { headers, signal });
  if (res.status === 429) {
    await sleep(RETRY_MS);
    res = await fetch(url, { headers, signal });
  }
  return res;
}

export const gdeltProvider: MentionProvider = {
  id: "gdelt",
  label: "GDELT (prensa global)",
  isConfigured: () => true,

  async fetch(ctx): Promise<RawMention[]> {
    const results: RawMention[] = [];

    for (const lang of ctx.languages.length > 0 ? ctx.languages : ["es"]) {
      const langFilter = GDELT_LANG[lang];
      const query = [`(${orQuery(ctx.entity)})`, langFilter ? `sourcelang:${langFilter}` : ""]
        .filter(Boolean)
        .join(" ");

      // `timespan` en minutos redondeados hacia arriba: la API no acepta un
      // rango arbitrario, solo "las últimas N unidades".
      const minutes = Math.max(
        15,
        Math.ceil((ctx.until.getTime() - ctx.since.getTime()) / 60000),
      );

      const url =
        `${ENDPOINT}?query=${encodeURIComponent(query)}` +
        `&mode=ArtList&format=json&maxrecords=250&sort=DateDesc&timespan=${minutes}min`;

      await sleep(THROTTLE_MS);

      const res = await gdeltFetch(url, ctx.signal);
      if (!res.ok) throw new Error(`GDELT respondió ${res.status}`);

      // Cuando no hay resultados GDELT devuelve texto plano, no JSON —
      // parsear a ciegas rompe la corrida entera por un caso normal.
      const body = await res.text();
      if (!body.trim().startsWith("{")) continue;

      const data = JSON.parse(body) as { articles?: GdeltArticle[] };

      for (const article of data.articles ?? []) {
        if (!article.url) continue;
        const publishedAt = parseSeenDate(article.seendate);
        if (!publishedAt || publishedAt < ctx.since || publishedAt > ctx.until) continue;

        results.push({
          provider: "gdelt",
          platform: "news",
          sourceType: "news",
          url: article.url,
          title: article.title,
          // GDELT no entrega el cuerpo, solo metadatos: el título es todo el
          // texto disponible para analizar.
          text: article.title ?? "",
          author: article.domain,
          publishedAt,
          lang,
        });
      }
    }

    return results;
  },
};
