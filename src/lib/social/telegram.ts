// Telegram poster. Free, no OAuth: a @BotFather token + one or more chats the
// bot is admin of. TELEGRAM_CHAT_ID may be a COMMA-SEPARATED list (e.g. the
// burns channel + the main Prism group) — it posts to each. Tries sendPhoto with
// the live OG card (so the post carries an image), falls back to a plain message
// with a link preview. Dormant unless both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
// are set.

function chatIds(): string[] {
  return (process.env.TELEGRAM_CHAT_ID || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function telegramEnabled(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN && chatIds().length > 0;
}

async function sendOne(token: string, chatId: string, text: string, photoUrl?: string): Promise<boolean> {
  const api = `https://api.telegram.org/bot${token}`;
  try {
    if (photoUrl) {
      const r = await fetch(`${api}/sendPhoto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption: text }),
      });
      if (r.ok) return true;
      // photo fetch can fail (URL not reachable yet) → fall through to text
    }
    const r = await fetch(`${api}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: false }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// Reply to a single chat (the one that messaged the bot) — used by the incoming
// command webhook. Separate from postTelegram, which fans a broadcast out to the
// configured channel list.
/** one row per inner array — Telegram inline keyboard, callback_data ≤64 bytes */
export type TgButtons = { text: string; data: string }[][];
const keyboard = (b?: TgButtons) => (b?.length ? { inline_keyboard: b.map((row) => row.map((x) => ({ text: x.text, callback_data: x.data.slice(0, 64) }))) } : undefined);

export interface SendResult {
  ok: boolean;
  messageId?: number; // for editing the message later (the living draft card)
}

export async function sendTelegramMessage(
  chatId: string | number,
  text: string,
  opts: { parseMode?: "HTML" | "Markdown"; disablePreview?: boolean; replyTo?: number; photoUrl?: string; buttons?: TgButtons } = {},
): Promise<SendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false };
  // With a photo, the text rides as the caption (Telegram caps captions at 1024
  // chars — command replies are well under). Telegram fetches the URL itself.
  const asPhoto = Boolean(opts.photoUrl) && text.length <= 1000;
  const body: Record<string, unknown> = asPhoto
    ? { chat_id: chatId, photo: opts.photoUrl, caption: text }
    : { chat_id: chatId, text, disable_web_page_preview: opts.disablePreview ?? true };
  if (opts.parseMode) body.parse_mode = opts.parseMode;
  const kb = keyboard(opts.buttons);
  if (kb) body.reply_markup = kb;
  if (opts.replyTo) {
    body.reply_to_message_id = opts.replyTo;
    body.allow_sending_without_reply = true; // still post if the target message is gone
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${asPhoto ? "sendPhoto" : "sendMessage"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) return { ok: false };
    const d = (await r.json().catch(() => null)) as { result?: { message_id?: number } } | null;
    return { ok: true, messageId: d?.result?.message_id };
  } catch {
    return { ok: false };
  }
}

/** edit a previously sent message in place — the living draft card's heartbeat */
export async function editTelegramMessage(
  chatId: string | number,
  messageId: number,
  text: string,
  opts: { parseMode?: "HTML"; buttons?: TgButtons } = {},
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  const body: Record<string, unknown> = { chat_id: chatId, message_id: messageId, text, disable_web_page_preview: true };
  if (opts.parseMode) body.parse_mode = opts.parseMode;
  const kb = keyboard(opts.buttons);
  if (kb) body.reply_markup = kb;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** ack a button tap (stops the spinner; optional toast) */
export async function answerCallback(callbackQueryId: string, text?: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, ...(text ? { text: text.slice(0, 190) } : {}) }),
    });
  } catch {
    /* cosmetic */
  }
}

/** edit a PHOTO message in place — new image + caption + buttons (the living
 * draft card is a photo, and editMessageText can't touch those) */
export async function editTelegramPhoto(
  chatId: string | number,
  messageId: number,
  photoUrl: string,
  caption: string,
  opts: { parseMode?: "HTML"; buttons?: TgButtons } = {},
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    media: { type: "photo", media: photoUrl, caption: caption.slice(0, 1000), parse_mode: opts.parseMode },
  };
  const kb = keyboard(opts.buttons);
  if (kb) body.reply_markup = kb;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/editMessageMedia`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** best-effort delete (repost-at-bottom flow); needs delete rights, fails quietly */
export async function deleteTelegramMessage(chatId: string | number, messageId: number): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    });
  } catch {
    /* fine */
  }
}

export async function postTelegram(text: string, photoUrl?: string): Promise<{ ok: boolean; detail?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const ids = chatIds();
  if (!token || !ids.length) return { ok: false, detail: "not configured" };
  const results = await Promise.all(ids.map((id) => sendOne(token, id, text, photoUrl)));
  const okCount = results.filter(Boolean).length;
  // ok if delivered to at least one chat (a transient failure on one destination
  // shouldn't block the others or trigger a repost of the ones that landed).
  return okCount > 0 ? { ok: true, detail: `${okCount}/${ids.length} chats` } : { ok: false, detail: "all chats failed" };
}
