// D-8078 (spec 2026-11-04 §7, §12; the runs rebuild, Task 28; the ruled plan's W2): ROWS E3, E3s AND E5 of the run-close lane, in
// the claimant-gone group. The pure half pins the clocks and the deciders (`closesOf`, `claimantGoneVerdict`,
// `claimantGoneBreaker`, `closeRowOf`, the verdict's `name-reused`); the lane half drives `runClosePass` over a real store and
// the real `closeRun`, with the stuck verdict's answer written straight into the reader (`RunVerdicts.replace`), because the
// lane's candidates ARE that answer (`RunVerdict.closeRow`). `run-stuck-closes.test.ts` pins the two passes together.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { abandonRefusal, closeRun, type CloseOutcome } from '../src/coord/close.js';
import { createRunVerdicts, type RunVerdict } from '../src/coord/runVerdicts.js';
import { createRunCloseMemory, runClosePass, type RunCloseLaneDeps, type RunCloseOutcome } from '../src/coord/runCloseLane.js';
import {
  RUN_CLOSE_GRACE_MS, RUN_CLOSE_ROW_GROUP, RUN_CLOSE_ROW_SWITCH, claimantGoneBreaker, claimantGoneVerdict, closesOf, rowAnchor,
  type BranchFacts,
} from '../src/coord/runClose.js';
import { closeRowOf, runStuck, type PersonFacts, type RunStuckFacts, type StoredTimes } from '../src/coord/runStuck.js';
import { DEAD_COORDINATOR_BREAKER_WINDOW_MS, deadCoordinatorDeliberateRow, deadCoordinatorStoppedByPerson, type DeadCoordinatorJournalRow } from '../src/deadCoordinator.js';
import { DEAD_COORDINATOR_JOURNAL_TRUSTED } from '../src/deadCoordinator.js';
import { RECLAIM_PAUSE_MARKER, RUNS_EXPIRE_COORDINATOR_GONE_MARKER, RUNS_EXPIRE_NEVER_STARTED_MARKER } from '../../shared/switches.js';
import type { ClaimantVerdict } from '../src/coord/reclaim.js';
import type { ChildMarkRead } from '../../shared/runBelongs.js';
import type { RunStuck, RunState } from '../../shared/api.js';
import type { Runner } from '../src/exec.js';
import { NotifyLog } from '../src/notifylog.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const H = 3_600_000;
const T0 = 1_800_000_000_000;
const ALIVE: ClaimantVerdict = { state: 'alive', why: 'live' };
const DEAD: ClaimantVerdict = { state: 'dead', cause: 'orphan', why: 'gone' };
const ARMED = [RUNS_EXPIRE_COORDINATOR_GONE_MARKER];

describe('the clocks of E3, E3s, E5 and the crash row (spec §7)', () => {
  it('E3 and the crash row read the first pass plus 1 h', () => {
    expect(rowAnchor('claimant-gone', { firstPassAt: T0, programmeLastActivityAt: T0 + 30 * H })).toBe(T0);
    expect(closesOf('claimant-gone', T0, null, false, T0 + 5 * H)).toEqual({ at: T0 + H, armed: false });
    expect(closesOf('claimant-crashed', T0, null, false, T0 + 5 * H)).toEqual({ at: T0 + H, armed: false });
    expect(RUN_CLOSE_GRACE_MS['claimant-gone']).toBe(RUN_CLOSE_GRACE_MS['claimant-crashed']);
  });

  it('E3s the first pass plus 24 h', () => {
    expect(closesOf('claimant-stopped', T0, null, true, T0 + 5 * H)).toEqual({ at: T0 + 24 * H, armed: true });
  });

  it('E5 the next pass: no anchor, no grace', () => {
    expect(closesOf('name-reused', null, null, false, T0 + 7 * H)).toEqual({ at: T0 + 7 * H, armed: false });
    expect(closesOf('name-reused', T0, null, true, T0 + 7 * H)).toEqual({ at: T0 + 7 * H, armed: true });
  });

  it('activity leaves E3, E3s, E5 and the crash row where they were: the programme\'s activity enters E1 alone', () => {
    for (const row of ['claimant-gone', 'claimant-stopped', 'claimant-crashed'] as const) {
      expect(rowAnchor(row, { firstPassAt: T0, programmeLastActivityAt: T0 + 40 * H }), row).toBe(T0);
    }
    expect(rowAnchor('never-started', { firstPassAt: T0, programmeLastActivityAt: T0 + 40 * H })).toBe(T0 + 40 * H);
  });

  it('the three rows are one group with their own marker, and no other group\'s marker arms them (R8)', () => {
    for (const row of ['claimant-gone', 'claimant-stopped', 'name-reused'] as const) {
      expect(RUN_CLOSE_ROW_GROUP[row]).toBe('claimant-gone');
      expect(RUN_CLOSE_ROW_SWITCH[row]).toBe(RUNS_EXPIRE_COORDINATOR_GONE_MARKER);
    }
    expect(RUN_CLOSE_ROW_SWITCH['never-started']).toBe(RUNS_EXPIRE_NEVER_STARTED_MARKER);
  });

  it('the decider waits out each grace, then closes (armed) or would close (shadow); E5 needs no anchor', () => {
    expect(claimantGoneVerdict({ row: 'claimant-gone', anchor: T0, armed: true }, T0 + H - 1)).toEqual({ kind: 'wait' });
    expect(claimantGoneVerdict({ row: 'claimant-gone', anchor: T0, armed: true }, T0 + H)).toEqual({ kind: 'close' });
    expect(claimantGoneVerdict({ row: 'claimant-stopped', anchor: T0, armed: false }, T0 + 23 * H)).toEqual({ kind: 'wait' });
    expect(claimantGoneVerdict({ row: 'claimant-stopped', anchor: T0, armed: false }, T0 + 24 * H)).toEqual({ kind: 'would-close' });
    expect(claimantGoneVerdict({ row: 'claimant-gone', anchor: null, armed: true }, T0)).toEqual({ kind: 'hold', word: 'unmeasured' });
    expect(claimantGoneVerdict({ row: 'name-reused', anchor: null, armed: true }, T0)).toEqual({ kind: 'close' });
  });
});

