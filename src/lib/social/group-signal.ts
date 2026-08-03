// DARK foundation for the group-basket features. Gated by GROUP_FEATURES_ENABLED
// and further inert until the bot's Telegram privacy mode is turned off (so it can
// actually read group chatter). Pure, testable logic lives here; the Telegram
// message listener, the persistent per-group tally store, and the non-custodial
// create/sign handoff (operator app) are staged slices — see SOCIAL-BOT.md.

// Pull $TICKER symbols out of a chat message. Uppercased, de-duped, length-bounded.
export function detectTickers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\$([A-Za-z][A-Za-z0-9]{1,14})\b/g)) out.add(m[1].toUpperCase());
  return [...out];
}

export interface TickerTally {
  symbol: string;
  mentions: number; // total mentions in the window
  users: number; // DISTINCT users who mentioned it
}

// Which tickers are "hot" enough to suggest turning into a basket. Requires
// breadth (distinct users — so one person can't spam a ticker into a suggestion)
// AND volume. This is the anti-gaming guard for the suggestion engine.
export function suggestible(
  tallies: TickerTally[],
  opts: { minUsers?: number; minMentions?: number; top?: number } = {},
): TickerTally[] {
  const { minUsers = 3, minMentions = 5, top = 5 } = opts;
  return tallies
    .filter((t) => t.users >= minUsers && t.mentions >= minMentions)
    .sort((a, b) => b.mentions - a.mentions || b.users - a.users)
    .slice(0, top);
}
