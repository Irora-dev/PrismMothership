"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { squarify } from "@/lib/spectrum/treemap";
import { bentoWeight, TILE_INSET } from "@/lib/spectrum/bento-style";
import { logoSources, tokenVisual, type TokenChain } from "@/lib/spectrum/token-visual";
import { useTokenColors } from "@/lib/spectrum/use-token-colors";

// ── Basket bento (Spectrum-operator design, lean port) ───────────────────────
// The basket as a squarified treemap of 3D tiles: white ticker pill, weight %,
// each tile in the token's REAL brand color (baked from its logo, curated
// overrides for majors), the token logo on tiles big enough for it, raised
// edges and a slow diagonal sheen.

export interface BentoItem {
  symbol: string;
  address: string;
  weightPct: number;
}

const VW = 300; // virtual width; height measured from the parent (fill layout)

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Deterministic 0..1 per asset — sheen phase offset.
function hashUnit(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % 997) / 997;
}

// Token logo inset in a darkened disc of the tile color (the operator's framed
// variant). Walks the display ladder (DexScreener covers all three chains,
// TrustWallet next) before giving up — color + ticker then carry the tile.
// No crossOrigin on the display img: the DexScreener CDN refuses CORS loads,
// and display doesn't need a readable canvas (extraction handles colors).
function TileLogo({ address, chain, color, size }: { address: string; chain: TokenChain; color: string; size: number }) {
  const srcs = useMemo(() => logoSources(address, chain), [address, chain]);
  const [idx, setIdx] = useState(0);
  if (idx >= srcs.length) return null;
  const pad = Math.max(2, Math.round(size * 0.08));
  return (
    <span
      className="grid place-items-center rounded-full shadow-[0_2px_6px_rgba(0,0,0,0.35)]"
      style={{ width: size, height: size, padding: pad, background: `color-mix(in srgb, ${color} 55%, #000)` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={srcs[idx]}
        alt=""
        onError={() => setIdx((i) => i + 1)}
        className="h-full w-full rounded-full object-cover"
      />
    </span>
  );
}

export function BasketBento({
  items,
  chain = "ethereum",
  className = "",
}: {
  items: BentoItem[];
  chain?: TokenChain;
  className?: string;
}) {
  // live logo-color extraction: tiles repaint from hash hues to real brand
  // colors as each logo's dominant color lands (the operator's color pop)
  useTokenColors(items, chain);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) setSize({ w: cr.width, h: cr.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const VH = size.w > 0 && size.h > 0 ? VW * (size.h / size.w) : VW / 1.2;
  const rects = useMemo(
    () =>
      squarify(
        items.filter((i) => i.weightPct > 0).map((i) => ({ ticker: i.address, weight: bentoWeight(i.weightPct) })),
        VW,
        VH,
      ),
    [items, VH],
  );
  const byAddr = useMemo(() => new Map(items.map((i) => [i.address.toLowerCase(), i])), [items]);
  const rankByAddr = useMemo(() => {
    const m = new Map<string, number>();
    [...items]
      .filter((i) => i.weightPct > 0)
      .sort((a, b) => b.weightPct - a.weightPct)
      .forEach((it, i) => m.set(it.address.toLowerCase(), i));
    return m;
  }, [items]);

  const cW = size.w || 320;
  const cH = size.h > 0 ? size.h : cW / 1.2;

  return (
    <div ref={ref} className={`relative h-full w-full ${className}`}>
      {rects.map((r) => {
        const it = byAddr.get(r.ticker.toLowerCase());
        if (!it) return null;
        const bW = (r.w / VW) * cW;
        const bH = (r.h / VH) * cH;
        const minDim = Math.min(bW, bH);
        const tickerFont = clamp(minDim * 0.15, 6.5, 13);
        const weightFont = clamp(minDim * 0.17, 8, 14);
        const logoSize = Math.round(clamp(minDim * 0.42, 14, 44));
        const showTicker = minDim > 19;
        const showLogo = minDim > 52 && bW > 56;
        const vis = tokenVisual(it.symbol, it.address);
        const color = vis.color;
        const seed = hashUnit(it.address);
        const sheenBand = clamp(4 + ((minDim - 30) / 170) * 6, 4, 10);
        const sheenDur = 9 + seed * 5;
        const rank = rankByAddr.get(it.address.toLowerCase()) ?? 0;
        return (
          <div
            key={r.ticker}
            className="absolute p-0.5 bento-tile-in"
            style={{
              left: `${(r.x / VW) * 100}%`,
              top: `${(r.y / VH) * 100}%`,
              width: `${(r.w / VW) * 100}%`,
              height: `${(r.h / VH) * 100}%`,
              animationDelay: `${120 + rank * 55}ms`,
            }}
          >
            <div
              className="relative h-full w-full overflow-hidden rounded-xl"
              style={{
                background: color,
                boxShadow: TILE_INSET.sm,
              }}
              title={`${it.symbol} · ${it.weightPct.toFixed(1)}%`}
            >
              {/* vertical light → shade gives the block dimension (3D tile) */}
              <div
                aria-hidden
                className="absolute inset-0"
                style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.14), rgba(255,255,255,0) 34%, rgba(0,0,0,0.16))" }}
              />
              {/* diagonal sheen — slow sweep, phase-offset per tile */}
              <div
                aria-hidden
                className="bento-sheen absolute inset-0"
                style={{
                  backgroundImage: `linear-gradient(115deg, transparent ${(50 - sheenBand).toFixed(1)}%, rgba(255,255,255,0.14) 50%, transparent ${(50 + sheenBand).toFixed(1)}%)`,
                  animationDuration: `${sheenDur.toFixed(1)}s`,
                  animationDelay: `${(-seed * sheenDur).toFixed(2)}s`,
                }}
              />
              {showTicker && (
                <div className="absolute inset-0 flex flex-col justify-between p-1.5">
                  <div className="flex items-start justify-between gap-1">
                    <span
                      className="max-w-[76%] truncate rounded-md bg-white/90 px-1.5 py-0.5 font-bold uppercase leading-none tracking-wide text-black shadow-[0_2px_8px_rgba(0,0,0,0.45)]"
                      style={{ fontSize: tickerFont }}
                    >
                      {it.symbol}
                    </span>
                    <span className="font-mono font-semibold leading-none tabular-nums" style={{ fontSize: weightFont, color: vis.ink }}>
                      {Math.round(it.weightPct)}%
                    </span>
                  </div>
                  {showLogo && (
                    <div className="mb-0.5 mr-0.5 self-end">
                      <TileLogo address={it.address} chain={chain} color={color} size={logoSize} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
