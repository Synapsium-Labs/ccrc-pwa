import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-coord-'), '.ccrc', 'coord.db')));

const open = (s: CoordStore, program: string, wave: number, claimedBy = 'demo-coordinator'): number => {
  const r = s.openRun({ program, title: `${program} title`, project: 'ccrc-pwa', wave, waveOf: 3, claimedBy });
  if (!('id' in r)) throw new Error('openRun refused');
  return r.id;
};

describe('CoordStore.lastRunBySession (workspace lifecycle spec §5.1)', () => {
  it('answers each asked session’s NEWEST run, with the programme title joined', () => {
    const s = store();
    const w1 = open(s, 'lifecycle', 1);
    s.bindSession(w1, 'demo-worker');
    expect(s.advance(w1, 'failed', 'test-close').ok).toBe(true);
    const w2 = open(s, 'lifecycle', 2);
    s.bindSession(w2, 'demo-worker');
    expect(s.advance(w2, 'failed', 'test-close').ok).toBe(true);
    const read = s.lastRunBySession(['demo-worker']);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.last).toHaveLength(1);
    expect(read.last[0]).toMatchObject({
      sessionId: 'demo-worker', runId: w2, state: 'failed', program: 'lifecycle',
      programTitle: 'lifecycle title', claimedBy: 'demo-coordinator',
    });
    expect(typeof read.last[0]!.closedAt).toBe('number');
    // CONTROL for the open set below: every run naming this session is closed, so it is open as nothing.
    expect(read.openWorkers).toEqual([]);
  });

  it('is scoped to the asked ids — a run naming another session is not read', () => {
    const s = store();
    const r = open(s, 'lifecycle', 1);
    s.bindSession(r, 'someone-else');
    const read = s.lastRunBySession(['demo-worker']);
    expect(read).toEqual({
      ok: true, last: [], openWorkers: [], openClaimants: ['demo-coordinator'], lastPlaced: [], openPlacedWorkers: [], parkedPlacedWorkers: [],
    });
  });

  it('names an asked session a NON-terminal run binds, even when its newest run is terminal', () => {
    const s = store();
    const older = open(s, 'lifecycle', 1);
    s.bindSession(older, 'demo-worker');           // stays `planned`: open
    const newer = open(s, 'lifecycle', 2);
    s.bindSession(newer, 'demo-worker');
    expect(s.advance(newer, 'failed', 'test-close').ok).toBe(true);
    const read = s.lastRunBySession(['demo-worker']);
    expect(read.ok && read.last[0]!.runId).toBe(newer);
    expect(read.ok && read.openWorkers).toEqual(['demo-worker']);
  });

  it('answers every claimant of a non-terminal run, and none of a closed one', () => {
    const s = store();
    open(s, 'live', 1, 'live-coordinator');
    const done = open(s, 'over', 1, 'past-coordinator');
    expect(s.advance(done, 'failed', 'test-close').ok).toBe(true);
    const read = s.lastRunBySession(['anyone']);
    expect(read.ok && read.openClaimants).toEqual(['live-coordinator']);
  });

  it('reads nothing for an empty id list', () => {
    expect(store().lastRunBySession([])).toEqual({
      ok: true, last: [], openWorkers: [], openClaimants: [], lastPlaced: [], openPlacedWorkers: [], parkedPlacedWorkers: [],
    });
  });

  it('an unreadable close time costs THAT session its close time, and no other row its answer', () => {
    const s = store();
    const a = open(s, 'lifecycle', 1);
    s.bindSession(a, 'demo-a');
    expect(s.advance(a, 'failed', 'test-close').ok).toBe(true);
    const b = open(s, 'lifecycle', 2);
    s.bindSession(b, 'demo-b');
    expect(s.advance(b, 'failed', 'test-close').ok).toBe(true);
    s.db.prepare('UPDATE runs SET closedAt = ? WHERE id = ?').run('not-a-time', a);
    const read = s.lastRunBySession(['demo-a', 'demo-b']);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.last.find((r) => r.sessionId === 'demo-a')!.closedAt).toBeNull();
    expect(typeof read.last.find((r) => r.sessionId === 'demo-b')!.closedAt).toBe('number');
  });

  it('refuses the WHOLE read on an unrepresentable run id, naming the column and no value (D-2545)', () => {
    const s = store();
    const UNSAFE = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    s.db.prepare('INSERT INTO programs (slug, title, createdAt, state) VALUES (?, ?, ?, ?)')
      .run('wide', 'Wide', Date.now(), 'active');
    s.db.exec('PRAGMA foreign_keys = OFF');
    try {
      s.db.prepare(
        'INSERT INTO runs (id, program, wave, waveOf, project, sessionId, state, claimedBy, openedAt, closedAt) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(UNSAFE, 'wide', 1, 1, 'ccrc-pwa', 'demo-worker', 'done', 'demo-coordinator', Date.now(), Date.now());
    } finally {
      s.db.exec('PRAGMA foreign_keys = ON');
    }
    expect(s.lastRunBySession(['demo-worker'])).toEqual({
      ok: false, kind: 'run-unreadable', detail: 'run id is not a positive safe integer',
    });
  });
});

