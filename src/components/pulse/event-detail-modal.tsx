"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ActivityEvent } from "@/lib/feed/types";
import type { IndexData } from "@/lib/spectrum/index-data";
import { eventColor, eventSourceLabel, eventTitle, fmtEth, fmtPrism, fmtUsdFull, relTime } from "@/lib/feed/format";
import { eventShareUrl } from "@/lib/feed/share";
import { BASKET_BURN_SHARE, PRISM as PRISM_ADDR, txUrl, addrUrl } from "@/lib/chain/constants";
import { BasketBento } from "@/components/spectrum/basket-bento";

// ── Basket-activity detail popup ──────────────────────────────────────────────
// Clicking a basket event in the live feed opens this centered modal instead of
// linking straight out to Etherscan: the basket's name, ticker, description,
// the Spectrum-operator-style bento of its holdings (real token brand colors),
// what the action cost, and the PRISM burn it feeds. Shareable: copy the card
// as an image, copy a deep link (/spectrum?evt=…), or post it to X. The tx
// link survives in the footer.

function fmtToken(n: number, maxDp = 4): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 2 : maxDp });
}

function fmtPct(n: number): string {
  return `${n >= 0.01 ? n.toFixed(2) : n.toFixed(4)}%`;
}

// The action's cost figure + the PRISM burn it produces (estimated at spot
// where the burn hasn't executed yet; actual where the event IS the burn).
function burnFigures(e: ActivityEvent, ethUsd: number, prismUsd: number) {
  const est = (usd: number) => (prismUsd > 0 && usd > 0 ? usd / prismUsd : null);
  switch (e.kind) {
    case "launch": {
      const usd = (e.eth ?? 0) * ethUsd;
      return {
        cost: { value: e.eth ? `Ξ${fmtEth(e.eth)}` : "Free", label: "Deploy cost", sub: e.eth ? fmtUsdFull(usd) : "bootstrap slot" },
        burn: { value: est(usd), label: "Est. PRISM burn", sub: "100% of the auction ETH", actual: false },
      };
    }
    case "fee": {
      const feeUsd = e.usd ?? 0;
      return {
        cost: {
          value: e.tradeUsd != null ? fmtUsdFull(e.tradeUsd) : fmtUsdFull(feeUsd),
          label: e.tradeUsd != null ? "Trade size" : "Fee",
          sub: e.tradeUsd != null ? `${fmtUsdFull(feeUsd)} fee` : undefined,
        },
        burn: { value: est(feeUsd * BASKET_BURN_SHARE), label: "Est. PRISM burn", sub: "10% of the fee", actual: false },
      };
    }
    case "burn": {
      if (e.prism != null && e.prism > 0) {
        return {
          cost: null,
          burn: { value: e.prism, label: "PRISM burned", sub: "bought & burned on-chain", actual: true },
        };
      }
      const usd = (e.eth ?? 0) * ethUsd;
      return {
        cost: { value: `Ξ${fmtEth(e.eth)}`, label: "Bridged to burn", sub: fmtUsdFull(usd) },
        burn: { value: est(usd), label: "Est. PRISM burn", sub: "arrives after the ~7d bridge", actual: false },
      };
    }
    default:
      return { cost: null, burn: null };
  }
}

