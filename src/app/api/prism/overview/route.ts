import { NextResponse } from "next/server";
import { Contract } from "ethers";
import { getProvider, getBaseProvider, fetchLiveStats, fetchHistory } from "@/lib/chain/live";
import type { ActivityEvent } from "@/lib/feed/types";
import { HOOK_ADDRESS, HOOK_ABI, ACC_SCALE } from "@/lib/prism/claim";

// The Prism Hub's overview strip: what one whole Prism has earned (lifetime +
// last 24h, straight off the hook's fee accumulators — historical fact, never a
// projection), the dead-Prism counter, the next big burn (bridge), and the most
// recent burns. The 24h figure is an archive read (acc now vs ~24h of blocks
// ago); if the RPC can't serve archive state it degrades to null. Cached 60s.

export const dynamic = "force-dynamic";

const DAY_BLOCKS = 7200; // ~24h of 12s mainnet blocks

interface Overview {
  perPrism: { lifetimeETH: string; lifetimePRISM: string; eth24h: string | null }; // wei strings
  burned: { total: number; today: number; lastTs: number | null };
  bigBurn: { pendingEth: number; nextTs: number | null };
  recentBurns: { ts: number; prism: number; eth: number; txHash: string; chain: string }[];
  ethUsd: number; // spot prices so the page can render $ equivalents
  prismUsd: number;
  updatedAt: number;
}

let cache: { at: number; data: Overview } | null = null;
const TTL_MS = 60_000;

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) return NextResponse.json(cache.data);
  const eth = getProvider();
  if (!eth) return NextResponse.json({ error: "no provider" }, { status: 503 });
  const base = getBaseProvider();

  try {
    const hook = new Contract(HOOK_ADDRESS, HOOK_ABI, eth);
    const latest = await eth.getBlockNumber();
    const [accEthNow, accPrismNow, stats, burnsRaw, accEthPast] = await Promise.all([
      hook.accFeesPerShareETH() as Promise<bigint>,
      hook.accFeesPerSharePRISM() as Promise<bigint>,
      fetchLiveStats(eth, base),
      fetchHistory("burn", eth, base).catch(() => [] as ActivityEvent[]),
      (hook.accFeesPerShareETH({ blockTag: latest - DAY_BLOCKS }) as Promise<bigint>).catch(() => null),
    ]);

    // one burn tx can emit several legs — collapse by tx hash, newest first
    const byTx = new Map<string, ActivityEvent>();
    for (const e of burnsRaw) {
      if (!e.txHash) continue;
      const cur = byTx.get(e.txHash);
      if (!cur) byTx.set(e.txHash, { ...e });
      else {
        cur.prism = (cur.prism ?? 0) + (e.prism ?? 0);
        cur.eth = (cur.eth ?? 0) + (e.eth ?? 0);
      }
    }
    const recentBurns = [...byTx.values()]
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 5)
      .map((e) => ({ ts: e.ts, prism: e.prism ?? 0, eth: e.eth ?? 0, txHash: e.txHash!, chain: e.chain ?? "ethereum" }));

    const data: Overview = {
      perPrism: {
        lifetimeETH: (accEthNow / ACC_SCALE).toString(),
        lifetimePRISM: (accPrismNow / ACC_SCALE).toString(),
        eth24h: accEthPast != null ? ((accEthNow - accEthPast) / ACC_SCALE).toString() : null,
      },
      burned: { total: stats.totalBurned, today: stats.prismBurnedToday, lastTs: stats.lastBurnTs ?? null },
      bigBurn: {
        pendingEth: stats.bridgePendingEth,
        nextTs: typeof stats.bridgeNextBurnTs === "number" && stats.bridgeNextBurnTs > 0 ? (stats.bridgeNextBurnTs < 1e12 ? stats.bridgeNextBurnTs * 1000 : stats.bridgeNextBurnTs) : null,
      },
      recentBurns,
      ethUsd: stats.ethUsd ?? 0,
      prismUsd: stats.prismUsd ?? 0,
      updatedAt: Date.now(),
    };
    cache = { at: Date.now(), data };
    return NextResponse.json(data);
  } catch (err) {
    console.error("[prism-overview]", err);
    return NextResponse.json({ error: "rpc_unavailable" }, { status: 503 });
  }
}
