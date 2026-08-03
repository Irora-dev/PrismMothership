"use client";

import { useEffect, useRef } from "react";

// inner → outer rings, violet core to red rim (a spectrum splitting outward)
const RING_COLORS = ["#c06aff", "#7c8bff", "#3bd9ff", "#5cff8f", "#ffe14d", "#ff9f45", "#ff5a5a"];

/**
 * A circular field of rainbow pixels that pulses with the music — a halo that
 * frames the album art. Each concentric ring maps to a frequency band (bass at
 * the core, treble at the rim); when no analyser is live it breathes gently.
 */
export function ReactiveRainbow({
  playing,
  getLevels,
  burst = 0,
  className,
}: {
  playing: boolean;
  getLevels?: (bands: number) => Float32Array | null;
  /** Increment this to fire a one-shot "party" burst (e.g. when a fee lands). */
  burst?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const levelsRef = useRef(getLevels);
  levelsRef.current = getLevels;
  const burstSeenRef = useRef(burst);
  const burstAtRef = useRef(-9999);

  useEffect(() => {
    if (burst !== burstSeenRef.current) {
      burstSeenRef.current = burst;
      if (burst > 0) burstAtRef.current = (typeof performance !== "undefined" ? performance.now() : Date.now());
    }
  }, [burst]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const RINGS = RING_COLORS.length;
    const smoothed = new Array(RINGS).fill(0);
    let energy = 0;
    let t = 0;
    let raf = 0;
    const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      t += 0.016;
      const W = canvas.width;
      const H = canvas.height;
      const cx = W / 2;
      const cy = H / 2;
      ctx.clearRect(0, 0, W, H);

      // one-shot party burst (fires when `burst` increments — e.g. a fee lands)
      const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
      const bAge = nowMs - burstAtRef.current;
      const burstF = bAge >= 0 && bAge < 1100 ? Math.pow(1 - bAge / 1100, 1.7) : 0;

      const active = playingRef.current;
      const live = active ? levelsRef.current?.(RINGS) ?? null : null;

      // overall pulse
      let eTarget = 0;
      if (live) {
        for (let i = 0; i < RINGS; i++) eTarget += live[i];
        eTarget /= RINGS;
      } else if (active) {
        eTarget = 0.25 + 0.2 * (0.5 + 0.5 * Math.sin(t * 2.1));
      } else {
        eTarget = 0.06;
      }
      energy += (eTarget - energy) * 0.2;

      const maxR = Math.min(W, H) * 0.5 - 6 * dpr;
      const innerR = maxR * 0.58; // clear centre for the artwork
      const cell = Math.max(2.5 * dpr, (maxR - innerR) / RINGS / 1.8);

      // burst bloom behind the rings — a quick rainbow flash
      if (burstF > 0.02) {
        const hue = (t * 90) % 360;
        const g = ctx.createRadialGradient(cx, cy, innerR * 0.25, cx, cy, maxR * 1.15);
        g.addColorStop(0, `hsla(${hue}, 100%, 72%, ${0.3 * burstF})`);
        g.addColorStop(1, "hsla(0,0%,100%,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }

      for (let r = 0; r < RINGS; r++) {
        let lvl: number;
        if (live) lvl = Math.min(1, live[r] * (1 + (r / RINGS) * 0.6));
        else if (active) lvl = 0.16 + 0.14 * (0.5 + 0.5 * Math.sin(t * 1.6 + r * 0.8));
        else lvl = 0.05 + 0.02 * (0.5 + 0.5 * Math.sin(t * 0.9 + r));
        smoothed[r] += (lvl - smoothed[r]) * (live ? 0.4 : 0.12);
        const L = smoothed[r];

        const radius = innerR + ((r + 0.5) / RINGS) * (maxR - innerR) + L * maxR * 0.16 + energy * maxR * 0.05 + burstF * maxR * 0.2;
        const count = Math.max(10, Math.round((2 * Math.PI * radius) / (cell * 2.6)));
        const rot = t * (0.12 + r * 0.015 + burstF * 0.6) * (r % 2 ? -1 : 1);
        const color = RING_COLORS[r];

        ctx.fillStyle = color;
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2 + rot;
          // angular shimmer so pixels twinkle rather than sit static
          const sh = 0.5 + 0.5 * Math.sin(a * 3 + t * 3 + r);
          const alpha = Math.min(1, 0.18 + L * 1.1 + sh * 0.18 * (active ? 1 : 0.4) + burstF * 0.55);
          const sz = cell * (0.7 + L * 1.6 + sh * 0.25 + burstF * 1.6);
          const x = cx + Math.cos(a) * radius;
          const y = cy + Math.sin(a) * radius;
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          const rad = Math.min(sz / 2, 2 * dpr);
          // rounded square pixel
          ctx.roundRect ? ctx.roundRect(x - sz / 2, y - sz / 2, sz, sz, rad) : ctx.rect(x - sz / 2, y - sz / 2, sz, sz);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      raf = document.hidden ? 0 : requestAnimationFrame(draw);
    };
    draw();

    // A tab playing audio isn't throttled by the browser, so pause rendering
    // while hidden — otherwise this keeps burning frames in the background.
    const onVisibility = () => {
      if (document.hidden) {
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
      } else if (!raf) {
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
}
