// Export the pixel-rainbow brand mark as the PRISM token logo.
//
//   node scripts/make-token-logo.mjs
//
// Geometry is copied EXACTLY from <PixelRainbow/> (src/components/effects/pixel-rainbow.tsx):
// concentric pixel rings, one spectrum band per ring, so the token logo and the site's
// wordmark are the same mark rather than two drifting versions.
//
// Sizes: 256 is the spec every destination states (Trust Wallet, MetaMask, token lists,
// CoinGecko) — not 250, which their validators reject. 512 is headroom. The small export
// drops the inter-pixel gap and the corner rounding, because at 32px those details turn
// the arch into mush; without them it still reads as a rainbow arc in a wallet row.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "token");

const BANDS = ["#ff5a5a", "#ff9f45", "#ffe14d", "#5cff8f", "#3bd9ff", "#7c8bff", "#c06aff"];
const R = 9; // outer radius (red)
const INNER = 3; // inner radius (violet)
const COLS = R * 2 + 1; // 19
const ROWS = R + 1; // 10

/** The arch as an SVG string. `crisp` = no gap, no rounding (for small sizes). */
function archSvg(cell, crisp) {
  const gap = crisp ? 0 : cell * 0.2;
  const rx = crisp ? 0 : cell * 0.18;
  const rects = [];
  for (let x = -R; x <= R; x++) {
    for (let y = 0; y <= R; y++) {
      const d = Math.round(Math.hypot(x, y));
      if (d < INNER || d > R) continue;
      rects.push(
        `<rect x="${((x + R) * cell + gap / 2).toFixed(3)}" y="${((ROWS - 1 - y) * cell + gap / 2).toFixed(3)}" ` +
          `width="${(cell - gap).toFixed(3)}" height="${(cell - gap).toFixed(3)}" rx="${rx.toFixed(3)}" fill="${BANDS[R - d]}"/>`,
      );
    }
  }
  const w = COLS * cell;
  const h = ROWS * cell;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${rects.join("")}</svg>`;
}

// The arch is wide and short (19×10 cells), so on a square canvas it is centred with
// padding rather than stretched — many wallets circle-crop, and the padding keeps the
// red outer ring clear of the crop.
async function render(size, { crisp = false, widthFraction = 0.86 } = {}) {
  const cell = (size * widthFraction) / COLS;
  const svg = archSvg(cell, crisp);
  const arch = await sharp(Buffer.from(svg)).png().toBuffer();
  const buf = await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: arch, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  const file = join(OUT, `prism-logo-${size}.png`);
  writeFileSync(file, buf);
  const m = await sharp(file).metadata();
  console.log(
    `   → public/token/prism-logo-${size}.png  ${m.width}x${m.height} ${m.format} alpha=${m.hasAlpha} ${(buf.length / 1024).toFixed(1)}KB`,
  );
}

mkdirSync(OUT, { recursive: true });
console.log("\nPRISM token logo — pixel-rainbow mark, transparent background:");
await render(256); // the spec size, and the URL the token kit publishes
await render(512); // headroom for anything that wants larger
await render(32, { crisp: true, widthFraction: 0.94 }); // wallet-row size
console.log("");
