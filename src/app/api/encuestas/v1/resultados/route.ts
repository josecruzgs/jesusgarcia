import { NextResponse, type NextRequest } from "next/server";
import { resultadosLlamadas } from "@/lib/encuestas/llamadas";
import { noAutorizado, campanaDeLaPeticion } from "@/lib/encuestas/integracion";

/** GET /api/encuestas/v1/resultados?campana=<id> — los resultados de una campaña (sin pruebas; ?pruebas=1 las incluye y lo dice). */
export async function GET(req: NextRequest) {
  const cerrado = noAutorizado(req);
  if (cerrado) return cerrado;
  const c = await campanaDeLaPeticion(req.nextUrl.searchParams.get("campana"));
  if (!c) return NextResponse.json({ ok: false, error: "No existe esa campaña." }, { status: 404 });
  const r = await resultadosLlamadas(c, { conPruebas: req.nextUrl.searchParams.get("pruebas") === "1" });
  return NextResponse.json({
    ok: true,
    campana: c.id, encuesta: c.nombre, estado: c.estado, version: c.version, conPruebas: r.conPruebas, pruebas: r.pruebas,
    llamadas: { hechas: r.intentos, contestaron: r.contestaron, completas: r.completas, duracionMediaSeg: r.duracionMedia, porEstado: r.porEstado },
    preguntas: r.preguntas.map((q) => ({ clave: q.pregunta.clave, texto: q.pregunta.texto, respondieron: q.respondieron, opciones: q.filas.map((f) => ({ opcion: f.nombre, n: f.votos, pct: f.pct })) })),
  });
}
