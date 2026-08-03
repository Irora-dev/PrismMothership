import { forwardRef, useMemo, type CSSProperties } from "react";
import { fmtUsdFull, fmtEth, fmtEthFine } from "@/lib/feed/format";

export type CardFormat = "square" | "wide" | "hd" | "story";
export type CardTemplate = "basket" | "title" | "tagline" | "burn" | "fees" | "statement" | "yield";

export const FORMATS: Record<CardFormat, { w: number; h: number; label: string }> = {
  square: { w: 1080, h: 1080, label: "Square · 1080²" },
  wide: { w: 1200, h: 630, label: "Wide · 1200×630" },
  hd: { w: 1920, h: 1080, label: "16:9 · 1920×1080" },
  story: { w: 1080, h: 1920, label: "Story · 1080×1920" },
};

export interface CardStats {
  totalBurned: number;
  cap: number;
  feesToHolders24h: number;
  perPrism: number;
  supply: number;
  // Yield card (optional; pulled live from /api/feed). USD + matching ETH leg.
  fees24hUsd?: number;
  fees24hEth?: number;
  fees7dUsd?: number;
  fees7dEth?: number;
  feesAllUsd?: number;
  feesAllEth?: number;
  yield24hUsd?: number;
  yield24hEth?: number;
  yield1yUsd?: number;
  yield1yEth?: number;
}

export interface Holding {
  weight: number;
  ticker: string;
  name: string;
  logo?: string;
}

const DISPLAY = '"DM Serif Display", "Playfair Display", serif';

const ACCENT: Record<CardTemplate, string> = {
  basket: "#3b82f6",
  title: "#3b82f6",
  tagline: "#3b82f6",
  burn: "#fb923c",
  fees: "#22d3ee",
  statement: "#a855f7",
  yield: "#22d3ee",
};

// ── Color schemes — the pixel palette + background of the "image" are themeable.
// Applies to the pixel-framed templates (basket / title / tagline).
export type ThemeId = "ocean" | "spectrum" | "ember" | "violet" | "mono";

interface Theme {
  label: string;
  swatch: string[]; // 4 dots for the picker
  pixels: string[]; // pixel-field palette
  primary: string; // eyebrow, header label, divider
  primarySoft: string; // weight numbers
  headerLine: string; // header underline
  rowTint: string; // alternating row wash
  glow: string; // title text-shadow color
  bg: string; // full card background
}

