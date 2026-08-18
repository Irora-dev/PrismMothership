#!/usr/bin/env node
// Probe: the full Base (OP-Stack, OptimismPortal 5.x + validity games) L2→L1
// withdrawal finalize mechanism, read-only, proven against ALREADY-SETTLED
// withdrawals BEFORE any site code exists — the same ladder that armed the
// 4663 finalize crank (scripts/finalize-probe.mjs). Ladder:
//  1. portal parameters (game type, proof maturity, finality delay) — live
//  2. resolved games of the respected type from the factory
//  3. real MessagePassed withdrawals on L2; compute withdrawalHash; classify
//     via portal reads (finalized / proven+submitters / unproven)
//  4. UNPROVEN + game-covered → construct the FULL proveWithdrawalTransaction
//     (output-root proof self-checked against the game's own rootClaim,
//     eth_getProof storage proof) → eth_call GREEN + estimateGas
//  5. PROVEN ≥ maturity + unfinalized → construct finalizeWithdrawalTransaction
//     → checkWithdrawal green → eth_call GREEN + estimateGas
import { readFileSync } from "node:fs";
import { AbiCoder, Interface, JsonRpcProvider, id, keccak256 } from "ethers";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url).pathname, "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const eth = new JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`, 1, { staticNetwork: true });
const base = new JsonRpcProvider(`https://base-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`, 8453, { staticNetwork: true });

const PORTAL = "0x49048044D57e1C92A77f79988d21Fa8fAF74E97e";
const MESSAGE_PASSER = "0x4200000000000000000000000000000000000016";
const PROBE_FROM = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const coder = AbiCoder.defaultAbiCoder();

const portalItf = new Interface([
  "function disputeGameFactory() view returns (address)",
  "function respectedGameType() view returns (uint32)",
  "function proofMaturityDelaySeconds() view returns (uint256)",
  "function finalizedWithdrawals(bytes32) view returns (bool)",
  "function numProofSubmitters(bytes32) view returns (uint256)",
  "function proofSubmitters(bytes32, uint256) view returns (address)",
  "function checkWithdrawal(bytes32 _withdrawalHash, address _proofSubmitter) view",
  "function proveWithdrawalTransaction((uint256 nonce, address sender, address target, uint256 value, uint256 gasLimit, bytes data) _tx, uint256 _disputeGameIndex, (bytes32 version, bytes32 stateRoot, bytes32 messagePasserStorageRoot, bytes32 latestBlockhash) _outputRootProof, bytes[] _withdrawalProof)",
  "function finalizeWithdrawalTransactionExternalProof((uint256 nonce, address sender, address target, uint256 value, uint256 gasLimit, bytes data) _tx, address _proofSubmitter)",
]);
const factoryItf = new Interface([
  "function gameCount() view returns (uint256)",
  "function gameAtIndex(uint256) view returns (uint32 gameType_, uint64 timestamp_, address proxy_)",
]);
const gameItf = new Interface([
  "function l2BlockNumber() view returns (uint256)",
  // the type-621 AggregateVerifier (super-root validity game) renames the
  // getter — measured live 2026-08-18; the value IS the covered L2 block
  "function l2SequenceNumber() view returns (uint256)",
  "function rootClaim() view returns (bytes32)",
  "function status() view returns (uint8)", // 0 in-progress · 1 challenger wins · 2 defender wins
  "function resolvedAt() view returns (uint64)",
]);
const T_MSG = id("MessagePassed(uint256,address,address,uint256,uint256,bytes,bytes32)");

const call = async (p, to, itf, fn, args = []) => itf.decodeFunctionResult(fn, await p.call({ to, data: itf.encodeFunctionData(fn, args) }));

// ── 1. portal parameters ──
const factory = (await call(eth, PORTAL, portalItf, "disputeGameFactory"))[0];
const gameType = Number((await call(eth, PORTAL, portalItf, "respectedGameType"))[0]);
const maturitySec = Number((await call(eth, PORTAL, portalItf, "proofMaturityDelaySeconds"))[0]);
console.log(`1. portal: factory ${factory} · respectedGameType ${gameType} · proofMaturity ${maturitySec / 3600}h`);

