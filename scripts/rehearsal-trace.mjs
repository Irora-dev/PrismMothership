// ── REHEARSAL TRACE — read the designer's gen-2 test flows off the real chains ──────
//
// ⛔⛔ EVERY ADDRESS IN THIS FILE IS A REHEARSAL DECOY (SpectrumContracts desk
// drop, 2026-08-14 23:37; ground truth spectrum-contracts/ADDRESSES.md "GEN-2
// REHEARSAL SET"). They are real, permanent contracts on real chains and they
// are NOT production. NOTHING here may be imported by site code, seated into
// env, or displayed on the pushed site — the surface gate asserts the portfolio
// stream stays dark. Production addresses arrive with a separate Ledger
// ceremony. This script exists so the OWNER can see his own test flows:
//   node scripts/rehearsal-trace.mjs [--chain 1|8453|4663] [--days N]
//
// It is READ-ONLY: eth_call + eth_getLogs + getBalance. It signs nothing.
//
// ⚠ Addresses are keyed on (chainId, role) — NEVER on the bare hex. The
// collisions are maximal by construction: the 1/8453 gen-2 factory hex IS the
// 4663 provider0 hex, the 1/8453 provider hexes ARE the 4663 collector and
// league pool, and the chain-1 batcher hex IS the 4663 batcher (different
// contracts). A tool keyed on a bare address WILL talk to the wrong contract.
//
// What it reconstructs, per the burn-pipeline walkthrough (2026-08-12):
//   Path A/B — basket swap fees: every FeesAccrued (4-field on 1/8453, 5-field
//     with the league slice on 4663), the splits MEASURED vs the ruled 25% /
//     23.75%, the bountied flushPrismBurn cranks, and each basket's live
//     pendingPrismBurn.
//   Path C — factory launch fees: Launched, escrow accrual, auction flushes.
//   Path D — batcher: BatchExecuted (volume), BurnShareDelivered (the burn
//     number), BurnDiverted (visible-but-not-burnt), per-leg fills/skips.
//   The finish line — the L1 burner: Received (pool deliveries) and Burned
//     (per-crank buys → dEaD), plus the pooled balance right now.
//
// Unknown events are PRINTED with their topic0 rather than dropped: an empty
// trace must mean "no activity", never "wrong topics".

import { Contract, Interface, JsonRpcProvider, formatEther, formatUnits, getAddress } from "ethers";
import { readFileSync } from "node:fs";

// ── the rehearsal matrix, keyed (chainId, role) ──────────────────────────────
const CH = { 1: "ethereum", 8453: "base", 4663: "robinhood" };
const SETTLE = { 1: "USDC", 8453: "USDC", 4663: "USDG" }; // 6dp settlement asset per chain
const REHEARSAL = {
  1: {
    factory: "0x41C3c6c12F1ADd9058bA7d36B67843Bc3af0D39c", // gen-2 (hex = 4663 provider0)
    router: "0x3Ffb8090244C077FA9b4C8dcBb353e2Bf6b13766",
    batcher: "0x59a2756410887b7c1928Bf7C37B2bc9b1CeF95aA", // gen-1, sinks → burner pot in-tx
    burner: "0x2E39Ae825C697BE3e15ACd003d1398287C83D4b6", // GENERATION-INDEPENDENT (the one production anchor)
  },
  8453: {
    factory: "0x41C3c6c12F1ADd9058bA7d36B67843Bc3af0D39c", // same hex as chain 1, different contract
    router: "0x3Ffb8090244C077FA9b4C8dcBb353e2Bf6b13766",
    collector: "0x0f2F1F0cD75B44A707D2cc00ae0ECABEEE7A0Ed3", // gen-2, threshold 0.01 ETH
    collectorGen1: "0xd658192c1Bd25fA8858ed34898491D55deD430a5", // gen-1 — the batcher still sinks here
    batcher: "0x81eBc35F705F9F30f5e2a3990530C07B54C72aBb", // gen-1
  },
  4663: {
    factory: "0xf20deFd81DCb0c886740aBb89B6B93C1f05dE82C", // gen-2
    router: "0xE1D7911aa044b8c004a2a8F8C430E6EfDA77Ad1b",
    collector: "0x6B27bf0D59150c56899b5D795E54118892d1BeE9", // gen-2, threshold 0.002 (hex = 1/8453 provider0)
    collectorGen1: "0xd658192c1Bd25fA8858ed34898491D55deD430a5",
    leaguePool: "0x89f003557A2a4614929D6B388216d2d2Cff5a1e3", // gen-2, seated (hex = 1/8453 provider1)
    batcher: "0x59a2756410887b7c1928Bf7C37B2bc9b1CeF95aA", // gen-1 (hex = chain-1 batcher, different contract)
  },
};

