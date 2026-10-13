import { defineConfig } from 'vitest/config';
import { swDenylist } from './src/lib/sw-denylist.js';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import type { Plugin } from 'vite';
import { createRequire } from 'node:module';

// The worker bundle resolves `decode-named-character-reference` (reached through
// remark-gfm and micromark) to its plain `index.js`, never its `browser` entry,
// `index.dom.js`, which decodes through `document.createElement` at module load.
// A worker has no `document`, so that entry throws before the worker can answer,
// and every parse sent to it ends `worker-failed` (review 408, F1). Vite 8 has no
// worker-scoped `resolve.conditions` (its worker config takes `format`, `plugins`
// and `rolldownOptions`, and a worker plugin's `config` hook is overridden by the
// main resolved config), so this plugin, given only to `worker.plugins`, maps the
// one package; the main-thread bundle keeps its `browser` entry. The built chunk
// is loaded with no `document` by test/markdown-worker-built.test.ts.
function workerSafeEntries(): Plugin {
  return {
    name: 'ccrc-worker-safe-entries',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (source !== 'decode-named-character-reference') return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved?.id.endsWith('/index.dom.js')) return null;
      return { ...resolved, id: resolved.id.slice(0, -'index.dom.js'.length) + 'index.js' };
    },
  };
}

// The dev server does not bundle the worker: it serves the worker's modules from
// the main graph, whose pre-bundled dependencies take the `browser` entry, so
// `vite dev` would answer every chat message over 4 KiB as plain text. Under
// `serve` only, and never under vitest (whose jsdom main thread keeps the entry a
// browser ships), the package is aliased to its plain entry for both threads.
// Node's resolution of the bare name takes its `default` export, `index.js`.
function devWorkerSafeEntries(): Plugin {
  return {
    name: 'ccrc-dev-worker-safe-entries',
    apply: (_config, env) => env.command === 'serve' && process.env['VITEST'] === undefined,
    config: () => ({
      resolve: {
        alias: [{
          find: /^decode-named-character-reference$/,
          replacement: createRequire(import.meta.url).resolve('decode-named-character-reference'),
        }],
      },
    }),
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    devWorkerSafeEntries(),
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
        // CO-TENANTS ARE A BUILD-TIME KNOB, not a built-in list. A box may put
        // a wiki at `/wiki` and a preview at `/fleet` behind the same proxy; a
        // stranger's install has neither, and baking those paths in would ship
        // one operator's reverse-proxy layout inside everybody's service worker.
        // The box that has co-tenants sets CCRC_SW_DENYLIST on the deploying
        // machine — see deploy/deploy.sh's header. An entry covering `/docs`,
        // ccrc's own Docs pages, fails the build (src/lib/sw-denylist.ts).
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
  // The Markdown parse worker (src/lib/markdownWorker.ts, spawned by
  // src/lib/markdownRunner.ts) is bundled as an ES module worker, with its own
  // resolution of one package (workerSafeEntries, below).
  worker: { format: 'es', plugins: () => [workerSafeEntries()] },
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
