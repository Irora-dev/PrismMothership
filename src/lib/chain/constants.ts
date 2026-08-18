import { AbiCoder, id, keccak256, zeroPadValue } from "ethers";

// ── Core addresses (Ethereum mainnet) ──
// ── The PRISM token ──
// The community is relaunching PRISM (ruling, 2026-07-29), so the token address is
// deliberately NOT hardcoded anywhere in this repo: it comes from the
// environment, and pointing the whole site at a token is ONE env value rather
// than a code change. Unset (the default) → `PRISM_LIVE` is false and every
// PRISM surface renders its clean pre-launch state instead of some earlier
// token's data. Set `NEXT_PUBLIC_PRISM_ADDRESS` in Netlify to go live.
// The default is now the LIVE token, not empty. It was deliberately empty while the
// relaunch was pending — "empty until then" — because a wrong token is worse than a
// dark page. "Then" arrived 2026-07-30: this address was verified from chain before
// being seated (symbol PRISM, 18dp, totalSupply 5000, owner() renounced to 0x0,
// mirror() → the Prism-LP NFT, and the site's derived v4 poolId matches the
// PoolManager's own Initialize event). Env still overrides, so it remains one switch —
// but the site no longer needs a Netlify change to show the token it is built around.
export const PRISM = (
  process.env.NEXT_PUBLIC_PRISM_ADDRESS ||
  process.env.PRISM_ADDRESS ||
  "0xCf4d29f14Cc585DDd1167F956092852AF844e040"
).trim();
// Whether a real token is wired. Guard on-chain reads and market links with it.
export const PRISM_LIVE = /^0x[a-fA-F0-9]{40}$/.test(PRISM);
export const DSTABLE = "0x05E32dC43d0c4B6BfF1976714717f12EBA8e8088"; // dstable on ETH
export const DEAD = "0x000000000000000000000000000000000000dEaD";
export const ZERO = "0x0000000000000000000000000000000000000000";
export const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// Uniswap v4 PoolManager — canonical mainnet singleton.
export const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90";

// Chainlink ETH/USD price feed (mainnet, 8 decimals) — for $-denominated display.
export const CHAINLINK_ETH_USD = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";

// Aave v3 mainnet Pool — dstable parks its stablecoin reserves here to earn yield;
// 20% of that yield (DSTABLE_BUY_BURN_BPS) is routed into a PRISM buy-and-burn.
export const AAVE_POOL = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2";
export const DSTABLE_BUY_BURN_BPS = 2000; // 20%
// dstable's reserve stablecoins (validated on-chain: ~50/50 USDC + USDT in Aave).
export const DSTABLE_RESERVES: { addr: string; decimals: number }[] = [
  { addr: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 }, // USDC
  { addr: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 }, // USDT
];

// dstable is also deployed on Base (the index quote currency) with its own Aave v3
// reserve — the bulk of dstable circulates here. Total supply sums both chains.
export const AAVE_POOL_BASE = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
export const DSTABLE_RESERVES_BASE: { addr: string; decimals: number }[] = [
  { addr: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 }, // USDC (Base)
];

// The Ethereum contract that receives ETH bridged from Base/Robinhood and
// buys+burns PRISM. Every off-mainnet burn leg (index fees + launch auction)
// funnels here. Per-token, so it ships with each relaunch — hence env-first.
//
// LIVE since 2026-07-30: `0x2E39Ae825C697BE3e15ACd003d1398287C83D4b6` on ETHEREUM,
// deployed from the spectrum-contracts repo and Sourcify exact_match (the previous
// external burner never was, and could not be repointed at PRISM v2 because it
// hardcoded v1 as a PUSH20 immediate with no owner and no setter). Verified live:
// 2.8KB of code, no `owner()`, and its `PRISM()` reads back the v2 token — so this
// burner is bound to the token this site is wired to, not the exploited v1.
// ⚠️ CHAIN-KEY IT. The same address on BASE is the SwapRouter, a different 6.3KB
// contract (bytecode sizes differ, verified). Never resolve this address without
// a chain id.
export const L1_PRISM_BURNER = (
  process.env.NEXT_PUBLIC_PRISM_BURNER_ADDRESS ||
  process.env.PRISM_BURNER_ADDRESS ||
  "0x2E39Ae825C697BE3e15ACd003d1398287C83D4b6"
).trim();

// Spectrum index factory on Ethereum — emits the same `Launched` event as the
// Base launcher, so the live reader can surface ETH index launches on the feed.
export const SPECTRUM_ETH = "0xA7D4A1b8D6096D503FAa6E7ecd927D5BA06DAB2a";

// ── Core addresses (Base mainnet) ──
export const SPECTRUM_BASE = "0xab9af86483dbf217e2e7edea84dd1bdbe3d488cf"; // index launcher + auction
export const DSTABLE_BASE = "0x51f2817b06de142021fbff00ac9b56ad84e84088"; // dstable on Base
export const POOL_MANAGER_BASE = "0x498581fF718922c3f8e6A244956aF099B2652b2b";
export const WETH_BASE = "0x4200000000000000000000000000000000000006";
export const L2_STANDARD_BRIDGE = "0x4200000000000000000000000000000000000010";

