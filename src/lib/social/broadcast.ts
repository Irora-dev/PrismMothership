import type { JsonRpcProvider } from "ethers";
import type { ActivityEvent } from "@/lib/feed/types";
import { fetchHistory } from "@/lib/chain/live";
import { fmtEth, fmtPrism } from "@/lib/feed/format";
import { eventShareUrl } from "@/lib/feed/share";
import { postTelegram, telegramEnabled } from "./telegram";
import { celebrateLaunch } from "./celebrate";
import { postX, xEnabled } from "./x";

// ── Auto-share broadcaster ────────────────────────────────────────────────────
// One scheduled pass: find burns/launches newer than the last watermark, post
// them to whichever channels are configured (Telegram / X), and advance the
// watermark. Idempotent by design — a re-run never reposts (dedup by event id +
// a time high-water mark). Fully dormant unless SOCIAL_ENABLED is set AND at
// least one channel is configured; SOCIAL_DRY_RUN previews without posting.
//
// ⚠️ These go out UNATTENDED and OUTWARD. Templates are fact-only (amounts,
// tickers, links — no projections/hype) and should be human-approved before the
// master switch is flipped on. The bot only ever fills in on-chain numbers.

const MAX_PER_TICK = Number(process.env.SOCIAL_MAX_PER_TICK) || 4;
const COLD_LOOKBACK_MIN = Number(process.env.SOCIAL_COLD_LOOKBACK_MIN) || 30;
const POSTED_IDS_CAP = 500;

interface SocialState {
  v: 1;
  sinceTs: number; // don't post anything older than this
  postedIds: string[]; // recent event ids already posted (bounded)
}

type BlobJson = { get(k: string, o: { type: "json" }): Promise<unknown>; setJSON(k: string, v: unknown): Promise<void> };
async function socialBlob(): Promise<BlobJson | null> {
  try {
    const { getStore } = await import("@netlify/blobs");
    return getStore({ name: "prismbeat-social", consistency: "strong" }) as unknown as BlobJson;
  } catch {
    return null;
  }
}
async function loadState(): Promise<SocialState> {
  try {
    const blobs = await socialBlob();
    const snap = blobs ? ((await blobs.get("state", { type: "json" })) as SocialState | null) : null;
    if (snap && snap.v === 1 && Array.isArray(snap.postedIds)) return snap;
  } catch {
    /* fresh */
  }
  return { v: 1, sinceTs: Date.now() - COLD_LOOKBACK_MIN * 60_000, postedIds: [] };
}
async function saveState(s: SocialState): Promise<void> {
  try {
    const blobs = await socialBlob();
    if (blobs) await blobs.setJSON("state", s);
  } catch {
    /* best-effort — a missed save means a possible re-attempt, dedup still guards */
  }
}

// ── Copy templates (fact-only; edit here) ─────────────────────────────────────
function messageFor(e: ActivityEvent): string | null {
  const link = eventShareUrl(e);
  if (e.kind === "launch") {
    const name = e.label || (e.symbol ? `$${e.symbol}` : "A new basket");
    const tag = e.symbol && e.label ? ` ($${e.symbol})` : "";
    return `🧺 New basket live on Spectrum\n\n${name}${tag} just launched. One token, the whole basket — every trade feeds the PRISM burn.\n\n${link}`;
  }
  if (e.kind === "burn") {
    if (e.prism && e.prism > 0) {
      return `🔥 PRISM buy & burn\n\n${fmtPrism(e.prism)} PRISM bought and burned — gone from the 5,000 cap forever.\n\n${link}`;
    }
    if (e.eth && e.eth > 0) {
      return `🔥 Spectrum revenue → PRISM burn\n\nΞ${fmtEth(e.eth)} of basket revenue is on its way to buy & burn PRISM.\n\n${link}`;
    }
  }
  return null;
}

export interface BroadcastResult {
  enabled: { telegram: boolean; x: boolean };
  armed: boolean;
  dryRun: boolean;
  candidates: { id: string; kind: string; text: string }[];
  posted: { id: string; telegram?: boolean; x?: boolean }[];
  note?: string;
}

