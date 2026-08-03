import { NextResponse } from "next/server";
import { PRISM, SPECTRUM_V2, L1_PRISM_BURNER } from "@/lib/chain/constants";
import { MIRROR_ADDRESS } from "@/lib/prism/claim";

// Source-verification status for every contract /contracts lists, read LIVE from
// Etherscan's v2 API instead of hardcoded on the page.
//
// Why this exists: the page's whole promise is "don't trust us, check it", so a
// hand-written "✓ verified" badge is the one thing on it that cannot be checked.
// It also rots — it said Base-only long after the others were verified. Now the
// badge reports what the explorer says today, or says nothing.
//
// The API key is server-side only and must never reach the client (ETHERSCAN_API_KEY,
// also needed in Netlify for prod). Without it every entry returns unknown and the
// page falls back to a plain "view source" link — never to a claim.
//
// Chain coverage is NOT universal: Etherscan v2 rejects chainid 4663 outright
// ("unsupported chainid"), so Robinhood Chain contracts are reported `unsupported`
// rather than unverified — they verify on Blockscout/Sourcify instead, and calling
// them "not verified" would be a different lie.

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ETHERSCAN_CHAINS: Record<string, number> = { ethereum: 1, base: 8453 };

type Entry = { verified: boolean; name?: string; unsupported?: boolean };

let cache: { at: number; data: Record<string, Entry> } | null = null;
const TTL_MS = 10 * 60 * 1000; // verification status changes rarely; be kind to the key

async function statusFor(chainId: number, address: string, key: string): Promise<Entry> {
  const url =
    `https://api.etherscan.io/v2/api?chainid=${chainId}&module=contract` +
    `&action=getsourcecode&address=${address}&apikey=${key}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    const j = (await r.json()) as { status?: string; result?: unknown };
    // A string result is an error message ("unsupported chainid", rate limits…).
    if (typeof j.result === "string") return { verified: false, unsupported: /chainid/i.test(j.result) };
    const first = Array.isArray(j.result) ? (j.result[0] as { ContractName?: string }) : null;
    const name = first?.ContractName?.trim();
    return name ? { verified: true, name } : { verified: false };
  } catch {
    return { verified: false }; // network hiccup → no badge, never a false badge
  }
}

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json({ contracts: cache.data, cachedAt: cache.at });
  }
  const key = (process.env.ETHERSCAN_API_KEY || "").trim();
  const targets: { chain: string; address: string }[] = [
    { chain: "ethereum", address: SPECTRUM_V2.ethFactory },
    { chain: "ethereum", address: SPECTRUM_V2.ethRouter },
    { chain: "ethereum", address: L1_PRISM_BURNER },
    { chain: "ethereum", address: PRISM },
    { chain: "ethereum", address: MIRROR_ADDRESS },
    { chain: "base", address: SPECTRUM_V2.baseFactory },
    { chain: "base", address: SPECTRUM_V2.baseRouter },
    { chain: "robinhood", address: SPECTRUM_V2.hoodFactory },
    { chain: "robinhood", address: SPECTRUM_V2.hoodRouter },
  ];

  const data: Record<string, Entry> = {};
  for (const t of targets) {
    const k = `${t.chain}:${t.address.toLowerCase()}`;
    const chainId = ETHERSCAN_CHAINS[t.chain];
    if (!chainId) { data[k] = { verified: false, unsupported: true }; continue; }
    if (!key || !/^0x[a-fA-F0-9]{40}$/.test(t.address)) { data[k] = { verified: false }; continue; }
    data[k] = await statusFor(chainId, t.address, key);
    await new Promise((r) => setTimeout(r, 220)); // stay inside the free-tier rate limit
  }
  cache = { at: Date.now(), data };
  return NextResponse.json({ contracts: data, cachedAt: cache.at });
}
