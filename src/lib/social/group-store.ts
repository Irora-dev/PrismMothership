// Per-group ticker-mention store for the chat→basket suggestion engine.
// Netlify-Blobs backed (same pattern as broadcast.ts), fail-open: no Blobs (e.g.
// local dev) → it simply doesn't persist, so nothing suggests. Records mentions
// in a rolling window and decides — with a cooldown + set-dedup so it can't nag —
// when a cluster is hot enough to suggest a basket.

import { suggestible, type TickerTally } from "./group-signal";

const WINDOW_MS = 3 * 86_400_000; // rolling window for "hot" tickers
const MAX_MENTIONS = 2000; // bound per group
const SUGGEST_COOLDOWN_MS = 12 * 3_600_000; // at most one suggestion per group / 12h
const MIN_BASKET = 2; // need at least a pair of hot tickers to suggest

interface Mention {
  s: string; // symbol
  u: number; // user id
  t: number; // ts (ms)
}
interface GroupState {
  v: 1;
  mentions: Mention[];
  lastSuggestTs: number;
  suggestedKeys: string[]; // symbol-sets already suggested (so we don't repeat)
}

type BlobJson = { get(k: string, o: { type: "json" }): Promise<unknown>; setJSON(k: string, v: unknown): Promise<void> };
async function groupBlob(): Promise<BlobJson | null> {
  try {
    const { getStore } = await import("@netlify/blobs");
    return getStore({ name: "prismbeat-groups", consistency: "strong" }) as unknown as BlobJson;
  } catch {
    return null;
  }
}
const key = (chatId: number | string) => `g:${chatId}`;

async function load(chatId: number | string): Promise<GroupState> {
  try {
    const b = await groupBlob();
    const s = b ? ((await b.get(key(chatId), { type: "json" })) as GroupState | null) : null;
    if (s && s.v === 1 && Array.isArray(s.mentions)) return s;
  } catch {
    /* fresh */
  }
  return { v: 1, mentions: [], lastSuggestTs: 0, suggestedKeys: [] };
}
async function save(chatId: number | string, s: GroupState): Promise<void> {
  try {
    const b = await groupBlob();
    if (b) await b.setJSON(key(chatId), s);
  } catch {
    /* best-effort */
  }
}

function computeTally(mentions: Mention[], now: number): TickerTally[] {
  const map = new Map<string, { mentions: number; users: Set<number> }>();
  for (const m of mentions) {
    if (now - m.t >= WINDOW_MS) continue;
    const e = map.get(m.s) || { mentions: 0, users: new Set<number>() };
    e.mentions++;
    e.users.add(m.u);
    map.set(m.s, e);
  }
  return [...map.entries()].map(([symbol, e]) => ({ symbol, mentions: e.mentions, users: e.users.size }));
}

export interface Observation {
  tally: TickerTally[];
  suggest: TickerTally[] | null; // non-null → post a suggestion for this hot set
}

// Record a message's tickers and decide whether to suggest a basket now.
// One Blob read + one write per call.
export async function observe(chatId: number | string, userId: number, symbols: string[], now: number): Promise<Observation> {
  const st = await load(chatId);
  for (const sym of symbols) st.mentions.push({ s: sym, u: userId || 0, t: now });
  st.mentions = st.mentions.filter((m) => now - m.t < WINDOW_MS).slice(-MAX_MENTIONS);

  const tally = computeTally(st.mentions, now);
  const hot = suggestible(tally);
  let suggest: TickerTally[] | null = null;
  if (hot.length >= MIN_BASKET) {
    const k = hot
      .map((h) => h.symbol)
      .sort()
      .join("+");
    const cooled = now - st.lastSuggestTs > SUGGEST_COOLDOWN_MS;
    if (cooled && !st.suggestedKeys.includes(k)) {
      suggest = hot;
      st.lastSuggestTs = now;
      st.suggestedKeys = [...st.suggestedKeys, k].slice(-20);
    }
  }
  await save(chatId, st);
  return { tally, suggest };
}

// The tickers currently "hot" in a group's chatter (crosses the suggestion
// threshold). Powers the proactive "make a basket?" nudge. Read-only.
export async function hotTickers(chatId: number | string, now: number): Promise<string[]> {
  const st = await load(chatId);
  return suggestible(computeTally(st.mentions, now)).map((t) => t.symbol);
}

// ALL tickers mentioned recently in the group (broader than "hot"), ranked by
// mentions then recency. Feeds the draft's chain-aware candidate suggestions.
export async function recentTickers(chatId: number | string, now: number, limit = 12): Promise<string[]> {
  const st = await load(chatId);
  const lastSeen = new Map<string, number>();
  for (const m of st.mentions) if (now - m.t < WINDOW_MS) lastSeen.set(m.s, Math.max(lastSeen.get(m.s) ?? 0, m.t));
  return computeTally(st.mentions, now)
    .sort((a, b) => b.mentions - a.mentions || (lastSeen.get(b.symbol) ?? 0) - (lastSeen.get(a.symbol) ?? 0))
    .slice(0, limit)
    .map((t) => t.symbol);
}
