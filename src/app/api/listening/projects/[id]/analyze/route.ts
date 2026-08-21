import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/apiHandler";
import { dbConnect } from "@/lib/mongodb";
import { assertOwnedProject } from "@/lib/listening/ownership";
import { analyzeMentions } from "@/lib/listening/analyze";

type Params = { params: Promise<{ id: string }> };

/** Clasifica con Claude las menciones que quedaron sin analizar. */
export const POST = withAuth(async (user, req: NextRequest, { params }: Params) => {
  const { id } = await params;

  await dbConnect();
  await assertOwnedProject(user, id);

  // ?reanalyze=1 vuelve a juzgar TODO, no solo lo pendiente.
  const reanalyze = req.nextUrl.searchParams.get("reanalyze") === "1";
  const analyzed = await analyzeMentions(id, reanalyze ? 1000 : 200, { reanalyze });
  return NextResponse.json({ analyzed });
});
