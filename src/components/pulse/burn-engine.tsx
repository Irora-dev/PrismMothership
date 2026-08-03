"use client";

import { useEffect, useRef, useState } from "react";
import type { PulseStats } from "@/lib/feed/types";
import type { SessionTotals } from "@/hooks/useActivityFeed";
import { fmtEth, fmtPrism, fmtUsdFull } from "@/lib/feed/format";
import { useMonotonicUsd, LIFETIME_FLOOR_USD } from "@/hooks/useMonotonicUsd";
import { PRISM_LIVE } from "@/lib/chain/constants";
import { CountUp } from "./count-up";

const Label = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[10px] uppercase tracking-[0.22em] text-slate-500 font-semibold">{children}</div>
);

const LEG_FACTOR = 2; // ETH leg + ≈equal PRISM leg

export function BurnEngine({ stats, session }: { stats: PulseStats | null; session?: SessionTotals; mode?: "live" | "demo" | null }) {
  const ethUsd = stats?.ethUsd ?? 0;

  const baseTotal = stats?.feesToHoldersTotal ?? 0;

  // Index fees pile up live too (USD-native), reconciling up to the server total.
  const [liveIdxUsd, setLiveIdxUsd] = useState(0);
  const seenIdxRef = useRef(0);
  const baseIdxUsd = (stats?.indexFeesTotal ?? 0) * ethUsd;

  useEffect(() => {
    if (stats) setLiveIdxUsd((v) => Math.max(v, (stats.indexFeesTotal ?? 0) * ethUsd));
  }, [stats, ethUsd]);

  useEffect(() => {
    const u = session?.indexFeesUsd ?? 0;
    const delta = Math.max(0, u - seenIdxRef.current);
    seenIdxRef.current = u;
    if (delta > 0) setLiveIdxUsd((v) => v + delta);
  }, [session?.indexFeesUsd]);

  // Persisted monotonic FLOOR of the base lifetime-yield USD — never ticks down on an
  // ETH-price dip or a reload. The live session climb is then added on TOP, so the
  // headline always rises while you watch instead of freezing under a stale peak.
  const floorUsd = useMonotonicUsd(baseTotal * ethUsd, "pb_lifetime_usd", LIFETIME_FLOOR_USD);
  // PRISM-pool LP fees only (ETH + matched PRISM leg) — basket fees pay basket
  // holders and the burn, not PRISM holders, so they don't belong in this figure.
  const sessionClimbUsd = (session?.ethVolume ?? 0) * LEG_FACTOR * ethUsd;
  const lifetimeUsd = floorUsd + sessionClimbUsd;

  const feesEthTotal = (stats?.feesEthTotal ?? 0) + (session?.ethVolume ?? 0);
  const feesPrismTotal = stats?.feesPrismTotal ?? 0;
  const indexCount = stats?.indexCount ?? 0;
  const indexFees = stats?.indexFeesTotal ?? 0;
  const indexFeesUsdLive = liveIdxUsd || baseIdxUsd;

  return (
    // outer: margins (applied by the wrapping PixelReveal) reserve room for the circle that overflows top & bottom
    <div className="relative">
      {/* circle anchor — same box as the card so the hub centres on it */}
      <div className="relative">
        {/* the rectangle card, sitting behind the circle */}
        <div className="glass-card relative overflow-hidden px-5 sm:px-16 pt-[150px] pb-12 xl:py-14 xl:min-h-[320px] flex flex-col xl:flex-row xl:items-center xl:justify-between gap-10 xl:gap-6">
          <div className="absolute -left-20 -bottom-24 w-72 h-72 rounded-full blur-3xl opacity-20 pointer-events-none" style={{ background: "#9a3412" }} />
          <div className="absolute -right-20 -bottom-24 w-72 h-72 rounded-full blur-3xl opacity-20 pointer-events-none" style={{ background: "#1e40af" }} />


          {/* the burn engine (left) — content hugs the far-left edge, clear of the circle.
              Below xl the two burn stats sit SIDE BY SIDE (one row of the mobile
              2×2), instead of stacking into a four-deep column. */}
          <div className="relative z-10 flex-1 xl:max-w-[340px] text-center xl:text-left grid grid-cols-2 gap-x-4 gap-y-2 items-start xl:block">
            {/* Pre-launch: PRISM's figures are honest zeros until the community's new
                token is wired, so say so where the dead numbers actually are. Sits in
                the flow — an absolutely-placed strip at the card's top edge gets cut
                in half by the yield dome that overflows it. */}
            {!PRISM_LIVE && (
              <div className="col-span-2 xl:mb-5 mb-1 inline-flex items-center gap-2 rounded-full border border-amber-300/25 bg-amber-300/[0.07] px-3 py-1.5 text-[11px] sm:text-[12px] font-semibold mx-auto xl:mx-0 w-fit">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-300 shrink-0" style={{ boxShadow: "0 0 8px #fcd34d" }} />
                <span className="text-amber-100/90">A new community PRISM is launching soon</span>
              </div>
            )}
            {/* equal-height top blocks keep the second stat of each column on
                the same baseline across the card */}
            <div className="xl:min-h-[112px]">
              <Label>Total PRISM burnt</Label>
              <div className="font-mono font-bold text-[1.7rem] sm:text-[2.2rem] xl:text-[2.6rem] leading-none mt-2.5" style={{ color: "color-mix(in srgb, #fb923c 78%, #e2e8f0)" }}>
                {stats ? <CountUp value={stats.totalBurned} format={(n) => n.toLocaleString("en-US", { maximumFractionDigits: 2 })} /> : "—"}
              </div>
              <div className="font-mono text-[11px] xl:text-[12px] text-slate-500 mt-2.5">
                of {stats?.cap.toLocaleString("en-US") ?? "5,000"} cap · {stats ? `${((stats.totalBurned / stats.cap) * 100).toFixed(2)}%` : "—"}
              </div>
              {/* burn progress toward the hard cap */}
              <div className="mt-3 h-1 rounded-full bg-white/[0.07] overflow-hidden max-w-[250px] mx-auto xl:mx-0">
                <div
                  className="h-full rounded-full transition-[width] duration-700"
                  style={{
                    width: `${Math.min(100, Math.max(stats ? (stats.totalBurned / stats.cap) * 100 : 0, 0.5))}%`,
                    background: "linear-gradient(90deg,#f97316,#fb923c)",
                  }}
                />
              </div>
            </div>

            <div className="hidden xl:block border-t border-white/[0.07] my-6 max-w-[250px] mx-auto xl:mx-0" />

            {/* the trailing-24h burn sits with its lifetime sibling — replaces
                the old pending-buy&burn block (pending value reaches the burn
                figures anyway once it lands; still visible on /spectrum) */}
            <div>
              <Label>Burned · last 24h</Label>
              <div className="font-mono font-bold text-[1.7rem] sm:text-[2.2rem] xl:text-[2.6rem] leading-none mt-2.5" style={{ color: "color-mix(in srgb, #fb923c 78%, #e2e8f0)" }}>
                {stats ? <CountUp value={stats.prismBurnedToday} format={(n) => fmtPrism(n)} /> : "—"}
              </div>
              <div className="font-mono text-[11px] xl:text-[12px] text-slate-500 mt-2.5">
                PRISM · {stats && stats.totalBurned > 0 ? `${((stats.prismBurnedToday / stats.totalBurned) * 100).toFixed(1)}% of all burns ever` : "—"}
              </div>
            </div>
          </div>

          {/* reserve the centre column for the circle (desktop) */}
          <div className="hidden xl:block w-[400px] shrink-0" aria-hidden />

          {/* Spectrum baskets (right) — content hugs the far-right edge, clear of the circle.
              Below xl these two pair up as the SECOND row of the mobile 2×2 —
              revenue leads (order-first), baskets beside it, per the 1102 ask. */}
          <div className="relative z-10 flex-1 xl:max-w-[340px] text-center xl:text-right grid grid-cols-2 gap-x-4 gap-y-2 items-start xl:block">
            <div className="xl:min-h-[112px]">
              <Label>All Baskets</Label>
              <div className="font-mono font-bold text-[1.7rem] sm:text-[2.2rem] xl:text-[2.6rem] leading-none mt-2.5" style={{ color: "color-mix(in srgb, #38bdf8 78%, #e2e8f0)" }}>
                {stats ? <CountUp value={indexCount} format={(n) => n.toFixed(0)} /> : "—"}
              </div>
              {/* The chains basket discovery actually covers. Robinhood was missing,
                  which read as wrong the moment the first basket launched there: the
                  count said 1 while the chips said "Ethereum · Base". These label
                  COVERAGE, not where each basket lives — deriving them from live
                  per-chain counts needs a new field on the stats payload. */}
              <div className="flex flex-wrap items-center gap-1.5 mt-2.5 justify-center xl:justify-end">
                <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400 rounded-full px-2 py-0.5 bg-white/[0.05] border border-white/10">Ethereum</span>
                <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400 rounded-full px-2 py-0.5 bg-white/[0.05] border border-white/10">Base</span>
                <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400 rounded-full px-2 py-0.5 bg-white/[0.05] border border-white/10">Robinhood</span>
              </div>
            </div>

            <div className="hidden xl:block border-t border-white/[0.07] my-6 max-w-[250px] mx-auto xl:ml-auto xl:mr-0" />

            <div className="order-first xl:order-none">
              <Label>Basket revenue generated</Label>
              <div className="font-mono font-bold text-[1.7rem] sm:text-[2.2rem] xl:text-[2.6rem] leading-none mt-2.5" style={{ color: "color-mix(in srgb, #38bdf8 78%, #e2e8f0)" }}>
                {stats ? <CountUp value={indexFeesUsdLive} format={(n) => fmtUsdFull(n)} /> : "—"}
              </div>
              <div className="font-mono text-[11px] xl:text-[12px] text-slate-500 mt-2.5">
                Ξ{fmtEth(ethUsd > 0 ? indexFeesUsdLive / ethUsd : indexFees)} · all-time
              </div>
            </div>
          </div>
        </div>

        {/* the yield hub — opaque disc, larger than the card so it breaks out top & bottom */}
        <div
          className="absolute left-1/2 top-0 xl:top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 w-[240px] h-[240px] xl:w-[360px] xl:h-[360px] rounded-full flex flex-col items-center justify-center text-center px-8 pb-7"
          style={{
            // two-layer fill: a soft light pooled at the very top (the light source)
            // over the base green-to-black disc — together with the insets below this
            // makes the hub read as a lit 3D dome rather than a flat ring.
            background:
              "radial-gradient(125% 80% at 50% 3%, rgba(190,255,214,0.16) 0%, rgba(190,255,214,0) 46%), " +
              "radial-gradient(circle at 50% 42%, #12291c 0%, #0a0e13 74%)",
            border: "1px solid rgba(34,197,94,0.38)",
            boxShadow: [
              "0 0 90px rgba(34,197,94,0.20)", // ambient green halo
              "0 30px 70px rgba(0,0,0,0.62)", // drop shadow — lifts the disc off the card
              "inset 0 4px 10px rgba(255,255,255,0.12)", // top-rim catch-light (inner light at the top)
              "inset 0 -38px 66px rgba(0,0,0,0.55)", // bottom inner shadow — gives the dome its depth
              "inset 0 0 55px rgba(34,197,94,0.10)", // inner green ambiance
            ].join(", "),
          }}
        >
          <span className="dome-halo" aria-hidden />
          <div className="text-[11px] uppercase tracking-[0.22em] font-semibold text-emerald-300/80">Lifetime revenue</div>
          <div className="font-mono font-bold text-5xl xl:text-6xl leading-none mt-2.5" style={{ color: "#22c55e" }}>
            {stats ? <CountUp value={lifetimeUsd} format={(n) => fmtUsdFull(n)} /> : "—"}
          </div>
          <div className="flex items-center justify-center gap-5 mt-4">
            <div>
              <div className="font-mono font-bold text-lg leading-none" style={{ color: "#22c55e" }}>Ξ{stats ? <CountUp value={feesEthTotal} format={(n) => fmtEth(n)} /> : "—"}</div>
              <div className="text-[9px] uppercase tracking-[0.12em] text-slate-500 mt-1">ETH</div>
            </div>
            <div className="w-px h-8 bg-white/10" />
            <div>
              <div className="font-mono font-bold text-lg leading-none" style={{ color: "#22c55e" }}>{stats ? <CountUp value={feesPrismTotal} format={(n) => fmtPrism(n)} /> : "—"}</div>
              <div className="text-[9px] uppercase tracking-[0.12em] text-slate-500 mt-1">PRISM</div>
            </div>
          </div>
          {/* title curved along the bottom of the circle */}
          <svg className="absolute inset-0 h-full w-full pointer-events-none" viewBox="0 0 100 100" aria-hidden>
            <defs>
              <path id="ecosystem-arc" d="M 8 50 A 42 42 0 0 0 92 50" fill="none" />
            </defs>
            <text fontSize="4.2" fontWeight="600" letterSpacing="1.7" fill="#cbd5e1" style={{ fontFamily: "inherit" }}>
              <textPath href="#ecosystem-arc" startOffset="50%" textAnchor="middle">THE PRISM ECOSYSTEM</textPath>
            </text>
          </svg>
        </div>
      </div>
    </div>
  );
}
