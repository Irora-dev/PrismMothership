import type { Metadata } from "next";
import { MothershipShell } from "@/components/mothership/shell";
import { AmbientBlooms } from "@/components/mothership/blooms";
import { MoneyMap } from "@/components/mothership/money-map";

// The money map — every fee the ecosystem earns, split live to where it
// actually goes (the designer, 2026-08-15: the burn is only part of the story; show
// every destination). The burn pipeline stays the burn lane's deep view; this
// is the whole river system.

export const metadata: Metadata = {
  title: "The money map · The Prism Mothership",
  description:
    "Every fee the Prism ecosystem earns, split live to where it actually goes: holders, creators, interfaces, the creator league, and the PRISM burn. Measured on-chain amounts, never projections.",
};

export default function FlowPage() {
  return (
    <MothershipShell>
      <AmbientBlooms />
      <MoneyMap />
    </MothershipShell>
  );
}
