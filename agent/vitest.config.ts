import { defineConfig } from 'vitest/config';
// `setupFiles` is a safety mechanism here, not configuration: it puts a harmless
// `tmux` earliest on PATH for every agent test process, so a whitelist bug can
// never let a negative test's `tmux kill-server` reach the real server. See
// test/contain-path.setup.ts for what it cost to learn that. Pinned by
// test/contain-path.test.ts.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/contain-path.setup.ts'],
  },
});
