"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MothershipShell } from "@/components/mothership/shell";
import { AmbientBlooms } from "@/components/mothership/blooms";
import { HoloPrism } from "@/components/mothership/holo-prism";
import { C, MONO, RAINBOW, glass, glow } from "@/components/mothership/style";
import { CountUp } from "@/components/pulse/count-up";
import { fmtEth, fmtPrism, fmtUsd, fmtUsdFull } from "@/lib/feed/format";
import type { PulseStats } from "@/lib/feed/types";

// ── How it works — the full revamp (the designer's session-end ask, 2026-08-03) ─────
// More beautiful, simpler, easier to understand. One idea carries the page:
// FOLLOW THE MONEY. Trades beam into the prism, the prism splits them into a
// holder stream and a burn stream, and every number on the diagram is live
// chain data. Three short steps under it, the supply panel, one CTA. No
// chapter wall, no em dashes, Mothership language throughout.

const dash = <span className="text-slate-600">—</span>;

// one beam of the split diagram: a soft base line plus a marching dash line
function Beam({ d, color, dur = 1.6 }: { d: string; color: string; dur?: number }) {
  return (
    <>
      <path d={d} fill="none" stroke={color} strokeOpacity="0.18" strokeWidth="2" />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="10 18"
        style={{ animation: `ms-beam-flow ${dur}s linear infinite`, filter: `drop-shadow(0 0 6px ${color}80)` }}
      />
    </>
  );
}

