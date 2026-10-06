// Child reclamation wave 6, Task 3 (spec §5.6, last bullet): the TAIL's
// destructive git calls — `git worktree remove` and `update-ref -d`, for each
// nested checkout and for the child — run under `_ws_reclaim_contained`, so no
// program the repository names runs while ccd deletes. Measured uncontained
// (git 2.43): `update-ref -d` runs reference-transaction, and `worktree remove`
// with no force flag on a standing tree runs core.fsmonitor and
// post-index-change. `ws-expire` runs the same tail. Every case builds its
// workspace in a fixture HOME and runs the sourced verb with the unit and pane
// calls RECORDED, never made.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD } from './ccdWsHelpers.js';
import {
  CHILD_BRANCH, CHILD_ID, CHILD_STUBS, childReclaimVerb, hookRuns, makeChild, plantRepoPrograms, type Child,
} from './childReclaimFixture.js';
import { verbHelpers } from './childReclaimVerbHelpers.js';
import { EXP_BRANCH, EXP_ID, expireToken, expireVerb, makeArchived } from './wsExpireFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-tail-contained-'); });
afterEach(() => { h.cleanup(); });
const { interrupted, resumeToken } = verbHelpers(() => h);

const runsFile = (): string => path.join(h.home, 'hook-runs');
/** The ladder's token, minted CONTAINED: `evalOf` runs `_ws_reclaim_eval`
 *  bare, and its uncontained `git status` would run the planted programs
 *  before the subject ever does. */
const containedToken = (): string =>
  h.sh(`${CHILD_STUBS} _ws_reclaim_contained _ws_reclaim_eval ${CHILD_ID} 0 '' >/dev/null; printf '%s' "$REAP_TOKEN"`);
/** A commit only `ws/parked` holds, on a checkout at `at` that git records —
 *  `ccd-child-reclaim-verb-tail.test.ts`'s own shape for a gone nested line. */
const parkedCommit = (c: Child, at: string): string => {
  h.git(c.main, 'worktree', 'add', '-q', '-b', 'ws/parked', at);
  fs.writeFileSync(path.join(at, 'p.txt'), 'parked\n');
  h.git(at, 'add', 'p.txt'); h.git(at, 'commit', '-q', '-m', 'parked unique');
  return h.git(at, 'rev-parse', 'HEAD');
};

interface Built { c: Child; tok: string; gone: string[] }
/** The tail's three arms, each reaching a different set of the six sites. `plant`
 *  plants the repository's programs AFTER every setup git call that would run them. */
const ARMS: Record<string, (plant: boolean) => Built> = {
  // :28222 (nested --force), :28262 (nested CAS), :28300 (tree --force), :28373 (branch CAS)
  'a fresh reclaim with a nested checkout': (plant) => {
    const c = makeChild(h);
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', path.join(c.wt, 'inner'));
    if (plant) plantRepoPrograms(h, c);
    return { c, tok: containedToken(), gone: [CHILD_BRANCH, 'ws/nested'] };
  },
  // :28344 (the vanished tree's record), :28373
  'a vanished tree whose record git still keeps': (plant) => {
    const c = makeChild(h);
    if (plant) plantRepoPrograms(h, c);
    fs.rmSync(c.wt, { recursive: true, force: true });
    return { c, tok: containedToken(), gone: [CHILD_BRANCH] };
  },
  // :28232 (gone nested line, record standing), :28262, :28344, :28373
  'a resume at children whose nested line is gone, its record standing': (plant) => {
    const c = makeChild(h);
    interrupted(c, 'children');
    const tok = resumeToken('children');
    const ghost = path.join(fs.realpathSync(c.wt), 'ghost');
    const sha = parkedCommit(c, ghost);
    h.sh(`_ws_tombstone_patch ${CHILD_ID} '${JSON.stringify({ children: [`${ghost}\tws/parked\t${sha}`] })}'`);
    if (plant) plantRepoPrograms(h, c);
    fs.rmSync(c.wt, { recursive: true, force: true });
    return { c, tok, gone: [CHILD_BRANCH, 'ws/parked'] };
  },
};

