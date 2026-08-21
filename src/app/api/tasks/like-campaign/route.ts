import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { withAuth } from "@/lib/apiHandler";
import { findUsableProfiles } from "@/lib/auth/profiles";
import { loginIfNeededSteps } from "@/lib/automation/loginSteps";
import { addTasksToCampaign, createCampaignWithTasks, readCampaignName } from "@/lib/campaigns";

// Crea una tarea de "like" por cada perfil elegido: todas comparten el
// mismo link y selector del botón de like, y se pueden espaciar en el
// tiempo (staggerSeconds) para que el worker no las dispare todas juntas.
export const POST = withAuth(async (user, req: NextRequest) => {
  const body = await req.json();
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const selector = typeof body.selector === "string" ? body.selector.trim() : "";
  // "like" (default) hace un solo clic en el botón, igual que siempre. Cualquier
  // otra reacción necesita primero un "hover" para que Facebook revele el picker
  // (Me encanta/Me importa/etc.) y recién ahí clickear la reacción específica —
  // reactionSelector viene del preset de plataforma en el frontend.
  const reaction = typeof body.reaction === "string" && body.reaction.trim() ? body.reaction.trim() : "like";
  const reactionSelector = typeof body.reactionSelector === "string" ? body.reactionSelector.trim() : "";
  const profileIds: string[] = Array.isArray(body.profileIds) ? body.profileIds : [];

  if (!url || !selector || profileIds.length === 0) {
    return NextResponse.json(
      { error: "'url', 'selector' y al menos un perfil en 'profileIds' son requeridos" },
      { status: 400 },
    );
  }
  if (reaction !== "like" && !reactionSelector) {
    return NextResponse.json(
      { error: "'reactionSelector' es requerido cuando 'reaction' no es 'like'" },
      { status: 400 },
    );
  }

  await dbConnect();

  const profiles = await findUsableProfiles(user, profileIds);
  if (!profiles.length) {
    return NextResponse.json({ error: "No se encontraron los perfiles seleccionados" }, { status: 404 });
  }

  const waitMs = Number(body.waitMs) > 0 ? Number(body.waitMs) : 3000;
  const staggerSeconds = Number(body.staggerSeconds) >= 0 ? Number(body.staggerSeconds) : 0;
  const autoRun = Boolean(body.autoRun);
  const namePrefix =
    typeof body.namePrefix === "string" && body.namePrefix.trim() ? body.namePrefix.trim() : "like";
  const campaignName = readCampaignName(body, "like", namePrefix);
  const now = Date.now();

  const reactionSteps =
    reaction === "like"
      ? [{ action: "click" as const, selector }]
      : [
          { action: "hover" as const, selector, ms: 15000 },
          { action: "waitForTimeout" as const, ms: 800 },
          { action: "waitForSelector" as const, selector: reactionSelector, ms: 5000 },
          { action: "click" as const, selector: reactionSelector },
        ];

  const docs = profiles.map((p, i) => ({
    name: `${namePrefix} · ${p.name}`,
    profileId: p._id,
    type: "like" as const,
    steps: [
      { action: "goto" as const, url },
      { action: "waitForTimeout" as const, ms: waitMs },
      ...loginIfNeededSteps(),
      { action: "waitForSelector" as const, selector, ms: 15000 },
      ...reactionSteps,
      { action: "waitForTimeout" as const, ms: 1500 },
    ],
    status: autoRun ? ("queued" as const) : ("pending" as const),
    scheduledAt: new Date(now + i * staggerSeconds * 1000),
  }));

  const campaignId = typeof body.campaignId === "string" ? body.campaignId.trim() : "";

  let campaign;
  let created;
  if (campaignId) {
    const result = await addTasksToCampaign({ ownerId: user.objectId, campaignId, type: "like", docs });
    if (!result.ok) {
      return result.error === "not_found"
        ? NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 })
        : NextResponse.json(
            { error: `La campaña elegida es de tipo "${result.campaignType}", no "like"` },
            { status: 400 },
          );
    }
    campaign = result.campaign;
    created = result.tasks;
  } else {
    const r = await createCampaignWithTasks({
      ownerId: user.objectId,
      name: campaignName,
      type: "like",
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
