import { NextRequest, NextResponse } from "next/server";
import { buildReply, handleGroupMessage, handleMembership, handleCallback, draftCardView, type TgReply } from "@/lib/social/commands";
import { answerCallback, editTelegramPhoto, sendTelegramMessage } from "@/lib/social/telegram";
import { getDraft, setDraftCardMsg } from "@/lib/social/group-draft";

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
    // Dry-run computes the reply and returns it WITHOUT sending to Telegram.
    // Allowed in production only when a webhook secret is configured (and thus
    // was matched above) — otherwise a stranger could make the bot do work. The
    // surface gate depends on this: without it, a gate run against a real build
    // can't see replies at all, which is precisely where it matters most.
    const dry =
      req.nextUrl.searchParams.get("dry") === "1" &&
      (process.env.NODE_ENV !== "production" || Boolean(process.env.TELEGRAM_WEBHOOK_SECRET));

    // ── button taps: answer fast, refresh the living card in place ──────────
    const cb = (update as { callback_query?: Parameters<typeof handleCallback>[0] }).callback_query;
    if (cb) {
      const action = await handleCallback(cb);
      if (dry) return NextResponse.json({ ok: true, dryRun: true, action });
      await answerCallback(cb.id, action.toast);
      if (action.refreshCard && cb.message?.chat) {
        const chatId = cb.message.chat.id;
        const d = await getDraft(chatId);
        const view = draftCardView(chatId, d);
        // edit the stored card if we know it; else the tapped message IS the card
        const target = d.cardMsgId || cb.message.message_id;
        const edited = await editTelegramPhoto(chatId, target, view.photoUrl, view.caption, { parseMode: "HTML", buttons: view.buttons });
        if (!edited) {
          const sent = await sendTelegramMessage(chatId, view.caption, { parseMode: "HTML", photoUrl: view.photoUrl, buttons: view.buttons });
          if (sent.messageId) await setDraftCardMsg(chatId, sent.messageId);
        }
      }
      if (action.reply) await deliver(action.reply);
      return NextResponse.json({ ok: true });
    }

    // command/mention reply, and (group features on) the chatter listener → maybe a suggestion
    const [reply, suggestion] = await Promise.all([
      buildReply(update as never),
      handleGroupMessage(update as never),
    ]);
    const greeting = handleMembership(update as never); // on-join welcome
    if (dry) return NextResponse.json({ ok: true, dryRun: true, reply, suggestion, greeting });
    for (const r of [reply, suggestion, greeting]) {
      if (r) await deliver(r);
    }
  } catch (e) {
    console.error("[telegram webhook]", e);
  }

  // Always 200 fast so Telegram doesn't retry the update.
  return NextResponse.json({ ok: true });
}

// send a reply; when it is the living draft card, remember its message id so
// button taps can edit it in place
async function deliver(r: TgReply): Promise<void> {
  const sent = await sendTelegramMessage(r.chatId, r.text, {
    parseMode: r.parseMode,
    disablePreview: r.disablePreview,
    replyTo: r.replyTo,
    photoUrl: r.photoUrl,
    buttons: r.buttons,
    forceReplyPlaceholder: r.forceReplyPlaceholder,
  });
  if (r.isDraftCard && sent.messageId) await setDraftCardMsg(r.chatId, sent.messageId);
}

// Lightweight health check (browser GET) — never leaks whether a secret is set.
export function GET() {
  return NextResponse.json({ ok: true, service: "telegram-webhook" });
}
