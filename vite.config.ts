import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { VitePWA } from "vite-plugin-pwa";

// `pnpm dev:https` (sets VITE_HTTPS=1) enables a self-signed HTTPS dev server.
// We need this so iOS Safari grants geolocation permission on a LAN IP
// (Safari only treats `localhost` and HTTPS origins as secure contexts).
declare const process: { env: Record<string, string | undefined> };
const enableHttps = process.env.VITE_HTTPS === "1";

// Served from a GitHub project site (https://<user>.github.io/run-mapper/),
// so all built asset URLs and the PWA scope must be prefixed with the repo name.
// If you ever fork or rename the repo, update this and the PWA paths below.
const BASE = "/run-mapper/";

// https://vite.dev/config/
export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    ...(enableHttps ? [basicSsl()] : []),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/*"],
      manifest: {
        name: "RunMapper",
        short_name: "RunMapper",
        description:
          "Plan, edit, save and load GPX running routes on a map.",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        orientation: "any",
        start_url: BASE,
        scope: BASE,
        icons: [
          {
            src: "icons/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "icons/icon-maskable.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Don't precache map tiles or routing — handled by runtimeCaching.
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        navigateFallback: `${BASE}index.html`,
        // If you change any runtimeCaching shape, bump the cache version
        // suffixes (`-v2`, `-v3`, ...) so iOS standalone PWAs abandon the
        // old caches instead of serving stale entries left over from the
        // previous SW. `cleanupOutdatedCaches()` only sweeps Workbox's
        // precache, not these runtime caches.
        runtimeCaching: [
          {
            // OpenFreeMap tile / style / sprite requests.
            //
            // We deliberately exclude /fonts/* because the upstream `liberty`
            // style references font stacks the tile server doesn't always
            // host (e.g. "Noto Sans Italic"). A failed fetch inside a Workbox
            // strategy surfaces as `no-response` and bombs MapLibre with a
            // fatal error — particularly on iPad standalone PWAs. Letting
            // fonts go directly to the network means missing glyphs simply
            // don't render and the map keeps working.
            urlPattern: ({ url }) => {
              const isMapHost =
                url.hostname.endsWith("openfreemap.org") ||
                url.hostname.endsWith("versatiles.org");
              if (!isMapHost) return false;
              if (url.pathname.startsWith("/fonts/")) return false;
              return true;
            },
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "map-tiles-v2",
              cacheableResponse: { statuses: [0, 200] },
              expiration: {
                maxEntries: 2000,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
              // If both cache lookup and the SW's own fetch throw, fall
              // back to a direct browser fetch so we never surface
              // `no-response` to MapLibre. As a last resort, return an
              // empty 504 — much better than a thrown SW which iOS treats
              // as a fatal network error and which bombs the whole map.
              plugins: [
                {
                  handlerDidError: async ({
                    request,
                  }: {
                    request: Request;
                  }) => {
                    try {
                      return await fetch(request);
                    } catch {
                      return new Response("", {
                        status: 504,
                        statusText: "Gateway Timeout",
                      });
                    }
                  },
                },
              ],
            },
          },
          {
            // BRouter routing responses
            urlPattern: ({ url }) => url.hostname === "brouter.de",
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "brouter-legs-v2",
              cacheableResponse: { statuses: [0, 200] },
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 14, // 14 days
              },
              plugins: [
                {
                  handlerDidError: async ({
                    request,
                  }: {
                    request: Request;
                  }) => {
                    try {
                      return await fetch(request);
                    } catch {
                      return new Response("", {
                        status: 504,
                        statusText: "Gateway Timeout",
                      });
                    }
                  },
                },
              ],
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    host: true,
  },
});
