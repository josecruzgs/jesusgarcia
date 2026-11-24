import type { CuestionarioActivo } from "./llamadas";
import { leerOpciones, esDemo } from "./llamadas";
import { BRAND_NAME } from "@/lib/brand";
import { vocesUsables } from "./campanas";
import { dbConnect } from "@/lib/mongodb";
import EncuestaCuestionarioModel from "@/lib/models/EncuestaCuestionario";

/**
 * LA VERSIÓN DEL ARMADO. Lo que se le manda a la asistente sale de armarAgente y sincronizarAgente; cuando cambian (una
 * regla nueva, una corrección), las asistentes que ya existen siguen con lo viejo hasta que alguien guarde. Subir este
 * número hace que cada campaña actualice su asistente sola antes de su siguiente llamada (ver llamarConAgente).
 *  2: leer las opciones que no vienen en el texto de la pregunta y colgar en el mismo turno de la despedida.
 */
export const ARMADO = 2;

/**
 * EL GUION DE LA ASISTENTE, ARMADO DESDE LA BASE.
 *
 * Lo que dice la asistente vive en el cuestionario (saludo, preguntas, opciones, despedida y sus frases para cada
 * situación), así que se puede cambiar desde el panel (/encuestas/guion) sin tocar código. De aquí sale el primer
 * mensaje, las instrucciones y los campos que extrae ElevenLabs; al guardar se mandan al agente y quedan vivos en la
 * siguiente llamada.
 */
/** Quién levanta la encuesta, como lo dice la asistente si se lo preguntan (ENCUESTA_EMPRESA). Vacío: no lo dice, pero tampoco inventa. */
export const EMPRESA = (process.env.ENCUESTA_EMPRESA ?? "").trim();
export type Frases = { rechazo: string; noLlamar: string; quienSoy: string; paraQuien: string };
export const FRASES_BASE: Frases = {
  rechazo: "Entiendo, le agradezco su tiempo. ¡Que tenga excelente día!",
  noLlamar: "Con gusto, lo anoto. ¡Que tenga excelente día!",
  quienSoy: `Soy una asistente virtual${EMPRESA ? ` de ${EMPRESA}` : ""}; estoy levantando una encuesta de opinión de dos preguntas. No le voy a pedir ningún dato personal.`,
  paraQuien: EMPRESA ? `La realiza ${EMPRESA}. No tengo más información sobre el estudio.` : "Es un estudio de opinión; no estoy autorizada a dar el nombre de quien lo encarga.",
};
export const ROTULO_FRASES: Record<keyof Frases, string> = {
  rechazo: "Si no quiere participar",
  noLlamar: "Si pide que no le vuelvan a llamar",
  quienSoy: "Si pregunta quién habla o si es una persona",
  paraQuien: "Si pregunta para quién es la encuesta",
};

export function leerFrases(crudo: string | null | undefined): Frases {
  try { return { ...FRASES_BASE, ...(crudo ? (JSON.parse(crudo) as Partial<Frases>) : {}) }; } catch { return FRASES_BASE; }
}

