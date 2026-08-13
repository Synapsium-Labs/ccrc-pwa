// Architecture doc increment 4 ("deciding split from acting"): `dispatchRun`
// and `closeRun` (`server/src/coord/dispatch.ts`, `close.ts`) are now named
// L1 functions, callable with no Fastify instance and — this file's whole
// point — no `CoordMutex` in the loop either. `run-routes.test.ts` already
// proves D-46/D-48 at the HTTP layer, through the route, behind the mutex;
// it stays green, UNMODIFIED, after this refactor (that suite IS the
// behaviour-identical proof). This file measures two DIFFERENT shapes, and
// they answer two different questions:
//  - SEQUENTIAL calls (the first two tests below) show that the transition
//    guard — `run.state !== 'planned'` for dispatch, `RUN_TRANSITIONS[
//    run.state].includes('closing')` for close — is `dispatchRun`'s/
//    `closeRun`'s own first, synchronous read of the row: a SECOND call,
//    made after the first has already resolved, refuses on its own, with
//    nothing external serialising the two.
//  - a CONCURRENT call (fix round 1, finding 5 — the third test, below the
//    first two) measures the property those sequential calls CANNOT show:
//    whether the no-second-fleet-act guarantee D-46 names is a property of
//    the function in isolation, or of whatever serialises calls into it.
//    Measured, not narrated: two `dispatchRun` calls fired together for the
//    SAME `planned` run, no mutex, both pass the transition guard (neither
//    has written anything by the time the other reads the row — see that
//    test's own comment for why this is guaranteed, not lucky) and both
//    reach `ccd ws-add`. The guarantee is a property of the CALLER's
//    serialisation, not of `dispatchRun` alone — `dispatch-mutex-gate.
//    test.ts` is the mechanical guard (fix round 1, finding 4) that stops a
//    future call site from reaching `dispatchRun`/`closeRun` without
//    `coordMutex.run(...)` wrapping it, now that this file has measured why
//    that guard earns its place.
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

    const first = await dispatchRun(deps, opened.id, 'do the thing', undefined);
    expect(first.ok).toBe(true);
    const callsAfterFirst = calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);   // ws-add and ws-hold genuinely ran

    // The SAME deps, the SAME already-dispatched run id, called again — no
    // mutex, no HTTP, nothing serialising this from the call above but the
    // plain fact that the first `await` already resolved: this is a
    // SEQUENTIAL retry, not a concurrent one. It shows the transition-guard
    // READ lives in `dispatchRun` itself. It does NOT show the
    // no-second-fleet-act guarantee is a property of the function alone
    // under concurrency — the test below this `describe` block measures
    // that directly, and the answer is the opposite: under CONCURRENT
    // calls, D-46's guarantee is a property the caller's `CoordMutex`
    // supplies, not one `dispatchRun` enforces by itself (fix round 1,
    // finding 5).
    const second = await dispatchRun(deps, opened.id, 'do the thing', undefined);
    expect(second).toMatchObject({ ok: false, kind: 'bad-transition', from: 'dispatched', to: 'dispatched' });
    expect(calls.length).toBe(callsAfterFirst);   // no second ws-add/ensure/ws-hold
    expect(coord.runEvents(opened.id).length).toBe(1);   // still only the first dispatch's own row
  });
});

/** Each `ws-add` mints a genuinely NEW session id, unlike `makeRunner`'s
 *  fixed `${PROJECT}-fresh` — required here because a real race needs the
 *  registry diff (`dispatchRun`'s own "candidates" computation) to be able
 *  to see TWO distinct new rows, not the same one written twice. */
function makeCountingRunner(home: string): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  let n = 0;
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    if ((args[0] ?? '') === 'ws-add') {
      n += 1;
      seed(home, `demo-race${n}`);
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
}

