// `--route <field>=<value>` on the three verbs that MINT a session — `ws-add`,
// `start` and (by forwarding) `enable` — plus the coordinator row an operator
// spawn gets when it names no field at all (routing spec 2026-09-14 §5.3 for
// the dispatch wave, §4 for the operator spawn).
//
// THE THREE THINGS THIS FILE PINS THAT NOTHING ELSE CAN:
//   1. The refusal lands BEFORE any side effect. `cmd_route` refuses against a
//      row that already exists; these verbs refuse against a box that must be
//      left exactly as it was found — no worktree, no registry row, no pane.
//   2. `--no-rc` without `--route` writes NOTHING. A dispatched worker's spawn
//      line has to stay byte-identical to a pre-slice-1 one, and the only way
//      to say so is to look at the composed argv.
//   3. The coordinator row is seeded on EVERY lane (controller ruling R1,
//      honouring S1-R10): the class alias IS honoured on a codex lane — the
//      slice-4 probe measured `--model fable` resolving through that lane's
//      own `ANTHROPIC_DEFAULT_FABLE_MODEL` (research doc §6, row `S1-R10,
//      slice 4`) — so the row is not gated on the backend. What degrades such
//      a session is the SERVICEABILITY rule, not the alias.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  CCD, ghContainedEnv, makeCcdHarness, seedAccountsSh, WS_ADD_REAL_SPAWN, type CcdHarness,
} from './ccdWsHelpers.js';
import { decOf, eventsOf } from './lifecycleHelpers.js';
import { DEFAULT_TEST_ROSTER } from './helpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-route-argv-'); h.makeRepo('demo'); });
afterEach(() => { h.cleanup(); });

/** `h.sh`, minus the two things that make it unable to see a fatal `die`: it
 *  throws on non-zero, and it gives back no status. Nothing may wrap the
 *  snippet — `$( )` or `( )` would demote the `exit` and the assertion would
 *  pass either way (`ccd-spawn-split.test.ts`'s rule). */
const shStatus = (snippet: string, boundSec?: number): { status: number; out: string } => {
  // `boundSec` puts a WALL CLOCK around the snippet, for the one assertion that
  // is about a loop terminating at all: ccd runs under `set -uo pipefail` with
  // no `-e`, so a `--route` arm that shifted before it read its value would
  // shift nothing and spin for ever — and a spinning test is a hung suite, not
  // a failure. `timeout` exits 124, which is not the 1 those cases assert.
  const bash = ['bash', '-c', `source "${CCD}"; exec 2>&1; ${snippet}`];
  const argv = boundSec === undefined ? bash : ['timeout', String(boundSec), ...bash];
  try {
    const out = execFileSync(argv[0]!, argv.slice(1),
      { encoding: 'utf8', cwd: h.home,
        env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }) });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number | null; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
};

const newSessions = (): string[] => h.calls().filter((c) => c.startsWith('tmux new-session'));
/** The argv `_spawn_start` composed, out of the recorded `tmux new-session` line. */
const composed = (line: string): string => {
  const m = /^tmux new-session -d -s \S+ -x \d+ -y \d+ (.*)$/.exec(line);
  expect(m, line).not.toBeNull();
  return m![1]!;
};
const routeRows = (): Record<string, unknown>[] => eventsOf(h.home, 'route');
const swapLines = (): string[] => {
  const p = path.join(h.home, '.cc-sessions', 'swap.log');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter((l) => l !== '') : [];
};
/** The `route <id>: <field> <old> -> <new>` lines `_route_argv_write` appends,
 *  timestamp stripped. THE JOURNAL IS NOT THIS FILE: `_lc_done` writes a JSON
 *  row and this writes a line of prose, and an assertion on one says nothing
 *  about the other — deleting the `echo` leaves every journal assertion in this
 *  file green. `_route_degrade`'s lines say `degrade <id>:`, so this counts one
 *  writer and not the other. */
const routeLog = (id: string): string[] =>
  swapLines().filter((l) => l.includes(` route ${id}: `))
    .map((l) => l.replace(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d /, ''));
