// Cliente para la API pública de Decodo (antes Smartproxy) — el proveedor de
// proxies que usan los perfiles de AdsPower. Documentación oficial:
// https://help.decodo.com/api-reference/subscriptions/get-subscriptions
//
// La API key se lee en cada llamada (no a nivel de módulo) por el mismo
// motivo que src/lib/adspower/client.ts: en el worker standalone, dotenv
// carga .env.local después de que los imports ya se resolvieron.
async function request<T>(path: string): Promise<T> {
  const apiKey = process.env.SMARTPROXY_API_KEY ?? process.env.DECODO_API_KEY;
  if (!apiKey) {
    throw new Error("Falta SMARTPROXY_API_KEY o DECODO_API_KEY en .env.local");
  }

  const res = await fetch(`https://api.decodo.com${path}`, {
    headers: { Authorization: apiKey },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Decodo API HTTP ${res.status} en ${path}`);
  }

  return (await res.json()) as T;
}

// La forma exacta de la respuesta no está 100% documentada — se tipa como
// desconocida y se normaliza del lado del route handler, revisando los
// campos reales que devuelva la cuenta.
export type DecodoSubscription = Record<string, unknown>;

export const decodo = {
  async getSubscriptions() {
    return request<DecodoSubscription[] | DecodoSubscription>("/v2/subscriptions");
  },
};
