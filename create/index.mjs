#!/usr/bin/env node
// create-mothership — the Prism Mothership kit onboarding wizard. Zero-dependency
// (Node built-ins only). Asks a short Q&A (or takes flags / --yes) and writes the
// two files the site reads for hosting identity:
//
//   site.config.json   (public: your site URL + hosting platform — committed)
//   .env.local         (your RPC key + optional keys — gitignored, never committed)
//
//   node create/index.mjs                                            # interactive
//   node create/index.mjs --yes --site-url https://prism.acme.xyz \
//        --platform vercel --rpc <alchemy-key>
//   node create/index.mjs --help
//
// The chain wiring (PRISM token, pools, factories) ships canonical in
// src/lib/chain/constants.ts — integrators change NOTHING on-chain. The wizard
// never invents values: a blank optional stays blank.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin, stdout, argv, exit } from "node:process";
import { agentBanner } from "./agents.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const PLATFORMS = {
  netlify: {
    name: "Netlify",
    note: "first-class: netlify.toml ships in the repo — connect the repo, set env vars in Site settings, deploy",
  },
  vercel: {
    name: "Vercel",
    note: "native Next.js: vercel.json ships in the repo — import the repo, set env vars in Project settings, deploy",
  },
  cloudflare: {
    name: "Cloudflare",
    note: "via OpenNext (docs/HOSTING.md walks it): npx opennextjs-cloudflare — set env vars as Worker secrets",
  },
  other: { name: "Other / self-host", note: "anything that runs `next build && next start` — docs/HOSTING.md" },
};

function parseFlags(args) {
  const f = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--yes" || a === "-y") f.yes = true;
    else if (a === "--force") f.force = true;
    else if (a === "--help" || a === "-h") f.help = true;
    else if (a.startsWith("--")) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      f[key] = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
    }
  }
  return f;
}

export function validateSiteUrl(u) {
  if (!u) return "site URL is required (https://your-domain)";
  try {
    const url = new URL(u);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "must be http(s)";
    return null;
  } catch {
    return "not a valid URL — include the scheme, e.g. https://prism.acme.xyz";
  }
}

export function renderSiteConfig({ siteUrl, platform, trading = "matcha" }) {
  return (
    JSON.stringify(
      { siteUrl, platform, tradingMode: trading === "native" ? "native" : "matcha", kit: "prism-mothership" },
      null,
      2,
    ) + "\n"
  );
}

export function renderEnv({ rpc, robinhoodRpc, etherscan, siteUrl }) {
  return [
    "# Prism Mothership — local/server secrets. NEVER commit this file.",
    "# On your host, set these same names in the platform's env-var UI instead.",
    `ALCHEMY_API_KEY=${rpc ?? ""}`,
    `ROBINHOOD_RPC_URL=${robinhoodRpc || "https://rpc.mainnet.chain.robinhood.com/rpc"}`,
    `ETHERSCAN_API_KEY=${etherscan ?? ""}`,
    `URL=${siteUrl ?? ""}`,
    "",
  ].join("\n");
}

