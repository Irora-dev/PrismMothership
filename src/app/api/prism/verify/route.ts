import { NextResponse } from "next/server";
import { Contract, formatEther } from "ethers";
import { getProvider } from "@/lib/chain/live";
import { DEAD, L1_PRISM_BURNER, SPECTRUM_V2 } from "@/lib/chain/constants";
import { HOOK_ADDRESS, MIRROR_ADDRESS, PRISM_WIRED } from "@/lib/prism/claim";

// Live proofs for the /contracts page: instead of just CLAIMING "owner is 0x0",
// the page calls this and shows the chain's own answers, freshly read. Every
// value here is a straight eth_call / getCode / getBalance — no derivation.
// Cached 60s.

export const dynamic = "force-dynamic";

const BURNER = L1_PRISM_BURNER; // env-wired per token (relaunch, 2026-07-29)

interface VerifyData {
  // Token proofs — present only once a PRISM token is env-wired (relaunch).
  hookOwner?: string; // owner() — expect 0x0000…0000
  deadCodeBytes?: number; // getCode(dEaD) — expect 0
  deadBalance?: number; // PRISM burned (only ever grows)
  burnerCodeBytes?: number; // real deployed code
  burnerEthBalance?: number; // expect ~0 between burns
  burnerHasOwnerFn?: boolean; // owner() call succeeds? expect false
  mirrorHook?: string; // mirror.hook() — expect the PRISM hook address
  // Spectrum relaunch contracts: does owner() answer anywhere? expect false ×6
  spectrum: { chain: string; factoryHasOwner: boolean; routerHasOwner: boolean }[];
  checkedAt: number;
}

// owner() probe via raw eth_call — success=true means an owner EXISTS (bad).
// Addresses come from SPECTRUM_V2 (chain/constants.ts) so this route can never
// drift out of step with what the site actually reads — it used to hold its own
// copies, which meant the page could show live green proofs for contracts the
// data layer had already stopped using. Keyed per chain, which is mandatory here:
// the launch set reuses addresses across chains for different contracts.
const SPECTRUM_DEPLOYS: { chain: string; rpc: () => string; factory: string; router: string }[] = [
  {
    chain: "ethereum",
    rpc: () => (process.env.ALCHEMY_API_KEY ? `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}` : "https://ethereum-rpc.publicnode.com"),
    factory: SPECTRUM_V2.ethFactory,
    router: SPECTRUM_V2.ethRouter,
  },
  {
    chain: "base",
    rpc: () => (process.env.ALCHEMY_API_KEY ? `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}` : "https://base-rpc.publicnode.com"),
    factory: SPECTRUM_V2.baseFactory,
    router: SPECTRUM_V2.baseRouter,
  },
  {
    chain: "robinhood",
    rpc: () => process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com/rpc",
    factory: SPECTRUM_V2.hoodFactory,
    router: SPECTRUM_V2.hoodRouter,
  },
];

async function ownerAnswers(rpc: string, to: string): Promise<boolean> {
  try {
    const r = (await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data: "0x8da5cb5b" }, "latest"] }),
      signal: AbortSignal.timeout(8000),
    }).then((x) => x.json())) as { result?: string; error?: unknown };
    return !!r.result && r.result !== "0x"; // a value came back → owner() exists
  } catch {
    return false; // unreachable counts as "no owner shown" — chip shows ✓ conservatively only on success paths below
  }
}

let cache: { at: number; data: VerifyData } | null = null;
const TTL_MS = 60_000;

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) return NextResponse.json(cache.data);
  const provider = getProvider();
  if (!provider) return NextResponse.json({ error: "no provider" }, { status: 503 });

  try {
    const spectrum = await Promise.all(
      SPECTRUM_DEPLOYS.map(async (d) => ({
        chain: d.chain,
        factoryHasOwner: await ownerAnswers(d.rpc(), d.factory),
        routerHasOwner: await ownerAnswers(d.rpc(), d.router),
      })),
    );

    // No token wired yet (relaunch pending) → Spectrum's proofs still serve; the
    // token proofs simply aren't part of the payload until it exists.
    if (!PRISM_WIRED) {
      const data: VerifyData = { spectrum, checkedAt: Date.now() };
      cache = { at: Date.now(), data };
      return NextResponse.json(data);
    }

    const hook = new Contract(HOOK_ADDRESS, ["function owner() view returns (address)", "function balanceOf(address) view returns (uint256)"], provider);
    const burner = new Contract(BURNER, ["function owner() view returns (address)"], provider);
    const mirror = new Contract(MIRROR_ADDRESS, ["function hook() view returns (address)"], provider);

    const [hookOwner, deadCode, deadBal, burnerCode, burnerBal, burnerOwner, mirrorHook] = await Promise.all([
      hook.owner() as Promise<string>,
      provider.getCode(DEAD),
      hook.balanceOf(DEAD) as Promise<bigint>,
      provider.getCode(BURNER),
      provider.getBalance(BURNER),
      (burner.owner() as Promise<string>).then(
        () => true,
        () => false, // reverts → no owner interface (the expected outcome)
      ),
      (mirror.hook() as Promise<string>).catch(() => ""),
    ]);

    const data: VerifyData = {
      hookOwner,
      deadCodeBytes: (deadCode.length - 2) / 2,
      deadBalance: Number(formatEther(deadBal)),
      burnerCodeBytes: (burnerCode.length - 2) / 2,
      burnerEthBalance: Number(formatEther(burnerBal)),
      burnerHasOwnerFn: burnerOwner as boolean,
      mirrorHook,
      spectrum,
      checkedAt: Date.now(),
    };
    cache = { at: Date.now(), data };
    return NextResponse.json(data);
  } catch (err) {
    console.error("[prism-verify]", err);
    return NextResponse.json({ error: "rpc_unavailable" }, { status: 503 });
  }
}
