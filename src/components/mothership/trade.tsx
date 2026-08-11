"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BrowserProvider, Contract, formatEther, formatUnits, parseUnits } from "ethers";
import type { ActivityEvent } from "@/lib/feed/types";
import { fmtEth, fmtPrism } from "@/lib/feed/format";
import { HeroVideoBackdrop } from "./hero-backdrop";
import { PRISM, PRISM_LIVE } from "@/lib/chain/constants";
import { dexscreenerEmbedUrl, etherscanAddressUrl, matchaUrl } from "@/lib/chain/token-links";
import { useWallet } from "@/lib/wallet/context";
import type { WalletOption } from "@/lib/wallet/discovery";
import { PixelRainbow } from "@/components/effects/pixel-rainbow";
import { C, MONO, glass, glow } from "./style";
import { AmbientBlooms } from "./blooms";
import { FeedColumn } from "./deck";

// ── TRADE — the chart, the activity, and the OUTLINE of a swap ───────────────
// the designer's posture ruling (2026-08-03): no live DEX on our own site. The page
// keeps the pair's live chart (DexScreener embed), the pool activity feed and
// a read-only swap outline (real quotes via the official V4Quoter through
// /api/trade/quote, live balances, the 1%-fee-to-holders preview) — but the
// action button links out to MATCHA for actual execution. Nothing here can
// sign or send a transaction; the previous native-execution build survives in
// git history (b9d4592 and earlier) if that posture ever changes.

const ERC20 = ["function balanceOf(address) view returns (uint256)"];

interface Quote {
  amountOut: number;
  ethUsd: number;
}

export function TradePanel() {
  const { wallet, account, openPicker } = useWallet();
  const [ethBal, setEthBal] = useState<bigint | null>(null);
  const [prismBal, setPrismBal] = useState<bigint | null>(null);

  const [dir, setDir] = useState<"buy" | "sell">("buy");
  const [payIn, setPayIn] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);

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
              </div>

              {/* the action: execution lives on Matcha (no live DEX here) */}
              <a
                href={matchaUrl() ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 block w-full rounded-xl py-4 text-center text-sm font-bold text-white transition-all hover:brightness-110"
                style={{ background: `linear-gradient(90deg, ${C.purple}, ${C.cyan})`, boxShadow: `0 0 20px ${C.purple}4d` }}
              >
                Trade on Matcha ↗
              </a>
              <p className="mt-2 text-center text-[11px] text-slate-500">
                Quotes here are a live preview from the pool. The trade itself happens on Matcha, from your own wallet.
              </p>
            </div>
          </div>

          <p className="mt-3 px-2 text-[11px] leading-relaxed text-slate-600">
            This page never signs or sends transactions. Nothing here is investment advice.
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
              Fee routing is enforced by the token&apos;s own hook contract, not by anyone&apos;s promise. Verify it on the{" "}
              <Link href="/contracts" className="underline underline-offset-2 hover:text-slate-300">
                contracts page
              </Link>
              . Holder revenue tracks third-party trading, varies, and can be zero.
            </p>
          </div>

          {/* the live pair chart (the designer: chart + activity here, execution on
              Matcha) — DexScreener's own embed, keyed on the pool id */}
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
