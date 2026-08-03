// Screenshot a page at a TRUE device width, with an in-page horizontal-overflow
// probe and optional pre-shot JS (click a burger, scroll to a card, wait for data).
//
// Why this exists: headless Brave's `--screenshot` clamps the window to >=500px,
// so phone-width shots silently lie. Driving CDP's Emulation.setDeviceMetricsOverride
// gives real 390px viewports. Node's built-in WebSocket does the talking — no deps.
//
//   node scripts/mshot.mjs <url> <out.png> [width] [height] [preJs] [full]
//
// e.g. node scripts/mshot.mjs http://localhost:3090/ home.png 390 844 \
//        "document.querySelector('button[aria-controls=\"mobile-nav-menu\"]').click()"
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BRAVE = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const [url, out, w = "390", h = "844", preJs = "", fullPage = ""] = process.argv.slice(2);
if (!url || !out) {
  console.error("usage: node scripts/mshot.mjs <url> <out.png> [w] [h] [preJs] [full]");
  process.exit(1);
}
const port = 9333 + Math.floor((Date.now() / 1000) % 200);
const profile = mkdtempSync(join(tmpdir(), "brave-cdp-"));
const proc = spawn(
  BRAVE,
  ["--headless=new", `--remote-debugging-port=${port}`, "--no-first-run", "--mute-audio", `--user-data-dir=${profile}`, "about:blank"],
  { stdio: "ignore" },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForCdp() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error("CDP never came up");
}

let idSeq = 0;
function rpc(ws, method, params = {}) {
  const id = ++idSeq;
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      ws.removeEventListener("message", onMsg);
      m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result);
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

try {
  await waitForCdp();
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

  await rpc(ws, "Emulation.setDeviceMetricsOverride", {
    width: Number(w),
    height: Number(h),
    deviceScaleFactor: 2,
    mobile: Number(w) < 700,
  });
  await rpc(ws, "Page.enable");
  const loaded = new Promise((res) => {
    const onMsg = (ev) => {
      if (JSON.parse(ev.data).method === "Page.loadEventFired") {
        ws.removeEventListener("message", onMsg);
        res();
      }
    };
    ws.addEventListener("message", onMsg);
  });
  await rpc(ws, "Page.navigate", { url });
  await Promise.race([loaded, sleep(15000)]);
  await sleep(6000); // let live data + reveal animations settle

  if (preJs) {
    const r = await rpc(ws, "Runtime.evaluate", { expression: preJs, awaitPromise: true, returnByValue: true, timeout: 60000 });
    if (r?.result?.value !== undefined)
      console.log("preJs:", typeof r.result.value === "string" ? r.result.value : JSON.stringify(r.result.value));
    await sleep(800);
  }

  const probe = await rpc(ws, "Runtime.evaluate", {
    expression:
      "JSON.stringify({ innerWidth, docScrollW: document.documentElement.scrollWidth, overflow: document.documentElement.scrollWidth - innerWidth })",
    returnByValue: true,
  });
  console.log("probe:", probe.result.value);

  const shot = await rpc(ws, "Page.captureScreenshot", { format: "png", captureBeyondViewport: fullPage === "full" });
  writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log("saved:", out);
} finally {
  proc.kill("SIGKILL");
}
