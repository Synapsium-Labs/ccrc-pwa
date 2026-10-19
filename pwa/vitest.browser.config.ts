// The real-browser leg's own vitest config (native Docs reader spec 2026-10-01 5.7): `browser/**/*.browser.test.*`
// only, each driving a real Chrome through playwright-core (`browser/harness.ts`). The hermetic run
// (`vite.config.ts`'s `test` block) excludes `browser/**`, so `npm test` never needs a browser; this config runs as
// `npm run test:browser` and as CI's `browser (pwa)` job. jsdom is the environment so a row can render production
// React and use DOMParser inside the harness; the generous timeouts are for Chrome's start on a loaded box.
// Pinned by test/browser-leg.test.ts.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['browser/**/*.browser.test.{ts,tsx}'],
    environment: 'jsdom',
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
