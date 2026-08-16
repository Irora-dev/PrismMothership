import type { Metadata } from "next";

// /links is a client component, so its tab title lives here. Same pattern as
// /baskets/[address]: a layout beside the page carries what the page cannot.

export const metadata: Metadata = {
  title: "Links · The Prism Mothership",
  description:
    "Every official Prism surface in one place: the community Telegram, X, DexScreener, the contracts and the docs.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
