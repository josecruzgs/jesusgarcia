import { NextRequest, NextResponse } from "next/server";
import { withAuth, HttpError } from "@/lib/apiHandler";
import { isAdmin } from "@/lib/auth/dal";
import { campanasSimultaneas, fijarCampanasSimultaneas, campanasCorriendo, CAMPANAS_SIMULTANEAS_MAX } from "@/lib/encuestas/campanas";
import { simultaneas } from "@/lib/encuestas/agente_voz";
import { encuestasAbiertas, abrirEncuestas } from "@/lib/encuestas/acceso";

/**
 * Ajustes globales de Encuestas, que solo cambia el admin:
 *
 * - `limite`: cuántas campañas pueden estar llamando al mismo tiempo. Las líneas telefónicas (ELEVENLABS_SIMULTANEAS)
 *   son de todos y se reparten entre las campañas que llaman; con más campañas a la vez, a cada una le toca menos. Bajar
 *   el número no detiene las que ya llaman: solo impide arrancar otra hasta que haya lugar.
 * - `abiertas`: si los usuarios que no son admin ven Encuestas en el menú y pueden usarlo.
 */
export const GET = withAuth(async () => {
  const [limite, corriendo, abiertas] = await Promise.all([campanasSimultaneas(), campanasCorriendo(), encuestasAbiertas()]);
  return NextResponse.json({ limite, corriendo, maximo: CAMPANAS_SIMULTANEAS_MAX, lineas: simultaneas(), abiertas });
});

export const PUT = withAuth(async (user, req: NextRequest) => {
  if (!isAdmin(user)) throw new HttpError(403, "Solo un admin puede cambiar los ajustes de Encuestas");
  const body = await req.json();
  const respuesta: { limite?: number; abiertas?: boolean } = {};

  if (body.abiertas !== undefined) {
    if (typeof body.abiertas !== "boolean") throw new HttpError(400, "«abiertas» va en true o false");
    await abrirEncuestas(body.abiertas);
    respuesta.abiertas = body.abiertas;
  }

  if (body.limite !== undefined) {
    const n = Number(body.limite);
    if (!Number.isInteger(n) || n < 1 || n > CAMPANAS_SIMULTANEAS_MAX) throw new HttpError(400, `Van de 1 a ${CAMPANAS_SIMULTANEAS_MAX} campañas`);
    await fijarCampanasSimultaneas(n);
    respuesta.limite = n;
  }

  if (!Object.keys(respuesta).length) throw new HttpError(400, "No hay nada que cambiar");
  return NextResponse.json(respuesta);
});
