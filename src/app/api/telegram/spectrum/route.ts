import { NextRequest } from "next/server";
import { handleTelegramUpdate, telegramHealth } from "@/lib/social/webhook-handler";

// ── The SPECTRUM suite's bot webhook ─────────────────────────────────────────
// Baskets, group drafting and launching, watchlists, the league, and the private
// portfolio surface. A different bot identity from the Prism community helper
// (its own BotFather token, username, menu and webhook secret), sharing every
// handler underneath. See src/lib/social/bots.ts for the partition.
//
// Arm it with setWebhook against this path using SPECTRUM_WEBHOOK_SECRET; until
// SPECTRUM_BOT_TOKEN is set the bot cannot send anything, so it stays dark.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = (req: NextRequest) => handleTelegramUpdate(req, "spectrum");
export const GET = () => telegramHealth("spectrum");
