// `_place_for_class project class strict` — placement asked WITH a class, and
// the one rung it is allowed to walk down (routing spec §5.4).
//
// Slice 3 gave `_ws_least_loaded` a class positional and `projectHome` a class
// parameter, and measured that NO production caller passed one (research doc,
// row `Fable share by account at slice 3`). This is the caller. It adds exactly
// two things on top of that function:
//
//   - THE RUNG BELOW, and only on a MEASURED emptiness. An `_ws_least_loaded`
//     that answers "" with a class carries three meanings; only one of them —
//     at least one in-pool lane answered `_class_gate` rc 1 — is a fact about
//     the CLASS. An unmeasured lane (rc 2) is placeable and would have been
//     placed, so its presence is never a reason to degrade (spec §5.4: nobody
//     degrades on a fabricated fact).
//   - `strict`. An explicit `--route class=` never falls back; the coordinator
//     row's class, which nobody typed, falls back to today's class-blind rule,
//     so a fleet that placed operator spawns yesterday still places them.
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
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-place-class-'); h.makeRepo('demo'); });
afterEach(() => { h.cleanup(); });

const shStatus = (snippet: string): { status: number; out: string } => {
  try {
    const out = execFileSync('bash', ['-c', `source "${CCD}"; exec 2>&1; ${snippet}`],
      { encoding: 'utf8', cwd: h.home,
        env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }) });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number | null; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
};

const now = (): number => Math.floor(Date.now() / 1000);
const install = (w: string): void =>
  fs.writeFileSync(path.join(h.home, '.local', 'bin', w), '#!/bin/sh\n', { mode: 0o755 });
