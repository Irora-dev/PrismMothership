// ── The Base (OP-Stack) settlement reader + finalize builder ─────────────────
// Base withdrawals settle through the OptimismPortal on Ethereum in TWO
// permissionless L1 transactions: proveWithdrawalTransaction (a Merkle storage
// proof of the withdrawal against a dispute game's output root), then — after
// the proof matures — finalizeWithdrawalTransaction. Every mechanic here was
// proven against PRODUCTION before any site code existed (2026-08-18,
// scripts/base-finalize-probe.mjs + the rebuild probe): my constructed prove
// AND finalize calldata came out BYTE-FOR-BYTE IDENTICAL to real successful
// transactions and eth_call'd green at the block before theirs mined.
//
// Measured live, never assumed:
//   · portal 5.2.0 · respectedGameType 621 ("AggregateVerifier" validity
//     games — l2SequenceNumber() replaces l2BlockNumber(), classic output-root
//     semantics verified: rootClaim == keccak(version,stateRoot,storageHash,
//     blockhash))
//   · proofMaturityDelaySeconds = 86_400 (24h — NOT the classic 7 days) ·
//     disputeGameFinalityDelaySeconds = 0
//   · production provers prove against IN-PROGRESS games; validity/maturity is
//     finalize's concern, and portal.checkWithdrawal() is the authoritative
//     honest gate this file surfaces
//   · gasUsed medians over recent real txs: prove ~421k · finalize ~305k
import { AbiCoder, Interface, keccak256, type JsonRpcProvider } from "ethers";

// Verified live 2026-08-18: portal.disputeGameFactory() reads back the factory
// (reciprocal), version() 5.2.0; the messenger is the canonical OP predeploy.
export const BASE_PORTAL_L1 = "0x49048044D57e1C92A77f79988d21Fa8fAF74E97e";
export const BASE_DISPUTE_GAME_FACTORY_L1 = "0x43edB88C4B80fDD2AdFF2412A7BebF9dF42cB40e";
export const BASE_MESSAGE_PASSER_L2 = "0x4200000000000000000000000000000000000016";
export const BASE_PROVE_GAS = 421_000;
export const BASE_FINALIZE_GAS = 305_000;

const coder = AbiCoder.defaultAbiCoder();
export const PORTAL_ITF = new Interface([
  "function respectedGameType() view returns (uint32)",
  "function proofMaturityDelaySeconds() view returns (uint256)",
  "function finalizedWithdrawals(bytes32) view returns (bool)",
  "function numProofSubmitters(bytes32) view returns (uint256)",
  "function proofSubmitters(bytes32, uint256) view returns (address)",
  "function provenWithdrawals(bytes32, address) view returns (address disputeGameProxy, uint64 timestamp)",
  "function checkWithdrawal(bytes32 _withdrawalHash, address _proofSubmitter) view",
  "function proveWithdrawalTransaction((uint256 nonce, address sender, address target, uint256 value, uint256 gasLimit, bytes data) _tx, uint256 _disputeGameIndex, (bytes32 version, bytes32 stateRoot, bytes32 messagePasserStorageRoot, bytes32 latestBlockhash) _outputRootProof, bytes[] _withdrawalProof)",
  "function finalizeWithdrawalTransactionExternalProof((uint256 nonce, address sender, address target, uint256 value, uint256 gasLimit, bytes data) _tx, address _proofSubmitter)",
]);
const FACTORY_ITF = new Interface([
  "function gameCount() view returns (uint256)",
  "function gameAtIndex(uint256) view returns (uint32 gameType_, uint64 timestamp_, address proxy_)",
]);
const GAME_ITF = new Interface([
  "function l2SequenceNumber() view returns (uint256)",
  "function l2BlockNumber() view returns (uint256)",
  "function rootClaim() view returns (bytes32)",
]);
// keccak("MessagePassed(uint256,address,address,uint256,uint256,bytes,bytes32)")
export const TOPIC_MESSAGE_PASSED = "0x02a52367d10742d8032712c1bb8e0144ff1ec5ffda1ed7d70bb05a2744955054";

export interface OpWithdrawal {
  nonce: bigint;
  sender: string;
  target: string;
  value: bigint;
  gasLimit: bigint;
  data: string;
  withdrawalHash: string;
  l2Block: number;
}

const call = async (p: JsonRpcProvider, to: string, itf: Interface, fn: string, args: unknown[] = []) =>
  itf.decodeFunctionResult(fn, await p.call({ to, data: itf.encodeFunctionData(fn, args) }));

/** Find the withdrawal inside a Base transaction's receipt (a collector
 *  flush's bridgeETHTo ends in exactly one MessagePassed). The hash is
 *  re-derived from the fields and asserted against the event's own — a decode
 *  drift here would build proofs for a withdrawal that does not exist. */
export function opWithdrawalFromReceipt(logs: readonly { address: string; topics: readonly string[]; data: string; blockNumber: number }[]): OpWithdrawal | null {
  for (const l of logs) {
    if (l.address.toLowerCase() !== BASE_MESSAGE_PASSER_L2.toLowerCase() || l.topics[0] !== TOPIC_MESSAGE_PASSED) continue;
    const [value, gasLimit, data, withdrawalHash] = coder.decode(["uint256", "uint256", "bytes", "bytes32"], l.data) as unknown as [bigint, bigint, string, string];
    const w: OpWithdrawal = {
      nonce: BigInt(l.topics[1] ?? "0x0"),
      sender: `0x${(l.topics[2] ?? "").slice(26)}`,
      target: `0x${(l.topics[3] ?? "").slice(26)}`,
      value,
      gasLimit,
      data,
      withdrawalHash,
      l2Block: l.blockNumber,
    };
    const computed = keccak256(coder.encode(["uint256", "address", "address", "uint256", "uint256", "bytes"], [w.nonce, w.sender, w.target, w.value, w.gasLimit, w.data]));
    if (computed !== withdrawalHash) return null; // never build against a mis-decode
    return w;
  }
  return null;
}

