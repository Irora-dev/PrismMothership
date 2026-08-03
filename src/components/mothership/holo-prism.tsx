"use client";

import type { CSSProperties } from "react";
import { RAINBOW } from "./style";

// ── The spinning holo prism ──────────────────────────────────────────────────
// Three spectrum faces in thirds, always spinning, statically tilted so the
// silhouette stays readable at every spin angle. One definition — the
// AUTHORIZE sheet and the app-store cards both render this exact object
// (two hand-typed copies of anything is how the X link went stale).

export function HoloPrism({ size, spinSec = 8 }: { size: number; spinSec?: number }) {
  const face = (deg: number): CSSProperties => ({
    position: "absolute",
    inset: 0,
    clipPath: "polygon(50% 0, 0 100%, 100% 100%)",
    background: RAINBOW,
    backgroundSize: "300% 100%",
    // the holo shimmer: the site's spectrum drifting across each face
    animation: "prism-bar-pan 3.4s linear infinite",
    transform: `rotateY(${deg}deg) translateZ(${Math.round(size * 0.29)}px)`,
    opacity: 0.85,
  });
  return (
    <div style={{ perspective: 600 }} aria-hidden>
      <div style={{ transform: "rotateX(14deg)", transformStyle: "preserve-3d" }}>
        <div
          className="relative"
          style={{
            width: size,
            height: Math.round(size * 0.92),
            transformStyle: "preserve-3d",
            animation: `ms-prism-spin ${spinSec}s linear infinite`,
          }}
        >
          <div style={face(0)} />
          <div style={face(120)} />
          <div style={face(240)} />
        </div>
      </div>
    </div>
  );
}
