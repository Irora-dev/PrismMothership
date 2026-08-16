"use client";

import { useEffect } from "react";

// The last resort. `error.tsx` sits INSIDE the root layout, so it cannot catch a
// fault in the layout itself — that case bypasses it entirely and lands on
// Next's own white screen. This one replaces the whole document, which is why it
// renders its own <html> and <body> and why it uses no shared components: the
// thing that just broke may be exactly what those import.
//
// Deliberately plain and self-contained. Styling is inline for the same reason:
// if the stylesheet is what failed, a class name here buys nothing.

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[mothership] fatal:", error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#030409", color: "#e2e8f0", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ maxWidth: 520 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#FF003C" }}>
              Total system fault
            </div>
            <h1 style={{ margin: "16px 0 0", fontSize: 32, lineHeight: 1.15, fontWeight: 800, color: "#fff" }}>
              The Mothership could not start.
            </h1>
            <p style={{ marginTop: 12, fontSize: 14, lineHeight: 1.6, color: "#94a3b8" }}>
              This one is on us, not on you, and nothing you were doing was written anywhere. Reloading usually clears
              it.
            </p>
            <pre
              style={{
                marginTop: 24,
                padding: 16,
                borderRadius: 12,
                background: "rgba(0,0,0,0.45)",
                border: "1px solid rgba(255,255,255,0.06)",
                color: "#94a3b8",
                fontSize: 11,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {error.message || "unknown error"}
              {error.digest ? `\ndigest: ${error.digest}` : ""}
            </pre>
            <button
              onClick={reset}
              style={{
                marginTop: 24,
                padding: "10px 18px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 700,
                color: "#fff",
                background: "linear-gradient(90deg, #00F0FF, #9D00FF)",
              }}
            >
              Reload
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
