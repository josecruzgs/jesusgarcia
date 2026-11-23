import { Schema, models, model } from "mongoose";

/**
 * UNA CAMPAÑA DE ENCUESTA TELEFÓNICA: su guion (lo que dice la asistente, palabra por palabra, y las preguntas con sus
 * opciones) y sus parámetros (voz, horario, reintentos, a quién llama). Cada campaña tiene sus destinatarios
 * (EncuestaDestinatario), su agente de voz en ElevenLabs y sus resultados: las llamadas le apuntan por `cuestionarioId`.
 *
 * Se quedó en la colección y el modelo de «cuestionario» a propósito: antes había un solo cuestionario activo, y así las
 * llamadas, el historial de cambios y las respuestas que ya existían siguen apuntando a donde apuntaban.
 *
 * Las preguntas viven adentro y no en su propia colección: siempre se leen y se guardan juntas, y cada una conserva su
 * `_id`, que es lo que las respuestas de cada llamada usan para apuntarle.
 */
const PreguntaSchema = new Schema({
  /** El nombre del campo que extrae el agente de voz para esta pregunta (p. ej. «gobierno»). */
  clave: { type: String, required: true },
  texto: { type: String, required: true },
  /** Cómo se rotula en el tablero. */
  corto: { type: String, default: null },
  tipo: { type: String, default: "OPCION_UNICA" },
  /** Las respuestas posibles, en el orden en que se leen. */
  opciones: { type: [String], default: [] },
  /** Respuestas que se registran pero no se dicen en voz alta («No sabe»). */
  noSeLeen: { type: [String], default: [] },
  /** Indicaciones extra para la asistente en esta pregunta, una por renglón. */
  reglas: { type: String, default: null },
  orden: { type: Number, default: 0 },
});

const EncuestaCuestionarioSchema = new Schema(
  {
    nombre: { type: String, required: true },
    saludo: { type: String, required: true },
    cierre: { type: String, default: null },
    municipio: { type: String, default: null },
    /** De antes de las campañas: el único cuestionario que se levantaba. Ya no decide nada. */
    activo: { type: Boolean, default: true },
    /** JSON: lo que contesta la asistente en cada situación (no quiere participar, quién habla…). */
    frases: { type: String, default: null },
    /** Sube cada vez que alguien cambia el guion: cada llamada guarda con qué versión se hizo. */
    version: { type: Number, default: 1 },
    preguntas: { type: [PreguntaSchema], default: [] },
    /** Marca del cuestionario sembrado la primera vez. Única para que dos pantallas a la vez no creen dos. */
    semilla: { type: String, default: undefined },

    // ── La campaña ────────────────────────────────────────────────────────────────────────────────────────────────
    /** BORRADOR, CORRIENDO, PAUSADA o TERMINADA. Sin estado = de antes de las campañas (se migra al leer). */
    estado: { type: String, default: undefined },
    /** El agente de ElevenLabs de esta campaña: cada una tiene su guion y su voz. */
    agenteId: { type: String, default: null },
    creadoPor: { type: Schema.Types.ObjectId, ref: "User", default: null },
    /** Voz: género (F o M) y una o varias voces de ElevenLabs. Con varias, cada llamada sale con una al azar. */
    voz: {
      genero: { type: String, default: "F" },
      voces: { type: [String], default: [] },
    },
    /** Cuándo se puede llamar, en hora de Baja California: de `desde` a `hasta` (0-24) y los días (1 = lunes … 7 = domingo). */
    horario: {
      desde: { type: Number, default: 9 },
      hasta: { type: Number, default: 20 },
      dias: { type: [Number], default: [1, 2, 3, 4, 5, 6, 7] },
    },
    /** Intentos por persona (1 = sin reintentos) y minutos de espera entre uno y otro. */
    reintentos: {
      intentos: { type: Number, default: 3 },
      esperaMin: { type: Number, default: 120 },
    },
    /** Se termina al hablar con este porcentaje de los destinatarios (0 = sin meta: hasta acabar la lista). */
    meta: { type: Number, default: 0 },
    /** Cuántas llamadas a la vez puede tener esta campaña (0 = las líneas libres que haya). */
    lineas: { type: Number, default: 0 },
    /** Máximo de llamadas reales de la campaña, el equivalente al «coste límite» (0 = sin tope). */
    tope: { type: Number, default: 0 },
    /** Detección de contestador: si cae en buzón, cuelga sin dejar mensaje. */
    buzon: { type: Boolean, default: true },
    etiquetas: { type: [String], default: [] },
    iniciada: { type: Date, default: null },
    terminada: { type: Date, default: null },
    /** Por qué se detuvo o terminó sola («meta alcanzada», «sin más a quién llamar», «tope», «pago pendiente»…). */
    motivo: { type: String, default: null },
    /** La última vez que el motor marcó por esta campaña: se reparten las líneas empezando por la que lleva más tiempo esperando. */
    ultimaVuelta: { type: Date, default: null },
    /** Con qué versión del armado del guion (ARMADO en guion.ts) se actualizó por última vez su asistente en ElevenLabs. */
    armado: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "encuestas_cuestionarios" },
);

EncuestaCuestionarioSchema.index({ semilla: 1 }, { unique: true, sparse: true });
EncuestaCuestionarioSchema.index({ activo: 1, createdAt: -1 });
EncuestaCuestionarioSchema.index({ estado: 1, ultimaVuelta: 1 });

export default models.EncuestaCuestionario ?? model("EncuestaCuestionario", EncuestaCuestionarioSchema);
