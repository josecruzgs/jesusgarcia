import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/apiHandler";
import { assertOwnedProject } from "@/lib/listening/ownership";
import { ingestProject } from "@/lib/listening/ingest";
import { analyzeMentions } from "@/lib/listening/analyze";
import ListeningProjectModel from "@/lib/models/ListeningProject";
import { dbConnect } from "@/lib/mongodb";

type Params = { params: Promise<{ id: string }> };

/** Corrida manual: trae menciones nuevas y, si el proyecto lo pide, las analiza. */
export const POST = withAuth(async (user, _req: NextRequest, { params }: Params) => {
  const { id } = await params;

  // Antes de ingerir: la corrida gasta cuota de los proveedores, así que
  // dispararla sobre un proyecto ajeno costaría dinero además de filtrar datos.
  await dbConnect();
  await assertOwnedProject(user, id);

  const report = await ingestProject(id);

  const project = await ListeningProjectModel.findById(id).select("autoAnalyze").lean();

  let analyzed = 0;
  let analysisError: string | null = null;

  if (project?.autoAnalyze) {
    // El análisis falla si falta la API key de Claude. Eso no debe hacer
    // fallar la ingesta, que ya trajo datos útiles.
    try {
      analyzed = await analyzeMentions(id);
    } catch (err) {
      analysisError = err instanceof Error ? err.message : String(err);
    }
  }

  return NextResponse.json({ report, analyzed, analysisError });
});
