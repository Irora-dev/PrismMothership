// ── Money-path defences ──────────────────────────────────────────────────────
// These surfaces never move funds, but they DIRECT them: /ca says what to buy,
// /token says what a thing is worth, /buy says which position to trim. A wrong
// answer here spends someone's money as surely as a bad transaction would. So
// each one is treated as a partial-money path and defended:
//
//   · TICKER COLLISION is the live scam vector. Four distinct tokens call
//     themselves "PEPE" on Ethereum/Base right now, and picking the most
//     liquid silently is only safe until someone out-liquidities a smaller
//     ticker. Every ticker resolution reports its rivals and its confidence,
//     and a money action always shows the contract address.
//   · NUMBERS THAT CANNOT BE TRUE are refused rather than displayed. A missing
//     number is a nuisance; a wrong one is a loss.
//   · FUNDING PLANS are checked against invariants before a human sees them.
//
// Nothing here is advice. It is arithmetic with its assumptions stated.

import { validateAddress, validateTicker, type TokenMatch } from "./token-validate";
import type { FundingPlan, PortfolioView } from "./dm-portfolio";

export interface SafeToken {
  match: TokenMatch;
  /** other distinct contracts using the same ticker, most liquid first */
  rivals: { address: string; liquidityUsd: number; chain: string }[];
  /** the winner's share of all liquidity for that ticker, 0–1 */
  dominance: number;
  warnings: string[];
  /** true when the query was an address — unambiguous by construction */
  exact: boolean;
}

interface DexPair {
  chainId?: string;
  baseToken?: { address?: string; symbol?: string };
  liquidity?: { usd?: number };
}

const LOW_LIQUIDITY_USD = 25_000;
const WEAK_DOMINANCE = 0.8;

/** every distinct contract answering to this ticker on ETH/Base */
async function rivalsFor(symbol: string): Promise<{ address: string; liquidityUsd: number; chain: string }[]> {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(symbol)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) return [];
    const d = (await r.json()) as { pairs?: DexPair[] };
    const best = new Map<string, { address: string; liquidityUsd: number; chain: string }>();
    for (const p of d.pairs ?? []) {
      const chain = p.chainId;
      if (chain !== "ethereum" && chain !== "base") continue;
      if ((p.baseToken?.symbol ?? "").toUpperCase() !== symbol.toUpperCase()) continue;
      const a = p.baseToken?.address?.toLowerCase();
      if (!a) continue;
      const liq = p.liquidity?.usd ?? 0;
      const prev = best.get(a);
      if (!prev || liq > prev.liquidityUsd) best.set(a, { address: a, liquidityUsd: liq, chain });
    }
    return [...best.values()].sort((x, y) => y.liquidityUsd - x.liquidityUsd);
  } catch {
    return [];
  }
}

/**
 * Resolve a user's token reference with its ambiguity made explicit.
 * An address resolves exactly. A ticker resolves to the deepest pool AND
 * reports every rival, so the caller can show what was chosen and why.
 */
// Addresses that are shaped like a token but are not one. DexScreener answers
// the ZERO address with native ETH, so /buy 0x000…000 priced a burn address as
// a purchase — found by the adversarial gate, and exactly the class of bug that
// spends someone's money on nothing.
const NON_TOKENS = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
  "0xffffffffffffffffffffffffffffffffffffffff",
]);
export const isNonToken = (a: string): boolean => NON_TOKENS.has(a.trim().toLowerCase());

export async function resolveSafely(query: string, chain?: "ethereum" | "base"): Promise<SafeToken | null> {
  const q = query.trim();
  const isAddress = /^0x[a-fA-F0-9]{40}$/.test(q);
  if (isAddress && isNonToken(q)) return null; // burn/zero addresses are never a buy
  const match = isAddress ? await validateAddress(q, chain) : await validateTicker(q, chain);
  if (!match) return null;

  const warnings: string[] = [];
  let rivals: SafeToken["rivals"] = [];
  let dominance = 1;

  if (!isAddress) {
    const all = await rivalsFor(match.symbol);
    const total = all.reduce((s, x) => s + x.liquidityUsd, 0);
    const mine = all.find((x) => x.address === match.address.toLowerCase())?.liquidityUsd ?? match.liquidityUsd;
    dominance = total > 0 ? mine / total : 1;
    rivals = all.filter((x) => x.address !== match.address.toLowerCase());
    if (rivals.length) {
      warnings.push(
        `${rivals.length} other token${rivals.length === 1 ? "" : "s"} use the ticker $${match.symbol}. This is the deepest pool, not necessarily the one you mean. Check the address.`,
      );
    }
    if (dominance < WEAK_DOMINANCE && rivals.length) {
      warnings.push("The rival pools are close in size. Confirm the contract address before sending anything.");
    }
  }

  if (match.liquidityUsd < LOW_LIQUIDITY_USD) {
    warnings.push(`Thin liquidity (${Math.round(match.liquidityUsd).toLocaleString("en-US")} USD). Expect slippage, and a small sell can move the price a lot.`);
  }

  return { match, rivals, dominance, warnings, exact: isAddress };
}

// ── Amounts a human might fat-finger, or an attacker might probe with ────────
export interface AmountCheck {
  ok: boolean;
  reason?: string;
}
export function checkAmountUsd(raw: string | number, bookUsd?: number): AmountCheck {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return { ok: false, reason: "That amount isn't a number." };
  if (n <= 0) return { ok: false, reason: "The amount has to be more than zero." };
  if (n < 1) return { ok: false, reason: "Below $1 the fees cost more than the trade." };
  if (n > 10_000_000) return { ok: false, reason: "That's beyond what I'll price. Check the number." };
  // a size far beyond the book is usually a typo (100000 for 1000)
  if (bookUsd && bookUsd > 0 && n > bookUsd * 50) {
    return { ok: false, reason: `That's ${Math.round(n / bookUsd)}× your whole book. Check the number.` };
  }
  return { ok: true };
}

// ── Funding invariants: check the arithmetic before a human acts on it ───────
// A funding plan that over-trims, double-counts, or goes negative would tell
// someone to sell more than they own. These are cheap assertions on our own
// output, run before it is ever shown.
export function auditFunding(plan: FundingPlan, pf: PortfolioView): string[] {
  const problems: string[] = [];
  const legs = [...plan.fromCash, ...plan.fromTrim];
  const byAddress = new Map(pf.positions.map((p) => [p.address.toLowerCase(), p]));

  for (const l of legs) {
    if (!(l.takeUsd > 0)) problems.push(`a funding leg for ${l.symbol} is not a positive amount`);
    const held = byAddress.get(l.address.toLowerCase());
    if (!held) problems.push(`funding names ${l.symbol}, which isn't in this wallet`);
    else if (l.takeUsd > held.valueUsd + 0.01) problems.push(`funding would take more ${l.symbol} than is held`);
  }
  // legs must not exceed the need (rounding tolerance)
  const covered = legs.reduce((s, l) => s + l.takeUsd, 0);
  if (covered > plan.needUsd + 0.5) problems.push("funding legs add up to more than the order");
  if (covered + plan.shortfallUsd < plan.needUsd - 0.5) problems.push("funding legs plus the shortfall don't cover the order");
  // one asset must not appear twice
  const seen = new Set<string>();
  for (const l of legs) {
    const k = l.address.toLowerCase();
    if (seen.has(k)) problems.push(`${l.symbol} is used twice in the funding plan`);
    seen.add(k);
  }
  return problems;
}

/** a value that cannot be true is refused rather than shown */
export function plausibleUsd(n: number | null | undefined): boolean {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n < 1e12;
}
