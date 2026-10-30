// D-7319 (operator ruling 2026-10-29): a run whose dispatch never came back is abandoned BY THE SERVER, on the
// dead-coordinator lane's pass, through the one abandon arm (`closeRun`, reached through the serialiser's sweep handle).
// What only a pass can show, each row against the real store, a fixture HOME's registry and the real `closeRun`:
//   * dead -> abandoned ONCE: closed `failed` by `sweep`, the reason journaled, the coordinator mailed; a second pass
//     changes nothing and mails nothing;
//   * a child workspace exists (its marker names the run) -> never;
//   * in flight: inside the bound, or restamped by a retry between the pass's read and the act -> never;
//   * the switch off -> never, and Settings' write turns it back on;
//   * the cleanup pause raised, or a box that minted without the marker -> never;
//   * a late child after the abandon -> the run stays `failed`, nothing is journaled or mailed again;
//   * D-7502: more candidates than the pass cap -> at most the cap handled a pass, oldest stamp first, the rest on
//     the next passes, until every one is abandoned.
// NOTHING here reaches a box: tmux and ccd are a scripted recorder, the registry is a fixture HOME's.
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
import { Tmux, type Runner } from '../src/exec.js';
import { DISPATCH_ABANDON_DEFAULT_MS, DISPATCH_ABANDON_EVENT, DISPATCH_ABANDON_SUBJECT } from '../../shared/dispatch-abandon.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { okRun } from './coordReadHelpers.js';
import { DISPATCH_ABANDON_PER_PASS } from '../src/coord/abandonDeadDispatch.js';

afterEach(() => { vi.restoreAllMocks(); });

const T0 = 1_790_000_000_000;
const COORD = 'demo-coord';
const BOUND = DISPATCH_ABANDON_DEFAULT_MS;

const fixture = async (opts: { beforeAbandon?: () => void } = {}) => {
  let clock = T0;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const home = mkTmp('ccrc-dead-dispatch-lane-');
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
  let acts = 0;
  const watcher = new FleetWatcher(deps as never, new Bus(), 10_000);
  // The sweep's abandon exactly as `routes.ts`'s `withSweepAbandon` runs it: the real `closeRun`'s abandon arm, `'sweep'`,
  // the claimant and the caller's re-measure.
  watcher.useCoordSerialiser({ withSweepAbandon: (c, fn) => {
    acts += 1;
    return fn((runId, claimedBy, stillCrashed) => {
      // Between the pass's verdict and the arm: whatever lands here, the arm's re-measure must see.
      opts.beforeAbandon?.();
      return closeRun({ coord: c, io: deps.io, cfg, runCcd: deps.runCcd }, runId, { intent: 'abandon' }, 'sweep', { claimedBy, stillCrashed });
    });
  } });
  const plant = (id: string, fields: Record<string, string>): void => {
    for (const [f, v] of Object.entries({ uuid: `u-${id}`, wrapper: 'claude', project: 'demo', workdir: `/w/${id}`, ...fields })) {
      writeFileSync(path.join(reg, `${id}.${f}`), v);
    }
  };
  // The coordinator: live in tmux, supervised now, so the lane's own coordinator reason leaves it alone.
  plant(COORD, { started: '1', supervised: String(Math.floor(T0 / 1000)) });
  /** A planned run claimed by the coordinator, whose dispatch was stamped `ageMs` ago and bound nothing. */
  const stalled = (ageMs: number, program = 'prog-a'): number => {
    const r = coord.openRun({ program, title: program, project: 'demo', wave: 1, waveOf: 1, claimedBy: COORD });
    if (!('id' in r)) throw new Error('openRun refused');
    coord.markDispatchStarted(r.id, clock - ageMs);
    return r.id;
  };
  const pass = async (): Promise<void> => {
    clock += CHILD_RECLAIM_SWEEP_MS + 1;
    await watcher.sweepDeadCoordinators(await readRegistry(deps.io, cfg), readdirSync(reg));
  };
  const stateOf = (id: number) => okRun(coord.run(id))!.state;
  const mail = () => coord.db.prepare('SELECT fromId, toId, runId, subject, body FROM mail ORDER BY id').all() as
    { fromId: string; toId: string; runId: number | null; subject: string; body: string }[];
  const reasons = (id: number) => coord.runEvents(id).filter((e) => e.detail?.startsWith(DISPATCH_ABANDON_EVENT) === true);
  return { coord, reg, cfg, calls, plant, stalled, pass, stateOf, mail, reasons, acts: () => acts,
    advance: (ms: number) => { clock += ms; }, now: () => clock };
};

