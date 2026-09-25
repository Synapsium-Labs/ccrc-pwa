// The CI test-selection baseline (spec §5.2 "vitest's own startup is subtracted"). This file is traced with the
// same `vitest run --config vitest.select.config.ts` invocation as every real test, and what its trace records —
// `vitest.config.ts`, `package.json`, `tsconfig.json`, the `server/test/` directory listing the `include` glob
// makes — is subtracted from every other test's record by `.github/ci/testmap.mjs`'s `subtractBaseline`. It does
// no real work on purpose: any read it performed beyond vitest's own startup would be subtracted from every test
// in the repo, hiding a real dependency.
import { describe, it, expect } from 'vitest';

describe('ci baseline', () => {
  it('does nothing beyond vitest startup', () => {
    expect(1 + 1).toBe(2);
  });
});
