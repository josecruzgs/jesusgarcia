import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import WorkerHeartbeatModel, { type WorkerRole } from "@/lib/models/WorkerHeartbeat";
import { withAuth } from "@/lib/apiHandler";

const ROLES: WorkerRole[] = ["tasks", "listening"];

/**
 * Estado de cada worker. Se informan por separado porque en un deploy real la
 * automatización corre donde está AdsPower y la escucha en el VPS: uno puede
 * estar caído mientras el otro trabaja, y un sí/no único lo ocultaría.
 *
 * `online` queda como estaba —vivo el de tareas— para no romper a quien ya lee
 * ese campo.
 */
// No se acota por usuario: es el estado de la infraestructura, igual para
// todos, y la barra superior lo muestra en cada pantalla.
export const GET = withAuth(async () => {
  await dbConnect();

  const beats = await WorkerHeartbeatModel.find({ _id: { $in: ROLES } }).lean();
  const byRole = new Map(beats.map((b) => [String(b._id), b] as const));

  const status = Object.fromEntries(
    ROLES.map((role) => {
      const beat = byRole.get(role);
      if (!beat) return [role, { online: false, lastSeenAt: null, host: null }];

      // Sin latido en tres intervalos de poll, el proceso está caído.
      const ageMs = Date.now() - new Date(beat.updatedAt).getTime();
      return [
        role,
        {
          online: ageMs <= beat.pollIntervalMs * 3,
          lastSeenAt: beat.updatedAt,
          host: beat.host ?? null,
          ageMs,
        },
      ];
    }),
  ) as Record<WorkerRole, { online: boolean; lastSeenAt: Date | null; host: string | null; ageMs?: number }>;

  return NextResponse.json({
    online: status.tasks.online,
    lastSeenAt: status.tasks.lastSeenAt,
    roles: status,
  });
});
