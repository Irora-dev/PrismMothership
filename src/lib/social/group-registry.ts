// Per-group registry: the group's OWN basket (/ourbasket) and its watchlist
// (/watch · /watchlist), plus a global chat index so the weekly recap and the
// group league can enumerate every registered group. Netlify-Blobs backed like
// the other group stores — but with an in-memory fallback so the whole flow is
// exercisable in local dev (the older stores fail open to nothing, which made
// the stateful flows untestable off Netlify; per-instance memory is exactly
// what dev needs and quietly irrelevant in prod where Blobs exist).

// Chains are stored as plain strings, deliberately: a Spectrum factory/chain
// rotation must never make old blobs unparseable. Resolution always happens at
// READ time through the site's discovery layer (listIndexes/getIndexData),
// which owns which factories are real — the registry only anchors addresses.
export interface WatchEntry {
  address: string;
  symbol: string;
  chain: string;
  priceAtAdd: number; // USD at /watch time — performance is measured from here
  addedAt: number; // ms
  by?: number; // user id
}
export interface GroupRegistry {
  v: 1;
  title?: string; // chat title, for the league standings
  basket?: { address: string; chain: string; symbol: string };
  watchlist: WatchEntry[];
}
interface ChatIndex {
  v: 1;
  chats: (number | string)[];
}

export const MAX_WATCHLIST = 12;

type BlobJson = { get(k: string, o: { type: "json" }): Promise<unknown>; setJSON(k: string, v: unknown): Promise<void> };
async function blob(): Promise<BlobJson | null> {
  try {
    const { getStore } = await import("@netlify/blobs");
    return getStore({ name: "prismbeat-registry", consistency: "strong" }) as unknown as BlobJson;
  } catch {
    return null;
  }
}
const mem = new Map<string, unknown>(); // dev fallback (single process)
const rkey = (chatId: number | string) => `r:${chatId}`;
const INDEX_KEY = "chat-index";

const emptyReg = (): GroupRegistry => ({ v: 1, watchlist: [] });

export async function getRegistry(chatId: number | string): Promise<GroupRegistry> {
  try {
    const b = await blob();
    const raw = b ? await b.get(rkey(chatId), { type: "json" }) : mem.get(rkey(chatId));
    const s = raw as GroupRegistry | null | undefined;
    if (s && s.v === 1 && Array.isArray(s.watchlist)) return s;
  } catch {
    /* fresh */
  }
  return emptyReg();
}
async function saveRegistry(chatId: number | string, r: GroupRegistry): Promise<void> {
  try {
    const b = await blob();
    if (b) await b.setJSON(rkey(chatId), r);
    else mem.set(rkey(chatId), r);
  } catch {
    /* best-effort */
  }
}

async function getIndex(): Promise<ChatIndex> {
  try {
    const b = await blob();
    const raw = b ? await b.get(INDEX_KEY, { type: "json" }) : mem.get(INDEX_KEY);
    const s = raw as ChatIndex | null | undefined;
    if (s && s.v === 1 && Array.isArray(s.chats)) return s;
  } catch {
    /* fresh */
  }
  return { v: 1, chats: [] };
}
async function indexChat(chatId: number | string): Promise<void> {
  const ix = await getIndex();
  if (!ix.chats.some((c) => String(c) === String(chatId))) {
    ix.chats.push(chatId);
    try {
      const b = await blob();
      if (b) await b.setJSON(INDEX_KEY, ix);
      else mem.set(INDEX_KEY, ix);
    } catch {
      /* best-effort */
    }
  }
}

/** put a chat on the index without registering anything — drafting counts:
 * the launch-celebration matcher must be able to find chats with open drafts */
export async function touchChat(chatId: number | string, title?: string): Promise<void> {
  if (title) {
    const r = await getRegistry(chatId);
    if (r.title !== title) {
      r.title = title;
      await saveRegistry(chatId, r);
    }
  }
  await indexChat(chatId);
}

/** every chat that has registered anything — the weekly recap + league roster */
export async function registeredChats(): Promise<(number | string)[]> {
  return (await getIndex()).chats;
}

export async function setGroupBasket(
  chatId: number | string,
  basket: { address: string; chain: string; symbol: string },
  title?: string,
): Promise<void> {
  const r = await getRegistry(chatId);
  r.basket = basket;
  if (title) r.title = title;
  await saveRegistry(chatId, r);
  await indexChat(chatId);
}
export async function clearGroupBasket(chatId: number | string): Promise<void> {
  const r = await getRegistry(chatId);
  delete r.basket;
  await saveRegistry(chatId, r);
}

export type WatchStatus = "added" | "dupe" | "full";
export async function addWatch(chatId: number | string, e: WatchEntry, title?: string): Promise<WatchStatus> {
  const r = await getRegistry(chatId);
  if (r.watchlist.some((w) => w.address.toLowerCase() === e.address.toLowerCase())) return "dupe";
  if (r.watchlist.length >= MAX_WATCHLIST) return "full";
  r.watchlist.push(e);
  if (title) r.title = title;
  await saveRegistry(chatId, r);
  await indexChat(chatId);
  return "added";
}
export async function removeWatch(chatId: number | string, symbolOrAddress: string): Promise<boolean> {
  const r = await getRegistry(chatId);
  const q = symbolOrAddress.trim().replace(/^\$/, "").toLowerCase();
  const before = r.watchlist.length;
  r.watchlist = r.watchlist.filter((w) => w.symbol.toLowerCase() !== q && w.address.toLowerCase() !== q);
  if (r.watchlist.length === before) return false;
  await saveRegistry(chatId, r);
  return true;
}
