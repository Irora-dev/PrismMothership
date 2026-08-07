import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { listIndexes } from "@/lib/spectrum/index-data";
import { getRegistry, registeredChats } from "@/lib/social/group-registry";
import { validateAddress } from "@/lib/social/token-validate";
import { getDraft } from "@/lib/social/group-draft";
import { squarify } from "@/lib/spectrum/treemap";
import { tokenVisual } from "@/lib/spectrum/token-visual";

// ── Live stat cards for the Telegram bot (and anything else) ─────────────────
// GET /api/card?kind=digest|price|burn|earned → a 1200×630 branded PNG with
// live numbers. Satori rules apply: flexbox only, inline styles, SVG via data
// URIs. The bot attaches these as photos, so the daily digest and the money
// commands land in the channel as Mothership-branded cards, not plain text.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RAINBOW = ["#ff5a5a", "#ff9f45", "#ffe14d", "#5cff8f", "#3bd9ff", "#7c8bff", "#c06aff"];
// Spectrum is its OWN product with its own brand — baskets, the portfolio and
// anything the launchpad owns wear this, never the Prism mark. Its exact
// gradient, lifted from the operator site's .spectrum-text-gradient.
const SPECTRUM_RAINBOW = ["#ef4444", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7"];
type Brand = "prism" | "spectrum";
// Which surfaces belong to Spectrum. Everything basket- or portfolio-shaped.
const SPECTRUM_KINDS = new Set([
  "baskets", "league", "ourbasket", "watchlist", "split", "idea", "draftcard",
  "bento", "portfolio", "launch", "me", "pnl", "buy", "reweight",
]);
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
const ORIGINS = [...new Set([process.env.URL, process.env.DEPLOY_PRIME_URL, "http://localhost:3588", "http://localhost:3090"].filter(Boolean))] as string[];
async function fetchFirst<T>(path: string, pick: (j: unknown) => T | null, timeoutMs = 8000): Promise<T | null> {
  for (const base of ORIGINS) {
    try {
      const r = await fetch(`${base}${path}`, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) continue;
      const v = pick(await r.json());
      if (v != null) return v;
    } catch { /* next origin */ }
  }
  return null;
}

async function stats(): Promise<S | null> {
  // walk every plausible origin: the configured URL can point at a different
  // (or down) deployment while this instance can serve the stats itself —
  // in dev that self origin is the localhost server.
  for (let i = 0; i < 2; i++) {
    for (const base of ORIGINS) {
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
// The Spectrum wordmark: the name under its own rainbow rule, no Prism mark.
function SpectrumMark() {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", fontSize: 40, fontWeight: 800, letterSpacing: 10, color: "#f8fafc" }}>SPECTRUM</div>
      <div style={{ display: "flex", width: 250, height: 5, borderRadius: 3, marginTop: 8, background: `linear-gradient(90deg, ${SPECTRUM_RAINBOW.join(",")})` }} />
    </div>
  );
}

function Frame({ title, accent, brand = "prism", children }: { title: string; accent: string; brand?: Brand; children: React.ReactNode }) {
  const mark = rainbowMark(7);
  const isSpectrum = brand === "spectrum";
  const rule = isSpectrum ? SPECTRUM_RAINBOW : RAINBOW;
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", background: C.ground, fontFamily: "sans-serif", position: "relative" }}>
      <div style={{ position: "absolute", top: -180, left: -120, width: 560, height: 560, borderRadius: 9999, background: `${accent}22`, filter: "blur(120px)", display: "flex" }} />
      <div style={{ position: "absolute", bottom: -220, right: -100, width: 620, height: 620, borderRadius: 9999, background: `${C.purple}1f`, filter: "blur(130px)", display: "flex" }} />
      <div style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 6, display: "flex", background: `linear-gradient(90deg, ${rule.join(",")})` }} />
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: 56, justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            {isSpectrum ? (
              <SpectrumMark />
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mark.src} width={mark.w} height={mark.h} alt="" style={{ marginRight: 20 }} />
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: 6, color: "#f8fafc" }}>THE PRISM MOTHERSHIP</div>
                  <div style={{ display: "flex", alignItems: "center", marginTop: 6 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 9999, background: C.green, marginRight: 10, display: "flex" }} />
                    <div style={{ fontSize: 18, letterSpacing: 4, color: "#64748b", fontWeight: 700 }}>LIVE · ON-CHAIN</div>
                  </div>
                </div>
              </>
            )}
          </div>
          <div style={{ display: "flex", fontSize: 22, fontWeight: 800, letterSpacing: 5, color: accent, border: `2px solid ${accent}55`, borderRadius: 9999, padding: "10px 26px", background: `${accent}14` }}>{title}</div>
        </div>
        {children}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", fontSize: 19, color: "#475569" }}>
            {isSpectrum ? "Spectrum · figures track third-party trading and can be zero." : "Figures track third-party trading — they vary and can be zero."}
          </div>
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

