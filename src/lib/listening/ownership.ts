import { Types } from "mongoose";
import ListeningProjectModel from "@/lib/models/ListeningProject";
import { HttpError } from "@/lib/apiHandler";
import type { SessionUser } from "@/lib/auth/dal";

/**
 * Confirma que el proyecto de escucha es del usuario, y devuelve su id.
 *
 * Las menciones y los briefs no llevan dueño propio: cuelgan del proyecto. Por
 * eso toda ruta que reciba un `projectId` tiene que pasar por acá antes de leer
 * o escribir nada — es el único punto donde se decide el alcance de la escucha.
 */
export async function assertOwnedProject(user: SessionUser, projectId: string) {
  if (!Types.ObjectId.isValid(projectId)) {
    throw new HttpError(404, "Proyecto no encontrado");
  }

  const project = await ListeningProjectModel.findOne({ _id: projectId, ownerId: user.objectId })
    .select("_id")
    .lean();

  if (!project) throw new HttpError(404, "Proyecto no encontrado");

  return project._id;
}
