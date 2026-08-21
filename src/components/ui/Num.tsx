"use client";

import { useEffect, useRef, useState } from "react";

// Cuenta desde el valor anterior hasta el nuevo en 900ms con ease-out cúbico.
// El "desde" se guarda en un ref (no en estado) porque solo importa como
// punto de partida de la animación: leerlo del estado obligaría a reiniciar
// el efecto en cada frame.
function useCountUp(target: number, enabled: boolean) {
  const [value, setValue] = useState(target);
  // Arranca en 0 a propósito: la primera animación sube desde cero, y de ahí
  // en adelante cada cambio de dato parte del valor que ya se veía.
  const from = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setValue(target);
      return;
    }
    const start = from.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / 900);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(start + (target - start) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled]);

  return value;
}

/**
 * Anima el primer número que encuentre dentro del texto, dejando intacto lo
 * que lo rodea: `Num` con "38.6%" cuenta hasta 38.6 y conserva el "%", con
 * "+2.4k" conserva el "+" y la "k". Así los componentes le pueden pasar el
 * valor ya formateado en vez de tener que partirlo en número y sufijo.
 */
export default function Num({ t }: { t: string | number }) {
  // Arranca en `false` (sin animación) para que el HTML del servidor y el
  // primer render del cliente coincidan —ambos pintan el valor final—; el
  // efecto lo enciende recién después de hidratar, y ahí sí cuenta desde 0.
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) setAnimate(true);
  }, []);

  const s = String(t);
  const match = s.match(/(-?\d[\d,]*\.?\d*)/);
  const target = match ? parseFloat(match[1].replace(/,/g, "")) : 0;
  const decimals = match && match[1].includes(".") ? match[1].split(".")[1].length : 0;
  const v = useCountUp(target, animate);

  if (!match) return <>{s}</>;

  return (
    <>
      {s.replace(
        match[1],
        v.toLocaleString("es-MX", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
      )}
    </>
  );
}
