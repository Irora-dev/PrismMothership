// Serve the device wall (scripts/device-wall.html) — a grid of live iframes
// of the running dev server at real phone/tablet sizes, so a full-site mobile
// sweep happens on one screen.
//
//   node scripts/device-wall.mjs [port] [target]
//   → http://localhost:4499  (iframes http://localhost:3588 by default;
//      override per-session with ?target=http://localhost:XXXX)
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.argv[2]) || 4499;
const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "device-wall.html"));

createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(html);
}).listen(port, () => console.log(`device wall → http://localhost:${port}`));
