import { AbiCoder, Contract, JsonRpcProvider, formatUnits, id, zeroPadValue, type Log } from "ethers";
import {
  RANGES,
  type BasketChartsPayload,
  type BasketPrevTotals,
  type ChartsPayload,
  type ChartsPrevTotals,
  type RangeKey,
} from "../feed/types";
import {
  emptySpectrumCharts,
  type AuctionPipeline,
  type SpectrumChartsPayload,
  type SpectrumPrevTotals,
} from "../spectrum/spectrum-charts";
import { baseIndexTokens, basketFeeRate, ethIndexTokens, getEthUsd, getHoodProvider, getLatestBlock, hoodIndexTokens } from "./live";
import { listIndexes } from "../spectrum/index-data";
import {
  BASKET_BURN_SHARE,
  DEAD,
  INDEX_POOL_FEE_RATE,
  L1_PRISM_BURNER,
  NO_POOL_ID,
  POOL_MANAGER,
  PRISM,
  PRISM_CAP,
  PRISM_POOL_FROM_BLOCK,
  PRISM_POOL_ID,
  SPECTRUM_BASE,
  SPECTRUM_ETH,
  SPECTRUM_V2,
  SPECTRUM_LEGACY_FACTORIES,
  SPECTRUM_V3_FACTORIES,
  SPECTRUM_V2_FROM_BLOCK,
  TOPIC,
  TOPIC_V2,
  TOPIC_BATCH,
  TOPIC_WRAPPER,
  WRAPPER_WATCH,
  TOPIC_COLLECTOR,
  TOPIC_DEAD,
  PORTFOLIO_BATCHER_WATCH,
  PORTFOLIO_COLLECTOR_WATCH,
  USDC_DECIMALS,
} from "./constants";

// ── The charts store ─────────────────────────────────────────────────────────
// ONE canonical set of hourly buckets feeds every range (24h ⊂ 1w ⊂ 1m ⊂ 1y)
// and the prior-window deltas. The store is INCREMENTAL: a cold instance
// back-scans once, then every refresh only reads blocks minted since the last
// poll (~1–2 getLogs per chain per minute of viewing). Snapshots persist to
// Netlify Blobs so warm data survives cold starts; without Blobs (local dev)
// it degrades to the in-memory behaviour.

const abi = AbiCoder.defaultAbiCoder();
const ERC20_ABI = ["function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)"];
const HOUR_MS = 3_600_000;
const ETH_SPB = 12;
const BASE_SPB = 2;
const HOOD_SPB = 0.1; // Robinhood Chain — measured live 2026-07-11
// ETH history horizon: the 1y range + margin (clamped to pool inception).
const ETH_HORIZON_SEC = 370 * 86_400;
// Hard bound on Base back-scans (~35 days @ 2s) — consistent with live.ts.
// Base-derived series report their coverage start so the UI shades the gap.
const BASE_MAX_LOOKBACK = 1_500_000;
// PRISM-pool fees earn on both legs; the PRISM leg ≈ the ETH leg (see live.ts).
const LEG_FACTOR = 2;
const TOP_BASKETS = 8;
const REFRESH_MIN_MS = 60_000; // at most one incremental scan per minute
const PERSIST_EVERY_MS = 300_000; // blob snapshot cadence
const PRUNE_AFTER_MS = 375 * 86_400_000;

// CDN TTLs, exported for the API route's cache headers.
export const CHARTS_TTL_SEC: Record<RangeKey, number> = { "24h": 120, "1w": 300, "1m": 600, "1y": 1800 };

const num = (v: bigint, d = 18) => Number(formatUnits(v, d));
const num6 = (v: bigint) => Number(formatUnits(v, 6)); // USDC-denominated (basket fees / auction quote)

interface BasketHour {
  buys: number;
  sells: number;
  buyUsd: number;
  sellUsd: number;
  feeUsd: number; // gross fee the basket charged (its own bps)
}
interface HourAgg {
  launches: number; // combined ETH+Base+Robinhood (drives the /charts payload)
  launchesEth: number; // per-chain split (drives the /spectrum payload)
  launchesBase: number;
  launchesHood: number;
  auctionEth: number; // Σ ethPaid from V2 launches this hour (→ PRISM burn)
  buys: number;
  sells: number;
  volumeUsd: number;
  buyUsd: number; // buy-side USD — net flow = buyUsd − sellUsd
  sellUsd: number;
  feesEth: number; // PRISM-pool LP fees (FeesPoked), ETH leg — valued live on read
  poolVolEth: number; // PRISM-pool swap notional (ETH side, |amount0| per PoolManager Swap) — MEASURED, not fee-derived
  batchVolUsd: number; // portfolio batch funding (the batcher watch), 6dp settlement coin read as USD
  batchFeeUsd: number; // the batcher's charged fee (executed5 shape; the 7-shape's fee is native and skipped)
  batchBurnUsd: number; // the batch fees' burn share actually DELIVERED (BurnShareDelivered, measured)
  // The direct-swap fee wrapper (WRAPPER_WATCH): native-sell swaps only — the
  // fee is charged in the SELL asset, so only ETH-denominated cuts can join
  // these ETH series honestly. Cuts are MEASURED off FeeCharged, never derived.
  wrapVolEth: number; // wrapper swap notional (spent, native sells)
  wrapFeeEth: number; // integratorCut + burnCut
  wrapBurnEth: number; // burnCut alone (fee − fee/8, the deployed floor math)
  burnedPrism: number;
  basketBurnUsd: number; // trade-volume-derived 25% burn share (the /charts approximation)
  // Basket FeesAccrued (the real on-chain fee split, USDC) — powers /spectrum's
  // "Fees earned" card. Per-chain totals + the split components.
  bFeeEthUsd: number;
  bFeeBaseUsd: number;
  bFeeHoodUsd: number;
  split: { holders: number; burn: number; creator: number; interfaces: number; league: number };
  bridgedEth: number; // Base revenue bridged toward the L1 buy-and-burn this hour
  traders: string[]; // unique within the hour (both chains, resolved from tx senders)
  baskets: Record<string, BasketHour>; // token addr (lower) → per-basket detail
}
const emptyHour = (): HourAgg => ({
  launches: 0,
  launchesEth: 0,
  launchesBase: 0,
  launchesHood: 0,
  auctionEth: 0,
  buys: 0,
  sells: 0,
  volumeUsd: 0,
  buyUsd: 0,
  sellUsd: 0,
  feesEth: 0,
  poolVolEth: 0,
  batchVolUsd: 0,
  batchFeeUsd: 0,
  batchBurnUsd: 0,
  wrapVolEth: 0,
  wrapFeeEth: 0,
  wrapBurnEth: 0,
  burnedPrism: 0,
  basketBurnUsd: 0,
  bFeeEthUsd: 0,
  bFeeBaseUsd: 0,
  bFeeHoodUsd: 0,
  split: { holders: 0, burn: 0, creator: 0, interfaces: 0, league: 0 },
  bridgedEth: 0,
  traders: [],
  baskets: {},
});

