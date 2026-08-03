// Scheduled warmer for /charts: hits every range on a cron so the CDN cache
// and the incremental charts store never go cold — viewers always land on a
// pre-computed response, and RPC cost stays fixed regardless of audience.
// Netlify picks this up automatically from netlify/functions (no manual setup).
const RANGES = ["24h", "1w", "1m", "1y"];

export default async () => {
  const site = process.env.URL;
  if (!site) return new Response("no site URL", { status: 200 });
  await Promise.allSettled(RANGES.map((r) => fetch(`${site}/api/charts?range=${r}`)));
  return new Response("warmed");
};

export const config = { schedule: "*/10 * * * *" };
