import type { MetadataRoute } from "next";
import { listIndexes } from "@/lib/spectrum/index-data";
import { siteUrl } from "@/lib/site-url";

// Every public surface, so the pages are discoverable rather than found only by
// following links from the home page.
//
// The per-basket pages are included because each one now carries its own title,
// description and live composition card — a sitemap that omitted thirty-odd
// real pages would be half a sitemap. That read touches chain data, so it
// degrades: if listIndexes fails the static routes still ship. Never let a
// chain hiccup empty the sitemap.

export const revalidate = 3600;

const STATIC: { path: string; priority: number; freq: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "/", priority: 1, freq: "daily" },
  { path: "/command", priority: 0.9, freq: "hourly" },
  { path: "/flow", priority: 0.9, freq: "hourly" },
  { path: "/spectrum", priority: 0.8, freq: "hourly" },
  { path: "/burn", priority: 0.8, freq: "hourly" },
  { path: "/claim", priority: 0.7, freq: "daily" },
  { path: "/trade", priority: 0.7, freq: "daily" },
  { path: "/how-it-works", priority: 0.7, freq: "weekly" },
  { path: "/portfolio", priority: 0.6, freq: "weekly" },
  { path: "/radio", priority: 0.6, freq: "weekly" },
  { path: "/robinhood", priority: 0.6, freq: "daily" },
  { path: "/dev", priority: 0.6, freq: "weekly" },
  { path: "/contracts", priority: 0.6, freq: "weekly" },
  { path: "/studio", priority: 0.4, freq: "monthly" },
  { path: "/links", priority: 0.4, freq: "monthly" },
  { path: "/legal", priority: 0.3, freq: "yearly" },
  { path: "/privacy", priority: 0.3, freq: "yearly" },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  if (!base) return []; // no host to build absolute URLs from — an empty sitemap beats a wrong one
  const now = new Date();
  const pages: MetadataRoute.Sitemap = STATIC.map((s) => ({
    url: `${base}${s.path}`,
    lastModified: now,
    changeFrequency: s.freq,
    priority: s.priority,
  }));
  try {
    const baskets = await listIndexes();
    for (const b of baskets) {
      pages.push({
        url: `${base}/baskets/${b.address.toLowerCase()}`,
        lastModified: now,
        changeFrequency: "hourly",
        priority: 0.5,
      });
    }
  } catch {
    /* chain read failed — the static routes above still ship */
  }
  return pages;
}
