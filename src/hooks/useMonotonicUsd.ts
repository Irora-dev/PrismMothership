import { useEffect, useRef, useState } from "react";
import { PRISM, PRISM_LIVE } from "@/lib/chain/constants";

// Baseline for the all-time / lifetime yield $ figure — now ZERO, deliberately.
//
// This used to anchor to $146k, because the old token's accrued history predated
// what this server could scan, so the headline would have under-reported without a
// floor. That anchor was ONE token's earnings. It was gated on PRISM_LIVE, which
// read as "the old token is wired" — but PRISM_LIVE only means *some* token is
// wired, and on 2026-07-30 the community relaunched PRISM (v2). The gate happily
// stayed true and presented **v1's $146k as v2's lifetime revenue**, on a token
// hours old whose real figures were Ξ<0.001 and 0 PRISM.
//
// v2 needs no anchor at all: PRISM_POOL_FROM_BLOCK is its own pool's creation
// block, so the scan sees the token's COMPLETE history and is authoritative. Any
// non-zero floor here would now be a claim the chain does not support.
export const LIFETIME_FLOOR_USD = 0;

/**
 * A cumulative $ figure (e.g. lifetime yield) should only ever rise. But its value
 * is mark-to-market on the live ETH price, so a passing ETH dip — or a page reload,
 * which resets in-memory state — can make it tick backwards.
 *
 * This tracks a monotonic max and persists the peak to localStorage (per device),
 * so the displayed number never drops below the highest value ever seen. An optional
 * `baseline` guarantees a consistent minimum across devices (localStorage is per-device,
 * so without it the headline can differ between browsers). The underlying ETH / PRISM
 * legs are already monotonic; this only stabilises the $.
 */
export function useMonotonicUsd(value: number, storageKey: string, baseline = 0): number {
  const liveMax = useRef(0);
  const [floor, setFloor] = useState(0);
  // Namespace the persisted peak BY TOKEN. A high-water mark describes one token's
  // earnings, so a relaunch must not inherit the previous token's peak — otherwise
  // every device that ever saw the old figure keeps displaying it forever, which no
  // amount of fixing the floor above can undo. Keying by address means a future
  // relaunch starts clean automatically rather than needing someone to remember.
  const key = `${storageKey}:${PRISM_LIVE ? PRISM.toLowerCase() : "none"}`;

  // seed the persisted peak once on mount (client-only)
  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(key) || 0);
      if (stored > 0) setFloor(stored);
    } catch {
      /* localStorage unavailable — fall back to in-session max */
    }
  }, [key]);

  if (Number.isFinite(value) && value > liveMax.current) liveMax.current = value;
  // No token wired → the persisted per-device peak belongs to a PREVIOUS token, so
  // it is ignored outright: a returning visitor must not carry the old high-water
  // mark onto a pre-launch page.
  const result = PRISM_LIVE ? Math.max(liveMax.current, floor, baseline) : Number.isFinite(value) ? value : 0;

  // persist any new peak
  useEffect(() => {
    if (!PRISM_LIVE || result <= 0) return;
    try {
      const stored = Number(window.localStorage.getItem(key) || 0);
      if (result > stored) window.localStorage.setItem(key, String(result));
    } catch {
      /* ignore */
    }
  }, [result, key]);

  return result;
}
