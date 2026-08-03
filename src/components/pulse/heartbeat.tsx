"use client";

import { useEffect, useRef, useState } from "react";
import type { ActivityEvent } from "@/lib/feed/types";
import { eventColor, eventColor2 } from "@/lib/feed/format";
import { CountUp } from "./count-up";

// One 800-wide EKG tile; two are laid end-to-end and scrolled for a seamless loop.
const TILE =
  "M0,40 L70,40 L84,40 L92,34 L100,40 L150,40 L168,40 L176,52 L184,12 L192,58 L200,40 L210,40 L226,32 L240,40 L300,40 " +
  "L370,40 L384,40 L392,34 L400,40 L450,40 L468,40 L476,52 L484,12 L492,58 L500,40 L510,40 L526,32 L540,40 L600,40 " +
  "L670,40 L684,40 L692,34 L700,40 L750,40 L768,40 L776,52 L784,12 L792,58 L800,40";

type Ping = { key: number; color: string; color2?: string };

export function Heartbeat({
  events,
  eventsPerMin,
  mode,
}: {
  events: ActivityEvent[];
  eventsPerMin?: number;
  mode: "live" | "demo" | null;
}) {
  const [pings, setPings] = useState<Ping[]>([]);
  const [beat, setBeat] = useState<{ color: string; key: number } | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  useEffect(() => {
    // Prime on the first non-empty batch so we don't fire a burst of pings for
    // the backlog on load — only genuinely new events pulse from then on.
    if (!primed.current) {
      if (events.length === 0) return;
      for (const e of events) seen.current.add(e.id);
      primed.current = true;
      return;
    }
    const fresh = events.filter((e) => !seen.current.has(e.id));
    if (!fresh.length) return;
    for (const e of fresh) seen.current.add(e.id);
    if (seen.current.size > 600) seen.current = new Set(events.map((e) => e.id));

    const base = Date.now();
    const added: Ping[] = fresh
      .slice(0, 6)
      .map((e, i) => ({ key: base + i, color: eventColor(e), color2: eventColor2(e) }));
    setPings((p) => [...p, ...added].slice(-8));
    setBeat({ color: eventColor(fresh[0]), key: base }); // newest sets the line/endpoint colour
    const t = setTimeout(
      () => setPings((p) => p.filter((x) => !added.some((a) => a.key === x.key))),
      1500,
    );
    return () => clearTimeout(t);
  }, [events]);

  // live rate from the newest dozen feed events over their actual time span
  const recent = events.slice(0, 12);
  const spanMin =
    recent.length >= 2 ? Math.max((recent[0].ts - recent[recent.length - 1].ts) / 60_000, 0.5) : 1;
  const perMin = recent.length >= 2 ? Math.round(recent.length / spanMin) : Math.round(eventsPerMin ?? 0);
  // faster scroll when the ecosystem is busier
  const dur = Math.max(3.5, 11 - perMin * 0.35);
  const beatColor = beat?.color ?? "#a855f7";

  return (
    <div className="glass-card p-5 relative overflow-hidden">
      {/* whole-panel colour wash, re-fired per beat (colour = the action) */}
      {beat && (
        <span
          key={beat.key}
          className="hb-flash pointer-events-none absolute inset-0 z-0"
          style={{ background: `radial-gradient(120% 80% at 92% 50%, ${beatColor}, transparent 60%)` }}
          aria-hidden
        />
      )}

      <div className="flex items-center justify-between mb-3 relative z-10">
        <div className="flex items-center gap-2">
          <span className={`pulse-live-dot ${mode === "demo" ? "demo" : ""}`} />
          <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold">
            Ecosystem heartbeat
          </span>
        </div>
        <div className="font-mono text-sm txt-white font-bold">
          <CountUp value={perMin} format={(n) => n.toFixed(0)} />
          <span className="text-slate-500 text-[11px] font-medium ml-1">events / min</span>
        </div>
      </div>

      <div className="relative h-20 w-full overflow-hidden">
        <svg viewBox="0 0 800 80" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
          <defs>
            <linearGradient id="ekgFade" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#a855f7" stopOpacity="0.05" />
              <stop offset="35%" stopColor={beatColor} stopOpacity="0.85" />
              <stop offset="100%" stopColor={beatColor} stopOpacity="0.95" />
            </linearGradient>
          </defs>
          <g className="ekg-scroll" style={{ ["--ekg-dur" as string]: `${dur}s` }}>
            <path d={TILE} fill="none" stroke="url(#ekgFade)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d={TILE} transform="translate(800,0)" fill="none" stroke="url(#ekgFade)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </svg>

        {/* live endpoint with emitted ripples — one per event, in the action's colour */}
        <div className="absolute top-1/2 right-3 -translate-y-1/2">
          {pings.map((p) => (
            <span key={p.key}>
              <span
                className="ekg-ping absolute rounded-full -translate-x-1/2 -translate-y-1/2"
                style={{ width: 22, height: 22, border: `2px solid ${p.color}`, left: 0, top: 0 }}
              />
              {p.color2 && (
                <span
                  className="ekg-ping absolute rounded-full -translate-x-1/2 -translate-y-1/2"
                  style={{ width: 22, height: 22, border: `2px solid ${p.color2}`, left: 0, top: 0, animationDelay: "0.12s" }}
                />
              )}
            </span>
          ))}
          <span
            key={beat?.key ?? "idle"}
            className="ekg-beat block rounded-full"
            style={{ width: 11, height: 11, background: beatColor, boxShadow: `0 0 14px ${beatColor}` }}
          />
        </div>
      </div>

      <div className="text-[11px] text-slate-500 mt-2 relative z-10">
        Every blip is value moving through Prism or a Spectrum index, then converging back into PRISM.
      </div>
    </div>
  );
}
