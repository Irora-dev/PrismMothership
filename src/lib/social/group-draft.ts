// Collaborative "draft basket" per group — the participatory create flow. Members
// /propose tokens (with a why), /vote them up, and the draft accrues into a
// launchable shape (one chain, 2–8 tokens); anyone /launch-es it to the operator
// create page. Netlify-Blobs backed (fail-open: no Blobs locally → no persistence,
// so the stateful flow is exercised in prod). The bot never signs.

import type { TokenMatch, BasketChain } from "./token-validate";

export interface DraftToken {
  symbol: string;
  address: string;
  chain: BasketChain;
  liquidityUsd: number;
  by: number; // proposer user id
  byName?: string; // proposer display name
  votes: number[]; // distinct user ids who upvoted
  note?: string; // the "why"
}
export interface Draft {
  v: 1;
  tokens: DraftToken[];
  updatedAt: number;
  startedBy?: number;
  cardMsgId?: number; // the living draft-card message (edited in place on taps)
}

const MAX = 8; // operator composer max
const emptyDraft = (): Draft => ({ v: 1, tokens: [], updatedAt: 0 });

type BlobJson = { get(k: string, o: { type: "json" }): Promise<unknown>; setJSON(k: string, v: unknown): Promise<void> };
async function draftBlob(): Promise<BlobJson | null> {
  try {
    const { getStore } = await import("@netlify/blobs");
    return getStore({ name: "prismbeat-drafts", consistency: "strong" }) as unknown as BlobJson;
  } catch {
    return null;
  }
}
const mem = new Map<string, unknown>(); // dev fallback — Blobs don't exist locally, and
// without this every stateful flow was untestable off Netlify (registry pattern)
const key = (chatId: number | string) => `d:${chatId}`;

export async function getDraft(chatId: number | string): Promise<Draft> {
  try {
    const b = await draftBlob();
    const raw = b ? await b.get(key(chatId), { type: "json" }) : mem.get(key(chatId));
    const s = raw as Draft | null | undefined;
    if (s && s.v === 1 && Array.isArray(s.tokens)) return s;
  } catch {
    /* fresh */
  }
  return emptyDraft();
}
async function save(chatId: number | string, d: Draft): Promise<void> {
  try {
    const b = await draftBlob();
    if (b) await b.setJSON(key(chatId), d);
    else mem.set(key(chatId), d);
  } catch {
    /* best-effort */
  }
}

export const draftChain = (d: Draft): BasketChain | null => (d.tokens[0]?.chain ?? null);

export type ProposeStatus = "added" | "dupe" | "chain" | "full";
export interface ProposeResult {
  status: ProposeStatus;
  draft: Draft;
  lockedChain?: BasketChain; // set on a "chain" conflict
}

// Add a validated token to the group's draft. Enforces one chain (first token
// locks it), de-dupes by address, and caps at MAX.
export async function proposeToken(chatId: number | string, t: TokenMatch, userId: number, byName: string | undefined, note: string | undefined, now: number): Promise<ProposeResult> {
  const d = await getDraft(chatId);
  const locked = draftChain(d);
  if (locked && t.chain !== locked) return { status: "chain", draft: d, lockedChain: locked };
  if (d.tokens.some((x) => x.address.toLowerCase() === t.address.toLowerCase())) return { status: "dupe", draft: d };
  if (d.tokens.length >= MAX) return { status: "full", draft: d };
  d.tokens.push({ symbol: t.symbol, address: t.address, chain: t.chain, liquidityUsd: t.liquidityUsd, by: userId || 0, byName, votes: userId ? [userId] : [], note: note || undefined });
  d.updatedAt = now;
  if (!d.startedBy) d.startedBy = userId || 0;
  await save(chatId, d);
  return { status: "added", draft: d };
}

export async function dropToken(chatId: number | string, symbol: string, now: number): Promise<Draft> {
  const d = await getDraft(chatId);
  d.tokens = d.tokens.filter((x) => x.symbol.toLowerCase() !== symbol.toLowerCase());
  d.updatedAt = now;
  await save(chatId, d);
  return d;
}

export async function voteToken(chatId: number | string, symbol: string, userId: number, now: number): Promise<Draft> {
  const d = await getDraft(chatId);
  const tok = d.tokens.find((x) => x.symbol.toLowerCase() === symbol.toLowerCase());
  if (tok && userId && !tok.votes.includes(userId)) {
    tok.votes.push(userId);
    d.updatedAt = now;
    await save(chatId, d);
  }
  return d;
}

export async function clearDraft(chatId: number | string, now: number): Promise<void> {
  await save(chatId, { ...emptyDraft(), updatedAt: now });
}

// remember which message is the group's living draft card
export async function setDraftCardMsg(chatId: number | string, msgId: number): Promise<void> {
  const dr = await getDraft(chatId);
  dr.cardMsgId = msgId;
  await save(chatId, dr);
}
