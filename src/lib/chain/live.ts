import {
  AbiCoder,
  Contract,
  JsonRpcProvider,
  formatEther,
  formatUnits,
  getAddress,
  type Log,
} from "ethers";
import type { ActivityEvent, PulseStats } from "../feed/types";
import { listIndexes } from "../spectrum/index-data";
import {
  DEAD,
  PRISM,
  PRISM_LIVE,
  PRISM_CAP,
  DSTABLE,
  SPECTRUM_BASE,
  SPECTRUM_ETH,
  L1_PRISM_BURNER,
  KNOWN_INDEX_TOKENS,
  CHAINLINK_ETH_USD,
  AAVE_POOL,
  DSTABLE_RESERVES,
  DSTABLE_BASE,
  AAVE_POOL_BASE,
  DSTABLE_RESERVES_BASE,
  POOL_MANAGER,
  POOL_MANAGER_BASE,
  PRISM_POOL_ID,
  PRISM_POOL_FROM_BLOCK,
  TOPIC,
  TOPIC_DEAD,
  attributeBurnSource,
  INDEX_SYMBOL_SEED,
  INDEX_POOL_FEE_RATE,
  DSTABLE_DECIMALS,
  SPECTRUM_V2,
  SPECTRUM_LEGACY_FACTORIES,
  SPECTRUM_V2_FROM_BLOCK,
  TOPIC_V2,
  USDC_DECIMALS,
} from "./constants";

const ERC20_ABI = [
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];
const ORACLE_ABI = [
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
];
const DSTABLE_ABI = [
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function aavePrincipal(address) view returns (uint256)",
];
// Aave v3 Pool: currentLiquidityRate (3rd return, ray) is the supply APR.
const AAVE_POOL_ABI = [
  "function getReserveData(address) view returns (uint256,uint128,uint128 currentLiquidityRate,uint128,uint128,uint128,uint40,uint16,address,address,address,address,uint128,uint128,uint128)",
];
const SECONDS_PER_YEAR = 31_536_000;

// Read one dstable deployment: circulating supply + its Aave reserve (USD) and the
// reserve-weighted APR sum (so multiple sides can be blended). `exclude` holds
// protocol addresses (e.g. the V4 PoolManager) whose balances are pool liquidity,
// not real circulation, and are subtracted from total supply.
async function readDstableSide(
  provider: JsonRpcProvider,
  dstableAddr: string,
  aavePool: string,
  reserves: { addr: string; decimals: number }[],
  exclude: string[] = [],
): Promise<{ supply: number; reserveUsd: number; weighted: number }> {
  let supply = 0,
    reserveUsd = 0,
    weighted = 0;
  try {
    const ds = new Contract(dstableAddr, DSTABLE_ABI, provider);
    const aave = new Contract(aavePool, AAVE_POOL_ABI, provider);
    supply = num((await ds.totalSupply().catch(() => 0n)) as bigint, DSTABLE_DECIMALS);
    if (exclude.length) {
      const bals = await Promise.all(exclude.map((a) => ds.balanceOf(a).catch(() => 0n) as Promise<bigint>));
      for (const b of bals) supply -= num(b, DSTABLE_DECIMALS);
      supply = Math.max(0, supply);
    }
    await Promise.all(
      reserves.map(async (r) => {
        const [pr, rd] = await Promise.all([
          ds.aavePrincipal(r.addr).catch(() => 0n) as Promise<bigint>,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          aave.getReserveData(r.addr).catch(() => null) as Promise<any>,
        ]);
        const principal = num(pr, r.decimals);
        const apr = rd ? Number(rd[2]) / 1e27 : 0; // currentLiquidityRate (ray) → APR
        const a = apr > 0 ? Math.pow(1 + apr / SECONDS_PER_YEAR, SECONDS_PER_YEAR) - 1 : 0;
        reserveUsd += principal;
        weighted += principal * a;
      }),
    );
  } catch {
    /* optional — keep zeros */
  }
  return { supply, reserveUsd, weighted };
}

// dstable supply (mainnet + Base) + the live blended Aave APY across both reserves.
// Cached (changes slowly). The bulk of dstable circulates on Base.
let dstableCache: { at: number; supply: number; reserveUsd: number; apy: number } | null = null;
async function fetchDstable(provider: JsonRpcProvider, baseProvider: JsonRpcProvider | null) {
  if (dstableCache && Date.now() - dstableCache.at < STATS_TTL_MS) return dstableCache;
  const eth = await readDstableSide(provider, DSTABLE, AAVE_POOL, DSTABLE_RESERVES);
  // On Base, ~99% of dstable sits in the V4 PoolManager as index-pool liquidity, and
  // the index contracts hold fee balances — neither is circulating. Subtract both.
  const base = baseProvider
    ? await readDstableSide(baseProvider, DSTABLE_BASE, AAVE_POOL_BASE, DSTABLE_RESERVES_BASE, [
        POOL_MANAGER_BASE,
        ...KNOWN_INDEX_TOKENS,
      ])
    : { supply: 0, reserveUsd: 0, weighted: 0 };
  const supply = eth.supply + base.supply;
  const reserveUsd = eth.reserveUsd + base.reserveUsd;
  const weighted = eth.weighted + base.weighted;
  const apy = reserveUsd > 0 ? weighted / reserveUsd : 0;
  dstableCache = { at: Date.now(), supply, reserveUsd, apy };
  return dstableCache;
}

// Per-basket fee rate, cached forever (immutable on-chain). V2 baskets expose
// basketFeeBps() (creator-set, 100–300); v1 baskets have no getter and charge
// a flat 1% — the fallback.
const BASKET_FEE_ABI = ["function basketFeeBps() view returns (uint16)"];
const basketFeeRateCache: Record<string, number> = {};
export async function basketFeeRate(provider: JsonRpcProvider, addr: string): Promise<number> {
  const k = addr.toLowerCase();
  if (basketFeeRateCache[k] != null) return basketFeeRateCache[k];
  let rate = INDEX_POOL_FEE_RATE;
  try {
    const bps = Number(await new Contract(addr, BASKET_FEE_ABI, provider).basketFeeBps());
    if (bps >= 100 && bps <= 300) rate = bps / 10_000;
  } catch {
    /* v1 basket — flat 1% */
  }
  basketFeeRateCache[k] = rate;
  return rate;
}

// PRISM/USD price via DexScreener (no key), cached 5 minutes — powers the
// feed popup's "estimated PRISM burn" figures. Zero when unavailable.
let prismPriceCache: { at: number; prismUsd: number } | null = null;
export async function getPrismUsd(): Promise<number> {
  if (prismPriceCache && Date.now() - prismPriceCache.at < 300_000) return prismPriceCache.prismUsd;
  try {
    const r = await fetch(`https://api.dexscreener.com/tokens/v1/ethereum/${PRISM}`, {
      headers: { Accept: "application/json" },
    });
    if (!r.ok) return prismPriceCache?.prismUsd ?? 0;
    const pairs = (await r.json()) as { baseToken?: { address?: string }; priceUsd?: string | null; liquidity?: { usd?: number } }[];
    let best = 0;
    let bestLiq = -1;
    for (const p of pairs) {
      if (p.baseToken?.address?.toLowerCase() !== PRISM.toLowerCase()) continue;
      const liq = p.liquidity?.usd ?? 0;
      const px = p.priceUsd ? parseFloat(p.priceUsd) : 0;
      if (px > 0 && liq > bestLiq) {
        best = px;
        bestLiq = liq;
      }
    }
    if (best > 0) prismPriceCache = { at: Date.now(), prismUsd: best };
    return prismPriceCache?.prismUsd ?? 0;
  } catch {
    return prismPriceCache?.prismUsd ?? 0;
  }
}

// ETH/USD price, cached for 5 minutes (one cheap eth_call, shared by stats).
let priceCache: { at: number; ethUsd: number } | null = null;
export async function getEthUsd(provider: JsonRpcProvider): Promise<number> {
  if (priceCache && Date.now() - priceCache.at < 300_000) return priceCache.ethUsd;
  try {
    const oracle = new Contract(CHAINLINK_ETH_USD, ORACLE_ABI, provider);
    const r = await oracle.latestRoundData();
    const ethUsd = Number(r[1]) / 1e8;
    if (ethUsd > 0) priceCache = { at: Date.now(), ethUsd };
    return priceCache?.ethUsd ?? 0;
  } catch {
    return priceCache?.ethUsd ?? 0;
  }
}

const abi = AbiCoder.defaultAbiCoder();
const ETH_SECONDS_PER_BLOCK = 12;
const BASE_SECONDS_PER_BLOCK = 2;
const HOOD_SECONDS_PER_BLOCK = 0.1; // Robinhood Chain — measured live 2026-07-11 (~100ms blocks)

// Index ticker registry (addr-lower → SYMBOL). Seeded with the known set and
// topped up from Launched events, so every index-fee event can self-label
// without any extra RPC.
const indexSymbols: Record<string, string> = { ...INDEX_SYMBOL_SEED };
const symbolOf = (addr: string): string | undefined => indexSymbols[addr.toLowerCase()];
// Basket display names (addr-lower → name), same sources as the symbols —
// lets fee events carry "ticker + basket name" context without extra RPC.
const indexNames: Record<string, string> = {};
const nameOf = (addr: string): string | undefined => indexNames[addr.toLowerCase()];

// The feed tracks per-trade fees for ALL discovered Base indexes (a cheap
// recent-window scan), but the expensive all-time volume back-scan is capped to
// the top-N Base indexes by AUM so cold starts don't balloon RPC usage.
const INDEX_VOLUME_TOP_N = 20;

// Live Base index tokens, from the same discovery that powers the /indexes
// explorer (cached + single-flight), unioned with the hardcoded seed as a
// fallback. Side effect: seeds the symbol registry so new indexes' fee events
// carry their ticker.
export async function baseIndexTokens(): Promise<{ all: string[]; topByAum: string[]; count: number }> {
  try {
    const idx = await listIndexes();
    const base = idx.filter((i) => i.chain === "base");
    for (const i of base) {
      if (i.symbol) indexSymbols[i.address.toLowerCase()] = i.symbol;
      if (i.name) indexNames[i.address.toLowerCase()] = i.name;
    }
    if (!base.length) return { all: KNOWN_INDEX_TOKENS.slice(), topByAum: KNOWN_INDEX_TOKENS.slice(), count: idx.length };
    const top = [...base]
      .sort((a, b) => (b.aumUsd ?? 0) - (a.aumUsd ?? 0))
      .slice(0, INDEX_VOLUME_TOP_N)
      .map((i) => i.address.toLowerCase());
    return {
      all: [...new Set([...KNOWN_INDEX_TOKENS, ...base.map((i) => i.address.toLowerCase())])],
      topByAum: [...new Set([...KNOWN_INDEX_TOKENS, ...top])],
      count: idx.length,
    };
  } catch {
    return { all: KNOWN_INDEX_TOKENS.slice(), topByAum: KNOWN_INDEX_TOKENS.slice(), count: 0 };
  }
}