interface StoreState {
  hours: Map<number, HourAgg>; // key: floor(ms / HOUR_MS)
  ethLast: number; // last ETH block folded in
  baseLast: number;
  hoodLast: number; // last Base block folded in
  baseOldestMs: number | null; // Base coverage starts here
  nowMs: number; // ts of the newest ETH block seen
  lastRefresh: number;
  lastPersist: number;
}
let store: StoreState | null = null;
let refreshing: Promise<void> | null = null;
let hydrated = false;

// burned / supply — two eth_calls, cached so they're not re-paid per compute
let supplyCache: { at: number; totalBurned: number; supply: number } | null = null;

async function getLogsChunked(
  provider: JsonRpcProvider,
  params: { address: string | string[]; topics: (string | null | string[])[] },
  from: number,
  to: number,
  chunk = 400_000,
): Promise<Log[]> {
  const out: Log[] = [];
  for (let s = from; s <= to; s += chunk) {
    const e = Math.min(s + chunk - 1, to);
    // A dropped chunk would become a permanent zero-hole in the store (and get
    // persisted to the blob snapshot), so a failed window retries once and then
    // aborts the whole scan — the caller leaves its cursor untouched and the
    // same span is re-attempted on the next refresh.
    let part: Log[];
    try {
      part = await provider.getLogs({ ...params, fromBlock: s, toBlock: e });
    } catch {
      part = await provider.getLogs({ ...params, fromBlock: s, toBlock: e });
    }
    out.push(...part);
  }
  return out;
}

// Timestamp estimator for a scan span. Short spans assume the fixed block time;
// long back-scans anchor on the REAL timestamp of the span's first block and
// interpolate to the head — mainnet actually averages ~12.05s/block (missed
// slots), so a flat 12s drifts hours over a month and days over a year.
async function tsEstimator(
  provider: JsonRpcProvider,
  from: number,
  to: number,
  latestNum: number,
  latestTs: number,
  spb: number,
  minSpanToAnchor: number,
): Promise<(bn: number) => number> {
  const fallback = (bn: number) => (latestTs - (latestNum - bn) * spb) * 1000;
  if (to - from < minSpanToAnchor) return fallback;
  try {
    const b = await provider.getBlock(from);
    if (b?.timestamp && latestNum > from) {
      const secPerBlock = (latestTs - b.timestamp) / (latestNum - from);
      return (bn: number) => (b.timestamp + (bn - from) * secPerBlock) * 1000;
    }
  } catch {
    /* anchor is best-effort */
  }
  return fallback;
}

// Minted/SellViaSwap index a `user` arg, but on-chain it is the V4 PoolManager
// (the hook's msg.sender) on EVERY trade — verified against live logs — so it
// is useless for "unique traders". The real wallet is the transaction sender;
// resolve tx.from per unique tx (cached — trades are sparse, a few per day).
const traderByTx = new Map<string, string>();
const TRADER_CACHE_MAX = 8_000;
async function resolveTraders(provider: JsonRpcProvider, hashes: string[]): Promise<Map<string, string>> {
  // prune BEFORE resolving so a big cold batch can't evict its own entries
  if (traderByTx.size > TRADER_CACHE_MAX) {
    for (const k of traderByTx.keys()) {
      if (traderByTx.size <= TRADER_CACHE_MAX / 2) break;
      traderByTx.delete(k);
    }
  }
  const misses = [...new Set(hashes)].filter((h) => !traderByTx.has(h));
  const CONC = 8;
  for (let i = 0; i < misses.length; i += CONC) {
    await Promise.all(
      misses.slice(i, i + CONC).map(async (h) => {
        try {
          const tx = await provider.getTransaction(h);
          if (tx?.from) traderByTx.set(h, tx.from.toLowerCase());
        } catch {
          /* unattributed this pass */
        }
      }),
    );
  }
  return traderByTx;
}

function hourAgg(s: StoreState, ms: number): HourAgg {
  const k = Math.floor(ms / HOUR_MS);
  let h = s.hours.get(k);
  if (!h) {
    h = emptyHour();
    s.hours.set(k, h);
  }
  return h;
}

// ── Blob persistence (best-effort; silently absent in local dev) ─────────────

type BlobStore = { get(key: string, opts: { type: "json" }): Promise<unknown>; setJSON(key: string, value: unknown): Promise<void> };
async function blobStore(): Promise<BlobStore | null> {
  try {
    const { getStore } = await import("@netlify/blobs");
    return getStore({ name: "prismbeat-charts", consistency: "eventual" }) as unknown as BlobStore;
  } catch {
    return null;
  }
}

interface Snapshot {
  // v6: the 2026-07-30 Spectrum launch set. The hourly aggregates and the per-chain
  // cursors below are all derived from the FACTORIES, so a factory rotation makes a
  // stored snapshot describe contracts the site no longer reads — old baskets' fees
  // and launches would keep being served as the new deployment's. Bumping forces a
  // clean rebuild from the new deploy floors. Bump this on every redeploy, not just
  // when HourAgg's shape changes.
  // v11: HourAgg.split gained `league` — the 5-field FeesAccrued's real 5th field,
  // previously folded into `interfaces`. Stored aggregates carry the mislabel, so
  // history must rebuild.
  // v12: HourAgg gained `poolVolEth` (measured PRISM-pool swap notional — the
  // money map's "volume next to fees", the designer 2026-08-15). Old snapshots have no
  // pool volume for any hour, so history must rebuild (the pool is weeks old;
  // the rebuild recovers its full life).
  // v13: HourAgg gained `batchVolUsd` (portfolio batch funding off the batcher
  // watch, same 2026-08-15 ruling) — rebuild so batches already on chain count.
  // v14 lives in git history (bridgedEth, the collector watch).
  // v15: basketBurnUsd re-derives at the ruled 25% burn share (was 10%, the designer
  // 2026-08-16) — mixed-rate history is incoherent, so rebuild it all one way.
  // v16: HourAgg gained the wrapper series (wrapVolEth/wrapFeeEth/wrapBurnEth —
  // the designer 2026-08-16: "track wrapper swaps in portfolio / moneymap"); rebuild
  // so the first mainnet wrapper swap counts.
  // v17: batchFeeUsd + batchBurnUsd join (the designer's same-day ruling: wrapped
  // swaps and batches are TWO CAPTURE ROUTES OF ONE SYSTEM — the portfolio
  // card carries both), so batch fees rebuild from the floors.
  v: 17;
  ethLast: number;
  baseLast: number;
  hoodLast: number;
  baseOldestMs: number | null;
  nowMs: number;
  hours: [number, HourAgg][];
}

async function hydrateFromBlob(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const blobs = await blobStore();
    if (!blobs) return;
    const snap = (await blobs.get("store", { type: "json" })) as Snapshot | null;
    if (!snap || snap.v !== 17 || !Array.isArray(snap.hours)) return;
    store = {
      hours: new Map(snap.hours),
      ethLast: snap.ethLast,
      baseLast: snap.baseLast,
      hoodLast: snap.hoodLast ?? -1,
      baseOldestMs: snap.baseOldestMs,
      nowMs: snap.nowMs,
      lastRefresh: 0, // force an immediate incremental catch-up
      lastPersist: Date.now(),
    };
  } catch {
    /* corrupt / unavailable snapshot → cold scan */
  }
}

