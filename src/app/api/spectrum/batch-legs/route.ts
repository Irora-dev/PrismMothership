import { NextRequest, NextResponse } from "next/server";
import { Contract, formatUnits } from "ethers";
import { getBaseProvider, getHoodProvider, getProvider } from "@/lib/chain/live";
import { PORTFOLIO_BATCHER_WATCH, PRISM, TOPIC_BATCH } from "@/lib/chain/constants";
import { listIndexes } from "@/lib/spectrum/index-data";

// What a portfolio batch actually BOUGHT: the legs from the transaction's own
// receipt (the designer, 2026-08-15 — the card shows the assets and their dollar
// values). Read on demand per card-open rather than fattening every feed
// event; this also serves SHARED links, whose ?evt= payload carries no legs.
// Only transactions on the watched batchers decode — anything else is not a
// batch of ours and returns empty.

export const dynamic = "force-dynamic";

const SYMBOL_ABI = ["function symbol() view returns (string)"];

const providerOf = (chain: string) => (chain === "ethereum" ? getProvider() : chain === "base" ? getBaseProvider() : getHoodProvider());

let cache = new Map<string, { at: number; body: unknown }>();

export async function GET(req: NextRequest) {
  const tx = (req.nextUrl.searchParams.get("tx") ?? "").toLowerCase();
  const chain = req.nextUrl.searchParams.get("chain") ?? "ethereum";
  if (!/^0x[0-9a-f]{64}$/.test(tx)) return NextResponse.json({ error: "bad tx" }, { status: 400 });

  const key = `${chain}:${tx}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 300_000) return NextResponse.json(hit.body);
  if (cache.size > 500) cache = new Map(); // a receipt's legs never change; the cap just bounds memory

  const p = providerOf(chain);
  if (!p) return NextResponse.json({ error: "no rpc" }, { status: 503 });

  const watch = new Set(
    (PORTFOLIO_BATCHER_WATCH[chain as keyof typeof PORTFOLIO_BATCHER_WATCH] ?? []).map((a) => a.toLowerCase()),
  );

  try {
    const rcpt = await p.getTransactionReceipt(tx);
    if (!rcpt) return NextResponse.json({ legs: [] });
    const raw: { token: string; usd: number }[] = [];
    for (const l of rcpt.logs) {
      if (!watch.has(l.address.toLowerCase())) continue;
      if (l.topics[0] === TOPIC_BATCH.legFilled) {
        // (recipient idx, buyToken idx, fundingUsed, delivered)
        raw.push({ token: `0x${l.topics[2].slice(26)}`, usd: Number(formatUnits(BigInt(l.data.slice(0, 66)), 6)) });
      } else if (l.topics[0] === TOPIC_BATCH.batchLegFilled) {
        // (recipient idx, asset idx, venue u8, budgetIn, out) — budgetIn is word 2
        raw.push({ token: `0x${l.topics[2].slice(26)}`, usd: Number(formatUnits(BigInt("0x" + l.data.slice(2 + 64, 2 + 128)), 6)) });
      }
    }
    // resolve identities: symbol per unique token, plus where a buy would go
    const baskets = new Map((await listIndexes().catch(() => [])).map((ix) => [ix.address.toLowerCase(), ix]));
    const uniq = [...new Set(raw.map((r) => r.token.toLowerCase()))];
    const symbols = new Map<string, string>();
    await Promise.all(
      uniq.map(async (t) => {
        try {
          symbols.set(t, (await new Contract(t, SYMBOL_ABI, p).symbol()) as string);
        } catch {
          symbols.set(t, `${t.slice(0, 6)}…`);
        }
      }),
    );
    const legs = raw.map((r) => {
      const t = r.token.toLowerCase();
      const basket = baskets.get(t);
      const isPrism = t === PRISM.toLowerCase();
      return {
        token: r.token,
        symbol: isPrism ? "PRISM" : (basket?.symbol ?? symbols.get(t) ?? "?"),
        usd: r.usd,
        // where "buy this" goes: PRISM trades natively here, a Spectrum basket
        // has its own page, anything else links out to its explorer
        buyHref: isPrism ? "/trade" : basket ? `/baskets/${r.token}` : null,
        isBasket: Boolean(basket),
        isPrism,
      };
    });
    const body = { legs };
    cache.set(key, { at: Date.now(), body });
    return NextResponse.json(body);
  } catch {
    return NextResponse.json({ legs: [] });
  }
}
