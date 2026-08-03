"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AnimatedBg } from "@/components/effects/animated-bg";
import { IndexChart, type ConstituentSeries } from "@/components/spectrum/index-chart";
import { BasketBento } from "@/components/spectrum/basket-bento";
import { tokenVisual } from "@/lib/spectrum/token-visual";
import { AssetLogo, ChainBadge, CHAIN_META, spectrumBuyUrl, type Chain } from "@/components/spectrum/index-card";
import { BasketActivity } from "@/components/charts/basket-activity";

const SERIF = '"Playfair Display", Georgia, serif';
const MONO = '"SF Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

// Constituent colors come from each token's real brand color (the same map
// the bento popups use) — SYRUP orange, Mog blue — never an arbitrary palette.
// Windows in seconds. Intraday ranges (6H/12H) actually slice the ~24h series
// the API reconstructs; longer ranges only fill in as a basket accrues history
// (they auto-disable until there's data to back them).
const TIMEFRAMES = [
  { k: "6H", sec: 21_600 },
  { k: "12H", sec: 43_200 },
  { k: "1D", sec: 86_400 },
  { k: "1W", sec: 604_800 },
  { k: "1M", sec: 2_592_000 },
  { k: "ALL", sec: Infinity },
] as const;
type TimeframeKey = (typeof TIMEFRAMES)[number]["k"];

interface SeriesPoint { time: number; value: number }
interface Holding {
  asset: string;
  symbol: string;
  decimals: number;
  targetWeightPct: number;
  balance: number;
  priceUsd: number;
  valueUsd: number;
  liveWeightPct: number;
  change24hPct: number | null;
  priced: boolean;
  series: SeriesPoint[];
}
interface IndexData {
  address: string;
  chain: Chain;
  name: string;
  symbol: string;
  totalSupply: number;
  aumUsd: number;
  navPerToken: number;
  change24hPct: number | null;
  holdings: Holding[];
  navSeries: SeriesPoint[];
  pricedCount: number;
  totalCount: number;
  inceptionTs?: number | null;
  ageHours?: number | null;
  dstableUsd?: number | null;
  spotUsdNav?: number;
  error?: string;
}

function usd(n: number, dp?: number) {
  if (!isFinite(n)) return "$0";
  const d = dp ?? (n >= 1 ? 2 : n >= 0.01 ? 4 : 6);
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}
function pct(n: number | null) {
  return n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}
function compact(n: number) {
  return n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 });
}
// Chain-aware block-explorer links (Etherscan for mainnet, BaseScan for Base).
function explorer(chain: Chain) {
  if (chain === "robinhood") return { base: "https://robinhoodchain.blockscout.com", name: "Blockscout" };
  return chain === "ethereum"
    ? { base: "https://etherscan.io", name: "Etherscan" }
    : { base: "https://basescan.org", name: "BaseScan" };
}