async function persistToBlob(s: StoreState): Promise<void> {
  if (Date.now() - s.lastPersist < PERSIST_EVERY_MS) return;
  s.lastPersist = Date.now();
  try {
    const blobs = await blobStore();
    if (!blobs) return;
    const snap: Snapshot = {
      v: 17,
      ethLast: s.ethLast,
      baseLast: s.baseLast,
    hoodLast: s.hoodLast,
      baseOldestMs: s.baseOldestMs,
      nowMs: s.nowMs,
      hours: [...s.hours.entries()],
    };
    await blobs.setJSON("store", snap);
  } catch {
    /* persistence is best-effort */
  }
}

// ── Ingestion ────────────────────────────────────────────────────────────────

// Fold trade logs (either lineage, either chain) into the hourly aggregates —
// counts, per-side USD, per-basket detail, burn share, and unique traders
// (tx senders — the trader is never in the log topics on either lineage).
async function ingestTrades(s: StoreState, provider: JsonRpcProvider, tradeLogs: Log[], tsOf: (bn: number) => number) {
  if (!tradeLogs.length) return;
  const rates: Record<string, number> = {};
  const [traders] = await Promise.all([
    resolveTraders(provider, tradeLogs.map((l) => l.transactionHash)),
    Promise.all(
      [...new Set(tradeLogs.map((l) => l.address.toLowerCase()))].map(async (a) => {
        rates[a] = await basketFeeRate(provider, a);
      }),
    ),
  ]);
  for (const l of tradeLogs) {
    try {
      // v1 Minted/SellViaSwap and V2 Minted/Redeemed carry the quote-stable leg
      // at the same data position (d[0] on buys, d[1] on sells), 6dp both.
      const isBuy = l.topics[0] === TOPIC.minted || l.topics[0] === TOPIC_V2.minted;
      const d = abi.decode(["uint256", "uint256"], l.data);
      const usd = num((isBuy ? d[0] : d[1]) as bigint, USDC_DECIMALS);
      const token = l.address.toLowerCase();
      const feeUsd = usd * (rates[token] ?? INDEX_POOL_FEE_RATE);
      const h = hourAgg(s, tsOf(l.blockNumber));
      const b = (h.baskets[token] ??= { buys: 0, sells: 0, buyUsd: 0, sellUsd: 0, feeUsd: 0 });
      if (isBuy) {
        h.buys += 1;
        h.buyUsd += usd;
        b.buys += 1;
        b.buyUsd += usd;
      } else {
        h.sells += 1;
        h.sellUsd += usd;
        b.sells += 1;
        b.sellUsd += usd;
      }
      h.volumeUsd += usd;
      h.basketBurnUsd += feeUsd * BASKET_BURN_SHARE;
      b.feeUsd += feeUsd;
      const trader = traders.get(l.transactionHash);
      if (trader && !h.traders.includes(trader)) h.traders.push(trader);
    } catch {
      /* skip malformed */
    }
  }
}

// Fold FeesAccrued logs (the on-chain basket-fee split, USDC 6dp) into the
// hour's split + per-chain basket-fee total — the real fee figure behind the
// /spectrum "Fees earned" card (distinct from the trade-volume approximation in
// basketBurnUsd, which the /charts payload keeps).
function ingestFeesAccrued(s: StoreState, logs: Log[], chain: "ethereum" | "base" | "robinhood", tsOf: (bn: number) => number) {
  for (const l of logs) {
    try {
      // Two shapes share the name. Base + Ethereum baskets emit 4 fields
      // (toHolders, toBurn, toCreator, toInterfaceAndLauncher); the Robinhood
      // lineage emits 5, where field 4 is STILL interface+launcher combined and
      // the fifth is the creator-league slice (LEAGUE_SHARE_BPS = 500, taken off
      // the top — lineages/robinhood SpectrumBasket.sol:130). The data length
      // says which shape this is. League is its own slice, never launcher money.
      const words = (l.data.length - 2) / 64;
      const d = abi.decode(new Array(words).fill("uint256"), l.data);
      const holders = num6(d[0] as bigint);
      const burn = num6(d[1] as bigint);
      const creator = num6(d[2] as bigint);
      const interfaces = num6(d[3] as bigint);
      const league = words >= 5 ? num6(d[4] as bigint) : 0;
      const h = hourAgg(s, tsOf(l.blockNumber));
      h.split.holders += holders;
      h.split.burn += burn;
      h.split.creator += creator;
      h.split.interfaces += interfaces;
      h.split.league += league;
      const total = holders + burn + creator + interfaces + league;
      if (chain === "ethereum") h.bFeeEthUsd += total;
      else if (chain === "robinhood") h.bFeeHoodUsd += total;
      else h.bFeeBaseUsd += total;
    } catch {
      /* skip malformed */
    }
  }
}

