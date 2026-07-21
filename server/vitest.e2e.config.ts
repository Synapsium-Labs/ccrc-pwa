import { defineConfig } from 'vitest/config';
// Live end-to-end suite (Plan 3). Runs only when CCRC_BASE_URL is set; kept out
// of the default `vitest run` include glob so unit runs stay hermetic.
export default defineConfig({ test: { include: ['test-e2e/**/*.e2e.test.ts'], testTimeout: 340_000, hookTimeout: 60_000 } });
