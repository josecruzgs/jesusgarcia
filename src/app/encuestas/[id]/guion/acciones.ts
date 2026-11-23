"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Types } from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import EncuestaCuestionarioModel from "@/lib/models/EncuestaCuestionario";
import EncuestaLlamadaModel from "@/lib/models/EncuestaLlamada";
import EncuestaCambioModel from "@/lib/models/EncuestaCambio";
import { requireAdmin } from "@/lib/encuestas/acceso";
import { leerCampana, leerOpciones, type CuestionarioActivo } from "@/lib/encuestas/llamadas";
import { clavear } from "@/lib/encuestas/agente_voz";
import { ajustarFrases, ajustarNumeroDePreguntas, leerFrases, sincronizarAgente, ROTULO_FRASES, type Frases } from "@/lib/encuestas/guion";

export type OpcionEditada = { original: string | null; texto: string; seLee: boolean };
export type PreguntaEditada = { id: string; texto: string; corto: string; reglas: string; opciones: OpcionEditada[] };
export type GuionEditado = { saludo: string; cierre: string; frases: Frases; preguntas: PreguntaEditada[] };
export type Resultado = { ok?: string; error?: string } | undefined;

/** Las preguntas que se agregan en el editor llegan con este id provisional; al guardar reciben el suyo. */
const PREFIJO_NUEVA = "nueva-";
const MAX_PREGUNTAS = 8;
/** Campos que el agente ya extrae por su cuenta: ninguna pregunta puede llamarse así. */
const RESERVADAS = ["acepto", "resultado", "no_llamar"];

/** El nombre del campo que extrae ElevenLabs para una pregunta nueva: corto, sin acentos y que no choque con otro. */
function claveNueva(base: string, usadas: Set<string>) {
  const raiz = clavear(base).split("_").filter((w) => w.length > 2).slice(0, 3).join("_").slice(0, 30) || "pregunta";
  let k = raiz;
  for (let i = 2; usadas.has(k); i++) k = `${raiz}_${i}`;
  usadas.add(k);
  return k;
}

