// 3893's RESIDUAL, CLOSED (workspace lifecycle wave 3b's precondition; spec 2026-09-24 §5.3, "A return during an
// expiry refuses, on every path"). The return verbs — `start`, `enable`, `ensure` (in a unit and out) and `swap` —
// asked the reap gate (`_ws_expire_refuse_return`) and RELEASED it before their own journal line, so an expiry that
// took the lock inside that gap tore the workspace down while the return went on to journal itself `done` (and a
// minutes-long `swap` wrote registry fields onto the purged row). Now the return CLEARS THE ARCHIVE INSIDE THE GATE:
// while it holds `$REG/.reap-<id>.lock`, an archived row is unarchived (journaled `unarchive`, as `_spawn_start`
// journals it), so an expiry that takes the lock next refuses `not-archived` and touches nothing.
//
// THE INTERLEAVING IS FORCED, not hoped for: `_ws_expire_return_gap` is the seam ccd calls right after the gate is
// released — a no-op on the box — and each case here redefines it to run a REAL expiry (`ws-audit --expire`, then
// `ws-expire` with the audit's token) in a child process, exactly where a concurrent sweep would land. ws-restore is
// not here: it holds the same lock from its check through its unarchive (`cmd_ws_restore`), so it has no gap.
// FIXTURE HOME ONLY: the expiry is destructive, and every unit and pane call is recorded, never made.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD } from './ccdWsHelpers.js';
import { eventsOf, measOf } from './lifecycleHelpers.js';
import { CHILD_ENV } from './childReclaimFixture.js';
import { EXP_ID, EXP_STUBS, makeArchived, type Archived } from './wsExpireFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ws-expire-race-'); });
afterEach(() => { h.cleanup(); });

/** The return verb's own spawn, stopped at the pane: the fixture's tmux model answers every `new-session` with a
 *  failure, so nothing is ever created; `sleep` and the first-run prompts are no-ops, and there is no systemctl. */
const RETURN_STUBS = 'sleep() { :; }; _accept_first_run_prompts() { return 0; }; _have_systemctl() { return 1; };';

/** THE GAP, FORCED: a real expiry, in a child process, between the gate and the return's journal line. Its audit
 *  document and its verb's answer are written to the HOME for the case to read. */
const GAP = `_ws_expire_return_gap() { ( ${CHILD_ENV};`
  + ` cmd_ws_audit --session ${EXP_ID} --expire > "$HOME/gap-audit.json" 2>/dev/null;`
  + ' tok=$(python3 -c \'import json,sys; print(json.load(open(sys.argv[1])).get("token",""))\' "$HOME/gap-audit.json" 2>/dev/null);'
  + ` if [[ -n "$tok" ]]; then cmd_ws_expire --expect "$tok" --session ${EXP_ID} > "$HOME/gap-expire.json" 2>&1; fi ); };`;

const auditVerdict = (): string =>
  String((JSON.parse(fs.readFileSync(path.join(h.home, 'gap-audit.json'), 'utf8')) as { verdict?: unknown }).verdict);

/** Runs a return verb with the gap forced, answering instead of throwing. */
const ret = (snippet: string): { code: number; out: string } => {
  const r = h.run(`${EXP_STUBS} ${RETURN_STUBS} ${GAP} ${snippet} 2>&1`);
  return { code: r.code, out: r.stdout + r.stderr };
};

/** The expiry in the gap took nothing: the row, its worktree and its branch stand, nothing was expired, and the
 *  gap's audit read the row as no longer archived. */
const survived = (a: Archived): void => {
  expect(auditVerdict(), 'the expiry in the gap found the row returned').toBe('not-archived');
  expect(fs.existsSync(path.join(h.home, 'gap-expire.json')), 'no ws-expire was ever composed').toBe(false);
  expect(h.reg(EXP_ID, 'uuid'), 'the registry row stands').not.toBeNull();
  expect(fs.existsSync(a.wt), 'the worktree stands').toBe(true);
  expect(eventsOf(h.home, 'expire').filter((e) => e['outcome'] === 'done'), 'nothing was expired').toEqual([]);
  expect(h.reg(EXP_ID, 'archived'), 'the archive was cleared by the return').toBeNull();
};

