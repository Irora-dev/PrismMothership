import { NextRequest, NextResponse } from "next/server";

// Same-origin token-logo proxy. The DexScreener CDN sends no ACAO header (and
// 301s dd.dexscreener.com → cdn.dexscreener.com, which breaks crossOrigin img
// loads outright), so the client can never canvas-read its pixels for brand-
// color extraction. Serving the bytes from our own origin makes every logo
// readable — this is what lets the bento tiles wear each asset's REAL color
// (the designer, 2026-08-03). Tightly validated so it can't be used as an open proxy.

export const dynamic = "force-dynamic";

const CHAINS = new Set(["ethereum", "base", "robinhood"]);
const ADDR = /^0x[0-9a-fA-F]{40}$/;

export async function GET(req: NextRequest) {
  const chain = req.nextUrl.searchParams.get("chain") ?? "";
  const address = (req.nextUrl.searchParams.get("address") ?? "").toLowerCase();
  if (!CHAINS.has(chain) || !ADDR.test(address)) {
    return NextResponse.json({ error: "bad_params" }, { status: 400 });
  }
  try {
    const upstream = await fetch(`https://cdn.dexscreener.com/tokens/${chain}/${address}.png?size=lg`, {
      redirect: "follow",
      headers: { Accept: "image/*" },
    });
    if (!upstream.ok) return new NextResponse(null, { status: 404 });
    const bytes = await upstream.arrayBuffer();
    const cc = "public, s-maxage=86400, stale-while-revalidate=604800, max-age=86400";
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "image/png",
        "Cache-Control": cc,
        "Netlify-CDN-Cache-Control": cc,
        "CDN-Cache-Control": cc,
        "Netlify-Vary": "query=chain|address",
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