export const THEMES: Record<ThemeId, Theme> = {
  ocean: {
    label: "Ocean",
    swatch: ["#1d4ed8", "#3b82f6", "#60a5fa", "#38bdf8"],
    pixels: ["#1e3a8a", "#1d4ed8", "#2563eb", "#3b82f6", "#60a5fa", "#93c5fd", "#38bdf8", "#818cf8"],
    primary: "#60a5fa",
    primarySoft: "#bfdbfe",
    headerLine: "rgba(147,197,253,0.35)",
    rowTint: "rgba(59,130,246,0.05)",
    glow: "rgba(96,165,250,0.22)",
    bg: `radial-gradient(circle at 16% -5%, rgba(56,189,248,0.12), transparent 32%),
         radial-gradient(circle at 50% -28%, rgba(37,99,235,0.18), transparent 42%),
         radial-gradient(circle at 88% 105%, rgba(99,102,241,0.14), transparent 40%),
         linear-gradient(150deg, #070a1c 0%, #04050c 55%, #030308 100%)`,
  },
  spectrum: {
    label: "Spectrum",
    swatch: ["#ff5a5a", "#ffe14d", "#3bd9ff", "#c06aff"],
    pixels: ["#ff5a5a", "#ff9f45", "#ffe14d", "#5cff8f", "#3bd9ff", "#7c8bff", "#c06aff", "#ff6ad5"],
    primary: "#c4b5fd",
    primarySoft: "#e9d5ff",
    headerLine: "rgba(196,181,253,0.35)",
    rowTint: "rgba(192,106,255,0.05)",
    glow: "rgba(192,106,255,0.25)",
    bg: `radial-gradient(circle at 12% -8%, rgba(255,90,90,0.12), transparent 30%),
         radial-gradient(circle at 50% -22%, rgba(91,255,143,0.10), transparent 40%),
         radial-gradient(circle at 90% 108%, rgba(192,106,255,0.16), transparent 40%),
         linear-gradient(150deg, #0a0612 0%, #060409 55%, #030307 100%)`,
  },
  ember: {
    label: "Ember",
    swatch: ["#c2410c", "#f97316", "#fbbf24", "#f43f5e"],
    pixels: ["#7c2d12", "#9a3412", "#c2410c", "#ea580c", "#f97316", "#fb923c", "#fbbf24", "#f43f5e"],
    primary: "#fb923c",
    primarySoft: "#fed7aa",
    headerLine: "rgba(251,146,60,0.35)",
    rowTint: "rgba(249,115,22,0.06)",
    glow: "rgba(249,115,22,0.24)",
    bg: `radial-gradient(circle at 14% -6%, rgba(249,115,22,0.16), transparent 32%),
         radial-gradient(circle at 88% 108%, rgba(244,63,94,0.14), transparent 40%),
         linear-gradient(150deg, #1a0a05 0%, #0c0604 55%, #060303 100%)`,
  },
  violet: {
    label: "Violet",
    swatch: ["#6d28d9", "#8b5cf6", "#c084fc", "#e879f9"],
    pixels: ["#4c1d95", "#5b21b6", "#6d28d9", "#7c3aed", "#8b5cf6", "#a78bfa", "#c084fc", "#e879f9"],
    primary: "#c084fc",
    primarySoft: "#e9d5ff",
    headerLine: "rgba(192,132,252,0.35)",
    rowTint: "rgba(139,92,246,0.06)",
    glow: "rgba(168,85,247,0.26)",
    bg: `radial-gradient(circle at 16% -6%, rgba(168,85,247,0.16), transparent 32%),
         radial-gradient(circle at 86% 106%, rgba(232,121,249,0.12), transparent 40%),
         linear-gradient(150deg, #0f0820 0%, #08040f 55%, #040208 100%)`,
  },
  mono: {
    label: "Mono",
    swatch: ["#64748b", "#94a3b8", "#cbd5e1", "#ffffff"],
    pixels: ["#475569", "#64748b", "#94a3b8", "#cbd5e1", "#e2e8f0", "#f1f5f9", "#ffffff", "#334155"],
    primary: "#cbd5e1",
    primarySoft: "#f1f5f9",
    headerLine: "rgba(203,213,225,0.30)",
    rowTint: "rgba(255,255,255,0.04)",
    glow: "rgba(226,232,240,0.18)",
    bg: `radial-gradient(circle at 16% -6%, rgba(226,232,240,0.10), transparent 32%),
         radial-gradient(circle at 86% 106%, rgba(148,163,184,0.10), transparent 40%),
         linear-gradient(150deg, #0c0e12 0%, #070809 55%, #030305 100%)`,
  },
};

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A static, deterministic "prism pixel" field (blue), denser at the edges so the
// centre stays clear for content. DOM squares so html2canvas captures them.
function pixelSquares(w: number, h: number, s: number, palette: string[]) {
  const cell = Math.max(16, Math.round(30 * s));
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  const out: { x: number; y: number; size: number; color: string; opacity: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rng = mulberry32((r * 73856093) ^ (c * 19349663));
      const a = rng();
      const dx = Math.abs(c - cx) / (cx || 1);
      const dy = Math.abs(r - cy) / (cy || 1);
      const edge = Math.max(dx, dy); // 0 = centre, 1 = edge
      // black centre — pixels only frame the outer edge band
      if (edge < 0.84) continue;
      const t = (edge - 0.84) / 0.16; // 0 inner-frame .. 1 card edge
      const dens = 0.25 + Math.pow(t, 0.9) * 0.7;
      if (a > dens) continue;
      const size = Math.round(cell * (0.3 + rng() * 0.42));
      const color = palette[Math.floor(rng() * palette.length)];
      const opacity = Math.min(0.95, 0.2 + t * 0.6 + rng() * 0.12);
      out.push({
        x: c * cell + Math.round((cell - size) / 2),
        y: r * cell + Math.round((cell - size) / 2),
        size,
        color,
        opacity,
      });
    }
  }
  return out;
}

function fmt(n: number, dp = 2) {
  return n.toLocaleString(undefined, { maximumFractionDigits: dp });
}

