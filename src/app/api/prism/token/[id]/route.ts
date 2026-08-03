import { NextRequest, NextResponse } from "next/server";
import { Contract } from "ethers";
import { getProvider } from "@/lib/chain/live";
import { HOOK_ADDRESS, HOOK_ABI, MIRROR_ADDRESS, MIRROR_ABI, decodeTokenURI } from "@/lib/prism/claim";

// Prism inspector: one token id → its on-chain art, current owner, and the fees
// it's owed right now. A nonexistent / not-materialized id returns exists:false
// (ownerOf reverts on the mirror). Cached 30s per id.

export const dynamic = "force-dynamic";

interface TokenInfo {
  id: string;
  exists: boolean;
  owner?: string;
  ownerEns?: string;
  name?: string;
  image?: string;
  owedETH?: string;
  owedPRISM?: string;
  updatedAt: number;
}

const cache = new Map<string, { at: number; data: TokenInfo }>();
const TTL_MS = 30_000;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^\d{1,10}$/.test(id)) return NextResponse.json({ error: "bad_id" }, { status: 400 });

  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.data);

  const provider = getProvider();
  if (!provider) return NextResponse.json({ error: "no provider" }, { status: 503 });

  try {
    const mirror = new Contract(MIRROR_ADDRESS, MIRROR_ABI, provider);
    const hook = new Contract(HOOK_ADDRESS, HOOK_ABI, provider);

    let owner: string;
    try {
      owner = (await mirror.ownerOf(BigInt(id))) as string;
    } catch {
      const data: TokenInfo = { id, exists: false, updatedAt: Date.now() };
      cache.set(id, { at: Date.now(), data });
      return NextResponse.json(data);
    }

    const [uriRaw, fees, ownerEns] = await Promise.all([
      (mirror.tokenURI(BigInt(id)) as Promise<string>).catch(() => ""),
      hook.pendingFees(BigInt(id)) as Promise<{ owedETH: bigint; owedPRISM: bigint }>,
      provider.lookupAddress(owner).catch(() => null),
    ]);
    const meta = uriRaw ? decodeTokenURI(uriRaw) : {};

    const data: TokenInfo = {
      id,
      exists: true,
      owner,
      ownerEns: ownerEns ?? undefined,
      name: meta.name ?? `Prism #${id}`,
      image: meta.image,
      owedETH: fees.owedETH.toString(),
      owedPRISM: fees.owedPRISM.toString(),
      updatedAt: Date.now(),
    };
    cache.set(id, { at: Date.now(), data });
    if (cache.size > 300) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) cache.delete(oldest[0]);
    }
    return NextResponse.json(data);
  } catch (err) {
    console.error("[prism-token]", err);
    return NextResponse.json({ error: "rpc_unavailable" }, { status: 503 });
  }
}
