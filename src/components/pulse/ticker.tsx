"use client";

import type { ActivityEvent } from "@/lib/feed/types";
import { eventColor, headline } from "@/lib/feed/format";

function Chip({ e, ethUsd }: { e: ActivityEvent; ethUsd: number }) {
  const color = eventColor(e);
  return (
    <span className="inline-flex items-center gap-2 px-4 text-[13px] text-slate-300 font-medium">
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: color, boxShadow: `0 0 8px ${color}` }}
      />
      {headline(e, ethUsd)}
      <span className="text-slate-600 ml-3">/</span>
    </span>
  );
}

export function Ticker({ events, ethUsd = 0 }: { events: ActivityEvent[]; ethUsd?: number }) {
  const items = events.slice(0, 18);
  if (items.length === 0) return null;
  // duplicate for a seamless -50% loop
  const loop = [...items, ...items];
  const dur = Math.max(28, items.length * 3.2);

  return (
    <div className="ticker-mask relative w-full overflow-hidden border-y border-white/[0.06] bg-white/[0.015] py-2.5">
      <div className="ticker-track" style={{ ["--ticker-dur" as string]: `${dur}s` }}>
        {loop.map((e, i) => (
          <Chip key={`${e.id}-${i}`} e={e} ethUsd={ethUsd} />
        ))}
      </div>
      {/* edge fades */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-20 bg-gradient-to-r from-black to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-20 bg-gradient-to-l from-black to-transparent" />
    </div>
  );
}