const record = (id: string): (string | null)[] =>
  ['class', 'effort', 'subagent', 'workflow'].map((f) => h.reg(id, f));

/** `WS_ADD`'s spawn stubs with ONE change: a `tmux` that answers `has-session`
 *  NO. The shared constant's blanket `tmux() { :; }` succeeds for every
 *  subcommand, so `_alive` reads every session as live and `cmd_start` takes its
 *  already-running early return — before the mint this file is about. */
const START_SPAWNLESS =
  '_spawn() { :; }; _spawn_start() { SPAWN_FROMSWAP=0; }; _spawn_settle() { :; };'
  + ' _ws_supervise() { :; }; _supervised_start() { :; }; tmux() { return 1; };';

/** START_SPAWNLESS with the ONE fact these cases turn on reversed: the session
 *  probe answers `live`, so `cmd_start` takes its already-running return —
 *  the branch `cmd_enable` aliases through on every session that is UP.
 *  `_have_systemctl` is refused so that branch's boot-persistence reconcile
 *  (`ccd-enable.test.ts`'s subject, not this file's) stays out of the way. */
const START_ALIVE = `${START_SPAWNLESS} _session_probe() { PROBE_VERDICT=live; PROBE_DETAIL=""; };`
  + ' _have_systemctl() { return 1; };';

/** The harness stubs home-able ids only, so an overflow lane has to be
 *  installed before `_account_ok` — or `command -v` on the spawn path — can
 *  see it (`ccd-auto-swap-pool.test.ts`'s own `install()`). */
const install = (w: string): void =>
  fs.writeFileSync(path.join(h.home, '.local', 'bin', w), '#!/bin/sh\n', { mode: 0o755 });

/** DEFAULT_TEST_ROSTER with the codex lane made PLACEABLE — home-able AND not
 *  Anthropic, the configuration `ccd-backend-vs-placement.test.ts` exists for.
 *  Derived from the shared roster so a roster edit moves this with it. */
const GPT_PLACEABLE = {
  version: 1,
  accounts: DEFAULT_TEST_ROSTER.accounts.map((a) => (a.id === 'gpt' ? { ...a, homeAble: true } : a)),
};

