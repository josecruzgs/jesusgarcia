import { NextResponse, type NextRequest } from "next/server";
import { listarCampanas, resumenDeCampanas, horarioDe } from "@/lib/encuestas/campanas";
import { noAutorizado } from "@/lib/encuestas/integracion";

/** GET /api/encuestas/v1/campanas — las campañas, con su estado y cómo van. Su `id` es el `campana` de las demás rutas. */
export async function GET(req: NextRequest) {
  const cerrado = noAutorizado(req);
  if (cerrado) return cerrado;
  const campanas = await listarCampanas();
  const r = await resumenDeCampanas(campanas.map((c) => c.id));
  return NextResponse.json({
    ok: true,
    campanas: campanas.map((c) => ({
      id: c.id, nombre: c.nombre, estado: c.estado, preguntas: c.preguntas.length, etiquetas: c.etiquetas,
      horario: horarioDe(c).texto, enHorario: horarioDe(c).abierto,
      destinatarios: r[c.id].destinatarios, llamadas: r[c.id].llamadas, completas: r[c.id].completas, enLinea: r[c.id].enLinea,
    })),
  });
}
