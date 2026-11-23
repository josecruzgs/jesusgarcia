"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { seguirLlamadas } from "@/app/encuestas/acciones";

/**
 * Mientras haya llamadas en la línea o tanda por marcar, el tablero pregunta cada 15 segundos si ya colgaron, registra lo
 * que llegó, marca las siguientes en las líneas libres y se refresca solo. Si pasan diez minutos sin cambios deja de
 * preguntar (el worker del servidor sigue llamando de todos modos cada 2 minutos).
 */
export default function Seguir({ activo, enLinea }: { activo: boolean; enLinea: number }) {
  const router = useRouter();
  const [quietas, setQuietas] = useState(0);

  useEffect(() => {
    if (!activo || quietas >= 40) return;
    const t = setTimeout(async () => {
      const r = await seguirLlamadas().catch(() => null);
      if (r?.cambiaron) { router.refresh(); setQuietas(0); } else setQuietas((v) => v + 1);
    }, 15_000);
    return () => clearTimeout(t);
  }, [activo, quietas, router]);

  if (!activo) return null;
  return (
    <p className="flex items-center gap-2 text-[13px] text-ink-muted">
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-steel-vivid opacity-70" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
      </span>
      <span>
        <b className="text-ink">{enLinea === 0 ? "Esperando línea libre." : enLinea === 1 ? "1 llamada en la línea." : `${enLinea} llamadas en la línea.`}</b>{" "}
        {quietas < 40 ? "Cada resultado aparece aquí solo al colgar." : "Sin cambios desde hace rato; el servidor sigue llamando solo."}
      </span>
    </p>
  );
}
