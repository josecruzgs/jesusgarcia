import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import GroupModel from "@/lib/models/Group";
import { adsPower } from "@/lib/adspower/client";
import { withAdmin } from "@/lib/apiHandler";

// Trae los grupos desde AdsPower y sincroniza (upsert) en Mongo.
//
// Solo admin: escribe la tabla que comparten todos los usuarios y es la que
// decide qué grupos existen para asignar permisos.
export const POST = withAdmin(async () => {
  await dbConnect();
  const list = await adsPower.listAllGroups();

  for (const g of list) {
    await GroupModel.updateOne(
      { adsPowerGroupId: g.group_id },
      { $set: { name: g.group_name, remark: g.remark ?? "" } },
      { upsert: true },
    );
  }

  const groups = await GroupModel.find().sort({ name: 1 });
  return NextResponse.json({ groups });
});
