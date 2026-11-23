import Link from "next/link";
import { notFound } from "next/navigation";
import { Bot, Download, Phone, PhoneCall, PencilLine, RefreshCw, Settings2, Play, Pause, Square, Trash2, Upload, Check, Circle, ArrowLeft } from "lucide-react";
import EncuestaLlamadaModel from "@/lib/models/EncuestaLlamada";
import { requireSesion } from "@/lib/encuestas/acceso";
import { leerCampana, resultadosLlamadas, respuestasDe, telefonoVisible, buscarLlamadas, ESTADOS_LLAMADA, ESTADOS_CAMPANA, leerOpciones } from "@/lib/encuestas/llamadas";
import { hayAgenteDeVoz, avisoDeVoz, progresoDe, simultaneas, hayLlamadasEnCurso } from "@/lib/encuestas/agente_voz";
import { asegurarCampanas, conteoDestinatarios, horarioDe, catalogoDeVoces, campanasSimultaneas, campanasCorriendo } from "@/lib/encuestas/campanas";
import { segmentos } from "@/lib/encuestas/base";
import { COLOR_OPCION, COLOR_PERSONA } from "@/lib/encuestas/encuesta";
import { fechaHoraCorta, mmss } from "@/lib/encuestas/fechas";
import { Carta, Kpi, Barra, Pastilla, Aviso, n, INPUT, LABEL, BTN, BTN_PRIMARY } from "@/components/encuestas/ui";
import PageHeader from "@/components/ui/PageHeader";
import Seguir from "@/components/encuestas/Seguir";
import Platica from "@/components/encuestas/Platica";
import { BRAND_NAME } from "@/lib/brand";
import {
  llamarNumero, traerLlamadas, subirBase, iniciarCampana, pausarCampana, terminarCampana, eliminarCampana, agregarDeMiBase, quitarPendientes,
} from "../acciones";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const c = await leerCampana((await params).id);
  return { title: `${c?.nombre ?? "Campaña"} · ${BRAND_NAME}` };
}

/** Margen de error al 95% para una proporción, en el peor caso (50%): lo que una casa encuestadora pone al pie. */
const margen = (base: number) => (base >= 30 ? Math.round((98 / Math.sqrt(base)) * 10) / 10 : null);
const ROTULO_DEST: Record<string, string> = { PENDIENTE: "Sin llamar", NO_LLAMAR: "Pidió que no le llamen", ...Object.fromEntries(Object.entries(ESTADOS_LLAMADA).map(([k, v]) => [k, v.label])) };
const COLOR_DEST: Record<string, string> = { PENDIENTE: "var(--primary)", NO_LLAMAR: "var(--status-critical)", ...Object.fromEntries(Object.entries(ESTADOS_LLAMADA).map(([k, v]) => [k, v.color])) };

type Busqueda = { ok?: string; error?: string; pruebas?: string; municipio?: string; distrito?: string; seccion?: string; de?: string };

