import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import ProfileModel from "@/lib/models/Profile";
import { adsPower } from "@/lib/adspower/client";
import { withAuth } from "@/lib/apiHandler";
import { allowedGroupFilter } from "@/lib/auth/dal";
import { assertGroupAllowed } from "@/lib/auth/profiles";
import { escapeRegex } from "@/lib/regex";
import { parseRemark } from "@/lib/remark";

// Lee perfiles desde Mongo (rápido, no depende de que AdsPower esté vivo).
// Usa POST /api/profiles/sync para refrescar desde AdsPower.
//
// Por defecto pagina (20/página). Pasa `all=true` para traer la lista
// completa sin paginar (usado por selectores de candidatos que necesitan
// filtrar en el cliente, ej. las campañas de likes/comentarios).
export const GET = withAuth(async (user, req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const groupId = sp.get("groupId") ?? undefined;
  const platform = sp.get("platform") ?? undefined;
  const lastStatus = sp.get("lastStatus") ?? undefined;
  const search = sp.get("search")?.trim();
  const gender = sp.get("gender") ?? undefined;
  const tag = sp.get("tag") ?? undefined;
  const ageMin = sp.get("ageMin") ? Number(sp.get("ageMin")) : undefined;
  const ageMax = sp.get("ageMax") ? Number(sp.get("ageMax")) : undefined;
  const all = sp.get("all") === "true";
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize")) || 20));

  await dbConnect();

  // El filtro de permisos va primero; un `groupId` pedido por query lo pisa
  // solo si el usuario tiene ese grupo, porque se valida antes de aplicarlo.
  const filter: Record<string, unknown> = allowedGroupFilter(user);
  if (groupId) {
    assertGroupAllowed(user, groupId);
    filter.groupId = groupId;
  }
  if (platform) filter.platform = platform;
  if (lastStatus) filter.lastStatus = lastStatus;
  if (search) filter.name = { $regex: escapeRegex(search), $options: "i" };
  if (gender) filter.gender = gender;
  if (tag) filter["tags.name"] = tag;
  if (ageMin !== undefined || ageMax !== undefined) {
    filter.age = {};
    if (ageMin !== undefined) (filter.age as Record<string, number>).$gte = ageMin;
    if (ageMax !== undefined) (filter.age as Record<string, number>).$lte = ageMax;
  }

  if (all) {
    const profiles = await ProfileModel.find(filter).sort({ name: 1 });
    return NextResponse.json({ profiles });
  }

  const [profiles, total] = await Promise.all([
    ProfileModel.find(filter)
      .sort({ name: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize),
    ProfileModel.countDocuments(filter),
  ]);

  return NextResponse.json({ profiles, total, page, pageSize });
});

export const POST = withAuth(async (user, req: NextRequest) => {
  const body = await req.json();
  if (!body.name || !body.groupId) {
    return NextResponse.json({ error: "'name' y 'groupId' son requeridos" }, { status: 400 });
  }
  assertGroupAllowed(user, String(body.groupId));

  const { id } = await adsPower.createProfile({
    name: body.name,
    groupId: body.groupId,
    remark: body.remark,
    proxyConfig: body.proxyConfig,
    fingerprintConfig: body.fingerprintConfig,
  });

  await dbConnect();
  const remark = body.remark ?? "";
  const { age, gender } = parseRemark(remark);
  const profile = await ProfileModel.create({
    adsPowerProfileId: id,
    name: body.name,
    groupId: body.groupId,
    platform: body.platform ?? "",
    remark,
    age,
    gender,
  });

  return NextResponse.json({ profile }, { status: 201 });
});
