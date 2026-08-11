// Validate a ticker for /createbasket: is it a real, tradeable token on a chain
// Spectrum can deploy a basket to, with actual liquidity? Uses DexScreener's
// search (same source the site already uses for prices) — resolves a $TICKER to
// its best on-chain match by liquidity. Read-only, no funds.
//
// ⚠️ Robinhood was missing here until 2026-08-07, and it is the chain that
// matters: SpectrumContracts measured all 21 live baskets on Robinhood 4663 with
// ZERO on Base or Ethereum. A group could not propose a token on the only chain
// their basket would actually land on. DexScreener's slug is verified live as
// "robinhood" (CASHCAT, STONKBROKER and PONS all resolve there).

/** The chains Spectrum has a factory on. A basket is single-chain by
 *  construction, so a draft is locked to exactly one of these. */
export const BASKET_CHAINS = ["ethereum", "base", "robinhood"] as const;
export type BasketChain = (typeof BASKET_CHAINS)[number];
const isBasketChain = (id: unknown): id is BasketChain =>
  typeof id === "string" && (BASKET_CHAINS as readonly string[]).includes(id);

export interface TokenMatch {
  symbol: string;
  name: string;
  address: string;
  chain: BasketChain;
  liquidityUsd: number;
  priceUsd: number;
  change24hPct?: number | null;
  volume24hUsd?: number | null;
  /** Other basket-capable chains the same ticker resolves on. A non-empty list
   *  means the ticker is ambiguous and the address is the only safe way to say
   *  which token is meant. */
  alsoOn?: BasketChain[];
}

interface DexSearchPair {
  chainId?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  priceChange?: { h24?: number };
  volume?: { h24?: number };
}

// Resolve one ticker to its highest-liquidity token, or null if it isn't a
// tradeable token there. Pass `chain` to require that specific chain (a token can
// exist on both ETH and Base — for a chain-locked basket you want the pool on the
// draft's chain, not just the globally-deepest one). No `chain` → best of ETH/Base.
export async function validateTicker(query: string, chain?: BasketChain): Promise<TokenMatch | null> {
  const q = query.trim().replace(/^\$/, "");
  if (!/^[A-Za-z0-9]{1,15}$/.test(q)) return null;
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`, {
      headers: { Accept: "application/json" },
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { pairs?: DexSearchPair[] };
    const pairs = Array.isArray(data.pairs) ? data.pairs : [];
    const matches: TokenMatch[] = pairs
      .filter(
        (p) =>
          (chain ? p.chainId === chain : isBasketChain(p.chainId)) &&
          p.baseToken?.symbol?.toLowerCase() === q.toLowerCase() &&
          !!p.baseToken?.address,
      )
      .map((p) => ({
        symbol: p.baseToken!.symbol!,
        name: p.baseToken!.name || p.baseToken!.symbol!,
        address: p.baseToken!.address!,
        chain: p.chainId as BasketChain,
        liquidityUsd: p.liquidity?.usd ?? 0,
        priceUsd: Number(p.priceUsd) || 0,
        change24hPct: p.priceChange?.h24 ?? null,
        volume24hUsd: p.volume?.h24 ?? null,
      }));
    if (!matches.length) return null;
    matches.sort((a, b) => b.liquidityUsd - a.liquidityUsd);
    const best = matches[0];
    // Say when the same ticker lives on more than one basket chain. Picking the
    // deepest pool is a guess, and STONKBROKER really does resolve on both
    // Robinhood and Base — a wrong pick here is a wrong BASKET, not a wrong view.
    const alsoOn = [...new Set(matches.map((m) => m.chain))].filter((c) => c !== best.chain);
    return alsoOn.length ? { ...best, alsoOn } : best;
  } catch {
    return null;
  }
}

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

// Resolve a pasted contract ADDRESS directly (unambiguous — sidesteps ticker
// collisions/spoofs). Optionally require a chain.
export async function validateAddress(address: string, chain?: BasketChain): Promise<TokenMatch | null> {
  const addr = address.trim();
  if (!ADDR_RE.test(addr)) return null;
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${addr}`, { headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    const data = (await r.json()) as { pairs?: DexSearchPair[] };
    const pairs = Array.isArray(data.pairs) ? data.pairs : [];
    const matches: TokenMatch[] = pairs
      .filter(
        (p) =>
          (chain ? p.chainId === chain : isBasketChain(p.chainId)) &&
          p.baseToken?.address?.toLowerCase() === addr.toLowerCase(),
      )
      .map((p) => ({
        symbol: p.baseToken!.symbol!,
        name: p.baseToken!.name || p.baseToken!.symbol!,
        address: p.baseToken!.address!,
        chain: p.chainId as BasketChain,
        liquidityUsd: p.liquidity?.usd ?? 0,
        priceUsd: Number(p.priceUsd) || 0,
        change24hPct: p.priceChange?.h24 ?? null,
        volume24hUsd: p.volume?.h24 ?? null,
      }));
    if (!matches.length) return null;
    matches.sort((a, b) => b.liquidityUsd - a.liquidityUsd);
    return matches[0];
  } catch {
    return null;
  }
}

// Resolve either a pasted address (precise) or a ticker (best-effort). Prefer
// giving users the address path for anything ambiguous.
export async function resolveToken(input: string, chain?: BasketChain): Promise<TokenMatch | null> {
  const s = input.trim();
  return ADDR_RE.test(s) ? validateAddress(s, chain) : validateTicker(s, chain);
}

export const isAddress = (s: string): boolean => ADDR_RE.test(s.trim());

// DexScreener page for a token — a "verify this is the right one" link.
export const dexUrl = (chain: BasketChain, address: string): string => `https://dexscreener.com/${chain}/${address}`;

export interface ValidationResult {
  query: string;
  match: TokenMatch | null;
  lowLiquidity: boolean;
}

export async function validateTickers(queries: string[], minLiquidityUsd = 1_000): Promise<ValidationResult[]> {
  return Promise.all(
    queries.map(async (query) => {
      const match = await resolveToken(query); // address (precise) or ticker (best-effort)
      return { query, match, lowLiquidity: !!match && match.liquidityUsd < minLiquidityUsd };
    }),
  );
}
