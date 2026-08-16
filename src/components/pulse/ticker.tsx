"use client";

import type { ActivityEvent } from "@/lib/feed/types";
import { eventColor, headline } from "@/lib/feed/format";

function Chip({ e, ethUsd, onOpen }: { e: ActivityEvent; ethUsd: number; onOpen?: (e: ActivityEvent) => void }) {
  const color = eventColor(e);
  const inner = (
    <>
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: color, boxShadow: `0 0 8px ${color}` }}
      />
      {headline(e, ethUsd)}
      <span className="text-slate-600 ml-3">/</span>
    </>
  );
  if (!onOpen) return <span className="inline-flex items-center gap-2 px-4 text-[13px] text-slate-300 font-medium">{inner}</span>;
  // tabIndex -1 on purpose: the marquee doubles every item for its loop, so
  // making these focusable would put ~36 tab stops of repeated ambience in
  // front of every page's content. Pointer/touch opens the detail; keyboard
  // users get the same events properly on /command. The strip pauses on hover
  // (.ticker-mask:hover), so the target holds still under the cursor.
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={() => onOpen(e)}
      title="See the details"
      className="inline-flex cursor-pointer items-center gap-2 px-4 text-[13px] font-medium text-slate-300 transition-opacity hover:opacity-75"
    >
      {inner}
    </button>
  );
}

export function Ticker({ events, ethUsd = 0, onOpen }: { events: ActivityEvent[]; ethUsd?: number; onOpen?: (e: ActivityEvent) => void }) {
  const items = events.slice(0, 18);
  if (items.length === 0) return null;
  // duplicate for a seamless -50% loop
  const loop = [...items, ...items];
  const dur = Math.max(28, items.length * 3.2);

  return (
    // solid-enough ground: site-wide the strip rides over bright page heroes,
    // where the old near-transparent wash left the chips unreadable
    <div className="ticker-mask relative w-full overflow-hidden border-y border-white/[0.06] bg-black/45 py-2.5 backdrop-blur-sm">
      {/* aria-hidden: an infinite marquee of doubled chips is noise to a
          screen reader; the same events live accessibly on /command */}
      <div className="ticker-track" aria-hidden style={{ ["--ticker-dur" as string]: `${dur}s` }}>
        {loop.map((e, i) => (
          <Chip key={`${e.id}-${i}`} e={e} ethUsd={ethUsd} onOpen={onOpen} />
        ))}
      </div>
      {/* edge fades */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-20 bg-gradient-to-r from-black to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-20 bg-gradient-to-l from-black to-transparent" />
    </div>
  );
}
