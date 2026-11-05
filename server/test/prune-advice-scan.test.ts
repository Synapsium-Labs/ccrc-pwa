// Cleanup un-wedge R1 (D-7999, spec 2026-11-04 §5): no advice text tells a reader to run a repository-wide
// `git worktree prune`. That one command deletes git's record of every gone worktree of a repository at once, and
// the rows rung's git arm reads those records, so advice naming it is how the box's cleanup wedged. The scoped act is
// `git -C <main> worktree remove <path>`, which removes one stale record. The one repository-wide prune left in ccd
// is the operator's own verb, `ws-gc --prune`: the scan allows its one call inside `_ws_gc_prune_row`, matched by its
// text so a moved line never reds, and nothing else in that function.
//
// A text scan: no ccd runs and nothing is executed.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ccdSource } from './ccdWsHelpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** `worktree prune`, with either word quoted as bash removes quotes (`worktree "prune"`, `'worktree' prune`). A line
 *  continued with a backslash is joined to the next before it is matched, so a split command is one line here. */
const PRUNE = /worktree["']?\s+["']?prune\b/;
/** The one hit the scan allows: the operator's `ws-gc --prune` row's own call, exactly once, inside that function. */
const ALLOWED_FN = '_ws_gc_prune_row';
const ALLOWED_CALL = 'git -C "$main" worktree prune';

/** Every non-comment line of a ccd source that names the prune, but the allowed call; and a line saying so when that
 *  call is not there exactly once. Lines continued with a trailing backslash are read as one, at their first line. */
const pruneHits = (src: string): string[] => {
  const hits: string[] = [];
  const lines = src.split('\n');
  let fn = '';
  let allowed = 0;
  for (let i = 0; i < lines.length; i++) {
    const at = i;
    let line = lines[i]!;
    while (line.endsWith('\\') && i + 1 < lines.length) line = `${line.slice(0, -1)} ${lines[++i]!.trimStart()}`;
    const def = /^([A-Za-z_][A-Za-z0-9_]*)\(\)\s*\{/.exec(line);
    if (def) fn = def[1]!;
    if (/^\s*#/.test(line) || !PRUNE.test(line)) continue;
    if (fn === ALLOWED_FN && line.includes(ALLOWED_CALL) && allowed++ === 0) continue;
    hits.push(`ccd/ccd:${at + 1} (${fn || 'top level'}): ${line.trim().slice(0, 160)}`);
  }
  if (allowed !== 1) hits.push(`${ALLOWED_FN}'s own call (${ALLOWED_CALL}) stands ${allowed} times, not once`);
  return hits;
};

const sourceFiles = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return sourceFiles(p);
  return /\.(ts|tsx|mjs|js)$/.test(e.name) ? [p] : [];
});

/** The one server/src line that names the prune and is no advice: the approval classifier's row that FORBIDS it
 *  (cleanup un-wedge R3, D-8001), matched by its text so a moved line never reds. */
const CLASSIFIER_ROW = { file: 'server/src/coord/approvalguard.ts', text: "{ why: 'git worktree prune', test: runsWorktreePrune }," };

/** Every line of server/src that names the prune outside a comment, but the classifier's refusal row. */
const serverHits = (): string[] => {
  const hits: string[] = [];
  for (const f of sourceFiles(path.join(ROOT, 'server', 'src'))) {
    for (const [i, line] of fs.readFileSync(f, 'utf8').split('\n').entries()) {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || !PRUNE.test(line)) continue;
      if (path.relative(ROOT, f) === CLASSIFIER_ROW.file && t === CLASSIFIER_ROW.text) continue;
      hits.push(`${path.relative(ROOT, f)}:${i + 1}: ${t.slice(0, 160)}`);
    }
  }
  return hits;
};

describe('no advice names a repository-wide git worktree prune', () => {
  it('ccd/ccd names it in code only in the operator’s ws-gc --prune row’s own call', () => {
    expect(pruneHits(ccdSource())).toEqual([]);
  });

  // The scan, pinned on fixture sources (review 1516, F3): each spelling of the command reds, the allowance is one
  // call and not the whole function, and a missing or doubled call reds too.
  const ROW = (body: string): string => `${ALLOWED_FN}() {   # state project slug path already-pruned\n${body}\n}\n`;
  const CALL = `  elif ${ALLOWED_CALL} 2>/dev/null; then`;
  it.each([
    ['plain', 'echo "run: git -C $main worktree prune"'],
    ['the verb quoted', `echo "run: git worktree 'prune'"`],
    ['the verb double-quoted', 'git -C "$main" worktree "prune"'],
    ['the subcommand quoted', `git -C "$main" 'worktree' prune`],
  ])('a line naming it, %s, outside the row reds', (_label, line) => {
    expect(pruneHits(`f() {\n  ${line}\n}\n${ROW(CALL)}`)).toEqual([`ccd/ccd:2 (f): ${line}`]);
  });

  it('a command split by a backslash-newline reds, named at its first line', () => {
    const hits = pruneHits(`f() {\n  git -C "$main" worktree \\\n    prune --expire now\n}\n${ROW(CALL)}`);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatch(/^ccd\/ccd:2 \(f\): git -C "\$main" worktree +prune --expire now$/);
  });

  it('advice inside the row reds: the allowance is its one call, not the function', () => {
    expect(pruneHits(ROW(`${CALL}\n    echo "or run git worktree prune yourself"`)))
      .toEqual([`ccd/ccd:3 (${ALLOWED_FN}): echo "or run git worktree prune yourself"`]);
  });

  it('the row’s call missing, or standing twice, reds', () => {
    expect(pruneHits(ROW('  :'))).toEqual([`${ALLOWED_FN}'s own call (${ALLOWED_CALL}) stands 0 times, not once`]);
    expect(pruneHits(ROW(`${CALL}\n${CALL}`))).toEqual([`ccd/ccd:3 (${ALLOWED_FN}): ${CALL.trim()}`,
      `${ALLOWED_FN}'s own call (${ALLOWED_CALL}) stands 2 times, not once`]);
  });

  it('the CONTROL: a comment line and the clean fixture are not hits', () => {
    expect(pruneHits(`f() {\n  # git worktree prune would clear every record\n}\n${ROW(CALL)}`)).toEqual([]);
  });

  it('server/src names it outside a comment nowhere but the classifier row that forbids it', () => {
    expect(serverHits()).toEqual([]);
  });

  it('the CONTROL: the classifier row the scan allows stands, so the allowance names a real line', () => {
    const lines = fs.readFileSync(path.join(ROOT, CLASSIFIER_ROW.file), 'utf8').split('\n').map((l) => l.trim());
    expect(lines.filter((l) => l === CLASSIFIER_ROW.text)).toHaveLength(1);
  });
});
