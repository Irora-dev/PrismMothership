"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PulseStats } from "@/lib/feed/types";
import { fmtEth, fmtPrism, fmtUsd } from "@/lib/feed/format";
import { PixelRainbow } from "@/components/effects/pixel-rainbow";
import { StartRadioButton } from "@/components/radio/start-radio";
import { useActivityFeed } from "@/hooks/useActivityFeed";
import { C, MONO, RAINBOW, glass, glow } from "./style";
import { AmbientBlooms } from "./blooms";
import { HeroVideoBackdrop } from "./hero-backdrop";
import { SwipeRow } from "./swipe-row";
import { BasketBento, type BentoItem } from "@/components/spectrum/basket-bento";

// ── The marketing face of the Mothership ─────────────────────────────────────
// Rebuilt per the designer's 0841 pass (2026-08-03): condensed two-line welcome (no
// em dashes), a bigger rainbow with LIVE revenue panels floating around it and
// the radio pill beneath, the flywheel reversed to lead with Prism itself,
// the app grid reborn as 3D collectible cards with live stats plus an empty
// submit-your-app slot, and a command-deck showcase in the closing CTA.
// Every figure is still live chain data; a marketing page invents nothing.

function Label({ dot, children }: { dot?: string; children: React.ReactNode }) {
  return (
    <h2 className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
      {dot && <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: dot }} />}
      {children}
    </h2>
  );
}

// the flywheel, Prism first (the designer: "number one should be Prism — the fees
// from actual trading and the split of that")
const FLYWHEEL: { step: string; color: string; title: string; body: string; href: string; link: string }[] = [
  {
    step: "01",
    color: "#00FF87",
    title: "Prism trades",
    body: "Every trade pays 1%. ETH side: all to holders. PRISM side: 80% holders, 20% burned.",
    href: "/charts",
    link: "Watch the split live",
  },
  {
    step: "02",
    color: "#9D00FF",
    title: "Portfolios & baskets",
    body: "A fixed 10% of every basket fee buys and burns PRISM. Portfolio joins soon.",
    href: "/spectrum",
    link: "See basket activity",
  },
  {
    step: "03",
    color: "#FF5E00",
    title: "Anyone can build",
    body: "Route a trade, earn an on-chain slice of its fee. The store is open.",
    href: "/dev",
    link: "Open the developer portal",
  },
];

// ── the collectible cards ─────────────────────────────────────────────────────
interface CardStat {
  label: string;
  value: string;
}

// fixed star positions — deterministic, no render-time randomness
const CARD_STARS: [number, number][] = [
  [12, 18], [26, 72], [38, 34], [52, 12], [64, 58], [78, 26], [86, 70], [18, 52], [70, 84], [90, 44],
];

function CardStars() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {CARD_STARS.map(([x, y], i) => (
        <span key={i} className="absolute h-px w-px rounded-full bg-white/40" style={{ left: `${x}%`, top: `${y}%` }} />
      ))}
    </div>
  );
}

