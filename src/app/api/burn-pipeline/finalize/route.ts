import { NextResponse } from "next/server";
import { formatEther } from "ethers";
import { getBaseProvider, getHoodProvider, getProvider } from "@/lib/chain/live";
import { HOOD_OUTBOX_L1 } from "@/lib/chain/constants";
import { buildExecuteCalldata, confirmedSendCount, isSpent, withdrawalFromReceipt, type OrbitWithdrawal } from "@/lib/chain/orbit";
import { opPreflight, opWithdrawalFromReceipt, type OpWithdrawal } from "@/lib/chain/opstack";

// ── The finalize preflight: one flush tx in, one wallet-ready crank out ──────
// Given the L2 transaction that opened a withdrawal (a collector flush() or a
// factory flushAuctionProceeds()), this answers the truths the crank UI needs,
// with nothing invented between them. Two settlement families, one route:
//
// ROBINHOOD (Arbitrum Orbit — one L1 transaction):
//   waiting — no confirmed assertion covers the position yet
//   ready   — Outbox executeTransaction calldata, proof root checked as posted
//   spent   — the Outbox already executed it
//
// BASE (OP-Stack — two L1 transactions; ?chain=base):
//   waiting  — no output-root game covers the withdrawal's block yet (~30min)
//   prove    — proveWithdrawalTransaction calldata (Merkle storage proof
//              against the covering game — the shape that came out
//              byte-identical to production transactions when probed)
//   maturing — proven; the 24h proof-maturity clock runs (maturesAt stated)
//   ready    — finalizeWithdrawalTransactionExternalProof calldata; the gate
//              is the portal's own checkWithdrawal, never a reimplemented clock
//   spent    — already finalized
// Both proven against real settled withdrawals BEFORE wiring
// (scripts/finalize-probe.mjs · scripts/base-finalize-probe.mjs).

export const dynamic = "force-dynamic";

// A withdrawal's event fields are immutable once mined — cache them per tx.
const wCache = new Map<string, OrbitWithdrawal>();
const opCache = new Map<string, OpWithdrawal>();

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tx = url.searchParams.get("tx") ?? "";
  const chain = url.searchParams.get("chain") ?? "robinhood";
  if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) return NextResponse.json({ error: "not a transaction hash" }, { status: 400 });
  const eth = getProvider();
  if (!eth) return NextResponse.json({ error: "chain read unavailable" }, { status: 503 });

  // ── the Base (OP-Stack) two-step path ──
  if (chain === "base") {
    const baseP = getBaseProvider();
    if (!baseP) return NextResponse.json({ error: "chain read unavailable" }, { status: 503 });
    try {
      let w = opCache.get(tx.toLowerCase()) ?? null;
      if (!w) {
        const receipt = await baseP.getTransactionReceipt(tx).catch(() => null);
        if (!receipt) return NextResponse.json({ error: "transaction not found on Base" }, { status: 404 });
        w = opWithdrawalFromReceipt(receipt.logs);
        if (!w) return NextResponse.json({ error: "no withdrawal in this transaction" }, { status: 422 });
        opCache.set(tx.toLowerCase(), w);
      }
      const info = {
        chain: "base",
        amountEth: Number(formatEther(w.value)),
        withdrawalHash: w.withdrawalHash,
        l2Block: w.l2Block,
      };
      const s = await opPreflight(eth, baseP, w);
      return NextResponse.json({ ...s, ...info });
    } catch {
      return NextResponse.json({ error: "preflight read failed" }, { status: 503 });
    }
  }

  // ── the Robinhood (Arbitrum Orbit) one-step path ──
  const hood = getHoodProvider();
  if (!hood) return NextResponse.json({ error: "chain read unavailable" }, { status: 503 });
  try {
    let w = wCache.get(tx.toLowerCase()) ?? null;
    if (!w) {
      const receipt = await hood.getTransactionReceipt(tx).catch(() => null);
      if (!receipt) return NextResponse.json({ error: "transaction not found on Robinhood Chain" }, { status: 404 });
      w = withdrawalFromReceipt(receipt.logs);
      if (!w) return NextResponse.json({ error: "no ETH withdrawal in this transaction" }, { status: 422 });
      wCache.set(tx.toLowerCase(), w);
    }

    const info = {
      position: Number(w.position),
      amountEth: Number(formatEther(w.callvalue)),
      destination: w.destination,
      openedTs: Number(w.timestamp) * 1000,
    };

    const size = await confirmedSendCount(eth, hood);
    if (size <= Number(w.position)) {
      return NextResponse.json({ status: "waiting", confirmedSize: size, ...info });
    }
    if (await isSpent(eth, w.position)) {
      return NextResponse.json({ status: "spent", confirmedSize: size, ...info });
    }
    const built = await buildExecuteCalldata(eth, hood, w, size);
    if (!built) {
      // the frontier said confirmed but the root is not posted — a race or a
      // degraded read; say waiting rather than hand out a doomed transaction
      return NextResponse.json({ status: "waiting", confirmedSize: size, ...info });
    }
    return NextResponse.json({ status: "ready", to: built.to, data: built.data, proofDepth: built.proofDepth, outbox: HOOD_OUTBOX_L1, confirmedSize: size, ...info });
  } catch {
    return NextResponse.json({ error: "preflight read failed" }, { status: 503 });
  }
}
