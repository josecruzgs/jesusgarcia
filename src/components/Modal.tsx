"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// Clases literales, no interpoladas: el scanner de Tailwind necesita verlas
// escritas tal cual para generarlas.
const MAX_WIDTH = { md: "max-w-lg", xl: "max-w-4xl" } as const;

export default function Modal({
  open,
  onClose,
  title,
  size = "md",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** "xl" para lo que lleva una tabla adentro (el selector de perfiles). */
  size?: keyof typeof MAX_WIDTH;
  children: React.ReactNode;
}) {
  // El portal necesita document.body, que no existe en el render del
  // servidor: se monta recién en el cliente.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  /**
   * Va en un portal a <body> y no en su lugar del árbol porque `position:
   * fixed` deja de referirse al viewport si CUALQUIER ancestro tiene
   * transform, filter, backdrop-filter o will-change — ese ancestro pasa a
   * ser el bloque contenedor. Las páginas envuelven su contenido en
   * `.animate-fade-in-up`, cuya animación termina con `transform:
   * translateY(0)` y fill-mode `both`, así que el transform queda puesto para
   * siempre: sin el portal, el diálogo se centra dentro del contenedor de la
   * página en vez de la pantalla y se sale por arriba.
   */
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="animate-fade-in-up absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} />
      {/* Sombra larga y muy difusa (no la `shadow-lg` genérica): es lo que
          despega el diálogo del plano sin necesidad de un borde fuerte,
          igual que las tarjetas de la sala. */}
      <div
        className={`card-surface animate-fade-in-up relative flex max-h-[85vh] w-full ${MAX_WIDTH[size]} flex-col overflow-hidden shadow-[0_26px_64px_-18px_rgba(0,0,0,0.9)]`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-hairline px-6 py-4">
          <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-page hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* min-h-0 es lo que hace que esto scrollee de verdad: un hijo flex
            tiene min-height:auto por defecto, así que sin esto no se encoge
            por debajo de su contenido, la caja crece más allá del max-h y el
            encabezado se sale por arriba del viewport. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
