// ── Private-DM portfolio surface ──────────────────────────────────────────────
// A member links a wallet ONCE in the bot's DM, then reads their whole Spectrum
// position across every chain from Telegram: which baskets they hold, what each
// is worth, and their PRISM. Read-only, always: the bot never signs, never holds
// keys, never asks for a seed phrase. Reweighting produces a target and a deep
// link — the signature happens on the site, in the user's own wallet.
//
// DM ONLY by design (the command layer enforces chat.type === "private"): a
// wallet address in a group chat is a doxx, and a portfolio is nobody else's
// business.

import { Contract, JsonRpcProvider } from "ethers";
import { listIndexes } from "@/lib/spectrum/index-data";

const ERC20 = ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"];

// ── the wallet link (per Telegram user) ──────────────────────────────────────
type BlobJson = { get(k: string, o: { type: "json" }): Promise<unknown>; setJSON(k: string, v: unknown): Promise<void> };
async function blob(): Promise<BlobJson | null> {
  try {
    const { getStore } = await import("@netlify/blobs");
    return getStore({ name: "prismbeat-dm", consistency: "strong" }) as unknown as BlobJson;
  } catch {
    return null;
  }
}
const mem = new Map<string, unknown>();
const key = (userId: number | string) => `u:${userId}`;

export async function getLinkedWallet(userId: number | string): Promise<string | null> {
  try {
    const b = await blob();
    const raw = b ? await b.get(key(userId), { type: "json" }) : mem.get(key(userId));
    const s = raw as { address?: string } | null | undefined;
    return s?.address ?? null;
  } catch {
    return null;
  }
}
export async function linkWallet(userId: number | string, address: string): Promise<void> {
  const rec = { address, at: Date.now() };
  try {
    const b = await blob();
    if (b) await b.setJSON(key(userId), rec);
    else mem.set(key(userId), rec);
  } catch {
    /* best-effort */
  }
}
export async function unlinkWallet(userId: number | string): Promise<void> {
  try {
    const b = await blob();
    if (b) await b.setJSON(key(userId), {});
    else mem.delete(key(userId));
  } catch {
    /* best-effort */
  }
}

// ── the cross-chain read ─────────────────────────────────────────────────────
export interface Position {
  symbol: string;
  address: string;
  chain: string;
  balance: number;
  valueUsd: number;
  change24hPct: number | null;
}
export interface PortfolioView {
  positions: Position[];
  totalUsd: number;
  checked: number; // baskets scanned — so "nothing found" can be stated honestly
}

// One provider per chain, built from the same env the rest of the site uses.
// Cached per instance so a portfolio read doesn't open a socket per basket.
const rpcFor = (chain: string): string | null => {
  const key = process.env.ALCHEMY_API_KEY;
  if (chain === "robinhood") return process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com/rpc";
  if (chain === "base") return process.env.BASE_RPC_URL || (key ? `https://base-mainnet.g.alchemy.com/v2/${key}` : null);
  return process.env.RPC_URL || (key ? `https://eth-mainnet.g.alchemy.com/v2/${key}` : null);
};
const provCache = new Map<string, JsonRpcProvider>();
const providerFor = (chain: string): JsonRpcProvider | null => {
  const hit = provCache.get(chain);
  if (hit) return hit;
  const url = rpcFor(chain);
  if (!url) return null;
  // staticNetwork: these chains never change id, and it skips a probe per call
  const p = new JsonRpcProvider(url, undefined, { staticNetwork: true });
  provCache.set(chain, p);
  return p;
};

// Every live basket, every chain: does this wallet hold it? One balanceOf per
// basket, run in parallel per chain. Baskets number in the tens, so this is a
// bounded fan-out — and it is the only honest way to answer "what do I hold"
// without an indexer.
export async function readPortfolio(address: string): Promise<PortfolioView> {
  const baskets = await listIndexes();
  const results = await Promise.all(
    baskets.map(async (b) => {
      const p = providerFor(b.chain);
      if (!p) return null;
      try {
        const c = new Contract(b.address, ERC20, p);
        const [raw, dec] = await Promise.all([
          c.balanceOf(address) as Promise<bigint>,
          (c.decimals() as Promise<bigint>).catch(() => 18n),
        ]);
        if (raw === 0n) return null;
        const bal = Number(raw) / 10 ** Number(dec);
        // navPerToken is the basket's own USD price per token
        return {
          symbol: b.symbol,
          address: b.address,
          chain: b.chain,
          balance: bal,
          valueUsd: bal * (b.navPerToken || 0),
          change24hPct: b.change24hPct,
        } as Position;
      } catch {
        return null;
      }
    }),
  );
  const positions = results.filter((x): x is Position => x !== null).sort((a, b) => b.valueUsd - a.valueUsd);
  return { positions, totalUsd: positions.reduce((s, p) => s + p.valueUsd, 0), checked: baskets.length };
}

// ── Linking, either direction ────────────────────────────────────────────────
// The bot mints a short code; the SITE claims it once the visitor's wallet is
// connected (so the address is one they actually control, not one they typed).
// Codes are single-use and short-lived. A user may still paste an address in
// the DM instead — that is read-only public data, and the reply says so.
interface Pending {
  userId: number | string;
  at: number;
}
const CODE_TTL_MS = 20 * 60_000;
const pendKey = (code: string) => `link:${code.toUpperCase()}`;

export function newLinkCode(): string {
  // no 0/O/1/I — these get read aloud and retyped
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}
export async function stashLinkCode(code: string, userId: number | string): Promise<void> {
  const rec: Pending = { userId, at: Date.now() };
  try {
    const b = await blob();
    if (b) await b.setJSON(pendKey(code), rec);
    else mem.set(pendKey(code), rec);
  } catch {
    /* best-effort */
  }
}
/** the site calls this after the visitor connects a wallet — returns the linked user */
export async function claimLinkCode(code: string, address: string): Promise<number | string | null> {
  try {
    const b = await blob();
    const raw = b ? await b.get(pendKey(code), { type: "json" }) : mem.get(pendKey(code));
    const p = raw as Pending | null | undefined;
    if (!p?.userId || Date.now() - p.at > CODE_TTL_MS) return null;
    await linkWallet(p.userId, address);
    // burn the code so a shoulder-surfer can't reuse it
    if (b) await b.setJSON(pendKey(code), {});
    else mem.delete(pendKey(code));
    return p.userId;
  } catch {
    return null;
  }
}