const writeLimits = (w: string, five: number, seven: number): void =>
  fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`),
    JSON.stringify({ five, seven, ts: now(), fiveResetAt: now() + 10_000, sevenResetAt: now() + 400_000 }));
/** The sweep report `_share_pct` reads, planted exactly as `ccd-serviceable.test.ts` plants it. */
const plantSweep = (estimates: Record<string, number>): void => {
  const sw = path.join(h.home, '.cc-sessions', 'usage', 'sweep');
  fs.mkdirSync(sw, { recursive: true });
  const finishedAt = new Date(now() * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const perAccount = Object.fromEntries(
    Object.entries(estimates).map(([k, v]) => [k, { fableShare: { estimate: v } }]));
  fs.writeFileSync(path.join(sw, 'latest.json'), JSON.stringify({ finishedAt, perAccount }));
};
/** The `route <id>: <field> <old> -> <new>` lines `_route_argv_write` appends to
 *  `$REG/swap.log`, timestamp stripped. The journal rows below are a DIFFERENT
 *  writer (`_lc_done`, JSON), so no assertion on them can see this one;
 *  `_route_degrade`'s line says `degrade <id>:` and is not counted here. */
const routeLog = (id: string): string[] => {
  const p = path.join(h.home, '.cc-sessions', 'swap.log');
  return (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n') : [])
    .filter((l) => l.includes(` route ${id}: `))
    .map((l) => l.replace(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d /, ''));
};
const tagPool = (project: string, pool: string): void => {
  const dir = path.join(h.home, '.cc-sessions', 'pools');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, project), `${pool}\n`);
};

/** `PLACE_DEGRADED_TO` is set by the function, so it cannot be read through the
 *  `$( )` its stdout would need — the snippet prints both, and the delimiter is
 *  `|deg=` because `h.sh` trims and the lane may legitimately be EMPTY. */
const place = (project: string, cls: string, strict: number): { lane: string; deg: string } => {
  const out = h.sh(`_place_for_class ${project} ${cls} ${strict}; echo "|deg=$PLACE_DEGRADED_TO"`);
  const [lane, deg] = out.split('|deg=');
  return { lane: lane!, deg: deg! };
};

/** FLEET A — every home-able lane measured AT the Fable ceiling, every one of
 *  them well under the seven-day ceiling. `fable` is unservable fleet-wide and
 *  `opus` is servable fleet-wide, which is the only shape where the rung below
 *  buys anything. `claude-b` is the cheapest, so the lane the rung lands on is
 *  pinned rather than incidental. */
const fleetAtFableCeiling = (): void => {
  for (const w of ['claude', 'claude-a', 'claude-d']) writeLimits(w, 5, 50);
  writeLimits('claude-b', 5, 10);
  plantSweep({ claude: 0.55, 'claude-a': 0.55, 'claude-b': 0.55, 'claude-d': 0.55 });
};

/** DEFAULT_TEST_ROSTER with the codex lane PLACEABLE and every lane pooled, so
 *  a project tagged `codex` has exactly one candidate. Derived from the shared
 *  roster, never retyped. */
const POOLED = {
  version: 1,
  accounts: DEFAULT_TEST_ROSTER.accounts.map((a) => (a.id === 'gpt'
    ? { ...a, homeAble: true, pool: 'codex' }
    : { ...a, pool: 'main' })),
};
/** Plant a well-formed `$REG/pool-epoch` document — the central projection
 *  `_acct_pool_state` reads (wave 1 Task 1/3) — tagging every account
 *  `POOLED` declares a `pool` for. Added by wave 1 Task 2: `_pool_ok` now
 *  reads the account side through this document, not through `accounts.sh`'s
 *  declared `_ccrc_pool`, so a project tagged via `tagPool` needs a central
 *  projection that agrees with `POOLED`'s declared tags, or every account
 *  reads `unreadable` (no document at all) and placement refuses as
 *  undecidable rather than exercising the class/rung logic these cases are
 *  actually about. Derived from `POOLED` rather than a second hand-typed
 *  copy of the same tags — same discipline `POOLED` itself states. */
const plantPoolEpoch = (): void => {
  const dir = path.join(h.home, '.cc-sessions');
  fs.mkdirSync(dir, { recursive: true });
  const lines = ['epoch 1', 'issued 1', 'lease 9999999999',
    ...POOLED.accounts
      .filter((a): a is typeof a & { pool: string } => typeof a.pool === 'string')
      .map((a) => `acct ${a.id} ${a.pool}`),
    'end', ''];
  fs.writeFileSync(path.join(dir, 'pool-epoch'), lines.join('\n'));
};

/** A pool whose only member is the codex lane: `fable` is unservable there by
 *  BACKEND, before any figure is read, so the rung below is the only answer. */
const gptOnlyPool = (seven: number): void => {
  seedAccountsSh(h.home, POOLED);
  plantPoolEpoch();
  install('gpt');
  tagPool('demo', 'codex');
  writeLimits('gpt', 5, seven);
};

describe('_place_for_class — the class, then the rung below, then strictness', () => {
  it('places at the class when a lane serves it, and stamps no rung', () => {
    writeLimits('claude', 5, 50); writeLimits('claude-a', 5, 50);
    writeLimits('claude-b', 5, 10); writeLimits('claude-d', 5, 50);
    plantSweep({ claude: 0.1, 'claude-a': 0.1, 'claude-b': 0.1, 'claude-d': 0.1 });
    expect(place('demo', 'fable', 1)).toEqual({ lane: 'claude-b', deg: '' });
  });

  it('(a) every in-pool lane at the Fable ceiling: the rung below is placed and named', () => {
    fleetAtFableCeiling();
    expect(place('demo', 'fable', 1)).toEqual({ lane: 'claude-b', deg: 'opus' });
    // strictness governs the FALLBACK, never the rung: a rung that places is
    // the answer for both.
    expect(place('demo', 'fable', 0)).toEqual({ lane: 'claude-b', deg: 'opus' });
  });

  it('(b) one UNMEASURED lane among the rest at the ceiling is placed at the class, not degraded', () => {
    fleetAtFableCeiling();
    // No sweep row for claude-a at all -> `_serviceable` answers unmeasured
    // (rc 2), which `_ws_least_loaded` keeps. It is not the cheapest lane, so
    // the answer can only be the class filter's doing.
    plantSweep({ claude: 0.55, 'claude-b': 0.55, 'claude-d': 0.55 });
    expect(place('demo', 'fable', 1)).toEqual({ lane: 'claude-a', deg: '' });
  });

  it('(c) both rungs unservable: strict refuses, non-strict falls back to today\'s class-blind rule', () => {
    // The codex lane is unservable for `fable` by BACKEND and, at 98, for
    // `opus` by the seven-day ceiling — so no rung places.
    gptOnlyPool(98);
    expect(place('demo', 'fable', 1)).toEqual({ lane: '', deg: '' });
    // Today's rule, unchanged: pressure alone never refuses placement, so the
    // class-blind walk still answers the lane. No rung is claimed, because
    // none was taken.
    expect(place('demo', 'fable', 0)).toEqual({ lane: 'gpt', deg: '' });
  });

  it('a gpt-only pool under the seven-day ceiling takes the rung below for either strictness', () => {
    gptOnlyPool(10);
    expect(place('demo', 'fable', 1)).toEqual({ lane: 'gpt', deg: 'opus' });
    expect(place('demo', 'fable', 0)).toEqual({ lane: 'gpt', deg: 'opus' });
  });

  it('no class at all is today\'s walk, byte for byte', () => {
    fleetAtFableCeiling();
    expect(place('demo', "''", 1)).toEqual({ lane: 'claude-b', deg: '' });
    expect(place('demo', 'default', 1)).toEqual({ lane: 'claude-b', deg: '' });
  });
});

describe('cmd_ws_add places by class and stamps the rung it took', () => {
  it('(d) --route class=fable on a fleet at the ceiling: placed one rung down, stamped AFTER the row exists', () => {
    fleetAtFableCeiling();
    h.sh(`${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=quiet-mesa cmd_ws_add --no-rc --route class=fable demo`);
    const id = 'demo-quiet-mesa';
    expect(h.reg(id, 'wrapper')).toBe('claude-b');
    expect(h.reg(id, 'class')).toBe('fable');       // the INTENDED class is what the record keeps
    expect(h.reg(id, 'degraded')).toBe('opus');     // the class actually served
    const rows = eventsOf(h.home, 'route');
    expect(rows).toHaveLength(2);
    expect(rows[0]!['detail']).toBe('class: ∅ -> fable');
    expect(decOf(rows[1]!)).toMatchObject({ actor: 'ccd' });
    expect(rows[1]!['detail']).toBe('degraded: ∅ -> opus');
    const line = h.calls().filter((c) => c.startsWith('tmux new-session'))[0]!;
    expect(line).toContain('--model opus');
  });

  it('(e) --route class=fable with no rung servable: the verb dies naming the class, and nothing is minted', () => {
    gptOnlyPool(98);
    const r = shStatus(`${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=quiet-mesa cmd_ws_add --no-rc --route class=fable demo`);
    expect(r.status).toBe(1);
    expect(r.out).toContain('gpt:class=fable-unservable');
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', 'demo-quiet-mesa.uuid'))).toBe(false);
    expect(fs.existsSync(path.join(h.home, 'worktrees', 'demo', 'quiet-mesa'))).toBe(false);
  });

  it('an UNMEASURED lane is never named as the reason — it is placeable, and saying otherwise is a fabricated fact', () => {
    // The pool's one lane has no sweep row, so `_class_gate` answers 2. The
    // verb must place, not refuse.
    seedAccountsSh(h.home, POOLED);
    plantPoolEpoch();
    install('gpt');
    tagPool('demo', 'codex');
    writeLimits('gpt', 5, 10);
    plantSweep({});
    h.sh(`${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=quiet-mesa cmd_ws_add --no-rc --route class=opus demo`);
    expect(h.reg('demo-quiet-mesa', 'wrapper')).toBe('gpt');
    expect(h.reg('demo-quiet-mesa', 'degraded')).toBeNull();
  });

  it('(f) an operator ws-add on a fleet at the ceiling: the coordinator row first, then the rung it took', () => {
    fleetAtFableCeiling();
    h.sh(`${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    const id = 'demo-quiet-mesa';
    expect(h.reg(id, 'wrapper')).toBe('claude-b');
    expect([h.reg(id, 'class'), h.reg(id, 'effort'), h.reg(id, 'subagent'), h.reg(id, 'workflow')])
      .toEqual(['fable', 'ultracode', 'sonnet', 'on']);
    expect(h.reg(id, 'degraded')).toBe('opus');
    const rows = eventsOf(h.home, 'route');
    expect(rows).toHaveLength(5);
    expect(decOf(rows[0]!)).toMatchObject({ actor: 'spawn', reason: 'coordinator row (default)' });
    expect(rows[4]!['detail']).toBe('degraded: ∅ -> opus');
    // FOUR log lines, one per field of the row — the writer the journal
    // assertions above cannot see. The degrade's own line is `degrade <id>:`
    // and is deliberately outside this filter.
    expect(routeLog(id)).toEqual([
      `route ${id}: class ∅ -> fable [actor=spawn] (coordinator row (default))`,
      `route ${id}: effort ∅ -> ultracode [actor=spawn] (coordinator row (default))`,
      `route ${id}: subagent ∅ -> sonnet [actor=spawn] (coordinator row (default))`,
      `route ${id}: workflow ∅ -> on [actor=spawn] (coordinator row (default))`,
    ]);
  });
});