// Seed set of known Spectrum index tokens on Base. The live reader also discovers
// new ones from `Launched` events, but seeding these means Base data shows up on
// the very first load without waiting for a discovery scan.
export const KNOWN_INDEX_TOKENS = [
  "0x8281833536a41337e2c9450a0277416049514088", // BASEAI — The Base AI Index
  "0xab50550986c47facb24ab4aa4e08e0a6f952c088", // PLSBRO
  "0x2eea2b522cf630aa7883cf0ee7674803e6784088", // BALI — Base AI Leaders Index
  "0x036c7e64dd0b1a11660754f3e328402aae5ec088", // WNNRS — Base AI Cycle Winners
];

// Seed ticker map for the known indexes (lower-case addr → symbol). The live
// reader also fills this from `Launched` events, so new indexes self-label.
export const INDEX_SYMBOL_SEED: Record<string, string> = {
  "0x8281833536a41337e2c9450a0277416049514088": "BASEAI",
  "0xab50550986c47facb24ab4aa4e08e0a6f952c088": "PLSBRO",
  "0x2eea2b522cf630aa7883cf0ee7674803e6784088": "BALI",
  "0x036c7e64dd0b1a11660754f3e328402aae5ec088": "WNNRS",
};

// Spectrum fee model (validated against spectrum-contracts): each basket sets
// its own fee — the live v1 baskets are flat 1% (100 bps), which is also V2's
// floor (V2: creator-set 1.00%–3.00%, CREATE2-committed at launch). The live
// reader reads each basket's `basketFeeBps()` and falls back to this default.
export const INDEX_POOL_FEE_RATE = 0.01; // 100 bps — v1 flat rate / V2 floor
// A FIXED 25% of EVERY basket fee is the PRISM burn share going forward
// (BURN_SHARE_BPS = 2_500 in the gen-2 lineage, measured live on the rehearsal
// factories 2026-08-15; the designer ruled the site says 25%, 2026-08-16). Deployed
// gen-1 baskets are immutable and meter 1_000 on-chain — estimates follow the
// ruling; measured surfaces keep reading the chain.
export const BASKET_BURN_SHARE = 0.25;
// dstable is a $1-pegged 6-decimal stablecoin on both chains.
export const DSTABLE_DECIMALS = 6;

// PRISM token hard cap (whole tokens).
export const PRISM_CAP = 5000;

// Share of a launch-auction payment that bridges to L1 to buy & burn PRISM (90%).
export const AUCTION_BURN_SHARE = 0.9;

// PRISM/ETH v4 pool: currency0 = ETH (0x0), currency1 = PRISM, fee 1% (10000),
// tickSpacing 200, hooks = PRISM (the token IS its own hook). The pool id is
// derived from the env-wired token, so it follows a relaunch automatically —
// assuming the new token keeps this pool shape (verify at launch).
export const PRISM_POOL_KEY = {
  currency0: ZERO,
  currency1: PRISM || ZERO,
  fee: 10_000,
  tickSpacing: 200,
  hooks: PRISM || ZERO,
} as const;

// PoolId = keccak256 of the packed PoolKey struct (5 × 32-byte words).
export function computePoolId(key: typeof PRISM_POOL_KEY): string {
  const encoded = AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "uint24", "int24", "address"],
    [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
  );
  return keccak256(encoded);
}

// ── Uniswap v4 periphery (Ethereum mainnet) ──────────────────────────────────
// From the Uniswap deployments doc, VERIFIED on-chain 2026-08-03: code present
// at both, and the V4Quoter answers quoteExactInputSingle for the PRISM pool
// (0.01 ETH → 0.0603 PRISM at verification). The full Universal Router buy
// (V4_SWAP 0x10 · actions SWAP_EXACT_IN_SINGLE 0x06 / SETTLE_ALL 0x0c /
// TAKE_ALL 0x0f, constants fetched from the v4-periphery + universal-router
// sources) eth_call-simulates clean against mainnet (~125k gas).
export const UNIVERSAL_ROUTER = "0x66a9893cc07d91d95644aedd05d03f95e1dba8af";
export const V4_QUOTER = "0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203";

// A topic that matches nothing — served while no token is wired, so log filters
// return empty instead of throwing at module load (an unencodable "" address
// would 500 every page).
export const NO_POOL_ID = `0x${"0".repeat(64)}`;
export const PRISM_POOL_ID = PRISM_LIVE ? computePoolId(PRISM_POOL_KEY) : NO_POOL_ID;

// Block the PRISM 1% pool was created (first swaps/FeesPoked) — bounds fee scans.
// PRISM v2 (the community relaunch): token deployed at 25646557, pool initialized
// one block later at 25646558 — read off the PoolManager's own Initialize event,
// whose poolId matched the id derived above. The old value (25195024) was the V1
// pool's block: harmless output but ~450k blocks of empty range on every cold scan.
export const PRISM_POOL_FROM_BLOCK = 25646558;

