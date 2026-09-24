// The pin phase (spec 2026-09-22 §5.5): the WIP commit, the attic pins, the
// tombstone — asserted by READING GIT AND THE FILE afterwards, never by
// trusting what the phase says it did (spec §9: "the secret-shape classifier
// runs over the WIP commit's candidates, asserted by reading the resulting
// tree rather than the tombstone; the WIP commit and the attic pins are
// asserted by reading git refs").
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD } from './ccdWsHelpers.js';
import {
  CHILD_BRANCH, CHILD_ID, CHILD_RUN, CHILD_STUBS, makeChild, type Child,
} from './childReclaimFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-pin-'); });
afterEach(() => { h.cleanup(); });

interface Pinned { rc: string; wip: string; tip: string; why: string; secrets: string[]; childlines: string }

/** The ladder (for REAP_BRANCH and the nested/foreign lists), then the pin, in
 *  one shell — exactly the order `_ws_reclaim_locked` runs them. `defer` is
 *  the ladder's own flag: a case with an operation in progress needs it to get
 *  past rung 6, which is precisely the case the pin phase's heads exist for.
 *  `between` runs after the ladder and before the pin: the window the settle
 *  re-pin runs in, with no ladder in front of it. */
function pinOf(c: Child, opts: { pre?: string; env?: NodeJS.ProcessEnv; defer?: 0 | 1; between?: string } = {}): Pinned {
  const out = h.sh(`${CHILD_STUBS} ${opts.pre ?? ''} _ws_reclaim_eval ${CHILD_ID} ${opts.defer ?? 0} ${CHILD_RUN} >/dev/null`
    + `${opts.between ? ` && { ${opts.between}; }` : ''}`
    + ` && _ws_reclaim_pin ${CHILD_ID} "${c.wt}" "${c.main}" "$REAP_BRANCH" ${CHILD_RUN}; rc=$?;`
    + ` printf '%s\\x1f%s\\x1f%s\\x1f%s\\x1f%s\\x1f%s' "$rc" "$RECLAIM_WIP" "$REAP_TIP" "$RECLAIM_PIN_WHY"`
    + ` "$(printf '%s\\n' "\${RECLAIM_SECRETS[@]}")" "$REAP_CHILDLINES"`, opts.env ?? {});
  const [rc = '', wip = '', tip = '', why = '', secrets = '', childlines = ''] = out.split('\x1f');
  return { rc, wip, tip, why, secrets: secrets.split('\n').filter(Boolean), childlines };
}
const atticShas = (c: Child): string[] =>
  h.git(c.main, 'for-each-ref', '--format=%(refname)', `refs/ccrc/attic/${CHILD_ID}/`)
    .split('\n').filter(Boolean).map((r) => r.split('/').pop()!);

