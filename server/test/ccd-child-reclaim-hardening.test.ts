// Child reclamation, below the frozen boundary (spec 2026-09-22 §5.5-§5.6):
// the tail's bounded pane kill, the hidden-edit read's fork-free ancestor walk
// and its memo, the gitdir walk's top-level sentence, and a `/proc` workdir —
// refused where it is written (`ccd start`) and unplaced where another row is
// read (rung 9). Then: a staged intermediate version kept by the WIP commit,
// a nested foreign clone's reflog-only commits, the keep's reading of G as git
// reads it, the containment's inherited git variables, a workdir holding a
// control character, the memo's scope, the absence walk's `dirname`, and the
// shapes rung 9's row placement answers for a `//` spelling and an
// unresolvable one — a `..` in the suffix below a missing directory included,
// at evaluation and at removal time. Last, the tombstone's `reflog` field,
// read from the child's own HEAD and branch reflogs only. Every case builds
// its child in a fixture HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { GH_STUB, makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD, ghContainedEnv, harnessBin } from './ccdWsHelpers.js';
import { asManagerCalls } from './platformFixtures.js';
import {
  CHILD_BRANCH, CHILD_ENV, CHILD_ID, CHILD_RUN, CHILD_STUBS, atticReach, childReclaimVerb, evalOf, gcNow, hasCommit,
  looseCommits, makeChild, plantTmux, tmuxSessions, type Child,
} from './childReclaimFixture.js';
import { verbHelpers } from './childReclaimVerbHelpers.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-hardening-'); });
afterEach(() => { h.cleanup(); });
const { interrupted, resumeToken, failedPairAgrees, treeOf } = verbHelpers(() => h);

/** A bash spawn that answers instead of throwing, with its OWN deadline — the
 *  harness's `sh` has none, and vitest cannot interrupt a synchronous spawn. */
const spawnCcd = (snippet: string, timeout: number): {
  code: number | null; stdout: string; stderr: string; ms: number; error: string;
} => {
  const t0 = Date.now();
  const r = spawnSync('bash', ['-c', `source "${CCD}"; ${snippet}`], {
    encoding: 'utf8', cwd: h.home, timeout,
    env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }),
  });
  const err = r.error as (Error & { code?: string }) | undefined;
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', ms: Date.now() - t0, error: err?.code ?? '' };
};

describe('the tail’s anchored kill is BOUNDED — a wedged tmux answers unit-still-active, never a hang (spec §5.6)', () => {
  // A tmux BINARY (the tail bounds only a binary: `timeout` execs its argv, and
  // a function stub cannot wedge) whose `kill-session` never returns and whose
  // `has-session` answers `no server running` once a kill was asked. It
  // REPLACES the harness's refusing tmux poison in this HOME's own bin — still
  // a stub, never a real tmux. Before the kill, `has-session` answers `can't
  // find session`, so the in-lock ladder's rung 5 sees no pane.
  const WEDGED_TMUX = [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$HOME/tmux-bin-calls"',
    'case "$1" in',
    '  kill-session) : > "$HOME/tmux-killed"; exec sleep 30 ;;',
    '  has-session)',
    '    if [ -e "$HOME/tmux-killed" ]; then echo "no server running on /tmp/tmux-fixture/default" >&2',
    '    else echo "can\'t find session: $3" >&2; fi',
    '    exit 1 ;;',
    'esac',
    'exit 97',
    '',
  ].join('\n');

  it('a kill that never returns times out (exit 124) and the tail stops before its first deletion — in seconds', () => {
    const c = makeChild(h);
    const tok = evalOf(h).token;
    expect(tok, 'the CONTROL: the ladder passes').toMatch(/^[0-9a-f]{64}$/);
    fs.writeFileSync(path.join(harnessBin(h.home), 'tmux'), WEDGED_TMUX, { mode: 0o755 });
    // CHILD_STUBS' tmux FUNCTION is unset, so every tmux call reaches the binary above.
    const r = spawnCcd(`SUBSTRATE_PROBE_DEADLINE_S=2; ${CHILD_STUBS} unset -f tmux; ${CHILD_ENV} `
      + `cmd_ws_reclaim --expect ${tok} --child-of ${CHILD_RUN} --session ${CHILD_ID}`, 20_000);
    expect(r.error, `the spawn was not killed at its own deadline (took ${r.ms}ms)`).toBe('');
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('unit-still-active');
    expect(o.detail, 'the timed-out kill is not the exit-empty exception').toContain('(exit 124)');
    expect(o.detail).toContain('no server running');
    const calls = fs.readFileSync(path.join(h.home, 'tmux-bin-calls'), 'utf8');
    expect(calls, 'the kill was asked, anchored').toContain(`kill-session -t =cc-${CHILD_ID}:`);
    expect(r.ms, 'bounded by the deadline and its grace, not by the wedge').toBeLessThan(15_000);
    // Nothing was deleted, and the breadcrumb stays for the retry.
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the worktree survives').toBe(true);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the branch survives').toContain(CHILD_BRANCH);
    expect(h.reg(CHILD_ID, 'uuid'), 'the registry row survives').not.toBeNull();
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays').toBe('reclaim:children');
  }, 90_000);
});

describe('the hidden-edit read’s ancestor walk takes no fork per path, and siblings under one missing directory share one walk (spec §5.5 step 2)', () => {
  // THE BOUND is about 5x the fork-free walk's own time, measured on the fleet
  // box under its ordinary load (median of five runs: 919ms; worst seen under
  // load 1181ms), so a loaded CI runner does not red this case on time alone —
  // and still a third of the walk that forked `dirname` once per path, which
  // took 15.4-16.0s on the same box and read. That regression still reds it.
  const HIDDEN_READ_BOUND_MS = 5000;
  const N = 5000;

  /** N skip-worktree entries under `gone/`, a directory that is not on disk —
   *  a sparse checkout's out-of-cone shape, planted straight into the index. */
  const outOfCone = (wt: string): void => {
    h.sh(`blob=$(printf 'x\\n' | git -C "${wt}" hash-object -w --stdin)`
      + ` && for ((i = 0; i < ${N}; i++)); do printf '100644 %s\\tgone/f%d\\n' "$blob" "$i"; done`
      + ` | git -C "${wt}" update-index --index-info`
      + ` && git -C "${wt}" ls-files -z -- gone | xargs -0 git -C "${wt}" update-index --skip-worktree`);
  };

  it(`${N} out-of-cone flagged paths under one missing directory: the read finishes within the bound, finds no edit, and memoises ONE directory`, () => {
    const { wt } = makeChild(h);
    outOfCone(wt);
    const flagged = h.git(wt, 'ls-files', '-v', '--', 'gone').split('\n').filter((l) => l.startsWith('S '));
    expect(flagged, 'the CONTROL: every entry is flagged skip-worktree').toHaveLength(N);
    expect(fs.existsSync(path.join(wt, 'gone')), 'the CONTROL: the directory is not on disk').toBe(false);
    const out = h.sh(`t0=$(_plat_epoch_ms); _ws_reclaim_hidden "${wt}"; rc=$?; t1=$(_plat_epoch_ms);`
      + ` printf '%s\\n%s\\n%s\\n' "$rc" "$(( t1 - t0 ))" "\${#_WS_HIDDEN_PATHS[@]}"; printf '%s\\n' "\${!_WS_HIDDEN_STAND[@]}"`);
    const [rc, ms, found, ...keys] = out.split('\n');
    expect(rc, 'the read answered').toBe('0');
    expect(found, 'an absent path is not an edit').toBe('0');
    expect(keys, 'the memo is keyed by the missing DIRECTORY, never by each leaf').toEqual([path.join(wt, 'gone')]);
    expect(Number(ms), `the hidden read took ${ms}ms`).toBeLessThan(HIDDEN_READ_BOUND_MS);
  }, 120_000);

  /** `_ws_reclaim_hidden_absent` asked directly, from `cwd`, with a fresh memo:
   *  its rc, its why, and the memo's keys afterwards. */
  const absentOf = (f: string, cwd = '"$HOME"'): { rc: string; why: string; keys: string[] } => {
    const out = h.sh(`builtin cd -- ${cwd} && _WS_HIDDEN_STAND=(); _ws_reclaim_hidden_absent '${f}'; rc=$?;`
      + ` printf '%s\\x1f%s\\x1f' "$rc" "$_WS_HIDDEN_WHY"; printf '%s\\n' "\${!_WS_HIDDEN_STAND[@]}"`);
    const [rc = '', why = '', keys = ''] = out.split('\x1f');
    return { rc, why, keys: keys.split('\n').filter(Boolean) };
  };

  it('dirname’s edges, fork-free: a path with no `/` has the cwd for its parent, one directly under the root has `/`', () => {
    fs.mkdirSync(path.join(h.home, 'here'));
    expect(absentOf('missing', '"$HOME/here"'), 'no `/`: the cwd stands, so a missing leaf is skip, memoising nothing')
      .toEqual({ rc: '0', why: '', keys: [] });
    expect(absentOf('/ccd-hardening-no-such-leaf'), 'under the root: `/` stands, memoising nothing')
      .toEqual({ rc: '0', why: '', keys: [] });
    // The root itself: its parent is the root, which stands — so the walk
    // looks at it, finds it standing, and refuses to guess.
    const root = absentOf('/');
    expect(root.rc).toBe('1');
    expect(root.why).toBe('whether the hidden path / holds an edit is unmeasured: / stands although it was proven absent a moment before — refusing to guess what changed');
    expect(root.keys).toEqual([]);
  }, 60_000);

  it('a nested chain of missing directories is memoised level by level, and a sibling deeper down is answered from it', () => {
    const base = path.join(h.home, 'tree');
    fs.mkdirSync(base);
    const out = h.sh(`_WS_HIDDEN_STAND=(); _ws_reclaim_hidden_absent '${base}/a/b/c/f1'; r1=$?;`
      + ` _ws_reclaim_hidden_absent '${base}/a/b/g2'; r2=$?; printf '%s %s\\n' "$r1" "$r2";`
      + ` for k in "\${!_WS_HIDDEN_STAND[@]}"; do printf '%s=%s\\n' "$k" "\${_WS_HIDDEN_STAND[$k]}"; done`);
    const [rcs, ...memo] = out.split('\n');
    expect(rcs).toBe('0 0');
    expect(memo.sort()).toEqual([`${base}/a/b/c=skip`, `${base}/a/b=skip`, `${base}/a=skip`].sort());
  }, 60_000);
});

describe('the gitdir walk’s top-level guard says what it measured (spec §5.5)', () => {
  it('a `refs` that is a regular FILE is "not a directory" — and so is a `logs` one', () => {
    const g = path.join(h.home, 'g');
    fs.mkdirSync(g);
    fs.writeFileSync(path.join(g, 'refs'), 'not a directory\n');
    const ask = (): string => h.sh(`_ws_reclaim_gitdir_ids '${g}' "$HOME/ids" >/dev/null; printf '%s\\x1f%s' "$?" "$_WS_KEEP_WHY"`);
    expect(ask()).toBe(`1\x1f${g}/refs is not a directory — the refs under it were never read`);
    fs.rmSync(path.join(g, 'refs'));
    fs.mkdirSync(path.join(g, 'refs'));
    fs.writeFileSync(path.join(g, 'logs'), 'not a directory\n');
    expect(ask()).toBe(`1\x1f${g}/logs is not a directory — the reflogs under it were never read`);
  }, 60_000);
});

