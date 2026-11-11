// Overlord spec §10.5 (W1a, Task 6): the case lane's one pass, in shadow. It reads observation rows, decides with the
// pure decider and records cases; it sends no mail, no push and no feed row.
import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type RunReadResult } from '../src/coord/store.js';
import { casesPass, type CasesCoord } from '../src/coord/casesLane.js';
import { stallDetail } from '../src/coord/stall.js';
import { parsedFile } from './scan/symbols.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { mkdirSync } from 'node:fs';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { loadConfig } from '../src/config.js';
import { seedRoster, testDeps } from './helpers.js';

afterEach(() => { vi.restoreAllMocks(); removeTmpFixtures(); });

const T = 1_786_000_000_000;
const H = 3_600_000;
const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-cases-'), '.ccrc', 'coord.db')));
const COORD_OF: Record<string, string> = { 'prog-a': 'coord-a', 'prog-b': 'coord-b' };
const open = (s: CoordStore, program: string, wave: number): number => {
  const r = s.openRun({ program, title: 'T', project: 'project-a', wave, waveOf: null, claimedBy: COORD_OF[program]! });
  if (!('id' in r)) throw new Error(`fixture openRun refused: ${JSON.stringify(r)}`);
  return r.id;
};
let wave = 0;
/** One episode of the quiet arm: its own run, one observation row at `at`. Returns the row id. */
const episode = (s: CoordStore, at: number, program = 'prog-a'): number => {
  const runId = open(s, program, ++wave);
  const r = s.db.prepare("INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (?, ?, 'working', 'working', 'operator', ?)")
    .run(runId, at, stallDetail('live', 'quiet', 1, 0));
  return Number(r.lastInsertRowid);
};
const cases = (s: CoordStore): Record<string, unknown>[] => s.db.prepare('SELECT * FROM practice_cases ORDER BY id').all() as never;
const count = (s: CoordStore, table: string): number => (s.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('the case lane pass', () => {
  it('three episodes of one arm in 14 days open one shadow case, and nothing is mailed, pushed or fed', async () => {
    const s = store();
    episode(s, T - 3 * H); episode(s, T - 2 * H); episode(s, T - H);
    const before = [count(s, 'mail'), count(s, 'mail_deliveries'), count(s, 'feed_events')];
    expect(await casesPass({ coord: s, now: () => T })).toEqual({ opened: 1, superseded: 0, unread: null });
    const rows = cases(s);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ mode: 'shadow', state: 'open', openedAt: T });
    expect([count(s, 'mail'), count(s, 'mail_deliveries'), count(s, 'feed_events')]).toEqual(before);
  });

  it('a second pass opens nothing more', async () => {
    const s = store();
    episode(s, T - 3 * H); episode(s, T - 2 * H); episode(s, T - H);
    await casesPass({ coord: s, now: () => T });
    expect(await casesPass({ coord: s, now: () => T })).toEqual({ opened: 0, superseded: 0, unread: null });
  });

  it('a fourth episode after the case opens nothing until two more join it', async () => {
    const s = store();
    episode(s, T - 3 * H); episode(s, T - 2 * H); episode(s, T - H);
    await casesPass({ coord: s, now: () => T });
    episode(s, T + H);
    expect((await casesPass({ coord: s, now: () => T + H })).opened).toBe(0);
    const b = episode(s, T + 2 * H);
    const c = episode(s, T + 3 * H);
    const a = Number((s.db.prepare("SELECT id FROM run_events WHERE at = ?").get(T + H) as { id: number }).id);
    expect((await casesPass({ coord: s, now: () => T + 3 * H })).opened).toBe(1);
    const rows = cases(s);
    expect(rows).toHaveLength(2);
    expect(JSON.parse(rows[1]!.evidence as string)).toEqual([a, b, c]);
  });

  it('two episodes in two programmes open a programmes case', async () => {
    const s = store();
    episode(s, T - 2 * H, 'prog-a'); episode(s, T - H, 'prog-b');
    expect((await casesPass({ coord: s, now: () => T })).opened).toBe(1);
    expect(cases(s)[0]).toMatchObject({ cause: 'programmes', programmes: JSON.stringify(['prog-a', 'prog-b']) });
  });
});

describe('the lane clock', () => {
  it("an episode stamped after the lane's clock never opens a case below its evidence (review 1793 F3)", async () => {
    const s = store();
    episode(s, T + H); episode(s, T + H + 1); episode(s, T + H + 2);
    expect((await casesPass({ coord: s, now: () => T })).opened).toBe(0);
    expect((await casesPass({ coord: s, now: () => T + 1 })).opened).toBe(0);
    expect(cases(s)).toEqual([]);
    expect((await casesPass({ coord: s, now: () => T + H + 2 })).opened).toBe(1);
    expect(cases(s)).toHaveLength(1);
    expect(cases(s)[0]).toMatchObject({ openedAt: T + H + 2 });
    expect((await casesPass({ coord: s, now: () => T + H + 3 })).opened).toBe(0);
    expect(cases(s)).toHaveLength(1);
  });
});

