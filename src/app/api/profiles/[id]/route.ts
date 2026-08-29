import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { adsPower } from "@/lib/adspower/client";
import { withAuth } from "@/lib/apiHandler";
import { findUsableProfile } from "@/lib/auth/profiles";
import TaskModel from "@/lib/models/Task";

/**
 * Los estados de tarea que se van con el perfil cuando se pide `withTasks`.
 *
 * Son los que ya no se van a poder cumplir: sin perfil no hay navegador con
 * qué correrlas, y quedarían en la cola pidiendo turno para siempre. Las
 * `success` y las `cancelled` se quedan donde están —son el registro de lo que
 * ya pasó, y borrarlas reescribiría los conteos de campañas viejas.
 */
const UNRUNNABLE_TASK_STATUSES = ["failed", "queued", "pending", "paused"];

function isMissingAdsPowerProfileError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return /not\s*found|not\s*exist|does\s*not\s*exist|no\s*existe|no\s*encontrado|profile.*missing|user.*missing|invalid.*user/i.test(
    message,
  );
}

function isInUseAdsPowerProfileError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return /(being used|in use|other users|en uso|usado)/i.test(message) && /(delete|deleted|cannot|eliminar|borrar)/i.test(message);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export const GET = withAuth(
  async (user, _req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    await dbConnect();
    const profile = await findUsableProfile(user, id);
    return NextResponse.json({ profile });
  },
);

export const DELETE = withAuth(
  async (user, req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const localOnly = req.nextUrl.searchParams.get("localOnly") === "true";
    // Lo que pide el botón de "Eliminar perfil" de una campaña: el perfil que
    // Facebook frenó no sirve más, y sus tareas en cola tampoco.
    const withTasks = req.nextUrl.searchParams.get("withTasks") === "true";
    await dbConnect();
    const profile = await findUsableProfile(user, id);

    let deletedTaskCount = 0;
    if (withTasks) {
      // Una tarea corriendo tiene un navegador abierto de este perfil: borrarlo
      // en el medio deja el proceso huérfano y la tarea sin dueño a quien
      // reportarle el final. Se avisa y no se toca nada.
      const running = await TaskModel.countDocuments({ profileId: profile._id, status: "running" });
      if (running > 0) {
        return NextResponse.json(
          {
            error: `Este perfil tiene ${running} ${running === 1 ? "tarea corriendo" : "tareas corriendo"}. Esperá a que termine o detenela antes de eliminarlo.`,
          },
          { status: 409 },
        );
      }

      // Antes de tocar AdsPower y no después: entre el `deleteProfiles` y el
      // borrado en Mongo hay segundos —incluido un reintento con espera si el
      // perfil estaba abierto— y en ese hueco el worker podría levantar una de
      // las tareas en cola y arrancarle el navegador de nuevo.
      const taskResult = await TaskModel.deleteMany({
        profileId: profile._id,
        status: { $in: UNRUNNABLE_TASK_STATUSES },
      });
      deletedTaskCount = taskResult.deletedCount ?? 0;
    }

    let adsPowerDeleted = false;
    if (!localOnly) {
      try {
        await adsPower.deleteProfiles([profile.adsPowerProfileId]);
        adsPowerDeleted = true;
      } catch (err) {
        if (isMissingAdsPowerProfileError(err)) {
          adsPowerDeleted = false;
        } else if (isInUseAdsPowerProfileError(err)) {
          await adsPower.stopBrowser(profile.adsPowerProfileId).catch(() => undefined);
          await sleep(1200);

          try {
            await adsPower.deleteProfiles([profile.adsPowerProfileId]);
            adsPowerDeleted = true;
          } catch (retryErr) {
            if (isMissingAdsPowerProfileError(retryErr)) {
              adsPowerDeleted = false;
            } else if (isInUseAdsPowerProfileError(retryErr)) {
              return NextResponse.json(
                {
                  error:
                    "AdsPower no permite eliminar este perfil porque sigue en uso. Cierra el perfil en AdsPower o eliminalo solo de esta app.",
                  canDeleteLocal: true,
                  // Las tareas ya no están: si se reintenta con localOnly, este
                  // número es el que hay que sumar al informe final.
                  deletedTaskCount,
                },
                { status: 409 },
              );
            } else {
              throw retryErr;
            }
          }
        } else {
          throw err;
        }
      }
    }

    await profile.deleteOne();

    return NextResponse.json({ ok: true, adsPowerDeleted, localOnly, deletedTaskCount });
  },
);
