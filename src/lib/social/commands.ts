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
import { observe, recentTickers, hotTickers } from "./group-store";
import {
  getLinkedWallet, linkWallet, unlinkWallet, newLinkCode, stashLinkCode, readPortfolio, readFullPortfolio,
  getSnapshot, putSnapshot, snapshotOf, getAlertState, putAlertState, DEFAULT_PREFS,
  planFunding, portfolioBatcherLive, claimSiteLink,
} from "./dm-portfolio";
import { validateTickers, validateTicker, resolveToken, dexUrl, type TokenMatch } from "./token-validate";
import { getDraft, proposeToken, dropToken, voteToken, clearDraft, draftChain, type Draft } from "./group-draft";
import { validateAddress } from "./token-validate";
import { resolveSafely, checkAmountUsd, auditFunding, plausibleUsd } from "./guards";
import { getRegistry, setGroupBasket, clearGroupBasket, addWatch, removeWatch, registeredChats, touchChat, MAX_WATCHLIST } from "./group-registry";
import type { TgButtons } from "./telegram";

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
  title?: string; // group name — stored on registration, shown in the league
}
interface TgMessage {
  message_id: number;
  text?: string;
  date?: number; // unix seconds — drop stale/backlogged updates
  from?: { id?: number; first_name?: string; username?: string }; // rate limiting + proposer attribution
  chat: TgChat;
  reply_to_message?: { text?: string; from?: { is_bot?: boolean } }; // force-reply answers
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
  /** inline keyboard rows (tap targets — the addictive layer) */
  buttons?: import("./telegram").TgButtons;
  /** the webhook stores this message's id as the group's living draft card */
  isDraftCard?: boolean;
  /** Telegram opens the reply box aimed at this message (the paste-a-CA gesture) */
  forceReplyPlaceholder?: string;
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

async function quoteText(args: string): Promise<{ text: string; card?: string }> {
  const amt = parseFloat(args);
  if (!Number.isFinite(amt) || amt <= 0 || amt > 10_000) return { text: "Usage: <code>/quote 0.5</code> — ETH amount to price." };
  try {
    const r = await fetch(`${siteUrl()}/api/trade/quote?dir=buy&in=${encodeURIComponent(String(amt))}`, { cache: "no-store" });
    if (!r.ok) throw new Error("quote failed");
    const d = (await r.json()) as { amountOut: string; ethUsd: number };
    const text = [
      "🔁 <b>Live quote</b>",
      "",
      `Ξ${esc(String(amt))} → <b>${esc(fmtPrism(Number(d.amountOut)))} PRISM</b>`,
      d.ethUsd ? `(${esc(fmtUsdFull(amt * d.ethUsd))} in)` : "",
      "",
      "1% pool fee streams to holders — including you, after this buy.",
      `${siteUrl()}/trade`,
    ].filter(Boolean).join("\n");
    return { text, card: cardUrl(`quote&in=${encodeURIComponent(String(amt))}&out=${encodeURIComponent(fmtPrism(Number(d.amountOut)))}`) };
  } catch {
    return { text: "Couldn't fetch a quote just now. Try again in a minute. 🔧" };
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

// price formatter that survives micro-cap tokens: fmtUsdFull rounds anything
// under $1 to two decimals, which renders a $0.0000009 token as "$0.00" — the
// exact tokens groups paste. Keep 3 significant figures however small.
function fmtPrice(n?: number | null): string {
  if (n == null || !isFinite(n) || n <= 0) return "—";
  if (n >= 1) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const digits = Math.min(12, Math.max(2, 2 - Math.floor(Math.log10(n))));
  return `$${n.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "")}`;
}

// label a stored (string) chain without trusting the union — a factory/chain
// rotation must never crash old registry rows
function chainName(c: string): string {
  return c === "base" ? "Base" : c === "robinhood" ? "Robinhood Chain" : c === "ethereum" ? "Ethereum" : c;
}

// ── /ourbasket — the group's own basket, registered once, live ever after ────
async function ourBasketText(chatId: number | string, args: string, chatTitle?: string): Promise<string> {
  const q = args.trim();
  if (q.toLowerCase() === "clear") {
    await clearGroupBasket(chatId);
    return "Cleared. Register a new one any time: <code>/ourbasket TICKER</code>";
  }
  if (q) {
    const needle = q.replace(/^\$/, "").toLowerCase();
    const all = await listIndexes();
    const hit = all.find((b) => b.address.toLowerCase() === needle) || all.find((b) => b.symbol.toLowerCase() === needle);
    if (!hit) return `Couldn't find a live Spectrum basket matching <b>${esc(q)}</b>. See them all with /baskets — then <code>/ourbasket TICKER</code>.`;
    await setGroupBasket(chatId, { address: hit.address, chain: hit.chain, symbol: hit.symbol }, chatTitle);
    return [
      `📌 <b>$${esc(hit.symbol)}</b> is now this group's basket.`,
      "",
      "/ourbasket any time for its live numbers — and it enters the group league (/league).",
    ].join("\n");
  }
  const reg = await getRegistry(chatId);
  if (!reg.basket) return "No basket registered yet. <code>/ourbasket TICKER</code> (or a basket address) — see them all with /baskets.";
  const all = await listIndexes();
  const live = all.find((b) => b.address.toLowerCase() === reg.basket!.address.toLowerCase());
  if (!live) {
    // honest de-listing: the site's discovery layer no longer tracks it (e.g. a
    // factory rotation) — say so, never show stale numbers
    return `📌 <b>$${esc(reg.basket.symbol)}</b> is registered but no longer tracked by the site (factory rotation?). Re-register with <code>/ourbasket TICKER</code>.`;
  }
  return [
    `📌 <b>$${esc(live.symbol)}</b> — this group's basket · ${esc(chainName(live.chain))}`,
    "",
    `· AUM: <b>${esc(fmtUsdFull(live.aumUsd))}</b>`,
    `· 24h: <b>${esc(pct(live.change24hPct))}</b>`,
    `· Holdings: ${live.basketLength} tokens`,
    "",
    `${siteUrl()}/baskets/${live.address}`,
  ].join("\n");
}

// ── /token — read-only intel for any ticker or pasted CA ─────────────────────
async function tokenText(args: string): Promise<{ text: string; card?: string }> {
  const q = args.trim();
  if (!q) return { text: "Usage: <code>/token TICKER</code> or <code>/token 0x…</code>" };
  const safe = await resolveSafely(q);
  if (!safe) return { text: `Couldn't find <b>${esc(q)}</b> as a tradeable token on Ethereum or Base.` };
  const t = safe.match;
  const card = cardUrl(
    `token&sym=${encodeURIComponent(t.symbol)}&name=${encodeURIComponent(t.name.slice(0, 40))}&chain=${encodeURIComponent(chainName(t.chain))}&ca=${t.address}&price=${encodeURIComponent(fmtPrice(t.priceUsd))}&liq=${encodeURIComponent(fmtUsdFull(t.liquidityUsd))}${t.change24hPct != null ? `&chg=${t.change24hPct.toFixed(2)}` : ""}`,
  );
  const liqWarn = t.liquidityUsd < MIN_LIQUIDITY_USD ? " ⚠️ thin" : "";
  // ambiguity is stated, never resolved silently — the ticker-collision scam
  // works precisely by looking like the token you meant
  const ambiguity = safe.rivals.length
    ? ["", `⚠️ <b>${safe.rivals.length} other token${safe.rivals.length === 1 ? "" : "s"} use $${esc(t.symbol)}.</b> This is the deepest pool (${Math.round(safe.dominance * 100)}% of the ticker's liquidity) — verify the address below before sending anything.`]
    : [];
  const text = [
    `🔎 <b>$${esc(t.symbol)}</b> · ${esc(t.name)} · ${esc(chainName(t.chain))}`,
    "",
    `· Price: <b>${esc(fmtPrice(t.priceUsd))}</b>${t.change24hPct != null ? ` (${esc(pct(t.change24hPct))} 24h)` : ""}`,
    `· Liquidity: ${esc(fmtUsdFull(t.liquidityUsd))}${liqWarn}`,
    t.volume24hUsd != null ? `· Volume 24h: ${esc(fmtUsdFull(t.volume24hUsd))}` : "",
    `· CA: <code>${esc(t.address)}</code>`,
    "",
    ...ambiguity,
    "",
    `🔬 <a href="${dexUrl(t.chain, t.address)}">chart &amp; pools</a> · add it to the group draft: <code>/propose $${esc(t.symbol)} why</code>`,
  ].filter(Boolean).join("\n");
  return { text, card };
}

// ── /watch · /unwatch · /watchlist — the group's shared radar ────────────────
async function watchText(chatId: number | string, args: string, userId: number, chatTitle?: string): Promise<string> {
  const q = args.trim();
  if (!q) return "Usage: <code>/watch TICKER</code> (or a CA). The group's list: /watchlist";
  const t = /^0x[a-fA-F0-9]{40}$/.test(q) ? await validateAddress(q) : await validateTicker(q);
  if (!t) return `Couldn't find <b>${esc(q)}</b> as a tradeable token on Ethereum or Base.`;
  const st = await addWatch(chatId, { address: t.address, symbol: t.symbol, chain: t.chain, priceAtAdd: t.priceUsd, addedAt: Date.now(), by: userId || undefined }, chatTitle);
  if (st === "dupe") return `<b>$${esc(t.symbol)}</b> is already on the list — /watchlist to see it.`;
  if (st === "full") return `The list is full (${MAX_WATCHLIST}). Drop one first: <code>/unwatch TICKER</code>`;
  return [
    `👁 Watching <b>$${esc(t.symbol)}</b> from ${esc(fmtPrice(t.priceUsd))}.`,
    "",
    "Performance is measured from right now — /watchlist for the scoreboard.",
  ].join("\n");
}
async function unwatchText(chatId: number | string, args: string): Promise<string> {
  const q = args.trim();
  if (!q) return "Usage: <code>/unwatch TICKER</code>";
  return (await removeWatch(chatId, q)) ? `Dropped <b>${esc(q.replace(/^\$/, "").toUpperCase())}</b> from the watchlist.` : `That wasn't on the list — /watchlist to see it.`;
}
async function watchlistText(chatId: number | string): Promise<string> {
  const reg = await getRegistry(chatId);
  if (!reg.watchlist.length) return "The group watchlist is empty. <code>/watch TICKER</code> to start it — performance is tracked from the moment you add.";
  const rows = await Promise.all(
    reg.watchlist.map(async (w) => {
      const live = await validateAddress(w.address);
      const chg = live && w.priceAtAdd > 0 ? ((live.priceUsd - w.priceAtAdd) / w.priceAtAdd) * 100 : null;
      return { w, live, chg };
    }),
  );
  rows.sort((a, b) => (b.chg ?? -Infinity) - (a.chg ?? -Infinity));
  const days = (t: number) => Math.max(1, Math.round((Date.now() - t) / 86_400_000));
  return [
    "👁 <b>Group watchlist</b> — since each was added",
    "",
    ...rows.map(({ w, live, chg }) =>
      `${chg != null && chg >= 0 ? "🟢" : chg != null ? "🔴" : "⚪"} <b>$${esc(w.symbol)}</b> · ${chg != null ? esc(pct(chg)) : "n/a"} in ${days(w.addedAt)}d${live ? ` · now ${esc(fmtPrice(live.priceUsd))}` : " · (unpriceable)"}`,
    ),
    "",
    "A watchlist that keeps winning is a basket waiting to exist: <code>/createbasket</code> 👀",
  ].join("\n");
}

// ── /split — sketch an allocation, hand execution to the create page ─────────
interface SplitLeg { weight: number; symbol: string }
function parseSplit(args: string): SplitLeg[] | null {
  const legs: SplitLeg[] = [];
  const re = /(\d{1,3})\s*%?\s+\$?([A-Za-z0-9]{1,15})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(args))) legs.push({ weight: Number(m[1]), symbol: m[2].toUpperCase() });
  if (legs.length < 2 || legs.length > MAX_BASKET_TOKENS) return null;
  const sum = legs.reduce((s, l) => s + l.weight, 0);
  if (sum < 90 || sum > 110) return null;
  return legs;
}
async function splitText(args: string): Promise<{ text: string; createHref: string | null }> {
  const legs = parseSplit(args);
  if (!legs) return { text: ["Sketch an allocation, e.g. <code>/split 60 STONK 40 PONS</code>", "", `2–${MAX_BASKET_TOKENS} tokens, weights summing to ~100.`].join("\n"), createHref: null };
  const first = await validateTicker(legs[0].symbol);
  if (!first) return { text: `Couldn't find <b>$${esc(legs[0].symbol)}</b> on Ethereum or Base.`, createHref: null };
  const rest = await Promise.all(legs.slice(1).map((l) => validateTicker(l.symbol, first.chain)));
  const missing = legs.slice(1).filter((_, i) => !rest[i]);
  if (missing.length) return { text: `${missing.map((l) => `<b>$${esc(l.symbol)}</b>`).join(", ")} not found on ${esc(chainName(first.chain))} — a basket lives on ONE chain.`, createHref: null };
  const matches = [first, ...(rest as TokenMatch[])];
  const href = createUrl(matches.map((t) => t.address), first.chain);
  const text = [
    `🧺 <b>The split</b> · ${esc(chainName(first.chain))}`,
    "",
    ...legs.map((l, i) => `· <b>${l.weight}%</b> $${esc(l.symbol)} — ${esc(fmtPrice(matches[i].priceUsd))}${matches[i].change24hPct != null ? ` (${esc(pct(matches[i].change24hPct))} 24h)` : ""}`),
    "",
    href ? `<a href="${href}">Make it real — weights, name and signing on the create page →</a>` : CREATE_UNSET,
  ].join("\n");
  return { text, createHref: href };
}

// ── /league — every registered group basket, ranked ──────────────────────────
async function leagueText(): Promise<string> {
  const chats = (await registeredChats()).slice(0, 50);
  const entries: { title: string; symbol: string; address: string; aumUsd: number; chg: number | null }[] = [];
  const all = await listIndexes();
  for (const id of chats) {
    const reg = await getRegistry(id);
    if (!reg.basket) continue;
    const live = all.find((b) => b.address.toLowerCase() === reg.basket!.address.toLowerCase());
    if (!live) continue; // de-listed (rotation) — silently out of the standings
    entries.push({ title: reg.title || "a group", symbol: live.symbol, address: live.address, aumUsd: live.aumUsd, chg: live.change24hPct });
  }
  if (!entries.length) return "No group baskets registered yet. Put yours in the league: <code>/ourbasket TICKER</code>";
  entries.sort((a, b) => (b.chg ?? -Infinity) - (a.chg ?? -Infinity));
  const medal = (i: number) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : ` ${i + 1}.`);
  return [
    "🏆 <b>Group basket league</b> — 24h",
    "",
    ...entries.slice(0, 10).map((e, i) => `${medal(i)} <b>$${esc(e.symbol)}</b> · ${esc(pct(e.chg))} · ${esc(fmtUsdFull(e.aumUsd))} — ${esc(e.title)}`),
    "",
    "Enter your group: <code>/ourbasket TICKER</code>",
  ].join("\n");
}

