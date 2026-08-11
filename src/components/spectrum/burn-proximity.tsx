"use client";

import { useEffect, useState } from "react";
import { ChainBadge, usd, type Chain } from "@/components/spectrum/index-card";
import type { BurnProximity, BurnProximityPayload } from "@/lib/spectrum/burn-proximity";

type ChainFilter = "all" | Chain;

// Adaptive % — tiny fractions (a fresh basket is ~0% to burn) still read as a real
// number instead of "0.00%".
function fmtPct(n: number): string {
  if (!isFinite(n) || n <= 0) return "0%";
  if (n >= 100) return `${Math.round(n)}%`;
  if (n >= 10) return `${n.toFixed(1)}%`;
  if (n >= 1) return `${n.toFixed(2)}%`;
  if (n >= 0.01) return `${n.toFixed(3)}%`;
  return "<0.01%";
}

// Fill heats up as a basket nears the burn: amber far out → red-hot at the threshold.
function fillFor(fraction: number): string {
  if (fraction >= 0.8) return "linear-gradient(90deg,#f97316,#ef4444)";
  if (fraction >= 0.4) return "linear-gradient(90deg,#f59e0b,#f97316)";
  return "linear-gradient(90deg,#fb923c,#f97316)";
}

function Meter({ b }: { b: BurnProximity }) {
  const pctWidth = Math.min(100, Math.max(b.fraction * 100, b.pendingUsdc > 0 ? 1.5 : 0));
  const hot = b.fraction >= 0.8;
  return (
    <div
      className="relative h-2 rounded-full bg-white/[0.06] overflow-hidden"
      role="progressbar"
      aria-valuenow={Math.round(b.fraction * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${b.symbol || b.address} is ${fmtPct(b.pctToBurn)} of the way to its PRISM burn`}
    >
      <div
        className="h-full rounded-full transition-[width] duration-700"
        style={{ width: `${pctWidth}%`, background: fillFor(b.fraction), boxShadow: hot ? "0 0 10px rgba(239,68,68,0.55)" : undefined }}
      />
    </div>
  );
}

function Row({ b }: { b: BurnProximity }) {
  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="txt-white font-bold leading-none truncate">{b.symbol || `${b.address.slice(0, 6)}…`}</span>
          <ChainBadge chain={b.chain} />
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono txt-white tabular-nums leading-none">{fmtPct(b.pctToBurn)}</div>
          <div className="text-[10px] text-slate-500 mt-1">to burn</div>
        </div>
      </div>
      {b.name?.trim() && <div className="text-[11px] text-slate-500 line-clamp-1 mt-1">{b.name}</div>}
      <div className="mt-3">
        <Meter b={b} />
      </div>
      <div className="flex items-center justify-between mt-2 text-[11px] font-mono text-slate-500 tabular-nums">
        <span>{usd(b.pendingUsdc)} accrued</span>
        <span>of {usd(b.thresholdUsd, 0)}</span>
      </div>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="glass-card p-4">
      <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold">{label}</div>
      <div className="font-mono font-bold text-2xl leading-none txt-white mt-2 tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-1.5 truncate">{sub}</div>}
    </div>
  );
}

export function BurnProximitySection() {
  const [data, setData] = useState<BurnProximityPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<ChainFilter>("all");

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/spectrum/burn", { cache: "no-store" })
        .then((r) => r.json())
        .then((d: BurnProximityPayload & { error?: string }) => {
          if (!live) return;
          if (d.error) setErr(d.error);
          else {
            setData(d);
            setErr(null);
          }
        })
        .catch((e) => live && setErr(String(e)));
    load();
    const t = setInterval(load, 120_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const baskets = data?.baskets ?? [];
  const counts = {
    all: baskets.length,
    ethereum: baskets.filter((b) => b.chain === "ethereum").length,
    base: baskets.filter((b) => b.chain === "base").length,
  };
  const shown = baskets.filter((b) => filter === "all" || b.chain === filter);
  const closest = baskets[0] ?? null;
  const anyConfigured = !!(data?.configured.ethereum || data?.configured.base);

  // Pre-launch: the V2 factory address isn't wired yet.
  if (data && !anyConfigured && baskets.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[13px] text-slate-300">
        <span className="font-semibold text-slate-100">Awaiting the launch factory.</span> Every basket lights up here
        the moment the Spectrum V2 factory address is wired. Each one&apos;s accrued fees are tracked live against the
        fixed <span className="font-mono">0.3 ETH</span> burn threshold, and new baskets self-register.
      </div>
    );
  }

  if (err && !data) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-5 text-red-300 font-mono text-[13px]">
        Couldn&apos;t load burn data. {err}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="glass-card p-4 h-[132px] animate-pulse opacity-40" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile label="Baskets tracked" value={String(counts.all)} sub="auto-detected from the factory" />
        <Tile label="Closest to burn" value={closest ? fmtPct(closest.pctToBurn) : "—"} sub={closest ? closest.symbol : undefined} />
        <Tile label="Total accrued" value={usd(data.totalPendingUsd)} sub="burn share, all baskets" />
        <Tile label="Burn threshold" value="0.3 ETH" sub={data.ethUsd ? `≈ ${usd(data.thresholdUsd, 0)} each` : "fixed on-chain"} />
      </div>

      {counts.ethereum > 0 && counts.base > 0 && (
        <div className="flex flex-wrap items-center gap-2 mt-5">
          {([
            { id: "all" as const, label: "All chains" },
            { id: "ethereum" as const, label: "Ethereum" },
            { id: "base" as const, label: "Base" },
          ]).map((f) => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors border ${
                  active ? "text-white border-white/25 bg-white/10" : "text-slate-400 border-white/10 hover:text-white hover:border-white/20"
                }`}
              >
                {f.id !== "all" && <ChainBadge chain={f.id} />}
                {f.label}
                <span className="font-mono text-[11px] text-slate-500 tabular-nums">{counts[f.id]}</span>
              </button>
            );
          })}
        </div>
      )}

      {shown.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-5">
          {shown.map((b) => (
            <Row key={`${b.chain}-${b.address}`} b={b} />
          ))}
        </div>
      ) : (
        <div className="mt-5 text-center text-slate-500 font-mono text-[13px]">
          Factory wired, no baskets launched yet. The first launch appears here automatically.
        </div>
      )}
    </>
  );
}
