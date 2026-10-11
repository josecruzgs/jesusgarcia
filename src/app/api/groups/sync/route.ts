import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import GroupModel from "@/lib/models/Group";
import UserModel from "@/lib/models/User";
import { adsPower } from "@/lib/adspower/client";
import { withAdmin } from "@/lib/apiHandler";

// Trae los grupos desde AdsPower, sincroniza (upsert) en Mongo y borra los que
// AdsPower ya no tiene.
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

  // AdsPower es la fuente de verdad: un grupo que ya no devuelve se borró allá
  // y se borra acá, igual que hace la sincronización de perfiles. Si la
  // consulta falla, listAllGroups lanza antes de llegar acá, así que una lista
  // a medias no puede borrar de más. La lista vacía sí se trata con cuidado:
  // es más probable que AdsPower esté respondiendo raro que el que se hayan
  // borrado todos los grupos de golpe.
  let removed = 0;
  if (list.length > 0) {
    const currentIds = list.map((g) => g.group_id);
    const stale = await GroupModel.find({ adsPowerGroupId: { $nin: currentIds } }, { adsPowerGroupId: 1 }).lean();
    const staleIds = stale.map((g) => g.adsPowerGroupId);
    if (staleIds.length > 0) {
      ({ deletedCount: removed } = await GroupModel.deleteMany({ adsPowerGroupId: { $in: staleIds } }));
      // Sin esto los operadores seguirían teniendo permiso sobre un id que ya
      // no existe, y en /usuarios contaría como un grupo asignado.
      await UserModel.updateMany({ groupIds: { $in: staleIds } }, { $pull: { groupIds: { $in: staleIds } } });
    }
  }

  const groups = await GroupModel.find().sort({ name: 1 });
  return NextResponse.json({ groups, removed });
});
