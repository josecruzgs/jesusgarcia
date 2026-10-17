"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Gauge, Lock } from "lucide-react";
import { MOTORES_TOTALES } from "@/lib/motores";

type MotorTask = {
  id: string;
  name: string;
  type: string;
  profile: string | null;
  campaignId: string | null;
  startedAt: string | null;
  visible: boolean;
};

type Motor = { engine: number; active: boolean; task: MotorTask | null };

type Respuesta = {
  online?: boolean;
  engines?: { total: number; active: number; target?: number | null; slots: Motor[] };
};

/** Cada cuánto se le pregunta al servidor qué hay en los motores. */
const POLL_MS = 4000;

/** Segmentos de la barra. Catorce entran cómodos en una tarjeta de un quinto. */
const SEGMENTOS = 14;

const TYPE_LABELS: Record<string, string> = {
  like: "Like",
  likecomment: "Like a comentario",
  comment: "Comentario",
  post: "Publicación",
  warmup: "Warmup",
  scrape: "Scrape",
  login: "Login",
  ramificacion: "Ramificación",
  joingroup: "Unirse a grupo",
  follow: "Seguir perfil",
  custom: "Personalizada",
};

/**
 * Cronómetro de la tarea, en el formato corto del reloj: segundos hasta el
 * minuto, y de ahí `m:ss`. Se recalcula solo, sin esperar al siguiente poll:
 * un número que salta de 4 en 4 segundos se lee como un dato viejo.
 */
