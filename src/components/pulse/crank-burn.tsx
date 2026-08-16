"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BrowserProvider, Contract, Interface, parseUnits } from "ethers";
import { useWallet } from "@/lib/wallet/context";
import { CHAIN_HEX, CHAIN_LABEL, HOOD_ADD_PARAMS, txUrl } from "@/lib/chain/constants";
import { fmtEth, fmtPrism, fmtUsdFull } from "@/lib/feed/format";
import { usePolledJson } from "@/hooks/usePolledJson";

// ── The permissionless bridge crank, everywhere it shows ────────────────────
// Stage two of the three-stage burn: the batcher delivers the burn cut to a
// collector; flush() — callable by ANYONE — pushes it toward the L1 burner
// where PRISM actually dies. The 2026-08-15 real batch sat flushable at 2.75x
// its threshold with nobody cranking, which is the invisibility this file
// ends (the designer's ruling: visible on the mothership, the command deck and the
// money map, and triggerable from the popup and the page).

export interface PendingCollector {
  chain: string;
  address: string;
  gen?: number; // collector generation (1 = the rehearsal decoys' sink, 3 = production) — both run in parallel since the 2026-08-16 ceremony
  pendingEth: number;
  flushable: boolean;
  // the crank economics (w-79): every flush commits ONE unreimbursed L1
  // finalization, so the CTA gates on `economic` (finalization ≤ 2% of the
  // value it delivers, at the LIVE L1 base fee) — never on flushable() alone.
  thresholdEth?: number;
  finalizeCostEth?: number | null;
  finalizeCostPct?: number | null;
  economic?: boolean;
  efficiencyPct?: number | null;
}

/** The one CTA rule (w-79): light a flush only when the contract allows it AND
 *  the economics clear the 2% policy. Legacy payloads without economics fields
 *  fall back to the contract floor alone. */
export function collectorCrankable(c: PendingCollector): boolean {
  return c.flushable && c.economic !== false;
}

type Phase = "idle" | "sim" | "wallet" | "mining" | "done" | "error";

/** Right chain → simulate from the caller → send: the burn board's own crank
 * discipline, so the wallet never prompts for a transaction that must fail. */
