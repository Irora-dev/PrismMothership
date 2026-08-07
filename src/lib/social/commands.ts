// Incoming-command handler for @SpectraPrismBot. Given a Telegram update, parse
// the command (or a bare @-mention) and build a reply from the LIVE on-chain data
// layer — no funds, no signing, read-only. The webhook route (/api/telegram/
// webhook) receives updates and sends whatever this returns.
//
// Commands: /start · /help · /baskets · /basket <ticker|address> · /burn · /prism
// A plain "@SpectraPrismBot ..." (no slash) falls back to the intro, so questions
// like "what do you do?" get a useful answer.

import { getProvider, getBaseProvider, fetchLiveStats, fetchHistory } from "@/lib/chain/live";
import { getIndexData, listIndexes } from "@/lib/spectrum/index-data";
import { fmtUsdFull, fmtEth, fmtPrism } from "@/lib/feed/format";
import { detectTickers, type TickerTally } from "./group-signal";
import { observe, recentTickers } from "./group-store";
import { validateTickers, validateTicker, resolveToken, dexUrl, type TokenMatch } from "./token-validate";
import { getDraft, proposeToken, dropToken, voteToken, clearDraft, draftChain, type Draft } from "./group-draft";

const MIN_BASKET_TOKENS = 2;
const MAX_BASKET_TOKENS = 8; // operator composer max
const MIN_LIQUIDITY_USD = 2_500; // floor so tokens don't drop out of the app's routable-pool check

const chainLabel = (c: "ethereum" | "base" | "robinhood") => (c === "base" ? "Base" : c === "robinhood" ? "Robinhood Chain" : "Ethereum");
const chainParam = (c: "ethereum" | "base" | "robinhood") => (c === "base" ? "base" : c === "robinhood" ? "hood" : "eth");

const BOT_USERNAME = "SpectraPrismBot";

function siteUrl(): string {
  return (process.env.URL || process.env.NEXT_PUBLIC_SITE_URL || "https://prismbeat.netlify.app").replace(/\/$/, "");
}

// Group-basket features (chat→basket, /createbasket, suggestions) are built but
// DARK — gated off until this flag is set. Read-only Q&A below is always live.
// the branded live stat card for a command (api/card renders it) — cache-busted
// hourly so Telegram's photo cache doesn't pin stale numbers all day
function cardUrl(kind: string): string {
  return `${siteUrl()}/api/card?kind=${kind}&t=${Math.floor(Date.now() / 3_600_000)}`;
}

function groupFeaturesEnabled(): boolean {
  return process.env.GROUP_FEATURES_ENABLED === "1" || process.env.GROUP_FEATURES_ENABLED === "true";
}
function comingSoonText(): string {
  return [
    "🧺 <b>/createbasket</b> — coming soon.",
    "",
    "Turn the tickers your group actually talks about into a live basket: one token, the whole thesis, every trade feeding the PRISM burn. 👀",
    siteUrl(),
  ].join("\n");
}

