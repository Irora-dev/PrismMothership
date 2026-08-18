// ── Pricing a wrapped swap from its own transaction ──────────────────────────
// The wrapper charges its fee in RAW SELL-ASSET units, so a swap prices three
// ways (2026-08-18, forced by the first real gen-3 sell):
//   · native sell            → ETH-denominated figures
//   · a stable on EITHER leg → USD figures (stable sells directly; stable buys
//     at the transaction's own executed rate — proceeds ÷ tokens the router
//     actually swapped; same block, same trade, never an external quote)
//   · no stable leg          → honestly unpriced (empty object)
// ONE implementation, shared by the feed decoder and the burn-pipeline totals,
// so the two can never drift (the two-surfaces-will-drift lesson).
import { STABLE_BY_CHAIN, ZERO } from "./constants";

export interface WrappedSwapAmounts {
  tradeEth?: number;
  eth?: number;
  burnEth?: number;
  tradeUsd?: number;
  usd?: number;
  feeUsd?: number;
  burnUsd?: number;
}

export function priceWrappedSwap(
  chain: "ethereum" | "base" | "robinhood",
  sellToken: string,
  buyToken: string,
  spentRaw: number,
  boughtRaw: number,
  feeRaw: number | undefined,
  burnRaw: number | undefined,
): WrappedSwapAmounts {
  const stable = STABLE_BY_CHAIN[chain];
  const sell = sellToken.toLowerCase();
  const buy = buyToken.toLowerCase();
  if (sell === ZERO.toLowerCase()) {
    return {
      tradeEth: spentRaw / 1e18,
      eth: feeRaw != null ? feeRaw / 1e18 : undefined,
      burnEth: burnRaw != null ? burnRaw / 1e18 : undefined,
    };
  }
  if (stable && sell === stable.address.toLowerCase()) {
    const unit = 10 ** stable.decimals;
    return {
      tradeUsd: spentRaw / unit,
      usd: spentRaw / unit,
      feeUsd: feeRaw != null ? feeRaw / unit : undefined,
      burnUsd: burnRaw != null ? burnRaw / unit : undefined,
    };
  }
  if (stable && buy === stable.address.toLowerCase() && feeRaw != null && spentRaw > feeRaw) {
    const proceedsUsd = boughtRaw / 10 ** stable.decimals;
    const rate = proceedsUsd / (spentRaw - feeRaw);
    return {
      tradeUsd: spentRaw * rate,
      usd: spentRaw * rate,
      feeUsd: feeRaw * rate,
      burnUsd: burnRaw != null ? burnRaw * rate : undefined,
    };
  }
  return {};
}
