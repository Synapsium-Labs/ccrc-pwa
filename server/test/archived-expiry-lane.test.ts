// THE EXPIRY LANE, wired (workspace lifecycle spec 2026-09-24 §5.3 "The lane", wave 3b). `archived-expiry-policy`
// pins the L1 verdicts and `expire-archived` the executor; what is only provable HERE is what reaches ccd, when and how
// often: SHADOW composes no `ws-expire` however long a row has been due; `expire-lane-live` lets exactly one through
// per pass, fleet-wide, and one pass runs at a time; `reclaim-paused` stops everything, shadow included; the instant
// is LEARNED from ccd once per archive and never re-asked before it; an older ccd is no evidence; the lane's own
// reading of every do-not-touch condition keeps a row from ever becoming eligible; and the attention list reaches the
// coord frame. NOTHING here reaches a box: ccd is a scripted recorder, and the registry is a fixture HOME's.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { FleetWatcher, CHILD_RECLAIM_SWEEP_MS } from '../src/watch.js';
import { readRegistry, type SessionRecord } from '../src/registry.js';
import { loadConfig } from '../src/config.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { ACTOR_FLAGS_CAP, EXPIRE_CAP } from '../src/ccdargv.js';
import {
  EXPIRE_AUDITS_PER_PASS, EXPIRE_IN_USE_ATTENTION_PASSES, EXPIRE_LANE_LIVE_MARKER, EXPIRE_NO_EVIDENCE_RETRY_MS,
} from '../src/archivedExpiry.js';
import { NotifyLog } from '../src/notifylog.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

afterEach(() => { vi.restoreAllMocks(); });

const WEEK = 604_800;
const T0 = 1_790_000_000_000;
const OLD = T0 / 1000 - 8 * 86_400;
const tokOf = (id: string): string => (id.length.toString(16) + 'f'.repeat(64)).slice(0, 64);
type Answer = { code: number; stdout: string; stderr: string };

