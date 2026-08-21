import { Schema, models, model, type InferSchemaType } from "mongoose";

/**
 * Latido que cada worker actualiza en cada tick, para que la UI sepa si sigue
 * vivo sin tener acceso al proceso.
 *
 * El `_id` es el ROL, no un singleton: la automatización tiene que correr en
 * una máquina con AdsPower de escritorio y la escucha no, así que en un deploy
 * real son dos procesos en dos máquinas distintas. Con un solo documento, el
 * que corriera en el VPS haría parecer viva a una automatización apagada.
 */
export type WorkerRole = "tasks" | "listening";

const WorkerHeartbeatSchema = new Schema(
  {
    _id: { type: String, required: true },
    pollIntervalMs: { type: Number, required: true },
    /** Nombre de la máquina, para saber cuál de los dos procesos es. */
    host: { type: String },
  },
  { timestamps: true },
);

export type WorkerHeartbeat = InferSchemaType<typeof WorkerHeartbeatSchema>;

export default models.WorkerHeartbeat ?? model("WorkerHeartbeat", WorkerHeartbeatSchema);
