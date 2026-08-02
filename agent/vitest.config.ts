import { defineConfig } from 'vitest/config';
// `setupFiles` is a safety mechanism here, not configuration: it puts a harmless
// `tmux` earliest on PATH for every agent test process, so a whitelist bug can
// never let a negative test's `tmux kill-server` reach the real server. See
// test/contain-path.setup.ts for what it cost to learn that. Pinned by
// test/contain-path.test.ts.
// `globalSetup` is the other half of the same safety mechanism, added for tests
// finding 1. The setup file above makes its stub directory at MODULE SCOPE,
// which runs BEFORE the test module is imported — so a test module that THROWS
// AT IMPORT (the shape `whitelist.ts` produces on purpose) leaves the directory
// behind with no vitest hook to remove it. This entry makes one run-scoped root
// in vitest's MAIN process and removes it there afterwards, which is the only
// cleanup the worker pool cannot skip. An exit handler inside the setup file
// was tried first and measured insufficient: the default pool is `forks` and
// tinypool destroys workers. See test/contain-path.globalsetup.ts.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/contain-path.setup.ts'],
    globalSetup: ['test/contain-path.globalsetup.ts'],
  },
});
