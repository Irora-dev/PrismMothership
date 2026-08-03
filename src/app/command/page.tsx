import type { Metadata } from "next";
import { MothershipShell } from "@/components/mothership/shell";
import { MothershipDeck } from "@/components/mothership/deck";
import { TelemetryPanel } from "@/components/mothership/telemetry";

// The command deck — the Mothership's main DATA page. Split out of the
// homepage on the designer's direction (2026-08-02): "/" markets the ecosystem,
// this page shows it, every figure live chain data.

export const metadata: Metadata = {
  title: "Command deck — The Prism Mothership",
  description:
    "The Prism ecosystem's live command deck: revenue to holders, PRISM burns, basket activity and every on-chain event as it lands.",
};

export default function CommandPage() {
  return (
    <MothershipShell>
      <MothershipDeck />
      {/* telemetry merged in below the deck (the designer 2026-08-03) — the chart
          series that are NOT already on the deck */}
      <TelemetryPanel />
    </MothershipShell>
  );
}
