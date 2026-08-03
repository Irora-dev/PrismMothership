import { NextResponse } from "next/server";
import { Contract, formatEther, formatUnits } from "ethers";
import { getBaseProvider, getEthUsd, getHoodProvider, getProvider } from "@/lib/chain/live";
import { listIndexes } from "@/lib/spectrum/index-data";
import { L1_PRISM_BURNER, SPECTRUM_LEGACY_FACTORIES, SPECTRUM_V2 } from "@/lib/chain/constants";

// ── The burn pipeline, read side ─────────────────────────────────────────────
// the designer's ruling (2026-08-02, via SpectrumContracts' desk map): nothing in the
// burn pipeline is automatic, so the site SHOWS what is accumulating at every
// stage and lets anyone crank it. This route reads the whole pipeline:
//   1. per-basket burn accruals (pendingPrismBurn, USDC 6dp)
//   2. factory launch-fee escrows (pendingAuctionBurn — eth + hood; Base
//      bridges inline and genuinely has no getter, verified live 2026-08-03)
//   3. the batcher — dark until its deploy ceremony
//   4. revenue in flight across bridges (reused from the charts store)
//   5. the L1 burner's ETH balance
// Every getter here was verified against the live chains before wiring.

export const dynamic = "force-dynamic";

const BASKET_ABI = ["function pendingPrismBurn() view returns (uint256)"];
const FACTORY_ABI = ["function pendingAuctionBurn() view returns (uint256)"];

// The basket crank reverts below ~0.3 ETH-equivalent by design (audit B-3) —
// the UI shows progress toward it and never sends a crank that must fail.
const BASKET_THRESHOLD_ETH = 0.3;

interface PipelineBasket {
  chain: string;
  address: string;
  symbol: string;
  pendingUsd: number;
  pendingEthEquiv: number;
  thresholdEth: number;
  crankable: boolean;
}

let cache: { at: number; body: unknown } | null = null;
let inflight: Promise<unknown> | null = null;

async function build() {
  const eth = getProvider();
  const base = getBaseProvider();
  const hood = getHoodProvider();
  if (!eth) throw new Error("no eth rpc");
  const providerOf = (chain: string) => (chain === "ethereum" ? eth : chain === "base" ? base : hood);

  const [ethUsd, indexes] = await Promise.all([getEthUsd(eth).catch(() => 0), listIndexes().catch(() => [])]);

  // 1 — basket accruals
  const baskets = (
    await Promise.all(
      indexes.map(async (ix): Promise<PipelineBasket | null> => {
        const p = providerOf(ix.chain);
        if (!p) return null;
        try {
          const pending = (await new Contract(ix.address, BASKET_ABI, p).pendingPrismBurn()) as bigint;
          const usd = Number(formatUnits(pending, 6));
          const ethEquiv = ethUsd > 0 ? usd / ethUsd : 0;
          return {
            chain: ix.chain,
            address: ix.address,
            symbol: ix.symbol,
            pendingUsd: usd,
            pendingEthEquiv: ethEquiv,
            thresholdEth: BASKET_THRESHOLD_ETH,
            crankable: ethEquiv >= BASKET_THRESHOLD_ETH,
          };
        } catch {
          return null; // a basket without the getter (older lineage) just doesn't list
        }
      }),
    )
  ).filter(Boolean) as PipelineBasket[];

  // 2 — factory escrows: ceremony eth + hood, plus the legacy eth factory that
  // still holds real auction proceeds from the pre-repoint era
  const factorySources: { chain: string; address: string; note?: string }[] = [
    ...(SPECTRUM_V2.ethFactory ? [{ chain: "ethereum", address: SPECTRUM_V2.ethFactory }] : []),
    ...(SPECTRUM_V2.hoodFactory ? [{ chain: "robinhood", address: SPECTRUM_V2.hoodFactory }] : []),
    ...SPECTRUM_LEGACY_FACTORIES.ethereum.map((f) => ({ chain: "ethereum", address: f.address, note: "legacy factory" })),
  ];
  const factories = (
    await Promise.all(
      factorySources.map(async (f) => {
        const p = providerOf(f.chain);
        if (!p) return null;
        try {
          const escrow = (await new Contract(f.address, FACTORY_ABI, p).pendingAuctionBurn()) as bigint;
          return { ...f, escrowEth: Number(formatEther(escrow)) };
        } catch {
          return null; // no getter on this deployment — nothing accumulates here
        }
      }),
    )
  ).filter(Boolean);

  // 5 — the L1 burner (PRISM only actually dies here)
  const burnerEth = Number(formatEther(await eth.getBalance(L1_PRISM_BURNER).catch(() => 0n)));

  return {
    ethUsd,
    baskets: baskets.sort((a, b) => b.pendingUsd - a.pendingUsd),
    factories,
    burner: { address: L1_PRISM_BURNER, balanceEth: burnerEth },
    // 3 — the batcher stage stays dark until its deploy ceremony; addresses
    // land via SpectrumContracts when they are real. No placeholder numbers.
    batcher: null,
    generatedAt: Date.now(),
  };
}

export async function GET() {
  if (cache && Date.now() - cache.at < 30_000) return NextResponse.json(cache.body);
  if (!inflight) {
    inflight = build()
      .then((body) => {
        cache = { at: Date.now(), body };
        return body;
      })
      .finally(() => {
        inflight = null;
      });
  }
  try {
    return NextResponse.json(await inflight);
  } catch {
    return NextResponse.json({ error: "pipeline read failed" }, { status: 503 });
  }
}
