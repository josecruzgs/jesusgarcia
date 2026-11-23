import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/encuestas/acceso";
import { campanaPorOmision } from "@/lib/encuestas/llamadas";
import { asegurarCampanas } from "@/lib/encuestas/campanas";

export const dynamic = "force-dynamic";

/** El guion ahora es de cada campaña (/encuestas/[id]/guion). Los enlaces viejos llevan al de la campaña por omisión. */
export default async function GuionViejo() {
  await requireAdmin();
  await asegurarCampanas();
  const c = await campanaPorOmision();
  redirect(c ? `/encuestas/${c.id}/guion` : "/encuestas");
}
