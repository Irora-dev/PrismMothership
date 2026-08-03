import { redirect } from "next/navigation";

// The Portfolio berth lives on the Spectrum Ecosystem page now (merged
// 2026-08-03, the two-merges round) — one page for the whole Spectrum system.
export default function PortfolioPage() {
  redirect("/spectrum#portfolio");
}
