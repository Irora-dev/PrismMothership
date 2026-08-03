"use client";

import type { ReactNode } from "react";
import type { ActivityEvent } from "@/lib/feed/types";
import { useActivityFeed } from "@/hooks/useActivityFeed";
import { PixelReveal } from "@/components/effects/pixel-reveal";
import { Ticker } from "./ticker";
import { LiveFeed, type FeedFilter } from "./live-feed";
import { BurnEngine } from "./burn-engine";
import { LaunchBanner } from "./launch-banner";
import { PulseStrip } from "./pulse-strip";
import { HomeCharts } from "./home-charts";

// The two engines, split left/right: Spectrum activity (basket trades +
// launches) on the left; everything that happens to PRISM itself — pool swap
// fees and every buy-and-burn — on the right.
function isPrismEvent(e: ActivityEvent): boolean {
  return (e.kind === "fee" && e.source === "prism-pool") || e.kind === "burn";
}
function isEcoEvent(e: ActivityEvent): boolean {
  // Prism NFT mints/retires are holder-balance events, not revenue — they
  // don't feed the strip above, so they're excluded from both columns.
  if (e.kind === "nft" || e.kind === "retire") return false;
  // Reserve-yield distributions pay the stablecoin's holders, not PRISM —
  // excluded to keep the feed PRISM-focused. (The 20% slice that DOES reach
  // PRISM still shows up, as the buy-and-burns it funds.)
  if (e.kind === "harvest") return false;
  // Burns are the ecosystem's heartbeat — they belong in BOTH columns (the
  // Spectrum card shows what basket activity feeds; the PRISM card shows what
  // happens to the token).
  if (e.kind === "burn") return true;
  return !isPrismEvent(e);
}

const ECO_FILTERS: { key: FeedFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "fee", label: "Buys & sells" },
  { key: "launch", label: "Launches" },
  { key: "burn", label: "Burns" },
];

const PRISM_FILTERS: { key: FeedFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "fee", label: "Swap fees" },
  { key: "burn", label: "Burns" },
];


// A small upward connector — each column streams into the revenue strip above.
function UpArrow({ className = "" }: { className?: string }) {
  return (
    <div
      className={`up-float hidden lg:flex absolute -top-[22px] -translate-x-1/2 z-20 items-center justify-center w-7 h-7 rounded-full border border-white/15 bg-[#0d0f14] shadow-[0_6px_18px_rgba(0,0,0,0.5)] ${className}`}
      title="This stream feeds the protocol revenue above"
      aria-hidden
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7dd3fc" strokeOpacity="0.7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 19V5" />
        <path d="m5 12 7-7 7 7" />
      </svg>
    </div>
  );
}

export function PulseDashboard({ hero }: { hero?: ReactNode }) {
  const { events, stats, mode, connected, session } = useActivityFeed(4000);

  return (
    <>
      <div className="spectrum-load" style={{ animationDelay: "250ms" }}>
        <Ticker events={events} ethUsd={stats?.ethUsd ?? 0} />
      </div>

      {hero}

      <div className="container mx-auto max-w-[1320px] px-5 md:px-8 pt-8 md:pt-12">
        <LaunchBanner />
      </div>

      <section id="live" className="container mx-auto px-5 md:px-8 max-w-[1320px] pt-1 md:pt-2 pb-8 md:pb-10">
        <PixelReveal delay={1000} accent="#22c55e" maxPixels={320} className="mt-[125px] sm:mt-[70px] mb-12 sm:mb-[96px]">
          <BurnEngine stats={stats} session={session} mode={mode} />
        </PixelReveal>

        {/* the revenue card both columns feed: live streaming counter +
            trailing-24h revenue per PRISM */}
        <PixelReveal delay={1350} accent="#22d3ee" maxPixels={240} className="mt-4 lg:mt-5">
          <PulseStrip stats={stats} session={session} />
        </PixelReveal>

        {/* twin feed cards: Spectrum + ecosystem on the left, PRISM pool swaps
            on the right — each with an arrow up into the revenue strip */}
        <div className="relative grid lg:grid-cols-2 gap-4 lg:gap-5 items-start mt-4 lg:mt-5">
          <UpArrow className="left-1/4" />
          <UpArrow className="left-3/4" />

          <PixelReveal delay={1650} accent="#38bdf8" maxPixels={300}>
            <LiveFeed
              events={events}
              mode={mode}
              connected={connected}
              ethUsd={stats?.ethUsd ?? 0}
              prismUsd={stats?.prismUsd ?? 0}
              prismSupply={stats?.supply ?? 0}
              title="Spectrum Overview"
              info="Every basket buy, sell, and launch across Ethereum & Base, the moment it lands on-chain. Each basket sets its own trading fee (1–3%), and a fixed 10% of every fee is used to buy and burn PRISM."
              filters={ECO_FILTERS}
              include={isEcoEvent}
              link={{ href: "/spectrum", label: "All stats" }}
            />
          </PixelReveal>
          <PixelReveal delay={1800} accent="#22c55e" maxPixels={340}>
            <LiveFeed
              events={events}
              mode={mode}
              connected={connected}
              eventsPerMin={stats?.eventsPerMin}
              ethUsd={stats?.ethUsd ?? 0}
              prismUsd={stats?.prismUsd ?? 0}
              prismSupply={stats?.supply ?? 0}
              title="Prism Swaps & Burns"
              info="Every swap through the PRISM pool pays an LP fee that streams 100% to PRISM holders in real time. Buy & burns, funded by basket fees, launch auctions, and reserve yield, permanently remove PRISM from the 5,000 hard cap."
              filters={PRISM_FILTERS}
              include={isPrismEvent}
            />
          </PixelReveal>
        </div>

        {/* the key charts, right under the live columns — 24h view */}
        <HomeCharts />
      </section>
    </>
  );
}
