#!/usr/bin/env node
// Register a bot's command MENU with Telegram (setMyCommands).
//
// Why this exists: Telegram's command list is replace-only. Any hand edit via
// BotFather replaces the WHOLE menu (observed 2026-08-05: a single /ca entry
// added by hand wiped every other command). The menu is therefore code: this
// script is the one source of truth, and re-running it restores everything.
//
// There are two bots (see src/lib/social/bots.ts), and each gets its own menu:
//
//   prism    — the community's ecosystem helper: price, burn, supply, links
//   spectrum — the Spectrum suite: baskets, group tools, your own portfolio
//
//   node scripts/telegram-commands.mjs --bot prism
//   node scripts/telegram-commands.mjs --bot spectrum
//   node scripts/telegram-commands.mjs --bot spectrum --show   # what Telegram has now
//
// Reads the bot's token from the environment or .env.local. The menu is
// discovery only. Replies come from src/lib/social/commands.ts via the webhook,
// and the partition there is what actually decides who answers what, so keep a
// roster below in step with that bot's command set.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(new URL(".", import.meta.url).pathname, "..");

// Descriptions ≤256 chars; command names lowercase a–z, 0–9, _.
const MENUS = {
  prism: {
    tokenEnv: "TELEGRAM_BOT_TOKEN",
    label: "Prism community bot",
    commands: [
      { command: "price", description: "PRISM price & market cap" },
      { command: "burn", description: "PRISM burned · today / week / all-time" },
      { command: "bigburn", description: "How close the next big burn is" },
      { command: "supply", description: "Cap, burned forever, burn progress" },
      { command: "prism", description: "PRISM revenue & burn stats" },
      { command: "earned", description: "Lifetime fees per whole PRISM" },
      { command: "quote", description: "Live buy quote · /quote 0.5" },
      { command: "wallet", description: "Holdings & claimable fees · /wallet 0x…" },
      { command: "ca", description: "0xCf4d29f14Cc585DDd1167F956092852AF844e040" },
      { command: "links", description: "Every official link · linktr.ee/prism_lp" },
      { command: "lightrunner", description: "The onchain roguelike · weekly leagues" },
      { command: "help", description: "Everything this bot can do" },
    ],
  },
  spectrum: {
    tokenEnv: "SPECTRUM_BOT_TOKEN",
    label: "Spectrum suite bot",
    commands: [
      { command: "baskets", description: "Every live Spectrum basket" },
      { command: "leaderboard", description: "Baskets ranked by 24h performance" },
      { command: "basket", description: "One basket's holdings & stats · /basket TICKER" },
      { command: "token", description: "Instant token intel · /token TICKER or CA" },
      { command: "split", description: "Sketch an allocation · /split 60 X 40 Y" },
      { command: "portfolio", description: "Spectrum Portfolio · volume, fees, users" },
      { command: "link", description: "DM only · connect a wallet (read-only)" },
      { command: "me", description: "DM only · your positions across every chain" },
      { command: "pnl", description: "DM only · how you're doing since you linked" },
      { command: "reweight", description: "DM only · a target, then the page to sign it" },
      { command: "alerts", description: "DM only · material moves only, a few a day" },
      { command: "buy", description: "Price a buy, then open the swap · /buy PEPE 100" },
      { command: "ourbasket", description: "Register the group's basket, then live stats" },
      { command: "watch", description: "Add to the group watchlist · /watch TICKER" },
      { command: "watchlist", description: "The group's radar, performance since added" },
      { command: "league", description: "Group baskets, ranked" },
      { command: "help", description: "Everything this bot can do" },
    ],
  },
};

const argv = process.argv.slice(2);
const flag = (n) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const which = flag("--bot") || "prism";
const menu = MENUS[which];
if (!menu) {
  console.error(`✖ unknown --bot "${which}" (expected: ${Object.keys(MENUS).join(" | ")})`);
  process.exit(1);
}

function token() {
  if (process.env[menu.tokenEnv]) return process.env[menu.tokenEnv];
  const envFile = resolve(ROOT, ".env.local");
  if (existsSync(envFile)) {
    const m = readFileSync(envFile, "utf8").match(new RegExp(`^${menu.tokenEnv}=(.+)$`, "m"));
    if (m) return m[1].trim();
  }
  console.error(`✖ ${menu.tokenEnv} not set (env or .env.local) — needed for the ${menu.label}`);
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
  console.log(`current menu (${menu.label}):`);
  for (const c of cur.result ?? []) console.log(`  /${c.command} · ${c.description}`);
  if (!(cur.result ?? []).length) console.log("  (empty)");
};

if (argv.includes("--show")) {
  await show();
  process.exit(0);
}

const res = await api("setMyCommands", { commands: menu.commands });
if (!res.ok) {
  console.error("✖ setMyCommands failed:", JSON.stringify(res));
  process.exit(1);
}
console.log(`✅ ${menu.label}: registered ${menu.commands.length} commands`);
await show();