function Tile({ value, label, sub, color }: { value: React.ReactNode; label: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3">
      <div className="font-mono font-bold text-[19px] leading-none" style={color ? { color } : undefined}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400 font-semibold mt-1.5">{label}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

export function EventDetailModal({
  e,
  ethUsd,
  prismUsd = 0,
  prismSupply = 0,
  onClose,
}: {
  e: ActivityEvent;
  ethUsd: number;
  prismUsd?: number;
  /** circulating PRISM — denominates the estimated %-of-supply figure */
  prismSupply?: number;
  onClose: () => void;
}) {
  const [data, setData] = useState<IndexData | null>(null);
  const [failed, setFailed] = useState(false);
  const [burnHit, setBurnHit] = useState<{ txHash: string; prism: number; pct: number } | null>(null);
  // Best-effort basket attribution for burner burns: the launch that fed it.
  const [viaLaunch, setViaLaunch] = useState<{ address: string; label?: string } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [imgState, setImgState] = useState<"idle" | "busy" | "copied" | "saved">("idle");
  const [linkCopied, setLinkCopied] = useState(false);
  const color = eventColor(e);

  // Has the PRISM burn this event feeds actually executed yet? (The burn lands
  // AFTER the event — deploy → escrow → flush → buy&burn — so the row appears
  // only once it's detectable on-chain.) Polls while the popup is open, so a
  // launch popup left open flips from "estimated" to the confirmed figure the
  // moment the burn lands.
  useEffect(() => {
    let alive = true;
    // A mainnet burn event IS the burn — seed the row from its own data
    // instantly (the API pass then fills in the %-of-supply figure).
    setBurnHit(e.kind === "burn" && e.prism && e.txHash ? { txHash: e.txHash, prism: e.prism, pct: 0 } : null);
    if (e.kind !== "launch" && e.kind !== "fee" && e.kind !== "burn") return;
    const qs = new URLSearchParams({ kind: e.kind, chain: e.chain ?? "ethereum", actor: e.actor ?? "", ts: String(e.ts) });
    const check = () =>
      fetch(`/api/spectrum/event-burn?${qs}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d: { burns: { txHash: string; prism: number }[]; totalPrism: number; pctOfSupply: number }) => {
          if (alive && d.burns?.length) setBurnHit({ txHash: d.burns[0].txHash, prism: d.totalPrism, pct: d.pctOfSupply });
        })
        .catch(() => {
          /* no row — the estimate tile already covers the pending state */
        });
    check();
    const t = setInterval(() => {
      if (!alive) return;
      check();
    }, 45_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [e.kind, e.chain, e.actor, e.ts]);

  // Copy the card as an image — same rasterizer as the chart exports
  // (modern-screenshot; html2canvas chokes on Tailwind v4's oklch()). Prefers
  // the clipboard; falls back to a PNG download when the browser refuses
  // (Safari/permissions). The action bar itself is filtered out of the shot.
  const copyImage = async () => {
    if (!panelRef.current || imgState === "busy") return;
    setImgState("busy");
    try {
      const { domToBlob } = await import("modern-screenshot");
      const blob = await Promise.race([
        domToBlob(panelRef.current, {
          backgroundColor: "#0b0e17",
          scale: 2,
          filter: (node) => !(node instanceof HTMLElement && node.dataset?.noexport != null),
        }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("export timed out")), 15_000)),
      ]);
      if (!blob) throw new Error("no image produced");
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setImgState("copied");
      } catch {
        const a = document.createElement("a");
        a.download = `prismbeat-${(e.symbol || e.kind).toLowerCase()}-${e.id.slice(2, 8)}.png`;
        a.href = URL.createObjectURL(blob);
        a.click();
        URL.revokeObjectURL(a.href);
        setImgState("saved");
      }
    } catch (err) {
      console.error("[popup] image export failed:", err);
      setImgState("idle");
      return;
    }
    setTimeout(() => setImgState("idle"), 2000);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(eventShareUrl(e));
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      /* clipboard refused — the X intent still carries the link */
    }
  };

  // One clean prefilled post: readable sentences, blank line, then the link —
  // a single text param (text + url params concatenate into a mess in the
  // compose box, which is the "gobbledygook" this replaces).
  const shareOnX = () => {
    const name = data?.name || e.label || "A basket";
    const sym = data?.symbol || e.symbol;
    const tag = sym ? ` ($${sym})` : "";
    const line =
      e.kind === "launch"
        ? `A new basket has been deployed on Spectrum — ${name}${tag}.`
        : e.kind === "fee"
          ? `${name}${tag} just traded on Spectrum. Every fee feeds the PRISM burn.`
          : burnHit
            ? `${name}${tag} just burned ${fmtToken(burnHit.prism)} PRISM on Spectrum.`
            : `${name}${tag} basket revenue is heading into the PRISM burn.`;
    const text = `${line}\n\nView it on Prism Beat:\n${eventShareUrl(e)}`;
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  };

  useEffect(() => {
    let alive = true;
    setData(null);
    setFailed(false);
    setViaLaunch(null);
    const readBasket = (addr: string) =>
      fetch(`/api/spectrum/index/${addr}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject())) as Promise<IndexData>;
    const fail = () => {
      if (alive) setFailed(true);
    };
    if (!e.actor) {
      fail();
      return;
    }
    readBasket(e.actor)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        // The actor isn't a readable basket. Auction-pipe burns come from the
        // L1 burner, which aggregates deployments — best-effort attribution:
        // the latest launch before the burn is the one that fed it (exact in
        // the current one-flush-per-deployment reality). Anything else (pool
        // compounding, reserves) has no basket — the PRISM tile renders.
        if (!alive || e.kind !== "burn" || e.source !== "spectrum-auction") return fail();
        fetch(`/api/history?kind=launch`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : Promise.reject()))
          .then((j: { events?: ActivityEvent[] }) => {
            const launch = (j.events ?? [])
              .filter((l) => l.actor && l.ts <= e.ts)
              .sort((a, b) => b.ts - a.ts)[0];
            if (!launch?.actor) return Promise.reject();
            if (alive) setViaLaunch({ address: launch.actor, label: launch.label });
            return readBasket(launch.actor);
          })
          .then((d) => {
            if (alive && d) setData(d);
          })
          .catch(fail);
      });
    return () => {
      alive = false;
    };
  }, [e.actor, e.kind, e.source, e.ts]);

  // esc closes; the page behind must not scroll while the popup is open
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const name = data?.name || e.label || (e.kind === "burn" ? "PRISM buy & burn" : "Basket");
  const symbol = data?.symbol || e.symbol;
  const holdings = (data?.holdings ?? [])
    .map((h) => ({
      symbol: h.symbol === "?" ? `${h.asset.slice(0, 4)}…` : h.symbol,
      address: h.asset,
      weightPct: h.liveWeightPct > 0 ? h.liveWeightPct : h.targetWeightPct,
    }))
    .filter((h) => h.weightPct > 0);
  const figs = burnFigures(e, ethUsd, prismUsd);
  const chainLabel = e.chain === "base" ? "Base" : "Ethereum";

  const body = (
    <div className="fixed inset-0 z-[90] grid place-items-center p-4 sm:p-6" role="dialog" aria-modal="true" onClick={onClose}>
      {/* backdrop */}
      <div className="evt-modal-fade absolute inset-0 bg-black/70 backdrop-blur-md" aria-hidden />

      {/* panel */}
      <div
        ref={panelRef}
        className="evt-modal-pop relative w-full max-w-5xl max-h-[92vh] overflow-y-auto rounded-2xl border border-white/12 bg-[#0b0e17]/95 shadow-[0_30px_90px_rgba(0,0,0,0.6)]"
        style={{ "--c": color } as React.CSSProperties}
        onClick={(ev) => ev.stopPropagation()}
      >
        {/* event-colored top edge */}
        <div className="absolute inset-x-0 top-0 h-[3px] rounded-t-2xl" style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }} aria-hidden />

        <button
          onClick={onClose}
          aria-label="Close"
          data-noexport
          className="absolute top-4 right-4 z-10 grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-white/[0.05] text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <div className="grid md:grid-cols-[1fr_1.15fr]">
          {/* left: identity + figures */}
          <div className="p-6 sm:p-8 min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="text-[10px] font-bold uppercase tracking-[0.16em] rounded-full px-2.5 py-1 leading-none"
                style={{ color: `color-mix(in srgb, ${color} 75%, #e2e8f0)`, background: `${color}14`, border: `1px solid ${color}33` }}
              >
                {eventTitle(e)}
              </span>
              <span className="text-[11px] text-slate-500 font-medium">
                {chainLabel} · {relTime(e.ts, Date.now())}
              </span>
            </div>

            <div className="mt-5 flex items-baseline gap-3 flex-wrap">
              <h2 className="logo-font text-4xl md:text-[44px] font-bold tracking-tight txt-white leading-none">{name}</h2>
              {symbol && (
                <span
                  className="font-mono text-[13px] font-bold rounded-md px-2 py-1 leading-none"
                  style={{ color: `color-mix(in srgb, ${color} 72%, #e2e8f0)`, background: `${color}14`, border: `1px solid ${color}2a` }}
                >
                  ${symbol}
                </span>
              )}
            </div>

            {/* description / thesis — the basket's story, else what this event is */}
            <p className="mt-4 text-[13.5px] text-slate-400 leading-relaxed">
              {e.note ?? eventSourceLabel(e)}
              {data && (
                <>
                  {" "}
                  {holdings.length > 0 && (
                    <span className="text-slate-500">
                      One token holding {holdings.length} asset{holdings.length === 1 ? "" : "s"} on {chainLabel}.
                    </span>
                  )}
                </>
              )}
              {viaLaunch && (
                <span className="text-slate-500"> Attributed to the latest deployment before this burn (best effort).</span>
              )}
            </p>

            <div className="mt-6 grid grid-cols-2 gap-3">
              {figs.cost && <Tile value={figs.cost.value} label={figs.cost.label} sub={figs.cost.sub} />}
              {/* Burn and launch popups carry their burn figure as the wide row
                  below instead — a tile above it would say the same thing twice. */}
              {figs.burn && e.kind === "fee" && (
                <Tile
                  value={
                    burnHit
                      ? `🔥 ${fmtToken(burnHit.prism)}`
                      : figs.burn.value != null
                        ? `🔥 ~${fmtToken(figs.burn.value as number)}`
                        : "🔥 —"
                  }
                  label={burnHit ? "PRISM burned" : figs.burn.label}
                  sub={burnHit ? "confirmed on-chain" : figs.burn.sub}
                  color="#f59e0b"
                />
              )}
              {data && <Tile value={`$${fmtToken(data.navPerToken, 4)}`} label="NAV / token" sub={`supply ${fmtToken(data.totalSupply)}`} />}
              {data && <Tile value={fmtUsdFull(data.aumUsd)} label="Basket TVL" sub={`${data.pricedCount}/${data.totalCount} assets priced`} />}
            </div>

            {/* the burn, as its own full-width row: confirmed once detected;
                on launches an ESTIMATE until then (flips automatically) */}
            {burnHit ? (
              <div className="mt-3 rounded-xl border border-amber-400/25 bg-gradient-to-r from-amber-500/[0.12] via-orange-500/[0.07] to-transparent px-4 py-3.5">
                <div className="flex items-center gap-2">
                  <span className="text-[15px] leading-none">🔥</span>
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300/90">Burn detected</span>
                </div>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="font-mono font-bold text-[22px] leading-none text-amber-300">
                    {fmtToken(burnHit.prism)} PRISM
                  </span>
                  <span className="text-[12px] text-slate-400 font-medium">
                    burned
                    {burnHit.pct > 0 ? ` — ${fmtPct(burnHit.pct)} of the supply` : ""}
                    {e.kind === "launch" ? ", from this deployment" : ""}
                  </span>
                  <a
                    href={txUrl(burnHit.txHash, "ethereum")}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[12px] font-semibold text-amber-200/90 hover:text-amber-100 transition-colors"
                  >
                    View burn transaction
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7 17 17 7" />
                      <path d="M7 7h10v10" />
                    </svg>
                  </a>
                </div>
              </div>
            ) : e.kind === "launch" && figs.burn ? (
              <div className="mt-3 rounded-xl border border-amber-400/15 bg-white/[0.03] px-4 py-3.5">
                <div className="flex items-center gap-2">
                  <span className="text-[15px] leading-none">🔥</span>
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-200/70">Estimated PRISM burn</span>
                </div>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="font-mono font-bold text-[22px] leading-none text-amber-200/90">
                    {figs.burn.value != null ? `~${fmtToken(figs.burn.value as number)} PRISM` : "—"}
                  </span>
                  <span className="text-[12px] text-slate-400 font-medium">
                    {figs.burn.value != null && prismSupply > 0
                      ? `≈ ${fmtPct(((figs.burn.value as number) / prismSupply) * 100)} of the supply, estimated from this basket launch`
                      : "estimated from this basket launch"}
                  </span>
                  <span className="text-[11px] text-slate-500">confirms automatically once the burn executes</span>
                </div>
              </div>
            ) : null}

            {/* share bar — never part of the exported image */}
            <div className="mt-6 flex flex-wrap items-center gap-2" data-noexport>
              <button
                type="button"
                onClick={copyImage}
                disabled={imgState === "busy"}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.05] px-3.5 py-1.5 text-[12px] font-semibold text-slate-200 hover:bg-white/10 transition-colors disabled:opacity-50"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="m21 15-5-5L5 21" />
                </svg>
                {imgState === "busy" ? "Rendering…" : imgState === "copied" ? "Image copied ✓" : imgState === "saved" ? "Image saved ✓" : "Copy image"}
              </button>
              <button
                type="button"
                onClick={copyLink}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.05] px-3.5 py-1.5 text-[12px] font-semibold text-slate-200 hover:bg-white/10 transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                {linkCopied ? "Link copied ✓" : "Copy link"}
              </button>
              <button
                type="button"
                onClick={shareOnX}
                className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-bold text-black bg-white hover:bg-slate-200 transition-colors"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                Share on X
              </button>
            </div>

            <div className="mt-5 flex items-center gap-3 text-[11px]">
              {e.txHash && (
                <a
                  href={txUrl(e.txHash, e.chain)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-slate-400 hover:text-slate-200 transition-colors font-semibold"
                >
                  View transaction
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 17 17 7" />
                    <path d="M7 7h10v10" />
                  </svg>
                </a>
              )}
              {e.actor && (
                <a
                  href={addrUrl(e.actor, e.chain)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-slate-600 hover:text-slate-400 transition-colors"
                >
                  {e.actor.slice(0, 6)}…{e.actor.slice(-4)}
                </a>
              )}
            </div>
          </div>

          {/* right: the basket bento — attributed via the launch when the burn
              came through the auction pipe; burns with genuinely no basket
              (pool compounding, reserves) get a PRISM-tile bento with the burn
              figures overlaid, so the right side is ALWAYS a bento. */}
          <div className="p-6 sm:p-8 md:pl-0">
            <div className="relative h-[320px] md:h-full md:min-h-[480px] rounded-2xl border border-white/10 bg-white/[0.02] p-1.5 overflow-hidden">
              {holdings.length > 0 ? (
                <BasketBento items={holdings} chain={e.chain} />
              ) : failed && e.kind === "burn" ? (
                <div className="relative h-full w-full">
                  <BasketBento items={[{ symbol: "PRISM", address: PRISM_ADDR, weightPct: 100 }]} chain="ethereum" />
                  <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-xl bg-black/35">
                    <div className="text-center px-6">
                      <div className="text-[56px] leading-none drop-shadow-[0_4px_16px_rgba(0,0,0,0.6)]">🔥</div>
                      <div className="mt-3 font-mono font-bold text-4xl text-amber-300 leading-none drop-shadow-[0_2px_10px_rgba(0,0,0,0.7)]">
                        {fmtToken(burnHit?.prism ?? e.prism ?? 0)}
                      </div>
                      <div className="mt-2 text-[11px] font-bold uppercase tracking-[0.2em] text-amber-200/90">PRISM bought & burned</div>
                      <div className="mt-3 text-[12px] text-slate-200/80 leading-relaxed max-w-[260px] mx-auto">
                        Sent to the dead address forever
                        {burnHit && burnHit.pct > 0
                          ? ` — ${fmtPct(burnHit.pct)} of the supply, gone`
                          : ", permanently reducing the 5,000 hard cap"}
                        .
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid h-full place-items-center text-[12px] text-slate-500 font-mono">
                  {failed ? "Basket detail unavailable" : "Reading the basket…"}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document === "undefined" ? null : createPortal(body, document.body);
}
