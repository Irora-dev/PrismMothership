"use client";

// ── The full-bleed hero video backdrop ───────────────────────────────────────
// One definition for the home and trade heroes (two hand-typed copies of
// anything is how the X link went stale): full content-region width OUTSIDE
// the centered column (the shell's relative wrapper), reaching up behind the
// translucent brand bar, masked ~88% at the top to nothing at the bottom, and
// a left scrim holding the copy's contrast floor.
//
// Playback is a NATIVE loop over a pre-rendered BOOMERANG file (forward +
// reversed frames, scripts/make-boomerang.swift) — the old JS reverse-scrub
// juddered by construction, because decoders seek keyframes badly backward.
export function HeroVideoBackdrop({ src, poster }: { src: string; poster?: string }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 -top-[73px] z-0 h-[625px] overflow-hidden lg:h-[745px]"
      style={{
        maskImage: "linear-gradient(to bottom, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.62) 55%, transparent 100%)",
        WebkitMaskImage: "linear-gradient(to bottom, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.62) 55%, transparent 100%)",
      }}
    >
      <video src={src} poster={poster} autoPlay muted loop playsInline className="h-full w-full object-cover" />
      {/* left scrim so hero copy keeps its contrast floor over the bright
          motion — inside the mask, so it fades out with the art */}
      <div
        className="absolute inset-0"
        style={{ background: "linear-gradient(to right, rgba(3,4,9,0.78) 0%, rgba(3,4,9,0.42) 42%, rgba(3,4,9,0) 72%)" }}
      />
    </div>
  );
}
