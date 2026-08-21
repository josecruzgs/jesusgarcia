// Fallback de Suspense por ruta (ver src/app/*/loading.tsx). A propósito NO
// tiene un ícono girando: RouteTransitionOverlay ya cubre esa animación en
// cada cambio de página, y como ahora es semi-transparente (para dejar ver
// el contenido cargando detrás), un segundo ícono girando acá se veía
// duplicado. Este skeleton solo es visible si una carga real tarda más que
// la ventana del overlay.
export default function RouteLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="h-8 w-48 animate-pulse-soft rounded-lg bg-surface-2" />
      {/* La fila de cuatro cifras y el panel ancho de abajo: el esqueleto
          calca la silueta del bento para que no haya un salto de layout
          cuando llegan los datos. */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-26 animate-pulse-soft rounded-[14px] bg-surface-2" />
        ))}
      </div>
      <div className="h-64 animate-pulse-soft rounded-[14px] bg-surface-2" />
    </div>
  );
}
