#!/usr/bin/env node
// ── The surface gate ─────────────────────────────────────────────────────────
// Typechecking proves the code compiles. It does not prove a card renders, a
// command answers, a price is legible, or a button goes somewhere real — and
// every bug that reached a user on these surfaces was in that gap:
//
//   · a card that rendered a perfect frame full of zeros (data fetch trusted
//     one origin) and another that rendered an empty frame (Satori can't decode
//     webp) — both HTTP 200, both typechecked
//   · a radio that played nothing (crossOrigin demanded CORS the host doesn't send)
//   · "$0.00" for a micro-cap token (a formatter rounding under $1)
//   · literal <b> tags in every reply (an un-escape that never matched)
//   · a launch button pointing at a page that does not exist (404)
//
// So this gate exercises the real surfaces against a running server and fails
// loudly. Dependency-free on purpose: it runs on any integrator's machine, in
// CI, and inside the release gate.
//
//   node scripts/verify.mjs                 # against http://localhost:3588
//   node scripts/verify.mjs --base <url>    # against any deployment
//   node scripts/verify.mjs --quick         # skip the slow chain-backed checks
//   node scripts/verify.mjs --live          # the live deployment the bot serves
//
// ⚠️ RUN IT AGAINST PRODUCTION, not only locally. On 2026-08-07 this gate was
// green locally while the live deployment 404'd on /link and /api/link/mint,
// which is the entire wallet-link onboarding path. A green local run proves the
// CODE is right; it says nothing about the deployment users are actually hitting.
// --live resolves the host from the bot's own webhook, so it cannot drift from
// wherever Telegram is really sending updates.

const args = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] ?? true : d;
};
const BASE = (flag("--base") || process.env.VERIFY_BASE || "http://localhost:3588").replace(/\/$/, "");

