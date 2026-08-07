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
export async function sendTelegramMessage(
  chatId: string | number,
  text: string,
  opts: { parseMode?: "HTML" | "Markdown"; disablePreview?: boolean; replyTo?: number; photoUrl?: string } = {},
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  // With a photo, the text rides as the caption (Telegram caps captions at 1024
  // chars — command replies are well under). Telegram fetches the URL itself.
  const asPhoto = Boolean(opts.photoUrl) && text.length <= 1000;
  const body: Record<string, unknown> = asPhoto
    ? { chat_id: chatId, photo: opts.photoUrl, caption: text }
    : { chat_id: chatId, text, disable_web_page_preview: opts.disablePreview ?? true };
  if (opts.parseMode) body.parse_mode = opts.parseMode;
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
    return r.ok;
  } catch {
    return false;
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