const NUMEROS = ["cero", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez"];

/**
 * EL NÚMERO DE PREGUNTAS EN LO QUE DICE LA ASISTENTE. La introducción y «quién soy» dicen «una encuesta de dos preguntas»,
 * y al agregar o quitar una se quedaba diciendo el número viejo. Aquí se reescribe cualquier «<número> pregunta(s)» —en
 * palabra o en cifra— con el número real, en palabra. Se aplica al guardar (para que el panel lo muestre) y al armar el
 * agente (para que nunca salga uno viejo aunque el texto guardado no se haya vuelto a guardar).
 */
export function ajustarNumeroDePreguntas(texto: string, n: number) {
  if (!texto || n < 1) return texto;
  const palabra = NUMEROS[n] ?? String(n);
  const sustantivo = n === 1 ? "pregunta" : "preguntas";
  return texto.replace(/\b(un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|\d{1,2})(\s+)preguntas?\b/gi, (_, num: string, espacio: string) => {
    const nuevo = /^[A-ZÁÉÍÓÚ]/.test(num) ? palabra[0].toUpperCase() + palabra.slice(1) : palabra;
    return `${nuevo}${espacio}${sustantivo}`;
  });
}

/** Las frases con el número de preguntas puesto al día. */
export function ajustarFrases(f: Frases, n: number): Frases {
  return {
    rechazo: ajustarNumeroDePreguntas(f.rechazo, n),
    noLlamar: ajustarNumeroDePreguntas(f.noLlamar, n),
    quienSoy: ajustarNumeroDePreguntas(f.quienSoy, n),
    paraQuien: ajustarNumeroDePreguntas(f.paraQuien, n),
  };
}

const comillas = (x: string) => x.replace(/[«»]/g, '"').trim();
const frase = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} o ${xs[xs.length - 1]}` : xs.join(""));
const plano = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * ¿LA PREGUNTA YA DICE SUS OPCIONES? Si el texto es «¿…Goku o Saitama?», las opciones van dentro y basta con leerlo. Si
 * es solo «¿Quién es el humano más poderoso en Dragon Ball?», la asistente leía el texto tal cual y nunca decía las
 * opciones hasta que se las pedían. Sin todas las opciones en el texto, se le pide leerlas enseguida de la pregunta.
 */
export function opcionesEnElTexto(texto: string, opciones: string[]) {
  const t = plano(texto);
  return opciones.every((o) => t.includes(plano(o)));
}

/**
 * LOS TIEMPOS DE TURNO. Con solo 2.5 s de silencio («eager») antes de volver a hablar, a quien se quedaba pensando le
 * repetía la pregunta completa, hasta tres veces seguidas, y buena parte de esas personas colgaba. Con 6 s y «normal» la deja pensar sin que la llamada se sienta muerta.
 */
export const TURNO = { turn_timeout: 6, turn_eagerness: "normal", silence_end_call_timeout: 15 } as const;

/**
 * EL ECO DE SU PROPIA VOZ. En el teléfono, lo que dice la asistente a veces regresa por la línea y se transcribe como si lo
 * hubiera dicho la persona: justo cuando leía un nombre de la lista, el sistema «oyó» a la persona decir ese apellido
 * (en la grabación no se oye) y la asistente cortó la lista; en una llamada hasta se despidió antes de la respuesta. Las
 * palabras de las opciones no interrumpen: la asistente termina de leer y entonces escucha.
 */
export function palabrasSinInterrupcion(c: CuestionarioActivo) {
  // ElevenLabs rechaza el agente entero si algún término pasa de 20 caracteres: las opciones largas solo aportan sus palabras.
  const t = new Set<string>();
  const sumar = (s: string) => { const x = s.trim(); if (x && x.length <= 20) t.add(x); };
  for (const p of c.preguntas)
    for (const o of leerOpciones(p.opciones)) {
      sumar(o);
      for (const w of o.split(/\s+/)) if (w.length >= 3) sumar(w);
    }
  return [...t].slice(0, 80);
}

/**
 * EL GÉNERO DE LA VOZ EN LO QUE DICE. El guion se escribió para una voz de mujer («Soy una asistente virtual», «no estoy
 * autorizada»); con una voz de hombre eso suena mal. Aquí se cambian esas formas al género de la voz de la campaña, al
 * armar el agente, sin tocar lo guardado.
 */
export function ajustarGenero(texto: string, genero: "F" | "M") {
  if (!texto) return texto;
  const conMayuscula = (original: string, nuevo: string) => (/^[A-ZÁÉÍÓÚ]/.test(original) ? nuevo[0].toUpperCase() + nuevo.slice(1) : nuevo);
  const cambios: [RegExp, string][] = genero === "M"
    ? [[/\buna asistente\b/gi, "un asistente"], [/\bla asistente\b/gi, "el asistente"], [/\bautorizada\b/gi, "autorizado"], [/\bencargada\b/gi, "encargado"]]
    : [[/\bun asistente\b/gi, "una asistente"], [/\bel asistente\b/gi, "la asistente"], [/\bautorizado\b/gi, "autorizada"], [/\bencargado\b/gi, "encargada"]];
  return cambios.reduce((t, [re, nuevo]) => t.replace(re, (m) => conMayuscula(m, nuevo)), texto);
}

export function armarAgente(c: CuestionarioActivo) {
  const n = c.preguntas.length;
  const g = c.voz?.genero ?? "F";
  const base = ajustarFrases(leerFrases(c.frases), n);
  const frases: Frases = { rechazo: ajustarGenero(base.rechazo, g), noLlamar: ajustarGenero(base.noLlamar, g), quienSoy: ajustarGenero(base.quienSoy, g), paraQuien: ajustarGenero(base.paraQuien, g) };
  const preguntas = c.preguntas.map((p, i) => {
    const opciones = leerOpciones(p.opciones);
    const callar = leerOpciones(p.noSeLeen);
    const leer = opciones.filter((o) => !callar.includes(o));
    const dice = leer.length && !opcionesEnElTexto(p.texto, leer)
      ? `Dices exactamente, de corrido y sin números: «${comillas(p.texto)}» y, sin pausa, lees las opciones: «${frase(leer)}». Siempre lees las opciones, aunque no te las pidan.`
      : `Dices exactamente, de corrido y sin números: «${comillas(p.texto)}»`;
    const reglas = (p.reglas ?? "").split("\n").map((l) => l.replace(/^\s*[-•]\s*/, "").trim()).filter(Boolean);
    return `# PREGUNTA ${i + 1}