export function CrankBurnButton({ collector, onDone }: { collector: PendingCollector; onDone?: () => void }) {
  const { wallet, account, openPicker } = useWallet();
  const [phase, setPhase] = useState<Phase>("idle");
  const [err, setErr] = useState("");

  const crank = async () => {
    if (!wallet || !account) {
      openPicker();
      return;
    }
    setPhase("sim");
    setErr("");
    try {
      const want = CHAIN_HEX[collector.chain];
      const have = (await wallet.provider.request({ method: "eth_chainId" })) as string;
      if (have !== want) {
        try {
          await wallet.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] });
        } catch {
          if (collector.chain === "robinhood") {
            await wallet.provider.request({ method: "wallet_addEthereumChain", params: [HOOD_ADD_PARAMS] });
          } else {
            throw new Error(`switch to ${CHAIN_LABEL[collector.chain]} in your wallet`);
          }
        }
      }
      const provider = new BrowserProvider(wallet.provider);
      const signer = await provider.getSigner();
      const c = new Contract(collector.address, ["function flush()"], signer);
      await c.flush.staticCall(); // must succeed before the wallet ever prompts
      setPhase("wallet");
      const tx = await c.flush();
      setPhase("mining");
      await tx.wait();
      setPhase("done");
      onDone?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/user rejected|denied/i.test(msg)) {
        setPhase("idle");
      } else {
        setPhase("error");
        setErr(msg.includes("switch to") ? msg : "Simulation reverted. Someone may have just cranked it.");
      }
    }
  };

  const label =
    phase === "sim"
      ? "Simulating…"
      : phase === "wallet"
        ? "Confirm in your wallet…"
        : phase === "mining"
          ? "Crank in flight…"
          : phase === "done"
            ? "Cranked. The burn is on its way"
            : !account
              ? `Connect & crank the burn · Ξ${fmtEth(collector.pendingEth)}`
              : `Crank the burn · Ξ${fmtEth(collector.pendingEth)} staged`;

  // The economic gate, not the contract floor: below the 2% policy the button
  // does not render as an action at all — waiting for a fatter batch IS the
  // winning move, and the UI says so instead of arming a wasteful crank.
  if (!collectorCrankable(collector)) {
    const pct = collector.finalizeCostPct;
    return (
      <div className="flex max-w-xs flex-col items-center gap-1.5 text-center">
        <div
          className="rounded-full border px-5 py-2.5 text-[12px] font-bold uppercase tracking-wider text-slate-400"
          style={{ borderColor: "rgba(148,163,184,0.3)", background: "rgba(148,163,184,0.08)" }}
        >
          Waiting for a fatter batch
        </div>
        <div className="text-[11px] leading-relaxed text-slate-500">
          {!collector.flushable && collector.thresholdEth
            ? `Ξ${fmtEth(collector.pendingEth)} staged of the Ξ${fmtEth(collector.thresholdEth)} contract floor. `
            : ""}
          {pct != null && pct > 2
            ? pct > 100
              ? "Finalizing this on L1 right now would cost more than it delivers. The crank lights under 2%."
              : `Finalizing this on L1 right now would cost ${pct.toFixed(pct >= 10 ? 0 : 1)}% of it. The crank lights under 2%.`
            : "The crank lights when the batch clears the economics."}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={crank}
        disabled={phase === "sim" || phase === "wallet" || phase === "mining" || phase === "done"}
        className="rounded-full px-5 py-2.5 text-[12px] font-bold uppercase tracking-wider transition-all hover:brightness-125 disabled:opacity-75"
        style={{ background: "linear-gradient(90deg, #FF5E00, #FF9F45)", color: "#140700", boxShadow: "0 0 24px rgba(255,94,0,0.45)" }}
      >
        {label}
      </button>
      {phase === "error" && <div className="max-w-xs text-center text-[11px] text-red-300/90">{err}</div>}
      {collector.efficiencyPct != null && phase === "idle" && (
        <div className="text-[10px] font-semibold tabular-nums" style={{ color: "#5cff8f" }}>
          this burn runs at ≈{collector.efficiencyPct.toFixed(collector.efficiencyPct >= 99 ? 1 : 0)}% efficiency at current gas
        </div>
      )}
      <div className="text-[10px] text-slate-500">flush() is permissionless. Anyone can push the burn.</div>
    </div>
  );
}

/** The little staged-burn card for live wires and strips. */
export function PendingBurnChip({ collector, onOpen }: { collector: PendingCollector; onOpen: (c: PendingCollector) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(collector)}
      title="A burn is staged and waiting for its permissionless crank. Click to push it."
      className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1 transition-all hover:brightness-125"
      style={{ borderColor: "rgba(255,94,0,0.5)", background: "rgba(255,94,0,0.12)", boxShadow: "0 0 16px rgba(255,94,0,0.3)" }}
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: "#FF5E00" }} />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: "#FF5E00" }} />
      </span>
      <span className="text-[12px] font-bold" style={{ color: "#FF9F45" }}>
        Ξ{fmtEth(collector.pendingEth)} burn staged · crank it
      </span>
    </button>
  );
}

/** The crank popup: the staged figure, the three stages told honestly, and
 * the button that lets anyone push stage two. */