// escape user/dynamic text for Telegram HTML parse mode
function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function pct(n: number | null | undefined, d = 1): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`;
}

interface TgChat {
  id: number | string;
  type?: string;
}
interface TgMessage {
  message_id: number;
  text?: string;
  date?: number; // unix seconds — drop stale/backlogged updates
  from?: { id?: number; first_name?: string; username?: string }; // rate limiting + proposer attribution
  chat: TgChat;
}
interface TgChatMemberUpdate {
  chat: TgChat;
  new_chat_member?: { status?: string };
  old_chat_member?: { status?: string };
}
interface TgUpdate {
  message?: TgMessage;
  edited_message?: TgMessage;
  my_chat_member?: TgChatMemberUpdate;
}

export interface TgReply {
  chatId: number | string;
  text: string;
  parseMode: "HTML";
  disablePreview: boolean;
  replyTo?: number;
  /** live stat-card image (api/card) — sent as a photo with the text as caption */
  photoUrl?: string;
}

// ── Anti-spam (first layer) ───────────────────────────────────────────────────
// Per-user sliding window + a stale-update guard. In-memory → on serverless it's
// per-instance (a first layer, not a hard guarantee); a shared-store limiter
// (Netlify Blobs) is the robust upgrade. Read-only commands keep the blast radius
// small — replies are cached public data, no writes, no funds.
const RL_WINDOW_MS = 30_000;
const RL_MAX = 6; // commands per user per window; over this we go silent
const MAX_AGE_S = 150; // ignore updates older than this (backlog floods / retries)
const rlHits = new Map<number, number[]>();
function rateLimited(userId?: number): boolean {
  if (!userId) return false;
  const now = Date.now();
  const recent = (rlHits.get(userId) || []).filter((t) => now - t < RL_WINDOW_MS);
  recent.push(now);
  rlHits.set(userId, recent);
  if (rlHits.size > 5000) {
    for (const [k, v] of rlHits) if (v.every((t) => now - t >= RL_WINDOW_MS)) rlHits.delete(k);
  }
  return recent.length > RL_MAX;
}

async function liveStats() {
  const eth = getProvider();
  if (!eth) return null;
  try {
    return await fetchLiveStats(eth, getBaseProvider());
  } catch {
    return null;
  }
}

// /ca — the one thing every group asks for. The address renders as <code> so a
// tap copies it; the pool link doubles as proof it's the real one.
function caText(): string {
  return [
    "🔻 <b>PRISM contract</b> (Ethereum)",
    "",
    "<code>0xCf4d29f14Cc585DDd1167F956092852AF844e040</code>",
    "",
    "Tap the address to copy. Verify it yourself:",
    "https://etherscan.io/token/0xCf4d29f14Cc585DDd1167F956092852AF844e040",
  ].join("\n");
}

function linksText(): string {
  return ["🔻 <b>PRISM — official links</b>", "", "https://linktr.ee/prism_lp"].join("\n");
}

async function priceText(): Promise<string> {
  const s = await liveStats();
  if (!s) return "Couldn't reach the chain just now. Give it a sec and try again. 🔧";
  const mcap = (s.prismUsd ?? 0) > 0 ? (s.prismUsd ?? 0) * s.supply : 0;
  return [
    "💠 <b>PRISM price</b>",
    "",
    `· Price: <b>${esc(fmtUsdFull(s.prismUsd ?? 0))}</b>`,
    mcap ? `· Market cap: ${esc(fmtUsdFull(mcap))} (${esc(fmtPrism(s.supply))} circulating)` : "",
    `· Fees to holders, 24h: ${esc(fmtUsdFull(s.feesToHolders24h * s.ethUsd))}`,
    `· Burned forever: ${esc(fmtPrism(s.totalBurned))}`,
    "",
    `${siteUrl()}/trade`,
  ].filter(Boolean).join("\n");
}

async function supplyText(): Promise<string> {
  const s = await liveStats();
  if (!s) return "Couldn't reach the chain just now. Give it a sec and try again. 🔧";
  const pct = s.cap > 0 ? (s.totalBurned / s.cap) * 100 : 0;
  const filled = Math.round(Math.min(100, pct) / 5);
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);
  return [
    "🔥 <b>PRISM supply</b>",
    "",
    `· Cap: ${esc(fmtPrism(s.cap))} — fixed, minted once`,
    `· Burned forever: <b>${esc(fmtPrism(s.totalBurned))}</b> (${pct.toFixed(2)}%)`,
    `· Circulating: ${esc(fmtPrism(s.supply))}`,
    "",
    `<code>${bar}</code>`,
    "Supply only ever shrinks.",
    `${siteUrl()}/burn`,
  ].join("\n");
}

// lifetime fees accrued per whole PRISM held since day one — the honest flex
async function earnedText(): Promise<string> {
  try {
    const r = await fetch(`${siteUrl()}/api/prism/overview`, { cache: "no-store" });
    const d = (await r.json()) as { perPrism?: { lifetimeETH: string; lifetimePRISM: string } };
    const s = await liveStats();
    if (!d.perPrism || !s) throw new Error("no data");
    const eth = Number(d.perPrism.lifetimeETH) / 1e18;
    const prism = Number(d.perPrism.lifetimePRISM) / 1e18;
    const usd = eth * s.ethUsd + prism * (s.prismUsd || 0);
    return [
      "💎 <b>Earned per Prism</b>",
      "",
      `One whole PRISM held since day one has accrued <b>${esc(fmtUsdFull(usd))}</b> in fees`,
      `(Ξ${esc(fmtEth(eth))} + ${esc(fmtPrism(prism))} PRISM).`,
      "",
      "Varies with trading, can be zero — not a promise.",
      `${siteUrl()}/claim`,
    ].join("\n");
  } catch {
    return "Couldn't read the accumulator just now. Try again in a minute. 🔧";
  }
}

async function quoteText(args: string): Promise<string> {
  const amt = parseFloat(args);
  if (!Number.isFinite(amt) || amt <= 0 || amt > 10_000) return "Usage: <code>/quote 0.5</code> — ETH amount to price.";
  try {
    const r = await fetch(`${siteUrl()}/api/trade/quote?dir=buy&in=${encodeURIComponent(String(amt))}`, { cache: "no-store" });
    if (!r.ok) throw new Error("quote failed");
    const d = (await r.json()) as { amountOut: string; ethUsd: number };
    return [
      "🔁 <b>Live quote</b>",
      "",
      `Ξ${esc(String(amt))} → <b>${esc(fmtPrism(Number(d.amountOut)))} PRISM</b>`,
      d.ethUsd ? `(${esc(fmtUsdFull(amt * d.ethUsd))} in)` : "",
      "",
      "1% pool fee streams to holders — including you, after this buy.",
      `${siteUrl()}/trade`,
    ].filter(Boolean).join("\n");
  } catch {
    return "Couldn't fetch a quote just now. Try again in a minute. 🔧";
  }
}

async function walletText(args: string): Promise<string> {
  const addr = (args || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) return "Usage: <code>/wallet 0x…</code> — a full Ethereum address.";
  try {
    const r = await fetch(`${siteUrl()}/api/prism/wallet/${addr}`, { cache: "no-store" });
    if (!r.ok) throw new Error("wallet failed");
    const d = (await r.json()) as { balance?: number; nfts?: number; pendingETH?: number; pendingPRISM?: number };
    const s = await liveStats();
    const pendUsd = s ? (d.pendingETH ?? 0) * s.ethUsd + (d.pendingPRISM ?? 0) * (s.prismUsd || 0) : 0;
    return [
      "👛 <b>Wallet</b> <code>" + esc(addr.slice(0, 6) + "…" + addr.slice(-4)) + "</code>",
      "",
      `· PRISM: <b>${esc(fmtPrism(d.balance ?? 0))}</b> · fee-share NFTs: ${d.nfts ?? 0}`,
      `· Claimable: Ξ${esc(fmtEth(d.pendingETH ?? 0))} + ${esc(fmtPrism(d.pendingPRISM ?? 0))} PRISM${pendUsd ? ` (≈${esc(fmtUsdFull(pendUsd))})` : ""}`,
      "",
      `${siteUrl()}/claim`,
    ].join("\n");
  } catch {
    return "Couldn't read that wallet just now. Try again in a minute. 🔧";
  }
}

// ── Spectrum Portfolio — the batcher is BUILT AND AUDITED but not deployed
// (awaiting the ceremony). Until the contracts exist this answers honestly and
// promises nothing; the LIVE branch below is the auto-light seam — it arms the
// moment PORTFOLIO_BATCHER_ADDRESS is set (the batcher address arrives with the
// post-ceremony event book), and the stats wiring lands with those contracts.
function portfolioLive(): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(process.env.PORTFOLIO_BATCHER_ADDRESS || "");
}
async function portfolioText(): Promise<string> {
  if (!portfolioLive()) {
    return [
      "📦 <b>Spectrum Portfolio</b> — launching soon",
      "",
      "A whole portfolio in one buy: batched execution across baskets and tokens, with a flat buy fee that buys and burns PRISM.",
      "",
      "Built and audited — volume, fees and unique users appear here the moment it is on-chain. 👀",
      `${siteUrl()}/spectrum#portfolio`,
    ].join("\n");
  }
  // LIVE branch: filled in when the batcher contracts + event book land.
  return [
    "📦 <b>Spectrum Portfolio</b>",
    "",
    "The batcher is on-chain — stats ingestion is being wired. Check the berth:",
    `${siteUrl()}/spectrum#portfolio`,
  ].join("\n");
}

