"use client";

import { useEffect, useState } from "react";
import { PhoneCall } from "lucide-react";
import { apiFetch } from "@/lib/api";
import Card from "@/components/Card";

type Estado = { limite: number; corriendo: number; maximo: number; lineas: number };

/**
 * Cuántas campañas de encuesta pueden llamar al mismo tiempo. Como los motores, es capacidad compartida y se aplica al
 * tocarlo: las líneas telefónicas se reparten entre las campañas que estén llamando. Solo la ve el admin, y la API
 * (/api/encuestas/ajustes) lo exige también.
 */
export default function CampanasAdmin() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [pidiendo, setPidiendo] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function traer() {
    try {
      setEstado(await apiFetch<Estado>("/api/encuestas/ajustes"));
    } catch {
      // Si falla, se queda lo que ya se veía.
    }
  }

  useEffect(() => {
    traer();
  }, []);

  async function elegir(n: number) {
    setPidiendo(n);
    setError(null);
    try {
      await apiFetch("/api/encuestas/ajustes", { method: "PUT", body: JSON.stringify({ limite: n }) });
      await traer();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPidiendo(null);
    }
  }

  const maximo = estado?.maximo ?? 10;
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid shrink-0 place-items-center" style={{ color: "var(--primary)" }}>
          <PhoneCall className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold text-ink">Campañas de encuesta a la vez</h2>
          <p className="mt-1 text-[13px] text-ink-secondary">
            Cuántas campañas de llamadas pueden estar llamando al mismo tiempo. Afecta a todo el sistema y se aplica al
            tocarlo. Las {estado?.lineas ?? "—"} líneas telefónicas se reparten entre las que estén llamando: con más
            campañas a la vez, a cada una le tocan menos. Bajarlo no detiene las que ya llaman; solo impide arrancar otra
            hasta que haya lugar.
          </p>
        </div>
      </div>

      {error && <p className="rounded-lg bg-critical/10 p-3 text-sm text-critical">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {Array.from({ length: maximo }, (_, i) => i + 1).map((n) => {
          const elegido = estado?.limite === n;
          return (
            <button
              key={n}
              type="button"
              disabled={pidiendo !== null || !estado}
              onClick={() => elegir(n)}
              title={`Hasta ${n} campaña${n === 1 ? "" : "s"} a la vez`}
              aria-pressed={elegido}
              className={`h-11 w-11 rounded-lg border font-mono text-sm font-semibold tabular-nums transition-colors disabled:opacity-50 ${
                elegido
                  ? "border-transparent bg-primary text-primary-fg"
                  : "border-hairline bg-surface text-ink-secondary hover:bg-page hover:text-ink"
              }`}
            >
              {pidiendo === n ? "…" : n}
            </button>
          );
        })}
      </div>

      <p className="label-mono-sm">
        {!estado ? "consultando…" : `${estado.corriendo} llamando ahora · límite ${estado.limite}`}
      </p>
    </Card>
  );
}