interface Opts {
  cap?: boolean;
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
    if (path.basename(cmd) === 'tmux') return { code: 1, stdout: '', stderr: '' };   // the tick's pane reads, not ccd
    calls.push(args);
    const id = args[args.indexOf('--session') + 1] ?? '';
    if (args[0] === 'ws-audit') {
      opts.onAudit?.(id);
      const at = archivedOf(id);
      const doc = opts.audit?.(id, at) ?? { verdict: 'expirable', token: tokOf(id) };
      if (doc === 'old-ccd') {
        return { code: 0, stdout: JSON.stringify({ session: id, mode: 'expire', archivedAt: at, alive: false, exists: true,
          reaping: null, sensitive: [], verdict: 'expirable', detail: '', token: tokOf(id) }), stderr: '' };
      }
      return { code: 0, stdout: JSON.stringify({ session: id, mode: 'expire', archivedAt: at, expiresAt: at + WEEK,
        alive: false, exists: true, reaping: null, sensitive: [], detail: '', ...doc }), stderr: '' };
    }
    if (args[0] === 'ws-expire') {
      if (hold !== undefined) { const h = hold; hold = undefined; await h; }
      return opts.expire?.(id) ?? { code: 0, stdout: JSON.stringify({ expired: id, archivedAt: archivedOf(id), wip: null,
        attic: 2, residueBytes: 0, secretsDropped: 0 }), stderr: '' };
    }
    return { code: 1, stdout: '', stderr: '' };
  };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const deps = {
    ...testDeps(home, run), cfg, coord, notifyLog,
    fleetState: { connected: true, downSince: null, rosterFp: null, build: null,
      ccdVerbs: ['ws-audit', 'ws-expire', ...(opts.cap === false ? [] : [EXPIRE_CAP]), ACTOR_FLAGS_CAP] },
    presence: { isVisible: () => false },
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

/** Three passes: the instant is learned, eligibility is seen once, and seen again — the row is due on the third. */
const threePasses = async (f: Fixture): Promise<void> => {
  await f.pass(); f.next(); await f.pass(); f.next(); await f.pass();
};

describe('the lane SHIPS SHADOWED', () => {
  it('without `expire-lane-live`, a due row is audited and RECORDED — and ws-expire is never composed, however long', async () => {
    const f = await fixture();
    f.plant('demo-a');
    await threePasses(f);
    for (let k = 0; k < 20; k += 1) { f.next(); await f.pass(); }
    expect(f.verbsFor('ws-expire'), 'shadow composes nothing destructive').toEqual([]);
    expect(f.verbsFor('ws-audit').length).toBeGreaterThan(0);
    expect(f.feed()).toContainEqual(['demo-a', 'archived workspace would be cleaned up']);
    expect(f.feed().filter(([, t]) => t === 'archived workspace would be cleaned up'), 'one row, not one a pass').toHaveLength(1);
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.expiryAttention?.map((a) => [a.sessionId, a.kind])).toEqual([['demo-a', 'would-expire']]);
    expect(f.watcher.currentCoord()?.childReclaimAttention, 'never the child lane’s list').toEqual([]);
  });

  it('with `expire-lane-live`, the due row is expired with its audit’s token — twice observed, never on the first sighting', async () => {
    const f = await fixture();
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-a');
    await f.pass();
    expect(f.verbsFor('ws-expire'), 'pass 1 learns the instant').toEqual([]);
    f.next(); await f.pass();
    expect(f.verbsFor('ws-expire'), 'pass 2 is the first eligible sighting').toEqual([]);
    f.next(); await f.pass();
    expect(f.verbsFor('ws-expire')).toEqual(['demo-a']);
    const verb = f.calls.find((c) => c[0] === 'ws-expire')!;
    expect(verb.slice(0, 5)).toEqual(['ws-expire', '--expect', tokOf('demo-a'), '--session', 'demo-a']);
    expect(f.feed()).toContainEqual(['demo-a', 'archived workspace cleaned up']);
    expect(f.entry('demo-a'), 'finished with').toBeUndefined();
  });

  it('at most ONE ws-expire is composed per pass, fleet-wide', async () => {
    const f = await fixture();
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-a'); f.plant('demo-b'); f.plant('demo-c');
    await threePasses(f);
    expect(f.verbsFor('ws-expire')).toHaveLength(1);
    f.next(); await f.pass();
    expect(f.verbsFor('ws-expire')).toHaveLength(2);
    f.next(); await f.pass();
    expect(f.verbsFor('ws-expire').sort()).toEqual(['demo-a', 'demo-b', 'demo-c']);
  });
});

describe('one pass at a time, at the lane’s own cadence', () => {
  it('a pass that finds another still running returns at once — never a second act while one is in flight', async () => {
    let release = (): void => {};
    const hold = new Promise<void>((r) => { release = r; });
    const f = await fixture({ hold });
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-a'); f.plant('demo-b');
    await f.pass(); f.next(); await f.pass(); f.next();
    const slow = f.pass();   // pass 3 acts, and its ws-expire hangs
    await vi.waitFor(() => { expect(f.verbsFor('ws-expire')).toHaveLength(1); });
    const audits = f.verbsFor('ws-audit').length;
    f.next(); await f.pass();   // a whole cadence later, the act still in flight
    expect(f.verbsFor('ws-expire'), 'no second act beside the first').toHaveLength(1);
    expect(f.verbsFor('ws-audit'), 'nor anything else: the second pass did not run').toHaveLength(audits);
    release();
    await slow;
  });

  it('a second call inside the cadence does nothing — the lane’s own clock, not the caller’s', async () => {
    const f = await fixture();
    f.plant('demo-a', T0 / 1000 - 3600);
    await f.pass();
    writeFileSync(path.join(f.reg, 'demo-a.archived'), String(T0 / 1000 - 60));   // a fresh archive to learn
    await f.pass();
    expect(f.verbsFor('ws-audit'), 'within the cadence: nothing asked').toEqual(['demo-a']);
    f.next(); await f.pass();
    expect(f.verbsFor('ws-audit')).toEqual(['demo-a', 'demo-a']);
  });

  it(`learns at most ${EXPIRE_AUDITS_PER_PASS} rows’ instants a pass — the first armed pass never asks the box for all of them`, async () => {
    const f = await fixture();
    for (const id of ['demo-a', 'demo-b', 'demo-c', 'demo-d']) f.plant(id, T0 / 1000 - 3600);
    await f.pass();
    expect(f.verbsFor('ws-audit')).toHaveLength(EXPIRE_AUDITS_PER_PASS);
    f.next(); await f.pass();
    expect(f.verbsFor('ws-audit').sort(), 'the fourth on the next pass').toEqual(['demo-a', 'demo-b', 'demo-c', 'demo-d']);
  });
});

