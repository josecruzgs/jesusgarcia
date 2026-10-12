import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { withAuth } from "@/lib/apiHandler";
import { allowedGroupFilter } from "@/lib/auth/dal";
import { loginIfNeededSteps } from "@/lib/automation/loginSteps";
import { grupoCanonico } from "@/lib/facebookGroups";
import ProfileModel from "@/lib/models/Profile";
import TaskModel from "@/lib/models/Task";

const NOMBRE_TAREA = "Leer nombres de grupos";

// Facebook no muestra el nombre de un grupo sin sesión, así que para los
// grupos que todavía no lo tienen se encola una tarea en la que un perfil
// logueado pasa por cada uno y lo lee (step "readGroupName"). Va por la cola
// normal del worker para no pisarse con los motores.
export const POST = withAuth(async (user) => {
  await dbConnect();

  const enCurso = await TaskModel.exists({
    name: NOMBRE_TAREA,
    status: { $in: ["pending", "queued", "running"] },
  });
  if (enCurso) {
    return NextResponse.json({ error: "Ya hay una tarea leyendo los nombres; espera a que termine" }, { status: 409 });
  }

  const profiles = await ProfileModel.find(allowedGroupFilter(user), { _id: 1 }).lean<{ _id: unknown }[]>();
  const ids = profiles.map((p) => p._id);

  const tasks = await TaskModel.find(
    { type: "joingroup", profileId: { $in: ids } },
    { steps: 1, groupName: 1 },
  ).lean<{ steps: { action: string; url?: string }[]; groupName?: string }[]>();

  const conNombre = new Set<string>();
  const todos = new Set<string>();
  for (const t of tasks) {
    const raw = t.steps.find((s) => s.action === "goto" && s.url)?.url;
    const url = raw ? grupoCanonico(raw) : null;
    if (!url) continue;
    todos.add(url);
    if (t.groupName) conNombre.add(url);
  }
  const sinNombre = [...todos].filter((u) => !conNombre.has(u));
  if (!sinNombre.length) {
    return NextResponse.json({ error: "Todos los grupos ya tienen nombre" }, { status: 409 });
  }

  // El perfil: el que más recientemente entró bien a un grupo (está logueado y
  // Facebook no lo tiene frenado) y que no tenga nada corriendo ni en cola.
  const ocupados = await TaskModel.distinct("profileId", { status: { $in: ["queued", "running"] } });
  const ultimo = await TaskModel.findOne(
    { type: "joingroup", status: "success", profileId: { $in: ids, $nin: ocupados } },
    { profileId: 1 },
  )
    .sort({ finishedAt: -1 })
    .lean<{ profileId: unknown }>();
  if (!ultimo) {
    return NextResponse.json(
      { error: "No hay un perfil libre que ya haya entrado a un grupo para leer los nombres" },
      { status: 409 },
    );
  }

  const task = await TaskModel.create({
    ownerId: user.objectId,
    name: NOMBRE_TAREA,
    profileId: ultimo.profileId,
    type: "custom",
    status: "queued",
    steps: [
      { action: "goto", url: sinNombre[0] },
      { action: "waitForTimeout", ms: 3000 },
      ...loginIfNeededSteps(),
      ...sinNombre.flatMap((url) => [
        { action: "goto" as const, url, optional: true },
        { action: "waitForTimeout" as const, ms: 4000 },
        { action: "readGroupName" as const, url, optional: true },
      ]),
    ],
  });

  return NextResponse.json({ taskId: String(task._id), grupos: sinNombre.length }, { status: 201 });
});
