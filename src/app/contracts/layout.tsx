import type { Metadata } from "next";

// /contracts is a client component, so its tab title lives here. Same pattern as
// /baskets/[address]: a layout beside the page carries what the page cannot.

export const metadata: Metadata = {
  title: "Contracts · The Prism Mothership",
  description:
    "The canonical contract addresses for PRISM and the Spectrum ecosystem, with verification commands you can run yourself.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
