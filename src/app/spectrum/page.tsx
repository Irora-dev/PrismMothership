"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MothershipShell } from "@/components/mothership/shell";
import { AmbientBlooms } from "@/components/mothership/blooms";
import { Reveal } from "@/components/effects/reveal";
import { DeltaChip, TimeChart, fmtCompactValue } from "@/components/charts/time-chart";
import { TradesChart } from "@/components/charts/trades-chart";
import { TopBasketsChart } from "@/components/charts/top-baskets-chart";
import { DualChainChart } from "@/components/charts/dual-chain-chart";
import { FeeSplitCard } from "@/components/charts/fee-split-card";
import { LiveFeed, type FeedFilter } from "@/components/pulse/live-feed";
import { BasketsGrid } from "@/components/spectrum/baskets-grid";
import { ChainPills, ALL_CHAINS } from "@/components/spectrum/chain-pills";
import type { Chain } from "@/components/spectrum/index-card";
import { BurnProximitySection } from "@/components/spectrum/burn-proximity";
import { useActivityFeed } from "@/hooks/useActivityFeed";
import { usePolledJson } from "@/hooks/usePolledJson";
import { RANGES, isRangeKey, type ActivityEvent, type RangeKey } from "@/lib/feed/types";
import type { SpectrumChartsPayload } from "@/lib/spectrum/spectrum-charts";

const RANGE_KEYS: RangeKey[] = ["24h", "1w", "1m", "1y"];
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const deltaOf = (cur: number, prevV: number | undefined | null) =>
  prevV != null && prevV > 0 ? (cur - prevV) / prevV : null;

// Spectrum-scoped slice of the shared activity stream: basket trades,
// launches, and EVERY PRISM buy-and-burn — burns are the ecosystem's
// heartbeat, so they all belong here whichever pipe fed them (basket fees,
// launch auctions, pool compounding, reserves). PRISM-pool swap fees, reserve
// yield, and NFT events stay on the home page's PRISM column.
const isSpectrumEvent = (e: ActivityEvent) =>
  e.kind === "burn" || e.source === "spectrum-index" || e.source === "spectrum-auction";
const FEED_FILTERS: { key: FeedFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "fee", label: "Buys & sells" },
  { key: "launch", label: "Launches" },
];

function Stat({ label, value, delta, sub }: { label: string; value: string; delta?: number | null; sub?: string }) {
  return (
    <div className="glass-card p-4">
      <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold">{label}</div>
      <div className="flex items-baseline gap-2 mt-2">
        <span className="font-mono font-bold text-2xl leading-none txt-white">{value}</span>
        <DeltaChip delta={delta} />
      </div>
      {sub && <div className="text-[11px] text-slate-500 mt-1.5 truncate">{sub}</div>}
    </div>
  );
}

