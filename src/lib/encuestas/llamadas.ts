import { Types } from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import EncuestaCuestionarioModel from "@/lib/models/EncuestaCuestionario";
import EncuestaLlamadaModel from "@/lib/models/EncuestaLlamada";

/**
 * LA ENCUESTA POR TELÉFONO.
 *
 * Una llamada se registra desde que sale, no cuando sale bien. Las que no contestaron, las que colgaron y las que
 * rechazaron valen tanto como las completas: sin ellas no se sabe cuántos intentos cuesta una encuesta.
 *
 * Las pruebas se guardan igual que las de verdad, pero van marcadas y los resultados nunca las cuentan.
 */
export const ESTADOS_LLAMADA: Record<string, { label: string; color: string }> = {
  EN_CURSO:    { label: "En la línea",        color: "var(--steel-vivid)" },
  COMPLETA:    { label: "Completa",           color: "var(--status-good)" },
  RECHAZO:     { label: "No quiso contestar", color: "var(--status-critical)" },
  COLGO:       { label: "Colgó a media",      color: "var(--status-warning)" },
  NO_CONTESTO: { label: "No contestó",        color: "#7C8AA5" },
  BUZON:       { label: "Buzón",              color: "#7C8AA5" },
  NUMERO_MALO: { label: "Número equivocado",  color: "#7C8AA5" },
  // La llamada nunca salió (falla del servicio de voz): no es un intento y su contacto regresa a la fila.
  NO_SALIO:    { label: "No salió",           color: "#AEB9CD" },
};

/** Las opciones vienen como arreglo de Mongo; el texto JSON se acepta por si llega de un guion guardado a mano. */
export const leerOpciones = (crudo: string[] | string | null | undefined): string[] => {
  if (!crudo) return [];
  if (Array.isArray(crudo)) return crudo.map(String);
  try { const x = JSON.parse(crudo); return Array.isArray(x) ? x.map(String) : []; } catch { return []; }
};

/** Un cuestionario de demostración empieza así: nunca se manda al agente ni se llama con él. */
export const PREFIJO_DEMO = "DEMO ·";
export const esDemo = (c: { nombre: string } | null | undefined) => !!c?.nombre.startsWith(PREFIJO_DEMO);

export type Pregunta = {
  id: string;
  clave: string;
  texto: string;
  corto: string | null;
  tipo: string;
  opciones: string[];
  noSeLeen: string[];
  reglas: string | null;
  orden: number;
};

/** Los parámetros de una campaña (ver el modelo EncuestaCuestionario). */
export type EstadoCampana = "BORRADOR" | "CORRIENDO" | "PAUSADA" | "TERMINADA";
export type ConfigCampana = {
  estado: EstadoCampana;
  agenteId: string | null;
  creadoPor: string | null;
  voz: { genero: "F" | "M"; voces: string[] };
  horario: { desde: number; hasta: number; dias: number[] };
  reintentos: { intentos: number; esperaMin: number };
  meta: number;
  lineas: number;
  tope: number;
  buzon: boolean;
  etiquetas: string[];
  iniciada: Date | null;
  terminada: Date | null;
  motivo: string | null;
  creada: Date | null;
  /** Versión del armado del guion con que se actualizó su asistente (ver ARMADO en guion.ts). */
  armado: number;
};

export type Campana = ConfigCampana & {
  id: string;
  nombre: string;
  saludo: string;
  cierre: string | null;
  municipio: string | null;
  frases: string | null;
  version: number;
  preguntas: Pregunta[];
};
/** El nombre de antes de las campañas: el guion es la misma cosa. */
export type CuestionarioActivo = Campana;

export const ESTADOS_CAMPANA: Record<EstadoCampana, { label: string; color: string }> = {
  BORRADOR:  { label: "Borrador",  color: "#7C8AA5" },
  CORRIENDO: { label: "Llamando",  color: "var(--primary)" },
  PAUSADA:   { label: "En pausa",  color: "var(--status-warning)" },
  TERMINADA: { label: "Terminada", color: "var(--status-good)" },
};

