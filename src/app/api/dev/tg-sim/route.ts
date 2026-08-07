import { NextRequest, NextResponse } from "next/server";
import { buildReply, handleGroupMessage, handleMembership, handleCallback, draftCardView, type TgCallback } from "@/lib/social/commands";
import { getDraft } from "@/lib/social/group-draft";
import { listIndexes } from "@/lib/spectrum/index-data";

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
    user: { id: number; first_name: string };
    text?: string;
    data?: string; // callback_data
    cardMsgId?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const chat = { id: body.chatId, type: "supergroup", title: body.chatTitle || "Degen Lounge" };

  try {
    if (body.kind === "callback") {
      const cb: TgCallback = {
        id: `sim-${Date.now()}`,
        from: body.user,
        message: { message_id: body.cardMsgId ?? 1, chat },
        data: body.data,
      };
      const action = await handleCallback(cb);
      // mirror the webhook: refreshCard → re-render the living card view
      const card = action.refreshCard ? draftCardView(chat.id, await getDraft(chat.id)) : null;
      return NextResponse.json({ action, card });
    }
    if (body.kind === "join") {
      const greeting = handleMembership({
        my_chat_member: { chat, new_chat_member: { status: "member" }, old_chat_member: { status: "left" } },
      } as never);
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
        "The draft this group built just launched on-chain. Every trade now feeds the PRISM burn — and it's auto-registered as this group's basket:",
        "",
        "· /ourbasket — its live numbers, any time",
        "· /league — see how it ranks against every other group",
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
      },
    };
    const [reply, suggestion] = await Promise.all([buildReply(update as never), handleGroupMessage(update as never)]);
    return NextResponse.json({ reply, suggestion });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "sim failed" }, { status: 500 });
  }
}
