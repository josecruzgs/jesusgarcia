import mongoose, { Schema, models, model, type InferSchemaType } from "mongoose";

// Un "step" es una acción atómica de Playwright que el runner interpreta.
// Ver src/lib/automation/runner.ts para la lista de acciones soportadas.
const StepSchema = new Schema(
  {
    action: {
      type: String,
      enum: [
        "goto",
        "click",
        "hover",
        "fill",
        "type",
        "press",
        "waitForSelector",
        "waitForTimeout",
        "screenshot",
        "scroll",
        "uploadFile",
        "likeComment",
        "captureComment",
        "replyComment",
      ],
      required: true,
    },
    selector: { type: String },
    value: { type: String },
    url: { type: String },
    key: { type: String },
    ms: { type: Number },
    optional: { type: Boolean },
    // Solo para "likeComment": el id del comentario a reaccionar (sale del
    // `comment_id`/`reply_comment_id` del link) y, cuando la reacción no es
    // "me gusta", el selector de la reacción dentro del picker de Facebook.
    commentId: { type: String },
    reactionSelector: { type: String },
    // Ramificaciones: el commentId (y la url del goto) salen del comentario que
    // publicó la tarea padre, que al crear la campaña todavía no existe.
    fromParent: { type: Boolean },
  },
  { _id: false },
);

export const TASK_TYPES = [
  "login",
  "post",
  "warmup",
  "scrape",
  "like",
  "likecomment",
  "comment",
  "ramificacion",
  "custom",
] as const;

const TaskSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true },
    campaignId: { type: Schema.Types.ObjectId, ref: "Campaign" },
    // Ramificaciones: la tarea que publica el comentario padre. Los hijos
    // nacen en "pending" y solo pasan a la cola cuando el padre termina bien —
    // antes de eso no tienen a qué comentario apuntar. Ver runTask.
    parentTaskId: { type: Schema.Types.ObjectId, ref: "Task", index: true },
    profileId: { type: Schema.Types.ObjectId, ref: "Profile", required: true },
    type: {
      type: String,
      enum: TASK_TYPES,
      default: "custom",
    },
    steps: { type: [StepSchema], default: [] },
    status: {
      type: String,
      enum: ["pending", "queued", "running", "success", "failed", "cancelled", "paused"],
      default: "pending",
    },
    // Solo se usa mientras status === "paused": guarda a qué estado volver
    // al reanudar (una tarea "pending" no debe reanudar directo a "queued").
    resumeStatus: { type: String, enum: ["pending", "queued"] },
    scheduledAt: { type: Date, default: () => new Date() },
    startedAt: { type: Date },
    finishedAt: { type: Date },
    error: { type: String },
    // Permalink de lo que la tarea produjo, cuando se pudo capturar: para las
    // de comentario es el link al comentario publicado. Lo llena el step
    // "captureComment" (ver runner.ts) y sirve para ir a comprobarlo sin
    // tener que buscarlo a mano dentro del post.
    resultUrl: { type: String },
    // El perfil de Facebook del que comentó, sacado del enlace del nombre
    // dentro del propio comentario. Va aparte de resultUrl porque son dos
    // destinos distintos y los dos sirven: uno para leer el comentario, otro
    // para ver la cuenta que lo puso.
    resultProfileUrl: { type: String },
  },
  { timestamps: true },
);

// Este índice NO lleva ownerId adelante a propósito: lo usa el worker, que
// toma de la cola sin importar de quién sea la tarea (src/worker/index.ts).
TaskSchema.index({ status: 1, scheduledAt: 1 });
TaskSchema.index({ campaignId: 1, status: 1 });
// Cuántas tareas lleva cada perfil: lo pregunta el selector de candidatos en
// cada campaña nueva, para poner arriba a los menos usados (ver
// src/app/api/profiles/route.ts).
TaskSchema.index({ profileId: 1 });
// Y este es el del panel, que sí arranca siempre por dueño.
TaskSchema.index({ ownerId: 1, status: 1, scheduledAt: 1 });

export type Task = InferSchemaType<typeof TaskSchema>;

// El modelo compilado se cachea entre recargas del dev server, así que un
// schema viejo sobrevive a los cambios de este archivo y rechaza los valores
// nuevos. Se descarta cuando le falta algo que esta versión sí tiene.
function isStaleTaskModel() {
  const schema = models.Task?.schema;
  if (!schema) return false;
  if (!schema.path("campaignId")) return true;
  if (!schema.path("ownerId")) return true;
  if (!schema.path("resultUrl")) return true;
  if (!schema.path("resultProfileUrl")) return true;
  if (!schema.path("parentTaskId")) return true;
  const types = (schema.path("type") as { enumValues?: string[] }).enumValues ?? [];
  return !types.includes("likecomment") || !types.includes("ramificacion");
}

if (isStaleTaskModel()) {
  mongoose.deleteModel("Task");
}

export default models.Task ?? model("Task", TaskSchema);