// ── every event either lineage can emit, decoded by topic0 ──────────────────
const EVENTS = [
  // factory (all chains) + its chain-specific auction leg
  "event Launched(address indexed basket, address indexed deployer, string name, string symbol, uint160 startSqrtPriceX96, uint256 ethPaid, uint16 basketFeeBps)",
  "event AuctionEscrowed(address indexed basket, uint256 amount)",
  "event AuctionSentToBurn(address indexed burnerL1, uint256 amount)",
  "event AuctionBridgedToBurn(address indexed basket, address indexed burnerL1, uint256 bridgedEth)",
  "event AuctionBridgedToBurn(address indexed destination, uint256 bridgedEth)",
  "event AuctionWithdrawnToBurn(address indexed destination, uint256 ethWithdrawn)",
  "event AuctionWithdrawnToBurn(address indexed basket, address indexed burnerL1, uint256 ethWithdrawn)",
  // baskets — 1/8453 (4-field) and the 4663 lineage (5-field, league)
  "event FeesAccrued(uint256 toHolders, uint256 toBurn, uint256 toCreator, uint256 toInterfaceAndLauncher)",
  "event FeesAccrued(uint256 toHolders, uint256 toBurn, uint256 toCreator, uint256 toInterfaceAndLauncher, uint256 toLeague)",
  "event FeeConfigured(uint16 basketFeeBps, uint16 creatorShareBps, address creatorPayout, address launcher)",
  "event Initialized(uint160 sqrtPriceX96)",
  "event Minted(uint256 usdcIn, uint256 basketOut, address indexed frontend)",
  "event MintedInKind(address indexed to, address indexed frontend, uint256 shares, uint256 feeUsdc)",
  "event Redeemed(uint256 basketIn, uint256 usdcOut, address indexed frontend)",
  "event FeesClaimed(address indexed holder, uint256 amount)",
  // a basket IS an ERC-20, so its share movements land in the same scan
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  // the router's own swap event (verified SpectrumSwapRouter.sol on blockscout)
  "event Swapped(address indexed basket, address indexed trader, address tokenIn, uint256 amountIn, uint256 amountOut, address frontend)",
  // basket burn flush — one name per chain leg
  "event PrismBurned(uint256 usdcIn, uint256 prismBurned)", // mainnet: atomic in-protocol
  "event PrismBurnBridged(uint256 usdcIn, uint256 ethBridged)", // base leg
  "event PrismBurnWithdrawn(uint256 usdcIn, uint256 ethWithdrawn)", // 4663 leg
  "event BurnFlushed(address indexed keeper, uint256 ethDelivered, uint256 bounty)",
  "event LeagueFeesFlushed(address indexed creator, uint256 amount, uint256 bounty)",
  // collector
  "event BurnBridgedToL1(address indexed burnerL1, uint256 amount, address indexed caller)",
  // batchers — both shapes, shipping contract answers 0x0c8ef5f9
  "event BatchExecuted(address indexed recipient, address indexed fundingAsset, uint256 fundingTotal, uint256 fee, uint256 refunded)",
  "event BatchExecuted(address indexed recipient, address fundingAsset, uint256 spentFunding, uint256 hubOut, uint256 feeEth, uint16 legs, uint16 skipped)",
  "event BurnShareDelivered(address indexed sink, uint256 fundingSpent, uint256 ethDelivered)",
  "event BurnDiverted(address indexed sink, address indexed fundingAsset, uint256 amount, bytes reason)",
  "event BurnRemainderDiverted(address indexed sink, address indexed fundingAsset, uint256 amount)",
  "event LegFilled(address indexed recipient, address indexed buyToken, uint256 fundingUsed, uint256 delivered)",
  "event LegSkipped(address indexed recipient, address indexed buyToken, uint256 sellAmount, bytes reason)",
  "event BatchLegFilled(address indexed recipient, address indexed asset, uint8 venue, uint256 budgetIn, uint256 out)",
  "event BatchLegSkipped(address indexed recipient, address indexed asset, uint256 budgetRefunded)",
  "event IntegratorFeeAccrued(address indexed integrator, uint256 amount)",
  "event IntegratorFeeClaimed(address indexed integrator, address indexed to, uint256 amount)",
  // the league pool + factory seating choreography
  "event FactorySeated(address indexed factory)",
  // the burner
  "event Burned(address indexed caller, uint256 ethIn, uint256 prismBurned)",
  "event Received(address indexed from, uint256 amount)",
];
const byTopic = new Map();
for (const sig of EVENTS) {
  const iface = new Interface([sig]);
  const frag = iface.fragments[0];
  byTopic.set(iface.getEvent(frag.name).topicHash, { iface, name: frag.name, sig });
}

