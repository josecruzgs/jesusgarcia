import { NextResponse, type NextRequest } from "next/server";
import { Types } from "mongoose";
import { withAuth } from "@/lib/apiHandler";
import { dbConnect } from "@/lib/mongodb";
import EncuestaLlamadaModel from "@/lib/models/EncuestaLlamada";

type Params = { params: Promise<{ id: string }> };

/**
 * LA GRABACIÓN DE UNA LLAMADA. ElevenLabs guarda el audio de cada plática; aquí se pide con la llave del servidor (que nunca
 * llega al navegador) y se entrega al reproductor del tablero. Admin y operador, los mismos que operan Encuestas: es la
 * voz de una persona real, y el cliente no llega (withAuth lo frena).
 * Responde por pedazos (Range) para que el reproductor pueda adelantar y regresar.
 */
export const GET = withAuth(async (_user, req: NextRequest, { params }: Params) => {
  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "Esa llamada no existe." }, { status: 404 });
  await dbConnect();
  const l = await EncuestaLlamadaModel.findById(id).select("externoId").lean<{ externoId?: string }>();
  if (!l?.externoId) return NextResponse.json({ error: "Esa llamada no tiene grabación." }, { status: 404 });

  const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(l.externoId)}/audio`, {
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "" },
    cache: "no-store",
  });
  if (!r.ok) return NextResponse.json({ error: "La grabación todavía no está lista o ya no existe." }, { status: 404 });
  const audio = new Uint8Array(await r.arrayBuffer());
  const tipo = r.headers.get("content-type") ?? "audio/mpeg";

  const rango = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (rango) {
    const ini = rango[1] ? Number(rango[1]) : 0;
    const fin = Math.min(audio.length - 1, rango[2] ? Number(rango[2]) : audio.length - 1);
    return new NextResponse(audio.slice(ini, fin + 1), {
      status: 206,
      headers: { "Content-Type": tipo, "Content-Range": `bytes ${ini}-${fin}/${audio.length}`, "Accept-Ranges": "bytes", "Content-Length": String(fin - ini + 1), "Cache-Control": "private, max-age=3600" },
    });
  }
  return new NextResponse(audio, { headers: { "Content-Type": tipo, "Accept-Ranges": "bytes", "Content-Length": String(audio.length), "Cache-Control": "private, max-age=3600" } });
});
