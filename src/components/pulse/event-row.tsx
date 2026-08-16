import type { ActivityEvent } from "@/lib/feed/types";
import {
  eventColor,
  eventColor2,
  eventDetail,
  eventTitle,
  eventUsd,
  fmtEth,
  fmtPrism,
  fmtUsdFull,
  relTime,
} from "@/lib/feed/format";
import { BASKET_BURN_SHARE, txUrl } from "@/lib/chain/constants";
import { EventIcon } from "./event-icon";

function CardShell({
  e,
  isNew,
  clickable,
  className,
  arrow = true,
  linked = false,
  onHover,
  onSelect,
  children,
}: {
  e: ActivityEvent;
  isNew: boolean;
  clickable: boolean;
  className: string;
  arrow?: boolean;
  linked?: boolean;
  onHover?: (id: string | null) => void;
  /** open the in-page detail popup instead of linking out */
  onSelect?: () => void;
  children: React.ReactNode;
}) {
  const color = eventColor(e);
  const inner = (
    <>
      <span className="evt-accent" aria-hidden />
      {isNew && <span className="card-sheen" aria-hidden />}
      {isNew && <span className="evt-glow" aria-hidden />}
      {children}
      {clickable && arrow && (
        <svg
          className="absolute top-2.5 right-2.5 opacity-0 group-hover:opacity-60 transition-opacity z-10"
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M7 17 17 7" />
          <path d="M7 7h10v10" />
        </svg>
      )}
    </>
  );
  const color2 = eventColor2(e);
  const cls = `evt-card group ${className} ${isNew ? "feed-item-enter" : ""} ${linked ? "evt-linked" : ""}`;
  const style: Record<string, string> = { "--c": color };
  if (color2) style["--c2"] = color2;
  const hoverProps = onHover
    ? { onMouseEnter: () => onHover(e.id), onMouseLeave: () => onHover(null) }
    : {};
  if (onSelect) {
    return (
      <button type="button" onClick={onSelect} className={`${cls} w-full text-left cursor-pointer`} style={style} {...hoverProps}>
        {inner}
      </button>
    );
  }
  return clickable ? (
    <a href={txUrl(e.txHash!, e.chain)} target="_blank" rel="noopener noreferrer" className={cls} style={style} {...hoverProps}>
      {inner}
    </a>
  ) : (
    <div className={cls} style={style} {...hoverProps}>
      {inner}
    </div>
  );
}

type Figure = { value: React.ReactNode; label: string };

// The labelled figure(s) each event leads with — one shared stat-pair idiom
// for every kind, so all rows read the same way: number over label.
function figuresFor(e: ActivityEvent, ethUsd: number): Figure[] {
  const usd = eventUsd(e, ethUsd);
  const usdOrEth = usd != null ? fmtUsdFull(usd) : `Ξ${fmtEth(e.eth)}`;
  switch (e.kind) {
    case "fee":
      if (e.source === "spectrum-index" && e.tradeUsd != null) {
        const figs: Figure[] = [{ value: fmtUsdFull(e.tradeUsd), label: "Total swap" }];
        // The headline second figure is PRISM's slice — the fixed 25% of the
        // basket fee that buys & burns — not the (misleading) total fee.
        if (e.usd != null) figs.push({ value: fmtUsdFull(e.usd * BASKET_BURN_SHARE), label: "PRISM fee" });
        return figs;
      }
      return [{ value: usdOrEth, label: e.source === "spectrum-index" ? "Fee" : "LP fee" }];
    case "launch":
      return [
        { value: ethUsd ? fmtUsdFull((e.eth ?? 0) * ethUsd) : `Ξ${fmtEth(e.eth)}`, label: "Deploy cost" },
      ];
    case "burn":
      if (e.chain === "base") return [{ value: usdOrEth, label: "Bridged to burn" }];
      return [{ value: fmtPrism(e.prism), label: "PRISM burned" }];
    case "harvest":
      return [{ value: usdOrEth, label: "To holders" }];
    case "retire":
    case "nft":
      return [{ value: fmtPrism(e.prism), label: e.kind === "nft" ? "NFT minted" : "NFT retired" }];
    case "batch": {
      const figs: Figure[] = [{ value: usdOrEth, label: "Batch funding" }];
      if (e.legs) figs.push({ value: String(e.legs), label: e.legs === 1 ? "Asset" : "Assets" });
      return figs;
    }
  }
}

