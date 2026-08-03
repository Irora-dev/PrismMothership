import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Prismbeat · Charts",
  description:
    "The Prism ecosystem over time: basket launches, buys & sells, PRISM swap fees, and the burn, charted live from on-chain data.",
};

export default function ChartsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
