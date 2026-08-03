import { createHmac, randomBytes } from "node:crypto";

// X (Twitter) poster — text + link only. Posting a URL lets X auto-render the
// Open Graph card from the shared link (Prismbeat emits one per ?tx= link), so
// we need NO media upload and this works on the free API tier.
//
// Auth is OAuth 1.0a user-context (the simplest path for one fixed account):
// four static credentials from the @prism_lp developer app — no token refresh,
// nothing expires. Dormant unless all four are set.

export function xEnabled(): boolean {
  return !!(process.env.X_API_KEY && process.env.X_API_SECRET && process.env.X_ACCESS_TOKEN && process.env.X_ACCESS_SECRET);
}

// RFC-3986 percent-encoding (stricter than encodeURIComponent — OAuth requires it).
const enc = (s: string) => encodeURIComponent(s).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

function authHeader(method: string, url: string): string {
  const consumerKey = process.env.X_API_KEY!;
  const consumerSecret = process.env.X_API_SECRET!;
  const token = process.env.X_ACCESS_TOKEN!;
  const tokenSecret = process.env.X_ACCESS_SECRET!;
  const oauth: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: token,
    oauth_version: "1.0",
  };
  // POST /2/tweets sends a JSON body, which (unlike form-encoded bodies) is NOT
  // part of the OAuth signature base string — only the oauth_* params are.
  const paramString = Object.keys(oauth)
    .sort()
    .map((k) => `${enc(k)}=${enc(oauth[k])}`)
    .join("&");
  const base = `${method.toUpperCase()}&${enc(url)}&${enc(paramString)}`;
  const signingKey = `${enc(consumerSecret)}&${enc(tokenSecret)}`;
  oauth.oauth_signature = createHmac("sha1", signingKey).update(base).digest("base64");
  return (
    "OAuth " +
    Object.keys(oauth)
      .sort()
      .map((k) => `${enc(k)}="${enc(oauth[k])}"`)
      .join(", ")
  );
}

export async function postX(text: string): Promise<{ ok: boolean; detail?: string }> {
  if (!xEnabled()) return { ok: false, detail: "not configured" };
  const url = "https://api.twitter.com/2/tweets";
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: authHeader("POST", url), "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (r.ok) return { ok: true };
    const body = await r.text().catch(() => "");
    return { ok: false, detail: `HTTP ${r.status} ${body.slice(0, 140)}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "fetch failed" };
  }
}