// ── PRIVATE DM: your portfolio, cross-chain ──────────────────────────────────
// Read-only by construction. The bot never signs, never custodies, never asks
// for a key — reweighting produces a target and a link, and the signature
// happens on the site in the user's own wallet.
const DM_ONLY = "🔒 That one only works in a private message with me — a wallet in a group chat is a doxx. Tap my name → Send Message.";

async function linkText(userId: number, args: string): Promise<string> {
  const q = args.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(q)) {
    await linkWallet(userId, q);
    return [
      `👛 Linked <code>${esc(q.slice(0, 6))}…${esc(q.slice(-4))}</code>.`,
      "",
      "/me for your positions across every chain.",
      "",
      "Note: a pasted address isn't proof you own it — it only shows public data back to you. Use /link with no address to connect a wallet properly.",
    ].join("\n");
  }
  const code = newLinkCode();
  await stashLinkCode(code, userId);
  return [
    "👛 <b>Link your wallet</b>",
    "",
    `<a href="${siteUrl()}/link?code=${code}">Open the link page →</a> and connect the wallet you already use.`,
    "",
    "Read-only: no signature, no approval, nothing granted — it just lets this DM show your positions.",
    `The code <code>${code}</code> works for 20 minutes. Or paste an address here to skip the connect.`,
  ].join("\n");
}

