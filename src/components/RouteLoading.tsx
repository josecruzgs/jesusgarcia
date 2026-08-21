import type { LucideIcon } from "lucide-react";

/**
 * Indicador de carga de ruta. `accent` es un color CSS crudo (no una clase):
 * el mismo valor tiñe el ícono, el borde y el anillo que gira, así que
 * necesita el valor real para poder mezclarlo con color-mix.
 *
 * El cuadro va tintado y con borde —no relleno sólido con ícono blanco—
 * porque los colores de los elementos son claros: blanco encima no pasaría
 * contraste, y el anillo giratorio se perdería contra el relleno.
 */
export default function RouteLoading({
  icon: Icon,
  accent,
  label = "Cargando",
}: {
  icon: LucideIcon;
  accent: string;
  label?: string;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="animate-fade-in-up flex flex-col items-center gap-4">
        <span
          className="relative grid h-16 w-16 place-items-center rounded-2xl border"
          style={{
            color: accent,
            borderColor: `color-mix(in srgb, ${accent} 45%, transparent)`,
            background: `color-mix(in srgb, ${accent} 14%, transparent)`,
          }}
        >
          <Icon className="h-7 w-7" />
          <span
            className="absolute inset-0 animate-spin rounded-2xl border-2 border-transparent"
            style={{ borderTopColor: accent }}
          />
        </span>
        <p className="label-mono">{label}...</p>
      </div>
    </div>
  );
}
