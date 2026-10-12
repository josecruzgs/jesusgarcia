import mongoose, { Schema, models, model, type InferSchemaType } from "mongoose";
import { TASK_TYPES } from "./Task";

const CampaignSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true },
    type: {
      type: String,
      enum: TASK_TYPES,
      default: "custom",
    },
    autoRun: { type: Boolean, default: false },
    taskCount: { type: Number, default: 0 },
    // Por qué el runner frenó la campaña solo, cuando seguir corriéndola sería
    // en vano (p. ej. el perfil a seguir no admite seguidores). Se muestra en
    // /campanas y se borra al relanzar.
    stopReason: { type: String },
  },
  { timestamps: true },
);

// Los índices llevan ownerId adelante: toda consulta del panel arranca
// filtrando por dueño, así que sin él quedarían inservibles.
CampaignSchema.index({ ownerId: 1, createdAt: -1 });
CampaignSchema.index({ ownerId: 1, type: 1, createdAt: -1 });

export type Campaign = InferSchemaType<typeof CampaignSchema>;

// Mismo motivo que en Task: el dev server cachea el modelo compilado y un
// schema previo al tipo "likecomment" —o previo a ownerId— lo rechazaría al
// crear la campaña.
const cachedCampaignSchema = models.Campaign?.schema;
const cachedTypes = (cachedCampaignSchema?.path("type") as { enumValues?: string[] } | undefined)?.enumValues;
if (
  models.Campaign &&
  (!cachedTypes?.includes("likecomment") ||
    !cachedTypes?.includes("ramificacion") ||
    !cachedTypes?.includes("joingroup") ||
    !cachedTypes?.includes("follow") ||
    !cachedCampaignSchema?.path("ownerId") ||
    !cachedCampaignSchema?.path("stopReason"))
) {
  mongoose.deleteModel("Campaign");
}

export default models.Campaign ?? model("Campaign", CampaignSchema);
