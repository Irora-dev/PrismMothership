import type { MetadataRoute } from "next";

// The web app manifest: "Add to home screen" on Android/desktop installs the
// site as a standalone app wearing the pixel-rainbow mark on the site's own
// ground, instead of a browser shortcut with a generic frame.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "The Prism Mothership",
    short_name: "Mothership",
    description:
      "An informational dashboard for the Prism token ecosystem: every buy-and-burn, every trade, every basket launch, shown live as it lands on-chain.",
    start_url: "/",
    display: "standalone",
    background_color: "#030409",
    theme_color: "#030409",
    icons: [
      { src: "/icon.png", sizes: "256x256", type: "image/png" },
      { src: "/token/prism-logo-512.png", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
