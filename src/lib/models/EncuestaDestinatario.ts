import { Schema, models, model } from "mongoose";

/**
 * A QUIÉN LE LLAMA CADA CAMPAÑA. El contacto (EncuestaContacto) es la base de teléfonos de cada usuario, cifrada y con
 * dueño; el destinatario es ese contacto dentro de una campaña, con cómo le ha ido en ESA campaña. Así un mismo número
 * puede estar en varias campañas: contestar una no lo saca de las otras.
 *
 * `huella` es la del teléfono (la misma que `EncuestaContacto.telefono`): sirve para lo que vale en todas las campañas
 * a la vez, como apartar a quien pidió que no le llamen o un número que la línea no puede marcar.
 *
 * Estados: PENDIENTE, EN_CURSO, COMPLETA, RECHAZO, COLGO, NO_CONTESTO, BUZON, NUMERO_MALO, NO_LLAMAR.
 */
const EncuestaDestinatarioSchema = new Schema(
  {
    campanaId: { type: Schema.Types.ObjectId, ref: "EncuestaCuestionario", required: true },
    contactoId: { type: Schema.Types.ObjectId, ref: "EncuestaContacto", required: true },
    huella: { type: String, required: true },
    estado: { type: String, default: "PENDIENTE" },
    intentos: { type: Number, default: 0 },
    ultimoIntento: { type: Date, default: null },
    /** La llamada en la que contestó todo. */
    llamadaId: { type: Schema.Types.ObjectId, ref: "EncuestaLlamada", default: null },
    agregadoPor: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, collection: "encuestas_destinatarios" },
);

EncuestaDestinatarioSchema.index({ campanaId: 1, contactoId: 1 }, { unique: true });
EncuestaDestinatarioSchema.index({ campanaId: 1, estado: 1, intentos: 1, ultimoIntento: 1 });
EncuestaDestinatarioSchema.index({ huella: 1 });

export default models.EncuestaDestinatario ?? model("EncuestaDestinatario", EncuestaDestinatarioSchema);
