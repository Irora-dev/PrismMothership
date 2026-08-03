import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Prismbeat · Spectrum",
  description:
    "Everything happening on Spectrum in real time: basket launches, buys & sells, and fees earned across Ethereum and Base.",
};

export default function SpectrumLayout({ children }: { children: React.ReactNode }) {
  return children;
}
