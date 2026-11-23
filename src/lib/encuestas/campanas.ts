import { Types } from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import EncuestaCuestionarioModel from "@/lib/models/EncuestaCuestionario";
import EncuestaDestinatarioModel from "@/lib/models/EncuestaDestinatario";
import EncuestaContactoModel from "@/lib/models/EncuestaContacto";
import EncuestaLlamadaModel from "@/lib/models/EncuestaLlamada";
import EncuestaConfigModel from "@/lib/models/EncuestaConfig";
import { aCampana, type Campana, type CampanaDoc, type EstadoCampana } from "./llamadas";
import { ENCUESTA } from "./encuesta";
import { ZONA } from "./fechas";
import { migrarACifrado } from "./base";

/**
 * LAS CAMPAÑAS DE ENCUESTA.
 *
 * Antes había una sola encuesta, con un solo agente, un horario y una tanda para todos. Ahora cada campaña trae lo
 * suyo, como en una plataforma de llamadas robotizadas: guion y preguntas, voz, horario, reintentos, a quién llama y sus
 * resultados. Varias pueden llamar al mismo tiempo, hasta el número que ponga un admin en /ajustes; las líneas
 * telefónicas (ELEVENLABS_SIMULTANEAS) se reparten entre las que estén llamando.
 */

// ── Horario ────────────────────────────────────────────────────────────────────────────────────────────────────────
const DIAS = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
export const DIAS_CORTOS = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

/** Los días en palabras: «todos los días», «de lunes a viernes» o «lunes, miércoles y viernes». */
function diasEnPalabras(dias: number[]) {
  const d = [...new Set(dias)].sort((a, b) => a - b);
  if (d.length === 7) return "todos los días";
  const seguidos = d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  if (seguidos && d.length > 2) return `de ${DIAS[d[0]]} a ${DIAS[d[d.length - 1]]}`;
  const nombres = d.map((x) => DIAS[x]);
  return nombres.length > 1 ? `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}` : nombres.join("");
}

/** ¿Esta campaña puede llamar ahorita? En hora de Baja California, que es donde vive la gente a la que se le llama. */
export function horarioDe(c: Pick<Campana, "horario">, ahora = new Date()) {
  const { desde, hasta, dias } = c.horario;
  const partes = new Intl.DateTimeFormat("en-US", { timeZone: ZONA, hour: "numeric", hourCycle: "h23", weekday: "short" }).formatToParts(ahora);
  const hora = Number(partes.find((x) => x.type === "hour")?.value ?? 0);
  const dia = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(partes.find((x) => x.type === "weekday")?.value ?? "") + 1;
  const todoElDia = desde <= 0 && hasta >= 24;
  const abierto = dias.includes(dia) && (todoElDia || (hora >= desde && hora < hasta));
  const horas = todoElDia ? "las 24 horas" : `de ${desde}:00 a ${hasta}:00`;
  return { abierto, texto: `${horas}, ${diasEnPalabras(dias)}` };
}

/** El horario de antes (variables de entorno), para la campaña que se migra. */
function horarioDelEntorno() {
  const [desde, hasta] = (process.env.LLAMADAS_HORARIO ?? "9-20").split("-").map(Number);
  const [d1, d2] = (process.env.LLAMADAS_DIAS ?? "1-7").split("-").map(Number);
  const dias = Array.from({ length: 7 }, (_, i) => i + 1).filter((x) => x >= (d1 || 1) && x <= (d2 || 7));
  return { desde: Number.isFinite(desde) ? desde : 9, hasta: Number.isFinite(hasta) ? hasta : 20, dias };
}

// ── Ajustes globales (los pone un admin en /ajustes) ──────────────────────────────────────────────────────────────
const CLAVE_SIMULTANEAS = "campanas_simultaneas";
export const CAMPANAS_SIMULTANEAS_MAX = 10;

