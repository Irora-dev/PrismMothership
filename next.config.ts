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
};

export default nextConfig;