describe('the tail runs none of the repository’s programs while it deletes (spec §5.6)', () => {
  it.each(Object.keys(ARMS))('%s', (arm) => {
    const { c, tok, gone } = ARMS[arm]!(true);
    fs.rmSync(runsFile(), { force: true });
    const r = childReclaimVerb(h, tok);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    for (const b of gone) expect(h.git(c.main, 'branch', '--list', b), `${b} was deleted`).toBe('');
    expect(hookRuns(h), 'a program the repository names ran inside the tail').toEqual([]);
    // The CONTROL, after the subject: the planted hook is live for an uncontained ref delete.
    h.git(c.main, 'branch', 'ws/control', 'HEAD');
    fs.rmSync(runsFile(), { force: true });
    h.sh(`git -C "${c.main}" update-ref -d refs/heads/ws/control`);
    expect(hookRuns(h), 'the CONTROL: an uncontained update-ref -d runs reference-transaction').toContain('reference-transaction');
  }, 120_000);

  it('ws-expire’s tail too — it is the same function', () => {
    const a = makeArchived(h);
    plantRepoPrograms(h, a);
    const tok = expireToken(h);
    fs.rmSync(runsFile(), { force: true });
    const r = expireVerb(h, tok);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).expired).toBe(EXP_ID);
    expect(h.git(a.main, 'branch', '--list', EXP_BRANCH), 'the branch was deleted').toBe('');
    expect(hookRuns(h), 'a program the repository names ran inside ws-expire’s tail').toEqual([]);
  }, 120_000);
});

describe('every destructive git call the tail makes carries the pins (spec §5.6)', () => {
  /** A `git` FUNCTION — bash resolves functions before PATH, and
   *  `_ws_reclaim_contained` runs "$@" — that records, for each destructive
   *  call, the hooks path and fsmonitor git would use for it (read by the real
   *  git under the SAME environment), then runs the real git. A site hook-silent
   *  in a fixture (a forced remove, a remove of a missing tree) is measured too.
   *  `${3-} ${4-}`: ccd runs under `set -u`, and `git -C <dir> write-tree` has
   *  no fourth argument. */
  const SHIM = 'git() { if [[ "$1" == -C && ( "${3-} ${4-}" == "worktree remove" || "${3-} ${4-}" == "update-ref -d" ) ]]; then'
    + ' local l="$3 $4"; [[ " $* " == *" --force "* ]] && l+=" --force";'
    + ' printf "%s\\t%s\\t%s\\n" "$l" "$(command git -C "$2" config --get core.hooksPath || echo unset)"'
    + ' "$(command git -C "$2" config --get core.fsmonitor || echo unset)" >> "$HOME/destructive-git"; fi;'
    + ' command git "$@"; };';
  const SEEN: Record<string, string[]> = {
    'a fresh reclaim with a nested checkout': ['update-ref -d', 'update-ref -d', 'worktree remove --force', 'worktree remove --force'],
    'a vanished tree whose record git still keeps': ['update-ref -d', 'worktree remove'],
    'a resume at children whose nested line is gone, its record standing': ['update-ref -d', 'update-ref -d', 'worktree remove', 'worktree remove'],
  };
  it.each(Object.keys(ARMS))('%s', (arm) => {
    const { tok } = ARMS[arm]!(false);
    const r = childReclaimVerb(h, tok, { pre: SHIM });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const f = path.join(h.home, 'destructive-git');
    const lines = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
    expect(lines.map((l) => l.split('\t')[0]).sort(), 'the arm reached the sites it names').toEqual(SEEN[arm]);
    expect(lines.filter((l) => !l.endsWith('\t/dev/null\tfalse')), 'a destructive git call ran uncontained').toEqual([]);
  }, 120_000);
});

describe('the tail spells every destructive git call contained', () => {
  it('six calls, each `_ws_reclaim_contained git -C "$main" …`, and no uncontained one', () => {
    const src = fs.readFileSync(CCD, 'utf8');
    const tail = src.slice(src.indexOf('\n_ws_reclaim_tail() {'), src.indexOf('\ncmd_ws_reclaim() {'));
    expect(tail.length, 'the CONTROL: the tail was found').toBeGreaterThan(1000);
    const code = tail.split('\n').filter((l) => !/^\s*#/.test(l));
    const destructive = code.filter((l) => /\bgit\b.*\b(worktree (remove|prune)|update-ref -d|branch -[dD])\b/.test(l));
    expect(destructive.filter((l) => !/_ws_reclaim_contained git -C "\$main" (worktree remove|update-ref -d) /.test(l)),
      'an uncontained destructive git call').toEqual([]);
    // Pinned at 6 by Task 3. A later task that adds or moves a destructive git call in the tail
    // re-pins this count in its own commit, and keeps the call contained (ruling X3).
    expect(destructive.length, 'nested remove ×2, nested CAS, the tree, its record, the branch CAS').toBe(6);
  });
});
