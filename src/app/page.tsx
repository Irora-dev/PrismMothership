import { MothershipShell } from "@/components/mothership/shell";
import { MothershipHome } from "@/components/mothership/home";

// THE PRISM MOTHERSHIP — the marketing face of the ecosystem. The data lives
// on /command (the deck); this page pitches Prism and its dapps in the same
// visual language, with a few live stats woven in. Split per the designer, 2026-08-02.

export default function Home() {
  return (
    <MothershipShell>
      <MothershipHome />
    </MothershipShell>
  );
}
