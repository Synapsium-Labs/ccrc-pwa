// Overlord W1a, the generations (Tasks 2 and 3): the lane's pass mints and ends generations from the reported starts,
// advances each identity's observed accumulator, and records `renewalDue` on every generation at rest. A real coord.db,
// the fake time ports and a fake registry; nothing here reaches the fleet.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync } from 'node:fs';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { loadConfig } from '../src/config.js';
import { seedRoster, testDeps } from './helpers.js';
import { quietWatcher } from './laneQuiet.js';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { GenRow } from '../src/continuity/continuityStore.js';
import { renewalDue } from '../src/continuity/renewalDue.js';
import { renewalReadingsOf } from '../src/continuity/renewalReadingsWiring.js';
import {
  GENERATIONS_LANE, applyFedEvents, gatherGenerationReadings, generationsPass, renewalInputsOf, softTimesOf,
  type CompactionsMemo, type EmptyTries, type FedEvent, type GatherPorts, type GenReadings, type GenerationsDeps, type RegistryFacts,
} from '../src/continuity/generationsLane.js';
import type { CompactionsRead } from '../src/continuity/compactions.js';
import type { UsageRead } from '../src/usage.js';
import type { MeasuredStat } from '../src/io.js';
import type { ChildMark } from '../../shared/api.js';
import type { AttemptAction, DesignationRead, DesignationView, SettleFact } from '../../shared/overlord-designation.js';
import { CONTINUITY_LANE } from '../../shared/lane-arm.js';
import { HOLD_OFF_MS } from '../../shared/continuity.js';
import { START_RETRY_MS } from '../src/continuity/generationStart.js';
import { parsedFile } from './scan/symbols.js';
import { snapshotFactsJson } from '../src/continuity/card.js';
import { gradeAnswers } from '../src/continuity/probeDoor.js';
import type { CardFacts } from '../../shared/continuity-card.js';
import type { TurnMarkRead } from '../src/coord/stall.js';
import { fakeTime, FAKE_T0, type FakeTime } from './fakeTime.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const COORD = 'lane-a-project-a';
const WORKER = 'lane-a-project-a-child';
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';

interface Fixture {
  s: CoordStore; t: FakeTime; logs: string[]; registry: RegistryFacts[];
  /** One pass. Its registry is listed just after the clock's now (so after every start the fixture has received) unless
   *  `listedAt` says when; each `proc` keeps its own memo of held starts, as a server process does. */
  pass(readings?: ReadonlyMap<number, GenReadings>, proc?: string, listedAt?: number): ReturnType<typeof generationsPass>;
  start(source: string, uuid: string, at?: number, sessionId?: string, rowIncarnation?: string): number;
  /** The pass's latch raise (renewal readings PR C), when a case sets one: absent, the pass has none. */
  latch?: GenerationsDeps['latch'];
  canRenew?: boolean;
}

function fixture(): Fixture {
  const s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-genlane-'), '.ccrc', 'coord.db')));
  // The coordinator claims an open work run, so `roleOf` reads it as a coordinator.
  s.db.exec("INSERT INTO programs (slug, title, createdAt, state) VALUES ('prog-a', 'P', 1, 'active')");
  s.db.prepare("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) VALUES ('prog-a', 1, 2, 'project-a', 'working', ?, 1)").run(COORD);
  const t = fakeTime({ wallMs: FAKE_T0, monoMs: 1_000 });
  const logs: string[] = [];
  const registry: RegistryFacts[] = [{ id: COORD, uuid: U1, lane: 'lane-a', child: { kind: 'none' } }];
  let n = 0;
  const memos = new Map<string, Set<number>>();
  const empties = new Map<string, EmptyTries>();
  const deps = (proc: string): GenerationsDeps => {
    if (!memos.has(proc)) memos.set(proc, new Set());
    if (!empties.has(proc)) empties.set(proc, new Map());
    // The renewal act lifted the continuity row's gate; these cases still pass an open one, so they never depend on the
    // card's words (review 2006 N1). The case below holds that the real gate is open too.
    return { coord: s, clock: t.ports.clock, entropy: t.ports.entropy, proc, log: (l) => logs.push(l), retried: memos.get(proc)!, emptyTries: empties.get(proc)!, gate: () => null,
      ...(f.latch === undefined ? {} : { latch: f.latch }) };
  };
  const f: Fixture = {
    s, t, logs, registry,
    pass: (readings = new Map(), proc = 'p1', listedAt = t.ports.clock.wall() + 1) => generationsPass(deps(proc), { registry, readings, listedAt, canRenew: f.canRenew === true }),
    start: (source, uuid, at = t.ports.clock.wall(), sessionId = COORD, rowIncarnation = 'inc-1') => {
      n += 1;
      const r = s.insertStart({ sessionId, reportId: `r-${n}`, uuid, source, model: 'claude-opus-5-5', rowIncarnation,
        reportedAt: at, receivedAt: t.ports.clock.wall() });
      if (!r.ok) throw new Error('start not recorded');
      return r.id;
    },
  };
  return f;
}
const all = (s: CoordStore): Record<string, unknown>[] =>
  s.db.prepare('SELECT identity, n, state, shadowState, outcome, startId FROM continuity_generations ORDER BY id').all() as Record<string, unknown>[];
/** The coordinator's run, closed: it then claims no open run, and reads undecided. */
const closeRuns = (s: CoordStore): void => { s.db.prepare("UPDATE runs SET state = 'done' WHERE claimedBy = ?").run(COORD); };
const live = (s: CoordStore): GenRow[] => { const r = s.liveGenerations(); if (!r.ok) throw new Error(r.detail); return r.rows; };
const setRegistry = (f: Fixture, uuid: string): void => { f.registry[0] = { ...f.registry[0]!, uuid }; };

