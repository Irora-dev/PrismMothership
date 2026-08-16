import type { Metadata } from "next";

export const metadata: Metadata = {
  // /charts redirects to /command; the title only flashes, but it should not
  // flash the pre-rebrand name
  title: "Command deck · The Prism Mothership",
  description:
    "The Prism ecosystem over time: basket launches, buys & sells, PRISM swap fees, and the burn, charted live from on-chain data.",
};

export default function ChartsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
