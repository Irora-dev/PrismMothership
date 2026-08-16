// Decode the QR out of an exported basket card and print where it actually
// points.  `node scripts/qr-check.mjs <card.png> [expected-url]`
//
// Why this is a repo script and not a one-off: a QR is the one thing on the card
// that nobody can proofread. It renders as a plausible square of noise whether
// it encodes the right basket, the wrong basket, or nothing at all, so the only
// honest check is to decode the exported pixels and read the URL back. Export a
// card from the Studio's Basket tab, run this on the file, and compare.
//
// Exit 1 on a failed decode, or on a mismatch when an expected URL is given.
import { readFileSync } from "node:fs";
import sharp from "sharp";
import jsQR from "jsqr";

const [file, expected] = process.argv.slice(2);
if (!file) {
  console.error("usage: node scripts/qr-check.mjs <card.png> [expected-url]");
  process.exit(1);
}

const img = sharp(readFileSync(file));
const { width, height } = await img.metadata();
// The card puts the QR in the top right. Scan that corner first, then the whole
// image, so this still works on a crop or a re-laid-out card.
const regions = [
  { left: Math.round(width * 0.82), top: 0, width: Math.round(width * 0.18), height: Math.round(height * 0.3) },
  { left: 0, top: 0, width, height },
];

let found = null;
for (const r of regions) {
  const { data, info } = await sharp(readFileSync(file)).extract(r).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const hit = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  if (hit?.data) {
    found = hit.data;
    break;
  }
}

if (!found) {
  console.error(`✖ no QR could be decoded from ${file}`);
  process.exit(1);
}
console.log(`QR → ${found}`);
if (expected && found !== expected) {
  console.error(`✖ expected ${expected}`);
  process.exit(1);
}
if (expected) console.log("✓ matches the expected URL");
