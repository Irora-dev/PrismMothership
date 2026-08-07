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

const args = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] ?? true : d;
};
const BASE = (flag("--base") || process.env.VERIFY_BASE || "http://localhost:3588").replace(/\/$/, "");
const QUICK = args.includes("--quick");

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

const get = async (path, ms = 60_000) => {
  const r = await fetch(path.startsWith("http") ? path : `${BASE}${path}`, { signal: AbortSignal.timeout(ms), redirect: "manual" });
  return r;
};

// ── 1. the app answers at all ────────────────────────────────────────────────
async function gateHealth() {
  section("① Surfaces respond");
  for (const p of ["/", "/command", "/claim", "/spectrum", "/radio", "/trade", "/how-it-works", "/burn", "/dev", "/contracts"]) {
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
      const buf = await renderCard(c.kind);
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
];
const COMMANDS = [
  ["/help", GROUP],
  ["/price", GROUP],
  ["/burn", GROUP],
  ["/bigburn", GROUP],
  ["/prism", GROUP],
  ["/supply", GROUP],
  ["/baskets", GROUP],
  ["/leaderboard", GROUP],
  ["/ca", GROUP],
  ["/links", GROUP],
  ["/lightrunner", GROUP],
  ["/portfolio", GROUP],
  ["/league", GROUP],
  ["/watchlist", GROUP],
  ["/token PEPE", GROUP, { slow: true }],
  ["/split 60 PEPE 40 MOG", GROUP, { slow: true }],
  ["/link", DM],
  ["/me", DM],
  ["/reweight", DM],
  ["/pnl", DM],
  ["/alerts", DM],
  ["/buy PEPE 100", GROUP, { slow: true }],
  ["/pnl", GROUP, { expect: "private message" }],
  ["/link", GROUP, { expect: "private message" }], // DM-only must refuse in groups
];

let seq = 70000;
async function botSay(text, chat) {
  const body = {
    update_id: ++seq,
    message: { message_id: seq, date: Math.floor(Date.now() / 1000), chat, from: { id: ++seq, first_name: "Gate" }, text },
  };
  const r = await fetch(`${BASE}/api/telegram/webhook?dry=1`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(process.env.TELEGRAM_WEBHOOK_SECRET ? { "x-telegram-bot-api-secret-token": process.env.TELEGRAM_WEBHOOK_SECRET } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (r.status === 401) throw new Error("401 — set TELEGRAM_WEBHOOK_SECRET in the env running this gate");
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
      const d = await botSay(text, chat);
      const reply = d.reply || d.suggestion;
      if (!reply || !reply.text?.trim()) {
        fail(`cmd ${text}`, "no reply");
        continue;
      }
      if (opts.expect && !reply.text.toLowerCase().includes(opts.expect.toLowerCase())) {
        fail(`cmd ${text}`, `expected to mention "${opts.expect}"`);
        continue;
      }
      const bad = BAD_MARKERS.find(([re]) => re.test(reply.text));
      if (bad && !opts.expect) {
        fail(`cmd ${text}`, `${bad[1]} → "${reply.text.slice(0, 90).replace(/\n/g, " ")}"`);
        continue;
      }
      for (const u of urlsIn(reply.text)) seenUrls.add(u);
      if (reply.photoUrl) seenUrls.add(reply.photoUrl);
      ok(`cmd ${text}${reply.photoUrl ? " (+card)" : ""}`);
    } catch (e) {
      fail(`cmd ${text}`, String(e.message || e));
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
  for (const u of [...urls].slice(0, 40)) {
    let host = "";
    try {
      host = new URL(u).host;
    } catch {
      fail("malformed link", u);
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

// ── 5. the numbers people trade on are legible ───────────────────────────────
async function gateNumbers() {
  if (QUICK) return;
  section("⑤ Money reads correctly");
  try {
    const d = await botSay("/token PEPE", GROUP);
    const t = d.reply?.text || "";
    const m = t.match(/Price:\s*<b>([^<]+)<\/b>/);
    if (!m) fail("micro-cap price", "no price line in /token output");
    else if (/^\$0\.00$/.test(m[1].trim())) fail("micro-cap price", `rendered ${m[1]} — a sub-cent token must keep significant digits`);
    else ok(`micro-cap price legible (${m[1].trim()})`);
  } catch (e) {
    fail("micro-cap price", String(e.message || e));
  }
}

// ── run ──────────────────────────────────────────────────────────────────────
console.log(`🔍 Surface gate → ${BASE}${QUICK ? " (quick)" : ""}\n`);
try {
  await get("/", 15_000);
} catch {
  console.error(`✖ nothing is serving ${BASE}\n  start it (npm run dev) or pass --base <url>`);
  process.exit(1);
}

await gateHealth();
await gateCards();
const urls = await gateCommands();
await gateLinks(urls);
await gateNumbers();

console.log(`\n${"─".repeat(52)}`);
if (failures.length) {
  console.log(`❌ ${failures.length} failed · ${pass} passed\n`);
  for (const f of failures) console.log(`  · ${f.name}: ${f.detail}`);
  process.exit(1);
}
console.log(`✅ all ${pass} checks passed`);
