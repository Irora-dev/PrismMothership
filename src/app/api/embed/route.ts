import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fetches a public X (Twitter) post — including X Articles — via the syndication
// CDN (no auth, no scraping). Returns normalized data for a custom embed card:
// title / excerpt / cover image / author. Plain scraping of x.com is blocked (402),
// but cdn.syndication.twimg.com serves the same data the official embed widget uses.

interface Embed {
  ok: true;
  url: string;
  kind: "article" | "tweet";
  title: string | null;
  text: string;
  image: string | null;
  author: { name: string; handle: string; avatar: string | null; verified: boolean };
  createdAt: string | null;
  likes: number;
}

function tweetId(url: string): string | null {
  const m = url.match(/(?:x|twitter)\.com\/[^/]+\/status(?:es)?\/(\d+)/i);
  return m?.[1] ?? null;
}

// The syndication token the official embed uses (derived from the tweet id).
function synToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "") || "a";
}

function hi(url?: string | null): string | null {
  return url ? url.replace("_normal.", "_400x400.") : null;
}

const cache = new Map<string, { data: Embed; at: number }>();
const TTL = 10 * 60_000; // 10 min

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") || "";
  const id = tweetId(url);
  if (!id) return NextResponse.json({ ok: false, error: "Only x.com/<user>/status/<id> URLs are supported" }, { status: 400 });

  const cached = cache.get(id);
  if (cached && Date.now() - cached.at < TTL) return NextResponse.json(cached.data);

  try {
    const synUrl = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${synToken(id)}&lang=en`;
    const r = await fetch(synUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (prismbeat-embed)", Accept: "application/json" },
      signal: AbortSignal.timeout(9000),
      cache: "no-store",
    });
    if (!r.ok) return NextResponse.json({ ok: false, error: `syndication ${r.status}` }, { status: 502 });
    const j = (await r.json()) as Record<string, unknown>;

    const article = j.article as { title?: string; preview_text?: string; cover_media?: { media_info?: { original_img_url?: string } } } | undefined;
    const user = (j.user ?? {}) as { name?: string; screen_name?: string; profile_image_url_https?: string; verified?: boolean; is_blue_verified?: boolean };
    const media = (j.mediaDetails ?? []) as { media_url_https?: string }[];
    const photos = (j.photos ?? []) as { url?: string }[];

    const data: Embed = {
      ok: true,
      url: (j.url as string) || url,
      kind: article ? "article" : "tweet",
      title: article?.title ?? null,
      text: article?.preview_text ?? (j.text as string) ?? "",
      image: article?.cover_media?.media_info?.original_img_url ?? media[0]?.media_url_https ?? photos[0]?.url ?? null,
      author: {
        name: user.name ?? "",
        handle: user.screen_name ?? "",
        avatar: hi(user.profile_image_url_https),
        verified: Boolean(user.verified || user.is_blue_verified),
      },
      createdAt: (j.created_at as string) ?? null,
      likes: Number(j.favorite_count ?? 0),
    };

    cache.set(id, { data, at: Date.now() });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "fetch failed" }, { status: 502 });
  }
}
