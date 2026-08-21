import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import SocialAccountModel from "@/lib/models/SocialAccount";
import ProfileModel from "@/lib/models/Profile";
import { withAuth } from "@/lib/apiHandler";
import { allowedGroupFilter } from "@/lib/auth/dal";
import { findUsableProfile } from "@/lib/auth/profiles";

// Las cuentas no llevan dueño propio: cuelgan de un perfil, así que su alcance
// es el mismo que el del perfil — los grupos de AdsPower permitidos.
export const GET = withAuth(async (user, req: NextRequest) => {
  const profileId = req.nextUrl.searchParams.get("profileId") ?? undefined;
  await dbConnect();

  if (profileId) {
    const profile = await findUsableProfile(user, profileId);
    const accounts = await SocialAccountModel.find({ profileId: profile._id }).sort({ createdAt: -1 });
    return NextResponse.json({ accounts });
  }

  // Sin profileId se listan todas, acotadas a los perfiles visibles.
  const visible = await ProfileModel.find(allowedGroupFilter(user)).select("_id").lean();
  const accounts = await SocialAccountModel.find({
    profileId: { $in: visible.map((p) => p._id as Types.ObjectId) },
  }).sort({ createdAt: -1 });

  return NextResponse.json({ accounts });
});

export const POST = withAuth(async (user, req: NextRequest) => {
  const body = await req.json();
  if (!body.profileId || !body.platform || !body.username) {
    return NextResponse.json(
      { error: "'profileId', 'platform' y 'username' son requeridos" },
      { status: 400 },
    );
  }

  await dbConnect();
  const profile = await findUsableProfile(user, String(body.profileId));

  const account = await SocialAccountModel.create({
    profileId: profile._id,
    platform: body.platform,
    username: body.username,
    displayName: body.displayName ?? "",
    notes: body.notes ?? "",
    status: body.status ?? "unknown",
  });

  return NextResponse.json({ account }, { status: 201 });
});