async function main() {
  const f = parseFlags(argv.slice(2));
  if (f.help) {
    stdout.write(
      [
        "create-mothership — set up your own Prism Mothership instance",
        "",
        "flags (all optional; missing ones are asked interactively):",
        "  --site-url https://…     your domain (required for a production build)",
        `  --platform <${Object.keys(PLATFORMS).join("|")}>`,
        "  --rpc <key>              Alchemy API key (server-side only, gitignored)",
        "  --etherscan <key>        optional: live contract-verification badges",
        "  --robinhood-rpc <url>    optional: defaults to the public Robinhood RPC",
        "  --trading <matcha|native> matcha (default): links out for execution; native: full in-page swap (you operate it)",
        "  --yes                    accept defaults for anything not passed",
        "  --force                  overwrite existing site.config.json/.env.local",
        "",
      ].join("\n"),
    );
    exit(0);
  }

  stdout.write("\n🛸 The Prism Mothership — setup\n" + agentBanner() + "\n\n");

  const cfgPath = resolve(ROOT, "site.config.json");
  const envPath = resolve(ROOT, ".env.local");
  // --yes must NOT imply overwrite: an agent re-running setup with --yes would
  // otherwise clobber the integrator's .env.local (their keys). Only --force may.
  // The kit SHIPS a placeholder config (empty siteUrl — the build's static
  // import needs the file to exist), which doesn't count as "already set up".
  const isPlaceholder = (p) => {
    try {
      return !JSON.parse(readFileSync(p, "utf8")).siteUrl;
    } catch {
      return false;
    }
  };
  if (((existsSync(cfgPath) && !isPlaceholder(cfgPath)) || existsSync(envPath)) && !f.force) {
    stdout.write("⚠️  site.config.json or .env.local already exists. Re-run with --force to overwrite,\n");
    stdout.write("    or use the in-site studio at /setup to edit values without losing keys.\n");
    exit(1);
  }

  const rl = f.yes ? null : createInterface({ input: stdin, output: stdout });
  const ask = async (q, fallback = "") => {
    if (!rl) return fallback;
    const a = (await rl.question(q)).trim();
    return a || fallback;
  };

  let siteUrl = f.siteUrl ?? "";
  while (validateSiteUrl(siteUrl)) {
    if (f.yes) {
      stdout.write(`✖ --site-url: ${validateSiteUrl(siteUrl)}\n`);
      exit(1);
    }
    siteUrl = await ask("Your site's URL (https://…): ");
    const err = validateSiteUrl(siteUrl);
    if (err) stdout.write(`  ✖ ${err}\n`);
  }

  // what people (and their AI agents) actually type — "cloudflare pages" above
  // all: Pages can't run this kit (edge runtime only), the cloudflare target IS
  // Workers via OpenNext, so map the intent and say so out loud
  const ALIASES = {
    "cloudflare pages": "cloudflare",
    "cloudflare-pages": "cloudflare",
    "cf pages": "cloudflare",
    pages: "cloudflare",
    cf: "cloudflare",
    workers: "cloudflare",
    "cloudflare workers": "cloudflare",
    "cloudflare-workers": "cloudflare",
    "self-host": "other",
    selfhost: "other",
  };
  let platform = (f.platform ?? "").toLowerCase().trim();
  if (ALIASES[platform]) {
    if (platform.includes("pages"))
      stdout.write("ℹ Cloudflare Pages can't run this kit (its Next support is edge-runtime only) — using cloudflare = Workers via OpenNext, which keeps the Pages-style workflow. docs/HOSTING.md walks it.\n");
    platform = ALIASES[platform];
  }
  if (!PLATFORMS[platform]) {
    if (f.platform) {
      // an EXPLICIT unknown value must never silently become some other platform
      stdout.write(`✖ --platform "${f.platform}" isn't a target. Valid: ${Object.keys(PLATFORMS).join(" | ")} (cloudflare = Workers via OpenNext).\n`);
      exit(1);
    }
    if (f.yes) platform = "netlify";
    else {
      stdout.write("\nWhere will this deploy?\n");
      Object.entries(PLATFORMS).forEach(([k, p], i) => stdout.write(`  ${i + 1}. ${p.name} — ${p.note}\n`));
      const pick = await ask(`1-${Object.keys(PLATFORMS).length} [1]: `, "1");
      platform = Object.keys(PLATFORMS)[Number(pick) - 1] ?? "netlify";
    }
  }

  const rpc = f.rpc ?? (await ask("\nAlchemy API key (server-side; blank = fill in later): "));
  const etherscan = f.etherscan ?? (await ask("Etherscan API key (optional, live verified-badges): "));
  const robinhoodRpc = f.robinhoodRpc ?? "";
  rl?.close();

  const trading = (f.trading ?? "matcha").toLowerCase();
  writeFileSync(cfgPath, renderSiteConfig({ siteUrl, platform, trading }));
  writeFileSync(envPath, renderEnv({ rpc, robinhoodRpc, etherscan, siteUrl }));

  stdout.write(
    [
      "",
      "✅ Wrote site.config.json (committed) and .env.local (gitignored).",
      "",
      `Platform: ${PLATFORMS[platform].name} — ${PLATFORMS[platform].note}`,
      rpc ? "RPC key saved to .env.local." : "⚠️  No RPC key yet — the site runs but serves no live data until ALCHEMY_API_KEY is set.",
      "",
      "Next:",
      "  npm install && npm run dev     # local check on http://localhost:3090",
      "  open /setup                    # the in-site studio (edit these values with a live preview)",
      "  npm run doctor                 # config + env + update check",
      "  See START-HERE.md for the full runbook, including hosting hookup + updates.",
      "",
    ].join("\n"),
  );
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((e) => (console.error(e), exit(1)));