describe('a workdir under `/proc` is refused where it is written and unplaced where another row is read (spec §5.5, rung 9)', () => {
  // `/proc/self/cwd/<rel>` is absolute in form, but it names each reader's
  // own cwd — exactly the hazard a relative spelling carries. Linux-only: a
  // box with no `/proc/self/cwd` has no such path to write.
  const hasProc = fs.existsSync('/proc/self/cwd');
  const START_STUBS = `_supervised_start() { echo "supervised_start $*" >> "$HOME/ccd-calls"; }; _alive() { return 1; };`;

  it('`ccd start` refuses a workdir under /proc, and writes nothing', (ctx) => {
    if (!hasProc) { ctx.skip(); return; }
    fs.mkdirSync(path.join(h.home, 'sub'));
    const r = spawnCcd(`${START_STUBS} cmd_start claude demo /proc/self/cwd/sub`, 30_000);
    expect(r.code, r.stdout).not.toBe(0);
    expect(r.stderr).toContain('workdir must not lie under /proc');
    for (const f of ['workdir', 'uuid', 'wrapper', 'project']) {
      expect(fs.existsSync(path.join(h.home, '.cc-sessions', `claude-demo.${f}`)), `no .${f} was written`).toBe(false);
    }
    expect(asManagerCalls(h.calls()), 'nothing was started').toEqual([]);
    const ok = spawnCcd(`${START_STUBS} cmd_start claude demo "$HOME/sub"`, 30_000);
    expect(ok.code, `the CONTROL: the same directory by its plain path starts — ${ok.stderr}`).toBe(0);
  }, 60_000);

  const otherRow = (id: string, workdir: string): void => {
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.uuid`), `u-${id}`);
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.workdir`), workdir);
  };
  const UNPROC = 'name a workdir under /proc, which names whatever the reading process\'s own cwd or descriptors are, so ccd cannot place them against this child';

  it('an OTHER row under /proc is unmeasured — never reclaimable — however many slashes open it', () => {
    makeChild(h);
    fs.mkdirSync(path.join(h.home, 'elsewhere'));
    expect(evalOf(h).verdict, 'the CONTROL: without the row').toBe('reclaimable');
    for (const spelled of ['/proc/self/cwd/elsewhere', '///proc/self/cwd/elsewhere', '/proc']) {
      otherRow('demo-proc', spelled);
      const r = evalOf(h);
      expect(r.verdict, `${spelled}: ${r.detail}`).toBe('unmeasured');
      expect(r.token).toBe('');
      expect(r.detail).toContain(`registry row(s) demo-proc ${UNPROC}`);
    }
  }, 60_000);

  it('it is decided AFTER the loop, as a relative row is: a row rooted inside the child in the same pass outranks it', () => {
    const { wt } = makeChild(h);
    fs.mkdirSync(path.join(wt, 'server'));
    otherRow('demo-proc', '/proc/self/cwd/elsewhere');
    otherRow('demo-nested', path.join(wt, 'server'));
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.detail).toContain('registry row(s) demo-nested rooted inside');
  }, 60_000);
});

/** A registry row of another session, naming `workdir`. */
const otherRowOf = (id: string, workdir: string): void => {
  fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.uuid`), `u-${id}`);
  fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.workdir`), workdir);
};
const dropRowOf = (id: string): void => {
  for (const f of ['uuid', 'workdir']) fs.rmSync(path.join(h.home, '.cc-sessions', `${id}.${f}`), { force: true });
};
const tombWip = (): string =>
  String((JSON.parse(fs.readFileSync(path.join(h.home, '.cc-sessions', '.reaped', `${CHILD_ID}.json`), 'utf8')) as { wip: unknown }).wip);
/** The pin phase alone, after the ladder, in one shell: its rc and the WIP it answered. */
const pinWip = (c: Child, defer: 0 | 1 = 0): { rc: string; wip: string; why: string } => {
  const out = h.sh(`${CHILD_STUBS} _ws_reclaim_eval ${CHILD_ID} ${defer} ${CHILD_RUN} >/dev/null`
    + ` && _ws_reclaim_pin ${CHILD_ID} "${c.wt}" "${c.main}" "$REAP_BRANCH" ${CHILD_RUN}; rc=$?;`
    + ` printf '%s\\x1f%s\\x1f%s' "$rc" "$RECLAIM_WIP" "$RECLAIM_PIN_WHY"`);
  const [rc = '', wip = '', why = ''] = out.split('\x1f');
  return { rc, wip, why };
};
const parentsOf = (c: Child, sha: string): string[] => h.git(c.main, 'log', '-1', '--format=%P', sha).split(' ').filter(Boolean);

describe('a STAGED intermediate version is kept — the WIP carries the index as its last parent, as `git stash` does (spec §5.5, pin phase step 2)', () => {
  it('stage A, edit to B, reclaim, gc: A survives through the attic, and B is the WIP’s tree', () => {
    const c = makeChild(h);
    const f = path.join(c.wt, 'f1.txt');
    fs.writeFileSync(f, 'version A — staged\n');
    h.git(c.wt, 'add', 'f1.txt');
    fs.writeFileSync(f, 'version B — on disk\n');
    const blobA = h.git(c.wt, 'rev-parse', ':f1.txt');
    expect(h.git(c.wt, 'cat-file', '-p', blobA), 'the CONTROL: the index holds A').toBe('version A — staged');
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(fs.existsSync(c.wt), 'the child was reclaimed').toBe(false);
    const wip = tombWip();
    expect(wip).toMatch(/^[0-9a-f]{40}$/);
    const dangling = h.git(c.main, 'commit-tree', `${c.tip}^{tree}`, '-m', 'referenced by nothing');
    gcNow(h, c.main);
    expect(hasCommit(h, c.main, dangling), 'the CONTROL: gc pruned a commit no ref reaches').toBe(false);
    expect(h.git(c.main, 'show', `${wip}:f1.txt`), 'B is the WIP’s tree').toBe('version B — on disk');
    const ps = parentsOf(c, wip);
    expect(ps, 'HEAD, then the index commit').toHaveLength(2);
    expect(ps[0]).toBe(c.tip);
    const idx = ps[1]!;
    expect(atticReach(h, c), 'the index commit is reached from refs/ccrc/attic/<id>/').toContain(idx);
    expect(h.git(c.main, 'show', `${idx}:f1.txt`), 'A survived gc').toBe('version A — staged');
    expect(h.git(c.main, 'log', '-1', '--format=%P|%an <%ae>|%s', idx))
      .toBe(`${c.tip}|ccrc reclaim <ccrc-reclaim@invalid>|ccrc: index pinned at reclaim of ${CHILD_ID} (run ${CHILD_RUN})`);
  }, 120_000);

  it('otherwise the WIP’s shape is unchanged: an unstaged edit, and a staged one with nothing after it, sit on HEAD alone', () => {
    const c = makeChild(h);
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'unstaged\n');
    const a = pinWip(c);
    expect(a.rc, a.why).toBe('0');
    expect(parentsOf(c, a.wip), 'index = HEAD').toEqual([c.tip]);
    h.git(c.wt, 'add', 'f1.txt');
    const b = pinWip(c);
    expect(b.rc, b.why).toBe('0');
    expect(parentsOf(c, b.wip), 'index = the WIP’s tree').toEqual([c.tip]);
    expect(b.wip, 'the same tree on the same parents: the same WIP').toBe(a.wip);
  }, 90_000);

  it('a staged version edited back to HEAD’s bytes is still kept — the WIP is written on HEAD’s tree to carry it', () => {
    const c = makeChild(h);
    const f = path.join(c.wt, 'f1.txt');
    const orig = fs.readFileSync(f, 'utf8');
    fs.writeFileSync(f, 'version A — staged, then undone on disk\n');
    h.git(c.wt, 'add', 'f1.txt');
    fs.writeFileSync(f, orig);
    const p = pinWip(c);
    expect(p.rc, p.why).toBe('0');
    expect(p.wip, 'a WIP was written').toMatch(/^[0-9a-f]{40}$/);
    expect(h.git(c.main, 'rev-parse', `${p.wip}^{tree}`), 'on HEAD’s own tree').toBe(h.git(c.main, 'rev-parse', `${c.tip}^{tree}`));
    const ps = parentsOf(c, p.wip);
    expect(ps).toHaveLength(2);
    expect(h.git(c.main, 'show', `${ps[1]}:f1.txt`)).toBe('version A — staged, then undone on disk');
  }, 90_000);

  it('is idempotent — a second pin of the same staged and disk versions answers the same WIP and index commit', () => {
    const c = makeChild(h);
    const f = path.join(c.wt, 'f1.txt');
    fs.writeFileSync(f, 'A\n'); h.git(c.wt, 'add', 'f1.txt'); fs.writeFileSync(f, 'B\n');
    const first = pinWip(c);
    expect(first.rc, first.why).toBe('0');
    const again = h.sh(`${CHILD_STUBS} sleep 1; _ws_reclaim_pin ${CHILD_ID} "${c.wt}" "${c.main}" ${CHILD_BRANCH} ${CHILD_RUN}`
      + ` && printf '%s' "$RECLAIM_WIP"`);
    expect(again, 'a second WIP, or a second index commit, for the same versions').toBe(first.wip);
    expect(h.git(c.main, 'for-each-ref', '--format=%(refname)', `refs/ccrc/attic/${CHILD_ID}/`).split('\n')
      .filter((r) => r.endsWith(first.wip)), 'one attic ref for it').toHaveLength(1);
  }, 90_000);

  it('a staged SECRET never reaches the index commit — it goes back to HEAD’s entry first, and is listed', () => {
    const c = makeChild(h);
    fs.writeFileSync(path.join(c.wt, '.env'), 'KEY=live');
    h.git(c.wt, 'add', '-f', '.env');
    const f = path.join(c.wt, 'f1.txt');
    fs.writeFileSync(f, 'A\n'); h.git(c.wt, 'add', 'f1.txt'); fs.writeFileSync(f, 'B\n');
    const p = pinWip(c);
    expect(p.rc, p.why).toBe('0');
    const ps = parentsOf(c, p.wip);
    expect(ps).toHaveLength(2);
    for (const sha of [p.wip, ps[1]!]) {
      expect(h.git(c.main, 'ls-tree', '-r', '--name-only', sha).split('\n'), `${sha} carries the secret`).not.toContain('.env');
    }
    expect(h.git(c.main, 'show', `${ps[1]}:f1.txt`)).toBe('A');
  }, 90_000);

  it('mid-merge: an unmerged path is HEAD’s entry in the index commit, the merge side stays a parent, and a resolved staged path is kept', () => {
    const c = makeChild(h);
    // `side` forks at `work 1`: it adds f2 (an add/add CONFLICT with the
    // branch's own f2) and f3 (merged cleanly, then staged at A, edited to B).
    h.git(c.wt, 'checkout', '-q', '-b', 'side', 'HEAD~1');
    fs.writeFileSync(path.join(c.wt, 'f2.txt'), 'side two\n');
    fs.writeFileSync(path.join(c.wt, 'f3.txt'), 'side three\n');
    h.git(c.wt, 'add', '.'); h.git(c.wt, 'commit', '-q', '-m', 'side');
    const side = h.git(c.wt, 'rev-parse', 'HEAD');
    h.git(c.wt, 'checkout', '-q', CHILD_BRANCH);
    h.run(`GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@x git -C "${c.wt}" merge -q --no-edit side`);
    expect(h.git(c.wt, 'ls-files', '-u').split('\n').map((l) => l.split('\t')[1]), 'the CONTROL: f2 is unmerged')
      .toEqual(['f2.txt', 'f2.txt']);
    const f3 = path.join(c.wt, 'f3.txt');
    fs.writeFileSync(f3, 'resolved A\n'); h.git(c.wt, 'add', 'f3.txt'); fs.writeFileSync(f3, 'resolved B\n');
    const p = pinWip(c, 1);
    expect(p.rc, p.why).toBe('0');
    const ps = parentsOf(c, p.wip);
    expect(ps, 'HEAD, MERGE_HEAD, then the index commit').toHaveLength(3);
    expect(ps.slice(0, 2)).toEqual([c.tip, side]);
    expect(h.git(c.main, 'show', `${ps[2]}:f3.txt`)).toBe('resolved A');
    expect(h.git(c.main, 'show', `${ps[2]}:f2.txt`), 'the unmerged path is HEAD’s').toBe('work 2');
    expect(h.git(c.main, 'show', `${p.wip}:f3.txt`)).toBe('resolved B');
    expect(h.git(c.main, 'show', `${p.wip}:f2.txt`), 'the WIP carries the working-tree version').toContain('side two');
  }, 90_000);
});

