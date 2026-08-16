"use client";

import { forwardRef } from "react";
import qrcode from "qrcode-generator";
import { squarify } from "@/lib/spectrum/treemap";
import { bentoWeight, TILE_INSET } from "@/lib/spectrum/bento-style";
import { tokenVisual } from "@/lib/spectrum/token-visual";
import { basketPageUrl } from "@/lib/spectrum/basket-share";

// ── THE BASKET SHARE CARD ────────────────────────────────────────────────────
// the designer, 2026-08-13: "you just pop in the contract address for the basket into
// prism mothership and then it creates a stunning image and text you can share
// on X with the link to the basket… makes the brand a bit cleaner than
// retweeting people's random texts."
//
// His spec, literally: a 1920×1080 image showing the basket asset grid from the
// Spectrum system with the ticker/colour/logo/price on the asset bento, the
// Prism Mothership background faded at 20% into black, and "visit
// spectrumindexes.xyz to make a basket" small in the bottom right.
//
// SIZE: declared at 960×540 because the Studio exports every card through
// modern-screenshot at scale 2. 960×540 × 2 = exactly the 1920×1080 he asked
// for. Changing either number without the other silently changes the export.
//
// CAPTURE RULES this card obeys (each one has cost us an export before):
//   · Logos come from OUR OWN proxy, never the DexScreener CDN — the CDN sends
//     no ACAO, so a direct src taints the canvas and the export dies.
//   · The Mothership art is WEBP, which is fine here (a browser renders it) but
//     would be a silent empty frame on the Satori /api/card path. This card is
//     DOM-capture only.
//   · Fonts are the two bundled families, so the export is identical on any
//     machine rather than resolving to whatever the operator has installed.
//   · No CSS animation, no ResizeObserver: the capture must be deterministic.

export const BASKET_CARD_W = 960;
export const BASKET_CARD_H = 540;

const GROTESK = '"Space Grotesk", ui-sans-serif, system-ui, sans-serif';
const SANS = '"Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif';

const CHAIN_LABEL: Record<string, string> = {
  ethereum: "Ethereum",
  base: "Base",
  robinhood: "Robinhood Chain",
};

export interface BasketCardHolding {
  symbol: string;
  asset: string;
  priceUsd: number;
  liveWeightPct: number;
  targetWeightPct: number;
  priced: boolean;
  /** Set only on a bundle, where one card carries assets from several chains. */
  chain?: string;
}

export interface BasketCardData {
  address: string;
  chain: string;
  name: string;
  symbol: string;
  holdings: BasketCardHolding[];
  totalCount: number;
  /** A bundle is a cross-chain thesis: several baskets shown as one thing.
   *  Present, the card names its chains instead of one and badges each tile. */
  bundle?: { chains: string[]; basketCount: number };
  /** Where the QR points. Omitted deliberately for a bundle assembled from
   *  addresses: it has no page of its own, and a QR is the worst place for a
   *  wrong link because nobody can read it before they scan it. Falling back to
   *  the first leg's basket would silently send people to one leg of a thesis. */
  qrUrl?: string;
}

const CHAIN_TAG: Record<string, string> = { ethereum: "ETH", base: "BASE", robinhood: "HOOD" };

/** `color-mix(in srgb, <color> <pct>%, #000)` done in JS. The live bento uses the
 *  CSS function, but this card is serialised by modern-screenshot before it ever
 *  reaches a real renderer, so anything the serialiser has to resolve is a risk
 *  the export does not need to take. */
function mixBlack(hex: string, pct: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#000000";
  const n = parseInt(m[1], 16);
  const f = Math.max(0, Math.min(1, pct / 100));
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(c * f));
  return `#${((1 << 24) | (ch[0] << 16) | (ch[1] << 8) | ch[2]).toString(16).slice(1)}`;
}

