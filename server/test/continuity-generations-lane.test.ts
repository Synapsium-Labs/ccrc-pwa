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
import {
  GENERATIONS_LANE, gatherGenerationReadings, generationsPass, softTimesOf,
  type CompactionsMemo, type GatherPorts, type GenReadings, type GenerationsDeps, type RegistryFacts,
} from '../src/continuity/generationsLane.js';
import type { CompactionsRead } from '../src/continuity/compactions.js';
import type { UsageRead } from '../src/usage.js';
import type { MeasuredStat } from '../src/io.js';
import type { ChildMark } from '../../shared/api.js';
import { CONTINUITY_LANE } from '../../shared/lane-arm.js';
import { HOLD_OFF_MS } from '../../shared/continuity.js';
import { START_RETRY_MS } from '../src/continuity/generationStart.js';
import { parsedFile } from './scan/symbols.js';
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
  pass(readings?: ReadonlyMap<number, GenReadings>, proc?: string): ReturnType<typeof generationsPass>;
  start(source: string, uuid: string, at?: number, sessionId?: string, rowIncarnation?: string): number;
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
  const deps = (proc: string): GenerationsDeps => ({ coord: s, clock: t.ports.clock, proc, log: (l) => logs.push(l) });
  return {
    s, t, logs, registry,
    pass: (readings = new Map(), proc = 'p1') => generationsPass(deps(proc), { registry, readings }),
    start: (source, uuid, at = t.ports.clock.wall(), sessionId = COORD, rowIncarnation = 'inc-1') => {
      n += 1;
      const r = s.insertStart({ sessionId, reportId: `r-${n}`, uuid, source, model: 'claude-opus-5-5', rowIncarnation,
        reportedAt: at, receivedAt: t.ports.clock.wall() });
      if (!r.ok) throw new Error('start not recorded');
      return r.id;
    },
  };
}
const all = (s: CoordStore): Record<string, unknown>[] =>
  s.db.prepare('SELECT identity, n, state, shadowState, outcome, startId FROM continuity_generations ORDER BY id').all() as Record<string, unknown>[];
/** The coordinator's run, closed: it then claims no open run, and reads undecided. */
const closeRuns = (s: CoordStore): void => { s.db.prepare("UPDATE runs SET state = 'done' WHERE claimedBy = ?").run(COORD); };
const live = (s: CoordStore): GenRow[] => { const r = s.liveGenerations(); if (!r.ok) throw new Error(r.detail); return r.rows; };
const setRegistry = (f: Fixture, uuid: string): void => { f.registry[0] = { ...f.registry[0]!, uuid }; };

describe('the pass mints and ends generations from the starts (Task 2)', () => {
  it('a coordinator\'s startup mints n=1 at carded (in shadow: `shadowState`), and its clear on the same incarnation mints n=2 and ends n=1 crashed', () => {
    const f = fixture();
    f.start('startup', U1);
    expect(f.pass()).toMatchObject({ read: 1, minted: 1, live: false });
    expect(all(f.s)).toEqual([{ identity: COORD, n: 1, state: 'active', shadowState: 'carded', outcome: null, startId: 1 }]);
    f.t.advance(30_000);
    setRegistry(f, U2);
    f.start('clear', U2);
    expect(f.pass()).toMatchObject({ read: 1, minted: 1 });
    expect(all(f.s)).toEqual([
      // In shadow the `state` column stood `active`, so the outcome reads what the session lived (review 2003 F1): an
      // unplanned start on the same incarnation.
      { identity: COORD, n: 1, state: 'ended', shadowState: 'carded', outcome: 'crashed', startId: 1 },
      { identity: COORD, n: 2, state: 'active', shadowState: 'carded', outcome: null, startId: 2 },
    ]);
  });

  it('live: the mint writes `state` carded', () => {
    const f = fixture();
    f.s.setLaneArm(CONTINUITY_LANE, 'live', 1);
    f.start('startup', U1);
    f.pass();
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
    expect(f.logs.some((l) => l.includes('the generations could not be read, so no start mints and no due is recorded'))).toBe(true);
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
    const r = generationsPass({ coord: f.s, clock: f.t.ports.clock, proc: 'p1', log: () => {} }, { registry: null, readings: new Map() });
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

const usage = (ctxTokens: number, ctxWindow: number, stale = false): UsageRead => ({ kind: 'reading', usage: {
  ts: 1, model: 'claude-opus-5-5', class: null, effort: null, ctxPct: null, ctxTokens, ctxWindow, cost: null, cacheExpiresAt: null, stale,
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
    expect(live(f.s)[0]!.blind).toEqual(['not-local', 'probe-failed', 'compaction-refused']);
  });

  it('the wave boundary: the coordinator\'s newest work run open and the one before closed, past a quarter of the cap', () => {
    const { f, id } = atRest();
    f.s.db.prepare("UPDATE runs SET state = 'done' WHERE claimedBy = ?").run(COORD);
    f.s.db.prepare("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) VALUES ('prog-a', 2, 2, 'project-a', 'working', ?, 2)").run(COORD);
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
    expect(live(f.s)[0]).toMatchObject({ dueWhy: null, blind: ['not-local', 'probe-failed', 'compaction-refused'] });
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

describe('the gather', () => {
  const ports = (calls: string[], stamp: () => MeasuredStat): GatherPorts => ({
    usage: async () => { calls.push('usage'); return usage(1, 2); },
    eventsStamp: async () => stamp(),
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
      coord.insertStart({ sessionId: COORD, reportId: 'r-1', uuid: U1, source: 'clear', model: null, rowIncarnation: null, reportedAt: 1, receivedAt: 1 });
      await w.sweepGenerations([]);
      // The registry lists no row, so the start mints nothing; the pass ran to its end and moved the cursor.
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

describe('shadow is structural: the lane imports nothing that sends', () => {
  it('its value imports are within the allowed list', () => {
    const allowed = ['../../../shared/lane-arm.js', '../../../shared/continuity.js', '../../../shared/models.js', '../coord/laneArm.js',
      '../coord/rollTarget.js',
      '../roleOf.js', '../time/observed.js', './compactions.js', './continuityStore.js', './generationStart.js', './renewalDue.js'];
    const edges = parsedFile('server/src/continuity/generationsLane.ts').imports.filter((e) =>
      e.kind !== 'type-query' && !e.typeOnly && !(e.names.length > 0 && e.names.every((n) => (e.typeNames ?? []).includes(n))));
    expect(edges.map((e) => e.specifier).sort()).toEqual([...allowed].sort());
  });
});
