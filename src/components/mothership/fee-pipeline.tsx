"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ActivityEvent, PulseStats } from "@/lib/feed/types";
import { fmtEth, fmtPrism, fmtUsdFull } from "@/lib/feed/format";
import { formatEther } from "ethers";
import { txUrl } from "@/lib/chain/constants";
import { useWallet } from "@/lib/wallet/context";
import { C, MONO, glass, glow } from "./style";
import { TimeAgo, agoString } from "./time-ago";
import { useNow } from "@/hooks/useNow";
import { usePolledJson } from "@/hooks/usePolledJson";
import { PendingBurnChip, PendingBurnModal, collectorCrankable, type PendingCollector } from "@/components/pulse/crank-burn";

// ── THE FEE PIPELINE — the collection system, drawn live ─────────────────────
// the designer 2026-08-12 2305, then his review: "way less text, way more visual, way
// more simplified". So the metaphor does the work: sources are pulse chips,
// the buckets are literal CONTAINERS that fill with liquid, the ending is the
// burn pool. One number per thing. Every explainer that used to be a line of
// copy now lives in a title tooltip.
//
// Ground rules (unchanged):
// - Every figure is live chain data (/api/burn-pipeline + /api/feed).
// - The portfolio source renders NO numbers until the batcher ceremony puts
//   real events on chain (desk w-…-136). Event shape is already fixed
//   (w-…-395): BatchExecuted = volume · BurnShareDelivered = the burn number ·
//   BurnDiverted = visible-but-not-burnt. Fee is caller-set, cap 2%, split 7:1
//   burn:integrator — read amounts off events, never a hard-coded rate.
// - The burner pot pools; the burn is a separate permissionless crank
//   (w-…-393) — hence "awaiting crank" in its tooltip, not "burning".
// - NEVER derive burn from fee volume; read accruals/events. If that ever
//   changes: on 4663 ONLY, baskets with a creator payout shave a 5% league
//   slice BEFORE the burn split (burn = 23.75% of fee, not 25% — w-…-396,
//   V3 numbers), so the maths must branch on chain and creatorPayout.
// - Cranks stay on /burn; buckets deep-link, this surface never signs.
// - Styling inline — Tailwind v4 tree-shakes custom classes (style.ts law).

/** A new batch on the feed means its burn cut just landed on a collector, so
 *  the staged-burn chip must follow the batch onto the surface rather than
 *  wait out a long pipeline poll (the designer watched a $2,455 batch arrive with no
 *  queue movement behind it, 2026-08-16). The refresh it fires busts the
 *  route's 30s server cache, so one re-read is authoritative. The baseline
 *  render never nudges — only batches that arrive while watching. */
function useBatchNudge(events: ActivityEvent[], refresh: () => void) {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = events.filter((e) => e.kind === "batch").map((e) => e.id);
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    const fresh = ids.filter((id) => !seen.current!.has(id));
    if (!fresh.length) return;
    for (const id of fresh) seen.current.add(id);
    refresh();
  }, [events, refresh]);
}

/** One PRISM buy-and-burn as a receipt: what was bought, what it cost, when,
 *  and the transaction itself. Shared by the full flow and the home strip so
 *  the two can never show a burn differently. USD is derived from the live
 *  PRISM price, because burn events carry no notional of their own. */
function BurnChip({ e, prismUsd }: { e: ActivityEvent; prismUsd: number }) {
  const usd = e.usd ?? (prismUsd > 0 ? (e.prism ?? 0) * prismUsd : 0);
  const label = `${fmtPrism(e.prism)} PRISM bought and burnt${usd > 0 ? ` · ${fmtUsdFull(usd)}` : ""} · ${new Date(e.ts).toLocaleString()}${e.txHash ? " · open the transaction" : ""}`;
  const cls = "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1";
  const st = { borderColor: `${C.orange}2e`, background: `${C.orange}0d`, fontFamily: MONO } as React.CSSProperties;
  const inner = (
    <>
      <span className="text-[13px] font-semibold text-white">{fmtPrism(e.prism)}</span>
      <span className="text-[10px] text-slate-500">PRISM</span>
      {usd > 0 && <span className="text-[12px] font-medium" style={{ color: `${C.orange}d9` }}>{fmtUsdFull(usd)}</span>}
      <TimeAgo ts={e.ts} short className="text-[11px] font-medium text-slate-400" />
      {e.txHash && (
        <svg aria-hidden viewBox="0 0 24 24" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: `${C.orange}99` }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14 5h5v5M19 5l-7 7M10 5H6a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1v-4" />
        </svg>
      )}
    </>
  );
  return e.txHash ? (
    <a href={txUrl(e.txHash, e.chain ?? "ethereum")} target="_blank" rel="noopener noreferrer" title={label} className={`${cls} transition-colors hover:border-white/25`} style={st}>
      {inner}
    </a>
  ) : (
    <span title={label} className={cls} style={st}>{inner}</span>
  );
}

/** The four stages a fee passes through, named as a journey. Shared by the
 *  full flow and the home-page strip so they can never drift apart. */
const STAGES = ["Accruing", "Escrowed", "In transit", "Ready to burn"] as const;

interface Pipeline {
  ethUsd: number;
  baskets: { chain: string; address: string; symbol: string; pendingUsd: number; pendingEthEquiv: number; thresholdEth: number; crankable: boolean }[];
  factories: { chain: string; address: string; note?: string; escrowEth: number }[];
  burner: { address: string; balanceEth: number };
  // the bridge collectors: the batcher's burn cut, one permissionless flush()
  // from the L1 burner (stage two of three)
  collectors?: PendingCollector[];
  batcher: null | { address?: string; volumeUsd?: number; feesUsd?: number; deliveredEth?: number; batches?: number };
}


/** The joint between stages: dots drifting toward the pool. Pure CSS
 *  (ms-flow keyframes in globals); still while nothing is in flight. */
function Flow({ color, active, vertical }: { color: string; active: boolean; vertical?: boolean }) {
  const dot = (i: number) => (
    <span
      key={i}
      className="absolute h-1 w-1 rounded-full"
      style={{
        background: color,
        boxShadow: `0 0 6px ${color}`,
        opacity: active ? 1 : 0.15,
        animation: active ? `${vertical ? "ms-flow-y" : "ms-flow-x"} 2.4s linear ${i * 0.8}s infinite` : "none",
        ...(vertical ? { left: "50%", marginLeft: -2 } : { top: "50%", marginTop: -2 }),
      }}
    />
  );
  return (
    <div
      aria-hidden
      className={vertical ? "relative mx-auto h-7 w-px" : "relative h-px w-full min-w-5 flex-1"}
      style={{ background: `${color}2e` }}
    >
      {[0, 1, 2].map(dot)}
    </div>
  );
}

