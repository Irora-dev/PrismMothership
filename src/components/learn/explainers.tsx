"use client";

import { useState } from "react";
import Link from "next/link";
import type { EventKind } from "@/lib/feed/types";
import { KIND_META } from "@/lib/feed/format";
import { EventIcon } from "@/components/pulse/event-icon";

/* ── What you're watching — bridges the live feed to the meaning ── */

// Each mechanism leads with one sentence; the rest expands on click.
const WATCH: { kind: EventKind; title: string; lead: string; more: string }[] = [
  {
    kind: "fee",
    title: "Swap revenue",
    lead: "Every whole PRISM is a live Uniswap V4 liquidity position, wired through a hook.",
    more: "So each swap through the pool routes revenue to holders on-chain, with no staking required: all of the pool's ETH-side fees and 80% of its PRISM-side fees, plus 25% of Spectrum basket trading fees bridged from Base.",
  },
  {
    kind: "burn",
    title: "Buy & Burn",
    lead: "Two streams end at the dead address: PRISM taken as swap fees, and PRISM bought on the open market.",
    more: "Every sell through the PRISM pool pays its fee in PRISM, and 20% of that is burned outright \u2014 it is already PRISM, so nothing has to be bought. Separately, every Spectrum basket sends 25% of its trading fees to buy PRISM on the open market and burn that too. Once burned it is gone forever, so the supply only moves down.",
  },
  {
    kind: "launch",
    title: "Basket Launched",
    lead: "Anyone can launch a Spectrum basket.",
    more: "Its trading revenue is split between the basket's holders and its creator, and 25% buys and burns PRISM. The launch auction's ETH burns PRISM too.",
  },
  {
    kind: "harvest",
    title: "Reserve revenue",
    lead: "The protocol's stablecoin reserves sit in Aave, which earns a supply rate.",
    more: "A fixed 20% of that revenue is routed into a PRISM buy-and-burn.",
  },
  {
    kind: "retire",
    title: "NFT Retired",
    lead: "When a holder dips below a whole token, one Prism NFT is burned forever.",
    more: "Its one-of-one seed and art destroyed, never re-issued.",
  },
];