async function meText(userId: number): Promise<{ text: string; card?: string }> {
  const addr = await getLinkedWallet(userId);
  if (!addr) return { text: "No wallet linked yet — <code>/link</code> takes about ten seconds." };
  const pf = await readFullPortfolio(addr);
  if (!(await getSnapshot(userId))) await putSnapshot(userId, snapshotOf(pf)); // /pnl measures from here
  if (!pf.positions.length) {
    return {
      text: [
        `👛 <code>${esc(addr.slice(0, 6))}…${esc(addr.slice(-4))}</code>`,
        "",
        `No Spectrum baskets in this wallet yet (checked all ${pf.checked}).`,
        "",
        `Browse them: ${siteUrl()}/baskets`,
      ].join("\n"),
    };
  }
  const lines = pf.positions
    .slice(0, 10)
    .map((p) => `· <b>$${esc(p.symbol)}</b> — ${esc(fmtUsdFull(p.valueUsd))}${p.change24hPct != null ? ` (${esc(pct(p.change24hPct))})` : ""} · ${esc(chainName(p.chain))}`);
  if (!plausibleUsd(pf.totalUsd)) return { text: "I read something implausible from the chain just now — I'd rather show nothing than a wrong number. Try again in a minute. 🔧" };
  const chains = new Set(pf.positions.map((p) => p.chain)).size;
  return {
    text: [
      `👛 <b>Your book</b> · ${esc(fmtUsdFull(pf.totalUsd))}`,
      `<code>${esc(addr.slice(0, 6))}…${esc(addr.slice(-4))}</code> · ${pf.positions.length} position${pf.positions.length === 1 ? "" : "s"} · ${chains} chain${chains === 1 ? "" : "s"}`,
      "",
      ...lines,
      pf.positions.length > 10 ? `<i>…and ${pf.positions.length - 10} smaller</i>` : "",
      "",
      "<code>/pnl</code> how it's doing · <code>/reweight</code> change the shape · <code>/alerts</code> what I'll tell you",
    ].filter(Boolean).join("\n"),
    card: cardUrl(`me&total=${Math.round(pf.totalUsd)}&legs=${encodeURIComponent(pf.positions.slice(0, 8).map((p) => `${p.symbol}:${Math.max(1, Math.round(p.valueUsd))}`).join(","))}`),
  };
}

// Baskets are composition-IMMUTABLE on-chain (probed: only setMetadata exists),
// so "reweighting" means trading into the new shape — and a group basket changes
// composition by launching a NEW version that the old one points at socially
// (the factory's own doc: "no successor pointer — versioning by social
// convention"). Both paths end at the site, signed by the user's own wallet.
async function reweightText(userId: number, args: string): Promise<{ text: string; createHref: string | null; card?: string }> {
  const addr = await getLinkedWallet(userId);
  if (!addr) return { text: "Link a wallet first — <code>/link</code>.", createHref: null };
  const legs = parseSplit(args);
  if (!legs) {
    const pf = await readPortfolio(addr);
    const now = pf.positions.slice(0, 6).map((p) => `· <b>$${esc(p.symbol)}</b> — ${pf.totalUsd > 0 ? Math.round((p.valueUsd / pf.totalUsd) * 100) : 0}%`);
    return {
      text: [
        "⚖️ <b>Reweight</b>",
        "",
        ...(now.length ? ["Where you are now:", ...now, ""] : []),
        "Say the target: <code>/reweight 60 STONK 40 PONS</code>",
        "",
        "I price it and hand you the page — you sign, never me.",
      ].join("\n"),
      createHref: null,
    };
  }
  // express the target as CHANGES against what they actually hold — the shape
  // the batcher will execute, and the shape a human can sanity-check
  const pf = await readFullPortfolio(addr);
  const total = pf.totalUsd;
  const bySym = new Map(pf.positions.map((p) => [p.symbol.toUpperCase(), p]));
  const targetSyms = new Set(legs.map((l) => l.symbol.toUpperCase()));
  const rows: string[] = [];
  for (const l of legs) {
    const held = bySym.get(l.symbol.toUpperCase());
    const want = (l.weight / 100) * total;
    const have = held?.valueUsd ?? 0;
    const d = want - have;
    rows.push(
      `· <b>$${esc(l.symbol)}</b> → ${l.weight}% · ${d >= 0 ? "buy" : "sell"} ${esc(fmtUsdFull(Math.abs(d)))}${have > 0 ? ` (have ${esc(fmtUsdFull(have))})` : " (new)"}`,
    );
  }
  for (const p of pf.positions) if (!targetSyms.has(p.symbol.toUpperCase()) && p.valueUsd >= 1) rows.push(`· <b>$${esc(p.symbol)}</b> → 0% · sell ${esc(fmtUsdFull(p.valueUsd))}`);
  const s = await splitText(args);
  return {
    text: [
      `⚖️ <b>Your target</b> · book ${esc(fmtUsdFull(total))}`,
      "",
      ...rows.slice(0, 10),
      "",
      portfolioBatcherLive()
        ? "Spectrum Portfolio can execute this as one batched transaction — you sign once."
        : "Until the Portfolio batcher is on-chain these are separate swaps you sign yourself.",
    ].join("\n"),
    createHref: s.createHref,
    card: cardUrl(`reweight&from=${encodeURIComponent(rows.slice(0, 4).map((r) => r.replace(/<[^>]+>/g, "").replace(/^· /, "")).join("|"))}&share=${encodeURIComponent(`book ${fmtUsdFull(total)}`)}`),
  };
}