describe('rung 9 counts a nested foreign clone’s REFLOGS too — a commit only its reflog names refuses (spec §5.5)', () => {
  it('a clean, pushed clone holding a commit only its reflog names → containment-unproven, naming the count and the path', () => {
    const { wt } = makeChild(h);
    const origin = path.join(h.home, 'origins', 'other.git');
    h.git(h.home, 'init', '--bare', '-q', '-b', 'main', origin);
    const seed = path.join(h.home, 'seed-other');
    h.git(h.home, 'init', '-q', '-b', 'main', seed);
    fs.writeFileSync(path.join(seed, 'r'), 'r');
    h.git(seed, 'add', 'r'); h.git(seed, 'commit', '-q', '-m', 'r');
    h.git(seed, 'remote', 'add', 'origin', origin); h.git(seed, 'push', '-q', 'origin', 'main');
    const clone = path.join(wt, 'vendor', 'other');
    h.git(h.home, 'clone', '-q', origin, clone);
    expect(evalOf(h).verdict, 'the CONTROL: clean and pushed').toBe('reclaimable');
    fs.writeFileSync(path.join(clone, 'x'), 'x');
    h.git(clone, 'add', 'x'); h.git(clone, 'commit', '-q', '-m', 'local only, then reset away');
    h.git(clone, 'reset', '-q', '--hard', 'HEAD~1');
    expect(h.git(clone, 'rev-list', '--count', '--all', '--not', '--remotes'), 'the CONTROL: no ref names it').toBe('0');
    expect(h.git(clone, 'status', '--porcelain', '--untracked-files=all'), 'the CONTROL: clean').toBe('');
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.token).toBe('');
    expect(r.detail).toBe(`1 commit(s) in the checkout of another repository at ${clone}, counting those only its reflogs name, are on none of its remotes`);
  }, 60_000);
});

describe('rung 9’s count never reads an unreadable reflog as zero (spec §5.5)', () => {
  /** A clean, pushed clone at `<wt>/vendor/other` whose git directory lies OUTSIDE the child
   *  (`--separate-git-dir`), so rung 8's permission pass never reaches it; then one commit made
   *  and reset away, so only its reflogs name it. */
  const externalClone = (wt: string): { clone: string; ext: string; lost: string } => {
    const origin = path.join(h.home, 'origins', 'other.git');
    h.git(h.home, 'init', '--bare', '-q', '-b', 'main', origin);
    const seed = path.join(h.home, 'seed-other');
    h.git(h.home, 'init', '-q', '-b', 'main', seed);
    fs.writeFileSync(path.join(seed, 'r'), 'r');
    h.git(seed, 'add', 'r'); h.git(seed, 'commit', '-q', '-m', 'r');
    h.git(seed, 'remote', 'add', 'origin', origin); h.git(seed, 'push', '-q', 'origin', 'main');
    const clone = path.join(wt, 'vendor', 'other');
    const ext = path.join(h.home, 'ext.git');
    h.git(h.home, 'clone', '-q', `--separate-git-dir=${ext}`, origin, clone);
    fs.writeFileSync(path.join(clone, 'x'), 'x');
    h.git(clone, 'add', 'x'); h.git(clone, 'commit', '-q', '-m', 'local only, then reset away');
    const lost = h.git(clone, 'rev-parse', 'HEAD');
    h.git(clone, 'reset', '-q', '--hard', 'HEAD~1');
    return { clone, ext, lost };
  };

  it('unreadable reflog FILES — which git reads as empty, silently — are unmeasured, never a pass', () => {
    const { wt } = makeChild(h);
    const { ext } = externalClone(wt);
    expect(evalOf(h).verdict, 'the CONTROL: readable, the reflog-only commit refuses').toBe('containment-unproven');
    const logs = [path.join(ext, 'logs', 'HEAD'), path.join(ext, 'logs', 'refs', 'heads', 'main')];
    for (const f of logs) fs.chmodSync(f, 0o000);
    try {
      const r = evalOf(h);
      expect(r.verdict, r.detail).toBe('unmeasured');
      expect(r.token).toBe('');
      expect(logs.some((f) => r.detail.includes(`${f} cannot be read — the commits the reflogs of the checkout at`)), r.detail).toBe(true);
    } finally { for (const f of logs) fs.chmodSync(f, 0o644); }
  }, 60_000);

  it('an unreadable reflog DIRECTORY is unmeasured', () => {
    const { wt } = makeChild(h);
    const { ext } = externalClone(wt);
    const heads = path.join(ext, 'logs', 'refs', 'heads');
    fs.chmodSync(path.join(ext, 'logs', 'HEAD'), 0o000);
    fs.chmodSync(heads, 0o000);
    try {
      const r = evalOf(h);
      expect(r.verdict, r.detail).toBe('unmeasured');
      // ccd's own sentence is platform-neutral; find's own stderr after it is not — GNU find
      // quotes the path (`find: '<path>': Permission denied`), BSD find does not (`find: <path>:
      // Permission denied`). Assert the ccd-owned prefix and that find's stderr names the path,
      // without pinning either tool's quoting.
      expect(r.detail).toContain(`${path.join(ext, 'logs')} cannot be listed (find answered 1: `);
      expect(r.detail).toContain(heads);
    } finally { fs.chmodSync(heads, 0o755); fs.chmodSync(path.join(ext, 'logs', 'HEAD'), 0o644); }
  }, 60_000);

  /** A clean, pushed clone at `<wt>/vendor/other` with its git directory INSIDE it, whose `.git/logs`
   *  is moved to `$HOME/extlogs` and LINKED back, after a commit made and reset away. */
  const linkedLogsClone = (wt: string): { clone: string; ext: string } => {
    const origin = path.join(h.home, 'origins', 'other.git');
    h.git(h.home, 'init', '--bare', '-q', '-b', 'main', origin);
    const seed = path.join(h.home, 'seed-other');
    h.git(h.home, 'init', '-q', '-b', 'main', seed);
    fs.writeFileSync(path.join(seed, 'r'), 'r');
    h.git(seed, 'add', 'r'); h.git(seed, 'commit', '-q', '-m', 'r');
    h.git(seed, 'remote', 'add', 'origin', origin); h.git(seed, 'push', '-q', 'origin', 'main');
    const clone = path.join(wt, 'vendor', 'other');
    h.git(h.home, 'clone', '-q', origin, clone);
    fs.writeFileSync(path.join(clone, 'x'), 'x');
    h.git(clone, 'add', 'x'); h.git(clone, 'commit', '-q', '-m', 'local only, then reset away');
    h.git(clone, 'reset', '-q', '--hard', 'HEAD~1');
    const ext = path.join(h.home, 'extlogs');
    fs.renameSync(path.join(clone, '.git', 'logs'), ext);
    fs.symlinkSync(ext, path.join(clone, '.git', 'logs'));
    return { clone, ext };
  };

  it('a LINKED `logs`, readable — git’s count does not follow it and reads 0 — is unmeasured', () => {
    const { wt } = makeChild(h);
    const { clone } = linkedLogsClone(wt);
    expect(h.git(clone, 'rev-list', '--count', '--all', '--reflog', '--not', '--remotes'), 'the CONTROL: git counts none').toBe('0');
    expect(h.git(clone, 'reflog', 'show', '--format=%s', 'HEAD'), 'the CONTROL: the reflog still names it').toContain('local only');
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
    expect(r.detail).toContain(`${path.join(clone, '.git', 'logs')} is a symbolic link, which git's reflog count does not follow`);
  }, 60_000);

  it('a LINKED `logs` whose reflog files are mode 000 is unmeasured too; and a link BELOW `logs` is refused', () => {
    const { wt } = makeChild(h);
    const { clone, ext } = linkedLogsClone(wt);
    const files = [path.join(ext, 'HEAD'), path.join(ext, 'refs', 'heads', 'main')];
    for (const f of files) fs.chmodSync(f, 0o000);
    try {
      const r = evalOf(h);
      expect(r.verdict, r.detail).toBe('unmeasured');
      expect(r.detail).toContain('is a symbolic link');
    } finally { for (const f of files) fs.chmodSync(f, 0o644); }
    // Put `logs` back, and link one directory below it instead.
    fs.rmSync(path.join(clone, '.git', 'logs'));
    fs.renameSync(ext, path.join(clone, '.git', 'logs'));
    const refs = path.join(clone, '.git', 'logs', 'refs');
    fs.renameSync(refs, path.join(h.home, 'extrefs'));
    fs.symlinkSync(path.join(h.home, 'extrefs'), refs);
    const b = evalOf(h);
    expect(b.verdict, b.detail).toBe('unmeasured');
    expect(b.detail).toContain(`${refs} is a symbolic link — ccd never follows one`);
  }, 60_000);

  it('any word on git’s stderr but the pruned-commit warning is unmeasured', () => {
    const { wt } = makeChild(h);
    const { clone, ext } = externalClone(wt);
    fs.rmSync(path.join(ext, 'logs'), { recursive: true });
    expect(evalOf(h).verdict, 'the CONTROL: no reflog names it — clean and pushed').toBe('reclaimable');
    const pre = `git() { if [[ "$*" == *"${clone} rev-list "* ]]; then command git "$@"; echo 'warning: something went unread' >&2; return 0; fi; command git "$@"; };`;
    const r = evalOf(h, { pre });
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.detail).toContain('warning: something went unread');
  }, 60_000);

  it('the CONTROL: a reflog entry whose object git already pruned — git warns, and that warning alone passes', () => {
    const { wt } = makeChild(h);
    const { ext, lost } = externalClone(wt);
    fs.rmSync(path.join(ext, 'objects', lost.slice(0, 2), lost.slice(2)));
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('reclaimable');
  }, 60_000);
});

