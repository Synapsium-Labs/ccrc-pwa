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
    expect(read).toEqual({ ok: true, last: [], openWorkers: [], openClaimants: ['demo-coordinator'] });
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
    expect(store().lastRunBySession([])).toEqual({ ok: true, last: [], openWorkers: [], openClaimants: [] });
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
