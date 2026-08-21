import type { MentionProvider, RawMention } from "../types";
import { orQuery } from "../types";
import { parseFeed } from "./rssParse";

// Google News no tiene API pública: el feed RSS de búsqueda es la vía
// soportada y no pide credencial. `ceid`/`gl`/`hl` fijan país e idioma de
// edición — sin ellos devuelve la edición de EE.UU. en inglés.
const EDITIONS: Record<string, { hl: string; gl: string; ceid: string }> = {
  es: { hl: "es-419", gl: "MX", ceid: "MX:es-419" },
  en: { hl: "en-US", gl: "US", ceid: "US:en" },
};

export const googleNewsProvider: MentionProvider = {
  id: "googleNews",
  label: "Google News",
  isConfigured: () => true,

  async fetch(ctx): Promise<RawMention[]> {
    const results: RawMention[] = [];

    for (const lang of ctx.languages.length > 0 ? ctx.languages : ["es"]) {
      const edition = EDITIONS[lang] ?? EDITIONS.es;
      const url =
        `https://news.google.com/rss/search?q=${encodeURIComponent(orQuery(ctx.entity))}` +
        `&hl=${edition.hl}&gl=${edition.gl}&ceid=${edition.ceid}`;

      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; OjoDeDios/1.0)" },
        signal: ctx.signal,
      });
      if (!res.ok) throw new Error(`Google News respondió ${res.status}`);

      for (const item of parseFeed(await res.text())) {
        // El feed no acepta rango de fechas, así que se recorta acá.
        if (item.publishedAt < ctx.since || item.publishedAt > ctx.until) continue;

        results.push({
          provider: "googleNews",
          platform: "news",
          sourceType: "news",
          url: item.link,
          sourceDomain: item.sourceUrl,
          // Google News anexa " - Medio" al título; el medio ya viene aparte.
          title: item.title.replace(/\s+-\s+[^-]+$/, "").trim() || item.title,
          text: item.description || item.title,
          author: item.sourceName,
          publishedAt: item.publishedAt,
          lang,
        });
      }
    }

    return results;
  },
};
