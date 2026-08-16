"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import type { ActivityEvent, PulseStats } from "@/lib/feed/types";
import { txUrl } from "@/lib/chain/constants";
import { fmtEth, fmtPrism, fmtUsd, fmtUsdFull } from "@/lib/feed/format";
import { C, MONO, glass, glow } from "./style";
import { AmbientBlooms } from "./blooms";
import { SwipeRow } from "./swipe-row";
import { FeePipeline } from "./fee-pipeline";
import { TimeAgo } from "./time-ago";

// ── THE PRISM MOTHERSHIP — the command deck ──────────────────────────────────
// the designer's chosen direction (2026-08-02, from his mockup): near-black space
// ground, glass panels, neon green/orange/cyan/purple, glow numerals, orbital
// hero. Rebrand rationale: Prism is an ecosystem of many dapps eventually.
//
// Two rules carried over from the mockup review:
// - EVERY figure is live chain data. The mockup's fabricated stats ("+2.4k
//   users/24h", "14.2M TVL") and nonexistent modules (Trade/Stake) do not ship
//   — the modules panel lists only surfaces that exist today.
// - All glass/glow styling is INLINE. Tailwind v4 tree-shakes custom classes
//   out of globals.css (it cost us the share button); arbitrary values and
//   style objects always compile.

// the deck's entrance: each panel materializes in sequence (the designer's intro ask,
// 2026-08-03). One-shot, sub-second, panels only — data inside stays live.
const deckIn = (i: number): CSSProperties => ({
  // one shorthand, delay folded in — animation + animationDelay on the same
  // element is the React style-conflict warning (was the dev overlay's 4 issues)
  animation: `ms-deck-in 0.7s cubic-bezier(0.16,1,0.3,1) ${i * 90}ms both`,
});


function Label({ dot, children }: { dot?: string; children: React.ReactNode }) {
  return (
    <h2 className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
      {dot && <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: dot }} />}
      {children}
    </h2>
  );
}