export function PendingBurnModal({
  collector,
  ethUsd = 0,
  onClose,
  onDone,
}: {
  collector: PendingCollector;
  ethUsd?: number;
  onClose: () => void;
  onDone?: () => void;
}) {
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

  // FOUR stages, told honestly (w-79): the bridge does NOT land by itself —
  // after the ~7-day window, the L1 finalization is its own permissionless
  // crank, and only then can the burner's flush actually kill PRISM.
  const stages: { label: string; state: "done" | "here" | "next" }[] = [
    { label: "Burn cut delivered to the collector", state: "done" },
    { label: "flush() opens the ~7-day withdrawal", state: "here" },
    { label: "L1 finalization · its own crank, after the window", state: "next" },
    { label: "The burner buys & burns PRISM", state: "next" },
  ];

  return (
    <div className="fixed inset-0 z-[95] grid place-items-center p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" aria-hidden />
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/12 bg-[#0b0e17]/95 p-7 text-center shadow-[0_30px_90px_rgba(0,0,0,0.6)]"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: "linear-gradient(90deg, transparent, #FF5E00, transparent)" }} aria-hidden />
        <div className="text-[10px] font-bold uppercase tracking-[0.24em]" style={{ color: "#FF9F45" }}>
          {CHAIN_LABEL[collector.chain] ?? collector.chain} · staged burn
        </div>
        <div className="mt-3 text-5xl font-black tabular-nums text-white" style={{ textShadow: "0 0 30px rgba(255,94,0,0.5)" }}>
          Ξ{fmtEth(collector.pendingEth)}
        </div>
        {ethUsd > 0 && <div className="mt-1 text-[13px] font-semibold tabular-nums text-slate-400">{fmtUsdFull(collector.pendingEth * ethUsd)}</div>}
        <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">one crank from buying &amp; burning PRISM</div>

        <div className="mx-auto mt-5 flex max-w-xs flex-col gap-2 text-left">
          {stages.map((s) => (
            <div key={s.label} className="flex items-center gap-2.5">
              <span
                className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] font-black"
                style={
                  s.state === "done"
                    ? { background: "rgba(0,255,135,0.18)", color: "#00FF87", border: "1px solid rgba(0,255,135,0.4)" }
                    : s.state === "here"
                      ? { background: "rgba(255,94,0,0.2)", color: "#FF9F45", border: "1px solid rgba(255,94,0,0.55)" }
                      : { background: "rgba(148,163,184,0.1)", color: "#64748b", border: "1px solid rgba(148,163,184,0.25)" }
                }
              >
                {s.state === "done" ? "✓" : s.state === "here" ? "→" : "·"}
              </span>
              <span className={`text-[12px] ${s.state === "here" ? "font-bold text-white" : "text-slate-400"}`}>{s.label}</span>
            </div>
          ))}
        </div>

        <div className="mt-6">
          <CrankBurnButton collector={collector} onDone={onDone} />
        </div>
        {collector.finalizeCostEth != null && collector.finalizeCostEth > 0 && (
          <div className="mt-3 text-[10px] leading-relaxed text-slate-500">
            The later L1 finalization costs ≈{ethUsd > 0 ? fmtUsdFull(collector.finalizeCostEth * ethUsd) : `Ξ${fmtEth(collector.finalizeCostEth)}`} at
            current gas. It is unreimbursed, which is why the crank only lights under 2% of the value.
          </div>
        )}
      </div>
    </div>
  );
}

// ── The header crank pair — the two totals, crankable from anywhere ─────────
// the designer (2026-08-16): beside the map's range picker and on the radio, one
// button for the combined TO-BRIDGE total (the collectors' staged burns) and
// one for the burner pot — pressing either does the crank in place. Self-
// contained (its own pipeline poll + modals) so any header can mount it.

