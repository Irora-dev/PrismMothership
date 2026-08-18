import type { ActivityEvent, EventKind, EventSource } from "./types";

export const KIND_META: Record<
  EventKind,
  { title: string; color: string; verb: string }
> = {
  burn: { title: "Buy & burn", color: "#ea580c", verb: "burned" },
  fee: { title: "LP revenue", color: "#22c55e", verb: "to holders" },
  launch: { title: "Basket Launched", color: "#6366f1", verb: "launched" },
  harvest: { title: "Reserve revenue", color: "#a855f7", verb: "harvested" },
  retire: { title: "NFT Retired", color: "#a1a1aa", verb: "retired" },
  nft: { title: "NFT minted", color: "#ec4899", verb: "minted" },
  batch: { title: "Portfolio batch", color: "#5C7CFA", verb: "batched" },
};

export const SOURCE_LABEL: Record<EventSource, string> = {
  dstable: "Reserves",
  "spectrum-index": "Spectrum basket",
  "spectrum-auction": "Auction",
  "prism-pool": "Prism pool",
  portfolio: "Spectrum Portfolio",
  wrapper: "Swap wrapper",
  ecosystem: "Ecosystem",
};

export function eventColor(e: ActivityEvent): string {
  // Basket trades: buys = emerald, sells = rose; other spectrum fees = blue
  // (Base) / purple (ETH); PRISM pool LP fees = green
  if (e.kind === "fee") {
    if (e.source === "spectrum-index") {
      if (e.side === "buy") return "#34d399";
      if (e.side === "sell") return "#f87171";
      return e.chain === "base" ? "#38bdf8" : "#a855f7";
    }
    if (e.source === "wrapper") return "#c06aff";
    return "#22c55e";
  }
  // ETH burn = ember orange, the bridged Base big burn = orange (paired with blue)
  if (e.kind === "burn") return e.chain === "base" ? "#fb923c" : "#ea580c";
  return KIND_META[e.kind].color;
}

// Optional secondary colour — orange→blue for the bridged-to-burn Base events.
export function eventColor2(e: ActivityEvent): string | undefined {
  if (e.chain === "base" && e.kind === "burn") return "#3b82f6";
  return undefined;
}

// Card title.
export function eventTitle(e: ActivityEvent): string {
  if (e.kind === "fee") {
    if (e.source === "spectrum-index") return e.side ? `Basket ${e.side}` : "Basket trade";
    if (e.source === "wrapper") return "Wrapped swap";
    return "LP revenue";
  }
  if (e.kind === "burn") return e.chain === "base" ? "Big burn · Base" : "Buy & burn";
  return KIND_META[e.kind].title;
}

// Source/chain chip text.
export function eventSourceLabel(e: ActivityEvent): string {
  if (e.kind === "fee") {
    if (e.source === "spectrum-index") return e.chain === "base" ? "Base · basket revenue" : "Mainnet · basket revenue";
    if (e.source === "wrapper") return `${e.chain === "ethereum" ? "Mainnet" : e.chain === "base" ? "Base" : "Robinhood"} · swap wrapper`;
    return "Mainnet · Prism pool";
  }
  return SOURCE_LABEL[e.source];
}

// Ticker + the basket's actual name — no "Spectrum basket · Ethereum" boilerplate.
function basketContext(e: ActivityEvent, fallback: string): string {
  const sym = e.symbol ? `$${e.symbol}` : "";
  const name = e.label && e.label !== e.symbol ? e.label : "";
  return [sym, name].filter(Boolean).join(" · ") || fallback;
}

// Expanded detail line — exactly where the value came from.
export function eventDetail(e: ActivityEvent): string {
  if (e.kind === "fee") {
    if (e.source === "spectrum-index") return basketContext(e, "Basket swap");
    if (e.source === "wrapper") return e.tradeEth ? `a Ξ${fmtEthFine(e.tradeEth)} swap through the fee wrapper` : "a swap through the fee wrapper";
    // the card lives in the "PRISM Swaps" column — no need to restate the pool
    return e.tradeEth ? `from a Ξ${fmtEthFine(e.tradeEth)} trade` : "";
  }
  if (e.kind === "burn") {
    if (e.chain === "base") return "Bridged from Base · 7-day pool";
    if (e.source === "dstable") return "Reserve revenue · Ethereum";
    if (e.source === "spectrum-auction") return "ETH deploy auction";
    return "Spectrum · ecosystem";
  }
  if (e.kind === "nft") return "Prism NFT · new seed minted";
  if (e.kind === "launch") return basketContext(e, "Spectrum basket");
  if (e.kind === "harvest") return "Reserve revenue · Ethereum";
  if (e.kind === "retire") return "Prism NFT · Ethereum";
  return "";
}

