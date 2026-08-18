"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ActivityEvent, PulseStats, RangeKey } from "@/lib/feed/types";
import { EventDetailModal } from "@/components/pulse/event-detail-modal";
import { BurnerCrankModal, CrankTotalsButtons, PendingBurnChip, PendingBurnModal, collectorCrankable, type BurnerPot, type PendingCollector } from "@/components/pulse/crank-burn";
import { FinalizeCrankModal, type FinalizeTarget } from "@/components/pulse/finalize-crank";
import { usePolledJson } from "@/hooks/usePolledJson";
import { StartRadioButton } from "@/components/radio/start-radio";
import { fmtEth, fmtUsd, fmtUsdFull } from "@/lib/feed/format";
import { C, MONO, glow } from "./style";
import { TimeAgo } from "./time-ago";

// ── THE MONEY MAP, v3 — light in, spectrum out ───────────────────────────────
// the designer killed the horizontal Sankey ("boring money flow"). This is the
// composition the brand already owns: every fee is WHITE LIGHT beaming into a
// central prism, and the prism refracts it into the spectrum — one colored
// beam per destination. A real transaction crosses the map as a labeled pulse,
// visibly SPLITS at the prism, and its fragments ride the colored beams out to
// the cards. The page opens by replaying the last few real events one by one,
// so the map is alive in the first second instead of waiting for the chain.
//
// The honesty law is unchanged from v1/v2:
// - Basket lanes are the on-chain FeesAccrued split amounts, measured per
//   window — never a hardcoded share (this surface stays out of the open
//   burn-share question). The pool lane applies the token's fixed split (ETH
//   leg all to holders; PRISM leg 80/20 → 90/10 of its fee USD) to measured
//   pool fees. Launch fees burn in full. Portfolio and Lightrunner are dark
//   berths with no numbers until their contracts emit real events.
// - Replay pulses ARE real recent events (each labeled, each on the wire with
//   its age); the REPLAY/LIVE badge says which mode the theatre is in.
// - Beam thickness is capped: volume reads from the numbers and the pulse
//   traffic, not from a 300px river drowning the cards (v2's mistake).
// - rAF loop: dt clamped ≥ 0 (the rAF timestamp can precede the arming
//   performance.now(); unclamped it killed v2's loop on frame one), paused on
//   hidden tabs, skipped entirely under reduced motion.
// - Styling inline (Tailwind v4 tree-shakes custom classes — style.ts law).

const YELLOW = "#FACC15";

const DEST = [
  { key: "holders", label: "Holders", color: C.green, href: "/claim", note: "Claimable on the Prism Hub" },
  { key: "creator", label: "Creators", color: C.cyan, note: "The basket creator's share" },
  { key: "interfaces", label: "Interfaces", color: C.purple, note: "Interface and launcher share" },
  { key: "league", label: "Creator league", color: YELLOW, note: "The Robinhood league slice" },
  { key: "burn", label: "The Burn", color: C.orange, href: "/burn", note: "Buys PRISM, sends it to dEaD" },
] as const;
type DestKey = (typeof DEST)[number]["key"];

import { POOL_TO_HOLDERS, POOL_TO_BURN, WRAPPER_BURN_SHARE } from "@/lib/chain/constants";

const RANGES: { key: string; spectrum: RangeKey; charts: string; label: string }[] = [
  { key: "24h", spectrum: "24h", charts: "24h", label: "last 24 hours" },
  { key: "7d", spectrum: "1w", charts: "1w", label: "last 7 days" },
  { key: "1m", spectrum: "1m", charts: "1m", label: "last 30 days" },
  { key: "1y", spectrum: "1y", charts: "1y", label: "last 12 months" },
];

const sum = (a?: number[]) => (a ?? []).reduce((x, y) => x + (y || 0), 0);
const ZERO_SPLIT: Record<DestKey, number> = { holders: 0, burn: 0, creator: 0, interfaces: 0, league: 0 };

// The window's measured figures for the source cards: the fee totals that size
// the beams, plus the traded volume shown beside each fee (the designer, 2026-08-15).
// A null volume means the route doesn't serve it (an older deploy) — the card
// simply shows no volume rather than a zero it never measured.
type MapSpec = {
  feeSplit: Record<DestKey, number>;
  auctionUsd: number;
  basketsVolUsd: number | null; // basket buy+sell notional, three chains
  launchCount: number | null; // launches in the window — the flat fee's volume analogue
  poolVolUsd: number | null; // PRISM-pool swap notional (ETH side, measured off Swap events)
  batchVolUsd: number | null; // portfolio batch funding through the batcher watch
  // The Spectrum Portfolio's TWO fee-capture routes — batches through the
  // batcher, wrapped swaps through the fee wrapper — are ONE SYSTEM (the designer,
  // 2026-08-16) and fold into one source card. All figures MEASURED; wrapper
  // amounts native-sells only (the fee is charged in the sell asset).
  wrapperFeeUsd: number | null;
  wrapperBurnUsd: number | null;
  wrapperVolUsd: number | null;
  batchFeeUsd: number | null;
  batchBurnUsd: number | null;
  // burn money IN FLIGHT on the L2→L1 withdrawal bridge (collector flushes +
  // Base's own bridge events, trailing ~7d — the charts store's bridge figure)
  bridgeEth: number | null;
  bridgeUnlockTs: number | null;
};

function useSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => {
      const r = es[0].contentRect;
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, size };
}

// `live` marks a pulse born from an event that arrived WHILE watching — only
// those credit the destination count-up. Replayed baseline events are already
// inside the measured window figures, so crediting them would double-count.
type PulseSeed = { source: string; label: string; usd: number; event?: ActivityEvent; live?: boolean };

/** The window's per-destination dollars, straight off the figure inputs — the
 *  same arithmetic the model uses, extracted so the live count-up can absorb
 *  its boosts when a fresh read has grown to include the events behind them. */
function rawDestTotals(spec: { feeSplit: Record<DestKey, number>; auctionUsd: number } | null, poolUsd: number | null): Record<string, number> | null {
  if (!spec || poolUsd == null) return null;
  return {
    holders: poolUsd * POOL_TO_HOLDERS + spec.feeSplit.holders,
    creator: spec.feeSplit.creator,
    interfaces: spec.feeSplit.interfaces,
    league: spec.feeSplit.league,
    burn: poolUsd * POOL_TO_BURN + spec.feeSplit.burn + spec.auctionUsd,
  };
}

/** The centerpiece counts up to its value — ~700ms, ease-out, and it respects
 *  reduced motion by just stating the number. Re-runs when the window changes. */
function CountUp({ value, render }: { value: number; render: (v: number) => string }) {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(0);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      fromRef.current = value;
      return;
    }
    const from = fromRef.current;
    fromRef.current = value;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 700);
      const e = 1 - Math.pow(1 - t, 3);
      setShown(from + (value - from) * e);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{render(shown)}</>;
}

