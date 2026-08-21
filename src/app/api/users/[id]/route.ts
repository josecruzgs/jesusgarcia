import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import UserModel, { USER_ROLES, toPublicUser } from "@/lib/models/User";
import CampaignModel from "@/lib/models/Campaign";
import TaskModel from "@/lib/models/Task";
import DashboardModel from "@/lib/models/Dashboard";
import PostModel from "@/lib/models/Post";
import CommentModel from "@/lib/models/Comment";
import ListeningProjectModel from "@/lib/models/ListeningProject";
import { withAdmin } from "@/lib/apiHandler";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { knownGroupIds } from "@/lib/auth/groups";

type Params = { params: Promise<{ id: string }> };

/**
 * Impide quedarse sin ningún admin activo.
 *
 * Sin este freno, un admin puede bajarse a sí mismo de rol o darse de baja y
 * dejar el panel sin nadie que pueda crear usuarios ni sincronizar perfiles —
 * y la única salida sería entrar a Mongo a mano.
 */
async function wouldRemoveLastAdmin(userId: Types.ObjectId): Promise<boolean> {
  const others = await UserModel.countDocuments({
    _id: { $ne: userId },
    role: "admin",
    active: true,
  });
  return others === 0;
}

export const PATCH = withAdmin(async (_admin, req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const body = await req.json();

  await dbConnect();

  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  const user = await UserModel.findById(id);
  if (!user) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  const losesAdmin =
    (typeof body.role === "string" && body.role !== "admin" && user.role === "admin") ||
    (body.active === false && user.role === "admin");

  if (losesAdmin && (await wouldRemoveLastAdmin(user._id))) {
    return NextResponse.json(
      { error: "No podés dejar el sistema sin ningún administrador activo" },
      { status: 409 },
    );
  }

  if (typeof body.role === "string") {
    if (!USER_ROLES.includes(body.role)) {
      return NextResponse.json({ error: "Rol inválido" }, { status: 400 });
    }
    user.role = body.role;
  }

  if (typeof body.active === "boolean") user.active = body.active;

  if ("groupIds" in body) {
    user.groupIds = await knownGroupIds(body.groupIds);
  }

  // El admin ve todos los grupos por definición; guardarle una lista solo
  // dejaría permisos viejos esperando a reaparecer si algún día lo bajan.
  if (user.role === "admin") user.groupIds = [];

  if (typeof body.password === "string" && body.password) {
    const problem = passwordProblem(body.password);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    user.passwordHash = await hashPassword(body.password);
  }

  await user.save();

  return NextResponse.json({ user: toPublicUser(user) });
});

// Colecciones con ownerId. Se revisan antes de borrar para no dejar campañas,
// tareas o dashboards apuntando a un usuario que ya no existe.
const OWNED = [
  { model: CampaignModel, one: "campaña", many: "campañas" },
  { model: TaskModel, one: "tarea", many: "tareas" },
  { model: DashboardModel, one: "dashboard", many: "dashboards" },
  { model: PostModel, one: "publicación", many: "publicaciones" },
  { model: CommentModel, one: "comentario", many: "comentarios" },
  { model: ListeningProjectModel, one: "proyecto de escucha", many: "proyectos de escucha" },
] as const;

function count(n: number, entry: { one: string; many: string }) {
  return `${n} ${n === 1 ? entry.one : entry.many}`;
}

export const DELETE = withAdmin(async (admin, req: NextRequest, { params }: Params) => {
  const { id } = await params;
  // ?transfer=1 pasa lo que tenga al admin que borra, y recién ahí lo elimina.
  const transfer = req.nextUrl.searchParams.get("transfer") === "1";

  await dbConnect();

  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  const user = await UserModel.findById(id).select("_id role active");
  if (!user) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  if (user.role === "admin" && (await wouldRemoveLastAdmin(user._id))) {
    return NextResponse.json(
      { error: "No podés dejar el sistema sin ningún administrador activo" },
      { status: 409 },
    );
  }

  if (transfer) {
    // Reasignar en vez de borrar en cascada: las campañas arrastran tareas, y
    // las tareas logs, y los proyectos de escucha menciones y briefs. Mover el
    // dueño no toca nada de eso y no destruye trabajo que quizá sirva.
    const moved = await Promise.all(
      OWNED.map(async (entry) => {
        const { modifiedCount } = await entry.model.updateMany(
          { ownerId: user._id },
          { $set: { ownerId: admin.objectId } },
        );
        return { label: count(modifiedCount, entry), count: modifiedCount };
      }),
    );

    await user.deleteOne();
    return NextResponse.json({
      ok: true,
      transferred: moved.filter((m) => m.count > 0),
    });
  }

  const counts = await Promise.all(
    OWNED.map(async (entry) => {
      const n = await entry.model.countDocuments({ ownerId: user._id });
      return { label: count(n, entry), count: n };
    }),
  );
  const withData = counts.filter((c) => c.count > 0);

  if (withData.length > 0) {
    const detail = withData.map((c) => c.label).join(", ");
    return NextResponse.json(
      {
        error: `Este usuario tiene ${detail}.`,
        // La interfaz lo usa para ofrecer el traspaso en vez de dejar al admin
        // sin salida: los bancos de texto son privados, así que no hay ninguna
        // pantalla desde donde vaciar lo de otro.
        canTransfer: true,
        owned: withData,
      },
      { status: 409 },
    );
  }

  await user.deleteOne();
  return NextResponse.json({ ok: true });
});
