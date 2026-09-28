// Child reclamation, below the frozen boundary (spec 2026-09-22 §5.5-§5.6):
// the tail's bounded pane kill, the hidden-edit read's fork-free ancestor walk
// and its memo, the gitdir walk's top-level sentence, and a `/proc` workdir —
// refused where it is written (`ccd start`) and unplaced where another row is
// read (rung 9). Every case builds its child in a fixture HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD, ghContainedEnv, harnessBin } from './ccdWsHelpers.js';
import { asManagerCalls } from './platformFixtures.js';
import {
  CHILD_BRANCH, CHILD_ENV, CHILD_ID, CHILD_RUN, CHILD_STUBS, evalOf, makeChild,
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