describe('the keep reads G as git reads it (spec §5.5)', () => {
  const gitDirOf = (dir: string): string => h.git(dir, 'rev-parse', '--absolute-git-dir');

  it('a name git’s ref format forbids under G/refs/ or G/logs/ is no ref — `.DS_Store`, a dot-led directory, a space — and the reclaim goes through', () => {
    const c = makeChild(h);
    const g = gitDirOf(c.wt);
    const junk = 'not a ref, not an id\n';
    for (const rel of ['refs/.DS_Store', 'refs/worktree/.DS_Store', 'refs/worktree/has space', 'refs/.hidden/keep',
      'logs/.DS_Store', 'logs/refs/.DS_Store', 'logs/refs/worktree/.x/y']) {
      fs.mkdirSync(path.dirname(path.join(g, rel)), { recursive: true });
      fs.writeFileSync(path.join(g, rel), junk);
    }
    for (const n of ['refs/.DS_Store', 'refs/worktree/has space', 'logs/.DS_Store']) {
      expect(h.run(`git check-ref-format --allow-onelevel '${n.replace(/^logs\//, '')}'`).code, `the CONTROL: git forbids ${n}`).toBe(1);
    }
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(fs.existsSync(c.wt), 'the child was reclaimed').toBe(false);
  }, 120_000);

  it('a directory is judged by a name UNDER it: `refs/worktree/foo./keep` is a ref git reads, and its commit is kept through gc', () => {
    // `foo.` alone is a name git forbids (it ends in `.`), but a ref beneath
    // it is not (measured: `check-ref-format refs/worktree/foo./keep` → 0), so
    // judging the directory by its own name would skip a ref git keeps.
    const c = makeChild(h);
    const [x] = looseCommits(h, c.main, 1, 'under a dot-ended directory');
    h.git(c.wt, 'update-ref', 'refs/worktree/foo./keep', x!);
    expect(h.run(`git check-ref-format --allow-onelevel 'refs/worktree/foo.'`).code, 'the CONTROL: the directory’s own name is forbidden').toBe(1);
    expect(h.git(c.main, 'for-each-ref', '--contains', x!), 'the CONTROL: no shared ref reaches it').toBe('');
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(atticReach(h, c), 'the commit is kept by the attic').toContain(x);
    gcNow(h, c.main);
    expect(hasCommit(h, c.main, x!), 'it survived git gc --prune=now').toBe(true);
  }, 120_000);

  it('a name git could not JUDGE fails the keep — `check-ref-format` answering neither 0 nor 1 is never a skip', () => {
    const c = makeChild(h);
    const [x] = looseCommits(h, c.main, 1, 'judged by a failing git');
    h.git(c.wt, 'update-ref', 'refs/worktree/keep', x!);
    const tok = evalOf(h).token;
    const pre = 'git() { if [[ "$1" == check-ref-format ]]; then return 128; fi; command git "$@"; };';
    const r = childReclaimVerb(h, tok, { pre });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('pin-failed');
    expect(o.detail).toContain('could not be told (git check-ref-format answered 128)');
    expect(fs.existsSync(c.wt), 'the tree stands').toBe(true);
    expect(fs.readFileSync(path.join(gitDirOf(c.wt), 'refs', 'worktree', 'keep'), 'utf8').trim(), 'the ref stands').toBe(x);
  }, 120_000);

  it('a reflog whose name opens with `-` is judged, not read as an option — `G/logs/-foo` is kept through gc', () => {
    const c = makeChild(h);
    const [x] = looseCommits(h, c.main, 1, 'a dash-led reflog');
    const tip = h.git(c.wt, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(gitDirOf(c.wt), 'logs', '-foo'), `${tip} ${x} T <t@x> 1700000000 +0000\tfixture\n`);
    expect(h.run(`git check-ref-format --allow-onelevel -foo`).code, 'the CONTROL: git reads it as an option').toBe(129);
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(atticReach(h, c)).toContain(x);
    gcNow(h, c.main);
    expect(hasCommit(h, c.main, x!)).toBe(true);
  }, 120_000);

  it('a VALID name under G/refs/ still fails when it is not a ref — the skip is the format’s, never the content’s', () => {
    const c = makeChild(h);
    const g = gitDirOf(c.wt);
    fs.mkdirSync(path.join(g, 'refs', 'worktree'), { recursive: true });
    fs.writeFileSync(path.join(g, 'refs', 'worktree', 'DS_Store'), 'not a ref, not an id\n');
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('pin-failed');
    expect(o.detail).toContain(`${path.join(g, 'refs', 'worktree', 'DS_Store')} names neither a ref nor an object id`);
    expect(fs.existsSync(c.wt), 'the tree stands').toBe(true);
  }, 120_000);

  it('G/logs/HEAD that is a symbolic link is never followed — pin-failed, and nothing is removed', () => {
    const c = makeChild(h);
    const g = gitDirOf(c.wt);
    const head = path.join(g, 'logs', 'HEAD');
    const copy = path.join(h.home, 'head-reflog-copy');
    fs.copyFileSync(head, copy);
    fs.rmSync(head);
    fs.symlinkSync(copy, head);
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('pin-failed');
    expect(o.detail).toContain(`the reflog ${head} is a symbolic link — ccd never follows one, so it was never read`);
    expect(fs.existsSync(c.wt), 'the tree stands').toBe(true);
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'the branch stands').toBe(c.tip);
  }, 120_000);

  it('on the VANISHED arm too: git’s record keeps a G whose logs/HEAD is a link — pin-failed, and the record stands', () => {
    const c = makeChild(h);
    const g = gitDirOf(c.wt);
    const head = path.join(g, 'logs', 'HEAD');
    const copy = path.join(h.home, 'head-reflog-copy');
    fs.copyFileSync(head, copy);
    fs.rmSync(head);
    fs.symlinkSync(copy, head);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('pin-failed');
    expect(o.detail).toContain(`the reflog ${head} is a symbolic link — ccd never follows one, so it was never read`);
    expect(fs.existsSync(g), 'git’s record of the tree stands').toBe(true);
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'the branch stands').toBe(c.tip);
  }, 120_000);

  it('the standing arm proves G through `_ws_reclaim_gitdir_own`, and reads no `gitdir` file itself', () => {
    const src = fs.readFileSync(CCD, 'utf8');
    const body = src.slice(src.indexOf('_ws_reclaim_log_of() {'), src.indexOf('_ws_reclaim_reflog_ids() {'));
    const standing = body.slice(body.indexOf('if [[ -d "$arg" && ! -L "$arg" ]]; then'), body.indexOf('_ws_reclaim_absent "$arg"; rc=$?'));
    const code = standing.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(code).toMatch(/_ws_reclaim_gitdir_own "\$arg" "\$common"/);
    expect(code, 'an inline copy of the record check').not.toMatch(/gitdir"|\/gitdir\b/);
  });
});

describe('containment drops an inherited GIT_DIR, GIT_WORK_TREE and GIT_INDEX_FILE (spec §5.5)', () => {
  const SHOW = 'bash -c \'printf "%s|%s|%s" "${GIT_DIR-unset}" "${GIT_WORK_TREE-unset}" "${GIT_INDEX_FILE-unset}"\'';
  /** Every other variable that selects a repository, its objects, refs or history: `git rev-parse
   *  --local-env-vars` on git 2.43 less the GIT_CONFIG_* entries, plus GIT_NAMESPACE. */
  const OTHERS = ['GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE',
    'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX', 'GIT_SHALLOW_FILE'];

  it('the outermost containment unsets all three for everything beneath it; a nested one keeps ccd’s own', () => {
    const out = h.sh('export GIT_DIR=/elsewhere/.git GIT_WORK_TREE=/elsewhere GIT_INDEX_FILE=/elsewhere/index;'
      + ` _ws_reclaim_contained ${SHOW}; echo;`
      + ` inner() { GIT_INDEX_FILE="$HOME/scratch-index" _ws_reclaim_contained ${SHOW}; };`
      + ' _ws_reclaim_contained inner; echo;'
      + ` shadow() { local GIT_DIR=/caller-local; _ws_reclaim_contained ${SHOW}; };`
      + ' export GIT_DIR=/elsewhere/.git; shadow');
    expect(out.split('\n')).toEqual(['unset|unset|unset', `unset|unset|${h.home}/scratch-index`, 'unset|unset|unset']);
    // The nesting mark is never taken from the environment: ccd clears it at load.
    expect(h.sh(`export GIT_DIR=/elsewhere/.git; _ws_reclaim_contained ${SHOW}`, { _WS_RECLAIM_CONTAINED: '1' }))
      .toBe('unset|unset|unset');
  });

  it('and every other variable that selects a repository, its objects, refs or history', () => {
    const env = Object.fromEntries(OTHERS.map((v) => [v, `/elsewhere/${v}`]));
    const shown = OTHERS.map((v) => `"\${${v}-unset}"`).join(' ');
    const out = h.sh(`_ws_reclaim_contained bash -c 'printf "%s\\n" ${shown}'`, env);
    expect(out.split('\n')).toEqual(OTHERS.map(() => 'unset'));
    expect(h.sh(`printf '%s' "$GIT_OBJECT_DIRECTORY"`, env), 'the CONTROL: they were exported').toBe('/elsewhere/GIT_OBJECT_DIRECTORY');
  });

  it('replacement is switched OFF for every read — GIT_NO_REPLACE_OBJECTS=1 whatever was inherited, and a replace ref substitutes no history', () => {
    const show = `bash -c 'printf "%s" "\${GIT_NO_REPLACE_OBJECTS-unset}"'`;
    expect(h.sh(`_ws_reclaim_contained ${show}`)).toBe('1');
    expect(h.sh(`_ws_reclaim_contained ${show}`, { GIT_NO_REPLACE_OBJECTS: '' })).toBe('1');
    const c = makeChild(h);
    // A replace ref grafting the child's tip onto nothing: with replacement honoured, its history is 1 commit.
    const orphan = h.git(c.main, 'commit-tree', `${c.tip}^{tree}`, '-m', 'a replacement with no parents');
    h.git(c.main, 'replace', c.tip, orphan);
    const count = (s: string): string => h.sh(`${s} git -C "${c.main}" rev-list --count ${c.tip}`);
    expect(count(''), 'the CONTROL: the replace ref shortens history').toBe('1');
    expect(Number(count('_ws_reclaim_contained')), 'contained, the real history').toBeGreaterThan(1);
  }, 60_000);

  it('`ws-audit --reclaim` run with another repository’s GIT_DIR, GIT_WORK_TREE and GIT_INDEX_FILE exported answers as without them', () => {
    const c = makeChild(h);
    const other = h.makeRepo('other');
    const control = evalOf(h);
    expect(control.verdict, 'the CONTROL').toBe('reclaimable');
    const env = `export GIT_DIR="${path.join(other, '.git')}" GIT_WORK_TREE="${other}" GIT_INDEX_FILE="${path.join(other, '.git', 'index')}";`;
    const a = JSON.parse(h.sh(`${CHILD_STUBS} _session_verdict() { echo gone; }; ${GH_STUB} ${env}`
      + ` _ws_reclaim_audit_contained --session ${CHILD_ID} --reclaim`)) as Record<string, unknown>;
    expect(a['verdict'], String(a['detail'])).toBe('reclaimable');
    expect(a['token']).toBe(control.token);
    expect(fs.existsSync(c.wt)).toBe(true);
  }, 60_000);
});

