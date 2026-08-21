import { type ElementKey, ELEMENT_COLOR, ELEMENT_META } from "@/lib/elements";
import ElementIcon from "@/components/ui/ElementIcon";

/**
 * Módulo todavía no habilitado. En vez de un cartel de "próximamente", se
 * presenta con la misma cortinilla que la sala usa al entrar a un elemento
 * —anillos expandiéndose, ícono grande, nombre en Fraunces y el lema en
 * cursiva— y recién abajo aclara que no está activo.
 */
export default function DisabledModule({ element }: { element: ElementKey }) {
  const color = ELEMENT_COLOR[element];
  const meta = ELEMENT_META[element];

  return (
    <div
      className="relative flex min-h-[68vh] items-center justify-center overflow-hidden"
      style={{ background: `radial-gradient(circle at 50% 42%, color-mix(in srgb, ${color} 12%, transparent), transparent 70%)` }}
    >
      <div className="splash-rings" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="splash-ring"
            style={{ borderColor: `color-mix(in srgb, ${color} 45%, transparent)`, animationDelay: `${i * 0.8}s` }}
          />
        ))}
      </div>

      <div className="splash-core relative z-10">
        <span
          className="splash-ic"
          style={{
            color,
            borderColor: `color-mix(in srgb, ${color} 60%, transparent)`,
            background: `color-mix(in srgb, ${color} 16%, transparent)`,
          }}
        >
          <ElementIcon name={element} size={46} />
        </span>
        <h1 className="font-display text-5xl font-bold leading-none text-ink">{meta.name}</h1>
        <p className="splash-tag" style={{ color }}>
          {meta.title}
        </p>
        <p className="splash-lead">{meta.lead}</p>
        <p className="classchip mt-7 inline-block">MÓDULO INHABILITADO</p>
      </div>
    </div>
  );
}
