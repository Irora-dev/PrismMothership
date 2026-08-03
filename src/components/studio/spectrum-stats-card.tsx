"use client";

import { forwardRef } from "react";
import { PixelRainbow } from "@/components/effects/pixel-rainbow";
import { RANGES } from "@/lib/feed/types";
import type { SpectrumChartsPayload } from "@/lib/spectrum/spectrum-charts";

// The 1200×630 Spectrum-recap social card. One fixed, deliberate layout fed
// straight from /api/spectrum/charts (the exact payload the /spectrum page
// renders), so every figure on the image is the live on-chain number at the
// moment of export. Inline styles only — the Studio scales it for preview and
// captures it at 2× with modern-screenshot, same as the other cards.

export const STATS_W = 1200;
export const STATS_H = 630;

const SERIF = '"Playfair Display", Georgia, serif';
const GROTESK = '"Space Grotesk", "Plus Jakarta Sans", ui-sans-serif, sans-serif';
const SANS = '"Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif';
const MONO = '"Space Grotesk", "SF Mono", ui-monospace, monospace';

// chain colors — the same trio the /spectrum charts use
const CHAIN = {
  ethereum: { label: "Ethereum", color: "#818cf8" },
  base: { label: "Base", color: "#38bdf8" },
  robinhood: { label: "Robinhood", color: "#ccff00" },
} as const;

const SPLIT = [
  { key: "holders", label: "PRISM holders", color: "#34d399" },
  { key: "burn", label: "PRISM burn", color: "#fb923c" },
  { key: "creator", label: "Creators", color: "#38bdf8" },
  { key: "interfaces", label: "Interfaces", color: "#a78bfa" },
  { key: "league", label: "Creator league", color: "#facc15" },
] as const;

const sum = (xs: number[] | undefined) => (xs ?? []).reduce((a, b) => a + b, 0);