describe('the pass mints and ends generations from the starts (Task 2)', () => {
  it('a coordinator\'s startup mints n=1 at carded (in shadow: `shadowState`); its clear on the same incarnation mints n=2 and ends n=1 cleared, and an unplanned resume ends n=2 crashed', () => {
    const f = fixture();
    f.start('startup', U1);
    expect(f.pass()).toMatchObject({ read: 1, minted: 1, live: false });
    expect(all(f.s)).toEqual([{ identity: COORD, n: 1, state: 'active', shadowState: 'carded', outcome: null, startId: 1 }]);
    f.t.advance(30_000);
    setRegistry(f, U2);
    f.start('clear', U2);
    expect(f.pass()).toMatchObject({ read: 1, minted: 1 });
    f.t.advance(30_000);
    f.start('resume', U2);
    expect(f.pass()).toMatchObject({ read: 1, minted: 1 });
    expect(all(f.s)).toEqual([
      // In shadow the `state` column stood `active`, so the outcome reads what the session lived (review 2003 F1): a
      // `/clear` on the same incarnation and account is not a crash (review 2006, slug clear-is-not-a-crash) ...
      { identity: COORD, n: 1, state: 'ended', shadowState: 'carded', outcome: 'cleared', startId: 1 },
      // ... and a start with no planned cause on the same incarnation is.
      { identity: COORD, n: 2, state: 'ended', shadowState: 'carded', outcome: 'crashed', startId: 2 },
      { identity: COORD, n: 3, state: 'active', shadowState: 'carded', outcome: null, startId: 3 },
    ]);
  });

  it('live: the mint writes `state` carded', () => {
    const f = fixture();
    f.s.setLaneArm(CONTINUITY_LANE, 'live', 1);
    f.start('startup', U1);
    f.pass();
    expect(all(f.s)).toEqual([{ identity: COORD, n: 1, state: 'carded', shadowState: null, outcome: null, startId: 1 }]);
  });

  it('the renewal act lifted the continuity row\'s gate: with the real gate, a stored Live walks the mint\'s `state` (review 2003 F3)', () => {
    const f = fixture();
    f.s.setLaneArm(CONTINUITY_LANE, 'live', 1);
    f.start('startup', U1);
    const r = generationsPass({ coord: f.s, clock: f.t.ports.clock, entropy: f.t.ports.entropy, proc: 'p1', log: () => {}, retried: new Set(), emptyTries: new Map() },
      { registry: f.registry, listedAt: f.t.ports.clock.wall() + 1, readings: new Map() });
    expect(r).toMatchObject({ live: true, minted: 1 });
    expect(all(f.s)).toEqual([{ identity: COORD, n: 1, state: 'carded', shadowState: null, outcome: null, startId: 1 }]);
  });

  it('a compact start mints nothing; a fork start mints nothing and leaves the live generation', () => {
    const f = fixture();
    f.start('startup', U1);
    f.pass();
    f.start('compact', U1);
    expect(f.pass()).toMatchObject({ read: 1, minted: 0, skipped: { compact: 1 } });
    // A fork's conversation is a new uuid in the same pane; even with the registry following it, it is not this
    // identity's next life.
    setRegistry(f, U3);
    f.start('fork', U3);
    expect(f.pass()).toMatchObject({ read: 1, minted: 0, skipped: { fork: 1 } });
    expect(live(f.s).map((g) => g.n)).toEqual([1]);
    expect(f.s.generationsCursor(GENERATIONS_LANE)).toEqual({ ok: true, lastStartId: 3 });
  });

  it('a worker\'s start mints nothing', () => {
    const f = fixture();
    f.s.db.prepare("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt, sessionId) VALUES ('prog-a', 1, 2, 'project-a', 'working', ?, 1, ?)").run(COORD, WORKER);
    const runId = (f.s.db.prepare('SELECT max(id) AS id FROM runs').get() as { id: number }).id;
    f.registry.push({ id: WORKER, uuid: U3, lane: 'lane-a', child: { kind: 'child', runId } as ChildMark });
    f.start('startup', U3, undefined, WORKER);
    expect(f.pass()).toMatchObject({ minted: 0, skipped: { 'not-long-lived': 1 } });
    expect(all(f.s)).toEqual([]);
  });

  it('a child\'s run row that throws when read is unmeasured for that one reading: the start is judged, the cursor moves and the due is recorded (review 2014 F1)', () => {
    const f = fixture();
    f.start('startup', U1);
    f.pass();
    f.s.db.prepare("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt, sessionId, prLineage) VALUES ('prog-a', 1, 2, 'project-a', 'working', 'lane-b-other', 1, ?, '{not json')").run(WORKER);
    const runId = (f.s.db.prepare('SELECT max(id) AS id FROM runs').get() as { id: number }).id;
    f.registry.push({ id: WORKER, uuid: U3, lane: 'lane-a', child: { kind: 'child', runId } as ChildMark });
    f.start('startup', U3, undefined, WORKER);
    f.s.db.exec('UPDATE continuity_generations SET blind = NULL');
    expect(f.pass()).toMatchObject({ read: 1, minted: 0, skipped: { undecided: 1 } });
    expect(f.s.generationsCursor(GENERATIONS_LANE)).toEqual({ ok: true, lastStartId: 2 });
    expect(live(f.s)[0]!.blind).not.toBeNull();
  });

  it('an unmeasured claim read (undecided coordinator-or-plain) mints nothing, and is counted and logged once', () => {
    const f = fixture();
    f.s.openCoordinatorIds = () => { throw new Error('runs unreadable'); };
    f.start('startup', U1);
    expect(f.pass()).toMatchObject({ minted: 0, skipped: { undecided: 1 } });
    expect(f.logs.filter((l) => l.includes('1 undecided'))).toHaveLength(1);
  });

  it('a coordinator\'s startup before its first run opens is not lost: once it reads as a coordinator, n=1 mints from it (review 2003 F2)', () => {
    const f = fixture();
    closeRuns(f.s);
    f.start('startup', U1);
    expect(f.pass()).toMatchObject({ minted: 0, skipped: { undecided: 1 } });
    expect(f.s.generationsCursor(GENERATIONS_LANE)).toEqual({ ok: true, lastStartId: 1 });
    f.t.advance(30_000);
    // Still no run: nothing more mints, and nothing is read again.
    expect(f.pass()).toMatchObject({ read: 0, minted: 0, firstMinted: 0 });
    f.s.db.prepare("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) VALUES ('prog-a', 2, 2, 'project-a', 'working', ?, 2)").run(COORD);
    f.t.advance(30_000);
    expect(f.pass()).toMatchObject({ read: 0, minted: 1, firstMinted: 1 });
    expect(all(f.s)).toEqual([{ identity: COORD, n: 1, state: 'active', shadowState: 'carded', outcome: null, startId: 1 }]);
    // Minted once: the next pass finds the generation and mints nothing.
    expect(f.pass()).toMatchObject({ minted: 0, firstMinted: 0 });
  });

  it('the first mint takes the newest start that mints, past a newer compaction, and records its account', () => {
    const f = fixture();
    closeRuns(f.s);
    f.start('startup', U1);
    f.t.advance(1_000);
    setRegistry(f, U2);
    f.start('clear', U2);
    f.t.advance(1_000);
    f.start('compact', U2);
    f.pass();
    f.s.db.prepare("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) VALUES ('prog-a', 2, 2, 'project-a', 'working', ?, 2)").run(COORD);
    expect(f.pass()).toMatchObject({ firstMinted: 1 });
    expect(live(f.s).map((g) => [g.n, g.startId, g.lane])).toEqual([[1, 2, 'lane-a']]);
  });

  it('the first mint stops at a held start rather than falling through to an older conversation, and mints from it once it reads (review 2006 R2)', () => {
    const f = fixture();
    closeRuns(f.s);
    f.start('startup', U1);
    f.t.advance(1_000);
    setRegistry(f, U2);
    f.start('clear', U2);
    f.pass();
    // The run opens on a pass whose registry uuid could not be read: the clear is held, and the older startup does not mint.
    f.s.db.prepare("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) VALUES ('prog-a', 2, 2, 'project-a', 'working', ?, 2)").run(COORD);
    f.registry[0] = { ...f.registry[0]!, uuid: null };
    expect(f.pass()).toMatchObject({ minted: 0, firstMinted: 0, held: 1 });
    expect(all(f.s)).toEqual([]);
    f.t.advance(30_000);
    setRegistry(f, U2);
    expect(f.pass()).toMatchObject({ firstMinted: 1 });
    expect(live(f.s).map((g) => [g.n, g.startId])).toEqual([[1, 2]]);
  });

  it('two read-held starts above a minting startup do not take turns being held for ever: the walk reaches the startup (review 2014 F2)', () => {
    const f = fixture();
    closeRuns(f.s);
    f.start('startup', U1);
    setRegistry(f, U2);
    f.start('clear', U2);
    f.start('resume', U2);
    // No run: all three are skipped undecided, and the cursor passes them.
    expect(f.pass()).toMatchObject({ skipped: { undecided: 3 } });
    f.t.advance(START_RETRY_MS + 30_000);
    f.s.db.prepare("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) VALUES ('prog-a', 2, 2, 'project-a', 'working', ?, 2)").run(COORD);
    f.registry[0] = { ...f.registry[0]!, uuid: null };
    // Each aged start is held once by this process, then passed; the startup needs no uuid and mints.
    expect(f.pass()).toMatchObject({ firstMinted: 0, held: 1 });
    f.t.advance(30_000);
    expect(f.pass()).toMatchObject({ firstMinted: 0, held: 1 });
    f.t.advance(30_000);
    expect(f.pass()).toMatchObject({ firstMinted: 1, held: 0 });
    expect(live(f.s).map((g) => [g.n, g.startId, g.lane])).toEqual([[1, 1, null]]);
  });

  it('a start whose registry uuid could not be read is held, the cursor stays at it, and a later pass mints it (review 2003 F2)', () => {
    const f = fixture();
    f.start('startup', U1);
    f.pass();
    f.t.advance(30_000);
    f.registry[0] = { ...f.registry[0]!, uuid: null };
    f.start('clear', U2);
    expect(f.pass()).toMatchObject({ read: 1, minted: 0, held: 1, skipped: { 'uuid-unmeasured': 0 } });
    expect(f.s.generationsCursor(GENERATIONS_LANE)).toEqual({ ok: true, lastStartId: 1 });
    expect(f.logs.some((l) => l.includes('1 held for a later pass'))).toBe(true);
    f.t.advance(30_000);
    setRegistry(f, U2);
    expect(f.pass()).toMatchObject({ read: 1, minted: 1, held: 0 });
    expect(live(f.s).map((g) => [g.n, g.startId])).toEqual([[2, 2]]);
    expect(f.s.generationsCursor(GENERATIONS_LANE)).toEqual({ ok: true, lastStartId: 2 });
  });

  it('a start of a row the registry did not list this pass is held, and minted once the row reads', () => {
    const f = fixture();
    const row = f.registry.pop()!;
    f.start('startup', U1);
    expect(f.pass()).toMatchObject({ minted: 0, held: 1, skipped: { unregistered: 0 } });
    expect(f.s.generationsCursor(GENERATIONS_LANE)).toEqual({ ok: true, lastStartId: 0 });
    f.registry.push(row);
    expect(f.pass()).toMatchObject({ minted: 1, held: 0 });
  });

  it('the hold is bounded: past START_RETRY_MS the start is skipped for good, counted and logged, and the starts behind it go on', () => {
    const f = fixture();
    f.start('startup', U1);
    f.pass();
    f.registry[0] = { ...f.registry[0]!, uuid: null };
    f.start('clear', U2);
    const other = 'lane-b-project-b';
    f.registry.push({ id: other, uuid: U3, lane: 'lane-b', child: { kind: 'none' } });
    f.s.db.prepare("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) VALUES ('prog-a', 1, 2, 'project-b', 'working', ?, 1)").run(other);
    f.t.advance(1_000);
    f.start('startup', U3, undefined, other);
    // Held: the other session's start waits behind it.
    expect(f.pass()).toMatchObject({ minted: 0, held: 2 });
    expect(live(f.s).map((g) => g.identity)).toEqual([COORD]);
    f.t.advance(START_RETRY_MS - 31_000);
    expect(f.pass()).toMatchObject({ minted: 0, held: 2 });
    f.t.advance(30_000);
    // Past the bound: skipped and counted, and the other session's start mints in the same pass.
    expect(f.pass()).toMatchObject({ minted: 1, held: 0, skipped: { 'uuid-unmeasured': 1 } });
    expect(f.logs.some((l) => l.includes('1 uuid-unmeasured'))).toBe(true);
    expect(live(f.s).map((g) => [g.identity, g.n])).toEqual([[COORD, 1], [other, 1]]);
    expect(f.s.generationsCursor(GENERATIONS_LANE)).toEqual({ ok: true, lastStartId: 3 });
  });

  it('a start another start\'s hold keeps waiting is judged once it has itself waited out the bound (review 2006 R8)', () => {
    const f = fixture();
    const t0 = f.t.ports.clock.wall();
    // Two rows the registry does not list (each a read's hold), and the coordinator's own startup between them.
    f.start('startup', U3, t0, 'lane-x-gone-1');
    f.t.advance(10_000);
    f.start('startup', U1, t0 + 10_000);
    expect(f.pass()).toMatchObject({ minted: 0, held: 2 });
    f.t.advance(130_000);
    // A late resend of the second gone row, reported before the coordinator's start.
    f.start('startup', U3, t0 + 5_000, 'lane-x-gone-2');
    f.t.advance(10_000);
    // The first hold is past its bound and skipped; the second now heads the batch, and the coordinator's start waits.
    expect(f.pass()).toMatchObject({ minted: 0, held: 2, skipped: { unregistered: 1 } });
    f.t.advance(10_000);
    // Its own receipt is now START_RETRY_MS old: it is judged past the standing hold.
    expect(f.pass()).toMatchObject({ minted: 1, held: 1 });
    expect(live(f.s).map((g) => [g.identity, g.startId])).toEqual([[COORD, 2]]);
    expect(f.s.generationsCursor(GENERATIONS_LANE)).toEqual({ ok: true, lastStartId: 2 });
  });

  it('a clock that steps back behind a held start\'s receipt keeps it held (review 2006 R3)', () => {
    const f = fixture();
    f.start('startup', U1);
    f.pass();
    f.t.advance(30_000);
    f.registry[0] = { ...f.registry[0]!, uuid: null };
    f.start('clear', U2);
    const receivedAt = f.t.ports.clock.wall();
    f.pass();
    // The tick listed the registry before the step, so only the clamp can keep the start held.
    f.t.stepWall(-60_000);
    expect(f.pass(undefined, 'p1', receivedAt + 1)).toMatchObject({ held: 1, skipped: { 'uuid-unmeasured': 0 } });
  });

  it('a start past the bound is retried once by a new process before it is skipped (review 2006 R3: a restart or a slow tick)', () => {
    const f = fixture();
    f.start('startup', U1);
    f.pass();
    f.registry[0] = { ...f.registry[0]!, uuid: null };
    f.start('clear', U2);
    f.pass(undefined, 'p1');
    f.t.restart(START_RETRY_MS + 60_000);
    // A new process: the start is past its bound, but this process has not held it yet.
    expect(f.pass(undefined, 'p2')).toMatchObject({ held: 1, skipped: { 'uuid-unmeasured': 0 } });
    f.t.advance(30_000);
    expect(f.pass(undefined, 'p2')).toMatchObject({ held: 0, skipped: { 'uuid-unmeasured': 1 } });
    // A slow tick in one process: the first pass to see a start already past its bound holds it once too.
    f.start('clear', U3);
    f.t.advance(START_RETRY_MS + 1_000);
    expect(f.pass(undefined, 'p2')).toMatchObject({ held: 1 });
    f.t.advance(30_000);
    expect(f.pass(undefined, 'p2')).toMatchObject({ held: 0, skipped: { 'uuid-unmeasured': 1 } });
  });

  it('a swap between two starts in one batch: only the newest start\'s outcome and account are trusted (review 2003 F4)', () => {
    const f = fixture();
    f.start('startup', U1);
    f.pass();
    f.t.advance(30_000);
    // Two starts land before the next pass: a clear on lane-a, then the swap's resume on lane-b. The registry, read at
    // the pass, already says lane-b and the swap's conversation.
    f.registry[0] = { ...f.registry[0]!, uuid: U2, lane: 'lane-b' };
    f.start('clear', U2, undefined, COORD, 'inc-1');
    f.t.advance(1_000);
    f.start('resume', U2, undefined, COORD, 'inc-2');
    expect(f.pass()).toMatchObject({ minted: 2 });
    const rows = f.s.db.prepare('SELECT n, state, outcome, lane FROM continuity_generations ORDER BY n').all();
    expect(rows).toEqual([
      // The older start's outcome and account are the registry's at the pass, not at the start: unmeasured, none.
      { n: 1, state: 'ended', outcome: 'unmeasured', lane: 'lane-a' },
      { n: 2, state: 'ended', outcome: 'unmeasured', lane: null },
      { n: 3, state: 'active', outcome: null, lane: 'lane-b' },
    ]);
  });

  it('logs every non-zero skip count once a pass, and a generations read that failed (review 2003 F5)', () => {
    const f = fixture();
    f.start('startup', U1);
    f.pass();
    f.start('compact', U1);
    f.start('resume', U3);
    f.pass();
    expect(f.logs.filter((l) => l.includes('starts this pass'))).toEqual(['ccrc-server: generations: starts this pass: 1 compact, 1 foreign-uuid']);
    f.s.db.exec("UPDATE continuity_generations SET walkClass = 'newer-class'");
    f.start('clear', U1);
    expect(f.pass()).toMatchObject({ unread: 'generations', minted: 0 });
    expect(f.logs.some((l) => l.includes('the generations could not be read, so no observed time advances'))).toBe(true);
    expect(f.logs.some((l) => l.includes('the generations could not be read, so no due is recorded'))).toBe(true);
  });

  it('a read that fails after the batch ran says so: the batch\'s mint stands (review 2006 N3)', () => {
    const f = fixture();
    f.start('startup', U1);
    const real = f.s.generationsCursor.bind(f.s);
    let reads = 0;
    // The cursor reads once for the batch, then fails for the first mint's read.
    f.s.generationsCursor = (lane) => { reads += 1; return reads === 1 ? real(lane) : { ok: false, detail: 'injected' }; };
    expect(f.pass()).toMatchObject({ minted: 1, unread: 'cursor' });
    expect(f.logs).toContain('ccrc-server: generations: the cursor could not be read, so the batch ran, and no coordinator\'s first generation is minted this pass: injected');
    expect(f.logs.some((l) => l.includes('no start is judged'))).toBe(false);
  });

  it('a clear accepted after the registry was listed is held a pass, not skipped as foreign, and mints on the next (review 2006 R1)', () => {
    const f = fixture();
    f.start('startup', U1);
    f.pass();
    f.t.advance(30_000);
    // The tick lists the registry (still the old conversation), then a clear lands before the pass runs.
    const listedAt = f.t.ports.clock.wall();
    f.t.advance(2_000);
    f.start('clear', U2);
    expect(f.pass(undefined, 'p1', listedAt)).toMatchObject({ minted: 0, held: 1, skipped: { 'foreign-uuid': 0 } });
    expect(f.s.generationsCursor(GENERATIONS_LANE)).toEqual({ ok: true, lastStartId: 1 });
    f.t.advance(28_000);
    setRegistry(f, U2);
    expect(f.pass()).toMatchObject({ minted: 1, held: 0 });
    expect(all(f.s).map((r) => [r.n, r.state, r.outcome, r.startId])).toEqual([[1, 'ended', 'cleared', 1], [2, 'active', null, 2]]);
  });

  it('a nested process\'s resume (a conversation the registry does not name) mints nothing', () => {
    const f = fixture();
    f.start('startup', U1);
    f.pass();
    f.start('resume', U3);
    expect(f.pass()).toMatchObject({ minted: 0, skipped: { 'foreign-uuid': 1 } });
    expect(live(f.s).map((g) => g.n)).toEqual([1]);
  });

  it('a late-landed older clear never mints or ends after a newer start (reportedAt order, review 1949 G3)', () => {
    const f = fixture();
    const t0 = f.t.ports.clock.wall();
    f.start('startup', U1, t0 + 5_000);
    f.pass();
    f.start('clear', U1, t0 + 1_000);
    expect(f.pass()).toMatchObject({ minted: 0, skipped: { late: 1 } });
    expect(all(f.s).map((r) => [r.n, r.state])).toEqual([[1, 'active']]);
  });

  it('a batch is taken in reportedAt order, whatever order it landed in', () => {
    const f = fixture();
    const t0 = f.t.ports.clock.wall();
    setRegistry(f, U2);
    f.start('clear', U2, t0 + 9_000);
    f.start('startup', U1, t0 + 1_000);
    f.pass();
    expect(all(f.s).map((r) => [r.n, r.startId, r.state])).toEqual([[1, 2, 'ended'], [2, 1, 'active']]);
  });

  it('a first generation may lack its startup: the first start the lane has mints n=1 (review 1975)', () => {
    const f = fixture();
    f.start('clear', U1);
    expect(f.pass()).toMatchObject({ minted: 1 });
    expect(live(f.s).map((g) => [g.n, g.outcome])).toEqual([[1, null]]);
  });

  it('a restart of the lane re-reads from the cursor and mints nothing twice', () => {
    const f = fixture();
    f.start('startup', U1);
    f.pass(undefined, 'p1');
    f.t.restart(5_000);
    expect(f.pass(undefined, 'p2')).toMatchObject({ read: 0, minted: 0 });
    // A cursor lost with nothing else: the start is read again and answers superseded, never a second row.
    f.s.db.exec('DELETE FROM continuity_cursor');
    expect(f.pass(undefined, 'p2')).toMatchObject({ read: 1, minted: 0, superseded: 1 });
    expect(all(f.s)).toHaveLength(1);
  });

  it('201 starts take two passes', () => {
    const f = fixture();
    for (let i = 0; i < 201; i += 1) f.start('compact', U1, FAKE_T0 + i);
    expect(f.pass()).toMatchObject({ read: 200 });
    expect(f.s.generationsCursor(GENERATIONS_LANE)).toEqual({ ok: true, lastStartId: 200 });
    expect(f.pass()).toMatchObject({ read: 1 });
    expect(f.s.generationsCursor(GENERATIONS_LANE)).toEqual({ ok: true, lastStartId: 201 });
  });

  it('a registry that could not be listed judges no start and leaves the cursor', () => {
    const f = fixture();
    f.start('startup', U1);
    const r = generationsPass({ coord: f.s, clock: f.t.ports.clock, entropy: f.t.ports.entropy, proc: 'p1', log: () => {}, retried: new Set(), emptyTries: new Map() },
      { registry: null, listedAt: f.t.ports.clock.wall() + 1, readings: new Map() });
    expect(r).toMatchObject({ unread: 'registry', minted: 0 });
    expect(f.s.generationsCursor(GENERATIONS_LANE)).toEqual({ ok: true, lastStartId: 0 });
  });
});

