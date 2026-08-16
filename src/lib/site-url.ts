// ── Where this deployment lives ──────────────────────────────────────────────
// ONE resolution, shared by the root metadata, robots.txt and the sitemap. It
// was inline in layout.tsx; robots and the sitemap need the identical answer,
// and three copies of "which host are we" is how one of them ends up naming a
// domain that 404s (which is exactly what site.config.json did until
// 2026-08-15: it said prismmothership.com, which returns 404, while the live
// host is prismmothership.xyz).
//
// Netlify sets URL/DEPLOY_PRIME_URL automatically, so those win; the config
// file is the last resort for a self-hosted kit.

export function siteUrl(): string | null {
  const configured =
    process.env.URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.DEPLOY_PRIME_URL ||
    (() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return (require("../../site.config.json") as { siteUrl?: string }).siteUrl || "";
      } catch {
        return "";
      }
    })();
  if (!configured) return null;
  try {
    return new URL(configured).origin; // validates, and strips any stray path
  } catch {
    return null; // a malformed env must never take a page down
  }
}
