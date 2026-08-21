import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import ProfileModel from "@/lib/models/Profile";
import { withAuth } from "@/lib/apiHandler";
import { allowedGroupFilter } from "@/lib/auth/dal";

// Lista de etiquetas distintas en uso (para poblar el filtro) — no la
// paginada de perfiles, que solo trae las de la página visible.
export const GET = withAuth(async (user) => {
  await dbConnect();
  const tags = await ProfileModel.aggregate([
    // Solo las etiquetas de los perfiles visibles: si no, el filtro ofrecería
    // opciones de grupos ajenos que no devuelven ningún resultado.
    { $match: allowedGroupFilter(user) },
    { $unwind: "$tags" },
    { $group: { _id: "$tags.name", color: { $first: "$tags.color" } } },
    { $project: { _id: 0, name: "$_id", color: 1 } },
    { $sort: { name: 1 } },
  ]);
  return NextResponse.json({ tags });
});
