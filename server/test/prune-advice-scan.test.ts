// Cleanup un-wedge R1 (D-7999, spec 2026-11-04 §5): no advice text tells a reader to run a repository-wide
// `git worktree prune`. That one command deletes git's record of every gone worktree of a repository at once, and
// the rows rung's git arm reads those records, so advice naming it is how the box's cleanup wedged. The scoped act is
// `git -C <main> worktree remove <path>`, which removes one stale record. The one repository-wide prune left in ccd
// is the operator's own verb, `ws-gc --prune` (`_ws_gc_prune_row`), named by its function so a moved line never reds.
//
// A text scan: no ccd runs and nothing is executed.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRUNE = /worktree\s+prune/;
/** The functions whose code may run the repository-wide prune: the operator's `ws-gc --prune` row. */
const ALLOWED = new Set(['_ws_gc_prune_row']);

/** Every non-comment line of ccd/ccd that names the prune, with the function it sits in. */
const ccdHits = (): string[] => {
  const hits: string[] = [];
  let fn = '';
  for (const [i, line] of fs.readFileSync(path.join(ROOT, 'ccd', 'ccd'), 'utf8').split('\n').entries()) {
    const def = /^([A-Za-z_][A-Za-z0-9_]*)\(\)\s*\{/.exec(line);
    if (def) fn = def[1]!;
    if (/^\s*#/.test(line) || !PRUNE.test(line)) continue;
    if (!ALLOWED.has(fn)) hits.push(`ccd/ccd:${i + 1} (${fn || 'top level'}): ${line.trim().slice(0, 160)}`);
  }
  return hits;
};

const sourceFiles = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return sourceFiles(p);
  return /\.(ts|tsx|mjs|js)$/.test(e.name) ? [p] : [];
});

/** Every line of server/src that names the prune outside a comment. */
const serverHits = (): string[] => {
  const hits: string[] = [];
  for (const f of sourceFiles(path.join(ROOT, 'server', 'src'))) {
    for (const [i, line] of fs.readFileSync(f, 'utf8').split('\n').entries()) {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || !PRUNE.test(line)) continue;
      hits.push(`${path.relative(ROOT, f)}:${i + 1}: ${t.slice(0, 160)}`);
    }
  }
  return hits;
};

describe('no advice names a repository-wide git worktree prune', () => {
  it('ccd/ccd names it in code only inside the operator’s ws-gc --prune row', () => {
    expect(ccdHits()).toEqual([]);
  });

  it('the CONTROL: the scan sees the one call it allows, so a scan that matched nothing would red', () => {
    const src = fs.readFileSync(path.join(ROOT, 'ccd', 'ccd'), 'utf8');
    const from = src.indexOf('\n_ws_gc_prune_row() {');
    expect(from, '_ws_gc_prune_row is defined').toBeGreaterThan(-1);
    const body = src.slice(from, src.indexOf('\n}\n', from)).split('\n').filter((l) => !/^\s*#/.test(l));
    expect(body.some((l) => PRUNE.test(l)), 'its call stands').toBe(true);
  });

  it('server/src names it outside a comment nowhere', () => {
    expect(serverHits()).toEqual([]);
  });
});