describe('the dead-dispatch reason of the dead-coordinator lane (D-7319)', () => {
  it('a dispatch that never came back is abandoned once: failed by sweep, its reason journaled, its coordinator mailed', async () => {
    const f = await fixture();
    const id = f.stalled(BOUND);
    await f.pass();
    expect(f.stateOf(id)).toBe('failed');
    const close = f.coord.runEvents(id).find((e) => e.toState === 'failed' && e.fromState === 'planned');
    expect(close?.causedBy).toBe('sweep');
    expect(f.reasons(id)).toHaveLength(1);
    expect(f.reasons(id)[0]!.detail).toMatch(new RegExp(`^${DISPATCH_ABANDON_EVENT} started=\\d+ bound=${BOUND}$`));
    expect(f.mail()).toEqual([expect.objectContaining({ fromId: 'operator', toId: COORD, runId: id, subject: DISPATCH_ABANDON_SUBJECT })]);
    expect(f.mail()[0]!.body).toMatch(/never came back/);
    expect(f.mail()[0]!.body).toMatch(/dispatch it again/);
    // The abandon of a run with no session asks the fleet nothing.
    expect(f.calls).toEqual([]);
    // A second pass finds nothing: one close, one reason, one mail.
    await f.pass();
    expect(f.reasons(id)).toHaveLength(1);
    expect(f.mail()).toHaveLength(1);
  });

  it('a workspace whose child marker names the run keeps it planned, and nothing is mailed', async () => {
    const f = await fixture();
    const id = f.stalled(BOUND * 2);
    f.plant('demo-w1', { workspace: 'w1', branch: 'ws/w1', child: String(id), started: '1' });
    await f.pass();
    expect(f.stateOf(id)).toBe('planned');
    expect(f.mail()).toEqual([]);
    expect(f.reasons(id)).toEqual([]);
  });

  it("a cut-short ws-add's shape in the run's project (no marker, no hold, never spawned) keeps it planned", async () => {
    const f = await fixture();
    const id = f.stalled(BOUND * 2);
    f.plant('demo-w2', { workspace: 'w2', branch: 'ws/w2' });
    await f.pass();
    expect(f.stateOf(id)).toBe('planned');
    expect(f.mail()).toEqual([]);
  });

  it('in flight: a stamp inside the bound is not touched, and the act is never asked', async () => {
    const f = await fixture();
    const id = f.stalled(BOUND - CHILD_RECLAIM_SWEEP_MS - 2);
    await f.pass();
    expect(f.stateOf(id)).toBe('planned');
    expect(f.acts()).toBe(0);
    // Past the bound on a later pass, it goes.
    await f.pass();
    expect(f.stateOf(id)).toBe('failed');
  });

  it('in flight: a retry that restamps the run between the verdict and the arm stops the arm (its re-measure)', async () => {
    let restamp = (): void => {};
    const f = await fixture({ beforeAbandon: () => restamp() });
    const id = f.stalled(BOUND);
    restamp = () => { f.coord.markDispatchStarted(id, f.now()); };
    await f.pass();
    expect(f.acts()).toBe(1);
    expect(f.stateOf(id)).toBe('planned');
    expect(f.mail()).toEqual([]);
    expect(f.reasons(id)).toEqual([]);
  });

  it('the switch off keeps every run planned; turned back on, the next pass abandons', async () => {
    const f = await fixture();
    const id = f.stalled(BOUND);
    f.coord.setDispatchAbandon('off', f.now());
    await f.pass();
    expect(f.stateOf(id)).toBe('planned');
    expect(f.acts()).toBe(0);
    f.coord.setDispatchAbandon('on', f.now());
    await f.pass();
    expect(f.stateOf(id)).toBe('failed');
  });

  it('the switch turned off between the verdict and the arm stops the arm', async () => {
    let off = (): void => {};
    const f = await fixture({ beforeAbandon: () => off() });
    const id = f.stalled(BOUND);
    off = () => { f.coord.setDispatchAbandon('off', f.now()); };
    await f.pass();
    expect(f.acts()).toBe(1);
    expect(f.stateOf(id)).toBe('planned');
    expect(f.mail()).toEqual([]);
  });

  it('the cleanup pause raised between the verdict and the arm stops the arm', async () => {
    let pause = (): void => {};
    const f = await fixture({ beforeAbandon: () => pause() });
    const id = f.stalled(BOUND);
    pause = () => { writeFileSync(path.join(f.reg, 'reclaim-paused'), ''); };
    await f.pass();
    expect(f.acts()).toBe(1);
    expect(f.stateOf(id)).toBe('planned');
  });

  it('a child workspace that appears between the verdict and the arm stops the arm', async () => {
    let child = (): void => {};
    const f = await fixture({ beforeAbandon: () => child() });
    const id = f.stalled(BOUND);
    child = () => { f.plant('demo-w4', { workspace: 'w4', branch: 'ws/w4', child: String(id), started: '1' }); };
    await f.pass();
    expect(f.stateOf(id)).toBe('planned');
    expect(f.mail()).toEqual([]);
  });

  it('the cleanup pause raised keeps it planned', async () => {
    const f = await fixture();
    const id = f.stalled(BOUND);
    writeFileSync(path.join(f.reg, 'reclaim-paused'), '');
    await f.pass();
    expect(f.stateOf(id)).toBe('planned');
    expect(f.mail()).toEqual([]);
  });

  it('a box that minted without the child marker cannot prove there is no workspace: kept', async () => {
    const f = await fixture();
    const id = f.stalled(BOUND);
    f.coord.recordRunEvent(id, 'coordinator', 'child-omitted:no-child-argv-cap');
    await f.pass();
    expect(f.stateOf(id)).toBe('planned');
  });

  it('a late child after the abandon: the run stays failed, and nothing is journaled or mailed again', async () => {
    const f = await fixture();
    const id = f.stalled(BOUND);
    await f.pass();
    expect(f.stateOf(id)).toBe('failed');
    f.plant('demo-w3', { workspace: 'w3', branch: 'ws/w3', child: String(id), started: '1' });
    await f.pass();
    await f.pass();
    expect(f.stateOf(id)).toBe('failed');
    expect(okRun(f.coord.run(id))!.sessionId).toBeNull();
    expect(f.reasons(id)).toHaveLength(1);
    expect(f.mail()).toHaveLength(1);
  });
});

