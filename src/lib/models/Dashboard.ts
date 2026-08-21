import { Schema, models, model, type InferSchemaType } from "mongoose";
import { dropStaleModel } from "./staleModel";

const DashboardSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true },
    token: { type: String, required: true, unique: true },
    campaignIds: [{ type: Schema.Types.ObjectId, ref: "Campaign" }],
  },
  { timestamps: true },
);

DashboardSchema.index({ ownerId: 1, createdAt: -1 });

export type Dashboard = InferSchemaType<typeof DashboardSchema>;

dropStaleModel("Dashboard", ["ownerId"]);

export default models.Dashboard ?? model("Dashboard", DashboardSchema);
