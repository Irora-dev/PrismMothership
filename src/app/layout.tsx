import { siteUrl } from "@/lib/site-url";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./fonts.css";
import { RadioProvider } from "@/components/radio/radio-provider";

export const metadata: Metadata = {
  // Absolute base for og:image / twitter:image. Without this, Next falls back to
  // http://localhost:3000 and no social scraper can fetch the share image.
  // Netlify sets URL to the site's primary URL at build (custom domain or *.netlify.app).
  // Priority: host-provided URL env → the integrator's site.config.json → nothing.
  //
  // ⚠️ The last resort used to be a hardcoded https://prismmothership.com, which
  // is (a) a domain that currently serves a 404 and (b) OUR property, in a kit
  // other people deploy. An operator who forgot one env var was publishing OG
  // tags and canonical links pointing at someone else's dead site. There is no
  // safe constant to put here, so there is no constant: with nothing configured
  // Next falls back to the request's own origin, which is always right.
  // one shared resolver (lib/site-url) — robots.txt and the sitemap need the
  // identical answer, and three copies of "which host are we" is how one ends
  // up naming a domain that 404s
  metadataBase: (() => {
    const base = siteUrl();
    return base ? new URL(base) : undefined;
  })(),
  title: "The Prism Mothership",
  description:
    "An informational dashboard for the Prism token ecosystem: every buy-and-burn, every trade, every basket launch, shown live as it lands on-chain. Not investment advice.",
  // No og/twitter TITLE pinned here on purpose: unset, each page's own tab
  // title flows into its share card ("The money map · The Prism Mothership"),
  // where a pinned root title made every unfurl on the site read identically.
  // The tagline lives in the descriptions, which pages rarely override.
  openGraph: {
    description:
      "Every buy-and-burn and on-chain event across Prism and Spectrum, shown live.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    description:
      "Every buy-and-burn and on-chain event across Prism and Spectrum, shown live.",
  },
  // installed-app chrome on iOS (pairs with manifest.ts for Android/desktop)
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Mothership" },
};

export const viewport: Viewport = {
  themeColor: "#030409", // the shell's actual ground, so mobile browser chrome matches
  // dark-only site: without this, Windows/Linux scrollbars and native form
  // controls render LIGHT and glare against the near-black ground
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

// Runs BEFORE anything paints (parser-blocking, first child of body): when the
// boot intro is going to play, stamp <html data-ms-boot> so CSS covers the page
// in black from the very first frame — the site must never flash before the
// intro (the designer, 2026-08-03). Mirrors the intro's own play conditions exactly;
// the intro lifts the attribute once its overlay has painted. The timeout is a
// failsafe so a JS crash can't leave a black page.
const BOOT_COVER_JS = `try {
  if (!sessionStorage.getItem("ms-intro-played") && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.documentElement.setAttribute("data-ms-boot", "");
    setTimeout(function () { document.documentElement.removeAttribute("data-ms-boot"); }, 6000);
  }
} catch (e) {}`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: the boot-cover script stamps data-ms-boot on
    // <html> before hydration (by design), which React would otherwise flag
    // as a server/client attribute mismatch
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: BOOT_COVER_JS }} />
        <RadioProvider>{children}</RadioProvider>
      </body>
    </html>
  );
}
