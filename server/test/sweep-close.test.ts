// `closeRun`'s abandon arm as the DEAD-COORDINATOR LANE runs it (workspace lifecycle spec 2026-09-24 §5.4, "No
// successor" and "The act"): `causedBy: 'sweep'` — a third attribution word, so the run event never reads as the
// operator's — the lane's re-measure, run immediately before the fleet act and again after it, and the compare-and-set
// on `claimedBy`, checked before the fleet act and again inside the commit's transaction; then the serialiser's handle
// that is the lane's only way in, and the landing lane's reading of a run the sweep failed — as a pure verdict and as
// the watcher's own lane. `closeRun` is called directly here, and through `registerCoordRoutes`' handle.
import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { closeRun, type CloseRunDeps, type SweepCloseGuard } from '../src/coord/close.js';
import { FleetWatcher } from '../src/watch.js';
import { readRegistry } from '../src/registry.js';
import { registerCoordRoutes } from '../src/coord/routes.js';
import { survivorOf } from '../src/coord/rundefs.js';
import { landingAsk, landingVerdict } from '../src/coord/landing.js';
import type { ChildReclaimRequest } from '../src/coord/childReclaim.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { okRun } from './coordReadHelpers.js';

const CRASHED = 'demo-coord-crashed';
const HEIR = 'demo-coord-heir';
const W = 'demo-quiet-basin';
/** The lane's guard with a re-measure that still reads the claimant crashed. */
const STILL: SweepCloseGuard = { claimedBy: CRASHED, stillCrashed: async () => null };

