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
    h.sh('systemctl() { :; }; _ws_unsupervise sess pwa');
    expect(decOf(readJournal(h.home)[0]!)['surface']).toBe('none');
    h.sh('systemctl() { :; }; _ws_unsupervise other');
    expect(decOf(readJournal(h.home)[1]!)['surface']).toBe('none');
  });

  it('carries a DECLARED surface when the third argument says one was declared', () => {
    h.sh('systemctl() { :; }; _ws_unsupervise sess pwa pwa');
    expect(decOf(readJournal(h.home)[0]!)['surface']).toBe('pwa');
  });

  it('records an unrecognised declared word as `unknown`, exactly as ccd:619 does', () => {
    h.sh('systemctl() { :; }; _ws_unsupervise sess unknown wharf');
    expect(decOf(readJournal(h.home)[0]!)['surface']).toBe('unknown');
  });

  it('_reg_claim writes one claim line', () => {
    h.sh('_reg_set sess wrapper claude-corp; _reg_claim sess');
    expect(actsOf(h.home)).toEqual(['claim']);
    expect(readJournal(h.home)[0]!['id']).toBe('sess');
    expect(measOf(readJournal(h.home)[0]!)['wrapper']).toBe('claude-corp');
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
    expect(measOf(spawns[0]!)['rc']).toBe('0');
    expect(measOf(spawns[1]!)['rc']).toBe('3');
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
