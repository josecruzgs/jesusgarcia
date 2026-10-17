"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Gauge, TriangleAlert } from "lucide-react";
import { apiFetch } from "@/lib/api";
import Card from "@/components/Card";
import { MOTORES_TOTALES } from "@/lib/motores";

/**
 * El control de cuántas tareas corre el worker a la vez.
 *
 * Vive en Ajustes pero no es un ajuste personal como el resto de esa pantalla:
 * es la capacidad de la máquina y lo que se elija acá lo sienten todos los
 * operadores. Por eso solo lo ve el admin y por eso la tarjeta lo dice en el
 * encabezado en vez de confiar en que se deduzca.
 *
 * Antes este número era `WORKER_ENGINES` en el ecosystem de PM2: cambiarlo
 * pedía SSH al VPS, editar un archivo y reiniciar el proceso con
 * `--update-env`, lo que además cortaba las tareas que estuvieran corriendo.
 */

type Estado = {
  engines: number;
  total: number;
  configurado: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  worker: {
    online: boolean;
    engines: number | null;
    target: number | null;
    host: string | null;
    lastSeenAt: string | null;
  };
};

/**
 * Cada cuánto se vuelve a preguntar por el worker.
 *
 * Es lo que hace visible el efecto del cambio sin tener que recargar: al bajar
 * el número, los motores de más siguen encendidos hasta terminar su tarea, y
 * este poll es lo que va contando la bajada hasta que se cumple.
 */
const POLL_MS = 5000;

export default function MotoresAdmin() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [guardando, setGuardando] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Si alguna vez llegó una respuesta. Ver el catch de `traer`. */
  const cargado = useRef(false);

  /** Lo mismo que `guardando`, pero legible desde el poll, que no se re-crea. */
  const guardandoRef = useRef(false);

  const traer = useCallback(async () => {
    // Un poll que caiga en medio de un guardado traería el número viejo y lo
    // pisaría encima del recién elegido: el botón saltaría para atrás y se
    // quedaría así hasta la vuelta siguiente.
    if (guardandoRef.current) return;

    try {
      setEstado(await apiFetch<Estado>("/api/worker/engines"));
      cargado.current = true;
    } catch (err) {
      // Un poll que falla no pisa lo que ya se veía ni el error de un guardado:
      // el número en pantalla sigue siendo válido, y un cartel rojo cada vez que
      // parpadea la red asusta más de lo que informa. Solo habla si todavía no
      // llegó nada, que ahí el silencio dejaría la tarjeta consultando para
      // siempre.
      if (!cargado.current) setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    traer();
    const id = setInterval(traer, POLL_MS);
    return () => clearInterval(id);
  }, [traer]);

  async function elegir(engines: number) {
    if (!estado || engines === estado.engines || guardando !== null) return;

    guardandoRef.current = true;
    setGuardando(engines);
    setError(null);
    try {
      setEstado(
        await apiFetch<Estado>("/api/worker/engines", {
          method: "PUT",
          body: JSON.stringify({ engines }),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      guardandoRef.current = false;
      setGuardando(null);
    }
  }

  const total = estado?.total ?? MOTORES_TOTALES;
  const elegido = estado?.engines ?? null;
  const vivos = estado?.worker.engines ?? null;
  const online = estado?.worker.online ?? false;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid shrink-0 place-items-center" style={{ color: "var(--primary)" }}>
          <Gauge className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold text-ink">Motores del worker</h2>
          <p className="mt-1 text-[13px] text-ink-secondary">
            Cuántas tareas corre el sistema al mismo tiempo. Es de la máquina, no tuyo: lo que elijas
            acá lo sienten todas las campañas, las de todos los operadores.
          </p>
        </div>
      </div>

      {error && <p className="rounded-xl bg-critical/10 p-3 text-sm text-critical">{error}</p>}

      {/* Los cinco botones, igual que las cinco ranuras de la sala: el número
          que se elige acá es el mismo hueco que allá se ve encenderse. */}
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
          const activo = n === elegido;
          return (
            <button
              key={n}
              type="button"
              onClick={() => elegir(n)}
              disabled={estado === null || guardando !== null}
              aria-pressed={activo}
              className={`h-11 w-11 rounded-xl border font-mono text-sm font-semibold tabular-nums transition-all duration-200 disabled:opacity-50 ${
                activo
                  ? "border-transparent bg-primary text-primary-fg shadow-sm"
                  : "border-hairline bg-surface text-ink-secondary hover:-translate-y-0.5 hover:bg-page hover:text-ink"
              }`}
            >
              {guardando === n ? "…" : n}
            </button>
          );
        })}
      </div>

      <EstadoDelWorker estado={estado} online={online} elegido={elegido} vivos={vivos} />

      {elegido !== null && elegido >= 4 && (
        <p className="flex items-start gap-2 rounded-xl bg-warning/10 p-3 text-[13px] text-ink-secondary">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <span>
            Cada motor abre su propio navegador en AdsPower: son unos 400 MB de RAM y, sobre todo,
            caché en disco, que es lo que llenó el disco del VPS el 28/8 y el 3/9. Subí de a uno y
            mirá cómo queda la máquina antes de seguir.
          </span>
        </p>
      )}
    </Card>
  );
}

/**
 * La línea que dice qué hizo el worker con el número.
 *
 * Es la mitad que falta del control: guardar un 2 y seguir viendo tres motores
 * encendidos en la sala parece que no se guardó, y la explicación —el motor de
 * más termina lo que tiene antes de apagarse— no se deduce de ningún lado.
 */
function EstadoDelWorker({
  estado,
  online,
  elegido,
  vivos,
}: {
  estado: Estado | null;
  online: boolean;
  elegido: number | null;
  vivos: number | null;
}) {
  if (!estado) return <p className="label-mono-sm">consultando al worker…</p>;

  if (!online) {
    return (
      <p className="text-[13px] text-ink-secondary">
        <span className="text-warning">El worker de tareas no está latiendo.</span> El número queda
        guardado igual y lo toma en cuanto arranque.
      </p>
    );
  }

  const detalle =
    vivos === null || elegido === null || vivos === elegido ? (
      <>
        El worker tiene <strong className="font-semibold text-ink">{vivos ?? elegido}</strong>{" "}
        encendido{(vivos ?? elegido) === 1 ? "" : "s"}.
      </>
    ) : vivos > elegido ? (
      <>
        Bajando: quedan <strong className="font-semibold text-ink">{vivos}</strong> encendidos hasta
        que terminen las tareas que tienen adentro. Apagar un motor a la fuerza cortaría el navegador
        a mitad de camino, así que se espera.
      </>
    ) : (
      <>
        Subiendo: el worker enciende los que faltan en los próximos segundos.
      </>
    );

  return (
    <div className="flex flex-col gap-1">
      <p className="text-[13px] text-ink-secondary">{detalle}</p>
      <p className="label-mono-sm">
        {estado.worker.host ?? "worker"}
        {estado.configurado && estado.updatedBy ? ` · último cambio: ${estado.updatedBy}` : " · sin configurar, valor de arranque"}
      </p>
    </div>
  );
}