${i === 0 ? "" : "NO vuelvas a saludar. Di «Gracias.» y enseguida: "}${dice}
- Las únicas respuestas que registras son: ${opciones.map((o) => `«${o}»`).join(", ")}. Acepta una sola; si menciona dos, le pides que escoja una.
${callar.length ? `- NO digas ${callar.map((o) => `«${o}»`).join(" ni ")} como opción. Pero si la persona lo contesta, lo registras igual.\n` : ""}${reglas.map((r) => `- ${r}\n`).join("")}- Si pregunta «¿cuál?», «¿cómo?» o pide que repitas: repites SOLO las opciones, una vez («${frase(leer)}»). No repitas la pregunta completa.
- Si se queda callada, está pensando: espérala. No repitas nada.
- Si mientras todavía lees las opciones «se oye» un nombre o una palabra que tú misma acabas de decir, es el eco de tu voz en la línea, no su respuesta: termina de leer y espera. Solo cuenta lo que la persona dice después de que terminaste de preguntar. Nunca te despidas sin tener su respuesta.
- No preguntes por qué y no comentes la respuesta.${i === n - 1 ? " Después de esta pregunta la encuesta se acabó: nunca regreses a las anteriores." : ""}`;
  });

  const prompt = `# Quién eres
Eres ${g === "M" ? "un asistente virtual" : "una asistente virtual"}${EMPRESA ? ` de ${EMPRESA}` : ""}. Levantas por teléfono una encuesta de opinión muy corta sobre ${c.municipio ? `el futuro de ${c.municipio}` : "temas de tu estado"}. Hablas español de México, con calidez, claridad y sin prisa. Tu único trabajo es levantar esta encuesta y colgar.

# La regla que manda sobre todas
Eres neutral. No opines, no comentes, no felicites, no corrijas y no des información sobre ninguna institución, persona u opción por la que preguntas. Si te preguntan quién es alguien: «Solo estoy levantando la encuesta, no tengo información de las personas». Si insisten, repites la pregunta. Cualquier comentario tuyo contamina la respuesta.

# Cómo abres
Tu primer mensaje ya está dicho (la introducción). Esperas la respuesta.
- Si dice que sí (o «adelante», «está bien», «a ver»): pasas a la PREGUNTA 1.
- Si dice que no, que está ocupado o que no le interesa: «${comillas(frases.rechazo)}», y terminas con end_call.
- Si pide que no le vuelvan a llamar: «${comillas(frases.noLlamar)}», y terminas con end_call.
- Si pregunta quién eres o si eres una persona: «${comillas(frases.quienSoy)}». Y vuelves a pedir permiso.
- Si pregunta para quién es la encuesta: «${comillas(frases.paraQuien)}». No digas nada más sobre quién la encarga: no inventes clientes ni instituciones.
- Si notas que habla un menor de edad: agradeces y terminas con end_call.

${preguntas.join("\n\n")}

# Cómo cierras
En cuanto tienes la respuesta de la última pregunta, dices UNA sola vez: «${comillas(ajustarGenero(c.cierre ?? "", g) || "¡Muchas gracias por participar! ¡Que tenga excelente día!")}» y en ese mismo turno llamas a end_call. No esperas a que la persona conteste la despedida.
- La despedida nunca se repite. Si después de despedirte la persona dice algo («gracias», «igualmente») o se queda callada, no vuelves a hablar: solo llamas a end_call.
- Lo mismo cada vez que esta guía dice «y terminas con end_call»: dices la frase y cuelgas en el mismo turno, sin esperar.

