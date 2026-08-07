// Daily digest: one scheduled evening post — fees today, PRISM burned, baskets.
// Pings the tick route with digest=1; dormant unless SOCIAL_ENABLED + Telegram
// creds are set (same switches as the auto-poster). 18:00 UTC daily.
export default async () => {
  const site = process.env.URL;
  const secret = process.env.SOCIAL_TICK_SECRET;
  if (!site || !secret) return;
  await fetch(`${site}/api/social/tick?digest=1`, { headers: { authorization: `Bearer ${secret}` } }).catch(() => {});
};
export const config = { schedule: "0 18 * * *" };
