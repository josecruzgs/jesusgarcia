import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import GroupModel from "@/lib/models/Group";
import UserModel from "@/lib/models/User";
import { adsPower } from "@/lib/adspower/client";
import { withAdmin } from "@/lib/apiHandler";

// Trae los grupos desde AdsPower y sincroniza en Mongo: upsert de lo que
// devuelve y borrado de lo que ya no.
//
// Solo admin: escribe la tabla que comparten todos los usuarios y es la que
// decide qué grupos existen para asignar permisos.
//
// La cuenta con la que AdsPower tiene la sesión abierta es la fuente de
// verdad. Ojo con la consecuencia: si esa sesión se cambia por una que ve
// menos grupos (una subcuenta de operador, por ejemplo), los grupos que esa
// cuenta no alcanza desaparecen de acá. No es un accidente, es la decisión de
// diseño — pero implica que el alcance del panel queda atado a qué cuenta está
// logueada en el escritorio del servidor.
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

  // Una lista vacía no borra nada. AdsPower contesta con `code: 0` y cero
  // grupos tanto cuando la cuenta de verdad no tiene ninguno como cuando la
  // sesión del escritorio se cayó, y el segundo caso vaciaría la tabla entera
  // —con los permisos de todos los operadores apuntando a la nada— por un
  // problema pasajero. Sin grupos que sincronizar no hay nada que decidir.
  let removed = 0;
  let affectedUsers = 0;
  if (list.length > 0) {
    const currentIds = list.map((g) => g.group_id);

    // Se avisa a quién le pega antes de borrar; el nombre del grupo ya no se
    // puede reconstruir después.
    const stale = await GroupModel.find({ adsPowerGroupId: { $nin: currentIds } })
      .select("adsPowerGroupId")
      .lean<{ adsPowerGroupId: string }[]>();
    const staleIds = stale.map((g) => g.adsPowerGroupId);

    if (staleIds.length > 0) {
      // Los `groupIds` de los usuarios se dejan intactos a propósito. Son
      // configuración escrita a mano, no un reflejo de AdsPower: si se
      // podaran, volver a la cuenta que sí ve todo devolvería los grupos pero
      // no a quién tenía acceso a cuáles, y eso hay que rehacerlo de memoria.
      // Un id que no matchea ningún grupo simplemente no muestra nada, y
      // vuelve a funcionar solo cuando el grupo reaparece.
      affectedUsers = await UserModel.countDocuments({ groupIds: { $in: staleIds } });
      ({ deletedCount: removed } = await GroupModel.deleteMany({ adsPowerGroupId: { $in: staleIds } }));
    }
  }

  const groups = await GroupModel.find().sort({ name: 1 });
  return NextResponse.json({ groups, removed, affectedUsers });
});
