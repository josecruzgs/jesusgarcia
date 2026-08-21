import GroupModel from "@/lib/models/Group";

/**
 * Deja pasar solo los group_id que existan de verdad en la tabla de grupos.
 *
 * Los permisos se guardan como ids sueltos de AdsPower, sin referencia que
 * Mongo pueda validar: sin este filtro, un id mal tipeado se guardaría igual y
 * quedaría como un permiso fantasma, imposible de distinguir de uno real.
 */
export async function knownGroupIds(candidates: unknown): Promise<string[]> {
  if (!Array.isArray(candidates)) return [];

  const wanted = [...new Set(candidates.filter((id): id is string => typeof id === "string"))];
  if (wanted.length === 0) return [];

  const groups = await GroupModel.find({ adsPowerGroupId: { $in: wanted } })
    .select("adsPowerGroupId")
    .lean();

  return groups.map((group) => group.adsPowerGroupId as string);
}
