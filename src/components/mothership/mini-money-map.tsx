"use client";

import Link from "next/link";
import { usePolledJson } from "@/hooks/usePolledJson";
import { fmtUsd } from "@/lib/feed/format";
import { POOL_TO_BURN, POOL_TO_HOLDERS } from "@/lib/chain/constants";
import { C, MONO } from "./style";

// The Money Map in miniature for the home page (the designer, 2026-08-16, second
// pass on his critique): faithful to /flow — labeled source streams on the
// left (ACTIVE ones only), the prism dead-center, layered glowing beams with
// marching cores, share-sized colored fans to labeled outputs on the right,
// and ambient dots flowing along every live lane. Half the height of the
// first draft. The whole panel doors to the full map.

const DEST = [
  { key: "holders", label: "Holders", color: C.green },
  { key: "creator", label: "Creators", color: C.cyan },
  { key: "interfaces", label: "Interfaces", color: C.purple },
  { key: "league", label: "League", color: "#FACC15" },
  { key: "burn", label: "The Burn", color: C.orange },
] as const;

// the brand's seven bands — the caustic a real prism throws (same set as /flow)
const BANDS = ["#ff5a5a", "#ff9f45", "#ffe14d", "#5cff8f", "#3bd9ff", "#7c8bff", "#c06aff"];

// a deterministic starfield: golden-angle scatter, seeded by index so the
// server and client always draw the same sky (random-in-render is a hydration
// bug, and reduced motion needs nothing here — the stars hold still)
const STARS = Array.from({ length: 16 }, (_, i) => ({
  x: ((i * 61.803 + 7) % 100) / 100,
  y: ((i * 38.196 + 13) % 100) / 100,
  r: 0.6 + (i % 3) * 0.25,
  o: 0.12 + (i % 4) * 0.06,
}));

const sum = (a?: number[]) => (a ?? []).reduce((x, y) => x + (y || 0), 0);

