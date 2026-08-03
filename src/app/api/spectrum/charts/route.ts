import { NextRequest, NextResponse } from "next/server";
import { isRangeKey, type RangeKey } from "@/lib/feed/types";
import { CHARTS_TTL_SEC, fetchLiveSpectrumCharts } from "@/lib/chain/charts";
import { getBaseProvider, getProvider } from "@/lib/chain/live";
import { SPECTRUM_V2 } from "@/lib/chain/constants";
import { emptySpectrumCharts } from "@/lib/spectrum/spectrum-charts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Time-bucketed series for the /spectrum page. BLANK (mode "pending") until the
// V2 factory addresses are wired (SPECTRUM_V2 in chain/constants.ts,
// env-driven) — then the live reader over the TOPIC_V2 events takes over.
// No demo data on this page by design.
export async function GET(req: NextRequest) {
  const rangeParam = req.nextUrl.searchParams.get("range") ?? "1w";
  const range: RangeKey = isRangeKey(rangeParam) ? rangeParam : "1w";

  const cc = `public, s-maxage=${CHARTS_TTL_SEC[range]}, stale-while-revalidate=${CHARTS_TTL_SEC[range] * 2}`;
  const headers = {
    "Cache-Control": cc,
    "Netlify-CDN-Cache-Control": cc,
    "CDN-Cache-Control": cc,
    // Netlify's cache does not key on the query string without this
    "Netlify-Vary": "query=range",
  };

  const eth = getProvider();
  const configured = SPECTRUM_V2.ethFactory || SPECTRUM_V2.baseFactory;
  if (eth && configured) {
    try {
      return NextResponse.json(await fetchLiveSpectrumCharts(eth, getBaseProvider(), range), { headers });
    } catch {
      /* fall through to the pending frame rather than 500 the page */
    }
  }
  return NextResponse.json(emptySpectrumCharts(range, Date.now()), { headers });
}
