"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RANGES, isRangeKey, type BasketChartsPayload, type RangeKey } from "@/lib/feed/types";
import { TimeChart, fmtCompactValue } from "./time-chart";
import { TradesChart } from "./trades-chart";

const RANGE_KEYS: RangeKey[] = ["24h", "1w", "1m", "1y"];
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const deltaOf = (cur: number, prevV: number | undefined | null) =>
  prevV != null && prevV > 0 ? (cur - prevV) / prevV : null;

// One basket's trading activity, sliced from the same hourly store as the
// ecosystem charts. Reused by the /charts drill-down (range driven by the
// page) and by each basket's detail page (own range picker).
export function BasketActivity({
  address,
  range: rangeProp,
  showRangePicker = false,
  className = "",
  onSymbol,
}: {
  address: string;
  /** controlled range (charts page); omit to self-manage with the picker */
  range?: RangeKey;
  showRangePicker?: boolean;
  className?: string;
  /** reports the resolved ticker once the payload arrives (deep links only know the address) */
  onSymbol?: (symbol: string) => void;
}) {
  const [ownRange, setOwnRange] = useState<RangeKey>("1w");
  const range = rangeProp && isRangeKey(rangeProp) ? rangeProp : ownRange;
  const [data, setData] = useState<BasketChartsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const reqRef = useRef(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const id = ++reqRef.current;
      setLoading(true);
      try {
        const r = await fetch(`/api/charts?range=${range}&basket=${address}`, { cache: "no-store" });
        if (!r.ok) {
          if (alive && id === reqRef.current) setFailed(true);
          return;
        }
        const d = (await r.json()) as BasketChartsPayload;
        if (alive && id === reqRef.current) {
          setData(d);
          setFailed(false);
          if (d.symbol && !d.symbol.includes("…")) onSymbol?.(d.symbol);
        }
      } catch {
        if (alive && id === reqRef.current) setFailed(true);
      } finally {
        if (alive && id === reqRef.current) setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 120_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [address, range]);

  const derived = useMemo(() => {
    if (!data) return null;
    const volume = data.buyVolumeUsd.map((b, i) => b + (data.sellVolumeUsd[i] ?? 0));
    const netFlow = data.buyVolumeUsd.map((b, i) => b - (data.sellVolumeUsd[i] ?? 0));
    const inTotal = sum(data.buyVolumeUsd);
    const outTotal = sum(data.sellVolumeUsd);
    const netTotal = inTotal - outTotal;
    const trades = sum(data.buys) + sum(data.sells);
    const prevNet = data.prev ? data.prev.buyVolumeUsd - data.prev.sellVolumeUsd : null;
    const coverageIndex =
      data.baseCoverageFromMs != null ? data.buckets.findIndex((t) => t >= data.baseCoverageFromMs!) : null;
    return { volume, netFlow, inTotal, outTotal, netTotal, trades, prevNet, coverageIndex };
  }, [data]);

  const caption = RANGES[range].caption;
  const prev = data?.prev ?? null;

  if (failed && !data)
    return (
      <div className={`glass-card p-5 text-sm text-slate-400 font-mono ${className}`}>
        Trading activity is unavailable right now.
      </div>
    );

  return (
    <div className={className}>
      {showRangePicker && (
        <div className="flex items-center gap-1.5 mb-4">
          {RANGE_KEYS.map((r) => (
            <button
              key={r}
              onClick={() => setOwnRange(r)}
              aria-pressed={range === r}
              className={`text-[12px] font-semibold rounded-full px-3.5 py-1.5 transition-colors border ${
                range === r
                  ? "bg-white/15 border-white/25 text-white"
                  : "bg-white/[0.03] border-white/10 text-slate-400 hover:text-slate-200"
              }`}
            >
              {RANGES[r].label}
            </button>
          ))}
          <span className="ml-3 text-[11px] text-slate-500 font-mono hidden sm:inline">{caption}</span>
        </div>
      )}

      <div className={`grid md:grid-cols-2 gap-4 lg:gap-5 transition-opacity duration-300 ${loading && data ? "opacity-60" : "opacity-100"}`}>
        {data && derived ? (
          <>
            <TradesChart
              range={range}
              bucketMs={data.bucketMs}
              buckets={data.buckets}
              buys={data.buys}
              sells={data.sells}
              volumeUsd={derived.volume}
              launches={new Array(data.buckets.length).fill(0)}
              caption={`${caption} · $${data.symbol}`}
              delta={deltaOf(derived.trades, prev ? prev.buys + prev.sells : null)}
              coverageIndex={derived.coverageIndex}
            />
            <TimeChart
              title="Net flow"
              caption={`${caption} · ${fmtCompactValue(derived.inTotal, true)} in − ${fmtCompactValue(derived.outTotal, true)} out`}
              color="#10b981"
              range={range}
              bucketMs={data.bucketMs}
              buckets={data.buckets}
              values={derived.netFlow}
              kind="bar"
              signed
              money
              heroFmt={(n) => `${n >= 0 ? "+" : ""}${fmtCompactValue(n, true)}`}
              delta={deltaOf(derived.netTotal, derived.prevNet)}
              slug={`basket-${data.symbol}-net-flow`}
              coverageIndex={derived.coverageIndex}
            />
            <TimeChart
              title="Volume"
              caption={`${caption} · buys + sells, USD`}
              color="#0284c7"
              range={range}
              bucketMs={data.bucketMs}
              buckets={data.buckets}
              values={derived.volume}
              kind="bar"
              money
              delta={deltaOf(derived.inTotal + derived.outTotal, prev ? prev.buyVolumeUsd + prev.sellVolumeUsd : null)}
              slug={`basket-${data.symbol}-volume`}
              coverageIndex={derived.coverageIndex}
            />
            <TimeChart
              title="Fees generated"
              caption={`${caption} · this basket's own rate · 25% buys & burns PRISM`}
              color="#c2410c"
              range={range}
              bucketMs={data.bucketMs}
              buckets={data.buckets}
              values={data.feeUsd}
              money
              delta={deltaOf(sum(data.feeUsd), prev?.feeUsd)}
              slug={`basket-${data.symbol}-fees`}
              coverageIndex={derived.coverageIndex}
            />
          </>
        ) : (
          <div className="md:col-span-2 glass-card p-5 h-[220px] grid place-items-center text-sm text-slate-500 font-mono">
            Loading activity…
          </div>
        )}
      </div>
    </div>
  );
}