// ── Event topic-0 hashes (all validated against on-chain logs) ──
export const TOPIC = {
  // ERC-20
  transfer: id("Transfer(address,address,uint256)"),
  // PrismHook — exact LP fees realized to PRISM holders (stream ①)
  feesPoked: id("FeesPoked(uint256,uint256)"),
  // dstable (ETH + Base) — yield + buy-and-burn (stream ③)
  buyAndBurn: id("BuyAndBurn(uint256,uint256,uint256,uint256)"),
  yieldClaimed: id("YieldClaimed(uint256)"),
  // Spectrum index token (per-index hook on Base) — swap fees + bridge-to-burn (stream ②)
  yieldFunded: id("YieldFunded(uint256,uint256,uint256)"),
  prismBurnBridged: id("PrismBurnBridged(uint256,uint256)"),
  // Real per-trade signal: the index hook does custom V4 accounting, so the
  // PoolManager Swap event nets to 0 — the actual trade size lives in these.
  minted: id("Minted(address,uint256,uint256)"), // (user, dstableIn, indexOut) — a buy
  sellViaSwap: id("SellViaSwap(address,uint256,uint256)"), // (user, indexIn, dstableOut) — a sell
  // Spectrum launcher (Base) — launches + auction bridge-to-burn (stream ④)
  launched: id("Launched(address,address,address,bytes32,string,string,uint160,uint256)"),
  auctionBridgedToBurn: id("AuctionBridgedToBurn(address,address,uint256,uint256)"),
  // Uniswap v4 PoolManager (optional "live trade" flavor)
  swap: id("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)"),
} as const;

// ── Spectrum V2 (SpectrumFactory + SpectrumBasket + SpectrumSwapRouter) ──
// Event topic-0 hashes for the V2 contracts (validated against
// spectrum-contracts src). V2 signatures DIFFER from the live v1 baskets —
// e.g. Minted(uint256,uint256,address) vs v1 Minted(address,uint256,uint256)
// — so these are separate constants. INERT until the factory + router
// addresses below are filled at launch; /spectrum serves demo data meanwhile.
export const TOPIC_V2 = {
  // SpectrumFactory
  launched: id("Launched(address,address,string,string,uint160,uint256,uint16)"),
  // SpectrumBasket — primary flows (frontend = integrator attribution)
  minted: id("Minted(uint256,uint256,address)"), // (usdcIn, basketOut, frontend indexed)
  redeemed: id("Redeemed(uint256,uint256,address)"), // (basketIn, usdcOut, frontend indexed)
  mintedInKind: id("MintedInKind(address,address,uint256,uint256)"),
  redeemedInKind: id("RedeemedInKind(address,address,uint256,uint256,bool[])"),
  // SpectrumBasket — the fee split, emitted per accrual. TWO SHAPES, one per tree
  // (SpectrumContracts, 2026-08-02): Base + Ethereum baskets deploy from the
  // MAINLINE source and emit the 4-field event; Robinhood (4663) baskets deploy
  // from lineages/robinhood and emit FIVE fields where field 4 is STILL
  // interface+launcher combined and field 5 is the CREATOR-LEAGUE slice
  // (LEAGUE_SHARE_BPS = 500, off the top). Field 5 is NOT launcher money — an
  // earlier note here decoded it as such and charted league flow as launcher
  // revenue. Scanners watch BOTH topics; the decoder switches on data length.
  feesAccrued: id("FeesAccrued(uint256,uint256,uint256,uint256)"), // (toHolders, toBurn, toCreator, toInterfaceAndLauncher)
  feesAccruedV3: id("FeesAccrued(uint256,uint256,uint256,uint256,uint256)"), // (…same four, toLeague)
  // SpectrumSwapRouter — secondary-market swaps; trader is INDEXED (no tx.from lookup)
  swapped: id("Swapped(address,address,address,uint256,uint256,address)"),
  // burn legs (chain-specific)
  prismBurnedL1: id("PrismBurned(uint256,uint256)"), // mainnet: (usdcIn, prismBurned)
  auctionBridgedToBurnV2: id("AuctionBridgedToBurn(address,address,uint256)"), // Base — arity differs from v1
  auctionEscrowed: id("AuctionEscrowed(address,uint256)"), // mainnet
  auctionSentToBurn: id("AuctionSentToBurn(address,uint256)"), // mainnet
} as const;

// ── PORTFOLIO BATCHER WATCH (display-only, the designer's ruling 2026-08-15) ────────
// "I'll be using the test portfolio batcher contracts which I want us to
// recognize so I can share on marketing." These are the GEN-1 REHEARSAL
// batchers — real, permanent contracts on real chains executing real batches,
// but NOT the production ceremony set. This watch feeds the ACTIVITY LAYER
// ONLY (feed events → deck, map wire, ticker, detail card). It supersedes the
// 2026-08-14 decoys-never-touch-site rule for that layer alone; everything
// ceremony-gated stays dark until real addresses arrive: the /burn portfolio
// stream (burn-pipeline serves batcher: null), portfolioBatcherLive() (the
// bot's copy), and the /portfolio page. ⚠️ Addresses collide across chains by
// construction (one deployer, matching nonces): the ethereum hex IS the
// robinhood hex — different contracts. Key on (chain, role), never bare hex.
export const PORTFOLIO_BATCHER_WATCH: Record<"ethereum" | "base" | "robinhood", string[]> = {
  ethereum: ["0x59a2756410887b7c1928Bf7C37B2bc9b1CeF95aA", "0xfb4646c26cfbbe8d4682aeb42e90b1ab8159764f"],
  base: ["0x81eBc35F705F9F30f5e2a3990530C07B54C72aBb", "0x2ec8c0c87946ead5f9ae436374f6a6d0191c6803"],
  robinhood: ["0x59a2756410887b7c1928Bf7C37B2bc9b1CeF95aA", "0x65bf8842700498f99375c267dcd31e324d8f874c"],
};

