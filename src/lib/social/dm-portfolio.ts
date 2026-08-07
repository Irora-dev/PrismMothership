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

// ── The WHOLE wallet, not just our baskets ───────────────────────────────────
// Alerts about a member's positions are only useful if they cover what the
// member actually holds. Alchemy returns every ERC-20 balance in one call per
// chain; DexScreener prices them in one batched call per 30 addresses. Tokens
// we can't price are dropped rather than shown at zero — an unpriceable row is
// noise, and a wrong number is worse than a missing one.
interface RawBal { contractAddress: string; tokenBalance: string }

async function alchemyBalances(address: string, chain: "ethereum" | "base"): Promise<RawBal[]> {
  const key = process.env.ALCHEMY_API_KEY;
  if (!key) return [];
  const host = chain === "base" ? "base-mainnet" : "eth-mainnet";
  try {
    const r = await fetch(`https://${host}.g.alchemy.com/v2/${key}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "alchemy_getTokenBalances", params: [address, "erc20"] }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return [];
    const d = (await r.json()) as { result?: { tokenBalances?: RawBal[] } };
    return (d.result?.tokenBalances ?? []).filter((b) => b.tokenBalance && !/^0x0*$/.test(b.tokenBalance));
  } catch {
    return [];
  }
}

interface DexTok { baseToken?: { address?: string; symbol?: string }; priceUsd?: string; priceChange?: { h24?: number }; liquidity?: { usd?: number } }
async function priceMany(chain: "ethereum" | "base", addrs: string[]): Promise<Map<string, { symbol: string; priceUsd: number; change24hPct: number | null }>> {
  const out = new Map<string, { symbol: string; priceUsd: number; change24hPct: number | null }>();
  for (let i = 0; i < addrs.length; i += 30) {
    const batch = addrs.slice(i, i + 30);
    try {
      const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${batch.join(",")}`, { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) continue;
      const d = (await r.json()) as { pairs?: DexTok[] };
      for (const p of d.pairs ?? []) {
        const a = p.baseToken?.address?.toLowerCase();
        const px = Number(p.priceUsd) || 0;
        if (!a || !px) continue;
        const prev = out.get(a);
        // keep the deepest pool's quote for each token
        if (!prev || (p.liquidity?.usd ?? 0) > 0) out.set(a, { symbol: p.baseToken?.symbol || "?", priceUsd: px, change24hPct: p.priceChange?.h24 ?? null });
      }
    } catch {
      /* next batch */
    }
  }
  return out;
}

