import { NextResponse } from "next/server";
import { listIndexes, type IndexSummary } from "@/lib/spectrum/index-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cache: { data: IndexSummary[]; at: number } | null = null;
const TTL = 60_000;

export async function GET() {
  if (cache && Date.now() - cache.at < TTL) {
    return NextResponse.json({ indexes: cache.data, cached: true });
  }
  try {
    // Hide 0-TVL indexes from the explorer (empty / broken / unpriced pools) so
    // users aren't shown something risky to buy into. The dashboard headline still
    // counts every launch — that path calls listIndexes() directly, not this route.
    const data = (await listIndexes()).filter((i) => (i.aumUsd ?? 0) > 0);
    cache = { data, at: Date.now() };
    return NextResponse.json({ indexes: data, cached: false });
  } catch (err) {
    if (cache) return NextResponse.json({ indexes: cache.data, cached: true, stale: true });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list indexes" },
      { status: 502 },
    );
  }
}
