"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AbiCoder, BrowserProvider, Contract, Interface, formatEther, formatUnits, parseUnits } from "ethers";
import type { ActivityEvent } from "@/lib/feed/types";
import { fmtEth, fmtPrism } from "@/lib/feed/format";
import { HeroVideoBackdrop } from "./hero-backdrop";
import { PRISM, PRISM_LIVE, PRISM_POOL_KEY, TOPIC, UNIVERSAL_ROUTER } from "@/lib/chain/constants";
import { dexscreenerEmbedUrl, etherscanAddressUrl, uniswapUrl } from "@/lib/chain/token-links";
import { useWallet } from "@/lib/wallet/context";
import type { WalletOption } from "@/lib/wallet/discovery";
import { PixelRainbow } from "@/components/effects/pixel-rainbow";
import { AuthorizeModal } from "./authorize-modal";
import { C, MONO, glass, glow } from "./style";
import { AmbientBlooms } from "./blooms";
import { FeedColumn } from "./deck";

// ── TRADE (NATIVE) — the kit's optional live-trading panel ──────────────────
// Enabled per-instance via site.config.json tradingMode:"native" (default
// "matcha": the read-only outline that links out). An integrator who enables
// this operates a live swap UI on their own instance and responsibility — see
// DISCLAIMER.md. The reference deploy keeps matcha mode.
// the designer's ask (2026-08-03): a native trade page where a buyer SEES their own
// trade's fee stream to holders — the post-buy popup reads the mined receipt's
// FeesPoked event, so the number is what actually happened, not an estimate.
//
// Execution goes through the official Universal Router
// (0x66a9893c… — verified on-chain 2026-08-03, full buy eth_call-simulated
// clean, ~125k gas). Quotes come from the official V4Quoter via
// /api/trade/quote. This site adds no fee and takes no cut; the only fee is
// the pool's own 1%, which is exactly the point.
//
// v1 scope: BUY is native. SELL quotes here but executes on Uniswap (native
// selling needs the Permit2 approval flow — next slice).

const ZERO = "0x0000000000000000000000000000000000000000";
const UR_IFACE = new Interface(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);
const ERC20 = ["function balanceOf(address) view returns (uint256)"];

// Universal Router command + v4 actions — constants fetched from the deployed
// sources (Commands.sol / Actions.sol) and PROVEN by mainnet simulation before
// shipping: V4_SWAP = 0x10 · SWAP_EXACT_IN_SINGLE 0x06 · SETTLE_ALL 0x0c ·
// TAKE_ALL 0x0f.
const V4_SWAP_COMMAND = "0x10";
const BUY_ACTIONS = "0x060c0f";

function buildBuyCalldata(amountIn: bigint, minOut: bigint, deadlineSec: number): string {
  const abi = AbiCoder.defaultAbiCoder();
  const key = [PRISM_POOL_KEY.currency0, PRISM_POOL_KEY.currency1, PRISM_POOL_KEY.fee, PRISM_POOL_KEY.tickSpacing, PRISM_POOL_KEY.hooks];
  const swapParam = abi.encode(
    ["tuple(tuple(address,address,uint24,int24,address),bool,uint128,uint128,bytes)"],
    [[key, true, amountIn, minOut, "0x"]],
  );
  const settleParam = abi.encode(["address", "uint256"], [ZERO, amountIn]);
  const takeParam = abi.encode(["address", "uint256"], [PRISM, minOut]);
  const input = abi.encode(["bytes", "bytes[]"], [BUY_ACTIONS, [swapParam, settleParam, takeParam]]);
  return UR_IFACE.encodeFunctionData("execute", [V4_SWAP_COMMAND, [input], deadlineSec]);
}

type Phase = "idle" | "review" | "wallet" | "mining" | "done";

interface Quote {
  amountOut: number;
  ethUsd: number;
}

interface BuyResult {
  gotPrism: number;
  feeEth: number | null; // from the receipt's own FeesPoked — null if absent
  txHash: string;
}

