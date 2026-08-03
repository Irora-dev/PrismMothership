"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { C, MONO, RAINBOW, glass } from "./style";
import { HoloPrism } from "./holo-prism";

// ── AUTHORIZE — the hold-to-execute sheet ────────────────────────────────────
// the designer's spec (2026-08-02 wall session): a slide-up glass sheet with a
// spinning 3D holo-rainbow prism, REAL amounts only, an honest warning card,
// and a HOLD-to-execute button — pointer held ~1.2s fills a rainbow progress,
// release cancels, completion fires onConfirm exactly once. Wired to
// claim/withdraw on /claim; generic enough for any consequential action.

const HOLD_MS = 1200;

export interface AuthorizeRow {
  label: string;
  value: string;
}

export function AuthorizeModal({
  open,
  title,
  rows,
  warning,
  actionLabel,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  rows?: AuthorizeRow[]; // real figures, caller-formatted — never placeholders
  warning?: string; // honest words about what this action does and does not do
  actionLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  /** custom detail content — replaces rows+warning for visual-first sheets */
  children?: React.ReactNode;
}) {
  const [progress, setProgress] = useState(0);
  const hold = useRef<{ raf: number; start: number; fired: boolean } | null>(null);

  const cancelHold = useCallback(() => {
    if (hold.current) {
      cancelAnimationFrame(hold.current.raf);
      if (!hold.current.fired) setProgress(0);
      hold.current = null;
    }
  }, []);

  const beginHold = useCallback(() => {
    if (hold.current) return;
    const start = performance.now();
    const state = { raf: 0, start, fired: false };
    hold.current = state;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / HOLD_MS);
      setProgress(p);
      if (p >= 1) {
        if (!state.fired) {
          state.fired = true;
          hold.current = null;
          onConfirm();
        }
        return;
      }
      state.raf = requestAnimationFrame(step);
    };
    state.raf = requestAnimationFrame(step);
  }, [onConfirm]);

  // fresh progress every open; Esc closes; never leave a raf running
  useEffect(() => {
    if (!open) return;
    setProgress(0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      cancelHold();
    };
  }, [open, onClose, cancelHold]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl p-6 sm:p-8"
        style={{ ...glass, animation: "ms-sheet-up 0.4s cubic-bezier(0.16,1,0.3,1) both" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* the rainbow top rule */}
        <div className="absolute left-0 top-0 h-[2px] w-full" style={{ background: RAINBOW }} />

        <h2 className="text-center text-xl font-black tracking-tight text-white">{title}</h2>

        {/* the 3D holo prism — the site's one shared prism object */}
        <div className="mt-6 flex items-center justify-center">
          <HoloPrism size={120} />
        </div>

        {children ?? (
          <>
            {/* real amounts only */}
            {rows && (
              <div className="mt-6 rounded-xl border border-white/10 p-4" style={{ background: "rgba(3,4,9,0.6)" }}>
                {rows.map((r) => (
                  <div key={r.label} className="flex items-baseline justify-between gap-4 py-1.5">
                    <span className="text-xs text-slate-500">{r.label}</span>
                    <span className="text-right text-sm font-semibold text-white tabular-nums" style={{ fontFamily: MONO }}>
                      {r.value}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {/* the honest words */}
            {warning && (
              <div
                className="mt-4 rounded-xl px-4 py-3 text-[12px] leading-relaxed text-slate-300"
                style={{ background: `${C.orange}0d`, borderLeft: `2px solid ${C.orange}80` }}
              >
                {warning}
              </div>
            )}
          </>
        )}

        {/* HOLD to execute */}
        <button
          onPointerDown={beginHold}
          onPointerUp={cancelHold}
          onPointerLeave={cancelHold}
          onPointerCancel={cancelHold}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
              e.preventDefault();
              beginHold();
            }
          }}
          onKeyUp={(e) => {
            if (e.key === "Enter" || e.key === " ") cancelHold();
          }}
          onContextMenu={(e) => e.preventDefault()}
          className="relative mt-6 w-full touch-none select-none overflow-hidden rounded-xl border border-white/10 py-4 text-sm font-bold text-white"
          style={{ background: "rgba(255,255,255,0.05)" }}
        >
          <span
            className="absolute inset-0"
            style={{
              transform: `scaleX(${progress})`,
              transformOrigin: "left",
              background: RAINBOW,
              opacity: 0.9,
              transition: progress === 0 ? "transform 200ms ease-out" : "none",
            }}
          />
          <span className="relative z-10" style={progress > 0.35 ? { textShadow: "0 1px 8px rgba(0,0,0,0.8)" } : undefined}>
            {progress >= 1 ? "Authorized" : actionLabel}
          </span>
        </button>
        <p className="mt-3 text-center text-[11px] text-slate-500">
          Hold until the spectrum fills. Releasing cancels; Esc closes.
        </p>
      </div>
    </div>
  );
}
