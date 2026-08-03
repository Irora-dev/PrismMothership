import { RANGES, type ActivityEvent, type BasketChartsPayload, type BasketPrevTotals, type Chain, type ChartsPayload, type ChartsPrevTotals, type EventKind, type EventSource, type PulseStats, type RangeKey } from "./types";
import { PRISM_CAP } from "../chain/constants";

// A fully deterministic, time-seeded activity simulator. Given any time window
// it reproduces the exact same events — so it is stateless across server
// instances and feels like one continuous, living stream. This is what runs
// until a real RPC endpoint is configured, at which point the API swaps it out.

const BUCKET_MS = 1000; // one simulation step per second
const DEMO_ETH_USD = 3400; // notional only, for $ display in demo mode

// deterministic PRNG
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashInt(n: number): number {
  let h = n ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function pseudoHex(rng: () => number, len: number): string {
  const chars = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(rng() * 16)];
  return s;
}

const INDEX_META: { name: string; ticker: string }[] = [
  { name: "AI Majors", ticker: "AIMAJ" },
  { name: "DeFi Blue Chips", ticker: "DEFI" },
  { name: "RWA Basket", ticker: "RWA" },
  { name: "L2 Leaders", ticker: "L2" },
  { name: "Liquid Staking", ticker: "LSD" },
  { name: "GameFi 10", ticker: "GAME" },
  { name: "Meme Basket", ticker: "MEME" },
  { name: "Privacy Suite", ticker: "PRIV" },
  { name: "Restaking Basket", ticker: "RSTK" },
  { name: "Stablecoin Basket", ticker: "STBL" },
];

// pick a kind from a weighted distribution.
// Holder revenue dominates (two flavors: Base index fees + mainnet PRISM LP fees);
// buy-and-burns are now rare.
function pickKind(r: number): { kind: EventKind; source: EventSource; chain: Chain } {
  if (r < 0.28) return { kind: "fee", source: "spectrum-index", chain: "base" };
  if (r < 0.5) return { kind: "fee", source: "prism-pool", chain: "ethereum" };
  if (r < 0.6) return { kind: "fee", source: "prism-pool", chain: "ethereum" };
  if (r < 0.72) return { kind: "fee", source: "spectrum-index", chain: "base" };
  if (r < 0.79) return { kind: "nft", source: "prism-pool", chain: "ethereum" };
  if (r < 0.85) return { kind: "retire", source: "prism-pool", chain: "ethereum" };
  if (r < 0.9) return { kind: "harvest", source: "dstable", chain: "ethereum" };
  if (r < 0.96) {
    const s = (r - 0.9) / 0.06;
    // rarest of all: the weekly bridged "big burn" from Base
    if (s < 0.18) return { kind: "burn", source: "spectrum-index", chain: "base" };
    // otherwise an ETH-side burn: dstable yield or a Spectrum deploy
    const source: EventSource = s < 0.6 ? "dstable" : "spectrum-auction";
    return { kind: "burn", source, chain: "ethereum" };
  }
  return { kind: "launch", source: "spectrum-index", chain: "ethereum" };
}

// log-ish magnitude in [min,max]
function logAmount(rng: () => number, min: number, max: number): number {
  const t = Math.pow(rng(), 2.2); // skew toward small
  return min + t * (max - min);
}

