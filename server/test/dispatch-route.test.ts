// Routing spec 2026-09-14 §5.3 (slice 4, Task 3): dispatch is the server's
// ONE place that writes a wave's routing onto the record — the argv itself on
// a fresh wave-1 spawn (no session exists yet to call a verb on), and the
// `ccd route` verb on a resumed wave N>=2 (D-1: no ccd verb can spawn fresh
// into an existing workspace, so a routing change reaches a resumed worker
// only by calling the verb on its session). The harness follows
// `dispatch-skillstate.test.ts`'s direct-`dispatchRun` shape and
// `run-routes.test.ts`'s single shared recorder (`Tmux` and `runCcd` share
// one guarded runner, per `testDeps`'s own wiring), so ORDER between a ccd
// call and a tmux one is observable from one combined `calls` array.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { dispatchRun, type DispatchRunDeps } from '../src/coord/dispatch.js';
import type { Runner } from '../src/exec.js';
import { ACTOR_FLAGS_CAP, ROUTE_ARGV_CAP, ROUTE_CAP } from '../src/ccdargv.js';
import { configDirFor } from '../src/config.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const PROJECT = 'demo';

/** A full registry row — same field set `run-routes.test.ts`'s own `seed`
 *  writes, so a fixture session reads exactly like a real ccd one. */
const seed = (home: string, id: string, over: Partial<Record<string, string>> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: id, branch: `ws/${id}`, base: 'origin/main', ...over,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/** The scripted `capture-pane` sequence a happy `sendPrompt('/clear')` needs —
 *  copied from `run-routes.test.ts`'s own `CLEAR_PANES`. */
const CLEAR_PANES = ['scrollback\n❯ \n', 'scrollback\n❯ /clear\n', 'scrollback\n❯ \n'];

interface RunnerCfg {
  /** ids `ws-add` fabricates in the registry, simulating `cmd_ws_add`. */
  wsAddCreates?: string[];
  /** Verbs that fail (`code: 1`) rather than succeed. */
  fail?: ReadonlySet<string>;
  panes?: string[];
}

/** One runner covering every verb this file's dispatches call — the ccd
 *  writes (`ws-add`/`ensure`/`ws-hold`/`route`) and the tmux calls the
 *  injected `/clear` makes — the same `Runner` shared between `runCcd` and
 *  `tmux` (`testDeps`'s own wiring), so `calls` is ONE combined, ordered log. */
function makeRunner(home: string, cfg: RunnerCfg = {}): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  let capIdx = 0;
  const panes = cfg.panes ?? CLEAR_PANES;
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    const verb = args[0] ?? '';
    if (cfg.fail?.has(verb)) return { code: 1, stdout: '', stderr: `${verb} failed` };
    if (verb === 'ws-add') {
      const ids = cfg.wsAddCreates ?? [`${PROJECT}-fresh`];
      for (const id of ids) seed(home, id);
      return { code: 0, stdout: '', stderr: '' };
    }
    if (verb === 'capture-pane') {
      const p = panes[Math.min(capIdx, panes.length - 1)]!;
      capIdx++;
      return { code: 0, stdout: p, stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };   // ensure, ws-hold, route, send-keys, has-session…
  };
  return { run, calls };
}

const DEFAULT_VERBS = ['ws-add', 'ensure', 'ws-hold', ACTOR_FLAGS_CAP, ROUTE_ARGV_CAP, ROUTE_CAP];

interface HarnessCfg extends RunnerCfg {
  wave?: 1 | 2;
  /** Set to open a wave N>=2 run already bound to an existing (seeded)
   *  session, the resume arm's own precondition. */
  sessionId?: string;
  ccdVerbs?: string[];
}

