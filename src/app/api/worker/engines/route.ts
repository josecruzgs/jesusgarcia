import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import WorkerHeartbeatModel from "@/lib/models/WorkerHeartbeat";
import { withAdmin, HttpError } from "@/lib/apiHandler";
import { MOTORES_TOTALES, MOTORES_POR_DEFECTO } from "@/lib/motores";
import { leerMotoresDeseados, guardarMotoresDeseados, type MotoresDeseados } from "@/lib/workerSettings";

/**
 * El número de motores, para leerlo y cambiarlo desde Ajustes.
 *
 * Va en su propia ruta y no dentro de /api/worker/status porque son dos cosas
 * distintas: status es lo que el worker INFORMA —lo lee cualquier operador en
 * cada pantalla, cada cuatro segundos— y esto es lo que se le PIDE. Mezclarlas
 * habría puesto una escritura de admin en la ruta más caliente del sistema.
 *
 * Solo admin, y de las dos puntas: el número es de la máquina entera, así que
 * un operador que lo bajara le cortaría la capacidad a las campañas de todos.
 */

/**
 * Lo que el worker de tareas está haciendo con ese número, si es que hay uno
 * vivo. Sin esto, la pantalla podría decir "guardado: 5" mientras el proceso
 * está caído y no hay ningún motor encendido.
 */
async function worker() {
  const beat = await WorkerHeartbeatModel.findById("tasks").lean();
  if (!beat) return { online: false, engines: null, target: null, host: null, lastSeenAt: null };

  // Mismo criterio que /api/worker/status: sin latido en tres intervalos de
  // poll, el proceso está caído.
  const ageMs = Date.now() - new Date(beat.updatedAt).getTime();
  return {
    online: ageMs <= beat.pollIntervalMs * 3,
    engines: typeof beat.engines === "number" ? beat.engines : null,
    target: typeof beat.enginesTarget === "number" ? beat.enginesTarget : null,
    host: beat.host ?? null,
    lastSeenAt: beat.updatedAt,
  };
}

function respuesta(ajuste: MotoresDeseados, vivo: Awaited<ReturnType<typeof worker>>) {
  return NextResponse.json({
    engines: ajuste.engines,
    total: MOTORES_TOTALES,
    configurado: ajuste.configurado,
    updatedAt: ajuste.updatedAt,
    updatedBy: ajuste.updatedBy,
    worker: vivo,
  });
}

export const GET = withAdmin(async () => {
  await dbConnect();
  // La semilla acá es el default a secas y no `WORKER_ENGINES`: esta ruta corre
  // en el servidor de Next, que en un deploy partido ni siquiera comparte
  // máquina con el worker y por lo tanto tampoco su env.
  const ajuste = await leerMotoresDeseados(MOTORES_POR_DEFECTO);
  return respuesta(ajuste, await worker());
});

export const PUT = withAdmin(async (user, req: NextRequest) => {
  const body = await req.json();
  const engines = Number(body?.engines);

  // Validación explícita en vez de dejar que `motoresConfigurados` acote: que
  // un 9 se guarde como 5 sin decir nada dejaría la pantalla mostrando un
  // número que nadie eligió.
  if (!Number.isInteger(engines) || engines < 1 || engines > MOTORES_TOTALES) {
    throw new HttpError(400, `Los motores van de 1 a ${MOTORES_TOTALES}`);
  }

  await dbConnect();
  const ajuste = await guardarMotoresDeseados(engines, user.username);
  return respuesta(ajuste, await worker());
});
