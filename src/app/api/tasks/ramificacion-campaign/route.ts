import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import CommentModel from "@/lib/models/Comment";
import { withAuth } from "@/lib/apiHandler";
import { findUsableProfiles } from "@/lib/auth/profiles";
import { loginIfNeededSteps } from "@/lib/automation/loginSteps";
import { addTasksToCampaign, createCampaignWithTasks, readCampaignName } from "@/lib/campaigns";
import { FACEBOOK_COMMENT_BOX_SELECTOR } from "@/lib/automation/socialSelectors";

// Ramificaciones: un comentario "padre" en la publicación y, colgadas de él,
// ramas "hijas" que lo apoyan — cada una le da like y le deja una respuesta.
//
// La campaña se crea entera de una vez, pero los hijos NO pueden saber a qué
// comentario apuntar: el padre todavía no se publicó y su `comment_id` no
// existe. Por eso nacen en "pending" con los steps marcados `fromParent`, y es
// el runner el que los completa y los pasa a la cola cuando el padre termina
// bien (ver resolverRamasDe en automation/runner.ts).
//
// Consecuencia a tener presente: si Facebook no le da enlace propio al
// comentario padre —cosa habitual en reels— las ramas se cancelan solas con el
// motivo. Sin `comment_id` no hay a qué responder, y adivinar sería colgarle la
// rama al comentario de otro.
export const POST = withAuth(async (user, req: NextRequest) => {
  const body = await req.json();
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const parentProfileId = typeof body.parentProfileId === "string" ? body.parentProfileId.trim() : "";
  const childProfileIds: string[] = Array.isArray(body.childProfileIds) ? body.childProfileIds : [];

  if (!url || !parentProfileId || childProfileIds.length === 0) {
    return NextResponse.json(
      { error: "'url', 'parentProfileId' y al menos un perfil en 'childProfileIds' son requeridos" },
      { status: 400 },
    );
  }
  if (childProfileIds.includes(parentProfileId)) {
    return NextResponse.json(
      { error: "El perfil del comentario padre no puede estar también entre los hijos: se respondería a sí mismo" },
      { status: 400 },
    );
  }

  await dbConnect();

  // Se piden juntos y después se separan: así una sola consulta valida que
  // todos los perfiles existan y que el usuario tenga permiso sobre sus grupos.
  const profiles = await findUsableProfiles(user, [parentProfileId, ...childProfileIds]);
  const parentProfile = profiles.find((p) => String(p._id) === parentProfileId);
  const childProfiles = profiles.filter((p) => String(p._id) !== parentProfileId);

  if (!parentProfile) {
    return NextResponse.json({ error: "No se encontró el perfil del comentario padre" }, { status: 404 });
  }
  if (!childProfiles.length) {
    return NextResponse.json({ error: "No se encontraron los perfiles hijos seleccionados" }, { status: 404 });
  }

  // Los textos pueden venir escritos desde el formulario o salir del banco.
  //
  // Se admiten los dos caminos porque una ramificación se arma alrededor de un
  // comentario padre concreto —el que se quiere apoyar— y elegirlo a mano es lo
  // normal; además el banco puede estar vacío, y sin esta salida la función no
  // se podría usar hasta importar comentarios.
  const parentText = typeof body.parentText === "string" ? body.parentText.trim() : "";
  const childTextsRaw: unknown[] = Array.isArray(body.childTexts) ? body.childTexts : [];
  const childTexts = childTextsRaw.map((t) => (typeof t === "string" ? t.trim() : ""));

  const textosPropios =
    Boolean(parentText) && childTexts.length === childProfiles.length && childTexts.every(Boolean);

  const necesarios = childProfiles.length + 1;

  // Solo se toca el banco cuando los textos no vinieron escritos: escribirlos a
  // mano no debería consumir el stock reservado para otras campañas.
  const pool = textosPropios
    ? []
    : await CommentModel.find({ ownerId: user.objectId, used: false }).sort({ createdAt: 1 }).limit(necesarios);

  if (!textosPropios && pool.length < necesarios) {
    return NextResponse.json(
      {
        error:
          childTexts.length || parentText
            ? `Faltan textos: hacen falta 1 para el padre y ${childProfiles.length} para las ramas. Completalos todos o dejalos vacíos para tomarlos del banco (hay ${pool.length} disponibles).`
            : `Hacen falta ${necesarios} comentarios del banco (1 padre + ${childProfiles.length} respuestas) y solo hay ${pool.length}. Escribilos a mano en el formulario, importa más comentarios, o elegí menos perfiles.`,
      },
      { status: 409 },
    );
  }

  const waitMs = Number(body.waitMs) > 0 ? Number(body.waitMs) : 3000;
  const staggerSeconds = Number(body.staggerSeconds) >= 0 ? Number(body.staggerSeconds) : 60;
  const autoRun = Boolean(body.autoRun);
  const namePrefix =
    typeof body.namePrefix === "string" && body.namePrefix.trim() ? body.namePrefix.trim() : "rama";
  const campaignName = readCampaignName(body, "ramificacion", namePrefix);

  const textoPadre = textosPropios ? parentText : pool[0].text;
  const textosHijos = textosPropios ? childTexts : pool.slice(1).map((c) => c.text);
  const claimedIds = pool.map((c) => c._id);

  const padreDoc = {
    name: `${namePrefix} · padre · ${parentProfile.name}`,
    profileId: parentProfile._id,
    type: "ramificacion" as const,
    steps: [
      { action: "goto" as const, url },
      { action: "waitForTimeout" as const, ms: waitMs },
      ...loginIfNeededSteps(),
      { action: "waitForSelector" as const, selector: FACEBOOK_COMMENT_BOX_SELECTOR, ms: 15000 },
      { action: "click" as const, selector: FACEBOOK_COMMENT_BOX_SELECTOR },
      { action: "type" as const, selector: FACEBOOK_COMMENT_BOX_SELECTOR, value: textoPadre },
      { action: "waitForTimeout" as const, ms: 800 },
      { action: "press" as const, selector: FACEBOOK_COMMENT_BOX_SELECTOR, key: "Enter" },
      { action: "waitForTimeout" as const, ms: 1500 },
      // Sin este paso no hay permalink, y sin permalink no hay ramificación.
      { action: "captureComment" as const, value: textoPadre },
    ],
    status: autoRun ? ("queued" as const) : ("pending" as const),
    scheduledAt: new Date(),
  };

  const { campaign, tasks: creadas } = await createCampaignWithTasks({
    ownerId: user.objectId,
    name: campaignName,
    type: "ramificacion",
    autoRun,
    docs: [padreDoc],
  });
  const padre = creadas[0];

  // El escalonado arranca después del padre, no en cero: aunque el runner no
  // los deje correr antes de tiempo, con todos programados a la misma hora se
  // amontonarían apenas el padre termine.
  const desde = Date.now() + staggerSeconds * 1000;
  const hijosDocs = childProfiles.map((p, i) => ({
    name: `${namePrefix} · rama · ${p.name}`,
    profileId: p._id,
    type: "ramificacion" as const,
    parentTaskId: padre._id,
    steps: [
      // `fromParent` marca lo que el runner completa al ejecutar: la url del
      // permalink del padre y el id de su comentario.
      { action: "goto" as const, url, fromParent: true },
      { action: "waitForTimeout" as const, ms: waitMs },
      ...loginIfNeededSteps(),
      { action: "likeComment" as const, fromParent: true, ms: 25000 },
      { action: "waitForTimeout" as const, ms: 1200 },
      { action: "replyComment" as const, fromParent: true, value: textosHijos[i], ms: 30000 },
    ],
    // Siempre "pending", incluso con autoRun: la cola solo toma "queued", y
    // pasarlos ahí es lo que hace el runner cuando el padre termina bien.
    status: "pending" as const,
    scheduledAt: new Date(desde + i * staggerSeconds * 1000),
  }));

  const resultado = await addTasksToCampaign({
    ownerId: user.objectId,
    campaignId: String(campaign._id),
    type: "ramificacion",
    docs: hijosDocs,
  });
  if (!resultado.ok) {
    return NextResponse.json({ error: "No se pudieron crear las ramas hijas" }, { status: 500 });
  }

  // Recién con todas las tareas creadas se marcan usados los comentarios: si
  // algo falla antes, el banco queda intacto para reintentar. Con textos
  // escritos a mano no hay nada que marcar.
  await Promise.all(
    [padre, ...resultado.tasks].slice(0, claimedIds.length).map((t, i) =>
      CommentModel.updateOne(
        { _id: claimedIds[i] },
        { $set: { used: true, usedAt: new Date(), usedByTaskId: t._id } },
      ),
    ),
  );

  return NextResponse.json(
    {
      campaign: {
        _id: campaign._id,
        name: campaign.name,
        type: campaign.type,
        status: autoRun ? "queued" : "pending",
        taskCount: resultado.campaign.taskCount ?? resultado.tasks.length + 1,
      },
      padre: {
        _id: padre._id,
        name: padre.name,
        status: padre.status,
        comment: textoPadre,
        profile: { _id: parentProfile._id, name: parentProfile.name },
      },
      ramas: resultado.tasks.map((t, i) => ({
        _id: t._id,
        name: t.name,
        status: t.status,
        comment: textosHijos[i],
        profile: { _id: childProfiles[i]._id, name: childProfiles[i].name },
      })),
    },
    { status: 201 },
  );
});