// ── GEN-3 PRODUCTION (the 2026-08-16 ceremony — all nine artifacts) ──────────
// Ground truth: spectrum-contracts/ADDRESSES.md GEN-3 sections (read back
// 18/18 by SpectrumContracts, independently cast-verified by them, and
// INDEPENDENTLY re-read by this site before wiring — scripts/gen3-verify.mjs
// re-runs that read on demand: sinks, thresholds, MAX_FEE_BPS 200, the 3,691B
// sell-fixed wrapper build, registries empty, league seated).
// The burn-pipeline's seated `batcher` payload keys on THESE (the rehearsal
// decoys above feed the activity layer only, never the portfolio stream).
// ⚠ Same-hex collisions across chains persist (one deployer) — chain-key always.
export const PORTFOLIO_BATCHER_PROD: Record<"ethereum" | "base" | "robinhood", { address: string; fromBlock: number }> = {
  ethereum: { address: "0xfb4646c26cfbbe8d4682aeb42e90b1ab8159764f", fromBlock: 25_765_000 }, // BURN_SINK = the L1 burner DIRECT (no collector on chain 1 by design)
  base: { address: "0x2ec8c0c87946ead5f9ae436374f6a6d0191c6803", fromBlock: 50_000_000 }, // BURN_SINK = the gen-3 Base collector
  robinhood: { address: "0x65bf8842700498f99375c267dcd31e324d8f874c", fromBlock: 37_900_000 }, // BURN_SINK = the gen-3 4663 collector
};
// Both BatchExecuted shapes exist across the lineages; the decoder switches on
// topic0. The live rehearsal batchers emit the 5-field shape (proven against
// the real 2026-08-15 00:10Z batch). Leg fills are counted per transaction.
export const TOPIC_BATCH = {
  executed5: id("BatchExecuted(address,address,uint256,uint256,uint256)"), // (recipient idx, fundingAsset idx, fundingTotal, fee, refunded)
  executed7: id("BatchExecuted(address,address,uint256,uint256,uint256,uint16,uint16)"), // (recipient idx, fundingAsset, spentFunding, hubOut, feeEth, legs, skipped)
  legFilled: id("LegFilled(address,address,uint256,uint256)"),
  batchLegFilled: id("BatchLegFilled(address,address,uint8,uint256,uint256)"),
  burnShareDelivered: id("BurnShareDelivered(address,uint256,uint256)"), // (sink idx, fundingSpent, ethDelivered) — the fee's burn share, MEASURED
} as const;

// The collector's flush event: the burn cut leaving the L2 on its ~7-day
// withdrawal toward the L1 burner (stage two → three in flight).
export const TOPIC_COLLECTOR = {
  burnBridgedToL1: id("BurnBridgedToL1(address,uint256,address)"), // (burnerL1 idx, amount, caller idx)
} as const;

// The batcher's burn cut lands on the GEN-1 COLLECTOR on both L2s (the eth
// batcher sinks straight to the burner pot in-tx, no collector stage). Stage
// two of the three-stage burn is the collector's PERMISSIONLESS flush()
// toward the L1 burner — surfaced and crankable by anyone per the designer's
// 2026-08-15 ruling. flushable() is the contract's own go signal; "pending"
// is the plain balance (no named getters exist — probed live 2026-08-15).
// Same hex on both chains = DIFFERENT contracts; key on chain, never bare hex.
export const PORTFOLIO_COLLECTOR_WATCH: { chain: "base" | "robinhood"; address: string; gen: 1 | 3 }[] = [
  { chain: "base", address: "0xd658192c1Bd25fA8858ed34898491D55deD430a5", gen: 1 },
  { chain: "robinhood", address: "0xd658192c1Bd25fA8858ed34898491D55deD430a5", gen: 1 },
  // Gen-3 production collectors (ceremony 2026-08-16; thresholds 0.01 / 0.002
  // ether read back live). Old-gen collectors stay live in parallel — the
  // rehearsal decoys still point at them — so BOTH generations are watched and
  // the road stations aggregate per chain.
  { chain: "base", address: "0x15dfc383c9181662d3d3d874e112b1d6eb6c6461", gen: 3 },
  { chain: "robinhood", address: "0x7e0f5621a2f0fd4365302a1776ae831ae9a4794c", gen: 3 },
];