export function MoneyMap() {
  const [rangeKey, setRangeKey] = useState("24h");
  // "Protocol" narrows the lens to the two lanes that accrue to PRISM itself
  // (holders + the burn); creators, interfaces and the league are participant
  // payouts (the designer, 2026-08-16: "only fees genuinely going to the protocol")
  const [protocolOnly, setProtocolOnly] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[0];
  const [spec, setSpec] = useState<MapSpec | null>(null);
  const [poolUsd, setPoolUsd] = useState<number | null>(null);
  const [lane, setLane] = useState<{ spec: string; pool: string }>({ spec: "reading", pool: "reading" });
  // "cache" = painted from the last visit while the refresh runs · "fresh" = this visit's read
  const [figSource, setFigSource] = useState<"none" | "cache" | "fresh">("none");
  const [watched, setWatched] = useState(0);
  const [wire, setWire] = useState<ActivityEvent[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const [mode, setMode] = useState<"replay" | "live">("replay");
  // the transaction a visitor clicked — on the wire OR mid-flight on the map
  const [detail, setDetail] = useState<ActivityEvent | null>(null);
  const [stats, setStats] = useState<PulseStats | null>(null);
  // the rAF loop is imperative and must not re-run when this changes, so the
  // opener lives behind a ref
  const openDetail = useRef<(e: ActivityEvent) => void>(() => {});
  openDetail.current = (e: ActivityEvent) => setDetail(e);
  const pulseQueue = useRef<PulseSeed[]>([]);
  // spot ETH for fragment fee labels — a ref so the rAF loop never re-arms
  const ethUsdRef = useRef(0);
  const replayDone = useRef(false);
  const seenIds = useRef<Set<string> | null>(null);
  // staged burns awaiting their permissionless crank — the burn-pipeline
  // route is 30s-cached server-side; a 5-minute poll here is plenty
  const { data: pipe, refresh: refreshPipe } = usePolledJson<{
    collectors?: PendingCollector[];
    burner?: { address: string; balanceEth: number };
    withdrawals?: { chain: string; amountEth: number; txHash: string; ts: number; unlockTs: number; status: "window" | "executable" | "landed" }[];
    ethUsd?: number;
  }>("/api/burn-pipeline", 300_000);
  // the crossing figure prefers the pipeline's PER-WITHDRAWAL truth: the charts
  // aggregate is a 7-day trailing window, so a finalized withdrawal would keep
  // reading as "crossing" for days after it landed. Charts stays the fallback
  // for the moment before the pipeline read arrives.
  const crossing = useMemo(() => {
    if (pipe?.withdrawals) {
      const open = pipe.withdrawals.filter((w) => w.status !== "landed");
      return { eth: open.reduce((a, w) => a + w.amountEth, 0), unlockTs: open.length ? Math.min(...open.map((w) => w.unlockTs)) : null };
    }
    return { eth: spec?.bridgeEth ?? 0, unlockTs: spec?.bridgeUnlockTs ?? null };
  }, [pipe?.withdrawals, spec?.bridgeEth, spec?.bridgeUnlockTs]);
  const [burnCrank, setBurnCrank] = useState<PendingCollector | null>(null);
  // the L1 burner's own crank popup — the map does the whole thing in place
  const [burnerCrank, setBurnerCrank] = useState<BurnerPot | null>(null);
  // a READY crossing's one-click L1 finalize, in place like every other crank
  const [finalizeCrank, setFinalizeCrank] = useState<FinalizeTarget | null>(null);
  // the oldest crossing already at the gate (the one-click path is Arbitrum's)
  const atTheGate = useMemo(() => {
    const ready = (pipe?.withdrawals ?? []).filter((w) => w.status === "executable" && w.chain === "robinhood");
    return ready.length ? ready.reduce((a, w) => (w.ts < a.ts ? w : a)) : null;
  }, [pipe?.withdrawals]);

  // ── the live count-up: a landed fragment ticks its destination up NOW ──
  // (the designer, 2026-08-16: "the right hand numbers dont count up when the flow
  // goes down their path"). Each live fragment credits its destination the
  // moment it lands; a fresh window read then ABSORBS the credit as its own
  // figures grow to include those events, so nothing double-counts and the
  // display never dips back.
  const [boost, setBoost] = useState<Record<string, number>>({});
  const prevRawRef = useRef<Record<string, number> | null>(null);
  const creditDest = useRef((dest: DestKey, usd: number) => {
    // negative amounts are the replay's REWIND debits — they must pass
    if (usd !== 0) setBoost((b) => ({ ...b, [dest]: (b[dest] ?? 0) + usd }));
  });
  useEffect(() => {
    // a new window is a new baseline — live credits belong to the old one
    setBoost({});
    prevRawRef.current = null;
  }, [rangeKey]);
  useEffect(() => {
    const raw = rawDestTotals(spec, poolUsd);
    if (!raw) return;
    const prev = prevRawRef.current;
    prevRawRef.current = raw;
    if (!prev) return;
    setBoost((b) => {
      let changed = false;
      const next = { ...b };
      for (const k of Object.keys(next)) {
        const grown = Math.max(0, (raw[k] ?? 0) - (prev[k] ?? 0));
        if (grown > 0 && next[k] > 0) {
          next[k] = Math.max(0, next[k] - grown);
          changed = true;
        }
      }
      return changed ? next : b;
    });
  }, [spec, poolUsd]);
  const boostSum = Object.values(boost).reduce((a, b) => a + b, 0);

  // ── the window's measured figures ──
  useEffect(() => {
    let alive = true;
    setSpec(null);
    setPoolUsd(null);
    setFigSource("none");
    setLane({ spec: "reading", pool: "reading" });
    // Paint from the last visit INSTANTLY, refresh behind it. The spectrum
    // charts read blocks ~4s warm (worse cold) — the designer sat staring at
    // "Focusing the light…". Window totals move slowly, so last-visit figures
    // marked "refreshing" are more honest than four seconds of nothing.
    const CACHE_KEY = `mm-figures-v5-${range.key}`; // v5: portfolio = batches + wrapped swaps, one card (v4 wrapper, v3 bridge)
    try {
      const raw = window.localStorage.getItem(CACHE_KEY);
      if (raw) {
        const c = JSON.parse(raw) as { spec: MapSpec; poolUsd: number };
        if (c?.spec?.feeSplit && typeof c.poolUsd === "number") {
          setSpec(c.spec);
          setPoolUsd(c.poolUsd);
          setFigSource("cache");
        }
      }
    } catch {
      /* a bad cache entry is ignored, never fatal */
    }
    const done = {
      spec: null as null | Omit<MapSpec, "poolVolUsd" | "bridgeEth" | "bridgeUnlockTs" | "wrapperFeeUsd" | "wrapperBurnUsd" | "wrapperVolUsd" | "batchFeeUsd" | "batchBurnUsd">,
      pool: null as null | number,
      poolVol: null as null | number,
      bridge: null as null | { pendingEth: number; nextBurnTs: number | null },
      wrapFee: null as null | number,
      wrapBurn: null as null | number,
      wrapVol: null as null | number,
      batchFee: null as null | number,
      batchBurn: null as null | number,
    };
    const maybeFinish = () => {
      if (done.spec == null || done.pool == null) return;
      const full: MapSpec = {
        ...done.spec,
        poolVolUsd: done.poolVol,
        bridgeEth: done.bridge?.pendingEth ?? null,
        bridgeUnlockTs: done.bridge?.nextBurnTs ?? null,
        wrapperFeeUsd: done.wrapFee,
        wrapperBurnUsd: done.wrapBurn,
        wrapperVolUsd: done.wrapVol,
        batchFeeUsd: done.batchFee,
        batchBurnUsd: done.batchBurn,
      };
      setSpec(full);
      setPoolUsd(done.pool);
      setFigSource("fresh");
      try {
        window.localStorage.setItem(CACHE_KEY, JSON.stringify({ spec: full, poolUsd: done.pool }));
      } catch {
        /* storage full — the page still works */
      }
    };
    const pull = async (path: string): Promise<Record<string, unknown>> => {
      for (let attempt = 0; ; attempt++) {
        try {
          const r = await fetch(path, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return (await r.json()) as Record<string, unknown>;
        } catch (e) {
          if (attempt >= 1) throw e;
        }
      }
    };
    pull(`/api/spectrum/charts?range=${range.spectrum}`)
      .then((d) => {
        if (!alive) return;
        const fs = (d.feeSplit ?? {}) as Partial<Record<DestKey, number>>;
        done.spec = {
          feeSplit: { ...ZERO_SPLIT, ...fs },
          auctionUsd: ((d.auctionEth as number) ?? 0) * ((d.ethUsd as number) ?? 0),
          basketsVolUsd:
            Array.isArray(d.buyVolumeUsd) && Array.isArray(d.sellVolumeUsd)
              ? sum(d.buyVolumeUsd as number[]) + sum(d.sellVolumeUsd as number[])
              : null,
          launchCount: Array.isArray(d.launchesEth)
            ? sum(d.launchesEth as number[]) + sum(d.launchesBase as number[]) + sum(d.launchesHood as number[])
            : null,
          batchVolUsd: Array.isArray(d.batchVolumeUsd) ? sum(d.batchVolumeUsd as number[]) : null,
        };
        setLane((l) => ({ ...l, spec: "ok" }));
        maybeFinish();
      })
      .catch(() => alive && setLane((l) => ({ ...l, spec: "failed" })));
    pull(`/api/charts?range=${range.charts}`)
      .then((d) => {
        if (!alive) return;
        done.pool = sum(d.feesUsd as number[]);
        done.poolVol = Array.isArray(d.poolVolumeUsd) ? sum(d.poolVolumeUsd as number[]) : null;
        done.bridge = (d.bridge as { pendingEth: number; nextBurnTs: number | null } | null) ?? null;
        done.wrapFee = Array.isArray(d.wrapperFeesUsd) ? sum(d.wrapperFeesUsd as number[]) : null;
        done.wrapBurn = Array.isArray(d.wrapperBurnUsd) ? sum(d.wrapperBurnUsd as number[]) : null;
        done.wrapVol = Array.isArray(d.wrapperVolumeUsd) ? sum(d.wrapperVolumeUsd as number[]) : null;
        done.batchFee = Array.isArray(d.batchFeesUsd) ? sum(d.batchFeesUsd as number[]) : null;
        done.batchBurn = Array.isArray(d.batchBurnUsd) ? sum(d.batchBurnUsd as number[]) : null;
        setLane((l) => ({ ...l, pool: "ok" }));
        maybeFinish();
      })
      .catch(() => alive && setLane((l) => ({ ...l, pool: "failed" })));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.spectrum, range.charts, retryNonce]);

  // "portfolio" has no beam lane yet (the berth is dark until the ceremony),
  // so batch events ride the wire as chips and open the detail like any other —
  // firePulse simply finds no in-lane and skips the animation
  const eventSource = (e: ActivityEvent) =>
    e.kind === "batch" || e.source === "wrapper"
      ? "portfolio" // two capture routes, one system, one lane
      : e.kind === "launch"
        ? "launch"
        : e.source === "prism-pool"
          ? "pool"
          : "baskets";
  const eventLabel = (e: ActivityEvent) => {
    if (e.kind === "batch") return `${e.usd != null ? fmtUsdFull(e.usd) + " " : ""}portfolio batch`;
    if (e.kind === "launch") return `${e.symbol ? `$${e.symbol}` : "basket"} launch`;
    if (e.source === "wrapper")
      return e.tradeUsd != null ? `${fmtUsd(e.tradeUsd)} wrapped swap` : e.tradeEth != null ? `Ξ${fmtEth(e.tradeEth)} wrapped swap` : "wrapped swap";
    if (e.source === "prism-pool") return `Ξ${fmtEth(e.eth)} swap`;
    if (e.tradeUsd != null) return `${fmtUsdFull(e.tradeUsd)} trade`;
    return "basket fee";
  };
  const eventUsd = (e: ActivityEvent) => e.tradeUsd ?? e.usd ?? 0;

  // ── the live feed: new events pulse immediately; the baseline REPLAYS ──
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const replayTimers: ReturnType<typeof setTimeout>[] = [];
    const relevant = (e: ActivityEvent) => e.kind === "fee" || e.kind === "launch" || e.kind === "batch";
    const tick = () =>
      fetch("/api/feed", { cache: "no-store" })
        .then((r) => r.json())
        .then((d: { events?: ActivityEvent[]; stats?: PulseStats | null }) => {
          if (!alive) return;
          if (d.stats) {
            setStats(d.stats);
            ethUsdRef.current = d.stats.ethUsd ?? 0;
          }
          if (!d.events) return;
          const rel = d.events.filter(relevant);
          if (seenIds.current === null) {
            seenIds.current = new Set(d.events.map((e) => e.id));
            setWire(rel.slice(0, 16));
            // Reduced motion: the animation loop never runs, so a queued replay
            // would never drain and the badge would say REPLAYING forever
            // (observed, 30s and counting). No theatre → straight to live.
            if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
              setMode("live");
              return;
            }
            // the opening: the last 8 real events stream in oldest → newest,
            // one per ~1.1s, through the same pulse machinery a live one uses
            const replay = rel.slice(0, 8).reverse();
            replay.forEach((e, i) => {
              replayTimers.push(
                setTimeout(() => {
                  if (!alive) return;
                  pulseQueue.current.push({ source: eventSource(e), label: eventLabel(e), usd: eventUsd(e), event: e });
                  setFresh(new Set([e.id]));
                }, 600 + i * 1100),
              );
            });
            // the LIVE badge flips when the queue has actually drained (the
            // animation loop owns that moment), not on a wall-clock guess
            replayTimers.push(setTimeout(() => (replayDone.current = true), 600 + replay.length * 1100));
            return;
          }
          const arrivals: ActivityEvent[] = [];
          for (const e of d.events) {
            if (seenIds.current.has(e.id)) continue;
            seenIds.current.add(e.id);
            if (!relevant(e)) continue;
            arrivals.push(e);
            pulseQueue.current.push({ source: eventSource(e), label: eventLabel(e), usd: eventUsd(e), event: e, live: true });
          }
          if (arrivals.length) {
            setWatched((v) => v + arrivals.length);
            setWire((w) => [...arrivals, ...w].slice(0, 16));
            setFresh(new Set(arrivals.map((e) => e.id)));
            setTimeout(() => alive && setFresh(new Set()), 1600);
            // A batch just delivered a fresh burn cut to its collector, so the
            // staged-burn chip must FOLLOW the batch onto the wire — not wait
            // out the 5-minute pipeline poll (the designer watched the $2,455 batch
            // arrive with no queue movement behind it, 2026-08-16). refresh()
            // busts the route's server cache, so one re-read is authoritative.
            if (arrivals.some((e) => e.kind === "batch")) refreshPipe();
          }
        })
        .catch(() => {});
    const loop = () => {
      if (typeof document === "undefined" || document.visibilityState !== "hidden") tick();
      timer = setTimeout(loop, 10_000);
    };
    loop();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      for (const t of replayTimers) clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── geometry: sources → THE PRISM → the spectrum fan ──
  const { ref: panelRef, size } = useSize();
  const model = useMemo(() => {
    if (!size) return null;
    // No figures yet (first-ever visit; the ~4s spectrum read still in
    // flight): the map renders IMMEDIATELY on neutral placeholder geometry —
    // equal lanes, dimmed beams, every figure a shimmer — so the prism and the
    // replay are alive from the first paint. Nothing numeric is invented: no
    // number or share pill renders until the real ones land.
    const pending = !spec || poolUsd == null;
    const F = pending
      ? { feeSplit: { holders: 1, burn: 1, creator: 1, interfaces: 1, league: 1 } as Record<DestKey, number>, auctionUsd: 0.5 }
      : spec;
    const P = pending ? 3 : poolUsd;
    const W = size.w;
    const H = size.h;
    const basketsUsd = Object.values(F.feeSplit).reduce((a, b) => a + b, 0);

    const rawFlows: { source: string; dest: DestKey; usd: number }[] = [
      { source: "pool", dest: "holders", usd: P * POOL_TO_HOLDERS },
      { source: "pool", dest: "burn", usd: P * POOL_TO_BURN },
      { source: "baskets", dest: "holders", usd: F.feeSplit.holders },
      { source: "baskets", dest: "creator", usd: F.feeSplit.creator },
      { source: "baskets", dest: "interfaces", usd: F.feeSplit.interfaces },
      { source: "baskets", dest: "league", usd: F.feeSplit.league },
      { source: "baskets", dest: "burn", usd: F.feeSplit.burn },
      { source: "launch", dest: "burn", usd: F.auctionUsd },
      // the portfolio system's two capture routes, ONE lane: burn cuts and
      // integrator remainders MEASURED off FeeCharged + BurnShareDelivered —
      // pending placeholders invent nothing here
      { source: "portfolio", dest: "burn", usd: pending ? 0 : (spec?.wrapperBurnUsd ?? 0) + (spec?.batchBurnUsd ?? 0) },
      {
        source: "portfolio",
        dest: "interfaces",
        usd: pending
          ? 0
          : Math.max(0, (spec?.wrapperFeeUsd ?? 0) - (spec?.wrapperBurnUsd ?? 0)) + Math.max(0, (spec?.batchFeeUsd ?? 0) - (spec?.batchBurnUsd ?? 0)),
      },
    ];
    const allFlows = rawFlows.filter((f) => f.usd > 0.005);
    const PROTOCOL_DESTS = new Set<DestKey>(["holders", "burn"]);
    const flows = protocolOnly ? allFlows.filter((f) => PROTOCOL_DESTS.has(f.dest)) : allFlows;
    // each source's FULL captured fee (both modes) — the fraction denominator
    // and, in protocol mode, the honest basis the shown share is a slice of
    const fullBySource = new Map<string, number>();
    for (const f of allFlows) fullBySource.set(f.source, (fullBySource.get(f.source) ?? 0) + f.usd);
    const shownBySource = new Map<string, number>();
    for (const f of flows) shownBySource.set(f.source, (shownBySource.get(f.source) ?? 0) + f.usd);

    // the traded volume beside each fee (the designer, 2026-08-15) — null means the
    // window has no measured figure, and the card shows nothing rather than a
    // zero it never measured
    const volOf = (v: number | null | undefined) => (pending || v == null ? null : `${fmtUsd(v)} vol`);
    const launchVol =
      pending || spec?.launchCount == null ? null : `${spec.launchCount} launch${spec.launchCount === 1 ? "" : "es"}`;
    const sources = [
      { key: "pool", label: "PRISM pool", caption: "Swap fees on the token", usd: (shownBySource.get("pool") ?? 0) as number | null, vol: volOf(spec?.poolVolUsd), live: true, href: undefined as string | undefined },
      { key: "baskets", label: "Spectrum baskets", caption: "Trade fees, three chains", usd: (shownBySource.get("baskets") ?? 0) as number | null, vol: volOf(spec?.basketsVolUsd), live: true, href: "/spectrum" },
      { key: "launch", label: "Basket launches", caption: "Flat launch fees", usd: (shownBySource.get("launch") ?? 0) as number | null, vol: launchVol, live: true, href: undefined as string | undefined },

      // the berth's fee stream stays dark until its ceremony, but batch VOLUME
      // through the watch is measured — the vol line shows on real traffic
      {
        key: "portfolio",
        label: "Spectrum Portfolio",
        // ONE system, two fee-capture routes (the designer 2026-08-16): batches
        // through the batcher + wrapped swaps through the fee wrapper. The
        // card lights the moment either route captures a fee; volume sums both.
        caption: "Batched buys + wrapped swaps",
        // a NUMBER even while pending (0 → the shimmer path), so this card can
        // never flash "not on-chain yet" — the system IS on-chain now
        usd: (pending ? 0 : (shownBySource.get("portfolio") ?? 0)) as number | null,
        vol: volOf((spec?.batchVolUsd ?? 0) + (spec?.wrapperVolUsd ?? 0) || null),
        live: !pending && (spec?.wrapperFeeUsd ?? 0) + (spec?.batchFeeUsd ?? 0) > 0,
        href: "/portfolio",
      },
      { key: "lightrunner", label: "Lightrunner", caption: "Its league lands on-chain soon", usd: null, vol: null as string | null, live: false, href: "https://playlightrunner.com" },
    ];
    const destTotals = new Map<DestKey, number>();
    for (const f of flows) destTotals.set(f.dest, (destTotals.get(f.dest) ?? 0) + f.usd);
    const grand = [...destTotals.values()].reduce((a, b) => a + b, 0);
    const shown = DEST.filter((d) => (destTotals.get(d.key) ?? 0) > 0.005);

    // columns
    const SRC_W = Math.max(206, Math.min(258, W * 0.18));
    const DST_W = Math.max(232, Math.min(304, W * 0.2));
    const SRC_X = 20 + SRC_W; // right edge of source cards
    const DST_X = W - DST_W - 20; // left edge of destination cards
    const TOP = 26;
    const BOTTOM = 22;
    const usable = H - TOP - BOTTOM;

    // THE PRISM — the centerpiece, sized to the panel
    // Bigger centrepiece (the designer, 2026-08-15). Capped by the GAP between the two
    // card columns as well as by height, so growing it can never crowd the
    // beams or collide with a card on a narrow panel — the cap binds at the
    // 1080px minimum width, the height term binds on a tall screen.
    const PR = Math.max(100, Math.min(190, H * 0.24, (DST_X - SRC_X) * 0.245));
    // The prism is the card's centrepiece, so it sits on the card's true
    // horizontal centre — not at a fraction of the gap between the columns,
    // which put it left of centre because the two columns are different widths
    // (the designer, 2026-08-15). The headline above it reads from this same value, so
    // the two can never drift apart again.
    const PX = W / 2;
    const PY = TOP + usable * 0.5;
    const prism = {
      cx: PX,
      cy: PY,
      r: PR,
      // apex-up triangle, the classic refraction cut
      points: `${PX},${PY - PR} ${PX - PR * 0.92},${PY + PR * 0.62} ${PX + PR * 0.92},${PY + PR * 0.62}`,
      inX: PX - PR * 0.5,
      outX: PX + PR * 0.5,
    };

    // Even rails (the designer, 2026-08-15): every card in a column is the SAME size —
    // the beam thickness and the figures carry the magnitudes, so the cards
    // don't have to (the old flow-proportional fit pass made the columns read
    // ragged). Heights are capped so a tall panel grows the SPACING between
    // cards, never the glass (a huge card with two centred lines reads EMPTY);
    // the leftover spreads as even gaps so each column still fills top to bottom.
    const GAP = Math.max(12, usable * 0.024);
    const live = sources.filter((s) => s.usd != null);
    const rail = (n: number, cap: number) => {
      const h = Math.min(cap, (usable - GAP * (n - 1)) / Math.max(n, 1));
      return { h, gap: n > 1 ? (usable - n * h) / (n - 1) : 0 };
    };
    const srcRail = rail(sources.length, 118);
    let y = TOP;
    const srcPos = new Map<string, { y0: number; y1: number }>();
    for (const s of sources) {
      srcPos.set(s.key, { y0: y, y1: y + srcRail.h });
      y += srcRail.h + srcRail.gap;
    }
    const dstRail = rail(shown.length, 132);
    let yd = TOP;
    const dstPos = new Map<DestKey, { y0: number; y1: number }>();
    for (const d of shown) {
      dstPos.set(d.key, { y0: yd, y1: yd + dstRail.h });
      yd += dstRail.h + dstRail.gap;
    }

    // beams — thickness carries a CAP; the numbers carry the magnitude
    const thickOf = (usd: number) => Math.max(2.5, Math.min(22, Math.pow(Math.max(usd, 0.01), 0.32) * 2.6));
    // A dead-straight beam reads as a wire, not light. Lanes whose endpoints
    // are nearly level get a gentle bow away from the midline instead.
    const bowFor = (dy: number) => (Math.abs(dy) >= 44 ? 0 : (dy >= 0 ? 1 : -1) * (26 - Math.abs(dy) * 0.45) * -1);
    const inBeams = live.map((s) => {
      const p = srcPos.get(s.key)!;
      const y0 = (p.y0 + p.y1) / 2;
      const mx = SRC_X + (prism.inX - SRC_X) * 0.55;
      const bow = bowFor(prism.cy - y0);
      return {
        key: s.key,
        thick: thickOf(s.usd!),
        // a source that earned nothing in the window keeps its filament (a live
        // pulse can still ride it) but reads COLD: dimmed, no shimmer, no dots
        cold: s.usd! <= 0.005,
        y0,
        path: `M ${SRC_X} ${y0} C ${mx} ${y0 + bow}, ${mx} ${prism.cy + bow}, ${prism.inX} ${prism.cy}`,
      };
    });
    // (The old hand-added cold portfolio filament is gone: since the 2026-08-16
    // fold gave the portfolio source a MEASURED figure, it rides the general
    // loop above — which had left this block pushing a DUPLICATE beam under
    // the same key. The general cold rule is the honest one: dim until the
    // window actually measured a fee.)
    const outBeams = shown.map((d, i) => {
      const p = dstPos.get(d.key)!;
      const y1 = (p.y0 + p.y1) / 2;
      // the fan leaves the prism's right face at spread heights, like a split ray
      const spread = prism.cy - PR * 0.52 + (PR * 1.04 * (i + 0.5)) / shown.length;
      const mx = prism.outX + (DST_X - prism.outX) * 0.5;
      const bow = bowFor(y1 - spread);
      return {
        key: d.key,
        color: DEST.find((x) => x.key === d.key)!.color,
        usd: destTotals.get(d.key)!,
        share: grand > 0 ? destTotals.get(d.key)! / grand : 0,
        thick: thickOf(destTotals.get(d.key)!),
        y1,
        path: `M ${prism.outX} ${spread} C ${mx} ${spread + bow}, ${mx} ${y1 + bow}, ${DST_X} ${y1}`,
      };
    });

    // per-source split shares, for the fragment sizes when a pulse refracts
    const splitOf = new Map<string, { dest: DestKey; frac: number }[]>();
    for (const s of live) {
      const own = flows.filter((f) => f.source === s.key);
      // denominator = the source's FULL captured fee, so a filtered lane's
      // fragment vanishes instead of inflating its siblings
      const total = fullBySource.get(s.key) ?? 0;
      splitOf.set(
        s.key,
        own.map((f) => ({ dest: f.dest, frac: total > 0 ? f.usd / total : 0 })),
      );
    }

    if (pending) splitOf.clear(); // a pulse still flies and flashes, but never fragments on invented shares
    return { W, H, SRC_W, DST_W, SRC_X, DST_X, prism, sources, srcPos, dstPos, shown, destTotals, grand, inBeams, outBeams, splitOf, pending };
  }, [spec, poolUsd, size, protocolOnly]);

  // ── the light: ambient shimmer + labeled pulses that refract at the prism ──
  const svgRef = useRef<SVGSVGElement>(null);
  const dotLayer = useRef<SVGGElement>(null);
  const flashRef = useRef<SVGCircleElement>(null);
  useEffect(() => {
    if (!model || typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const svg = svgRef.current;
    const layer = dotLayer.current;
    if (!svg || !layer) return;
    const NS = "http://www.w3.org/2000/svg";

    const sample = (sel: string) =>
      [...svg.querySelectorAll<SVGPathElement>(sel)].map((p) => {
        const total = p.getTotalLength();
        const pts: { x: number; y: number }[] = [];
        for (let i = 0; i <= 56; i++) pts.push(p.getPointAtLength((total * i) / 56));
        return { key: p.dataset.key!, pts };
      });
    const inLanes = sample("path[data-in]");
    const outLanes = sample("path[data-out]");
    const outMeta = new Map<string, (typeof model.outBeams)[number]>(model.outBeams.map((b) => [b.key, b]));
    const at = (pts: { x: number; y: number }[], t: number) => {
      const f = Math.min(0.9999, Math.max(0, t)) * (pts.length - 1);
      const i0 = Math.floor(f);
      const u = f - i0;
      const p0 = pts[i0];
      const p1 = pts[Math.min(i0 + 1, pts.length - 1)];
      return { x: p0.x + (p1.x - p0.x) * u, y: p0.y + (p1.y - p0.y) * u };
    };

    // ambient shimmer: small dim dots riding every beam, count ∝ share
    type Ambient = { lane: { pts: { x: number; y: number }[] }; t: number; speed: number; el: SVGCircleElement };
    const ambient: Ambient[] = [];
    const seedAmbient = (lane: { pts: { x: number; y: number }[] }, color: string, n: number, dim: number) => {
      for (let k = 0; k < n; k++) {
        const el = document.createElementNS(NS, "circle");
        el.setAttribute("fill", color);
        el.setAttribute("opacity", String(dim));
        el.setAttribute("r", "1.7");
        layer.appendChild(el);
        ambient.push({ lane, t: k / n, speed: 0.07 + (k % 3) * 0.018, el });
      }
    };
    const coldIn = new Set(model.inBeams.filter((b) => b.cold).map((b) => b.key));
    inLanes.forEach((l) => {
      if (!coldIn.has(l.key)) seedAmbient(l, "#e2e8f0", 3, 0.28);
    });
    outLanes.forEach((l) => seedAmbient(l, outMeta.get(l.key)!.color, Math.max(2, Math.round(outMeta.get(l.key)!.share * 10)), 0.4));

    // pulses: in-leg (white, labeled) → prism flash → out fragments
    type Pulse = {
      lane: { pts: { x: number; y: number }[] };
      t: number;
      speed: number;
      r: number;
      el: SVGCircleElement;
      halo: SVGCircleElement;
      label?: SVGTextElement;
      hit?: SVGCircleElement;
      onDone: () => void;
    };
    const pulses: Pulse[] = [];
    const mkPulse = (
      lane: { pts: { x: number; y: number }[] },
      color: string,
      r: number,
      label: string | null,
      speed: number,
      onDone: () => void,
      event?: ActivityEvent,
    ) => {
      if (pulses.length > 40) return; // a busy minute must not melt the page
      const halo = document.createElementNS(NS, "circle");
      halo.setAttribute("fill", color);
      halo.setAttribute("opacity", "0.25");
      layer.appendChild(halo);
      const el = document.createElementNS(NS, "circle");
      el.setAttribute("fill", "#ffffff");
      el.setAttribute("opacity", "0.98");
      layer.appendChild(el);
      let text: SVGTextElement | undefined;
      if (label) {
        text = document.createElementNS(NS, "text");
        text.textContent = label;
        text.setAttribute("fill", "#e2e8f0");
        text.setAttribute("font-size", "11");
        text.setAttribute("font-family", MONO);
        text.setAttribute("paint-order", "stroke");
        text.setAttribute("stroke", "rgba(0,0,0,0.85)");
        text.setAttribute("stroke-width", "3");
        layer.appendChild(text);
      }
      // A 3px dot is not a click target. An invisible generous circle rides with
      // it and opens the transaction's detail — that is the hit area, and it is
      // the only element in the layer that takes pointer events.
      let hit: SVGCircleElement | undefined;
      if (event) {
        hit = document.createElementNS(NS, "circle");
        hit.setAttribute("fill", "transparent");
        hit.style.cursor = "pointer";
        hit.style.pointerEvents = "all";
        hit.addEventListener("click", () => openDetail.current(event));
        const title = document.createElementNS(NS, "title");
        title.textContent = `${label ?? "transaction"} — open the details`;
        hit.appendChild(title);
        layer.appendChild(hit);
      }
      pulses.push({ lane, t: 0, speed, r, el, halo, label: text, hit, onDone });
    };
    const flash = () => flashRef.current?.setAttribute("opacity", "0.9");
    const firePulse = (seed: PulseSeed) => {
      const inLane = inLanes.find((l) => l.key === seed.source);
      if (!inLane) return;
      const r = 3 + Math.min(3, Math.log10(seed.usd + 1) * 1.6);
      // What actually SPLITS at the prism is the transaction's FEE, never its
      // size (a Ξ0.4 swap splits its Ξ0.004 fee) — so the fragments' labels
      // estimate feeUsd × the lane's measured share, marked ≈ because a
      // single event rides the window's fractions (the designer, 2026-08-15).
      const ev = seed.event;
      const feeUsd = !ev
        ? 0
        : ev.kind === "launch"
          ? (ev.eth ?? 0) * ethUsdRef.current
          : ev.kind === "fee"
            ? ev.source === "wrapper"
              ? // stable-priced wrapped swaps carry feeUsd directly; native
                // ones price their ETH fee at spot
                (ev.feeUsd ?? (ev.eth ?? 0) * ethUsdRef.current)
              : ev.source === "prism-pool"
                ? (ev.eth ?? 0) * ethUsdRef.current
                : (ev.usd ?? 0)
            : ev.kind === "batch"
              ? (ev.feeUsd ?? 0)
              : 0;
      // A batch's split is MEASURED per transaction (BurnShareDelivered vs its
      // fee), so its pulse may fragment honestly: the burn share plus the
      // integrator remainder. A batch without a delivered burn share still
      // flies whole — nothing is invented (the ruled split is the open q-158).
      const parts =
        ev?.kind === "batch"
          ? ev.burnUsd != null && ev.feeUsd != null && ev.feeUsd > 0 && ev.burnUsd > 0
            ? [
                { dest: "burn" as DestKey, frac: Math.min(1, ev.burnUsd / ev.feeUsd) },
                { dest: "interfaces" as DestKey, frac: Math.max(0, 1 - ev.burnUsd / ev.feeUsd) },
              ]
            : []
          : ev?.source === "wrapper"
            ? feeUsd > 0
              ? (() => {
                  // MEASURED per event when the feed carries the burn cut —
                  // USD-priced (stable leg) first, then native-priced, then
                  // the event's own generation flag, and the 7/8 constant
                  // ONLY for old events that predate every measured field
                  const frac =
                    ev.burnUsd != null && ev.feeUsd != null && ev.feeUsd > 0
                      ? Math.min(1, ev.burnUsd / ev.feeUsd)
                      : ev.burnEth != null && ev.eth != null && ev.eth > 0
                        ? Math.min(1, ev.burnEth / ev.eth)
                        : ev.wholeFeeBurn
                          ? 1
                          : WRAPPER_BURN_SHARE;
                  return [
                    { dest: "burn" as DestKey, frac },
                    ...(frac < 1 ? [{ dest: "interfaces" as DestKey, frac: 1 - frac }] : []),
                  ];
                })()
              : []
            : (model.splitOf.get(seed.source) ?? []);
      // only the parts that will actually FLY may move the figures — a part
      // whose lane is hidden would be debited and never repaid
      const flights = parts.filter((p) => p.frac > 0 && feeUsd * p.frac > 0 && outLanes.some((l) => l.key === p.dest));
      // REWIND THEN REPLAY (the designer, 2026-08-16: the numbers should count up on
      // past activity too): a replayed event is already inside the measured
      // window figures, so its fragments are DEBITED the moment its pulse
      // launches and credited back as each one lands — the cards climb with
      // the theatre and finish exactly at the measured truth. A live event
      // debits nothing, so its landings are pure gains.
      if (!seed.live) {
        for (const part of flights) creditDest.current(part.dest, -(feeUsd * part.frac));
      }
      mkPulse(
        inLane,
        "#ffffff",
        r,
        seed.label,
        0.42,
        () => {
        flash();
        for (const part of flights) {
          const lane = outLanes.find((l) => l.key === part.dest)!;
          const fragUsd = feeUsd * part.frac;
          mkPulse(
            lane,
            outMeta.get(part.dest)!.color,
            Math.max(2, r * Math.sqrt(part.frac)),
            fragUsd > 0.0005 ? `≈${fmtUsd(fragUsd)}` : null,
            0.5,
            // every landing ticks its card up — a replayed one repays its
            // rewind debit, a live one is a pure gain
            () => creditDest.current(part.dest, fragUsd),
            seed.event,
          );
        }
        },
        seed.event,
      );
    };

    let raf = 0;
    let last = performance.now();
    // Pulses are METERED, one every 650ms, never spliced wholesale: the model
    // mounts seconds after the feed baseline on a cold load, so the whole
    // replay queue would otherwise land on the first frame as a stampede of
    // overlapping labels. Metering also spaces a busy live poll into a stream.
    let lastFire = 0;
    const step = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); // never negative — the v2 lesson
      last = now;
      if (pulseQueue.current.length && now - lastFire > 650) {
        lastFire = now;
        firePulse(pulseQueue.current.shift()!);
      }
      if (replayDone.current && pulseQueue.current.length === 0 && pulses.length === 0) {
        replayDone.current = false;
        setMode("live");
      }
      for (const a of ambient) {
        a.t += a.speed * dt;
        if (a.t >= 1) a.t -= 1;
        const p = at(a.lane.pts, a.t);
        a.el.setAttribute("cx", String(p.x));
        a.el.setAttribute("cy", String(p.y));
      }
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.t += p.speed * dt;
        if (p.t >= 1) {
          p.el.remove();
          p.halo.remove();
          p.label?.remove();
          p.hit?.remove();
          const done = p.onDone;
          pulses.splice(i, 1);
          done();
          continue;
        }
        const pos = at(p.lane.pts, p.t);
        p.el.setAttribute("cx", String(pos.x));
        p.el.setAttribute("cy", String(pos.y));
        p.el.setAttribute("r", String(p.r));
        p.halo.setAttribute("cx", String(pos.x));
        p.halo.setAttribute("cy", String(pos.y));
        p.halo.setAttribute("r", String(p.r * 3.4));
        if (p.label) {
          p.label.setAttribute("x", String(pos.x + p.r + 7));
          p.label.setAttribute("y", String(pos.y - p.r - 5));
        }
        if (p.hit) {
          p.hit.setAttribute("cx", String(pos.x));
          p.hit.setAttribute("cy", String(pos.y));
          p.hit.setAttribute("r", String(Math.max(14, p.r * 4)));
        }
      }
      const f = flashRef.current;
      if (f) {
        const o = Number(f.getAttribute("opacity") || "0");
        if (o > 0.01) f.setAttribute("opacity", String(o * Math.pow(0.03, dt)));
      }
      raf = requestAnimationFrame(step);
    };
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (document.visibilityState !== "hidden") {
        last = performance.now();
        raf = requestAnimationFrame(step);
      }
    };
    raf = requestAnimationFrame(step);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
      layer.replaceChildren();
    };
  }, [model]);

  const pctOf = (usd: number) => {
    if (!model || model.pending || model.grand + boostSum <= 0) return "";
    const p = (usd / (model.grand + boostSum)) * 100;
    if (p < 0.01) return "<0.01%";
    return `${p.toFixed(p >= 1 ? 1 : 2)}%`;
  };
  const wireColor = (e: ActivityEvent) =>
    e.kind === "batch"
      ? C.indigo
      : e.kind === "launch"
        ? C.orange
        : e.source === "wrapper"
          ? "#c06aff"
          : e.source === "prism-pool"
            ? C.green
            : C.cyan;
  const shimmer = (w: string, h = "h-6") => <span className={`inline-block ${h} ${w} animate-pulse rounded bg-white/10 align-middle`} />;

  return (
    <main className="relative z-10 w-full space-y-4 px-4 pb-14 pt-4 sm:px-6 sm:pt-5">
      {/* ── header ── */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">The money map</h1>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-slate-400">
            Fees enter as light. The prism splits them to everyone they belong to.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {/* the two combined crank totals, pressable in place (the designer, 2026-08-16) */}
          <CrankTotalsButtons />
          {/* the station plays over the map (the designer, 2026-08-15) */}
          <StartRadioButton />
          <div className="flex gap-1" role="group" aria-label="Fee lens">
            {[
              { key: false, label: "All fees", title: "Every lane the fees split into, participant payouts included." },
              {
                key: true,
                label: "Protocol",
                title: "Only the lanes that accrue to PRISM itself: holders and the burn. Creators, interfaces and the league are participant payouts.",
              },
            ].map((m) => (
              <button
                key={m.label}
                type="button"
                onClick={() => setProtocolOnly(m.key)}
                aria-pressed={protocolOnly === m.key}
                title={m.title}
                className="rounded px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/60"
                style={
                  protocolOnly === m.key
                    ? { background: `${C.orange}26`, color: C.orange, border: `1px solid ${C.orange}4d` }
                    : { color: "#5b6572", border: "1px solid rgba(255,255,255,0.08)" }
                }
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRangeKey(r.key)}
                aria-pressed={rangeKey === r.key}
                className="rounded px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/60"
                style={
                  rangeKey === r.key
                    ? { background: `${C.cyan}26`, color: C.cyan, border: `1px solid ${C.cyan}4d` }
                    : { color: "#5b6572", border: "1px solid rgba(255,255,255,0.08)" }
                }
              >
                {r.key}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── the map ── */}
      <div
        className="relative overflow-x-auto overflow-y-hidden rounded-2xl border border-white/10"
        style={{
          background: "radial-gradient(120% 130% at 44% 42%, rgba(20,26,44,0.85) 0%, rgba(6,8,16,0.92) 46%, #02030a 100%)",
          boxShadow: "0 16px 56px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)",
          scrollbarWidth: "thin",
        }}
      >
        <div ref={panelRef} className="relative" style={{ minWidth: 1080, width: "100%", height: "clamp(560px, calc(100vh - 292px), 940px)" }}>
          {/* the headline: what the prism refracted this window, center stage.
              The mode badge + figure-freshness chip live UNDER it — the old
              top-right anchor put them on top of the first destination card
              once the columns became even rails (the designer, 2026-08-15). The
              centre above the prism apex is the one zone no card can reach. */}
          {model && (
            <div
              className="pointer-events-none absolute top-5 z-10 -translate-x-1/2 text-center"
              style={{ left: model.prism.cx }}
            >
              <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-500">{protocolOnly ? "The protocol\u2019s share" : "Refracted"} · {range.label}</div>
              {/* the pills sit ABOVE the number (the designer, 2026-08-16 — under it
                  they unbalanced the centre against the card columns) */}
              <div className="pointer-events-auto mt-2 flex items-center justify-center gap-2">
                {/* the mode badge — the theatre says which truth it is showing */}
                <div className="flex items-center gap-2 rounded-full border px-3 py-1" style={{ borderColor: "rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.5)" }}>
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: mode === "live" ? C.green : C.cyan }} />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: mode === "live" ? C.green : C.cyan }} />
                  </span>
                  <span className="text-[9px] font-bold uppercase tracking-[0.18em]" style={{ color: mode === "live" ? C.green : C.cyan }}>
                    {mode === "live" ? "Live · watching the chain" : "Replaying recent activity"}
                  </span>
                </div>
                {/* figure freshness, beside it */}
                {(model.pending || figSource === "cache" || lane.spec === "failed" || lane.pool === "failed") && (
                  <div className="flex items-center gap-2 rounded-full border px-3 py-1" style={{ borderColor: "rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.5)" }}>
                    {lane.spec === "failed" || lane.pool === "failed" ? (
                      <>
                        <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-red-300">
                          {figSource === "cache" ? "refresh failed · showing your last visit" : "figure read failed"}
                        </span>
                        <button type="button" onClick={() => setRetryNonce((n) => n + 1)} className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-300 underline hover:text-white">
                          retry
                        </button>
                      </>
                    ) : (
                      <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">
                        {model.pending ? "reading the chain…" : "figures from your last visit · refreshing…"}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="mt-1.5 text-5xl font-black tracking-tight text-white" style={glow(C.cyan)}>
                {model.pending ? shimmer("w-40", "h-10") : <CountUp value={Math.max(0, model.grand + boostSum)} render={fmtUsd} />}
              </div>
            </div>
          )}

          {/* atmosphere: a fixed starfield and three colour blooms — the void
              between the columns was reading as dead space */}
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            <div className="absolute left-[26%] top-[58%] h-[46%] w-[26%] rounded-full blur-[130px]" style={{ background: `${C.cyan}0e` }} />
            <div className="absolute right-[18%] top-[6%] h-[38%] w-[22%] rounded-full blur-[120px]" style={{ background: `${C.green}0d` }} />
            <div className="absolute bottom-[4%] right-[22%] h-[34%] w-[20%] rounded-full blur-[120px]" style={{ background: `${C.orange}10` }} />
          </div>
          {!model ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-slate-500">
              {lane.spec === "failed" || lane.pool === "failed" ? (
                <>
                  <span className="text-red-300">
                    {lane.spec === "failed" ? "The basket-split read failed." : "The pool-fee read failed."} Nothing is invented in its place.
                  </span>
                  <button
                    type="button"
                    onClick={() => setRetryNonce((n) => n + 1)}
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white"
                  >
                    Try again
                  </button>
                </>
              ) : (
                <>
                  <span>Focusing the light…</span>
                  <span className="text-[11px] text-slate-600" style={{ fontFamily: MONO }}>
                    basket splits {lane.spec} · pool fees {lane.pool}
                  </span>
                </>
              )}
            </div>
          ) : (
            <>
              <svg ref={svgRef} width={model.W} height={model.H} className="absolute inset-0">
                <defs>
                  <filter id="mm-soft" x="-40%" y="-40%" width="180%" height="180%">
                    <feGaussianBlur stdDeviation="5" />
                  </filter>
                  <filter id="mm-grain">
                    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
                    <feColorMatrix type="saturate" values="0" />
                  </filter>
                  <linearGradient id="mm-white" gradientUnits="userSpaceOnUse" x1={model.SRC_X} x2={model.prism.inX} y1="0" y2="0">
                    <stop offset="0%" stopColor="#94a3b8" stopOpacity="0.14" />
                    <stop offset="70%" stopColor="#e2e8f0" stopOpacity="0.44" />
                    <stop offset="100%" stopColor="#ffffff" stopOpacity="0.9" />
                  </linearGradient>
                  {model.outBeams.map((b) => (
                    <linearGradient key={b.key} id={`mm-out-${b.key}`} gradientUnits="userSpaceOnUse" x1={model.prism.outX} x2={model.DST_X} y1="0" y2="0">
                      <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
                      <stop offset="10%" stopColor={b.color} stopOpacity="0.88" />
                      <stop offset="100%" stopColor={b.color} stopOpacity="0.42" />
                    </linearGradient>
                  ))}
                  <linearGradient id="mm-glass" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="0.3" />
                    <stop offset="40%" stopColor="#8b9cf7" stopOpacity="0.12" />
                    <stop offset="100%" stopColor="#0b1020" stopOpacity="0.66" />
                  </linearGradient>
                  {/* the brand's seven bands, smeared along the prism's base — the
                      caustic a real prism throws */}
                  {/* userSpaceOnUse is load-bearing: a gradient with default
                      objectBoundingBox units on a HORIZONTAL LINE has a
                      zero-height bbox and paints nothing at all — the caustic
                      was invisible in every shot until this. */}
                  <linearGradient
                    id="mm-caustic"
                    gradientUnits="userSpaceOnUse"
                    x1={model.prism.cx - model.prism.r * 0.86}
                    y1="0"
                    x2={model.prism.cx + model.prism.r * 0.86}
                    y2="0"
                  >
                    {["#ff5a5a", "#ff9f45", "#ffe14d", "#5cff8f", "#3bd9ff", "#7c8bff", "#c06aff"].map((c, i) => (
                      <stop key={c} offset={`${(i / 6) * 100}%`} stopColor={c} stopOpacity="0.8" />
                    ))}
                  </linearGradient>
                  <linearGradient id="mm-wedge" gradientUnits="userSpaceOnUse" x1={model.prism.inX} x2={model.prism.outX} y1="0" y2="0">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
                    <stop offset="45%" stopColor="#ffffff" stopOpacity="0.16" />
                    <stop offset="100%" stopColor="#ffffff" stopOpacity="0.05" />
                  </linearGradient>
                  <linearGradient id="mm-edge" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
                    <stop offset="55%" stopColor="#9db2ff" stopOpacity="0.5" />
                    <stop offset="100%" stopColor="#3bd9ff" stopOpacity="0.7" />
                  </linearGradient>
                </defs>

                {/* film grain: a static noise wash that also kills the banding a
                    dark radial gradient always shows */}
                <rect width={model.W} height={model.H} filter="url(#mm-grain)" opacity="0.05" />
                {/* HUD corner ticks — the command-deck viewport language */}
                {(() => {
                  const t = 16;
                  const m = 10;
                  const cs = [
                    `M ${m + t} ${m} H ${m} V ${m + t}`,
                    `M ${model.W - m - t} ${m} H ${model.W - m} V ${m + t}`,
                    `M ${m + t} ${model.H - m} H ${m} V ${model.H - m - t}`,
                    `M ${model.W - m - t} ${model.H - m} H ${model.W - m} V ${model.H - m - t}`,
                  ];
                  return cs.map((d, i) => <path key={i} d={d} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="1.5" />);
                })()}
                {/* the starfield: deterministic, so every visit is the same sky */}
                <g aria-hidden>
                  {Array.from({ length: 54 }, (_, i) => {
                    // >>> not >>: signed shift turned every h ≥ 2^31 negative,
                    // which gave ~half the stars a negative radius (console
                    // error, never drawn), an off-canvas y and negative opacity
                    const h = (i * 2654435761) % 2 ** 32;
                    const x = (h % 1000) / 1000;
                    const y = ((h >>> 10) % 1000) / 1000;
                    const r = 0.5 + ((h >>> 20) % 10) / 11;
                    return <circle key={i} cx={x * model.W} cy={y * model.H} r={r} fill="#e2e8f0" opacity={0.05 + ((h >>> 6) % 10) / 40} />;
                  })}
                </g>
                {/* orbit rings around the prism — the deck's revenue-core language */}
                <circle cx={model.prism.cx} cy={model.prism.cy} r={model.prism.r * 1.55} fill="none" stroke="rgba(255,255,255,0.08)" strokeDasharray="3 7" />
                <circle cx={model.prism.cx} cy={model.prism.cy} r={model.prism.r * 2.05} fill="none" stroke="rgba(255,255,255,0.045)" strokeDasharray="1 11" />

                {/* in-beams: white light as a neon tube — soft glow, gradient
                    body, and a thin marching core (ms-beam-flow is the site's
                    own dash-march, already covered by the reduced-motion block) */}
                {model.inBeams.map((b) => (
                  <g key={b.key} opacity={model.pending ? 0.4 : b.cold ? 0.3 : 1}>
                    {!b.cold && (
                      <>
                        <path d={b.path} fill="none" stroke="#e2e8f0" strokeWidth={b.thick + 18} strokeOpacity={0.035} filter="url(#mm-soft)" />
                        <path d={b.path} fill="none" stroke="#e2e8f0" strokeWidth={b.thick + 7} strokeOpacity={0.08} filter="url(#mm-soft)" />
                      </>
                    )}
                    <path data-in="" data-key={b.key} d={b.path} fill="none" stroke="url(#mm-white)" strokeWidth={b.thick} strokeLinecap="round" />
                    {!b.cold && (
                      <path
                        d={b.path}
                        fill="none"
                        stroke="#ffffff"
                        strokeWidth={Math.min(1.6, b.thick * 0.4)}
                        strokeOpacity={0.7}
                        strokeLinecap="round"
                        strokeDasharray="10 18"
                        style={{ animation: "ms-beam-flow 1.6s linear infinite" }}
                      />
                    )}
                  </g>
                ))}
                {/* exit ports: the light physically leaves each live source */}
                {model.inBeams.filter((b) => !b.cold).map((b) => (
                  <g key={`port-${b.key}`}>
                    <circle cx={model.SRC_X} cy={b.y0} r="8" fill="#ffffff" opacity="0.16" filter="url(#mm-soft)" />
                    <circle cx={model.SRC_X} cy={b.y0} r="2.8" fill="#ffffff" opacity="0.85" />
                  </g>
                ))}
                {/* out-beams: the spectrum fan, same tube treatment in color */}
                {model.outBeams.map((b) => (
                  <g key={b.key} opacity={model.pending ? 0.5 : 1}>
                    <path d={b.path} fill="none" stroke={b.color} strokeWidth={b.thick + 20} strokeOpacity={0.06} filter="url(#mm-soft)" />
                    <path d={b.path} fill="none" stroke={b.color} strokeWidth={b.thick + 8} strokeOpacity={0.14} filter="url(#mm-soft)" />
                    <path data-out="" data-key={b.key} d={b.path} fill="none" stroke={`url(#mm-out-${b.key})`} strokeWidth={b.thick} strokeLinecap="round">
                      <title>{`${DEST.find((d) => d.key === b.key)?.label}: ${fmtUsd(b.usd)} · ${pctOf(b.usd)}`}</title>
                    </path>
                    <path
                      d={b.path}
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth={Math.min(1.4, b.thick * 0.35)}
                      strokeOpacity={0.5}
                      strokeLinecap="round"
                      strokeDasharray="8 22"
                      style={{ animation: `ms-beam-flow ${1.3 + 0.9 * (1 - b.share)}s linear infinite` }}
                    />
                  </g>
                ))}

                {/* sockets: each beam plugs into its card in its own colour */}
                {model.outBeams.map((b) => (
                  <g key={`sock-${b.key}`}>
                    <circle cx={model.DST_X} cy={b.y1} r="9" fill={b.color} opacity="0.2" filter="url(#mm-soft)" />
                    <circle cx={model.DST_X} cy={b.y1} r="2.8" fill={b.color} opacity="0.95" />
                  </g>
                ))}
                {/* THE PRISM — glass with facets, a breathing aura, and the
                    caustic its base would really throw */}
                <g>
                  {/* aura: two blurred layers breathing slowly (mm-breathe is in
                      the reduced-motion attribute block) */}
                  <circle
                    cx={model.prism.cx}
                    cy={model.prism.cy}
                    r={model.prism.r * 1.28}
                    fill="#8b9cf7"
                    opacity="0.09"
                    filter="url(#mm-soft)"
                    style={{ animation: "mm-breathe 5.5s ease-in-out infinite" }}
                  />
                  <circle cx={model.prism.cx} cy={model.prism.cy} r={model.prism.r * 0.62} fill="#ffffff" opacity="0.05" filter="url(#mm-soft)" />
                  <polygon points={model.prism.points} fill="url(#mm-glass)" stroke="url(#mm-edge)" strokeWidth="1.6" strokeLinejoin="round" />
                  <polygon points={model.prism.points} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="7" filter="url(#mm-soft)" strokeLinejoin="round" />
                  {/* facets: the apex line and an inset ghost triangle give the glass its cut */}
                  <line
                    x1={model.prism.cx}
                    y1={model.prism.cy - model.prism.r}
                    x2={model.prism.cx}
                    y2={model.prism.cy + model.prism.r * 0.62}
                    stroke="#ffffff"
                    strokeOpacity="0.1"
                  />
                  <polygon
                    points={`${model.prism.cx},${model.prism.cy - model.prism.r * 0.72} ${model.prism.cx - model.prism.r * 0.66},${model.prism.cy + model.prism.r * 0.44} ${model.prism.cx + model.prism.r * 0.66},${model.prism.cy + model.prism.r * 0.44}`}
                    fill="none"
                    stroke="#ffffff"
                    strokeOpacity="0.07"
                    strokeLinejoin="round"
                    style={{ animation: "spin 90s linear infinite", transformBox: "fill-box", transformOrigin: "center" }}
                  />
                  {/* the caustic: the brand's seven bands smeared under the base */}
                  <line
                    x1={model.prism.cx - model.prism.r * 0.86}
                    y1={model.prism.cy + model.prism.r * 0.74}
                    x2={model.prism.cx + model.prism.r * 0.86}
                    y2={model.prism.cy + model.prism.r * 0.74}
                    stroke="url(#mm-caustic)"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    opacity="0.95"
                  />
                  <line
                    x1={model.prism.cx - model.prism.r * 0.86}
                    y1={model.prism.cy + model.prism.r * 0.74}
                    x2={model.prism.cx + model.prism.r * 0.86}
                    y2={model.prism.cy + model.prism.r * 0.74}
                    stroke="url(#mm-caustic)"
                    strokeWidth="12"
                    strokeLinecap="round"
                    opacity="0.3"
                    filter="url(#mm-soft)"
                  />
                  {/* The refraction inside the glass. Not skinny connector lines
                      (the designer: "too small and weird") — light DISPERSING: a soft
                      white wedge spreading from the entry point across the
                      crystal, and one tapered ray per destination that widens
                      to meet its beam's thickness at the exit face, so inside
                      and outside read as one continuous piece of light. */}
                  {(() => {
                    const { inX, outX, cy, r } = model.prism;
                    const apexX = inX + 2;
                    const spreadY = (i: number) => cy - r * 0.52 + (r * 1.04 * (i + 0.5)) / model.outBeams.length;
                    const topY = spreadY(0);
                    const botY = spreadY(model.outBeams.length - 1);
                    return (
                      <g>
                        {/* the dispersion wedge — white light widening through the glass */}
                        <polygon
                          points={`${apexX},${cy - 5} ${outX},${topY - 8} ${outX},${botY + 8} ${apexX},${cy + 5}`}
                          fill="url(#mm-wedge)"
                          filter="url(#mm-soft)"
                        />
                        {/* tapered spectrum rays, each widening to its beam */}
                        {model.outBeams.map((b, i) => {
                          const y = spreadY(i);
                          const w = Math.max(3, Math.min(16, b.thick * 0.75));
                          return (
                            <polygon
                              key={b.key}
                              points={`${apexX},${cy} ${outX},${y - w / 2} ${outX},${y + w / 2}`}
                              fill={b.color}
                              opacity="0.5"
                            />
                          );
                        })}
                      </g>
                    );
                  })()}
                  {/* the light strip on the entry face: glass catches the beam */}
                  <line
                    x1={model.prism.cx - model.prism.r * 0.46}
                    y1={model.prism.cy - model.prism.r * 0.28}
                    x2={model.prism.cx - model.prism.r * 0.78}
                    y2={model.prism.cy + model.prism.r * 0.4}
                    stroke="#ffffff"
                    strokeOpacity="0.28"
                    strokeWidth="3"
                    strokeLinecap="round"
                    filter="url(#mm-soft)"
                  />
                  {/* the entry hotspot, with a lens flare where light meets glass */}
                  <line x1={model.prism.inX - 26} y1={model.prism.cy} x2={model.prism.inX + 18} y2={model.prism.cy} stroke="#ffffff" strokeOpacity="0.35" strokeWidth="1" />
                  <line x1={model.prism.inX} y1={model.prism.cy - 16} x2={model.prism.inX} y2={model.prism.cy + 16} stroke="#ffffff" strokeOpacity="0.22" strokeWidth="1" />
                  <circle cx={model.prism.inX} cy={model.prism.cy} r="4.5" fill="#ffffff" opacity="0.95" />
                  <circle cx={model.prism.inX} cy={model.prism.cy} r="13" fill="#ffffff" opacity="0.3" filter="url(#mm-soft)" />
                  {/* arrival flash — decays in the rAF loop */}
                  <circle ref={flashRef} cx={model.prism.cx} cy={model.prism.cy} r={model.prism.r * 0.5} fill="#ffffff" opacity="0" filter="url(#mm-soft)" />
                </g>

                {/* only the pulses' hit circles opt back in to pointer events */}
                <g ref={dotLayer} style={{ pointerEvents: "none" }} />
              </svg>


              {/* sources, left */}
              {model.sources.map((s) => {
                const p = model.srcPos.get(s.key)!;
                // a berth that names a real surface is a door, not a label —
                // Portfolio has its own pre-launch page, Lightrunner is live
                const Card: React.ElementType = s.href ? (s.href.startsWith("/") ? Link : "a") : "div";
                const cardLink = s.href
                  ? s.href.startsWith("/")
                    ? { href: s.href }
                    : { href: s.href, target: "_blank", rel: "noopener noreferrer" }
                  : {};
                return (
                  <Card
                    key={s.key}
                    {...cardLink}
                    title={s.caption}
                    className={`absolute flex flex-col justify-center rounded-xl pl-6 pr-4 ${s.href ? "transition-colors hover:border-white/30" : ""}`}
                    style={{
                      left: 20,
                      top: p.y0,
                      width: model.SRC_W,
                      height: p.y1 - p.y0,
                      transition: "top 0.6s cubic-bezier(0.16,1,0.3,1), height 0.6s cubic-bezier(0.16,1,0.3,1)",
                      border: s.live ? "1px solid rgba(255,255,255,0.13)" : "1px dashed rgba(255,255,255,0.1)",
                      background: s.live ? "linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(2,3,10,0.72) 62%)" : "rgba(0,0,0,0.35)",
                      boxShadow: s.live ? "0 8px 26px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)" : "none",
                      backdropFilter: "blur(6px)",
                    }}
                  >
                    {s.live && (
                      <span
                        aria-hidden
                        className="absolute bottom-3 left-0 top-3 w-[2px] rounded-full"
                        style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.55), rgba(255,255,255,0.06))" }}
                      />
                    )}
                    {s.live && s.usd != null && s.usd > 0.005 && (
                      <span
                        aria-hidden
                        className="absolute -right-px bottom-6 top-6 w-[3px] rounded-full"
                        style={{ background: "linear-gradient(180deg, transparent, rgba(255,255,255,0.5), transparent)", filter: "blur(1px)" }}
                      />
                    )}
                    <div className={`text-[15px] font-bold ${s.live ? "text-white" : "text-slate-400"}`}>{s.label}</div>
                    {s.usd != null ? (
                      // fee, then volume on its OWN line — inline it wrapped on
                      // wide figures and sat beside narrow ones, so the
                      // secondary text never lined up across cards
                      <>
                        <div className="mt-1 text-3xl font-semibold tabular-nums text-white" style={{ fontFamily: MONO }}>
                          {model.pending ? shimmer("w-16", "h-7") : fmtUsd(s.usd)}
                        </div>
                        {s.vol && (
                          <div className="mt-0.5 text-[13px] font-semibold tabular-nums text-slate-400" style={{ fontFamily: MONO }}>
                            {s.vol}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">not on-chain yet</div>
                        {s.vol && (
                          <div className="mt-0.5 text-[13px] font-semibold tabular-nums text-slate-400" style={{ fontFamily: MONO }}>
                            {s.vol}
                          </div>
                        )}
                      </>
                    )}
                    {s.href && (
                      <svg aria-hidden viewBox="0 0 24 24" className="absolute right-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7 17 17 7M9 7h8v8" />
                      </svg>
                    )}
                  </Card>
                );
              })}

              {/* destinations, right */}
              {model.shown.map((d) => {
                const p = model.dstPos.get(d.key)!;
                // the measured window figure plus the theatre's ledger (live
                // credits, replay rewind debits) — clamped so a dust window's
                // estimate overshoot can never print a negative dollar
                const usd = Math.max(0, (model.destTotals.get(d.key) ?? 0) + (boost[d.key] ?? 0));
                const body = (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: d.color }} />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: d.color, boxShadow: `0 0 10px ${d.color}` }} />
                      </span>
                      <span className="text-base font-bold text-white">{d.label}</span>
                      {!model.pending && (
                        <span
                          className="ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums"
                          style={{ background: `${d.color}1f`, color: d.color, border: `1px solid ${d.color}40`, fontFamily: MONO }}
                        >
                          {pctOf(usd)}
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 text-4xl font-bold tabular-nums" style={{ fontFamily: MONO, color: d.color, ...glow(d.color) }}>
                      {model.pending ? shimmer("w-20", "h-9") : <CountUp value={usd} render={fmtUsd} />}
                    </div>
                    {"href" in d && d.href ? (
                      <svg aria-hidden viewBox="0 0 24 24" className="absolute bottom-2.5 right-2.5 h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: `${d.color}b3` }}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7 17 17 7M9 7h8v8" />
                      </svg>
                    ) : null}
                  </>
                );
                const style: React.CSSProperties = {
                  left: model.DST_X,
                  top: p.y0,
                  width: model.DST_W,
                  height: p.y1 - p.y0,
                  transition: "top 0.6s cubic-bezier(0.16,1,0.3,1), height 0.6s cubic-bezier(0.16,1,0.3,1)",
                  border: `1px solid ${d.color}45`,
                  background: `linear-gradient(120deg, ${d.color}22 0%, ${d.color}09 46%, rgba(0,0,0,0.6) 100%)`,
                  boxShadow: `0 8px 30px rgba(0,0,0,0.42), 0 0 44px ${d.color}1a, inset 0 1px 0 ${d.color}29`,
                  backdropFilter: "blur(6px)",
                };
                return "href" in d && d.href ? (
                  <Link key={d.key} href={d.href} title={d.note} className="absolute flex flex-col justify-center rounded-xl px-4 transition-transform hover:scale-[1.015]" style={style}>
                    {body}
                  </Link>
                ) : (
                  <div key={d.key} title={d.note} className="absolute flex flex-col justify-center rounded-xl px-4" style={style}>
                    {body}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* ── the live wire ── */}
      <div className="flex items-center gap-3 overflow-x-auto rounded-xl border border-white/10 px-4 py-2.5" style={{ background: "rgba(0,0,0,0.4)", scrollbarWidth: "none" }}>
        <span className="flex shrink-0 items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.18em]" style={{ color: C.cyan }}>
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: C.cyan }} />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: C.cyan }} />
          </span>
          Live wire
        </span>
        {/* a staged burn outranks every event chip: it is money WAITING for a
            public crank, and the whole point is that someone sees it */}
        {(pipe?.collectors ?? [])
          .filter(collectorCrankable)
          .map((c) => (
            <PendingBurnChip key={`${c.chain}-${c.address}`} collector={c} onOpen={setBurnCrank} />
          ))}
        {/* stage three: ETH sitting AT the L1 burner — one crank from dead
            PRISM. The whole crank happens in a popup right here (the designer,
            2026-08-16 — like the bridge crank), celebration included */}
        {pipe?.burner != null && pipe.burner.balanceEth > 0.0001 && (
          <button
            type="button"
            onClick={() => setBurnerCrank(pipe.burner!)}
            className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1 transition-all hover:brightness-125"
            style={{ borderColor: "rgba(255,0,60,0.45)", background: "rgba(255,0,60,0.1)", boxShadow: "0 0 14px rgba(255,0,60,0.25)" }}
            title="ETH pooled at the L1 burner. The next permissionless crank buys PRISM and sends it to dEaD. Click to push it."
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: C.red }} />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: C.red }} />
            </span>
            <span className="text-[12px] font-bold" style={{ color: "#ff8fa3", fontFamily: MONO }}>
              Ξ{fmtEth(pipe.burner.balanceEth)} at the burner · crank it
            </span>
          </button>
        )}
        {/* staged but not yet crankable: the money stays VISIBLE (dim, no CTA,
            no pulse) — hiding it would recreate the exact invisibility this
            machinery exists to end. Doors to the roads, which say why it waits */}
        {(pipe?.collectors ?? [])
          .filter((c) => c.pendingEth > 0.00005 && !collectorCrankable(c))
          .map((c) => (
            <Link
              key={`staged-${c.chain}-${c.address}`}
              href="/burn"
              className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-white/10 px-3 py-1 transition-colors hover:border-white/25"
              style={{ background: "rgba(255,255,255,0.03)" }}
              title={
                c.flushable
                  ? "Staged and flushable, but finalizing now would cost too much of it. The crank lights when the economics clear."
                  : "Staged below the collector's contract floor. It builds toward the crank on its own."
              }
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: "rgba(255,159,69,0.5)" }} />
              <span className="text-[12px] font-semibold text-slate-400" style={{ fontFamily: MONO }}>
                Ξ{fmtEth(c.pendingEth)} staged for the burn ·{" "}
                {c.flushable
                  ? "waiting for cheaper gas"
                  : c.thresholdEth
                    ? `needs Ξ${fmtEth(c.thresholdEth)} to flush`
                    : "not enough to flush yet"}
              </span>
            </Link>
          ))}
        {/* burn money IN FLIGHT on the bridge. It does NOT land by itself:
            after the ~7-day window the L1 finalization is its own
            permissionless crank (w-79). A crossing AT THE GATE cranks right
            here (the map's rule: do it in place); the rest door to /burn */}
        {atTheGate ? (
          <button
            type="button"
            onClick={() => setFinalizeCrank(atTheGate)}
            className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1 transition-all hover:brightness-125"
            style={{ borderColor: "rgba(250,204,21,0.5)", background: "rgba(250,204,21,0.1)", boxShadow: "0 0 16px rgba(250,204,21,0.25)" }}
            title="This crossing cleared its dispute window: Ethereum will accept its finalization right now. One permissionless transaction delivers it to the burner pot."
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: "#FACC15" }} />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: "#FACC15" }} />
            </span>
            <span className="text-[12px] font-bold" style={{ color: "#FACC15", fontFamily: MONO }}>
              Ξ{fmtEth(atTheGate.amountEth)} at the gate · finalize it
            </span>
          </button>
        ) : (
          crossing.eth > 0 && (
            <Link
              href="/burn"
              className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1 transition-all hover:brightness-125"
              style={{ borderColor: "rgba(255,159,69,0.35)", background: "rgba(255,159,69,0.07)" }}
              title="Burn money crossing the L2 to L1 withdrawal bridge. After its ~7-day window, finalizing on L1 is its own permissionless crank. The roads on /burn track each crossing."
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#FF9F45", boxShadow: "0 0 8px #FF9F45" }} />
              <span className="text-[12px] font-semibold" style={{ color: "#FF9F45", fontFamily: MONO }}>
                Ξ{fmtEth(crossing.eth)} crossing to the burn
                {crossing.unlockTs ? ` · finalize opens ~${new Date(crossing.unlockTs).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
              </span>
            </Link>
          )
        )}
        {wire.length === 0 && <span className="text-[11px] text-slate-600">Waiting for the next fee to land on-chain…</span>}
        {wire.map((e) => {
          const inner = (
            <>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: wireColor(e) }} />
              <span className="text-[12px] font-semibold text-white">{eventLabel(e)}</span>
              <TimeAgo ts={e.ts} short className="text-[10px] text-slate-500" />
              {/* an info glyph now, not an external arrow: the chip opens the
                  detail in place rather than leaving the site */}
              <svg aria-hidden viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: `${wireColor(e)}99` }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </>
          );
          const cls = "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1 transition-colors hover:border-white/30";
          const st: React.CSSProperties = {
            borderColor: `${wireColor(e)}2e`,
            background: `${wireColor(e)}0d`,
            fontFamily: MONO,
            ...(fresh.has(e.id) ? { animation: "feed-pop 0.5s cubic-bezier(0.2,0.7,0.3,1.4) both" } : {}),
          };
          // Clicking a chip opens the full detail — which system it went
          // through, the basket and its holdings, the size, and the tx link in
          // its footer. Straight-to-explorer was strictly less than this.
          return (
            <button key={e.id} type="button" onClick={() => setDetail(e)} title="See the details" className={cls} style={st}>
              {inner}
            </button>
          );
        })}
        {watched > 0 && (
          <span className="ml-auto shrink-0 whitespace-nowrap text-[10px] text-slate-500">
            <span style={{ fontFamily: MONO, color: "#94a3b8" }}>{watched}</span> landed while you watched
          </span>
        )}
      </div>

      {detail && (
        <EventDetailModal
          e={detail}
          ethUsd={stats?.ethUsd ?? 0}
          prismUsd={stats?.prismUsd ?? 0}
          prismSupply={stats?.supply ?? 0}
          onClose={() => setDetail(null)}
        />
      )}
      {burnCrank && (
        <PendingBurnModal
          collector={burnCrank}
          ethUsd={pipe?.ethUsd ?? stats?.ethUsd ?? 0}
          onClose={() => setBurnCrank(null)}
          onDone={refreshPipe}
        />
      )}
      {burnerCrank && (
        <BurnerCrankModal
          burner={burnerCrank}
          ethUsd={pipe?.ethUsd ?? stats?.ethUsd ?? 0}
          onClose={() => setBurnerCrank(null)}
          onDone={refreshPipe}
        />
      )}
      {finalizeCrank && (
        <FinalizeCrankModal
          target={finalizeCrank}
          ethUsd={pipe?.ethUsd ?? stats?.ethUsd ?? 0}
          onClose={() => setFinalizeCrank(null)}
          onDone={refreshPipe}
        />
      )}

      <p className="px-1 text-[11px] text-slate-600">
        Beams carry measured on-chain amounts: basket lanes are the real FeesAccrued splits, the pool lane follows the
        token&apos;s fixed split, launch fees burn in full. A labeled pulse is a real transaction: click one in flight, or
        any chip on the wire, for the full detail. The opening replays the most recent ones. Not investment advice.
      </p>
    </main>
  );
}
