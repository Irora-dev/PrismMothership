import { readdir, stat } from "fs/promises";
import { join } from "path";
import { NextResponse } from "next/server";
import { readId3 } from "@/lib/radio/id3";
// Build-time manifest (scripts/build-radio-manifest.mjs). Bundled into the function
// so the playlist works on serverless, where there's no public/ filesystem.
import manifestJson from "@/lib/radio/radio-manifest.json";

export const dynamic = "force-dynamic";

const MANIFEST = manifestJson as {
  tracks: { folder: string; title: string; artist: string | null; album: string | null; src: string; art: string | null }[];
};

const AUDIO = /\.(mp3|m4a|ogg|oga|wav|aac|flac|webm)$/i;
// Per-folder lead tracks, in order: the playlist opens with these (1st, 2nd, …),
// then everything else alphabetically.
const PINNED_BY_FOLDER: Record<string, RegExp[]> = {
  "Garage Station": [/armes/i, /too[ _]many[ _]men/i], // Armes first, Too Many Men second
};
// Per-folder excludes: tracks present on disk but kept out of the playlist.
const EXCLUDE_BY_FOLDER: Record<string, RegExp> = {
  "": /dirty cash|pawsa/i, // dropped from the Prism Radio (root) mix
};
// Restrict ?folder to one safe segment under /public/radio (no path traversal).
function safeFolder(raw: string | null): string {
  const f = (raw ?? "").trim();
  return f && /^[^/\\]+$/.test(f) && f !== ".." ? f : "";
}

// Fisher–Yates in-place shuffle. Folders with no pinned lead tracks (Prism Radio,
// the root mix) get a fresh random order — and therefore a random first song —
// on every request, so each page refresh reshuffles the list.
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

interface Track {
  title: string;
  artist?: string;
  album?: string;
  src: string;
  art?: string;
}

// Cache parsed tags per file so we don't re-read ID3 on every poll.
const tagCache = new Map<string, { sig: string; track: Track }>();

// Auto-discovers audio files dropped into /public/radio. Embedded ID3 tags
// (title / artist / album / cover art) take priority; otherwise the filename
// ("Artist - Title.mp3", optional leading track number) is parsed for display.
export async function GET(req: Request) {
  const folder = safeFolder(new URL(req.url).searchParams.get("folder"));
  try {
    const baseDir = join(process.cwd(), "public", "radio");
    const dir = folder ? join(baseDir, folder) : baseDir;
    const pins = PINNED_BY_FOLDER[folder] ?? [];
    const exclude = EXCLUDE_BY_FOLDER[folder];
    // rank = position in the pin list (0,1,…), or after all pins if unpinned
    const rankOf = (f: string) => {
      const i = pins.findIndex((re) => re.test(f));
      return i < 0 ? pins.length : i;
    };
    const files = (await readdir(dir)).filter(
      (f) => AUDIO.test(f) && !f.startsWith(".") && !(exclude && exclude.test(f)),
    );
    if (pins.length) {
      files.sort((a, b) => {
        const ra = rankOf(a);
        const rb = rankOf(b);
        if (ra !== rb) return ra - rb; // pinned tracks lead, in order
        return a.localeCompare(b, undefined, { numeric: true });
      });
    } else {
      shuffle(files); // no pins → random order + random first song every fetch
    }

    const tracks = await Promise.all(
      files.map(async (f): Promise<Track> => {
        const full = join(dir, f);
        const rel = folder ? `${folder}/${f}` : f;
        const src = `/radio/${folder ? `${encodeURIComponent(folder)}/` : ""}${encodeURIComponent(f)}`;

        // filename fallback
        const base = f.replace(/\.[^.]+$/, "").replace(/^\d+[\s._)-]+/, "").trim();
        const parts = base.split(/\s+-\s+/);
        const fileArtist = parts.length > 1 ? parts[0].trim() : undefined;
        const fileTitle = (parts.length > 1 ? parts.slice(1).join(" - ") : base).trim() || f;

        // cache key on size+mtime so edits invalidate
        let sig = "";
        try {
          const s = await stat(full);
          sig = `${s.size}:${s.mtimeMs}`;
        } catch {
          /* ignore */
        }
        const cached = tagCache.get(rel);
        if (cached && cached.sig === sig) return cached.track;

        const tags = f.toLowerCase().endsWith(".mp3") ? await readId3(full) : {};
        const track: Track = {
          title: tags.title || fileTitle,
          artist: tags.artist || fileArtist,
          album: tags.album || undefined,
          src,
          art: tags.picture
            ? `/api/radio/art?file=${encodeURIComponent(f)}${folder ? `&folder=${encodeURIComponent(folder)}` : ""}`
            : undefined,
        };
        tagCache.set(rel, { sig, track });
        return track;
      }),
    );

    return NextResponse.json({ tracks }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // No filesystem (serverless) or folder unreadable → serve the build-time manifest.
    const tracks: Track[] = MANIFEST.tracks
      .filter((t) => t.folder === folder)
      .map((t) => ({
        title: t.title,
        artist: t.artist ?? undefined,
        album: t.album ?? undefined,
        src: t.src,
        art: t.art ?? undefined,
      }));
    if (!(PINNED_BY_FOLDER[folder] ?? []).length) shuffle(tracks); // pinless (Prism Radio) → random order each fetch
    return NextResponse.json({ tracks }, { headers: { "Cache-Control": "no-store" } });
  }
}