function lightrunnerText(): string {
  return [
    "🌒 <b>Lightrunner</b>",
    "",
    "An onchain roguelike bullet hell built on Prism. Weekly leagues — run the dark, score high, win from the league pot.",
    "",
    "https://playlightrunner.com",
    "League stats land here once the analytics are live. 👀",
  ].join("\n");
}

function helpText(): string {
  return [
    "🔻 <b>Spectra · The Prism Bot</b>",
    "Your live line to Spectrum baskets and the PRISM buy &amp; burn.",
    "",
    "<b>Commands</b>",
    "/baskets · every live basket",
    "/leaderboard · baskets ranked by 24h performance",
    "/basket &lt;ticker&gt; · one basket's holdings &amp; stats",
    "/burn · PRISM burned (today / week / all-time)",
    "/bigburn · how close the next big burn is",
    "/prism · PRISM revenue &amp; burn stats",
    "/price · PRISM price &amp; market cap",
    "/supply · cap, burned, burn progress",
    "/earned · lifetime fees per whole PRISM",
    "/quote &lt;eth&gt; · live buy quote",
    "/wallet &lt;0x…&gt; · holdings &amp; claimable fees",
    "/portfolio · Spectrum Portfolio stats",
    "/lightrunner · the onchain roguelike",
    "/ca · the PRISM contract address",
    "/links · every official link",
    "",
    "Or just @mention me a question — \"how many baskets are live?\", \"how much PRISM burned this week?\", \"how close to a big burn?\"",
    "",
    "Trading &amp; launching straight from here is coming. 👀",
    siteUrl(),
  ].join("\n");
}

// PRISM burned in the last 24h and 7d, summed from on-chain burn events (cached).
async function burnWindows(): Promise<{ today: number; week: number } | null> {
  const eth = getProvider();
  if (!eth) return null;
  try {
    const burns = await fetchHistory("burn", eth, getBaseProvider());
    const now = Date.now();
    let today = 0;
    let week = 0;
    for (const e of burns) {
      const p = e.prism || 0;
      if (e.ts >= now - 7 * 86_400_000) week += p;
      if (e.ts >= now - 86_400_000) today += p;
    }
    return { today, week };
  } catch {
    return null;
  }
}

async function burnText(): Promise<string> {
  const s = await liveStats();
  if (!s) return "Couldn't reach the chain just now. Give it a sec and try again. 🔧";
  const w = await burnWindows();
  const burnedPct = s.cap > 0 ? (s.totalBurned / s.cap) * 100 : 0;
  const lines = [
    "🔥 <b>PRISM Buy &amp; Burn</b>",
    "",
    `Burned all-time: <b>${esc(fmtPrism(s.totalBurned))} PRISM</b> (${burnedPct.toFixed(1)}% of the ${esc(fmtPrism(s.cap))} cap)`,
    `Circulating: ${esc(fmtPrism(s.supply))} PRISM`,
  ];
  if (w) lines.push(`Today: ${esc(fmtPrism(w.today))} PRISM · this week: ${esc(fmtPrism(w.week))} PRISM`);
  else lines.push(`Last 24h: ${esc(fmtPrism(s.prismBurnedToday))} PRISM over ${s.burnsToday} burns`);
  if (s.bridgePendingEth > 0) lines.push(`Next big burn: Ξ${esc(fmtEth(s.bridgePendingEth))} pooling on the bridge to buy &amp; burn.`);
  lines.push("", "Every basket fee and launch auction buys PRISM back and destroys it. Supply only ever shrinks.", `${siteUrl()}/spectrum`);
  return lines.join("\n");
}

