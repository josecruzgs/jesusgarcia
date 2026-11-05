import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { withAuth } from "@/lib/apiHandler";
import GroupPostImageModel, {
  GROUP_POST_IMAGE_MAX_BYTES,
  GROUP_POST_IMAGE_TYPES,
} from "@/lib/models/GroupPostImage";

/**
 * Sube una imagen para la campaña de publicar en grupos. Una por pedido: el
 * proxy de Next amortigua el cuerpo hasta 10 MB y una tanda de fotos de
 * celular juntas pasaría de largo, cortada en silencio.
 */
export const POST = withAuth(async (user, req: NextRequest) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });
  }
  if (!GROUP_POST_IMAGE_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Solo se aceptan imágenes JPG, PNG, WEBP o GIF" }, { status: 400 });
  }
  if (file.size > GROUP_POST_IMAGE_MAX_BYTES) {
    return NextResponse.json({ error: "La imagen pasa de 8 MB" }, { status: 413 });
  }

  await dbConnect();
  const doc = await GroupPostImageModel.create({
    ownerId: user.objectId,
    name: file.name.slice(0, 200) || "imagen",
    mimeType: file.type,
    size: file.size,
    data: Buffer.from(await file.arrayBuffer()),
  });

  return NextResponse.json({ image: { _id: doc._id, name: doc.name, size: doc.size } }, { status: 201 });
});
