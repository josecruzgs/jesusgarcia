import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import PostModel from "@/lib/models/Post";
import { withAuth } from "@/lib/apiHandler";

export const DELETE = withAuth(
  async (user, _req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    await dbConnect();
    const deleted = await PostModel.findOneAndDelete({ _id: id, ownerId: user.objectId });
    if (!deleted) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    return NextResponse.json({ ok: true });
  },
);
