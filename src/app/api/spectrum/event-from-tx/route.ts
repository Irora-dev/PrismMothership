import { NextRequest, NextResponse } from "next/server";
import { AbiCoder, Contract, formatEther, formatUnits, getAddress, type TransactionReceipt } from "ethers";
import type { ActivityEvent } from "@/lib/feed/types";
import { basketFeeRate, getBaseProvider, getProvider } from "@/lib/chain/live";
import {
  DEAD,
  PRISM,
  SPECTRUM_V2,
  TOPIC,
  TOPIC_V2,
  USDC_DECIMALS,
  attributeBurnSource,
  L1_PRISM_BURNER,
} from "@/lib/chain/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rebuild a shareable basket event from just its transaction hash — the short
// share link (/spectrum?tx=0x…) resolves here instead of carrying the whole
// event in the URL. Scans the receipt's logs for the topics the live feed
// understands and returns the most significant one (launch > burn > trade).

const abi = AbiCoder.defaultAbiCoder();
const SYMBOL_ABI = ["function symbol() view returns (string)"];

const cache = new Map<string, { at: number; data: ActivityEvent | null }>();
const TTL = 300_000;

async function decode(receipt: TransactionReceipt, chain: "ethereum" | "base", ts: number): Promise<ActivityEvent | null> {
  const provider = chain === "base" ? getBaseProvider() : getProvider();
  let launch: ActivityEvent | null = null;
  let burn: ActivityEvent | null = null;
  let trade: ActivityEvent | null = null;

  // Same discriminator the live feed uses: a burn in a tx that also touched the L1
  // burner is Spectrum fees buying and burning, not the pool's own 20% slice. Both
  // arrive with the PoolManager as sender, so the sender cannot tell them apart.
  // Here the whole receipt is in hand, so it is a direct check rather than a lookup.
  const viaBurner = receipt.logs.some(
    (l) => l.address.toLowerCase() === L1_PRISM_BURNER.toLowerCase(),
  );
  for (const l of receipt.logs) {
    const t0 = l.topics[0];
    const id = `${l.transactionHash}:${l.index}`;
    try {
      if (t0 === TOPIC_V2.launched && !launch) {
        const basket = getAddress("0x" + l.topics[1].slice(26));
        const d = abi.decode(["string", "string", "uint160", "uint256", "uint16"], l.data);
        launch = {
          id,
          kind: "launch",
          source: "spectrum-index",
          chain,
          ts,
          blockNumber: l.blockNumber,
          txHash: l.transactionHash,
          eth: Number(formatEther(d[3] as bigint)),
          label: d[0] as string,
          symbol: d[1] as string,
          actor: basket,
          note: `${d[0]} launched on Spectrum. The launch auction ETH buys & burns PRISM`,
        };
      } else if ((t0 === TOPIC_V2.minted || t0 === TOPIC_V2.redeemed) && !trade) {
        const isBuy = t0 === TOPIC_V2.minted;
        const d = abi.decode(["uint256", "uint256"], l.data);
        const tradeUsd = Number(formatUnits((isBuy ? d[0] : d[1]) as bigint, USDC_DECIMALS));
        const actor = getAddress(l.address);
        const rate = provider ? await basketFeeRate(provider, actor).catch(() => 0.01) : 0.01;
        const sym = provider
          ? await (new Contract(actor, SYMBOL_ABI, provider).symbol() as Promise<string>).catch(() => undefined)
          : undefined;
        trade = {
          id,
          kind: "fee",
          source: "spectrum-index",
          chain,
          ts,
          blockNumber: l.blockNumber,
          txHash: l.transactionHash,
          usd: tradeUsd * rate,
          tradeUsd,
          side: isBuy ? "buy" : "sell",
          symbol: sym,
          actor,
          note: `${sym ? `$${sym} ` : ""}${isBuy ? "buy" : "sell"} on ${chain === "base" ? "Base" : "Ethereum"}. 10% of the fee buys & burns PRISM`,
        };
      } else if (t0 === TOPIC_V2.auctionBridgedToBurnV2 && !burn) {
        const basket = getAddress("0x" + l.topics[1].slice(26));
        burn = {
          id,
          kind: "burn",
          source: "spectrum-auction",
          chain,
          ts,
          blockNumber: l.blockNumber,
          txHash: l.transactionHash,
          eth: Number(formatEther(abi.decode(["uint256"], l.data)[0] as bigint)),
          actor: basket,
          note: "Launch auction proceeds bridged to Ethereum to buy & burn PRISM",
        };
      } else if (t0 === TOPIC.prismBurnBridged && !burn) {
        burn = {
          id,
          kind: "burn",
          source: "spectrum-index",
          chain,
          ts,
          blockNumber: l.blockNumber,
          txHash: l.transactionHash,
          eth: Number(formatUnits(abi.decode(["uint256", "uint256"], l.data)[1] as bigint, 18)),
          actor: getAddress(l.address),
          note: "Basket revenue reached the threshold, bridged to Ethereum to buy & burn PRISM",
        };
      } else if (
        chain === "ethereum" &&
        t0 === TOPIC.transfer &&
        l.address.toLowerCase() === PRISM.toLowerCase() &&
        l.topics[2] &&
        getAddress("0x" + l.topics[2].slice(26)).toLowerCase() === DEAD.toLowerCase() &&
        !burn
      ) {
        const from = getAddress("0x" + l.topics[1].slice(26));
        const { source, note } = attributeBurnSource(from, viaBurner);
        burn = {
          id,
          kind: "burn",
          source,
          chain: "ethereum",
          ts,
          blockNumber: l.blockNumber,
          txHash: l.transactionHash,
          prism: Number(formatUnits(abi.decode(["uint256"], l.data)[0] as bigint, 18)),
          actor: from,
          note,
        };
      }
    } catch {
      /* skip malformed log */
    }
  }
  return launch ?? burn ?? trade;
}

export async function GET(req: NextRequest) {
  const hash = (req.nextUrl.searchParams.get("hash") ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(hash)) return NextResponse.json({ error: "bad hash" }, { status: 400 });
  const prefer = req.nextUrl.searchParams.get("c") === "b" ? "base" : "ethereum";

  const hit = cache.get(hash);
  if (hit && Date.now() - hit.at < TTL) {
    return hit.data ? NextResponse.json(hit.data) : NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Try the hinted chain first, then the other — the hash pins the tx anyway.
  const order: ("ethereum" | "base")[] = prefer === "base" ? ["base", "ethereum"] : ["ethereum", "base"];
  for (const chain of order) {
    const provider = chain === "base" ? getBaseProvider() : getProvider();
    if (!provider) continue;
    try {
      const receipt = await provider.getTransactionReceipt(hash);
      if (!receipt) continue;
      const blk = await provider.getBlock(receipt.blockNumber).catch(() => null);
      const ts = (blk?.timestamp ?? Math.floor(Date.now() / 1000)) * 1000;
      const evt = await decode(receipt, chain, ts);
      cache.set(hash, { at: Date.now(), data: evt });
      if (evt) return NextResponse.json(evt);
    } catch {
      /* try the other chain */
    }
  }
  cache.set(hash, { at: Date.now(), data: null });
  return NextResponse.json({ error: "not found" }, { status: 404 });
}