type PreguntaDoc = Omit<Pregunta, "id"> & { _id: Types.ObjectId };
export type CampanaDoc = {
  _id: Types.ObjectId;
  nombre: string; saludo: string; cierre?: string | null; municipio?: string | null; frases?: string | null; version?: number;
  preguntas?: PreguntaDoc[];
  estado?: string; agenteId?: string | null; creadoPor?: Types.ObjectId | null; armado?: number;
  voz?: { genero?: string; voces?: string[] }; horario?: { desde?: number; hasta?: number; dias?: number[] };
  reintentos?: { intentos?: number; esperaMin?: number };
  meta?: number; lineas?: number; tope?: number; buzon?: boolean; etiquetas?: string[];
  iniciada?: Date | null; terminada?: Date | null; motivo?: string | null; createdAt?: Date;
};

const ESTADOS_VALIDOS = Object.keys(ESTADOS_CAMPANA) as EstadoCampana[];

export function aCampana(d: CampanaDoc): Campana {
  const dias = (d.horario?.dias ?? []).filter((x) => x >= 1 && x <= 7);
  return {
    id: String(d._id),
    nombre: d.nombre,
    saludo: d.saludo,
    cierre: d.cierre ?? null,
    municipio: d.municipio ?? null,
    frases: d.frases ?? null,
    version: d.version ?? 1,
    preguntas: [...(d.preguntas ?? [])]
      .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      .map((p) => ({
        id: String(p._id),
        clave: p.clave,
        texto: p.texto,
        corto: p.corto ?? null,
        tipo: p.tipo ?? "OPCION_UNICA",
        opciones: p.opciones ?? [],
        noSeLeen: p.noSeLeen ?? [],
        reglas: p.reglas ?? null,
        orden: p.orden ?? 0,
      })),
    estado: ESTADOS_VALIDOS.includes(d.estado as EstadoCampana) ? (d.estado as EstadoCampana) : "BORRADOR",
    agenteId: d.agenteId || null,
    creadoPor: d.creadoPor ? String(d.creadoPor) : null,
    voz: { genero: d.voz?.genero === "M" ? "M" : "F", voces: d.voz?.voces ?? [] },
    horario: { desde: d.horario?.desde ?? 9, hasta: d.horario?.hasta ?? 20, dias: dias.length ? dias : [1, 2, 3, 4, 5, 6, 7] },
    reintentos: { intentos: Math.max(1, d.reintentos?.intentos ?? 3), esperaMin: Math.max(5, d.reintentos?.esperaMin ?? 120) },
    meta: d.meta ?? 0,
    lineas: d.lineas ?? 0,
    tope: d.tope ?? 0,
    buzon: d.buzon ?? true,
    etiquetas: d.etiquetas ?? [],
    iniciada: d.iniciada ?? null,
    terminada: d.terminada ?? null,
    motivo: d.motivo ?? null,
    creada: d.createdAt ?? null,
    armado: d.armado ?? 0,
  };
}

/** Una campaña por su id. */
export async function leerCampana(id: string | null | undefined): Promise<Campana | null> {
  if (!id || !Types.ObjectId.isValid(id)) return null;
  await dbConnect();
  const d = await EncuestaCuestionarioModel.findById(id).lean<CampanaDoc>();
  return d ? aCampana(d) : null;
}

/**
 * LA CAMPAÑA POR OMISIÓN, para lo que todavía no dice de cuál campaña habla (la API para otra plataforma sin `campana`):
 * la que está llamando más reciente y, si ninguna llama, la última que se creó y no ha terminado.
 */
