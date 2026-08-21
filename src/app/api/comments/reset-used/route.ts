import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import CommentModel from "@/lib/models/Comment";
import { withAuth } from "@/lib/apiHandler";

// Vuelve a marcar el banco propio como disponible. Útil si quieres reciclar
// la misma lista de comentarios en otra ronda.
export const POST = withAuth(async (user) => {
  await dbConnect();
  const mine = { ownerId: user.objectId };
  await CommentModel.updateMany(mine, { $set: { used: false }, $unset: { usedAt: "", usedByTaskId: "" } });
  const total = await CommentModel.countDocuments(mine);
  return NextResponse.json({ total, available: total });
});
