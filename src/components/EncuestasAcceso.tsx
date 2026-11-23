"use client";

import { useEffect, useState } from "react";
import { PhoneCall } from "lucide-react";
import { apiFetch } from "@/lib/api";
import Card from "@/components/Card";

/**
 * El switch con el que el admin abre Encuestas a los demás usuarios.
 *
 * Apagado (de fábrica): Encuestas solo lo ve y lo usa el admin. Encendido: los usuarios ven «Encuestas» en el menú y
 * pueden operar las campañas igual que el admin. Al cambiarlo, quien ya tiene el panel abierto lo nota al recargar.
 */
export default function EncuestasAcceso() {
  const [abiertas, setAbiertas] = useState<boolean | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ abiertas: boolean }>("/api/encuestas/ajustes")
      .then((r) => setAbiertas(Boolean(r.abiertas)))
      .catch(() => setAbiertas(false));
  }, []);

  async function cambiar() {
    if (abiertas === null || guardando) return;
    const siguiente = !abiertas;
    setGuardando(true);
    setError(null);
    try {
      await apiFetch("/api/encuestas/ajustes", { method: "PUT", body: JSON.stringify({ abiertas: siguiente }) });
      setAbiertas(siguiente);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGuardando(false);
    }
  }

  const encendido = abiertas === true;
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid shrink-0 place-items-center" style={{ color: "var(--gold)" }}>
          <PhoneCall className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-semibold text-ink">Encuestas para los usuarios</h2>
          <p className="mt-1 text-[13px] text-ink-secondary">
            Apagado, Encuestas solo lo ve el admin. Encendido, los usuarios ven «Encuestas» en el menú (campañas, base de
            teléfonos y resultados) y pueden llamar igual que el admin. Quien ya tenga el panel abierto lo verá al recargar.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={encendido}
          aria-label="Encuestas para los usuarios"
          disabled={abiertas === null || guardando}
          onClick={cambiar}
          className={`relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50 ${
            encendido ? "bg-primary" : "bg-hairline"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
              encendido ? "translate-x-[22px]" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      <p className="text-[13px] text-ink-secondary">
        {abiertas === null ? "Leyendo…" : encendido ? "Los usuarios ya pueden entrar a Encuestas." : "Solo el admin entra a Encuestas."}
      </p>

      {error && <p className="rounded-xl bg-critical/10 p-3 text-sm text-critical">{error}</p>}
    </Card>
  );
}
