import { config } from "dotenv";
config({ path: ".env.local" });

import { hostname } from "os";
import { dbConnect } from "@/lib/mongodb";
import TaskModel from "@/lib/models/Task";
import WorkerHeartbeatModel, { type WorkerRole } from "@/lib/models/WorkerHeartbeat";
import ListeningProjectModel from "@/lib/models/ListeningProject";
import { runTask } from "@/lib/automation/runner";
import { motoresConfigurados, MOTORES_TOTALES } from "@/lib/motores";
import { leerMotoresDeseados } from "@/lib/workerSettings";
import { findDueProjects, ingestProject } from "@/lib/listening/ingest";
import { analyzeMentions } from "@/lib/listening/analyze";
import { generateNextBriefWindow } from "@/lib/listening/briefSchedule";

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5000);

/**
 * Cuántas tareas puede tener este worker en vuelo a la vez.
 *
 * Antes no había número: el bucle hacía `await tick()` y no volvía hasta que la
 * tarea terminaba, así que "de a una" era la forma del código y no una
 * decisión. Ahora cada motor es un bucle independiente que toma su propia tarea
 * de la misma cola de Mongo, que es la que evita que dos tomen la misma.
 *
 * El número NO es una constante: lo decide un admin desde Ajustes, vive en
 * Mongo y la supervisión lo relee cada vuelta. Era una variable de entorno, y
 * eso obligaba a entrar al VPS y reiniciar PM2 con `--update-env` para mover un
 * dígito, con el sistema parado mientras tanto.
 *
 * Ver src/lib/motores.ts para el tope y src/lib/workerSettings.ts para dónde
 * vive el valor.
 *
 * Esta de acá abajo es solo la semilla: el número con el que arranca si nadie
 * configuró nada todavía. `WORKER_ENGINES` sigue existiendo por eso —es el
 * arranque de una instalación nueva, no la palanca del día a día—, y como PM2
 * no relee el env en un `reload`, tampoco serviría de palanca.
 */
const MOTORES_SEMILLA = motoresConfigurados(process.env.WORKER_ENGINES);

/** A cuántos motores apunta el worker ahora. Cambia en caliente. */
let motoresDeseados = MOTORES_SEMILLA;

/** Los números de motor con un bucle vivo. Es lo que la sala pinta encendido. */
const motoresVivos = new Set<number>();

/** Los bucles en sí, para poder esperarlos al apagar el proceso. */
const motoresEnVuelo = new Set<Promise<void>>();

/**
 * Tope duro por tarea. Pasado esto, el worker se da por colgado y se mata.
 *
 * Veinte minutos porque un warmup largo es legítimamente lento: hasta 20
 * ciclos con la espera que haya elegido el usuario. El número no busca acertar
 * cuánto tarda una tarea, sino poner un techo donde antes no había ninguno.
 *
 * Se puede subir con `WORKER_TASK_TIMEOUT_MS` si alguna campaña lo pide.
 */
const TASK_TIMEOUT_MS = Number(process.env.WORKER_TASK_TIMEOUT_MS ?? 20 * 60 * 1000);

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

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function heartbeat() {
  // Un latido por rol activo: así la UI puede decir "la escucha corre pero la
  // automatización no" en vez de un sí/no que en dos máquinas sería mentira.
  for (const role of ROLES) {
    await WorkerHeartbeatModel.findByIdAndUpdate(
      role,
      // `engines` solo tiene sentido en el rol de tareas: es la capacidad que
      // la sala dibuja como motores encendidos. El de escucha no lo escribe
      // para no pisar con un 0 lo que informó el otro proceso.
      //
      // Van los dos números: `engines` es lo que hay vivo AHORA y `enginesTarget`
      // a lo que se apunta. Durante una bajada no coinciden —el motor de más
      // sigue vivo hasta terminar su tarea—, y con uno solo la sala tendría que
      // elegir entre mentir sobre lo que corre o sobre lo que se pidió.
      {
        $set: {
          pollIntervalMs: POLL_INTERVAL_MS,
          host: HOST,
          ...(role === "tasks"
            ? {
                engines: motoresVivos.size,
                engineIds: [...motoresVivos].sort((a, b) => a - b),
                enginesTarget: motoresDeseados,
              }
            : {}),
        },
      },
      { upsert: true },
    );
  }
}

