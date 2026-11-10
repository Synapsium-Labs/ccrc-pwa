// D-8077 (spec 2026-11-04 §7, §12; the ruled plan's W1, R1 to R8): the run-close lane's pass, rows E1 and E1r, over a real store and
// the real `closeRun`. Shadow records and counts down; armed warns and closes. Every other input is a scripted fake, so nothing
// reaches a box and no test waits on a clock.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { abandonRefusal, closeRun, type CloseOutcome } from '../src/coord/close.js';
import { createRunVerdicts } from '../src/coord/runVerdicts.js';
import {
  RUN_CLOSE_WARNING_PREFIX, createRunCloseMemory, isRunCloseWarning, runClosePass, type RunCloseLaneDeps, type RunCloseOutcome,
} from '../src/coord/runCloseLane.js';
import { DEAD_COORDINATOR_LANE_LIVE_MARKER, RUNS_EXPIRE_NEVER_STARTED_MARKER } from '../../shared/switches.js';
import { deadCoordinatorLaneArmed } from '../src/coord/endDeadCoordinator.js';
import { isUntoldNotice, untoldPass } from '../src/coord/untold.js';
import type { ClaimantVerdict } from '../src/coord/reclaim.js';
import type { BranchFacts } from '../src/coord/runClose.js';
import type { ChildMarkRead } from '../../shared/runBelongs.js';
import type { RunStuck } from '../../shared/api.js';
import type { Runner } from '../src/exec.js';
import { NotifyLog } from '../src/notifylog.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const H = 3_600_000;
const T0 = 1_800_000_000_000;
const ARMED = [RUNS_EXPIRE_NEVER_STARTED_MARKER];
const ALIVE: ClaimantVerdict = { state: 'alive', why: 'live' };
const DEAD: ClaimantVerdict = { state: 'dead', cause: 'orphan', why: 'gone' };

interface Opts {
  names?: string[] | null;
  verdicts?: Record<string, ClaimantVerdict>;
  facts?: BranchFacts | ((sessionId: string) => BranchFacts);
  mark?: ChildMarkRead | null;
  busy?: number | null | 'unread';
  noSerial?: boolean;
}