// D-6091 (fleet capacity W1-1): two ADDITIVE fields for the run-done policy. A `planned` run is a wave the coordinator
// has not dispatched yet: it uses nothing, so it neither is the child's "newest run" nor holds it as an open worker.
// `last`, `openWorkers` and `openClaimants` are unchanged for their other readers (`fleet.ts`, `watch.ts`).
describe('CoordStore.lastRunBySession: the placed fields (D-6091)', () => {
  it('lastPlaced skips a planned newest run for the newest placed one; last still answers the planned one', () => {
    const s = store();
    const older = open(s, 'lifecycle', 1);
    s.bindSession(older, 'demo-worker');
    expect(s.advance(older, 'failed', 'test-close').ok).toBe(true);
    const planned = open(s, 'lifecycle', 2);
    s.bindSession(planned, 'demo-worker');            // stays `planned`
    const read = s.lastRunBySession(['demo-worker']);
    if (!read.ok) throw new Error(read.detail);
    expect(read.last.map((l) => l.runId)).toEqual([planned]);
    expect(read.lastPlaced.map((l) => [l.sessionId, l.runId, l.state])).toEqual([['demo-worker', older, 'failed']]);
    expect(read.openWorkers, 'the planned run is open').toEqual(['demo-worker']);
    expect(read.openPlacedWorkers, 'but it is not placed').toEqual([]);
  });

  it('a session only a planned run names has no placed run at all', () => {
    const s = store();
    const planned = open(s, 'lifecycle', 1);
    s.bindSession(planned, 'demo-worker');
    const read = s.lastRunBySession(['demo-worker']);
    if (!read.ok) throw new Error(read.detail);
    expect(read.lastPlaced).toEqual([]);
    expect(read.openPlacedWorkers).toEqual([]);
  });

  it('a placed open run (working) names the session in openPlacedWorkers', () => {
    const s = store();
    const r = open(s, 'lifecycle', 1);
    s.bindSession(r, 'demo-worker');
    s.db.prepare("UPDATE runs SET state = 'working' WHERE id = ?").run(r);
    const read = s.lastRunBySession(['demo-worker']);
    if (!read.ok) throw new Error(read.detail);
    expect(read.openPlacedWorkers).toEqual(['demo-worker']);
    expect(read.lastPlaced.map((l) => l.runId)).toEqual([r]);
  });
});

// D-6092 (fleet capacity W1-1b), the characterization: `openPlacedWorkers` is the run-done policy's "another run still
// uses it" read. F5 (b) narrows it to the ACTIVE runs, so a producer parked at review, merge or close is not held by its
// own parked run. The "today:" row is the one the behaviour commit flips; the "kept:" rows must not flip.
describe('CoordStore.lastRunBySession: openPlacedWorkers per F5 (b) (D-6092)', () => {
  const at = (state: string): string[] => {
    const s = store();
    const r = open(s, 'lifecycle', 1);
    s.bindSession(r, 'demo-worker');
    s.db.prepare('UPDATE runs SET state = ? WHERE id = ?').run(state, r);
    const read = s.lastRunBySession(['demo-worker']);
    if (!read.ok) throw new Error(read.detail);
    return read.openPlacedWorkers;
  };

  for (const state of ['awaiting-review', 'merging', 'closing']) {
    it(`now: a run parked at ${state} names no one in openPlacedWorkers (was: the session)`, () => {
      expect(at(state)).toEqual([]);
    });
  }

  for (const state of ['dispatched', 'working', 'unknown']) {
    it(`kept: an active run (${state}) names the session in openPlacedWorkers`, () => {
      expect(at(state)).toEqual(['demo-worker']);
    });
  }

  it('kept: a state this build cannot name counts as active (the safe direction, as the caps read it)', () => {
    expect(at('some-future-state')).toEqual(['demo-worker']);
  });

  it('kept: a terminal or planned run names no one', () => {
    for (const state of ['done', 'failed', 'planned']) expect(at(state), state).toEqual([]);
  });
  // sibling-parked-run-takes-parked-clock: the sessions a PARKED run names, so the verdict takes the parked clock even
  // when that run is not the session's newest placed one.
  const both = (states: string[]) => {
    const s = store();
    for (const [i, state] of states.entries()) {
      const r = open(s, 'lifecycle', i + 1);
      s.bindSession(r, 'demo-worker');
      s.db.prepare('UPDATE runs SET state = ? WHERE id = ?').run(state, r);
    }
    const read = s.lastRunBySession(['demo-worker']);
    if (!read.ok) throw new Error(read.detail);
    return read;
  };

  for (const state of ['awaiting-review', 'merging', 'closing']) {
    it(`an older run parked at ${state} beside a newer done one names the session in parkedPlacedWorkers`, () => {
      const read = both([state, 'done']);
      expect(read.lastPlaced.map((l) => l.state)).toEqual(['done']);
      expect(read.openPlacedWorkers).toEqual([]);
      expect(read.parkedPlacedWorkers).toEqual(['demo-worker']);
    });
  }

  it('no parked run names no one in parkedPlacedWorkers: planned, active, terminal and unnamed states', () => {
    for (const state of ['planned', 'dispatched', 'working', 'unknown', 'done', 'failed', 'some-future-state']) {
      expect(both([state]).parkedPlacedWorkers, state).toEqual([]);
    }
  });
});