// "How close are we to a big burn?" — the bridged Base fees pooling toward the
// next batched buy-and-burn, plus when it unlocks.
async function bigBurnText(): Promise<string> {
  const s = await liveStats();
  if (!s) return "Couldn't reach the chain just now. Give it a sec and try again. 🔧";
  const lines = ["🔥 <b>Next big burn</b>", ""];
  if (s.bridgePendingEth > 0) lines.push(`Ξ${esc(fmtEth(s.bridgePendingEth))} of Base fees is pooling on the 7-day bridge, waiting to buy &amp; burn PRISM.`);
  else lines.push("Nothing pooled on the bridge right now — burns are landing as fees come in.");
  if (typeof s.bridgeNextBurnTs === "number" && s.bridgeNextBurnTs > 0) {
    const ms = s.bridgeNextBurnTs < 1e12 ? s.bridgeNextBurnTs * 1000 : s.bridgeNextBurnTs;
    const hrs = (ms - Date.now()) / 3_600_000;
    if (hrs > 0) lines.push(`Next bridged burn unlocks in ${hrs < 1 ? "under an hour" : `~${Math.round(hrs)}h`}.`);
  }
  lines.push("", `${siteUrl()}/spectrum`);
  return lines.join("\n");
}

async function prismText(): Promise<string> {
  const s = await liveStats();
  if (!s) return "Couldn't reach the chain just now. Give it a sec and try again. 🔧";
  const usd = (eth: number) => (s.ethUsd > 0 ? `${fmtUsdFull(eth * s.ethUsd)} ` : "");
  return [
    "💠 <b>PRISM</b>",
    "",
    "<b>Revenue to holders</b>",
    `· 24h: ${esc(usd(s.feesToHolders24h))}(Ξ${esc(fmtEth(s.feesToHolders24h))})`,
    `· 7d: ${esc(usd(s.feesToHolders7d))}(Ξ${esc(fmtEth(s.feesToHolders7d))})`,
    `· all-time: ${esc(usd(s.feesToHoldersTotal))}(Ξ${esc(fmtEth(s.feesToHoldersTotal))})`,
    "",
    `Supply: ${esc(fmtPrism(s.supply))} / ${esc(fmtPrism(s.cap))} cap · Burned: ${esc(fmtPrism(s.totalBurned))}`,
    `${s.indexCount} live baskets feeding the burn.`,
    `${siteUrl()}/spectrum`,
  ].join("\n");
}

async function basketsText(): Promise<string> {
  let list;
  try {
    list = await listIndexes();
  } catch {
    return "Couldn't load the baskets just now. Give it a sec and try again. 🔧";
  }
  if (!list.length) return "No live baskets yet. 🧺";
  const rows = [...list]
    .sort((a, b) => (b.aumUsd || 0) - (a.aumUsd || 0))
    .slice(0, 12)
    .map((b) => `<b>${esc(b.symbol)}</b> · ${esc(fmtUsdFull(b.aumUsd))} · ${b.basketLength} tokens`);
  const more = list.length > 12 ? `\n…and ${list.length - 12} more` : "";
  return [
    "🧺 <b>Live Spectrum baskets</b>",
    "",
    ...rows,
    more,
    "",
    "Any one: <code>/basket TICKER</code>",
    `${siteUrl()}/baskets`,
  ].join("\n");
}

async function basketText(arg: string): Promise<string> {
  const q = arg.trim().replace(/^\$/, "");
  if (!q) return "Usage: <code>/basket TICKER</code> (or a basket address). See them all with /baskets.";

  // resolve ticker → address (or accept an address directly)
  let address = /^0x[a-fA-F0-9]{40}$/.test(q) ? q : "";
  if (!address) {
    try {
      const list = await listIndexes();
      const hit = list.find((b) => b.symbol?.toLowerCase() === q.toLowerCase());
      if (!hit) return `Couldn't find <b>${esc(q)}</b>. See every live basket with /baskets.`;
      address = hit.address;
    } catch {
      return "Couldn't look that up just now. Give it a sec and try again. 🔧";
    }
  }

  let d;
  try {
    d = await getIndexData(address);
  } catch {
    return `Couldn't load that basket. See every live basket with /baskets.`;
  }

  const holds = [...d.holdings]
    .sort((a, b) => (b.liveWeightPct || b.targetWeightPct || 0) - (a.liveWeightPct || a.targetWeightPct || 0))
    .slice(0, 8)
    .map((h) => `${esc(h.symbol)} · ${(h.liveWeightPct || h.targetWeightPct || 0).toFixed(1)}%`);
  const moreH = d.holdings.length > 8 ? `\n+${d.holdings.length - 8} more` : "";

  return [
    `🧺 <b>${esc(d.symbol)}</b> · ${esc(d.name)}`,
    "",
    `AUM: ${esc(fmtUsdFull(d.aumUsd))}`,
    `24h: ${pct(d.change24hPct)}`,
    `${d.totalCount} tokens (${d.pricedCount} priced)`,
    "",
    "<b>Top holdings</b>",
    ...holds,
    moreH,
    "",
    `${siteUrl()}/baskets/${d.address}`,
  ].join("\n");
}

