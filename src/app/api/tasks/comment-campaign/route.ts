import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import CommentModel from "@/lib/models/Comment";
import { withAuth } from "@/lib/apiHandler";
import { findUsableProfiles } from "@/lib/auth/profiles";
import { loginIfNeededSteps } from "@/lib/automation/loginSteps";
import { addTasksToCampaign, createCampaignWithTasks, readCampaignName } from "@/lib/campaigns";

// Crea una tarea de "comment" por cada perfil elegido: cada una toma un
// comentario distinto y sin usar del banco (/api/comments) y lo marca como
// usado, así ninguna otra campaña vuelve a repetirlo.
export const POST = withAuth(async (user, req: NextRequest) => {
  const body = await req.json();
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const selector = typeof body.selector === "string" ? body.selector.trim() : "";
  const submitMethod = body.submitMethod === "button" ? "button" : "enter";
  const submitSelector = typeof body.submitSelector === "string" ? body.submitSelector.trim() : "";
  const profileIds: string[] = Array.isArray(body.profileIds) ? body.profileIds : [];

  if (!url || !selector || profileIds.length === 0) {
    return NextResponse.json(
      { error: "'url', 'selector' y al menos un perfil en 'profileIds' son requeridos" },
      { status: 400 },
    );
  }
  if (submitMethod === "button" && !submitSelector) {
    return NextResponse.json({ error: "Falta el selector del botón para enviar el comentario" }, { status: 400 });
  }

  await dbConnect();

  const profiles = await findUsableProfiles(user, profileIds);
  if (!profiles.length) {
    return NextResponse.json({ error: "No se encontraron los perfiles seleccionados" }, { status: 404 });
  }

  // Reserva N comentarios sin usar (uno por perfil) antes de crear nada: si
  // no alcanza, no se crea ninguna tarea a medias.
  const pool = await CommentModel.find({ ownerId: user.objectId, used: false })
    .sort({ createdAt: 1 })
    .limit(profiles.length);
  if (pool.length < profiles.length) {
    return NextResponse.json(
      {
        error: `Solo hay ${pool.length} comentario(s) disponibles en el banco para ${profiles.length} perfil(es) elegidos. Importa más comentarios o elige menos perfiles.`,
      },
      { status: 409 },
    );
  }

  const waitMs = Number(body.waitMs) > 0 ? Number(body.waitMs) : 3000;
  const staggerSeconds = Number(body.staggerSeconds) >= 0 ? Number(body.staggerSeconds) : 0;
  const autoRun = Boolean(body.autoRun);
  const namePrefix =
    typeof body.namePrefix === "string" && body.namePrefix.trim() ? body.namePrefix.trim() : "comment";
  const campaignName = readCampaignName(body, "comment", namePrefix);
  const now = Date.now();

  const claimedIds = pool.map((c) => c._id);

  const submitStep =
    submitMethod === "button"
      ? { action: "click" as const, selector: submitSelector }
      : { action: "press" as const, selector, key: "Enter" };

  const docs = profiles.map((p, i) => ({
    name: `${namePrefix} · ${p.name}`,
    profileId: p._id,
    type: "comment" as const,
    steps: [
      { action: "goto" as const, url },
      { action: "waitForTimeout" as const, ms: waitMs },
      ...loginIfNeededSteps(),
      { action: "waitForSelector" as const, selector, ms: 15000 },
      { action: "click" as const, selector },
      { action: "type" as const, selector, value: pool[i].text },
      { action: "waitForTimeout" as const, ms: 800 },
      submitStep,
      { action: "waitForTimeout" as const, ms: 1500 },
      // Comprueba que el comentario quedó publicado y guarda su permalink en
      // la tarea. Sin esto la tarea terminaba en "exitosa" apenas terminaba de
      // teclear, aunque Facebook lo hubiera descartado en silencio.
      //
      // Que no sea `optional` es a propósito: un comentario que no aparece es
      // un fallo, no un detalle. Si en algún momento resulta demasiado
      // estricto, agregarle `optional: true` lo degrada a advertencia y la
      // tarea sigue su curso.
      { action: "captureComment" as const, value: pool[i].text },
    ],
    status: autoRun ? ("queued" as const) : ("pending" as const),
    scheduledAt: new Date(now + i * staggerSeconds * 1000),
  }));

  const campaignId = typeof body.campaignId === "string" ? body.campaignId.trim() : "";

  // Solo se marcan usados los comentarios una vez que las tareas ya
  // existen: si insertMany falla, el banco queda intacto para reintentar.
  let campaign;
  let created;
  if (campaignId) {
    const result = await addTasksToCampaign({ ownerId: user.objectId, campaignId, type: "comment", docs });
    if (!result.ok) {
      return result.error === "not_found"
        ? NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 })
        : NextResponse.json(
            { error: `La campaña elegida es de tipo "${result.campaignType}", no "comment"` },
            { status: 400 },
          );
    }
    campaign = result.campaign;
    created = result.tasks;
  } else {
    const r = await createCampaignWithTasks({
      ownerId: user.objectId,
      name: campaignName,
      type: "comment",
      autoRun,
      docs,
    });
    campaign = r.campaign;
    created = r.tasks;
  }

  await Promise.all(
    created.map((t, i) =>
      CommentModel.updateOne(
        { _id: claimedIds[i] },
        { $set: { used: true, usedAt: new Date(), usedByTaskId: t._id } },
      ),
    ),
  );

  const tasks = created.map((t, i) => ({
    _id: t._id,
    name: t.name,
    status: t.status,
    comment: pool[i].text,
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
