// One-off audit: validate every decode assumption the charts store makes,
// against live logs on public RPCs. Run: node scripts/verify-chart-sources.mjs
import { AbiCoder, JsonRpcProvider, formatUnits, getAddress, id, zeroPadValue } from "ethers";

const abi = AbiCoder.defaultAbiCoder();
const PRISM = "0xbd3AB5859f244CC9F51Ee0Ca755c5cf663D80040";
const DSTABLE_BASE = "0x51f2817b06de142021fbff00ac9b56ad84e84088";
const DEAD = "0x000000000000000000000000000000000000dEaD";
const TOKENS = [
  "0x8281833536a41337e2c9450a0277416049514088",
  "0xab50550986c47facb24ab4aa4e08e0a6f952c088",
  "0x2eea2b522cf630aa7883cf0ee7674803e6784088",
  "0x036c7e64dd0b1a11660754f3e328402aae5ec088",
];
const T = {
  minted: id("Minted(address,uint256,uint256)"),
  sell: id("SellViaSwap(address,uint256,uint256)"),
  feesPoked: id("FeesPoked(uint256,uint256)"),
  transfer: id("Transfer(address,address,uint256)"),
};

const eth = new JsonRpcProvider(process.env.RPC_URL || "https://ethereum-rpc.publicnode.com", 1, { staticNetwork: true });
const base = new JsonRpcProvider(process.env.BASE_RPC_URL || "https://mainnet.base.org", 8453, { staticNetwork: true });

async function scanBack(provider, filter, latest, span, maxWindows, want) {
  const out = [];
  for (let i = 0; i < maxWindows && out.length < want; i++) {
    const to = latest - i * span;
    const from = to - span + 1;
    try {
      out.push(...(await provider.getLogs({ ...filter, fromBlock: from, toBlock: to })));
    } catch (e) {
      console.log(`  (window ${from}-${to} failed: ${String(e).slice(0, 80)})`);
    }
  }
  return out;
}

// ── 1. Base trades: Minted / SellViaSwap ──────────────────────────────────────
const bLatest = await base.getBlockNumber();
console.log("Base latest block:", bLatest);
const trades = await scanBack(base, { address: TOKENS, topics: [[T.minted, T.sell]] }, bLatest, 9000, 220, 6);
console.log(`\n── Base trades found: ${trades.length}`);
for (const l of trades.slice(-6)) {
  const isBuy = l.topics[0] === T.minted;
  const [a, b] = abi.decode(["uint256", "uint256"], l.data);
  const trader = l.topics[1] ? getAddress("0x" + l.topics[1].slice(26)) : "(no indexed user!)";
  const dstableLeg = isBuy ? a : b;
  const indexLeg = isBuy ? b : a;
  // FINDING (2026-07-04): topics[1] is the V4 PoolManager (0x498581fF…) on every
  // trade, buys and sells alike — the real wallet is tx.from. charts.ts now
  // attributes traders via getTransaction(txHash).from for exactly this reason.
  const rc = await base.getTransactionReceipt(l.transactionHash);
  console.log(
    `${isBuy ? "BUY " : "SELL"} blk ${l.blockNumber} tx ${l.transactionHash.slice(0, 14)}… token ${l.address.slice(0, 10)}…`,
    `\n     dstable leg (6dp): $${formatUnits(dstableLeg, 6)}  index leg (18dp): ${formatUnits(indexLeg, 18)}`,
    `\n     topics[1]: ${trader}  tx.from: ${rc.from}  (topics[1] is the PoolManager, NOT the trader)`,
  );
  // Cross-check vs the actual dstable Transfers in the same tx: gross or net?
  const ds = rc.logs.filter((x) => x.address.toLowerCase() === DSTABLE_BASE && x.topics[0] === T.transfer);
  for (const t of ds) {
    const from = getAddress("0x" + t.topics[1].slice(26));
    const to = getAddress("0x" + t.topics[2].slice(26));
    const v = abi.decode(["uint256"], t.data)[0];
    console.log(`     dstable Transfer $${formatUnits(v, 6)}  ${from.slice(0, 10)}… → ${to.slice(0, 10)}…${to.toLowerCase() === trader.toLowerCase() ? "  (to trader)" : from.toLowerCase() === trader.toLowerCase() ? "  (from trader)" : ""}`);
  }
}

// ── 2. ETH: FeesPoked legs ────────────────────────────────────────────────────
const eLatest = await eth.getBlockNumber();
console.log("\nETH latest block:", eLatest);
const fees = await scanBack(eth, { address: PRISM, topics: [T.feesPoked] }, eLatest, 9000, 60, 5);
console.log(`── FeesPoked found: ${fees.length}`);
for (const l of fees.slice(-5)) {
  const [x, y] = abi.decode(["uint256", "uint256"], l.data);
  console.log(`  blk ${l.blockNumber}: leg0 = ${formatUnits(x, 18)} (ETH?)  leg1 = ${formatUnits(y, 18)} (PRISM?)`);
}

// ── 3. ETH: burns to dEaD ─────────────────────────────────────────────────────
const burns = await scanBack(eth, { address: PRISM, topics: [T.transfer, null, zeroPadValue(DEAD, 32)] }, eLatest, 9000, 60, 4);
console.log(`── Burns found: ${burns.length}`);
for (const l of burns.slice(-4)) {
  const v = abi.decode(["uint256"], l.data)[0];
  console.log(`  blk ${l.blockNumber}: ${formatUnits(v, 18)} PRISM from ${getAddress("0x" + l.topics[1].slice(26)).slice(0, 12)}…`);
}

// ── 4. Block-time reality check (for the 12s/2s ts estimates) ────────────────
const [eNow, eOld, bNow, bOld] = await Promise.all([
  eth.getBlock(eLatest),
  eth.getBlock(eLatest - 1_000_000),
  base.getBlock(bLatest),
  base.getBlock(bLatest - 1_000_000),
]);
console.log(`\nETH avg s/block over last 1M blocks: ${((eNow.timestamp - eOld.timestamp) / 1_000_000).toFixed(4)} (store assumes 12)`);
console.log(`Base avg s/block over last 1M blocks: ${((bNow.timestamp - bOld.timestamp) / 1_000_000).toFixed(4)} (store assumes 2)`);
