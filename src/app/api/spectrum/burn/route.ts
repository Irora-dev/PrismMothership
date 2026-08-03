import { NextResponse } from "next/server";
import { getBurnProximity } from "@/lib/spectrum/burn-proximity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-basket proximity to the 0.3-ETH PRISM burn threshold, both chains, ranked.
// Auto-discovers baskets from the V2 factory; returns a pre-launch-safe payload
// (empty baskets + configured flags) until the factory address is set.
export async function GET() {
  try {
    const data = await getBurnProximity();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
