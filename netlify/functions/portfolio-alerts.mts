// Portfolio alert sweep — every 30 minutes. The route itself decides whether
// anything is worth saying (material moves only, capped per person); this just
// wakes it. Dormant unless SOCIAL_ENABLED + Telegram creds are set.
export default async () => {
  const site = process.env.URL;
  const secret = process.env.SOCIAL_TICK_SECRET;
  if (!site || !secret) return;
  await fetch(`${site}/api/social/tick?alerts=1`, { headers: { authorization: `Bearer ${secret}` } }).catch(() => {});
};
export const config = { schedule: "*/30 * * * *" };
