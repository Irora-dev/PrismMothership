import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep the ~380MB of radio audio OUT of the serverless function bundle. The mp3s
  // are served as static CDN assets and the track listing uses the build-time
  // manifest, so the function never needs them. Without this, Netlify's Next runtime
  // traces public/radio into the function and the deploy fails with
  // "request body too large".
  outputFileTracingExcludes: {
    "*": ["public/radio/**", "**/*.mp3", "**/*.wav", "**/*.m4a", "**/*.flac"],
  },
  // The card renderer reads the brand TTFs off disk (Satori needs the bytes,
  // and a self-origin fetch from inside a function has burned us before), so
  // they have to be traced INTO the function bundle. ~120KB for all four.
  outputFileTracingIncludes: {
    "/api/card": ["public/fonts/ttf/**"],
  },
};

export default nextConfig;
