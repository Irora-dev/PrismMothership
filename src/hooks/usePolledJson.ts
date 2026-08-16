"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Poll a JSON route into state WITHOUT swallowing failure.
 *
 * `catch(() => {})` turned a dead read into an eternal loading state on four
 * different surfaces — dashes and zeros served forever with nothing saying so.
 * This hook tracks the failure instead: `stale` flips true after three
 * consecutive misses (one blip never flags, same rule as the deck's feed
 * banner) and false again on the next good read. A null url idles the hook
 * (e.g. no wallet connected). A hidden tab skips the request, not the timer —
 * the next visible tick refreshes.
 */
export function usePolledJson<T>(url: string | null, intervalMs: number): { data: T | null; stale: boolean; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [stale, setStale] = useState(false);
  const misses = useRef(0);
  // `refresh()` re-reads NOW — for the moment right after a user action lands
  // (a crank mined) when waiting out the poll interval would feel broken. It
  // sends fresh=1 so a server-side route cache cannot answer with the
  // pre-action world (a cranked chip kept saying "crank it" for the cache's
  // lifetime — the designer, live, 2026-08-16).
  const tickRef = useRef<(bust?: boolean) => void>(() => {});
  const refresh = useCallback(() => tickRef.current(true), []);

  useEffect(() => {
    // url changed (account switch): the previous url's figures must not linger
    setData(null);
    setStale(false);
    misses.current = 0;
    if (!url) {
      tickRef.current = () => {};
      return;
    }
    let alive = true;
    const tick = (bust?: boolean) => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      fetch(bust ? `${url}${url.includes("?") ? "&" : "?"}fresh=1` : url, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((d: T) => {
          if (!alive) return;
          misses.current = 0;
          setStale(false);
          setData(d);
        })
        .catch(() => {
          if (!alive) return;
          misses.current += 1;
          if (misses.current >= 3) setStale(true);
        });
    };
    tickRef.current = tick;
    tick();
    const t = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [url, intervalMs]);

  return { data, stale, refresh };
}
