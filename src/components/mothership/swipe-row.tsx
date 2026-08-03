"use client";

// ── SwipeRow: an obviously-swipeable carousel below lg ───────────────────────
// the designer's mobile/tablet pass (2026-08-03 1254): dense card sections (the app
// store, the flywheel, the deck's three columns) become swipe carousels on
// mobile + tablet. Affordance is built in — each card leaves a PEEK of the
// next, the right edge fades, and a chevron hint pulses until the first
// scroll. At lg and up the same children lay out as the desktop grid passed
// via `desktopClass`.

import { useRef, useState } from "react";

export function SwipeRow({
  children,
  desktopClass,
  itemClass = "w-[86%] sm:w-[62%] md:w-[46%]",
  className = "",
}: {
  children: React.ReactNode;
  /** the ≥lg layout, e.g. "lg:grid lg:grid-cols-4 lg:gap-6" */
  desktopClass: string;
  /** slide width below lg — keep <100% so the next card peeks */
  itemClass?: string;
  className?: string;
}) {
  const [scrolled, setScrolled] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div className={`relative ${className}`}>
      <div
        ref={ref}
        onScroll={() => !scrolled && setScrolled(true)}
        className={`flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:snap-none lg:gap-6 lg:overflow-visible lg:pb-0 ${desktopClass}`}
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {Array.isArray(children)
          ? children.map((c, i) => (
              <div key={i} className={`snap-center shrink-0 ${itemClass} lg:w-auto lg:shrink lg:snap-none`}>
                {c}
              </div>
            ))
          : children}
      </div>

      {/* right-edge fade + pulse hint — swipe affordance, gone once touched */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-14 lg:hidden"
        style={{ background: "linear-gradient(to right, rgba(3,4,9,0), rgba(3,4,9,0.85))", opacity: scrolled ? 0 : 1, transition: "opacity 300ms" }}
      />
      {!scrolled && (
        <div
          aria-hidden
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 animate-pulse text-slate-300 lg:hidden"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </div>
      )}
    </div>
  );
}