const rig = async (o: Opts = {}) => {
  const home = mkTmp('ccrc-runclose-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const ccd: string[][] = [];
  const run: Runner = async (_cmd, args) => { ccd.push(args); return { ran: true, code: 0, stdout: '', stderr: '' }; };
  const base = testDeps(home, run);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const verdicts = createRunVerdicts();
  const closesSeen: Map<number, NonNullable<RunStuck['closes']>>[] = [];
  const realSet = verdicts.setCloses.bind(verdicts);
  verdicts.setCloses = (c) => { closesSeen.push(new Map(c)); realSet(c); };
  const state = {
    clock: T0, names: o.names === undefined ? [] : o.names, verdicts: { 'coord-a': ALIVE, ...(o.verdicts ?? {}) } as Record<string, ClaimantVerdict>,
    facts: o.facts ?? { readAt: T0, openPr: false, unpushed: false } as BranchFacts | ((sessionId: string) => BranchFacts),
    mark: o.mark === undefined ? ({ kind: 'none' } as ChildMarkRead | null) : o.mark, busy: o.busy === undefined ? null : o.busy,
    inMutex: false, outside: [] as string[], beforeAct: null as null | (() => void),
  };
  const note = (what: string): void => { if (state.inMutex) state.outside.push(what); };
  const memory = createRunCloseMemory();
  const deps = (): RunCloseLaneDeps => ({
    coord, verdicts, memory, notifyLog, now: () => state.clock,
    registryNames: async () => state.names,
    measure: async (id) => { note(`measure ${id}`); return state.verdicts[id] ?? DEAD; },
    claimantBusyAt: () => state.busy,
    branchFacts: async (sid) => { note(`facts ${sid}`); return typeof state.facts === 'function' ? state.facts(sid) : { ...state.facts, readAt: state.clock }; },
    childMark: async (sid) => { note(`mark ${sid}`); return state.mark; },
    abandonRefusal: (id) => abandonRefusal(coord, id),
    serial: o.noSerial === true ? null : (async (c, fn) => {
      state.inMutex = true;
      try {
        state.beforeAct?.();
        return await fn((runId, claimedBy, stillStuck, extra): Promise<CloseOutcome> =>
          closeRun({ coord: c, io: base.io, cfg: base.cfg, runCcd: base.runCcd }, runId, { intent: 'abandon' }, 'sweep',
            { claimedBy, stillStuck, ...extra }));
      } finally { state.inMutex = false; }
    }),
  });
  const pass = (): Promise<RunCloseOutcome> => runClosePass(deps());
  const open = (program: string, wave: number, over: { kind?: 'review'; reviews?: number; claimedBy?: string; openedAgo?: number } = {}): number => {
    const r = coord.openRun({ program, title: `T ${wave}`, project: 'demo', wave, waveOf: null, claimedBy: over.claimedBy ?? 'coord-a',
      ...(over.kind === undefined ? {} : { kind: over.kind, reviews: over.reviews ?? null }) });
    if (!('id' in r)) throw new Error(`fixture openRun refused: ${JSON.stringify(r)}`);
    coord.db.prepare('UPDATE runs SET openedAt = ? WHERE id = ?').run(T0 - (over.openedAgo ?? 100 * H), r.id);
    return r.id;
  };
  const seed = (laneRow: string, key: string, firstAgo: number): void =>
    coord.setRunCloseAnchor(laneRow, key, { firstAt: T0 - firstAgo, lastAt: T0 - 60_000 });
  const stateOf = (id: number): string => (coord.run(id) as { run: { state: string } }).run.state;
  const mail = (): { toId: string; subject: string; runId: number | null; wake: string | null; envelope: string }[] =>
    coord.db.prepare('SELECT d.toId, m.subject, m.runId, d.wake, d.envelope FROM mail_deliveries d JOIN mail m ON m.id = d.mailId ORDER BY d.id').all() as never;
  const feed = (): string[] => (coord.db.prepare('SELECT title FROM feed_events ORDER BY id').all() as { title: string }[]).map((r) => r.title);
  const deliver = (program: string, at: number): void => {
    const w = coord.runCloseWarning(program)!;
    coord.markDelivered(w.deliveryId, at);
  };
  return { coord, state, pass, open, seed, stateOf, mail, feed, deliver, verdicts, closesSeen, ccd, memory };
};

type Rig = Awaited<ReturnType<typeof rig>>;
const closesOf = (r: Rig, id: number) => r.closesSeen.at(-1)!.get(id) ?? null;

describe('shadow: it records and counts down, and acts on nothing', () => {
  it('shadow records would-close and sends no mail', async () => {
    const r = await rig();
    const id = r.open('programme-a', 1);
    r.seed('never-started', 'programme-a', 80 * H);
    await r.pass();
    expect(r.feed()).toEqual(['ccrc would close programme-a']);
    expect(r.mail()).toEqual([]);
    expect(r.stateOf(id)).toBe('planned');
    expect(closesOf(r, id)).toEqual({ at: T0 - 80 * H + 72 * H, armed: false });
  });

  it('a programme that stays would-close for 100 passes writes one feed row', async () => {
    const r = await rig();
    r.open('programme-a', 1);
    r.seed('never-started', 'programme-a', 80 * H);
    for (let i = 0; i < 100; i += 1) { r.state.clock += 60_000; await r.pass(); }
    expect(r.feed()).toEqual(['ccrc would close programme-a']);
  });

  it('shadow lists would-warn and would-close as separate rows, each once', async () => {
    const r = await rig();
    r.open('programme-a', 1);
    r.seed('never-started', 'programme-a', 71 * H + 57 * 60_000);
    for (let i = 0; i < 4; i += 1) { await r.pass(); r.state.clock += 60_000; }
    expect(r.feed()).toEqual(['ccrc would warn the coordinator of programme-a', 'ccrc would close programme-a']);
  });

  it('a 50-day-old run in its first pass reads the full grace', async () => {
    const r = await rig();
    const id = r.open('programme-a', 1, { openedAgo: 50 * 24 * H });
    await r.pass();
    expect(closesOf(r, id)).toEqual({ at: T0 + 72 * H, armed: false });
  });

  it('the pass writes the map whole on each pass, and a run the lane no longer lists loses its clock', async () => {
    const r = await rig();
    const id = r.open('programme-a', 1);
    await r.pass();
    expect([...r.closesSeen.at(-1)!.keys()]).toEqual([id]);
    r.coord.db.prepare("UPDATE runs SET state = 'working' WHERE id = ?").run(id);
    await r.pass();
    expect(r.closesSeen.at(-1)!.size).toBe(0);
    expect(r.coord.runCloseAnchors('never-started').size).toBe(0);
  });

  it('a programme with a wave past planned is never E1', async () => {
    const r = await rig();
    r.open('programme-a', 1);
    const w = r.open('programme-a', 2);
    r.coord.db.prepare("UPDATE runs SET state = 'working' WHERE id = ?").run(w);
    r.seed('never-started', 'programme-a', 80 * H);
    await r.pass();
    expect(r.closesSeen.at(-1)!.size).toBe(0);
    expect(r.feed()).toEqual([]);
  });

  it('activity on the programme moves E1\'s at later', async () => {
    const r = await rig();
    const id = r.open('programme-a', 1);
    await r.pass();
    const before = closesOf(r, id)!.at;
    r.state.clock += 60_000;
    r.coord.db.prepare('UPDATE runs SET lastDispatchAttemptAt = ? WHERE id = ?').run(r.state.clock, id);
    await r.pass();
    expect(closesOf(r, id)!.at).toBeGreaterThan(before);
    expect(closesOf(r, id)!.at).toBe(r.state.clock + 72 * H);
  });

  it('closes is null on an uncertain reading: an unread busy turn, an unmeasured claimant', async () => {
    const r = await rig({ busy: 'unread' });
    const id = r.open('programme-a', 1);
    await r.pass();
    expect(closesOf(r, id)).toBeNull();
    const u = await rig({ verdicts: { 'coord-a': { state: 'unmeasurable', why: 'no reading' } } });
    const uid = u.open('programme-a', 1);
    await u.pass();
    expect(closesOf(u, uid)).toBeNull();
    expect(u.coord.runCloseAnchors('never-started').size, 'an uncertain pass counts toward no clock').toBe(0);
  });

  it('a mixed or absent claimant is not this pass', async () => {
    const r = await rig();
    r.open('programme-a', 1);
    const second = r.open('programme-a', 2);
    r.coord.db.prepare("UPDATE runs SET claimedBy = 'coord-b' WHERE id = ?").run(second);
    await r.pass();
    expect(r.closesSeen.at(-1)!.size).toBe(0);
    r.coord.db.prepare('UPDATE runs SET claimedBy = NULL WHERE id = ?').run(second);
    await r.pass();
    expect(r.closesSeen.at(-1)!.size).toBe(0);
  });
});

describe('R6, R1: a run with a session', () => {
  const withSession = (r: Rig, id: number, sid = 's-aaaa'): void => { r.coord.db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run(sid, id); };

  it('in shadow, a run with an open PR or unpushed commits has closes null and raises no item', async () => {
    for (const facts of [{ readAt: T0, openPr: true, unpushed: false }, { readAt: T0, openPr: false, unpushed: true }]) {
      const r = await rig({ facts });
      const id = r.open('programme-a', 2);
      withSession(r, id);
      await r.pass();
      expect(closesOf(r, id)).toBeNull();
      expect(r.mail()).toEqual([]);
    }
  });

  it('a run E1r fits with a live session has closes null (1085\'s shape)', async () => {
    const r = await rig({ verdicts: { 's-aaaa': ALIVE } });
    const work = r.open('programme-a', 1);
    r.coord.db.prepare("UPDATE runs SET state = 'done', closedAt = 5 WHERE id = ?").run(work);
    const review = r.open('programme-a', 1, { kind: 'review', reviews: work });
    withSession(r, review);
    await r.pass();
    expect(closesOf(r, review)).toBeNull();
  });

  it('an unreadable child marker, and an unmeasured one, hold the run', async () => {
    for (const mark of [{ kind: 'unreadable' } as const, { kind: 'unrecognised' } as const, null]) {
      const r = await rig({ mark });
      const id = r.open('programme-a', 2);
      withSession(r, id);
      await r.pass();
      expect(closesOf(r, id)).toBeNull();
    }
  });

  it('a clear run with a session keeps its clock', async () => {
    const r = await rig({ mark: { kind: 'child', runId: 0 } });
    const id = r.open('programme-a', 2);
    withSession(r, id);
    r.state.mark = { kind: 'child', runId: id };
    await r.pass();
    expect(closesOf(r, id)).not.toBeNull();
  });
});

describe('E1r: a planned review of finished work', () => {
  const finished = (r: Rig): { work: number; review: number } => {
    const work = r.open('programme-a', 1);
    r.coord.db.prepare("UPDATE runs SET state = 'done', closedAt = 5 WHERE id = ?").run(work);
    const review = r.open('programme-a', 1, { kind: 'review', reviews: work });
    return { work, review };
  };

  it('E1r is anchor plus 1 h, and closes after it when armed with detail and a record for the coordinator', async () => {
    const r = await rig({ names: ARMED });
    const { review } = finished(r);
    await r.pass();
    expect(closesOf(r, review)).toEqual({ at: T0 + H, armed: true });
    r.state.clock += H;
    r.coord.setRunCloseAnchor('review-orphaned', String(review), { firstAt: T0, lastAt: r.state.clock - 60_000 });
    const out = await r.pass();
    expect(out.closed).toEqual([review]);
    expect(r.stateOf(review)).toBe('failed');
    const row = r.coord.db.prepare('SELECT closedBy, closeDetail FROM runs WHERE id = ?').get(review) as { closedBy: string; closeDetail: string };
    expect(row).toEqual({ closedBy: 'sweep', closeDetail: 'expired:review-orphaned target-closed' });
    expect(r.coord.untoldRows().map((u) => u.runId)).toEqual([review]);
  });

  it('a mail or a dispatch attempt leaves E1r\'s at where it was', async () => {
    const r = await rig();
    const { review } = finished(r);
    await r.pass();
    const at = closesOf(r, review)!.at;
    r.state.clock += 5 * 60_000;
    r.coord.db.prepare('UPDATE runs SET lastDispatchAttemptAt = ? WHERE id = ?').run(r.state.clock, review);
    r.coord.db.prepare("INSERT INTO mail (fromId, fromUuid, toId, runId, kind, subject, body, at, artifacts) VALUES ('coord-a', 'u', 'w', ?, 'status', 's', 'b', ?, '[]')").run(review, r.state.clock);
    await r.pass();
    expect(closesOf(r, review)!.at).toBe(at);
  });

  it('a gap restarts E1r\'s at', async () => {
    const r = await rig();
    const { review } = finished(r);
    await r.pass();
    r.state.clock += 30 * 60_000;
    await r.pass();
    expect(closesOf(r, review)!.at).toBe(r.state.clock + H);
  });

  it('a later review that moved makes the review E1r too (the later-review arm)', async () => {
    const r = await rig();
    const work = r.open('programme-a', 1);
    const first = r.open('programme-a', 1, { kind: 'review', reviews: work });
    // A second review cannot open while the first is in flight: close the first for the moment, open the second, put it back.
    r.coord.db.prepare("UPDATE runs SET state = 'failed', closedAt = 6 WHERE id = ?").run(first);
    const second = r.open('programme-a', 2, { kind: 'review', reviews: work });
    r.coord.db.prepare("UPDATE runs SET state = 'done', closedAt = 8 WHERE id = ?").run(second);
    r.coord.db.prepare("UPDATE runs SET state = 'planned', closedAt = NULL WHERE id = ?").run(first);
    r.coord.db.prepare("INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (?, ?, 'planned', 'working', 'coordinator', NULL)").run(second, T0 - 5 * H);
    await r.pass();
    expect(closesOf(r, first)).toEqual({ at: T0 + H, armed: false });
    expect(closesOf(r, second)).toBeNull();
  });

  it('a review of an open work run is never E1r', async () => {
    const r = await rig();
    const work = r.open('programme-a', 1);
    const review = r.open('programme-a', 1, { kind: 'review', reviews: work });
    await r.pass();
    expect(closesOf(r, review)).toBeNull();
  });
});

describe('armed: the warning', () => {
  it('unarmed, the warning is never sent', async () => {
    const r = await rig();
    r.open('programme-a', 1);
    r.seed('never-started', 'programme-a', 49 * H);
    await r.pass();
    expect(r.mail()).toEqual([]);
    expect(r.coord.runCloseWarning('programme-a')).toBeNull();
  });

  it('dead-coordinator-lane-live alone never arms E1, and runs-expire-never-started alone never arms the crash row', async () => {
    const r = await rig({ names: [DEAD_COORDINATOR_LANE_LIVE_MARKER] });
    r.open('programme-a', 1);
    r.seed('never-started', 'programme-a', 49 * H);
    await r.pass();
    expect(r.mail()).toEqual([]);
    expect(deadCoordinatorLaneArmed([RUNS_EXPIRE_NEVER_STARTED_MARKER], 'shadow')).toBe(false);
  });

  it('armed, the warning is queued at 48 h with runId null, naming its programme, and wakes only through the hibernated gate', async () => {
    const r = await rig({ names: ARMED });
    r.open('programme-a', 1);
    r.seed('never-started', 'programme-a', 49 * H);
    const out = await r.pass();
    expect(out.warned).toEqual(['programme-a']);
    const sent = r.mail();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ toId: 'coord-a', runId: null, wake: null });
    expect(isRunCloseWarning(sent[0]!.subject)).toBe(true);
    expect(sent[0]!.subject.startsWith(RUN_CLOSE_WARNING_PREFIX)).toBe(true);
    expect(sent[0]!.envelope).toContain('program: programme-a');
    expect(sent[0]!.envelope).not.toContain('\nrun:');
    expect(r.coord.runCloseWarning('programme-a')).toMatchObject({ claimant: 'coord-a', deliveredAt: null });
    expect(r.feed()).toContain('ccrc warns the coordinator of programme-a');
    // The second pass sends nothing more.
    r.state.clock += 60_000;
    expect((await r.pass()).warned).toEqual([]);
    expect(r.mail()).toHaveLength(1);
  });

  it('an undelivered warning blocks the close', async () => {
    const r = await rig({ names: ARMED });
    const id = r.open('programme-a', 1);
    r.seed('never-started', 'programme-a', 49 * H);
    await r.pass();
    r.state.clock += 40 * H;
    r.seed('never-started', 'programme-a', 89 * H);
    const out = await r.pass();
    expect(out.closed).toEqual([]);
    expect(r.stateOf(id)).toBe('planned');
    expect(closesOf(r, id)).toBeNull();   // 24 h undelivered: nothing closes this on its own
  });

  it('a programme whose coordinator reads gone is never warned', async () => {
    const r = await rig({ names: ARMED, verdicts: { 'coord-a': DEAD } });
    r.open('programme-a', 1);
    r.seed('never-started', 'programme-a', 49 * H);
    const out = await r.pass();
    expect(out.warned).toEqual([]);
    expect(r.mail()).toEqual([]);
  });

  it('a 21-programme backlog at arming sends no more than one warning a pass', async () => {
    const r = await rig({ names: ARMED });
    for (let i = 0; i < 21; i += 1) { r.open(`programme-${i}`, 1); r.seed('never-started', `programme-${i}`, 49 * H); }
    let total = 0;
    for (let pass = 0; pass < 25; pass += 1) {
      const out = await r.pass();
      expect(out.warned.length).toBeLessThanOrEqual(1);
      total += out.warned.length;
      r.state.clock += 60_000;
    }
    expect(total).toBe(21);
  });

  it('activity after a delivered warning invalidates it', async () => {
    const r = await rig({ names: ARMED });
    const id = r.open('programme-a', 1);
    r.seed('never-started', 'programme-a', 49 * H);
    await r.pass();
    r.deliver('programme-a', T0 + 1000);
    r.state.clock += 60_000;
    r.coord.db.prepare('UPDATE runs SET lastDispatchAttemptAt = ? WHERE id = ?').run(r.state.clock, id);
    await r.pass();
    expect(r.coord.runCloseWarning('programme-a')).toBeNull();
  });
});

