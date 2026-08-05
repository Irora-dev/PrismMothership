import type { CSSProperties } from "react";

// ── The Mothership visual vocabulary ─────────────────────────────────────────
// One definition for the rebrand's shared constants — the deck, the marketing
// home, the 404 and every restyled page import from here instead of keeping
// copies (two hardcoded copies of anything is how the X link went stale).
// Styling stays INLINE everywhere: Tailwind v4 tree-shakes custom classes out
// of globals.css, but style objects and standard utilities always compile.

export const MONO = '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace';

export const C = {
  green: "#00FF87",
  orange: "#FF5E00",
  cyan: "#00F0FF",
  purple: "#9D00FF",
  indigo: "#5C7CFA", // Lightrunner's moonlit-night accent
  red: "#FF003C", // signal-lost / error accent
  ground: "#030409",
};

export const glass: CSSProperties = {
  background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  border: "1px solid rgba(255,255,255,0.05)",
  boxShadow: "0 8px 32px 0 rgba(0,0,0,0.3)",
};

export const glow = (color: string): CSSProperties => ({ textShadow: `0 0 20px ${color}80` });

// The site's rainbow as one canonical gradient — the PixelRainbow brand mark's
// seven bands. Use this instead of re-typing band lists (two hand-typed
// variants already drifted apart on /claim before this existed).
export const RAINBOW = "linear-gradient(90deg, #ff5a5a, #ff9f45, #ffe14d, #5cff8f, #3bd9ff, #7c8bff, #c06aff)";

// ── The app registry ─────────────────────────────────────────────────────────
// The Mothership is an APP STORE built on the PRISM token (the designer, 2026-08-03):
// anyone can dock an app here as long as it builds on PRISM. Statuses are
// facts, never marketing — "Launching soon" means built and audited but not
// yet on-chain (Spectrum Portfolio lights up after its deploy ceremony), and
// no card ever invents a usage number (the mockups' "+2.4k users / 14.2M TVL"
// stay banned — screening line, 2026-08-02).
export interface MothershipApp {
  name: string;
  tagline: string;
  blurb: string;
  href?: string; // absent = not openable yet
  color: string;
  status: "Live" | "Launching soon";
  external?: boolean;
  actions?: { label: string; href: string; external?: boolean }[];
}

export const APPS: MothershipApp[] = [
  {
    name: "Prism",
    tagline: "The token at the core",
    blurb:
      "The PRISM pool routes its ETH-side trading fees 100% to holders, and burns only move one way. Claim your stream, trade, and watch it all live.",
    href: "/claim",
    color: C.green,
    status: "Live",
    actions: [
      { label: "Claim", href: "/claim" },
      { label: "Trade", href: "/trade" },
      { label: "Telemetry", href: "/charts" },
    ],
  },
  {
    name: "Spectrum Baskets",
    tagline: "One token, a whole thesis",
    blurb:
      "Launch and trade basket tokens on Ethereum, Base & Robinhood Chain. Every basket fee splits on-chain — a fixed 10% buys and burns PRISM.",
    href: "https://spectrumindexes.xyz",
    external: true,
    color: C.purple,
    status: "Live",
    actions: [
      { label: "Launchpad", href: "https://spectrumindexes.xyz", external: true },
      { label: "Activity", href: "/spectrum" },
    ],
  },
  {
    name: "Spectrum Portfolio",
    tagline: "A whole portfolio in one buy",
    blurb:
      "Batched execution across baskets and tokens in a single transaction, with a flat fee that buys and burns PRISM. Built and audited — launching soon.",
    color: C.orange,
    status: "Launching soon",
  },
];

// The open slot — the store's standing invitation. Anyone can build on PRISM;
// the verified contracts are the honest starting point we can offer today.
export const BUILD_SLOT = {
  name: "Your app here",
  blurb: "The Mothership has open docking: build anything on the PRISM token and it belongs on this wall.",
  href: "/contracts",
  cta: "Start from the verified contracts",
};

// The Mothership's own instruments — site surfaces, not apps.
export const INSTRUMENTS: { name: string; href: string }[] = [
  { name: "Telemetry", href: "/charts" },
  { name: "Burn pipeline", href: "/burn" },
  { name: "Radio", href: "/radio" },
  { name: "Studio", href: "/studio" },
  { name: "Contracts", href: "/contracts" },
  { name: "How it works", href: "/how-it-works" },
];
