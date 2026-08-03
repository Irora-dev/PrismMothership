// Build a static manifest of the radio tracks in /public/radio so the listing
// works on serverless (where there's no filesystem). Runs on `prebuild` (and
// `radio:manifest`). Parses ID3 for title/artist/album, pre-extracts any embedded
// cover art to /public/radio/_art, and writes src/lib/radio/radio-manifest.json.
import { readdir, open, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const RADIO_DIR = join(ROOT, "public", "radio");
const ART_DIR = join(RADIO_DIR, "_art");
const OUT = join(ROOT, "src", "lib", "radio", "radio-manifest.json");
const AUDIO = /\.(mp3|m4a|ogg|oga|wav|aac|flac|webm)$/i;
// Mirror the dev API route (src/app/api/radio/tracks/route.ts) so prod == dev:
// per-folder lead tracks (in order) and per-folder excludes.
const PINNED = { "Garage Station": [/armes/i, /too[ _]many[ _]men/i] };
const EXCLUDE = { "": /dirty cash|pawsa/i };

// ── minimal ID3v2 reader (ported from src/lib/radio/id3.ts) ──────────────────
const syncsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
const uint32be = (b, o) => ((b[o] << 16) * 256 + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]) >>> 0;
const stripNul = (s) => s.replace(/ +$/g, "").trim();
function decodeUtf16(b, le) {
  if (le) return b.toString("utf16le");
  const s = Buffer.alloc(b.length - (b.length % 2));
  for (let i = 0; i + 1 < b.length; i += 2) { s[i] = b[i + 1]; s[i + 1] = b[i]; }
  return s.toString("utf16le");
}
function decodeText(buf) {
  if (!buf.length) return "";
  const enc = buf[0];
  let body = buf.subarray(1);
  try {
    if (enc === 0) return stripNul(body.toString("latin1"));
    if (enc === 3) return stripNul(body.toString("utf8"));
    if (enc === 1 || enc === 2) {
      let le = enc === 1 && body[0] === 0xff && body[1] === 0xfe;
      const beBom = enc === 1 && body[0] === 0xfe && body[1] === 0xff;
      if (le || beBom) body = body.subarray(2);
      if (enc === 2) le = false;
      return stripNul(decodeUtf16(body, le));
    }
  } catch { /* fall through */ }
  return stripNul(body.toString("latin1"));
}
function skipDesc(body, start, enc) {
  if (enc === 1 || enc === 2) {
    for (let i = start; i + 1 < body.length; i += 2) if (body[i] === 0 && body[i + 1] === 0) return i + 2;
    return body.length;
  }
  for (let i = start; i < body.length; i++) if (body[i] === 0) return i + 1;
  return body.length;
}
function parsePicture(body, v22) {
  if (body.length < 4) return null;
  const enc = body[0];
  let i = 1, mime;
  if (v22) {
    const fmt = body.subarray(1, 4).toString("latin1").toUpperCase();
    mime = fmt.includes("PNG") ? "image/png" : fmt.includes("GIF") ? "image/gif" : "image/jpeg";
    i = 4;
  } else {
    let j = i;
    while (j < body.length && body[j] !== 0) j++;
    mime = body.subarray(i, j).toString("latin1") || "image/jpeg";
    i = j + 1;
  }
  i += 1; // picture type
  i = skipDesc(body, i, enc);
  if (i >= body.length) return null;
  return { mime, data: body.subarray(i) };
}
function parseId3(buf) {
  const out = {};
  if (buf.length < 10 || buf.toString("latin1", 0, 3) !== "ID3") return out;
  const major = buf[3];
  const size = syncsafe(buf, 6);
  const v22 = major === 2;
  const idLen = v22 ? 3 : 4;
  const headerLen = v22 ? 6 : 10;
  const end = Math.min(buf.length, 10 + size);
  let pos = 10;
  while (pos + headerLen <= end) {
    const id = buf.toString("latin1", pos, pos + idLen);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    let fs;
    if (v22) fs = (buf[pos + 3] << 16) | (buf[pos + 4] << 8) | buf[pos + 5];
    else if (major === 4) fs = syncsafe(buf, pos + 4);
    else fs = uint32be(buf, pos + 4);
    const bs = pos + headerLen, be = bs + fs;
    if (fs <= 0 || be > end) break;
    const body = buf.subarray(bs, be);
    if (id === "TIT2" || id === "TT2") out.title ??= decodeText(body);
    else if (id === "TPE1" || id === "TP1") out.artist ??= decodeText(body);
    else if (id === "TALB" || id === "TAL") out.album ??= decodeText(body);
    else if ((id === "APIC" || id === "PIC") && !out.picture) {
      const pic = parsePicture(body, v22);
      if (pic && pic.data.length > 0) out.picture = pic;
    }
    pos = be;
  }
  return out;
}
async function readId3(filePath) {
  let fh;
  try {
    fh = await open(filePath, "r");
    const head = Buffer.alloc(10);
    await fh.read(head, 0, 10, 0);
    if (head.toString("latin1", 0, 3) !== "ID3") return {};
    const size = syncsafe(head, 6);
    const total = Math.min(10 + size, 8_000_000);
    const buf = Buffer.alloc(total);
    await fh.read(buf, 0, total, 0);
    return parseId3(buf);
  } catch {
    return {};
  } finally {
    await fh?.close().catch(() => {});
  }
}

