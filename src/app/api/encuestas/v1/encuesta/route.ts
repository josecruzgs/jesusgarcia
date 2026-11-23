import { NextResponse, type NextRequest } from "next/server";
import { leerOpciones } from "@/lib/encuestas/llamadas";
import { hayAgenteDeVoz } from "@/lib/encuestas/agente_voz";
import { horarioDe } from "@/lib/encuestas/campanas";
import { noAutorizado, campanaDeLaPeticion } from "@/lib/encuestas/integracion";

/**
 * GET /api/encuestas/v1/encuesta?campana=<id> — la encuesta de una campaña tal como la dice la asistente, y si ahorita se
 * puede llamar. Sin `campana`, la campaña que está llamando más reciente (la lista está en /api/encuestas/v1/campanas).
 */
export async function GET(req: NextRequest) {
  const cerrado = noAutorizado(req);
  if (cerrado) return cerrado;
  const c = await campanaDeLaPeticion(req.nextUrl.searchParams.get("campana"));
  if (!c) return NextResponse.json({ ok: false, error: "No existe esa campaña." }, { status: 404 });
  const h = horarioDe(c);
  return NextResponse.json({
    ok: true,
    campana: c.id, nombre: c.nombre, estado: c.estado, version: c.version, saludo: c.saludo, cierre: c.cierre,
    preguntas: c.preguntas.map((p) => ({ clave: p.clave, texto: p.texto, opciones: leerOpciones(p.opciones), noSeLeen: leerOpciones(p.noSeLeen) })),
    agenteConectado: hayAgenteDeVoz() && !!c.agenteId, horario: h.texto, enHorario: h.abierto,
  });
}
