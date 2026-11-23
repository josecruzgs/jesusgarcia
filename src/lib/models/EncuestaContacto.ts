import { Schema, models, model } from "mongoose";

/**
 * La base de teléfonos a la que llama la asistente.
 *
 * Nada personal va en claro (ver src/lib/encuestas/cifrado.ts):
 * - `telefono` NO es el número: es su huella («h1:…»). Se quedó con ese nombre para conservar el índice único que ya
 *   existía en producción; es lo que evita duplicados y liga cada llamada con su contacto.
 * - `telCifrado`, `idCifrado`, `municipioCifrado`, `distritoCifrado`, `seccionCifrada` y `otroCifrado` son lo que se
 *   subió (las columnas de la base: ID, Teléfono, Municipio, Distrito, Sección electoral y Otro), cifrado. Solo se descifra para marcar y para enseñárselo a quien lo subió.
 * - `nombreCifrado` y `coloniaCifrada` son de las bases de antes, que traían nombre y colonia: ya no se piden ni se
 *   enseñan, y solo existen para que esos datos viejos no queden en claro.
 * - `telFin` son los últimos 4 dígitos, lo único que ven los demás.
 * - `subidoPor` es el usuario dueño de esos datos. Sin dueño (lo que se cargó antes de cifrar, o quien pidió no ser
 *   llamado sin venir de ninguna base) es base compartida y la ve quien opera Encuestas.
 *
 * Estados: PENDIENTE, EN_CURSO, COMPLETA, RECHAZO, COLGO, NO_CONTESTO, BUZON,
 * NUMERO_MALO, NO_LLAMAR. Quien pidió que no le llamen queda como NO_LLAMAR
 * para siempre, aunque su número no viniera de la base.
 */
const EncuestaContactoSchema = new Schema(
  {
    telefono: { type: String, required: true },
    telCifrado: { type: String, default: null },
    telFin: { type: String, default: null },
    /** El ID con el que el cliente identifica a la persona en su propia base. */
    idCifrado: { type: String, default: null },
    municipioCifrado: { type: String, default: null },
    distritoCifrado: { type: String, default: null },
    seccionCifrada: { type: String, default: null },
    /** «Otro»: cualquier dato que el cliente necesite y que no tenga columna propia. Se guarda tal cual. */
    otroCifrado: { type: String, default: null },
    nombreCifrado: { type: String, default: null },
    coloniaCifrada: { type: String, default: null },
    subidoPor: { type: Schema.Types.ObjectId, ref: "User", default: null },
    /** De qué archivo salió. También se cifra: el nombre del archivo puede decir de quién es la base. */
    origenCifrado: { type: String, default: null },
    estado: { type: String, default: "PENDIENTE" },
    intentos: { type: Number, default: 0 },
    ultimoIntento: { type: Date, default: null },
    /** La llamada en la que sí contestó todo. */
    llamadaId: { type: Schema.Types.ObjectId, ref: "EncuestaLlamada", default: null },
  },
  { timestamps: true, collection: "encuestas_contactos" },
);

EncuestaContactoSchema.index({ telefono: 1 }, { unique: true });
EncuestaContactoSchema.index({ estado: 1, intentos: 1, ultimoIntento: 1 });
EncuestaContactoSchema.index({ createdAt: -1 });
EncuestaContactoSchema.index({ subidoPor: 1, createdAt: -1 });

export default models.EncuestaContacto ?? model("EncuestaContacto", EncuestaContactoSchema);