// ── 2. resolved games of the respected type (newest back) ──
const count = Number((await call(eth, factory, factoryItf, "gameCount"))[0]);
const games = [];
for (let i = count - 1; i >= 0 && games.length < 25; i--) {
  const [t, , proxy] = await call(eth, factory, factoryItf, "gameAtIndex", [i]);
  if (Number(t) !== gameType) continue;
  const [blk, claim, status] = await Promise.all([
    call(eth, proxy, gameItf, "l2SequenceNumber").catch(() => call(eth, proxy, gameItf, "l2BlockNumber")).then((r) => Number(r[0])),
    call(eth, proxy, gameItf, "rootClaim").then((r) => r[0]),
    call(eth, proxy, gameItf, "status").then((r) => Number(r[0])),
  ]);
  games.push({ index: i, proxy, blk, claim, status });
}
console.log("   statuses walked:", games.map((g) => g.status).join(","));
// Production provers prove against IN-PROGRESS games (decoded from real prove
// txs 2026-08-18: game status 0, classic output-root semantics verified) —
// resolution is a finalize-time concern the portal's checkWithdrawal owns.
const usable = games; // newest-first
console.log(`2. games: ${games.length} of type ${gameType} walked · newest covers L2 block ${usable[0]?.blk}`);
if (!usable.length) { console.log("✗ no games — cannot proceed"); process.exit(1); }

// ── 3. real withdrawals, two vintages: recent (prove candidates) + old (finalize candidates) ──
const baseHead = await base.getBlockNumber();
async function withdrawalsIn(from, to) {
  const logs = await base.getLogs({ address: MESSAGE_PASSER, topics: [T_MSG], fromBlock: from, toBlock: to });
  return logs.map((l) => {
    const [value, gasLimit, data, withdrawalHash] = coder.decode(["uint256", "uint256", "bytes", "bytes32"], l.data);
    return {
      nonce: BigInt(l.topics[1]),
      sender: `0x${l.topics[2].slice(26)}`,
      target: `0x${l.topics[3].slice(26)}`,
      value, gasLimit, data, withdrawalHash,
      l2Block: l.blockNumber, tx: l.transactionHash,
    };
  });
}
const recent = await withdrawalsIn(baseHead - 3_000, baseHead);
const old = await withdrawalsIn(baseHead - 50_000, baseHead - 44_000); // ~27-28h ago
console.log(`3. withdrawals: ${recent.length} in the last ~100min · ${old.length} at ~27h ago`);

const hashOf = (w) => keccak256(coder.encode(["uint256", "address", "address", "uint256", "uint256", "bytes"], [w.nonce, w.sender, w.target, w.value, w.gasLimit, w.data]));
// verify our hash construction against the event's own withdrawalHash — 3 samples
for (const w of recent.slice(0, 3)) {
  if (hashOf(w) !== w.withdrawalHash) { console.log("✗ withdrawalHash construction mismatch — abort"); process.exit(1); }
}
console.log("   ✓ withdrawalHash construction matches the event's own hash (3/3)");

async function classify(w) {
  const [fin, n] = await Promise.all([
    call(eth, PORTAL, portalItf, "finalizedWithdrawals", [w.withdrawalHash]).then((r) => r[0]),
    call(eth, PORTAL, portalItf, "numProofSubmitters", [w.withdrawalHash]).then((r) => Number(r[0])),
  ]);
  return fin ? "finalized" : n > 0 ? "proven" : "unproven";
}

