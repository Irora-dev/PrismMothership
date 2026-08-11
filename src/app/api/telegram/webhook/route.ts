import { NextRequest } from "next/server";
import { handleTelegramUpdate, telegramHealth } from "@/lib/social/webhook-handler";

// ── The PRISM community bot's webhook ────────────────────────────────────────
// The ecosystem helper: price, supply, burn, revenue, links. The live webhook
// has always pointed at this path, so it stays exactly here; moving it would
// take the community bot down for as long as the change went unnoticed.
// The Spectrum suite's bot answers at /api/telegram/spectrum.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = (req: NextRequest) => handleTelegramUpdate(req, "prism");
export const GET = () => telegramHealth("prism");
