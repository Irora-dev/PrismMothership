#!/usr/bin/env node
// npm run doctor — the kit's health check: config present, env sane, and
// whether a newer kit release exists (version.json ⋄ updateManifestUrl).
// Zero-dependency; exits 0 with findings printed, 1 only on hard config errors.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const read = (p) => (existsSync(resolve(ROOT, p)) ? readFileSync(resolve(ROOT, p), "utf8") : null);
let bad = 0;
const ok = (m) => console.log("  ✓ " + m);
const warn = (m) => console.log("  ⚠ " + m);
const fail = (m) => (bad++, console.log("  ✖ " + m));

console.log("\n🛸 Mothership doctor\n");

// ── site.config.json ──
const cfgRaw = read("site.config.json");
if (!cfgRaw) warn("site.config.json missing — run `node create/index.mjs` or open /setup");
else {
  try {
    const cfg = JSON.parse(cfgRaw);
    cfg.siteUrl ? ok(`siteUrl: ${cfg.siteUrl}`) : warn("siteUrl not set (needed for correct share images)");
    cfg.platform ? ok(`platform: ${cfg.platform}`) : warn("platform not set");
  } catch {
    fail("site.config.json is not valid JSON");
  }
}

// ── env ──
const env = read(".env.local") ?? "";
const has = (k) => new RegExp(`^${k}=.+$`, "m").test(env) || !!process.env[k];
if (!has("ALCHEMY_API_KEY")) warn("ALCHEMY_API_KEY missing — no live chain data until set (here or in your host's env UI)");
else {
  // prove the key actually answers — the hookup integrators care about
  const key = (env.match(/^ALCHEMY_API_KEY=(.+)$/m)?.[1] ?? process.env.ALCHEMY_API_KEY ?? "").trim();
  const block = await fetch(`https://eth-mainnet.g.alchemy.com/v2/${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
    signal: AbortSignal.timeout(6000),
  })
    .then((r) => r.json())
    .then((j) => (j.result ? parseInt(j.result, 16) : null))
    .catch(() => null);
  block ? ok(`ALCHEMY_API_KEY live — mainnet block ${block.toLocaleString("en-US")}`) : fail("ALCHEMY_API_KEY present but the RPC probe failed — wrong key, or Ethereum mainnet not enabled on it");
}
has("ETHERSCAN_API_KEY") ? ok("ETHERSCAN_API_KEY present") : warn("ETHERSCAN_API_KEY missing (optional: verified badges fall back to plain source links)");
if (/^NEXT_PUBLIC_.*(KEY|SECRET|TOKEN)=/m.test(env)) fail("a NEXT_PUBLIC_* var carries a key/secret — NEXT_PUBLIC_ values ship to every visitor");

// ── update check ──
const verRaw = read("version.json");
if (verRaw) {
  try {
    const ver = JSON.parse(verRaw);
    ok(`kit version: ${ver.version}`);
    if (ver.updateManifestUrl) {
      const remote = await fetch(ver.updateManifestUrl, { signal: AbortSignal.timeout(6000) })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (!remote) warn("could not reach the update manifest (offline?) — skipped");
      else if (remote.version !== ver.version) console.log(`  ⬆ update available: ${remote.version} — say "update my site" to your agent, or follow START-HERE.md → Updating`);
      else ok("up to date with the latest release");
    }
  } catch {
    fail("version.json is not valid JSON");
  }
}

console.log(bad ? `\n${bad} hard error(s) — fix before deploying.\n` : "\nAll clear.\n");
process.exit(bad ? 1 : 0);
