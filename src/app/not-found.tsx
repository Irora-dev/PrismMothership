"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { C, MONO, glass } from "@/components/mothership/style";

// ── SIGNAL LOST — the 404 page ───────────────────────────────────────────────
// the designer's mockup (2026-08-02): red-alert takeover — a skeleton deck flickering
// behind a glass modal, scanlines, glitching title, and one recovery action.
// The theatre is deliberate; the facts are real: the terminal readout names the
// route that actually failed to resolve, and the button goes home.

const skeleton: React.CSSProperties = {
  background:
    "linear-gradient(90deg, rgba(255,255,255,0.02) 25%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.02) 75%)",
  backgroundSize: "200% 100%",
  animation: "ms-skeleton 2s linear infinite",
};

function Bone({ className }: { className: string }) {
  return <div className={`rounded ${className}`} style={skeleton} />;
}

export default function NotFound() {
  const pathname = usePathname();

  return (
    <div className="relative min-h-screen overflow-hidden" style={{ background: C.ground, color: "#E2E8F0" }}>
      {/* red-shifted ambient ground */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute left-[15%] top-1/2 h-[40%] w-[40%] -translate-y-1/2 rounded-full blur-[120px]" style={{ background: `${C.red}08` }} />
        <div className="absolute right-[15%] top-[30%] h-[35%] w-[35%] rounded-full blur-[120px]" style={{ background: `${C.red}08` }} />
      </div>

      {/* CRT flicker film over everything */}
      <div
        className="pointer-events-none fixed inset-0 z-20"
        style={{ background: "rgba(18,16,16,0.1)", animation: "ms-flicker 0.15s infinite" }}
      />

      {/* ── the dead deck behind: sidebar + dashboard skeletons ── */}
      <aside
        className="fixed bottom-0 left-0 top-0 z-0 hidden w-[72px] flex-col py-6 opacity-50 sm:flex"
        style={{ ...glass, borderRight: "1px solid rgba(255,255,255,0.05)" }}
      >
        <div className="mb-10 px-4">
          <Bone className="h-10 w-10 rounded-xl" />
        </div>
        <div className="flex-1 space-y-4 px-4">
          <Bone className="h-10 w-10 rounded-xl" />
          <Bone className="h-10 w-10 rounded-xl" />
          <Bone className="h-10 w-10 rounded-xl" />
          <Bone className="h-10 w-10 rounded-xl" />
        </div>
      </aside>

      <main className="pointer-events-none mx-auto w-full max-w-[1536px] space-y-6 p-6 opacity-30 blur-[2px] sm:pl-24">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="flex min-h-[400px] flex-col items-center justify-center gap-6 rounded-2xl p-8 lg:col-span-8" style={glass}>
            <Bone className="h-6 w-32 rounded-full" />
            <Bone className="h-24 w-64 rounded-xl" />
            <Bone className="h-10 w-48 rounded-xl" />
          </div>
          <div className="flex flex-col gap-6 lg:col-span-4">
            <div className="flex flex-1 flex-col justify-between rounded-2xl p-6" style={glass}>
              <div>
                <Bone className="mb-4 h-4 w-24" />
                <Bone className="mb-2 h-10 w-32" />
                <Bone className="h-3 w-20" />
              </div>
              <div className="mt-6 border-t border-white/5 pt-4">
                <Bone className="mb-2 h-3 w-24" />
                <Bone className="h-8 w-20" />
              </div>
            </div>
            <div className="flex flex-1 flex-col justify-between rounded-2xl p-6" style={glass}>
              <div>
                <Bone className="mb-4 h-4 w-24" />
                <Bone className="h-10 w-16" />
              </div>
              <div className="mt-6 border-t border-white/5 pt-4">
                <Bone className="mb-2 h-3 w-32" />
                <Bone className="h-8 w-24" />
              </div>
            </div>
          </div>
        </div>
        <div className="flex h-40 flex-col items-center justify-between gap-8 rounded-2xl p-6 lg:flex-row lg:p-8" style={glass}>
          <div className="flex w-full flex-1 flex-col gap-4">
            <Bone className="h-4 w-40" />
            <Bone className="h-12 w-32" />
          </div>
          <div className="hidden w-full flex-1 flex-col justify-center space-y-4 px-8 lg:flex">
            <Bone className="h-4 w-full" />
            <Bone className="h-4 w-full" />
            <Bone className="h-4 w-full" />
          </div>
          <div className="hidden w-full flex-1 flex-col items-end gap-4 lg:flex">
            <Bone className="h-4 w-48" />
            <Bone className="h-12 w-24" />
          </div>
        </div>
      </main>

      {/* ── the SIGNAL LOST modal ── */}
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
        <div
          className="relative w-full max-w-lg overflow-hidden rounded-2xl p-8"
          style={{ ...glass, border: `1px solid ${C.red}4d`, boxShadow: `0 0 50px ${C.red}1a` }}
        >
          {/* scanline film */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: `linear-gradient(to bottom, transparent 50%, ${C.red}0d 51%)`, backgroundSize: "100% 4px" }}
          />
          {/* searching progress rule */}
          <div className="absolute left-0 top-0 h-1 w-full" style={{ background: `${C.red}33` }}>
            <div className="h-full w-1/3 animate-pulse" style={{ background: C.red }} />
          </div>

          <div className="relative z-10 flex flex-col items-center text-center">
            <div
              className="mb-6 flex h-20 w-20 animate-pulse items-center justify-center rounded-full"
              style={{ background: `${C.red}1a`, border: `1px solid ${C.red}4d` }}
            >
              <svg
                className="h-10 w-10"
                style={{ color: C.red, animation: "ms-glitch 2s infinite" }}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>

            <h1
              className="mb-2 text-3xl font-black uppercase tracking-widest text-white"
              style={{ textShadow: `0 0 20px ${C.red}80`, animation: "ms-glitch 2s infinite" }}
            >
              Signal lost
            </h1>
            <p className="mb-8 text-sm text-slate-400" style={{ fontFamily: MONO }}>
              THIS SECTOR OF THE MOTHERSHIP DOES NOT EXIST.
            </p>

            <div
              className="mb-8 max-h-32 w-full overflow-y-auto rounded-xl border border-white/5 p-4 text-left text-xs"
              style={{ fontFamily: MONO, background: "rgba(3,4,9,0.8)", color: `${C.red}b3` }}
            >
              <div>&gt; INITIALIZING RECOVERY PROTOCOL...</div>
              <div className="opacity-75">
                &gt; RESOLVE: {pathname || "/unknown"} [ERR_404_NOT_FOUND]
              </div>
              <div className="opacity-50">&gt; SCANNING KNOWN SECTORS... NO MATCH</div>
              <div className="animate-pulse">&gt; AWAITING MANUAL OVERRIDE...</div>
            </div>

            <Link
              href="/"
              className="group flex w-full items-center justify-center gap-3 rounded-xl py-4 text-sm font-bold uppercase tracking-widest transition-all duration-300"
              style={{ background: `${C.red}1a`, border: `1px solid ${C.red}80`, color: C.red, boxShadow: `0 0 20px ${C.red}33` }}
            >
              <svg className="h-5 w-5 group-hover:animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Initiate reconnect sequence
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
