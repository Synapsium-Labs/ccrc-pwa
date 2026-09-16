// The README's roster-mirror table, pinned to the shipped artifacts rather than
// to a fixed sentence — `server/test/readme-holds.test.ts` is the precedent and
// its header carries the argument: that paragraph "drifted the moment the second
// consumer shipped", read as true, was false, and an operator acted on it.
//
// A three-column mirror table is the easiest kind of prose to keep honest,
// because every cell names something that either exists in a named file or does
// not. So this test does not compare the table to a golden copy; it reads the
// table out of the README and RESOLVES each cell:
//
//   column 2 — a symbol or literal that must appear in `shared/roster.ts`
//   column 3 — a symbol or literal that must appear in `shared/roster-json.mjs`
//   column 4 — a CASES-row label that must appear in `server/test/gen-accounts.test.ts`
//
// A field whose mirror gate is deleted therefore reds HERE as well as in the
// byte-agreement suite, and a row added to the table with nothing behind it reds
// immediately.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string): string => readFileSync(path.join(root, rel), 'utf8');

/** The mirror table alone — from its own heading to the next blank-line-
 *  separated paragraph — so a match anywhere else in a 2200-line README cannot
 *  satisfy an assertion about this table. */
function mirrorRows(): string[][] {
  const readme = read('README.md');
  const start = readme.indexOf('#### What the parser and the mirror each check');
  expect(start, 'the mirror table\'s heading must be findable').toBeGreaterThan(-1);
  const end = readme.indexOf('\n\n**', start);
  const block = readme.slice(start, end === -1 ? undefined : end);
  return block.split('\n')
    .filter((l) => l.startsWith('| `'))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
}

describe('README: the roster mirror table', () => {
  it('has a row per field this wave added, and no more', () => {
    const fields = mirrorRows().map((r) => r[0]);
    expect(fields).toEqual([
      '`hidden`', '`exec.secretsFile`', '`exec.provider`', '`exec.baseUrl`', '`exec.models`',
    ]);
  });

  it('every parser rule it names is in shared/roster.ts', () => {
    const src = read('shared/roster.ts');
    for (const [field, rule] of mirrorRows()) {
      for (const sym of (rule ?? '').match(/`([^`]+)`/g) ?? []) {
        expect(src, `${field}: shared/roster.ts does not contain ${sym}`)
          .toContain(sym.replace(/`/g, ''));
      }
    }
  });

  it('every mirror line it names is in shared/roster-json.mjs', () => {
    const src = read('shared/roster-json.mjs');
    for (const [field, , mirror] of mirrorRows()) {
      for (const sym of (mirror ?? '').match(/`([^`]+)`/g) ?? []) {
        expect(src, `${field}: shared/roster-json.mjs does not contain ${sym}`)
          .toContain(sym.replace(/`/g, ''));
      }
    }
  });

  it('every CASES row it names is in gen-accounts.test.ts', () => {
    const src = read('server/test/gen-accounts.test.ts');
    for (const [field, , , row] of mirrorRows()) {
      const label = (row ?? '').replace(/^“|”$/g, '').replace(/`/g, '');
      expect(label.length, `${field}: the CASES cell is empty`).toBeGreaterThan(3);
      expect(src, `${field}: gen-accounts.test.ts has no CASES row containing "${label}"`)
        .toContain(label);
    }
  });

  it('the section still names the file, the owner and the failure mode', () => {
    // The three facts the surrounding section is FOR. A table added on top of a
    // section that lost them would be a table nobody has the context to read.
    const readme = read('README.md');
    const start = readme.indexOf('### The roster is runtime data');
    const section = readme.slice(start, readme.indexOf('\n### ', start + 1));
    expect(section).toContain('~/.ccrc/accounts.json');
    expect(section).toContain('refuses to boot');
    expect(section).toContain('accounts.sh');
  });
});
