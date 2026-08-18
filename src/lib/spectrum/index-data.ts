import {
  JsonRpcProvider,
  Contract,
  formatUnits,
  type EventLog,
} from "ethers";
import { SPECTRUM_V2, SPECTRUM_V2_FROM_BLOCK, SPECTRUM_LEGACY_FACTORIES, SPECTRUM_V3_FACTORIES } from "@/lib/chain/constants";

// ─────────────────────────────────────────────────────────────────────────────
// Spectrum index-token data layer — Ethereum (chain 1) + Base (chain 8453).
//
// Spectrum index tokens have NO sample-able on-chain NAV view (exchangeRate() /
// totalReserveDstable() revert on a static eth_call), so we reconstruct NAV
// off-chain: read the basket + held balances on-chain, price each constituent
// (DexScreener, per chain, no key), and compute NAV = Σ(balance × price) / supply.
//
// Discovery: each chain's factory emits `Launched`; there's no enumeration view.
// We seed the known live ones and merge in any freshly launched indexes from logs.
// ─────────────────────────────────────────────────────────────────────────────

export type Chain = "ethereum" | "base" | "robinhood";

interface ChainCfg {
  chain: Chain;
  chainId: number;
  rpcUrl: () => string;
  factory: string;
  dstable: string;
  poolManager: string;
  weth: string;
  // dstable/ETH V4 pool id used to replicate the protocol's pool-quote pricing.
  // null → price at aggregate spot (factor = 1).
  dstableEthPoolId: string | null;
  // DexScreener chain slug for constituent pricing — null when DexScreener
  // doesn't index the chain (holdings show unpriced; the UI already degrades).
  dexSlug: string | null;
  seeds: string[];
}

const KEY = () => process.env.ALCHEMY_API_KEY;

// Factory addresses come from `SPECTRUM_V2` in chain/constants.ts and NOWHERE else.
// This file used to keep its own copy, which is how it kept pointing at the stale
// 2026-07-11 factories after the launch set was updated in constants: discovery is
// the layer that actually finds baskets, so a half-landed rotation shows an empty
// site while every address in constants looks correct. One source, one rotation.
// (constants already applies the SPECTRUM_V2_FACTORY_* env override.)

const BASE_CFG: ChainCfg = {
  chain: "base",
  chainId: 8453,
  rpcUrl: () => process.env.BASE_RPC_URL || (KEY() ? `https://base-mainnet.g.alchemy.com/v2/${KEY()}` : "https://base-rpc.publicnode.com"),
  factory: SPECTRUM_V2.baseFactory,
  dstable: "0x51f2817B06DE142021FBFf00Ac9B56ad84e84088",
  poolManager: "0x498581fF718922c3f8e6A244956aF099B2652b2b",
  weth: "0x4200000000000000000000000000000000000006",
  dstableEthPoolId: "0x861eaaed4ebff97b6b1b9bb4d30e1774b2dc5e51718bf2e463aa115f69338e91",
  dexSlug: "base",
  seeds: [], // v1 seeds retired — baskets auto-discover from the V2 factory (fresh start at launch)
};

const ETH_CFG: ChainCfg = {
  chain: "ethereum",
  chainId: 1,
  rpcUrl: () => process.env.RPC_URL || (KEY() ? `https://eth-mainnet.g.alchemy.com/v2/${KEY()}` : "https://ethereum-rpc.publicnode.com"),
  factory: SPECTRUM_V2.ethFactory,
  dstable: "0x05E32dC43d0c4B6BfF1976714717f12EBA8e8088",
  poolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
  weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  dstableEthPoolId: null, // priced at aggregate spot until the ETH dstable/ETH pool id is wired
  dexSlug: "ethereum",
  seeds: [], // v1 seeds retired — baskets auto-discover from the V2 factory (fresh start at launch)
};

