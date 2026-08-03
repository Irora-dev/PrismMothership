"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

const EASE_CSS = "cubic-bezier(0.16,1,0.3,1)";

interface PixelRevealProps {
  children: ReactNode;
  /** ms after mount before the build sequence starts */
  delay?: number;
  /** flash / dissolve colour */
  accent?: string;
  /** rough cap on pixel count — grid spacing scales to the card so big cards stay light */
  maxPixels?: number;
  className?: string;
  style?: CSSProperties;
}

// Animation timeline (ms, from the moment the build starts).
const FLY_MS = 600; // a pixel's flight from off-grid into its cell
const SETTLE_MS = 380; // white flash → slate settle
const DISSOLVE_AT = 950; // when content cross-fades in + pixels start leaving
const DISSOLVE_MS = 700; // a pixel's dissolve (fade + drift + shrink)
const DISSOLVE_SPREAD = 380; // random per-pixel stagger on the dissolve
const TOTAL_MS = DISSOLVE_AT + DISSOLVE_SPREAD + DISSOLVE_MS + 140;

const SLATE: [number, number, number] = [51, 65, 85]; // #334155
const WHITE: [number, number, number] = [255, 255, 255];

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
// ease-out with a touch of overshoot (≈ the old cubic-bezier(0.2,0.8,0.2,1.1))
const easeOutBack = (t: number) => {
  const s = 1.2;
  const u = t - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
};
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const int = parseInt(n, 16);
  if (Number.isNaN(int)) return [34, 211, 238];
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

interface Pixel {
  tx: number; // target cell x (css px)
  ty: number; // target cell y (css px)
  sx: number; // off-grid start x
  sy: number; // off-grid start y
  rot0: number; // start rotation (rad)
  scale0: number;
  flyDelay: number; // stagger top→bottom
  dissolveDelay: number;
  driftY: number;
}

/**
 * Overlays a card with a field of pixels that fly in from random angles, snap
 * into a grid (staggered, flashing white→settle), then flash the accent colour
 * and dissolve as the real content fades/unblurs in underneath.
 *
 * Rendered on a single <canvas> rather than hundreds of DOM nodes: animating a
 * few hundred elements with box-shadow forces an expensive per-node paint +
 * composite every frame (a known Chromium cost), whereas the canvas is one
 * composited layer with cheap fills. Identical look, a fraction of the work.
 */
