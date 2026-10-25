// Named anchors for citations (root-cause fix 10 of the 2026-10-25 landing measurement; D-TBD-named-anchors).
//
// A citation by line (a file name, a colon and a line range) conflicts whenever any PR
// touches the lines above it, even though the cited code did not change, and
// README alone had 36 conflicted absorptions on citation hunks. D-5893's
// ratchet (`citations.test.ts`) only lets numeric citations get fewer; this is
// the other half, the thing to cite INSTEAD for a span that has no symbol:
//
//   target:    `// @anchor name`   (or `# @anchor name`, `<!-- @anchor name -->`), on its own line or ending a code line
//   citation:  `path/to/file.ts#@name`
//
// An anchor names the code that follows its comment, so it moves with that
// code and never conflicts with an edit elsewhere. The census below fails on a
// citation whose anchor does not exist (dangling) and on an anchor defined
// twice in one file (ambiguous); a rename or a deletion of the target is a
// red suite, not a silent rot. Symbol citations (`file.ts#functionName`, no
// `@`) stay as D-5893 describes them.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { anchorProblems, anchorDefs, anchorCites } from './anchors.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** The two files whose text holds the grammar's own samples. */
const SELF = new Set(['server/test/anchors.test.ts', 'server/test/anchors.ts']);
const TEXT = /\.(?:ts|tsx|mts|mjs|cjs|js|sh|bats|py|md|json|ya?ml)$/;
const CCD_EXECUTABLE = /^ccd\/(?:[^/]+\/)*[^/.]+$/;

describe('anchor resolver', () => {
  const file = (name: string): string => `// @anchor ${name}\nexport const x = 1;\n`;

  it('a citation of an existing anchor passes', () => {
    const files = new Map([
      ['shared/api.ts', file('lc-refusal-word')],
      ['README.md', 'see `shared/api.ts#@lc-refusal-word` for the word.\n'],
    ]);
    expect(anchorProblems(files)).toEqual([]);
  });

  it('a dangling anchor fails, naming the citing file and the anchor', () => {
    const files = new Map([
      ['shared/api.ts', file('lc-refusal-word')],
      ['README.md', 'see `shared/api.ts#@no-such-anchor`.\n'],
    ]);
    const got = anchorProblems(files);
    expect(got).toHaveLength(1);
    expect(got[0]).toContain('README.md');
    expect(got[0]).toContain('shared/api.ts#@no-such-anchor');
    expect(got[0]).toContain('dangling');
  });

  it('a citation of a file that is not in the corpus is dangling too', () => {
    const files = new Map([['README.md', 'see `gone/file.ts#@a`.\n']]);
    expect(anchorProblems(files)).toHaveLength(1);
  });

  it('an anchor defined twice in one file fails', () => {
    const files = new Map([['shared/api.ts', file('dup') + file('dup')]]);
    const got = anchorProblems(files);
    expect(got).toHaveLength(1);
    expect(got[0]).toContain('shared/api.ts');
    expect(got[0]).toContain('defined twice');
  });

  it('the same name in two files is two anchors, not a duplicate', () => {
    const files = new Map([['a.ts', file('same')], ['b.ts', file('same')]]);
    expect(anchorProblems(files)).toEqual([]);
  });

  it('the grammar: three comment forms define, prose and code do not', () => {
    expect(anchorDefs('// @anchor one\n# @anchor two\n<!-- @anchor three -->\n')).toEqual(['one', 'two', 'three']);
    expect(anchorDefs('const s = "// @anchor four";\nsee @anchor five in prose\n')).toEqual([]);
    // The marker may END a code line, so adding it moves no line below it (a line-number
    // citation elsewhere keeps resolving), and may follow another comment on the same line.
    expect(anchorDefs('  j=$(jq -cn)  # @anchor six\n| \'a\'  // D-1: why // @anchor seven\n')).toEqual(['six', 'seven']);
    expect(anchorCites('`a/b.ts#@x-1` and ccd/ccd#@y_2, foo.ts#symbol, bar.ts#@')).toEqual([
      { file: 'a/b.ts', name: 'x-1' }, { file: 'ccd/ccd', name: 'y_2' }]);
  });
});

describe('anchor census over the tree', () => {
  it('every `file#@name` citation resolves, and no anchor is defined twice', () => {
    const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0')
      .filter((f) => f !== '' && !SELF.has(f) && (TEXT.test(f) || CCD_EXECUTABLE.test(f)));
    const files = new Map<string, string>();
    for (const f of listed) {
      try { files.set(f, readFileSync(path.join(ROOT, f), 'utf8')); } catch { /* deleted, not yet staged */ }
    }
    expect(files.has('README.md')).toBe(true);
    expect(anchorProblems(files)).toEqual([]);
  });
});