export function MiniMoneyMap() {
  const { data: spectrum } = usePolledJson<{ feeSplit?: Record<string, number>; auctionEth?: number; ethUsd?: number }>(
    "/api/spectrum/charts",
    120_000,
  );
  const { data: charts } = usePolledJson<{
    feesUsd?: number[];
    wrapperFeesUsd?: number[];
    wrapperBurnUsd?: number[];
    batchFeesUsd?: number[];
    batchBurnUsd?: number[];
  }>("/api/charts?range=24h", 120_000);

  const pool = sum(charts?.feesUsd);
  // the Spectrum Portfolio's two fee-capture routes, ONE system (the designer,
  // 2026-08-16): wrapped swaps + batches — measured fees, measured burn cuts
  const portFee = sum(charts?.wrapperFeesUsd) + sum(charts?.batchFeesUsd);
  const portBurn = sum(charts?.wrapperBurnUsd) + sum(charts?.batchBurnUsd);
  const fs = spectrum?.feeSplit ?? {};
  const basketsUsd = Object.values(fs).reduce((a, b) => a + (b || 0), 0);
  const auctionUsd = (spectrum?.auctionEth ?? 0) * (spectrum?.ethUsd ?? 0);
  const totals: Record<string, number> = {
    holders: pool * POOL_TO_HOLDERS + (fs.holders ?? 0),
    creator: fs.creator ?? 0,
    interfaces: (fs.interfaces ?? 0) + Math.max(0, portFee - portBurn),
    league: fs.league ?? 0,
    burn: pool * POOL_TO_BURN + (fs.burn ?? 0) + auctionUsd + portBurn,
  };
  const grand = Object.values(totals).reduce((a, b) => a + b, 0);
  // inactive lanes don't render — the mini map shows only what flowed
  const sources = [
    { label: "PRISM pool", usd: pool },
    { label: "Spectrum baskets", usd: basketsUsd },
    { label: "Basket launches", usd: auctionUsd },
    { label: "Spectrum Portfolio", usd: portFee },
  ].filter((s) => s.usd > 0.005);
  const shown = DEST.filter((d) => totals[d.key] > 0.005);
  const ready = grand > 0;

  // geometry — prism CENTERED, wide and short. Beams meet the GLASS, not a
  // point near it: in-beams converge on one entry spot lerped onto the left
  // face, out-fans each START on the right face (apex→base lerp) — the same
  // rule the /flow share card learned, so nothing floats or pokes through.
  const W = 1000;
  const H = 120;
  const PX = W / 2;
  const PY = 62;
  const PR = 44;
  const apex = { x: PX, y: PY - PR };
  const baseL = { x: PX - PR * 0.92, y: PY + PR * 0.62 };
  const baseR = { x: PX + PR * 0.92, y: PY + PR * 0.62 };
  // the entry spot: on the left face, at the prism's midline height
  const entryT = (PY - apex.y) / (baseL.y - apex.y);
  const EX = apex.x + (baseL.x - apex.x) * entryT;
  const EY = PY;
  const FAN_END = 840;
  const nS = sources.length || 1;
  const nD = shown.length || 1;

  const inPath = (i: number) => {
    const y = 16 + (92 * (i + 0.5)) / nS;
    return { y, d: `M 138 ${y} C ${138 + (EX - 138) * 0.5} ${y}, ${138 + (EX - 138) * 0.6} ${EY}, ${EX} ${EY}` };
  };
  const outPath = (i: number) => {
    const y = 12 + (98 * (i + 0.5)) / nD;
    // this fan's own emission point on the right face
    const t = 0.24 + (0.66 * (i + 0.5)) / nD;
    const sx = apex.x + (baseR.x - apex.x) * t;
    const sy = apex.y + (baseR.y - apex.y) * t;
    return { y, sx, sy, d: `M ${sx} ${sy} C ${sx + (FAN_END - sx) * 0.5} ${sy}, ${sx + (FAN_END - sx) * 0.55} ${y}, ${FAN_END} ${y}` };
  };

  return (
    <Link
      href="/flow"
      className="group relative block overflow-hidden rounded-2xl border border-white/10 transition-colors hover:border-white/25"
      style={{ background: "radial-gradient(120% 200% at 50% 45%, rgba(20,26,44,0.9) 0%, rgba(6,8,16,0.94) 55%, #02030a 100%)" }}
      title="Open the Money Map"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 pt-3">
        <div className="flex items-baseline gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">The Money Map · last 24h</span>
          {ready && (
            <span className="text-base font-bold tabular-nums text-white" style={{ fontFamily: MONO, textShadow: `0 0 18px ${C.cyan}55` }}>
              {fmtUsd(grand)}
            </span>
          )}
        </div>
        <span className="text-[11px] font-bold uppercase tracking-wider transition-transform group-hover:translate-x-0.5" style={{ color: C.cyan }}>
          Open the full map →
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" aria-hidden>
        <defs>
          <linearGradient id="mmm-white" x1="0" y1="0" x2={String(EX)} y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#e2e8f0" stopOpacity="0.10" />
            <stop offset="55%" stopColor="#e2e8f0" stopOpacity="0.38" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.8" />
          </linearGradient>
          {shown.map((d, i) => (
            <linearGradient key={d.key} id={`mmm-out-${d.key}`} x1={String(outPath(i).sx)} y1="0" x2={String(FAN_END)} y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="4%" stopColor={d.color} stopOpacity="0.9" />
              <stop offset="55%" stopColor={d.color} stopOpacity="0.5" />
              <stop offset="100%" stopColor={d.color} stopOpacity="0.16" />
            </linearGradient>
          ))}
          {/* the /flow prism's own glass, edge and caustic treatments, at mini scale */}
          <linearGradient id="mmm-glass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.3" />
            <stop offset="40%" stopColor="#8b9cf7" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#0b1020" stopOpacity="0.66" />
          </linearGradient>
          <linearGradient id="mmm-edge" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="55%" stopColor="#9db2ff" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#3bd9ff" stopOpacity="0.7" />
          </linearGradient>
          {/* userSpaceOnUse is load-bearing: a gradient with default bbox units
              on a horizontal line has zero height and paints nothing */}
          <linearGradient id="mmm-caustic" gradientUnits="userSpaceOnUse" x1={PX - PR * 0.86} y1="0" x2={PX + PR * 0.86} y2="0">
            {BANDS.map((c, i) => (
              <stop key={c} offset={`${(i / 6) * 100}%`} stopColor={c} stopOpacity="0.8" />
            ))}
          </linearGradient>
          <linearGradient id="mmm-wedge" gradientUnits="userSpaceOnUse" x1={EX} y1="0" x2={PX + PR * 0.6} y2="0">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
            <stop offset="45%" stopColor="#ffffff" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.04" />
          </linearGradient>
          <filter id="mmm-soft" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>

        {/* the sky behind everything */}
        {STARS.map((s, i) => (
          <circle key={i} cx={s.x * W} cy={s.y * H} r={s.r} fill="#cdd8ec" opacity={s.o} />
        ))}

        {/* source streams, labeled, actives only */}
        {sources.map((s, i) => {
          const p = inPath(i);
          // four sources ride a 23px pitch — the two-line label block compacts
          // so neighbours never overlap (the designer caught the collision live)
          const tight = nS >= 4;
          return (
            <g key={s.label}>
              <text x={130} y={p.y - (tight ? 5.5 : 7)} textAnchor="end" fontSize={tight ? 10 : 11} fontWeight="500" fill="#6b7a8f">
                {s.label}
              </text>
              <text x={130} y={p.y + (tight ? 7.5 : 9)} textAnchor="end" fontSize={tight ? 11 : 12} fontWeight="600" fill="#e8edf4" fontFamily="ui-monospace, monospace">
                {fmtUsd(s.usd)}
              </text>
              <path d={p.d} fill="none" stroke="#e2e8f0" strokeOpacity="0.07" strokeWidth={11} filter="url(#mmm-soft)" />
              {/* butt caps: three round caps stacked on one entry point read as a blob */}
              <path d={p.d} fill="none" stroke="url(#mmm-white)" strokeWidth={2.4} />
              <path
                d={p.d}
                fill="none"
                stroke="#ffffff"
                strokeOpacity="0.5"
                strokeWidth={0.9}
                strokeLinecap="round"
                strokeDasharray="8 15"
                style={{ animation: "ms-beam-flow 1.6s linear infinite" }}
              />
            </g>
          );
        })}

        {/* THE GLASS — the /flow prism in miniature: breathing aura, gradient
            fill and edge, facet lines, the dispersion wedge, the caustic */}
        <circle
          cx={PX}
          cy={PY}
          r={PR * 1.35}
          fill="#8b9cf7"
          opacity="0.09"
          filter="url(#mmm-soft)"
          style={{ animation: "mm-breathe 5.5s ease-in-out infinite" }}
        />
        <circle cx={PX} cy={PY} r={PR * 0.62} fill="#ffffff" opacity="0.05" filter="url(#mmm-soft)" />
        <polygon
          points={`${apex.x},${apex.y} ${baseL.x},${baseL.y} ${baseR.x},${baseR.y}`}
          fill="none"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={6}
          strokeLinejoin="round"
          filter="url(#mmm-soft)"
        />
        <polygon
          points={`${apex.x},${apex.y} ${baseL.x},${baseL.y} ${baseR.x},${baseR.y}`}
          fill="url(#mmm-glass)"
          stroke="url(#mmm-edge)"
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
        {/* the light dispersing inside the glass: entry → the exit face */}
        <polygon
          points={`${EX},${EY} ${apex.x + (baseR.x - apex.x) * 0.24},${apex.y + (baseR.y - apex.y) * 0.24} ${apex.x + (baseR.x - apex.x) * 0.92},${apex.y + (baseR.y - apex.y) * 0.92}`}
          fill="url(#mmm-wedge)"
        />
        {/* facets: the apex line and an inset ghost triangle, slowly turning */}
        <line x1={PX} y1={apex.y} x2={PX} y2={baseL.y} stroke="#ffffff" strokeOpacity="0.1" />
        <polygon
          points={`${PX},${PY - PR * 0.72} ${PX - PR * 0.66},${PY + PR * 0.44} ${PX + PR * 0.66},${PY + PR * 0.44}`}
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.07"
          strokeLinejoin="round"
          style={{ animation: "spin 90s linear infinite", transformBox: "fill-box", transformOrigin: "center" }}
        />
        {/* the caustic: the seven bands smeared under the base */}
        <line x1={PX - PR * 0.86} y1={PY + PR * 0.74} x2={PX + PR * 0.86} y2={PY + PR * 0.74} stroke="url(#mmm-caustic)" strokeWidth={2.2} strokeLinecap="round" opacity="0.95" />
        <line x1={PX - PR * 0.86} y1={PY + PR * 0.74} x2={PX + PR * 0.86} y2={PY + PR * 0.74} stroke="url(#mmm-caustic)" strokeWidth={9} strokeLinecap="round" opacity="0.3" filter="url(#mmm-soft)" />
        {/* the entry hotspot, ON the face — it carries the joint */}
        <circle cx={EX} cy={EY} r={7} fill="#ffffff" opacity="0.4" filter="url(#mmm-soft)" />
        <circle cx={EX} cy={EY} r={2.6} fill="#ffffff" opacity="0.95" />

        {/* the fan: share-sized, gradient-bodied, each ray born on the face,
            labeled at the ends with the dollars it carried (the designer 2026-08-16:
            "show the money dispersion per outcome, not just %") */}
        {shown.map((d, i) => {
          const share = grand > 0 ? totals[d.key] / grand : 0;
          const p = outPath(i);
          const wpx = Math.max(1, Math.min(5.5, share * 11));
          return (
            <g key={d.key}>
              <path d={p.d} fill="none" stroke={d.color} strokeOpacity="0.11" strokeWidth={wpx + 9} filter="url(#mmm-soft)" />
              <path d={p.d} fill="none" stroke={`url(#mmm-out-${d.key})`} strokeWidth={wpx} />
              {/* the emission port on the glass */}
              <circle cx={p.sx} cy={p.sy} r={1.8} fill={d.color} opacity="0.9" />
              <text x={848} y={p.y + 4} fontSize="11.5" fontWeight="600" fill={d.color}>
                {d.label}
                {ready && (
                  <>
                    <tspan fill="#e8edf4" fontFamily="ui-monospace, monospace">
                      {" "}
                      {fmtUsd(totals[d.key])}
                    </tspan>
                    <tspan fill="#7c8a9d" fontSize="10" fontFamily="ui-monospace, monospace">
                      {" "}
                      · {(share * 100).toFixed(share >= 0.095 ? 0 : 1)}%
                    </tspan>
                  </>
                )}
              </text>
            </g>
          );
        })}

        {/* live flow: ambient dots riding every active lane (hidden under
            reduced motion via the arbitrary variant — it always compiles) */}
        <g className="[@media(prefers-reduced-motion:reduce)]:hidden">
          {sources.map((s, i) => (
            <circle key={`in-${s.label}`} r="1.7" fill="#ffffff" opacity="0.55">
              <animateMotion dur={`${4.6 + i * 0.9}s`} begin={`${i * 1.4}s`} repeatCount="indefinite" path={inPath(i).d} />
            </circle>
          ))}
          {shown.map((d, i) => (
            <circle key={`out-${d.key}`} r="1.7" fill={d.color} opacity="0.6">
              <animateMotion dur={`${5 + i * 0.8}s`} begin={`${i * 0.9}s`} repeatCount="indefinite" path={outPath(i).d} />
            </circle>
          ))}
        </g>
      </svg>
    </Link>
  );
}
