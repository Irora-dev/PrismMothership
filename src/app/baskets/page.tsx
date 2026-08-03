import { redirect } from "next/navigation";

// The basket explorer lives on /spectrum (its #baskets section) — one hub for
// everything Spectrum. Detail pages live at /baskets/[address].
export default function BasketListPage() {
  redirect("/spectrum#baskets");
}