// Live V2 baskets on Ethereum — the tokens whose Minted/Redeemed trades the
// ETH side of the feed watches. Same discovery as the /spectrum listing (the
// V2 factory scan behind listIndexes, cached + single-flight). Side effect:
// seeds the symbol registry so V2 fee events self-label.
export async function ethIndexTokens(): Promise<{ all: string[] }> {
  try {
    const idx = await listIndexes();
    const eth = idx.filter((i) => i.chain === "ethereum");
    for (const i of eth) {
      if (i.symbol) indexSymbols[i.address.toLowerCase()] = i.symbol;
      if (i.name) indexNames[i.address.toLowerCase()] = i.name;
    }
    return { all: eth.map((i) => i.address.toLowerCase()) };
  } catch {
    return { all: [] };
  }
}

// Live V2 baskets on Robinhood Chain — the tokens whose trades the hood side of
// the feed watches. Same discovery; seeds the symbol registry.
export async function hoodIndexTokens(): Promise<{ all: string[] }> {
  try {
    const idx = await listIndexes();
    const hood = idx.filter((i) => i.chain === "robinhood");
    for (const i of hood) {
      if (i.symbol) indexSymbols[i.address.toLowerCase()] = i.symbol;
      if (i.name) indexNames[i.address.toLowerCase()] = i.name;
    }
    return { all: hood.map((i) => i.address.toLowerCase()) };
  } catch {
    return { all: [] };
  }
}

// One trade log → (isBuy, quote-USD size), across both lineages. v1 data is
// (dstableIn, indexOut)/(indexIn, dstableOut); V2 is (usdcIn, basketOut)/
// (basketIn, usdcOut) — the quote leg sits at the same data position in both,
// and both quotes are 6-decimal ≈$1 stables. NB: v1 trades index the TRADER
// as topic1; V2 trades index the FRONTEND tag there — never a trader.
function decodeTradeUsd(l: Log): { isBuy: boolean; usd: number } {
  const isBuy = l.topics[0] === TOPIC.minted || l.topics[0] === TOPIC_V2.minted;
  const d = abi.decode(["uint256", "uint256"], l.data);
  // DSTABLE_DECIMALS === USDC_DECIMALS (6) — same scale either lineage.
  return { isBuy, usd: num((isBuy ? d[0] : d[1]) as bigint, USDC_DECIMALS) };
}
// topic-0 OR: buys + sells across both lineages in one getLogs call.
const TRADE_TOPICS = () => [[TOPIC.minted, TOPIC.sellViaSwap, TOPIC_V2.minted, TOPIC_V2.redeemed]];

// fee/burn windows
const ETH_DAY_BLOCKS = 7200; // ~24h
const ETH_WEEK_BLOCKS = 50_400; // ~7d
const BASE_WEEK_BLOCKS = 302_400; // ~7d @ 2s

// ── Cost controls ───────────────────────────────────────────────────────────
// All on-chain reads sit behind shared, time-boxed caches, so RPC volume is
// bounded by these intervals — not by viewer count. 100 viewers cost like 1.
const STATS_TTL_MS = Number(process.env.STATS_REFRESH_MS) || 90_000;
const LIVE_TTL_MS = Number(process.env.LIVE_REFRESH_MS) || 20_000;
const ETH_INITIAL_LOOKBACK = 7200; // ~24h
const BASE_INITIAL_LOOKBACK = 43_200; // ~24h @ 2s
// ~24h @ 0.1s, like the other chains. A day is 3 chunked getLogs per query
// family (~0.6s measured) and — now that the scan result persists to Blobs —
// it runs once per snapshot version, not per instance, so the old 2h
// fast-paint shortcut (which hid most of the day's hood activity from the
// feed: the launches + all but the newest trades) buys nothing.
const HOOD_INITIAL_LOOKBACK = 864_000;
const HOOD_DAY_BLOCKS = 864_000; // ~24h @ 0.1s — cap when resuming from a stale persisted cursor
// Must be ≥ the sum of the per-kind bucket caps below (25 + 400 + 100), or the
// final recency slice quietly evicts bucket-reserved events — day-old sparse
// trades are always the oldest, so they were the first to go. That was half
// the "swaps aren't coming through" bug. Retention inside the buckets is
// TIME-based (the full 24h window), not slot-based: a fixed slot count made
// the visible window SHRINK as volume grew (84 trades/h blew through 60 slots
// in under an hour and evicted the rest of the day).
const MAX_BUFFER = 525;
const FEED_WINDOW_MS = 24 * 3600_000;

let cachedEth: JsonRpcProvider | null = null;
let cachedBase: JsonRpcProvider | null = null;

// ── RPC usage instrumentation ─────────────────────────────────────────────────
// Count every RPC method so usage is observable at /api/usage. Rough Alchemy
// compute-unit weights let us estimate spend without leaving the app.
const RPC_CU: Record<string, number> = {
  eth_getLogs: 75,
  eth_call: 26,
  eth_getBlockByNumber: 16,
  eth_getBlockByHash: 16,
  eth_blockNumber: 10,
  eth_getBalance: 19,
  eth_chainId: 0,
};
const rpcCounts: Record<string, number> = {};
const rpcSince = Date.now();
function instrument(p: JsonRpcProvider): JsonRpcProvider {
  const orig = p.send.bind(p);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (p as any).send = (method: string, params: any) => {
    rpcCounts[method] = (rpcCounts[method] || 0) + 1;
    return orig(method, params);
  };
  return p;
}

export function getRpcUsage() {
  const minutes = Math.max((Date.now() - rpcSince) / 60_000, 1 / 60);
  const totalCalls = Object.values(rpcCounts).reduce((a, b) => a + b, 0);
  const estCU = Object.entries(rpcCounts).reduce((a, [m, n]) => a + (RPC_CU[m] ?? 20) * n, 0);
  const cuPerMin = estCU / minutes;
  return {
    upMinutes: +minutes.toFixed(1),
    callsByMethod: rpcCounts,
    totalCalls,
    callsPerMin: +(totalCalls / minutes).toFixed(1),
    estComputeUnits: estCU,
    estCuPerMin: Math.round(cuPerMin),
    estCuPerDay: Math.round(cuPerMin * 60 * 24),
    estCuPerMonth: Math.round(cuPerMin * 60 * 24 * 30),
    intervals: { liveTtlMs: LIVE_TTL_MS, statsTtlMs: STATS_TTL_MS },
  };
}

export function getProvider(): JsonRpcProvider | null {
  if (process.env.FEED_MODE === "demo") return null;
  if (cachedEth) return cachedEth;
  const url =
    process.env.RPC_URL ||
    (process.env.ALCHEMY_API_KEY
      ? `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
      : "");
  if (!url) return null;
  cachedEth = instrument(new JsonRpcProvider(url, 1, { staticNetwork: true }));
  return cachedEth;
}

export function getBaseProvider(): JsonRpcProvider | null {
  if (process.env.FEED_MODE === "demo") return null;
  if (cachedBase) return cachedBase;
  const url =
    process.env.BASE_RPC_URL ||
    (process.env.ALCHEMY_API_KEY
      ? `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
      : "");
  if (!url) return null;
  cachedBase = instrument(new JsonRpcProvider(url, 8453, { staticNetwork: true }));
  return cachedBase;
}

let cachedHood: JsonRpcProvider | null = null;
export function getHoodProvider(): JsonRpcProvider | null {
  if (process.env.FEED_MODE === "demo") return null;
  if (cachedHood) return cachedHood;
  const url = process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com/rpc";
  cachedHood = instrument(new JsonRpcProvider(url, 4663, { staticNetwork: true }));
  return cachedHood;
}

export function isLive(): boolean {
  return process.env.FEED_MODE === "live" || getProvider() !== null;
}

function num(v: bigint, decimals = 18): number {
  return Number(formatUnits(v < 0n ? -v : v, decimals));
}

// Timestamps are estimated from block height (latestTs − Δblocks × blockTime).
// Accurate to a few seconds — plenty for "4m ago" — and costs zero extra RPC.
function blockTimestamps(
  blocks: number[],
  latestBlock: number,
  latestTs: number,
  secondsPerBlock: number,
): Map<number, number> {
  const map = new Map<number, number>();
  for (const bn of new Set(blocks)) {
    map.set(bn, (latestTs - (latestBlock - bn) * secondsPerBlock) * 1000);
  }
  return map;
}

export async function getLatestBlock(
  provider: JsonRpcProvider,
): Promise<{ number: number; ts: number }> {
  const b = await provider.getBlock("latest");
  return {
    number: b?.number ?? (await provider.getBlockNumber()),
    ts: b?.timestamp ?? Math.floor(Date.now() / 1000),
  };
}

// ── Ethereum events ──────────────────────────────────────────────────────────
// Stream ① (PRISM holder LP fees) via FeesPoked; stream ③ (dstable yield) via
// YieldClaimed; burns via Transfer→dEaD (attributed by sender). Burns from the
// L1 bridge burner are skipped here — they're represented by the Base bridge
// events so the same burn isn't shown twice.
// Basket addresses from launch logs that AREN'T yet in the known token list —
// these launched inside the scan window, so the batch trade query missed them.
function launchAddrs(launchLogs: Log[], known: string[]): string[] {
  const have = new Set(known.map((a) => a.toLowerCase()));
  const out = new Set<string>();
  for (const l of launchLogs) {
    try {
      const a = getAddress("0x" + l.topics[1].slice(26)).toLowerCase();
      if (!have.has(a)) out.add(a);
    } catch {
      /* skip malformed */
    }
  }
  return [...out];
}

