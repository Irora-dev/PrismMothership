// The single shape every activity event takes, whether it came from the chain
// or the demo simulator. The UI never needs to know which.

export type EventKind =
  | "burn" // PRISM bought on the open market and sent to dEaD
  | "fee" // yield streamed to holders (PRISM pool LP fees, or Base index fees)
  | "launch" // a new Spectrum index token went live
  | "harvest" // dstable / index yield harvested (feeds a burn)
  | "retire" // a Prism NFT crossed an integer down and was retired
  | "nft" // a new Prism NFT was minted (a holder crossed up into a whole PRISM)
  | "batch"; // a batched portfolio execution through the batcher (one signature, many legs)

export type EventSource =
  | "dstable" // the stablecoin's 20%-of-yield buy-and-burn
  | "spectrum-index" // an index's 25%-of-fees buy-and-burn
  | "spectrum-auction" // 90% of a Dutch-auction fee buy-and-burn
  | "prism-pool" // the PRISM/ETH pool itself
  | "portfolio" // the Spectrum Portfolio batcher (watch list until the ceremony)
  | "wrapper" // the direct-swap fee wrapper (fee in the sell asset, fee/8 integrator + remainder burn)
  | "ecosystem"; // attributed generically when the exact source is unknown

export type Chain = "ethereum" | "base" | "robinhood";

export interface ActivityEvent {
  id: string;
  kind: EventKind;
  source: EventSource;
  chain?: Chain; // which chain the event happened on (yield events distinguish Base vs mainnet)
  ts: number; // ms epoch
  blockNumber?: number;
  txHash?: string;
  prism?: number; // PRISM amount (burned / retired)
  eth?: number; // ETH spent / swapped / yield
  tradeEth?: number; // for fee events: size of the trade that generated the fee (ETH)
  tradeUsd?: number; // for index fee events: size of the trade that generated the fee (USD)
  side?: "buy" | "sell"; // for index trade events: the direction of the underlying trade
  usd?: number; // optional notional in USD
  feeUsd?: number; // for batch events: the batcher's charged fee (USD)
  legs?: number; // for batch events: assets filled in the batch
  burnUsd?: number; // batch events: the fee's burn share actually DELIVERED (measured); wrapper events: the burn cut priced by a stable leg
  burnEth?: number; // for wrapper events: the fee's burn cut, MEASURED off FeeCharged (the whole fee on gen-3, 7/8 on the old build)
  wholeFeeBurn?: boolean; // wrapper events: this event's OWN generation burns the whole fee (gen-3) — display truth that survives even when the amounts are unpriced
  actor?: string; // address that earned fees / triggered a swap
  label?: string; // e.g. index name
  symbol?: string; // index ticker (launches)
  note?: string; // short human caption
}

export interface PulseStats {
  mode: "live" | "demo";
  totalBurned: number; // cumulative PRISM at dEaD (all time)
  supply: number; // current circulating PRISM
  cap: number; // hard cap (5,000)
  liveNfts: number; // approx live Prism NFT count
  burnsToday: number; // count of buy-and-burns in the last 24h
  prismBurnedToday: number; // PRISM burned in the last 24h
  feeEventsToday: number; // swaps (fee-generating) in the last 24h
  ethVolumeToday: number; // ETH swapped through the PRISM pool in 24h
  feesToHolders24h: number; // ETH streamed to PRISM holders in 24h (LP fees + Base index fees)
  feesToHolders7d: number; // ETH streamed to holders in the last 7 days
  feesToHoldersTotal: number; // total fee value to holders, all time (ETH-equiv, earned)
  feesEthTotal: number; // ETH-leg fees to holders, all time (ETH)
  feesPrismTotal: number; // PRISM-leg fees to holders, all time (PRISM tokens)
  bridgePendingEth: number; // Base 10% cut pooling on the 7-day bridge, waiting to buy & burn
  bridgeNextBurnTs?: number; // when the next bridged "big burn" unlocks
  ethUsd: number; // ETH price in USD (Chainlink) — for $-primary display
  prismUsd?: number; // PRISM price in USD (DexScreener, cached) — for burn estimates
  indexCount: number; // number of live Spectrum index tokens (Ethereum + Base)
  indexFeesTotal: number; // cumulative Spectrum index swap fees generated (Base, ETH-equiv) — feeds both burns and holder yield
  dstableSupply: number; // dstable in circulation (ETH + Base total supply minus protocol-owned pool liquidity)
  dstableVolumeUsd: number; // cumulative dstable trade volume that's flowed through the index pools (USD)
  dstableReserveUsd: number; // dstable reserves currently deposited in Aave (USD)
  dstableAaveApy: number; // live blended Aave supply APY on those reserves (fraction, e.g. 0.03)
  eventsPerMin: number; // recent heartbeat rate
  lastBurnTs?: number;
  blockNumber?: number;
}

export interface FeedResponse {
  mode: "live" | "demo";
  events: ActivityEvent[]; // newest-first
  cursor: string; // opaque; pass back on the next poll
  // null when the stats read timed out — the events still ship rather than the
  // whole response dying. The client's state is already `PulseStats | null` and
  // every consumer optional-chains it.
  stats: PulseStats | null;
  pollMs: number; // server-recommended poll interval
  serverTime: number;
}

