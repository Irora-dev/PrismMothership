"use client";

import { useEffect, useRef, useState } from "react";
import type { ActivityEvent, PulseStats } from "@/lib/feed/types";
import { EventDetailModal } from "./event-detail-modal";
import { Ticker } from "./ticker";

// The site-wide strip needs ambience, not the deck's cadence — the server's
// pollMs is honoured but never faster than this.
const POLL_FLOOR_MS = 30_000;

/** The live-activity ticker under the top bar, on every page (the designer's
 * greenlight, 2026-08-15). Self-fetching wrapper around the presentational
 * Ticker: same self-scheduling poll as the deck — the timer stops dead on a
 * hidden tab and fires immediately on return — so a strip nobody is looking
 * at costs nothing. Renders nothing until the feed answers. */
export function SiteTicker() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [stats, setStats] = useState<PulseStats | null>(null);
  // a chip is a door, same as the map's wire: click → the full event detail
  const [detail, setDetail] = useState<ActivityEvent | null>(null);
  const pollRef = useRef(POLL_FLOOR_MS);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () =>
      fetch("/api/feed", { cache: "no-store" })
        .then((r) => r.json())
        .then((d: { events?: ActivityEvent[]; stats?: PulseStats | null; pollMs?: number }) => {
          if (!alive) return;
          if (d.pollMs && d.pollMs >= 1000) pollRef.current = Math.max(POLL_FLOOR_MS, d.pollMs);
          if (Array.isArray(d.events)) setEvents(d.events);
          if (d.stats) setStats(d.stats);
        })
        .catch(() => {
          /* keep the last loop scrolling; the next poll retries */
        });
    const schedule = () => {
      if (timer) clearTimeout(timer);
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      timer = setTimeout(run, pollRef.current);
    };
    const run = () => {
      tick().finally(() => {
        if (alive) schedule();
      });
    };
    const onVis = () => {
      if (!alive) return;
      if (document.visibilityState === "hidden") {
        if (timer) clearTimeout(timer);
        timer = null;
      } else {
        run();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    run();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <>
      <Ticker events={events} ethUsd={stats?.ethUsd ?? 0} onOpen={setDetail} />
      {detail && (
        <EventDetailModal
          e={detail}
          ethUsd={stats?.ethUsd ?? 0}
          prismUsd={stats?.prismUsd ?? 0}
          prismSupply={stats?.supply ?? 0}
          onClose={() => setDetail(null)}
        />
      )}
    </>
  );
}