// /pnl — measured from the snapshot taken when the wallet was linked. Honest
// about what it is: a real cost basis needs every historical transfer priced at
// its block, which is an indexer's job, so this says "since you linked" rather
// than inventing an entry price.
async function pnlText(userId: number): Promise<{ text: string; card?: string }> {
  const addr = await getLinkedWallet(userId);
  if (!addr) return { text: "Link a wallet first — <code>/link</code>." };
  const snap = await getSnapshot(userId);
  const pf = await readFullPortfolio(addr);
  if (!snap) {
    await putSnapshot(userId, snapshotOf(pf));
    return {
      text: [
        "📈 <b>Tracking from now</b>",
        "",
        `Starting point: <b>${esc(fmtUsdFull(pf.totalUsd))}</b> across ${pf.positions.length} position${pf.positions.length === 1 ? "" : "s"}.`,
        "",
        "Ask again any time — /pnl measures from here.",
      ].join("\n"),
    };
  }
  const days = Math.max(1, Math.round((Date.now() - snap.at) / 86_400_000));
  const delta = pf.totalUsd - snap.totalUsd;
  const deltaPct = snap.totalUsd > 0 ? (delta / snap.totalUsd) * 100 : 0;
  const movers = pf.positions
    .map((p) => {
      const was = snap.byAsset[p.address.toLowerCase()];
      // only positions held at BOTH ends are comparable — a new buy isn't a gain
      return was ? { sym: p.symbol, d: p.valueUsd - was.valueUsd } : null;
    })
    .filter((x): x is { sym: string; d: number } => x !== null)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, 4);
  return {
    text: [
      `📈 <b>Since you linked</b> · ${days}d`,
      "",
      `${delta >= 0 ? "🟢" : "🔴"} <b>${delta >= 0 ? "+" : "−"}${esc(fmtUsdFull(Math.abs(delta)))}</b> (${esc(pct(deltaPct))})`,
      `Now ${esc(fmtUsdFull(pf.totalUsd))} · was ${esc(fmtUsdFull(snap.totalUsd))}`,
      ...(movers.length ? ["", "<b>Biggest movers</b>", ...movers.map((m) => `${m.d >= 0 ? "🟢" : "🔴"} <b>$${esc(m.sym)}</b> ${m.d >= 0 ? "+" : "−"}${esc(fmtUsdFull(Math.abs(m.d)))}`)] : []),
      "",
      "<i>Measured from your link, not your entry price — deposits and withdrawals move it too.</i>",
    ].join("\n"),
    card: cardUrl(`pnl&total=${Math.round(pf.totalUsd)}&delta=${Math.round(delta)}&legs=${encodeURIComponent(pf.positions.slice(0, 8).map((p) => `${p.symbol}:${Math.max(1, Math.round(p.valueUsd))}`).join(","))}`),
  };
}

// /buy <ca|ticker> <usd> — price it, then hand over the venue. The bot never
// signs; this is a prepared order, not an executed one.
// A buy is a PORTFOLIO operation: it comes from somewhere. When the wallet is
// linked we answer that first — funded from cash, or by trimming what they hold
// — and show the shape it leaves behind. That plan is exactly what the Spectrum
// Portfolio batcher will execute in ONE transaction once it is on-chain; until
// then the legs are signed individually on the venue, and we say so.
async function buyText(userId: number, isDm: boolean, args: string): Promise<{ text: string; href: string | null; card?: string }> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { text: "Usage: <code>/buy PEPE 100</code> or <code>/buy 0x… 100</code> — the amount is in USD.", href: null };
  const q = parts[0];
  const usd = Number(parts[1]);
  const safe = await resolveSafely(q);
  if (!safe) return { text: `Couldn't find <b>${esc(q)}</b> as a tradeable token on Ethereum or Base.`, href: null };
  const t = safe.match;
  const href = `https://matcha.xyz/tokens/${t.chain}/${t.address}`;
  const sized = Number.isFinite(usd) && usd > 0;
  // a fat-fingered size is a money bug — refuse before pricing anything
  if (parts[1] !== undefined) {
    const amt = checkAmountUsd(parts[1]);
    if (!amt.ok) return { text: `🛑 ${esc(amt.reason!)}`, href: null };
  }
  const head = [
    `🛒 <b>$${esc(t.symbol)}</b> · ${esc(chainName(t.chain))}`,
    "",
    sized
      ? `<b>${esc(fmtUsdFull(usd))}</b> ≈ ${esc(fmtPrism(usd / (t.priceUsd || 1)))} $${esc(t.symbol)} at ${esc(fmtPrice(t.priceUsd))}`
      : `${esc(fmtPrice(t.priceUsd))} per $${esc(t.symbol)} — add an amount, e.g. <code>/buy ${esc(t.symbol)} 100</code>`,
    t.liquidityUsd < MIN_LIQUIDITY_USD ? "⚠️ Thin liquidity — expect slippage." : "",
    // a money action ALWAYS shows what it would actually buy
    `<code>${esc(t.address)}</code>`,
    ...(safe.rivals.length
      ? [`⚠️ <b>${safe.rivals.length} other token${safe.rivals.length === 1 ? "" : "s"} use $${esc(t.symbol)}</b> — this is the deepest pool. Buy by address if you mean a different one.`]
      : []),
  ].filter(Boolean);

  // unlinked, or in a group: price it and stop — funding needs their positions
  const addr = isDm ? await getLinkedWallet(userId) : null;
  if (!addr || !sized) {
    return {
      text: [...head, "", isDm && !addr ? "Link a wallet (<code>/link</code>) and I'll show what funds it." : "You sign it in your own wallet — I never do."].join("\n"),
      href,
    };
  }

  const pf = await readFullPortfolio(addr);
  // a size wildly beyond the book is a typo, not an order
  const sanity = checkAmountUsd(usd, pf.totalUsd);
  if (!sanity.ok) return { text: `🛑 ${esc(sanity.reason!)}`, href: null };
  const plan = planFunding(pf, usd, t.chain);
  // check our OWN arithmetic before a human acts on it
  const problems = auditFunding(plan, pf);
  if (problems.length) {
    return {
      text: [...head, "", "🛑 <b>I won't show a funding plan I can't stand behind.</b>", `<i>${esc(problems[0])}</i>`, "", "Try a smaller size, or /me to see the book."].join("\n"),
      href,
    };
  }
  const fundLines: string[] = [];
  const cardFrom: string[] = [];
  for (const l of plan.fromCash) {
    fundLines.push(`💵 ${esc(fmtUsdFull(l.takeUsd))} of your <b>$${esc(l.symbol)}</b> cash${l.chain !== t.chain ? ` · on ${esc(chainName(l.chain))}, bridge first` : ""}`);
    cardFrom.push(`${fmtUsdFull(l.takeUsd)} of ${l.symbol} cash`);
  }
  for (const l of plan.fromTrim) {
    const share = Math.round((l.takeUsd / l.ofPositionUsd) * 100);
    fundLines.push(`✂️ trim <b>$${esc(l.symbol)}</b> by ${esc(fmtUsdFull(l.takeUsd))} · ${share}% of that position${l.chain !== t.chain ? ` · on ${esc(chainName(l.chain))}` : ""}`);
    cardFrom.push(`trim ${l.symbol} by ${fmtUsdFull(l.takeUsd)}`);
  }
  if (!fundLines.length) fundLines.push("· nothing in this wallet to fund it with yet");
  if (plan.shortfallUsd > 0.01) fundLines.push(`⚠️ <b>${esc(fmtUsdFull(plan.shortfallUsd))} short</b> — send funds or buy smaller`);

  const after = pf.totalUsd > 0 ? (usd / pf.totalUsd) * 100 : 0;
  const shareLine = `Leaves $${t.symbol} at ~${after.toFixed(0)}% of your ${fmtUsdFull(pf.totalUsd)} book`;
  const lines = [
    ...head,
    "",
    "<b>Funded by</b>",
    ...fundLines,
    "",
    `📊 ${esc(shareLine)}`,
    "",
    portfolioBatcherLive()
      ? "<i>Spectrum Portfolio executes this as one batched transaction — you sign once, I never do.</i>"
      : "<i>Until Spectrum Portfolio's batcher is on-chain these are separate swaps you sign yourself — I never do.</i>",
  ];
  return {
    text: lines.join("\n"),
    href,
    card: cardUrl(`buy&sym=${encodeURIComponent(t.symbol)}&amount=${encodeURIComponent(fmtUsdFull(usd))}&from=${encodeURIComponent(cardFrom.join("|"))}&share=${encodeURIComponent(shareLine)}`),
  };
}
const buyButton = (href: string | null, sym?: string): TgButtons | undefined => (href ? [[{ text: `🛒 Open the swap${sym ? ` — $${sym}` : ""}`, url: href }]] : undefined);

