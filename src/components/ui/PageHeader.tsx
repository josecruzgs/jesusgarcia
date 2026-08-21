import type { ReactNode } from "react";

/**
 * Encabezado de vista: cuadro de ícono relleno con el acento, título en
 * Fraunces y una línea mono de contexto, todo sobre una regla que separa del
 * contenido. Es el mismo bloque con el que la sala abre cada módulo.
 *
 * Ya no recibe `accent`: desde que los cuatro elementos se pintan con el color
 * elegido en /ajustes, la única respuesta posible era el acento, y una prop que
 * solo acepta un valor es una invitación a pasarle otro que no se vería bien
 * (`accent-fill` da por sentado que la tinta es --primary-fg).
 */
export default function PageHeader({
  title,
  subtitle,
  icon,
  right,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-center gap-3 border-b border-hairline pb-4">
      {icon && (
        <span className="accent-fill grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border">
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-semibold leading-tight tracking-[-0.02em] text-ink">{title}</h1>
        {subtitle && <p className="label-mono-sm mt-1">{subtitle}</p>}
      </div>
      {right && <div className="ml-auto flex flex-wrap items-center gap-2">{right}</div>}
    </header>
  );
}