// Robinhood Chain (4663) — Arbitrum Orbit L2, ETH gas. RPC verified live
// (eth_chainId → 0x1237). No dstable / V4 PoolManager deployment there, but
// DexScreener DOES cover the chain (slug "robinhood", verified live 2026-07-11)
// → constituents price normally.
const HOOD_CFG: ChainCfg = {
  chain: "robinhood",
  chainId: 4663,
  rpcUrl: () => process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com/rpc",
  factory: SPECTRUM_V2.hoodFactory,
  dstable: "", // not deployed on Robinhood — never matches a constituent
  poolManager: "",
  weth: "",
  dstableEthPoolId: null,
  dexSlug: "robinhood",
  seeds: [],
};

const CHAINS: ChainCfg[] = [ETH_CFG, BASE_CFG, HOOD_CFG];

const INDEX_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function effectiveSupply() view returns (uint256)",
  "function basketLength() view returns (uint256)",
  "function basket(uint256) view returns (address asset, uint8 venue, (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) ethPool, uint24 v3Fee, address v2Pair, uint16 weight, uint8 decimals)",
  "function totalHeld(address) view returns (uint256)",
];
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];
// V2 factory deploy event (spectrum-contracts). The retired v1/v4 lineage used a
// different Launched signature; discovery now targets the V2 factory only.
const FACTORY_ABI = [
  "event Launched(address indexed basket, address indexed deployer, string name, string symbol, uint160 startSqrtPriceX96, uint256 ethPaid, uint16 basketFeeBps)",
];

const providerCache = new Map<number, JsonRpcProvider>();
function providerFor(cfg: ChainCfg): JsonRpcProvider {
  let p = providerCache.get(cfg.chainId);
  if (!p) {
    p = new JsonRpcProvider(cfg.rpcUrl(), cfg.chainId, { staticNetwork: true });
    providerCache.set(cfg.chainId, p);
  }
  return p;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface Holding {
  asset: string;
  symbol: string;
  name: string;
  decimals: number;
  targetWeightPct: number;
  balance: number;
  priceUsd: number;
  valueUsd: number;
  liveWeightPct: number;
  change24hPct: number | null;
  priced: boolean;
  series: NavPoint[];
}

export interface NavPoint {
  time: number;
  value: number;
}

export interface IndexData {
  address: string;
  chain: Chain;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: number;
  aumUsd: number;
  navPerToken: number;
  spotUsdNav: number;
  dstableUsd: number | null;
  change24hPct: number | null;
  holdings: Holding[];
  navSeries: NavPoint[];
  pricedCount: number;
  totalCount: number;
  inceptionTs: number | null;
  ageHours: number | null;
  updatedAt: string;
}

export interface IndexSummary {
  address: string;
  chain: Chain;
  name: string;
  symbol: string;
  basketLength: number;
  navPerToken: number;
  aumUsd: number;
  change24hPct: number | null;
  pricedCount: number;
  top: { address: string; symbol: string; weightPct: number }[];
  navSeries: NavPoint[];
}

// ── DexScreener pricing (per chain, no key) ──────────────────────────────────

interface DexPair {
  baseToken?: { address?: string; symbol?: string; name?: string };
  priceUsd?: string | null;
  priceChange?: { h1?: number; h6?: number; h24?: number };
  liquidity?: { usd?: number };
}

export async function fetchDexPrices(addresses: string[], slug: string | null): Promise<Map<string, DexPair>> {
  const out = new Map<string, DexPair>();
  if (addresses.length === 0 || !slug) return out; // no DexScreener coverage → unpriced
  const url = `https://api.dexscreener.com/tokens/v1/${slug}/${addresses.join(",")}`;
  try {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) return out;
    const pairs = (await r.json()) as DexPair[];
    for (const p of pairs) {
      const a = p.baseToken?.address?.toLowerCase();
      if (!a) continue;
      const prev = out.get(a);
      if (!prev || (p.liquidity?.usd ?? 0) > (prev.liquidity?.usd ?? 0)) out.set(a, p);
    }
  } catch {
    /* leave map empty; caller treats as unpriced */
  }
  return out;
}