function makeEvent(bucket: number, idx: number, ts: number): ActivityEvent {
  const rng = mulberry32(hashInt(bucket * 31 + idx * 2654435761));
  const { kind, source, chain } = pickKind(rng());
  const id = `sim:${bucket}:${idx}`;
  const txHash = "0x" + pseudoHex(rng, 64);
  const actor = "0x" + pseudoHex(rng, 40);

  const base: ActivityEvent = { id, kind, source, chain, ts, txHash };

  switch (kind) {
    case "fee": {
      // the ETH yield distributed to holders (a fee, not a swap size)
      const eth = logAmount(rng, 0.0004, 0.16);
      // baskets set their own fee (1–3%, V2 model; v1 flat 1%) — back out the trade size
      const tradeEth = eth / (0.01 + rng() * 0.02);
      if (chain === "base") {
        const meta = INDEX_META[Math.floor(rng() * INDEX_META.length)];
        const side = rng() < 0.62 ? "buy" : "sell";
        return {
          ...base,
          eth,
          tradeEth,
          usd: eth * DEMO_ETH_USD,
          tradeUsd: tradeEth * DEMO_ETH_USD,
          side,
          label: meta.name,
          symbol: meta.ticker,
          note: `${meta.name} basket fees paid out to PRISM holders on Base`,
        };
      }
      return {
        ...base,
        eth,
        tradeEth,
        usd: eth * DEMO_ETH_USD,
        note: "PRISM pool LP fees distributed to holders",
      };
    }
    case "nft": {
      return {
        ...base,
        prism: 1,
        actor,
        note: "A new Prism NFT was minted. Fresh seed and art.",
      };
    }
    case "burn": {
      const isBase = chain === "base";
      // the bridged Base burn is the big one; ETH-side burns are smaller
      const prism = isBase ? logAmount(rng, 3, 14) : logAmount(rng, 0.02, 2.6);
      const eth = prism * logAmount(rng, 0.18, 0.42);
      return {
        ...base,
        prism,
        eth,
        usd: eth * DEMO_ETH_USD,
        note: isBase
          ? "Bridged Base revenue bought and burned PRISM. The weekly big burn."
          : source === "dstable"
            ? "Reserve revenue bought PRISM and burned it"
            : "An ETH Spectrum deploy bought PRISM and burned it",
      };
    }
    case "harvest": {
      const eth = logAmount(rng, 0.05, 4);
      return {
        ...base,
        eth,
        usd: eth * DEMO_ETH_USD,
        note: "Reserve revenue harvested from Aave. A slice is headed for a burn.",
      };
    }
    case "retire": {
      return {
        ...base,
        prism: 1,
        actor,
        note: "A Prism NFT crossed an integer down and was retired forever",
      };
    }
    case "launch": {
      const eth = logAmount(rng, 0.1, 1);
      const meta = INDEX_META[Math.floor(rng() * INDEX_META.length)];
      return {
        ...base,
        eth,
        usd: eth * DEMO_ETH_USD,
        label: meta.name,
        symbol: meta.ticker,
        actor,
        note: `${meta.name} launched on Spectrum. The deploy ETH buys and burns PRISM.`,
      };
    }
  }
}

// events that "occur" within one 1s bucket (0, 1, or 2)
function eventsInBucket(bucket: number): ActivityEvent[] {
  const rng = mulberry32(hashInt(bucket));
  const ts = bucket * BUCKET_MS + Math.floor(rng() * BUCKET_MS);
  const out: ActivityEvent[] = [];
  if (rng() < 0.22) out.push(makeEvent(bucket, 0, ts));
  if (rng() < 0.05) out.push(makeEvent(bucket, 1, ts + 120));
  return out;
}

/** Events strictly after `sinceMs`, up to `nowMs`, newest-first. */
export function simulateEvents(
  sinceMs: number,
  nowMs: number,
  maxEvents = 60,
): ActivityEvent[] {
  const startBucket = Math.floor(sinceMs / BUCKET_MS) + 1;
  const endBucket = Math.floor(nowMs / BUCKET_MS);
  const out: ActivityEvent[] = [];
  for (let b = startBucket; b <= endBucket; b++) {
    for (const e of eventsInBucket(b)) {
      if (e.ts > sinceMs && e.ts <= nowMs) out.push(e);
    }
  }
  out.sort((a, b) => b.ts - a.ts);
  return out.slice(0, maxEvents);
}

/** Walk backwards from now to assemble an initial backlog of `count` events. */
export function simulateInitial(nowMs: number, count = 24): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  let b = Math.floor(nowMs / BUCKET_MS);
  let guard = 0;
  while (out.length < count && guard < 5000) {
    for (const e of eventsInBucket(b)) {
      if (e.ts <= nowMs) out.push(e);
    }
    b--;
    guard++;
  }
  out.sort((a, b2) => b2.ts - a.ts);
  return out.slice(0, count);
}

// A stable demo epoch so the slow-moving aggregate curves are reproducible.
const SIM_EPOCH = Date.UTC(2026, 4, 1); // 2026-05-01

