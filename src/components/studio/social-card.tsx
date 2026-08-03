"use client";

import { forwardRef, useRef, type CSSProperties, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { PixelRainbow } from "@/components/effects/pixel-rainbow";
import { squarify } from "@/lib/spectrum/treemap";
import { tokenVisual } from "@/lib/spectrum/token-visual";

// The 1200×630 social-post card — the live design surface for the auto-share
// bot's images (burn / launch / big-buy). Three variants share one frame; the
// Studio edits every field. Rendered at fixed pixel size (the Studio scales the
// whole card for preview + 2× PNG export), and the composition is a STATIC
// squarified treemap (no ResizeObserver) so it captures deterministically.
//
// Every element is absolutely placed at a per-variant default and can be DRAGGED
// (translate) + RESIZED (corner handle → scale). Each variant carries a mascot
// bottom-left (transparent PNG in /public/mascots) with a neon halo, over a
// tinted, glowy, social-media-style backdrop.
//
// Once we're happy with a variant here, the same layout ports into the bot's
// dynamic OG route (/api/og/<variant>) so X + Telegram show this exact card.

export const SOCIAL_W = 1200;
export const SOCIAL_H = 630;

export type SocialVariant = "burn" | "launch" | "buy";
export type SocialElId = "brand" | "chip" | "copy" | "bento" | "mascot";
export interface SocialElPos {
  x: number; // drag offset, card-space px
  y: number;
  scale?: number; // resize multiplier (default 1), grown from the element's anchor
}
export type SocialLayout = Partial<Record<SocialElId, SocialElPos>>;

export interface SocialBentoItem {
  symbol: string;
  address: string;
  weightPct: number;
}

const SERIF = '"Playfair Display", Georgia, serif'; // brand wordmark
const GROTESK = '"Space Grotesk", "Plus Jakarta Sans", ui-sans-serif, sans-serif'; // big numbers
const SANS = '"Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif'; // title / caption / chip
const MONO = '"Space Grotesk", "SF Mono", ui-monospace, monospace'; // bento tickers

// Per-variant identity: label + emoji + a color system (accent + a secondary for
// gradients/blooms) + the card's own tinted backdrop.
const VARIANT: Record<
  SocialVariant,
  { label: string; emoji: string; accent: string; accent2: string; bgFrom: string; bgVia: string; bgTo: string; bloom: string }
> = {
  burn: { label: "Buy & Burn", emoji: "🔥", accent: "#fb923c", accent2: "#f43f5e", bgFrom: "#1e1206", bgVia: "#0b0708", bgTo: "#040305", bloom: "rgba(249,115,22,0.6)" },
  launch: { label: "New Launch", emoji: "🚀", accent: "#38bdf8", accent2: "#818cf8", bgFrom: "#0a1328", bgVia: "#080611", bgTo: "#040308", bloom: "rgba(56,189,248,0.55)" },
  buy: { label: "Big Buy", emoji: "🐋", accent: "#34d399", accent2: "#22d3ee", bgFrom: "#06160f", bgVia: "#060810", bgTo: "#040307", bloom: "rgba(52,211,153,0.55)" },
};

// Default placement per variant (absolute, card-space px). A drag adds a
// translate offset on top of these; a resize adds a scale. "Reset layout"
// clears both back to this baseline. Mascot lives bottom-left; content clears
// it. `origin` is the anchor a resize grows from (and the corner the resize
// handle sits opposite to), so each element scales away from its fixed edge.
type ElOrigin = "top left" | "top right" | "bottom left";
type ElBase = Pick<CSSProperties, "left" | "right" | "top" | "bottom"> & { width?: number; origin?: ElOrigin };
const BASE: Record<SocialVariant, Partial<Record<SocialElId, ElBase>>> = {
  burn: {
    brand: { left: 56, top: 48, origin: "top left" },
    chip: { right: 56, top: 52, origin: "top right" },
    copy: { left: 408, top: 148, width: 720, origin: "top left" },
    mascot: { left: 44, bottom: 40, width: 300, origin: "bottom left" },
  },
  launch: {
    brand: { left: 56, top: 48, origin: "top left" },
    chip: { right: 56, top: 52, origin: "top right" },
    copy: { left: 386, top: 130, width: 374, origin: "top left" },
    bento: { left: 784, top: 126, origin: "top left" },
    mascot: { left: 48, bottom: 44, width: 280, origin: "bottom left" },
  },
  buy: {
    brand: { left: 56, top: 48, origin: "top left" },
    chip: { right: 56, top: 52, origin: "top right" },
    copy: { left: 386, top: 130, width: 374, origin: "top left" },
    bento: { left: 784, top: 126, origin: "top left" },
    mascot: { left: 48, bottom: 44, width: 280, origin: "bottom left" },
  },
};

// A static bento treemap at a fixed box size (px), colored by real token brand.
function Bento({ items, w, h }: { items: SocialBentoItem[]; w: number; h: number }) {
  const rects = squarify(
    items.filter((i) => i.weightPct > 0).map((i) => ({ ticker: i.address || i.symbol, weight: Math.pow(i.weightPct, 0.65) })),
    w,
    h,
  );
  const byKey = new Map(items.map((i) => [(i.address || i.symbol).toLowerCase(), i]));
  return (
    <div style={{ position: "relative", width: w, height: h, borderRadius: 22, overflow: "hidden", boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }}>
      {rects.map((r) => {
        const it = byKey.get(r.ticker.toLowerCase());
        if (!it) return null;
        const vis = tokenVisual(it.symbol, it.address);
        const minDim = Math.min(r.w, r.h);
        const tickerFont = Math.max(11, Math.min(minDim * 0.16, 30));
        const showTicker = minDim > 34;
        return (
          <div key={r.ticker} style={{ position: "absolute", left: r.x, top: r.y, width: r.w, height: r.h, padding: 3 }}>
            <div
              style={{
                position: "relative",
                width: "100%",
                height: "100%",
                borderRadius: 16,
                overflow: "hidden",
                background: vis.color,
                boxShadow: "inset 0 2px 0 rgba(255,255,255,0.28), inset 0 -6px 14px rgba(0,0,0,0.24)",
              }}
            >
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(255,255,255,0.16), rgba(255,255,255,0) 36%, rgba(0,0,0,0.18))" }} />
              {showTicker && (
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 12 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6 }}>
                    <span
                      style={{
                        maxWidth: "76%",
                        borderRadius: 8,
                        background: "rgba(255,255,255,0.92)",
                        color: "#000",
                        padding: "3px 8px",
                        fontFamily: MONO,
                        fontWeight: 700,
                        fontSize: tickerFont,
                        lineHeight: 1,
                        textTransform: "uppercase",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
                      }}
                    >
                      {it.symbol}
                    </span>
                    <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: tickerFont * 0.9, color: vis.ink, lineHeight: 1 }}>
                      {Math.round(it.weightPct)}%
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// A draggable + resizable, absolutely-placed block. `base` is the variant
// default; `pos` layers a translate (drag) and a scale (resize) on top.
// Interactive only in the Studio preview — the export clone renders the same
// transform statically. Drag the body to move; drag the corner handle to size.
function Drag({
  id,
  base,
  layout,
  onLayoutChange,
  interactive,
  scale,
  z = 2,
  children,
}: {
  id: SocialElId;
  base?: ElBase;
  layout?: SocialLayout;
  onLayoutChange?: (id: SocialElId, pos: SocialElPos) => void;
  interactive?: boolean;
  scale?: number;
  z?: number;
  children: ReactNode;
}) {
  const pos = layout?.[id] ?? { x: 0, y: 0 };
  const s = pos.scale ?? 1;
  const origin = base?.origin ?? "top left";
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const rz = useRef<{ ax: number; ay: number; d0: number; s0: number } | null>(null);

  // move (drag the body)
  const onDown = (e: ReactPointerEvent) => {
    if (!interactive) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    drag.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y };
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!drag.current) return;
    const sc = scale || 1;
    onLayoutChange?.(id, {
      x: Math.round(drag.current.x + (e.clientX - drag.current.px) / sc),
      y: Math.round(drag.current.y + (e.clientY - drag.current.py) / sc),
      scale: pos.scale,
    });
  };
  const onUp = (e: ReactPointerEvent) => {
    drag.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  // resize (drag the corner handle) — scale = start × (pointer↔anchor distance ratio)
  const onResizeDown = (e: ReactPointerEvent) => {
    if (!interactive) return;
    e.preventDefault();
    e.stopPropagation();
    const el = wrapRef.current;
    if (!el) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const r = el.getBoundingClientRect();
    const ax = origin === "top right" ? r.right : r.left;
    const ay = origin === "bottom left" ? r.bottom : r.top;
    rz.current = { ax, ay, d0: Math.max(1, Math.hypot(e.clientX - ax, e.clientY - ay)), s0: s };
  };
  const onResizeMove = (e: ReactPointerEvent) => {
    if (!rz.current) return;
    const d = Math.max(1, Math.hypot(e.clientX - rz.current.ax, e.clientY - rz.current.ay));
    const ns = Math.min(3, Math.max(0.3, (rz.current.s0 * d) / rz.current.d0));
    onLayoutChange?.(id, { x: pos.x, y: pos.y, scale: Math.round(ns * 100) / 100 });
  };
  const onResizeUp = (e: ReactPointerEvent) => {
    rz.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  // resize handle sits at the corner opposite the anchor
  const handleStyle: CSSProperties =
    origin === "top left"
      ? { right: -8, bottom: -8, cursor: "nwse-resize" }
      : origin === "top right"
        ? { left: -8, bottom: -8, cursor: "nesw-resize" }
        : { right: -8, top: -8, cursor: "nesw-resize" };

  const { width, ...inset } = base ?? {};
  return (
    <div
      ref={wrapRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      style={{
        position: "absolute",
        ...inset,
        width,
        zIndex: z,
        transform: `translate(${pos.x}px, ${pos.y}px) scale(${s})`,
        transformOrigin: origin,
        cursor: interactive ? "grab" : "default",
        touchAction: interactive ? "none" : undefined,
        userSelect: "none",
        outline: interactive ? "1px dashed rgba(158,191,234,0.28)" : undefined,
        outlineOffset: 4,
      }}
    >
      {children}
      {interactive && (
        <div
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
          style={{
            position: "absolute",
            ...handleStyle,
            width: 16,
            height: 16,
            borderRadius: 5,
            background: "rgba(158,191,234,0.95)",
            border: "2px solid rgba(3,3,7,0.7)",
            boxShadow: "0 1px 5px rgba(0,0,0,0.5)",
            zIndex: 6,
            touchAction: "none",
          }}
        />
      )}
    </div>
  );
}

export interface SocialCardProps {
  variant: SocialVariant;
  bigText: string; // the headline figure — e.g. "10 PRISM", "$5,200", "$TBV3"
  title: string; // punchy hook / event title
  sub: string; // one-line caption
  holdings: SocialBentoItem[]; // powers the bento (launch/buy); ignored on burn
  layout?: SocialLayout; // persisted per-element drag/resize offsets
  onLayoutChange?: (id: SocialElId, pos: SocialElPos) => void;
  interactive?: boolean; // true in the Studio preview; false for the export clone
  scale?: number; // preview scale, so drag deltas map to card-space px
}

type Props = SocialCardProps & { className?: string };

export const SocialCard = forwardRef<HTMLDivElement, Props>(function SocialCard(
  { variant, bigText, title, sub, holdings, layout, onLayoutChange, interactive = false, scale = 1, className = "" },
  ref,
) {
  const v = VARIANT[variant];
  const base = BASE[variant];
  const showBento = variant !== "burn" && holdings.length > 0;
  const compact = variant !== "burn"; // launch/buy share the frame with the bento → tighter type
  const bigFont = compact ? 62 : 94;
  const titleFont = compact ? 33 : 42;
  const subFont = compact ? 21 : 25;

  const dragProps = { layout, onLayoutChange, interactive, scale };

  return (
    <div
      ref={ref}
      className={className}
      style={{
        width: SOCIAL_W,
        height: SOCIAL_H,
        position: "relative",
        overflow: "hidden",
        background: `linear-gradient(140deg, ${v.bgFrom} 0%, ${v.bgVia} 55%, ${v.bgTo} 100%)`,
        color: "#f8fafc",
        fontFamily: SANS,
      }}
    >
      {/* ── backdrop stack (ambient, non-draggable) ── */}
      {/* accent bloom behind the mascot (bottom-left) */}
      <div style={{ position: "absolute", left: -150, bottom: -190, width: 640, height: 640, borderRadius: "50%", background: `radial-gradient(circle, ${v.bloom}, transparent 66%)`, filter: "blur(26px)", zIndex: 0, pointerEvents: "none" }} />
      {/* secondary bloom top-right */}
      <div style={{ position: "absolute", right: -130, top: -170, width: 500, height: 500, borderRadius: "50%", background: `radial-gradient(circle, ${v.accent2}59, transparent 70%)`, filter: "blur(40px)", zIndex: 0, pointerEvents: "none" }} />
      {/* dot-grid texture */}
      <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(rgba(255,255,255,0.05) 1.4px, transparent 1.4px)", backgroundSize: "30px 30px", opacity: 0.7, zIndex: 0, pointerEvents: "none" }} />
      {/* vignette for focus */}
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(125% 125% at 50% 38%, transparent 52%, rgba(0,0,0,0.55))", zIndex: 0, pointerEvents: "none" }} />
      {/* top sheen */}
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(255,255,255,0.05), transparent 18%)", zIndex: 0, pointerEvents: "none" }} />

      {/* mascot — bottom-left circular badge (uncut original, cropped to a circle),
          accent ring + glow. Behind the copy so text stays legible if they overlap. */}
      <Drag id="mascot" base={base.mascot} {...dragProps} z={1}>
        <div
          style={{
            width: "100%",
            aspectRatio: "1 / 1",
            borderRadius: "50%",
            overflow: "hidden",
            boxShadow: `0 0 0 3px ${v.accent}, 0 0 46px ${v.bloom}, 0 18px 44px rgba(0,0,0,0.55)`,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/mascots/${variant}.jpg`}
            alt=""
            draggable={false}
            style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center", display: "block", pointerEvents: "none" }}
          />
        </div>
      </Drag>

      {/* brand mark */}
      <Drag id="brand" base={base.brand} {...dragProps}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <PixelRainbow animate={false} glow={false} className="h-8 w-auto" />
          <span style={{ fontFamily: SERIF, fontWeight: 800, fontSize: 30, letterSpacing: "-0.5px" }}>Prismbeat</span>
        </div>
      </Drag>

      {/* type chip — glowing pill with a live dot */}
      <Drag id="chip" base={base.chip} {...dragProps}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 9,
            fontFamily: SANS,
            fontSize: 19,
            fontWeight: 800,
            letterSpacing: 1.4,
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            color: "#ffffff",
            background: `linear-gradient(180deg, ${v.accent}30, ${v.accent}12)`,
            border: `1.5px solid ${v.accent}66`,
            borderRadius: 999,
            padding: "9px 18px 9px 15px",
            boxShadow: `0 0 26px ${v.accent}44, inset 0 1px 0 rgba(255,255,255,0.16)`,
          }}
        >
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: v.accent, boxShadow: `0 0 10px ${v.accent}`, flex: "0 0 auto" }} />
          <span style={{ fontSize: 22 }}>{v.emoji}</span>
          {v.label}
        </span>
      </Drag>

      {/* copy block: headline figure (gradient) + punchy title + caption */}
      <Drag id="copy" base={base.copy} {...dragProps}>
        <div
          style={{
            fontFamily: GROTESK,
            fontWeight: 700,
            fontSize: bigFont,
            lineHeight: 0.96,
            letterSpacing: "-2px",
            backgroundImage: `linear-gradient(178deg, #ffffff 4%, ${v.accent} 78%)`,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            WebkitTextFillColor: "transparent",
            filter: `drop-shadow(0 3px 22px ${v.accent}66)`,
          }}
        >
          {bigText}
        </div>
        <div style={{ fontFamily: SANS, fontSize: titleFont, fontWeight: 800, marginTop: 16, lineHeight: 1.08, letterSpacing: "-0.5px", color: "#ffffff", textShadow: "0 2px 18px rgba(0,0,0,0.45)" }}>
          {title}
        </div>
        <div style={{ fontFamily: SANS, fontSize: subFont, fontWeight: 500, color: "#cbd5e1", marginTop: 12, lineHeight: 1.4 }}>{sub}</div>
      </Drag>

      {/* basket bento (launch / buy) */}
      {showBento && (
        <Drag id="bento" base={base.bento} {...dragProps}>
          <Bento items={holdings} w={360} h={360} />
        </Drag>
      )}
    </div>
  );
});
