// D-8561: `server/src` and `shared/` cite ccd's code by the name of the function (or constant) they mean, never by a
// line number of `ccd/ccd` or `ccd/ccrc`. A line number rots with every edit above it: an audit on 2026-11-13 found
// citations in `coord/routes.ts` naming two lines that by then held unrelated code. A name does not rot that way, and
// a reader finds it with one search.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO, walkSrc } from './rings/walkSrc.js';

const LINE_CITATION = /ccd\/(?:ccd|ccrc):\d+/;

/** `file:line` for each line of `text` that cites ccd by line number. */
const lineCitations = (file: string, text: string): string[] =>
  text.split('\n').flatMap((t, i) => (LINE_CITATION.test(t) ? [`${file}:${i + 1}`] : []));

describe('ccd is cited by name, not by line (D-8561)', () => {
  it('CONTROL: a line citation of either file is found, and a citation by name is not', () => {
    // The two numeric citations are assembled at run time, so this file adds none for the D-5893 scan to find.
    const cite = (file: string, lines: string): string => `${file}:${lines}`;
    expect(lineCitations('a.ts', [`// see \`${cite('ccd/ccd', '9327')}\``, '// `_sync_uuid` in ccd/ccd', `// (\`${cite('ccd/ccrc', '12-14')}\`)`].join('\n')))
      .toEqual(['a.ts:1', 'a.ts:3']);
    expect(lineCitations('b.ts', "// `ccd/ccd`'s `_reg_read`, and `ccd/ccd-pool-sync`")).toEqual([]);
  });

  it('no file under server/src or shared cites ccd/ccd or ccd/ccrc by line number', () => {
    const files = walkSrc({ roots: ['server/src', 'shared'], min: 300 });
    const hits = files.flatMap((f) => lineCitations(f, readFileSync(path.join(REPO, f), 'utf8')));
    expect(hits, 'cite the function or constant the comment means, by name').toEqual([]);
  });
});