describe('the breaker on transitions', () => {
  it('two coordinators gone within the window are held, and a lone one or two far apart are not', () => {
    const W = DEAD_COORDINATOR_BREAKER_WINDOW_MS;
    expect([...claimantGoneBreaker(new Map([['a', T0], ['b', T0 + W]]))].sort()).toEqual(['a', 'b']);
    expect([...claimantGoneBreaker(new Map([['a', T0], ['b', T0 + W + 1]]))]).toEqual([]);
    expect([...claimantGoneBreaker(new Map([['a', T0]]))]).toEqual([]);
    expect([...claimantGoneBreaker(new Map([['a', T0], ['b', T0 + 50 * H], ['c', T0 + 51 * H]]))]).toEqual([]);
  });
});

const row = (act: DeadCoordinatorJournalRow['act'], surface: string | null, over: Partial<DeadCoordinatorJournalRow> = {}): DeadCoordinatorJournalRow => ({
  act, outcome: 'done', at: T0, gen: '1800000000000000001', dec: surface === null ? null : { surface: surface as 'pwa' }, meas: null, raw: '{}', ...over,
});

describe('a stop is a person\'s only when the journal says so (E3s, G2 (a))', () => {
  it('a stop with the PWA\'s or a shell\'s declared surface is a person\'s', () => {
    for (const surface of ['pwa', 'cli']) {
      expect(deadCoordinatorStoppedByPerson(deadCoordinatorDeliberateRow([row('stop', surface)], DEAD_COORDINATOR_JOURNAL_TRUSTED)), surface).toBe(true);
    }
  });

  it('a stop by a swap, a supervisor, an OOM policy or maintenance (no declared surface), a machine surface, a hibernate and a removal are not', () => {
    for (const r of [row('stop', 'none'), row('stop', 'ccd'), row('stop', 'agent'), row('stop', null), row('hibernate', 'pwa'), row('archive', 'pwa'), row('stop', 'pwa', { outcome: 'refused' })]) {
      expect(deadCoordinatorStoppedByPerson(deadCoordinatorDeliberateRow([r], DEAD_COORDINATOR_JOURNAL_TRUSTED)), `${r.act}/${r.dec?.surface}/${r.outcome}`).toBe(false);
    }
  });

  it('a journal that cannot be trusted names no one, and a stop before the last successful start is history', () => {
    expect(deadCoordinatorDeliberateRow([row('stop', 'pwa')], { untrusted: 'the mirror is stale', gapGens: [], lastWriteErrorAt: null })).toBeNull();
    const spawn = row('spawn', null, { gen: '1800000000000000009', raw: '{"meas":{"rc":"0"}}' });
    expect(deadCoordinatorDeliberateRow([row('stop', 'pwa'), spawn], DEAD_COORDINATOR_JOURNAL_TRUSTED)).toBeNull();
  });
});

// ── the verdict half: E5's condition and which verdicts name a lane row ─────────────────────────────────────

const times = (over: Partial<StoredTimes> = {}): StoredTimes => ({
  journalAt: null, archivedAt: null, stoppedAt: null, workerStoppedAt: null, deadFirstAt: null, supervisedAt: null,
  goneSinceCoordinator: null, goneSinceWorker: null, openedAt: T0 - 100 * H, dispatchStartedAt: null, targetClosedAt: null,
  laterReviewAt: null, overtakenAt: null, nameReusedAt: null, ...over,
});
const alive: PersonFacts = { verdict: { state: 'alive' }, hibernatedAt: null, substrate: null };
const facts = (over: Partial<RunStuckFacts> = {}): RunStuckFacts => ({
  id: 7, state: 'working' as RunState, kind: 'work', dispatchStartedAt: T0 - 50 * H, dispatchedAt: T0 - 50 * H, lastMoveAt: T0 - H,
  claimant: alive, claimantJournal: { kind: 'quiet', started: true }, worker: alive, workerJournal: null, target: null, laterReviewMoved: false,
  e1Quiet: false, overtaken: false, aloneInProgramme: false, reviewOpen: null, behind: null, times: times(), ...over,
});

describe('E5 reads owner-gone with name-reused', () => {
  it('a started run whose session name a later run holds is owner-gone, name-reused, since the later run\'s dispatch', () => {
    const v = runStuck(facts({ nameReused: true, times: times({ nameReusedAt: T0 - 3 * 24 * H }) }), T0);
    expect(v).toEqual({ reason: 'owner-gone', cause: 'name-reused', since: T0 - 3 * 24 * H, closes: null });
    expect(closeRowOf(facts({ nameReused: true }), v)).toBe('name-reused');
  });

  it('with no later dispatch on record there is no verdict (an age comes from a stored time, A63), and a planned run is never E5', () => {
    expect(runStuck(facts({ nameReused: true }), T0)).toBeNull();
    expect(runStuck(facts({ state: 'planned', nameReused: true, times: times({ nameReusedAt: T0 - H }) }), T0)).toBeNull();
  });

  it('a coordinator that is gone is the cause when both fit (first match wins)', () => {
    const gone: PersonFacts = { verdict: { state: 'dead', cause: 'orphan' }, hibernatedAt: null, substrate: null, archivedAt: T0 - 5 * H };
    const f = facts({ claimant: gone, claimantJournal: { kind: 'quiet', started: true }, nameReused: true, times: times({ nameReusedAt: T0 - H, archivedAt: T0 - 5 * H }) });
    expect(runStuck(f, T0)).toMatchObject({ reason: 'owner-gone', cause: 'coordinator-archived' });
  });
});

