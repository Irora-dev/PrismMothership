import { ImageResponse } from "next/og";

// The money map's own share card: white light into the prism, the spectrum
// out — so sharing /flow unfurls as the surface itself instead of the generic
// site card. Same conventions as the root og image: Satori flexbox + inline
// styles, force-dynamic (build-time prerender would bake the fallback), the
// graphic emitted as an SVG data URI. The beams here are ILLUSTRATION, not
// measured widths — the only figure on the card is the measured lifetime
// revenue, same source as the root card.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "The money map · fees enter as light, the prism splits them to everyone they belong to";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const DEST = [
  { label: "Holders", color: "#00FF87" },
  { label: "Creators", color: "#00F0FF" },
  { label: "Interfaces", color: "#9D00FF" },
  { label: "Creator league", color: "#FACC15" },
  { label: "The Burn", color: "#FF5E00" },
];

const usd0 = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

// The prism composition as one SVG: three white in-beams, the glass, five
// colored out-beams, and the rainbow caustic under the base. The caustic's
// gradient is userSpaceOnUse — a gradient with default objectBoundingBox
// units on a horizontal line has a zero-height bbox and paints NOTHING (the
// live map's caustic was invisible for three builds because of exactly this).
function prismArt(w: number, h: number) {
  const cx = w / 2;
  const cy = h * 0.52;
  const apexY = h * 0.1;
  const baseY = h * 0.82;
  const half = (baseY - apexY) * 0.6;
  const inX = cx - half * 0.45;
  const outX = cx + half * 0.42;
  // in-beams converge on the entry point with a gentle bow toward it — a
  // control point held at the start's own y read as parentheses, not light
  const ins = [
    { y: h * 0.22, w: 7, o: 0.75 },
    { y: cy, w: 10, o: 0.9 },
    { y: h * 0.8, w: 5, o: 0.6 },
  ]
    .map(
      (b) =>
        `<path d="M 0 ${b.y} Q ${inX * 0.55} ${b.y + (cy - b.y) * 0.35}, ${inX} ${cy}" stroke="#ffffff" stroke-opacity="${b.o}" stroke-width="${b.w}" fill="none" stroke-linecap="round"/>`,
    )
    .join("");
  // out-beams LEAVE FROM the right face itself: start points sit on the
  // apex→base-right line, so no beam pokes through the glass edge
  const faceTip = { x: cx, y: apexY };
  const faceFoot = { x: cx + half * 0.92, y: baseY };
  const onFace = (t: number) => ({ x: faceTip.x + (faceFoot.x - faceTip.x) * t, y: faceTip.y + (faceFoot.y - faceTip.y) * t });
  const outs = [
    { y: h * 0.08, w: 12, c: DEST[0].color, t: 0.3 },
    { y: h * 0.3, w: 5, c: DEST[1].color, t: 0.44 },
    { y: h * 0.52, w: 4, c: DEST[2].color, t: 0.58 },
    { y: h * 0.72, w: 5, c: DEST[3].color, t: 0.72 },
    { y: h * 0.94, w: 9, c: DEST[4].color, t: 0.86 },
  ]
    .map((b) => {
      const p = onFace(b.t);
      return `<path d="M ${p.x} ${p.y} Q ${p.x + (w - p.x) * 0.55} ${b.y}, ${w} ${b.y}" stroke="${b.c}" stroke-opacity="0.92" stroke-width="${b.w}" fill="none" stroke-linecap="round"/>`;
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <defs>
    <linearGradient id="caustic" gradientUnits="userSpaceOnUse" x1="${cx - half * 0.7}" y1="${baseY + 14}" x2="${cx + half * 0.7}" y2="${baseY + 14}">
      <stop offset="0%" stop-color="#FF5E00"/><stop offset="25%" stop-color="#FACC15"/><stop offset="50%" stop-color="#00FF87"/><stop offset="75%" stop-color="#00F0FF"/><stop offset="100%" stop-color="#9D00FF"/>
    </linearGradient>
    <radialGradient id="aura" cx="50%" cy="52%" r="50%">
      <stop offset="0%" stop-color="#7c8bff" stop-opacity="0.22"/><stop offset="100%" stop-color="#7c8bff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="${cx}" cy="${cy}" r="${half * 1.5}" fill="url(#aura)"/>
  ${ins}
  ${outs}
  <polygon points="${cx},${apexY} ${cx - half * 0.92},${baseY} ${cx + half * 0.92},${baseY}" fill="rgba(150,180,255,0.07)" stroke="#dbeafe" stroke-opacity="0.85" stroke-width="3"/>
  <circle cx="${inX}" cy="${cy}" r="9" fill="#ffffff"/>
  <rect x="${cx - half * 0.7}" y="${baseY + 12}" width="${half * 1.4}" height="4" rx="2" fill="url(#caustic)" opacity="0.9"/>
</svg>`;
  return { src: `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`, w, h };
}

// Same live read as the root card, same fallback discipline: the only figure
// shown is measured or absent, never invented.
async function lifetime(): Promise<number | null> {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || "https://prismbeat.netlify.app";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`${base}/api/feed`, { signal: AbortSignal.timeout(attempt === 0 ? 6000 : 9000), cache: "no-store" });
      if (!r.ok) continue;
      const s = ((await r.json()) as { stats?: Record<string, number> }).stats ?? {};
      const usd = (s.feesToHoldersTotal || 0) * (s.ethUsd || 0);
      if (usd > 0) return Math.round(usd);
    } catch {
      /* retry once, then no figure */
    }
  }
  return null;
}

export default async function FlowOpengraphImage() {
  const revenue = await lifetime();
  const art = prismArt(660, 430);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          padding: 64,
          background: "radial-gradient(120% 130% at 44% 42%, #141a2c 0%, #060810 46%, #02030a 100%)",
          color: "#f8fafc",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 450 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", fontSize: 20, letterSpacing: 4, color: "#86efac", fontWeight: 700 }}>
              <div style={{ width: 12, height: 12, borderRadius: 9999, background: "#22c55e", marginRight: 12 }} />
              LIVE · ON-CHAIN
            </div>
            <div style={{ display: "flex", marginTop: 22, fontSize: 64, fontWeight: 800, letterSpacing: -1.5, lineHeight: 1.05 }}>The money map</div>
            <div style={{ display: "flex", marginTop: 16, fontSize: 24, color: "#cbd5e1", lineHeight: 1.35 }}>
              Fees enter as light. The prism splits them to everyone they belong to.
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {revenue != null && (
              <div style={{ display: "flex", flexDirection: "column", marginBottom: 22 }}>
                <div style={{ display: "flex", fontSize: 19, letterSpacing: 3, color: "#86efac", fontWeight: 700 }}>LIFETIME REVENUE TO HOLDERS</div>
                <div style={{ display: "flex", fontSize: 64, fontWeight: 800, color: "#22c55e", lineHeight: 1, marginTop: 6 }}>{usd0(revenue)}</div>
              </div>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
              {DEST.map((d) => (
                <div key={d.label} style={{ display: "flex", alignItems: "center", fontSize: 19, color: "#cbd5e1" }}>
                  <div style={{ width: 10, height: 10, borderRadius: 9999, background: d.color, marginRight: 8 }} />
                  {d.label}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "flex-end" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={art.src} width={art.w} height={art.h} alt="" />
        </div>
      </div>
    ),
    size,
  );
}
