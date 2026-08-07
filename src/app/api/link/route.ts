import { NextRequest, NextResponse } from "next/server";
import { claimLinkCode } from "@/lib/social/dm-portfolio";

// Claim a bot link code with a connected wallet address. The /link page calls
// this AFTER the visitor's wallet is connected, so the address is one they
// control rather than one they typed. Read-only linking: it grants the bot
// nothing but the ability to show that address's public positions back to the
// Telegram account that started the flow.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CORS: the bot's link page lives here, but the SPECTRUM operator site
// (a different origin) should be able to offer "link Telegram" too — the user
// already has a wallet connected there. Allowing the claim cross-origin means
// that integration needs nothing from us later. Claims are single-use, expire
// in 20 minutes, and grant read-only visibility of public data, so the blast
// radius of an allowed origin is: someone must already hold a fresh code.
const ALLOWED = (process.env.LINK_ALLOWED_ORIGINS || "https://spectrumindexes.xyz")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const corsHeaders = (origin: string | null): Record<string, string> =>
  origin && ALLOWED.includes(origin)
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" }
    : {};

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function POST(req: NextRequest) {
  let body: { code?: string; address?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400, headers: corsHeaders(req.headers.get("origin")) });
  }
  const code = (body.code || "").trim().toUpperCase();
  const address = (body.address || "").trim();
  if (!/^[A-Z0-9]{4,10}$/.test(code) || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ ok: false, error: "invalid code or address" }, { status: 400, headers: corsHeaders(req.headers.get("origin")) });
  }
  const userId = await claimLinkCode(code, address);
  const cors = corsHeaders(req.headers.get("origin"));
  if (!userId) return NextResponse.json({ ok: false, error: "that code has expired or was already used" }, { status: 410, headers: cors });
  return NextResponse.json({ ok: true }, { headers: cors });
}
