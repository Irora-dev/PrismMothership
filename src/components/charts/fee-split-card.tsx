"use client";

import { fmtCompactValue } from "./time-chart";

// Where every basket fee goes — the FeesAccrued split, as one bar.
// Burn is a fixed 25% off the top; holders are guaranteed ≥70% of the rest.
// League only accrues on Robinhood-lineage baskets (5% off the top) — the
// segment collapses to zero width elsewhere.
const SEGMENTS = [
  { key: "holders", label: "PRISM holders", hue: "#15803d" },
  { key: "burn", label: "PRISM burn", hue: "#ea580c" },
  { key: "creator", label: "Basket creators", hue: "#8b5cf6" },
  { key: "interfaces", label: "Interfaces & launchers", hue: "#0d9488" },
  { key: "league", label: "Creator league", hue: "#eab308" },
] as const;

export function FeeSplitCard({
  split: raw,
  caption,
}: {
  // league is optional so a cached pre-league payload can't crash the card
  split: { holders: number; burn: number; creator: number; interfaces: number; league?: number };
  caption: string;
}) {
  const split = { ...raw, league: raw.league ?? 0 };
  const total = split.holders + split.burn + split.creator + split.interfaces + split.league;
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);

  return (
    <div className="glass-card relative overflow-hidden p-5 flex flex-col">
      <div
        className="absolute -right-14 -top-16 w-48 h-48 rounded-full blur-3xl opacity-[0.13] pointer-events-none"
        style={{ background: "#15803d" }}
      />
      <div className="relative z-10 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "#15803d" }} />
        <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold">Where the fees go</span>
        {/* the how-it-works prose lives behind this — bigger text, on demand */}
        <span tabIndex={0} className="group/tip relative inline-flex items-center outline-none shrink-0" aria-label="How the fee split works">
          <span className="grid place-items-center w-[17px] h-[17px] rounded-full border border-white/20 bg-white/[0.03] text-[10px] font-bold text-slate-500 cursor-help transition-colors group-hover/tip:text-slate-200 group-hover/tip:border-white/35 group-focus/tip:text-slate-200 group-focus/tip:border-white/35">
            i
          </span>
          <span
            role="tooltip"
            className="pointer-events-none absolute left-0 top-full z-30 mt-2 w-[330px] rounded-xl border border-white/10 bg-[#15151c] px-4 py-3.5 text-left text-[13.5px] font-normal leading-relaxed text-slate-200 opacity-0 shadow-2xl transition-opacity duration-150 group-hover/tip:opacity-100 group-focus/tip:opacity-100"
          >
            Every basket fee splits on-chain: a fixed 25% buys &amp; burns PRISM, and holders are
            guaranteed at least 70% of the remainder. Creators and integrator interfaces share the rest.
            Baskets on Robinhood Chain also route 5% off the top into the creator-league prize pool.
          </span>
        </span>
      </div>
      <div className="relative z-10 flex items-baseline gap-2.5 mt-2.5">
        <span className="font-mono font-bold text-3xl leading-none txt-white">{fmtCompactValue(total, true)}</span>
      </div>
      <div className="relative z-10 text-[11px] text-slate-500 mt-1.5">{caption}</div>

      {/* the split, one proportional bar */}
      <div className="relative z-10 mt-5 flex h-4 w-full overflow-hidden rounded-full border border-white/10">
        {SEGMENTS.map((s) => (
          <span
            key={s.key}
            style={{ width: `${pct(split[s.key])}%`, background: `${s.hue}cc` }}
            title={`${s.label}: ${fmtCompactValue(split[s.key], true)}`}
          />
        ))}
      </div>

      <div className="relative z-10 mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
        {SEGMENTS.map((s) => (
          <div key={s.key} className="flex items-center justify-between gap-3 text-[12px]">
            <span className="inline-flex items-center gap-2 text-slate-300">
              <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: s.hue }} />
              {s.label}
            </span>
            <span className="font-mono text-slate-200 tabular-nums">
              {fmtCompactValue(split[s.key], true)}
              <span className="text-slate-500 ml-1.5">{pct(split[s.key]).toFixed(0)}%</span>
            </span>
          </div>
        ))}
      </div>

      <div className="relative z-10 mt-auto pt-2 text-right font-mono text-[9px] uppercase tracking-[0.2em] text-slate-700 select-none">
        prismbeat
      </div>
    </div>
  );
}