export default function SpectrumPage() {
  // Default 24h while activity is sparse (owner call 2026-07-07); revisit → 1w
  // once volume justifies the longer window.
  const [chains, setChains] = useState<Chain[]>([...ALL_CHAINS]);
  const [range, setRange] = useState<RangeKey>(() => {
    if (typeof window === "undefined") return "24h";
    const q = new URLSearchParams(window.location.search).get("range") ?? "";
    return isRangeKey(q) ? q : "24h";
  });
  const [data, setData] = useState<SpectrumChartsPayload | null>(null);
  // the portfolio berth's live figures: batches + wrapped swaps, all-time,
  // measured off the pipeline route (LIVE since the 2026-08-18 flip)
  const { data: pipe } = usePolledJson<{
    batcher?: { volumeUsd: number; feesUsd: number } | null;
    wrapper?: { volumeUsd: number; feesUsd: number };
  }>("/api/burn-pipeline", 300_000);
  const portfolioVolUsd = pipe ? (pipe.batcher?.volumeUsd ?? 0) + (pipe.wrapper?.volumeUsd ?? 0) : null;
  const portfolioFeesUsd = pipe ? (pipe.batcher?.feesUsd ?? 0) + (pipe.wrapper?.feesUsd ?? 0) : null;
  const [loading, setLoading] = useState(true);
  // Fees-earned card view: every basket's full fee, or only PRISM's fixed 25%.
  const [feesView, setFeesView] = useState<"total" | "prism">("total");
  const reqRef = useRef(0);

  // the real-time column — same stream the home page's Spectrum card reads
  const feed = useActivityFeed(4000);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const id = ++reqRef.current;
      setLoading(true);
      try {
        const r = await fetch(`/api/spectrum/charts?range=${range}`, { cache: "no-store" });
        if (!r.ok) return;
        const d = (await r.json()) as SpectrumChartsPayload;
        if (alive && id === reqRef.current) setData(d);
      } catch {
        /* keep the previous frame */
      } finally {
        if (alive && id === reqRef.current) setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 120_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [range]);

  const pickRange = useCallback((r: RangeKey) => {
    setRange(r);
    const url = new URL(window.location.href);
    url.searchParams.set("range", r);
    window.history.replaceState(null, "", url.toString());
  }, []);

  const caption = RANGES[range].caption;

  const derived = useMemo(() => {
    if (!data) return null;
    const launches = data.launchesEth.map((v, i) => v + (data.launchesBase[i] ?? 0) + (data.launchesHood?.[i] ?? 0));
    const totalLaunches = sum(launches);
    const volume = data.buyVolumeUsd.map((b, i) => b + (data.sellVolumeUsd[i] ?? 0));
    const totalVolume = sum(volume);
    const netFlow = data.buyVolumeUsd.map((b, i) => b - (data.sellVolumeUsd[i] ?? 0));
    const inTotal = sum(data.buyVolumeUsd);
    const outTotal = sum(data.sellVolumeUsd);
    const feesTotal = sum(data.feesEthUsd) + sum(data.feesBaseUsd) + sum(data.feesHoodUsd ?? []);
    const totalTrades = sum(data.buys) + sum(data.sells);
    return { launches, totalLaunches, volume, totalVolume, netFlow, inTotal, outTotal, feesTotal, totalTrades };
  }, [data]);

  const prev = data?.prev ?? null;

  return (
    <MothershipShell>
      <div className="relative z-10 mx-auto max-w-[1320px] px-5 md:px-6 pt-14 pb-14">
        <AmbientBlooms />
        {/* header — the telemetry register (the designer 0841: "the Spectrum page
            needs to look like the charts in the sense of that style") */}
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <h1 className="flex items-center gap-4 text-4xl font-black tracking-tight text-white sm:text-5xl">
              Spectrum Ecosystem
              <span className="relative flex h-2.5 w-2.5">
                <span
                  className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                  style={{ background: data?.mode === "pending" ? "#fbbf24" : "#00F0FF" }}
                />
                <span
                  className="relative inline-flex h-2.5 w-2.5 rounded-full"
                  style={{ background: data?.mode === "pending" ? "#fbbf24" : "#00F0FF" }}
                />
              </span>
              {data?.mode === "pending" && (
                <span className="rounded border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-300">
                  Pre-launch
                </span>
              )}
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-400">
              The launchpad, live: every basket launched, every buy and sell, and the fees earned across three chains.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <ChainPills selected={chains} onChange={setChains} />
            <div className="flex gap-1.5 rounded-md border border-white/10 p-1 backdrop-blur-md" style={{ background: "rgba(3,4,9,0.5)" }}>
              {RANGE_KEYS.map((r) => (
                <button
                  key={r}
                  onClick={() => pickRange(r)}
                  aria-pressed={range === r}
                  className={`rounded px-3 py-1 text-[10px] font-medium transition-colors ${
                    range === r ? "bg-white/10 text-white shadow-sm" : "text-slate-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {RANGES[r].label.toUpperCase()}
                </button>
              ))}
            </div>
            <span className="hidden text-[11px] font-mono text-slate-500 xl:inline">{caption}</span>
          </div>
        </div>

        {data?.mode === "pending" && (
          <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[13px] text-slate-300">
            <span className="font-semibold text-slate-100">Awaiting launch.</span> These charts light up the moment
            the Spectrum V2 factory and swap router go live. The activity feed and baskets below are already
            on-chain.
          </div>
        )}

        {data && derived ? (
          <>
            {/* stat strip */}
            <div className={`grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5 mt-5 transition-opacity duration-300 ${loading ? "opacity-60" : "opacity-100"}`}>
              <Stat
                label="Baskets launched"
                value={derived.totalLaunches.toLocaleString("en-US")}
                delta={deltaOf(derived.totalLaunches, prev?.launches)}
                sub={`Ξ${data.auctionEth.toLocaleString("en-US", { maximumFractionDigits: 2 })} auction proceeds → PRISM burn`}
              />
              <Stat
                label="Basket trades"
                value={derived.totalTrades.toLocaleString("en-US")}
                delta={deltaOf(derived.totalTrades, prev ? prev.buys + prev.sells : null)}
                sub={`${sum(data.buys).toLocaleString("en-US")} buys · ${sum(data.sells).toLocaleString("en-US")} sells`}
              />
              <Stat
                label="Volume"
                value={fmtCompactValue(derived.totalVolume, true)}
                delta={deltaOf(derived.totalVolume, prev?.volumeUsd)}
                sub={`${data.tradersTotal.toLocaleString("en-US")} unique traders`}
              />
              <Stat
                label="Fees earned"
                value={fmtCompactValue(derived.feesTotal, true)}
                delta={deltaOf(derived.feesTotal, prev?.feesUsd)}
                sub="across Ethereum + Base baskets"
              />
            </div>

            {/* charts + the real-time column — ONE flat grid: the feed is
                pinned to column 3 (rows 1-2) and the charts auto-flow around
                it, so overflow charts sit underneath the feed instead of
                leaving a dead column */}
            <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-5 mt-5 transition-opacity duration-300 ${loading ? "opacity-60" : "opacity-100"}`}>
                <Reveal className="relative">
                  {/* total ⇄ PRISM-only toggle, sitting in the card header row */}
                  <div className="absolute top-4 right-14 z-20 flex items-center gap-1" data-noexport>
                    {(["total", "prism"] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() => setFeesView(v)}
                        aria-pressed={feesView === v}
                        className={`text-[10px] font-bold uppercase tracking-[0.06em] rounded-full px-2.5 py-1 border transition-colors ${
                          feesView === v
                            ? "bg-white/15 border-white/25 text-white"
                            : "bg-white/[0.03] border-white/10 text-slate-500 hover:text-slate-300"
                        }`}
                      >
                        {v === "total" ? "Total" : "PRISM"}
                      </button>
                    ))}
                  </div>
                  <DualChainChart
                    title={feesView === "total" ? "Fees earned" : "PRISM fees earned"}
                    caption={
                      feesView === "total"
                        ? `${caption} · every basket's full fee`
                        : `${caption} · the fixed 25% that buys & burns PRISM`
                    }
                    range={range}
                    bucketMs={data.bucketMs}
                    buckets={data.buckets}
                    eth={feesView === "total" ? data.feesEthUsd : data.feesEthUsd.map((v) => v * 0.1)}
                    base={feesView === "total" ? data.feesBaseUsd : data.feesBaseUsd.map((v) => v * 0.1)}
                    hood={feesView === "total" ? (data.feesHoodUsd ?? []) : (data.feesHoodUsd ?? []).map((v) => v * 0.1)}
                    money
                    delta={deltaOf(derived.feesTotal, prev?.feesUsd)}
                    slug="spectrum-fees-by-chain"
                  />
                </Reveal>
                <Reveal>
                  <DualChainChart
                    title="Baskets launched"
                    caption={`${caption} · 100% of auction ETH burns PRISM`}
                    range={range}
                    bucketMs={data.bucketMs}
                    buckets={data.buckets}
                    eth={data.launchesEth}
                    base={data.launchesBase}
                    hood={data.launchesHood ?? []}
                    delta={deltaOf(derived.totalLaunches, prev?.launches)}
                    slug="spectrum-launches-by-chain"
                  />
                </Reveal>
                <Reveal>
                  <TradesChart
                    range={range}
                    bucketMs={data.bucketMs}
                    buckets={data.buckets}
                    buys={data.buys}
                    sells={data.sells}
                    volumeUsd={derived.volume}
                    launches={derived.launches}
                    caption={`${caption} · ${fmtCompactValue(derived.totalVolume, true)} volume`}
                    delta={deltaOf(derived.totalTrades, prev ? prev.buys + prev.sells : null)}
                  />
                </Reveal>
                <Reveal>
                  <TimeChart
                    title="Net basket flow"
                    caption={`${caption} · ${fmtCompactValue(derived.inTotal, true)} in − ${fmtCompactValue(derived.outTotal, true)} out`}
                    color="#10b981"
                    range={range}
                    bucketMs={data.bucketMs}
                    buckets={data.buckets}
                    values={derived.netFlow}
                    kind="bar"
                    signed
                    money
                    heroFmt={(n) => `${n >= 0 ? "+" : ""}${fmtCompactValue(n, true)}`}
                    delta={deltaOf(derived.inTotal - derived.outTotal, prev ? prev.buyVolumeUsd - prev.sellVolumeUsd : null)}
                    slug="spectrum-net-flow"
                  />
                </Reveal>
                <Reveal className="md:col-span-2">
                  {/* the deploy-auction leg: every launch payment, on its way to the PRISM burn */}
                  <TimeChart
                    title="Auction proceeds → PRISM burn"
                    caption={`Ξ${data.auctionPipeline.escrowedEth.toLocaleString("en-US", { maximumFractionDigits: 4 })} escrowed · Ξ${data.auctionPipeline.burnerEth.toLocaleString("en-US", { maximumFractionDigits: 4 })} at the burner · ${data.auctionPipeline.burnedPrism.toLocaleString("en-US", { maximumFractionDigits: 2 })} PRISM burned`}
                    color="#f59e0b"
                    range={range}
                    bucketMs={data.bucketMs}
                    buckets={data.buckets}
                    values={data.auctionSeries}
                    kind="bar"
                    heroFmt={(n) => `Ξ${n.toLocaleString("en-US", { maximumFractionDigits: 4 })}`}
                    delta={deltaOf(data.auctionEth, prev?.auctionEth)}
                    slug="spectrum-auction-burn"
                  />
                </Reveal>
                <Reveal>
                  {/* drill-down wiring lands with live data — demo addresses have no history */}
                  <TopBasketsChart range={range} caption={caption} items={data.topBaskets} />
                </Reveal>
                <Reveal className="md:col-span-2 lg:col-span-3">
                  <FeeSplitCard split={data.feeSplit} caption={`${caption} · the on-chain split`} />
                </Reveal>

              {/* the card from the home page: live basket activity, pinned top-right */}
              <Reveal className="md:col-span-2 lg:col-span-1 lg:col-start-3 lg:row-start-1 lg:row-span-2">
                <LiveFeed
                  events={feed.events}
                  mode={feed.mode}
                  connected={feed.connected}
                  ethUsd={feed.stats?.ethUsd ?? 0}
                  prismUsd={feed.stats?.prismUsd ?? 0}
                  prismSupply={feed.stats?.supply ?? 0}
                  title="Live basket activity"
                  info="Every basket buy, sell, and launch across Ethereum & Base, the moment it lands on-chain. Each basket sets its own trading fee (1–3%), and a fixed 25% of every fee is used to buy and burn PRISM."
                  filters={FEED_FILTERS}
                  include={isSpectrumEvent}
                  link={{ href: "#baskets", label: "All baskets" }}
                  consumeEventParam
                />
              </Reveal>
            </div>
          </>
        ) : (
          <div className="mt-5 glass-card p-5 h-[280px] grid place-items-center text-sm text-slate-500 font-mono">
            Loading Spectrum…
          </div>
        )}

        {/* ── Spectrum Portfolio berth — merged in (the designer 2026-08-03: one
            ecosystem page). Its own section, not a lodger inside the burn one.
            Honest empty state until the batcher is on-chain; slots light up via
            the ceremony ping (desk w-…-136). ── */}
        <section id="portfolio" className="relative mt-14 scroll-mt-24 overflow-hidden rounded-2xl p-6 sm:p-8" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)", backdropFilter: "blur(20px)", border: "1px solid #FF5E0033" }}>
          <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(circle at 15% 0%, #FF5E0012 0%, rgba(0,0,0,0) 55%)" }} />
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-6">
            <div className="flex min-w-0 items-center gap-5">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/10" style={{ background: "linear-gradient(135deg, #FF5E0059, #030409)" }}>
                <svg className="h-7 w-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 4L4 8l8 4 8-4-8-4z M4 12l8 4 8-4 M4 16l8 4 8-4" />
                </svg>
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-2xl font-bold tracking-tight text-white">Spectrum Portfolio</h2>
                  {/* LIVE since 2026-08-18: the gen-3 batchers + wrappers are
                      on-chain on all three chains, first real flows executed */}
                  <span className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider" style={{ background: "#00FF8726", color: "#00FF87", border: "1px solid #00FF8740" }}>Live</span>
                </div>
                <p className="mt-1.5 max-w-[560px] text-sm leading-relaxed text-slate-400">
                  A whole portfolio in one buy: batched execution across baskets and tokens, with a flat fee that buys and burns PRISM.
                </p>
              </div>
            </div>
            <div className="grid shrink-0 grid-cols-2 gap-6 text-right">
              <div>
                <div className="text-[9px] uppercase tracking-[0.14em] text-slate-500">Portfolio volume</div>
                <div className="mt-1 text-2xl font-light tabular-nums" style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace', color: portfolioVolUsd != null && portfolioVolUsd > 0 ? "#fff" : "#475569" }}>
                  {portfolioVolUsd != null ? `$${Math.round(portfolioVolUsd).toLocaleString("en-US")}` : "—"}
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-[0.14em] text-slate-500">Portfolio fees</div>
                <div className="mt-1 text-2xl font-light tabular-nums" style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace', color: portfolioFeesUsd != null && portfolioFeesUsd > 0 ? "#fff" : "#475569" }}>
                  {portfolioFeesUsd != null ? `$${portfolioFeesUsd.toFixed(2)}` : "—"}
                </div>
              </div>
          </div>
        </div>
        </section>

        {/* proximity to burn — how close each basket is to its fixed 0.3-ETH PRISM burn */}
        <section id="burn" className="mt-14 scroll-mt-24">
          <div className="flex w-fit flex-col items-start mb-2">
            <h2 className="logo-font text-4xl md:text-5xl font-bold tracking-tighter txt-white leading-none">Proximity to burn</h2>
            <div className="spectrum-divider w-full mt-2.5" />
          </div>
          <p className="mt-3 mb-7 text-slate-300 leading-relaxed max-w-xl">
            A fixed 25% of every basket fee accrues to buy &amp; burn{" "}
            <span className="spectrum-text-gradient font-semibold">PRISM</span>. Each basket burns once its accrued share
            reaches <span className="font-semibold text-slate-100">0.3 ETH</span>. Here&apos;s how close each one is,
            across Ethereum and Base.
          </p>
          <BurnProximitySection />
        </section>

        {/* the basket explorer — every live basket, on-chain, ranked by size */}
        <section id="baskets" className="mt-14 scroll-mt-24">
          <h2 className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#9D00FF" }} />
            The baskets
          </h2>
          <p className="mb-7 max-w-xl text-sm leading-relaxed text-slate-400">
            One token, the whole basket. Community-created, ranked by size, and every trade feeds the PRISM burn.
          </p>
          <BasketsGrid chains={chains} />
        </section>

        <p className="mt-8 text-[11px] text-slate-600 leading-relaxed max-w-2xl">
          {data?.mode === "pending" ? (
            <>
              Charts are intentionally empty ahead of the Spectrum V2 launch and flip to on-chain data automatically
              once the factory and router addresses are wired. The activity feed and basket listing stream the live
              network. Nothing here is investment advice.
            </>
          ) : (
            <>
              Series are aggregated from public on-chain logs and bucketed by estimated block time; the final bucket is
              still in progress, and figures are approximate and may be delayed. Nothing here is investment advice.
            </>
          )}
        </p>
      </div>
    </MothershipShell>
  );
}
