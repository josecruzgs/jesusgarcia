export type ProviderId = "googleNews" | "gdelt" | "rss" | "youtube" | "brightData";

export type SourceType = "news" | "social" | "video" | "forum" | "blog" | "review";

/** Una mención tal como la devuelve un proveedor, antes de filtrar y guardar. */
export type RawMention = {
  provider: ProviderId;
  /** Plataforma concreta: "news", "x", "instagram", "youtube"… */
  platform: string;
  sourceType: SourceType;
  url: string;
  /**
   * Dominio real del medio cuando `url` es un redirector (Google News). Si
   * viene, manda sobre el host de `url` para filtros y estadísticas.
   */
  sourceDomain?: string;
  title?: string;
  text: string;
  author?: string;
  authorFollowers?: number;
  publishedAt: Date;
  lang?: string;
  engagement?: { likes?: number; comments?: number; shares?: number; views?: number };
  reach?: number;
};

export type EntityTarget = {
  /** Identidad estable de la figura — ver `entities.ts`. */
  key: string;
  name: string;
  aliases: string[];
  profiles: string[];
};

/**
 * Persistencia de scrapes en vuelo. La capa de proveedores no habla con Mongo
 * a propósito; la ingesta le pasa esta interfaz para que pueda retomar un
 * snapshot que quedó a medias en la corrida anterior.
 */
export type SnapshotStore = {
  get: (key: string) => string | undefined;
  set: (key: string, snapshotId: string) => Promise<void>;
  clear: (key: string) => Promise<void>;
};

export type ProviderContext = {
  entity: EntityTarget;
  languages: string[];
  /** Feeds propios del proyecto — solo los usa el proveedor `rss`. */
  rssFeeds: string[];
  /** Plataformas habilitadas — solo las usa `brightData`. */
  platforms: string[];
  since: Date;
  until: Date;
  snapshots?: SnapshotStore;
  /**
   * Se corta cuando la ingesta se cansó de esperar a este proveedor. Pasarla a
   * cada `fetch()` es lo que ABORTA la petición; sin ella el worker sigue de
   * largo igual (la ingesta no espera), pero la conexión queda colgando en
   * segundo plano hasta que el sistema operativo la cierre.
   */
  signal?: AbortSignal;
};

export type MentionProvider = {
  id: ProviderId;
  label: string;
  /** Variable de entorno que necesita, si necesita alguna. */
  credentialEnv?: string;
  isConfigured: () => boolean;
  fetch: (ctx: ProviderContext) => Promise<RawMention[]>;
};

/** Frase de búsqueda de un personaje: nombre + alias, todos entre comillas. */
export function entityPhrases(entity: EntityTarget): string[] {
  return [entity.name, ...entity.aliases].map((s) => s.trim()).filter(Boolean);
}

/** `"Nombre" OR "Alias"` — la sintaxis que aceptan Google News y GDELT. */
export function orQuery(entity: EntityTarget): string {
  return entityPhrases(entity)
    .map((phrase) => `"${phrase}"`)
    .join(" OR ");
}
