import { Schema, models, model, type InferSchemaType } from "mongoose";

const SocialAccountSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, ref: "Profile", required: true },
    platform: {
      type: String,
      enum: ["facebook", "instagram", "tiktok", "x", "linkedin", "other"],
      required: true,
    },
    username: { type: String, required: true },
    displayName: { type: String, default: "" },
    notes: { type: String, default: "" },
    status: {
      type: String,
      enum: ["active", "warming_up", "restricted", "banned", "unknown"],
      default: "unknown",
    },
  },
  { timestamps: true },
);

export type SocialAccount = InferSchemaType<typeof SocialAccountSchema>;

export default models.SocialAccount ?? model("SocialAccount", SocialAccountSchema);
