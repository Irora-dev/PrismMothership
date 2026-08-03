"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PixelRainbow } from "@/components/effects/pixel-rainbow";
import { useRadio } from "@/components/radio/radio-provider";
import { uniswapUrl } from "@/lib/chain/token-links";
import { PRISM_X_URL } from "@/lib/chain/token-links";

const UNISWAP = uniswapUrl(); // null until the new PRISM token is wired (env)
const X_URL = PRISM_X_URL;

const LINKS: { href: string; label: string; cycle?: boolean }[] = [
  { href: "/spectrum", label: "Spectrum" },
  { href: "/charts", label: "Charts" },
  { href: "/claim", label: "Claim" },
  { href: "/contracts", label: "Contracts" },
  { href: "/how-it-works", label: "How it works", cycle: true },
  { href: "/studio", label: "Studio" },
  { href: "/links", label: "Links" },
];

function ArrowUpRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 17 17 7" />
      <path d="M7 7h10v10" />
    </svg>
  );
}

// three-arrow recycle loop — the ecosystem mark
function CycleIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 19H4.815a1.83 1.83 0 0 1-1.57-.881 1.785 1.785 0 0 1-.004-1.784L7.196 9.5" />
      <path d="M11 19h8.203a1.83 1.83 0 0 0 1.556-.89 1.784 1.784 0 0 0 0-1.775l-1.226-2.12" />
      <path d="m14 16-3 3 3 3" />
      <path d="M8.293 13.596 7.196 9.5 3.1 10.598" />
      <path d="m9.344 5.811 1.093-1.892A1.83 1.83 0 0 1 11.985 3a1.784 1.784 0 0 1 1.546.888l3.943 6.843" />
      <path d="m13.378 9.633 4.096 1.098 1.097-4.096" />
    </svg>
  );
}

// compact radio control in the nav — play/pause + the station that's on air
function RadioMini() {
  const radio = useRadio();
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        onClick={radio.toggle}
        aria-label={radio.playing ? "Pause radio" : "Play radio"}
        className="grid place-items-center w-7 h-7 rounded-full border border-white/10 bg-white/5 text-slate-200 hover:border-white/25 hover:text-white transition-colors"
      >
        {radio.loading ? (
          <span className="w-3 h-3 rounded-full border-2 border-white/20 border-t-white/70 animate-spin" />
        ) : radio.playing ? (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
      <Link href="/radio" className="hidden sm:flex items-center gap-1.5 group" title="Open Prism Radio">
        {radio.playing && (
          <span className="flex items-end gap-[2px] h-3" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span key={i} className="w-[2px] bg-emerald-400 rounded-full" style={{ height: "100%", transformOrigin: "bottom", animation: `radio-eq 0.9s ease-in-out ${i * 0.18}s infinite` }} />
            ))}
          </span>
        )}
        <span className="text-[11px] font-semibold text-slate-400 group-hover:text-white transition-colors max-w-[110px] truncate">
          {radio.playing ? radio.title : "Radio"}
        </span>
      </Link>
    </div>
  );
}

/**
 * Shared top navigation for every Prismbeat page. Must render *inside* the
 * `.spectrum-root` wrapper so the scoped design tokens (logo-font, btn-gradient,
 * pulse-live-dot) apply. Sticky + translucent so content scrolls under it.
 */
// The Robinhood feather glyph, reused by the desktop pill and the mobile menu row.
function RobinhoodGlyph({ width = 12, height = 15 }: { width?: number; height?: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 65 84" fill="currentColor" aria-hidden>
      <path d="M41.2967 18.946H24.3318C23.7179 18.946 23.1598 19.1707 22.7692 19.7325L10.6035 34.9005C8.81775 37.1477 8.3713 39.2262 8.3713 42.2037V57.7088C4.40909 68.8882 1.89783 76.4722 0.0562398 83.3259C-0.111178 83.7753 0.112046 84 0.502686 84H2.34428C2.67911 84 2.95814 83.8315 3.12556 83.5506C17.0212 47.9338 32.1446 30.294 41.6316 19.7325C42.0222 19.2831 41.8548 18.946 41.2967 18.946Z" />
      <path d="M41.7991 1.47599C40.7388 1.98159 40.1807 2.09394 39.0646 3.10515C34.0421 7.43084 30.6937 10.8577 27.5128 14.2284C27.1222 14.6216 27.2896 15.0149 27.8476 15.0149H46.6542C48.3842 15.0149 49.3887 16.0261 49.3887 17.7676V39.1152C49.3887 39.6769 49.8351 39.8455 50.1699 39.3399L61.4985 24.4527C63.3401 22.0371 63.8982 21.3068 64.4004 17.9361C65.0701 12.9924 64.6795 5.40844 61.7217 2.26248C59.0989 -0.546415 47.268 -0.658771 41.7991 1.47599Z" />
      <path d="M44.6454 23.2157C32.982 36.3051 23.8856 50.0687 15.4589 66.6412C15.2357 67.0906 15.5147 67.4277 16.017 67.2591L33.4284 61.8661C35.3816 61.3605 36.4977 60.4616 37.4464 58.8886L45.2034 46.0239C45.3709 45.6868 45.4267 45.2936 45.4267 45.0127V23.5528C45.4267 22.991 45.036 22.7663 44.6454 23.2157Z" />
    </svg>
  );
}

function XGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function TopNav() {
  const pathname = usePathname();
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  // Mobile burger dropdown. The full link row needs ~1000px, so everything
  // below lg collapses into it — the old wrap-less row was what dragged the
  // whole page sideways on phones.
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="nav-drop sticky top-0 z-40 border-b border-white/10 bg-[#0a0e14]/92">
      <nav className="mx-auto max-w-[1520px] px-4 md:px-6 h-14 flex items-center justify-between gap-2">
        {/* brand → home + the radio mini-player */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0 min-w-0">
          <Link href="/" className="flex items-center gap-2" aria-label="Prism Mothership home">
            <PixelRainbow animate={false} glow={false} className="h-5 sm:h-6 w-auto" />
            <span className="logo-font text-lg sm:text-xl font-bold txt-white tracking-tight leading-none">Prism Mothership</span>
          </Link>
          <span className="h-5 w-px bg-white/10 hidden sm:block" />
          <RadioMini />
        </div>

        {/* primary destinations — Robinhood leads, bigger and in the chain's acid yellow */}
        <div className="hidden lg:flex items-center gap-1.5">
          <Link
            href="/robinhood"
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[15px] font-bold tracking-tight transition-transform hover:scale-[1.05]"
            style={
              pathname.startsWith("/robinhood")
                ? { background: "#CCFF00", color: "#0b0b0d" }
                : { color: "#CCFF00", border: "1px solid rgba(204,255,0,0.45)", background: "rgba(204,255,0,0.08)" }
            }
          >
            <RobinhoodGlyph />
            Robinhood
          </Link>
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`inline-flex items-center gap-1.5 text-[13px] font-semibold rounded-full px-3 py-1.5 transition-colors ${
                active(l.href) ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              {l.cycle && <CycleIcon />}
              {l.label}
            </Link>
          ))}
        </div>

        {/* actions */}
        <div className="hidden lg:flex items-center gap-2 shrink-0">
          <a
            href={X_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Prism on X"
            className="grid place-items-center w-8 h-8 rounded-full border border-white/10 text-slate-300 hover:text-white hover:border-white/25 transition-colors"
          >
            <XGlyph />
          </a>
          {UNISWAP && (
            <a href={UNISWAP} target="_blank" rel="noopener noreferrer" className="btn-gradient !py-1.5 !px-3.5 !text-[13px]">
              View PRISM
              <ArrowUpRight />
            </a>
          )}
        </div>

        {/* mobile: the burger — everything lives in the dropdown */}
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          className="lg:hidden grid place-items-center w-9 h-9 rounded-full border border-white/10 bg-white/5 text-slate-200 hover:border-white/25 transition-colors shrink-0"
        >
          {open ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          )}
        </button>
      </nav>

      {/* mobile dropdown — a clean full-width sheet under the bar */}
      {open && (
        <>
          {/* tap-away backdrop (sits under the sheet, over the page) */}
          <div className="fixed inset-0 top-14 bg-black/50 backdrop-blur-[2px] lg:hidden" onClick={() => setOpen(false)} aria-hidden />
          <div
            id="mobile-nav-menu"
            className="absolute inset-x-0 top-full lg:hidden border-b border-white/10 bg-[#0a0e14]/97 backdrop-blur-xl shadow-2xl"
            style={{ animation: "nav-menu-in 0.16s ease-out" }}
          >
            <div className="px-4 py-3 max-h-[calc(100dvh-3.5rem)] overflow-y-auto">
              <Link
                href="/robinhood"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded-xl px-3.5 py-3 text-[15px] font-bold tracking-tight"
                style={
                  pathname.startsWith("/robinhood")
                    ? { background: "#CCFF00", color: "#0b0b0d" }
                    : { color: "#CCFF00", border: "1px solid rgba(204,255,0,0.35)", background: "rgba(204,255,0,0.07)" }
                }
              >
                <RobinhoodGlyph width={14} height={17} />
                Robinhood
              </Link>
              <div className="mt-2 space-y-0.5">
                {LINKS.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-[15px] font-semibold transition-colors ${
                      active(l.href) ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    {l.cycle && <CycleIcon />}
                    {l.label}
                  </Link>
                ))}
                <Link
                  href="/radio"
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-[15px] font-semibold transition-colors ${
                    active("/radio") ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  Radio
                </Link>
              </div>
              <div className="my-3 h-px bg-white/10" />
              <div className="flex items-center gap-2.5 pb-1.5">
                {UNISWAP && (
                  <a href={UNISWAP} target="_blank" rel="noopener noreferrer" className="btn-gradient flex-1 justify-center !py-2.5 !text-[14px]" onClick={() => setOpen(false)}>
                    View PRISM
                    <ArrowUpRight />
                  </a>
                )}
                <a
                  href={X_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Prism on X"
                  onClick={() => setOpen(false)}
                  className="grid place-items-center w-11 h-11 rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 hover:text-white hover:border-white/25 transition-colors shrink-0"
                >
                  <XGlyph />
                </a>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
