"use client";

import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import RouteTransitionOverlay from "@/components/RouteTransitionOverlay";
import Splash from "@/components/ui/Splash";

// Rutas sin sidebar/topbar internos: /share/[token] es la vista pública de
// un dashboard de campañas, y /login es la pantalla de contraseña del gate
// (ver src/middleware.ts) — ninguna de las dos debe verse como el panel
// interno. /pantalla se suma por otro motivo: es el escritorio del VPS abierto
// en su propia pestaña, y el visor quiere el alto entero, sin menú al lado.
const BARE_PREFIXES = ["/share/", "/login", "/pantalla"];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isBareRoute = BARE_PREFIXES.some((prefix) => pathname?.startsWith(prefix));

  if (isBareRoute) {
    // flex-1 es necesario: <body> es un contenedor flex (fila), así que sin
    // esto <main> se encoge a su contenido en vez de ocupar el ancho
    // disponible, y el mx-auto de adentro no tiene espacio para centrar.
    // h-screen + overflow-y-auto es necesario porque <body> tiene
    // overflow-hidden (layout.tsx): sin un contenedor con altura acotada que
    // scrollee internamente, cualquier contenido más alto que el viewport
    // queda cortado sin forma de hacer scroll (el bug reportado en celulares).
    return <main className="relative h-screen flex-1 overflow-y-auto">{children}</main>;
  }

  return (
    <>
      <Splash />
      <Sidebar />
      <div className="relative flex h-screen flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="relative flex-1 overflow-y-auto">
          {/* key por ruta: reinicia la animación de entrada en cada
              navegación, igual que la sala repinta la vista al cambiar de
              elemento. */}
          <div key={pathname} className="animate-rise mx-auto w-full max-w-340 px-6 pb-16 pt-6">
            {children}
          </div>
          <RouteTransitionOverlay />
        </main>
      </div>
    </>
  );
}
