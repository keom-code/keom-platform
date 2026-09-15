import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const nextConfig: NextConfig = {
  // Acknowledges the webpack config Serwist adds below so `next dev`'s default
  // Turbopack doesn't refuse to start — Serwist's own `webpack()` fn is a no-op here
  // since it's disabled outside production (see the comment below).
  turbopack: {},
};

// Phase 9 (PWA): precache-only service worker via Serwist. `@serwist/next`'s
// InjectManifest plugin hooks into webpack, so it's a no-op under Turbopack — disabled
// in dev (Turbopack, and you don't want a stale SW cache while iterating anyway);
// `pnpm build` runs with `--webpack` so it actually runs for the production build that
// Phase 9's acceptance criteria (Lighthouse, offline reload) are checked against. See
// docs/ARCHITECTURE.md Section J.
export default withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV !== "production",
  // The classic webpack-based precache scan only covers webpack's own client assets
  // plus public/ files — it doesn't know about server-rendered app routes. /offline is
  // one of those, and sw.ts's navigateFallback needs it precached, so it's injected by
  // hand. Bump the revision string whenever the offline page's content changes.
  manifestTransforms: [
    (entries) => ({
      manifest: [...entries, { url: "/offline", revision: "1", size: 0 }],
      warnings: [],
    }),
  ],
})(nextConfig);
