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

    const data = await adsPower.startBrowser(profile.adsPowerProfileId);

    profile.lastStatus = "active";
    profile.lastOpenedAt = new Date();
    await profile.save();

    return NextResponse.json({ data });
  },
);