// ── The 4663 → Ethereum settlement plumbing (the finalize crank) ─────────────
// Robinhood Chain is an Arbitrum Orbit rollup settling to mainnet: a collector
// or factory flush opens an ArbSys withdrawal, and after the dispute window the
// L1 finalization is Outbox.executeTransaction — permissionless, unreimbursed,
// the crank this site arms. The Outbox address is NOT guessed: SpectrumContracts
// identified it by an exact (l2Sender, destination, position) triple match over
// 487 real finalizations (spectrum-contracts/docs/ORBIT-OUTBOX-GAS-MEASURED-
// 2026-08-08.md, reciprocally outbox.rollup() == outbox.bridge().rollup()),
// and the whole proof path was re-proven live 2026-08-16 before wiring: a
// constructOutboxProof + executeTransaction eth_call SUCCEEDS for a real
// confirmed-unexecuted withdrawal (scripts/finalize-probe.mjs re-runs it).
export const HOOD_OUTBOX_L1 = "0xf0ce991ea4a0d2400a4ab49b20ae333f6dce3de9";
// ArbSys precompile (every L2→L1 withdrawal's event lives here) and the
// NodeInterface virtual contract that constructs the Merkle proof — fixed
// nitro addresses, present on every Orbit chain.
export const ARB_SYS = "0x0000000000000000000000000000000000000064";
export const ARB_NODE_INTERFACE = "0x00000000000000000000000000000000000000C8";
export const TOPIC_ARB = {
  // (caller, destination idx, hash idx, position idx, arbBlockNum, ethBlockNum, timestamp, callvalue, data)
  l2ToL1Tx: id("L2ToL1Tx(address,address,uint256,uint256,uint256,uint256,uint256,uint256,bytes)"),
  // (outputRoot idx, l2BlockHash idx) — the Outbox learns a root each time the
  // rollup confirms; the L2 block it names carries the confirmed sendCount
  sendRootUpdated: id("SendRootUpdated(bytes32,bytes32)"),
} as const;

// ── The direct-swap fee wrapper (SpectrumDirectSwapWrapper) ──────────────────
// the designer 2026-08-16: "we now have wrapper swaps we need to track in portfolio /
// moneymap." Ground truth: spectrum-contracts/ADDRESSES.md §DIRECT-LANE FEE
// WRAPPER. ⛔ MAINNET IS PRODUCTION IN EFFECT — its BURN_SINK is the real,
// generation-independent PrismBurner, so its fees are real burns from the
// first swap (proven byte-exact 2026-08-16, tx 0xc743…3280). Base + 4663 are
// rehearsal decoys awaiting the LNOC-class migration; like the batcher watch,
// they feed the ACTIVITY layer only. The fee is charged in the SELL asset
// (address(0) = native ETH) and splits fee/8 to the integrator, remainder to
// the burn — the batcher's shared denominator, floor math, exact.
// Every generation of the wrapper is watched: the gen-3 production set (the
// 2026-08-16 ceremony — 100% burn, the PRISM-sell-fixed build) PLUS the
// old-generation deployments that stay live in parallel (the superseded 0x588f
// mainnet wrapper and the two rehearsal decoys the designer traded through). One
// scan window per chain; the floor is the OLDEST watched deploy, so one
// getLogs covers every generation.
export const WRAPPER_WATCH: Record<"ethereum" | "base" | "robinhood", { addresses: string[]; fromBlock: number }> = {
  ethereum: { addresses: ["0x588f5b2C2DCA25B789D3493036dAB467eBc5BbaE", "0xCE01C930E548421867A8C1DBD7cE83a7D26C5c99"], fromBlock: 25_766_852 },
  base: { addresses: ["0x1c5c8c0fEB7dd3FD530f6295882aCD1824D8E8F5", "0xEf88CC32C34172D9cAA09b405fBed2151785bF03"], fromBlock: 50_040_733 },
  robinhood: { addresses: ["0x6a45227658d78Bac0D9FE97FeF817fFa83c02A9B", "0xBeC653154735a0D1928430E82c5a17229227c067"], fromBlock: 37_846_447 },
};
export const TOPIC_WRAPPER = {
  directSwap: id("DirectSwap(address,address,address,uint256,uint256,uint256)"), // (caller idx, sellToken idx, buyToken idx, spent, bought, refunded) — measured, sellToken 0x0 = native; IDENTICAL across generations
  feeCharged: id("FeeCharged(address,uint256,address,uint256)"), // OLD generation: (integrator idx, integratorCut, burnSink idx, burnCut) — the 7:1 split
  feeChargedWhole: id("FeeCharged(address,uint256)"), // GEN-3: (burnSink idx, burnCut) — burnCut == fee, 100% burn, no integrator (pinned from the deployed source; the ceremony's fee ruling)
} as const;
// The OLD generation's floor math (fee/8 → integrator, remainder → burn),
// verified byte-exact on the first 0x588f mainnet swap. Gen-3 burns the WHOLE
// fee — its events carry the measured burnCut, so this constant survives ONLY
// as the display fallback for old-generation events; never apply it to gen-3.
export const WRAPPER_BURN_SHARE = 7 / 8;

// The wrapper charges its fee IN THE SELL ASSET, so pricing a wrapped swap
// needs to know each chain's dollar stable (symbol + decimals read back live
// before pinning, 2026-08-18): a stable on EITHER leg prices the whole swap —
// stable sells directly, stable buys at the transaction's own executed rate.
// Swaps with no stable leg stay honestly unpriced.
export const STABLE_BY_CHAIN: Record<"ethereum" | "base" | "robinhood", { address: string; decimals: number; symbol: string }> = {
  ethereum: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6, symbol: "USDC" },
  base: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, symbol: "USDC" },
  robinhood: { address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6, symbol: "USDG" },
};

