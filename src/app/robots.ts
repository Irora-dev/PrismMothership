import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

// The site had no robots.txt at all, so every crawler was guessing — including
// about the routes that should never be indexed.
//
// Disallowed, and why: /api/* is machinery (and /api/card renders a fresh PNG
// per request, so crawling it is pure cost); /setup is the dev-only wizard the
// nav already hides in production; /dev/telegram is a bot simulator; /link is a
// transient wallet-linking flow whose URLs carry one-time codes.

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/setup", "/dev/telegram", "/link"] }],
    ...(base ? { sitemap: `${base}/sitemap.xml`, host: base } : {}),
  };
}
