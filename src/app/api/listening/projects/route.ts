import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import ListeningProjectModel from "@/lib/models/ListeningProject";
import { withAuth } from "@/lib/apiHandler";
import { providerStatus } from "@/lib/listening/providers";
import { normalizeEntities, DuplicateEntityError } from "@/lib/listening/entities";

export const GET = withAuth(async (user) => {
  await dbConnect();
  const projects = await ListeningProjectModel.find({ ownerId: user.objectId })
    .sort({ createdAt: -1 })
    .lean();
  // El estado de los proveedores viaja con la lista para que la UI pueda
  // avisar "Bright Data está apagado porque falta el token" sin otra llamada.
  return NextResponse.json({ projects, providers: providerStatus() });
});

export const POST = withAuth(async (user, req: NextRequest) => {
  const body = await req.json();

  if (!body?.name?.trim()) {
    return NextResponse.json({ error: "El nombre del proyecto es obligatorio" }, { status: 400 });
  }
  if (!Array.isArray(body.entities) || body.entities.length === 0) {
    return NextResponse.json(
      { error: "Agrega al menos una figura a monitorear" },
      { status: 400 },
    );
  }

  let entities;
  try {
    entities = normalizeEntities(body.entities);
  } catch (err) {
    if (err instanceof DuplicateEntityError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  await dbConnect();

  const project = await ListeningProjectModel.create({
    ownerId: user.objectId,
    name: body.name.trim(),
    description: body.description?.trim(),
    entities,
    includeTerms: body.includeTerms ?? [],
    excludeTerms: body.excludeTerms ?? [],
    languages: body.languages?.length ? body.languages : ["es"],
    whitelistDomains: body.whitelistDomains ?? [],
    blacklistDomains: body.blacklistDomains ?? [],
    rssFeeds: body.rssFeeds ?? [],
    sources: body.sources ?? {},
    brightDataPlatforms: body.brightDataPlatforms ?? [],
    autoAnalyze: body.autoAnalyze ?? true,
    intervalMinutes: body.intervalMinutes ?? 60,
  });

  return NextResponse.json({ project });
});
