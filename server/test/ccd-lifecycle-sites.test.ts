// server/test/ccd-lifecycle-sites.test.ts
//
// STANDING NOTE: this file matches `ccd-workspaces.test.ts:1045`'s
// `/^ccd.*\.ts$/` containment scan; every snippet runs through `h.sh`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { CCD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { actsOf, readJournal, eventsOf, measOf, decOf } from './lifecycleHelpers.js';

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
    // pair needs the pin MORE than that one did: cmd_enable -> cmd_start is
    // the only pair in this plan that runs TWO `_lc_done` calls in ONE
    // process, which is exactly where `_lc_obs`'s once-per-process
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
