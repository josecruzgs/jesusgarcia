import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import TaskModel from "@/lib/models/Task";
import { withAuth } from "@/lib/apiHandler";

// Encola la tarea para que el worker (src/worker/index.ts) la recoja y
// ejecute. No corremos Playwright directamente en la request de Next.js
// porque una automatización puede tardar mucho más que el timeout de un
// API route.
export const POST = withAuth(
  async (user, _req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    await dbConnect();

    const task = await TaskModel.findOne({ _id: id, ownerId: user.objectId });
    if (!task) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

    task.status = "queued";
    task.error = undefined;
    await task.save();

    return NextResponse.json({ task });
  },
);