export async function broadcast(
  eth: JsonRpcProvider | null,
  base: JsonRpcProvider | null,
  opts: { dryRun?: boolean } = {},
): Promise<BroadcastResult> {
  const enabled = { telegram: telegramEnabled(), x: xEnabled() };
  const armed = process.env.SOCIAL_ENABLED === "1" || process.env.SOCIAL_ENABLED === "true";
  const dryRun = opts.dryRun || process.env.SOCIAL_DRY_RUN === "1";
  const base0: BroadcastResult = { enabled, armed, dryRun, candidates: [], posted: [] };

  if (!eth) return { ...base0, note: "no provider (demo mode)" };
  // dry-run bypasses the arm gate so you can preview the copy before flipping it on
  if (!armed && !dryRun) return { ...base0, note: "SOCIAL_ENABLED not set — dormant" };
  if (!enabled.telegram && !enabled.x && !dryRun) return { ...base0, note: "no channel configured" };

  const state = await loadState();
  const seen = new Set(state.postedIds);

  // Burns + launches, newest history (cached in live.ts). One on-chain action can
  // emit several logs (a burn tx with multiple legs), so COLLAPSE BY TX HASH —
  // one post per transaction, amounts summed — and dedup by tx hash too. Copy the
  // events (never mutate live.ts's cached history).
  const [burns, launches] = await Promise.all([
    fetchHistory("burn", eth, base).catch(() => [] as ActivityEvent[]),
    fetchHistory("launch", eth, base).catch(() => [] as ActivityEvent[]),
  ]);
  const byTx = new Map<string, ActivityEvent>();
  for (const e of [...burns, ...launches]) {
    if (!e.txHash) continue;
    const cur = byTx.get(e.txHash);
    if (!cur) byTx.set(e.txHash, { ...e });
    else {
      cur.prism = (cur.prism ?? 0) + (e.prism ?? 0);
      cur.eth = (cur.eth ?? 0) + (e.eth ?? 0);
    }
  }
  const fresh = [...byTx.values()]
    .filter((e) => e.ts >= state.sinceTs && !seen.has(e.txHash!) && messageFor(e) != null)
    .sort((a, b) => a.ts - b.ts)
    .slice(0, MAX_PER_TICK);

  const candidates = fresh.map((e) => ({ id: e.txHash!, kind: e.kind, text: messageFor(e)! }));
  if (dryRun) return { ...base0, candidates, note: "dry run — nothing posted, watermark unchanged" };

  const posted: BroadcastResult["posted"] = [];
  let maxTs = state.sinceTs;
  for (const e of fresh) {
    const text = messageFor(e)!;
    // event-specific live card (falls back to the generic OG image)
    const img = process.env.URL
      ? e.kind === "burn" && e.prism
        ? `${process.env.URL}/api/card?kind=burn-event&prism=${encodeURIComponent(String(e.prism))}`
        : e.kind === "launch"
          ? `${process.env.URL}/api/card?kind=launch&symbol=${encodeURIComponent(e.symbol || "")}&name=${encodeURIComponent(e.label || "")}&chain=${encodeURIComponent(e.chain || "")}`
          : `${process.env.URL}/opengraph-image`
      : undefined;
    // a launch may be a GROUP's draft come true — celebrate into that group
    if (e.kind === "launch") await celebrateLaunch(e, opts?.dryRun ?? false).catch(() => null);
    const [tg, x] = await Promise.all([
      enabled.telegram ? postTelegram(text, img) : Promise.resolve({ ok: false }),
      enabled.x ? postX(text) : Promise.resolve({ ok: false }),
    ]);
    // Mark posted once we've attempted every enabled channel and at least one
    // succeeded — a missed post beats a duplicate, so we advance regardless of a
    // single transient channel failure (logged in the result).
    const anyOk = (enabled.telegram && tg.ok) || (enabled.x && x.ok);
    if (anyOk) {
      seen.add(e.txHash!);
      maxTs = Math.max(maxTs, e.ts);
      posted.push({ id: e.txHash!, ...(enabled.telegram ? { telegram: tg.ok } : {}), ...(enabled.x ? { x: x.ok } : {}) });
    }
  }

  const postedIds = [...seen].slice(-POSTED_IDS_CAP);
  await saveState({ v: 1, sinceTs: maxTs, postedIds });
  return { ...base0, candidates, posted };
}

// ── Daily digest — one evening summary post (netlify/functions/daily-digest.mts) ──
export async function dailyDigestText(eth: ReturnType<typeof Object> | null, base: ReturnType<typeof Object> | null): Promise<string | null> {
  try {
    const { fetchLiveStats } = await import("@/lib/chain/live");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = await fetchLiveStats(eth as any, base as any);
    if (!s) return null;
    const site = (process.env.URL || "https://prismbeat.netlify.app").replace(/\/$/, "");
    const usd = (v: number) => `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
    return [
      "🔻 <b>PRISM daily</b>",
      "",
      `· Fees to holders (24h): <b>${usd(s.feesToHolders24h * s.ethUsd)}</b>`,
      `· PRISM burned (24h): ${s.prismBurnedToday.toFixed(4)} — ${s.totalBurned.toFixed(2)} all-time of 5,000`,
      `· Live baskets: ${s.indexCount}`,
      "",
      "Figures track third-party trading; they vary and can be zero.",
      site,
    ].join("\n");
  } catch {
    return null;
  }
}
