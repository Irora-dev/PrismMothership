"use client";

import Link from "next/link";
import { useRadio } from "@/components/radio/radio-provider";

// Hero pill under the title: a play toggle to start Prismbeat Radio in place,
// plus a little button to open the full /radio page.
export function StartRadioButton({ className = "" }: { className?: string }) {
  const radio = useRadio();
  const accent = radio.station.accent;
  const label = radio.loading ? "Tuning in…" : radio.playing ? "Prismbeat Radio · on air" : "Start Prismbeat Radio";

  return (
    <div className={`group inline-flex items-stretch rounded-xl border border-white/15 bg-transparent transition-colors hover:border-white/30 hover:bg-white/[0.04] ${className}`}>
      <button
        onClick={radio.toggle}
        aria-label={radio.playing ? "Pause Prismbeat Radio" : "Start Prismbeat Radio"}
        className="flex items-center gap-2.5 py-2 pl-2 pr-3"
      >
        <span
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-black"
          style={{ background: accent, boxShadow: `0 4px 18px ${accent}55` }}
        >
          {radio.loading ? (
            <span className="h-3.5 w-3.5 rounded-full border-2 border-black/30 border-t-black/80 animate-spin" />
          ) : radio.playing ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <rect x="6" y="5" width="4" height="14" rx="1.2" />
              <rect x="14" y="5" width="4" height="14" rx="1.2" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </span>
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-300 transition-colors group-hover:text-white">
          {radio.playing && (
            <span className="flex h-3 items-end gap-[2px]" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-[2px] rounded-full"
                  style={{ height: "100%", background: accent, transformOrigin: "bottom", animation: `radio-eq 0.9s ease-in-out ${i * 0.18}s infinite` }}
                />
              ))}
            </span>
          )}
          {label}
        </span>
      </button>

      <span className="my-2 w-px self-stretch bg-white/10" aria-hidden />

      <Link
        href="/radio"
        aria-label="Open Prism Radio"
        title="Open Prism Radio"
        className="grid place-items-center self-stretch rounded-r-xl px-2.5 text-slate-400 transition-colors hover:text-white"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m9 18 6-6-6-6" />
        </svg>
      </Link>
    </div>
  );
}
