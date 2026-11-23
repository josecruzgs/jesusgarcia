import { Types } from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import EncuestaLlamadaModel from "@/lib/models/EncuestaLlamada";
import EncuestaContactoModel from "@/lib/models/EncuestaContacto";
import EncuestaDestinatarioModel from "@/lib/models/EncuestaDestinatario";
import EncuestaCuestionarioModel from "@/lib/models/EncuestaCuestionario";
import EncuestaConfigModel from "@/lib/models/EncuestaConfig";
import { aCampana, leerOpciones, esDemo, type Campana, type CampanaDoc } from "./llamadas";
import { horarioDe, vozParaLlamada, vocesUsables, ponerEstado, asegurarCampanas } from "./campanas";
import { huella, descifrar, cifrar, finDe, telefonoDeLlamada, hayClaveDeBase, FALTA_CLAVE } from "./cifrado";
import { migrarACifrado } from "./base";
import { sincronizarAgente, ARMADO } from "./guion";

/**
 * LAS LLAMADAS DE LAS CAMPAÑAS, CON LA ASISTENTE VIRTUAL.
 *
 * ElevenLabs marca, habla, escucha y al colgar deja la plática con sus campos ya extraídos. Lo que importa es que eso
 * entre a la campaña: una llamada que ocurrió y no quedó registrada no ocurrió para ningún resultado.
 *
 * Se traen las pláticas en vez de esperar un webhook: traerlas se puede repetir cuantas veces se quiera (cada plática se
 * guarda con su identificador y el segundo intento no duplica nada) y si algo falló, se vuelve a traer y ya. Lo hacen el
 * worker cada 2 minutos (src/worker/index.ts) y el tablero abierto cada 15 segundos.
 *
 * Cada campaña tiene su agente, su horario, sus reglas de reintento y sus destinatarios. Lo que vale para todas a la vez:
 * las líneas telefónicas (ELEVENLABS_SIMULTANEAS) se reparten entre las campañas que estén llamando, a quien pidió que no
 * le llamen no lo llama ninguna, y a un número no se le marca si ya está en otra llamada.
 *
 * Lo que el agente extrae se guarda tal cual, sin corregirlo: si dijo que no sabe, se guarda que no sabe.
 *
 * Las variables de entorno se leen al usarse y no al cargar el archivo: el worker también lo importa, y ahí dotenv corre
 * en el mismo arranque.
 */
