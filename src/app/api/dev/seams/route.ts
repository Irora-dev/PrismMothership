import { NextResponse } from "next/server";
import { SEAMS, seamStatus } from "@/lib/social/seams";
import { siteUrl } from "@/lib/social/commands";

// ── The seam map, as the running app sees it (DEV ONLY — 404 in production) ───
// Feeds the /dev/telegram side panel. Status comes from this deployment's own
// env, so an unwired seam reports unwired instead of reading as finished.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const hostOf = (u?: string) => {
  if (!u) return undefined;
  try {
    return new URL(u).host;
  } catch {
    return undefined;
  }
};

export async function GET() {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "not found" }, { status: 404 });
  const status = seamStatus();
  return NextResponse.json({
    seams: SEAMS.map((s) => ({ ...s, status: status.find((t) => t.id === s.id) ?? null })),
    // the playground attributes each emitted URL to a side; it needs the names.
    // siteUrl() is the same call the bot uses to stamp its own links.
    hosts: {
      mothership: [hostOf(siteUrl())].filter(Boolean),
      create: hostOf(process.env.SPECTRUM_CREATE_URL),
    },
    features: {
      groupFeatures: process.env.GROUP_FEATURES_ENABLED === "1",
      social: process.env.SOCIAL_ENABLED === "1",
      batcher: Boolean(process.env.PORTFOLIO_BATCHER_ADDRESS),
    },
    doc: "docs/SPECTRUM-INTEGRATION.md",
  });
}
