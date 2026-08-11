import { NextRequest, NextResponse } from "next/server";
import { buildReply, handleGroupMessage, handleMembership, handleCallback, draftCardView, type TgCallback } from "@/lib/social/commands";
import { getDraft } from "@/lib/social/group-draft";
import { listIndexes } from "@/lib/spectrum/index-data";
import { DEFAULT_BOT, type BotId } from "@/lib/social/bots";

// ── Telegram-flow simulator backend (DEV ONLY — 404 in production) ───────────
// The /dev/telegram playground drives the REAL command/callback handlers
// directly (no HTTP hop to the webhook, no secret needed), with all their real
// state mutations — drafts, votes, watchlists live in the in-memory dev stores,
// keyed by the playground's session chat id. Nothing here talks to Telegram.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dev = () => process.env.NODE_ENV !== "production";

export async function POST(req: NextRequest) {
  if (!dev()) return NextResponse.json({ error: "not found" }, { status: 404 });
  let body: {
    kind: "message" | "callback" | "join" | "launch-preview";
    chatId: number;
    chatTitle?: string;
    chatType?: "supergroup" | "private";
    /** which of the two bots this chat is with */
    bot?: BotId;
    user: { id: number; first_name: string };
    text?: string;
    data?: string; // callback_data
    cardMsgId?: number;
    /** the bot prompt this message answers, tags stripped as Telegram delivers it */
    replyToText?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  // A private chat is not a group with one member: its id is positive, it has no
  // title, and it is what flips every DM-gated command from a refusal to a real
  // answer. Handlers read chat.type, so the playground must send the real one.
  const chat =
    body.chatType === "private"
      ? { id: Math.abs(body.chatId), type: "private", first_name: body.user.first_name }
      : { id: body.chatId, type: "supergroup", title: body.chatTitle || "Degen Lounge" };

  const bot: BotId = body.bot === "spectrum" || body.bot === "prism" ? body.bot : DEFAULT_BOT;

  try {
    if (body.kind === "callback") {
      const cb: TgCallback = {
        id: `sim-${Date.now()}`,
        from: body.user,
        message: { message_id: body.cardMsgId ?? 1, chat },
        data: body.data,
      };
      const action = await handleCallback(cb, bot);
      // mirror the webhook: refreshCard → re-render the living card view
      const card = action.refreshCard ? draftCardView(chat.id, await getDraft(chat.id)) : null;
      return NextResponse.json({ action, card });
    }
    if (body.kind === "join") {
      const greeting = handleMembership({
        my_chat_member: { chat, new_chat_member: { status: "member" }, old_chat_member: { status: "left" } },
      } as never, bot);
      return NextResponse.json({ greeting });
    }
    if (body.kind === "launch-preview") {
      // celebration PREVIEW: dress a live basket as "the draft came true" so the
      // playground can show the closing act without a real on-chain launch
      const d = await getDraft(chat.id);
      const all = await listIndexes();
      const live = all.find((b) => b.top.length >= Math.min(2, d.tokens.length || 2)) || all[0];
      if (!live) return NextResponse.json({ error: "no live baskets to preview with" }, { status: 503 });
      const text = [
        `🎉 <b>YOUR basket is live: $${live.symbol}</b>`,
        "",
        "The draft this group built just launched on-chain. Every trade now feeds the PRISM burn, and it's auto-registered as this group's basket:",
        "",
        "· /ourbasket for its live numbers, any time",
        "· /league to see how it ranks against every other group",
      ].join("\n"),
        photo = `/api/card?kind=bento&address=${live.address}&t=${Date.now()}`;
      return NextResponse.json({ celebration: { text, photo, symbol: live.symbol } });
    }
    // plain message → the same trio the webhook computes
    const update = {
      message: {
        message_id: Math.floor(Math.random() * 1e6),
        date: Math.floor(Date.now() / 1000),
        chat,
        from: body.user,
        text: body.text || "",
        // force-reply prompts (➕ add a token, ⚖️ change the shape) are answered
        // by replying, so the playground has to be able to reply
        ...(body.replyToText ? { reply_to_message: { text: body.replyToText, from: { is_bot: true } } } : {}),
      },
    };
    const [reply, suggestion] = await Promise.all([buildReply(update as never, bot), handleGroupMessage(update as never, bot)]);
    return NextResponse.json({ reply, suggestion });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "sim failed" }, { status: 500 });
  }
}
