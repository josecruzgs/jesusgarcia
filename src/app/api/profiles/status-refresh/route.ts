import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import ProfileModel from "@/lib/models/Profile";
import { adsPower } from "@/lib/adspower/client";
import { withAuth } from "@/lib/apiHandler";
import { allowedGroupFilter } from "@/lib/auth/dal";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// "lastStatus" solo se actualizaba al usar los botones Iniciar/Detener de
// esta app, así que cualquier perfil sincronizado desde AdsPower (sin haber
// pasado por esos botones) se queda en "unknown" para siempre. Este
// endpoint consulta el estado real en AdsPower para un lote acotado de
// perfiles (los de la página visible, no los 100+ de golpe: la Local API
// rate-limitea ~1 req/seg).
export const POST = withAuth(async (user, req: NextRequest) => {
  const body = await req.json();
  const ids: string[] = Array.isArray(body.ids) ? body.ids.slice(0, 20) : [];
  if (ids.length === 0) {
    return NextResponse.json({ statuses: {} });
  }

  await dbConnect();
  // Los que caen fuera del alcance simplemente no vuelven: es un refresco de
  // la página visible, no una selección explícita que valga la pena rechazar.
  const profiles = await ProfileModel.find({ _id: { $in: ids }, ...allowedGroupFilter(user) });

  const statuses: Record<string, string> = {};
  for (const [i, profile] of profiles.entries()) {
    if (i > 0) await sleep(350);
    try {
      const { status } = await adsPower.browserStatus(profile.adsPowerProfileId);
      const lastStatus = status === "Active" ? "active" : "inactive";
      if (profile.lastStatus !== lastStatus) {
        profile.lastStatus = lastStatus;
        await profile.save();
      }
      statuses[String(profile._id)] = lastStatus;
    } catch {
      // AdsPower caído o el perfil no existe ahí ya: se deja el estado
      // guardado tal cual, no se rompe el lote completo por un perfil.
      statuses[String(profile._id)] = profile.lastStatus;
    }
  }

  return NextResponse.json({ statuses });
});
