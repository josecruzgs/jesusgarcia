import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { withAuth } from "@/lib/apiHandler";
import { allowedGroupFilter } from "@/lib/auth/dal";
import { grupoCanonico, type JoinState } from "@/lib/facebookGroups";
import ProfileModel from "@/lib/models/Profile";
import TaskModel from "@/lib/models/Task";

/**
 * En qué está cada perfil frente a un grupo, resumido a lo que le importa al
 * operador:
 *
 * - "member":    Facebook lo muestra como miembro.
 * - "requested": la solicitud quedó enviada y espera a los admins. Las tareas
 *                anteriores a `joinState` caen acá: terminaron bien pero no
 *                dejaron dicho si entró directo o quedó pendiente.
 * - "running":   tiene una tarea en cola o corriendo.
 * - "paused":    su tarea está en una campaña pausada: no avanza hasta que se
 *                reanude, pero cuenta como en camino y no se vuelve a mandar.
 * - "failed":    lo intentó y no pudo; se puede volver a mandar.
 */
type ProfileGroupState = "member" | "requested" | "running" | "paused" | "failed";

type JoinTask = {
  profileId: unknown;
  status: string;
  joinState?: JoinState;
  groupName?: string;
  steps: { action: string; url?: string }[];
  createdAt: Date;
};

function estadoDe(t: JoinTask): ProfileGroupState {
  if (t.status === "success") {
    return t.joinState === "joined" || t.joinState === "already_member" ? "member" : "requested";
  }
  if (t.status === "failed" || t.status === "cancelled") return "failed";
  if (t.status === "paused") return "paused";
  return "running";
}

// Cuando un perfil tiene varias tareas al mismo grupo (un reintento tras un
// fallo, por ejemplo), manda la que dice más: ser miembro le gana a la
// solicitud, y cualquiera de las dos a un fallo viejo.
const PRIORIDAD: Record<ProfileGroupState, number> = { member: 3, requested: 2, running: 1, paused: 1, failed: 0 };

// Los grupos de Facebook a los que se mandaron perfiles, con cuántos hay en
// cada estado. Solo cuenta perfiles a los que el usuario tiene acceso; igual
// que el chequeo al crear la campaña, no se filtra por dueño de la tarea,
// porque quien entra al grupo es la cuenta de Facebook, no el operador.
export const GET = withAuth(async (user) => {
  await dbConnect();

  const profiles = await ProfileModel.find(allowedGroupFilter(user), { name: 1 }).lean<
    { _id: unknown; name: string }[]
  >();
  const nombres = new Map(profiles.map((p) => [String(p._id), p.name]));

  const tasks = await TaskModel.find(
    { type: "joingroup", profileId: { $in: profiles.map((p) => p._id) } },
    { profileId: 1, status: 1, joinState: 1, groupName: 1, steps: 1, createdAt: 1 },
  )
    .sort({ createdAt: 1 })
    .lean<JoinTask[]>();

  type Fila = {
    profileId: string;
    name: string;
    state: ProfileGroupState;
  };
  const grupos = new Map<string, { url: string; name: string; lastAt: Date; perfiles: Map<string, Fila> }>();

  for (const t of tasks) {
    const raw = t.steps.find((s) => s.action === "goto" && s.url)?.url;
    const url = raw ? grupoCanonico(raw) : null;
    if (!url) continue;

    let g = grupos.get(url);
    if (!g) {
      g = { url, name: "", lastAt: t.createdAt, perfiles: new Map() };
      grupos.set(url, g);
    }
    if (t.createdAt > g.lastAt) g.lastAt = t.createdAt;
    // El nombre lo lee cada tarea al entrar; se queda el más reciente por si
    // los admins lo cambiaron.
    if (t.groupName) g.name = t.groupName;

    const profileId = String(t.profileId);
    const state = estadoDe(t);
    const previa = g.perfiles.get(profileId);
    // Las tareas vienen de la más vieja a la más nueva: a igual prioridad se
    // queda la más reciente.
    if (previa && PRIORIDAD[previa.state] > PRIORIDAD[state]) continue;
    g.perfiles.set(profileId, {
      profileId,
      name: nombres.get(profileId) ?? profileId,
      state,
    });
  }

  const groups = [...grupos.values()]
    .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime())
    .map((g) => {
      const perfiles = [...g.perfiles.values()].sort((a, b) => a.name.localeCompare(b.name));
      const counts = { member: 0, requested: 0, running: 0, paused: 0, failed: 0 };
      for (const p of perfiles) counts[p.state]++;
      return { url: g.url, name: g.name, lastAt: g.lastAt, counts, profiles: perfiles };
    });

  return NextResponse.json({ groups });
});
