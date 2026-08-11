// ── The alert sweep ──────────────────────────────────────────────────────────
// Runs on a schedule and speaks only when a member would want to be
// interrupted. The whole design is restraint:
//
//   · MATERIAL — a move must clear a % AND a dollar floor, so dust never
//     speaks and a modest move on a large position still can
//   · CAPPED — at most a few a day per person, never twice about one asset
//     inside 12h
//   · ACTIONABLE — every message ends in something the reader can actually do
//   · OPT-OUT — /alerts off, honoured immediately
//
// TWO KINDS OF ALERT, and they need different rules:
//
//   A MOVE is an EVENT. It happened once, so it alerts once.
//   CLAIMABLE FEES are a STANDING BALANCE. They only grow, so "over the floor"
//     is true forever once it is true, and nudging on that would be a tap on the
//     shoulder twice a day until the user claims out of irritation. So the nudge
//     fires on a CROSSING and then remembers the level it fired at, staying quiet
//     until the balance grows materially past it or drops (they claimed).
//
// The claim nudge is the one alert that is unambiguously worth sending: it is
// money already earned and sitting there, which people genuinely forget. It still
// counts against the same daily budget as everything else.
//
// Nothing here signs, sells, or moves anything. It reads and it tells.

import { getLinkedWallet, getAlertState, putAlertState, alertAllowed, noteAlertSent, getSnapshot, putSnapshot, snapshotOf, readFullPortfolio, linkedUsers } from "./dm-portfolio";
import { sendTelegramMessage } from "./telegram";
import { Contract } from "ethers";
import { getProvider, getBaseProvider, fetchLiveStats } from "@/lib/chain/live";
import { HOOK_ABI, HOOK_ADDRESS, PRISM_WIRED } from "@/lib/prism/claim";
import { siteUrl } from "./commands";

const usd = (n: number) => `$${Math.abs(n) >= 1000 ? Math.round(n).toLocaleString("en-US") : n.toFixed(2)}`;


/** How much a wallet has sitting unclaimed, in USD, or null if unreadable.
 *  Read straight off the hook: the API route would work too, but it self-fetches
 *  a configured origin that can be a different (or down) deployment. */
async function claimableUsd(address: string): Promise<{ usd: number; eth: number; prism: number } | null> {
  if (!PRISM_WIRED) return null;
  const provider = getProvider();
  if (!provider) return null;
  try {
    const hook = new Contract(HOOK_ADDRESS, HOOK_ABI, provider);
    const [pEth, pPrism, stats] = await Promise.all([
      hook.pendingETH(address) as Promise<bigint>,
      hook.pendingPRISM(address) as Promise<bigint>,
      fetchLiveStats(provider, getBaseProvider()).catch(() => null),
    ]);
    if (!stats) return null;
    const eth = Number(pEth) / 1e18;
    const prism = Number(pPrism) / 1e18;
    const usd = eth * (stats.ethUsd || 0) + prism * (stats.prismUsd || 0);
    if (!Number.isFinite(usd) || usd < 0) return null;   // never alert on a bad read
    return { usd, eth, prism };
  } catch {
    return null;
  }
}

/** Fires on a CROSSING, not on a state. Quiet until it grows half again past the
 *  level last nudged, or drops back under the floor (which means they claimed). */
export function claimWorthSaying(usd: number, floor: number, nudgedAt: number | undefined): boolean {
  if (usd < floor) return false;
  if (!nudgedAt) return true;
  return usd >= nudgedAt * 1.5;
}

export interface SweepResult {
  users: number;
  sent: { userId: number | string; kind: string; asset?: string }[];
}

