"use client";

import { useEffect, useState } from "react";
import { fmtCompactValue } from "./time-chart";

const HUE = "#f59e0b";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// Live countdown to the moment the oldest pending bridge unlocks. Ticks every
// second; renders a calm empty state when nothing is in flight.
export function NextBurnCard({
  pendingEth,
  nextBurnTs,
  ethUsd,
}: {
  pendingEth: number;
  nextBurnTs: number | null;
  ethUsd: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const hasPot = pendingEth > 0 && nextBurnTs != null;
  const leftMs = hasPot ? nextBurnTs! - now : 0;
  const d = Math.floor(leftMs / 86_400_000);
  const h = Math.floor((leftMs % 86_400_000) / 3_600_000);
  const m = Math.floor((leftMs % 3_600_000) / 60_000);
  const s = Math.floor((leftMs % 60_000) / 1000);
  const usd = pendingEth * ethUsd;

  return (
    <div className="glass-card relative overflow-hidden p-5 flex flex-col">
      <div
        className="absolute -right-14 -top-16 w-48 h-48 rounded-full blur-3xl opacity-[0.13] pointer-events-none"
        style={{ background: HUE }}
      />
      <div className="relative z-10 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: HUE }} />
        <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold">Next big burn</span>
      </div>

      {hasPot ? (
        <>
          <div className="relative z-10 mt-4 font-mono font-bold text-3xl md:text-4xl leading-none txt-white tabular-nums" aria-live="off">
            {leftMs > 0 ? (
              <>
                {d > 0 && <span>{d}d </span>}
                {pad(h)}<span className="text-slate-500">:</span>{pad(m)}<span className="text-slate-500">:</span>{pad(s)}
              </>
            ) : (
              <span className="text-2xl">Unlock imminent</span>
            )}
          </div>
          <div className="relative z-10 mt-3 text-sm text-slate-300">
            <span className="font-mono font-semibold txt-white">Ξ{pendingEth.toLocaleString("en-US", { maximumFractionDigits: 3 })}</span>
            <span className="text-slate-500"> ({fmtCompactValue(usd, true)})</span> pooling from Base
          </div>
        </>
      ) : (
        <div className="relative z-10 mt-4 font-mono text-2xl text-slate-400">No revenue in flight</div>
      )}

      <p className="relative z-10 mt-auto pt-4 text-[11px] text-slate-500 leading-relaxed">
        Base basket fees and launch-auction proceeds bridge to Ethereum on a ~7-day withdrawal, then buy &amp; burn
        PRISM. Timing is estimated from the oldest pending bridge.
      </p>
      <div className="relative z-10 mt-2 text-right font-mono text-[9px] uppercase tracking-[0.2em] text-slate-700 select-none">
        prismbeat
      </div>
    </div>
  );
}
