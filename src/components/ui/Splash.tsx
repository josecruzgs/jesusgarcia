"use client";

import { useEffect, useState } from "react";
import ElementIcon, { type IconName } from "./ElementIcon";

// La animación de salida del CSS (.splash) arranca a 1.7s y dura 0.55s; el
// nodo se desmonta apenas después para no dejar un overlay invisible
// tapando los clicks.
const UNMOUNT_MS = 2350;

/**
 * Cortinilla de entrada: anillos que se expanden desde el centro, ícono que
 * entra rotando y el nombre en Fraunces. Se muestra una sola vez por
 * pestaña —la marca vive en sessionStorage— y se puede saltar con un clic.
 */
export default function Splash({
  name = "Jesús García",
  tag = "Sala de Inteligencia",
  lead = "Equipo Jesús García",
  icon = "eye",
  color = "var(--gold)",
  storageKey = "splash-seen",
}: {
  name?: string;
  tag?: string;
  lead?: string;
  icon?: IconName;
  color?: string;
  storageKey?: string;
}) {
  // Arranca oculto y se decide en el efecto: sessionStorage no existe en el
  // servidor, así que cualquier otra cosa sería un desajuste de hidratación.
  const [show, setShow] = useState(false);

  useEffect(() => {
    let alive = true;
    try {
      if (sessionStorage.getItem(storageKey)) return;
      sessionStorage.setItem(storageKey, "1");
    } catch {
      // Modo privado sin storage: se muestra igual, solo que cada carga.
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    setShow(true);
    const timer = setTimeout(() => alive && setShow(false), UNMOUNT_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [storageKey]);

  if (!show) return null;

  return (
    <div
      className="splash"
      onClick={() => setShow(false)}
      style={{ background: `radial-gradient(circle at 50% 42%, color-mix(in srgb, ${color} 22%, transparent), #06090f 70%)` }}
    >
      <div className="splash-rings" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="splash-ring"
            style={{ borderColor: `color-mix(in srgb, ${color} 55%, transparent)`, animationDelay: `${i * 0.4}s` }}
          />
        ))}
      </div>
      <div className="splash-core">
        <span
          className="splash-ic"
          style={{
            color,
            borderColor: `color-mix(in srgb, ${color} 66%, transparent)`,
            background: `color-mix(in srgb, ${color} 18%, transparent)`,
          }}
        >
          <ElementIcon name={icon} size={46} />
        </span>
        <div className="splash-name">{name}</div>
        <div className="splash-tag" style={{ color }}>
          {tag}
        </div>
        <div className="splash-lead">{lead}</div>
        <div className="label-mono-sm mt-6 tracking-[0.1em]">toca para entrar</div>
      </div>
    </div>
  );
}
