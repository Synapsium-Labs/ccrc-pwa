// Overlord W1, PR B2 (plan w1-board-history.md Task 6): the board's composer (L1) and its gatherer (L3). The composer's cases live
// in `sim/overlordBoardSets.ts`, shared with the mutation floors, and run here against the real functions; the gatherer is
// run against fake ports, each reader a spy.
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { composeBoard, timersByProgramme, boardProgrammeCount } from '../src/coord/overlordBoard.js';
import { BOARD_PROGRAMMES_SINCE_MS, gatherBoard, type BoardGatherPorts, type BoardStore } from '../src/coord/overlordBoardRead.js';
import { ProjectWalkCache } from '../src/lifecycle.js';
import type { FleetIO } from '../src/io.js';
import type { ProgrammesAnswer } from '../../shared/api.js';
import type { PortfolioView } from '../../shared/portfolio.js';
import type { IsolationRead } from '../../shared/isolation.js';
import type { RunVerdicts } from '../src/coord/runVerdicts.js';
import type { LadderRead } from '../src/coord/overlordLadderRead.js';
import { STALL_NOTICE_WINDOW_MS } from '../src/coord/stallsettings.js';
import { mkdirSync } from 'node:fs';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import {
  composeBoardCases, healthyInputs, timersByProgrammeCases,
} from './sim/overlordBoardSets.js';

removeTmpFixturesEachTest();

describe('composeBoard (the board, composed from literal reader answers)', () => {
  for (const [name, run] of Object.entries(composeBoardCases(composeBoard))) it(name, run);

  it('boardProgrammeCount is the programmes the board names, and 0 when the programmes read failed', () => {
    expect(boardProgrammeCount(composeBoard(healthyInputs()))).toBe(3);
    expect(boardProgrammeCount(composeBoard(healthyInputs({ programmes: { ok: false, reason: 'no-store' } })))).toBe(0);
  });
});

describe('timersByProgramme (a coordinator\'s pending timers, counted)', () => {
  for (const [name, run] of Object.entries(timersByProgrammeCases(timersByProgramme))) it(name, run);
});

// ------------------------------------------------------------------------------------------------------------ the gatherer

const NOW = 1_700_000_000_000;
const SENTINEL = 'SENTINEL-GATHER-7';

const programmeRow = (slug: string) => ({
  slug, title: `Programme ${slug}`, currentWave: 1, waveOf: 2, claimedBy: 'lane-a-project-a',
  waves: { working: 1, waiting: 0, queued: 0, done: 0, failed: 0 },
});
const answerOf = (slugs: string[]): ProgrammesAnswer =>
  ({ ok: true, programmes: slugs.map(programmeRow), closedToday: { operator: 0, sweep: 0, coordinator: 0 } }) as unknown as ProgrammesAnswer;

const goalsOf = (slug: string) =>
  ({ program: slug, specPath: null, inShort: `${slug} in short`, inShortAt: 1, modifications: [], doneWhen: null });

/** A store of spies: each member answers from literals, so a call count and its arguments are what a case reads. */
function fakeStore(over: Partial<Record<keyof BoardStore, unknown>> = {}) {
  const base = {
    readProgrammes: vi.fn((_o: { since: number; now: number }, _v: RunVerdicts) => answerOf(['prog-a', 'prog-b'])),
    goalsFor: vi.fn((slug: string) => goalsOf(slug)),
    itemsFor: vi.fn((_slug: string | null, _now: number) => ({ open: [], cleared: [] }) as unknown),
    stallObservationsSince: vi.fn((_since: number) => ({ ok: true, rows: [] }) as unknown),
    caps: vi.fn(() => ({ maxConcurrentWorkers: 6 })),
    capsUsage: vi.fn(() => ({ running: 2 })),
    pendingTimers: vi.fn(() => ({ ok: true, rows: [{ setter: 'lane-a-project-a', dueAt: 10, note: SENTINEL }] }) as unknown),
  };
  const store = {
    ...base,
    ...over,
  } as unknown as typeof base;
  return store;
}
type FakeStore = ReturnType<typeof fakeStore>;

const VERDICTS = { replace: vi.fn() } as unknown as RunVerdicts;
const portfolioView = { at: 1, revision: 2, programmes: [] } as unknown as PortfolioView;

