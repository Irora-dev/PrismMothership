"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PixelRainbow } from "@/components/effects/pixel-rainbow";
import { StartRadioButton } from "@/components/radio/start-radio";
import { SiteTicker } from "@/components/pulse/site-ticker";
import { MothershipIntro } from "./intro";
import { C } from "./style";
import { WalletProvider, useWallet } from "@/lib/wallet/context";
import { PRISM_TG_URL, PRISM_X_URL, dexscreenerUrl } from "@/lib/chain/token-links";

const DEXSCREENER = dexscreenerUrl(); // null until a PRISM token is wired

// ── The Mothership shell: brand bar on top, grouped icon rail on the left ────
// the designer's 0841 pass (2026-08-03): Charts moves up beside Command; the rail
// gains divider groups ("Ecosystem activity", "Developer ecosystem"); the
// Robinhood tab is delisted (the page stays live by URL); and Connect Wallet
// lives globally in the top-right menu, not per page. The rail is icons-only
// at 72px and expands on hover; below lg the same routes render as pills.
// Styling is inline per the repo's Tailwind-v4 lesson.

const glass: React.CSSProperties = {
  background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  borderBottom: "1px solid rgba(255,255,255,0.05)",
};

interface NavItem {
  label: string;
  href: string;
  icon: string;
  /** small pill after the label, e.g. "Coming soon" — never a Link when disabled */
  badge?: string;
  disabled?: boolean;
}

