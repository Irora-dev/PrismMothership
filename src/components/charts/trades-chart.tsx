"use client";

import { useMemo } from "react";
import { Chart } from "react-chartjs-2";
import type { ChartData, ChartOptions, Plugin } from "chart.js";
import type { RangeKey } from "@/lib/feed/types";
import {
  ChartCard,
  SrTable,
  TOOLTIP_CHROME,
  baselineMarks,
  coverageShade,
  crosshair,
  fmtCompactValue,
  tickLabel,
  tooltipTitle,
} from "./time-chart";

// Mirrored columns: buys grow up from the zero line, sells grow down — the
// direction of the market readable at a glance. Hues validated (dark surface):
export const BUY_HUE = "#059669";
export const SELL_HUE = "#e11d48";

export function TradesChart({
  range,
  bucketMs,
  buckets,
  buys,
  sells,
  volumeUsd,
  launches,
  delta,
  coverageIndex = null,
  caption,
}: {
  range: RangeKey;
  bucketMs: number;
  buckets: number[];
  buys: number[];
  sells: number[];
  volumeUsd: number[];
  launches: number[];
  delta?: number | null;
  coverageIndex?: number | null;
  caption: string;
}) {
  const totalTrades = buys.reduce((a, b) => a + b, 0) + sells.reduce((a, b) => a + b, 0);
  const last = buckets.length - 1;

  const data = useMemo<ChartData<"bar">>(
    () => ({
      labels: buckets.map((t) => tickLabel(t, range)),
      datasets: [
        {
          label: "Buys",
          data: buys,
          backgroundColor: buys.map((_, i) => (i === last ? `${BUY_HUE}59` : `${BUY_HUE}cc`)),
          hoverBackgroundColor: BUY_HUE,
          borderRadius: 4,
          borderSkipped: "start" as const,
          maxBarThickness: 24,
          stack: "trades",
          categoryPercentage: 0.82,
          barPercentage: 0.92,
        },
        {
          label: "Sells",
          data: sells.map((v) => -v),
          backgroundColor: sells.map((_, i) => (i === last ? `${SELL_HUE}59` : `${SELL_HUE}cc`)),
          hoverBackgroundColor: SELL_HUE,
          borderRadius: 4,
          borderSkipped: "start" as const,
          maxBarThickness: 24,
          stack: "trades",
          categoryPercentage: 0.82,
          barPercentage: 0.92,
        },
      ],
    }),
    [buckets, buys, sells, range, last],
  );

  const options = useMemo<ChartOptions<"bar">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 650, easing: "easeOutQuart" },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false }, // custom HTML legend below (line-keys, text tokens)
        tooltip: {
          ...TOOLTIP_CHROME,
          callbacks: {
            title: (items) => tooltipTitle(buckets[items[0]?.dataIndex ?? 0] ?? 0, bucketMs, range),
            label: (item) => {
              const i = item.dataIndex;
              if (item.datasetIndex === 0) {
                const lines = [`${(buys[i] ?? 0).toLocaleString("en-US")}  buys`, `${(sells[i] ?? 0).toLocaleString("en-US")}  sells`];
                lines.push(`${fmtCompactValue(volumeUsd[i] ?? 0, true)}  volume`);
                if ((launches[i] ?? 0) > 0) lines.push(`${launches[i]}  baskets launched`);
                if (i === last) lines.push("(in progress)");
                return lines;
              }
              return []; // everything is on the first dataset's readout
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
          grid: { color: "rgba(255,255,255,0.05)", tickLength: 0 },
          border: { display: false },
          ticks: {
            color: "#64748b",
            font: { size: 10 },
            maxTicksLimit: 5,
            padding: 8,
            callback: (v) => fmtCompactValue(Math.abs(Number(v))),
          },
        },
      },
    }),
    [buckets, buys, sells, volumeUsd, launches, bucketMs, range, last],
  );

  const plugins = useMemo(() => {
    const list: Plugin[] = [crosshair, baselineMarks(launches, "#6366f1")];
    if (coverageIndex != null) list.push(coverageShade(coverageIndex));
    return list;
  }, [launches, coverageIndex]);

  return (
    <ChartCard
      title="Basket trades"
      color={BUY_HUE}
      hero={Math.round(totalTrades).toLocaleString("en-US")}
      caption={caption}
      delta={delta}
      slug="basket-trades"
      range={range}
      legend={
        <div className="relative z-10 flex items-center gap-4 mb-2 text-[11px] text-slate-400 font-medium">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: BUY_HUE }} />
            Buys
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: SELL_HUE }} />
            Sells
          </span>
          <span className="inline-flex items-center gap-1.5 text-slate-500">
            <span className="w-2.5 h-2.5 rounded-full border-2" style={{ borderColor: "#6366f1" }} />
            Launch
          </span>
        </div>
      }
      table={
        <SrTable
          title="Basket trades"
          caption={caption}
          buckets={buckets}
          bucketMs={bucketMs}
          range={range}
          columns={[
            { label: "Buys", values: buys },
            { label: "Sells", values: sells },
            { label: "Volume", values: volumeUsd, money: true },
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
