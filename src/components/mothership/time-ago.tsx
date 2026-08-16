"use client";

import { useNow } from "@/hooks/useNow";

// A timestamp that counts up. Deliberately its OWN component rather than a
// `now` threaded through the deck: the deck holds a hundred-odd rows and a
// second-by-second re-render of the whole tree to move one label is the kind of
// thing that turns a live page into a janky one. Subscribing here means only
// the text nodes that actually change re-render.

/** Shared by the component and by the few call sites that build a string. */
export function agoString(ts: number, now: number, short = false): string {
  const s = Math.max(1, Math.floor(((now || Date.now()) - ts) / 1000));
  const v = s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
  return short ? v : `${v} ago`;
}

export function TimeAgo({ ts, short = false, className, style }: { ts: number; short?: boolean; className?: string; style?: React.CSSProperties }) {
  const now = useNow();
  return (
    <span className={className} style={style} suppressHydrationWarning>
      {agoString(ts, now, short)}
    </span>
  );
}
