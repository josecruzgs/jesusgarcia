import type { MentionProvider, RawMention } from "../types";
import { orQuery } from "../types";

type SearchItem = {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    publishedAt?: string;
  };
};

export const youtubeProvider: MentionProvider = {
  id: "youtube",
  label: "YouTube",
  credentialEnv: "YOUTUBE_API_KEY",
  isConfigured: () => Boolean(process.env.YOUTUBE_API_KEY),

  async fetch(ctx): Promise<RawMention[]> {
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) return [];

    const url =
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video` +
      `&q=${encodeURIComponent(orQuery(ctx.entity))}` +
      `&order=date&maxResults=50` +
      `&publishedAfter=${ctx.since.toISOString()}&publishedBefore=${ctx.until.toISOString()}` +
      `&key=${key}`;

    const res = await fetch(url, { signal: ctx.signal });
    if (!res.ok) {
      // La cuota diaria de la API de YouTube se agota rápido y devuelve 403.
      // Vale la pena distinguirlo de un error real para no alarmar.
      if (res.status === 403) throw new Error("YouTube: cuota diaria agotada o API key inválida");
      throw new Error(`YouTube respondió ${res.status}`);
    }

    const data = (await res.json()) as { items?: SearchItem[] };

    return (data.items ?? []).flatMap((item): RawMention[] => {
      const videoId = item.id?.videoId;
      const publishedAt = item.snippet?.publishedAt ? new Date(item.snippet.publishedAt) : null;
      if (!videoId || !publishedAt || Number.isNaN(publishedAt.getTime())) return [];

      return [
        {
          provider: "youtube",
          platform: "youtube",
          sourceType: "video",
          url: `https://www.youtube.com/watch?v=${videoId}`,
          title: item.snippet?.title,
          text: item.snippet?.description || item.snippet?.title || "",
          author: item.snippet?.channelTitle,
          publishedAt,
        },
      ];
    });
  },
};