// ── scan + emit ──────────────────────────────────────────────────────────────
async function walk(dir) {
  const out = [];
  let ents;
  try {
    ents = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    if (e.name.startsWith(".") || e.name === "_art") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (AUDIO.test(e.name)) out.push(p);
  }
  return out;
}

async function main() {
  const files = await walk(RADIO_DIR);
  await rm(ART_DIR, { recursive: true, force: true }).catch(() => {});
  await mkdir(ART_DIR, { recursive: true }).catch(() => {});

  const tracks = [];
  for (const full of files) {
    const rel = relative(RADIO_DIR, full).split("\\").join("/");
    const parts = rel.split("/");
    const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
    const file = parts[parts.length - 1];
    if (EXCLUDE[folder]?.test(file)) continue; // kept on disk, out of the playlist
    const base = file.replace(/\.[^.]+$/, "").replace(/^\d+[\s._)-]+/, "").trim();
    const fnParts = base.split(/\s+-\s+/);
    const fileArtist = fnParts.length > 1 ? fnParts[0].trim() : undefined;
    const fileTitle = (fnParts.length > 1 ? fnParts.slice(1).join(" - ") : base).trim() || file;

    const tags = file.toLowerCase().endsWith(".mp3") ? await readId3(full) : {};
    let art;
    if (tags.picture) {
      const ext = tags.picture.mime.includes("png") ? "png" : tags.picture.mime.includes("gif") ? "gif" : "jpg";
      const name = `${createHash("sha1").update(rel).digest("hex").slice(0, 16)}.${ext}`;
      await writeFile(join(ART_DIR, name), tags.picture.data);
      art = `/radio/_art/${name}`;
    }
    const src = `/radio/${rel.split("/").map(encodeURIComponent).join("/")}`;
    tracks.push({ folder, title: tags.title || fileTitle, artist: tags.artist || fileArtist || null, album: tags.album || null, src, art: art || null });
  }

  const fileOf = (t) => decodeURIComponent(t.src).split("/").pop() || "";
  const rankOf = (t) => {
    const pins = PINNED[t.folder] ?? [];
    const i = pins.findIndex((re) => re.test(fileOf(t)));
    return i < 0 ? pins.length : i;
  };
  tracks.sort((a, b) => {
    if (a.folder !== b.folder) return a.folder.localeCompare(b.folder);
    const ra = rankOf(a);
    const rb = rankOf(b);
    if (ra !== rb) return ra - rb;
    return fileOf(a).localeCompare(fileOf(b), undefined, { numeric: true });
  });

  // only rewrite when the TRACKS changed — a fresh generatedAt on every build
  // dirties the git tree, which trips any clean-tree gate run after a build
  let prevTracks = null;
  try {
    prevTracks = JSON.stringify(JSON.parse(await readFile(OUT, "utf8")).tracks);
  } catch {}
  if (prevTracks === JSON.stringify(tracks)) {
    console.log(`radio manifest: unchanged (${tracks.length} tracks)`);
    return;
  }
  await writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), tracks }));
  console.log(`radio manifest: ${tracks.length} tracks (${tracks.filter((t) => t.art).length} with art) → ${relative(ROOT, OUT)}`);
}

main().catch((e) => {
  console.error("radio manifest failed:", e);
  process.exit(0); // never fail the build over the radio manifest
});
