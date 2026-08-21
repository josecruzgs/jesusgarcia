import { Schema, models, model, type InferSchemaType } from "mongoose";
import { dropStaleModel } from "./staleModel";

export const PLAY_KINDS = ["comment", "like"] as const;
export const PLAY_STATUSES = ["suggested", "approved", "dispatched", "discarded"] as const;
export const PLAY_PRIORITIES = ["alta", "media", "baja"] as const;

/**
 * Foto de la publicación sobre la que se actúa, copiada al proponer la jugada.
 *
 * Se duplica en vez de resolverse por `mentionId` porque las menciones se
 * borran —la purga de descartadas se lleva miles de una— y una jugada ya
 * despachada tiene que seguir siendo legible: sin esto, el historial de "qué
 * hicimos y sobre qué" quedaría lleno de filas vacías.
 */
const TargetSchema = new Schema(
  {
    url: { type: String, required: true },
    platform: { type: String },
    domain: { type: String },
    title: { type: String },
    excerpt: { type: String },
    author: { type: String },
    entity: { type: String },
    publishedAt: { type: Date },
    sentiment: { type: String },
    sentimentScore: { type: Number },
    engagement: { type: Number, default: 0 },
    reach: { type: Number, default: 0 },
  },
  { _id: false },
);

/**
 * Una jugada recomendada: qué hacer sobre una publicación que la escucha ya
 * encontró, para mover el sentimiento hacia la figura.
 *
 * Es el puente entre Viento y Agua. Viento detecta la publicación y propone la
 * acción; al aprobarla se crea una campaña de Agua igual a cualquier otra —las
 * mismas tareas, el mismo runner, el mismo worker— así que no hay una segunda
 * forma de ejecutar automatizaciones que mantener.
 */
const ActionPlaySchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: "ListeningProject", required: true },
    // Sí lleva dueño propio, a diferencia de menciones y briefs: al despachar
    // hay que crear una campaña, y las campañas se filtran por ownerId.
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    mentionId: { type: Schema.Types.ObjectId, ref: "Mention" },

    target: { type: TargetSchema, required: true },

    kind: { type: String, enum: PLAY_KINDS, required: true },
    // Solo para "like". El picker de reacciones es exclusivo de Facebook, así
    // que fuera de ahí cualquier valor distinto de "like" se ignora.
    reaction: { type: String, default: "like" },

    /** Qué hacer, en una línea. Es el título de la tarjeta. */
    headline: { type: String, required: true },
    /** Por qué conviene, anclado en lo que dice la mención. */
    rationale: { type: String, required: true },
    /** Del vocabulario cerrado de iconos del brief (ver analyze.ts). */
    icon: { type: String, default: "alerta" },
    priority: { type: String, enum: PLAY_PRIORITIES, default: "media" },

    /**
     * Cuántos perfiles debería usar la campaña.
     *
     * En las jugadas de tipo "comment" NO es libre: siempre vale lo mismo que
     * `comments.length`, porque va un texto por cuenta. Repetir un comentario
     * en la misma publicación es la huella que delata una operación, así que
     * en vez de avisarlo se hace imposible — la generación, la edición y el
     * despacho sostienen los tres la misma igualdad.
     */
    suggestedCount: { type: Number, default: 5 },

    /**
     * Textos propuestos para los comentarios, uno por cuenta. Van acá y no en
     * el banco global de /api/comments a propósito: un comentario que responde
     * a una nota puntual no sirve para otra publicación, y el banco es
     * justamente de textos reusables.
     */
    comments: { type: [String], default: [] },

    status: { type: String, enum: PLAY_STATUSES, default: "suggested" },

    // Lo que quedó de haberla ejecutado.
    campaignId: { type: Schema.Types.ObjectId, ref: "Campaign" },
    taskCount: { type: Number, default: 0 },
    dispatchedAt: { type: Date },
  },
  { timestamps: true },
);

ActionPlaySchema.index({ projectId: 1, status: 1, createdAt: -1 });
// Una jugada viva por mención: sin esto, cada corrida del generador volvería a
// proponer lo mismo sobre las publicaciones que ya tienen una pendiente.
ActionPlaySchema.index({ projectId: 1, mentionId: 1 });

export type ActionPlay = InferSchemaType<typeof ActionPlaySchema>;

dropStaleModel("ActionPlay", ["target", "kind", "comments"]);

export default models.ActionPlay ?? model("ActionPlay", ActionPlaySchema);
