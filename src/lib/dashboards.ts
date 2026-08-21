import crypto from "crypto";
import { Types } from "mongoose";
import CampaignModel from "@/lib/models/Campaign";
import { HttpError } from "@/lib/apiHandler";
import type { SessionUser } from "@/lib/auth/dal";

export function generateShareToken() {
  return crypto.randomBytes(9).toString("base64url");
}

/**
 * Deja pasar solo las campañas del usuario.
 *
 * Un dashboard se publica en internet sin contraseña, así que meter en él la
 * campaña de otro sería filtrarla: es el único lugar donde un id ajeno en el
 * cuerpo del request tendría consecuencias fuera del panel.
 */
export async function assertOwnedCampaigns(user: SessionUser, campaignIds: string[]) {
  const requested = [...new Set(campaignIds.map(String))].filter((id) => Types.ObjectId.isValid(id));
  if (requested.length === 0) return [];

  const owned = await CampaignModel.find({ _id: { $in: requested }, ownerId: user.objectId })
    .select("_id")
    .lean();

  if (owned.length !== requested.length) {
    throw new HttpError(403, "Alguna de las campañas elegidas no existe o no es tuya");
  }

  return owned.map((campaign) => campaign._id);
}