// Baskets ranked by 24h performance — an engagement/leaderboard surface. Cheap:
// listIndexes() already carries symbol, AUM, and 24h change.
async function leaderboardText(): Promise<string> {
  let list;
  try {
    list = await listIndexes();
  } catch {
    return "Couldn't load the leaderboard just now. Give it a sec and try again. 🔧";
  }
  if (!list.length) return "No live baskets yet. 🧺";
  const ranked = list.filter((b) => b.change24hPct != null).sort((a, b) => (b.change24hPct ?? 0) - (a.change24hPct ?? 0));
  if (!ranked.length) {
    // no 24h history yet — fall back to an AUM ranking
    const byAum = [...list].sort((a, b) => (b.aumUsd || 0) - (a.aumUsd || 0)).slice(0, 8);
    return ["🏆 <b>Basket leaderboard</b>", "", ...byAum.map((b, i) => `${i + 1}. <b>${esc(b.symbol)}</b> · ${esc(fmtUsdFull(b.aumUsd))}`), "", `${siteUrl()}/baskets`].join("\n");
  }
  const top = ranked.slice(0, 8);
  const lines = ["🏆 <b>Basket leaderboard · 24h</b>", ""];
  top.forEach((b, i) => {
    const ch = b.change24hPct ?? 0;
    lines.push(`${i + 1}. <b>${esc(b.symbol)}</b> ${ch >= 0 ? "+" : ""}${ch.toFixed(1)}% · ${esc(fmtUsdFull(b.aumUsd))}`);
  });
  lines.push("", `${siteUrl()}/baskets`);
  return lines.join("\n");
}

// The non-custodial hand-off — the operator app's /createbasket page (Composer →
// BasketBuilder → V2 factory) where the user sets weights, names it, and SIGNS.
// Contract: ?tokens=<addr,…>&chain=<eth|base>. Set SPECTRUM_CREATE_URL to the
// operator origin's /createbasket; the fallback is only a placeholder.
function createUrl(addresses: string[], chain: "ethereum" | "base"): string {
  const base = (process.env.SPECTRUM_CREATE_URL || `${siteUrl()}/createbasket`).replace(/\/$/, "");
  return `${base}?tokens=${addresses.join(",")}&chain=${chainParam(chain)}`;
}

// /createbasket <tickers> — validate each on ETH/Base (real + liquid via DexScreener),
// enforce ONE chain (baskets are single-chain), cap 2–8, then hand off to the operator
// create page. Weights + name + signing happen there; the thesis is written post-deploy
// (owner decision). The bot never signs. Flag-on entry; DARK until GROUP_FEATURES_ENABLED.
async function createBasketText(args: string): Promise<string> {
  const tickers = args
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12);
  if (!tickers.length) {
    return [
      "🧺 <b>Create a basket</b>",
      "",
      "Give me 2–8 tickers (or contract addresses) on one chain and I'll check they're live + liquid, then hand you a page to set weights, name it, and sign it into existence.",
      "",
      "Example: <code>/createbasket SYRUP UNI MOG</code>",
    ].join("\n");
  }

  const results = await validateTickers(tickers, MIN_LIQUIDITY_USD);
  const matched = results.filter((r) => r.match && !r.lowLiquidity);
  const thin = results.filter((r) => r.match && r.lowLiquidity);
  const missing = results.filter((r) => !r.match);

  // baskets are single-chain → keep the chain with the most usable tokens (tiebreak: liquidity)
  const eth = matched.filter((r) => r.match!.chain === "ethereum");
  const base = matched.filter((r) => r.match!.chain === "base");
  const liqSum = (rs: typeof matched) => rs.reduce((s, r) => s + r.match!.liquidityUsd, 0);
  const chosen: "ethereum" | "base" =
    eth.length > base.length ? "ethereum" : base.length > eth.length ? "base" : liqSum(eth) >= liqSum(base) ? "ethereum" : "base";
  let usable = chosen === "ethereum" ? eth : base;
  const offChain = chosen === "ethereum" ? base : eth;

  const lines = ["🧺 <b>Basket check</b>", ""];
  for (const r of usable) lines.push(`✅ <b>${esc(r.match!.symbol)}</b> · ${chainLabel(chosen)} · ${esc(fmtUsdFull(r.match!.liquidityUsd))} liq · 🔎 <a href="${dexUrl(r.match!.chain, r.match!.address)}">verify</a>`);
  for (const r of offChain) lines.push(`↪️ <b>${esc(r.match!.symbol)}</b> · on ${chainLabel(r.match!.chain)} — a basket is one chain, so I kept ${chainLabel(chosen)}`);
  for (const r of thin) lines.push(`⚠️ <b>${esc(r.match!.symbol)}</b> · liquidity too thin (${esc(fmtUsdFull(r.match!.liquidityUsd))}) — it'd drop out`);
  for (const r of missing) lines.push(`❌ <b>${esc(r.query)}</b> · not a tradeable token on ETH/Base`);

  if (usable.length < MIN_BASKET_TOKENS) {
    lines.push("", `Need at least ${MIN_BASKET_TOKENS} tradeable tokens on one chain — try again.`);
    return lines.join("\n");
  }
  let note = "";
  if (usable.length > MAX_BASKET_TOKENS) {
    usable = usable.slice(0, MAX_BASKET_TOKENS);
    note = ` (capped at ${MAX_BASKET_TOKENS})`;
  }
  lines.push(
    "",
    `<b>${usable.length} tokens</b> on ${chainLabel(chosen)}${note} — set weights, name it &amp; sign it into existence:`,
    createUrl(
      usable.map((r) => r.match!.address),
      chosen,
    ),
    "",
    "💰 You earn a creator-fee slice on every trade of your basket. An active one can more than cover the launch cost.",
  );
  return lines.join("\n");
}

