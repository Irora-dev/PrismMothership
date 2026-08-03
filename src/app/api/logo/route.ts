import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Proxy a token logo through our own origin so html2canvas can bake it into the
// exported PNG without tripping over cross-origin canvas tainting. Accepts either
// a Base/ETH contract address (?addr=0x…&chain=base|ethereum) or a direct image
// ?url=. For an address it tries DexScreener's token-image CDN first, then falls
// back to the token-info API (which has a logo for some tokens the CDN doesn't).

const PLACEHOLDER_ID = "5huYtIgLqCYgLRfM"; // DexScreener's generic "no logo" image

function dexCdnUrl(addr: string, chain: string) {
  return `https://dd.dexscreener.com/ds-data/tokens/${chain}/${addr.toLowerCase()}.png?size=lg`;
}

function isPrivateHost(host: string) {
  const h = host.toLowerCase();
  return (
    h === "localhost" ||
    h === "0.0.0.0" ||
    h.endsWith(".local") ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

// Fetch an https image URL → its bytes + type, or null when it's missing, the
// DexScreener placeholder, not an image, oversized, or a disallowed host (SSRF).
async function fetchImage(url: string): Promise<{ buf: ArrayBuffer; type: string } | null> {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || isPrivateHost(u.hostname)) return null;
    const upstream = await fetch(u.toString(), {
      headers: { Accept: "image/*", "User-Agent": "Mozilla/5.0 (prismbeat-studio)" },
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (!upstream.ok) return null;
    if (upstream.url.includes(PLACEHOLDER_ID)) return null; // generic "no logo" → treat as miss
    const type = upstream.headers.get("content-type") || "";
    if (!type.startsWith("image/")) return null;
    const buf = await upstream.arrayBuffer();
    if (buf.byteLength > 3_000_000) return null;
    return { buf, type };
  } catch {
    return null;
  }
}

// DexScreener's token-info API often carries a logo even when the image CDN path
// doesn't. Returns the first https image URL it advertises for the token, or null.
async function dexInfoLogo(addr: string, chain: string): Promise<string | null> {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${addr.toLowerCase()}`, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (prismbeat-studio)" },
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { pairs?: { chainId?: string; info?: { imageUrl?: string } }[] };
    const pairs = j.pairs ?? [];
    const onChain = pairs.find((p) => (p.chainId || "").toLowerCase() === chain && p.info?.imageUrl);
    const img = onChain?.info?.imageUrl || pairs.find((p) => p.info?.imageUrl)?.info?.imageUrl;
    return img && /^https:\/\//i.test(img) ? img : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const addr = sp.get("addr");
  const chain = (sp.get("chain") || "base").toLowerCase().replace(/[^a-z0-9]/g, "") || "base";
  const rawUrl = sp.get("url");

  let img: { buf: ArrayBuffer; type: string } | null = null;

  if (addr && /^0x[a-fA-F0-9]{40}$/.test(addr)) {
    img = await fetchImage(dexCdnUrl(addr, chain)); // 1) token-image CDN
    if (!img) {
      const alt = await dexInfoLogo(addr, chain); // 2) token-info API fallback
      if (alt) img = await fetchImage(alt);
    }
  } else if (rawUrl) {
    img = await fetchImage(rawUrl);
  } else {
    return new NextResponse("bad request", { status: 400 });
  }

  // No real logo found → 404 so the client falls back to ticker initials.
  if (!img) return new NextResponse("no logo", { status: 404 });

  return new NextResponse(img.buf, {
    status: 200,
    headers: {
      "Content-Type": img.type,
      // Not edge-cached: only the Studio uses this, and an immutable response let
      // Netlify's edge collapse every /api/logo hit onto one cache entry.
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
