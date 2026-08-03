import { NextRequest, NextResponse } from "next/server";
import { getAddress, formatUnits, AbiCoder, type Log } from "ethers";
import { getProvider } from "@/lib/chain/live";
import { Contract } from "ethers";
import { DEAD, L1_PRISM_BURNER, PRISM, TOPIC, TOPIC_DEAD } from "@/lib/chain/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Did the PRISM burn tied to a basket event actually execute yet? Burns always
// land on Ethereum as PRISM Transfer(from → dEaD): launch-auction proceeds
// (and every Base-side burn share) arrive via the L1 PrismBurner; a mainnet
// basket's fee burn fires in-tx from the basket itself. So: pick the sender by
// event kind, estimate the ETH block at the event's timestamp, and scan
// forward. Returns the burns found + their share of the PRISM supply.
//
// Attribution note: the burner aggregates whatever it holds when cranked, so a
// burn found here is "the burn this event's proceeds fed", not a per-event
// ledger entry — correct while flushes are per-deployment, approximate beyond.

const abi = AbiCoder.defaultAbiCoder();
const ETH_SPB = 12;
const MAX_SCAN_BLOCKS = 250_000; // ~35 days — beyond that the link-out suffices

interface BurnHit {
  txHash: string;
  prism: number;
  blockNumber: number;
  ts: number;
}
interface Payload {
  burns: BurnHit[];
  totalPrism: number;
  pctOfSupply: number; // of the pre-burn circulating supply
  updatedAt: string;
}

const cache = new Map<string, { at: number; data: Payload }>();
const TTL = 60_000;

const ERC20_ABI = ["function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)"];

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const kind = q.get("kind") ?? "launch";
  const chain = q.get("chain") === "base" ? "base" : "ethereum";
  const actorRaw = q.get("actor") ?? "";
  const ts = Number(q.get("ts"));
  if (!Number.isFinite(ts) || ts <= 0) return NextResponse.json({ error: "bad ts" }, { status: 400 });

  // Launches (both chains) + every Base-side burn funnel through the L1
  // burner; a mainnet basket's fee/burn events burn from the basket itself.
  let from: string;
  if (kind === "launch" || chain === "base") {
    from = L1_PRISM_BURNER;
  } else {
    try {
      from = getAddress(actorRaw);
    } catch {
      return NextResponse.json({ error: "bad actor" }, { status: 400 });
    }
  }

  const key = `${from.toLowerCase()}:${Math.floor(ts / 60_000)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return NextResponse.json(hit.data);

  const eth = getProvider();
  if (!eth) return NextResponse.json({ burns: [], totalPrism: 0, pctOfSupply: 0, updatedAt: new Date().toISOString() });

  try {
    const latest = await eth.getBlock("latest");
    const latestNum = latest?.number ?? (await eth.getBlockNumber());
    const latestTs = (latest?.timestamp ?? Math.floor(Date.now() / 1000)) * 1000;
    // ETH block at the event's timestamp (a small pad covers estimation error).
    const fromBlock = Math.max(0, latestNum - Math.ceil((latestTs - ts) / 1000 / ETH_SPB) - 300);
    if (latestNum - fromBlock > MAX_SCAN_BLOCKS) {
      return NextResponse.json({ burns: [], totalPrism: 0, pctOfSupply: 0, updatedAt: new Date().toISOString() });
    }

    const logs: Log[] = [];
    const CHUNK = 50_000;
    for (let s = fromBlock; s <= latestNum; s += CHUNK) {
      const e = Math.min(s + CHUNK - 1, latestNum);
      const part = await eth
        .getLogs({
          address: PRISM,
          topics: [TOPIC.transfer, "0x" + from.slice(2).toLowerCase().padStart(64, "0"), TOPIC_DEAD],
          fromBlock: s,
          toBlock: e,
        })
        .catch(() => [] as Log[]);
      logs.push(...part);
    }

    const burns: BurnHit[] = [];
    for (const l of logs.slice(0, 10)) {
      try {
        const v = abi.decode(["uint256"], l.data)[0] as bigint;
        if (v === 0n) continue;
        burns.push({
          txHash: l.transactionHash,
          prism: Number(formatUnits(v, 18)),
          blockNumber: l.blockNumber,
          ts: (latestTs / 1000 - (latestNum - l.blockNumber) * ETH_SPB) * 1000,
        });
      } catch {
        /* skip malformed */
      }
    }
    const totalPrism = burns.reduce((s, b) => s + b.prism, 0);

    let pctOfSupply = 0;
    if (totalPrism > 0) {
      const prism = new Contract(PRISM, ERC20_ABI, eth);
      const [supplyRaw, deadRaw] = await Promise.all([
        prism.totalSupply().catch(() => 0n) as Promise<bigint>,
        prism.balanceOf(DEAD).catch(() => 0n) as Promise<bigint>,
      ]);
      const circulating = Math.max(0, Number(formatUnits(supplyRaw, 18)) - Number(formatUnits(deadRaw, 18)));
      // share of the PRE-burn circulating supply this burn destroyed
      if (circulating + totalPrism > 0) pctOfSupply = (totalPrism / (circulating + totalPrism)) * 100;
    }

    const data: Payload = { burns, totalPrism, pctOfSupply, updatedAt: new Date().toISOString() };
    cache.set(key, { at: Date.now(), data });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ burns: [], totalPrism: 0, pctOfSupply: 0, updatedAt: new Date().toISOString() });
  }
}