const GETTERS = new Interface([
  "function pendingPrismBurn() view returns (uint256)",
  "function pendingAuctionBurn() view returns (uint256)",
  "function basketFeeBps() view returns (uint16)",
  "function symbol() view returns (string)",
]);

// ── plumbing ─────────────────────────────────────────────────────────────────
function env() {
  try {
    return Object.fromEntries(
      readFileSync(new URL("../.env.local", import.meta.url), "utf8")
        .split("\n")
        .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
    );
  } catch {
    return {};
  }
}
const E = env();
const KEY = E.ALCHEMY_API_KEY || E.ALCHEMY_KEY || "";
const RPC = {
  1: KEY ? `https://eth-mainnet.g.alchemy.com/v2/${KEY}` : "https://eth.drpc.org",
  8453: KEY ? `https://base-mainnet.g.alchemy.com/v2/${KEY}` : "https://base.drpc.org",
  4663: "https://rpc.mainnet.chain.robinhood.com/rpc",
};

const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const ONLY_CHAIN = arg("--chain", null);
const DAYS = Number(arg("--days", "4")); // the designer is "currently testing" — default to the last few days

const fmt6 = (v) => Number(formatUnits(v, 6)).toLocaleString("en-US", { maximumFractionDigits: 4 });
const fmtE = (v) => Number(formatEther(v)).toLocaleString("en-US", { maximumFractionDigits: 6 });
const pct = (num, den) => (den > 0n ? Number((num * 100000n) / den) / 1000 : 0);
const short = (a) => a.slice(0, 8) + "…" + a.slice(-4);

// No creation-block bisection: the Robinhood RPC is NOT archival, so getCode
// at a historic block fails and a bisection quietly converges on the node's
// state horizon (minutes ago) instead of the deploy block — which made the
// first run scan a 10-minute window and report a silent chain. The window is
// the user's --days flag; existence is checked at LATEST only.

/** Address-filtered logs, adaptive chunking (halve on error, never silently skip). */
async function scanLogs(provider, address, fromBlock, toBlock, label) {
  const out = [];
  let span = Math.max(1, Math.min(400_000, toBlock - fromBlock + 1));
  let from = fromBlock;
  while (from <= toBlock) {
    const to = Math.min(from + span - 1, toBlock);
    try {
      const logs = await provider.getLogs({ address, fromBlock: from, toBlock: to });
      out.push(...logs);
      from = to + 1;
      span = Math.min(span * 2, 400_000);
    } catch (e) {
      if (span <= 2_000) throw new Error(`${label}: getLogs stuck at span ${span}: ${e.shortMessage || e.message}`);
      span = Math.floor(span / 2);
    }
  }
  return out;
}