describe('--route on ws-add (routing spec §5.3, the dispatch wave)', () => {
  it('ws-add --no-rc --route class=opus --route effort=high: the row carries both fields before the first spawn, journaled with the verb actor', () => {
    h.sh(`${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=quiet-mesa cmd_ws_add --no-rc --route class=opus --route effort=high demo`);
    const id = 'demo-quiet-mesa';
    expect(h.reg(id, 'class')).toBe('opus');
    expect(h.reg(id, 'effort')).toBe('high');
    const rows = routeRows();
    expect(rows).toHaveLength(2);
    expect(decOf(rows[0]!)).toMatchObject({ actor: 'ws-add', reason: 'argv' });
    expect(rows[0]!['detail']).toBe('class: ∅ -> opus');
    expect(rows[1]!['detail']).toBe('effort: ∅ -> high');
    // ONE swap.log LINE PER FIELD, in argv order, carrying the actor and the
    // reason. Nothing else in this file can see this writer.
    expect(routeLog(id)).toEqual([
      `route ${id}: class ∅ -> opus [actor=ws-add] (argv)`,
      `route ${id}: effort ∅ -> high [actor=ws-add] (argv)`,
    ]);
    // The record is written at the MINT, above the spawn, so the very first
    // pane already carries it — not the second settle.
    expect(composed(newSessions()[0]!)).toContain('--model opus');
  });

  it('--route AFTER the positional binds the same row — the strip loop is positionless (the D-410 shape the dispatch argv already uses)', () => {
    // `run-routes.test.ts` and `whitelist-subset.test.ts` both compose
    // `ws-add --no-rc <project> --surface agent --actor '…'`, so the flag AFTER
    // the positional is the shape the dispatcher really sends. Every other case
    // in this file puts `--route` first, which is the shape that could pass
    // while the real one bound `--route` as the project (D-410, one flag left).
    h.sh(`${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=quiet-mesa cmd_ws_add --no-rc demo --route class=opus --route effort=high`);
    const id = 'demo-quiet-mesa';
    expect(h.reg(id, 'class')).toBe('opus');
    expect(h.reg(id, 'effort')).toBe('high');
    expect(h.reg(id, 'project')).toBe('demo');
    expect(routeRows()).toHaveLength(2);
  });

  it('--route as the FINAL token refuses with the usage line rather than hanging', () => {
    // The arity check is what makes this a refusal. Without it `shift 2` past
    // the end of argv shifts nothing and this loop never terminates, so the
    // call is bounded by a wall clock: a hang answers 124, not 1.
    const r = shStatus(`${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=quiet-mesa cmd_ws_add --no-rc demo --route`, 20);
    expect(r.status).toBe(1);
    expect(r.out).toContain('usage: ccd ws-add');
    expect(r.out).toContain('[--route <field>=<value>]...');
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', 'demo-quiet-mesa.uuid'))).toBe(false);
  });

  it('a field given TWICE is refused before anything is minted — placement and the record can never disagree', () => {
    // `_route_argv_class` answers with the FIRST `class=` pair and decides the
    // LANE; `_route_argv_write` writes every pair and the LAST one wins the
    // RECORD. Accepting this argv places a session by `opus` and records
    // `haiku` — a lane chosen for a class the session's own record denies.
    const r = shStatus(`${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=quiet-mesa cmd_ws_add --no-rc --route class=opus --route class=haiku demo`);
    expect(r.status).toBe(1);
    expect(r.out).toContain('--route class given twice — one value per field; nothing was touched');
    expect(record('demo-quiet-mesa')).toEqual([null, null, null, null]);
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', 'demo-quiet-mesa.uuid'))).toBe(false);
    expect(newSessions()).toHaveLength(0);
    expect(swapLines().filter((l) => l.includes(' route '))).toEqual([]);
  });

  it('--actor refuses a control character, so the swap.log line it reaches VERBATIM cannot be forged', () => {
    // `--actor` is free-form caller text and `_route_argv_write` interpolates it
    // raw into `[actor=$actor]`; `$REG/swap.log` is writable by every session on
    // the box. A newline in it appends a second, forged `route …` audit line —
    // which is why `cmd_route` refuses the same bytes (controller ruling S1-R4).
    const wt = h.sh('echo "$WORKTREES_ROOT"');
    const forged = 'route other: class ∅ -> fable [actor=y] (argv)';
    const r = shStatus(`${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=quiet-mesa cmd_ws_add --actor $'x\n2026-01-01 00:00:00 ${forged}' --route class=opus demo`);
    expect(r.status).toBe(1);
    expect(r.out).toContain('ws-add: --actor must not contain control characters');
    // Before ANY mint: no worktree, no row, no pane — and no log line at all,
    // forged or honest.
    expect(fs.existsSync(path.join(wt, 'demo', 'quiet-mesa'))).toBe(false);
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', 'demo-quiet-mesa.uuid'))).toBe(false);
    expect(record('demo-quiet-mesa')).toEqual([null, null, null, null]);
    expect(newSessions()).toHaveLength(0);
    expect(swapLines().filter((l) => l.includes('route other:'))).toEqual([]);
    expect(swapLines().filter((l) => l.includes(' route '))).toEqual([]);
  });

  it('a bad value dies BEFORE the worktree, the row or the pane exist, naming the field and the byte count, never the bytes', () => {
    const wt = h.sh('echo "$WORKTREES_ROOT"');
    const r = shStatus(`${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=quiet-mesa cmd_ws_add --no-rc --route class=gemini demo`);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/bad value for class \(6 bytes\)/);
    // The value is untrusted bytes from an argv a coordinator composed; the
    // refusal counts them and never renders them.
    expect(r.out).not.toContain('gemini');
    expect(fs.existsSync(path.join(wt, 'demo', 'quiet-mesa'))).toBe(false);
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', 'demo-quiet-mesa.uuid'))).toBe(false);
    expect(newSessions()).toHaveLength(0);
  });

  it('the haiku+effort pair is refused on the argv exactly as cmd_route refuses it', () => {
    const r = shStatus(`${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=quiet-mesa cmd_ws_add --no-rc --route class=haiku --route effort=high demo`);
    expect(r.status).toBe(1);
    expect(r.out).toContain('class haiku takes no effort level');
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', 'demo-quiet-mesa.uuid'))).toBe(false);
  });

  it('a ccd-only field is refused on the argv, before anything is minted', () => {
    const r = shStatus(`${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=quiet-mesa cmd_ws_add --no-rc --route degraded=opus demo`);
    expect(r.status).toBe(1);
    expect(r.out).toContain("'degraded' is written by ccd only");
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', 'demo-quiet-mesa.uuid'))).toBe(false);
  });

  it('a dispatched worker (--no-rc) without --route gets NO row — the spawn line is byte-identical to today', () => {
    h.sh(`${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=quiet-mesa cmd_ws_add --no-rc demo`);
    expect(record('demo-quiet-mesa')).toEqual([null, null, null, null]);
    expect(routeRows()).toHaveLength(0);
    const line = composed(newSessions()[0]!);
    for (const tok of ['--model', '--settings', '--effort', 'CLAUDE_CODE_SUBAGENT_MODEL']) {
      expect(line, tok).not.toContain(tok);
    }
  });

  it('an operator ws-add (no --no-rc, no --route) gets the coordinator row, journaled as the default', () => {
    h.sh(`${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    const id = 'demo-quiet-mesa';
    expect(record(id)).toEqual(['fable', 'ultracode', 'sonnet', 'on']);
    const rows = routeRows();
    expect(rows).toHaveLength(4);
    expect(decOf(rows[0]!)).toMatchObject({ actor: 'spawn', reason: 'coordinator row (default)' });
    // Nothing on this box has measured a Fable share, so `_serviceable` answers
    // UNMEASURED and nobody degrades on a fabricated fact — the intended class
    // is what the first spawn composes.
    expect(h.reg(id, 'degraded')).toBeNull();
    // FOUR swap.log lines, one per field of the row, all four naming the
    // default rather than an argv.
    expect(routeLog(id)).toEqual([
      `route ${id}: class ∅ -> fable [actor=spawn] (coordinator row (default))`,
      `route ${id}: effort ∅ -> ultracode [actor=spawn] (coordinator row (default))`,
      `route ${id}: subagent ∅ -> sonnet [actor=spawn] (coordinator row (default))`,
      `route ${id}: workflow ∅ -> on [actor=spawn] (coordinator row (default))`,
    ]);
    expect(composed(newSessions()[0]!))
      .toContain(`--model fable --settings '{"enableWorkflows":true,"ultracode":true}' --effort ultracode`);
  });

  it('an explicit --route on an operator ws-add wins over the coordinator row, and the DECLARED actor is the one journaled', () => {
    h.sh(`${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=quiet-mesa cmd_ws_add --actor 'run:7 dispatch' --route class=sonnet demo`);
    const id = 'demo-quiet-mesa';
    expect(record(id)).toEqual(['sonnet', null, null, null]);
    const rows = routeRows();
    expect(rows).toHaveLength(1);
    expect(decOf(rows[0]!)).toMatchObject({ actor: 'run:7 dispatch', reason: 'argv' });
  });
});

describe('--route on start and enable (routing spec §5.3)', () => {
  it('start takes --route, writes after the mint, journals with actor start; enable forwards it; an existing row is never re-seeded', () => {
    h.sh(`${START_SPAWNLESS} cmd_start --route subagent=haiku claude demo`);
    expect(h.reg('claude-demo', 'subagent')).toBe('haiku');
    expect(decOf(routeRows()[0]!)).toMatchObject({ actor: 'start', reason: 'argv' });

    // `enable` forwards the pair to `cmd_start` and parses it ONCE, so the
    // route row says `start`; its own `enable` lifecycle row precedes it.
    h.sh(`${START_SPAWNLESS} cmd_enable --route workflow=off claude-a demo`);
    expect(h.reg('claude-a-demo', 'workflow')).toBe('off');
    expect(decOf(routeRows()[1]!)).toMatchObject({ actor: 'start', reason: 'argv' });

    // A second start of an EXISTING session with no --route seeds nothing: the
    // default is for a session being MINTED, never for one being revived.
    h.sh(`${START_SPAWNLESS} cmd_start claude demo`);
    expect(h.reg('claude-demo', 'subagent')).toBe('haiku');
    expect(h.reg('claude-demo', 'class')).toBeNull();
    expect(routeRows()).toHaveLength(2);
  });

  it('start and enable WRITE --route on a session that ALREADY has a row — the pairs are never silently discarded', () => {
    // The overloaded seam this closes: `cmd_start` validated the pairs at the
    // top and wrote them only on the minting arm, so `ccd enable --route
    // class=opus claude demo` against an existing session printed nothing,
    // journaled nothing, wrote nothing and exited 0. "You named fields" and
    // "you named none" are two conditions and a caller handles them
    // differently, so they must not answer alike (controller ruling S4-R3).
    h.sh(`${START_SPAWNLESS} cmd_start --route class=sonnet claude demo`);
    expect(h.reg('claude-demo', 'class')).toBe('sonnet');
    expect(routeRows()).toHaveLength(1);

    h.sh(`${START_SPAWNLESS} cmd_enable --route class=opus claude demo`);
    expect(h.reg('claude-demo', 'class')).toBe('opus');
    const rows = routeRows();
    expect(rows).toHaveLength(2);
    expect(decOf(rows[1]!)).toMatchObject({ actor: 'start', reason: 'argv' });
    // THE OLD VALUE IS READ AND RENDERED, exactly as `cmd_route` renders it —
    // an audit row that said `∅ -> opus` here would claim a first write that
    // did not happen and hide the value it replaced.
    expect(rows[1]!['detail']).toBe('class: sonnet -> opus');
    expect(routeLog('claude-demo')).toEqual([
      'route claude-demo: class ∅ -> sonnet [actor=start] (argv)',
      'route claude-demo: class sonnet -> opus [actor=start] (argv)',
    ]);
  });

  it('enable --route on a LIVE session writes the pairs BEFORE the already-running return (final review finding 2)', () => {
    // S4-R3's fix sat BELOW `cmd_start`'s `if _alive "$id"` return, so the silent
    // drop that ruling was raised to close was still live for the commonest case
    // of all — a session that is UP. `ccd enable --route class=opus claude demo`
    // printed `already running`, wrote nothing, journaled nothing and exited 0,
    // and `POST /api/sessions` renders that exit 0 as `{ok:true}` under the
    // new-session sheet's "Starting …" toast: an operator who set Class in the
    // sheet for a wrapper+project already running watched a write that never
    // happened succeed. Every other case in this file stubs `tmux() { return 1; }`,
    // which is exactly why this one was unpinned BY CONSTRUCTION — `_alive` was
    // never true, so the branch was never entered.
    h.sh(`${START_SPAWNLESS} cmd_start --route class=sonnet claude demo`);
    const r = shStatus(`${START_ALIVE} cmd_enable --route class=opus claude demo`);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('already running: claude-demo');
    expect(h.reg('claude-demo', 'class')).toBe('opus');
    const rows = routeRows();
    expect(rows).toHaveLength(2);
    expect(decOf(rows[1]!)).toMatchObject({ actor: 'start', reason: 'argv' });
    expect(rows[1]!['detail']).toBe('class: sonnet -> opus');
    expect(routeLog('claude-demo')).toEqual([
      'route claude-demo: class ∅ -> sonnet [actor=start] (argv)',
      'route claude-demo: class sonnet -> opus [actor=start] (argv)',
    ]);
  });

  it('the other condition on the same branch: a LIVE session and NO --route writes nothing at all', () => {
    // "You named fields" and "you named none" stay two conditions on this arm
    // too — the revival arm's own rule, stated one branch down. A bare
    // `ccd enable` on a live session is still the pure boot-persistence act it
    // has always been, and must not seed a coordinator row over a record.
    h.sh(`${START_SPAWNLESS} cmd_start --route class=sonnet claude demo`);
    const r = shStatus(`${START_ALIVE} cmd_enable claude demo`);
    expect(r.status, r.out).toBe(0);
    expect(h.reg('claude-demo', 'class')).toBe('sonnet');
    expect(routeRows()).toHaveLength(1);
  });

  it('start refuses a bad value before the registry row exists', () => {
    const r = shStatus(`${START_SPAWNLESS} cmd_start --route effort=turbo claude demo`);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/bad value for effort \(5 bytes\)/);
    expect(r.out).not.toContain('turbo');
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', 'claude-demo.uuid'))).toBe(false);
  });

  it('an operator start with no --route gets the coordinator row on a NON-Anthropic lane too, and the serviceability rule — not the alias — degrades it', () => {
    // Controller ruling R1, on the slice-4 probe (research doc §6, row `S1-R10,
    // slice 4`): `--model <class>` IS honoured on the codex lane and resolves
    // through that lane's own `ANTHROPIC_DEFAULT_<CLASS>_MODEL` keys, so the row
    // is seeded here exactly as it is on an Anthropic lane. What moves the class
    // is slice 3's clause — `_serviceable` answers rc 1 `backend` for `fable` on
    // a lane the roster does not call Anthropic — so the FIRST settle degrades
    // one rung and composes `opus`.
    seedAccountsSh(h.home, GPT_PLACEABLE);
    install('gpt');
    h.sh(`${START_SPAWNLESS} cmd_start gpt demo`);
    expect(record('gpt-demo')).toEqual(['fable', 'ultracode', 'sonnet', 'on']);
    const seeded = routeRows();
    expect(seeded).toHaveLength(4);
    expect(decOf(seeded[0]!)).toMatchObject({ actor: 'spawn', reason: 'coordinator row (default)' });
    expect(h.reg('gpt-demo', 'degraded')).toBeNull();

    h.sh(`${WS_ADD_REAL_SPAWN} _spawn_start gpt-demo resume`);
    expect(h.reg('gpt-demo', 'degraded')).toBe('opus');
    const rows = routeRows();
    expect(rows).toHaveLength(5);
    expect(decOf(rows[4]!)).toMatchObject({ actor: 'ccd' });
    expect(rows[4]!['detail']).toBe('degraded: ∅ -> opus');
    // Slice 1's non-Anthropic arm: the two fields this backend cannot apply are
    // stamped by NAME rather than silently dropped.
    expect(h.reg('gpt-demo', 'inert')).toBe('effort,workflow');
    const line = composed(newSessions()[0]!);
    expect(line).toContain('--model opus');
    for (const tok of ['--settings', '--effort', 'CLAUDE_CODE_SUBAGENT_MODEL']) {
      expect(line, tok).not.toContain(tok);
    }
  });
});

