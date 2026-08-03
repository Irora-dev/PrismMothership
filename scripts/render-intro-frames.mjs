// Render the Spectrum title intro ON the live Spectrum site, so the bands, the fonts and
// the wordmark gradient are the site's OWN pixels — nothing reimplemented.
//
//   node scripts/render-intro-frames.mjs <siteUrl> <outDir> [fps] [seconds]
//   e.g. node scripts/render-intro-frames.mjs http://localhost:5311/ ./frames 30 4.6
//
// How it works:
//  · A DRIVEABLE CLOCK is installed before any page script runs. The shader reads
//    performance.now() for uTime and drives itself with requestAnimationFrame, so
//    replacing both makes time a value we set and rAF a queue we tick — the bands
//    animate exactly as they do live, at the right speed, frame-accurately. (Freezing
//    rAF makes them dead still; letting them run free makes them race, since each
//    screenshot costs ~200ms of wall clock.)
//  · The shader canvas is REPARENTED to <body> and every other top-level node is
//    display:none'd. Hiding by CSS selector proved unreliable — the site's own hero
//    leaked into the opening frames — so it's done imperatively against the real DOM.
//  · The title uses the SITE'S classes (spectrum-wordmark font-display font-bold
//    uppercase for the display line, font-mono for the second, mirroring how the hero
//    composes big display + mono subtitle), so the type is identical by construction.
//  · The body's 72px grid is switched off: on a full-screen title card it reads as grain.
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BRAVE = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const [url, outDir, fpsArg, secArg] = process.argv.slice(2);
if (!url || !outDir) {
  console.error("usage: node scripts/render-intro-frames.mjs <siteUrl> <outDir> [fps] [seconds]");
  process.exit(1);
}
const FPS = Number(fpsArg || 30);
const SECONDS = Number(secArg || 4.6);
const TOTAL = Math.round(FPS * SECONDS);
mkdirSync(outDir, { recursive: true });

// beats (seconds)
const L1_IN = 0.35, L1_HOLD = 1.25; // "IT'S TIME..."
const L2_IN = 1.85, L2_HOLD = 2.70; // "FOR BASKET TOKENS"
const OUT_START = 3.75;
const easeOut = (t) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
const ramp = (t, a, b) => (b > a ? easeOut((t - a) / (b - a)) : t >= b ? 1 : 0);

const CLOCK = `(() => {
  let t = 0;
  Object.defineProperty(performance, 'now', { value: () => t, configurable: true });
  const q = [];
  window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
  window.__setTime = (ms) => { t = ms; };
  window.__tick = (n) => {
    for (let i = 0; i < (n || 1); i++) {
      const batch = q.splice(0);
      for (const cb of batch) { try { cb(t); } catch (e) {} }
    }
  };
})()`;

const STAGE = `(() => {
  const canvas = document.querySelector('canvas');
  if (!canvas) return 'NO CANVAS';
  document.body.appendChild(canvas);
  canvas.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:1;visibility:visible';
  for (const el of Array.from(document.body.children)) {
    if (el !== canvas) el.style.display = 'none';
  }
  document.body.style.backgroundImage = 'none';
  document.body.style.background = '#07070b';
  document.documentElement.style.background = '#07070b';

  const stage = document.createElement('div');
  stage.id = 'intro-stage';
  stage.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2;' +
    'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:34px;pointer-events:none';
  stage.innerHTML =
    '<span id="l1" class="spectrum-wordmark font-display font-bold uppercase" ' +
      'style="font-size:190px;line-height:0.9;letter-spacing:-5px;opacity:0;will-change:opacity,transform">' +
      "IT'S TIME..." +
    '</span>' +
    '<span id="l2" class="font-mono uppercase" ' +
      'style="font-size:66px;letter-spacing:0.2em;color:#e8e8f0;opacity:0;will-change:opacity,transform">' +
      'For Basket Tokens' +
    '</span>';
  document.body.appendChild(stage);
  const c1 = getComputedStyle(document.getElementById('l1'));
  const c2 = getComputedStyle(document.getElementById('l2'));
  return JSON.stringify({
    hidden: Array.from(document.body.children).filter((e) => e.style.display === 'none').length,
    l1Font: c1.fontFamily.split(',')[0], l1Weight: c1.fontWeight, l1Size: c1.fontSize,
    l1Gradient: (c1.backgroundImage || '').includes('gradient'),
    l2Font: c2.fontFamily.split(',')[0],
  });
})()`;