// Brand mark: the pixel-rainbow arch (same geometry as the hero / OG image),
// emitted as positioned cells so html2canvas bakes it into the export.
const RAINBOW = ["#ff5a5a", "#ff9f45", "#ffe14d", "#5cff8f", "#3bd9ff", "#7c8bff", "#c06aff"];
function rainbowArch(cell: number) {
  const R = 9;
  const INNER = 3;
  const rows = R + 1;
  const gap = cell * 0.16;
  const cells: { x: number; y: number; s: number; color: string }[] = [];
  for (let x = -R; x <= R; x++) {
    for (let y = 0; y <= R; y++) {
      const d = Math.round(Math.hypot(x, y));
      if (d < INNER || d > R) continue;
      cells.push({ x: (x + R) * cell + gap / 2, y: (rows - 1 - y) * cell + gap / 2, s: cell - gap, color: RAINBOW[R - d] });
    }
  }
  return { cells, w: (R * 2 + 1) * cell, h: rows * cell };
}

interface Props {
  format: CardFormat;
  template: CardTemplate;
  headline: string;
  sub: string;
  stats: CardStats;
  holdings?: Holding[];
  theme?: ThemeId;
  animate?: boolean;
}

export const MarketingCard = forwardRef<HTMLDivElement, Props>(function MarketingCard(
  { format, template, headline, sub, stats, holdings = [], theme = "ocean", animate = false },
  ref,
) {
  const { w, h } = FORMATS[format];
  const s = h / 1080;
  const px = (n: number) => `${Math.round(n * s)}px`;
  const accent = ACCENT[template];
  const th = THEMES[theme] ?? THEMES.ocean;
  const isBasket = template === "basket";
  const blueBg = isBasket || template === "title" || template === "tagline";
  const wide = w > h * 1.15; // landscape (hd / wide) → two-column yield layout
  const sweep = animate && isBasket;
  const burnedPct = (stats.totalBurned / stats.cap) * 100;
  const titleShadow = `0 2px 24px rgba(0,0,0,0.55), 0 0 52px ${th.glow}`;

  const background = blueBg
    ? th.bg
    : template === "yield"
    ? `radial-gradient(circle at 15% -8%, rgba(34,211,238,0.16), transparent 34%),
       radial-gradient(circle at 85% 112%, rgba(34,197,94,0.15), transparent 40%),
       radial-gradient(circle at 50% 55%, rgba(14,165,233,0.05), transparent 60%),
       linear-gradient(150deg, #06121a 0%, #04070c 55%, #030308 100%)`
    : `radial-gradient(circle at 6% 6%, rgba(239,68,68,0.20), transparent 28%),
       radial-gradient(circle at 95% 8%, rgba(168,85,247,0.20), transparent 28%),
       radial-gradient(circle at 8% 94%, rgba(34,211,238,0.16), transparent 30%),
       radial-gradient(circle at 94% 95%, rgba(59,130,246,0.18), transparent 30%),
       radial-gradient(circle at 50% 120%, ${accent}33, transparent 45%),
       #07070b`;

  // The pixel field depends only on size / theme / template — memoize it so editing
  // copy, numbers, or holdings doesn't rebuild and re-diff hundreds of box-shadowed
  // nodes on every keystroke (the studio's main perf cost).
  const squaresEl = useMemo(() => {
    if (!blueBg) return null;
    return pixelSquares(w, h, s, th.pixels).map((p, i) => {
      const glow = p.opacity > 0.5;
      const style: CSSProperties = {
        position: "absolute",
        left: p.x,
        top: p.y,
        width: p.size,
        height: p.size,
        background: `linear-gradient(135deg, ${p.color}, ${p.color}bb)`,
        opacity: p.opacity,
        borderRadius: Math.round(3 * s),
        boxShadow: glow ? `0 0 ${Math.round(7 * s)}px ${p.color}` : undefined,
        zIndex: 0,
      };
      if (sweep) {
        (style as Record<string, string | number>)["--o"] = p.opacity;
        (style as Record<string, string | number>)["--sx"] = `${Math.round(34 * s)}px`;
        style.animationDelay = `${Math.round((1 - p.x / w) * 600)}ms`;
      }
      return <div key={i} className={sweep ? "pixel-sweep" : undefined} style={style} />;
    });
  }, [blueBg, w, h, s, th, sweep]);
  // landscape formats split into two side-by-side tables; tall formats keep one
  const twoCol = isBasket && (format === "hd" || format === "wide");
  const half = Math.ceil(holdings.length / 2);
  const holdingGroups = twoCol ? [holdings.slice(0, half), holdings.slice(half)] : [holdings];
  const perCol = twoCol ? half : holdings.length;
  const rowFont = perCol <= 8 ? 32 : perCol <= 12 ? 24 : perCol <= 16 ? 20 : 17;
  const hasLogos = holdings.some((hd) => !!hd.logo);
  const cols = twoCol
    ? `${px(80)} minmax(0,${hasLogos ? 1.3 : 1.1}fr) minmax(0,1.2fr)`
    : `${px(170)} ${px(300)} 1fr`;

  return (
    <div
      ref={ref}
      style={{
        width: w,
        height: h,
        position: "relative",
        overflow: "hidden",
        fontFamily: '"Plus Jakarta Sans", sans-serif',
        color: "#f8fafc",
        background,
      }}
    >
      {squaresEl}

      <div
        style={{
          position: "relative",
          zIndex: 1,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          // basket: inset content past the edge pixel frame so text is never blocked
          padding: isBasket ? `${Math.round(0.085 * h)}px ${Math.round(0.1 * w)}px` : px(72),
        }}
      >
        {/* body */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", minHeight: 0 }}>
          {template === "title" || template === "tagline" ? (
            <div style={{ textAlign: "center", maxWidth: px(1000), marginLeft: "auto", marginRight: "auto" }}>
              <div style={{ fontSize: px(24), fontWeight: 700, letterSpacing: px(5), textTransform: "uppercase", color: th.primary, marginBottom: px(26) }}>
                Spectrum index
              </div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: px(124), lineHeight: 1.02, letterSpacing: "-0.015em", textShadow: titleShadow }}>
                {headline}
              </div>
              {template === "tagline" ? (
                <>
                  <div
                    style={{
                      width: px(150),
                      height: px(3),
                      margin: `${px(34)} auto ${px(28)}`,
                      background: `linear-gradient(90deg, transparent, ${th.primary}, transparent)`,
                      borderRadius: px(2),
                    }}
                  />
                  <div style={{ fontSize: px(38), fontWeight: 500, color: "#cbd5e1", lineHeight: 1.35, letterSpacing: "0.005em" }}>
                    {sub}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: px(40), color: "#cbd5e1", marginTop: px(34), lineHeight: 1.4 }}>
                  {sub}
                </div>
              )}
            </div>
          ) : isBasket ? (
            <>
              <div style={{ fontSize: px(20), fontWeight: 700, letterSpacing: px(3), textTransform: "uppercase", color: th.primary, marginBottom: px(8) }}>
                Spectrum index
              </div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: px(48), lineHeight: 1.02, textShadow: titleShadow }}>
                {headline}
              </div>
              {sub && <div style={{ fontSize: px(22), color: "#cbd5e1", marginTop: px(6) }}>{sub}</div>}

              <div
                style={{
                  marginTop: px(16),
                  display: twoCol ? "grid" : "block",
                  gridTemplateColumns: twoCol ? "1fr 1fr" : undefined,
                  columnGap: twoCol ? px(44) : undefined,
                }}
              >
                {holdingGroups.map((group, gi) => (
                  <div key={gi}>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: cols,
                        gap: px(20),
                        padding: `${px(12)} ${px(8)}`,
                        borderBottom: `2px solid ${th.headerLine}`,
                        fontSize: px(18),
                        fontWeight: 700,
                        letterSpacing: px(1),
                        textTransform: "uppercase",
                        color: th.primary,
                      }}
                    >
                      <div style={{ textAlign: "right" }}>Weight</div>
                      <div>Ticker</div>
                      <div>Name</div>
                    </div>
                    {group.map((hd, i) => (
                      <div
                        key={i}
                        style={{
                          display: "grid",
                          gridTemplateColumns: cols,
                          gap: px(20),
                          padding: `${px(rowFont * 0.32)} ${px(8)}`,
                          borderBottom: "1px solid rgba(255,255,255,0.06)",
                          background: i % 2 === 1 ? th.rowTint : "transparent",
                          fontSize: px(rowFont),
                          lineHeight: 1.3,
                          alignItems: "center",
                        }}
                      >
                        <div style={{ textAlign: "right", fontFamily: '"Space Grotesk", sans-serif', fontWeight: 700, color: th.primarySoft }}>
                          {hd.weight}%
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: px(rowFont * 0.42), minWidth: 0 }}>
                          {hasLogos && (
                            <span
                              style={{
                                position: "relative",
                                flex: "none",
                                width: px(rowFont * 1.45),
                                height: px(rowFont * 1.45),
                                borderRadius: "50%",
                                overflow: "hidden",
                                background: "rgba(148,163,184,0.12)",
                                border: "1px solid rgba(255,255,255,0.10)",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontFamily: '"Space Grotesk", sans-serif',
                                fontWeight: 700,
                                fontSize: px(rowFont * 0.5),
                                lineHeight: 1,
                                color: "#cbd5e1",
                              }}
                            >
                              {/* ticker initials — the fallback shown when a token has no resolvable logo */}
                              {hd.ticker.replace(/^\$/, "").slice(0, 3).toUpperCase()}
                              {hd.logo && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={hd.logo}
                                  alt=""
                                  crossOrigin="anonymous"
                                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                                  onError={(e) => {
                                    e.currentTarget.style.display = "none";
                                  }}
                                />
                              )}
                            </span>
                          )}
                          <span style={{ fontWeight: 700, color: "#f8fafc", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {hd.ticker}
                          </span>
                        </div>
                        <div style={{ color: "#94a3b8", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {hd.name}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </>
          ) : template === "statement" ? (
            <>
              <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: px(96), lineHeight: 1.04, letterSpacing: "-0.01em", textShadow: titleShadow }}>
                {headline}
              </div>
              <div style={{ fontSize: px(34), color: "#cbd5e1", marginTop: px(28), maxWidth: px(1500), lineHeight: 1.35 }}>{sub}</div>
            </>
          ) : template === "yield" ? (
            (() => {
              // big editable title with a light cyan glow — sits in the open space
              // to the right on landscape cards, on top when the format is portrait.
              const titleBlock = (
                <div
                  style={{
                    flex: wide ? "0 0 38%" : "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: wide ? "flex-end" : "flex-start",
                  }}
                >
                  <div
                    style={{
                      fontFamily: DISPLAY,
                      fontWeight: 800,
                      fontSize: px(wide ? 118 : 92),
                      lineHeight: 1.08,
                      letterSpacing: "-0.02em",
                      textAlign: wide ? "right" : "left",
                      textShadow: "0 0 24px rgba(34,211,238,0.32), 0 0 64px rgba(34,211,238,0.15), 0 2px 16px rgba(0,0,0,0.5)",
                    }}
                  >
                    {headline}
                  </div>
                </div>
              );

              const dataCol = (
                <div style={{ flex: wide ? "1 1 0" : "none", minWidth: 0, display: "flex", flexDirection: "column", gap: px(26) }}>
                  {/* eyebrow */}
                  <div style={{ display: "flex", alignItems: "center", gap: px(14) }}>
                    <span style={{ width: px(15), height: px(15), borderRadius: "50%", background: "#22d3ee", boxShadow: `0 0 ${px(14)} #22d3ee` }} />
                    <span style={{ fontSize: px(22), fontWeight: 700, letterSpacing: px(4), textTransform: "uppercase", color: "#67e8f9" }}>
                      PRISM · protocol revenue, on-chain
                    </span>
                  </div>

                  {/* timeframe totals — fees streamed to holders */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: px(46) }}>
                    {[
                      { label: "Today", usd: stats.fees24hUsd ?? 0, eth: stats.fees24hEth ?? 0 },
                      { label: "This week", usd: stats.fees7dUsd ?? 0, eth: stats.fees7dEth ?? 0 },
                      { label: "All time", usd: stats.feesAllUsd ?? 0, eth: stats.feesAllEth ?? 0 },
                    ].map((t) => (
                      <div key={t.label}>
                        <div style={{ fontSize: px(17), fontWeight: 600, letterSpacing: px(1.5), textTransform: "uppercase", color: "#94a3b8" }}>{t.label}</div>
                        <div style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 700, fontSize: px(48), lineHeight: 1, color: "#22d3ee", marginTop: px(8) }}>
                          {fmtUsdFull(t.usd)}
                        </div>
                        <div style={{ fontSize: px(20), color: "#64748b", marginTop: px(6), fontFamily: '"Space Grotesk", sans-serif' }}>Ξ{fmtEth(t.eth)}</div>
                      </div>
                    ))}
                  </div>

                  {/* revenue per token (trailing 24h) — a factual figure, no projection */}
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: px(58), padding: `${px(30)} 0`, borderTop: "1px solid rgba(255,255,255,0.1)", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                    <div>
                      <div style={{ fontSize: px(22), fontWeight: 600, color: "#94a3b8" }}>Revenue / PRISM · last 24h</div>
                      <div style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 700, fontSize: px(100), lineHeight: 1.2, color: "#38bdf8", marginTop: px(10), letterSpacing: "-0.02em" }}>
                        {`$${(stats.yield24hUsd ?? 0).toFixed(2)}`}
                      </div>
                      <div style={{ fontSize: px(22), color: "#64748b", marginTop: px(26), fontFamily: '"Space Grotesk", sans-serif' }}>Ξ{fmtEthFine(stats.yield24hEth ?? 0)}</div>
                    </div>
                  </div>

                  {/* what PRISM is + where the revenue comes from (editable) */}
                  <div style={{ fontSize: px(27), color: "#cbd5e1", lineHeight: 1.42 }}>{sub}</div>
                </div>
              );

              return wide ? (
                <div style={{ display: "flex", flexDirection: "row", gap: px(60), alignItems: "center", width: "100%" }}>
                  {dataCol}
                  {titleBlock}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: px(34), width: "100%" }}>
                  {titleBlock}
                  {dataCol}
                </div>
              );
            })()
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: px(14), marginBottom: px(18) }}>
                <span style={{ fontSize: px(34) }}>{template === "burn" ? "🔥" : "💧"}</span>
                <span style={{ fontSize: px(20), fontWeight: 700, letterSpacing: px(3), textTransform: "uppercase", color: "#94a3b8" }}>
                  {template === "burn" ? "PRISM burned · all time" : "Protocol revenue to holders · 24h"}
                </span>
              </div>
              <div style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 700, fontSize: px(184), lineHeight: 0.9, color: accent, letterSpacing: "-0.02em" }}>
                {template === "burn" ? (
                  <>
                    {fmt(stats.totalBurned)}
                    <span style={{ fontSize: px(60), color: "#64748b", marginLeft: px(18) }}>PRISM</span>
                    <span style={{ fontSize: px(60), color: "#475569" }}> / {fmt(stats.cap, 0)}</span>
                  </>
                ) : (
                  <>
                    Ξ{fmt(stats.feesToHolders24h)}
                    <span style={{ fontSize: px(54), color: "#64748b", marginLeft: px(18) }}>ETH</span>
                  </>
                )}
              </div>
              <div style={{ fontSize: px(30), color: "#94a3b8", marginTop: px(44), fontFamily: '"Space Grotesk", sans-serif' }}>
                {template === "burn"
                  ? `${burnedPct.toFixed(2)}% of cap · supply only shrinks`
                  : `Ξ${stats.perPrism.toLocaleString(undefined, { maximumFractionDigits: 5 })} per PRISM`}
              </div>
              <div style={{ fontSize: px(40), fontWeight: 600, color: "#e2e8f0", marginTop: px(40), maxWidth: px(1500), lineHeight: 1.25 }}>
                {headline}
              </div>
              {sub && <div style={{ fontSize: px(28), color: "#94a3b8", marginTop: px(14) }}>{sub}</div>}
            </>
          )}
        </div>

        {template === "yield" &&
          (() => {
            const arch = rainbowArch(Math.round(7 * s));
            return (
              <div style={{ display: "flex", alignItems: "center", gap: px(16), marginTop: px(8) }}>
                <div style={{ position: "relative", width: arch.w, height: arch.h }}>
                  {arch.cells.map((c, i) => (
                    <div key={i} style={{ position: "absolute", left: c.x, top: c.y, width: c.s, height: c.s, background: c.color, borderRadius: c.s * 0.2 }} />
                  ))}
                </div>
                <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: px(34), letterSpacing: "-0.01em" }}>Prismbeat</span>
                <span style={{ marginLeft: "auto", fontSize: px(22), color: "#64748b", fontFamily: '"Space Grotesk", sans-serif' }}>prismbeat.xyz</span>
              </div>
            );
          })()}
      </div>
    </div>
  );
});
