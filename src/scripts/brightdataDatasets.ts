import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * Lista los datasets de tu cuenta de Bright Data y arma las líneas de
 * .env.local ya listas para pegar.
 *
 * Existe porque los dataset IDs (`gd_xxxxxxxxxxxx`) no se adivinan: hay uno
 * distinto por plataforma y por tipo de scraper, y buscarlos a mano en el
 * panel es donde se pierde media hora. Correr:
 *
 *   npm run brightdata:datasets
 */

const ENDPOINT = "https://api.brightdata.com/datasets/list";

// Qué palabras identifican a cada plataforma dentro del nombre del dataset.
const PLATFORMS: { env: string; label: string; match: RegExp }[] = [
  { env: "BRIGHTDATA_DATASET_X", label: "X / Twitter", match: /\b(x|twitter)\b/i },
  { env: "BRIGHTDATA_DATASET_INSTAGRAM", label: "Instagram", match: /instagram/i },
  { env: "BRIGHTDATA_DATASET_TIKTOK", label: "TikTok", match: /tiktok/i },
  { env: "BRIGHTDATA_DATASET_FACEBOOK", label: "Facebook", match: /facebook/i },
  { env: "BRIGHTDATA_DATASET_LINKEDIN", label: "LinkedIn", match: /linkedin/i },
];

type Dataset = { id?: string; name?: string; [key: string]: unknown };

function nameOf(d: Dataset): string {
  return String(d.name ?? d.id ?? "");
}

/**
 * De varios datasets de una misma plataforma preferimos el de posts
 * descubiertos por palabra clave: es el único que sirve para monitorear
 * menciones. Los de "profile" o "comments" piden una URL concreta de entrada.
 */
function score(name: string): number {
  const n = name.toLowerCase();
  let s = 0;
  if (/post/.test(n)) s += 3;
  if (/keyword|search|discover/.test(n)) s += 3;
  if (/profile|comment|follower|reel|hashtag/.test(n)) s -= 2;
  return s;
}

async function main() {
  const token = process.env.BRIGHTDATA_API_TOKEN;

  if (!token) {
    console.error("Falta BRIGHTDATA_API_TOKEN en .env.local");
    console.error("Sácalo de https://brightdata.com/cp/setting/users");
    process.exit(1);
  }

  const res = await fetch(ENDPOINT, { headers: { Authorization: `Bearer ${token}` } });

  if (res.status === 401) {
    console.error("Bright Data devolvió 401: el token no es válido.");
    console.error("Revisa que lo hayas copiado completo desde");
    console.error("https://brightdata.com/cp/setting/users (son cientos de caracteres).");
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`Bright Data devolvió ${res.status}: ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }

  const body = await res.json();
  // La API ha devuelto tanto un array pelado como un objeto con la lista
  // adentro; se aceptan ambas formas para no romperse en el próximo cambio.
  const datasets: Dataset[] = Array.isArray(body)
    ? body
    : ((body.datasets ?? body.data ?? []) as Dataset[]);

  if (datasets.length === 0) {
    console.log("La cuenta no tiene ningún dataset todavía.");
    console.log("Agrega los scrapers que quieras desde https://brightdata.com/cp/scrapers");
    return;
  }

  console.log(`\n${datasets.length} datasets en tu cuenta:\n`);
  for (const d of datasets) {
    console.log(`  ${String(d.id ?? "—").padEnd(24)} ${nameOf(d)}`);
  }

  console.log("\n" + "─".repeat(70));
  console.log("⚠  OJO: este endpoint lista el catálogo de datasets de la cuenta, que");
  console.log("   MEZCLA los datasets de marketplace (ya recolectados, no se pueden");
  console.log("   disparar) con los scrapers de la Web Scraper API. Un id de");
  console.log("   marketplace falla con «This dataset does not support collection».");
  console.log("   Si eso pasa, saca el id correcto de la página del scraper en");
  console.log("   https://brightdata.com/cp/scrapers — aparece en el ejemplo de código.");
  console.log("─".repeat(70));
  console.log("Líneas para pegar en .env.local (verifícalas contra /cp/scrapers):\n");

  for (const platform of PLATFORMS) {
    const candidates = datasets
      .filter((d) => d.id && platform.match.test(nameOf(d)))
      .sort((a, b) => score(nameOf(b)) - score(nameOf(a)));

    if (candidates.length === 0) {
      console.log(`# ${platform.label}: no encontré un dataset — agrégalo en brightdata.com/cp/scrapers`);
      console.log(`${platform.env}=`);
      continue;
    }

    console.log(`# ${platform.label} — ${nameOf(candidates[0])}`);
    console.log(`${platform.env}=${candidates[0].id}`);

    for (const alt of candidates.slice(1, 3)) {
      console.log(`#   alternativa: ${alt.id}  (${nameOf(alt)})`);
    }
  }

  console.log(
    "\nOjo: cada plataforma se factura aparte. Empieza habilitando solo la que más te importe.",
  );
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