describe('`reclaim-paused` — the one cleanup switch — stops the lane ENTIRELY', () => {
  it('no audit, no record, no verb, live or shadow', async () => {
    for (const live of [false, true]) {
      const f = await fixture();
      if (live) f.touch(EXPIRE_LANE_LIVE_MARKER);
      f.touch('reclaim-paused');
      f.plant('demo-a');
      await threePasses(f);
      f.next(); await f.pass();
      expect(f.calls, `paused, live=${live}`).toEqual([]);
      expect(f.feed()).toEqual([]);
    }
  });

  it('a sighting from BEFORE the pause is forgotten: lowered, the row needs two fresh passes', async () => {
    const f = await fixture();
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-a');
    await f.pass(); f.next(); await f.pass();   // learned, and sighted eligible once
    expect(f.entry('demo-a')?.eligibleSince).not.toBeNull();
    f.touch('reclaim-paused');
    f.next(); await f.pass();
    rmSync(path.join(f.reg, 'reclaim-paused'));
    f.next(); await f.pass();
    expect(f.verbsFor('ws-expire'), 'one fresh sighting since the pause — not yet').toEqual([]);
    f.next(); await f.pass();
    expect(f.verbsFor('ws-expire'), 'the second fresh one').toEqual(['demo-a']);
  });
});

describe('the threshold is ccd’s — never typed by the server', () => {
  it('a YOUNG archive is audited once to learn its instant, and not again before it', async () => {
    const f = await fixture();
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-a', T0 / 1000 - 3600);
    await f.pass();
    expect(f.verbsFor('ws-audit')).toEqual(['demo-a']);
    for (let k = 0; k < 30; k += 1) { f.next(); await f.pass(); }
    expect(f.verbsFor('ws-audit'), 'not re-audited before its instant').toEqual(['demo-a']);
    expect(f.verbsFor('ws-expire')).toEqual([]);
  });

  it('…unless its archive changes: a row returned and archived again is learned afresh', async () => {
    const f = await fixture();
    f.plant('demo-a', T0 / 1000 - 3600);
    await f.pass();
    f.next();
    writeFileSync(path.join(f.reg, 'demo-a.archived'), String(T0 / 1000 - 60));
    await f.pass();
    expect(f.verbsFor('ws-audit')).toEqual(['demo-a', 'demo-a']);
  });

  it('a threshold RAISED after the instant was learned: ccd’s `not-expired` teaches the new one — never re-asked every pass', async () => {
    let raised = false;
    const f = await fixture({ audit: (_id, at) => (raised ? { verdict: 'not-expired', expiresAt: at + 2 * WEEK } : { verdict: 'expirable', token: tokOf(_id) }) });
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-a');
    await f.pass();   // learns OLD + WEEK — already past
    raised = true;    // the operator raises WS_EXPIRE_AFTER_S to fourteen days
    f.next(); await f.pass(); f.next(); await f.pass();   // due; the act's audit answers not-expired
    expect(f.verbsFor('ws-audit')).toEqual(['demo-a', 'demo-a']);
    for (let k = 0; k < 5; k += 1) { f.next(); await f.pass(); }
    expect(f.verbsFor('ws-audit'), 'not asked again before the new instant').toEqual(['demo-a', 'demo-a']);
    expect(f.entry('demo-a')?.expiresAt).toBe(OLD + 2 * WEEK);
    expect(f.verbsFor('ws-expire')).toEqual([]);
  });

  it('an older ccd’s document (no `expiresAt`) is NO EVIDENCE: nothing composed, reported, asked again only after an hour', async () => {
    const f = await fixture({ audit: () => 'old-ccd' });
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-a');
    for (let k = 0; k < 10; k += 1) { await f.pass(); f.next(); }
    expect(f.verbsFor('ws-expire')).toEqual([]);
    expect(f.verbsFor('ws-audit'), 'once, not once a pass').toEqual(['demo-a']);
    expect(f.entry('demo-a')?.report?.kind).toBe('no-evidence');
    f.advance(EXPIRE_NO_EVIDENCE_RETRY_MS); await f.pass();
    expect(f.verbsFor('ws-audit')).toEqual(['demo-a', 'demo-a']);
  });

  it('no `expire-v1` on the box: nothing at all', async () => {
    const f = await fixture({ cap: false });
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-a');
    await threePasses(f);
    expect(f.calls).toEqual([]);
  });
});

