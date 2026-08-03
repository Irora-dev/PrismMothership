"use client";

import type { PulseStats } from "@/lib/feed/types";
import type { SessionTotals } from "@/hooks/useActivityFeed";
import { fmtEth, fmtUsdFull } from "@/lib/feed/format";
import { useMonotonicUsd, LIFETIME_FLOOR_USD } from "@/hooks/useMonotonicUsd";
import { CountUp } from "./count-up";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-[12px] text-slate-400">{label}</span>
      <span className="font-mono font-bold text-[14px]" style={{ color: "#22d3ee" }}>
        {children}
      </span>
    </div>
  );
}

// Full-width strip above the Spectrum / Live-activity columns: the live
// "streaming now" counter on the left, the trailing-24h revenue-per-PRISM
// figure on the right, with the timeframe totals bridging the two.
export function PulseStrip({
  stats,
  session,
}: {
  stats: PulseStats | null;
  session: SessionTotals;
}) {
  const ethUsd = stats?.ethUsd ?? 0;
  // Revenue streamed to PRISM holders while this tab is open: PRISM-pool LP
  // fees only. Basket fees are deliberately excluded — their waterfall pays
  // basket holders and the PRISM buy-and-burn, never PRISM holders directly.
  const streamingUsd = session.ethVolume * ethUsd;
  const perPrism = stats && stats.supply > 0 ? stats.feesToHolders24h / stats.supply : 0;

  // "All time" is cumulative, so its $ value should never tick backwards on an
  // ETH-price wiggle or a reload — use a persisted monotonic max.
  const allTimeUsd = useMonotonicUsd((stats?.feesToHoldersTotal ?? 0) * ethUsd, "pb_lifetime_usd", LIFETIME_FLOOR_USD);

  return (
    <div className="glass-card relative overflow-hidden p-5 sm:p-6">
      <div
        className="absolute -left-12 -top-14 w-52 h-52 rounded-full blur-3xl opacity-20 pointer-events-none"
        style={{ background: "#22d3ee" }}
      />
      <div
        className="absolute -right-12 -bottom-14 w-52 h-52 rounded-full blur-3xl opacity-15 pointer-events-none"
        style={{ background: "#38bdf8" }}
      />

      <div className="relative z-10 grid gap-6 md:gap-8 md:grid-cols-[1.2fr_auto_1fr_auto_1.2fr] items-center">
        {/* streaming now — fills up live as fees land */}
        <div className="text-center md:text-left">
          <div className="flex items-center justify-center md:justify-start gap-2 mb-3">
            <span className="pulse-live-dot" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold">
              Protocol revenue to holders
            </span>
          </div>
          <div className="font-mono font-bold text-5xl sm:text-6xl leading-none" style={{ color: "#22d3ee" }}>
            <CountUp value={streamingUsd} format={(n) => fmtUsdFull(n)} />
          </div>
          <div className="text-sm uppercase tracking-[0.16em] text-slate-300 font-semibold leading-tight mt-3 whitespace-nowrap">
            Streaming now<span className="text-slate-500"> · while you watch</span>
          </div>
        </div>

        <div className="hidden md:block w-px self-stretch bg-white/10" aria-hidden />

        {/* timeframe totals — the bridge between the live tick and the 24h figure */}
        <div className="space-y-2.5 border-t border-white/10 pt-4 md:border-t-0 md:pt-0">
          <Row label="Today">
            {stats ? (
              <>
                <CountUp value={stats.feesToHolders24h * ethUsd} format={(n) => fmtUsdFull(n)} />
                <span className="text-slate-500 text-[11px] font-medium ml-1.5">Ξ{fmtEth(stats.feesToHolders24h)}</span>
              </>
            ) : (
              "—"
            )}
          </Row>
          <Row label="This week">
            {stats ? (
              <>
                <CountUp value={stats.feesToHolders7d * ethUsd} format={(n) => fmtUsdFull(n)} />
                <span className="text-slate-500 text-[11px] font-medium ml-1.5">Ξ{fmtEth(stats.feesToHolders7d)}</span>
              </>
            ) : (
              "—"
            )}
          </Row>
          <Row label="All time">
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

        <div className="hidden md:block w-px self-stretch bg-white/10" aria-hidden />

        {/* revenue per token (trailing 24h) — a factual on-chain figure, no projection */}
        <div className="text-center md:text-right border-t border-white/10 pt-4 md:border-t-0 md:pt-0">
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold mb-3">
            Revenue per PRISM · last 24h
          </div>
          <div className="font-mono font-bold text-5xl sm:text-6xl leading-none" style={{ color: "#38bdf8" }}>
            {stats ? <CountUp value={perPrism * ethUsd} format={(n) => `$${n.toFixed(2)}`} /> : "—"}
          </div>
          <div className="text-[11px] text-slate-500 mt-3">per token held</div>
        </div>
      </div>
    </div>
  );
}
