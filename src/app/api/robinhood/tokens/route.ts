import { NextResponse } from "next/server";
import { RH_TOKENS } from "@/lib/robinhood/tokens";

// Live market facts for the /robinhood token cards — DexScreener per token
// (best-liquidity pair), no key. ALPHABETICAL order is preserved from the
// registry: this endpoint never sorts by market size (no preferential
// promotion). Cached 60s.

export const dynamic = "force-dynamic";

interface DexPair {
  priceUsd?: string;
  priceChange?: { h1?: number; h6?: number; h24?: number };
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  fdv?: number;
  marketCap?: number;
}

export interface RhTokenQuote {
  id: string;
  symbol: string;
  name: string;
  address: string;
  accent: string;
  logo: string;
  priceUsd: number | null;
  change1hPct: number | null;
  change6hPct: number | null;
  change24hPct: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  fdvUsd: number | null;
}

let cache: { at: number; data: { tokens: RhTokenQuote[]; updatedAt: number } } | null = null;
const TTL_MS = 60_000;

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) return NextResponse.json(cache.data);

  const tokens: RhTokenQuote[] = await Promise.all(
    RH_TOKENS.map(async (t) => {
      const empty: RhTokenQuote = { ...t, priceUsd: null, change1hPct: null, change6hPct: null, change24hPct: null, liquidityUsd: null, volume24hUsd: null, fdvUsd: null };
      try {
        const r = await fetch(`https://api.dexscreener.com/token-pairs/v1/robinhood/${t.address}`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        });
        if (!r.ok) return empty;
        const pairs = (await r.json()) as DexPair[];
        if (!Array.isArray(pairs) || !pairs.length) return empty;
        const best = pairs.reduce((a, b) => ((b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a));
        return {
          ...t,
          priceUsd: best.priceUsd != null ? Number(best.priceUsd) : null,
          change1hPct: best.priceChange?.h1 ?? null,
          change6hPct: best.priceChange?.h6 ?? null,
          change24hPct: best.priceChange?.h24 ?? null,
          liquidityUsd: best.liquidity?.usd ?? null,
          volume24hUsd: best.volume?.h24 ?? null,
          fdvUsd: best.fdv ?? best.marketCap ?? null,
        };
      } catch {
        return empty;
      }
    }),
  );

  const data = { tokens, updatedAt: Date.now() };
  cache = { at: Date.now(), data };
  return NextResponse.json(data);
}