const limpia = (x: unknown, max: number) => String(x ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const renglones = (x: unknown, max: number) => String(x ?? "").split("\n").map((l) => l.trim()).filter(Boolean).join("\n").slice(0, max);

/** Cuántas llamadas guardaron esa opción en esa pregunta. */
const conRespuesta = (preguntaId: string, valor: string) =>
  EncuestaLlamadaModel.countDocuments({ respuestas: { $elemMatch: { preguntaId: new Types.ObjectId(preguntaId), valor } } });

/** Cambia el valor guardado de una opción en todas las llamadas que la tienen. */
const renombrarRespuestas = (preguntaId: string, de: string, a: string) =>
  EncuestaLlamadaModel.updateMany(
    { respuestas: { $elemMatch: { preguntaId: new Types.ObjectId(preguntaId), valor: de } } },
    { $set: { "respuestas.$[r].valor": a } },
    { arrayFilters: [{ "r.preguntaId": new Types.ObjectId(preguntaId), "r.valor": de }] },
  );

/**
 * GUARDAR EL GUION. Primero se le manda a la asistente de voz y solo si ElevenLabs lo acepta se guarda en la base: así
 * nunca queda el tablero diciendo una cosa y la asistente otra. Cada guardado sube la versión y deja constancia de qué
 * cambió y quién lo cambió, porque cambiar una pregunta a media encuesta cambia lo que se mide.
 *
 * Las opciones conservan su historia: si se le cambia el nombre a una («Malo» → «Mal»), las respuestas que ya tenía pasan
 * al nombre nuevo. Una opción que ya tiene respuestas no se puede quitar (se puede renombrar).
 *
 * Las preguntas se pueden agregar, quitar y reordenar. Una pregunta quitada deja de hacerse y de verse en el tablero, pero
 * las respuestas que ya tenía se quedan guardadas en sus llamadas (no se borra nada).
 */
export async function guardarGuion(_prev: Resultado, formData: FormData): Promise<Resultado> {
  const s = await requireAdmin();
  let g: GuionEditado;
  try { g = JSON.parse(String(formData.get("datos") ?? "")); } catch { return { error: "No llegó el guion completo; recarga la página e inténtalo otra vez." }; }
  const c = await leerCampana(String(formData.get("campana") ?? ""));
  if (!c) return { error: "Esa campaña ya no existe; vuelve a la lista de campañas." };

  let saludo = limpia(g.saludo, 400);
  const cierre = limpia(g.cierre, 300);
  if (saludo.length < 15) return { error: "La introducción quedó muy corta: tiene que decir quién llama y pedir permiso." };
  if (!cierre) return { error: "Falta la despedida." };
  let frases = leerFrases(null);
  for (const k of Object.keys(frases) as (keyof Frases)[]) {
    const v = limpia(g.frases?.[k], 300);
    if (!v) return { error: `Falta qué contesta la asistente «${ROTULO_FRASES[k].toLowerCase()}».` };
    frases[k] = v;
  }

  const editadas = Array.isArray(g.preguntas) ? g.preguntas : [];
  if (!editadas.length) return { error: "La encuesta necesita al menos una pregunta." };
  if (editadas.length > MAX_PREGUNTAS) return { error: `Son demasiadas preguntas (máximo ${MAX_PREGUNTAS}): por teléfono la gente cuelga.` };
  const ids = new Set(editadas.map((e) => String(e.id)));
  if (ids.size !== editadas.length) return { error: "Hay una pregunta repetida; recarga la página e inténtalo otra vez." };
  // Las claves ya usadas (también las de preguntas quitadas) no se reutilizan: el agente las devuelve por nombre.
  const claves = new Set<string>([...RESERVADAS, ...c.preguntas.map((p) => p.clave)]);

  const cambiosRespuestas: { preguntaId: string; de: string; a: string }[] = [];
  const nuevas: CuestionarioActivo["preguntas"] = [];
  for (const [i, e] of editadas.entries()) {
    const p = c.preguntas.find((x) => x.id === String(e.id));
    if (!p && !String(e.id).startsWith(PREFIJO_NUEVA)) return { error: "Una de las preguntas ya no existe; recarga la página e inténtalo otra vez." };
    const n = i + 1;
    const texto = limpia(e.texto, 500);
    if (texto.length < 10) return { error: `La pregunta ${n} quedó vacía o muy corta.` };
    const opciones = (e.opciones ?? []).map((o) => ({ original: p && o.original ? String(o.original) : null, texto: limpia(o.texto, 60), seLee: !!o.seLee })).filter((o) => o.texto);
    if (opciones.length < 2) return { error: `La pregunta ${n} necesita al menos dos respuestas posibles.` };
    if (opciones.length > 12) return { error: `La pregunta ${n} tiene demasiadas opciones (máximo 12).` };
    if (!opciones.some((o) => o.seLee)) return { error: `En la pregunta ${n} al menos una opción se tiene que decir en voz alta.` };
    const vistas = new Set<string>();
    for (const o of opciones) {
      const k = clavear(o.texto);
      if (vistas.has(k)) return { error: `En la pregunta ${n}, «${o.texto}» está repetida.` };
      vistas.add(k);
    }
    const corto = limpia(e.corto, 140);
    const comun = { texto, reglas: renglones(e.reglas, 1200) || null, opciones: opciones.map((o) => o.texto), noSeLeen: opciones.filter((o) => !o.seLee).map((o) => o.texto), orden: i };
    if (!p) {
      nuevas.push({ ...comun, id: String(new Types.ObjectId()), clave: claveNueva(corto || texto, claves), corto: corto || null, tipo: "OPCION_UNICA" });
      continue;
    }
    // Lo que se quitó no puede tener respuestas; lo que se renombró se lleva sus respuestas.
    const antes = leerOpciones(p.opciones);
    const quedan = new Set(opciones.map((o) => o.original).filter(Boolean));
    for (const viejo of antes.filter((x) => !quedan.has(x))) {
      const cuantas = await conRespuesta(p.id, viejo);
      if (cuantas) return { error: `«${viejo}» (pregunta ${n}) ya tiene ${cuantas} ${cuantas === 1 ? "respuesta" : "respuestas"}: no se puede quitar, pero sí cambiarle el nombre.` };
    }
    for (const o of opciones) if (o.original && o.original !== o.texto && antes.includes(o.original)) cambiosRespuestas.push({ preguntaId: p.id, de: o.original, a: o.texto });
    nuevas.push({ ...p, ...comun, corto: corto || p.corto });
  }

  // «Una encuesta de dos preguntas» tiene que decir cuántas hay de verdad.
  saludo = ajustarNumeroDePreguntas(saludo, nuevas.length);
  frases = ajustarFrases(frases, nuevas.length);
  const nuevo: CuestionarioActivo = { ...c, saludo, cierre, frases: JSON.stringify(frases), version: c.version + 1, preguntas: nuevas };
  const resumen = resumir(c, nuevo);
  if (!resumen.length) {
    // Sin cambios en el texto, igual se le vuelve a mandar a la asistente: es la forma de ponerla al día a mano.
    const r = await sincronizarAgente(c);
    return r.ok ? { ok: "No había cambios en el guion; la asistente se actualizó con él." } : { error: `La asistente no se actualizó: ${r.error}` };
  }

  // Primero la asistente: si ElevenLabs no lo acepta, no se guarda nada.
  const r = await sincronizarAgente(nuevo);
  if (!r.ok) return { error: `No se guardó: ${r.error}` };
  // La campaña que todavía no tenía asistente estrena una.
  if (r.creado && r.agenteId) await EncuestaCuestionarioModel.updateOne({ _id: c.id }, { $set: { agenteId: r.agenteId } });

  await dbConnect();
  // Las preguntas se reescriben con su mismo _id: las respuestas de las llamadas les apuntan por ahí.
  await EncuestaCuestionarioModel.updateOne(
    { _id: c.id },
    {
      $set: {
        saludo, cierre, frases: nuevo.frases, version: nuevo.version,
        preguntas: nuevas.map((p) => ({ _id: new Types.ObjectId(p.id), clave: p.clave, texto: p.texto, corto: p.corto, tipo: p.tipo, opciones: p.opciones, noSeLeen: p.noSeLeen, reglas: p.reglas, orden: p.orden })),
      },
    },
  );
  // En dos pasos, para que intercambiar dos nombres (A→B y B→A) no los revuelva.
  for (const [k, x] of cambiosRespuestas.entries()) await renombrarRespuestas(x.preguntaId, x.de, `__renombrando__${k}`);
  for (const [k, x] of cambiosRespuestas.entries()) await renombrarRespuestas(x.preguntaId, `__renombrando__${k}`, x.a);
  await EncuestaCambioModel.create({
    cuestionarioId: c.id, version: nuevo.version, usuarioId: s.id, nombre: s.nombre, resumen: resumen.join(" · "),
    guion: JSON.stringify({ saludo, cierre, frases, preguntas: nuevas.map((p) => ({ clave: p.clave, texto: p.texto, corto: p.corto, opciones: p.opciones, noSeLeen: p.noSeLeen, reglas: p.reglas })) }),
  });
  revalidatePath("/encuestas", "layout");
  // Se recarga la página (y el editor, que arranca de la versión nueva) con el aviso arriba.
  redirect(`/encuestas/${c.id}/guion?ok=${encodeURIComponent(`Guardado (versión ${nuevo.version}). La asistente ya lo usa desde la siguiente llamada. Cambió: ${resumen.join(" · ")}.`)}`);
}

/** Qué cambió, en palabras, para el historial. */
function resumir(a: CuestionarioActivo, b: CuestionarioActivo) {
  const out: string[] = [];
  if (a.saludo !== b.saludo) out.push("introducción");
  if (a.cierre !== b.cierre) out.push("despedida");
  const fa = leerFrases(a.frases), fb = leerFrases(b.frases);
  for (const k of Object.keys(fa) as (keyof Frases)[]) if (fa[k] !== fb[k]) out.push(`respuesta «${ROTULO_FRASES[k].toLowerCase()}»`);
  for (const [i, q] of b.preguntas.entries()) {
    const p = a.preguntas.find((x) => x.id === q.id);
    const n = `pregunta ${i + 1}`;
    if (!p) { out.push(`${n}: nueva`); continue; }
    if (p.texto !== q.texto) out.push(`${n}: texto`);
    if ((p.corto ?? "") !== (q.corto ?? "")) out.push(`${n}: título en el tablero`);
    if ((p.reglas ?? "") !== (q.reglas ?? "")) out.push(`${n}: indicaciones`);
    const oa = leerOpciones(p.opciones), ob = leerOpciones(q.opciones);
    if (JSON.stringify(oa) !== JSON.stringify(ob)) out.push(`${n}: opciones`);
    else if (JSON.stringify(leerOpciones(p.noSeLeen)) !== JSON.stringify(leerOpciones(q.noSeLeen))) out.push(`${n}: qué se dice en voz alta`);
  }
  for (const p of a.preguntas) if (!b.preguntas.some((q) => q.id === p.id)) out.push(`se quitó «${p.corto ?? p.texto.slice(0, 40)}»`);
  const quedan = a.preguntas.filter((p) => b.preguntas.some((q) => q.id === p.id)).map((p) => p.id);
  const ahora = b.preguntas.filter((q) => quedan.includes(q.id)).map((q) => q.id);
  if (JSON.stringify(quedan) !== JSON.stringify(ahora)) out.push("orden de las preguntas");
  return out;
}
