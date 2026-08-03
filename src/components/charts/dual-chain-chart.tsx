"use client";

import { useMemo } from "react";
import { Chart } from "react-chartjs-2";
import type { ChartData, ChartOptions, Plugin } from "chart.js";
import type { RangeKey } from "@/lib/feed/types";
import { ChartCard, SrTable, TOOLTIP_CHROME, crosshair, fmtCompactValue, tickLabel, tooltipTitle } from "./time-chart";

// One series per chain, stacked — how much of the total each chain carries is
// readable at a glance. Hues: Ethereum indigo, Base its brand-adjacent sky.
export const ETH_HUE = "#818cf8";
export const BASE_HUE = "#0284c7";
export const HOOD_HUE = "#a8cc16"; // Robinhood Chain acid, dimmed for the dark chart ground

export function DualChainChart({
  title,
  caption,
  range,
  bucketMs,
  buckets,
  eth,
  base,
  hood,
  money = false,
  delta,
  slug,
  heroFmt,
}: {
  title: string;
  caption: string;
  range: RangeKey;
  bucketMs: number;
  buckets: number[];
  eth: number[]; // Ethereum-chain series per bucket
  base: number[]; // Base-chain series per bucket
  hood?: number[]; // Robinhood-chain series per bucket (omitted → not rendered)
  money?: boolean;
  delta?: number | null;
  slug: string;
  heroFmt?: (n: number) => string;
}) {
  const ethTotal = eth.reduce((a, b) => a + b, 0);
  const baseTotal = base.reduce((a, b) => a + b, 0);
  const hoodTotal = (hood ?? []).reduce((a, b) => a + b, 0);
  const total = ethTotal + baseTotal + hoodTotal;
  const hero = heroFmt ? heroFmt(total) : money ? fmtCompactValue(total, true) : Math.round(total).toLocaleString("en-US");
  const last = buckets.length - 1;

  const data = useMemo<ChartData<"bar">>(
    () => ({
      labels: buckets.map((t) => tickLabel(t, range)),
      datasets: [
        {
          label: "Base",
          data: base,
          backgroundColor: base.map((_, i) => (i === last ? `${BASE_HUE}59` : `${BASE_HUE}cc`)),
          hoverBackgroundColor: BASE_HUE,
          borderRadius: 3,
          borderSkipped: "start" as const,
          maxBarThickness: 24,
          stack: "chains",
          categoryPercentage: 0.82,
          barPercentage: 0.92,
        },
        {
          label: "Ethereum",
          data: eth,
          backgroundColor: eth.map((_, i) => (i === last ? `${ETH_HUE}59` : `${ETH_HUE}cc`)),
          hoverBackgroundColor: ETH_HUE,
          borderRadius: 3,
          borderSkipped: "start" as const,
          maxBarThickness: 24,
          stack: "chains",
          categoryPercentage: 0.82,
          barPercentage: 0.92,
        },
        ...(hood
          ? [
              {
                label: "Robinhood",
                data: hood,
                backgroundColor: hood.map((_, i) => (i === last ? `${HOOD_HUE}59` : `${HOOD_HUE}cc`)),
                hoverBackgroundColor: HOOD_HUE,
                borderRadius: 3,
                borderSkipped: "start" as const,
                maxBarThickness: 24,
                stack: "chains",
                categoryPercentage: 0.82,
                barPercentage: 0.92,
              },
            ]
          : []),
      ],
    }),
    [buckets, eth, base, hood, range, last],
  );

  const options = useMemo<ChartOptions<"bar">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 650, easing: "easeOutQuart" },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...TOOLTIP_CHROME,
          callbacks: {
            title: (items) => tooltipTitle(buckets[items[0]?.dataIndex ?? 0] ?? 0, bucketMs, range),
            label: (item) => {
              const i = item.dataIndex;
              if (item.datasetIndex !== 0) return [];
              const fmt = (v: number) => (money ? fmtCompactValue(v, true) : Math.round(v).toLocaleString("en-US"));
              const lines = [`${fmt(base[i] ?? 0)}  base`, `${fmt(eth[i] ?? 0)}  ethereum`];
              if (hood) lines.push(`${fmt(hood[i] ?? 0)}  robinhood`);
              if (i === last) lines.push("(in progress)");
              return lines;
            },
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          border: { display: false },
          ticks: { color: "#64748b", font: { size: 10 }, maxTicksLimit: 6, maxRotation: 0, autoSkipPadding: 18 },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          grid: { color: "rgba(255,255,255,0.05)", tickLength: 0 },
          border: { display: false },
          ticks: {
            color: "#64748b",
            font: { size: 10 },
            maxTicksLimit: 5,
            padding: 8,
            callback: (v) => fmtCompactValue(Number(v), money),
          },
        },
      },
    }),
    [buckets, eth, base, hood, bucketMs, range, money, last],
  );

  const plugins = useMemo<Plugin[]>(() => [crosshair], []);

  return (
    <ChartCard
      title={title}
      color={BASE_HUE}
      hero={hero}
      caption={caption}
      delta={delta}
      slug={slug}
      range={range}
      legend={
        <div className="relative z-10 flex items-center gap-4 mb-2 text-[11px] text-slate-400 font-medium">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: BASE_HUE }} />
            Base · {money ? fmtCompactValue(baseTotal, true) : Math.round(baseTotal).toLocaleString("en-US")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: ETH_HUE }} />
            Ethereum · {money ? fmtCompactValue(ethTotal, true) : Math.round(ethTotal).toLocaleString("en-US")}
          </span>
          {hood && (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: HOOD_HUE }} />
              Robinhood · {money ? fmtCompactValue(hoodTotal, true) : Math.round(hoodTotal).toLocaleString("en-US")}
            </span>
          )}
        </div>
      }
      table={
        <SrTable
          title={title}
          caption={caption}
          buckets={buckets}
          bucketMs={bucketMs}
          range={range}
          columns={[
            { label: "Base", values: base, money },
            { label: "Ethereum", values: eth, money },
            ...(hood ? [{ label: "Robinhood", values: hood, money }] : []),
          ]}
        />
      }
    >
      <div className="relative z-10 h-[220px]">
        <Chart type="bar" data={data} options={options} plugins={plugins} />
      </div>
    </ChartCard>
  );
}
