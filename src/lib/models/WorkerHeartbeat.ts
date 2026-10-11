import { Schema, models, model, type InferSchemaType } from "mongoose";
import { dropStaleModel } from "./staleModel";

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
    /**
     * Cuántos motores tiene VIVOS este worker ahora mismo (solo el rol "tasks").
     *
     * Lo informa el proceso y no una constante compartida porque el número lo
     * decide Ajustes y el worker lo relee en caliente: si la sala lo tuviera
     * hardcodeado, subir la capacidad dejaría la pantalla mintiendo.
     */
    engines: { type: Number },
    /**
     * A cuántos APUNTA, que durante una bajada no es lo mismo que `engines`.
     *
     * Apagar un motor no interrumpe la tarea que tiene adentro: el bucle sale
     * recién cuando termina. Sin este campo, bajar de 3 a 2 con los tres
     * ocupados dejaba a la sala diciendo "3 activos" sin ninguna explicación, y
     * parecía que el cambio no se había guardado.
     */
    enginesTarget: { type: Number },
    /**
     * QUÉ motores están vivos, no solo cuántos.
     *
     * Durante una bajada los vivos pueden no ser los primeros: si el 2 estaba
     * libre y el 3 tenía una tarea, el 2 se apaga enseguida y quedan el 1 y el
     * 3. Con un conteo, la sala daba por encendidos al 1 y al 2 y pintaba la
     * tarea del 3 en una ranura con candado.
     */
    engineIds: { type: [Number] },
  },
  { timestamps: true },
);

export type WorkerHeartbeat = InferSchemaType<typeof WorkerHeartbeatSchema>;

// Mismo motivo que en Task: el modelo compilado sobrevive a las recargas del
// dev server, así que un schema sin `engines` seguiría descartando el campo.
dropStaleModel("WorkerHeartbeat", ["engines", "enginesTarget", "engineIds"]);

export default models.WorkerHeartbeat ?? model("WorkerHeartbeat", WorkerHeartbeatSchema);