// /alerts — the controls. Defaults are deliberately quiet.
async function alertsText(userId: number, args: string): Promise<string> {
  const st = await getAlertState(userId);
  const a = args.trim().toLowerCase();
  if (a === "off" || a === "on") {
    st.prefs.on = a === "on";
    await putAlertState(userId, st);
    return st.prefs.on ? "🔔 Alerts on. I'll only speak when something material happens." : "🔕 Alerts off. Nothing from me unless you ask.";
  }
  const m = a.match(/^(\d{1,3})\s*%?$/);
  if (m) {
    st.prefs.minPct = Math.max(3, Math.min(90, Number(m[1])));
    await putAlertState(userId, st);
    return `🔔 I'll flag moves of <b>${st.prefs.minPct}%</b> or more (worth at least ${esc(fmtUsdFull(st.prefs.minUsd))}).`;
  }
  return [
    `🔔 <b>Alerts</b> — ${st.prefs.on ? "on" : "off"}`,
    "",
    `· Material moves only: <b>${st.prefs.minPct}%+</b> AND worth ${esc(fmtUsdFull(st.prefs.minUsd))}+`,
    `· At most <b>${st.prefs.maxPerDay} a day</b>, and never twice about the same asset within 12h`,
    "· Claimable fees worth collecting",
    "",
    "<code>/alerts off</code> · <code>/alerts on</code> · <code>/alerts 20</code> (move size)",
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

// the ➕ Add-a-token prompt: replies to this message are treated as proposals
export const ADD_PROMPT = "📎 <b>Paste the token</b> — a contract address (0x…) or $TICKER, plus a word on why. I'll validate it and the group votes.";

// ── THE LIVING DRAFT CARD — one photo message per group, edited as taps land ──
// The bento is the visual: proposed tokens as tiles that GROW with votes.
export interface DraftCardView {
  caption: string;
  photoUrl: string;
  buttons: TgButtons;
}
export function draftCardView(chatId: number | string, d: Draft): DraftCardView {
  const need = Math.max(0, MIN_BASKET_TOKENS - d.tokens.length);
  const cool = d.updatedAt > 0 && Date.now() - d.updatedAt > 48 * 3_600_000;
  const lines = [
    "🧺 <b>The group basket draft</b>",
    "",
    ...d.tokens.map((t) => `• <b>$${esc(t.symbol)}</b> 👍${t.votes.length}${t.note ? ` — <i>${esc(t.note.slice(0, 60))}</i>` : ""}`),
    d.tokens.length ? "" : "Nothing proposed yet.",
    need > 0 ? `${need} more token${need === 1 ? "" : "s"} to launch. <code>/propose $TICKER why</code>` : "Ready — whoever launches earns the creator-fee slice on every trade, forever.",
    cool ? "🧊 This draft has gone quiet — launch it or it melts away." : "",
  ].filter(Boolean);
  const voteRows: TgButtons = [];
  for (let i = 0; i < d.tokens.length; i += 2) {
    voteRows.push(d.tokens.slice(i, i + 2).map((t) => ({ text: `👍 ${t.symbol} (${t.votes.length})`, data: `v:${t.symbol.slice(0, 12)}` })));
  }
  const actions: TgButtons[number] = [];
  if (d.tokens.length >= MIN_BASKET_TOKENS) actions.push({ text: "🚀 Launch it", data: "d:launch" });
  actions.push({ text: "➕ Add a token", data: "d:add" });
  return {
    caption: lines.join("\n"),
    photoUrl: cardUrl(`draftcard&chat=${encodeURIComponent(String(chatId))}&u=${d.updatedAt}`),
    buttons: [...voteRows, actions],
  };
}

// draft mutations answer with the card itself; the webhook stores its message id
function draftCardReply(chatId: number | string, d: Draft): TgReply {
  const v = draftCardView(chatId, d);
  return { chatId, text: v.caption, parseMode: "HTML", disablePreview: true, photoUrl: v.photoUrl, buttons: v.buttons, isDraftCard: true };
}

// ── button taps (callback_query) — every step of the flow without typing ─────
export interface TgCallback {
  id: string;
  from?: { id?: number; first_name?: string };
  message?: { message_id: number; chat: TgChat };
  data?: string;
}
export interface CallbackAction {
  toast?: string; // answerCallbackQuery text (the little popup)
  refreshCard?: boolean; // re-render the living card in place
  reply?: TgReply; // post a fresh message (e.g. the launch handoff)
}
export async function handleCallback(cb: TgCallback): Promise<CallbackAction> {
  const chat = cb.message?.chat;
  const data = cb.data || "";
  if (!chat) return {};
  const userId = cb.from?.id ?? 0;
  if (rateLimited(userId)) return { toast: "Easy 🙂 give it a few seconds." };

  if (data.startsWith("v:")) {
    const sym = data.slice(2);
    const before = await getDraft(chat.id);
    const tok = before.tokens.find((x) => x.symbol.toLowerCase() === sym.toLowerCase());
    if (!tok) return { toast: "That token left the draft." };
    if (userId && tok.votes.includes(userId)) return { toast: "You already voted that one." };
    await voteToken(chat.id, sym, userId, Date.now());
    return { toast: `Voted $${sym} 👍`, refreshCard: true };
  }
  if (data === "d:start") {
    if (!groupFeaturesEnabled()) return { toast: "Drafting isn't switched on here yet." };
    const hot = await hotTickers(chat.id, Date.now());
    if (hot.length < MIN_BASKET_TOKENS) return { toast: "Not enough hot tickers right now — /createbasket X Y works any time." };
    let added = 0;
    let chain: "ethereum" | "base" | undefined;
    for (const sym of hot.slice(0, MAX_BASKET_TOKENS)) {
      const t = await validateTicker(sym, chain);
      if (!t) continue;
      const r = await proposeToken(chat.id, t, userId, cb.from?.first_name, "from the group's chatter", Date.now());
      if (r.status === "added") {
        added++;
        chain = r.draft.tokens[0]?.chain as "ethereum" | "base" | undefined;
      }
    }
    if (!added) return { toast: "Couldn't validate those tickers just now — try /createbasket." };
    await touchChat(chat.id, chat.title);
    return { toast: `Draft started with ${added} token${added === 1 ? "" : "s"} 🧺`, refreshCard: true, reply: draftCardReply(chat.id, await getDraft(chat.id)) };
  }
  if (data === "d:launch") {
    if (!groupFeaturesEnabled()) return { toast: "Launching isn't switched on here yet." };
    const l = await launchDraftText(chat.id);
    return { toast: "Launch checklist 🚀", reply: { chatId: chat.id, text: l.text, parseMode: "HTML", disablePreview: true, buttons: createButton(l.createHref) } };
  }
  if (data === "d:add") {
    return {
      reply: {
        chatId: chat.id,
        text: ADD_PROMPT,
        parseMode: "HTML",
        disablePreview: true,
        forceReplyPlaceholder: "0x… or $TICKER, plus why",
      },
    };
  }
  if (data === "d:no") return { toast: "Fair. I'll keep watching quietly." };
  if (data === "o:link") {
    return { reply: { chatId: chat.id, text: await linkText(userId, ""), parseMode: "HTML", disablePreview: true } };
  }
  if (data === "o:look") {
    return {
      reply: {
        chatId: chat.id,
        text: [
          "🔻 <b>The Prism ecosystem, live</b>",
          "",
          "<code>/price</code> what PRISM is worth",
          "<code>/burn</code> what's been destroyed",
          "<code>/baskets</code> every Spectrum basket",
          "",
          "Connect a wallet any time with <code>/link</code> and I'll add your own positions.",
        ].join("\n"),
        parseMode: "HTML",
        disablePreview: true,
        photoUrl: cardUrl("digest"),
      },
    };
  }
  return {};
}

// ── Onboarding ───────────────────────────────────────────────────────────────
// Three ways in, three first screens. Short copy, one obvious next tap, and
// nothing asked for that isn't needed yet.
//
//   A · arriving from the site with a wallet already connected  → book on screen 1
//   B · cold DM, knows nothing                                  → one question
//   C · met the bot in someone's group                          → answer, then invite
const BOT = BOT_USERNAME;

function welcomeText(): string {
  return [
    "🔻 <b>Spectra</b>",
    "",
    "Live eyes on the Prism ecosystem, and your own positions across every chain.",
    "",
    "Connect a wallet and I'll show your book. Nothing is signed and nothing is granted, I only read what the chain already makes public.",
  ].join("\n");
}
const welcomeButtons = (): TgButtons => [
  [{ text: "👛 Connect a wallet", data: "o:link" }],
  [{ text: "👀 Just show me the ecosystem", data: "o:look" }],
];

async function arrivedText(userId: number, address: string): Promise<{ text: string; card?: string }> {
  const pf = await readFullPortfolio(address);
  await putSnapshot(userId, snapshotOf(pf)); // /pnl starts counting from arrival
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  if (!pf.positions.length) {
    return {
      text: [
        `👛 <b>Wallet linked</b> · <code>${esc(short)}</code>`,
        "",
        "Nothing in it yet that I can see. When you hold a basket or a token, it shows up here.",
        "",
        "<code>/me</code> your book · <code>/alerts</code> what I'll tell you",
      ].join("\n"),
    };
  }
  const top = pf.positions.slice(0, 4).map((p) => `· <b>$${esc(p.symbol)}</b> ${esc(fmtUsdFull(p.valueUsd))}`);
  return {
    text: [
      `👛 <b>You're in.</b> <code>${esc(short)}</code>`,
      "",
      `<b>${esc(fmtUsdFull(pf.totalUsd))}</b> across ${pf.positions.length} position${pf.positions.length === 1 ? "" : "s"}`,
      ...top,
      "",
      "<code>/pnl</code> how it's doing · <code>/reweight</code> change the shape · <code>/alerts</code> what I'll tell you",
    ].join("\n"),
    card: cardUrl(`me&total=${Math.round(pf.totalUsd)}&legs=${encodeURIComponent(pf.positions.slice(0, 8).map((p) => `${p.symbol}:${Math.max(1, Math.round(p.valueUsd))}`).join(","))}`),
  };
}

// In a group, the bot answers the room. The invite to a private chat is a
// button on its own, never a paragraph in every reply.
const dmInviteButtons = (): TgButtons => [[{ text: "👛 See your own positions", url: `https://t.me/${BOT}?start=hi` }]];

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
    "",
    "<b>In a private message with me</b>",
    "/link · connect a wallet (read-only)",
    "/me · your positions across every chain",
    "/pnl · how you're doing since you linked",
    "/reweight 60 X 40 Y · a target, then the page to sign it",
    "/alerts · material moves only, at most a few a day",
    "/buy &lt;ticker|0x…&gt; &lt;usd&gt; · price it, then the swap",
    "",
    "<b>Group tools</b>",
    "/ourbasket &lt;ticker&gt; · register the group's basket, then live stats",
    "/watch &lt;ticker&gt; · /watchlist · the group's shared radar",
    "/token &lt;ticker|0x…&gt; · instant read-only intel",
    "/split 60 X 40 Y · sketch an allocation → create page",
    "/league · group baskets, ranked",
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
// The create page lives on the SPECTRUM operator site, a different origin (see
// docs/SPECTRUM-INTEGRATION.md). If the operator hasn't pointed us at it, we say
// so — we do NOT invent {site}/createbasket, which this kit does not serve: a
// launch button landing on a 404 is worse than one that explains itself. The
// surface gate asserts every link the bot emits resolves, and caught exactly
// this.
function createUrl(addresses: string[], chain: "ethereum" | "base"): string | null {
  const configured = process.env.SPECTRUM_CREATE_URL;
  if (!configured) return null;
  return `${configured.replace(/\/$/, "")}?tokens=${addresses.join(",")}&chain=${chainParam(chain)}`;
}
const CREATE_UNSET = "⚙️ The operator hasn't wired the create page yet (<code>SPECTRUM_CREATE_URL</code>) — the composition above is ready the moment they do.";

// /createbasket <tickers> — validate each on ETH/Base (real + liquid via DexScreener),
// enforce ONE chain (baskets are single-chain), cap 2–8, then hand off to the operator
// create page. Weights + name + signing happen there; the thesis is written post-deploy
// (owner decision). The bot never signs. Flag-on entry; DARK until GROUP_FEATURES_ENABLED.
async function createBasketText(args: string): Promise<{ text: string; createHref: string | null }> {
  const tickers = args
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12);
  if (!tickers.length) {
    return {
      text: [
        "🧺 <b>Create a basket</b>",
        "",
        "Give me 2–8 tickers (or contract addresses) on one chain and I'll check they're live + liquid, then hand you a page to set weights, name it, and sign it into existence.",
        "",
        "Example: <code>/createbasket SYRUP UNI MOG</code>",
      ].join("\n"),
      createHref: null,
    };
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
    return { text: lines.join("\n"), createHref: null };
  }
  let note = "";
  if (usable.length > MAX_BASKET_TOKENS) {
    usable = usable.slice(0, MAX_BASKET_TOKENS);
    note = ` (capped at ${MAX_BASKET_TOKENS})`;
  }
  const href = createUrl(
    usable.map((r) => r.match!.address),
    chosen,
  );
  lines.push(
    "",
    href
      ? `<a href="${href}"><b>${usable.length} tokens</b> on ${chainLabel(chosen)}${note} — set weights, name it &amp; sign on the create page →</a>`
      : `<b>${usable.length} tokens</b> on ${chainLabel(chosen)}${note}.\n${CREATE_UNSET}`,
    "",
    "💰 You earn a creator-fee slice on every trade of your basket. An active one can more than cover the launch cost.",
  );
  return { text: lines.join("\n"), createHref: href };
}

// Proactive "make it a basket?" nudge when a cluster of tickers goes hot in a group.
function suggestionText(hot: TickerTally[]): string {
  const syms = hot.map((h) => "$" + esc(h.symbol)).join(" · ");
  return [
    `🧺 <b>${syms}</b>`,
    "",
    "This group's thesis, as one token everyone can hold.",
    "",
    "💰 Whoever launches it earns a creator-fee slice on every trade, forever.",
  ].join("\n");
}
const suggestionCard = (hot: TickerTally[]): string => cardUrl(`idea&syms=${encodeURIComponent(hot.map((h) => h.symbol).slice(0, 8).join(","))}`);
const suggestionButtons = (): TgButtons => [[{ text: "🧺 Start the draft", data: "d:start" }, { text: "Not now", data: "d:no" }]];

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
  // a bare pasted CA (the whole message is one address) = the ask-for-intel
  // gesture — answer with the read-only token card. Deliberately narrow: only
  // an address-only message replies, so ordinary chatter is never interrupted.
  const bare = msg.text.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(bare)) {
    const t = await tokenText(bare);
    return { chatId: msg.chat.id, text: t.text, parseMode: "HTML", disablePreview: true, replyTo: msg.message_id, photoUrl: t.card };
  }
  const tickers = detectTickers(msg.text);
  if (!tickers.length) return null;
  const obs = await observe(msg.chat.id, msg.from?.id ?? 0, tickers, Date.now());
  if (!obs.suggest) return null;
  return { chatId: msg.chat.id, text: suggestionText(obs.suggest), parseMode: "HTML", disablePreview: true, buttons: suggestionButtons(), photoUrl: suggestionCard(obs.suggest) };
}

