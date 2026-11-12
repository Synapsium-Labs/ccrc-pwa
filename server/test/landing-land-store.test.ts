// Landing order wave 5h (Task 2): the land arm of the one writer, `CoordStore.advanceLanding({ kind: 'land', … })`, and
// `landingReadProjects`. Real runs and pins in a temporary coord.db; fixture HOME only.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { copyFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { createLandingJournal } from '../src/coord/landingJournal.js';
import type { LandingAdvance, LandingLand, LandingOutcome } from '../src/coord/landingEntry.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { landingFactsOf, landingStoreOver } from './landingFixture.js';

afterEach(() => { removeTmpFixtures(); });

const HEAD = 'a'.repeat(40);
const HEAD2 = 'b'.repeat(40);
const HC = 'c'.repeat(40);
const BASE = 'd'.repeat(40);
const MERGE = 'e'.repeat(40);
const P = 'project-a';
const Q = 'project-b';

const MERGED: LandingOutcome = { word: 'merged', head: HEAD, base: BASE, mergedAt: '2026-11-11T10:00:00Z', mergeCommit: MERGE, train: null };

let coord: CoordStore;
let dbPath: string;
beforeEach(() => {
  dbPath = path.join(mkTmp('ccrc-land-'), '.ccrc', 'coord.db');
  coord = landingStoreOver(openCoordDb(dbPath), dbPath);
});

const pin = (pr = 7, head = HEAD): LandingAdvance => ({ kind: 'pin', head, pr, mode: 'off', handoffCommit: HC });
const step = (c: CoordStore, id: number, to: Parameters<CoordStore['advance']>[1]): void => {
  if (!c.advance(id, to, 'test').ok) throw new Error(`fixture advance to ${to} refused`);
};
const atReview = (c: CoordStore, project = P, wave = 1): number => {
  const o = c.openRun({ program: `prog-${project}-${wave}`, title: 't', project, wave, waveOf: 9, claimedBy: 'coord-a' });
  if (!('id' in o)) throw new Error('fixture openRun refused');
  c.setSession(o.id, `${project}-ws${wave}`);
  for (const to of ['dispatched', 'working', 'awaiting-review'] as const) step(c, o.id, to);
  return o.id;
};
const pinned = (c: CoordStore, pr = 7, project = P, wave = 1): number => {
  const id = atReview(c, project, wave);
  if (!c.advanceLanding({ runId: id, to: 'merging', causedBy: 'coordinator', landing: pin(pr) }).ok) throw new Error('fixture pin refused');
  return id;
};
const entryOf = (c: CoordStore, pr = 7, project = P) => landingFactsOf(c, project).entries.find((e) => e.pr === pr)!;
const land = (patch: Partial<LandingLand> = {}): LandingLand =>
  ({ kind: 'land', project: P, pr: 7, by: 'reader', at: 5000, outcome: MERGED, expect: null, ...patch });
const detailOf = (c: CoordStore, pr = 7): unknown => {
  const row = c.db.prepare('SELECT detail FROM landing_entries WHERE pr = ?').get(pr) as { detail: string | null };
  return row.detail === null ? null : JSON.parse(row.detail);
};
const insertRaw = (c: CoordStore, pr: number, state: string, quarantine: string | null = null): void => {
  c.db.prepare('INSERT INTO landing_entries (project, pr, pinnedSha, handoffCommit, runId, state, setBy, pinnedAt, quarantineKind) ' +
    "VALUES (?, ?, ?, ?, NULL, ?, 'operator', 1, ?)").run(P, pr, HEAD2, HC, state, quarantine);
};
const runDump = (c: CoordStore, id: number): string => JSON.stringify({
  run: c.db.prepare('SELECT * FROM runs WHERE id = ?').get(id),
  events: c.db.prepare('SELECT * FROM run_events WHERE runId = ? ORDER BY id').all(id),
});

