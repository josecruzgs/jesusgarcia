import type { MentionProvider, RawMention, SnapshotStore, SourceType } from "../types";
import { entityPhrases } from "../types";

/**
 * Bright Data — Web Scraper API (datasets v3).
 *
 * El flujo es asíncrono en tres pasos: se dispara el scrape (`trigger`), se
 * consulta el avance (`progress`) y recién entonces se baja el resultado
 * (`snapshot`). No hay endpoint síncrono, así que acá se hace el polling con
 * un techo de tiempo: si el snapshot no está listo dentro del presupuesto, la
 * corrida devuelve lo que haya y el resto entra en el ciclo siguiente. Es
 * preferible a bloquear el worker indefinidamente.
 *
 * Cada plataforma es un dataset distinto del lado de Bright Data, con su
 * propio id — por eso van en variables de entorno separadas.
 */
const API = "https://api.brightdata.com/datasets/v3";

const DATASET_ENV: Record<string, string> = {
  x: "BRIGHTDATA_DATASET_X",
  instagram: "BRIGHTDATA_DATASET_INSTAGRAM",
  tiktok: "BRIGHTDATA_DATASET_TIKTOK",
  facebook: "BRIGHTDATA_DATASET_FACEBOOK",
  linkedin: "BRIGHTDATA_DATASET_LINKEDIN",
};

const PLATFORM_SOURCE_TYPE: Record<string, SourceType> = {
  x: "social",
  instagram: "social",
  tiktok: "video",
  facebook: "social",
  linkedin: "social",
};

const POLL_INTERVAL_MS = 5000;
/**
 * 6 minutos. Tiempos medidos sobre esta cuenta: X ~16s, Instagram ~34s,
 * TikTok ~85s y Facebook 4m31s con 50 registros. El techo anterior de 4 min
 * dejaba a Facebook justo afuera en cada pasada. Si aun así no alcanza, el
 * snapshot queda guardado y la corrida siguiente lo retoma sin volver a
 * facturarlo.
 */
const POLL_BUDGET_MS = 360_000;

/**
 * Tope de registros por corrida y plataforma. Bright Data cobra por registro
 * ($1.50 cada 1,000, con 5,000 gratis al mes), y una búsqueda por palabra
 * clave sin límite puede devolver miles: sin este tope, una sola corrida de
 * prueba se come la cuota del mes. Se puede subir con BRIGHTDATA_MAX_RECORDS.
 */
const DEFAULT_MAX_RECORDS = 50;