export default function IndexDetailPage() {
  const params = useParams<{ address: string }>();
  const address = params?.address ?? "";
  const [data, setData] = useState<IndexData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"index" | "assets">("index");
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [tf, setTf] = useState<TimeframeKey>("1D");

  useEffect(() => {
    if (!address) return;
    let live = true;
    setData(null);
    setErr(null);
    fetch(`/api/spectrum/index/${address}`)
      .then((r) => r.json())
      .then((d: IndexData) => {
        if (!live) return;
        if (d.error) setErr(d.error);
        else {
          setData(d);
          const v: Record<string, boolean> = {};
          for (const h of d.holdings) v[h.asset] = true;
          setVisible(v);
        }
      })
      .catch((e) => live && setErr(String(e)));
    return () => {
      live = false;
    };
  }, [address]);

  const sorted = useMemo(
    () => (data ? [...data.holdings].sort((a, b) => b.valueUsd - a.valueUsd) : []),
    [data],
  );
  const colorFor = useMemo(() => {
    const m: Record<string, string> = {};
    sorted.forEach((h) => (m[h.asset] = tokenVisual(h.symbol, h.asset).color));
    return m;
  }, [sorted]);

  // Time-range filtering — slice each series to the selected window (anchored at
  // the latest point). Constituents are re-based to 100 at the window's start so
  // the "100 = window start" readout stays honest.
  const nav = data?.navSeries ?? [];
  const anchor = nav.length ? nav[nav.length - 1].time : 0;
  const span = nav.length ? anchor - nav[0].time : 0;
  const windowSec = TIMEFRAMES.find((t) => t.k === tf)?.sec ?? Infinity;
  const cutoff = isFinite(windowSec) ? anchor - windowSec : -Infinity;
  const sliceWin = (s: SeriesPoint[]) => (isFinite(cutoff) ? s.filter((p) => p.time >= cutoff) : s);
  const rebase100 = (s: SeriesPoint[]) => {
    const first = s.find((p) => p.value > 0)?.value;
    return first ? s.map((p) => ({ time: p.time, value: (p.value / first) * 100 })) : s;
  };
  const tfDisabled = (sec: number) => isFinite(sec) && sec > span * 1.5; // window clearly exceeds available history

  const navTf = sliceWin(nav);
  const constituents: ConstituentSeries[] = sorted.map((h) => ({
    symbol: h.symbol,
    color: colorFor[h.asset],
    series: rebase100(sliceWin(h.series)),
    visible: mode === "assets" && (visible[h.asset] ?? true),
  }));

  // If the picked range has no history behind it (e.g. default 1D on a fresh basket),
  // snap to ALL once the data span is known.
  useEffect(() => {
    if (span > 0 && tfDisabled(windowSec)) setTf("ALL");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [span]);

  const up = (data?.change24hPct ?? 0) >= 0;
  const changeColor = up ? "#34d399" : "#f87171";
  const chain: Chain = data?.chain ?? "base";
  const ex = explorer(chain);

  return (
    <>
      <div className="relative min-h-screen w-full" style={{ fontFamily: '"Space Grotesk", sans-serif' }}>
        {/* Rainbow pixel field — AnimatedBg self-injects a fixed full-screen canvas at z-0.
            The page container stays transparent so that canvas shows through. */}
        <AnimatedBg variant="square" darkOpaque rainbow zIndex={0} />

        <main className="relative z-10 mx-auto flex max-w-7xl flex-col gap-5 px-4 py-8 md:px-8 md:py-10">
          <Link href="/spectrum#baskets" className="inline-flex items-center gap-1.5 text-[13px] text-white/45 hover:text-white transition-colors w-fit" style={{ fontFamily: MONO }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>
            All baskets
          </Link>

          {err && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-5 text-red-300" style={{ fontFamily: MONO }}>
              Could not load this basket. {err}
            </div>
          )}
          {!err && !data && (
            <div className="py-24 text-center text-white/40" style={{ fontFamily: MONO }}>Reading basket on-chain…</div>
          )}

          {data && (
            <>
              {/* HERO PANEL */}
              <section
                className="relative overflow-hidden rounded-3xl border border-white/10"
                style={{ background: "rgba(12,12,14,0.82)" }}
              >
                {/* Header */}
                <header className="flex flex-col gap-6 border-b border-white/5 p-6 md:flex-row md:items-end md:justify-between md:p-8">
                  <div>
                    <div className="mb-2 flex items-center gap-3">
                      <span
                        className="grid h-10 w-10 place-items-center rounded-xl text-black shadow-lg shrink-0"
                        style={{ background: "linear-gradient(135deg,#ff5a5a,#ffe14d,#5cff8f,#3bd9ff,#c06aff)" }}
                      >
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
                      </span>
                      <h1
                        className="text-white tracking-tight text-4xl md:text-5xl leading-tight"
                        style={{ fontFamily: SERIF, fontWeight: 700, animation: "spectrum-title-glow 4.5s ease-in-out infinite" }}
                      >
                        {data.name?.trim() || data.symbol}
                      </h1>
                      <span className="rounded-md border border-white/15 px-2 py-0.5 text-[11px] text-white/60" style={{ fontFamily: MONO }}>{data.symbol}</span>
                      <ChainBadge chain={chain} />
                    </div>
                    <div className="mt-1 flex items-baseline gap-4">
                      <span className="tabular-nums" style={{ fontFamily: MONO, fontSize: 40, fontWeight: 700, color: "#ffffff" }}>{usd(data.navPerToken)}</span>
                      <span className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm font-semibold tabular-nums" style={{ color: changeColor, borderColor: changeColor + "33", background: changeColor + "14" }}>
                        {pct(data.change24hPct)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-medium text-white/40" style={{ fontFamily: MONO }}>
                      {CHAIN_META[chain].label} • AUM {usd(data.aumUsd, 0)} • {compact(data.totalSupply)} supply • {data.pricedCount}/{data.totalCount} priced
                    </p>
                  </div>

                  {/* Visit CTA + timeframe tabs */}
                  <div className="flex flex-col gap-3 self-start md:items-end">
                    <a
                      href={spectrumBuyUrl(data.address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-transform hover:scale-[1.03]"
                      style={{ background: "linear-gradient(135deg,#7c3aed,#06b6d4)", boxShadow: "0 8px 30px rgba(124,58,237,0.4)" }}
                    >
                      Visit {data.symbol}
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M7 17 17 7" />
                        <path d="M7 7h10v10" />
                      </svg>
                    </a>
                    <div className="flex rounded-xl border border-white/5 bg-black/40 p-1">
                      {TIMEFRAMES.map((t) => {
                        const disabled = tfDisabled(t.sec);
                        return (
                          <button
                            key={t.k}
                            onClick={() => !disabled && setTf(t.k)}
                            disabled={disabled}
                            title={disabled ? "Not enough history yet" : undefined}
                            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
                              tf === t.k ? "bg-white/10 text-white" : disabled ? "text-white/20 cursor-not-allowed" : "text-white/45 hover:text-white"
                            }`}
                          >
                            {t.k}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </header>

                {/* Chart */}
                <div className="h-[360px] w-full p-4 md:p-6">
                  <IndexChart indexLabel={data.symbol} indexSeries={navTf} constituents={constituents} />
                </div>

                {/* Controls */}
                <div className="border-t border-white/5 bg-black/20 p-4 md:p-6">
                  <div className="mb-5 flex flex-col items-center justify-between gap-4 md:flex-row">
                    <div className="flex rounded-xl border border-white/5 bg-[#0d0d10] p-1">
                      <button
                        onClick={() => setMode("index")}
                        className={`flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors ${mode === "index" ? "bg-white/10 text-white" : "text-white/45 hover:text-white"}`}
                      >
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: "linear-gradient(135deg,#5cff8f,#3bd9ff,#c06aff)" }} />
                        Basket Only
                      </button>
                      <button
                        onClick={() => setMode("assets")}
                        className={`flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors ${mode === "assets" ? "bg-white/10 text-white" : "text-white/45 hover:text-white"}`}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" /></svg>
                        Basket + Assets
                      </button>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-white/40" style={{ fontFamily: MONO }}>
                      Constituents rebased to 100 at window start
                    </div>
                  </div>

                  <div className={`grid grid-cols-2 gap-3 transition-opacity duration-300 md:grid-cols-4 ${mode === "index" ? "pointer-events-none opacity-40" : "opacity-100"}`}>
                    {sorted.map((h) => {
                      const on = visible[h.asset] ?? true;
                      return (
                        <button
                          key={h.asset}
                          onClick={() => setVisible((v) => ({ ...v, [h.asset]: !on }))}
                          className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] p-3 text-left transition-colors hover:bg-white/[0.04]"
                        >
                          <span className="flex items-center gap-2.5 min-w-0">
                            <span className="h-3 w-1 rounded-full shrink-0" style={{ background: colorFor[h.asset] }} />
                            <AssetLogo addr={h.asset} symbol={h.symbol} size={26} chain={chain} />
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-white/90 truncate">{h.symbol}</span>
                              <span className="block text-xs tabular-nums text-white/40" style={{ fontFamily: MONO }}>{h.liveWeightPct.toFixed(1)}% wgt</span>
                            </span>
                          </span>
                          <span
                            className="relative h-5 w-9 rounded-full transition-colors"
                            style={{ background: on ? colorFor[h.asset] : "rgba(255,255,255,0.12)" }}
                          >
                            <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: on ? 18 : 2 }} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>

              {/* Composition — the operator-style bento, full width (the old
                  360px donut cramped it and colored tokens by list order) */}
              <section className="grid grid-cols-1 gap-5">
                <div className="rounded-2xl border border-white/10 bg-white/[0.015] p-5">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-white/40" style={{ fontFamily: MONO }}>Composition</span>
                  <div className="mt-4 h-[300px] rounded-xl overflow-hidden">
                    <BasketBento
                      items={sorted.map((h) => ({ symbol: h.symbol, address: h.asset, weightPct: h.liveWeightPct > 0 ? h.liveWeightPct : h.targetWeightPct }))}
                      chain={chain}
                    />
                  </div>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.015] p-5">
                  <table className="w-full text-[13px]" style={{ fontFamily: MONO }}>
                    <thead>
                      <tr className="text-left text-white/40 [&>th]:pb-3 [&>th]:text-[10px] [&>th]:font-normal [&>th]:uppercase [&>th]:tracking-[0.1em]">
                        <th>Asset</th>
                        <th className="text-right">Target</th>
                        <th className="text-right">Live</th>
                        <th className="text-right">Price</th>
                        <th className="text-right">24h</th>
                        <th className="text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody className="text-white/85">
                      {sorted.map((h) => (
                        <tr key={h.asset} className="border-t border-white/5 [&>td]:py-2.5">
                          <td>
                            <span className="inline-flex items-center gap-2">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorFor[h.asset] }} />
                              <a href={`${ex.base}/token/${h.asset}`} target="_blank" rel="noopener noreferrer" className="hover:text-white">
                                {h.symbol}
                                {!h.priced && <span className="ml-1.5 text-[10px] text-amber-500/80">unpriced</span>}
                              </a>
                            </span>
                          </td>
                          <td className="text-right tabular-nums text-white/45">{h.targetWeightPct.toFixed(1)}%</td>
                          <td className="text-right tabular-nums">{h.liveWeightPct.toFixed(1)}%</td>
                          <td className="text-right tabular-nums">{h.priced ? usd(h.priceUsd) : "—"}</td>
                          <td className="text-right tabular-nums" style={{ color: h.change24hPct == null ? "#64748b" : h.change24hPct >= 0 ? "#34d399" : "#f87171" }}>{pct(h.change24hPct)}</td>
                          <td className="text-right tabular-nums text-white">{usd(h.valueUsd, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Trading activity — the same hourly store behind /charts, sliced to this basket */}
              {chain === "base" && (
                <section className="rounded-2xl border border-white/10 bg-white/[0.015] p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-[11px] uppercase tracking-[0.18em] text-white/40" style={{ fontFamily: MONO }}>
                      Trading activity
                    </span>
                    <span className="text-[11px] text-white/30" style={{ fontFamily: MONO }}>
                      buys, sells & fees from on-chain events
                    </span>
                  </div>
                  <BasketActivity address={data.address} showRangePicker />
                </section>
              )}

              <p className="text-[11px] leading-relaxed text-white/35" style={{ fontFamily: MONO }}>
                Price is the basket&apos;s aggregate-spot value: Σ(constituent held × market price) ÷ effective supply.{" "}
                Chart covers{" "}
                {data.ageHours != null
                  ? data.ageHours < 1
                    ? `~${Math.round(data.ageHours * 60)}m`
                    : `~${data.ageHours.toFixed(1)}h`
                  : "the last 24h"}{" "}
                since launch, reconstructed from constituent price changes (DexScreener).{" "}
                <a href={`${ex.base}/address/${data.address}`} target="_blank" rel="noopener noreferrer" className="text-white/55 underline underline-offset-2 hover:text-white">Contract ↗</a>
              </p>
            </>
          )}
        </main>
      </div>
    </>
  );
}
