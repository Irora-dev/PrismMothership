"use client";

import { useEffect, useState } from "react";
import { PixelRainbow } from "@/components/effects/pixel-rainbow";

// The first /charts load builds the whole on-chain store (a one-time
// back-scan), which can take ~5–15s live. This placeholder keeps that wait
// fun: skeleton cards with self-drawing waves and an honest, cycling status
// line about what's actually happening.

const MESSAGES = [
  "Connecting to Ethereum & Base…",
  "Scanning basket trades…",
  "Decoding launches…",
  "Counting every burn…",
  "Bucketing months of history…",
  "Pricing fees at the live ETH rate…",
  "Polishing the pixels…",
];

// gently different wave per card so the grid doesn't strobe in unison
const WAVES = [
  "M0,84 C30,80 45,40 75,44 S120,96 150,88 S195,30 225,38 S270,86 300,72 S360,40 400,52",
  "M0,70 C35,90 60,48 95,56 S150,92 185,70 S240,34 275,50 S330,90 400,64",
  "M0,60 C40,44 70,92 105,84 S160,40 200,52 S255,94 295,78 S350,44 400,60",
  "M0,88 C45,72 75,36 115,48 S175,90 215,74 S275,38 315,54 S370,80 400,68",
  "M0,52 C40,68 80,92 120,80 S180,36 220,48 S280,88 320,70 S370,50 400,58",
];

function LoadingCard({ color, wave, wide = false }: { color: string; wave: string; wide?: boolean }) {
  return (
    <div className={`glass-card relative overflow-hidden p-5 ${wide ? "md:col-span-2" : ""}`}>
      <div
        className="absolute -right-14 -top-16 w-48 h-48 rounded-full blur-3xl opacity-[0.1] pointer-events-none"
        style={{ background: color }}
      />
      {/* header skeleton */}
      <div className="relative z-10 animate-pulse">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: color }} />
          <span className="h-2.5 w-28 rounded bg-white/[0.08]" />
        </div>
        <div className="h-7 w-24 rounded bg-white/[0.1] mt-3" />
        <div className="h-2.5 w-36 rounded bg-white/[0.06] mt-2.5" />
      </div>

      {/* a wave drawing itself where the chart will be */}
      <div className="relative z-10 h-[220px] mt-4">
        <svg viewBox="0 0 400 120" preserveAspectRatio="none" className="w-full h-full">
          <path d={wave} fill="none" stroke={`${color}26`} strokeWidth="2" strokeLinecap="round" />
          <path d={wave} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" className="chart-draw" pathLength={600} />
        </svg>
      </div>
    </div>
  );
}

export function ChartsLoading() {
  const [msg, setMsg] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setMsg((m) => (m + 1) % MESSAGES.length), 1900);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      {/* status banner — the prism working through the backlog */}
      <div className="md:col-span-2 glass-card px-5 py-4 flex items-center justify-center gap-3">
        <PixelRainbow className="h-6 w-auto shrink-0" />
        <span key={msg} className="spectrum-load font-mono text-[13px] text-slate-300">
          {MESSAGES[msg]}
        </span>
        <span className="font-mono text-[11px] text-slate-600 hidden sm:inline">first load reads the whole chain; cached after this</span>
      </div>

      <LoadingCard color="#ea580c" wave={WAVES[0]} wide />
      <LoadingCard color="#15803d" wave={WAVES[1]} />
      <LoadingCard color="#059669" wave={WAVES[2]} />
      <LoadingCard color="#6366f1" wave={WAVES[3]} />
      <LoadingCard color="#0d9488" wave={WAVES[4]} />
    </>
  );
}
