"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityEvent, FeedResponse, PulseStats } from "@/lib/feed/types";

// Rolling window of recent events: new ones push older ones down and off the list.
// Must hold at least the server's full buffer (525): a smaller recency window
// here lets the constant PRISM-pool fee stream push sparse day-old basket
// trades out BEFORE per-card filters run — the Spectrum "live basket activity"
// card then looks empty even though the server retained the trades.
const MAX_EVENTS = 600;

export interface SessionTotals {
  events: number;
  prismBurned: number;
  ethVolume: number; // PRISM-pool LP fees seen this session (ETH leg)
  indexFeesUsd: number; // Spectrum index swap fees seen this session (USD)
  burns: number;
  launches: number;
  startedAt: number;
}

export interface FeedState {
  events: ActivityEvent[];
  stats: PulseStats | null;
  mode: "live" | "demo" | null;
  connected: boolean;
  session: SessionTotals;
  lastEvent: ActivityEvent | null;
}

const emptySession = (): SessionTotals => ({
  events: 0,
  prismBurned: 0,
  ethVolume: 0,
  indexFeesUsd: 0,
  burns: 0,
  launches: 0,
  startedAt: Date.now(),
});

export function useActivityFeed(pollMs = 4000): FeedState {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [stats, setStats] = useState<PulseStats | null>(null);
  const [mode, setMode] = useState<"live" | "demo" | null>(null);
  const [connected, setConnected] = useState(false);
  const [session, setSession] = useState<SessionTotals>(emptySession);
  const [lastEvent, setLastEvent] = useState<ActivityEvent | null>(null);

  const cursorRef = useRef<string | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const pollRef = useRef(pollMs);

  const ingest = useCallback((resp: FeedResponse) => {
    setMode(resp.mode);
    setStats(resp.stats);
    setConnected(true);
    cursorRef.current = resp.cursor;
    if (resp.pollMs && resp.pollMs >= 1000) pollRef.current = resp.pollMs;

    const fresh = resp.events.filter((e) => !seenRef.current.has(e.id));
    for (const e of fresh) seenRef.current.add(e.id);

    if (fresh.length > 0) {
      // newest-first already; prepend and cap
      setEvents((prev) => [...fresh, ...prev].slice(0, MAX_EVENTS));
      setLastEvent(fresh[0]);

      if (initializedRef.current) {
        setSession((s) => {
          const next = { ...s };
          for (const e of fresh) {
            next.events += 1;
            if (e.kind === "burn") {
              next.burns += 1;
              next.prismBurned += e.prism ?? 0;
            }
            if (e.kind === "fee") {
              // Index fees are USD-denominated (dstable); PRISM-pool fees are ETH.
              if (e.source === "spectrum-index") next.indexFeesUsd += e.usd ?? 0;
              else next.ethVolume += e.eth ?? 0;
            }
            if (e.kind === "launch") next.launches += 1;
          }
          return next;
        });
      }
    }

    // trim the seen-set so it cannot grow without bound
    if (seenRef.current.size > 4000) {
      seenRef.current = new Set(resp.events.map((e) => e.id));
    }
    // arm the session counter only once a real batch has been seen — a cold
    // server cache answers the first poll with EMPTY events, and arming on that
    // would count the entire backlog as "this session" when poll two delivers it
    if (resp.events.length > 0) initializedRef.current = true;
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (!alive) return;
      try {
        const q = cursorRef.current ? `?cursor=${encodeURIComponent(cursorRef.current)}` : "";
        const res = await fetch(`/api/feed${q}`, { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as FeedResponse;
          if (alive) ingest(data);
        } else if (alive) {
          setConnected(false);
        }
      } catch {
        if (alive) setConnected(false);
      }
      // keep polling everywhere; obey the server's recommended interval and
      // back off further when the tab is in the background (saves RPC + battery)
      if (alive) {
        const base = pollRef.current;
        const hidden = typeof document !== "undefined" && document.hidden;
        timer = setTimeout(tick, hidden ? base * 4 : base);
      }
    };

    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [pollMs, ingest]);

  return { events, stats, mode, connected, session, lastEvent };
}