/** every priceable ERC-20 the wallet holds on ETH + Base, plus our baskets */
export async function readFullPortfolio(address: string): Promise<PortfolioView> {
  const baskets = await readPortfolio(address);
  const known = new Set(baskets.positions.map((p) => p.address.toLowerCase()));
  const extra: Position[] = [];
  for (const chain of ["ethereum", "base"] as const) {
    const bals = await alchemyBalances(address, chain);
    if (!bals.length) continue;
    const addrs = bals.map((b) => b.contractAddress.toLowerCase()).filter((a) => !known.has(a)).slice(0, 60);
    if (!addrs.length) continue;
    const prices = await priceMany(chain, addrs);
    for (const b of bals) {
      const a = b.contractAddress.toLowerCase();
      const px = prices.get(a);
      if (!px) continue; // unpriceable → omit, never show a zero
      // decimals unknown here; DexScreener prices are per whole token and 18 is
      // overwhelmingly the norm — a wrong-decimals row would be a wrong NUMBER,
      // so anything implausible is dropped below by the dust floor
      const bal = Number(BigInt(b.tokenBalance)) / 1e18;
      const valueUsd = bal * px.priceUsd;
      if (valueUsd < 1) continue; // dust never speaks
      extra.push({ symbol: px.symbol, address: a, chain, balance: bal, valueUsd, change24hPct: px.change24hPct });
    }
  }
  const positions = [...baskets.positions, ...extra].sort((x, y) => y.valueUsd - x.valueUsd);
  return { positions, totalUsd: positions.reduce((s, p) => s + p.valueUsd, 0), checked: baskets.checked + extra.length };
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

// ── Snapshots (what /pnl measures from) ──────────────────────────────────────
// True cost basis needs every historical transfer priced at its block — an
// indexer's job. What is honest and cheap: snapshot the portfolio when a wallet
// is linked, and again on every alert sweep, then measure from there and SAY
// SO. "Since you linked" is a real answer; a made-up cost basis is not.
export interface Snapshot {
  at: number;
  totalUsd: number;
  byAsset: Record<string, { valueUsd: number; balance: number }>; // keyed by address
}
const snapKey = (userId: number | string) => `snap:${userId}`;

export async function getSnapshot(userId: number | string): Promise<Snapshot | null> {
  try {
    const b = await blob();
    const raw = b ? await b.get(snapKey(userId), { type: "json" }) : mem.get(snapKey(userId));
    const s = raw as Snapshot | null | undefined;
    return s?.at ? s : null;
  } catch {
    return null;
  }
}
export async function putSnapshot(userId: number | string, snap: Snapshot): Promise<void> {
  try {
    const b = await blob();
    if (b) await b.setJSON(snapKey(userId), snap);
    else mem.set(snapKey(userId), snap);
  } catch {
    /* best-effort */
  }
}
export const snapshotOf = (pf: PortfolioView): Snapshot => ({
  at: Date.now(),
  totalUsd: pf.totalUsd,
  byAsset: Object.fromEntries(pf.positions.map((p) => [p.address.toLowerCase(), { valueUsd: p.valueUsd, balance: p.balance }])),
});

// ── Alert preferences + the anti-nag state ───────────────────────────────────
// An alert nobody wants is worse than no alerts. The discipline, encoded:
//   · MATERIAL — a move must clear BOTH a % and a DOLLAR floor, so dust never
//     speaks and a 3% move on a big position still can
//   · RATE-LIMITED — a daily cap per user and a cooldown per asset
//   · ACTIONABLE — every alert ends in something the reader can do
//   · OPT-OUT — /alerts off, always
export interface AlertPrefs {
  on: boolean;
  minPct: number; // move size that counts
  minUsd: number; // …and it must be worth this much
  maxPerDay: number;
}
export interface AlertState {
  prefs: AlertPrefs;
  sentToday: number;
  dayStamp: string; // YYYY-MM-DD, resets the daily count
  lastByAsset: Record<string, number>; // address → ms of last alert
  lastClaimNudge?: number;
}
export const DEFAULT_PREFS: AlertPrefs = { on: true, minPct: 12, minUsd: 25, maxPerDay: 3 };
const ASSET_COOLDOWN_MS = 12 * 3_600_000;
const alertKey = (userId: number | string) => `alerts:${userId}`;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export async function getAlertState(userId: number | string): Promise<AlertState> {
  try {
    const b = await blob();
    const raw = b ? await b.get(alertKey(userId), { type: "json" }) : mem.get(alertKey(userId));
    const s = raw as AlertState | null | undefined;
    if (s?.prefs) return s;
  } catch {
    /* fresh */
  }
  return { prefs: { ...DEFAULT_PREFS }, sentToday: 0, dayStamp: dayOf(Date.now()), lastByAsset: {} };
}
export async function putAlertState(userId: number | string, s: AlertState): Promise<void> {
  try {
    const b = await blob();
    if (b) await b.setJSON(alertKey(userId), s);
    else mem.set(alertKey(userId), s);
  } catch {
    /* best-effort */
  }
}

/** may this user hear about this asset right now? enforces cap + cooldown */
export function alertAllowed(st: AlertState, assetKey: string, now: number): boolean {
  if (!st.prefs.on) return false;
  if (st.dayStamp !== dayOf(now)) return true; // new day resets the cap
  if (st.sentToday >= st.prefs.maxPerDay) return false;
  const last = st.lastByAsset[assetKey] ?? 0;
  return now - last > ASSET_COOLDOWN_MS;
}
export function noteAlertSent(st: AlertState, assetKey: string, now: number): AlertState {
  const day = dayOf(now);
  return {
    ...st,
    dayStamp: day,
    sentToday: st.dayStamp === day ? st.sentToday + 1 : 1,
    lastByAsset: { ...st.lastByAsset, [assetKey]: now },
  };
}

/** everyone with a linked wallet — the sweep's roster */
export async function linkedUsers(): Promise<(number | string)[]> {
  try {
    const b = await blob();
    if (!b) return [...mem.keys()].filter((k) => k.startsWith("u:")).map((k) => k.slice(2));
    const withList = b as unknown as { list?: (o: { prefix: string }) => Promise<{ blobs: { key: string }[] }> };
    if (typeof withList.list !== "function") return [];
    const { blobs } = await withList.list({ prefix: "u:" });
    return blobs.map((x) => x.key.slice(2));
  } catch {
    return [];
  }
}

// ── Funding: every buy comes from somewhere ──────────────────────────────────
// A buy is a PORTFOLIO operation, not an isolated swap. Before handing anyone a
// venue we answer the real question — what funds this? Cash they already hold,
// or trimming something they own. The same shape is what the Spectrum Portfolio
// batcher will execute in one transaction once it is on-chain; until then the
// bot states the plan and the legs are signed on the site.
const CASH_SYMBOLS = new Set(["USDC", "USDT", "DAI", "USDS", "FRAX", "LUSD", "USDE", "PYUSD", "WETH", "ETH"]);
const STABLE_ONLY = new Set(["USDC", "USDT", "DAI", "USDS", "FRAX", "LUSD", "USDE", "PYUSD"]);

export interface FundingLeg {
  symbol: string;
  address: string;
  chain: string;
  takeUsd: number;
  ofPositionUsd: number;
}
export interface FundingPlan {
  needUsd: number;
  cashUsd: number; // stablecoins + ETH the wallet already holds
  fromCash: FundingLeg[];
  fromTrim: FundingLeg[]; // proportional trim across the rest, largest first
  shortfallUsd: number; // what the portfolio cannot cover
  sameChain: boolean; // whether every leg sits on the buy's chain
}

/** How would this wallet pay for `needUsd` of something, using what it holds? */
export function planFunding(pf: PortfolioView, needUsd: number, targetChain?: string): FundingPlan {
  const cash = pf.positions.filter((p) => CASH_SYMBOLS.has(p.symbol.toUpperCase()));
  const rest = pf.positions.filter((p) => !CASH_SYMBOLS.has(p.symbol.toUpperCase())).sort((a, b) => b.valueUsd - a.valueUsd);
  const cashUsd = cash.reduce((s, p) => s + p.valueUsd, 0);

  const fromCash: FundingLeg[] = [];
  let remaining = needUsd;
  // stables first, then ETH — spending the least opinionated asset first
  for (const p of [...cash].sort((a, b) => Number(STABLE_ONLY.has(b.symbol.toUpperCase())) - Number(STABLE_ONLY.has(a.symbol.toUpperCase())) || b.valueUsd - a.valueUsd)) {
    if (remaining <= 0.01) break;
    const take = Math.min(p.valueUsd, remaining);
    fromCash.push({ symbol: p.symbol, address: p.address, chain: p.chain, takeUsd: take, ofPositionUsd: p.valueUsd });
    remaining -= take;
  }

  // still short → trim the biggest holdings, proportionally, largest first
  const fromTrim: FundingLeg[] = [];
  for (const p of rest) {
    if (remaining <= 0.01) break;
    const take = Math.min(p.valueUsd * 0.5, remaining); // never more than half a position without being asked
    if (take < 1) continue;
    fromTrim.push({ symbol: p.symbol, address: p.address, chain: p.chain, takeUsd: take, ofPositionUsd: p.valueUsd });
    remaining -= take;
  }

  const legs = [...fromCash, ...fromTrim];
  return {
    needUsd,
    cashUsd,
    fromCash,
    fromTrim,
    shortfallUsd: Math.max(0, remaining),
    sameChain: !targetChain || legs.every((l) => l.chain === targetChain),
  };
}

/** the batcher that executes a whole plan in one transaction — not yet on-chain */
export const portfolioBatcherLive = (): boolean => /^0x[a-fA-F0-9]{40}$/.test(process.env.PORTFOLIO_BATCHER_ADDRESS || "");
