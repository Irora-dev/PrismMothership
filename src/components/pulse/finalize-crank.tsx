"use client";

import { useCallback, useEffect, useState } from "react";
import { BrowserProvider, Interface } from "ethers";
import { useWallet } from "@/lib/wallet/context";
import { CHAIN_HEX, txUrl } from "@/lib/chain/constants";
import { fmtEth, fmtUsdFull } from "@/lib/feed/format";

// ── The L1 finalize crank — the stage the site could only describe until now ─
// After a flush's dispute window, the withdrawal does NOT land by itself:
// someone must call executeTransaction on the rollup's Ethereum Outbox, out of
// their own pocket. This popup is that crank as one click: the server
// preflight builds the proof against the L2's own NodeInterface and checks the
// root is POSTED before any button lights, the wallet leg simulates before it
// ever prompts, and the celebration states what the receipt says was
// delivered — never an estimate. Anyone can finalize anyone's crossing; the
// ETH always lands at the crossing's own destination (here: the burner pot).

export interface FinalizeTarget {
  chain: string;
  amountEth: number;
  txHash: string; // the flush tx that opened the withdrawal, on the L2
  unlockTs: number;
}

type Preflight =
  | { status: "waiting"; position: number; confirmedSize: number; amountEth: number; destination: string }
  | { status: "ready"; to: string; data: string; position: number; confirmedSize: number; amountEth: number; destination: string; proofDepth: number }
  | { status: "spent"; position: number; confirmedSize: number; amountEth: number; destination: string };

type Phase =
  | { k: "read" }
  | { k: "idle"; pre: Preflight }
  | { k: "sim"; pre: Preflight }
  | { k: "wallet"; pre: Preflight }
  | { k: "mining"; pre: Preflight }
  | { k: "celebrate"; deliveredEth: number | null; txHash: string | null }
  | { k: "readfail" }
  | { k: "error"; pre: Preflight; msg: string };

const RECEIVED_EVENT = new Interface(["event Received(address indexed from, uint256 amount)"]);

