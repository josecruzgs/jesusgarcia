import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { withAuth } from "@/lib/apiHandler";
import { findUsableProfiles } from "@/lib/auth/profiles";
import { loginIfNeededSteps } from "@/lib/automation/loginSteps";
import { addTasksToCampaign, createCampaignWithTasks, readCampaignName } from "@/lib/campaigns";
import { canonicalizeFacebookProfileUrl } from "@/lib/facebookProfileUrl";
import TaskModel from "@/lib/models/Task";

export const POST = withAuth(async (user, req: NextRequest) => {
  const body = await req.json();
  const url = canonicalizeFacebookProfileUrl(typeof body.url === "string" ? body.url.trim() : "");
  const profileIds: string[] = Array.isArray(body.profileIds) ? body.profileIds : [];

  if (!url) {
    return NextResponse.json(
      { error: "El link tiene que ser de un perfil de Facebook (facebook.com/nombre o profile.php?id=...)" },
      { status: 400 },
    );
  }
  if (profileIds.length === 0) {
    return NextResponse.json({ error: "Elige al menos un perfil" }, { status: 400 });
  }

  await dbConnect();

  const profiles = await findUsableProfiles(user, profileIds);
  if (!profiles.length) {
    return NextResponse.json({ error: "No se encontraron los perfiles seleccionados" }, { status: 404 });
  }

  const previas = await TaskModel.find(
    {
      type: "follow",
      profileId: { $in: profiles.map((profile) => profile._id) },
      status: { $in: ["pending", "queued", "running", "paused", "success"] },
      "steps.url": url,
    },
    { profileId: 1 },
  ).lean<{ profileId: unknown }[]>();
  const yaEnviados = new Set(previas.map((task) => String(task.profileId)));
  const aEnviar = profiles.filter((profile) => !yaEnviados.has(String(profile._id)));
  const omitidos = profiles
    .filter((profile) => yaEnviados.has(String(profile._id)))
    .map((profile) => ({ _id: profile._id, name: profile.name }));

  if (!aEnviar.length) {
    return NextResponse.json(
      { error: "Todos los perfiles elegidos ya tienen una tarea de seguimiento a esta cuenta (hecha o en curso)", omitidos },
      { status: 409 },
    );
  }

  const staggerSeconds = Number(body.staggerSeconds) >= 0 ? Number(body.staggerSeconds) : 0;
  const autoRun = Boolean(body.autoRun);
  const namePrefix =
    typeof body.namePrefix === "string" && body.namePrefix.trim() ? body.namePrefix.trim() : "follow";
  const campaignName = readCampaignName(body, "follow", namePrefix);
  const now = Date.now();
  const docs = aEnviar.map((profile, index) => ({
    name: `${namePrefix} · ${profile.name}`,
    profileId: profile._id,
    type: "follow" as const,
    steps: [
      { action: "goto" as const, url },
      { action: "waitForTimeout" as const, ms: 3000 },
      ...loginIfNeededSteps(),
      { action: "followProfile" as const },
      { action: "waitForTimeout" as const, ms: 1500 },
    ],
    status: autoRun ? ("queued" as const) : ("pending" as const),
    scheduledAt: new Date(now + index * staggerSeconds * 1000),
  }));

  const campaignId = typeof body.campaignId === "string" ? body.campaignId.trim() : "";
  let campaign;
  let created;
  if (campaignId) {
    const result = await addTasksToCampaign({ ownerId: user.objectId, campaignId, type: "follow", docs });
    if (!result.ok) {
      return result.error === "not_found"
        ? NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 })
        : NextResponse.json(
            { error: `La campaña elegida es de tipo "${result.campaignType}", no de seguir perfiles` },
            { status: 400 },
          );
    }
    campaign = result.campaign;
    created = result.tasks;
  } else {
    const result = await createCampaignWithTasks({
      ownerId: user.objectId,
      name: campaignName,
      type: "follow",
      autoRun,
      docs,
    });
    campaign = result.campaign;
    created = result.tasks;
  }

  const tasks = created.map((task, index) => ({
    _id: task._id,
    name: task.name,
    status: task.status,
    scheduledAt: task.scheduledAt,
    profile: { _id: aEnviar[index]._id, name: aEnviar[index].name },
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
      omitidos,
    },
    { status: 201 },
  );
});