function priceAt(now: number, ch1: number, ch6: number, ch24: number, hoursAgo: number): number {
  const anchors: [number, number][] = [
    [24, 1 / (1 + (ch24 || 0) / 100)],
    [6, 1 / (1 + (ch6 || 0) / 100)],
    [1, 1 / (1 + (ch1 || 0) / 100)],
    [0, 1],
  ];
  if (hoursAgo >= 24) return now * anchors[0][1];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [h0, f0] = anchors[i];
    const [h1, f1] = anchors[i + 1];
    if (hoursAgo <= h0 && hoursAgo >= h1) {
      const t = h0 === h1 ? 0 : (h0 - hoursAgo) / (h0 - h1);
      return now * (f0 + (f1 - f0) * t);
    }
  }
  return now;
}

function timeSteps(maxHours: number): number[] {
  const n = 14;
  const m = Math.min(Math.max(maxHours, 0.05), 24);
  return Array.from({ length: n + 1 }, (_, i) => +(m * (1 - i / n)).toFixed(4));
}

function buildAssetSeries(priceNow: number, ch1: number, ch6: number, ch24: number, maxHours: number): NavPoint[] {
  const nowSec = Math.floor(Date.now() / 1000);
  const steps = timeSteps(maxHours);
  const raw = steps.map((h) => priceAt(priceNow, ch1, ch6, ch24, h));
  const base = raw[0] || raw.find((v) => v > 0) || 1;
  return steps.map((h, i) => ({ time: nowSec - Math.round(h * 3600), value: base > 0 ? (raw[i] / base) * 100 : 100 }));
}

function buildNavSeries(
  items: { balance: number; priceUsd: number; ch1: number; ch6: number; ch24: number }[],
  supply: number,
  maxHours: number,
): NavPoint[] {
  if (supply <= 0) return [];
  const nowSec = Math.floor(Date.now() / 1000);
  return timeSteps(maxHours).map((h) => {
    let aum = 0;
    for (const it of items) aum += it.balance * priceAt(it.priceUsd, it.ch1, it.ch6, it.ch24, h);
    return { time: nowSec - Math.round(h * 3600), value: aum / supply };
  });
}

const inceptionCache = new Map<string, number>();
async function getInceptionTs(provider: JsonRpcProvider, cfg: ChainCfg, token: string): Promise<number | null> {
  const key = `${cfg.chain}:${token.toLowerCase()}`;
  const cached = inceptionCache.get(key);
  if (cached != null) return cached;
  try {
    const factory = new Contract(cfg.factory, FACTORY_ABI, provider);
    const latest = await provider.getBlockNumber();
    const WINDOW = 9000;
    for (let end = latest; end > latest - 80000 && end > 0; end -= WINDOW) {
      const start = Math.max(0, end - WINDOW + 1);
      try {
        const logs = await factory.queryFilter(factory.filters.Launched(token), start, end);
        if (logs.length > 0) {
          const blk = await provider.getBlock(logs[0].blockNumber);
          const ts = blk ? Number(blk.timestamp) : null;
          if (ts != null) inceptionCache.set(key, ts);
          return ts;
        }
      } catch {
        /* window failed — try the next one */
      }
    }
    return null;
  } catch {
    return null;
  }
}

// NOTE: we deliberately do NOT compute a dstable/ETH pool "factor" here. The
// canonical Spectrum index price is the aggregate-spot NAV (Σ held × real USD
// price ÷ effectiveSupply); the settlement pool can quote ETH well off market
// (~13% on Base), and that gap is a stale-pool artifact, not real value.

function weightedChange(holdings: Holding[], aumUsd: number): number | null {
  if (aumUsd <= 0) return null;
  let acc = 0;
  let priced = 0;
  for (const h of holdings) {
    if (h.change24hPct == null || !h.priced) continue;
    acc += (h.valueUsd / aumUsd) * h.change24hPct;
    priced += h.valueUsd;
  }
  return priced > 0 ? acc : null;
}

