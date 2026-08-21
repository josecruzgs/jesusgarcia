import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import TaskModel from "@/lib/models/Task";
import { withAuth } from "@/lib/apiHandler";

// "Parar campañas": borra toda tarea que todavía no arrancó (pending/queued).
// Las que ya están "running" siguen hasta terminar (el worker ya las tomó,
// no hay forma limpia de interrumpirlas a medio Playwright) — esto solo
// vacía lo que falta por correr, que es lo que definimos como "la cola".
//
// Acotado al usuario: es un botón de pánico, y sin el filtro le vaciaba la
// cola a todos los demás de un clic.
export const POST = withAuth(async (user) => {
  await dbConnect();
  const result = await TaskModel.deleteMany({
    ownerId: user.objectId,
    status: { $in: ["pending", "queued"] },
  });
  return NextResponse.json({ deletedCount: result.deletedCount ?? 0 });
});
