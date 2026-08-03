"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useActivityFeed } from "@/hooks/useActivityFeed";
import type { ActivityEvent } from "@/lib/feed/types";

const PALETTE = ["#ff5a5a", "#ffb14d", "#ffe14d", "#5cff8f", "#3bd9ff", "#7c8bff", "#c06aff", "#ff5ac8"];
const pick = () => PALETTE[Math.floor(Math.random() * PALETTE.length)];

interface Spark {
  dx: number;
  dy: number;
  color: string;
}
interface Burst {
  id: string;
  top: number; // %
  left: number; // %
  label: string;
  sub: string;
  color: string;
  dur: number;
  sparks: Spark[];
}

// Every revenue event that flows through PRISM detonates a little rainbow burst on
// the page: a shockwave ring, a spray of pixel sparks, and its value rising + fading.
// Driven by the same live activity feed as the dashboard.
export function FeeStreaks() {
  const { events, stats } = useActivityFeed();
  const ethUsd = stats?.ethUsd ?? 0;
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [bursts, setBursts] = useState<Burst[]>([]);

  useEffect(() => {
    const toBurst = (e: ActivityEvent): Burst => {
      const usd = e.usd ?? (e.eth != null && ethUsd ? e.eth * ethUsd : undefined);
      const label =
        usd != null
          ? `$${usd < 100 ? usd.toFixed(2) : Math.round(usd).toLocaleString()}`
          : e.eth != null
            ? `Ξ${e.eth.toFixed(4)}`
            : "revenue";
      const sub = e.source === "spectrum-index" ? "index swap revenue" : "LP revenue → holders";
      const n = 8;
      const sparks: Spark[] = Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
        const d = 44 + Math.random() * 56;
        return { dx: Math.cos(a) * d, dy: Math.sin(a) * d, color: pick() };
      });
      return {
        id: `${e.id}:${Math.random().toString(36).slice(2, 6)}`,
        top: 24 + Math.random() * 48,
        left: 16 + Math.random() * 68,
        label,
        sub,
        color: pick(),
        dur: 2.6 + Math.random() * 1.1,
        sparks,
      };
    };
    const push = (e: ActivityEvent) => setBursts((prev) => [...prev, toBurst(e)].slice(-7));

    const fees = events.filter((e) => e.kind === "fee");
    // Wait for the first real batch, then mark it seen (so the existing backlog
    // doesn't detonate all at once) and fire a short intro wave from the latest few.
    if (!primed.current) {
      if (!events.length) return;
      for (const e of fees) seen.current.add(e.id);
      primed.current = true;
      fees.slice(0, 3).forEach((e, i) => {
        timers.current.push(setTimeout(() => push(e), 450 + i * 750));
      });
      return;
    }
    const fresh = fees.filter((e) => !seen.current.has(e.id));
    if (!fresh.length) return;
    for (const e of fresh) seen.current.add(e.id);
    fresh.slice(0, 4).forEach(push);
  }, [events, ethUsd]);

  useEffect(() => {
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, []);

  const remove = (id: string) => setBursts((prev) => prev.filter((b) => b.id !== id));

  return (
    <div className="pointer-events-none fixed inset-0 z-[15] overflow-hidden" aria-hidden>
      {bursts.map((b) => (
        <div key={b.id} className="absolute" style={{ top: `${b.top}%`, left: `${b.left}%` }}>
          {/* shockwave ring */}
          <span
            className="fee-ring absolute left-0 top-0 rounded-full"
            style={{
              width: 116,
              height: 116,
              border: `2px solid ${b.color}`,
              boxShadow: `0 0 26px ${b.color}99, inset 0 0 22px ${b.color}55`,
            }}
          />
          {/* pixel sparks flung outward */}
          {b.sparks.map((s, i) => (
            <span
              key={i}
              className="fee-spark absolute left-0 top-0"
              style={
                {
                  width: 6,
                  height: 6,
                  borderRadius: 1,
                  background: s.color,
                  boxShadow: `0 0 8px ${s.color}`,
                  ["--dx"]: `${s.dx}px`,
                  ["--dy"]: `${s.dy}px`,
                } as CSSProperties
              }
            />
          ))}
          {/* value chip rises + fades; its end drives removal */}
          <span
            className="fee-burst absolute left-0 top-0 flex items-center gap-2 rounded-full border px-3.5 py-1.5 whitespace-nowrap"
            style={
              {
                borderColor: `${b.color}66`,
                background: "rgba(8,10,16,0.82)",
                boxShadow: `0 0 28px ${b.color}66`,
                ["--dur"]: `${b.dur}s`,
              } as CSSProperties
            }
            onAnimationEnd={() => remove(b.id)}
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: b.color, boxShadow: `0 0 10px ${b.color}` }} />
            <span className="font-mono text-base md:text-lg font-bold spectrum-text-gradient">{b.label}</span>
            <span className="text-[9px] uppercase tracking-wider text-slate-400">{b.sub}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
