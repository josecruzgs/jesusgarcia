"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ListChecks,
  GitBranch,
  Heart,
  MessageCircleHeart,
  MessageSquare,
  Megaphone,
  Activity,
  Users,
  FolderKanban,
  UserCog,
  ChevronsLeft,
  ChevronDown,
  Droplets,
  Wind,
  Radar,
  Mountain,
  Trees,
  Flame,
  Rocket,
  Archive,
  ShieldCheck,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { useSession } from "@/lib/session";
import { normalizeHex, sidebarStyle } from "@/lib/theme";

// `adminOnly` solo esconde el enlace: quien lo adivine igual choca contra el
// 403 de withAdmin en la API. La seguridad está allá, esto es prolijidad.
type NavItem = { href: string; label: string; icon: LucideIcon; adminOnly?: boolean };
type NavSection = {
  key: string;
  label: string;
  icon?: LucideIcon;
  collapsible: boolean;
  items: NavItem[];
};

// Un solo acento para todo el menú. Antes cada elemento traía el suyo (Agua
// azul, Viento celeste, Tierra verde, Fuego naranja); ahora los cinco grupos
// usan el acento de la casa, que es el azul acero o el color que el usuario haya
// elegido en /ajustes — `text-steel` resuelve a --steel, y accentStyle() lo
// reescribe en línea sobre <html>.
//
// Clases completas y literales a propósito (no interpoladas): el scanner de
// Tailwind necesita verlas escritas tal cual en el código para generarlas.
//
// El ítem activo NO usa esto: lleva relleno sutil más la barra indicadora de
// Fluent (ver abajo). Un tinte del acento se sostenía sobre el gris de la casa,
// pero sobre un menú pintado de un color propio queda compitiendo con el fondo
// y el ítem seleccionado deja de leerse como seleccionado.
const ACCENT_TEXT = "text-steel";

const NAV_SECTIONS: NavSection[] = [
  {
    key: "general",
    label: "General",
    collapsible: false,
    items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    key: "agua",
    label: "Agua",
    icon: Droplets,
    collapsible: true,
    items: [
      { href: "/campanas", label: "Campañas", icon: FolderKanban },
      { href: "/tasks", label: "Tareas", icon: ListChecks },
      { href: "/tasks/like", label: "Likes", icon: Heart },
      { href: "/tasks/likecomment", label: "Likes a comentarios", icon: MessageCircleHeart },
      { href: "/tasks/comment", label: "Comentar", icon: MessageSquare },
      { href: "/tasks/ramificacion", label: "Ramificaciones", icon: GitBranch },
      { href: "/tasks/post", label: "Publicar", icon: Megaphone },
    ],
  },
  {
    key: "viento",
    label: "Viento",
    icon: Wind,
    collapsible: true,
    items: [{ href: "/scrapping", label: "Escucha", icon: Radar }],
  },
  {
    key: "tierra",
    label: "Tierra",
    icon: Mountain,
    collapsible: true,
    items: [{ href: "/actividades", label: "Actividades", icon: Trees }],
  },
  {
    key: "fuego",
    label: "Fuego",
    icon: Flame,
    collapsible: true,
    items: [{ href: "/dia-d", label: "Día D", icon: Rocket }],
  },
  {
    key: "recursos",
    label: "Recursos",
    icon: Archive,
    collapsible: true,
    items: [
      { href: "/profiles", label: "Perfiles", icon: Users },
      { href: "/groups", label: "Grupos", icon: FolderKanban },
      { href: "/profiles/auto-profile", label: "Auto Profile", icon: UserCog },
      { href: "/tasks/warmup", label: "Warmup", icon: Activity },
      { href: "/ajustes", label: "Ajustes", icon: SlidersHorizontal },
      { href: "/usuarios", label: "Usuarios", icon: ShieldCheck, adminOnly: true },
    ],
  },
];

const BRAND_TITLE = "Jesús García";
const BRAND_SUBTITLE = "Equipo Jesús García";

// El label solo aparece luego de que el ancho terminó de animar (~200ms):
// mostrarlo de inmediato al expandir hace que el texto se monte a su ancho
// natural mientras el <aside> todavía está angosto y se ve "chocado".
const EXPAND_LABEL_DELAY = 180;