// Where undeliverable burn shares park: an ERC20 fee cannot enter the
// ETH-only collector/burner, so the wrapper (and the batcher's divert paths)
// deliver it here — in the sell asset, unswapped — awaiting the operator
// sweep. First real production instance measured 2026-08-18: 328.118 CASHCAT
// (≈$34 at the swap's own rate), tx 0x9ecfa51d…bd33 on 4663.
export const BURN_FALLBACK_SINK = "0x2f2508e334bd34015e5fda79c9d2c0555096c572";

// The PRISM pool's fixed fee split: the ETH leg is all holders'; the PRISM leg
// burns. Single-sourced for the money map and its mini vignette.
export const POOL_TO_HOLDERS = 0.9;
export const POOL_TO_BURN = 0.1;

// Wallet-facing chain params, single-sourced for every crank surface.
export const CHAIN_HEX: Record<string, string> = { ethereum: "0x1", base: "0x2105", robinhood: "0x1237" };
export const CHAIN_LABEL: Record<string, string> = { ethereum: "Ethereum", base: "Base", robinhood: "Robinhood" };
export const HOOD_ADD_PARAMS = {
  chainId: "0x1237",
  chainName: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://rpc.mainnet.chain.robinhood.com/rpc"],
  blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
} as const;

// ── The Spectrum launch set — 2026-07-30 ceremony (supersedes the 07-11 relaunch) ──
// Source of truth: `spectrum-contracts/ADDRESSES.md`, placed on this worker's desk by
// the SpectrumContracts worker. Every address below was re-verified live on ITS OWN
// CHAIN before being seated here: all three factories answer `LAUNCH_FEE_WEI` and
// `currentDeployPrice` = 0.003 ETH from genesis, report `allBasketsLength` 0
// (community-created baskets, none at launch), carry their chain's canonical v4
// PoolManager, and name the v2-lineage L1 burner. All three routers have no `owner()`.
//
// 🔴 THESE ADDRESSES COLLIDE ACROSS CHAINS AND MUST NEVER BE RESOLVED WITHOUT A CHAIN
// ID. The ceremony used one deployer at matching nonces, so CREATE produced the same
// address on several chains for DIFFERENT contracts. Verified by bytecode size:
//   0x2E39Ae82…B4b6 → Base SwapRouter (6.3KB)  ·  Ethereum L1 PrismBurner (2.8KB)
//   0x4d3590a5…0486 → Ethereum Factory (11.6KB) ·  Robinhood SwapRouter (6.3KB)
//   0x07Bfce09…7e6f → Robinhood Factory (11.3KB) · Ethereum code provider
// A single flat address list would silently mislabel three of these.
//
// ⛔ NEVER REINSTATE: `0x91ca52C4…f7A6` + router `0x10139577…b6bA` were the Base
// pre-V3 pair. Confirmed stale on-chain — `LAUNCH_FEE_WEI` is ABSENT on both — and
// their burn path points at the superseded, unrepointable v1 burner, so a basket
// launched through them would bridge every burn into a dead end.
//
// ⚠️ Env-first, so a rotation is a Netlify change — which also means STALE NETLIFY
// VARS SILENTLY WIN OVER THESE DEFAULTS. Netlify currently holds the 07-11 set, so
// prod stays on the old factories until those vars are updated or deleted.
// Addresses that must never be served again, whatever the environment says. The
// env-override is deliberate (a rotation shouldn't need a deploy) but it cuts both
// ways: a stale var silently wins over a correct default. That is not theoretical —
// when the 07-30 set was seated, `.env.local` (and Netlify) still held the 07-11
// values, so the site kept reading the DEAD Base factory while every address in this
// file was already correct. A basket launched through those contracts bridges its
// burns to the superseded, unrepointable v1 burner, so serving them is worse than
// serving nothing. Retired addresses get denylisted here rather than only deleted.
const RETIRED = new Set(
  [
    "0x91ca52C4095c795f6e05DABF7d53Db44101ef7A6", // Base pre-V3 factory (no LAUNCH_FEE_WEI)
    "0x10139577Eb5a710De69aE0fD60F9E881d39cb6bA", // its router
    "0xEf520C7f354d03253149388F6338189Bc1A0Ba01", // 07-11 eth factory — now a BASE code provider
    "0x15D9C385dC3d3f4fB50321F6e224b25A391F0025", // 07-11 eth router — now a BASE code provider
    "0x9d2b5f051074CFdFc14da4430779857529739837", // the unrepointable v1 PRISM burner
  ].map((a) => a.toLowerCase()),
);
/** Take an env override only if it isn't a retired contract. */
function liveAddr(fromEnv: string | undefined, fallback: string): string {
  const v = (fromEnv || "").trim();
  if (!v) return fallback;
  if (RETIRED.has(v.toLowerCase())) {
    // Loud on the server, and it still serves the right thing.
    console.warn(`[spectrum] ignoring RETIRED address from env: ${v} → using ${fallback}`);
    return fallback;
  }
  return v;
}

