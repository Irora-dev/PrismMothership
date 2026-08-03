// Brand color (+ readable ink + logo URL) per token — the same system the
// Spectrum operator site uses, ported lean: baked logo-extracted colors as the
// base layer, curated overrides for hand-tuned / "liar" tokens (WETH's logo
// extracts grey → pinned periwinkle), and a deterministic hashed hue for
// anything unknown. Keys resolve by address first, then symbol.

import { getAddress } from "ethers";
import { BAKED } from "./token-colors.generated";
import { PRISM, PRISM_LIVE } from "@/lib/chain/constants";

export interface TokenVisual {
  color: string;
  ink: string;
}

// Curated overrides (win over the baked values). Addresses lower-case.
// PRISM's own tile colour is keyed off the env-wired token address instead of a
// hardcoded one, so it survives the relaunch (2026-07-29) — see PRISM_TILE below.
const CURATED: Record<string, TokenVisual> = {
  // ETH blue-chips whose logos mis-extract
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": { color: "#627EEA", ink: "#F4F0F4" }, // WETH (ETH)
  "0x4200000000000000000000000000000000000006": { color: "#627EEA", ink: "#F4F0F4" }, // WETH (Base)
  "0x514910771af9ca656af840dff83e8264ecf986ca": { color: "#2152D4", ink: "#F4F0F4" }, // LINK
  "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9": { color: "#8886F7", ink: "#F4F0F4" }, // AAVE
  "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984": { color: "#FF007A", ink: "#F4F0F4" }, // UNI — brand pink
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { color: "#2775CA", ink: "#F4F0F4" }, // USDC (ETH)
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { color: "#2775CA", ink: "#F4F0F4" }, // USDC (Base)
  "0xdac17f958d2ee523a2206206994597c13d831ec7": { color: "#26A17B", ink: "#F4F0F4" }, // USDT
};

// PRISM's tile — the burn popup's single-tile bento. Keyed to whatever token the
// env points at, so it follows a relaunch without a code change.
const PRISM_TILE: Record<string, TokenVisual> = PRISM_LIVE
  ? { [PRISM.toLowerCase()]: { color: "#6D28D9", ink: "#F4F0F4" } }
  : {};

const SYMBOL_FALLBACK: Record<string, TokenVisual> = {
  PRISM: { color: "#6D28D9", ink: "#F4F0F4" },
  ETH: { color: "#627EEA", ink: "#F4F0F4" },
  WETH: { color: "#627EEA", ink: "#F4F0F4" },
  USDC: { color: "#2775CA", ink: "#F4F0F4" },
  USDT: { color: "#26A17B", ink: "#F4F0F4" },
  WBTC: { color: "#F09242", ink: "#34203B" },
};

export function readableInk(hex: string): string {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? "#34203B" : "#F4F0F4";
}

function hashHue(addr: string): number {
  let h = 0;
  for (let i = 2; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) >>> 0;
  return h % 360;
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) ((r = c), (g = x));
  else if (h < 120) ((r = x), (g = c));
  else if (h < 180) ((g = c), (b = x));
  else if (h < 240) ((g = x), (b = c));
  else if (h < 300) ((r = x), (b = c));
  else ((r = c), (b = x));
  const to = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

export type TokenChain = "ethereum" | "base" | "robinhood";

// Colors extracted client-side from a token's actual logo (use-token-colors.ts).
// Sits BELOW curated/baked (brand colors stay authoritative) but ABOVE the hash
// fallback, so an unknown token adopts its logo's dominant color the moment the
// extraction lands. Persisted (30 days) so a revisit paints the real color on
// FIRST render instead of flashing the hash hue until extraction completes.
const EXTRACTED_CACHE_KEY = "pb-extracted-token-colors";
const EXTRACTED = new Map<string, TokenVisual>();
let extractedHydrated = false;
function hydrateExtracted(): void {
  if (extractedHydrated || typeof window === "undefined") return;
  extractedHydrated = true;
  try {
    const raw = window.localStorage.getItem(EXTRACTED_CACHE_KEY);
    if (!raw) return;
    const { at, colors } = JSON.parse(raw) as { at: number; colors: Record<string, string> };
    if (Date.now() - at > 30 * 24 * 3600_000) return;
    for (const [a, color] of Object.entries(colors)) EXTRACTED.set(a, { color, ink: readableInk(color) });
  } catch {
    // unreadable cache — extraction simply re-runs
  }
}

export function setExtractedTokenColor(address: string, color: string): void {
  hydrateExtracted();
  EXTRACTED.set(address.toLowerCase(), { color, ink: readableInk(color) });
  try {
    const colors: Record<string, string> = {};
    for (const [a, v] of EXTRACTED) colors[a] = v.color;
    window.localStorage.setItem(EXTRACTED_CACHE_KEY, JSON.stringify({ at: Date.now(), colors }));
  } catch {
    // storage full/blocked — the session cache still works
  }
}

/** Brand color + readable ink: curated → baked-from-logo → extracted-from-logo → hashed hue. */
export function tokenVisual(symbol: string | undefined, address: string): TokenVisual {
  const low = address.toLowerCase();
  const hit = PRISM_TILE[low] ?? CURATED[low] ?? BAKED[low] ?? (symbol ? SYMBOL_FALLBACK[symbol.toUpperCase()] : undefined);
  if (hit) return hit;
  hydrateExtracted();
  const ex = EXTRACTED.get(low);
  if (ex) return ex;
  const color = hslToHex(hashHue(low), 0.5, 0.42);
  return { color, ink: readableInk(color) };
}

/** TrustWallet logo URL (raw.githubusercontent sends ACAO:* — safe for the
 *  popup's PNG export, unlike the DexScreener CDN which refuses crossOrigin). */
export function trustwalletLogoUrl(address: string, chain: TokenChain): string | null {
  if (chain === "robinhood") return null; // no trustwallet assets dir for the chain yet
  try {
    return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${chain}/assets/${getAddress(address)}/logo.png`;
  } catch {
    return null;
  }
}

/** DexScreener CDN logo — covers most listed tokens on all three chains (their
 *  "robinhood" slug exists), but the CDN refuses crossOrigin reads, so it is a
 *  DISPLAY rung first and an extraction rung only in case that ever changes. */
export function dexscreenerLogoUrl(address: string, chain: TokenChain): string {
  return `https://dd.dexscreener.com/ds-data/tokens/${chain}/${address.toLowerCase()}.png?size=lg`;
}

/** Our own-origin logo proxy — always canvas-readable (the DexScreener CDN
 *  sends no ACAO and 301-hops domains, so direct extraction can never work). */
export function proxiedLogoUrl(address: string, chain: TokenChain): string {
  return `/api/spectrum/token-logo?chain=${chain}&address=${address.toLowerCase()}`;
}

/** Display ladder, fastest/most-covering first. */
export function logoSources(address: string, chain: TokenChain): string[] {
  const tw = trustwalletLogoUrl(address, chain);
  return [dexscreenerLogoUrl(address, chain), ...(tw ? [tw] : []), proxiedLogoUrl(address, chain)];
}

/** Extraction ladder, canvas-readable-first: TrustWallet (ACAO:*) for the
 *  chains it covers, then our proxy — same-origin, so it always reads. */
export function colorSources(address: string, chain: TokenChain): string[] {
  const tw = trustwalletLogoUrl(address, chain);
  return [...(tw ? [tw] : []), proxiedLogoUrl(address, chain)];
}