async function fetchEthEvents(
  provider: JsonRpcProvider,
  fromBlock: number,
  toBlock: number,
  latestTs: number,
  v2Tokens: string[],
): Promise<{ events: ActivityEvent[]; newTokens: string[] }> {
  // Swaps drive the real-time fee feed — every trade on the PRISM pool earns
  // holders a fee (~1-2/min). Bounded to recent blocks so initial load is light.
  // (Cumulative fee totals come from FeesPoked in fetchLiveStats, not here.)
  const swapFrom = Math.max(fromBlock, toBlock - 900);
  // No token wired (relaunch pending) → skip the two PRISM-keyed queries
  // entirely. ethers DROPS an empty address filter, so running them would match
  // every other token's burns and mislabel them as PRISM. Spectrum's own
  // launches and trades below are unaffected and keep the feed alive.
  const [burns, swaps, yields, launched, launchedV2, tradesKnown] = await Promise.all([
    PRISM_LIVE
      ? provider
          .getLogs({ address: PRISM, topics: [TOPIC.transfer, null, TOPIC_DEAD], fromBlock, toBlock })
          .catch(() => [] as Log[])
      : Promise.resolve([] as Log[]),
    PRISM_LIVE
      ? provider
          .getLogs({ address: POOL_MANAGER, topics: [TOPIC.swap, PRISM_POOL_ID], fromBlock: swapFrom, toBlock })
          .catch(() => [] as Log[])
      : Promise.resolve([] as Log[]),
    provider
      .getLogs({ address: DSTABLE, topics: [TOPIC.yieldClaimed], fromBlock, toBlock })
      .catch(() => [] as Log[]),
    // Legacy v1 index launches on Ethereum (same Launched event as Base).
    provider
      .getLogs({ address: SPECTRUM_ETH, topics: [TOPIC.launched], fromBlock, toBlock })
      .catch(() => [] as Log[]),
    // V2 basket launches (env-wired factory; its own topic0).
    SPECTRUM_V2.ethFactory
      ? provider
          .getLogs({
            // current + legacy: the legacy eth factory still receives real launches
            // (the kit points there) — see SPECTRUM_LEGACY_FACTORIES in constants.
            address: [SPECTRUM_V2.ethFactory, ...SPECTRUM_LEGACY_FACTORIES.ethereum.map((f) => f.address)],
            topics: [TOPIC_V2.launched],
            fromBlock,
            toBlock,
          })
          .catch(() => [] as Log[])
      : Promise.resolve([] as Log[]),
    // V2 basket trades (USDC-quoted Minted/Redeemed on the basket tokens).
    v2Tokens.length
      ? provider
          .getLogs({ address: v2Tokens, topics: [[TOPIC_V2.minted, TOPIC_V2.redeemed]], fromBlock, toBlock })
          .catch(() => [] as Log[])
      : Promise.resolve([] as Log[]),
  ]);

  // A basket launched inside this same window trades immediately — the batch
  // query above ran with the pre-launch token list, so sweep the newcomers'
  // trades separately or their first buys fall between the cursors for good.
  const lateEth = launchAddrs(launchedV2, v2Tokens);
  const lateEthTrades = lateEth.length
    ? await provider.getLogs({ address: lateEth, topics: [[TOPIC_V2.minted, TOPIC_V2.redeemed]], fromBlock, toBlock }).catch(() => [] as Log[])
    : ([] as Log[]);
  const trades = lateEthTrades.length ? [...tradesKnown, ...lateEthTrades] : tradesKnown;

  const all = [...burns, ...swaps, ...yields, ...launched, ...launchedV2, ...trades];
  const tsMap = blockTimestamps(all.map((l) => l.blockNumber), toBlock, latestTs, ETH_SECONDS_PER_BLOCK);
  const tsOf = (l: Log) => tsMap.get(l.blockNumber) ?? Date.now();
  const idOf = (l: Log) => `${l.transactionHash}:${l.index}`;
  const events: ActivityEvent[] = [];

  for (const l of swaps.slice(-80)) {
    const d = abi.decode(["int128", "int128", "uint160", "uint128", "int24", "uint24"], l.data);
    let a0 = d[0] as bigint;
    if (a0 < 0n) a0 = -a0;
    const feePips = Number(d[5] as bigint) || 10000; // fee applied to this swap (pips; 10000 = 1%)
    const tradeEth = num(a0);
    const feeEth = tradeEth * (feePips / 1_000_000);
    if (feeEth <= 0) continue;
    events.push({
      id: idOf(l),
      kind: "fee",
      source: "prism-pool",
      chain: "ethereum",
      ts: tsOf(l),
      blockNumber: l.blockNumber,
      txHash: l.transactionHash,
      eth: feeEth,
      tradeEth,
      note: "LP revenue routed to holders from a PRISM pool swap",
    });
  }

  for (const l of yields) {
    const holdersUsd = abi.decode(["uint256"], l.data)[0] as bigint;
    events.push({
      id: idOf(l),
      kind: "harvest",
      source: "dstable",
      chain: "ethereum",
      ts: tsOf(l),
      blockNumber: l.blockNumber,
      txHash: l.transactionHash,
      usd: num(holdersUsd, 6),
      note: "Reserve revenue distributed to holders",
    });
  }

  for (const l of burns) {
    const from = getAddress("0x" + l.topics[1].slice(26));
    if (from.toLowerCase() === L1_PRISM_BURNER.toLowerCase()) continue; // shown via Base bridge events
    const value = abi.decode(["uint256"], l.data)[0] as bigint;
    if (value === 0n) continue;
    const { source, note, baseOrigin } = attributeBurnSource(from);
    events.push({
      id: idOf(l),
      kind: "burn",
      source,
      chain: baseOrigin ? "base" : "ethereum",
      ts: tsOf(l),
      blockNumber: l.blockNumber,
      txHash: l.transactionHash,
      prism: num(value),
      actor: from,
      note,
    });
  }

  for (const l of launched) {
    try {
      const token = getAddress("0x" + l.topics[1].slice(26));
      const dec = abi.decode(["bytes32", "string", "string", "uint160", "uint256"], l.data);
      events.push({
        id: idOf(l),
        kind: "launch",
        source: "spectrum-index",
        chain: "ethereum",
        ts: tsOf(l),
        blockNumber: l.blockNumber,
        txHash: l.transactionHash,
        eth: Number(formatEther(dec[4] as bigint)),
        label: dec[1] as string,
        symbol: dec[2] as string,
        actor: token,
        note: `${dec[1]} launched on Spectrum (Ethereum)`,
      });
    } catch {
      /* skip malformed */
    }
  }

  const newTokens: string[] = [];
  for (const l of launchedV2) {
    try {
      const basket = getAddress("0x" + l.topics[1].slice(26));
      newTokens.push(basket.toLowerCase());
      // Launched data = (name, symbol, startSqrtPriceX96, ethPaid, basketFeeBps)
      const dec = abi.decode(["string", "string", "uint160", "uint256", "uint16"], l.data);
      indexSymbols[basket.toLowerCase()] = dec[1] as string; // self-label future fee events
      indexNames[basket.toLowerCase()] = dec[0] as string;
      events.push({
        id: idOf(l),
        kind: "launch",
        source: "spectrum-index",
        chain: "ethereum",
        ts: tsOf(l),
        blockNumber: l.blockNumber,
        txHash: l.transactionHash,
        eth: Number(formatEther(dec[3] as bigint)),
        label: dec[0] as string,
        symbol: dec[1] as string,
        actor: basket,
        note: `${dec[0]} launched on Spectrum. 100% of the auction ETH buys & burns PRISM`,
      });
    } catch {
      /* skip malformed */
    }
  }

  // Per-trade V2 basket fees — same shape as the Base fee feed, so /spectrum's
  // "Buys & sells" filter streams Ethereum baskets too. The cap only guards a
  // pathological scan; a busy-but-real 24h cold day must fit inside it, or the
  // feed silently starts the day short (fee rates are cached per address).
  const tradeSlice = trades.slice(-400);
  const feeRates: Record<string, number> = {};
  await Promise.all(
    [...new Set(tradeSlice.map((l) => l.address.toLowerCase()))].map(async (a) => {
      feeRates[a] = await basketFeeRate(provider, a);
    }),
  );
  for (const l of tradeSlice) {
    try {
      const { isBuy, usd: tradeUsd } = decodeTradeUsd(l);
      const feeUsd = tradeUsd * (feeRates[l.address.toLowerCase()] ?? INDEX_POOL_FEE_RATE);
      if (feeUsd <= 0) continue;
      const sym = symbolOf(l.address);
      events.push({
        id: idOf(l),
        kind: "fee",
        source: "spectrum-index",
        chain: "ethereum",
        ts: tsOf(l),
        blockNumber: l.blockNumber,
        txHash: l.transactionHash,
        usd: feeUsd,
        tradeUsd,
        side: isBuy ? "buy" : "sell",
        symbol: sym,
        label: nameOf(l.address),
        actor: getAddress(l.address),
        note: `${sym ? `$${sym} ` : ""}${isBuy ? "buy" : "sell"} on Ethereum. 10% of the fee buys & burns PRISM`,
      });
    } catch {
      /* skip malformed */
    }
  }

  return { events, newTokens };
}

