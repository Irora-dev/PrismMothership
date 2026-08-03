import { NextResponse } from "next/server";
import { Contract, formatEther } from "ethers";
import { getProvider } from "@/lib/chain/live";
import { DEAD, PRISM_CAP, POOL_MANAGER } from "@/lib/chain/constants";
import { HOOK_ADDRESS, HOOK_ABI, MIRROR_ADDRESS, MIRROR_ABI, MULTICALL3, MULTICALL3_ABI, PRISM_WIRED } from "@/lib/prism/claim";

// Supply decomposition for the /claim page: of the 5,000 PRISM cap, how much is
// held WHOLE in wallets (materialized as Prism-LP NFTs), how much is fractional
// DUST, how much sits in the pool machinery, and how much is burned. "Whole" is
// counted from the mirror: Alchemy enumerates current owners (its per-owner data
// is verified accurate; its bulk supply numbers are NOT — hence this route sums
// on-chain balanceOf per owner via Multicall3), EXCLUDING the machinery — the V4
// PoolManager owns the pool's own liquidity facets (2,500 NFTs at last count) and
// wallets verify 1 NFT : 1 whole PRISM. Pool = machinery ERC-20 (PoolManager +
// the hook's own balance). Cached 60s.

const MACHINERY = new Set([HOOK_ADDRESS.toLowerCase(), POOL_MANAGER.toLowerCase(), DEAD.toLowerCase()]);

export const dynamic = "force-dynamic";

interface ClaimStats {
  cap: number;
  burned: number;
  pool: number;
  whole: number | null; // null = owner enumeration unavailable (page degrades gracefully)
  dust: number | null;
  holders: number | null;
  updatedAt: number;
}

let cache: { at: number; data: ClaimStats } | null = null;
const TTL_MS = 60_000;

async function mirrorOwners(): Promise<string[] | null> {
  const key = process.env.ALCHEMY_API_KEY;
  if (!key) return null;
  const owners: string[] = [];
  let pageKey: string | undefined;
  for (let page = 0; page < 10; page++) {
    const url = `https://eth-mainnet.g.alchemy.com/nft/v3/${key}/getOwnersForContract?contractAddress=${MIRROR_ADDRESS}${pageKey ? `&pageKey=${encodeURIComponent(pageKey)}` : ""}`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json()) as { owners?: (string | { ownerAddress: string })[]; pageKey?: string };
    for (const o of j.owners ?? []) owners.push(typeof o === "string" ? o : o.ownerAddress);
    pageKey = j.pageKey;
    if (!pageKey) break;
  }
  return owners;
}

export async function GET() {
  if (!PRISM_WIRED) return NextResponse.json({ error: "prism_not_live" }, { status: 503 });
  if (cache && Date.now() - cache.at < TTL_MS) return NextResponse.json(cache.data);
  const provider = getProvider();
  if (!provider) return NextResponse.json({ error: "no provider" }, { status: 503 });

  try {
    const hook = new Contract(HOOK_ADDRESS, HOOK_ABI, provider);
    const [supplyRaw, deadRaw, hookRaw, pmRaw, owners] = await Promise.all([
      hook.totalSupply() as Promise<bigint>,
      hook.balanceOf(DEAD) as Promise<bigint>,
      hook.balanceOf(HOOK_ADDRESS) as Promise<bigint>,
      hook.balanceOf(POOL_MANAGER) as Promise<bigint>,
      mirrorOwners().catch(() => null),
    ]);

    // whole = Σ mirror.balanceOf(owner) over real wallets — machinery excluded
    let whole: number | null = null;
    let holders: number | null = null;
    if (owners && owners.length) {
      const wallets = owners.filter((o) => !MACHINERY.has(o.toLowerCase()));
      const mc = new Contract(MULTICALL3, MULTICALL3_ABI, provider);
      const mirror = new Contract(MIRROR_ADDRESS, MIRROR_ABI, provider);
      let sum = 0n;
      holders = 0;
      for (let i = 0; i < wallets.length; i += 400) {
        const batch = wallets.slice(i, i + 400);
        const calls = batch.map((o) => ({ target: MIRROR_ADDRESS, allowFailure: true, callData: mirror.interface.encodeFunctionData("balanceOf", [o]) }));
        const res = (await mc.aggregate3.staticCall(calls)) as { success: boolean; returnData: string }[];
        res.forEach((r) => {
          if (!r.success || r.returnData === "0x") return;
          const n = BigInt(r.returnData);
          sum += n;
          if (n > 0n) holders!++;
        });
      }
      whole = Number(sum);
    }

    const burned = Number(formatEther(deadRaw));
    const pool = Number(formatEther(hookRaw)) + Number(formatEther(pmRaw));
    const circulating = Number(formatEther(supplyRaw)) - burned;
    const data: ClaimStats = {
      cap: PRISM_CAP,
      burned,
      pool,
      whole,
      dust: whole == null ? null : Math.max(0, circulating - pool - whole),
      holders,
      updatedAt: Date.now(),
    };
    cache = { at: Date.now(), data };
    return NextResponse.json(data);
  } catch (err) {
    console.error("[claim-stats]", err);
    return NextResponse.json({ error: "rpc_unavailable" }, { status: 503 });
  }
}
