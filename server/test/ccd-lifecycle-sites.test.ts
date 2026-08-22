// server/test/ccd-lifecycle-sites.test.ts
//
// STANDING NOTE: this file matches `ccd-workspaces.test.ts:1045`'s
// `/^ccd.*\.ts$/` containment scan; every snippet runs through `h.sh`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { actsOf, readJournal, eventsOf, measOf, decOf, lcDir } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-lc-sites-'); });
afterEach(() => { h.cleanup(); });

describe('session call sites', () => {
  it('_ws_supervise and _ws_unsupervise each write one line', () => {
    h.sh('systemctl() { :; }; _ws_supervise sess; _ws_unsupervise sess pwa');
    expect(actsOf(h.home)).toEqual(['supervise', 'unsupervise']);
  });

  it('the STAMP\'s word is not a declaration — a two-argument call reads `none`', () => {
    // Mutant: emit `dec.surface "$surface"` (the stamp's already-defaulted word)
    // -> this fails with `expected 'pwa' to be 'none'` on the first case and
    // `expected 'ccd' to be 'none'` on the second, and ccd's own defaults —
    // cmd_stop's `cli`, this function's `ccd` — are laundered into a field L0
    // reserves for what a CALLER said.
    //
    // FIX ROUND 1 (a): a hard length guard precedes each `[N]!` dereference —
    // the identical lesson Task 17's review ordered fixed in this same file
    // family — so a regression here is a clean assertion, not a TypeError.
    h.sh('systemctl() { :; }; _ws_unsupervise sess pwa');
    expect(readJournal(h.home)).toHaveLength(1);
    expect(decOf(readJournal(h.home)[0]!)['surface']).toBe('none');
    h.sh('systemctl() { :; }; _ws_unsupervise other');
    expect(readJournal(h.home)).toHaveLength(2);
    expect(decOf(readJournal(h.home)[1]!)['surface']).toBe('none');
  });

  it('carries a DECLARED surface when the third argument says one was declared', () => {
    h.sh('systemctl() { :; }; _ws_unsupervise sess pwa pwa');
    expect(readJournal(h.home)).toHaveLength(1);
    expect(decOf(readJournal(h.home)[0]!)['surface']).toBe('pwa');
  });

  it('records an unrecognised declared word as `unknown`, exactly as ccd:619 does', () => {
    h.sh('systemctl() { :; }; _ws_unsupervise sess unknown wharf');
    expect(readJournal(h.home)).toHaveLength(1);
    expect(decOf(readJournal(h.home)[0]!)['surface']).toBe('unknown');
  });

  it('_reg_claim writes one claim line', () => {
    h.sh('_reg_set sess wrapper claude-corp; _reg_claim sess');
    // `toEqual(['claim'])` already pins the journal at exactly one line — the
    // hard guard the two claims below dereference against — so the two
    // independent diagnostic claims (FIX ROUND 1 (c)) are `expect.soft`:
    // either can fail without hiding the other.
    expect(actsOf(h.home)).toEqual(['claim']);
    expect.soft(readJournal(h.home)[0]!['id']).toBe('sess');
    expect.soft(measOf(readJournal(h.home)[0]!)['wrapper']).toBe('claude-corp');
  });

  it('_spawn_settle is CHANGE-ONLY — an unchanged rc inside 300s writes nothing', () => {
    // Mutant: delete the change-only gate -> this fails with `expected 3 to be
    // 1`, and Restart=always x 18 sessions becomes the whole disk budget.
    const stub = `_accept_first_run_prompts() { return 0; }; _tmux() { echo t; };
      tmux() { :; }; date() { echo 1787000000; };`;
    h.sh(`${stub} _spawn_settle sess 0; _spawn_settle sess 0; _spawn_settle sess 0`);
    expect(eventsOf(h.home, 'spawn')).toHaveLength(1);
  });

  it('_spawn_settle DOES emit when the rc changes', () => {
    const stub = (rc: number): string => `_accept_first_run_prompts() { return ${rc}; }; _tmux() { echo t; };
      tmux() { :; }; date() { echo 1787000000; };`;
    h.sh(`${stub(0)} _spawn_settle sess 0`);
    // `_spawn_settle` legitimately `return`s the prompt rc (ccd:9259) — a real,
    // documented non-zero exit, not a bug — so a bash -c whose LAST command is
    // the rc=3 case must not let that become the harness's own exit code.
    h.sh(`${stub(3)} _spawn_settle sess 0 || true`);
    const spawns = eventsOf(h.home, 'spawn');
    expect(spawns).toHaveLength(2);
    // FIX ROUND 1 (c): the guard above already pins the length these index; the
    // two rc claims are independent diagnostics, softened so either can fail
    // without masking the other.
    expect.soft(measOf(spawns[0]!)['rc']).toBe('0');
    expect.soft(measOf(spawns[1]!)['rc']).toBe('3');
  });

  it('_spawn_settle DOES emit when 300s have passed at the same rc', () => {
    const stub = (now: number): string => `_accept_first_run_prompts() { return 0; }; _tmux() { echo t; };
      tmux() { :; }; date() { echo ${now}; };`;
    h.sh(`${stub(1787000000)} _spawn_settle sess 0`);
    h.sh(`${stub(1787000301)} _spawn_settle sess 0`);
    expect(eventsOf(h.home, 'spawn')).toHaveLength(2);
  });

  it('cmd_stop writes one stop line carrying the declared surface, and `none` without the flag', () => {
    h.sh(`_reg_set sess uuid u
      _ws_unsupervise() { :; }; _tmux() { echo t; }; tmux() { :; }
      cmd_stop --surface pwa sess`);
    const stops = eventsOf(h.home, 'stop');
    expect(stops).toHaveLength(1);
    expect(decOf(stops[0]!)['surface']).toBe('pwa');

    h.sh(`_reg_set s2 uuid u
      _ws_unsupervise() { :; }; _tmux() { echo t; }; tmux() { :; }
      cmd_stop s2`);
    // FIX ROUND 1 (c): the `toHaveLength(1)` above covers only the FIRST
    // `cmd_stop` call — this second dereference needs its own fresh guard.
    expect(eventsOf(h.home, 'stop')).toHaveLength(2);
    expect(decOf(eventsOf(h.home, 'stop')[1]!)['surface'],
      'cmd_stop\'s own `cli` default is not a declaration').toBe('none');
  });

  it('cmd_enable and cmd_start write TWO independent events, not one folded pair', () => {
    // The ruling: a re-entrant verb records two acts because two acts happened.
    // `wrapper` and `workdir` are seeded because cmd_start's ladder dies at
    // ccd:8682 and ccd:8694 without them; `claude-corp` is in the harness's
    // home-able roster, so `[[ -x "$WRAPPER_DIR/claude-corp" ]]` (ccd:8683) holds.
    h.sh(`_reg_set sess uuid u; _reg_set sess project demo
      _reg_set sess wrapper claude-corp; _reg_set sess workdir "$HOME"
      _supervised_start() { return 0; }; _reg_claim() { :; }; _spawn_settle() { :; }
      _spawn_start() { SPAWN_FROMSWAP=0; }; _alive() { return 1; }
      cmd_enable sess`);
    const a = actsOf(h.home);
    expect(a).toContain('enable');
    expect(a).toContain('start');
    const [en] = eventsOf(h.home, 'enable');
    const [st] = eventsOf(h.home, 'start');
    expect(en!['tx'], 'no tx is shared across a re-entrant call tree').toBeUndefined();
    expect(st!['tx']).toBeUndefined();
  });

  it('cmd_enable -> cmd_start shells exactly ONE tmux probe across both _lc_done calls', () => {
    // FIX ROUND 1 (b), REQUIRED (promoted from the review's recommendation).
    // Mirrors ccd-lifecycle-purge.test.ts's identical pin for `_reg_purge`
    // ("one whole `_reg_purge` run shells exactly one tmux probe"). This site
    // pair needs the pin MORE than that one did: at the time this test was
    // written, cmd_enable -> cmd_start was the only pair in this plan that ran
    // TWO `_lc_done` calls in ONE process (Task 19 added a second — see
    // `cmd_ws_add`'s own pin, below in the `workspace call sites` describe —
    // once `create`'s new emit joined `_reg_claim`'s pre-existing `claim`),
    // which is exactly where `_lc_obs`'s once-per-process
    // memoisation (`[[ -z "$_LC_OBS" ]] || return 0`) could regress silently
    // — nothing else checks the tmux call COUNT on this path; the re-entrant
    // test above asserts journal `tx` only. No snippet here shadows `tmux`,
    // so the probe resolves through the harness's CONTAINED PATH stub and is
    // recorded in `h.tmuxCalls()` (never the `ccd-calls` log some other
    // fixtures in this repo read through a local `tmux()` shell function).
    h.sh(`_reg_set sess uuid u; _reg_set sess project demo
      _reg_set sess wrapper claude-corp; _reg_set sess workdir "$HOME"
      _supervised_start() { return 0; }; _reg_claim() { :; }; _spawn_settle() { :; }
      _spawn_start() { SPAWN_FROMSWAP=0; }; _alive() { return 1; }
      cmd_enable sess`);
    expect(h.tmuxCalls()).toEqual(['list-panes -a -F #{session_name} #{pane_pid}']);
  });
});