describe('the read window', () => {
  it('an episode whose first rung slides out of the window is not counted again after its case', async () => {
    const s = store();
    const runId = open(s, 'prog-a', ++wave);
    const ins = (at: number, rung: 1 | 2): void => {
      s.db.prepare("INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (?, ?, 'working', 'working', 'operator', ?)")
        .run(runId, at, stallDetail('live', 'quiet', rung, 0));
    };
    ins(T - H, 1); ins(T + H, 2);
    episode(s, T - 3 * H); episode(s, T - 2 * H);
    expect((await casesPass({ coord: s, now: () => T })).opened).toBe(1);
    episode(s, T + 14 * 86_400_000 - H, 'prog-b');
    expect(await casesPass({ coord: s, now: () => T - H + 14 * 86_400_000 + 60_000 })).toEqual({ opened: 0, superseded: 0, unread: null });
  });
});

describe('a failing store', () => {
  const seed = (): CoordStore => {
    const s = store();
    episode(s, T - 3 * H); episode(s, T - 2 * H); episode(s, T - H);
    return s;
  };
  const over = (s: CoordStore, patch: Partial<CasesCoord>): CasesCoord => ({
    stallObservationsSince: (x) => s.stallObservationsSince(x),
    practiceCaseNewest: () => s.practiceCaseNewest(),
    run: (id) => s.run(id),
    openPracticeCase: (d, n, at) => s.openPracticeCase(d, n, at),
    ...patch,
  });

  it('(a) an observation read that fails is answered, warned once, and opens nothing', async () => {
    const s = seed();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await casesPass({ coord: over(s, { stallObservationsSince: () => ({ ok: false, detail: 'x' }) }), now: () => T });
    expect(r).toEqual({ opened: 0, superseded: 0, unread: 'observations' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual(['ccrc-server: cases: observations read failed: x']);
    expect(cases(s)).toEqual([]);
  });

  it('(b) a case read that fails gives unread cases and opens nothing', async () => {
    const s = seed();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await casesPass({ coord: over(s, { practiceCaseNewest: () => ({ ok: false, detail: 'x' }) }), now: () => T });
    expect(r).toEqual({ opened: 0, superseded: 0, unread: 'cases' });
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual(['ccrc-server: cases: cases read failed: x']);
    expect(cases(s)).toEqual([]);
  });

  it('(c) a run read that fails lowers the count, warns once and answers unread runs', async () => {
    const s = store();
    const ids = [episode(s, T - 4 * H), episode(s, T - 3 * H), episode(s, T - 2 * H), episode(s, T - H)];
    expect(ids).toHaveLength(4);
    const first = (s.db.prepare('SELECT MIN(runId) AS r FROM run_events').get() as { r: number }).r;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failed: RunReadResult = { ok: false, kind: 'run-unreadable', detail: 'x' };
    const r = await casesPass({ coord: over(s, { run: (id) => (id === first ? failed : s.run(id)) }), now: () => T });
    expect(r).toEqual({ opened: 1, superseded: 0, unread: 'runs' });
    expect(cases(s)).toHaveLength(1);
    expect(cases(s)[0]).toMatchObject({ cause: 'count' });
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([`ccrc-server: cases: runs read failed: 1 of 4 (run ${first}: x)`]);
  });

  it('(e) an absent run is left out without a warning', async () => {
    const s = seed();
    const first = (s.db.prepare('SELECT MIN(runId) AS r FROM run_events').get() as { r: number }).r;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const absent: RunReadResult = { ok: true, run: null };
    const r = await casesPass({ coord: over(s, { run: (id) => (id === first ? absent : s.run(id)) }), now: () => T });
    expect(r).toEqual({ opened: 0, superseded: 0, unread: null });
    expect(warn).not.toHaveBeenCalled();
    expect(cases(s)).toEqual([]);
  });

  it('(d) an openPracticeCase that throws rejects the pass', async () => {
    const s = seed();
    await expect(casesPass({ coord: over(s, { openPracticeCase: () => { throw new Error('boom'); } }), now: () => T })).rejects.toThrow('boom');
  });
});

describe('the watcher', () => {
  it('tick() dispatches the case lane', async () => {
    const home = mkTmp('ccrc-cases-tick-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    try {
      const deps = { ...testDeps(home, async () => ({ ran: true, code: 1, stdout: '', stderr: '' })), cfg, coord };
      const w = new FleetWatcher(deps as never, new Bus(), 10_000);
      const spy = vi.spyOn(w, 'sweepCases').mockResolvedValue(undefined);
      await w.tick();
      await w.tick();
      expect(spy).toHaveBeenCalled();
    } finally {
      coord.db.close();
    }
  });
});

describe('the lane imports values from the decider alone', () => {
  it('only ./practiceCases.js binds a value', () => {
    const edges = parsedFile('server/src/coord/casesLane.ts').imports.filter((e) =>
      e.kind !== 'type-query' && !e.typeOnly && !(e.names.length > 0 && e.names.every((n) => (e.typeNames ?? []).includes(n))));
    expect(edges.map((e) => e.specifier)).toEqual(['./practiceCases.js']);
  });
});