// ── The Spectrum bento, Satori edition ────────────────────────────────────────
// Same design system as src/components/spectrum/basket-bento.tsx: the squarified
// treemap (weight^0.65 areas), tokenVisual brand colors, white ticker pill,
// weight in the token's ink, 3D tile (top highlight → bottom shade). Logos are
// deliberately skipped — the component's own documented degradation ("color +
// ticker then carry the tile"), and a dead logo URL can never kill a render.
interface BentoTile { symbol: string; address: string; weightPct: number; badge?: string }
function Bento({ items, w, h }: { items: BentoTile[]; w: number; h: number }) {
  const rects = squarify(
    items.filter((i) => i.weightPct > 0).map((i) => ({ ticker: i.address, weight: Math.pow(i.weightPct, 0.65) })),
    w,
    h,
  );
  const byAddr = new Map(items.map((i) => [i.address.toLowerCase(), i]));
  return (
    <div style={{ display: "flex", position: "relative", width: w, height: h }}>
      {rects.map((rc) => {
        const it = byAddr.get(rc.ticker.toLowerCase());
        if (!it) return null;
        const vis = tokenVisual(it.symbol, it.address);
        const minDim = Math.min(rc.w, rc.h);
        const tickerFont = Math.max(13, Math.min(26, minDim * 0.15));
        const badgeFont = Math.max(14, Math.min(28, minDim * 0.17));
        const showLabels = minDim > 40;
        return (
          <div
            key={rc.ticker}
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              position: "absolute",
              left: rc.x + 3,
              top: rc.y + 3,
              width: Math.max(2, rc.w - 6),
              height: Math.max(2, rc.h - 6),
              borderRadius: 14,
              background: vis.color,
              boxShadow: "inset 0 2px 0 rgba(255,255,255,0.30), inset 0 -5px 12px rgba(0,0,0,0.22)",
              padding: 8,
            }}
          >
            {/* vertical light → shade: the 3D tile read */}
            <div
              style={{
                display: "flex",
                position: "absolute",
                left: 0,
                top: 0,
                width: Math.max(2, rc.w - 6),
                height: Math.max(2, rc.h - 6),
                borderRadius: 14,
                background: "linear-gradient(180deg, rgba(255,255,255,0.14), rgba(255,255,255,0) 34%, rgba(0,0,0,0.16))",
              }}
            />
            {showLabels ? (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div
                  style={{
                    display: "flex",
                    background: "rgba(255,255,255,0.9)",
                    color: "#000",
                    fontWeight: 800,
                    fontSize: tickerFont,
                    padding: "3px 8px",
                    borderRadius: 8,
                    boxShadow: "0 2px 8px rgba(0,0,0,0.45)",
                  }}
                >
                  {it.symbol.slice(0, 10).toUpperCase()}
                </div>
                <div style={{ display: "flex", fontWeight: 700, fontSize: badgeFont, color: vis.ink }}>
                  {it.badge ?? `${Math.round(it.weightPct)}%`}
                </div>
              </div>
            ) : (
              <div style={{ display: "flex" }} />
            )}
          </div>
        );
      })}
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
  } else if (kind === "burn-event") {
    title = "BURN EVENT"; accent = C.orange;
    const amt = Math.max(0, Math.min(5000, parseFloat(req.nextUrl.searchParams.get("prism") || "0") || 0));
    body = (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 34, letterSpacing: 6, color: C.orange, fontWeight: 800 }}>🔥 PRISM BURNED FOREVER</div>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <div style={{ display: "flex", fontSize: 170, fontWeight: 800, color: "#fff", letterSpacing: -5 }}>{num(amt, 4)}</div>
          <div style={{ display: "flex", fontSize: 36, color: "#94a3b8", marginLeft: 24, marginBottom: 32, fontWeight: 700 }}>PRISM</div>
        </div>
        <div style={{ display: "flex", fontSize: 26, color: "#94a3b8", marginTop: 6 }}>Bought off the market and sent to the dead address — supply only shrinks.</div>
      </div>
    );
  } else if (kind === "launch") {
    title = "NEW BASKET"; accent = C.purple;
    const sym = (req.nextUrl.searchParams.get("symbol") || "").slice(0, 14).toUpperCase();
    const name = (req.nextUrl.searchParams.get("name") || "A new basket").slice(0, 44);
    const chain = (req.nextUrl.searchParams.get("chain") || "").slice(0, 20);
    body = (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 34, letterSpacing: 6, color: C.purple, fontWeight: 800 }}>🧺 LIVE ON SPECTRUM{chain ? ` · ${chain.toUpperCase()}` : ""}</div>
        <div style={{ display: "flex", fontSize: sym ? 150 : 96, fontWeight: 800, color: "#fff", letterSpacing: -4 }}>{sym ? `$${sym}` : name}</div>
        {sym ? <div style={{ display: "flex", fontSize: 40, color: "#94a3b8", fontWeight: 700 }}>{name}</div> : null}
        <div style={{ display: "flex", fontSize: 26, color: "#94a3b8", marginTop: 18 }}>One token, the whole basket — every trade feeds the PRISM burn.</div>
      </div>
    );
  } else if (kind === "prism") {
    title = "PRISM REVENUE"; accent = C.green;
    body = (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <div style={{ display: "flex", fontSize: 130, fontWeight: 800, color: "#fff", letterSpacing: -4 }}>{usd(f.feesToHoldersTotal * f.ethUsd, 0)}</div>
          <div style={{ display: "flex", fontSize: 32, color: C.green, marginLeft: 24, marginBottom: 22, fontWeight: 700 }}>to holders · all time</div>
        </div>
        <div style={{ display: "flex", marginTop: 34 }}>
          <Stat label="24H" value={usd(f.feesToHolders24h * f.ethUsd)} accent={C.green} />
          <Stat label="BURNED FOREVER" value={num(f.totalBurned)} accent={C.orange} />
          <Stat label="LIVE BASKETS" value={num(f.indexCount, 0)} accent={C.purple} />
        </div>
      </div>
    );
  } else if (kind === "baskets") {
    title = "BASKET LEADERBOARD"; accent = C.purple;
    const rows =
      (await fetchFirst("/api/spectrum/indexes", (j) => {
        const d = (j as { indexes?: { symbol: string; aumUsd: number }[] }).indexes;
        return d?.length ? d.sort((a, b) => b.aumUsd - a.aumUsd).slice(0, 5) : null;
      })) ?? [];
    const top = rows[0]?.aumUsd || 1;
    body = (
      <div style={{ display: "flex", flexDirection: "column" }}>
        {rows.map((b, i) => (
          <div key={b.symbol} style={{ display: "flex", alignItems: "center", marginTop: i ? 16 : 0 }}>
            <div style={{ display: "flex", width: 54, fontSize: 30, fontWeight: 800, color: "#64748b" }}>{i + 1}</div>
            <div style={{ display: "flex", width: 300, fontSize: 38, fontWeight: 800, color: "#fff" }}>${b.symbol.slice(0, 12)}</div>
            <div style={{ display: "flex", width: Math.max(30, (b.aumUsd / top) * 520), height: 30, borderRadius: 15, background: `linear-gradient(90deg, ${RAINBOW[i + 1]}, ${RAINBOW[i + 2] || RAINBOW[0]})` }} />
            <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: "#cbd5e1", marginLeft: 22 }}>{usd(b.aumUsd, 0)}</div>
          </div>
        ))}
        {!rows.length ? <div style={{ display: "flex", fontSize: 40, color: "#64748b" }}>Baskets are loading…</div> : null}
      </div>
    );
  } else if (kind === "ourbasket") {
    // the group's registered basket, live — resolved through the discovery
    // layer at render time so a factory rotation just changes what resolves
    title = "OUR BASKET"; accent = C.purple;
    const chat = req.nextUrl.searchParams.get("chat") || "";
    const reg = chat ? await getRegistry(chat) : null;
    const live = reg?.basket ? (await listIndexes()).find((b) => b.address.toLowerCase() === reg.basket!.address.toLowerCase()) : null;
    body = live ? (
      <div style={{ display: "flex", alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", width: 560 }}>
          <div style={{ display: "flex", fontSize: Math.max(44, Math.min(96, Math.floor(560 / ((live.symbol.length + 1) * 0.62)))), fontWeight: 800, color: "#fff", letterSpacing: -3 }}>${live.symbol.slice(0, 14)}</div>
          <div style={{ display: "flex", fontSize: 52, fontWeight: 800, color: (live.change24hPct ?? 0) >= 0 ? C.green : "#ff5a7a", marginTop: 4 }}>
            {live.change24hPct != null ? `${live.change24hPct >= 0 ? "+" : ""}${live.change24hPct.toFixed(1)}% 24h` : "—"}
          </div>
          <div style={{ display: "flex", marginTop: 26 }}>
            <Stat label="AUM" value={usd(live.aumUsd, 0)} accent={C.purple} />
            <Stat label="HOLDINGS" value={num(live.basketLength, 0)} accent={C.cyan} />
          </div>
        </div>
        <Bento items={live.top} w={470} h={330} />
      </div>
    ) : (
      <div style={{ display: "flex", fontSize: 54, color: "#64748b" }}>No basket registered — /ourbasket TICKER</div>
    );
  } else if (kind === "watchlist") {
    title = "GROUP WATCHLIST"; accent = C.cyan;
    const chat = req.nextUrl.searchParams.get("chat") || "";
    const reg = chat ? await getRegistry(chat) : null;
    const rows = reg
      ? (await Promise.all(
          reg.watchlist.slice(0, 6).map(async (w) => {
            const live = await validateAddress(w.address).catch(() => null);
            const chg = live && w.priceAtAdd > 0 ? ((live.priceUsd - w.priceAtAdd) / w.priceAtAdd) * 100 : null;
            return { sym: w.symbol, chg };
          }),
        )).sort((a, b) => (b.chg ?? -Infinity) - (a.chg ?? -Infinity))
      : [];
    const maxAbs = Math.max(10, ...rows.map((x) => Math.abs(x.chg ?? 0)));
    body = rows.length ? (
      <div style={{ display: "flex", flexDirection: "column" }}>
        {rows.map((x, i) => (
          <div key={x.sym} style={{ display: "flex", alignItems: "center", marginTop: i ? 14 : 0 }}>
            <div style={{ display: "flex", width: 250, fontSize: 36, fontWeight: 800, color: "#fff" }}>${x.sym.slice(0, 11)}</div>
            <div style={{ display: "flex", width: Math.max(24, (Math.abs(x.chg ?? 0) / maxAbs) * 480), height: 26, borderRadius: 13, background: (x.chg ?? 0) >= 0 ? C.green : "#ff5a7a" }} />
            <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: (x.chg ?? 0) >= 0 ? C.green : "#ff5a7a", marginLeft: 20 }}>
              {x.chg != null ? `${x.chg >= 0 ? "+" : ""}${x.chg.toFixed(1)}%` : "n/a"}
            </div>
          </div>
        ))}
        <div style={{ display: "flex", fontSize: 21, color: "#64748b", marginTop: 22 }}>since each was added · /watch to extend the radar</div>
      </div>
    ) : (
      <div style={{ display: "flex", fontSize: 54, color: "#64748b" }}>Empty radar — /watch TICKER starts it</div>
    );
  } else if (kind === "league") {
    title = "GROUP LEAGUE · 24H"; accent = C.green;
    const all = await listIndexes();
    const entries: { t: string; sym: string; chg: number | null; aum: number }[] = [];
    for (const id of (await registeredChats()).slice(0, 50)) {
      const reg = await getRegistry(id);
      if (!reg.basket) continue;
      const live = all.find((b) => b.address.toLowerCase() === reg.basket!.address.toLowerCase());
      if (live) entries.push({ t: reg.title || "a group", sym: live.symbol, chg: live.change24hPct, aum: live.aumUsd });
    }
    entries.sort((a, b) => (b.chg ?? -Infinity) - (a.chg ?? -Infinity));
    body = entries.length ? (
      <div style={{ display: "flex", flexDirection: "column" }}>
        {entries.slice(0, 5).map((e, i) => (
          <div key={e.sym + i} style={{ display: "flex", alignItems: "center", marginTop: i ? 16 : 0 }}>
            <div style={{ display: "flex", width: 66, fontSize: 40 }}>{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}</div>
            <div style={{ display: "flex", width: 260, fontSize: 38, fontWeight: 800, color: "#fff" }}>${e.sym.slice(0, 10)}</div>
            <div style={{ display: "flex", width: 250, fontSize: 32, fontWeight: 800, color: (e.chg ?? 0) >= 0 ? C.green : "#ff5a7a" }}>{e.chg != null ? `${e.chg >= 0 ? "+" : ""}${e.chg.toFixed(2)}%` : "—"}</div>
            <div style={{ display: "flex", flexGrow: 1, fontSize: 26, color: "#94a3b8" }}>{e.t.slice(0, 24)}</div>
          </div>
        ))}
        <div style={{ display: "flex", fontSize: 21, color: "#64748b", marginTop: 24 }}>enter your group: /ourbasket TICKER</div>
      </div>
    ) : (
      <div style={{ display: "flex", fontSize: 54, color: "#64748b" }}>No group baskets yet — /ourbasket TICKER</div>
    );
  } else if (kind === "split") {
    title = "THE SPLIT"; accent = C.purple;
    const spec = (req.nextUrl.searchParams.get("spec") || "").slice(0, 200);
    const chain = (req.nextUrl.searchParams.get("chain") || "").slice(0, 20);
    const legs = spec.split(",").map((p) => { const [w, s] = p.split(":"); return { w: Math.max(0, Math.min(100, Number(w) || 0)), s: (s || "").slice(0, 12).toUpperCase() }; }).filter((l) => l.s && l.w > 0).slice(0, 8);
    body = legs.length ? (
      <div style={{ display: "flex", flexDirection: "column" }}>
        {chain ? <div style={{ display: "flex", fontSize: 26, letterSpacing: 4, color: "#7c8aa0", fontWeight: 700 }}>{chain.toUpperCase()} · ONE BASKET</div> : null}
        {legs.map((l, i) => (
          <div key={l.s} style={{ display: "flex", alignItems: "center", marginTop: i || chain ? 16 : 0 }}>
            <div style={{ display: "flex", width: 130, fontSize: 42, fontWeight: 800, color: "#fff" }}>{l.w}%</div>
            <div style={{ display: "flex", width: Math.max(30, (l.w / 100) * 560), height: 32, borderRadius: 16, background: `linear-gradient(90deg, ${RAINBOW[i % RAINBOW.length]}, ${RAINBOW[(i + 2) % RAINBOW.length]})` }} />
            <div style={{ display: "flex", fontSize: 36, fontWeight: 800, color: "#e2e8f0", marginLeft: 22 }}>${l.s}</div>
          </div>
        ))}
      </div>
    ) : (
      <div style={{ display: "flex", fontSize: 54, color: "#64748b" }}>/split 60 X 40 Y</div>
    );
  } else if (kind === "bento") {
    // any live basket as the genuine bento — the visualization piece
    const addr = (req.nextUrl.searchParams.get("address") || "").toLowerCase();
    const live = (await listIndexes()).find((b) => b.address.toLowerCase() === addr);
    title = live ? `$${live.symbol.slice(0, 12)}` : "BASKET"; accent = C.purple;
    body = live ? (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", width: 320 }}>
          <div style={{ display: "flex", fontSize: 30, letterSpacing: 4, color: "#7c8aa0", fontWeight: 700 }}>ONE TOKEN,</div>
          <div style={{ display: "flex", fontSize: 30, letterSpacing: 4, color: "#7c8aa0", fontWeight: 700 }}>THE WHOLE BASKET</div>
          <div style={{ display: "flex", fontSize: 48, fontWeight: 800, color: "#fff", marginTop: 18 }}>{usd(live.aumUsd, 0)}</div>
          <div style={{ display: "flex", fontSize: 22, color: "#64748b" }}>AUM · {num(live.basketLength, 0)} holdings</div>
        </div>
        <Bento items={live.top} w={700} h={370} />
      </div>
    ) : (
      <div style={{ display: "flex", fontSize: 54, color: "#64748b" }}>Basket not found</div>
    );
  } else if (kind === "welcome") {
    // first screen. One promise, three proofs, no instructions.
    title = "SPECTRA"; accent = C.green;
    const s = await stats();
    body = (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 62, fontWeight: 800, color: "#fff", letterSpacing: -2, lineHeight: 1.1 }}>Your positions,</div>
        <div style={{ display: "flex", fontSize: 62, fontWeight: 800, letterSpacing: -2, color: C.green }}>live in Telegram.</div>
        <div style={{ display: "flex", fontSize: 27, color: "#94a3b8", marginTop: 18 }}>Every chain, one place. Read only, nothing signed.</div>
        <div style={{ display: "flex", marginTop: 34 }}>
          <Stat label="FEES TO HOLDERS · ALL TIME" value={s ? usd(s.feesToHoldersTotal * s.ethUsd, 0) : "—"} accent={C.green} />
          <Stat label="PRISM BURNED" value={s ? num(s.totalBurned) : "—"} accent={C.orange} />
          <Stat label="LIVE BASKETS" value={s ? num(s.indexCount, 0) : "—"} accent={C.purple} />
        </div>
      </div>
    );
  } else if (kind === "me" || kind === "pnl") {
    // the member's book — a Spectrum product surface. Positions as a bento so
    // the shape is readable at a glance, not a list of numbers to parse.
    const q = req.nextUrl.searchParams;
    const isPnl = kind === "pnl";
    title = isPnl ? "SINCE YOU LINKED" : "YOUR BOOK"; accent = isPnl ? C.green : C.cyan;
    const total = Number(q.get("total") || 0);
    const delta = Number(q.get("delta") || 0);
    const legs = (q.get("legs") || "").split(",").map((p) => { const [s, v] = p.split(":"); return { symbol: (s || "").slice(0, 12).toUpperCase(), address: (s || "").toUpperCase(), weightPct: Math.max(0.01, Number(v) || 0) }; }).filter((l) => l.symbol).slice(0, 8);
    body = (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", width: 380 }}>
          <div style={{ display: "flex", fontSize: 26, letterSpacing: 4, color: "#7c8aa0", fontWeight: 700 }}>{isPnl ? "CHANGE" : "TOTAL VALUE"}</div>
          {isPnl ? (
            <div style={{ display: "flex", fontSize: 84, fontWeight: 800, letterSpacing: -3, color: delta >= 0 ? C.green : "#ff5a7a" }}>{`${delta >= 0 ? "+" : "−"}${usd(Math.abs(delta), 0)}`}</div>
          ) : (
            <div style={{ display: "flex", fontSize: 84, fontWeight: 800, color: "#fff", letterSpacing: -3 }}>{usd(total, 0)}</div>
          )}
          {isPnl ? <div style={{ display: "flex", fontSize: 30, color: "#94a3b8", marginTop: 6 }}>now {usd(total, 0)}</div> : null}
          <div style={{ display: "flex", fontSize: 23, color: "#64748b", marginTop: 14 }}>{legs.length} position{legs.length === 1 ? "" : "s"} · every chain</div>
        </div>
        {legs.length ? <Bento items={legs} w={640} h={370} /> : <div style={{ display: "flex", fontSize: 44, color: "#64748b" }}>Nothing held yet</div>}
      </div>
    );
  } else if (kind === "buy" || kind === "reweight") {
    // the ORDER, as a portfolio operation: what it costs, what funds it
    const q = req.nextUrl.searchParams;
    const isBuy = kind === "buy";
    title = isBuy ? "PREPARED BUY" : "REBALANCE"; accent = isBuy ? C.green : C.purple;
    const sym = (q.get("sym") || "").slice(0, 12).toUpperCase();
    const amount = q.get("amount") || "";
    const share = q.get("share") || "";
    const from = (q.get("from") || "").split("|").map((s) => s.slice(0, 46)).filter(Boolean).slice(0, 4);
    body = (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          {sym ? (
            <div style={{ display: "flex", background: tokenVisual(sym, sym).color, borderRadius: 18, padding: "10px 24px", fontSize: 58, fontWeight: 800, color: "#fff", boxShadow: "inset 0 2px 0 rgba(255,255,255,0.3), inset 0 -5px 12px rgba(0,0,0,0.25)" }}>${sym}</div>
          ) : null}
          {amount ? <div style={{ display: "flex", fontSize: 62, fontWeight: 800, color: "#fff", marginLeft: 26 }}>{amount}</div> : null}
        </div>
        <div style={{ display: "flex", fontSize: 26, letterSpacing: 4, color: "#7c8aa0", fontWeight: 700, marginTop: 32 }}>FUNDED BY</div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 12 }}>
          {from.length ? from.map((f, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", marginTop: i ? 12 : 0 }}>
              <div style={{ display: "flex", width: 12, height: 12, borderRadius: 6, background: accent, marginRight: 16 }} />
              <div style={{ display: "flex", fontSize: 31, color: "#e2e8f0" }}>{f}</div>
            </div>
          )) : <div style={{ display: "flex", fontSize: 31, color: "#64748b" }}>link a wallet and I&apos;ll show what funds it</div>}
        </div>
        {share ? <div style={{ display: "flex", fontSize: 25, color: "#94a3b8", marginTop: 26 }}>{share}</div> : null}
      </div>
    );
  } else if (kind === "idea") {
    // the chatter suggestion, visualized: the group's hot tickers as equal-weight
    // bento tiles. Symbols only (no addresses yet) — tokenVisual falls back to a
    // deterministic hashed hue per symbol, so no network call and no dead render.
    title = "BASKET IDEA"; accent = C.purple;
    const syms = (req.nextUrl.searchParams.get("syms") || "").split(",").map((s) => s.trim().slice(0, 12).toUpperCase()).filter(Boolean).slice(0, 8);
    const items: BentoTile[] = syms.map((s) => ({ symbol: s, address: s, weightPct: 1 }));
    body = items.length ? (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", width: 330 }}>
          <div style={{ display: "flex", fontSize: 30, letterSpacing: 4, color: "#7c8aa0", fontWeight: 700 }}>THIS GROUP&apos;S</div>
          <div style={{ display: "flex", fontSize: 30, letterSpacing: 4, color: "#7c8aa0", fontWeight: 700 }}>THESIS, AS ONE</div>
          <div style={{ display: "flex", fontSize: 62, fontWeight: 800, color: "#fff", marginTop: 14 }}>TOKEN</div>
          <div style={{ display: "flex", fontSize: 23, color: "#64748b", marginTop: 16 }}>{items.length} assets · tap to start the draft</div>
        </div>
        <Bento items={items} w={690} h={370} />
      </div>
    ) : (
      <div style={{ display: "flex", fontSize: 54, color: "#64748b" }}>No tickers yet</div>
    );
  } else if (kind === "draftcard") {
    // the living draft card: proposed tokens as tiles that GROW with votes
    title = "GROUP DRAFT"; accent = C.purple;
    const chat = req.nextUrl.searchParams.get("chat") || "";
    const d = chat ? await getDraft(chat) : null;
    const items: BentoTile[] = (d?.tokens ?? []).map((t) => ({
      symbol: t.symbol,
      address: t.address,
      weightPct: 1 + t.votes.length,
      badge: `👍${t.votes.length}`,
    }));
    body = items.length ? (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", width: 300 }}>
          <div style={{ display: "flex", fontSize: 28, letterSpacing: 4, color: "#7c8aa0", fontWeight: 700 }}>TILES GROW</div>
          <div style={{ display: "flex", fontSize: 28, letterSpacing: 4, color: "#7c8aa0", fontWeight: 700 }}>WITH VOTES</div>
          <div style={{ display: "flex", fontSize: 44, fontWeight: 800, color: "#fff", marginTop: 16 }}>{items.length}/8</div>
          <div style={{ display: "flex", fontSize: 22, color: "#64748b" }}>slots filled</div>
        </div>
        <Bento items={items} w={720} h={370} />
      </div>
    ) : (
      <div style={{ display: "flex", fontSize: 54, color: "#64748b" }}>Empty draft — /propose $TICKER why</div>
    );
  } else if (kind === "token") {
    // read-only intel, param-driven (the command validated via DexScreener)
    const q = req.nextUrl.searchParams;
    const sym = (q.get("sym") || "?").slice(0, 12).toUpperCase();
    const chg = q.get("chg") ? Number(q.get("chg")) : null;
    title = "TOKEN INTEL"; accent = C.cyan;
    const vis = tokenVisual(sym, (q.get("ca") || "").toLowerCase());
    body = (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", width: 620 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", background: vis.color, borderRadius: 18, padding: "10px 22px", fontSize: 64, fontWeight: 800, color: "#fff", boxShadow: "inset 0 2px 0 rgba(255,255,255,0.3), inset 0 -5px 12px rgba(0,0,0,0.25)" }}>${sym}</div>
            {chg != null ? (
              <div style={{ display: "flex", fontSize: 46, fontWeight: 800, marginLeft: 26, color: chg >= 0 ? C.green : "#ff5a7a" }}>{`${chg >= 0 ? "+" : ""}${chg.toFixed(1)}% 24h`}</div>
            ) : null}
          </div>
          <div style={{ display: "flex", fontSize: 30, color: "#94a3b8", marginTop: 14 }}>{(q.get("name") || "").slice(0, 40)} · {(q.get("chain") || "").slice(0, 16)}</div>
          <div style={{ display: "flex", fontSize: 22, color: "#64748b", marginTop: 16, fontFamily: "monospace" }}>{(q.get("ca") || "").slice(0, 42)}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <Stat label="PRICE" value={(q.get("price") || "—").slice(0, 14)} accent={C.cyan} />
          <div style={{ display: "flex", marginTop: 18 }}>
            <Stat label="LIQUIDITY" value={(q.get("liq") || "—").slice(0, 12)} accent={C.purple} />
          </div>
        </div>
      </div>
    );
  } else if (kind === "quote") {
    const q = req.nextUrl.searchParams;
    title = "LIVE QUOTE"; accent = C.green;
    body = (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", fontSize: 96, fontWeight: 800, color: "#fff" }}>Ξ{(q.get("in") || "?").slice(0, 8)}</div>
          <div style={{ display: "flex", fontSize: 72, color: "#475569", margin: "0 34px" }}>→</div>
          <div style={{ display: "flex", fontSize: 96, fontWeight: 800, color: C.green }}>{(q.get("out") || "?").slice(0, 10)}</div>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 700, color: "#94a3b8", marginLeft: 20, marginTop: 34 }}>PRISM</div>
        </div>
        <div style={{ display: "flex", fontSize: 27, color: "#94a3b8", marginTop: 26 }}>1% pool fee streams to holders — including you, after this buy.</div>
      </div>
    );
  } else if (kind === "ca") {
    title = "PRISM CONTRACT"; accent = C.green;
    body = (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 30, letterSpacing: 5, color: "#7c8aa0", fontWeight: 700 }}>ETHEREUM · THE ONLY ADDRESS</div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 24, background: "rgba(255,255,255,0.04)", border: `1px solid ${C.green}40`, borderRadius: 22, padding: "30px 36px" }}>
          <div style={{ display: "flex", fontSize: 49, fontWeight: 800, color: "#fff", fontFamily: "monospace" }}>0xCf4d29f14Cc585DDd116</div>
          <div style={{ display: "flex", fontSize: 49, fontWeight: 800, color: "#fff", fontFamily: "monospace" }}>7F956092852AF844e040</div>
        </div>
        <div style={{ display: "flex", fontSize: 26, color: "#94a3b8", marginTop: 22 }}>Tap the message to copy · verify it yourself on Etherscan before you trade.</div>
      </div>
    );
  } else if (kind === "links") {
    title = "OFFICIAL LINKS"; accent = C.purple;
    const rows = [
      ["🌈", "linktr.ee/prism_lp", "every link, one place"],
      ["𝕏", "x.com/Prism_V4hook", "the PRISM account"],
      ["✈️", "t.me/PrismLP", "the Telegram group"],
    ];
    body = (
      <div style={{ display: "flex", flexDirection: "column" }}>
        {rows.map(([ic, big, sub], i) => (
          <div key={big} style={{ display: "flex", alignItems: "center", marginTop: i ? 20 : 0, background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 18, padding: "18px 26px" }}>
            <div style={{ display: "flex", fontSize: 44 }}>{ic}</div>
            <div style={{ display: "flex", fontSize: 42, fontWeight: 800, color: "#fff", marginLeft: 24 }}>{big}</div>
            <div style={{ display: "flex", fontSize: 24, color: "#64748b", marginLeft: "auto" }}>{sub}</div>
          </div>
        ))}
      </div>
    );
  } else if (kind === "lightrunner") {
    // the game's real art — PNG variants: Satori's decoder cannot read webp, and
    // a webp src renders as a silent empty frame
    title = "LIGHTRUNNER"; accent = "#5C7CFA";
    const origin = req.nextUrl.origin;
    body = (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", width: 560 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${origin}/mothership/lightrunner-logo-card.png`} width={480} height={141} alt="" />
          <div style={{ display: "flex", fontSize: 28, color: "#cbd5e1", marginTop: 24, lineHeight: 1.5 }}>An onchain roguelike bullet hell built on Prism. Weekly leagues — run the dark, score high, win from the pot.</div>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 800, color: "#5C7CFA", marginTop: 20 }}>playlightrunner.com</div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${origin}/mothership/lightrunner-bg-card.png`} width={440} height={246} alt="" style={{ borderRadius: 20, border: "1px solid rgba(255,255,255,0.14)" }} />
      </div>
    );
  } else if (kind === "help") {
    title = "THE PRISM BOT"; accent = C.green;
    const cmds: [string, string][] = [
      ["/price", C.cyan], ["/burn", C.orange], ["/baskets", C.purple], ["/token", C.cyan],
      ["/quote", C.green], ["/split", C.purple], ["/ourbasket", C.purple], ["/watchlist", C.cyan],
      ["/league", C.green], ["/portfolio", C.orange], ["/lightrunner", "#5C7CFA"], ["/ca", C.green],
    ];
    body = (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 32, color: "#94a3b8" }}>Your live line to the Prism ecosystem — tap a command or just ask.</div>
        <div style={{ display: "flex", flexWrap: "wrap", marginTop: 26 }}>
          {cmds.map(([c, col]) => (
            <div key={c} style={{ display: "flex", fontSize: 30, fontWeight: 700, color: col, border: `2px solid ${col}44`, background: `${col}12`, borderRadius: 14, padding: "10px 22px", marginRight: 14, marginBottom: 14 }}>{c}</div>
          ))}
        </div>
      </div>
    );
  } else if (kind === "portfolio") {
    // Spectrum Portfolio berth card — honest empty until the batcher contracts
    // are on-chain (post-ceremony); lights up via the same live stats the
    // command will read. Slots deliberately render "—", never zeros.
    title = "SPECTRUM PORTFOLIO"; accent = C.orange;
    body = (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", fontSize: 78, fontWeight: 800, color: "#fff", letterSpacing: -2 }}>Launching soon</div>
          <div style={{ display: "flex", fontSize: 22, fontWeight: 800, letterSpacing: 3, color: C.orange, border: `2px solid ${C.orange}55`, borderRadius: 9999, padding: "8px 22px", background: `${C.orange}14`, marginLeft: 30 }}>BUILT &amp; AUDITED</div>
        </div>
        <div style={{ display: "flex", fontSize: 27, color: "#94a3b8", marginTop: 14, maxWidth: 900 }}>A whole portfolio in one buy, batched across baskets and tokens — a flat buy fee buys and burns PRISM. These slots light up the moment it is on-chain.</div>
        <div style={{ display: "flex", marginTop: 30 }}>
          <Stat label="PORTFOLIO VOLUME" value="—" accent={C.orange} />
          <Stat label="FEES EARNED" value="—" accent={C.green} />
          <Stat label="UNIQUE USERS" value="—" accent={C.cyan} />
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

  const brand: Brand = SPECTRUM_KINDS.has(kind) ? "spectrum" : "prism";
  return new ImageResponse(<Frame title={title} accent={accent} brand={brand}>{body}</Frame>, {
    width: 1200,
    height: 630,
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
  });
}