// ── 4. the PROVE leg: unproven + covered by the newest game (production behavior) ──
const coveringGame = usable[0];
let proveTarget = null;
for (const w of recent) {
  if (w.l2Block > coveringGame.blk) continue;
  if ((await classify(w)) === "unproven") { proveTarget = w; break; }
}
if (!proveTarget) console.log("4. no unproven covered withdrawal in the window — skipping the prove leg this run");
else {
  console.log(`4. prove target: ${proveTarget.withdrawalHash.slice(0, 14)} @ L2 block ${proveTarget.l2Block} · covered by game #${coveringGame.index} (block ${coveringGame.blk})`);
  // output-root proof at the GAME's claimed block, self-checked against rootClaim
  const blkHex = "0x" + coveringGame.blk.toString(16);
  const gb = await base.send("eth_getBlockByNumber", [blkHex, false]);
  const mp = await base.send("eth_getProof", [MESSAGE_PASSER, [], blkHex]);
  const outputRoot = keccak256(coder.encode(["bytes32", "bytes32", "bytes32", "bytes32"], ["0x" + "0".repeat(64), gb.stateRoot, mp.storageHash, gb.hash]));
  console.log(`   output root self-check: ${outputRoot === coveringGame.claim ? "✓ equals the game's rootClaim" : `✗ MISMATCH (${outputRoot.slice(0, 12)} vs ${coveringGame.claim.slice(0, 12)})`}`);
  if (outputRoot !== coveringGame.claim) process.exit(1);
  const slot = keccak256(coder.encode(["bytes32", "uint256"], [proveTarget.withdrawalHash, 0n]));
  const sp = await base.send("eth_getProof", [MESSAGE_PASSER, [slot], blkHex]);
  const proof = sp.storageProof[0].proof;
  const txStruct = [proveTarget.nonce, proveTarget.sender, proveTarget.target, proveTarget.value, proveTarget.gasLimit, proveTarget.data];
  const dataProve = portalItf.encodeFunctionData("proveWithdrawalTransaction", [txStruct, coveringGame.index, ["0x" + "0".repeat(64), gb.stateRoot, mp.storageHash, gb.hash], proof]);
  try {
    await eth.call({ to: PORTAL, data: dataProve, from: PROBE_FROM });
    const gas = await eth.estimateGas({ to: PORTAL, data: dataProve, from: PROBE_FROM });
    console.log(`   proveWithdrawalTransaction eth_call: ✓ GREEN · estimateGas ${gas} · proof depth ${proof.length}`);
  } catch (e) {
    console.log(`   ✗ prove reverts: ${(e.shortMessage ?? String(e)).slice(0, 140)}`);
  }
}

// ── 5. the FINALIZE leg: proven ≥ maturity + unfinalized ──
let finTarget = null;
for (const w of old) {
  if ((await classify(w)) === "proven") { finTarget = w; break; }
}
if (!finTarget) console.log("5. no proven-unfinalized withdrawal at ~27h — skipping the finalize leg this run");
else {
  const submitter = (await call(eth, PORTAL, portalItf, "proofSubmitters", [finTarget.withdrawalHash, 0]))[0];
  console.log(`5. finalize target: ${finTarget.withdrawalHash.slice(0, 14)} · proof submitter ${submitter.slice(0, 12)}`);
  try {
    await eth.call({ to: PORTAL, data: portalItf.encodeFunctionData("checkWithdrawal", [finTarget.withdrawalHash, submitter]), from: PROBE_FROM });
    console.log("   checkWithdrawal: ✓ finalizable now");
  } catch (e) {
    console.log(`   checkWithdrawal says not yet: ${(e.shortMessage ?? String(e)).slice(0, 120)}`);
  }
  const txStruct = [finTarget.nonce, finTarget.sender, finTarget.target, finTarget.value, finTarget.gasLimit, finTarget.data];
  const dataFin = portalItf.encodeFunctionData("finalizeWithdrawalTransactionExternalProof", [txStruct, submitter]);
  try {
    await eth.call({ to: PORTAL, data: dataFin, from: PROBE_FROM });
    const gas = await eth.estimateGas({ to: PORTAL, data: dataFin, from: PROBE_FROM });
    console.log(`   finalizeWithdrawalTransactionExternalProof eth_call: ✓ GREEN · estimateGas ${gas}`);
  } catch (e) {
    console.log(`   ✗ finalize reverts: ${(e.shortMessage ?? String(e)).slice(0, 140)}`);
  }
}