// Proactive "make it a basket?" nudge when a cluster of tickers goes hot in a group.
function suggestionText(hot: TickerTally[]): string {
  const syms = hot.map((h) => h.symbol);
  return [
    "🧺 <b>Basket idea</b>",
    "",
    `This group keeps mentioning ${syms.map((s) => "$" + esc(s)).join(", ")}. Bundle them into one basket — one token, the whole thesis, every trade feeding the PRISM burn?`,
    "",
    `<code>/createbasket ${syms.join(" ")}</code>`,
  ].join("\n");
}

// The group-chatter listener: on every group message (privacy mode OFF), track
// the tickers mentioned and, when a cluster is hot enough (distinct users +
// volume, on a cooldown), return a proactive basket suggestion. DARK until
// GROUP_FEATURES_ENABLED; returns null when off or nothing to suggest.
export async function handleGroupMessage(update: TgUpdate): Promise<TgReply | null> {
  if (!groupFeaturesEnabled()) return null;
  const msg = update?.message;
  if (!msg || typeof msg.text !== "string" || !msg.chat) return null;
  if (msg.chat.type !== "group" && msg.chat.type !== "supergroup") return null;
  if (msg.text.trim().startsWith("/")) return null; // commands aren't chatter
  const tickers = detectTickers(msg.text);
  if (!tickers.length) return null;
  const obs = await observe(msg.chat.id, msg.from?.id ?? 0, tickers, Date.now());
  if (!obs.suggest) return null;
  return { chatId: msg.chat.id, text: suggestionText(obs.suggest), parseMode: "HTML", disablePreview: true };
}

function greetingText(): string {
  return [
    "gm 🔻 I'm <b>the Prism bot</b>.",
    "",
    "Live eyes on Spectrum baskets + the PRISM buy &amp; burn. Try <b>/baskets</b>, <b>/leaderboard</b>, <b>/burn</b> — or just @mention me a question.",
    "/help for everything.",
  ].join("\n");
}

// Greet the group when the bot is freshly added (the on-join viral hook). Fires
// only on a real add (left/kicked → member/admin), so a redeploy never re-greets.
export function handleMembership(update: TgUpdate): TgReply | null {
  const ev = update?.my_chat_member;
  if (!ev || !ev.chat) return null;
  if (ev.chat.type !== "group" && ev.chat.type !== "supergroup") return null;
  const now = ev.new_chat_member?.status;
  const was = ev.old_chat_member?.status;
  const added = (now === "member" || now === "administrator") && (was === "left" || was === "kicked" || !was);
  if (!added) return null;
  return { chatId: ev.chat.id, text: greetingText(), parseMode: "HTML", disablePreview: true };
}

// ── Collaborative draft basket (participatory create) ─────────────────────────
function senderName(msg: TgMessage): string | undefined {
  return msg.from?.username ? `@${msg.from.username}` : msg.from?.first_name || undefined;
}

interface Candidate {
  symbol: string;
  chain: "ethereum" | "base";
}

// Recently-mentioned tickers (from the group's own chatter) that FIT the draft:
// not already in it, liquid, and — once the draft has a chain — on that chain.
// This is the "suggest what the group's been talking about, on the right chain"
// system. Resolves lazily here (a few DexScreener lookups) rather than on the hot
// listener path.
async function draftCandidates(chatId: number | string, d: Draft): Promise<Candidate[]> {
  const recent = await recentTickers(chatId, Date.now(), 10);
  const inDraft = new Set(d.tokens.map((t) => t.symbol.toLowerCase()));
  const fresh = recent.filter((s) => !inDraft.has(s.toLowerCase())).slice(0, 8);
  if (!fresh.length) return [];
  const chain = draftChain(d); // resolve ON the draft's chain so multi-chain tokens still qualify
  const resolved = (await Promise.all(fresh.map((s) => validateTicker(s, chain ?? undefined)))).filter((m): m is TokenMatch => !!m);
  return resolved.filter((m) => m.liquidityUsd >= MIN_LIQUIDITY_USD).map((m) => ({ symbol: m.symbol, chain: m.chain }));
}