describe('a workdir holding a newline or other control character is refused where it is written (spec §5.5, rung 9)', () => {
  const START_STUBS = `_supervised_start() { echo "supervised_start $*" >> "$HOME/ccd-calls"; }; _alive() { return 1; };`;

  it.each([['a newline', '\n', `$'\\n'`], ['a tab', '\t', `$'\\t'`], ['an escape', '\x1b', `$'\\e'`]])(
    '`ccd start` refuses a workdir holding %s, and writes nothing', (_what, ch, bashCh) => {
      fs.mkdirSync(path.join(h.home, `a${ch}b`));
      const r = spawnCcd(`${START_STUBS} cmd_start claude demo "$HOME/a"${bashCh}"b"`, 30_000);
      expect(r.code, r.stdout).not.toBe(0);
      expect(r.stderr).toContain('workdir must not contain a newline or any other control character — nothing was written');
      for (const f of ['workdir', 'uuid', 'wrapper', 'project']) {
        expect(fs.existsSync(path.join(h.home, '.cc-sessions', `claude-demo.${f}`)), `no .${f} was written`).toBe(false);
      }
      expect(asManagerCalls(h.calls()), 'nothing was started').toEqual([]);
      fs.mkdirSync(path.join(h.home, 'ab'));
      const ok = spawnCcd(`${START_STUBS} cmd_start claude demo "$HOME/ab"`, 30_000);
      expect(ok.code, `the CONTROL: a plain directory starts — ${ok.stderr}`).toBe(0);
    }, 60_000);
  it('a value holding a newline is refused BEFORE any refusal that prints the value — a missing one included', () => {
    const r = spawnCcd(`${START_STUBS} cmd_start claude demo "$HOME/no"$'\\n'"such"`, 30_000);
    expect(r.code, r.stdout).not.toBe(0);
    expect(r.stderr).toContain('workdir must not contain a newline or any other control character — nothing was written');
    expect(r.stderr, 'the value was echoed').not.toContain('such');
  }, 60_000);

  it('a RELATIVE workdir taken from a cwd holding a newline is refused on its resolved spelling', () => {
    fs.mkdirSync(path.join(h.home, 'a\nb', 'sub'), { recursive: true });
    const r = spawnCcd(`${START_STUBS} builtin cd -- "$HOME/a"$'\\n'"b" && cmd_start claude demo sub`, 30_000);
    expect(r.code, r.stdout).not.toBe(0);
    expect(r.stderr).toContain('workdir must not contain a newline or any other control character — nothing was written');
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', 'claude-demo.workdir')), 'no .workdir was written').toBe(false);
  }, 60_000);
});

describe('the hidden read’s memo is a GLOBAL table — ccd sourced inside a function, many paths, two missing directories (spec §5.5 step 2)', () => {
  it('the memo survives the sourcing function’s return, answers every sibling, and holds one key per missing directory', () => {
    const { wt } = makeChild(h);
    h.sh(`blob=$(printf 'x\\n' | git -C "${wt}" hash-object -w --stdin)`
      + ` && for d in gone1 gone2; do for i in 1 2 3; do printf '100644 %s\\t%s/f%d\\n' "$blob" "$d" "$i"; done; done`
      + ` | git -C "${wt}" update-index --index-info`
      + ` && git -C "${wt}" ls-files -z -- gone1 gone2 | xargs -0 git -C "${wt}" update-index --skip-worktree`);
    fs.writeFileSync(path.join(wt, 'f1.txt'), 'a hidden edit\n');
    h.git(wt, 'update-index', '--skip-worktree', 'f1.txt');
    const r = spawnSync('bash', ['-c', `load() { source "${CCD}"; }; load;`
      + ` _ws_reclaim_hidden "${wt}"; rc=$?; printf '%s\\n' "$rc" "\${_WS_HIDDEN_PATHS[*]}";`
      + ` declare -p _WS_HIDDEN_STAND | cut -c1-10; printf '%s\\n' "\${!_WS_HIDDEN_STAND[@]}" | sort`], {
      encoding: 'utf8', cwd: h.home, timeout: 60_000,
      env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }),
    });
    expect(r.stdout.trim().split('\n'), r.stderr).toEqual(['0', 'f1.txt', 'declare -A', path.join(wt, 'gone1'), path.join(wt, 'gone2')]);
    expect(r.stderr).toBe('');
  }, 60_000);
});

describe('the absence walk reads `dirname` whole — a parent whose name ends in a newline is that parent (spec §5.5)', () => {
  it('`<d>\\n/leaf` under a DANGLING `<d>\\n`, beside a real `<d>`: unmeasured, never proven absent', () => {
    const base = path.join(h.home, 'walk');
    fs.mkdirSync(path.join(base, 'd'), { recursive: true });
    fs.symlinkSync(path.join(base, 'nowhere'), path.join(base, 'd\n'));
    const out = h.sh(`_ws_reclaim_absent "${base}/d"$'\\n'"/leaf"; printf '%s\\x1f%s' "$?" "$_WS_ABSENT_WHY"`);
    const [rc, why] = out.split('\x1f');
    expect(rc, why).toBe('2');
    expect(why).toBe(`${base}/d\n cannot be searched, so whether ${base}/d\n/leaf exists was never asked`);
    // The CONTROL: the plain sibling's leaf is proven absent.
    expect(h.sh(`_ws_reclaim_absent "${base}/d/leaf"; printf '%s' "$?"`)).toBe('0');
  }, 60_000);
});