function WatchCard({ kind, title, lead, more }: (typeof WATCH)[number]) {
  const [open, setOpen] = useState(false);
  const color = KIND_META[kind].color;
  return (
    <div className="glass-card p-4 flex gap-3.5 items-start">
      <div
        className="grid place-items-center w-9 h-9 rounded-lg shrink-0 mt-0.5"
        style={{ background: `${color}1a`, border: `1px solid ${color}40` }}
      >
        <EventIcon kind={kind} />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-bold mb-1" style={{ color }}>
          {title}
        </div>
        <div className="text-[13px] text-slate-400 leading-relaxed">
          {lead}
          {open && <span className="text-slate-300"> {more}</span>}
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider transition-colors hover:opacity-80"
          style={{ color }}
          aria-expanded={open}
        >
          {open ? "Less" : "Expand more"}
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className="transition-transform" style={{ transform: open ? "rotate(180deg)" : "none" }} aria-hidden
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function WhatYoureWatching() {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.3em] text-slate-500 font-semibold mb-3">
        The legend
      </div>
      <h2 className="text-3xl md:text-4xl font-bold txt-white mb-3 leading-tight">
        What you&apos;re watching
      </h2>
      <p className="text-base text-slate-400 leading-relaxed max-w-2xl mb-8">
        PRISM is a single token that is also its own Uniswap V4 liquidity position, so the token itself
        holds a live LP position. Every line in the feed is one of five moments in the ecosystem: one routes
        revenue to holders, three reduce PRISM&apos;s supply, and one retires a piece of art forever.
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        {WATCH.map((w) => (
          <WatchCard key={w.kind} {...w} />
        ))}
        {/* the empty grid slot → a route into the full thesis */}
        <Link href="/how-it-works" className="glass-card p-4 flex items-center justify-between gap-3 group relative overflow-hidden transition-all hover:-translate-y-0.5 hover:border-white/20">
          <span className="absolute -right-8 -top-10 w-28 h-28 rounded-full blur-3xl opacity-[0.18] group-hover:opacity-30 transition-opacity pointer-events-none" style={{ background: "#a855f7" }} />
          <span className="relative z-10 flex items-center gap-3.5">
            <span className="grid place-items-center w-9 h-9 rounded-lg shrink-0" style={{ background: "rgba(168,85,247,0.12)", border: "1px solid rgba(168,85,247,0.4)" }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#c084fc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M7 19H4.815a1.83 1.83 0 0 1-1.57-.881 1.785 1.785 0 0 1-.004-1.784L7.196 9.5" />
                <path d="M11 19h8.203a1.83 1.83 0 0 0 1.556-.89 1.784 1.784 0 0 0 0-1.775l-1.226-2.12" />
                <path d="m14 16-3 3 3 3" />
                <path d="M8.293 13.596 7.196 9.5 3.1 10.598" />
                <path d="m9.344 5.811 1.093-1.892A1.83 1.83 0 0 1 11.985 3a1.784 1.784 0 0 1 1.546.888l3.943 6.843" />
                <path d="m13.378 9.633 4.096 1.098 1.097-4.096" />
              </svg>
            </span>
            <span>
              <span className="block text-sm font-bold txt-white">How it works</span>
              <span className="block text-[13px] text-slate-400">See the mechanism, with live data.</span>
            </span>
          </span>
          <svg className="relative z-10 text-slate-500 group-hover:text-white group-hover:translate-x-0.5 transition-all shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </Link>
      </div>
    </div>
  );
}

/* ── Hold, earn, claim — the core UX ── */

export function HoldEarnClaim() {
  const steps = [
    { n: "01", t: "The token", d: "PRISM trades like any ERC-20 on Uniswap V4. No staking, no LP wrapper, no router approval, no position to manage." },
    { n: "02", t: "Hold it", d: "Every whole PRISM you hold is a Prism NFT, and every NFT is a share of the same V4 liquidity pool. The token is the position." },
    { n: "03", t: "Claim on-chain", d: "Revenue from every swap accrues to the position in real time. Holders call claim(tokenId) or claimMany([…]) to withdraw it to the owner." },
  ];
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.3em] text-slate-500 font-semibold mb-3">
        The whole UX
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 mb-3">
        <h2 className="text-3xl md:text-4xl font-bold txt-white leading-tight">
          One token. <span className="spectrum-text-gradient">One LP position.</span>
        </h2>
        <a
          href="/claim"
          className="btn-gradient !py-2 !px-4 !text-sm shrink-0"
        >
          Claim revenue
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </a>
      </div>
      <p className="text-base text-slate-400 leading-relaxed max-w-2xl mb-8">
        PRISM is the first ERC-20 to make the fungible token and the LP share the same thing on-chain,
        through a Uniswap V4 hook. No wrapper, no staking layer, one contract.
      </p>
      <div className="grid md:grid-cols-3 gap-4">
        {steps.map((s) => (
          <div key={s.n} className="glass-card p-5">
            <div className="font-mono text-sm spectrum-text-gradient font-bold mb-2">{s.n}</div>
            <div className="text-lg font-bold txt-white mb-1.5">{s.t}</div>
            <div className="text-[13px] text-slate-400 leading-relaxed">{s.d}</div>
          </div>
        ))}
      </div>
      <p className="mt-6 text-[12px] text-slate-500 leading-relaxed max-w-2xl">
        Revenue comes from third-party swaps, so it varies and can be zero. It is not interest, a yield,
        or a return on investment, and holding PRISM gives no right to profits or to anyone&apos;s efforts.
      </p>
    </div>
  );
}

/* ── Four fee streams ── */

const STREAMS: { pct?: string; chains?: string[]; src: string; to: string; burn: boolean }[] = [
  { chains: ["Ethereum", "Base", "Robinhood"], src: "Spectrum launch fees", to: "Buy & burn PRISM", burn: true },
  { pct: "25%", chains: ["Ethereum", "Base", "Robinhood"], src: "Spectrum basket fees", to: "Buy & burn PRISM", burn: true },
  { pct: "20%", src: "Reserve revenue", to: "Buys & burns PRISM", burn: true },
  { pct: "100%", src: "PRISM pool fees, ETH side", to: "Routed to PRISM holders", burn: false },
  { pct: "80%", src: "PRISM pool fees, PRISM side", to: "Routed to PRISM holders", burn: false },
  { pct: "20%", src: "PRISM pool fees, PRISM side", to: "Burned at 0x…dEaD", burn: true },
];