function maxRecords(): number {
  const raw = Number(process.env.BRIGHTDATA_MAX_RECORDS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_RECORDS;
}

/**
 * Los datasets de Bright Data no comparten nombres de campo entre
 * plataformas, y los han ido cambiando. En vez de un mapeo rígido por
 * plataforma, se busca el primer campo presente de una lista de candidatos:
 * cuando cambian un nombre, se agrega a la lista y no se rompe nada.
 */
function pick(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function pickNumber(row: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

async function brightDataRequest(path: string, init?: RequestInit, signal?: AbortSignal): Promise<Response> {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  if (!token) throw new Error("Falta BRIGHTDATA_API_TOKEN");

  const res = await fetch(`${API}${path}`, {
    ...init,
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 600 y no 200: los errores de validación de Bright Data traen el detalle
    // útil (qué campo falta) recién después del eco del input.
    throw new Error(`Bright Data ${res.status}: ${body.slice(0, 600)}`);
  }
  return res;
}

/** Qué plataforma es una URL de perfil, por su dominio. */
export function platformOfProfile(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    if (/^(x\.com|twitter\.com)$/.test(host)) return "x";
    if (host.endsWith("instagram.com")) return "instagram";
    if (host.endsWith("tiktok.com")) return "tiktok";
    if (host.endsWith("facebook.com") || host.endsWith("fb.com")) return "facebook";
    if (host.endsWith("linkedin.com")) return "linkedin";
    return null;
  } catch {
    return null;
  }
}

type TriggerPlan = { query: string; body: unknown[]; mode: string };

/**
 * Cada scraper de Bright Data acepta UN modo de entrada distinto, y no se
 * deduce del nombre: hay que preguntárselo (mandar un modo inválido devuelve
 * un 400 listando los válidos). Lo verificado sobre esta cuenta:
 *
 *   X          → profile_url  (URL del perfil)
 *   Instagram  → url          (URL del perfil; es su único modo)
 *   TikTok     → profile_url  (también acepta keyword y url)
 *   Facebook   → ninguno      (no descubre; se recolecta pasando las URLs)
 *
 * Si cambiás un dataset por otro, volvé a sondearlo antes de asumir el modo:
 * un `discover_by` inventado devuelve un 400 listando los válidos, y un cuerpo
 * al que le falten campos devuelve otro 400 con los que espera. CUIDADO con
 * sondear usando un cuerpo completo y válido: eso no da error, dispara la
 * recolección y se factura.
 */
function planFor(
  platform: string,
  profiles: string[],
  keyword: string | undefined,
  since: Date,
  until: Date,
): TriggerPlan | null {
  const discover = (by: string, body: unknown[]): TriggerPlan => ({
    query: `&type=discover_new&discover_by=${by}`,
    body,
    mode: by,
  });

  switch (platform) {
    case "x":
      if (profiles.length === 0) return null;
      return discover("profile_url", profiles.map((url) => ({ url })));

    case "instagram":
      // La URL del perfil entera, no el usuario suelto: este dataset descubre
      // las publicaciones de la cuenta a partir de su página.
      if (profiles.length === 0) return null;
      return discover("url", profiles.map((url) => ({ url })));

    case "tiktok":
      // `country` decide desde dónde se ve el perfil, y en TikTok eso cambia
      // bastante lo que se sirve. Se omiten `what_to_collect` y `post_type`:
      // solo aceptan ciertos valores y, sin ellos, el scraper trae todo — que
      // es lo que queremos.
      if (profiles.length === 0) return null;
      return discover(
        "profile_url",
        profiles.map((url) => ({ url, country: process.env.BRIGHTDATA_COUNTRY || "MX" })),
      );

    case "facebook":
      if (profiles.length === 0) return null;
      // Sin `type=discover_new`: este dataset solo recolecta lo que le pasás.
      return { query: "", body: profiles.map((url) => ({ url })), mode: "collect" };

    default:
      if (!keyword) return null;
      return discover("keyword", [
        { keyword, start_date: since.toISOString(), end_date: until.toISOString() },
      ]);
  }
}

async function runPlatform(
  platform: string,
  plan: TriggerPlan,
  since: Date,
  until: Date,
  snapshots: SnapshotStore | undefined,
  key: string,
  signal?: AbortSignal,
): Promise<RawMention[]> {
  const datasetId = process.env[DATASET_ENV[platform] ?? ""];
  if (!datasetId) return [];

  // Si quedó uno en vuelo de la corrida anterior se retoma, sin disparar (ni
  // facturar) uno nuevo.
  const pending = snapshots?.get(key);
  if (pending) {
    console.log(`[listening] Bright Data ${platform}: retomando snapshot ${pending}`);
    return collectSnapshot(platform, pending, since, until, snapshots, key, signal);
  }

  // Salvo en modo keyword, no se mandan fechas: cada dataset interpreta el
  // rango a su manera y una ventana angosta (la de una corrida incremental,
  // que son minutos) devuelve cero aunque haya posts recientes. Se pide lo
  // último —acotado por limit_per_input— y el recorte por fecha se hace más
  // abajo. La deduplicación por URL evita que lo ya visto se guarde de nuevo.
  const trigger = await brightDataRequest(
    `/trigger?dataset_id=${encodeURIComponent(datasetId)}&include_errors=true` +
      `${plan.query}&limit_per_input=${maxRecords()}`,
    { method: "POST", body: JSON.stringify(plan.body) },
    signal,
  );

  const { snapshot_id: snapshotId } = (await trigger.json()) as { snapshot_id?: string };
  if (!snapshotId) throw new Error("Bright Data no devolvió snapshot_id");

  // Se guarda ANTES de esperar: si el proceso muere a mitad del polling, el
  // id igual queda anotado y la próxima corrida lo retoma en vez de pagar
  // otro scrape.
  await snapshots?.set(key, snapshotId);

  return collectSnapshot(platform, snapshotId, since, until, snapshots, key, signal);
}

/** Espera a que el snapshot esté listo y lo convierte en menciones. */
async function collectSnapshot(
  platform: string,
  snapshotId: string,
  since: Date,
  until: Date,
  snapshots: SnapshotStore | undefined,
  key: string,
  signal?: AbortSignal,
): Promise<RawMention[]> {
  const deadline = Date.now() + POLL_BUDGET_MS;
  let ready = false;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    // El presupuesto de arriba solo se mira al entrar en cada vuelta: si una
    // sola petición se cuelga, el bucle no llega a comprobarlo nunca. La
    // señal es lo que corta ESA petición.
    const progress = await brightDataRequest(`/progress/${snapshotId}`, undefined, signal);
    const { status } = (await progress.json()) as { status?: string };

    if (status === "ready") {
      ready = true;
      break;
    }
    if (status === "failed") {
      // Un snapshot fallido no se retoma nunca: se olvida para que la
      // próxima corrida arranque limpia.
      await snapshots?.clear(key);
      throw new Error(`Bright Data: el snapshot ${snapshotId} falló`);
    }
  }

  if (!ready) {
    console.log(
      `[listening] Bright Data ${platform}: snapshot ${snapshotId} sigue corriendo, ` +
        `se retoma en la próxima pasada`,
    );
    return [];
  }

  const snapshot = await brightDataRequest(`/snapshot/${snapshotId}?format=json`, undefined, signal);
  const body = await snapshot.text();

  // Mientras se construye, el snapshot responde 200 con un objeto de estado
  // en vez del array de filas.
  if (!body.trim().startsWith("[")) return [];

  // Recién con las filas en la mano se da por consumido.
  await snapshots?.clear(key);

  const rows = JSON.parse(body) as Record<string, unknown>[];

  // Un dataset puede devolver filas perfectamente válidas que no son
  // publicaciones: los de "creadores" o "perfiles" traen followers y bio pero
  // ni URL ni fecha de post. Sin este aviso, la corrida reporta cero y parece
  // que la plataforma no trajo nada, cuando en realidad el dataset elegido no
  // es de posts.
  if (rows.length > 0 && !rows.some((r) => pick(r, ["url", "post_url", "link", "postUrl"]))) {
    // Se lanza como error, no como aviso al log, para que llegue al informe
    // de la corrida y se vea en pantalla. Es la falla más difícil de
    // diagnosticar de todas: el scrape "funciona" (200, con registros) pero
    // el dataset elegido devuelve perfiles o creadores en vez de
    // publicaciones, y sin este mensaje la plataforma solo reporta cero.
    throw new Error(
      `el dataset de ${platform} devolvió ${rows.length} registros SIN URL de publicación ` +
        `— es un scraper de perfiles, no de posts. Campos recibidos: ` +
        `${Object.keys(rows[0]).slice(0, 8).join(", ")}. ` +
        `Busca en /cp/scrapers el scraper de "${platform} - Posts".`,
    );
  }

  return rows.flatMap((row): RawMention[] => {
    const url = pick(row, ["url", "post_url", "link", "postUrl"]);
    if (!url) return [];

    const rawDate = pick(row, ["date_posted", "timestamp", "created_at", "post_date", "datePosted"]);
    const publishedAt = rawDate ? new Date(rawDate) : null;
    if (!publishedAt || Number.isNaN(publishedAt.getTime())) return [];

    // Recorte por ventana del lado nuestro, ya que no se lo pedimos a ellos.
    if (publishedAt < since || publishedAt > until) return [];

    const followers = pickNumber(row, [
      "followers",
      "page_followers",
      "user_followers",
      "follower_count",
    ]);

    return [
      {
        provider: "brightData",
        platform,
        sourceType: PLATFORM_SOURCE_TYPE[platform] ?? "social",
        url,
        title: pick(row, ["title", "headline"]),
        text: pick(row, ["content", "description", "caption", "post_text", "text"]) ?? "",
        // page_name / user_username_raw / profile_handle son los de Facebook,
        // verificados sobre datos reales del dataset.
        author: pick(row, [
          "user_posted",
          "page_name",
          "user_username_raw",
          "profile_handle",
          "author",
          "username",
          "profile_name",
          "user_name",
        ]),
        authorFollowers: followers,
        publishedAt,
        engagement: {
          likes: pickNumber(row, ["likes", "num_likes", "like_count", "digg_count"]),
          comments: pickNumber(row, ["num_comments", "comments", "comment_count", "replies"]),
          shares: pickNumber(row, ["num_shares", "shares", "reposts", "share_count"]),
          views: pickNumber(row, ["views", "play_count", "video_view_count"]),
        },
        reach: followers,
      },
    ];
  });
}

export const brightDataProvider: MentionProvider = {
  id: "brightData",
  label: "Bright Data (redes sociales)",
  credentialEnv: "BRIGHTDATA_API_TOKEN",
  isConfigured: () => Boolean(process.env.BRIGHTDATA_API_TOKEN),

  async fetch(ctx): Promise<RawMention[]> {
    if (!process.env.BRIGHTDATA_API_TOKEN) return [];

    const results: RawMention[] = [];
    const problems: string[] = [];

    // Las cuentas a vigilar se agrupan por plataforma según su dominio, para
    // mandarle a cada dataset solo las URLs que le corresponden.
    const profilesByPlatform = new Map<string, string[]>();
    for (const url of ctx.entity.profiles ?? []) {
      const platform = platformOfProfile(url);
      if (!platform) continue;
      profilesByPlatform.set(platform, [...(profilesByPlatform.get(platform) ?? []), url]);
    }

    // Un keyword por corrida: cada término es un scrape facturable aparte, y
    // el nombre completo suele traer lo que importa.
    const keyword = entityPhrases(ctx.entity)[0];

    for (const platform of ctx.platforms) {
      const plan = planFor(
        platform,
        profilesByPlatform.get(platform) ?? [],
        keyword,
        ctx.since,
        ctx.until,
      );

      if (!plan) {
        console.warn(
          `[listening] Bright Data ${platform}: sin entrada utilizable ` +
            `(esta plataforma necesita cuentas cargadas en la figura)`,
        );
        continue;
      }

      // Una plataforma bloqueada (pasa seguido con Instagram y TikTok) no
      // debe impedir que las demás entreguen.
      try {
        results.push(
          ...(await runPlatform(
            platform,
            plan,
            ctx.since,
            ctx.until,
            ctx.snapshots,
            `${ctx.entity.key}|${platform}`,
            ctx.signal,
          )),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[listening] Bright Data ${platform} (${plan.mode}):`, err);
        problems.push(`${platform}: ${message}`);
      }
    }

    // Si TODAS las plataformas fallaron, se propaga para que la corrida lo
    // reporte. Si al menos una entregó, se conserva lo que llegó y el fallo
    // parcial queda en el log.
    if (problems.length > 0 && results.length === 0) {
      throw new Error(problems.join(" · "));
    }

    return results;
  },
};
