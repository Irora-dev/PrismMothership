import type { Metadata } from "next";

// /claim is a client component, so its tab title lives here. Same pattern as
// /baskets/[address]: a layout beside the page carries what the page cannot.

export const metadata: Metadata = {
  title: "Claim · The Prism Mothership",
  description:
    "Your PRISM revenue, claimable on-chain: connect a wallet, see the ETH and PRISM your Prisms have earned, and claim in one transaction.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