export const SPECTRUM_V2 = {
  ethFactory: liveAddr(process.env.SPECTRUM_V2_FACTORY_ETH, "0x4d3590a5B0aCee04Bb7Ab721B23fDdae8B880486"),
  baseFactory: liveAddr(process.env.SPECTRUM_V2_FACTORY_BASE, "0xa60ce83A4048f2157A65d596002541311D694E5D"),
  hoodFactory: liveAddr(process.env.SPECTRUM_V2_FACTORY_HOOD, "0x07Bfce0976b205FcfDF115F7aD1401Ab1f197e6f"),
  ethRouter: liveAddr(process.env.SPECTRUM_V2_ROUTER_ETH, "0x2eC8C0C87946ead5f9AE436374F6A6d0191c6803"),
  baseRouter: liveAddr(process.env.SPECTRUM_V2_ROUTER_BASE, "0x2E39Ae825C697BE3e15ACd003d1398287C83D4b6"),
  hoodRouter: liveAddr(process.env.SPECTRUM_V2_ROUTER_HOOD, "0x4d3590a5B0aCee04Bb7Ab721B23fDdae8B880486"),
} as const;

// ── Legacy factories that still hold REAL user baskets ───────────────────────
// The 07-11 eth factory was retired with the 07-30 ceremony — but the community
// launch kit kept pointing at it on Ethereum, and real users really launched
// there: 3 baskets (incl. SRWA and FBB4, both AFTER the new ceremony). Hiding
// them made the site wrong (the designer: "there were baskets created on eth tho"), so
// discovery reads legacy factories as ADDITIONAL sources. This does not soften
// the denylist: an env var naming a legacy factory as THE factory is still
// refused — being a readable source of existing baskets and being the factory
// the site treats as current are different roles.
//
// ⚠️ Verified live before listing (2026-07-31): this factory's PRISM_BURNER_L1
// is the DEAD v1 burner (0x9d2b…9837, unrepointable, buys only the exploited v1
// token) and it still runs the 0.1 ETH auction (LAUNCH_FEE_WEI absent,
// currentDeployPrice 0.1 ETH — ~33× the ceremony's flat fee). Its baskets emit
// the 4-field FeesAccrued. Users keep paying into it as long as the kit points
// there — that is the operator's to fix; ours is to show their baskets.
// ⚠️ THE WINDOW IS A DECISION, NOT A DATA LIMIT (the designer, 2026-07-31, two rulings):
// "we shouldn't display from the old factories" + "we should show the old factory
// baskets that launched this week also". Net: legacy baskets display ONLY if they
// launched since the 07-30 ceremony — people caught by the not-yet-repointed kit —
// while the genuinely old era stays hidden. The `floor` below encodes that window:
// discovery never looks earlier, so launches before it do not exist to the site.
// Verified against the chain: DEFI launched 2026-07-12 (block 25,517,048 — below
// the floor, hidden) · SRWA 07-31 02:05Z (25,649,735) and FBB4 07-31 11:02Z
// (25,652,413) — above it, shown. When the kit repoint lands and legacy launches
// stop, this list can empty again; until then it is the honest middle.
export const SPECTRUM_LEGACY_FACTORIES: Record<
  "ethereum" | "base" | "robinhood",
  { address: string; floor: number }[]
> = {
  ethereum: [{ address: "0xEf520C7f354d03253149388F6338189Bc1A0Ba01", floor: 25_646_000 }],
  base: [],
  robinhood: [],
};

// ── GEN-3 basket factories (the 2026-08-16 production ceremony) ──────────────
// Fresh registries (allBasketsLength 0 at wiring, re-read live), community
// launches begin when the kit re-seats. ADDITIVE alongside SPECTRUM_V2: the
// July-30 factories keep every live basket, so discovery + charts scan BOTH
// generations (the RHTEST1 lesson: wire discovery BEFORE the first launch, or
// it is invisible). Same additive registry discipline as the legacy list —
// own cursor, own floor, per factory. The 4663 LeaguePool 0x620c1596…B9ba is
// seated to the 4663 factory (league splits stay MEASURED off FeesAccrued, no
// address needed here). Evidence: spectrum-contracts/ADDRESSES.md GEN-3 leg 2
// + scripts/gen3-verify.mjs (independent re-read before wiring).
export const SPECTRUM_V3_FACTORIES: Record<
  "ethereum" | "base" | "robinhood",
  { address: string; floor: number }[]
> = {
  ethereum: [{ address: "0xd0798c3743E15594a6918C0C0fD6F86eC76e96de", floor: 25_765_000 }],
  base: [{ address: "0xfD168aFf1321f3dd9Fe310759ED73a8De536e4b7", floor: 50_000_000 }],
  robinhood: [{ address: "0xf47443C33D2DF877bf5d80B46557636E08C8083A", floor: 37_900_000 }],
};

// The Robinhood-lineage LeaguePool. Its one-shot `seatFactory` is spent, and its
// `factory()` reads back the live Robinhood factory — verified — so it holds no
// privileged caller for the rest of its life.
export const SPECTRUM_LEAGUE_POOL_HOOD =
  process.env.SPECTRUM_LEAGUE_POOL_HOOD || "0xd1B485a0C40fb40fd94aa8dDbA32Ed6DCaDC35Be";

// Robinhood Chain (4663) — Arbitrum Orbit L2, ETH gas. RPC + explorer verified
// live (eth_chainId → 0x1237; explorer = Blockscout).
export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_RPC = process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com/rpc";
export const ROBINHOOD_EXPLORER =
  process.env.NEXT_PUBLIC_ROBINHOOD_EXPLORER_URL?.replace(/\/$/, "") || "https://robinhoodchain.blockscout.com";

