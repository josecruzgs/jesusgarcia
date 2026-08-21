import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import PostModel from "@/lib/models/Post";
import { withAuth } from "@/lib/apiHandler";
import { findUsableProfiles } from "@/lib/auth/profiles";
import { loginIfNeededSteps } from "@/lib/automation/loginSteps";
import { addTasksToCampaign, createCampaignWithTasks, readCampaignName } from "@/lib/campaigns";

// Crea una tarea de "post" por cada perfil elegido: cada una toma un texto
// distinto y sin usar del banco (/api/posts) y lo marca como usado, así
// ninguna otra campaña vuelve a repetirlo (cada perfil publica en su propio
// timeline, así que a diferencia de los comentarios no hay riesgo de que se
// vea el mismo texto repetido en un solo lugar — igual se reparte distinto
// por perfil para no dejar un patrón obvio).
export const POST = withAuth(async (user, req: NextRequest) => {
  const body = await req.json();
  const homeUrl = typeof body.homeUrl === "string" ? body.homeUrl.trim() : "";
  const openSelector = typeof body.openSelector === "string" ? body.openSelector.trim() : "";
  const dismissSelectors = typeof body.dismissSelectors === "string" ? body.dismissSelectors.trim() : "";
  const textSelector = typeof body.textSelector === "string" ? body.textSelector.trim() : "";
  const submitSelector = typeof body.submitSelector === "string" ? body.submitSelector.trim() : "";
  const profileIds: string[] = Array.isArray(body.profileIds) ? body.profileIds : [];

  if (!homeUrl || !textSelector || !submitSelector || profileIds.length === 0) {
    return NextResponse.json(
      { error: "'homeUrl', 'textSelector', 'submitSelector' y al menos un perfil en 'profileIds' son requeridos" },
      { status: 400 },
    );
  }

  await dbConnect();

  const profiles = await findUsableProfiles(user, profileIds);
  if (!profiles.length) {
    return NextResponse.json({ error: "No se encontraron los perfiles seleccionados" }, { status: 404 });
  }

  // Reserva N publicaciones sin usar (una por perfil) antes de crear nada:
  // si no alcanza, no se crea ninguna tarea a medias.
  const pool = await PostModel.find({ ownerId: user.objectId, used: false })
    .sort({ createdAt: 1 })
    .limit(profiles.length);
  if (pool.length < profiles.length) {
    return NextResponse.json(
      {
        error: `Solo hay ${pool.length} publicación(es) disponibles en el banco para ${profiles.length} perfil(es) elegidos. Importa más publicaciones o elige menos perfiles.`,
      },
      { status: 409 },
    );
  }

  const waitMs = Number(body.waitMs) > 0 ? Number(body.waitMs) : 3000;
  const staggerSeconds = Number(body.staggerSeconds) >= 0 ? Number(body.staggerSeconds) : 0;
  const autoRun = Boolean(body.autoRun);
  const namePrefix =
    typeof body.namePrefix === "string" && body.namePrefix.trim() ? body.namePrefix.trim() : "post";
  const campaignName = readCampaignName(body, "post", namePrefix);
  const now = Date.now();

  const claimedIds = pool.map((c) => c._id);

  const openSteps = openSelector
    ? [
        { action: "waitForSelector" as const, selector: openSelector, ms: 15000 },
        { action: "click" as const, selector: openSelector },
        { action: "waitForTimeout" as const, ms: 1500 },
      ]
    : [];

  // Algunas plataformas muestran un interstitial de "una sola vez" (ej.
  // Facebook pide confirmar la audiencia de futuras publicaciones) que solo
  // aparece hasta que la cuenta lo confirma una vez — por eso estos clics
  // son "optional": si el diálogo no está, se saltan sin romper la tarea.
  const dismissSteps = dismissSelectors
    .split("||")
    .map((s: string) => s.trim())
    .filter(Boolean)
    .flatMap((selector: string) => [
      { action: "click" as const, selector, ms: 5000, optional: true },
      { action: "waitForTimeout" as const, ms: 1500 },
    ]);

  const docs = profiles.map((p, i) => ({
    name: `${namePrefix} · ${p.name}`,
    profileId: p._id,
    type: "post" as const,
    steps: [
      { action: "goto" as const, url: homeUrl },
      { action: "waitForTimeout" as const, ms: waitMs },
      ...loginIfNeededSteps(),
      ...openSteps,
      ...dismissSteps,
      { action: "waitForSelector" as const, selector: textSelector, ms: 15000 },
      { action: "click" as const, selector: textSelector },
      { action: "type" as const, selector: textSelector, value: pool[i].text },
      { action: "waitForTimeout" as const, ms: 800 },
      { action: "click" as const, selector: submitSelector },
      { action: "waitForTimeout" as const, ms: 2000 },
    ],
    status: autoRun ? ("queued" as const) : ("pending" as const),
    scheduledAt: new Date(now + i * staggerSeconds * 1000),
  }));

  const campaignId = typeof body.campaignId === "string" ? body.campaignId.trim() : "";

  // Solo se marcan usadas las publicaciones una vez que las tareas ya
  // existen: si insertMany falla, el banco queda intacto para reintentar.
  let campaign;
  let created;
  if (campaignId) {
    const result = await addTasksToCampaign({ ownerId: user.objectId, campaignId, type: "post", docs });
    if (!result.ok) {
      return result.error === "not_found"
        ? NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 })
        : NextResponse.json(
            { error: `La campaña elegida es de tipo "${result.campaignType}", no "post"` },
            { status: 400 },
          );
    }
    campaign = result.campaign;
    created = result.tasks;
  } else {
    const r = await createCampaignWithTasks({
      ownerId: user.objectId,
      name: campaignName,
      type: "post",
      autoRun,
      docs,
    });
    campaign = r.campaign;
    created = r.tasks;
  }

  await Promise.all(
    created.map((t, i) =>
      PostModel.updateOne(
        { _id: claimedIds[i] },
        { $set: { used: true, usedAt: new Date(), usedByTaskId: t._id } },
      ),
    ),
  );

  const tasks = created.map((t, i) => ({
    _id: t._id,
    name: t.name,
    status: t.status,
    content: pool[i].text,
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