describe('the accumulator (Task 2, Step 4b)', () => {
  it('n=2 at its mint carries n=1\'s accumulator; a 90 s pause advances by the 60 s cap with one step gap; a restart advances nothing with one process gap', () => {
    const f = fixture();
    f.start('startup', U1);
    f.pass();
    f.t.advance(30_000);
    f.pass();
    expect(live(f.s)[0]!.observed.ms).toBe(30_000);
    f.t.advance(90_000);
    const paused = f.pass();
    expect(paused.gaps).toEqual([{ identity: COORD, kind: 'step', deltaMs: 90_000 }]);
    expect(live(f.s)[0]!.observed.ms).toBe(90_000);
    setRegistry(f, U2);
    f.start('clear', U2);
    f.pass();
    const [n2] = live(f.s);
    expect(n2).toMatchObject({ n: 2, mintedObservedMs: 90_000, observed: { ms: 90_000 } });
    f.t.restart(10_000);
    const after = f.pass(undefined, 'p2');
    expect(after.gaps.map((g) => g.kind)).toEqual(['process']);
    expect(live(f.s)[0]!.observed).toMatchObject({ ms: 90_000, proc: 'p2' });
  });

  it('the soft renewal\'s times are on the generation\'s own frame: the hold-off stored absolute is taken back to the generation\'s age (review 1902 F4)', () => {
    const f = fixture();
    f.start('startup', U1);
    f.pass();
    f.t.advance(30_000);
    setRegistry(f, U2);
    f.start('clear', U2);
    f.pass();
    f.t.advance(30_000);
    f.pass();
    const g = live(f.s)[0]!;
    expect(g.mintedObservedMs).toBe(30_000);
    f.s.setHoldOff(g.id, { term: g.term, n: g.n, state: g.state, shadowState: g.shadowState, walk: g.walk });
    const h = live(f.s)[0]!;
    expect(softTimesOf(h)).toEqual({ generationAgeObservedMs: 30_000, holdOffUntilObservedMs: 30_000 + HOLD_OFF_MS, dueSinceObservedMs: 0 });
  });
});

/** A coordinator's snapshot as the card door stores it: one open run and one open item, so a start round asks the run
 *  question and the abstention question (a short round, measured). */
const SNAPSHOT_FACTS: CardFacts = {
  sessionId: COORD, role: 'coordinator', roleWhy: 'it claims a run', at: 0,
  runs: { kind: 'read', value: [{ id: 41, programme: 'prog-a', wave: 1, waveOf: 2, state: 'working', planPath: null, kind: 'work' }] },
  ledger: { kind: 'read', value: [] }, claims: { kind: 'read', value: [] }, intent: { kind: 'read', value: true },
  itemsRaised: { kind: 'read', value: [{ id: 7, programme: 'prog-a', kind: 'decide', state: 'open', neededBy: 'soon', at: 1, text: 'i',
    everTicked: false, held: false }] },
  mailOutstanding: { kind: 'read', value: [] }, mailMore: false, notes: { kind: 'read', value: [] }, checkpoint: { kind: 'read', value: null },
  history: { kind: 'read', value: { verb: 'ccrc history describe', node: null } }, timers: { kind: 'read', value: [] },
};
const SNAPSHOT = snapshotFactsJson(SNAPSHOT_FACTS);
/** A usage reading; `ts` is the statusline's clock in epoch SECONDS (1 by default: older than any compaction line). */
const usage = (ctxTokens: number, ctxWindow: number, stale = false, ts = 1): UsageRead => ({ kind: 'reading', uuid: null, usage: {
  ts, model: 'claude-opus-5-5', class: null, effort: null, ctxPct: null, ctxTokens, ctxWindow, cost: null, cacheExpiresAt: null, stale,
} });
const lines = (n: number, at: number): CompactionsRead => ({ kind: 'lines', skipped: 0, eventsAbsent: false,
  lines: Array.from({ length: n }, (_, i) => ({ at: at + i * 3_600_000, trigger: 'auto' as const, phase: 'pre' as const, transcript: null, scope: 'main' as const })) });
const readings = (u: UsageRead, c: CompactionsRead = { kind: 'absent' }): GenReadings => ({
  usage: u, compactions: c, turn: { ok: false, reason: 'absent' } as never, behind: { kind: 'measured', value: false },
});

describe('the pass records renewalDue on every generation at rest (Task 3)', () => {
  /** A coordinator minted in shadow: `state` active, its shadow walk standing at `carded` (nothing steps it in W1a). */
  function atRest(): { f: Fixture; id: number } {
    const f = fixture();
    f.start('startup', U1);
    f.pass();
    return { f, id: live(f.s)[0]!.id };
  }

  it('a coordinator at 260k tokens on a 1M window is due hard-cap', () => {
    const { f, id } = atRest();
    f.pass(new Map([[id, readings(usage(260_000, 1_000_000))]]));
    expect(live(f.s)[0]).toMatchObject({ dueWhy: 'hard-cap', dueClass: 'hard', dueSince: f.t.ports.clock.wall() });
  });

  it('the same with a stale sidecar is not due, and names hard-cap in blind', () => {
    const { f, id } = atRest();
    f.pass(new Map([[id, readings(usage(260_000, 1_000_000, true))]]));
    const g = live(f.s)[0]!;
    expect(g.dueWhy).toBeNull();
    expect(g.blind).toContain('hard-cap');
  });

  it('two compactions since the generation\'s start make it due two-compactions', () => {
    const { f, id } = atRest();
    const start = live(f.s)[0]!.startReportedAt;
    f.pass(new Map([[id, readings(usage(50_000, 1_000_000), lines(2, start + 1))]]));
    expect(live(f.s)[0]).toMatchObject({ dueWhy: 'two-compactions', dueClass: 'soft' });
  });

  it('a compaction before the generation\'s start does not count', () => {
    const { f, id } = atRest();
    const start = live(f.s)[0]!.startReportedAt;
    f.pass(new Map([[id, readings(usage(50_000, 1_000_000), lines(2, start - 3_600_001))]]));
    expect(live(f.s)[0]!.dueWhy).toBeNull();
  });

  it('a due generation that falls back under the threshold is cleared', () => {
    const { f, id } = atRest();
    f.pass(new Map([[id, readings(usage(260_000, 1_000_000))]]));
    expect(live(f.s)[0]!.dueWhy).toBe('hard-cap');
    f.t.advance(30_000);
    f.pass(new Map([[id, readings(usage(40_000, 1_000_000))]]));
    expect(live(f.s)[0]).toMatchObject({ dueWhy: null, dueSince: null, dueSinceObservedMs: null });
  });

  it('the inputs W1a cannot read are blind, and never fire', () => {
    const { f, id } = atRest();
    f.pass(new Map([[id, readings(usage(40_000, 1_000_000))]]));
    // `probe-failed` is read since the probes piece: no compaction round failed, so it is measured false, never blind.
    expect(live(f.s)[0]!.blind).toEqual(['not-local', 'compaction-refused']);
  });

  it('the wave boundary: the coordinator\'s newest work run open and the one before closed, past a quarter of the cap', () => {
    const { f, id } = atRest();
    f.s.db.prepare("UPDATE runs SET state = 'done' WHERE claimedBy = ?").run(COORD);
    f.s.db.prepare("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) VALUES ('prog-a', 2, 2, 'project-a', 'working', ?, 2)").run(COORD);
    f.pass(new Map([[id, readings(usage(70_000, 1_000_000))]]));
    expect(live(f.s)[0]).toMatchObject({ dueWhy: 'wave-boundary', dueClass: 'soft' });
  });

  it('a claimed run that cannot be read marks the wave reading unmeasured, and the pass and its log go on (review 2006 R4)', () => {
    const { f, id } = atRest();
    f.s.db.prepare("UPDATE runs SET prLineage = '{not json' WHERE claimedBy = ?").run(COORD);
    f.start('compact', U1);
    // Past the wave row's context floor, so only the wave reading decides it.
    expect(() => f.pass(new Map([[id, readings(usage(70_000, 1_000_000))]]))).not.toThrow();
    expect(live(f.s)[0]!.blind).toContain('wave-boundary');
    expect(f.logs.some((l) => l.includes('1 compact'))).toBe(true);
  });

  it('the wave boundary reads only the work runs the coordinator claims: a newer run it works for another, and its review run, are not waves (review 2003 F11)', () => {
    const { f, id } = atRest();
    f.s.db.prepare("UPDATE runs SET state = 'done' WHERE claimedBy = ?").run(COORD);
    const wave2 = f.s.db.prepare("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) VALUES ('prog-a', 2, 2, 'project-a', 'working', ?, 2)").run(COORD);
    f.s.db.exec("INSERT INTO programs (slug, title, createdAt, state) VALUES ('prog-b', 'P', 1, 'active')");
    f.s.db.prepare("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, sessionId, openedAt) VALUES ('prog-b', 1, 2, 'project-b', 'working', 'lane-b-other', ?, 3)").run(COORD);
    f.s.db.prepare("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt, kind, reviews) VALUES ('prog-a', 2, 2, 'project-a', 'working', ?, 4, 'review', ?)").run(COORD, Number(wave2.lastInsertRowid));
    f.pass(new Map([[id, readings(usage(70_000, 1_000_000))]]));
    expect(live(f.s)[0]).toMatchObject({ dueWhy: 'wave-boundary', dueClass: 'soft' });
  });

  it('in shadow a generation on a walk is judged: its `state` is active, whatever the walk holds (review 2003 F1)', () => {
    const f = fixture();
    f.start('startup', U1);
    f.pass();
    const g = live(f.s)[0]!;
    expect(g).toMatchObject({ state: 'active', shadowState: 'carded', walk: 'shadow' });
    expect(f.pass(new Map([[g.id, readings(usage(260_000, 1_000_000))]]))).toMatchObject({ due: 1 });
    // The due record is written; the walk's own column still holds its would-be state.
    expect(live(f.s)[0]).toMatchObject({ dueWhy: 'hard-cap', shadowState: 'carded', walk: 'shadow' });
  });

  it('a plain shadow mint followed by passes writes dueSince, dueWhy and blind', () => {
    const f = fixture();
    f.start('startup', U1);
    f.pass();
    const id = live(f.s)[0]!.id;
    f.t.advance(30_000);
    f.pass(new Map([[id, readings(usage(40_000, 1_000_000))]]));
    expect(live(f.s)[0]).toMatchObject({ dueWhy: null, blind: ['not-local', 'compaction-refused'] });
    f.t.advance(30_000);
    const at = f.t.ports.clock.wall();
    f.pass(new Map([[id, readings(usage(260_000, 1_000_000))]]));
    expect(live(f.s)[0]).toMatchObject({ dueWhy: 'hard-cap', dueSince: at, dueSinceObservedMs: 60_000 });
    f.t.advance(30_000);
    f.pass(new Map([[id, readings(usage(260_000, 1_000_000))]]));
    expect(live(f.s)[0]).toMatchObject({ dueSince: at, dueSinceObservedMs: 60_000 });
  });

  it('live, a generation on a live walk (`state` carded) is not judged', () => {
    const f = fixture();
    f.s.setLaneArm(CONTINUITY_LANE, 'live', 1);
    f.start('startup', U1);
    f.pass();
    const g = live(f.s)[0]!;
    expect(f.pass(new Map([[g.id, readings(usage(260_000, 1_000_000))]]))).toMatchObject({ due: 0 });
    expect(live(f.s)[0]).toMatchObject({ state: 'carded', dueWhy: null, blind: null });
  });

  it('live, a walk begun in shadow is cleared, and the generation is then judged', () => {
    const f = fixture();
    f.start('startup', U1);
    f.pass();
    f.s.setLaneArm(CONTINUITY_LANE, 'live', 1);
    const id = live(f.s)[0]!.id;
    expect(f.pass(new Map([[id, readings(usage(260_000, 1_000_000))]]))).toMatchObject({ cleared: 1, due: 1 });
    expect(live(f.s)[0]).toMatchObject({ state: 'active', shadowState: null, walk: null, dueWhy: 'hard-cap' });
  });
});

