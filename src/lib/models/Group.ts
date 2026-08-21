import { Schema, models, model, type InferSchemaType } from "mongoose";

const GroupSchema = new Schema(
  {
    adsPowerGroupId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    remark: { type: String, default: "" },
  },
  { timestamps: true },
);

export type Group = InferSchemaType<typeof GroupSchema>;

export default models.Group ?? model("Group", GroupSchema);