export function EventRow({
  e,
  now,
  isNew,
  linkable,
  ethUsd = 0,
  linked = false,
  onHover,
  onSelect,
}: {
  e: ActivityEvent;
  now: number;
  isNew: boolean;
  linkable: boolean;
  ethUsd?: number;
  linked?: boolean;
  onHover?: (id: string | null) => void;
  /** basket events open the in-page detail popup instead of Etherscan */
  onSelect?: (e: ActivityEvent) => void;
}) {
  const color = eventColor(e);
  const clickable = linkable && !!e.txHash;
  // Basket activity (launches, trades, bridge burns) opens the detail popup,
  // and so does every buy-and-burn — basket burns render the bento, the rest
  // get the burn panel. Everything else keeps its Etherscan link.
  const detailable =
    !!onSelect && !!e.actor && (e.kind === "burn" || e.source === "spectrum-index" || e.source === "spectrum-auction");
  const figures = figuresFor(e, ethUsd);
  const context = e.kind === "launch" ? (e.label ?? "New basket") : eventDetail(e);

  return (
    <CardShell
      e={e}
      isNew={isNew}
      clickable={clickable || detailable}
      linked={linked}
      onHover={onHover}
      onSelect={detailable ? () => onSelect!(e) : undefined}
      className="flex items-center gap-3.5 px-4 py-3.5"
    >
      <div className={`evt-icon ${isNew ? "evt-icon-pop" : ""}`}>
        <span className="relative z-10">
          <EventIcon kind={e.kind} size={18} color={`color-mix(in srgb, ${color} 72%, #cbd5e1)`} />
        </span>
        {e.kind === "burn" && isNew && (
          <span className="flame-burst pointer-events-none absolute inset-0 z-20">
            <span style={{ left: "28%" }}>🔥</span>
            <span style={{ left: "56%", animationDelay: "0.15s" }}>🔥</span>
          </span>
        )}
      </div>

      {/* labelled figures — left */}
      <div className="shrink-0 relative z-10 flex items-start gap-4">
        {figures.map((f) => (
          <div key={f.label}>
            <div
              className="font-mono font-bold text-[22px] leading-none whitespace-nowrap"
              style={{ color: `color-mix(in srgb, ${color} 70%, #e2e8f0)` }}
            >
              {f.value}
            </div>
            <div className="text-[10px] uppercase tracking-[0.08em] text-slate-500 font-semibold mt-1.5 whitespace-nowrap">
              {f.label}
            </div>
          </div>
        ))}
      </div>

      {/* title + one context line — right */}
      <div className="min-w-0 flex-1 relative z-10 text-right">
        <div className="flex items-center gap-2 justify-end">
          <span
            className="text-[12px] font-bold uppercase tracking-[0.06em] leading-none truncate"
            style={{ color: `color-mix(in srgb, ${color} 68%, #cbd5e1)` }}
          >
            {eventTitle(e)}
          </span>
          {e.kind === "launch" && e.symbol && (
            <span
              className="font-mono text-[10px] font-bold rounded px-1.5 py-0.5 leading-none shrink-0"
              style={{ color: `color-mix(in srgb, ${color} 70%, #e2e8f0)`, background: `${color}14`, border: `1px solid ${color}2a` }}
            >
              ${e.symbol}
            </span>
          )}
        </div>
        {/* context truncates; the relative time never does — every row keeps
            its "2h ago" visible, not just the short-context launches */}
        <div className="flex items-center justify-end gap-1.5 text-[12px] text-slate-400 font-medium mt-1.5 min-w-0">
          {context && <span className="truncate">{context}</span>}
          {context && <span className="text-slate-600 shrink-0">·</span>}
          <span className="shrink-0 text-slate-500">{relTime(e.ts, now)}</span>
        </div>
      </div>
    </CardShell>
  );
}
