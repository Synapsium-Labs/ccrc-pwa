// The real-browser leg's own vitest config (native Docs reader spec 2026-10-01 5.7): `browser/**/*.browser.test.*`
// only, each driving a real Chrome through playwright-core (`browser/harness.ts`). The hermetic run
// (`vite.config.ts`'s `test` block) excludes `browser/**`, so `npm test` never needs a browser; this config runs as
// `npm run test:browser` and as CI's `browser (pwa)` job. jsdom is the environment so a row can render production
// React and use DOMParser inside the harness; the generous timeouts are for Chrome's start on a loaded box. The files
// that set the leg's wall time start first (`browser/slowFirst.ts`). The production PWA is built ONCE per run, by the
// global setup (`browser/globalSetup.ts`), and every file serves that sealed build; under CI's `--shard=i/n` each shard
// is a run of its own, so each builds once. Pinned by test/browser-leg.test.ts and test/browser-dist.test.ts.
import { defineConfig } from 'vitest/config';
import { SlowFirstSequencer } from './browser/slowFirst.js';

export default defineConfig({
  // This config is a standalone defineConfig: it does not inherit vite.config.ts, so the allow list is stated again here.
  // pwa has no workspace root above it, so the dev server and vitest would allow pwa/ alone, and @ccrc/ui resolves
  // through its symlink to ../ui: a `?raw` read of its stylesheets (docs/export/stylesheet.ts) is refused outside
  // the allow list. Setting `allow` replaces the default, so '.' keeps pwa's own root. The production build is not
  // affected.
  server: { fs: { allow: ['.', '../ui'] } },
  test: {
    include: ['browser/**/*.browser.test.{ts,tsx}'],
    environment: 'jsdom',
    testTimeout: 60000,
    hookTimeout: 60000,
    sequence: { sequencer: SlowFirstSequencer },
    globalSetup: ['browser/globalSetup.ts'],
  },
});
