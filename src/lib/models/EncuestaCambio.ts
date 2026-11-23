import { Schema, models, model } from "mongoose";

/** Quién cambió el guion, cuándo y qué: cambiar una pregunta a media encuesta cambia lo que se mide. */
const EncuestaCambioSchema = new Schema(
  {
    cuestionarioId: { type: Schema.Types.ObjectId, ref: "EncuestaCuestionario", required: true },
    version: { type: Number, required: true },
    usuarioId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    nombre: { type: String, default: null },
    fecha: { type: Date, default: () => new Date() },
    /** Qué cambió, en palabras. */
    resumen: { type: String, required: true },
    /** El guion completo como quedó (JSON). */
    guion: { type: String, required: true },
  },
  { collection: "encuestas_cambios" },
);

EncuestaCambioSchema.index({ cuestionarioId: 1, fecha: -1 });

export default models.EncuestaCambio ?? model("EncuestaCambio", EncuestaCambioSchema);