const tsCache = new Map();
async function blockTs(provider, chainId, n) {
  const k = `${chainId}:${n}`;
  if (!tsCache.has(k)) tsCache.set(k, (await provider.getBlock(n)).timestamp);
  return tsCache.get(k);
}
const when = (ts) => new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 19) + "Z";

function decodeLog(log) {
  const hit = byTopic.get(log.topics[0]);
  if (!hit) return { name: "UNKNOWN", raw: log.topics[0] };
  try {
    const parsed = hit.iface.parseLog({ topics: [...log.topics], data: log.data });
    return { name: parsed.name, args: parsed.args, sig: hit.sig };
  } catch {
    return { name: "UNKNOWN", raw: log.topics[0] }; // same name, other lineage's shape
  }
}

// ── the per-chain trace ──────────────────────────────────────────────────────
async function traceChain(chainId) {
  const roles = REHEARSAL[chainId];
  const provider = new JsonRpcProvider(RPC[chainId], undefined, { staticNetwork: true });
  const latest = await provider.getBlockNumber();
  const latestTs = await blockTs(provider, chainId, latest);
  const secsPerBlock = { 1: 12, 8453: 2, 4663: 0.1 }[chainId];
  const windowFloor = Math.max(0, latest - Math.ceil((DAYS * 86_400) / secsPerBlock));

  console.log(`\n════════ ${CH[chainId].toUpperCase()} (${chainId}) — latest block ${latest} · window ≈ last ${DAYS}d ════════`);

  // locate every role — existence checked at latest, scan bounded by --days
  const located = {};
  for (const [role, addr] of Object.entries(roles)) {
    if ((await provider.getCode(addr)) === "0x") {
      console.log(`  ✗ ${role.padEnd(13)} ${short(addr)} — NO CODE on this chain (wrong matrix row?)`);
      continue;
    }
    located[role] = { addr, from: windowFloor };
  }

  // factory first: Launched events discover the test baskets
  const events = []; // {block, ts, role, addr, decoded, log}
  const baskets = new Map(); // addr → {symbol, feeBps, creatorPayout}
  const collect = async (role, addr, from) => {
    const logs = await scanLogs(provider, addr, from, latest, `${CH[chainId]}/${role}`);
    for (const log of logs) events.push({ block: log.blockNumber, role, addr, decoded: decodeLog(log), log });
    return logs.length;
  };

  for (const [role, { addr, from }] of Object.entries(located)) {
    const n = await collect(role, addr, from);
    console.log(`  · ${role.padEnd(13)} ${short(addr)} — ${n} event${n === 1 ? "" : "s"} since block ${from}`);
  }

  for (const ev of events.filter((e) => e.decoded.name === "Launched")) {
    baskets.set(ev.decoded.args.basket.toLowerCase(), { deployer: ev.decoded.args.deployer, feeBps: Number(ev.decoded.args.basketFeeBps) });
  }
  for (const [addr] of baskets) {
    const n = await collect("basket", getAddress(addr), located.factory?.from ?? windowFloor);
    console.log(`  · ${"basket".padEnd(13)} ${short(addr)} — ${n} event${n === 1 ? "" : "s"} (discovered via Launched)`);
  }

  // one ordered timeline
  events.sort((a, b) => a.block - b.block || a.log.index - b.log.index);
  // each basket's creator share (bps), read off its own FeeConfigured — the
  // first-mint fee verdict below needs it to back out the burn BASE
  const creatorShare = new Map();
  for (const ev of events.filter((e) => e.decoded.name === "FeeConfigured"))
    creatorShare.set(ev.addr.toLowerCase(), Number(ev.decoded.args.creatorShareBps));
  if (!events.length) {
    console.log("  (window is silent — no rehearsal activity in range)");
  } else {
    console.log(`\n  ── timeline (${events.length} events) ──`);
    for (const ev of events) {
      const ts = await blockTs(provider, chainId, ev.block);
      const d = ev.decoded;
      const head = `  ${when(ts)}  #${ev.block}  ${ev.role === "basket" ? `basket ${short(ev.addr)}` : ev.role}`;
      if (d.name === "UNKNOWN") {
        console.log(`${head}  ⚠ UNKNOWN event topic0=${d.raw} — trace me before trusting totals`);
        continue;
      }
      const a = d.args;
      const S = SETTLE[chainId];
      switch (d.name) {
        case "Launched":
          console.log(`${head}  🧺 LAUNCHED by ${short(a.deployer)} · fee ${Number(a.basketFeeBps) / 100}% · paid Ξ${fmtE(a.ethPaid)} · basket ${short(a.basket)}`);
          break;
        case "FeeConfigured":
          console.log(`${head}  ⚙ fee ${Number(a.basketFeeBps) / 100}% · creatorShare ${Number(a.creatorShareBps) / 100}% · payout ${a.creatorPayout === "0x0000000000000000000000000000000000000000" ? "none" : short(a.creatorPayout)}`);
          break;
        case "FeesAccrued": {
          const league = a.length === 5 ? a.toLeague : null;
          const total = a.toHolders + a.toBurn + a.toCreator + a.toInterfaceAndLauncher + (league ?? 0n);
          const burnPct = pct(a.toBurn, total);
          const ruled = league != null && league > 0n ? 23.75 : 25;
          let verdict = Math.abs(burnPct - ruled) < 0.05 ? "✓" : `✗ EXPECTED ${ruled}%`;
          if (verdict.startsWith("✗") && a.toHolders === 0n) {
            // No holders yet (the seeding mint): the holders' cut of the
            // post-burn remainder diverts to burn, so measured burn = base +
            // holders' cut. Verify the BASE instead by backing the remainder
            // out of the creator's own cut (creator = shareBps of remainder).
            const cBps = creatorShare.get(ev.addr.toLowerCase()) ?? 0;
            if (cBps > 0 && a.toCreator > 0n) {
              const remainder = (a.toCreator * 10000n) / BigInt(cBps);
              const basePct = pct(total - a.toInterfaceAndLauncher - (league ?? 0n) - remainder, total);
              verdict =
                Math.abs(basePct - ruled) < 0.05
                  ? `✓ ${ruled}% base + holders' cut diverted to burn (no holders yet)`
                  : `✗ EXPECTED ${ruled}% (implied base ${basePct.toFixed(2)}%)`;
            } else {
              verdict = "◦ holders 0, cut diverted to burn; base unverifiable (no creator share)";
            }
          }
          console.log(
            `${head}  ⚡ FEE ${fmt6(total)} ${S} → holders ${fmt6(a.toHolders)} · burn ${fmt6(a.toBurn)} (${burnPct.toFixed(2)}% ${verdict}) · creator ${fmt6(a.toCreator)} · iface+launcher ${fmt6(a.toInterfaceAndLauncher)}${league != null ? ` · league ${fmt6(league)} (${pct(league, total).toFixed(2)}%)` : ""}`,
          );
          break;
        }
        case "Minted":
          console.log(`${head}  🟢 MINT ${fmt6(a.usdcIn)} ${S} → ${fmtE(a.basketOut)} shares`);
          break;
        case "MintedInKind":
          console.log(`${head}  🟢 MINT-IN-KIND ${fmtE(a.shares)} shares · fee ${fmt6(a.feeUsdc)} ${S}`);
          break;
        case "Redeemed":
          console.log(`${head}  🔴 REDEEM ${fmtE(a.basketIn)} shares → ${fmt6(a.usdcOut)} ${S}`);
          break;
        case "Transfer": {
          const zero = "0x0000000000000000000000000000000000000000";
          const move = a.from === zero ? `minted → ${short(a.to)}` : a.to === zero ? `${short(a.from)} → burned` : `${short(a.from)} → ${short(a.to)}`;
          console.log(`${head}     · shares ${fmtE(a.value)} ${move}`);
          break;
        }
        case "Swapped": {
          const sell = a.tokenIn.toLowerCase() === a.basket.toLowerCase();
          const legs = sell ? `SELL ${fmtE(a.amountIn)} shares → ${fmt6(a.amountOut)} ${S}` : `BUY ${fmt6(a.amountIn)} ${S} → ${fmtE(a.amountOut)} shares`;
          console.log(`${head}  🔄 ${legs} · basket ${short(a.basket)} · trader ${short(a.trader)}`);
          break;
        }
        case "PrismBurned":
          console.log(`${head}  🔥 FLUSH→BURN in-protocol: ${fmt6(a.usdcIn)} ${S} → ${fmtE(a.prismBurned)} PRISM dead (Path B — one tx, no bridge)`);
          break;
        case "PrismBurnBridged":
          console.log(`${head}  🔧 FLUSH ${fmt6(a.usdcIn)} ${S} → Ξ${fmtE(a.ethBridged)} toward the collector`);
          break;
        case "PrismBurnWithdrawn":
          console.log(`${head}  🔧 FLUSH ${fmt6(a.usdcIn)} ${S} → Ξ${fmtE(a.ethWithdrawn)} toward the collector`);
          break;
        case "BurnFlushed":
          console.log(`${head}  🔧 FLUSH by keeper ${short(a.keeper)} · Ξ${fmtE(a.ethDelivered)} delivered · bounty Ξ${fmtE(a.bounty)}`);
          break;
        case "LeagueFeesFlushed":
          console.log(`${head}  🏆 LEAGUE flush · creator ${short(a.creator)} · ${fmt6(a.amount)} ${S} · bounty ${fmt6(a.bounty)}`);
          break;
        case "AuctionEscrowed":
          console.log(`${head}  ⚡ LAUNCH FEE escrowed Ξ${fmtE(a.amount)} (${short(a.basket)})`);
          break;
        case "AuctionSentToBurn":
        case "AuctionWithdrawnToBurn":
        case "AuctionBridgedToBurn": {
          const amt = a.amount ?? a.ethWithdrawn ?? a.bridgedEth;
          console.log(`${head}  🔨 LAUNCH-FEE flush Ξ${fmtE(amt)} → ${d.name === "AuctionSentToBurn" ? "burner pot" : "collector/bridge"}`);
          break;
        }
        case "BurnBridgedToL1":
          console.log(`${head}  🌉 COLLECTOR → L1 burner: Ξ${fmtE(a.amount)} (cranked by ${short(a.caller)}) — the one batched withdrawal`);
          break;
        case "BatchExecuted":
          if (a.fundingTotal != null)
            console.log(`${head}  🧾 BATCH by ${short(a.recipient)} · funding ${fmt6(a.fundingTotal)} · fee ${fmt6(a.fee)} · refunded ${fmt6(a.refunded)}`);
          else
            console.log(`${head}  🧾 BATCH by ${short(a.recipient)} · spent ${fmt6(a.spentFunding)} · hubOut Ξ${fmtE(a.hubOut)} · feeEth Ξ${fmtE(a.feeEth)} · legs ${a.legs} (${a.skipped} skipped)`);
          break;
        case "BurnShareDelivered":
          console.log(`${head}  🔥 BATCHER BURN SHARE ${fmt6(a.fundingSpent)} → Ξ${fmtE(a.ethDelivered)} → ${short(a.sink)} (7/8 of the fee)`);
          break;
        case "BurnDiverted": {
          // The 4th field is the raw revert data — the sibling guards are
          // otherwise indistinguishable (SpectrumContracts' selector table,
          // desk w-65, 2026-08-15). MinBurnNotMet on a run that "worked" means
          // the route bought the WRONG asset (e.g. PRISM instead of native
          // ETH) — the exact mistake caught in review that day.
          const DIVERT_WHY = {
            "0x4120b7c2": "BurnSwapFailed — the route never executed (empty/major-fail swap data)",
            "0xddafd724": "MinBurnNotMet — swap ran but delivered ETH under the floor (wrong buy asset?)",
            "0x892aa18c": "BurnFloorIsZero — a zero min-out is refused by design",
            "0x56a218de": "LegOverspent",
            "0xc90023c1": "BurnSendFailed — ETH transfer to the sink failed",
          };
          const sel = typeof a.reason === "string" ? a.reason.slice(0, 10) : "";
          const why = DIVERT_WHY[sel] ?? (sel && sel !== "0x" ? `unknown selector ${sel} — PRINT IT, don't guess` : "no revert data");
          console.log(`${head}  ⚠ BURN DIVERTED ${fmt6(a.amount)} of ${short(a.fundingAsset)} → fallback ${short(a.sink)} — visible, NOT burnt`);
          console.log(`${head}     · why: ${why}`);
          break;
        }
        case "BurnRemainderDiverted":
          console.log(`${head}  ⚠ burn remainder diverted ${fmt6(a.amount)} → ${short(a.sink)}`);
          break;
        case "LegFilled":
        case "BatchLegFilled":
          console.log(`${head}     · leg ${short(a.buyToken ?? a.asset)} filled (${fmt6(a.fundingUsed ?? a.budgetIn)} in)`);
          break;
        case "LegSkipped":
        case "BatchLegSkipped":
          console.log(`${head}     · leg ${short(a.buyToken ?? a.asset)} SKIPPED, refunded`);
          break;
        case "IntegratorFeeAccrued":
          console.log(`${head}     · integrator ${short(a.integrator)} accrued ${fmt6(a.amount)} (1/8 of the fee)`);
          break;
        case "Received":
          console.log(`${head}  📥 BURNER POOLED Ξ${fmtE(a.amount)} from ${short(a.from)} (pools, does not burn)`);
          break;
        case "Burned":
          console.log(`${head}  ☠ BURNER CRANK by ${short(a.caller)}: Ξ${fmtE(a.ethIn)} → ${fmtE(a.prismBurned)} PRISM → dEaD (per-crank, pooled identity)`);
          break;
        case "FeesClaimed":
          console.log(`${head}  💰 holder ${short(a.holder)} claimed ${fmt6(a.amount)}`);
          break;
        case "Initialized":
          console.log(`${head}  🌊 pool initialized (sqrtPriceX96 set)`);
          break;
        case "FactorySeated":
          console.log(`${head}  🪑 SEATED to factory ${short(a.factory)} (pool-first choreography complete)`);
          break;
        default:
          console.log(`${head}  ${d.name}`);
      }
    }
  }

  // ── the live position of every stage, right now ──
  console.log(`\n  ── live position (block ${latest}, ${when(latestTs)}) ──`);
  for (const [addr] of baskets) {
    const c = new Contract(getAddress(addr), GETTERS, provider);
    const [pend, sym] = await Promise.all([c.pendingPrismBurn().catch(() => null), c.symbol().catch(() => "?")]);
    if (pend != null) console.log(`  basket ${sym.padEnd(10)} pendingPrismBurn = ${fmt6(pend)} ${SETTLE[chainId]}  (stage: accruing toward its flush gate)`);
  }
  if (located.factory) {
    const pend = await new Contract(located.factory.addr, GETTERS, provider).pendingAuctionBurn().catch(() => null);
    if (pend != null) console.log(`  factory        pendingAuctionBurn = Ξ${fmtE(pend)}  (launch fees awaiting their crank)`);
  }
  for (const role of ["collector", "collectorGen1", "leaguePool", "burner"]) {
    if (!located[role]) continue;
    const bal = await provider.getBalance(located[role].addr);
    const note =
      role === "burner"
        ? "pooled, dies at the next permissionless crank"
        : role === "leaguePool"
          ? "league slice, seated"
          : "accruing toward its L2→L1 withdrawal threshold";
    console.log(`  ${role.padEnd(14)} balance = Ξ${fmtE(bal)}  (${note})`);
  }
}

// ── run ──────────────────────────────────────────────────────────────────────
console.log("REHEARSAL TRACE — gen-2 decoys · read-only · never the live site");
const chains = ONLY_CHAIN ? [Number(ONLY_CHAIN)] : [4663, 8453, 1];
for (const c of chains) {
  try {
    await traceChain(c);
  } catch (e) {
    console.error(`\n✗ ${CH[c]}: ${e.shortMessage || e.message}`);
  }
}