// V2 baskets are USDC-quoted (v1 was dstable-quoted); both stables are 6dp ≈ $1.
export const USDC_DECIMALS = 6;

// Scan floors for V2 log reads, per chain — blocks safely before each factory's
// deploy. Re-measured on-chain for the 2026-07-30 ceremony by binary-searching
// `getCode`: eth factory 25,647,770 · base 49,325,096 · robinhood 23,567,713
// (that last is the router, which landed a few blocks before its factory).
//
// ⚠️ THESE MUST MOVE WITH EVERY REDEPLOY — the silent trap in token/GO-LIVE.md.
// The previous floors (eth 25,509,000 · base 48,491,000 · robinhood 6,950,000)
// belonged to the 07-11 set. Leaving them wouldn't produce wrong output, but on
// Robinhood's 0.1s blocks it meant scanning ~16.6 MILLION empty blocks on every
// cold rebuild — the same shape as the sliding-window bug that made baskets
// vanish on 07-13. Floor at the deploy, never at a guess.
// Floors sit at each CEREMONY factory's deploy era. ethereum briefly reached back
// to 25,509,000 while the legacy factory's baskets were displayed (ce3acd8); with
// that display retired by decision, the tight floor returns — a floor before the
// factory exists is pure empty scan.
export const SPECTRUM_V2_FROM_BLOCK = { ethereum: 25_647_000, base: 49_325_000, robinhood: 23_567_000 } as const;

// 32-byte left-padded topics for indexed-address filtering.
export const TOPIC_DEAD = zeroPadValue(DEAD, 32);
export const TOPIC_ZERO = zeroPadValue(ZERO, 32);
export const TOPIC_PRISM_POOL = PRISM_POOL_ID;

// Map a burn's `from` address to a friendly source + caption.
/**
 * Which stream a PRISM burn came from, given the sender of the Transfer → dEaD.
 *
 * ⚠️ `viaBurner` is NOT optional in spirit — pass it. The sender alone is no longer
 * enough to tell the two burn streams apart, and getting it wrong misattributes the
 * biggest number on the site.
 *
 * The old comment here said PoolManager-sent burns are "never a basket". That was
 * true until the L1 PrismBurner shipped (2026-07-30). The burner BUYS PRISM through
 * the v4 pool and then sends it to dEaD, so its Transfer → dEaD is emitted with the
 * **PoolManager** as sender — identical to the hook's own compounding burn. Measured
 * on mainnet: of 5.985 PRISM burned, 104 burns totalling 1.857 came from the token
 * (real pool-fee burns) and ONE burn of 4.128 came via the PoolManager from the
 * burner — i.e. 73% of all burns ever, a Spectrum basket burn, was being reported as
 * a PRISM pool burn.
 *
 * The discriminator is the transaction, not the sender: a burn whose tx also touched
 * the burner contract is burner-driven. That is matched by tx hash rather than by the
 * burner's event signature on purpose — `TOPIC.prismBurnedL1` here is a GUESS that
 * does not match the deployed burner's actual events (checked on-chain), so anything
 * keyed on that signature would silently never fire.
 */
export function attributeBurnSource(from: string, viaBurner = false): {
  source: import("../feed/types").EventSource;
  note: string;
  baseOrigin?: boolean;
} {
  const a = from.toLowerCase();
  if (viaBurner)
    return {
      source: "spectrum-index",
      note: "Spectrum fees bought PRISM through the pool and burned it",
    };
  if (a === PRISM.toLowerCase() || a === POOL_MANAGER.toLowerCase())
    // The hook's own compounding burn: the 20% PRISM-side slice of the pool fee.
    // Only reachable once `viaBurner` has ruled out a burner-driven buy-and-burn.
    return { source: "prism-pool", note: "PRISM pool fees compounded into a burn" };
  if (a === DSTABLE.toLowerCase())
    return { source: "dstable", note: "Reserve yield routed into a PRISM buy-and-burn" };
  if (a === L1_PRISM_BURNER.toLowerCase())
    return { source: "spectrum-auction", note: "Bridged from Base, then bought & burned PRISM", baseOrigin: true };
  return { source: "spectrum-index", note: "An index sent fees into a PRISM buy-and-burn" };
}

// ── Explorers ──
export const EXPLORER =
  process.env.NEXT_PUBLIC_EXPLORER_URL?.replace(/\/$/, "") || "https://etherscan.io";
export const BASE_EXPLORER =
  process.env.NEXT_PUBLIC_BASE_EXPLORER_URL?.replace(/\/$/, "") || "https://basescan.org";

export function explorerFor(chain: "ethereum" | "base" | "robinhood" = "ethereum") {
  return chain === "base" ? BASE_EXPLORER : chain === "robinhood" ? ROBINHOOD_EXPLORER : EXPLORER;
}
export function txUrl(hash: string, chain: "ethereum" | "base" | "robinhood" = "ethereum") {
  return `${explorerFor(chain)}/tx/${hash}`;
}
export function addrUrl(addr: string, chain: "ethereum" | "base" | "robinhood" = "ethereum") {
  return `${explorerFor(chain)}/address/${addr}`;
}