// ── THE PARITY `ccd/ccd`'s HELPER-BLOCK HEADER CLAIMS ───────────────────────
// `_route_argv_check` is `cmd_route`'s validator said a SECOND time, for the
// reason that header gives: `cmd_route` reads the STANDING record to refuse the
// haiku+effort pair across two calls, and there is no standing record at the
// mint. A duplicate nobody measures is a request, not a mechanism — and these
// two had already drifted once, silently, with nothing to say so. This block is
// the mechanism. It derives BOTH copies from the shipped `ccd/ccd`, so a change
// to either side reds here, and it names the single divergence that is meant:
// the two refusals at the mint end `; nothing was touched`, which is a promise
// only a refusal made before any side effect can make.
const CCD_SRC = fs.readFileSync(CCD, 'utf8').split('\n');

/** The statement lines of a top-level shell function — from its `name() {`
 *  header to the `}` in column 0 that closes it — comments and blank lines
 *  dropped, each trimmed, so the comparison is about code and not indentation
 *  or the two bodies' (deliberately different) explanations. */
const bodyOf = (name: string): string[] => {
  const start = CCD_SRC.findIndex((l) => l.startsWith(`${name}() {`));
  expect(start, `${name} not found in ccd/ccd`).toBeGreaterThan(-1);
  const end = CCD_SRC.findIndex((l, i) => i > start && l === '}');
  expect(end, `${name} has no closing brace`).toBeGreaterThan(start);
  return CCD_SRC.slice(start + 1, end).map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
};

