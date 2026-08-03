import { NextRequest, NextResponse } from "next/server";
import { Contract, formatEther, getAddress, zeroPadValue } from "ethers";
import { getProvider } from "@/lib/chain/live";
import { PRISM_POOL_FROM_BLOCK } from "@/lib/chain/constants";
import { HOOK_ADDRESS, HOOK_ABI, MIRROR_ADDRESS, MIRROR_ABI, MULTICALL3, MULTICALL3_ABI, decodeTokenURI } from "@/lib/prism/claim";

// Everything the Prism Hub needs to know about one wallet, read server-side.
// The page used to read through the connected wallet's own RPC — which breaks:
// tokenURI returns whole base64 SVGs, and wallet RPCs cap eth_call response
// sizes, so holders with several Prisms got "couldn't read". Here the reads run
// on our provider, chunked so no single multicall response gets huge; the wallet
// is only ever used to connect and sign. Amounts returned as wei strings.

export const dynamic = "force-dynamic";

const TOKEN_CHUNK = 25; // per aggregate3 batch — tokenURI payloads are big (on-chain SVG)

interface WalletToken {
  id: string;
  name: string;
  image?: string;
  owedETH: string;
  owedPRISM: string;
}
interface WalletData {
  balance: string; // PRISM wei
  balanceFmt: number;
  pendingETH: string;
  pendingPRISM: string;
  // Σ Claimed events for this address, all-time (the contract emits the full owed
  // amounts on every claim, including the pending-fallback path — so claimed +
  // currently-pending = lifetime earned, no double count)
  lifetimeClaimedETH: string;
  lifetimeClaimedPRISM: string;
  ens: string | null; // reverse-resolved name for the address, if any
  tokens: WalletToken[];
  updatedAt: number;
}

const cache = new Map<string, { at: number; data: WalletData }>();
const TTL_MS = 20_000;

export async function GET(req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  const { address: raw } = await ctx.params;
  let address: string;
  try {
    address = getAddress(raw); // checksums + validates
  } catch {
    return NextResponse.json({ error: "bad_address" }, { status: 400 });
  }

  const fresh = req.nextUrl.searchParams.get("fresh") === "1"; // post-claim reload bypasses the cache
  const hit = cache.get(address);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.data);

  const provider = getProvider();
  if (!provider) return NextResponse.json({ error: "no provider" }, { status: 503 });

  try {
    const hook = new Contract(HOOK_ADDRESS, HOOK_ABI, provider);
    const mirror = new Contract(MIRROR_ADDRESS, MIRROR_ABI, provider);
    const mc = new Contract(MULTICALL3, MULTICALL3_ABI, provider);

    const claimedEvt = hook.interface.getEvent("Claimed")!;
    const [tokenIdsRaw, balance, pendingETH, pendingPRISM, claimLogs, ens] = await Promise.all([
      hook.ownedTokensOf(address) as Promise<bigint[]>,
      hook.balanceOf(address) as Promise<bigint>,
      hook.pendingETH(address) as Promise<bigint>,
      hook.pendingPRISM(address) as Promise<bigint>,
      provider
        .getLogs({ address: HOOK_ADDRESS, topics: [claimedEvt.topicHash, null, zeroPadValue(address, 32)], fromBlock: PRISM_POOL_FROM_BLOCK })
        .catch(() => []),
      provider.lookupAddress(address).catch(() => null),
    ]);
    let lifetimeETH = 0n, lifetimePRISM = 0n;
    for (const log of claimLogs) {
      try {
        const [, , ethOut, prismOut] = hook.interface.decodeEventLog(claimedEvt, log.data, log.topics);
        lifetimeETH += ethOut as bigint;
        lifetimePRISM += prismOut as bigint;
      } catch {
        /* skip undecodable */
      }
    }
    // ethers v6 returns a frozen Result — array methods like flatMap species-create
    // another frozen Result and throw on write. Plain-copy before iterating.
    const tokenIds = Array.from(tokenIdsRaw);

    const tokens: WalletToken[] = [];
    for (let i = 0; i < tokenIds.length; i += TOKEN_CHUNK) {
      const batch = tokenIds.slice(i, i + TOKEN_CHUNK);
      const calls = batch.flatMap((id) => [
        { target: HOOK_ADDRESS, allowFailure: true, callData: hook.interface.encodeFunctionData("pendingFees", [id]) },
        { target: MIRROR_ADDRESS, allowFailure: true, callData: mirror.interface.encodeFunctionData("tokenURI", [id]) },
      ]);
      const res = (await mc.aggregate3.staticCall(calls)) as { success: boolean; returnData: string }[];
      batch.forEach((id, j) => {
        let owedETH = 0n, owedPRISM = 0n, name = `Prism #${id}`, image: string | undefined;
        const fee = res[j * 2], uri = res[j * 2 + 1];
        if (fee?.success && fee.returnData !== "0x") {
          const [e, p] = hook.interface.decodeFunctionResult("pendingFees", fee.returnData);
          owedETH = e; owedPRISM = p;
        }
        if (uri?.success && uri.returnData !== "0x") {
          try {
            const [rawUri] = mirror.interface.decodeFunctionResult("tokenURI", uri.returnData);
            const meta = decodeTokenURI(rawUri as string);
            if (meta.name) name = meta.name;
            image = meta.image; // art is optional — a failed URI never sinks the row
          } catch {
            /* keep the row without art */
          }
        }
        tokens.push({ id: id.toString(), name, image, owedETH: owedETH.toString(), owedPRISM: owedPRISM.toString() });
      });
    }

    const data: WalletData = {
      balance: balance.toString(),
      balanceFmt: Number(formatEther(balance)),
      pendingETH: pendingETH.toString(),
      pendingPRISM: pendingPRISM.toString(),
      lifetimeClaimedETH: lifetimeETH.toString(),
      lifetimeClaimedPRISM: lifetimePRISM.toString(),
      ens: ens ?? null,
      tokens,
      updatedAt: Date.now(),
    };
    cache.set(address, { at: Date.now(), data });
    if (cache.size > 500) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) cache.delete(oldest[0]);
    }
    return NextResponse.json(data);
  } catch (err) {
    console.error("[prism-wallet]", err);
    return NextResponse.json({ error: "rpc_unavailable" }, { status: 503 });
  }
}