export function simulateStats(nowMs: number): PulseStats {
  const elapsedSec = Math.max(0, (nowMs - SIM_EPOCH) / 1000);
  // ~7 PRISM/day burned to dEaD, with gentle day-to-day jitter
  const dayIdx = Math.floor(elapsedSec / 86400);
  const dayJit = mulberry32(hashInt(dayIdx + 7))() * 0.6 + 0.7;
  const totalBurned = 142 + elapsedSec * 0.00008 * dayJit;
  const supply = Math.max(PRISM_CAP - totalBurned - 760, 0); // some never minted
  const liveNfts = Math.floor(supply * 0.92);

  // count today's events by sampling the last 24h analytically
  const prismBurnedToday = 6.4 + mulberry32(hashInt(dayIdx))() * 2.2;
  const burnsToday = Math.floor(180 + mulberry32(hashInt(dayIdx + 3))() * 90);
  const feeEventsToday = Math.floor(620 + mulberry32(hashInt(dayIdx + 11))() * 280);
  const ethVolumeToday = 240 + mulberry32(hashInt(dayIdx + 17))() * 180;
  // fees streamed to holders: mainnet pool LP fees (1% of volume) + Base index fees
  const baseIndexFees = 2.1 + mulberry32(hashInt(dayIdx + 23))() * 3.4;
  const feesToHolders24h = ethVolumeToday * 0.01 + baseIndexFees;
  const feesToHolders7d = feesToHolders24h * (6.2 + mulberry32(hashInt(dayIdx + 29))() * 1.7);
  const days = elapsedSec / 86400;
  const feesToHoldersTotal = 60 + days * (4.4 + mulberry32(hashInt(dayIdx + 31))() * 1.8);

  // Base 10% cut pooling on the 7-day bridge, then a big burn resets it
  const CYCLE = 7 * 86400;
  const cyclePos = elapsedSec % CYCLE;
  const dailyBridge = 3.2 + mulberry32(hashInt(dayIdx + 37))() * 2.6;
  const bridgePendingEth = dailyBridge * (cyclePos / 86400);
  const bridgeNextBurnTs = nowMs + (CYCLE - cyclePos) * 1000;
  const indexFeesTotal = 8 + days * (0.7 + mulberry32(hashInt(dayIdx + 41))() * 0.5);

  return {
    mode: "demo",
    totalBurned,
    supply,
    cap: PRISM_CAP,
    liveNfts,
    burnsToday,
    prismBurnedToday,
    feeEventsToday,
    ethVolumeToday,
    feesToHolders24h,
    feesToHolders7d,
    feesToHoldersTotal,
    feesEthTotal: feesToHoldersTotal / 2,
    feesPrismTotal: feesToHoldersTotal / 2 / 0.4,
    bridgePendingEth,
    bridgeNextBurnTs,
    ethUsd: 1900,
    indexCount: 9,
    indexFeesTotal,
    dstableSupply: 3200 + days * 20,
    dstableVolumeUsd: 440000 + days * 2400,
    dstableReserveUsd: 3800 + days * 20,
    dstableAaveApy: 0.034,
    eventsPerMin: 13 + mulberry32(hashInt(Math.floor(nowMs / 60000)))() * 6,
    lastBurnTs: nowMs - Math.floor(mulberry32(hashInt(Math.floor(nowMs / 5000)))() * 40000),
  };
}

// ── Charts page (demo mode) ───────────────────────────────────────────────────
// Deterministic time-bucketed series with a plausible shape: a diurnal cycle on
// trades/fees, rare launches, and occasional burn spikes. Same buckets in →
// same series out, so the page is stable across polls and server instances.

