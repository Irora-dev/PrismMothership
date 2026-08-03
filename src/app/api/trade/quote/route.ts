import { NextResponse } from "next/server";
import { Contract, formatUnits, parseUnits } from "ethers";
import { getProvider, getEthUsd } from "@/lib/chain/live";
import { PRISM_LIVE, PRISM_POOL_KEY, V4_QUOTER } from "@/lib/chain/constants";

// Quote a swap against the PRISM v4 pool through the official V4Quoter —
// the same math the pool itself will run, hook included. Read-only; the
// browser never needs an RPC key to price a trade.

export const dynamic = "force-dynamic";

const QUOTER_ABI = [
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut, uint256 gasEstimate)",
];

export async function GET(req: Request) {
  if (!PRISM_LIVE) return NextResponse.json({ error: "no token wired" }, { status: 503 });
  const url = new URL(req.url);
  const dir = url.searchParams.get("dir") === "sell" ? "sell" : "buy";
  const raw = url.searchParams.get("in") ?? "";
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) {
    return NextResponse.json({ error: "bad amount" }, { status: 400 });
  }
  const provider = getProvider();
  if (!provider) return NextResponse.json({ error: "no rpc" }, { status: 503 });

  try {
    const quoter = new Contract(V4_QUOTER, QUOTER_ABI, provider);
    const exactAmount = parseUnits(amount.toFixed(18), 18);
    const [amountOut] = (await quoter.quoteExactInputSingle.staticCall({
      poolKey: PRISM_POOL_KEY,
      zeroForOne: dir === "buy", // ETH (currency0) in → PRISM out
      exactAmount,
      hookData: "0x",
    })) as [bigint, bigint];
    const ethUsd = await getEthUsd(provider).catch(() => 0);
    return NextResponse.json({
      dir,
      amountIn: raw,
      amountOut: formatUnits(amountOut, 18),
      ethUsd,
      generatedAt: Date.now(),
    });
  } catch {
    // thin pool / oversized amount / RPC hiccup — the client shows "no quote"
    return NextResponse.json({ error: "quote unavailable" }, { status: 502 });
  }
}
