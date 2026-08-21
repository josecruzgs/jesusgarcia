"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";

/**
 * `key` viaja de ida y vuelta sin mostrarse: es la identidad estable de la
 * figura y el servidor la usa para saber que un nombre editado es la misma
 * persona de siempre. Si se perdiera en el formulario, cada corrección de
 * nombre volvería a duplicar el historial.
 */
export type EntityInput = { key?: string; name: string; aliases: string[]; profiles: string[] };

export type ProjectDraft = {
  name: string;
  description: string;
  entities: EntityInput[];
  includeTerms: string[];
  excludeTerms: string[];
  languages: string[];
  whitelistDomains: string[];
  blacklistDomains: string[];
  rssFeeds: string[];
  sources: Record<string, boolean>;
  brightDataPlatforms: string[];
  autoAnalyze: boolean;
  autoBrief: boolean;
  intervalMinutes: number;
};

export const EMPTY_DRAFT: ProjectDraft = {
  name: "",
  description: "",
  entities: [{ name: "", aliases: [], profiles: [] }],
  includeTerms: [],
  excludeTerms: [],
  languages: ["es"],
  whitelistDomains: [],
  blacklistDomains: [],
  rssFeeds: [],
  sources: { googleNews: true, gdelt: true, rss: true, youtube: false, brightData: false },
  brightDataPlatforms: [],
  autoAnalyze: true,
  autoBrief: true,
  intervalMinutes: 60,
};

const SOURCE_LABELS: { key: string; label: string; hint: string }[] = [
  { key: "googleNews", label: "Google News", hint: "Prensa sindicada · gratis" },
  { key: "gdelt", label: "GDELT", hint: "Prensa global y local · gratis" },
  { key: "rss", label: "Feeds propios", hint: "Los RSS que cargues abajo" },
  { key: "youtube", label: "YouTube", hint: "Requiere YOUTUBE_API_KEY" },
  { key: "brightData", label: "Bright Data", hint: "Redes sociales · de pago" },
];

const BRIGHT_DATA_PLATFORMS = ["x", "instagram", "tiktok", "facebook", "linkedin"];

const inputClass =
  "w-full rounded-[9px] border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary";

/** Convierte una lista a texto multilínea y de vuelta, sin perder el orden. */
function toText(list: string[]): string {
  return list.join("\n");
}
function fromText(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseAliases(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * El input guarda su propio texto crudo en vez de derivarlo del array en cada
 * pulsación. Si se derivara, escribir una coma la borraría al instante: el
 * `split(",").filter(Boolean)` descarta el segmento vacío que queda después
 * de la coma y el `join(", ")` de vuelta la deja fuera, así que nunca se
 * puede empezar a escribir el segundo alias.
 */
function AliasInput({ value, onChange }: { value: string[]; onChange: (aliases: string[]) => void }) {
  const [text, setText] = useState(() => value.join(", "));

  // Resincroniza solo cuando el array cambia desde afuera (cargar un proyecto
  // existente, quitar una fila de arriba). Mientras se escribe, lo que hay en
  // el input ya representa a `value` y esto no hace nada.
  useEffect(() => {
    if (parseAliases(text).join("|") !== value.join("|")) setText(value.join(", "));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.join("|")]);

  return (
    <input
      className={inputClass}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseAliases(e.target.value));
      }}
      placeholder="Alias separados por coma — ej. García, Jesús García, alcalde"
    />
  );
}

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-1.5">
      <span className="label-mono">{children}</span>
      {hint && <p className="mt-1 text-[11px] leading-snug text-ink-muted">{hint}</p>}
    </div>
  );
}

