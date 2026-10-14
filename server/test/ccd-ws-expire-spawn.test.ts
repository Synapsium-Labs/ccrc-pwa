// A RETURN DURING AN EXPIRY REFUSES (workspace lifecycle spec 2026-09-24 §5.3), on every path that creates a pane.
//
// THE CENSUS, measured: a session's pane is created by `_spawn_start` and nowhere else (`_tmux_new_session`'s callers
// are `_spawn_start` and `cmd_account_pane`, whose pane is an account's, not a session's). Its callers are `cmd_start`,
// `cmd_ensure` (in a unit — the `supervise` ExecStart's path — and outside one), `_supervised_start`'s two unsupervised
// fallbacks, `cmd_ws_restore` and `cmd_ws_add`; `cmd_swap`, `cmd_attach`, `cmd_menu` and the server's Revive reach it
// through `cmd_ensure`, `cmd_supervise` through `cmd_ensure` in its unit, `cmd_enable` (which journals `enable` first)
// through `cmd_start`, `cmd_swap_self` through `cmd_swap`, and `_swap_refuse` through a unit start or `cmd_ensure`.
// NONE of them honoured a breadcrumb before this wave: only `ws-restore` took the reap lock. So each RETURN VERB refuses
// the breadcrumb itself before it journals its act (`_ws_expire_refuse_return` in `cmd_start`, `cmd_ensure`, `cmd_swap`,
// `cmd_enable`), `ws-restore` — which clears the archive
// BEFORE it calls `_spawn_start` — asks it under its lock, and `_spawn_start`'s own gate (`_ws_expire_spawn_gate`) is
// the backstop under all of them. `ws-add` honours it by construction: a standing `.reaping` keeps the slug taken.
// Two windows: after a crash the `expire:` breadcrumb stands (refused by it); during the act the expiry holds the reap
// lock and `.archived` still stands (a spawn that would clear the stamp takes that lock first, and refuses).
// FIXTURE HOME ONLY.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, WS_ADD, CCD, type CcdHarness } from './ccdWsHelpers.js';
import { eventsOf, refusalsOf } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ws-expire-spawn-'); });
afterEach(() => { h.cleanup(); });

const ID = 'proj-quiet-dune';
/** The real `_spawn_start`, stopped at the pane: the gate runs BEFORE `tname=$(_tmux …)`, so a tmux that always
 *  fails still exercises it — and its record says whether anything asked tmux for a pane at all. */
const SPAWN_STUBS = 'sleep() { :; }; tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; };'
  + ' _accept_first_run_prompts() { return 0; }; _have_systemctl() { return 1; };';
const reg = (field: string): string => path.join(h.home, '.cc-sessions', `${ID}.${field}`);
const exists = (field: string): boolean => fs.existsSync(reg(field));
const tmuxCalls = (): string[] => {
  const f = path.join(h.home, 'ccd-calls');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.startsWith('tmux new-session')) : [];
};

/** An archived workspace, as `ws-archive` leaves it. */
const archived = (): void => {
  h.makeRepo('proj');
  h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-dune cmd_ws_add proj`);
  fs.writeFileSync(reg('archived'), '1786431390\n');
  fs.writeFileSync(reg('archivedreason'), 'operator\n');
  fs.writeFileSync(reg('archivemanifest'), '{"paths":[]}\n');
};
/** An expiry that died after its pin phase: the `expire:` breadcrumb stands; `.archived` does too. */
const interruptedExpiry = (phase = 'worktree'): void => { fs.writeFileSync(reg('reaping'), `expire:${phase}\n`); };
/** Runs `snippet` with the stubs, answering instead of throwing. */
const run = (snippet: string): { code: number; out: string } => {
  try { return { code: 0, out: h.sh(`${SPAWN_STUBS} ${snippet} 2>&1`) }; } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${String(err.stdout ?? '')}${String(err.stderr ?? '')}` };
  }
};
/** The archive and the breadcrumb both stand, no pane was asked for, and no return was journaled — not even the
 *  attempt: a `start`/`ensure`/`swap` row the instrument would pair with the archive as a return seven days late
 *  (`deploy/measure-workspace-lifecycle.py`, spec §9's kill rule). */
