// D-7319, CHARACTERIZATION (green on the parent, before the dead-dispatch reason existed; unchanged by it). It pins
// the two facts the new act is built on, against the real store and the real `closeRun`:
//   1. a run the fleet card calls stalled ("spawn never completed": planned, unbound, stamped past `SPAWN_STALL_MS`)
//      whose coordinator is alive is left PLANNED by a pass of the dead-coordinator lane, and nothing is mailed. The new
//      reason keeps this for a stamp inside its own bound, which is above `SPAWN_STALL_MS`;
//   2. the operator's abandon arm on such a run closes it `failed` with no fleet act, cancels the run's queued mail and
//      records its cause: the arm the new reason reuses, so the run's trail differs only in that cause.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { FleetWatcher, CHILD_RECLAIM_SWEEP_MS } from '../src/watch.js';
import { readRegistry } from '../src/registry.js';
import { loadConfig } from '../src/config.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { closeRun } from '../src/coord/close.js';
import { queueSystemMail } from '../src/coord/rundefsTx.js';
import { Tmux, type Runner } from '../src/exec.js';
import { SPAWN_STALL_MS } from '../../shared/api.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { okRun } from './coordReadHelpers.js';
import { decideDispatch, type BindFacts } from '../src/coord/dispatchDecide.js';
import type { RegistryRead, SessionRecord } from '../src/registry.js';

afterEach(() => { vi.restoreAllMocks(); });

const T0 = 1_790_000_000_000;
const COORD = 'demo-coord';

