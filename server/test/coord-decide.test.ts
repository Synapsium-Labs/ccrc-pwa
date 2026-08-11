// Architecture doc increment 4 ("deciding split from acting"): `dispatchRun`
// and `closeRun` (`server/src/coord/dispatch.ts`, `close.ts`) are now named
// L1 functions, callable with no Fastify instance and — this file's whole
// point — no `CoordMutex` in the loop either. `run-routes.test.ts` already
// proves D-46/D-48 at the HTTP layer, through the route, behind the mutex;
// it stays green, UNMODIFIED, after this refactor (that suite IS the
// behaviour-identical proof). What it cannot isolate is whether the
// guarantee belongs to the FUNCTION or to whatever serialises calls into
// it — while the logic lived in a route closure there was no way to call it
// twice without also going through Fastify and the mutex. These two tests
// do exactly that: call the decision directly, twice, with nothing between
// the two calls.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { dispatchRun, type DispatchRunDeps } from '../src/coord/dispatch.js';
import { closeRun, type CloseRunDeps } from '../src/coord/close.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const PROJECT = 'demo';
const CLAIMED_BY = 'ccrc-pwa-coordinator';

/** Same shape `run-routes.test.ts`'s own `seed` writes — a fixture session
 *  that reads exactly like a real ccd one. */
const seed = (home: string, id: string, over: Partial<Record<string, string>> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: id, branch: `ws/${id}`, base: 'origin/main', ...over,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/** One runner covering `ws-add`/`ws-hold`/`ws-release` — the verbs these two
 *  tests exercise — plus an optional per-verb failure, same idiom
 *  `run-routes.test.ts`'s own `makeRunner` uses. */
function makeRunner(home: string, cfg: { wsAddCreates?: string[]; fail?: ReadonlySet<string> } = {}):
    { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    const verb = args[0] ?? '';
    if (cfg.fail?.has(verb)) return { code: 1, stdout: '', stderr: `${verb} failed` };
    if (verb === 'ws-add') {
      for (const id of cfg.wsAddCreates ?? [`${PROJECT}-fresh`]) seed(home, id);
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
}

describe('dispatchRun, called directly with no CoordMutex in the loop (D-46, at the function level)', () => {
  it('dispatching the same run twice, back to back, leaves the fleet call log UNCHANGED on the second call', async () => {
    const home = mkTmp('ccrc-decide-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-decide1'] });
    const base = testDeps(home, run);
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const opened = coord.openRun({ program: 'build9', title: 'Decide', project: PROJECT,
      wave: 1, waveOf: 1, claimedBy: CLAIMED_BY });
    if (!('id' in opened)) throw new Error('openRun refused');

    const deps: DispatchRunDeps = { coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd,
      fleetState: undefined, tmux: base.tmux, queue: base.queue };

    const first = await dispatchRun(deps, opened.id, 'do the thing');
    expect(first.ok).toBe(true);
    const callsAfterFirst = calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);   // ws-add and ws-hold genuinely ran

    // The SAME deps, the SAME already-dispatched run id, called again — no
    // mutex, no HTTP, nothing serialising this from the call above but the
    // plain fact that the first `await` already resolved. The transition
    // guard is `dispatchRun`'s own first read of the row, not a property
    // its caller was supplying.
    const second = await dispatchRun(deps, opened.id, 'do the thing');
    expect(second).toMatchObject({ ok: false, kind: 'bad-transition', from: 'dispatched', to: 'dispatched' });
    expect(calls.length).toBe(callsAfterFirst);   // no second ws-add/ensure/ws-hold
    expect(coord.runEvents(opened.id).length).toBe(1);   // still only the first dispatch's own row
  });
});

describe('closeRun, called directly — a failing ws-release leaves the run retryable, never wedged terminal (D-48, at the function level)', () => {
  it('a failed release changes nothing, and a bare retry with a healthy runner actually completes the close', async () => {
    const home = mkTmp('ccrc-decide-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const { run: sickRun, calls: sickCalls } = makeRunner(home,
      { wsAddCreates: ['demo-decide2'], fail: new Set(['ws-release']) });
    const base = testDeps(home, sickRun);
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const opened = coord.openRun({ program: 'build9', title: 'Decide', project: PROJECT,
      wave: 1, waveOf: 1, claimedBy: CLAIMED_BY });
    if (!('id' in opened)) throw new Error('openRun refused');

    const dispatchDeps: DispatchRunDeps = { coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd,
      fleetState: undefined, tmux: base.tmux, queue: base.queue };
    const dispatched = await dispatchRun(dispatchDeps, opened.id, 'do the thing');
    expect(dispatched.ok).toBe(true);
    expect(coord.run(opened.id)!.state).toBe('dispatched');

    // An explicit abandon (`state:'failed'`) skips `verifyDone` entirely
    // (D-49) — the one shape that lets this test exercise the `ws-release`
    // ordering with no git/pr-state fixture at all, since `final:true` with
    // no `archive` still routes through the SAME release branch `closeRun`
    // uses for an ordinary done close.
    const abandon = { fingerprint: { branchTip: 'x', prNumber: null, prPhase: 'open', handoffCommit: 'x' },
      final: true, state: 'failed' };
    const closeDeps: CloseRunDeps = { coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd, fleetState: undefined };
    const refused = await closeRun(closeDeps, opened.id, abandon);
    expect(refused).toMatchObject({ ok: false, kind: 'fleetFailed', stderr: 'ws-release failed' });
    expect(sickCalls.some((c) => c[0] === 'ws-release')).toBe(true);
    // D-48: the fleet act runs AHEAD of the transition commit. A run this
    // function refused to close must be EXACTLY where it was — `dispatched`,
    // never `closing`/`done`/`failed` — or `RUN_TRANSITIONS.done = []`/
    // `.failed = []` would give no way out at all.
    expect(coord.run(opened.id)!.state).toBe('dispatched');
    expect(coord.run(opened.id)!.closedAt).toBeNull();

    // The new claim a route-level test cannot isolate: called AGAIN, on the
    // SAME run, with nothing but a healthy runner swapped in — no HTTP retry,
    // no mutex — `closeRun` actually finishes the close it was refused a
    // moment ago. A wedge would fail this exact call.
    const { run: healthyRun, calls: healthyCalls } = makeRunner(home);
    const retryBase = testDeps(home, healthyRun);
    const retryDeps: CloseRunDeps = { coord, io: retryBase.io, cfg: retryBase.cfg,
      runCcd: retryBase.runCcd, fleetState: undefined };
    const closed = await closeRun(retryDeps, opened.id, abandon);
    expect(closed).toMatchObject({ ok: true, id: opened.id, state: 'failed' });
    expect(healthyCalls.some((c) => c[0] === 'ws-release')).toBe(true);
    expect(coord.run(opened.id)!.state).toBe('failed');
    expect(coord.run(opened.id)!.closedAt).not.toBeNull();
  });
});
