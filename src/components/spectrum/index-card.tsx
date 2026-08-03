"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { BasketBento } from "@/components/spectrum/basket-bento";

export interface NavPoint {
  time: number;
  value: number;
}
export interface TopHolding {
  address: string;
  symbol: string;
  weightPct: number;
}
export type Chain = "ethereum" | "base" | "robinhood";
export interface IndexSummary {
  address: string;
  chain: Chain;
  name: string;
  symbol: string;
  basketLength: number;
  navPerToken: number;
  aumUsd: number;
  change24hPct: number | null;
  pricedCount: number;
  top: TopHolding[];
  navSeries: NavPoint[];
}

// Per-chain badge styling. Ethereum gets the classic periwinkle, Base its brand blue.
export const CHAIN_META: Record<Chain, { label: string; short: string; color: string }> = {
  ethereum: { label: "Ethereum", short: "ETH", color: "#8ea2ff" },
  base: { label: "Base", short: "BASE", color: "#4d8bff" },
  robinhood: { label: "Robinhood Chain", short: "HOOD", color: "#CCFF00" },
};

export function ChainBadge({ chain, className = "" }: { chain: Chain; className?: string }) {
  const m = CHAIN_META[chain] ?? CHAIN_META.base;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${className}`}
      style={{ color: m.color, background: `${m.color}14`, border: `1px solid ${m.color}33` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} />
      {m.short}
    </span>
  );
}

export function usd(n: number, dp?: number) {
  if (!isFinite(n)) return "$0";
  const d = dp ?? (n >= 1 ? 2 : 4);
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}
export function pct(n: number | null) {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

// full-spectrum SVG sparkline — the "Spectrum" identity, in miniature
export function Sparkline({ values }: { values: number[] }) {
  const raw = useId();
  const id = "spk" + raw.replace(/[^a-zA-Z0-9]/g, "");
  if (!values || values.length < 2) return <div className="h-full w-full rounded-md bg-white/[0.02]" />;
  const W = 100;
  const H = 40;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, H - ((v - min) / range) * (H - 5) - 2.5]);
  const line = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `0,${H} ${line} ${W},${H}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full">
      <defs>
        <linearGradient id={`${id}-l`} x1="0" y1="0" x2="100%" y2="0">
          <stop offset="0%" stopColor="#ff5a5a" />
          <stop offset="30%" stopColor="#ffe14d" />
          <stop offset="55%" stopColor="#5cff8f" />
          <stop offset="78%" stopColor="#3bd9ff" />
          <stop offset="100%" stopColor="#c06aff" />
        </linearGradient>
        <linearGradient id={`${id}-a`} x1="0" y1="0" x2="0" y2="100%">
          <stop offset="0%" stopColor="rgba(130,170,255,0.20)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${id}-a)`} />
      <polyline points={line} fill="none" stroke={`url(#${id}-l)`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function AssetLogo({ addr, symbol, size = 32, chain = "base" }: { addr: string; symbol: string; size?: number; chain?: Chain }) {
  const [ok, setOk] = useState(true);
  const box = { width: size, height: size };
  if (!ok) {
    return (
      <span
        className="grid place-items-center rounded-full ring-2 ring-[#0a0e14] bg-slate-700 font-bold text-slate-200 shrink-0"
        style={{ ...box, fontSize: Math.max(7, Math.round(size * 0.28)) }}
      >
        {(symbol || "?").replace(/^\$/, "").slice(0, 3).toUpperCase()}
      </span>
    );
  }
  // Load straight from DexScreener's CDN. We deliberately do NOT route through
  // /api/logo here: that proxy sets Cache-Control: immutable, and Netlify's edge
  // collapsed every /api/logo hit onto one cache entry — so most assets showed a
  // single shared icon. DexScreener URLs are per-token and hotlinkable, so direct
  // <img> requests stay distinct. (/api/logo is still used by the Studio, where
  // html2canvas needs same-origin images.)
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={`https://dd.dexscreener.com/ds-data/tokens/${chain}/${addr.toLowerCase()}.png?size=lg`}
      alt={symbol}
      onError={() => setOk(false)}
      className="rounded-full ring-2 ring-[#0a0e14] bg-slate-800 object-cover shrink-0"
      style={box}
    />
  );
}

// The pill's destination: OUR /spectrum page (owner fix 2026-07-07 — the old
// external dApp deep-link dumped users on a transaction-ish page for the new
// baskets; "it should just jump to the spectrum page").
export function spectrumBuyUrl(address: string) {
  void address;
  return "/spectrum#baskets";
}

// A "Spectrum" pill that jumps to the /spectrum page. Rendered inside
// the card's <Link>, so it stops the click from triggering the card's navigation.
// Uses a <span> (not <button>) to stay valid inside an anchor.
export function BuyPill({ address, symbol, className = "" }: { address: string; symbol: string; className?: string }) {
  const open = () => window.location.assign(spectrumBuyUrl(address));
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        open();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          open();
        }
      }}
      aria-label={`See ${symbol} on the Spectrum page`}
      className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold text-white cursor-pointer transition-transform hover:scale-105 ${className}`}
      style={{ background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
    >
      Spectrum
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M7 17 17 7" />
        <path d="M7 7h10v10" />
      </svg>
    </span>
  );
}

export function IndexCard({ ix }: { ix: IndexSummary }) {
  const up = (ix.change24hPct ?? 0) >= 0;
  const accent = up ? "#22c55e" : "#f87171";
  return (
    <Link
      href={`/baskets/${ix.address}`}
      className="glass-card block p-5 group relative overflow-hidden transition-all duration-200 hover:border-white/20 hover:-translate-y-0.5"
    >
      <div className="absolute -right-12 -top-12 w-36 h-36 rounded-full blur-3xl opacity-[0.12] group-hover:opacity-25 transition-opacity pointer-events-none" style={{ background: accent }} />
      <div className="relative z-10">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="txt-white font-bold text-lg leading-none">{ix.symbol}</span>
              <ChainBadge chain={ix.chain} />
            </div>
            <div className="text-[12px] text-slate-500 line-clamp-1 mt-1">{ix.name?.trim() || "—"}</div>
          </div>
          <span className="text-[10px] text-slate-400 font-mono shrink-0 rounded-full border border-white/10 px-2 py-0.5">{ix.basketLength} assets</span>
        </div>

        {/* the composition as a compact bento strip — the same treemap the
            popups use, so baskets read identically everywhere they surface */}
        <div className="h-16 mt-4 rounded-xl overflow-hidden">
          <BasketBento
            items={ix.top.map((t) => ({ symbol: t.symbol, address: t.address, weightPct: t.weightPct }))}
            chain={ix.chain}
          />
        </div>

        <div className="h-12 mt-4">
          <Sparkline values={ix.navSeries.map((p) => p.value)} />
        </div>

        <div className="flex items-end justify-between mt-3">
          <div>
            <div className="font-mono txt-white text-2xl leading-none tabular-nums">{usd(ix.navPerToken)}</div>
            <div className="text-[11px] text-slate-500 mt-1.5 font-mono">AUM {usd(ix.aumUsd, 0)}</div>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <span className="font-mono text-sm font-semibold tabular-nums" style={{ color: accent }}>{pct(ix.change24hPct)}</span>
            <BuyPill address={ix.address} symbol={ix.symbol} />
          </div>
        </div>
      </div>
    </Link>
  );
}