// ── Core reads ───────────────────────────────────────────────────────────────

async function getIndexDataForChain(
  address: string,
  cfg: ChainCfg,
  opts?: { scanInception?: boolean },
): Promise<IndexData> {
  const provider = providerFor(cfg);
  const idx = new Contract(address, INDEX_ABI, provider);

  const [name, symbol, decimalsRaw, supplyRaw, lenRaw] = await Promise.all([
    idx.name() as Promise<string>,
    idx.symbol() as Promise<string>,
    idx.decimals() as Promise<bigint>,
    // NAV denominator = effectiveSupply() (redeemable supply; excludes tokens pending
    // burn). Fall back to totalSupply() for any index that doesn't expose it.
    (idx.effectiveSupply() as Promise<bigint>).catch(() => idx.totalSupply() as Promise<bigint>),
    idx.basketLength() as Promise<bigint>,
  ]);

  const decimals = Number(decimalsRaw);
  const len = Number(lenRaw);

  const entries = await Promise.all(Array.from({ length: len }, (_, i) => idx.basket(i) as Promise<unknown[]>));
  const assets = entries.map((e) => String(e[0]));
  const targetBps = entries.map((e) => Number(e[5]));
  const assetDecimals = entries.map((e) => Number(e[6]));

  // Held backing = totalHeld(asset): idle + any parked in a yield "pook". balanceOf
  // undercounts parked backing, so prefer totalHeld and fall back to balanceOf.
  const balances = await Promise.all(
    assets.map((a, i) =>
      (idx.totalHeld(a) as Promise<bigint>)
        .catch(() => new Contract(a, ERC20_ABI, provider).balanceOf(address) as Promise<bigint>)
        .then((b) => Number(formatUnits(b, assetDecimals[i])))
        .catch(() => 0),
    ),
  );

  // The list view skips this: inception isn't shown in the summary, and finding
  // it is a backward log-scan (up to ~9 getLogs per index). Skipping it across
  // ~14 indexes removes the biggest cold-start RPC burst. The detail page (which
  // shows age + a since-launch chart window) still resolves it.
  const inceptionTs = opts?.scanInception === false ? null : await getInceptionTs(provider, cfg, address);
  const ageHours = inceptionTs != null ? (Date.now() / 1000 - inceptionTs) / 3600 : null;
  const maxHours = ageHours != null ? Math.min(Math.max(ageHours, 0.05), 24) : 24;

  const dex = await fetchDexPrices(assets.map((a) => a.toLowerCase()), cfg.dexSlug);
  const DSTABLE = cfg.dstable.toLowerCase();

  const holdings: Holding[] = assets.map((a, i) => {
    const low = a.toLowerCase();
    const p = dex.get(low);
    let priceUsd = p?.priceUsd ? parseFloat(p.priceUsd) : 0;
    if (low === DSTABLE && !priceUsd) priceUsd = 1; // dstable cash buffer ≈ $1
    const balance = balances[i];
    const valueUsd = balance * priceUsd;
    return {
      asset: a,
      symbol: p?.baseToken?.symbol ?? (low === DSTABLE ? "dstable" : "?"),
      name: p?.baseToken?.name ?? "",
      decimals: assetDecimals[i],
      targetWeightPct: targetBps[i] / 100,
      balance,
      priceUsd,
      valueUsd,
      liveWeightPct: 0,
      change24hPct: p?.priceChange?.h24 ?? null,
      priced: priceUsd > 0,
      series: buildAssetSeries(priceUsd, p?.priceChange?.h1 ?? 0, p?.priceChange?.h6 ?? 0, p?.priceChange?.h24 ?? 0, maxHours),
    };
  });

  const aumUsd = holdings.reduce((s, h) => s + h.valueUsd, 0);
  for (const h of holdings) h.liveWeightPct = aumUsd > 0 ? (h.valueUsd / aumUsd) * 100 : 0;

  // Canonical price = aggregate-spot NAV per token = AUM ÷ effectiveSupply. No
  // dstable/ETH pool factor. spotUsdNav mirrors navPerToken (kept for back-compat).
  const totalSupply = Number(formatUnits(supplyRaw, decimals));
  const navPerToken = totalSupply > 0 ? aumUsd / totalSupply : 0;
  const spotUsdNav = navPerToken;

  const navSeries = buildNavSeries(
    holdings.map((h, i) => {
      const p = dex.get(assets[i].toLowerCase());
      return {
        balance: h.balance,
        priceUsd: h.priceUsd,
        ch1: p?.priceChange?.h1 ?? 0,
        ch6: p?.priceChange?.h6 ?? 0,
        ch24: p?.priceChange?.h24 ?? 0,
      };
    }),
    totalSupply,
    maxHours,
  );

  return {
    address,
    chain: cfg.chain,
    name,
    symbol,
    decimals,
    totalSupply,
    aumUsd,
    navPerToken,
    spotUsdNav,
    dstableUsd: null,
    change24hPct: weightedChange(holdings, aumUsd),
    holdings,
    navSeries,
    pricedCount: holdings.filter((h) => h.priced).length,
    totalCount: holdings.length,
    inceptionTs,
    ageHours,
    updatedAt: new Date().toISOString(),
  };
}

