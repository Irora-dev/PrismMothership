// Shareable deep links for basket-activity events. The whole event rides in
// the URL (compact keys, base64url JSON), so a link keeps working after the
// event ages out of the live buffer — the popup re-renders from the params and
// re-reads the basket on-chain. Canonical share target: /spectrum?evt=…

import type { ActivityEvent } from "./types";

// Compact wire form — short keys keep the URL tweet-friendly. The id and the
// caption are NOT carried: the id only matters inside the live feed list, and
// the caption is synthesized from the kind on decode (it was the longest field
// by far — dropping it roughly halves the link).
interface WireEvt {
  k: ActivityEvent["kind"];
  s: ActivityEvent["source"];
  c: ActivityEvent["chain"];
  t: number; // ts
  b?: number; // blockNumber
  x?: string; // txHash
  a?: string; // actor (basket)
  y?: string; // symbol
  l?: string; // label
  e?: number; // eth
  u?: number; // usd
  d?: number; // tradeUsd
  w?: "buy" | "sell"; // side
  p?: number; // prism
  f?: number; // feeUsd (batch)
  g?: number; // legs (batch)
  h?: number; // burnUsd (batch — the fee's delivered burn share)
}

const b64url = {
  enc(s: string): string {
    return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  dec(s: string): string {
    const b = s.replace(/-/g, "+").replace(/_/g, "/");
    return decodeURIComponent(escape(atob(b + "=".repeat((4 - (b.length % 4)) % 4))));
  },
};

export function encodeEvent(e: ActivityEvent): string {
  const w: WireEvt = {
    k: e.kind,
    s: e.source,
    c: e.chain,
    t: e.ts,
    b: e.blockNumber,
    x: e.txHash,
    a: e.actor,
    y: e.symbol,
    l: e.label,
    e: e.eth,
    u: e.usd,
    d: e.tradeUsd,
    w: e.side,
    p: e.prism,
    f: e.feeUsd,
    g: e.legs,
    h: e.burnUsd,
  };
  for (const k of Object.keys(w) as (keyof WireEvt)[]) if (w[k] === undefined) delete w[k];
  return b64url.enc(JSON.stringify(w));
}

// The standard caption per kind — mirrors what the live readers emit, so a
// shared popup reads the same as the original.
function noteFor(w: WireEvt): string | undefined {
  const name = w.l ?? (w.y ? `$${w.y}` : undefined);
  if (w.k === "launch") return name ? `${name} launched on Spectrum. The launch auction ETH buys & burns PRISM` : undefined;
  if (w.k === "fee" && w.s === "spectrum-index")
    return `${w.y ? `$${w.y} ` : ""}${w.w ?? "trade"} on ${w.c === "base" ? "Base" : "Ethereum"}. 25% of the fee buys & burns PRISM`;
  if (w.k === "burn") return "Basket revenue bought & burned PRISM";
  if (w.k === "batch") return "A batched portfolio execution: one signature, every leg filled on-chain";
  return undefined;
}

export function decodeEvent(param: string): ActivityEvent | null {
  try {
    const w = JSON.parse(b64url.dec(param)) as WireEvt;
    if (!w || typeof w !== "object" || !w.k || !w.s || !w.c || typeof w.t !== "number") return null;
    return {
      id: `${w.x ?? "shared"}:${w.t}`,
      kind: w.k,
      source: w.s,
      chain: w.c,
      ts: w.t,
      blockNumber: w.b,
      txHash: w.x,
      actor: w.a,
      symbol: w.y,
      label: w.l,
      eth: w.e,
      usd: w.u,
      tradeUsd: w.d,
      side: w.w,
      prism: w.p,
      feeUsd: w.f,
      legs: w.g,
      burnUsd: w.h,
      note: noteFor(w),
    };
  } catch {
    return null;
  }
}

/** The canonical share URL for an event — always the /spectrum page. On-chain
 *  events (every basket event has a tx) get the SHORT form: just the tx hash,
 *  which /api/spectrum/event-from-tx reconstructs on open. The fat ?evt= form
 *  survives as the fallback for anything without a hash, and old links keep
 *  decoding. */
export function eventShareUrl(e: ActivityEvent): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://prismbeat.netlify.app";
  // Batches take the self-contained ?evt= form: the ?tx= resolver
  // (event-from-tx) only reconstructs BASKET events, so a batch short link
  // would misrender — and the fat form survives feed retention anyway, which
  // is exactly what a marketing link needs.
  if (e.txHash && e.kind !== "batch") return `${origin}/spectrum?tx=${e.txHash}${e.chain === "base" ? "&c=b" : ""}`;
  return `${origin}/spectrum?evt=${encodeEvent(e)}`;
}
