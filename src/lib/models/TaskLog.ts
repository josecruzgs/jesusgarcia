import { Schema, models, model, type InferSchemaType } from "mongoose";

const TaskLogSchema = new Schema(
  {
    taskId: { type: Schema.Types.ObjectId, ref: "Task", required: true },
    level: { type: String, enum: ["info", "warn", "error"], default: "info" },
    message: { type: String, required: true },
  },
  { timestamps: true },
);

TaskLogSchema.index({ taskId: 1, createdAt: 1 });

export type TaskLog = InferSchemaType<typeof TaskLogSchema>;

export default models.TaskLog ?? model("TaskLog", TaskLogSchema);