// ── Base events ───────────────────────────────────────────────────────────────
// Stream ② (index swap fees): each index pool charges a 1% fee on every trade.
// The pool's V4 hook does custom accounting, so the PoolManager Swap event nets
// to zero — the real trade size lives in the token's own Minted (buy) and
// SellViaSwap (sell) events. We emit one fee event per trade so index fees pile
// up live exactly like the PRISM-pool LP fees. PrismBurnBridged marks the
// periodic bridge-to-burn; stream ④ (launch auction) via Launched + AuctionBridgedToBurn.
async function fetchBaseEvents(
  provider: JsonRpcProvider,
  fromBlock: number,
  toBlock: number,
  latestTs: number,
  tokens: string[],
): Promise<{ events: ActivityEvent[]; newTokens: string[] }> {
  const [launched, launchedV2, bridged, bridgedV2, tradesKnown, idxBridged] = await Promise.all([
    provider
      .getLogs({ address: SPECTRUM_BASE, topics: [TOPIC.launched], fromBlock, toBlock })
      .catch(() => [] as Log[]),
    SPECTRUM_V2.baseFactory
      ? provider
          .getLogs({ address: SPECTRUM_V2.baseFactory, topics: [TOPIC_V2.launched], fromBlock, toBlock })
          .catch(() => [] as Log[])
      : Promise.resolve([] as Log[]),
    provider
      .getLogs({ address: SPECTRUM_BASE, topics: [TOPIC.auctionBridgedToBurn], fromBlock, toBlock })
      .catch(() => [] as Log[]),
    SPECTRUM_V2.baseFactory
      ? provider
          .getLogs({ address: SPECTRUM_V2.baseFactory, topics: [TOPIC_V2.auctionBridgedToBurnV2], fromBlock, toBlock })
          .catch(() => [] as Log[])
      : Promise.resolve([] as Log[]),
    tokens.length
      ? provider
          // topic-0 OR: buys and sells across both lineages in one call
          .getLogs({ address: tokens, topics: TRADE_TOPICS(), fromBlock, toBlock })
          .catch(() => [] as Log[])
      : Promise.resolve([] as Log[]),
    tokens.length
      ? provider
          .getLogs({ address: tokens, topics: [TOPIC.prismBurnBridged], fromBlock, toBlock })
          .catch(() => [] as Log[])
      : Promise.resolve([] as Log[]),
  ]);

  // Same-window launches trade with the pre-launch token list blind to them —
  // sweep the newcomers' trades before anything is decoded (see fetchEthEvents).
  const lateBase = launchAddrs([...launched, ...launchedV2], tokens);
  const lateBaseTrades = lateBase.length
    ? await provider.getLogs({ address: lateBase, topics: TRADE_TOPICS(), fromBlock, toBlock }).catch(() => [] as Log[])
    : ([] as Log[]);
  const trades = lateBaseTrades.length ? [...tradesKnown, ...lateBaseTrades] : tradesKnown;

  const all = [...launched, ...launchedV2, ...bridged, ...bridgedV2, ...trades, ...idxBridged];
  const tsMap = blockTimestamps(all.map((l) => l.blockNumber), toBlock, latestTs, BASE_SECONDS_PER_BLOCK);
  const tsOf = (l: Log) => tsMap.get(l.blockNumber) ?? Date.now();
  const idOf = (l: Log) => `${l.transactionHash}:${l.index}`;
  const events: ActivityEvent[] = [];
  const newTokens: string[] = [];

  for (const l of launched) {
    try {
      const token = getAddress("0x" + l.topics[1].slice(26));
      newTokens.push(token.toLowerCase());
      const dec = abi.decode(["bytes32", "string", "string", "uint160", "uint256"], l.data);
      indexSymbols[token.toLowerCase()] = dec[2] as string; // self-label future fee events
      indexNames[token.toLowerCase()] = dec[1] as string;
      events.push({
        id: idOf(l),
        kind: "launch",
        source: "spectrum-index",
        chain: "base",
        ts: tsOf(l),
        blockNumber: l.blockNumber,
        txHash: l.transactionHash,
        eth: Number(formatEther(dec[4] as bigint)),
        label: dec[1] as string,
        symbol: dec[2] as string,
        actor: token,
        note: `${dec[1]} launched on Spectrum. 90% of the launch revenue burns PRISM`,
      });
    } catch {
      /* skip malformed */
    }
  }

  for (const l of launchedV2) {
    try {
      const basket = getAddress("0x" + l.topics[1].slice(26));
      newTokens.push(basket.toLowerCase());
      const dec = abi.decode(["string", "string", "uint160", "uint256", "uint16"], l.data);
      indexSymbols[basket.toLowerCase()] = dec[1] as string; // self-label future fee events
      indexNames[basket.toLowerCase()] = dec[0] as string;
      events.push({
        id: idOf(l),
        kind: "launch",
        source: "spectrum-index",
        chain: "base",
        ts: tsOf(l),
        blockNumber: l.blockNumber,
        txHash: l.transactionHash,
        eth: Number(formatEther(dec[3] as bigint)),
        label: dec[0] as string,
        symbol: dec[1] as string,
        actor: basket,
        note: `${dec[0]} launched on Spectrum. 100% of the auction ETH buys & burns PRISM`,
      });
    } catch {
      /* skip malformed */
    }
  }

  for (const l of bridged) {
    const token = getAddress("0x" + l.topics[1].slice(26));
    const bridgedEth = abi.decode(["uint256", "uint256"], l.data)[0] as bigint;
    events.push({
      id: idOf(l),
      kind: "burn",
      source: "spectrum-auction",
      chain: "base",
      ts: tsOf(l),
      blockNumber: l.blockNumber,
      txHash: l.transactionHash,
      eth: num(bridgedEth),
      actor: token,
      note: "Launch auction proceeds bridged to Ethereum to buy & burn PRISM",
    });
  }

  // V2 factory: AuctionBridgedToBurn(basket indexed, burnerL1 indexed, bridgedEth)
  // — the amount is the single data word (the v1 event carries two).
  for (const l of bridgedV2) {
    try {
      const basket = getAddress("0x" + l.topics[1].slice(26));
      const bridgedEth = abi.decode(["uint256"], l.data)[0] as bigint;
      events.push({
        id: idOf(l),
        kind: "burn",
        source: "spectrum-auction",
        chain: "base",
        ts: tsOf(l),
        blockNumber: l.blockNumber,
        txHash: l.transactionHash,
        eth: num(bridgedEth),
        actor: basket,
        note: "Launch auction proceeds bridged to Ethereum to buy & burn PRISM",
      });
    } catch {
      /* skip malformed */
    }
  }

  // Per-trade basket fees. Each carries the basket's fee (its own on-chain
  // rate; v1 flat 1%) in USD — a fixed 10% of it is PRISM's. The cap only
  // guards a pathological scan: a real 24h cold day must fit, or the feed
  // silently starts the day short.
  const tradeSlice = trades.slice(-400);
  const feeRates: Record<string, number> = {};
  await Promise.all(
    [...new Set(tradeSlice.map((l) => l.address.toLowerCase()))].map(async (a) => {
      feeRates[a] = await basketFeeRate(provider, a);
    }),
  );
  for (const l of tradeSlice) {
    try {
      // v1: (dstableIn, indexOut)/(indexIn, dstableOut); V2: (usdcIn, basketOut)/
      // (basketIn, usdcOut) — decodeTradeUsd picks the quote leg for either.
      const { isBuy, usd: tradeUsd } = decodeTradeUsd(l);
      const feeUsd = tradeUsd * (feeRates[l.address.toLowerCase()] ?? INDEX_POOL_FEE_RATE);
      if (feeUsd <= 0) continue;
      const sym = symbolOf(l.address);
      events.push({
        id: idOf(l),
        kind: "fee",
        source: "spectrum-index",
        chain: "base",
        ts: tsOf(l),
        blockNumber: l.blockNumber,
        txHash: l.transactionHash,
        usd: feeUsd,
        tradeUsd,
        side: isBuy ? "buy" : "sell",
        symbol: sym,
        label: nameOf(l.address),
        actor: getAddress(l.address),
        note: `${sym ? `$${sym} ` : ""}${isBuy ? "buy" : "sell"} on Base. 10% of the fee buys & burns PRISM`,
      });
    } catch {
      /* skip malformed */
    }
  }

  for (const l of idxBridged) {
    const ethBridged = abi.decode(["uint256", "uint256"], l.data)[1] as bigint;
    events.push({
      id: idOf(l),
      kind: "burn",
      source: "spectrum-index",
      chain: "base",
      ts: tsOf(l),
      blockNumber: l.blockNumber,
      txHash: l.transactionHash,
      eth: num(ethBridged),
      actor: getAddress(l.address),
      note: "Basket revenue reached 1 ETH, bridged to Ethereum to buy & burn PRISM",
    });
  }

  return { events, newTokens };
}

// ── aggregate stats (cached) ──────────────────────────────────────────────────
let statsCache: { at: number; stats: PulseStats } | null = null;

// All-time fees-to-holders accumulator (in-memory). Cold start sums FeesPoked
// from pool inception; afterwards only new blocks are folded in — so "all-time"
// never undercounts as the pool ages past any fixed window. Resets on restart
// (one re-scan on a cold instance, then incremental).
type FeeAcc = { lastBlock: number; ethTotal: number; prismTotal: number };
type VolAcc = { lastBlock: number; volumeUsd: number; tokens: string[] };
let feeAcc: FeeAcc | null = null;

async function getFeeLogsChunked(provider: JsonRpcProvider, from: number, to: number): Promise<Log[]> {
  // No token wired → return nothing. ethers DROPS an empty address filter, so this
  // scan would otherwise sum every contract's FeesPoked-topic logs on mainnet and
  // report them as PRISM's lifetime revenue (observed: a $186k figure on a
  // pre-launch page). Never scan a topic without its address.
  if (!PRISM_LIVE) return [];
  const CHUNK = 250_000; // keeps FeesPoked counts comfortably under the 10k-log cap
  const ranges: [number, number][] = [];
  for (let s = from; s <= to; s += CHUNK) ranges.push([s, Math.min(s + CHUNK - 1, to)]);
  // The chunks are independent, so fetch them CONCURRENTLY (bounded) instead of
  // one after another. Sequentially, a cold scan from pool inception is a dozen
  // round trips of pure latency — survivable on a host that persists the
  // accumulator afterwards (Netlify Blobs), fatal on one that cannot: Cloudflare
  // Workers kill post-response work, so the scan restarted from zero on every
  // request, never finished inside the budget, and stats never appeared at all.
  // Order is restored by index; each chunk keeps its own catch.
  const LIMIT = 6;
  const parts: Log[][] = ranges.map(() => []);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(LIMIT, ranges.length) }, async () => {
      while (next < ranges.length) {
        const i = next++;
        const [s, e] = ranges[i];
        parts[i] = await provider
          .getLogs({ address: PRISM, topics: [TOPIC.feesPoked], fromBlock: s, toBlock: e })
          .catch(() => [] as Log[]);
      }
    }),
  );
  return parts.flat();
}

// All-time index trade volume (USD), same incremental pattern as feeAcc. Cold
// start sums every buy + sell across the known indexes/baskets; afterwards only
// new blocks fold in. `indexFeesTotal` = volume × 1% fee.
let baseFeeAcc: VolAcc | null = null;

// Same accumulator for the ETH-side V2 baskets (USDC-quoted trades). Bounded
// below by the factory's first launch, so the cold back-scan stays tiny.
let ethFeeAcc: VolAcc | null = null;

// ── Accumulator persistence (Netlify Blobs; best-effort, silently absent in
// local dev) ──────────────────────────────────────────────────────────────────
// Without this, all three accumulators re-sum from chain inception on EVERY cold
// serverless instance — the single biggest cold-start RPC cost. Persisting them
// lets a fresh instance RESUME from lastBlock (the cheap incremental path) instead
// of re-scanning history. Mirrors the store persistence in chain/charts.ts. We
// only resume within a safe single-getLogs window; staler than that, the
// accumulator is left null so the chunked cold scan rebuilds it (no giant range).
interface AccSnap {
  v: 1;
  feeAcc: FeeAcc | null; // PRISM's — token-scoped
  baseFeeAcc: VolAcc | null; // Spectrum's — token-independent
  ethFeeAcc: VolAcc | null; // Spectrum's — token-independent
}
type BlobJson = { get(k: string, o: { type: "json" }): Promise<unknown>; setJSON(k: string, v: unknown): Promise<void> };
async function statsBlob(): Promise<BlobJson | null> {
  try {
    const { getStore } = await import("@netlify/blobs");
    return getStore({ name: "prismbeat-stats", consistency: "eventual" }) as unknown as BlobJson;
  } catch {
    return null;
  }
}
// Persisted snapshots are keyed BY TOKEN so a relaunch can never serve the previous
// token's cached totals or buffered events out of a blob — that is how purged data
// comes back to life. Pre-launch there is no key, so nothing is restored.
//
// SPECTRUM's accumulators are deliberately NOT token-scoped: they are independent of
// PRISM and rebuilding them is the expensive cold scan, so they persist under their
// own stable key and survive every relaunch.
const accKey = () => (PRISM_LIVE ? `acc-${PRISM.toLowerCase()}` : null);
const spectrumAccKey = "acc-spectrum";
const feedKey = () => (PRISM_LIVE ? `feed-${PRISM.toLowerCase()}` : null);

