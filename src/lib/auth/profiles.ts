import { Types } from "mongoose";
import ProfileModel from "@/lib/models/Profile";
import { HttpError } from "@/lib/apiHandler";
import { allowedGroupFilter, canUseGroup, type SessionUser } from "./dal";

/**
 * Carga los perfiles pedidos, recortados a los grupos que el usuario tiene
 * permitidos, y falla si alguno quedó afuera.
 *
 * Es el punto por el que pasan las rutas que crean campañas: el selector de la
 * interfaz ya muestra solo los perfiles permitidos, pero `profileIds` viaja en
 * el cuerpo del POST y cualquiera puede escribirlo a mano.
 *
 * Un id inexistente y uno prohibido dan el mismo error a propósito: distinguir
 * los casos confirmaría qué perfiles existen en grupos ajenos.
 */
export async function findUsableProfiles(user: SessionUser, profileIds: string[]) {
  const requested = [...new Set(profileIds.map(String))].filter((id) => Types.ObjectId.isValid(id));

  const profiles = await ProfileModel.find({
    _id: { $in: requested },
    ...allowedGroupFilter(user),
  }).sort({ name: 1 });

  if (profiles.length !== requested.length) {
    throw new HttpError(403, "Algunos de los perfiles seleccionados no existen o no están a tu alcance");
  }

  return profiles;
}

/** Igual, para un solo perfil. Lanza 404 si no existe o cae fuera del alcance. */
export async function findUsableProfile(user: SessionUser, profileId: string) {
  if (!Types.ObjectId.isValid(profileId)) {
    throw new HttpError(404, "Perfil no encontrado");
  }

  const profile = await ProfileModel.findOne({ _id: profileId, ...allowedGroupFilter(user) });
  if (!profile) throw new HttpError(404, "Perfil no encontrado");

  return profile;
}

/** Valida un group_id de AdsPower recibido por parámetro o en el cuerpo. */
export function assertGroupAllowed(user: SessionUser, groupId: string | undefined | null) {
  if (!canUseGroup(user, groupId)) {
    throw new HttpError(403, "No tenés acceso a ese grupo");
  }
}
