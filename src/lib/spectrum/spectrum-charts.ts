// ── The /spectrum page's data shape ──────────────────────────────────────────
// Models exactly what the V2 contracts will emit (see TOPIC_V2 in
// chain/constants.ts), so flipping to live data is a reader swap, not a
// schema change:
//   • launches per chain        ← SpectrumFactory.Launched (ETH + Base)
//   • buys / sells / volume     ← SpectrumBasket.Minted / Redeemed (+ router Swapped)
//   • fees earned per chain     ← SpectrumBasket.FeesAccrued (USD)
//   • the 4-way fee split       ← FeesAccrued(toHolders, toBurn, toCreator, toInterfaceAndLauncher)
//   • auction proceeds          ← Launched.ethPaid (→ 100% PRISM buy-and-burn)
//
// PRE-LAUNCH: the charts are intentionally BLANK (mode "pending"), not
// simulated. LIVE WIRING: fill the SPECTRUM_V2 addresses (env) and add a
// fetchLiveSpectrumCharts that folds those logs into hourly buckets exactly
// like lib/chain/charts.ts does for v1 — the page's pre-launch state clears
// itself via payload.mode.

import { RANGES, type RangeKey } from "../feed/types";

export interface SpectrumPrevTotals {
  launches: number;
  buys: number;
  sells: number;
  volumeUsd: number;
  buyVolumeUsd: number;
  sellVolumeUsd: number;
  feesUsd: number;
  auctionEth: number;
}

// Where the launch-auction ETH currently sits on its way to the PRISM burn.
// Mainnet: factory escrows → permissionless flush → L1 burner → burner buys
// PRISM → dEaD. Base: the factory bridges inline (≈no standing escrow) and the
// ETH lands at the SAME L1 burner ~7 days later. The burner also receives v1
// bridged fees, so its balance/burn totals are pipeline-wide, not auction-only.
export interface AuctionPipeline {
  escrowedEth: number; // sitting in the factories awaiting flushAuctionProceeds()
  burnerEth: number; // arrived at the L1 burner, awaiting its flush(minOut) crank
  burnedPrism: number; // PRISM the burner has bought & burned to dEaD, all-time
}

export interface SpectrumChartsPayload {
  mode: "live" | "pending"; // pending = V2 factory/router not wired yet
  range: RangeKey;
  generatedAt: number;
  bucketMs: number;
  buckets: number[]; // bucket START times (ms), oldest → newest
  launchesEth: number[]; // factory launches per bucket, per chain
  launchesBase: number[];
  launchesHood: number[];
  buys: number[]; // mints + router buys per bucket (both chains)
  sells: number[]; // redeems + router sells per bucket
  buyVolumeUsd: number[]; // per-side volume — net flow = buy − sell
  sellVolumeUsd: number[];
  batchVolumeUsd: number[]; // portfolio batch funding per bucket (the batcher watch, USD)
  feesEthUsd: number[]; // basket fees earned per bucket, Ethereum baskets (USD)
  feesBaseUsd: number[]; // … Base baskets (USD)
  feesHoodUsd: number[]; // … Robinhood Chain baskets (USD)
  // window totals of the FeesAccrued split (USD). Holders are guaranteed ≥70% of
  // the post-burn remainder; burn is a fixed 25% off the top. `league` is the
  // Robinhood lineage's 5th field (creator-league slice, 5% off the top) — zero
  // on chains whose baskets emit the 4-field event.
  feeSplit: { holders: number; burn: number; creator: number; interfaces: number; league: number };
  auctionEth: number; // launch-auction ETH paid in the window (100% → PRISM burn)
  auctionSeries: number[]; // that same auction ETH, per bucket (both chains)
  auctionPipeline: AuctionPipeline;
  // Σ pendingPrismBurn() across every discovered basket (USDC 6dp ≈ USD): burn
  // share accrued but not yet bridged — queued burns are not missing burns.
  queuedBurnUsd: number; // live position of the ETH on its way to the burn
  tradersTotal: number; // unique traders across the window
  topBaskets: { address: string; symbol: string; volumeUsd: number; chain: "ethereum" | "base" | "robinhood" }[];
  ethUsd: number;
  prev: SpectrumPrevTotals | null;
}

// The pre-launch payload: correct buckets, every series zero. The page renders
// its real frame (so the layout is visible) with a pre-launch banner.
export function emptySpectrumCharts(range: RangeKey, nowMs: number): SpectrumChartsPayload {
  const cfg = RANGES[range];
  const bucketMs = cfg.bucketSec * 1000;
  const endMs = Math.floor(nowMs / bucketMs) * bucketMs;
  const startMs = endMs - cfg.buckets * bucketMs;
  const buckets = Array.from({ length: cfg.buckets }, (_, i) => startMs + i * bucketMs);
  const zeros = () => new Array<number>(cfg.buckets).fill(0);

  return {
    mode: "pending",
    range,
    generatedAt: nowMs,
    bucketMs,
    buckets,
    launchesEth: zeros(),
    launchesBase: zeros(),
    launchesHood: zeros(),
    buys: zeros(),
    sells: zeros(),
    buyVolumeUsd: zeros(),
    sellVolumeUsd: zeros(),
    batchVolumeUsd: zeros(),
    feesEthUsd: zeros(),
    feesBaseUsd: zeros(),
    feesHoodUsd: zeros(),
    feeSplit: { holders: 0, burn: 0, creator: 0, interfaces: 0, league: 0 },
    auctionEth: 0,
    auctionSeries: zeros(),
    auctionPipeline: { escrowedEth: 0, burnerEth: 0, burnedPrism: 0 },
    queuedBurnUsd: 0,
    tradersTotal: 0,
    topBaskets: [],
    ethUsd: 0,
    prev: null,
  };
}