async function ingestEth(s: StoreState, eth: JsonRpcProvider, from: number, to: number, latestNum: number, latestTs: number) {
  if (from > to) return;
  const tsOf = await tsEstimator(eth, from, to, latestNum, latestTs, ETH_SPB, 50_000);
  const { all: ethTokens } = await ethIndexTokens();
  const [feeLogs, swapLogs, burnLogs, launchLogs, launchV2Logs, tradeLogs, feeAccLogs, batchLogs, wrapperLogs] = await Promise.all([
    getLogsChunked(eth, { address: PRISM, topics: [TOPIC.feesPoked] }, from, to),
    // pool swap notionals, MEASURED off the PoolManager's own Swap events —
    // deriving volume from fees would stack the ÷fee-tier guess on top of the
    // ×LEG_FACTOR one. Guarded: an unwired token derives the zero poolId.
    PRISM_POOL_ID !== NO_POOL_ID
      ? getLogsChunked(eth, { address: POOL_MANAGER, topics: [TOPIC.swap, PRISM_POOL_ID] }, from, to)
      : Promise.resolve([] as Log[]),
    getLogsChunked(eth, { address: PRISM, topics: [TOPIC.transfer, null, TOPIC_DEAD] }, from, to),
    getLogsChunked(eth, { address: SPECTRUM_ETH, topics: [TOPIC.launched] }, from, to),
    SPECTRUM_V2.ethFactory
      ? getLogsChunked(
          eth,
          // Every generation that receives real launches: the current factory,
          // the legacy one, AND the gen-3 production factory (fresh registry
          // from the 2026-08-16 ceremony — wired before its first launch).
          { address: [SPECTRUM_V2.ethFactory, ...SPECTRUM_LEGACY_FACTORIES.ethereum.map((f) => f.address), ...SPECTRUM_V3_FACTORIES.ethereum.map((f) => f.address)], topics: [TOPIC_V2.launched] },
          from,
          to,
        )
      : Promise.resolve([] as Log[]),
    ethTokens.length
      ? getLogsChunked(eth, { address: ethTokens, topics: [[TOPIC_V2.minted, TOPIC_V2.redeemed]] }, from, to)
      : Promise.resolve([] as Log[]),
    ethTokens.length
      ? getLogsChunked(eth, { address: ethTokens, topics: [[TOPIC_V2.feesAccrued, TOPIC_V2.feesAccruedV3]] }, from, to)
      : Promise.resolve([] as Log[]),
    PORTFOLIO_BATCHER_WATCH.ethereum.length
      ? getLogsChunked(eth, { address: PORTFOLIO_BATCHER_WATCH.ethereum, topics: [[TOPIC_BATCH.executed5, TOPIC_BATCH.executed7, TOPIC_BATCH.burnShareDelivered]] }, from, to)
      : Promise.resolve([] as Log[]),
    getLogsChunked(eth, { address: WRAPPER_WATCH.ethereum.addresses, topics: [[TOPIC_WRAPPER.directSwap, TOPIC_WRAPPER.feeCharged, TOPIC_WRAPPER.feeChargedWhole]] }, from, to),
  ]);
  ingestBatches(s, batchLogs, tsOf);
  ingestWrapper(s, wrapperLogs, tsOf);
  for (const l of swapLogs) {
    try {
      // same decode as live.ts's feed: amount0 is the ETH side; |amount0| = notional
      let a0 = abi.decode(["int128", "int128", "uint160", "uint128", "int24", "uint24"], l.data)[0] as bigint;
      if (a0 < 0n) a0 = -a0;
      hourAgg(s, tsOf(l.blockNumber)).poolVolEth += num(a0);
    } catch {
      /* skip malformed */
    }
  }
  for (const l of feeLogs) {
    try {
      hourAgg(s, tsOf(l.blockNumber)).feesEth += num(abi.decode(["uint256", "uint256"], l.data)[0] as bigint);
    } catch {
      /* skip malformed */
    }
  }
  for (const l of burnLogs) {
    try {
      const v = abi.decode(["uint256"], l.data)[0] as bigint;
      if (v > 0n) hourAgg(s, tsOf(l.blockNumber)).burnedPrism += num(v);
    } catch {
      /* skip malformed */
    }
  }
  // v1 (SPECTRUM_ETH) launches — count only (no ethPaid on the old event we use)
  for (const l of launchLogs) {
    const h = hourAgg(s, tsOf(l.blockNumber));
    h.launches += 1;
    h.launchesEth += 1;
  }
  // v2 launches — count + auction ETH (ethPaid is data word 3)
  for (const l of launchV2Logs) {
    const h = hourAgg(s, tsOf(l.blockNumber));
    h.launches += 1;
    h.launchesEth += 1;
    try {
      h.auctionEth += num(abi.decode(["string", "string", "uint160", "uint256", "uint16"], l.data)[3] as bigint);
    } catch {
      /* skip malformed */
    }
  }
  ingestFeesAccrued(s, feeAccLogs, "ethereum", tsOf);
  await ingestTrades(s, eth, tradeLogs, tsOf);
}

// Portfolio batch volume off the batcher watch (the designer's 2026-08-15 ruling):
// the funding notional per BatchExecuted, 6dp settlement coin read as USD.
function ingestBatches(s: StoreState, logs: Log[], tsOf: (bn: number) => number) {
  for (const l of logs) {
    try {
      if (l.topics[0] === TOPIC_BATCH.executed5) {
        const d = abi.decode(["uint256", "uint256", "uint256"], l.data);
        const h = hourAgg(s, tsOf(l.blockNumber));
        h.batchVolUsd += num6(d[0] as bigint);
        h.batchFeeUsd += num6(d[1] as bigint);
      } else if (l.topics[0] === TOPIC_BATCH.executed7)
        hourAgg(s, tsOf(l.blockNumber)).batchVolUsd += num6(abi.decode(["address", "uint256", "uint256", "uint256", "uint16", "uint16"], l.data)[1] as bigint);
      else if (l.topics[0] === TOPIC_BATCH.burnShareDelivered)
        // the burn share the batcher actually DELIVERED (fundingSpent, 6dp) —
        // measured; BurnDiverted deliberately does not count
        hourAgg(s, tsOf(l.blockNumber)).batchBurnUsd += num6(abi.decode(["uint256", "uint256"], l.data)[0] as bigint);
    } catch {
      /* skip malformed */
    }
  }
}

// Wrapper swaps off the wrapper watch (the designer 2026-08-16). Two passes because
// FeeCharged does not name the asset — the paired DirectSwap in the same tx
// does (topics[2] = sellToken; 0x0 = native).
function ingestWrapper(s: StoreState, logs: Log[], tsOf: (bn: number) => number) {
  const nativeTx = new Set<string>();
  for (const l of logs) {
    if (l.topics[0] !== TOPIC_WRAPPER.directSwap || l.topics[2] !== `0x${"0".repeat(64)}`) continue;
    nativeTx.add(l.transactionHash);
    try {
      hourAgg(s, tsOf(l.blockNumber)).wrapVolEth += num(abi.decode(["uint256", "uint256", "uint256"], l.data)[0] as bigint);
    } catch {
      /* skip malformed */
    }
  }
  for (const l of logs) {
    if (!nativeTx.has(l.transactionHash)) continue;
    try {
      const h = hourAgg(s, tsOf(l.blockNumber));
      if (l.topics[0] === TOPIC_WRAPPER.feeCharged) {
        // old generation: (integratorCut, burnCut) — the 7:1 split
        const d = abi.decode(["uint256", "uint256"], l.data);
        h.wrapFeeEth += num(d[0] as bigint) + num(d[1] as bigint);
        h.wrapBurnEth += num(d[1] as bigint);
      } else if (l.topics[0] === TOPIC_WRAPPER.feeChargedWhole) {
        // gen-3: (burnCut) and burnCut == fee — the whole fee burns
        const cut = num(abi.decode(["uint256"], l.data)[0] as bigint);
        h.wrapFeeEth += cut;
        h.wrapBurnEth += cut;
      }
    } catch {
      /* skip malformed */
    }
  }
}

