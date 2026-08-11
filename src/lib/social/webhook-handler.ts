import { NextRequest, NextResponse } from "next/server";
import { buildReply, handleGroupMessage, handleMembership, handleCallback, draftCardView, type TgReply } from "@/lib/social/commands";
import { answerCallback, editTelegramPhoto, sendTelegramMessage } from "@/lib/social/telegram";
import { getDraft, setDraftCardMsg } from "@/lib/social/group-draft";
import { BOTS, botSecret, type BotId } from "@/lib/social/bots";

// ── The shared Telegram update handler ───────────────────────────────────────
// Two bots run from this deployment (see src/lib/social/bots.ts): the Prism
// community helper and the Spectrum suite. They share every handler, store and
// card renderer; only identity differs. This function is that shared body, and
// each bot's route is a two-line wrapper naming itself, so the two can never
// drift apart.
//
// Arm one after deploy (push-gated) with:
//   setWebhook url=https://<site><bot.webhookPath> secret_token=<its secret>
// Local testing: POST a mock update to <path>?dry=1 to get the computed reply
// back without sending anything.

export async function handleTelegramUpdate(req: NextRequest, bot: BotId) {
  // If a secret is configured, require Telegram's matching header (setWebhook secret_token).
  const secret = botSecret(bot);
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
      (process.env.NODE_ENV !== "production" || Boolean(botSecret(bot)));

    // ── button taps: answer fast, refresh the living card in place ──────────
    const cb = (update as { callback_query?: Parameters<typeof handleCallback>[0] }).callback_query;
    if (cb) {
      const action = await handleCallback(cb, bot);
      if (dry) return NextResponse.json({ ok: true, dryRun: true, action });
      await answerCallback(cb.id, action.toast, bot);
      if (action.refreshCard && cb.message?.chat) {
        const chatId = cb.message.chat.id;
        const d = await getDraft(chatId);
        const view = draftCardView(chatId, d);
        // edit the stored card if we know it; else the tapped message IS the card
        const target = d.cardMsgId || cb.message.message_id;
        const edited = await editTelegramPhoto(chatId, target, view.photoUrl, view.caption, { parseMode: "HTML", buttons: view.buttons }, bot);
        if (!edited) {
          const sent = await sendTelegramMessage(chatId, view.caption, { parseMode: "HTML", photoUrl: view.photoUrl, buttons: view.buttons }, bot);
          if (sent.messageId) await setDraftCardMsg(chatId, sent.messageId);
        }
      }
      if (action.reply) await deliver(action.reply, bot);
      return NextResponse.json({ ok: true });
    }

    // command/mention reply, and (group features on) the chatter listener → maybe a suggestion
    const [reply, suggestion] = await Promise.all([
      buildReply(update as never, bot),
      handleGroupMessage(update as never, bot),
    ]);
    const greeting = handleMembership(update as never, bot); // on-join welcome
    if (dry) return NextResponse.json({ ok: true, dryRun: true, reply, suggestion, greeting });
    for (const r of [reply, suggestion, greeting]) {
      if (r) await deliver(r, bot);
    }
  } catch (e) {
    console.error(`[telegram webhook: ${bot}]`, e);
  }

  // Always 200 fast so Telegram doesn't retry the update.
  return NextResponse.json({ ok: true });
}

// send a reply; when it is the living draft card, remember its message id so
// button taps can edit it in place
async function deliver(r: TgReply, bot: BotId): Promise<void> {
  const sent = await sendTelegramMessage(
    r.chatId,
    r.text,
    {
      parseMode: r.parseMode,
      disablePreview: r.disablePreview,
      replyTo: r.replyTo,
      photoUrl: r.photoUrl,
      buttons: r.buttons,
      forceReplyPlaceholder: r.forceReplyPlaceholder,
    },
    bot,
  );
  if (r.isDraftCard && sent.messageId) await setDraftCardMsg(r.chatId, sent.messageId);
}

// Lightweight health check (browser GET). Never leaks whether a secret is set.
export function telegramHealth(bot: BotId) {
  return NextResponse.json({ ok: true, service: "telegram-webhook", bot: BOTS[bot].id });
}
