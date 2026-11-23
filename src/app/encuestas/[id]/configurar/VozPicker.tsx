"use client";

import { useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import type { Voz } from "@/lib/encuestas/campanas";

/**
 * ESCOGER LA VOZ. Primero el género (el guion se ajusta solo: «una asistente» o «un asistente») y luego una o varias voces
 * de ese género, cada una con su muestra para oírla antes. Con varias, cada llamada sale con una al azar: tonos distintos
 * de una llamada a otra.
 */
export default function VozPicker({ voces, genero: generoInicial, elegidas }: { voces: Voz[]; genero: "F" | "M"; elegidas: string[] }) {
  const [genero, setGenero] = useState<"F" | "M">(generoInicial);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set(elegidas));
  const [sonando, setSonando] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const delGenero = voces.filter((v) => v.genero === genero);
  const cuantas = delGenero.filter((v) => marcadas.has(v.id)).length;

  const oir = (v: Voz) => {
    audio.current?.pause();
    if (sonando === v.id || !v.muestra) { setSonando(null); return; }
    const a = new Audio(v.muestra);
    audio.current = a;
    a.onended = () => setSonando(null);
    a.play().then(() => setSonando(v.id)).catch(() => setSonando(null));
  };
  const alternar = (id: string) => setMarcadas((m) => { const x = new Set(m); if (x.has(id)) x.delete(id); else x.add(id); return x; });

  return (
    <div>
      <div className="mb-3 flex rounded-lg border border-hairline bg-page p-1 text-[13px] font-semibold" role="radiogroup" aria-label="Género de la voz">
        {(["F", "M"] as const).map((g) => (
          <label key={g} className={`flex-1 cursor-pointer rounded px-3 py-1.5 text-center ${genero === g ? "bg-primary text-primary-fg" : "text-ink-muted"}`}>
            <input type="radio" name="genero" value={g} checked={genero === g} onChange={() => setGenero(g)} className="sr-only" />
            {g === "F" ? "Femenina" : "Masculina"}
          </label>
        ))}
      </div>
      {delGenero.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {delGenero.map((v) => (
            <div key={v.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${marcadas.has(v.id) ? "border-primary bg-primary/5" : "border-hairline"}`}>
              <input id={`voz-${v.id}`} type="checkbox" name="voces" value={v.id} checked={marcadas.has(v.id)} onChange={() => alternar(v.id)} className="h-4 w-4 accent-[var(--primary)]" />
              <label htmlFor={`voz-${v.id}`} className="min-w-0 flex-1 cursor-pointer">
                <span className="block truncate text-[14px] font-semibold text-ink">{v.nombre}</span>
                {v.descripcion && <span className="block truncate text-[12px] text-ink-muted">{v.descripcion}</span>}
              </label>
              {v.muestra && (
                <button type="button" onClick={() => oir(v)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-hairline text-ink-muted hover:text-primary" aria-label={sonando === v.id ? `Detener ${v.nombre}` : `Oír a ${v.nombre}`} title={sonando === v.id ? "Detener" : "Oír muestra"}>
                  {sonando === v.id ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[13px] text-ink-muted">No hay voces {genero === "F" ? "femeninas" : "masculinas"} de español de México en la cuenta de ElevenLabs. Agrégalas desde su Voice Library y aparecen aquí.</p>
      )}
      <p className="mt-2 text-[12.5px] text-ink-muted">
        {cuantas > 1 ? `${cuantas} voces: cada llamada sale con una al azar.` : cuantas === 1 ? "Una voz: todas las llamadas suenan igual. Escoge varias para variar el tono de una llamada a otra." : "Escoge al menos una."}
        {" "}Las muestras son en la voz de ElevenLabs; en la llamada dice tu guion.
      </p>
    </div>
  );
}
