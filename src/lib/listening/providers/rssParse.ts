import { XMLParser } from "fast-xml-parser";

// `textNodeName`/`ignoreAttributes` alineados con cómo leemos los nodos más
// abajo. Atom guarda el link en un atributo (`<link href>`) y RSS en el texto
// del nodo, así que necesitamos los atributos.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
});

export type FeedItem = {
  title: string;
  link: string;
  description: string;
  publishedAt: Date;
  author?: string;
  /** Google News mete el medio real acá; en un RSS común suele venir vacío. */
  sourceName?: string;
  /**
   * El atributo `url` de `<source>`. Es el único lugar donde Google News dice
   * de qué medio salió la nota: el `<link>` apunta a su propio redirector, así
   * que sin esto todas las menciones quedarían con dominio news.google.com y
   * la whitelist por dominio no serviría para nada.
   */
  sourceUrl?: string;
};

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(node: unknown): string {
  if (node === undefined || node === null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node === "object" && "#text" in (node as Record<string, unknown>)) {
    return String((node as Record<string, unknown>)["#text"] ?? "");
  }
  return "";
}

function linkOf(node: unknown): string {
  // Atom: <link href="..."/> — posiblemente varios, y el que sirve es el
  // rel="alternate" (los otros son "self" y apuntan al feed, no a la nota).
  const links = asArray(node as unknown[]);
  for (const link of links) {
    if (typeof link === "string") return link;
    if (link && typeof link === "object") {
      const record = link as Record<string, unknown>;
      const rel = String(record["@_rel"] ?? "alternate");
      if (rel === "alternate" && record["@_href"]) return String(record["@_href"]);
    }
  }
  for (const link of links) {
    if (link && typeof link === "object") {
      const href = (link as Record<string, unknown>)["@_href"];
      if (href) return String(href);
    }
  }
  return textOf(node);
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parsea RSS 2.0 y Atom con el mismo código: los dos terminan en FeedItem. */
export function parseFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml) as Record<string, unknown>;

  const rssChannel = (doc.rss as Record<string, unknown> | undefined)?.channel as
    | Record<string, unknown>
    | undefined;
  const atomFeed = doc.feed as Record<string, unknown> | undefined;

  const rawItems = rssChannel
    ? asArray(rssChannel.item as unknown)
    : atomFeed
      ? asArray(atomFeed.entry as unknown)
      : [];

  const items: FeedItem[] = [];

  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;

    const link = linkOf(item.link);
    if (!link) continue;

    const rawDate =
      textOf(item.pubDate) || textOf(item.published) || textOf(item.updated) || textOf(item["dc:date"]);
    const parsedDate = rawDate ? new Date(rawDate) : null;

    const description = stripHtml(
      textOf(item.description) || textOf(item.summary) || textOf(item.content) || "",
    );

    items.push({
      title: stripHtml(textOf(item.title)),
      link,
      description,
      // Un feed sin fecha válida se trata como recién visto en vez de
      // descartarse: perder la mención es peor que fecharla con holgura.
      publishedAt: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : new Date(),
      author: textOf(item.author) || textOf(item["dc:creator"]) || undefined,
      sourceName: textOf(item.source) || undefined,
      sourceUrl:
        item.source && typeof item.source === "object"
          ? ((item.source as Record<string, unknown>)["@_url"] as string | undefined)
          : undefined,
    });
  }

  return items;
}