# Si cuelga a media o cae en buzón
Lo que se alcanzó a preguntar vale. En buzón o grabadora no dejas mensaje: terminas con end_call.

# Cosas que nunca haces
- No pides nombre, dirección, edad, correo ni ningún dato personal.
- No prometes nada, no ofreces nada y no pides el voto por nadie.
- No te alargas: ${n === 1 ? "es una pregunta" : `son ${n} preguntas`} y se acaba.
- Nunca dices la misma frase dos veces seguidas. Si la persona tarda en contestar, esperas; si después de un buen rato no se oye nada, dices solo «¿Me escucha?». Esto es solo mientras esperas una respuesta: después de despedirte ya no hablas, cuelgas.`;

  const datos: Record<string, { type: "string" | "boolean"; description: string }> = {
    acepto: { type: "string", description: "¿Aceptó participar en la encuesta? Responde SI o NO." },
    resultado: { type: "string", description: `Cómo terminó la llamada. Responde exactamente con uno de: COMPLETA (contestó ${n === 1 ? "la pregunta" : `las ${n} preguntas`}), RECHAZO (no quiso participar o pidió que no le llamen), COLGO (empezó y colgó a media), BUZON (cayó en buzón o grabadora), NUMERO_MALO (número equivocado).` },
    no_llamar: { type: "boolean", description: "true solo si la persona pidió expresamente que no le vuelvan a llamar; false en cualquier otro caso." },
  };
  for (const p of c.preguntas)
    datos[p.clave] = { type: "string", description: `${comillas(p.texto)} Responde exactamente con uno de: ${leerOpciones(p.opciones).join(", ")}. Si nunca se llegó a esta pregunta, deja el valor vacío.` };

  return { primerMensaje: ajustarGenero(ajustarNumeroDePreguntas(c.saludo, n), g), prompt, datos };
}

const API = "https://api.elevenlabs.io/v1/convai/agents";
type Cfg = { conversation_config: Record<string, unknown> & { turn: unknown; agent: Record<string, unknown> & { prompt: Record<string, unknown> }; tts?: Record<string, unknown> } };

/**
 * LA CONFIGURACIÓN PROBADA EN CAMPO, para crear el agente desde cero (sin agente de donde copiarla). El modelo de voz más
 * rápido, transcripción de alta calidad y llamadas de máximo 5 minutos. La voz, el guion, los tiempos de turno y las
 * herramientas se ponen encima en sincronizarAgente.
 */
const CONFIG_BASE: Cfg = {
  conversation_config: {
    agent: { language: "es", prompt: { llm: "gemini-2.5-flash", temperature: 0.3 } },
    tts: { model_id: "eleven_flash_v2_5", voice_id: process.env.ELEVENLABS_VOZ || "ewn5JTa3lNPY8QVuZJi6", stability: 0.45, similarity_boost: 0.8, speed: 1.04, optimize_streaming_latency: 4, agent_output_audio_format: "pcm_16000" },
    asr: { quality: "high", provider: "scribe_realtime", user_input_audio_format: "pcm_16000" },
    turn: { mode: "turn" },
    conversation: { max_duration_seconds: 300 },
  },
};

/**
 * MANDAR LA CAMPAÑA A SU AGENTE. Cada campaña tiene su propio agente en ElevenLabs (su guion y su voz). Si todavía no
 * tiene, se crea copiando la configuración del agente con el que se probó en campo (ELEVENLABS_AGENTE_BASE o, si no,
 * ELEVENLABS_AGENTE_ENCUESTA): voz, modelo y tiempos de turno ya afinados. Si ya tiene, se parte de lo suyo y solo se
 * cambia lo de la campaña: el guion, la voz, la detección de buzón, end_call y el corte tras 15 s de silencio.
 *
 * La voz va en el agente (la primera de la campaña) y además se le permite cambiarla en cada llamada: con varias voces,
 * cada llamada sale con una al azar (ver vozParaLlamada en campanas.ts).
 */
export async function sincronizarAgente(c: CuestionarioActivo, { nombre = `${BRAND_NAME} · Encuesta · ${c.nombre}`.slice(0, 120) } = {}) {
  const llave = process.env.ELEVENLABS_API_KEY;
  if (!llave) return { ok: false as const, error: "Falta la llave de ElevenLabs." };
  if (esDemo(c)) return { ok: false as const, error: "Es un cuestionario de demostración: no se manda al agente." };
  const agenteId = c.agenteId ?? "";
  const origen = agenteId || process.env.ELEVENLABS_AGENTE_BASE || process.env.ELEVENLABS_AGENTE_ENCUESTA || "";
  const H = { "xi-api-key": llave, "Content-Type": "application/json" };
  let b: Cfg = CONFIG_BASE;
  if (origen) {
    const actual = await fetch(`${API}/${origen}`, { headers: H, cache: "no-store" });
    if (actual.ok) b = (await actual.json()) as Cfg;
    else if (agenteId) return { ok: false as const, error: `ElevenLabs contestó ${actual.status} al leer el agente de la campaña.` };
    // Si el agente de donde se copiaba ya no existe, se crea con la configuración probada en campo.
  }
  const { primerMensaje, prompt, datos } = armarAgente(c);
  const pb = b.conversation_config.agent.prompt;
  const herramientas = {
    end_call: { type: "system", name: "end_call", description: "Termina la llamada. Llámala en el mismo turno en que te despides, justo después de decir la despedida, sin esperar respuesta. Úsala cuando la encuesta acabó, cuando la persona no quiere participar o pide que no le llamen, o cuando contesta un buzón o una grabadora.", params: { system_tool_type: "end_call" } },
    // Sin detección de contestador, la herramienta se quita (null): la asistente ya no cuelga sola al oír un buzón.
    voicemail_detection: c.buzon
      ? { type: "system", name: "voicemail_detection", description: "Detecta si contestó un buzón de voz o una grabadora y cuelga sin dejar mensaje.", params: { system_tool_type: "voicemail_detection", voicemail_message: "" } }
      : null,
  };
  const voz = (await vocesUsables(c))[0];
  const cuerpo = {
    name: nombre,
    conversation_config: {
      ...b.conversation_config,
      turn: { ...(b.conversation_config.turn as Record<string, unknown>), ...TURNO, interruption_ignore_terms: palabrasSinInterrupcion(c), merge_with_default_ignore_terms: true },
      tts: { ...(b.conversation_config.tts ?? CONFIG_BASE.conversation_config.tts), ...(voz ? { voice_id: voz } : {}) },
      agent: { ...b.conversation_config.agent, first_message: primerMensaje, language: "es", prompt: { ...pb, prompt, built_in_tools: { ...(pb.built_in_tools as object), ...herramientas } } },
    },
    platform_settings: {
      data_collection: datos,
      overrides: { conversation_config_override: { tts: { voice_id: true } } },
    },
  };
  const r = agenteId
    ? await fetch(`${API}/${agenteId}`, { method: "PATCH", headers: H, body: JSON.stringify(cuerpo) })
    : await fetch(`${API}/create`, { method: "POST", headers: H, body: JSON.stringify(cuerpo) });
  const j = (await r.json().catch(() => ({}))) as { agent_id?: string; detail?: unknown };
  if (!r.ok) return { ok: false as const, error: `ElevenLabs no aceptó el guion (${r.status}): ${JSON.stringify(j.detail ?? j).slice(0, 200)}` };
  const nuevoId = agenteId || j.agent_id || "";
  await dbConnect();
  await EncuestaCuestionarioModel.updateOne({ _id: c.id }, { $set: { armado: ARMADO, ...(nuevoId && !agenteId ? { agenteId: nuevoId } : {}) } }).catch(() => null);
  return { ok: true as const, agenteId: nuevoId, creado: !agenteId };
}

/** Borrar el agente de una campaña que se elimina. Si falla no pasa nada: queda un agente sin usar en ElevenLabs. */
export async function borrarAgente(agenteId: string) {
  const llave = process.env.ELEVENLABS_API_KEY;
  if (!llave || !agenteId) return;
  await fetch(`${API}/${agenteId}`, { method: "DELETE", headers: { "xi-api-key": llave } }).catch(() => null);
}