function greetingText(): string {
  return [
    "gm 🔻 I'm <b>Spectra</b>.",
    "",
    "Ask me anything about the Prism ecosystem. <code>/burn</code>, <code>/baskets</code>, <code>/price</code>.",
    "",
    "Talk tickers and I'll help this group turn them into one token. 🧺",
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
  return { chatId: ev.chat.id, text: greetingText(), parseMode: "HTML", disablePreview: true, photoUrl: cardUrl("welcome"), buttons: dmInviteButtons() };
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

async function launchDraftText(chatId: number | string): Promise<{ text: string; createHref: string | null }> {
  const d = await getDraft(chatId);
  if (d.tokens.length < MIN_BASKET_TOKENS)
    return { text: `The draft needs at least ${MIN_BASKET_TOKENS} tokens. <code>/draft</code> to see it, <code>/propose $X why</code> to add.`, createHref: null };
  const chain = draftChain(d)!;
  const tokens = d.tokens.slice(0, MAX_BASKET_TOKENS);
  const href = createUrl(
    tokens.map((t) => t.address),
    chain,
  );
  const text = [
    `🧺 <b>Launch the group basket</b> · ${chainLabel(chain)}`,
    "",
    ...tokens.map((t) => `• <b>$${esc(t.symbol)}</b> · 🔎 <a href="${dexUrl(t.chain, t.address)}">verify</a>`),
    "",
    href ? `<a href="${href}">Make it real — weights, name and signing on the create page →</a>` : CREATE_UNSET,
    "",
    "💰 Whoever launches earns a creator-fee slice on every trade. An active basket can more than cover the launch cost.",
  ].join("\n");
  return { text, createHref: href };
}
const createButton = (href: string | null): TgButtons | undefined => (href ? [[{ text: "🧺 Make it real — open the create page", url: href }]] : undefined);

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

  // a reply to the ➕ prompt IS a proposal — no command syntax needed
  if (msg.reply_to_message?.text?.startsWith("📎 Paste the token") && groupFeaturesEnabled()) {
    if (rateLimited(msg.from?.id)) return null;
    const before = (await getDraft(msg.chat.id)).tokens.length;
    const out = await proposeCmd(msg.chat.id, text.trim(), msg.from?.id ?? 0, senderName(msg));
    const d = await getDraft(msg.chat.id);
    await touchChat(msg.chat.id, msg.chat.title);
    if (d.tokens.length > before) return draftCardReply(msg.chat.id, d);
    return { chatId: msg.chat.id, text: out, parseMode: "HTML", disablePreview: true, replyTo: msg.message_id };
  }

  const m = text.match(/^\/([a-zA-Z0-9_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
  const mentioned = new RegExp(`@${BOT_USERNAME}\\b`, "i").test(text);
  if (!m && !mentioned) return null; // not addressed to us — stay quiet

  // anti-spam: drop stale/backlogged updates, then rate-limit per user (silently —
  // replying "slow down" to a flood is itself amplification).
  if (typeof msg.date === "number" && Date.now() / 1000 - msg.date > MAX_AGE_S) return null;
  if (rateLimited(msg.from?.id)) return null;

  const wrap = (body: string, photoUrl?: string, buttons?: TgButtons): TgReply => ({
    photoUrl,
    buttons,
    chatId: msg.chat.id,
    text: body,
    parseMode: "HTML",
    disablePreview: true,
    replyTo: msg.message_id,
  });

  // slash command
  if (m) {
    const cmd = m[1].toLowerCase();
    const isDm = msg.chat.type === "private";
    const args = (m[2] || "").trim();
    switch (cmd) {
      case "start": {
        // t.me/Bot?start=w_CODE — arriving from the site, wallet already known
        const payload = args.trim();
        if (isDm && /^w_[A-Z0-9]{4,10}$/i.test(payload)) {
          const addr = await claimSiteLink(payload.slice(2), msg.from?.id ?? 0);
          if (addr) {
            const a = await arrivedText(msg.from?.id ?? 0, addr);
            return wrap(a.text, a.card);
          }
          return wrap(["That link has expired.", "", "Open the site again and tap <b>Open in Telegram</b>, or send <code>/link</code> and I'll make you a fresh one."].join("\n"));
        }
        if (!isDm) return wrap(helpText(), cardUrl("help"));
        const linked = await getLinkedWallet(msg.from?.id ?? 0);
        if (linked) {
          const m3 = await meText(msg.from?.id ?? 0);
          return wrap(m3.text, m3.card);
        }
        return { chatId: msg.chat.id, text: welcomeText(), parseMode: "HTML", disablePreview: true, photoUrl: cardUrl("welcome"), buttons: welcomeButtons() };
      }
      case "help":
        return wrap(helpText(), cardUrl("help"), isDm ? undefined : dmInviteButtons());
      case "burn":
        return wrap(await burnText(), cardUrl("burn"));
      case "bigburn":
        return wrap(await bigBurnText(), cardUrl("burn"));
      case "prism":
        return wrap(await prismText(), cardUrl("prism"));
      case "baskets":
        return wrap(await basketsText(), cardUrl("baskets"));
      case "leaderboard":
      case "top":
        return wrap(await leaderboardText(), cardUrl("baskets"));
      case "basket": {
        const text = await basketText(args);
        const q = args.trim().replace(/^\$/, "").toLowerCase();
        const hit = q ? (await listIndexes()).find((b) => b.symbol.toLowerCase() === q || b.address.toLowerCase() === q) : null;
        return wrap(text, hit ? cardUrl(`bento&address=${hit.address}`) : undefined);
      }
      case "price":
        return wrap(await priceText(), cardUrl("price"));
      case "supply":
        return wrap(await supplyText(), cardUrl("burn"));
      case "earned":
      case "apy":
        return wrap(await earnedText(), cardUrl("earned"));
      case "quote": {
        const t = await quoteText(args);
        return wrap(t.text, t.card);
      }
      case "wallet":
        return wrap(await walletText(args));
      case "link": {
        if (!isDm) return wrap(DM_ONLY);
        return wrap(await linkText(msg.from?.id ?? 0, args));
      }
      case "unlink": {
        if (!isDm) return wrap(DM_ONLY);
        await unlinkWallet(msg.from?.id ?? 0);
        return wrap("👛 Unlinked. Nothing of yours is stored any more.");
      }
      case "me":
      case "myportfolio": {
        if (!isDm) return wrap(DM_ONLY);
        const mp = await meText(msg.from?.id ?? 0);
        return wrap(mp.text, mp.card);
      }
      case "pnl": {
        if (!isDm) return wrap(DM_ONLY);
        {
          const pl = await pnlText(msg.from?.id ?? 0);
          return wrap(pl.text, pl.card);
        }
      }
      case "buy": {
        const b2 = await buyText(msg.from?.id ?? 0, isDm, args);
        return wrap(b2.text, b2.card, buyButton(b2.href, undefined));
      }
      case "alerts": {
        if (!isDm) return wrap(DM_ONLY);
        return wrap(await alertsText(msg.from?.id ?? 0, args));
      }
      case "reweight": {
        if (!isDm) return wrap(DM_ONLY);
        const rw = await reweightText(msg.from?.id ?? 0, args);
        return wrap(rw.text, rw.card, createButton(rw.createHref));
      }
      case "ourbasket":
      case "mybasket":
        return wrap(await ourBasketText(msg.chat.id, args, msg.chat.title), cardUrl(`ourbasket&chat=${encodeURIComponent(String(msg.chat.id))}`));
      case "token":
      case "ti": {
        const t = await tokenText(args);
        return wrap(t.text, t.card);
      }
      case "watch":
        return wrap(await watchText(msg.chat.id, args, msg.from?.id ?? 0, msg.chat.title));
      case "unwatch":
        return wrap(await unwatchText(msg.chat.id, args));
      case "watchlist":
      case "wl":
        return wrap(await watchlistText(msg.chat.id), cardUrl(`watchlist&chat=${encodeURIComponent(String(msg.chat.id))}`));
      case "split": {
        const legs = parseSplit(args);
        const spec = legs ? legs.map((l) => `${l.weight}:${l.symbol}`).join(",") : "";
        const s = await splitText(args);
        return wrap(s.text, legs ? cardUrl(`split&spec=${encodeURIComponent(spec)}`) : undefined, createButton(s.createHref));
      }
      case "league":
        return wrap(await leagueText(), cardUrl("league"));
      case "portfolio":
      case "spectrumportfolio":
      case "portfoliostats":
        return wrap(await portfolioText(), cardUrl("portfolio"));
      case "lightrunner":
      case "game":
        return wrap(lightrunnerText(), cardUrl("lightrunner"));
      case "ca":
      case "contract":
        return wrap(caText(), cardUrl("ca"));
      case "links":
      case "socials":
        return wrap(linksText(), cardUrl("links"));
      case "createbasket":
        if (!groupFeaturesEnabled()) return wrap(comingSoonText());
        {
          const cb = await createBasketText(args);
          return wrap(cb.text, undefined, createButton(cb.createHref));
        }
      case "draft": {
        if (!groupFeaturesEnabled()) return wrap(comingSoonText());
        const d = await getDraft(msg.chat.id);
        if (!d.tokens.length) return wrap(await draftShow(msg.chat.id));
        return draftCardReply(msg.chat.id, d);
      }
      case "propose": {
        if (!groupFeaturesEnabled()) return wrap(comingSoonText());
        const before = (await getDraft(msg.chat.id)).tokens.length;
        const text = await proposeCmd(msg.chat.id, args, msg.from?.id ?? 0, senderName(msg));
        const d = await getDraft(msg.chat.id);
        await touchChat(msg.chat.id, msg.chat.title);
        // a successful add answers with the LIVING CARD; failures explain in text
        if (d.tokens.length > before) return draftCardReply(msg.chat.id, d);
        return wrap(text);
      }
      case "vote":
        return wrap(groupFeaturesEnabled() ? await voteCmd(msg.chat.id, args, msg.from?.id ?? 0) : comingSoonText());
      case "drop":
        return wrap(groupFeaturesEnabled() ? await dropCmd(msg.chat.id, args) : comingSoonText());
      case "launch": {
        if (!groupFeaturesEnabled()) return wrap(comingSoonText());
        const l = await launchDraftText(msg.chat.id);
        return wrap(l.text, undefined, createButton(l.createHref));
      }
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