const untouched = (): void => {
  expect(exists('archived'), 'the archive stamp stands').toBe(true);
  expect(exists('archivedreason'), 'and all of it').toBe(true);
  expect(tmuxCalls(), 'no pane was created').toEqual([]);
  for (const act of ['unarchive', 'start', 'ensure', 'swap', 'restore', 'enable']) {
    expect(eventsOf(h.home, act).filter((e) => e['outcome'] === 'done'), `no ${act} journaled`).toEqual([]);
  }
};

describe('after a crash: the `expire:` breadcrumb refuses every spawn path', () => {
  it('_spawn_start itself — the one place a session pane is made', () => {
    archived(); interruptedExpiry();
    const r = run(`_spawn_start ${ID} resume`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(`${ID} is being expired`);
    expect(r.out).toContain("'worktree' step");
    untouched();
  });

  it('ensure in its unit — the `supervise` ExecStart’s path, and so every Restart=always respawn', () => {
    archived(); interruptedExpiry('branch');
    const r = run(`CCD_IN_UNIT=1 cmd_ensure ${ID}`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('being expired');
    untouched();
  });

  it('ensure outside a unit — what Revive, swap, attach and menu reach — through `_supervised_start`’s fallback', () => {
    archived(); interruptedExpiry('children');
    const r = run(`cmd_ensure ${ID}`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('being expired');
    untouched();
  });

  it('start <id>', () => {
    archived(); interruptedExpiry('artifacts');
    const r = run(`cmd_start ${ID}`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('being expired');
    untouched();
  });

  it('swap — refused before it moves the transcript or journals the swap', () => {
    archived(); interruptedExpiry();
    const wrapper = h.sh(`_reg_get ${ID} wrapper`);
    const target = wrapper === 'claude-b' ? 'claude-a' : 'claude-b';
    const r = run(`cmd_swap ${ID} ${target}`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('being expired');
    expect(h.sh(`_reg_get ${ID} wrapper`), 'the account did not move').toBe(wrapper);
    untouched();
  });

  it('enable <id> — the alias of start the server composes, refused before it journals `enable`', () => {
    archived(); interruptedExpiry();
    const r = run(`cmd_enable ${ID}`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('being expired');
    untouched();
  });

  it('an ARCHIVED row whose breadcrumb stands but cannot be read refuses too — at `_spawn_start` and at ws-restore', () => {
    archived();
    fs.mkdirSync(reg('reaping'));
    const r = run(`_spawn_start ${ID} resume`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('cannot be read');
    untouched();
    const s = run(`cmd_ws_restore --session ${ID}`);
    expect(s.code).not.toBe(0);
    expect(s.out).toContain('cannot be read');
    untouched();
  });

  it('ws-add never mints a row over a standing breadcrumb — the slug is taken while any file of the id stands', () => {
    h.makeRepo('proj');
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${ID}.reaping`), 'expire:artifacts\n');
    const r = run(`${WS_ADD} CCD_WS_SLUG=quiet-dune cmd_ws_add proj`);
    expect(r.code).not.toBe(0);
    expect(exists('uuid'), 'no row was minted under the id').toBe(false);
  });

  it('ws-restore — refused in-progress under the lock it takes, before it clears anything', () => {
    archived(); interruptedExpiry();
    const r = run(`cmd_ws_restore --session ${ID}`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('being expired');
    untouched();
    expect(refusalsOf(h.home)).toContainEqual({ act: 'restore', token: 'in-progress' });
  });

  it('a `reclaim:` or ws-reap breadcrumb is NOT this gate’s — those spawn paths behave as they did', () => {
    archived();
    fs.writeFileSync(reg('reaping'), 'worktree\n');
    run(`_spawn_start ${ID} resume`);
    expect(exists('archived'), 'the spawn cleared the archive, as it always has').toBe(false);
  });
});

describe('during the act: a spawn that would clear the archive takes the reap lock first, and refuses while it is held', () => {
  it('another process holds `$REG/.reap-<id>.lock` (an expiry between its ladder and its last deletion) — refused, nothing cleared', () => {
    archived();
    const r = run(`exec 9>>"$HOME/.cc-sessions/.reap-${ID}.lock"; flock -n 9; _spawn_start ${ID} resume`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('still holds the lock');
    untouched();
  });

  it('the same for ensure in its unit', () => {
    archived();
    const r = run(`exec 9>>"$HOME/.cc-sessions/.reap-${ID}.lock"; flock -n 9; CCD_IN_UNIT=1 cmd_ensure ${ID}`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('still holds the lock');
    untouched();
  });

  it('the CONTROL: nobody holds it — the spawn clears the archive as before, and gives the lock back IN ITS OWN PROCESS', () => {
    archived();
    // Asked in the SAME shell, after the spawn: a lock leaked by `_spawn_start` stays held by this process's open
    // descriptor and refuses a second open's `flock -n` — the shape of `cmd_supervise`, one process for the unit's
    // life, which would otherwise hold every row it ever unarchived against every later reap, expiry and restore.
    // (A second process would see it free whatever happened: the descriptor dies with the shell.)
    const out = run(`_spawn_start ${ID} resume; exec 8>>"$HOME/.cc-sessions/.reap-${ID}.lock"; flock -n 8 && echo FREE || echo HELD`).out;
    expect(exists('archived')).toBe(false);
    expect(eventsOf(h.home, 'unarchive')).toHaveLength(1);
    expect(out.trim().split('\n').pop(), 'released, not leaked').toBe('FREE');
  });

  it('the CONTROL: a row that is NOT archived takes no lock at all — a held lock refuses nothing there', () => {
    h.makeRepo('proj');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-dune cmd_ws_add proj`);
    const r = run(`exec 9>>"$HOME/.cc-sessions/.reap-${ID}.lock"; flock -n 9; _spawn_start ${ID} resume`);
    expect(r.out).not.toContain('still holds the lock');
    expect(tmuxCalls().length, 'it went on to ask tmux for the pane').toBeGreaterThan(0);
  });
});

describe('the census holds — no session pane is made outside the gated function', () => {
  const src = fs.readFileSync(CCD, 'utf8');
  /** The function each non-comment line belongs to (top-level `name() {` openers). */
  const owners = (re: RegExp): string[] => {
    let fn = '-';
    const out: string[] = [];
    for (const line of src.split('\n')) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\(\) *\{/.exec(line);
      if (m) fn = m[1]!;
      if (!/^\s*#/.test(line) && re.test(line)) out.push(fn);
    }
    return out;
  };

  it('`_tmux_new_session` is called from `_spawn_start` and from `cmd_account_pane` (an account’s pane) only', () => {
    expect([...new Set(owners(/_tmux_new_session /).filter((f) => f !== '_tmux_new_session'))].sort())
      .toEqual(['_spawn_start', 'cmd_account_pane']);
    expect(owners(/(^|[^_])tmux new-session/).filter((f) => f !== '_tmux_new_session'), 'no bare tmux new-session elsewhere').toEqual([]);
  });

  it('every return verb refuses the breadcrumb itself BEFORE it journals its act', () => {
    const bodyOf = (name: string): string => {
      const from = src.indexOf(`\n${name}() {`);
      return src.slice(from, src.indexOf('\n}\n', from));
    };
    for (const [verb, act] of [['cmd_start', '_lc_done start'], ['cmd_ensure', '_lc_done ensure'], ['cmd_swap', '_lc_done swap'],
      ['cmd_enable', '_lc_done enable']] as const) {
      const body = bodyOf(verb);
      const ask = body.indexOf('_ws_expire_refuse_return "$id"');
      expect(ask, `${verb} asks`).toBeGreaterThan(0);
      expect(ask, `${verb} asks before it journals`).toBeLessThan(body.indexOf(act));
    }
    expect(bodyOf('cmd_ws_restore').indexOf('_ws_expire_breadcrumb_why "$id"'), 'ws-restore asks under its lock')
      .toBeGreaterThan(bodyOf('cmd_ws_restore').indexOf('flock -n "$lfd"'));
    expect(owners(/(^|[^_a-z])cmd_ensure "\$id"/), 'supervise, swap, attach and menu reach a pane through ensure')
      .toEqual(expect.arrayContaining(['cmd_supervise', 'cmd_swap', 'cmd_attach', 'cmd_menu']));
  });

  it('`_spawn_start` asks the gate BEFORE it clears the archive and before its first pane', () => {
    const body = src.slice(src.indexOf('_spawn_start() {'), src.indexOf('\n}\n', src.indexOf('_spawn_start() {')));
    const gate = body.indexOf('_ws_expire_spawn_gate "$id"');
    expect(gate, 'the gate is called').toBeGreaterThan(0);
    expect(gate).toBeLessThan(body.indexOf('_ws_unarchive "$id"'));
    expect(gate).toBeLessThan(body.indexOf('_tmux_new_session'));
    expect(body.indexOf('_ws_expire_spawn_release')).toBeGreaterThan(body.indexOf('_ws_unarchive "$id"'));
  });
});