/** Marca la señal de que el tope de tiempo ganó la carrera contra la tarea. */
class TareaColgada extends Error {}

/**
 * Corre la tarea con un tope de tiempo.
 *
 * `runTask` no tiene ningún límite propio y encadena esperas de red que
 * tampoco lo tenían: si alguna no vuelve, este `await` no vuelve nunca y la
 * cola entera se detiene detrás.
 */
async function ejecutarConTope(taskId: string) {
  const trabajo = runTask(taskId);

  // Si gana el tope, `trabajo` sigue viva y su rechazo posterior se quedaría
  // sin dueño: Node 22 mata el proceso por `unhandledRejection`. Este catch le
  // pone dueño sin tocar la carrera de abajo, que tiene el suyo.
  trabajo.catch(() => {});

  let temporizador: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      trabajo,
      new Promise<never>((_, reject) => {
        temporizador = setTimeout(
          () => reject(new TareaColgada(`Sin terminar tras ${Math.round(TASK_TIMEOUT_MS / 60_000)} min`)),
          TASK_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(temporizador);
  }
}

/**
 * Cierra como fallida una tarea que quedó tomada.
 *
 * Condicionado a que siga en "running": si `runTask` ya escribió su estado
 * definitivo, ese vale más que lo que sepamos desde acá.
 */
async function cerrarComoFallida(taskId: string, motivo: string) {
  await TaskModel.updateOne(
    { _id: taskId, status: "running" },
    { $set: { status: "failed", error: motivo, finishedAt: new Date() } },
  );
}

/**
 * Toma UNA tarea de la cola para este motor y la ejecuta.
 *
 * El `findOneAndUpdate` es lo que impide que dos motores se lleven la misma:
 * es atómico, así que el segundo ya la ve en "running" y sigue de largo.
 *
 * El perfil sí necesita cuidado aparte. Dos tareas del mismo perfil en dos
 * motores serían dos navegadores sobre el mismo perfil de AdsPower, que no lo
 * soporta: pelean por la misma sesión y las dos terminan mal. Por eso la cola
 * se filtra por los perfiles que ya están ocupados.
 */
async function tick(motor: number) {
  // Los perfiles que otro motor ya tiene tomados. Sale de las tareas en
  // "running", que es también de donde la sala lee qué está corriendo.
  const ocupados = await TaskModel.distinct("profileId", { status: "running" });

  const task = await TaskModel.findOneAndUpdate(
    { status: "queued", scheduledAt: { $lte: new Date() }, profileId: { $nin: ocupados } },
    // `startedAt` acá y no solo en `runTask`: entre tomarla y que el runner la
    // marque pasan segundos —abrir AdsPower no es instantáneo— y la sala
    // necesita desde cuándo corre para poner el cronómetro del motor.
    { $set: { status: "running", engine: motor, startedAt: new Date() } },
    { sort: { scheduledAt: 1 }, returnDocument: "after" },
  );

  if (!task) return;

  // El `distinct` de arriba y este `findOneAndUpdate` son dos viajes, y entre
  // uno y otro el otro motor pudo tomar una tarea del mismo perfil. Se
  // comprueba después de tomarla: si hay choque, esta vuelve a la cola. Que los
  // dos motores se echen atrás a la vez no rompe nada —la tarea queda "queued"
  // y alguien la toma en la vuelta siguiente—, y es preferible a abrir dos
  // navegadores sobre el mismo perfil.
  const choque = await TaskModel.exists({
    _id: { $ne: task._id },
    status: "running",
    profileId: task.profileId,
  });
  if (choque) {
    await TaskModel.updateOne(
      { _id: task._id, status: "running" },
      { $set: { status: "queued" }, $unset: { startedAt: 1, engine: 1 } },
    );
    return;
  }

  console.log(`[motor ${motor}] ejecutando tarea ${task._id} (${task.name})`);
  try {
    // runTask vuelve a marcar running/success/failed y escribe logs;
    // aquí solo evitamos que dos ticks tomen la misma tarea.
    await ejecutarConTope(String(task._id));
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    console.error(`[motor ${motor}] error en tarea ${task._id}:`, err);

    // `runTask` sabe marcar `failed`, pero solo desde su propio try, al que no
    // llega si revienta antes —un perfil borrado es el caso habitual—. Esos
    // errores salían por acá, se imprimían y nada más: `tick` ya había puesto
    // la tarea en "running" al tomarla, así que quedaba ahí para siempre, sin
    // error visible y sin contar como fallida en ningún lado.
    await cerrarComoFallida(String(task._id), motivo).catch((cerrarErr) =>
      console.error(`[motor ${motor}] no se pudo cerrar la tarea ${task._id}:`, cerrarErr),
    );

    if (err instanceof TareaColgada) {
      // Salir, y no seguir con la siguiente: la tarea abandonada sigue viva en
      // este proceso, con su conexión CDP a medias y el perfil de AdsPower
      // tomado. Un proceso nuevo cuesta dos segundos; adivinar qué quedó a
      // medio camino, mucho más. PM2 lo levanta por `autorestart`.
      //
      // Con varios motores esto también corta lo que estuvieran haciendo los
      // otros, y es a propósito: el navegador colgado no se suelta por partes,
      // y lo que estaba a mitad vuelve solo a la cola al arrancar (ver
      // `recuperarHuerfanas`).
      console.error(`[motor ${motor}] tarea colgada: me reinicio para soltar el navegador`);
      process.exit(1);
    }
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

/**
 * Devuelve al ruedo las tareas que quedaron en "running" sin nadie corriéndolas.
 *
 * `tick` marca la tarea como "running" al tomarla, así que todo lo que mate al
 * worker a mitad de camino —un `pm2 restart`, un reinicio del VPS, el suicidio
 * por tarea colgada de acá arriba— deja esa tarea marcada como si siguiera
 * ejecutándose. Nadie la vuelve a mirar: el worker solo levanta "queued". Antes
 * de esto había que relanzarlas a mano desde el modal de la campaña, sabiendo
 * primero que existían.
 *
 * Corre una sola vez, al arrancar, y solo con el rol de tareas encendido.
 */
async function recuperarHuerfanas() {
  // Si hay OTRO worker de tareas latiendo, las "running" son suyas y están de
  // verdad corriendo: devolverlas a la cola las haría ejecutarse dos veces.
  const otro = await WorkerHeartbeatModel.findById("tasks").lean();
  if (otro && otro.host !== HOST && Date.now() - new Date(otro.updatedAt).getTime() <= otro.pollIntervalMs * 3) {
    console.warn(`[worker] ${otro.host} ya está tomando tareas: no toco las huérfanas`);
    return;
  }

  const huerfanas = await TaskModel.find({ status: "running" }).select("campaignId").lean();
  if (huerfanas.length === 0) return;

  // Una campaña pausada mientras una de sus tareas corría queda con el resto en
  // "paused" y esa sola en "running" (pausar no interrumpe un browser a media
  // acción, a propósito). Mandarla a la cola reanudaría sola una campaña que el
  // usuario detuvo, así que vuelve a la pausa con el resto.
  const campañas = huerfanas.map((t) => t.campaignId).filter(Boolean);
  const pausadas = new Set(
    (await TaskModel.distinct("campaignId", { campaignId: { $in: campañas }, status: "paused" })).map(String),
  );
  const enPausa = (t: (typeof huerfanas)[number]) => Boolean(t.campaignId) && pausadas.has(String(t.campaignId));

  const aEncolar = huerfanas.filter((t) => !enPausa(t)).map((t) => t._id);
  const aPausar = huerfanas.filter(enPausa).map((t) => t._id);

  // El `engine` se borra junto con `startedAt`: es de la corrida que se perdió,
  // y dejarlo puesto pintaría esa tarea en un motor que ya no la tiene.
  if (aEncolar.length > 0) {
    await TaskModel.updateMany(
      { _id: { $in: aEncolar } },
      { $set: { status: "queued" }, $unset: { startedAt: 1, engine: 1 } },
    );
  }
  if (aPausar.length > 0) {
    await TaskModel.updateMany(
      { _id: { $in: aPausar } },
      { $set: { status: "paused", resumeStatus: "queued" }, $unset: { startedAt: 1, engine: 1 } },
    );
  }

  console.log(
    `[worker] ${aEncolar.length} tareas huérfanas devueltas a la cola` +
      (aPausar.length > 0 ? ` y ${aPausar.length} a su campaña pausada` : ""),
  );
}

/**
 * Un motor: pide trabajo, lo hace, vuelve a pedir.
 *
 * Los motores arrancan escalonados dentro del intervalo de poll para no
 * consultar la cola todos en el mismo instante. No es lo que evita que se pisen
 * —de eso se encarga `tick`—, sino que reparte los arranques de AdsPower, que
 * es lo caro: varios navegadores abriéndose a la vez sobre la pantalla virtual
 * del VPS es justo el pico que conviene no provocar. El escalón se reparte
 * sobre `MOTORES_TOTALES` y no sobre los que haya encendidos para que el turno
 * de cada motor no se mueva cada vez que alguien cambia el número.
 *
 * La condición del `while` es la otra mitad de poder subir y bajar en caliente:
 * un motor que sobra respecto del objetivo se apaga acá, al cerrar su vuelta.
 * Nunca en medio de una tarea, y esa es toda la razón de que una bajada no sea
 * instantánea: matar el bucle con el navegador abierto dejaría el perfil de
 * AdsPower tomado y la tarea en "running" sin nadie detrás.
 */
async function bucleDeMotor(motor: number) {
  await esperar(Math.round(((motor - 1) * POLL_INTERVAL_MS) / MOTORES_TOTALES));

  while (!stopping && motor <= motoresDeseados) {
    try {
      await tick(motor);
    } catch (err) {
      // Un error acá es de la cola misma (Mongo caído, por ejemplo), no de la
      // tarea: los de la tarea ya los atrapa `tick`. Se registra y este motor
      // reintenta en la vuelta siguiente, en vez de tirar abajo a los demás.
      console.error(`[motor ${motor}] error al tomar trabajo:`, err);
    }
    await esperar(POLL_INTERVAL_MS);
  }

  console.log(`[motor ${motor}] apagado`);
}

/**
 * Relee a cuántos motores hay que apuntar.
 *
 * Si Mongo no contesta se queda con el número que ya tenía: un corte de base no
 * puede cambiar la capacidad del worker por su cuenta, y menos hacia abajo.
 */
async function refrescarObjetivo() {
  try {
    const { engines } = await leerMotoresDeseados(MOTORES_SEMILLA);
    if (engines === motoresDeseados) return;

    console.log(`[worker] motores: ${motoresDeseados} → ${engines}`);
    motoresDeseados = engines;
  } catch (err) {
    console.error(`[worker] no pude leer el número de motores, sigo con ${motoresDeseados}:`, err);
  }
}

/**
 * Enciende los motores que falten para llegar al objetivo.
 *
 * Solo enciende. Apagar no se hace desde acá porque sería cortar la tarea que
 * el motor tenga adentro; de eso se encarga cada bucle al terminar su vuelta.
 * Es idempotente, así que la supervisión la puede llamar en cada pasada sin
 * llevar ninguna cuenta aparte.
 */
function asegurarMotores() {
  if (stopping) return;

  for (let motor = 1; motor <= motoresDeseados; motor++) {
    if (motoresVivos.has(motor)) continue;

    // El alta en el Set es síncrona y va ANTES de que el bucle llegue a su
    // primer await: el latido puede caer justo en el medio, y este motor ya
    // está comprometido aunque todavía no haya pedido trabajo.
    motoresVivos.add(motor);
    console.log(`[motor ${motor}] encendido`);

    const bucle = bucleDeMotor(motor)
      // `bucleDeMotor` ya atrapa lo suyo, pero si alguna vez dejara escapar
      // algo, un rechazo acá se llevaría puesto el `Promise.all` del apagado.
      .catch((err) => console.error(`[motor ${motor}] murió:`, err))
      .finally(() => {
        motoresVivos.delete(motor);
        motoresEnVuelo.delete(bucle);
      });

    motoresEnVuelo.add(bucle);
  }
}

/**
 * La supervisión: relee el objetivo y enciende lo que falte.
 *
 * Va en su propio bucle y no dentro de un motor porque tiene que seguir
 * corriendo justo cuando todos los motores están ocupados, que es exactamente
 * cuando a alguien se le ocurre subir el número.
 */
async function bucleDeSupervision() {
  while (!stopping) {
    await refrescarObjetivo();
    asegurarMotores();
    await esperar(POLL_INTERVAL_MS);
  }
}

/** La escucha, en su propio bucle: no comparte ritmo con los motores. */
async function bucleDeEscucha() {
  while (!stopping) {
    try {
      await listeningTick();
    } catch (err) {
      console.error("[escucha] error en la pasada:", err);
    }
    await esperar(POLL_INTERVAL_MS);
  }
}

async function main() {
  if (ROLES.length === 0) {
    console.error("[worker] WORKER_TASKS y WORKER_LISTENING están los dos apagados: no hay nada que hacer");
    process.exit(1);
  }

  await dbConnect();

  // El objetivo se lee ANTES de anunciar nada: la línea de arranque es lo
  // primero que se mira en `pm2 logs`, y decir ahí un número que no es el que
  // se va a usar manda a buscar el problema al lado equivocado.
  if (ROLES.includes("tasks")) await refrescarObjetivo();

  console.log(
    `[worker] ${HOST} · roles: ${ROLES.join(" + ")} · poll cada ${POLL_INTERVAL_MS}ms` +
      (ROLES.includes("tasks") ? ` · ${motoresDeseados} motor${motoresDeseados === 1 ? "" : "es"}` : ""),
  );

  // Antes del primer latido: `recuperarHuerfanas` mira el latido de "tasks"
  // para no pisar a otro worker, y si ya escribimos el nuestro estaríamos
  // comparándonos contra nosotros mismos.
  if (ROLES.includes("tasks")) {
    await recuperarHuerfanas().catch((err) =>
      console.error("[worker] no se pudieron recuperar las tareas huérfanas:", err),
    );

    // Los motores nacen también antes del primer latido. `asegurarMotores` los
    // cuenta de inmediato, así que la sala no llega a ver un "0 de 5 activos"
    // que duraría un segundo y parecería un worker roto.
    asegurarMotores();
  }

  // El latido va en su propio temporizador, no dentro del bucle de trabajo.
  //
  // Latir una vez por vuelta parecía suficiente, pero un motor ejecuta una
  // tarea entera —abrir el navegador en AdsPower, navegar, publicar, cerrar—,
  // y eso tarda bastante más que los tres intervalos que la web usa para dar
  // el worker por vivo. Resultado: el chip de la barra superior pasaba a "SOLO
  // ESCUCHA" cada vez que había una tarea corriendo, es decir, justo cuando el
  // worker estaba más ocupado, y volvía a "EN VIVO" al terminar.
  await heartbeat();
  const latido = setInterval(() => {
    heartbeat().catch((err) => console.error("[worker] latido falló:", err));
  }, POLL_INTERVAL_MS);

  // Un bucle por motor más el de la escucha, todos en paralelo sobre el mismo
  // proceso. Son esperas de E/S casi todo el tiempo, así que el único hilo de
  // Node alcanza: lo que antes bloqueaba la cola no era la CPU sino el `await`.
  //
  // Los motores no se esperan acá: nacen y mueren durante toda la vida del
  // proceso, así que quien los espera es el drenaje del final.
  const fondo: Promise<void>[] = [];
  if (ROLES.includes("tasks")) fondo.push(bucleDeSupervision());
  if (ROLES.includes("listening")) fondo.push(bucleDeEscucha());

  try {
    await Promise.all(fondo);

    // Con `stopping` puesto ya no nace ninguno, pero el que tenga una tarea
    // adentro no vuelve hasta terminarla. Se los espera para no matar el
    // proceso con un navegador a medio cerrar, que es justo lo que deja el
    // perfil tomado y la tarea huérfana. `kill_timeout` en PM2 es de 30s y le
    // pone el techo a esta espera.
    while (motoresEnVuelo.size > 0) await Promise.all([...motoresEnVuelo]);
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
