import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import GroupModel from "@/lib/models/Group";
import { adsPower } from "@/lib/adspower/client";
import { withAdmin, withAuth } from "@/lib/apiHandler";
import { allowedGroupIdFilter } from "@/lib/auth/dal";
import { escapeRegex } from "@/lib/regex";

// Lee grupos desde Mongo (rápido, no depende de que AdsPower esté vivo).
// Usa POST /api/groups/sync para refrescar desde AdsPower.
//
// Por defecto pagina (20/página). Pasa `all=true` para traer la lista
// completa sin paginar (usada por selectores/dropdowns de grupo).
export const GET = withAuth(async (user, req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const search = sp.get("search")?.trim();
  const all = sp.get("all") === "true";
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize")) || 20));

  await dbConnect();

  const filter: Record<string, unknown> = allowedGroupIdFilter(user);
  if (search) filter.name = { $regex: escapeRegex(search), $options: "i" };

  if (all) {
    const groups = await GroupModel.find(filter).sort({ name: 1 });
    return NextResponse.json({ groups });
  }

  const [groups, total] = await Promise.all([
    GroupModel.find(filter)
      .sort({ name: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize),
    GroupModel.countDocuments(filter),
  ]);

  return NextResponse.json({ groups, total, page, pageSize });
});

// Solo admin: un grupo recién creado no está en la lista de permitidos de
// nadie, así que quien lo crea sin ser admin no podría ni verlo después.
export const POST = withAdmin(async (_user, req: NextRequest) => {
  const body = await req.json();
  if (!body.name) {
    return NextResponse.json({ error: "'name' es requerido" }, { status: 400 });
  }

  const { group_id } = await adsPower.createGroup(body.name, body.remark);

  await dbConnect();
  const group = await GroupModel.create({
    adsPowerGroupId: group_id,
    name: body.name,
    remark: body.remark ?? "",
  });

  return NextResponse.json({ group }, { status: 201 });
});
