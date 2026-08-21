"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, MonitorPlay } from "lucide-react";
import ThemeToggle from "./ThemeToggle";
import ElementIcon from "./ui/ElementIcon";
import { getElementForPath, ELEMENT_META } from "@/lib/elements";
import { useSession } from "@/lib/session";
import { findCity } from "@/lib/timezones";

type RoleStatus = { online: boolean; host?: string | null };
type Status = { online: boolean; roles?: { tasks: RoleStatus; listening: RoleStatus } } | null;

const POLL_MS = 10000;

/**
 * Los dos workers pueden vivir en máquinas distintas —la automatización donde
 * está AdsPower, la escucha en el VPS— así que el chip tiene tres estados. Uno
 * solo diría "SIN WORKER" con la escucha funcionando perfectamente.
 */
function workerChip(status: NonNullable<Status>) {
  const tasks = status.roles?.tasks.online ?? status.online;
  const listening = status.roles?.listening.online ?? status.online;

  if (tasks && listening) {
    return { label: "EN VIVO", off: false, title: "Automatización y escucha corriendo" };
  }
  if (listening) {
    return {
      label: "SOLO ESCUCHA",
      off: true,
      title: "La escucha ingiere sola, pero no hay worker de automatización: las tareas en cola no avanzarán",
    };
  }
  if (tasks) {
    return {
      label: "SOLO TAREAS",
      off: true,
      title: "La automatización corre, pero nadie está ingiriendo menciones: la escucha solo avanzará con «Buscar ahora»",
    };
  }
  return { label: "SIN WORKER", off: true, title: "No hay ningún worker corriendo" };
}

/**
 * Reloj de sala: hora y minutos en la ciudad que eligió el usuario.
 *
 * La zona sale de la preferencia y no del reloj de la máquina: el VPS corre en
 * UTC y quien mira el panel puede estar en Tijuana o en Hermosillo, que en
 * invierno no marcan la misma hora. Mostrar la ciudad al lado es lo que hace
 * que la cifra se pueda confrontar con el reloj de pared de cada quien.
 *
 * Sin segundos: son ruido en una barra que se mira de reojo, y además
 * obligaban a repintar sesenta veces más seguido.
 */
function useClock(timeZone: string) {
  const [now, setNow] = useState<string | null>(null);

  useEffect(() => {
    const paint = () =>
      setNow(new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }));
    paint();
    // Cada 15s y no cada minuto: alcanza para que el cambio de minuto se note
    // enseguida sin tener que sincronizarse con el segundo cero.
    const id = setInterval(paint, 15000);
    return () => clearInterval(id);
  }, [timeZone]);

  // null hasta que hidrata: la hora del servidor y la del cliente no
  // coinciden nunca, así que pintarla en SSR sería un error de hidratación.
  return now;
}

export default function Topbar() {
  const [status, setStatus] = useState<Status>(null);
  const pathname = usePathname();
  const session = useSession();
  const city = findCity(session?.preferences.city);
  const clock = useClock(city.timeZone);
  const brandTitle = session?.preferences.brandTitle?.trim() || "Jesús García";
  const avatar = session?.preferences.avatar || "";

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    // Recarga completa y no router.push: hay estado de cliente con datos del
    // usuario saliente que no debe sobrevivir al cambio de sesión.
    window.location.href = "/login";
  }

  const element = getElementForPath(pathname ?? "");
  const meta = element ? ELEMENT_META[element] : null;

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/worker/status");
        const data = await res.json();
        if (!cancelled) setStatus(data);
      } catch {
        if (!cancelled) setStatus({ online: false });
      }
    }

    check();
    const interval = setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <header className="app-bar sticky top-0 z-10 flex flex-wrap items-center gap-3 px-6 py-3">
      {/* Marca del elemento en curso: cuadro relleno + nombre + rol, igual
          que el encabezado de vista de la sala. Los cuatro elementos y las
          páginas generales comparten el acento, así que el cuadro se pinta
          con --primary y su tinta legible. */}
      <div key={element ?? "general"} className="animate-rise flex min-w-0 items-center gap-2.5">
        <span className="accent-fill grid h-8 w-8 shrink-0 place-items-center rounded border">
          <ElementIcon name={element ?? "eye"} size={16} />
        </span>
        <div className="min-w-0">
          {/* En un módulo manda el nombre del elemento; fuera de ellos, la
              marca que el usuario haya puesto en Ajustes. */}
          <p className="font-display truncate text-[15px] font-semibold leading-tight text-ink">
            {meta?.name ?? brandTitle}
          </p>
          <p className="label-mono-sm truncate">{meta?.title ?? "Sala de inteligencia"}</p>
        </div>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2.5">
        <span className="classchip">USO INTERNO</span>

        {clock && (
          <span
            title={`Hora en ${city.label}, ${city.state} · se cambia en Ajustes`}
            className="hidden font-mono text-[11px] tabular-nums text-ink-secondary sm:inline"
          >
            <span className="text-ink-muted">{city.label.toUpperCase()}</span> {clock}
          </span>
        )}

        {status && (
          <span title={workerChip(status).title} className={`opchip ${workerChip(status).off ? "is-off" : ""}`}>
            <i />
            {workerChip(status).label}
          </span>
        )}

        {/* Pantalla del servidor: el escritorio del VPS con AdsPower
            trabajando. Solo admin —ahí adentro está la sesión de AdsPower con
            todos los perfiles— y en pestaña aparte, que es como se mira algo
            que corre mientras uno sigue usando el panel. */}
        {session?.role === "admin" && (
          <a
            href="/pantalla"
            target="_blank"
            rel="noopener noreferrer"
            title="Pantalla del servidor · ver AdsPower en vivo"
            aria-label="Pantalla del servidor"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface text-ink-secondary transition-colors hover:text-ink"
          >
            <MonitorPlay className="h-4 w-4" />
          </a>
        )}

        <ThemeToggle />

        {session && (
          <div className="flex items-center gap-1.5 border-l border-hairline pl-2.5">
            <Link
              href="/ajustes"
              title={`${session.role === "admin" ? "Administrador" : "Operador"} · ir a Ajustes`}
              className="flex items-center gap-1.5 rounded-full px-1 py-0.5 transition-colors hover:bg-page"
            >
              {avatar && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatar} alt="" className="h-5 w-5 rounded-full object-cover" />
              )}
              <span className="max-w-40 truncate font-mono text-[11px] text-ink-secondary">
                {session.username}
                {session.role === "admin" && <span className="ml-1 text-steel">·admin</span>}
              </span>
            </Link>
            <button
              type="button"
              onClick={logout}
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
              className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-page hover:text-ink"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