describe('dispatchRun, called CONCURRENTLY with no CoordMutex in the loop (fix round 1, finding 4/5 — D-46 is the caller\'s property)', () => {
  it('two dispatchRun calls fired together for the SAME planned run both reach ccd ws-add', async () => {
    const home = mkTmp('ccrc-decide-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const { run, calls } = makeCountingRunner(home);
    const base = testDeps(home, run);
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const opened = coord.openRun({ program: 'build9', title: 'Decide', project: PROJECT,
      wave: 1, waveOf: 1, claimedBy: CLAIMED_BY });
    if (!('id' in opened)) throw new Error('openRun refused');

    const deps: DispatchRunDeps = { coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd,
      fleetState: undefined, tmux: base.tmux, queue: base.queue };

    // No `CoordMutex` anywhere in this call — exactly the shape a call site
    // outside routes.ts's two `coordMutex.run(...)` wrappers would produce.
    // `Promise.all` calls `dispatchRun` for A, then for B, before either has
    // a chance to run past its own FIRST `await` — `dispatchRun`'s opening
    // lines (`coord.run(id)`, the `run.state !== 'planned'` transition
    // guard) are synchronous, so BOTH calls read the SAME `planned` row and
    // BOTH pass the guard before either writes anything. This is not a
    // timing accident to hope for; it is guaranteed by JS run-to-completion
    // semantics regardless of how the real disk I/O below interleaves.
    const [a, b] = await Promise.all([
      dispatchRun(deps, opened.id, 'do the thing', undefined),
      dispatchRun(deps, opened.id, 'do the thing', undefined),
    ]);

    // The robust claim, true under every interleaving: the transition guard
    // alone did not serialise the two calls, so `ccd ws-add` ran TWICE for
    // one run that only ever wanted one workspace. Two DISTINCT workspaces
    // land on disk either way (`makeCountingRunner` mints a fresh id per
    // call) — the damage the mutex exists to prevent, independent of which
    // call (if either) goes on to bind the run row: whichever `demo-raceN`
    // the run does NOT bind is an orphan — no run row, no hold, no cap
    // accounting — precisely the shape review finding 7 and D-46 exist to
    // prevent.
    const wsAddCalls = calls.filter((c) => c[0] === 'ws-add');
    expect(wsAddCalls.length).toBe(2);

    // How the race resolves from there is genuinely timing-dependent
    // (measured across repeated runs: sometimes one call's registry-diff
    // sees only its own new session and succeeds while the other sees both
    // and is refused `ambiguous-dispatch`; sometimes BOTH after-reads land
    // once both sessions already exist on disk and BOTH are refused) — this
    // test does not assert a specific split, because doing so would pin an
    // accident of I/O scheduling, not a property of the code. What IS a
    // property of the code, and is asserted here: at most ONE of the two
    // calls ever ends `ok:true`. `CoordStore.advance` is the sole
    // synchronous writer of `run.state`, and `RUN_TRANSITIONS.dispatched`
    // has no self-edge, so even a call that gets past the registry-diff
    // check with an apparently-unique candidate still loses at the final
    // `advance()` if the other call's `advance()` already committed
    // `dispatched` first — that call comes back `advanceFailed`, not
    // `ok:true`, AFTER it has already run `ccd ws-add` and `ccd ws-hold`.
    const outcomes = [a, b];
    expect(outcomes.filter((o) => o.ok).length).toBeLessThanOrEqual(1);
    for (const o of outcomes) if (o.ok) expect(['demo-race1', 'demo-race2']).toContain(o.sessionId);

    // Whatever the split, the run row lands in one of exactly two
    // legitimate shapes — `dispatched` (one call's `advance()` committed)
    // or still `planned` (neither did) — never anything else. This SAME
    // race is what `run-routes.test.ts`'s own D-46 case proves unreachable
    // once the caller wraps the call in `coordMutex.run(...)`, which is
    // exactly the difference this file exists to isolate.
    expect(['planned', 'dispatched']).toContain(coord.run(opened.id)!.state);
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
    const dispatched = await dispatchRun(dispatchDeps, opened.id, 'do the thing', undefined);
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
    // `causedBy` is a required parameter with no default (Build 4, D-B4-3/6):
    // this is the COORDINATOR's own close, and it says so.
    const refused = await closeRun(closeDeps, opened.id, abandon, 'coordinator');
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
    const closed = await closeRun(retryDeps, opened.id, abandon, 'coordinator');
    expect(closed).toMatchObject({ ok: true, id: opened.id, state: 'failed' });
    expect(healthyCalls.some((c) => c[0] === 'ws-release')).toBe(true);
    expect(coord.run(opened.id)!.state).toBe('failed');
    expect(coord.run(opened.id)!.closedAt).not.toBeNull();
  });
});
