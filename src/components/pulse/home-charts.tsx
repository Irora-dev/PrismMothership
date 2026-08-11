"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ChartsPayload } from "@/lib/feed/types";
import { TimeChart, fmtCompactValue } from "@/components/charts/time-chart";
import { TradesChart } from "@/components/charts/trades-chart";
import { Reveal } from "@/components/effects/reveal";

// The homepage's key-charts strip: PRISM burned and baskets launched side by side
// (supply removed, baskets created), then fees to holders, basket swap fees and
// trades. Fixed to the last 24h with hourly buckets — the /charts page has every
// range. Same data source as /charts, one fetch, refreshed with it.
export function HomeCharts() {
  const [data, setData] = useState<ChartsPayload | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/charts?range=24h", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d: ChartsPayload) => {
          if (alive) setData(d);
        })
        .catch(() => {
          /* keep the previous frame */
        });
    load();
    const t = setInterval(load, 120_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!data) return null;

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const caption = "last 24h";

  // The window these hourly buckets actually cover, stated explicitly — "last 24h"
  // alone doesn't tell you which 24 hours you're looking at.
  const stamp = (ms: number) =>
    new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  const range =
    data.buckets.length > 1
      ? `${stamp(data.buckets[0])} → ${stamp(data.buckets[data.buckets.length - 1] + data.bucketMs)}`
      : caption;

  return (
    <div className="mt-10">
      <div className="flex items-end justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg sm:text-xl font-bold txt-white leading-none">The numbers, live</h2>
          <p className="text-[12px] text-slate-500 mt-1.5">The ones that matter, trailing 24 hours, hourly.</p>
        </div>
        <Link
          href="/charts"
          className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-full px-2.5 py-1.5 border border-white/10 bg-white/[0.03] text-slate-400 hover:text-white hover:border-white/20 transition-colors"
        >
          All charts
        </Link>
      </div>

      <div className="grid md:grid-cols-2 gap-4 lg:gap-5">
        <Reveal>
          <TimeChart
            title="PRISM burned"
            caption={`${caption} · bought & sent to dEaD`}
            color="#ea580c"
            range="24h"
            bucketMs={data.bucketMs}
            buckets={data.buckets}
            values={data.burnedPrism}
            kind="bar"
            heroFmt={(n) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} PRISM`}
            slug="home-prism-burned"
          />
        </Reveal>
        <Reveal>
          {/* Baskets launched sits beside the burn deliberately (ruling, 2026-07-30): the
              two headline outcomes of the ecosystem — supply removed, and new
              baskets created. Hourly buckets, with the window spelled out. */}
          <TimeChart
            title="Baskets launched"
            caption={`${range} · hourly`}
            color="#38bdf8"
            range="24h"
            bucketMs={data.bucketMs}
            buckets={data.buckets}
            values={data.launches}
            kind="bar"
            heroFmt={(n) => `${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
            slug="home-baskets-launched"
          />
        </Reveal>
        <Reveal>
          <TimeChart
            title="Fees to holders"
            caption={`${caption} · PRISM pool LP revenue`}
            color="#22c55e"
            range="24h"
            bucketMs={data.bucketMs}
            buckets={data.buckets}
            values={data.feesUsd}
            kind="bar"
            money
            slug="home-fees-to-holders"
          />
        </Reveal>
        <Reveal>
          <TimeChart
            title="Basket swap fees"
            caption={`${caption} · 10% of every fee burns PRISM`}
            color="#f59e0b"
            range="24h"
            bucketMs={data.bucketMs}
            buckets={data.buckets}
            values={data.basketBurnUsd.map((v) => v * 10)}
            kind="bar"
            money
            slug="home-basket-fees"
          />
        </Reveal>
        <Reveal>
          <TradesChart
            range="24h"
            bucketMs={data.bucketMs}
            buckets={data.buckets}
            buys={data.buys}
            sells={data.sells}
            volumeUsd={data.volumeUsd}
            launches={data.launches}
            caption={`${caption} · ${fmtCompactValue(sum(data.volumeUsd), true)} volume`}
          />
        </Reveal>
      </div>
    </div>
  );
}
