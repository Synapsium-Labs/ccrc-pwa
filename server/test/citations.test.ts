// D-5893 (#558): numeric line citations may only become fewer.
//
// A citation like `ccd:NNNN` or `foo.ts:NN` names a LINE, and lines move every
// time the file above them is edited. They rot silently: a test header that
// cited a ccd function by line number pointed thousands of lines away from it
// within weeks, and nothing went red. The ccd-line citations alone went on
// rising between the audit's plan and its second review.
//
// So this is a RATCHET, not a cleanup. It counts every numeric line citation in
// the code and test files of the tree and fails when the count rises above
// BASELINE, and also when it falls below it. New code cites a SYMBOL instead — `ccd#_ws_least_loaded`, or
// `foo.ts#functionName` — which survives the edits that move it. Existing
// citations are rewritten opportunistically when their file is touched; there
// is no bulk pass. When you remove some, lower BASELINE to the new count in the
// same commit; the test fails until you do, because slack left by an
// unrecorded removal would let the next added citation pass. It is never raised.
//
// CORPUS: tracked and untracked-not-ignored files outside `docs/` (plans and
// specs are dated history, and their citations were true when written) and
// `graphify-out/` (generated) whose name is a code file — the script and source
// extensions below, plus the extensionless executables under `ccd/`. Strings
// and comments are both counted: telling a citation in a comment from one in a
// fixture would need a parser per language, and the ratchet only needs the
// count to be stable.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The exact count in the tree. May only go DOWN (D-5893, revised). */
// 1585 -> 1582 for `ccd ws-gc --fast` (D-5886, #123): main already stood at 1584, and this branch
// drops two stale compaction-card citations its re-measure removed from session-hook.test.ts.
const BASELINE = 1582;

const CODE = /\.(?:ts|tsx|mts|cts|mjs|cjs|js|sh|bats|py)$/;
// `ccd/<name>` and `ccd/<dir>/<name>` with no extension: the bash executables.
const CCD_EXECUTABLE = /^ccd\/(?:[^/]+\/)*[^/.]+$/;
const EXCLUDED = /^(?:docs|graphify-out)\//;

/** A ccd line citation (`ccd:` and three to five digits) or a source-file
 *  line citation (`.ts:`, `.tsx:`, `.mjs:`, `.sh:` and digits). */
const CITATION = /ccd:\d{3,5}\b|\.(?:ts|tsx|mjs|sh):\d+\b/g;

const countCitations = (text: string): number => text.match(CITATION)?.length ?? 0;

const corpus = (): string[] =>
  execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter((f) => f !== '' && !EXCLUDED.test(f) && (CODE.test(f) || CCD_EXECUTABLE.test(f)));

const read = (f: string): string => {
  try { return readFileSync(path.join(ROOT, f), 'utf8'); } catch { return ''; } // deleted, not yet staged
};

describe('numeric line citations (D-5893)', () => {
  it('the matcher counts the two citation forms and nothing else', () => {
    expect(countCitations('see ccd' + ':1234 and server.ts' + ':56')).toBe(2);
    expect(countCitations('foo.sh' + ':7, bar.mjs' + ':10, baz.tsx' + ':3')).toBe(3);
    // Symbol citations and ordinary colons are not line citations.
    expect(countCitations('ccd#_ws_least_loaded, server.ts#main, ccd:12, http://h:8443')).toBe(0);
  });

  it('the corpus is the code tree, and it is not empty', () => {
    const files = corpus();
    expect(files).toContain('ccd/ccd');
    expect(files).toContain('server/test/citations.test.ts');
    expect(files.some((f) => f.startsWith('docs/'))).toBe(false);
  });

  it(`the count is exactly ${BASELINE}`, () => {
    const total = corpus().reduce((n, f) => n + countCitations(read(f)), 0);
    expect(total,
      `the tree now has ${total} numeric line citations (ccd:NNNN or file.ts:NN), above the `
      + `${BASELINE} it may not exceed. Cite a symbol instead (ccd#_ws_least_loaded, file.ts#name); `
      + 'lines move, names do not').toBeLessThanOrEqual(BASELINE);
    // D-5893 (revised): exact, so the first added citation fails. A `<=` alone let
    // removals go unrecorded, and the slack they left absorbed later additions.
    expect(total,
      `the tree now has ${total} numeric line citations, below BASELINE ${BASELINE}; `
      + `lower BASELINE to ${total} in this commit so the next added citation fails`).toBe(BASELINE);
  });
});
