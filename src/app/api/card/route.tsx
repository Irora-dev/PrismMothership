import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

// ── Live stat cards for the Telegram bot (and anything else) ─────────────────
// GET /api/card?kind=digest|price|burn|earned → a 1200×630 branded PNG with
// live numbers. Satori rules apply: flexbox only, inline styles, SVG via data
// URIs. The bot attaches these as photos, so the daily digest and the money
// commands land in the channel as Mothership-branded cards, not plain text.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RAINBOW = ["#ff5a5a", "#ff9f45", "#ffe14d", "#5cff8f", "#3bd9ff", "#7c8bff", "#c06aff"];
const C = { green: "#00FF87", orange: "#FF5E00", cyan: "#00F0FF", purple: "#9D00FF", ground: "#030409" };

function rainbowMark(cell: number) {
  const R = 9, INNER = 3;
  const cols = R * 2 + 1, rows = R + 1, gap = cell * 0.2;
  let rects = "";
  for (let x = -R; x <= R; x++) for (let y = 0; y <= R; y++) {
    const d = Math.round(Math.hypot(x, y));
    if (d < INNER || d > R) continue;
    rects += `<rect x="${(x + R) * cell + gap / 2}" y="${(rows - 1 - y) * cell + gap / 2}" width="${cell - gap}" height="${cell - gap}" rx="${cell * 0.18}" fill="${RAINBOW[R - d]}"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cols * cell} ${rows * cell}" width="${cols * cell}" height="${rows * cell}">${rects}</svg>`;
  return { src: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, w: cols * cell, h: rows * cell };
}

interface S { feesToHolders24h: number; feesToHoldersTotal: number; ethUsd: number; prismUsd?: number; totalBurned: number; supply: number; cap: number; indexCount: number; prismBurnedToday: number; }
async function stats(): Promise<S | null> {
  // walk every plausible origin: the configured URL can point at a different
  // (or down) deployment while this instance can serve the stats itself —
  // in dev that self origin is the localhost server.
  const bases = [...new Set([process.env.URL, process.env.DEPLOY_PRIME_URL, "http://localhost:3588", "http://localhost:3090"].filter(Boolean))] as string[];
  for (let i = 0; i < 2; i++) {
    for (const base of bases) {
      try {
        const r = await fetch(`${base}/api/feed`, { signal: AbortSignal.timeout(i ? 9000 : 5000), cache: "no-store" });
        if (!r.ok) continue;
        const s = ((await r.json()) as { stats?: S }).stats;
        if (s && s.cap > 0) return s;
      } catch { /* next candidate */ }
    }
  }
  return null;
}

const usd = (n: number, d = 2) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: d > 0 && n < 1000 ? d : 0, maximumFractionDigits: d > 0 && n < 1000 ? d : 0 });
const num = (n: number, d = 2) => n.toLocaleString("en-US", { maximumFractionDigits: d });

// shared chrome: ground + ambient blooms + glass panel + brand row + foil rule
function Frame({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  const mark = rainbowMark(7);
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", background: C.ground, fontFamily: "sans-serif", position: "relative" }}>
      <div style={{ position: "absolute", top: -180, left: -120, width: 560, height: 560, borderRadius: 9999, background: `${accent}22`, filter: "blur(120px)", display: "flex" }} />
      <div style={{ position: "absolute", bottom: -220, right: -100, width: 620, height: 620, borderRadius: 9999, background: `${C.purple}1f`, filter: "blur(130px)", display: "flex" }} />
      <div style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 6, display: "flex", background: `linear-gradient(90deg, ${RAINBOW.join(",")})` }} />
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: 56, justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mark.src} width={mark.w} height={mark.h} alt="" style={{ marginRight: 20 }} />
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: 6, color: "#f8fafc" }}>THE PRISM MOTHERSHIP</div>
              <div style={{ display: "flex", alignItems: "center", marginTop: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: 9999, background: C.green, marginRight: 10, display: "flex" }} />
                <div style={{ fontSize: 18, letterSpacing: 4, color: "#64748b", fontWeight: 700 }}>LIVE · ON-CHAIN</div>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 22, fontWeight: 800, letterSpacing: 5, color: accent, border: `2px solid ${accent}55`, borderRadius: 9999, padding: "10px 26px", background: `${accent}14` }}>{title}</div>
        </div>
        {children}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", fontSize: 19, color: "#475569" }}>Figures track third-party trading — they vary and can be zero.</div>
          <div style={{ display: "flex", fontSize: 20, color: "#64748b", fontWeight: 700, letterSpacing: 2 }}>@SpectraPrismBot</div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent, big }: { label: string; value: string; accent: string; big?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", padding: big ? "30px 40px" : "24px 32px", borderRadius: 24, background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.09)", borderTop: `3px solid ${accent}`, flexGrow: big ? 1.5 : 1, marginRight: 22 }}>
      <div style={{ display: "flex", fontSize: 19, letterSpacing: 4, color: "#7c8aa0", fontWeight: 700 }}>{label}</div>
      <div style={{ display: "flex", fontSize: big ? 88 : 54, fontWeight: 800, color: "#ffffff", letterSpacing: -2, marginTop: 8 }}>{value}</div>
    </div>
  );
}

