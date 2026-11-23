import { NextRequest, NextResponse } from "next/server";
import { withAuth, HttpError } from "@/lib/apiHandler";
import { isAdmin } from "@/lib/auth/dal";
import { campanasSimultaneas, fijarCampanasSimultaneas, campanasCorriendo, CAMPANAS_SIMULTANEAS_MAX } from "@/lib/encuestas/campanas";
import { simultaneas } from "@/lib/encuestas/agente_voz";

/**
 * Cuántas campañas de encuesta pueden estar llamando al mismo tiempo.
 *
 * Solo el admin: las líneas telefónicas (ELEVENLABS_SIMULTANEAS) son de todos y se reparten entre las campañas que llaman;
 * con más campañas a la vez, a cada una le toca menos. Bajar el número no detiene las que ya llaman: solo impide
 * arrancar otra hasta que haya lugar.
 */
export const GET = withAuth(async () => {
  const [limite, corriendo] = await Promise.all([campanasSimultaneas(), campanasCorriendo()]);
  return NextResponse.json({ limite, corriendo, maximo: CAMPANAS_SIMULTANEAS_MAX, lineas: simultaneas() });
});

export const PUT = withAuth(async (user, req: NextRequest) => {
  if (!isAdmin(user)) throw new HttpError(403, "Solo un admin puede cambiar cuántas campañas llaman a la vez");
  const body = await req.json();
  const n = Number(body.limite);
  if (!Number.isInteger(n) || n < 1 || n > CAMPANAS_SIMULTANEAS_MAX) throw new HttpError(400, `Van de 1 a ${CAMPANAS_SIMULTANEAS_MAX} campañas`);
  await fijarCampanasSimultaneas(n);
  return NextResponse.json({ limite: n });
});