const harness = async (cfg: HarnessCfg = {}) => {
  const home = mkTmp('ccrc-dispatch-route-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const opened = coord.openRun({
    program: 'p', title: 't', project: PROJECT, wave: cfg.wave ?? 1, waveOf: 2, claimedBy: 'c',
  });
  if (!('id' in opened)) throw new Error(`fixture openRun refused: ${JSON.stringify(opened)}`);
  if (cfg.sessionId !== undefined) {
    seed(home, cfg.sessionId);
    coord.setSession(opened.id, cfg.sessionId);
  }
  const { run, calls } = makeRunner(home, cfg);
  const base = testDeps(home, run);
  const deps: DispatchRunDeps = {
    ...base, coord,
    fleetState: { connected: true, downSince: null, ccdVerbs: cfg.ccdVerbs ?? DEFAULT_VERBS, rosterFp: null, build: null },
    configDir: (w: string) => configDirFor(base.cfg, w),
  };
  return {
    coord, deps, runId: opened.id, calls,
    dispatch: (route?: unknown) => dispatchRun(deps, opened.id, 'go', undefined, route),
    events: (): string[] =>
      coord.runEvents(opened.id).map((e) => e.detail).filter((d): d is string => d !== null),
  };
};

describe('dispatch writes the routing record it was given (routing spec §5.3, slice 4)', () => {
  it('wave 1, with route-argv-v1: ws-add carries --route pairs, in field order, before the project and dec', async () => {
    const h = await harness({ wave: 1, wsAddCreates: ['demo-quiet-basin'] });
    const out = await h.dispatch({ class: 'opus', effort: 'high' });
    expect(out).toMatchObject({ ok: true });
    expect(h.calls.filter((c) => c[0] === 'ws-add')).toEqual([
      ['ws-add', '--no-rc', '--route', 'class=opus', '--route', 'effort=high', PROJECT,
       '--surface', 'agent', '--actor', `run:${h.runId} dispatch`],
    ]);
    expect(h.events()).not.toContain('route-omitted:no-route-argv-cap');
  });

  it('wave 1, without route-argv-v1: no --route reaches ws-add, and the omission is journaled', async () => {
    const h = await harness({
      wave: 1, wsAddCreates: ['demo-quiet-mesa'],
      ccdVerbs: ['ws-add', 'ensure', 'ws-hold', ACTOR_FLAGS_CAP],
    });
    const out = await h.dispatch({ class: 'opus' });
    expect(out).toMatchObject({ ok: true });
    const wsAdd = h.calls.find((c) => c[0] === 'ws-add');
    expect(wsAdd, 'no ws-add call recorded').toBeDefined();
    expect(wsAdd).not.toContain('--route');
    expect(wsAdd).toEqual(['ws-add', '--no-rc', PROJECT, '--surface', 'agent', '--actor', `run:${h.runId} dispatch`]);
    expect(h.events()).toContain('route-omitted:no-route-argv-cap');
  });

  it('wave 1: a route with no fields asked (an empty object) omits nothing and journals nothing', async () => {
    // `{}` is a real, distinct value from "never asked" — it parses ok with
    // zero keys and collapses to the identical no-routing argv, because there
    // is nothing to flag and nothing to have omitted.
    const h = await harness({
      wave: 1, wsAddCreates: ['demo-empty-route'],
      ccdVerbs: ['ws-add', 'ensure', 'ws-hold', ACTOR_FLAGS_CAP],
    });
    const out = await h.dispatch({});
    expect(out).toMatchObject({ ok: true });
    expect(h.calls.filter((c) => c[0] === 'ws-add')).toEqual([
      ['ws-add', '--no-rc', PROJECT, '--surface', 'agent', '--actor', `run:${h.runId} dispatch`],
    ]);
    expect(h.events()).not.toContain('route-omitted:no-route-argv-cap');
  });

  it('wave N>=2, with route-v1: the route verb precedes the /clear injection in the recorder\'s combined order', async () => {
    const h = await harness({ wave: 2, sessionId: 'demo-existing-route' });
    const out = await h.dispatch({ class: 'opus' });
    expect(out).toMatchObject({ ok: true, resumed: true, clearedAt: expect.any(Number) });
    const route = h.calls.find((c) => c[0] === 'route');
    // `--actor` only, NEVER `--surface`: `cmd_route`'s real parser has no
    // `--surface` case (`CCD_ARGV.route`'s own docstring measures it against
    // the binary) — sending it would die on the fleet.
    expect(route).toEqual([
      'route', '--session', 'demo-existing-route', '--set', 'class=opus',
      '--actor', `run:${h.runId} dispatch`,
    ]);
    const routeIdx = h.calls.indexOf(route!);
    const clearIdx = h.calls.findIndex((c) => c[0] === 'send-keys' && c.includes('-l') && c.includes('/clear'));
    expect(clearIdx, 'no /clear send-keys call found').toBeGreaterThan(-1);
    expect(routeIdx, 'the route verb must precede the /clear injection').toBeLessThan(clearIdx);
    expect(h.events()).not.toContain('route-omitted:no-route-v1-cap');
  });

  it('wave N>=2, without route-v1: no route call fires, the omission is journaled, and /clear still proceeds', async () => {
    const h = await harness({
      wave: 2, sessionId: 'demo-existing-noroute',
      ccdVerbs: ['ws-add', 'ensure', 'ws-hold', ACTOR_FLAGS_CAP, ROUTE_ARGV_CAP],
    });
    const out = await h.dispatch({ class: 'opus' });
    expect(out).toMatchObject({ ok: true, resumed: true, clearedAt: expect.any(Number) });
    expect(h.calls.some((c) => c[0] === 'route')).toBe(false);
    expect(h.calls.some((c) => c[0] === 'send-keys' && c.includes('-l') && c.includes('/clear'))).toBe(true);
    expect(h.events()).toContain('route-omitted:no-route-v1-cap');
  });

  it('wave N>=2: a refused route verb reports fleetFailed, never clears, and leaves the run planned', async () => {
    const h = await harness({ wave: 2, sessionId: 'demo-existing-refused', fail: new Set(['route']) });
    const out = await h.dispatch({ class: 'opus' });
    expect(out).toMatchObject({ ok: false, kind: 'fleetFailed', stderr: 'route failed' });
    expect(h.calls.some((c) => c[0] === 'send-keys' && c.includes('/clear'))).toBe(false);
    const row = h.coord.run(h.runId);
    expect(row.ok && row.run?.state).toBe('planned');
  });

  it('a malformed route is refused before any fleet act — no ccd call, no tmux call', async () => {
    const h = await harness({ wave: 1 });
    const out = await h.dispatch({ nope: 'x' });
    expect(out).toEqual({ ok: false, kind: 'bad-request', detail: 'route: unknown-field nope' });
    expect(h.calls).toEqual([]);
  });

  it('a route naming a ccd-only field (degraded/inert) is unknown-field too', async () => {
    const h = await harness({ wave: 1 });
    const out = await h.dispatch({ degraded: 'opus' });
    expect(out).toEqual({ ok: false, kind: 'bad-request', detail: 'route: unknown-field degraded' });
    expect(h.calls).toEqual([]);
  });

  it('an absent route sends the argv byte for byte identical whether the parameter is omitted or explicitly undefined', async () => {
    const h1 = await harness({ wave: 1, wsAddCreates: ['demo-noparam'] });
    // FOUR arguments — no fifth at all — the exact call shape a pre-Task-3
    // caller (or a caller with nothing to route) still makes.
    await dispatchRun(h1.deps, h1.runId, 'go', undefined);
    const wsAdd1 = h1.calls.find((c) => c[0] === 'ws-add')!;

    const h2 = await harness({ wave: 1, wsAddCreates: ['demo-explicit-undefined'] });
    const wsAdd2Out = await h2.dispatch(undefined);
    expect(wsAdd2Out).toMatchObject({ ok: true });
    const wsAdd2 = h2.calls.find((c) => c[0] === 'ws-add')!;

    // Normalise the one token that legitimately differs between the two runs
    // (the `--actor` value names each run's own numeric id) before comparing.
    const normalise = (argv: readonly string[], id: number): string[] =>
      argv.map((t) => (t === `run:${id} dispatch` ? 'run:<id> dispatch' : t));
    expect(normalise(wsAdd1, h1.runId)).toEqual(normalise(wsAdd2, h2.runId));
    expect(wsAdd1).not.toContain('--route');
  });
});