function draftSummary(d: Draft, candidates: Candidate[] = []): string {
  const chain = draftChain(d);
  if (!d.tokens.length) {
    const line = candidates.length
      ? `\n\n🔥 Mentioned recently: ${candidates.map((c) => `$${esc(c.symbol)} (${c.chain === "base" ? "Base" : "ETH"})`).join(", ")} — <code>/propose</code> one to start`
      : "";
    return `🧺 <b>Group basket draft</b> — empty.\n\nBuild it together: <code>/propose $TICKER why</code>${line}`;
  }
  const toks = [...d.tokens].sort((a, b) => b.votes.length - a.votes.length);
  const lines = [`🧺 <b>Group basket draft</b> · ${chainLabel(chain!)}`, ""];
  toks.forEach((t, i) => {
    const v = t.votes.length ? ` 👍${t.votes.length}` : "";
    const who = t.byName ? ` · ${esc(t.byName)}` : "";
    const why = t.note ? ` — "${esc(t.note)}"` : "";
    lines.push(`${i + 1}. <b>$${esc(t.symbol)}</b>${v} · ${esc(fmtUsdFull(t.liquidityUsd))} liq${who}${why}`);
  });
  lines.push("");
  const n = d.tokens.length;
  if (n < MIN_BASKET_TOKENS) lines.push(`${n}/${MAX_BASKET_TOKENS} — add ${MIN_BASKET_TOKENS - n} more to launch.`);
  else lines.push(`${n}/${MAX_BASKET_TOKENS} on ${chainLabel(chain!)} — ready when the group is. <code>/launch</code>`);
  if (candidates.length) lines.push(`🔥 Also mentioned on ${chainLabel(chain!)}: ${candidates.map((c) => "$" + esc(c.symbol)).join(", ")}`);
  lines.push("", "<code>/propose $X why</code> · <code>/vote $X</code> · <code>/drop $X</code> · <code>/launch</code>");
  return lines.join("\n");
}

async function draftShow(chatId: number | string): Promise<string> {
  const d = await getDraft(chatId);
  return draftSummary(d, await draftCandidates(chatId, d));
}

async function proposeCmd(chatId: number | string, args: string, userId: number, byName?: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const ticker = (parts[0] || "").replace(/^\$/, "");
  const note = parts.slice(1).join(" ").trim().slice(0, 120) || undefined;
  if (!ticker) return "Usage: <code>/propose $TICKER why</code> — or paste a contract address for precision. e.g. <code>/propose SYRUP cheap yield</code>";
  const chain = draftChain(await getDraft(chatId)); // resolve on the draft's chain if it has one
  const match = await resolveToken(ticker, chain ?? undefined); // address (precise) or ticker (best-effort)
  if (!match) {
    if (chain) {
      const other = await resolveToken(ticker); // exists on the other chain?
      if (other) return `↪️ $${esc(other.symbol)} is on ${chainLabel(other.chain)}, but the draft is on <b>${chainLabel(chain)}</b>. A basket is one chain — add ${chainLabel(chain)} tokens, or <code>/cleardraft</code> to start a ${chainLabel(other.chain)} one.`;
      return `❌ <b>${esc(ticker)}</b> isn't a tradeable token on ${chainLabel(chain)}. Try another, or paste its contract address.`;
    }
    return `❌ <b>${esc(ticker)}</b> isn't a tradeable token on ETH/Base. Try another, or paste its contract address.`;
  }
  const r = await proposeToken(chatId, match, userId, byName, note, Date.now());
  if (r.status === "chain") return `↪️ The draft is on <b>${chainLabel(r.lockedChain!)}</b>. <code>/cleardraft</code> to switch chains.`;
  if (r.status === "dupe") return `$${esc(match.symbol)} is already in.\n\n${draftSummary(r.draft)}`;
  if (r.status === "full") return `Draft's full (${MAX_BASKET_TOKENS}). <code>/drop $X</code> to swap one out.\n\n${draftSummary(r.draft)}`;
  return `✅ Added <b>$${esc(match.symbol)}</b> · ${chainLabel(match.chain)} · 🔎 <a href="${dexUrl(match.chain, match.address)}">verify it's the right token</a>\n\n${draftSummary(r.draft)}`;
}

async function voteCmd(chatId: number | string, args: string, userId: number): Promise<string> {
  const ticker = (args.trim().split(/\s+/)[0] || "").replace(/^\$/, "");
  if (!ticker) return "Usage: <code>/vote $TICKER</code>";
  return draftSummary(await voteToken(chatId, ticker, userId, Date.now()));
}

async function dropCmd(chatId: number | string, args: string): Promise<string> {
  const ticker = (args.trim().split(/\s+/)[0] || "").replace(/^\$/, "");
  if (!ticker) return "Usage: <code>/drop $TICKER</code>";
  return draftSummary(await dropToken(chatId, ticker, Date.now()));
}

async function clearDraftCmd(chatId: number | string): Promise<string> {
  await clearDraft(chatId, Date.now());
  return "🧺 Draft cleared. Start fresh with <code>/propose $TICKER why</code>.";
}

async function launchDraftText(chatId: number | string): Promise<string> {
  const d = await getDraft(chatId);
  if (d.tokens.length < MIN_BASKET_TOKENS) return `The draft needs at least ${MIN_BASKET_TOKENS} tokens. <code>/draft</code> to see it, <code>/propose $X why</code> to add.`;
  const chain = draftChain(d)!;
  const tokens = d.tokens.slice(0, MAX_BASKET_TOKENS);
  return [
    `🧺 <b>Launch the group basket</b> · ${chainLabel(chain)}`,
    "",
    ...tokens.map((t) => `• <b>$${esc(t.symbol)}</b> · 🔎 <a href="${dexUrl(t.chain, t.address)}">verify</a>`),
    "",
    "Give each a quick look, then set weights, name it &amp; sign it into existence:",
    createUrl(
      tokens.map((t) => t.address),
      chain,
    ),
    "",
    "💰 Whoever launches earns a creator-fee slice on every trade. An active basket can more than cover the launch cost.",
  ].join("\n");
}

// Lightweight natural-language intent matching for @-mentions (no LLM): map a
// free-form question to the right read-only answer. Returns null → caller falls
// back to the intro.
const STOPWORDS = new Set(["is", "the", "a", "an", "of", "are", "do", "did", "for", "that", "this", "it", "to", "how", "was", "has", "have", "and", "or", "my", "your"]);

