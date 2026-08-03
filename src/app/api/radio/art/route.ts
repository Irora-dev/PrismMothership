import { basename, join } from "path";
import { NextRequest, NextResponse } from "next/server";
import { readId3 } from "@/lib/radio/id3";

export const dynamic = "force-dynamic";

const AUDIO = /\.(mp3|m4a|ogg|oga|wav|aac|flac|webm)$/i;

// Serves the cover art embedded in a /public/radio track (?file=<name>).
// 404s when there's no embedded image so the UI can fall back to procedural art.
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("file") || "";
  const name = basename(decodeURIComponent(raw)); // strip any path — no traversal
  const folderRaw = (req.nextUrl.searchParams.get("folder") || "").trim();
  const folder = /^[^/\\]+$/.test(folderRaw) && folderRaw !== ".." ? folderRaw : "";
  if (!name || name.startsWith(".") || !AUDIO.test(name)) {
    return new NextResponse("bad request", { status: 400 });
  }
  const path = join(process.cwd(), "public", "radio", folder, name);
  const tags = await readId3(path);
  if (!tags.picture || tags.picture.data.length === 0) {
    return new NextResponse("no art", { status: 404 });
  }
  return new NextResponse(Uint8Array.from(tags.picture.data), {
    status: 200,
    headers: {
      "Content-Type": tags.picture.mime || "image/jpeg",
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
