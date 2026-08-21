import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import PostModel from "@/lib/models/Post";
import { withAuth } from "@/lib/apiHandler";

// Vuelve a marcar el banco propio como disponible. Útil si quieres reciclar
// la misma lista de publicaciones en otra ronda.
export const POST = withAuth(async (user) => {
  await dbConnect();
  const mine = { ownerId: user.objectId };
  await PostModel.updateMany(mine, { $set: { used: false }, $unset: { usedAt: "", usedByTaskId: "" } });
  const total = await PostModel.countDocuments(mine);
  return NextResponse.json({ total, available: total });
});