describe('which verdicts name a lane row', () => {
  const goneBy = (cause: 'orphan', over: Partial<PersonFacts> = {}): PersonFacts => ({ verdict: { state: 'dead', cause }, hibernatedAt: null, substrate: null, ...over });
  const closeRowFor = (f: RunStuckFacts) => closeRowOf(f, runStuck(f, T0));

  it('a removal names E3: an archive stamp, or a journaled archive, forget, purge, destroy, reap or expire', () => {
    expect(closeRowFor(facts({ claimant: goneBy('orphan', { archivedAt: T0 - 5 * H }), times: times({ archivedAt: T0 - 5 * H }) }))).toBe('claimant-gone');
    for (const act of ['archive', 'forget', 'purge', 'destroy', 'reap', 'expire'] as const) {
      const f = facts({ claimant: goneBy('orphan'), claimantJournal: { kind: 'deliberate', act, at: T0 - 5 * H }, times: times({ journalAt: T0 - 5 * H }) });
      expect(closeRowFor(f), act).toBe('claimant-gone');
    }
  });

  it('a hand-over (reclaim) is no removal, and a crash, an unattributed stop and a worker cause name no row', () => {
    expect(closeRowFor(facts({ claimant: goneBy('orphan'), claimantJournal: { kind: 'deliberate', act: 'reclaim', at: T0 - 5 * H }, times: times({ journalAt: T0 - 5 * H }) }))).toBeNull();
    expect(closeRowFor(facts({ claimant: goneBy('orphan'), times: times({ goneSinceCoordinator: T0 - 5 * H }) }))).toBeNull();
    const stopped: PersonFacts = { verdict: { state: 'dead', cause: 'stopped' }, hibernatedAt: null, substrate: null };
    expect(closeRowFor(facts({ claimant: stopped, claimantJournal: { kind: 'deliberate', act: 'stop', at: T0 - 30 * H }, times: times({ journalAt: T0 - 30 * H }) }))).toBeNull();
    const worker: PersonFacts = { verdict: { state: 'dead', cause: 'stopped' }, hibernatedAt: null, substrate: null };
    expect(closeRowFor(facts({ worker, lastMoveAt: T0 - 48 * H, times: times({ workerStoppedAt: T0 - 48 * H }) }))).toBeNull();
  });

  it('a stop a person made names E3s', () => {
    const stopped: PersonFacts = { verdict: { state: 'dead', cause: 'stopped' }, hibernatedAt: null, substrate: null, stoppedByPerson: true };
    expect(closeRowFor(facts({ claimant: stopped, claimantJournal: { kind: 'deliberate', act: 'stop', at: T0 - 30 * H }, times: times({ journalAt: T0 - 30 * H }) }))).toBe('claimant-stopped');
  });

  it('a substrate stamp on the claimant is doubt: no verdict, so no row', () => {
    const stamped = goneBy('orphan', { archivedAt: T0 - 5 * H, substrate: { at: T0 - H, text: 'could not reach tmux' } });
    expect(closeRowFor(facts({ claimant: stamped, times: times({ archivedAt: T0 - 5 * H }) }))).toBeNull();
    expect(runStuck(facts({ claimant: stamped, times: times({ archivedAt: T0 - 5 * H }) }), T0)).toBeNull();
  });
});

// ── the lane half ───────────────────────────────────────────────────────────────────────────────────────────

interface Opts { names?: string[]; branchFacts?: BranchFacts | null; openPr?: boolean | null; verdicts?: Record<string, ClaimantVerdict>; mark?: ChildMarkRead; substrate?: string[] }

