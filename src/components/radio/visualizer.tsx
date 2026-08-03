"use client";

import { useEffect, useRef } from "react";

const COLORS = ["#ff5a5a", "#ff9f45", "#ffe14d", "#5cff8f", "#3bd9ff", "#7c8bff", "#c06aff"];

// A rainbow spectrum equalizer — PRISM splitting the sound into colour. When a live
// Web Audio analyser is available (getLevels), the bars track the real FFT; otherwise
// they fall back to smooth synthetic motion that comes alive while playing.
export function Visualizer({
  playing,
  className,
  getLevels,
}: {
  playing: boolean;
  className?: string;
  getLevels?: (bands: number) => Float32Array | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const levelsRef = useRef(getLevels);
  levelsRef.current = getLevels;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const N = 56;
    const bars = new Array(N).fill(0.04);
    const seeds = bars.map((_, i) => i * 0.7 + Math.random() * 2);
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

    const rr = (x: number, y: number, w: number, h: number, r: number) => {
      r = Math.min(r, w / 2, h);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };

    const draw = () => {
      t += 0.016;
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      const grad = ctx.createLinearGradient(0, 0, W, 0);
      COLORS.forEach((c, i) => grad.addColorStop(i / (COLORS.length - 1), c));

      const active = playingRef.current;
      const live = active ? levelsRef.current?.(N) ?? null : null;
      const slot = W / N;
      const gap = slot * 0.38;
      const bw = slot - gap;

      ctx.fillStyle = grad;
      for (let i = 0; i < N; i++) {
        const s = seeds[i];
        let target: number;
        if (live) {
          // real FFT — gently boost highs (they read quiet) and add a tiny floor
          const v = Math.min(1, live[i] * (1 + (i / N) * 0.7));
          target = 0.05 + 0.95 * Math.pow(v, 0.82);
        } else if (active) {
          const env =
            (0.5 + 0.5 * Math.sin(t * 2.3 + s)) *
            (0.4 + 0.6 * Math.sin(t * 0.9 + s * 0.5 + Math.sin(t * 0.27) * 2)) *
            (0.6 + 0.4 * Math.sin(t * 4.1 + s * 1.7));
          target = 0.07 + 0.93 * Math.max(0, env);
        } else {
          target = 0.04 + 0.025 * (0.5 + 0.5 * Math.sin(t * 1.2 + s));
        }
        // snappier rise on live audio so it tracks the beat
        bars[i] += (target - bars[i]) * (live ? 0.4 : active ? 0.16 : 0.07);
        const h = Math.max(2 * dpr, bars[i] * H);
        const x = i * slot + gap / 2;
        rr(x, H - h, bw, h, Math.min(bw / 2, 5 * dpr));
        ctx.fill();
      }
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