/** Deterministic 0..1 per asset, the same hash the live bento uses to offset each
 *  tile's sheen. Here it picks a FIXED sheen position rather than an animation
 *  phase: the card is a still, and a running animation would export at whatever
 *  frame the capture happened to land on. */
function hashUnit(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % 997) / 997;
}

/** The basket's own page, encoded as a QR so the card works off a screen.
 *  Drawn as one SVG path rather than an <img>: nothing to fetch, nothing to
 *  decode, and the capture cannot race it. Error correction M with a real quiet
 *  zone, because a card gets scanned off a phone photo of a monitor. */
function QrCode({ url, size }: { url: string; size: number }) {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  }
  const quiet = 2; // modules of white margin on every side
  const span = n + quiet * 2;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        background: "#ffffff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${span} ${span}`} shapeRendering="crispEdges">
        <path d={d} transform={`translate(${quiet} ${quiet})`} fill="#000000" />
      </svg>
    </div>
  );
}

/** The token mark: its real logo where one exists, its initials in its own
 *  brand colour where one does not.
 *
 *  Two things learned the hard way. `/api/spectrum/token-logo` is the WRONG
 *  proxy here: it hands back DexScreener's generic placeholder, so eight tiles
 *  in a row wore the same meaningless grey blob. `/api/logo` walks the CDN then
 *  the token-info API and 404s rather than serve that placeholder, which is
 *  exactly the signal a fallback needs. And the fallback is drawn UNDERNEATH
 *  rather than swapped in on error, because the Studio captures the card as
 *  soon as every image has fired load-or-error: a React state update racing
 *  that capture would sometimes export the broken frame. Hiding the img in the
 *  error handler is synchronous, so the monogram is already showing. */
function TokenMark({ symbol, address, chain, color, ink, size }: { symbol: string; address: string; chain: string; color: string; ink: string; size: number }) {
  const initials = (symbol || "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 999,
        // the live bento's framed disc: the tile colour darkened, so the logo
        // sits in a well rather than floating on the fill
        background: mixBlack(color, 55),
        boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {/* the disc is the tile colour darkened, so white always clears the floor
          here whatever the asset's own ink would have been */}
      <span style={{ fontSize: Math.round(size * 0.42), fontWeight: 700, color: "#ffffff", lineHeight: 1 }}>{initials}</span>
      <img
        src={`/api/logo?addr=${address}&chain=${chain}`}
        alt=""
        width={size}
        height={size}
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
        style={{ position: "absolute", inset: 0, width: size, height: size, objectFit: "cover" }}
      />
    </div>
  );
}

/** Per-asset price. These span NVDA at $224 to a memecoin at $0.000004, so the
 *  precision has to follow the magnitude or the small ones all read "$0.00" —
 *  the exact bug the bot's sub-cent formatter was written to kill. */
