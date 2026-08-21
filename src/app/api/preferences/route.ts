import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import UserModel, { EMPTY_PREFERENCES } from "@/lib/models/User";
import { withAuth, HttpError } from "@/lib/apiHandler";
import { normalizeHex } from "@/lib/theme";
import { CITIES } from "@/lib/timezones";

// La foto viaja como data URI dentro del JSON. El navegador ya la reduce a
// 256px antes de mandarla (ver /ajustes), así que este tope es una red por si
// alguien llama a la API a mano: 400 KB de base64 son ~300 KB de imagen, de
// sobra para un avatar y lejos del límite de 16 MB de un documento de Mongo.
const MAX_AVATAR_CHARS = 400_000;

function readColor(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") return "";
  const hex = normalizeHex(value);
  if (!hex) throw new HttpError(400, `El color de ${field} no es un hexadecimal válido`);
  return hex;
}

function readText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function readAvatar(value: unknown): string {
  if (typeof value !== "string" || value === "") return "";
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(value)) {
    throw new HttpError(400, "La foto debe ser una imagen PNG, JPEG o WebP");
  }
  if (value.length > MAX_AVATAR_CHARS) {
    throw new HttpError(400, "La foto pesa demasiado; probá con una más chica");
  }
  return value;
}

export const PUT = withAuth(async (user, req: NextRequest) => {
  const body = await req.json();

  const city = typeof body.city === "string" ? body.city : "";
  if (city && !CITIES.some((c) => c.key === city)) {
    throw new HttpError(400, "Esa ciudad no está en la lista");
  }

  // Se reemplaza el bloque entero en vez de mezclar campo por campo: la
  // pantalla manda siempre las seis preferencias, y así vaciar una es
  // simplemente mandarla vacía, sin necesitar un "borrar" aparte.
  const preferences = {
    ...EMPTY_PREFERENCES,
    accentColor: readColor(body.accentColor, "acento"),
    sidebarColor: readColor(body.sidebarColor, "menú"),
    city,
    avatar: readAvatar(body.avatar),
    brandTitle: readText(body.brandTitle, 40),
    brandSubtitle: readText(body.brandSubtitle, 60),
  };

  await dbConnect();
  await UserModel.updateOne({ _id: user.objectId }, { $set: { preferences } });

  return NextResponse.json({ preferences });
});