export async function sweepAlerts(dryRun: boolean): Promise<SweepResult> {
  const users = await linkedUsers();
  const sent: SweepResult["sent"] = [];
  const now = Date.now();

  for (const userId of users.slice(0, 200)) {
    const address = await getLinkedWallet(userId);
    if (!address) continue;
    let st = await getAlertState(userId);
    if (!st.prefs.on) continue;

    let pf;
    try {
      pf = await readFullPortfolio(address);
    } catch {
      continue; // a read failure is never an alert
    }
    const snap = await getSnapshot(userId);
    if (!snap) {
      await putSnapshot(userId, snapshotOf(pf));
      continue; // first sight of this wallet: learn it, say nothing
    }

    // biggest MATERIAL mover since the last snapshot, if any
    const moves = pf.positions
      .map((p) => {
        const was = snap.byAsset[p.address.toLowerCase()];
        if (!was || was.valueUsd <= 0) return null;
        // value can move because they traded; compare per-unit value so a
        // deposit doesn't read as a gain
        const wasUnit = was.balance > 0 ? was.valueUsd / was.balance : 0;
        const nowUnit = p.balance > 0 ? p.valueUsd / p.balance : 0;
        if (!wasUnit || !nowUnit) return null;
        const pctMove = ((nowUnit - wasUnit) / wasUnit) * 100;
        const usdMove = p.valueUsd - was.balance * wasUnit;
        return { p, pctMove, usdMove };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .filter((x) => Math.abs(x.pctMove) >= st.prefs.minPct && Math.abs(x.usdMove) >= st.prefs.minUsd)
      .sort((a, b) => Math.abs(b.usdMove) - Math.abs(a.usdMove));

    const top = moves.find((m) => alertAllowed(st, m.p.address.toLowerCase(), now));
    if (top) {
      const up = top.pctMove >= 0;
      const share = pf.totalUsd > 0 ? (top.p.valueUsd / pf.totalUsd) * 100 : 0;
      const text = [
        `${up ? "🟢" : "🔴"} <b>$${top.p.symbol}</b> ${up ? "+" : ""}${top.pctMove.toFixed(1)}%`,
        "",
        `Your position: <b>${usd(top.p.valueUsd)}</b> (${up ? "+" : "−"}${usd(Math.abs(top.usdMove))}) · ${share.toFixed(0)}% of your book.`,
        "",
        up
          ? "Take some off, or let it run: <code>/reweight</code> builds the target, <code>/pnl</code> shows the whole picture."
          : "Rebalance or hold: <code>/reweight</code> builds the target, <code>/pnl</code> shows the whole picture.",
      ].join("\n");
      if (!dryRun) {
        // a personal portfolio alert comes from the Spectrum bot, the one the
        // wallet was linked in
        await sendTelegramMessage(userId, text, { parseMode: "HTML", disablePreview: true }, "spectrum");
        st = noteAlertSent(st, top.p.address.toLowerCase(), now);
        await putAlertState(userId, st);
      }
      sent.push({ userId, kind: "move", asset: top.p.symbol });
    }

    // ── the claim nudge ──────────────────────────────────────────────────────
    // Only if the move alert did not already speak: one interruption per person
    // per pass, whatever the reason. Money already earned and forgotten is the
    // most useful thing this sweep can say, so it gets the slot when it is free.
    if (!top && alertAllowed(st, "claim", now)) {
      const c = await claimableUsd(address);
      if (c) {
        const floor = st.prefs.minUsd;
        if (claimWorthSaying(c.usd, floor, st.claimNudgedUsd)) {
          const parts: string[] = [];
          if (c.eth > 0) parts.push(`Ξ${c.eth < 0.01 ? c.eth.toFixed(5) : c.eth.toFixed(4)}`);
          if (c.prism > 0) parts.push(`${c.prism < 1 ? c.prism.toFixed(4) : c.prism.toFixed(2)} PRISM`);
          const text = [
            `💰 <b>${usd(c.usd)} of fees are sitting unclaimed.</b>`,
            "",
            `${parts.join(" + ")}, earned by holding PRISM. It does not expire and it keeps accruing, but it does nothing where it is.`,
            "",
            `<a href="${siteUrl()}/claim">Claim it →</a>  ·  <code>/alerts off</code> if you would rather I did not mention it.`,
          ].join("\n");
          if (!dryRun) {
            await sendTelegramMessage(userId, text, { parseMode: "HTML", disablePreview: true }, "spectrum");
            st = noteAlertSent(st, "claim", now);
            // remember the LEVEL, so a standing balance does not nudge again
            st = { ...st, claimNudgedUsd: c.usd, lastClaimNudge: now };
            await putAlertState(userId, st);
          }
          sent.push({ userId, kind: "claim" });
        } else if (c.usd < floor && st.claimNudgedUsd) {
          // dropped back under the floor: they claimed, so forget the level and
          // let the next genuine crossing speak again
          if (!dryRun) {
            st = { ...st, claimNudgedUsd: undefined };
            await putAlertState(userId, st);
          }
        }
      }
    }

    // the snapshot always advances, so tomorrow measures from today
    if (!dryRun) await putSnapshot(userId, snapshotOf(pf));
  }

  return { users: users.length, sent };
}
