"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PixelReveal } from "@/components/effects/pixel-reveal";
import { IndexCard, type IndexSummary } from "@/components/spectrum/index-card";

/**
 * Homepage section surfacing the live Spectrum index tokens. Data is fetched
 * lazily (only once it scrolls into view) so the expensive Base reads behind
 * /api/spectrum/indexes don't fire on every homepage load. Cards link to the
 * per-index detail page (chart + holdings); the header links to the full list.
 */
export function IndexSection() {
  const ref = useRef<HTMLDivElement>(null);
  const fetchedRef = useRef(false);
  const [indexes, setIndexes] = useState<IndexSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting || fetchedRef.current) return;
        fetchedRef.current = true;
        io.disconnect();
        fetch("/api/spectrum/indexes")
          .then((r) => r.json())
          .then((d: { indexes?: IndexSummary[]; error?: string }) => {
            if (d.error) setErr(d.error);
            else setIndexes(d.indexes ?? []);
          })
          .catch((e) => setErr(String(e)));
      },
      { rootMargin: "250px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section ref={ref} id="indexes" className="container mx-auto px-4 md:px-6 max-w-[1100px] relative z-10 py-12 md:py-16">
      <div className="border-t border-white/10 pt-12 md:pt-16">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-slate-500 font-semibold mb-3">Spectrum · Ethereum &amp; Base</div>
            <h2 className="text-3xl md:text-4xl font-bold txt-white leading-tight">All Baskets</h2>
            <p className="text-base text-slate-400 leading-relaxed max-w-2xl mt-3">
              Community basket tokens on Ethereum and Base. One token, the whole basket. Every trade feeds the PRISM
              burn. Open one for its live <span className="spectrum-text-gradient font-semibold">rainbow</span> chart,
              holdings, and price.
            </p>
          </div>
          <Link href="/spectrum#baskets" className="btn-glass shrink-0">
            Explore all baskets
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 17 17 7" /><path d="M7 7h10v10" />
            </svg>
          </Link>
        </div>

        {err && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-5 text-red-300 font-mono text-[13px]">
            Could not load baskets. {err}
          </div>
        )}

        {!err && !indexes && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="glass-card p-5 h-[245px] animate-pulse opacity-40" />
            ))}
          </div>
        )}

        {indexes && indexes.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {indexes.map((ix, i) => (
              <PixelReveal key={ix.address} delay={i * 120} accent="#22d3ee" maxPixels={150}>
                <IndexCard ix={ix} />
              </PixelReveal>
            ))}
          </div>
        )}

        {indexes && indexes.length === 0 && !err && (
          <div className="text-[13px] text-slate-600 font-mono py-8 text-center">No baskets found.</div>
        )}
      </div>
    </section>
  );
}