export function CrankTotalsButtons({ hero = false }: { hero?: boolean } = {}) {
  const { data: pipe, refresh } = usePolledJson<{
    collectors?: PendingCollector[];
    burner?: { address: string; balanceEth: number; economic?: boolean };
    ethUsd?: number;
  }>("/api/burn-pipeline", 120_000);
  const [flushTarget, setFlushTarget] = useState<PendingCollector | null>(null);
  const [burnerOpen, setBurnerOpen] = useState(false);

  const collectors = pipe?.collectors ?? [];
  const toBridge = collectors.reduce((a, c) => a + c.pendingEth, 0);
  // pressing the pair cranks the biggest crankable collector — one press, one tx
  const best = collectors.filter(collectorCrankable).sort((a, b) => b.pendingEth - a.pendingEth)[0] ?? null;
  const burner = pipe?.burner ?? null;
  const potEth = burner?.balanceEth ?? 0;
  const potReady = burner != null && potEth > 0.0001 && burner.economic !== false;

  // hero pills (the /burn header): gradient-filled when lit, bigger type —
  // the page's two prime actions. Regular pills ride the map/radio headers.
  const pill = (lit: boolean, color: string, grad?: string) =>
    ({
      borderColor: lit ? `${color}80` : "rgba(255,255,255,0.1)",
      background: lit ? (hero && grad ? grad : `${color}1f`) : "rgba(255,255,255,0.03)",
      boxShadow: lit ? `0 0 ${hero ? 24 : 14}px ${color}${hero ? "59" : "40"}` : "none",
      color: lit ? (hero && grad ? "#140700" : color) : "#64748b",
      fontFamily: "ui-monospace, monospace",
    }) as React.CSSProperties;
  const pillCls = hero
    ? "flex items-center gap-2 rounded-full border px-5 py-2.5 text-[12px] font-bold uppercase tracking-wider tabular-nums transition-all enabled:hover:brightness-125 disabled:cursor-default"
    : "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold tabular-nums transition-all enabled:hover:brightness-125 disabled:cursor-default";

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => best && setFlushTarget(best)}
        disabled={!best}
        className={pillCls}
        style={pill(best != null, "#FF9F45", "linear-gradient(90deg, #FF5E00, #FF9F45)")}
        title={
          best
            ? "Staged burns waiting on the collectors. Press to crank the flush toward the L1 burner."
            : toBridge > 0
              ? "Staged burns below their floor or economics. The crank lights when a batch clears them."
              : "Nothing staged on the collectors right now."
        }
      >
        {best && (
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: hero ? "#140700" : "#FF9F45" }} />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: hero ? "#140700" : "#FF9F45" }} />
          </span>
        )}
        {hero ? <>Trigger the bridge · Ξ{fmtEth(toBridge)}</> : <>Ξ{fmtEth(toBridge)} to bridge</>}
      </button>
      <button
        type="button"
        onClick={() => burner && potEth > 0.0001 && setBurnerOpen(true)}
        disabled={!burner || potEth <= 0.0001}
        className={pillCls}
        style={pill(potReady, "#FF0A3C", "linear-gradient(90deg, #FF0A3C, #FF5E00)")}
        title={
          potReady
            ? "ETH pooled at the L1 burner. Press to crank the buy-and-burn."
            : potEth > 0.0001
              ? "The pot is filling. Cranking now would cost too much of it, so waiting wins."
              : "The burner pot is empty. Every road fills it."
        }
      >
        {potReady && (
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: hero ? "#1a0207" : "#FF0A3C" }} />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: hero ? "#1a0207" : "#FF0A3C" }} />
          </span>
        )}
        {hero ? <>Trigger the burn · Ξ{fmtEth(potEth)}</> : <>Ξ{fmtEth(potEth)} to burn</>}
      </button>
      {flushTarget && (
        <PendingBurnModal
          collector={flushTarget}
          ethUsd={pipe?.ethUsd ?? 0}
          onClose={() => setFlushTarget(null)}
          onDone={() => {
            setFlushTarget(null);
            refresh();
          }}
        />
      )}
      {burnerOpen && burner && (
        <BurnerCrankModal burner={burner} ethUsd={pipe?.ethUsd ?? 0} onClose={() => setBurnerOpen(false)} onDone={refresh} />
      )}
    </div>
  );
}

// ── The L1 burner's own crank — the FINAL stage, with its celebration ────────
// the designer (2026-08-16): the buy-and-burn flush must end in a celebration popup
// showing what was actually bought and burnt — not a card that silently
// disappears — and the whole crank must be doable from the money map's popup,
// like the bridge crank. The figures in the celebration are decoded from the
// receipt's own Burned event (caller, ethIn, prismBurned), never estimated.