// dev-only entries are filtered out of production builds (NODE_ENV is inlined)
const DEV_ONLY = new Set(["/setup"]);
const NAV_GROUPS: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { label: "Home", href: "/", icon: "M3 12l9-8 9 8M5 10v10a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V10" },
      { label: "How it works", href: "/how-it-works", icon: "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
      { label: "Command", href: "/command", icon: "M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" },
      // right below Command (the designer, 2026-08-15) — the two live decks read as a pair
      { label: "Money Map", href: "/flow", icon: "M4 7h6c4 0 4 5 8 5h2m-2 0h2M4 12h4c4 0 6 5 10 5h2M4 17h3" },
      { label: "Trade", href: "/trade", icon: "M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" },
      { label: "Claim", href: "/claim", icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
    ],
  },
  {
    items: [
      { label: "Radio", href: "/radio", icon: "M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" },
      { label: "Studio", href: "/studio", icon: "M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485" },
      { label: "Links", href: "/links", icon: "M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" },
    ],
  },
  {
    title: "Ecosystem activity",
    items: [
      { label: "Spectrum Ecosystem", href: "/spectrum", icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" },
      { label: "Burn crank", href: "/burn", icon: "M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" },
      // Lightrunner's own on-chain analytics page doesn't exist yet — the game
      // itself is live at playlightrunner.com (the App Store card links there).
      // disabled: true so the rail renders a label, never a Link to nowhere.
      { label: "Lightrunner Analytics", href: "/lightrunner", icon: "M13 10V3L4 14h7v7l9-11h-7z", badge: "Coming soon", disabled: true },
    ],
  },
  {
    title: "Developer ecosystem",
    items: [
      { label: "Developer portal", href: "/dev", icon: "M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
      { label: "Contracts", href: "/contracts", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
      { label: "Setup / integrate", href: "/setup", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
    ],
  },
];

function NavIcon({ d, className = "h-5 w-5 min-w-[20px]" }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={d} />
    </svg>
  );
}

// ── the mobile bottom menu (the designer's mobile sweep, 2026-08-03) ────────────────
// Five primary destinations always at thumb reach + a More sheet carrying the
// rest of the fleet. Fixed, glass, safe-area aware; the rail stays desktop.
if (process.env.NODE_ENV === "production") for (const g of NAV_GROUPS) g.items = g.items.filter((i) => !DEV_ONLY.has(i.href));

// picked by HREF, not position — the positional indexes silently pointed at the
// wrong entries twice as the groups were rearranged
const navByHref = new Map(NAV_GROUPS.flatMap((g) => g.items).map((i) => [i.href, i]));
const pick = (href: string): NavItem => navByHref.get(href)!;
const BOTTOM_PRIMARY: NavItem[] = ["/", "/command", "/trade", "/claim", "/radio"].map(pick);
const BOTTOM_MORE: NavItem[] = ["/how-it-works", "/studio", "/links", "/spectrum", "/flow", "/burn", "/dev", "/contracts"].map(pick);

function BottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = BOTTOM_MORE.some((n) => n.href === pathname);

  // Escape closes the sheet — it shows below lg, which includes NARROW DESKTOP
  // windows where a keyboard is real (the fee pipeline's overlay already
  // follows this rule; this sheet had backdrop-tap and route-change only)
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  return (
    <>
      {/* the More sheet — slides above the bar, dismisses on backdrop tap */}
      {moreOpen && (
        <div className="fixed inset-0 z-[70] lg:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0" style={{ background: "rgba(3,4,9,0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }} />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-white/10 px-4 pt-5"
            style={{
              background: "rgba(8,10,16,0.97)",
              paddingBottom: "calc(88px + env(safe-area-inset-bottom))",
              animation: "ms-sheet-up 0.3s cubic-bezier(0.16,1,0.3,1) both",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15" aria-hidden />
            <div className="grid grid-cols-3 gap-2">
              {BOTTOM_MORE.map((n) => {
                const active = pathname === n.href;
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    onClick={() => setMoreOpen(false)}
                    className={`flex flex-col items-center gap-2 rounded-2xl border px-2 py-4 text-center ${
                      active ? "border-white/20 bg-white/10 text-white" : "border-white/5 bg-white/[0.03] text-slate-400"
                    }`}
                  >
                    <NavIcon d={n.icon} className="h-5 w-5" />
                    <span className="text-[11px] font-medium leading-tight">{n.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <nav
        className="fixed inset-x-0 bottom-0 z-[80] lg:hidden"
        style={{
          background: "rgba(3,4,9,0.88)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
        aria-label="Primary"
      >
        <div className="mx-auto grid h-[68px] max-w-[560px] grid-cols-6">
          {BOTTOM_PRIMARY.map((n) => {
            const active = pathname === n.href;
            return (
              <Link key={n.href} href={n.href} onClick={() => setMoreOpen(false)} className="flex flex-col items-center justify-center gap-1">
                <NavIcon d={n.icon} className={`h-[22px] w-[22px] ${active ? "" : "opacity-70"}`} />
                <span
                  className="text-[9px] font-semibold uppercase tracking-[0.08em]"
                  style={{ color: active ? C.cyan : "rgba(148,163,184,0.8)" }}
                >
                  {n.label}
                </span>
                <span
                  aria-hidden
                  className="h-0.5 w-5 rounded-full"
                  style={{ background: active ? C.cyan : "transparent", boxShadow: active ? `0 0 8px ${C.cyan}` : undefined }}
                />
              </Link>
            );
          })}
          <button onClick={() => setMoreOpen((o) => !o)} className="flex flex-col items-center justify-center gap-1" aria-expanded={moreOpen}>
            <NavIcon d="M5 12h.01M12 12h.01M19 12h.01" className={`h-[22px] w-[22px] ${moreOpen || moreActive ? "" : "opacity-70"}`} />
            <span
              className="text-[9px] font-semibold uppercase tracking-[0.08em]"
              style={{ color: moreOpen || moreActive ? C.cyan : "rgba(148,163,184,0.8)" }}
            >
              More
            </span>
            <span
              aria-hidden
              className="h-0.5 w-5 rounded-full"
              style={{ background: moreOpen || moreActive ? C.cyan : "transparent", boxShadow: moreOpen || moreActive ? `0 0 8px ${C.cyan}` : undefined }}
            />
          </button>
        </div>
      </nav>
    </>
  );
}

// the global wallet control, top-right of the brand bar (the designer's 0841 call)
function ConnectControl() {
  const { account, openPicker } = useWallet();
  if (account) {
    return (
      <button
        onClick={openPicker}
        className="whitespace-nowrap rounded-lg border border-white/10 px-4 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:border-white/25"
        style={{ background: "rgba(255,255,255,0.04)", fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}
        title="Connected · click to switch wallets"
      >
        {account.slice(0, 6)}…{account.slice(-4)}
      </button>
    );
  }
  return (
    <button
      onClick={openPicker}
      className="whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-all duration-300 hover:brightness-110 sm:px-6"
      style={{ background: `linear-gradient(90deg, ${C.purple}, ${C.cyan})`, boxShadow: `0 0 20px ${C.purple}4d` }}
    >
      {/* short label below sm so the brand title keeps its room */}
      <span className="sm:hidden">Connect</span>
      <span className="hidden sm:inline">Connect wallet</span>
    </button>
  );
}

/** Off-screen until focused, then a real button in the corner.
 *
 *  Driven by state and inline styles rather than Tailwind's sr-only/focus
 *  variants, which rendered but never revealed on focus here — and a skip link
 *  that stays hidden when focused is worse than none, because the keyboard
 *  visitor now has an invisible stop in their tab order that appears to do
 *  nothing. Inline is also this codebase's own law for exactly this reason. */
function SkipLink() {
  const [focused, setFocused] = useState(false);
  const hidden: React.CSSProperties = {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    overflow: "hidden",
    clip: "rect(0,0,0,0)",
    whiteSpace: "nowrap",
    border: 0,
  };
  const shown: React.CSSProperties = {
    position: "fixed",
    left: 16,
    top: 16,
    zIndex: 200,
    padding: "8px 16px",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 700,
    color: "#fff",
    background: `linear-gradient(90deg, ${C.cyan}, ${C.purple})`,
    boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
  };
  return (
    <a href="#main-content" onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={focused ? shown : hidden}>
      Skip to content
    </a>
  );
}

function ShellFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [railOpen, setRailOpen] = useState(false);

  return (
    <div className="min-h-screen" style={{ background: "#030409" }}>
      {/* FIRST focusable thing in the document, which is the entire point: every
          page opens with a rail, a top bar and a nav group, so a keyboard or
          screen-reader visitor tabbed through all of it on every navigation
          before reaching what they came for. Placed anywhere later it is just an
          invisible stop in the tab order that appears to do nothing. */}
      <SkipLink />
      <MothershipIntro />
      {/* ── brand bar: the wordmark is GONE (the designer, 2026-08-07, ex-branding-
          advisor eye — supersedes the 08-03 "title stays on top" ruling). The
          mark plus the blinking SYSTEM ONLINE is the whole identity, very
          spaceship, and losing the text line lets the bar sit lower. The name
          survives for screen readers in the link's aria-label. ── */}
      <nav className="sticky top-0 z-50 px-4 py-2.5 sm:px-6" style={glass}>
        <div className="mx-auto flex max-w-[1536px] items-center justify-between gap-4">
          <Link href="/" className="flex min-w-0 items-center gap-3 sm:gap-4" aria-label="The Prism Mothership, home">
            {/* the mark rides bare — no box, a little bigger, breathing
                forward-and-back forever (the designer, 2026-08-03) */}
            <PixelRainbow className="h-7 w-auto shrink-0 sm:h-8" loop />
            {/* now the only label in the slot, so it carries a slightly larger size */}
            <span className="flex items-center gap-1.5 text-[10px] font-medium tracking-[0.2em] sm:text-[11px]" style={{ color: C.cyan }}>
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: C.green }} />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: C.green }} />
              </span>
              SYSTEM ONLINE
            </span>
          </Link>

          <div className="flex items-center gap-3">
            {/* radio start/stop lives in the menu too (the designer, 2026-08-03) */}
            <div className="hidden xl:block">
              <StartRadioButton />
            </div>
            {/* PRISM's live DexScreener pair, as its icon (the designer, 2026-08-03) */}
            {DEXSCREENER && (
              <a
                href={DEXSCREENER}
                target="_blank"
                rel="noopener noreferrer"
                title="PRISM on DexScreener"
                className="hidden h-[42px] w-[42px] items-center justify-center rounded-lg border border-white/10 transition-colors hover:border-white/25 sm:flex"
                style={{ background: "rgba(255,255,255,0.04)" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/mothership/dexscreener.png" alt="DexScreener" className="h-5 w-5" />
              </a>
            )}
            {/* the community group, same chip as DexScreener — the designer (2026-08-14):
                he only found the Telegram by accident, because its one link on
                the site was buried on /links */}
            <a
              href={PRISM_TG_URL}
              target="_blank"
              rel="noopener noreferrer"
              title="The Prism community on Telegram"
              aria-label="The Prism community on Telegram"
              className="hidden h-[42px] w-[42px] items-center justify-center rounded-lg border border-white/10 text-slate-300 transition-colors hover:border-white/25 hover:text-white sm:flex"
              style={{ background: "rgba(255,255,255,0.04)" }}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-5 w-5">
                <path d="M21.94 4.6 18.9 19.04c-.23 1.02-.84 1.27-1.7.79l-4.7-3.47-2.27 2.18c-.25.25-.46.46-.94.46l.33-4.78 8.7-7.86c.38-.34-.08-.53-.59-.19L6.78 13.2l-4.64-1.45c-1.01-.32-1.03-1.01.21-1.5l18.14-6.99c.84-.31 1.57.2 1.3 1.34z" />
              </svg>
            </a>
            <a
              href={PRISM_X_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden whitespace-nowrap rounded-lg border border-white/10 px-4 py-2.5 text-sm font-semibold text-slate-300 transition-colors hover:border-white/25 hover:text-white sm:block"
              style={{ background: "rgba(255,255,255,0.04)" }}
            >
              PRISM on X
            </a>
            <ConnectControl />
          </div>
        </div>
      </nav>

      {/* ── the grouped icon rail ── */}
      <aside
        onMouseEnter={() => setRailOpen(true)}
        onMouseLeave={() => setRailOpen(false)}
        className="fixed bottom-0 left-0 top-[73px] z-40 hidden flex-col overflow-y-auto overflow-x-hidden py-6 transition-all duration-300 lg:flex"
        style={{
          width: railOpen ? 256 : 72,
          background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)",
          backdropFilter: "blur(20px)",
          borderRight: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <div className="flex-1 px-3">
          {NAV_GROUPS.map((g, gi) => (
            <div key={gi}>
              {gi > 0 && (
                <div className="my-3 px-1">
                  <div className="h-px w-full bg-white/10" />
                  {g.title && (
                    <div
                      className="mt-3 whitespace-nowrap px-2 text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-500 transition-opacity"
                      style={{ opacity: railOpen ? 1 : 0, height: railOpen ? "auto" : 0, marginTop: railOpen ? 12 : 0, overflow: "hidden" }}
                    >
                      {g.title}
                    </div>
                  )}
                </div>
              )}
              <div className="space-y-2">
                {g.items.map((n) => {
                  const active = pathname === n.href;
                  // flex-wrap, not nowrap: "Lightrunner Analytics" is already the
                  // rail's longest label, and its badge pill had nowhere to go but
                  // overflow past the 256px rail edge (measured: 37px past it).
                  // Wrapping only kicks in when a row is actually too tight — every
                  // shorter label+badge combination still sits on one line.
                  const inner = (
                    <>
                      <NavIcon d={n.icon} />
                      <span
                        className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium transition-opacity"
                        style={{ opacity: railOpen ? 1 : 0 }}
                      >
                        <span className="whitespace-nowrap">{n.label}</span>
                        {n.badge && (
                          <span
                            className="shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                            style={{ borderColor: `${C.orange}40`, background: `${C.orange}14`, color: C.orange }}
                          >
                            {n.badge}
                          </span>
                        )}
                      </span>
                    </>
                  );
                  // disabled = no page to send anyone to yet: a span, never a Link
                  if (n.disabled) {
                    return (
                      <div key={n.href} className="flex w-full cursor-default items-center gap-4 rounded-xl px-3 py-3 text-slate-500">
                        {inner}
                      </div>
                    );
                  }
                  return (
                    <Link
                      key={n.href}
                      href={n.href}
                      className={`flex w-full items-center gap-4 rounded-xl px-3 py-3 transition-all ${
                        active ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white"
                      }`}
                      style={active ? { boxShadow: "0 0 15px rgba(255,255,255,0.1)" } : undefined}
                    >
                      {inner}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* content shifts right of the rail on desktop; relative so full-bleed
          page backdrops (the home hero) can span the whole content region.
          Below lg the bottom menu owns the last 68px + safe area. */}
      <div id="main-content" className="relative pb-[calc(68px+env(safe-area-inset-bottom))] lg:pb-0 lg:pl-[72px]">
        {/* the live wire, site-wide: real on-chain events scrolling under the
            bar on every page (the designer greenlit 2026-08-15). Inside main-content
            so it shares the rail offset; renders nothing until the feed answers. */}
        <SiteTicker />
        {children}
      </div>

      {/* the mobile bottom menu */}
      <BottomNav />
    </div>
  );
}

export function MothershipShell({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <ShellFrame>{children}</ShellFrame>
    </WalletProvider>
  );
}