export function PixelReveal({
  children,
  delay = 0,
  accent = "#22d3ee",
  maxPixels = 240,
  className = "",
  style,
}: PixelRevealProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const content = contentRef.current;
    if (!root || !canvas || !content) return;

    const reveal = () => {
      content.style.opacity = "1";
      content.style.transform = "none";
      content.style.filter = "none";
    };

    // reduced motion → skip straight to content
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      reveal();
      return;
    }

    let cancelled = false;
    let raf = 0;
    let startTs = 0;
    let contentShown = false;
    const timers: number[] = [];
    const [ar, ag, ab] = hexRgb(accent);

    const run = () => {
      if (cancelled) return;
      const rect = root.getBoundingClientRect();
      const W = Math.round(rect.width);
      const H = Math.round(rect.height);
      if (W < 4 || H < 4) { timers.push(window.setTimeout(run, 120)); return; } // not laid out yet

      const ctx = canvas.getContext("2d");
      if (!ctx) { reveal(); return; }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.scale(dpr, dpr);

      const spacing = Math.max(14, Math.sqrt((W * H) / maxPixels));
      const cols = Math.ceil(W / spacing);
      const rows = Math.ceil(H / spacing);
      const size = Math.max(4, Math.min(Math.round(spacing * 0.5), 14));
      const radius = Math.min(2, size / 4);
      const maxTy = rows * spacing;

      const pix: Pixel[] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const tx = Math.round(c * spacing + (spacing - size) / 2);
          const ty = Math.round(r * spacing + (spacing - size) / 2);
          const ang = Math.random() * Math.PI * 2;
          const dist = 160 + Math.random() * 220;
          pix.push({
            tx,
            ty,
            sx: tx + Math.cos(ang) * dist,
            sy: ty + Math.sin(ang) * dist,
            rot0: (Math.random() - 0.5) * (540 * Math.PI) / 180,
            scale0: Math.random() * 0.5,
            flyDelay: (ty / maxTy) * 280 + Math.random() * 150,
            dissolveDelay: Math.random() * DISSOLVE_SPREAD,
            driftY: 4 + Math.random() * 10,
          });
        }
      }

      const fillPixel = (x: number, y: number, s: number, rot: number) => {
        if (rot !== 0) {
          ctx.save();
          ctx.translate(x + size / 2, y + size / 2);
          ctx.rotate(rot);
          if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(-s / 2, -s / 2, s, s, radius); ctx.fill(); }
          else ctx.fillRect(-s / 2, -s / 2, s, s);
          ctx.restore();
        } else if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(x + (size - s) / 2, y + (size - s) / 2, s, s, radius);
          ctx.fill();
        } else {
          ctx.fillRect(x + (size - s) / 2, y + (size - s) / 2, s, s);
        }
      };

      const frame = (ts: number) => {
        if (cancelled) return;
        if (!startTs) startTs = ts;
        const el = ts - startTs;

        if (!contentShown && el >= DISSOLVE_AT) {
          contentShown = true;
          content.style.opacity = "1";
          content.style.transform = "scale(1)";
          content.style.filter = "blur(0px)";
        }

        ctx.clearRect(0, 0, W, H);

        for (let i = 0; i < pix.length; i++) {
          const p = pix[i];
          const fp = clamp01((el - p.flyDelay) / FLY_MS);
          if (fp <= 0) continue; // hasn't taken off yet

          const dp = clamp01((el - (DISSOLVE_AT + p.dissolveDelay)) / DISSOLVE_MS);

          let x: number, y: number, scale: number, rot: number, alpha: number;
          if (dp <= 0) {
            // assembling → settled (white flash easing down to slate)
            const e = easeOutBack(fp);
            x = lerp(p.sx, p.tx, e);
            y = lerp(p.sy, p.ty, e);
            scale = lerp(p.scale0, 1, clamp01(fp * 1.3));
            rot = p.rot0 * (1 - easeOutExpo(fp));
            alpha = clamp01(fp * 3);
            const settle = clamp01((el - (p.flyDelay + 110)) / SETTLE_MS);
            ctx.fillStyle = `rgb(${Math.round(lerp(WHITE[0], SLATE[0], settle))},${Math.round(lerp(WHITE[1], SLATE[1], settle))},${Math.round(lerp(WHITE[2], SLATE[2], settle))})`;
          } else if (dp < 1) {
            // dissolving → accent, drifting up, shrinking, fading out
            const e = easeOutExpo(dp);
            x = p.tx;
            y = p.ty - p.driftY * e;
            scale = lerp(1, 0.55, e);
            rot = 0;
            alpha = 1 - dp;
            ctx.fillStyle = `rgb(${ar},${ag},${ab})`;
          } else {
            continue; // gone
          }

          if (alpha <= 0.01) continue;
          ctx.globalAlpha = alpha;
          fillPixel(x, y, size * scale, rot);
        }
        ctx.globalAlpha = 1;

        if (el >= TOTAL_MS) {
          // settle the content into a clean box (no transform/filter so sticky
          // children behave) and drop the canvas — loop ends here.
          content.style.transform = "none";
          content.style.filter = "none";
          ctx.clearRect(0, 0, W, H);
          canvas.style.display = "none";
          return;
        }
        raf = requestAnimationFrame(frame);
      };

      canvas.style.opacity = "1";
      raf = requestAnimationFrame(frame);
    };

    timers.push(window.setTimeout(run, delay));
    return () => {
      cancelled = true;
      timers.forEach((t) => clearTimeout(t));
      cancelAnimationFrame(raf);
    };
  }, [delay, accent, maxPixels]);

  return (
    <div ref={rootRef} className={`relative ${className}`} style={style}>
      <div
        ref={contentRef}
        style={{
          opacity: 0,
          transform: "scale(0.97)",
          filter: "blur(10px)",
          transition: `opacity 1s ${EASE_CSS}, transform 1s ${EASE_CSS}, filter 1s ${EASE_CSS}`,
          willChange: "opacity, transform, filter",
        }}
      >
        {children}
      </div>
      <canvas
        ref={canvasRef}
        aria-hidden
        className="absolute inset-0 z-30 h-full w-full pointer-events-none"
        style={{ opacity: 0 }}
      />
    </div>
  );
}