function usd(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}K`;
  if (n >= 1000) return `$${Math.round(n).toLocaleString("en-US")}`;
  if (n >= 10) return `$${Math.round(n)}`;
  return `$${n.toFixed(2)}`;
}

function stamp(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: SANS, fontSize: 13, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase", color: "#8b93a7" }}>
      {children}
    </div>
  );
}

export const SpectrumStatsCard = forwardRef<HTMLDivElement, { data: SpectrumChartsPayload | null; headline: string; tagline: string; className?: string }>(
  function SpectrumStatsCard({ data, headline, tagline, className }, ref) {
    const buckets = data?.buckets ?? [];
    const launches = sum(data?.launchesEth) + sum(data?.launchesBase) + sum(data?.launchesHood);
    const buys = sum(data?.buys);
    const sells = sum(data?.sells);
    const trades = buys + sells;
    const volume = sum(data?.buyVolumeUsd) + sum(data?.sellVolumeUsd);
    const feesByChain = {
      ethereum: sum(data?.feesEthUsd),
      base: sum(data?.feesBaseUsd),
      robinhood: sum(data?.feesHoodUsd),
    };
    const fees = feesByChain.ethereum + feesByChain.base + feesByChain.robinhood;
    const auctionEth = data?.auctionEth ?? 0;
    const traders = data?.tradersTotal ?? 0;
    const top = (data?.topBaskets ?? []).slice(0, 3);
    const topMax = Math.max(1, ...top.map((t) => t.volumeUsd));
    const split = data?.feeSplit ?? { holders: 0, burn: 0, creator: 0, interfaces: 0, league: 0 };
    const splitTotal = split.holders + split.burn + split.creator + split.interfaces + (split.league ?? 0);
    const rangeCaption = (data ? RANGES[data.range].caption : "last 24 hours").toUpperCase();

    // stacked per-chain fee columns for the hourly chart
    const bars = buckets.map((t, i) => ({
      t,
      eth: data?.feesEthUsd?.[i] ?? 0,
      base: data?.feesBaseUsd?.[i] ?? 0,
      hood: data?.feesHoodUsd?.[i] ?? 0,
    }));
    const barMax = Math.max(1e-9, ...bars.map((b) => b.eth + b.base + b.hood));
    const CH_W = 384;
    const CH_H = 128;
    const gap = 3;
    const bw = bars.length ? (CH_W - gap * (bars.length - 1)) / bars.length : 0;

    const windowStamp =
      buckets.length > 1 ? `${stamp(buckets[0])} → ${stamp(buckets[buckets.length - 1] + (data?.bucketMs ?? 0))}` : "";

    const heroes: { label: string; value: string; sub: string; color?: string }[] = [
      { label: "Baskets launched", value: launches.toLocaleString("en-US"), sub: `Ξ${auctionEth.toLocaleString("en-US", { maximumFractionDigits: 2 })} auction → PRISM burn`, color: "#38bdf8" },
      { label: "Basket trades", value: trades.toLocaleString("en-US"), sub: `${buys.toLocaleString("en-US")} buys · ${sells.toLocaleString("en-US")} sells` },
      { label: "Volume", value: usd(volume), sub: `${traders.toLocaleString("en-US")} unique traders` },
      { label: "Fees earned", value: usd(fees), sub: "Ethereum · Base · Robinhood", color: "#34d399" },
    ];

    return (
      <div
        ref={ref}
        className={className}
        style={{
          width: STATS_W,
          height: STATS_H,
          position: "relative",
          overflow: "hidden",
          background: "linear-gradient(140deg, #0b1026 0%, #070812 55%, #040308 100%)",
          color: "#f8fafc",
          fontFamily: SANS,
        }}
      >
        {/* ── backdrop stack ── */}
        <div style={{ position: "absolute", left: -170, bottom: -210, width: 640, height: 640, borderRadius: "50%", background: "radial-gradient(circle, rgba(129,140,248,0.42), transparent 66%)", filter: "blur(30px)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", right: -140, top: -180, width: 520, height: 520, borderRadius: "50%", background: "radial-gradient(circle, rgba(204,255,0,0.16), transparent 70%)", filter: "blur(44px)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(rgba(255,255,255,0.05) 1.4px, transparent 1.4px)", backgroundSize: "30px 30px", opacity: 0.7, pointerEvents: "none" }} />
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(125% 125% at 50% 38%, transparent 52%, rgba(0,0,0,0.55))", pointerEvents: "none" }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(255,255,255,0.05), transparent 18%)", pointerEvents: "none" }} />

        {/* ── header row ── */}
        <div style={{ position: "absolute", left: 56, top: 44, display: "flex", alignItems: "center", gap: 14 }}>
          <PixelRainbow animate={false} glow={false} className="h-8 w-auto" />
          <span style={{ fontFamily: SERIF, fontWeight: 800, fontSize: 30, letterSpacing: "-0.5px" }}>Prismbeat</span>
        </div>
        <div
          style={{
            position: "absolute",
            right: 56,
            top: 48,
            display: "inline-flex",
            alignItems: "center",
            gap: 9,
            fontFamily: SANS,
            fontSize: 17,
            fontWeight: 800,
            letterSpacing: "0.14em",
            padding: "10px 20px",
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.14)",
            background: "rgba(255,255,255,0.05)",
            color: "#e2e8f0",
          }}
        >
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#34d399", boxShadow: "0 0 12px #34d399" }} />
          LIVE ON-CHAIN · {rangeCaption}
        </div>

        {/* ── title block ── */}
        <div style={{ position: "absolute", left: 56, top: 116 }}>
          <div style={{ fontFamily: SERIF, fontWeight: 800, fontSize: 62, lineHeight: 1, letterSpacing: "-1.5px", textShadow: "0 0 40px rgba(148,163,255,0.35)" }}>
            {headline}
          </div>
          <div style={{ width: 210, height: 4, borderRadius: 2, marginTop: 12, background: "linear-gradient(90deg,#f43f5e,#fb923c,#facc15,#34d399,#38bdf8,#818cf8)" }} />
          <div style={{ fontFamily: SANS, fontSize: 17, fontWeight: 600, color: "#94a3b8", marginTop: 13, maxWidth: 540, lineHeight: 1.38 }}>{tagline}</div>
        </div>

        {/* ── hero stats 2×2 (left) ── */}
        <div style={{ position: "absolute", left: 56, top: 270, width: 600, display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 36, rowGap: 24 }}>
          {heroes.map((s) => (
            <div key={s.label}>
              <Label>{s.label}</Label>
              <div style={{ fontFamily: GROTESK, fontWeight: 700, fontSize: 47, lineHeight: 1.05, marginTop: 7, color: s.color ?? "#f8fafc", textShadow: s.color ? `0 0 34px ${s.color}55` : "none" }}>
                {s.value}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 14.5, color: "#7c869c", marginTop: 6 }}>{s.sub}</div>
            </div>
          ))}
        </div>

        {/* ── right panel: fees by hour + top baskets ── */}
        <div
          style={{
            position: "absolute",
            right: 56,
            top: 118,
            width: 440,
            borderRadius: 22,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "linear-gradient(160deg, rgba(255,255,255,0.055), rgba(255,255,255,0.02))",
            boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
            padding: "20px 26px 18px",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <Label>Fees earned · hourly</Label>
            <span style={{ fontFamily: GROTESK, fontWeight: 700, fontSize: 26, color: "#f8fafc" }}>{usd(fees)}</span>
          </div>

          <svg width={CH_W} height={CH_H} viewBox={`0 0 ${CH_W} ${CH_H}`} style={{ display: "block", marginTop: 14 }}>
            {bars.map((b, i) => {
              const total = b.eth + b.base + b.hood;
              const x = i * (bw + gap);
              if (total <= 0) return <rect key={i} x={x} y={CH_H - 2} width={bw} height={2} rx={1} fill="rgba(255,255,255,0.10)" />;
              const h = Math.max(4, (total / barMax) * (CH_H - 8));
              let y = CH_H;
              const segs: { v: number; c: string }[] = [
                { v: b.eth, c: CHAIN.ethereum.color },
                { v: b.base, c: CHAIN.base.color },
                { v: b.hood, c: CHAIN.robinhood.color },
              ];
              return (
                <g key={i}>
                  {segs.map((s, j) => {
                    if (s.v <= 0) return null;
                    const sh = (s.v / total) * h;
                    y -= sh;
                    return <rect key={j} x={x} y={y} width={bw} height={sh} rx={Math.min(2.5, bw / 3)} fill={s.c} />;
                  })}
                </g>
              );
            })}
            <line x1={0} y1={CH_H - 0.5} x2={CH_W} y2={CH_H - 0.5} stroke="rgba(255,255,255,0.14)" strokeWidth={1} />
          </svg>

          {/* per-chain legend with the window totals */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 12 }}>
            {(Object.keys(CHAIN) as (keyof typeof CHAIN)[]).map((k) => (
              <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: MONO, fontSize: 14, color: "#9aa3b6" }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: CHAIN[k].color }} />
                {CHAIN[k].label} <span style={{ color: "#e2e8f0", fontWeight: 700 }}>{usd(feesByChain[k])}</span>
              </span>
            ))}
          </div>

          <div style={{ height: 1, background: "rgba(255,255,255,0.09)", margin: "14px 0 12px" }} />

          <Label>Top baskets · by volume</Label>
          <div style={{ marginTop: 9, display: "grid", rowGap: 8 }}>
            {top.length === 0 ? (
              <div style={{ fontFamily: MONO, fontSize: 14, color: "#7c869c" }}>No trades in this window yet</div>
            ) : (
              top.map((t) => (
                <div key={t.address}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                    <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 17, color: "#f1f5f9" }}>${t.symbol}</span>
                    <span style={{ fontFamily: MONO, fontSize: 15, color: "#9aa3b6" }}>{usd(t.volumeUsd)}</span>
                  </div>
                  <div style={{ height: 5, borderRadius: 3, background: "rgba(255,255,255,0.07)", marginTop: 4, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.max(3, (t.volumeUsd / topMax) * 100)}%`, borderRadius: 3, background: CHAIN[t.chain].color }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── fee split strip (bottom left, under the heroes) ── */}
        <div style={{ position: "absolute", left: 56, bottom: 38, width: 600 }}>
          <Label>Where the fees go · the on-chain split</Label>
          <div style={{ display: "flex", height: 16, borderRadius: 8, overflow: "hidden", marginTop: 10, border: "1px solid rgba(255,255,255,0.10)" }}>
            {SPLIT.map((s) => {
              const v = split[s.key] ?? 0;
              const pct = splitTotal > 0 ? (v / splitTotal) * 100 : s.key === "holders" ? 70 : 10;
              return <div key={s.key} style={{ width: `${pct}%`, background: s.color, opacity: 0.92 }} />;
            })}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 15, marginTop: 9, flexWrap: "wrap" }}>
            {SPLIT.map((s) => {
              const v = split[s.key] ?? 0;
              const pct = splitTotal > 0 ? Math.round((v / splitTotal) * 100) : 0;
              return (
                <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: MONO, fontSize: 13.5, color: "#9aa3b6" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color }} />
                  {s.label} {splitTotal > 0 ? <span style={{ color: "#e2e8f0", fontWeight: 700 }}>{pct}%</span> : null}
                </span>
              );
            })}
          </div>
        </div>

        {/* ── footer (bottom right) ── */}
        <div style={{ position: "absolute", right: 56, bottom: 38, textAlign: "right" }}>
          <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 17, color: "#cbd5e1" }}>prismbeat.xyz/spectrum</div>
          {windowStamp && <div style={{ fontFamily: MONO, fontSize: 13, color: "#6b7488", marginTop: 5 }}>{windowStamp}</div>}
        </div>
      </div>
    );
  },
);
