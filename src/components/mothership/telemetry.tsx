"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, MONO, glass, glow } from "./style";
import { Reveal } from "@/components/effects/reveal";
import { TimeChart, fmtCompactValue } from "@/components/charts/time-chart";
import { TradesChart } from "@/components/charts/trades-chart";
import { TopBasketsChart } from "@/components/charts/top-baskets-chart";
import { ChartsLoading } from "@/components/charts/charts-loading";
import { NextBurnCard } from "@/components/charts/next-burn-card";
import { BasketActivity } from "@/components/charts/basket-activity";
import { RANGES, isRangeKey, type ChartsPayload, type RangeKey } from "@/lib/feed/types";

// ── TELEMETRY — the metrics page in the Mothership language ──────────────────
// the designer's telemetry mockup (2026-08-03): compact KPI tiles with sparklines up
// top, the big chart with a side stack, an intensity matrix at the bottom.
// Every series is the same real chain data the old page served — the mockup's
// fabricated finance stats (S&P, Treasury, Gold) map to our actual metrics.

// Series hues — validated against the dark surface (lightness band, chroma,
// CVD separation, contrast) with the dataviz palette checker.
const HUES = {
  launches: "#6366f1",
  fees: "#15803d",
  burned: "#ea580c",
  traders: "#0d9488",
  accrual: "#c2410c",
} as const;

const RANGE_KEYS: RangeKey[] = ["24h", "1w", "1m", "1y"];

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const deltaOf = (cur: number, prevV: number | undefined | null) =>
  prevV != null && prevV > 0 ? (cur - prevV) / prevV : null;

// mini sparkline for the KPI tiles — bars or a line, normalized to the window
function Spark({ values, color, kind = "bar" }: { values: number[]; color: string; kind?: "bar" | "line" }) {
  const vs = values.slice(-16);
  const max = Math.max(...vs, 1e-9);
  if (kind === "line") {
    const pts = vs.map((v, i) => `${(i / Math.max(1, vs.length - 1)) * 100},${30 - (v / max) * 26 - 2}`).join(" ");
    return (
      <svg className="mt-2 h-8 w-full" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden>
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
    );
  }
  return (
    <div className="mt-2 flex h-8 items-end gap-0.5" aria-hidden>
      {vs.map((v, i) => (
        <div
          key={i}
          className="w-full rounded-t-sm"
          style={{
            height: `${Math.max(4, (v / max) * 100)}%`,
            background: i === vs.length - 1 ? `${color}66` : `${color}33`,
            borderTop: i === vs.length - 1 ? `1px solid ${color}` : undefined,
          }}
        />
      ))}
    </div>
  );
}

function KpiTile({
  label,
  value,
  delta,
  color,
  spark,
  kind,
}: {
  label: string;
  value: string;
  delta: number | null;
  color: string;
  spark: number[];
  kind?: "bar" | "line";
}) {
  return (
    <div className="rounded-xl p-4" style={glass}>
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</h3>
      <div className="flex items-end gap-2">
        <span className="text-xl font-light text-white" style={{ fontFamily: MONO }}>
          {value}
        </span>
        {delta != null && (
          <span className="mb-0.5 text-[10px] font-medium" style={{ color: delta >= 0 ? C.green : C.orange, fontFamily: MONO }}>
            {delta >= 0 ? "+" : ""}
            {(delta * 100).toFixed(1)}%
          </span>
        )}
      </div>
      <Spark values={spark} color={color} kind={kind} />
    </div>
  );
}

