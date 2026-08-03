"use client";

import type { Chain } from "./index-card";

// Chain filter pills — one logo pill per supported chain, multi-select toggles.
// Active = brand-tinted with a soft glow; inactive = dimmed outline. Toggling
// the last active chain resets to all (an empty grid is never useful).

const META: Record<Chain, { label: string; color: string }> = {
  ethereum: { label: "Ethereum", color: "#8ea2ff" },
  base: { label: "Base", color: "#2151f5" },
  robinhood: { label: "Robinhood", color: "#CCFF00" }, // the chain's acid yellow (robinhood.com/eu/en/chain)
};
export const ALL_CHAINS: Chain[] = ["ethereum", "base", "robinhood"];

function EthLogo({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="currentColor" aria-hidden>
      <path d="M7 .6 2.7 7.1 7 9.7l4.3-2.6L7 .6Z" opacity="0.95" />
      <path d="M7 10.8 2.7 8.2 7 13.4l4.3-5.2L7 10.8Z" opacity="0.65" />
    </svg>
  );
}
function BaseLogo({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden>
      <circle cx="7" cy="7" r="6.4" fill="currentColor" />
      <rect x="0.6" y="6.1" width="7.6" height="1.8" rx="0.9" fill="#0a0a0f" />
    </svg>
  );
}
function HoodLogo({ size = 13 }: { size?: number }) {
  // the genuine Robinhood Chain feather (lifted from the lockup on
  // robinhood.com/eu/en/chain — three strokes, viewBox 0 0 65 84)
  return (
    <svg width={(size * 65) / 84} height={size} viewBox="0 0 65 84" fill="currentColor" aria-hidden>
      <path d="M41.2967 18.946H24.3318C23.7179 18.946 23.1598 19.1707 22.7692 19.7325L10.6035 34.9005C8.81775 37.1477 8.3713 39.2262 8.3713 42.2037V57.7088C4.40909 68.8882 1.89783 76.4722 0.0562398 83.3259C-0.111178 83.7753 0.112046 84 0.502686 84H2.34428C2.67911 84 2.95814 83.8315 3.12556 83.5506C17.0212 47.9338 32.1446 30.294 41.6316 19.7325C42.0222 19.2831 41.8548 18.946 41.2967 18.946Z" />
      <path d="M41.7991 1.47599C40.7388 1.98159 40.1807 2.09394 39.0646 3.10515C34.0421 7.43084 30.6937 10.8577 27.5128 14.2284C27.1222 14.6216 27.2896 15.0149 27.8476 15.0149H46.6542C48.3842 15.0149 49.3887 16.0261 49.3887 17.7676V39.1152C49.3887 39.6769 49.8351 39.8455 50.1699 39.3399L61.4985 24.4527C63.3401 22.0371 63.8982 21.3068 64.4004 17.9361C65.0701 12.9924 64.6795 5.40844 61.7217 2.26248C59.0989 -0.546415 47.268 -0.658771 41.7991 1.47599Z" />
      <path d="M44.6454 23.2157C32.982 36.3051 23.8856 50.0687 15.4589 66.6412C15.2357 67.0906 15.5147 67.4277 16.017 67.2591L33.4284 61.8661C35.3816 61.3605 36.4977 60.4616 37.4464 58.8886L45.2034 46.0239C45.3709 45.6868 45.4267 45.2936 45.4267 45.0127V23.5528C45.4267 22.991 45.036 22.7663 44.6454 23.2157Z" />
    </svg>
  );
}
const LOGOS: Record<Chain, ({ size }: { size?: number }) => React.ReactNode> = {
  ethereum: EthLogo,
  base: BaseLogo,
  robinhood: HoodLogo,
};

export function ChainPills({
  selected,
  onChange,
  className = "",
}: {
  selected: Chain[];
  onChange: (next: Chain[]) => void;
  className?: string;
}) {
  const toggle = (c: Chain) => {
    const next = selected.includes(c) ? selected.filter((x) => x !== c) : [...selected, c];
    onChange(next.length ? next : [...ALL_CHAINS]); // never zero chains
  };
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      {ALL_CHAINS.map((c) => {
        const m = META[c];
        const Logo = LOGOS[c];
        const on = selected.includes(c);
        return (
          <button
            key={c}
            onClick={() => toggle(c)}
            aria-pressed={on}
            title={on ? `Hide ${m.label} baskets` : `Show ${m.label} baskets`}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-all border"
            style={
              on
                ? { color: m.color, borderColor: `${m.color}55`, background: `${m.color}16`, boxShadow: `0 0 14px ${m.color}33, inset 0 1px 0 rgba(255,255,255,0.08)` }
                : { color: "rgba(148,163,184,0.5)", borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }
            }
          >
            <Logo />
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
