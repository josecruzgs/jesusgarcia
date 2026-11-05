import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { withAuth } from "@/lib/apiHandler";
import { ownerFilter } from "@/lib/auth/dal";
import { findUsableProfiles } from "@/lib/auth/profiles";
import { loginIfNeededSteps } from "@/lib/automation/loginSteps";
import { addTasksToCampaign, createCampaignWithTasks, readCampaignName } from "@/lib/campaigns";
import { grupoCanonico } from "@/lib/facebookGroups";
import GroupPostImageModel from "@/lib/models/GroupPostImage";

const MAX_TEXTO = 5000;

/**
 * Crea una tarea de "publicar en el grupo" por cada perfil elegido.
 *
 * Cada perfil se lleva un texto distinto de la lista: el mismo texto publicado
 * por varias cuentas en un mismo grupo es lo primero que Facebook (y los
 * admins) marcan como spam, así que se exige un texto por perfil en vez de
 * repetirlos. Las imágenes sí rotan: con menos imágenes que perfiles, se
 * reparten en orden.
 */
export const POST = withAuth(async (user, req: NextRequest) => {
  const body = await req.json();
  const url = grupoCanonico(typeof body.url === "string" ? body.url.trim() : "");
  const textos: string[] = (Array.isArray(body.textos) ? body.textos : [])
    .filter((t: unknown): t is string => typeof t === "string")
    .map((t: string) => t.trim())
    .filter(Boolean);
  const imageIds: string[] = (Array.isArray(body.imageIds) ? body.imageIds : []).filter(
    (id: unknown): id is string => typeof id === "string" && Types.ObjectId.isValid(id),
  );
  const profileIds: string[] = Array.isArray(body.profileIds) ? body.profileIds : [];

  if (!url) {
    return NextResponse.json(
      { error: "El link tiene que ser de un grupo de Facebook (https://www.facebook.com/groups/...)" },
      { status: 400 },
    );
  }
  if (profileIds.length === 0) {
    return NextResponse.json({ error: "Elige al menos un perfil" }, { status: 400 });
  }
  if (textos.some((t) => t.length > MAX_TEXTO)) {
    return NextResponse.json({ error: `Cada texto puede tener hasta ${MAX_TEXTO} caracteres` }, { status: 400 });
  }

  await dbConnect();

  const profiles = await findUsableProfiles(user, profileIds);
  if (!profiles.length) {
    return NextResponse.json({ error: "No se encontraron los perfiles seleccionados" }, { status: 404 });
  }
  if (textos.length < profiles.length) {
    return NextResponse.json(
      {
        error: `Hay ${textos.length} texto(s) para ${profiles.length} perfil(es). Hace falta uno distinto por perfil: el mismo texto repetido en un grupo se marca como spam.`,
      },
      { status: 400 },
    );
  }

  // Las imágenes tienen que ser del operador: sin esto, un id ajeno metido a
  // mano haría publicar la foto de otro.
  const propias = await GroupPostImageModel.find(
    { _id: { $in: imageIds }, ...ownerFilter(user) },
    { _id: 1 },
  ).lean<{ _id: Types.ObjectId }[]>();
  const validas = new Set(propias.map((i) => String(i._id)));
  const imagenes = imageIds.filter((id) => validas.has(id));
  if (imagenes.length !== imageIds.length) {
    return NextResponse.json({ error: "Alguna imagen ya no existe; vuelve a subirla" }, { status: 400 });
  }

  const staggerSeconds = Number(body.staggerSeconds) >= 0 ? Number(body.staggerSeconds) : 0;
  const autoRun = Boolean(body.autoRun);
  const namePrefix =
    typeof body.namePrefix === "string" && body.namePrefix.trim() ? body.namePrefix.trim() : "post grupo";
  const campaignName = readCampaignName(body, "grouppost", namePrefix);
  const now = Date.now();

  const docs = profiles.map((p, i) => ({
    name: `${namePrefix} · ${p.name}`,
    profileId: p._id,
    type: "grouppost" as const,
    steps: [
      { action: "goto" as const, url },
      { action: "waitForTimeout" as const, ms: 3000 },
      ...loginIfNeededSteps(),
      {
        action: "groupPost" as const,
        value: textos[i],
        ...(imagenes.length ? { imageId: imagenes[i % imagenes.length] } : {}),
      },
      { action: "waitForTimeout" as const, ms: 1500 },
    ],
    status: autoRun ? ("queued" as const) : ("pending" as const),
    scheduledAt: new Date(now + i * staggerSeconds * 1000),
  }));

  const campaignId = typeof body.campaignId === "string" ? body.campaignId.trim() : "";

  let campaign;
  let created;
  if (campaignId) {
    const result = await addTasksToCampaign({ ownerId: user.objectId, campaignId, type: "grouppost", docs });
    if (!result.ok) {
      return result.error === "not_found"
        ? NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 })
        : NextResponse.json(
            { error: `La campaña elegida es de tipo "${result.campaignType}", no de publicar en grupos` },
            { status: 400 },
          );
    }
    campaign = result.campaign;
    created = result.tasks;
  } else {
    const r = await createCampaignWithTasks({
      ownerId: user.objectId,
      name: campaignName,
      type: "grouppost",
      autoRun,
      docs,
    });
    campaign = r.campaign;
    created = r.tasks;
  }

  const tasks = created.map((t, i) => ({
    _id: t._id,
    name: t.name,
    status: t.status,
    scheduledAt: t.scheduledAt,
    profile: { _id: profiles[i]._id, name: profiles[i].name },
  }));

  return NextResponse.json(
    {
      campaign: {
        _id: campaign._id,
        name: campaign.name,
        type: campaign.type,
        status: autoRun ? "queued" : "pending",
        taskCount: campaign.taskCount ?? created.length,
      },
      tasks,
    },
    { status: 201 },
  );
});
