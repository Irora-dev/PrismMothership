import { NextResponse } from "next/server";
import { AbiCoder, Contract, formatEther, formatUnits, id, type JsonRpcProvider, type Log } from "ethers";
import { getBaseProvider, getEthUsd, getHoodProvider, getProvider } from "@/lib/chain/live";
import { listIndexes } from "@/lib/spectrum/index-data";
import { ARB_SYS, DEAD, L1_PRISM_BURNER, PORTFOLIO_BATCHER_PROD, PORTFOLIO_BATCHER_WATCH, PORTFOLIO_COLLECTOR_WATCH, PRISM, SPECTRUM_LEGACY_FACTORIES, SPECTRUM_V2, SPECTRUM_V3_FACTORIES, TOPIC_ARB, TOPIC_BATCH, TOPIC_COLLECTOR, WRAPPER_WATCH } from "@/lib/chain/constants";
import { confirmedSendCount, isSpent } from "@/lib/chain/orbit";

// ── The burn pipeline, read side ─────────────────────────────────────────────
// the designer's ruling (2026-08-02, via SpectrumContracts' desk map): nothing in the
// burn pipeline is automatic, so the site SHOWS what is accumulating at every
// stage and lets anyone crank it. This route reads the whole pipeline:
//   1. per-basket burn accruals (pendingPrismBurn, USDC 6dp)
//   2. factory launch-fee escrows (pendingAuctionBurn — eth + hood; Base
//      bridges inline and genuinely has no getter, verified live 2026-08-03)
//   3. the batcher — dark until its deploy ceremony
//   4. revenue in flight across bridges (reused from the charts store)
//   5. the L1 burner's ETH balance
// Every getter here was verified against the live chains before wiring.
//
// ── The crank economics (the designer's order, 2026-08-16, via SpectrumContracts) ──
// Every collector flush() opens ONE L2→L1 withdrawal whose L1 finalization is
// UNREIMBURSED: ~91,264 gas on 4663 (measured across 487 real finalizations),
// ~600,000 on Base (OP-Stack prove + finalize, two txs). The deployed
// FINALIZATION_THRESHOLDs sit BELOW their own economic floors and are
// constructor immutables, so THIS gate is the only economic protection that
// exists: a crank CTA lights only when finalization costs ≤ 2% of the value
// it delivers (the tree's amortisation policy), priced at the LIVE L1 base
// fee — never on flushable() alone. Gas being cheap today is a regime, not a
// property. The crank board ranks by VALUE, never by count: counting rewards
// dust-cranking, the exact dynamic the no-bounty rule exists to prevent.

export const dynamic = "force-dynamic";

const BASKET_ABI = ["function pendingPrismBurn() view returns (uint256)"];
const FACTORY_ABI = ["function pendingAuctionBurn() view returns (uint256)"];
const COLLECTOR_ABI = ["function flushable() view returns (bool)", "function FINALIZATION_THRESHOLD() view returns (uint256)"];

// The basket crank reverts below ~0.3 ETH-equivalent by design (audit B-3) —
// the UI shows progress toward it and never sends a crank that must fail.
const BASKET_THRESHOLD_ETH = 0.3;

// Measured L1 finalization gas per withdrawal (w-79 brief): Arbitrum Outbox
// executeTransaction 89,450 + the burner's receive() 1,814; OP-Stack ~600k
// across prove + finalize. The burner's own crank is a ~200k ETH→PRISM swap.
const FINALIZE_GAS: Record<string, number> = { robinhood: 91_264, base: 600_000 };
const BURNER_CRANK_GAS = 200_000;
const FINALIZE_POLICY_PCT = 2; // the tree's amortisation policy: cost ≤ 2% of value
const WITHDRAWAL_WINDOW_MS = 7 * 86_400_000; // ~7-day dispute window, both L2s
// Event-scan floors (deploy provenance): Base collector deployed at block
// 49,882,504 (spectrum-contracts/ADDRESSES.md); the 4663 collector passed its
// read-back 2026-08-12 — 33.0M is ~1 day of margin below that date at 0.1s
// blocks. The burner floor is the 07-30 ceremony floor the site already uses.
const COLLECTOR_EVENT_FLOOR: Record<string, number> = { base: 49_880_000, robinhood: 33_000_000 };
const COLLECTOR_SCAN_CHUNK: Record<string, number> = { base: 100_000, robinhood: 2_000_000 };
const BURNER_EVENT_FLOOR = 25_647_000;
const TOPIC_BURNER = {
  burned: id("Burned(address,uint256,uint256)"), // (caller idx, ethIn, prismBurned)
  received: id("Received(address,uint256)"), // (from idx, amount)
} as const;

