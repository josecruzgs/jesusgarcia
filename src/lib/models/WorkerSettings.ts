import { Schema, models, model, type InferSchemaType } from "mongoose";
import { dropStaleModel } from "./staleModel";

/**
 * Lo que se le configura al worker desde la pantalla, no desde el deploy.
 *
 * El `_id` es el ROL, igual que en WorkerHeartbeat y por el mismo motivo: el
 * día que la escucha tenga algo que configurar no hay que inventar otra
 * colección. Hoy el único que existe es "tasks".
 *
 * Vive en Mongo y no en `WORKER_ENGINES` porque esa variable la lee el proceso
 * UNA vez, al arrancar: cambiarla obliga a entrar al VPS, editar el ecosystem y
 * reiniciar PM2 con `--update-env`. Eso es justo lo que este documento viene a
 * evitar. La variable no desaparece: queda como semilla para la primera vez,
 * cuando este documento todavía no existe.
 */
export const WORKER_SETTINGS_ID = "tasks";

const WorkerSettingsSchema = new Schema(
  {
    _id: { type: String, required: true },
    /** Motores que el worker tiene que mantener encendidos. Ver src/lib/motores.ts. */
    engines: { type: Number, required: true },
    /**
     * Quién lo tocó por última vez. Se guarda el nombre y no el ObjectId a
     * propósito: esto se lee para contárselo a un humano ("lo bajó a 2 fulano"),
     * y con el id habría que ir a buscar el usuario para poder mostrarlo.
     */
    updatedBy: { type: String },
  },
  { timestamps: true },
);

export type WorkerSettings = InferSchemaType<typeof WorkerSettingsSchema>;

dropStaleModel("WorkerSettings", ["engines", "updatedBy"]);

export default models.WorkerSettings ?? model("WorkerSettings", WorkerSettingsSchema);
