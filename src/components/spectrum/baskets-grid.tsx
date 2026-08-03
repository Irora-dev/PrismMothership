"use client";

import { useEffect, useState } from "react";
import { PixelReveal } from "@/components/effects/pixel-reveal";
import { IndexCard, ChainBadge, type IndexSummary, type Chain, usd } from "./index-card";

type ChainFilter = "all" | Chain;

// The basket explorer, as an embeddable section: live on-chain listing with
// chain filters and per-basket cards. Extracted from the old /indexes page so
// /spectrum can host it; the detail routes (/indexes/[address]) are unchanged.
export function BasketsGrid({ chains }: { chains?: Chain[] } = {}) {
  const [indexes, setIndexes] = useState<IndexSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<ChainFilter>("all");

  useEffect(() => {
    let live = true;
    fetch("/api/spectrum/indexes")
      .then((r) => r.json())
      .then((d: { indexes?: IndexSummary[]; error?: string }) => {
        if (!live) return;
        if (d.error) setErr(d.error);
        else setIndexes(d.indexes ?? []);
      })
      .catch((e) => live && setErr(String(e)));
    return () => {
      live = false;
    };
  }, []);

  const totalAum = indexes?.reduce((s, ix) => s + (ix.aumUsd || 0), 0) ?? 0;
  const counts = {
    all: indexes?.length ?? 0,
    ethereum: indexes?.filter((ix) => ix.chain === "ethereum").length ?? 0,
    base: indexes?.filter((ix) => ix.chain === "base").length ?? 0,
  };
  // when the page drives chain selection (the logo pills), it wins over the
  // grid's own legacy filter row (hidden in that mode)
  const shown = (indexes ?? []).filter((ix) =>
    chains ? chains.includes(ix.chain) : filter === "all" || ix.chain === filter,
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
        <div className="flex flex-wrap gap-x-10 gap-y-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-semibold">Baskets</div>
            <div className="font-mono txt-white text-xl mt-0.5 tabular-nums">{indexes ? String(indexes.length) : "—"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-semibold">Total AUM</div>
            <div className="font-mono txt-white text-xl mt-0.5 tabular-nums">{indexes ? usd(totalAum, 0) : "—"}</div>
          </div>
        </div>

        {!chains && indexes && counts.ethereum > 0 && counts.base > 0 && (
          <div className="flex flex-wrap items-center gap-2">
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
      </div>

      {err && (
        <div className="mt-8 rounded-xl border border-red-500/30 bg-red-500/5 p-5 text-red-300 font-mono text-[13px]">
          Couldn&apos;t load baskets. {err}
        </div>
      )}

      {!err && !indexes && (
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="glass-card p-5 h-[232px] animate-pulse opacity-40" />
          ))}
        </div>
      )}

      {indexes && shown.length > 0 && (
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {shown.map((ix, i) => (
            <PixelReveal key={ix.address} delay={i * 120} accent="#22d3ee" maxPixels={150}>
              <IndexCard ix={ix} />
            </PixelReveal>
          ))}
        </div>
      )}

      {indexes && indexes.length === 0 && !err && (
        <div className="mt-12 text-center text-slate-500 font-mono text-[13px] leading-relaxed">
          Baskets go live with the Spectrum V2 launch.
          <br />
          Every basket appears here automatically the moment the factory is live.
        </div>
      )}
    </div>
  );
}
