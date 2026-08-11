import type { Metadata } from "next";
import { MothershipShell } from "@/components/mothership/shell";
import { TradePanel } from "@/components/mothership/trade";
import { TradeNativePanel } from "@/components/mothership/trade-native";
import siteConfig from "../../../site.config.json";

// The kit's trading mode (site.config.json): "matcha" (default — read-only
// outline, execution links out) or "native" (the full in-page swap; the
// integrator operates it on their own instance — see DISCLAIMER.md).
const NATIVE = (siteConfig as { tradingMode?: string }).tradingMode === "native";

// Trade — native ETH⇄PRISM swaps against the Uniswap v4 pool, with the
// post-buy popup that shows the buyer their own trade's fee streaming to
// holders (the designer's ask, 2026-08-03).

export const metadata: Metadata = {
  title: "Trade · The Prism Mothership",
  description:
    "Swap ETH for PRISM straight against the Uniswap v4 pool, and see your own trade's fee stream to holders, read from the chain.",
};

export default function TradePage() {
  return (
    <MothershipShell>
      {NATIVE ? <TradeNativePanel /> : <TradePanel />}
    </MothershipShell>
  );
}