// Resolve which chain an index address lives on (seed lists first; else probe code).
async function cfgForAddress(address: string): Promise<ChainCfg> {
  const low = address.toLowerCase();
  for (const cfg of CHAINS) if (cfg.seeds.some((s) => s.toLowerCase() === low)) return cfg;
  for (const cfg of CHAINS) {
    const code = await providerFor(cfg).getCode(address).catch(() => "0x");
    if (code && code !== "0x") return cfg;
  }
  return BASE_CFG;
}

export async function getIndexData(address: string): Promise<IndexData> {
  const cfg = await cfgForAddress(address);
  return getIndexDataForChain(address, cfg);
}

// Bounded-concurrency map: caps how many index reads hit the RPC at once. The
// list scans every index's basket + balances, and firing them all in parallel is
// what spikes Alchemy's CU/s (peak throughput). Spreading them over a moment
// keeps total compute the same but flattens the peak — and it's behind a 5-min
// cache + single-flight, so the slightly-longer scan only runs once per window.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// Discovery scans the factory's Launched events — the ONLY enumeration there is.
// Any sliding block window ages launches out eventually: on Robinhood's 0.1s
// blocks the old "wide" 1.5M-block window covered only ~42 hours, so live
// baskets vanished from the grid two days after launch (RMEME/RHTEST1,
// 2026-07-13). Discovery now scans from each factory's DEPLOY floor (a launch
// cannot precede its factory), keeps a blob-persisted registry of found
// addresses + a scan cursor, and every later scan is incremental. A transient
// RPC failure serves the persisted set instead of an empty grid.
const DISCOVERY_CHUNK = 500_000;

