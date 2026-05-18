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
        runtimeCaching: [
          {
            // OpenFreeMap tile and style requests
            urlPattern: ({ url }) =>
              url.hostname.endsWith("openfreemap.org") ||
              url.hostname.endsWith("versatiles.org"),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "map-tiles",
              expiration: {
                maxEntries: 2000,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
            },
          },
          {
            // BRouter routing responses
            urlPattern: ({ url }) => url.hostname === "brouter.de",
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "brouter-legs",
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 14, // 14 days
              },
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