describe('the card read (the card piece, PR B, Task 5)', () => {
  const HASH_A = 'a'.repeat(64);
  const HASH_B = 'b'.repeat(64);
  /** The card door's two writes: a snapshot served with `hash`, and (unless `served` only) a full read of it by `uuid`. */
  const serve = (f: Fixture, snap: string, hash: string): void => {
    const r = f.s.insertSnapshot({ id: snap, sessionId: COORD, at: f.t.ports.clock.wall(), facts: SNAPSHOT, hash });
    if (!r.ok) throw new Error('snapshot not stored');
  };
  const readCard = (f: Fixture, snap: string, hash: string, uuid = U1): void => {
    serve(f, snap, hash);
    if (!f.s.insertCardRead({ sessionId: COORD, uuid, snapshotId: snap, hash, pages: 1, at: f.t.ports.clock.wall() }).ok) throw new Error('read not recorded');
  };
  const card = (s: CoordStore): Record<string, unknown>[] =>
    s.db.prepare('SELECT n, state, shadowState, cardHash, snapshotId FROM continuity_generations ORDER BY id').all() as Record<string, unknown>[];

  it('live: a matching read moves a carded generation to probing and records its card hash and snapshot', () => {
    const f = fixture();
    f.s.setLaneArm(CONTINUITY_LANE, 'live', 1);
    f.start('startup', U1);
    f.pass();
    readCard(f, 'snap-1', HASH_A);
    expect(f.pass()).toMatchObject({ cardRead: 1, unread: null });
    expect(card(f.s)).toEqual([{ n: 1, state: 'probing', shadowState: null, cardHash: HASH_A, snapshotId: 'snap-1' }]);
    expect(f.pass()).toMatchObject({ cardRead: 0 });
  });

  it('a refused live card step leaves the card and generation untouched and is logged through the store delegate', () => {
    const f = fixture();
    f.s.setLaneArm(CONTINUITY_LANE, 'live', 1);
    f.start('startup', U1);
    f.pass();
    const id = live(f.s)[0]!.id;
    const before = card(f.s);
    readCard(f, 'snap-1', HASH_A);
    f.s.db.exec(`CREATE TEMP TRIGGER refuse_card_step BEFORE INSERT ON overlord_sequence
      WHEN NEW.kind = 'generation' AND NEW.state = 'probing' BEGIN SELECT RAISE(ABORT, 'fixture refuses the step'); END`);
    try {
      expect(f.pass()).toMatchObject({ cardRead: 0, unread: null });
      expect(card(f.s)).toEqual(before);
      expect(f.logs.filter((l) => l.includes('the sequence refused its line'))).toEqual([
        `ccrc-server: generations: generation ${id}'s step was not written: the sequence refused its line`,
      ]);
    } finally {
      f.s.db.exec('DROP TRIGGER refuse_card_step');
    }
    expect(f.pass()).toMatchObject({ cardRead: 1, unread: null });
    expect(card(f.s)).toEqual([{ n: 1, state: 'probing', shadowState: null, cardHash: HASH_A, snapshotId: 'snap-1' }]);
  });

  it('shadow: the effective state is the shadow column, so the read moves `shadowState` and `state` stays active (review 1902 F6)', () => {
    const f = fixture();
    f.start('startup', U1);
    f.pass();
    expect(card(f.s)).toEqual([{ n: 1, state: 'active', shadowState: 'carded', cardHash: null, snapshotId: null }]);
    readCard(f, 'snap-1', HASH_A);
    expect(f.pass()).toMatchObject({ live: false, cardRead: 1 });
    expect(card(f.s)).toEqual([{ n: 1, state: 'active', shadowState: 'probing', cardHash: HASH_A, snapshotId: 'snap-1' }]);
  });

  it('a read made before the pass that minted the generation still counts: it is matched by the start\'s conversation', () => {
    const f = fixture();
    f.start('startup', U1);
    readCard(f, 'snap-1', HASH_A);
    expect(f.pass()).toMatchObject({ minted: 1, cardRead: 1 });
    expect(card(f.s)[0]).toMatchObject({ shadowState: 'probing', cardHash: HASH_A });
  });

  it('a read of an older hash does not move it, and the read of the current one then does', () => {
    const f = fixture();
    f.start('startup', U1);
    f.pass();
    readCard(f, 'snap-1', HASH_A);
    serve(f, 'snap-2', HASH_B);
    expect(f.pass()).toMatchObject({ cardRead: 0 });
    expect(card(f.s)).toEqual([{ n: 1, state: 'active', shadowState: 'carded', cardHash: null, snapshotId: null }]);
    readCard(f, 'snap-2', HASH_B);
    expect(f.pass()).toMatchObject({ cardRead: 1 });
    expect(card(f.s)[0]).toMatchObject({ shadowState: 'probing', cardHash: HASH_B, snapshotId: 'snap-2' });
  });

  it("another conversation's read, or none, leaves a carded generation where it is", () => {
    const f = fixture();
    f.start('startup', U1);
    f.pass();
    expect(f.pass()).toMatchObject({ cardRead: 0 });
    readCard(f, 'snap-1', HASH_A, U2);
    expect(f.pass()).toMatchObject({ cardRead: 0 });
    expect(card(f.s)[0]).toMatchObject({ shadowState: 'carded', cardHash: null });
  });

  it('a generation at rest is never fed a card read', () => {
    const f = fixture();
    f.s.setLaneArm(CONTINUITY_LANE, 'live', 1);
    f.start('startup', U1);
    f.pass();
    f.s.db.prepare("UPDATE continuity_generations SET state = 'active', walk = NULL, deadlineAt = NULL").run();
    readCard(f, 'snap-1', HASH_A);
    expect(f.pass()).toMatchObject({ cardRead: 0 });
    expect(card(f.s)[0]).toMatchObject({ state: 'active', cardHash: null });
  });

  it('a resumed conversation keeps its uuid, but a read from its previous generation never counts for the new one (review 2023 F3)', () => {
    const f = fixture();
    f.start('startup', U1);
    f.pass();
    readCard(f, 'snap-1', HASH_A);
    expect(f.pass()).toMatchObject({ cardRead: 1 });
    f.t.advance(60_000);
    f.start('resume', U1);
    expect(f.pass()).toMatchObject({ minted: 1, cardRead: 0 });
    expect(f.pass()).toMatchObject({ cardRead: 0 });
    expect(card(f.s).at(-1)).toMatchObject({ n: 2, shadowState: 'carded', cardHash: null });
    // The resumed conversation reads its card now: that read counts.
    readCard(f, 'snap-1', HASH_A);
    expect(f.pass()).toMatchObject({ cardRead: 1 });
    expect(card(f.s).at(-1)).toMatchObject({ n: 2, shadowState: 'probing', cardHash: HASH_A });
  });

  it('the apply loop writes a step that keeps the state and changes the view, and never one that changes nothing (review 2023 F5)', () => {
    const f = fixture();
    f.start('startup', U1);
    f.pass();
    const writes: string[] = [];
    const coord = { stepGeneration: (...a: Parameters<CoordStore['stepGeneration']>) => { writes.push(a[2].state); return f.s.stepGeneration(...a); } };
    const fed = (): FedEvent[] => [{ gen: live(f.s)[0]!, event: { kind: 'nudge-due' }, card: null }];
    expect(applyFedEvents(coord, fed(), false, f.t.ports.clock.wall())).toBe(1);
    expect(f.s.db.prepare('SELECT state, shadowState, renudged FROM continuity_generations').get()).toEqual({ state: 'active', shadowState: 'carded', renudged: 1 });
    expect(applyFedEvents(coord, fed(), false, f.t.ports.clock.wall())).toBe(0);
    expect(writes).toEqual(['carded']);
  });

  it('a card-read read that fails is named, and that generation waits; nothing is written', () => {
    const f = fixture();
    f.start('startup', U1);
    f.pass();
    readCard(f, 'snap-1', HASH_A);
    f.s.cardReadOfStart = () => ({ ok: false, detail: 'continuity_card_reads read failed: disk' });
    expect(f.pass()).toMatchObject({ cardRead: 0, unread: 'card-reads' });
    expect(f.logs.some((l) => l.includes('card-reads could not be read') && l.includes('disk'))).toBe(true);
    expect(card(f.s)[0]).toMatchObject({ shadowState: 'carded', cardHash: null });
  });
});

describe('the gather', () => {
  let journal = (): MeasuredStat => ({ ok: false, reason: 'absent' });
  const ports = (calls: string[], stamp: () => MeasuredStat): GatherPorts => ({
    usage: async () => { calls.push('usage'); return usage(1, 2); },
    eventsStamp: async () => stamp(),
    journalStamp: async () => journal(),
    compactions: async () => { calls.push('compactions'); return { kind: 'absent' }; },
    turnMark: async () => ({ ok: false, reason: 'absent' }) as never,
    processStartedAt: async () => 100,
    release: async () => ({ kind: 'installed', at: 200 }),
  });

  it('reads the compactions again only when the events file changed, and every time when it is absent (review 1927 N2)', async () => {
    const f = fixture();
    f.start('startup', U1);
    f.pass();
    const g = live(f.s)[0]!;
    f.s.clearShadowWalk(g.id, { term: g.term, n: g.n, state: g.state, shadowState: g.shadowState, walk: g.walk }, 0);
    const calls: string[] = [];
    const memo: CompactionsMemo = new Map();
    let st: MeasuredStat = { ok: true, mtimeMs: 1, size: 10 };
    const r1 = await gatherGenerationReadings(f.s, ports(calls, () => st), memo);
    await gatherGenerationReadings(f.s, ports(calls, () => st), memo);
    expect(calls.filter((c) => c === 'compactions')).toHaveLength(1);
    st = { ok: true, mtimeMs: 2, size: 10 };
    await gatherGenerationReadings(f.s, ports(calls, () => st), memo);
    expect(calls.filter((c) => c === 'compactions')).toHaveLength(2);
    st = { ok: false, reason: 'absent' };
    await gatherGenerationReadings(f.s, ports(calls, () => st), memo);
    await gatherGenerationReadings(f.s, ports(calls, () => st), memo);
    expect(calls.filter((c) => c === 'compactions')).toHaveLength(4);
    // A process started before the install completed is behind (the roll's own test).
    expect(r1.get(g.id)!.behind).toEqual({ kind: 'measured', value: true });
  });

  it('reads the compactions again when the journal changed, so a post line that landed is seen without a restart (review 2103 F2)', async () => {
    const f = fixture();
    f.start('startup', U1);
    f.pass();
    const g = live(f.s)[0]!;
    f.s.clearShadowWalk(g.id, { term: g.term, n: g.n, state: g.state, shadowState: g.shadowState, walk: g.walk }, 0);
    const calls: string[] = [];
    const memo: CompactionsMemo = new Map();
    const st = (): MeasuredStat => ({ ok: true, mtimeMs: 1, size: 10 });
    const n = (): number => calls.filter((c) => c === 'compactions').length;
    try {
      journal = () => ({ ok: false, reason: 'absent' });
      await gatherGenerationReadings(f.s, ports(calls, st), memo);
      await gatherGenerationReadings(f.s, ports(calls, st), memo);
      expect(n()).toBe(1);
      journal = () => ({ ok: true, mtimeMs: 5, size: 3 });
      await gatherGenerationReadings(f.s, ports(calls, st), memo);
      await gatherGenerationReadings(f.s, ports(calls, st), memo);
      expect(n()).toBe(2);
      journal = () => ({ ok: true, mtimeMs: 6, size: 9 });
      await gatherGenerationReadings(f.s, ports(calls, st), memo);
      expect(n()).toBe(3);
      // A journal whose stamp could not be read keys nothing: read every pass.
      journal = () => ({ ok: false, reason: 'unreadable' } as MeasuredStat);
      await gatherGenerationReadings(f.s, ports(calls, st), memo);
      await gatherGenerationReadings(f.s, ports(calls, st), memo);
      expect(n()).toBe(5);
    } finally { journal = () => ({ ok: false, reason: 'absent' }); }
  });

  it('reads for a generation on a shadow walk, and nothing for one on a live walk (review 2003 F1)', async () => {
    const f = fixture();
    f.start('startup', U1);
    f.pass();
    const calls: string[] = [];
    expect((await gatherGenerationReadings(f.s, ports(calls, () => ({ ok: false, reason: 'absent' })), new Map())).size).toBe(1);
    const g = fixture();
    g.s.setLaneArm(CONTINUITY_LANE, 'live', 1);
    g.start('startup', U1);
    g.pass();
    const none: string[] = [];
    expect((await gatherGenerationReadings(g.s, ports(none, () => ({ ok: false, reason: 'absent' })), new Map())).size).toBe(0);
    expect(none).toEqual([]);
  });

  it('keeps no failed compactions read: an unreadable read is read again next pass, though the file did not move (review 2003 F14)', async () => {
    const f = fixture();
    f.start('startup', U1);
    f.pass();
    const calls: string[] = [];
    let read: CompactionsRead = { kind: 'unreadable' };
    const p: GatherPorts = { ...ports(calls, () => ({ ok: true, mtimeMs: 1, size: 10 })),
      compactions: async () => { calls.push('compactions'); return read; } };
    const memo: CompactionsMemo = new Map();
    await gatherGenerationReadings(f.s, p, memo);
    await gatherGenerationReadings(f.s, p, memo);
    expect(calls.filter((c) => c === 'compactions')).toHaveLength(2);
    read = { kind: 'absent' };
    await gatherGenerationReadings(f.s, p, memo);
    await gatherGenerationReadings(f.s, p, memo);
    expect(calls.filter((c) => c === 'compactions')).toHaveLength(3);
  });
});

describe('the watcher', () => {
  it('tick() dispatches the lane, and a sweep over the real time ports mints and fails nothing', async () => {
    const home = mkTmp('ccrc-genlane-tick-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const deps = { ...testDeps(home, async () => ({ ran: true, code: 1, stdout: '', stderr: '' })), cfg, coord };
    const w = new FleetWatcher(deps as never, new Bus(), 10_000);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      coord.insertStart({ sessionId: COORD, reportId: 'r-1', uuid: U1, source: 'compact', model: null, rowIncarnation: null, reportedAt: 1, receivedAt: 1 });
      await w.sweepGenerations([], Date.now());
      // A compaction mints nothing and is held by no read (a start whose row the registry did not list would be held once
      // by a new process: review 2006 R3); the pass ran to its end and moved the cursor.
      expect(warn.mock.calls.flat().filter((l) => String(l).includes('generations lane failed'))).toEqual([]);
      expect(coord.generationsCursor(GENERATIONS_LANE)).toEqual({ ok: true, lastStartId: 1 });
      const spy = vi.spyOn(w, 'sweepGenerations').mockResolvedValue(undefined);
      await w.tick();
      await w.tick();
      expect(spy).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      await quietWatcher(w);
      coord.db.close();
    }
  });
});