describe('the land arm marks the entry and nothing else', () => {
  it('a pinned entry is marked landed, with its detail', () => {
    pinned(coord);
    const r = coord.advanceLanding(land());
    expect(r).toMatchObject({ ok: true, landing: { kind: 'landed', entry: { pr: 7, state: 'landed' } } });
    expect(entryOf(coord).state).toBe('landed');
    expect(detailOf(coord)).toEqual({ v: 1, by: 'reader', at: 5000, word: 'merged', base: BASE, mergedAt: '2026-11-11T10:00:00Z',
      mergeCommit: MERGE, train: null, trainMergeCommit: null });
  });

  it('an ejected entry is marked landed', () => {
    const id = pinned(coord);
    expect(coord.advanceLanding({ runId: id, to: 'working', causedBy: 'coordinator', landing: { kind: 'retreat', ejection: { base: BASE, kind: 'conflict' } } }).ok).toBe(true);
    expect(entryOf(coord).state).toBe('ejected');
    expect(coord.advanceLanding(land())).toMatchObject({ ok: true, landing: { kind: 'landed' } });
    expect(entryOf(coord).state).toBe('landed');
  });

  it('a merge at a head other than the pinned one still marks landed, and the detail names that head (the head-moved case)', () => {
    pinned(coord);
    expect(coord.advanceLanding(land({ outcome: { ...MERGED, head: HEAD2 } }))).toMatchObject({ ok: true, landing: { kind: 'landed' } });
    expect(entryOf(coord).pinnedSha).toBe(HEAD);
    expect(detailOf(coord)).toMatchObject({ word: 'merged', head: HEAD2 });
  });

  it('closed and absent mark closed', () => {
    pinned(coord, 7, P, 1);
    pinned(coord, 8, P, 2);
    expect(coord.advanceLanding(land({ outcome: { word: 'closed' } }))).toMatchObject({ ok: true, landing: { kind: 'closed', entry: { pr: 7, state: 'closed' } } });
    expect(coord.advanceLanding(land({ pr: 8, outcome: { word: 'absent' } }))).toMatchObject({ ok: true, landing: { kind: 'closed' } });
    expect(entryOf(coord, 8).state).toBe('closed');
    expect(detailOf(coord, 8)).toEqual({ v: 1, by: 'reader', at: 5000, word: 'absent' });
  });

  it('absent never marks landed', () => {
    pinned(coord);
    coord.advanceLanding(land({ outcome: { word: 'absent' } }));
    expect(entryOf(coord).state).not.toBe('landed');
  });

  it('moves no run: the run row and its events are byte-identical', () => {
    const id = pinned(coord);
    const before = runDump(coord, id);
    expect(coord.advanceLanding(land()).ok).toBe(true);
    expect(runDump(coord, id)).toBe(before);
  });

  it('a landed, withdrawn, closed, raw-unknown and quarantined row is kept and unchanged', () => {
    const cases: [number, string, string | null][] = [[11, 'landed', null], [12, 'withdrawn', null], [13, 'closed', null], [14, 'unknown', null],
      [15, 'unknown', 'stale-episode-head']];
    for (const [pr, state, q] of cases) insertRaw(coord, pr, state, q);
    for (const [pr, state] of cases) {
      const before = coord.db.prepare('SELECT * FROM landing_entries WHERE pr = ?').get(pr);
      expect(coord.advanceLanding(land({ pr }))).toEqual({ ok: true, landing: { kind: 'kept', state } });
      expect(coord.db.prepare('SELECT * FROM landing_entries WHERE pr = ?').get(pr)).toEqual(before);
    }
  });

  it('a pinned row whose projection cannot be read is kept and unchanged', () => {
    coord.db.prepare('INSERT INTO landing_entries (project, pr, pinnedSha, handoffCommit, runId, state, setBy, pinnedAt) ' +
      "VALUES (?, 16, 'not-a-hash', ?, NULL, 'pinned', 'operator', 1)").run(P, HC);
    const before = coord.db.prepare('SELECT * FROM landing_entries WHERE pr = 16').get();
    expect(coord.advanceLanding(land({ pr: 16 }))).toEqual({ ok: true, landing: { kind: 'kept', state: 'pinned' } });
    expect(coord.db.prepare('SELECT * FROM landing_entries WHERE pr = 16').get()).toEqual(before);
  });

  it('no row is no-entry', () => {
    expect(coord.advanceLanding(land({ pr: 99 }))).toEqual({ ok: true, landing: { kind: 'no-entry' } });
  });

  it('a re-pin between the read and the mark is moved and writes nothing', () => {
    pinned(coord);
    const read = entryOf(coord);
    const r = coord.advanceLanding(land({ expect: { id: read.id, pinnedAt: read.pinnedAt - 1 } }));
    expect(r).toEqual({ ok: true, landing: { kind: 'moved' } });
    expect(entryOf(coord).state).toBe('pinned');
    expect(coord.advanceLanding(land({ expect: { id: read.id, pinnedAt: read.pinnedAt } }))).toMatchObject({ ok: true, landing: { kind: 'landed' } });
  });
});

