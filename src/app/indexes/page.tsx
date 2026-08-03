import { redirect } from "next/navigation";

// The basket explorer now lives on /spectrum (its #baskets section) — one hub
// for everything Spectrum. Detail pages (/indexes/[address]) are unchanged.
export default function IndexListPage() {
  redirect("/spectrum#baskets");
}