describe('the probes (the probes piece, PR B, Tasks 5 and 6)', () => {
  const HASH = 'a'.repeat(64);
  let snaps = 0;
  /** Serve and fully read the card of `facts`, now. */
  const readCardOf = (f: Fixture, facts: string = SNAPSHOT): string => {
    snaps += 1;
    const id = `snap-p${snaps}`;
    const hash = `${HASH.slice(0, 60)}${String(1000 + snaps)}`;
    if (!f.s.insertSnapshot({ id, sessionId: COORD, at: f.t.ports.clock.wall(), facts, hash }).ok) throw new Error('snapshot');
    if (!f.s.insertCardRead({ sessionId: COORD, uuid: U1, snapshotId: id, hash, pages: 1, at: f.t.ports.clock.wall() }).ok) throw new Error('read');
    return id;
  };
  const gen = (f: Fixture): GenRow => live(f.s)[0]!;
  const rounds = (s: CoordStore): { roundId: string; kind: string; snapshotId: string | null; depthTokens: number | null; modelClass: string | null; n: number; unmeasured: number }[] =>
    s.db.prepare('SELECT roundId, kind, snapshotId, depthTokens, modelClass, count(*) AS n, MAX(roundUnmeasured) AS unmeasured FROM continuity_probes GROUP BY roundId ORDER BY MIN(id)').all() as never;
  /** Answer the open round of the coordinator's with every question graded `grade`, through the door's writer. */
  const answer = (f: Fixture, grade: 'pass' | 'fail'): void => {
    const open = f.s.openProbeRound(COORD);
    if (!open.ok || open.rows.length === 0) throw new Error('no open round');
    const w = f.s.answerRound(open.rows[0]!.roundId, COORD, open.rows.map((r) => ({ qid: r.qid, answer: 'x', grade })), 'unmeasured', f.t.ports.clock.wall());
    if (!w.ok) throw new Error(w.kind);
  };
  /** A live coordinator whose card read moved it to `probing`, with its first round open. */
  const probing = (): Fixture => {
    const f = fixture();
    f.s.setLaneArm(CONTINUITY_LANE, 'live', 1);
    f.start('startup', U1);
    f.pass();
    readCardOf(f);
    // The pass that records the card read opens the first round too: the probes run after the card read.
    expect(f.pass()).toMatchObject({ cardRead: 1, roundsOpened: 1, unread: null });
    return f;
  };
  const turn = (state: 'idle' | 'working'): TurnMarkRead => ({ ok: true, sessionId: COORD, state, event: 'Stop', at: 1, turnAt: 1, stopAt: 1, bg: 0,
    bgKinds: [], bgIds: [], err: null, restartAt: null, lostBg: 0, lostKinds: [], lostIds: [], crons: null, graceUntil: null } as never);
  const at = (f: Fixture, u: UsageRead, t: TurnMarkRead, c: CompactionsRead = { kind: 'absent' }): Map<number, GenReadings> =>
    new Map([[gen(f).id, { usage: u, compactions: c, turn: t, behind: { kind: 'measured', value: false } }]]);

  it('a generation in probing gets a start round over its snapshot, served without what it expects, and a passed round makes it active', () => {
    const f = probing();
    const g = gen(f);
    expect(rounds(f.s)).toEqual([{ roundId: expect.stringMatching(/^r-/), kind: 'start', snapshotId: g.snapshotId, depthTokens: null, modelClass: null, n: 2, unmeasured: 0 }]);
    // One round open at a time: the next pass opens nothing more.
    expect(f.pass()).toMatchObject({ roundsOpened: 0, probesFed: 0 });
    answer(f, 'pass');
    expect(f.pass()).toMatchObject({ probesFed: 1 });
    expect(gen(f)).toMatchObject({ state: 'active', probeRounds: 0, proven: true });
    expect(f.pass()).toMatchObject({ probesFed: 0, roundsOpened: 0 });
  });

  it('a refused live probe step is logged and the passed round can be fed again', () => {
    const f = probing();
    const { id } = gen(f);
    answer(f, 'pass');
    f.s.db.exec(`CREATE TEMP TRIGGER refuse_probe_step BEFORE INSERT ON overlord_sequence
      WHEN NEW.kind = 'generation' AND NEW.state = 'active' BEGIN SELECT RAISE(ABORT, 'fixture refuses the step'); END`);
    try {
      expect(f.pass()).toMatchObject({ probesFed: 0 });
      expect(gen(f)).toMatchObject({ state: 'probing', proven: false });
      expect(f.logs.filter((l) => l.includes('the sequence refused its line'))).toEqual([
        `ccrc-server: generations: generation ${id}'s step was not written: the sequence refused its line`,
      ]);
    } finally {
      f.s.db.exec('DROP TRIGGER refuse_probe_step');
    }
    expect(f.pass()).toMatchObject({ probesFed: 1 });
    expect(gen(f)).toMatchObject({ state: 'active', proven: true });
  });

  it('a refused live due step is logged without starting the renewal walk', () => {
    const f = probing();
    answer(f, 'pass');
    expect(f.pass()).toMatchObject({ probesFed: 1 });
    const { id } = gen(f);
    f.canRenew = true;
    const overCap = at(f, usage(260_000, 1_000_000), turn('idle'));
    f.s.db.exec(`CREATE TEMP TRIGGER refuse_due_step BEFORE INSERT ON overlord_sequence
      WHEN NEW.kind = 'generation' AND NEW.state = 'draining' BEGIN SELECT RAISE(ABORT, 'fixture refuses the step'); END`);
    try {
      expect(f.pass(overCap)).toMatchObject({ due: 1 });
      expect(gen(f)).toMatchObject({ state: 'active', dueWhy: 'hard-cap' });
      expect(f.logs.filter((l) => l.includes('the sequence refused its line'))).toEqual([
        `ccrc-server: generations: generation ${id}'s step was not written: the sequence refused its line`,
      ]);
    } finally {
      f.s.db.exec('DROP TRIGGER refuse_due_step');
    }
    f.pass(overCap);
    expect(gen(f)).toMatchObject({ state: 'draining' });
  });

  it('one failed round: a second round opens only after the card is read again; two failed rounds degrade it (recorded, no item raised)', () => {
    const f = probing();
    answer(f, 'fail');
    expect(f.pass()).toMatchObject({ probesFed: 1, roundsOpened: 0 });
    expect(gen(f)).toMatchObject({ state: 'probing', probeRounds: 1 });
    f.t.advance(5_000);
    expect(f.pass()).toMatchObject({ probesFed: 0, roundsOpened: 0 });
    readCardOf(f);
    expect(f.pass()).toMatchObject({ roundsOpened: 1 });
    expect(rounds(f.s).map((r) => r.kind)).toEqual(['start', 'start']);
    answer(f, 'fail');
    expect(f.pass()).toMatchObject({ probesFed: 1 });
    expect(gen(f)).toMatchObject({ state: 'degraded', proven: false });
    // Nothing more is asked of a degraded generation.
    expect(f.pass()).toMatchObject({ probesFed: 0, roundsOpened: 0 });
  });

  it('a failed first round then a passed second round makes it active', () => {
    const f = probing();
    answer(f, 'fail');
    f.pass();
    f.t.advance(5_000);
    readCardOf(f);
    f.pass();
    answer(f, 'pass');
    f.pass();
    expect(gen(f)).toMatchObject({ state: 'active', probeRounds: 0 });
  });

  it('shadow: the walk moves on the shadow column, and `state` stays active', () => {
    const f = fixture();
    f.start('startup', U1);
    f.pass();
    readCardOf(f);
    expect(f.pass()).toMatchObject({ live: false, cardRead: 1, roundsOpened: 1 });
    answer(f, 'pass');
    expect(f.pass()).toMatchObject({ probesFed: 1 });
    expect(gen(f)).toMatchObject({ state: 'active', shadowState: 'active' });
  });

  it('a round its snapshot\'s failed reads made short is graded unmeasured, never fed as a failure, and the generation waits (review 1999 F4b)', () => {
    const f = fixture();
    f.s.setLaneArm(CONTINUITY_LANE, 'live', 1);
    f.start('startup', U1);
    f.pass();
    readCardOf(f, snapshotFactsJson({ ...SNAPSHOT_FACTS, itemsRaised: { kind: 'read', value: [] }, claims: { kind: 'unmeasured', what: 'the claims' } }));
    expect(f.pass()).toMatchObject({ cardRead: 1, roundsOpened: 1 });
    expect(rounds(f.s)[0]).toMatchObject({ n: 1, unmeasured: 1 });
    answer(f, 'pass');
    expect(f.pass()).toMatchObject({ probesFed: 0, roundsOpened: 0 });
    expect(gen(f)).toMatchObject({ state: 'probing', probeRounds: 0 });
  });

  it('a snapshot that names nothing to ask opens no round, and says so in the log', () => {
    const f = fixture();
    f.s.setLaneArm(CONTINUITY_LANE, 'live', 1);
    f.start('startup', U1);
    f.pass();
    readCardOf(f, snapshotFactsJson({ ...SNAPSHOT_FACTS, runs: { kind: 'read', value: [] }, itemsRaised: { kind: 'read', value: [] } }));
    expect(f.pass()).toMatchObject({ cardRead: 1, roundsOpened: 0, unread: null });
    expect(f.pass()).toMatchObject({ roundsOpened: 0, unread: null });
    expect(f.pass()).toMatchObject({ roundsOpened: 0, unread: null });
    expect(rounds(f.s)).toEqual([]);
    // Remembered by its snapshot: drawn and logged once, not every pass (review 2063 F4).
    expect(f.logs.filter((l) => l.includes('had no question to ask'))).toHaveLength(1);
  });

  it('an empty try is remembered per generation and key: a spot step with nothing to ask is drawn once, and the next step is tried again (review 2063 F4)', () => {
    const f = active();
    let tries = 0;
    const real = f.s.liveNotes.bind(f.s);
    f.s.liveNotes = (identity) => { tries += 1; return real(identity); };
    // No note and no mail of this generation's: a spot round has nothing to ask.
    expect(f.pass(at(f, usage(60_000, 1_000_000), turn('idle')))).toMatchObject({ roundsOpened: 0 });
    expect(f.pass(at(f, usage(70_000, 1_000_000), turn('idle')))).toMatchObject({ roundsOpened: 0 });
    expect(f.pass(at(f, usage(99_999, 1_000_000), turn('idle')))).toMatchObject({ roundsOpened: 0 });
    // Its rows are read each pass, since they are part of its key (review 2068 F5), but it is drawn and logged once.
    expect([tries, f.logs.filter((l) => l.includes('had no question to ask')).length]).toEqual([3, 1]);
    expect(f.pass(at(f, usage(100_000, 1_000_000), turn('idle')))).toMatchObject({ roundsOpened: 0 });
    expect([tries, f.logs.filter((l) => l.includes('had no question to ask')).length]).toEqual([4, 2]);
  });

  it('a new note ends a spot step\'s skip: the rows it is drawn from are part of its key (review 2068 F5)', () => {
    const f = active();
    const g = gen(f);
    expect(f.pass(at(f, usage(60_000, 1_000_000), turn('idle')))).toMatchObject({ roundsOpened: 0 });
    expect(f.pass(at(f, usage(61_000, 1_000_000), turn('idle')))).toMatchObject({ roundsOpened: 0 });
    for (const k of ['a', 'b', 'c']) {
      if (!f.s.appendNote({ identity: COORD, sessionId: COORD, generationId: g.id, key: { kind: 'run', id: 1 }, kind: 'thread', waitsOn: 'w', next: `next ${k}`, revises: null, closes: false, at: f.t.ports.clock.wall() }).ok) throw new Error('note');
    }
    // The same 50k step: the notes end the skip, and the round opens at once.
    expect(f.pass(at(f, usage(62_000, 1_000_000), turn('idle')))).toMatchObject({ roundsOpened: 1 });
    expect(rounds(f.s).map((x) => [x.kind, x.depthTokens])).toEqual([['start', null], ['spot', 62_000]]);
  });

  it('a restarted Overlord\'s notes, keyed by its session id, reach its spot round (review 2349 F2)', () => {
    const f = active();
    const g = gen(f);
    f.s.db.prepare("UPDATE continuity_generations SET identity = 'overlord' WHERE id = ?").run(g.id);
    expect(f.pass(at(f, usage(60_000, 1_000_000), turn('idle')))).toMatchObject({ roundsOpened: 0 });
    for (const k of ['a', 'b', 'c']) {
      if (!f.s.appendNote({ identity: COORD, sessionId: COORD, generationId: g.id, key: { kind: 'run', id: 1 }, kind: 'thread', waitsOn: 'w', next: `next ${k}`, revises: null, closes: false, at: f.t.ports.clock.wall() }).ok) throw new Error('note');
    }
    expect(f.pass(at(f, usage(62_000, 1_000_000), turn('idle')))).toMatchObject({ roundsOpened: 1 });
  });

  /** A live coordinator proven active by a passed start round. */
  const active = (): Fixture => {
    const f = probing();
    answer(f, 'pass');
    f.pass();
    expect(gen(f).state).toBe('active');
    f.t.advance(60_000);
    return f;
  };

  it('a compaction counted since the last round opens a compaction round on an active generation, over the newest snapshot it read', () => {
    const f = active();
    expect(f.pass(at(f, usage(10_000, 1_000_000), turn('working')))).toMatchObject({ roundsOpened: 0 });
    const r = f.pass(at(f, usage(10_000, 1_000_000), turn('working'), lines(1, f.t.ports.clock.wall() - 1_000)));
    expect(r).toMatchObject({ roundsOpened: 1 });
    expect(rounds(f.s).map((x) => [x.kind, x.snapshotId])).toEqual([['start', gen(f).snapshotId], ['compaction', gen(f).snapshotId]]);
    // A passed compaction round changes no state, and the same compaction opens no second round.
    answer(f, 'pass');
    expect(f.pass(at(f, usage(10_000, 1_000_000), turn('working'), lines(1, f.t.ports.clock.wall() - 61_000)))).toMatchObject({ roundsOpened: 0, probesFed: 0 });
    expect(gen(f)).toMatchObject({ state: 'active' });
  });

  it('a failed compaction round that a re-read does not fix makes probe-failed due (soft); one the re-read fixes does not', () => {
    const f = active();
    const quiet = (): Map<number, GenReadings> => at(f, usage(10_000, 1_000_000), turn('working'));
    f.pass(at(f, usage(10_000, 1_000_000), turn('working'), lines(1, f.t.ports.clock.wall() - 1_000)));
    answer(f, 'fail');
    f.t.advance(5_000);
    expect(f.pass(quiet())).toMatchObject({ roundsOpened: 0 });
    expect(gen(f)).toMatchObject({ dueWhy: null });
    readCardOf(f);
    expect(f.pass(quiet())).toMatchObject({ roundsOpened: 1 });
    answer(f, 'fail');
    f.pass(quiet());
    expect(gen(f)).toMatchObject({ state: 'active', dueWhy: 'probe-failed', dueClass: 'soft' });
    expect(gen(f).blind).not.toContain('probe-failed');
  });

  it('a compaction round is drawn from the newest snapshot the conversation read: a run that moved before the compaction is asked as it now stands (review 2063 F2)', () => {
    const f = active();
    const carded = gen(f).snapshotId;
    // Run 41 closed and run 6 opened before the compaction; the session read its card again since.
    const moved = readCardOf(f, snapshotFactsJson({ ...SNAPSHOT_FACTS,
      runs: { kind: 'read', value: [{ id: 6, programme: 'prog-a', wave: 2, waveOf: 2, state: 'working', planPath: null, kind: 'work' }] } }));
    f.t.advance(1_000);
    expect(f.pass(at(f, usage(10_000, 1_000_000), turn('working'), lines(1, f.t.ports.clock.wall() - 500)))).toMatchObject({ roundsOpened: 1 });
    expect(rounds(f.s)[1]).toMatchObject({ kind: 'compaction', snapshotId: moved });
    expect(moved).not.toBe(carded);
    const open = f.s.openProbeRound(COORD);
    if (!open.ok) throw new Error(open.detail);
    const run = open.rows.find((r) => r.question.includes('Which run'));
    expect(run).toBeDefined();
    const graded = gradeAnswers([run!], new Map([[run!.qid, '6']]), (t) => t);
    expect(graded[0]!.grade).toBe('pass');
  });

  it('a compaction round waits while the newest card read cannot be read: no round over a guessed snapshot (review 2063 F2)', () => {
    const f = active();
    f.s.db.prepare("UPDATE continuity_card_reads SET hash = x'07' WHERE id = (SELECT max(id) FROM continuity_card_reads)").run();
    const r = f.pass(at(f, usage(10_000, 1_000_000), turn('working'), lines(1, f.t.ports.clock.wall() - 500)));
    expect(r).toMatchObject({ roundsOpened: 0, unread: 'card-reads' });
    expect(rounds(f.s).map((x) => x.kind)).toEqual(['start']);
  });

  it('a compaction supersedes an unanswered spot round: the spot round closes unmeasured, and the compaction round opens (review 2063 F3)', () => {
    const f = active();
    const g = gen(f);
    for (const k of ['a', 'b', 'c']) {
      if (!f.s.appendNote({ identity: COORD, sessionId: COORD, generationId: g.id, key: { kind: 'run', id: 1 }, kind: 'thread', waitsOn: 'w', next: `next ${k}`, revises: null, closes: false, at: f.t.ports.clock.wall() }).ok) throw new Error('note');
    }
    expect(f.pass(at(f, usage(60_000, 1_000_000), turn('idle')))).toMatchObject({ roundsOpened: 1 });
    f.t.advance(1_000);
    const after = Math.ceil(f.t.ports.clock.wall() / 1000);
    const settled = compaction(f.t.ports.clock.wall() - 600, f.t.ports.clock.wall() - 500);
    expect(f.pass(at(f, usage(20_000, 1_000_000, false, after), turn('working'), settled))).toMatchObject({ roundsOpened: 1 });
    expect(rounds(f.s).map((x) => [x.kind, x.depthTokens])).toEqual([['start', null], ['spot', 60_000], ['compaction', 20_000]]);
    const spot = f.s.db.prepare("SELECT grade, answer FROM continuity_probes WHERE kind = 'spot'").all();
    expect(spot).toEqual([{ grade: 'unmeasured', answer: null }]);
    // The superseded spot round never reads failed, and the compaction round is the one served.
    expect(f.s.openProbeRound(COORD).ok && (f.s.openProbeRound(COORD) as { rows: { kind: string }[] }).rows[0]!.kind).toBe('compaction');
  });

  /** Three notes of this generation's, so a spot round has something to ask. */
  const threeNotes = (f: Fixture): void => {
    for (const k of ['a', 'b', 'c']) {
      if (!f.s.appendNote({ identity: COORD, sessionId: COORD, generationId: gen(f).id, key: { kind: 'run', id: 1 }, kind: 'thread', waitsOn: 'w', next: `next ${k}`, revises: null, closes: false, at: f.t.ports.clock.wall() }).ok) throw new Error('note');
    }
  };
  /** The lines of one compaction: its pre line at `pre`, and its post line at `post` when given. */
  const compaction = (pre: number, post?: number): Extract<CompactionsRead, { kind: 'lines' }> => ({ kind: 'lines', skipped: 0, eventsAbsent: false, lines: [
    { at: pre, trigger: 'auto', phase: 'pre', transcript: null, scope: 'main' },
    ...(post === undefined ? [] : [{ at: post, trigger: 'auto' as const, phase: 'post' as const, transcript: null, scope: 'main' as const }]),
  ] });

  it('a spot round opened while live plans its mail; a start round plans none, and in shadow a spot round plans none (review 2149 F16)', () => {
    // The start round, opened live: no notice (only a spot round is announced).
    const s0 = fixture();
    s0.s.setLaneArm(CONTINUITY_LANE, 'live', 1);
    s0.start('startup', U1);
    s0.pass();
    readCardOf(s0);
    const opened = s0.pass();
    expect(opened).toMatchObject({ roundsOpened: 1 });
    expect(opened.planned.map((p) => p.act.kind)).not.toContain('spot-probe');
    // A spot round opened live: one notice, for that generation.
    const f = active();
    threeNotes(f);
    const live = f.pass(at(f, usage(60_000, 1_000_000), turn('idle')));
    expect(live).toMatchObject({ live: true, roundsOpened: 1 });
    expect(live.planned.filter((p) => p.act.kind === 'spot-probe').map((p) => p.target.genId)).toEqual([gen(f).id]);
    // The same in shadow: the round opens and nothing is planned.
    const g = active();
    g.s.setLaneArm(CONTINUITY_LANE, 'shadow', 2);
    threeNotes(g);
    const shadow = g.pass(at(g, usage(60_000, 1_000_000), turn('idle')));
    expect(shadow).toMatchObject({ live: false, roundsOpened: 1, planned: [] });
  });

  it('after a compaction the baseline is the context newer than it, or 0: a spot round opens about 50k into the new context, not at 221k (review 2068 F1)', () => {
    const f = active();
    threeNotes(f);
    const secs = (): number => Math.ceil(f.t.ports.clock.wall() / 1000);
    // A spot round at 170k, answered: the baseline.
    expect(f.pass(at(f, usage(170_000, 1_000_000, false, secs()), turn('idle')))).toMatchObject({ roundsOpened: 1 });
    answer(f, 'pass');
    f.t.advance(60_000);
    // A compaction: the sidecar still reads 171k, written before the compaction's line.
    const stale = secs();
    f.t.advance(60_000);
    const line = f.t.ports.clock.wall();
    f.t.advance(1_000);
    const settled = compaction(line - 500, line);
    expect(f.pass(at(f, usage(171_000, 1_000_000, false, stale), turn('working'), settled))).toMatchObject({ roundsOpened: 1 });
    expect(rounds(f.s).map((x) => [x.kind, x.depthTokens])).toEqual([['start', null], ['spot', 170_000], ['compaction', 0]]);
    answer(f, 'pass');
    f.t.advance(60_000);
    // The old reading opens no spot round; the new context, read after the compaction, opens one at about 50k.
    expect(f.pass(at(f, usage(171_000, 1_000_000, false, stale), turn('idle'), settled))).toMatchObject({ roundsOpened: 0 });
    expect(f.pass(at(f, usage(45_000, 1_000_000, false, secs()), turn('idle'), settled))).toMatchObject({ roundsOpened: 0 });
    f.t.advance(60_000);
    expect(f.pass(at(f, usage(50_000, 1_000_000, false, secs()), turn('idle'), settled))).toMatchObject({ roundsOpened: 1 });
    expect(rounds(f.s).map((x) => [x.kind, x.depthTokens])[3]).toEqual(['spot', 50_000]);
  });

  it('one compaction, one round: a pre line before the round was asked and its post line after it open no second round, a restart too (review 2068 F7)', () => {
    const f = active();
    const pre = f.t.ports.clock.wall() - 1_000;
    expect(f.pass(at(f, usage(10_000, 1_000_000), turn('working'), compaction(pre)))).toMatchObject({ roundsOpened: 1 });
    answer(f, 'pass');
    f.t.advance(60_000);
    const post = f.t.ports.clock.wall();
    f.t.advance(1_000);
    expect(f.pass(at(f, usage(10_000, 1_000_000), turn('working'), compaction(pre, post)))).toMatchObject({ roundsOpened: 0 });
    // A restart: a new process, every memo cold, reads the same lines and counts the same.
    expect(f.pass(at(f, usage(10_000, 1_000_000), turn('working'), compaction(pre, post)), 'p2')).toMatchObject({ roundsOpened: 0 });
    expect(rounds(f.s).map((x) => x.kind)).toEqual(['start', 'compaction']);
    // A compaction begun after the round is one more, and opens the next round.
    f.t.advance(3_600_000);
    const later = f.t.ports.clock.wall();
    f.t.advance(1_000);
    const both: CompactionsRead = { kind: 'lines', skipped: 0, eventsAbsent: false,
      lines: [...compaction(pre, post).lines, { at: later, trigger: 'auto', phase: 'pre', transcript: null, scope: 'main' }] };
    expect(f.pass(at(f, usage(10_000, 1_000_000), turn('working'), both), 'p2')).toMatchObject({ roundsOpened: 1 });
  });

  it('a compaction round that composes empty does not block spot rounds for the generation\'s life, nor keep the old baseline (review 2068 F4, review 2103 F1 and F4)', () => {
    const f = active();
    threeNotes(f);
    const secs = (): number => Math.ceil(f.t.ports.clock.wall() / 1000);
    // An earlier spot round at 150k, answered: the baseline before the compaction.
    expect(f.pass(at(f, usage(150_000, 1_000_000, false, secs()), turn('idle')))).toMatchObject({ roundsOpened: 1 });
    answer(f, 'pass');
    f.t.advance(60_000);
    // The newest card the conversation read names nothing to ask: a compaction round over it composes empty.
    readCardOf(f, snapshotFactsJson({ ...SNAPSHOT_FACTS, runs: { kind: 'read', value: [] }, itemsRaised: { kind: 'read', value: [] } }));
    f.t.advance(1_000);
    const line = f.t.ports.clock.wall();
    const settled = compaction(line - 500, line);
    f.t.advance(1_000);
    expect(f.pass(at(f, usage(60_000, 1_000_000, false, secs()), turn('working'), settled))).toMatchObject({ roundsOpened: 0 });
    expect(f.logs.filter((l) => l.includes('had no question to ask'))).toHaveLength(1);
    // Idle at 60k, read after the compaction: the spot round opens, from baseline 0, though the compaction round is still due.
    expect(f.pass(at(f, usage(60_000, 1_000_000, false, secs()), turn('idle'), settled))).toMatchObject({ roundsOpened: 1 });
    expect(rounds(f.s).map((x) => [x.kind, x.depthTokens])).toEqual([['start', null], ['spot', 150_000], ['spot', 60_000]]);
    // The remembered compaction try outlives the spot round: it is not drawn or logged again.
    answer(f, 'pass');
    f.t.advance(60_000);
    expect(f.pass(at(f, usage(70_000, 1_000_000, false, secs()), turn('idle'), settled))).toMatchObject({ roundsOpened: 0 });
    expect(f.logs.filter((l) => l.includes('had no question to ask'))).toHaveLength(1);
    // And the spot round asked since the compaction is the baseline now: the next opens 50k past it, not every pass.
    expect(f.pass(at(f, usage(110_000, 1_000_000, false, secs()), turn('idle'), settled))).toMatchObject({ roundsOpened: 1 });
  });

  it('a compaction still in flight records 0: a reading newer than its pre line may still carry the old depth (review 2103 F2)', () => {
    const f = active();
    const pre = f.t.ports.clock.wall() - 1_000;
    const secs = Math.ceil(f.t.ports.clock.wall() / 1000);
    expect(f.pass(at(f, usage(171_000, 1_000_000, false, secs), turn('working'), compaction(pre)))).toMatchObject({ roundsOpened: 1 });
    expect(rounds(f.s).map((x) => [x.kind, x.depthTokens])).toEqual([['start', null], ['compaction', 0]]);
  });

  it('a generation that ended leaves no empty-try memo behind (review 2103 F4)', () => {
    const f = fixture();
    f.s.setLaneArm(CONTINUITY_LANE, 'live', 1);
    f.start('startup', U1);
    f.pass();
    readCardOf(f, snapshotFactsJson({ ...SNAPSHOT_FACTS, runs: { kind: 'read', value: [] }, itemsRaised: { kind: 'read', value: [] } }));
    const tries: EmptyTries = new Map();
    const deps = { coord: f.s, clock: f.t.ports.clock, entropy: f.t.ports.entropy, proc: 'p9', log: () => {}, retried: new Set<number>(), emptyTries: tries, gate: () => null };
    generationsPass(deps, { registry: f.registry, readings: new Map(), listedAt: f.t.ports.clock.wall() + 1 });
    const id = gen(f).id;
    expect(tries.get(id)?.get('start')).toMatch(/^start:/);
    f.s.db.prepare("UPDATE continuity_generations SET state = 'ended' WHERE id = ?").run(id);
    generationsPass(deps, { registry: f.registry, readings: new Map(), listedAt: f.t.ports.clock.wall() + 1 });
    expect(tries.has(id)).toBe(false);
  });


  it('50k past the last spot depth while idle opens one spot round about this generation\'s own rows, and sends no mail (slug spot-mail-waits-on-the-renewal-act)', () => {
    const f = active();
    const g = gen(f);
    // A note from before this generation entered active is not asked about; three written since are.
    const note = (next: string, generationId: number | null, when: number) => {
      const r = f.s.appendNote({ identity: COORD, sessionId: COORD, generationId, key: { kind: 'run', id: 1 }, kind: 'thread', waitsOn: 'w', next, revises: null, closes: false, at: when });
      if (!r.ok) throw new Error('note');
      return r.id;
    };
    note('an old thread', g.id, g.enteredAt - 1);
    // A note written since, but not by this generation (no generation recorded), is not this generation's row either.
    note('a stray thread', null, f.t.ports.clock.wall());
    const mine = [note('merge wave 2', g.id, f.t.ports.clock.wall()), note('ask the operator', g.id, f.t.ports.clock.wall() + 1),
      note('dispatch the review', g.id, f.t.ports.clock.wall() + 2)];
    const mailBefore = (f.s.db.prepare('SELECT count(*) AS n FROM mail').get() as { n: number }).n;
    expect(f.pass(at(f, usage(60_000, 1_000_000), turn('idle')))).toMatchObject({ roundsOpened: 1 });
    expect(rounds(f.s)[1]).toMatchObject({ kind: 'spot', snapshotId: null, depthTokens: 60_000, modelClass: expect.any(String), n: 1 });
    const q = f.s.db.prepare("SELECT question, choices, expected FROM continuity_probes WHERE kind = 'spot'").get() as { question: string; choices: string; expected: string };
    // The question names one of this generation's notes (continuation), or offers only them (temporal).
    const ids = mine.map(String);
    const asked = /note (\d+)/.exec(q.question)?.[1];
    if (asked !== undefined) expect(ids).toContain(asked);
    else expect((JSON.parse(q.choices) as string[]).every((c) => ids.includes(c)), q.choices).toBe(true);
    expect(q.choices).not.toContain('an old thread');
    expect(q.choices ?? '').not.toContain('a stray thread');
    expect((f.s.db.prepare('SELECT count(*) AS n FROM mail').get() as { n: number }).n).toBe(mailBefore);
    // Crossing again before an answer opens nothing more.
    expect(f.pass(at(f, usage(120_000, 1_000_000), turn('idle')))).toMatchObject({ roundsOpened: 0 });
    // Answered, the next opens at the last spot depth plus 50k (review 2063 F5), not at the next 50k bucket.
    answer(f, 'pass');
    expect(f.pass(at(f, usage(101_000, 1_000_000), turn('idle')))).toMatchObject({ roundsOpened: 0 });
    expect(f.pass(at(f, usage(109_999, 1_000_000), turn('idle')))).toMatchObject({ roundsOpened: 0 });
    expect(f.pass(at(f, usage(110_000, 1_000_000), turn('idle')))).toMatchObject({ roundsOpened: 1 });
  });

  it('a busy session, a stale sidecar, an unread turn marker or no readings open no spot round (unmeasured, never a guess)', () => {
    const f = active();
    const g = gen(f);
    for (const k of ['a', 'b', 'c']) {
      if (!f.s.appendNote({ identity: COORD, sessionId: COORD, generationId: g.id, key: { kind: 'run', id: 1 }, kind: 'thread', waitsOn: 'w', next: `next ${k}`, revises: null, closes: false, at: f.t.ports.clock.wall() }).ok) throw new Error('note');
    }
    expect(f.pass(at(f, usage(60_000, 1_000_000), turn('working')))).toMatchObject({ roundsOpened: 0 });
    expect(f.pass(at(f, usage(60_000, 1_000_000, true), turn('idle')))).toMatchObject({ roundsOpened: 0 });
    expect(f.pass(at(f, usage(60_000, 1_000_000), { ok: false, reason: 'absent' } as never))).toMatchObject({ roundsOpened: 0 });
    expect(f.pass()).toMatchObject({ roundsOpened: 0 });
    expect(f.pass(at(f, usage(60_000, 1_000_000), turn('idle')))).toMatchObject({ roundsOpened: 1 });
  });

  it('a probe read that fails is named and stops nothing else in the pass', () => {
    const f = probing();
    f.s.db.prepare("UPDATE continuity_probes SET kind = 'later'").run();
    const r = f.pass();
    expect(r.unread).toBe('probes');
    expect(f.logs.some((l) => l.includes('the probes could not be read'))).toBe(true);
    expect(gen(f).state).toBe('probing');
  });
});

