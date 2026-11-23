"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { Types } from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import EncuestaContactoModel from "@/lib/models/EncuestaContacto";
import EncuestaLlamadaModel from "@/lib/models/EncuestaLlamada";
import EncuestaDestinatarioModel from "@/lib/models/EncuestaDestinatario";
import EncuestaCuestionarioModel from "@/lib/models/EncuestaCuestionario";
import EncuestaCambioModel from "@/lib/models/EncuestaCambio";
import { requireAdmin, requireSesion } from "@/lib/encuestas/acceso";
import { importarLlamadasDelAgente, llamarConAgente, seguirCampanas, progresoDe, limpiarAvisoDeVoz, simultaneas } from "@/lib/encuestas/agente_voz";
import { cargarFilas, textoAFilas, filtroVisible, segmentos } from "@/lib/encuestas/base";
import { leerXlsx } from "@/lib/encuestas/xlsx";
import { hayClaveDeBase, FALTA_CLAVE } from "@/lib/encuestas/cifrado";
import { leerCampana, type Campana } from "@/lib/encuestas/llamadas";
import {
  crearCampana, agregarDestinatarios, campanasCorriendo, campanasSimultaneas, ponerEstado, catalogoDeVoces, horarioDe, asegurarCampanas,
} from "@/lib/encuestas/campanas";
import { sincronizarAgente, borrarAgente } from "@/lib/encuestas/guion";

