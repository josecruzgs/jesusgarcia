// Separador de sección dentro de un bento: encabezado de grupo seguido de
// una línea que se desvanece hacia la derecha. Ocupa las 12 columnas.
export default function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="subhead">
      <span className="subhead-label">{children}</span>
      <span className="subhead-line" aria-hidden />
    </div>
  );
}
