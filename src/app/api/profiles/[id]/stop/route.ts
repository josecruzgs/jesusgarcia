import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { adsPower } from "@/lib/adspower/client";
import { withAuth } from "@/lib/apiHandler";
import { findUsableProfile } from "@/lib/auth/profiles";

export const POST = withAuth(
  async (user, _req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    await dbConnect();
    const profile = await findUsableProfile(user, id);

    await adsPower.stopBrowser(profile.adsPowerProfileId);

    profile.lastStatus = "inactive";
    await profile.save();

    return NextResponse.json({ ok: true });
  },
);
