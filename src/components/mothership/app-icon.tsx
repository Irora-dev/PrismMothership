import { PixelRainbow } from "@/components/effects/pixel-rainbow";
import { C } from "./style";

// App-store icon tiles — one distinct glyph per docked app. Prism wears the
// brand mark itself; the rest get simple line glyphs on their accent gradient.
const GLYPHS: Record<string, string> = {
  "Spectrum Baskets":
    "M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z",
  "Spectrum Portfolio": "M12 4L4 8l8 4 8-4-8-4z M4 12l8 4 8-4 M4 16l8 4 8-4",
};

export function AppIcon({ name, color, size = 48 }: { name: string; color: string; size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-xl border border-white/10 shadow-lg"
      style={{ width: size, height: size, background: `linear-gradient(135deg, ${color}59, ${C.ground})` }}
    >
      {name === "Prism" ? (
        <PixelRainbow className="h-1/2 w-auto" animate={false} glow={false} />
      ) : (
        <svg style={{ width: size / 2, height: size / 2 }} className="text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d={GLYPHS[name] ?? "M13 10V3L4 14h7v7l9-11h-7z"}
          />
        </svg>
      )}
    </div>
  );
}
