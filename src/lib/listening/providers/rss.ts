import type { MentionProvider, RawMention } from "../types";
import { mentionsEntity } from "../match";
import { parseFeed } from "./rssParse";

/**
 * Feeds que el usuario carga a mano. Es el complemento natural de la
 * whitelist: los medios que importan de verdad se siguen desde su propio RSS
 * en vez de esperar a que un agregador los sindique.
 */
export const rssProvider: MentionProvider = {
  id: "rss",
  label: "Feeds propios (RSS)",
  isConfigured: () => true,

  async fetch(ctx): Promise<RawMention[]> {
    const results: RawMention[] = [];

    for (const feedUrl of ctx.rssFeeds) {
      if (!feedUrl.trim()) continue;

      // Un feed caído no debe tumbar los demás — se salta y sigue.
      let xml: string;
      try {
        const res = await fetch(feedUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; OjoDeDios/1.0)" },
          signal: ctx.signal,
        });
        if (!res.ok) continue;
        xml = await res.text();
      } catch {
        continue;
      }

      for (const item of parseFeed(xml)) {
        if (item.publishedAt < ctx.since || item.publishedAt > ctx.until) continue;

        const candidate: RawMention = {
          provider: "rss",
          platform: "news",
          sourceType: "news",
          url: item.link,
          title: item.title,
          text: item.description || item.title,
          author: item.author,
          publishedAt: item.publishedAt,
        };

        // Un feed trae todo lo que publica el medio, no solo lo del
        // personaje: acá sí hay que filtrar por nombre antes de guardar.
        if (mentionsEntity(candidate, ctx.entity)) results.push(candidate);
      }
    }

    return results;
  },
};