function useTranscurrido(desde: string | null): string | null {
  const [ahora, setAhora] = useState(() => Date.now());

  useEffect(() => {
    if (!desde) return;
    const id = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [desde]);

  if (!desde) return null;
  const seg = Math.max(0, Math.floor((ahora - new Date(desde).getTime()) / 1000));
  if (seg < 60) return `${seg}s`;
  const min = Math.floor(seg / 60);
  if (min < 60) return `${min}:${String(seg % 60).padStart(2, "0")}`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

/**
 * Qué se lee debajo del tipo de tarea: el perfil que la está corriendo.
 *
 * El `name` de la tarea ya viene armado como "tipo · perfil", así que ponerlo
 * junto a la etiqueta y al perfil repetía las dos cosas ("COMENTARIO comment ·
 * Ignacia · Ignacia"). El perfil manda cuando está; el nombre solo aparece si
 * no hay perfil que mostrar, y sin el prefijo del tipo, que ya está arriba.
 */
function detalleDe(task: MotorTask): string {
  if (task.profile) return task.profile;
  const prefijo = `${task.type} · `;
  return task.name.startsWith(prefijo) ? task.name.slice(prefijo.length) : task.name;
}

/**
 * Una ranura del worker.
 *
 * Los tres estados son distintos a propósito: apagado (el worker no lo
 * encendió), libre (encendido y esperando trabajo) y activo (con una tarea
 * adentro). Sin el primero, subir el número sería una sorpresa; con él, la
 * pantalla ya muestra a dónde puede crecer el sistema.
 */
function Ranura({ motor }: { motor: Motor }) {
  const task = motor.task;
  const corriendo = Boolean(task);
  const transcurrido = useTranscurrido(task?.startedAt ?? null);

  const estado = corriendo ? "motor-activo" : motor.active ? "motor-libre" : "motor-apagado";

  const etiqueta = task
    ? (TYPE_LABELS[task.type] ?? task.type)
    : motor.active
      ? "En espera"
      : "No disponible";

  // En cinco columnas el texto es angosto, así que el detalle va corto y el
  // largo queda en el `title` para quien pase el mouse.
  const detalle = task ? detalleDe(task) : motor.active ? "Sin tarea" : "Capacidad futura";
  const completo = task
    ? detalle
    : motor.active
      ? "Encendido, listo para tomar la siguiente tarea de la cola"
      : "Se enciende subiendo los motores en Ajustes (solo admin)";

  const cuerpo = (
    <div className={`motor-fila ${estado} flex h-full flex-col gap-2 px-3 py-2.5`}>
      <div className="flex items-center justify-between gap-2">
        {/* Número del motor. Es la identidad de la ranura: la misma tarea se ve
            en el mismo hueco mientras dure. */}
        <span
          className="grid h-6 w-6 shrink-0 place-items-center rounded-lg border border-hairline font-mono text-[11px] font-semibold tabular-nums"
          style={{
            color: corriendo ? "var(--primary)" : "var(--text-muted, inherit)",
            borderColor: corriendo ? "color-mix(in srgb, var(--primary) 40%, transparent)" : undefined,
            opacity: motor.active ? 1 : 0.45,
          }}
        >
          {motor.active ? motor.engine : <Lock className="h-3 w-3" aria-hidden />}
        </span>
        {/* El cronómetro ocupa lugar siempre, aunque esté vacío: si apareciera
            y desapareciera, la tarjeta cambiaría de alto en cada arranque y
            cada final de tarea. */}
        <span
          className="shrink-0 font-mono text-[13px] tabular-nums"
          style={{ color: corriendo ? "var(--primary)" : "transparent" }}
        >
          {transcurrido ?? "—"}
        </span>
      </div>

      <div className="min-w-0 flex-1" title={completo}>
        <p className="label-mono-sm truncate" style={{ opacity: motor.active ? 1 : 0.6 }}>
          {etiqueta}
        </p>
        <p
          className={`truncate text-[12.5px] ${corriendo ? "font-medium text-ink" : "text-ink-muted"}`}
          style={{ opacity: motor.active ? 1 : 0.6 }}
        >
          {detalle}
        </p>
      </div>

      <div className={`motor-barra ${estado}`} aria-hidden>
        {Array.from({ length: SEGMENTOS }, (_, i) => (
          <span
            key={i}
            className="motor-seg"
            // El desfase por índice es lo que hace la onda. 55ms sobre catorce
            // segmentos da algo menos de un segundo de recorrido, por debajo
            // del ciclo de la animación: la onda entra antes de reiniciarse.
            style={corriendo ? { ["--d" as string]: `${i * 55}ms` } : undefined}
          />
        ))}
      </div>
    </div>
  );

  // Solo se puede ir a la campaña si es del que mira; la de otro operador no
  // existe para él y el link daría un 404 o, peor, una pantalla vacía.
  return task?.campaignId ? (
    <Link href={`/campanas?campaignId=${task.campaignId}`} className="block h-full">
      {cuerpo}
    </Link>
  ) : (
    cuerpo
  );
}

/**
 * Los motores del worker: cuántas tareas puede correr a la vez y qué hay en
 * cada una ahora mismo.
 *
 * Vive arriba de /campanas porque es la respuesta a la pregunta que se hace
 * mirando esa pantalla —"¿por qué esto no avanza más rápido?"—: con los motores
 * a la vista se ve si el sistema está saturado o simplemente ocioso.
 */
export default function Motores() {
  const [data, setData] = useState<Respuesta | null>(null);

  useEffect(() => {
    let cancelado = false;

    async function traer() {
      try {
        const res = await fetch("/api/worker/status");
        if (!res.ok) return;
        const json = (await res.json()) as Respuesta;
        if (!cancelado) setData(json);
      } catch {
        // Un poll que falla no borra lo que ya se veía: dejar la pantalla en
        // blanco por un corte de red de dos segundos es peor que un dato con
        // cuatro segundos de atraso.
      }
    }

    traer();
    const id = setInterval(traer, POLL_MS);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
  }, []);

  // Mientras no llegó la primera respuesta se dibujan las ranuras apagadas, no
  // un hueco: el alto del panel no cambia cuando entra el dato.
  const slots: Motor[] =
    data?.engines?.slots ??
    Array.from({ length: MOTORES_TOTALES }, (_, i) => ({ engine: i + 1, active: false, task: null }));

  const total = data?.engines?.total ?? MOTORES_TOTALES;
  const activos = data?.engines?.active ?? 0;
  const ocupados = slots.filter((m) => m.task).length;
  const online = data?.online ?? false;

  // El objetivo solo se nombra cuando NO coincide con lo encendido, que es
  // mientras el cambio se está cumpliendo. Una bajada no es inmediata —el motor
  // de más termina su tarea antes de apagarse— y sin esta línea el número que
  // se acaba de guardar en Ajustes parecería no haberse guardado.
  const objetivo = data?.engines?.target ?? null;
  const enTransicion = online && objetivo !== null && objetivo !== activos;

  return (
    <section
      className="card-surface px-4.5 py-4"
      style={{ ["--edge-c" as string]: "var(--primary)" }}
    >
      <header className="panel-head">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid shrink-0 place-items-center" style={{ color: "var(--primary)" }}>
            <Gauge className="h-4 w-4" aria-hidden />
          </span>
          <span className="panel-title">Motores</span>
          <span className="panel-tag">
            {activos} de {total} activos
          </span>
          {enTransicion && (
            <span
              className="label-mono-sm truncate"
              style={{ color: "var(--primary)" }}
              title={
                objetivo! < activos
                  ? "Se pidieron menos motores. Los de más se apagan al terminar la tarea que tienen adentro: cortarlos dejaría el navegador a medio cerrar."
                  : "Se pidieron más motores. El worker los enciende en los próximos segundos."
              }
            >
              {objetivo! < activos ? `bajando a ${objetivo}` : `subiendo a ${objetivo}`}
            </span>
          )}
        </div>
        <div className="shrink-0">
          <span className="label-mono-sm">
            {!online
              ? "worker sin latido"
              : ocupados === 0
                ? "sin tareas en curso"
                : `${ocupados} en ejecución`}
          </span>
        </div>
      </header>

      {/* Los cinco en una sola línea: son ranuras de la misma máquina y se leen
          de un vistazo como una fila de instrumentos, no como una lista. En
          pantallas angostas bajan a dos columnas y después a una, que es lo
          único que entra sin que el nombre del perfil quede en tres letras. */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {slots.map((motor) => (
          <Ranura key={motor.engine} motor={motor} />
        ))}
      </div>
    </section>
  );
}
