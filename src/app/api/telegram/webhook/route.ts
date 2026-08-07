import { NextRequest, NextResponse } from "next/server";
import { buildReply, handleGroupMessage, handleMembership } from "@/lib/social/commands";
import { sendTelegramMessage } from "@/lib/social/telegram";

// Telegram command webhook. Telegram POSTs every update here; we reply to
// commands (/basket, /burn, …) and @-mentions, ignore the rest. Read-only — it
// only reads on-chain data and sends text back, never touches funds.
//
// Arm it after deploy (push-gated) with:
//   setWebhook url=https://<site>/api/telegram/webhook secret_token=<TELEGRAM_WEBHOOK_SECRET>
// Local testing: POST a mock update to /api/telegram/webhook?dry=1 to get the
// computed reply back without sending anything.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // If a secret is configured, require Telegram's matching header (setWebhook secret_token).
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: unknown;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: true }); // ack malformed so Telegram won't retry
  }

  try {
    const dry = req.nextUrl.searchParams.get("dry") === "1" && process.env.NODE_ENV !== "production";
    // command/mention reply, and (group features on) the chatter listener → maybe a suggestion
    const [reply, suggestion] = await Promise.all([
      buildReply(update as never),
      handleGroupMessage(update as never),
    ]);
    const greeting = handleMembership(update as never); // on-join welcome
    if (dry) return NextResponse.json({ ok: true, dryRun: true, reply, suggestion, greeting });
    for (const r of [reply, suggestion, greeting]) {
      if (r) await sendTelegramMessage(r.chatId, r.text, { parseMode: r.parseMode, disablePreview: r.disablePreview, replyTo: r.replyTo, photoUrl: r.photoUrl });
    }
  } catch (e) {
    console.error("[telegram webhook]", e);
  }

  // Always 200 fast so Telegram doesn't retry the update.
  return NextResponse.json({ ok: true });
}

// Lightweight health check (browser GET) — never leaks whether a secret is set.
export function GET() {
  return NextResponse.json({ ok: true, service: "telegram-webhook" });
}