export default function HowItWorksPage() {
  const [stats, setStats] = useState<PulseStats | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = () =>
      fetch("/api/feed", { cache: "no-store" })
        .then((r) => r.json())
        .then((d: { stats?: PulseStats }) => {
          if (alive && d.stats) setStats(d.stats);
        })
        .catch(() => {});
    tick();
    const id = setInterval(tick, 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const ethUsd = stats?.ethUsd ?? 0;
  const prismUsd = stats?.prismUsd ?? 0;
  const cap = stats?.cap ?? 5000;
  const burned = stats?.totalBurned ?? 0;
  const burnedPct = stats ? (burned / cap) * 100 : 0;
  const supply = stats?.supply ?? 0;
  const lifetimeUsd = stats ? stats.feesEthTotal * ethUsd + stats.feesPrismTotal * prismUsd : 0;
  const indexFeesUsd = stats ? stats.indexFeesTotal * ethUsd : 0;
  const perPrism24h = stats && stats.supply > 0 ? (stats.feesToHolders24h / stats.supply) * ethUsd : 0;

  return (
    <MothershipShell>
      <AmbientBlooms />

      <main className="relative z-10 mx-auto max-w-[1080px] px-5 md:px-6 pt-12 md:pt-16 pb-28">
        {/* ── hero ── */}
        <div className="text-center">
          {/* the designer's title (2026-08-03): the hook line IS the headline */}
          <h1 className="mx-auto max-w-4xl text-3xl font-black tracking-tight text-white sm:text-5xl" style={{ textWrap: "balance" }}>
            Prism is a Uni V4 hook that shares 100% of its own protocol LP fees with holders.
          </h1>
          <p className="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-slate-400 sm:text-base" style={{ textWrap: "balance" }}>
            Along with buying and burning PRISM across its own trading activity and ecosystem apps.
          </p>
        </div>

        {/* ── the split diagram: trades in, holders + burn out ── */}
        <div className="relative mt-10 overflow-hidden rounded-2xl p-6 sm:p-10" style={{ ...glass, border: `1px solid ${C.green}33` }}>
          <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(circle at 50% 42%, ${C.purple}12 0%, rgba(0,0,0,0) 62%)` }} />

          <div className="relative z-10 grid grid-cols-1 items-center gap-8 lg:grid-cols-12">
            {/* money in */}
            <div className="lg:col-span-3">
              <div className="rounded-xl p-4" style={{ ...glass, borderTop: `2px solid ${C.cyan}80` }}>
                <div className="text-[9px] uppercase tracking-[0.16em] text-slate-500">Money in</div>
                <div className="mt-1.5 text-lg font-bold text-white">Every trade pays a fee</div>
                <ul className="mt-3 space-y-2 text-[12px] leading-snug text-slate-400">
                  <li className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: C.cyan }} />
                    PRISM pool trades · 1% fee
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: C.purple }} />
                    Spectrum basket trades
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: C.orange }} />
                    Portfolio buys · launching soon
                  </li>
                </ul>
              </div>
            </div>

            {/* the prism + beams */}
            <div className="relative lg:col-span-6">
              <div className="relative mx-auto flex h-[280px] max-w-[520px] items-center justify-center">
                {/* beams: two in from the left, two out to the right */}
                <svg viewBox="0 0 520 280" className="absolute inset-0 h-full w-full" aria-hidden preserveAspectRatio="none">
                  <Beam d="M0 100 C 120 100, 150 128, 218 138" color={C.cyan} dur={1.8} />
                  <Beam d="M0 190 C 120 190, 150 156, 218 146" color={C.purple} dur={2.2} />
                  <Beam d="M302 132 C 380 118, 420 96, 520 88" color={C.green} dur={1.5} />
                  <Beam d="M302 152 C 380 166, 420 190, 520 198" color={C.orange} dur={2.6} />
                </svg>
                <div
                  className="pointer-events-none absolute left-1/2 top-1/2 h-[190px] w-[190px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed"
                  style={{ borderColor: `${C.green}26`, animation: "spin 22s linear infinite" }}
                />
                <div style={{ filter: `drop-shadow(0 18px 30px rgba(0,0,0,0.6)) drop-shadow(0 0 34px ${C.purple}33)` }}>
                  <HoloPrism size={116} spinSec={9} />
                </div>
              </div>
              <p className="mt-2 text-center text-[11px] text-slate-500">
                The split is enforced by the token&apos;s own hook contract, not by anyone&apos;s promise.{" "}
                <Link href="/contracts" className="text-slate-400 underline underline-offset-2 hover:text-white">
                  Verify it
                </Link>
              </p>
            </div>

            {/* money out */}
            <div className="flex flex-col gap-4 lg:col-span-3">
              <div className="rounded-xl p-4" style={{ ...glass, borderTop: `2px solid ${C.green}80` }}>
                <div className="text-[9px] uppercase tracking-[0.16em] text-slate-500">To holders</div>
                <div className="mt-1 text-2xl font-bold tabular-nums text-white" style={{ fontFamily: MONO, ...glow(C.green) }}>
                  {stats ? <CountUp value={lifetimeUsd} format={(n) => fmtUsd(n)} /> : dash}
                </div>
                <div className="mt-1 text-[10px] text-slate-500" style={{ fontFamily: MONO }}>
                  Ξ{stats ? fmtEth(stats.feesEthTotal) : "—"} + {stats ? fmtPrism(stats.feesPrismTotal) : "—"} PRISM · all time
                </div>
              </div>
              <div className="rounded-xl p-4" style={{ ...glass, borderTop: `2px solid ${C.orange}80` }}>
                <div className="text-[9px] uppercase tracking-[0.16em] text-slate-500">Burned forever</div>
                <div className="mt-1 text-2xl font-bold tabular-nums text-white" style={{ fontFamily: MONO, ...glow(C.orange) }}>
                  {stats ? <CountUp value={burned} format={(n) => fmtPrism(n)} /> : dash}
                </div>
                <div className="mt-1 text-[10px] text-slate-500" style={{ fontFamily: MONO }}>
                  of {cap.toLocaleString("en-US")} ever · supply only shrinks
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── the three steps ── */}
        <div className="mt-14 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="flex flex-col rounded-2xl p-6" style={{ ...glass, borderTop: `2px solid ${C.green}80` }}>
            <div className="text-2xl font-bold" style={{ fontFamily: MONO, color: C.green, ...glow(C.green) }}>
              01
            </div>
            <h3 className="mt-4 text-lg font-bold text-white">The token is the position</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              No wrapper, no staking. ETH-side fees: 100% to holders. PRISM side: 80% holders, 20% burned.
            </p>
            {/* the split, drawn — fixed-height slot so all three cards align */}
            <div className="mt-auto flex h-[76px] flex-col justify-center pt-4">
              <div className="flex h-2 w-full overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                <span style={{ width: "80%", background: C.green }} />
                <span style={{ width: "20%", background: C.orange }} />
              </div>
              <div className="mt-2 flex justify-between text-[10px]" style={{ fontFamily: MONO }}>
                <span style={{ color: C.green }}>80% holders</span>
                <span style={{ color: C.orange }}>20% burned</span>
              </div>
            </div>
            <div className="mt-4 flex h-[38px] items-center border-t border-white/5 text-[11px] text-slate-500" style={{ fontFamily: MONO }}>
              revenue per PRISM · 24h: {stats ? `$${perPrism24h.toFixed(2)}` : "—"}
            </div>
          </div>

          <div className="flex flex-col rounded-2xl p-6" style={{ ...glass, borderTop: `2px solid ${C.purple}80` }}>
            <div className="text-2xl font-bold" style={{ fontFamily: MONO, color: C.purple, ...glow(C.purple) }}>
              02
            </div>
            <h3 className="mt-4 text-lg font-bold text-white">Every app feeds the same prism</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Every basket routes 10% of its fees into buying and burning PRISM. More apps, more fuel.
            </p>
            <div className="mt-auto flex h-[76px] items-center justify-between rounded-xl border border-white/5 px-4" style={{ background: "rgba(255,255,255,0.03)" }}>
              <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Basket fees · all time</span>
              <span className="text-sm font-semibold tabular-nums" style={{ fontFamily: MONO, color: C.purple }}>
                {stats ? <CountUp value={indexFeesUsd} format={(n) => fmtUsdFull(n)} /> : dash}
              </span>
            </div>
            <div className="mt-4 flex h-[38px] items-center border-t border-white/5 text-[11px] text-slate-500" style={{ fontFamily: MONO }}>
              baskets live: {stats ? stats.indexCount : "—"} · Ethereum · Base · Robinhood
            </div>
          </div>

          <div className="flex flex-col rounded-2xl p-6" style={{ ...glass, borderTop: `2px solid ${C.orange}80` }}>
            <div className="text-2xl font-bold" style={{ fontFamily: MONO, color: C.orange, ...glow(C.orange) }}>
              03
            </div>
            <h3 className="mt-4 text-lg font-bold text-white">The supply only shrinks</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Hard capped at {cap.toLocaleString("en-US")}, no mint function. Every burn is forever.
            </p>
            <div className="mt-auto flex h-[76px] flex-col justify-center pt-4">
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Burned of cap</span>
                <span className="text-lg font-bold tabular-nums" style={{ fontFamily: MONO, color: C.orange }}>
                  {stats ? <CountUp value={burnedPct} format={(n) => `${n.toFixed(2)}%`} /> : dash}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                <div
                  className="h-full rounded-full transition-[width] duration-700"
                  style={{ width: `${Math.min(100, Math.max(burnedPct, 0.4))}%`, background: `linear-gradient(90deg, ${C.orange}, #f97316)` }}
                />
              </div>
            </div>
            <div className="mt-4 flex h-[38px] items-center justify-between border-t border-white/5 text-[11px] text-slate-500" style={{ fontFamily: MONO }}>
              <span>{stats ? fmtPrism(burned) : "—"} burned</span>
              <span>{supply ? `${fmtPrism(supply)} left` : `${cap.toLocaleString("en-US")} cap`}</span>
            </div>
          </div>
        </div>

        {/* ── the honest words ── */}
        <p className="mx-auto mt-10 max-w-2xl text-center text-[12px] leading-relaxed text-slate-500">
          Revenue tracks third-party trading volume, varies, and can be zero. It is not a yield, a return, or
          a promise, and none of this describes or predicts the token&apos;s price.
        </p>

        {/* ── CTA ── */}
        <section className="relative mt-14 overflow-hidden rounded-2xl p-8 text-center sm:p-12" style={{ ...glass, border: `1px solid ${C.green}33` }}>
          <div className="absolute left-0 top-0 h-[2px] w-full" style={{ background: RAINBOW, opacity: 0.8 }} />
          <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(circle at 50% 0%, ${C.green}14 0%, rgba(0,0,0,0) 60%)` }} />
          <h2 className="relative z-10 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            One token. A Mothership of Apps.
          </h2>
          <p className="relative z-10 mx-auto mt-3 max-w-xl text-sm leading-relaxed text-slate-400">
            All of that on-chain revenue converges on one prism. Trade it, hold it, claim from it.
          </p>
          <div className="relative z-10 mt-7 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/trade"
              className="rounded-xl px-6 py-3 text-sm font-semibold text-white transition-all duration-300 hover:brightness-110"
              style={{ background: `linear-gradient(90deg, ${C.purple}, ${C.cyan})`, boxShadow: `0 0 20px ${C.purple}4d` }}
            >
              Trade PRISM
            </Link>
            <Link
              href="/claim"
              className="rounded-xl border border-white/10 px-6 py-3 text-sm font-semibold text-slate-300 transition-colors hover:border-white/20 hover:text-white"
              style={{ background: "rgba(255,255,255,0.03)" }}
            >
              Claim revenue
            </Link>
          </div>
        </section>

        <p className="mx-auto mt-8 max-w-2xl text-center text-[11px] leading-relaxed text-slate-600">
          This is an informational dashboard showing public on-chain activity. It is not investment advice, an
          offer, or a solicitation.{" "}
          <Link href="/legal" className="text-slate-500 underline underline-offset-2 hover:text-slate-300">
            Legal &amp; disclaimers
          </Link>
          {" · "}
          <Link href="/privacy" className="text-slate-500 underline underline-offset-2 hover:text-slate-300">
            Privacy
          </Link>
          .
        </p>
      </main>
    </MothershipShell>
  );
}