interface PipelineBasket {
  chain: string;
  address: string;
  symbol: string;
  pendingUsd: number;
  pendingEthEquiv: number;
  thresholdEth: number;
  crankable: boolean;
}

let cache: { at: number; body: unknown } | null = null;
let inflight: Promise<unknown> | null = null;

// ── event scans, incremental per warm instance ───────────────────────────────
// A cold instance pays one small backfill (floors are the deploy blocks, so
// ~3 chunked getLogs per chain); warm instances scan only cursor → head.
interface RawEv {
  blockNumber: number;
  txHash: string;
  topics: string[];
  data: string;
}
const evCache: Record<string, { cursor: number; logs: RawEv[] }> = {};
const thresholdCache = new Map<string, number>(); // immutables — read once per instance
const blockTsCache = new Map<string, number>(); // `${key}:${block}` → ms
const txFromCache = new Map<string, string>();
const spentCache = new Set<number>(); // Outbox positions confirmed spent — terminal, never re-asked

// ── blob persistence for the scans (the charts.ts pattern) ──────────────────
// The floors are fixed deploy blocks on fast chains, so a memory-only cold
// scan GROWS forever (~one extra 2M-block chunk every ~2.3 days on 4663).
// Persisting cursor+logs makes a cold instance hydrate and scan only the gap.
// Bump the key's version if RawEv's shape or the floors change.
// v2: robinhood withdrawals now come from the ArbSys L2ToL1Tx scan (by
// destination), not the collector's own event — the old flush-robinhood cache
// holds the wrong event shape for that key.
const EV_BLOB_KEY = "burn-events-v2";
let evHydrated = false;
let evSavedAt = 0;
async function evBlobStore() {
  try {
    const { getStore } = await import("@netlify/blobs");
    return getStore({ name: "prismbeat-charts", consistency: "eventual" });
  } catch {
    return null;
  }
}
async function hydrateEvCache(): Promise<void> {
  if (evHydrated) return;
  evHydrated = true;
  try {
    const blobs = await evBlobStore();
    if (!blobs) return;
    const saved = (await blobs.get(EV_BLOB_KEY, { type: "json" })) as { caches?: Record<string, { cursor: number; logs: RawEv[] }>; ts?: Record<string, number> } | null;
    if (saved?.caches) for (const [k, v] of Object.entries(saved.caches)) if (!evCache[k]) evCache[k] = v;
    if (saved?.ts) for (const [k, v] of Object.entries(saved.ts)) if (!blockTsCache.has(k)) blockTsCache.set(k, v);
  } catch {
    /* no blob = a plain cold scan, exactly as before */
  }
}
async function saveEvCache(): Promise<void> {
  if (Date.now() - evSavedAt < 120_000) return; // throttled — the data only grows
  evSavedAt = Date.now();
  try {
    const blobs = await evBlobStore();
    if (!blobs) return;
    await blobs.setJSON(EV_BLOB_KEY, { caches: evCache, ts: Object.fromEntries(blockTsCache) });
  } catch {
    /* a failed save costs nothing but the next cold scan */
  }
}

async function scanLogs(p: JsonRpcProvider, key: string, address: string, topics: (string | null)[][] | string[], floor: number, chunk: number): Promise<RawEv[]> {
  const head = await p.getBlockNumber();
  const c = (evCache[key] ??= { cursor: floor, logs: [] });
  let from = c.cursor;
  while (from <= head) {
    const to = Math.min(from + chunk - 1, head);
    const got: Log[] = await p.getLogs({ address, topics: topics as string[], fromBlock: from, toBlock: to });
    for (const l of got) c.logs.push({ blockNumber: l.blockNumber, txHash: l.transactionHash, topics: [...l.topics], data: l.data });
    from = to + 1;
  }
  c.cursor = head + 1;
  return c.logs;
}