export async function campanaPorOmision(): Promise<Campana | null> {
  await dbConnect();
  const d =
    (await EncuestaCuestionarioModel.findOne({ estado: "CORRIENDO" }).sort({ createdAt: -1 }).lean<CampanaDoc>()) ??
    (await EncuestaCuestionarioModel.findOne({ estado: { $in: ["BORRADOR", "PAUSADA"] } }).sort({ createdAt: -1 }).lean<CampanaDoc>()) ??
    (await EncuestaCuestionarioModel.findOne({}).sort({ createdAt: -1 }).lean<CampanaDoc>());
  return d ? aCampana(d) : null;
}

export type Llamada = {
  id: string;
  /** En claro solo en las de prueba; las de verdad traen los últimos 4 dígitos en `telFin`. */
  telefono: string | null;
  telFin: string | null;
  estado: string;
  prueba: boolean;
  contactoId: string | null;
  externoId: string | null;
  transcripcion: string | null;
  inicio: Date;
  fin: Date | null;
  segundos: number | null;
  notas: string | null;
  versionGuion: number | null;
  respuestas: { preguntaId: string; valor: string }[];
};

type LlamadaDoc = Omit<Llamada, "id" | "contactoId" | "respuestas"> & {
  _id: Types.ObjectId;
  contactoId?: Types.ObjectId | null;
  respuestas?: { preguntaId: Types.ObjectId; valor: string }[];
};

export function aLlamada(d: LlamadaDoc): Llamada {
  return {
    id: String(d._id),
    telefono: d.telefono ?? null,
    telFin: d.telFin ?? null,
    estado: d.estado,
    prueba: !!d.prueba,
    contactoId: d.contactoId ? String(d.contactoId) : null,
    externoId: d.externoId ?? null,
    transcripcion: d.transcripcion ?? null,
    inicio: new Date(d.inicio),
    fin: d.fin ? new Date(d.fin) : null,
    segundos: d.segundos ?? null,
    notas: d.notas ?? null,
    versionGuion: d.versionGuion ?? null,
    respuestas: (d.respuestas ?? []).map((r) => ({ preguntaId: String(r.preguntaId), valor: r.valor })),
  };
}

/** Lee llamadas de Mongo ya en la forma que usan el tablero y la API. */
export async function buscarLlamadas(filtro: Record<string, unknown>, { limite }: { limite?: number } = {}) {
  await dbConnect();
  let q = EncuestaLlamadaModel.find(filtro).sort({ inicio: -1 });
  if (limite) q = q.limit(limite);
  return (await q.lean<LlamadaDoc[]>()).map(aLlamada);
}

/**
 * LOS RESULTADOS.
 *
 * Cada pregunta se mide sobre quienes la contestaron, no sobre todas las llamadas: si alguien colgó antes de la
 * segunda, no dijo «ninguno», simplemente no dijo. Confundir esas dos cosas es la manera más fácil de que una encuesta
 * mienta.
 */