/** Cuántas campañas pueden estar llamando al mismo tiempo. 2 si nadie lo ha cambiado. */
export async function campanasSimultaneas() {
  await dbConnect();
  const f = await EncuestaConfigModel.findById(CLAVE_SIMULTANEAS).lean<{ valor: string }>();
  const n = Number(f?.valor);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, CAMPANAS_SIMULTANEAS_MAX) : 2;
}
export async function fijarCampanasSimultaneas(n: number) {
  await dbConnect();
  await EncuestaConfigModel.updateOne({ _id: CLAVE_SIMULTANEAS }, { $set: { valor: String(n) } }, { upsert: true });
}

// ── Voces ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export type Voz = { id: string; nombre: string; genero: "F" | "M"; muestra: string | null; descripcion: string | null };

/** La voz con la que se hicieron las primeras encuestas en campo: la de respaldo si ElevenLabs no contesta. */
export const VOZ_INICIAL = "ewn5JTa3lNPY8QVuZJi6";
const RESPALDO: Voz[] = [{ id: VOZ_INICIAL, nombre: "Ana Sofía", genero: "F", muestra: null, descripcion: "Conversacional" }];

let cacheVoces: { en: number; voces: Voz[] } | null = null;
/** Voces de la cuenta que ElevenLabs no deja usar en agentes (ver catalogoDeVoces). */
const vetadas = new Set<string>();

/**
 * LAS VOCES QUE SE PUEDEN ESCOGER: las de español de México de la cuenta de ElevenLabs, femeninas y masculinas. Para
 * tener más tonos basta con agregar voces a la cuenta (desde la Voice Library de ElevenLabs): aparecen aquí solas. Se
 * guardan 10 minutos para no preguntarle a ElevenLabs en cada pantalla.
 */
