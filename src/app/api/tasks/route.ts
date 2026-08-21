import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import TaskModel from "@/lib/models/Task";
// Registra el schema de "Profile" para que TaskModel.populate("profileId")
// no truene con "Schema hasn't been registered" en un lambda frío que nunca
// cargó /api/profiles antes.
import "@/lib/models/Profile";
import { withAuth } from "@/lib/apiHandler";
import { findUsableProfile } from "@/lib/auth/profiles";
import { escapeRegex } from "@/lib/regex";

export const GET = withAuth(async (user, req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") ?? undefined;
  const type = sp.get("type") ?? undefined;
  const profileId = sp.get("profileId") ?? undefined;
  const search = sp.get("search")?.trim();
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize")) || 20));

  await dbConnect();

  const filter: Record<string, unknown> = { ownerId: user.objectId };
  if (status) filter.status = status;
  if (type) filter.type = type;
  if (profileId) filter.profileId = profileId;
  if (search) filter.name = { $regex: escapeRegex(search), $options: "i" };

  const [tasks, total] = await Promise.all([
    TaskModel.find(filter)
      .populate("profileId", "name adsPowerProfileId")
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize),
    TaskModel.countDocuments(filter),
  ]);

  return NextResponse.json({ tasks, total, page, pageSize });
});

export const POST = withAuth(async (user, req: NextRequest) => {
  const body = await req.json();
  if (!body.name || !body.profileId) {
    return NextResponse.json({ error: "'name' y 'profileId' son requeridos" }, { status: 400 });
  }

  await dbConnect();
  // Corta con 404 si el perfil no existe o cae fuera de los grupos permitidos.
  const profile = await findUsableProfile(user, String(body.profileId));

  const task = await TaskModel.create({
    ownerId: user.objectId,
    name: body.name,
    profileId: profile._id,
    type: body.type ?? "custom",
    steps: body.steps ?? [],
    status: "pending",
    scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : new Date(),
  });

  return NextResponse.json({ task }, { status: 201 });
});
