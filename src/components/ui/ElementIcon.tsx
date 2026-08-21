// Íconos de línea calcados de la sala de inteligencia: un solo <path> por
// símbolo, trazo de 1.55 y remates redondos. Se mantienen como SVG propio en
// vez de usar lucide-react porque el ojo y los cuatro elementos son la
// identidad del producto — no hay equivalente exacto en un set genérico.
const PATHS = {
  viento: "M4 9h9a2.4 2.4 0 1 0-2.4-2.4 M4 13h13a2.8 2.8 0 1 1-2.8 2.8 M4 17h8",
  agua: "M12 3.6C8.6 7.8 6.2 10.4 6.2 13.4a5.8 5.8 0 0 0 11.6 0c0-3-2.4-5.6-5.8-9.8Z",
  tierra: "M3 18.5h18 M5.4 18.5l4.2-6.6 3 4 2.4-3.4 5 6",
  fuego:
    "M12 21.4a5.8 5.8 0 0 0 5.8-5.8c0-4.1-3-6.2-3.6-9.9C13 7 11.6 8.4 11.1 10.8 9.7 9.8 9.2 8.4 9.2 6.4c-1.9 1.9-3 4.7-3 8.8a5.8 5.8 0 0 0 5.8 5.8Z",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z",
} as const;

export type IconName = keyof typeof PATHS;

export default function ElementIcon({
  name,
  size = 16,
  color,
  className,
}: {
  name: IconName;
  size?: number;
  color?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? "currentColor"}
      strokeWidth="1.55"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ display: "block" }}
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
