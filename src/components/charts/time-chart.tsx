"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Chart } from "react-chartjs-2";
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
  type Plugin,
  type ScriptableContext,
} from "chart.js";
import type { RangeKey } from "@/lib/feed/types";

// the generic <Chart type=…> component doesn't auto-register controllers the
// way the typed <Line>/<Bar> ones do — they must be registered explicitly
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, LineController, BarElement, BarController, Filler, Tooltip);

export const SURFACE = "#0d0f14";

// ── shared helpers ───────────────────────────────────────────────────────────

export function fmtCompactValue(n: number, money = false): string {
  const neg = n < 0 ? "−" : "";
  const a = Math.abs(n);
  const sign = money ? "$" : "";
  if (a >= 1_000_000) return `${neg}${sign}${(a / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`;
  if (a >= 10_000) return `${neg}${sign}${(a / 1_000).toLocaleString("en-US", { maximumFractionDigits: 1 })}K`;
  if (a >= 1_000) return `${neg}${sign}${Math.round(a).toLocaleString("en-US")}`;
  return `${neg}${sign}${a.toLocaleString("en-US", { maximumFractionDigits: a >= 100 || Number.isInteger(a) ? 0 : 2 })}`;
}

export function tickLabel(ms: number, range: RangeKey): string {
  const d = new Date(ms);
  if (range === "24h") return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (range === "1w") return d.toLocaleDateString("en-US", { weekday: "short", hour: "2-digit", hour12: false });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function tooltipTitle(ms: number, bucketMs: number, range: RangeKey): string {
  const d = new Date(ms);
  if (range === "24h" || range === "1w")
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  if (range === "1y") {
    const end = new Date(ms + bucketMs - 1);
    return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  }
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// dark value-first tooltip chrome, shared by every chart on the page
export const TOOLTIP_CHROME = {
  backgroundColor: "rgba(17,19,26,0.96)",
  borderColor: "rgba(255,255,255,0.12)",
  borderWidth: 1,
  cornerRadius: 10,
  padding: 10,
  caretSize: 0,
  displayColors: false,
  titleColor: "#94a3b8",
  titleFont: { size: 11, weight: "normal" as const },
  titleMarginBottom: 6,
  bodyColor: "#f1f5f9",
  bodyFont: { size: 13, weight: "bold" as const, family: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  bodySpacing: 4,
};

// Vertical hairline that tracks the hovered X — readers aim at a date, not at
// a 2px line.
export const crosshair: Plugin = {
  id: "pbCrosshair",
  afterDraw(chart) {
    const active = chart.tooltip?.getActiveElements?.();
    if (!active?.length) return;
    const { x } = active[0].element;
    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(226,232,240,0.22)";
    ctx.stroke();
    ctx.restore();
  },
};

// Shade the stretch of the window where Base-derived data isn't available
// (the back-scan clamp) — a silent zero would read as "nothing happened".
export function coverageShade(boundaryIndex: number | null): Plugin {
  return {
    id: "pbCoverage",
    beforeDatasetsDraw(chart) {
      if (boundaryIndex == null || boundaryIndex <= 0) return;
      const x = chart.scales.x;
      const { top, bottom, left } = chart.chartArea;
      const edge = x.getPixelForValue(boundaryIndex);
      const ctx = chart.ctx;
      ctx.save();
      ctx.fillStyle = "rgba(148,163,184,0.06)";
      ctx.fillRect(left, top, Math.max(0, edge - left), bottom - top);
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = "rgba(148,163,184,0.3)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(edge, top);
      ctx.lineTo(edge, bottom);
      ctx.stroke();
      ctx.restore();
    },
  };
}

// Small dots along the baseline marking buckets where something happened
// (e.g. a basket launch) — the tooltip carries the count.
export function baselineMarks(perBucket: number[] | undefined, color: string): Plugin {
  return {
    id: "pbMarks",
    afterDatasetsDraw(chart) {
      if (!perBucket) return;
      const x = chart.scales.x;
      const { bottom } = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      for (let i = 0; i < perBucket.length; i++) {
        if (!perBucket[i]) continue;
        const px = x.getPixelForValue(i);
        ctx.beginPath();
        ctx.arc(px, bottom - 3, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = SURFACE;
        ctx.stroke();
      }
      ctx.restore();
    },
  };
}

// ── the card shell (header, delta, export, watermark) ───────────────────────

export function DeltaChip({ delta }: { delta: number | null | undefined }) {
  if (delta == null || !isFinite(delta)) return null;
  const up = delta >= 0;
  const pct = Math.abs(delta * 100);
  const txt = pct >= 100 ? `${pct.toFixed(0)}%` : `${pct.toFixed(1)}%`;
  return (
    <span
      className="font-mono text-[11px] font-semibold rounded-full px-2 py-0.5 border"
      style={{
        color: up ? "#6ee7b7" : "#fda4af",
        borderColor: up ? "rgba(52,211,153,0.25)" : "rgba(251,113,133,0.25)",
        background: up ? "rgba(52,211,153,0.07)" : "rgba(251,113,133,0.07)",
      }}
      title="vs the prior period"
    >
      {up ? "↑" : "↓"} {txt}
    </span>
  );
}

export function ChartCard({
  title,
  color,
  hero,
  caption,
  delta,
  slug,
  range,
  legend,
  children,
  table,
}: {
  title: string;
  color: string;
  hero: string;
  caption: string;
  delta?: number | null;
  slug: string;
  range: RangeKey;
  legend?: ReactNode;
  children: ReactNode;
  table: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  // one-click PNG of the card — the shareable artifact. modern-screenshot
  // (not html2canvas, which throws on Tailwind v4's oklch() colors; and not
  // html-to-image, whose per-element computed-style copy pegs the main thread
  // for minutes under Tailwind v4's thousands of custom properties). The
  // browser rasterizes the real DOM via SVG foreignObject, so modern CSS just
  // renders. Hard 15s cap: an export must fail loudly, never hang the button.
  const exportPng = async () => {
    if (!ref.current || busy) return;
    setBusy(true);
    try {
      // flush any in-flight Chart.js animation to its final frame first, so
      // the snapshot never captures a partially-drawn (or unpainted) canvas
      for (const cv of ref.current.querySelectorAll("canvas")) ChartJS.getChart(cv)?.update("none");
      const { domToPng } = await import("modern-screenshot");
      const dataUrl = await Promise.race([
        domToPng(ref.current, { backgroundColor: "#0b0d12", scale: 2 }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("export timed out")), 15_000)),
      ]);
      const a = document.createElement("a");
      a.download = `prismbeat-${slug}-${range}.png`;
      a.href = dataUrl;
      a.click();
    } catch (e) {
      console.error("[charts] PNG export failed:", e); // never fail invisibly
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={ref} className="glass-card relative overflow-hidden p-5 h-full flex flex-col">
      <div
        className="absolute -right-14 -top-16 w-48 h-48 rounded-full blur-3xl opacity-[0.13] pointer-events-none"
        style={{ background: color }}
      />
      <div className="relative z-10 flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
            <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold truncate">{title}</span>
          </div>
          <div className="flex items-baseline gap-2.5 mt-2.5">
            <span className="font-mono font-bold text-3xl leading-none txt-white">{hero}</span>
            <DeltaChip delta={delta} />
          </div>
          <div className="text-[11px] text-slate-500 mt-1.5 truncate">{caption}</div>
        </div>
        <button
          onClick={exportPng}
          title="Export as PNG"
          aria-label={`Export ${title} chart as PNG`}
          className="shrink-0 grid place-items-center w-8 h-8 rounded-full border border-white/10 bg-white/[0.03] text-slate-500 hover:text-white hover:border-white/20 transition-colors"
        >
          {busy ? (
            <span className="inline-block w-3 h-3 rounded-full border-2 border-white/20 border-t-white/60 animate-spin" />
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="m7 10 5 5 5-5" />
              <path d="M12 15V3" />
            </svg>
          )}
        </button>
      </div>

      {legend}
      {children}

      {/* quiet brand stamp — earns its keep on exported PNGs */}
      <div className="relative z-10 mt-auto pt-2 text-right font-mono text-[9px] uppercase tracking-[0.2em] text-slate-700 select-none">
        prismbeat
      </div>
      {table}
    </div>
  );
}

export function SrTable({
  title,
  caption,
  buckets,
  bucketMs,
  range,
  columns,
}: {
  title: string;
  caption: string;
  buckets: number[];
  bucketMs: number;
  range: RangeKey;
  columns: { label: string; values: number[]; money?: boolean }[];
}) {
  return (
    // sr-only wraps a DIV, never the table itself: display:table treats width
    // as a MINIMUM, so an sr-only <table> stays content-wide (615px measured)
    // and stretches the mobile layout viewport (the 2026-08-03 sweep's +12px).
    <div className="sr-only">
      <table>
        <caption>
          {title} · {caption}
        </caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            {columns.map((c) => (
              <th key={c.label} scope="col">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {buckets.map((t, i) => (
            <tr key={t}>
              <td>{tooltipTitle(t, bucketMs, range)}</td>
              {columns.map((c) => (
                <td key={c.label}>{fmtCompactValue(c.values[i] ?? 0, c.money ?? false)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── the standard single-series chart (line or columns) ──────────────────────

export interface TimeChartProps {
  title: string;
  caption: string;
  color: string;
  range: RangeKey;
  bucketMs: number;
  buckets: number[];
  values: number[];
  kind?: "line" | "bar"; // sparse integer counts read honestly as columns
  /** bars colored by sign (green above zero, red below) — for net-flow series */
  signed?: boolean;
  money?: boolean;
  total?: number; // hero override (defaults to the window sum)
  heroFmt?: (n: number) => string;
  delta?: number | null;
  slug: string;
  /** baseline dots + a tooltip line for buckets where these events landed */
  marks?: { label: string; perBucket: number[]; color: string };
  /** extra tooltip readout (e.g. volume under trade count) */
  extra?: { label: string; values: number[]; money?: boolean };
  /** index before which Base data is unavailable (shaded) */
  coverageIndex?: number | null;
  /** treat the final bucket as in-progress (dashed / dimmed) */
  partialLast?: boolean;
}

export function TimeChart({
  title,
  caption,
  color,
  range,
  bucketMs,
  buckets,
  values,
  kind = "line",
  signed = false,
  money = false,
  total,
  heroFmt,
  delta,
  slug,
  marks,
  extra,
  coverageIndex = null,
  partialLast = true,
}: TimeChartProps) {
  const heroTotal = total ?? values.reduce((a, b) => a + b, 0);
  const hero = heroFmt
    ? heroFmt(heroTotal)
    : money
      ? fmtCompactValue(heroTotal, true)
      : Math.round(heroTotal).toLocaleString("en-US");
  const last = values.length - 1;

  const data = useMemo<ChartData<"line" | "bar">>(() => {
    const fill = (ctx: ScriptableContext<"line">) => {
      const area = ctx.chart.chartArea;
      if (!area) return "transparent";
      const g = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
      g.addColorStop(0, `${color}2b`);
      g.addColorStop(0.7, `${color}0a`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      return g;
    };
    const labels = buckets.map((t) => tickLabel(t, range));
    if (kind === "bar") {
      // signed mode: inflow green / outflow red; otherwise the series hue
      const barHue = (v: number) => (signed ? (v >= 0 ? "#10b981" : "#fb7185") : color);
      return {
        labels,
        datasets: [
          {
            type: "bar" as const,
            data: values,
            // the trailing bucket is still filling — dim it so it doesn't read
            // as a crash
            backgroundColor: values.map((v, i) => (partialLast && i === last ? `${barHue(v)}59` : `${barHue(v)}cc`)),
            hoverBackgroundColor: values.map((v) => barHue(v)),
            borderRadius: 4,
            borderSkipped: "start" as const,
            maxBarThickness: 24,
            categoryPercentage: 0.82,
            barPercentage: 0.92,
          },
        ],
      };
    }
    return {
      labels,
      datasets: [
        {
          type: "line" as const,
          data: values,
          borderColor: color,
          borderWidth: 2,
          borderJoinStyle: "round" as const,
          borderCapStyle: "round" as const,
          tension: 0.35,
          fill: true,
          backgroundColor: fill,
          pointRadius: 0,
          pointHitRadius: 24,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: color,
          pointHoverBorderColor: SURFACE,
          pointHoverBorderWidth: 2,
          // dash the final, in-progress segment
          segment: partialLast
            ? { borderDash: (c: { p1DataIndex: number }) => (c.p1DataIndex === last ? [4, 4] : undefined) }
            : undefined,
        },
      ],
    };
  }, [buckets, values, color, range, kind, signed, partialLast, last]);

  const options = useMemo<ChartOptions<"line" | "bar">>(
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
              const lines = [
                `${money ? fmtCompactValue(values[i] ?? 0, true) : Math.round(values[i] ?? 0).toLocaleString("en-US")}  ${title.toLowerCase()}${partialLast && i === last ? " (in progress)" : ""}`,
              ];
              if (extra) lines.push(`${fmtCompactValue(extra.values[i] ?? 0, extra.money ?? true)}  ${extra.label.toLowerCase()}`);
              if (marks && (marks.perBucket[i] ?? 0) > 0)
                lines.push(`${marks.perBucket[i]}  ${marks.label.toLowerCase()}`);
              return lines;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: "#64748b", font: { size: 10 }, maxTicksLimit: 6, maxRotation: 0, autoSkipPadding: 18 },
        },
        y: {
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
    [buckets, values, bucketMs, range, money, title, extra, marks, partialLast, last],
  );

  const plugins = useMemo(() => {
    const list: Plugin[] = [crosshair];
    if (coverageIndex != null) list.push(coverageShade(coverageIndex));
    if (marks) list.push(baselineMarks(marks.perBucket, marks.color));
    return list;
  }, [coverageIndex, marks]);

  const cols = [{ label: title, values, money }];
  if (extra) cols.push({ label: extra.label, values: extra.values, money: extra.money ?? true });

  return (
    <ChartCard
      title={title}
      color={color}
      hero={hero}
      caption={caption}
      delta={delta}
      slug={slug}
      range={range}
      table={<SrTable title={title} caption={caption} buckets={buckets} bucketMs={bucketMs} range={range} columns={cols} />}
    >
      <div className="relative z-10 h-[220px]">
        <Chart type={kind} data={data} options={options} plugins={plugins} />
      </div>
    </ChartCard>
  );
}
