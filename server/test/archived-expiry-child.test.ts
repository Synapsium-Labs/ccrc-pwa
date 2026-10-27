import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { FleetWatcher, CHILD_RECLAIM_SWEEP_MS } from '../src/watch.js';
import { readRegistry, type SessionRecord } from '../src/registry.js';
import { loadConfig } from '../src/config.js';
import { CoordStore } from '../src/coord/store.js';
import { expireArchived } from '../src/coord/expireArchived.js';
import { openCoordDb } from '../src/coord/db.js';
import { ACTOR_FLAGS_CAP, EXPIRE_CAP, EXPIRE_CHILD_CAP } from '../src/ccdargv.js';
import {
  EXPIRE_AUDITS_PER_PASS, EXPIRE_FAILURE_CEILING_MS, EXPIRE_IN_USE_ATTENTION_PASSES, EXPIRE_LANE_LIVE_MARKER, EXPIRE_NO_EVIDENCE_RETRY_MS,
  EXPIRE_PERSISTENT_RETRY_MS, EXPIRE_CHILD_LIVE_MARKER, archivedExpiryVerdict, type ArchivedExpiryInput,
} from '../src/archivedExpiry.js';
import { NotifyLog } from '../src/notifylog.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

afterEach(() => { vi.restoreAllMocks(); });

const WEEK = 604_800;
const T0 = 1_790_000_000_000;
const OLD = T0 / 1000 - 8 * 86_400;
const tokOf = (id: string): string => (id.length.toString(16) + 'f'.repeat(64)).slice(0, 64);
type Answer = { ran: true; code: number; stdout: string; stderr: string };

interface Opts {
  cap?: boolean;
  /** Whether the box advertises `expire-child-v1` (default: it does). */
  childCap?: boolean;
  /** Per session, what `ws-audit --expire` answers (default: expirable, with the archive on disk). */
  audit?: (id: string, archivedAt: number) => Record<string, unknown> | 'old-ccd';
  /** Per session, what `ws-expire` answers (default: the `expired` document). */
  expire?: (id: string) => Answer;
  /** Called as `ws-audit` is asked about `id` — the moment a pass is learning, or an act is auditing. */
  onAudit?: (id: string) => void;
  /** When given, the FIRST `ws-expire` waits on it — an act still in flight; any later one answers at once. */
  hold?: Promise<void>;
}

