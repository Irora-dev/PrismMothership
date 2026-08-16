import type { Metadata } from "next";
import { getIndexData } from "@/lib/spectrum/index-data";

// ── What a shared basket link looks like ─────────────────────────────────────
// The basket page is a client component, so it could never carry metadata of
// its own, and every per-basket link posted to X or Telegram fell back to the
// site-wide title, description and card. Twenty-nine baskets, one preview
// between them: you could not tell from a link which basket you were about to
// open.
//
// It now names the basket and shows it. The image is the SAME renderer the bot
// already posts (/api/card?kind=bento), so the preview in a Telegram unfurl and
// the card the bot attaches are the same picture, and there is only one thing to
// keep working.
//
// The description says what the basket HOLDS and never how it has performed:
// an unfurl is cached and re-shown for a long time, which is the worst possible
// place to put a number that moves.

const CHAIN_LABEL: Record<string, string> = {
  ethereum: "Ethereum",
  base: "Base",
  robinhood: "Robinhood Chain",
};

const FALLBACK: Metadata = {
  title: "Spectrum basket · The Prism Mothership",
  description: "A single token holding a whole set of assets, live on-chain.",
};

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return FALLBACK;

  try {
    const d = await getIndexData(address);
    if (!d?.symbol) return FALLBACK;

    const legs = [...(d.holdings ?? [])]
      .sort((a, b) => (b.liveWeightPct || b.targetWeightPct) - (a.liveWeightPct || a.targetWeightPct))
      .map((h) => h.symbol)
      .filter(Boolean);
    const shown = legs.slice(0, 5);
    const rest = Math.max(0, (d.totalCount ?? legs.length) - shown.length);
    const holds = shown.join(", ") + (rest > 0 ? `, and ${rest} more` : "");
    const chain = CHAIN_LABEL[d.chain] ?? d.chain;
    const count = d.totalCount ?? legs.length;

    const title = `$${d.symbol} · ${d.name}`;
    const description = holds
      ? `A Spectrum basket of ${count} asset${count === 1 ? "" : "s"} on ${chain}, held as one token: ${holds}.`
      : `A Spectrum basket on ${chain}, held as one token.`;
    const image = `/api/card?kind=bento&address=${address.toLowerCase()}`;

    return {
      title,
      description,
      openGraph: { title, description, type: "website", images: [{ url: image, width: 1200, height: 630, alt: `${d.symbol} basket composition` }] },
      twitter: { card: "summary_large_image", title, description, images: [image] },
    };
  } catch {
    // A chain read that times out must not take the page down with it: the
    // basket still renders client-side, it just unfurls generically.
    return FALLBACK;
  }
}

export default function BasketLayout({ children }: { children: React.ReactNode }) {
  return children;
}