function volver(msg: string, ok = true, ancla = "", base = "/encuestas"): never {
  redirect(`${base}${base.includes("?") ? "&" : "?"}${ok ? "ok" : "error"}=${encodeURIComponent(msg)}${ancla}`);
}
const n = (x: number) => x.toLocaleString("es-MX");
const numero = (v: FormDataEntryValue | null, min: number, max: number, omision: number) => {
  const x = Number(String(v ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(x) && String(v ?? "").trim() !== "" ? Math.min(max, Math.max(min, Math.round(x))) : omision;
};
const refrescar = () => revalidatePath("/encuestas", "layout");

/** La campaña del formulario (campo oculto `campana`). Si no existe, regresa a la lista. */
async function campanaDe(formData: FormData): Promise<Campana> {
  const c = await leerCampana(String(formData.get("campana") ?? ""));
  if (!c) volver("Esa campaña ya no existe.", false);
  return c;
}
const tablero = (c: Campana) => `/encuestas/${c.id}`;

/**
 * Le manda la campaña a su agente de ElevenLabs y, si el agente es nuevo, guarda su id. Devuelve el error en palabras o
 * null si todo salió bien.
 */
async function mandarAlAgente(c: Campana): Promise<string | null> {
  const r = await sincronizarAgente(c);
  if (!r.ok) return r.error;
  if (r.creado && r.agenteId) await EncuestaCuestionarioModel.updateOne({ _id: c.id }, { $set: { agenteId: r.agenteId } });
  return null;
}

// ── Crear, configurar, eliminar ────────────────────────────────────────────────────────────────────────────────────
/** «Nueva campaña»: en blanco (con la encuesta de ejemplo) o copiando el guion y la configuración de otra. */
export async function nuevaCampana(formData: FormData) {
  const s = await requireAdmin();
  await asegurarCampanas();
  const nombre = String(formData.get("nombre") ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (nombre.length < 3) volver("Ponle un nombre a la campaña (al menos 3 letras).", false, "#nueva");
  const copiarDe = String(formData.get("copiarDe") ?? "");
  const origen = copiarDe ? await leerCampana(copiarDe) : null;
  if (copiarDe && !origen) volver("La campaña de la que querías copiar ya no existe.", false, "#nueva");
  const id = await crearCampana({ nombre, copiarDe: origen, creadoPor: s.id });
  const c = await leerCampana(id);
  const error = c ? await mandarAlAgente(c) : null;
  refrescar();
  volver(
    error
      ? `Campaña creada, pero su asistente no se pudo crear en ElevenLabs (${error}). Se vuelve a intentar al guardar la configuración.`
      : `Campaña creada${origen ? ` con el guion de «${origen.nombre}»` : ""}. Revisa la voz, el horario y las reglas, y después agrega a quién llamar.`,
    !error, "", `/encuestas/${id}/configurar`,
  );
}

/** Los parámetros de la campaña: nombre, voz, horario y opciones avanzadas. Al guardar se actualiza su asistente. */
export async function guardarConfiguracion(formData: FormData) {
  await requireAdmin();
  const c = await campanaDe(formData);
  const base = `/encuestas/${c.id}/configurar`;
  const nombre = String(formData.get("nombre") ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (nombre.length < 3) volver("El nombre de la campaña quedó muy corto.", false, "", base);
  const etiquetas = String(formData.get("etiquetas") ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 12).map((x) => x.slice(0, 40));

  // Voz: un género y una o varias voces de ese género que existan en la cuenta de ElevenLabs.
  const genero: "F" | "M" = formData.get("genero") === "M" ? "M" : "F";
  const catalogo = await catalogoDeVoces();
  const voces = formData.getAll("voces").map(String).filter((id) => catalogo.some((v) => v.id === id && v.genero === genero));
  if (!voces.length) volver(`Escoge al menos una voz ${genero === "M" ? "masculina" : "femenina"}.`, false, "#voz", base);

  // Horario: 24 horas o de-hasta, y los días.
  const todoElDia = formData.get("todoElDia") === "on";
  const desde = todoElDia ? 0 : numero(formData.get("desde"), 0, 23, 9);
  const hasta = todoElDia ? 24 : numero(formData.get("hasta"), 1, 24, 20);
  if (!todoElDia && hasta <= desde) volver("La hora de fin tiene que ser después de la de inicio.", false, "#horario", base);
  const dias = formData.getAll("dias").map(Number).filter((x) => x >= 1 && x <= 7);
  if (!dias.length) volver("Escoge al menos un día para llamar.", false, "#horario", base);

  const cambios = {
    nombre, etiquetas,
    voz: { genero, voces },
    horario: { desde, hasta, dias },
    reintentos: { intentos: numero(formData.get("intentos"), 1, 10, 3), esperaMin: numero(formData.get("esperaMin"), 5, 24 * 60, 120) },
    buzon: formData.get("buzon") === "on",
    lineas: numero(formData.get("lineas"), 0, simultaneas(), 0),
    tope: numero(formData.get("tope"), 0, 1_000_000, 0),
    meta: numero(formData.get("meta"), 0, 100, 0),
  };
  await dbConnect();
  await EncuestaCuestionarioModel.updateOne({ _id: c.id }, { $set: cambios });
  const error = await mandarAlAgente({ ...c, ...cambios });
  refrescar();
  if (error) volver(`Se guardó la configuración, pero la asistente no se actualizó: ${error}`, false, "", base);
  volver("Configuración guardada. La asistente ya la usa desde la siguiente llamada.", true, "", base);
}

/** Solo un borrador sin llamadas reales se puede eliminar; lo demás tiene resultados que cuidar. */
export async function eliminarCampana(formData: FormData) {
  await requireAdmin();
  const c = await campanaDe(formData);
  if (c.estado !== "BORRADOR") volver("Solo se puede eliminar una campaña en borrador. Las demás tienen resultados: termínala si ya no se usa.", false, "", tablero(c));
  await dbConnect();
  if (await EncuestaLlamadaModel.exists({ cuestionarioId: c.id, prueba: false })) volver("Esta campaña ya tiene llamadas reales: no se puede eliminar.", false, "", tablero(c));
  await Promise.all([
    EncuestaDestinatarioModel.deleteMany({ campanaId: c.id }),
    EncuestaLlamadaModel.deleteMany({ cuestionarioId: c.id }),
    EncuestaCambioModel.deleteMany({ cuestionarioId: c.id }),
  ]);
  await EncuestaCuestionarioModel.deleteOne({ _id: c.id });
  if (c.agenteId && c.agenteId !== process.env.ELEVENLABS_AGENTE_ENCUESTA) await borrarAgente(c.agenteId);
  refrescar();
  volver(`Se eliminó «${c.nombre}».`);
}

// ── Iniciar, pausar, terminar ──────────────────────────────────────────────────────────────────────────────────────
/**
 * «Iniciar» (o «Reanudar»): la campaña empieza a llamar a sus destinatarios con sus reglas y sigue sola (worker + tablero
 * abierto) hasta acabar la lista, llegar a la meta o al tope. No pasa del número de campañas simultáneas de /ajustes.
 */
export async function iniciarCampana(formData: FormData) {
  await requireAdmin();
  const c = await campanaDe(formData);
  if (c.estado === "CORRIENDO") volver("La campaña ya está llamando.", true, "", tablero(c));
  const p = await progresoDe(c);
  if (!p.porLlamarAlgunDia) volver(p.total ? "No queda nadie a quién llamar en esta campaña: agrega más destinatarios o sube los reintentos." : "Primero agrega a quién llamar.", false, "#destinatarios", tablero(c));
  const [corriendo, limite] = await Promise.all([campanasCorriendo(c.id), campanasSimultaneas()]);
  if (corriendo >= limite) volver(`Ya ${corriendo === 1 ? "hay 1 campaña llamando" : `hay ${corriendo} campañas llamando`} y el límite es ${limite}. Pausa o termina otra, o pide a un admin que suba el límite en Ajustes.`, false, "", tablero(c));
  if (!c.agenteId) {
    const error = await mandarAlAgente(c);
    if (error) volver(`No se pudo preparar la asistente: ${error}`, false, "", tablero(c));
  }
  await limpiarAvisoDeVoz();
  await ponerEstado(c.id, "CORRIENDO");
  const h = horarioDe(c);
  const r = h.abierto ? await seguirCampanas() : { marcadas: 0, errores: [] as string[] };
  refrescar();
  if (r.errores.length && !r.marcadas) volver(`La campaña arrancó, pero la primera vuelta no pudo marcar: ${r.errores[0]}`, false, "", tablero(c));
  volver(
    h.abierto
      ? `Arrancó: ${r.marcadas} ${r.marcadas === 1 ? "llamada salió" : "llamadas salieron"} ya y el resto sale sola. Sigue aunque cierres esta pantalla.`
      : `Lista: está fuera de su horario y empieza sola ${h.texto}.`,
    true, "", tablero(c),
  );
}

export async function pausarCampana(formData: FormData) {
  await requireAdmin();
  const c = await campanaDe(formData);
  await ponerEstado(c.id, "PAUSADA", "Pausada desde el panel.");
  refrescar();
  volver("En pausa. Las que ya estaban en la línea terminan normal y se registran solas.", true, "", tablero(c));
}

export async function terminarCampana(formData: FormData) {
  await requireAdmin();
  const c = await campanaDe(formData);
  await ponerEstado(c.id, "TERMINADA", "Terminada desde el panel.");
  refrescar();
  volver("Campaña terminada. Sus resultados se quedan; si hace falta, se puede reanudar.", true, "", tablero(c));
}

// ── Llamadas ───────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * «Llamarme» / «Llamar a un número» con la asistente de esta campaña. Con «Es prueba» sale a cualquier hora y no cuenta en
 * los resultados; sin ella cuenta, respeta el horario y, si el número es de la lista, le gasta su intento.
 * `desde=guion` regresa al editor del guion. El resultado sale junto al botón (la página vuelve anclada en #probar).
 */
export async function llamarNumero(formData: FormData) {
  const s = await requireAdmin();
  const c = await campanaDe(formData);
  const tel = String(formData.get("telefono") ?? "");
  const prueba = formData.get("real") !== "on";
  const base = `${formData.get("desde") === "guion" ? `/encuestas/${c.id}/guion` : tablero(c)}?de=probar`;
  const r = await llamarConAgente(tel, { campana: c, prueba, operadorId: s.id });
  refrescar();
  if (!r.ok) volver(r.error, false, "#probar", base);
  volver(prueba
    ? `Llamando a ${r.numero}: contesta como si fueras una persona de la lista. Es prueba: no cuenta en los resultados.`
    : `Llamando a ${r.numero}. La respuesta aparece en «Las encuestas hechas» en cuanto cuelgue.`, true, "#probar", base);
}

/** Lo que pregunta el tablero abierto cada 15 s: registra lo que ya colgó y marca los siguientes de cada campaña. */
export async function seguirLlamadas() {
  await requireSesion();
  const a = await importarLlamadasDelAgente({ limite: 30 });
  const t = await seguirCampanas();
  const cambiaron = (a.ok && a.nuevas > 0) || t.marcadas > 0;
  if (cambiaron) refrescar();
  return { cambiaron };
}

export async function traerLlamadas(formData: FormData) {
  await requireAdmin();
  const c = await campanaDe(formData);
  const a = await importarLlamadasDelAgente({ limite: 100, campanaId: c.id });
  refrescar();
  if (!a.ok) volver(a.error, false, "#encuestas", tablero(c));
  volver(a.nuevas ? `${a.nuevas} ${a.nuevas === 1 ? "llamada registrada" : "llamadas registradas"}.` : "No había nada nuevo: todo lo que habló la asistente ya está registrado.", true, "#encuestas", tablero(c));
}

// ── Destinatarios y base ───────────────────────────────────────────────────────────────────────────────────────────
/** Lee un Excel, un CSV o la columna pegada. */
async function leerArchivo(formData: FormData, ancla: string, base: string) {
  const archivo = formData.get("archivo");
  const pegado = String(formData.get("pegado") ?? "");
  let filas: string[][] = [];
  let origen = "pegado";
  try {
    if (archivo instanceof File && archivo.size) {
      if (archivo.size > 8_000_000) volver("El archivo pasa de 8 MB. Pártelo en dos y sube cada parte.", false, ancla, base);
      if (/\.xls$/i.test(archivo.name)) volver("Ese es un Excel viejo (.xls). Ábrelo y guárdalo como .xlsx o CSV, y vuélvelo a subir.", false, ancla, base);
      origen = archivo.name.slice(0, 120);
      filas = /\.xlsx$/i.test(archivo.name) ? leerXlsx(Buffer.from(await archivo.arrayBuffer())) : textoAFilas(await archivo.text());
    } else if (pegado.trim()) filas = textoAFilas(pegado);
    else volver("No llegó ningún archivo ni números pegados.", false, ancla, base);
  } catch (e) {
    unstable_rethrow(e); // el redirect de volver() no es un error
    volver(e instanceof Error ? e.message : "No pude leer el archivo.", false, ancla, base);
  }
  return { filas, origen };
}

/** SUBIR LA BASE: Excel, CSV o la columna de teléfonos pegada. Con `campana`, además los mete a esa campaña. */
export async function subirBase(formData: FormData) {
  const s = await requireAdmin();
  const campanaId = String(formData.get("campana") ?? "");
  const c = campanaId ? await leerCampana(campanaId) : null;
  const ancla = c ? "#destinatarios" : "#base";
  const base = c ? tablero(c) : "/encuestas/base";
  if (!hayClaveDeBase()) volver(FALTA_CLAVE, false, ancla, base);
  const { filas, origen } = await leerArchivo(formData, ancla, base);
  // Quien la sube es su dueño: solo él ve los IDs y los números (ver lib/encuestas/cifrado.ts).
  const r = await cargarFilas(filas, origen, s.id);
  if (!r.cargadas && !r.repetidas) volver(`No encontré teléfonos válidos (${n(r.leidas)} renglones leídos). Revisa que la columna traiga celulares de 10 dígitos.`, false, ancla, base);
  const partes = [`${n(r.cargadas)} ${r.cargadas === 1 ? "teléfono nuevo" : "teléfonos nuevos"} en tu base de ${n(r.leidas)} renglones.`];
  if (r.repetidas) partes.push(`${n(r.repetidas)} ${r.repetidas === 1 ? "ya estaba" : "ya estaban"} y no se duplicaron.`);
  if (r.sinTelefono) partes.push(`${n(r.sinTelefono)} sin celular válido quedaron fuera.`);
  if (c) {
    const contactos = await EncuestaContactoModel.find({ telefono: { $in: r.huellas } }).select("telefono estado").lean<{ _id: Types.ObjectId; telefono: string; estado: string }[]>();
    const a = await agregarDestinatarios(c.id, contactos, s.id);
    partes.push(`A la campaña entraron ${n(a.nuevos)}${a.yaEstaban ? ` (${n(a.yaEstaban)} ya estaban en ella)` : ""}.`);
  } else partes.push("Se guardaron cifrados: solo tú ves los IDs y los números.");
  refrescar();
  volver(partes.join(" "), true, ancla, base);
}

/** Meter a la campaña contactos de la base que este usuario ve (la suya y la compartida), toda o por zona. */
export async function agregarDeMiBase(formData: FormData) {
  const s = await requireAdmin();
  const c = await campanaDe(formData);
  const municipio = String(formData.get("municipio") ?? ""), distrito = String(formData.get("distrito") ?? ""), seccion = String(formData.get("seccion") ?? "");
  await dbConnect();
  const seg = municipio || distrito || seccion ? await segmentos(s.id, { municipio, distrito, seccion }) : null;
  const filtro = seg ? { _id: { $in: seg.contactoIds ?? [] } } : filtroVisible(s.id);
  const contactos = await EncuestaContactoModel.find(filtro).select("telefono estado").lean<{ _id: Types.ObjectId; telefono: string; estado: string }[]>();
  if (!contactos.length) volver(seg ? "En esa zona no hay contactos en tu base." : "Tu base está vacía: sube primero un archivo.", false, "#destinatarios", tablero(c));
  const a = await agregarDestinatarios(c.id, contactos, s.id);
  refrescar();
  const zona = [municipio, distrito && `distrito ${distrito}`, seccion && `sección ${seccion}`].filter(Boolean).join(", ");
  volver(`${n(a.nuevos)} ${a.nuevos === 1 ? "destinatario agregado" : "destinatarios agregados"}${zona ? ` de ${zona}` : " de tu base"}.${a.yaEstaban ? ` ${n(a.yaEstaban)} ya estaban en la campaña.` : ""}`, true, "#destinatarios", tablero(c));
}

/** Quitar de la campaña a quien todavía no se le ha llamado. A quien ya se le llamó se queda: tiene historia en la campaña. */
export async function quitarPendientes(formData: FormData) {
  await requireAdmin();
  const c = await campanaDe(formData);
  await dbConnect();
  const r = await EncuestaDestinatarioModel.deleteMany({ campanaId: c.id, estado: "PENDIENTE", intentos: 0 });
  refrescar();
  volver(`Se quitaron ${n(r.deletedCount)} destinatarios sin llamar. Los que ya tuvieron llamada se quedan.`, true, "#destinatarios", tablero(c));
}

/**
 * Vaciar la base. Las llamadas hechas y sus respuestas se quedan: lo que se va es la lista de teléfonos (y, en las campañas,
 * quien todavía no tenía llamada). Cada quien vacía lo suyo (y lo compartido): la base de otro usuario no se borra desde aquí.
 */
export async function vaciarBase() {
  const s = await requireAdmin();
  await dbConnect();
  if (await EncuestaLlamadaModel.exists({ estado: "EN_CURSO", inicio: { $gte: new Date(Date.now() - 15 * 60_000) } })) volver("Hay llamadas en la línea: espera a que cuelguen antes de vaciar la base.", false, "#base", "/encuestas/base");
  // Quien pidió que no le llamen se queda apuntado: vaciar la lista no puede volver a ponerlo a tiro.
  const filtro = { estado: { $ne: "NO_LLAMAR" }, ...filtroVisible(s.id) };
  const ids = (await EncuestaContactoModel.find(filtro).select("_id").lean<{ _id: Types.ObjectId }[]>()).map((x) => x._id);
  const r = await EncuestaContactoModel.deleteMany({ _id: { $in: ids } });
  // En las campañas se va quien todavía no tenía llamada; a quien ya se le llamó ya no se le marca (no tiene número) y se queda con su historia.
  await EncuestaDestinatarioModel.deleteMany({ contactoId: { $in: ids }, estado: "PENDIENTE", intentos: 0 });
  refrescar();
  volver(`Base vaciada: ${n(r.deletedCount)} teléfonos. Las encuestas hechas siguen guardadas, y quien pidió que no le llamen sigue apuntado.`, true, "#base", "/encuestas/base");
}