/** The one declared divergence, as it appears inside the refusal's own quotes. */
const MINT_PROMISE = '; nothing was touched"';
const undiverge = (l: string): string => l.replace(MINT_PROMISE, '"');

describe('_route_argv_check IS cmd_route\'s validator, measured against the shipped source', () => {
  it('every line the two copies share is byte-identical, and the only divergence is the two refusals\' mint promise', () => {
    const argv = bodyOf('_route_argv_check');
    const verb = bodyOf('cmd_route');
    const verbatim = argv.filter((l) => verb.includes(l));
    const diverged = argv.filter((l) => !verb.includes(l) && verb.includes(undiverge(l)));
    // LITERAL ratchets, never a count computed from the thing under test: a line
    // reworded on EITHER side falls out of both sets, and the number reds.
    expect(verbatim).toHaveLength(11);
    expect(diverged).toHaveLength(2);
    // The substance, named one arm at a time, so a drop cannot hide behind a
    // structural line (`case "$rc" in`, `esac`, `done`) that still matches.
    for (const [what, anchor] of [
      ['the ROUTE_FIELDS check', /^_route_word_in "\$f" /],
      ['the ccd-only refusal', /written by ccd only/],
      ['the three-answer call', /^_route_valid "\$f" "\$v"; rc=\$\?$/],
      ['the unreadable-vocabulary sentence', /roster projection carries no subagent class list/],
    ] as const) {
      expect(verbatim.filter((l) => anchor.test(l)), what).toHaveLength(1);
    }
    // ...and the two that diverge are the two REFUSALS, each diverging by the
    // mint promise and by nothing else (that is what `undiverge` had to strip
    // for them to land in this set at all).
    expect(diverged[0]).toMatch(/die "bad value for \$f /);
    expect(diverged[1]).toMatch(/die "class haiku takes no effort level/);
    for (const l of diverged) expect(l).toContain(MINT_PROMISE);
  });

  it('the lines belonging to the argv copy alone make no refusal cmd_route does not also make', () => {
    const argv = bodyOf('_route_argv_check');
    const verb = bodyOf('cmd_route');
    const only = argv.filter((l) => !verb.includes(l) && !verb.includes(undiverge(l)));
    // The census: the signature, the loop over `$@` (`cmd_route` loops over its
    // collected `--set`s), the well-formedness check that names THIS flag, the
    // given-twice refusal, and the return. A new arm on one side only shows up
    // here and reds.
    //
    // FIVE, NOT FOUR — moved in fix round 2 by the given-twice guard (controller
    // ruling S4-R4), which is deliberately argv-only. `cmd_route` cannot make
    // this refusal and must not: its `--set` pairs feed ONE consumer, the write
    // loop, where last-wins is a coherent answer. Here the same argv feeds two —
    // `_route_argv_class` reads the FIRST `class=` and picks the LANE while the
    // write loop's LAST one wins the RECORD — so a repeat is two answers to one
    // question. The signature line moved with it (`seen=""`), which is why the
    // count is five rather than four plus one.
    expect(only).toEqual([
      `local kv f v rc cls="" eff="" seen=""`,
      `for kv in "$@"; do`,
      `[[ "$kv" == *=* ]] || die "bad --route '$kv' (want <field>=<value>)"`,
      `_route_word_in "$f" "$seen" && die "--route $f given twice — one value per field; nothing was touched"; seen+="$f "`,
      `return 0`,
    ]);
    const dies = only.filter((l) => l.includes('die '));
    expect(dies).toHaveLength(2);
    // The well-formedness refusal is the SAME sentence on both sides, each flag
    // spelled as the caller typed it...
    expect(verb).toContain(dies[0]!.replace('--route', '--set'));
    // ...and the second has no counterpart at all, by the argument above. Said
    // as an assertion so that "no counterpart" stays a measurement: the day
    // `cmd_route` grows its own given-twice arm, this reds and somebody has to
    // decide whether the two are still allowed to differ.
    expect(dies[1]).toContain('given twice');
    expect(verb.some((l) => l.includes('given twice'))).toBe(false);
  });
});
