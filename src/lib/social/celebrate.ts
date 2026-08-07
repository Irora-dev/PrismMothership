// Close the loop: when a basket LAUNCHES on-chain, find the group whose open
// draft it came from and celebrate INTO that group — "YOUR basket is live" with
// the genuine bento card — then auto-register it as the group's /ourbasket (it
// enters the league + weekly recap) and clear the draft. Creation → identity →
// competition, one unbroken chain. Called from the broadcast pass, so it runs
// on the same cadence and switches as every other auto-post.

import type { ActivityEvent } from "@/lib/feed/types";
import { listIndexes } from "@/lib/spectrum/index-data";
import { getDraft, clearDraft } from "./group-draft";
import { getRegistry, registeredChats, setGroupBasket } from "./group-registry";
import { sendTelegramMessage } from "./telegram";

// Composition match: the launched basket's holdings vs a draft's tokens.
// Weights/name are chosen on the create page and one token may get dropped
// there, so require overlap ≥2 AND ≥ draft-size-1 — strict enough that another
// group's coincidental basket doesn't trigger a false "YOURS".
function matches(draftSyms: string[], basketSyms: string[]): boolean {
  const set = new Set(basketSyms.map((s) => s.toUpperCase()));
  const hit = draftSyms.filter((s) => set.has(s.toUpperCase())).length;
  return hit >= 2 && hit >= draftSyms.length - 1;
}

export async function celebrateLaunch(e: ActivityEvent, dryRun: boolean): Promise<{ chatId: number | string; symbol: string } | null> {
  if (e.kind !== "launch" || !e.symbol) return null;
  // the launch event carries the basket's SYMBOL, not its address — resolve
  // through the discovery layer (which also survives factory rotations)
  const live = (await listIndexes()).find((b) => b.symbol.toLowerCase() === e.symbol!.toLowerCase());
  if (!live || !live.top.length) return null; // discovery hasn't caught up yet — skip quietly
  const basketSyms = live.top.map((t) => t.symbol);

  for (const chatId of (await registeredChats()).slice(0, 100)) {
    const d = await getDraft(chatId);
    if (d.tokens.length < 2) continue;
    if (!matches(d.tokens.map((t) => t.symbol), basketSyms)) continue;

    const site = (process.env.URL || "").replace(/\/$/, "");
    const text = [
      `🎉 <b>YOUR basket is live: $${live.symbol}</b>`,
      "",
      "The draft this group built just launched on-chain. Every trade now feeds the PRISM burn — and it's auto-registered as this group's basket:",
      "",
      "· /ourbasket — its live numbers, any time",
      "· /league — see how it ranks against every other group",
      site ? `${site}/baskets/${live.address}` : "",
    ].filter(Boolean).join("\n");
    if (!dryRun) {
      await sendTelegramMessage(chatId, text, {
        parseMode: "HTML",
        photoUrl: site ? `${site}/api/card?kind=bento&address=${live.address}&t=${Math.floor(Date.now() / 60_000)}` : undefined,
      });
      const reg = await getRegistry(chatId);
      await setGroupBasket(chatId, { address: live.address, chain: live.chain, symbol: live.symbol }, reg.title);
      await clearDraft(chatId, Date.now());
    }
    return { chatId, symbol: live.symbol }; // one group per launch — first match wins
  }
  return null;
}
