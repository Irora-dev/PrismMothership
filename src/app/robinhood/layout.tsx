import type { Metadata } from "next";

// /robinhood is a client component, so its tab title lives here. Same pattern as
// /baskets/[address]: a layout beside the page carries what the page cannot.

export const metadata: Metadata = {
  title: "Robinhood Chain · The Prism Mothership",
  description:
    "Spectrum baskets on Robinhood Chain: live tokens, launches and trading activity on chain 4663.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
