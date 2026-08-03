import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// /setup's prefill: the PUBLIC half of the config only (site.config.json).
// Never returns env values — keys don't round-trip through HTTP.

export const dynamic = "force-dynamic";

export async function GET() {
  const p = resolve(process.cwd(), "site.config.json");
  if (!existsSync(p)) return NextResponse.json({});
  try {
    const cfg = JSON.parse(readFileSync(p, "utf8")) as { siteUrl?: string; platform?: string };
    return NextResponse.json({ siteUrl: cfg.siteUrl ?? "", platform: cfg.platform ?? "" });
  } catch {
    return NextResponse.json({});
  }
}
