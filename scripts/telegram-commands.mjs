#!/usr/bin/env node
// Register @SpectraPrismBot's command MENU with Telegram (setMyCommands).
//
// Why this exists: Telegram's command list is replace-only — any hand edit via
// BotFather replaces the WHOLE menu (observed 2026-08-05: a single /ca entry
// added by hand wiped every other command). The menu is therefore code: this
// script is the one source of truth, and re-running it restores everything.
//
//   node scripts/telegram-commands.mjs          # register the roster
//   node scripts/telegram-commands.mjs --show   # print what Telegram has now
//
// Reads TELEGRAM_BOT_TOKEN from the environment or .env.local. The menu is
// discovery only — replies come from src/lib/social/commands.ts via the
// webhook, so keep the two in sync.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(new URL(".", import.meta.url).pathname, "..");

// The roster. Descriptions ≤256 chars; command names lowercase a–z, 0–9, _.
const COMMANDS = [
  { command: "baskets", description: "Every live Spectrum basket" },
  { command: "leaderboard", description: "Baskets ranked by 24h performance" },
  { command: "basket", description: "One basket's holdings & stats — /basket TICKER" },
  { command: "burn", description: "PRISM burned — today / week / all-time" },
  { command: "bigburn", description: "How close the next big burn is" },
  { command: "prism", description: "PRISM revenue & burn stats" },
  { command: "price", description: "PRISM price & market cap" },
  { command: "supply", description: "Cap, burned forever, burn progress" },
  { command: "earned", description: "Lifetime fees per whole PRISM" },
  { command: "quote", description: "Live buy quote — /quote 0.5" },
  { command: "wallet", description: "Holdings & claimable fees — /wallet 0x…" },
  { command: "portfolio", description: "Spectrum Portfolio — volume, fees, users" },
  { command: "lightrunner", description: "The onchain roguelike — weekly leagues" },
  { command: "ca", description: "0xCf4d29f14Cc585DDd1167F956092852AF844e040" },
  { command: "links", description: "Every official link — linktr.ee/prism_lp" },
  { command: "help", description: "Everything the bot can do" },
];

function token() {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN;
  const envFile = resolve(ROOT, ".env.local");
  if (existsSync(envFile)) {
    const m = readFileSync(envFile, "utf8").match(/^TELEGRAM_BOT_TOKEN=(.+)$/m);
    if (m) return m[1].trim();
  }
  console.error("✖ TELEGRAM_BOT_TOKEN not set (env or .env.local)");
  process.exit(1);
}

const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).then((r) => r.json());

const show = async () => {
  const cur = await api("getMyCommands");
  console.log("current menu:");
  for (const c of cur.result ?? []) console.log(`  /${c.command} — ${c.description}`);
  if (!(cur.result ?? []).length) console.log("  (empty)");
};

if (process.argv.includes("--show")) {
  await show();
  process.exit(0);
}

const res = await api("setMyCommands", { commands: COMMANDS });
if (!res.ok) {
  console.error("✖ setMyCommands failed:", JSON.stringify(res));
  process.exit(1);
}
console.log(`✅ registered ${COMMANDS.length} commands`);
await show();
