// ── Sharing a basket: the canonical link, and the post that carries it ───────
// the designer, 2026-08-13: paste a basket address, get an image and the text to post
// with it. This half is the text and the link.
//
// ⚠️ THE LINK FORMAT IS NOT OURS TO INVENT. It mirrors the Spectrum app's own
// short-url minter (spectrum-mini `app/src/lib/spectrum/short-url.ts`): a chain
// LETTER plus `SYMBOL-<8 hex of the address>`. The symbol half is for humans;
// the address prefix is what actually resolves, because two baskets on one
// chain can carry the same ticker and a bare-symbol link would silently change
// meaning the day someone launches a twin. If that file's scheme ever changes,
// this one has to move with it or every card we have posted points nowhere.

const CHAIN_ID: Record<string, number> = { ethereum: 1, base: 8453, robinhood: 4663 };
const CHAIN_LETTER: Record<number, string> = { 1: "e", 8453: "b", 4663: "r" };

/** The chain's path segment: a letter where the app has one, else its raw id. */
export function chainSlug(chain: string): string {
  const id = CHAIN_ID[chain];
  return id ? (CHAIN_LETTER[id] ?? String(id)) : chain;
}

const SAFE_SYMBOL = /^[A-Za-z0-9]{1,11}$/;
const addrPrefix = (address: string) => address.toLowerCase().slice(2, 10);

/** `SYMBOL-<8hex>`, or the address prefix alone when the ticker carries
 *  characters that do not belong in a URL path. */
export function basketRef(symbol: string, address: string): string {
  const sym = (symbol ?? "").trim();
  return SAFE_SYMBOL.test(sym) ? `${sym.toUpperCase()}-${addrPrefix(address)}` : addrPrefix(address);
}

export const SPECTRUM_ORIGIN = "https://spectrumindexes.xyz";

/** The public link to a basket, the same shape the Spectrum app itself mints.
 *  Short, so it costs almost nothing of an X post's budget. */
export function basketShareUrl(symbol: string, address: string, chain: string): string {
  return `${SPECTRUM_ORIGIN}/t/${chainSlug(chain)}/${basketRef(symbol, address)}`;
}

/** The long form of the same page, which is what the designer specified for the card's
 *  QR (2026-08-13, with the worked example
 *  `…/token?addr=0x2ed6962f67ae39e2e254a6311875d2097e074088&chain=4663`).
 *  Both forms resolve to the identical page and the app keeps every long URL
 *  working forever by design, so the QR carries the explicit one, where length
 *  costs nothing, and the post carries the short one, where it does. */
export function basketPageUrl(address: string, chain: string): string {
  const id = CHAIN_ID[chain] ?? chain;
  return `${SPECTRUM_ORIGIN}/token?addr=${address.toLowerCase()}&chain=${id}`;
}

const CHAIN_NAME: Record<string, string> = {
  ethereum: "Ethereum",
  base: "Base",
  robinhood: "Robinhood Chain",
};

/** The post for a bundle. Same discipline as a basket's: what it holds, never
 *  how it has done. It leads with the thesis and mentions the chains once,
 *  because the designer's whole point is that a bundle is one idea and the baskets
 *  underneath are plumbing nobody needs to read about. */
export function bundleShareText(name: string | null, chains: string[], symbols: string[], link: string): string {
  const legs = [...new Set(symbols.filter(Boolean))].slice(0, 6);
  const chainNames = chains.map((c) => CHAIN_NAME[c] ?? c);
  const across =
    chainNames.length > 1
      ? `${chainNames.slice(0, -1).join(", ")} and ${chainNames[chainNames.length - 1]}`
      : (chainNames[0] ?? "");
  // Only a real URL goes in. A bundle assembled from pasted addresses has no
  // page of its own yet — that one-page cross-chain buy flow is the thing still
  // to be built — and echoing the addresses back as if they were a link would
  // put a dead one in a post.
  const url = /^https?:\/\//i.test(link.trim()) ? link.trim() : "";
  return [
    name ? `$${name.replace(/^\$/, "")}` : "A cross-chain thesis",
    "",
    legs.join(" · "),
    "",
    `One buy, across ${across}.`,
    ...(url ? ["", url] : []),
  ].join("\n");
}

export interface ShareTextInput {
  symbol: string;
  address: string;
  chain: string;
  holdings: { symbol: string; liveWeightPct: number; targetWeightPct: number }[];
  totalCount: number;
}

/** The default post. Deliberately describes what the basket IS and never how it
 *  has performed: no price, no return, no yield, no burn percentage. Two
 *  reasons. The copy-screening red lines treat a profit projection as a
 *  hard stop, and the burn share differs by lineage (deployed gen-1 baskets
 *  read 10% while the ruled standard is 25%, the designer 2026-08-16), so a number
 *  baked into a post we cannot edit after the fact is the wrong place for it.
 *  The Studio leaves this editable, so this is a starting point and not a cage. */
export function basketShareText(b: ShareTextInput): string {
  const legs = [...b.holdings]
    .sort((x, y) => (y.liveWeightPct || y.targetWeightPct) - (x.liveWeightPct || x.targetWeightPct))
    .map((h) => h.symbol)
    .filter(Boolean);
  const shown = legs.slice(0, 4);
  const rest = Math.max(0, b.totalCount - shown.length);
  const line = shown.join(" · ") + (rest > 0 ? ` · +${rest} more` : "");
  const chain = CHAIN_NAME[b.chain] ?? b.chain;
  return [
    `$${b.symbol}`,
    "",
    line,
    "",
    `One token, the whole basket. Live on ${chain}.`,
    "",
    basketShareUrl(b.symbol, b.address, b.chain),
  ].join("\n");
}
