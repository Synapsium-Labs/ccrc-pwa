// Child reclamation, below the frozen boundary (spec 2026-09-22 §5.5-§5.6):
// the tail's bounded pane kill, the hidden-edit read's fork-free ancestor walk
// and its memo, the gitdir walk's top-level sentence, and a `/proc` workdir —
// refused where it is written (`ccd start`) and unplaced where another row is
// read (rung 9). Then: a staged intermediate version kept by the WIP commit,
// a nested foreign clone's reflog-only commits, the keep's reading of G as git
// reads it, the containment's inherited git variables, a workdir holding a
// control character, the memo's scope, the absence walk's `dirname`, and the
// shapes rung 9's row placement answers for a `//` spelling and an
// unresolvable one. Every case builds its child in a fixture HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { GH_STUB, makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD, ghContainedEnv, harnessBin } from './ccdWsHelpers.js';
import { asManagerCalls } from './platformFixtures.js';
import {
  CHILD_BRANCH, CHILD_ENV, CHILD_ID, CHILD_RUN, CHILD_STUBS, atticReach, childReclaimVerb, evalOf, gcNow, hasCommit,
  looseCommits, makeChild, type Child,
} from './childReclaimFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-hardening-'); });
afterEach(() => { h.cleanup(); });

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
    expect(calls, 'the kill was asked, anchored').toContain(`kill-session -t =cc-${CHILD_ID}`);
    expect(r.ms, 'bounded by the deadline and its grace, not by the wedge').toBeLessThan(15_000);
    // Nothing was deleted, and the breadcrumb stays for the retry.
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the worktree survives').toBe(true);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the branch survives').toContain(CHILD_BRANCH);
    expect(h.reg(CHILD_ID, 'uuid'), 'the registry row survives').not.toBeNull();
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays').toBe('reclaim:children');
  }, 90_000);
});

describe('the hidden-edit read’s ancestor walk takes no fork per path, and siblings under one missing directory share one walk (spec §5.5 step 2)', () => {
  // THE BOUND is twice the fork-free walk's own time, measured on the fleet
  // box under its ordinary load (median of five runs: 919ms). The walk that
  // forked `dirname` once per path took 15.4-16.0s on the same box and read.
  const HIDDEN_READ_BOUND_MS = 1840;
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

  const UNRESOLVED = 'name a workdir that cannot be resolved (a directory on its path cannot be entered), so ccd cannot place them against this child';

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
});
