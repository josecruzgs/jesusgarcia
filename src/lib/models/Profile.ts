import { Schema, models, model, type InferSchemaType } from "mongoose";

const ProfileSchema = new Schema(
  {
    adsPowerProfileId: { type: String, required: true, unique: true }, // AdsPower "user_id"
    name: { type: String, required: true },
    groupId: { type: String, default: "" }, // AdsPower group_id
    platform: { type: String, default: "" }, // e.g. facebook, instagram, tiktok, x
    remark: { type: String, default: "" },
    // Parseados desde "remark" (ver src/lib/remark.ts) para poder filtrar por
    // rango de edad y género sin tener que re-parsear texto libre en cada
    // query.
    age: { type: Number },
    gender: { type: String, enum: ["hombre", "mujer"] },
    lastStatus: {
      type: String,
      enum: ["unknown", "active", "inactive"],
      default: "unknown",
    },
    lastOpenedAt: { type: Date },
    // Etiquetas puestas a mano en AdsPower (perfil > etiquetas) — se
    // sincronizan tal cual desde ahí, no se editan desde esta app.
    tags: {
      type: [{ name: { type: String, required: true }, color: { type: String, default: "" } }],
      default: [],
    },
  },
  { timestamps: true },
);

export type Profile = InferSchemaType<typeof ProfileSchema>;

export default models.Profile ?? model("Profile", ProfileSchema);