describe('the renewal readings\' seam (Overlord W1, renewal readings PR A)', () => {
  const W1_FIELDS = ['fittedCeilingTokens', 'turns', 'backstopDue', 'modelDrift', 'termRaised', 'accountOutsideSet',
    'classUnservable', 'accountLoadMove', 'classChanged', 'notLocal'] as const;
  const W1 = { kind: 'unmeasured', why: 'W1' };
  const unknown = { kind: 'unmeasured', why: 'unread' } as const;
  function oneGen(): GenRow {
    const f = fixture();
    f.start('startup', U1);
    f.pass();
    return live(f.s)[0]!;
  }

  it('with no `w1`, each of the ten fields reads `W1` as before', () => {
    const g = oneGen();
    const i = renewalInputsOf(g, readings(usage(1, 2)), unknown, 0, unknown);
    for (const k of W1_FIELDS) expect(i[k], k).toEqual(W1);
  });

  it('a `w1` naming one field changes only that field; an undefined field keeps `W1`', () => {
    const g = oneGen();
    const base = renewalInputsOf(g, readings(usage(1, 2)), unknown, 0, unknown);
    const one = renewalInputsOf(g, { ...readings(usage(1, 2)), w1: { backstopDue: { kind: 'measured', value: true }, notLocal: undefined } },
      unknown, 0, unknown);
    expect(one).toEqual({ ...base, backstopDue: { kind: 'measured', value: true } });
  });

  it('`renewalDue` over a measured soft ceiling past 60% fires `soft-ceiling` for the Overlord, and is blind on it with no `w1`', () => {
    const g: GenRow = { ...oneGen(), role: 'overlord' };
    const r = readings(usage(70_000, 200_000));
    const blind = renewalDue(renewalInputsOf(g, r, unknown, 0, unknown));
    expect(blind.due).toBe(false);
    expect(blind.blind).toContain('soft-ceiling');
    const due = renewalDue(renewalInputsOf(g, { ...r, w1: { fittedCeilingTokens: { kind: 'measured', value: 100_000 } } }, unknown, 0, unknown));
    expect(due).toMatchObject({ due: true, cls: 'soft', why: 'soft-ceiling' });
  });

  it('the gather asks `w1` with the base readings of the same sample and carries its `w1` and `soft`; with no port, neither', async () => {
    const f = fixture();
    f.start('startup', U1);
    f.pass();
    const g = live(f.s)[0]!;
    const asked: GenReadings[] = [];
    const base: GatherPorts = {
      usage: async () => usage(5, 10), eventsStamp: async () => ({ ok: false, reason: 'absent' }), journalStamp: async () => ({ ok: false, reason: 'absent' }),
      compactions: async () => ({ kind: 'absent' }), turnMark: async () => ({ ok: false, reason: 'absent' }) as never,
      processStartedAt: async () => 100, release: async () => ({ kind: 'none' }),
    };
    const without = (await gatherGenerationReadings(f.s, base, new Map())).get(g.id)!;
    expect('w1' in without || 'soft' in without).toBe(false);
    const ceiling = { kind: 'measured', value: 7 } as const;
    const quiet = { kind: 'measured', value: 1 } as const;
    const withPort = (await gatherGenerationReadings(f.s, { ...base, w1: async (gen, b) => {
      asked.push(b);
      expect(gen.id).toBe(g.id);
      return { w1: { fittedCeilingTokens: ceiling }, soft: { operatorQuietObservedMs: quiet } };
    } }, new Map())).get(g.id)!;
    expect(asked).toHaveLength(1);
    expect(asked[0]!.usage).toEqual(usage(5, 10));
    expect(withPort.w1).toEqual({ fittedCeilingTokens: ceiling });
    expect(withPort.soft).toEqual({ operatorQuietObservedMs: quiet });
    expect(withPort.usage).toEqual(usage(5, 10));
  });
});