// Read .env.local the way the app does. Without this the gate skips every check
// that keys off a configured value and reports a pass for work it never did,
// which is worse than failing.
try {
  const { readFileSync: rf, existsSync: ex } = await import("node:fs");
  const p = new URL("../.env.local", import.meta.url).pathname;
  if (ex(p)) {
    for (const line of rf(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
} catch { /* the gate still runs, just with whatever the shell gave it */ }
const QUICK = args.includes("--quick");
const LIVE = args.includes("--live");

let pass = 0;
const failures = [];
const ok = (name) => {
  pass++;
  console.log(`  ✅ ${name}`);
};
const fail = (name, detail) => {
  failures.push({ name, detail });
  console.log(`  ❌ ${name}\n     ${detail}`);
};
const section = (t) => console.log(`\n${t}`);

const target = () => LIVE_BASE || BASE;
const get = async (path, ms = 60_000) => {
  const r = await fetch(path.startsWith("http") ? path : `${target()}${path}`, { signal: AbortSignal.timeout(ms), redirect: "manual" });
  return r;
};

// Where is the bot ACTUALLY served from? Ask Telegram rather than trusting a
// constant: the webhook is the single source of truth for which deployment is
// answering users, and it has pointed somewhere unexpected before.
let LIVE_BASE = null;
if (LIVE) {
  const tok = process.env.TELEGRAM_BOT_TOKEN;
  if (!tok) {
    console.error("✖ --live needs TELEGRAM_BOT_TOKEN to ask Telegram where the webhook points");
    process.exit(1);
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${tok}/getWebhookInfo`, { signal: AbortSignal.timeout(30_000) });
    const url = (await r.json())?.result?.url;
    if (!url) {
      console.error("✖ no webhook is set, so there is no live deployment to check");
      process.exit(1);
    }
    LIVE_BASE = new URL(url).origin;
    console.log(`🌐 live target resolved from the webhook: ${LIVE_BASE}\n`);
  } catch (e) {
    console.error("✖ could not reach Telegram to resolve the live host:", String(e.message || e));
    process.exit(1);
  }
}

// ── 1. the app answers at all ────────────────────────────────────────────────
async function gateHealth() {
  section("① Surfaces respond");
  for (const p of ["/", "/command", "/claim", "/spectrum", "/radio", "/trade", "/how-it-works", "/burn", "/dev", "/contracts", "/link"]) {
    try {
      const r = await get(p, 30_000);
      if (r.status === 200) ok(`page ${p}`);
      else fail(`page ${p}`, `HTTP ${r.status}`);
    } catch (e) {
      fail(`page ${p}`, String(e.message || e));
    }
  }
  try {
    const r = await get("/api/feed");
    const d = await r.json();
    if (!r.ok) fail("/api/feed", `HTTP ${r.status}`);
    else if (d.mode !== "live" && d.mode !== "demo") fail("/api/feed", `unknown mode ${d.mode}`);
    else ok(`/api/feed (${d.mode}, ${d.events?.length ?? 0} events, stats ${d.stats ? "present" : "null"})`);
  } catch (e) {
    fail("/api/feed", String(e.message || e));
  }
}

// ── 2. every card renders REAL pixels ────────────────────────────────────────
// A card that silently loses its data or its art still returns 200 and still
// looks like a card. Two signals catch that: a per-kind byte floor (art-bearing
// cards are far heavier than their empty frame), and — for data-driven kinds —
// two different inputs MUST produce different bytes.
const CARDS = [
  { kind: "digest", min: 30_000 },
  { kind: "price", min: 30_000 },
  { kind: "burn", min: 30_000 },
  { kind: "earned", min: 30_000 },
  { kind: "prism", min: 30_000 },
  { kind: "help", min: 30_000 },
  { kind: "ca", min: 30_000 },
  { kind: "links", min: 30_000 },
  { kind: "portfolio", min: 30_000 },
  // art-bearing: the empty-frame regression rendered ~105KB, the real one ~590KB
  { kind: "lightrunner", min: 250_000 },
  { kind: "baskets", min: 30_000 },
  { kind: "league", min: 20_000 },
  // param-driven: also asserted to VARY with input
  { kind: "burn-event&prism=0.42", min: 20_000, vary: "burn-event&prism=9.99" },
  { kind: "launch&symbol=AAA&name=Alpha", min: 20_000, vary: "launch&symbol=ZZZ&name=Omega" },
  { kind: "token&sym=AAA&price=%241.00&liq=%241M", min: 20_000, vary: "token&sym=ZZZ&price=%249.99&liq=%249M" },
  { kind: "quote&in=0.5&out=4.2", min: 20_000, vary: "quote&in=9.9&out=88.8" },
  { kind: "idea&syms=AAA,BBB", min: 20_000, vary: "idea&syms=XXX,YYY,ZZZ" },
  { kind: "split&spec=60:AAA,40:BBB", min: 20_000, vary: "split&spec=25:CCC,75:DDD" },
  { kind: "me&total=1200&legs=AAA:800,BBB:400", min: 20_000, vary: "me&total=99&legs=ZZZ:99" },
  { kind: "pnl&total=1200&delta=200&legs=AAA:800", min: 20_000, vary: "pnl&total=900&delta=-300&legs=ZZZ:900" },
  { kind: "buy&sym=AAA&amount=%24100&from=trim%20BBB", min: 20_000, vary: "buy&sym=ZZZ&amount=%24900&from=cash" },
  { kind: "reweight&from=sell%20AAA", min: 20_000, vary: "reweight&from=buy%20ZZZ" },
  { kind: "welcome", min: 25_000 },
];
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

async function renderCard(kind) {
  const r = await get(`/api/card?kind=${kind}`, 90_000);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.subarray(0, 4).equals(PNG_MAGIC)) throw new Error("not a PNG");
  return buf;
}

async function gateCards() {
  section("② Cards render real pixels");
  for (const c of CARDS) {
    try {
      const buf = await withRetry(() => renderCard(c.kind), c.kind);
      if (buf.length < c.min) {
        fail(`card ${c.kind}`, `only ${buf.length}B (floor ${c.min}) — art or data probably missing`);
        continue;
      }
      if (c.vary) {
        const other = await renderCard(c.vary);
        if (Buffer.compare(buf, other) === 0) {
          fail(`card ${c.kind}`, "identical bytes for different inputs — the card ignores its params");
          continue;
        }
      }
      ok(`card ${c.kind} (${Math.round(buf.length / 1024)}KB)`);
    } catch (e) {
      fail(`card ${c.kind}`, String(e.message || e));
    }
  }
}

// ── 3. every command answers, cleanly ────────────────────────────────────────
// Catches: a handler that stops replying, a formatter printing $0.00 / NaN /
// undefined, an un-escape leaving literal tags, and any reply whose attached
// card 404s.
const GROUP = { id: -100999001, type: "supergroup", title: "Gate Group" };
const DM = { id: 999002, type: "private" };
// Regexes, not substrings: "$0.00" is a PREFIX of the legitimate micro-cap
// "$0.00000282", so a naive includes() flags exactly the thing the formatter
// fix was for. The gate found this in itself on its first run.
const BAD_MARKERS = [
  [/I don't know/, "unknown command"],
  [/\bundefined\b/, "an undefined leaked into copy"],
  [/\bNaN\b/, "NaN in copy"],
  [/\[object Object\]/, "an object stringified into copy"],
  // only real tags — "&lt;ticker&gt;" is deliberate placeholder copy in /help
  [/&lt;\/?(b|i|code|a|pre)&gt;/, "double-escaped markup"],
  [/\$0\.00(?!\d)/, "a price rounded to nothing (micro-cap formatter)"],
  [/\$NaN/, "NaN price"],
  // Em dashes are banned in copy (a standing rule). This matches the PROSE use
  // — a word, then a spaced dash — and deliberately not the bare "—" that means
  // "no value yet", which is the site's empty-state glyph and reaches copy as
  // "· — ·" or "(—)" from the pct()/fmt helpers.
  [/[A-Za-z0-9),.!?"'%]\s—\s/, "an em dash in prose (banned in copy)"],
];
// [command, chat, opts] — opts.bot names the bot that OWNS it (default prism).
// Both bots are exercised, each on its own surface.
const COMMANDS = [
  // the Prism community bot: the ecosystem beat
  ["/help", GROUP],
  ["/price", GROUP],
  ["/burn", GROUP],
  ["/bigburn", GROUP],
  ["/supply", GROUP],
  ["/prism", GROUP],
  ["/earned", GROUP],
  ["/ca", GROUP],
  ["/links", GROUP],
  ["/lightrunner", GROUP],
  ["/start", DM],
  ["/start", GROUP],
  // the Spectrum suite bot: baskets, groups, the private book
  ["/help", GROUP, { bot: "spectrum" }],
  ["/baskets", GROUP, { bot: "spectrum" }],
  ["/leaderboard", GROUP, { bot: "spectrum" }],
  ["/portfolio", GROUP, { bot: "spectrum" }],
  ["/league", GROUP, { bot: "spectrum" }],
  ["/watchlist", GROUP, { bot: "spectrum" }],
  ["/token PEPE", GROUP, { bot: "spectrum", slow: true }],
  ["/split 60 PEPE 40 MOG", GROUP, { bot: "spectrum", slow: true }],
  ["/start", DM, { bot: "spectrum" }],
  ["/link", DM, { bot: "spectrum" }],
  ["/me", DM, { bot: "spectrum" }],
  ["/reweight", DM, { bot: "spectrum" }],
  ["/pnl", DM, { bot: "spectrum" }],
  ["/alerts", DM, { bot: "spectrum" }],
  ["/buy PEPE 100", GROUP, { bot: "spectrum", slow: true }],
  ["/pnl", GROUP, { bot: "spectrum", expect: "private message" }],
  ["/link", GROUP, { bot: "spectrum", expect: "private message" }], // DM-only must refuse in groups
];

let seq = 70000;
// A gate that cries wolf gets ignored, and these checks lean on third-party
// APIs (DexScreener) that rate-limit. So a request is retried once before it is
// called a failure — a flake and a regression must not look the same.
async function withRetry(fn, label) {
  try {
    return await fn();
  } catch (e) {
    const msg = String(e?.message || e);
    if (/HTTP 429|timeout|fetch failed|ECONN/i.test(msg)) {
      await new Promise((r) => setTimeout(r, 2500));
      return fn();
    }
    throw new Error(`${label}: ${msg}`);
  }
}

// Two bots, two webhooks (see src/lib/social/bots.ts). Every check names the bot
// that owns the command it is testing: aiming a Spectrum command at the Prism
// webhook now correctly gets a "that lives next door" pointer, which is a pass
// for the partition and a false failure for everything else.
const BOT_PATH = { prism: "/api/telegram/webhook", spectrum: "/api/telegram/spectrum" };
const BOT_SECRET_ENV = { prism: "TELEGRAM_WEBHOOK_SECRET", spectrum: "SPECTRUM_WEBHOOK_SECRET" };

const SPLIT_ARMED = Boolean(process.env.SPECTRUM_BOT_TOKEN);
/** Where a command actually lives right now. Dormant, everything is on Prism. */
const effectiveBot = (which) => (which === "spectrum" && !SPLIT_ARMED ? "prism" : which);

async function botSay(text, chat, whichRaw = "prism") {
  const which = effectiveBot(whichRaw);
  const body = {
    update_id: ++seq,
    message: { message_id: seq, date: Math.floor(Date.now() / 1000), chat, from: { id: ++seq, first_name: "Gate" }, text },
  };
  const secret = process.env[BOT_SECRET_ENV[which]];
  const r = await fetch(`${target()}${BOT_PATH[which]}?dry=1`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (r.status === 401) throw new Error(`401 — set ${BOT_SECRET_ENV[which]} in the env running this gate`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

const urlsIn = (s) => [...String(s).matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((m) => m[0]);

async function gateCommands() {
  section("③ Commands answer, cleanly");
  const seenUrls = new Set();
  for (const [text, chat, opts = {}] of COMMANDS) {
    if (QUICK && opts.slow) continue;
    try {
      const d = await withRetry(() => botSay(text, chat, opts.bot || "prism"), `${opts.bot || "prism"} ${text}`);
      const reply = d.reply || d.suggestion;
      if (!reply || !reply.text?.trim()) {
        fail(`cmd ${opts.bot || "prism"} ${text}`, "no reply");
        continue;
      }
      if (opts.expect && !reply.text.toLowerCase().includes(opts.expect.toLowerCase())) {
        fail(`cmd ${opts.bot || "prism"} ${text}`, `expected to mention "${opts.expect}"`);
        continue;
      }
      const bad = BAD_MARKERS.find(([re]) => re.test(reply.text));
      if (bad && !opts.expect) {
        fail(`cmd ${opts.bot || "prism"} ${text}`, `${bad[1]} → "${reply.text.slice(0, 90).replace(/\n/g, " ")}"`);
        continue;
      }
      for (const u of urlsIn(reply.text)) seenUrls.add(u);
      if (reply.photoUrl) seenUrls.add(reply.photoUrl);
      ok(`cmd ${opts.bot || "prism"} ${text}${reply.photoUrl ? " (+card)" : ""}`);
    } catch (e) {
      fail(`cmd ${opts.bot || "prism"} ${text}`, String(e.message || e));
    }
  }
  return seenUrls;
}

// ── 4. nothing the bot says points at a dead page ────────────────────────────
// The launch handoff pointed at a create page that does not exist in this kit —
// an addictive flow ending in a 404. Every URL the bot emits gets checked.
async function gateLinks(urls) {
  section("④ Every link the bot hands out resolves");
  // The bot emits absolute URLs built from its configured site URL, which in a
  // dev/staging run is NOT the origin under test. Treat that host as internal
  // and re-point it at BASE — otherwise every one of the bot's own links reads
  // as a third-party venue (the gate's second self-caught bug).
  let ownHost = null;
  try {
    const d = await (await get("/api/feed", 20_000)).json().catch(() => null);
    void d;
  } catch {
    /* ignore */
  }
  for (const u of urls) {
    try {
      const h = new URL(u).host;
      if (/prismmothership|prismbeat|localhost/.test(h)) ownHost = h;
    } catch {
      /* skip */
    }
  }
  const externalOk = [/^https:\/\/dexscreener\.com/, /^https:\/\/etherscan\.io/, /^https:\/\/x\.com/, /^https:\/\/t\.me/, /^https:\/\/linktr\.ee/, /^https:\/\/playlightrunner\.com/, /^https:\/\/spectrumindexes\.xyz/, /^https:\/\/app\.uniswap\.org/, /^https:\/\/matcha\.xyz/];
  // whatever the operator configured as the create page is trusted by definition:
  // it is their own deployment, named in their own env, and it may be any host
  let createHost = null;
  try {
    if (process.env.SPECTRUM_CREATE_URL) createHost = new URL(process.env.SPECTRUM_CREATE_URL).host;
  } catch { /* a malformed value is caught by the handoff gate, not here */ }
  for (const u of [...urls].slice(0, 40)) {
    let host = "";
    try {
      host = new URL(u).host;
    } catch {
      fail("malformed link", u);
      continue;
    }
    // The create page is a SEPARATE deployment (a different repo, possibly a
    // different host), so it is neither ours nor a third-party venue. Verify it
    // at its own origin rather than re-pointing the path at BASE, which is how
    // a perfectly good handoff got reported as a 404.
    if (createHost && host === createHost) {
      try {
        const r = await get(u, 45_000);
        if (r.status >= 200 && r.status < 400) ok(`create page ${host}${new URL(u).pathname} → ${r.status}`);
        else fail("create page", `${u} → HTTP ${r.status}. SPECTRUM_CREATE_URL points at nothing.`);
      } catch (e) {
        fail("create page", `${u} → ${String(e.message || e)} (unreachable from here; fine if it is not running, a real failure in CI)`);
      }
      continue;
    }
    const isInternal = u.startsWith(BASE) || /^localhost/.test(host) || (ownHost !== null && host === ownHost);
    if (!isInternal) {
      if (externalOk.some((re) => re.test(u))) ok(`external ${new URL(u).host}`);
      else fail("external link", `${u} — not in the allowlist; is this venue intended?`);
      continue;
    }
    try {
      // strip whichever origin it carries, then test the PATH against BASE
      const path = new URL(u).pathname + new URL(u).search;
      const r = await get(path, 45_000);
      if (r.status >= 200 && r.status < 400) ok(`internal ${new URL(u).pathname}`);
      else fail("internal link", `${new URL(u).pathname} → HTTP ${r.status} (a button pointing at nothing)`);
    } catch (e) {
      fail("internal link", `${u} → ${String(e.message || e)}`);
    }
  }
}

// ── 4b. MONEY-PATH DEFENCES ──────────────────────────────────────────────────
// These commands don't move funds, they DIRECT them — so the gate probes them
// adversarially rather than happily. Each case is a way a user loses money or
// an attacker profits, and the expected behaviour is refusal or disclosure.
const ADVERSARIAL = [
  { text: "/buy PEPE -100", chat: GROUP, mustNot: /Funded by/, must: /🛑|more than zero/i, why: "a negative size must be refused" },
  { text: "/buy PEPE 0", chat: GROUP, must: /🛑|more than zero/i, why: "a zero size must be refused" },
  { text: "/buy PEPE 999999999999", chat: GROUP, must: /🛑|check the number/i, why: "an absurd size must be refused" },
  { text: "/buy PEPE abc", chat: GROUP, must: /🛑|isn't a number/i, why: "a non-numeric size must be refused" },
  { text: "/buy PEPE 100", chat: GROUP, must: /0x[a-fA-F0-9]{40}/, why: "a money action must always show the contract address" },
  { text: "/token PEPE", chat: GROUP, must: /0x[a-fA-F0-9]{40}/, why: "token intel must show the address it means" },
  { text: "/token NOTAREALTOKEN12345", chat: GROUP, must: /Couldn't find/i, why: "an unknown ticker must not resolve to something" },
  { text: "/buy 0x0000000000000000000000000000000000000000 100", chat: GROUP, must: /Couldn't find/i, why: "the zero address must not resolve" },
  { text: "/reweight 60 PEPE 40 MOG", chat: GROUP, must: /private message/i, why: "portfolio actions must stay out of groups" },
  { text: "/me", chat: GROUP, must: /private message/i, why: "a wallet must never be read into a group" },
  // Two shapes of bogus code: malformed (too long to be a code at all, so it is
  // treated as a plain /start) and well-formed but never minted (the claim path
  // must miss). Either way what matters is that no wallet gets linked, so assert
  // the absence of a book rather than any one wording.
  { text: "/start w_NOTAREALCODE", chat: DM, mustNot: /You're in|0x[a-fA-F0-9]{4}/, why: "a malformed onboarding code must not link anything" },
  { text: "/start w_ZZZZZZ", chat: DM, mustNot: /You're in|0x[a-fA-F0-9]{4}/, why: "an unminted onboarding code must not link anything" },
];

async function gateMoneyPaths() {
  section("④b Money paths refuse what they should");
  for (const c of ADVERSARIAL) {
    if (QUICK) continue;
    try {
      const d = await withRetry(() => botSay(c.text, c.chat, "spectrum"), c.text);
      const t = (d.reply || d.suggestion)?.text || "";
      if (!t) {
        fail(`adversarial ${c.text}`, "no reply at all");
        continue;
      }
      if (c.mustNot && c.mustNot.test(t)) {
        fail(`adversarial ${c.text}`, `${c.why} — but it proceeded: "${t.slice(0, 80).replace(/\n/g, " ")}"`);
        continue;
      }
      if (c.must && !c.must.test(t)) {
        fail(`adversarial ${c.text}`, `${c.why} — got: "${t.slice(0, 90).replace(/\n/g, " ")}"`);
        continue;
      }
      ok(`adversarial ${c.text} — ${c.why}`);
    } catch (e) {
      fail(`adversarial ${c.text}`, String(e.message || e));
    }
  }
}

// ── 4c. ONBOARDING IS WARM, SHORT AND TAPPABLE ───────────────────────────────
// A live review of the DM flow landed as "way too cold, way too unfriendly, no
// welcome image, too much text". Those are measurable, so they become assertions
// rather than taste: a first screen carries a picture, offers a tap instead of a
// list of slash commands to retype, stays under a length budget, and holds no em
// dash (a standing copy rule on every surface here).
const ONBOARDING = [
  { text: "/start", chat: DM, bot: "prism", why: "a stranger's first screen on the Prism bot" },
  { text: "/start", chat: DM, bot: "spectrum", why: "a stranger's first screen on the Spectrum bot" },
  { text: "/link", chat: DM, bot: "spectrum", why: "the connect-a-wallet screen" },
  { text: "/me", chat: DM, bot: "spectrum", why: "asking for a book with nothing linked" },
];
const ONBOARDING_MAX_CHARS = 340;

async function botTap(data, chat, whichRaw = "spectrum") {
  const which = effectiveBot(whichRaw);
  const body = {
    update_id: ++seq,
    callback_query: { id: `gate-${++seq}`, from: { id: ++seq, first_name: "Gate" }, message: { message_id: seq, chat }, data },
  };
  const secret = process.env[BOT_SECRET_ENV[which]];
  const r = await fetch(`${target()}${BOT_PATH[which]}?dry=1`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function gateOnboarding() {
  section("④c Onboarding stays warm, short and tappable");
  for (const c of ONBOARDING) {
    try {
      const d = await withRetry(() => botSay(c.text, c.chat, c.bot), `${c.bot} ${c.text}`);
      const r = d.reply || d.suggestion;
      if (!r?.text) {
        fail(`onboarding ${c.text}`, "no reply at all");
        continue;
      }
      const plain = r.text.replace(/<[^>]+>/g, "");
      if (!r.photoUrl) fail(`onboarding ${c.text}`, `${c.why} has no image, and a first screen needs one`);
      else if (!(r.buttons || []).flat().length) fail(`onboarding ${c.text}`, `${c.why} offers no tap, so the only way on is to type a command`);
      else if (plain.length > ONBOARDING_MAX_CHARS) fail(`onboarding ${c.text}`, `${c.why} runs ${plain.length} chars, over the ${ONBOARDING_MAX_CHARS} budget`);
      else if (plain.includes("—")) fail(`onboarding ${c.text}`, `${c.why} contains an em dash`);
      else ok(`onboarding ${c.bot} ${c.text} · image + tap + ${plain.length} chars`);
    } catch (e) {
      fail(`onboarding ${c.text}`, String(e.message || e));
    }
  }
  // the taps under a book must work in a DM and refuse in a group. A callback
  // carries no chat type of its own, so this is the only thing standing between
  // a group keyboard and a wallet read into the room.
  for (const data of ["p:me", "p:pnl", "p:shape", "p:alerts"]) {
    try {
      const inDm = await withRetry(() => botTap(data, DM, "spectrum"), `tap ${data}`);
      if (!(inDm.action?.reply?.text || "").length) fail(`tap ${data}`, "no reply in a DM");
      else ok(`tap ${data} answers in a DM`);
      const inGroup = await withRetry(() => botTap(data, GROUP, "spectrum"), `tap ${data} (group)`);
      if (inGroup.action?.reply) fail(`tap ${data}`, "answered in a GROUP, and a portfolio tap must refuse outside a DM");
      else ok(`tap ${data} refuses in a group`);
    } catch (e) {
      fail(`tap ${data}`, String(e.message || e));
    }
  }
}

// ── 4c-2. THE TWO BOTS STAY SEPARATE ─────────────────────────────────────────
// the designer's ruling (2026-08-07): the Prism bot is the community's ecosystem
// helper, and everything basket- or portfolio-shaped is the Spectrum suite's own
// bot. That partition is only real if it is enforced, so this drives both
// webhooks and asserts that each answers its own commands and points at the
// other for the rest. A regression here would silently merge two products back
// into one.
const PRISM_ONLY = ["/price", "/burn", "/supply", "/ca", "/links", "/lightrunner"];
const SPECTRUM_ONLY = ["/baskets", "/league", "/watchlist", "/token PEPE"];
const isPointer = (t) => /belongs to the|lives with the/.test(t);

async function gateBotSplit() {
  section("④c-2 The Prism bot and the Spectrum bot stay separate");
  if (!SPLIT_ARMED) {
    // Not a skipped check so much as a different truth: with no Spectrum bot
    // there is nothing to partition, and ④c-4 asserts that directly.
    ok("split dormant (SPECTRUM_BOT_TOKEN unset) — one bot owns everything, asserted by ④c-4");
    return;
  }
  const cases = [
    ...PRISM_ONLY.map((c) => ({ cmd: c, on: "prism", want: "own" })),
    ...PRISM_ONLY.map((c) => ({ cmd: c, on: "spectrum", want: "pointer" })),
    ...SPECTRUM_ONLY.map((c) => ({ cmd: c, on: "spectrum", want: "own" })),
    ...SPECTRUM_ONLY.map((c) => ({ cmd: c, on: "prism", want: "pointer" })),
  ];
  for (const c of cases) {
    if (QUICK) continue;
    try {
      const d = await withRetry(() => botSay(c.cmd, GROUP, c.on), `${c.on} ${c.cmd}`);
      const t = d.reply?.text || "";
      if (!t) {
        fail(`split ${c.on} ${c.cmd}`, "no reply at all");
        continue;
      }
      if (c.want === "pointer" && !isPointer(t)) fail(`split ${c.on} ${c.cmd}`, `should point at the other bot, but answered: "${t.slice(0, 80).replace(/\n/g, " ")}"`);
      else if (c.want === "own" && isPointer(t)) fail(`split ${c.on} ${c.cmd}`, "its own command was sent next door");
      else ok(`split ${c.on} ${c.cmd} ${c.want === "own" ? "answers" : "points next door"}`);
    } catch (e) {
      fail(`split ${c.on} ${c.cmd}`, String(e.message || e));
    }
  }
  // each bot's /help must describe only its own surface
  for (const [which, must, mustNot] of [
    ["prism", /Live eyes on the PRISM/, /Your book/],
    ["spectrum", /Baskets, your group/, /Live eyes on the PRISM ecosystem\./],
  ]) {
    if (QUICK) continue;
    try {
      const d = await withRetry(() => botSay("/help", GROUP, which), `${which} /help`);
      const t = d.reply?.text || "";
      if (!must.test(t)) fail(`split ${which} /help`, "does not describe its own surface");
      else if (mustNot.test(t)) fail(`split ${which} /help`, "advertises the other bot's surface as its own");
      else ok(`split ${which} /help lists only its own commands`);
    } catch (e) {
      fail(`split ${which} /help`, String(e.message || e));
    }
  }
}

// ── 4c-3. THE CREATE-PAGE HANDOFF MATCHES THE CONTRACT ───────────────────────
// The bot hands a composition to the Spectrum create page as URL params, and the
// two sides are different repos. Verified by hand once (following a real /split
// link into a running Composer, which is how the dropped-weights defect was
// found), so it becomes an assertion rather than a memory.
//
// The contract, per docs/SPECTRUM-INTEGRATION.md:
//   ?tokens=0x…,0x…   comma-separated, validated, all on one chain
//   &chain=eth|base   the Composer maps these names; a basket is single-chain
//   &weights=n,n      OPTIONAL, aligned to tokens, the agreed split
async function gateCreateHandoff() {
  section("④c-3 The create-page handoff matches the contract");
  if (QUICK) return;
  if (!process.env.SPECTRUM_CREATE_URL) {
    // Not a failure: unset is a legitimate deployment state, and the bot says so
    // rather than inventing a URL. But the gate must say it checked nothing.
    ok("create handoff not wired (SPECTRUM_CREATE_URL unset) — contract unverifiable, by design");
    return;
  }
  const cases = [
    { text: "/split 70 PEPE 30 MOG", weights: [70, 30], why: "an explicit split must survive the handoff" },
    { text: "/split 50 PEPE 30 MOG 20 UNI", weights: [50, 30, 20], why: "three legs keep their order and their values" },
  ];
  for (const c of cases) {
    try {
      const d = await withRetry(() => botSay(c.text, GROUP, "spectrum"), c.text);
      const urls = [...String(d.reply?.text || "").matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((m) => m[0])
        .concat((d.reply?.buttons || []).flat().map((b) => b.url).filter(Boolean));
      const create = urls.find((u) => u.includes("tokens="));
      if (!create) {
        fail(`handoff ${c.text}`, "no create URL emitted at all");
        continue;
      }
      const q = new URL(create).searchParams;
      const tokens = (q.get("tokens") || "").split(",").filter(Boolean);
      const chain = q.get("chain");
      const weights = (q.get("weights") || "").split(",").filter(Boolean).map(Number);
      if (!tokens.length || !tokens.every((t) => /^0x[a-fA-F0-9]{40}$/.test(t)))
        fail(`handoff ${c.text}`, `tokens= is not a list of addresses: ${q.get("tokens")}`);
      // The create page resolves chain names from its OWN chain table's keys, plus
      // a short alias list. Assert the canonical keys: the bot used to send "hood",
      // which is in neither, so the page silently kept whatever chain the visitor
      // was on — a wrong BASKET, not a wrong view. This gate asserted eth|base and
      // so would have failed the correct value for the one chain baskets live on.
      else if (!["ethereum", "base", "robinhood"].includes(String(chain)))
        fail(`handoff ${c.text}`, `chain=${chain} is not a key the create page resolves (ethereum|base|robinhood)`);
      else if (!weights.length)
        fail(`handoff ${c.text}`, `${c.why}, but no weights= was sent, so the create page will reset it to equal weight`);
      else if (weights.length !== tokens.length)
        fail(`handoff ${c.text}`, `${weights.length} weights for ${tokens.length} tokens: the split would land on the wrong asset`);
      else if (weights.join(",") !== c.weights.join(","))
        fail(`handoff ${c.text}`, `sent ${weights.join("/")}, expected ${c.weights.join("/")}`);
      else ok(`handoff ${c.text} · ${tokens.length} tokens on ${chain}, split ${weights.join("/")} intact`);
    } catch (e) {
      fail(`handoff ${c.text}`, String(e.message || e));
    }
  }
}

// ── 4c-4. THE SPLIT IS DORMANT UNTIL THE SPECTRUM BOT IS ARMED ───────────────
// the designer, 2026-08-07: the Spectrum bot stays private until we are ready to ship it,
// and must not go out with the next Spectrum update. The code ships regardless
// (same tree), so the guarantee has to be behavioural: with SPECTRUM_BOT_TOKEN
// unset, the live bot behaves exactly as the single bot did, and NOTHING anywhere
// names a Spectrum bot. Two things would break that, and both are asserted:
// advertising an unshipped product, and turning working commands into pointers
// at a bot that does not exist.
const LEAKS_SPECTRUM_BOT = /Spectrum Bot|spectrum_tgbot|lives with the|isn't running yet/i;

async function gateSplitDormancy() {
  section("④c-4 The split stays dormant until the Spectrum bot is armed");
  if (QUICK) return;
  const armed = Boolean(process.env.SPECTRUM_BOT_TOKEN);
  // These answer on the live single bot today. Dormant, they must keep answering.
  const shouldAnswer = ["/baskets", "/league", "/ourbasket", "/watchlist"];
  for (const cmd of shouldAnswer) {
    try {
      const d = await withRetry(() => botSay(cmd, GROUP, "prism"), `prism ${cmd}`);
      const t = d.reply?.text || "";
      if (!t) {
        fail(`dormancy ${cmd}`, "no reply at all");
        continue;
      }
      if (armed) {
        // armed is the partitioned world, which gate ④c-2 already covers
        ok(`dormancy ${cmd} (armed: partition active, checked by ④c-2)`);
      } else if (LEAKS_SPECTRUM_BOT.test(t)) {
        fail(`dormancy ${cmd}`, `names an unshipped bot while dormant: "${t.slice(0, 90).replace(/\n/g, " ")}"`);
      } else {
        ok(`dormancy ${cmd} answers on the one bot, names no other`);
      }
    } catch (e) {
      fail(`dormancy ${cmd}`, String(e.message || e));
    }
  }
  // /help is the worst place to leak, because everyone reads it
  try {
    const d = await withRetry(() => botSay("/help", GROUP, "prism"), "prism /help");
    const t = d.reply?.text || "";
    if (armed) ok("dormancy /help (armed: per-bot menus, checked by ④c-2)");
    else if (LEAKS_SPECTRUM_BOT.test(t)) fail("dormancy /help", "the menu advertises a bot that is not shipped");
    else if (!/\/baskets/.test(t) || !/\/me/.test(t)) fail("dormancy /help", "dormant menu is missing commands the one bot can actually run");
    else ok("dormancy /help lists the full menu, names no other bot");
  } catch (e) {
    fail("dormancy /help", String(e.message || e));
  }
}

// ── 4c-5. THE CLAIM NUDGE STAYS RESTRAINED ───────────────────────────────────
// Claimable fees are a STANDING BALANCE, not an event: once "over the floor" is
// true it is true forever, so the naive rule taps the user on the shoulder every
// sweep until they claim out of irritation. The nudge fires on CROSSINGS and
// remembers the level it fired at. That rule is pure and it is the entire design,
// so it is asserted rather than assumed.
async function gateClaimNudge() {
  section("④c-5 The claim nudge fires on crossings, not on a standing balance");
  if (QUICK) return;
  try {
    const r = await get("/api/dev/alertrule", 30_000);
    if (r.status === 404) {
      ok("claim-nudge rule not exposed in production (dev-only), skipped");
      return;
    }
    if (!r.ok) {
      fail("claim nudge", `HTTP ${r.status}`);
      return;
    }
    const d = await r.json();
    const props = [
      ["firesOnFloorCrossing", "it must speak when the balance first crosses the floor"],
      ["quietWhileMerelyGrowing", "it must NOT speak again just because the balance grew a little"],
      ["firesOnHalfAgain", "it must speak once the balance is half again past the last nudge"],
      ["quietUnderFloor", "it must never speak about dust"],
      ["firesAgainAfterAClaim", "after a claim it must be willing to speak again"],
    ];
    for (const [k, why] of props) {
      if (d[k] === true) ok(`claim nudge · ${why}`);
      else fail("claim nudge", `${why} — but the rule did not`);
    }
    if (d.fired >= d.naive) fail("claim nudge", `sent ${d.fired} where a naive over-the-floor rule sends ${d.naive}: the restraint is gone`);
    else ok(`claim nudge · ${d.fired} interruptions where a naive rule would send ${d.naive}`);
  } catch (e) {
    fail("claim nudge", String(e.message || e));
  }
}

// ── 4d. THE DEV PLAYGROUND IS DEV-ONLY ───────────────────────────────────────
// /dev/telegram drives the real handlers with no webhook secret, which is
// exactly right on a laptop and unacceptable in production. This asserts
// whichever is true of the build under test, so both are covered.
async function gateDevSurfaces() {
  section("④d The playground and seam map are dev-only");
  let devMode = false;
  try {
    const r = await get("/api/dev/seams", 20_000);
    devMode = r.status === 200;
    if (devMode) {
      const d = await r.json();
      const ids = (d.seams || []).map((s) => s.id);
      for (const need of ["handoff", "link", "attribution"]) {
        if (!ids.includes(need)) fail("seam map", `seam "${need}" is missing from /api/dev/seams`);
        else ok(`seam map lists ${need}`);
      }
      const unstated = (d.seams || []).filter((s) => !s.status?.state);
      if (unstated.length) fail("seam map", `${unstated.length} seam(s) report no wiring state, so the panel cannot say wired or not`);
      else ok("every seam reports its wiring state");
    } else if (r.status === 404) {
      ok("seam map is absent in production");
    } else {
      fail("seam map", `HTTP ${r.status}, expected 200 in dev or 404 in production`);
    }
  } catch (e) {
    fail("seam map", String(e.message || e));
  }
  // the simulator backend is the one that must never be reachable in production
  try {
    const r = await fetch(`${target()}/api/dev/tg-sim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "message", chatId: -1, chatType: "supergroup", user: { id: 1, first_name: "Gate" }, text: "/help" }),
      signal: AbortSignal.timeout(60_000),
    });
    if (devMode && r.status === 200) ok("simulator answers in dev");
    else if (!devMode && r.status === 404) ok("simulator is absent in production");
    else fail("simulator", `HTTP ${r.status} with devMode=${devMode}. A handler-driving route must 404 in production.`);
  } catch (e) {
    fail("simulator", String(e.message || e));
  }
  try {
    const r = await get("/dev/telegram", 30_000);
    if (devMode && r.status === 200) ok("playground page answers in dev");
    else if (!devMode && r.status === 404) ok("playground page is absent in production");
    else fail("playground page", `HTTP ${r.status} with devMode=${devMode}`);
  } catch (e) {
    fail("playground page", String(e.message || e));
  }
}