const fixture = async () => {
  let clock = T0;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const home = mkTmp('ccrc-dead-dispatch-char-');
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(path.join(reg, '.lifecycle'), { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
  const calls: string[][] = [];
  const run: Runner = async (cmd, args) => {
    if (path.basename(cmd) === 'tmux') {
      if (args[0] !== 'has-session') return { ran: true, code: 1, stdout: '', stderr: '' };
      const id = (args[2] ?? '').replace(/^=cc-/, '').replace(/:$/, '');
      return id === COORD ? { ran: true, code: 0, stdout: '', stderr: '' } : { ran: true, code: 1, stdout: '', stderr: `can't find session: cc-${id}` };
    }
    calls.push(args);
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base = testDeps(home, run);
  const deps = { ...base, monotonicMs: () => clock, cfg, coord, tmux: new Tmux(run), viewers: { isVisible: () => false } };
  const watcher = new FleetWatcher(deps as never, new Bus(), 10_000);
  watcher.useCoordSerialiser({ withSweepAbandon: (c, fn) => fn((runId, claimedBy, stillCrashed) =>
    closeRun({ coord: c, io: deps.io, cfg, runCcd: deps.runCcd }, runId, { intent: 'abandon' }, 'sweep', { claimedBy, stillCrashed })) });
  for (const [f, v] of Object.entries({ uuid: `u-${COORD}`, wrapper: 'claude', project: 'demo', workdir: `/w/${COORD}`,
    started: '1', supervised: String(Math.floor(T0 / 1000)) })) writeFileSync(path.join(reg, `${COORD}.${f}`), v);
  const stalled = (ageMs: number): number => {
    const r = coord.openRun({ program: 'prog-a', title: 'prog-a', project: 'demo', wave: 1, waveOf: 1, claimedBy: COORD });
    if (!('id' in r)) throw new Error('openRun refused');
    coord.markDispatchStarted(r.id, clock - ageMs);
    return r.id;
  };
  const pass = async (): Promise<void> => {
    clock += CHILD_RECLAIM_SWEEP_MS + 1;
    await watcher.sweepDeadCoordinators(await readRegistry(deps.io, cfg), readdirSync(reg));
  };
  return { coord, cfg, deps, calls, stalled, pass, stateOf: (id: number) => okRun(coord.run(id))!.state,
    mailCount: () => (coord.db.prepare('SELECT COUNT(*) AS n FROM mail').get() as { n: number }).n };
};

describe('characterization: a stalled dispatch before the server abandons it (D-7319)', () => {
  it('a run the card calls stalled, whose coordinator is alive, stays planned through the lane, and nothing is mailed', async () => {
    const f = await fixture();
    const id = f.stalled(SPAWN_STALL_MS + 60_000);
    await f.pass();
    await f.pass();
    expect(f.stateOf(id)).toBe('planned');
    expect(f.mailCount()).toBe(0);
    expect(f.calls).toEqual([]);
  });

  it("the operator's abandon arm closes such a run failed, with no fleet act, its queued mail cancelled", async () => {
    const f = await fixture();
    const id = f.stalled(SPAWN_STALL_MS + 60_000);
    const run = okRun(f.coord.run(id))!;
    const q = queueSystemMail(f.coord, run, { fromId: 'operator', toId: COORD, runId: id, kind: 'status', subject: 'probe', body: 'x' });
    expect(q.queued).toBe(true);
    const out = await closeRun({ coord: f.coord, io: f.deps.io, cfg: f.cfg, runCcd: f.deps.runCcd }, id, { intent: 'abandon' }, 'operator');
    expect(out).toMatchObject({ ok: true, id, state: 'failed', released: false });
    expect(f.stateOf(id)).toBe('failed');
    expect(f.coord.runEvents(id).find((e) => e.fromState === 'planned' && e.toState === 'failed')?.causedBy).toBe('operator');
    const states = f.coord.db.prepare('SELECT state FROM mail_deliveries').all() as { state: string }[];
    expect(states.map((s) => s.state)).toEqual(['rejected']);
    expect(f.calls).toEqual([]);
  });
});

// D-8126, CHARACTERIZATION (green before the orphan event existed): `decideBind`'s after-spawn refusals and the events
// they carry, exactly as the dispatch executor journals them.
describe("characterization: decideBind's after-spawn refusals (D-8126)", () => {
  const rec = (id: string): SessionRecord => ({ id, project: 'demo', workspace: `/w/${id}`, branch: `ws/${id}`, wrapper: 'claude',
    uuid: `u-${id}`, held: null, spawn: null, unmeasured: [] }) as unknown as SessionRecord;
  const listed = (records: SessionRecord[]): RegistryRead => ({ listed: true, records, refused: new Set<string>() }) as unknown as RegistryRead;
  const unlisted = { listed: false } as unknown as RegistryRead;
  const bind = (over: Partial<BindFacts>): BindFacts => ({ step: 'bind', project: 'demo', childSlug: null, beforeIds: new Set(['old']),
    after: listed([rec('old'), rec('new')]), res: { ok: true }, ...over });

  it('an unlistable AFTER read is registry-unmeasurable, with ccd\'s stderr only when ccd failed, and no event', () => {
    expect(decideDispatch(bind({ after: unlisted }))).toEqual({ kind: 'refused', outcome: { ok: false, kind: 'registry-unmeasurable' } });
    expect(decideDispatch(bind({ after: unlisted, res: { ok: false, stderr: 'boom', cutShort: true } })))
      .toMatchObject({ kind: 'refused', outcome: { kind: 'registry-unmeasurable', stderr: 'boom' } });
  });
  it('two candidates are ambiguous-dispatch; the dispatch-refused event rides only when ccd failed', () => {
    const after = listed([rec('n1'), rec('n2')]);
    expect(decideDispatch(bind({ after }))).toEqual({ kind: 'refused', outcome: { ok: false, kind: 'refused', code: 'ambiguous-dispatch', candidates: 2 } });
    expect(decideDispatch(bind({ after, res: { ok: false, stderr: 'no', cutShort: true } })))
      .toMatchObject({ event: 'dispatch-refused:ambiguous-dispatch candidates=n1,n2' });
  });
  it('zero candidates with ccd failed is fleetFailed', () => {
    expect(decideDispatch(bind({ after: listed([rec('old')]), res: { ok: false, stderr: 'no', cutShort: false } })))
      .toMatchObject({ outcome: { kind: 'fleetFailed' }, event: 'dispatch-refused:fleetFailed candidates=' });
  });
});
