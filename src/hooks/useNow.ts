"use client";

import { useEffect, useState } from "react";

// ── One clock for the whole app ──────────────────────────────────────────────
// The Mothership rebrand lost the second hand. The pulse components it replaced
// re-render on a 1s timer, so their ages count up in front of you (3s, 4s, 5s);
// the deck and the fee pipeline compute `ago()` only when a poll lands, so a
// timestamp freezes for 10s on the deck and 30-60s on the pipeline and then
// jumps. On a page whose entire promise is "live, as it lands on-chain", a
// frozen clock is the single most obvious tell.
//
// ONE interval serves every subscriber rather than one per component: a busy
// deck can hold a hundred timestamps, and a hundred intervals firing on their
// own phases is both wasteful and visibly ragged, since they would tick at
// different moments. Shared, everything ticks on the same beat.
//
// It also stops entirely when the tab is hidden. Nobody needs a clock running
// on a background tab, and it resyncs on the way back so the first frame after
// you return is already correct rather than a second stale.

type Sub = (t: number) => void;

const subs = new Set<Sub>();
let timer: ReturnType<typeof setInterval> | null = null;
let visListener = false;

function beat() {
  const t = Date.now();
  for (const s of subs) s(t);
}

function ensureTimer() {
  if (typeof document === "undefined") return;
  const shouldRun = subs.size > 0 && document.visibilityState !== "hidden";
  if (shouldRun && !timer) timer = setInterval(beat, 1000);
  if (!shouldRun && timer) {
    clearInterval(timer);
    timer = null;
  }
  if (!visListener) {
    visListener = true;
    document.addEventListener("visibilitychange", () => {
      ensureTimer();
      if (document.visibilityState !== "hidden") beat(); // resync on return
    });
  }
}

/** The current time, re-rendering the caller once a second.
 *
 *  Returns 0 until mounted, on purpose. `Date.now()` in a useState initializer
 *  is a hydration bug, not a convenience: the server renders one value and the
 *  client another. Callers treat 0 as "not mounted yet" and render the same
 *  markup the server did. */
export function useNow(): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const sub: Sub = (t) => setNow(t);
    subs.add(sub);
    ensureTimer();
    return () => {
      subs.delete(sub);
      ensureTimer();
    };
  }, []);
  return now;
}
