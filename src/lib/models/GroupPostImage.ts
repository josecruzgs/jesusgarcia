import { Schema, models, model, type InferSchemaType } from "mongoose";

/**
 * Una imagen subida para publicar en grupos.
 *
 * Vive en Mongo y no en el disco del servidor a propósito: la web la recibe y
 * el worker la usa, y los dos comparten la base pero no necesariamente la
 * carpeta — además un deploy que limpie el árbol de trabajo se llevaría las
 * imágenes de campañas que todavía no corrieron. Con el tope de 8 MB por
 * imagen entra holgada en un documento.
 */
const GroupPostImageSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true },
  },
  { timestamps: true },
);

export type GroupPostImage = InferSchemaType<typeof GroupPostImageSchema>;

export const GROUP_POST_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const GROUP_POST_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export default models.GroupPostImage ?? model("GroupPostImage", GroupPostImageSchema);