// ── Charts page ────────────────────────────────────────────────────────────
export type RangeKey = "24h" | "1w" | "1m" | "1y";

// One shared range config drives the API, the demo simulator, and the UI, so
// every chart on the page is always sliced identically.
export const RANGES: Record<RangeKey, { label: string; bucketSec: number; buckets: number; caption: string }> = {
  "24h": { label: "24H", bucketSec: 3_600, buckets: 24, caption: "last 24 hours" },
  "1w": { label: "1W", bucketSec: 6 * 3_600, buckets: 28, caption: "last 7 days" },
  "1m": { label: "1M", bucketSec: 24 * 3_600, buckets: 30, caption: "last 30 days" },
  "1y": { label: "1Y", bucketSec: 7 * 24 * 3_600, buckets: 52, caption: "last 12 months" },
};

export function isRangeKey(x: string): x is RangeKey {
  return x === "24h" || x === "1w" || x === "1m" || x === "1y";
}

// totals of the window immediately before the selected one — drives the
// "+18% vs prior period" deltas. Null when computing it would be unreasonable
// (the 1y range would need a two-year back-scan).
export interface ChartsPrevTotals {
  launches: number;
  buys: number;
  sells: number;
  volumeUsd: number;
  buyVolumeUsd: number;
  sellVolumeUsd: number;
  feesUsd: number;
  burnedPrism: number;
  traders: number;
  basketBurnUsd: number;
}

export interface ChartsPayload {
  mode: "live" | "demo";
  range: RangeKey;
  generatedAt: number;
  bucketMs: number;
  buckets: number[]; // bucket START times (ms), oldest → newest
  launches: number[]; // baskets launched per bucket (ETH + Base)
  buys: number[]; // basket buys per bucket
  sells: number[]; // basket sells per bucket
  volumeUsd: number[]; // basket trade volume per bucket (USD)
  buyVolumeUsd: number[]; // buy-side volume per bucket (USD) — net flow = buy − sell
  sellVolumeUsd: number[]; // sell-side volume per bucket (USD)
  feesUsd: number[]; // PRISM pool LP fees per bucket (USD, both legs)
  poolVolumeUsd?: number[]; // PRISM pool swap notional per bucket (USD, ETH side, measured off Swap events) — absent in demo mode
  wrapperVolumeUsd?: number[]; // wrapper swap notional per bucket (native sells, USD at read)
  batchFeesUsd?: number[]; // the batcher's charged fees per bucket (executed5, 6dp USD)
  batchBurnUsd?: number[]; // the batch fees' delivered burn share per bucket (BurnShareDelivered, measured)
  wrapperFeesUsd?: number[]; // wrapper fees per bucket (integratorCut + burnCut, measured off FeeCharged)
  wrapperBurnUsd?: number[]; // the wrapper fees' burn cut per bucket (measured, fee − fee/8)
  burnedPrism: number[]; // PRISM sent to dEaD per bucket
  traders: number[]; // unique basket traders per bucket
  tradersTotal: number; // unique traders across the WHOLE window (per-bucket sums overcount repeat wallets)
  basketBurnUsd: number[]; // PRISM's 25%-of-fee cut accruing from basket trades (USD)
  burnedStartTotal: number; // cumulative PRISM burned BEFORE the window (for the cumulative chart)
  cap: number; // PRISM hard cap
  supply: number; // circulating PRISM (for revenue-per-PRISM)
  baseCoverageFromMs: number | null; // Base-derived series only cover from here (scan clamp); null = full coverage
  // ETH-side series begin here (PRISM pool inception) when that's inside the
  // window. Before it the pool didn't exist — TRUE zeros, not a scan gap — so
  // this drives annualized run-rate denominators, NOT the coverage shading.
  ethCoverageFromMs: number | null;
  topBaskets: { address: string; symbol: string; volumeUsd: number }[]; // top baskets by volume in the window
  // Base revenue currently in flight on the ~7-day withdrawal bridge (NOW-
  // anchored, independent of the selected range). nextBurnTs estimates when
  // the oldest pending bridge unlocks and buys & burns PRISM on Ethereum.
  bridge: { pendingEth: number; nextBurnTs: number | null } | null;
  ethUsd: number; // spot ETH/USD used for $-display of ETH-denominated figures
  prev: ChartsPrevTotals | null;
}

// ── Per-basket drill-down (?basket=0x…) ─────────────────────────────────────
export interface BasketPrevTotals {
  buys: number;
  sells: number;
  buyVolumeUsd: number;
  sellVolumeUsd: number;
  feeUsd: number;
}

export interface BasketChartsPayload {
  mode: "live" | "demo";
  range: RangeKey;
  generatedAt: number;
  bucketMs: number;
  buckets: number[];
  address: string;
  symbol: string;
  buys: number[]; // buys per bucket
  sells: number[]; // sells per bucket
  buyVolumeUsd: number[]; // buy-side USD per bucket
  sellVolumeUsd: number[]; // sell-side USD per bucket
  feeUsd: number[]; // gross swap fees this basket generated per bucket (its own bps)
  baseCoverageFromMs: number | null;
  prev: BasketPrevTotals | null;
}
