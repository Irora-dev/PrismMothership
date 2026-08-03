"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { squarify } from "@/lib/spectrum/treemap";
import { SPECTRUM_V2 } from "@/lib/chain/constants";

// /robinhood — the Robinhood Chain world, matching the SpecCont bento asset's
// language: acid-yellow ground (#CCFF00), a dense BENTO GRID of mixed-size
// near-black tiles (hairline white rings, 20–26px radii, mono numbers) laid on
// a canvas WIDER than the viewport that pans HORIZONTALLY — mouse wheel, drag,
// or swipe. Spectrum baskets on Robinhood Chain lead; the chain's tokens follow.
// STRICTLY ALPHABETICAL everywhere — never ranked by TVL/liquidity/volume
// (ranking = preferential promotion). Market facts only; no buy links.

const GROTESK = '"Space Grotesk", "Plus Jakarta Sans", ui-sans-serif, sans-serif';
const MONO = '"SF Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const INK = "#0b0b0d";
const ACID = "#CCFF00";
const LINE = "rgba(255,255,255,0.55)";

interface RhTokenQuote {
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
interface BasketSummary {
  address: string;
  chain: string;
  name: string;
  symbol: string;
  basketLength: number;
  navPerToken: number;
  aumUsd: number;
  change24hPct: number | null;
  top: { address: string; symbol: string; weightPct: number }[];
}

// Demo baskets — layout/feel preview while the fresh factory has zero launches.
// Clearly badged DEMO; the first real launch replaces them automatically.
const DEMO_BASKETS: (BasketSummary & { demo?: boolean })[] = [
  { demo: true, address: "demo-hood6", chain: "robinhood", name: "The Hood Six", symbol: "HOOD6", basketLength: 6, navPerToken: 1.04, aumUsd: 412_000, change24hPct: 3.2, top: [{ address: "1", symbol: "CASHCAT", weightPct: 30 }, { address: "2", symbol: "DIH", weightPct: 20 }, { address: "3", symbol: "HOODRAT", weightPct: 15 }, { address: "4", symbol: "JUGGERNAUT", weightPct: 15 }, { address: "5", symbol: "MERRYMEN", weightPct: 10 }, { address: "6", symbol: "REPE", weightPct: 10 }] },
  { demo: true, address: "demo-merry", chain: "robinhood", name: "Merry Majors", symbol: "MERRY", basketLength: 3, navPerToken: 0.97, aumUsd: 268_000, change24hPct: -4.8, top: [{ address: "1", symbol: "MERRYMEN", weightPct: 40 }, { address: "2", symbol: "REPE", weightPct: 35 }, { address: "3", symbol: "CASHCAT", weightPct: 25 }] },
  { demo: true, address: "demo-degen", chain: "robinhood", name: "Degen Alley", symbol: "ALLEY", basketLength: 4, navPerToken: 1.31, aumUsd: 151_000, change24hPct: 12.6, top: [{ address: "1", symbol: "REPE", weightPct: 45 }, { address: "2", symbol: "HOODRAT", weightPct: 25 }, { address: "3", symbol: "DIH", weightPct: 20 }, { address: "4", symbol: "JUGGERNAUT", weightPct: 10 }] },
];
const PIE_COLORS = ["#CCFF00", "#35e0ff", "#ff4db8", "#ffb224", "#a48bff", "#4ade80", "#fb7185"];
// brand accents for the chain's tokens (matches the token registry)
const RH_ACCENTS: Record<string, string> = { CASHCAT: "#ffb224", DIH: "#a48bff", HOODRAT: "#35e0ff", JUGGERNAUT: "#ff4db8", MERRYMEN: "#fb7185", REPE: "#4ade80" };

const usd = (n: number | null, dp?: number) => {
  if (n == null || !isFinite(n)) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n).toLocaleString("en-US")}`;
  return `$${n.toFixed(dp ?? (n >= 1 ? 2 : n >= 0.01 ? 4 : 6))}`;
};
const pct = (n: number | null) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function HoodFeather({ size = 22, color = INK }: { size?: number; color?: string }) {
  return (
    <svg width={(size * 65) / 84} height={size} viewBox="0 0 65 84" fill={color} aria-hidden>
      <path d="M41.2967 18.946H24.3318C23.7179 18.946 23.1598 19.1707 22.7692 19.7325L10.6035 34.9005C8.81775 37.1477 8.3713 39.2262 8.3713 42.2037V57.7088C4.40909 68.8882 1.89783 76.4722 0.0562398 83.3259C-0.111178 83.7753 0.112046 84 0.502686 84H2.34428C2.67911 84 2.95814 83.8315 3.12556 83.5506C17.0212 47.9338 32.1446 30.294 41.6316 19.7325C42.0222 19.2831 41.8548 18.946 41.2967 18.946Z" />
      <path d="M41.7991 1.47599C40.7388 1.98159 40.1807 2.09394 39.0646 3.10515C34.0421 7.43084 30.6937 10.8577 27.5128 14.2284C27.1222 14.6216 27.2896 15.0149 27.8476 15.0149H46.6542C48.3842 15.0149 49.3887 16.0261 49.3887 17.7676V39.1152C49.3887 39.6769 49.8351 39.8455 50.1699 39.3399L61.4985 24.4527C63.3401 22.0371 63.8982 21.3068 64.4004 17.9361C65.0701 12.9924 64.6795 5.40844 61.7217 2.26248C59.0989 -0.546415 47.268 -0.658771 41.7991 1.47599Z" />
      <path d="M44.6454 23.2157C32.982 36.3051 23.8856 50.0687 15.4589 66.6412C15.2357 67.0906 15.5147 67.4277 16.017 67.2591L33.4284 61.8661C35.3816 61.3605 36.4977 60.4616 37.4464 58.8886L45.2034 46.0239C45.3709 45.6868 45.4267 45.2936 45.4267 45.0127V23.5528C45.4267 22.991 45.036 22.7663 44.6454 23.2157Z" />
    </svg>
  );
}

// bento tile chrome — near-black, hairline ring, inset sheen (no drop shadows)
const tileStyle: React.CSSProperties = {
  background: INK,
  border: `1px solid ${LINE}`,
  borderRadius: 22,
  color: "#f5f5f2",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,.06)",
  overflow: "hidden",
  position: "relative",
};

function Tile({ rows = 1, cols = 1, children, className = "", style }: { rows?: number; cols?: number; children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`rh-sheen ${className}`} style={{ ...tileStyle, gridRow: `span ${rows}`, gridColumn: `span ${cols}`, ...style }}>
      {children}
    </div>
  );
}

// A compact squarified treemap of a basket's composition — the bento-in-a-card.
// Computed in a fixed 200×110 space, rendered as percentages so it scales.
function MiniBento({ items }: { items: { symbol: string; weightPct: number }[] }) {
  const W = 200, H = 110;
  const rects = squarify(
    items.filter((i) => i.weightPct > 0).map((i) => ({ ticker: i.symbol, weight: Math.pow(i.weightPct, 0.65) })),
    W, H,
  );
  return (
    <div className="relative w-full h-full min-h-0 rounded-[10px] overflow-hidden">
      {rects.map((r) => {
        const color = RH_ACCENTS[r.ticker] ?? "#8ea2ff";
        const showLabel = r.w / W > 0.2 && r.h / H > 0.22;
        return (
          <div key={r.ticker} className="absolute p-[1.5px]" style={{ left: `${(r.x / W) * 100}%`, top: `${(r.y / H) * 100}%`, width: `${(r.w / W) * 100}%`, height: `${(r.h / H) * 100}%` }}>
            <div className="relative h-full w-full rounded-[7px] overflow-hidden" style={{ background: color }}>
              <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.2), rgba(255,255,255,0) 40%, rgba(0,0,0,0.24))" }} />
              {showLabel && (
                <span className="absolute left-1 top-1 rounded-[4px] px-1 py-[1px] text-[8px] font-black leading-none" style={{ fontFamily: MONO, background: "rgba(255,255,255,0.92)", color: "#000" }}>
                  {r.ticker}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// 24h price sparkline reconstructed from DexScreener's real 1h/6h/24h changes —
// honest anchor points (t−24h, t−6h, t−1h, now) smoothed into a curve, with a
// hover/touch crosshair reading out the interpolated price + hours-ago.
function Spark({ t }: { t: RhTokenQuote }) {
  const [hx, setHx] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  if (t.priceUsd == null || t.change24hPct == null) return null;
  const p = t.priceUsd;
  const at = (ch: number | null) => (ch == null ? null : p / (1 + ch / 100));
  const anchors: [number, number][] = [];
  const a24 = at(t.change24hPct), a6 = at(t.change6hPct), a1 = at(t.change1hPct);
  if (a24 != null) anchors.push([0, a24]);
  if (a6 != null) anchors.push([18, a6]);
  if (a1 != null) anchors.push([23, a1]);
  anchors.push([24, p]);
  if (anchors.length < 2) return null;
  const W = 100, H = 30;
  const vals = anchors.map((a) => a[1]);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const pts = anchors.map(([h, v]) => [(h / 24) * W, H - 2 - ((v - min) / span) * (H - 4)] as [number, number]);
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    d += ` Q ${x0 + (x1 - x0) / 2},${y0} ${x1},${y1}`;
  }
  const up = (t.change24hPct ?? 0) >= 0;
  const c = up ? "#7dff9a" : "#ff7d7d";
  // linear interpolation across anchors for the hover readout
  const valueAt = (x: number) => {
    const h = (x / W) * 24;
    for (let i = 1; i < anchors.length; i++) {
      const [h0, v0] = anchors[i - 1], [h1, v1] = anchors[i];
      if (h <= h1) return v0 + ((v1 - v0) * (h - h0)) / Math.max(0.001, h1 - h0);
    }
    return p;
  };
  const onMove = (e: React.PointerEvent) => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    setHx(Math.min(W, Math.max(0, ((e.clientX - r.left) / r.width) * W)));
  };
  const hv = hx != null ? valueAt(hx) : null;
  const hy = hv != null ? H - 2 - ((hv - min) / span) * (H - 4) : 0;
  const agoH = hx != null ? Math.round(24 - (hx / W) * 24) : 0;
  return (
    <div ref={boxRef} className="relative w-full h-full" onPointerMove={onMove} onPointerLeave={() => setHx(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full" aria-hidden>
        <path d={`${d} L ${W},${H} L 0,${H} Z`} fill={c} opacity="0.10" />
        <path d={d} fill="none" stroke={c} strokeWidth="1" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {hx != null && (
          <>
            <line x1={hx} y1="0" x2={hx} y2={H} stroke="rgba(255,255,255,0.35)" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
            <circle cx={hx} cy={hy} r="1.8" fill={c} />
          </>
        )}
      </svg>
      {hx != null && hv != null && (
        <div
          className="absolute -top-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold tabular-nums pointer-events-none"
          style={{ fontFamily: MONO, background: "rgba(11,11,13,0.92)", border: "1px solid rgba(255,255,255,0.2)", color: "#f5f5f2", left: `min(max(${(hx / W) * 100}% - 34px, 0%), calc(100% - 70px))` }}
        >
          {usd(hv)} · {agoH === 0 ? "now" : `${agoH}h ago`}
        </div>
      )}
    </div>
  );
}

// Cumulative PRISM burn stepline — every buy-and-burn ever, climbing to the
// current total. Protocol-wide (the burn settles on Ethereum). Hover/touch
// reads out the cumulative total at that moment.
function BurnChart({ points }: { points: { ts: number; total: number }[] }) {
  const [hx, setHx] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  if (points.length < 1) return null;
  const W = 100, H = 34;
  const t0 = points[0].ts, t1 = Date.now();
  const span = Math.max(1, t1 - t0);
  const max = points[points.length - 1].total || 1;
  const xy = (ts: number, v: number) => [((ts - t0) / span) * W, H - 2 - (v / max) * (H - 6)] as [number, number];
  let d = `M 0,${H - 2}`;
  let prev = 0;
  for (const pt of points) {
    const [x, y] = xy(pt.ts, pt.total);
    const [, yPrev] = xy(pt.ts, prev);
    d += ` L ${x},${yPrev} L ${x},${y}`;
    prev = pt.total;
  }
  d += ` L ${W},${xy(t1, prev)[1]}`;
  const totalAt = (x: number) => {
    const ts = t0 + (x / W) * span;
    let v = 0;
    for (const pt of points) {
      if (pt.ts <= ts) v = pt.total;
      else break;
    }
    return v;
  };
  const onMove = (e: React.PointerEvent) => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    setHx(Math.min(W, Math.max(0, ((e.clientX - r.left) / r.width) * W)));
  };
  const hv = hx != null ? totalAt(hx) : null;
  const hy = hv != null ? H - 2 - (hv / max) * (H - 6) : 0;
  const hd = hx != null ? new Date(t0 + (hx / W) * span) : null;
  return (
    <div ref={boxRef} className="relative w-full h-full" onPointerMove={onMove} onPointerLeave={() => setHx(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full" aria-hidden>
        <path d={`${d} L ${W},${H} L 0,${H} Z`} fill="#ff9f45" opacity="0.10" />
        <path d={d} fill="none" stroke="#ff9f45" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {hx != null && (
          <>
            <line x1={hx} y1="0" x2={hx} y2={H} stroke="rgba(255,255,255,0.35)" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
            <circle cx={hx} cy={hy} r="1.8" fill="#ff9f45" />
          </>
        )}
      </svg>
      {hx != null && hv != null && hd != null && (
        <div
          className="absolute -top-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold tabular-nums pointer-events-none"
          style={{ fontFamily: MONO, background: "rgba(11,11,13,0.92)", border: "1px solid rgba(255,255,255,0.2)", color: "#f5f5f2", left: `min(max(${(hx / W) * 100}% - 40px, 0%), calc(100% - 96px))` }}
        >
          {hv.toFixed(2)} PRISM · {hd.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </div>
      )}
    </div>
  );
}

function KV({ k, v, color, big = false }: { k: string; v: string; color?: string; big?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 min-w-0">
      <span className={`${big ? "text-[13px]" : "text-[10px]"} uppercase tracking-[0.14em] truncate`} style={{ color: "rgba(245,245,242,0.45)" }}>{k}</span>
      <span className={`${big ? "text-[17px]" : "text-[13px]"} font-bold tabular-nums shrink-0`} style={{ fontFamily: MONO, color: color ?? "#f5f5f2" }}>{v}</span>
    </div>
  );
}

export default function RobinhoodPage() {
  const [tokens, setTokens] = useState<RhTokenQuote[] | null>(null);
  const [baskets, setBaskets] = useState<BasketSummary[] | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [burn, setBurn] = useState<{ points: { ts: number; total: number }[]; total: number; today: number } | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const railRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/prism/burn-series")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && !j.error && setBurn(j))
      .catch(() => {});
    const t = setInterval(() => setNowTick(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    fetch("/api/robinhood/tokens")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.tokens) {
          setTokens(j.tokens);
          setUpdatedAt(j.updatedAt ?? null);
        }
      })
      .catch(() => setTokens([]));
    fetch("/api/spectrum/indexes")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const list = (j?.indexes ?? []) as BasketSummary[];
        setBaskets(list.filter((b) => b.chain === "robinhood").sort((a, b) => a.symbol.localeCompare(b.symbol)));
      })
      .catch(() => setBaskets([]));
  }, []);

  // mouse wheel pans the grid horizontally (trackpads already pan natively)
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // drag-to-pan
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    let down = false, startX = 0, startLeft = 0;
    const md = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return; // touch pans natively — don't fight it
      if ((e.target as HTMLElement).closest("a,button")) return;
      down = true;
      startX = e.clientX;
      startLeft = el.scrollLeft;
      el.setPointerCapture(e.pointerId);
    };
    const mm = (e: PointerEvent) => {
      if (down) el.scrollLeft = startLeft - (e.clientX - startX);
    };
    const mu = () => (down = false);
    el.addEventListener("pointerdown", md);
    el.addEventListener("pointermove", mm);
    el.addEventListener("pointerup", mu);
    el.addEventListener("pointercancel", mu);
    return () => {
      el.removeEventListener("pointerdown", md);
      el.removeEventListener("pointermove", mm);
      el.removeEventListener("pointerup", mu);
      el.removeEventListener("pointercancel", mu);
    };
  }, []);

  const tickerItems = tokens?.filter((t) => t.priceUsd != null) ?? [];
  // real baskets when they exist; DEMO set (badged) while the fresh factory has none
  const isDemo = baskets != null && baskets.length === 0;
  const shownBaskets: (BasketSummary & { demo?: boolean })[] = baskets == null ? [] : isDemo ? DEMO_BASKETS : baskets;
  const totalTvl = shownBaskets.reduce((s2, b) => s2 + (b.aumUsd || 0), 0);
  // conic-gradient pie of each basket's share of total TVL (A–Z order, palette colors)
  const pieStops: string[] = [];
  let acc = 0;
  shownBaskets.forEach((b, i) => {
    const share = totalTvl > 0 ? (b.aumUsd / totalTvl) * 360 : 0;
    pieStops.push(`${PIE_COLORS[i % PIE_COLORS.length]} ${acc}deg ${acc + share}deg`);
    acc += share;
  });
  // baskets + the demo note fill columns of 4 rows; 1 column → stretch to fill the first screen
  const basketCols = Math.max(1, Math.ceil((shownBaskets.length + (isDemo ? 1 : 0)) / 4));
  const pieBg = pieStops.length ? `conic-gradient(${pieStops.join(", ")})` : `conic-gradient(rgba(255,255,255,0.12) 0deg 360deg)`;

  return (
    <div className="fixed inset-0 flex flex-col select-none" style={{ background: ACID, fontFamily: GROTESK }}>
      {/* ── header ── */}
      <header className="flex items-center justify-between px-5 md:px-7 pt-4 pb-3 shrink-0">
        <div className="flex items-center gap-3">
          <HoodFeather size={24} />
          <span className="text-[18px] md:text-[21px] font-bold tracking-tight" style={{ color: INK }}>Spectrum</span>
          <span className="hidden sm:inline rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em]" style={{ background: INK, color: ACID }}>
            Robinhood Chain
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden md:flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "rgba(11,11,13,0.55)" }}>
            <span className="h-2 w-2 rounded-full" style={{ background: "#0da750", boxShadow: "0 0 7px #0da750", animation: "live-pulse 2s ease-in-out infinite" }} />
            live{updatedAt ? ` · ${Math.max(0, Math.round((nowTick - updatedAt) / 1000))}s ago` : ""} · A–Z · scroll →
          </span>
          <Link href="/spectrum" className="rounded-full px-4 py-2 text-[13px] font-bold transition-transform hover:scale-[1.04]" style={{ background: INK, color: "#f5f5f2" }}>
            ← Prismbeat
          </Link>
        </div>
      </header>

      {/* ── the panning bento rail: fixed TVL column · fill-width baskets · tokens ── */}
      <div
        ref={railRef}
        className="flex-1 flex items-stretch gap-2 overflow-x-auto overflow-y-hidden px-5 md:px-7 pb-3"
        style={{ scrollbarWidth: "thin", scrollbarColor: `${INK} transparent`, cursor: "grab" }}
      >
        {/* column A — TVL + chain facts (fixed width) */}
        <div className="flex h-full shrink-0 flex-col gap-2" style={{ width: "clamp(250px, 24vw, 360px)" }}>
          <Tile className="flex-[2.3] min-h-0 p-4 flex flex-col items-center justify-between">
            <div className="flex-1 w-full [@media(max-height:560px)]:hidden flex items-center justify-center py-2 mb-2" style={{ minHeight: 64 }}>
              <div
                className="rounded-full"
                style={{ height: "100%", minHeight: 56, maxHeight: "38vh", aspectRatio: "1 / 1", maxWidth: "100%", background: pieBg, border: `1px solid ${LINE}`, position: "relative" }}
              >
                <div className="absolute rounded-full flex items-center justify-center" style={{ inset: "27%", background: INK, border: "1px solid rgba(255,255,255,0.18)" }}>
                  <HoodFeather size={22} color={ACID} />
                </div>
              </div>
            </div>
            <div className="shrink-0 w-full text-center">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: "rgba(245,245,242,0.5)" }}>
                Basket TVL {isDemo && <span style={{ color: ACID }}>· demo</span>}
              </div>
              <div className="mt-2 text-[clamp(24px,2.6vw,38px)] font-bold tabular-nums leading-none" style={{ fontFamily: MONO }}>
                {baskets == null ? "—" : usd(totalTvl)}
              </div>
              <div className="mt-2.5 flex items-center justify-center gap-x-3 gap-y-1 flex-wrap">
                {shownBaskets.slice(0, 4).map((b, i) => (
                  <span key={b.address} className="flex items-center gap-1 text-[10px] font-bold" style={{ fontFamily: MONO }}>
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    ${b.symbol} <span style={{ color: "rgba(245,245,242,0.45)" }}>{totalTvl > 0 ? Math.round((b.aumUsd / totalTvl) * 100) : 0}%</span>
                  </span>
                ))}
              </div>
            </div>
          </Tile>
          <Tile className="[@media(max-height:560px)]:hidden flex-[1.3] min-h-0 p-3.5 flex flex-col">
            <div className="flex items-baseline justify-between gap-2 shrink-0">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: "#ff9f45" }}>🔥 PRISM burned</span>
              <span className="text-[13px] font-bold tabular-nums" style={{ fontFamily: MONO }}>{burn ? burn.total.toFixed(2) : "—"}</span>
            </div>
            <div className="flex-1 min-h-0 mt-1.5">{burn && <BurnChart points={burn.points} />}</div>
            <div className="flex items-baseline justify-between gap-2 shrink-0 mt-1">
              <span className="text-[9px] uppercase tracking-[0.12em]" style={{ color: "rgba(245,245,242,0.4)" }}>protocol-wide · all-time</span>
              <span className="text-[10px] font-bold tabular-nums" style={{ fontFamily: MONO, color: "rgba(245,245,242,0.6)" }}>{burn ? `${burn.today.toFixed(2)} today` : ""}</span>
            </div>
          </Tile>
          <Tile className="flex-[0.55] min-h-0 px-3.5 py-2 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] truncate" style={{ color: "rgba(245,245,242,0.5)" }}>Tokens 24h</div>
              <div className="text-[18px] font-bold tabular-nums leading-tight" style={{ fontFamily: MONO }}>{tokens ? usd(tokens.reduce((a, t) => a + (t.volume24hUsd ?? 0), 0)) : "—"}</div>
            </div>
            <div className="min-w-0 text-right">
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] truncate" style={{ color: "rgba(245,245,242,0.5)" }}>Liquidity</div>
              <div className="text-[18px] font-bold tabular-nums leading-tight" style={{ fontFamily: MONO }}>{tokens ? usd(tokens.reduce((a, t) => a + (t.liquidityUsd ?? 0), 0)) : "—"}</div>
            </div>
          </Tile>
          <Tile className="flex-[0.4] min-h-0 px-3.5 flex items-center justify-between gap-2" style={{ background: "transparent", border: "1px solid rgba(11,11,13,0.5)", color: INK, boxShadow: "none" }}>
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] truncate">Robinhood · 4663 · A→Z</span>
            <span className="text-[10px] font-bold shrink-0" style={{ fontFamily: MONO }}>Orbit · ETH gas</span>
          </Tile>
          <Link href="/charts" className="rh-sheen flex-[0.55] min-h-0 px-3.5 flex items-center justify-between gap-2 transition-transform hover:scale-[1.01]" style={{ ...tileStyle }}>
            <span className="text-[13px] font-bold" style={{ color: "#f5f5f2" }}>Learn more about PRISM</span>
            <span className="text-[16px] font-bold shrink-0" style={{ color: ACID }}>→</span>
          </Link>
          <Link href="/baskets" className="rh-sheen flex-[0.55] min-h-0 px-3.5 flex items-center justify-between gap-2 transition-transform hover:scale-[1.01]" style={{ ...tileStyle }}>
            <span className="text-[13px] font-bold" style={{ color: "#f5f5f2" }}>Learn more about Spectrum</span>
            <span className="text-[16px] font-bold shrink-0" style={{ color: ACID }}>→</span>
          </Link>
        </div>

        {/* BASKETS divider */}
        <Tile className="h-full shrink-0 p-2 flex items-center justify-center" style={{ width: "clamp(38px, 3.2vw, 54px)" }}>
          <span className="text-[clamp(18px,1.9vw,28px)] font-bold tracking-tight leading-none" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", color: ACID }}>
            BASKETS
          </span>
        </Tile>

        {/* baskets — ALWAYS fills the remaining first-screen width & full height,
            nestling the tokens divider at the viewport edge */}
        <div
          className="h-full shrink-0"
          style={
            basketCols <= 1
              ? { width: "calc((100vw - clamp(250px, 24vw, 360px) - 2 * clamp(38px, 3.2vw, 54px) - 88px) / 2)", minWidth: 390 }
              : { width: "max-content" }
          }
        >
          <div
            className="grid h-full gap-2"
            style={{ gridTemplateRows: "repeat(4, minmax(0, 1fr))", gridAutoFlow: "column", gridAutoColumns: basketCols <= 1 ? "100%" : "clamp(400px, 36vw, 620px)" }}
          >
            {baskets == null ? (
              <Tile rows={4} className="p-5 flex items-center justify-center">
                <span className="text-[12px]" style={{ fontFamily: MONO, color: "rgba(245,245,242,0.5)" }}>reading the chain…</span>
              </Tile>
            ) : (
              shownBaskets.map((b) => {
                const inner = (
                  <>
                    <div className="flex flex-col justify-between min-w-0 shrink-0" style={{ width: "26%" }}>
                      <div className="min-w-0">
                        <div className="text-[17px] font-bold tracking-tight truncate">${b.symbol}</div>
                        <div className="[@media(max-height:560px)]:hidden text-[10px] truncate" style={{ color: "rgba(245,245,242,0.55)" }}>{b.name}</div>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[11px] font-bold tabular-nums" style={{ fontFamily: MONO }}>{usd(b.aumUsd)}</span>
                        <span className="text-[11px] font-bold tabular-nums" style={{ fontFamily: MONO, color: (b.change24hPct ?? 0) >= 0 ? "#7dff9a" : "#ff7d7d" }}>{pct(b.change24hPct)}</span>
                      </div>
                    </div>
                    <div className="flex-1 min-h-0 min-w-0">
                      <MiniBento items={b.top} />
                    </div>
                    <span
                      className="absolute right-2.5 top-2.5 rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.14em]"
                      style={b.demo ? { background: "rgba(11,11,13,0.75)", color: "rgba(245,245,242,0.65)", border: "1px dashed rgba(255,255,255,0.35)" } : { background: "rgba(11,11,13,0.75)", color: ACID, border: `1px solid ${ACID}55` }}
                    >
                      {b.demo ? "Demo" : "Basket"}
                    </span>
                  </>
                );
                return b.demo ? (
                  <Tile key={b.address} className="p-3 flex gap-3">{inner}</Tile>
                ) : (
                  <Link key={b.address} href={`/baskets/${b.address}`} style={{ ...tileStyle }} className="rh-sheen p-3 flex gap-3 transition-transform hover:scale-[1.005]">
                    {inner}
                  </Link>
                );
              })
            )}
            {!isDemo && baskets != null && shownBaskets.length > 0 && shownBaskets.length < 4 && (
              <Tile rows={(4 - shownBaskets.length) as 1 | 2 | 3} className="p-5 flex flex-col justify-center gap-2">
                <span className="text-[clamp(20px,2.2vw,30px)] font-bold leading-none tracking-tight" style={{ color: ACID }}>Room for more.</span>
                <p className="text-[clamp(15px,1.6vw,22px)] font-bold leading-tight" style={{ color: "rgba(245,245,242,0.85)" }}>
                  Every basket launched on Robinhood Chain lists here automatically, A to Z.
                </p>
              </Tile>
            )}
            {isDemo && (
              <Tile className="p-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <span className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: ACID }}>Demo preview</span>
                  <p className="mt-0.5 text-[11px] leading-snug" style={{ color: "rgba(245,245,242,0.55)" }}>
                    The factory is live with zero launches. The first real basket replaces these automatically.
                  </p>
                </div>
                <span className="shrink-0 text-[11px] font-bold tabular-nums" style={{ fontFamily: MONO }}>{short(SPECTRUM_V2.hoodFactory)}</span>
              </Tile>
            )}
          </div>
        </div>

        {/* TOKENS divider */}
        <Tile className="h-full shrink-0 p-2 flex items-center justify-center" style={{ width: "clamp(38px, 3.2vw, 54px)" }}>
          <span className="text-[clamp(18px,1.9vw,28px)] font-bold tracking-tight leading-none" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", color: ACID }}>
            TOKENS
          </span>
        </Tile>

        {/* tokens + outro — thesis leads, then 3 short token rows per column, big charts */}
        <div className="h-full shrink-0" style={{ width: "max-content" }}>
          <div className="grid h-full gap-2" style={{ gridTemplateRows: "repeat(3, minmax(0, 1fr))", gridAutoFlow: "column", gridAutoColumns: "clamp(250px, 22vw, 350px)" }}>
            <Tile rows={3} className="p-5 flex flex-col justify-between">
              <div>
                <HoodFeather size={38} color={ACID} />
                <div className="mt-3 text-[clamp(24px,2.6vw,36px)] font-bold leading-[1.05] tracking-tight">One token can hold the whole chain&apos;s thesis.</div>
                <p className="mt-3 text-[clamp(15px,1.6vw,21px)] font-bold leading-snug" style={{ color: "rgba(245,245,242,0.75)" }}>
                  Spectrum baskets bundle tokens into a single on-chain asset, launched permissionlessly, every trade feeding the PRISM burn.
                </p>
              </div>
              <div className="flex flex-col gap-2.5">
                <Link href="/spectrum" className="rounded-2xl w-full py-3.5 text-center text-[16px] font-bold transition-transform hover:scale-[1.02]" style={{ background: ACID, color: INK }}>
                  Explore Spectrum
                </Link>
                <Link href="/contracts" className="rounded-2xl w-full py-3.5 text-center text-[16px] font-bold transition-transform hover:scale-[1.02]" style={{ border: "1.5px solid rgba(255,255,255,0.4)", color: "#f5f5f2" }}>
                  The contracts
                </Link>
              </div>
            </Tile>

            {(tokens ?? []).map((t) => (
              <Tile key={t.id} rows={1} className="p-3 flex flex-col">
                <div className="flex items-center gap-2 shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={t.logo} alt="" className="h-7 w-7 rounded-lg object-cover shrink-0" style={{ border: `1.5px solid ${t.accent}` }} />
                  <span className="text-[14px] font-bold tracking-tight truncate" style={{ color: t.accent }}>${t.symbol}</span>
                  <span className="ml-auto text-[14px] font-bold tabular-nums shrink-0" style={{ fontFamily: MONO }}>{usd(t.priceUsd)}</span>
                  <span className="text-[11px] font-bold tabular-nums shrink-0" style={{ fontFamily: MONO, color: (t.change24hPct ?? 0) >= 0 ? "#7dff9a" : "#ff7d7d" }}>
                    {pct(t.change24hPct)}
                  </span>
                </div>
                <div className="flex-1 min-h-0 my-1.5">
                  <Spark t={t} />
                </div>
                <div className="flex items-baseline justify-between gap-2 shrink-0 text-[10px] font-bold tabular-nums" style={{ fontFamily: MONO, color: "rgba(245,245,242,0.55)" }}>
                  <span>V {usd(t.volume24hUsd)}</span>
                  <span>L {usd(t.liquidityUsd)}</span>
                  <span>FDV {usd(t.fdvUsd)}</span>
                </div>
              </Tile>
            ))}
            {tokens == null && (
              <Tile rows={3} className="p-4 flex items-center justify-center">
                <span className="text-[12px]" style={{ fontFamily: MONO, color: "rgba(245,245,242,0.5)" }}>pricing live…</span>
              </Tile>
            )}

            <Tile rows={3} className="p-5 flex flex-col justify-center gap-3">
              <KV big k="Launches" v="Permissionless" />
              <KV big k="Fee split" v="Fixed constants" />
              <KV big k="Every trade" v="Feeds the burn" color={ACID} />
              <KV big k="Admin keys" v="None · verified" />
            </Tile>
          </div>
        </div>
      </div>

      {/* ── ticker ── */}
      <footer className="shrink-0 overflow-hidden border-t" style={{ borderColor: "rgba(11,11,13,0.25)" }}>
        <div className="flex whitespace-nowrap py-2" style={{ animation: "rh-marquee 30s linear infinite", width: "max-content" }}>
          {[0, 1].map((rep) => (
            <span key={rep} className="flex items-center">
              {shownBaskets.map((b) => (
                <span key={`${rep}-b-${b.address}`} className="mx-6 text-[12px] font-bold tabular-nums" style={{ fontFamily: MONO, color: INK }}>
                  🧺 ${b.symbol} {usd(b.navPerToken)}{" "}
                  {b.change24hPct != null && <span style={{ opacity: 0.7 }}>{pct(b.change24hPct)}</span>}
                  {b.demo ? <span style={{ opacity: 0.5 }}> DEMO</span> : ""}
                </span>
              ))}
              {(tickerItems.length ? tickerItems : [{ id: "x", symbol: "ROBINHOOD CHAIN", priceUsd: null, change24hPct: null } as RhTokenQuote]).map((t) => (
                <span key={`${rep}-${t.id}`} className="mx-6 text-[12px] font-bold tabular-nums" style={{ fontFamily: MONO, color: INK }}>
                  ${t.symbol} {t.priceUsd != null ? usd(t.priceUsd) : ""}{" "}
                  {t.change24hPct != null && <span style={{ opacity: 0.7 }}>{pct(t.change24hPct)}</span>}
                </span>
              ))}
              <span className="mx-6 text-[12px] font-bold" style={{ fontFamily: MONO, color: "rgba(11,11,13,0.55)" }}>
                LIVE DATA{updatedAt ? ` · AS OF ${new Date(updatedAt).toUTCString().slice(17, 22)} UTC` : ""} · A–Z, NOTHING RANKED
              </span>
            </span>
          ))}
        </div>
      </footer>
    </div>
  );
}
