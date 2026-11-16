// Characterization for the split of `single-definition.test.ts` by area (D-6928; ARCH rule (e):
// moving a test must not silently drop scanner coverage).
//
// The guard file was 9203 lines in one hunk-prone tail, and `session-hook.test.ts` cited it by line, which is why
// it could only be appended to. The split moves describes into `single-definition/<area>.test.ts` and changes
// no assertion, so the number of describes and of tests the scanners hold must be the same before and after.
// This pin counts them in whatever files hold them: the one file before the split, the directory after it.
//
// Measured on the one file at the commit before the split: 157 describes, 548 `it(` and 21 `it.each(` (895 test
// cases under vitest, which expands each `it.each`). These are FLOORS, not exact counts: an added scanner raises
// the total and needs no edit here (an exact pin would put every area PR back on one hunk), while LOWERING the
// total is the silent drop this pin exists to refuse.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(here, 'single-definition');
const LEGACY = path.join(here, 'single-definition.test.ts');

/** Every file that holds single-definition scanners: the legacy file if it still exists, and each area file. */
const scannerFiles = (): string[] => [
  ...(existsSync(LEGACY) ? [LEGACY] : []),
  ...(existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.test.ts')).sort().map((f) => path.join(DIR, f)) : []),
];

const count = (re: RegExp): number =>
  scannerFiles().reduce((n, f) => n + (readFileSync(f, 'utf8').match(re)?.length ?? 0), 0);

describe('single-definition scanners: the split moves them and drops none', () => {
  it('holds at least 157 describes, 548 it( and 21 it.each(', () => {
    expect(count(/(?<![\w.])describe(?:\.\w+)*\(/g), 'describes').toBeGreaterThanOrEqual(157);
    expect(count(/(?<![\w.])it\(/g), 'it(').toBeGreaterThanOrEqual(548);
    expect(count(/(?<![\w.])it\.each\(/g), 'it.each(').toBeGreaterThanOrEqual(21);
  });

  it('is not vacuous: the files are found', () => {
    expect(scannerFiles().length).toBeGreaterThan(0);
  });
});