let accSnapLoaded = false;
let accSnap: AccSnap | null = null;
async function loadAccSnap(): Promise<AccSnap | null> {
  if (accSnapLoaded) return accSnap;
  accSnapLoaded = true;
  try {
    const blobs = await statsBlob();
    if (blobs) {
      const k = accKey();
      const [tokenPart, spectrumPart] = await Promise.all([
        k ? (blobs.get(k, { type: "json" }) as Promise<AccSnap | null>) : Promise.resolve(null),
        blobs.get(spectrumAccKey, { type: "json" }) as Promise<AccSnap | null>,
      ]);
      accSnap = {
        v: 1,
        feeAcc: tokenPart?.feeAcc ?? null, // only this token's fee history
        baseFeeAcc: spectrumPart?.baseFeeAcc ?? null,
        ethFeeAcc: spectrumPart?.ethFeeAcc ?? null,
      };
    }
  } catch {
    /* cold scan rebuilds */
  }
  return accSnap;
}
let accLastPersist = 0;
const ACC_PERSIST_EVERY_MS = 120_000;
async function persistAcc(): Promise<void> {
  if (Date.now() - accLastPersist < ACC_PERSIST_EVERY_MS) return;
  accLastPersist = Date.now();
  try {
    const blobs = await statsBlob();
    if (blobs) {
      const k = accKey();
      await Promise.all([
        k ? blobs.setJSON(k, { v: 1, feeAcc, baseFeeAcc: null, ethFeeAcc: null } satisfies AccSnap) : Promise.resolve(),
        blobs.setJSON(spectrumAccKey, { v: 1, feeAcc: null, baseFeeAcc, ethFeeAcc } satisfies AccSnap),
      ]);
    }
  } catch {
    /* best-effort */
  }
}

// Sum quote-stable trade volume from trade logs (one OR-filtered query),
// covering v1 (dstable) and V2 (USDC) trade events alike.
function sumIndexTradeVolumeUsd(logs: Log[]): number {
  let usd = 0;
  for (const l of logs) {
    try {
      usd += decodeTradeUsd(l).usd;
    } catch {
      /* skip malformed */
    }
  }
  return usd;
}

async function getIndexTradeLogsChunked(
  provider: JsonRpcProvider,
  tokens: string[],
  from: number,
  to: number,
): Promise<Log[]> {
  const CHUNK = 100_000; // ~2.3 days/chunk on Base — keeps trade counts under the cap
  const out: Log[] = [];
  for (let s = from; s <= to; s += CHUNK) {
    const e = Math.min(s + CHUNK - 1, to);
    const part = await provider
      .getLogs({ address: tokens, topics: TRADE_TOPICS(), fromBlock: s, toBlock: e })
      .catch(() => [] as Log[]);
    out.push(...part);
  }
  return out;
}

let statsInflight: Promise<PulseStats> | null = null;

// Public entry: served from the shared cache, else single-flighted so concurrent
// callers on a cold instance collapse onto ONE compute instead of each firing the
// full cold-start scan (pool-inception fees + Base back-scan + index discovery).
export async function fetchLiveStats(
  provider: JsonRpcProvider,
  baseProvider: JsonRpcProvider | null,
): Promise<PulseStats> {
  if (statsCache && Date.now() - statsCache.at < STATS_TTL_MS) return statsCache.stats;
  if (statsInflight) return statsInflight;
  statsInflight = computeLiveStats(provider, baseProvider).finally(() => {
    statsInflight = null;
  });
  return statsInflight;
}

async function computeLiveStats(
  provider: JsonRpcProvider,
  baseProvider: JsonRpcProvider | null,
): Promise<PulseStats> {
  const prism = new Contract(PRISM, ERC20_ABI, provider);
  const { number: latestNum, ts: latestTs } = await getLatestBlock(provider);

  const [supplyRaw, deadRaw, ethUsd, dstable, prismUsd] = await Promise.all([
    prism.totalSupply().catch(() => 0n) as Promise<bigint>,
    prism.balanceOf(DEAD).catch(() => 0n) as Promise<bigint>,
    getEthUsd(provider),
    fetchDstable(provider, baseProvider),
    getPrismUsd(),
  ]);

  const dayThresh = latestNum - ETH_DAY_BLOCKS;
  const weekThresh = latestNum - ETH_WEEK_BLOCKS;

  // Resume the ETH accumulators from the persisted snapshot (if fresh enough that
  // the recent single-getLogs scan bridges the gap) instead of scanning inception.
  {
    const snap = await loadAccSnap();
    if (snap?.v === 1) {
      if (!feeAcc && snap.feeAcc && latestNum - snap.feeAcc.lastBlock <= ETH_WEEK_BLOCKS) feeAcc = snap.feeAcc;
      if (!ethFeeAcc && snap.ethFeeAcc && latestNum - snap.ethFeeAcc.lastBlock <= ETH_WEEK_BLOCKS) ethFeeAcc = snap.ethFeeAcc;
    }
  }

  // Fees to holders, valued when EARNED (no PRISM-price-appreciation distortion).
  // The PRISM leg, valued at its earned price, is ≈ equal to the ETH leg because
  // two-way swap volume is arbitrage-balanced (verified on-chain: per-swap earned
  // 40.6 ETH ≈ 2× the 20.4 ETH leg). So total ≈ 2× the ETH leg.
  const LEG_FACTOR = 2;

  // All-time: incremental accumulator. Cold start sums from pool inception;
  // afterwards only new blocks are folded in, so it scales past any fixed window.
  if (!feeAcc) {
    const all = await getFeeLogsChunked(provider, PRISM_POOL_FROM_BLOCK, latestNum);
    let e0 = 0, p0 = 0;
    for (const l of all) {
      const d = abi.decode(["uint256", "uint256"], l.data);
      e0 += num(d[0] as bigint);
      p0 += num(d[1] as bigint);
    }
    feeAcc = { lastBlock: latestNum, ethTotal: e0, prismTotal: p0 };
  }

  // recent 7d scan — drives the 24h/7d figures and folds new fees into all-time
  const recentFrom = Math.max(0, Math.min(weekThresh, feeAcc.lastBlock + 1));
  const recentRes = PRISM_LIVE
    ? await provider
        .getLogs({ address: PRISM, topics: [TOPIC.feesPoked], fromBlock: recentFrom, toBlock: latestNum })
        .then((x) => x as Log[])
        .catch(() => null as Log[] | null)
    : ([] as Log[]);
  // Empty address filters get DROPPED by ethers — never scan without a token.
  const burnLogs = PRISM_LIVE
    ? await provider
        .getLogs({ address: PRISM, topics: [TOPIC.transfer, null, TOPIC_DEAD], fromBlock: dayThresh, toBlock: latestNum })
        .catch(() => [] as Log[])
    : ([] as Log[]);

  let eth24 = 0, eth7 = 0, feeEvents24h = 0;
  for (const l of recentRes ?? []) {
    const d = abi.decode(["uint256", "uint256"], l.data);
    const e = num(d[0] as bigint);
    if (l.blockNumber > feeAcc.lastBlock) {
      feeAcc.ethTotal += e;
      feeAcc.prismTotal += num(d[1] as bigint);
    }
    if (l.blockNumber >= weekThresh) eth7 += e;
    if (l.blockNumber >= dayThresh) {
      eth24 += e;
      feeEvents24h += 1;
    }
  }
  if (recentRes) feeAcc.lastBlock = latestNum;

  const ethT = feeAcc.ethTotal;
  const prismT = feeAcc.prismTotal;
  const fees24h = eth24 * LEG_FACTOR;
  const fees7d = eth7 * LEG_FACTOR;
  const feesTotal = ethT * LEG_FACTOR;

  let prismBurnedToday = 0;
  for (const l of burnLogs) {
    // An empty `data` is possible when no token is wired (relaunch pending) —
    // decoding it throws BUFFER_OVERRUN and used to 503 the whole feed, taking
    // Spectrum's live activity down with it. Skip instead.
    if (!l.data || l.data === "0x") continue;
    try {
      prismBurnedToday += num(abi.decode(["uint256"], l.data)[0] as bigint);
    } catch {
      /* malformed log — ignore */
    }
  }

  // ETH-side V2 basket trade volume — folded into the cumulative basket-fee and
  // volume figures alongside the Base accumulator.
  try {
    const { all: ethV2 } = await ethIndexTokens();
    if (ethV2.length) {
      if (!ethFeeAcc) {
        const allTrades = await getIndexTradeLogsChunked(provider, ethV2, SPECTRUM_V2_FROM_BLOCK.ethereum, latestNum);
        ethFeeAcc = { lastBlock: latestNum, volumeUsd: sumIndexTradeVolumeUsd(allTrades), tokens: ethV2 };
      } else if (latestNum > ethFeeAcc.lastBlock) {
        const fresh = await provider
          .getLogs({ address: ethFeeAcc.tokens, topics: TRADE_TOPICS(), fromBlock: ethFeeAcc.lastBlock + 1, toBlock: latestNum })
          .catch(() => null as Log[] | null);
        if (fresh) {
          ethFeeAcc.volumeUsd += sumIndexTradeVolumeUsd(fresh);
          ethFeeAcc.lastBlock = latestNum;
        }
      }
    }
  } catch {
    /* eth basket leg optional */
  }

  // bridgePendingEth = Base value bridged-to-burn in the last ~7d (in-flight over
  // the ~7-day withdrawal), summing auction + index bridges.
  let bridgePendingEth = 0;
  let bridgeNextBurnTs: number | undefined;
  let indexCount = 0;
  let indexFeesTotal = 0;
  if (baseProvider) {
    try {
      const { number: bLatest, ts: bTs } = await getLatestBlock(baseProvider);
      const bFrom = Math.max(0, bLatest - BASE_WEEK_BLOCKS);
      const sinceLaunch = Math.max(0, bLatest - 1_000_000);
      // Discovered Base indexes (same source as the /indexes explorer + the live
      // feed). `all` covers every Base index (cheap recent-window fee scan);
      // `topByAum` is the bounded set for the expensive all-time volume back-scan.
      const { all: baseAll, topByAum: baseTop, count: idxCount } = await baseIndexTokens();
      indexCount = idxCount;

      // Resume the Base accumulator too (tighter window — its incremental scan
      // is a single un-chunked getLogs, so only bridge a day's worth at most).
      {
        const snap = await loadAccSnap();
        if (snap?.v === 1 && !baseFeeAcc && snap.baseFeeAcc && bLatest - snap.baseFeeAcc.lastBlock <= BASE_INITIAL_LOOKBACK) {
          baseFeeAcc = snap.baseFeeAcc;
        }
      }

      const [auc, idx] = await Promise.all([
        baseProvider
          .getLogs({ address: SPECTRUM_BASE, topics: [TOPIC.auctionBridgedToBurn], fromBlock: bFrom, toBlock: bLatest })
          .catch(() => [] as Log[]),
        baseAll.length
          ? baseProvider
              .getLogs({ address: baseAll, topics: [TOPIC.prismBurnBridged], fromBlock: bFrom, toBlock: bLatest })
              .catch(() => [] as Log[])
          : Promise.resolve([] as Log[]),
      ]);

      // Cumulative index swap fees = all-time trade volume × 1%. Bounded to the
      // top-N Base indexes by AUM so cold-start back-scans stay cheap; the
      // accumulator carries its own token set so warm increments stay consistent.
      if (baseTop.length) {
        if (!baseFeeAcc) {
          const allTrades = await getIndexTradeLogsChunked(baseProvider, baseTop, sinceLaunch, bLatest);
          baseFeeAcc = { lastBlock: bLatest, volumeUsd: sumIndexTradeVolumeUsd(allTrades), tokens: baseTop };
        } else if (bLatest > baseFeeAcc.lastBlock) {
          const fresh = await baseProvider
            .getLogs({ address: baseFeeAcc.tokens, topics: TRADE_TOPICS(), fromBlock: baseFeeAcc.lastBlock + 1, toBlock: bLatest })
            .catch(() => null as Log[] | null);
          if (fresh) {
            baseFeeAcc.volumeUsd += sumIndexTradeVolumeUsd(fresh);
            baseFeeAcc.lastBlock = bLatest;
          }
        }
      }

      let oldest = Number.POSITIVE_INFINITY;
      for (const l of auc) {
        bridgePendingEth += num(abi.decode(["uint256", "uint256"], l.data)[0] as bigint);
        oldest = Math.min(oldest, l.blockNumber);
      }
      for (const l of idx) {
        bridgePendingEth += num(abi.decode(["uint256", "uint256"], l.data)[1] as bigint);
        oldest = Math.min(oldest, l.blockNumber);
      }
      if (Number.isFinite(oldest)) {
        const oldestTs = (bTs - (bLatest - oldest) * BASE_SECONDS_PER_BLOCK) * 1000;
        bridgeNextBurnTs = oldestTs + 7 * 24 * 3600 * 1000; // ~7-day withdrawal
      }
    } catch {
      /* base optional */
    }
  }

  // Basket-fee totals across BOTH chains: Base (v1 + V2) + the ETH V2 baskets.
  // Flat 1% approximates well — v1 is flat 1% and 1% is V2's floor/typical rate.
  const tradeVolumeUsd = (baseFeeAcc?.volumeUsd ?? 0) + (ethFeeAcc?.volumeUsd ?? 0);
  if (tradeVolumeUsd > 0 && ethUsd > 0) {
    indexFeesTotal = (tradeVolumeUsd * INDEX_POOL_FEE_RATE) / ethUsd;
  }
  // No Base provider (or its discovery failed): count launches from the shared
  // list directly so the headline still reflects the ETH-side V2 baskets.
  if (indexCount === 0) {
    indexCount = await listIndexes().then((idx) => idx.length).catch(() => 0);
  }

  const totalBurned = num(deadRaw);
  const totalSupply = num(supplyRaw);
  const circulating = Math.max(0, totalSupply - totalBurned);
  const windowMinutes = (ETH_DAY_BLOCKS * ETH_SECONDS_PER_BLOCK) / 60;

  let lastBurnTs: number | undefined;
  if (burnLogs.length) {
    const newest = burnLogs.reduce((m, l) => Math.max(m, l.blockNumber), 0);
    lastBurnTs = (latestTs - (latestNum - newest) * ETH_SECONDS_PER_BLOCK) * 1000;
  }

  const stats: PulseStats = {
    mode: "live",
    totalBurned,
    supply: circulating,
    cap: PRISM_CAP,
    liveNfts: Math.floor(circulating),
    burnsToday: burnLogs.length,
    prismBurnedToday,
    feeEventsToday: feeEvents24h,
    ethVolumeToday: fees24h,
    feesToHolders24h: fees24h,
    feesToHolders7d: fees7d,
    feesToHoldersTotal: feesTotal,
    feesEthTotal: ethT,
    feesPrismTotal: prismT,
    bridgePendingEth,
    bridgeNextBurnTs,
    ethUsd,
    indexCount,
    indexFeesTotal,
    prismUsd,
    dstableSupply: dstable.supply,
    dstableVolumeUsd: tradeVolumeUsd,
    dstableReserveUsd: dstable.reserveUsd,
    dstableAaveApy: dstable.apy,
    eventsPerMin: (burnLogs.length + feeEvents24h) / Math.max(windowMinutes, 1),
    lastBurnTs,
    blockNumber: latestNum,
  };
  statsCache = { at: Date.now(), stats };
  void persistAcc(); // fire-and-forget; throttled + best-effort
  return stats;
}

