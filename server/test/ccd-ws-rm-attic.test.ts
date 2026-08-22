// server/test/ccd-ws-rm-attic.test.ts
//
// Today a detached-HEAD `ws-rm` leaves commits referenced by nothing on git's
// default two-week fuse, while `ws-gc` refuses that exact case — the sharpest
// reversibility gap in the file. `_ws_attic_pin` already exists for `ws-reap`
// and its own header licenses being called from anywhere.
//
// STANDING NOTE: matches `ccd-workspaces.test.ts:1045`'s `/^ccd.*\.ts$/`
// containment scan; every snippet runs through `h.sh`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { eventsOf, measOf, refusalsOf } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-wsrm-attic-'); });
afterEach(() => { h.cleanup(); });

const STUB = `_ws_unsupervise() { :; }; _tmux() { echo t; }; tmux() { :; };`;

/** A real worktree on a real branch with three commits — the shape only the
 *  reflog remembers once one is amended away. */
const fixture = (id = 'demo-still-river'): { main: string; wt: string } => {
  const main = h.makeRepo('demo');
  h.git(main, 'commit', '--allow-empty', '-m', 'base');
  const wt = path.join(h.home, 'worktrees', 'demo', 'still-river');
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  h.git(main, 'worktree', 'add', '-b', 'ws/still-river', wt);
  for (const m of ['one', 'two', 'three']) {
    fs.writeFileSync(path.join(wt, 'f.txt'), m);
    h.git(wt, 'add', 'f.txt');
    h.git(wt, 'commit', '-m', m);
  }
  h.sh(`_reg_set ${id} uuid u; _reg_set ${id} project demo; _reg_set ${id} workspace still-river
    _reg_set ${id} branch ws/still-river; _reg_set ${id} workdir ${wt}`);
  return { main, wt };
};

const attic = (main: string, id: string): string[] =>
  h.git(main, 'for-each-ref', '--format=%(refname)', `refs/ccrc/attic/${id}/`)
    .split('\n').map((l) => l.trim()).filter(Boolean);

const intentMeas = (): Record<string, string> =>
  measOf(eventsOf(h.home, 'destroy').filter((e) => e['outcome'] === 'intent')[0]!);

describe('ws-rm pins the workspace into the attic before it destroys it', () => {
  it('pins the tip, so an unmerged branch that ws-rm keeps is still reachable by sha', () => {
    // Mutant: delete the `_ws_attic_pin` call -> this fails with
    // `expected [] to have a length of at least 1`, and the commits are on
    // git's default two-week fuse referenced by nothing.
    const { main } = fixture();
    const tip = h.git(main, 'rev-parse', 'ws/still-river').trim();
    h.sh(`${STUB} cmd_ws_rm demo-still-river 2>/dev/null || true`);
    const refs = attic(main, 'demo-still-river');
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs.some((r) => r.endsWith(tip)), 'the branch tip itself must be pinned').toBe(true);
  });

  it('THE MUTANT THAT MATTERS: the pin must precede git worktree remove', () => {
    // `git worktree remove` deletes $main/.git/worktrees/<slug>/, which holds
    // the HEAD reflog. `_ws_attic_pin`'s reflog read is guarded by
    // `[[ -d "$workdir" ]]`, so a pin moved below it contributes NOTHING but a
    // pre-resolved tip and the amended-away shas are gone.
    const { main, wt } = fixture();
    fs.writeFileSync(path.join(wt, 'f.txt'), 'amended');
    h.git(wt, 'add', 'f.txt');
    h.git(wt, 'commit', '--amend', '-m', 'three-amended');
    const reflog = h.git(wt, 'reflog', 'show', '--format=%H')
      .split('\n').map((l) => l.trim()).filter(Boolean);
    expect(reflog.length, 'the fixture produced no reflog to lose').toBeGreaterThan(3);

    h.sh(`${STUB} cmd_ws_rm demo-still-river 2>/dev/null || true`);
    expect(attic(main, 'demo-still-river').length,
      'a pin taken after `git worktree remove` sees no reflog and pins only the tip')
      .toBeGreaterThan(1);
  });

  it('pins UNCONDITIONALLY, even when git branch -d later refuses', () => {
    const { main } = fixture();
    h.sh(`${STUB} cmd_ws_rm demo-still-river 2>/dev/null || true`);
    expect(attic(main, 'demo-still-river').length).toBeGreaterThanOrEqual(1);
  });

  it('records the pin count and its source on the destroy intent line', () => {
    fixture();
    h.sh(`${STUB} cmd_ws_rm demo-still-river 2>/dev/null || true`);
    const m = intentMeas();
    expect(Number(m['attic'])).toBeGreaterThanOrEqual(1);
    expect(m['atticsrc']).toBe('worktree');
    expect(m['tip']).toMatch(/^[0-9a-f]{40}$/);
  });

  it('REFUSES when the tip is unreadable and the directory is still there', () => {
    // ws-rm's contract is "refuses anything it might destroy". A workspace on
    // disk whose tip cannot be resolved is exactly that. The stub is narrowed to
    // the ONE call this block makes: `_ws_common_dir` (ccd:1921-1926) also runs
    // `rev-parse`, and a blanket stub kills it, so ccd:1996-1997 fires first
    // with a different sentence and no journal line at all.
    fixture();
    let stderr = ''; let code = 0;
    try {
      h.sh(`${STUB}
        git() { case "$*" in *"rev-parse HEAD"*) return 1 ;; esac; command git "$@"; }
        cmd_ws_rm demo-still-river`);
    } catch (e) {
      const err = e as { status?: number; stderr?: Buffer };
      code = err.status ?? 1; stderr = String(err.stderr ?? '');
    }
    expect(code).not.toBe(0);
    expect(stderr).toContain('could not resolve');
    expect(refusalsOf(h.home)).toEqual([{ act: 'destroy', token: 'tip-unreadable' }]);
  });

  it('PROCEEDS with atticsrc "none" when the tip is unreadable and the directory is gone', () => {
    // The deliberate asymmetry: refusing here would wedge cleanup on a
    // workspace with nothing left to protect. A measurement, not a fabricated
    // zero — `none` is recorded, not omitted.
    h.makeRepo('demo');
    h.sh(`_reg_set gone-x uuid u; _reg_set gone-x project demo; _reg_set gone-x workspace x
      _reg_set gone-x workdir ${h.home}/not-here`);
    h.sh(`${STUB} cmd_ws_rm gone-x 2>/dev/null || true`);
    expect(intentMeas()['atticsrc']).toBe('none');
    expect(refusalsOf(h.home), 'a missing directory is not a refusal').toEqual([]);
  });
});