describe('refusals and failures of the land arm', () => {
  const boot = (home: string = mkTmp('ccrc-land-rec-')) => {
    const dir = path.join(home, '.ccrc');
    const file = path.join(dir, 'coord.db');
    const db = openCoordDb(file);
    const store = new CoordStore(db, { landingJournal: createLandingJournal(dir) });
    if (!store.replayLandingJournal().ok) throw new Error('fixture replay refused');
    return { home, file, db, store };
  };
  const snapshot = (f: { home: string; file: string; db: DatabaseSync }): string => {
    f.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const to = path.join(f.home, 'snap.db');
    copyFileSync(f.file, to);
    return to;
  };
  const restore = (f: { home: string; file: string; db: DatabaseSync }, snap: string) => {
    f.db.close();
    for (const ext of ['-wal', '-shm']) rmSync(f.file + ext, { force: true });
    copyFileSync(snap, f.file);
    return boot(f.home);
  };
  const create = (s: CoordStore, pr: number, project = P): number => {
    const r = s.writeLandingAuthority({ kind: 'entry', project, pr, pinnedSha: HEAD, handoffCommit: HC, setBy: 'lane-a' }, 1000 + pr);
    if (!r.ok) throw new Error(`fixture create refused: ${r.error}`);
    return r.entry.id;
  };
  const rawProjection = (s: CoordStore, id: number, pr: number, project: string): void => {
    s.db.prepare("INSERT INTO landing_entries (id, project, pr, pinnedSha, handoffCommit, runId, state, setBy, pinnedAt) VALUES (?, ?, ?, ?, ?, NULL, 'pinned', 'operator', 1)")
      .run(id, project, pr, HEAD, HC);
  };

  it('another project-held subject does not stop a mark', () => {
    const f = boot();
    const snap0 = snapshot(f);
    const a = create(f.store, 1);
    create(f.store, 2);
    const r = restore(f, snap0);
    // pr 1 is resolved by a matching projection; pr 2 stays unresolved, so the project is held
    rawProjection(r.store, a, 1, P);
    expect(landingFactsOf(r.store, P).recovery.hold).not.toBeNull();
    expect(r.store.advanceLanding(land({ pr: 1 }))).toMatchObject({ ok: true, landing: { kind: 'landed' } });
  });

  it('a cross-project identity conflict is refused landing-identity-conflict', () => {
    const f = boot();
    const snap0 = snapshot(f);
    const id = create(f.store, 1);
    const r = restore(f, snap0);
    rawProjection(r.store, id, 5, Q);
    expect(r.store.advanceLanding(land({ project: Q, pr: 5 }))).toEqual({ ok: false, error: 'landing-identity-conflict' });
    expect(r.db.prepare('SELECT state FROM landing_entries WHERE id = ?').get(id)).toEqual({ state: 'pinned' });
  });

  it('the entry\'s own subject, with a readable projection, is refused landing-recovery-unresolved', () => {
    const f = boot();
    const snap0 = snapshot(f);
    const id = create(f.store, 1);
    const r = restore(f, snap0);
    const run = atReview(r.store);
    r.db.prepare("INSERT INTO landing_entries (id, project, pr, pinnedSha, handoffCommit, runId, state, setBy, pinnedAt) VALUES (?, ?, 1, ?, ?, ?, 'pinned', 'operator', 1)")
      .run(id, P, HEAD, HC, run);
    expect(landingFactsOf(r.store, P).recovery.subjects).toMatchObject([{ pr: 1, projection: { kind: 'association-unmeasured' } }]);
    expect(r.store.advanceLanding(land({ pr: 1 }))).toEqual({ ok: false, error: 'landing-recovery-unresolved' });
    expect(r.db.prepare('SELECT state FROM landing_entries WHERE id = ?').get(id)).toEqual({ state: 'pinned' });
  });

  it('a store with no journal port answers landing-journal-unavailable', () => {
    const bare = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-land-np-'), '.ccrc', 'coord.db')));
    expect(bare.advanceLanding(land())).toEqual({ ok: false, error: 'landing-journal-unavailable', recovery: 'restart' });
  });

  it('a throw in the UPDATE answers landing-db-apply with mayApply and fences the line', () => {
    pinned(coord);
    coord.db.exec("CREATE TRIGGER boom BEFORE UPDATE ON landing_entries BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    expect(coord.advanceLanding(land())).toMatchObject({ ok: false, error: 'landing-db-apply', mayApply: true, recovery: 'replay' });
    expect(coord.readLanding(P)).toMatchObject({ ok: false, error: 'landing-fenced' });
    // the fence stands: the next mark is refused, and writes nothing
    coord.db.exec('DROP TRIGGER boom');
    expect(coord.advanceLanding(land())).toMatchObject({ ok: false, error: 'landing-fenced' });
    expect(coord.db.prepare("SELECT state FROM landing_entries WHERE pr = 7").get()).toEqual({ state: 'pinned' });
  });
});

describe('landingReadProjects', () => {
  it('lists a project with a pinned or ejected row once, sorted, and not a project whose rows are all terminal', () => {
    pinned(coord, 7, Q, 1);
    pinned(coord, 8, Q, 2);
    pinned(coord, 9, P, 3);
    expect(coord.landingReadProjects()).toEqual({ ok: true, projects: [P, Q] });
    coord.advanceLanding(land({ pr: 9 }));
    expect(coord.landingReadProjects()).toEqual({ ok: true, projects: [Q] });
  });

  it('an ejected row counts; terminal and unknown rows do not', () => {
    insertRaw(coord, 21, 'ejected');
    insertRaw(coord, 22, 'landed');
    expect(coord.landingReadProjects()).toEqual({ ok: true, projects: [P] });
    coord.db.exec("UPDATE landing_entries SET state = 'closed'");
    expect(coord.landingReadProjects()).toEqual({ ok: true, projects: [] });
  });

  it('is behind the guard', () => {
    const bare = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-land-np2-'), '.ccrc', 'coord.db')));
    expect(bare.landingReadProjects()).toEqual({ ok: false, error: 'landing-journal-unavailable', recovery: 'restart' });
  });
});