/** The archive was cleared by the RETURN, inside its gate, and journaled as `_spawn_start` journals it. */
const unarchivedBy = (verb: string): void => {
  const un = eventsOf(h.home, 'unarchive').filter((e) => e['outcome'] === 'done');
  expect(un, 'one unarchive').toHaveLength(1);
  expect(un[0]!['verb'], 'journaled under the return verb').toBe(verb);
  expect(measOf(un[0]!)['archivedAt'], 'with the archive it ended').toMatch(/^[1-9][0-9]+$/);
};

describe('3893: an expiry forced into the gap between a return\'s gate and its journal line takes nothing', () => {
  it('start <id>', () => {
    const a = makeArchived(h);
    ret(`cmd_start ${EXP_ID}`);
    survived(a);
    unarchivedBy('start');
  }, 120_000);

  it('enable <id> — which journals `enable` before it reaches start', () => {
    const a = makeArchived(h);
    ret(`cmd_enable ${EXP_ID}`);
    survived(a);
    unarchivedBy('enable');
  }, 120_000);

  it('ensure, outside a unit — what Revive, attach and menu reach', () => {
    const a = makeArchived(h);
    ret(`cmd_ensure ${EXP_ID}`);
    survived(a);
    unarchivedBy('ensure');
  }, 120_000);

  it('ensure in its unit — the supervise ExecStart\'s path', () => {
    const a = makeArchived(h);
    ret(`CCD_IN_UNIT=1 cmd_ensure ${EXP_ID}`);
    survived(a);
    unarchivedBy('ensure');
  }, 120_000);

  it('swap — a slow swap never writes registry fields onto a purged row', () => {
    const a = makeArchived(h);
    const wrapper = h.reg(EXP_ID, 'wrapper');
    const target = wrapper === 'claude-b' ? 'claude-a' : 'claude-b';
    ret(`cmd_swap ${EXP_ID} ${target}`);
    survived(a);
    unarchivedBy('swap');
    // Whatever the swap went on to do in this fixture, it did it to a row that still has its identity.
    expect(h.reg(EXP_ID, 'workdir'), 'the row is whole').toBe(a.wt);
  }, 120_000);

  it('the CONTROL: the forced gap is a REAL expiry — run on an archived row no return has touched, it expires it', () => {
    const a = makeArchived(h);
    h.run(`${EXP_STUBS} ${GAP} _ws_expire_return_gap 2>&1`);
    expect(auditVerdict()).toBe('expirable');
    expect(fs.readFileSync(path.join(h.home, 'gap-expire.json'), 'utf8')).toContain(`"expired":"${EXP_ID}"`);
    expect(h.reg(EXP_ID, 'uuid'), 'the row is gone').toBeNull();
    expect(fs.existsSync(a.wt), 'and its worktree').toBe(false);
  }, 120_000);
});

describe('the seam and the call sites', () => {
  const src = fs.readFileSync(CCD, 'utf8');
  const bodyOf = (name: string): string => {
    const from = src.indexOf(`\n${name}() {`);
    return src.slice(from, src.indexOf('\n}\n', from));
  };

  it('`_ws_expire_return_gap` is a no-op on the box, defined once, and called after the gate is released', () => {
    expect([...src.matchAll(/^_ws_expire_return_gap\(\) \{/gm)], 'defined once').toHaveLength(1);
    expect(src).toMatch(/^_ws_expire_return_gap\(\) \{ :; \}/m);
    const body = bodyOf('_ws_expire_refuse_return');
    expect(body.indexOf('_ws_expire_return_gap "$1"'), 'called').toBeGreaterThan(body.indexOf('_ws_expire_spawn_release'));
    expect(body.indexOf('_ws_unarchive "$1"'), 'the archive is cleared before the lock is given back')
      .toBeLessThan(body.indexOf('_ws_expire_spawn_release'));
  });

  it('every return verb names itself to the gate, before its journal line', () => {
    for (const [verb, word, act] of [['cmd_start', 'start', '_lc_done start'], ['cmd_ensure', 'ensure', '_lc_done ensure'],
      ['cmd_swap', 'swap', '_lc_done swap'], ['cmd_enable', 'enable', '_lc_done enable']] as const) {
      const body = bodyOf(verb);
      const ask = body.indexOf(`_ws_expire_refuse_return "$id" ${word}`);
      expect(ask, `${verb} asks, naming itself`).toBeGreaterThan(0);
      expect(ask, `${verb} asks before it journals`).toBeLessThan(body.indexOf(act));
    }
  });
});
