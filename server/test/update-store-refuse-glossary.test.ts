// Residue R6 (review 176 F5) — the glossary comment above `UPDATE_STORE_REFUSE_CODES` (`shared/api.ts`) had grown a
// word, `no-lease-to-hand` (`handOffLease`, D-3412), with no gloss line. This file reads `shared/api.ts` AS TEXT, takes
// the doc comment directly above `export const UPDATE_STORE_REFUSE_CODES = [`, and asserts that for every word in
// UPDATE_STORE_REFUSE_CODES (imported, never re-typed) a line matches the glossary's own indentation and dash. It
// proves every word HAS a gloss line, never that the gloss is TRUE: a regex cannot decide a sentence, and the meanings
// are reviewed, not scanned.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UPDATE_STORE_REFUSE_CODES } from '../../shared/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiSrc = readFileSync(path.join(here, '..', '..', 'shared', 'api.ts'), 'utf8');

/** The doc comment directly above the array's own declaration — never a copy retyped here. */
function glossaryComment(src: string): string {
  const decl = src.indexOf('export const UPDATE_STORE_REFUSE_CODES = [');
  expect(decl, 'the array\'s own declaration must be findable').toBeGreaterThan(-1);
  const before = src.slice(0, decl);
  const open = before.lastIndexOf('/**');
  const close = before.lastIndexOf('*/');
  expect(open, 'a doc comment must open before the declaration').toBeGreaterThan(-1);
  expect(close, 'a doc comment must close before the declaration').toBeGreaterThan(open);
  return before.slice(open, close);
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('every UPDATE_STORE_REFUSE_CODES word has a glossary line (residue R6, review 176 F5)', () => {
  it('the glossary comment above the array glosses every word, in the glossary\'s own shape', () => {
    const comment = glossaryComment(apiSrc);
    const missing = UPDATE_STORE_REFUSE_CODES.filter(
      (word) => !new RegExp(`^ \\*    ${escapeRegExp(word)} +— `, 'm').test(comment),
    );
    expect(missing, 'every refuse word must have its own glossary line (this proves a gloss EXISTS, not that it is true)').toEqual([]);
  });
});