function burnBar(pct: number) {
  const w = 1000, h = 26, fill = Math.max(8, Math.min(w, (pct / 100) * w));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="13" fill="rgba(255,255,255,0.07)"/><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0">${RAINBOW.map((c, i) => `<stop offset="${(i / (RAINBOW.length - 1)) * 100}%" stop-color="${c}"/>`).join("")}</linearGradient></defs><rect width="${fill}" height="${h}" rx="13" fill="url(#g)"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind") || "digest";
  const s = await stats();
  const f = s ?? { feesToHolders24h: 0, feesToHoldersTotal: 0, ethUsd: 0, prismUsd: 0, totalBurned: 0, supply: 5000, cap: 5000, indexCount: 0, prismBurnedToday: 0 };
  const pct = f.cap > 0 ? (f.totalBurned / f.cap) * 100 : 0;

  let body: React.ReactNode;
  let title = "DAILY DIGEST";
  let accent = C.green;

  if (kind === "price") {
    title = "PRISM PRICE"; accent = C.cyan;
    body = (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <div style={{ display: "flex", fontSize: 150, fontWeight: 800, color: "#fff", letterSpacing: -4 }}>{usd(f.prismUsd ?? 0)}</div>
          <div style={{ display: "flex", fontSize: 34, color: C.cyan, marginLeft: 26, marginBottom: 26, fontWeight: 700 }}>per PRISM</div>
        </div>
        <div style={{ display: "flex", marginTop: 34 }}>
          <Stat label="MARKET CAP" value={usd((f.prismUsd ?? 0) * f.supply, 0)} accent={C.cyan} />
          <Stat label="FEES TO HOLDERS · 24H" value={usd(f.feesToHolders24h * f.ethUsd)} accent={C.green} />
          <Stat label="BURNED FOREVER" value={num(f.totalBurned)} accent={C.orange} />
        </div>
      </div>
    );
  } else if (kind === "burn" || kind === "supply") {
    title = "THE BURN"; accent = C.orange;
    body = (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <div style={{ display: "flex", fontSize: 140, fontWeight: 800, color: "#fff", letterSpacing: -4 }}>{num(f.totalBurned)}</div>
          <div style={{ display: "flex", fontSize: 34, color: C.orange, marginLeft: 24, marginBottom: 24, fontWeight: 700 }}>of {num(f.cap, 0)} burned forever · {pct.toFixed(2)}%</div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={burnBar(pct)} width={1000} height={26} alt="" style={{ marginTop: 30 }} />
        <div style={{ display: "flex", marginTop: 34 }}>
          <Stat label="BURNED · 24H" value={num(f.prismBurnedToday, 4)} accent={C.orange} />
          <Stat label="CIRCULATING" value={num(f.supply)} accent={C.cyan} />
          <Stat label="SUPPLY ONLY SHRINKS" value="Forever" accent={C.purple} />
        </div>
      </div>
    );
  } else if (kind === "earned") {
    title = "EARNED PER PRISM"; accent = C.purple;
    const per = f.supply > 0 ? (f.feesToHoldersTotal * f.ethUsd) / f.supply : 0;
    body = (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <div style={{ display: "flex", fontSize: 150, fontWeight: 800, color: "#fff", letterSpacing: -4 }}>{usd(per)}</div>
          <div style={{ display: "flex", fontSize: 32, color: C.purple, marginLeft: 26, marginBottom: 26, fontWeight: 700, maxWidth: 380 }}>per whole PRISM held since day one</div>
        </div>
        <div style={{ display: "flex", marginTop: 34 }}>
          <Stat label="ALL-TIME TO HOLDERS" value={usd(f.feesToHoldersTotal * f.ethUsd, 0)} accent={C.green} />
          <Stat label="FEE-SHARE NFTS" value={num(f.supply, 0)} accent={C.cyan} />
        </div>
      </div>
    );
  } else {
    body = (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex" }}>
          <Stat big label="FEES TO HOLDERS · 24H" value={usd(f.feesToHolders24h * f.ethUsd)} accent={C.green} />
          <Stat big label="PRISM BURNED · 24H" value={num(f.prismBurnedToday, 4)} accent={C.orange} />
        </div>
        <div style={{ display: "flex", marginTop: 24 }}>
          <Stat label="LIVE BASKETS" value={num(f.indexCount, 0)} accent={C.purple} />
          <Stat label="BURNED ALL-TIME" value={`${num(f.totalBurned)} / ${num(f.cap, 0)}`} accent={C.orange} />
          <Stat label="PRISM PRICE" value={usd(f.prismUsd ?? 0)} accent={C.cyan} />
        </div>
      </div>
    );
  }

  return new ImageResponse(<Frame title={title} accent={accent}>{body}</Frame>, {
    width: 1200,
    height: 630,
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
  });
}