export async function catalogoDeVoces(): Promise<Voz[]> {
  if (cacheVoces && Date.now() - cacheVoces.en < 10 * 60_000) return cacheVoces.voces;
  const llave = process.env.ELEVENLABS_API_KEY;
  if (!llave) return RESPALDO;
  try {
    const r = await fetch("https://api.elevenlabs.io/v2/voices?page_size=100", { headers: { "xi-api-key": llave }, cache: "no-store" });
    if (!r.ok) return cacheVoces?.voces ?? RESPALDO;
    type V = { voice_id: string; name: string; preview_url?: string | null; labels?: Record<string, string>; sharing?: { live_moderation_enabled?: boolean } | null };
    const { voices = [] } = (await r.json()) as { voices?: V[] };
    // Las voces de la biblioteca con «moderación en vivo» no se pueden usar en agentes: ElevenLabs rechaza el guion
    // (400 «has live moderation enabled and cannot be used for agents»). No se ofrecen, y si una campaña ya tenía una
    // guardada, se salta al llamar (vocesUsables).
    for (const v of voices) if (v.sharing?.live_moderation_enabled) vetadas.add(v.voice_id);
    const voces = voices
      .filter((v) => !v.sharing?.live_moderation_enabled)
      .filter((v) => (v.labels?.accent ?? "").toLowerCase().includes("mexic") && ["female", "male"].includes(v.labels?.gender ?? ""))
      .map((v) => {
        const [nombre, ...resto] = v.name.split(/\s+[-–·]\s+|\s*\(MX\)\s*|_MX/);
        return {
          id: v.voice_id,
          nombre: nombre.trim() || v.name,
          genero: v.labels?.gender === "male" ? ("M" as const) : ("F" as const),
          muestra: v.preview_url ?? null,
          descripcion: resto.join(" ").replace(/[-_]/g, " ").trim() || v.labels?.descriptive || null,
        };
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    const lista = voces.length ? voces : RESPALDO;
    cacheVoces = { en: Date.now(), voces: lista };
    return lista;
  } catch {
    return cacheVoces?.voces ?? RESPALDO;
  }
}

/** Las voces de la campaña que sí se pueden usar: sin las que ElevenLabs no deja usar en agentes. */
export async function vocesUsables(c: Pick<Campana, "voz">): Promise<string[]> {
  await catalogoDeVoces();
  return c.voz.voces.filter((id) => !vetadas.has(id));
}

/** La voz de una llamada: si la campaña tiene varias, una al azar (así se oyen tonos distintos de una llamada a otra). */
export function vozParaLlamada(voces: string[]): string | null {
  return voces.length ? voces[Math.floor(Math.random() * voces.length)] : null;
}

// ── La migración: de «una encuesta» a campañas ─────────────────────────────────────────────────────────────────────
let migrando: Promise<void> | null = null;

/**
 * PASAR A CAMPAÑAS LO QUE YA HABÍA. Corre una vez por proceso y no hace nada si ya no queda nada sin estado:
 * - El cuestionario que se estaba levantando se vuelve la primera campaña, con el agente, la voz y el horario de las
 *   variables de entorno, y con TODA la base de antes como destinatarios (cada quien con el estado y los intentos que
 *   ya llevaba: a quien ya contestó no se le vuelve a llamar). Queda EN PAUSA: lo que estuviera llamando no sigue solo
 *   con las reglas nuevas, alguien tiene que darle «Reanudar».
 * - Los cuestionarios viejos quedan como campañas terminadas, con sus resultados.
 */
export function asegurarCampanas() {
  migrando ??= migrar().catch((e) => { migrando = null; throw e; });
  return migrando;
}

async function migrar() {
  await dbConnect();
  const viejos = await EncuestaCuestionarioModel.find({ estado: { $exists: false } }).sort({ createdAt: -1 }).lean<(CampanaDoc & { activo?: boolean })[]>();
  if (!viejos.length) return;
  await migrarACifrado();
  const actual = viejos.find((v) => v.activo !== false);
  for (const v of viejos) {
    if (v !== actual) {
      await EncuestaCuestionarioModel.updateOne({ _id: v._id, estado: { $exists: false } }, { $set: { estado: "TERMINADA", motivo: "De antes de las campañas" } });
      continue;
    }
    const reales = await EncuestaLlamadaModel.countDocuments({ cuestionarioId: v._id, prueba: false });
    const meta = await EncuestaConfigModel.findById("agente_meta").lean<{ valor: string }>();
    let reglas = { intentos: 3, esperaMin: 120 };
    try { if (meta) { const m = JSON.parse(meta.valor) as { intentosMax: number; esperaMin: number }; reglas = { intentos: m.intentosMax, esperaMin: m.esperaMin }; } } catch { /* reglas por omisión */ }
    const r = await EncuestaCuestionarioModel.updateOne(
      { _id: v._id, estado: { $exists: false } },
      {
        $set: {
          estado: reales ? "PAUSADA" : "BORRADOR",
          motivo: reales ? "Migrada a campañas: revisa la configuración y dale «Reanudar»." : null,
          agenteId: process.env.ELEVENLABS_AGENTE_ENCUESTA || null,
          voz: { genero: "F", voces: [process.env.ELEVENLABS_VOZ || VOZ_INICIAL] },
          horario: horarioDelEntorno(),
          reintentos: reglas,
          iniciada: reales ? v.createdAt ?? new Date() : null,
        },
      },
    );
    if (!r.modifiedCount) continue; // otro proceso la migró en el mismo instante
    // Toda la base de antes era de esta encuesta.
    const contactos = await EncuestaContactoModel.find({}).select("telefono estado intentos ultimoIntento llamadaId").lean<{ _id: Types.ObjectId; telefono: string; estado: string; intentos: number; ultimoIntento: Date | null; llamadaId: Types.ObjectId | null }[]>();
    for (let k = 0; k < contactos.length; k += 1000) {
      await EncuestaDestinatarioModel.bulkWrite(
        contactos.slice(k, k + 1000).map((c) => ({
          updateOne: {
            filter: { campanaId: v._id, contactoId: c._id },
            update: { $setOnInsert: { huella: c.telefono, estado: c.estado || "PENDIENTE", intentos: c.intentos ?? 0, ultimoIntento: c.ultimoIntento ?? null, llamadaId: c.llamadaId ?? null } },
            upsert: true,
          },
        })),
        { ordered: false },
      );
    }
    console.log(`[encuestas] «${v.nombre}» pasó a campaña con ${contactos.length} destinatarios.`);
  }
  // La tanda y la meta globales ya no existen: cada campaña tiene las suyas.
  await EncuestaConfigModel.deleteMany({ _id: { $in: ["agente_tanda", "agente_meta"] } });
}

/** Todas las campañas, de la más nueva a la más vieja. */
export async function listarCampanas(): Promise<Campana[]> {
  await asegurarCampanas();
  const docs = await EncuestaCuestionarioModel.find({}).sort({ createdAt: -1 }).lean<CampanaDoc[]>();
  return docs.map(aCampana);
}

// ── Crear y copiar ─────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * UNA CAMPAÑA NUEVA, en borrador. Si se copia de otra, se lleva su guion (con preguntas nuevas: las respuestas de una no
 * se mezclan con las de la otra), su voz, su horario y sus reglas; no se lleva destinatarios ni resultados. En blanco, arranca
 * con la encuesta de ejemplo de encuesta.ts para que haya algo que editar.
 */
export async function crearCampana({ nombre, copiarDe, creadoPor }: { nombre: string; copiarDe: Campana | null; creadoPor: string | null }) {
  await dbConnect();
  const base = copiarDe
    ? {
        saludo: copiarDe.saludo, cierre: copiarDe.cierre, municipio: copiarDe.municipio, frases: copiarDe.frases,
        preguntas: copiarDe.preguntas.map((p, orden) => ({ clave: p.clave, texto: p.texto, corto: p.corto, tipo: p.tipo, opciones: p.opciones, noSeLeen: p.noSeLeen, reglas: p.reglas, orden })),
        voz: copiarDe.voz, horario: copiarDe.horario, reintentos: copiarDe.reintentos,
        meta: copiarDe.meta, lineas: copiarDe.lineas, tope: copiarDe.tope, buzon: copiarDe.buzon, etiquetas: copiarDe.etiquetas,
      }
    : {
        saludo: ENCUESTA.saludo, cierre: ENCUESTA.cierre, municipio: ENCUESTA.municipio, frases: null,
        preguntas: ENCUESTA.preguntas.map((p, orden) => ({ clave: p.clave, texto: p.texto, corto: p.corto, opciones: [...p.opciones], noSeLeen: [...p.noSeLeen], reglas: p.reglas, orden })),
        voz: { genero: "F", voces: [VOZ_INICIAL] },
        horario: { desde: 9, hasta: 20, dias: [1, 2, 3, 4, 5, 6, 7] },
      };
  const d = await EncuestaCuestionarioModel.create({
    ...base, nombre, estado: "BORRADOR", activo: true, version: 1, agenteId: null,
    creadoPor: creadoPor && Types.ObjectId.isValid(creadoPor) ? creadoPor : null,
  });
  return String(d._id);
}

// ── Destinatarios ──────────────────────────────────────────────────────────────────────────────────────────────────
/** Mete contactos a la campaña. Los que ya estaban se quedan como estaban (con lo que ya les pasó en esta campaña). */
export async function agregarDestinatarios(campanaId: string, contactos: { _id: Types.ObjectId; telefono: string; estado?: string }[], agregadoPor: string | null) {
  await dbConnect();
  const quien = agregadoPor && Types.ObjectId.isValid(agregadoPor) ? new Types.ObjectId(agregadoPor) : null;
  const cid = new Types.ObjectId(campanaId);
  let nuevos = 0;
  for (let k = 0; k < contactos.length; k += 1000) {
    const r = await EncuestaDestinatarioModel.bulkWrite(
      contactos.slice(k, k + 1000).map((c) => ({
        updateOne: {
          filter: { campanaId: cid, contactoId: c._id },
          // Quien pidió no ser llamado entra apartado: se ve en la lista, pero nunca se le marca.
          update: { $setOnInsert: { huella: c.telefono, estado: c.estado === "NO_LLAMAR" ? "NO_LLAMAR" : "PENDIENTE", intentos: 0, agregadoPor: quien } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    nuevos += r.upsertedCount;
  }
  return { nuevos, yaEstaban: contactos.length - nuevos };
}

/** Cómo van los destinatarios de una campaña, por estado. */
export async function conteoDestinatarios(campanaId: string) {
  await dbConnect();
  const g = await EncuestaDestinatarioModel.aggregate<{ _id: string; n: number }>([
    { $match: { campanaId: new Types.ObjectId(campanaId) } },
    { $group: { _id: "$estado", n: { $sum: 1 } } },
  ]);
  const porEstado = Object.fromEntries(g.map((x) => [x._id, x.n])) as Record<string, number>;
  return { total: g.reduce((a, x) => a + x.n, 0), porEstado };
}

/** El resumen de cada campaña para la lista: destinatarios, llamadas reales y completas. */
export async function resumenDeCampanas(ids: string[]) {
  await dbConnect();
  const oids = ids.filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x));
  const [dest, llam] = await Promise.all([
    EncuestaDestinatarioModel.aggregate<{ _id: { c: Types.ObjectId; e: string }; n: number }>([
      { $match: { campanaId: { $in: oids } } },
      { $group: { _id: { c: "$campanaId", e: "$estado" }, n: { $sum: 1 } } },
    ]),
    EncuestaLlamadaModel.aggregate<{ _id: { c: Types.ObjectId; e: string }; n: number }>([
      { $match: { cuestionarioId: { $in: oids }, prueba: false, estado: { $ne: "NO_SALIO" } } },
      { $group: { _id: { c: "$cuestionarioId", e: "$estado" }, n: { $sum: 1 } } },
    ]),
  ]);
  const out: Record<string, { destinatarios: number; pendientes: number; llamadas: number; completas: number; enLinea: number }> = {};
  for (const id of ids) out[id] = { destinatarios: 0, pendientes: 0, llamadas: 0, completas: 0, enLinea: 0 };
  for (const x of dest) {
    const o = out[String(x._id.c)];
    if (!o) continue;
    o.destinatarios += x.n;
    if (x._id.e === "PENDIENTE") o.pendientes += x.n;
  }
  for (const x of llam) {
    const o = out[String(x._id.c)];
    if (!o) continue;
    if (x._id.e === "EN_CURSO") o.enLinea += x.n;
    else o.llamadas += x.n;
    if (x._id.e === "COMPLETA") o.completas += x.n;
  }
  return out;
}

/** Cuántas están llamando ahora. */
export async function campanasCorriendo(salvo?: string) {
  await dbConnect();
  return EncuestaCuestionarioModel.countDocuments({ estado: "CORRIENDO", ...(salvo ? { _id: { $ne: new Types.ObjectId(salvo) } } : {}) });
}

/** Cambia el estado de una campaña y deja dicho por qué. */
export async function ponerEstado(id: string, estado: EstadoCampana, motivo: string | null = null) {
  await dbConnect();
  const ahora = new Date();
  await EncuestaCuestionarioModel.updateOne(
    { _id: id },
    {
      $set: {
        estado, motivo,
        ...(estado === "CORRIENDO" ? { terminada: null } : {}),
        ...(estado === "TERMINADA" ? { terminada: ahora } : {}),
      },
    },
  );
  // La primera vez que arranca. ($min no sirve: en Mongo null es menor que cualquier fecha.)
  if (estado === "CORRIENDO") await EncuestaCuestionarioModel.updateOne({ _id: id, iniciada: null }, { $set: { iniciada: ahora } });
}