// ── 5. the numbers people trade on are legible ───────────────────────────────
async function gateNumbers() {
  if (QUICK) return;
  section("⑤ Money reads correctly");
  try {
    const d = await botSay("/token PEPE", GROUP, "spectrum");
    const t = d.reply?.text || "";
    const m = t.match(/Price:\s*<b>([^<]+)<\/b>/);
    if (!m) fail("micro-cap price", "no price line in /token output");
    else if (/^\$0\.00$/.test(m[1].trim())) fail("micro-cap price", `rendered ${m[1]} — a sub-cent token must keep significant digits`);
    else ok(`micro-cap price legible (${m[1].trim()})`);
  } catch (e) {
    fail("micro-cap price", String(e.message || e));
  }

  // Robinhood is where every live basket actually is (SpectrumContracts measured
  // 21 of 21 there, none on Base or Ethereum), and the bot could not resolve a
  // token on it at all until 2026-08-07. A regression here is invisible on the
  // two chains that have no baskets, so assert the one that does.
  if (QUICK) return;
  try {
    const d = await withRetry(() => botSay("/token CASHCAT", GROUP, "spectrum"), "/token CASHCAT");
    const t = String(d.reply?.text || "");
    if (/Couldn't find/i.test(t)) fail("robinhood token resolves", "CASHCAT is a live Robinhood token and the bot said it could not find it");
    else if (!/robinhood/i.test(t)) fail("robinhood token resolves", `resolved, but not to Robinhood: "${t.slice(0, 110).replace(/\n/g, " ")}"`);
    else ok("robinhood token resolves · the chain every live basket is on");
  } catch (e) {
    fail("robinhood token resolves", String(e.message || e));
  }
}

// ── run ──────────────────────────────────────────────────────────────────────
console.log(`🔍 Surface gate → ${target()}${QUICK ? " (quick)" : ""}${LIVE ? " (LIVE deployment)" : ""}\n`);
try {
  await get("/", 15_000);
} catch {
  console.error(`✖ nothing is serving ${target()}\n  start it (npm run dev), pass --base <url>, or use --live`);
  process.exit(1);
}

await gateHealth();
await gateCards();
if (LIVE) {
  // Deployment drift is what --live exists to find, and pages + cards find it.
  // Everything below drives the webhook, which needs that deployment's own
  // secret, so on someone else's instance it can only ever report 401/404.
  section("③–⑤ Command checks skipped on --live");
  ok("skipped: driving the bot needs the deployment's own webhook secret");
  ok("skipped: /api/dev/tg-sim is 404 in production, by design");
  console.log("\n   For handler behaviour run the gate locally. --live answers a different\n   question: is the deployment users are hitting actually current?");
} else {
  const urls = await gateCommands();
  await gateLinks(urls);
  await gateMoneyPaths();
  await gateOnboarding();
  await gateBotSplit();
  await gateCreateHandoff();
  await gateSplitDormancy();
  await gateClaimNudge();
  await gateDevSurfaces();
  await gateNumbers();
}

console.log(`\n${"─".repeat(52)}`);
if (failures.length) {
  console.log(`❌ ${failures.length} failed · ${pass} passed\n`);
  for (const f of failures) console.log(`  · ${f.name}: ${f.detail}`);
  process.exit(1);
}
console.log(`✅ all ${pass} checks passed`);
