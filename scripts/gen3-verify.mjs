#!/usr/bin/env node
// Independent read-back of the GEN-3 production set before the site wires it.
// SpectrumContracts read back 18/18 and cast-verified; this is the site's OWN
// look (house rule: never wire an address whose key pointers you have not read
// off the deployed contract yourself). Read-only.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Interface, JsonRpcProvider } from "ethers";

const env = Object.fromEntries(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const P = {
  ethereum: new JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`, 1, { staticNetwork: true }),
  base: new JsonRpcProvider(`https://base-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`, 8453, { staticNetwork: true }),
  robinhood: new JsonRpcProvider(env.ROBINHOOD_RPC_URL, 4663, { staticNetwork: true }),
};
const BURNER = "0x2E39Ae825C697BE3e15ACd003d1398287C83D4b6";
const itf = new Interface([
  "function BURN_SINK() view returns (address)",
  "function PRISM_BURNER_L1() view returns (address)",
  "function FINALIZATION_THRESHOLD() view returns (uint256)",
  "function MAX_FEE_BPS() view returns (uint256)",
  "function allBasketsLength() view returns (uint256)",
  "function factory() view returns (address)",
]);
const call = async (chain, to, fn, args = []) => {
  try {
    const ret = await P[chain].call({ to, data: itf.encodeFunctionData(fn, args) });
    return itf.decodeFunctionResult(fn, ret)[0];
  } catch {
    return null;
  }
};
const code = async (chain, a) => ((await P[chain].getCode(a)).length - 2) / 2;
const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
let bad = 0;
const row = (name, okc, detail) => {
  if (!okc) bad++;
  console.log(`${okc ? "✓" : "✗"} ${name} — ${detail}`);
};

// collectors
const COLL = { base: "0x15dfc383c9181662d3d3d874e112b1d6eb6c6461", robinhood: "0x7e0f5621a2f0fd4365302a1776ae831ae9a4794c" };
for (const [chain, a] of Object.entries(COLL)) {
  const [bytes, burner, thr] = [await code(chain, a), await call(chain, a, "PRISM_BURNER_L1"), await call(chain, a, "FINALIZATION_THRESHOLD")];
  row(`collector ${chain}`, bytes > 0 && eq(burner, BURNER) && (chain === "base" ? thr === 10n ** 16n : thr === 2n * 10n ** 15n), `${bytes}B · burner ${eq(burner, BURNER) ? "lockstep" : burner} · thr ${thr}`);
}
// batchers
const BATCH = {
  base: { a: "0x2ec8c0c87946ead5f9ae436374f6a6d0191c6803", sink: COLL.base },
  robinhood: { a: "0x65bf8842700498f99375c267dcd31e324d8f874c", sink: COLL.robinhood },
  ethereum: { a: "0xfb4646c26cfbbe8d4682aeb42e90b1ab8159764f", sink: BURNER },
};
for (const [chain, { a, sink }] of Object.entries(BATCH)) {
  const [bytes, s, maxFee] = [await code(chain, a), await call(chain, a, "BURN_SINK"), await call(chain, a, "MAX_FEE_BPS")];
  row(`batcher ${chain}`, bytes > 0 && eq(s, sink) && maxFee === 200n, `${bytes}B · sink ${eq(s, sink) ? (chain === "ethereum" ? "the burner DIRECT" : "the gen-3 collector") : s} · maxFee ${maxFee}`);
}
// wrappers
const WRAP = {
  base: { a: "0xEf88CC32C34172D9cAA09b405fBed2151785bF03", sink: COLL.base },
  robinhood: { a: "0xBeC653154735a0D1928430E82c5a17229227c067", sink: COLL.robinhood },
  ethereum: { a: "0xCE01C930E548421867A8C1DBD7cE83a7D26C5c99", sink: BURNER },
};
for (const [chain, { a, sink }] of Object.entries(WRAP)) {
  const [bytes, s, maxFee] = [await code(chain, a), await call(chain, a, "BURN_SINK"), await call(chain, a, "MAX_FEE_BPS")];
  row(`wrapper ${chain}`, bytes === 3691 && eq(s, sink) && maxFee === 200n, `${bytes}B (expect 3691 = the sell-fixed 100%-burn build) · sink ${eq(s, sink) ? "✓" : s} · maxFee ${maxFee}`);
}
// factories (fresh registries) + the seated league
const FACT = { base: "0xfD168aFf1321f3dd9Fe310759ED73a8De536e4b7", robinhood: "0xf47443C33D2DF877bf5d80B46557636E08C8083A", ethereum: "0xd0798c3743E15594a6918C0C0fD6F86eC76e96de" };
for (const [chain, a] of Object.entries(FACT)) {
  const [bytes, n] = [await code(chain, a), await call(chain, a, "allBasketsLength")];
  row(`factory ${chain}`, bytes > 10_000 && n != null, `${bytes}B · registry ${n} baskets`);
}
const [leagueBytes, seated] = [await code("robinhood", "0x620c1596178988ECcb846CD7788a65B5bAb8B9ba"), await call("robinhood", "0x620c1596178988ECcb846CD7788a65B5bAb8B9ba", "factory")];
row("league 4663", leagueBytes > 0 && eq(seated, FACT.robinhood), `${leagueBytes}B · seated to ${eq(seated, FACT.robinhood) ? "the gen-3 factory" : seated}`);

console.log(bad ? `\n✗ ${bad} rows failed — DO NOT WIRE` : "\n✓ all gen-3 rows verified independently — safe to wire");
process.exit(bad ? 1 : 0);
