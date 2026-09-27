import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `shared/roster.ts` and `shared/roster-json.mjs` each declare their own
 *  `EXEC_KINDS`, by hand, and nothing compares them. `single-definition.test.ts`
 *  scans `/\.tsx?$/` over four TypeScript roots, so the `.mjs` copy is invisible
 *  to it. The asymmetry is what makes this worth a suite of its own:
 *
 *    - a kind in the PARSER but not the mirror -> `ccrc install` refuses a
 *      roster the server boots on. Loud, and recoverable.
 *    - a kind in the MIRROR but not the parser -> `ccd` gets a projection from a
 *      roster `loadConfig` refuses, and `ccrc.service` crash-loops behind a
 *      green deploy. That is the outcome the mirror's own header calls the
 *      worst available one.
 *
 *  So this extracts both literals from source text and compares the SETS. It
 *  deliberately does not import either module: importing `shared/roster.ts`
 *  would give the value, not the declaration, and a value cannot show that the
 *  two files were written to agree. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function execKindsIn(file: string): string[] {
  const src = readFileSync(path.join(root, file), 'utf8');
  const m = src.match(/EXEC_KINDS[^=]*=\s*new Set\(\[([^\]]*)\]\)/);
  if (m === null) throw new Error(`no EXEC_KINDS declaration found in ${file} - re-read it`);
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!).sort();
}

describe('EXEC_KINDS parity between the parser and its bare-Node mirror', () => {
  it('finds a declaration in both files', () => {
    expect(execKindsIn('shared/roster.ts').length).toBeGreaterThanOrEqual(4);
    expect(execKindsIn('shared/roster-json.mjs').length).toBeGreaterThanOrEqual(4);
  });

  it('the two sets are identical', () => {
    expect(execKindsIn('shared/roster-json.mjs')).toEqual(execKindsIn('shared/roster.ts'));
  });

  it('both name codex', () => {
    expect(execKindsIn('shared/roster.ts')).toContain('codex');
    expect(execKindsIn('shared/roster-json.mjs')).toContain('codex');
  });
});
