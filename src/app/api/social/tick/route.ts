import { NextRequest, NextResponse } from "next/server";
import { getBaseProvider, getProvider } from "@/lib/chain/live";
import { broadcast } from "@/lib/social/broadcast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Runs one auto-share pass. Called by the scheduled function (netlify/functions/
// social-post.mts) with the shared secret, so randoms can't trigger posts.
// GET with the secret + ?dry=1 previews what WOULD post without posting.
export async function GET(req: NextRequest) {
  const secret = process.env.SOCIAL_TICK_SECRET;
  const auth = req.headers.get("authorization");
  const q = req.nextUrl.searchParams.get("key");
  if (!secret || (auth !== `Bearer ${secret}` && q !== secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const dryRun = req.nextUrl.searchParams.get("dry") === "1";
  try {
    const result = await broadcast(getProvider(), getBaseProvider(), { dryRun });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "broadcast failed" }, { status: 500 });
  }
}

export const POST = GET;