const rig = async (o: Opts = {}) => {
  const home = mkTmp('ccrc-gone-lane-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const run: Runner = async () => ({ ran: true, code: 0, stdout: '', stderr: '' });
  const base = testDeps(home, run);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const verdicts = createRunVerdicts();
  const closesSeen: Map<number, NonNullable<RunStuck['closes']>>[] = [];
  const realSet = verdicts.setCloses.bind(verdicts);
  verdicts.setCloses = (c) => { closesSeen.push(new Map(c)); realSet(c); };
  const state = {
    clock: T0, names: o.names ?? [], verdicts: { ...(o.verdicts ?? {}) } as Record<string, ClaimantVerdict>, openPr: o.openPr === undefined ? false : o.openPr,
    mark: o.mark ?? ({ kind: 'none' } as ChildMarkRead),
    prReads: [] as string[], marksRead: [] as string[], measured: [] as string[],
  };
  let memory = createRunCloseMemory();
  const deps = (): RunCloseLaneDeps => ({
    coord, verdicts, memory, notifyLog, now: () => state.clock,
    registryNames: async () => state.names,
    measure: async (id) => { state.measured.push(id); return state.verdicts[id] ?? DEAD; },
    measureHeld: async (id) => (o.substrate?.includes(id) === true
      ? { state: 'unmeasurable', why: 'a substrate stamp stands over the gone pane' } : state.verdicts[id] ?? DEAD),
    claimantBusyAt: () => null,
    branchFacts: async () => (o.branchFacts === undefined || o.branchFacts === null ? { readAt: state.clock, openPr: false, unpushed: false } : { ...o.branchFacts, readAt: state.clock }),
    childMark: async (sid) => { state.marksRead.push(sid); return state.mark; },
    branchOpenPr: async (project, branch) => { state.prReads.push(`${project}/${branch}`); return state.openPr; },
    abandonRefusal: (id) => abandonRefusal(coord, id),
    serial: async (c, fn) => fn((runId, claimedBy, stillStuck, extra): Promise<CloseOutcome> =>
      closeRun({ coord: c, io: base.io, cfg: base.cfg, runCcd: base.runCcd }, runId, { intent: 'abandon' }, 'sweep', { claimedBy, stillStuck, ...extra })),
  });
  const pass = (): Promise<RunCloseOutcome> => runClosePass(deps());
  /** A started run (or a planned one): the verdict reader is told its answer, as the stuck pass would. */
  const open = (program: string, wave: number, over: {
    claimedBy?: string; state?: RunState; sessionId?: string | null; branch?: string | null;
  } = {}): number => {
    const r = coord.openRun({ program, title: `T ${wave}`, project: 'demo', wave, waveOf: null, claimedBy: over.claimedBy ?? 'coord-a' });
    if (!('id' in r)) throw new Error(`fixture openRun refused: ${JSON.stringify(r)}`);
    const st = over.state ?? 'working';
    coord.db.prepare('UPDATE runs SET openedAt = ?, state = ?, sessionId = ?, branch = ?, dispatchedAt = ? WHERE id = ?')
      .run(T0 - 100 * H, st, over.sessionId === undefined ? null : over.sessionId, over.branch === undefined ? null : over.branch, st === 'planned' ? null : T0 - 90 * H, r.id);
    return r.id;
  };
  const answers = new Map<number, RunVerdict>();
  const tell = (id: number, closeRow: RunVerdict['closeRow'], extra: { since?: number; reason?: RunStuck['reason']; cause?: RunStuck['cause']; clear?: boolean } = {}): void => {
    answers.set(id, {
      stuck: { reason: extra.reason ?? 'owner-gone', cause: extra.cause ?? 'coordinator-archived', since: extra.since ?? T0 - 5 * H, closes: null },
      blockedBy: null, coordinatorGone: true, ...(closeRow === undefined ? {} : { closeRow }), ...(extra.clear === true ? { nameReusedClear: true } : {}),
    });
    verdicts.replace(answers, new Map());
  };
  const stateOf = (id: number): string => (coord.run(id) as { run: { state: string } }).run.state;
  const closesNow = (id: number) => closesSeen.at(-1)?.get(id) ?? null;
  const feed = (): string[] => (coord.db.prepare('SELECT title FROM feed_events ORDER BY id').all() as { title: string }[]).map((r) => r.title);
  /** A controller restart: the lane's in-memory state is gone, the store stays. */
  const restart = (): void => { memory = createRunCloseMemory(); };
  return { coord, state, restart, pass, open, tell, stateOf, closesNow, feed, verdicts, closesSeen };
};
type Rig = Awaited<ReturnType<typeof rig>>;
const passesFor = async (r: Rig, ms: number): Promise<void> => {
  for (let spent = 0; spent < ms; spent += 5 * 60_000) { await r.pass(); r.state.clock += 5 * 60_000; }
};

describe('E3 and E3s in shadow: a clock, a list, no act', () => {
  it('E3 counts the first pass plus 1 h, and the programme\'s activity leaves it where it was', async () => {
    const r = await rig();
    const id = r.open('programme-a', 1, { sessionId: 'w-1' });
    r.tell(id, 'claimant-gone');
    await r.pass();
    expect(r.closesNow(id)).toEqual({ at: T0 + H, armed: false });
    await passesFor(r, 20 * 60_000);
    r.coord.db.prepare("INSERT INTO mail (fromId, fromUuid, toId, runId, kind, subject, body, at, artifacts) VALUES ('coord-a', 'u', 'w', ?, 'status', 's', 'b', ?, '[]')").run(id, r.state.clock);
    r.coord.db.prepare('UPDATE runs SET lastDispatchAttemptAt = ? WHERE id = ?').run(r.state.clock, id);
    await r.pass();
    expect(r.closesNow(id)).toEqual({ at: T0 + H, armed: false });
    expect(r.stateOf(id)).toBe('working');
    expect(r.verdicts.reading()?.groups['claimant-gone']?.would).toEqual([{ runId: id, program: 'programme-a', why: 'claimant-gone', at: T0 + H }]);
  });

  it('E3s counts the first pass plus 24 h', async () => {
    const r = await rig();
    const id = r.open('programme-a', 1);
    r.tell(id, 'claimant-stopped', { cause: 'coordinator-stopped' });
    await r.pass();
    expect(r.closesNow(id)).toEqual({ at: T0 + 24 * H, armed: false });
    expect(r.verdicts.reading()?.groups['claimant-gone']?.would[0]).toMatchObject({ why: 'claimant-stopped' });
  });

  it('a gap restarts the anchor, as it does for every row with a grace (R5)', async () => {
    const r = await rig();
    const id = r.open('programme-a', 1);
    r.tell(id, 'claimant-gone');
    await r.pass();
    r.state.clock += 3 * H;
    await r.pass();
    expect(r.closesNow(id)).toEqual({ at: T0 + 3 * H + H, armed: false });
  });

  it('a busy worker under a gone coordinator has closes null, is named busy-worker, and is never touched', async () => {
    const r = await rig({ verdicts: { 'w-1': ALIVE } });
    const id = r.open('programme-a', 1, { sessionId: 'w-1' });
    r.tell(id, 'claimant-gone');
    await r.pass();
    expect(r.closesNow(id)).toBeNull();
    expect(r.verdicts.reading()?.groups['claimant-gone']).toEqual({ would: [], named: [{ runId: id, program: 'programme-a', why: 'busy-worker' }] });
  });

  it('an open PR or unpushed commits hold the run (R6), and an unmeasured read does too', async () => {
    for (const [branchFacts, why] of [
      [{ openPr: true, unpushed: false }, 'open-pr'], [{ openPr: false, unpushed: true }, 'unpushed-commits'], [{ openPr: null, unpushed: null }, 'unmeasured'],
    ] as const) {
      const r = await rig({ branchFacts: { readAt: T0, ...branchFacts } });
      const id = r.open('programme-a', 1, { sessionId: 'w-1' });
      r.tell(id, 'claimant-gone');
      await r.pass();
      expect(r.closesNow(id), why).toBeNull();
      expect(r.verdicts.reading()?.groups['claimant-gone']?.named, why).toEqual([{ runId: id, program: 'programme-a', why }]);
    }
  });

  it('a coordinator that no longer measures dead is doubt: no clock, no anchor', async () => {
    const r = await rig({ verdicts: { 'coord-a': ALIVE } });
    const id = r.open('programme-a', 1);
    r.tell(id, 'claimant-gone');
    await r.pass();
    expect(r.closesNow(id)).toBeNull();
    expect(r.coord.runCloseAnchors('claimant-gone').size).toBe(0);
  });

  it('a run the verdict does not name a row for is not in the lane', async () => {
    const r = await rig();
    const id = r.open('programme-a', 1);
    r.tell(id, undefined);
    await r.pass();
    expect(r.closesNow(id)).toBeNull();
    expect(r.verdicts.reading()?.groups['claimant-gone']).toEqual({ would: [], named: [] });
  });

  it('65, 66 and 83 stay on E1 with hours and E3 gives them no closes (o2, §12.2\'s precedence rule)', async () => {
    const r = await rig();
    const ids = [r.open('programme-a', 1, { state: 'planned' }), r.open('programme-a', 2, { state: 'planned' })];
    for (const id of ids) r.tell(id, 'claimant-gone');
    r.coord.setRunCloseAnchor('never-started', 'programme-a', { firstAt: T0 - 60 * H, lastAt: T0 - 60_000 });
    await r.pass();
    for (const id of ids) expect(r.closesNow(id), `run ${id}`).toEqual({ at: T0 - 60 * H + 72 * H, armed: false });
    expect(r.coord.runCloseAnchors('claimant-gone').size).toBe(0);
    expect(r.verdicts.reading()?.groups['claimant-gone']).toEqual({ would: [], named: [] });
  });

  it('two coordinators that went gone while the lane watched, within the window, are held for a person, and one far from another is not', async () => {
    const r = await rig();
    const a = r.open('programme-a', 1, { claimedBy: 'coord-a' });
    const b = r.open('programme-b', 1, { claimedBy: 'coord-b' });
    const c = r.open('programme-c', 1, { claimedBy: 'coord-c' });
    // Gone two hours before the lane's first pass (past the verdict's grace), a minute apart: still one burst.
    r.tell(a, 'claimant-gone', { since: T0 - 2 * H - 120_000 });
    r.tell(b, 'claimant-gone', { since: T0 - 2 * H - 60_000 });
    r.tell(c, 'claimant-gone', { since: T0 - 90 * H });
    await r.pass();
    expect(r.closesNow(a)).toBeNull();
    expect(r.closesNow(b)).toBeNull();
    expect(r.closesNow(c)).toEqual({ at: T0 + H, armed: false });
    expect(r.verdicts.reading()?.groups['claimant-gone']?.named).toEqual([
      { runId: a, program: 'programme-a', why: 'breaker-held' }, { runId: b, program: 'programme-b', why: 'breaker-held' },
    ]);
    // Still held on the passes after: the series' first pass, not the clock, decides.
    await passesFor(r, 30 * 60_000);
    expect(r.closesNow(a)).toBeNull();
  });

  it('old gone coordinators whose times are far apart act on the first pass: the breaker counts transitions, not states', async () => {
    const r = await rig();
    const ids = ['a', 'b', 'c'].map((x) => r.open(`programme-${x}`, 1, { claimedBy: `coord-${x}` }));
    ids.forEach((id, i) => r.tell(id, 'claimant-gone', { since: T0 - 50 * H + i * H }));
    await r.pass();
    for (const id of ids) expect(r.closesNow(id)).toEqual({ at: T0 + H, armed: false });
    expect(r.verdicts.reading()?.groups['claimant-gone']?.named).toEqual([]);
  });

  it('E3 on a run whose workspace name a later run holds touches no session: no live-session hold, no ccd call, the run\'s own branch', async () => {
    const r = await rig({ verdicts: { 'w-1': ALIVE }, mark: { kind: 'child', runId: 9999 }, openPr: false });
    const id = r.open('programme-a', 1, { sessionId: 'w-1', branch: 'ws/old-branch' });
    r.tell(id, 'claimant-gone', { cause: 'name-reused', clear: true });
    await r.pass();
    expect(r.closesNow(id)).toEqual({ at: T0 + H, armed: false });
    expect(r.state.measured).not.toContain('w-1');
    expect(r.state.prReads).toEqual(['demo/ws/old-branch']);
    expect(r.verdicts.reading()?.groups['claimant-gone']).toEqual({ would: [{ runId: id, program: 'programme-a', why: expect.any(String), at: T0 + H }], named: [] });
  });

  it('the group off reads and records nothing for these rows, and the never-started group off leaves them running', async () => {
    const r = await rig();
    const id = r.open('programme-a', 1);
    r.tell(id, 'claimant-gone');
    r.coord.setRunCloseChoice('claimant-gone', 'off', T0);
    await r.pass();
    expect(r.closesNow(id)).toBeNull();
    expect(r.coord.runCloseAnchors('claimant-gone').size).toBe(0);
    expect(r.verdicts.reading()?.groups['claimant-gone']).toBeUndefined();
  });
});

describe('E5: a session name a later run holds', () => {
  const reused = async (o: Opts & { clear?: boolean; branch?: string | null } = {}) => {
    const r = await rig(o);
    const id = r.open('programme-a', 1, { sessionId: 'w-1', branch: o.branch === undefined ? 'ws/old-branch' : o.branch });
    r.tell(id, 'name-reused', { cause: 'name-reused', ...(o.clear === false ? {} : { clear: true }) });
    return { r, id };
  };

  it('closes the next pass, with no anchor, no ccd call and no live-session hold', async () => {
    const { r, id } = await reused({ verdicts: { 'w-1': ALIVE } });
    await r.pass();
    expect(r.closesNow(id)).toEqual({ at: T0, armed: false });
    expect(r.state.measured).not.toContain('w-1');
    expect(r.state.marksRead).toEqual([]);
    expect(r.coord.runCloseAnchors('name-reused').size).toBe(0);
  });

  it('reads the open-PR fact by the run\'s own branch, never by the session', async () => {
    const { r } = await reused();
    await r.pass();
    expect(r.state.prReads).toEqual(['demo/ws/old-branch']);
  });

  it('an E5 close with an open PR on the old branch is refused although the session\'s branch has none', async () => {
    const { r, id } = await reused({ openPr: true });
    await r.pass();
    expect(r.closesNow(id)).toBeNull();
    expect(r.verdicts.reading()?.groups['claimant-gone']?.named).toEqual([{ runId: id, program: 'programme-a', why: 'open-pr' }]);
  });

  it('is unmeasured, listed and never closed when the journal does not account for the old workspace, or the PR read failed', async () => {
    const a = await reused({ clear: false });
    await a.r.pass();
    expect(a.r.closesNow(a.id)).toBeNull();
    expect(a.r.verdicts.reading()?.groups['claimant-gone']?.named).toEqual([{ runId: a.id, program: 'programme-a', why: 'unmeasured' }]);
    const b = await reused({ openPr: null });
    await b.r.pass();
    expect(b.r.closesNow(b.id)).toBeNull();
    const c = await reused({ branch: null });
    await c.r.pass();
    expect(c.r.closesNow(c.id)).toBeNull();
  });
});

describe('armed: the group\'s own choice or marker acts, and no other group\'s does', () => {
  it('another group\'s marker arms none of the three rows', async () => {
    const r = await rig({ names: [RUNS_EXPIRE_NEVER_STARTED_MARKER] });
    const id = r.open('programme-a', 1);
    r.tell(id, 'claimant-gone');
    await passesFor(r, 2 * H);
    expect(r.stateOf(id)).toBe('working');
    expect(r.closesNow(id)).toMatchObject({ armed: false });
  });

  it('E3 closes the run after the hour, through the abandon arm, and records why', async () => {
    const r = await rig({ names: ARMED });
    const id = r.open('programme-a', 1);
    r.tell(id, 'claimant-gone');
    await passesFor(r, 30 * 60_000);
    expect(r.stateOf(id)).toBe('working');
    await passesFor(r, 40 * 60_000);
    const run = r.coord.db.prepare('SELECT state, closedBy, closeDetail FROM runs WHERE id = ?').get(id) as { state: string; closedBy: string; closeDetail: string };
    expect(run.closedBy).toBe('sweep');
    expect(run.closeDetail).toBe('expired:claimant-gone');
    expect(r.feed()).toContain(`ccrc closes programme-a`);
  });

  it('E3s closes only after 24 h, and E5 on the very next pass', async () => {
    const r = await rig({ names: ARMED });
    const s = r.open('programme-s', 1, { claimedBy: 'coord-s' });
    r.tell(s, 'claimant-stopped', { cause: 'coordinator-stopped' });
    await passesFor(r, 23 * H);
    expect(r.stateOf(s)).toBe('working');
    await passesFor(r, 2 * H);
    expect(r.stateOf(s)).not.toBe('working');
    const e5 = r.open('programme-e', 1, { claimedBy: 'coord-e', sessionId: 'w-9', branch: 'ws/old' });
    r.tell(e5, 'name-reused', { cause: 'name-reused', clear: true });
    r.verdicts.replace(new Map([...[e5].map((i) => [i, { stuck: { reason: 'owner-gone' as const, cause: 'name-reused' as const, since: T0, closes: null }, blockedBy: null, coordinatorGone: false, closeRow: 'name-reused' as const, nameReusedClear: true }] as const)]), new Map());
    r.state.mark = { kind: 'child', runId: e5 + 1 };
    await r.pass();
    expect(r.coord.db.prepare('SELECT closeDetail FROM runs WHERE id = ?').get(e5)).toEqual({ closeDetail: 'expired:name-reused' });
  });

  it('a coordinator that revives between the pass and the act stops the close', async () => {
    const r = await rig({ names: ARMED });
    const id = r.open('programme-a', 1);
    r.tell(id, 'claimant-gone');
    await passesFor(r, 55 * 60_000);
    r.state.verdicts['coord-a'] = ALIVE;
    await passesFor(r, 20 * 60_000);
    expect(r.stateOf(id)).toBe('working');
  });

  it('a busy worker under a gone coordinator is the refusal that raises its item at once', async () => {
    const r = await rig({ names: ARMED, verdicts: { 'w-1': ALIVE } });
    const id = r.open('programme-a', 1, { sessionId: 'w-1' });
    r.tell(id, 'claimant-gone');
    await passesFor(r, 70 * 60_000);
    expect(r.stateOf(id)).toBe('working');
    const item = r.coord.db.prepare('SELECT action FROM operator_items').all() as { action: string }[];
    expect(item.map((i) => JSON.parse(i.action))).toEqual([expect.objectContaining({ verb: 'close-refused', runId: id, doors: ['open-worker'] })]);
  });
});

describe('the breaker, the snapshot and the holds (review of D-8078)', () => {
  it('coordinators archived together weeks ago are a backlog, not a burst: the first pass counts down their closes', async () => {
    const r = await rig();
    const ids = ['a', 'b', 'c'].map((x) => r.open(`programme-${x}`, 1, { claimedBy: `coord-${x}` }));
    ids.forEach((id, i) => r.tell(id, 'claimant-gone', { since: T0 - 30 * 24 * H + i * 60_000 }));
    await r.pass();
    for (const id of ids) expect(r.closesNow(id)).toEqual({ at: T0 + H, armed: false });
    expect(r.verdicts.reading()?.groups['claimant-gone']?.named).toEqual([]);
  });

  it('a burst seen is held durably, also after a pause restarted every grace', async () => {
    const r = await rig({ names: ARMED });
    const a = r.open('programme-a', 1, { claimedBy: 'coord-a' });
    const b = r.open('programme-b', 1, { claimedBy: 'coord-b' });
    await r.pass();   // armed with nothing to snapshot
    r.tell(a, 'claimant-gone', { since: T0 - 2 * H });
    r.tell(b, 'claimant-gone', { since: T0 - 2 * H - 1000 });
    await passesFor(r, 3 * H);
    expect(r.stateOf(a)).toBe('working');
    expect(r.stateOf(b)).toBe('working');
  });

  it('the backlog present at arming is exempt from clustering, and a later burst is not', async () => {
    const r = await rig({ names: ARMED });
    const a = r.open('programme-a', 1, { claimedBy: 'coord-a' });
    const b = r.open('programme-b', 1, { claimedBy: 'coord-b' });
    r.tell(a, 'claimant-gone', { since: T0 - 3 * H });
    r.tell(b, 'claimant-gone', { since: T0 - 3 * H - 1000 });
    await passesFor(r, 70 * 60_000);
    expect(r.stateOf(a)).not.toBe('working');
    expect(r.stateOf(b)).not.toBe('working');
    const c = r.open('programme-c', 1, { claimedBy: 'coord-c' });
    const d = r.open('programme-d', 1, { claimedBy: 'coord-d' });
    r.tell(c, 'claimant-gone', { since: r.state.clock - 2 * H });
    r.tell(d, 'claimant-gone', { since: r.state.clock - 2 * H - 1000 });
    await passesFor(r, 2 * H);
    expect(r.stateOf(c)).toBe('working');
    expect(r.stateOf(d)).toBe('working');
  });

  it('E3 and E3s are separate pools: one coordinator of each, gone together, trips neither', async () => {
    const r = await rig();
    const a = r.open('programme-a', 1, { claimedBy: 'coord-a' });
    const b = r.open('programme-b', 1, { claimedBy: 'coord-b' });
    r.tell(a, 'claimant-gone', { since: T0 - 2 * H });
    r.tell(b, 'claimant-stopped', { cause: 'coordinator-stopped', since: T0 - 2 * H - 1000 });
    await r.pass();
    expect(r.closesNow(a)).toEqual({ at: T0 + H, armed: false });
    expect(r.closesNow(b)).toEqual({ at: T0 + 24 * H, armed: false });
  });

  it('a pause restarts the grace of E3 too: a close 55 minutes in does not follow a short pause at once', async () => {
    const r = await rig({ names: ARMED });
    const id = r.open('programme-a', 1);
    r.tell(id, 'claimant-gone');
    await passesFor(r, 55 * 60_000);
    r.state.names = [...ARMED, RECLAIM_PAUSE_MARKER];
    await passesFor(r, 8 * 60_000);
    r.state.names = ARMED;
    await r.pass();
    expect(r.stateOf(id)).toBe('working');
    expect(r.coord.runCloseAnchors('claimant-gone').get(String(id))?.firstAt).toBeGreaterThan(T0 + 55 * 60_000);
  });

  it('a shadow never-started group raises no item when only the claimant-gone group is armed (R8, A53)', async () => {
    const r = await rig({ names: ARMED });
    const id = r.open('programme-p', 1, { state: 'planned', claimedBy: 'coord-p' });
    r.coord.db.prepare('UPDATE runs SET openedAt = ? WHERE id = ?').run(T0 - 400 * H, id);
    r.state.verdicts['coord-p'] = ALIVE;
    await passesFor(r, 80 * H);
    expect(r.coord.db.prepare('SELECT count(*) AS n FROM operator_items').get()).toEqual({ n: 0 });
    expect(r.stateOf(id)).toBe('planned');
  });
});

describe('the ruled W2 pins the review of D-8078 found missing', () => {
  const items = (r: Rig): { verb: string; runId: number; doors: string[] }[] =>
    (r.coord.db.prepare('SELECT action FROM operator_items').all() as { action: string }[]).map((i) => JSON.parse(i.action));

  it('a substrate stamp holds E3 over a stale closeRow: the verdict pass has not caught up, and the run is never closed on a doubt (A56)', async () => {
    const r = await rig({ names: ARMED, substrate: ['coord-a'] });
    const id = r.open('programme-a', 1);
    r.tell(id, 'claimant-gone');
    await passesFor(r, 2 * H);
    expect(r.stateOf(id)).toBe('working');
    expect(r.closesNow(id)).toBeNull();
  });

  it('a stamp that appears between the pass and the act stops the close', async () => {
    const o: Opts = { names: ARMED };
    const r = await rig(o);
    const id = r.open('programme-a', 1);
    r.tell(id, 'claimant-gone');
    await passesFor(r, 55 * 60_000);
    o.substrate = ['coord-a'];
    await passesFor(r, 20 * 60_000);
    expect(r.stateOf(id)).toBe('working');
  });

  it('a planned review of a refused work run stays open with it, listed under the same reason', async () => {
    const r = await rig({ names: ARMED, branchFacts: { readAt: T0, openPr: true, unpushed: false } });
    const work = r.open('programme-a', 1, { sessionId: 'w-1' });
    const review = r.open('programme-a', 2, { state: 'planned' });
    r.coord.db.prepare("UPDATE runs SET kind = 'review', reviews = ? WHERE id = ?").run(work, review);
    r.tell(work, 'claimant-gone');
    r.tell(review, 'claimant-gone');
    await passesFor(r, 2 * H);
    expect(r.stateOf(work)).toBe('working');
    expect(r.stateOf(review)).toBe('planned');
    expect(r.verdicts.reading()?.groups['claimant-gone']?.named).toEqual(
      expect.arrayContaining([{ runId: work, program: 'programme-a', why: 'open-pr' }, { runId: review, program: 'programme-a', why: 'open-pr' }]));
  });

  it('a started run under an absent claimant with no lifecycle history is listed with Abandon, never closed', async () => {
    const r = await rig({ names: ARMED, verdicts: { 'coord-a': { state: 'dead', cause: 'absent', why: 'no registry row' } } });
    const id = r.open('programme-a', 1);
    await passesFor(r, 3 * H);
    expect(r.stateOf(id)).toBe('working');
    // D-8558: the programme's last live run, under a claimant the registry no longer holds, may end the programme too.
    expect(items(r)).toEqual([expect.objectContaining({ verb: 'close-refused', runId: id, doors: ['abandon', 'end-programme'] })]);
  });

  it('an absent claimant is not listed while the group is in shadow', async () => {
    const r = await rig({ verdicts: { 'coord-a': { state: 'dead', cause: 'absent', why: 'no registry row' } } });
    r.open('programme-a', 1);
    await passesFor(r, 3 * H);
    expect(items(r)).toEqual([]);
  });

  it('a simulated all-panes-stopped burst acts on nothing, whatever the backlog', async () => {
    const r = await rig({ names: ARMED, verdicts: { 'coord-a': { state: 'unmeasurable', why: 'tmux did not answer' }, 'coord-b': { state: 'unmeasurable', why: 'tmux did not answer' } } });
    const ids = ['a', 'b', 'c'].map((x) => r.open(`programme-${x}`, 1, { claimedBy: `coord-${x}` }));
    ids.forEach((id) => r.tell(id, 'claimant-gone', { since: T0 - 30 * 24 * H }));
    await passesFor(r, 3 * H);
    for (const id of ids) expect(r.stateOf(id)).toBe('working');
    expect(r.verdicts.reading()?.groups['claimant-gone']?.named).toEqual([{ runId: ids[2], program: 'programme-c', why: 'breaker-held' }]);
  });

  it('the breaker holds every coordinator of the pool under a lane-wide doubt', () => {
    expect([...claimantGoneBreaker(new Map([['a', T0], ['b', T0 + 50 * H]]), true)].sort()).toEqual(['a', 'b']);
    expect([...claimantGoneBreaker(new Map([['a', T0], ['b', T0 + 50 * H]]), false)]).toEqual([]);
  });

  it('an E3 close creates no parked delivery, and no mail at all', async () => {
    const r = await rig({ names: ARMED });
    const id = r.open('programme-a', 1);
    r.tell(id, 'claimant-gone');
    const before = (r.coord.db.prepare('SELECT COUNT(*) AS n FROM mail_deliveries').get() as { n: number }).n;
    await passesFor(r, 2 * H);
    expect(r.stateOf(id)).not.toBe('working');
    expect((r.coord.db.prepare('SELECT COUNT(*) AS n FROM mail_deliveries').get() as { n: number }).n).toBe(before);
    expect(r.coord.db.prepare("SELECT COUNT(*) AS n FROM mail_deliveries WHERE parkedAt IS NOT NULL").get()).toEqual({ n: 0 });
  });

  it('a controller restart after arming does not re-snapshot: a burst that began after arming is still held', async () => {
    const r = await rig({ names: ARMED });
    await r.pass();   // armed with nothing to snapshot: the durable snapshot is empty
    r.restart();
    const c = r.open('programme-c', 1, { claimedBy: 'coord-c' });
    const d = r.open('programme-d', 1, { claimedBy: 'coord-d' });
    r.tell(c, 'claimant-gone', { since: r.state.clock - 2 * H });
    r.tell(d, 'claimant-gone', { since: r.state.clock - 2 * H - 1000 });
    await passesFor(r, 2 * H);
    expect(r.stateOf(c)).toBe('working');
    expect(r.stateOf(d)).toBe('working');
  });
});
