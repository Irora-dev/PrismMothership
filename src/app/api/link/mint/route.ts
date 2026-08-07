import { NextRequest, NextResponse } from "next/server";
import { mintSiteLink } from "@/lib/social/dm-portfolio";

// Mint a deep link for a visitor whose wallet is already connected here (or on
// the Spectrum operator site). They tap it, Telegram opens, their book is on
// the first screen. Read-only and single-use; see docs/SPECTRUM-INTEGRATION.md.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = (process.env.LINK_ALLOWED_ORIGINS || "https://spectrumindexes.xyz").split(",").map((s) => s.trim()).filter(Boolean);
const cors = (origin: string | null): Record<string, string> =>
  origin && ALLOWED.includes(origin)
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" }
    : {};

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(req.headers.get("origin")) });
}

export async function POST(req: NextRequest) {
  const headers = cors(req.headers.get("origin"));
  let body: { address?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400, headers });
  }
  const address = (body.address || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return NextResponse.json({ ok: false, error: "invalid address" }, { status: 400, headers });
  const code = await mintSiteLink(address);
  const bot = process.env.TELEGRAM_BOT_USERNAME || "SpectraPrismBot";
  return NextResponse.json({ ok: true, code, url: `https://t.me/${bot}?start=w_${code}` }, { headers });
}
