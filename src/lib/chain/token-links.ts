import { PRISM, PRISM_LIVE, PRISM_POOL_ID } from "./constants";

// Every outbound "go look at / go trade the token" link, derived from the one
// env-wired PRISM address (see constants.ts). Nothing here hardcodes a token, so
// a relaunch re-points every link on the site at once.
//
// All of them return null while no token is wired — callers render nothing
// rather than a dead link into a previous token's market pages.

const addr = () => PRISM.toLowerCase();

/** Uniswap token page (the swap surface). */
export const uniswapUrl = (): string | null =>
  PRISM_LIVE ? `https://app.uniswap.org/explore/tokens/ethereum/${addr()}?chain=ethereum` : null;

/**
 * DexScreener — price / chart / pools.
 *
 * Keyed on the POOL ID, not the token address. DexScreener's own API returns the
 * pool-id form as this pair's canonical `url`, so it is the one form we have
 * evidence for; the token-address form relies on their redirect behaviour, which
 * can't be confirmed from here (the site answers a bot check, so both forms 403 to
 * curl and neither can be probed). The pool id is itself derived from the token
 * address, so this still re-points itself on a relaunch.
 */
export const dexscreenerUrl = (): string | null =>
  PRISM_LIVE ? `https://dexscreener.com/ethereum/${PRISM_POOL_ID}` : null;

/** DexScreener's embeddable chart — the same pool-id page with their
 *  documented embed params (the /trade page's chart, the designer 2026-08-03). */
export const dexscreenerEmbedUrl = (): string | null =>
  PRISM_LIVE ? `https://dexscreener.com/ethereum/${PRISM_POOL_ID}?embed=1&theme=dark&trades=0&info=0` : null;

/** Matcha (0x) — where actual execution happens now: no live DEX on our own
 *  site, the swap outline links out (the designer's posture ruling, 2026-08-03). */
export const matchaUrl = (): string | null =>
  PRISM_LIVE ? `https://matcha.xyz/tokens/ethereum/${addr()}` : null;

/**
 * Defined.fi — env-supplied, NOT derived.
 *
 * Their per-token/pair URL shape could not be verified from here (the site returns
 * a bot checkpoint and their docs don't document the path), and Defined is
 * pair-centric like DexScreener, so the identifier is probably the pool address —
 * which doesn't exist until launch anyway. Rather than ship a guessed link that
 * 404s on launch day, paste the real one into `NEXT_PUBLIC_PRISM_DEFINED_URL`
 * once the pool is live; until then nothing renders.
 */
export const definedUrl = (): string | null => {
  const u = (process.env.NEXT_PUBLIC_PRISM_DEFINED_URL || "").trim();
  return u.startsWith("https://") ? u : null;
};

/** Etherscan token page. */
export const etherscanTokenUrl = (): string | null =>
  PRISM_LIVE ? `https://etherscan.io/token/${addr()}` : null;

/** Etherscan address page for any contract (not token-specific). */
export const etherscanAddressUrl = (a: string): string => `https://etherscan.io/address/${a}`;

/** The market links as a list, for link grids — empty until a token is wired. */
export const marketLinks = (): { label: string; href: string }[] => {
  const entries: [string, string | null][] = [
    ["Uniswap", uniswapUrl()],
    ["DexScreener", dexscreenerUrl()],
    ["Defined.fi", definedUrl()],
  ];
  return entries.flatMap(([label, href]) => (href ? [{ label, href }] : []));
};

// ── The project's own X accounts ──────────────────────────────────────────────
// ONE definition. The top bar and /links each used to hardcode their own copy,
// which is how both ended up pointing at @prism_lp long after the account moved:
// changing one did not change the other. Anything linking to an account imports
// from here.
export const PRISM_X_URL = "https://x.com/PrismMothership";
export const SPECTRUM_X_URL = "https://x.com/spectrumindexes";
