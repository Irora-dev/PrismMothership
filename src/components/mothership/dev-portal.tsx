"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PRISM, PRISM_LIVE } from "@/lib/chain/constants";
import { PRISM_X_URL, etherscanAddressUrl } from "@/lib/chain/token-links";
import { C, MONO, RAINBOW, glass, glow } from "./style";
import { AmbientBlooms } from "./blooms";
import { HoloPrism } from "./holo-prism";
import { BasketBento, type BentoItem } from "@/components/spectrum/basket-bento";

// ── /dev — the developer portal ──────────────────────────────────────────────
// the designer's brief, distilled across his 2026-08-03 passes: speak to EXTERNAL
// builders (any app, any stack) tying PRISM in as the value-accrual layer;
// promote Spectrum's open front-end ELEMENTS as building blocks, never
// "fork our site"; show real things (live bento, our own dapp's contract
// wiring, the PRISM CA); every code area copyable; keep the copy SHORT.
// Every claim is /contracts-verifiable.

const TERM_GREEN = "#4ade80";

// how our own dapp wires PRISM in — the verified SpectrumBasket constants
const SNIPPET = [
  ["cm", "// how our own dapp wires it in (SpectrumBasket, live on 3 chains)"],
  ["nl", ""],
  ["kw", "uint256 "], ["id", "public constant "], ["fn", "BURN_SHARE_BPS"], ["pl", " = "], ["num", "1000"], ["pl", ";  "], ["cm", "// 10% of fees → buy & burn PRISM"],
  ["nl", ""],
  ["kw", "uint256 "], ["id", "public constant "], ["fn", "INTERFACE_SHARE_BPS"], ["pl", " = "], ["num", "555"], ["pl", "; "], ["cm", "// 5.55% → the routing app"],
] as const;

const SNIPPET_RAW =
  "// how our own dapp wires it in (SpectrumBasket, live on 3 chains)\n" +
  "uint256 public constant BURN_SHARE_BPS = 1000;  // 10% of fees -> buy & burn PRISM\n" +
  "uint256 public constant INTERFACE_SHARE_BPS = 555; // 5.55% -> the routing app";

const TERMINAL_RAW =
  "curl /api/feed\ncurl /api/spectrum/charts?range=1w\ncurl /api/burn-pipeline\ncurl /api/trade/quote?dir=buy&in=0.1";

const CLONE_CMD = "git clone https://github.com/Irora-dev/Spectrum && node Spectrum/create/index.mjs";

const SNIPPET_COLORS: Record<string, string> = {
  cm: "#64748b",
  kw: C.purple,
  fn: C.cyan,
  id: "#e2e8f0",
  num: C.orange,
  pl: "#cbd5e1",
};

function CopyBtn({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        });
      }}
      className="shrink-0 rounded-md border border-white/10 px-2 py-0.5 text-[10px] font-semibold text-slate-400 transition-colors hover:border-white/25 hover:text-white"
      style={{ fontFamily: MONO }}
    >
      {done ? "Copied ✓" : label}
    </button>
  );
}

