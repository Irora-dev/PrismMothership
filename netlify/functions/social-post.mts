// Scheduled auto-share pass: pings the secret-gated /api/social/tick every 5
// minutes so new burns/launches get posted to Telegram / X. The route itself
// stays dormant unless SOCIAL_ENABLED + a channel's credentials are set, so this
// is a harmless no-op until the bot is armed. Netlify picks this up from
// netlify/functions automatically.
export default async () => {
  const site = process.env.URL;
  const secret = process.env.SOCIAL_TICK_SECRET;
  if (!site || !secret) return new Response("social bot not configured", { status: 200 });
  try {
    const r = await fetch(`${site}/api/social/tick`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    });
    return new Response(`social tick: ${r.status}`);
  } catch (e) {
    return new Response(`social tick failed: ${e instanceof Error ? e.message : "error"}`, { status: 200 });
  }
};

export const config = { schedule: "*/5 * * * *" };
