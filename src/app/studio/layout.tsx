import type { Metadata } from "next";

// /studio is a client component, so its tab title lives here. Same pattern as
// /baskets/[address]: a layout beside the page carries what the page cannot.

export const metadata: Metadata = {
  title: "Studio · The Prism Mothership",
  description:
    "Make share cards from live on-chain data: paste a basket address or bundle link and export a 1920x1080 card with the post to carry it.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