// Robinhood Chain events: V2 launches from the hood factory + trades on hood
// baskets. 0.1s blocks → wide windows; chunked so a 24h cold scan (~864k
// blocks) stays within RPC limits.
async function fetchHoodEvents(
  provider: JsonRpcProvider,
  fromBlock: number,
  toBlock: number,
  latestTs: number,
  tokens: string[],
): Promise<{ events: ActivityEvent[]; newTokens: string[] }> {
  const CHUNK = 400_000;
  const launched: Log[] = [];
  const trades: Log[] = [];
  const factory = SPECTRUM_V2.hoodFactory;
  for (let s0 = fromBlock; s0 <= toBlock; s0 += CHUNK) {
    const e0 = Math.min(s0 + CHUNK - 1, toBlock);
    const [l, t] = await Promise.all([
      factory
        ? provider.getLogs({ address: factory, topics: [TOPIC_V2.launched], fromBlock: s0, toBlock: e0 }).catch(() => [] as Log[])
        : Promise.resolve([] as Log[]),
      tokens.length
        ? provider.getLogs({ address: tokens, topics: [[TOPIC_V2.minted, TOPIC_V2.redeemed]], fromBlock: s0, toBlock: e0 }).catch(() => [] as Log[])
        : Promise.resolve([] as Log[]),
    ]);
    launched.push(...l);
    trades.push(...t);
  }

  // Same-window launches trade with the pre-launch token list blind to them —
  // sweep the newcomers' trades over the same range (see fetchEthEvents).
  const lateHood = launchAddrs(launched, tokens);
  if (lateHood.length) {
    trades.push(
      ...(await getLogsChunked(provider, { address: lateHood, topics: [[TOPIC_V2.minted, TOPIC_V2.redeemed]] }, fromBlock, toBlock, CHUNK)),
    );
  }

  const all = [...launched, ...trades];
  const tsMap = blockTimestamps(all.map((l) => l.blockNumber), toBlock, latestTs, HOOD_SECONDS_PER_BLOCK);
  const tsOf = (l: Log) => (tsMap.get(l.blockNumber) ?? Date.now());
  const idOf = (l: Log) => `${l.transactionHash}:${l.index}`;
  const events: ActivityEvent[] = [];
  const newTokens: string[] = [];

  for (const l of launched) {
    try {
      const basket = getAddress("0x" + l.topics[1].slice(26));
      newTokens.push(basket.toLowerCase());
      const dec = abi.decode(["string", "string", "uint160", "uint256", "uint16"], l.data);
      indexSymbols[basket.toLowerCase()] = dec[1] as string;
      indexNames[basket.toLowerCase()] = dec[0] as string;
      events.push({
        id: idOf(l),
        kind: "launch",
        source: "spectrum-index",
        chain: "robinhood",
        ts: tsOf(l),
        blockNumber: l.blockNumber,
        txHash: l.transactionHash,
        eth: Number(formatEther(dec[3] as bigint)),
        label: dec[0] as string,
        symbol: dec[1] as string,
        actor: basket,
        note: `${dec[0]} launched on Spectrum (Robinhood Chain)`,
      });
    } catch {
      /* skip malformed */
    }
  }

  for (const l of trades) {
    try {
      const token = (l.address || "").toLowerCase();
      const { isBuy, usd } = decodeTradeUsd(l);
      const sym = indexSymbols[token];
      events.push({
        id: idOf(l),
        kind: "fee",
        source: "spectrum-index",
        chain: "robinhood",
        ts: tsOf(l),
        blockNumber: l.blockNumber,
        txHash: l.transactionHash,
        tradeUsd: usd,
        side: isBuy ? "buy" : "sell",
        symbol: sym,
        actor: l.address,
        note: `${sym ? `${sym} ` : ""}${isBuy ? "buy" : "sell"} on Robinhood Chain. 10% of the fee buys & burns PRISM`,
      });
    } catch {
      /* skip malformed */
    }
  }

  return { events, newTokens };
}

// ── Shared event snapshot (ETH + Base + Robinhood, cached + single-flight) ─────
type FeedSnap = {
  ethBlock: number;
  baseBlock: number;
  hoodBlock: number;
  events: ActivityEvent[];
  tokens: string[];
  ethTokens: string[];
  hoodTokens: string[];
  at: number;
};
let feedCache: FeedSnap | null = null;
let inflight: Promise<FeedSnap> | null = null;

