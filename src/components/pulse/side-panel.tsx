"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { PulseStats } from "@/lib/feed/types";
import type { SessionTotals } from "@/hooks/useActivityFeed";
import { fmtEth, fmtEthFine, fmtUsdFull, relTime } from "@/lib/feed/format";
import { useMonotonicUsd, LIFETIME_FLOOR_USD } from "@/hooks/useMonotonicUsd";
import { CountUp } from "./count-up";

function Row({
  label,
  children,
  accent,
}: {
  label: string;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[12px] text-slate-400">{label}</span>
      <span className="font-mono font-bold text-[15px]" style={{ color: accent ?? "#e2e8f0" }}>
        {children}
      </span>
    </div>
  );
}

export function SidePanel({
  stats,
  session,
  className = "",
  style,
}: {
  stats: PulseStats | null;
  session: SessionTotals;
  mode?: "live" | "demo" | null;
  className?: string;
  style?: CSSProperties;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const ethUsd = stats?.ethUsd ?? 0;
  const perPrism = stats && stats.supply > 0 ? stats.feesToHolders24h / stats.supply : 0;
  const burnedPct = stats ? (stats.totalBurned / stats.cap) * 100 : 0;

  // "All time" is cumulative, so its $ value should never tick backwards on an
  // ETH-price wiggle or a reload — use a persisted monotonic max (Ξ leg is already monotonic).
  const allTimeUsd = useMonotonicUsd((stats?.feesToHoldersTotal ?? 0) * ethUsd, "pb_lifetime_usd", LIFETIME_FLOOR_USD);

  return (
    <div className={`space-y-4 lg:sticky lg:top-4 ${className}`} style={style}>
      {/* fee counters */}
      <div className="glass-card p-5 relative overflow-hidden">
        <div
          className="absolute -right-10 -top-12 w-44 h-44 rounded-full blur-3xl opacity-20 pointer-events-none"
          style={{ background: "#22d3ee" }}
        />
        <div className="flex items-center gap-2 mb-4 relative z-10">
          <span className="text-base">💧</span>
          <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold">
            Protocol revenue to holders
          </span>
        </div>

        {/* streaming now — fills up live as fees land */}
        <div className="relative z-10 mb-4">
          <div className="font-mono font-bold text-6xl sm:text-7xl leading-none" style={{ color: "#22d3ee" }}>
            <CountUp value={session.ethVolume * ethUsd} format={(n) => fmtUsdFull(n)} />
          </div>
          <div className="text-sm uppercase tracking-[0.16em] text-slate-300 font-semibold leading-tight mt-3">
            Streaming now<span className="block text-slate-500">while you watch</span>
          </div>
        </div>

        {/* timeframe counters */}
        <div className="space-y-2.5 pt-3 border-t border-white/10 relative z-10">
          <Row label="Today" accent="#22d3ee">
            {stats ? (
              <>
                <CountUp value={stats.feesToHolders24h * ethUsd} format={(n) => fmtUsdFull(n)} />
                <span className="text-slate-500 text-[11px] font-medium ml-1.5">Ξ{fmtEth(stats.feesToHolders24h)}</span>
              </>
            ) : (
              "—"
            )}
          </Row>
          <Row label="This week" accent="#22d3ee">
            {stats ? (
              <>
                <CountUp value={stats.feesToHolders7d * ethUsd} format={(n) => fmtUsdFull(n)} />
                <span className="text-slate-500 text-[11px] font-medium ml-1.5">Ξ{fmtEth(stats.feesToHolders7d)}</span>
              </>
            ) : (
              "—"
            )}
          </Row>
          <Row label="All time" accent="#22d3ee">
            {stats ? (
              <>
                <CountUp value={allTimeUsd} format={(n) => fmtUsdFull(n)} />
                <span className="text-slate-500 text-[11px] font-medium ml-1.5">Ξ{fmtEth(stats.feesToHoldersTotal)}</span>
              </>
            ) : (
              "—"
            )}
          </Row>
        </div>

        {/* revenue per token (trailing 24h) — a factual on-chain figure, no projection */}
        <div className="mt-4 pt-4 border-t border-white/10 relative z-10">
          <div className="text-[12px] text-slate-400 font-medium">Revenue per PRISM · last 24h</div>
          <div className="font-mono font-bold text-3xl leading-none mt-1.5" style={{ color: "#38bdf8" }}>
            {stats ? <CountUp value={perPrism * ethUsd} format={(n) => `$${n.toFixed(2)}`} /> : "—"}
          </div>
          <div className="font-mono text-[11px] text-slate-500 mt-1.5">Ξ{stats ? fmtEthFine(perPrism) : "—"}</div>
        </div>
      </div>

      {/* supply (burns now live in the burn-engine area) */}
      <div className="glass-card p-5 space-y-2.5">
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold mb-1">
          Supply
        </div>
        <Row label="In circulation">
          {stats ? <CountUp value={stats.supply} format={(n) => n.toLocaleString("en-US", { maximumFractionDigits: 0 })} /> : "—"}
          <span className="text-slate-500 text-[12px] font-medium ml-1">/ 5,000</span>
        </Row>
        <Row label="Burned of cap" accent="#fb923c">
          {stats ? `${burnedPct.toFixed(2)}%` : "—"}
        </Row>
        <Row label="Last buy & burn" accent="#fb923c">
          {stats?.lastBurnTs ? relTime(stats.lastBurnTs, now) : "—"}
        </Row>
      </div>

    </div>
  );
}
