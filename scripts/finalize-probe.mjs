#!/usr/bin/env node
// Probe: the full Arbitrum Orbit (4663) L2→L1 finalize mechanism, read-only.
// This is the tool that PROVED the finalize crank's mechanics before any site
// code existed (2026-08-16), and it re-proves them on demand — run it before
// trusting the crank after anything upstream changes, and run it as the
// windows close to see exactly where each of our crossings stands. Ladder:
//  1. our burner-destined withdrawals (dest = the L1 burner) with positions
//  2. latest SendRootUpdated on the L1 outbox → which topic is the l2 block hash
//  3. that L2 block's sendCount (the confirmed size)
//  4. constructOutboxProof for a confirmed position via NodeInterface
//  5. roots(root) posted on L1
//  6. isSpent() splits executed from unexecuted
//  7. eth_call an encoded executeTransaction for a confirmed-but-unexecuted
//     withdrawal → success = the entire pipeline is right, byte for byte
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AbiCoder, Interface, JsonRpcProvider, formatEther, id } from "ethers";

const env = Object.fromEntries(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const l2 = new JsonRpcProvider(env.ROBINHOOD_RPC_URL, 4663, { staticNetwork: true });
const l1 = new JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`, 1, { staticNetwork: true });

const OUTBOX = "0xf0ce991ea4a0d2400a4ab49b20ae333f6dce3de9";
const ARB_SYS = "0x0000000000000000000000000000000000000064";
const NODE_ITF = "0x00000000000000000000000000000000000000C8";
const BURNER = "0x2E39Ae825C697BE3e15ACd003d1398287C83D4b6";
const T_L2_TO_L1 = id("L2ToL1Tx(address,address,uint256,uint256,uint256,uint256,uint256,uint256,bytes)");
const T_SENDROOT = id("SendRootUpdated(bytes32,bytes32)");
console.log("T_L2_TO_L1", T_L2_TO_L1, T_L2_TO_L1 === "0x3e7aafa77dbf186b7fd488006beff893744caa3c4f6f299e8a709fa2087374fc" ? "✓ matches tool" : "✗ MISMATCH");
console.log("T_SENDROOT", T_SENDROOT);

const coder = AbiCoder.defaultAbiCoder();
const pad = (a) => "0x" + "0".repeat(24) + a.slice(2).toLowerCase();

// ── 1. our withdrawals: destination = the burner ──
const ours = await l2.getLogs({ address: ARB_SYS, topics: [T_L2_TO_L1, pad(BURNER)], fromBlock: 33_000_000, toBlock: "latest" });
console.log(`\n1. withdrawals to the burner: ${ours.length}`);
const decode = (lg) => {
  const [caller, arbBlockNum, ethBlockNum, timestamp, callvalue, data] = coder.decode(
    ["address", "uint256", "uint256", "uint256", "uint256", "bytes"], lg.data);
  return { caller, dest: "0x" + lg.topics[1].slice(26), position: BigInt(lg.topics[3]),
    arbBlockNum, ethBlockNum, timestamp, callvalue, data, tx: lg.transactionHash, block: lg.blockNumber };
};
const mine = ours.map(decode);
for (const w of mine) console.log(`   pos ${w.position} · Ξ${formatEther(w.callvalue)} · ts ${new Date(Number(w.timestamp) * 1000).toISOString()} · data ${w.data === "0x" ? "empty ✓" : "NONEMPTY ✗"} · tx ${w.tx.slice(0, 14)}`);

// ── 2. latest SendRootUpdated on the outbox ──
const l1Head = await l1.getBlockNumber();
let srLogs = [];
for (let from = l1Head - 5_000; srLogs.length === 0 && from > l1Head - 80_000; from -= 5_000) {
  srLogs = await l1.getLogs({ address: OUTBOX, topics: [T_SENDROOT], fromBlock: from, toBlock: from + 5_000 });
}
if (!srLogs.length) { console.log("✗ no SendRootUpdated found in the last 80k L1 blocks"); process.exit(1); }
const sr = srLogs[srLogs.length - 1];
console.log(`\n2. latest SendRootUpdated @ L1 block ${sr.blockNumber} (head ${l1Head})`);
console.log(`   topic1 ${sr.topics[1]}`);
console.log(`   topic2 ${sr.topics[2]}`);

// ── 3. which topic is the L2 block hash? ask the L2 for both, raw ──
let l2blk = null, rootTopic = null, hashTopic = null;
for (const [i, t] of [[1, sr.topics[1]], [2, sr.topics[2]]]) {
  const b = await l2.send("eth_getBlockByHash", [t, false]).catch(() => null);
  if (b) { l2blk = b; hashTopic = t; rootTopic = sr.topics[i === 1 ? 2 : 1]; console.log(`   topic${i} IS the l2 block hash`); }
}
if (!l2blk) { console.log("✗ neither topic resolves as an L2 block"); process.exit(1); }
console.log(`   l2 block ${parseInt(l2blk.number, 16)} · sendCount field: ${l2blk.sendCount ?? "MISSING"} · sendRoot: ${(l2blk.sendRoot ?? "MISSING").slice(0, 18)}…`);
const size = BigInt(l2blk.sendCount ?? 0);
console.log(`   confirmed size = ${size}`);
console.log(`   sendRoot === rootTopic? ${l2blk.sendRoot?.toLowerCase() === rootTopic.toLowerCase() ? "✓" : "✗ " + rootTopic}`);

// ── 4. roots(root) on the outbox must return that block hash ──
const outboxItf = new Interface([
  "function roots(bytes32) view returns (bytes32)",
  "function isSpent(uint256) view returns (bool)",
  "function executeTransaction(bytes32[] proof, uint256 index, address l2Sender, address to, uint256 l2Block, uint256 l1Block, uint256 l2Timestamp, uint256 value, bytes data)",
]);
const rootsRet = await l1.call({ to: OUTBOX, data: outboxItf.encodeFunctionData("roots", [rootTopic]) });
console.log(`\n4. outbox.roots(root) = ${rootsRet.slice(0, 18)}… ${rootsRet.toLowerCase() === hashTopic.toLowerCase() ? "✓ == l2 block hash" : "✗"}`);

// ── 5+6. find a confirmed-but-unexecuted withdrawal from the chain's history ──
const all = await l2.getLogs({ address: ARB_SYS, topics: [T_L2_TO_L1], fromBlock: 0, toBlock: "latest" });
console.log(`\n5. lifetime L2ToL1Tx events: ${all.length}`);
const candidates = all.map(decode).filter((w) => w.position < size && w.data === "0x" && w.callvalue > 0n);
console.log(`   bare-ETH + confirmed (pos < ${size}): ${candidates.length}`);
let target = null;
for (const w of candidates.reverse()) {
  const spent = await l1.call({ to: OUTBOX, data: outboxItf.encodeFunctionData("isSpent", [w.position]) });
  if (BigInt(spent) === 0n) { target = w; break; }
}
if (!target) { console.log("   every confirmed withdrawal is spent — will only prove the ALREADY_SPENT path"); }
else console.log(`   unexecuted confirmed target: pos ${target.position} · Ξ${formatEther(target.callvalue)} → ${target.dest}`);

// ── 7. construct the proof + eth_call MY executeTransaction ──
const nodeItf = new Interface(["function constructOutboxProof(uint64 size, uint64 leaf) view returns (bytes32 send, bytes32 root, bytes32[] proof)"]);
async function proveAndCall(w, label) {
  const ret = await l2.call({ to: NODE_ITF, data: nodeItf.encodeFunctionData("constructOutboxProof", [size, w.position]) });
  const [send, root, proof] = nodeItf.decodeFunctionResult("constructOutboxProof", ret);
  const known = await l1.call({ to: OUTBOX, data: outboxItf.encodeFunctionData("roots", [root]) });
  console.log(`\n7. [${label}] proof depth ${proof.length} · root known on L1: ${BigInt(known) !== 0n ? "✓" : "✗ (" + root.slice(0, 12) + ")"}`);
  const calldata = outboxItf.encodeFunctionData("executeTransaction", [
    [...proof], w.position, w.caller, w.dest, w.arbBlockNum, w.ethBlockNum, w.timestamp, w.callvalue, w.data]);
  try {
    await l1.call({ to: OUTBOX, data: calldata, from: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" });
    const gas = await l1.estimateGas({ to: OUTBOX, data: calldata, from: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" });
    console.log(`   eth_call executeTransaction: ✓ SUCCEEDS · estimateGas ${gas}`);
  } catch (e) {
    console.log(`   eth_call executeTransaction: reverts → ${(e.reason ?? e.shortMessage ?? String(e)).slice(0, 120)}`);
  }
}
if (target) await proveAndCall(target, "confirmed unexecuted");
// also prove the ALREADY_SPENT shape on an executed one (valid proof reaches the spent check)
const spentOne = [];
for (const w of candidates) { // candidates is reversed (oldest now first after reverse? keep simple: scan few)
  const s = await l1.call({ to: OUTBOX, data: outboxItf.encodeFunctionData("isSpent", [w.position]) });
  if (BigInt(s) === 1n) { spentOne.push(w); break; }
}
if (spentOne.length) await proveAndCall(spentOne[0], "already executed");

// ── 8. our three: confirm they are NOT yet confirmed (pos >= size) ──
console.log(`\n8. our withdrawals vs confirmed size ${size}:`);
for (const w of mine) console.log(`   pos ${w.position}: ${w.position < size ? "CONFIRMED (executable now!)" : "not yet confirmed — waiting, as expected"}`);