export function fmtPrism(n?: number): string {
  if (n == null) return "—";
  if (n === 0) return "0";
  if (n < 0.0001) return "<0.0001";
  if (n < 10) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function fmtEth(n?: number): string {
  if (n == null) return "—";
  if (n === 0) return "0"; // a true zero is not dust — "<0.001" implied money that isn't there
  if (n < 0.001) return "<0.001";
  if (n < 10) return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

// finer ETH formatting for tiny per-token figures
export function fmtEthFine(n?: number): string {
  if (n == null) return "—";
  if (n === 0) return "0";
  if (n < 0.00001) return "<0.00001";
  if (n < 1) return n.toLocaleString("en-US", { maximumFractionDigits: 5 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

export function fmtUsd(n?: number): string {
  if (n == null) return "";
  // sub-dollar trades are real rows on the live feed; toFixed(0) printed every
  // one of them as "$0" (visible on the designer's own dashboard paste, 2026-08-12).
  // Same fix as fmtUsdFull: keep 2 significant figures below a cent.
  if (n > 0 && n < 0.01) return `$${n.toFixed(Math.min(12, 1 - Math.floor(Math.log10(n)))).replace(/0+$/, "")}`;
  if (n > 0 && n < 1) return `$${n.toFixed(2)}`;
  if (n < 1000) return `$${n.toFixed(0)}`;
  if (n < 1_000_000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${(n / 1_000_000).toFixed(2)}M`;
}

// full $ figure with commas (panel-friendly): $6,398 · $0.42 · $1,924
export function fmtUsdFull(n?: number): string {
  if (n == null || !isFinite(n)) return "—";
  if (n === 0) return "$0";
  // sub-cent values kept 2 significant figures instead of rounding to "$0.00":
  // a dust basket's AUM on the leaderboard was the exact lie the surface gate
  // exists to catch, and toFixed(2) told it everywhere this formatter is used
  if (n < 0.01) return `$${n.toFixed(Math.min(12, 1 - Math.floor(Math.log10(n)))).replace(/0+$/, "")}`;
  if (n < 1) return `$${n.toFixed(2)}`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

// USD value of an event (prefers an explicit usd, else ETH × price).
export function eventUsd(e: ActivityEvent, ethUsd = 0): number | null {
  if (e.usd != null) return e.usd;
  if (e.eth != null && ethUsd > 0) return e.eth * ethUsd;
  return null;
}

// compact number for big counters (e.g., 3.2k, 1.04M)
export function fmtCompact(n: number, maxDp = 2): string {
  if (n < 1000) return n.toLocaleString("en-US", { maximumFractionDigits: maxDp });
  if (n < 1_000_000) return `${(n / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })}k`;
  return `${(n / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`;
}

export function truncAddr(a?: string): string {
  if (!a) return "";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function relTime(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 3) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// one-line headline shown in the feed row and ticker ($-primary)
export function headline(e: ActivityEvent, ethUsd = 0): string {
  const usd = eventUsd(e, ethUsd);
  const v = usd != null ? fmtUsdFull(usd) : e.eth != null ? `${fmtEth(e.eth)} ETH` : "";
  switch (e.kind) {
    case "burn":
      return e.chain === "base"
        ? `${v || fmtPrism(e.prism) + " PRISM"} bridged to burn PRISM · Base`
        : `${fmtPrism(e.prism)} PRISM bought & burned`;
    case "fee":
      if (e.source === "spectrum-index") {
        if (e.chain === "base" && e.tradeUsd != null) {
          const fee = e.usd != null ? ` · ${fmtUsdFull(e.usd)} fee` : "";
          return `${fmtUsdFull(e.tradeUsd)}${e.symbol ? ` $${e.symbol}` : ""} basket ${e.side ?? "trade"}${fee}`;
        }
        return `${v} in Spectrum basket revenue`;
      }
      if (e.source === "wrapper") {
        // stable-priced swaps carry USD figures; native ones carry ETH
        if (e.tradeUsd != null) return `${fmtUsdFull(e.tradeUsd)} wrapped swap${e.feeUsd != null ? ` · ${fmtUsdFull(e.feeUsd)} fee` : ""}`;
        return e.tradeEth != null ? `Ξ${fmtEth(e.tradeEth)} wrapped swap${v ? ` · ${v} fee` : ""}` : "A swap through the fee wrapper";
      }
      return `${v} in LP revenue to PRISM holders`;
    case "launch":
      return `${e.label ?? "A new basket"} launched`;
    case "harvest":
      return `${v} of reserve revenue to holders`;
    case "retire":
      return `A Prism NFT retired forever`;
    case "nft":
      return `A new Prism NFT minted`;
    case "batch":
      return `${v} portfolio batch${e.legs ? ` · ${e.legs} asset${e.legs === 1 ? "" : "s"}` : ""}`;
  }
}