describe('armed: the close', () => {
  /** A programme warned 30 h ago, quiet 80 h, ready to close. */
  const ready = async (r: Rig, program = 'programme-a'): Promise<number> => {
    const id = r.open(program, 1);
    r.seed('never-started', program, 49 * H);
    const sent = await r.pass();
    if (!sent.warned.includes(program)) throw new Error('fixture: the warning was not sent');
    // The warning was delivered 30 hours before now, and the programme has been quiet in all of them.
    r.deliver(program, T0);
    r.state.clock = T0 + 30 * H;
    r.coord.setRunCloseAnchor('never-started', program, { firstAt: T0 - 49 * H, lastAt: r.state.clock - 60_000 });
    return id;
  };

  it('quiet 72 h with a warning delivered 24 h ago closes: sweep, expired:never-started, and the coordinator is owed a notice', async () => {
    const r = await rig({ names: ARMED });
    const id = await ready(r);
    const out = await r.pass();
    expect(out.closed).toEqual([id]);
    expect(r.stateOf(id)).toBe('failed');
    const row = r.coord.db.prepare('SELECT closedBy, closeDetail FROM runs WHERE id = ?').get(id) as { closedBy: string; closeDetail: string };
    expect(row.closedBy).toBe('sweep');
    expect(row.closeDetail).toMatch(/^expired:never-started /);
    expect(r.coord.untoldRows().map((u) => [u.runId, u.claimant, u.cause])).toEqual([[id, 'coord-a', 'sweep']]);
    expect(r.feed()).toContain('ccrc closes programme-a');
    // The next pass finds nothing left: the programme loses its warning and its anchor.
    await r.pass();
    expect(r.coord.runCloseWarning('programme-a')).toBeNull();
    expect(r.coord.runCloseAnchors('never-started').size).toBe(0);
  });

  it('the notice survives the closes it reports: one notice to the live coordinator, never asking a wake, and none twice', async () => {
    const r = await rig({ names: ARMED });
    const id = await ready(r);
    expect((await r.pass()).closed).toEqual([id]);
    const before = r.mail().length;
    await untoldPass({ coord: r.coord, measure: async () => ALIVE });
    const sent = r.mail().slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ toId: 'coord-a', runId: null, wake: 'never' });
    expect(isUntoldNotice(sent[0]!.subject)).toBe(true);
    expect(r.coord.untoldRows()).toEqual([]);
    await untoldPass({ coord: r.coord, measure: async () => ALIVE });
    expect(r.mail()).toHaveLength(before + 1);
  });

  it('no pr-state, gh or ccd call and no measure runs inside the coordination mutex', async () => {
    const r = await rig({ names: ARMED });
    const id = await ready(r);
    r.coord.db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run('s-aaaa', id);
    r.state.mark = { kind: 'child', runId: id };
    const out = await r.pass();
    expect(out.closed).toEqual([id]);
    expect(r.state.outside, 'every read that waits on gh, ccd or tmux happens before the serialiser').toEqual([]);
  });

  it('the marker removed between the pass and the act stops the act', async () => {
    const r = await rig({ names: [...ARMED] });
    const id = await ready(r);
    r.state.beforeAct = () => { r.state.names = []; };
    const out = await r.pass();
    expect(out.closed).toEqual([]);
    expect(r.stateOf(id)).toBe('planned');
    expect(out.refused[0]?.why).toMatch(/returned to shadow/);
    expect(closesOf(r, id), 'a refused close sets closes null').toBeNull();
  });

  it('reclaim-paused or coordinator-paused raised during the act stops it', async () => {
    for (const marker of ['reclaim-paused', 'coordinator-paused']) {
      const r = await rig({ names: [...ARMED] });
      const id = await ready(r);
      r.state.beforeAct = () => { r.state.names = [...ARMED, marker]; };
      const out = await r.pass();
      expect(out.closed).toEqual([]);
      expect(r.stateOf(id)).toBe('planned');
      expect(out.refused[0]?.why).toContain(marker);
    }
  });

  it('a registry that stops listing during the act stops it', async () => {
    const r = await rig({ names: [...ARMED] });
    const id = await ready(r);
    r.state.beforeAct = () => { r.state.names = null; };
    const out = await r.pass();
    expect(out.closed).toEqual([]);
    expect(r.stateOf(id)).toBe('planned');
  });

  it('a dispatch between the pass and the act skips the close', async () => {
    const r = await rig({ names: [...ARMED] });
    const id = await ready(r);
    r.state.beforeAct = () => { r.coord.db.prepare('UPDATE runs SET dispatchStartedAt = ? WHERE id = ?').run(r.state.clock, id); };
    const out = await r.pass();
    expect(out.closed).toEqual([]);
    expect(r.stateOf(id)).toBe('planned');
  });

  it('activity since the warning, or a wave that started, skips the close', async () => {
    const a = await rig({ names: [...ARMED] });
    const ida = await ready(a);
    a.state.beforeAct = () => { a.coord.db.prepare('UPDATE runs SET lastDispatchAttemptAt = ? WHERE id = ?').run(a.state.clock, ida); };
    expect((await a.pass()).closed).toEqual([]);
    const b = await rig({ names: [...ARMED] });
    const idb = await ready(b);
    b.state.beforeAct = () => { b.coord.db.prepare("UPDATE runs SET state = 'working' WHERE id = ?").run(idb); };
    expect((await b.pass()).closed).toEqual([]);
  });

  it('an E1 close of a held run with unpushed commits is refused and listed, and an open PR refuses', async () => {
    for (const facts of [{ readAt: T0, openPr: false, unpushed: true }, { readAt: T0, openPr: true, unpushed: false }]) {
      const r = await rig({ names: ARMED });
      const id = await ready(r);
      r.coord.db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run('s-aaaa', id);
      r.state.facts = (): BranchFacts => ({ ...facts, readAt: r.state.clock });
      const out = await r.pass();
      expect(out.closed).toEqual([]);
      expect(r.stateOf(id)).toBe('planned');
      expect(out.refused).toEqual([{ runId: id, why: facts.openPr ? 'open-pr' : 'unpushed-commits' }]);
    }
  });

  it('an unmeasured branch fact refuses', async () => {
    const r = await rig({ names: ARMED });
    const id = await ready(r);
    r.coord.db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run('s-aaaa', id);
    r.state.facts = (): BranchFacts => ({ readAt: r.state.clock, openPr: null, unpushed: null });
    expect((await r.pass()).closed).toEqual([]);
  });

  it('an E1 close of a planned wave-2 run with a session releases or hands off its hold', async () => {
    const r = await rig({ names: ARMED });
    const id = await ready(r);
    r.coord.db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run('s-aaaa', id);
    r.state.mark = { kind: 'child', runId: id };
    expect((await r.pass()).closed).toEqual([id]);
    expect(r.ccd.some((a) => a[0] === 'ws-release' || a[0] === 'ws-hold')).toBe(true);
  });

  it('an E1 close of a reused name makes no ccd call', async () => {
    const r = await rig({ names: ARMED });
    const id = await ready(r);
    r.coord.db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run('s-aaaa', id);
    r.state.mark = { kind: 'child', runId: id + 1000 };
    const out = await r.pass();
    expect(out.closed).toEqual([id]);
    expect(r.ccd, 'a marker naming a later run releases nothing').toEqual([]);
  });

  it('nothing acts while the pause is set, and the map is empty', async () => {
    for (const marker of ['reclaim-paused', 'coordinator-paused']) {
      const held = await rig({ names: [...ARMED, marker] });
      const id = held.open('programme-a', 1);
      held.seed('never-started', 'programme-a', 80 * H);
      const out = await held.pass();
      expect(out.held).toContain(marker);
      expect(held.mail()).toEqual([]);
      expect(held.stateOf(id)).toBe('planned');
      expect(held.closesSeen.at(-1)!.size).toBe(0);
      expect(held.coord.runCloseAnchors('never-started').size, 'a pause restarts every grace').toBe(0);
    }
    const unlisted = await rig({ names: null });
    unlisted.open('programme-a', 1);
    expect((await unlisted.pass()).held).toMatch(/did not list/);
  });

  it('a restart after 3 days of downtime closes nothing on its first pass', async () => {
    const r = await rig({ names: ARMED });
    const id = await ready(r);
    r.state.clock += 3 * 24 * H;   // the server was down: the anchor's last pass is 3 days old
    const out = await r.pass();
    expect(out.closed).toEqual([]);
    expect(r.stateOf(id)).toBe('planned');
    expect(r.coord.runCloseAnchors('never-started').get('programme-a')!.firstAt).toBe(r.state.clock);
  });

  it('a 21-programme backlog drains over several passes and never acts on more than 3 programmes in one', async () => {
    const r = await rig({ names: ARMED });
    const ids: number[] = [];
    for (let i = 0; i < 21; i += 1) {
      const program = `programme-${i}`;
      ids.push(r.open(program, 1));
      r.seed('never-started', program, 49 * H);
    }
    for (let i = 0; i < 21; i += 1) await r.pass();   // one warning a pass; 21 passes send all
    expect(r.mail()).toHaveLength(21);
    r.state.clock = T0 + 60 * H;
    r.coord.db.prepare('UPDATE mail_deliveries SET deliveredAt = ?, state = \'delivered\'').run(T0 + 10 * H);
    for (let i = 0; i < 21; i += 1) r.coord.setRunCloseAnchor('never-started', `programme-${i}`, { firstAt: T0 - 49 * H, lastAt: r.state.clock - 60_000 });
    let passes = 0;
    while (ids.some((id) => r.stateOf(id) === 'planned') && passes < 20) {
      const out = await r.pass();
      expect(out.closed.length).toBeLessThanOrEqual(3);
      passes += 1;
      r.state.clock += 60_000;
      for (let i = 0; i < 21; i += 1) {
        if (r.coord.runCloseAnchors('never-started').has(`programme-${i}`)) {
          r.coord.setRunCloseAnchor('never-started', `programme-${i}`, { firstAt: T0 - 49 * H, lastAt: r.state.clock - 60_000 });
        }
      }
    }
    expect(passes).toBe(7);
    expect(ids.every((id) => r.stateOf(id) === 'failed')).toBe(true);
  });

  it('with no serialiser wired nothing is ever closed', async () => {
    const r = await rig({ names: ARMED, noSerial: true });
    const id = r.open('programme-a', 1);
    r.seed('never-started', 'programme-a', 80 * H);
    expect((await r.pass()).closed).toEqual([]);
    expect(r.stateOf(id)).toBe('planned');
  });
});

