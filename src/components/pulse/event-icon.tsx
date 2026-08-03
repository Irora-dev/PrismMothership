import type { EventKind } from "@/lib/feed/types";
import { KIND_META } from "@/lib/feed/format";

export function EventIcon({
  kind,
  size = 18,
  color,
}: {
  kind: EventKind;
  size?: number;
  color?: string;
}) {
  const c = color ?? KIND_META[kind].color;
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: c,
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (kind) {
    case "burn":
      return (
        <svg {...common} fill={c} stroke="none">
          <path d="M12 2c1 3-1 4-2 6-1 2 0 4 2 4 1.5 0 2-1 2-2 1 1 2 2.5 2 4a6 6 0 1 1-12 0c0-3 2-5 3-7 .5 2 2 2 3 1 1-1 1-4 0-6z" />
        </svg>
      );
    case "fee":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 7v10M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4" />
        </svg>
      );
    case "launch":
      return (
        <svg {...common}>
          <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
          <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
          <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
        </svg>
      );
    case "harvest":
      return (
        <svg {...common}>
          <path d="M12 22V8" />
          <path d="M12 8c0-3-2-5-5-5-1 0-2 .3-2 .3S5 8 8 9c2 .7 4 0 4 0z" />
          <path d="M12 11c0-2.5 2-4.5 5-4.5 1 0 2 .3 2 .3S18 11 15 12c-2 .6-3-1-3-1z" />
        </svg>
      );
    case "retire":
      return (
        <svg {...common}>
          <path d="M6 3h12l4 6-10 12L2 9z" />
          <path d="M11 3 8 9l4 12 4-12-3-6" />
          <path d="M2 9h20" />
        </svg>
      );
    case "nft":
      return (
        <svg {...common} fill={c} stroke="none">
          <path d="M12 2.5 14.2 9 21 11.2 14.2 13.4 12 20 9.8 13.4 3 11.2 9.8 9z" />
        </svg>
      );
  }
}
