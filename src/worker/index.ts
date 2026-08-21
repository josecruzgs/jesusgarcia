import { config } from "dotenv";
config({ path: ".env.local" });

import { hostname } from "os";
import { dbConnect } from "@/lib/mongodb";
import TaskModel from "@/lib/models/Task";
import WorkerHeartbeatModel, { type WorkerRole } from "@/lib/models/WorkerHeartbeat";
import ListeningProjectModel from "@/lib/models/ListeningProject";
import { runTask } from "@/lib/automation/runner";
import { findDueProjects, ingestProject } from "@/lib/listening/ingest";
import { analyzeMentions } from "@/lib/listening/analyze";
import { generateNextBriefWindow } from "@/lib/listening/briefSchedule";

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5000);

/**
 * Los dos trabajos del worker se pueden encender por separado porque tienen
 * requisitos de máquina incompatibles: la automatización necesita AdsPower de
 * escritorio corriendo en el mismo equipo, y la escucha solo necesita salida a
 * internet. En un deploy real eso son dos procesos —uno en el VPS con
 * `WORKER_TASKS=0`, otro en la máquina con AdsPower y `WORKER_LISTENING=0`—
 * coordinados por Mongo, que es de donde ambos toman el trabajo.
 *
 * Por defecto los dos están encendidos: en local un solo proceso hace todo.
 */
function enabled(name: string): boolean {
  const raw = process.env[name];
  return raw === undefined || !["0", "false", "no", "off"].includes(raw.trim().toLowerCase());
}

const ROLES: WorkerRole[] = [
  ...(enabled("WORKER_TASKS") ? (["tasks"] as const) : []),
  ...(enabled("WORKER_LISTENING") ? (["listening"] as const) : []),
];

const HOST = hostname();

// La escucha no se revisa en cada tick: los proveedores tienen su propio
// intervalo por proyecto (por defecto 60 min) y consultarlos cada 5 segundos
// solo gastaría llamadas. Un minuto de resolución alcanza de sobra.
const LISTENING_CHECK_MS = 60_000;
let lastListeningCheck = 0;

let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

async function heartbeat() {
  // Un latido por rol activo: así la UI puede decir "la escucha corre pero la
  // automatización no" en vez de un sí/no que en dos máquinas sería mentira.
  for (const role of ROLES) {
    await WorkerHeartbeatModel.findByIdAndUpdate(
      role,
      { $set: { pollIntervalMs: POLL_INTERVAL_MS, host: HOST } },
      { upsert: true },
    );
  }
}

async function tick() {
  const task = await TaskModel.findOneAndUpdate(
    { status: "queued", scheduledAt: { $lte: new Date() } },
    { $set: { status: "running" } },
    { sort: { scheduledAt: 1 }, returnDocument: "after" },
  );

  if (!task) return;

  console.log(`[worker] ejecutando tarea ${task._id} (${task.name})`);
  try {
    // runTask vuelve a marcar running/success/failed y escribe logs;
    // aquí solo evitamos que dos ticks tomen la misma tarea.
    await runTask(String(task._id));
  } catch (err) {
    console.error(`[worker] error en tarea ${task._id}:`, err);
  }
}

/**
 * Cierra UNA ventana de tres días pendiente del resumen ejecutivo.
 *
 * Una por pasada y no todas las que falten: el brief corre con razonamiento
 * profundo sobre cientos de menciones, y un proyecto recién importado con
 * meses de historial dispararía decenas de llamadas seguidas apenas arranca el
 * worker. Como la ingesta vuelve a pasar por acá cada vez que el proyecto
 * vence su intervalo, el atraso se drena solo sin picos de gasto.
 *
 * El error se registra y se traga: un informe que falla no debe cortar la
 * ingesta de los proyectos que siguen en la cola.
 */
async function closeDueBriefWindow(projectId: string) {
  try {
    const result = await generateNextBriefWindow(projectId);
    if (!result) return;
    console.log(
      `[escucha] ${projectId}: informe ${result.window.startDay} → ${result.window.endDay}` +
        ` (${result.window.mentions} menciones, quedan ${result.remaining})`,
    );
  } catch (err) {
    console.error(`[escucha] error al generar el informe de ${projectId}:`, err);
  }
}

/** Ingesta de los proyectos de escucha cuyo intervalo ya venció. */
async function listeningTick() {
  if (Date.now() - lastListeningCheck < LISTENING_CHECK_MS) return;
  lastListeningCheck = Date.now();

  const due = await findDueProjects();

  for (const projectId of due) {
    if (stopping) return;

    try {
      const report = await ingestProject(projectId);
      console.log(
        `[escucha] ${projectId}: ${report.saved} nuevas de ${report.fetched} traídas` +
          `${report.errors.length > 0 ? ` (${report.errors.length} fuentes con error)` : ""}`,
      );

      const project = await ListeningProjectModel.findById(projectId)
        .select("autoAnalyze autoBrief")
        .lean();
      if (project?.autoAnalyze && report.saved > 0) {
        // Si falta la API key de Claude esto tira; se registra y la ingesta
        // igual queda guardada, que es lo que importa preservar.
        const analyzed = await analyzeMentions(projectId);
        console.log(`[escucha] ${projectId}: ${analyzed} menciones analizadas`);
      }

      if (project?.autoBrief !== false) await closeDueBriefWindow(projectId);
    } catch (err) {
      console.error(`[escucha] error en el proyecto ${projectId}:`, err);
    }
  }
}

async function main() {
  if (ROLES.length === 0) {
    console.error("[worker] WORKER_TASKS y WORKER_LISTENING están los dos apagados: no hay nada que hacer");
    process.exit(1);
  }

  await dbConnect();
  console.log(
    `[worker] ${HOST} · roles: ${ROLES.join(" + ")} · poll cada ${POLL_INTERVAL_MS}ms`,
  );

  // El latido va en su propio temporizador, no dentro del bucle de trabajo.
  //
  // Latir una vez por vuelta parecía suficiente, pero `tick()` ejecuta una
  // tarea entera —abrir el navegador en AdsPower, navegar, publicar, cerrar—,
  // y eso tarda bastante más que los tres intervalos que la web usa para dar
  // el worker por vivo. Resultado: el chip de la barra superior pasaba a "SOLO
  // ESCUCHA" cada vez que había una tarea corriendo, es decir, justo cuando el
  // worker estaba más ocupado, y volvía a "EN VIVO" al terminar.
  await heartbeat();
  const latido = setInterval(() => {
    heartbeat().catch((err) => console.error("[worker] latido falló:", err));
  }, POLL_INTERVAL_MS);

  try {
    while (!stopping) {
      if (ROLES.includes("tasks")) await tick();
      if (ROLES.includes("listening")) await listeningTick();
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  } finally {
    clearInterval(latido);
  }

  console.log("[worker] detenido");
  process.exit(0);
}

main().catch((err) => {
  console.error("[worker] error fatal:", err);
  process.exit(1);
});
