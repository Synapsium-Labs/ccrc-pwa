import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Installable PWA. Update flow is prompt-style: a new SW waits until the
    // user taps the "Update ready" toast (registered in main.tsx).
    VitePWA({
      registerType: 'prompt',
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
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/ws\//],
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
  },
});