export default function ProjectForm({
  draft,
  onChange,
  providers,
}: {
  draft: ProjectDraft;
  onChange: (draft: ProjectDraft) => void;
  providers: { id: string; configured: boolean; credentialEnv: string | null }[];
}) {
  const [advanced, setAdvanced] = useState(false);
  const set = <K extends keyof ProjectDraft>(key: K, value: ProjectDraft[K]) =>
    onChange({ ...draft, [key]: value });

  const configuredById = new Map(providers.map((p) => [p.id, p]));

  function updateEntity(index: number, patch: Partial<EntityInput>) {
    const entities = draft.entities.map((e, i) => (i === index ? { ...e, ...patch } : e));
    set("entities", entities);
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <FieldLabel>Nombre del proyecto</FieldLabel>
        <input
          className={inputClass}
          value={draft.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Ej. Gobernador · monitoreo diario"
        />
      </div>

      <div>
        <FieldLabel hint="Los alias son cómo lo nombra la gente en la práctica: apodos, apellido solo, su cuenta de X. Sin ellos se pierden la mayoría de las menciones reales.">
          Figuras a monitorear
        </FieldLabel>
        <div className="flex flex-col gap-2.5">
          {draft.entities.map((entity, index) => (
            <div key={index} className="card-flat flex flex-col gap-2 p-3">
              <div className="flex items-center gap-2">
                <input
                  className={inputClass}
                  value={entity.name}
                  onChange={(e) => updateEntity(index, { name: e.target.value })}
                  placeholder="Nombre completo"
                />
                {draft.entities.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      set(
                        "entities",
                        draft.entities.filter((_, i) => i !== index),
                      )
                    }
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-muted transition-colors hover:text-critical"
                    aria-label="Quitar figura"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <AliasInput
                value={entity.aliases}
                onChange={(aliases) => updateEntity(index, { aliases })}
              />
              <textarea
                rows={2}
                className={`${inputClass} font-mono text-[11px]`}
                value={toText(entity.profiles ?? [])}
                onChange={(e) => updateEntity(index, { profiles: fromText(e.target.value) })}
                placeholder={"Cuentas a vigilar, una por línea\nhttps://x.com/MarinadelPilar"}
              />
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => set("entities", [...draft.entities, { name: "", aliases: [], profiles: [] }])}
          className="tbtn mt-2.5 inline-flex items-center gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" /> Agregar figura
        </button>
      </div>

      <div>
        <FieldLabel>Fuentes</FieldLabel>
        <div className="flex flex-col gap-2">
          {SOURCE_LABELS.map((source) => {
            const status = configuredById.get(source.key);
            const unavailable = status && !status.configured;
            return (
              <label
                key={source.key}
                className={`card-flat flex items-center gap-3 p-3 ${unavailable ? "opacity-60" : "cursor-pointer"}`}
              >
                <input
                  type="checkbox"
                  disabled={Boolean(unavailable)}
                  checked={Boolean(draft.sources[source.key])}
                  onChange={(e) => set("sources", { ...draft.sources, [source.key]: e.target.checked })}
                  className="accent-primary"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-ink">{source.label}</p>
                  <p className="label-mono-sm mt-0.5 normal-case tracking-normal">
                    {unavailable ? `Falta ${status?.credentialEnv} en .env.local` : source.hint}
                  </p>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      {draft.sources.brightData && (
        <div>
          <FieldLabel hint="Cada plataforma es un dataset distinto de Bright Data y se factura aparte.">
            Plataformas de Bright Data
          </FieldLabel>
          <div className="flex flex-wrap gap-2">
            {BRIGHT_DATA_PLATFORMS.map((platform) => {
              const active = draft.brightDataPlatforms.includes(platform);
              return (
                <button
                  key={platform}
                  type="button"
                  onClick={() =>
                    set(
                      "brightDataPlatforms",
                      active
                        ? draft.brightDataPlatforms.filter((p) => p !== platform)
                        : [...draft.brightDataPlatforms, platform],
                    )
                  }
                  className={`rounded-[9px] border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors ${
                    active ? "accent-fill" : "border-hairline text-ink-secondary hover:text-ink"
                  }`}
                >
                  {platform}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setAdvanced((v) => !v)}
        className="label-mono self-start transition-colors hover:text-gold"
      >
        {advanced ? "− Ocultar" : "+ Mostrar"} filtros y ajustes avanzados
      </button>

      {advanced && (
        <div className="flex flex-col gap-5 border-t border-hairline pt-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel hint="Si tiene contenido, SOLO se aceptan menciones de estos dominios. Uno por línea.">
                Whitelist de fuentes
              </FieldLabel>
              <textarea
                rows={4}
                className={`${inputClass} font-mono text-[11px]`}
                value={toText(draft.whitelistDomains)}
                onChange={(e) => set("whitelistDomains", fromText(e.target.value))}
                placeholder={"eluniversal.com.mx\nelimparcial.com"}
              />
            </div>
            <div>
              <FieldLabel hint="Estos dominios se descartan siempre. Uno por línea.">
                Blacklist de fuentes
              </FieldLabel>
              <textarea
                rows={4}
                className={`${inputClass} font-mono text-[11px]`}
                value={toText(draft.blacklistDomains)}
                onChange={(e) => set("blacklistDomains", fromText(e.target.value))}
                placeholder={"sitio-spam.com"}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel hint="La mención debe contener al menos uno de estos. Sirve para acotar el tema.">
                Términos requeridos
              </FieldLabel>
              <textarea
                rows={3}
                className={`${inputClass} font-mono text-[11px]`}
                value={toText(draft.includeTerms)}
                onChange={(e) => set("includeTerms", fromText(e.target.value))}
              />
            </div>
            <div>
              <FieldLabel hint="Si aparece cualquiera de estos, se descarta. Sirve para homónimos.">
                Términos excluidos
              </FieldLabel>
              <textarea
                rows={3}
                className={`${inputClass} font-mono text-[11px]`}
                value={toText(draft.excludeTerms)}
                onChange={(e) => set("excludeTerms", fromText(e.target.value))}
              />
            </div>
          </div>

          <div>
            <FieldLabel hint="URLs de RSS de los medios que sigues. Una por línea.">
              Feeds propios
            </FieldLabel>
            <textarea
              rows={3}
              className={`${inputClass} font-mono text-[11px]`}
              value={toText(draft.rssFeeds)}
              onChange={(e) => set("rssFeeds", fromText(e.target.value))}
              placeholder="https://www.elimparcial.com/rss/"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel hint="Cada cuánto el worker busca menciones nuevas.">
                Intervalo (minutos)
              </FieldLabel>
              <input
                type="number"
                min={15}
                className={inputClass}
                value={draft.intervalMinutes}
                onChange={(e) => set("intervalMinutes", Math.max(15, Number(e.target.value) || 60))}
              />
            </div>
            <label className="card-flat flex cursor-pointer items-center gap-3 self-end p-3">
              <input
                type="checkbox"
                checked={draft.autoAnalyze}
                onChange={(e) => set("autoAnalyze", e.target.checked)}
                className="accent-primary"
              />
              <div>
                <p className="text-[13px] font-medium text-ink">Analizar con IA al ingerir</p>
                <p className="label-mono-sm mt-0.5 normal-case tracking-normal">
                  Sentimiento y temas con Claude
                </p>
              </div>
            </label>
          </div>

          <label className="card-flat flex cursor-pointer items-center gap-3 p-3">
            <input
              type="checkbox"
              checked={draft.autoBrief !== false}
              onChange={(e) => set("autoBrief", e.target.checked)}
              className="accent-primary"
            />
            <div>
              <p className="text-[13px] font-medium text-ink">Resumen ejecutivo cada 3 días</p>
              <p className="label-mono-sm mt-0.5 normal-case tracking-normal">
                El worker cierra cada ventana de tres días al vencer. Un período ya analizado no se
                vuelve a generar.
              </p>
            </div>
          </label>
        </div>
      )}
    </div>
  );
}
