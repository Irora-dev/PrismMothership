import type { Metadata } from "next";
import { MothershipShell } from "@/components/mothership/shell";
import { BurnBoard } from "@/components/mothership/burn-board";

// The burn pipeline — every pending accrual across the ecosystem, and a
// permissionless crank for each stage (the designer's ruling, 2026-08-02: nothing in
// the pipeline is automatic, so the site shows it and anyone can push it).

export const metadata: Metadata = {
  title: "Burn pipeline — The Prism Mothership",
  description:
    "Every pending PRISM-burn accrual across the ecosystem, stage by stage — and a permissionless crank for each. A flush on an L2 is a burn initiated; PRISM only dies at the L1 burner.",
};

export default function BurnPage() {
  return (
    <MothershipShell>
      <BurnBoard />
    </MothershipShell>
  );
}