interface DiscoverySnap {
  // v2 adds per-chain `legacy` registries (the 07-11 eth factory still receives
  // real launches). v1 snaps are discarded — a registry rebuild is one bounded
  // floor-to-head scan per factory.
  v: 2;
  chains: Partial<
    Record<
      Chain,
      {
        factory: string;
        cursor: number;
        addresses: string[];
        legacy?: Record<string, { cursor: number; addresses: string[] }>;
      }
    >
  >;
  savedAt: number;
}
type BlobJson = { get(k: string, o: { type: "json" }): Promise<unknown>; setJSON(k: string, v: unknown): Promise<void> };
async function discoveryBlob(): Promise<BlobJson | null> {
  try {
    const { getStore } = await import("@netlify/blobs");
    return getStore({ name: "prismbeat-stats", consistency: "eventual" }) as unknown as BlobJson;
  } catch {
    return null;
  }
}
let discovery: DiscoverySnap | null = null;
let discoveryLoaded = false;
async function loadDiscovery(): Promise<DiscoverySnap> {
  if (!discoveryLoaded) {
    discoveryLoaded = true;
    try {
      const blobs = await discoveryBlob();
      const snap = blobs ? ((await blobs.get("discovery", { type: "json" })) as DiscoverySnap | null) : null;
      if (snap && snap.v === 2 && snap.chains) discovery = snap;
    } catch {
      /* cold scan rebuilds */
    }
  }
  if (!discovery) discovery = { v: 2, chains: {}, savedAt: 0 };
  return discovery;
}
let discoveryLastPersist = 0;
async function persistDiscovery(): Promise<void> {
  if (!discovery || Date.now() - discoveryLastPersist < 60_000) return;
  discoveryLastPersist = Date.now();
  try {
    const blobs = await discoveryBlob();
    if (blobs) await blobs.setJSON("discovery", { ...discovery, savedAt: Date.now() } satisfies DiscoverySnap);
  } catch {
    /* best-effort */
  }
}

// Minimal stub for a discovered index we couldn't fully read (transient RPC).
// Keeping it in the list means the headline launch count never drops on a hiccup;
// aumUsd 0 keeps it out of the explorer (which filters to TVL > 0).
function emptyIndexSummary(address: string, chain: Chain): IndexSummary {
  return {
    address,
    chain,
    name: "",
    symbol: "",
    basketLength: 0,
    navPerToken: 0,
    aumUsd: 0,
    change24hPct: null,
    pricedCount: 0,
    top: [],
    navSeries: [],
  };
}

