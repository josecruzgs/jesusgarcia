import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import CommentModel from "@/lib/models/Comment";
import { withAuth } from "@/lib/apiHandler";

// Cada usuario tiene su propio banco: la marca "used" es por dueño, así que un
// texto que gastó uno le sigue estando disponible a los demás.
export const GET = withAuth(async (user, req: NextRequest) => {
  const usedParam = req.nextUrl.searchParams.get("used");
  const limit = Number(req.nextUrl.searchParams.get("limit")) || 0;

  await dbConnect();
  const mine = { ownerId: user.objectId };
  const filter =
    usedParam === "true"
      ? { ...mine, used: true }
      : usedParam === "false"
        ? { ...mine, used: false }
        : mine;

  let query = CommentModel.find(filter).sort({ createdAt: 1 });
  if (limit > 0) query = query.limit(limit);
  const comments = await query;

  const [total, available] = await Promise.all([
    CommentModel.countDocuments(mine),
    CommentModel.countDocuments({ ...mine, used: false }),
  ]);

  return NextResponse.json({ comments, total, available, used: total - available });
});

// Agrega comentarios al banco desde una lista escrita a mano: un texto por
// línea, que el cliente manda ya partido en `comments`.
//
// Acá vivía además una importación desde un Google Sheet publicado como CSV.
// Se quitó a pedido: el banco se llena solo desde la caja de texto. Si alguna
// vez hiciera falta volver a traer textos de afuera, esto recibe un arreglo de
// cadenas y lo demás (deduplicar, contar) ya funciona igual sea cual sea el
// origen — lo único que habría que reponer es de dónde sale el arreglo.
export const POST = withAuth(async (user, req: NextRequest) => {
  const body = await req.json();
  await dbConnect();
  const mine = { ownerId: user.objectId };

  const texts: string[] = Array.isArray(body.comments)
    ? body.comments.map((t: unknown) => String(t).trim()).filter(Boolean)
    : [];

  if (texts.length === 0) {
    return NextResponse.json({ error: "No se encontraron comentarios para importar" }, { status: 400 });
  }

  // Evita duplicados exactos que ya estén en el banco propio (de cualquier
  // origen). Que otro usuario tenga el mismo texto no cuenta como duplicado.
  const existing = new Set(
    (await CommentModel.find({ ...mine, text: { $in: texts } }).select("text")).map((c) => c.text),
  );
  const fresh = texts.filter((t) => !existing.has(t));

  if (fresh.length > 0) {
    await CommentModel.insertMany(fresh.map((text) => ({ ...mine, text })));
  }

  const [total, available] = await Promise.all([
    CommentModel.countDocuments(mine),
    CommentModel.countDocuments({ ...mine, used: false }),
  ]);

  return NextResponse.json({ imported: fresh.length, skipped: texts.length - fresh.length, total, available });
});

// Vacía el banco por completo (a diferencia de /reset-used, esto borra los
// documentos en vez de solo volver a marcarlos como disponibles).
export const DELETE = withAuth(async (user) => {
  await dbConnect();
  await CommentModel.deleteMany({ ownerId: user.objectId });
  return NextResponse.json({ ok: true, total: 0, available: 0 });
});
