import type { CSSProperties } from "react";

const BANDS = ["#ff5a5a", "#ff9f45", "#ffe14d", "#5cff8f", "#3bd9ff", "#7c8bff", "#c06aff"];

/**
 * Pixel-art rainbow — the brand mark. Built as continuous concentric pixel rings
 * (one band per spectrum colour). `animate` sweeps the pixels in left → right.
 */
export function PixelRainbow({
  className = "",
  animate = true,
  glow = true,
  loop = false,
  cell = 6,
}: {
  className?: string;
  animate?: boolean;
  glow?: boolean;
  /** the sweep plays forward, then back, forever (the designer, 2026-08-03) */
  loop?: boolean;
  cell?: number;
}) {
  const gap = cell * 0.2;
  const R = 9; // outer radius (red)
  const INNER = 3; // inner radius (violet)
  const cols = R * 2 + 1;
  const rows = R + 1;
  const cells: { x: number; y: number; c: string }[] = [];
  for (let x = -R; x <= R; x++) {
    for (let y = 0; y <= R; y++) {
      const d = Math.round(Math.hypot(x, y));
      if (d < INNER || d > R) continue;
      cells.push({ x, y, c: BANDS[R - d] });
    }
  }
  return (
    <svg
      viewBox={`0 0 ${cols * cell} ${rows * cell}`}
      className={className}
      role="img"
      aria-label="pixel rainbow"
      style={glow ? { filter: "drop-shadow(0 3px 12px rgba(150,120,255,0.45))" } : undefined}
    >
      {cells.map((p, i) => {
        const style: CSSProperties | undefined = animate
          ? {
              transformBox: "fill-box",
              transformOrigin: "center",
              animation: `prism-pixel-in ${loop ? "1.4s" : "0.45s"} cubic-bezier(0.2,0.8,0.2,1.1) ${Math.round(180 + ((p.x + R) / (2 * R)) * 640)}ms ${loop ? "infinite alternate " : ""}both`,
            }
          : undefined;
        return (
          <rect
            key={i}
            className={animate ? "prism-pixel" : undefined}
            x={(p.x + R) * cell + gap / 2}
            y={(rows - 1 - p.y) * cell + gap / 2}
            width={cell - gap}
            height={cell - gap}
            rx={cell * 0.18}
            fill={p.c}
            style={style}
          />
        );
      })}
    </svg>
  );
}