const SLIPPAGES = [0.5, 1, 2] as const;

export function TradeNativePanel() {
  const { wallet, account, openPicker } = useWallet();
  const [ethBal, setEthBal] = useState<bigint | null>(null);
  const [prismBal, setPrismBal] = useState<bigint | null>(null);

  const [dir, setDir] = useState<"buy" | "sell">("buy");
  const [payIn, setPayIn] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [slip, setSlip] = useState<(typeof SLIPPAGES)[number]>(1);

  const [phase, setPhase] = useState<Phase>("idle");
  const [gasUsd, setGasUsd] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BuyResult | null>(null);

  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [prismUsd, setPrismUsd] = useState(0);
  const quoteReq = useRef(0);

  // live pool activity for the right column — the same feed the deck reads.
  // The stats ride along; prismUsd prices the receive side at MARKET value
  // (valuing it at the execution rate would always mirror the pay side and
  // hide the fee + price impact).
  useEffect(() => {
    let alive = true;
    const tick = () =>
      fetch("/api/feed", { cache: "no-store" })
        .then((r) => r.json())
        .then((d: { events?: ActivityEvent[]; stats?: { prismUsd?: number } }) => {
          if (!alive) return;
          if (d.events) setEvents(d.events.filter((e) => e.source === "prism-pool" || e.source === "dstable").slice(0, 24));
          if (d.stats?.prismUsd) setPrismUsd(d.stats.prismUsd);
        })
        .catch(() => {});
    tick();
    const t = setInterval(tick, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // debounced quoting through the official V4Quoter
  useEffect(() => {
    const amount = Number(payIn);
    if (!Number.isFinite(amount) || amount <= 0) {
      setQuote(null);
      return;
    }
    const id = ++quoteReq.current;
    setQuoting(true);
    const t = setTimeout(() => {
      fetch(`/api/trade/quote?dir=${dir}&in=${encodeURIComponent(payIn)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d: { amountOut: string; ethUsd: number }) => {
          if (id === quoteReq.current) setQuote({ amountOut: Number(d.amountOut), ethUsd: d.ethUsd });
        })
        .catch(() => {
          if (id === quoteReq.current) setQuote(null);
        })
        .finally(() => {
          if (id === quoteReq.current) setQuoting(false);
        });
    }, 350);
    return () => clearTimeout(t);
  }, [payIn, dir]);

  const refreshBalances = useCallback(async (w: WalletOption, acct: string) => {
    try {
      const provider = new BrowserProvider(w.provider);
      const [eb, pb] = await Promise.all([
        provider.getBalance(acct),
        PRISM_LIVE ? (new Contract(PRISM, ERC20, provider).balanceOf(acct) as Promise<bigint>) : Promise.resolve(0n),
      ]);
      setEthBal(eb);
      setPrismBal(pb);
    } catch {
      /* balances are cosmetic — never block the flow on them */
    }
  }, []);

  // the wallet arrives from the global context (top-right button); balances
  // follow it, and the mainnet check moved to review-time (per-action, like
  // the burn board's cranks)
  useEffect(() => {
    if (wallet && account) refreshBalances(wallet, account);
  }, [wallet, account, refreshBalances]);

  const amountInWei = useMemo(() => {
    const n = Number(payIn);
    if (!Number.isFinite(n) || n <= 0) return null;
    try {
      return parseUnits(n.toFixed(18), 18);
    } catch {
      return null;
    }
  }, [payIn]);

  const minOut = useMemo(() => {
    if (!quote) return null;
    const out = quote.amountOut * (1 - slip / 100);
    return parseUnits(out.toFixed(18), 18);
  }, [quote, slip]);

  // moving to review: simulate the exact calldata from the user's own address
  // first — a swap that would revert must never reach the wallet prompt
  const review = useCallback(async () => {
    if (!wallet || !account || !amountInWei || !minOut) return;
    setError(null);
    setPhase("review");
    setGasUsd(null);
    try {
      const chain = (await wallet.provider.request({ method: "eth_chainId" })) as string;
      if (chain !== "0x1") {
        try {
          await wallet.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] });
        } catch {
          setPhase("idle");
          setError("PRISM trades on Ethereum mainnet. Switch networks in your wallet.");
          return;
        }
      }
      const provider = new BrowserProvider(wallet.provider);
      const data = buildBuyCalldata(amountInWei, minOut, Math.floor(Date.now() / 1000) + 1200);
      await provider.call({ from: account, to: UNIVERSAL_ROUTER, data, value: amountInWei });
      try {
        const gas = await provider.estimateGas({ from: account, to: UNIVERSAL_ROUTER, data, value: amountInWei });
        const fee = await provider.getFeeData();
        if (fee.maxFeePerGas && quote) setGasUsd(Number(formatEther(gas * fee.maxFeePerGas)) * quote.ethUsd);
      } catch {
        /* estimate is display-only */
      }
    } catch (e) {
      setPhase("idle");
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        msg.includes("insufficient funds")
          ? "Not enough ETH for this size plus gas."
          : "This swap would revert — try a smaller size or higher slippage.",
      );
    }
  }, [wallet, account, amountInWei, minOut, quote]);

  const execute = useCallback(async () => {
    if (!wallet || !account || !amountInWei || !minOut) return;
    setError(null);
    setPhase("wallet");
    try {
      const provider = new BrowserProvider(wallet.provider);
      const signer = await provider.getSigner();
      const before = PRISM_LIVE ? ((await new Contract(PRISM, ERC20, provider).balanceOf(account)) as bigint) : 0n;
      const data = buildBuyCalldata(amountInWei, minOut, Math.floor(Date.now() / 1000) + 1200);
      const tx = await signer.sendTransaction({ to: UNIVERSAL_ROUTER, data, value: amountInWei });
      setPhase("mining");
      const receipt = await tx.wait();
      // the payoff: this buy's OWN fee event, read off the mined receipt
      let feeEth: number | null = null;
      for (const log of receipt?.logs ?? []) {
        if (log.address.toLowerCase() === PRISM.toLowerCase() && log.topics[0] === TOPIC.feesPoked) {
          const decoded = AbiCoder.defaultAbiCoder().decode(["uint256", "uint256"], log.data);
          feeEth = Number(formatEther(decoded[0] as bigint));
          break;
        }
      }
      const after = PRISM_LIVE ? ((await new Contract(PRISM, ERC20, provider).balanceOf(account)) as bigint) : 0n;
      setResult({
        gotPrism: Number(formatUnits(after - before, 18)),
        feeEth,
        txHash: tx.hash,
      });
      setPhase("done");
      setPayIn("");
      setQuote(null);
      refreshBalances(wallet, account);
    } catch (e) {
      setPhase("idle");
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.includes("user rejected") || msg.includes("denied") ? null : "Transaction failed — nothing was taken beyond gas.");
    }
  }, [wallet, account, amountInWei, minOut, refreshBalances]);

  const rate = quote && Number(payIn) > 0 ? quote.amountOut / Number(payIn) : null;
  const outUsd = quote ? (dir === "buy" ? (prismUsd > 0 ? quote.amountOut * prismUsd : null) : quote.amountOut * quote.ethUsd) : null;
  const inUsd = quote ? (dir === "buy" ? Number(payIn) * quote.ethUsd : prismUsd > 0 ? Number(payIn) * prismUsd : null) : null;
  const feePreviewEth = dir === "buy" && Number(payIn) > 0 ? Number(payIn) * 0.01 : null;

  const setMax = useCallback(() => {
    if (dir === "buy" && ethBal != null) {
      const headroom = ethBal - parseUnits("0.005", 18); // leave gas
      setPayIn(headroom > 0n ? formatEther(headroom) : "0");
    } else if (dir === "sell" && prismBal != null) {
      setPayIn(formatUnits(prismBal, 18));
    }
  }, [dir, ethBal, prismBal]);

  if (!PRISM_LIVE) {
    return (
      <>
        <TradeHeroBackdrop />
        <main className="relative z-10 mx-auto w-full max-w-[1536px] p-4 sm:p-6">
          <AmbientBlooms />
          <div className="rounded-2xl p-10 text-center" style={glass}>
            <p className="text-slate-400">Trading opens when a PRISM token is wired.</p>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
    <TradeHeroBackdrop />
    <main className="relative z-10 mx-auto w-full max-w-[1536px] space-y-6 p-4 sm:p-6">
      <AmbientBlooms />

      {/* header — bigger title + badge, subtitle gone (the designer 1254) */}
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div>
          <h1 className="flex items-center gap-4 text-4xl font-black tracking-tight text-white sm:text-5xl">
            Trade
            <span
              className="rounded-lg border px-3 py-1 text-sm font-bold uppercase tracking-wider"
              style={{ borderColor: `${C.purple}4d`, background: `${C.purple}26`, color: C.purple }}
            >
              Uniswap v4
            </span>
          </h1>
        </div>
        {/* the menu carries the global Connect now (0901) — this slot only
            shows balances once connected, never a second connect button */}
        {account && (
          <div className="rounded-xl border border-white/10 px-4 py-2 text-xs text-slate-300" style={{ background: "rgba(3,4,9,0.5)", fontFamily: MONO }}>
            {account.slice(0, 6)}…{account.slice(-4)}
            {ethBal != null && <span className="ml-3 text-slate-500">Ξ{fmtEth(Number(formatEther(ethBal)))}</span>}
            {prismBal != null && <span className="ml-3 text-slate-500">{fmtPrism(Number(formatUnits(prismBal, 18)))} PRISM</span>}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* ── the swap card ── */}
        <div className="lg:col-span-5 xl:col-span-4">
          <div className="relative overflow-hidden rounded-2xl p-6" style={{ ...glass, background: "rgba(3,4,9,0.78)", borderTop: `2px solid ${C.purple}80` }}>
            <div
              className="pointer-events-none absolute inset-0 opacity-50"
              style={{ background: `radial-gradient(circle at 30% 0%, ${C.purple}1f 0%, rgba(0,0,0,0) 60%)` }}
            />

            <div className="relative z-10">
              <h2 className="text-lg font-semibold text-white">Swap</h2>

              {/* you pay */}
              <div className="mt-4 rounded-xl border border-white/5 p-4 transition-colors focus-within:border-white/15" style={{ background: "rgba(3,4,9,0.5)" }}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wider text-slate-500">You pay</span>
                  <button onClick={setMax} className="text-xs text-slate-400 transition-colors hover:text-white" style={{ fontFamily: MONO }}>
                    {dir === "buy"
                      ? ethBal != null
                        ? `Balance: Ξ${fmtEth(Number(formatEther(ethBal)))}`
                        : "Balance: —"
                      : prismBal != null
                        ? `Balance: ${fmtPrism(Number(formatUnits(prismBal, 18)))}`
                        : "Balance: —"}
                  </button>
                </div>
                <div className="flex items-center gap-4">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.0"
                    value={payIn}
                    onChange={(e) => {
                      if (/^\d*\.?\d*$/.test(e.target.value)) setPayIn(e.target.value);
                    }}
                    className="w-full bg-transparent text-3xl font-light text-white outline-none placeholder:text-slate-700"
                  />
                  <span className="shrink-0 rounded-lg border border-white/5 bg-white/10 px-3 py-2 font-semibold text-white">
                    {dir === "buy" ? "ETH" : "PRISM"}
                  </span>
                </div>
                <div className="mt-2 text-xs text-slate-500" style={{ fontFamily: MONO }}>
                  {inUsd != null ? `≈ $${inUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : " "}
                </div>
              </div>

              {/* flip */}
              <div className="relative z-20 -my-3 flex justify-center">
                <button
                  onClick={() => {
                    setDir((d) => (d === "buy" ? "sell" : "buy"));
                    setPayIn("");
                    setQuote(null);
                    setError(null);
                  }}
                  className="group flex h-10 w-10 items-center justify-center rounded-full text-slate-400 transition-all hover:text-white"
                  style={{ background: "#0A0C14", border: "4px solid #030409" }}
                  title="Flip direction"
                >
                  <svg className="h-5 w-5 transition-transform duration-300 group-hover:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                  </svg>
                </button>
              </div>

              {/* you receive */}
              <div className="rounded-xl border border-white/5 p-4" style={{ background: "rgba(3,4,9,0.5)" }}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wider text-slate-500">You receive (est.)</span>
                  {quoting && <span className="text-xs text-slate-500">quoting…</span>}
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-full truncate text-3xl font-light text-white">
                    {quote ? quote.amountOut.toLocaleString("en-US", { maximumFractionDigits: 6 }) : <span className="text-slate-700">0.0</span>}
                  </div>
                  <span
                    className="shrink-0 rounded-lg px-3 py-2 font-semibold text-white"
                    style={{ background: `${C.purple}33`, border: `1px solid ${C.purple}4d` }}
                  >
                    {dir === "buy" ? "PRISM" : "ETH"}
                  </span>
                </div>
                <div className="mt-2 text-xs text-slate-500" style={{ fontFamily: MONO }}>
                  {outUsd != null ? `≈ $${outUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : " "}
                </div>
              </div>

              {/* the hook, before the trade: where this buy's fee goes */}
              {dir === "buy" && feePreviewEth != null && feePreviewEth > 0 && (
                <div className="mt-4 rounded-xl border px-4 py-3" style={{ borderColor: `${C.green}33`, background: `${C.green}0d` }}>
                  <div className="text-[11px] leading-relaxed text-slate-300">
                    <span className="font-semibold" style={{ color: C.green }}>
                      ≈ Ξ{feePreviewEth.toLocaleString("en-US", { maximumFractionDigits: 6 })}
                    </span>{" "}
                    of this buy is the pool&apos;s 1% fee, streamed 100% to holders.
                  </div>
                </div>
              )}

              {/* details */}
              <div className="mt-4 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Rate</span>
                  <span className="text-slate-300" style={{ fontFamily: MONO }}>
                    {rate ? (dir === "buy" ? `1 ETH ≈ ${rate.toLocaleString("en-US", { maximumFractionDigits: 4 })} PRISM` : `1 PRISM ≈ ${rate.toLocaleString("en-US", { maximumFractionDigits: 6 })} ETH`) : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Slippage tolerance</span>
                  <div className="flex gap-2">
                    {SLIPPAGES.map((s) => (
                      <button
                        key={s}
                        onClick={() => setSlip(s)}
                        className="rounded px-2 py-0.5 transition-colors"
                        style={
                          slip === s
                            ? { background: `${C.purple}33`, color: C.purple, border: `1px solid ${C.purple}4d` }
                            : { background: "rgba(255,255,255,0.05)", color: "#94a3b8", border: "1px solid transparent" }
                        }
                      >
                        {s}%
                      </button>
                    ))}
                  </div>
                </div>
                {minOut && quote && dir === "buy" && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Minimum received</span>
                    <span className="text-slate-300" style={{ fontFamily: MONO }}>
                      {Number(formatUnits(minOut, 18)).toLocaleString("en-US", { maximumFractionDigits: 6 })} PRISM
                    </span>
                  </div>
                )}
              </div>

              {error && (
                <div className="mt-4 rounded-xl border px-4 py-3 text-xs leading-relaxed" style={{ borderColor: `${C.red}4d`, background: `${C.red}14`, color: "#fca5a5" }}>
                  {error}
                </div>
              )}

              {/* the action */}
              {dir === "sell" ? (
                <div className="mt-6">
                  <a
                    href={uniswapUrl() ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full rounded-xl border border-white/10 py-4 text-center text-sm font-bold text-white transition-colors hover:border-white/20"
                    style={{ background: "rgba(255,255,255,0.05)" }}
                  >
                    Sell on Uniswap ↗
                  </a>
                  <p className="mt-2 text-center text-[11px] text-slate-500">
                    Native selling lands here soon — same pool, same fees, via Uniswap for now.
                  </p>
                </div>
              ) : !account ? (
                <button
                  onClick={openPicker}
                  className="mt-6 w-full rounded-xl py-4 text-sm font-bold text-white transition-all hover:brightness-110"
                  style={{ background: `linear-gradient(90deg, ${C.purple}, ${C.cyan})`, boxShadow: `0 0 20px ${C.purple}4d` }}
                >
                  Connect wallet
                </button>
              ) : phase === "review" ? (
                <div className="mt-6 flex w-full items-center justify-center gap-3 rounded-xl border border-white/10 py-4 text-sm font-semibold text-slate-300" style={{ background: "rgba(255,255,255,0.03)" }}>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
                  Reviewing…
                </div>
              ) : phase === "wallet" || phase === "mining" ? (
                <div className="mt-6 flex w-full items-center justify-center gap-3 rounded-xl border border-white/10 py-4 text-sm font-semibold text-slate-300" style={{ background: "rgba(255,255,255,0.03)" }}>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
                  {phase === "wallet" ? "Confirm in your wallet…" : "Mining…"}
                </div>
              ) : (
                <button
                  onClick={review}
                  disabled={!quote || !amountInWei || quoting}
                  className="mt-6 w-full rounded-xl py-4 text-sm font-bold text-white transition-all hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100"
                  style={{ background: `linear-gradient(90deg, ${C.purple}, ${C.cyan})`, boxShadow: `0 0 20px ${C.purple}4d` }}
                >
                  Review swap
                </button>
              )}
            </div>
          </div>

          <p className="mt-3 px-2 text-[11px] leading-relaxed text-slate-600">
            Swaps execute from your wallet straight against the Uniswap v4 PRISM pool ({" "}
            <a href={etherscanAddressUrl(UNIVERSAL_ROUTER)} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-slate-400">
              Universal Router
            </a>
            ). Nothing here is investment advice.
          </p>
        </div>

        {/* ── the pool, and what fees do ── */}
        <div className="flex flex-col gap-6 lg:col-span-7 xl:col-span-8">
          {/* compact below md per the designer 1254: the pair card yields room to the swap */}
          <div className="rounded-2xl p-4 md:p-6" style={{ ...glass, background: "rgba(3,4,9,0.78)", borderTop: `2px solid ${C.green}80` }}>
            <div className="flex flex-wrap items-center justify-between gap-3 md:gap-4">
              <div className="flex items-center gap-3">
                <PixelRainbow className="hidden h-8 w-auto md:block" animate={false} />
                <div>
                  <h2 className="text-base font-bold text-white md:text-lg">ETH / PRISM</h2>
                  <p className="text-[10px] text-slate-500 md:text-[11px]" style={{ fontFamily: MONO }}>
                    Uniswap v4 · 1% fee · the token is its own hook
                  </p>
                </div>
              </div>
              <a
                href={etherscanAddressUrl(PRISM)}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-white/20 hover:text-white"
                style={{ background: "rgba(255,255,255,0.03)" }}
              >
                Token on Etherscan ↗
              </a>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3 md:mt-6 md:gap-4">
              <div className="rounded-xl border border-white/5 p-3 md:p-4" style={{ background: "rgba(3,4,9,0.5)" }}>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">ETH-side fees</div>
                <div className="mt-1 text-base font-semibold md:text-lg" style={{ color: C.green, ...glow(C.green) }}>
                  100% → holders
                </div>
              </div>
              <div className="rounded-xl border border-white/5 p-3 md:p-4" style={{ background: "rgba(3,4,9,0.5)" }}>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">PRISM-side fees</div>
                <div className="mt-1 text-base font-semibold text-white md:text-lg">
                  80% holders · <span style={{ color: C.orange }}>20% burned</span>
                </div>
              </div>
              <div className="rounded-xl border border-white/5 p-3 md:p-4" style={{ background: "rgba(3,4,9,0.5)" }}>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">This site&apos;s cut</div>
                <div className="mt-1 text-base font-semibold text-white md:text-lg">Zero</div>
              </div>
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
              Fee routing is enforced by the token&apos;s own hook contract, not by anyone&apos;s promise — verify it on the{" "}
              <Link href="/contracts" className="underline underline-offset-2 hover:text-slate-300">
                contracts page
              </Link>
              . Holder revenue tracks third-party trading, varies, and can be zero.
            </p>
          </div>

          {/* the live pair chart (the designer: keep the DexScreener embed on the
              native page too) — keyed on the pool id */}
          {dexscreenerEmbedUrl() && (
            <div className="overflow-hidden rounded-2xl" style={{ ...glass, background: "rgba(3,4,9,0.78)", borderTop: `2px solid ${C.cyan}80` }}>
              <iframe
                src={dexscreenerEmbedUrl()!}
                title="PRISM / ETH price chart"
                className="block h-[380px] w-full md:h-[460px]"
                style={{ border: 0 }}
                loading="lazy"
              />
            </div>
          )}
          <FeedColumn
            title="Pool activity"
            color={C.green}
            link={{ href: "/charts", label: "Telemetry" }}
            events={events}
            empty="PRISM pool fees and burns stream in live."
            filters={[
              { label: "All", test: () => true },
              { label: "Swap fees", test: (e) => e.kind !== "burn" },
              { label: "Burns", test: (e) => e.kind === "burn" },
            ]}
          />
        </div>
      </div>

      {/* ── AUTHORIZE the buy: the burn-confirm experience, for a swap —
          3D holo prism + the swap details + hold-to-execute (the designer) ── */}
      {phase === "review" && (
        <AuthorizeModal open title="Authorize buy" actionLabel="Hold to buy" onConfirm={execute} onClose={() => setPhase("idle")}>
          {/* the trade as a flow: what goes in, what comes out — visuals first */}
          <div className="mt-6 flex items-stretch justify-center gap-3">
            <div className="flex-1 rounded-xl border border-white/10 p-4 text-center" style={{ background: "rgba(3,4,9,0.6)" }}>
              <div className="text-2xl font-bold text-white tabular-nums" style={{ fontFamily: MONO }}>
                Ξ{payIn}
              </div>
              <div className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">
                {inUsd != null ? `≈ $${inUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "ETH"}
              </div>
            </div>
            <svg className="h-6 w-6 shrink-0 self-center text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
            <div className="flex-1 rounded-xl p-4 text-center" style={{ background: `${C.purple}14`, border: `1px solid ${C.purple}4d` }}>
              <div className="text-2xl font-bold text-white tabular-nums" style={{ fontFamily: MONO }}>
                {minOut ? Number(formatUnits(minOut, 18)).toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—"}
              </div>
              <div className="mt-1 text-[10px] uppercase tracking-wider" style={{ color: C.purple }}>
                PRISM · min
              </div>
            </div>
          </div>

          {/* what this buy streams to holders — the protocol LP fee, made visible */}
          {feePreviewEth != null && feePreviewEth > 0 && (
            <div
              className="mt-3 flex items-center justify-center gap-2.5 rounded-xl px-4 py-2.5"
              style={{ background: `${C.green}0d`, border: `1px solid ${C.green}33` }}
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: C.green }} />
              <span className="text-sm font-bold tabular-nums" style={{ fontFamily: MONO, color: C.green }}>
                Ξ{feePreviewEth.toLocaleString("en-US", { maximumFractionDigits: 6 })}
              </span>
              <span className="text-xs text-slate-300">streams to holders</span>
            </div>
          )}

          {/* the numbers that matter, as tiles */}
          <div className="mt-3 grid grid-cols-3 gap-2">
            {(
              [
                ["Rate", rate ? `1Ξ ≈ ${rate.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—"],
                ["Network fee", gasUsd != null ? `≈ $${gasUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—"],
                ["Slippage", `${slip}%`],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-xl border border-white/5 px-2 py-2.5 text-center" style={{ background: "rgba(3,4,9,0.6)" }}>
                <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
                <div className="mt-0.5 truncate text-xs font-semibold text-white tabular-nums" style={{ fontFamily: MONO }}>
                  {value}
                </div>
              </div>
            ))}
          </div>

          <p className="mt-3 text-center text-[10px] leading-relaxed text-slate-500">
            Simulated clean from your address just now. A move past your slippage reverts, never fills worse.
          </p>
        </AuthorizeModal>
      )}

      {/* ── the post-buy popup: this trade's OWN fee, from its receipt ── */}
      {phase === "done" && result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div
            className="relative w-full max-w-md overflow-hidden rounded-2xl p-8 text-center"
            style={{ ...glass, border: `1px solid ${C.green}4d`, boxShadow: `0 0 50px ${C.green}26`, animation: "prism-celebrate-pop 0.5s cubic-bezier(0.16,1,0.3,1) both" }}
          >
            <div
              className="pointer-events-none absolute inset-0"
              style={{ background: `radial-gradient(circle at 50% 0%, ${C.green}1f 0%, rgba(0,0,0,0) 60%)` }}
            />
            <div className="relative z-10 flex flex-col items-center">
              <PixelRainbow className="h-16 w-auto" />
              <h2 className="mt-6 text-2xl font-black tracking-tight text-white">PRISM aboard</h2>
              <div className="mt-2 text-4xl font-light" style={{ color: C.green, ...glow(C.green), fontFamily: MONO }}>
                +{result.gotPrism.toLocaleString("en-US", { maximumFractionDigits: 6 })}
              </div>

              {result.feeEth != null && result.feeEth > 0 && (
                <div className="mt-6 w-full rounded-xl border px-4 py-4" style={{ borderColor: `${C.green}33`, background: `${C.green}0d` }}>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: C.green }}>
                    Your buy just streamed
                  </div>
                  <div className="mt-1 text-2xl font-bold text-white" style={{ fontFamily: MONO }}>
                    Ξ{result.feeEth.toLocaleString("en-US", { maximumFractionDigits: 6 })}
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed text-slate-400">
                    to PRISM holders — read from your own transaction&apos;s fee event. Every trade does this, and as a
                    holder that now includes you.
                  </div>
                </div>
              )}

              <p className="mt-4 text-[10px] leading-relaxed text-slate-600">
                Holder revenue tracks third-party trading, varies, and can be zero — not a yield or a promise.
              </p>

              <div className="mt-6 flex w-full gap-3">
                <button
                  onClick={() => {
                    setPhase("idle");
                    setResult(null);
                  }}
                  className="flex-1 rounded-xl border border-white/10 py-3 text-sm font-semibold text-slate-300 transition-colors hover:text-white"
                  style={{ background: "rgba(255,255,255,0.03)" }}
                >
                  Done
                </button>
                <Link
                  href="/claim"
                  className="flex-1 rounded-xl py-3 text-sm font-bold text-white transition-all hover:brightness-110"
                  style={{ background: `linear-gradient(90deg, ${C.green}cc, ${C.cyan}cc)`, boxShadow: `0 0 20px ${C.green}4d` }}
                >
                  Open the claim hub
                </Link>
              </div>
              <a
                href={`https://etherscan.io/tx/${result.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 text-[11px] text-slate-500 underline underline-offset-2 hover:text-slate-300"
                style={{ fontFamily: MONO }}
              >
                view transaction ↗
              </a>
            </div>
          </div>
        </div>
      )}
    </main>
    </>
  );
}

// ── the trade hero backdrop ──────────────────────────────────────────────────
// the designer's low-motion light video on the home hero's exact treatment (shared
// component: full-bleed, masked, left scrim, boomerang loop).
function TradeHeroBackdrop() {
  return <HeroVideoBackdrop src="/mothership/trade-bg.boom.mp4" />;
}
