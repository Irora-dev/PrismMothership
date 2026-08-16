// ── Bundles: a cross-chain thesis, read off its own link ─────────────────────
// the designer, 2026-08-09: "say you select assets across base, eth, Robinhood… it's
// going to create three baskets for you… one page where you just buy once…
// And frankly I don't think it needs to be communicated as multiple baskets. It
// should be: here's the thesis, across multiple chains, the stuff I'm bullish
// on."
//
// So a bundle is not a new kind of token. It is a NAMED SET OF LEGS, each leg a
// (chainId, basket address, weight), and the baskets underneath are ordinary
// baskets. That means a bundle card needs no new chain reader at all: parse the
// legs out of the link, then read each basket with the reader we already have.
//
// ⚠️ The wire format is the Spectrum app's, not ours — `encodeBundleParams` /
// `decodeBundle` in spectrum-mini `app/src/lib/spectrum/bundle.ts`. Legs are
// `<chainId>-<address>-<weight>` joined by underscores under `b`, the creator
// under `by`, the name under `n`, capped at six legs. If that format moves,
// this moves with it.

export const MAX_BUNDLE_LEGS = 6;

export interface BundleLeg {
  chainId: number;
  address: string;
  weight: number;
}

export interface ParsedBundle {
  legs: BundleLeg[];
  by: string | null;
  name: string | null;
}

const isAddr = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s);

export const CHAIN_OF_ID: Record<number, string> = { 1: "ethereum", 8453: "base", 4663: "robinhood" };

/** Parse a pasted bundle link, or a bare query string. Invalid legs are dropped
 *  rather than thrown, matching the app's own decoder: a link with one bad leg
 *  still shows the rest instead of showing nothing. */
export function decodeBundleLink(input: string): ParsedBundle {
  const raw = input.trim();
  let search = raw;
  const q = raw.indexOf("?");
  if (q >= 0) search = raw.slice(q + 1);
  const p = new URLSearchParams(search);

  const legs: BundleLeg[] = [];
  for (const seg of (p.get("b") ?? "").split("_")) {
    if (legs.length >= MAX_BUNDLE_LEGS) break;
    const [chainStr, address, wStr] = seg.split("-");
    const chainId = Number(chainStr);
    const weight = Number(wStr);
    if (
      Number.isInteger(chainId) &&
      chainId > 0 &&
      address &&
      isAddr(address) &&
      Number.isFinite(weight) &&
      weight > 0 &&
      !legs.some((l) => l.chainId === chainId && l.address.toLowerCase() === address.toLowerCase())
    ) {
      legs.push({ chainId, address, weight });
    }
  }
  const by = p.get("by");
  const name = p.get("n");
  return { legs, by: by && isAddr(by) ? by : null, name: name ? name.trim().slice(0, 48) : null };
}

/** Does this pasted text look like a bundle rather than a single basket? */
export function looksLikeBundle(input: string): boolean {
  return decodeBundleLink(input).legs.length > 0 || extractAddresses(input).length > 1;
}

/** Every distinct contract address in a blob of pasted text, in order.
 *
 *  ⚠️ This exists because "bundle" means two different things. The link form
 *  above is a weighted set of references to baskets that already exist. But the
 *  one the designer published on 2026-08-12 and calls "a cross-chain basket"
 *  ($THEBIGMULTI, live on Robinhood, Ethereum and Base) is the other kind: you
 *  pick assets across chains, the create flow deploys ONE ORDINARY BASKET PER
 *  CHAIN sharing a name, and the bundle is that group. It has no link format,
 *  no slug and no address of its own, because "a bundle is (deployer, name)".
 *
 *  So the honest input for that kind is simply its addresses. Paste the per-
 *  chain baskets and they become one card. No registry reader is needed: each
 *  address already resolves, and reports its own chain, through the basket
 *  reader we have. */
export function extractAddresses(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of input.match(/0x[a-fA-F0-9]{40}/g) ?? []) {
    const k = m.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(m);
    }
  }
  return out.slice(0, MAX_BUNDLE_LEGS);
}

/** Leg weights as percentages summing to ~100. */
export function legPercents(legs: BundleLeg[]): number[] {
  const total = legs.reduce((s, l) => s + Math.max(l.weight, 0), 0);
  if (total <= 0) return legs.map(() => 0);
  return legs.map((l) => (Math.max(l.weight, 0) / total) * 100);
}
