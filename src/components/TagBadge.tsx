// Colores tal cual vienen de AdsPower (perfil > etiquetas) — son nombres de
// color CSS válidos (blue, red, green, etc.), así que se usan directo como
// fondo del punto. Si el color no llega o no es válido, cae a gris neutro.
export type Tag = { name: string; color?: string };

export default function TagBadge({ tag }: { tag: Tag }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-hairline bg-page px-2 py-0.5 text-xs text-ink-secondary">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: tag.color || "#8a8a8a" }}
        aria-hidden
      />
      {tag.name}
    </span>
  );
}
