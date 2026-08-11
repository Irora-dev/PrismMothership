import { LinkClient } from "./link-client";

// /link?code=ABC123 — the site half of the bot's wallet link. Connect the
// wallet you already use here, and the Telegram account that started the flow
// can read its positions. Nothing is signed and nothing is granted: the link is
// a read-only convenience.
export const metadata = { title: "Link your wallet · The Prism Mothership" };

export default async function LinkPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  return <LinkClient code={(code || "").toUpperCase()} />;
}