describe('rung 9’s row placement: the two `//` shapes stated, and a row that cannot be resolved (spec §5.5)', () => {
  it('an ORDINARY child: a row literally inside it that resolves to a `//` spelling is containment-unproven, never unplaced', () => {
    const { wt } = makeChild(h);
    fs.mkdirSync(path.join(h.home, 'elsewhere', 'server'), { recursive: true });
    fs.symlinkSync(`/${path.join(h.home, 'elsewhere')}`, path.join(wt, 'dsl'));
    const row = path.join(wt, 'dsl', 'server');
    const resolved = h.sh(`_ws_realpath "${row}"`);
    if (process.platform !== 'darwin') expect(resolved, 'bash keeps the link target’s leading `//`').toBe(`/${path.join(h.home, 'elsewhere', 'server')}`);
    otherRowOf('demo-dsl', row);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.detail).toContain('registry row(s) demo-dsl rooted inside');
    expect(r.token).toBe('');
  }, 60_000);

  it('a CHILD resolving to `//` never reclaims while ANY other row exists — one outside it, one above it', () => {
    const { wt } = makeChild(h);
    fs.renameSync(path.join(h.home, 'worktrees'), path.join(h.home, 'wtreal'));
    fs.symlinkSync(`/${path.join(h.home, 'wtreal')}`, path.join(h.home, 'worktrees'));
    const mine = h.sh(`_ws_realpath "${wt}"`);
    if (process.platform !== 'darwin') expect(mine, 'the child resolves to a `//` spelling').toBe(`/${path.join(h.home, 'wtreal', 'demo', 'quiet-basin')}`);
    expect(evalOf(h).verdict, 'the CONTROL: with no other row it reclaims').toBe('reclaimable');
    fs.mkdirSync(path.join(h.home, 'elsewhere'));
    // Both rows plain, and both resolve plain: `demo-above` by the REAL path of
    // the child's parent, so neither is unplaced — only the child's own `//`
    // spelling stops them being placed.
    for (const [id, spelled] of [['demo-outside', path.join(h.home, 'elsewhere')], ['demo-above', path.join(h.home, 'wtreal', 'demo')]] as const) {
      otherRowOf(id, spelled);
      const r = evalOf(h);
      if (mine.startsWith('//')) {
        expect(r.verdict, `${id}: ${r.detail}`).toBe('unmeasured');
        expect(r.detail).toContain(`registry row(s) ${id} cannot be placed against this child: ${CHILD_ID}'s own workdir resolves to a path opening with //`);
      } else {
        expect(r.verdict, `${id}: ${r.detail}`).toBe('reclaimable');
      }
      expect(r.token === '', `${id}: a token`).toBe(mine.startsWith('//'));
      dropRowOf(id);
    }
  }, 60_000);

  // The sentence names every cause `_ws_reclaim_resolvable` answers 1 for, one clause each, and one remedy true of all.
  const DOTDOT_CLAUSE = 'a \'..\' in it follows a directory that no longer exists, or cannot otherwise be placed';
  const CNTRL_CLAUSE = 'or it holds a control character';
  const UNRESOLVED = 'name a workdir that cannot be resolved (a directory or link on its path cannot be entered or followed;'
    + ` ${DOTDOT_CLAUSE}; ${CNTRL_CLAUSE}), so ccd cannot place them against this child`;
  const UNRESOLVED_REMEDY = 'make it searchable, or stop and purge the row';

  it('an absolute OTHER row that cannot be resolved — a link to the child, into a directory that cannot be entered — is unplaced, and `<child>/server` stands', () => {
    const { wt } = makeChild(h);
    const server = path.join(wt, 'server');
    fs.mkdirSync(server);
    fs.writeFileSync(path.join(server, 'live.txt'), 'another session’s uncommitted work\n');
    fs.symlinkSync(wt, path.join(h.home, 'lnk'));
    const row = path.join(h.home, 'lnk', 'server');
    otherRowOf('demo-lnk', row);
    expect(evalOf(h).verdict, 'the CONTROL: resolvable, it places inside the child').toBe('containment-unproven');
    fs.chmodSync(server, 0o600);
    try {
      expect(h.sh(`_ws_realpath "${row}"`), 'the CONTROL: `_ws_realpath` hands the path back unresolved').toBe(row);
      const r = evalOf(h);
      expect(r.verdict, r.detail).toBe('unmeasured');
      expect(r.token).toBe('');
      expect(r.detail).toContain(`registry row(s) demo-lnk ${UNRESOLVED}`);
      expect(r.detail, 'the value is never printed').not.toContain(row);
      // A row rooted inside the child in the same pass outranks it, as it outranks every unplaced row.
      otherRowOf('demo-nested', path.join(wt, 'f1.txt'));
      const o = evalOf(h);
      expect(o.verdict, o.detail).toBe('containment-unproven');
      expect(o.detail).toContain('registry row(s) demo-nested rooted inside');
    } finally { if (fs.existsSync(server)) fs.chmodSync(server, 0o755); }
    expect(fs.readFileSync(path.join(server, 'live.txt'), 'utf8')).toContain('uncommitted');
  }, 60_000);

  it('the review’s shape: a row `$HOME/a`, `a -> $HOME/locked/l`, `l -> <child>/server`, `locked` unsearchable OUTSIDE the child — unmeasured, and ws-reclaim leaves `server/live.txt`', () => {
    // `-d` is false on EACCES as on ENOENT, so the walk stopped at `$HOME`,
    // which can be entered, and `_ws_realpath` handed back `$HOME/a` — read as
    // outside; the verb then removed the other session's tree (measured).
    const c = makeChild(h);
    const server = path.join(c.wt, 'server');
    fs.mkdirSync(server);
    fs.writeFileSync(path.join(server, 'live.txt'), 'another session’s uncommitted work\n');
    const locked = path.join(h.home, 'locked');
    fs.mkdirSync(locked);
    fs.symlinkSync(server, path.join(locked, 'l'));
    fs.symlinkSync(path.join(locked, 'l'), path.join(h.home, 'a'));
    // The REAL token, taken before the row is planted — the rows are no input to it, so
    // without the guard the verb would accept it (measured: the tree went).
    const tok = evalOf(h).token;
    expect(tok, 'the CONTROL: without the row the ladder passes').toMatch(/^[0-9a-f]{64}$/);
    otherRowOf('demo-a', path.join(h.home, 'a'));
    const control = evalOf(h);
    expect(control.verdict, `the CONTROL: searchable, it places inside the child — ${control.detail}`).toBe('containment-unproven');
    expect(control.detail).toContain('registry row(s) demo-a rooted inside');
    fs.chmodSync(locked, 0o600);
    try {
      expect(h.sh(`_ws_realpath "${path.join(h.home, 'a')}"`), 'the CONTROL: `_ws_realpath` answers the link itself').toBe(path.join(h.home, 'a'));
      // The VERB first, with the real token, so its half is asserted on its own.
      const v = childReclaimVerb(h, tok);
      expect(v.stdout, 'the verb reclaimed the child').not.toContain('"reclaimed"');
      expect(fs.existsSync(path.join(server, 'live.txt')), 'the verb removed the other session’s file').toBe(true);
      expect(v.stdout).toContain('demo-a');
      const r = evalOf(h);
      expect(r.verdict, r.detail).toBe('unmeasured');
      expect(r.token).toBe('');
      expect(r.detail).toContain(`registry row(s) demo-a ${UNRESOLVED}`);
    } finally { fs.chmodSync(locked, 0o755); }
    expect(fs.existsSync(c.wt), 'the child stands').toBe(true);
    expect(fs.readFileSync(path.join(server, 'live.txt'), 'utf8')).toContain('uncommitted');
  }, 90_000);

  it('a link whose target crosses an unsearchable directory INSIDE the child is unmeasured too — the audit alone never answers reclaimable', () => {
    const { wt } = makeChild(h);
    const server = path.join(wt, 'server');
    fs.mkdirSync(path.join(server, 'inner'), { recursive: true });
    fs.symlinkSync(path.join(server, 'inner'), path.join(h.home, 'lnk2'));
    otherRowOf('demo-lnk2', path.join(h.home, 'lnk2'));
    expect(evalOf(h).verdict, 'the CONTROL: searchable, it places inside the child').toBe('containment-unproven');
    fs.chmodSync(server, 0o600);
    try {
      const r = evalOf(h);
      expect(r.verdict, r.detail).toBe('unmeasured');
      expect(r.detail).toContain(`registry row(s) demo-lnk2 ${UNRESOLVED}`);
    } finally { fs.chmodSync(server, 0o755); }
  }, 60_000);

  it('a row whose spelling holds a newline is never resolvable — `_ws_realpath`’s `dirname` would read another directory', () => {
    // `$HOME/lnk\n` -> the child, and nothing at `<child>/gone`: `_ws_realpath`
    // drops the newline, climbs to `$HOME`, and answers `$HOME/lnk/gone`, outside.
    const { wt } = makeChild(h);
    fs.symlinkSync(wt, path.join(h.home, 'lnk\n'));
    const row = `${path.join(h.home, 'lnk')}\n/gone`;
    expect(h.sh(`_ws_realpath "${h.home}/lnk"$'\\n'"/gone"`), 'the CONTROL: it reads as outside').toBe(path.join(h.home, 'lnk', 'gone'));
    otherRowOf('demo-nl', row);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.detail).toContain(`registry row(s) demo-nl ${UNRESOLVED}`);
    // Its link can be followed and it holds no `..`: the sentence names THIS cause, and a remedy true of it.
    expect(r.detail).toContain(`; ${CNTRL_CLAUSE}), so ccd cannot place them`);
    expect(r.detail).toContain(`against this child — ${UNRESOLVED_REMEDY}`);
  }, 60_000);

  it('the CONTROL: a row whose directory was simply deleted still resolves — it places, and a stale row outside never strands the child', () => {
    makeChild(h);
    otherRowOf('demo-gone', path.join(h.home, 'deleted', 'long', 'ago'));
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('reclaimable');
  }, 60_000);

  // A `..` IN THE UNRESOLVED SUFFIX. An older `ccd start` stored a workdir as
  // given, so a pane that entered `$HOME/gone/../<child path>` while `gone`
  // stood lives in the child's tree. Once `gone` is removed, `_ws_realpath`
  // stops at `$HOME` and re-attaches `gone/../…` AS WRITTEN — a spelling no
  // compare places inside the child — while the first missing component
  // (`gone`) is proven absent. Every string below is built by concatenation,
  // never `path.join`, which would collapse the `..` the row is about.
  const DOTDOT = 'demo-dotdot';
  const rowFile = (field: string): string => path.join(h.home, '.cc-sessions', `${DOTDOT}.${field}`);
  /** The legacy row's raw spelling, `$HOME/gone/../<the child's path below $HOME>`. */
  const dotdotOf = (c: Child): string => `${h.home}/gone/../${path.relative(h.home, c.wt)}`;
  /** The row, WRITTEN WHILE `$HOME/gone` STANDS, and its session's pane stand-in (`TMUX_MODEL`). */
  const plantDotdot = (c: Child): string => {
    fs.mkdirSync(path.join(h.home, 'gone'));
    const raw = dotdotOf(c);
    otherRowOf(DOTDOT, raw);
    plantTmux(h, { sessions: [`cc-${DOTDOT}`] });
    expect(fs.readFileSync(rowFile('workdir'), 'utf8'), 'the CONTROL: the raw spelling is what the registry holds').toBe(raw);
    return raw;
  };
  /** Everything a refusal must leave standing: the child's tree byte for byte, its branch at its tip, the live
   *  row exactly as written, and that row's session — its pane and its unit never touched. */
  const preserved = (c: Child, raw: string, before: string[] | 'gone'): void => {
    expect(treeOf(c.wt), 'the child’s tree — the live session’s — survives byte for byte').toEqual(before);
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'the child’s branch stands at its tip').toBe(c.tip);
    expect(fs.readFileSync(rowFile('workdir'), 'utf8'), 'the live row stands, as written').toBe(raw);
    expect(fs.readFileSync(rowFile('uuid'), 'utf8')).toBe(`u-${DOTDOT}`);
    expect(tmuxSessions(h), 'the live session’s pane stands').toContain(`cc-${DOTDOT}`);
    expect(h.calls().filter((l) => l.includes(DOTDOT)), 'its unit and pane were never touched').toEqual([]);
  };

  it('`..` in the unresolved suffix: while `gone` stands the row IS the child’s path (the CONTROL); once `gone` goes, the evaluation mints NO token — unmeasured, naming the row as unresolvable', () => {
    const c = makeChild(h);
    const raw = plantDotdot(c);
    const shared = evalOf(h);
    expect(shared.verdict, `the CONTROL: with \`gone\` standing the row resolves to the child — ${shared.detail}`).toBe('containment-unproven');
    expect(shared.detail).toContain(`is also named by registry row(s) ${DOTDOT}`);
    const before = treeOf(c.wt);
    fs.rmdirSync(path.join(h.home, 'gone'));
    const home = fs.realpathSync(h.home);
    expect(h.sh(`_ws_realpath "${raw}"`), 'the CONTROL: `_ws_realpath` re-attaches `gone/../…` as written')
      .toBe(`${home}/gone/../${path.relative(h.home, c.wt)}`);
    expect(h.sh(`_ws_realpath "${c.wt}"`), 'the CONTROL: which is not the child’s own resolved path').toBe(`${home}/${path.relative(h.home, c.wt)}`);
    const r = evalOf(h);
    expect(r.token, `the evaluation minted a destructive token — ${r.verdict}: ${r.detail}`).toBe('');
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.detail).toContain(`registry row(s) ${DOTDOT} ${UNRESOLVED}`);
    // The sentence names THIS cause — a `..` following a directory that is gone — and a remedy true of it.
    expect(r.detail).toContain(`; ${DOTDOT_CLAUSE};`);
    expect(r.detail).toContain(`against this child — ${UNRESOLVED_REMEDY}`);
    expect(r.detail, 'the value is never printed').not.toContain('gone/..');
    preserved(c, raw, before);
  }, 60_000);

  it('`..` in the unresolved suffix: ws-reclaim with a token minted BEFORE the row existed removes nothing — its own evaluation answers unmeasured', () => {
    const c = makeChild(h);
    // The REAL token: the rows are no input to it, so without the guard the verb accepts it.
    const tok = evalOf(h).token;
    expect(tok, 'the CONTROL: without the row the ladder passes').toMatch(/^[0-9a-f]{64}$/);
    const raw = plantDotdot(c);
    fs.rmdirSync(path.join(h.home, 'gone'));
    const before = treeOf(c.wt);
    const v = childReclaimVerb(h, tok);
    expect(v.stdout, 'the verb reclaimed the child — the live session’s tree').not.toContain('"reclaimed"');
    preserved(c, raw, before);
    expect(v.code, v.stdout + v.stderr).toBe(1);
    const o = JSON.parse(v.stdout) as { failed: string; detail: string };
    expect(o.failed, 'refused at evaluation, before anything started').toBe('probe-unmeasured');
    expect(o.detail).toContain(`registry row(s) ${DOTDOT} ${UNRESOLVED}`);
    expect(h.calls().filter((l) => l.startsWith('unsupervise')), 'the tail was never reached').toEqual([]);
    expect(h.reg(CHILD_ID, 'reaping'), 'no breadcrumb was written').toBeNull();
  }, 90_000);

  it('`..` in the unresolved suffix, at REMOVAL TIME on the fresh arm: the row appears and `gone` goes after the verb’s own evaluation passed — the tail’s re-check refuses, nothing further is deleted', () => {
    const c = makeChild(h);
    fs.mkdirSync(path.join(h.home, 'gone'));
    plantTmux(h, { sessions: [`cc-${DOTDOT}`] });
    const tok = evalOf(h).token;
    expect(tok, 'the CONTROL: without the row the ladder passes').toMatch(/^[0-9a-f]{64}$/);
    const raw = dotdotOf(c);
    const before = treeOf(c.wt);
    // The tail's first act (`_ws_unsupervise`, recorded) is the seam: after the evaluation and the pin, before
    // `_ws_reclaim_owned`. There the row is written while `gone` stands, and then `gone` is removed.
    const pre = '_ws_unsupervise() { echo "unsupervise $*" >> "$HOME/ccd-calls";'
      + ` printf '%s' 'u-${DOTDOT}' > "$HOME/.cc-sessions/${DOTDOT}.uuid";`
      + ` printf '%s' "$HOME/gone/../${path.relative(h.home, c.wt)}" > "$HOME/.cc-sessions/${DOTDOT}.workdir";`
      + ' rmdir "$HOME/gone"; };';
    const v = childReclaimVerb(h, tok, { pre });
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), `the tail removed the live session’s tree — ${v.stdout}`).toBe(true);
    expect(h.calls().some((l) => l.startsWith(`unsupervise ${CHILD_ID} `)), 'the CONTROL: the tail was reached').toBe(true);
    expect(fs.existsSync(path.join(h.home, 'gone')), 'the CONTROL: `gone` was removed at the seam').toBe(false);
    preserved(c, raw, before);
    expect(v.code, v.stdout + v.stderr).toBe(1);
    const o = JSON.parse(v.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('worktree-remove-failed');
    expect(o.detail).toContain(`registry row(s) ${DOTDOT} ${UNRESOLVED}`);
    failedPairAgrees(v);
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb the fresh arm wrote stays').toBe('reclaim:children');
  }, 90_000);

  it('`..` in the unresolved suffix, at REMOVAL TIME on a resumed arm — which has no evaluation in front of it — the tail’s re-check refuses', () => {
    const c = makeChild(h);
    interrupted(c, 'worktree');
    const tok = resumeToken('worktree');
    expect(tok, 'the CONTROL: the resume token was minted before the row').toMatch(/^[0-9a-f]{64}$/);
    const raw = plantDotdot(c);
    fs.rmdirSync(path.join(h.home, 'gone'));
    const before = treeOf(c.wt);
    const v = childReclaimVerb(h, tok);
    expect(treeOf(c.wt), `the resumed tail removed the live session’s tree — ${v.stdout}`).toEqual(before);
    preserved(c, raw, before);
    expect(v.code, v.stdout + v.stderr).toBe(1);
    const o = JSON.parse(v.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('worktree-remove-failed');
    expect(o.detail).toContain(`registry row(s) ${DOTDOT} ${UNRESOLVED}`);
    failedPairAgrees(v);
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays').toBe('reclaim:worktree');
  }, 90_000);

  it('only a `..` COMPONENT of the unresolved suffix refuses: `..x`, `.`, and a `..` in the entered prefix reach the ordinary absence answer — and those rows place outside the child', () => {
    const c = makeChild(h);
    const rel = path.relative(h.home, c.wt);
    const resolvable = (p: string): string => h.sh(`_ws_reclaim_resolvable "${p}"; printf '%s' "$?"`);
    for (const p of [`${h.home}/gone/../${rel}`, `${h.home}/gone/sub/../../${rel}`, `${h.home}/gone/..`]) {
      expect(resolvable(p), `${p} is never resolvable`).toBe('1');
    }
    const controls = [`${h.home}/gone/..x/${rel}`, `${h.home}/gone/./${rel}`, `${h.home}/worktrees/../gone/${rel}`];
    for (const p of controls) expect(resolvable(p), `${p} is resolvable: \`gone\` is proven absent`).toBe('0');
    controls.forEach((p, i) => {
      otherRowOf(`demo-ctl${i}`, p);
      const r = evalOf(h);
      expect(r.verdict, `${p}: ${r.detail}`).toBe('reclaimable');
      dropRowOf(`demo-ctl${i}`);
    });
  }, 60_000);

  // A `..` IN THE ENTERED PREFIX whose logical walk no longer succeeds. bash's
  // `cd` canonicalises `<link>/../gone/..` textually, asking that each
  // component before a `..` be a directory; when one no longer is, it FALLS
  // BACK to the kernel's walk of the path as written, which goes through the
  // link's target — silently, outside POSIX mode. A pane that entered while
  // `$HOME/gone` stood lives in the child; the fallback reads the row as
  // `$HOME/elsewhere/<child path>`, outside. `$HOME/elsewhere/gone` stands, so
  // the kernel's walk of the prefix succeeds and the `-d` walk stops there.
  /** `$HOME/lnk -> $HOME/elsewhere/sub`, with `$HOME/elsewhere/gone` standing. */
  const plantLinkedPrefix = (): void => {
    fs.mkdirSync(path.join(h.home, 'elsewhere', 'sub'), { recursive: true });
    fs.mkdirSync(path.join(h.home, 'elsewhere', 'gone'));
    fs.symlinkSync(path.join(h.home, 'elsewhere', 'sub'), path.join(h.home, 'lnk'));
  };

  // THE ENVIRONMENTS a reclaim may run in (spec §5.5, rung 9). A bare `cd` or
  // `pwd` is environment-shaped: a physical mode carried in (`set -P`), or a
  // function of that name imported through the environment, which bash
  // installs in the very shell that sources ccd. Each hostile one answers
  // PHYSICALLY where the pane's own shell entered LOGICALLY.
  type Env = 'normal' | 'set -P' | 'an imported cd' | 'an imported pwd';
  const ENVS: Record<Env, { pre: string; vars: Record<string, string> }> = {
    normal: { pre: '', vars: {} },
    'set -P': { pre: 'set -P;', vars: {} },
    // Physical, and deaf to its caller's own `-L`: it enters its LAST argument.
    'an imported cd': { pre: '', vars: { 'BASH_FUNC_cd%%': '() { builtin cd -P -- "${@: -1}"; }' } },
    // Deaf to `-P`: it prints the logical path the shell entered by.
    'an imported pwd': { pre: '', vars: { 'BASH_FUNC_pwd%%': '() { builtin pwd -L; }' } },
  };
  const ALL = Object.keys(ENVS) as Env[];
  const THREE: readonly Env[] = ['normal', 'set -P', 'an imported cd'];
  /** A snippet in `env`, answering instead of throwing. */
  const shIn = (env: Env, snippet: string): { code: number; stdout: string; stderr: string } => {
    try { return { code: 0, stdout: h.sh(`${ENVS[env].pre} ${snippet}`, ENVS[env].vars), stderr: '' }; } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
    }
  };
  /** The ladder's own answer in `env`, as `evalOf` reads it. */
  const evalIn = (env: Env): { verdict: string; token: string; detail: string } => {
    const [verdict = '', token = '', detail = ''] = shIn(env, `${CHILD_STUBS} _ws_reclaim_eval ${CHILD_ID} 0 '' >/dev/null;`
      + ` printf '%s\\x1f%s\\x1f%s' "$REAP_VERDICT" "$REAP_TOKEN" "$REAP_DETAIL"`).stdout.split('\x1f');
    return { verdict, token, detail };
  };
  /** `ws-reclaim` in `env`, as `childReclaimVerb` runs it; `pre` runs after the stubs. */
  const verbIn = (env: Env, token: string, pre = ''): { code: number; stdout: string; stderr: string } =>
    shIn(env, `${CHILD_STUBS} ${pre} ${CHILD_ENV} cmd_ws_reclaim --expect ${token} --child-of ${CHILD_RUN} --session ${CHILD_ID}`);
  /** The resolver's answer for `p` in `env`: `<rc>\x1f<canonical>`. */
  const resolveIn = (env: Env, p: string): string =>
    shIn(env, `_ws_reclaim_resolve "${p}"; printf '%s\\x1f%s' "$?" "$_WS_RESOLVED"`).stdout;
  /** THE CONTROL that the hostility is in force, so a crash or an import that did nothing cannot pass as green:
   *  where a BARE `cd` of `$HOME/lnk/..` lands, and what a bare `pwd -P` says after a logical entry of `$HOME/lnk`. */
  const expectHostile = (env: Env): void => {
    const [cd = '', pwd = ''] = shIn(env, '( cd -- "$HOME/lnk/.." >/dev/null 2>&1 && pwd -P ); printf \'\\x1f\';'
      + ' ( builtin cd -L -- "$HOME/lnk" >/dev/null 2>&1 && pwd -P )').stdout.split('\x1f').map((x) => x.trim());
    const physical = env === 'set -P' || env === 'an imported cd';
    expect(cd, `the CONTROL (${env}): where a bare \`cd\` of <lnk>/.. lands`)
      .toBe(physical ? fs.realpathSync(path.join(h.home, 'elsewhere')) : (env === 'normal' ? fs.realpathSync(h.home) : h.home));
    expect(pwd, `the CONTROL (${env}): what a bare \`pwd -P\` says inside <lnk>`)
      .toBe(env === 'an imported pwd' ? `${h.home}/lnk` : fs.realpathSync(path.join(h.home, 'elsewhere', 'sub')));
  };
  /** The prefix row's raw spelling, `$HOME/lnk/../gone/../<the child's path below $HOME>`. */
  const prefixRowOf = (c: Child): string => `${h.home}/lnk/../gone/../${path.relative(h.home, c.wt)}`;

  for (const env of ALL) {
    it(`STANDING, under ${env}: \`$HOME/lnk/../gone/../<child path>\` with \`gone\` standing IS the child — SHARED, and one resolver places both sides`, () => {
      const c = makeChild(h);
      plantLinkedPrefix();
      fs.mkdirSync(path.join(h.home, 'gone'));
      expectHostile(env);
      const raw = prefixRowOf(c);
      otherRowOf(DOTDOT, raw);
      expect(h.sh(`cd -- "${raw}" && pwd -P`), 'the CONTROL: a pane entering the row lands in the child').toBe(fs.realpathSync(c.wt));
      const r = evalIn(env);
      expect(r.token, `a destructive token was minted — ${r.verdict}: ${r.detail}`).toBe('');
      expect(r.verdict, r.detail).toBe('containment-unproven');
      expect(r.detail).toContain(`is also named by registry row(s) ${DOTDOT}`);
      const child = fs.realpathSync(c.wt);
      expect(resolveIn(env, raw), 'the resolver places the row at the child').toBe(`0\x1f${child}`);
      expect(resolveIn(env, c.wt), 'and the child at itself — the SAME operation answers both sides').toBe(`0\x1f${child}`);
    }, 60_000);
  }

  for (const env of THREE) {
    it(`VANISHED, under ${env}: once \`gone\` goes the logical walk fails — never the kernel’s fallback: unmeasured, no token, and ws-reclaim removes nothing`, () => {
      const c = makeChild(h);
      const rel = path.relative(h.home, c.wt);
      plantLinkedPrefix();
      // The REAL token, taken before the row exists: the rows are no input to it.
      const tok = evalOf(h).token;
      expect(tok, 'the CONTROL: without the row the ladder passes').toMatch(/^[0-9a-f]{64}$/);
      expect(evalIn(env).token, `the CONTROL: under ${env}, without the row, the ladder mints the SAME token`).toBe(tok);
      fs.mkdirSync(path.join(h.home, 'gone'));
      const raw = prefixRowOf(c);
      otherRowOf(DOTDOT, raw);
      plantTmux(h, { sessions: [`cc-${DOTDOT}`] });
      expect(h.sh(`cd -- "${raw}" && pwd -P`), 'the CONTROL: a pane entering the row now lands in the child').toBe(fs.realpathSync(c.wt));
      const before = treeOf(c.wt);
      fs.rmdirSync(path.join(h.home, 'gone'));
      expectHostile(env);
      const elsewhere = fs.realpathSync(path.join(h.home, 'elsewhere'));
      expect(h.sh(`cd -- "${h.home}/lnk/../gone/.." && pwd -P`), 'the CONTROL: bash’s own `cd` falls back to the kernel’s walk').toBe(elsewhere);
      expect(h.sh(`_ws_realpath "${raw}"`), 'the CONTROL: so `_ws_realpath` answers a path outside the child').toBe(`${elsewhere}/${rel}`);
      const r = evalIn(env);
      expect(r.token, `the evaluation minted a destructive token — ${r.verdict}: ${r.detail}`).toBe('');
      expect(r.verdict, r.detail).toBe('unmeasured');
      expect(r.detail).toContain(`registry row(s) ${DOTDOT} ${UNRESOLVED}`);
      expect(resolveIn(env, raw), 'the resolver answers unresolvable, and names no path').toBe('1\x1f');
      const v = verbIn(env, tok);
      expect(v.stdout, 'the verb reclaimed the child — the live session’s tree').not.toContain('"reclaimed"');
      preserved(c, raw, before);
      expect(v.code, v.stdout + v.stderr).toBe(1);
      const o = JSON.parse(v.stdout) as { failed: string; detail: string };
      expect(o.failed, 'refused at evaluation, before anything started').toBe('probe-unmeasured');
      expect(o.detail).toContain(`registry row(s) ${DOTDOT} ${UNRESOLVED}`);
    }, 90_000);

    it(`VANISHED at REMOVAL TIME on the fresh arm, under ${env}: the row appears and \`gone\` goes after the verb’s own evaluation passed — the tail’s re-check refuses`, () => {
      const c = makeChild(h);
      const rel = path.relative(h.home, c.wt);
      plantLinkedPrefix();
      fs.mkdirSync(path.join(h.home, 'gone'));
      plantTmux(h, { sessions: [`cc-${DOTDOT}`] });
      expectHostile(env);
      const tok = evalIn(env).token;
      expect(tok, `the CONTROL: under ${env}, without the row, the ladder passes`).toMatch(/^[0-9a-f]{64}$/);
      const raw = prefixRowOf(c);
      const before = treeOf(c.wt);
      // The seam is the tail's first act, after the evaluation and the pin and before `_ws_reclaim_owned`.
      const pre = '_ws_unsupervise() { echo "unsupervise $*" >> "$HOME/ccd-calls";'
        + ` printf '%s' 'u-${DOTDOT}' > "$HOME/.cc-sessions/${DOTDOT}.uuid";`
        + ` printf '%s' "$HOME/lnk/../gone/../${rel}" > "$HOME/.cc-sessions/${DOTDOT}.workdir";`
        + ' rmdir "$HOME/gone"; };';
      const v = verbIn(env, tok, pre);
      expect(fs.existsSync(path.join(c.wt, 'f1.txt')), `the tail removed the live session’s tree — ${v.stdout}`).toBe(true);
      expect(h.calls().some((l) => l.startsWith(`unsupervise ${CHILD_ID} `)), 'the CONTROL: the tail was reached').toBe(true);
      expect(fs.existsSync(path.join(h.home, 'gone')), 'the CONTROL: `gone` was removed at the seam').toBe(false);
      preserved(c, raw, before);
      expect(v.code, v.stdout + v.stderr).toBe(1);
      const o = JSON.parse(v.stdout) as { failed: string; detail: string };
      expect(o.failed).toBe('worktree-remove-failed');
      expect(o.detail).toContain(`registry row(s) ${DOTDOT} ${UNRESOLVED}`);
      failedPairAgrees(v);
      expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb the fresh arm wrote stays').toBe('reclaim:children');
    }, 90_000);

    it(`VANISHED at REMOVAL TIME on a resumed arm, under ${env}: no evaluation in front of it — the tail’s re-check refuses`, () => {
      const c = makeChild(h);
      plantLinkedPrefix();
      interrupted(c, 'worktree');
      const tok = resumeToken('worktree');
      expect(tok, 'the CONTROL: the resume token was minted before the row').toMatch(/^[0-9a-f]{64}$/);
      fs.mkdirSync(path.join(h.home, 'gone'));
      const raw = prefixRowOf(c);
      otherRowOf(DOTDOT, raw);
      plantTmux(h, { sessions: [`cc-${DOTDOT}`] });
      fs.rmdirSync(path.join(h.home, 'gone'));
      expectHostile(env);
      const before = treeOf(c.wt);
      const v = verbIn(env, tok);
      expect(treeOf(c.wt), `the resumed tail removed the live session’s tree — ${v.stdout}`).toEqual(before);
      preserved(c, raw, before);
      expect(v.code, v.stdout + v.stderr).toBe(1);
      const o = JSON.parse(v.stdout) as { failed: string; detail: string };
      expect(o.failed).toBe('worktree-remove-failed');
      expect(o.detail).toContain(`registry row(s) ${DOTDOT} ${UNRESOLVED}`);
      failedPairAgrees(v);
      expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays').toBe('reclaim:worktree');
    }, 90_000);
  }

  for (const env of ALL) {
    it(`the CHILD’s own canonical comes from the same resolver, under ${env}: a child under a linked ancestor, and a row spelled by its real path — SHARED`, () => {
      const c = makeChild(h);
      fs.renameSync(path.join(h.home, 'worktrees'), path.join(h.home, 'wtreal'));
      fs.symlinkSync(path.join(h.home, 'wtreal'), path.join(h.home, 'worktrees'));
      plantLinkedPrefix();
      expectHostile(env);
      const real = `${h.home}/wtreal/${path.relative(path.join(h.home, 'worktrees'), c.wt)}`;
      otherRowOf('demo-real', real);
      const r = evalIn(env);
      expect(r.token, `a destructive token was minted — ${r.verdict}: ${r.detail}`).toBe('');
      expect(r.verdict, r.detail).toBe('containment-unproven');
      expect(r.detail).toContain('is also named by registry row(s) demo-real');
      const child = fs.realpathSync(c.wt);
      expect(resolveIn(env, c.wt), 'the child, by its registry spelling').toBe(`0\x1f${child}`);
      expect(resolveIn(env, real), 'the row, by the real path — one canonical').toBe(`0\x1f${child}`);
    }, 60_000);
  }

  it('a CHILD whose own workdir cannot be resolved is compared with no fallback: a row not literally at or below it cannot be placed against it, and a literal one is still refused', () => {
    const c = makeChild(h);
    fs.mkdirSync(path.join(c.wt, 'server'));
    fs.mkdirSync(path.join(h.home, 'elsewhere'));
    const demo = path.dirname(c.wt);
    otherRowOf('demo-else', path.join(h.home, 'elsewhere'));
    expect(evalOf(h).verdict, 'the CONTROL: searchable, a row outside places nowhere').toBe('reclaimable');
    fs.chmodSync(demo, 0o000);
    let out: { verdict: string; token: string; detail: string };
    let nested: { verdict: string; token: string; detail: string };
    let own: string;
    try {
      own = h.sh(`_ws_reclaim_resolve "${c.wt}"; printf '%s\\x1f%s' "$?" "$_WS_RESOLVED"`);
      out = evalOf(h);
      otherRowOf('demo-nested', path.join(c.wt, 'server'));
      nested = evalOf(h);
    } finally { fs.chmodSync(demo, 0o755); }
    expect(own, 'the CONTROL: the child’s own workdir does not resolve').toBe('1\x1f');
    expect(out.token).toBe('');
    expect(out.verdict, out.detail).toBe('unmeasured');
    expect(out.detail).toContain(`registry row(s) demo-else cannot be placed against this child: ${CHILD_ID}'s own workdir cannot be resolved`);
    expect(nested.verdict, `a literal row outranks it — ${nested.detail}`).toBe('containment-unproven');
    expect(nested.detail).toContain('registry row(s) demo-nested rooted inside');
  }, 60_000);

  it('`CDPATH` never redirects the resolver’s entry — helper level: a row reaches the resolver only once proven absolute, and `CDPATH` never applies to an operand opening with `/`', () => {
    fs.mkdirSync(path.join(h.home, 'rel'));
    fs.mkdirSync(path.join(h.home, 'cdp', 'rel'), { recursive: true });
    const home = fs.realpathSync(h.home);
    expect(h.sh('CDPATH="$HOME/cdp"; ( cd -- rel >/dev/null 2>&1 && pwd -P )'), 'the CONTROL: a bare `cd` follows CDPATH')
      .toBe(`${home}/cdp/rel`);
    expect(h.sh('CDPATH="$HOME/cdp"; _ws_reclaim_resolve rel/gone; printf \'%s\\x1f%s\' "$?" "$_WS_RESOLVED"'),
      'entered where the walk found it (the cwd), never through CDPATH').toBe(`0\x1f${home}/rel/gone`);
  }, 60_000);

  it('in a NORMAL environment the resolver answers exactly what `_ws_realpath` answers, for every spelling these suites use that it resolves', () => {
    const c = makeChild(h);
    plantLinkedPrefix();
    fs.mkdirSync(path.join(h.home, 'elsewhere', 'x'));
    fs.symlinkSync(`/${path.join(h.home, 'elsewhere')}`, path.join(h.home, 'dsl'));
    fs.symlinkSync(path.join(h.home, 'worktrees'), path.join(h.home, 'wtlink'));
    const H = h.home; const W = c.wt;
    const spellings = [W, `${W}/`, `${W}//`, `${H}//worktrees/demo/quiet-basin`, `${W}/server`, `${W}/a/b/c`, `${W}/a//b/`,
      `${H}/deleted/long/ago`, `${H}/elsewhere`, `${W}/..`, `${W}/../../../elsewhere`, `${H}/lnk`, `${H}/lnk/`, `${H}/lnk/..`,
      `${H}/lnk/x`, `${H}/lnk/../${path.relative(H, W)}`, `${H}/lnk/../elsewhere/x`, `${H}/gone/./x`, `${H}/dsl/server`,
      `${H}/dsl/x/y`, `${H}/wtlink/demo/quiet-basin`, `${H}/wtlink/demo/quiet-basin/gone`, '/', '/nonexistent-ccrc-root/x'];
    const out = h.sh(`for p in ${spellings.map((p) => `'${p}'`).join(' ')}; do _ws_reclaim_resolve "$p"; rc=$?;`
      + ` printf '%s\\x1f%s\\x1f%s\\x1f%s\\x1e' "$p" "$rc" "$_WS_RESOLVED" "$(_ws_realpath "$p")"; done`);
    const rows = out.split('\x1e').filter(Boolean).map((l) => l.split('\x1f'));
    expect(rows.map((r) => r[0]), 'the CONTROL: every spelling was asked').toEqual(spellings);
    for (const [p, rc, resolved, realpath] of rows) {
      expect(rc, `${p} resolves`).toBe('0');
      expect(resolved, `${p}: the resolver and \`_ws_realpath\` agree`).toBe(realpath);
    }
  }, 60_000);

  it('the CONTROL: a `<link>/../<existing>/…` spelling whose logical walk SUCCEEDS still resolves, and places as it always did', () => {
    const c = makeChild(h);
    const rel = path.relative(h.home, c.wt);
    plantLinkedPrefix();
    const resolvable = (p: string): string => h.sh(`_ws_reclaim_resolvable "${p}"; printf '%s' "$?"`);
    const home = fs.realpathSync(h.home);
    // At the child's own path: resolved logically, it is the child — SHARED, terminal.
    const atChild = `${h.home}/lnk/../${rel}`;
    expect(resolvable(atChild)).toBe('0');
    expect(h.sh(`_ws_realpath "${atChild}"`)).toBe(`${home}/${rel}`);
    otherRowOf('demo-at', atChild);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.detail).toContain('is also named by registry row(s) demo-at');
    dropRowOf('demo-at');
    // Outside the child: resolved logically to `$HOME/elsewhere/x`, which places nowhere.
    const outside = `${h.home}/lnk/../elsewhere/x`;
    expect(resolvable(outside)).toBe('0');
    expect(h.sh(`_ws_realpath "${outside}"`)).toBe(`${home}/elsewhere/x`);
    otherRowOf('demo-out', outside);
    const o = evalOf(h);
    expect(o.verdict, o.detail).toBe('reclaimable');
  }, 60_000);
});