describe('the WIP commit', () => {
  it('commits the tracked edit and the non-secret untracked files, and NEVER a secret — read from the tree', () => {
    const c = makeChild(h);
    fs.writeFileSync(path.join(c.wt, '.gitignore'), '.env.local\nbuild/\n');
    h.git(c.wt, 'add', '.gitignore'); h.git(c.wt, 'commit', '-m', 'ignore');
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'edited\n');
    fs.writeFileSync(path.join(c.wt, 'notes with space.txt'), 'n');
    fs.writeFileSync(path.join(c.wt, '.env.example'), 'KEY=');
    fs.writeFileSync(path.join(c.wt, '.env'), 'KEY=live');
    fs.mkdirSync(path.join(c.wt, 'secrets')); fs.writeFileSync(path.join(c.wt, 'secrets', 'token.txt'), 't');
    fs.writeFileSync(path.join(c.wt, '.env.local'), 'KEY=local');
    fs.mkdirSync(path.join(c.wt, 'build')); fs.writeFileSync(path.join(c.wt, 'build', 'out.o'), 'o');
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    expect(p.wip).toMatch(/^[0-9a-f]{40}$/);
    const tree = h.git(c.main, 'ls-tree', '-r', '--name-only', p.wip).split('\n');
    expect(tree).toEqual(expect.arrayContaining(['f1.txt', 'notes with space.txt', '.env.example', '.gitignore']));
    for (const never of ['.env', 'secrets/token.txt', '.env.local', 'build/out.o']) {
      expect(tree, `${never} was committed — and would be pinned permanently in a public repository`).not.toContain(never);
    }
    expect(h.git(c.main, 'show', `${p.wip}:f1.txt`)).toContain('edited');
    expect([...p.secrets].sort()).toEqual(['.env', '.env.local', 'secrets/token.txt']);
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'the WIP commit is ON the branch').toBe(p.wip);
    expect(p.tip).toBe(p.wip);
  }, 60_000);

  it('reads every path LITERALLY — an untracked file named `[.]env` never globs a secret into the commit', () => {
    // Read as a glob, the pathspec `[.]env` also matches `.env` — the file the
    // classifier kept out of RECLAIM_STAGE (measured, git 2.43: handed through
    // the pathspec file without GIT_LITERAL_PATHSPECS, it stages both; `*` and
    // `.e*` happen not to, which is why this name and not those).
    const c = makeChild(h);
    fs.writeFileSync(path.join(c.wt, '[.]env'), 'a file whose name is a glob');
    fs.writeFileSync(path.join(c.wt, '.env'), 'KEY=live');
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    const tree = h.git(c.main, 'ls-tree', '-r', '--name-only', p.wip).split('\n');
    expect(tree).toContain('[.]env');
    expect(tree, '.env was staged by a glob').not.toContain('.env');
  }, 60_000);

  it('is written as ccrc, author AND committer, even when the environment says otherwise', () => {
    const c = makeChild(h);
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'edited\n');
    const p = pinOf(c, { env: { GIT_AUTHOR_NAME: 'intruder', GIT_AUTHOR_EMAIL: 'intruder@x',
      GIT_COMMITTER_NAME: 'intruder', GIT_COMMITTER_EMAIL: 'intruder@x' } });
    expect(h.git(c.main, 'log', '-1', '--format=%an <%ae>|%cn <%ce>|%s', p.wip)).toBe(
      'ccrc reclaim <ccrc-reclaim@invalid>|ccrc reclaim <ccrc-reclaim@invalid>'
      + `|ccrc: WIP pinned at reclaim of ${CHILD_ID} (run ${CHILD_RUN})`);
  }, 60_000);

  it('runs NO hook of the repository and no fsmonitor — in ANY git call of the phase, not only the commit', () => {
    // `git add`/`status` fire post-index-change, every `update-ref` fires
    // reference-transaction, and a repository `core.fsmonitor` is a program
    // `status` and `add` execute. Each records a run only once the PIN has
    // started (`$HOME/pin-started`, touched between the ladder and the pin):
    // the ladder is not the pin phase, and its own reads are not asserted here.
    const c = makeChild(h);
    const hooks = path.join(c.main, '.git', 'hooks');
    fs.mkdirSync(hooks, { recursive: true });
    const HOOKS = ['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit', 'post-index-change', 'reference-transaction'];
    for (const hook of HOOKS) {
      fs.writeFileSync(path.join(hooks, hook),
        `#!/bin/sh\n[ -e "$HOME/pin-started" ] && echo ${hook} >> "$HOME/hook-runs"\nexit 0\n`, { mode: 0o755 });
    }
    const fsm = path.join(h.home, 'fsmonitor.sh');
    fs.writeFileSync(fsm, '#!/bin/sh\n[ -e "$HOME/pin-started" ] && echo fsmonitor >> "$HOME/hook-runs"\nexit 1\n', { mode: 0o755 });
    h.git(c.main, 'config', 'core.fsmonitor', fsm);
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'edited\n');
    fs.writeFileSync(path.join(c.wt, 'new.txt'), 'n');
    // The CONTROL: the same hooks DO fire for a git call made outside the phase.
    const control = h.sh(`touch "$HOME/pin-started"; git -C "${c.wt}" status --porcelain >/dev/null; cat "$HOME/hook-runs" 2>/dev/null; rm -f "$HOME/hook-runs" "$HOME/pin-started"`);
    expect(control, 'the CONTROL: an uncontained status runs the fsmonitor').toContain('fsmonitor');
    const p = pinOf(c, { between: 'touch "$HOME/pin-started"' });
    expect(p.rc, p.why).toBe('0');
    expect(p.wip).toMatch(/^[0-9a-f]{40}$/);
    const runs = fs.existsSync(path.join(h.home, 'hook-runs')) ? fs.readFileSync(path.join(h.home, 'hook-runs'), 'utf8') : '';
    expect(runs, 'a repository-configured program ran inside the pin phase').toBe('');
  }, 60_000);

  it('makes no commit when there is nothing uncommitted — the ordinary finished child', () => {
    const c = makeChild(h);
    const p = pinOf(c);
    expect(p.rc).toBe('0');
    expect(p.wip).toBe('');
    expect(p.tip).toBe(c.tip);
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`)).toBe(c.tip);
  }, 60_000);

  it('commits onto a DETACHED HEAD without moving the branch, and pins that commit by sha', () => {
    const c = makeChild(h);
    h.git(c.wt, 'checkout', '--detach');
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'detached work\n');
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    expect(p.wip).toMatch(/^[0-9a-f]{40}$/);
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'the branch did not move').toBe(c.tip);
    expect(p.tip).toBe(c.tip);
    expect(atticShas(c)).toContain(p.wip);
    expect(atticShas(c), 'the branch tip — what the tail deletes the branch at — is pinned').toContain(c.tip);
  }, 60_000);
});

describe('the attic pins', () => {
  it('pins the WIP commit, the tip, every stash of the branch, and the operation heads — the heads taken BEFORE the commit', () => {
    const c = makeChild(h);
    fs.appendFileSync(path.join(c.wt, 'f2.txt'), 'stashed\n');
    h.git(c.wt, 'stash', 'push', '-m', 'kept');
    const stash = h.git(c.main, 'rev-parse', 'refs/stash');
    // The two heads are commits NO reflog names. `_ws_reclaim_pin` also runs
    // the existing `_ws_attic_pin`, which pins every sha in
    // `git -C <workdir> reflog show --all` — and in a linked worktree that
    // includes main's branch reflog, `refs/stash` and the child's own branch
    // reflog (measured, git 2.43). A head that is in any of those is pinned
    // whatever step (0) does, and "before the commit" would be untested. A
    // `commit-tree` object referenced by nothing is pinned ONLY by step (0).
    const tree = h.git(c.wt, 'rev-parse', 'HEAD^{tree}');
    const mergeSide = h.git(c.wt, 'commit-tree', tree, '-p', 'HEAD', '-m', 'merge side, in no reflog');
    const orig = h.git(c.wt, 'commit-tree', tree, '-p', 'HEAD', '-m', 'orig head, in no reflog');
    const reflogs = h.git(c.wt, 'reflog', 'show', '--all', '--format=%H');
    expect(reflogs, 'the CONTROL: the merge head is in no reflog').not.toContain(mergeSide);
    expect(reflogs, 'the CONTROL: the orig head is in no reflog').not.toContain(orig);
    fs.writeFileSync(h.git(c.wt, 'rev-parse', '--path-format=absolute', '--git-path', 'MERGE_HEAD'), `${mergeSide}\n`);
    fs.writeFileSync(h.git(c.wt, 'rev-parse', '--path-format=absolute', '--git-path', 'ORIG_HEAD'), `${orig}\n`);
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'mid-merge\n');
    // Rung 6 refuses `tree-busy` on a merge in progress; the defer ceiling is
    // what gets past it, and the pin phase must STILL take the heads.
    const p = pinOf(c, { defer: 1 });
    expect(p.rc, p.why).toBe('0');
    const attic = atticShas(c);
    // MERGE_HEAD is the one the ORDER decides: the WIP commit concludes the
    // merge and deletes the file, so read after it, it is gone. ORIG_HEAD and
    // the stash survive a commit — theirs is a pinned-at-all check.
    for (const [what, sha] of [['WIP', p.wip], ['stash', stash], ['MERGE_HEAD', mergeSide], ['ORIG_HEAD', orig], ['tip', p.tip]] as const) {
      expect(attic, `${what} ${sha} is not pinned`).toContain(sha);
    }
  }, 60_000);

  it('pins and commits a nested checkout of the SAME repository, and never stages it as a gitlink', () => {
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    fs.writeFileSync(path.join(inner, 'dirty.txt'), 'dirty');
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    const nestedTip = h.git(c.main, 'rev-parse', 'refs/heads/ws/nested');
    expect(h.git(c.main, 'ls-tree', '-r', '--name-only', nestedTip).split('\n')).toContain('dirty.txt');
    expect(atticShas(c)).toContain(nestedTip);
    expect(p.childlines).toContain(`${inner}\tws/nested\t${nestedTip}`);
    expect(h.git(c.main, 'ls-tree', '-r', '--name-only', `refs/heads/${CHILD_BRANCH}`).split('\n')
      .filter((f) => f.startsWith('inner')), 'the parent staged the nested checkout').toEqual([]);
  }, 60_000);

  it('FAILS — never skips — when a commit it must keep cannot be pinned', () => {
    const c = makeChild(h);
    const p = pinOf(c, { pre: `_ws_reclaim_stash_shas() { echo ${'d'.repeat(40)}; };` });
    expect(p.rc).toBe('1');
    expect(p.why).toContain(`could not be pinned under refs/ccrc/attic/${CHILD_ID}/`);
  }, 60_000);

  it('FAILS on a sha that is not a COMMIT — the `^{commit}` peel is the only guard that sees it', () => {
    // `update-ref` refuses a NONEXISTENT object on its own (so the case above
    // cannot tell the two guards apart), but it happily writes a ref at a TREE.
    // Only `cat-file -e "${sha}^{commit}"` refuses this one.
    const c = makeChild(h);
    const tree = h.git(c.wt, 'rev-parse', 'HEAD^{tree}');
    const p = pinOf(c, { pre: `_ws_reclaim_stash_shas() { echo ${tree}; };` });
    expect(p.rc).toBe('1');
    expect(atticShas(c), 'a tree was written into the attic').not.toContain(tree);
  }, 60_000);

  it('FAILS when the attic ref itself cannot be written — the update-ref guard', () => {
    // A ref AT `refs/ccrc/attic/<id>` makes every `refs/ccrc/attic/<id>/<sha>`
    // unwritable (a directory/file conflict), while every sha stays a real
    // commit — so `cat-file` passes and only `update-ref`'s own status fails.
    const c = makeChild(h);
    h.git(c.main, 'update-ref', `refs/ccrc/attic/${CHILD_ID}`, c.tip);
    const p = pinOf(c);
    expect(p.rc).toBe('1');
    expect(p.why).toContain(`could not be pinned under refs/ccrc/attic/${CHILD_ID}/`);
  }, 60_000);
});

describe('the only git commit in ccd', () => {
  it('is one line, inside _ws_wip_commit, and _ws_wip_commit is called only from _ws_reclaim_pin', () => {
    const src = fs.readFileSync(CCD, 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*#/.test(l));
    expect(code.filter((l) => /\bcommit --no-verify\b/.test(l))).toHaveLength(1);
    const wipBody = src.slice(src.indexOf('_ws_wip_commit() {'), src.indexOf('_ws_reclaim_attic_extra() {'));
    expect(wipBody).toMatch(/\bcommit --no-verify\b/);
    const pinBody = src.slice(src.indexOf('_ws_reclaim_pin() {'), src.indexOf('_ws_reclaim_secrets_json() {'));
    const calls = (s: string): number => [...s.matchAll(/^[^#\n]*_ws_wip_commit "/gm)].length;
    expect(calls(src)).toBe(2);
    expect(calls(pinBody), 'a second caller of the commit helper').toBe(calls(src));
  });
});

describe('the tombstone', () => {
  it('carries the reclaim record beside every reap key, and ws-reap’s two-argument call is unchanged', () => {
    const c = makeChild(h);
    fs.writeFileSync(path.join(c.wt, '.env'), 'KEY=live');
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'edited\n');
    const REAP_KEYS = ['id', 'project', 'workdir', 'branch', 'registryBranch', 'base', 'tip', 'uuid', 'wrapper',
      'mergeCommit', 'proof', 'pr', 'prUrl', 'ignored', 'clips', 'transcript', 'attic', 'reflog', 'children', 'reapedAt'];
    const tombFile = path.join(h.home, '.cc-sessions', '.reaped', `${CHILD_ID}.json`);
    h.sh(`${CHILD_STUBS} _ws_reclaim_eval ${CHILD_ID} 0 ${CHILD_RUN} >/dev/null && _ws_tombstone ${CHILD_ID} '[]' >/dev/null`);
    expect(Object.keys(JSON.parse(fs.readFileSync(tombFile, 'utf8'))), 'two arguments: byte-for-byte the reap tombstone')
      .toEqual(REAP_KEYS);
    const out = h.sh(`${CHILD_STUBS} _ws_reclaim_eval ${CHILD_ID} 0 ${CHILD_RUN} >/dev/null`
      + ` && _ws_reclaim_pin ${CHILD_ID} "${c.wt}" "${c.main}" "$REAP_BRANCH" ${CHILD_RUN}`
      + ` && _ws_tombstone ${CHILD_ID} '[]' "$(_ws_reclaim_tomb_fields ${CHILD_RUN})" >/dev/null && printf '%s' "$RECLAIM_WIP"`);
    const tomb = JSON.parse(fs.readFileSync(tombFile, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(tomb)).toEqual([...REAP_KEYS.slice(0, -1),
      'mode', 'childOf', 'worktree', 'wip', 'secretsDropped', 'containment', 'residueBytes', 'reapedAt']);
    expect(tomb['mode']).toBe('reclaim');
    expect(tomb['childOf']).toBe(CHILD_RUN);
    expect(tomb['worktree'], 'the default: a tree was there to pin').toBe('present');
    expect(tomb['wip']).toBe(out);
    expect(tomb['tip'], 'the tip AFTER the WIP commit — what the tail deletes by CAS').toBe(out);
    expect(tomb['secretsDropped']).toEqual(['.env']);
    expect(tomb['containment']).toEqual({ sameRepository: [], foreignProven: [] });
    expect(tomb['residueBytes']).toBeNull();
  }, 60_000);

  it('patches keys in place, unions secretsDropped, and refuses when there is no tombstone', () => {
    const tombDir = path.join(h.home, '.cc-sessions', '.reaped');
    fs.mkdirSync(tombDir, { recursive: true });
    fs.writeFileSync(path.join(tombDir, `${CHILD_ID}.json`), JSON.stringify({ tip: 'a', secretsDropped: ['a', 'c'], keep: 1 }));
    h.sh(`_ws_tombstone_patch ${CHILD_ID} '{"tip":"b","secretsDropped":["b","a"],"residueBytes":12}'`);
    expect(JSON.parse(fs.readFileSync(path.join(tombDir, `${CHILD_ID}.json`), 'utf8')))
      .toEqual({ tip: 'b', secretsDropped: ['a', 'b', 'c'], keep: 1, residueBytes: 12 });
    expect(h.sh('_ws_tombstone_patch nobody \'{"tip":"x"}\'; echo "rc=$?"')).toBe('rc=1');
  });
});

describe('the workdir leaf is never followed — the settle re-pin runs without the ladder (spec §5.5)', () => {
  /** A sibling worktree `other` of the child's OWN repository, left DIRTY: the
   *  tree a pin that followed a link would commit into. */
  const makeOther = (c: Child): string => {
    const other = path.join(h.home, 'other');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/other', other);
    fs.writeFileSync(path.join(other, 'dirty.txt'), 'uncommitted work of another session\n');
    fs.appendFileSync(path.join(other, 'README.md'), 'edited\n');
    return other;
  };
  /** Everything of `other` a pin could change: every entry under it (path,
   *  type, mode, bytes), git's record of it, its branch tip, its status and
   *  its branch's subjects. */
  const snapshot = (c: Child, other: string): Record<string, unknown> => {
    const tree: string[] = [];
    const walk = (d: string): void => {
      for (const n of fs.readdirSync(d).sort()) {
        const p = path.join(d, n);
        const st = fs.lstatSync(p);
        const rel = path.relative(other, p);
        if (st.isDirectory()) { tree.push(`d ${st.mode.toString(8)} ${rel}`); walk(p); }
        else tree.push(`f ${st.mode.toString(8)} ${rel} ${fs.readFileSync(p).toString('base64')}`);
      }
    };
    walk(other);
    const stanza = h.git(c.main, 'worktree', 'list', '--porcelain').split('\n\n')
      .find((s) => s.startsWith(`worktree ${other}\n`)) ?? '<no record>';
    return {
      tree,
      record: stanza,
      tip: h.git(c.main, 'rev-parse', 'refs/heads/ws/other'),
      status: h.git(other, 'status', '--porcelain=v1', '--untracked-files=all'),
      subjects: h.git(c.main, 'log', '--format=%s', 'refs/heads/ws/other'),
    };
  };
  /** The ladder over the REAL tree first — it passes — then the child's
   *  directory swapped for a link to `other`, then the pin handed `workdir`:
   *  the window the settle re-pin runs in, where no ladder stands between a
   *  swapped-in link and the WIP commit. */
  const pinThroughLink = (c: Child, other: string, workdir: string): Pinned => {
    const out = h.sh(`${CHILD_STUBS} _ws_reclaim_eval ${CHILD_ID} 0 ${CHILD_RUN} >/dev/null`
      + ` && rm -rf "${c.wt}" && ln -s "${other}" "${c.wt}"`
      + ` && _ws_reclaim_pin ${CHILD_ID} "${workdir}" "${c.main}" "$REAP_BRANCH" ${CHILD_RUN}; rc=$?;`
      + ` printf '%s\\x1f%s\\x1f%s\\x1f%s\\x1f%s\\x1f%s' "$rc" "$RECLAIM_WIP" "$REAP_TIP" "$RECLAIM_PIN_WHY"`
      + ` "$(printf '%s\\n' "\${RECLAIM_SECRETS[@]}")" "$REAP_CHILDLINES"`);
    const [rc = '', wip = '', tip = '', why = '', secrets = '', childlines = ''] = out.split('\x1f');
    return { rc, wip, tip, why, secrets: secrets.split('\n').filter(Boolean), childlines };
  };

  it('FAILS on a workdir that is a symbolic link to another worktree — nothing committed there, nothing pinned', () => {
    const c = makeChild(h);
    const other = makeOther(c);
    const before = snapshot(c, other);
    const p = pinThroughLink(c, other, c.wt);
    expect(p.rc, p.why).toBe('1');
    expect(p.why).toContain('symbolic link');
    expect(snapshot(c, other), '`other` is byte-unchanged').toEqual(before);
    expect(String(snapshot(c, other)['subjects'])).not.toContain('ccrc: WIP pinned');
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'the child’s branch did not move').toBe(c.tip);
    expect(atticShas(c), 'the guard stands before every pin').toEqual([]);
  }, 60_000);

  it('FAILS on a link to a DETACHED worktree — where the branch check alone would let the commit through', () => {
    // `other` detached answers the pin's HEAD check (a detached HEAD is a
    // legal place for the WIP commit), so here the LEAF test is the only
    // guard between the pin and `other`'s work.
    const c = makeChild(h);
    const other = makeOther(c);
    h.git(other, 'checkout', '-q', '--detach');
    const before = snapshot(c, other);
    const p = pinThroughLink(c, other, c.wt);
    expect(p.rc, p.why).toBe('1');
    expect(p.why).toContain('symbolic link');
    expect(snapshot(c, other), '`other` is byte-unchanged').toEqual(before);
    expect(atticShas(c)).toEqual([]);
  }, 60_000);

  it('FAILS on the same link spelled `<wt>/`, `other` detached — a trailing slash cannot walk past the leaf test', () => {
    const c = makeChild(h);
    const other = makeOther(c);
    h.git(other, 'checkout', '-q', '--detach');
    const before = snapshot(c, other);
    const p = pinThroughLink(c, other, `${c.wt}/`);
    expect(p.rc, p.why).toBe('1');
    expect(p.why).toContain('not one plain absolute path');
    expect(snapshot(c, other), '`other` is byte-unchanged').toEqual(before);
    expect(atticShas(c)).toEqual([]);
  }, 60_000);

  it('FAILS on the same link spelled `<wt>/` — a trailing slash cannot walk past the leaf test', () => {
    // `lstat("<link>/")` follows the link, so `-L "<wt>/"` is false: without
    // the plain-path test the pin would commit `other`'s work.
    const c = makeChild(h);
    const other = makeOther(c);
    const before = snapshot(c, other);
    const p = pinThroughLink(c, other, `${c.wt}/`);
    expect(p.rc, p.why).toBe('1');
    expect(p.why).toContain('not one plain absolute path');
    expect(snapshot(c, other), '`other` is byte-unchanged').toEqual(before);
    expect(atticShas(c)).toEqual([]);
  }, 60_000);

  it('the CONTROL: a symlinked ANCESTOR is legal — only the leaf is tested', () => {
    const c = makeChild(h);
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'edited\n');
    fs.symlinkSync(path.join(h.home, 'worktrees'), path.join(h.home, 'wtlink'));
    const viaLink = path.join(h.home, 'wtlink', 'demo', 'quiet-basin');
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${CHILD_ID}.workdir`), viaLink);
    const p = pinOf({ ...c, wt: viaLink });
    expect(p.rc, p.why).toBe('0');
    expect(p.wip).toMatch(/^[0-9a-f]{40}$/);
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`)).toBe(p.wip);
  }, 60_000);
});

describe('a nested checkout whose repository cannot be resolved', () => {
  it('FAILS the pin — never skips it: the tail would remove its tree with its uncommitted work unpinned', () => {
    // The ladder asked rung 9 of the same checkout and it answered; this is a
    // read failing AFTER it (the settle's window). Folding the failure to
    // "another repository" would leave the checkout out of the pin and out of
    // the childlines the tail removes by.
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    fs.writeFileSync(path.join(inner, 'dirty.txt'), 'dirty');
    const nestedTip = h.git(c.main, 'rev-parse', 'refs/heads/ws/nested');
    const out = h.sh(`${CHILD_STUBS} _ws_reclaim_eval ${CHILD_ID} 0 ${CHILD_RUN} >/dev/null`
      + ` && _ws_common_dir() { case "$1" in */inner) return 1 ;; esac; git -C "$1" rev-parse --path-format=absolute --git-common-dir; }`
      + ` && _ws_reclaim_pin ${CHILD_ID} "${c.wt}" "${c.main}" "$REAP_BRANCH" ${CHILD_RUN}; printf '%s|%s' "$?" "$RECLAIM_PIN_WHY"`);
    const [rc, why] = out.split('|');
    expect(rc, why).toBe('1');
    expect(why, 'the unresolved checkout was folded into another kind').toContain(`could not resolve the repository of the checkout at ${inner}`);
    expect(h.git(c.main, 'rev-parse', 'refs/heads/ws/nested'), 'nothing was committed in the checkout').toBe(nestedTip);
  }, 60_000);
});

describe('the WIP commit never holds a secret-shaped path whose content differs from HEAD’s (spec §5.5, steps 1–2)', () => {
  /** A TRACKED secret-shaped file: a template committed on the branch. */
  const trackedSecret = (c: Child): string => {
    fs.mkdirSync(path.join(c.wt, 'config'));
    fs.writeFileSync(path.join(c.wt, 'config', '.env'), 'KEY=\n');
    h.git(c.wt, 'add', 'config/.env'); h.git(c.wt, 'commit', '-m', 'the template');
    return h.git(c.wt, 'rev-parse', 'HEAD:config/.env');
  };

  it('(a) a secret STAGED but never committed is not committed, is listed, and stays staged in the user’s own index', () => {
    // The shape a pre-commit secret scanner leaves: it refused the commit, and
    // the file is still in the index.
    const c = makeChild(h);
    fs.writeFileSync(path.join(c.wt, '.env'), 'KEY=live');
    fs.mkdirSync(path.join(c.wt, 'secrets')); fs.writeFileSync(path.join(c.wt, 'secrets', 'token.txt'), 't');
    fs.writeFileSync(path.join(c.wt, 'staged-plain.txt'), 'kept');
    h.git(c.wt, 'add', '.env', 'secrets/token.txt', 'staged-plain.txt');
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    const tree = h.git(c.main, 'ls-tree', '-r', '--name-only', p.wip).split('\n');
    expect(tree, 'a staged NEW non-secret file is committed').toContain('staged-plain.txt');
    for (const never of ['.env', 'secrets/token.txt']) {
      expect(tree, `${never} was committed from the index`).not.toContain(never);
    }
    expect([...p.secrets].sort()).toEqual(['.env', 'secrets/token.txt']);
    expect(h.git(c.wt, 'ls-files', '--stage', '--', '.env', 'secrets/token.txt').split('\n'),
      'the user’s own index was rewritten').toHaveLength(2);
  }, 60_000);

  it('(b) a STAGED modification of a tracked secret-shaped file keeps HEAD’s blob, and is listed', () => {
    const c = makeChild(h);
    const template = trackedSecret(c);
    fs.writeFileSync(path.join(c.wt, 'config', '.env'), 'KEY=live\n');
    h.git(c.wt, 'add', 'config/.env');
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'edited\n');
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    expect(h.git(c.main, 'rev-parse', `${p.wip}:config/.env`), 'the live key was committed').toBe(template);
    expect(h.git(c.main, 'show', `${p.wip}:f1.txt`)).toContain('edited');
    expect(p.secrets).toEqual(['config/.env']);
  }, 60_000);

  it('(c) an UNSTAGED modification of a tracked secret-shaped file keeps HEAD’s blob, and is listed', () => {
    const c = makeChild(h);
    const template = trackedSecret(c);
    fs.writeFileSync(path.join(c.wt, 'config', '.env'), 'KEY=live\n');
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'edited\n');
    fs.rmSync(path.join(c.wt, 'f2.txt'));
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    expect(h.git(c.main, 'rev-parse', `${p.wip}:config/.env`), 'the live key was committed').toBe(template);
    const tree = h.git(c.main, 'ls-tree', '-r', '--name-only', p.wip).split('\n');
    expect(tree, 'a tracked DELETION is committed').not.toContain('f2.txt');
    expect(p.secrets).toEqual(['config/.env']);
  }, 60_000);

  it('the tombstone’s secretsDropped carries the staged and the tracked secret', () => {
    const c = makeChild(h);
    trackedSecret(c);
    fs.writeFileSync(path.join(c.wt, 'config', '.env'), 'KEY=live\n');
    fs.writeFileSync(path.join(c.wt, '.env'), 'KEY=live');
    h.git(c.wt, 'add', '.env');
    h.sh(`${CHILD_STUBS} _ws_reclaim_eval ${CHILD_ID} 0 ${CHILD_RUN} >/dev/null`
      + ` && _ws_reclaim_pin ${CHILD_ID} "${c.wt}" "${c.main}" "$REAP_BRANCH" ${CHILD_RUN}`
      + ` && _ws_tombstone ${CHILD_ID} '[]' "$(_ws_reclaim_tomb_fields ${CHILD_RUN})" >/dev/null`);
    const tomb = JSON.parse(fs.readFileSync(path.join(h.home, '.cc-sessions', '.reaped', `${CHILD_ID}.json`), 'utf8')) as Record<string, unknown>;
    expect([...(tomb['secretsDropped'] as string[])].sort()).toEqual(['.env', 'config/.env']);
  }, 60_000);
});

describe('the WIP commit lands only on the child’s own branch or a detached HEAD', () => {
  it('FAILS when the tree has switched to another branch after the ladder — that branch does not move', () => {
    const c = makeChild(h);
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'edited\n');
    const p = pinOf(c, { between: `git -C "${c.wt}" switch -q -c shared-feature` });
    expect(p.rc, p.why).toBe('1');
    expect(p.why).toContain('refs/heads/shared-feature');
    expect(h.git(c.main, 'rev-parse', 'refs/heads/shared-feature'), 'the WIP commit landed on another branch').toBe(c.tip);
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`)).toBe(c.tip);
    expect(atticShas(c), 'nothing was pinned').toEqual([]);
  }, 60_000);
});