function ArrowRight({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

export function FeeStreams() {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.3em] text-slate-500 font-semibold mb-3">
        How revenue flows
      </div>
      <h2 className="text-3xl md:text-4xl font-bold txt-white mb-3 leading-tight">
        Every stream feeds PRISM
      </h2>
      <p className="text-base text-slate-400 leading-relaxed max-w-2xl mb-8">
        Some streams buy PRISM and burn it; others route revenue to PRISM holders directly. Spectrum runs on
        both Ethereum and Base, where deploys and index trading revenue buy and burn PRISM. Either way, it all
        accrues to PRISM.
      </p>
      <div className="grid sm:grid-cols-2 gap-4">
        {STREAMS.map((f) => {
          const color = f.burn ? "#f97316" : "#22d3ee";
          return (
            <div key={f.src} className="glass-card p-5 flex items-center gap-4">
              <div className="w-24 text-center shrink-0">
                {f.pct ? (
                  <div className="font-mono font-bold text-3xl spectrum-text-gradient">{f.pct}</div>
                ) : (
                  <div className="flex flex-col items-stretch gap-1">
                    {f.chains?.map((ch) => (
                      <div
                        key={ch}
                        className="text-[10px] font-bold uppercase text-slate-300 rounded-full px-2 py-1 bg-white/5 border border-white/10 text-center"
                      >
                        {ch}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <div className="txt-white font-semibold">{f.src}</div>
                <div className="text-[13px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                  <ArrowRight color={color} />
                  {f.to}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Ecosystem loop ── */

const LOOP_STEPS = ["Revenue", "Buy back", "Burn", "Supply down", "To holders", "Repeat"];

export function EcosystemLoop() {
  const off = (140 / 380) * 100;
  return (
    <div className="relative w-full max-w-[360px] aspect-square mx-auto">
      <svg viewBox="0 0 380 380" className="absolute inset-0 spectrum-spin">
        <defs>
          <linearGradient id="loopGradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#06b6d4" />
            <stop offset="50%" stopColor="#a855f7" />
            <stop offset="100%" stopColor="#ef4444" />
          </linearGradient>
        </defs>
        <circle cx="190" cy="190" r="140" fill="none" stroke="url(#loopGradient)" strokeWidth="2.5" strokeDasharray="3 10" strokeLinecap="round" opacity="0.7" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-10">
        <div className="logo-font text-2xl font-bold spectrum-text-gradient">Prism</div>
        <div className="text-xs text-slate-500 mt-1 leading-snug">
          the shared
          <br />
          V4 hook
        </div>
      </div>
      {LOOP_STEPS.map((s, i) => {
        const ang = ((-90 + i * (360 / LOOP_STEPS.length)) * Math.PI) / 180;
        const left = 50 + off * Math.cos(ang);
        const top = 50 + off * Math.sin(ang);
        return (
          <div
            key={s}
            className="absolute flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold txt-white border border-white/10 bg-[#15151c]/95 whitespace-nowrap"
            style={{ left: `${left}%`, top: `${top}%`, transform: "translate(-50%, -50%)" }}
          >
            <span className="spectrum-text-gradient font-bold">{i + 1}</span>
            {s}
          </div>
        );
      })}
    </div>
  );
}

/* ── The two products ── */

const TRIO = [
  { name: "Spectrum", role: "basket launchpad", color: "#a855f7", flow: "25% of basket fees + every launch fee → buy & burn" },
  { name: "Prism pool", role: "its own market", color: "#f59e0b", flow: "100% of ETH + 80% of PRISM → holders" },
];

export function EcosystemTrio() {
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      {TRIO.map((t) => (
        <div key={t.name} className="glass-card p-5">
          <div className="h-1 w-8 rounded-full mb-3" style={{ background: t.color }} />
          <div className="text-lg font-bold txt-white">{t.name}</div>
          <div className="text-[12px] text-slate-500 mb-3">{t.role}</div>
          <div className="text-[13px] text-slate-300">{t.flow}</div>
        </div>
      ))}
    </div>
  );
}