export function MothershipDeck() {
  const [stats, setStats] = useState<PulseStats | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [sessionBurned, setSessionBurned] = useState(0);
  const seenBurns = useRef<Set<string> | null>(null);
  // "Since you arrived" is the most compelling thing on this site and it was
  // used exactly once, for PRISM burnt, in the fee pipeline. The same session
  // watch counts trades and launches too. Only things that can be counted
  // OUTRIGHT go in here: fee amounts are not summable across sources (a pool
  // event carries its fee in eth, a basket event carries the trade SIZE in
  // tradeUsd), so a combined "fees earned while you watched" would be adding
  // two different quantities and calling the total revenue.
  const seenAll = useRef<Set<string> | null>(null);
  const [session, setSession] = useState({ trades: 0, launches: 0 });
  // The feed polls every 10s and used to swallow every failure, so a dead route
  // looked exactly like a quiet market: the last good numbers sat on screen
  // indefinitely with nothing saying they had stopped moving. This only ever
  // renders after several consecutive misses, so a single flake stays invisible
  // and the surface is unchanged whenever the data is actually flowing.
  const misses = useRef(0);
  const pollRef = useRef(10_000);
  const [feedStale, setFeedStale] = useState(false);

  // ── The revenue window (the designer, 2026-08-13: "a date picker toggle next to the
  // revenue for holders with the last 24h, 7d, 1m") ──────────────────────────
  //
  // All three windows come from ONE source, the charts store, and that is the
  // whole point. PulseStats carries 24h, 7d and all-time but has no 1m at all,
  // so a picker built on it would have had to reach into the charts store for
  // its third option — and the two pipelines do not agree. Measured on the same
  // minute: 24h reads $1,705 off the feed and $1,624 off the charts store, a 5%
  // gap, because one is a rolling block window and the other is 24 whole hourly
  // buckets. Neither is wrong; they are different questions. Mixing them inside
  // one toggle would mean the number jumped for a reason no reader could see.
  //
  // The 24h figure therefore moves slightly from what the bar showed before.
  // Revenue-per-Prism follows the same window for the same reason: two figures
  // in one strip that cannot be divided into each other is a contradiction on
  // its face.
  const REV_RANGES = [
    { key: "24h", api: "24h", label: "last 24 hours" },
    { key: "7d", api: "1w", label: "last 7 days" },
    { key: "1m", api: "1m", label: "last 30 days" },
  ] as const;
  type RevKey = (typeof REV_RANGES)[number]["key"];
  const [revRange, setRevRange] = useState<RevKey>("24h");
  const [revUsd, setRevUsd] = useState<Partial<Record<RevKey, number>>>({});
  const [revFailed, setRevFailed] = useState(false);

  useEffect(() => {
    if (revUsd[revRange] != null) return; // each window is fetched once
    const spec = REV_RANGES.find((r) => r.key === revRange);
    if (!spec) return;
    let alive = true;
    fetch(`/api/charts?range=${spec.api}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("charts unavailable"))))
      .then((d: { feesUsd?: number[] }) => {
        if (!alive) return;
        setRevUsd((prev) => ({ ...prev, [revRange]: (d.feesUsd ?? []).reduce((a, b) => a + (b || 0), 0) }));
        setRevFailed(false);
      })
      .catch(() => {
        if (alive) setRevFailed(true);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revRange, revUsd]);

  useEffect(() => {
    let alive = true;
    const tick = () =>
      fetch("/api/feed", { cache: "no-store" })
        .then((r) => r.json())
        .then((d: { stats?: PulseStats; events?: ActivityEvent[]; pollMs?: number }) => {
          if (d.pollMs && d.pollMs >= 1000) pollRef.current = d.pollMs;
          if (!alive) return;
          if (d.stats) setStats(d.stats);
          if (d.events) {
            setEvents(d.events);
            const burns = d.events.filter((e) => e.kind === "burn" && (e.prism ?? 0) > 0);
            if (seenBurns.current === null) {
              // first batch is the baseline, not a burst of arrivals
              seenBurns.current = new Set(burns.map((e) => e.id));
            } else {
              let added = 0;
              for (const e of burns) {
                if (seenBurns.current.has(e.id)) continue;
                seenBurns.current.add(e.id);
                added += e.prism ?? 0;
              }
              if (added > 0) setSessionBurned((v) => v + added);
            }
            // the same baseline-then-count rule, across every event kind
            if (seenAll.current === null) {
              seenAll.current = new Set(d.events.map((e) => e.id));
            } else {
              let trades = 0;
              let launches = 0;
              for (const e of d.events) {
                if (seenAll.current.has(e.id)) continue;
                seenAll.current.add(e.id);
                if (e.kind === "launch") launches++;
                else if (e.side) trades++;
              }
              if (trades || launches) setSession((v) => ({ trades: v.trades + trades, launches: v.launches + launches }));
            }
          }
          misses.current = 0;
          if (alive) setFeedStale(false);
        })
        .catch(() => {
          // three strikes (~30s) before saying anything, so a flake and an
          // outage never look the same
          misses.current += 1;
          if (alive && misses.current >= 3) setFeedStale(true);
        });
    // The cadence is the SERVER'S to set, not ours. /api/feed publishes pollMs
    // (and caches itself at exactly that interval), the old pulse hook has
    // always honoured it, and the deck hardcoded 10s — so NEXT_PUBLIC_LIVE_POLL_MS
    // moved every surface except the main one.
    //
    // It also polls on a self-scheduling timeout rather than a fixed interval,
    // which lets it stop dead on a hidden tab and fire immediately on return.
    // The old behaviour kept hitting the heaviest route on the site every ten
    // seconds for a tab nobody was looking at, and then made you wait up to ten
    // more seconds for fresh numbers when you came back to it.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      timer = setTimeout(run, pollRef.current);
    };
    const run = () => {
      tick().finally(() => {
        if (alive) schedule();
      });
    };
    const onVis = () => {
      if (!alive) return;
      if (document.visibilityState === "hidden") {
        if (timer) clearTimeout(timer);
        timer = null;
      } else {
        run(); // straight back to fresh, no waiting out the remainder
      }
    };
    document.addEventListener("visibilitychange", onVis);
    run();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const ethUsd = stats?.ethUsd ?? 0;
  const prismUsd = stats?.prismUsd ?? 0;
  const lifetimeUsd = stats ? stats.feesEthTotal * ethUsd + stats.feesPrismTotal * prismUsd : 0;
  const todayUsd = stats ? stats.feesToHolders24h * ethUsd : 0;

  const spectrumEvents = useMemo(
    () =>
      events
        .filter(
          (e) =>
            e.kind === "launch" ||
            e.kind === "batch" || // Spectrum Portfolio batches (the batcher watch)
            e.source === "spectrum-index" ||
            e.source === "spectrum-auction" ||
            (e.kind === "burn" && e.source !== "prism-pool"),
        )
        .slice(0, 24),
    [events],
  );
  const prismEvents = useMemo(
    () => events.filter((e) => e.source === "prism-pool" || e.source === "dstable").slice(0, 24),
    [events],
  );

  const dash = <span className="text-slate-600">—</span>;

  // The selected window's revenue, and the same window divided by supply, so the
  // two figures in the strip always answer to each other.
  const revWindowUsd = revUsd[revRange] ?? null;
  const revPerPrism = revWindowUsd != null && stats && stats.supply > 0 ? revWindowUsd / stats.supply : null;

  return (
    <main className="relative z-10 mx-auto w-full max-w-[1536px] space-y-3 p-4 sm:px-6 sm:py-3">
      <AmbientBlooms />

      {feedStale && (
        <div
          className="relative flex items-center gap-2 rounded-xl px-4 py-2 text-[11px]"
          style={{ background: "rgba(255,0,60,0.08)", border: "1px solid rgba(255,0,60,0.25)", color: "#fca5a5" }}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: C.red }} />
          The live feed stopped answering. These figures are the last ones that came through, not
          the current ones.
        </div>
      )}

      {/* ── the top bar (the designer 2026-08-12 2305): protocol revenue 24h · total
          PRISM burnt · revenue per Prism 24h, one strip, ABOVE the lifetime
          core. Today/This week/All time are gone — the burn takes that slot. */}
      <div
        className="relative flex flex-col items-center justify-between gap-6 overflow-hidden rounded-2xl px-6 py-4 lg:flex-row lg:px-8"
        style={{ ...glass, border: `1px solid ${C.cyan}33`, ...deckIn(0) }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: `linear-gradient(90deg, ${C.cyan}0d, transparent, ${C.orange}0d)` }}
        />
        <div className="relative z-10 flex w-full flex-1 flex-col">
          {/* flex-wrap + a nowrap label: on a phone the picker drops below the
              label as a unit. Without this the LABEL wrapped mid-phrase under
              the picker ("PROTOCOL REVENUE TO / HOLDERS"), which read broken. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Label dot={C.cyan}>
              <span className="whitespace-nowrap">Protocol revenue to holders</span>
            </Label>
            <div className="-mt-2 flex gap-1">
              {REV_RANGES.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setRevRange(r.key)}
                  aria-pressed={revRange === r.key}
                  className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/60"
                  style={
                    revRange === r.key
                      ? { background: `${C.cyan}26`, color: C.cyan, border: `1px solid ${C.cyan}4d` }
                      : { color: "#5b6572", border: "1px solid rgba(255,255,255,0.08)" }
                  }
                >
                  {r.key}
                </button>
              ))}
            </div>
          </div>
          <div className="text-4xl font-bold tracking-tight text-white lg:text-5xl" style={glow(C.cyan)}>
            {revWindowUsd != null ? fmtUsd(revWindowUsd) : revFailed ? dash : <span className="text-slate-600">…</span>}
          </div>
        </div>

        <div className="relative z-10 flex w-full flex-1 flex-col items-start px-0 text-left lg:items-center lg:border-l lg:border-r lg:border-white/10 lg:px-8 lg:text-center">
          <Label dot={C.orange}>Total PRISM burnt</Label>
          <div className="text-4xl font-bold tracking-tight text-white lg:text-5xl" style={glow(C.orange)}>
            {stats ? fmtPrism(stats.totalBurned) : dash}
          </div>
        </div>

        <div className="relative z-10 flex w-full flex-1 flex-col items-start text-left lg:items-end lg:text-right">
          <Label>Revenue per Prism · {REV_RANGES.find((r) => r.key === revRange)?.label}</Label>
          <div className="text-4xl font-bold tracking-tight lg:text-5xl" style={{ color: C.cyan, ...glow(C.cyan) }}>
            {revPerPrism == null ? dash : revPerPrism >= 0.01 ? `$${revPerPrism.toFixed(2)}` : "<$0.01"}
          </div>
        </div>
      </div>

      {/* ── the heartbeat, and what has happened while you have been watching ──
          eventsPerMin is computed on every feed response and was rendered only
          on /spectrum through the old pulse components, so the one figure that
          literally says "this much is happening per minute" was hidden on the
          page fewest people land on. The session half appears only once
          something has actually arrived: a row of zeros says the opposite of
          what this strip is for. */}
      {stats && (
        <div
          className="flex items-center gap-x-4 overflow-x-auto px-1 text-[11px] text-slate-500"
          style={{ scrollbarWidth: "none" }}
        >
          <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: C.green }} />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: C.green }} />
            </span>
            {/* A COUNT, not the per-minute rate. eventsPerMin is a 24-hour
                average, so a genuinely busy day renders as "0.1 events/min",
                which reads as a dead chain and undersells the same activity by
                a factor of a thousand. The count it is derived from says the
                identical thing and says it well. */}
            <span style={{ fontFamily: MONO, color: "#94a3b8" }}>
              {(stats.burnsToday + stats.feeEventsToday).toLocaleString("en-US")}
            </span>
            <span>on-chain events in the last 24h</span>
          </span>
          {(sessionBurned > 0 || session.trades > 0 || session.launches > 0) && (
            <span className="flex shrink-0 items-center gap-x-2 whitespace-nowrap">
              <span className="text-slate-600">since you arrived</span>
              {session.trades > 0 && (
                <span className="shrink-0" style={{ color: "#94a3b8" }}>
                  <span style={{ fontFamily: MONO }}>{session.trades}</span> trade{session.trades === 1 ? "" : "s"}
                </span>
              )}
              {sessionBurned > 0 && (
                <span className="shrink-0" style={{ color: C.orange }}>
                  <span style={{ fontFamily: MONO }}>{fmtPrism(sessionBurned)}</span> PRISM burnt
                </span>
              )}
              {session.launches > 0 && (
                <span className="shrink-0" style={{ color: C.purple }}>
                  <span style={{ fontFamily: MONO }}>{session.launches}</span> basket{session.launches === 1 ? "" : "s"} launched
                </span>
              )}
            </span>
          )}
        </div>
      )}

      {/* ── lifetime revenue LEFT · the fee collection system RIGHT ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* revenue core */}
        <div
          className="relative flex min-h-[164px] items-center justify-center overflow-hidden rounded-2xl p-6 lg:col-span-6"
          style={{ ...glass, border: `1px solid ${C.green}33`, ...deckIn(1) }}
        >
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: `radial-gradient(circle at center, ${C.green}26 0%, rgba(0,0,0,0) 70%)` }}
          />
          <div
            className="absolute left-1/2 top-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full border"
            style={{ borderColor: `${C.green}1a`, animation: "spin 12s linear infinite" }}
          />
          <div
            className="absolute left-1/2 top-1/2 h-[220px] w-[220px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed"
            style={{ borderColor: `${C.green}33`, animation: "spin 20s linear reverse infinite" }}
          />

          <div className="relative z-10 flex flex-col items-center text-center">
            <div
              className="mb-4 flex items-center gap-2 rounded-full border px-4 py-1 text-[10px] font-semibold uppercase tracking-[0.2em]"
              style={{ borderColor: `${C.green}33`, background: `${C.green}1a`, color: C.green }}
            >
              Lifetime revenue to holders
            </div>
            <h1 className="mb-3 text-5xl font-black tracking-tighter text-white sm:text-6xl lg:text-[64px]" style={glow(C.green)}>
              <span style={{ color: `${C.green}cc` }}>$</span>
              {lifetimeUsd >= 100 ? Math.round(lifetimeUsd).toLocaleString("en-US") : lifetimeUsd.toFixed(2)}
            </h1>
            <div
              className="flex items-center gap-6 rounded-xl border border-white/5 px-5 py-1.5 text-sm text-slate-400 backdrop-blur-md"
              style={{ fontFamily: MONO, background: "rgba(3,4,9,0.5)" }}
            >
              <div className="flex items-center gap-2">
                <span className="font-semibold text-white">Ξ{stats ? fmtEth(stats.feesEthTotal) : "—"}</span>
                <span className="text-[10px] text-slate-500">ETH</span>
              </div>
              <div className="h-4 w-px bg-white/10" />
              <div className="flex items-center gap-2">
                <span className="font-semibold text-white">{stats ? fmtPrism(stats.feesPrismTotal) : "—"}</span>
                <span className="text-[10px] text-slate-500">PRISM</span>
              </div>
            </div>
          </div>

          {/* corner brackets */}
          <div className="absolute left-0 top-0 h-8 w-8 rounded-tl-xl border-l border-t" style={{ borderColor: `${C.green}4d` }} />
          <div className="absolute right-0 top-0 h-8 w-8 rounded-tr-xl border-r border-t" style={{ borderColor: `${C.green}4d` }} />
          <div className="absolute bottom-0 left-0 h-8 w-8 rounded-bl-xl border-b border-l" style={{ borderColor: `${C.green}4d` }} />
          <div className="absolute bottom-0 right-0 h-8 w-8 rounded-br-xl border-b border-r" style={{ borderColor: `${C.green}4d` }} />
        </div>

        {/* ── the fee collection system, top level (the designer 2026-08-12 2305):
            every stream that collects fees, its live figures, where its cut
            goes. The old burn/baskets cards' facts all live on: basket count
            and revenue in the baskets row, the portfolio berth as the dark
            row (no numbers until the batcher ceremony — desk w-…-136), the
            queued burn inside the pipeline below. ── */}
        <div className="relative flex flex-col overflow-hidden rounded-2xl p-5 lg:col-span-6" style={{ ...glass, ...deckIn(2) }}>
          <div className="absolute right-0 top-0 h-32 w-32 rounded-full blur-2xl" style={{ background: `${C.cyan}0d` }} />
          <div className="flex flex-1 flex-col justify-center gap-2">
            {/* stream 1 — the PRISM pool itself */}
            <div className="flex items-center justify-between gap-4 rounded-xl border px-4 py-2.5" style={{ borderColor: `${C.green}26`, background: `${C.green}0a` }}>
              <div className="min-w-0">
                <div className="text-sm font-bold text-white">PRISM swap fees</div>
                <div className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-slate-500">ETH side to holders · PRISM side burns</div>
              </div>
              <div className="shrink-0 whitespace-nowrap text-right" style={{ fontFamily: MONO }}>
                <div className="text-lg font-semibold" style={{ color: C.green }}>
                  {stats ? fmtUsd(todayUsd) : dash}
                </div>
                <div className="text-[10px] text-slate-500">last 24h</div>
              </div>
            </div>

            {/* stream 2 — the baskets */}
            <Link
              href="/spectrum"
              className="flex items-center justify-between gap-4 rounded-xl border px-4 py-2.5 transition-colors hover:bg-white/[0.04]"
              style={{ borderColor: `${C.cyan}26`, background: `${C.cyan}0a` }}
            >
              <div className="min-w-0">
                <div className="text-sm font-bold text-white">
                  {/* nowrap: "29 live" is one badge — without it, "live" orphaned
                      onto its own line on a phone */}
                  Spectrum baskets <span className="ml-1 whitespace-nowrap text-xs font-normal text-slate-400">{stats ? stats.indexCount : "—"} live</span>
                </div>
                <div className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-slate-500">every trade fee splits · 25% buys &amp; burns PRISM</div>
              </div>
              <div className="shrink-0 whitespace-nowrap text-right" style={{ fontFamily: MONO }}>
                <div className="text-lg font-semibold" style={{ color: C.cyan }}>
                  {stats ? fmtUsd(stats.indexFeesTotal * ethUsd) : dash}
                </div>
                <div className="text-[10px] text-slate-500">Ξ{stats ? fmtEth(stats.indexFeesTotal) : "—"} · all-time</div>
              </div>
            </Link>

            {/* stream 3 — the portfolio berth stays dark until the ceremony.
                Fee copy per SpectrumContracts' correction (2026-08-12, desk
                w-…-395): the 50bps-flat ruling is SUPERSEDED — the fee is
                caller-set, capped 2%, split 7:1 burn:integrator. Never
                hard-code a rate; when this lights up, read it off the events. */}
            <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 px-4 py-2.5" style={{ background: "rgba(255,255,255,0.02)" }}>
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-400">Spectrum Portfolio</div>
                <div className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-slate-500">a fee on every buy · a share of it buys &amp; burns PRISM</div>
              </div>
              <span
                className="shrink-0 rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                style={{ background: `${C.orange}26`, color: C.orange, border: `1px solid ${C.orange}40` }}
              >
                Launching soon
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── the pipeline: activity → buckets → the burn pool ── */}
      <div style={deckIn(3)}>
        <FeePipeline stats={stats} events={events} sessionBurned={sessionBurned} />
      </div>

      {/* ── two columns: spectrum feed | prism feed — a swipe carousel below
          lg. Apps aboard removed from /command (the designer, 2026-08-12 review):
          the home page's app store owns that job; the deck is the data room. ── */}
      <div style={deckIn(4)}>
      <SwipeRow desktopClass="lg:grid lg:grid-cols-2" itemClass="w-[88%] sm:w-[68%] md:w-[52%]">
        <FeedColumn
          title="Spectrum overview"
          color={C.orange}
          link={{ href: "/spectrum", label: "All stats" }}
          events={spectrumEvents}
          empty="Basket activity lands here the moment it happens on-chain."
          filters={[
            { label: "All", test: () => true },
            { label: "Buys & sells", test: (e) => e.kind !== "launch" && e.kind !== "burn" },
            { label: "Launches", test: (e) => e.kind === "launch" },
            { label: "Burns", test: (e) => e.kind === "burn" },
          ]}
        />
        <FeedColumn
          title="Prism swaps & burns"
          color={C.green}
          link={{ href: "/charts", label: "Charts" }}
          events={prismEvents}
          empty="PRISM pool fees and burns stream in live."
          filters={[
            { label: "All", test: () => true },
            { label: "Swap fees", test: (e) => e.kind !== "burn" },
            { label: "Burns", test: (e) => e.kind === "burn" },
          ]}
        />

      </SwipeRow>
      </div>
    </main>
  );
}

export function FeedColumn({
  title,
  color,
  link,
  events,
  empty,
  filters,
}: {
  title: string;
  color: string;
  link: { href: string; label: string };
  events: ActivityEvent[];
  empty: string;
  filters: { label: string; test: (e: ActivityEvent) => boolean }[];
}) {
  const [active, setActive] = useState(0);
  const shown = filters[active] ? events.filter(filters[active].test) : events;

  // An event that landed two seconds ago looked exactly like one from an hour
  // ago, which makes a live stream read as a static list. Arrivals now announce
  // themselves once: the row drops in and its accent ring flashes out.
  // The FIRST batch is the baseline, never an arrival — otherwise every visitor
  // gets twenty-four rows stampeding in on load, which reads as a bug.
  const seenIds = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const ids = events.map((e) => e.id);
    if (seenIds.current === null) {
      seenIds.current = new Set(ids);
      return;
    }
    const added = ids.filter((id) => !seenIds.current!.has(id));
    if (!added.length) return;
    for (const id of added) seenIds.current.add(id);
    setFresh(new Set(added));
    const t = setTimeout(() => setFresh(new Set()), 1500);
    return () => clearTimeout(t);
  }, [events]);
  return (
    <div className="flex h-[500px] flex-col rounded-2xl" style={{ ...glass, borderTop: `2px solid ${color}80` }}>
      <div className="flex items-center justify-between border-b border-white/5 p-5">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full" style={{ background: color }} />
          <h3 className="font-semibold text-white">{title}</h3>
        </div>
        <Link
          href={link.href}
          className="flex items-center gap-1 rounded bg-white/5 px-2 py-1 text-[10px] uppercase tracking-wider text-slate-400 transition-colors hover:text-white"
        >
          {link.label}
        </Link>
      </div>
      <div className="flex gap-2 overflow-x-auto whitespace-nowrap border-b border-white/5 px-5 py-3">
        {filters.map((f, i) => (
          <button
            key={f.label}
            onClick={() => setActive(i)}
            className={`rounded-full px-3 py-1 text-xs whitespace-nowrap transition-colors ${
              i === active ? "bg-white/10 text-white" : "border border-white/10 text-slate-400 hover:bg-white/5 hover:text-white"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {shown.length === 0 && <p className="p-4 text-xs leading-relaxed text-slate-500">{empty}</p>}
        {shown.map((e) => {
          // a row with a hash is a receipt: it opens the transaction itself,
          // same rule as the burn chips and the money map's wire
          const Row: React.ElementType = e.txHash ? "a" : "div";
          const rowLink = e.txHash
            ? { href: txUrl(e.txHash, e.chain ?? "ethereum"), target: "_blank", rel: "noopener noreferrer", title: "Open the transaction" }
            : {};
          return (
          <Row
            key={e.id}
            {...rowLink}
            className="group flex items-center justify-between rounded-xl border border-transparent p-3 transition-all hover:border-white/5 hover:bg-white/5"
            style={
              fresh.has(e.id)
                ? ({
                    // inline, because Tailwind v4 tree-shakes custom classes out
                    // of globals.css; the keyframes themselves live there
                    animation: "feed-pop 0.5s cubic-bezier(0.2,0.7,0.3,1.4) both, feed-flash 1.2s ease-out 0.1s forwards",
                    "--ring": `${color}99`,
                  } as CSSProperties)
                : undefined
            }
          >
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-105"
                style={{ background: `${color}1a`, borderColor: `${color}33`, color }}
              >
                {e.kind === "burn" ? (
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z"
                    />
                  </svg>
                ) : e.kind === "launch" ? (
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
                    />
                  </svg>
                )}
              </div>
              <div>
                <div className="text-sm text-white" style={{ fontFamily: MONO }}>
                  {/* FEES lead, volume rides beside — a batch's funding was
                      showing AS its fee (the designer, 2026-08-16: "$555 LP fee" on a
                      $4.38-fee batch). Per kind: the fee field first, the
                      trade/funding notional as the muted second figure. */}
                  {(() => {
                    if (e.kind === "burn") return fmtPrism(e.prism);
                    if (e.kind === "launch") return e.symbol ?? e.label ?? "New basket";
                    const fee =
                      e.kind === "batch"
                        ? e.feeUsd != null
                          ? fmtUsd(e.feeUsd)
                          : null
                        : e.usd != null
                          ? fmtUsd(e.usd)
                          : e.eth != null
                            ? `Ξ${fmtEth(e.eth)}`
                            : null;
                    const vol =
                      e.kind === "batch"
                        ? e.usd != null
                          ? fmtUsd(e.usd)
                          : null
                        : e.tradeUsd != null
                          ? fmtUsd(e.tradeUsd)
                          : e.tradeEth != null
                            ? `Ξ${fmtEth(e.tradeEth)}`
                            : null;
                    return (
                      <>
                        {fee ?? vol ?? "—"}
                        {fee != null && vol != null && <span className="text-xs text-slate-500"> · {vol} vol</span>}
                      </>
                    );
                  })()}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  {e.kind === "burn"
                    ? "PRISM burned"
                    : e.kind === "launch"
                      ? "Basket launched"
                      : e.kind === "batch"
                        ? e.feeUsd != null
                          ? "Batch fee"
                          : "Batch funding"
                        : e.side
                          ? `Basket ${e.side} fee`
                          : e.source === "wrapper"
                            ? "Wrapper fee"
                            : "LP fee"}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs font-medium" style={{ color }}>
                {e.kind === "burn"
                  ? "BUY & BURN"
                  : e.kind === "launch"
                    ? "LAUNCH"
                    : e.kind === "batch"
                      ? "PORTFOLIO"
                      : e.source === "wrapper"
                        ? "WRAPPED SWAP"
                        : e.side
                          ? "TRADE"
                          : "LP REVENUE"}
              </div>
              <div className="text-[10px] text-slate-500">
                {e.note ? `${e.note.slice(0, 34)}${e.note.length > 34 ? "…" : ""} · ` : ""}
                <TimeAgo ts={e.ts} />
              </div>
            </div>
          </Row>
          );
        })}
      </div>
    </div>
  );
}
