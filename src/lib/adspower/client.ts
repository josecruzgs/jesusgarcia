import type {
  AdsPowerGroup,
  AdsPowerListResponse,
  AdsPowerProfile,
  AdsPowerStartBrowserData,
} from "./types";

// Cliente para la Local API de AdsPower (requiere el cliente de escritorio
// abierto en esta misma máquina). Documentación oficial:
// https://localapi-doc-en.adspower.com/
//
// Cuando "API key obligatoria" está activada (Configuración > Avanzado), el
// key se manda como header `Authorization: Bearer <key>` (confirmado
// empíricamente contra la instancia local; ni query param ni header
// `api-key`/`x-api-key` funcionan).

const DEFAULT_MIN_REQUEST_INTERVAL_MS = 1100;
const RATE_LIMIT_RETRY_DELAYS_MS = [1200, 2200, 3500];

/**
 * Banderas que se le pasan al Chromium del perfil cuando arranca.
 *
 * La barra de Google Translate ("¿Traducir esta página? Spanish | English") es
 * UI nativa del navegador, no DOM: Playwright no la ve y no la puede cerrar, y
 * si alguien alguna vez le dijo "traducir siempre" a ese perfil, Chrome reescribe
 * los rótulos de Facebook y todos los selectores por texto pasan a dar
 * "0 match(es)". Apagar la función de raíz es la única forma de que no aparezca.
 *
 * Van los dos nombres a propósito: `TranslateUI` es como se llamaba la feature
 * en los Chromium viejos —AdsPower arrastra varias versiones según el perfil— y
 * `Translate` como se llama ahora.
 *
 * Ojo con agregar más: `--disable-features` es un switch de valor único, así que
 * si AdsPower pasara el suyo, el último gana y se pisan. Y nada que toque la
 * huella (idioma, user agent, APIs deshabilitadas): el sentido de AdsPower es
 * que cada perfil parezca un navegador normal.
 */
const LAUNCH_ARGS = ["--disable-features=Translate,TranslateUI"];

let requestQueue = Promise.resolve();
let lastRequestStartedAt = 0;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function getMinRequestIntervalMs() {
  const raw = process.env.ADSPOWER_MIN_REQUEST_INTERVAL_MS;
  if (!raw) return DEFAULT_MIN_REQUEST_INTERVAL_MS;

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MIN_REQUEST_INTERVAL_MS;
}

function isRateLimitMessage(message: string) {
  return /too many request|request per second|rate.?limit/i.test(message);
}

async function runQueuedRequest<T>(operation: () => Promise<T>) {
  const queued = requestQueue.then(async () => {
    const minInterval = getMinRequestIntervalMs();
    const elapsed = Date.now() - lastRequestStartedAt;
    if (elapsed < minInterval) await sleep(minInterval - elapsed);

    lastRequestStartedAt = Date.now();
    return operation();
  });

  requestQueue = queued.catch(() => undefined).then(() => undefined);
  return queued;
}

async function request<T>(
  path: string,
  { method = "GET", query, body }: { method?: string; query?: Record<string, string | number | undefined>; body?: unknown } = {},
): Promise<T> {
  // Leídas en cada llamada (no a nivel de módulo): en el worker standalone
  // (src/worker/index.ts) dotenv carga .env.local después de que los imports
  // ya se resolvieron, así que capturarlas al importar este módulo las deja
  // en `undefined` aunque .env.local sí las tenga.
  const baseUrl = process.env.ADSPOWER_API_BASE_URL ?? "http://local.adspower.net:50325";
  const apiKey = process.env.ADSPOWER_API_KEY;

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined) params.set(k, String(v));
  }

  const url = `${baseUrl}${path}${params.toString() ? `?${params.toString()}` : ""}`;

  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  return runQueuedRequest(async () => {
    for (let attempt = 0; ; attempt += 1) {
      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error(`AdsPower API HTTP ${res.status} en ${path}`);
      }

      const json = (await res.json()) as AdsPowerListResponse<T>;
      if (json.code === 0) {
        return json.data;
      }

      const retryDelay = RATE_LIMIT_RETRY_DELAYS_MS[attempt];
      if (!isRateLimitMessage(json.msg) || retryDelay === undefined) {
        throw new Error(`AdsPower API error (${path}): ${json.msg}`);
      }

      await sleep(retryDelay);
    }
  });
}

// La Local API de AdsPower limita a ~1 request/seg; entre páginas de un
// mismo listado esperamos un poco para no pegarle un "Too many request".
const PAGINATION_DELAY_MS = DEFAULT_MIN_REQUEST_INTERVAL_MS;

