import { NextResponse } from "next/server";
import { getProvider, getBaseProvider, fetchHistory } from "@/lib/chain/live";
import type { ActivityEvent } from "@/lib/feed/types";

// Cumulative PRISM burn series for the /robinhood chart tile (and anywhere else
// that wants the burn story as a line): every buy-and-burn ever, collapsed by
// tx, accumulated oldest→newest. Protocol-wide (the burn leg settles on
// Ethereum). Cached 5 min — burns are rare events.

export const dynamic = "force-dynamic";

interface BurnPoint {
  ts: number;
  total: number; // cumulative PRISM burned
  amount: number; // this burn's PRISM
}

let cache: { at: number; data: { points: BurnPoint[]; total: number; today: number } } | null = null;
const TTL_MS = 300_000;

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) return NextResponse.json(cache.data);
  const eth = getProvider();
  if (!eth) return NextResponse.json({ error: "no provider" }, { status: 503 });

  try {
    const burns = await fetchHistory("burn", eth, getBaseProvider());
    // collapse legs by tx, keep PRISM-denominated burns, oldest first
    const byTx = new Map<string, ActivityEvent>();
    for (const e of burns) {
      if (!e.txHash) continue;
      const cur = byTx.get(e.txHash);
      if (!cur) byTx.set(e.txHash, { ...e });
      else cur.prism = (cur.prism ?? 0) + (e.prism ?? 0);
    }
    const ordered = [...byTx.values()].filter((e) => (e.prism ?? 0) > 0).sort((a, b) => a.ts - b.ts);
    let total = 0;
    const points: BurnPoint[] = ordered.map((e) => {
      total += e.prism!;
      return { ts: e.ts, total: Number(total.toFixed(4)), amount: Number(e.prism!.toFixed(4)) };
    });
    const dayAgo = Date.now() - 86_400_000;
    const today = ordered.filter((e) => e.ts >= dayAgo).reduce((s, e) => s + (e.prism ?? 0), 0);
    const data = { points, total: Number(total.toFixed(4)), today: Number(today.toFixed(4)) };
    cache = { at: Date.now(), data };
    return NextResponse.json(data);
  } catch (err) {
    console.error("[burn-series]", err);
    return NextResponse.json({ error: "rpc_unavailable" }, { status: 503 });
  }
}