const fixture = async (opts: Opts = {}) => {
  let clock = T0;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const home = mkTmp('ccrc-expiry-lane-');
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
  const calls: string[][] = [];
  let hold = opts.hold;
  const archivedOf = (id: string): number => Number(readdirSync(reg).includes(`${id}.archived`)
    ? readFileSync(path.join(reg, `${id}.archived`), 'utf8').trim() : 0);
  const run = async (cmd: string, args: string[]): Promise<Answer> => {
    if (path.basename(cmd) === 'tmux') return { ran: true, code: 1, stdout: '', stderr: '' };   // the tick's pane reads, not ccd
    calls.push(args);
    const id = args[args.indexOf('--session') + 1] ?? '';
    if (args[0] === 'ws-audit') {
      opts.onAudit?.(id);
      const at = archivedOf(id);
      const doc = opts.audit?.(id, at) ?? { verdict: 'expirable', token: tokOf(id) };
      if (doc === 'old-ccd') {
        return { ran: true, code: 0, stdout: JSON.stringify({ session: id, mode: 'expire', archivedAt: at, alive: false, exists: true,
          reaping: null, sensitive: [], verdict: 'expirable', detail: '', token: tokOf(id) }), stderr: '' };
      }
      return { ran: true, code: 0, stdout: JSON.stringify({ session: id, mode: 'expire', archivedAt: at, expiresAt: at + WEEK,
        alive: false, exists: true, reaping: null, sensitive: [], detail: '', ...doc }), stderr: '' };
    }
    if (args[0] === 'ws-expire') {
      if (hold !== undefined) { const h = hold; hold = undefined; await h; }
      return opts.expire?.(id) ?? { ran: true, code: 0, stdout: JSON.stringify({ expired: id, archivedAt: archivedOf(id), wip: null,
        attic: 2, residueBytes: 0, secretsDropped: 0 }), stderr: '' };
    }
    return { ran: true, code: 1, stdout: '', stderr: '' };
  };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const deps = {
    ...testDeps(home, run), cfg, coord, notifyLog,
    // The lane's cadence reads the monotonic clock (D-5862): the fixture's one fake clock stands for both.
    monotonicMs: () => clock,
    fleetState: { connected: true, downSince: null, rosterFp: null, build: null,
      ccdVerbs: ['ws-audit', 'ws-expire', ...(opts.cap === false ? [] : [EXPIRE_CAP]), ...(opts.childCap === false ? [] : [EXPIRE_CHILD_CAP]), ACTOR_FLAGS_CAP] },
    viewers: { isVisible: () => false },
  };
  const watcher = new FleetWatcher(deps as never, new Bus(), 10_000);
  /** An archived workspace, as `ws-archive` leaves it: the epoch in `.archived`. */
  const plant = (id: string, archivedAt = OLD, extra: Record<string, string> = {}): void => {
    const fields: Record<string, string> = { uuid: `u-${id}`, wrapper: 'claude', project: 'demo', workdir: `/w/${id}`,
      workspace: id.slice('demo-'.length), branch: `ws/${id}`, base: 'origin/main', started: '1',
      archived: String(archivedAt), archivedreason: 'operator', ...extra };
    for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${f}`), v);
  };
  /** One pass, over the registry as read; `edit` stands for a registry read this fixture cannot plant on disk. */
  const pass = async (edit: (r: SessionRecord) => SessionRecord = (r) => r): Promise<void> => {
    await watcher.sweepArchivedExpiry((await readRegistry(deps.io, cfg)).map(edit), readdirSync(reg));
  };
  const next = (): void => { clock += CHILD_RECLAIM_SWEEP_MS + 1; };
  const verbsFor = (verb: string): string[] => calls.filter((c) => c[0] === verb).map((c) => c[c.indexOf('--session') + 1]!);
  const touch = (name: string): void => writeFileSync(path.join(reg, name), '');
  const feed = () => coord.feedEvents(50).map((e) => [e.sessionId, e.title] as const);
  /** An open WORK run with `worker` dispatched into it, claimed by `claimedBy`. */
  const bindWorker = (worker: string, claimedBy = 'demo-coord'): number => {
    const r = coord.openRun({ program: 'p', title: 'p', project: 'demo', wave: 1, waveOf: null, claimedBy });
    if (!('id' in r)) throw new Error('openRun refused');
    coord.markDispatched(r.id, worker, worker, `ws/${worker}`, false);
    return r.id;
  };
  return { reg, coord, watcher, calls, plant, pass, next, verbsFor, touch, feed, bindWorker,
    advance: (ms: number) => { clock += ms; }, entry: (id: string) => watcher.currentArchivedExpiry().get(id) };
};
type Fixture = Awaited<ReturnType<typeof fixture>>;

const threePasses = async (f: Fixture): Promise<void> => {
  await f.pass(); f.next(); await f.pass(); f.next(); await f.pass();
};
const expireArgv = (f: Fixture, verb: string): string[][] => f.calls.filter((c) => c[0] === verb);

describe('the verdict: a child mark is the child arm’s (D-6641, spec 2.7.4)', () => {
  const base: ArchivedExpiryInput = {
    sessionId: 'demo-a', workspace: 'ws/a', archivedAt: 1, child: { kind: 'child', runId: 7 }, identityMeasured: true,
    held: null, store: { ok: true, openWorker: false, openClaimant: false, reviewing: false }, expiresAt: 10, nowMs: 20_000,
  };
  it('eligible only with the capability and the marker', () => {
    expect(archivedExpiryVerdict({ ...base, childArm: { cap: true, live: true } })).toEqual({ eligible: true });
    expect(archivedExpiryVerdict({ ...base, childArm: { cap: true, live: false } })).toEqual({ eligible: false, why: 'child-shadow' });
    expect(archivedExpiryVerdict({ ...base, childArm: { cap: false, live: true } })).toEqual({ eligible: false, why: 'child' });
    expect(archivedExpiryVerdict(base)).toEqual({ eligible: false, why: 'child' });
  });
  it('an unreadable mark always skips', () => {
    expect(archivedExpiryVerdict({ ...base, child: { kind: 'unreadable' }, childArm: { cap: true, live: true } }))
      .toEqual({ eligible: false, why: 'child' });
  });
  it('a child that ever coordinated (or whose read is in doubt) is kept; an unasked store is not', () => {
    const arm = { cap: true, live: true };
    const st = (coordinated?: boolean | null) => ({ ok: true as const, openWorker: false, openClaimant: false, reviewing: false,
      ...(coordinated === undefined ? {} : { coordinated }) });
    expect(archivedExpiryVerdict({ ...base, childArm: arm, store: st(true) })).toEqual({ eligible: false, why: 'coordinating' });
    expect(archivedExpiryVerdict({ ...base, childArm: arm, store: st(null) })).toEqual({ eligible: false, why: 'coordinating' });
    expect(archivedExpiryVerdict({ ...base, childArm: arm, store: st(false) })).toEqual({ eligible: true });
  });
  it('the store rules and the instant apply to a child as to anyone', () => {
    const arm = { cap: true, live: true };
    expect(archivedExpiryVerdict({ ...base, childArm: arm, store: { ok: true, openWorker: true, openClaimant: false, reviewing: false } }))
      .toEqual({ eligible: false, why: 'open-run' });
    expect(archivedExpiryVerdict({ ...base, childArm: arm, store: { ok: true, openWorker: false, openClaimant: true, reviewing: false } }))
      .toEqual({ eligible: false, why: 'coordinating' });
    expect(archivedExpiryVerdict({ ...base, childArm: arm, store: { ok: true, openWorker: false, openClaimant: false, reviewing: true } }))
      .toEqual({ eligible: false, why: 'review-open' });
    expect(archivedExpiryVerdict({ ...base, childArm: arm, nowMs: 5_000 })).toEqual({ eligible: false, why: 'not-yet' });
  });
});

describe('the lane: an archived child past its instant (D-6641)', () => {
  it('without the marker: audited with the run, recorded once as “would be expired (child)”, and no ws-expire', async () => {
    const f = await fixture();
    f.plant('demo-a', OLD, { child: '7' }); f.touch(EXPIRE_LANE_LIVE_MARKER);
    await threePasses(f); f.next(); await f.pass();
    expect(expireArgv(f, 'ws-audit')[0]).toEqual(['ws-audit', '--session', 'demo-a', '--expire', '--child-of', '7']);
    expect(expireArgv(f, 'ws-expire')).toEqual([]);
    expect(f.feed().filter(([, t]) => t.includes('child'))).toHaveLength(1);
    // The durable shadow journal (D-6861): the lane is live and only the child arm holds it back.
    expect(f.coord.shadowVerdicts({ lane: null, subject: null, limit: 10 }, Date.now()))
      .toMatchObject([{ lane: 'expire-child', subject: 'demo-a', rung: 'child-shadow' }]);
  });

  it('with neither marker: the feed row stands, and the shadow journal does not call it the child arm’s (D-6861)', async () => {
    const f = await fixture();
    f.plant('demo-a', OLD, { child: '7' });
    await threePasses(f); f.next(); await f.pass();
    expect(f.feed().filter(([, t]) => t.includes('child'))).toHaveLength(1);
    expect(f.coord.shadowVerdicts({ lane: null, subject: null, limit: 10 }, Date.now())).toEqual([]);
  });

  it('with the child marker but not the lane’s: the executor answers would-expire and composes nothing', async () => {
    const f = await fixture();
    f.plant('demo-a', OLD, { child: '7' }); f.touch(EXPIRE_CHILD_LIVE_MARKER);
    await threePasses(f);
    expect(expireArgv(f, 'ws-expire')).toEqual([]);
    expect(f.feed().some(([id, t]) => id === 'demo-a' && t.includes('would be cleaned up'))).toBe(true);
    expect(f.coord.shadowVerdicts({ lane: null, subject: null, limit: 10 }, Date.now())).toEqual([]);
  });

  it('armed on both: ws-expire carries --child-of and the run', async () => {
    const f = await fixture();
    f.plant('demo-a', OLD, { child: '7' }); f.touch(EXPIRE_CHILD_LIVE_MARKER); f.touch(EXPIRE_LANE_LIVE_MARKER);
    await threePasses(f);
    const [call] = expireArgv(f, 'ws-expire');
    expect(call).toBeDefined();
    expect(call!.slice(call!.indexOf('--child-of'), call!.indexOf('--child-of') + 2)).toEqual(['--child-of', '7']);
    expect(call!.indexOf('--child-of')).toBeGreaterThan(call!.indexOf('--expect'));
  });

  it('a plain archive never carries the flag', async () => {
    const f = await fixture();
    f.plant('demo-a'); f.touch(EXPIRE_CHILD_LIVE_MARKER); f.touch(EXPIRE_LANE_LIVE_MARKER);
    await threePasses(f);
    expect(expireArgv(f, 'ws-expire').length).toBe(1);
    expect(f.calls.flat()).not.toContain('--child-of');
  });

  it('an unreadable mark is never audited or expired', async () => {
    const f = await fixture();
    f.plant('demo-a', OLD, { child: 'junk' }); f.touch(EXPIRE_CHILD_LIVE_MARKER); f.touch(EXPIRE_LANE_LIVE_MARKER);
    await threePasses(f);
    expect(f.calls.filter((c) => c[0] === 'ws-audit' || c[0] === 'ws-expire')).toEqual([]);
  });

  it('a box without expire-child-v1 is never sent the flag, nor asked about the child', async () => {
    const f = await fixture({ childCap: false });
    f.plant('demo-a', OLD, { child: '7' }); f.touch(EXPIRE_CHILD_LIVE_MARKER); f.touch(EXPIRE_LANE_LIVE_MARKER);
    await threePasses(f);
    expect(f.calls.flat()).not.toContain('--child-of');
    expect(expireArgv(f, 'ws-expire')).toEqual([]);
  });

  it('a child whose run is still open is skipped, as for anyone', async () => {
    const f = await fixture();
    f.plant('demo-a', OLD, { child: '7' }); f.touch(EXPIRE_CHILD_LIVE_MARKER); f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.bindWorker('demo-a');
    await threePasses(f);
    expect(expireArgv(f, 'ws-expire')).toEqual([]);
  });
});

describe('a child that coordinated is never taken (spec §4, what stays excluded)', () => {
  const coordinated = (f: Fixture): void => {
    const r = f.coord.openRun({ program: 'p', title: 'p', project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-a' });
    if (!('id' in r)) throw new Error('openRun refused');
    f.coord.closeRun({ runId: r.id, finalState: 'failed', causedBy: 'test', handoffCommit: null, program: 'p', viaClosing: false });
  };
  it('lane: a terminal run once claimed by the child keeps it from ws-expire, armed on both markers', async () => {
    const f = await fixture();
    f.plant('demo-a', OLD, { child: '7' }); f.touch(EXPIRE_CHILD_LIVE_MARKER); f.touch(EXPIRE_LANE_LIVE_MARKER);
    coordinated(f);
    expect(f.coord.childReclaimCoordinatorClaims().has('demo-a')).toBe(true);
    await threePasses(f);
    expect(expireArgv(f, 'ws-expire')).toEqual([]);
  });
  it('executor: re-read at the act, a coordinated child defers as coordinating', async () => {
    const f = await fixture();
    f.plant('demo-a', OLD, { child: '7' }); f.touch(EXPIRE_CHILD_LIVE_MARKER); f.touch(EXPIRE_LANE_LIVE_MARKER);
    coordinated(f);
    const calls: string[][] = [];
    const home = mkTmp('ccrc-expiry-exec2-'); seedRoster(home);
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: home } as never);
    const deps = { ...testDeps(home, async (_c: string, a: string[]) => { calls.push(a); return { ran: true, code: 1, stdout: '', stderr: '' }; }),
      cfg: { ...cfg, registryDir: f.reg }, coord: f.coord,
      fleetState: { connected: true, downSince: null, rosterFp: null, build: null, ccdVerbs: ['ws-audit', 'ws-expire', EXPIRE_CAP, ACTOR_FLAGS_CAP, EXPIRE_CHILD_CAP] } };
    const result = await expireArchived(deps as never, { sessionId: 'demo-a', archivedAt: OLD, expiresAt: OLD + WEEK, childOf: 7, rowUuid: 'u-demo-a' });
    expect(result).toMatchObject({ kind: 'deferred', why: 'coordinating' });
    expect(calls).toEqual([]);
  });
});

describe('the executor re-asks both gates at the act (D-6641)', () => {
  const exec = async (opts: { childCap: boolean; markers: string[] }) => {
    const f = await fixture({ childCap: opts.childCap });
    f.plant('demo-a', OLD, { child: '7' });
    for (const m of opts.markers) f.touch(m);
    const home = mkTmp('ccrc-expiry-exec-'); seedRoster(home);
    const calls: string[][] = [];
    const run = async (_cmd: string, args: string[]): Promise<Answer> => {
      calls.push(args);
      return { ran: true, code: 0, stdout: JSON.stringify({ session: 'demo-a', mode: 'expire', archivedAt: OLD, expiresAt: OLD + WEEK,
        alive: false, exists: true, reaping: null, sensitive: [], detail: '', verdict: 'expirable', token: tokOf('demo-a') }), stderr: '' };
    };
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: home } as never);
    const deps = { ...testDeps(home, run), cfg: { ...cfg, registryDir: f.reg }, coord: f.coord,
      fleetState: { connected: true, downSince: null, rosterFp: null, build: null,
        ccdVerbs: ['ws-audit', 'ws-expire', EXPIRE_CAP, ACTOR_FLAGS_CAP, ...(opts.childCap ? [EXPIRE_CHILD_CAP] : [])] } };
    const result = await expireArchived(deps as never, { sessionId: 'demo-a', archivedAt: OLD, expiresAt: OLD + WEEK, childOf: 7 });
    return { result, calls };
  };
  it('the lane’s marker alone does not arm a child: would-expire, no verb', async () => {
    const { result, calls } = await exec({ childCap: true, markers: [EXPIRE_LANE_LIVE_MARKER] });
    expect(result).toMatchObject({ kind: 'would-expire', childArmHeld: true });
    expect(calls.filter((c) => c[0] === 'ws-expire')).toEqual([]);
  });
  it('an unarmed lane holds a child too, and that is not the child arm’s hold (D-6861)', async () => {
    for (const markers of [[], [EXPIRE_CHILD_LIVE_MARKER]]) {
      const { result } = await exec({ childCap: true, markers });
      expect(result.kind, markers.join()).toBe('would-expire');
      expect(result.childArmHeld, markers.join()).toBeUndefined();
    }
  });
  it('a box without expire-child-v1 gets no call at all for a child', async () => {
    const { result, calls } = await exec({ childCap: false, markers: [EXPIRE_LANE_LIVE_MARKER, EXPIRE_CHILD_LIVE_MARKER] });
    expect(result).toMatchObject({ kind: 'deferred', why: 'unsupported' });
    expect(calls).toEqual([]);
  });
});
