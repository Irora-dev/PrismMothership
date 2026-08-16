import { ImageResponse } from "next/og";

// Social share card. Generated as an image (Satori → PNG), so the layout uses
// flexbox + inline styles only. Rendered at runtime (force-dynamic) — NOT
// prerendered at build: at build the /api/feed server isn't up, so the prior
// build-time prerender froze the baseline fallback into the card. The response
// carries a CDN cache header so we don't refetch on every scrape, and social
// platforms cache OG images their side too. Always falls back to a stable
// baseline so it can never fail to render. See liveStats() for the data path.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "The Prism Mothership · the Prism ecosystem, live on-chain";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Mirrors LIFETIME_FLOOR_USD, which is now 0 — the reasoning lives there. The old
// $146k anchor was v1's accrued history, and gating it on PRISM_LIVE was NOT enough:
// the community's v2 relaunch made that gate true again, so the card would have
// advertised the previous token's lifetime revenue as the new token's. v2's own
// history is fully scannable from its pool's creation block, so no floor is needed.
const FLOOR_USD = 0;
const RAINBOW = ["#ff5a5a", "#ff9f45", "#ffe14d", "#5cff8f", "#3bd9ff", "#7c8bff", "#c06aff"];
const usd0 = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

// The brand mark: the pixel-rainbow arch (same geometry as <PixelRainbow/>),
// emitted as an SVG so Satori can rasterize it as an <img>.
function rainbowMark(cell: number) {
  const R = 9;
  const INNER = 3;
  const cols = R * 2 + 1;
  const rows = R + 1;
  const gap = cell * 0.2;
  let rects = "";
  for (let x = -R; x <= R; x++) {
    for (let y = 0; y <= R; y++) {
      const d = Math.round(Math.hypot(x, y));
      if (d < INNER || d > R) continue;
      const rx = (x + R) * cell + gap / 2;
      const ry = (rows - 1 - y) * cell + gap / 2;
      const s = cell - gap;
      rects += `<rect x="${rx}" y="${ry}" width="${s}" height="${s}" rx="${cell * 0.18}" fill="${RAINBOW[R - d]}"/>`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cols * cell} ${rows * cell}" width="${cols * cell}" height="${rows * cell}">${rects}</svg>`;
  return { src: `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`, w: cols * cell, h: rows * cell };
}

// Baseline re-anchored 2026-07-07 (was 11.16 burned / 9 indexes — the stale
// numbers scrapers kept seeing whenever the live fetch missed).
const FALLBACK = { lifetimeUsd: FLOOR_USD, burned: 14.84, indexCount: 2 };

// Pull live stats from /api/feed at runtime. Two things make this reliable where
// the prior version wasn't: (1) we now render dynamically (see the force-dynamic
// note above), so /api/feed is actually serving — the old build-time prerender
// self-fetched a server that wasn't up yet and baked in the fallback; (2) across
// the whole deployment /api/feed is kept warm by the homepage's 20s polling, so
// even a cold OG instance gets a cached response in well under the timeout.
// Reading the chain in-process instead would force THIS instance through the
// full cold-start scan (pool-inception + a 1M-block Base back-scan, 9s+), which
// blows past the render budget and falls back to baseline. base falls back to the
// production origin so a cold/edge runtime that lacks process.env.URL still works.
async function liveStats() {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || "https://prismbeat.netlify.app";
  // Two attempts: a cold /api/feed instance often blows the first timeout while
  // it runs its initial scan — but that same scan warms its cache, so the retry
  // lands on live numbers instead of baking the fallback into scraper caches.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`${base}/api/feed`, { signal: AbortSignal.timeout(attempt === 0 ? 6000 : 9000), cache: "no-store" });
      if (!r.ok) continue;
      const s = ((await r.json()) as { stats?: Record<string, number> }).stats ?? {};
      return {
        lifetimeUsd: Math.max(FLOOR_USD, Math.round((s.feesToHoldersTotal || 0) * (s.ethUsd || 0))),
        burned: typeof s.totalBurned === "number" && s.totalBurned > 0 ? s.totalBurned : FALLBACK.burned,
        // 0 baskets = the pre-env-flip config state, not chain truth — fall back
        indexCount: typeof s.indexCount === "number" && s.indexCount > 0 ? s.indexCount : FALLBACK.indexCount,
      };
    } catch {
      /* retry once, then baseline */
    }
  }
  return FALLBACK;
}

export default async function OpengraphImage() {
  const { lifetimeUsd, burned, indexCount } = await liveStats();
  const mark = rainbowMark(8);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 70,
          background: "linear-gradient(135deg, #100a1f 0%, #07070b 55%, #030307 100%)",
          color: "#f8fafc",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", fontSize: 22, letterSpacing: 4, color: "#86efac", fontWeight: 700 }}>
            <div style={{ width: 14, height: 14, borderRadius: 9999, background: "#22c55e", marginRight: 12 }} />
            LIVE · ON-CHAIN
          </div>
          <div style={{ display: "flex", alignItems: "center", marginTop: 22 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mark.src} width={mark.w} height={mark.h} alt="" style={{ marginRight: 26 }} />
            {/* was "Prismbeat" at 112 — the pre-rebrand wordmark led every unfurl */}
            <div style={{ fontSize: 86, fontWeight: 800, letterSpacing: -1.5 }}>The Prism Mothership</div>
          </div>
          <div style={{ display: "flex", marginTop: 18, fontSize: 34, color: "#cbd5e1" }}>
            The Prism ecosystem, live. Every burn, every trade, the second it lands.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 22, letterSpacing: 3, color: "#86efac", fontWeight: 700 }}>
              LIFETIME REVENUE TO HOLDERS
            </div>
            <div style={{ display: "flex", fontSize: 100, fontWeight: 800, color: "#22c55e", lineHeight: 1, marginTop: 6 }}>
              {usd0(lifetimeUsd)}
            </div>
          </div>
          <div style={{ display: "flex" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", marginRight: 44 }}>
              <div style={{ display: "flex", fontSize: 56, fontWeight: 800, color: "#fb923c" }}>{burned.toFixed(2)}</div>
              <div style={{ display: "flex", fontSize: 20, letterSpacing: 2, color: "#94a3b8", marginTop: 4 }}>PRISM BURNT</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <div style={{ display: "flex", fontSize: 56, fontWeight: 800, color: "#38bdf8" }}>{indexCount}</div>
              <div style={{ display: "flex", fontSize: 20, letterSpacing: 2, color: "#94a3b8", marginTop: 4 }}>BASKETS</div>
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      // Runtime route, but let the CDN + scrapers cache the rasterized card so we
      // don't re-run RPC on every fetch. Live-ish: refreshed at most every 10 min.
      headers: {
        "cache-control": "public, max-age=0, s-maxage=600, stale-while-revalidate=86400",
      },
    },
  );
}