describe('the tombstone’s `reflog` field reads the child’s own HEAD reflog and its branch’s — never `--all`', () => {
  it('a commit only ANOTHER branch’s reflog names is not in the child’s tombstone; the child’s own commits are', () => {
    const c = makeChild(h);
    const tree = h.git(c.main, 'rev-parse', 'HEAD^{tree}');
    const foreign = h.git(c.main, 'commit-tree', tree, '-p', 'HEAD', '-m', 'on another branch only');
    h.git(c.main, 'update-ref', '--create-reflog', '-m', 'another branch', 'refs/heads/elsewhere', foreign);
    expect(h.git(c.wt, 'reflog', 'show', '--all', '--format=%H').split('\n'),
      'the CONTROL: `--all` from the child’s workdir names it').toContain(foreign);
    // And a commit ONLY the workdir's HEAD reflog names — made detached, then left.
    h.git(c.wt, 'checkout', '-q', '--detach');
    h.git(c.wt, 'commit', '-q', '--allow-empty', '-m', 'in the HEAD reflog only');
    const headOnly = h.git(c.wt, 'rev-parse', 'HEAD');
    h.git(c.wt, 'checkout', '-q', CHILD_BRANCH);
    expect(h.git(c.main, 'reflog', 'show', '--format=%H', `refs/heads/${CHILD_BRANCH}`).split('\n'),
      'the CONTROL: the branch reflog does not name it').not.toContain(headOnly);
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    const tomb = JSON.parse(fs.readFileSync(path.join(h.home, '.cc-sessions', '.reaped', `${CHILD_ID}.json`), 'utf8')) as { reflog: string };
    const named = tomb.reflog.split('\n').map((l) => l.split(' ')[0]);
    expect(named, 'another branch’s commit is not this cleanup’s').not.toContain(foreign);
    expect(named, 'the child’s own tip is named').toContain(c.tip);
    expect(named, 'the workdir’s HEAD reflog is read').toContain(headOnly);
    expect(tomb.reflog, 'the branch’s own reflog is read too — its creation entry').toMatch(/ branch: Created from /);
  }, 90_000);
});