describe('the branch tip is a REQUIRED pin', () => {
  it('FAILS on a detached child whose branch tip cannot be pinned — the tip is not HEAD, so nothing else pins it', () => {
    const c = makeChild(h);
    h.git(c.wt, 'checkout', '--detach');
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'detached work\n');
    // A ref BELOW the tip's attic name makes that one name unwritable (a
    // directory/file conflict) while every other sha still pins.
    h.git(c.main, 'update-ref', `refs/ccrc/attic/${CHILD_ID}/${c.tip}/blocker`, c.tip);
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('1');
    expect(p.why).toContain(`could not be pinned under refs/ccrc/attic/${CHILD_ID}/`);
  }, 60_000);

  it('FAILS when the branch no longer resolves — there is no tip the tail could delete it at', () => {
    const c = makeChild(h);
    h.git(c.wt, 'checkout', '--detach');
    const p = pinOf(c, { between: `git -C "${c.main}" update-ref -d refs/heads/${CHILD_BRANCH}` });
    expect(p.rc, p.why).toBe('1');
    expect(p.why).toContain(`refs/heads/${CHILD_BRANCH} does not resolve`);
  }, 60_000);
});

describe('nested checkouts, re-proven and pinned on every call', () => {
  /** A clean, pushed clone of ANOTHER repository at `<wt>/vendor/other`. */
  const foreignClone = (wt: string): string => {
    const origin = path.join(h.home, 'origins', 'other.git');
    execFileSync('git', ['init', '--bare', '-q', '-b', 'main', origin]);
    const seedRepo = path.join(h.home, 'seed-other');
    execFileSync('git', ['init', '-q', '-b', 'main', seedRepo]);
    fs.writeFileSync(path.join(seedRepo, 'r'), 'r');
    h.git(seedRepo, 'add', 'r'); h.git(seedRepo, 'commit', '-m', 'r');
    h.git(seedRepo, 'remote', 'add', 'origin', origin); h.git(seedRepo, 'push', '-q', 'origin', 'main');
    const clone = path.join(wt, 'vendor', 'other');
    execFileSync('git', ['clone', '-q', origin, clone]);
    return clone;
  };

  it('the CONTROL: a clean, pushed checkout of another repository passes, and is not committed into the child', () => {
    const c = makeChild(h);
    foreignClone(c.wt);
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'edited\n');
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    expect(h.git(c.main, 'ls-tree', '-r', '--name-only', p.wip).split('\n').filter((f) => f.startsWith('vendor'))).toEqual([]);
  }, 60_000);

  it('FAILS when a checkout of another repository was DIRTIED after the ladder — its proof is taken again', () => {
    const c = makeChild(h);
    const clone = foreignClone(c.wt);
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'edited\n');
    const p = pinOf(c, { between: `echo late > "${clone}/late.txt"` });
    expect(p.rc, p.why).toBe('1');
    expect(p.why).toContain('uncommitted file(s)');
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'nothing was committed before the proof').toBe(c.tip);
  }, 60_000);

  it('FAILS when a checkout of another repository gained a commit on none of its remotes after the ladder', () => {
    const c = makeChild(h);
    const clone = foreignClone(c.wt);
    const p = pinOf(c, { between: `git -C "${clone}" -c user.name=x -c user.email=x@x commit -q --allow-empty -m local` });
    expect(p.rc, p.why).toBe('1');
    expect(p.why).toContain('on none of its remotes');
  }, 60_000);

  it('FAILS on a same-repository checkout with NO commit at HEAD (an orphan) — nothing is committed', () => {
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '--orphan', '-b', 'ws/orphan', inner);
    fs.writeFileSync(path.join(inner, '.env'), 'KEY=live');
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'edited\n');
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('1');
    expect(p.why).toContain('has no commit at HEAD');
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'nothing was committed').toBe(c.tip);
  }, 60_000);

  it('pins a nested checkout’s operation heads BEFORE its WIP commit concludes them', () => {
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    const tree = h.git(inner, 'rev-parse', 'HEAD^{tree}');
    const mergeSide = h.git(inner, 'commit-tree', tree, '-p', 'HEAD', '-m', 'nested merge side, in no reflog');
    expect(h.git(c.wt, 'reflog', 'show', '--all', '--format=%H'), 'the CONTROL: in no reflog').not.toContain(mergeSide);
    fs.writeFileSync(h.git(inner, 'rev-parse', '--path-format=absolute', '--git-path', 'MERGE_HEAD'), `${mergeSide}\n`);
    fs.writeFileSync(path.join(inner, 'dirty.txt'), 'dirty');
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    expect(fs.existsSync(h.git(inner, 'rev-parse', '--path-format=absolute', '--git-path', 'MERGE_HEAD')),
      'the CONTROL: the nested WIP commit concluded the merge').toBe(false);
    expect(atticShas(c), 'the nested MERGE_HEAD is not pinned').toContain(mergeSide);
  }, 60_000);

  it('pins a commit that only a nested checkout’s own HEAD reflog names', () => {
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    h.git(inner, 'checkout', '-q', '--detach');
    fs.writeFileSync(path.join(inner, 'x.txt'), 'x'); h.git(inner, 'add', 'x.txt'); h.git(inner, 'commit', '-q', '-m', 'detached, then left');
    const lost = h.git(inner, 'rev-parse', 'HEAD');
    h.git(inner, 'checkout', '-q', 'ws/nested');
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    expect(atticShas(c)).toContain(lost);
  }, 60_000);
});
