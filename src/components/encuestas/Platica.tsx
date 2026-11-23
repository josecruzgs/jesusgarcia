"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Play, X } from "lucide-react";

/**
 * «ESCUCHAR / VER PLÁTICA»: se abre al centro de la pantalla, con el audio de la llamada y lo que se dijo. Va en un
 * portal: dentro de la tabla, que tiene su propio scroll, el fondo oscuro no cubriría la pantalla entera.
 */
export default function Platica({ id, titulo, transcripcion, conAudio }: { id: string; titulo: string; transcripcion: string | null; conAudio: boolean }) {
  const [abierta, setAbierta] = useState(false);
  useEffect(() => {
    if (!abierta) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") setAbierta(false); };
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, [abierta]);

  if (!transcripcion && !conAudio) return null;
  const renglones = (transcripcion ?? "").split("\n").filter((r) => r.trim());

  return (
    <>
      <button type="button" onClick={() => setAbierta(true)} className="tbtn inline-flex items-center gap-1 whitespace-nowrap !px-2.5 !py-1">
        {conAudio ? <><Play className="h-3 w-3" /> Escuchar</> : "Ver plática"}
      </button>
      {abierta &&
        createPortal(
          <div
            className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-3 backdrop-blur-sm sm:p-6"
            onClick={() => setAbierta(false)}
            role="dialog"
            aria-modal="true"
            aria-label={titulo}
          >
            <div className="card-surface flex max-h-[88vh] w-full max-w-[640px] flex-col !bg-surface" onClick={(e) => e.stopPropagation()}>
              <header className="flex items-start justify-between gap-3 border-b border-hairline p-5 pb-3">
                <div>
                  <p className="label-mono-sm">La llamada</p>
                  <h3 className="font-display mt-0.5 text-[16px] font-semibold text-ink">{titulo}</h3>
                </div>
                <button type="button" onClick={() => setAbierta(false)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-page hover:text-ink" aria-label="Cerrar">
                  <X className="h-4 w-4" />
                </button>
              </header>
              {conAudio && (
                <div className="px-5 pt-4">
                  {/* preload="none": el audio se pide hasta que alguien le da play. */}
                  <audio controls autoPlay preload="none" src={`/encuestas/audio/${id}`} className="w-full">
                    Tu navegador no puede reproducir el audio.
                  </audio>
                  <p className="mt-1.5 text-[12px] text-ink-muted">Si no suena, puede que la grabación tarde un minuto en estar lista después de colgar.</p>
                </div>
              )}
              <div className="space-y-2 overflow-y-auto p-5 pt-4 text-[14px] leading-relaxed">
                {renglones.length ? (
                  renglones.map((r, i) => {
                    const quien = r.split(":")[0];
                    const persona = quien.startsWith("Persona");
                    return (
                      <p key={i} className={`rounded-lg px-3 py-2 ${persona ? "ml-8 bg-surface-2" : "mr-8 bg-primary/10"}`}>
                        <b className={persona ? "text-ink" : "text-primary"}>{quien}:</b>
                        <span className="text-ink-secondary">{r.slice(r.indexOf(":") + 1)}</span>
                      </p>
                    );
                  })
                ) : (
                  <p className="text-ink-muted">No hay texto de esta llamada.</p>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