export function DevPortal() {
  // a real basket drives the elements card's mini bento — data, not decoration
  const [bento, setBento] = useState<{ items: BentoItem[]; chain: "ethereum" | "base" | "robinhood" } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/spectrum/indexes", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { indexes?: { chain: "ethereum" | "base" | "robinhood"; aumUsd: number; top?: BentoItem[] }[] }) => {
        if (!alive || !d.indexes?.length) return;
        const pick = [...d.indexes].sort((a, b) => (b.aumUsd ?? 0) - (a.aumUsd ?? 0)).find((x) => (x.top?.length ?? 0) >= 3);
        if (pick?.top?.length) setBento({ items: pick.top, chain: pick.chain });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main className="relative z-10 mx-auto w-full max-w-[1200px] space-y-14 p-4 pb-20 sm:p-6">
      <AmbientBlooms />

      {/* ── hero ── */}
      <section className="grid grid-cols-1 items-center gap-10 pt-6 lg:grid-cols-12">
        <div className="text-center lg:col-span-7 lg:text-left">
          <div
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em]"
            style={{ borderColor: `${TERM_GREEN}33`, background: "rgba(3,4,9,0.6)", color: TERM_GREEN, fontFamily: MONO }}
          >
            TERM://PRISM.DEV
          </div>
          <h1 className="mt-5 text-4xl font-black tracking-tight text-white sm:text-6xl">
            Build on{" "}
            <span style={{ background: `linear-gradient(90deg, ${C.purple}, ${C.cyan})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
              PRISM
            </span>
            .
          </h1>
          <p className="mx-auto mt-4 max-w-[480px] text-[15px] leading-relaxed text-slate-400 lg:mx-0">
            Tie any app to the token: earn fees on-chain, or turn your revenue into buy-and-burn.
          </p>
        </div>
        <div className="relative hidden justify-center lg:col-span-5 lg:flex" aria-hidden>
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 h-[230px] w-[230px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed"
            style={{ borderColor: `${C.cyan}26`, animation: "spin 24s linear infinite" }}
          />
          <div style={{ filter: `drop-shadow(0 18px 30px rgba(0,0,0,0.6)) drop-shadow(0 0 34px ${C.cyan}26)` }}>
            <HoloPrism size={150} spinSec={10} />
          </div>
        </div>
      </section>

      {/* ── two ways in ── */}
      <section>
        <h2 className="text-center text-3xl font-black tracking-tight text-white sm:text-4xl">
          Two ways <span style={{ color: C.cyan, ...glow(C.cyan) }}>in</span>
        </h2>
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* card 1 — plug PRISM into your app */}
          <div className="relative flex flex-col overflow-hidden rounded-2xl p-6" style={{ ...glass, borderTop: `2px solid ${C.orange}80` }}>
            <div className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: C.orange, fontFamily: MONO }}>
              ALREADY HAVE A PRODUCT?
            </div>
            <h3 className="mt-2 text-xl font-bold tracking-tight text-white">Plug PRISM into your app</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">One integration ties your app to the token.</p>
            <div className="mt-4 overflow-hidden rounded-xl border border-white/5" style={{ background: "rgba(3,4,9,0.7)" }}>
              <div className="flex items-center justify-between border-b border-white/5 px-3 py-1.5">
                <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-500" style={{ fontFamily: MONO }}>
                  SpectrumBasket.sol · verified
                </span>
                <CopyBtn text={SNIPPET_RAW} />
              </div>
              <pre className="overflow-x-auto px-3 py-2.5 text-[11px] leading-relaxed" style={{ fontFamily: MONO }}>
                {SNIPPET.map(([kind, text], i) =>
                  kind === "nl" ? (
                    "\n"
                  ) : (
                    <span key={i} style={{ color: SNIPPET_COLORS[kind] }}>
                      {text}
                    </span>
                  ),
                )}
              </pre>
              {PRISM_LIVE && (
                <div className="flex items-center justify-between gap-2 border-t border-white/5 px-3 py-2">
                  <span className="min-w-0 truncate text-[10.5px] text-slate-400" style={{ fontFamily: MONO }}>
                    PRISM{" "}
                    <a href={etherscanAddressUrl(PRISM)} target="_blank" rel="noopener noreferrer" className="text-slate-300 underline underline-offset-2 hover:text-white">
                      {PRISM}
                    </a>
                  </span>
                  <CopyBtn text={PRISM} label="Copy CA" />
                </div>
              )}
            </div>
            <div className="flex-1" />
            <Link
              href="/contracts"
              className="mt-5 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider transition-opacity hover:opacity-80"
              style={{ color: C.orange }}
            >
              Read the contracts
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </Link>
          </div>

          {/* card 2 — the open front-end elements (never "fork our site") */}
          <div className="relative flex flex-col overflow-hidden rounded-2xl p-6" style={{ ...glass, borderTop: `2px solid ${C.purple}80` }}>
            <div className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: C.purple, fontFamily: MONO }}>
              OPEN FRONT-END ELEMENTS
            </div>
            <h3 className="mt-2 text-xl font-bold tracking-tight text-white">Build with Spectrum&apos;s components</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Bento grids, live charts, trade flows — open-source building blocks for your own PRISM product.
            </p>
            <div className="relative mt-4 h-[132px] overflow-hidden rounded-xl border border-white/5" style={{ background: "rgba(3,4,9,0.5)" }}>
              {bento ? (
                <div className="absolute inset-2">
                  <BasketBento items={bento.items} chain={bento.chain} />
                </div>
              ) : (
                <div className="grid h-full place-items-center text-[11px] text-slate-600" style={{ fontFamily: MONO }}>
                  loading a live basket…
                </div>
              )}
              <span className="absolute right-2 top-2 rounded-md bg-white/90 px-1.5 py-0.5 text-[8px] font-extrabold uppercase tracking-wide text-black">
                one of the elements · live
              </span>
            </div>
            <div className="mt-4 rounded-xl border border-white/5 px-3 py-2.5" style={{ background: "rgba(3,4,9,0.7)" }}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 overflow-x-auto whitespace-nowrap text-[11.5px]" style={{ fontFamily: MONO, color: "#cbd5e1" }}>
                  <span style={{ color: C.purple }}>$</span> {CLONE_CMD}
                </div>
                <CopyBtn text={CLONE_CMD} />
              </div>
              <div className="mt-1.5 text-[10px] text-slate-500">or paste its START-HERE.md into your AI agent</div>
            </div>
            <div className="flex-1" />
            <a
              href="https://github.com/Irora-dev/Spectrum"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider transition-opacity hover:opacity-80"
              style={{ color: C.purple }}
            >
              github.com/Irora-dev/Spectrum
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </a>
          </div>
        </div>
      </section>

      {/* ── tie PRISM in: two mechanisms, minimum words ── */}
      <section className="relative overflow-hidden rounded-2xl p-6 sm:p-10" style={{ ...glass, border: `1px solid ${C.green}33` }}>
        <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(circle at 20% 0%, ${C.green}12 0%, rgba(0,0,0,0) 55%)` }} />
        <div className="relative z-10">
          <h2 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
            Tie PRISM into <span style={{ color: C.green, ...glow(C.green) }}>your product</span>
          </h2>

          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-white/5 p-5" style={{ background: "rgba(3,4,9,0.5)" }}>
              <div className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: C.green, fontFamily: MONO }}>
                Earn
              </div>
              <p className="mt-2 text-[14px] leading-relaxed text-slate-300">
                Route trades from your app — the contract pays your address <span className="font-bold text-white">5.55%</span> of every fee.
              </p>
              <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                <span style={{ width: "78.9%", background: "rgba(148,163,184,0.45)" }} />
                <span style={{ width: "5.55%", background: C.green }} />
                <span style={{ width: "5.55%", background: C.purple }} />
                <span style={{ width: "10%", background: C.orange }} />
              </div>
              <p className="mt-3 text-[11px] text-slate-500" style={{ fontFamily: MONO }}>
                INTERFACE_SHARE_BPS ·{" "}
                <Link href="/contracts" className="underline underline-offset-2 hover:text-slate-300">
                  verify it
                </Link>
              </p>
            </div>

            <div className="rounded-xl border border-white/5 p-5" style={{ background: "rgba(3,4,9,0.5)" }}>
              <div className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: C.orange, fontFamily: MONO }}>
                Accrue
              </div>
              <p className="mt-2 text-[14px] leading-relaxed text-slate-300">
                Send a revenue share through the burner — it buys PRISM and <span className="font-bold text-white">burns it</span>.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-white/5 px-3 py-2.5" style={{ background: "rgba(3,4,9,0.6)" }}>
                {["your fees", "burner", "buys PRISM", "0x…dEaD 🔥"].map((step, i) => (
                  <span key={step} className="flex items-center gap-2">
                    {i > 0 && (
                      <svg className="h-3.5 w-3.5 shrink-0 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                      </svg>
                    )}
                    <span
                      className="text-[12px] font-semibold"
                      style={{ fontFamily: MONO, color: i === 1 ? C.orange : i === 2 ? C.green : i === 0 ? "#cbd5e1" : "#fff" }}
                    >
                      {step}
                    </span>
                  </span>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-slate-500" style={{ fontFamily: MONO }}>
                the pattern our own dapp uses ·{" "}
                <Link href="/contracts" className="underline underline-offset-2 hover:text-slate-300">
                  the burner
                </Link>
              </p>
            </div>
          </div>

          {/* the path, one line */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[13px] font-semibold text-slate-300">
            <span>
              <span style={{ color: C.green, fontFamily: MONO }}>1</span> Build your product
            </span>
            <span className="text-slate-600">→</span>
            <span>
              <span style={{ color: C.green, fontFamily: MONO }}>2</span> Wire in a value stream
            </span>
            <span className="text-slate-600">→</span>
            <span>
              <span style={{ color: C.green, fontFamily: MONO }}>3</span> The flywheel pushes you
            </span>
          </div>
        </div>
      </section>

      {/* ── the terminal: public data, no key ── */}
      <section className="overflow-hidden rounded-2xl border border-white/10" style={{ background: "rgba(3,4,9,0.8)" }}>
        <div className="flex items-center justify-between border-b border-white/5 px-5 py-3">
          <span className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: TERM_GREEN, fontFamily: MONO }}>
            prism — bash
          </span>
          <span className="flex items-center gap-3">
            <CopyBtn text={TERMINAL_RAW} label="Copy curls" />
            <span className="flex gap-1.5" aria-hidden>
              <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
            </span>
          </span>
        </div>
        <pre className="overflow-x-auto p-5 text-[12.5px] leading-relaxed" style={{ fontFamily: MONO, color: "#cbd5e1" }}>
          <span className="text-slate-600"># public JSON, no key — the same data this site runs on</span>
          {"\n"}
          <span style={{ color: TERM_GREEN }}>$</span> curl /api/feed <span className="text-slate-600"># live events + stats</span>
          {"\n"}
          <span style={{ color: TERM_GREEN }}>$</span> curl /api/spectrum/charts?range=1w <span className="text-slate-600"># volume, fees, the split</span>
          {"\n"}
          <span style={{ color: TERM_GREEN }}>$</span> curl /api/burn-pipeline <span className="text-slate-600"># pending burns, staged</span>
          {"\n"}
          <span style={{ color: TERM_GREEN }}>$</span> curl /api/trade/quote?dir=buy&amp;in=0.1 <span className="text-slate-600"># live quotes</span>
        </pre>
      </section>

      {/* ── the close, short ── */}
      <section className="relative overflow-hidden rounded-2xl p-8 text-center sm:p-12" style={{ ...glass, border: `1px solid ${C.cyan}33` }}>
        <div className="absolute left-0 top-0 h-[2px] w-full" style={{ background: RAINBOW, opacity: 0.8 }} />
        <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(circle at 50% 0%, ${C.cyan}12 0%, rgba(0,0,0,0) 60%)` }} />
        <h2 className="relative z-10 text-3xl font-black tracking-tight text-white sm:text-4xl">
          Ship it, take a <span style={{ color: C.cyan, ...glow(C.cyan) }}>card on the wall</span>
        </h2>
        <p className="relative z-10 mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-400">
          Every holder has a reason to want your product to win.
        </p>
        <div className="relative z-10 mt-7 flex flex-wrap items-center justify-center gap-4">
          <a
            href={PRISM_X_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl px-6 py-3 text-sm font-semibold text-white transition-all duration-300 hover:brightness-110"
            style={{ background: `linear-gradient(90deg, ${C.purple}, ${C.cyan})`, boxShadow: `0 0 20px ${C.purple}4d` }}
          >
            Reach the community
          </a>
          <Link
            href="/"
            className="rounded-xl border border-white/10 px-6 py-3 text-sm font-semibold text-slate-300 transition-colors hover:border-white/20 hover:text-white"
            style={{ background: "rgba(255,255,255,0.03)" }}
          >
            See the wall
          </Link>
        </div>
      </section>
    </main>
  );
}
