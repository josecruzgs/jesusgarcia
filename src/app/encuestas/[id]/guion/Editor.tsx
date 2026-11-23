"use client";

import { useActionState, useState } from "react";
import { Bot, Plus, ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import { guardarGuion, type GuionEditado, type Resultado } from "./acciones";
import type { Frases } from "@/lib/encuestas/guion";
import { INPUT, LABEL, BTN, BTN_PRIMARY } from "@/components/encuestas/ui";

/**
 * EL EDITOR DEL GUION. Todo lo que dice la asistente, en el orden en que lo dice, con el tiempo aproximado que tarda en
 * decirlo: en el teléfono cada segundo de introducción es gente que cuelga.
 */
const segundos = (t: string) => Math.max(1, Math.round(t.trim().split(/\s+/).filter(Boolean).length / 2.6));

type Props = {
  campanaId: string;
  inicial: GuionEditado;
  /** El guion con el número de preguntas corregido, cuando el guardado dice otro: el editor arranca con este. */
  corregido?: GuionEditado;
  rotulos: Record<keyof Frases, string>;
  respuestasPorOpcion: Record<string, Record<string, number>>; // preguntaId → opción → respuestas
};

export default function Editor({ campanaId, inicial, corregido, rotulos, respuestasPorOpcion }: Props) {
  const [g, setG] = useState<GuionEditado>(corregido ?? inicial);
  const [estado, accion, guardando] = useActionState<Resultado, FormData>(guardarGuion, undefined);
  const cambiado = JSON.stringify(g) !== JSON.stringify(inicial);

  const ponPregunta = (i: number, cambio: Partial<GuionEditado["preguntas"][number]>) =>
    setG((x) => ({ ...x, preguntas: x.preguntas.map((p, k) => (k === i ? { ...p, ...cambio } : p)) }));
  const [porQuitar, setPorQuitar] = useState<string | null>(null);
  const totalDe = (id: string) => Object.values(respuestasPorOpcion[id] ?? {}).reduce((a, x) => a + x, 0);
  const mover = (i: number, d: -1 | 1) =>
    setG((x) => {
      const ps = [...x.preguntas];
      [ps[i], ps[i + d]] = [ps[i + d], ps[i]];
      return { ...x, preguntas: ps };
    });
  const quitar = (id: string) => { setPorQuitar(null); setG((x) => ({ ...x, preguntas: x.preguntas.filter((p) => p.id !== id) })); };
  // El id provisional («nueva-…») lo reconoce guardarGuion y le da uno de verdad al guardar.
  const agregar = () =>
    setG((x) => ({
      ...x,
      preguntas: [...x.preguntas, { id: `nueva-${Date.now()}`, texto: "", corto: "", reglas: "", opciones: [{ original: null, texto: "", seLee: true }, { original: null, texto: "", seLee: true }, { original: null, texto: "No sabe", seLee: false }] }],
    }));
  const ponOpcion = (i: number, j: number, cambio: Partial<GuionEditado["preguntas"][number]["opciones"][number]>) =>
    ponPregunta(i, { opciones: g.preguntas[i].opciones.map((o, k) => (k === j ? { ...o, ...cambio } : o)) });

  return (
    <form action={accion} className="space-y-5">
      <input type="hidden" name="campana" value={campanaId} />
      <input type="hidden" name="datos" value={JSON.stringify(g)} />

      <Bloque titulo={<><Bot className="h-4 w-4 text-primary" /> Introducción</>} ayuda="Lo primero que oye la persona. Corto, diciendo quién llama y pidiendo permiso." texto={g.saludo}>
        <textarea value={g.saludo} onChange={(e) => setG({ ...g, saludo: e.target.value })} rows={3} maxLength={400} className={`${INPUT} text-[15px] leading-relaxed`} />
      </Bloque>

      {g.preguntas.map((p, i) => (
        <Bloque
          key={p.id}
          titulo={<>Pregunta {i + 1}{p.id.startsWith("nueva-") && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">Nueva</span>}</>}
          ayuda="Escríbela tal como la dice la asistente, con las opciones que sí se leen dentro de la pregunta."
          texto={p.texto}
          acciones={
            <>
              <button type="button" disabled={i === 0} onClick={() => mover(i, -1)} className="rounded p-1 text-ink-muted hover:text-ink disabled:opacity-30" aria-label="Subir pregunta" title="Subir"><ArrowUp className="h-4 w-4" /></button>
              <button type="button" disabled={i === g.preguntas.length - 1} onClick={() => mover(i, 1)} className="rounded p-1 text-ink-muted hover:text-ink disabled:opacity-30" aria-label="Bajar pregunta" title="Bajar"><ArrowDown className="h-4 w-4" /></button>
              {g.preguntas.length > 1 && (
                <button type="button" onClick={() => (totalDe(p.id) ? setPorQuitar(p.id) : quitar(p.id))} className="rounded p-1 text-critical hover:opacity-80" aria-label="Quitar pregunta" title="Quitar pregunta"><Trash2 className="h-4 w-4" /></button>
              )}
            </>
          }
        >
          {porQuitar === p.id && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-critical/10 px-3 py-2 text-[13px] text-critical">
              <span className="flex-1">Esta pregunta ya tiene {totalDe(p.id)} {totalDe(p.id) === 1 ? "respuesta" : "respuestas"}. Si la quitas deja de hacerse y de verse en el tablero; las respuestas se quedan guardadas en sus llamadas.</span>
              <button type="button" onClick={() => quitar(p.id)} className="font-semibold underline">Sí, quitarla</button>
              <button type="button" onClick={() => setPorQuitar(null)} className="text-ink-muted underline">Cancelar</button>
            </div>
          )}
          <textarea value={p.texto} onChange={(e) => ponPregunta(i, { texto: e.target.value })} rows={3} maxLength={500} placeholder="¿…? Escribe la pregunta con las opciones que se leen." className={`${INPUT} text-[15px] font-medium leading-relaxed`} />
          <div className="mt-3">
            <label className={LABEL}>Respuestas que se registran</label>
            <div className="space-y-2">
              {p.opciones.map((o, j) => {
                const cuantas = o.original ? respuestasPorOpcion[p.id]?.[o.original] ?? 0 : 0;
                return (
                  <div key={j} className="flex flex-wrap items-center gap-2">
                    <input value={o.texto} onChange={(e) => ponOpcion(i, j, { texto: e.target.value })} maxLength={60} placeholder="Nueva opción" className={`${INPUT} !w-auto min-w-[180px] flex-1`} />
                    <label className={`flex cursor-pointer select-none items-center gap-1.5 whitespace-nowrap text-[13px] ${o.seLee ? "text-ink" : "text-ink-muted"}`}>
                      <input type="checkbox" checked={o.seLee} onChange={(e) => ponOpcion(i, j, { seLee: e.target.checked })} className="h-4 w-4 accent-[var(--primary)]" />
                      Se dice en voz alta
                    </label>
                    {cuantas > 0 ? (
                      <span className="whitespace-nowrap text-[12px] text-ink-muted" title="Ya tiene respuestas: se puede renombrar, no quitar">{cuantas} {cuantas === 1 ? "respuesta" : "respuestas"}</span>
                    ) : (
                      <button type="button" onClick={() => ponPregunta(i, { opciones: p.opciones.filter((_, k) => k !== j) })} className="px-2 text-[13px] font-semibold text-critical" aria-label={`Quitar ${o.texto || "opción"}`}>Quitar</button>
                    )}
                  </div>
                );
              })}
            </div>
            {p.opciones.length < 12 && (
              <button type="button" onClick={() => ponPregunta(i, { opciones: [...p.opciones, { original: null, texto: "", seLee: true }] })} className={`${BTN} mt-2`}>
                <Plus className="h-3.5 w-3.5" /> Agregar opción
              </button>
            )}
            <p className="mt-2 text-[12px] text-ink-muted">
              Las que no se dicen en voz alta (como «No sabe») se registran igual si la persona las contesta. Cambiarle el nombre a una opción se lleva sus respuestas.
            </p>
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer text-[13px] font-semibold text-primary">Más: título en el tablero e indicaciones para la asistente</summary>
            <div className="mt-2 space-y-3">
              <div>
                <label className={LABEL}>Título en las gráficas</label>
                <input value={p.corto} onChange={(e) => ponPregunta(i, { corto: e.target.value })} maxLength={140} placeholder={p.texto || "Vacío: se usa el texto de la pregunta"} className={INPUT} />
                <p className="mt-1 text-[12px] text-ink-muted">Vacío: las gráficas usan el texto de la pregunta. Si cambias el texto, el título viejo se quita solo.</p>
              </div>
              <div>
                <label className={LABEL}>Indicaciones (una por renglón)</label>
                <textarea value={p.reglas} onChange={(e) => ponPregunta(i, { reglas: e.target.value })} rows={3} maxLength={1200} placeholder="Si menciona otro problema, registras «Otro»." className={`${INPUT} text-[13.5px]`} />
              </div>
            </div>
          </details>
        </Bloque>
      ))}

      {g.preguntas.length < 8 ? (
        <button type="button" onClick={agregar} className={`${BTN} w-full justify-center border-dashed py-3`}>
          <Plus className="h-4 w-4" /> Agregar pregunta
        </button>
      ) : (
        <p className="text-center text-[13px] text-ink-muted">Máximo 8 preguntas: por teléfono, con más la gente cuelga.</p>
      )}
      {g.preguntas.length !== inicial.preguntas.length && (
        <p className="rounded-lg bg-warning/10 px-4 py-3 text-[13px] text-warning">
          Cambió el número de preguntas: al guardar, donde la introducción o las respuestas digan «dos preguntas» (o cualquier número) se cambia solo a {g.preguntas.length === 1 ? "una pregunta" : `${["", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho"][g.preguntas.length]} preguntas`}. Revisa que el resto del texto siga teniendo sentido.
        </p>
      )}

      <Bloque titulo="Despedida" ayuda="Al terminar la última pregunta." texto={g.cierre}>
        <textarea value={g.cierre} onChange={(e) => setG({ ...g, cierre: e.target.value })} rows={2} maxLength={300} className={`${INPUT} text-[15px]`} />
      </Bloque>

      <section className="card-surface p-5">
        <h2 className="font-display text-[17px] font-semibold text-ink">Lo que contesta en cada situación</h2>
        <p className="mb-4 mt-1 text-[13px] text-ink-muted">Si la persona no quiere, pide que no le llamen o pregunta quién habla. Después de no querer o de pedir que no le llamen, cuelga.</p>
        <div className="grid gap-4 md:grid-cols-2">
          {(Object.keys(rotulos) as (keyof Frases)[]).map((k) => (
            <div key={k}>
              <label className={LABEL}>{rotulos[k]}</label>
              <textarea value={g.frases[k]} onChange={(e) => setG({ ...g, frases: { ...g.frases, [k]: e.target.value } })} rows={2} maxLength={300} className={`${INPUT} text-[14px]`} />
            </div>
          ))}
        </div>
      </section>

      <div className="sticky bottom-0 z-20 flex flex-wrap items-center gap-3 rounded-lg border border-hairline bg-surface/95 px-4 py-3 shadow-lg backdrop-blur">
        <button disabled={!cambiado || guardando} className={BTN_PRIMARY}>{guardando ? "Guardando y avisando a la asistente…" : "Guardar cambios"}</button>
        {cambiado && !guardando && <button type="button" onClick={() => setG(inicial)} className="text-[13px] font-semibold text-ink-muted underline">Deshacer</button>}
        <span className="text-[13px] text-ink-muted">
          Llamada completa ≈ <b className="text-ink">{segundos([g.saludo, ...g.preguntas.map((p) => p.texto), g.cierre].join(" "))} s</b> de la asistente hablando
        </span>
        {estado?.ok && <p className="w-full rounded-lg bg-success/10 px-3 py-2 text-[13.5px] text-success">{estado.ok}</p>}
        {estado?.error && <p className="w-full rounded-lg bg-critical/10 px-3 py-2 text-[13.5px] text-critical">{estado.error}</p>}
      </div>
    </form>
  );
}

function Bloque({ titulo, ayuda, texto, acciones, children }: { titulo: React.ReactNode; ayuda: string; texto: string; acciones?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card-surface p-5">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display flex items-center gap-1.5 text-[17px] font-semibold text-ink">{titulo}</h2>
        <span className="flex items-center gap-1">
          <span className="font-mono text-[12px] font-semibold text-primary">≈ {segundos(texto)} s</span>
          {acciones && <span className="ml-2 flex items-center">{acciones}</span>}
        </span>
      </div>
      <p className="mb-3 text-[13px] text-ink-muted">{ayuda}</p>
      {children}
    </section>
  );
}
