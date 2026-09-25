import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { withAuth } from "@/lib/apiHandler";
import { findUsableProfiles } from "@/lib/auth/profiles";
import { loginIfNeededSteps } from "@/lib/automation/loginSteps";
import { addTasksToCampaign, createCampaignWithTasks, readCampaignName } from "@/lib/campaigns";
import TaskModel from "@/lib/models/Task";

/**
 * La forma canónica del grupo: `https://www.facebook.com/groups/<id o alias>/`.
 *
 * Se descarta todo lo que venga después del id (`/posts/...`, `?ref=share`)
 * porque la tarea necesita el encabezado del grupo, que es donde está el botón
 * de unirse, y porque así dos links distintos al mismo grupo se reconocen como
 * el mismo al buscar perfiles que ya lo pidieron.
 */
function grupoCanonico(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (!/(^|\.)facebook\.com$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/groups\/([^/?#]+)/i);
    if (!m) return null;
    return `https://www.facebook.com/groups/${m[1]}/`;
  } catch {
    return null;
  }
}

// Crea una tarea de "unirse al grupo" por cada perfil elegido. El formulario
// de ingreso, si el grupo tiene, lo contesta el runner con Claude usando
// `contexto` y los datos del perfil — ver src/lib/automation/groupJoin.ts.
export const POST = withAuth(async (user, req: NextRequest) => {
  const body = await req.json();
  const url = grupoCanonico(typeof body.url === "string" ? body.url.trim() : "");
  const contexto = typeof body.contexto === "string" ? body.contexto.trim().slice(0, 2000) : "";
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

  await dbConnect();

  const profiles = await findUsableProfiles(user, profileIds);
  if (!profiles.length) {
    return NextResponse.json({ error: "No se encontraron los perfiles seleccionados" }, { status: 404 });
  }

  // Un perfil que ya pidió entrar —o ya está en camino de hacerlo— no se
  // vuelve a mandar: una segunda solicitud al mismo grupo no suma nada y
  // repetir el mismo gesto desde muchas cuentas es justo lo que Facebook
  // marca. Las fallidas y canceladas sí se pueden reintentar.
  //
  // No se acota por ownerId a propósito: la solicitud la hace la cuenta de
  // Facebook, no el operador, así que la de otro operador con el mismo perfil
  // también cuenta. Los perfiles ya vienen recortados a los grupos permitidos
  // por findUsableProfiles, así que no se asoma a perfiles ajenos.
  const previas = await TaskModel.find(
    {
      type: "joingroup",
      profileId: { $in: profiles.map((p) => p._id) },
      status: { $in: ["pending", "queued", "running", "paused", "success"] },
      "steps.url": url,
    },
    { profileId: 1 },
  ).lean<{ profileId: unknown }[]>();
  const yaEnviados = new Set(previas.map((t) => String(t.profileId)));
  const aEnviar = profiles.filter((p) => !yaEnviados.has(String(p._id)));
  const omitidos = profiles.filter((p) => yaEnviados.has(String(p._id))).map((p) => ({ _id: p._id, name: p.name }));

  if (!aEnviar.length) {
    return NextResponse.json(
      { error: "Todos los perfiles elegidos ya tienen una solicitud a este grupo (hecha o en curso)", omitidos },
      { status: 409 },
    );
  }

  const staggerSeconds = Number(body.staggerSeconds) >= 0 ? Number(body.staggerSeconds) : 0;
  const autoRun = Boolean(body.autoRun);
  const namePrefix =
    typeof body.namePrefix === "string" && body.namePrefix.trim() ? body.namePrefix.trim() : "grupo";
  const campaignName = readCampaignName(body, "joingroup", namePrefix);
  const now = Date.now();

  const docs = aEnviar.map((p, i) => ({
    name: `${namePrefix} · ${p.name}`,
    profileId: p._id,
    type: "joingroup" as const,
    steps: [
      { action: "goto" as const, url },
      { action: "waitForTimeout" as const, ms: 3000 },
      ...loginIfNeededSteps(),
      { action: "joinGroup" as const, value: contexto },
      { action: "waitForTimeout" as const, ms: 1500 },
    ],
    status: autoRun ? ("queued" as const) : ("pending" as const),
    scheduledAt: new Date(now + i * staggerSeconds * 1000),
  }));

  const campaignId = typeof body.campaignId === "string" ? body.campaignId.trim() : "";

  let campaign;
  let created;
  if (campaignId) {
    const result = await addTasksToCampaign({ ownerId: user.objectId, campaignId, type: "joingroup", docs });
    if (!result.ok) {
      return result.error === "not_found"
        ? NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 })
        : NextResponse.json(
            { error: `La campaña elegida es de tipo "${result.campaignType}", no de unirse a grupos` },
            { status: 400 },
          );
    }
    campaign = result.campaign;
    created = result.tasks;
  } else {
    const r = await createCampaignWithTasks({
      ownerId: user.objectId,
      name: campaignName,
      type: "joingroup",
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
    profile: { _id: aEnviar[i]._id, name: aEnviar[i].name },
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
