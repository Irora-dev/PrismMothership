import { NextRequest, NextResponse } from "next/server";
import { getIndexData, type IndexData } from "@/lib/spectrum/index-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 60s in-memory cache per index (mirrors the other data routes).
const cache = new Map<string, { data: IndexData; at: number }>();
const TTL = 60_000;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  const key = address.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < TTL) {
    return NextResponse.json({ ...cached.data, cached: true });
  }

  try {
    const data = await getIndexData(address);
    cache.set(key, { data, at: Date.now() });
    return NextResponse.json({ ...data, cached: false });
  } catch (err) {
    if (cached) return NextResponse.json({ ...cached.data, cached: true, stale: true });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to read index" },
      { status: 502 },
    );
  }
}
