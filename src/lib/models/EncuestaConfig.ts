import { Schema, models, model } from "mongoose";

/**
 * Estado compartido de la encuesta telefónica, por clave: la tanda en curso, la
 * meta de contacto y el aviso de que las llamadas no están saliendo.
 *
 * `valor` es texto (JSON) a propósito: la tanda se aparta comparando el valor
 * completo (`updateOne({ _id, valor: leido })`), y así dos revisiones al mismo
 * tiempo no marcan a las mismas personas dos veces.
 */
const EncuestaConfigSchema = new Schema(
  {
    _id: { type: String, required: true },
    valor: { type: String, required: true },
  },
  { timestamps: true, collection: "encuestas_config" },
);

export default models.EncuestaConfig ?? model("EncuestaConfig", EncuestaConfigSchema);
