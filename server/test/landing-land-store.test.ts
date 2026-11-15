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
import { landingOrder } from '../src/coord/landingLine.js';
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

describe('refusals and failures of the land arm', () => {
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

describe('landingReadProjects, widened (wave 5i)', () => {
  it('lists a project whose only rows are unknown, quarantined or in an unrecognised state, with no session or run', () => {
    insertRaw(coord, 31, 'unknown');
    expect(coord.landingReadProjects()).toEqual({ ok: true, projects: [P] });
    coord.db.exec("DELETE FROM landing_entries; INSERT INTO landing_entries (project, pr, pinnedSha, handoffCommit, runId, state, setBy, pinnedAt) VALUES ('project-b', 32, 'x', 'y', NULL, 'future-word', 'z', 1)");
    expect(coord.landingReadProjects()).toEqual({ ok: true, projects: [Q] });
    coord.db.exec("DELETE FROM landing_entries");
    insertRaw(coord, 33, 'unknown', 'stale-episode-head');
    expect(coord.landingReadProjects()).toEqual({ ok: true, projects: [P] });
  });

  it('lists a project with a persisted main-red hold and nothing else, and one named by a recovered subject', () => {
    coord.db.prepare('INSERT INTO landing_projects (project, operatorPaused, mainRedHold) VALUES (?, 0, 1)').run(Q);
    coord.db.prepare('INSERT INTO landing_projects (project, operatorPaused, mainRedHold) VALUES (?, 1, 0)').run('project-c');
    expect(coord.landingReadProjects()).toEqual({ ok: true, projects: [Q] });
    coord.db.exec("INSERT INTO landing_subjects (id, project, pr, bindingKind, observedRunId, observedSeq, creationSeq, creationClaim) VALUES (5, 'project-d', 1, 'no-run', NULL, 1, NULL, NULL)");
    expect(coord.landingReadProjects()).toEqual({ ok: true, projects: [Q, 'project-d'] });
  });

  it('is the sorted union, each project once, and a project with only terminal rows is not listed', () => {
    insertRaw(coord, 41, 'landed');
    insertRaw(coord, 42, 'closed');
    insertRaw(coord, 43, 'withdrawn');
    expect(coord.landingReadProjects()).toEqual({ ok: true, projects: [] });
    insertRaw(coord, 44, 'pinned');
    coord.db.prepare('INSERT INTO landing_projects (project, operatorPaused, mainRedHold) VALUES (?, 0, 1)').run(P);
    coord.db.prepare('INSERT INTO landing_projects (project, operatorPaused, mainRedHold) VALUES (?, 0, 1)').run('project-0');
    expect(coord.landingReadProjects()).toEqual({ ok: true, projects: ['project-0', P] });
  });
});

// ── wave 5i, Task 4: Amendment B (D-8626): a fresh terminal answer retires a row whose pin metadata does not read ──
const ALL_TABLES = ['landing_entries', 'landing_subjects', 'landing_authority', 'landing_projection_witness', 'landing_projects',
  'landing_journal_cursor'] as const;
const dump = (c: CoordStore): unknown => Object.fromEntries(ALL_TABLES.map((t) => {
  const st = c.db.prepare(`SELECT * FROM ${t} ORDER BY 1`);
  st.setReadBigInts(true); // an oversized INTEGER in a fixture is compared whole, never rounded or refused
  return [t, st.all()];
}));
const rawRow = (c: CoordStore, pr = 7, project = P): Record<string, unknown> =>
  c.db.prepare('SELECT * FROM landing_entries WHERE project = ? AND pr = ?').get(project, pr) as Record<string, unknown>;
/** Every column of the row but the two a mark writes. */
const retained = (c: CoordStore, pr = 7): Record<string, unknown> => { const { state: _s, detail: _d, ...rest } = rawRow(c, pr); return rest; };
const witnesses = (c: CoordStore): unknown[] => c.db.prepare('SELECT * FROM landing_projection_witness ORDER BY entryId').all();
const verdict = (c: CoordStore, pr = 7, project = P) => {
  const f = landingFactsOf(c, project);
  const e = f.entries.find((x) => x.pr === pr)!;
  return f.terminalRepairs.find((r) => r.id === e.id)?.value;
};
const tokenOf = (c: CoordStore, pr = 7): string => {
  const v = verdict(c, pr);
  if (v?.kind !== 'eligible') throw new Error(`fixture: the row is not eligible: ${JSON.stringify(v)}`);
  return v.token;
};
const repairLand = (c: CoordStore, token: string, patch: Partial<LandingLand> = {}, pr = 7, project = P): LandingLand => {
  const e = landingFactsOf(c, project).entries.find((x) => x.pr === pr)!;
  return land({ project, pr, expect: { id: e.id, pinnedAt: e.pinnedAt, repairToken: token }, ...patch });
};
const lineOf = (c: CoordStore, project = P) => { const f = landingFactsOf(c, project); return landingOrder(f.entries, f.flags, f.recovery); };
const FORGED = 'f'.repeat(64);
/** A pinned row 7 with a PR 8 waiting on it. */
const withDependent = (c: CoordStore): { target: number; dependent: number } => {
  pinned(c, 7, P, 1);
  pinned(c, 8, P, 2);
  const target = entryOf(c, 7).id;
  c.db.prepare('UPDATE landing_entries SET afterIds = ? WHERE pr = 8').run(`[${target}]`);
  return { target, dependent: entryOf(c, 8).id };
};
const retreatAndReview = (c: CoordStore, runId: number): unknown => {
  const r = c.advanceLanding({ runId, to: 'working', causedBy: 'coordinator', landing: { kind: 'retreat', ejection: null } });
  step(c, runId, 'awaiting-review');
  return r;
};

describe('terminal repair: a fresh terminal answer retires an unreadable row and repairs nothing (Amendment B, D-8626)', () => {
  const DAMAGE: [string, string, unknown[]][] = [
    ['an unreadable handoff', "UPDATE landing_entries SET handoffCommit = 'not-a-hash' WHERE pr = 7", []],
    ['a blank pin sha', "UPDATE landing_entries SET pinnedSha = '' WHERE pr = 7", []],
    ['a blank setter', "UPDATE landing_entries SET setBy = '' WHERE pr = 7", []],
    ['an unreadable state word', "UPDATE landing_entries SET state = 'future-word' WHERE pr = 7", []],
    ['the literal unknown state with no marker', "UPDATE landing_entries SET state = 'unknown' WHERE pr = 7", []],
    ['a BLOB handoff', 'UPDATE landing_entries SET handoffCommit = ? WHERE pr = 7', [new Uint8Array([0, 255, 1])]],
    ['a BLOB setter', 'UPDATE landing_entries SET setBy = ? WHERE pr = 7', [new Uint8Array([7, 7])]],
  ];

  it.each(DAMAGE)('%s: a merged answer retires it landed; state and detail move, nothing else, and its dependent becomes the head', (_n, sql, params) => {
    const { target, dependent } = withDependent(coord);
    coord.db.prepare(sql).run(...(params as never[]));
    const damaged = retained(coord);
    const wBefore = witnesses(coord);
    expect(wBefore).toHaveLength(2);
    const token = tokenOf(coord);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(lineOf(coord)).not.toMatchObject({ head: { id: dependent } });
    const repaired = coord.advanceLanding(repairLand(coord, token));
    expect(repaired).toMatchObject({ ok: true, landing: { kind: 'landed', entry: { id: target, pr: 7, state: 'landed' } } });
    expect(retained(coord)).toEqual(damaged);
    expect(witnesses(coord)).toEqual(wBefore);
    expect(detailOf(coord)).toMatchObject({ v: 1, by: 'reader', at: 5000, word: 'merged' });
    expect(rawRow(coord).state).toBe('landed');
    const after = landingFactsOf(coord, P);
    expect(lineOf(coord)).toMatchObject({ paused: false, head: { id: dependent } });
    expect(after.terminalRepairs.find((r) => r.id === target)).toBeUndefined();
    expect(after.recovery.hold).toBeNull();
  });

  it.each([['closed'], ['absent']] as const)('a %s answer retires it closed, changing only state and detail', (word) => {
    pinned(coord);
    coord.db.prepare("UPDATE landing_entries SET handoffCommit = 'not-a-hash' WHERE pr = 7").run();
    const damaged = retained(coord);
    const r = coord.advanceLanding(repairLand(coord, tokenOf(coord), { outcome: { word } }));
    expect(r).toMatchObject({ ok: true, landing: { kind: 'closed', entry: { pr: 7, state: 'closed' } } });
    expect(retained(coord)).toEqual(damaged);
    expect(detailOf(coord)).toEqual({ v: 1, by: 'reader', at: 5000, word });
  });

  it('an ejected row with a damaged setter is retired the same way, its base and ejection kind retained', () => {
    const id = pinned(coord);
    coord.advanceLanding({ runId: id, to: 'working', causedBy: 'coordinator', landing: { kind: 'retreat', ejection: { base: BASE, kind: 'conflict' } } });
    coord.db.prepare("UPDATE landing_entries SET setBy = '' WHERE pr = 7").run();
    const damaged = retained(coord);
    expect(damaged).toMatchObject({ baseSha: BASE, ejectionKind: 'conflict', ejections: 1 });
    expect(coord.advanceLanding(repairLand(coord, tokenOf(coord)))).toMatchObject({ ok: true, landing: { kind: 'landed' } });
    expect(retained(coord)).toEqual(damaged);
  });

  it('a normal candidate (no repair token) never acquires the permission: the same unreadable row is kept and unchanged', () => {
    pinned(coord);
    coord.db.prepare("UPDATE landing_entries SET handoffCommit = 'not-a-hash' WHERE pr = 7").run();
    expect(verdict(coord)).toMatchObject({ kind: 'eligible' });
    const before = dump(coord);
    expect(coord.advanceLanding(land())).toEqual({ ok: true, landing: { kind: 'kept', state: 'pinned' } });
    expect(dump(coord)).toEqual(before);
  });

  it('the close\'s expect:null carries no repair: an unreadable row is kept by a close', () => {
    pinned(coord);
    coord.db.prepare("UPDATE landing_entries SET handoffCommit = 'not-a-hash' WHERE pr = 7").run();
    const before = dump(coord);
    expect(coord.advanceLanding(land({ by: 'close', expect: null }))).toEqual({ ok: true, landing: { kind: 'kept', state: 'pinned' } });
    expect(dump(coord)).toEqual(before);
  });

  it('a readable row has no repair verdict, and neither has a terminal one', () => {
    pinned(coord, 7, P, 1);
    pinned(coord, 8, P, 2);
    expect(landingFactsOf(coord, P).terminalRepairs).toEqual([]);
    coord.advanceLanding(land({ pr: 8, outcome: { word: 'closed' } }));
    coord.db.prepare("UPDATE landing_entries SET handoffCommit = 'not-a-hash' WHERE pr = 8").run();
    expect(landingFactsOf(coord, P).terminalRepairs).toEqual([]);
  });

  describe('the exclusions: each is a visible hold, never a guessed repair', () => {
    const NOT_A_HASH = "UPDATE landing_entries SET handoffCommit = 'not-a-hash' WHERE pr = 7";
    const CASES: [string, string, 'identity' | 'binding' | 'quarantine' | 'retained-fields'][] = [
      ['a stale-head marker over an unreadable field', `${NOT_A_HASH}; UPDATE landing_entries SET state = 'unknown', quarantineKind = 'stale-episode-head' WHERE pr = 7`, 'quarantine'],
      ['a stale-head marker on an otherwise readable row', "UPDATE landing_entries SET state = 'unknown', quarantineKind = 'stale-episode-head' WHERE pr = 7", 'quarantine'],
      ['any other marker', `${NOT_A_HASH}; PRAGMA ignore_check_constraints = ON; UPDATE landing_entries SET quarantineKind = 'other-marker' WHERE pr = 7; PRAGMA ignore_check_constraints = OFF`, 'quarantine'],
      ['an unreadable afterIds', `${NOT_A_HASH}; UPDATE landing_entries SET afterIds = 'nope' WHERE pr = 7`, 'retained-fields'],
      ['an unreadable ejection counter', `${NOT_A_HASH}; UPDATE landing_entries SET ejections = -1 WHERE pr = 7`, 'retained-fields'],
      ['an unreadable pin time', `${NOT_A_HASH}; UPDATE landing_entries SET pinnedAt = 'soon' WHERE pr = 7`, 'retained-fields'],
      ['an oversized pin time', `${NOT_A_HASH}; UPDATE landing_entries SET pinnedAt = 9007199254740993 WHERE pr = 7`, 'retained-fields'],
      ['an unreadable fixesMain', `${NOT_A_HASH}; UPDATE landing_entries SET fixesMain = 7 WHERE pr = 7`, 'retained-fields'],
      ['an unreadable base', `${NOT_A_HASH}; UPDATE landing_entries SET baseSha = 'zz' WHERE pr = 7`, 'retained-fields'],
      ['an unreadable ejection kind', `${NOT_A_HASH}; UPDATE landing_entries SET ejectionKind = 'bogus' WHERE pr = 7`, 'retained-fields'],
      ['an invalid run id', `${NOT_A_HASH}; PRAGMA foreign_keys = OFF; UPDATE landing_entries SET runId = -3 WHERE pr = 7`, 'identity'],
      ['a run that cannot be read', `${NOT_A_HASH}; PRAGMA foreign_keys = OFF; UPDATE landing_entries SET runId = 99999 WHERE pr = 7`, 'binding'],
    ];
    it.each(CASES)('%s', (_n, sql, reason) => {
      pinned(coord);
      coord.db.exec(sql);
      expect(verdict(coord)).toEqual({ kind: 'blocked', reason });
      const e = entryOf(coord);
      const before = dump(coord);
      const line = lineOf(coord);
      // neither a made-up token nor none at all retires it, and nothing at all is written
      expect(coord.advanceLanding(repairLand(coord, FORGED))).toEqual({ ok: true, landing: { kind: 'kept', state: e.state } });
      expect(coord.advanceLanding(land({ expect: { id: e.id, pinnedAt: e.pinnedAt } }))).toEqual({ ok: true, landing: { kind: 'kept', state: e.state } });
      expect(dump(coord)).toEqual(before);
      expect(lineOf(coord)).toEqual(line);
    });

    it('an invalid PR number refuses the whole project\'s read, and a mark with it, as repair', () => {
      pinned(coord);
      coord.db.prepare("UPDATE landing_entries SET pr = 'x' WHERE pr = 7").run();
      const refusal = { ok: false, error: 'landing-projection-unreadable', recovery: 'repair' };
      expect(coord.readLanding(P)).toEqual(refusal);
      const before = dump(coord);
      expect(coord.advanceLanding(land({ expect: { id: 1, pinnedAt: 1, repairToken: FORGED } }))).toEqual(refusal);
      expect(dump(coord)).toEqual(before);
    });

    it('a missing projection (a recovered subject with no row) is refused by its own hold', () => {
      const f = boot();
      const snap0 = snapshot(f);
      create(f.store, 1);
      const r = restore(f, snap0);
      expect(landingFactsOf(r.store, P).recovery.subjects).toMatchObject([{ pr: 1, projection: { kind: 'missing' } }]);
      const before = dump(r.store);
      expect(r.store.advanceLanding(land({ pr: 1, expect: { id: 1, pinnedAt: 1, repairToken: FORGED } })))
        .toEqual({ ok: false, error: 'landing-recovery-unresolved' });
      expect(dump(r.store)).toEqual(before);
    });

    // M17 identity (blank project): `landing_entries` accepts any text for `project`, and the store reads rows `WHERE project = ?`
    // under whatever key it is given, so a row whose project is empty or padded is read under that same key and reaches the
    // verdict. It is otherwise eligible (the control below), and the project term alone excludes it.
    it.each([['an empty project', ''], ['a padded project', ' project-a ']])('%s is the identity exclusion, never a repair', (_n, key) => {
      pinned(coord);
      coord.db.prepare("UPDATE landing_entries SET handoffCommit = 'not-a-hash' WHERE pr = 7").run();
      expect(verdict(coord)?.kind, 'the control: otherwise eligible').toBe('eligible');
      coord.db.prepare('UPDATE landing_entries SET project = ? WHERE pr = 7').run(key);
      expect(verdict(coord, 7, key)).toEqual({ kind: 'blocked', reason: 'identity' });
      const before = dump(coord);
      const e = entryOf(coord, 7, key);
      const pair = (token?: string): LandingLand => land({ project: key, pr: 7,
        expect: { id: e.id, pinnedAt: e.pinnedAt, ...(token === undefined ? {} : { repairToken: token }) } });
      for (const attempt of [pair(FORGED), pair()]) {
        const out = coord.advanceLanding(attempt);
        expect(out.ok && out.landing.kind, JSON.stringify(out)).toBe('kept');
      }
      expect(dump(coord)).toEqual(before);
    });

    it.each([
      ['a subject of the same project that names the row\'s PR under another id', (_id: number) => `(50, '${P}', 7`],
      ['a subject of another project that names the row\'s id', (id: number) => `(${id}, '${Q}', 5`],
    ])('an identity collision, %s, is refused before the token is looked at', (_n, subject) => {
      pinned(coord);
      coord.db.prepare("UPDATE landing_entries SET handoffCommit = 'not-a-hash' WHERE pr = 7").run();
      const token = tokenOf(coord);
      const id = entryOf(coord).id;
      coord.db.exec(`INSERT INTO landing_subjects (id, project, pr, bindingKind, observedRunId, observedSeq, creationSeq, creationClaim) VALUES ${subject(id)}, 'no-run', NULL, 1, NULL, NULL)`);
      for (const project of [P, Q]) {
        if (project === Q && !subject(id).includes(`'${Q}'`)) continue;
        expect(landingFactsOf(coord, project).recovery.subjects).toMatchObject([{ projection: { kind: 'identity-conflict' } }]);
      }
      expect(verdict(coord)).toEqual({ kind: 'blocked', reason: 'identity' });
      const before = dump(coord);
      expect(coord.advanceLanding(repairLand(coord, token))).toEqual({ ok: false, error: 'landing-identity-conflict' });
      expect(dump(coord)).toEqual(before);
    });

    it('a historical binding that disagrees with the row, with no exact witness, is a hold; a token taken before it is refused', () => {
      const run = pinned(coord);
      coord.db.prepare("UPDATE landing_entries SET handoffCommit = 'not-a-hash' WHERE pr = 7").run();
      const token = tokenOf(coord);
      const id = entryOf(coord).id;
      coord.db.prepare("INSERT INTO landing_subjects (id, project, pr, bindingKind, observedRunId, observedSeq) VALUES (?, ?, 7, 'run', ?, 1)").run(id, P, run + 100);
      expect(landingFactsOf(coord, P).recovery.subjects).toMatchObject([{ pr: 7, projection: { kind: 'association-unmeasured' } }]);
      expect(verdict(coord)).toEqual({ kind: 'blocked', reason: 'binding' });
      const before = dump(coord);
      expect(coord.advanceLanding(repairLand(coord, token))).toEqual({ ok: false, error: 'landing-recovery-unresolved' });
      expect(dump(coord)).toEqual(before);
    });

    it('the same disagreement with an exact existing witness is measurable: only a state word is damaged, and the witness is kept', () => {
      const run = pinned(coord);
      coord.db.prepare("UPDATE landing_entries SET state = 'future-word' WHERE pr = 7").run();
      const id = entryOf(coord).id;
      coord.db.prepare("INSERT INTO landing_subjects (id, project, pr, bindingKind, observedRunId, observedSeq) VALUES (?, ?, 7, 'run', ?, 1)").run(id, P, run + 100);
      expect(verdict(coord)).toEqual({ kind: 'blocked', reason: 'binding' });
      coord.db.prepare('UPDATE landing_projection_witness SET observedSeq = 1 WHERE entryId = ?').run(id);
      const token = tokenOf(coord);
      const damaged = retained(coord);
      const dumpBefore = dump(coord) as Record<string, unknown[]>;
      expect(coord.advanceLanding(repairLand(coord, token))).toMatchObject({ ok: true, landing: { kind: 'landed' } });
      expect(retained(coord)).toEqual(damaged);
      const dumpAfter = dump(coord) as Record<string, unknown[]>;
      for (const t of ALL_TABLES.filter((x) => x !== 'landing_entries')) expect(dumpAfter[t], t).toEqual(dumpBefore[t]);
    });
  });

  describe('the token: any change to what it covers after the read is moved, and writes nothing', () => {
    const attempt = (change: (c: CoordStore) => void) => {
      pinned(coord);
      coord.db.prepare("UPDATE landing_entries SET handoffCommit = 'not-a-hash' WHERE pr = 7").run();
      const token = tokenOf(coord);
      const id = entryOf(coord).id;
      change(coord);
      expect(verdict(coord)).toMatchObject({ kind: 'eligible' });
      expect(tokenOf(coord)).not.toBe(token);
      const before = dump(coord);
      expect(coord.advanceLanding(repairLand(coord, token))).toEqual({ ok: true, landing: { kind: 'moved' } });
      expect(dump(coord)).toEqual(before);
      return { id };
    };
    it('a retained column that changed', () => { attempt((c) => c.db.prepare('UPDATE landing_entries SET ejections = 2 WHERE pr = 7').run()); });
    it('the damaged column that changed', () => { attempt((c) => c.db.prepare("UPDATE landing_entries SET handoffCommit = 'also-bad' WHERE pr = 7").run()); });
    it('the authority row that changed', () => {
      pinned(coord);
      coord.db.prepare("UPDATE landing_entries SET handoffCommit = 'not-a-hash' WHERE pr = 7").run();
      const id = entryOf(coord).id;
      coord.db.prepare("INSERT INTO landing_subjects (id, project, pr, bindingKind, observedRunId, observedSeq) VALUES (?, ?, 7, 'run', ?, 1)")
        .run(id, P, (coord.db.prepare('SELECT runId FROM landing_entries WHERE pr = 7').get() as { runId: number }).runId);
      coord.db.prepare("INSERT INTO landing_authority (subjectId, afterIds, fixesMain, setBy, seq) VALUES (?, '[]', 0, 'lane-a', 3)").run(id);
      const token = tokenOf(coord);
      coord.db.prepare('UPDATE landing_authority SET seq = 4 WHERE subjectId = ?').run(id);
      expect(tokenOf(coord)).not.toBe(token);
      expect(coord.advanceLanding(repairLand(coord, token))).toEqual({ ok: true, landing: { kind: 'moved' } });
      expect(rawRow(coord).state).toBe('pinned');
    });
    it('a token that is the same after a no-op rewrite still lands', () => {
      pinned(coord);
      coord.db.prepare("UPDATE landing_entries SET handoffCommit = 'not-a-hash' WHERE pr = 7").run();
      const token = tokenOf(coord);
      coord.db.prepare("UPDATE landing_entries SET handoffCommit = 'not-a-hash' WHERE pr = 7").run();
      expect(coord.advanceLanding(repairLand(coord, token))).toMatchObject({ ok: true, landing: { kind: 'landed' } });
    });
  });

  describe('a BLOB is its bytes, distinct from every text, and an unrounded integer is itself (M26)', () => {
    const tokenWith = (set: string, ...params: unknown[]): string => {
      coord.db.prepare(`UPDATE landing_entries SET ${set} WHERE pr = 7`).run(...(params as never[]));
      return tokenOf(coord);
    };
    it('the bytes 00ff, the text 00ff and the text 0,255 are three different tokens; empty bytes, the empty string differ', () => {
      pinned(coord);
      const text = tokenWith('handoffCommit = ?', '00ff');
      const bytes = tokenWith('handoffCommit = ?', new Uint8Array([0, 255]));
      const coerced = tokenWith('handoffCommit = ?', '0,255');
      expect(new Set([text, bytes, coerced]).size).toBe(3);
      expect(tokenWith('handoffCommit = ?', 'also-bad')).not.toBe(text);
      const emptyText = tokenWith("pinnedSha = ''");
      const emptyBytes = tokenWith("pinnedSha = x''");
      expect(emptyText).not.toBe(emptyBytes);
      expect((rawRow(coord).pinnedSha as Uint8Array).byteLength).toBe(0);
    });
    it('one byte of drift after the token is moved with no state, detail or witness update; the successful retirement keeps the exact bytes', () => {
      pinned(coord);
      const hex = (): string => (coord.db.prepare('SELECT hex(handoffCommit) AS h FROM landing_entries WHERE pr = 7').get() as { h: string }).h;
      const token = tokenWith('handoffCommit = ?', new Uint8Array([0, 255, 1]));
      coord.db.prepare('UPDATE landing_entries SET handoffCommit = ? WHERE pr = 7').run(new Uint8Array([0, 255, 2]));
      const before = dump(coord);
      expect(coord.advanceLanding(repairLand(coord, token))).toEqual({ ok: true, landing: { kind: 'moved' } });
      expect(dump(coord)).toEqual(before);
      expect(rawRow(coord).detail).toBeNull();
      const fresh = tokenOf(coord);
      expect(coord.advanceLanding(repairLand(coord, fresh))).toMatchObject({ ok: true, landing: { kind: 'landed' } });
      expect(hex()).toBe('00FF02');
      expect(rawRow(coord).handoffCommit).toEqual(new Uint8Array([0, 255, 2]));
    });
  });

  describe('the terminal to pin transition: a closed row whose projection does not read stays closed (M25)', () => {
    it.each([
      ['a retained blank setter', "UPDATE landing_entries SET setBy = '' WHERE pr = 7", []],
      ['a BLOB handoff', 'UPDATE landing_entries SET handoffCommit = ? WHERE pr = 7', [new Uint8Array([9, 9, 9])]],
    ] as [string, string, unknown[]][])('repair, closed, then a verified pin over %s: kept closed, no projection or witness mutation, no metadata invented', (_n, sql, params) => {
      const run = pinned(coord);
      coord.db.prepare(sql).run(...(params as never[]));
      expect(coord.advanceLanding(repairLand(coord, tokenOf(coord), { outcome: { word: 'closed' } })))
        .toMatchObject({ ok: true, landing: { kind: 'closed' } });
      expect(retreatAndReview(coord, run)).toMatchObject({ ok: true, landing: { kind: 'kept', state: 'closed' } });
      const before = dump(coord);
      const again = coord.advanceLanding({ runId: run, to: 'merging', causedBy: 'coordinator', landing: pin(7, HEAD2) });
      expect(again).toMatchObject({ ok: true, to: 'merging', landing: { kind: 'kept', state: 'closed' } });
      expect(dump(coord)).toEqual(before);
    });

    it('positive control: an ordinary readable closed row does re-pin, and writes its witness', () => {
      const run = pinned(coord);
      expect(coord.advanceLanding(land({ outcome: { word: 'closed' } }))).toMatchObject({ ok: true, landing: { kind: 'closed' } });
      expect(retreatAndReview(coord, run)).toMatchObject({ ok: true, landing: { kind: 'kept', state: 'closed' } });
      const again = coord.advanceLanding({ runId: run, to: 'merging', causedBy: 'coordinator', landing: pin(7, HEAD2) });
      expect(again).toMatchObject({ ok: true, landing: { kind: 'pinned', created: false, entry: { pr: 7, state: 'pinned', pinnedSha: HEAD2 } } });
      expect(witnesses(coord)).toEqual([expect.objectContaining({ pinnedSha: HEAD2 })]);
    });

    it('an unknown row is not re-pinned merely because a repair token exists', () => {
      const run = pinned(coord);
      coord.db.prepare("UPDATE landing_entries SET state = 'future-word' WHERE pr = 7").run();
      expect(verdict(coord)).toMatchObject({ kind: 'eligible' });
      expect(retreatAndReview(coord, run)).toMatchObject({ ok: true, landing: { kind: 'kept', state: 'unknown' } });
      const before = dump(coord);
      expect(coord.advanceLanding({ runId: run, to: 'merging', causedBy: 'coordinator', landing: pin(7, HEAD2) }))
        .toMatchObject({ ok: true, landing: { kind: 'kept', state: 'unknown' } });
      expect(dump(coord)).toEqual(before);
    });
  });
});
