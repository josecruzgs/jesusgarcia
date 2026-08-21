import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/apiHandler";
import { dbConnect } from "@/lib/mongodb";
import { assertOwnedProject } from "@/lib/listening/ownership";
import { buildExecutiveBrief } from "@/lib/listening/analyze";
import {
  generateCurrentBriefWindow,
  generateNextBriefWindow,
  regenerateBriefWindow,
} from "@/lib/listening/briefSchedule";
import { parseDayRange } from "@/lib/listening/range";

type Params = { params: Promise<{ id: string }> };

/**
 * Genera UN informe por llamada. Los cuatro modos, en el orden en que se
 * evalúan:
 *
 * - `{ from, to }` → informe de rango libre, fuera de la grilla. Es la salida
 *   de emergencia para investigar un episodio puntual; no cuenta como ventana
 *   analizada ni evita que la ventana correspondiente se genere igual.
 * - `{ windowStart }` → rehace esa ventana de la grilla.
 * - `{ current: true }` → adelanto de la ventana en curso, marcado parcial.
 * - `{}` → la ventana cerrada más vieja que falte.
 *
 * `pending` en la respuesta es cuántas quedan después de ésta: el cliente
 * vuelve a llamar mientras sea mayor que cero.
 */
export const POST = withAuth(async (user, req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  await dbConnect();
  await assertOwnedProject(user, id);

  if (body.from && body.to) {
    const { from, to } = parseDayRange(body.from, body.to);
    const brief = await buildExecutiveBrief(id, from, to);
    return NextResponse.json({ brief, window: null, pending: 0 });
  }

  const result =
    typeof body.windowStart === "string" && body.windowStart
      ? await regenerateBriefWindow(id, body.windowStart)
      : body.current
        ? await generateCurrentBriefWindow(id)
        : await generateNextBriefWindow(id);

  if (!result) {
    // No es un error: significa que no hay nada que analizar. El cliente corta
    // su bucle con esto en vez de tener que adivinarlo por el contador.
    return NextResponse.json({ brief: null, window: null, pending: 0 });
  }

  return NextResponse.json({
    brief: result.brief,
    window: result.window,
    pending: result.remaining,
  });
});