async function matchIntent(raw: string): Promise<string | null> {
  const t = raw.toLowerCase();
  const has = (...ws: string[]) => ws.some((w) => t.includes(w));

  // 1. explicit $TICKER → that basket (unambiguous, highest priority)
  const dollar = raw.match(/\$([A-Za-z][A-Za-z0-9]{1,14})/)?.[1];
  if (dollar) return await basketText(dollar);

  // 2. stat intents by keyword
  if (has("big burn", "next burn", "how close", "bridge")) return await bigBurnText();
  if (has("burn", "burnt", "burned")) return await burnText();
  if (has("leaderboard", "perform", "best basket", "winning", "gainer", "biggest") || (has("top") && has("basket"))) return await leaderboardText();
  if (has("how many", "how much", "number of", "count") && has("basket")) return await basketsText();
  if (has("baskets", "which baskets", "what baskets", "list")) return await basketsText();
  if (has("prism", "supply", "revenue", "fees", "yield", "holder")) return await prismText();

  // 3. "basket <TICKER>" with a plausible (non-stopword) ticker → that basket
  const m = raw.match(/basket\s+\$?([A-Za-z][A-Za-z0-9]{1,14})/i);
  if (m && !STOPWORDS.has(m[1].toLowerCase())) return await basketText(m[1]);

  // 4. greeting / catch-all
  if (has("what", "who", "do you", "help", "hello", "hey", "gm")) return helpText();
  return null;
}

export async function buildReply(update: TgUpdate): Promise<TgReply | null> {
  const msg = update?.message || update?.edited_message;
  if (!msg || !msg.chat || typeof msg.text !== "string") return null;
  const text = msg.text.trim();
  if (!text) return null;

  const m = text.match(/^\/([a-zA-Z0-9_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
  const mentioned = new RegExp(`@${BOT_USERNAME}\\b`, "i").test(text);
  if (!m && !mentioned) return null; // not addressed to us — stay quiet

  // anti-spam: drop stale/backlogged updates, then rate-limit per user (silently —
  // replying "slow down" to a flood is itself amplification).
  if (typeof msg.date === "number" && Date.now() / 1000 - msg.date > MAX_AGE_S) return null;
  if (rateLimited(msg.from?.id)) return null;

  const wrap = (body: string, photoUrl?: string): TgReply => ({
    photoUrl,
    chatId: msg.chat.id,
    text: body,
    parseMode: "HTML",
    disablePreview: true,
    replyTo: msg.message_id,
  });

  // slash command
  if (m) {
    const cmd = m[1].toLowerCase();
    const args = (m[2] || "").trim();
    switch (cmd) {
      case "start":
      case "help":
        return wrap(helpText());
      case "burn":
        return wrap(await burnText(), cardUrl("burn"));
      case "bigburn":
        return wrap(await bigBurnText());
      case "prism":
        return wrap(await prismText(), cardUrl("prism"));
      case "baskets":
        return wrap(await basketsText(), cardUrl("baskets"));
      case "leaderboard":
      case "top":
        return wrap(await leaderboardText(), cardUrl("baskets"));
      case "basket":
        return wrap(await basketText(args));
      case "price":
        return wrap(await priceText(), cardUrl("price"));
      case "supply":
        return wrap(await supplyText(), cardUrl("burn"));
      case "earned":
      case "apy":
        return wrap(await earnedText(), cardUrl("earned"));
      case "quote":
        return wrap(await quoteText(args));
      case "wallet":
        return wrap(await walletText(args));
      case "portfolio":
      case "spectrumportfolio":
      case "portfoliostats":
        return wrap(await portfolioText(), cardUrl("portfolio"));
      case "lightrunner":
      case "game":
        return wrap(lightrunnerText());
      case "ca":
      case "contract":
        return wrap(caText());
      case "links":
      case "socials":
        return wrap(linksText());
      case "createbasket":
        return wrap(groupFeaturesEnabled() ? await createBasketText(args) : comingSoonText());
      case "draft":
        return wrap(groupFeaturesEnabled() ? await draftShow(msg.chat.id) : comingSoonText());
      case "propose":
        return wrap(groupFeaturesEnabled() ? await proposeCmd(msg.chat.id, args, msg.from?.id ?? 0, senderName(msg)) : comingSoonText());
      case "vote":
        return wrap(groupFeaturesEnabled() ? await voteCmd(msg.chat.id, args, msg.from?.id ?? 0) : comingSoonText());
      case "drop":
        return wrap(groupFeaturesEnabled() ? await dropCmd(msg.chat.id, args) : comingSoonText());
      case "launch":
        return wrap(groupFeaturesEnabled() ? await launchDraftText(msg.chat.id) : comingSoonText());
      case "cleardraft":
        return wrap(groupFeaturesEnabled() ? await clearDraftCmd(msg.chat.id) : comingSoonText());
      default:
        return wrap(`I don't know <b>/${esc(cmd)}</b> yet. Try /help.`);
    }
  }

  // @-mention with natural language → intent match, fall back to the intro
  const stripped = text.replace(new RegExp(`@${BOT_USERNAME}`, "ig"), "").trim();
  return wrap((await matchIntent(stripped)) ?? helpText());
}