function CollectibleCard({
  name,
  tagline,
  accent,
  badge,
  corner,
  art,
  texture,
  main,
  mainSlot,
  burn,
  burnNote,
  visit,
  onOpen,
}: {
  name: string;
  tagline: string;
  accent: string;
  badge?: { label: string; pulse?: boolean };
  corner?: string; // white ticker pill, the spectrum tile language
  art: React.ReactNode;
  texture?: string; // the designer's light-streak stills, revealed through gaussian blooms
  /** THE number: total fees this app has accrued for the Prism eco (the designer 2026-08-03) */
  main?: CardStat;
  /** custom content for the main slot when there is no honest number yet */
  mainSlot?: React.ReactNode;
  /** the PRISM-burn figure, where one applies */
  burn?: CardStat;
  /** plain-words burn line when there is no number yet */
  burnNote?: string;
  /** the visible action button every app card carries (the designer) */
  visit?: string;
  onOpen?: () => void;
}) {
  const [tilt, setTilt] = useState({ rx: 0, ry: 0, mx: 50, my: 30, live: false });
  const ref = useRef<HTMLDivElement>(null);

  const onMove = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    setTilt({ rx: -(py - 0.5) * 12, ry: (px - 0.5) * 12, mx: px * 100, my: py * 100, live: true });
  };
  const onLeave = () => setTilt({ rx: 0, ry: 0, mx: 50, my: 30, live: false });

  return (
    <div style={{ perspective: 900 }} onClick={onOpen} role={onOpen ? "link" : undefined} className={onOpen ? "cursor-pointer" : ""}>
      <div
        ref={ref}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        // overflow-CLIP, not hidden: hidden zeroes the box's content minimum, so a
        // plate that no longer fit amputated the visit button at the card edge
        // (the designer, 2026-08-03) — clip keeps the trim but lets the card grow instead
        className="relative flex aspect-[3/4.5] flex-col overflow-clip rounded-3xl border border-white/10"
        style={{
          ...glass,
          transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`,
          transition: tilt.live ? "none" : "transform 400ms cubic-bezier(0.16,1,0.3,1), box-shadow 400ms ease",
          transformStyle: "preserve-3d",
          boxShadow: tilt.live
            ? `0 24px 48px rgba(0,0,0,0.5), 0 0 40px ${accent}2e, inset 0 1px 0 rgba(255,255,255,0.06)`
            : "0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)",
        }}
      >
        {/* the background texture — strong, but revealed through gaussian blooms
            (a wide one pooling at the top, a small offset one for asymmetry)
            rather than a flat fade, so the still reads as light leaking through
            the glass instead of a wallpaper (the designer) */}
        {texture && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-0"
            style={{
              backgroundImage: `url(${texture})`,
              backgroundSize: "cover",
              backgroundPosition: "center top",
              maskImage:
                "radial-gradient(ellipse 130% 85% at 50% -10%, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.3) 45%, rgba(0,0,0,0) 78%), radial-gradient(ellipse 60% 40% at 82% 34%, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 70%)",
              WebkitMaskImage:
                "radial-gradient(ellipse 130% 85% at 50% -10%, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.3) 45%, rgba(0,0,0,0) 78%), radial-gradient(ellipse 60% 40% at 82% 34%, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 70%)",
            }}
          />
        )}
        {/* foil top rule */}
        <div className="absolute left-0 top-0 z-20 h-[2px] w-full" style={{ background: RAINBOW, opacity: 0.8 }} />
        {/* the sheen follows the pointer */}
        <div
          className="pointer-events-none absolute inset-0 z-20 transition-opacity duration-300"
          style={{
            background: `radial-gradient(circle at ${tilt.mx}% ${tilt.my}%, rgba(255,255,255,0.16), transparent 45%)`,
            opacity: tilt.live ? 1 : 0.35,
          }}
        />

        {/* the badges row — sits ABOVE the display window, never on the asset */}
        {badge && (
          <span
            className="absolute left-4 top-3.5 z-30 inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em]"
            style={{ borderColor: `${accent}40`, background: "rgba(3,4,9,0.66)", color: accent }}
          >
            {badge.pulse && (
              <span className="relative flex h-1 w-1">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70" style={{ background: accent }} />
                <span className="relative inline-flex h-1 w-1 rounded-full" style={{ background: accent }} />
              </span>
            )}
            {badge.label}
          </span>
        )}
        {corner && (
          <span className="absolute right-4 top-3.5 z-30 rounded-md bg-white/90 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-black shadow-[0_2px_8px_rgba(0,0,0,0.45)]">
            {corner}
          </span>
        )}

        {/* the display window — the asset presented as a product shot inside
            an inset glass frame, grounded by a floor glow (the designer: the cards
            should feel professional in how they display their assets) */}
        <div className="relative z-10 flex-1 px-4 pb-1 pt-12">
          <div
            className="relative flex h-full items-center justify-center overflow-hidden rounded-xl border border-white/[0.07]"
            style={{
              background: "linear-gradient(180deg, rgba(255,255,255,0.025) 0%, rgba(3,4,9,0.45) 100%)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -20px 34px rgba(0,0,0,0.35)",
            }}
          >
            {/* holo foil wash — barely-there spectrum sheen across the stage */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-10 opacity-[0.06]"
              style={{
                background: "conic-gradient(from 210deg at 50% 40%, #ff5a5a, #ffe14d, #5cff8f, #3bd9ff, #7c8bff, #c06aff, #ff5a5a)",
                mixBlendMode: "screen",
              }}
            />
            {/* the floor glow that grounds the asset */}
            <div
              aria-hidden
              className="pointer-events-none absolute bottom-2 left-1/2 z-0 h-10 w-3/5 -translate-x-1/2 rounded-full blur-2xl"
              style={{ background: `${accent}2e` }}
            />
            {art}
          </div>
        </div>

        {/* the plate — every row a FIXED height so titles, descriptions and
            numbers sit on the same lines across all four cards (the designer) */}
        <div className="relative z-10 border-t border-white/5 p-4" style={{ background: "rgba(3,4,9,0.78)" }}>
          <div className="absolute left-0 top-0 h-px w-full" style={{ background: `linear-gradient(90deg, ${accent}99, transparent 70%)` }} />
          <h3 className="h-7 truncate text-lg font-bold tracking-tight text-white">{name}</h3>
          <p className="mt-1 h-8 text-[11px] leading-4 text-slate-400 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
            {tagline}
          </p>
          {/* the main slot: the app's fees for the eco, BIG — or the honest
              no-number state at exactly the same height */}
          <div className="mt-4 h-[72px]">
            {main ? (
              <>
                <div className="text-[9px] uppercase tracking-[0.16em] text-slate-500">{main.label}</div>
                <div className="mt-1 truncate text-3xl font-bold tracking-tight tabular-nums" style={{ fontFamily: MONO, color: accent, ...glow(accent) }}>
                  {main.value}
                </div>
              </>
            ) : (
              mainSlot
            )}
          </div>
          {/* the burn line, aligned across cards */}
          <div className="mt-2 flex h-6 items-center gap-2">
            {burn ? (
              <>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: C.orange, boxShadow: `0 0 8px ${C.orange}` }} />
                <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{burn.label}</span>
                <span className="ml-auto text-sm font-semibold tabular-nums" style={{ fontFamily: MONO, color: C.orange }}>
                  {burn.value}
                </span>
              </>
            ) : burnNote ? (
              <span className="truncate text-[10px] text-slate-500">{burnNote}</span>
            ) : null}
          </div>
          {/* the visible visit action — same height on every card */}
          <button
            onClick={onOpen}
            className="mt-3 w-full rounded-xl border py-2.5 text-[12px] font-bold uppercase tracking-wider transition-all hover:brightness-125"
            style={{ borderColor: `${accent}4d`, background: `${accent}14`, color: accent }}
          >
            {visit ?? "Visit"} →
          </button>
        </div>
      </div>
    </div>
  );
}

export function MothershipHome() {
  const router = useRouter();
  // one live system for everything: stats at 4s cadence plus SESSION totals —
  // the same while-you-watch machinery the radio tally runs on
  const { stats, session } = useActivityFeed(4000);

  // the Baskets card wears the spectrum site's own bento (BasketBento) fed
  // LIVE weights. the designer art-directed the tile set (2026-08-03: FRONG + Index
  // out, NVDA + AAPL in), so the card shows a curated mix of real ecosystem
  // assets — each tile's weight is its live weight in whichever basket holds
  // it largest, renormalized. Falls back to the richest whole basket when the
  // curated symbols aren't in the payload.
  const [bento, setBento] = useState<{ items: BentoItem[]; chain: "ethereum" | "base" | "robinhood"; label: string } | null>(null);
  useEffect(() => {
    const CARD_MIX = ["NVDA", "AAPL", "STONKBROKER", "CASHCAT", "PONS", "WEN"];
    let alive = true;
    const load = () =>
      fetch("/api/spectrum/indexes", { cache: "no-store" })
        .then((r) => r.json())
        .then((d: { indexes?: { symbol: string; chain: "ethereum" | "base" | "robinhood"; aumUsd: number; top?: BentoItem[] }[] }) => {
          if (!alive || !d.indexes?.length) return;
          const bySym = new Map<string, BentoItem>();
          for (const ix of d.indexes) {
            for (const t of ix.top ?? []) {
              const k = t.symbol.toUpperCase();
              const prev = bySym.get(k);
              if (!prev || t.weightPct > prev.weightPct) bySym.set(k, t);
            }
          }
          const picked = CARD_MIX.map((s) => bySym.get(s)).filter((t): t is BentoItem => !!t);
          if (picked.length >= 4) {
            const total = picked.reduce((s, t) => s + t.weightPct, 0) || 1;
            setBento({
              items: picked.map((t) => ({ ...t, weightPct: (t.weightPct / total) * 100 })),
              chain: "robinhood",
              label: "LIVE MIX",
            });
            return;
          }
          const byAum = [...d.indexes].sort((a, b) => (b.aumUsd ?? 0) - (a.aumUsd ?? 0));
          const pick = byAum.find((x) => (x.top?.length ?? 0) >= 5) ?? byAum.find((x) => (x.top?.length ?? 0) >= 2) ?? byAum[0];
          if (pick?.top?.length) setBento({ items: pick.top, chain: pick.chain, label: `$${pick.symbol}` });
        })
        .catch(() => {});
    load();
    const id = setInterval(load, 120_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const ethUsd = stats?.ethUsd ?? 0;
  const prismUsd = stats?.prismUsd ?? 0;
  const lifetimeUsd = stats ? stats.feesEthTotal * ethUsd + stats.feesPrismTotal * prismUsd : 0;
  // revenue that has landed SINCE this page opened (live session tally)
  const watchUsd = session.ethVolume * ethUsd + session.indexFeesUsd;
  const burnedPct = stats && stats.cap > 0 ? (stats.totalBurned / stats.cap) * 100 : 0;
  const dash = <span className="text-slate-600">—</span>;

  return (
    <>
      {/* the gentle-light video as the hero backdrop (the designer, 2026-08-03) —
          the shared full-bleed treatment, pre-rendered boomerang loop */}
      <HeroVideoBackdrop src="/mothership/hero-bg.boom.mp4" poster="/mothership/hero-ship.webp" />

    <main className="relative z-10 mx-auto w-full max-w-[1536px] overflow-x-clip p-4 sm:p-6">
      <AmbientBlooms />

      {/* ── hero — centered on mobile/tablet per the designer's 1254 pass: title over
          two lines breaking after "A", smaller deck CTA with how-it-works as a
          ?-icon beside it, and the radio pill gone below lg ── */}
      <section className="grid grid-cols-1 items-center gap-10 py-6 lg:grid-cols-12 lg:py-8">
        <div className="flex flex-col items-center text-center lg:col-span-6 lg:items-start lg:text-left">
          <div
            className="mb-6 inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em]"
            style={{ borderColor: `${C.cyan}33`, background: `${C.cyan}14`, color: C.cyan }}
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: C.green }} />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: C.green }} />
            </span>
            The Prism ecosystem
          </div>

          {/* the designer's title (both lines plain white); below lg it breaks after
              "A" — "One token. A / Mothership of Apps." (1254) */}
          <h1 className="text-4xl font-black leading-[1.08] tracking-tighter text-white sm:text-5xl lg:text-6xl">
            <span className="lg:text-7xl xl:text-8xl">One token. Infinite apps.</span>
            <br />
            <span className="block mt-2 whitespace-nowrap text-xl font-bold tracking-tight text-slate-200 sm:text-2xl lg:text-3xl">
              Welcome to the Prism Mothership.
            </span>
          </h1>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start lg:gap-4">
            <Link
              href="/command"
              className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all duration-300 hover:brightness-110 lg:px-6 lg:py-3"
              style={{ background: `linear-gradient(90deg, ${C.purple}, ${C.cyan})`, boxShadow: `0 0 20px ${C.purple}4d` }}
            >
              Open the command deck →
            </Link>
            {/* below lg: how-it-works as the ?-icon beside the deck CTA */}
            <Link
              href="/how-it-works"
              aria-label="How it works"
              title="How it works"
              className="grid h-[42px] w-[42px] place-items-center rounded-xl border border-white/10 text-slate-300 transition-colors hover:border-white/20 hover:text-white lg:hidden"
              style={{ background: "rgba(255,255,255,0.03)" }}
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M8.9 9.5c.4-1.1 1.6-1.9 3.1-1.9 1.8 0 3.2 1.1 3.2 2.5 0 1.2-1 2.1-2.4 2.4-.5.1-.8.5-.8 1v.6m0 2.9h.01" />
              </svg>
            </Link>
            <Link
              href="/how-it-works"
              className="hidden rounded-xl border border-white/10 px-6 py-3 text-sm font-semibold text-slate-300 transition-colors hover:border-white/20 hover:text-white lg:block"
              style={{ background: "rgba(255,255,255,0.03)" }}
            >
              How it works
            </Link>
          </div>
        </div>

        {/* the rainbow, bigger, with live revenue at its side and the radio below */}
        <div className="relative hidden flex-col items-center justify-center lg:col-span-6 lg:flex">
          <div className="relative flex min-h-[440px] w-full items-center justify-center">
            {/* pointer-events-none on the rings — they were swallowing clicks
                meant for the radio pill beneath them (the designer's dead-click bug) */}
            <div
              className="pointer-events-none absolute left-1/2 top-1/2 h-[440px] w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-full border"
              style={{ borderColor: `${C.green}1a`, animation: "spin 12s linear infinite" }}
            />
            <div
              className="pointer-events-none absolute left-1/2 top-1/2 h-[330px] w-[330px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed"
              style={{ borderColor: `${C.cyan}33`, animation: "spin 20s linear reverse infinite" }}
            />
            <div
              className="pointer-events-none absolute inset-0"
              style={{ background: `radial-gradient(circle at center, ${C.purple}1f 0%, rgba(0,0,0,0) 65%)` }}
            />
            <div
              style={{
                animation: "ms-float 6s ease-in-out infinite",
                // a gentle dark dropshadow grounding it plus a soft spectrum glow
                filter: "drop-shadow(0 12px 28px rgba(0,0,0,0.6)) drop-shadow(0 0 36px rgba(150,120,255,0.5))",
              }}
            >
              <PixelRainbow className="h-44 w-auto xl:h-52" loop />
            </div>

            {/* real-time revenue while you watch — grounded darker than plain
                glass so they hold up over the bright art behind them */}
            <div className="absolute left-[10%] top-12 z-10 rounded-xl p-3.5" style={{ ...glass, background: "rgba(3,4,9,0.62)" }}>
              <Label dot={C.green}>Lifetime revenue</Label>
              <div className="text-xl font-bold tracking-tight text-white" style={glow(C.green)}>
                {stats ? fmtUsd(lifetimeUsd) : dash}
              </div>
              <div className="mt-0.5 text-[10px] text-slate-500" style={{ fontFamily: MONO }}>
                to holders · all time
              </div>
            </div>
            <div className="absolute bottom-16 right-[4%] z-10 rounded-xl p-3.5" style={{ ...glass, background: "rgba(3,4,9,0.62)" }}>
              <Label dot={C.cyan}>While you watch</Label>
              <div className="text-xl font-bold tracking-tight text-white tabular-nums" style={glow(C.cyan)}>
                ${watchUsd.toFixed(2)}
              </div>
              <div className="mt-0.5 text-[10px] text-slate-500" style={{ fontFamily: MONO }}>
                streamed since you arrived
              </div>
            </div>
          </div>
          {/* the pill sits below the rainbow, centered on its horizontal center (the designer, 2026-08-03) */}
          <StartRadioButton className="relative z-10 -mt-[72px] self-center" />
        </div>
      </section>

      {/* ── live stats band — on phones lifetime leads full-width and the two
          smaller stats pair beside each other (the designer 1254); tablet+ keeps the
          three-across row ── */}
      <section>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-6">
          <div className="col-span-2 relative overflow-hidden rounded-2xl p-6 md:col-span-1" style={{ ...glass, borderTop: `2px solid ${C.green}80` }}>
            <Label dot={C.green}>Lifetime revenue to holders</Label>
            <div className="text-4xl font-light tracking-tight text-white" style={glow(C.green)}>
              {stats ? fmtUsd(lifetimeUsd) : dash}
            </div>
            <p className="mt-2 text-xs text-slate-500" style={{ fontFamily: MONO }}>
              Ξ{stats ? fmtEth(stats.feesEthTotal) : "—"} · {stats ? fmtPrism(stats.feesPrismTotal) : "—"} PRISM
            </p>
          </div>
          <div className="relative overflow-hidden rounded-2xl p-4 md:p-6" style={{ ...glass, borderTop: `2px solid ${C.orange}80` }}>
            <Label dot={C.orange}>PRISM burnt forever</Label>
            <div className="text-2xl font-light tracking-tight text-white md:text-4xl" style={glow(C.orange)}>
              {stats ? fmtPrism(stats.totalBurned) : dash}
            </div>
            <p className="mt-2 text-xs text-slate-500" style={{ fontFamily: MONO }}>
              of {stats ? stats.cap.toLocaleString("en-US") : "5,000"} ever · {burnedPct.toFixed(2)}%
            </p>
          </div>
          <div className="relative overflow-hidden rounded-2xl p-4 md:p-6" style={{ ...glass, borderTop: `2px solid ${C.cyan}80` }}>
            <Label dot={C.cyan}>Baskets live</Label>
            <div className="text-2xl font-light tracking-tight text-white md:text-4xl" style={glow(C.cyan)}>
              {stats ? stats.indexCount : dash}
            </div>
            <p className="mt-2 text-xs text-slate-500" style={{ fontFamily: MONO }}>
              across Ethereum · Base · Robinhood
            </p>
          </div>
        </div>
      </section>

      {/* ── the app store: collectible cards ── */}
      <section className="mt-14">
        <div className="mb-8 text-center">
          <Label>Built on PRISM</Label>
          <h2 className="text-3xl font-black tracking-tight text-white sm:text-5xl">The Prism <span style={{ background: `linear-gradient(90deg, ${C.purple}, ${C.cyan})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>App Store</span></h2>
        </div>
        {/* swipeable below lg (the designer 1254): peek + fade + chevron make it obvious */}
        {/* four-across only where four fit: below ~1400px the aspect-locked cards
            get too short for art + plate (the display window collapses and the
            buttons run out of room), so lg shows a roomy 2×2 instead */}
        <SwipeRow desktopClass="lg:grid lg:grid-cols-2 [@media(min-width:1400px)]:grid-cols-[1fr_1.18fr_1.18fr_1fr] lg:items-center" itemClass="w-[78%] sm:w-[54%] md:w-[42%]">
          <CollectibleCard
            name="Prism"
            tagline="The token at the core. Pool fees stream to holders; burns only move one way."
            accent={C.green}
            badge={{ label: "Live", pulse: true }}
            texture="/mothership/cards/card-prism.webp"
            onOpen={() => router.push("/claim")}
            art={
              <>
                <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(circle at 50% 40%, ${C.green}1c 0%, rgba(0,0,0,0) 70%)` }} />
                <CardStars />
                <div
                  className="pointer-events-none absolute left-1/2 top-[52%] h-[220px] w-[220px] -translate-x-1/2 -translate-y-1/2 rounded-full border"
                  style={{ borderColor: `${C.green}1a`, animation: "spin 26s linear reverse infinite" }}
                />
                <div
                  className="pointer-events-none absolute left-1/2 top-[52%] h-[170px] w-[170px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed"
                  style={{ borderColor: `${C.green}40`, animation: "spin 16s linear infinite" }}
                />
                {/* the brand mark as a product shot: the mark, then a faint
                    mirrored reflection dying into the stage floor */}
                <div className="relative z-10 translate-y-2">
                  <div style={{ filter: `drop-shadow(0 12px 24px rgba(0,0,0,0.6)) drop-shadow(0 0 28px ${C.green}26)` }}>
                    <PixelRainbow className="h-[104px] w-auto" loop />
                  </div>
                  {/* the reflection is decor: absolute, so it never adds layout
                      height that squeezes the display window on narrow cards */}
                  <div
                    aria-hidden
                    className="absolute left-0 top-full mt-0.5 -scale-y-100 opacity-[0.14]"
                    style={{
                      maskImage: "linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 38%)",
                      WebkitMaskImage: "linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 38%)",
                    }}
                  >
                    <PixelRainbow className="h-[104px] w-auto" animate={false} />
                  </div>
                </div>
              </>
            }
            visit="Open Prism"
            main={{ label: "Fees to holders · all time", value: stats ? fmtUsd(lifetimeUsd) : "—" }}
            burn={{ label: "PRISM burnt", value: stats ? fmtPrism(stats.totalBurned) : "—" }}
          />
          <CollectibleCard
            name="Spectrum Baskets"
            tagline="One token, a whole thesis. Launch and trade baskets on three chains."
            accent={C.purple}
            badge={{ label: "Live", pulse: true }}
            corner={bento?.label}
            texture="/mothership/cards/card-baskets.webp"
            onOpen={() => window.open("https://spectrumindexes.xyz", "_blank", "noopener,noreferrer")}
            art={
              bento ? (
                // the spectrum site's own bento, presented as a product screen:
                // a touch of perspective standing on the stage floor
                <div
                  className="absolute inset-x-5 inset-y-4"
                  style={{ transform: "perspective(900px) rotateX(5deg)", transformOrigin: "50% 100%" }}
                >
                  <div
                    className="h-full w-full overflow-hidden rounded-lg"
                    style={{ boxShadow: `0 18px 36px rgba(0,0,0,0.55), 0 0 24px ${C.purple}1f` }}
                  >
                    <BasketBento items={bento.items} chain={bento.chain} />
                  </div>
                </div>
              ) : (
                <>
                  <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(circle at 50% 45%, ${C.purple}26 0%, rgba(0,0,0,0) 70%)` }} />
                  <CardStars />
                  <div className="relative z-10 grid grid-cols-3 gap-2">
                    {[0.9, 0.5, 0.7, 0.4, 1, 0.55, 0.65, 0.45, 0.8].map((o, i) => (
                      <div
                        key={i}
                        className="h-9 w-9 rounded-lg border"
                        style={{ background: `${C.purple}${Math.round(o * 60).toString(16).padStart(2, "0")}`, borderColor: `${C.purple}66` }}
                      />
                    ))}
                  </div>
                </>
              )
            }
            visit="Visit Spectrum ↗"
            main={{ label: "Fees generated · all time", value: stats ? fmtUsd(stats.indexFeesTotal * ethUsd) : "—" }}
            burn={{ label: "To the burn · 10% of fees", value: stats ? fmtUsd(stats.indexFeesTotal * ethUsd * 0.1) : "—" }}
          />
          <CollectibleCard
            name="Spectrum Portfolio"
            tagline="A whole portfolio in one buy, batched across baskets and tokens."
            accent={C.orange}
            badge={{ label: "Launching soon" }}
            texture="/mothership/cards/card-portfolio.webp"
            onOpen={() => router.push("/spectrum#portfolio")}
            art={
              <>
                <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(circle at 50% 45%, ${C.orange}1c 0%, rgba(0,0,0,0) 70%)` }} />
                <CardStars />
                {/* many orders, one buy: order bars converge into a single lit
                    block — scaled to fill the window, with its reflection */}
                <div className="relative z-10 flex -translate-y-1 flex-col items-center">
                  <div className="flex items-center gap-5">
                    <div className="flex flex-col gap-2.5">
                      {[52, 42, 60, 46].map((w, i) => (
                        <div key={i} className="h-3.5 rounded-full border border-white/10" style={{ width: w, background: "rgba(255,255,255,0.07)" }} />
                      ))}
                    </div>
                    <svg width="46" height="84" viewBox="0 0 46 84" fill="none" aria-hidden>
                      {[8, 28, 56, 76].map((y) => (
                        <path key={y} d={`M2 ${y} C 24 ${y}, 28 42, 44 42`} stroke={`${C.orange}59`} strokeWidth="1.5" />
                      ))}
                    </svg>
                    <div
                      className="grid h-[76px] w-[76px] place-items-center rounded-2xl border"
                      style={{ borderColor: `${C.orange}66`, background: `${C.orange}1f`, boxShadow: `0 14px 30px rgba(0,0,0,0.5), 0 0 32px ${C.orange}40` }}
                    >
                      <svg className="h-9 w-9" style={{ color: C.orange }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 4L4 8l8 4 8-4-8-4z M4 12l8 4 8-4 M4 16l8 4 8-4" />
                      </svg>
                    </div>
                  </div>
                </div>
              </>
            }
            mainSlot={
              <div className="flex h-full flex-col justify-center">
                <div className="text-3xl font-bold tracking-tight text-slate-600" style={{ fontFamily: MONO }}>
                  —
                </div>
                <p className="mt-1.5 text-[10px] leading-snug text-slate-500">Built and audited. It appears here the moment it is on-chain.</p>
              </div>
            }
            burnNote="Flat buy fee → buys & burns PRISM"
            visit="View the berth"
          />
          <CollectibleCard
            name="Your app here"
            tagline="The Mothership has open docking for anything that builds on PRISM."
            accent={C.cyan}
            badge={{ label: "Open dock" }}
            texture="/mothership/cards/card-dock.webp"
            onOpen={() => router.push("/dev")}
            visit="Submit your app"
            mainSlot={
              <div className="flex h-full flex-col justify-center">
                <div className="text-3xl font-bold tracking-tight text-slate-600" style={{ fontFamily: MONO }}>
                  —
                </div>
                <p className="mt-1.5 text-[10px] leading-snug text-slate-500">Open docking: your app's live numbers appear here.</p>
              </div>
            }
            burnNote="Every routed trade reserves an on-chain interface slice"
            art={
              <>
                <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(circle at 50% 45%, ${C.cyan}17 0%, rgba(0,0,0,0) 70%)` }} />
                <CardStars />
                <div
                  className="pointer-events-none absolute left-1/2 top-[46%] h-[175px] w-[175px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed"
                  style={{ borderColor: `${C.cyan}33`, animation: "spin 24s linear infinite" }}
                />
                <div
                  className="relative z-10 grid h-[92px] w-[92px] -translate-y-1 place-items-center rounded-2xl border-2 border-dashed"
                  style={{ borderColor: `${C.cyan}59`, background: `${C.cyan}0d`, boxShadow: "0 14px 30px rgba(0,0,0,0.45)" }}
                >
                  <svg className="h-8 w-8" style={{ color: C.cyan }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 4v16m8-8H4" />
                  </svg>
                </div>
              </>
            }
          />
        </SwipeRow>
      </section>

      {/* ── the flywheel cards (label removed per the designer 1254); swipeable below lg ── */}
      <section className="mt-14">
        <div className="mb-8 text-center">
          <h2 className="text-3xl font-black tracking-tight text-white sm:text-5xl">Activity feeds <span style={{ color: C.green, ...glow(C.green) }}>the token</span></h2>
        </div>
        <SwipeRow desktopClass="lg:grid lg:grid-cols-3" itemClass="w-[84%] sm:w-[62%] md:w-[46%]">
          {FLYWHEEL.map((f) => (
            <div key={f.step} className="flex h-full flex-col rounded-2xl p-6" style={{ ...glass, borderTop: `2px solid ${f.color}80` }}>
              <div className="text-2xl font-bold" style={{ fontFamily: MONO, color: f.color, ...glow(f.color) }}>
                {f.step}
              </div>
              <h3 className="mt-4 text-lg font-bold text-white">{f.title}</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-400">{f.body}</p>
              <Link
                href={f.href}
                className="mt-6 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider transition-opacity hover:opacity-80"
                style={{ color: f.color }}
              >
                {f.link}
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </Link>
            </div>
          ))}
        </SwipeRow>
      </section>

      {/* ── closing CTA: the deck, showcased ── */}
      <section className="mt-14 pb-6">
        <div className="relative overflow-hidden rounded-2xl" style={{ ...glass, border: `1px solid ${C.green}33` }}>
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: `radial-gradient(circle at 25% 50%, ${C.green}14 0%, rgba(0,0,0,0) 60%)` }}
          />
          <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2">
            {/* a miniature of the deck itself, live — fills its whole half of
                the card, edge to edge (the designer) */}
            <div
              className="flex flex-col justify-center border-b border-white/10 p-6 lg:border-b-0 lg:border-r lg:p-8"
              style={{ background: "rgba(3,4,9,0.7)" }}
            >
              <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: C.green }} />
                Command deck · live
              </div>
              {/* the core: revenue and the PRISM burn side by side (the designer) */}
              <div className="relative mt-6 flex flex-1 items-center justify-center gap-8 py-6">
                <div
                  className="absolute left-1/2 top-1/2 h-[170px] w-[170px] -translate-x-1/2 -translate-y-1/2 rounded-full border"
                  style={{ borderColor: `${C.green}26`, animation: "spin 12s linear infinite" }}
                />
                <div className="relative z-10 flex flex-col items-center">
                  <span
                    className="rounded-full border px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.16em]"
                    style={{ borderColor: `${C.green}33`, background: `${C.green}14`, color: C.green }}
                  >
                    Lifetime revenue
                  </span>
                  <div className="mt-2 text-4xl font-black tracking-tight text-white sm:text-5xl" style={glow(C.green)}>
                    {stats ? fmtUsd(lifetimeUsd) : dash}
                  </div>
                </div>
                <div className="relative z-10 flex flex-col items-center">
                  <span
                    className="rounded-full border px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.16em]"
                    style={{ borderColor: `${C.orange}33`, background: `${C.orange}14`, color: C.orange }}
                  >
                    PRISM burnt
                  </span>
                  <div className="mt-2 text-4xl font-black tracking-tight text-white sm:text-5xl" style={glow(C.orange)}>
                    {stats ? fmtPrism(stats.totalBurned) : dash}
                  </div>
                </div>
              </div>
              <div className="mt-6 rounded-xl border border-white/5 p-3 text-center" style={{ background: "rgba(10,12,20,0.6)" }}>
                <div className="text-[9px] uppercase tracking-[0.14em] text-slate-500">Baskets live</div>
                <div className="mt-1 text-sm font-semibold text-white tabular-nums" style={{ fontFamily: MONO }}>
                  {stats ? stats.indexCount : "—"}
                </div>
              </div>
            </div>

            <div className="p-6 text-center lg:p-10 lg:text-left">
              <h2 className="text-3xl font-black tracking-tight text-white sm:text-4xl">Step onto the <span style={{ color: C.cyan, ...glow(C.cyan), fontFamily: MONO, fontWeight: 700 }}>command deck</span></h2>
              <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-400 lg:mx-0">
                Every burn, trade and launch, live as it lands.
                <br className="hidden sm:block" />
                The deck is the Mothership&apos;s data heart.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-4 lg:justify-start">
                <Link
                  href="/command"
                  className="rounded-xl px-6 py-3 text-sm font-semibold text-white transition-all duration-300 hover:brightness-110"
                  style={{ background: `linear-gradient(90deg, ${C.purple}, ${C.cyan})`, boxShadow: `0 0 20px ${C.purple}4d` }}
                >
                  Open the deck
                </Link>
                <Link
                  href="/claim"
                  className="rounded-xl border border-white/10 px-6 py-3 text-sm font-semibold text-slate-300 transition-colors hover:border-white/20 hover:text-white"
                  style={{ background: "rgba(255,255,255,0.03)" }}
                >
                  Claim your fees
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
    </>
  );
}
