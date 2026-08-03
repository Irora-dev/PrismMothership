"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  value: number;
  format?: (n: number) => string;
  durationMs?: number;
  className?: string;
}

// Eases the displayed number toward `value` whenever it changes, so live stat
// updates roll up rather than snapping.
export function CountUp({ value, format, durationMs = 900, className }: Props) {
  const [display, setDisplay] = useState(value);
  const rafRef = useRef(0);
  const displayRef = useRef(value);
  displayRef.current = display;

  useEffect(() => {
    const from = displayRef.current;
    const to = value;
    if (from === to) return;
    const start = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (to - from) * eased);
      if (p < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs]);

  return (
    <span className={className}>
      {format ? format(display) : Math.round(display).toLocaleString()}
    </span>
  );
}