describe('the two sites that must NEVER emit', () => {
  const src = readFileSync(CCD, 'utf8');

  it('_reg_set contains no _lc_ call — thousands an hour, no forensic value', () => {
    const from = src.indexOf('_reg_set() {');
    const body = src.slice(from, src.indexOf('_reg_get() {'));
    expect(body.length, 'the slice collapsed').toBeGreaterThan(100);
    expect(body).not.toMatch(/_lc_/);
  });

  it('session-hook.sh contains no _lc_ call — its exit-0 contract is absolute', () => {
    const hook = readFileSync(CCD.replace(/ccd$/, 'session-hook.sh'), 'utf8');
    expect(hook).not.toMatch(/_lc_/);
    expect(hook).not.toMatch(/\.lifecycle/);
  });
});

describe('workspace call sites', () => {
  /** A real worktree on a real branch — cmd_ws_rename's ladder measures
   *  `.uuid`, hold, workspace, project+workdir+branch, `-d workdir`, the
   *  worktree record, detachment, foreignness and branch drift before it
   *  reaches the emit, so a stubbed `git` never gets there. */
  const renameable = (id = 'demo-still-river'): { main: string; wt: string } => {
    const main = h.makeRepo('demo');
    h.git(main, 'commit', '--allow-empty', '-m', 'base');
    const wt = path.join(h.home, 'worktrees', 'demo', 'still-river');
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    h.git(main, 'worktree', 'add', '-b', 'ws/still-river', wt);
    h.sh(`_reg_set ${id} uuid u; _reg_set ${id} project demo
      _reg_set ${id} workspace still-river; _reg_set ${id} branch ws/still-river
      _reg_set ${id} workdir ${wt}`);
    return { main, wt };
  };

  it('cmd_ws_rename records old and new, and its stdout document is untouched', () => {
    renameable();
    const out = h.sh(`cmd_ws_rename --session demo-still-river --branch ws/new`);
    expect(out, 'the verb refused — the fixture is wrong, not the emit').toContain('"renamed"');
    expect(JSON.parse(out) as Record<string, string>, 'the emit must not add a byte to a document a consumer parses')
      .toEqual({ renamed: 'demo-still-river', old: 'ws/still-river', new: 'ws/new' });
    const [e] = eventsOf(h.home, 'rename');
    expect(e, 'ws-rename wrote no line').toBeTruthy();
    expect(measOf(e!)['old']).toBe('ws/still-river');
    expect(measOf(e!)['branch']).toBe('ws/new');
  });

  it('cmd_ws_hold records the reason verbatim, parsed nowhere', () => {
    // FIX (brief defect): cmd_ws_hold refuses `id is not a workspace` (ccd:3355)
    // unless the `workspace` field is set — the brief's own snippet omitted it
    // and the verb died before ever reaching the emit, in RED as much as GREEN.
    h.sh(`_reg_set w uuid u; _reg_set w workspace w
      cmd_ws_hold --session w --reason 'program:build9 wave:2/6'`);
    const [e] = eventsOf(h.home, 'hold');
    expect(decOf(e!)['reason']).toBe('program:build9 wave:2/6');
  });

  it('cmd_ws_release records a release, and records nothing when nothing was held', () => {
    h.sh(`_reg_set w uuid u; cmd_ws_release --session w`);
    expect(eventsOf(h.home, 'release')).toHaveLength(0);
    h.sh(`_reg_set w hold 'program:x'; cmd_ws_release --session w`);
    const rel = eventsOf(h.home, 'release');
    expect(rel).toHaveLength(1);
    expect(measOf(rel[0]!)['held'], 'the text being released is the fact worth keeping').toBe('program:x');
  });

  it('cmd_ws_archive records the closed reason vocabulary, through the VERB', () => {
    // Mutant: emit before ccd:2753-2754 -> this fails with `expected undefined
    // to be 'manual'`, because `$reason` is not decided until ccd:2750-2752.
    const main = h.makeRepo('demo');
    h.git(main, 'commit', '--allow-empty', '-m', 'base');
    const wt = path.join(h.home, 'worktrees', 'demo', 'still-river');
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    h.git(main, 'worktree', 'add', '-b', 'ws/still-river', wt);
    fs.writeFileSync(path.join(wt, 'f.txt'), 'one');
    h.git(wt, 'add', 'f.txt'); h.git(wt, 'commit', '-m', 'one');
    h.sh(`_reg_set demo-still-river uuid u; _reg_set demo-still-river project demo
      _reg_set demo-still-river workspace still-river
      _reg_set demo-still-river branch ws/still-river
      _reg_set demo-still-river workdir ${wt}
      _ws_status() { echo idle; }; _ws_unsupervise() { :; }; _tmux() { echo t; }; tmux() { :; }
      cmd_ws_archive --session demo-still-river 2>/dev/null || true`);
    const [e] = eventsOf(h.home, 'archive');
    expect(e, 'ws-archive wrote no line').toBeTruthy();
    expect(measOf(e!)['archivedReason']).toBe('manual');
    expect(measOf(e!)['branch']).toBe('ws/still-river');
  });

  it('ws-attic --drop records HOW MANY refs it destroyed — a count only the loop knows', () => {
    // Mutant: move the emit above the `while … done` loop -> this fails with
    // `expected NaN to be greater than or equal to 2`, because `$n` is 0 before
    // ccd:3164 and a fabricated zero on a destructive verb is a false record.
    const repo = h.makeRepo('demo');
    h.git(repo, 'commit', '--allow-empty', '-m', 'a');
    const one = h.git(repo, 'rev-parse', 'HEAD').trim();
    h.git(repo, 'commit', '--allow-empty', '-m', 'b');
    const two = h.git(repo, 'rev-parse', 'HEAD').trim();
    h.git(repo, 'update-ref', `refs/ccrc/attic/w/${one}`, one);
    h.git(repo, 'update-ref', `refs/ccrc/attic/w/${two}`, two);
    // `_attic_project` reads the registry FIRST (ccd:3137-3145); with no row and
    // no tombstone the verb dies `no such session` at ccd:3153.
    h.sh(`_reg_set w project demo; cmd_ws_attic --drop w`);
    const [e] = eventsOf(h.home, 'attic-drop');
    expect(e, 'ws-attic --drop wrote no line').toBeTruthy();
    expect(Number(measOf(e!)['dropped'])).toBeGreaterThanOrEqual(2);
  });

  it('cmd_ws_add shells exactly ONE tmux probe across its `create` and `claim` `_lc_done` calls', () => {
    // The `cmd_enable -> cmd_start` pin (Task 18, above in this file) claimed
    // that pairing was "the only pair in this plan that runs TWO `_lc_done`
    // calls in ONE process" — this task adds a second, in the SAME function
    // this brief's own §0 measured locals against: `cmd_ws_add`'s new
    // `create` emit runs immediately before `_spawn_start`, and `_reg_claim`
    // (pre-existing, wired by an earlier task) fires its own `_lc_done claim`
    // right after. Same risk, same pin: `_lc_obs`'s once-per-process
    // memoisation (`[[ -z "$_LC_OBS" ]] || return 0`) could regress silently,
    // and nothing else checks the tmux call COUNT on this path — the
    // rename/hold/release/archive/attic-drop tests above each run exactly
    // ONE `_lc_done` call per process, so only ws-add among this task's six
    // sites needs this pin.
    //
    // No snippet here shadows `tmux`, so the probe resolves through the
    // harness's CONTAINED PATH stub and is recorded in `h.tmuxCalls()` —
    // never the `ccd-calls` log `WS_ADD` (ccdWsHelpers.ts) reads through its
    // own local `tmux() { :; }` shell function, which this test deliberately
    // omits.
    h.makeRepo('demo');
    h.sh(`_spawn() { :; }; _spawn_start() { SPAWN_FROMSWAP=0; }; _spawn_settle() { :; };
      _ws_supervise() { :; }; _supervised_start() { :; };
      CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    expect(h.tmuxCalls()).toEqual(['list-panes -a -F #{session_name} #{pane_pid}']);
  });

  it('cmd_ws_add completes with its normal success line even when the journal directory cannot be written at all', () => {
    // THE WORST FAILURE AVAILABLE IN THIS TASK: a wrong variable name under
    // `set -uo pipefail` would EXIT the shell between the lock (already
    // released, ccd:2665) and the spawn, leaving a worktree on disk with no
    // registry entry and no session — a half-created workspace. This test
    // covers the OTHER half of that same worry: a journal that cannot be
    // WRITTEN AT ALL must not abort the verb either. Mirrors
    // ccd-lifecycle-purge.test.ts's identical proof for `_reg_purge`
    // ("purges even when the journal cannot record it — D7, never gate the
    // act"): `_lc_emit` is documented "Always 0" (ccd:1401), and every one of
    // its failure branches is `|| { _lc_err; return 0; }` — this is the
    // creation-path analogue of that destruction-path proof.
    const dir = lcDir(h.home);
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o555);
    h.makeRepo('demo');
    let out: string;
    try {
      out = h.sh(`_spawn() { :; }; _spawn_start() { SPAWN_FROMSWAP=0; }; _spawn_settle() { :; };
        _ws_supervise() { :; }; _supervised_start() { :; }; tmux() { :; };
        CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    } finally {
      fs.chmodSync(dir, 0o755);   // restore so afterEach's own cleanup can remove the tree
    }
    expect(out, 'the verb must complete and print its normal success line').toMatch(/^workspace demo-quiet-mesa /);
    expect(h.reg('demo-quiet-mesa', 'uuid'), 'the workspace must be fully created, not half').not.toBeNull();
    expect(h.reg('demo-quiet-mesa', 'workspace')).toBe('quiet-mesa');
    // Nothing landed — the directory truly was unwritable, so this is not a
    // false pass through some other write path.
    expect(readJournal(h.home)).toEqual([]);
  });
});
