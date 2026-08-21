/**
 * Acento personal: reemplaza el oro de la casa por el color que eligió el
 * usuario. NO toca los cuatro elementos — Agua, Viento, Tierra y Fuego siguen
 * pintando sus módulos con su color, que es la señal de en qué sección estás.
 *
 * Las variables se inyectan como estilo EN LÍNEA sobre <html>, no como una
 * regla `:root`. Es a propósito: globals.css define el oro dos veces, en
 * `:root` y en `:root.dark`, y una regla nueva `:root` perdería contra la
 * segunda por especificidad. El estilo en línea le gana a las dos sin recurrir
 * a !important ni depender del orden de las hojas.
 */

const HEX = /^#[0-9a-f]{6}$/i;

/** Devuelve el hex normalizado, o null si no es un color usable. */
export function normalizeHex(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return HEX.test(withHash) ? withHash : null;
}

function channels(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** Luminancia relativa según WCAG, para decidir el color del texto encima. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Texto legible sobre el acento. Sin esto, un acento amarillo dejaba los
 * botones con letra blanca sobre fondo claro, ilegibles.
 */
export function readableInk(hex: string): string {
  return luminance(hex) > 0.45 ? "#14181f" : "#ffffff";
}

/**
 * Color del menú lateral, sólido.
 *
 * El fondo solo es la mitad del trabajo: si se pinta y ya, un color claro deja
 * el texto blanco ilegible y uno oscuro hace lo mismo en modo claro. Así que
 * junto con el fondo se reescriben los tokens de tinta y bordes DENTRO del
 * <aside>, derivados de la luminancia del color elegido. Como las utilidades
 * (`text-ink`, `border-hairline`, `bg-surface-2`...) resuelven a esas mismas
 * variables, todo el menú —incluido el saldo del proxy al pie— se acomoda solo.
 *
 * Los grises intermedios se mezclan CONTRA el color de fondo y no contra
 * transparente: así quedan opacos y predecibles, sin depender de qué haya
 * detrás.
 */
export function sidebarStyle(sidebarColor: string | undefined | null): React.CSSProperties {
  const hex = normalizeHex(sidebarColor);
  if (!hex) return {};

  const ink = readableInk(hex);

  return {
    background: hex,
    "--surface-1": hex,
    "--text-primary": ink,
    "--text-secondary": `color-mix(in srgb, ${ink} 74%, ${hex})`,
    "--text-muted": `color-mix(in srgb, ${ink} 52%, ${hex})`,
    "--border-hairline": `color-mix(in srgb, ${ink} 20%, ${hex})`,
    // Fondo de los estados hover del menú.
    "--surface-2": `color-mix(in srgb, ${ink} 12%, ${hex})`,
    "--page-plane": `color-mix(in srgb, ${ink} 12%, ${hex})`,
  } as React.CSSProperties;
}

/** Variables a poner en línea sobre <html>. Vacío si no hay acento elegido. */
export function accentStyle(accentColor: string | undefined | null): React.CSSProperties {
  const hex = normalizeHex(accentColor);
  if (!hex) return {};

  return {
    "--gold": hex,
    // La variante "vivid" se usa en modo oscuro, donde el color plano se apaga
    // contra el fondo. Aclararla un cuarto la levanta sin cambiarle el matiz.
    "--gold-vivid": `color-mix(in srgb, ${hex} 76%, white)`,
    "--primary": hex,
    "--primary-fg": readableInk(hex),
  } as React.CSSProperties;
}
