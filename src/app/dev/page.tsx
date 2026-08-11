import type { Metadata } from "next";
import { MothershipShell } from "@/components/mothership/shell";
import { DevPortal } from "@/components/mothership/dev-portal";

// TERM://PRISM.DEV — the builder's on-ramp (the designer's 0841 pass, 2026-08-03).

export const metadata: Metadata = {
  title: "Developer portal · The Prism Mothership",
  description:
    "Build on PRISM: verified ownerless contracts, an on-chain fee split that pays interfaces, public JSON endpoints, and an open slot on the app-store wall.",
};

export default function DevPage() {
  return (
    <MothershipShell>
      <DevPortal />
    </MothershipShell>
  );
}
