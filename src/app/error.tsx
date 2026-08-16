"use client";

import { useEffect } from "react";
import Link from "next/link";
import { C, MONO, glass } from "@/components/mothership/style";

// ── SYSTEM FAULT — the runtime error boundary ────────────────────────────────
// The site has a designed 404 and had NOTHING for a thrown render, so any error
// escaping a page component dropped the visitor onto Next's own screen: a bare
// "Application error: a client-side exception has occurred" on a white page,
// with no way back and no sign it was ever the same product. On a site making
// this many chain reads that is not a hypothetical.
//
// It borrows the 404's language deliberately (red-shifted ground, glass panel,
// terminal readout) so a fault reads as part of the ship rather than as the
// wheels coming off, and it keeps the honesty rule the 404 keeps: the readout
// carries the REAL error, including the digest a production build gives you,
// because "something went wrong" is unactionable for whoever has to chase it.
//
// Two doors, because reload and go-home fail differently: a transient chain
// read wants retrying, a genuinely broken route does not.

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // the boundary swallows it otherwise, and an error nobody can see is an
    // error nobody fixes
    console.error("[mothership] render fault:", error);
  }, [error]);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-6" style={{ background: C.ground, color: "#E2E8F0" }}>
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute left-[15%] top-1/2 h-[40%] w-[40%] -translate-y-1/2 rounded-full blur-[120px]" style={{ background: `${C.red}08` }} />
        <div className="absolute right-[15%] top-[30%] h-[35%] w-[35%] rounded-full blur-[120px]" style={{ background: `${C.red}08` }} />
      </div>

      <div className="relative z-10 w-full max-w-lg rounded-2xl p-8" style={{ ...glass, border: `1px solid ${C.red}33` }}>
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: C.red }} />
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: C.red }}>
            System fault
          </span>
        </div>

        <h1 className="mt-4 text-3xl font-black tracking-tight text-white sm:text-4xl">Something on this page broke.</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          The chain data behind the Mothership is read live, so a page can fail while everything it reports is
          perfectly fine. Nothing you were looking at was written to, and nothing is lost.
        </p>

        <div
          className="mt-6 overflow-x-auto rounded-xl border p-4 text-[11px] leading-relaxed"
          style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.4)", fontFamily: MONO, color: "#94a3b8" }}
        >
          <div style={{ color: `${C.red}cc` }}>&gt; fault</div>
          <div className="mt-1 break-words text-slate-300">{error.message || "unknown error"}</div>
          {error.digest && (
            <>
              <div className="mt-3" style={{ color: `${C.red}cc` }}>&gt; digest</div>
              <div className="mt-1 text-slate-300">{error.digest}</div>
            </>
          )}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            onClick={reset}
            className="rounded-lg px-4 py-2 text-xs font-bold text-white transition-all hover:brightness-110"
            style={{ background: `linear-gradient(90deg, ${C.cyan}cc, ${C.purple}cc)` }}
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-lg border px-4 py-2 text-xs font-semibold text-slate-300 transition-colors hover:text-white"
            style={{ borderColor: "rgba(255,255,255,0.1)" }}
          >
            Back to the Mothership
          </Link>
        </div>
      </div>
    </div>
  );
}
