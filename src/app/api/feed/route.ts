import { NextRequest, NextResponse } from "next/server";
import type { FeedResponse } from "@/lib/feed/types";
import { simulateEvents, simulateInitial, simulateStats } from "@/lib/feed/simulate";
import { fetchLiveStats, getBaseProvider, getLiveFeed, getProvider } from "@/lib/chain/live";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// How fast the client should poll. Live is gentle (real RPC reads sit behind a
// shared cache anyway); demo can be snappy since it's just local computation.
// 10s poll against the 20s server cache halves the stale-client tail — RPC
// volume is bounded by the server TTL, not this.
const LIVE_POLL_MS = Number(process.env.NEXT_PUBLIC_LIVE_POLL_MS) || 10_000;
// How long the stats read may take before the response ships without it. Well
// inside a serverless function's budget, so a slow accumulator rebuild degrades
// one card instead of 500-ing the endpoint.
const STATS_BUDGET_MS = Number(process.env.FEED_STATS_BUDGET_MS) || 6_000;
// Same for the event read (see the GET handler): a cold first refresh scans a day
// of blocks across three chains plus basket discovery.
const FEED_BUDGET_MS = Number(process.env.FEED_EVENTS_BUDGET_MS) || 7_000;
const DEMO_POLL_MS = 5_000;

// Fabricated data is for development and explicit demos only. A production
// deploy that is missing its RPC config must degrade honestly — observed
// 2026-08-03: the Mothership site launched with no env vars and served
// $544.9k of simulated revenue as if it were real. FEED_MODE=demo stays the
// explicit opt-in everywhere.
const demoAllowed = () => process.env.FEED_MODE === "demo" || process.env.NODE_ENV !== "production";

function parseCursor(cursor: string | null, mode: "demo" | "live"): number | null {
  if (!cursor) return null;
  const [m, v] = cursor.split(":");
  if (m !== mode) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function demoResponse(cursor: string | null, now: number): FeedResponse {
  const since = parseCursor(cursor, "demo");
  const events = since == null ? simulateInitial(now, 26) : simulateEvents(since, now, 60);
  return {
    mode: "demo",
    events,
    cursor: `demo:${now}`,
    stats: simulateStats(now),
    pollMs: DEMO_POLL_MS,
    serverTime: now,
  };
}

export async function GET(req: NextRequest) {
  const cursor = req.nextUrl.searchParams.get("cursor");
  const debug = req.nextUrl.searchParams.get("debug") === "1";
  const now = Date.now();

  // Everything below runs inside a top-level guard. This route is a read-only
  // display feed: it must never hand the platform an unhandled failure, because
  // that renders as a generic function error and the homepage's activity card
  // just breaks (observed on prod 2026-07-30). Worst case it serves an empty
  // stream and the client shows "connecting…" while the next poll recovers.
  // `?debug=1` returns the real error — the only diagnostic channel from outside
  // the platform's logs.
  try {
    const provider = getProvider();

    if (!provider) {
      if (demoAllowed()) return NextResponse.json(demoResponse(cursor, now));
      // production with no RPC configured: an honest empty live stream ("connecting…"), never fiction
      return NextResponse.json({
        mode: "live" as const,
        events: [],
        cursor: cursor ?? `live:${now}`,
        stats: null,
        pollMs: LIVE_POLL_MS,
        serverTime: now,
      });
    }
    const since = parseCursor(cursor, "live");
    const base = getBaseProvider();
    // Both reads are cached + single-flighted inside live.ts, so concurrent
    // viewers collapse onto one set of RPC calls per refresh interval.
    //
    // The stats read is TIME-BOXED and its failure is contained: on a cold
    // serverless instance it can rebuild accumulators from chain history, and
    // when that overran the platform's function budget the whole route died —
    // taking the live event stream with it (observed on prod 2026-07-30, while
    // every other route was healthy). Events are the point of this endpoint, so
    // they ship regardless and the client keeps its last-known stats.
    // ⚠️ Time-boxing ABANDONS the loser of the race. If that abandoned promise
    // later rejects, nothing is awaiting it — an unhandled rejection, which kills
    // the whole serverless function with a platform 502 that no try/catch here
    // can intercept (exactly what prod did: a 3s 502, `?debug=1` never reached
    // this code). So every raced promise gets its own terminal catch FIRST, and
    // the race only ever sees a settled-safe promise.
    const statsPromise = fetchLiveStats(provider, base).catch((err) => {
      console.error("[feed] stats read failed (events still served):", err);
      return null;
    });
    const statsOrNull = Promise.race([
      statsPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), STATS_BUDGET_MS)),
    ]);
    // The event read gets the SAME treatment, for the same reason: a cold
    // instance's first refresh scans a day of blocks on three chains and
    // discovers every basket, which can outlast the function budget. Both halves
    // are single-flighted inside live.ts, so the abandoned work keeps running and
    // fills the cache — this poll returns empty, the next returns the buffer.
    const feedPromise = getLiveFeed(provider, base, since).catch((err) => {
      console.error("[feed] event read failed:", err);
      return null;
    });
    const feedOrEmpty = Promise.race([
      feedPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FEED_BUDGET_MS)),
    ]);
    const [snapOrNull, stats] = await Promise.all([feedOrEmpty, statsOrNull]);
    const snap = snapOrNull ?? { events: [], newestTs: now };

    const body: FeedResponse = {
      mode: "live",
      // The whole buffer, not a recency slice: the buffer keeps the full 24h
      // window per kind so sparse basket trades survive the constant pool-fee
      // stream, and a recency cut here would undo exactly that (day-old trades
      // are always the oldest events). Worst case ~525 small objects ≈ 130KB.
      events: snap.events,
      cursor: `live:${snap.newestTs}`,
      stats,
      pollMs: LIVE_POLL_MS,
      serverTime: now,
    };
    return NextResponse.json(body);
  } catch (err) {
    // Real-data only: never fabricate demo activity on an error. Serve an EMPTY
    // live stream (200) so the client keeps its last-known data and shows
    // "connecting…", instead of a platform error page. `?debug=1` surfaces the
    // cause; the log line stays for the platform's own logs.
    console.error("[feed] live fetch failed:", err);
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return NextResponse.json({
      mode: "live" as const,
      events: [],
      cursor: cursor ?? `live:${now}`,
      stats: null,
      pollMs: LIVE_POLL_MS,
      serverTime: now,
      ...(debug ? { debugError: message.slice(0, 400), debugStack: (err instanceof Error ? err.stack ?? "" : "").slice(0, 900) } : {}),
    });
  }
}
