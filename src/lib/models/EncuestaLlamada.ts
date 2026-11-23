import { Schema, models, model } from "mongoose";

/**
 * Una llamada de la encuesta telefónica, desde que sale y no solo cuando sale
 * bien: las que no contestaron o colgaron valen tanto como las completas, sin
 * ellas no se sabe cuántos intentos cuesta una encuesta.
 *
 * Estados: EN_CURSO, COMPLETA, RECHAZO, NO_CONTESTO, BUZON, COLGO, NUMERO_MALO,
 * NO_SALIO. Las de prueba se guardan igual pero nunca se mezclan con los
 * resultados.
 */
const RespuestaSchema = new Schema(
  {
    /** `_id` de la pregunta dentro del cuestionario. */
    preguntaId: { type: Schema.Types.ObjectId, required: true },
    valor: { type: String, required: true },
  },
  { _id: false },
);

const EncuestaLlamadaSchema = new Schema(
  {
    cuestionarioId: { type: Schema.Types.ObjectId, ref: "EncuestaCuestionario", required: true },
    /**
     * El número en claro, SOLO en las de prueba (son los celulares del propio equipo). Las de verdad guardan su huella y
     * los últimos 4 dígitos: una opinión ligada a un número es un dato personal (ver src/lib/encuestas/cifrado.ts).
     */
    telefono: { type: String, default: null },
    huella: { type: String, default: null },
    telFin: { type: String, default: null },
    estado: { type: String, default: "EN_CURSO" },
    prueba: { type: Boolean, default: false },
    canal: { type: String, default: "AGENTE_IA" },
    contactoId: { type: Schema.Types.ObjectId, ref: "EncuestaContacto", default: null },
    /** La plática en ElevenLabs: traerla dos veces no la duplica. */
    externoId: { type: String, default: undefined },
    transcripcion: { type: String, default: null },
    /** Quién la mandó desde el panel (usuario del panel). */
    operadorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    inicio: { type: Date, default: () => new Date() },
    fin: { type: Date, default: null },
    segundos: { type: Number, default: null },
    notas: { type: String, default: null },
    /** Con qué versión del guion se hizo. */
    versionGuion: { type: Number, default: null },
    respuestas: { type: [RespuestaSchema], default: [] },
  },
  { timestamps: true, collection: "encuestas_llamadas" },
);

EncuestaLlamadaSchema.index({ externoId: 1 }, { unique: true, sparse: true });
EncuestaLlamadaSchema.index({ cuestionarioId: 1, estado: 1 });
EncuestaLlamadaSchema.index({ inicio: -1 });
EncuestaLlamadaSchema.index({ prueba: 1, inicio: -1 });
EncuestaLlamadaSchema.index({ telefono: 1, inicio: -1 });
EncuestaLlamadaSchema.index({ huella: 1, inicio: -1 });

export default models.EncuestaLlamada ?? model("EncuestaLlamada", EncuestaLlamadaSchema);