const build = (onVerb?: (verb: string) => void) => {
  const home = mkTmp('ccrc-sweep-close-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    onVerb?.(args[0] ?? '');
    return { code: 0, stdout: '', stderr: '' };
  };
  const base = testDeps(home, run);
  const handed: ChildReclaimRequest[] = [];
  const deps: CloseRunDeps = { coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd, childReclaim: (req) => { handed.push(req); } };
  const seed = (session: string, mark: string | null): void => {
    const fields: Record<string, string> = { wrapper: 'claude', project: 'demo', workdir: `/w/${session}`,
      uuid: `u-${session}`, started: '1', workspace: session, branch: `ws/${session}`, base: 'origin/main' };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${session}.${k}`), v);
    if (mark !== null) writeFileSync(path.join(reg, `${session}.child`), mark);
  };
  /** A work run claimed by the crashed coordinator, dispatched into `W` (a marked child of it) and working. */
  const working = (): number => {
    const r = coord.openRun({ program: 'p', title: 't', project: 'demo', wave: 1, waveOf: 3, claimedBy: CRASHED });
    if (!('id' in r)) throw new Error('openRun refused');
    coord.markDispatched(r.id, W, W, `ws/${W}`, false);
    for (const to of ['dispatched', 'working'] as const) expect(coord.advance(r.id, to, 'coordinator').ok).toBe(true);
    seed(W, String(r.id));
    return r.id;
  };
  return { home, coord, deps, base, calls, handed, working, verbs: () => calls.map((c) => c[0]) };
};

describe('closeRun’s abandon arm, as the sweep runs it', () => {
  it('closes the run failed, and its events say the SWEEP did it — never the operator; the child goes to the reclaim port', async () => {
    const b = build();
    const id = b.working();
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'sweep', STILL))
      .toEqual({ ok: true, id, state: 'failed', released: true, childReclaim: 'queued' });
    expect(b.coord.runEvents(id).slice(-2).map((e) => [e.toState, e.causedBy])).toEqual([['closing', 'sweep'], ['failed', 'sweep']]);
    expect(b.verbs()).toEqual(['ws-release']);
    expect(b.handed.map((h) => [h.sessionId, h.runId, h.trigger])).toEqual([[W, id, 'close']]);
  });

  it('the compare-and-set, before the fleet act: a claimant that is no longer the crashed id refuses and composes NOTHING', async () => {
    const b = build();
    const id = b.working();
    expect(b.coord.reclaimProgram(id, HEIR, 1, null)).toMatchObject({ ok: true });
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'sweep', STILL))
      .toEqual({ ok: false, kind: 'claimant-changed', claimedBy: HEIR });
    expect(b.calls, 'no release: a successor’s worker keeps its hold').toEqual([]);
    expect(okRun(b.coord.run(id))!.state).toBe('working');
  });

  it('the compare-and-set, inside the commit: a successor that lands DURING the fleet act is refused there', async () => {
    let id = 0;
    const b = build((verb) => { if (verb === 'ws-release') expect(b.coord.reclaimProgram(id, HEIR, 1, null)).toMatchObject({ ok: true }); });
    id = b.working();
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'sweep', STILL))
      .toEqual({ ok: false, kind: 'claimant-changed', claimedBy: HEIR });
    expect(okRun(b.coord.run(id))!.state, 'the run stays open under its successor').toBe('working');
    expect(b.handed, 'nothing closed, so nothing is reclaimed').toEqual([]);
  });

  it('THE RE-MEASURE, before the fleet act: a claimant that is no longer crashed — a revive of the SAME id — stops it, and NOTHING is composed', async () => {
    const b = build();
    const id = b.working();
    let asked = 0;
    const revived: SweepCloseGuard = { claimedBy: CRASHED,
      stillCrashed: async () => { asked += 1; return { kind: 'remeasured', why: 're-measured alive: tmux reports the pane live' }; } };
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'sweep', revived)).toEqual({ ok: false, kind: 'sweep-stopped',
      stop: { kind: 'remeasured', why: 're-measured alive: tmux reports the pane live' }, fleetAct: null });
    expect(asked).toBe(1);
    expect(b.calls, 'no release: the revived coordinator’s worker keeps its hold').toEqual([]);
    expect(okRun(b.coord.run(id))!.state).toBe('working');
    expect(b.handed).toEqual([]);
  });

  it('THE RE-MEASURE, after the fleet act and before the commit: a revive DURING the release keeps the run open', async () => {
    let released = false;
    const b = build((verb) => { if (verb === 'ws-release') released = true; });
    const id = b.working();
    const guard: SweepCloseGuard = { claimedBy: CRASHED,
      stillCrashed: async () => (released ? { kind: 'remeasured', why: 're-measured alive' } : null) };
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'sweep', guard)).toEqual({ ok: false, kind: 'sweep-stopped',
      stop: { kind: 'remeasured', why: 're-measured alive' }, fleetAct: 'released' });
    expect(okRun(b.coord.run(id))!.state, 'the run stays open under its revived coordinator').toBe('working');
    expect(b.handed, 'nothing closed, so nothing is reclaimed').toEqual([]);
  });

  it('THE RE-MEASURE, after a RE-HOLD: the stop says the worker was re-held under the surviving run — not released (review 339, F3)', async () => {
    let held = false;
    const b = build((verb) => { if (verb === 'ws-hold') held = true; });
    const id = b.working();
    // A second open run on the same workspace, another programme's: it survives the abandon, so the arm re-holds.
    const s = b.coord.openRun({ program: 'q', title: 'q', project: 'demo', wave: 1, waveOf: 2, claimedBy: HEIR });
    if (!('id' in s)) throw new Error('openRun refused');
    b.coord.markDispatched(s.id, W, W, `ws/${W}`, false);
    for (const to of ['dispatched', 'working'] as const) expect(b.coord.advance(s.id, to, 'coordinator').ok).toBe(true);
    const guard: SweepCloseGuard = { claimedBy: CRASHED,
      stillCrashed: async () => (held ? { kind: 'remeasured', why: 're-measured alive' } : null) };
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'sweep', guard)).toEqual({ ok: false, kind: 'sweep-stopped',
      stop: { kind: 'remeasured', why: 're-measured alive' }, fleetAct: 're-held' });
    expect(b.calls.map((c) => c[0]), 'the CONTROL: the fleet act was a hold, not a release').toEqual(['ws-hold']);
    expect(okRun(b.coord.run(id))!.state).toBe('working');
  });

  it('THE RE-MEASURE, for a run with NO session (planned, never dispatched): a revive of the SAME id keeps it open — nothing is acted on', async () => {
    const b = build();
    const r = b.coord.openRun({ program: 'p', title: 't', project: 'demo', wave: 2, waveOf: 3, claimedBy: CRASHED });
    if (!('id' in r)) throw new Error('openRun refused');
    expect(okRun(b.coord.run(r.id))).toMatchObject({ state: 'planned', sessionId: null });
    let asked = 0;
    const revived: SweepCloseGuard = { claimedBy: CRASHED,
      stillCrashed: async () => { asked += 1; return { kind: 'remeasured', why: 're-measured alive: tmux reports the pane live' }; } };
    expect(await closeRun(b.deps, r.id, { intent: 'abandon' }, 'sweep', revived)).toEqual({ ok: false, kind: 'sweep-stopped',
      stop: { kind: 'remeasured', why: 're-measured alive: tmux reports the pane live' }, fleetAct: null });
    expect(asked).toBe(1);
    expect(okRun(b.coord.run(r.id))!.state, 'the run stays planned under its revived coordinator').toBe('planned');
    expect(b.coord.runEvents(r.id).some((e) => e.causedBy === 'sweep'), 'no sweep run event').toBe(false);
    expect(b.calls, 'no runCcd call').toEqual([]);
    expect(b.handed).toEqual([]);
  });

  it('the operator’s abandon never asks a re-measure: it has no guard', async () => {
    const b = build();
    const id = b.working();
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'operator')).toMatchObject({ ok: true, state: 'failed' });
  });

  it('the sweep only ever abandons: any other body is refused before anything is read', async () => {
    const b = build();
    const id = b.working();
    // A body the ORDINARY close would accept and act on (a failed close skips `verifyDone`, D-49).
    const failedClose = { fingerprint: { branchTip: 'x', prNumber: null, prPhase: 'open', handoffCommit: 'x' }, final: false, state: 'failed' };
    expect(await closeRun(b.deps, id, failedClose, 'sweep', STILL)).toEqual({ ok: false, kind: 'bad-request' });
    expect(b.calls).toEqual([]);
  });
});

describe('the coordination serialiser’s sweep handle (`registerCoordRoutes`)', () => {
  const routes = (b: ReturnType<typeof build>) =>
    registerCoordRoutes(Fastify({ logger: false }), { ...b.base, coord: b.coord }, new Bus(), undefined,
      { tmux: b.base.tmux, queue: b.base.queue, readAsk: async () => null });

  it('runs the abandon arm with causedBy sweep and the compare-and-set, and wires the reclaim port as the abandon route does', async () => {
    const b = build();
    const id = b.working();
    const h = routes(b);
    expect(await h.withSweepAbandon(b.coord, (abandon) => abandon(id, CRASHED, STILL.stillCrashed)))
      .toEqual({ ok: true, id, state: 'failed', released: true, childReclaim: 'queued' });
    expect(b.coord.runEvents(id).at(-1)?.causedBy).toBe('sweep');
    const other = build();
    const id2 = other.working();
    expect(await routes(other).withSweepAbandon(other.coord, (abandon) => abandon(id2, 'demo-someone-else', STILL.stillCrashed)))
      .toMatchObject({ ok: false, kind: 'claimant-changed', claimedBy: CRASHED });
    const third = build();
    const id3 = third.working();
    expect(await routes(third).withSweepAbandon(third.coord, (abandon) => abandon(id3, CRASHED,
      async () => ({ kind: 'switch', why: 'reclaim-paused was raised during the act' }))))
      .toMatchObject({ ok: false, kind: 'sweep-stopped', fleetAct: null });
    expect(third.calls, 'the handle hands the re-measure to the arm').toEqual([]);
  });

  it('is the SAME hold as the operator’s doors: a sweep waits for an abandon already running', async () => {
    const b = build();
    const h = routes(b);
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const first = h.withAbandon(b.coord, async () => { order.push('operator:start'); await gate; order.push('operator:end'); });
    const second = h.withSweepAbandon(b.coord, async () => { order.push('sweep'); });
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(['operator:start']);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['operator:start', 'operator:end', 'sweep']);
  });
});

describe('landing reads a sweep-failed run as it reads an operator abandon (spec §6, the Landing-order bullet)', () => {
  // MEASURED: `coord/landing.ts` and `sweepLanding` never read `causedBy` — a notice is told to the coordinator of the
  // workspace's surviving OPEN run (`openRunsForSession` → `survivorOf`), so a run the sweep failed and a run the
  // operator abandoned leave the same facts. Pinned, so a later reading of `causedBy` there has to choose on purpose.
  it('the same facts and the same verdict, whoever failed the run', async () => {
    const steps: unknown[] = [];
    for (const causedBy of ['operator', 'sweep'] as const) {
      const b = build();
      const id = b.working();
      const out = causedBy === 'sweep' ? await closeRun(b.deps, id, { intent: 'abandon' }, 'sweep', STILL)
        : await closeRun(b.deps, id, { intent: 'abandon' }, 'operator');
      expect(out.ok).toBe(true);
      const sib = b.coord.openRunsForSession(W);
      if (!sib.ok) throw new Error('unreadable');
      const ask = landingAsk({ sessionId: W, workspace: W, number: 7, phase: 'open', queue: { state: 'dequeued', at: null } }, new Set());
      expect(ask).not.toBeNull();
      steps.push(landingVerdict(ask!, { runs: { ok: true, run: survivorOf(sib.siblings) } }));
    }
    expect(steps[0]).toEqual({ step: 'toldFeed', body: expect.stringContaining('No open run names a coordinator to tell.') });
    expect(steps[1]).toEqual(steps[0]);
  });

  it('THE LANE ITSELF (`sweepLanding`, on a watcher over the fixture store): the same notice, whoever failed the run', async () => {
    const said: unknown[] = [];
    for (const causedBy of ['operator', 'sweep'] as const) {
      const b = build();
      const id = b.working();
      const out = causedBy === 'sweep' ? await closeRun(b.deps, id, { intent: 'abandon' }, 'sweep', STILL)
        : await closeRun(b.deps, id, { intent: 'abandon' }, 'operator');
      expect(out.ok).toBe(true);
      const w = new FleetWatcher({ ...b.base, coord: b.coord } as never, new Bus(), 10_000);
      const pushed: unknown[] = [];
      vi.spyOn(w as unknown as { pushOne: (e: unknown) => void }, 'pushOne').mockImplementation((e) => { pushed.push(e); });
      const lane = w as unknown as { prStates: Map<string, unknown>; prQueues: Map<string, unknown>;
        sweepLanding: (records: unknown) => void };
      // A dequeued PR on the workspace whose run was failed — the one word that asks the landing lane for an act.
      lane.prStates.set(W, { phase: 'open', number: 7 });
      lane.prQueues.set(W, { state: 'dequeued', at: null });
      lane.sweepLanding(await readRegistry(b.base.io, b.base.cfg));
      said.push({ pushed, mail: b.coord.feedEvents(50).filter((e) => e.kind === 'mail').length });
    }
    expect(said[0]).toMatchObject({ pushed: [{ kind: 'queue', sessionId: W, body: expect.stringContaining('No open run names a coordinator to tell.') }] });
    expect(said[1], 'a sweep-failed run reads as an operator abandon').toEqual(said[0]);
  });
});
