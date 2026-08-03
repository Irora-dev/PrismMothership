import { redirect } from "next/navigation";

// Telemetry merged into the command deck (the designer, 2026-08-03) — the chart
// series live at the bottom of /command now. Old links follow along.
export default function ChartsPage() {
  redirect("/command");
}
