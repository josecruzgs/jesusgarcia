import Link from "next/link";
import { notFound } from "next/navigation";
import { Settings2, ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/encuestas/acceso";
import { leerCampana } from "@/lib/encuestas/llamadas";
import { asegurarCampanas, catalogoDeVoces, DIAS_CORTOS, horarioDe } from "@/lib/encuestas/campanas";
import { simultaneas } from "@/lib/encuestas/agente_voz";
import { Carta, Aviso, INPUT, LABEL, BTN, BTN_PRIMARY } from "@/components/encuestas/ui";
import PageHeader from "@/components/ui/PageHeader";
import { BRAND_NAME } from "@/lib/brand";
import VozPicker from "./VozPicker";
import { guardarConfiguracion } from "../../acciones";

export const dynamic = "force-dynamic";
export const metadata = { title: `Configurar campaña · ${BRAND_NAME}` };

const HORAS = Array.from({ length: 25 }, (_, h) => h);

/**
 * LOS PARÁMETROS DE UNA CAMPAÑA, como en una plataforma de llamadas robotizadas: nombre y etiquetas, voz, horario
 * permitido y opciones avanzadas (reintentos, contestador, llamadas a la vez, tope y meta). Al guardar se actualiza la
 * asistente de la campaña en ElevenLabs.
 */
export default async function Configurar({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params;
  const { ok, error } = await searchParams;
  await requireAdmin();
  await asegurarCampanas();
  const c = await leerCampana(id);
  if (!c) notFound();
  const voces = await catalogoDeVoces();
  const lineas = simultaneas();
  const todoElDia = c.horario.desde <= 0 && c.horario.hasta >= 24;

  return (
    <div className="mx-auto flex max-w-[920px] flex-col gap-5">
      <PageHeader
        icon={<Settings2 className="h-4 w-4" />}
        title="Configurar la campaña"
        subtitle={c.nombre}
        right={<Link href={`/encuestas/${c.id}`} className={BTN}><ArrowLeft className="h-3.5 w-3.5" /> Volver a la campaña</Link>}
      />
      <Aviso ok={ok} error={error} />
      {c.estado === "CORRIENDO" && (
        <p className="rounded-lg bg-warning/10 px-4 py-3 text-[13px] text-warning">La campaña está llamando: lo que cambies aquí aplica desde la siguiente llamada.</p>
      )}

      <form action={guardarConfiguracion} className="flex flex-col gap-5">
        <input type="hidden" name="campana" value={c.id} />

        <Carta titulo="Nombre">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor="nombre">Nombre de la campaña</label>
              <input id="nombre" name="nombre" defaultValue={c.nombre} required minLength={3} maxLength={120} className={INPUT} />
            </div>
            <div>
              <label className={LABEL} htmlFor="etiquetas">Etiquetas (separadas por coma)</label>
              <input id="etiquetas" name="etiquetas" defaultValue={c.etiquetas.join(", ")} placeholder="Tijuana, noviembre, gobierno" className={INPUT} />
            </div>
          </div>
        </Carta>

        <Carta id="voz" titulo="Voz" subtitulo="Español de México. Con voz masculina, el guion dice «un asistente virtual» en vez de «una asistente virtual» sin que tengas que editarlo.">
          <VozPicker voces={voces} genero={c.voz.genero} elegidas={c.voz.voces} />
        </Carta>

        <Carta id="horario" titulo="Horario permitido" subtitulo={`En hora de Baja California. Ahora: ${horarioDe(c).texto}. Fuera de horario la campaña espera y sigue sola cuando abre; las pruebas salen a cualquier hora.`}>
          <label className="mb-3 flex items-center gap-2 text-[13.5px] text-ink">
            <input type="checkbox" name="todoElDia" defaultChecked={todoElDia} className="h-4 w-4 accent-[var(--primary)]" /> Las 24 horas
          </label>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className={LABEL} htmlFor="desde">Desde</label>
              <select id="desde" name="desde" defaultValue={todoElDia ? 9 : c.horario.desde} className={`${INPUT} !w-32`}>
                {HORAS.slice(0, 24).map((h) => <option key={h} value={h}>{h}:00</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL} htmlFor="hasta">Hasta</label>
              <select id="hasta" name="hasta" defaultValue={todoElDia ? 20 : c.horario.hasta} className={`${INPUT} !w-32`}>
                {HORAS.slice(1).map((h) => <option key={h} value={h}>{h}:00</option>)}
              </select>
            </div>
            <span className="pb-2.5 text-[12.5px] text-ink-muted">Se ignora con «Las 24 horas».</span>
          </div>
          <p className={`${LABEL} mt-4`}>Días</p>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <label key={d} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-[13px] has-[:checked]:border-primary has-[:checked]:bg-primary/10 has-[:checked]:text-primary">
                <input type="checkbox" name="dias" value={d} defaultChecked={c.horario.dias.includes(d)} className="h-3.5 w-3.5 accent-[var(--primary)]" />
                {DIAS_CORTOS[d]}
              </label>
            ))}
          </div>
        </Carta>

        <Carta titulo="Opciones avanzadas">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor="intentos">Reintentos de llamada</label>
              <select id="intentos" name="intentos" defaultValue={c.reintentos.intentos} className={INPUT}>
                <option value={1}>Sin reintentos (un solo intento)</option>
                {[2, 3, 4, 5, 6, 8, 10].map((x) => <option key={x} value={x}>Hasta {x} intentos por persona</option>)}
              </select>
              <p className="mt-1 text-[12px] text-ink-muted">Solo a quien no contestó o cayó en buzón. A quien contestó no se le vuelve a marcar.</p>
            </div>
            <div>
              <label className={LABEL} htmlFor="esperaMin">Minutos entre un intento y otro</label>
              <input id="esperaMin" name="esperaMin" inputMode="numeric" defaultValue={c.reintentos.esperaMin} className={INPUT} />
              <p className="mt-1 text-[12px] text-ink-muted">Mínimo 5. Siempre dentro del horario.</p>
            </div>
            <div>
              <label className={LABEL} htmlFor="lineas">Modo de envío</label>
              <select id="lineas" name="lineas" defaultValue={c.lineas} className={INPUT}>
                <option value={0}>Todas las líneas libres (hay {lineas})</option>
                {Array.from({ length: lineas }, (_, i) => i + 1).map((x) => <option key={x} value={x}>{x} {x === 1 ? "llamada" : "llamadas"} a la vez</option>)}
              </select>
              <p className="mt-1 text-[12px] text-ink-muted">Las líneas se reparten entre las campañas que estén llamando.</p>
            </div>
            <div>
              <label className={LABEL} htmlFor="tope">Tope de llamadas (el «coste límite»)</label>
              <input id="tope" name="tope" inputMode="numeric" defaultValue={c.tope || ""} placeholder="Sin tope" className={INPUT} />
              <p className="mt-1 text-[12px] text-ink-muted">Al llegar a este número de llamadas reales, la campaña termina sola.</p>
            </div>
            <div>
              <label className={LABEL} htmlFor="meta">Meta de contacto (%)</label>
              <input id="meta" name="meta" inputMode="numeric" defaultValue={c.meta || ""} placeholder="Sin meta: hasta acabar la lista" className={INPUT} />
              <p className="mt-1 text-[12px] text-ink-muted">Termina al hablar con este porcentaje de los destinatarios.</p>
            </div>
            <label className="flex items-start gap-2 pt-5 text-[13.5px] text-ink">
              <input type="checkbox" name="buzon" defaultChecked={c.buzon} className="mt-0.5 h-4 w-4 accent-[var(--primary)]" />
              <span>Detección de contestador automático<span className="block text-[12px] text-ink-muted">Si cae en buzón, la asistente cuelga sin dejar mensaje.</span></span>
            </label>
          </div>
        </Carta>

        <div className="sticky bottom-0 z-20 flex flex-wrap items-center gap-3 rounded-lg border border-hairline bg-surface/95 px-4 py-3 shadow-lg backdrop-blur">
          <button className={BTN_PRIMARY}>Guardar configuración</button>
          <Link href={`/encuestas/${c.id}/guion`} className="text-[13px] font-semibold text-primary underline">Editar el guion y las preguntas</Link>
        </div>
      </form>
    </div>
  );
}
