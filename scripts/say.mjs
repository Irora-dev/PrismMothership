#!/usr/bin/env node
// Talk to the running bot the way the gate does, so a command's behaviour is
// exercised against the real handler rather than reasoned about.
//
//   node scripts/say.mjs "/leaderboard" "/token PEPE"
//   node scripts/say.mjs --dm "/me"            # private chat instead of group
//   node scripts/say.mjs --bot prism "/prism"  # the other bot (default spectrum)
//
// Lives in the repo, not a scratchpad: scratchpads rotate away mid-session and
// take the tooling with them (it has happened twice now).
import { readFileSync, existsSync } from "node:fs";

const env = {};
const p = new URL("../.env.local", import.meta.url).pathname;
if (existsSync(p)) {
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(n);
  if (i < 0) return null;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const dm = args.includes("--dm") && (args.splice(args.indexOf("--dm"), 1), true);
const bot = flag("--bot") || "spectrum";
const BASE = flag("--base") || "http://localhost:3090";

const PATHS = { prism: "/api/telegram/webhook", spectrum: "/api/telegram/spectrum" };
const SECRETS = { prism: env.TELEGRAM_WEBHOOK_SECRET, spectrum: env.SPECTRUM_WEBHOOK_SECRET };
const GROUP = { id: -1002000000001, type: "supergroup", title: "Say Group" };
const PRIVATE = { id: 424242, type: "private", first_name: "the designer" };
let seq = Date.now() % 100000;

async function say(text) {
  const body = {
    update_id: ++seq,
    message: { message_id: ++seq, date: Math.floor(Date.now() / 1000), chat: dm ? PRIVATE : GROUP, from: { id: 424242, first_name: "the designer" }, text },
  };
  const r = await fetch(`${BASE}${PATHS[bot]}?dry=1`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRETS[bot] || "" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const d = await r.json().catch(() => ({}));
  return String(d.reply?.text || JSON.stringify(d).slice(0, 300));
}

const strip = (s) => s.replace(/<[^>]+>/g, "");
for (const cmd of args) {
  console.log("\n\x1b[36m› " + cmd + "\x1b[0m");
  console.log(strip(await say(cmd)));
}