/** A port set over a fixture home whose projects root holds one project; `io` counts the walks of that root. */
function fixturePorts(over: Partial<BoardGatherPorts> = {}, store: FakeStore | undefined = fakeStore()) {
  const deps = testDeps(mkTmp('ccrc-board-'));
  const projectsRoot = path.join(deps.cfg.home, 'projects');
  mkdirSync(path.join(projectsRoot, 'project-a'), { recursive: true });
  mkdirSync(deps.cfg.registryDir, { recursive: true });
  const cfg = { ...deps.cfg, projectsRoot };
  const walks = { n: 0 };
  const io = Object.assign(Object.create(deps.io) as FleetIO, {
    readdir: async (p: string) => { if (p === projectsRoot) walks.n += 1; return deps.io.readdir(p); },
  });
  const lifecycle = vi.fn(async (a: ProgrammesAnswer) => a);
  const ports: BoardGatherPorts = {
    coord: store as unknown as BoardStore | undefined,
    verdicts: () => VERDICTS,
    lifecycle,
    listing: () => ({ sessions: [{ id: 'lane-a-project-a', status: 'busy' }] }),
    projects: { io, cfg, cache: new ProjectWalkCache() },
    portfolio: () => portfolioView,
    ladder: () => ({ kind: 'measured', effective: { rung: 'chat', operatorRung: 'advise' } }) as unknown as LadderRead,
    readiness: () => ({ ok: true, wire: { word: 'ready', since: 1, why: null, until: null } }) as unknown as ReturnType<NonNullable<BoardGatherPorts['readiness']>>,
    isolation: () => ({ kind: 'measured', word: 'separate-user', cause: 'other-user' }) as IsolationRead,
    now: () => NOW,
    ...over,
  };
  return { ports, store, lifecycle, walks, io, cfg };
}

