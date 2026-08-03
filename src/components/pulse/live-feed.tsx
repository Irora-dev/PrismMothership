"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ActivityEvent, EventKind } from "@/lib/feed/types";
import { PRISM, addrUrl } from "@/lib/chain/constants";
import { EventRow } from "./event-row";
import { EventDetailModal } from "./event-detail-modal";
import { decodeEvent } from "@/lib/feed/share";

export type FeedFilter = "all" | EventKind;

const DEFAULT_FILTERS: { key: FeedFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "burn", label: "Burns" },
  { key: "fee", label: "Revenue" },
  { key: "launch", label: "Launches" },
  { key: "harvest", label: "Reserve" },
  { key: "retire", label: "NFTs" },
];

// Kinds for which we can serve the full on-chain history (bounded + interesting).
// Fees are intentionally excluded — far too many to list — so they stay buffer-only.
const HISTORY_KINDS = new Set<FeedFilter>(["burn", "launch", "harvest"]);
const HISTORY_NOUN: Partial<Record<FeedFilter, string>> = {
  burn: "buy-and-burns",
  launch: "launches",
  harvest: "revenue distributions",
};

// "?" beside the card title: hover / focus reveals the connection status plus
// a sentence of context about what the column shows.
function InfoTip({ status, text }: { status: string; text: string }) {
  return (
    <span tabIndex={0} className="group/tip relative inline-flex items-center outline-none shrink-0" aria-label={text}>
      <span className="grid place-items-center w-[17px] h-[17px] rounded-full border border-white/20 bg-white/[0.03] text-[10px] font-bold text-slate-500 cursor-help transition-colors group-hover/tip:text-slate-200 group-hover/tip:border-white/35 group-focus/tip:text-slate-200 group-focus/tip:border-white/35">
        ?
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 w-[290px] -translate-x-1/2 rounded-xl border border-white/10 bg-[#15151c] px-3.5 py-3 text-left text-[12px] font-normal leading-relaxed text-slate-300 opacity-0 shadow-2xl transition-opacity duration-150 group-hover/tip:opacity-100 group-focus/tip:opacity-100"
      >
        <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500 mb-1.5">{status}</span>
        {text}
      </span>
    </span>
  );
}

// One standardized feed card. The home page renders it twice — once scoped to
// Spectrum (via `include`) and once for the whole ecosystem — so both columns
// share the exact same shell, header, filter pills, and row format.
export function LiveFeed({
  events,
  mode,
  connected,
  eventsPerMin,
  ethUsd = 0,
  prismUsd = 0,
  prismSupply = 0,
  title = "Live activity",
  info,
  filters = DEFAULT_FILTERS,
  include,
  link = { href: addrUrl(PRISM), label: "Explorer", external: true },
  hoverId,
  onHoverEvent,
  consumeEventParam = false,
}: {
  events: ActivityEvent[];
  mode: "live" | "demo" | null;
  connected: boolean;
  eventsPerMin?: number;
  ethUsd?: number;
  /** PRISM spot (USD) — powers the popup's estimated-burn figure */
  prismUsd?: number;
  /** circulating PRISM — denominates the popup's %-of-supply estimate */
  prismSupply?: number;
  title?: string;
  /** context shown in the "?" tooltip beside the title */
  info?: string;
  filters?: { key: FeedFilter; label: string }[];
  include?: (e: ActivityEvent) => boolean;
  link?: { href: string; label: string; external?: boolean };
  /** id of the row hovered in the sibling card — the same event here lights up */
  hoverId?: string | null;
  onHoverEvent?: (id: string | null) => void;
  /** open the detail popup from a shared ?evt= deep link (one feed per page) */
  consumeEventParam?: boolean;
}) {
  const [filter, setFilter] = useState<FeedFilter>("all");
  const [now, setNow] = useState(() => Date.now());
  // Basket event opened in the centered detail popup (null = closed).
  const [selected, setSelected] = useState<ActivityEvent | null>(null);

  // Shared links open the popup directly. Short form ?tx=<hash> (+&c=b on
  // Base) is reconstructed server-side from the receipt; the fat legacy ?evt=
  // still decodes. Params are stripped once consumed so refresh/back doesn't
  // re-open it, and either way the popup works long after the event has aged
  // out of the live buffer.
  useEffect(() => {
    if (!consumeEventParam) return;
    const url = new URL(window.location.href);
    const tx = url.searchParams.get("tx");
    const evtParam = url.searchParams.get("evt");
    if (!tx && !evtParam) return;
    if (tx && /^0x[0-9a-fA-F]{64}$/.test(tx)) {
      const c = url.searchParams.get("c") === "b" ? "&c=b" : "";
      fetch(`/api/spectrum/event-from-tx?hash=${tx.toLowerCase()}${c}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((evt: ActivityEvent) => setSelected(evt))
        .catch(() => {
          /* unknown tx — nothing to open */
        });
    } else if (evtParam) {
      const evt = decodeEvent(evtParam);
      if (evt) setSelected(evt);
    }
    url.searchParams.delete("tx");
    url.searchParams.delete("c");
    url.searchParams.delete("evt");
    window.history.replaceState(null, "", url.toString());
  }, [consumeEventParam]);

  // Per-kind on-chain history, lazily loaded the first time a tab is opened.
  const [history, setHistory] = useState<Record<string, ActivityEvent[]>>({});
  const [histLoading, setHistLoading] = useState(false);
  const requestedRef = useRef<Set<string>>(new Set());

  const prevIds = useRef<Set<string>>(new Set());
  const first = useRef(true);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    prevIds.current = new Set(events.map((e) => e.id));
    first.current = false;
  }, [events]);

  // Fetch the full history once per kind (live mode only; demo filters the buffer).
  useEffect(() => {
    if (filter === "all" || !HISTORY_KINDS.has(filter) || mode !== "live") return;
    if (requestedRef.current.has(filter)) return;
    requestedRef.current.add(filter);
    const kind = filter;
    let alive = true;
    setHistLoading(true);
    fetch(`/api/history?kind=${kind}`)
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((d: { events?: ActivityEvent[] }) => {
        if (alive) setHistory((h) => ({ ...h, [kind]: d.events ?? [] }));
      })
      .catch(() => {
        requestedRef.current.delete(kind); // allow a retry on next open
        if (alive) setHistory((h) => ({ ...h, [kind]: [] }));
      })
      .finally(() => {
        if (alive) setHistLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [filter, mode]);

  // Live ids — used to flash only genuinely-new streaming events (never history).
  const liveIds = useMemo(() => new Set(events.map((e) => e.id)), [events]);

  // The card's slice of the stream (e.g. Spectrum-only), before kind filtering.
  const scoped = useMemo(() => (include ? events.filter(include) : events), [events, include]);

  const shown = useMemo(() => {
    if (filter === "all") return scoped;
    const live = scoped.filter((e) => e.kind === filter);
    const hist = (history[filter] ?? []).filter((e) => !include || include(e));
    const seen = new Set<string>();
    const merged: ActivityEvent[] = [];
    for (const e of [...live, ...hist]) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      merged.push(e);
    }
    merged.sort((a, b) => b.ts - a.ts || (b.blockNumber ?? 0) - (a.blockNumber ?? 0));
    return merged;
  }, [scoped, filter, history, include]);

  const showingHistory = filter !== "all" && HISTORY_KINDS.has(filter);
  const histLoadingNow = showingHistory && histLoading && !history[filter];
  const linkable = mode === "live";

  return (
    <div className="glass-card p-4 sm:p-5 flex flex-col">
      {/* header — big title, with the context tucked behind a "?" */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`pulse-live-dot ${mode === "demo" ? "demo" : ""} shrink-0`} />
          <div className="text-lg sm:text-xl font-bold txt-white leading-none truncate">{title}</div>
          {info && (
            <InfoTip
              status={`${mode === "demo" ? "demo stream" : connected ? "live · mainnet" : "connecting…"}${eventsPerMin != null ? ` · ${eventsPerMin.toFixed(0)}/min` : ""}`}
              text={info}
            />
          )}
        </div>
        <a
          href={link.href}
          {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          title={link.label}
          className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-full px-2.5 py-1.5 border border-white/10 bg-white/[0.03] text-slate-400 hover:text-white hover:border-white/20 transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 3h6v6" />
            <path d="M10 14 21 3" />
            <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
          </svg>
          {link.label}
        </a>
      </div>

      {/* filters — a card with a single event type gets an equal-height spacer
          instead, so twin cards' lists start and end at the same place */}
      {filters.length > 1 ? (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`text-[11px] font-semibold rounded-full px-2.5 py-1 transition-colors border ${
                filter === f.key
                  ? "bg-white/15 border-white/25 text-white"
                  : "bg-white/[0.03] border-white/10 text-slate-400 hover:text-slate-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="mb-3 flex items-center">
          <span className="text-[11px] font-semibold rounded-full px-2.5 py-1 border border-transparent invisible" aria-hidden>
            All
          </span>
        </div>
      )}

      {/* history hint — clarifies that a filtered tab shows the full on-chain record */}
      {showingHistory && (
        <div className="flex items-center gap-2 mb-3 text-[11px] font-mono text-slate-500">
          {histLoadingNow ? (
            <>
              <span className="inline-block w-3 h-3 rounded-full border-2 border-white/20 border-t-white/60 animate-spin" />
              <span>Loading full history…</span>
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" />
              </svg>
              <span>
                Showing all <span className="text-slate-300 font-semibold">{shown.length}</span> {HISTORY_NOUN[filter] ?? "events"} on-chain
              </span>
            </>
          )}
        </div>
      )}

      {/* stream — fixed height so the two home-page columns stay the same size;
          new events push the rest down, scroll for more */}
      <div className="relative">
        <div className="overflow-y-auto pr-1 h-[560px] space-y-2">
          {shown.length === 0 ? (
            <div className="grid place-items-center h-40 text-sm text-slate-500">
              {histLoadingNow
                ? "Loading history…"
                : connected
                  ? "Waiting for the next event…"
                  : "Connecting to the feed…"}
            </div>
          ) : (
            shown.map((e) => (
              <EventRow
                key={e.id}
                e={e}
                now={now}
                isNew={!first.current && liveIds.has(e.id) && !prevIds.current.has(e.id)}
                linkable={linkable}
                ethUsd={ethUsd}
                linked={hoverId != null && hoverId === e.id}
                onHover={onHoverEvent}
                onSelect={setSelected}
              />
            ))
          )}
        </div>
        {/* bottom fade */}
        <div className="pointer-events-none absolute bottom-0 inset-x-0 h-10 bg-gradient-to-t from-black/40 to-transparent" />
      </div>

      {selected && (
        <EventDetailModal e={selected} ethUsd={ethUsd} prismUsd={prismUsd} prismSupply={prismSupply} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