async function ingestBase(s: StoreState, base: JsonRpcProvider, from: number, to: number, latestNum: number, latestTs: number) {
  if (from > to) return;
  const tsOf = await tsEstimator(base, from, to, latestNum, latestTs, BASE_SPB, 200_000);
  const { all: tokens } = await baseIndexTokens();
  const [launchLogs, launchV2Logs, tradeLogs, auctionBridgeLogs, auctionBridgeV2Logs, indexBridgeLogs, feeAccLogs, batchLogs, collectorFlushLogs, wrapperLogs] = await Promise.all([
    getLogsChunked(base, { address: SPECTRUM_BASE, topics: [TOPIC.launched] }, from, to),
    SPECTRUM_V2.baseFactory
      ? getLogsChunked(base, { address: [SPECTRUM_V2.baseFactory, ...SPECTRUM_V3_FACTORIES.base.map((f) => f.address)], topics: [TOPIC_V2.launched] }, from, to)
      : Promise.resolve([] as Log[]),
    tokens.length
      ? getLogsChunked(base, { address: tokens, topics: [[TOPIC.minted, TOPIC.sellViaSwap, TOPIC_V2.minted, TOPIC_V2.redeemed]] }, from, to, 100_000)
      : Promise.resolve([] as Log[]),
    getLogsChunked(base, { address: SPECTRUM_BASE, topics: [TOPIC.auctionBridgedToBurn] }, from, to),
    SPECTRUM_V2.baseFactory
      ? getLogsChunked(base, { address: SPECTRUM_V2.baseFactory, topics: [TOPIC_V2.auctionBridgedToBurnV2] }, from, to)
      : Promise.resolve([] as Log[]),
    tokens.length
      ? getLogsChunked(base, { address: tokens, topics: [TOPIC.prismBurnBridged] }, from, to)
      : Promise.resolve([] as Log[]),
    tokens.length
      ? getLogsChunked(base, { address: tokens, topics: [[TOPIC_V2.feesAccrued, TOPIC_V2.feesAccruedV3]] }, from, to, 100_000)
      : Promise.resolve([] as Log[]),
    PORTFOLIO_BATCHER_WATCH.base.length
      ? getLogsChunked(base, { address: PORTFOLIO_BATCHER_WATCH.base, topics: [[TOPIC_BATCH.executed5, TOPIC_BATCH.executed7, TOPIC_BATCH.burnShareDelivered]] }, from, to, 100_000)
      : Promise.resolve([] as Log[]),
    // collector flushes: the burn cut leaving Base on its ~7d bridge
    getLogsChunked(
      base,
      { address: PORTFOLIO_COLLECTOR_WATCH.filter((c) => c.chain === "base").map((c) => c.address), topics: [TOPIC_COLLECTOR.burnBridgedToL1] },
      from,
      to,
      100_000,
    ),
    getLogsChunked(base, { address: WRAPPER_WATCH.base.addresses, topics: [[TOPIC_WRAPPER.directSwap, TOPIC_WRAPPER.feeCharged, TOPIC_WRAPPER.feeChargedWhole]] }, from, to, 100_000),
  ]);
  ingestBatches(s, batchLogs, tsOf);
  ingestWrapper(s, wrapperLogs, tsOf);
  for (const l of collectorFlushLogs) {
    try {
      hourAgg(s, tsOf(l.blockNumber)).bridgedEth += num(abi.decode(["uint256"], l.data)[0] as bigint);
    } catch {
      /* skip malformed */
    }
  }

  for (const l of launchLogs) {
    const h = hourAgg(s, tsOf(l.blockNumber));
    h.launches += 1;
    h.launchesBase += 1;
  }
  for (const l of launchV2Logs) {
    const h = hourAgg(s, tsOf(l.blockNumber));
    h.launches += 1;
    h.launchesBase += 1;
    try {
      h.auctionEth += num(abi.decode(["string", "string", "uint160", "uint256", "uint16"], l.data)[3] as bigint);
    } catch {
      /* skip malformed */
    }
  }
  ingestFeesAccrued(s, feeAccLogs, "base", tsOf);
  await ingestTrades(s, base, tradeLogs, tsOf);
  // Bridge-to-burn events: value leaving Base toward the L1 buy-and-burn.
  // v1 AuctionBridgedToBurn carries the ETH in data[0] (of two words); the V2
  // event's ETH is its single data word; PrismBurnBridged in data[1].
  for (const l of auctionBridgeLogs) {
    try {
      hourAgg(s, tsOf(l.blockNumber)).bridgedEth += num(abi.decode(["uint256", "uint256"], l.data)[0] as bigint);
    } catch {
      /* skip malformed */
    }
  }
  for (const l of auctionBridgeV2Logs) {
    try {
      hourAgg(s, tsOf(l.blockNumber)).bridgedEth += num(abi.decode(["uint256"], l.data)[0] as bigint);
    } catch {
      /* skip malformed */
    }
  }
  for (const l of indexBridgeLogs) {
    try {
      hourAgg(s, tsOf(l.blockNumber)).bridgedEth += num(abi.decode(["uint256", "uint256"], l.data)[1] as bigint);
    } catch {
      /* skip malformed */
    }
  }
}

// Robinhood Chain: V2 launches + basket trades + FeesAccrued. The factory
// deployed at block 6,950,977 (2026-07-11), so scans floor there — the chain's
// 0.1s blocks make "lookback by blocks" meaningless for deep history.
async function ingestHood(s: StoreState, hood: JsonRpcProvider, from: number, to: number, latestNum: number, latestTs: number) {
  if (from > to) return;
  const tsOf = await tsEstimator(hood, from, to, latestNum, latestTs, HOOD_SPB, 400_000);
  const { all: tokens } = await hoodIndexTokens();
  const hoodCollectors = PORTFOLIO_COLLECTOR_WATCH.filter((c) => c.chain === "robinhood").map((c) => c.address);
  const [launchLogs, tradeLogs, feeAccLogs, batchLogs, collectorFlushLogs, wrapperLogs] = await Promise.all([
    SPECTRUM_V2.hoodFactory
      ? getLogsChunked(hood, { address: [SPECTRUM_V2.hoodFactory, ...SPECTRUM_V3_FACTORIES.robinhood.map((f) => f.address)], topics: [TOPIC_V2.launched] }, from, to, 400_000)
      : Promise.resolve([] as Log[]),
    tokens.length
      ? getLogsChunked(hood, { address: tokens, topics: [[TOPIC_V2.minted, TOPIC_V2.redeemed]] }, from, to, 400_000)
      : Promise.resolve([] as Log[]),
    tokens.length
      ? getLogsChunked(hood, { address: tokens, topics: [[TOPIC_V2.feesAccrued, TOPIC_V2.feesAccruedV3]] }, from, to, 400_000)
      : Promise.resolve([] as Log[]),
    PORTFOLIO_BATCHER_WATCH.robinhood.length
      ? getLogsChunked(hood, { address: PORTFOLIO_BATCHER_WATCH.robinhood, topics: [[TOPIC_BATCH.executed5, TOPIC_BATCH.executed7, TOPIC_BATCH.burnShareDelivered]] }, from, to, 400_000)
      : Promise.resolve([] as Log[]),
    // collector flushes: the burn cut leaving the L2 on its ~7d bridge
    hoodCollectors.length
      ? getLogsChunked(hood, { address: hoodCollectors, topics: [TOPIC_COLLECTOR.burnBridgedToL1] }, from, to, 400_000)
      : Promise.resolve([] as Log[]),
    getLogsChunked(hood, { address: WRAPPER_WATCH.robinhood.addresses, topics: [[TOPIC_WRAPPER.directSwap, TOPIC_WRAPPER.feeCharged, TOPIC_WRAPPER.feeChargedWhole]] }, from, to, 400_000),
  ]);
  ingestBatches(s, batchLogs, tsOf);
  ingestWrapper(s, wrapperLogs, tsOf);
  for (const l of collectorFlushLogs) {
    try {
      hourAgg(s, tsOf(l.blockNumber)).bridgedEth += num(abi.decode(["uint256"], l.data)[0] as bigint);
    } catch {
      /* skip malformed */
    }
  }
  for (const l of launchLogs) {
    const h = hourAgg(s, tsOf(l.blockNumber));
    h.launches += 1;
    h.launchesHood += 1;
    try {
      h.auctionEth += num(abi.decode(["string", "string", "uint160", "uint256", "uint16"], l.data)[3] as bigint);
    } catch {
      /* skip malformed */
    }
  }
  ingestFeesAccrued(s, feeAccLogs, "robinhood", tsOf);
  await ingestTrades(s, hood, tradeLogs, tsOf);
}

