"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Droplets,
  Wind,
  Mountain,
  Flame,
  Users,
  FolderKanban,
  UserCog,
  Activity,
  ListChecks,
  type LucideIcon,
} from "lucide-react";
import RouteLoading from "./RouteLoading";

type Config = { icon: LucideIcon; accent: string };

const DEFAULT_CONFIG: Config = { icon: LayoutDashboard, accent: "var(--gold)" };

// Mismos íconos/colores que cada loading.tsx de ruta (ver src/app/*/loading.tsx).
// Este overlay es el que realmente se percibe: la navegación entre rutas ya
// prefetcheadas es casi instantánea, así que el fallback de Suspense de Next
// casi nunca alcanza a mostrarse. Este componente fuerza que la animación
// dure lo suficiente para notarse en cada cambio de página.
const ROUTE_CONFIG: { prefix: string; config: Config }[] = [
  { prefix: "/campanas", config: { icon: ListChecks, accent: "var(--el-agua)" } },
  { prefix: "/tasks/warmup", config: { icon: Activity, accent: "var(--gold)" } },
  { prefix: "/tasks", config: { icon: Droplets, accent: "var(--el-agua)" } },
  { prefix: "/scrapping", config: { icon: Wind, accent: "var(--el-viento)" } },
  { prefix: "/actividades", config: { icon: Mountain, accent: "var(--el-tierra)" } },
  { prefix: "/dia-d", config: { icon: Flame, accent: "var(--el-fuego)" } },
  { prefix: "/profiles/auto-profile", config: { icon: UserCog, accent: "var(--gold)" } },
  { prefix: "/profiles", config: { icon: Users, accent: "var(--gold)" } },
  { prefix: "/groups", config: { icon: FolderKanban, accent: "var(--gold)" } },
];

// Match de prefijo más largo (no el primero que matchee): así una ruta más
// específica como /tasks/warmup no cae en la config genérica de /tasks.
function configFor(pathname: string): Config {
  let best: { prefix: string; config: Config } | null = null;
  for (const entry of ROUTE_CONFIG) {
    const matches = pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`);
    if (matches && (!best || entry.prefix.length > best.prefix.length)) best = entry;
  }
  return best?.config ?? DEFAULT_CONFIG;
}

const HOLD_MS = 500;
const FADE_MS = 200;

export default function RouteTransitionOverlay() {
  const pathname = usePathname();
  const [phase, setPhase] = useState<"idle" | "visible" | "leaving">("idle");
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setConfig(configFor(pathname));
    setPhase("visible");
    const holdTimer = setTimeout(() => setPhase("leaving"), HOLD_MS);
    const hideTimer = setTimeout(() => setPhase("idle"), HOLD_MS + FADE_MS);
    return () => {
      clearTimeout(holdTimer);
      clearTimeout(hideTimer);
    };
  }, [pathname]);

  if (phase === "idle") return null;

  return (
    <div
      className={`absolute inset-0 z-20 flex items-center justify-center bg-page/35 backdrop-blur-[2px] transition-opacity duration-200 ${
        phase === "leaving" ? "opacity-0" : "opacity-100"
      }`}
    >
      <RouteLoading icon={config.icon} accent={config.accent} />
    </div>
  );
}
