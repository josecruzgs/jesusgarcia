import { NextResponse, type NextRequest } from "next/server";
import { Types } from "mongoose";
import { importarLlamadasDelAgente } from "@/lib/encuestas/agente_voz";
import EncuestaLlamadaModel from "@/lib/models/EncuestaLlamada";
import { buscarLlamadas, leerCampana, leerOpciones, telefonoVisible } from "@/lib/encuestas/llamadas";
import { noAutorizado } from "@/lib/encuestas/integracion";

/**
 * GET /api/encuestas/v1/llamadas/{id} — cómo terminó una llamada y qué contestó. Mientras siga EN_CURSO se pregunta a ElevenLabs
 * por las pláticas terminadas antes de contestar, así que basta con consultar cada 15-30 s hasta que cambie de estado.
 * ?transcripcion=1 agrega lo que se dijo.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const cerrado = noAutorizado(req);
  if (cerrado) return cerrado;
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) return NextResponse.json({ ok: false, error: "No existe esa llamada." }, { status: 404 });
  const buscar = async () => (await buscarLlamadas({ _id: id }, { limite: 1 }))[0] ?? null;
  let l = await buscar();
  if (!l) return NextResponse.json({ ok: false, error: "No existe esa llamada." }, { status: 404 });
  // La campaña de la llamada (las respuestas son de sus preguntas).
  const campanaId = (await EncuestaLlamadaModel.findById(id).select("cuestionarioId").lean<{ cuestionarioId: Types.ObjectId }>())?.cuestionarioId;
  if (l.estado === "EN_CURSO") { await importarLlamadasDelAgente({ limite: 20, campanaId: campanaId ? String(campanaId) : null }).catch(() => null); l = (await buscar()) ?? l; }
  // Las respuestas apuntan a la pregunta por su id; la API las devuelve por la clave, que es lo que conoce la otra plataforma.
  const preguntas = new Map(((await leerCampana(campanaId ? String(campanaId) : null))?.preguntas ?? []).map((p) => [p.id, p]));
  const contestadas = l.respuestas.flatMap((r) => { const p = preguntas.get(r.preguntaId); return p ? [{ p, valor: r.valor }] : []; });
  return NextResponse.json({
    ok: true,
    id: l.id, campana: campanaId ? String(campanaId) : null, estado: l.estado, terminada: l.estado !== "EN_CURSO", prueba: l.prueba,
    telefono: telefonoVisible(l), inicio: l.inicio, fin: l.fin, segundos: l.segundos, versionGuion: l.versionGuion,
    respuestas: Object.fromEntries(contestadas.map((r) => [r.p.clave, r.valor])),
    opciones: Object.fromEntries(contestadas.map((r) => [r.p.clave, leerOpciones(r.p.opciones)])),
    notas: l.notas,
    ...(req.nextUrl.searchParams.get("transcripcion") === "1" ? { transcripcion: l.transcripcion } : {}),
  });
}
