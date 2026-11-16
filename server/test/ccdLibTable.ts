// THE LIBRARY TABLE, READ ON THE TEST SIDE (the ccd file split, Task 4; D-8048). ccd/ccd names every library it loads once,
// in load order, in its literal `__CCD_LIBS=(…)` line: one word per ccd/lib/<word>.sh. `_ccd_lib_load` builds its file list
// from that line and ccd/ccd-entry-install.py reads it (`read_lib_table`); every list a test keeps derives from it here, so a
// slice that appends a word needs no test edit. A leaf (node built-ins only), so the agent's tests and the census both load it.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The table line: the words, then an optional trailing comment. The installer's `read_lib_table` matches the same shape. */
export const CCD_LIBS_LINE = /^__CCD_LIBS=\(([a-z0-9 -]+)\)( .*)?$/;

/** The words of the one table line of a ccd text, or null when the text has none; a second line, or one that is not a
 *  word list, throws. */
export function ccdLibWordsOf(text: string): string[] | null {
  const lines = text.split('\n').filter((l) => l.startsWith('__CCD_LIBS=('));
  if (lines.length === 0) return null;
  if (lines.length > 1) throw new Error(`ccd/ccd holds ${lines.length} \`__CCD_LIBS=(\` lines, not one`);
  const m = CCD_LIBS_LINE.exec(lines[0]!);
  if (m === null) throw new Error(`ccd/ccd's \`__CCD_LIBS=(\` line is not one word list: ${lines[0]}`);
  return m[1]!.split(' ').filter((w) => w !== '');
}

let repoWords: string[] | null | undefined;

/** The table's words under `root` (the repository by default), in load order, or null when its ccd/ccd has no table line
 *  (a fixture tree). The repository's is read once per process; a fixture's every time, since a test may rewrite it. */
export function ccdLibWordsIn(root: string = REPO): string[] | null {
  const read = (): string[] | null => ccdLibWordsOf(readFileSync(path.join(root, 'ccd/ccd'), 'utf8'));
  if (path.resolve(root) !== REPO) return read();
  if (repoWords === undefined) repoWords = read();
  return repoWords;
}

/** The libraries ccd/ccd loads, in load order: the words of its `__CCD_LIBS` line under `root` (the repository by default). */
export function ccdLibNames(root: string = REPO): string[] {
  const words = ccdLibWordsIn(root);
  if (words === null) throw new Error(`${path.join(root, 'ccd/ccd')} has no \`__CCD_LIBS=(\` line: ccd names its libraries there`);
  return [...words];
}
