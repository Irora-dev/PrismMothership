// Monday recap: each registered group gets its watchlist scoreboard / league
// card. Pings the tick route with weekly=1; dormant unless SOCIAL_ENABLED and
// Telegram creds are set (same switches as everything else). 16:00 UTC Mondays.
export default async () => {
  const site = process.env.URL;
  const secret = process.env.SOCIAL_TICK_SECRET;
  if (!site || !secret) return;
  await fetch(`${site}/api/social/tick?weekly=1`, { headers: { authorization: `Bearer ${secret}` } }).catch(() => {});
};
export const config = { schedule: "0 16 * * 1" };
