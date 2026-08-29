// server/test/ccd-lifecycle-sites.test.ts
//
// STANDING NOTE: this file matches `ccd-workspaces.test.ts:1045`'s
// `/^ccd.*\.ts$/` containment scan; every snippet runs through `h.sh`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, WS_ADD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { actsOf, readJournal, eventsOf, measOf, decOf, lcDir } from './lifecycleHelpers.js';

// The bound's own tool, in the platform's spelling: bare `timeout` is GNU and
// a macOS box carries `gtimeout` (Homebrew coreutils) instead. The harness
// PATH rides on the process PATH, so the name resolves on either host — the
// first test-macos run measured the bare spelling failing 5 probes at 127.
const TIMEOUT_BIN = process.platform === 'darwin' ? 'gtimeout' : 'timeout';

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

  it('records an unrecognised declared word as `unknown`, exactly as ccd:1523 does', () => {
    h.sh('systemctl() { :; }; _ws_unsupervise sess unknown wharf');
    expect(readJournal(h.home)).toHaveLength(1);
    expect(decOf(readJournal(h.home)[0]!)['surface']).toBe('unknown');
  });

  it('_reg_claim writes one claim line', () => {
    h.sh('_reg_set sess wrapper claude-b; _reg_claim sess');
    // `toEqual(['claim'])` already pins the journal at exactly one line — the
    // hard guard the two claims below dereference against — so the two
    // independent diagnostic claims (FIX ROUND 1 (c)) are `expect.soft`:
    // either can fail without hiding the other.
    expect(actsOf(h.home)).toEqual(['claim']);
    expect.soft(readJournal(h.home)[0]!['id']).toBe('sess');
    expect.soft(measOf(readJournal(h.home)[0]!)['wrapper']).toBe('claude-b');
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
    // `_spawn_settle` legitimately `return`s the prompt rc (ccd:9902) — a real,
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
    // ccd:10166 and ccd:10178 without them; `claude-b` is in the harness's
    // home-able roster, so `[[ -x "$WRAPPER_DIR/claude-b" ]]` (ccd:10167) holds.
    h.sh(`_reg_set sess uuid u; _reg_set sess project demo
      _reg_set sess wrapper claude-b; _reg_set sess workdir "$HOME"
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
      _reg_set sess wrapper claude-b; _reg_set sess workdir "$HOME"
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
    // FIX (brief defect): cmd_ws_hold refuses `id is not a workspace` (ccd:3659)
    // unless the `workspace` field is set — the brief's own snippet omitted it
    // and the verb died before ever reaching the emit, in RED as much as GREEN.
    h.sh(`_reg_set w uuid u; _reg_set w workspace w
      cmd_ws_hold --session w --reason 'program:build9 wave:2/6'`);
    const [e] = eventsOf(h.home, 'hold');
    // FIX ROUND 1 (b): the same guard its three siblings (rename, archive,
    // attic-drop) already carry — without it a broken emit surfaces as
    // `TypeError: Cannot read properties of undefined (reading 'dec')` from
    // inside lifecycleHelpers.ts's `decOf`, a helper-internal crash, rather
    // than a clean assertion naming what actually happened.
    expect(e, 'ws-hold wrote no line').toBeTruthy();
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
    // Mutant: emit before ccd:4007 -> this fails with `expected undefined
    // to be 'manual'`, because `$reason` is not decided until ccd:3997-3999.
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
    // Mutant, RUN (not merely predicted — see FIX ROUND 1): move the emit
    // above the `while … done` loop, right after `local n=0 ref` -> this
    // fails with `expected 0 to be greater than or equal to 2`, NOT `NaN`.
    // `local n=0` initialises before the loop runs, so an emit placed there
    // captures a REAL `"0"`, and `Number("0")` is `0` — the loop at ccd:4021
    // is what turns that 0 into the true count of 2, and a fabricated zero on
    // a destructive verb is a false record either way, but the failure text
    // is the measured one above, not a guessed `NaN`.
    const repo = h.makeRepo('demo');
    h.git(repo, 'commit', '--allow-empty', '-m', 'a');
    const one = h.git(repo, 'rev-parse', 'HEAD').trim();
    h.git(repo, 'commit', '--allow-empty', '-m', 'b');
    const two = h.git(repo, 'rev-parse', 'HEAD').trim();
    h.git(repo, 'update-ref', `refs/ccrc/attic/w/${one}`, one);
    h.git(repo, 'update-ref', `refs/ccrc/attic/w/${two}`, two);
    // `_attic_project` reads the registry FIRST (ccd:4563-4571); with no row and
    // no tombstone the verb dies `no such session` at ccd:4579.
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
    // released, ccd:2645) and the spawn, leaving a worktree on disk with no
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

// ---------------------------------------------------------------------------
// `ws-add` declares its actor — the flags D-410 measured it could not read.
//
// `cmd_ws_add` had NO flag loop: it consumed an exact-string `--no-rc` at
// position 1 and then bound `project="$1"`, `slug="${2:-}"`. So the composed
// dispatch argv `ws-add --no-rc <project> --surface agent --actor '…'` put
// `--surface` in the SLUG and died at `_ws_slug_valid` — before the worktree,
// the registry row and the pane existed. Every dispatched spawn on a
// caps-advertising box would have refused, and the `create` row for every
// spawn that did land read *declared: nothing*.
//
// The remedy is `cmd_ws_hold`'s loop (ccd:3711), not a new invention, and it
// carries TWO dec flags, not three: `--reason` is deliberately absent, because
// this verb has no reason of its own and the dispatch path's rides `--actor`.
// ---------------------------------------------------------------------------

describe('ws-add declares its actor (D-410)', () => {
  /** ONE `ws-add` attempt against the REAL ccd, BOUNDED and NON-FATAL.
   *
   *  NON-FATAL: `die` is `exit 1` (ccd:150) and `h.sh` throws on any non-zero
   *  exit, so a refusal read through `h.sh` alone surfaces as an
   *  `execFileSync` stack rather than an assertion about what ccd said. The
   *  probe therefore runs as its own script and only its rc crosses back, in
   *  the text.
   *
   *  BOUNDED, and the `timeout` is the whole reason this is not a bare
   *  `h.sh`: ccd runs under `set -uo pipefail` with NO `-e`, where a
   *  `shift 2` past the end of argv shifts NOTHING — so a missing arity check
   *  in the flag loop can fail as a LOOP THAT NEVER ENDS rather than as a
   *  wrong answer. `execFileSync` is synchronous, so an unbounded hang takes
   *  the whole vitest worker with it instead of reddening one test. rc 124 is
   *  `timeout`'s own, and it is an assertion (see the arity case below).
   *
   *  MEASURED, and it narrows that claim for the arms as they are WRITTEN
   *  today: deleting the `--surface` arity check does not hang, because
   *  `lc_surface="$2"` trips `set -u` before the `shift 2` is reached and the
   *  shell aborts at rc 1 (`$2: unbound variable`). The bound stays anyway —
   *  it costs one word and it is the difference between a red test and a dead
   *  worker the day an arm shifts before it reads.
   *
   *  It is still `h.sh` that spawns it — the containment this file's standing
   *  note requires — and the script sources the same real `ccd` `h.sh` does,
   *  with `WS_ADD`'s three stubs so no spawn or systemd call is attempted. */
  const wsAdd = (args: string, slug = 'quiet-mesa'): { out: string; rc: number } => {
    const script = path.join(h.home, 'ws-add-probe.sh');
    fs.writeFileSync(script, `source ${JSON.stringify(CCD)}\n${WS_ADD}\ncmd_ws_add ${args}\n`);
    const raw = h.sh(`${TIMEOUT_BIN} 20 bash ${JSON.stringify(script)} 2>&1; echo "__rc=$?"`,
      { CCD_WS_SLUG: slug });
    const m = /__rc=(\d+)$/.exec(raw)!;
    return { out: raw.slice(0, m.index).trim(), rc: Number(m[1]) };
  };

  it('binds the project from a flag-stripped argv — the dec no longer lands in the slug', () => {
    // D-410's own shape, with the flags LEADING: before the loop, `--surface`
    // bound as the PROJECT (`_ws_project_valid` allows `A-Za-z0-9._-`, so it
    // passed) and the verb died `not a git repo: …/projects/--surface`.
    h.makeRepo('demo');
    const r = wsAdd(`--surface agent --actor 'run:7 dispatch' demo`);
    expect(r.rc, r.out).toBe(0);
    expect(h.reg('demo-quiet-mesa', 'uuid'), 'the workspace was never created').not.toBeNull();
    expect(h.reg('demo-quiet-mesa', 'workspace')).toBe('quiet-mesa');
  });

  it('accepts them in the composed order the dispatch path sends — the dec rides LAST', () => {
    // The argv `wsAddWorker` composes: `['ws-add','--no-rc',p,…decFlags(dec)]`.
    // This is the exact call that refused `invalid slug '--surface'`, and it is
    // why the loop has to accept a flag ANYWHERE rather than only at the head.
    h.makeRepo('demo');
    const r = wsAdd(`--no-rc demo --surface agent --actor 'run:7 dispatch'`);
    expect(r.rc, r.out).toBe(0);
    expect(h.reg('demo-quiet-mesa', 'uuid'), 'the workspace was never created').not.toBeNull();
    // `--no-rc` folded INTO the loop must still mean what it meant: the
    // per-session stamp (task #37) is the dispatch path's other declaration,
    // and losing it would put an RC pane under a dispatched worker.
    expect(h.reg('demo-quiet-mesa', 'rc')).toBe('off');
  });

  it('accepts the equals forms its sibling verbs accept, value and all', () => {
    // Not merely "does not die": the `${1#--surface=}` strip is what the
    // journal assertion below measures, so a mutant arm that set the flag
    // GIVEN without taking its value would red here rather than pass for the
    // half-right reason.
    h.makeRepo('demo');
    const r = wsAdd(`--surface=agent --actor='run:7 dispatch' demo`);
    expect(r.rc, r.out).toBe(0);
    const [e] = eventsOf(h.home, 'create');
    expect(e, 'ws-add wrote no create line').toBeTruthy();
    expect(decOf(e!)['surface']).toBe('agent');
    expect(decOf(e!)['actor']).toBe('run:7 dispatch');
  });

  it('refuses a blank --actor, and refuses it before anything is created', () => {
    // `cmd_ws_hold`'s rule (ccd:3742-3745), for its reason: `_lc_dec_ok` is
    // LENGTH-ONLY, so `_lc_dec_ok ''` returns 0 and cannot be the blank guard.
    // A declared-but-unsayable actor is not a declaration, and this verb
    // refuses one where it can still leave the box exactly as it found it.
    h.makeRepo('demo');
    const r = wsAdd(`--actor '   ' demo`);
    expect(r.rc).toBe(1);
    expect(r.out).toContain('--actor must be non-blank');
    expect(h.reg('demo-quiet-mesa', 'uuid'), 'the refusal must precede the worktree').toBeNull();
    expect(fs.existsSync(path.join(h.home, 'worktrees', 'demo'))).toBe(false);
  });

  it('refuses a valueless --surface or --actor with a usage line rather than looping forever', () => {
    // THE ARITY CHECK, STATED AS A TEST. `[[ $# -ge 2 ]]` before each
    // `shift 2` is not defensive dressing: ccd has no `set -e`, so a shift
    // past the end of argv shifts nothing and the loop cannot terminate. rc
    // 124 is `timeout`'s, and it is asserted SEPARATELY from the usage line so
    // a regression that hangs reads as a hang instead of as a wrong message.
    h.makeRepo('demo');
    for (const flag of ['--surface', '--actor']) {
      const r = wsAdd(`demo ${flag}`);
      expect(r.rc, `${flag} with no value never terminated — the arity check is gone`).not.toBe(124);
      expect(r.rc).toBe(1);
      expect(r.out, `${flag} with no value did not refuse with a usage line`)
        .toContain('usage: ccd ws-add');
      expect(h.reg('demo-quiet-mesa', 'uuid')).toBeNull();
    }
  });

  it('the create row carries what was DECLARED, beside what was measured', () => {
    // Parsing without threading would be ceremony: the point of the flags is
    // that the lifecycle journal stops recording every dispatched spawn as
    // *declared: nothing*.
    h.makeRepo('demo');
    const r = wsAdd(`--no-rc demo --surface agent --actor 'run:7 dispatch'`);
    expect(r.rc, r.out).toBe(0);
    const [e] = eventsOf(h.home, 'create');
    expect(e, 'ws-add wrote no create line').toBeTruthy();
    expect(decOf(e!)['surface']).toBe('agent');
    expect(decOf(e!)['actor']).toBe('run:7 dispatch');
    // The measured half is untouched — the dec is an ADDITION to this row, not
    // a replacement of the six fields it already carried.
    expect(measOf(e!)['project']).toBe('demo');
    expect(measOf(e!)['workspace']).toBe('quiet-mesa');
    expect(measOf(e!)['branch']).toBe('ws/quiet-mesa');
  });

  it('a DECLARED surface that is blank or unmodelled reads `unknown`, never `none`', () => {
    // THREE STATES, THREE ANSWERS (`_lc_surface_norm`, ccd:1513-1527, D-210):
    // `none` means nobody declared one, `unknown` means a word arrived and this
    // build does not model it. `_lc_surface_norm ''` prints EMPTY rather than
    // `unknown` — it cannot tell "no argument" from "an explicit blank" — so
    // the `${lc_w:-unknown}` fallback in the loop is the ONLY thing standing
    // between a declared blank and the encoder's `none` backfill, i.e. between
    // this row and the given/no-flag collapse.
    //
    // MEASURED (see the absence case below for why this one carries the
    // weight): deleting `:-unknown` reds this and nothing else in the file.
    h.makeRepo('demo');
    expect(wsAdd(`--surface '' demo`, 'quiet-mesa').rc).toBe(0);
    expect(decOf(eventsOf(h.home, 'create')[0]!)['surface']).toBe('unknown');
    expect(wsAdd(`--surface wharf demo`, 'still-lake').rc).toBe(0);
    expect(decOf(eventsOf(h.home, 'create')[1]!)['surface']).toBe('unknown');
  });

  it('an UNDECLARED ws-add gains no actor at all — absence permits', () => {
    // The whole `dec` object, not `not.toHaveProperty('actor')`: an ADDITION
    // is as visible as a change. `surface: 'none'` is the ENCODER's backfill
    // for a row that declared none (`dec.setdefault("surface","none")`,
    // ccd:1347).
    //
    // MEASURED, AND THE MEASUREMENT IS WORTH RECORDING: this case is defended
    // by TWO guards that are redundant with each other, so neither is
    // observable ALONE. `_lc_json` drops any pair whose value is `""`
    // (ccd:1337-1338), which is why `cmd_ws_hold` can emit its three pairs
    // unconditionally — so emitting `dec.actor ""` here reds nothing (28/28
    // still green), and dropping the `(( lc_gs ))` guard on the surface
    // normalisation reds nothing either (28/28), because the conditional
    // array never lets the resulting `unknown` reach the encoder. Remove BOTH
    // and this goes red on `surface: 'unknown'`. The conditional array is
    // therefore belt to the encoder's braces, kept because it says what it
    // means rather than depending on a downstream drop — and the guard that
    // IS singly pinned is the `${lc_w:-unknown}` fallback, above.
    h.makeRepo('demo');
    const r = wsAdd('demo');
    expect(r.rc, r.out).toBe(0);
    const [e] = eventsOf(h.home, 'create');
    expect(e, 'ws-add wrote no create line').toBeTruthy();
    expect(decOf(e!)).toEqual({ surface: 'none' });
    expect(measOf(e!)['workspace']).toBe('quiet-mesa');
  });

  it('every pre-existing call form still works, and still names the workspace it used to', () => {
    // The plan's global constraint, said once as a mechanism: the four shapes
    // that existed before the loop must be byte-identical afterwards. A loop
    // that swallowed a positional would show up HERE as a workspace under the
    // wrong name, and `_ws_slug_valid`'s leading `[a-z0-9]` is what makes the
    // swallow impossible — no legitimate slug can begin with `-`.
    h.makeRepo('demo');
    expect(wsAdd('demo', 'quiet-mesa').rc).toBe(0);
    expect(h.reg('demo-quiet-mesa', 'workspace')).toBe('quiet-mesa');
    expect(h.reg('demo-quiet-mesa', 'rc'), 'a plain ws-add stamps no rc field').toBeNull();

    expect(wsAdd('demo river-bend').rc).toBe(0);
    expect(h.reg('demo-river-bend', 'workspace')).toBe('river-bend');

    expect(wsAdd('--no-rc demo', 'still-lake').rc).toBe(0);
    expect(h.reg('demo-still-lake', 'workspace')).toBe('still-lake');
    expect(h.reg('demo-still-lake', 'rc')).toBe('off');

    expect(wsAdd('--no-rc demo cold-fen').rc).toBe(0);
    expect(h.reg('demo-cold-fen', 'workspace')).toBe('cold-fen');
    expect(h.reg('demo-cold-fen', 'rc')).toBe('off');
  });
});
