export default function Card({
  className = "",
  /** Color del filo superior; por defecto el azul acero de la marca. */
  accent = "var(--steel)",
  /** Levanta al pasar el mouse. Solo para tarjetas navegables. */
  interactive = false,
  children,
}: {
  className?: string;
  accent?: string;
  interactive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`card-surface ${interactive ? "card-lift" : ""} ${className}`}
      style={{ ["--edge-c" as string]: accent }}
    >
      {children}
    </div>
  );
}