interface DemoBucket {
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

function demoBucket(t: number, bucketMs: number, i: number, buckets: number): DemoBucket {
  const rng = mulberry32(hashInt(Math.floor(t / bucketMs)));
  const hours = bucketMs / 3_600_000;
  // diurnal wave: busier in the US/EU overlap, quieter overnight
  const hourOfDay = new Date(t).getUTCHours();
  const cycle = 0.75 + 0.45 * Math.sin(((hourOfDay - 4) / 24) * Math.PI * 2);
  // slow growth across the window so long ranges trend up
  const growth = 0.7 + (0.6 * i) / buckets;

  const trades = Math.round(6.5 * hours * cycle * growth * (0.65 + rng() * 0.8));
  const buys = Math.round(trades * (0.52 + rng() * 0.2));
  const sells = Math.max(0, trades - buys);
  const volumeUsd = trades * (5_200 + rng() * 9_000);
  // per-side split tracks the buy/sell count ratio with a little wobble
  const buyShare = trades > 0 ? Math.min(0.95, Math.max(0.05, buys / trades + (rng() - 0.5) * 0.1)) : 0.5;
  const buyVolumeUsd = volumeUsd * buyShare;
  const feeRate = 0.01 + rng() * 0.02; // per-basket 1–3%
  const expected = (1.3 / 24) * hours; // launches ~1.3/day
  const spike = rng() < 0.06 * hours ? 2.5 + rng() * 6 : 0;
  return {
    launches: Math.floor(expected) + (rng() < expected % 1 ? 1 : 0),
    buys,
    sells,
    volumeUsd,
    buyVolumeUsd,
    sellVolumeUsd: volumeUsd - buyVolumeUsd,
    feesUsd: 340 * hours * cycle * growth * (0.6 + rng() * 0.9),
    burnedPrism: (7 / 24) * hours * (0.4 + rng() * 1.1) + spike,
    traders: Math.max(trades > 0 ? 1 : 0, Math.round(trades * (0.3 + rng() * 0.25))),
    basketBurnUsd: volumeUsd * feeRate * 0.1, // fixed 10% of the fee → PRISM
  };
}

const DEMO_TOP_BASKETS = ["BASEAI", "DEFI", "AIMAJ", "L2", "MEME", "RWA", "LSD", "PRIV"];

export function simulateCharts(range: RangeKey, nowMs: number): ChartsPayload {
  const cfg = RANGES[range];
  const bucketMs = cfg.bucketSec * 1000;
  // align to bucket boundaries so series don't shimmer between refetches
  const endMs = Math.floor(nowMs / bucketMs) * bucketMs;
  const startMs = endMs - cfg.buckets * bucketMs;

  const buckets: number[] = [];
  const rows: DemoBucket[] = [];
  for (let i = 0; i < cfg.buckets; i++) {
    const t = startMs + i * bucketMs;
    buckets.push(t);
    rows.push(demoBucket(t, bucketMs, i, cfg.buckets));
  }

  // the window before this one, for "vs prior period" deltas (skipped for 1y,
  // matching the live reader's scan bound)
  let prev: ChartsPrevTotals | null = null;
  if (range !== "1y") {
    prev = { launches: 0, buys: 0, sells: 0, volumeUsd: 0, buyVolumeUsd: 0, sellVolumeUsd: 0, feesUsd: 0, burnedPrism: 0, traders: 0, basketBurnUsd: 0 };
    for (let i = 0; i < cfg.buckets; i++) {
      const t = startMs - (cfg.buckets - i) * bucketMs;
      const b = demoBucket(t, bucketMs, i, cfg.buckets);
      prev.launches += b.launches;
      prev.buys += b.buys;
      prev.sells += b.sells;
      prev.volumeUsd += b.volumeUsd;
      prev.buyVolumeUsd += b.buyVolumeUsd;
      prev.sellVolumeUsd += b.sellVolumeUsd;
      prev.feesUsd += b.feesUsd;
      prev.burnedPrism += b.burnedPrism;
      prev.traders += b.traders;
      prev.basketBurnUsd += b.basketBurnUsd;
    }
    prev.traders = Math.round(prev.traders * 0.55); // wallets repeat across buckets
  }

  const stats = simulateStats(nowMs);
  const windowBurn = rows.reduce((a, b) => a + b.burnedPrism, 0);
  const volTotal = rows.reduce((a, b) => a + b.volumeUsd, 0);
  const shareRng = mulberry32(hashInt(Math.floor(nowMs / 86_400_000)));
  let remaining = 1;
  const topBaskets = DEMO_TOP_BASKETS.map((symbol, i) => {
    const share = i === DEMO_TOP_BASKETS.length - 1 ? remaining : remaining * (0.22 + shareRng() * 0.2);
    remaining -= share;
    return { address: demoBasketAddress(symbol), symbol, volumeUsd: volTotal * share };
  });
  // a believable in-flight bridge pot: refreshed daily, unlocks mid-cycle
  const bridgeRng = mulberry32(hashInt(Math.floor(nowMs / 86_400_000) + 7));
  const bridge = {
    pendingEth: 0.4 + bridgeRng() * 1.3,
    nextBurnTs: nowMs + Math.round((0.8 + bridgeRng() * 4) * 86_400_000),
  };

  return {
    mode: "demo",
    range,
    generatedAt: nowMs,
    bucketMs,
    buckets,
    launches: rows.map((b) => b.launches),
    buys: rows.map((b) => b.buys),
    sells: rows.map((b) => b.sells),
    volumeUsd: rows.map((b) => b.volumeUsd),
    buyVolumeUsd: rows.map((b) => b.buyVolumeUsd),
    sellVolumeUsd: rows.map((b) => b.sellVolumeUsd),
    feesUsd: rows.map((b) => b.feesUsd),
    burnedPrism: rows.map((b) => b.burnedPrism),
    traders: rows.map((b) => b.traders),
    // same repeat-wallet heuristic as the demo prev-window
    tradersTotal: Math.round(rows.reduce((a, b) => a + b.traders, 0) * 0.55),
    basketBurnUsd: rows.map((b) => b.basketBurnUsd),
    burnedStartTotal: Math.max(0, stats.totalBurned - windowBurn),
    cap: PRISM_CAP,
    supply: stats.supply,
    baseCoverageFromMs: null,
    ethCoverageFromMs: null,
    topBaskets,
    bridge,
    ethUsd: DEMO_ETH_USD,
    prev,
  };
}

// deterministic demo address per symbol, so drill-down links stay stable
function demoBasketAddress(symbol: string): string {
  const rng = mulberry32(hashInt(symbol.split("").reduce((a, c) => a * 31 + c.charCodeAt(0), 7)));
  let hex = "";
  while (hex.length < 40) hex += Math.floor(rng() * 16).toString(16);
  return "0x" + hex.slice(0, 40);
}

// Demo per-basket drill-down: the same bucket generator, scaled down and
// re-seeded per address, so every basket has its own stable-but-distinct shape.
export function simulateBasketCharts(range: RangeKey, address: string, nowMs: number): BasketChartsPayload {
  const cfg = RANGES[range];
  const bucketMs = cfg.bucketSec * 1000;
  const endMs = Math.floor(nowMs / bucketMs) * bucketMs;
  const startMs = endMs - cfg.buckets * bucketMs;
  const seed = hashInt(address.toLowerCase().split("").reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 5));
  const scale = 0.08 + mulberry32(seed)() * 0.3; // each basket is a slice of the ecosystem
  const feeRate = 0.01 + mulberry32(seed + 1)() * 0.02;

