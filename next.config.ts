import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Navigations and Server Actions wait and retry when the signal drops
    // (inside the grocery store, say) instead of failing. See OfflineBanner.
    useOffline: true,
    // Keep pages you've visited in the browser for 5 minutes, so going back to
    // a tab shows it at once instead of asking Supabase again. Every save
    // calls refresh(), which clears this, so balances never go stale after a
    // change made here. A change from another device shows within 5 minutes,
    // or on a reload.
    staleTimes: { dynamic: 300 },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async redirects() {
    // Can I afford this? moved out of Plan: a dialog from Home, or /afford.
    return [{ source: "/plan/afford", destination: "/afford", permanent: false }];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Grocery mode needs the camera; nothing needs the mic or location.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
