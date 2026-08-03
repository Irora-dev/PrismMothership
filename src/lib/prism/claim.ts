// PRISM fee-claim plumbing — shared by /claim (client) and the stats API.
// The PrismHook IS the token, the V4 pool, and the fee accountant; the Prism-LP
// mirror is the ERC-721 face of whole tokens (one NFT per whole PRISM, on-chain
// SVG art). Fees stream per-share to NFTs (claim/claimMany) and any remainder
// accrues per-address (withdrawPending). ABIs verified against mainnet.
//
// Relaunch note (2026-07-29): both addresses come from the environment now — the
// mirror is per-token, so a new PRISM ships a new ERC-721 face. Empty until wired.

import { PRISM } from "@/lib/chain/constants";

export const HOOK_ADDRESS = PRISM; // the env-wired token + hook + fee accountant
// Prism-LP ERC-721 — the fee-share NFT half. Default is the live mirror, read off
// the token's own mirror() getter and verified (name "Prism-LP", symbol PRISM-LP).
// /claim needs BOTH halves before it reads anything, so leaving this env-only would
// keep the hub dark on prod even with the token wired. Env still overrides.
export const MIRROR_ADDRESS = (
  process.env.NEXT_PUBLIC_PRISM_MIRROR_ADDRESS || "0xC1E66f065eE0960e2eE4E1d7C1B3b48A9972bacC"
).trim();

// Both halves of the token must be wired before any claim/stat read is possible.
// Routes early-return a clean "not live yet" payload on false rather than
// constructing a Contract at "" (which throws).
const isAddr = (a: string) => /^0x[a-fA-F0-9]{40}$/.test(a);
export const PRISM_WIRED = isAddr(HOOK_ADDRESS) && isAddr(MIRROR_ADDRESS);

// ── Resync (whole PRISM ⇄ fee-share NFTs) ────────────────────────────────────
// The mirror mints one NFT per WHOLE token held. After a transfer that count can
// lag the balance, and a holder is then earning on fewer shares than they own —
// so /claim offers a "resync" that pokes the contract to rebuild the caller's
// NFT set.
//
// CONFIRMED against PRISM v2's code by the Prismtoken worker (2026-07-30, desk
// item w-1785361552853-68): the function is `syncNFTs(uint256 max)` — it TAKES A
// UINT ARGUMENT, is `msg.sender`-only (so the holder's own wallet must send it,
// which is what /claim does), and MAX_REALIGN caps how many shares one call can
// mint, so a large holder needs repeat calls.
//
// The candidate list stays as a fallback in case v2 ships with a different name
// than the reviewed source; `NEXT_PUBLIC_PRISM_SYNC_FN` pins it outright.
export const SYNC_MAX_PER_CALL = 128; // MAX_REALIGN in v2 — mints per call are capped
// R, 2026-07-30 (desk item w-1785428044656-76), read out of PrismHookV2's source:
// `if (max != 0 && want > max) want = max` — so **max = 0 means NO CALLER LIMIT**,
// and the contract still caps each call at MAX_REALIGN by itself. `syncNFTs(0)` is
// therefore what belongs behind the button: let the contract do its own capping
// instead of duplicating 128 here, where it would silently disagree if MAX_REALIGN
// ever changed. (SYNC_MAX_PER_CALL stays — it's how we know to say "run it again".)
export const SYNC_NO_CALLER_LIMIT = 0;
export const SYNC_CANDIDATES: string[] = [
  ...(process.env.NEXT_PUBLIC_PRISM_SYNC_FN ? [process.env.NEXT_PUBLIC_PRISM_SYNC_FN.trim()] : []),
  "syncNFTs(uint256)", // v2, confirmed from source
  // No `syncNFTs()` entry on purpose: R verified there is NO no-arg overload, so
  // probing for one can never match. It read like a working fallback and wasn't.
  "resync()",
  "sync()",
  "syncOwner(address)",
  "sync(address)",
  "mirrorSync()",
  "rebalanceNFTs()",
];

/** Turn a candidate signature into a one-entry human-readable ABI. */
export const syncAbiFor = (sig: string): string[] => [`function ${sig}`];
/** Does this candidate take the holder's address as its only argument? */
export const syncTakesAddress = (sig: string): boolean => /\(\s*address\s*\)/.test(sig);
/** Does it take a uint cap (v2's `syncNFTs(uint256 max)`)? */
export const syncTakesUint = (sig: string): boolean => /\(\s*uint\d*\s*\)/.test(sig);
/** Args to send for a candidate, given the connected holder. */
export const syncArgsFor = (sig: string, account: string): unknown[] =>
  syncTakesAddress(sig) ? [account] : syncTakesUint(sig) ? [SYNC_NO_CALLER_LIMIT] : [];
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11"; // canonical

export const HOOK_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function ownedTokensOf(address owner) view returns (uint256[])",
  "function pendingFees(uint256 tokenId) view returns (uint256 owedETH, uint256 owedPRISM)",
  "function pendingETH(address user) view returns (uint256)",
  "function pendingPRISM(address user) view returns (uint256)",
  "function accFeesPerShareETH() view returns (uint256)",
  "function accFeesPerSharePRISM() view returns (uint256)",
  "function claim(uint256 tokenId)",
  "function claimMany(uint256[] tokenIds)",
  "function withdrawPending()",
  "event Claimed(uint256 indexed tokenId, address indexed owner, uint256 ethOut, uint256 prismOut)",
] as const;

// Fee accumulators are scaled by ACC_SCALE — verified against the deployed,
// Sourcify-verified source (`ACC_SCALE = 1e12`; owed = accDelta / ACC_SCALE).
export const ACC_SCALE = 10n ** 12n;

export const MIRROR_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
] as const;

export const MULTICALL3_ABI = [
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
] as const;

// Decode the mirror's data:application/json;base64 tokenURI → { name, image }.
// The image itself is an on-chain data:image/svg+xml URI, safe for <img src>.
export function decodeTokenURI(uri: string): { name?: string; image?: string } {
  try {
    if (!uri.startsWith("data:application/json;base64,")) return {};
    const json = JSON.parse(atob(uri.slice("data:application/json;base64,".length)));
    return { name: typeof json.name === "string" ? json.name : undefined, image: typeof json.image === "string" ? json.image : undefined };
  } catch {
    return {};
  }
}
