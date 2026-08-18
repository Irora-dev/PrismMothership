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
const FACTORY = "0x43edB88C4B80fDD2AdFF2412A7BebF9dF42cB40e";
const MESSAGE_PASSER = "0x4200000000000000000000000000000000000016";
const coder = AbiCoder.defaultAbiCoder();
const portalItf = new Interface([
  "function proveWithdrawalTransaction((uint256 nonce, address sender, address target, uint256 value, uint256 gasLimit, bytes data) _tx, uint256 _disputeGameIndex, (bytes32 version, bytes32 stateRoot, bytes32 messagePasserStorageRoot, bytes32 latestBlockhash) _outputRootProof, bytes[] _withdrawalProof)",
  "function finalizeWithdrawalTransaction((uint256 nonce, address sender, address target, uint256 value, uint256 gasLimit, bytes data) _tx)",
]);
const factoryItf = new Interface(["function gameAtIndex(uint256) view returns (uint32, uint64, address)"]);
const gameItf = new Interface(["function l2SequenceNumber() view returns (uint256)"]);
const T_PROVEN = id("WithdrawalProven(bytes32,address,address)");
const T_FINAL = id("WithdrawalFinalized(bytes32,bool)");
const T_MSG = id("MessagePassed(uint256,address,address,uint256,uint256,bytes,bytes32)");
const call = async (to, itf, fn, args = []) => itf.decodeFunctionResult(fn, await eth.call({ to, data: itf.encodeFunctionData(fn, args) }));

// find the L2 MessagePassed for a withdrawalHash near a guessed L2 block
async function findMessagePassed(withdrawalHash, aroundBlock) {
  for (const span of [5_000, 40_000, 200_000]) {
    const from = Math.max(0, aroundBlock - span);
    const logs = await base.getLogs({ address: MESSAGE_PASSER, topics: [T_MSG], fromBlock: from, toBlock: aroundBlock + 100 });
    for (const l of logs) {
      const [value, gasLimit, data, wh] = coder.decode(["uint256", "uint256", "bytes", "bytes32"], l.data);
      if (wh === withdrawalHash) {
        return { nonce: BigInt(l.topics[1]), sender: `0x${l.topics[2].slice(26)}`, target: `0x${l.topics[3].slice(26)}`, value, gasLimit, data, l2Block: l.blockNumber };
      }
    }
  }
  return null;
}

// ── A. rebuild a real PROVE byte-for-byte ──
const head = await eth.getBlockNumber();
const provenEvs = await eth.getLogs({ address: PORTAL, topics: [T_PROVEN], fromBlock: head - 8_000, toBlock: head });
let done = 0;
for (const ev of provenEvs.reverse()) {
  if (done >= 1) break;
  const tx = await eth.getTransaction(ev.transactionHash);
  if (!tx?.data.startsWith("0x4870496f")) continue; // proveWithdrawalTransaction selector
  const [wtxT, gameIndexT, orpT, proofT] = portalItf.decodeFunctionData("proveWithdrawalTransaction", tx.data);
  // their game → the L2 block the proof must anchor at
  const [, , proxy] = await call(FACTORY, factoryItf, "gameAtIndex", [gameIndexT]);
  const gameBlk = Number((await call(proxy, gameItf, "l2SequenceNumber"))[0]);
  // MY reconstruction, from primary sources only:
  const wh = keccak256(coder.encode(["uint256", "address", "address", "uint256", "uint256", "bytes"], [wtxT[0], wtxT[1], wtxT[2], wtxT[3], wtxT[4], wtxT[5]]));
  const mp = await findMessagePassed(wh, gameBlk);
  if (!mp) { console.log("A. could not locate MessagePassed on L2 within scan spans — trying next"); continue; }
  const blkHex = "0x" + gameBlk.toString(16);
  const gb = await base.send("eth_getBlockByNumber", [blkHex, false]);
  const proofResp = await base.send("eth_getProof", [MESSAGE_PASSER, [keccak256(coder.encode(["bytes32", "uint256"], [wh, 0n]))], blkHex]);
  const myCalldata = portalItf.encodeFunctionData("proveWithdrawalTransaction", [
    [mp.nonce, mp.sender, mp.target, mp.value, mp.gasLimit, mp.data],
    gameIndexT,
    ["0x" + "0".repeat(64), gb.stateRoot, proofResp.storageHash, gb.hash],
    proofResp.storageProof[0].proof,
  ]);
  console.log(`A. PROVE rebuild vs production tx ${ev.transactionHash.slice(0, 14)}:`);
  console.log(`   byte-for-byte equal: ${myCalldata === tx.data ? "✓ IDENTICAL" : "✗ differs"} (mine ${(myCalldata.length - 2) / 2}B, theirs ${(tx.data.length - 2) / 2}B)`);
  try {
    await eth.call({ to: PORTAL, data: myCalldata, from: tx.from, blockTag: ev.blockNumber - 1 });
    const gas = Number((await eth.send("eth_estimateGas", [{ to: PORTAL, data: myCalldata, from: tx.from }, "0x" + (ev.blockNumber - 1).toString(16)]).catch(() => "0x0")));
    console.log(`   my calldata eth_call at block-before-theirs: ✓ GREEN${gas ? ` · gas ~${gas}` : ""}`);
  } catch (e) {
    console.log(`   ✗ my calldata reverts at block-before: ${(e.shortMessage ?? String(e)).slice(0, 120)}`);
  }
  done++;
}

// ── B. rebuild a real FINALIZE byte-for-byte ──
const finalEvs = await eth.getLogs({ address: PORTAL, topics: [T_FINAL], fromBlock: head - 8_000, toBlock: head });
done = 0;
for (const ev of finalEvs.reverse()) {
  if (done >= 1) break;
  const tx = await eth.getTransaction(ev.transactionHash);
  if (!tx?.data.startsWith("0x8c3152e9")) continue; // finalizeWithdrawalTransaction
  const [wtxT] = portalItf.decodeFunctionData("finalizeWithdrawalTransaction", tx.data);
  const wh = keccak256(coder.encode(["uint256", "address", "address", "uint256", "uint256", "bytes"], [wtxT[0], wtxT[1], wtxT[2], wtxT[3], wtxT[4], wtxT[5]]));
  // find its MessagePassed (guess vicinity: base head maps 1:1 in time; withdrawals are typically ≥25h old) — search wide
  const baseHead = await base.getBlockNumber();
  const mp = await findMessagePassed(wh, baseHead - 40_000);
  if (!mp) { console.log("B. MessagePassed not in scan span — trying next"); continue; }
  const myCalldata = portalItf.encodeFunctionData("finalizeWithdrawalTransaction", [[mp.nonce, mp.sender, mp.target, mp.value, mp.gasLimit, mp.data]]);
  console.log(`B. FINALIZE rebuild vs production tx ${ev.transactionHash.slice(0, 14)}:`);
  console.log(`   byte-for-byte equal: ${myCalldata === tx.data ? "✓ IDENTICAL" : "✗ differs"}`);
  try {
    await eth.call({ to: PORTAL, data: myCalldata, from: tx.from, blockTag: ev.blockNumber - 1 });
    console.log("   my calldata eth_call at block-before-theirs: ✓ GREEN");
  } catch (e) {
    console.log(`   ✗ reverts at block-before: ${(e.shortMessage ?? String(e)).slice(0, 120)}`);
  }
  done++;
}