// the mockup's matrix, with real data: per-bucket trading volume as intensity
function HeatCard({ buckets, values, caption }: { buckets: number[]; values: number[]; caption: string }) {
  const max = Math.max(...values, 1e-9);
  const peakI = values.indexOf(Math.max(...values));
  const stamp = (ms: number) =>
    new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <div className="flex flex-col rounded-2xl p-5" style={{ ...glass, borderTop: `2px solid ${C.cyan}80` }}>
      <div className="mb-4 flex items-center gap-2">
        <div className="h-1.5 w-1.5 rounded-full" style={{ background: C.cyan }} />
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
          Trading intensity · {caption}
        </h3>
      </div>
      <div className="flex flex-1 flex-col justify-center">
        <div className="grid grid-cols-12 gap-0.5">
          {values.map((v, i) => (
            <div
              key={i}
              className="aspect-square rounded-sm"
              title={`${stamp(buckets[i])} · ${fmtCompactValue(v, true)} volume`}
              style={{
                background: `rgba(0,240,255,${(0.05 + 0.85 * (v / max)).toFixed(3)})`,
                boxShadow: i === peakI && v > 0 ? `0 0 8px ${C.cyan}80` : undefined,
              }}
            />
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between text-[10px] text-slate-500" style={{ fontFamily: MONO }}>
          <div className="flex items-center gap-2">
            <span>Quiet</span>
            <div className="flex gap-0.5">
              <div className="h-2 w-2 rounded-sm" style={{ background: "rgba(0,240,255,0.10)" }} />
              <div className="h-2 w-2 rounded-sm" style={{ background: "rgba(0,240,255,0.40)" }} />
              <div className="h-2 w-2 rounded-sm" style={{ background: "rgba(0,240,255,0.90)" }} />
            </div>
            <span>Busy</span>
          </div>
          <span>{max > 0 && values[peakI] > 0 ? `Peak: ${stamp(buckets[peakI])}` : "No trades in this window yet"}</span>
        </div>
      </div>
    </div>
  );
}

export function TelemetryPanel() {
  // Default 24h while activity is sparse (owner call 2026-07-07); revisit -> 1w
  // once volume justifies the longer window.
  const [range, setRange] = useState<RangeKey>(() => {
    if (typeof window === "undefined") return "24h";
    const q = new URLSearchParams(window.location.search).get("range") ?? "";
    return isRangeKey(q) ? q : "24h";
  });
  const [data, setData] = useState<ChartsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const reqRef = useRef(0);
  // basket drill-down, deep-linkable via ?basket=0x…
  const [basket, setBasket] = useState<{ address: string; symbol: string } | null>(() => {
    if (typeof window === "undefined") return null;
    const b = new URLSearchParams(window.location.search).get("basket") ?? "";
    return /^0x[0-9a-fA-F]{40}$/.test(b) ? { address: b, symbol: `${b.slice(0, 6)}…${b.slice(-4)}` } : null;
  });
  const drillRef = useRef<HTMLDivElement>(null);

  const pickBasket = useCallback((address: string | null, symbol?: string) => {
    setBasket(address ? { address, symbol: symbol ?? `${address.slice(0, 6)}…${address.slice(-4)}` } : null);
    const url = new URL(window.location.href);
    if (address) url.searchParams.set("basket", address);
    else url.searchParams.delete("basket");
    window.history.replaceState(null, "", url.toString());
    if (address) setTimeout(() => drillRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }, []);

  // one fetch per range switch + a slow refresh so the page stays live;
  // the previous render holds (dimmed) while new data loads — no layout jump
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const id = ++reqRef.current;
      setLoading(true);
      try {
        const r = await fetch(`/api/charts?range=${range}`, { cache: "no-store" });
        if (!r.ok) return;
        const d = (await r.json()) as ChartsPayload;
        if (alive && id === reqRef.current) setData(d);
      } catch {
        /* keep the previous frame */
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
  }, [range]);

  const pickRange = useCallback((r: RangeKey) => {
    setRange(r);
    const url = new URL(window.location.href);
    url.searchParams.set("range", r);
    window.history.replaceState(null, "", url.toString());
  }, []);

  const share = useCallback(async () => {
    const url = new URL(window.location.href);
    url.searchParams.set("range", range);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }, [range]);

  const caption = RANGES[range].caption;

  const derived = useMemo(() => {
    if (!data) return null;
    const trades = data.buys.map((b, i) => b + (data.sells[i] ?? 0));
    const totalTrades = sum(trades);
    const totalVolume = sum(data.volumeUsd);
    const windowBurn = sum(data.burnedPrism);
    // cumulative burn marching toward the cap
    let acc = data.burnedStartTotal;
    const cumulativeBurn = data.burnedPrism.map((v) => (acc += v));
    const burnedNow = cumulativeBurn[cumulativeBurn.length - 1] ?? data.burnedStartTotal;
    // the strip metric, historically: fees per bucket ÷ circulating supply
    const perPrism = data.feesUsd.map((v) => (data.supply > 0 ? v / data.supply : 0));
    // Base-derived series only cover from this bucket index (1y clamp)
    const coverageIndex =
      data.baseCoverageFromMs != null
        ? data.buckets.findIndex((t) => t >= data.baseCoverageFromMs!)
        : null;
    // Annualized run-rate for windows that reach past available history (the
    // protocol is younger than the range): total ÷ covered days × 365. Series
    // stay real — this is a labeled pace derived from actuals only, and it
    // only shows when coverage is materially short of the window.
    const DAY = 86_400_000;
    const winMs = data.buckets.length * data.bucketMs;
    const endMs = data.buckets[0] + winMs;
    const pace = (total: number, fromMs: number | null) => {
      const covMs = fromMs == null ? winMs : Math.min(winMs, Math.max(0, endMs - fromMs));
      if (covMs >= winMs * 0.85 || covMs < 7 * DAY || total <= 0) return null;
      return { perYear: (total / covMs) * 365 * DAY, days: Math.round(covMs / DAY) };
    };
    const feesPace = pace(sum(data.feesUsd), data.ethCoverageFromMs);
    const volumePace = pace(totalVolume, data.baseCoverageFromMs);
    const basketBurnPace = pace(sum(data.basketBurnUsd), data.baseCoverageFromMs);
    const burnPace = pace(windowBurn, data.ethCoverageFromMs);
    // net flow: dstable entering baskets (buys) minus leaving (sells)
    const netFlow = data.buyVolumeUsd.map((b, i) => b - (data.sellVolumeUsd[i] ?? 0));
    const inTotal = sum(data.buyVolumeUsd);
    const outTotal = sum(data.sellVolumeUsd);
    const netTotal = inTotal - outTotal;
    return {
      trades, totalTrades, totalVolume, windowBurn, cumulativeBurn, burnedNow, perPrism, coverageIndex,
      feesPace, volumePace, basketBurnPace, burnPace,
      netFlow, inTotal, outTotal, netTotal,
    };
  }, [data]);

  const prev = data?.prev ?? null;
  const burnedPct = data && derived ? (derived.burnedNow / data.cap) * 100 : 0;

  return (
    <section id="telemetry" className="relative z-10 mx-auto w-full max-w-[1536px] space-y-6 p-4 pb-14 sm:p-6 sm:pb-14">

        {/* ── header: title + live state | share + range control ── */}
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Telemetry
              <span className="relative flex h-2 w-2">
                <span
                  className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                  style={{ background: data?.mode === "demo" ? "#fbbf24" : C.cyan }}
                />
                <span
                  className="relative inline-flex h-2 w-2 rounded-full"
                  style={{ background: data?.mode === "demo" ? "#fbbf24" : C.cyan }}
                />
              </span>
              {data?.mode === "demo" && (
                <span className="rounded border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-300">
                  Demo data
                </span>
              )}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              The ecosystem over time — launches, trading, burns and PRISM revenue, read straight from the chain.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={share}
              className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-slate-300 transition-colors hover:border-white/20 hover:text-white"
              style={{ background: "rgba(255,255,255,0.03)" }}
              title="Copy a link to this view"
            >
              {copied ? "Link copied ✓" : "Share"}
            </button>
            <div className="flex gap-1.5 rounded-md border border-white/10 p-1 backdrop-blur-md" style={{ background: "rgba(3,4,9,0.5)" }}>
              {RANGE_KEYS.map((r) => (
                <button
                  key={r}
                  onClick={() => pickRange(r)}
                  aria-pressed={range === r}
                  className={`rounded px-3 py-1 text-[10px] font-medium transition-colors ${
                    range === r ? "bg-white/10 text-white shadow-sm" : "text-slate-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {RANGES[r].label.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>

        {data && derived ? (
          <div className={`space-y-6 transition-opacity duration-300 ${loading ? "opacity-60" : "opacity-100"}`}>
            {/* ── KPI tiles with sparklines ── */}
            <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
              <KpiTile
                label="PRISM burned"
                value={derived.windowBurn.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                delta={deltaOf(derived.windowBurn, prev?.burnedPrism)}
                color={HUES.burned}
                spark={data.burnedPrism}
              />
              <KpiTile
                label="Swap fees → holders"
                value={fmtCompactValue(sum(data.feesUsd), true)}
                delta={deltaOf(sum(data.feesUsd), prev?.feesUsd)}
                color={HUES.fees}
                spark={data.feesUsd}
                kind="line"
              />
              <KpiTile
                label="Basket volume"
                value={fmtCompactValue(derived.totalVolume, true)}
                delta={deltaOf(derived.totalVolume, prev?.volumeUsd)}
                color={HUES.traders}
                spark={data.volumeUsd}
              />
              <KpiTile
                label="Baskets launched"
                value={sum(data.launches).toLocaleString("en-US")}
                delta={deltaOf(sum(data.launches), prev?.launches)}
                color={HUES.launches}
                spark={data.launches}
              />
            </div>

            {/* ── centerpiece: cumulative burn + the side stack ── */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              <Reveal className="lg:col-span-8">
                <TimeChart
                  title="Total PRISM burned"
                  caption={`${burnedPct.toFixed(2)}% of the ${data.cap.toLocaleString("en-US")} cap destroyed · +${derived.windowBurn.toLocaleString("en-US", { maximumFractionDigits: 2 })} PRISM ${caption}`}
                  color={HUES.burned}
                  range={range}
                  bucketMs={data.bucketMs}
                  buckets={data.buckets}
                  values={derived.cumulativeBurn}
                  total={derived.burnedNow}
                  heroFmt={(n) => n.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                  delta={deltaOf(derived.windowBurn, prev?.burnedPrism)}
                  slug="total-prism-burned"
                  partialLast={false}
                />
              </Reveal>
              <div className="flex flex-col gap-6 lg:col-span-4">
                <Reveal className="flex-1">
                  <NextBurnCard
                    pendingEth={data.bridge?.pendingEth ?? 0}
                    nextBurnTs={data.bridge?.nextBurnTs ?? null}
                    ethUsd={data.ethUsd}
                  />
                </Reveal>
                <Reveal className="flex-1">
                  <div className="flex h-full flex-col justify-between rounded-2xl p-6" style={{ ...glass, borderTop: `2px solid ${C.purple}80` }}>
                    <div>
                      <h3 className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: C.purple }} />
                        Burn progress
                      </h3>
                      <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-light tracking-tight text-white" style={glow(C.purple)}>
                          {burnedPct.toFixed(2)}
                        </span>
                        <span className="text-sm" style={{ color: C.purple, fontFamily: MONO }}>
                          %
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500" style={{ fontFamily: MONO }}>
                        {derived.burnedNow.toLocaleString("en-US", { maximumFractionDigits: 2 })} of{" "}
                        {data.cap.toLocaleString("en-US")} destroyed forever
                      </p>
                    </div>
                    <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "rgba(10,12,20,0.9)" }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(0.5, Math.min(100, burnedPct))}%`,
                          background: `linear-gradient(90deg, ${C.cyan}, ${C.purple})`,
                          boxShadow: `0 0 8px ${C.purple}80`,
                        }}
                      />
                    </div>
                  </div>
                </Reveal>
              </div>
            </div>

            {/* ── the full series grid ── */}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <Reveal className="md:col-span-2">
                <TradesChart
                  range={range}
                  bucketMs={data.bucketMs}
                  buckets={data.buckets}
                  buys={data.buys}
                  sells={data.sells}
                  volumeUsd={data.volumeUsd}
                  launches={data.launches}
                  caption={`${caption} · ${fmtCompactValue(derived.totalVolume, true)} volume${derived.volumePace ? ` · ≈ ${fmtCompactValue(derived.volumePace.perYear, true)}/yr pace (${derived.volumePace.days}d)` : ""}`}
                  delta={deltaOf(derived.totalTrades, prev ? prev.buys + prev.sells : null)}
                  coverageIndex={derived.coverageIndex}
                />
              </Reveal>

              <Reveal>
                <TimeChart
                  title="Net basket flow"
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
                  delta={deltaOf(derived.netTotal, prev ? prev.buyVolumeUsd - prev.sellVolumeUsd : null)}
                  slug="net-basket-flow"
                  coverageIndex={derived.coverageIndex}
                />
              </Reveal>
              <Reveal>
                <TimeChart
                  title="PRISM swap fees"
                  caption={`${caption} · 100% to holders${derived.feesPace ? ` · ≈ ${fmtCompactValue(derived.feesPace.perYear, true)}/yr pace (${derived.feesPace.days}d)` : ""}`}
                  color={HUES.fees}
                  range={range}
                  bucketMs={data.bucketMs}
                  buckets={data.buckets}
                  values={data.feesUsd}
                  money
                  delta={deltaOf(sum(data.feesUsd), prev?.feesUsd)}
                  slug="prism-swap-fees"
                />
              </Reveal>

              <Reveal>
                <TimeChart
                  title="Revenue per PRISM"
                  caption={`${caption} · per token held`}
                  color={HUES.fees}
                  range={range}
                  bucketMs={data.bucketMs}
                  buckets={data.buckets}
                  values={derived.perPrism}
                  money
                  heroFmt={(n) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`}
                  delta={deltaOf(sum(data.feesUsd), prev?.feesUsd)}
                  slug="revenue-per-prism"
                />
              </Reveal>
              <Reveal>
                <TimeChart
                  title="Basket fees earned"
                  caption={`${caption} · every basket's full fee (PRISM's 10% inside it)`}
                  color="#38bdf8"
                  range={range}
                  bucketMs={data.bucketMs}
                  buckets={data.buckets}
                  values={data.basketBurnUsd.map((v) => v * 10)}
                  money
                  delta={deltaOf(sum(data.basketBurnUsd) * 10, prev ? prev.basketBurnUsd * 10 : null)}
                  slug="basket-fees-earned"
                  coverageIndex={derived.coverageIndex}
                />
              </Reveal>

              <Reveal>
                <TimeChart
                  title="Baskets launched"
                  caption={caption}
                  color={HUES.launches}
                  range={range}
                  bucketMs={data.bucketMs}
                  buckets={data.buckets}
                  values={data.launches}
                  kind="bar"
                  delta={deltaOf(sum(data.launches), prev?.launches)}
                  slug="baskets-launched"
                />
              </Reveal>
              <Reveal>
                <TimeChart
                  title="Unique traders"
                  caption={`${caption} · distinct basket wallets`}
                  color={HUES.traders}
                  range={range}
                  bucketMs={data.bucketMs}
                  buckets={data.buckets}
                  values={data.traders}
                  kind="bar"
                  total={data.tradersTotal}
                  delta={deltaOf(data.tradersTotal, prev?.traders)}
                  slug="unique-traders"
                  coverageIndex={derived.coverageIndex}
                />
              </Reveal>

              <Reveal>
                <TimeChart
                  title="Basket fees → PRISM"
                  caption={`${caption} · the fixed 10% burn share${derived.basketBurnPace ? ` · ≈ ${fmtCompactValue(derived.basketBurnPace.perYear, true)}/yr pace (${derived.basketBurnPace.days}d)` : ""}`}
                  color={HUES.accrual}
                  range={range}
                  bucketMs={data.bucketMs}
                  buckets={data.buckets}
                  values={data.basketBurnUsd}
                  money
                  delta={deltaOf(sum(data.basketBurnUsd), prev?.basketBurnUsd)}
                  slug="basket-fees-to-prism"
                  marks={{ label: "baskets launched", perBucket: data.launches, color: HUES.launches }}
                  coverageIndex={derived.coverageIndex}
                />
              </Reveal>
              <Reveal>
                <TimeChart
                  title="PRISM burned per period"
                  caption={`${caption} · buy-and-burns as they land${derived.burnPace ? ` · ≈ ${derived.burnPace.perYear.toLocaleString("en-US", { maximumFractionDigits: 1 })} PRISM/yr pace (${derived.burnPace.days}d)` : ""}`}
                  color={HUES.burned}
                  range={range}
                  bucketMs={data.bucketMs}
                  buckets={data.buckets}
                  values={data.burnedPrism}
                  kind="bar"
                  heroFmt={(n) => n.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                  delta={deltaOf(derived.windowBurn, prev?.burnedPrism)}
                  slug="prism-burned-per-period"
                />
              </Reveal>
            </div>

            {/* ── bottom: leaderboard + the intensity matrix ── */}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <Reveal>
                <TopBasketsChart range={range} caption={caption} items={data.topBaskets} onSelect={(a, s) => pickBasket(a, s)} />
              </Reveal>
              <Reveal>
                <HeatCard buckets={data.buckets} values={data.volumeUsd} caption={caption} />
              </Reveal>
            </div>
          </div>
        ) : (
          <ChartsLoading />
        )}

        {/* per-basket drill-down — click a Top Baskets bar to open */}
        {basket && (
          <div ref={drillRef} className="mt-10 scroll-mt-24">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-baseline gap-3">
                <h2 className="text-2xl font-bold tracking-tight text-white">
                  <span style={{ color: C.cyan }}>${basket.symbol}</span> activity
                </h2>
                <span className="font-mono text-[11px] text-slate-500">
                  {basket.address.slice(0, 10)}…{basket.address.slice(-6)}
                </span>
              </div>
              <button
                onClick={() => pickBasket(null)}
                className="shrink-0 rounded-xl border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-300 transition-colors hover:border-white/20 hover:text-white"
                style={{ background: "rgba(255,255,255,0.03)" }}
                title="Close drill-down"
              >
                Close ✕
              </button>
            </div>
            <BasketActivity
              address={basket.address}
              range={range}
              onSymbol={(s) => setBasket((b) => (b && b.symbol !== s ? { ...b, symbol: s } : b))}
            />
          </div>
        )}

        <p className="max-w-2xl text-[11px] leading-relaxed text-slate-600">
          Series are aggregated from public on-chain logs and bucketed by estimated block time; the final bucket is
          still in progress, and figures are approximate and may be delayed. Where a window reaches past available
          history, &ldquo;/yr pace&rdquo; is that metric annualized from the covered days shown — an extrapolation of
          recent activity, not a measurement or a forecast. Nothing here is investment advice.
        </p>
    </section>
  );
}