const API = "https://api.elevenlabs.io/v1/convai";
const numeroId = () => process.env.ELEVENLABS_NUMERO_ID ?? "";
/** ¿Está conectado ElevenLabs? Cada campaña tiene su agente; aquí solo se necesita la llave. */
export const hayAgenteDeVoz = () => !!process.env.ELEVENLABS_API_KEY;
const llaves = () => ({ "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "" });

const fueraDeHorario = (c: Campana) => `Fuera de horario: esta campaña llama ${horarioDe(c).texto} (hora de Baja California). Las pruebas a tu número sí salen a cualquier hora.`;

type Platica = { conversation_id: string };
type Detalle = {
  conversation_id: string;
  status?: string;
  metadata?: { start_time_unix_secs?: number; call_duration_secs?: number; phone_call?: { external_number?: string; call_result?: string }; error?: { reason?: string | null; error_type?: string } | null };
  analysis?: { data_collection_results?: Record<string, { value?: unknown }>; transcript_summary?: string };
  transcript?: { role?: string; message?: string | null }[];
};

type LlamadaAbierta = { _id: Types.ObjectId; estado: string; inicio: Date; contactoId: Types.ObjectId | null; telefono: string | null; huella?: string | null; respuestas?: { preguntaId: Types.ObjectId; valor: string }[] };

/** Normaliza un texto para casar lo que dijo el agente con una opción de la lista («María José Núñez» = «maria jose nunez»). */
export const clavear = (x: string) =>
  x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/** Lo que se puede volver a marcar (con sus reglas) y lo que todavía está sonando. */
const POR_REMARCAR = ["NO_CONTESTO", "BUZON"];
const ALCANZABLE = ["PENDIENTE", "NO_CONTESTO", "BUZON", "EN_CURSO"];

/**
 * TRAER LAS LLAMADAS Y REGISTRARLAS, de las campañas que tienen algo que traer: las que están llamando y las que tuvieron
 * llamadas en las últimas horas (una campaña en pausa puede tener llamadas que todavía no cuelgan).
 */
export async function importarLlamadasDelAgente({ limite = 30, campanaId = null }: { limite?: number; campanaId?: string | null } = {}) {
  if (!hayAgenteDeVoz()) return { ok: false as const, error: "Falta la llave de ElevenLabs (ELEVENLABS_API_KEY)." };
  await asegurarCampanas();
  await migrarACifrado();
  await cerrarHuerfanas();
  const recientes = await EncuestaLlamadaModel.distinct("cuestionarioId", { inicio: { $gte: new Date(Date.now() - 3 * 3600_000) } });
  const filtro = campanaId && Types.ObjectId.isValid(campanaId)
    ? { _id: new Types.ObjectId(campanaId) }
    : { agenteId: { $nin: [null, ""] }, $or: [{ estado: "CORRIENDO" }, { _id: { $in: recientes } }] };
  const campanas = (await EncuestaCuestionarioModel.find(filtro).lean<CampanaDoc[]>()).map(aCampana).filter((c) => c.agenteId);

  let nuevas = 0, saltadas = 0, revisadas = 0;
  const problemas: string[] = [];
  for (const c of campanas) {
    const r = await importarDe(c, limite);
    nuevas += r.nuevas; saltadas += r.saltadas; revisadas += r.revisadas;
    problemas.push(...r.problemas.map((p) => `${c.nombre}: ${p}`));
  }
  return { ok: true as const, nuevas, saltadas, revisadas, problemas };
}

/** La llamada que se abrió y nunca recibió el identificador de su plática no se va a poder traer: no salió. */
async function cerrarHuerfanas() {
  // `externoId: null` en Mongo casa también con el campo que no existe.
  const viejas = await EncuestaLlamadaModel.find({ estado: "EN_CURSO", externoId: null, inicio: { $lt: new Date(Date.now() - 2 * 3600_000) } })
    .select("cuestionarioId contactoId").lean<{ _id: Types.ObjectId; cuestionarioId: Types.ObjectId; contactoId: Types.ObjectId | null }[]>();
  for (const l of viejas) {
    await EncuestaLlamadaModel.updateOne({ _id: l._id }, { $set: { estado: "NO_SALIO", fin: new Date(), segundos: 0, notas: "No salió: la llamada nunca se conectó." } });
    if (l.contactoId) await devolverDestinatario(l.cuestionarioId, l.contactoId);
  }
}

async function importarDe(c: Campana, limite: number) {
  const problemas: string[] = [];
  const lista = await fetch(`${API}/conversations?agent_id=${encodeURIComponent(c.agenteId ?? "")}&page_size=${limite}`, { headers: llaves(), cache: "no-store" });
  if (!lista.ok) return { nuevas: 0, saltadas: 0, revisadas: 0, problemas: [`ElevenLabs contestó ${lista.status} al pedir las pláticas.`] };
  const { conversations = [] } = (await lista.json()) as { conversations?: Platica[] };

  // Las que se abrieron al marcar y siguen sin desenlace se revisan aunque ya no salgan en la primera página.
  const abiertas = await EncuestaLlamadaModel.find({ cuestionarioId: c.id, estado: "EN_CURSO", externoId: { $exists: true, $ne: null } }).select("externoId").lean<{ externoId: string }[]>();
  const ids = [...new Set([...conversations.map((x) => x.conversation_id), ...abiertas.map((x) => x.externoId)])];

  let nuevas = 0, saltadas = 0;

  for (const id of ids) {
    const ya = await EncuestaLlamadaModel.findOne({ externoId: id }).lean<LlamadaAbierta>();
    if (ya && ya.estado !== "EN_CURSO") { saltadas++; continue; } // lo que ya tiene desenlace no se toca

    const det = await fetch(`${API}/conversations/${id}`, { headers: llaves(), cache: "no-store" });
    if (!det.ok) {
      if (ya && det.status === 404 && Date.now() - new Date(ya.inicio).getTime() > 30 * 60_000) {
        await cerrarDestinatario(c.id, ya.contactoId, "NO_CONTESTO", null);
        await EncuestaLlamadaModel.updateOne({ _id: ya._id }, { $set: { estado: "NO_CONTESTO", fin: new Date() } });
        nuevas++;
      } else problemas.push(`${id}: ${det.status}`);
      continue;
    }
    const d = (await det.json()) as Detalle;
    const st = (d.status ?? "").toLowerCase();
    const arranco = d.metadata?.start_time_unix_secs ? d.metadata.start_time_unix_secs * 1000 : ya ? new Date(ya.inicio).getTime() : Date.now();
    const tel = d.metadata?.phone_call?.external_number?.replace(/\D/g, "").slice(-10) || null;
    // La que no se abrió al marcar (marcada desde la consola de ElevenLabs) se reconoce por el número entre los destinatarios.
    const destinatarioEnCurso = async () => (tel ? (await EncuestaDestinatarioModel.findOne({ campanaId: c.id, huella: huella(tel), estado: "EN_CURSO" }).select("contactoId").lean<{ contactoId: Types.ObjectId }>())?.contactoId ?? null : null);

    // LAS QUE NUNCA SALIERON: la plataforma las rechazó (pago, error al iniciar) o se quedaron «initiated» más de 10 min.
    // A esa persona no le sonó el teléfono: no es un intento y regresa a la fila sin gastarle un intento.
    const motivo = d.metadata?.error?.reason ?? "";
    const pago = /payment|pago|billing|quota|credit/i.test(motivo);
    // Un número que la línea no permite marcar («Account not authorized to call +52…») no es falla de la línea: es ese número,
    // y se aparta como número malo. Tomado como falla general, ese número volvía a ser el primero de la fila y frenaba todo.
    const numeroNoPermitido = esNumeroNoPermitido(motivo);
    const fallaDeSistema = !numeroNoPermitido && (pago || /initiali[sz]|internal|auth|permission|forbidden|not allowed|invalid/i.test(`${motivo} ${d.metadata?.error?.error_type ?? ""}`));
    // Con el timbre de 20 s, la que nadie contestó queda «initiated» con call_result «no_answer» (o «busy»): sí fue intento.
    const resultadoTel = (d.metadata?.phone_call?.call_result ?? "").toLowerCase();
    const sinRespuesta = ["no_answer", "no-answer", "busy", "canceled", "cancelled"].includes(resultadoTel);
    if (numeroNoPermitido && st === "failed") {
      const nota = "La línea telefónica no permite llamar a este número (permisos de Twilio).";
      if (ya) await EncuestaLlamadaModel.updateOne({ _id: ya._id }, { $set: { estado: "NO_SALIO", fin: new Date(), segundos: 0, notas: nota } });
      else await EncuestaLlamadaModel.create({ cuestionarioId: c.id, prueba: true, estado: "NO_SALIO", externoId: id, ...telefonoDeLlamada(tel, true), inicio: new Date(arranco), fin: new Date(), segundos: 0, notas: nota });
      if (tel) await apartarNumero(tel);
      nuevas++;
      continue;
    }
    const noSalio = !sinRespuesta && ((st === "failed" && fallaDeSistema) || (st === "initiated" && Date.now() - arranco > 10 * 60_000));
    if (noSalio) {
      const nota = "No salió: la llamada no se pudo conectar.";
      const contactoId = ya?.contactoId ?? (await destinatarioEnCurso());
      if (ya) await EncuestaLlamadaModel.updateOne({ _id: ya._id }, { $set: { estado: "NO_SALIO", fin: new Date(), segundos: 0, notas: nota } });
      else await EncuestaLlamadaModel.create({ cuestionarioId: c.id, prueba: !contactoId, estado: "NO_SALIO", externoId: id, ...telefonoDeLlamada(tel, !contactoId), contactoId, inicio: new Date(arranco), fin: new Date(), segundos: 0, notas: nota });
      if (contactoId) await devolverDestinatario(c.id, contactoId);
      if (fallaDeSistema) await avisarFallaDeVoz(pago ? "PAGO" : "SERVICIO", motivo);
      nuevas++;
      continue;
    }
    if (!sinRespuesta && (st === "in-progress" || st === "initiated" || st === "processing")) { saltadas++; continue; }
    await quitarAvisoDeVoz(arranco); // una llamada que sí conectó después del aviso quiere decir que el servicio volvió

    const campos = d.analysis?.data_collection_results ?? {};
    const valor = (k: string) => { const v = campos[k]?.value; return v === null || v === undefined ? "" : String(v).trim(); };

    // El desenlace lo dice el propio agente; si no lo dijo, se deduce de cómo terminó la llamada.
    const dicho = valor("resultado").toUpperCase();
    const noLlamar = ["true", "si", "sí", "yes"].includes(valor("no_llamar").toLowerCase());
    const acepto = valor("acepto").toUpperCase();
    const hablo = (d.transcript ?? []).some((t) => t.role === "user" && (t.message ?? "").trim());
    const estados = ["COMPLETA", "RECHAZO", "COLGO", "BUZON", "NUMERO_MALO", "NO_CONTESTO"];
    // Si la persona nunca dijo nada no se habló con ella, aunque el agente lo anote como «colgó»: contestó y colgó al oír la
    // grabación. Va como «no contestó» (se le vuelve a marcar con las reglas de reintento) y no infla la meta de contacto.
    let estado = sinRespuesta ? "NO_CONTESTO" : !hablo ? (["BUZON", "NUMERO_MALO"].includes(dicho) ? dicho : "NO_CONTESTO") : estados.includes(dicho) ? dicho : acepto === "NO" ? "RECHAZO" : "COLGO";

    // Cada pregunta, con su campo. Solo se acepta una opción de la lista: si el agente devolvió otra cosa, no se inventa.
    const respuestas: { preguntaId: string; valor: string }[] = [];
    for (const p of c.preguntas) {
      const dijo = valor(p.clave);
      if (!dijo) continue;
      const opcion = leerOpciones(p.opciones).find((o) => clavear(o) === clavear(dijo));
      if (opcion) respuestas.push({ preguntaId: p.id, valor: opcion });
      else problemas.push(`«${dijo}» no es una opción de «${p.clave}»; esa respuesta quedó sin guardar.`);
    }
    if (estado === "COMPLETA" && respuestas.length < c.preguntas.length) estado = "COLGO";

    const inicio = new Date(arranco);
    const segundos = d.metadata?.call_duration_secs ?? null;
    const dicha = (d.transcript ?? [])
      .map((t) => `${t.role === "agent" ? "Asistente" : "Persona"}: ${t.message ?? ""}`)
      .filter((l) => l.length > 12)
      .join("\n");
    const datos = {
      estado, inicio, segundos,
      fin: segundos ? new Date(inicio.getTime() + segundos * 1000) : new Date(),
      notas: ((noLlamar ? "Pidió que no le vuelvan a llamar. " : "") + (d.analysis?.transcript_summary ?? "")).slice(0, 1000) || null,
      transcripcion: dicha.slice(0, 20000) || null,
    };

    // Las respuestas que ya tuviera la llamada se conservan y las nuevas las pisan por pregunta.
    const porPregunta = new Map((ya?.respuestas ?? []).map((r) => [String(r.preguntaId), r.valor]));
    for (const r of respuestas) porPregunta.set(r.preguntaId, r.valor);
    const todas = [...porPregunta].map(([preguntaId, v]) => ({ preguntaId: new Types.ObjectId(preguntaId), valor: v }));

    let llamadaId: Types.ObjectId, contactoId: Types.ObjectId | null, laHuella: string | null;
    if (ya) {
      await EncuestaLlamadaModel.updateOne({ _id: ya._id }, { $set: { ...datos, respuestas: todas } });
      // De la llamada que se abrió al marcar solo queda la huella (las de verdad no guardan el número en claro).
      llamadaId = ya._id; contactoId = ya.contactoId ?? null; laHuella = ya.huella ?? (ya.telefono ? huella(ya.telefono) : tel ? huella(tel) : null);
    } else {
      const deLaLista = await destinatarioEnCurso();
      const l = await EncuestaLlamadaModel.create({ ...datos, respuestas: todas, cuestionarioId: c.id, prueba: !deLaLista, externoId: id, ...telefonoDeLlamada(tel, !deLaLista), contactoId: deLaLista, versionGuion: c.version });
      llamadaId = l._id; contactoId = deLaLista; laHuella = tel ? huella(tel) : null;
    }

    await cerrarDestinatario(c.id, contactoId, noLlamar ? "NO_LLAMAR" : estado, llamadaId);
    // Quien pidió que no le llamen queda apuntado para TODAS las campañas, aunque su número no viniera de ninguna lista (lo
    // mandó el panel o la API): así ninguna llamada futura le vuelve a marcar.
    if (noLlamar && laHuella) await marcarNoLlamar(laHuella, tel);
    nuevas++;
  }
  return { nuevas, saltadas, revisadas: ids.length, problemas };
}

/** El destinatario hereda el desenlace en su campaña (a quien ya contestó no se le vuelve a marcar), y el contacto lo guarda como su último resultado. */
async function cerrarDestinatario(campanaId: string | Types.ObjectId, contactoId: Types.ObjectId | null, estado: string, llamadaId: Types.ObjectId | null) {
  if (!contactoId) return;
  await EncuestaDestinatarioModel.updateOne({ campanaId, contactoId, estado: { $ne: "NO_LLAMAR" } }, { $set: { estado, llamadaId: estado === "COMPLETA" ? llamadaId : null } }).catch(() => null);
  await EncuestaContactoModel.updateOne({ _id: contactoId, estado: { $ne: "NO_LLAMAR" } }, { $set: { estado } }).catch(() => null);
}
/** La llamada no salió: el destinatario vuelve a la fila como si no se le hubiera marcado. */
async function devolverDestinatario(campanaId: string | Types.ObjectId, contactoId: Types.ObjectId) {
  const d = await EncuestaDestinatarioModel.findOne({ campanaId, contactoId }).select("intentos estado").lean<{ _id: Types.ObjectId; intentos: number; estado: string }>();
  if (d && d.estado === "EN_CURSO") await EncuestaDestinatarioModel.updateOne({ _id: d._id }, { $set: { estado: d.intentos > 1 ? "NO_CONTESTO" : "PENDIENTE", intentos: Math.max(0, d.intentos - 1) } }).catch(() => null);
}
/** No le vuelve a llamar ninguna campaña. Se apunta por la huella; sin dueño si su número no venía de la base de nadie. */
async function marcarNoLlamar(laHuella: string, tel: string | null) {
  await EncuestaContactoModel.updateOne(
    { telefono: laHuella },
    { $set: { estado: "NO_LLAMAR" }, $setOnInsert: { telCifrado: cifrar(tel), telFin: tel ? finDe(tel) : null, origenCifrado: cifrar("pidió no llamar"), subidoPor: null } },
    { upsert: true },
  ).catch(() => null);
  await EncuestaDestinatarioModel.updateMany({ huella: laHuella, estado: { $in: ALCANZABLE } }, { $set: { estado: "NO_LLAMAR" } }).catch(() => null);
}

async function leerConfig(clave: string) {
  return EncuestaConfigModel.findById(clave).lean<{ _id: string; valor: string }>();
}
async function guardarConfig(clave: string, valor: string) {
  await EncuestaConfigModel.updateOne({ _id: clave }, { $set: { valor } }, { upsert: true });
}
async function borrarConfig(clave: string) {
  await EncuestaConfigModel.deleteOne({ _id: clave });
}

/**
 * EL AVISO DE QUE LAS LLAMADAS NO ESTÁN SALIENDO. Es de todas las campañas (la línea es una): se guarda en la base para
 * que lo vea cualquiera que abra el tablero y se quita en cuanto una llamada vuelve a conectar.
 */
const CLAVE_AVISO = "agente_aviso";
async function avisarFallaDeVoz(tipo: string, motivo = "") {
  const ya = await avisoDeVoz();
  const texto = tipo === "PAGO"
    ? "El servicio de voz está rechazando las llamadas por un pago pendiente. Las campañas que llamaban quedaron en pausa y nadie perdió su turno; en cuanto se resuelva, dale «Reanudar» a cada una."
    : /account .* not active|authentication failed|suspend/i.test(motivo)
      ? "La línea telefónica (la cuenta de Twilio del número de salida) está inactiva o suspendida, así que ninguna llamada sale. En cuanto se reactive, el sistema retoma solo."
      : "La plataforma de llamadas no está conectando las llamadas. El sistema sigue probando solo y retoma en cuanto vuelvan a salir.";
  await guardarConfig(CLAVE_AVISO, JSON.stringify({ tipo, texto, desde: ya?.desde ?? new Date().toISOString() }));
  // El pago se resuelve a mano; lo demás se prueba solo: las campañas siguen y marcan de una en una hasta que una vuelva a salir.
  if (tipo === "PAGO") {
    const corriendo = await EncuestaCuestionarioModel.find({ estado: "CORRIENDO" }).select("_id").lean<{ _id: Types.ObjectId }[]>();
    for (const x of corriendo) await ponerEstado(String(x._id), "PAUSADA", "Pausada sola: el servicio de voz pide un pago pendiente.");
  }
}
const esNumeroNoPermitido = (motivo: string) => /not authorized to call \+?\d|is not a valid phone number|invalid ['"]?to['"]? phone/i.test(motivo);
/** Ese número no se puede marcar: sale de todas las filas como número malo (no cuenta en el total de la meta). */
async function apartarNumero(tel: string) {
  const h = huella(tel);
  await EncuestaDestinatarioModel.updateMany({ huella: h, estado: { $in: ALCANZABLE } }, { $set: { estado: "NUMERO_MALO" } });
  await EncuestaContactoModel.updateMany({ telefono: h, estado: { $ne: "NO_LLAMAR" } }, { $set: { estado: "NUMERO_MALO" } });
}
async function quitarAvisoDeVoz(siConectoEn?: number) {
  if (siConectoEn !== undefined) {
    const a = await avisoDeVoz();
    if (!a || new Date(a.desde).getTime() > siConectoEn) return; // una llamada vieja no prueba que ya se arregló
  }
  await borrarConfig(CLAVE_AVISO);
}
export async function avisoDeVoz(): Promise<{ tipo: string; texto: string; desde: string } | null> {
  await dbConnect();
  const f = await leerConfig(CLAVE_AVISO);
  try { return f ? JSON.parse(f.valor) : null; } catch { return null; }
}
export async function limpiarAvisoDeVoz() {
  await dbConnect();
  await quitarAvisoDeVoz();
}

/**
 * MARCARLE A UN NÚMERO CON LA ASISTENTE DE UNA CAMPAÑA. Cuesta dinero y suena el teléfono de una persona de verdad: solo lo
 * pide alguien desde el panel, la API o el motor de la campaña.
 *
 * `destinatarioId`: el motor ya apartó a ese destinatario (lo puso EN_CURSO y le sumó el intento). Sin él, si el número es
 * de la lista de la campaña y la llamada es de verdad, se aparta aquí mismo.
 */
const marcando = new Set<string>();

/**
 * PONER AL DÍA LA ASISTENTE (una vez por campaña y por proceso). El motor marca varias llamadas de la misma campaña en
 * una vuelta: todas esperan la misma actualización en vez de mandar cada una la suya.
 */
const poniendoAlDia = new Map<string, Promise<boolean>>();
async function asistenteAlDia(c: Campana) {
  if (c.armado === ARMADO) return;
  let p = poniendoAlDia.get(c.id);
  if (!p) {
    p = sincronizarAgente(c).then((s) => {
      if (!s.ok) console.warn(`[encuestas] «${c.nombre}»: no se pudo actualizar la asistente antes de llamar: ${s.error}`);
      return s.ok;
    });
    poniendoAlDia.set(c.id, p);
  }
  const ok = await p;
  if (ok) c.armado = ARMADO;
  else poniendoAlDia.delete(c.id);
}

export async function llamarConAgente(
  telefono: string,
  { campana: c, prueba = true, operadorId = null, destinatarioId = null }: { campana: Campana; prueba?: boolean; operadorId?: string | null; destinatarioId?: Types.ObjectId | null },
) {
  if (!hayAgenteDeVoz()) return { ok: false as const, error: "Falta la llave de ElevenLabs (ELEVENLABS_API_KEY)." };
  if (!numeroId()) return { ok: false as const, error: "Falta decir desde qué número se llama (ELEVENLABS_NUMERO_ID)." };
  if (!c.agenteId) return { ok: false as const, error: "Esta campaña todavía no tiene su asistente en ElevenLabs: guarda su configuración o su guion para crearla." };
  if (esDemo(c)) return { ok: false as const, error: "Es una campaña de demostración: no se llama con ella." };
  const digitos = telefono.replace(/\D/g, "");
  if (digitos.length < 10) return { ok: false as const, error: "El número va a diez dígitos." };
  const e164 = digitos.length === 10 ? `+52${digitos}` : `+${digitos}`;
  if (!prueba && !horarioDe(c).abierto) return { ok: false as const, error: fueraDeHorario(c) };
  if (!prueba && c.estado === "TERMINADA") return { ok: false as const, error: "La campaña ya terminó: reanúdala o marca la llamada como prueba." };
  const diez = digitos.slice(-10);
  if (!hayClaveDeBase()) return { ok: false as const, error: FALTA_CLAVE };
  await migrarACifrado();
  const laHuella = huella(diez);
  // Quien pidió que no le llamen no recibe ninguna llamada, de ninguna campaña, tampoco de prueba.
  if (await EncuestaContactoModel.exists({ telefono: laHuella, estado: "NO_LLAMAR" }))
    return { ok: false as const, error: "Esa persona pidió que no le volvieran a llamar." };
  // Dos clics seguidos en «Llamarme» (o una petición repetida) mandaban dos o tres llamadas al mismo número en el mismo
  // segundo: entre revisar si ya estaba en una llamada y abrirla pasa más de un segundo. Mientras se marca, el número queda apartado.
  if (marcando.has(laHuella)) return { ok: false as const, error: "Ya se está marcando a ese número." };
  marcando.add(laHuella);
  try {
    // Si el armado del guion cambió desde la última vez, la asistente se pone al día antes de llamar.
    await asistenteAlDia(c);
    // Un número puede estar en varias campañas, pero no se le marca mientras esté en otra llamada.
    if (await EncuestaLlamadaModel.exists({ huella: laHuella, estado: "EN_CURSO", inicio: { $gte: new Date(Date.now() - 15 * 60_000) } }))
      return { ok: false as const, error: "Ese número está en otra llamada ahora mismo." };

    // Con varias voces en la campaña, cada llamada sale con una al azar.
    const usables = await vocesUsables(c);
    const voz = usables.length > 1 ? vozParaLlamada(usables) : null;
    const r = await fetch(`${API}/twilio/outbound-call`, {
      method: "POST",
      headers: { ...llaves(), "Content-Type": "application/json" },
      // Si nadie contesta, se cuelga a los 20 s de timbrar: antes de que entre el buzón (en México suele entrar a los 25-30 s).
      body: JSON.stringify({
        agent_id: c.agenteId, agent_phone_number_id: numeroId(), to_number: e164,
        telephony_call_config: { ringing_timeout_secs: timbreSeg() },
        ...(voz ? { conversation_initiation_client_data: { conversation_config_override: { tts: { voice_id: voz } } } } : {}),
      }),
    });
    const cuerpo = (await r.json().catch(() => ({}))) as { success?: boolean; conversation_id?: string; message?: string; detail?: unknown };
    if (!r.ok || cuerpo.success === false)
      return { ok: false as const, error: `ElevenLabs contestó ${r.status}: ${cuerpo.message ?? JSON.stringify(cuerpo.detail ?? {}).slice(0, 200)}` };

    // La llamada se abre en cuanto sale: cuenta como intento aunque no contesten y al colgar se llena sola. A la lista solo
    // se liga lo real: una prueba a un número de la lista no le gasta su intento.
    let contactoId: Types.ObjectId | null = null;
    if (destinatarioId) {
      contactoId = (await EncuestaDestinatarioModel.findById(destinatarioId).select("contactoId").lean<{ contactoId: Types.ObjectId }>())?.contactoId ?? null;
    } else if (!prueba) {
      const d = await EncuestaDestinatarioModel.findOneAndUpdate(
        { campanaId: c.id, huella: laHuella, estado: { $nin: ["NO_LLAMAR", "EN_CURSO"] } },
        { $set: { estado: "EN_CURSO", ultimoIntento: new Date() }, $inc: { intentos: 1 } },
      ).select("contactoId").lean<{ contactoId: Types.ObjectId }>();
      contactoId = d?.contactoId ?? null;
    }
    const l = await EncuestaLlamadaModel.create({
      cuestionarioId: c.id, prueba, estado: "EN_CURSO",
      // undefined y no null: el índice único de externoId es disperso, y dos null chocarían.
      externoId: cuerpo.conversation_id ?? undefined,
      ...telefonoDeLlamada(diez, prueba), contactoId,
      operadorId: operadorId && Types.ObjectId.isValid(operadorId) ? operadorId : null,
      versionGuion: c.version,
    });
    if (contactoId) await EncuestaContactoModel.updateOne({ _id: contactoId, estado: { $ne: "NO_LLAMAR" } }, { $set: { estado: "EN_CURSO", ultimoIntento: new Date() }, $inc: { intentos: 1 } });
    return { ok: true as const, conversationId: cuerpo.conversation_id ?? null, numero: e164, llamadaId: String(l._id) };
  } finally {
    marcando.delete(laHuella);
  }
}

/**
 * CUÁNTAS A LA VEZ, ENTRE TODAS LAS CAMPAÑAS. El plan de ElevenLabs y la línea atienden un número limitado de llamadas al
 * mismo tiempo, y lo que pasa de ahí se pierde: nunca se abren más de `simultaneas()` (ELEVENLABS_SIMULTANEAS, 5 por
 * omisión) y la siguiente sale cuando una cuelga.
 */
export const simultaneas = () => Math.max(1, parseInt(process.env.ELEVENLABS_SIMULTANEAS ?? "") || 5);
const timbreSeg = () => Math.max(10, parseInt(process.env.LLAMADAS_TIMBRE_SEG ?? "") || 20);
const quinceMin = () => new Date(Date.now() - 15 * 60_000);
const lineasOcupadas = (campanaId?: string) => EncuestaLlamadaModel.countDocuments({ estado: "EN_CURSO", inicio: { $gte: quinceMin() }, ...(campanaId ? { cuestionarioId: campanaId } : {}) });

type Fila = { _id: Types.ObjectId; contactoId: Types.ObjectId; estado: string };

/**
 * MARCAR LOS SIGUIENTES DE UNA CAMPAÑA: primero los que nunca se llamaron y después los reintentos, con sus reglas. Cada
 * destinatario se aparta antes de marcarle (pasa a EN_CURSO de un solo golpe en la base), así dos revisiones al mismo
 * tiempo nunca le marcan dos veces a la misma persona.
 */
async function marcarCampana(c: Campana, cupo: number) {
  const marcadas: string[] = [];
  const saltadas: { telefono: string; porQue: string }[] = [];
  if (cupo <= 0) return { marcadas, saltadas, sinPorMarcar: false };
  const { intentos, esperaMin } = c.reintentos;
  const primero = await EncuestaDestinatarioModel.find({ campanaId: c.id, estado: "PENDIENTE" }).sort({ intentos: 1, createdAt: 1 }).limit(cupo * 2).select("contactoId estado").lean<Fila[]>();
  const reintentos = primero.length >= cupo || intentos <= 1 ? [] : await EncuestaDestinatarioModel.find({
    campanaId: c.id, estado: { $in: POR_REMARCAR }, intentos: { $lt: intentos }, ultimoIntento: { $lt: new Date(Date.now() - esperaMin * 60_000) },
  }).sort({ intentos: 1, ultimoIntento: 1 }).limit(cupo * 2).select("contactoId estado").lean<Fila[]>();
  const porMarcar = [...primero, ...reintentos];
  const contactos = new Map(
    (await EncuestaContactoModel.find({ _id: { $in: porMarcar.map((x) => x.contactoId) } }).select("telCifrado telFin estado").lean<{ _id: Types.ObjectId; telCifrado?: string | null; telFin?: string | null; estado: string }[]>())
      .map((x) => [String(x._id), x]),
  );

  for (const d of porMarcar) {
    if (marcadas.length >= cupo) break;
    const k = contactos.get(String(d.contactoId));
    // Se aparta de un solo golpe: si otra revisión ya lo tomó, este no se marca.
    const apartado = await EncuestaDestinatarioModel.updateOne(
      { _id: d._id, estado: d.estado },
      { $set: { estado: "EN_CURSO", ultimoIntento: new Date() }, $inc: { intentos: 1 } },
    );
    if (!apartado.modifiedCount) continue;
    const devolver = (estado = d.estado) => EncuestaDestinatarioModel.updateOne({ _id: d._id }, { $set: { estado }, $inc: { intentos: -1 } });
    // El número se descifra aquí, para marcar, y no sale de esta vuelta: lo que se reporta son los últimos 4 dígitos.
    const visible = `••• ${k?.telFin ?? "????"}`;
    if (!k) { await devolver("NUMERO_MALO"); saltadas.push({ telefono: visible, porQue: "el contacto ya no está en la base" }); continue; }
    if (k.estado === "NO_LLAMAR") { await devolver("NO_LLAMAR"); continue; }
    const tel = descifrar(k.telCifrado);
    if (!tel) {
      await devolver("NUMERO_MALO");
      saltadas.push({ telefono: visible, porQue: "no se pudo descifrar el número (¿cambió ENCUESTAS_CLAVE?)" });
      continue;
    }
    const r = await llamarConAgente(tel, { campana: c, prueba: false, destinatarioId: d._id });
    if (!r.ok) {
      if (esNumeroNoPermitido(r.error)) { await devolver(); await apartarNumero(tel); saltadas.push({ telefono: visible, porQue: "la línea no permite este número" }); continue; }
      await devolver(); // no le sonó: no se le gasta el intento
      saltadas.push({ telefono: visible, porQue: r.error.slice(0, 300) });
      continue;
    }
    marcadas.push(visible);
  }
  // Ninguna salió y todas porque la plataforma contestó con error: es una falla que se avisa, no «no hay a quién llamar».
  if (!marcadas.length && saltadas.length && saltadas.every((x) => /^ElevenLabs contestó/.test(x.porQue))) await avisarFallaDeVoz("SERVICIO", saltadas[0].porQue);
  return { marcadas, saltadas, sinPorMarcar: porMarcar.length === 0 };
}

/**
 * CÓMO VA UNA CAMPAÑA: cuántos faltan, con cuántos ya se habló y si ya se debería terminar. «Hablar» es que alguien
 * contestó, aunque haya sido para decir que no. A quien no contestó se le vuelve a marcar con las reglas de la campaña:
 * máximo de intentos, espera entre uno y otro y solo en su horario.
 */
const HABLO = ["COMPLETA", "RECHAZO", "COLGO", "NO_LLAMAR"];
export async function progresoDe(c: Campana) {
  await dbConnect();
  const cid = new Types.ObjectId(c.id);
  const [total, hablaron, pendientes, reintentables, sonando, reales] = await Promise.all([
    EncuestaDestinatarioModel.countDocuments({ campanaId: cid, estado: { $ne: "NUMERO_MALO" } }),
    EncuestaDestinatarioModel.countDocuments({ campanaId: cid, estado: { $in: HABLO } }),
    EncuestaDestinatarioModel.countDocuments({ campanaId: cid, estado: "PENDIENTE" }),
    c.reintentos.intentos > 1 ? EncuestaDestinatarioModel.countDocuments({ campanaId: cid, estado: { $in: POR_REMARCAR }, intentos: { $lt: c.reintentos.intentos } }) : Promise.resolve(0),
    EncuestaDestinatarioModel.countDocuments({ campanaId: cid, estado: "EN_CURSO" }),
    EncuestaLlamadaModel.countDocuments({ cuestionarioId: cid, prueba: false, estado: { $ne: "NO_SALIO" } }),
  ]);
  const pct = total ? Math.round((hablaron / total) * 1000) / 10 : 0;
  return { total, hablaron, pct, pendientes, reintentables, sonando, reales, porLlamarAlgunDia: pendientes + reintentables };
}

/** ¿Ya se tiene que terminar? Meta alcanzada, tope de llamadas o ya no queda a quién llamar (y nadie sigue en la línea). */
function motivoDeFin(c: Campana, p: Awaited<ReturnType<typeof progresoDe>>) {
  if (c.meta > 0 && p.total > 0 && p.pct >= c.meta) return `Meta alcanzada: ya se habló con el ${p.pct}% de los destinatarios.`;
  if (c.tope > 0 && p.reales >= c.tope) return `Llegó al tope de ${c.tope.toLocaleString("es-MX")} llamadas.`;
  if (p.porLlamarAlgunDia === 0 && p.sonando === 0) return p.total ? "Ya no queda a quién llamar." : "La campaña no tiene destinatarios.";
  return null;
}

/**
 * EL MOTOR DE LAS CAMPAÑAS. El worker (cada 2 min) y el tablero abierto (cada 15 s) llaman esto: revisa cada campaña que
 * está llamando, termina la que ya acabó y marca las que quepan en las líneas libres. Las líneas se reparten: cada
 * campaña toma a lo más su parte (o las que tenga puestas en «llamadas a la vez») y empieza la que lleva más tiempo
 * esperando, así ninguna se queda con todas.
 */
export async function seguirCampanas() {
  if (!hayAgenteDeVoz()) return { marcadas: 0, campanas: 0, errores: [] as string[] };
  await asegurarCampanas();
  const lista = (await EncuestaCuestionarioModel.find({ estado: "CORRIENDO" }).sort({ ultimaVuelta: 1 }).lean<CampanaDoc[]>()).map(aCampana);
  let marcadas = 0;
  const errores: string[] = [];
  const total = simultaneas();
  const parte = Math.max(1, Math.ceil(total / Math.max(1, lista.length)));
  // Con aviso de falla activo se prueba con una sola: si sale, el aviso se quita y la siguiente vuelta usa todas las líneas.
  const conAviso = !!(await avisoDeVoz());
  for (const c of lista) {
    const fin = motivoDeFin(c, await progresoDe(c));
    if (fin) { await ponerEstado(c.id, "TERMINADA", fin); continue; }
    if (!horarioDe(c).abierto) continue; // fuera de su horario espera, sin dejar de estar corriendo
    const libres = Math.max(0, total - (await lineasOcupadas()));
    if (!libres || (conAviso && marcadas >= 1)) break;
    const propias = await lineasOcupadas(c.id);
    const cupo = Math.min(libres, Math.max(0, (c.lineas > 0 ? c.lineas : parte) - propias), conAviso ? 1 : Infinity);
    if (!cupo) continue;
    // La vuelta se aparta: si otra revisión está marcando por esta campaña en este momento, esta no.
    const ahora = new Date();
    const vuelta = await EncuestaCuestionarioModel.updateOne(
      { _id: c.id, estado: "CORRIENDO", $or: [{ ultimaVuelta: null }, { ultimaVuelta: { $lt: new Date(ahora.getTime() - 8000) } }] },
      { $set: { ultimaVuelta: ahora } },
    );
    if (!vuelta.modifiedCount) continue;
    const r = await marcarCampana(c, cupo);
    marcadas += r.marcadas.length;
    if (!r.marcadas.length && r.saltadas.length) errores.push(`${c.nombre}: ${r.saltadas[0].porQue}`);
  }
  return { marcadas, campanas: lista.length, errores };
}

/** El tablero pregunta si alguna campaña está activa (llamando o con llamadas en la línea) para seguir refrescándose. */
export async function hayLlamadasEnCurso(campanaId?: string) {
  await dbConnect();
  return lineasOcupadas(campanaId);
}
