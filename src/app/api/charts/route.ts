import { NextRequest, NextResponse } from "next/server";
import { isRangeKey, type RangeKey } from "@/lib/feed/types";
import { simulateBasketCharts, simulateCharts } from "@/lib/feed/simulate";
import { CHARTS_TTL_SEC, fetchBasketCharts, fetchLiveCharts } from "@/lib/chain/charts";
import { getBaseProvider, getProvider } from "@/lib/chain/live";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Time-bucketed series for the /charts page. The payload is identical for
// every viewer, so responses carry CDN cache headers: Netlify's edge serves
// the whole audience from one compute per TTL, and the incremental store in
// charts.ts keeps that compute down to a couple of getLogs.
function withCache(body: unknown, ttlSec: number, status = 200) {
  const cc = `public, s-maxage=${ttlSec}, stale-while-revalidate=${ttlSec * 2}`;
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": cc,
      "Netlify-CDN-Cache-Control": cc,
      "CDN-Cache-Control": cc,
      // Netlify's cache does NOT key on the query string for Next.js routes —
      // without this, the first ?range= cached is served for ALL ranges.
      "Netlify-Vary": "query=range|basket",
    },
  });
}

export async function GET(req: NextRequest) {
  const rangeParam = req.nextUrl.searchParams.get("range") ?? "1w";
  const range: RangeKey = isRangeKey(rangeParam) ? rangeParam : "1w";
  const basketParam = req.nextUrl.searchParams.get("basket");
  const basket = basketParam && /^0x[0-9a-fA-F]{40}$/.test(basketParam) ? basketParam : null;

  const provider = getProvider();
  if (!provider) {
    // Simulated series are for development and explicit demos (FEED_MODE=demo)
    // only — a production deploy with no RPC config signals failure like the
    // catch below, instead of quietly serving fake charts as real.
    if (process.env.FEED_MODE === "demo" || process.env.NODE_ENV !== "production") {
      return withCache(basket ? simulateBasketCharts(range, basket, Date.now()) : simulateCharts(range, Date.now()), 60);
    }
    return NextResponse.json({ error: "rpc_unconfigured" }, { status: 503 });
  }

  try {
    const payload = basket
      ? await fetchBasketCharts(provider, getBaseProvider(), range, basket)
      : await fetchLiveCharts(provider, getBaseProvider(), range);
    return withCache(payload, CHARTS_TTL_SEC[range]);
  } catch (err) {
    // real-data only: signal failure instead of quietly serving fake series
    console.error("[charts] live fetch failed:", err);
    return NextResponse.json({ error: "rpc_unavailable" }, { status: 503 });
  }
}