export default async function TableroCampana({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Busqueda> }) {
  const { id } = await params;
  const { ok, error, pruebas: verPruebas, municipio = "", distrito = "", seccion = "", de } = await searchParams;
  // El resultado de «Llamarme» va en su tarjeta, no arriba: la página vuelve anclada ahí.
  const delProbar = de === "probar";
  const s = await requireSesion();
  const admin = s.admin;
  await asegurarCampanas();
  const c = await leerCampana(id);
  if (!c) notFound();
  const aqui = `/encuestas/${c.id}`;

  // Las llamadas de prueba (las de «Llamarme») entran a las estadísticas si se pide, o solas mientras la campaña todavía
  // no tiene ninguna llamada: así se ve cómo quedan los resultados antes de arrancar. Siempre se dice cuántas son de prueba.
  const deCampana = await EncuestaLlamadaModel.countDocuments({ cuestionarioId: c.id, prueba: false, estado: { $nin: ["NO_SALIO", "EN_CURSO"] } });
  // El filtro de municipio, distrito y sección sale de la base que este usuario ve en claro (lo suyo y lo compartido): las opciones
  // nunca enseñan lo de una base ajena. Con filtro no hay pruebas: esas llamadas no son de nadie de la base.
  const seg = await segmentos(s.id, { municipio, distrito, seccion });
  const filtrado = !!seg.contactoIds;
  const zona = [municipio && `Municipio: ${municipio}`, distrito && `Distrito: ${distrito}`, seccion && `Sección: ${seccion}`].filter(Boolean).join(" · ");
  const conPruebas = !filtrado && (verPruebas === "1" || (verPruebas !== "0" && deCampana === 0));
  const liga = (cambio: Record<string, string>) => {
    const u = new URLSearchParams({ ...(municipio ? { municipio } : {}), ...(distrito ? { distrito } : {}), ...(seccion ? { seccion } : {}), ...(verPruebas ? { pruebas: verPruebas } : {}), ...cambio });
    for (const [k, v] of [...u.entries()]) if (!v) u.delete(k);
    return u.toString() ? `?${u}` : "";
  };
  const [real, enLinea, progreso, dest, aviso, pruebas, voces, limite, otras] = await Promise.all([
    resultadosLlamadas(c, { conPruebas, contactoIds: seg.contactoIds }),
    hayLlamadasEnCurso(c.id),
    progresoDe(c),
    conteoDestinatarios(c.id),
    avisoDeVoz(),
    admin ? buscarLlamadas({ cuestionarioId: c.id, prueba: true }, { limite: 3 }) : Promise.resolve([]),
    catalogoDeVoces(),
    campanasSimultaneas(),
    campanasCorriendo(c.id),
  ]);
  const opcionesBase = admin ? await segmentos(s.id, {}) : null;
  const h = horarioDe(c);
  const conAgente = hayAgenteDeVoz();
  const llamando = c.estado === "CORRIENDO";
  const e = ESTADOS_CAMPANA[c.estado];
  const hechas = real.llamadas.filter((l) => l.estado !== "EN_CURSO");
  const pocas = real.completas < 100;
  const estadoTxt = aviso && llamando ? "No están saliendo" : llamando && !h.abierto ? "Esperando horario" : e.label;
  const estadoColor = aviso && llamando ? "var(--status-critical)" : e.color;
  const nombreVoz = new Map(voces.map((v) => [v.id, v.nombre]));
  const vocesTxt = c.voz.voces.map((v) => nombreVoz.get(v) ?? "voz sin nombre").join(", ") || "sin escoger";
  const listo = {
    voz: c.voz.voces.length > 0,
    asistente: !!c.agenteId,
    destinatarios: dest.total > 0,
    prueba: (await EncuestaLlamadaModel.countDocuments({ cuestionarioId: c.id, prueba: true, estado: { $nin: ["NO_SALIO"] } })) > 0,
  };
  const sinLugar = !llamando && otras >= limite;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        icon={<PhoneCall className="h-4 w-4" />}
        title={c.nombre}
        subtitle={`${c.preguntas.length} ${c.preguntas.length === 1 ? "pregunta" : "preguntas"} · llama ${h.texto} (hora de Baja California)`}
        right={
          <>
            <Link href="/encuestas" className={BTN}><ArrowLeft className="h-3.5 w-3.5" /> Campañas</Link>
            {admin && <Link href={`${aqui}/configurar`} className={BTN}><Settings2 className="h-3.5 w-3.5" /> Configurar</Link>}
            {admin && <Link href={`${aqui}/guion`} className={BTN}><PencilLine className="h-3.5 w-3.5" /> Editar el guion</Link>}
            <span className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-semibold" style={{ background: `color-mix(in srgb, ${estadoColor} 14%, transparent)`, color: estadoColor }}>
              <span className={`h-2 w-2 rounded-full ${llamando ? "animate-pulse" : ""}`} style={{ background: estadoColor }} /> {estadoTxt}
            </span>
          </>
        }
      />

      {!delProbar && <Aviso ok={ok} error={error} />}

      {admin && (
        <Carta titulo="La campaña" subtitulo={llamando ? "Llama sola a su lista con sus reglas; el servidor sigue aunque cierres esta pantalla. Al colgar, cada llamada se registra sola." : "Revisa la configuración, agrega a quién llamar y haz una prueba antes de iniciar."} accent={e.color}>
          {aviso && (
            <p className="mb-4 rounded-lg border border-critical/40 bg-critical/10 px-4 py-3 text-[14px] text-ink">
              <b className="text-critical">Las llamadas no están saliendo.</b> {aviso.texto} <span className="text-ink-muted">(desde el {fechaHoraCorta(new Date(aviso.desde))})</span>
            </p>
          )}
          <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
            <Dato t="Voz">{c.voz.genero === "M" ? "Masculina" : "Femenina"} · {vocesTxt}{c.voz.voces.length > 1 ? " (una al azar en cada llamada)" : ""}</Dato>
            <Dato t="Horario">{h.texto}</Dato>
            <Dato t="Reintentos">{c.reintentos.intentos <= 1 ? "Sin reintentos" : `Hasta ${c.reintentos.intentos} intentos, cada ${c.reintentos.esperaMin} min`}</Dato>
            <Dato t="Llamadas a la vez">{c.lineas > 0 ? `${c.lineas} (de ${simultaneas()} líneas)` : `Las líneas libres (hay ${simultaneas()})`}</Dato>
            <Dato t="Termina">{[c.meta > 0 && `al hablar con el ${c.meta}%`, c.tope > 0 && `a las ${n(c.tope)} llamadas`].filter(Boolean).join(" o ") || "al acabar la lista"}</Dato>
            <Dato t="Contestador">{c.buzon ? "Si cae en buzón, cuelga sin dejar mensaje" : "Sin detección de contestador"}</Dato>
          </dl>
          {c.etiquetas.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">{c.etiquetas.map((t) => <span key={t} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{t}</span>)}</div>
          )}

          {c.estado === "BORRADOR" && (
            <ul className="mt-4 grid gap-1.5 rounded-lg bg-surface-2 px-4 py-3 text-[13px] sm:grid-cols-2">
              <Paso hecho={listo.voz}>Voz escogida <Link href={`${aqui}/configurar`} className="text-primary underline">configurar</Link></Paso>
              <Paso hecho={listo.asistente}>Asistente creada en ElevenLabs</Paso>
              <Paso hecho={listo.destinatarios}>Destinatarios agregados <a href="#destinatarios" className="text-primary underline">agregar</a></Paso>
              <Paso hecho={listo.prueba}>Llamada de prueba hecha <a href="#probar" className="text-primary underline">probar</a></Paso>
            </ul>
          )}

          <div className={`mt-4 rounded-lg border px-4 py-3 ${c.estado === "TERMINADA" ? "border-success/40" : "border-hairline"} bg-surface-2`}>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <p className="text-[14px] font-semibold text-ink">
                {progreso.total ? `Se ha hablado con ${progreso.pct}% de la lista` : "La lista está vacía"}
                {c.meta > 0 && <span className="font-normal text-ink-muted"> · meta {c.meta}%</span>}
              </p>
              <span className="font-mono text-[13px] tabular-nums text-ink-muted">
                {n(progreso.hablaron)} de {n(progreso.total)} · {n(progreso.pendientes)} sin llamar · {n(progreso.reintentables)} por volver a marcar
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-page">
              <div className="enc-barra h-full rounded-full" style={{ width: `${Math.min(100, (progreso.pct / Math.max(1, c.meta || 100)) * 100)}%`, background: c.estado === "TERMINADA" ? "var(--status-good)" : "var(--primary)" }} />
            </div>
            {c.motivo && <p className="mt-2 text-[12.5px] text-ink-muted">{c.motivo}</p>}
          </div>

          <div className="mt-3"><Seguir activo={llamando || enLinea > 0} enLinea={enLinea} /></div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {(c.estado === "BORRADOR" || c.estado === "PAUSADA" || c.estado === "TERMINADA") && (
              <form action={iniciarCampana}>
                <input type="hidden" name="campana" value={c.id} />
                <button disabled={!conAgente || sinLugar} className={BTN_PRIMARY}><Play className="h-4 w-4" /> {c.estado === "BORRADOR" ? "Iniciar campaña" : "Reanudar"}</button>
              </form>
            )}
            {llamando && (
              <form action={pausarCampana}>
                <input type="hidden" name="campana" value={c.id} />
                <button className={BTN}><Pause className="h-3.5 w-3.5" /> Pausar</button>
              </form>
            )}
            {(llamando || c.estado === "PAUSADA") && (
              <form action={terminarCampana}>
                <input type="hidden" name="campana" value={c.id} />
                <button className={`${BTN} !text-critical`}><Square className="h-3.5 w-3.5" /> Terminar</button>
              </form>
            )}
            {c.estado === "BORRADOR" && deCampana === 0 && (
              <form action={eliminarCampana} className="ml-auto">
                <input type="hidden" name="campana" value={c.id} />
                <button className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-critical underline"><Trash2 className="h-3.5 w-3.5" /> Eliminar borrador</button>
              </form>
            )}
            {sinLugar && <span className="text-[12.5px] text-ink-muted">Ya {otras === 1 ? "hay 1 campaña llamando" : `hay ${otras} campañas llamando`} (límite {limite}). Pausa otra o sube el límite en Ajustes.</span>}
            {llamando && !h.abierto && <span className="text-[12.5px] text-ink-muted">Fuera de horario: sigue sola {h.texto}.</span>}
          </div>
        </Carta>
      )}

      {admin && (
        <section className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <Carta id="destinatarios" titulo="Destinatarios" subtitulo={dest.total ? `${n(dest.total)} ${dest.total === 1 ? "teléfono" : "teléfonos"} en esta campaña. Un mismo número puede estar en varias campañas; a quien pidió que no le llamen no le llama ninguna.` : "A quién llama esta campaña: sube un archivo o toma contactos de tu base."}>
            {dest.total > 0 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {Object.entries(dest.porEstado).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                  <Pastilla key={k} color={COLOR_DEST[k] ?? "var(--text-muted)"}>{ROTULO_DEST[k] ?? k}: {n(v)}</Pastilla>
                ))}
              </div>
            )}
            <form action={subirBase} className="space-y-3">
              <input type="hidden" name="campana" value={c.id} />
              <div>
                <label className={LABEL} htmlFor="archivo">Subir un archivo de Excel (.xlsx) o CSV</label>
                <input id="archivo" name="archivo" type="file" accept=".xlsx,.csv,.txt,.tsv" className={`${INPUT} !py-1.5`} />
              </div>
              <div>
                <label className={LABEL} htmlFor="pegado">…o pegar la columna de teléfonos</label>
                <textarea id="pegado" name="pegado" rows={2} placeholder={"6861234567\n6869876543"} className={`${INPUT} font-mono text-[13px]`} />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button className={BTN_PRIMARY}><Upload className="h-4 w-4" /> Agregar a la campaña</button>
                {/* Es una descarga (route handler), no una página: <Link> la abriría como navegación. */}
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a href="/encuestas/plantilla" className="text-[12.5px] font-semibold text-ink-muted underline">Descargar plantilla</a>
              </div>
              <p className="text-[12px] text-ink-muted">Celulares de 10 dígitos. También quedan en tu base de teléfonos, cifrados: solo tú ves los números.</p>
            </form>
            <form action={agregarDeMiBase} className="mt-4 flex flex-wrap items-end gap-2 border-t border-hairline pt-4">
              <input type="hidden" name="campana" value={c.id} />
              <p className="w-full text-[13px] font-semibold text-ink">Tomar de tu base de teléfonos</p>
              {opcionesBase && opcionesBase.municipios.length > 0 && (
                <div className="w-full sm:w-44">
                  <label className={LABEL} htmlFor="d-municipio">Municipio</label>
                  <select id="d-municipio" name="municipio" className={INPUT}>
                    <option value="">Todos</option>
                    {opcionesBase.municipios.map((m) => <option key={m.clave} value={m.valor}>{m.valor} ({n(m.n)})</option>)}
                  </select>
                </div>
              )}
              {opcionesBase && opcionesBase.distritos.length > 0 && (
                <div className="w-full sm:w-32">
                  <label className={LABEL} htmlFor="d-distrito">Distrito</label>
                  <select id="d-distrito" name="distrito" className={INPUT}>
                    <option value="">Todos</option>
                    {opcionesBase.distritos.map((d) => <option key={d.clave} value={d.valor}>{d.valor} ({n(d.n)})</option>)}
                  </select>
                </div>
              )}
              {opcionesBase && opcionesBase.secciones.length > 0 && (
                <div className="w-full sm:w-32">
                  <label className={LABEL} htmlFor="d-seccion">Sección</label>
                  <select id="d-seccion" name="seccion" className={INPUT}>
                    <option value="">Todas</option>
                    {opcionesBase.secciones.map((x) => <option key={x.clave} value={x.valor}>{x.valor} ({n(x.n)})</option>)}
                  </select>
                </div>
              )}
              <button className={BTN}>Agregar</button>
              <Link href="/encuestas/base" className="pb-2 text-[12.5px] font-semibold text-ink-muted underline">Ver mi base</Link>
            </form>
            {(dest.porEstado.PENDIENTE ?? 0) > 0 && (
              <form action={quitarPendientes} className="mt-4 border-t border-hairline pt-3">
                <input type="hidden" name="campana" value={c.id} />
                <button className="text-[12.5px] font-semibold text-critical underline">Quitar a los que no se ha llamado</button>
                <span className="ml-2 text-[12px] text-ink-muted">Quien ya tuvo llamada se queda en la campaña.</span>
              </form>
            )}
          </Carta>

          <Carta id="probar" titulo="Llamada de prueba" subtitulo="La asistente de esta campaña, con su voz y su guion, te llama a ti. A cualquier hora y sin contar en los resultados.">
            {delProbar && <div className="mb-3"><Aviso ok={ok} error={error} /></div>}
            <form action={llamarNumero} className="space-y-3">
              <input type="hidden" name="campana" value={c.id} />
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[180px] flex-1">
                  <label className={LABEL} htmlFor="telefono">Celular</label>
                  <input id="telefono" name="telefono" inputMode="tel" autoComplete="off" placeholder="686 123 4567" className={INPUT} required />
                </div>
                <button disabled={!conAgente} className={BTN}><Phone className="h-3.5 w-3.5" /> Llamarme</button>
              </div>
              <label className="flex items-center gap-2 text-[12.5px] text-ink-secondary">
                <input type="checkbox" name="real" className="h-4 w-4 accent-[var(--primary)]" /> Es una llamada real (cuenta en los resultados y respeta el horario)
              </label>
            </form>
            {pruebas.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="label-mono-sm">Últimas pruebas</p>
                {pruebas.map((l) => {
                  const est = ESTADOS_LLAMADA[l.estado] ?? ESTADOS_LLAMADA.COLGO;
                  const r = respuestasDe(l, c).filter(Boolean);
                  return (
                    <div key={l.id} className="flex items-center justify-between gap-2 text-[13px]">
                      <span className="text-ink-muted">{fechaHoraCorta(l.inicio)}</span>
                      <span className="truncate text-ink-secondary">{r.length ? r.join(" · ") : ""}</span>
                      <Pastilla color={est.color}>{est.label}</Pastilla>
                    </div>
                  );
                })}
              </div>
            )}
          </Carta>
        </section>
      )}

      {(seg.municipios.length > 0 || seg.distritos.length > 0 || seg.secciones.length > 0) && (
        <form action={aqui} className={`flex flex-wrap items-end gap-3 rounded-lg border px-4 py-3 ${filtrado ? "border-primary/50 bg-primary/10" : "border-hairline bg-surface"}`}>
          <div className="min-w-0 flex-1 basis-56">
            <p className="text-[13px] font-semibold text-ink">{filtrado ? `Viendo solo ${zona}` : "Ver los resultados por zona"}</p>
            <p className="text-[12.5px] text-ink-muted">
              {filtrado
                ? `${n(seg.contactoIds?.length ?? 0)} ${seg.contactoIds?.length === 1 ? "persona" : "personas"} de tu base. Las cifras, las gráficas y la descarga son solo de ellas.`
                : "Municipio, distrito y sección salen de la base que tú subiste (y de la compartida)."}
            </p>
          </div>
          <div className="w-full sm:w-52">
            <label className={LABEL} htmlFor="f-municipio">Municipio</label>
            <select id="f-municipio" name="municipio" defaultValue={municipio} className={INPUT}>
              <option value="">Todos</option>
              {seg.municipios.map((m) => <option key={m.clave} value={m.valor}>{m.valor} ({n(m.n)})</option>)}
            </select>
          </div>
          <div className="w-full sm:w-40">
            <label className={LABEL} htmlFor="f-distrito">Distrito</label>
            <select id="f-distrito" name="distrito" defaultValue={distrito} className={INPUT}>
              <option value="">Todos</option>
              {seg.distritos.map((d) => <option key={d.clave} value={d.valor}>{d.valor} ({n(d.n)})</option>)}
            </select>
          </div>
          <div className="w-full sm:w-40">
            <label className={LABEL} htmlFor="f-seccion">Sección</label>
            <select id="f-seccion" name="seccion" defaultValue={seccion} className={INPUT}>
              <option value="">Todas</option>
              {seg.secciones.map((x) => <option key={x.clave} value={x.valor}>{x.valor} ({n(x.n)})</option>)}
            </select>
          </div>
          <button className={BTN_PRIMARY}>Filtrar</button>
          {filtrado && <Link href={aqui} className="pb-2.5 text-[13px] font-semibold text-ink-muted underline">Quitar filtro</Link>}
        </form>
      )}

      {!filtrado && <section className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 ${conPruebas ? "border-warning/40 bg-warning/10" : "border-hairline bg-surface"}`}>
        <p className={`text-[13px] ${conPruebas ? "text-warning" : "text-ink-muted"}`}>
          {conPruebas ? (
            <>
              <b>Viendo campaña + pruebas.</b> Las cifras incluyen {n(real.pruebas)} {real.pruebas === 1 ? "llamada de prueba" : "llamadas de prueba"}
              {deCampana ? ` y ${n(deCampana)} de la campaña` : "; la campaña todavía no tiene llamadas"}.
            </>
          ) : (
            <>Viendo solo la campaña: las llamadas de prueba no cuentan.</>
          )}
        </p>
        <div className="flex rounded-lg border border-hairline bg-page p-1 text-[12.5px] font-semibold" role="tablist" aria-label="Qué llamadas contar">
          <Link href={`${aqui}?pruebas=0`} className={`rounded px-3 py-1 ${!conPruebas ? "bg-primary text-primary-fg" : "text-ink-muted"}`} aria-selected={!conPruebas} role="tab">Solo campaña</Link>
          <Link href={`${aqui}?pruebas=1`} className={`rounded px-3 py-1 ${conPruebas ? "bg-warning text-white" : "text-ink-muted"}`} aria-selected={conPruebas} role="tab">Con pruebas</Link>
        </div>
      </section>}

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi etiqueta="Llamadas hechas" valor={n(real.intentos)} pie={`${conPruebas ? `incluye ${n(real.pruebas)} de prueba` : filtrado ? zona : "a personas de la lista"}${enLinea ? ` · ${enLinea} en la línea` : ""}`} />
        <Kpi etiqueta="Contestaron" valor={n(real.contestaron)} pie={real.intentos ? `${Math.round((real.contestaron / real.intentos) * 100)} de cada 100 llamadas` : "—"} color="var(--teal)" />
        <Kpi etiqueta="Encuestas completas" valor={n(real.completas)} pie={real.duracionMedia ? `duran ${mmss(real.duracionMedia)} en promedio` : "contestaron todas las preguntas"} color="var(--status-good)" />
        <Kpi etiqueta="Faltan por llamar" valor={n(progreso.porLlamarAlgunDia)} pie={progreso.reintentables ? `${n(progreso.reintentables)} son para volver a marcar` : dest.total ? `de ${n(dest.total)} en la lista` : "agrega destinatarios"} color="#7c8aa5" />
      </section>

      <section id="resultados" className="grid scroll-mt-28 gap-5 lg:grid-cols-2">
        {real.preguntas.map((q, k) => {
          const max = Math.max(...q.filas.map((f) => f.votos));
          const me = margen(q.respondieron);
          return (
            <Carta key={q.pregunta.id} titulo={q.pregunta.corto ?? q.pregunta.texto} subtitulo={`Pregunta ${k + 1} · ${n(q.respondieron)} ${q.respondieron === 1 ? "persona contestó" : "personas contestaron"}${me ? ` · margen de error ±${me} pts` : ""}`}>
              {q.respondieron ? (
                <div className="space-y-3.5">
                  {q.filas.map((f, i) => (
                    <Barra key={f.nombre} nombre={f.nombre} pct={f.pct} votos={f.votos} lider={f.votos === max && max > 0} color={COLOR_OPCION[f.nombre] ?? COLOR_PERSONA[i] ?? "var(--primary)"} />
                  ))}
                </div>
              ) : (
                <p className="py-6 text-center text-[14px] text-ink-muted">Nadie ha contestado esta pregunta todavía.</p>
              )}
              <p className="mt-4 text-[12px] leading-snug text-ink-muted">«{q.pregunta.texto}»</p>
            </Carta>
          );
        })}
      </section>
      {pocas && (
        <p className="rounded-lg bg-warning/10 px-4 py-2.5 text-[13px] text-warning">
          {real.completas === 0 ? "Todavía no hay encuestas completas." : `Con ${n(real.completas)} ${real.completas === 1 ? "encuesta completa" : "encuestas completas"} estos porcentajes todavía se mueven mucho con cada llamada.`} A partir de unas 100 ya se leen con confianza; con 400, el margen de error baja a ±5 puntos.
        </p>
      )}

      {real.cruce && real.completas > 0 && (
        <Carta titulo="¿Qué contestó cada grupo?" subtitulo="Por cada respuesta de la primera pregunta, qué contestaron en la segunda. Cada renglón suma 100%; solo entran quienes contestaron las dos preguntas.">
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="enc-tabla">
              <thead>
                <tr>
                  <th>Primera pregunta</th>
                  <th className="num">Personas</th>
                  {real.cruce.columnas.map((col) => <th key={col} className="num">{col}</th>)}
                </tr>
              </thead>
              <tbody>
                {real.cruce.filas.filter((f) => f.total > 0).map((f) => {
                  const top = Math.max(...f.celdas.map((x) => x.pct));
                  return (
                    <tr key={f.nombre}>
                      <td><span className="inline-flex items-center gap-2 font-semibold"><span className="h-2.5 w-2.5 rounded-full" style={{ background: COLOR_OPCION[f.nombre] ?? "var(--primary)" }} />{f.nombre}</span></td>
                      <td className="num text-ink-muted">{n(f.total)}</td>
                      {f.celdas.map((x, i) => (
                        <td key={i} className="num">
                          <span
                            className="inline-block min-w-[52px] rounded px-2 py-0.5 font-mono text-[13px] tabular-nums"
                            style={{ background: x.pct ? `color-mix(in srgb, var(--primary) ${Math.round(6 + x.pct * 0.5)}%, transparent)` : "transparent", fontWeight: x.pct === top && top > 0 ? 700 : 500 }}
                          >
                            {x.pct}%
                          </span>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Carta>
      )}

      <Carta
        id="encuestas"
        titulo="Las encuestas hechas"
        subtitulo={`${n(hechas.length)} ${hechas.length === 1 ? "llamada" : "llamadas"} · ${n(real.completas)} completas · de la más reciente a la más vieja · de la campaña solo se ven los últimos 4 dígitos del teléfono`}
        extra={
          <div className="flex flex-wrap gap-2">
            {hechas.length > 0 && (
              <a href={`/encuestas/descargar${liga({ campana: c.id, pruebas: conPruebas ? "1" : "" })}`} className={BTN}>
                <Download className="h-3.5 w-3.5" /> Descargar Excel (CSV)
              </a>
            )}
            {admin && (
              <form action={traerLlamadas}>
                <input type="hidden" name="campana" value={c.id} />
                <button className={BTN}><RefreshCw className="h-3.5 w-3.5" /> Traer lo último</button>
              </form>
            )}
          </div>
        }
      >
        {hechas.length ? (
          <div className="-mx-1 max-h-[620px] overflow-auto px-1">
            <table className="enc-tabla">
              <thead>
                <tr>
                  <th className="num">#</th><th>Cuándo</th><th>Teléfono</th><th>Resultado</th><th>Llamada</th><th className="num">Duró</th>
                  {c.preguntas.map((p) => <th key={p.id}>{p.corto ?? p.clave}</th>)}
                </tr>
              </thead>
              <tbody>
                {hechas.slice(0, 500).map((l, k) => {
                  const est = ESTADOS_LLAMADA[l.estado] ?? ESTADOS_LLAMADA.COLGO;
                  const rs = respuestasDe(l, c);
                  return (
                    <tr key={l.id}>
                      <td className="num text-ink-muted">{hechas.length - k}</td>
                      <td className="whitespace-nowrap">{fechaHoraCorta(l.inicio)}</td>
                      <td className={`whitespace-nowrap font-mono text-[12.5px] ${l.prueba ? "" : "text-ink-muted"}`}>{telefonoVisible(l) ?? "—"}</td>
                      <td className="whitespace-nowrap">
                        <Pastilla color={est.color}>{est.label}</Pastilla>
                        {l.prueba && <span className="ml-1.5"><Pastilla color="var(--status-warning)">Prueba</Pastilla></span>}
                      </td>
                      <td>
                        <Platica id={l.id} titulo={`${fechaHoraCorta(l.inicio)} · ${est.label}${l.segundos ? ` · ${mmss(l.segundos)}` : ""}`} transcripcion={l.transcripcion} conAudio={admin && !!l.externoId && (l.segundos ?? 0) > 0} />
                      </td>
                      <td className="num">{l.segundos ? mmss(l.segundos) : "—"}</td>
                      {rs.map((r, i) => (
                        <td key={i} className="font-medium">
                          {r ? (
                            <span className="inline-flex items-center gap-1.5">
                              {COLOR_OPCION[r] && <span className="h-2 w-2 rounded-full" style={{ background: COLOR_OPCION[r] }} />}
                              {r}
                            </span>
                          ) : (
                            <span className="font-normal text-ink-muted">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {hechas.length > 500 && <p className="mt-2 text-[12.5px] text-ink-muted">Se muestran las 500 más recientes; el archivo descargado trae todas.</p>}
          </div>
        ) : (
          <p className="py-6 text-center text-[14px] text-ink-muted">Todavía no se ha hecho ninguna llamada en esta campaña.</p>
        )}
      </Carta>

      <Carta
        id="guion"
        titulo="El guion de la llamada"
        subtitulo={`Lo que dice la asistente virtual, palabra por palabra · versión ${c.version}`}
        extra={admin ? <Link href={`${aqui}/guion`} className={BTN_PRIMARY}><PencilLine className="h-4 w-4" /> Editar el guion</Link> : undefined}
      >
        <div className="grid gap-4 text-[14px] lg:grid-cols-3">
          <div className="rounded-lg bg-surface-2 p-4">
            <p className="label-mono-sm mb-1.5 flex items-center gap-1.5"><Bot className="h-3.5 w-3.5" /> Introducción</p>
            <p className="leading-relaxed text-ink">{c.saludo}</p>
          </div>
          {c.preguntas.map((p, i) => (
            <div key={p.id} className="rounded-lg bg-surface-2 p-4">
              <p className="label-mono-sm mb-1.5">Pregunta {i + 1}</p>
              <p className="font-semibold leading-relaxed text-ink">{p.texto}</p>
              <p className="label-mono-sm mb-1 mt-3">Se registra</p>
              <ul className="space-y-0.5 text-ink-muted">
                {leerOpciones(p.opciones).map((o) => (
                  <li key={o}>
                    • {o}
                    {leerOpciones(p.noSeLeen).includes(o) && <span className="text-[12px]"> (no se lee; cuenta si la persona lo dice)</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-lg bg-surface-2 p-4 text-[14px]">
          <p className="label-mono-sm mb-1.5">Despedida</p>
          <p className="text-ink">{c.cierre}</p>
        </div>
      </Carta>

      <p className="py-2 text-center text-[12px] text-ink-muted">Las llamadas de prueba nunca se cuentan en los resultados.</p>
    </div>
  );
}

function Dato({ t, children }: { t: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="label-mono-sm">{t}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}

function Paso({ hecho, children }: { hecho: boolean; children: React.ReactNode }) {
  return (
    <li className={`flex items-center gap-2 ${hecho ? "text-ink" : "text-ink-muted"}`}>
      {hecho ? <Check className="h-4 w-4 shrink-0 text-success" /> : <Circle className="h-4 w-4 shrink-0" />}
      <span>{children}</span>
    </li>
  );
}
