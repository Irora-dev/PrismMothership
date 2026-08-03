"use client";

import { Doughnut } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";

ChartJS.register(ArcElement, Tooltip, Legend);

// Full-spectrum palette so the donut reads as "Spectrum".
const PALETTE = [
  "#a855f7", "#06b6d4", "#22c55e", "#eab308", "#f97316",
  "#ec4899", "#3b82f6", "#14b8a6", "#ef4444", "#8b5cf6",
  "#84cc16", "#f59e0b",
];

export function HoldingsDonut({
  labels,
  values,
}: {
  labels: string[];
  values: number[];
}) {
  const colors = labels.map((_, i) => PALETTE[i % PALETTE.length]);

  return (
    <Doughnut
      data={{
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: colors,
            borderColor: "rgba(0,0,0,0.4)",
            borderWidth: 2,
            hoverOffset: 6,
          },
        ],
      }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const total = (ctx.dataset.data as number[]).reduce((s, v) => s + v, 0);
                const pct = total > 0 ? ((ctx.parsed as number) / total) * 100 : 0;
                return ` ${ctx.label}: ${pct.toFixed(1)}%`;
              },
            },
          },
        },
      }}
    />
  );
}
