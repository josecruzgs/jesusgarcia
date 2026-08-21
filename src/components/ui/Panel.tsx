import type { ReactNode } from "react";

// Ancho en columnas del bento de 12. Se pasa como clase literal (c4, c6…)
// porque son clases propias de globals.css, no utilidades generadas.
export type PanelCol = 3 | 4 | 5 | 6 | 7 | 8 | 9 | 12;

/**
 * Contenedor estándar de la sala: chapa con degradado a 168°, filo de color
 * arriba y un encabezado de ícono + título + etiqueta con espacio para
 * acciones a la derecha.
 *
 * `accent` es un color CSS crudo (no una clase) porque alimenta el degradado
 * del filo y el tinte del ícono, y ambos necesitan el valor real.
 */
export default function Panel({
  title,
  tag,
  right,
  icon,
  accent = "var(--gold)",
  col = 4,
  minH,
  className = "",
  bodyClassName = "",
  children,
}: {
  title?: ReactNode;
  tag?: ReactNode;
  right?: ReactNode;
  icon?: ReactNode;
  accent?: string;
  col?: PanelCol;
  minH?: number;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}) {
  return (
    <section
      className={`card-surface c${col} px-4.5 py-4 ${className}`}
      style={{ minHeight: minH, ["--edge-c" as string]: accent }}
    >
      {(title || right) && (
        <header className="panel-head">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon && (
              <span className="grid shrink-0 place-items-center" style={{ color: accent }}>
                {icon}
              </span>
            )}
            {title && <span className="panel-title">{title}</span>}
            {tag && <span className="panel-tag">{tag}</span>}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </header>
      )}
      <div className={`relative ${bodyClassName}`}>{children}</div>
    </section>
  );
}
