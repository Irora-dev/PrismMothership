"use client";

import { useMemo } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  type ScriptableContext,
  type ChartData,
  type ChartOptions,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip);

export interface SeriesPoint {
  time: number;
  value: number;
}
export interface ConstituentSeries {
  symbol: string;
  color: string;
  series: SeriesPoint[];
  visible: boolean;
}

// Full-spectrum stroke for the index line — the literal "Spectrum" identity.
function rainbowStroke(ctx: ScriptableContext<"line">): CanvasGradient | string {
  const area = ctx.chart.chartArea;
  if (!area) return "#a855f7";
  const g = ctx.chart.ctx.createLinearGradient(area.left, 0, area.right, 0);
  g.addColorStop(0, "#ff5a5a");
  g.addColorStop(0.17, "#ff9f1c");
  g.addColorStop(0.34, "#ffe14d");
  g.addColorStop(0.5, "#5cff8f");
  g.addColorStop(0.67, "#3bd9ff");
  g.addColorStop(0.84, "#6a8bff");
  g.addColorStop(1, "#c06aff");
  return g;
}
function fillGradient(ctx: ScriptableContext<"line">): CanvasGradient | string {
  const area = ctx.chart.chartArea;
  if (!area) return "rgba(168,85,247,0.12)";
  const g = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
  g.addColorStop(0, "rgba(150,120,255,0.22)");
  g.addColorStop(0.5, "rgba(120,180,255,0.07)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  return g;
}

export function IndexChart({
  indexLabel,
  indexSeries,
  constituents,
}: {
  indexLabel: string;
  indexSeries: SeriesPoint[];
  constituents: ConstituentSeries[];
}) {
  const labels = useMemo(
    () =>
      indexSeries.map((p) =>
        new Date(p.time * 1000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      ),
    [indexSeries],
  );

  const data: ChartData<"line"> = {
    labels,
    datasets: [
      {
        label: indexLabel,
        data: indexSeries.map((p) => p.value),
        borderColor: rainbowStroke,
        backgroundColor: fillGradient,
        borderWidth: 3,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBorderColor: "#fff",
        pointHoverBorderWidth: 2,
        order: 1,
        yAxisID: "y",
      },
      ...constituents.map((c) => ({
        label: c.symbol,
        data: c.series.map((p) => p.value),
        borderColor: c.color,
        backgroundColor: c.color,
        borderWidth: 1.5,
        borderDash: [5, 5],
        fill: false,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4,
        hidden: !c.visible,
        order: 2,
        yAxisID: "y1",
      })),
    ],
  };

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "rgba(10,10,12,0.95)",
        titleColor: "#fff",
        bodyColor: "#cbd5e1",
        borderColor: "rgba(255,255,255,0.1)",
        borderWidth: 1,
        padding: 12,
        usePointStyle: true,
        callbacks: {
          label: (item) => {
            const v = item.parsed.y ?? 0;
            if (item.datasetIndex === 0) {
              return ` ${item.dataset.label}: $${v.toLocaleString("en-US", {
                minimumFractionDigits: 4,
                maximumFractionDigits: 4,
              })}`;
            }
            return ` ${item.dataset.label}: ${v.toFixed(1)} (100 = window start)`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: "rgba(255,255,255,0.45)", font: { size: 11 }, maxTicksLimit: 8 },
      },
      y: {
        type: "linear",
        position: "right",
        grid: { color: "rgba(255,255,255,0.05)" },
        ticks: {
          color: "rgba(255,255,255,0.45)",
          font: { size: 11 },
          callback: (v) => `$${Number(v).toFixed(2)}`,
        },
      },
      y1: {
        type: "linear",
        position: "left",
        display: false,
        grid: { drawOnChartArea: false },
      },
    },
  };

  return <Line data={data} options={options} />;
}