// WHAT THE LANE NEVER TOUCHES, read by the LANE ITSELF. The executor re-reads the store at the act, so "no ws-expire"
// alone would stay green if the lane's own reading of a condition were lost; each case below also proves the row
// never became ELIGIBLE (`eligibleSince` stays null) — the lane's wiring of that condition, pinned on its own.
describe('the population — what the lane never touches', () => {
  const neverEligible = async (f: Fixture, id: string, edit?: (r: SessionRecord) => SessionRecord): Promise<void> => {
    await f.pass(edit); f.next(); await f.pass(edit); f.next(); await f.pass(edit); f.next(); await f.pass(edit);
    expect(f.verbsFor('ws-expire'), `${id}: never expired`).toEqual([]);
    expect(f.entry(id)?.eligibleSince ?? null, `${id}: never eligible`).toBeNull();
  };

  it('a child (CCR-15’s) is never even audited here', async () => {
    const f = await fixture();
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-child', OLD, { child: '7' });
    await neverEligible(f, 'demo-child');
    expect(f.verbsFor('ws-audit')).not.toContain('demo-child');
  });

  it('a held row is listed, not acted on', async () => {
    const f = await fixture();
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-held', OLD, { hold: 'program:x wave:1/2' });
    await neverEligible(f, 'demo-held');
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.expiryAttention?.map((a) => [a.sessionId, a.kind])).toEqual([['demo-held', 'held']]);
  });

  it('a row an open run names as its WORKER', async () => {
    const f = await fixture();
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-worker');
    f.bindWorker('demo-worker');
    await neverEligible(f, 'demo-worker');
  });

  it('a row an open run names as its CLAIMANT — an archived coordinator', async () => {
    const f = await fixture();
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-coord');
    f.bindWorker('demo-other', 'demo-coord');
    await neverEligible(f, 'demo-coord');
  });

  it('a REVIEWER whose reviewed run is still open — the report lives in its clips', async () => {
    const f = await fixture();
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-rev');
    const work = f.bindWorker('demo-other');
    const review = f.coord.openRun({ program: 'p', title: 'p', project: 'demo', wave: 1, waveOf: null,
      claimedBy: 'demo-coord', kind: 'review', reviews: work });
    if (!('id' in review)) throw new Error('openRun refused');
    f.coord.markDispatched(review.id, 'demo-rev', 'demo-rev', 'ws/demo-rev', false);
    expect(f.coord.advance(review.id, 'failed', 'test').ok, 'the review run itself is over').toBe(true);
    await neverEligible(f, 'demo-rev');
  });

  it('a store that cannot be read — answered, or thrown — makes every row ineligible', async () => {
    for (const broken of [
      () => ({ ok: false as const, kind: 'run-unreadable' as const, detail: 'runs.wave' }),
      () => { throw new Error('database is not open'); },
    ]) {
      const f = await fixture();
      f.touch(EXPIRE_LANE_LIVE_MARKER);
      f.plant('demo-a');
      vi.spyOn(f.coord, 'lastRunBySession').mockImplementation(broken);
      await neverEligible(f, 'demo-a');
      vi.restoreAllMocks();   // the next round's fixture spies afresh
    }
  });

  it('a row whose identity could not be measured', async () => {
    const f = await fixture();
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-a');
    await neverEligible(f, 'demo-a', (r) => (r.id === 'demo-a' ? { ...r, unmeasured: ['wrapper'] } : r));
  });
});

