import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import ActionPlayModel from "@/lib/models/ActionPlay";
import { withAuth } from "@/lib/apiHandler";
import { assertOwnedProject } from "@/lib/listening/ownership";
import { dispatchPlay } from "@/lib/listening/dispatch";

type Params = { params: Promise<{ id: string; playId: string }> };

/**
 * Activa la jugada: crea la campaña de Agua con una tarea por perfil elegido.
 *
 * A partir de acá la jugada sale del alcance de Viento — el seguimiento, la
 * pausa y el reintento viven en `/campanas`, igual que para cualquier campaña
 * creada desde los wizards.
 */
export const POST = withAuth(async (user, req: NextRequest, { params }: Params) => {
  const { id, playId } = await params;
  const body = await req.json().catch(() => ({}));

  await dbConnect();
  await assertOwnedProject(user, id);

  const play = await ActionPlayModel.findOne({ _id: playId, projectId: id }).lean();
  if (!play) return NextResponse.json({ error: "Jugada no encontrada" }, { status: 404 });
  if (play.status === "dispatched") {
    return NextResponse.json({ error: "Esta jugada ya se ejecutó" }, { status: 409 });
  }

  const result = await dispatchPlay(user, play, {
    profileIds: Array.isArray(body.profileIds) ? body.profileIds : [],
    autoRun: body.autoRun !== false,
    // Escalonado por defecto: cinco minutos entre cuentas. Diez comentarios en
    // el mismo minuto sobre el mismo post es el patrón que Facebook marca.
    staggerSeconds: Number(body.staggerSeconds) >= 0 ? Number(body.staggerSeconds) : 300,
    waitMs: Number(body.waitMs) > 0 ? Number(body.waitMs) : 3000,
    campaignName: typeof body.campaignName === "string" ? body.campaignName : undefined,
    selector: typeof body.selector === "string" && body.selector.trim() ? body.selector.trim() : undefined,
  });

  return NextResponse.json(
    {
      campaign: {
        _id: result.campaign._id,
        name: result.campaign.name,
        type: result.campaign.type,
        taskCount: result.tasks.length,
      },
      tasks: result.tasks.map((task, i) => ({
        _id: task._id,
        name: task.name,
        status: task.status,
        scheduledAt: task.scheduledAt,
        profile: { _id: result.profiles[i]._id, name: result.profiles[i].name },
      })),
    },
    { status: 201 },
  );
});
