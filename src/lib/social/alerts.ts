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
// Nothing here signs, sells, or moves anything. It reads and it tells.

import { getLinkedWallet, getAlertState, putAlertState, alertAllowed, noteAlertSent, getSnapshot, putSnapshot, snapshotOf, readFullPortfolio, linkedUsers } from "./dm-portfolio";
import { sendTelegramMessage } from "./telegram";

const usd = (n: number) => `$${Math.abs(n) >= 1000 ? Math.round(n).toLocaleString("en-US") : n.toFixed(2)}`;

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
        `Your position: <b>${usd(top.p.valueUsd)}</b> (${up ? "+" : "−"}${usd(Math.abs(top.usdMove))}) — ${share.toFixed(0)}% of your book.`,
        "",
        up
          ? "Take some off, or let it run: <code>/reweight</code> builds the target, <code>/pnl</code> shows the whole picture."
          : "Rebalance or hold: <code>/reweight</code> builds the target, <code>/pnl</code> shows the whole picture.",
      ].join("\n");
      if (!dryRun) {
        await sendTelegramMessage(userId, text, { parseMode: "HTML", disablePreview: true });
        st = noteAlertSent(st, top.p.address.toLowerCase(), now);
        await putAlertState(userId, st);
      }
      sent.push({ userId, kind: "move", asset: top.p.symbol });
    }

    // the snapshot always advances, so tomorrow measures from today
    if (!dryRun) await putSnapshot(userId, snapshotOf(pf));
  }

  return { users: users.length, sent };
}
