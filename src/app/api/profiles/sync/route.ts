import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import ProfileModel from "@/lib/models/Profile";
import { adsPower } from "@/lib/adspower/client";
import type { AdsPowerProfile } from "@/lib/adspower/types";
import { withAuth } from "@/lib/apiHandler";
import { allowedGroupFilter, isAdmin } from "@/lib/auth/dal";
import { assertGroupAllowed } from "@/lib/auth/profiles";
import { parseRemark } from "@/lib/remark";

// AdsPower no tiene un concepto de "plataforma" en su API — lo inferimos
// del dominio que el perfil tenía abierto la última vez, cuando está
// disponible. Si no matchea nada conocido, se deja como está (no se borra
// un valor puesto a mano).
function inferPlatform(domainName?: string): string {
  const d = (domainName ?? "").toLowerCase();
  if (d.includes("facebook")) return "facebook";
  if (d.includes("instagram")) return "instagram";
  if (d.includes("tiktok")) return "tiktok";
  if (d.includes("twitter") || d.includes("x.com")) return "x";
  if (d.includes("linkedin")) return "linkedin";
  return "";
}

// Trae los perfiles desde AdsPower y sincroniza (upsert) en Mongo.
//
// Lo puede correr cualquier usuario, pero NO hace lo mismo para todos:
//
// - Admin: recorre AdsPower entero y además BORRA de Mongo todo perfil que
//   AdsPower no haya devuelto, porque es la fuente de verdad y así /profiles
//   no muestra fantasmas.
// - Operador: recorre solo los grupos que tiene asignados y no borra nada.
//   Un operador ve una rebanada del universo por definición, así que "no
//   apareció en mi barrida" no significa "ya no existe": si borrara, cada
//   sincronización suya vaciaría los perfiles de los grupos ajenos. Refrescar
//   nombres, etiquetas, edad y género —que es para lo que lo necesita— no
//   requiere poder borrar.
export const POST = withAuth(async (user, req: NextRequest) => {
  const groupId = req.nextUrl.searchParams.get("groupId") ?? undefined;
  if (groupId) assertGroupAllowed(user, groupId);

  const admin = isAdmin(user);

  // Qué le pedimos a AdsPower. `undefined` es "sin filtro de grupo"; para el
  // operador sin grupo pedido son varias barridas, una por grupo permitido, y
  // la lista vacía es un resultado válido: no tiene nada que sincronizar.
  const scopes: (string | undefined)[] = groupId ? [groupId] : admin ? [undefined] : user.groupIds;

  await dbConnect();

  // Secuencial a propósito: la Local API de AdsPower rate-limitea ~1 req/seg y
  // listAllProfiles ya pagina internamente. En paralelo se gana poco y se
  // empieza a comer 429s.
  const list: AdsPowerProfile[] = [];
  for (const scope of scopes) {
    list.push(...(await adsPower.listAllProfiles(scope)));
  }

  for (const p of list) {
    const remark = p.remark ?? "";
    const { age, gender } = parseRemark(remark);
    const tags = (p.fbcc_user_tag ?? []).map((t) => ({ name: t.name, color: t.color }));
    const update: Record<string, unknown> = { name: p.name, groupId: p.group_id, remark, age, gender, tags };
    const inferredPlatform = inferPlatform(p.domain_name);
    if (inferredPlatform) update.platform = inferredPlatform;

    await ProfileModel.updateOne({ adsPowerProfileId: p.user_id }, { $set: update }, { upsert: true });
  }

  // AdsPower es la fuente de verdad: cualquier perfil que ya no aparezca ahi
  // (borrado, renombrado de user_id, etc.) se elimina tambien de Mongo para
  // que /profiles no muestre perfiles fantasma. Solo para el admin, que es el
  // único cuya barrida cubre todo lo que debería existir.
  let deletedCount = 0;
  if (admin) {
    const currentIds = list.map((p) => p.user_id);
    const staleFilter: Record<string, unknown> = { adsPowerProfileId: { $nin: currentIds } };
    if (groupId) staleFilter.groupId = groupId;
    ({ deletedCount } = await ProfileModel.deleteMany(staleFilter));
  }

  // allowedGroupFilter no filtra nada para el admin, así que cubre los dos casos.
  const readFilter = groupId ? { groupId } : allowedGroupFilter(user);
  const profiles = await ProfileModel.find(readFilter).sort({ name: 1 });
  return NextResponse.json({ profiles, removed: deletedCount ?? 0 });
});