describe('shadow is structural: the lane imports nothing that sends', () => {
  it('its value imports are within the allowed list', () => {
    const allowed = ['../../../shared/lane-arm.js', '../../../shared/continuity.js', '../../../shared/models.js', '../coord/laneArm.js',
      '../coord/rollTarget.js', '../coord/bindingReads.js',
      '../roleOf.js', '../time/observed.js', './compactions.js', './continuityStore.js', './generationMachine.js', './generationStart.js',
      './renewalDue.js',
      // The probes piece: the round's composition and schedule (L1) and the snapshot's reader (L1); none of them sends.
      '../../../shared/continuity-card.js', './card.js', './probes.js', './probeSchedule.js',
      // The renewal act: the walk's deciders (L1). The acts are planned here and taken by `renewalActs.ts`, never imported.
      './softRenewal.js', './renewalOrder.js', './renewalFeed.js',
      // The renewal hand-offs: Renew now's and the mark's readers and the PreCompact field's decider (L1); none of them sends.
      './renewNow.js', './operatorMark.js', './precompact.js',
      // Account organization PR D: the organization relation (L0, imports nothing) that reads `startOtherOrg`.
      '../../../shared/accountOrg.js',
      // Renewal readings PR C: the mint's stamp and the latch's decider (L1). The latch itself is a port the wiring binds.
      './renewalReadings.js',
      // Designation B: the deadline sweep's decider (L1); it sends nothing, and the pass only decides with it.
      '../coord/overlordDesignation.js',
      // Renewal readings PR F: the `@overlord` mark's key (L0, imports nothing), read through `operatorQuietOf`.
      '../../../shared/operatorMessages.js'];
    const edges = parsedFile('server/src/continuity/generationsLane.ts').imports.filter((e) =>
      e.kind !== 'type-query' && !e.typeOnly && !(e.names.length > 0 && e.names.every((n) => (e.typeNames ?? []).includes(n))));
    expect(edges.map((e) => e.specifier).sort()).toEqual([...allowed].sort());
  });
});

describe('the pass reads the designation (Overlord W1 designation A, Task 3, X5)', () => {
  const BODY = 'overlord-quiet-otter';
  const NEW_BODY = 'overlord-new-owl';
  const U4 = '44444444-4444-4444-8444-444444444444';
  const view = (over: Partial<DesignationView>): DesignationView => ({
    bound: null, pending: null, term: 5, designatedTerm: 1, model: 'opus', accountPools: { pools: ['pool-a'], untagged: false },
    pastIds: [], actor: 'op', lastAttempt: null, stopsOwed: [], ...over,
  });
  const bound = (id = BODY, pending: DesignationView['pending'] = null): DesignationRead =>
    ({ kind: 'designated', sessionId: id, term: 5, row: view({ bound: { sessionId: id, generation: 'g1' }, pending }) });
  const pendingOf = (id: string, kind: 'designate' | 'rebind'): NonNullable<DesignationView['pending']> =>
    ({ sessionId: id, kind, deadlineAt: 9, since: 1, actor: 'op', generation: null });
  const withBody = (f: Fixture, id: string, uuid: string): void => { f.registry.push({ id, uuid, lane: 'lane-a', child: { kind: 'none' } }); };
  const rows = (f: Fixture) => live(f.s).map((g) => ({ identity: g.identity, sessionId: g.sessionId, role: g.role, term: g.term, n: g.n }));

  it('a bound start mints as the identity overlord with the row\'s term, and a coordinator\'s mints as before', () => {
    const f = fixture();
    f.s.designationRead = () => bound();
    withBody(f, BODY, U3);
    f.start('startup', U1);
    f.start('startup', U3, undefined, BODY);
    expect(f.pass()).toMatchObject({ minted: 2, unread: null });
    expect(rows(f)).toEqual([
      { identity: COORD, sessionId: COORD, role: 'coordinator', term: 1, n: 1 },
      { identity: 'overlord', sessionId: BODY, role: 'overlord', term: 5, n: 1 },
    ]);
  });

  it('a pending designate body reads the Overlord too: its first start mints under overlord', () => {
    const f = fixture();
    f.s.designationRead = () => ({ kind: 'not-designated', row: view({ pending: pendingOf(BODY, 'designate') }) });
    withBody(f, BODY, U3);
    f.start('startup', U3, undefined, BODY);
    expect(f.pass()).toMatchObject({ minted: 1 });
    expect(rows(f)).toEqual([{ identity: 'overlord', sessionId: BODY, role: 'overlord', term: 5, n: 1 }]);
  });

  it('a restart of the Overlord mints against its own live generation: no Superseded, the old one ends, the next stands', () => {
    const f = fixture();
    f.s.designationRead = () => bound();
    withBody(f, BODY, U3);
    f.start('startup', U3, undefined, BODY);
    expect(f.pass()).toMatchObject({ minted: 1, superseded: 0 });
    f.t.advance(30_000);
    f.start('resume', U3, undefined, BODY);
    expect(f.pass()).toMatchObject({ read: 1, minted: 1, superseded: 0, unread: null });
    expect(rows(f)).toEqual([{ identity: 'overlord', sessionId: BODY, role: 'overlord', term: 5, n: 2 }]);
    expect(all(f.s).filter((g) => g['identity'] === 'overlord').map((g) => [g['n'], g['state']])).toEqual([[1, 'ended'], [2, 'active']]);
  });

  it('a rebind with the old generation live: the pending body\'s start mints under its own id, and the old body\'s overlord row stands', () => {
    const f = fixture();
    f.s.designationRead = () => bound(BODY);
    withBody(f, BODY, U3);
    f.start('startup', U3, undefined, BODY);
    f.pass();
    f.s.designationRead = () => bound(BODY, pendingOf(NEW_BODY, 'rebind'));
    withBody(f, NEW_BODY, U4);
    f.t.advance(30_000);
    f.start('startup', U4, undefined, NEW_BODY);
    expect(f.pass()).toMatchObject({ minted: 1, superseded: 0 });
    expect(rows(f).sort((a, b) => a.identity.localeCompare(b.identity))).toEqual([
      { identity: 'overlord', sessionId: BODY, role: 'overlord', term: 5, n: 1 },
      { identity: NEW_BODY, sessionId: NEW_BODY, role: 'overlord', term: 1, n: 1 },
    ]);
  });

  it('an unmeasured designation fails the mint step closed: nothing mints, the starts stay, and the next pass reads them again', () => {
    for (const bad of [(): DesignationRead => ({ kind: 'unmeasured', why: 'the row is unreadable' }),
      (): DesignationRead => { throw new Error('locked'); }]) {
      const f = fixture();
      f.s.designationRead = bad;
      f.start('startup', U1);
      const r = f.pass();
      expect(r).toMatchObject({ read: 0, minted: 0, unread: 'designation' });
      expect(f.logs.some((l) => l.includes('designation'))).toBe(true);
      expect(all(f.s)).toEqual([]);
      f.s.designationRead = () => ({ kind: 'not-designated', row: null });
      expect(f.pass()).toMatchObject({ read: 1, minted: 1, unread: null });
    }
  });
});

