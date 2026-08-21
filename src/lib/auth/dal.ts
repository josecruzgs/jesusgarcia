import { cache } from "react";
import { cookies } from "next/headers";
import { Types } from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import UserModel, { EMPTY_PREFERENCES, type Preferences, type UserRole } from "@/lib/models/User";
import { SESSION_COOKIE, readSessionToken } from "./session";

// Capa de acceso a datos, según recomienda la guía de autenticación de Next:
// proxy.ts solo hace el chequeo optimista para redirigir al login, y la
// autorización de verdad se resuelve acá, lo más cerca posible de los datos.

export type SessionUser = {
  id: string;
  objectId: Types.ObjectId;
  username: string;
  role: UserRole;
  /** group_id de AdsPower permitidos. Vacío para el admin, que los ve todos. */
  groupIds: string[];
  /** Apariencia y hora local. Nunca null: sin nada elegido va todo vacío. */
  preferences: Preferences;
};

type UserRow = {
  _id: Types.ObjectId;
  username: string;
  role: UserRole;
  groupIds?: string[];
  active?: boolean;
  preferences?: Partial<Preferences>;
};

/**
 * Usuario de la request, o null si no hay sesión válida.
 *
 * Memoizado con `cache` de React: dentro de una misma request se puede llamar
 * las veces que haga falta sin repetir la consulta a Mongo.
 *
 * Se relee el usuario en cada request a propósito, en vez de confiar en lo que
 * diga la cookie: así quitarle un grupo o darlo de baja surte efecto de
 * inmediato y no cuando le venza la sesión treinta días después.
 */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token);
  if (!session) return null;

  if (!Types.ObjectId.isValid(session.userId)) return null;

  await dbConnect();
  const user = (await UserModel.findById(session.userId)
    .select("username role groupIds active preferences")
    .lean()) as UserRow | null;

  if (!user || user.active === false) return null;

  return {
    id: String(user._id),
    objectId: user._id,
    username: user.username,
    role: user.role,
    groupIds: user.groupIds ?? [],
    preferences: { ...EMPTY_PREFERENCES, ...(user.preferences ?? {}) },
  };
});

export function isAdmin(user: SessionUser): boolean {
  return user.role === "admin";
}

/**
 * Filtro de Mongo que recorta una colección con campo `groupId` a los grupos
 * permitidos. Para el admin no filtra nada; para un operador sin grupos
 * asignados no matchea nada, que es lo correcto.
 */
export function allowedGroupFilter(user: SessionUser): Record<string, unknown> {
  if (isAdmin(user)) return {};
  return { groupId: { $in: user.groupIds } };
}

/**
 * Lo mismo, para la colección Group, donde el id de AdsPower vive en
 * `adsPowerGroupId` en vez de en `groupId`.
 */
export function allowedGroupIdFilter(user: SessionUser): Record<string, unknown> {
  if (isAdmin(user)) return {};
  return { adsPowerGroupId: { $in: user.groupIds } };
}

export function canUseGroup(user: SessionUser, groupId: string | undefined | null): boolean {
  if (isAdmin(user)) return true;
  if (!groupId) return false;
  return user.groupIds.includes(groupId);
}

/** Filtro de propiedad para las colecciones con `ownerId`. */
export function ownerFilter(user: SessionUser): { ownerId: Types.ObjectId } {
  return { ownerId: user.objectId };
}
