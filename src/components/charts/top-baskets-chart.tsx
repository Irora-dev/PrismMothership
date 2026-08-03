"use client";

import { useMemo } from "react";
import { Chart } from "react-chartjs-2";
import type { ChartData, ChartOptions, Plugin } from "chart.js";
import type { RangeKey } from "@/lib/feed/types";
import { ChartCard, TOOLTIP_CHROME, fmtCompactValue } from "./time-chart";

const HUE = "#0284c7";

// value at every bar tip — the direct-label home for horizontal bars
const tipLabels: Plugin<"bar"> = {
  id: "pbTipLabels",
  afterDatasetsDraw(chart) {
    const meta = chart.getDatasetMeta(0);
    const ctx = chart.ctx;
    ctx.save();
    ctx.font = "600 11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "#cbd5e1";
    ctx.textBaseline = "middle";
    meta.data.forEach((el, i) => {
      const v = chart.data.datasets[0].data[i] as number;
      ctx.fillText(fmtCompactValue(v, true), el.x + 8, el.y);
    });
    ctx.restore();
  },
};

export function TopBasketsChart({
  range,
  caption,
  items,
  onSelect,
}: {
  range: RangeKey;
  caption: string;
  items: { address?: string; symbol: string; volumeUsd: number }[];
  /** click a bar to drill into that basket's own charts */
  onSelect?: (address: string, symbol: string) => void;
}) {
  const total = items.reduce((a, b) => a + b.volumeUsd, 0);

  const data = useMemo<ChartData<"bar">>(
    () => ({
      labels: items.map((i) => `$${i.symbol}`),
      datasets: [
        {
          data: items.map((i) => i.volumeUsd),
          backgroundColor: `${HUE}cc`,
          hoverBackgroundColor: HUE,
          borderRadius: 4,
          borderSkipped: "start" as const,
          maxBarThickness: 18,
          categoryPercentage: 0.72,
        },
      ],
    }),
    [items],
  );

  const options = useMemo<ChartOptions<"bar">>(
    () => ({
      indexAxis: "y" as const,
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 650, easing: "easeOutQuart" },
      // headroom on the right so tip labels never clip
      layout: { padding: { right: 56 } },
      onClick: (_e, els) => {
        const it = els.length ? items[els[0].index] : undefined;
        if (it?.address && onSelect) onSelect(it.address, it.symbol);
      },
      onHover: (e, els) => {
        const t = e.native?.target as HTMLElement | null;
        if (t) t.style.cursor = els.length && onSelect ? "pointer" : "default";
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...TOOLTIP_CHROME,
          callbacks: {
            title: (its) => String(its[0]?.label ?? ""),
            label: (item) => {
              const v = items[item.dataIndex]?.volumeUsd ?? 0;
              const share = total > 0 ? ` · ${((v / total) * 100).toFixed(1)}% of top-${items.length}` : "";
              const drill = onSelect && items[item.dataIndex]?.address ? " · click to drill down" : "";
              return `${fmtCompactValue(v, true)}  volume${share}${drill}`;
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: "rgba(255,255,255,0.05)", tickLength: 0 },
          border: { display: false },
          ticks: { color: "#64748b", font: { size: 10 }, maxTicksLimit: 5, callback: (v) => fmtCompactValue(Number(v), true) },
        },
        y: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: "#94a3b8", font: { size: 11, family: "ui-monospace, SFMono-Regular, Menlo, monospace" } },
        },
      },
    }),
    [items, total, onSelect],
  );

  return (
    <ChartCard
      title="Top baskets by volume"
      color={HUE}
      hero={fmtCompactValue(total, true)}
      caption={caption}
      slug="top-baskets"
      range={range}
      table={
        // div wrapper, never sr-only on the table — tables keep their content
        // width and stretch the mobile viewport (see time-chart.tsx)
        <div className="sr-only">
          <table>
            <caption>Top baskets by volume · {caption}</caption>
            <thead>
              <tr>
                <th scope="col">Basket</th>
                <th scope="col">Volume</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.symbol}>
                  <td>${i.symbol}</td>
                  <td>{fmtCompactValue(i.volumeUsd, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      }
    >
      <div className="relative z-10 h-[220px]">
        {items.length ? (
          <Chart type="bar" data={data} options={options} plugins={[tipLabels]} />
        ) : (
          <div className="h-full grid place-items-center text-sm text-slate-500 font-mono">No basket trades in this window</div>
        )}
      </div>
    </ChartCard>
  );
}
