import { NextResponse, type NextRequest } from "next/server";
import { withAuth, HttpError } from "@/lib/apiHandler";
import { puedeUsarEncuestas } from "@/lib/encuestas/acceso";
import { leerCampana, campanaPorOmision, resultadosLlamadas, respuestasDe, telefonoVisible, ESTADOS_LLAMADA } from "@/lib/encuestas/llamadas";
import { ZONA } from "@/lib/encuestas/fechas";
import { segmentos } from "@/lib/encuestas/base";
import { clavear } from "@/lib/encuestas/agente_voz";

/** Las encuestas hechas en un archivo que abre Excel: una fila por llamada; de la campaña, solo los últimos 4 dígitos del teléfono. */
export const GET = withAuth(async (user, req: NextRequest) => {
  if (!(await puedeUsarEncuestas(user))) throw new HttpError(403, "Encuestas no está abierto para tu usuario");
  const q = req.nextUrl.searchParams;
  const c = q.get("campana") ? await leerCampana(q.get("campana")) : await campanaPorOmision();
  if (!c) return NextResponse.json({ error: "No existe esa campaña" }, { status: 404 });
  // Con ?pruebas=1 (lo que se esté viendo en el tablero) entran también las de prueba, marcadas en su columna.
  // Con ?municipio=, ?distrito= y ?seccion= (el filtro del tablero) solo entran las llamadas a esas personas de la base del usuario.
  const municipio = q.get("municipio") ?? "", distrito = q.get("distrito") ?? "", seccion = q.get("seccion") ?? "";
  const { contactoIds } = municipio || distrito || seccion ? await segmentos(user.id, { municipio, distrito, seccion }) : { contactoIds: null };
  const r = await resultadosLlamadas(c, { conPruebas: !contactoIds && q.get("pruebas") === "1", contactoIds });
  const celda = (x: string | number | null | undefined) => `"${String(x ?? "").replace(/"/g, '""')}"`;
  const filas = [
    ["#", "Fecha", "Hora", "Teléfono", "Resultado", "Prueba", "Duración (s)", "Versión del guion", ...c.preguntas.map((p) => p.corto ?? p.clave)],
    ...r.llamadas.filter((l) => l.estado !== "EN_CURSO").reverse().map((l, i) => [
      i + 1,
      l.inicio.toLocaleDateString("es-MX", { timeZone: ZONA }),
      l.inicio.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: ZONA }),
      telefonoVisible(l) ?? "",
      ESTADOS_LLAMADA[l.estado]?.label ?? l.estado,
      l.prueba ? "Sí" : "",
      l.segundos ?? "",
      l.versionGuion ?? 1,
      ...respuestasDe(l, c),
    ]),
  ];
  // Con BOM y punto y coma: así Excel en español lo abre con acentos y en columnas, sin pasos extra.
  const csv = "﻿" + filas.map((f) => f.map(celda).join(";")).join("\r\n");
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: ZONA });
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="encuesta-${clavear(c.nombre).slice(0, 40) || "campana"}-${hoy}.csv"`, "Cache-Control": "no-store" },
  });
});