describe('the act re-reads what the pass read — a run bound meanwhile is never expired', () => {
  it('a row bound to a run while the pass learns ANOTHER row’s instant is deferred at the act', async () => {
    const f = await fixture({ onAudit: (id) => { if (id === 'demo-b') f.bindWorker('demo-a'); } });
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-a');
    await f.pass(); f.next(); await f.pass(); f.next();
    f.plant('demo-b');   // a new row: pass 3 learns its instant before it acts on demo-a
    await f.pass();
    expect(f.verbsFor('ws-expire'), 'the executor’s own re-read kept it').toEqual([]);
    expect(f.feed()).toContainEqual(['demo-a', 'archived workspace cleanup deferred']);
  });
});

describe('the box words', () => {
  it('flock-unavailable stops the lane on that box: nothing more is composed there', async () => {
    const f = await fixture({ expire: () => ({ code: 1, stdout: '',
      stderr: 'ccd: flock (util-linux) is unavailable — refusing to run the destructive verb unserialised' }) });
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-a'); f.plant('demo-b');
    await threePasses(f);
    expect(f.verbsFor('ws-expire')).toHaveLength(1);
    for (let k = 0; k < 6; k += 1) { f.next(); await f.pass(); }
    expect(f.verbsFor('ws-expire'), 'never asked again on a box without flock').toHaveLength(1);
    expect(f.entry(f.verbsFor('ws-expire')[0]!)?.report?.kind).toBe('failing');
  });
});

describe('a standing in-use refusal is EXPECTED — reported, naming what it is, and never killed', () => {
  it(`after ${EXPIRE_IN_USE_ATTENTION_PASSES} refusals the row is listed with the pid, its command and the path`, async () => {
    const inUse = [{ pid: 3453108, comm: 'tmux: server', cwd: '/w/demo-a' }];
    const f = await fixture({ audit: (id) => (id === 'demo-a'
      ? { verdict: 'in-use', detail: 'process 3453108 (tmux: server) has its working directory at /w/demo-a', inUse }
      : { verdict: 'expirable', token: tokOf(id) }) });
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-a');
    await threePasses(f);
    for (let k = 1; k < EXPIRE_IN_USE_ATTENTION_PASSES; k += 1) { f.next(); await f.pass(); }
    await f.watcher.tick();
    const listed = f.watcher.currentCoord()?.expiryAttention ?? [];
    expect(listed.map((a) => a.kind)).toEqual(['in-use']);
    expect(listed[0]!.sentence).toContain('process 3453108 (“tmux: server”) in /w/demo-a');
    expect(listed[0]!.sentence).toContain('the fleet’s own tmux server is also a “tmux: server”');
    expect(f.verbsFor('ws-expire')).toEqual([]);
    expect(f.calls.filter((c) => c[0] !== 'ws-audit'), 'nothing but audits: nothing is killed or stopped').toEqual([]);
  });
});