export function FinalizeCrankModal({ target, ethUsd = 0, onClose, onDone }: { target: FinalizeTarget; ethUsd?: number; onClose: () => void; onDone?: () => void }) {
  const { wallet, account, openPicker } = useWallet();
  const [phase, setPhase] = useState<Phase>({ k: "read" });

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const preflight = useCallback(async () => {
    setPhase({ k: "read" });
    try {
      const r = await fetch(`/api/burn-pipeline/finalize?tx=${target.txHash}`);
      const d = (await r.json()) as Preflight | { error: string };
      if (!r.ok || !("status" in d)) throw new Error("error" in d ? d.error : `HTTP ${r.status}`);
      setPhase({ k: "idle", pre: d });
    } catch {
      setPhase({ k: "readfail" });
    }
  }, [target.txHash]);
  useEffect(() => {
    void preflight();
  }, [preflight]);

  const crank = async () => {
    if (phase.k !== "idle" || phase.pre.status !== "ready") return;
    const pre = phase.pre;
    if (!wallet || !account) {
      openPicker();
      return;
    }
    setPhase({ k: "sim", pre });
    try {
      // the Outbox lives on Ethereum regardless of which L2 the crossing left
      const want = CHAIN_HEX.ethereum;
      const have = (await wallet.provider.request({ method: "eth_chainId" })) as string;
      if (have !== want) {
        try {
          await wallet.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] });
        } catch {
          throw new Error("switch to Ethereum in your wallet");
        }
      }
      const provider = new BrowserProvider(wallet.provider);
      await provider.call({ to: pre.to, data: pre.data, from: account }); // must succeed before the wallet ever prompts
      setPhase({ k: "wallet", pre });
      const signer = await provider.getSigner();
      const tx = await signer.sendTransaction({ to: pre.to, data: pre.data });
      setPhase({ k: "mining", pre });
      const receipt = await tx.wait();
      // the celebration states what the chain says was delivered, nothing estimated
      let deliveredEth: number | null = null;
      for (const log of receipt?.logs ?? []) {
        if (log.address.toLowerCase() !== pre.destination.toLowerCase()) continue;
        try {
          const parsed = RECEIVED_EVENT.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "Received") deliveredEth = Number(parsed.args.amount) / 1e18;
        } catch {
          /* not the Received event */
        }
      }
      setPhase({ k: "celebrate", deliveredEth, txHash: receipt?.hash ?? null });
      onDone?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/user rejected|denied/i.test(msg)) {
        setPhase({ k: "idle", pre });
      } else {
        setPhase({ k: "error", pre, msg: msg.includes("switch to") ? msg : "Simulation reverted. Someone may have just finalized it. Check the gate again." });
      }
    }
  };

  const pre = "pre" in phase ? phase.pre : null;
  const busy = phase.k === "sim" || phase.k === "wallet" || phase.k === "mining";
  const stages: { label: string; state: "done" | "here" | "next" }[] =
    phase.k === "celebrate" || pre?.status === "spent"
      ? [
          { label: "flush() opened the withdrawal", state: "done" },
          { label: "Ethereum confirmed the crossing", state: "done" },
          { label: "L1 finalization delivered it to the pot", state: "done" },
          { label: "The burner buys & burns PRISM", state: "here" },
        ]
      : [
          { label: "flush() opened the withdrawal", state: "done" },
          { label: "Ethereum confirms the crossing", state: pre?.status === "ready" ? "done" : "here" },
          { label: "L1 finalization · executeTransaction, anyone", state: pre?.status === "ready" ? "here" : "next" },
          { label: "The burner buys & burns PRISM", state: "next" },
        ];

  const amount = pre?.amountEth ?? target.amountEth;

  return (
    <div className="fixed inset-0 z-[95] grid place-items-center p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" aria-hidden />

      {/* the landing burst — skipped under reduced motion (this modal stays
          open until closed, so animation:none would freeze the dots forever) */}
      {phase.k === "celebrate" && !(typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) && (
        <div className="pointer-events-none fixed inset-0 z-[96] flex items-center justify-center" aria-hidden>
          <div
            className="absolute inset-0"
            style={{ background: "radial-gradient(60% 60% at 50% 45%, rgba(250,204,21,0.16), transparent 70%)", animation: "prism-celebrate-fade 3.2s ease-out forwards" }}
          />
          {Array.from({ length: 18 }).map((_, i) => (
            <span
              key={i}
              className="absolute h-2.5 w-2.5 rounded-full"
              style={{
                background: ["#FACC15", "#FF9F45", "#FF5E00", "#ffe14d"][i % 4],
                left: "50%",
                top: "45%",
                animation: "prism-confetti 2.6s cubic-bezier(0.16,1,0.3,1) forwards",
                animationDelay: `${(i % 6) * 0.05}s`,
                ["--dx" as never]: `${Math.cos((i / 18) * Math.PI * 2) * (110 + (i % 5) * 55)}px`,
                ["--dy" as never]: `${Math.sin((i / 18) * Math.PI * 2) * (85 + (i % 4) * 50) - 55}px`,
              }}
            />
          ))}
        </div>
      )}

      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/12 bg-[#0b0e17]/95 p-7 text-center shadow-[0_30px_90px_rgba(0,0,0,0.6)]"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: "linear-gradient(90deg, transparent, #FACC15, transparent)" }} aria-hidden />

        {phase.k === "celebrate" ? (
          <>
            <div className="text-[10px] font-bold uppercase tracking-[0.24em]" style={{ color: "#FACC15" }}>
              Ethereum · crossing finalized
            </div>
            <div className="mt-3 text-5xl font-black tabular-nums text-white" style={{ textShadow: "0 0 30px rgba(250,204,21,0.45)" }}>
              Ξ{fmtEth(phase.deliveredEth ?? amount)}
            </div>
            <div className="mt-2 text-[13px] font-semibold tabular-nums text-slate-300" style={{ fontFamily: "ui-monospace, monospace" }}>
              {phase.deliveredEth != null
                ? `delivered to the burner pot${ethUsd > 0 ? ` (${fmtUsdFull(phase.deliveredEth * ethUsd)})` : ""}`
                : "delivered to the burner pot"}
            </div>
            <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">the pot is one crank from dead PRISM</div>
            <div className="mx-auto mt-5 h-1.5 w-40 rounded-full" style={{ background: "linear-gradient(90deg, #FACC15, #FF9F45, #FF5E00, #FF0A3C)" }} aria-hidden />
            {phase.txHash && (
              <a
                href={txUrl(phase.txHash, "ethereum")}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold tabular-nums transition-all hover:brightness-125"
                style={{ borderColor: "rgba(250,204,21,0.45)", background: "rgba(250,204,21,0.1)", color: "#FACC15", fontFamily: "ui-monospace, monospace" }}
              >
                finalize tx · {phase.txHash.slice(0, 6)}…{phase.txHash.slice(-4)}
                <svg aria-hidden viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14 5h5v5M19 5l-7 7M10 5H6a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1v-4" />
                </svg>
              </a>
            )}
            <div>
              <button
                type="button"
                onClick={onClose}
                className="mt-5 rounded-full border border-white/15 px-5 py-2 text-[12px] font-bold uppercase tracking-wider text-white transition-colors hover:border-white/35"
              >
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="text-[10px] font-bold uppercase tracking-[0.24em]" style={{ color: "#FACC15" }}>
              {target.chain === "robinhood" ? "Robinhood → Ethereum" : "crossing"} · the finalize crank
            </div>
            <div className="mt-3 text-5xl font-black tabular-nums text-white" style={{ textShadow: "0 0 30px rgba(250,204,21,0.4)" }}>
              Ξ{fmtEth(amount)}
            </div>
            {ethUsd > 0 && <div className="mt-1 text-[13px] font-semibold tabular-nums text-slate-400">{fmtUsdFull(amount * ethUsd)}</div>}
            <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {pre?.status === "spent" ? "already at the burner pot" : "waiting at the gate for its one L1 crank"}
            </div>

            <div className="mx-auto mt-5 flex max-w-xs flex-col gap-2 text-left">
              {stages.map((s) => (
                <div key={s.label} className="flex items-center gap-2.5">
                  <span
                    className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] font-black"
                    style={
                      s.state === "done"
                        ? { background: "rgba(0,255,135,0.18)", color: "#00FF87", border: "1px solid rgba(0,255,135,0.4)" }
                        : s.state === "here"
                          ? { background: "rgba(250,204,21,0.2)", color: "#FACC15", border: "1px solid rgba(250,204,21,0.55)" }
                          : { background: "rgba(148,163,184,0.1)", color: "#64748b", border: "1px solid rgba(148,163,184,0.25)" }
                    }
                  >
                    {s.state === "done" ? "✓" : s.state === "here" ? "→" : "·"}
                  </span>
                  <span className={`text-[12px] ${s.state === "here" ? "font-bold text-white" : "text-slate-400"}`}>{s.label}</span>
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-col items-center gap-1.5">
              {phase.k === "read" ? (
                <div className="text-[12px] text-slate-400">Reading the gate…</div>
              ) : phase.k === "readfail" ? (
                <>
                  <div className="max-w-xs text-center text-[11px] text-red-300/90">The gate read failed.</div>
                  <button type="button" onClick={() => void preflight()} className="rounded-full border border-white/15 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white hover:border-white/35">
                    Try again
                  </button>
                </>
              ) : pre?.status === "spent" ? (
                <div className="max-w-xs text-[11px] leading-relaxed text-slate-400">
                  Someone already finalized this crossing — its ETH is in the burner pot. The board credits whoever paid for the crank.
                </div>
              ) : pre?.status === "waiting" ? (
                <>
                  <div className="max-w-xs text-[11px] leading-relaxed text-slate-400">
                    {Date.now() >= target.unlockTs
                      ? "The window has run its course; Ethereum just hasn't confirmed the covering assertion yet. Usually a matter of hours. Check back."
                      : `Ethereum confirms crossings after a ~7-day dispute window. This one is expected ~${new Date(target.unlockTs).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`}
                  </div>
                  <div className="text-[10px] tabular-nums text-slate-600" style={{ fontFamily: "ui-monospace, monospace" }}>
                    withdrawal #{pre.position} · confirmed through #{Math.max(0, pre.confirmedSize - 1)}
                  </div>
                  <button type="button" onClick={() => void preflight()} className="mt-1 rounded-full border border-white/15 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white hover:border-white/35">
                    Check the gate again
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={crank}
                    disabled={busy}
                    className="rounded-full px-5 py-2.5 text-[12px] font-bold uppercase tracking-wider transition-all hover:brightness-125 disabled:opacity-75"
                    style={{ background: "linear-gradient(90deg, #FACC15, #FF5E00)", color: "#181000", boxShadow: "0 0 24px rgba(250,204,21,0.4)" }}
                  >
                    {phase.k === "sim"
                      ? "Simulating…"
                      : phase.k === "wallet"
                        ? "Confirm in your wallet…"
                        : phase.k === "mining"
                          ? "Finalizing on L1…"
                          : !account
                            ? `Connect & finalize · Ξ${fmtEth(amount)}`
                            : `Finalize on L1 · deliver Ξ${fmtEth(amount)}`}
                  </button>
                  {phase.k === "error" && <div className="max-w-xs text-center text-[11px] text-red-300/90">{phase.msg}</div>}
                  <div className="max-w-xs text-[10px] leading-relaxed text-slate-500">
                    executeTransaction is permissionless: you pay the gas, the bridge delivers the ETH to the burner pot, the board credits you.
                  </div>
                </>
              )}
              <a
                href={txUrl(target.txHash, target.chain as "ethereum" | "base" | "robinhood")}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] font-semibold text-slate-400 underline-offset-2 hover:underline"
              >
                the flush that opened this crossing ↗
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
