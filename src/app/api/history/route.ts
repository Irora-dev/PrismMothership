import { NextRequest, NextResponse } from "next/server";
import { fetchHistory, getBaseProvider, getProvider, isHistoryKind } from "@/lib/chain/live";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Full on-chain history for a single, bounded event kind (burns / launches /
// yield). Backs the feed's filter tabs: toggling "Burns" shows every buy-and-burn
// ever, not just what's left in the live buffer. Results are cached per-kind in
// live.ts, so repeated viewers collapse onto one scan per refresh window.
export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind") ?? "";
  if (!isHistoryKind(kind)) {
    return NextResponse.json({ error: "unsupported_kind", events: [] }, { status: 400 });
  }

  const provider = getProvider();
  if (!provider) {
    // demo mode has no chain to read — the client falls back to buffer filtering
    return NextResponse.json({ mode: "demo", kind, events: [] });
  }

  try {
    const base = getBaseProvider();
    const events = await fetchHistory(kind, provider, base);
    return NextResponse.json({ mode: "live", kind, events });
  } catch (err) {
    console.error("[history] route failed:", err);
    return NextResponse.json({ error: "rpc_unavailable", events: [] }, { status: 503 });
  }
}
