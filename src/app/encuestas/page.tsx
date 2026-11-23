import Link from "next/link";
import { PhoneCall, Plus, Users, Mic, Clock, ChevronRight } from "lucide-react";
import { requireSesion } from "@/lib/encuestas/acceso";
import { ESTADOS_CAMPANA } from "@/lib/encuestas/llamadas";
import { listarCampanas, resumenDeCampanas, campanasSimultaneas, horarioDe, catalogoDeVoces } from "@/lib/encuestas/campanas";
import { avisoDeVoz, hayAgenteDeVoz, simultaneas } from "@/lib/encuestas/agente_voz";
import { fechaHoraCorta } from "@/lib/encuestas/fechas";
import { Carta, Pastilla, Aviso, n, INPUT, LABEL, BTN, BTN_PRIMARY } from "@/components/encuestas/ui";
import PageHeader from "@/components/ui/PageHeader";
import Seguir from "@/components/encuestas/Seguir";
import { BRAND_NAME } from "@/lib/brand";
import { nuevaCampana } from "./acciones";

export const dynamic = "force-dynamic";
export const metadata = { title: `Encuestas · ${BRAND_NAME}` };

/**
 * LAS CAMPAÑAS DE ENCUESTA TELEFÓNICA. Cada una con su guion, su voz, su horario, sus reglas y su lista de a quién llamar;
 * aquí se ven todas, cómo va cada una, y se crea una nueva (en blanco o copiando otra).
 */
