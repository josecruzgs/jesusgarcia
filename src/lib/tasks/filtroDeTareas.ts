import { visibleOwnerFilter } from "@/lib/auth/dal";
import type { SessionUser } from "@/lib/auth/dal";
import { escapeRegex } from "@/lib/regex";

/** Los filtros de la tabla de /tasks, tal como los manda la interfaz. */
export type FiltrosDeTareas = {
  status?: string | null;
  type?: string | null;
  profileId?: string | null;
  search?: string | null;
};

/**
 * El filtro de Mongo para los filtros de la tabla, ya acotado a lo que el
 * usuario puede ver.
 *
 * Lo comparten el listado y las acciones masivas. "Seleccionar todas las que
 * coinciden" tiene que afectar exactamente a las filas que la tabla está
 * contando; con dos copias del filtro, la primera diferencia entre ellas
 * borraría tareas que el usuario nunca vio.
 */
export function filtroDeTareas(user: SessionUser, f: FiltrosDeTareas): Record<string, unknown> {
  // El mismo alcance que el listado y los botones de cada fila.
  const filter: Record<string, unknown> = { ...visibleOwnerFilter(user) };
  if (f.status) filter.status = f.status;
  if (f.type) filter.type = f.type;
  if (f.profileId) filter.profileId = f.profileId;
  const search = f.search?.trim();
  if (search) filter.name = { $regex: escapeRegex(search), $options: "i" };
  return filter;
}