async function listIndexesForChain(cfg: ChainCfg): Promise<IndexSummary[]> {
  // v1 retired: until the V2 factory is wired, show no baskets (fresh start for V2).
  if (!cfg.factory) return [];
  const provider = providerFor(cfg);
  const addresses = new Set(cfg.seeds.map((a) => a.toLowerCase()));

  // Registry-backed discovery: the first scan ever covers deploy-floor → latest,
  // every later one only the new blocks. Keyed by factory so an env rotation
  // (a relaunch) resets cleanly instead of showing the old factory's baskets.
  const reg = await loadDiscovery();
  const floor = SPECTRUM_V2_FROM_BLOCK[cfg.chain];
  const prev = reg.chains[cfg.chain];
  const known =
    prev && prev.factory === cfg.factory.toLowerCase()
      ? prev
      : { factory: cfg.factory.toLowerCase(), cursor: floor - 1, addresses: [] as string[] };
  for (const a of known.addresses) addresses.add(a);

  try {
    const factory = new Contract(cfg.factory, FACTORY_ABI, provider);
    const latest = await provider.getBlockNumber();
    const start = Math.max(known.cursor + 1, floor);
    const found: string[] = [];
    for (let s = start; s <= latest; s += DISCOVERY_CHUNK) {
      const e = Math.min(s + DISCOVERY_CHUNK - 1, latest);
      // A failed chunk must THROW (no silent []): the cursor may not advance
      // past unscanned blocks, or a launch inside them disappears forever.
      const logs = await factory.queryFilter(factory.filters.Launched(), s, e);
      for (const l of logs) {
        const token = (l as EventLog).args?.[0] as string | undefined;
        if (token) found.push(token.toLowerCase());
      }
    }
    for (const a of found) addresses.add(a);

    // Additional factories: same registry discipline, own cursor each, own
    // floor each. Two additive generations ride this loop — the LEGACY eth
    // factory (older real baskets) and the GEN-3 production factories (fresh
    // registries from the 2026-08-16 ceremony, wired BEFORE their first
    // community launch so it can never be invisible — the RHTEST1 lesson).
    // SPECTRUM_V2 stays the chain's primary factory until the kit re-seats.
    const legacyReg: Record<string, { cursor: number; addresses: string[] }> = { ...(prev?.legacy ?? {}) };
    for (const lf of [...SPECTRUM_LEGACY_FACTORIES[cfg.chain], ...SPECTRUM_V3_FACTORIES[cfg.chain]]) {
      const key = lf.address.toLowerCase();
      const lKnown = legacyReg[key] ?? { cursor: lf.floor - 1, addresses: [] as string[] };
      for (const a of lKnown.addresses) addresses.add(a);
      const lFactory = new Contract(lf.address, FACTORY_ABI, provider);
      const lFound: string[] = [];
      for (let s = Math.max(lKnown.cursor + 1, lf.floor); s <= latest; s += DISCOVERY_CHUNK) {
        const e = Math.min(s + DISCOVERY_CHUNK - 1, latest);
        const logs = await lFactory.queryFilter(lFactory.filters.Launched(), s, e);
        for (const l of logs) {
          const token = (l as EventLog).args?.[0] as string | undefined;
          if (token) lFound.push(token.toLowerCase());
        }
      }
      for (const a of lFound) addresses.add(a);
      legacyReg[key] = { cursor: latest, addresses: [...new Set([...lKnown.addresses, ...lFound])] };
    }

    reg.chains[cfg.chain] = {
      factory: known.factory,
      cursor: latest,
      addresses: [...new Set([...known.addresses, ...found])],
      legacy: legacyReg,
    };
    void persistDiscovery();
  } catch {
    /* transient RPC — serve the known set; cursor unchanged, the gap rescans next time */
  }

  const list = await mapLimit(Array.from(addresses), 4, async (addr): Promise<IndexSummary> => {
    try {
      const d = await getIndexDataForChain(addr, cfg, { scanInception: false });
      // Every launch counts in the headline figure, including empty / 0-TVL ones.
      // The explorer route hides aumUsd <= 0, so users never see a broken or empty
      // pool — but the dashboard count still reflects every index that launched.
      return {
        address: d.address,
        chain: d.chain,
        name: d.name,
        symbol: d.symbol,
        basketLength: d.totalCount,
        navPerToken: d.navPerToken,
        aumUsd: d.aumUsd,
        change24hPct: d.change24hPct,
        pricedCount: d.pricedCount,
        top: [...d.holdings]
          .sort((a, b) => b.valueUsd - a.valueUsd)
          .slice(0, 6)
          .map((h) => ({ address: h.asset, symbol: h.symbol, weightPct: h.liveWeightPct })),
        navSeries: d.navSeries,
      };
    } catch {
      return emptyIndexSummary(addr, cfg.chain);
    }
  });
  return list;
}

// Shared, time-boxed cache so every caller (explorer route + the dashboard
// stats path) collapses onto one cross-chain scan per interval. Empty results
// (a total RPC failure) are not cached, so callers retry instead of pinning $0.
// This is by far the heaviest scan (a basket + balance read for every index, on
// both chains), so it's the main RPC-cost lever: a 5-min TTL plus single-flight
// means 100 concurrent viewers — and repeated cold-instance hits — collapse onto
// ONE scan per 5 min instead of each re-fanning hundreds of eth_calls. New index
// launches still appear in the live feed instantly (the feed watches Launched
// every poll); only the aggregate list/count lags up to the TTL.
let listCache: { at: number; data: IndexSummary[] } | null = null;
let listInflight: Promise<IndexSummary[]> | null = null;
const LIST_TTL_MS = Number(process.env.INDEX_LIST_TTL_MS) || 300_000;

export async function listIndexes(): Promise<IndexSummary[]> {
  if (listCache && Date.now() - listCache.at < LIST_TTL_MS) return listCache.data;
  if (listInflight) return listInflight;
  listInflight = (async () => {
    const perChain = await Promise.all(CHAINS.map((cfg) => listIndexesForChain(cfg).catch(() => [] as IndexSummary[])));
    const data = perChain.flat().sort((a, b) => b.aumUsd - a.aumUsd);
    if (data.length) listCache = { at: Date.now(), data };
    return data;
  })().finally(() => {
    listInflight = null;
  });
  return listInflight;
}