describe('E1: the warning belongs to the claimant it was sent to, an unreachable claimant has no clock, and the list counts what arming does', () => {
  it('a warning delivered to a claimant who was since replaced is no warning for the new one: nothing closes, the new claimant is warned', async () => {
    const r = await rig({ names: ARMED, verdicts: { 'coord-b': ALIVE } });
    const id = r.open('programme-a', 1);
    r.seed('never-started', 'programme-a', 49 * H);
    await r.pass();
    r.deliver('programme-a', T0);
    // The first claimant crashed; a reclaim (causedBy operator, no activity) handed the programme to coord-b.
    r.coord.db.prepare('UPDATE runs SET claimedBy = ? WHERE id = ?').run('coord-b', id);
    r.state.clock = T0 + 30 * H;
    r.coord.setRunCloseAnchor('never-started', 'programme-a', { firstAt: T0 - 49 * H, lastAt: r.state.clock - 60_000 });
    const out = await r.pass();
    expect(out.closed).toEqual([]);
    expect(r.stateOf(id)).toBe('planned');
    expect(out.warned).toEqual(['programme-a']);
    expect(r.coord.runCloseWarning('programme-a')).toMatchObject({ claimant: 'coord-b', deliveredAt: null });
  });

  it('the act-time guard refuses a warning that went to another coordinator', async () => {
    const r = await rig({ names: ARMED });
    const id = r.open('programme-a', 1);
    r.seed('never-started', 'programme-a', 49 * H);
    await r.pass();
    r.deliver('programme-a', T0);
    r.state.clock = T0 + 30 * H;
    r.coord.setRunCloseAnchor('never-started', 'programme-a', { firstAt: T0 - 49 * H, lastAt: r.state.clock - 60_000 });
    r.state.beforeAct = () => { r.coord.db.prepare('UPDATE run_close_warnings SET claimant = ?').run('coord-b'); };
    const out = await r.pass();
    expect(out.closed).toEqual([]);
    expect(r.stateOf(id)).toBe('planned');
    expect(out.refused.map((x) => x.runId)).toEqual([id]);
  });

  it('armed, a programme whose coordinator reads gone has no clock from the first pass that reads it (48 h to 72 h)', async () => {
    const r = await rig({ names: ARMED, verdicts: { 'coord-a': DEAD } });
    const id = r.open('programme-a', 1);
    r.seed('never-started', 'programme-a', 60 * H);
    await r.pass();
    expect(closesOf(r, id)).toBeNull();
    const reading = r.verdicts.reading()!.groups['never-started']!;
    expect(reading.would).toEqual([]);
    expect(reading.named).toEqual([{ runId: id, program: 'programme-a', why: 'coordinator-not-reached' }]);
  });

  it('in shadow, a run quiet 80 h with no warning is counted later: arming sends the warning first, 24 h out', async () => {
    const r = await rig();
    const id = r.open('programme-a', 1);
    r.seed('never-started', 'programme-a', 80 * H);
    await r.pass();
    const would = r.verdicts.reading()!.groups['never-started']!.would;
    expect(would).toEqual([{ runId: id, program: 'programme-a', why: 'never-started', at: T0 + 24 * H }]);
    // The run's own countdown in shadow is unchanged: 72 h alone.
    expect(closesOf(r, id)).toEqual({ at: T0 - 8 * H, armed: false });
  });
});