function assetPrice(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1000) return `$${Math.round(n).toLocaleString("en-US")}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  if (n >= 0.0001) return `$${n.toFixed(5)}`;
  return `$${n.toPrecision(2)}`;
}

export const BasketCard = forwardRef<HTMLDivElement, { data: BasketCardData | null; className?: string }>(
  function BasketCard({ data, className }, ref) {
    const holdings = (data?.holdings ?? []).filter((h) => (h.liveWeightPct || h.targetWeightPct) > 0);

    // The bento occupies everything under the header. bentoWeight is the
    // shared exponent every bento in the codebase lays out with (enforced by
    // import now, not by comment), so a 60% asset does not swallow the whole
    // grid and the small legs stay legible.
    const BENTO_W = BASKET_CARD_W - 40 * 2;
    const BENTO_H = 336;
    const rects = squarify(
      holdings.map((h) => ({ ticker: h.asset, weight: bentoWeight(h.liveWeightPct || h.targetWeightPct) })),
      BENTO_W,
      BENTO_H,
    );
    const byAsset = new Map(holdings.map((h) => [h.asset, h]));

    return (
      <div
        ref={ref}
        className={className}
        style={{
          width: BASKET_CARD_W,
          height: BASKET_CARD_H,
          position: "relative",
          overflow: "hidden",
          background: "#000000",
          fontFamily: GROTESK,
        }}
      >
        {/* The Mothership behind everything, at the 20% the designer asked for, filling
            the frame rather than sitting in a band at the top, and dissolving
            into black on the diagonal so the bento always lands on true black. */}
        <img
          src="/mothership/hero-ship.webp"
          alt=""
          width={BASKET_CARD_W}
          height={BASKET_CARD_H}
          style={{
            position: "absolute",
            inset: 0,
            width: BASKET_CARD_W,
            height: BASKET_CARD_H,
            objectFit: "cover",
            objectPosition: "center 38%",
            opacity: 0.2,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(120% 90% at 22% 8%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.45) 45%, rgba(0,0,0,0.88) 78%, #000 100%)",
          }}
        />

        <div style={{ position: "relative", padding: 40, height: "100%", boxSizing: "border-box" }}>
          {/* ── header: whose basket this is ── */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", height: 72 }}>
            <div>
              <div style={{ fontSize: 52, fontWeight: 700, color: "#ffffff", lineHeight: 1, letterSpacing: "-0.02em" }}>
                ${data?.symbol ?? ""}
              </div>
              <div style={{ marginTop: 8, fontSize: 17, fontWeight: 500, color: "#94a3b8", lineHeight: 1 }}>
                {data?.name ?? ""}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ textAlign: "right" }}>
                <div
                  style={{
                    fontFamily: SANS,
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: "#94a3b8",
                  }}
                >
                  {data ? `${data.totalCount} asset${data.totalCount === 1 ? "" : "s"}` : ""}
                </div>
                {/* A bundle names its chains, not one chain. the designer's framing is
                    that it is ONE thesis and the baskets underneath are
                    plumbing, so the basket count never appears on the face. */}
                <div style={{ marginTop: 8, fontSize: 15, fontWeight: 600, color: "#cbd5e1", lineHeight: 1 }}>
                  {!data
                    ? ""
                    : data.bundle
                      ? data.bundle.chains.map((c) => CHAIN_LABEL[c] ?? c).join(" · ")
                      : (CHAIN_LABEL[data.chain] ?? data.chain)}
                </div>
              </div>
              {/* scan it and you land on this basket's own page */}
              {data && (data.qrUrl ?? (data.bundle ? null : basketPageUrl(data.address, data.chain))) && (
                <QrCode url={data.qrUrl ?? basketPageUrl(data.address, data.chain)} size={72} />
              )}
            </div>
          </div>

          {/* ── the asset bento ── */}
          <div style={{ position: "relative", width: BENTO_W, height: BENTO_H, marginTop: 24 }}>
            {rects.map((r) => {
              const h = byAsset.get(r.ticker);
              if (!h) return null;
              const v = tokenVisual(h.symbol, h.asset);
              const weight = h.liveWeightPct || h.targetWeightPct;
              const min = Math.min(r.w, r.h);
              // Degradation ladder: a tile only earns a logo, then a price, then
              // a weight, once it is big enough to carry each without crowding.
              const showLogo = min > 56 && r.w > 76;
              const showPrice = r.h > 64 && r.w > 92 && h.priced;
              const showWeight = r.h > 44 && r.w > 60;
              const pad = min > 80 ? 16 : 12;
              // frozen sheen: band width follows tile size, position follows the
              // address, so every tile catches the light somewhere different
              const seed = hashUnit(h.asset);
              const sheenBand = Math.max(4, Math.min(10, 4 + ((min - 30) / 170) * 6));
              const sheenAt = 30 + seed * 40;
              return (
                <div
                  key={r.ticker}
                  style={{
                    position: "absolute",
                    left: r.x,
                    top: r.y,
                    width: r.w,
                    height: r.h,
                    padding: 3,
                    boxSizing: "border-box",
                  }}
                >
                  {/* The tile wears the asset's TRUE colour at full strength,
                      the way the live Spectrum bento does (the designer 2026-08-13:
                      "proper full colour from spectrum with the sheen"): a solid
                      fill, an inset top light and bottom shade for the block,
                      and one frozen diagonal sheen. The sheen is static here on
                      purpose. Live it sweeps; on a still, an animation exports
                      at whatever frame the capture lands on, so its position is
                      hashed off the address instead and never moves. */}
                  <div
                    style={{
                      position: "relative",
                      width: "100%",
                      height: "100%",
                      boxSizing: "border-box",
                      borderRadius: 12,
                      background: v.color,
                      boxShadow: TILE_INSET.sm,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: "linear-gradient(180deg, rgba(255,255,255,0.14), rgba(255,255,255,0) 34%, rgba(0,0,0,0.16))",
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        backgroundImage: `linear-gradient(115deg, transparent ${(sheenAt - sheenBand).toFixed(1)}%, rgba(255,255,255,0.16) ${sheenAt.toFixed(1)}%, transparent ${(sheenAt + sheenBand).toFixed(1)}%)`,
                      }}
                    />
                    <div
                      style={{
                        position: "relative",
                        height: "100%",
                        boxSizing: "border-box",
                        padding: pad,
                        display: "flex",
                        flexDirection: "column",
                        // Centred, not spread: a tall tile with its ticker pinned
                        // to the top and its price to the floor reads as a hole.
                        justifyContent: "center",
                        gap: min > 92 ? 12 : 8,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {showLogo && (
                          <TokenMark
                            symbol={h.symbol}
                            address={h.asset}
                            chain={h.chain ?? data?.chain ?? "ethereum"}
                            color={v.color}
                            ink={v.ink}
                            size={28}
                          />
                        )}
                        {/* A white plate under the ticker, as the live bento does:
                            it is the one label that must stay legible on a fill
                            that can be any colour at all. */}
                        <div
                          style={{
                            maxWidth: "78%",
                            borderRadius: 6,
                            background: "rgba(255,255,255,0.92)",
                            padding: "3px 8px",
                            fontSize: min > 92 ? 20 : min > 60 ? 16 : 12,
                            fontWeight: 800,
                            color: "#000000",
                            lineHeight: 1.15,
                            letterSpacing: "0.01em",
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                            textOverflow: "ellipsis",
                            boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
                          }}
                        >
                          {h.symbol}
                        </div>
                      </div>
                      <div>
                        {showPrice && (
                          <div style={{ fontSize: min > 92 ? 18 : 14, fontWeight: 700, color: v.ink, lineHeight: 1.2 }}>
                            {assetPrice(h.priceUsd)}
                          </div>
                        )}
                        {showWeight && (
                          <div
                            style={{
                              marginTop: showPrice ? 4 : 0,
                              fontFamily: SANS,
                              fontSize: 11,
                              fontWeight: 800,
                              letterSpacing: "0.1em",
                              color: v.ink,
                              opacity: 0.82,
                            }}
                          >
                            {weight >= 10 ? weight.toFixed(0) : weight.toFixed(1)}%
                            {/* On a bundle the same ticker can exist on two
                                chains as two different contracts, so the chain
                                rides on the tile. Never merge by ticker: four
                                live contracts already answer to "PEPE". */}
                            {h.chain && data?.bundle && (
                              <span style={{ marginLeft: 8, opacity: 0.72 }}>{CHAIN_TAG[h.chain] ?? h.chain}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── the footer line, bottom right, deliberately quiet ── */}
          <div
            style={{
              position: "absolute",
              right: 40,
              bottom: 24,
              fontFamily: SANS,
              fontSize: 12,
              fontWeight: 600,
              color: "#8a94a6",
              letterSpacing: "0.01em",
            }}
          >
            visit spectrumindexes.xyz to make a basket
          </div>
        </div>
      </div>
    );
  },
);
