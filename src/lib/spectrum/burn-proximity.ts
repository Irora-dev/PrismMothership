// ── Spectrum burn-proximity ──────────────────────────────────────────────────
// Per-basket "how close is it to a PRISM burn?" — computed against the fixed
// on-chain threshold. Every basket accrues a 10% burn share (in USDC) into
// `pendingPrismBurn()`; a permissionless crank fires once that converts to
// ≥ 0.3 ETH (BurnLeg.sol `BURN_THRESHOLD` on mainnet / `BRIDGE_THRESHOLD` on
// Base — the SAME 0.3 ETH constant). So proximity = pendingPrismBurn →
// ETH-equivalent ÷ 0.3.
//
// Discovery is SHARED with the explorer: the V2 baskets come from listIndexes()
// (cached + single-flight), so this no longer runs its own 1.5M-block factory
// `Launched` scan — and reads run through the shared, instrumented providers,
// so their RPC cost shows up at /api/usage like everything else.

import { Contract } from "ethers";
import { getBaseProvider, getProvider } from "@/lib/chain/live";
import { listIndexes } from "@/lib/spectrum/index-data";

export type Chain = "ethereum" | "base";

// The burn trigger, fixed in the contracts (BurnLeg / FactoryBurnLeg, both chains).
// Not a config knob — it is a compile-time constant of the deployed V2 baskets.
export const BURN_THRESHOLD_ETH = 0.3;

const USDC_DECIMALS = 6; // pendingPrismBurn is denominated in USDC on both chains

// Only kept for the `configured` flag the UI reads — discovery itself no longer
// touches these (listIndexes owns it).
const V2_FACTORY: Record<Chain, string> = {
  ethereum: process.env.SPECTRUM_V2_FACTORY_ETH || "",
  base: process.env.SPECTRUM_V2_FACTORY_BASE || "",
};

const BASKET_ABI = ["function pendingPrismBurn() view returns (uint256)"];

export interface BurnProximity {
  address: string;
  chain: Chain;
  symbol: string;
  name: string;
  pendingUsdc: number; // accrued burn share, in USDC (human units)
  pendingEth: number; // same, in ETH-equivalent at current price
  thresholdUsd: number; // 0.3 ETH in USD at current price
  fraction: number; // pendingEth / 0.3  (0 → 1; can exceed 1 briefly before a crank fires)
  pctToBurn: number; // fraction * 100
}

export interface BurnProximityPayload {
  baskets: BurnProximity[];
  ethUsd: number;
  thresholdEth: number;
  thresholdUsd: number;
  totalPendingUsd: number;
  configured: Record<Chain, boolean>;
  updatedAt: string;
}

function providerFor(chain: Chain) {
  return chain === "base" ? getBaseProvider() : getProvider();
}

async function fetchEthUsd(): Promise<number> {
  try {
    const r = await fetch("https://coins.llama.fi/prices/current/coingecko:ethereum", { cache: "no-store" });
    const j = (await r.json()) as { coins?: Record<string, { price?: number }> };
    const p = j?.coins?.["coingecko:ethereum"]?.price;
    return typeof p === "number" && p > 0 ? p : 0;
  } catch {
    return 0;
  }
}

async function proximityForChain(chain: Chain, ethUsd: number, baskets: { address: string; symbol: string; name: string }[]): Promise<BurnProximity[]> {
  const provider = providerFor(chain);
  if (!provider || !baskets.length) return [];
  const thresholdUsd = BURN_THRESHOLD_ETH * ethUsd;
  const out: BurnProximity[] = [];
  await Promise.all(
    baskets.map(async (b) => {
      try {
        // symbol/name already came from discovery — only pendingPrismBurn needs
        // a read here (reverts on any non-V2 basket → caught, skipped).
        const pend = (await new Contract(b.address, BASKET_ABI, provider).pendingPrismBurn()) as bigint;
        const pendingUsdc = Number(pend) / 10 ** USDC_DECIMALS;
        const pendingEth = ethUsd > 0 ? pendingUsdc / ethUsd : 0;
        const fraction = ethUsd > 0 ? pendingEth / BURN_THRESHOLD_ETH : 0;
        out.push({
          address: b.address,
          chain,
          symbol: b.symbol,
          name: b.name,
          pendingUsdc,
          pendingEth,
          thresholdUsd,
          fraction,
          pctToBurn: fraction * 100,
        });
      } catch {
        /* not a V2 basket (no pendingPrismBurn) or transient RPC → skip */
      }
    }),
  );
  return out;
}

// Single-flight + 5-min cache, same lever as the explorer: many viewers collapse
// onto one cross-chain scan per interval.
let cache: { at: number; data: BurnProximityPayload } | null = null;
let inflight: Promise<BurnProximityPayload> | null = null;
const TTL_MS = Number(process.env.BURN_LIST_TTL_MS) || 300_000;

export async function getBurnProximity(): Promise<BurnProximityPayload> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  if (inflight) return inflight;
  inflight = (async () => {
    // One shared discovery read (cached), split by chain — the V2 baskets are
    // the v3-lineage entries listIndexes already found.
    const [ethUsd, idx] = await Promise.all([fetchEthUsd(), listIndexes().catch(() => [])]);
    // Every discovered basket is a V2 basket (v1 was retired from the listing),
    // so all of them carry pendingPrismBurn — no lineage filter needed.
    const v2 = idx.map((i) => ({ address: i.address, symbol: i.symbol, name: i.name, chain: i.chain as Chain }));
    const perChain = await Promise.all(
      (["ethereum", "base"] as Chain[]).map((c) =>
        proximityForChain(
          c,
          ethUsd,
          v2.filter((b) => b.chain === c),
        ).catch(() => [] as BurnProximity[]),
      ),
    );
    const baskets = perChain.flat().sort((a, b) => b.fraction - a.fraction);
    const configured: Record<Chain, boolean> = { ethereum: !!V2_FACTORY.ethereum, base: !!V2_FACTORY.base };
    const payload: BurnProximityPayload = {
      baskets,
      ethUsd,
      thresholdEth: BURN_THRESHOLD_ETH,
      thresholdUsd: BURN_THRESHOLD_ETH * ethUsd,
      totalPendingUsd: baskets.reduce((s, b) => s + b.pendingUsdc, 0),
      configured,
      updatedAt: new Date().toISOString(),
    };
    // Cache a real answer (configured, or actual baskets); don't pin an all-RPC-failure blank.
    if (baskets.length || configured.ethereum || configured.base) cache = { at: Date.now(), data: payload };
    return payload;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
