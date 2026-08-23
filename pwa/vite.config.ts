import { defineConfig } from 'vitest/config';
import { swDenylist } from './src/lib/sw-denylist.js';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Installable PWA. Updates apply themselves — main.tsx also drives periodic
    // update CHECKS, because a never-navigating SPA otherwise never asks.
    VitePWA({
      // autoUpdate: a new deploy's worker skip-waits + claims clients and the
      // page reloads onto it — no stuck-on-old-bundle (the 'prompt' default
      // needed a full app close to swap). Right for a single-user control app
      // that should always run the latest.
      registerType: 'autoUpdate',
      manifest: {
        name: 'ccrc',
        short_name: 'ccrc',
        description: 'Drive your Claude Code fleet from anywhere.',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        // --bg-page (dark, tokens.css) — the install splash and window chrome
        // match the app's glass. The app is dark-first; light is an in-app
        // [data-theme] override, so the manifest stays dark.
        background_color: '#0B0D0C',
        theme_color: '#0B0D0C',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache the app shell only: JS/CSS/HTML + icons + manifest. Server
        // state must never be cached — /api and /ws are explicitly
        // network-only (and navigations to them never fall back to the shell).
        //
        // CO-TENANTS ARE A BUILD-TIME KNOB, not a built-in list. `/docs` (a
        // docserver) and `/fleet` (a preview) are what the REFERENCE box puts
        // behind the same proxy; a stranger's install has neither, and baking
        // those paths in would ship one operator's reverse-proxy layout inside
        // everybody's service worker. The box that has co-tenants sets
        // CCRC_SW_DENYLIST in its own (gitignored) env — see
        // deploy/ccrc.env.example.
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: swDenylist(process.env['CCRC_SW_DENYLIST']),
        // Web Push handlers (push + notificationclick) live in public/push-sw.js
        // and are pulled into the generated worker.
        importScripts: ['/push-sw.js'],
        runtimeCaching: [{ urlPattern: /\/(?:api|ws)\//, handler: 'NetworkOnly' }],
      },
    }),
  ],
  // The built shell lands inside the server package: ccrc-server statically
  // serves dist-pwa/ at / with SPA fallback (server.ts findPwaRoot).
  build: {
    outDir: '../server/dist-pwa',
    emptyOutDir: true,
  },
  server: {
    // Dev proxy to a local ccrc-server (run with CCRC_HOME at a fixture tree).
    proxy: {
      '/api': { target: 'http://127.0.0.1:7788', changeOrigin: true },
      '/ws': { target: 'http://127.0.0.1:7788', changeOrigin: true, ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    // Type-level tests (*.test-d.tsx) run as part of `vitest run`. Props here
    // are contracts — a widening like Sheet's ReactNode eyebrow is invisible at
    // runtime, so without this the only thing that catches a revert is a
    // separate `tsc --noEmit` nobody is obliged to run.
    typecheck: { enabled: true },
  },
});
