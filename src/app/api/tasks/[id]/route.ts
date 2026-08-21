import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import TaskModel from "@/lib/models/Task";
import TaskLogModel from "@/lib/models/TaskLog";
// Registra el schema de "Profile" para que TaskModel.populate("profileId")
// no truene con "Schema hasn't been registered" en un lambda frío que nunca
// cargó /api/profiles antes.
import "@/lib/models/Profile";
import { withAuth } from "@/lib/apiHandler";

export const GET = withAuth(
  async (user, _req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    await dbConnect();
    const task = await TaskModel.findOne({ _id: id, ownerId: user.objectId }).populate(
      "profileId",
      "name adsPowerProfileId",
    );
    if (!task) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

    // Los logs no llevan ownerId: cuelgan de la tarea, que ya se validó.
    const logs = await TaskLogModel.find({ taskId: id }).sort({ createdAt: 1 });
    return NextResponse.json({ task, logs });
  },
);

export const DELETE = withAuth(
  async (user, _req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    await dbConnect();

    // El borrado de logs va atado a que la tarea fuera realmente de este
    // usuario: sin el chequeo, un id ajeno igual se llevaba puestos sus logs.
    const deleted = await TaskModel.findOneAndDelete({ _id: id, ownerId: user.objectId });
    if (!deleted) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

    await TaskLogModel.deleteMany({ taskId: id });
    return NextResponse.json({ ok: true });
  },
);