// ── Feed persistence (Netlify Blobs; best-effort, silently absent locally) ────
// The buffer above was per-instance memory only: every cold serverless instance
// rebuilt from the initial lookbacks (hood: ~2h), so which trades a viewer saw
// depended on which instance answered — day-old buys/sells simply vanished.
// Persisting the merged buffer + block cursors makes every instance resume the
// same feed (the same pattern as the charts store / stats accumulators).
// v3: time-based 24h retention replaced the 60-slot trade cap — the bump
// discards v2 snapshots, whose buffers already EVICTED the early-day trades
// under the old cap (warm cursors would never revisit those blocks).
interface FeedBlobSnap {
  v: 3;
  ethBlock: number;
  baseBlock: number;
  hoodBlock: number;
  events: ActivityEvent[];
  tokens: string[];
  ethTokens: string[];
  hoodTokens: string[];
  savedAt: number;
}
let feedSnapLoaded = false;
async function loadFeedSnap(): Promise<void> {
  if (feedSnapLoaded || feedCache) return;
  feedSnapLoaded = true;
  try {
    const blobs = await statsBlob();
    if (!blobs) return;
    const k = feedKey();
    if (!k) return; // pre-launch: no per-token key, nothing to restore
    const snap = (await blobs.get(k, { type: "json" })) as FeedBlobSnap | null;
    if (!snap || snap.v !== 3 || !Array.isArray(snap.events)) return;
    feedCache = {
      ethBlock: snap.ethBlock,
      baseBlock: snap.baseBlock,
      hoodBlock: snap.hoodBlock ?? 0,
      events: snap.events,
      tokens: snap.tokens ?? [],
      ethTokens: snap.ethTokens ?? [],
      hoodTokens: snap.hoodTokens ?? [],
      at: 0, // stale on purpose → the caller refreshes incrementally from the cursors
    };
  } catch {
    /* corrupt / unavailable snapshot → cold scan rebuilds */
  }
}
let feedLastPersist = 0;
const FEED_PERSIST_EVERY_MS = 60_000;
async function persistFeedSnap(s: FeedSnap): Promise<void> {
  if (Date.now() - feedLastPersist < FEED_PERSIST_EVERY_MS) return;
  feedLastPersist = Date.now();
  try {
    const blobs = await statsBlob();
    if (!blobs) return;
    const snap: FeedBlobSnap = {
      v: 3,
      ethBlock: s.ethBlock,
      baseBlock: s.baseBlock,
      hoodBlock: s.hoodBlock,
      events: s.events,
      tokens: s.tokens,
      ethTokens: s.ethTokens,
      hoodTokens: s.hoodTokens,
      savedAt: Date.now(),
    };
    const k = feedKey();
    if (!k) return;
    await blobs.setJSON(k, snap);
  } catch {
    /* best-effort */
  }
}

async function refreshFeed(
  eth: JsonRpcProvider,
  base: JsonRpcProvider | null,
): Promise<FeedSnap> {
  await loadFeedSnap();
  const prev = feedCache;
  const ethInfo = await getLatestBlock(eth);
  // Resume gaps are capped at ~24h per chain: a long-stale persisted cursor
  // catches up on the last day (all the feed promises) instead of scanning
  // an unbounded range.
  const ethFrom = prev
    ? Math.max(prev.ethBlock + 1, ethInfo.number - ETH_INITIAL_LOOKBACK)
    : Math.max(0, ethInfo.number - ETH_INITIAL_LOOKBACK);

  // Cold start: seed the per-trade token lists from the full discovered sets
  // (so trades from every live index/basket appear). Warm polls reuse the
  // accumulated lists (+ new launches folded in below).
  let tokens = prev?.tokens?.length ? prev.tokens : (await baseIndexTokens()).all;
  let ethTokens = prev?.ethTokens?.length ? prev.ethTokens : (await ethIndexTokens()).all;
  let hoodTokens = prev?.hoodTokens?.length ? prev.hoodTokens : (await hoodIndexTokens()).all;
  let fresh: ActivityEvent[] = [];

  if (ethFrom <= ethInfo.number) {
    const r = await fetchEthEvents(eth, ethFrom, ethInfo.number, ethInfo.ts, ethTokens);
    fresh = fresh.concat(r.events);
    if (r.newTokens.length) ethTokens = [...new Set([...ethTokens, ...r.newTokens])];
  }

  let baseBlock = prev?.baseBlock ?? 0;
  if (base) {
    const baseInfo = await getLatestBlock(base);
    const baseFrom = prev
      ? Math.max(prev.baseBlock + 1, baseInfo.number - BASE_INITIAL_LOOKBACK)
      : Math.max(0, baseInfo.number - BASE_INITIAL_LOOKBACK);
    if (baseFrom <= baseInfo.number) {
      const r = await fetchBaseEvents(base, baseFrom, baseInfo.number, baseInfo.ts, tokens);
      fresh = fresh.concat(r.events);
      if (r.newTokens.length) tokens = [...new Set([...tokens, ...r.newTokens])];
    }
    baseBlock = baseInfo.number;
  }

  let hoodBlock = prev?.hoodBlock ?? 0;
  const hood = getHoodProvider();
  if (hood) {
    try {
      const hoodInfo = await getLatestBlock(hood);
      // A resumed cursor may catch up across a full day (chunked getLogs);
      // only a true cold start (no snapshot anywhere) uses the short fast-paint
      // lookback — persistence makes that a once-ever event, not every instance.
      const hoodFrom = prev?.hoodBlock
        ? Math.max(prev.hoodBlock + 1, hoodInfo.number - HOOD_DAY_BLOCKS)
        : Math.max(0, hoodInfo.number - HOOD_INITIAL_LOOKBACK);
      if (hoodFrom <= hoodInfo.number) {
        const r = await fetchHoodEvents(hood, hoodFrom, hoodInfo.number, hoodInfo.ts, hoodTokens);
        fresh = fresh.concat(r.events);
        if (r.newTokens.length) hoodTokens = [...new Set([...hoodTokens, ...r.newTokens])];
      }
      hoodBlock = hoodInfo.number;
    } catch {
      /* hood RPC hiccup — keep the block cursor, next poll retries */
    }
  }

  let merged = prev?.events ?? [];
  if (fresh.length) {
    const seen = new Set(merged.map((e) => e.id));
    const add = fresh.filter((e) => !seen.has(e.id));
    const byTime = (a: ActivityEvent, b: ActivityEvent) =>
      b.ts - a.ts || (b.blockNumber ?? 0) - (a.blockNumber ?? 0);
    const combined = [...add, ...merged].sort(byTime);
    // Pool LP-fee events fire constantly and would bury everything — newest 25
    // only. Basket trades and the rare kinds (launches/burns/harvests) keep the
    // WHOLE 24h window (generous safety caps), with a small newest-N floor so a
    // quiet week still shows the most recent activity instead of an empty card.
    const dayAgo = Date.now() - FEED_WINDOW_MS;
    const poolFees = combined.filter((e) => e.kind === "fee" && e.tradeUsd == null).slice(0, 25);
    const tradesAll = combined.filter((e) => e.kind === "fee" && e.tradeUsd != null);
    const tradesDay = tradesAll.filter((e) => e.ts >= dayAgo).slice(0, 400);
    const trades = tradesDay.length >= 10 ? tradesDay : tradesAll.slice(0, 10);
    const restAll = combined.filter((e) => e.kind !== "fee");
    const restDay = restAll.filter((e) => e.ts >= dayAgo).slice(0, 100);
    const rest = restDay.length >= 12 ? restDay : restAll.slice(0, 12);
    merged = [...poolFees, ...trades, ...rest].sort(byTime).slice(0, MAX_BUFFER);
  }

  feedCache = { ethBlock: ethInfo.number, baseBlock, hoodBlock, events: merged, tokens, ethTokens, hoodTokens, at: Date.now() };
  await persistFeedSnap(feedCache);
  return feedCache;
}

export async function getLiveFeed(
  eth: JsonRpcProvider,
  base: JsonRpcProvider | null,
  sinceTs: number | null,
): Promise<{ newestTs: number; events: ActivityEvent[] }> {
  let snap: FeedSnap;
  if (feedCache && Date.now() - feedCache.at < LIVE_TTL_MS) {
    snap = feedCache;
  } else {
    if (!inflight) inflight = refreshFeed(eth, base).finally(() => { inflight = null; });
    snap = (await inflight)!;
  }
  // Return the full recent buffer every poll; the client dedupes by event id.
  // (Robust against timestamp drift from estimated block times.)
  void sinceTs;
  const newestTs = snap.events.length ? snap.events[0].ts : Date.now();
  return { newestTs, events: snap.events };
}

// ── Historical feed (per-kind, cached) ─────────────────────────────────────────
// The live buffer only holds the most-recent events. When a viewer filters to a
// rare-but-interesting kind (burns, launches, yield) we serve the *full* on-chain
// history so e.g. the Burns tab shows every buy-and-burn ever, not just the last
// few. Voluminous kinds (fees) are intentionally excluded — they stay buffer-only.
export type HistoryKind = "burn" | "launch" | "harvest";
export function isHistoryKind(k: string): k is HistoryKind {
  return k === "burn" || k === "launch" || k === "harvest";
}

const historyCache: Record<string, { at: number; events: ActivityEvent[] }> = {};
const HISTORY_TTL_MS = 180_000; // 3 min — history changes slowly
const HISTORY_MAX = 250;
type BlockInfo = { number: number; ts: number };
type LogQuery = { address: string | string[]; topics: (string | null | string[])[] };

async function getLogsChunked(
  provider: JsonRpcProvider,
  params: LogQuery,
  from: number,
  to: number,
  chunk = 500_000,
): Promise<Log[]> {
  const out: Log[] = [];
  for (let s = from; s <= to; s += chunk) {
    const e = Math.min(s + chunk - 1, to);
    const part = await provider.getLogs({ ...params, fromBlock: s, toBlock: e }).catch(() => [] as Log[]);
    out.push(...part);
  }
  return out;
}