export async function resultadosLlamadas(c: CuestionarioActivo, { conPruebas = false, contactoIds = null }: { conPruebas?: boolean; contactoIds?: Types.ObjectId[] | null } = {}) {
  // Con «conPruebas» entran también las llamadas de prueba, para enseñar cómo se ven los resultados antes de que
  // arranque la campaña. El tablero siempre dice cuántas son de prueba.
  // Con «contactoIds» (el filtro de municipio y distrito, ver segmentos() en base.ts) solo entran las llamadas a esas
  // personas; las de prueba nunca se ligan a un contacto, así que con filtro quedan fuera solas.
  const llamadas = await buscarLlamadas({
    cuestionarioId: c.id,
    ...(conPruebas ? {} : { prueba: false }),
    ...(contactoIds ? { contactoId: { $in: contactoIds } } : {}),
    estado: { $ne: "NO_SALIO" },
  });

  const porEstado: Record<string, number> = Object.fromEntries(Object.keys(ESTADOS_LLAMADA).map((k) => [k, 0]));
  for (const l of llamadas) porEstado[l.estado] = (porEstado[l.estado] ?? 0) + 1;
  const intentos = llamadas.filter((l) => l.estado !== "EN_CURSO").length;
  const completas = llamadas.filter((l) => l.estado === "COMPLETA");
  const sinRespuesta = porEstado.NO_CONTESTO + porEstado.BUZON + porEstado.NUMERO_MALO;

  const preguntas = c.preguntas.map((p) => {
    const opciones = leerOpciones(p.opciones);
    const dadas = llamadas.flatMap((l) => l.respuestas.filter((r) => r.preguntaId === p.id));
    const conteo = new Map<string, number>();
    for (const r of dadas) conteo.set(r.valor, (conteo.get(r.valor) ?? 0) + 1);
    const total = dadas.length;
    const filas = (opciones.length ? opciones : [...conteo.keys()]).map((o) => {
      const votos = conteo.get(o) ?? 0;
      return { nombre: o, votos, pct: total ? Math.round((votos / total) * 1000) / 10 : 0 };
    });
    return { pregunta: p, filas, respondieron: total };
  });

  // EL CRUCE: qué contestó en la segunda pregunta cada grupo de la primera (por ejemplo, quienes calificaron «bueno»).
  // Solo entra quien contestó las dos.
  const [p1, p2] = c.preguntas;
  const cruce = p1 && p2 ? (() => {
    const filas = leerOpciones(p1.opciones), cols = leerOpciones(p2.opciones);
    const m = new Map<string, Map<string, number>>();
    for (const l of llamadas) {
      const a = l.respuestas.find((r) => r.preguntaId === p1.id)?.valor;
      const b = l.respuestas.find((r) => r.preguntaId === p2.id)?.valor;
      if (!a || !b) continue;
      const fila = m.get(a) ?? new Map<string, number>();
      fila.set(b, (fila.get(b) ?? 0) + 1);
      m.set(a, fila);
    }
    return {
      columnas: cols,
      filas: filas.map((f) => {
        const fila = m.get(f) ?? new Map<string, number>();
        const total = [...fila.values()].reduce((x, y) => x + y, 0);
        return { nombre: f, total, celdas: cols.map((c2) => ({ votos: fila.get(c2) ?? 0, pct: total ? Math.round(((fila.get(c2) ?? 0) / total) * 100) : 0 })) };
      }),
    };
  })() : null;

  const seg = completas.map((l) => l.segundos ?? 0).filter(Boolean);
  return {
    llamadas,
    conPruebas,
    pruebas: llamadas.filter((l) => l.prueba && l.estado !== "EN_CURSO").length,
    porEstado,
    intentos,
    contestaron: Math.max(0, intentos - sinRespuesta),
    completas: completas.length,
    duracionMedia: seg.length ? Math.round(seg.reduce((a, b) => a + b, 0) / seg.length) : 0,
    preguntas,
    cruce,
  };
}

/**
 * EL TELÉFONO JUNTO A LAS RESPUESTAS. Una opinión ligada a un número es un dato personal: de las llamadas de la campaña
 * solo se enseñan los últimos 4 dígitos, que bastan para distinguir cada llamada sin exponer a la persona. Las de prueba
 * son los celulares del propio equipo (los que se escriben en «Llamarme») y van completos.
 */
export function telefonoVisible(l: { telefono: string | null; telFin?: string | null; prueba: boolean }) {
  const t = (l.telefono ?? "").replace(/\D/g, "").slice(-10);
  if (l.prueba && t.length === 10) return `${t.slice(0, 3)} ${t.slice(3, 6)} ${t.slice(6)}`;
  const fin = l.telFin ?? (t.length === 10 ? t.slice(6) : null);
  return fin ? `••• ••• ${fin}` : null;
}

/** Lo que contestó una persona, pregunta por pregunta. Sin nombre ni teléfono: la encuesta es anónima. */
export function respuestasDe(l: { respuestas: { preguntaId: string; valor: string }[] }, c: CuestionarioActivo) {
  return c.preguntas.map((p) => l.respuestas.find((r) => r.preguntaId === p.id)?.valor ?? null);
}