export const adsPower = {
  async listGroups(page = 1, pageSize = 100) {
    return request<{ list: AdsPowerGroup[] }>("/api/v1/group/list", {
      query: { page, page_size: pageSize },
    });
  },

  /** Recorre todas las páginas y devuelve la lista completa de grupos. */
  async listAllGroups() {
    const pageSize = 100;
    const all: AdsPowerGroup[] = [];
    for (let page = 1; ; page++) {
      if (page > 1) await sleep(PAGINATION_DELAY_MS);
      const { list } = await this.listGroups(page, pageSize);
      all.push(...list);
      if (list.length < pageSize) break;
    }
    return all;
  },

  async createGroup(groupName: string, remark?: string) {
    return request<{ group_id: string }>("/api/v1/group/create", {
      method: "POST",
      body: { group_name: groupName, remark },
    });
  },

  async listProfiles(opts: { groupId?: string; page?: number; pageSize?: number } = {}) {
    return request<{ list: AdsPowerProfile[] }>("/api/v1/user/list", {
      query: {
        group_id: opts.groupId,
        page: opts.page ?? 1,
        page_size: opts.pageSize ?? 100,
      },
    });
  },

  /** Recorre todas las páginas y devuelve la lista completa de perfiles. */
  async listAllProfiles(groupId?: string) {
    const pageSize = 100;
    const all: AdsPowerProfile[] = [];
    for (let page = 1; ; page++) {
      if (page > 1) await sleep(PAGINATION_DELAY_MS);
      const { list } = await this.listProfiles({ groupId, page, pageSize });
      all.push(...list);
      if (list.length < pageSize) break;
    }
    return all;
  },

  /**
   * Crea un perfil de navegador. `fingerprint_config` y `proxy` aceptan
   * cualquier estructura soportada por la Local API (se pasan tal cual).
   */
  async createProfile(input: {
    name: string;
    groupId: string;
    remark?: string;
    proxyConfig?: Record<string, unknown>;
    fingerprintConfig?: Record<string, unknown>;
  }) {
    return request<{ id: string }>("/api/v1/user/create", {
      method: "POST",
      body: {
        name: input.name,
        group_id: input.groupId,
        remark: input.remark,
        proxy_config: input.proxyConfig ?? { proxy_soft: "no_proxy" },
        fingerprint_config: input.fingerprintConfig ?? {},
      },
    });
  },

  async deleteProfiles(profileIds: string[]) {
    return request<null>("/api/v1/user/delete", {
      method: "POST",
      body: { user_ids: profileIds },
    });
  },

  /**
   * Abre el navegador del perfil con una sola pestaña en blanco.
   *
   * Por defecto AdsPower restaura "la plataforma o la página histórica", que
   * en un perfil con meses de uso son todas las pestañas de las tareas
   * anteriores: cada una es una carga de Facebook completa, con el proxy
   * residencial de por medio, antes de que la tarea pueda hacer nada. Y encima
   * abre su propia pestaña de comprobación de IP, que también cuesta.
   *
   * `open_tabs: 1` es "Close" —el flag está al revés de lo que sugiere el
   * nombre, dice si abrir la histórica— y `ip_tab: 0` es no abrir la de la IP.
   * Ver https://localapi-doc-en.adspower.com/docs/FFMFMf.
   *
   * Ojo: esto solo aplica cuando el navegador arranca. Si ya estaba abierto,
   * AdsPower devuelve la instancia que hay y las pestañas viejas siguen ahí;
   * de eso se ocupa connectToProfile.
   */
  async startBrowser(profileId: string) {
    return request<AdsPowerStartBrowserData>("/api/v1/browser/start", {
      query: {
        user_id: profileId,
        headless: 0,
        open_tabs: 1,
        ip_tab: 0,
        // Vaciar la caché al cerrar no es una optimización: sin esto cada tarea
        // deja en disco el video del reel que miró, para un perfil que quizá no
        // se vuelve a usar en un mes. En godeye eso acumuló 79 GB en tres
        // semanas y dejó al VPS sin espacio para desplegar.
        clear_cache_after_closing: 1,
        // La Local API espera el array serializado como JSON dentro del query.
        launch_args: JSON.stringify(LAUNCH_ARGS),
      },
    });
  },

  async stopBrowser(profileId: string) {
    return request<null>("/api/v1/browser/stop", {
      query: { user_id: profileId },
    });
  },

  async browserStatus(profileId: string) {
    return request<{ status: "Active" | "Inactive" }>("/api/v1/browser/active", {
      query: { user_id: profileId },
    });
  },
};
