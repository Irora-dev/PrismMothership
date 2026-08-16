import type { Metadata } from "next";

export const metadata: Metadata = {
  // was "Prismbeat · Spectrum" — the pre-rebrand name, and the one tab title
  // on the site that didn't follow the "X · The Prism Mothership" pattern
  title: "Spectrum Ecosystem · The Prism Mothership",
  description:
    "Everything happening on Spectrum in real time: basket launches, buys & sells, and fees earned across Ethereum, Base and Robinhood Chain.",
};

export default function SpectrumLayout({ children }: { children: React.ReactNode }) {
  return children;
}
