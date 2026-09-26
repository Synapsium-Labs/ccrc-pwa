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
  CHILD_BRANCH, CHILD_ID, CHILD_RUN, CHILD_STUBS, appendReflog, atticReach, hasCommit, looseCommits, makeChild, type Child,
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
    const head = h.git(c.wt, 'rev-parse', 'HEAD');
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
    // THE COMMIT MOVES NO REF (`wip-moves-no-ref`): it sits on HEAD, is pinned
    // by sha, and the branch, HEAD and the user's index are exactly as found.
    expect(h.git(c.main, 'log', '-1', '--format=%P', p.wip), 'the WIP commit sits on HEAD').toBe(head);
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'the branch moved').toBe(head);
    expect(h.git(c.wt, 'rev-parse', 'HEAD'), 'HEAD moved').toBe(head);
    expect(h.git(c.wt, 'status', '--porcelain', '--', 'f1.txt'), 'the user’s index was written').toBe('M f1.txt');
    expect(p.tip, 'the tip is the branch’s own').toBe(head);
    expect(atticShas(c)).toContain(p.wip);
  }, 60_000);

  it('is IDEMPOTENT — a second pin of an unchanged tree answers the same WIP commit, and a changed one a new one', () => {
    const c = makeChild(h);
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'edited\n');
    const first = pinOf(c);
    expect(first.rc, first.why).toBe('0');
    const again = h.sh(`${CHILD_STUBS} sleep 1; _ws_reclaim_pin ${CHILD_ID} "${c.wt}" "${c.main}" ${CHILD_BRANCH} ${CHILD_RUN}`
      + ` && printf '%s' "$RECLAIM_WIP"`);
    expect(again, 'a second WIP commit of the same tree').toBe(first.wip);
    fs.writeFileSync(path.join(c.wt, 'later.txt'), 'l');
    const later = h.sh(`${CHILD_STUBS} _ws_reclaim_pin ${CHILD_ID} "${c.wt}" "${c.main}" ${CHILD_BRANCH} ${CHILD_RUN}`
      + ` && printf '%s' "$RECLAIM_WIP"`);
    expect(later).toMatch(/^[0-9a-f]{40}$/);
    expect(later).not.toBe(first.wip);
    expect(h.git(c.main, 'ls-tree', '-r', '--name-only', later).split('\n')).toContain('later.txt');
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
    // The two heads are commits NO reflog names. `_ws_reclaim_pin` also keeps
    // every commit the child's own reflogs name (`_ws_reclaim_keep_reflogs`) —
    // its HEAD's and its branch's. A head that is in either of those is kept
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
    const nestedTip = h.git(c.main, 'rev-parse', 'refs/heads/ws/nested');
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    expect(h.git(c.main, 'rev-parse', 'refs/heads/ws/nested'), 'the nested branch moved').toBe(nestedTip);
    const nestedWip = atticShas(c).find((sha) => h.git(c.main, 'ls-tree', '-r', '--name-only', sha).split('\n').includes('dirty.txt'));
    expect(nestedWip, 'the nested uncommitted work is not in the attic').toBeDefined();
    expect(h.git(c.main, 'log', '-1', '--format=%P', nestedWip!)).toBe(nestedTip);
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

describe('the only commit ccd writes', () => {
  it('is one `commit-tree` line, inside _ws_reclaim_commit_tree — no `git commit` at all — whose only callers are the WIP commit and the reflog keep; and _ws_wip_commit is called only from _ws_reclaim_pin', () => {
    // ONE writer, so ONE identity: the reflog keep (`_ws_reclaim_keep_reflogs`)
    // writes through the WIP commit's own helper, never a second copy of it.
    const src = fs.readFileSync(CCD, 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*#/.test(l));
    expect(code.filter((l) => /\bcommit-tree\b/.test(l))).toHaveLength(1);
    expect(code.filter((l) => /\bcommit --no-verify\b|\bgit( -C "[^"]*")?( -c [^ ]+)* commit\b/.test(l)), 'a `git commit`, which moves a ref').toEqual([]);
    const writer = src.slice(src.indexOf('_ws_reclaim_commit_tree() {'), src.indexOf('_ws_reclaim_attic_extra() {'));
    expect(writer).toMatch(/^[^#\n]*\bcommit-tree\b/m);
    let fn = '';
    const callers: string[] = [];
    for (const l of src.split('\n')) {
      fn = /^([A-Za-z_][A-Za-z0-9_]*)\(\) \{/.exec(l)?.[1] ?? fn;
      if (!/^\s*#/.test(l) && /_ws_reclaim_commit_tree "/.test(l)) callers.push(fn);
    }
    expect(callers, 'the commit writer’s callers, by enclosing function').toEqual(['_ws_wip_commit', '_ws_reclaim_keep_reflogs']);
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
    expect(tomb['tip'], 'the branch’s own tip — what the tail deletes by CAS; the WIP commit moves no ref').toBe(c.tip);
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
    expect(atticShas(c)).toContain(p.wip);
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
    const idxPath = h.git(c.wt, 'rev-parse', '--path-format=absolute', '--git-path', 'index');
    // README.md is TOUCHED after the hash, its bytes unchanged: its stat no
    // longer matches the index, so any read that refreshes the index has a
    // reason to rewrite it — the phase's reads must not.
    const p = pinOf(c, { between: `sha256sum "${idxPath}" > "$HOME/idx-before"; sleep 1; touch "${c.wt}/README.md"` });
    expect(p.rc, p.why).toBe('0');
    expect(h.sh(`sha256sum "${idxPath}"`), 'the user’s index file is byte-identical')
      .toBe(fs.readFileSync(path.join(h.home, 'idx-before'), 'utf8').trim());
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

describe('the WIP commit lands on no branch — a drifted HEAD’s branch is KEPT and recorded', () => {
  it('pins a tree that switched to another branch after the ladder: that branch does not move, and is recorded as kept', () => {
    const c = makeChild(h);
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'edited\n');
    const out = h.sh(`${CHILD_STUBS} _ws_reclaim_eval ${CHILD_ID} 0 ${CHILD_RUN} >/dev/null`
      + ` && git -C "${c.wt}" switch -q -c shared-feature`
      + ` && _ws_reclaim_pin ${CHILD_ID} "${c.wt}" "${c.main}" "$REAP_BRANCH" ${CHILD_RUN}; rc=$?;`
      + ` printf '%s\x1f%s\x1f%s\x1f%s' "$rc" "$RECLAIM_WIP" "$RECLAIM_PIN_WHY" "$(printf '%s\n' "\${RECLAIM_KEPT[@]}")"`);
    const [rc = '', wip = '', why = '', kept = ''] = out.split('\x1f');
    expect(rc, why).toBe('0');
    expect(h.git(c.main, 'rev-parse', 'refs/heads/shared-feature'), 'the WIP commit landed on another branch').toBe(c.tip);
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`)).toBe(c.tip);
    expect(atticShas(c)).toContain(wip);
    expect(kept, 'the drifted branch is not recorded as kept').toContain(`shared-feature (checked out at ${c.wt} in place of ${CHILD_BRANCH})`);
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

  it('pins a nested checkout’s operation heads — and its WIP commit concludes nothing', () => {
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
      'the nested WIP commit concluded the merge — it moves no ref and no state of the tree').toBe(true);
    expect(atticShas(c), 'the nested MERGE_HEAD is not pinned').toContain(mergeSide);
    const nestedWip = atticShas(c).find((sha) => h.git(c.main, 'ls-tree', '-r', '--name-only', sha).split('\n').includes('dirty.txt'));
    expect(h.git(c.main, 'log', '-1', '--format=%P', nestedWip!).split(' '), 'the WIP commit carries the merged-in side').toContain(mergeSide);
  }, 60_000);

  it('pins a commit that only a nested checkout’s own HEAD reflog names', () => {
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    h.git(inner, 'checkout', '-q', '--detach');
    fs.writeFileSync(path.join(inner, 'x.txt'), 'x'); h.git(inner, 'add', 'x.txt'); h.git(inner, 'commit', '-q', '-m', 'detached, then left');
    const lost = h.git(inner, 'rev-parse', 'HEAD');
    h.git(inner, 'checkout', '-q', 'ws/nested');
    expect(h.git(c.main, 'reflog', 'show', '--format=%H', 'refs/heads/ws/nested'), 'the CONTROL: no branch reflog names it').not.toContain(lost);
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    expect(atticReach(h, c)).toContain(lost);
  }, 60_000);
});

describe('the WIP commit starts from a COPY of the user’s own index', () => {
  it('commits staged work under an IGNORED path (`add -f`), and withholds and lists a force-added secret', () => {
    const c = makeChild(h);
    fs.writeFileSync(path.join(c.wt, '.gitignore'), 'build/\n.env\n');
    h.git(c.wt, 'add', '.gitignore'); h.git(c.wt, 'commit', '-m', 'ignore');
    fs.mkdirSync(path.join(c.wt, 'build')); fs.writeFileSync(path.join(c.wt, 'build', 'handwritten.json'), '{}');
    fs.writeFileSync(path.join(c.wt, '.env'), 'KEY=live');
    h.git(c.wt, 'add', '-f', 'build/handwritten.json', '.env');
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    const tree = h.git(c.main, 'ls-tree', '-r', '--name-only', p.wip).split('\n');
    expect(tree, 'staged work under an ignored path was dropped').toContain('build/handwritten.json');
    expect(tree).not.toContain('.env');
    expect(p.secrets).toContain('.env');
  }, 60_000);

  // A HIDDEN-FLAG EDIT GOES THROUGH THE SAME SECRET CLASSIFIER AS EVERY OTHER
  // TRACKED MODIFICATION (spec §5.5 step 2): `git status` does not report an
  // edit to a skip-worktree or assume-unchanged path, and the tail's
  // `worktree remove --force` deletes it — so it is found by content, and
  // either KEPT in the WIP or dropped and RECORDED if it is secret-shaped.
  it('a SECRET-SHAPED hidden edit — `.env` skip-worktree, `secrets/db.yml` assume-unchanged — is never committed, and IS recorded', () => {
    const c = makeChild(h);
    fs.mkdirSync(path.join(c.wt, 'secrets'));
    for (const f of ['.env', 'secrets/db.yml']) fs.writeFileSync(path.join(c.wt, f), 'KEY=template\n');
    h.git(c.wt, 'add', '.env', 'secrets/db.yml'); h.git(c.wt, 'commit', '-m', 'templates');
    const head = { env: h.git(c.wt, 'rev-parse', 'HEAD:.env'), db: h.git(c.wt, 'rev-parse', 'HEAD:secrets/db.yml') };
    h.git(c.wt, 'update-index', '--skip-worktree', '.env');
    h.git(c.wt, 'update-index', '--assume-unchanged', 'secrets/db.yml');
    for (const f of ['.env', 'secrets/db.yml']) fs.writeFileSync(path.join(c.wt, f), 'KEY=live\n');
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'edited\n');
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    expect(p.wip).toMatch(/^[0-9a-f]{40}$/);
    expect(h.git(c.main, 'rev-parse', `${p.wip}:.env`), 'the hidden secret edit was committed').toBe(head.env);
    expect(h.git(c.main, 'rev-parse', `${p.wip}:secrets/db.yml`), 'the hidden secret edit was committed').toBe(head.db);
    expect([...p.secrets].sort(), 'a dropped hidden secret must be RECORDED, never dropped in silence').toEqual(['.env', 'secrets/db.yml']);
  }, 60_000);

  it('a NON-SECRET hidden edit — one skip-worktree, one assume-unchanged — IS committed, and the user’s index flags are unchanged', () => {
    const c = makeChild(h);
    for (const f of ['db.yml', 'au.yml']) fs.writeFileSync(path.join(c.wt, f), 'password: template\n');
    h.git(c.wt, 'add', 'db.yml', 'au.yml'); h.git(c.wt, 'commit', '-m', 'configs');
    h.git(c.wt, 'update-index', '--skip-worktree', 'db.yml');
    h.git(c.wt, 'update-index', '--assume-unchanged', 'au.yml');
    fs.writeFileSync(path.join(c.wt, 'db.yml'), 'password: db-local\n');
    fs.writeFileSync(path.join(c.wt, 'au.yml'), 'password: au-local\n');
    const flags = h.git(c.wt, 'ls-files', '-v');
    expect(flags, 'the CONTROL: both flags are set').toContain('S db.yml');
    expect(flags, 'the CONTROL: both flags are set').toContain('h au.yml');
    expect(h.git(c.wt, 'status', '--porcelain'), 'the CONTROL: git status reports neither edit').toBe('');
    const index = h.git(c.wt, 'rev-parse', '--path-format=absolute', '--git-path', 'index');
    const before = fs.readFileSync(index);
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    expect(fs.readFileSync(index).equals(before), 'the user’s index file was written — only the scratch copy may be').toBe(true);
    expect(p.wip, 'the hidden edits alone make a WIP commit').toMatch(/^[0-9a-f]{40}$/);
    expect(h.git(c.main, 'show', `${p.wip}:db.yml`), 'the skip-worktree edit was dropped').toBe('password: db-local');
    expect(h.git(c.main, 'show', `${p.wip}:au.yml`), 'the assume-unchanged edit was dropped').toBe('password: au-local');
    expect(p.secrets).toEqual([]);
    expect(h.git(c.wt, 'ls-files', '-v'), 'the user’s own index flags were changed — only the scratch copy may be').toBe(flags);
    expect(fs.readFileSync(path.join(c.wt, 'db.yml'), 'utf8'), 'the working tree was touched').toBe('password: db-local\n');
  }, 60_000);

  it('pins a SPARSE-checkout child, and records no deletion for the paths outside the cone', () => {
    const c = makeChild(h);
    for (const d of ['keep', 'drop']) { fs.mkdirSync(path.join(c.wt, d)); fs.writeFileSync(path.join(c.wt, d, 'x'), d); }
    h.git(c.wt, 'add', 'keep', 'drop'); h.git(c.wt, 'commit', '-m', 'two dirs');
    h.git(c.wt, 'sparse-checkout', 'set', 'keep');
    expect(fs.existsSync(path.join(c.wt, 'drop')), 'the CONTROL: drop/ is outside the cone').toBe(false);
    fs.appendFileSync(path.join(c.wt, 'keep', 'x'), ' edited');
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    const tree = h.git(c.main, 'ls-tree', '-r', '--name-only', p.wip).split('\n');
    expect(tree, 'an out-of-cone path was recorded as deleted').toContain('drop/x');
    expect(h.git(c.main, 'show', `${p.wip}:keep/x`)).toBe('keep edited');
  }, 60_000);

  it('pins through a LOCKED index — it only copies the index, and leaves the lock and the index as found', () => {
    // Rung 6 defers a held lock on the fresh arm; the pin itself must not fail
    // on one, or a lock a crash (or the pane kill) left wedges the child for
    // good — the settle runs with the pane dead.
    const c = makeChild(h);
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'edited\n');
    const idx = h.git(c.wt, 'rev-parse', '--path-format=absolute', '--git-path', 'index');
    const before = fs.readFileSync(idx);
    const p = pinOf(c, { between: `: > "${idx}.lock"` });
    expect(p.rc, p.why).toBe('0');
    expect(h.git(c.main, 'show', `${p.wip}:f1.txt`)).toContain('edited');
    expect(fs.existsSync(`${idx}.lock`), 'the lock was removed').toBe(true);
    expect(fs.readFileSync(idx).equals(before), 'the user’s index was written').toBe(true);
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`)).toBe(c.tip);
  }, 60_000);

  it('pins through a leftover HEAD.lock and a lock on the child’s own branch ref — the WIP commit moves no ref', () => {
    const c = makeChild(h);
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'edited\n');
    const headLock = `${h.git(c.wt, 'rev-parse', '--path-format=absolute', '--git-path', 'HEAD')}.lock`;
    const refLock = `${h.git(c.main, 'rev-parse', '--path-format=absolute', '--git-path', `refs/heads/${CHILD_BRANCH}`)}.lock`;
    const p = pinOf(c, { between: `: > "${headLock}" && : > "${refLock}"` });
    expect(p.rc, p.why).toBe('0');
    expect(h.git(c.main, 'show', `${p.wip}:f1.txt`)).toContain('edited');
    expect(atticShas(c)).toContain(p.wip);
    expect(fs.existsSync(headLock) && fs.existsSync(refLock), 'a lock was removed').toBe(true);
  }, 60_000);

  it('FAILS — commits nothing — when the tree has NO index', () => {
    const c = makeChild(h);
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'edited\n');
    const idx = h.git(c.wt, 'rev-parse', '--path-format=absolute', '--git-path', 'index');
    const p = pinOf(c, { between: `rm -f "${idx}"` });
    expect(p.rc, p.why).toBe('1');
    expect(p.why).toContain('has no index');
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`)).toBe(c.tip);
  }, 60_000);

  it('concludes a CONFLICTED merge with the working-tree version of each unmerged path, and pins the merged-in side', () => {
    const c = makeChild(h);
    h.git(c.wt, 'switch', '-q', '-c', 'side', 'HEAD~1');
    fs.writeFileSync(path.join(c.wt, 'f1.txt'), 'side version\n');
    h.git(c.wt, 'commit', '-q', '-am', 'side');
    const side = h.git(c.wt, 'rev-parse', 'HEAD');
    h.git(c.wt, 'switch', '-q', CHILD_BRANCH);
    fs.writeFileSync(path.join(c.wt, 'f1.txt'), 'child version\n');
    h.git(c.wt, 'commit', '-q', '-am', 'child');
    try { h.git(c.wt, 'merge', '-q', 'side'); } catch { /* conflicts on f1.txt, and exits non-zero */ }
    expect(h.git(c.wt, 'ls-files', '-u'), 'the CONTROL: an unmerged path').not.toBe('');
    const p = pinOf(c, { defer: 1 });
    expect(p.rc, p.why).toBe('0');
    expect(h.git(c.main, 'log', '-1', '--format=%P', p.wip).split(' '), 'the WIP commit concluded the merge').toContain(side);
    expect(h.git(c.main, 'show', `${p.wip}:f1.txt`)).toContain('<<<<<<<');
    expect(atticShas(c)).toContain(side);
  }, 60_000);
});

describe('intent-to-add entries (`git add -N`), and every status code accounted for', () => {
  it('commits an intent-to-add file when it is the ONLY change', () => {
    const c = makeChild(h);
    fs.writeFileSync(path.join(c.wt, 'plan.md'), 'the plan\n');
    h.git(c.wt, 'add', '-N', 'plan.md');
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    expect(p.wip, 'no WIP commit — the intent-to-add file would die with the tree').toMatch(/^[0-9a-f]{40}$/);
    expect(h.git(c.main, 'show', `${p.wip}:plan.md`)).toBe('the plan');
  }, 60_000);

  it('commits an intent-to-add file beside other changes', () => {
    const c = makeChild(h);
    fs.writeFileSync(path.join(c.wt, 'plan.md'), 'the plan\n');
    h.git(c.wt, 'add', '-N', 'plan.md');
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'edited\n');
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    expect(h.git(c.main, 'ls-tree', '-r', '--name-only', p.wip).split('\n')).toEqual(expect.arrayContaining(['plan.md', 'f1.txt']));
  }, 60_000);

  it('withholds and LISTS an intent-to-add secret-shaped file', () => {
    const c = makeChild(h);
    fs.writeFileSync(path.join(c.wt, '.env'), 'KEY=live');
    h.git(c.wt, 'add', '-N', '.env');
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'edited\n');
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    expect(h.git(c.main, 'ls-tree', '-r', '--name-only', p.wip).split('\n')).not.toContain('.env');
    expect(p.secrets, 'the intent-to-add secret is in no record').toEqual(['.env']);
  }, 60_000);

  it('commits BOTH halves of what git would read as a rename — the deletion and the intent-to-add file', () => {
    // With rename detection, `status` pairs a deleted tracked file with an
    // intent-to-add one of the same content as ` R new\0old`; read as one
    // path, the deletion's half is lost.
    const c = makeChild(h);
    fs.renameSync(path.join(c.wt, 'f2.txt'), path.join(c.wt, 'g2.txt'));
    h.git(c.wt, 'add', '-N', 'g2.txt');
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    const tree = h.git(c.main, 'ls-tree', '-r', '--name-only', p.wip).split('\n');
    expect(tree).toContain('g2.txt');
    expect(tree, 'the deletion half was dropped').not.toContain('f2.txt');
  }, 60_000);

  it('FAILS — never skips — on a status code the pin does not know', () => {
    // `--no-renames` means git never answers R or C; a git that did anyway is
    // the shape of "a code nobody enumerated", which must not drop its path.
    const c = makeChild(h);
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'edited\n');
    const p = pinOf(c, { between: 'git() { case "$*" in *"--untracked-files=all --no-renames"*) printf "R  new.txt\\0old.txt\\0"; return 0 ;; esac; command git "$@"; }' });
    expect(p.rc, p.why).toBe('1');
    expect(p.why).toContain('does not know');
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`)).toBe(c.tip);
  }, 60_000);
});

describe('the pin proves every tree’s git directory is git’s own record of it, before any commit (spec §5.5, rung 9; the final review’s P4, P8)', () => {
  it('FAILS — writes nothing anywhere — when the child’s `.git` is re-pointed at a sibling’s admin directory after the ladder', () => {
    const c = makeChild(h);
    const other = path.join(h.home, 'other');
    h.git(c.main, 'worktree', 'add', '-q', '--detach', other, 'main');
    const otherHead = h.git(other, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(c.wt, 'child-work.txt'), 'x\n');
    const p = pinOf(c, { between: `cp -- "${other}/.git" "${c.wt}/.git"` });
    expect(p.rc, p.why).toBe('1');
    expect(p.why).toContain('another checkout');
    expect(p.wip).toBe('');
    expect(atticShas(c), 'nothing was pinned').toEqual([]);
    expect(h.git(other, 'rev-parse', 'HEAD')).toBe(otherHead);
    expect(h.git(other, 'status', '--porcelain')).toBe('');
  }, 60_000);

  it('FAILS — writes nothing anywhere — when a COPY of another worktree appears inside the child after the ladder', () => {
    const c = makeChild(h);
    const other = path.join(h.home, 'other');
    h.git(c.main, 'worktree', 'add', '-q', '-b', 'ws/other', other);
    const otherTip = h.git(c.main, 'rev-parse', 'refs/heads/ws/other');
    const p = pinOf(c, { between: `cp -R -- "${other}" "${c.wt}/copy" && echo x > "${c.wt}/copy/dirty.txt"` });
    expect(p.rc, p.why).toBe('1');
    expect(p.why).toContain(path.join(c.wt, 'copy'));
    expect(p.why).toContain('another checkout');
    expect(atticShas(c), 'nothing was pinned').toEqual([]);
    expect(h.git(c.main, 'rev-parse', 'refs/heads/ws/other')).toBe(otherTip);
    expect(h.git(other, 'status', '--porcelain')).toBe('');
  }, 60_000);

  it('the CONTROL: a registered nested worktree is its own record, and pins', () => {
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-q', '-b', 'ws/nested', inner);
    fs.writeFileSync(path.join(inner, 'dirty.txt'), 'dirty');
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
  }, 60_000);
});

describe('the child’s own reflogs are kept COMPLETELY — every entry, both sides, read from the log file (spec §5.5)', () => {
  const REFLOGS_REF = `refs/ccrc/attic/${CHILD_ID}/reflogs`;
  const branchLog = (c: Child): string =>
    h.git(c.main, 'rev-parse', '--path-format=absolute', '--git-path', `logs/refs/heads/${CHILD_BRANCH}`);

  it('keeps every one of 250 commits the child’s branch reflog names — no cap — under ONE attic ref, written as ccrc', () => {
    // 250 SIBLINGS, never a chain: keeping one keeps no other, so a keep that
    // dropped any of them — a `head -200`, a lost chunk — is seen.
    const c = makeChild(h);
    const ids = looseCommits(h, c.main, 250, 'moved');
    appendReflog(h, c.main, `refs/heads/${CHILD_BRANCH}`, ids);
    const p = pinOf(c, { env: { GIT_AUTHOR_NAME: 'intruder', GIT_AUTHOR_EMAIL: 'intruder@x',
      GIT_COMMITTER_NAME: 'intruder', GIT_COMMITTER_EMAIL: 'intruder@x' } });
    expect(p.rc, p.why).toBe('0');
    const kept = new Set(atticReach(h, c));
    expect(ids.filter((id) => !kept.has(id)), 'reflog commits the attic does not keep').toEqual([]);
    const refs = h.git(c.main, 'for-each-ref', '--format=%(refname)', `refs/ccrc/attic/${CHILD_ID}/`).split('\n');
    expect(refs.filter((r) => !/\/[0-9a-f]{40}$/.test(r)), 'the reflog commits are kept by ONE ref, not a ref each').toEqual([REFLOGS_REF]);
    expect(h.git(c.main, 'log', '-1', '--format=%an <%ae>|%cn <%ce>|%s', REFLOGS_REF)).toBe(
      'ccrc reclaim <ccrc-reclaim@invalid>|ccrc reclaim <ccrc-reclaim@invalid>'
      + `|ccrc: reflog commits kept at reclaim of ${CHILD_ID}`);
  }, 60_000);

  it('reads the OLD side of an entry too — a commit an entry names only as the value it moved FROM is kept', () => {
    // The first entry left after a reflog is expired names, as its old value,
    // a commit whose own entry is gone. A `%H` listing prints new values only.
    const c = makeChild(h);
    const [oldOnly] = looseCommits(h, c.main, 1, 'old side');
    fs.appendFileSync(branchLog(c), `${oldOnly} ${c.tip} T <t@x> 1700000000 +0000\tfixture: moved back\n`);
    expect(h.git(c.main, 'reflog', 'show', '--format=%H', `refs/heads/${CHILD_BRANCH}`), 'the CONTROL: no %H listing names it')
      .not.toContain(oldOnly);
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    expect(atticReach(h, c)).toContain(oldOnly);
  }, 60_000);

  it('SKIPS an entry naming a commit git no longer has — never a failure — and keeps the rest', () => {
    const c = makeChild(h);
    const [kept] = looseCommits(h, c.main, 1, 'still here');
    appendReflog(h, c.main, `refs/heads/${CHILD_BRANCH}`, ['d'.repeat(40), kept!]);
    expect(hasCommit(h, c.main, 'd'.repeat(40)), 'the CONTROL: git has no such commit').toBe(false);
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    expect(atticReach(h, c)).toContain(kept);
  }, 60_000);

  it('FAILS on a reflog line that is not an entry — the commits that file names are unknown', () => {
    const c = makeChild(h);
    fs.appendFileSync(branchLog(c), 'not a reflog entry\n');
    const p = pinOf(c);
    expect(p.rc).toBe('1');
    expect(p.why).toContain(`the reflog ${branchLog(c)} holds a line that is not a reflog entry`);
  }, 60_000);

  it('FAILS on a HEAD reflog that is not a regular file — awk would skip a directory and read it as empty', () => {
    const c = makeChild(h);
    const headLog = h.git(c.wt, 'rev-parse', '--path-format=absolute', '--git-path', 'logs/HEAD');
    fs.rmSync(headLog); fs.mkdirSync(headLog);
    const p = pinOf(c);
    expect(p.rc).toBe('1');
    expect(p.why).toContain(`the reflog ${headLog} is not a regular file`);
  }, 60_000);

  it('FAILS — never reads "no reflog" — when the repository’s refs are not stored as files (`extensions.refStorage`)', () => {
    // git 2.43 cannot open a reftable repository at all, so the one read that
    // decides is stubbed: `git config --get extensions.refStorage` answers
    // `reftable`, every other git call is the real one.
    const c = makeChild(h);
    const pre = 'git() { if [[ " $* " == *" config --get extensions.refStorage "* ]]; then echo reftable; return 0; fi; command git "$@"; };';
    const p = pinOf(c, { pre });
    expect(p.rc).toBe('1');
    expect(p.why).toContain(`stores its refs as 'reftable', not as files`);
    expect(h.git(c.main, 'for-each-ref', `refs/ccrc/attic/${CHILD_ID}/reflogs`), 'nothing was kept as if there were no reflog').toBe('');
  }, 60_000);
});

describe('a hidden-flag edit is found by CONTENT, in every tree the pin commits (spec §5.5 step 2)', () => {
  /** `f`, committed, then flagged — a template the user edits locally and hides from git. */
  const flagged = (c: Child, f: string, flag: '--skip-worktree' | '--assume-unchanged', body = 'password: template\n'): void => {
    fs.writeFileSync(path.join(c.wt, f), body);
    h.git(c.wt, 'add', f); h.git(c.wt, 'commit', '-m', `add ${f}`);
    h.git(c.wt, 'update-index', flag, f);
  };

  it('a flagged path whose content equals the index blob but whose mtime changed is NOT an edit — no commit, nothing recorded', () => {
    const c = makeChild(h);
    flagged(c, 'db.yml', '--skip-worktree');
    flagged(c, 'au.yml', '--assume-unchanged');
    const later = new Date(Date.now() + 3_600_000);
    for (const f of ['db.yml', 'au.yml']) fs.utimesSync(path.join(c.wt, f), later, later);
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    expect(p.wip, 'an mtime is not an edit — the content is the index blob').toBe('');
    expect(p.secrets).toEqual([]);
  }, 60_000);

  it('a SPARSE-checkout path absent from disk is not an edit — no commit, nothing recorded', () => {
    const c = makeChild(h);
    for (const d of ['keep', 'drop']) { fs.mkdirSync(path.join(c.wt, d)); fs.writeFileSync(path.join(c.wt, d, 'x'), d); }
    h.git(c.wt, 'add', 'keep', 'drop'); h.git(c.wt, 'commit', '-m', 'two dirs');
    h.git(c.wt, 'sparse-checkout', 'set', 'keep');
    expect(h.git(c.wt, 'ls-files', '-v', 'drop/x'), 'the CONTROL: drop/x is skip-worktree').toBe('S drop/x');
    expect(fs.existsSync(path.join(c.wt, 'drop', 'x')), 'the CONTROL: drop/x is absent from disk').toBe(false);
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    expect(p.wip).toBe('');
    expect(p.secrets).toEqual([]);
  }, 60_000);

  it('a flagged SYMBOLIC LINK is compared as a link: unchanged is not an edit, re-pointed is kept', () => {
    const c = makeChild(h);
    fs.symlinkSync('f1.txt', path.join(c.wt, 'lnk'));
    h.git(c.wt, 'add', 'lnk'); h.git(c.wt, 'commit', '-m', 'link');
    h.git(c.wt, 'update-index', '--skip-worktree', 'lnk');
    const quiet = pinOf(c);
    expect(quiet.rc, quiet.why).toBe('0');
    expect(quiet.wip, 'an unchanged link is not an edit — its blob is its target, not the content it reaches').toBe('');
    fs.unlinkSync(path.join(c.wt, 'lnk')); fs.symlinkSync('f2.txt', path.join(c.wt, 'lnk'));
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    expect(h.git(c.main, 'ls-tree', p.wip, 'lnk'), 'kept as a link').toMatch(/^120000 /);
    expect(h.git(c.main, 'show', `${p.wip}:lnk`), 'the re-pointed link was dropped').toBe('f2.txt');
  }, 60_000);

  it.each([
    ['alone', false],
    ['beside another edit', true],
  ])('keeps a hidden edit whose stat record still matches the index — a plain `add` would stage nothing (%s)', (_what, other) => {
    // `core.trustctime false`, and an edit of the same size whose mtime is put
    // back: git's stat check says the entry is unchanged, so `add` of the
    // unflagged path exits 0 and stages nothing. The content read found it,
    // and it is staged as its raw bytes, whatever the stat record says.
    const c = makeChild(h);
    const f = path.join(c.wt, 'db.yml');
    const old = new Date('2020-01-01T00:00:00Z');
    fs.writeFileSync(f, 'password: template\n'); fs.utimesSync(f, old, old);
    h.git(c.wt, 'add', 'db.yml'); h.git(c.wt, 'commit', '-m', 'db');
    h.git(c.wt, 'update-index', '--skip-worktree', 'db.yml');
    h.git(c.wt, 'config', 'core.trustctime', 'false');
    fs.writeFileSync(f, 'password: zzzzzzzz\n'); fs.utimesSync(f, old, old);
    if (other) fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'edited\n');
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    expect(h.git(c.main, 'show', `${p.wip}:db.yml`), 'the edit was read as unchanged').toBe('password: zzzzzzzz');
  }, 60_000);

  it.each([
    ['alone', false],
    ['beside another edit', true],
  ])('FAILS — never reads it as kept — when the staging call exits 0 without staging a hidden edit (%s)', (_what, other) => {
    // The staging call answers 0 and stages nothing — what a bare `add` of a
    // flagged path does — on an edit whose stat record still matches, so the
    // ordinary `status`/`add` pass cannot pick it up either. Only the landing
    // check (`<wip>:<path>`, or HEAD's when nothing was committed, against the
    // content measured) sees it.
    const c = makeChild(h);
    const f = path.join(c.wt, 'db.yml');
    const old = new Date('2020-01-01T00:00:00Z');
    fs.writeFileSync(f, 'password: template\n'); fs.utimesSync(f, old, old);
    h.git(c.wt, 'add', 'db.yml'); h.git(c.wt, 'commit', '-m', 'db');
    h.git(c.wt, 'update-index', '--skip-worktree', 'db.yml');
    h.git(c.wt, 'config', 'core.trustctime', 'false');
    fs.writeFileSync(f, 'password: zzzzzzzz\n'); fs.utimesSync(f, old, old);
    if (other) fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'edited\n');
    const pre = 'git() { case " $* " in *" --index-info "*) cat >/dev/null; return 0 ;; esac; command git "$@"; };';
    const p = pinOf(c, { pre });
    expect(p.rc, 'a hidden edit git did not stage was treated as kept').toBe('1');
    expect(p.why).toContain('db.yml');
    expect(p.why).toContain('did not land');
    expect(atticShas(c), 'nothing was pinned').toEqual([]);
  }, 60_000);

  it.each([
    ['a tracked file', null],
    ['a hidden (assume-unchanged) file', '--assume-unchanged'],
  ] as const)('keeps a same-size edit made in the second the index was last written — %s: the scratch copy keeps the index’s timestamp', (_what, flag) => {
    // git reads such an entry as RACY and compares its content — but only
    // against the index's own timestamp. A copy stamped "now" makes it look
    // settled, and `status`/`add` in the copy would pass the edit over.
    // `core.trustctime false` so only the mtime and size decide, as on a box
    // whose ctime is not trusted; every timestamp is set, never raced. The
    // edit lands AFTER the ladder (the settle's window), so no read of the
    // ladder's can refresh the user's index in between.
    const c = makeChild(h);
    const f = path.join(c.wt, 'db.yml');
    const t = new Date(2020, 0, 1, 0, 0, 0);   // local time: `touch -t 202001010000` below
    h.git(c.wt, 'config', 'core.trustctime', 'false');
    fs.writeFileSync(f, 'password: template\n'); fs.utimesSync(f, t, t);
    h.git(c.wt, 'add', 'db.yml'); h.git(c.wt, 'commit', '-m', 'db');
    if (flag) h.git(c.wt, 'update-index', flag, 'db.yml');
    const idx = h.git(c.wt, 'rev-parse', '--path-format=absolute', '--git-path', 'index');
    const p = pinOf(c, { between: `printf 'password: zzzzzzzz\\n' > "${f}" && touch -t 202001010000 "${f}" "${idx}"` });
    expect(p.rc, p.why).toBe('0');
    expect(fs.readFileSync(f, 'utf8'), 'the CONTROL: the edit ran').toBe('password: zzzzzzzz\n');
    expect(p.wip, 'the edit was read as unchanged').toMatch(/^[0-9a-f]{40}$/);
    expect(h.git(c.main, 'show', `${p.wip}:db.yml`)).toBe('password: zzzzzzzz');
  }, 60_000);

  /** `.env` and `cfg.txt` committed with CRLF bytes BEFORE `* text=auto`, so the
   *  index holds CRLF blobs that `hash-object --path` would hash as LF; both flagged. */
  const crlfUnderTextAuto = (c: Child): void => {
    fs.writeFileSync(path.join(c.wt, 'cfg.txt'), 'a\r\nb\r\n');
    fs.writeFileSync(path.join(c.wt, '.env'), 'KEY=template\r\n');
    h.git(c.wt, 'add', 'cfg.txt', '.env'); h.git(c.wt, 'commit', '-m', 'crlf');
    fs.writeFileSync(path.join(c.wt, '.gitattributes'), '* text=auto\n');
    h.git(c.wt, 'add', '.gitattributes'); h.git(c.wt, 'commit', '-m', 'text=auto');
    h.git(c.wt, 'update-index', '--skip-worktree', 'cfg.txt');
    h.git(c.wt, 'update-index', '--assume-unchanged', '.env');
  };

  it('an UNTOUCHED flagged file whose CRLF bytes are its index blob (`text=auto`) is not an edit — no WIP, nothing recorded dropped', () => {
    const c = makeChild(h);
    crlfUnderTextAuto(c);
    expect(h.git(c.wt, 'hash-object', '--path=cfg.txt', '--', 'cfg.txt'), 'the CONTROL: the filtered hash differs from the blob')
      .not.toBe(h.git(c.wt, 'rev-parse', ':cfg.txt'));
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    expect(p.wip, 'an untouched file made a WIP commit').toBe('');
    expect(p.secrets, 'an untouched secret was recorded as dropped').toEqual([]);
  }, 60_000);

  it('a real edit of a CRLF file under `text=auto` is kept BYTE-EXACT — the WIP blob is the disk’s bytes', () => {
    const c = makeChild(h);
    crlfUnderTextAuto(c);
    fs.writeFileSync(path.join(c.wt, 'cfg.txt'), 'one\r\nTWO\r\n');
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    expect(p.wip).toMatch(/^[0-9a-f]{40}$/);
    const kept = execFileSync('git', ['-C', c.main, 'cat-file', 'blob', `${p.wip}:cfg.txt`]);
    expect(kept.equals(fs.readFileSync(path.join(c.wt, 'cfg.txt'))), `kept ${JSON.stringify(kept.toString())}, not the disk's bytes`).toBe(true);
  }, 60_000);

  it('FAILS when a checkout of ANOTHER repository gained a hidden-flag edit after the ladder — it cannot be pinned here', () => {
    const c = makeChild(h);
    const origin = path.join(h.home, 'origins', 'other.git');
    execFileSync('git', ['init', '--bare', '-q', '-b', 'main', origin]);
    const seedRepo = path.join(h.home, 'seed-other');
    execFileSync('git', ['init', '-q', '-b', 'main', seedRepo]);
    fs.writeFileSync(path.join(seedRepo, 'cfg.yml'), 'orig\n');
    h.git(seedRepo, 'add', 'cfg.yml'); h.git(seedRepo, 'commit', '-m', 'cfg');
    h.git(seedRepo, 'remote', 'add', 'origin', origin); h.git(seedRepo, 'push', '-q', 'origin', 'main');
    const clone = path.join(c.wt, 'vendor', 'other');
    execFileSync('git', ['clone', '-q', origin, clone]);
    h.git(clone, 'update-index', '--skip-worktree', 'cfg.yml');
    const p = pinOf(c, { between: `printf 'LOCAL-EDIT\\n' > "${clone}/cfg.yml"` });
    expect(p.rc, 'a foreign hidden edit went with the tree unkept').toBe('1');
    expect(p.why).toContain('hidden-flag');
    expect(atticShas(c), 'nothing was pinned').toEqual([]);
  }, 60_000);

  it('FAILS when a hidden edit cannot be READ — a read that fails is unmeasured, never "not an edit"', () => {
    const c = makeChild(h);
    flagged(c, 'db.yml', '--skip-worktree');
    fs.writeFileSync(path.join(c.wt, 'db.yml'), 'password: local\n');
    const p = pinOf(c, { between: `chmod 000 "${c.wt}/db.yml"` });
    expect(p.rc, 'an unreadable hidden path was passed over').toBe('1');
    expect(p.why).toContain('db.yml');
    expect(atticShas(c), 'nothing was pinned').toEqual([]);
  }, 60_000);

  it('a NESTED same-repository checkout’s hidden edit is kept in its WIP, and its hidden secret recorded with its prefix', () => {
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    for (const f of ['cfg.yml', '.env']) fs.writeFileSync(path.join(inner, f), 'template\n');
    h.git(inner, 'add', 'cfg.yml', '.env'); h.git(inner, 'commit', '-m', 'nested configs');
    h.git(inner, 'update-index', '--skip-worktree', 'cfg.yml');
    h.git(inner, 'update-index', '--assume-unchanged', '.env');
    for (const f of ['cfg.yml', '.env']) fs.writeFileSync(path.join(inner, f), 'local\n');
    const envBlob = h.git(inner, 'rev-parse', 'HEAD:.env');
    const flags = h.git(inner, 'ls-files', '-v');
    const indexes = [c.wt, inner].map((d) => h.git(d, 'rev-parse', '--path-format=absolute', '--git-path', 'index'));
    const before = indexes.map((f) => fs.readFileSync(f));
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    indexes.forEach((f, i) => expect(fs.readFileSync(f).equals(before[i]!), `the user’s index ${f} was written`).toBe(true));
    const refs = h.git(c.main, 'for-each-ref', '--format=%(refname)', `refs/ccrc/attic/${CHILD_ID}/`).split('\n').filter(Boolean);
    const shown = (ref: string, f: string): string => { try { return h.git(c.main, 'show', `${ref}:${f}`); } catch { return ''; } };
    const nestedWip = refs.find((r) => shown(r, 'cfg.yml') === 'local');
    expect(nestedWip, 'the nested hidden edit is in no attic WIP').toBeDefined();
    expect(h.git(c.main, 'rev-parse', `${nestedWip!}:.env`), 'the nested hidden secret was committed').toBe(envBlob);
    expect(p.secrets).toEqual(['inner/.env']);
    expect(h.git(inner, 'ls-files', '-v'), 'the nested checkout’s own index flags were changed').toBe(flags);
  }, 60_000);
});
