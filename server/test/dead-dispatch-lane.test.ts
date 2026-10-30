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
//   * D-7563: the run's one child workspace came back with a live pane -> bound to it (the spawn arm's own store write),
//     journaled, not abandoned, not mailed, and the card's phantom gone; two children, another run's marker, a pane not
//     live, a session already named by a run, the switch off, or a pane that dies before the write -> never bound; a
//     second pass does nothing; the pass cap counts binds; a held child (or an unreadable hold), a child the child bind
//     gate refuses (spent, or unmeasured), and a child the run was once unbound from as spent -> never bound.
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
import { DISPATCH_ABANDON_DEFAULT_MS, DISPATCH_ABANDON_EVENT, DISPATCH_ABANDON_SUBJECT, DISPATCH_BIND_EVENT } from '../../shared/dispatch-abandon.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { okRun } from './coordReadHelpers.js';
import { DISPATCH_ABANDON_PER_PASS } from '../src/coord/abandonDeadDispatch.js';
import { bindReturnedChild } from '../src/coord/dispatch.js';

afterEach(() => { vi.restoreAllMocks(); });

const T0 = 1_790_000_000_000;
const COORD = 'demo-coord';
const BOUND = DISPATCH_ABANDON_DEFAULT_MS;

const fixture = async (opts: { beforeAbandon?: () => void; livePane?: (id: string) => boolean } = {}) => {
  let clock = T0;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const home = mkTmp('ccrc-dead-dispatch-lane-');
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(path.join(reg, '.lifecycle'), { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
  const calls: string[][] = [];
  // D-7563: the panes tmux answers live besides the coordinator's, and every id it was asked about.
  const live = new Set<string>();
  const asked: string[] = [];
  const prRows = new Map<string, unknown[]>();
  const livePane = (id: string): boolean => (opts.livePane ?? ((x: string) => live.has(x)))(id);
  const run: Runner = async (cmd, args) => {
    if (path.basename(cmd) === 'tmux') {
      if (args[0] !== 'has-session') return { ran: true, code: 1, stdout: '', stderr: '' };
      const id = (args[2] ?? '').replace(/^=cc-/, '').replace(/:$/, '');
      asked.push(id);
      return id === COORD || livePane(id) ? { ran: true, code: 0, stdout: '', stderr: '' } : { ran: true, code: 1, stdout: '', stderr: `can't find session: cc-${id}` };
    }
    calls.push(args);
    // D-7563: the child bind gate's `pr-state --session <id>` read. A child planted by `returned` below answers a
    // measured line with no PR on its branch (unspent); `prRows` hands a session the rows it answers instead.
    const pr = args.indexOf('pr-state');
    if (pr !== -1 && args[pr + 1] === '--session') {
      const id = args[pr + 2] ?? '';
      const line = { id, rows: prRows.get(id) ?? [], baseShort: 'main', branch: `ws/${id.replace(/^demo-/, '')}`, ahead: 1, tip: 'f'.repeat(40), checkedAt: 1 };
      return { ran: true, code: 0, stdout: `${JSON.stringify(line)}\n`, stderr: '' };
    }
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
  const binds = (id: number) => coord.runEvents(id).filter((e) => e.detail?.startsWith(DISPATCH_BIND_EVENT) === true);
  const sessionOf = (id: number) => okRun(coord.run(id))!.sessionId;
  return { coord, reg, cfg, calls, plant, stalled, pass, stateOf, mail, reasons, binds, sessionOf, live, asked, prRows, acts: () => acts,
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

describe('the returned child (D-7563): a run whose one child came back live is bound to it', () => {
  const returned = (f: Awaited<ReturnType<typeof fixture>>, id: number, ws = 'w9'): string => {
    const sid = `demo-${ws}`;
    f.plant(sid, { workspace: ws, branch: `ws/${ws}`, child: String(id), started: '1' });
    f.live.add(sid);
    return sid;
  };

  it("binds the run to the child, journals it once, abandons nothing, mails nothing, asks the fleet only the child gate's read", async () => {
    const f = await fixture();
    const id = f.stalled(BOUND * 2);
    const sid = returned(f, id);
    await f.pass();
    expect(f.stateOf(id)).toBe('planned');
    expect(f.sessionOf(id)).toBe(sid);
    expect(f.binds(id)).toHaveLength(1);
    expect(f.binds(id)[0]!.causedBy).toBe('sweep');
    expect(f.binds(id)[0]!.detail).toMatch(new RegExp(`^${DISPATCH_BIND_EVENT} session=${sid} started=\\d+$`));
    expect(f.reasons(id)).toEqual([]);
    expect(f.mail()).toEqual([]);
    // The one fleet read: the child bind gate's `pr-state` for the child (an unspent child: no PR on its branch).
    expect(f.calls).toEqual([['pr-state', '--session', sid]]);
    // The spawn arm's adopted shape: no birth dated, since the child may be an earlier attempt's.
    expect(f.coord.db.prepare('SELECT sessionBornAt, sessionBornFor FROM runs WHERE id = ?').get(id)).toEqual({ sessionBornAt: null, sessionBornFor: null });
  });

  it('idempotent: a second pass binds nothing again, journals nothing more, and the run is no longer a candidate', async () => {
    const f = await fixture();
    const id = f.stalled(BOUND * 2);
    const sid = returned(f, id);
    await f.pass();
    expect(f.coord.stalledDispatchRunIds(f.now())).not.toContain(id);
    await f.pass();
    expect(f.sessionOf(id)).toBe(sid);
    expect(f.binds(id)).toHaveLength(1);
    expect(f.stateOf(id)).toBe('planned');
    expect(f.mail()).toEqual([]);
  });

  it("the card's phantom child is gone: the run is no longer planned-and-unbound, so it binds a session row", async () => {
    const f = await fixture();
    const id = f.stalled(BOUND * 2);
    const sid = returned(f, id);
    const before = okRun(f.coord.run(id))!;
    expect(before.sessionId).toBeNull();
    await f.pass();
    const after = okRun(f.coord.run(id))!;
    // `nestFleet` draws "spawn never completed" only for a planned, stamped run whose session is not on the list
    // (`pwa/test/nest-fleet-returned-child.test.ts` pins that half); the run now names the child, which is.
    expect(after).toMatchObject({ state: 'planned', sessionId: sid });
    expect(after.dispatchStartedAt).toBe(before.dispatchStartedAt);
  });

  it('two children naming the run never bind: kept planned and unbound, as before', async () => {
    const f = await fixture();
    const id = f.stalled(BOUND * 2);
    returned(f, id, 'w8');
    returned(f, id, 'w9');
    await f.pass();
    expect(f.stateOf(id)).toBe('planned');
    expect(f.sessionOf(id)).toBeNull();
    expect(f.binds(id)).toEqual([]);
    expect(f.mail()).toEqual([]);
  });

  it("a live child whose marker names another run never binds this one: today's verdict stands", async () => {
    const f = await fixture();
    const id = f.stalled(BOUND * 2);
    returned(f, id + 100);
    await f.pass();
    expect(f.sessionOf(id)).toBeNull();
    expect(f.binds(id)).toEqual([]);
    // Today the pass reads no workspace for the run and abandons it.
    expect(f.stateOf(id)).toBe('failed');
  });

  it('a child whose pane is not live never binds: kept planned and unbound', async () => {
    const f = await fixture();
    const id = f.stalled(BOUND * 2);
    const sid = returned(f, id);
    f.live.delete(sid);
    await f.pass();
    expect(f.asked).toContain(sid);
    expect(f.stateOf(id)).toBe('planned');
    expect(f.sessionOf(id)).toBeNull();
    expect(f.binds(id)).toEqual([]);
  });

  it('a child session a run already names never binds', async () => {
    const f = await fixture();
    const id = f.stalled(BOUND * 2);
    const sid = returned(f, id);
    const other = f.coord.openRun({ program: 'prog-b', title: 'prog-b', project: 'demo', wave: 1, waveOf: 1, claimedBy: COORD });
    if (!('id' in other)) throw new Error('openRun refused');
    f.coord.setSession(other.id, sid);
    await f.pass();
    expect(f.stateOf(id)).toBe('planned');
    expect(f.sessionOf(id)).toBeNull();
    expect(f.binds(id)).toEqual([]);
  });

  it('a child the server unbound as spent is never bound back: no ping-pong with the resume arm', async () => {
    const f = await fixture();
    const id = f.stalled(BOUND * 2);
    const sid = returned(f, id);
    await f.pass();
    expect(f.sessionOf(id)).toBe(sid);
    // The resume arm's `refuseSpentChild` for workspace-spent: the one unbind, the dispatch stamp left as it was.
    expect(f.coord.clearSession(id, 42)).toEqual({ ok: true, cleared: true });
    expect(f.coord.stalledDispatchRunIds(f.now())).toContain(id);
    await f.pass();
    expect(f.sessionOf(id)).toBeNull();
    expect(f.binds(id)).toHaveLength(1);
    expect(f.stateOf(id)).toBe('planned');
    await f.pass();
    expect(f.sessionOf(id)).toBeNull();
    expect(f.binds(id)).toHaveLength(1);
  });

  it('a spent child (a PR of its own) that no run ever bound is refused by the child bind gate: never bound', async () => {
    const f = await fixture();
    const id = f.stalled(BOUND * 2);
    const sid = returned(f, id);
    f.plant(sid, { prnumber: '42' });
    await f.pass();
    expect(f.sessionOf(id)).toBeNull();
    expect(f.binds(id)).toEqual([]);
    expect(f.stateOf(id)).toBe('planned');
  });

  it("a child whose pr-state the gate cannot measure is never bound (the gate's spent-unmeasured)", async () => {
    const f = await fixture();
    const id = f.stalled(BOUND * 2);
    const sid = returned(f, id);
    f.prRows.set(sid, [{ number: 7, headRefName: 'ws/w9' }]);
    await f.pass();
    expect(f.sessionOf(id)).toBeNull();
    expect(f.binds(id)).toEqual([]);
  });

  it('a held child never binds: a claim someone placed on it', async () => {
    const f = await fixture();
    const id = f.stalled(BOUND * 2);
    const sid = returned(f, id);
    f.plant(sid, { hold: 'program prog-b' });
    await f.pass();
    expect(f.sessionOf(id)).toBeNull();
    expect(f.binds(id)).toEqual([]);
    expect(f.stateOf(id)).toBe('planned');
  });

  it('a child whose hold cannot be read never binds (an unreadable hold reads held)', async () => {
    const f = await fixture();
    const id = f.stalled(BOUND * 2);
    const sid = returned(f, id);
    // Listed, but its bytes cannot be read: a directory where the file should be.
    mkdirSync(path.join(f.reg, `${sid}.hold`));
    await f.pass();
    expect(f.sessionOf(id)).toBeNull();
    expect(f.binds(id)).toEqual([]);
    expect(f.stateOf(id)).toBe('planned');
  });

  it('the switch off binds nothing and asks tmux nothing', async () => {
    const f = await fixture();
    const id = f.stalled(BOUND * 2);
    const sid = returned(f, id);
    f.coord.setDispatchAbandon('off', f.now());
    await f.pass();
    expect(f.sessionOf(id)).toBeNull();
    expect(f.binds(id)).toEqual([]);
    expect(f.asked).not.toContain(sid);
  });

  it('a pane that dies between the verdict and the write stops the bind (its re-measure)', async () => {
    let asks = 0;
    const f = await fixture({ livePane: (x) => x === 'demo-w9' && (asks += 1) === 1 });
    const id = f.stalled(BOUND * 2);
    returned(f, id);
    await f.pass();
    expect(asks).toBe(2);
    expect(f.sessionOf(id)).toBeNull();
    expect(f.binds(id)).toEqual([]);
    expect(f.stateOf(id)).toBe('planned');
  });

  it('the pass cap counts binds: more returned children than the cap bind at most the cap a pass', async () => {
    const f = await fixture();
    const ids: number[] = [];
    for (let i = 0; i < DISPATCH_ABANDON_PER_PASS + 3; i += 1) {
      const id = f.stalled(BOUND + (i + 1) * 1_000, `prog-${i}`);
      returned(f, id, `w${i}`);
      ids.push(id);
    }
    await f.pass();
    expect(ids.filter((id) => f.sessionOf(id) !== null)).toHaveLength(DISPATCH_ABANDON_PER_PASS);
    await f.pass();
    expect(ids.filter((id) => f.sessionOf(id) !== null)).toHaveLength(ids.length);
    expect(ids.map((id) => f.binds(id).length)).toEqual(ids.map(() => 1));
  });
});

describe("bindReturnedChild (D-7563): the spawn arm's write, refused on any change since the pass measured", () => {
  it('binds a planned, unbound run with the same claimant and stamp; refuses each change, writing nothing', async () => {
    const f = await fixture();
    const id = f.stalled(BOUND * 2);
    const startedAt = okRun(f.coord.run(id))!.dispatchStartedAt!;
    const ask = (over: Partial<{ claimedBy: string; startedAt: number }> = {}) =>
      bindReturnedChild(f.coord, { runId: id, sessionId: 'demo-w9', claimedBy: COORD, startedAt, ...over });
    expect(ask({ claimedBy: 'demo-other' })).toMatchObject({ ok: false });
    expect(ask({ startedAt: startedAt + 1 })).toMatchObject({ ok: false });
    expect(bindReturnedChild(f.coord, { runId: id + 1000, sessionId: 'demo-w9', claimedBy: COORD, startedAt })).toMatchObject({ ok: false });
    expect(f.sessionOf(id)).toBeNull();
    expect(ask()).toEqual({ ok: true });
    expect(f.sessionOf(id)).toBe('demo-w9');
    // Bound now: a second ask refuses and leaves the session it bound.
    expect(bindReturnedChild(f.coord, { runId: id, sessionId: 'demo-w8', claimedBy: COORD, startedAt })).toMatchObject({ ok: false });
    expect(f.sessionOf(id)).toBe('demo-w9');
  });

  it("dates no birth (the adopted arm's null): another run's recorded birth for that session is never copied onto it", async () => {
    const f = await fixture();
    const id = f.stalled(BOUND * 2);
    const startedAt = okRun(f.coord.run(id))!.dispatchStartedAt!;
    // An earlier run that once recorded a birth for this session id, since bound elsewhere.
    const old = f.stalled(BOUND * 3, 'prog-old');
    f.coord.db.prepare('UPDATE runs SET sessionBornAt = dispatchStartedAt, sessionBornFor = ? WHERE id = ?').run('demo-w9', old);
    expect(bindReturnedChild(f.coord, { runId: id, sessionId: 'demo-w9', claimedBy: COORD, startedAt })).toEqual({ ok: true });
    expect(f.coord.db.prepare('SELECT sessionBornAt, sessionBornFor FROM runs WHERE id = ?').get(id)).toEqual({ sessionBornAt: null, sessionBornFor: null });
  });

  it('refuses a run that is no longer planned', async () => {
    const f = await fixture();
    const id = f.stalled(BOUND * 2);
    const startedAt = okRun(f.coord.run(id))!.dispatchStartedAt!;
    f.coord.advance(id, 'failed', 'operator');
    expect(bindReturnedChild(f.coord, { runId: id, sessionId: 'demo-w9', claimedBy: COORD, startedAt })).toMatchObject({ ok: false });
    expect(f.sessionOf(id)).toBeNull();
  });
});