describe('gatherBoard (each reader once, inside its own try)', () => {
  it('a store method that throws is that input\'s threw, every other input still reads, and composeBoard still answers a board', async () => {
    const goalsFor = vi.fn((slug: string) => { if (slug === 'prog-a') throw new Error('SQLITE_CORRUPT a-store-fault'); return goalsOf(slug); });
    const caps = vi.fn((): { maxConcurrentWorkers: number } => { throw new Error('caps broke'); });
    const { ports } = fixturePorts({}, fakeStore({ goalsFor, caps }));
    const g = await gatherBoard(ports);
    expect(g.goals.get('prog-a')).toEqual({ ok: false, reason: 'threw' });
    expect(g.goals.get('prog-b')).toMatchObject({ ok: true });
    expect(g.capacity).toEqual({ ok: false, reason: 'threw' });
    expect(g.programmes).toMatchObject({ ok: true });
    expect(g.listing).toMatchObject({ ok: true });
    expect(g.portfolio).toMatchObject({ ok: true });
    expect(g.timers).toMatchObject({ ok: true });
    expect(g.stallNotices).toMatchObject({ ok: true });
    expect(g.ladder).toMatchObject({ ok: true });
    expect(g.projects).toMatchObject({ ok: true });
    const board = composeBoard(g);
    expect(board.capacity).toEqual({ state: 'unmeasured', reason: 'threw' });
    expect(board.identity.state).toBe('measured');
    // A reader's own error text never rides a part.
    expect(JSON.stringify(board)).not.toContain('a-store-fault');
    expect(JSON.stringify(board)).not.toContain('caps broke');
  });

  it('a throwing port is that input\'s threw too, and the programmes read throwing makes the programme inputs threw', async () => {
    const throwing = (): never => { throw new Error('port broke'); };
    const { ports } = fixturePorts({ portfolio: throwing, ladder: throwing, readiness: throwing, isolation: throwing, listing: throwing });
    const g = await gatherBoard(ports);
    for (const input of [g.portfolio, g.ladder, g.readiness, g.isolation, g.listing]) expect(input).toEqual({ ok: false, reason: 'threw' });
    expect(g.timers).toMatchObject({ ok: true });
    const lifecycle = vi.fn(async (): Promise<ProgrammesAnswer> => { throw new Error('lifecycle broke'); });
    const second = await gatherBoard(fixturePorts({ lifecycle }).ports);
    expect(second.programmes).toEqual({ ok: false, reason: 'threw' });
    expect(second.goals.size).toBe(0);
    expect(second.items.size).toBe(0);
    expect(composeBoard(second).identity).toEqual({ state: 'unmeasured', reason: 'threw' });
  });

  it('readProgrammes is called once with the 24-hour window and the verdicts port\'s own object, and lifecycle receives its answer', async () => {
    const { ports, store, lifecycle } = fixturePorts();
    const verdictsPort = vi.fn(() => VERDICTS);
    await gatherBoard({ ...ports, verdicts: verdictsPort });
    expect(store.readProgrammes).toHaveBeenCalledTimes(1);
    const [opts, verdicts] = store.readProgrammes.mock.calls[0]!;
    expect(opts).toEqual({ since: NOW - BOARD_PROGRAMMES_SINCE_MS, now: NOW });
    expect(verdicts).toBe(VERDICTS);
    expect(BOARD_PROGRAMMES_SINCE_MS).toBe(24 * 3_600_000);
    expect(lifecycle).toHaveBeenCalledTimes(1);
    expect(lifecycle.mock.calls[0]![0]).toBe(store.readProgrammes.mock.results[0]!.value);
  });

  it('the programmes the lifecycle answers are the ones gathered (its answer, not the store\'s)', async () => {
    const lifecycle = vi.fn(async (a: ProgrammesAnswer) => ({ ...a, programmes: a.programmes.slice(0, 1).map((r) => ({ ...r, lifecycle: 'paused' })) }) as unknown as ProgrammesAnswer);
    const g = await gatherBoard(fixturePorts({ lifecycle }).ports);
    expect(g.programmes.ok && g.programmes.value.map((p) => [p.slug, p.lifecycle])).toEqual([['prog-a', 'paused']]);
    expect([...g.goals.keys()]).toEqual(['prog-a']);
  });

  it('goalsFor and itemsFor are each called exactly once per programme slug, itemsFor with now', async () => {
    const { ports, store } = fixturePorts();
    await gatherBoard(ports);
    expect(store.goalsFor.mock.calls).toEqual([['prog-a'], ['prog-b']]);
    expect(store.itemsFor.mock.calls).toEqual([['prog-a', NOW], ['prog-b', NOW]]);
    for (const m of [store.caps, store.capsUsage, store.pendingTimers, store.stallObservationsSince]) expect(m).toHaveBeenCalledTimes(1);
    expect(store.stallObservationsSince).toHaveBeenCalledWith(NOW - STALL_NOTICE_WINDOW_MS);
  });

  it('items: rows carrying why, how, answer and note reach the composer as id, kind, state, neededBy and title only', async () => {
    const row = { id: 7, kind: 'decide', state: 'open', neededBy: 'soon', title: 'An item title', why: SENTINEL, how: SENTINEL, answer: SENTINEL, note: SENTINEL, extra: SENTINEL };
    const { ports } = fixturePorts({}, fakeStore({ itemsFor: vi.fn(() => ({ open: [row], cleared: [] })) }));
    const g = await gatherBoard(ports);
    const read = g.items.get('prog-a');
    expect(read).toEqual({ ok: true, value: [{ id: 7, kind: 'decide', state: 'open', neededBy: 'soon', title: 'An item title' }] });
    expect(JSON.stringify(composeBoard(g))).not.toContain(SENTINEL);
  });

  it('timers: the note travels to timersByProgramme, which never reads it, so no board part carries it', async () => {
    const g = await gatherBoard(fixturePorts().ports);
    expect(g.timers).toEqual({ ok: true, value: [{ setter: 'lane-a-project-a', dueAt: 10, note: SENTINEL }] });
    const board = composeBoard(g);
    expect(JSON.stringify(board)).not.toContain(SENTINEL);
    expect(board.timers).toMatchObject({ state: 'measured', programmes: [{ slug: 'prog-a', pending: 1, nextDueAt: 10 }, { slug: 'prog-b', pending: 1, nextDueAt: 10 }] });
  });

  it('listProjects receives the cache: two gathers walk the projects root once', async () => {
    const { ports, walks } = fixturePorts();
    const first = await gatherBoard(ports);
    expect(walks.n).toBe(1);
    const second = await gatherBoard(ports);
    expect(walks.n).toBe(1);
    expect(first.projects).toMatchObject({ ok: true, value: { names: ['project-a'] } });
    expect(second.projects).toEqual(first.projects);
    // Control: a fresh cache walks again, so the count above is the cache's doing.
    const other = await gatherBoard({ ...ports, projects: { ...ports.projects, cache: new ProjectWalkCache() } });
    expect(other.projects.ok).toBe(true);
    expect(walks.n).toBe(2);
  });

  it('switches are read from the registry directory\'s own listing, once', async () => {
    const { ports, io, cfg } = fixturePorts();
    const seen: string[] = [];
    const spyIo = Object.assign(Object.create(io) as FleetIO, { readdir: async (p: string) => { seen.push(p); return io.readdir(p); } });
    const g = await gatherBoard({ ...ports, projects: { ...ports.projects, io: spyIo } });
    expect(seen.filter((p) => p === cfg.registryDir).length).toBeGreaterThanOrEqual(1);
    expect(g.switches.ok).toBe(true);
    if (g.switches.ok) expect(Object.values(g.switches.value).every((v) => v === 'clear')).toBe(true);
  });

  it('no store gives no-store for every store input; the other readers still answer', async () => {
    const { ports } = fixturePorts({}, undefined);
    const g = await gatherBoard({ ...ports, coord: undefined });
    const noStore = { ok: false, reason: 'no-store' };
    expect(g.programmes).toEqual(noStore);
    expect(g.stallNotices).toEqual(noStore);
    expect(g.capacity).toEqual(noStore);
    expect(g.timers).toEqual(noStore);
    expect(g.goals.size).toBe(0);
    expect(g.items.size).toBe(0);
    expect(g.listing).toMatchObject({ ok: true });
    expect(g.portfolio).toMatchObject({ ok: true });
    expect(g.projects).toMatchObject({ ok: true });
    const board = composeBoard(g);
    for (const part of [board.identity, board.goals, board.work, board.capacity, board.timers]) expect(part).toEqual({ state: 'unmeasured', reason: 'no-store' });
    expect(board.portfolio.state).toBe('measured');
  });

  it('a null listing is no-listing; an unwired ladder, readiness, isolation and portfolio are not-wired; sandbox is no-reader', async () => {
    const { ports } = fixturePorts({ listing: () => null, ladder: undefined, readiness: undefined, isolation: undefined, portfolio: undefined });
    const g = await gatherBoard(ports);
    expect(g.listing).toEqual({ ok: false, reason: 'no-listing' });
    for (const input of [g.ladder, g.readiness, g.isolation, g.portfolio]) expect(input).toEqual({ ok: false, reason: 'not-wired' });
    expect(g.sandbox).toEqual({ ok: false, reason: 'no-reader' });
    const healthy = await gatherBoard(fixturePorts().ports);
    expect(healthy.sandbox).toEqual({ ok: false, reason: 'no-reader' });
  });

  it('a ladder or readiness read that answers it could not read is read-failed, and a stall read that failed is read-failed too', async () => {
    const { ports } = fixturePorts({
      ladder: () => ({ kind: 'unmeasured', why: 'SQLITE a-ladder-fault' }) as unknown as LadderRead,
      readiness: () => ({ ok: false, detail: 'a readiness fault' }) as unknown as ReturnType<NonNullable<BoardGatherPorts['readiness']>>,
    }, fakeStore({ stallObservationsSince: vi.fn(() => ({ ok: false, detail: 'a stall fault' })), pendingTimers: vi.fn(() => ({ ok: false, detail: 'a timer fault' })) }));
    const g = await gatherBoard(ports);
    for (const input of [g.ladder, g.readiness, g.stallNotices, g.timers]) expect(input).toEqual({ ok: false, reason: 'read-failed' });
    expect(JSON.stringify(composeBoard(g))).not.toMatch(/fault/);
  });

  it('an isolation reader that answers unmeasured is a read, handed over as it answered (the composer words it read-failed with the why)', async () => {
    const { ports } = fixturePorts({ isolation: () => ({ kind: 'unmeasured', why: 'link-down' }) });
    const g = await gatherBoard(ports);
    expect(g.isolation).toEqual({ ok: true, value: { kind: 'unmeasured', why: 'link-down' } });
    const board = composeBoard(g);
    expect(board.itself.state === 'measured' && board.itself.isolation).toEqual({ state: 'unmeasured', reason: 'read-failed', why: 'link-down' });
  });
});
