"use client";

import { useEffect, useState } from "react";
import { PRISM, PRISM_LIVE } from "@/lib/chain/constants";
import { definedUrl, dexscreenerUrl } from "@/lib/chain/token-links";

// The relaunch announcement, sitting above the stats on the homepage.
//
// Direction: the site's own language — near-black ground, Playfair display serif,
// the spectrum rule, the pixel-rainbow mark — not a generic product hero. The
// token image is the exact PNG submitted to every tracker (public/token), so the
// banner and the listings show one mark.
//
// The CTA is EIP-747 `wallet_watchAsset`: the one distribution path with no
// gatekeeper, working from the moment the token exists rather than whenever a
// centralized list gets around to it.
//
// Visibility: shown once a token is wired. `?banner=preview` forces it (and
// ignores dismissal) so it can be reviewed before launch.

const LOGO = "/token/prism-logo-256.png";

function ArrowOut() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 17 17 7" />
      <path d="M7 7h10v10" />
    </svg>
  );
}
const DISMISS_KEY = "prismbeat.launch-banner.dismissed.v1";

type AddState = "idle" | "adding" | "added" | "unavailable";

interface Eip1193 {
  request: (a: { method: string; params?: unknown }) => Promise<unknown>;
}

export function LaunchBanner() {
  const [preview, setPreview] = useState(false);
  const [dismissed, setDismissed] = useState(true); // assume hidden until we've checked
  const [copied, setCopied] = useState(false);
  const [state, setState] = useState<AddState>("idle");
  // Defined.fi if someone pasted one in, else the derived DexScreener link.
  const chart = definedUrl() || dexscreenerUrl();

  useEffect(() => {
    const isPreview = new URLSearchParams(window.location.search).get("banner") === "preview";
    setPreview(isPreview);
    try {
      setDismissed(!isPreview && window.localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false); // storage blocked — show it rather than hide it
    }
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  async function addToWallet() {
    if (!PRISM_LIVE) {
      setState("unavailable"); // preview before the token exists
      return;
    }
    const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum;
    if (!eth?.request) {
      setState("unavailable");
      return;
    }
    setState("adding");
    try {
      await eth.request({
        method: "wallet_watchAsset",
        params: {
          type: "ERC20",
          options: { address: PRISM, symbol: "PRISM", decimals: 18, image: `https://prismbeat.xyz${LOGO}` },
        },
      });
      setState("added");
    } catch {
      setState("idle"); // declined in the wallet — let them try again
    }
  }

  if ((!PRISM_LIVE && !preview) || dismissed) return null;

  return (
    <div className="relative mx-auto max-w-[1180px] px-5 md:px-6">
      <div
        className="relative overflow-hidden rounded-3xl border border-white/12"
        style={{
          background:
            "radial-gradient(120% 160% at 12% 0%, rgba(124,139,255,0.16) 0%, rgba(10,14,20,0) 56%), " +
            "linear-gradient(100deg, #0d1220 0%, #0a0e14 52%, #0b0a12 100%)",
        }}
      >
        {/* the spectrum rule along the top edge — the site's signature */}
        <div
          className="absolute inset-x-0 top-0 h-[3px]"
          style={{ background: "linear-gradient(90deg,#ff5a5a,#ff9f45,#ffe14d,#5cff8f,#3bd9ff,#7c8bff,#c06aff)" }}
        />
        {/* soft bloom behind the mark */}
        <div
          className="pointer-events-none absolute -left-16 -top-16 h-64 w-64 rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(124,139,255,0.28), transparent 68%)" }}
        />

        <button
          onClick={dismiss}
          aria-label="Dismiss announcement"
          className="absolute right-4 top-4 z-20 grid h-8 w-8 place-items-center rounded-full border border-white/12 bg-white/[0.04] text-slate-300 transition-colors hover:border-white/30 hover:text-white"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>

        <div className="relative z-10 flex flex-col items-center gap-8 px-8 py-12 text-center md:flex-row md:items-center md:gap-12 md:px-16 md:py-14 md:text-left">
          {/* the token mark — the same PNG every tracker gets */}
          <div className="shrink-0">
            <div
              className="grid h-28 w-28 place-items-center rounded-full border border-white/12 md:h-36 md:w-36"
              style={{ background: "rgba(255,255,255,0.03)", boxShadow: "0 0 56px rgba(124,139,255,0.22)" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={LOGO} alt="PRISM" width={112} height={112} className="h-24 w-24 md:h-28 md:w-28" />
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold uppercase tracking-[0.28em] text-indigo-200/85">A new chapter</div>
            <h2 className="logo-font mt-4 text-3xl font-bold leading-[1.05] tracking-tight text-white sm:text-4xl md:text-5xl">
              Introducing the new and improved{" "}
              <span className="spectrum-text-gradient">Prism</span>
            </h2>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-slate-300 md:text-base">
              A fixed supply of 5,000, its own Uniswap v4 hook, and fees split on-chain. No owner, no mint,
              nothing to upgrade.
            </p>
            {/* The contract address, in full and copyable. On a launch announcement this
                is the one thing a reader most needs and most often has to go hunting for
                — and reading it off a screenshot is exactly how people get a fake token.
                Full string, not truncated, so it can be compared character by character. */}
            {PRISM_LIVE && (
              <div className="mt-6 flex flex-col items-center gap-2 md:items-start">
                <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-indigo-200/70">
                  Contract address
                </span>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(PRISM).then(
                      () => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1800);
                      },
                      () => {},
                    );
                  }}
                  title="Copy the contract address"
                  className="group flex max-w-full items-center gap-2.5 rounded-xl border border-white/12 bg-white/[0.04] px-3.5 py-2.5 transition-colors hover:border-white/30"
                >
                  <code className="min-w-0 break-all text-left text-[11.5px] leading-snug text-slate-200 sm:text-[13px]">
                    {PRISM}
                  </code>
                  <span
                    className="shrink-0 text-[11px] font-semibold"
                    style={{ color: copied ? "#5cff8f" : "rgba(226,232,240,0.6)" }}
                  >
                    {copied ? "Copied" : "Copy"}
                  </span>
                </button>
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-col items-center gap-3 md:items-end">
            <button
              onClick={addToWallet}
              disabled={state === "adding"}
              className="btn-gradient !px-6 !py-3.5 !text-[15px] disabled:opacity-70"
            >
              {state === "added" ? "Added to your wallet" : state === "adding" ? "Check your wallet…" : "Add to your wallet"}
              {state !== "added" && (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
              )}
            </button>
            {/* Chart link (R). Env-supplied rather than derived: Defined.fi's per-pool
                URL shape couldn't be verified from here, and the pool doesn't exist
                until launch, so a guessed link would 404 on the day. Preview shows a
                placeholder so the composition is still reviewable. */}
            {/* Claim (the designer): v1 holders claim their v2 PRISM on the Spectrum site. */}
            <a
              href="https://spectrumindexes.xyz/claim"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-glass !px-5 !py-3 !text-[14px]"
            >
              Claim your V2 Prism
              <ArrowOut />
            </a>
            {/* Chart. Prefers Defined.fi when NEXT_PUBLIC_PRISM_DEFINED_URL is set (their
                per-pool URL can't be derived from here); otherwise DexScreener, which IS
                derivable and has indexed the pair — so unlike before, this button now
                renders on launch day without anyone pasting a URL in first. */}
            {chart ? (
              <a href={chart} target="_blank" rel="noopener noreferrer" className="btn-glass !px-5 !py-3 !text-[14px]">
                View the chart
                <ArrowOut />
              </a>
            ) : preview ? (
              <span className="btn-glass !px-5 !py-3 !text-[14px] cursor-default opacity-55" title="Appears once a token is wired">
                View the chart
                <ArrowOut />
              </span>
            ) : null}
            {state === "unavailable" && (
              // Amber-on-dark, not gray: never gray text on a coloured ground.
              <span className="text-[12px] font-medium text-amber-200/90">
                {PRISM_LIVE ? "No browser wallet detected" : "Live once the token is wired"}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
