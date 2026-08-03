"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import type { ActivityEvent, PulseStats } from "@/lib/feed/types";
import { fmtEth, fmtPrism, fmtUsd, fmtUsdFull } from "@/lib/feed/format";
import { APPS, BUILD_SLOT, C, INSTRUMENTS, MONO, glass, glow } from "./style";
import { AmbientBlooms } from "./blooms";
import { AppIcon } from "./app-icon";
import { SwipeRow } from "./swipe-row";

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
  animation: "ms-deck-in 0.7s cubic-bezier(0.16,1,0.3,1) both",
  animationDelay: `${i * 90}ms`,
});

function ago(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

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
  const [queuedBurnUsd, setQueuedBurnUsd] = useState<number>(0);

  useEffect(() => {
    let alive = true;
    const tick = () =>
      fetch("/api/feed", { cache: "no-store" })
        .then((r) => r.json())
        .then((d: { stats?: PulseStats; events?: ActivityEvent[] }) => {
          if (!alive) return;
          if (d.stats) setStats(d.stats);
          if (d.events) setEvents(d.events);
        })
        .catch(() => {});
    tick();
    const t = setInterval(tick, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/spectrum/charts")
      .then((r) => r.json())
      .then((d: { queuedBurnUsd?: number }) => {
        if (alive && typeof d.queuedBurnUsd === "number") setQueuedBurnUsd(d.queuedBurnUsd);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const ethUsd = stats?.ethUsd ?? 0;
  const prismUsd = stats?.prismUsd ?? 0;
  const lifetimeUsd = stats ? stats.feesEthTotal * ethUsd + stats.feesPrismTotal * prismUsd : 0;
  const todayUsd = stats ? stats.feesToHolders24h * ethUsd : 0;
  const weekUsd = stats ? stats.feesToHolders7d * ethUsd : 0;
  const perPrism24h = stats && stats.supply > 0 ? (stats.feesToHolders24h / stats.supply) * ethUsd : 0;
  const burnedPct = stats && stats.cap > 0 ? (stats.totalBurned / stats.cap) * 100 : 0;
  const burned24Pct = stats && stats.totalBurned > 0 ? (stats.prismBurnedToday / stats.totalBurned) * 100 : 0;

  const spectrumEvents = useMemo(
    () =>
      events
        .filter(
          (e) =>
            e.kind === "launch" ||
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

  return (
    <main className="relative z-10 mx-auto w-full max-w-[1536px] space-y-6 p-4 sm:p-6">
      <AmbientBlooms />

      {/* ── hero grid: burn | revenue core | baskets ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* burn card — below lg the two burn figures pair side by side and the
            queued block steps back (the designer's 1254 pass: less information on m/t) */}
        <div className="group relative overflow-hidden rounded-2xl p-6 lg:col-span-3" style={{ ...glass, ...deckIn(0) }}>
          <div
            className="absolute right-0 top-0 h-32 w-32 rounded-full blur-2xl transition-all duration-500"
            style={{ background: `${C.orange}0d` }}
          />
          <div className="grid grid-cols-2 gap-4 lg:block">
            <div>
              <Label dot={C.orange}>Total PRISM burnt</Label>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-light tracking-tight text-white lg:text-4xl" style={glow(C.orange)}>
                  {stats ? fmtPrism(stats.totalBurned) : dash}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-500" style={{ fontFamily: MONO }}>
                of {stats ? stats.cap.toLocaleString("en-US") : "5,000"} cap · {burnedPct.toFixed(2)}%
              </p>
            </div>

            <div className="lg:mt-8 lg:border-t lg:border-white/5 lg:pt-6">
              <Label>Burned · last 24h</Label>
              <div className="text-2xl font-light text-white" style={{ fontFamily: MONO }}>
                {stats ? fmtPrism(stats.prismBurnedToday) : dash}
              </div>
              <div className="mt-1 text-[10px] text-slate-500">
                PRISM · {burned24Pct.toFixed(1)}% of all burns ever
              </div>
            </div>
          </div>

          {/* the audit's payoff: queued burns are not missing burns (desktop only) */}
          {queuedBurnUsd > 0.5 && (
            <div className="mt-6 hidden rounded-xl border px-3.5 py-2.5 lg:block" style={{ borderColor: `${C.orange}33`, background: `${C.orange}0a` }}>
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: C.orange }}>
                Queued to burn
              </div>
              <div className="mt-0.5 text-[15px] font-bold text-white" style={{ fontFamily: MONO }}>
                {fmtUsdFull(queuedBurnUsd)}
              </div>
            </div>
          )}
        </div>

        {/* revenue core */}
        <div
          className="relative flex min-h-[320px] items-center justify-center overflow-hidden rounded-2xl p-8 lg:col-span-6"
          style={{ ...glass, border: `1px solid ${C.green}33`, ...deckIn(1) }}
        >
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: `radial-gradient(circle at center, ${C.green}26 0%, rgba(0,0,0,0) 70%)` }}
          />
          <div
            className="absolute left-1/2 top-1/2 h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full border"
            style={{ borderColor: `${C.green}1a`, animation: "spin 12s linear infinite" }}
          />
          <div
            className="absolute left-1/2 top-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed"
            style={{ borderColor: `${C.green}33`, animation: "spin 20s linear reverse infinite" }}
          />

          <div className="relative z-10 flex flex-col items-center text-center">
            <div
              className="mb-6 flex items-center gap-2 rounded-full border px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em]"
              style={{ borderColor: `${C.green}33`, background: `${C.green}1a`, color: C.green }}
            >
              Lifetime revenue to holders
            </div>
            <h1 className="mb-4 text-6xl font-black tracking-tighter text-white sm:text-7xl lg:text-8xl" style={glow(C.green)}>
              <span style={{ color: `${C.green}cc` }}>$</span>
              {lifetimeUsd >= 100 ? Math.round(lifetimeUsd).toLocaleString("en-US") : lifetimeUsd.toFixed(2)}
            </h1>
            <div
              className="flex items-center gap-6 rounded-xl border border-white/5 px-6 py-2 text-sm text-slate-400 backdrop-blur-md"
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

        {/* baskets card */}
        <div className="group relative overflow-hidden rounded-2xl p-6 lg:col-span-3" style={{ ...glass, ...deckIn(2) }}>
          <div className="absolute left-0 top-0 h-32 w-32 rounded-full blur-2xl" style={{ background: `${C.cyan}0d` }} />
          <div className="flex items-start justify-between">
            <div>
              <Label dot={C.cyan}>All baskets</Label>
              {/* the count moves into the side-by-side pair below lg */}
              <div className="hidden text-4xl font-light text-white lg:block" style={glow(C.cyan)}>
                {stats ? stats.indexCount : dash}
              </div>
            </div>
            <Link
              href="/spectrum"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 transition-colors hover:bg-white/10"
              title="Spectrum dashboard"
            >
              <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </Link>
          </div>

          {/* the chains as their logos, not words (the designer 1254) */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {(["ethereum", "base", "robinhood"] as const).map((c) => (
              <span
                key={c}
                title={c[0].toUpperCase() + c.slice(1)}
                className="grid h-7 w-7 place-items-center rounded-full border border-white/10 bg-white/5"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/mothership/chain-${c}.png`} alt={c} className="h-4 w-4 rounded-full" />
              </span>
            ))}
          </div>

          {/* below lg the count and revenue read side by side (1254) */}
          <div className="mt-6 grid grid-cols-2 items-end gap-4 border-t border-white/5 pt-5 lg:mt-8 lg:block lg:pt-6">
            <div className="lg:hidden">
              <Label dot={C.cyan}>All baskets</Label>
              <div className="text-3xl font-light text-white" style={glow(C.cyan)}>
                {stats ? stats.indexCount : dash}
              </div>
            </div>
            <div>
              <Label>Basket revenue generated</Label>
              <div className="flex flex-wrap items-baseline gap-2">
                <div className="text-3xl font-light" style={{ color: C.cyan }}>
                  {stats ? fmtUsd(stats.indexFeesTotal * ethUsd) : dash}
                </div>
                <div className="text-xs text-slate-500" style={{ fontFamily: MONO }}>
                  Ξ{stats ? fmtEth(stats.indexFeesTotal) : "—"} · all-time
                </div>
              </div>
            </div>
          </div>

          {/* the SECOND spectrum system: Portfolio, as its own berth beside the
              baskets (the designer, 2026-08-03). Honest empty state — its volume and
              fee slots hold no number until the batcher contracts are on-chain
              (addresses arrive via the ceremony ping; desk w-…-136). */}
          <div className="mt-8 border-t border-white/5 pt-6">
            <div className="flex items-center justify-between">
              <Label dot={C.orange}>Spectrum Portfolio</Label>
              <span
                className="rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                style={{ background: `${C.orange}26`, color: C.orange, border: `1px solid ${C.orange}40` }}
              >
                Launching soon
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <div className="text-[9px] uppercase tracking-[0.14em] text-slate-500">Portfolio volume</div>
                <div className="mt-1 text-xl font-light text-slate-600" style={{ fontFamily: MONO }}>
                  —
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-[0.14em] text-slate-500">Portfolio fees</div>
                <div className="mt-1 text-xl font-light text-slate-600" style={{ fontFamily: MONO }}>
                  —
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── revenue strip ── */}
      <div
        className="relative flex flex-col items-center justify-between gap-8 overflow-hidden rounded-2xl p-6 lg:flex-row lg:p-8"
        style={{ ...glass, border: `1px solid ${C.cyan}33`, ...deckIn(3) }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: `linear-gradient(90deg, ${C.cyan}0d, transparent, ${C.cyan}0d)` }}
        />
        <div className="relative z-10 flex w-full flex-1 flex-col">
          <Label dot={C.cyan}>Protocol revenue to holders</Label>
          <div className="mb-2 text-5xl font-bold tracking-tight text-white lg:text-6xl" style={glow(C.cyan)}>
            {stats ? fmtUsd(todayUsd) : dash}
          </div>
          <div
            className="self-start rounded-sm border px-3 py-1 text-xs font-semibold uppercase tracking-widest"
            style={{ borderColor: `${C.cyan}33`, background: `${C.cyan}1a`, color: C.cyan }}
          >
            last 24 hours
          </div>
        </div>

        <div className="flex w-full flex-1 flex-col justify-center space-y-4 px-0 lg:border-l lg:border-r lg:border-white/10 lg:px-8">
          {(
            [
              ["Today", todayUsd, stats?.feesToHolders24h],
              ["This week", weekUsd, stats?.feesToHolders7d],
              ["All time", lifetimeUsd, stats?.feesToHoldersTotal],
            ] as const
          ).map(([label, usd, eth]) => (
            <div key={label} className="group flex items-center justify-between">
              <span className="text-sm text-slate-400 transition-colors group-hover:text-white">{label}</span>
              <div className="flex items-center gap-3 text-sm" style={{ fontFamily: MONO }}>
                <span className="font-medium" style={{ color: C.cyan }}>
                  {stats ? fmtUsd(usd) : "—"}
                </span>
                <span className="text-slate-600">Ξ{eth != null ? fmtEth(eth) : "—"}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="relative z-10 flex w-full flex-1 flex-col items-start text-left lg:items-end lg:text-right">
          <Label>Revenue per Prism · last 24h</Label>
          <div className="mb-2 text-5xl font-bold tracking-tight lg:text-6xl" style={{ color: C.cyan, ...glow(C.cyan) }}>
            {stats ? (perPrism24h >= 0.01 ? `$${perPrism24h.toFixed(2)}` : "<$0.01") : dash}
          </div>
          <div className="max-w-[340px] text-[11px] leading-relaxed text-slate-500">per token held, from the trailing 24h</div>
        </div>
      </div>

      {/* ── three columns: spectrum feed | prism feed | modules — a swipe
          carousel below lg (the designer 1254) ── */}
      <div style={deckIn(4)}>
      <SwipeRow desktopClass="lg:grid lg:grid-cols-3" itemClass="w-[88%] sm:w-[68%] md:w-[52%]">
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

        {/* the app store panel — apps that build on PRISM, statuses as facts */}
        <div className="flex h-[500px] flex-col rounded-2xl" style={{ ...glass, borderTop: `2px solid ${C.purple}80` }}>
          <div className="flex items-center gap-2 border-b border-white/5 p-5">
            <div className="h-2 w-2 rounded-full" style={{ background: C.purple }} />
            <h3 className="font-semibold text-white">Apps aboard</h3>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            {APPS.map((m) => {
              const inner = (
                <div
                  className={`group relative overflow-hidden rounded-xl border border-white/10 p-4 transition-all ${m.href ? "cursor-pointer hover:bg-white/5" : ""}`}
                  style={{ background: "rgba(10,12,20,0.5)" }}
                >
                  <div className="relative z-10 flex items-start gap-4">
                    <AppIcon name={m.name} color={m.color} />
                    <div className="flex-1">
                      <h4 className="text-sm font-bold text-white">
                        {m.name}
                        {m.external && <span className="ml-1.5 text-[10px] text-slate-500">↗</span>}
                      </h4>
                      <p className="mt-1 text-xs leading-relaxed text-slate-400">{m.blurb}</p>
                      <div className="mt-3 flex items-center gap-2">
                        <span
                          className="rounded px-2 py-0.5 text-[10px] uppercase"
                          style={{ background: `${m.color}26`, color: m.color, border: `1px solid ${m.color}40` }}
                        >
                          {m.status}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
              if (!m.href) return <div key={m.name}>{inner}</div>;
              return m.external ? (
                <a key={m.name} href={m.href} target="_blank" rel="noopener noreferrer" className="block">
                  {inner}
                </a>
              ) : (
                <Link key={m.name} href={m.href} className="block">
                  {inner}
                </Link>
              );
            })}

            {/* the open slot */}
            <Link href={BUILD_SLOT.href} className="block">
              <div className="rounded-xl border border-dashed border-white/15 p-4 text-center transition-all hover:border-white/30 hover:bg-white/[0.02]">
                <h4 className="text-sm font-bold text-white">+ {BUILD_SLOT.name}</h4>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">{BUILD_SLOT.blurb}</p>
              </div>
            </Link>
          </div>
          <div className="border-t border-white/5 px-5 py-3 text-[11px] text-slate-500">
            Instruments:{" "}
            {INSTRUMENTS.map((i, n) => (
              <span key={i.href}>
                <Link href={i.href} className="text-slate-400 transition-colors hover:text-white">
                  {i.name}
                </Link>
                {n < INSTRUMENTS.length - 1 && " · "}
              </span>
            ))}
          </div>
        </div>
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
        {shown.map((e) => (
          <div
            key={e.id}
            className="group flex items-center justify-between rounded-xl border border-transparent p-3 transition-all hover:border-white/5 hover:bg-white/5"
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
                  {e.kind === "burn"
                    ? fmtPrism(e.prism)
                    : e.kind === "launch"
                      ? (e.symbol ?? e.label ?? "New basket")
                      : e.usd != null
                        ? fmtUsd(e.usd)
                        : e.eth != null
                          ? `Ξ${fmtEth(e.eth)}`
                          : "—"}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  {e.kind === "burn"
                    ? "PRISM burned"
                    : e.kind === "launch"
                      ? "Basket launched"
                      : e.side
                        ? e.side === "sell"
                          ? "Basket sell"
                          : "Basket buy"
                        : "LP fee"}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs font-medium" style={{ color }}>
                {e.kind === "burn" ? "BUY & BURN" : e.kind === "launch" ? "LAUNCH" : e.side ? "TRADE" : "LP REVENUE"}
              </div>
              <div className="text-[10px] text-slate-500">
                {e.note ? `${e.note.slice(0, 34)}${e.note.length > 34 ? "…" : ""} · ` : ""}
                {ago(e.ts)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
