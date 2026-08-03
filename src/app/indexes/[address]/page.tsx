import { redirect } from "next/navigation";

// Legacy route — the detail pages moved to /baskets/[address] (baskets, not
// indexes — the site language rule). Old shared links keep resolving.
export default async function LegacyIndexDetail({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  redirect(`/baskets/${address}`);
}