// All ETH-side buy-and-burns (Transfer → dEaD), attributed by sender. Skips the
// L1 bridge burner — those are represented by the Base bridge events instead.
async function getEthBurnHistory(eth: JsonRpcProvider, info: BlockInfo): Promise<ActivityEvent[]> {
  const logs = PRISM_LIVE
    ? await getLogsChunked(eth, { address: PRISM, topics: [TOPIC.transfer, null, TOPIC_DEAD] }, PRISM_POOL_FROM_BLOCK, info.number)
    : ([] as Log[]);
  const tsMap = blockTimestamps(logs.map((l) => l.blockNumber), info.number, info.ts, ETH_SECONDS_PER_BLOCK);
  // Which of these burns were driven by the L1 burner (Spectrum fees) rather than
  // by the pool's own 20% PRISM-side slice? The sender cannot tell them apart: the
  // burner buys through the v4 pool, so its Transfer → dEaD also has the PoolManager
  // as sender. The transaction can — a burn whose tx touched the burner is the
  // burner's. Matched on tx hash, not on the burner's event signature, because
  // TOPIC.prismBurnedL1 is a guess that does not match the deployed contract.
  const burnerTxs = new Set<string>();
  if (/^0x[a-fA-F0-9]{40}$/.test(L1_PRISM_BURNER)) {
    try {
      const bl = await getLogsChunked(eth, { address: L1_PRISM_BURNER, topics: [] }, PRISM_POOL_FROM_BLOCK, info.number);
      for (const l of bl) burnerTxs.add(l.transactionHash.toLowerCase());
    } catch {
      /* attribution degrades to sender-only; never blocks the feed */
    }
  }
  const out: ActivityEvent[] = [];
  for (const l of logs) {
    const from = getAddress("0x" + l.topics[1].slice(26));
    const value = abi.decode(["uint256"], l.data)[0] as bigint;
    if (value === 0n) continue;
    const { source, note, baseOrigin } = attributeBurnSource(from, burnerTxs.has(l.transactionHash.toLowerCase()));
    out.push({
      id: `${l.transactionHash}:${l.index}`,
      kind: "burn",
      source,
      chain: baseOrigin ? "base" : "ethereum",
      ts: tsMap.get(l.blockNumber) ?? Date.now(),
      blockNumber: l.blockNumber,
      txHash: l.transactionHash,
      prism: num(value),
      actor: from,
      note,
    });
  }
  return out;
}

// All Base bridge-to-burn events (launch auctions + index fee bridges),
// covering both factory lineages' auction events.
async function getBaseBurnHistory(base: JsonRpcProvider, info: BlockInfo): Promise<ActivityEvent[]> {
  const from = Math.max(0, info.number - 1_500_000);
  const [auc, aucV2, idx] = await Promise.all([
    getLogsChunked(base, { address: SPECTRUM_BASE, topics: [TOPIC.auctionBridgedToBurn] }, from, info.number),
    SPECTRUM_V2.baseFactory
      ? getLogsChunked(base, { address: SPECTRUM_V2.baseFactory, topics: [TOPIC_V2.auctionBridgedToBurnV2] }, from, info.number)
      : Promise.resolve([] as Log[]),
    KNOWN_INDEX_TOKENS.length
      ? getLogsChunked(base, { address: KNOWN_INDEX_TOKENS, topics: [TOPIC.prismBurnBridged] }, from, info.number)
      : Promise.resolve([] as Log[]),
  ]);
  const tsMap = blockTimestamps([...auc, ...aucV2, ...idx].map((l) => l.blockNumber), info.number, info.ts, BASE_SECONDS_PER_BLOCK);
  const out: ActivityEvent[] = [];
  for (const l of auc) {
    const token = getAddress("0x" + l.topics[1].slice(26));
    const bridgedEth = abi.decode(["uint256", "uint256"], l.data)[0] as bigint;
    out.push({
      id: `${l.transactionHash}:${l.index}`,
      kind: "burn",
      source: "spectrum-auction",
      chain: "base",
      ts: tsMap.get(l.blockNumber) ?? Date.now(),
      blockNumber: l.blockNumber,
      txHash: l.transactionHash,
      eth: num(bridgedEth),
      actor: token,
      note: "Launch auction proceeds bridged to Ethereum to buy & burn PRISM",
    });
  }
  for (const l of aucV2) {
    const basket = getAddress("0x" + l.topics[1].slice(26));
    const bridgedEth = abi.decode(["uint256"], l.data)[0] as bigint;
    out.push({
      id: `${l.transactionHash}:${l.index}`,
      kind: "burn",
      source: "spectrum-auction",
      chain: "base",
      ts: tsMap.get(l.blockNumber) ?? Date.now(),
      blockNumber: l.blockNumber,
      txHash: l.transactionHash,
      eth: num(bridgedEth),
      actor: basket,
      note: "Launch auction proceeds bridged to Ethereum to buy & burn PRISM",
    });
  }
  for (const l of idx) {
    const ethBridged = abi.decode(["uint256", "uint256"], l.data)[1] as bigint;
    out.push({
      id: `${l.transactionHash}:${l.index}`,
      kind: "burn",
      source: "spectrum-index",
      chain: "base",
      ts: tsMap.get(l.blockNumber) ?? Date.now(),
      blockNumber: l.blockNumber,
      txHash: l.transactionHash,
      eth: num(ethBridged),
      actor: getAddress(l.address),
      note: "Basket revenue reached 1 ETH, bridged to Ethereum to buy & burn PRISM",
    });
  }
  return out;
}

// Every index/basket launch ever on one chain — the v1 factory (8-param
// Launched) and the V2 factory (7-param Launched) in one pass.
async function getLaunchHistory(
  provider: JsonRpcProvider,
  info: BlockInfo,
  factory: string | null,
  factoryV2: string | string[] | null,
  chain: "ethereum" | "base" | "robinhood",
  secondsPerBlock: number,
): Promise<ActivityEvent[]> {
  const from = Math.max(0, info.number - 1_500_000);
  // V2 launches never precede the chain's V2 floor — and the floor also encodes
  // the DISPLAY window for legacy factories (see SPECTRUM_LEGACY_FACTORIES): a
  // launch event from the hidden era must not surface in history while its
  // basket is deliberately not shown. DEFI (block 25,517,048) sits inside the
  // 1.5M lookback, so without this clamp it would.
  const fromV2 = Math.max(from, SPECTRUM_V2_FROM_BLOCK[chain]);
  const [logs, logsV2] = await Promise.all([
    factory
      ? getLogsChunked(provider, { address: factory, topics: [TOPIC.launched] }, from, info.number)
      : Promise.resolve([] as Log[]),
    factoryV2 && factoryV2.length
      ? getLogsChunked(provider, { address: factoryV2, topics: [TOPIC_V2.launched] }, fromV2, info.number)
      : Promise.resolve([] as Log[]),
  ]);
  const tsMap = blockTimestamps([...logs, ...logsV2].map((l) => l.blockNumber), info.number, info.ts, secondsPerBlock);
  const out: ActivityEvent[] = [];
  for (const l of logs) {
    try {
      const token = getAddress("0x" + l.topics[1].slice(26));
      const dec = abi.decode(["bytes32", "string", "string", "uint160", "uint256"], l.data);
      out.push({
        id: `${l.transactionHash}:${l.index}`,
        kind: "launch",
        source: "spectrum-index",
        chain,
        ts: tsMap.get(l.blockNumber) ?? Date.now(),
        blockNumber: l.blockNumber,
        txHash: l.transactionHash,
        eth: Number(formatEther(dec[4] as bigint)),
        label: dec[1] as string,
        symbol: dec[2] as string,
        actor: token,
        note:
          chain === "base"
            ? `${dec[1]} launched on Spectrum. 90% of the launch revenue burns PRISM`
            : `${dec[1]} launched on Spectrum (Ethereum)`,
      });
    } catch {
      /* skip malformed */
    }
  }
  for (const l of logsV2) {
    try {
      const basket = getAddress("0x" + l.topics[1].slice(26));
      const dec = abi.decode(["string", "string", "uint160", "uint256", "uint16"], l.data);
      out.push({
        id: `${l.transactionHash}:${l.index}`,
        kind: "launch",
        source: "spectrum-index",
        chain,
        ts: tsMap.get(l.blockNumber) ?? Date.now(),
        blockNumber: l.blockNumber,
        txHash: l.transactionHash,
        eth: Number(formatEther(dec[3] as bigint)),
        label: dec[0] as string,
        symbol: dec[1] as string,
        actor: basket,
        note: `${dec[0]} launched on Spectrum. 100% of the auction ETH buys & burns PRISM`,
      });
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

// All dstable yield distributions to holders.
async function getHarvestHistory(eth: JsonRpcProvider, info: BlockInfo): Promise<ActivityEvent[]> {
  const logs = await getLogsChunked(eth, { address: DSTABLE, topics: [TOPIC.yieldClaimed] }, PRISM_POOL_FROM_BLOCK, info.number);
  const tsMap = blockTimestamps(logs.map((l) => l.blockNumber), info.number, info.ts, ETH_SECONDS_PER_BLOCK);
  const out: ActivityEvent[] = [];
  for (const l of logs) {
    const holdersUsd = abi.decode(["uint256"], l.data)[0] as bigint;
    out.push({
      id: `${l.transactionHash}:${l.index}`,
      kind: "harvest",
      source: "dstable",
      chain: "ethereum",
      ts: tsMap.get(l.blockNumber) ?? Date.now(),
      blockNumber: l.blockNumber,
      txHash: l.transactionHash,
      usd: num(holdersUsd, 6),
      note: "Reserve revenue distributed to holders",
    });
  }
  return out;
}

export async function fetchHistory(
  kind: HistoryKind,
  eth: JsonRpcProvider,
  base: JsonRpcProvider | null,
): Promise<ActivityEvent[]> {
  const cached = historyCache[kind];
  if (cached && Date.now() - cached.at < HISTORY_TTL_MS) return cached.events;

  let events: ActivityEvent[] = [];
  try {
    if (kind === "burn") {
      const ethInfo = await getLatestBlock(eth);
      events = await getEthBurnHistory(eth, ethInfo);
      if (base) {
        const bInfo = await getLatestBlock(base);
        events = events.concat(await getBaseBurnHistory(base, bInfo));
      }
    } else if (kind === "launch") {
      const ethInfo = await getLatestBlock(eth);
      events = await getLaunchHistory(eth, ethInfo, SPECTRUM_ETH, [SPECTRUM_V2.ethFactory, ...SPECTRUM_LEGACY_FACTORIES.ethereum.map((f) => f.address)], "ethereum", ETH_SECONDS_PER_BLOCK);
      if (base) {
        const bInfo = await getLatestBlock(base);
        events = events.concat(await getLaunchHistory(base, bInfo, SPECTRUM_BASE, SPECTRUM_V2.baseFactory, "base", BASE_SECONDS_PER_BLOCK));
      }
      const hood = getHoodProvider();
      if (hood) {
        try {
          const hInfo = await getLatestBlock(hood);
          events = events.concat(await getLaunchHistory(hood, hInfo, null, SPECTRUM_V2.hoodFactory, "robinhood", HOOD_SECONDS_PER_BLOCK));
        } catch {
          /* hood RPC hiccup — history stays eth+base this pass */
        }
      }
    } else {
      const ethInfo = await getLatestBlock(eth);
      events = await getHarvestHistory(eth, ethInfo);
    }
  } catch (err) {
    console.error("[history] fetch failed:", kind, err);
  }

  events.sort((a, b) => b.ts - a.ts || (b.blockNumber ?? 0) - (a.blockNumber ?? 0));
  events = events.slice(0, HISTORY_MAX);
  historyCache[kind] = { at: Date.now(), events };
  return events;
}