const port = 9800 + Math.floor((Date.now() / 1000) % 120);
const profile = mkdtempSync(join(tmpdir(), "brave-intro-"));
const proc = spawn(BRAVE, ["--headless=new", `--remote-debugging-port=${port}`, "--no-first-run", "--mute-audio",
  "--enable-unsafe-swiftshader", "--use-gl=angle", "--hide-scrollbars",
  `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let id = 0;
function rpc(ws, method, params = {}) {
  const n = ++id;
  return new Promise((res, rej) => {
    const on = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === n) { ws.removeEventListener("message", on); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    };
    ws.addEventListener("message", on);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
}
const evaluate = async (ws, expression) => (await rpc(ws, "Runtime.evaluate", { expression, returnByValue: true })).result?.value;

try {
  let up = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) { up = true; break; } } catch {}
    await sleep(250);
  }
  if (!up) throw new Error("CDP never came up");
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  await rpc(ws, "Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await rpc(ws, "Page.enable");
  await rpc(ws, "Page.addScriptToEvaluateOnNewDocument", { source: CLOCK });
  await rpc(ws, "Page.navigate", { url });
  await sleep(9000); // fonts + first shader paint

  const info = await evaluate(ws, STAGE);
  console.log("stage:", info);
  if (typeof info === "string" && info.includes("NO CANVAS")) throw new Error("the shader canvas never appeared");
  await sleep(600);

  for (let f = 0; f < TOTAL; f++) {
    const t = f / FPS;
    const out = 1 - ramp(t, OUT_START, OUT_START + 0.5);
    const a1 = ramp(t, L1_IN, L1_HOLD) * out;
    const a2 = ramp(t, L2_IN, L2_HOLD) * out;
    const y1 = (1 - ramp(t, L1_IN, L1_HOLD)) * 26;
    const y2 = (1 - ramp(t, L2_IN, L2_HOLD)) * 18;
    const sc1 = 0.88 + 0.12 * ramp(t, L1_IN, L1_HOLD);
    const sc2 = 0.93 + 0.07 * ramp(t, L2_IN, L2_HOLD);
    const phase = (t / 16) % 1;
    const tri = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
    const pos = 28 + 44 * tri;

    await evaluate(ws, `(() => {
      window.__setTime && window.__setTime(${(t * 1000).toFixed(1)});
      window.__tick && window.__tick(2);
      const a = document.getElementById('l1'), b = document.getElementById('l2');
      a.style.opacity = '${a1.toFixed(4)}';
      a.style.transform = 'translateY(${y1.toFixed(2)}px) scale(${sc1.toFixed(4)})';
      a.style.backgroundPosition = '${pos.toFixed(1)}% 50%, ${(100 - pos).toFixed(1)}% 50%';
      b.style.opacity = '${a2.toFixed(4)}';
      b.style.transform = 'translateY(${y2.toFixed(2)}px) scale(${sc2.toFixed(4)})';
      return 1;
    })()`);

    const shot = await rpc(ws, "Page.captureScreenshot", { format: "png" });
    writeFileSync(join(outDir, `f${String(f).padStart(4, "0")}.png`), Buffer.from(shot.data, "base64"));
    if ((f + 1) % 30 === 0) console.log(`  ${f + 1}/${TOTAL}`);
  }
  console.log(`✓ ${TOTAL} frames → ${outDir}`);
} finally {
  proc.kill("SIGKILL");
  // The temp profile is ~120MB per run. SIGKILL leaves it behind, so three runs
  // had quietly parked 351MB in /var/folders — remove it once the process is gone.
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
