import { NextRequest, NextResponse } from "next/server";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// /setup's Apply — DEV ONLY. Writes the integrator's hosting identity into the
// project: site.config.json (committed) and .env.local (gitignored). In
// production this route refuses outright: a deployed site must never accept
// config writes over HTTP (the host's env-var UI is the production path).

export const dynamic = "force-dynamic";

const PLATFORMS = new Set(["netlify", "vercel", "cloudflare", "other"]);

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "setup apply is dev-only. Set env vars in your host's dashboard" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as {
    siteUrl?: string;
    platform?: string;
    tradingMode?: string;
    rpc?: string;
    etherscan?: string;
  } | null;
  if (!body) return NextResponse.json({ error: "bad json" }, { status: 400 });

  try {
    const url = new URL(body.siteUrl ?? "");
    if (!/^https?:$/.test(url.protocol)) throw new Error();
  } catch {
    return NextResponse.json({ error: "siteUrl must be a valid http(s) URL" }, { status: 400 });
  }
  if (!PLATFORMS.has(body.platform ?? "")) {
    return NextResponse.json({ error: "platform must be netlify | vercel | cloudflare | other" }, { status: 400 });
  }

  const root = process.cwd();
  writeFileSync(
    resolve(root, "site.config.json"),
    JSON.stringify({ siteUrl: body.siteUrl, platform: body.platform, tradingMode: body.tradingMode === "native" ? "native" : "matcha", kit: "prism-mothership" }, null, 2) + "\n",
  );

  // merge keys into .env.local without clobbering unrelated lines
  const envPath = resolve(root, ".env.local");
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const setLine = (src: string, key: string, val: string | undefined) => {
    if (val === undefined || val === "") return src; // blank = leave as-is
    const line = `${key}=${val}`;
    return new RegExp(`^${key}=.*$`, "m").test(src) ? src.replace(new RegExp(`^${key}=.*$`, "m"), line) : src + (src.endsWith("\n") || src === "" ? "" : "\n") + line + "\n";
  };
  let env = existing;
  env = setLine(env, "ALCHEMY_API_KEY", body.rpc);
  env = setLine(env, "ETHERSCAN_API_KEY", body.etherscan);
  env = setLine(env, "URL", body.siteUrl);
  writeFileSync(envPath, env);

  return NextResponse.json({ ok: true, wrote: ["site.config.json", ".env.local"] });
}
