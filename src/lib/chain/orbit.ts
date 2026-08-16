// ── The Arbitrum Orbit settlement reader (4663 → Ethereum) ───────────────────
// One home for the mechanics the finalize crank rides on, shared by the
// burn-pipeline route (true executability per withdrawal) and the finalize
// preflight route (the proof + calldata the wallet sends). Every shape here
// was proven live against already-settled withdrawals before any UI existed:
// scripts/finalize-probe.mjs constructs a proof and eth_calls the resulting
// executeTransaction green against a real confirmed-unexecuted withdrawal.
import { AbiCoder, Interface, type JsonRpcProvider, type Log } from "ethers";
import { ARB_NODE_INTERFACE, ARB_SYS, HOOD_OUTBOX_L1, TOPIC_ARB } from "./constants";

/** Every field of an ArbSys L2→L1 withdrawal — exactly the executeTransaction
 *  argument list, so the finalize route re-derives nothing. */
export interface OrbitWithdrawal {
  caller: string; // the L2 contract that called ArbSys (collector / factory)
  destination: string;
  position: bigint;
  arbBlockNum: bigint;
  ethBlockNum: bigint;
  timestamp: bigint;
  callvalue: bigint;
  data: string;
}

export const OUTBOX_ITF = new Interface([
  "function roots(bytes32) view returns (bytes32)",
  "function isSpent(uint256) view returns (bool)",
  "function executeTransaction(bytes32[] proof, uint256 index, address l2Sender, address to, uint256 l2Block, uint256 l1Block, uint256 l2Timestamp, uint256 value, bytes data)",
]);
const NODE_ITF = new Interface(["function constructOutboxProof(uint64 size, uint64 leaf) view returns (bytes32 send, bytes32 root, bytes32[] proof)"]);

export function decodeL2ToL1(log: { topics: readonly string[]; data: string }): OrbitWithdrawal | null {
  if (log.topics[0] !== TOPIC_ARB.l2ToL1Tx) return null;
  const [caller, arbBlockNum, ethBlockNum, timestamp, callvalue, data] = AbiCoder.defaultAbiCoder().decode(
    ["address", "uint256", "uint256", "uint256", "uint256", "bytes"],
    log.data,
  ) as unknown as [string, bigint, bigint, bigint, bigint, string];
  return { caller, destination: `0x${(log.topics[1] ?? "").slice(26)}`, position: BigInt(log.topics[3] ?? "0x0"), arbBlockNum, ethBlockNum, timestamp, callvalue, data };
}

/** The rollup's confirmed frontier: the Outbox announces each confirmation via
 *  SendRootUpdated(root, l2BlockHash), and that L2 block's header carries the
 *  confirmed sendCount (a nitro RPC field, proven live 2026-08-16). A
 *  withdrawal is executable exactly when `position < sendCount` — the same
 *  check the L1 contract applies, so READY is never a wall-clock guess. */
let confirmedCache: { at: number; size: number } | null = null;
export async function confirmedSendCount(eth: JsonRpcProvider, hood: JsonRpcProvider | null): Promise<number> {
  if (confirmedCache && Date.now() - confirmedCache.at < 120_000) return confirmedCache.size;
  if (!hood) return confirmedCache?.size ?? 0;
  try {
    const head = await eth.getBlockNumber();
    let logs: Log[] = [];
    let hi = head;
    // assertions confirm every few hours; one ~5.5-day window nearly always hits
    for (let i = 0; i < 3 && logs.length === 0; i++) {
      logs = await eth.getLogs({ address: HOOD_OUTBOX_L1, topics: [TOPIC_ARB.sendRootUpdated], fromBlock: hi - 40_000, toBlock: hi });
      hi -= 40_000;
    }
    const last = logs[logs.length - 1];
    if (!last) return confirmedCache?.size ?? 0;
    const blk = (await hood.send("eth_getBlockByHash", [last.topics[2], false])) as { sendCount?: string } | null;
    const size = Number(BigInt(blk?.sendCount ?? "0x0"));
    if (size > 0) confirmedCache = { at: Date.now(), size };
    return size > 0 ? size : (confirmedCache?.size ?? 0);
  } catch {
    // a failed read degrades to the last known frontier (or 0) — rows then
    // simply stay "window"; READY must never be claimed without the real gate
    return confirmedCache?.size ?? 0;
  }
}

export async function isSpent(eth: JsonRpcProvider, position: bigint): Promise<boolean> {
  const ret = await eth.call({ to: HOOD_OUTBOX_L1, data: OUTBOX_ITF.encodeFunctionData("isSpent", [position]) });
  return BigInt(ret) !== 0n;
}

/** Build the exact executeTransaction calldata for a confirmed withdrawal.
 *  Returns null (never a wrong payload) if the proof's root is not actually
 *  posted on the L1 Outbox — the belt to constructOutboxProof's braces. */
export async function buildExecuteCalldata(
  eth: JsonRpcProvider,
  hood: JsonRpcProvider,
  w: OrbitWithdrawal,
  size: number,
): Promise<{ to: string; data: string; proofDepth: number } | null> {
  const ret = await hood.call({ to: ARB_NODE_INTERFACE, data: NODE_ITF.encodeFunctionData("constructOutboxProof", [size, w.position]) });
  const [, root, proof] = NODE_ITF.decodeFunctionResult("constructOutboxProof", ret) as unknown as [string, string, string[]];
  const known = await eth.call({ to: HOOD_OUTBOX_L1, data: OUTBOX_ITF.encodeFunctionData("roots", [root]) });
  if (BigInt(known) === 0n) return null;
  const data = OUTBOX_ITF.encodeFunctionData("executeTransaction", [
    [...proof],
    w.position,
    w.caller,
    w.destination,
    w.arbBlockNum,
    w.ethBlockNum,
    w.timestamp,
    w.callvalue,
    w.data,
  ]);
  return { to: HOOD_OUTBOX_L1, data, proofDepth: proof.length };
}

/** Find the withdrawal inside a 4663 transaction's receipt (a flush tx). */
export function withdrawalFromReceipt(logs: readonly { address: string; topics: readonly string[]; data: string }[]): OrbitWithdrawal | null {
  for (const l of logs) {
    if (l.address.toLowerCase() !== ARB_SYS.toLowerCase()) continue;
    const w = decodeL2ToL1(l);
    if (w && w.data === "0x" && w.callvalue > 0n) return w; // the bare-ETH withdrawEth shape
  }
  return null;
}