export interface BurnerPot {
  address: string;
  balanceEth: number;
}

const BURNED_EVENT = new Interface(["event Burned(address indexed caller, uint256 ethIn, uint256 prismBurned)"]);

type BurnerPhase =
  | { k: "idle" }
  | { k: "quote" }
  | { k: "sim" }
  | { k: "wallet" }
  | { k: "mining" }
  | { k: "celebrate"; ethIn: number | null; prismBurned: number | null; txHash: string | null }
  | { k: "error"; msg: string };

export function BurnerCrankModal({
  burner,
  ethUsd = 0,
  onClose,
  onDone,
}: {
  burner: BurnerPot;
  ethUsd?: number;
  onClose: () => void;
  onDone?: () => void;
}) {
  const { wallet, account, openPicker } = useWallet();
  const [phase, setPhase] = useState<BurnerPhase>({ k: "idle" });

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

  const crank = async () => {
    if (!wallet || !account) {
      openPicker();
      return;
    }
    setPhase({ k: "quote" });
    try {
      // min-out quoted fresh at crank time — a zero floor reverts by design
      const q = await fetch(`/api/trade/quote?dir=buy&in=${burner.balanceEth}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (!q?.amountOut) throw new Error("No PRISM quote available for the min-out. Try again.");
      const minOut = parseUnits((Number(q.amountOut) * 0.95).toFixed(18), 18);

      const want = CHAIN_HEX.ethereum;
      const have = (await wallet.provider.request({ method: "eth_chainId" })) as string;
      if (have !== want) {
        try {
          await wallet.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] });
        } catch {
          throw new Error("switch to Ethereum in your wallet");
        }
      }
      setPhase({ k: "sim" });
      const provider = new BrowserProvider(wallet.provider);
      const signer = await provider.getSigner();
      const c = new Contract(burner.address, ["function flush(uint256)"], signer);
      await c.flush.staticCall(minOut); // must succeed before the wallet ever prompts
      setPhase({ k: "wallet" });
      const tx = await c.flush(minOut);
      setPhase({ k: "mining" });
      const receipt = await tx.wait();
      // the celebration states what the chain says happened, nothing estimated
      let ethIn: number | null = null;
      let prismBurned: number | null = null;
      for (const log of receipt?.logs ?? []) {
        if (log.address.toLowerCase() !== burner.address.toLowerCase()) continue;
        try {
          const parsed = BURNED_EVENT.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "Burned") {
            ethIn = Number(parsed.args.ethIn) / 1e18;
            prismBurned = Number(parsed.args.prismBurned) / 1e18;
          }
        } catch {
          /* not the Burned event */
        }
      }
      setPhase({ k: "celebrate", ethIn, prismBurned, txHash: receipt?.hash ?? null });
      onDone?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/user rejected|denied/i.test(msg)) {
        setPhase({ k: "idle" });
      } else {
        setPhase({
          k: "error",
          msg: msg.includes("switch to") || msg.includes("quote") ? msg : "Simulation reverted. Someone may have just cranked it.",
        });
      }
    }
  };

  const busy = phase.k === "quote" || phase.k === "sim" || phase.k === "wallet" || phase.k === "mining";
  const label =
    phase.k === "quote"
      ? "Quoting the min-out…"
      : phase.k === "sim"
        ? "Simulating…"
        : phase.k === "wallet"
          ? "Confirm in your wallet…"
          : phase.k === "mining"
            ? "Burn in flight…"
            : !account
              ? `Connect & crank the burn · Ξ${fmtEth(burner.balanceEth)}`
              : `Crank the burn · Ξ${fmtEth(burner.balanceEth)} in the pot`;

  const stages: { label: string; state: "done" | "here" | "next" }[] = [
    { label: "Fees pooled at the L1 burner", state: "done" },
    { label: "flush(minPrismOut) buys PRISM through the pool", state: "here" },
    { label: "The PRISM goes to 0x…dEaD, forever", state: "next" },
  ];

  return (
    <div className="fixed inset-0 z-[95] grid place-items-center p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" aria-hidden />

      {/* the celebration burst — the same full-spectrum moment the claim uses.
          Skipped under reduced motion: this modal stays open until closed, so
          animation:none would leave 24 frozen dots stacked behind it forever */}
      {phase.k === "celebrate" && !(typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) && (
        <div className="pointer-events-none fixed inset-0 z-[96] flex items-center justify-center" aria-hidden>
          <div
            className="absolute inset-0"
            style={{ background: "radial-gradient(60% 60% at 50% 45%, rgba(255,94,0,0.18), transparent 70%)", animation: "prism-celebrate-fade 3.2s ease-out forwards" }}
          />
          {Array.from({ length: 24 }).map((_, i) => (
            <span
              key={i}
              className="absolute h-2.5 w-2.5 rounded-full"
              style={{
                background: ["#ff5a5a", "#ff9f1c", "#ffe14d", "#5cff8f", "#3bd9ff", "#6a8bff", "#c06aff"][i % 7],
                left: "50%",
                top: "45%",
                animation: "prism-confetti 2.6s cubic-bezier(0.16,1,0.3,1) forwards",
                animationDelay: `${(i % 8) * 0.05}s`,
                ["--dx" as never]: `${Math.cos((i / 24) * Math.PI * 2) * (120 + (i % 5) * 60)}px`,
                ["--dy" as never]: `${Math.sin((i / 24) * Math.PI * 2) * (90 + (i % 4) * 55) - 60}px`,
              }}
            />
          ))}
        </div>
      )}

      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/12 bg-[#0b0e17]/95 p-7 text-center shadow-[0_30px_90px_rgba(0,0,0,0.6)]"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: "linear-gradient(90deg, transparent, #FF0A3C, transparent)" }} aria-hidden />

        {phase.k === "celebrate" ? (
          <>
            <div className="text-[10px] font-bold uppercase tracking-[0.24em]" style={{ color: "#ff8fa3" }}>
              Ethereum · burned forever
            </div>
            {/* the prism, burning: embers rise off the glass while it breathes
                heat — hidden under reduced motion (the frozen mid-frame reads
                as debris), where the plain figures carry the moment */}
            <svg viewBox="0 0 80 64" className="mx-auto mt-3 h-16 w-20" aria-hidden>
              <defs>
                <linearGradient id="burnprism-edge" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ffe14d" />
                  <stop offset="100%" stopColor="#ff0a3c" />
                </linearGradient>
                <linearGradient id="burnprism-caustic" gradientUnits="userSpaceOnUse" x1="18" y1="0" x2="62" y2="0">
                  {["#ff5a5a", "#ff9f45", "#ffe14d", "#5cff8f", "#3bd9ff", "#7c8bff", "#c06aff"].map((c, i) => (
                    <stop key={c} offset={`${(i / 6) * 100}%`} stopColor={c} stopOpacity="0.85" />
                  ))}
                </linearGradient>
              </defs>
              <g className="[@media(prefers-reduced-motion:reduce)]:hidden">
                {[0, 1, 2, 3, 4].map((i) => (
                  <circle
                    key={i}
                    cx={28 + i * 6}
                    cy={46}
                    r={1.4 + (i % 2) * 0.6}
                    fill={["#ff5a5a", "#ff9f45", "#ffe14d", "#ff5e00", "#ff9f45"][i]}
                    style={{ animation: `prism-ember ${1.6 + (i % 3) * 0.45}s ease-out ${i * 0.33}s infinite` }}
                  />
                ))}
              </g>
              <g style={{ animation: "prism-burnglow 2.2s ease-in-out infinite" }}>
                <polygon points="40,10 16,52 64,52" fill="rgba(255,94,0,0.10)" stroke="url(#burnprism-edge)" strokeWidth="1.6" strokeLinejoin="round" />
                <line x1="18" y1="57" x2="62" y2="57" stroke="url(#burnprism-caustic)" strokeWidth="2" strokeLinecap="round" />
              </g>
            </svg>
            <div className="mt-2 text-5xl font-black tabular-nums text-white" style={{ textShadow: "0 0 30px rgba(255,10,60,0.5)" }}>
              {phase.prismBurned != null ? `${fmtPrism(phase.prismBurned)} PRISM` : "Burned"}
            </div>
            <div className="mt-2 text-[13px] font-semibold tabular-nums text-slate-300" style={{ fontFamily: "ui-monospace, monospace" }}>
              {phase.ethIn != null ? `Ξ${fmtEth(phase.ethIn)}${ethUsd > 0 ? ` (${fmtUsdFull(phase.ethIn * ethUsd)})` : ""} bought & burned it` : "The pot bought PRISM and burned it"}
            </div>
            <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              sent to 0x…dEaD · supply only moves down
            </div>
            <div className="mx-auto mt-5 h-1.5 w-40 rounded-full" style={{ background: "linear-gradient(90deg, #ff5a5a, #ff9f45, #ffe14d, #5cff8f, #3bd9ff, #7c8bff, #c06aff)" }} aria-hidden />
            {/* the buy-and-burn transaction itself, one click away */}
            {phase.txHash && (
              <a
                href={txUrl(phase.txHash, "ethereum")}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold tabular-nums transition-all hover:brightness-125"
                style={{ borderColor: "rgba(255,94,0,0.45)", background: "rgba(255,94,0,0.1)", color: "#FF9F45", fontFamily: "ui-monospace, monospace" }}
              >
                buy &amp; burn tx · {phase.txHash.slice(0, 6)}…{phase.txHash.slice(-4)}
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
            <div className="text-[10px] font-bold uppercase tracking-[0.24em]" style={{ color: "#ff8fa3" }}>
              Ethereum · the L1 burner
            </div>
            <div className="mt-3 text-5xl font-black tabular-nums text-white" style={{ textShadow: "0 0 30px rgba(255,10,60,0.45)" }}>
              Ξ{fmtEth(burner.balanceEth)}
            </div>
            {ethUsd > 0 && <div className="mt-1 text-[13px] font-semibold tabular-nums text-slate-400">{fmtUsdFull(burner.balanceEth * ethUsd)}</div>}
            <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">one crank from dead PRISM</div>

            <div className="mx-auto mt-5 flex max-w-xs flex-col gap-2 text-left">
              {stages.map((s) => (
                <div key={s.label} className="flex items-center gap-2.5">
                  <span
                    className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] font-black"
                    style={
                      s.state === "done"
                        ? { background: "rgba(0,255,135,0.18)", color: "#00FF87", border: "1px solid rgba(0,255,135,0.4)" }
                        : s.state === "here"
                          ? { background: "rgba(255,10,60,0.2)", color: "#ff8fa3", border: "1px solid rgba(255,10,60,0.55)" }
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
              <button
                type="button"
                onClick={crank}
                disabled={busy}
                className="rounded-full px-5 py-2.5 text-[12px] font-bold uppercase tracking-wider transition-all hover:brightness-125 disabled:opacity-75"
                style={{ background: "linear-gradient(90deg, #FF0A3C, #FF5E00)", color: "#1a0207", boxShadow: "0 0 24px rgba(255,10,60,0.45)" }}
              >
                {label}
              </button>
              {phase.k === "error" && <div className="max-w-xs text-center text-[11px] text-red-300/90">{phase.msg}</div>}
              <div className="text-[10px] text-slate-500">flush() is permissionless. The min-out is quoted fresh.</div>
              <Link href="/burn" className="text-[10px] font-semibold text-slate-400 underline-offset-2 hover:underline">
                the whole pipeline lives on /burn →
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
