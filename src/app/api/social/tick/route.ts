import { NextRequest, NextResponse } from "next/server";
import { getBaseProvider, getProvider } from "@/lib/chain/live";
import { broadcast, dailyDigestText } from "@/lib/social/broadcast";
import { postTelegram } from "@/lib/social/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Runs one auto-share pass. Called by the scheduled function (netlify/functions/
// social-post.mts) with the shared secret, so randoms can't trigger posts.
// GET with the secret + ?dry=1 previews what WOULD post without posting.
export async function GET(req: NextRequest) {
  const secret = process.env.SOCIAL_TICK_SECRET;
  const auth = req.headers.get("authorization");
  const q = req.nextUrl.searchParams.get("key");
  if (!secret || (auth !== `Bearer ${secret}` && q !== secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const dryRun = req.nextUrl.searchParams.get("dry") === "1";
  try {
    // alerts=1 → the per-member portfolio sweep (material moves only)
    if (req.nextUrl.searchParams.get("alerts") === "1") {
      const { sweepAlerts } = await import("@/lib/social/alerts");
      const armed = process.env.SOCIAL_ENABLED === "1" || process.env.SOCIAL_ENABLED === "true";
      const res = await sweepAlerts(dryRun || !armed);
      return NextResponse.json({ alerts: true, dryRun: dryRun || !armed, ...res });
    }

    // weekly=1 → the Monday recap: every registered group gets its watchlist
    // scoreboard + league card. Per-chat sends (not the broadcast channels).
    if (req.nextUrl.searchParams.get("weekly") === "1") {
      const { registeredChats, getRegistry } = await import("@/lib/social/group-registry");
      const { sendTelegramMessage } = await import("@/lib/social/telegram");
      const site = (process.env.URL || "").replace(/\/$/, "");
      const armed = process.env.SOCIAL_ENABLED === "1" || process.env.SOCIAL_ENABLED === "true";
      const sent: (number | string)[] = [];
      for (const chatId of (await registeredChats()).slice(0, 100)) {
        const reg = await getRegistry(chatId);
        if (!reg.basket && !reg.watchlist.length) continue;
        const text = [
          "📅 <b>The week on your radar</b>",
          "",
          reg.watchlist.length ? "How the group's watchlist is doing → /watchlist" : "",
          reg.basket ? `Your basket $${reg.basket.symbol} vs the league → /league` : "",
          "",
          "A watchlist that keeps winning is a basket waiting to exist: /createbasket 👀",
        ].filter(Boolean).join("\n");
        const photo = site ? `${site}/api/card?kind=${reg.watchlist.length ? `watchlist&chat=${encodeURIComponent(String(chatId))}` : "league"}&t=${Math.floor(Date.now() / 3_600_000)}` : undefined;
        if (!dryRun && armed) await sendTelegramMessage(chatId, text, { parseMode: "HTML", disablePreview: true, photoUrl: photo }, "spectrum");
        sent.push(chatId);
      }
      return NextResponse.json({ weekly: true, dryRun, chats: sent.length });
    }
    // digest=1 → the once-a-day summary post instead of the event pass
    if (req.nextUrl.searchParams.get("digest") === "1") {
      const text = await dailyDigestText(getProvider(), getBaseProvider());
      if (!text) return NextResponse.json({ digest: false, reason: "no data" });
      if (!dryRun && (process.env.SOCIAL_ENABLED === "1" || process.env.SOCIAL_ENABLED === "true")) await postTelegram(text, `${process.env.URL || ""}/api/card?kind=digest&t=${Math.floor(Date.now() / 3_600_000)}`);
      return NextResponse.json({ digest: true, dryRun, text });
    }
    const result = await broadcast(getProvider(), getBaseProvider(), { dryRun });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "broadcast failed" }, { status: 500 });
  }
}

export const POST = GET;
