import type { Metadata } from "next";

// /how-it-works is a client component, so its tab title lives here. Same pattern as
// /baskets/[address]: a layout beside the page carries what the page cannot.

export const metadata: Metadata = {
  title: "How it works · The Prism Mothership",
  description:
    "Follow the money: how every trade fee splits on-chain between holders, creators, interfaces and the PRISM burn.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