  const basketBucket = (t: number, i: number) => {
    const b = demoBucket(t + (seed % 7) * 60_000, bucketMs, i, cfg.buckets);
    const buys = Math.round(b.buys * scale);
    const sells = Math.round(b.sells * scale);
    return {
      buys,
      sells,
      buyVolumeUsd: b.buyVolumeUsd * scale,
      sellVolumeUsd: b.sellVolumeUsd * scale,
      feeUsd: (b.buyVolumeUsd + b.sellVolumeUsd) * scale * feeRate,
    };
  };

  const buckets: number[] = [];
  const rows: ReturnType<typeof basketBucket>[] = [];
  for (let i = 0; i < cfg.buckets; i++) {
    const t = startMs + i * bucketMs;
    buckets.push(t);
    rows.push(basketBucket(t, i));
  }
  let prev: BasketPrevTotals | null = null;
  if (range !== "1y") {
    prev = { buys: 0, sells: 0, buyVolumeUsd: 0, sellVolumeUsd: 0, feeUsd: 0 };
    for (let i = 0; i < cfg.buckets; i++) {
      const b = basketBucket(startMs - (cfg.buckets - i) * bucketMs, i);
      prev.buys += b.buys;
      prev.sells += b.sells;
      prev.buyVolumeUsd += b.buyVolumeUsd;
      prev.sellVolumeUsd += b.sellVolumeUsd;
      prev.feeUsd += b.feeUsd;
    }
  }
  const known = DEMO_TOP_BASKETS.find((s) => demoBasketAddress(s) === address.toLowerCase());
  return {
    mode: "demo",
    range,
    generatedAt: nowMs,
    bucketMs,
    buckets,
    address: address.toLowerCase(),
    symbol: known ?? `${address.slice(0, 6)}…${address.slice(-4)}`,
    buys: rows.map((b) => b.buys),
    sells: rows.map((b) => b.sells),
    buyVolumeUsd: rows.map((b) => b.buyVolumeUsd),
    sellVolumeUsd: rows.map((b) => b.sellVolumeUsd),
    feeUsd: rows.map((b) => b.feeUsd),
    baseCoverageFromMs: null,
    prev,
  };
}