// El toggle de tema (ThemeToggle) muta la clase "dark" en <html> directo por
// DOM, sin pasar por React — un MutationObserver es la forma más simple de
// enterarse del cambio sin tener que levantar un context/provider solo para
// esto.
function useIsDark() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    setIsDark(root.classList.contains("dark"));

    const observer = new MutationObserver(() => setIsDark(root.classList.contains("dark")));
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

export default function Sidebar() {
  const pathname = usePathname();
  const isDark = useIsDark();
  const session = useSession();
  const [collapsed, setCollapsed] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [closedSections, setClosedSections] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const stored = localStorage.getItem("sidebar-collapsed") === "true";
    setCollapsed(stored);
    setShowLabels(!stored);
    try {
      const storedSections = JSON.parse(localStorage.getItem("sidebar-closed-sections") ?? "{}");
      setClosedSections(storedSections);
    } catch {
      // ignore malformed value
    }
    setMounted(true);
  }, []);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("sidebar-collapsed", String(next));
    if (next) {
      setShowLabels(false);
    } else {
      setTimeout(() => setShowLabels(true), EXPAND_LABEL_DELAY);
    }
  }

  function toggleSection(key: string) {
    setClosedSections((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem("sidebar-closed-sections", JSON.stringify(next));
      return next;
    });
  }

  // Un href puede ser prefijo de otro (ej. /tasks y /tasks/comment): solo el
  // match más específico (el más largo) queda marcado como activo, así una
  // subpágina no enciende también el ítem de su padre.
  const activeHref = useMemo(() => {
    const allHrefs = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href));
    let best: string | null = null;
    for (const href of allHrefs) {
      const matches = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
      if (matches && (!best || href.length > best.length)) best = href;
    }
    return best;
  }, [pathname]);

  // La sesión viene del servidor por contexto, así que el rol ya se conoce en
  // la primera pintura: los ítems de admin no parpadean ni de más ni de menos.
  const sections = useMemo(
    () =>
      NAV_SECTIONS.map((section) => ({
        ...section,
        items: section.items.filter((item) => !item.adminOnly || session?.role === "admin"),
      })),
    [session],
  );

  const prefs = session?.preferences;
  const hasCustomSidebar = Boolean(normalizeHex(prefs?.sidebarColor));
  const title = prefs?.brandTitle?.trim() || BRAND_TITLE;
  const subtitle = prefs?.brandSubtitle?.trim() || BRAND_SUBTITLE;
  const avatar = prefs?.avatar || "";

  return (
    <aside
      // El estilo en línea pinta el menú del color elegido y, con él, reescribe
      // los tokens de tinta para que el texto siga legible (ver sidebarStyle).
      // Sin color elegido devuelve {} y mandan las clases de siempre.
      style={sidebarStyle(prefs?.sidebarColor)}
      // Va a ras: alto completo, pegado al canto izquierdo y separado del
      // contenido por la línea de 1 px que pone .nav-rail. Antes flotaba con
      // márgenes y radio en las cuatro caras — un gesto de vidrio; el panel de
      // navegación de Windows es parte del borde de la ventana, no una lámina
      // apoyada encima.
      className={`nav-rail flex h-screen shrink-0 flex-col overflow-hidden transition-[width] duration-200 ${
        collapsed ? "w-19" : "w-64"
      } ${mounted ? "" : "invisible"}`}
    >
      <div className={`flex gap-2.5 py-5 ${collapsed ? "flex-col items-center px-2" : "items-center px-5"}`}>
        <div className="relative flex h-9 w-9 shrink-0 items-center justify-center">
          {avatar ? (
            // La foto la sube el usuario y viaja como data URI, así que no pasa
            // por el optimizador de next/image: <img> es lo correcto acá.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatar}
              alt={title}
              className="h-9 w-9 rounded-full border border-hairline object-cover"
            />
          ) : (
            <Image
              src={isDark ? "/media/logo.png" : "/media/logoblack.png"}
              alt={title}
              width={36}
              height={36}
              className="object-contain"
              priority
            />
          )}
        </div>
        {showLabels && (
          <div className="animate-fade-in-up min-w-0 flex-1 overflow-hidden">
            <p className="font-display truncate text-[17px] font-semibold leading-none text-ink">{title}</p>
            <p className="label-mono-sm mt-1 truncate">{subtitle}</p>
          </div>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-page hover:text-ink ${collapsed ? "" : "ml-auto"}`}
        >
          <ChevronsLeft className={`h-4 w-4 transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`} />
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 pb-6">
        {sections.map((section) => {
          const SectionIcon = section.icon;
          const isOpen = !closedSections[section.key];
          const showHeader = showLabels && section.icon;
          // Con un menú de color propio, el acento se hunde en el fondo (un
          // azul sobre otro azul deja de leerse). Ahí los encabezados pasan a la
          // tinta legible, que sidebarStyle() ya calculó contra ese fondo.
          const headerColor = hasCustomSidebar ? "text-ink" : ACCENT_TEXT;

          return (
            <div key={section.key} className="flex flex-col gap-1">
              {showHeader && SectionIcon ? (
                <button
                  type="button"
                  onClick={() => section.collapsible && toggleSection(section.key)}
                  className="animate-fade-in-up flex items-center gap-2 px-3 pb-1 text-left"
                >
                  <SectionIcon className={`h-3.5 w-3.5 shrink-0 ${headerColor}`} />
                  {/* Encabezado de grupo del menú de Windows: cuerpo de 12 px,
                      caja normal. Era una versalita mono con tracking ancho —
                      el registro de instrumento que se fue con el vidrio. */}
                  <span className={`flex-1 text-[12px] font-semibold ${headerColor}`}>{section.label}</span>
                  {section.collapsible && (
                    <ChevronDown
                      className={`h-3.5 w-3.5 shrink-0 text-ink-muted transition-transform duration-200 ${isOpen ? "" : "-rotate-90"}`}
                    />
                  )}
                </button>
              ) : (
                showLabels && (
                  <p className="animate-fade-in-up px-3 pb-1 text-[12px] font-semibold text-ink-muted">
                    {section.label}
                  </p>
                )
              )}

              <div
                className={`grid transition-[grid-template-rows] duration-200 ${
                  showLabels && !isOpen ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
                }`}
              >
                <div className="flex flex-col gap-1 overflow-hidden">
                  {section.items.map((item) => {
                    const active = item.href === activeHref;
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        title={collapsed ? item.label : undefined}
                        className={`group relative flex items-center gap-3 rounded border py-2 text-[14px] transition-colors duration-100 ${
                          showLabels ? "pl-7 pr-3" : "px-3"
                        } ${
                          active
                            ? // La selección de Fluent no se pinta con el
                              // acento: es un relleno sutil más la barra
                              // indicadora de abajo. Así el ítem activo se lee
                              // igual con cualquier acento —incluido uno que el
                              // usuario haya puesto casi del color del menú— y
                              // no hace falta calcular tinta legible encima.
                              "border-transparent bg-surface-2 font-semibold text-ink"
                            : "border-transparent font-normal text-ink-secondary hover:bg-surface-2 hover:text-ink"
                        }`}
                      >
                        {/* La barra indicadora: 3 px con las puntas redondeadas,
                            pegada al canto izquierdo. Es la pieza que Windows
                            pone al lado del ítem seleccionado, y acá es lo único
                            que lleva el acento a plena saturación. */}
                        {active && (
                          <span
                            aria-hidden
                            className={`absolute left-1 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full ${
                              hasCustomSidebar ? "bg-ink" : "bg-primary"
                            }`}
                          />
                        )}
                        <Icon
                          className={`h-4 w-4 shrink-0 ${active ? "text-ink" : "text-ink-muted group-hover:text-ink"}`}
                        />
                        {showLabels && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      {/* Al pie, quién está conectado. Es también la entrada a Ajustes, que es
          donde se cambian su foto, su color y su hora. */}
      {session && (
        <Link
          href="/ajustes"
          title={`${session.username} · ir a Ajustes`}
          className={`flex shrink-0 items-center gap-2.5 border-t border-hairline py-3 transition-colors hover:bg-surface-2 ${
            collapsed ? "justify-center px-2" : "px-5"
          }`}
        >
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
          ) : (
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-hairline text-[11px] font-semibold uppercase text-ink-secondary">
              {session.username.slice(0, 1)}
            </span>
          )}
          {showLabels && (
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink-secondary">{session.username}</span>
          )}
        </Link>
      )}
    </aside>
  );
}