describe('the renewal readings PR C: the class a mint stamps, and the probes-failed-twice latch', () => {
  const BODY = 'overlord-quiet-otter';
  const view = (over: Partial<DesignationView>): DesignationView => ({
    bound: null, pending: null, term: 2, designatedTerm: 1, model: 'fable', accountPools: { pools: ['pool-a'], untagged: false },
    pastIds: [], actor: 'op', lastAttempt: null, stopsOwed: [], ...over,
  });
  const bound = (id: string): DesignationRead => ({ kind: 'designated', sessionId: id, term: 2, row: view({ bound: { sessionId: id, generation: 'g1' } }) });
  const classes = (f: Fixture) => live(f.s).map((g) => ({ identity: g.identity, role: g.role, designatedClass: g.designatedClass }))
    .sort((a, b) => a.identity.localeCompare(b.identity));

  it('the mint stamps the designated class for the Overlord (bound or a pending designate), and null for a coordinator', () => {
    const f = fixture();
    f.s.designationRead = () => bound(BODY);
    f.registry.push({ id: BODY, uuid: U3, lane: 'lane-a', child: { kind: 'none' } });
    f.start('startup', U1);
    f.start('startup', U3, undefined, BODY);
    expect(f.pass()).toMatchObject({ minted: 2, unread: null });
    expect(classes(f)).toEqual([
      { identity: COORD, role: 'coordinator', designatedClass: null },
      { identity: 'overlord', role: 'overlord', designatedClass: 'fable' },
    ]);
    const p = fixture();
    p.s.designationRead = () => ({ kind: 'not-designated', row: view({ pending: { sessionId: BODY, kind: 'designate', deadlineAt: 9, since: 1, actor: 'op', generation: null } }) });
    p.registry.push({ id: BODY, uuid: U3, lane: 'lane-a', child: { kind: 'none' } });
    p.start('startup', U3, undefined, BODY);
    p.pass();
    expect(classes(p)).toEqual([{ identity: 'overlord', role: 'overlord', designatedClass: 'fable' }]);
  }, 60_000);

  it('a rebind\'s pending body mints under its own id, and stamps null', () => {
    const f = fixture();
    f.s.designationRead = () => ({ kind: 'designated', sessionId: COORD, term: 2,
      row: view({ bound: { sessionId: COORD, generation: 'g1' }, pending: { sessionId: BODY, kind: 'rebind', deadlineAt: 9, since: 1, actor: 'op', generation: null } }) });
    f.registry.push({ id: BODY, uuid: U3, lane: 'lane-a', child: { kind: 'none' } });
    f.start('startup', U3, undefined, BODY);
    f.pass();
    expect(classes(f)).toEqual([{ identity: BODY, role: 'overlord', designatedClass: null }]);
  }, 60_000);

  it('renewalDue: a raised term makes term-raised due (hard) and a changed class makes class-changed due (soft); with no w1 both are blind', () => {
    const f = fixture();
    f.s.designationRead = () => bound(COORD);
    f.start('startup', U1);
    f.pass();
    const g = live(f.s)[0]!;
    expect(g.role).toBe('overlord');
    const unknown = { kind: 'unmeasured', why: 'unread' } as const;
    const r = readings(usage(1_000, 1_000_000));
    const blind = renewalDue(renewalInputsOf(g, r, unknown, 0, unknown));
    expect(blind.blind).toEqual(expect.arrayContaining(['term-raised', 'class-changed']));
    expect(renewalDue(renewalInputsOf(g, { ...r, w1: { termRaised: { kind: 'measured', value: true } } }, unknown, 0, unknown)))
      .toMatchObject({ due: true, cls: 'hard', why: 'term-raised' });
    expect(renewalDue(renewalInputsOf(g, { ...r, w1: { classChanged: { kind: 'measured', value: true } } }, unknown, 0, unknown)))
      .toMatchObject({ due: true, cls: 'soft', why: 'class-changed' });
  }, 60_000);

  /** The Overlord (`COORD` designated) live in probing with its first round open, its latch recorded. */
  const overlordProbing = (live = true): { f: Fixture; latched: { cause: string; detail: string }[] } => {
    const f = fixture();
    const latched: { cause: string; detail: string }[] = [];
    f.latch = (cause, detail) => { latched.push({ cause, detail }); return { ok: true }; };
    f.s.designationRead = () => bound(COORD);
    if (live) f.s.setLaneArm(CONTINUITY_LANE, 'live', 1);
    f.start('startup', U1);
    f.pass();
    feedCard(f);
    f.pass();
    return { f, latched };
  };
  const feedCard = (f: Fixture): void => {
    const id = `snap-rr${f.t.ports.clock.wall()}`;
    const hash = `${'c'.repeat(56)}${String(f.t.ports.clock.wall()).slice(-8)}`;
    if (!f.s.insertSnapshot({ id, sessionId: COORD, at: f.t.ports.clock.wall(), facts: SNAPSHOT, hash }).ok) throw new Error('snapshot');
    if (!f.s.insertCardRead({ sessionId: COORD, uuid: U1, snapshotId: id, hash, pages: 1, at: f.t.ports.clock.wall() }).ok) throw new Error('read');
  };
  const failRound = (f: Fixture): void => {
    const open = f.s.openProbeRound(COORD);
    if (!open.ok || open.rows.length === 0) throw new Error('no open round');
    const w = f.s.answerRound(open.rows[0]!.roundId, COORD, open.rows.map((r) => ({ qid: r.qid, answer: 'x', grade: 'fail' as const })), 'unmeasured', f.t.ports.clock.wall());
    if (!w.ok) throw new Error(w.kind);
  };
  const twoFailedRounds = (f: Fixture, state: 'state' | 'shadowState', beforeSecondFeed?: () => void): ReturnType<Fixture['pass']> => {
    failRound(f);
    f.pass();
    f.t.advance(5_000);
    feedCard(f);
    f.pass();
    failRound(f);
    beforeSecondFeed?.();
    const result = f.pass();
    expect(live(f.s)[0]![state]).toBe('degraded');
    return result;
  };

  it('a live Overlord degraded by two failed rounds raises the latch once, and later passes raise nothing more', () => {
    const { f, latched } = overlordProbing();
    expect(live(f.s)[0]).toMatchObject({ role: 'overlord', state: 'probing' });
    twoFailedRounds(f, 'state');
    expect(latched).toEqual([{ cause: 'probes-failed-twice', detail: expect.stringContaining('two failed probe rounds') }]);
    f.pass(); f.pass();
    expect(latched).toHaveLength(1);
  }, 60_000);

  it('a first failed round raises nothing', () => {
    const { f, latched } = overlordProbing();
    failRound(f);
    f.pass();
    expect(live(f.s)[0]).toMatchObject({ state: 'probing', probeRounds: 1 });
    expect(latched).toEqual([]);
  }, 60_000);

  it('a shadow walk degraded the same way raises nothing', () => {
    const { f, latched } = overlordProbing(false);
    expect(live(f.s)[0]).toMatchObject({ role: 'overlord', shadowState: 'probing' });
    twoFailedRounds(f, 'shadowState');
    expect(latched).toEqual([]);
  }, 60_000);

  it('a live walk that fails its second round after the lane is lowered still latches', () => {
    const { f, latched } = overlordProbing();
    const result = twoFailedRounds(f, 'state', () => {
      expect(live(f.s)[0]).toMatchObject({ walk: 'live', state: 'probing', probeRounds: 1 });
      f.s.setLaneArm(CONTINUITY_LANE, 'shadow', f.t.ports.clock.wall());
    });
    expect(result).toMatchObject({ live: false, probesFed: 1 });
    expect(live(f.s)[0]).toMatchObject({ state: 'degraded', shadowState: null });
    expect(latched).toEqual([{ cause: 'probes-failed-twice', detail: expect.stringContaining('two failed probe rounds') }]);
  }, 60_000);

  it('a shadow walk that fails its second round under a live lane does not latch', () => {
    const { f, latched } = overlordProbing(false);
    const result = twoFailedRounds(f, 'shadowState', () => {
      expect(live(f.s)[0]).toMatchObject({ walk: 'shadow', shadowState: 'probing', probeRounds: 1 });
      // The clear can miss its compare-and-set; the probes feed can still write the in-flight shadow walk.
      vi.spyOn(f.s, 'clearShadowWalk').mockReturnValue({ changed: false });
      f.s.setLaneArm(CONTINUITY_LANE, 'live', f.t.ports.clock.wall());
    });
    expect(result).toMatchObject({ live: true, probesFed: 1 });
    expect(live(f.s)[0]).toMatchObject({ state: 'active', shadowState: 'degraded' });
    expect(latched).toEqual([]);
  }, 60_000);

  it('a coordinator degraded by two failed rounds raises nothing', () => {
    const f = fixture();
    const latched: string[] = [];
    f.latch = (cause) => { latched.push(cause); return { ok: true }; };
    f.s.setLaneArm(CONTINUITY_LANE, 'live', 1);
    f.start('startup', U1);
    f.pass();
    feedCard(f);
    f.pass();
    twoFailedRounds(f, 'state');
    expect(latched).toEqual([]);
  }, 60_000);

  const refusedCase = (latch: NonNullable<Fixture['latch']>, word: string) => () => {
    const { f } = overlordProbing();
    f.latch = latch;
    failRound(f); f.pass(); f.t.advance(5_000); feedCard(f); f.pass(); failRound(f);
    expect(f.pass()).toMatchObject({ unread: null, probesFed: 1 });
    expect(live(f.s)[0]!.state).toBe('degraded');
    expect(f.logs.some((l) => l.includes('probes-failed-twice latch') && l.includes(word))).toBe(true);
  };
  it('a refused raise is logged with its word, and the pass goes on', refusedCase(() => ({ ok: false, why: 'journal-unreadable' }), 'journal-unreadable'), 60_000);
  it('a throwing raise is logged, and the pass goes on', refusedCase(() => { throw new Error('locked'); }, 'locked'), 60_000);

  it('bound to the wiring\'s raise, the latch lands as the ladder\'s row: cap chat, raised by the renewal lane', () => {
    const { f } = overlordProbing();
    f.latch = renewalReadingsOf({ time: { clock: f.t.ports.clock, entropy: f.t.ports.entropy } }, f.s, []).latch;
    twoFailedRounds(f, 'state');
    expect(f.s.db.prepare('SELECT cause, cap, raisedBy, clearedAt FROM overlord_latches').all()).toEqual([
      { cause: 'probes-failed-twice', cap: 'chat', raisedBy: 'renewal-lane', clearedAt: null },
    ]);
  }, 60_000);
});

describe('the pass decides the pending deadline (Overlord W1 designation B, Task 7: GenerationsInput.attempt)', () => {
  const PENDING_ID = 'overlord-brisk-heron';
  const pendingRead = (deadlineAt: number, generation: string | null = 'g-new'): DesignationRead => ({
    kind: 'not-designated',
    row: { bound: null, pending: { sessionId: PENDING_ID, kind: 'designate', deadlineAt, since: 1, actor: 'op', generation },
      term: 1, designatedTerm: 0, model: 'opus', accountPools: { pools: ['pool-a'], untagged: false }, pastIds: [], actor: 'op',
      lastAttempt: null, stopsOwed: [] },
  });
  const NO_REPORT: SettleFact = { kind: 'no-report' };
  const attemptPass = (f: Fixture, attempt: { read: DesignationRead; settle: SettleFact } | undefined, decide?: GenerationsDeps['decide']) =>
    generationsPass({ coord: f.s, clock: f.t.ports.clock, entropy: f.t.ports.entropy, proc: 'p1', log: (l) => f.logs.push(l), retried: new Set(), emptyTries: new Map(),
      gate: () => null, ...(decide === undefined ? {} : { decide }) },
    { registry: f.registry, readings: new Map(), listedAt: f.t.ports.clock.wall() + 1, ...(attempt === undefined ? {} : { attempt }) });
  const live = (): Fixture => { const f = fixture(); f.s.setLaneArm(CONTINUITY_LANE, 'live', 1); return f; };
  const shadowLines = (f: Fixture): string[] => f.logs.filter((l) => l.includes('the Overlord\'s attempt would'));

  it('live: a pending attempt past its deadline yields the expire action, and nothing is recorded as shadow', () => {
    const f = live();
    const r = attemptPass(f, { read: pendingRead(FAKE_T0 - 1), settle: NO_REPORT });
    expect(r.live).toBe(true);
    expect(r.attempt).toEqual({ kind: 'expire', sessionId: PENDING_ID, outcome: 'deadline-passed' });
    expect(r.recorded.filter((l) => l.includes('attempt'))).toEqual([]);
    expect(shadowLines(f)).toEqual([]);
  });

  it('live: the deadline is inclusive of now, a held stored report of its own generation expires as authority-unrecorded', () => {
    const f = live();
    const held: SettleFact = { kind: 'reported', sessionId: PENDING_ID, startId: 4, generation: 'g-new', held: true };
    expect(attemptPass(f, { read: pendingRead(FAKE_T0), settle: held }).attempt)
      .toEqual({ kind: 'expire', sessionId: PENDING_ID, outcome: 'authority-unrecorded' });
  });

  it('live: inside the deadline a stored report of its own body is settled again; none yields null', () => {
    const f = live();
    const held: SettleFact = { kind: 'reported', sessionId: PENDING_ID, startId: 4, generation: 'g-new', held: true };
    expect(attemptPass(f, { read: pendingRead(FAKE_T0 + 600_000), settle: held }).attempt)
      .toEqual({ kind: 'resettle', sessionId: PENDING_ID, startId: 4 });
    expect(attemptPass(f, { read: pendingRead(FAKE_T0 + 600_000), settle: NO_REPORT }).attempt).toBeNull();
    expect(attemptPass(f, { read: { kind: 'unmeasured', why: 'locked' }, settle: NO_REPORT }).attempt).toBeNull();
  });

  it('shadow: the same input yields attempt: null and a recorded line naming the action and the session, which is also logged', () => {
    const f = fixture();
    const r = attemptPass(f, { read: pendingRead(FAKE_T0 - 1), settle: NO_REPORT });
    expect(r.live).toBe(false);
    expect(r.attempt).toBeNull();
    const line = `ccrc-server: generations: shadow: the Overlord's attempt would expire ${PENDING_ID}`;
    expect(r.recorded).toContain(line);
    expect(f.logs).toContain(line);
  });

  it('shadow: a drain names its ids; a decision of none records nothing', () => {
    const f = fixture();
    const owing: DesignationRead = { kind: 'not-designated', row: { bound: null, pending: null, term: 1, designatedTerm: 0, model: 'opus',
      accountPools: { pools: ['pool-a'], untagged: false }, pastIds: [], actor: 'op', lastAttempt: null, stopsOwed: ['overlord-old-a', 'overlord-old-b'] } };
    const r = attemptPass(f, { read: owing, settle: NO_REPORT });
    expect(r.attempt).toBeNull();
    expect(r.recorded).toContain('ccrc-server: generations: shadow: the Overlord\'s attempt would drain overlord-old-a,overlord-old-b');
    const quiet = fixture();
    expect(attemptPass(quiet, { read: { kind: 'not-designated', row: null }, settle: NO_REPORT }).recorded.filter((l) => l.includes('attempt'))).toEqual([]);
  });

  it('an absent input decides nothing, live or in shadow, and records nothing', () => {
    for (const f of [live(), fixture()]) {
      const r = attemptPass(f, undefined);
      expect(r.attempt).toBeNull();
      expect(r.recorded.filter((l) => l.includes('attempt'))).toEqual([]);
      expect(shadowLines(f)).toEqual([]);
    }
  });

  it('deps.decide.pendingDeadlineOf replaces the decider (a mutant hook): it is asked with the read, the fact and the pass\'s clock', () => {
    const asked: unknown[][] = [];
    const mutant = ((...a: unknown[]) => { asked.push(a); return { kind: 'drain', ids: ['x', 'y'] } as AttemptAction; }) as unknown as NonNullable<GenerationsDeps['decide']>['pendingDeadlineOf'];
    const input = { read: pendingRead(FAKE_T0 + 1), settle: NO_REPORT };
    const f = live();
    expect(attemptPass(f, input, { pendingDeadlineOf: mutant }).attempt).toEqual({ kind: 'drain', ids: ['x', 'y'] });
    expect(asked).toEqual([[input.read, input.settle, FAKE_T0]]);
    const g = fixture();
    const r = attemptPass(g, input, { pendingDeadlineOf: mutant });
    expect(r.attempt).toBeNull();
    expect(r.recorded).toContain('ccrc-server: generations: shadow: the Overlord\'s attempt would drain x,y');
  });
});
