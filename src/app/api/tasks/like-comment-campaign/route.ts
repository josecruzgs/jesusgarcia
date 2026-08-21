import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { withAuth } from "@/lib/apiHandler";
import { findUsableProfiles } from "@/lib/auth/profiles";
import { loginIfNeededSteps } from "@/lib/automation/loginSteps";
import { addTasksToCampaign, createCampaignWithTasks, readCampaignName } from "@/lib/campaigns";
import { parseFacebookCommentTarget } from "@/lib/commentLinks";

// Hermana de like-campaign, pero apuntando a un comentario en vez de a la
// publicación. La diferencia de fondo: el botón de un comentario no se puede
// nombrar con un selector CSS (es igual al del post y al de los demás
// comentarios), así que la tarea no lleva selector — lleva el id que sale del
// link, y el runner resuelve el elemento en la página con el step "likeComment".
export const POST = withAuth(async (user, req: NextRequest) => {
  const body = await req.json();
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const reaction = typeof body.reaction === "string" && body.reaction.trim() ? body.reaction.trim() : "like";
  const reactionSelector = typeof body.reactionSelector === "string" ? body.reactionSelector.trim() : "";
  const profileIds: string[] = Array.isArray(body.profileIds) ? body.profileIds : [];

  if (!url || profileIds.length === 0) {
    return NextResponse.json(
      { error: "'url' y al menos un perfil en 'profileIds' son requeridos" },
      { status: 400 },
    );
  }

  const target = parseFacebookCommentTarget(url);
  if (!target) {
    return NextResponse.json(
      {
        error:
          "El link no apunta a un comentario: le falta 'comment_id'. Copia el link desde la hora del comentario (menú ··· → Copiar enlace), no el de la publicación.",
      },
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

  const waitMs = Number(body.waitMs) > 0 ? Number(body.waitMs) : 4000;
  const staggerSeconds = Number(body.staggerSeconds) >= 0 ? Number(body.staggerSeconds) : 0;
  const autoRun = Boolean(body.autoRun);
  const namePrefix =
    typeof body.namePrefix === "string" && body.namePrefix.trim() ? body.namePrefix.trim() : "like-comentario";
  const campaignName = readCampaignName(body, "likecomment", namePrefix);
  const now = Date.now();

  const docs = profiles.map((p, i) => ({
    name: `${namePrefix} · ${p.name}`,
    profileId: p._id,
    type: "likecomment" as const,
    steps: [
      { action: "goto" as const, url },
      { action: "waitForTimeout" as const, ms: waitMs },
      ...loginIfNeededSteps(),
      {
        action: "likeComment" as const,
        commentId: target.commentId,
        // Sin reactionSelector el step da un clic simple (me gusta); con él,
        // primero hace hover para abrir el picker y ahí elige la reacción.
        ...(reaction === "like" ? {} : { reactionSelector }),
        ms: 25000,
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
    const result = await addTasksToCampaign({ ownerId: user.objectId, campaignId, type: "likecomment", docs });
    if (!result.ok) {
      return result.error === "not_found"
        ? NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 })
        : NextResponse.json(
            { error: `La campaña elegida es de tipo "${result.campaignType}", no "likecomment"` },
            { status: 400 },
          );
    }
    campaign = result.campaign;
    created = result.tasks;
  } else {
    const r = await createCampaignWithTasks({
      ownerId: user.objectId,
      name: campaignName,
      type: "likecomment",
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
      commentId: target.commentId,
      isReply: target.isReply,
      tasks,
    },
    { status: 201 },
  );
});