export function FeePipeline({ stats, events, sessionBurned = 0 }: { stats: PulseStats | null; events: ActivityEvent[]; sessionBurned?: number }) {
  const { account, openPicker } = useWallet();
  // only the string-built labels need this; every standalone timestamp is a
  // self-clocking <TimeAgo>, so the panel is not re-rendering for those
  const now = useNow();
  const [pipe, setPipe] = useState<Pipeline | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [poolOpen, setPoolOpen] = useState(false);
  // a staged burn's crank popup (the collector's permissionless flush)
  const [burnCrank, setBurnCrank] = useState<PendingCollector | null>(null);

  // the burn list is an overlay, so Escape closes it — a panel dismissable only
  // by re-finding the same small target is a trap on a page this wide
  useEffect(() => {
    if (!poolOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPoolOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [poolOpen]);

  // refreshPipe() re-reads NOW with the cache-buster — for the moment a crank
  // mines or a batch lands, when the 30s-cached body is the pre-action world
  const pipeTickRef = useRef<(bust?: boolean) => void>(() => {});
  const refreshPipe = useCallback(() => pipeTickRef.current(true), []);
  useEffect(() => {
    let alive = true;
    const tick = (bust?: boolean) =>
      fetch(bust ? "/api/burn-pipeline?fresh=1" : "/api/burn-pipeline", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d: Pipeline) => {
          if (!alive) return;
          setPipe(d);
          setReadFailed(false);
        })
        .catch(() => {
          if (alive) setReadFailed(true);
        });
    pipeTickRef.current = tick;
    tick();
    const t = setInterval(tick, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  useBatchNudge(events, refreshPipe);

  // the connected holder's own position, from the same server-side route the
  // claim page uses — the wallet only ever signs, it never reads chain here.
  // usePolledJson so a dead route flags `mineStale` instead of freezing silently.
  const { data: mineRaw, stale: mineStale } = usePolledJson<{ balanceFmt?: number; pendingETH?: string; pendingPRISM?: string }>(
    account ? `/api/prism/wallet/${account}` : null,
    60_000,
  );
  const mine = useMemo(
    () =>
      mineRaw
        ? {
            prisms: mineRaw.balanceFmt ?? 0,
            pendingEth: Number(formatEther(mineRaw.pendingETH ?? "0")),
            pendingPrism: Number(formatEther(mineRaw.pendingPRISM ?? "0")),
          }
        : null,
    [mineRaw],
  );

  const ethUsd = pipe?.ethUsd || stats?.ethUsd || 0;
  const prismUsd = stats?.prismUsd ?? 0;

  const basketsUsd = useMemo(() => (pipe ? pipe.baskets.reduce((a, b) => a + b.pendingUsd, 0) : 0), [pipe]);
  const nearest = useMemo(
    () => (pipe && pipe.baskets.length ? [...pipe.baskets].sort((a, b) => b.pendingEthEquiv / b.thresholdEth - a.pendingEthEquiv / a.thresholdEth)[0] : null),
    [pipe],
  );
  const escrowEth = useMemo(() => (pipe ? pipe.factories.reduce((a, f) => a + f.escrowEth, 0) : 0), [pipe]);
  const bridgeEth = stats?.bridgePendingEth ?? 0;
  const burnerEth = pipe?.burner.balanceEth ?? 0;

  const totalUsd = basketsUsd + (escrowEth + bridgeEth + burnerEth) * ethUsd;
  const potentialPrism = prismUsd > 0 ? totalUsd / prismUsd : 0;
  const flowing = totalUsd > 0.5;

  // the freshest beat per source — recency IS the display (a bright vs dim dot)
  const lastTrade = events.find((e) => e.kind !== "launch" && e.kind !== "burn" && (e.source === "spectrum-index" || e.source === "spectrum-auction"));
  const lastLp = events.find((e) => e.source === "prism-pool" && e.kind !== "burn");
  const burns = useMemo(() => events.filter((e) => e.kind === "burn").slice(0, 8), [events]);
  const liveBurns = useMemo(() => events.filter((e) => e.kind === "burn" && (e.prism ?? 0) > 0).slice(0, 20), [events]);
  const lastBurn = burns[0];

  const hot = (ts?: number) => ts != null && Date.now() - ts < 3_600_000; // active in the last hour
  // where the CURRENT rate points, as a share of supply per year. A supply
  // statistic derived from the trailing 24h burn, never a price or yield claim.
  const yearPct = stats && stats.cap > 0 ? ((stats.prismBurnedToday * 365) / stats.cap) * 100 : 0;

  // per-source activity, drawn: events-per-slot as a tiny histogram, plus the
  // freshest event's amount. The bars are the display — a chatty slot reads
  // tall, a quiet one reads as a floor tick. The WINDOW ADAPTS to what the
  // feed buffer actually holds for that source: swaps land every few minutes
  // and age out of the buffer fast, so a fixed 12h window would render hours
  // of false quiet before one spike. Each source charts the span it can see
  // (its slot width is labelled in the tooltip via the covered span).
  const BARS = 12;
  const isTradeEv = (e: ActivityEvent) => e.kind !== "launch" && e.kind !== "burn" && (e.source === "spectrum-index" || e.source === "spectrum-auction");
  const isLaunchEv = (e: ActivityEvent) => e.kind === "launch";
  const isSwapEv = (e: ActivityEvent) => e.source === "prism-pool" && e.kind !== "burn";
  const histogram = (test: (e: ActivityEvent) => boolean): { bars: number[]; spanMs: number } => {
    const now = Date.now();
    const mine = events.filter(test);
    // at least an hour, at most a day, and never wider than the buffer reaches
    const spanMs = Math.min(86_400_000, Math.max(3_600_000, mine.length ? now - Math.min(...mine.map((e) => e.ts)) : 43_200_000));
    const slot = spanMs / BARS;
    const bars = Array(BARS).fill(0) as number[];
    for (const e of mine) {
      const i = Math.floor((now - e.ts) / slot);
      if (i >= 0 && i < BARS) bars[BARS - 1 - i]++;
    }
    return { bars, spanMs };
  };
  const spanLabel = (ms: number) => (ms >= 7_200_000 ? `${Math.round(ms / 3_600_000)}h` : `${Math.round(ms / 60_000)}m`);
  // tradeUsd before eth: a basket trade carries its size there and nowhere else,
  // so without it this line read "— · 6h ago" on the one event type it exists to
  // describe. Same miss as the deck's feed row had.
  const evAmount = (e: ActivityEvent) =>
    e.kind === "launch"
      ? (e.symbol ?? "launch")
      : e.usd != null
        ? fmtUsdFull(e.usd)
        : e.tradeUsd != null
          ? fmtUsdFull(e.tradeUsd)
          : e.eth != null
            ? `Ξ${fmtEth(e.eth)}`
            : "—";
  const evLine = (e?: ActivityEvent) => (e ? `${evAmount(e)} · ${agoString(e.ts, now, true)} ago` : "quiet");

  const tradeH = histogram(isTradeEv);
  const swapH = histogram(isSwapEv);

  // realtime (trailing 24h off the live feed) paired with lifetime, per stream —
  // the flow shows BOTH: what is moving now, and what it has amounted to
  // the time ladder: the same stream measured over three durations, so a card
  // reads live → daily → lifetime left to right (the designer, 2026-08-13)
  const DAY = 86_400_000;
  const HOUR = 3_600_000;
  const rt = useMemo(() => {
    const now = Date.now();
    const blank = () => ({ tradesUsd: 0, swapsEth: 0, launches: 0, portfolioUsd: 0 });
    const h = blank(), d = blank();
    for (const e of events) {
      const age = now - e.ts;
      if (age > DAY) continue;
      for (const b of age <= HOUR ? [h, d] : [d]) {
        if (isTradeEv(e)) b.tradesUsd += e.usd ?? (e.eth != null ? e.eth * ethUsd : 0);
        else if (isSwapEv(e)) b.swapsEth += e.eth ?? 0;
        else if (isLaunchEv(e)) b.launches++;
        // the portfolio SYSTEM's fees: batched buys + wrapped swaps (one
        // system per the designer's 2026-08-16 fold), both measured off their events
        if (e.kind === "batch" && e.feeUsd != null) b.portfolioUsd += e.feeUsd;
        else if (e.source === "wrapper" && e.eth != null) b.portfolioUsd += e.eth * ethUsd;
      }
    }
    return { h, d };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, ethUsd]);
  type Rung = { label: string; value: string };
  const sources: { key: string; label: string; color: string; live: boolean; last?: ActivityEvent; bars?: number[]; ladder: Rung[]; tip: string }[] = [
    { key: "trades", label: "Trades", color: C.cyan, live: true, last: lastTrade, bars: tradeH.bars,
      ladder: [
        { label: "1h", value: fmtUsdFull(rt.h.tradesUsd) },
        { label: "24h", value: fmtUsdFull(rt.d.tradesUsd) },
        { label: "all", value: stats ? fmtUsdFull(stats.indexFeesTotal * ethUsd) : "—" },
      ],
      tip: `Basket trades — 25% of every fee heads to the burn · charting the last ${spanLabel(tradeH.spanMs)}` },
    { key: "swaps", label: "Swaps", color: C.green, live: true, last: lastLp, bars: swapH.bars,
      ladder: [
        { label: "1h", value: `Ξ${fmtEth(rt.h.swapsEth)}` },
        { label: "24h", value: `Ξ${fmtEth(stats?.feesToHolders24h ?? rt.d.swapsEth)}` },
        { label: "all", value: stats ? `Ξ${fmtEth(stats.feesEthTotal)}` : "—" },
      ],
      tip: `PRISM pool fees compound into burns · charting the last ${spanLabel(swapH.spanMs)}` },
    // LIVE since the gen-3 ceremony (2026-08-16): the batchers + wrappers are
    // on-chain on all three chains. 1h/24h are measured off the feed's own
    // batch + wrapped-swap events; the all-time total isn't wired into this
    // card yet, and a dash is the site's honest-absence mark, never a zero it
    // didn't measure.
    { key: "portfolio", label: "Portfolio", color: C.purple, live: pipe?.batcher != null,
      ladder: [
        { label: "1h", value: pipe?.batcher ? fmtUsdFull(rt.h.portfolioUsd) : "—" },
        { label: "24h", value: pipe?.batcher ? fmtUsdFull(rt.d.portfolioUsd) : "—" },
        { label: "all", value: "—" },
      ],
      tip: pipe?.batcher
        ? "Spectrum Portfolio · batched buys + wrapped swaps, live since the gen-3 ceremony. The whole fee burns PRISM."
        : "Spectrum Portfolio · launching soon. A share of every fee burns PRISM." },
  ];

  const contributors = useMemo(() => {
    const rows = (pipe?.baskets ?? [])
      .filter((b) => b.pendingUsd > 0.005)
      .sort((a, b) => b.pendingUsd - a.pendingUsd)
      .slice(0, 4)
      .map((b) => ({ key: b.address, label: b.symbol, usd: b.pendingUsd, live: true }));
    return rows;
  }, [pipe]);

  const buckets: { key: string; label: string; usd: number; fill: number; ready: boolean; bounty?: number; tip: string }[] = pipe
    ? [
        {
          key: "baskets",
          label: STAGES[0],
          usd: basketsUsd,
          fill: nearest ? Math.min(1, nearest.pendingEthEquiv / nearest.thresholdEth) : 0,
          ready: pipe.baskets.some((b) => b.crankable),
          // the caller keeps 0.5% of whatever they flush. ONLY the basket path pays
          // a bounty (SpectrumContracts' spec: collector and factory flushes are
          // unrewarded), so any future bountied stage must set its own figure here
          // rather than inherit this rate.
          bounty: pipe.baskets.filter((b) => b.crankable).reduce((a, b) => a + b.pendingUsd, 0) * 0.005,
          tip: nearest ? `Basket fees accruing across ${pipe.baskets.length} baskets · ${nearest.symbol} nearest its crank at ${Math.min(100, Math.round((nearest.pendingEthEquiv / nearest.thresholdEth) * 100))}%` : "Every basket's burn slice accrues here",
        },
        {
          key: "escrow",
          label: STAGES[1],
          usd: escrowEth * ethUsd,
          fill: Math.min(1, escrowEth / 0.1),
          ready: escrowEth > 0.01,
          tip: `Launch fees escrowed by ${pipe.factories.length || "the"} factories · Ξ${fmtEth(escrowEth)}`,
        },
        {
          key: "bridge",
          label: STAGES[2],
          usd: bridgeEth * ethUsd,
          fill: Math.min(1, bridgeEth / 0.1),
          ready: false,
          tip: "L2 fees crossing to mainnet on a 7-day bridge",
        },
        {
          key: "burner",
          label: STAGES[3],
          usd: burnerEth * ethUsd,
          fill: Math.min(1, burnerEth / 0.05),
          ready: burnerEth > 0.0005,
          tip: "The L1 burner pot · delivered ETH awaiting the crank. PRISM only dies here.",
        },
      ]
    : [];

  return (
    <div className="relative overflow-hidden rounded-2xl" style={{ ...glass, border: `1px solid ${C.orange}26` }}>
      {/* the header: title left, then the three totals spread across the card's
          width, each labelled — one number crammed into a corner wasted the
          space (the designer, 2026-08-13) */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-white/5 px-5 py-3">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: C.orange }}>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: C.orange }} />
          Fee pipeline
          <Link href="/flow" className="ml-1 hidden font-semibold normal-case tracking-normal text-slate-500 transition-colors hover:text-white sm:inline" style={{ fontSize: 10 }}>
            · the burn is one lane · whole map →
          </Link>
        </div>
        {/* the totals as one pill, ruled between (the designer's mockup) — spread across
            the whole card they read as three unrelated stats */}
        <div className="ml-auto flex items-center gap-4 rounded-full border border-white/[0.07] px-5 py-1.5" style={{ fontFamily: MONO, background: "rgba(255,255,255,0.02)" }}>
          <div className="flex flex-col items-center">
            <span className="text-[8px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {!pipe && readFailed ? "Pipeline unreadable" : "In the pipeline"}
            </span>
            <span
              className="mt-0.5 text-[17px] font-semibold leading-none"
              style={!pipe && readFailed ? { color: "#8b98a8" } : { color: "#fff", ...glow(C.orange) }}
              title={!pipe && readFailed ? "The chain read failed; retrying every 30 seconds" : undefined}
            >
              {pipe ? fmtUsdFull(totalUsd) : readFailed ? "no read" : "—"}
            </span>
          </div>
          <span className="h-6 w-px bg-white/10" />
          <div className="flex flex-col items-center">
            <span className="text-[8px] font-semibold uppercase tracking-[0.18em] text-slate-500">as ETH</span>
            <span className="mt-0.5 text-[17px] font-semibold leading-none text-slate-400">Ξ{pipe ? fmtEth(totalUsd && ethUsd ? totalUsd / ethUsd : 0) : "—"}</span>
          </div>
          <span className="h-6 w-px bg-white/10" />
          <div className="flex flex-col items-center">
            <span className="text-[8px] font-semibold uppercase tracking-[0.18em] text-slate-500">becomes</span>
            <span className="mt-0.5 text-[17px] font-semibold leading-none" style={{ color: C.orange }}>
              {pipe && prismUsd > 0 ? `${fmtPrism(potentialPrism)} PRISM` : "—"}
            </span>
          </div>
        </div>
      </div>

      {/* ── mobile: the stacked flow (sources → buckets → pool) ── */}
      <div className="flex flex-col gap-3 p-4 lg:hidden">
        {/* sources: the activity itself, drawn — a 12h histogram per stream,
            the freshest event popping in as it lands off the 10s feed poll */}
        <div className="flex flex-col justify-between gap-2">
          {sources.map((s) => (
            <div
              key={s.key}
              title={s.tip}
              className="cursor-default rounded-xl border px-3 py-2"
              style={{ borderColor: s.live ? `${s.color}30` : "rgba(255,255,255,0.07)", background: s.live ? `${s.color}0a` : "rgba(255,255,255,0.02)" }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold" style={{ color: s.live ? "#fff" : "#69758a" }}>
                  {s.label}
                </span>
                {s.live ? (
                  <span
                    key={s.last?.id ?? "idle"}
                    className="text-[10px]"
                    style={{ fontFamily: MONO, color: hot(s.last?.ts) ? s.color : "#5b6572", animation: "ms-blip 0.6s ease-out" }}
                  >
                    {evLine(s.last)}
                  </span>
                ) : (
                  <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: s.color }}>
                    soon
                  </span>
                )}
              </div>
              {/* the last 12 hours, one bar each — height is the hour's event count */}
              <div className="mt-1.5 flex h-5 items-end gap-[3px]" aria-hidden>
                {(s.bars ?? Array(BARS).fill(0)).map((n, i) => {
                  const max = Math.max(1, ...(s.bars ?? [1]));
                  const fresh = s.live && i === BARS - 1 && n > 0;
                  return (
                    <span
                      key={i}
                      className="flex-1 rounded-sm transition-all duration-700"
                      style={{
                        height: n > 0 ? `${Math.max(22, Math.round((n / max) * 100))}%` : "3px",
                        background: n > 0 ? s.color : "rgba(255,255,255,0.08)",
                        opacity: s.live ? (n > 0 ? (fresh ? 1 : 0.55) : 1) : 0.25,
                        boxShadow: fresh ? `0 0 6px ${s.color}` : "none",
                      }}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="hidden items-center px-2 lg:flex lg:flex-none" style={{ width: "5%" }}>
          <Flow color={C.cyan} active={flowing} />
        </div>
        <div className="lg:hidden">
          <Flow color={C.cyan} active={flowing} vertical />
        </div>

        {/* the buckets: literal containers, filling. One number, one word. */}
        <div className="grid grid-cols-4 gap-4 lg:w-[42%]">
          {(pipe ? buckets : Array.from({ length: 4 }, (_, i) => ({ key: `s${i}`, label: "", usd: 0, fill: 0, ready: false, tip: "reading…" }))).map((b) => (
            <Link key={b.key} href="/burn" title={b.tip} className="group flex flex-col items-center gap-2">
              <div className="text-lg font-bold text-white" style={{ fontFamily: MONO }}>
                {pipe ? fmtUsdFull(b.usd) : "·"}
              </div>
              <div
                className="relative h-32 w-full flex-1 overflow-hidden rounded-b-2xl rounded-t-md border transition-all group-hover:border-white/30 lg:h-auto"
                style={{
                  borderColor: b.ready ? `${C.green}59` : "rgba(255,255,255,0.12)",
                  background: "rgba(6,8,14,0.6)",
                  boxShadow: b.ready ? `0 0 18px ${C.green}30, inset 0 0 12px ${C.green}14` : "none",
                }}
              >
                {/* the liquid, with a lit surface line so the level reads at a glance */}
                <div
                  className="absolute inset-x-0 bottom-0 transition-all duration-1000"
                  style={{
                    height: `${Math.max(b.usd > 0.5 ? 6 : 0, Math.round(b.fill * 100))}%`,
                    background: `linear-gradient(180deg, ${b.ready ? C.green : C.cyan}b3, ${b.ready ? C.green : C.cyan}47)`,
                    boxShadow: `0 -2px 14px ${b.ready ? C.green : C.cyan}73`,
                    borderTop: `2px solid ${b.ready ? C.green : C.cyan}e6`,
                  }}
                />
                {b.ready && (
                  <span
                    className="absolute left-1/2 top-2.5 -translate-x-1/2 rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                    style={{ background: `${C.green}26`, color: C.green, border: `1px solid ${C.green}40` }}
                  >
                    flush
                  </span>
                )}
              </div>
              <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500 transition-colors group-hover:text-slate-300">{b.label}</div>
            </Link>
          ))}
        </div>

        <div className="hidden items-center px-3 lg:flex lg:flex-none" style={{ width: "7%" }}>
          <Flow color={C.orange} active={flowing} />
        </div>
        <div className="lg:hidden">
          <Flow color={C.orange} active={flowing} vertical />
        </div>

        {/* the pool: fire, the number, done. Click for the burns themselves. */}
        <div className="relative flex flex-col lg:w-[24%]">
          <button
            type="button"
            onClick={() => setPoolOpen((v) => !v)}
            aria-expanded={poolOpen}
            title="Every burn is PRISM bought and sent to dEaD. Click to see them"
            className="group relative flex flex-1 flex-col items-center justify-center overflow-hidden rounded-xl border p-6 text-center"
            style={{ borderColor: `${C.orange}40`, background: `radial-gradient(circle at 50% 85%, ${C.orange}30 0%, rgba(0,0,0,0) 65%)`, minHeight: 150 }}
          >
            <span
              aria-hidden
              className="absolute bottom-[-52px] left-1/2 h-28 w-[130%] -translate-x-1/2 rounded-[100%] blur-md"
              style={{ background: `${C.orange}${flowing ? "40" : "1a"}`, animation: flowing ? "ms-pool 3.2s ease-in-out infinite" : "none" }}
            />
            <svg className="relative h-9 w-9" fill="none" stroke={C.orange} viewBox="0 0 24 24" style={{ filter: `drop-shadow(0 0 9px ${C.orange}b3)` }}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.6"
                d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z"
              />
            </svg>
            <div className="relative mt-2 text-3xl font-bold text-white" style={{ fontFamily: MONO, ...glow(C.orange) }}>
              {stats ? fmtPrism(stats.totalBurned) : "—"}
            </div>
            <div className="relative mt-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">PRISM burnt</div>
            {lastBurn && (
              <div className="relative mt-2 text-[10px] text-slate-500 transition-colors group-hover:text-slate-300" style={{ fontFamily: MONO }}>
                {agoString(lastBurn.ts, now, true)} ago ↓
              </div>
            )}
          </button>

          {poolOpen && (
            <div className="mt-2 space-y-1 rounded-xl border p-2 lg:absolute lg:inset-x-0 lg:top-full lg:z-20 lg:mt-2" style={{ borderColor: `${C.orange}26`, background: "rgba(8,10,16,0.96)" }}>
              {burns.length === 0 && <div className="p-3 text-[11px] text-slate-500">The pool is gathering.</div>}
              {burns.map((b) => (
                <div key={b.id} className="flex items-center justify-between rounded-lg px-3 py-1.5 transition-colors hover:bg-white/5" style={{ fontFamily: MONO }}>
                  <span className="text-xs font-semibold text-white">{fmtPrism(b.prism)}</span>
                  <span className="text-[10px]" style={{ color: C.orange }}>
                    🔥 <TimeAgo ts={b.ts} short /> ago
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── desktop: THE BURN FLOW — the designer's own mockup (2026-08-13), rebuilt in
          the deck's tokens and wired to live data. Source cards down the left,
          vertically centred against the rail; station nodes on the rail; the
          burn core orbiting on the right. Every dashed run marches only while
          its stream is actually moving, so the motion is a readout. */}
      <div className="relative hidden px-6 py-4 lg:block">
        <div className="relative grid grid-cols-[290px_1fr_300px] items-center gap-5">
          {/* ── the sources ── */}
          <div className="flex flex-col gap-3">
            {sources.map((s) => (
              <div
                key={s.key}
                title={s.tip}
                className="relative cursor-default rounded-xl border-l-[3px] px-4 py-3 transition-colors"
                style={{
                  ...glass,
                  borderLeftColor: s.live ? (hot(s.last?.ts) ? s.color : `${s.color}80`) : `${s.color}4d`,
                  opacity: s.live ? 1 : 0.72,
                }}
              >
                {/* the stream's own shape, as the card's floor */}
                {s.live && (
                  <span aria-hidden className="pointer-events-none absolute inset-x-4 bottom-2 flex h-3.5 items-end gap-[2px] opacity-40">
                    {(s.bars ?? Array(BARS).fill(0)).map((n, i) => {
                      const max = Math.max(1, ...(s.bars ?? [1]));
                      return (
                        <span
                          key={i}
                          className="flex-1 rounded-sm transition-all duration-700"
                          style={{ height: n > 0 ? `${Math.max(14, (n / max) * 100)}%` : "2px", background: s.color }}
                        />
                      );
                    })}
                  </span>
                )}

                <div className="relative flex items-center justify-between gap-3">
                  <span className="text-[13px] font-semibold" style={{ color: s.live ? "rgba(255,255,255,0.88)" : "#8b98a8" }}>
                    {s.label}
                  </span>
                  {!s.live && (
                    <span className="text-[10px]" style={{ fontFamily: MONO, color: s.color }}>
                      launching soon
                    </span>
                  )}
                </div>

                {/* the time ladder: the same stream over three durations, each
                    rung ruled off from the next so the eye reads them apart */}
                <div className="relative mt-0.5 grid grid-cols-3 pb-4">
                  {s.ladder.map((r, i) => (
                    <div
                      key={r.label}
                      className={`flex flex-col ${i > 0 ? "pl-2.5" : ""}`}
                      style={{
                        opacity: s.live ? (i === 2 ? 0.8 : 1) : 0.5,
                        borderLeft: i > 0 ? "1px solid rgba(255,255,255,0.08)" : undefined,
                      }}
                    >
                      <span
                        className="text-[8.5px] font-semibold uppercase tracking-[0.16em]"
                        style={{ color: i === 0 && s.live && hot(s.last?.ts) ? s.color : "#5b6572" }}
                      >
                        {r.label}
                      </span>
                      <span
                        className="mt-1.5 truncate text-[19px] font-medium leading-none"
                        style={{ fontFamily: MONO, color: i === 2 ? "#94a3b8" : s.live ? "#fff" : "#69758a" }}
                      >
                        {r.value}
                      </span>
                    </div>
                  ))}
                </div>
                {/* the port where this card meets the rail */}
                <span
                  className="absolute -right-[7px] top-1/2 grid h-3.5 w-3.5 -translate-y-1/2 place-items-center rounded-full border-2"
                  style={{ borderColor: s.live ? s.color : `${s.color}80`, background: "#0b0b10" }}
                >
                  <span
                    className={`h-1 w-1 rounded-full ${s.live && hot(s.last?.ts) ? "animate-pulse" : ""}`}
                    style={{ background: s.color, opacity: s.live ? 1 : 0.5 }}
                  />
                </span>
              </div>
            ))}
          </div>

          {/* ── the rail: joins from the four ports, then station to station ── */}
          <div className="relative h-[300px]">
            <svg viewBox="0 0 460 300" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
              {sources.map((s, i) => {
                const y = 300 / (sources.length + 1) * (i + 1);
                const on = s.live && hot(s.last?.ts);
                return (
                  <path
                    key={s.key}
                    d={`M0,${y} C60,${y} 60,150 120,150`}
                    fill="none"
                    stroke={s.color}
                    strokeWidth="1.5"
                    strokeDasharray={s.live ? "4 4" : "3 5"}
                    opacity={s.live ? (on ? 0.75 : 0.32) : 0.22}
                    style={on ? { animation: "ms-beam-flow 1.6s linear infinite" } : undefined}
                  />
                );
              })}
              {[0, 1, 2, 3].map((i) => {
                const x0 = 120 + i * 85;
                const col = i < 2 ? C.cyan : i === 2 ? C.green : C.orange;
                return (
                  <line
                    key={i}
                    x1={x0}
                    y1="150"
                    x2={x0 + 85}
                    y2="150"
                    stroke={col}
                    strokeWidth="2"
                    strokeDasharray="4 4"
                    opacity={flowing ? 0.7 : 0.2}
                    style={flowing ? { animation: "ms-beam-flow 1.6s linear infinite" } : undefined}
                  />
                );
              })}
            </svg>

            {/* the stations, sitting on the rail */}
            <div className="absolute inset-0 grid grid-cols-4 items-center" style={{ paddingLeft: "16%", paddingRight: "2%" }}>
              {(pipe ? buckets : Array.from({ length: 4 }, (_, i) => ({ key: `sk${i}`, label: "", usd: 0, fill: 0, ready: false, bounty: undefined as number | undefined, tip: "reading…" }))).map((b) => {
                const col = b.ready ? C.green : b.usd > 0.5 ? C.cyan : "#334155";
                const pct = Math.max(b.usd > 0.5 ? 6 : 0, Math.min(100, Math.round(b.fill * 100)));
                return (
                  <Link key={b.key} href="/burn" title={b.tip} className="group relative flex flex-col items-center" style={{ zIndex: 2 }}>
                    <span className="mb-3 text-lg text-white" style={{ fontFamily: MONO, textShadow: "0 2px 4px rgba(0,0,0,0.8)" }}>
                      {pipe ? fmtUsdFull(b.usd) : "·"}
                    </span>
                    <span
                      className="relative grid h-[84px] w-[84px] place-items-center rounded-full transition-all"
                      style={{
                        background: "#0b0b10",
                        border: `${b.ready ? 3 : 1}px solid ${b.ready ? `${C.green}99` : "rgba(255,255,255,0.09)"}`,
                        boxShadow: b.ready
                          ? `0 0 30px ${C.green}26, inset 0 0 20px rgba(0,0,0,0.8)`
                          : "inset 0 0 20px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04)",
                      }}
                    >
                      {/* the fill, as a ring drawn from 12 o'clock */}
                      {pct > 0 && (
                        <svg viewBox="0 0 84 84" className="absolute inset-0 h-full w-full -rotate-90">
                          <circle cx="42" cy="42" r="38" fill="none" stroke={col} strokeWidth="2.5" strokeLinecap="round" pathLength={100} strokeDasharray={`${pct} 100`} opacity="0.9" />
                        </svg>
                      )}
                      {b.ready && (
                        <span className="absolute inset-[3px] rounded-full border border-dashed" style={{ borderColor: `${C.green}40`, animation: "spin 14s linear infinite" }} />
                      )}
                      <span
                        className="grid h-[54px] w-[54px] place-items-center rounded-full"
                        style={{ background: "#12121a", border: `1px solid ${b.ready ? `${C.green}33` : "rgba(255,255,255,0.05)"}` }}
                      >
                        <span
                          className={`rounded-full ${b.ready ? "animate-pulse" : ""}`}
                          style={{
                            width: b.ready ? 15 : 11,
                            height: b.ready ? 15 : 11,
                            background: b.usd > 0.5 ? col : "#334155",
                            boxShadow: b.usd > 0.5 ? `0 0 14px ${col}` : "none",
                          }}
                        />
                      </span>
                    </span>
                    <span className="mt-3.5 text-[9.5px] font-medium uppercase tracking-[0.25em] text-slate-500 transition-colors group-hover:text-slate-300">
                      {b.label}
                    </span>
                    {b.ready && (
                      <span className="absolute left-1/2 top-full mt-2 flex -translate-x-1/2 flex-col items-center gap-0.5">
                        <span
                          className="flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em]"
                          style={{ color: C.green, background: `${C.green}1a`, borderColor: `${C.green}4d`, boxShadow: `0 0 12px ${C.green}26` }}
                        >
                          Flush →
                        </span>
                        {b.bounty != null && b.bounty > 0.01 && (
                          <span className="whitespace-nowrap text-[9px]" style={{ fontFamily: MONO, color: `${C.green}b3` }}>
                            keep {fmtUsdFull(b.bounty)}
                          </span>
                        )}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>

          {/* ── the burn core ── */}
          <div className="relative mx-auto grid h-[300px] w-[300px] place-items-center">
            <span aria-hidden className="absolute inset-6 rounded-full blur-[50px]" style={{ background: `${C.orange}1a` }} />
            {/* outer dotted ring */}
            <svg viewBox="0 0 300 300" className="absolute inset-0 h-full w-full opacity-60" style={{ animation: "spin 40s linear infinite" }} aria-hidden>
              <circle cx="150" cy="150" r="144" fill="none" stroke={`${C.orange}33`} strokeWidth="1" strokeDasharray="4 12" />
            </svg>
            {/* the live arc, counter-rotating */}
            <svg viewBox="0 0 300 300" className="absolute inset-0 h-full w-full" style={{ animation: "spin 30s linear infinite reverse" }} aria-hidden>
              <circle
                cx="150"
                cy="150"
                r="130"
                fill="none"
                stroke={C.orange}
                strokeWidth="2"
                strokeLinecap="round"
                pathLength={100}
                strokeDasharray="62 100"
                style={{ filter: `drop-shadow(0 0 8px ${C.orange})` }}
                opacity={flowing ? 1 : 0.4}
              />
              <circle cx="150" cy="150" r="112" fill="none" stroke={`${C.orange}80`} strokeWidth="1" pathLength={100} strokeDasharray="16 100" strokeDashoffset="-70" strokeLinecap="round" />
            </svg>
            {/* one mote riding the outer edge while value flows */}
            {flowing && (
              <span aria-hidden className="absolute inset-0" style={{ animation: "spin 8s linear infinite" }}>
                <span className="absolute left-1/2 top-[6px] h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-white" style={{ boxShadow: `0 0 12px #fff, 0 0 20px ${C.orange}` }} />
              </span>
            )}

            <button
              type="button"
              onClick={() => setPoolOpen((v) => !v)}
              aria-expanded={poolOpen}
              title="Every burn is PRISM bought and sent to dEaD. Click to see them"
              className="relative grid h-[230px] w-[230px] place-items-center overflow-hidden rounded-full text-center"
              style={{
                background: "rgba(10,6,4,0.82)",
                border: `1px solid ${C.orange}33`,
                boxShadow: `inset 0 0 70px ${C.orange}0d, 0 10px 40px rgba(0,0,0,0.8)`,
                backdropFilter: "blur(12px)",
              }}
            >
              <span aria-hidden className="absolute bottom-0 left-1/2 h-[45%] w-[78%] -translate-x-1/2 rounded-full blur-[34px]" style={{ background: `${C.orange}1f` }} />
              <span className="relative flex flex-col items-center">
                <span
                  className="mb-3 grid h-11 w-11 place-items-center rounded-full"
                  style={{ background: `${C.orange}1a`, border: `1px solid ${C.orange}33`, boxShadow: `0 0 20px ${C.orange}26` }}
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill={C.orange} style={{ filter: `drop-shadow(0 0 10px ${C.orange})` }}>
                    <path d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
                  </svg>
                </span>
                <span className="text-[38px] font-bold leading-none tracking-tighter text-white" style={{ fontFamily: MONO }}>
                  {stats ? fmtPrism(stats.totalBurned) : "—"}
                </span>
                <span className="mt-2.5 flex items-center gap-2">
                  <span className="h-px w-6" style={{ background: `linear-gradient(90deg, transparent, ${C.orange}66)` }} />
                  <span className="text-[9px] font-semibold uppercase tracking-[0.3em]" style={{ fontFamily: MONO, color: `${C.orange}b3` }}>
                    Prism burnt · ever
                  </span>
                  <span className="h-px w-6" style={{ background: `linear-gradient(270deg, transparent, ${C.orange}66)` }} />
                </span>
                <span
                  className="mt-3 flex flex-col items-center gap-0.5 rounded-xl border px-4 py-1.5"
                  style={{ background: "rgba(0,0,0,0.4)", borderColor: "rgba(255,255,255,0.05)" }}
                >
                  <span className="text-[13px]" style={{ fontFamily: MONO, color: C.orange }}>
                    {stats ? fmtPrism(stats.prismBurnedToday) : "—"} <span className="ml-1 text-[11px] text-slate-500">in 24h</span>
                    {yearPct > 0 && <span className="ml-1.5 text-[10px] text-slate-500">· {yearPct.toFixed(1)}%/yr</span>}
                  </span>
                  <span className="h-px w-full bg-white/5" />
                  <span className="text-[9px] uppercase tracking-wider" style={{ fontFamily: MONO, color: `${C.orange}80` }}>
                    {sessionBurned > 0
                      ? `${fmtPrism(sessionBurned)} since you arrived`
                      : burnerEth > 0.001
                        ? `Ξ${fmtEth(burnerEth)} awaiting crank`
                        : lastBurn
                          ? `${agoString(lastBurn.ts, now, true)} ago ↓`
                          : "watching"}
                  </span>
                </span>
              </span>
            </button>
          </div>
        </div>

        {poolOpen && (
          <div
            className="absolute bottom-3 right-6 z-20 w-72 space-y-1 rounded-xl border p-2"
            style={{ borderColor: `${C.orange}26`, background: "rgba(8,10,16,0.96)" }}
          >
            {burns.length === 0 && <div className="p-3 text-[11px] text-slate-500">The pool is gathering.</div>}
            {burns.map((b) => (
              <div key={b.id} className="flex items-center justify-between rounded-lg px-3 py-1.5 transition-colors hover:bg-white/5" style={{ fontFamily: MONO }}>
                <span className="text-xs font-semibold text-white">{fmtPrism(b.prism)}</span>
                <span className="text-[10px]" style={{ color: C.orange }}>🔥 <TimeAgo ts={b.ts} short /> ago</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* who is feeding it — the accruals broken out by source */}
      <div className="hidden items-center gap-3 border-t border-white/5 px-5 py-2 lg:flex">
        <span className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500">Feeding the burn</span>
        <div className="flex flex-1 items-center gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          {contributors.length === 0 && <span className="text-[10px] text-slate-600">Nothing accruing right now.</span>}
          {contributors.map((c) => (
            <span
              key={c.key}
              title={`${c.label} has ${fmtUsdFull(c.usd)} accruing toward its next burn`}
              className="flex shrink-0 items-center gap-2 rounded-full border px-3 py-1"
              style={{ borderColor: `${C.cyan}2e`, background: `${C.cyan}0d`, fontFamily: MONO }}
            >
              <span className="text-[11px] font-semibold text-white">{c.label}</span>
              <span className="text-[11px]" style={{ color: `${C.cyan}d9` }}>{fmtUsdFull(c.usd)}</span>
            </span>
          ))}
          {/* the berth: LIVE since the gen-3 ceremony (2026-08-16) — it shows
              measured batch fees the moment the first real batch lands, and
              says "live" honestly until then rather than inventing a number */}
          {pipe?.batcher ? (
            <span
              title={
                (pipe.batcher.batches ?? 0) > 0
                  ? `Spectrum Portfolio · ${pipe.batcher.batches} batch${(pipe.batcher.batches ?? 0) === 1 ? "" : "es"} through the production batchers, ${fmtUsdFull(pipe.batcher.feesUsd ?? 0)} of fees toward the burn`
                  : "Spectrum Portfolio · the production batchers are live on all three chains; figures count up from the first real batch"
              }
              className="flex shrink-0 items-center gap-2 rounded-full border px-3 py-1"
              style={{ borderColor: `${C.purple}45`, background: `${C.purple}0d`, fontFamily: MONO }}
            >
              <span className="text-[11px] font-semibold text-white">Portfolio</span>
              <span className="text-[11px]" style={{ color: `${C.purple}d9` }}>
                {(pipe.batcher.batches ?? 0) > 0 ? fmtUsdFull(pipe.batcher.feesUsd ?? 0) : "live"}
              </span>
            </span>
          ) : (
            <span
              title="Spectrum Portfolio · every batched buy will feed this once its batcher is deployed"
              className="flex shrink-0 items-center gap-2 rounded-full border border-dashed px-3 py-1"
              style={{ borderColor: `${C.purple}40`, fontFamily: MONO }}
            >
              <span className="text-[11px] font-semibold" style={{ color: `${C.purple}cc` }}>Portfolio</span>
              <span className="text-[10px] text-slate-500">soon</span>
            </span>
          )}
        </div>
      </div>

      {/* every PRISM buy the ecosystem has made, live */}
      <div className="flex items-center gap-3 border-t border-white/5 px-5 py-2">
        <span className="hidden shrink-0 items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.18em] sm:flex" style={{ color: C.orange }}>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: C.orange }} />
          PRISM bought &amp; burnt
        </span>
        <div className="flex flex-1 items-center gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          {/* a staged burn leads the row: it is money waiting for a public crank */}
          {(pipe?.collectors ?? [])
            .filter(collectorCrankable)
            .map((c) => (
              <PendingBurnChip key={`${c.chain}-${c.address}`} collector={c} onOpen={setBurnCrank} />
            ))}
          {liveBurns.length === 0 && (
            <span className="text-[10px] text-slate-600">No buys in the current window. The pool is gathering.</span>
          )}
          {liveBurns.map((b) => (
            <BurnChip key={b.id} e={b} prismUsd={prismUsd} />
          ))}
        </div>
        {account && mine && mine.prisms > 0 ? (
          <Link
            href="/claim"
            className="flex shrink-0 items-center gap-2 rounded-full border px-3 py-1 transition-colors hover:border-white/25"
            style={{ borderColor: `${C.green}40`, background: `${C.green}0d`, fontFamily: MONO }}
            title="Your Prisms' share of these fees · claim it on the Prism Hub"
          >
            <span className="text-[10px] text-slate-400">yours</span>
            <span className="text-[12px] font-semibold" style={{ color: C.green }}>
              Ξ{fmtEth(mine.pendingEth)}
            </span>
            {mine.pendingPrism > 0.0001 && (
              <span className="text-[11px] text-slate-400">+ {fmtPrism(mine.pendingPrism)}</span>
            )}
            {mineStale && (
              <span className="text-[10px] text-red-300/80" title="The wallet read stopped answering. These are the last figures that came through.">
                stale
              </span>
            )}
            <span className="text-[10px]" style={{ color: `${C.green}b3` }}>claim →</span>
          </Link>
        ) : (
          <button
            type="button"
            onClick={openPicker}
            className="shrink-0 whitespace-nowrap text-[10px] text-slate-500 transition-colors hover:text-white"
          >
            {account ? "flush a stage →" : "connect to see your share →"}
          </button>
        )}
      </div>
      {burnCrank && (
        <PendingBurnModal
          collector={burnCrank}
          ethUsd={ethUsd}
          onClose={() => setBurnCrank(null)}
          onDone={() => {
            setBurnCrank(null);
            refreshPipe(); // the crank just moved money — the chip must retire NOW
          }}
        />
      )}
    </div>
  );
}

// ── THE STRIP — the pipeline in one line, for the homepage ───────────────────
// the designer, 2026-08-13: "any way to have a small version of this as a live strip
// on the homepage". Same live sources (/api/burn-pipeline + the feed's stats),
// same honesty rules, one row: what is in the pipeline → the buckets as beads
// on a rail, the flushable one lit → what has burnt. Links into /command.
export function FeePipelineStrip({ stats, events = [] }: { stats: PulseStats | null; events?: ActivityEvent[] }) {

  const stripBurns = events.filter((e) => e.kind === "burn" && (e.prism ?? 0) > 0).slice(0, 16);
  const prismUsdNow = stats?.prismUsd ?? 0;
  // staged burns awaiting their public crank — this is a REAL consumer of the
  // pipeline payload (unlike the fetch-and-discard this strip once had), and
  // the route is 30s-cached server-side; ten minutes is plenty for the home page
  const { data: pipe, refresh } = usePolledJson<{ collectors?: PendingCollector[]; ethUsd?: number }>("/api/burn-pipeline", 600_000);
  const [burnCrank, setBurnCrank] = useState<PendingCollector | null>(null);
  useBatchNudge(events, refresh);

  return (
    <div className="overflow-hidden rounded-2xl" style={{ ...glass, border: `1px solid ${C.orange}26` }}>
    {/* every PRISM the ecosystem has bought and burnt, with its transaction */}
    <div className="flex items-center gap-3 px-5 py-2.5">
      <Link href="/command" className="hidden shrink-0 items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.18em] transition-colors hover:text-white sm:flex" style={{ color: C.orange }}>
        <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: C.orange }} />
        PRISM bought &amp; burnt
      </Link>
      <div className="flex flex-1 items-center gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {(pipe?.collectors ?? [])
          .filter(collectorCrankable)
          .map((c) => (
            <PendingBurnChip key={`${c.chain}-${c.address}`} collector={c} onOpen={setBurnCrank} />
          ))}
        {stripBurns.length === 0 && <span className="text-[10px] text-slate-600">No buys in the current window.</span>}
        {stripBurns.map((b) => (
          <BurnChip key={b.id} e={b} prismUsd={prismUsdNow} />
        ))}
      </div>
    </div>
    {burnCrank && (
      <PendingBurnModal collector={burnCrank} ethUsd={pipe?.ethUsd ?? stats?.ethUsd ?? 0} onClose={() => setBurnCrank(null)} onDone={refresh} />
    )}
    </div>
  );
}
