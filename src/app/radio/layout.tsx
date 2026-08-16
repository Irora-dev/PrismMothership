import type { Metadata } from "next";

// /radio is a client component, so its tab title lives here. Same pattern as
// /baskets/[address]: a layout beside the page carries what the page cannot.

export const metadata: Metadata = {
  title: "Prismbeat Radio · The Prism Mothership",
  description:
    "The ecosystem's own station: music with live on-chain telemetry playing over it. Protocol revenue landing while you listen.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