async function refresh(eth: JsonRpcProvider, base: JsonRpcProvider | null): Promise<void> {
  await hydrateFromBlob();
  if (store && Date.now() - store.lastRefresh < REFRESH_MIN_MS) return;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const ethInfo = await getLatestBlock(eth);
    const coldStart = !store;
    if (!store) {
      // true cold start: one back-scan covering the deepest range
      store = {
        hours: new Map(),
        ethLast: Math.max(PRISM_POOL_FROM_BLOCK, ethInfo.number - Math.ceil(ETH_HORIZON_SEC / ETH_SPB)) - 1,
        baseLast: -1,
        hoodLast: -1,
        baseOldestMs: null,
        nowMs: ethInfo.ts * 1000,
        lastRefresh: 0,
        lastPersist: 0,
      };
    }
    const s = store;
    try {
      await ingestEth(s, eth, s.ethLast + 1, ethInfo.number, ethInfo.number, ethInfo.ts);
      s.ethLast = ethInfo.number;
      s.nowMs = ethInfo.ts * 1000;
    } catch (err) {
      // scan aborted (getLogsChunked retries once, then throws): cursor stays
      // put so the span re-scans next refresh. A cold store with no history yet
      // must not serve all-zero series as if they were real → surface the error.
      if (coldStart) {
        store = null;
        throw err;
      }
    }

    if (base) {
      try {
        const bInfo = await getLatestBlock(base);
        const from = s.baseLast >= 0 ? s.baseLast + 1 : Math.max(0, bInfo.number - BASE_MAX_LOOKBACK);
        if (s.baseLast < 0) s.baseOldestMs = (bInfo.ts - (bInfo.number - from) * BASE_SPB) * 1000;
        await ingestBase(s, base, from, bInfo.number, bInfo.number, bInfo.ts);
        s.baseLast = bInfo.number;
      } catch {
        /* base optional — ETH series still advance */
      }
    }

    const hood = getHoodProvider();
    if (hood) {
      try {
        const hInfo = await getLatestBlock(hood);
        const from = s.hoodLast >= 0 ? s.hoodLast + 1 : SPECTRUM_V2_FROM_BLOCK.robinhood;
        await ingestHood(s, hood, from, hInfo.number, hInfo.number, hInfo.ts);
        s.hoodLast = hInfo.number;
      } catch {
        /* hood optional — other chains still advance */
      }
    }

    // drop hours past the horizon so memory stays bounded
    const cutoff = Math.floor((s.nowMs - PRUNE_AFTER_MS) / HOUR_MS);
    for (const k of s.hours.keys()) if (k < cutoff) s.hours.delete(k);

    s.lastRefresh = Date.now();
    await persistToBlob(s);
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

// ── Rollup: hourly store → one range's payload ───────────────────────────────

async function getSupply(eth: JsonRpcProvider): Promise<{ totalBurned: number; supply: number }> {
  if (supplyCache && Date.now() - supplyCache.at < 300_000) return supplyCache;
  const prism = new Contract(PRISM, ERC20_ABI, eth);
  const [deadRaw, supplyRaw] = await Promise.all([
    prism.balanceOf(DEAD).catch(() => 0n) as Promise<bigint>,
    prism.totalSupply().catch(() => 0n) as Promise<bigint>,
  ]);
  const totalBurned = num(deadRaw);
  supplyCache = { at: Date.now(), totalBurned, supply: Math.max(0, num(supplyRaw) - totalBurned) };
  return supplyCache;
}

export async function fetchLiveCharts(
  eth: JsonRpcProvider,
  base: JsonRpcProvider | null,
  range: RangeKey,
): Promise<ChartsPayload> {
  await refresh(eth, base);
  const s = store!;
  const [ethUsd, { totalBurned, supply }, symbols] = await Promise.all([
    getEthUsd(eth),
    getSupply(eth),
    listIndexes()
      .then((idx) => Object.fromEntries(idx.map((i) => [i.address.toLowerCase(), i.symbol])) as Record<string, string>)
      .catch(() => ({}) as Record<string, string>),
  ]);

  const cfg = RANGES[range];
  const bucketMs = cfg.bucketSec * 1000; // always a whole number of hours
  // align the window end UP to the next hour so hour-buckets nest exactly;
  // the final bucket is the in-progress one
  const endMs = Math.ceil(s.nowMs / HOUR_MS) * HOUR_MS;
  const startMs = endMs - cfg.buckets * bucketMs;
  const prevStartMs = startMs - cfg.buckets * bucketMs;

  const buckets = Array.from({ length: cfg.buckets }, (_, i) => startMs + i * bucketMs);
  const zeros = () => new Array<number>(cfg.buckets).fill(0);
  const launches = zeros();
  const buys = zeros();
  const sells = zeros();
  const volumeUsd = zeros();
  const buyVolumeUsd = zeros();
  const sellVolumeUsd = zeros();
  const feesUsd = zeros();
  const poolVolumeUsd = zeros();
  const wrapperVolumeUsd = zeros();
  const batchFeesUsd = zeros();
  const batchBurnUsd = zeros();
  const wrapperFeesUsd = zeros();
  const wrapperBurnUsd = zeros();
  const burnedPrism = zeros();
  const basketBurnUsd = zeros();
  const bucketTraders = Array.from({ length: cfg.buckets }, () => new Set<string>());
  const windowTraders = new Set<string>();
  const basketVolume = new Map<string, number>();

  const withPrev = range !== "1y"; // the store holds ~1y — no 2y window exists
  const prev: ChartsPrevTotals | null = withPrev
    ? { launches: 0, buys: 0, sells: 0, volumeUsd: 0, buyVolumeUsd: 0, sellVolumeUsd: 0, feesUsd: 0, burnedPrism: 0, traders: 0, basketBurnUsd: 0 }
    : null;
  const prevTraders = new Set<string>();

  // Bridge pot: NOW-anchored trailing ~7d (the withdrawal period), independent
  // of the selected range. The oldest pending bridge unlocks ~7d after it fired;
  // hour-end anchoring keeps the countdown from hitting zero early.
  const bridgeSinceK = Math.floor((s.nowMs - 7 * 86_400_000) / HOUR_MS);
  let bridgePendingEth = 0;
  let bridgeOldestK: number | null = null;

  for (const [k, h] of store!.hours) {
    const ms = k * HOUR_MS;
    if (k >= bridgeSinceK && h.bridgedEth > 0) {
      bridgePendingEth += h.bridgedEth;
      if (bridgeOldestK == null || k < bridgeOldestK) bridgeOldestK = k;
    }
    if (ms >= startMs && ms < endMs) {
      const i = Math.min(cfg.buckets - 1, Math.floor((ms - startMs) / bucketMs));
      launches[i] += h.launches;
      buys[i] += h.buys;
      sells[i] += h.sells;
      volumeUsd[i] += h.volumeUsd;
      buyVolumeUsd[i] += h.buyUsd;
      sellVolumeUsd[i] += h.sellUsd;
      feesUsd[i] += h.feesEth * LEG_FACTOR * ethUsd;
      poolVolumeUsd[i] += (h.poolVolEth ?? 0) * ethUsd;
      wrapperVolumeUsd[i] += (h.wrapVolEth ?? 0) * ethUsd;
      batchFeesUsd[i] += h.batchFeeUsd ?? 0;
      batchBurnUsd[i] += h.batchBurnUsd ?? 0;
      wrapperFeesUsd[i] += (h.wrapFeeEth ?? 0) * ethUsd;
      wrapperBurnUsd[i] += (h.wrapBurnEth ?? 0) * ethUsd;
      burnedPrism[i] += h.burnedPrism;
      basketBurnUsd[i] += h.basketBurnUsd;
      for (const t of h.traders) {
        bucketTraders[i].add(t);
        windowTraders.add(t);
      }
      for (const [token, b] of Object.entries(h.baskets))
        basketVolume.set(token, (basketVolume.get(token) ?? 0) + b.buyUsd + b.sellUsd);
    } else if (prev && ms >= prevStartMs && ms < startMs) {
      prev.launches += h.launches;
      prev.buys += h.buys;
      prev.sells += h.sells;
      prev.volumeUsd += h.volumeUsd;
      prev.buyVolumeUsd += h.buyUsd;
      prev.sellVolumeUsd += h.sellUsd;
      prev.feesUsd += h.feesEth * LEG_FACTOR * ethUsd;
      prev.burnedPrism += h.burnedPrism;
      prev.basketBurnUsd += h.basketBurnUsd;
      for (const t of h.traders) prevTraders.add(t);
    }
  }
  if (prev) prev.traders = prevTraders.size;

  const topBaskets = [...basketVolume.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_BASKETS)
    .map(([addr, vol]) => ({ address: addr, symbol: symbols[addr] ?? `${addr.slice(0, 6)}…${addr.slice(-4)}`, volumeUsd: vol }));

  const windowBurn = burnedPrism.reduce((a, b) => a + b, 0);
  // ETH-side series start at pool inception (estimated ts) — the run-rate
  // denominator for windows that reach further back than the pool's life.
  const ethInceptionMs = s.nowMs - (s.ethLast - PRISM_POOL_FROM_BLOCK) * ETH_SPB * 1000;

  return {
    mode: "live",
    range,
    generatedAt: Date.now(),
    bucketMs,
    buckets,
    launches,
    buys,
    sells,
    volumeUsd,
    buyVolumeUsd,
    sellVolumeUsd,
    feesUsd,
    poolVolumeUsd,
    wrapperVolumeUsd,
    batchFeesUsd,
    batchBurnUsd,
    wrapperFeesUsd,
    wrapperBurnUsd,
    burnedPrism,
    traders: bucketTraders.map((t) => t.size),
    tradersTotal: windowTraders.size,
    basketBurnUsd,
    burnedStartTotal: Math.max(0, totalBurned - windowBurn),
    cap: PRISM_CAP,
    supply,
    baseCoverageFromMs: s.baseOldestMs != null && s.baseOldestMs > startMs ? s.baseOldestMs : null,
    ethCoverageFromMs: ethInceptionMs > startMs ? ethInceptionMs : null,
    topBaskets,
    bridge: {
      pendingEth: bridgePendingEth,
      nextBurnTs: bridgeOldestK != null ? (bridgeOldestK + 1) * HOUR_MS + 7 * 86_400_000 : null,
    },
    ethUsd,
    prev,
  };
}

// ── Per-basket drill-down: one token's slice of the same hourly store ─────────

export async function fetchBasketCharts(
  eth: JsonRpcProvider,
  base: JsonRpcProvider | null,
  range: RangeKey,
  address: string,
): Promise<BasketChartsPayload> {
  await refresh(eth, base);
  const s = store!;
  const addr = address.toLowerCase();
  const symbols = await listIndexes()
    .then((idx) => Object.fromEntries(idx.map((i) => [i.address.toLowerCase(), i.symbol])) as Record<string, string>)
    .catch(() => ({}) as Record<string, string>);

  const cfg = RANGES[range];
  const bucketMs = cfg.bucketSec * 1000;
  const endMs = Math.ceil(s.nowMs / HOUR_MS) * HOUR_MS;
  const startMs = endMs - cfg.buckets * bucketMs;
  const prevStartMs = startMs - cfg.buckets * bucketMs;

  const buckets = Array.from({ length: cfg.buckets }, (_, i) => startMs + i * bucketMs);
  const zeros = () => new Array<number>(cfg.buckets).fill(0);
  const buys = zeros();
  const sells = zeros();
  const buyVolumeUsd = zeros();
  const sellVolumeUsd = zeros();
  const feeUsd = zeros();
  const prev: BasketPrevTotals | null =
    range !== "1y" ? { buys: 0, sells: 0, buyVolumeUsd: 0, sellVolumeUsd: 0, feeUsd: 0 } : null;

  for (const [k, h] of s.hours) {
    const b = h.baskets[addr];
    if (!b) continue;
    const ms = k * HOUR_MS;
    if (ms >= startMs && ms < endMs) {
      const i = Math.min(cfg.buckets - 1, Math.floor((ms - startMs) / bucketMs));
      buys[i] += b.buys;
      sells[i] += b.sells;
      buyVolumeUsd[i] += b.buyUsd;
      sellVolumeUsd[i] += b.sellUsd;
      feeUsd[i] += b.feeUsd;
    } else if (prev && ms >= prevStartMs && ms < startMs) {
      prev.buys += b.buys;
      prev.sells += b.sells;
      prev.buyVolumeUsd += b.buyUsd;
      prev.sellVolumeUsd += b.sellUsd;
      prev.feeUsd += b.feeUsd;
    }
  }

  return {
    mode: "live",
    range,
    generatedAt: Date.now(),
    bucketMs,
    buckets,
    address: addr,
    symbol: symbols[addr] ?? `${addr.slice(0, 6)}…${addr.slice(-4)}`,
    buys,
    sells,
    buyVolumeUsd,
    sellVolumeUsd,
    feeUsd,
    baseCoverageFromMs: s.baseOldestMs != null && s.baseOldestMs > startMs ? s.baseOldestMs : null,
    prev,
  };
}

// ── /spectrum rollup + auction pipeline (over the SAME shared store) ───────────
// The /spectrum page used to run its own duplicate store (chain/../spectrum-live)
// that re-scanned the V2 factories + basket trades already scanned here. It now
// reads THIS store: one back-scan, two payloads.

// Auction pipeline (live position of the ETH on its way to the burn). Escrow =
// the factories' own ETH balances (mainnet holds until the permissionless
// flushAuctionProceeds(); Base bridges inline). Burner = the L1 PrismBurner's
// balance awaiting its flush(minOut) crank. Burned = PRISM the burner has ever
// sent to dEaD (one bounded scan, then cached).
let pipelineCache: { at: number; data: AuctionPipeline } | null = null;
const PIPELINE_TTL_MS = 300_000;
async function fetchAuctionPipeline(eth: JsonRpcProvider, base: JsonRpcProvider | null): Promise<AuctionPipeline> {
  if (pipelineCache && Date.now() - pipelineCache.at < PIPELINE_TTL_MS) return pipelineCache.data;
  const out: AuctionPipeline = { escrowedEth: 0, burnerEth: 0, burnedPrism: 0 };
  try {
    const [ethEscrow, burnerBal] = await Promise.all([
      SPECTRUM_V2.ethFactory ? eth.getBalance(SPECTRUM_V2.ethFactory).catch(() => 0n) : Promise.resolve(0n),
      eth.getBalance(L1_PRISM_BURNER).catch(() => 0n),
    ]);
    const baseEscrow = base && SPECTRUM_V2.baseFactory ? await base.getBalance(SPECTRUM_V2.baseFactory).catch(() => 0n) : 0n;
    out.escrowedEth = Number(formatUnits(ethEscrow + baseEscrow, 18));
    out.burnerEth = Number(formatUnits(burnerBal, 18));
    const latest = await eth.getBlockNumber();
    // ⚠ Fixed 2026-08-16: this used to filter Transfer(from = burner → dEaD),
    // which has NEVER matched — the burner buys through the v4 pool, so its
    // dEaD transfer is emitted with the POOLMANAGER as sender (the same trap
    // attributeBurnSource documents). The figure read 0 from the day it was
    // written. The burner's own Burned(caller, ethIn, prismBurned) event IS
    // the measurement, so read that.
    const logs = await getLogsChunked(
      eth,
      { address: L1_PRISM_BURNER, topics: [id("Burned(address,uint256,uint256)")] },
      PRISM_POOL_FROM_BLOCK,
      latest,
    );
    for (const l of logs) {
      try {
        out.burnedPrism += num(abi.decode(["uint256", "uint256"], l.data)[1] as bigint);
      } catch {
        /* skip malformed */
      }
    }
    pipelineCache = { at: Date.now(), data: out };
  } catch {
    /* best-effort — zeros render as "nothing pending" */
  }
  return out;
}


// Σ pendingPrismBurn() across every discovered basket, all chains — burn share
// ACCRUED but not yet bridged to the L1 burner. From the 2026-08-01 audit: the
// burn tally was exact to the wei, but $47.8 sat queued in the hood baskets with
// nothing cranking the permissionless, bounty-paying flushPrismBurn. Shown so
// queued burns stop reading as missing burns. USDC is 6dp ≈ $1.
async function fetchQueuedBurnUsd(eth: JsonRpcProvider, base: JsonRpcProvider | null): Promise<number> {
  const SEL = id("pendingPrismBurn()").slice(0, 10);
  try {
    const idx = await listIndexes();
    let total = 0n;
    for (const i of idx) {
      const provider = i.chain === "ethereum" ? eth : i.chain === "base" ? base : getHoodProvider();
      if (!provider) continue;
      try {
        const r = await provider.call({ to: i.address, data: SEL });
        if (r && r !== "0x") total += BigInt(r);
      } catch {
        /* a basket without the getter contributes nothing */
      }
    }
    return Number(formatUnits(total, 6));
  } catch {
    return 0;
  }
}

export async function fetchLiveSpectrumCharts(
  eth: JsonRpcProvider,
  base: JsonRpcProvider | null,
  range: RangeKey,
): Promise<SpectrumChartsPayload> {
  await refresh(eth, base);
  const s = store!;
  const [ethUsd, meta, pipeline, queuedBurnUsd] = await Promise.all([
    getEthUsd(eth),
    listIndexes()
      .then((idx) => Object.fromEntries(idx.map((i) => [i.address.toLowerCase(), { symbol: i.symbol, chain: i.chain }])) as Record<string, { symbol: string; chain: "ethereum" | "base" | "robinhood" }>)
      .catch(() => ({}) as Record<string, { symbol: string; chain: "ethereum" | "base" | "robinhood" }>),
    fetchAuctionPipeline(eth, base),
    fetchQueuedBurnUsd(eth, base),
  ]);

  const cfg = RANGES[range];
  const bucketMs = cfg.bucketSec * 1000;
  const endMs = Math.ceil(s.nowMs / HOUR_MS) * HOUR_MS;
  const startMs = endMs - cfg.buckets * bucketMs;
  const prevStartMs = startMs - cfg.buckets * bucketMs;

  const payload = emptySpectrumCharts(range, s.nowMs);
  payload.mode = "live";
  payload.ethUsd = ethUsd;
  payload.buckets = Array.from({ length: cfg.buckets }, (_, i) => startMs + i * bucketMs);
  payload.auctionPipeline = pipeline;
  payload.queuedBurnUsd = queuedBurnUsd;

  const withPrev = range !== "1y";
  const prev: SpectrumPrevTotals | null = withPrev
    ? { launches: 0, buys: 0, sells: 0, volumeUsd: 0, buyVolumeUsd: 0, sellVolumeUsd: 0, feesUsd: 0, auctionEth: 0 }
    : null;

  const traders = new Set<string>();
  const basketVolume = new Map<string, number>(); // token addr (lower) → USD volume

  for (const [k, h] of s.hours) {
    const ms = k * HOUR_MS;
    if (ms >= startMs && ms < endMs) {
      const i = Math.min(cfg.buckets - 1, Math.floor((ms - startMs) / bucketMs));
      payload.launchesEth[i] += h.launchesEth;
      payload.launchesBase[i] += h.launchesBase;
      payload.launchesHood[i] += h.launchesHood ?? 0;
      payload.buys[i] += h.buys;
      payload.sells[i] += h.sells;
      payload.buyVolumeUsd[i] += h.buyUsd;
      payload.sellVolumeUsd[i] += h.sellUsd;
      payload.batchVolumeUsd[i] += h.batchVolUsd ?? 0;
      payload.feesEthUsd[i] += h.bFeeEthUsd;
      payload.feesBaseUsd[i] += h.bFeeBaseUsd;
      payload.feesHoodUsd[i] += h.bFeeHoodUsd ?? 0;
      payload.feeSplit.holders += h.split.holders;
      payload.feeSplit.burn += h.split.burn;
      payload.feeSplit.creator += h.split.creator;
      payload.feeSplit.interfaces += h.split.interfaces;
      payload.feeSplit.league += h.split.league ?? 0;
      payload.auctionEth += h.auctionEth;
      payload.auctionSeries[i] += h.auctionEth;
      for (const t of h.traders) traders.add(t);
      for (const [addr, b] of Object.entries(h.baskets)) basketVolume.set(addr, (basketVolume.get(addr) ?? 0) + b.buyUsd + b.sellUsd);
    } else if (prev && ms >= prevStartMs && ms < startMs) {
      prev.launches += h.launchesEth + h.launchesBase + (h.launchesHood ?? 0);
      prev.buys += h.buys;
      prev.sells += h.sells;
      prev.buyVolumeUsd += h.buyUsd;
      prev.sellVolumeUsd += h.sellUsd;
      prev.volumeUsd += h.buyUsd + h.sellUsd;
      prev.feesUsd += h.bFeeEthUsd + h.bFeeBaseUsd + (h.bFeeHoodUsd ?? 0);
      prev.auctionEth += h.auctionEth;
    }
  }

  payload.tradersTotal = traders.size;
  payload.topBaskets = [...basketVolume.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_BASKETS)
    .map(([addr, vol]) => ({
      address: addr,
      symbol: meta[addr]?.symbol ?? `${addr.slice(0, 6)}…${addr.slice(-4)}`,
      volumeUsd: vol,
      chain: meta[addr]?.chain ?? "ethereum",
    }));
  payload.prev = prev;
  payload.generatedAt = Date.now();
  return payload;
}
