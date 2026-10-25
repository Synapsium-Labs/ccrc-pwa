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
// BASELINE. New code cites a SYMBOL instead — `ccd#_ws_least_loaded`, or
// `foo.ts#functionName` — which survives the edits that move it. Existing
// citations are rewritten opportunistically when their file is touched; there
// is no bulk pass. BASELINE is never raised; lower it when you remove some.
//
// D-5893 (revised again, 2026-10-20): the FIRST added citation fails through a
// second rule, not through an exact count. An exact count (#969) also failed
// when the count FELL, and with several PRs landing in parallel two removals
// raced each other's baselines and turned `main` red twice in a day. So the
// ceiling is `<=` again, and the rule that slack cannot absorb an addition is
// measured on the change itself: the lines a branch ADDS against its merge-base
// with `origin/main` may hold no numeric line citation. Without `origin/main`
// (a shallow or detached checkout) that row skips with a notice, as the growth
// check does.
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
import { mergeBaseDiff } from './mergeBase.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The ceiling on the count in the tree. May only go DOWN (D-5893). */
const BASELINE = 1584;

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

  it(`the count does not rise above ${BASELINE}`, () => {
    const total = corpus().reduce((n, f) => n + countCitations(read(f)), 0);
    expect(total,
      `the tree now has ${total} numeric line citations (ccd:NNNN or file.ts:NN), above the `
      + `${BASELINE} it may not exceed. Cite a symbol instead (ccd#_ws_least_loaded, file.ts#name); `
      + 'lines move, names do not').toBeLessThanOrEqual(BASELINE);
    if (total < BASELINE) console.warn(`citations: ${total} in the tree; BASELINE ${BASELINE} can be lowered to ${total}`);
  });

  it('the lines this branch adds hold no numeric line citation (D-5893, revised)', (ctx) => {
    const diff = mergeBaseDiff(ROOT, ['.']);
    if (diff === null) {
      console.warn('citations: skipped the added-lines rule, no origin/main or merge-base in this checkout');
      ctx.skip();
      return;
    }
    const files = new Set(corpus());
    const added: string[] = [];
    let file = '';
    for (const line of diff.split('\n')) {
      if (line.startsWith('+++ ')) { file = line.startsWith('+++ b/') ? line.slice(6) : ''; continue; }
      if (!line.startsWith('+') || line.startsWith('+++')) continue;
      if (!files.has(file) || file === 'server/test/citations.test.ts') continue;
      const n = countCitations(line.slice(1));
      if (n > 0) added.push(`${file}: ${line.slice(1).trim().slice(0, 120)}`);
    }
    expect(added, 'a numeric line citation was added; cite a symbol instead (ccd#_ws_least_loaded, file.ts#name)')
      .toEqual([]);
  });
});