describe('the dead-dispatch pass cap (D-7502)', () => {
  /** `n` stalled runs, opened newest stamp first so that id order is the reverse of stamp order: an oldest-first pass
   *  is then visibly not an id-order pass. Answers the ids oldest stamp first. */
  const herd = (f: Awaited<ReturnType<typeof fixture>>, n: number): number[] => {
    const ids: number[] = [];
    for (let i = 0; i < n; i += 1) ids.push(f.stalled(BOUND + (i + 1) * 1_000, `prog-${i}`));
    return ids.reverse();
  };

  it('the cap is 20 candidates a pass', () => {
    expect(DISPATCH_ABANDON_PER_PASS).toBe(20);
  });

  it('more candidates than the cap: one pass hands at most the cap to the arm, the oldest stamps first', async () => {
    let arms = 0;
    const f = await fixture({ beforeAbandon: () => { arms += 1; } });
    const ids = herd(f, DISPATCH_ABANDON_PER_PASS + 5);
    await f.pass();
    expect(arms).toBe(DISPATCH_ABANDON_PER_PASS);
    const oldest = ids.slice(0, DISPATCH_ABANDON_PER_PASS);
    const rest = ids.slice(DISPATCH_ABANDON_PER_PASS);
    expect(oldest.map((id) => f.stateOf(id))).toEqual(oldest.map(() => 'failed'));
    expect(rest.map((id) => f.stateOf(id))).toEqual(rest.map(() => 'planned'));
    expect(f.mail()).toHaveLength(DISPATCH_ABANDON_PER_PASS);
    expect(rest.flatMap((id) => f.reasons(id))).toEqual([]);
  });

  it('more candidates than the cap are all abandoned across passes, each once, no pass over the cap', async () => {
    let arms = 0;
    const f = await fixture({ beforeAbandon: () => { arms += 1; } });
    const total = DISPATCH_ABANDON_PER_PASS * 2 + 1;
    const ids = herd(f, total);
    const perPass: number[] = [];
    for (let p = 0; p < 4; p += 1) {
      arms = 0;
      await f.pass();
      perPass.push(arms);
    }
    expect(perPass).toEqual([DISPATCH_ABANDON_PER_PASS, DISPATCH_ABANDON_PER_PASS, 1, 0]);
    expect(ids.map((id) => f.stateOf(id))).toEqual(ids.map(() => 'failed'));
    expect(ids.map((id) => f.reasons(id).length)).toEqual(ids.map(() => 1));
    expect(f.mail()).toHaveLength(total);
  });
});
