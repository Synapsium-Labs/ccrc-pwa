import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { swDenylist } from './src/lib/sw-denylist.js';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  // ONE REACT, ALWAYS.
  //
  // @ccrc/ui is consumed as SOURCE from a sibling folder and keeps its own
  // react/react-dom/vaul so Storybook can run standalone. Node resolves a bare
  // import from the IMPORTER outward, so ui/src/primitives/sheet.tsx — and vaul
  // and radix beneath it — all find ui/node_modules/react long before they
  // reach this package. Two React instances (19.3.0 there, 19.2.7 here), and
  // every hook the sheet calls throws "Invalid hook call".
  //
  // `dedupe` alone does NOT fix it: dedupe picks one copy among the candidates
  // the resolver already offers, and ui's copy is simply found first. These
  // aliases are absolute and unconditional, so there is only ever one
  // candidate. vaul is aliased too — otherwise it loads from ui's tree and
  // drags ui's radix, and therefore ui's react, back in behind it.
  //
  // react-dom is listed BEFORE react because vite matches alias keys by prefix
  // in insertion order, and 'react-dom' starts with 'react'.
  //
  // EVERY REACT-CALLING PACKAGE ui DEPENDS ON BELONGS IN ALL THREE LISTS
  // (dedupe, alias, and `test.server.deps.inline` below). framer-motion joined
  // when the composites migrated: `ToolCard` renders `motion`/`AnimatePresence`,
  // so it reaches react through framer-motion's copy exactly as the sheet
  // reaches it through vaul's. (NOT because of reduced motion — ui has its own
  // `usePrefersReducedMotion` precisely so that branch needs no framer import.)
  // Adding a ui dependency without adding it here fails only under test, and
  // fails as "Invalid hook call" — which reads like a bug in the component
  // rather than a second React.
  resolve: {
    dedupe: ['react', 'react-dom', 'vaul', 'framer-motion'],
    alias: {
      // `@/…` RESOLVES INTO `@ccrc/ui`'s SOURCE, not into pwa's. shadcn's CLI
      // writes `@/lib/utils`-style imports into whatever `components.json`
      // points at, and `components.json` lives in `ui/` because that is where
      // a pasted component belongs. pwa compiles ui's source directly
      // (`exports['.']` is `src/index.ts`), so pwa's bundler has to resolve
      // the alias too or the pasted file builds nowhere.
      //
      // ONE MEANING, THREE RESOLVERS: this alias, `ui/vite.config.ts`'s, and
      // `ui/tsconfig.json`'s `paths`. `pwa/test/shadcn-alias.test.ts` pins
      // that the three agree — the same seam `shared/models`' twins taught
      // this branch, where `tsc` and the bundle read different files and the
      // type check passed on a binding that was `undefined` at runtime.
      '@': fileURLToPath(new URL('../ui/src', import.meta.url)),
      'react-dom': fileURLToPath(new URL('./node_modules/react-dom', import.meta.url)),
      react: fileURLToPath(new URL('./node_modules/react', import.meta.url)),
      vaul: fileURLToPath(new URL('./node_modules/vaul', import.meta.url)),
      'framer-motion': fileURLToPath(new URL('./node_modules/framer-motion', import.meta.url)),
    },
  },
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
    // Vitest externalises anything under node_modules and lets NODE resolve it,
    // which walks past `resolve.alias` entirely. vaul then loads
    // ui/node_modules/react and every sheet test dies on a second React
    // instance. Inlining routes both through vite's pipeline, where the alias
    // above applies. The app BUILD never needed this — it bundles everything,
    // so the alias already held there.
    server: { deps: { inline: [/node_modules\/(vaul|@radix-ui|framer-motion)\//, '@ccrc/ui'] } },
  },
});
