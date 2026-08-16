import { NextResponse } from "next/server";
import { formatEther } from "ethers";
import { getHoodProvider, getProvider } from "@/lib/chain/live";
import { HOOD_OUTBOX_L1 } from "@/lib/chain/constants";
import { buildExecuteCalldata, confirmedSendCount, isSpent, withdrawalFromReceipt, type OrbitWithdrawal } from "@/lib/chain/orbit";

// ── The finalize preflight: one flush tx in, one wallet-ready crank out ──────
// Given the 4663 transaction that opened a withdrawal (a collector flush() or
// a factory flushAuctionProceeds()), this answers the only three truths the
// crank UI needs, with nothing invented between them:
//   waiting — no confirmed assertion covers the position yet; the wall clock
//             is an ETA, this is the gate. Says how far confirmation stands.
//   ready   — proof constructed via the L2's own NodeInterface, its root
//             checked as POSTED on the L1 Outbox, and the executeTransaction
//             calldata returned for the wallet to simulate and send. The
//             executor pays gas only; the withdrawal's ETH is delivered by
//             the bridge to its own destination.
//   spent   — the Outbox already executed it; the crank retires itself.
// The whole path was proven live before wiring (scripts/finalize-probe.mjs):
// a constructed proof eth_calls GREEN against a real confirmed-unexecuted
// withdrawal, and the ~7-day figures the site shows stay estimates only.

export const dynamic = "force-dynamic";

// A withdrawal's event fields are immutable once mined — cache them per tx.
const wCache = new Map<string, OrbitWithdrawal>();

export async function GET(req: Request) {
  const tx = new URL(req.url).searchParams.get("tx") ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) return NextResponse.json({ error: "not a transaction hash" }, { status: 400 });
  const eth = getProvider();
  const hood = getHoodProvider();
  if (!eth || !hood) return NextResponse.json({ error: "chain read unavailable" }, { status: 503 });

  try {
    let w = wCache.get(tx.toLowerCase()) ?? null;
    if (!w) {
      const receipt = await hood.getTransactionReceipt(tx).catch(() => null);
      if (!receipt) return NextResponse.json({ error: "transaction not found on Robinhood Chain" }, { status: 404 });
      w = withdrawalFromReceipt(receipt.logs);
      if (!w) return NextResponse.json({ error: "no ETH withdrawal in this transaction" }, { status: 422 });
      wCache.set(tx.toLowerCase(), w);
    }

    const base = {
      position: Number(w.position),
      amountEth: Number(formatEther(w.callvalue)),
      destination: w.destination,
      openedTs: Number(w.timestamp) * 1000,
    };

    const size = await confirmedSendCount(eth, hood);
    if (size <= Number(w.position)) {
      return NextResponse.json({ status: "waiting", confirmedSize: size, ...base });
    }
    if (await isSpent(eth, w.position)) {
      return NextResponse.json({ status: "spent", confirmedSize: size, ...base });
    }
    const built = await buildExecuteCalldata(eth, hood, w, size);
    if (!built) {
      // the frontier said confirmed but the root is not posted — a race or a
      // degraded read; say waiting rather than hand out a doomed transaction
      return NextResponse.json({ status: "waiting", confirmedSize: size, ...base });
    }
    return NextResponse.json({ status: "ready", to: built.to, data: built.data, proofDepth: built.proofDepth, outbox: HOOD_OUTBOX_L1, confirmedSize: size, ...base });
  } catch {
    return NextResponse.json({ error: "preflight read failed" }, { status: 503 });
  }
}