export type OpStatus =
  | { status: "waiting"; note: string } // no game covers the block yet (~30min cadence)
  | { status: "prove"; to: string; data: string; gameIndex: number } // ready to prove
  | { status: "maturing"; provenAt: number; maturesAt: number } // proven, 24h clock running
  | { status: "ready"; to: string; data: string; proofSubmitter: string } // finalize now
  | { status: "spent" };

/** The newest respected-type game covering an L2 block. Production provers
 *  prove against in-progress games, so no status filter (measured). */
async function newestCoveringGame(eth: JsonRpcProvider, l2Block: number): Promise<{ index: number; proxy: string; blk: number } | null> {
  const gameType = Number((await call(eth, BASE_PORTAL_L1, PORTAL_ITF, "respectedGameType"))[0]);
  const count = Number((await call(eth, BASE_DISPUTE_GAME_FACTORY_L1, FACTORY_ITF, "gameCount"))[0]);
  for (let i = count - 1, walked = 0; i >= 0 && walked < 40; i--, walked++) {
    const [t, , proxy] = (await call(eth, BASE_DISPUTE_GAME_FACTORY_L1, FACTORY_ITF, "gameAtIndex", [i])) as unknown as [bigint, bigint, string];
    if (Number(t) !== gameType) continue;
    const blk = Number(((await call(eth, proxy, GAME_ITF, "l2SequenceNumber").catch(() => call(eth, proxy, GAME_ITF, "l2BlockNumber"))) as unknown as [bigint])[0]);
    if (blk >= l2Block) return { index: i, proxy, blk };
    return null; // games advance monotonically — the newest one not covering means none cover
  }
  return null;
}

/** Classify a Base withdrawal and build the calldata for its NEXT step.
 *  checkWithdrawal (the portal's own view) is the ready gate — never a clock
 *  reimplementation. */
export async function opPreflight(eth: JsonRpcProvider, base: JsonRpcProvider, w: OpWithdrawal): Promise<OpStatus & { provenAt?: number; maturesAt?: number }> {
  const [finalized, nSubmitters] = await Promise.all([
    call(eth, BASE_PORTAL_L1, PORTAL_ITF, "finalizedWithdrawals", [w.withdrawalHash]).then((r) => Boolean(r[0])),
    call(eth, BASE_PORTAL_L1, PORTAL_ITF, "numProofSubmitters", [w.withdrawalHash]).then((r) => Number(r[0])),
  ]);
  if (finalized) return { status: "spent" };

  const txStruct = [w.nonce, w.sender, w.target, w.value, w.gasLimit, w.data];

  if (nSubmitters > 0) {
    const submitter = String((await call(eth, BASE_PORTAL_L1, PORTAL_ITF, "proofSubmitters", [w.withdrawalHash, 0]))[0]);
    const [, provenTs] = (await call(eth, BASE_PORTAL_L1, PORTAL_ITF, "provenWithdrawals", [w.withdrawalHash, submitter])) as unknown as [string, bigint];
    const maturity = Number((await call(eth, BASE_PORTAL_L1, PORTAL_ITF, "proofMaturityDelaySeconds"))[0]);
    // the portal's own gate decides ready — reasons like maturity, game
    // validity and blacklisting all live inside it
    try {
      await eth.call({ to: BASE_PORTAL_L1, data: PORTAL_ITF.encodeFunctionData("checkWithdrawal", [w.withdrawalHash, submitter]) });
      return {
        status: "ready",
        to: BASE_PORTAL_L1,
        data: PORTAL_ITF.encodeFunctionData("finalizeWithdrawalTransactionExternalProof", [txStruct, submitter]),
        proofSubmitter: submitter,
      };
    } catch {
      return { status: "maturing", provenAt: Number(provenTs) * 1000, maturesAt: (Number(provenTs) + maturity) * 1000 };
    }
  }

  const game = await newestCoveringGame(eth, w.l2Block);
  if (!game) return { status: "waiting", note: "no output root covers this withdrawal yet — games post every ~30 minutes" };
  // the output-root proof anchors at the GAME's claimed block (self-checked
  // against the game's rootClaim by construction: the fields ARE the preimage)
  const blkHex = `0x${game.blk.toString(16)}`;
  const gb = (await base.send("eth_getBlockByNumber", [blkHex, false])) as { stateRoot: string; hash: string } | null;
  if (!gb) return { status: "waiting", note: "the covering block is not readable yet" };
  const slot = keccak256(coder.encode(["bytes32", "uint256"], [w.withdrawalHash, 0n]));
  const proofResp = (await base.send("eth_getProof", [BASE_MESSAGE_PASSER_L2, [slot], blkHex])) as { storageHash: string; storageProof: { proof: string[] }[] };
  const data = PORTAL_ITF.encodeFunctionData("proveWithdrawalTransaction", [
    txStruct,
    game.index,
    [`0x${"0".repeat(64)}`, gb.stateRoot, proofResp.storageHash, gb.hash],
    proofResp.storageProof[0]?.proof ?? [],
  ]);
  return { status: "prove", to: BASE_PORTAL_L1, data, gameIndex: game.index };
}