async function tsOf(p: JsonRpcProvider, key: string, block: number): Promise<number> {
  const k = `${key}:${block}`;
  const hit = blockTsCache.get(k);
  if (hit != null) return hit;
  const b = await p.getBlock(block);
  const ms = (b?.timestamp ?? 0) * 1000;
  blockTsCache.set(k, ms);
  return ms;
}


async function build() {
  await hydrateEvCache(); // cold instances scan only the gap since the last save
  const eth = getProvider();
  const base = getBaseProvider();
  const hood = getHoodProvider();
  if (!eth) throw new Error("no eth rpc");
  const providerOf = (chain: string) => (chain === "ethereum" ? eth : chain === "base" ? base : hood);

  const [ethUsd, indexes] = await Promise.all([getEthUsd(eth).catch(() => 0), listIndexes().catch(() => [])]);

  // 1 — basket accruals
  const baskets = (
    await Promise.all(
      indexes.map(async (ix): Promise<PipelineBasket | null> => {
        const p = providerOf(ix.chain);
        if (!p) return null;
        try {
          const pending = (await new Contract(ix.address, BASKET_ABI, p).pendingPrismBurn()) as bigint;
          const usd = Number(formatUnits(pending, 6));
          const ethEquiv = ethUsd > 0 ? usd / ethUsd : 0;
          return {
            chain: ix.chain,
            address: ix.address,
            symbol: ix.symbol,
            pendingUsd: usd,
            pendingEthEquiv: ethEquiv,
            thresholdEth: BASKET_THRESHOLD_ETH,
            crankable: ethEquiv >= BASKET_THRESHOLD_ETH,
          };
        } catch {
          return null; // a basket without the getter (older lineage) just doesn't list
        }
      }),
    )
  ).filter(Boolean) as PipelineBasket[];

  // 2 — factory escrows: ceremony eth + hood, plus the legacy eth factory that
  // still holds real auction proceeds from the pre-repoint era
  const factorySources: { chain: string; address: string; note?: string }[] = [
    ...(SPECTRUM_V2.ethFactory ? [{ chain: "ethereum", address: SPECTRUM_V2.ethFactory }] : []),
    ...(SPECTRUM_V2.hoodFactory ? [{ chain: "robinhood", address: SPECTRUM_V2.hoodFactory }] : []),
    ...SPECTRUM_LEGACY_FACTORIES.ethereum.map((f) => ({ chain: "ethereum", address: f.address, note: "legacy factory" })),
    // gen-3 production factories (2026-08-16 ceremony): the eth one escrows
    // like its predecessors; an L2 one without the getter silently doesn't list
    ...SPECTRUM_V3_FACTORIES.ethereum.map((f) => ({ chain: "ethereum", address: f.address, note: "gen-3 factory" })),
    ...SPECTRUM_V3_FACTORIES.robinhood.map((f) => ({ chain: "robinhood", address: f.address, note: "gen-3 factory" })),
  ];
  const factories = (
    await Promise.all(
      factorySources.map(async (f) => {
        const p = providerOf(f.chain);
        if (!p) return null;
        try {
          const escrow = (await new Contract(f.address, FACTORY_ABI, p).pendingAuctionBurn()) as bigint;
          return { ...f, escrowEth: Number(formatEther(escrow)) };
        } catch {
          return null; // no getter on this deployment — nothing accumulates here
        }
      }),
    )
  ).filter(Boolean);

  // ── the live L1 base fee prices every gate on this read ──
  const l1BaseFeeWei = Number((await eth.getBlock("latest").catch(() => null))?.baseFeePerGas ?? 0n);
  const l1BaseFeeGwei = l1BaseFeeWei / 1e9;
  const costOf = (gas: number) => (l1BaseFeeWei > 0 ? (gas * l1BaseFeeWei) / 1e18 : null);

  // 4 — the bridge collectors: the batcher's burn cut waits here for a
  // PERMISSIONLESS flush() toward the L1 burner. Every row now carries its
  // ECONOMICS: what the unreimbursed L1 finalization of one more withdrawal
  // costs right now, as a share of the value it would deliver. The CTA gate is
  // `economic` (≤2% policy) — flushable() alone is the contract's hard floor,
  // deliberately NOT the button's gate (w-79: the thresholds are below their
  // own economic floors and immutable).
  const collectors = (
    await Promise.all(
      PORTFOLIO_COLLECTOR_WATCH.map(async (c) => {
        const p = providerOf(c.chain);
        if (!p) return null;
        try {
          const contract = new Contract(c.address, COLLECTOR_ABI, p);
          const [bal, flushable] = await Promise.all([p.getBalance(c.address), contract.flushable() as Promise<boolean>]);
          // keyed by ADDRESS, not chain: two collector generations now run in
          // parallel per chain (gen-1 for the rehearsal decoys, gen-3 for
          // production) and their thresholds differ
          let thresholdEth = thresholdCache.get(c.address);
          if (thresholdEth == null) {
            thresholdEth = Number(formatEther((await contract.FINALIZATION_THRESHOLD().catch(() => 0n)) as bigint));
            if (thresholdEth > 0) thresholdCache.set(c.address, thresholdEth);
          }
          const pendingEth = Number(formatEther(bal));
          const finalizeCostEth = costOf(FINALIZE_GAS[c.chain] ?? 0);
          const finalizeCostPct = pendingEth > 0 && finalizeCostEth != null ? (finalizeCostEth / pendingEth) * 100 : null;
          const economic = pendingEth > 0 && finalizeCostPct != null && finalizeCostPct <= FINALIZE_POLICY_PCT;
          return {
            chain: c.chain,
            address: c.address,
            gen: c.gen,
            pendingEth,
            flushable,
            thresholdEth,
            finalizeGas: FINALIZE_GAS[c.chain] ?? null,
            finalizeCostEth,
            finalizeCostPct,
            economic,
            efficiencyPct: finalizeCostPct != null ? Math.max(0, 100 - finalizeCostPct) : null,
          };
        } catch {
          return null;
        }
      }),
    )
  ).filter(Boolean) as {
    chain: string;
    address: string;
    gen: 1 | 3;
    pendingEth: number;
    flushable: boolean;
    thresholdEth: number;
    finalizeGas: number | null;
    finalizeCostEth: number | null;
    finalizeCostPct: number | null;
    economic: boolean;
    efficiencyPct: number | null;
  }[];

  // ── withdrawals in flight: every burner-destined crossing, its own row ──────
  // The site used to imply the bridge lands by itself; it does not — after the
  // ~7-day window the L1 finalization is ITSELF a permissionless, unreimbursed
  // crank (the valuable one to crowdsource). Each row carries its state.
  // Robinhood rows come from the ArbSys precompile BY DESTINATION, not from the
  // collector's own event: a collector flush, a factory escrow flush and any
  // future gen-2 contract all open the same withdrawal shape, and only the
  // destination scan sees them all (the 2026-08-14 factory flush — Ξ0.072,
  // more than every collector crossing combined — was invisible to the old
  // per-collector scan). The event body also carries the withdrawal's POSITION,
  // which is what real executability keys on.
  const withdrawals: {
    chain: string;
    amountEth: number;
    caller: string;
    txHash: string;
    ts: number;
    unlockTs: number;
    position: number | null;
    status: "window" | "executable" | "landed";
  }[] = [];
  if (hood) {
    try {
      const burnerTopic = `0x000000000000000000000000${L1_PRISM_BURNER.slice(2).toLowerCase()}`;
      const logs = await scanLogs(hood, "l2tol1-robinhood", ARB_SYS, [TOPIC_ARB.l2ToL1Tx, burnerTopic], COLLECTOR_EVENT_FLOOR.robinhood ?? 0, COLLECTOR_SCAN_CHUNK.robinhood ?? 2_000_000);
      const coder = AbiCoder.defaultAbiCoder();
      for (const l of logs) {
        const [, , , timestamp, callvalue, data] = coder.decode(["address", "uint256", "uint256", "uint256", "uint256", "bytes"], l.data) as unknown as [string, bigint, bigint, bigint, bigint, string];
        if (data !== "0x" || callvalue <= 0n) continue; // bare-ETH withdrawEth shape only
        // the human who cranked the flush (board credit) — the event's own
        // caller field is the flushing CONTRACT, not the cranker
        let cranker = txFromCache.get(l.txHash) ?? "";
        if (!cranker) {
          cranker = (await hood.getTransaction(l.txHash).catch(() => null))?.from?.toLowerCase() ?? "";
          if (cranker) txFromCache.set(l.txHash, cranker);
        }
        const ts = Number(timestamp) * 1000;
        withdrawals.push({
          chain: "robinhood",
          amountEth: Number(formatEther(callvalue)),
          caller: cranker,
          txHash: l.txHash,
          ts,
          unlockTs: ts + WITHDRAWAL_WINDOW_MS,
          position: Number(BigInt(l.topics[3] ?? "0x0")),
          status: "window",
        });
      }
    } catch {
      /* a failed scan leaves the in-flight list short, never the route dead */
    }
  }
  for (const c of PORTFOLIO_COLLECTOR_WATCH.filter((x) => x.chain === "base")) {
    const p = providerOf(c.chain);
    if (!p) continue;
    try {
      const logs = await scanLogs(p, `flush-${c.chain}`, c.address, [TOPIC_COLLECTOR.burnBridgedToL1], COLLECTOR_EVENT_FLOOR[c.chain] ?? 0, COLLECTOR_SCAN_CHUNK[c.chain] ?? 100_000);
      for (const l of logs) {
        const ts = await tsOf(p, c.chain, l.blockNumber);
        withdrawals.push({
          chain: c.chain,
          amountEth: Number(formatEther(BigInt(l.data))),
          caller: `0x${l.topics[2]?.slice(26) ?? ""}`,
          txHash: l.txHash,
          ts,
          unlockTs: ts + WITHDRAWAL_WINDOW_MS,
          position: null, // OP-Stack rows have no outbox position; wall clock is all we have
          status: "window",
        });
      }
    } catch {
      /* a failed scan leaves the in-flight list short, never the route dead */
    }
  }

  // 5 — the L1 burner (PRISM only actually dies here) + its whole history:
  // Burned = stage-3 cranks (caller, ethIn, prismBurned) · Received = bridge
  // deliveries (their tx.from is the stage-2 finalizer — credited on the board)
  const burnerEth = Number(formatEther(await eth.getBalance(L1_PRISM_BURNER).catch(() => 0n)));
  // the ECOSYSTEM-WIDE burn: PRISM sitting at dEaD — every path counted (the
  // burner's buys AND the pool's own PRISM-leg sell burns). The same read the
  // home stat uses, so the two figures can never disagree (the designer 2026-08-16:
  // the journey shows the wider figure).
  const burnedEcosystemPrism = PRISM
    ? Number(formatEther(await new Contract(PRISM, ["function balanceOf(address) view returns (uint256)"], eth).balanceOf(DEAD).catch(() => 0n)))
    : 0;
  // In-tx sinks at the burner: mainnet batchers AND mainnet wrappers deliver
  // their burn cut to the burner inside the trade itself — their Received
  // events are automatic arrivals, never finalization cranks (and never pot
  // funding). The gen-3 eth wrapper sinks direct, and the old 0x588f one
  // always did.
  const batcherSinks = new Set([...Object.values(PORTFOLIO_BATCHER_WATCH).flat(), ...WRAPPER_WATCH.ethereum.addresses].map((a) => a.toLowerCase()));
  let burnedEthTotal = 0;
  let burnedPrismTotal = 0;
  const burnedEvents: { caller: string; ethIn: number; prismBurned: number; ts: number; txHash: string }[] = [];
  const receivedEvents: { from: string; finalizer: string; amountEth: number; ts: number; txHash: string }[] = [];
  try {
    const logs = await scanLogs(eth, "burner", L1_PRISM_BURNER, [[TOPIC_BURNER.burned, TOPIC_BURNER.received]], BURNER_EVENT_FLOOR, 100_000);
    for (const l of logs) {
      const ts = await tsOf(eth, "ethereum", l.blockNumber);
      if (l.topics[0] === TOPIC_BURNER.burned) {
        const [ethIn, prismBurned] = [BigInt(l.data.slice(0, 66)), BigInt(`0x${l.data.slice(66, 130)}`)];
        const row = { caller: `0x${l.topics[1]?.slice(26) ?? ""}`, ethIn: Number(formatEther(ethIn)), prismBurned: Number(formatEther(prismBurned)), ts, txHash: l.txHash };
        burnedEvents.push(row);
        burnedEthTotal += row.ethIn;
        burnedPrismTotal += row.prismBurned;
      } else if (l.topics[0] === TOPIC_BURNER.received) {
        // The mainnet batcher's BURN_SINK is the burner ITSELF — its sinks
        // arrive as Received too, but in-tx with the trade, automatic, no
        // crank. Only bridge deliveries count as stage-2 finalizations
        // (proven live 2026-08-16: the designer's two eth batches read as Received
        // and were being credited as finalizes).
        const from = `0x${l.topics[1]?.slice(26) ?? ""}`;
        if (batcherSinks.has(from.toLowerCase())) continue;
        let finalizer = txFromCache.get(l.txHash) ?? "";
        if (!finalizer) {
          finalizer = (await eth.getTransaction(l.txHash).catch(() => null))?.from?.toLowerCase() ?? "";
          if (finalizer) txFromCache.set(l.txHash, finalizer);
        }
        receivedEvents.push({ from, finalizer, amountEth: Number(formatEther(BigInt(l.data))), ts, txHash: l.txHash });
      }
    }
  } catch {
    /* burner history missing → totals read 0 and the board is short; live reads still serve */
  }

  // ── the crank board: every cranker, ranked by VALUE PUSHED, never count ──
  const board = new Map<string, { address: string; valueEth: number; cranks: number; flushes: number; finalizes: number; burns: number; lastTs: number }>();
  const credit = (addr: string, valueEth: number, kind: "flushes" | "finalizes" | "burns", ts: number) => {
    const a = addr.toLowerCase();
    if (!a || a === "0x") return;
    const row = board.get(a) ?? { address: a, valueEth: 0, cranks: 0, flushes: 0, finalizes: 0, burns: 0, lastTs: 0 };
    row.valueEth += valueEth;
    row.cranks += 1;
    row[kind] += 1;
    row.lastTs = Math.max(row.lastTs, ts);
    board.set(a, row);
  };

  // withdrawal status: a Received matching the amount (FIFO, oldest-first)
  // marks it landed AND credits its finalizer — an unmatched Received is pot
  // funding (someone sent the burner ETH directly, the designer's own 0.05 today),
  // not a finalization crank. For rows carrying a POSITION, "executable" is
  // the EXACT on-chain gate (a confirmed assertion covers the position and the
  // Outbox hasn't spent it) — never the wall clock, so READY TO FINALIZE is
  // literally true the moment it shows. OP-Stack rows (no position) keep the
  // wall-clock estimate. unlockTs stays on every row as the ETA display.
  const confirmedSize = await confirmedSendCount(eth, hood);
  const unmatched = [...receivedEvents].sort((a, b) => a.ts - b.ts);
  const nowMs = Date.now();
  for (const w of withdrawals.sort((a, b) => a.ts - b.ts)) {
    const i = unmatched.findIndex((r) => Math.abs(r.amountEth - w.amountEth) < 1e-12 && r.ts >= w.ts);
    if (i >= 0) {
      w.status = "landed";
      credit(unmatched[i].finalizer, unmatched[i].amountEth, "finalizes", unmatched[i].ts);
      unmatched.splice(i, 1);
    } else if (w.position != null) {
      if (confirmedSize > w.position) {
        if (spentCache.has(w.position)) {
          w.status = "landed"; // spent on the Outbox = delivered, even if the Received match missed it
        } else if (await isSpent(eth, BigInt(w.position)).catch(() => false)) {
          spentCache.add(w.position); // spent is terminal — never re-ask
          w.status = "landed";
        } else {
          w.status = "executable";
        }
      }
    } else if (nowMs >= w.unlockTs) {
      w.status = "executable";
    }
  }

  for (const w of withdrawals) credit(w.caller, w.amountEth, "flushes", w.ts);
  for (const b of burnedEvents) credit(b.caller, b.ethIn, "burns", b.ts);

  // ── the PRODUCTION portfolio batchers (seated at the 2026-08-16 ceremony) ──
  // This stream stayed `batcher: null` until real addresses existed; all three
  // do now, independently verified before wiring (scripts/gen3-verify.mjs:
  // sinks, MAX_FEE_BPS, bytecode). Figures are MEASURED off the batchers' own
  // events and nothing else: BatchExecuted's funding + fee (6dp stable),
  // BurnShareDelivered's ethDelivered. NO PRISM figure is claimed here — the
  // burner pot is fungible across every road, so per-stream PRISM attribution
  // would be an invention, not a measurement.
  let batcher: { address: string; volumeUsd: number; feesUsd: number; deliveredEth: number; batches: number } | null = null;
  try {
    let volumeUsd = 0;
    let feesUsd = 0;
    let deliveredEth = 0;
    let batches = 0;
    for (const [chain, cfg] of Object.entries(PORTFOLIO_BATCHER_PROD)) {
      const p = providerOf(chain);
      if (!p) continue;
      const logs = await scanLogs(p, `batch-prod-${chain}`, cfg.address, [[TOPIC_BATCH.executed5, TOPIC_BATCH.burnShareDelivered]], cfg.fromBlock, chain === "robinhood" ? 2_000_000 : 100_000);
      for (const l of logs) {
        if (l.topics[0] === TOPIC_BATCH.executed5) {
          volumeUsd += Number(formatUnits(BigInt(l.data.slice(0, 66)), 6));
          feesUsd += Number(formatUnits(BigInt(`0x${l.data.slice(66, 130)}`), 6));
          batches += 1;
        } else if (l.topics[0] === TOPIC_BATCH.burnShareDelivered) {
          deliveredEth += Number(formatEther(BigInt(`0x${l.data.slice(66, 130)}`)));
        }
      }
    }
    batcher = { address: PORTFOLIO_BATCHER_PROD.ethereum.address, volumeUsd, feesUsd, deliveredEth, batches };
  } catch {
    /* a failed read keeps the stream dark rather than wrong */
  }

  const burnerCrankCostEth = costOf(BURNER_CRANK_GAS);
  const burnerCrankCostPct = burnerEth > 0 && burnerCrankCostEth != null ? (burnerCrankCostEth / burnerEth) * 100 : null;

  void saveEvCache(); // persist the scans so the next cold instance hydrates instead of re-scanning

  return {
    ethUsd,
    l1BaseFeeGwei,
    policyPct: FINALIZE_POLICY_PCT,
    baskets: baskets.sort((a, b) => b.pendingUsd - a.pendingUsd),
    factories,
    collectors,
    withdrawals: withdrawals.sort((a, b) => b.ts - a.ts).slice(0, 50),
    burner: {
      address: L1_PRISM_BURNER,
      balanceEth: burnerEth,
      crankGas: BURNER_CRANK_GAS,
      crankCostEth: burnerCrankCostEth,
      crankCostPct: burnerCrankCostPct,
      economic: burnerEth > 0 && burnerCrankCostPct != null && burnerCrankCostPct <= FINALIZE_POLICY_PCT,
      efficiencyPct: burnerCrankCostPct != null ? Math.max(0, 100 - burnerCrankCostPct) : null,
      burnedEthTotal,
      burnedPrismTotal,
      burnedEcosystemPrism,
      // the most recent buy-and-burn, as a receipt for the road's last station
      lastBurn: burnedEvents.length ? burnedEvents.reduce((a, b) => (b.ts > a.ts ? b : a)) : null,
    },
    board: [...board.values()].sort((a, b) => b.valueEth - a.valueEth).slice(0, 20),
    // 3 — the batcher stage: LIVE since the 2026-08-16 gen-3 ceremony (the
    // addresses landed via SpectrumContracts' desk drop, per the standing
    // order, and were re-verified here before wiring).
    batcher,
    generatedAt: Date.now(),
  };
}

export async function GET(req: Request) {
  // ?fresh=1 = a user action just moved money (a crank mined, a batch landed):
  // the 30s cache would serve the pre-crank world and the chip that should
  // have retired keeps saying "crank it" (the designer, live, 2026-08-16). Polls
  // never send it; refresh() does.
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  if (!fresh && cache && Date.now() - cache.at < 30_000) return NextResponse.json(cache.body);
  if (!inflight) {
    inflight = build()
      .then((body) => {
        cache = { at: Date.now(), body };
        return body;
      })
      .finally(() => {
        inflight = null;
      });
  }
  try {
    return NextResponse.json(await inflight);
  } catch {
    return NextResponse.json({ error: "pipeline read failed" }, { status: 503 });
  }
}