export default async function Campanas({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { ok, error } = await searchParams;
  const s = await requireSesion();
  const campanas = await listarCampanas();
  const [resumen, limite, aviso, voces] = await Promise.all([
    resumenDeCampanas(campanas.map((c) => c.id)),
    campanasSimultaneas(),
    avisoDeVoz(),
    catalogoDeVoces(),
  ]);
  const nombreVoz = new Map(voces.map((v) => [v.id, v.nombre]));
  const corriendo = campanas.filter((c) => c.estado === "CORRIENDO").length;
  const enLinea = Object.values(resumen).reduce((a, x) => a + x.enLinea, 0);
  // Primero las que llaman, luego las que están por arrancar o en pausa, y al final las terminadas.
  const orden = { CORRIENDO: 0, PAUSADA: 1, BORRADOR: 2, TERMINADA: 3 } as const;
  const lista = [...campanas].sort((a, b) => orden[a.estado] - orden[b.estado]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        icon={<PhoneCall className="h-4 w-4" />}
        title="Campañas de encuesta"
        subtitle={`Cada campaña tiene su guion, su voz, su horario y su lista de a quién llamar · ${corriendo} de ${limite} ${limite === 1 ? "campaña" : "campañas"} llamando a la vez · ${simultaneas()} líneas`}
        right={
          s.admin ? (
            <Link href="/encuestas/base" className={BTN}>
              <Users className="h-3.5 w-3.5" /> Base de teléfonos
            </Link>
          ) : undefined
        }
      />

      <Aviso ok={ok} error={error} />
      {aviso && (
        <p className="rounded-lg border border-critical/40 bg-critical/10 px-4 py-3 text-[14px] text-ink">
          <b className="text-critical">Las llamadas no están saliendo.</b> {aviso.texto} <span className="text-ink-muted">(desde el {fechaHoraCorta(new Date(aviso.desde))})</span>
        </p>
      )}
      {!hayAgenteDeVoz() && <p className="rounded-lg bg-warning/10 px-4 py-3 text-[13px] text-warning">Falta conectar ElevenLabs (ELEVENLABS_API_KEY y ELEVENLABS_NUMERO_ID en el .env del servidor): sin eso ninguna campaña puede llamar.</p>}
      <Seguir activo={corriendo > 0 || enLinea > 0} enLinea={enLinea} />

      {s.admin && (
        <Carta id="nueva" titulo="Nueva campaña" subtitulo="Arranca en borrador: después escoges la voz, el horario y las reglas, ajustas el guion, agregas a quién llamar y haces una llamada de prueba antes de iniciar." accent="var(--steel-vivid)">
          <form action={nuevaCampana} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-[2]">
              <label className={LABEL} htmlFor="nombre">Nombre de la campaña</label>
              <input id="nombre" name="nombre" required minLength={3} maxLength={120} placeholder="Opinión ciudadana · Tijuana · noviembre" className={INPUT} />
            </div>
            <div className="min-w-[220px] flex-1">
              <label className={LABEL} htmlFor="copiarDe">Guion y configuración</label>
              <select id="copiarDe" name="copiarDe" defaultValue={campanas[0]?.id ?? ""} className={INPUT}>
                <option value="">En blanco (encuesta de ejemplo)</option>
                {campanas.map((c) => <option key={c.id} value={c.id}>Copiar de «{c.nombre}»</option>)}
              </select>
            </div>
            <button className={BTN_PRIMARY}><Plus className="h-4 w-4" /> Crear campaña</button>
          </form>
        </Carta>
      )}

      {lista.length ? (
        <section className="grid gap-4 lg:grid-cols-2">
          {lista.map((c) => {
            const r = resumen[c.id];
            const e = ESTADOS_CAMPANA[c.estado];
            const h = horarioDe(c);
            const avance = r.destinatarios ? Math.round(((r.destinatarios - r.pendientes) / r.destinatarios) * 100) : 0;
            const vocesTxt = c.voz.voces.map((v) => nombreVoz.get(v) ?? "voz").join(", ");
            return (
              <Link key={c.id} href={`/encuestas/${c.id}`} className="card-surface group block p-5 transition-colors hover:border-primary/50" style={{ ["--edge-c" as string]: e.color }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-display truncate text-[17px] font-semibold text-ink">{c.nombre}</h2>
                    <p className="mt-0.5 text-[12.5px] text-ink-muted">
                      {c.preguntas.length} {c.preguntas.length === 1 ? "pregunta" : "preguntas"} · creada {c.creada ? fechaHoraCorta(new Date(c.creada)) : "antes"}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-2">
                    <Pastilla color={e.color}>{c.estado === "CORRIENDO" && !h.abierto ? "Esperando horario" : e.label}</Pastilla>
                    <ChevronRight className="h-4 w-4 text-ink-muted transition-colors group-hover:text-primary" />
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-lg bg-surface-2 px-2 py-2">
                    <p className="font-mono text-[20px] font-semibold tabular-nums text-ink">{n(r.destinatarios)}</p>
                    <p className="text-[11.5px] text-ink-muted">destinatarios</p>
                  </div>
                  <div className="rounded-lg bg-surface-2 px-2 py-2">
                    <p className="font-mono text-[20px] font-semibold tabular-nums text-ink">{n(r.llamadas)}</p>
                    <p className="text-[11.5px] text-ink-muted">llamadas{r.enLinea ? ` · ${r.enLinea} en línea` : ""}</p>
                  </div>
                  <div className="rounded-lg bg-surface-2 px-2 py-2">
                    <p className="font-mono text-[20px] font-semibold tabular-nums" style={{ color: "var(--status-good)" }}>{n(r.completas)}</p>
                    <p className="text-[11.5px] text-ink-muted">completas</p>
                  </div>
                </div>
                {r.destinatarios > 0 && (
                  <div className="mt-3">
                    <div className="h-1.5 overflow-hidden rounded-full bg-page">
                      <div className="enc-barra h-full rounded-full" style={{ width: `${avance}%`, background: e.color }} />
                    </div>
                    <p className="mt-1 text-[11.5px] text-ink-muted">{avance}% de la lista ya tuvo al menos una llamada · {n(r.pendientes)} sin llamar</p>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-secondary">
                  <span className="inline-flex items-center gap-1.5"><Mic className="h-3.5 w-3.5 text-ink-muted" /> {c.voz.genero === "M" ? "Masculina" : "Femenina"}{vocesTxt ? `: ${vocesTxt}` : ""}</span>
                  <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-ink-muted" /> {h.texto}</span>
                </div>
                {c.etiquetas.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {c.etiquetas.map((t) => <span key={t} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{t}</span>)}
                  </div>
                )}
                {c.motivo && c.estado !== "CORRIENDO" && <p className="mt-2 text-[12px] text-ink-muted">{c.motivo}</p>}
              </Link>
            );
          })}
        </section>
      ) : (
        <p className="card-surface py-10 text-center text-[14px] text-ink-muted">Todavía no hay campañas. {s.admin ? "Crea la primera arriba." : "Cuando alguien cree una, aparece aquí."}</p>
      )}
    </div>
  );
}
