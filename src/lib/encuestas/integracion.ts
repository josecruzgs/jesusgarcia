import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import EncuestaLlamadaModel from "@/lib/models/EncuestaLlamada";
import { huella } from "./cifrado";
import { leerCampana, campanaPorOmision } from "./llamadas";
import { asegurarCampanas } from "./campanas";

/**
 * LA PUERTA PARA OTRA PLATAFORMA (/api/encuestas/v1/*): se entra con `Authorization: Bearer <INTEGRACION_TOKEN>`.
 * No pasa por la sesión del panel (proxy.ts la deja pasar): el token es la única llave.
 * Sin INTEGRACION_TOKEN configurado la API queda cerrada: una ruta que hace llamadas telefónicas no puede quedar abierta.
 */
export function noAutorizado(req: NextRequest) {
  const token = process.env.INTEGRACION_TOKEN ?? "";
  if (token.length < 24) return NextResponse.json({ ok: false, error: "La API está cerrada: falta INTEGRACION_TOKEN (24 caracteres o más)." }, { status: 503 });
  const dado = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(dado), b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ ok: false, error: "No autorizado." }, { status: 401 });
  return null;
}

/**
 * Freno por número: a una misma persona no se le llama dos veces en 10 minutos ni más de 3 veces en 24 horas, venga de
 * donde venga la orden (un error o un doble clic en la otra plataforma no puede convertirse en acoso telefónico).
 */
export async function frenoPorNumero(diez: string) {
  await dbConnect();
  // Las llamadas de verdad no guardan el número: se cuentan por su huella.
  const deEse = { huella: huella(diez) };
  const [reciente, enElDia] = await Promise.all([
    EncuestaLlamadaModel.countDocuments({ ...deEse, inicio: { $gte: new Date(Date.now() - 10 * 60_000) }, estado: { $ne: "NO_SALIO" } }),
    EncuestaLlamadaModel.countDocuments({ ...deEse, inicio: { $gte: new Date(Date.now() - 24 * 3600_000) }, estado: { $ne: "NO_SALIO" } }),
  ]);
  if (reciente) return "A ese número ya se le llamó hace menos de 10 minutos.";
  if (enElDia >= 3) return "A ese número ya se le llamó 3 veces en las últimas 24 horas.";
  return null;
}

/**
 * De qué campaña habla la petición: `?campana=<id>` (o `campana` en el cuerpo). Sin ella, la campaña por omisión (la que
 * está llamando más reciente), que es lo que hacía la API cuando había una sola encuesta.
 */
export async function campanaDeLaPeticion(id: string | null | undefined) {
  await asegurarCampanas();
  return id ? leerCampana(id) : campanaPorOmision();
}
