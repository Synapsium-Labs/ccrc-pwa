// Landing order wave 5f (Task 1): the guarded store entrances over the authority journal (`landing.log`): boot replay,
// the one authoritative write, the fence, the verified-pin witness and recovery after a database-only restore. Fixture
// HOME, database and journal directory only. A restore is simulated by copying the fixture coord.db file (after a
// checkpoint) over the live one while landing.log stays; an IO fault by a fixture port; a COMMIT or ROLLBACK fault by a
// one-shot `vi.spyOn(db, 'exec')`; an apply fault by an SQL trigger.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { appendFileSync, closeSync, copyFileSync, fsyncSync, readFileSync, rmSync, writeFileSync, fstatSync, openSync, readSync, writeSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { createLandingJournal, type LandingJournalFsOps } from '../src/coord/landingJournal.js';
import type { LandingJournalPort } from '../src/coord/landingJournalPort.js';
import type { LandingAdvance } from '../src/coord/landingEntry.js';
import { landingOrder } from '../src/coord/landingLine.js';
import type { LandingRecovery } from '../../shared/landingLine.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { landingFactsOf } from './landingFixture.js';

afterEach(() => { vi.restoreAllMocks(); removeTmpFixtures(); });

const P = 'project-a';
const Q = 'project-b';
const HEAD = 'a'.repeat(40);
const HEAD2 = 'b'.repeat(40);
const HC = 'c'.repeat(40);

interface Faults {
  append: null | { error: 'unreadable' | 'changed' | 'unwritable' | 'durability' };
  confirm: null | 'unreadable' | 'changed' | 'durability';
  onAppend: null | (() => void);
}
interface Fx {
  home: string; dir: string; dbPath: string; db: DatabaseSync; store: CoordStore; faults: Faults; log: string;
  unusable: ReturnType<typeof vi.fn>;
}

/** A fixture port over the real adapter; `faults` are read at call time, so a test arms one after boot. */
const portOver = (inner: LandingJournalPort, faults: Faults): LandingJournalPort => ({
  read: () => inner.read(),
  confirmDurable: (s) => (faults.confirm === null ? inner.confirmDurable(s) : { ok: false, error: faults.confirm }),
  append: (s, r) => {
    faults.onAppend?.();
    if (faults.append !== null) { const f = faults.append; faults.append = null; return { ok: false, error: f.error, mayApply: true }; }
    return inner.append(s, r);
  },
});

const boot = (home: string = mkTmp('ccrc-ljs-'), ops?: LandingJournalFsOps, replay = true): Fx => {
  const dir = path.join(home, '.ccrc');
  const dbPath = path.join(dir, 'coord.db');
  const db = openCoordDb(dbPath);
  const faults: Faults = { append: null, confirm: null, onAppend: null };
  const unusable = vi.fn((): never => { throw new Error('fixture fail-stop'); });
  const store = new CoordStore(db, { landingJournal: portOver(createLandingJournal(dir, ops), faults), onUnusableConnection: unusable });
  if (replay) { const r = store.replayLandingJournal(); if (!r.ok) throw new Error(`fixture replay refused: ${r.error}`); }
  return { home, dir, dbPath, db, store, faults, log: path.join(dir, 'landing.log'), unusable };
};

const journal = (f: Fx): string => { try { return readFileSync(f.log, 'utf8'); } catch { return ''; } };
const lines = (f: Fx): Record<string, unknown>[] => journal(f).split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>);
const facts = (f: Fx, project: string = P) => landingFactsOf(f.store, project);
const rec = (f: Fx, project: string = P): LandingRecovery => facts(f, project).recovery;
const count = (f: Fx, table: string): number => (f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const cursor = (f: Fx): number => (f.db.prepare('SELECT appliedSeq AS n FROM landing_journal_cursor').get() as { n: number }).n;
const rows = (f: Fx, sql: string): unknown[] => f.db.prepare(sql).all();

const create = (f: Fx, pr: number, project: string = P, at = 1000 + pr) =>
  f.store.writeLandingAuthority({ kind: 'entry', project, pr, pinnedSha: HEAD, handoffCommit: HC, setBy: 'lane-a' }, at);
const order = (f: Fx, pr: number, patch: { afterIds?: number[]; fixesMain?: boolean }, project: string = P) =>
  f.store.writeLandingAuthority({ kind: 'order', project, pr, setBy: 'lane-b', ...patch }, 5000);
const created = (f: Fx, pr: number, project: string = P): number => {
  const r = create(f, pr, project);
  if (!r.ok) throw new Error(`fixture create refused: ${r.error}`);
  return r.entry.id;
};

let snaps = 0;
const snapshot = (f: Fx): string => {
  f.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const to = path.join(f.home, `snap-${++snaps}.db`);
  copyFileSync(f.dbPath, to);
  return to;
};
/** A database-only restore: close, put the snapshot's bytes back, reopen. The journal file stays as it is. */
const restore = (f: Fx, snap: string, replay = true): Fx => {
  f.db.close();
  for (const ext of ['-wal', '-shm']) rmSync(f.dbPath + ext, { force: true });
  copyFileSync(snap, f.dbPath);
  return boot(f.home, undefined, replay);
};

const openRun = (f: Fx, project: string = P, wave = 1): number => {
  const o = f.store.openRun({ program: `prog-${project}-${wave}`, title: 't', project, wave, waveOf: 9, claimedBy: 'coord-a' });
  if (!('id' in o)) throw new Error('fixture openRun refused');
  f.store.setSession(o.id, `${project}-ws${wave}`);
  for (const to of ['dispatched', 'working', 'awaiting-review'] as const) {
    if (!f.store.advance(o.id, to, 'test').ok) throw new Error(`fixture advance to ${to} refused`);
  }
  return o.id;
};
const pinOf = (pr: number, head = HEAD): LandingAdvance => ({ kind: 'pin', head, pr, mode: 'off', handoffCommit: HC });
const pinRun = (f: Fx, runId: number, pr: number, head = HEAD) =>
  f.store.advanceLanding({ runId, to: 'merging', causedBy: 'coordinator', landing: pinOf(pr, head) });
const events = (f: Fx, runId: number): number => (f.db.prepare('SELECT COUNT(*) AS n FROM run_events WHERE runId = ?').get(runId) as { n: number }).n;
const runState = (f: Fx, runId: number): string => (f.db.prepare('SELECT state FROM runs WHERE id = ?').get(runId) as { state: string }).state;
const rawProjection = (f: Fx, id: number, pr: number, project: string = P, runId: number | null = null, sha: string = HEAD): void => {
  f.db.prepare("INSERT INTO landing_entries (id, project, pr, pinnedSha, handoffCommit, runId, state, setBy, pinnedAt) VALUES (?, ?, ?, ?, ?, ?, 'pinned', 'operator', 1)")
    .run(id, project, pr, sha, HC, runId);
};
/** One COMMIT (and optionally ROLLBACK) throws, once each; every other statement runs for real. */
const failOnce = (db: DatabaseSync, ...words: string[]): void => {
  const real = db.exec.bind(db);
  const left = new Set(words);
  vi.spyOn(db, 'exec').mockImplementation((sql: string) => { if (left.delete(sql)) throw new Error(`fixture ${sql} fault`); return real(sql); });
};

/** The real adapter's fs ops with the n-th fsync failing. */
const fsyncFailingAt = (nth: number): LandingJournalFsOps => {
  let n = 0;
  return {
    openSync: (p, flags, mode) => openSync(p, flags, mode), fstatSync: (fd, o) => fstatSync(fd, o),
    readSync: (fd, b, o, l, pos) => readSync(fd, b, o, l, pos), writeSync: (fd, b, o, l) => writeSync(fd, b, o, l),
    fsyncSync: (fd) => { if (++n === nth) throw Object.assign(new Error('fixture fsync'), { code: 'EIO' }); fsyncSync(fd); },
    closeSync: (fd) => closeSync(fd),
  };
};

describe('boot replay and the journal-first write', () => {
  it('existing-empty-journal-refuses', () => {
    const f = boot(undefined, undefined, false);
    writeFileSync(f.log, '');
    expect(f.store.replayLandingJournal()).toEqual({ ok: false, error: 'landing-journal-invalid', recovery: 'replay', invalid: { reason: 'empty', record: null } });
    expect([count(f, 'landing_subjects'), cursor(f)]).toEqual([0, 0]);
    expect(f.store.readLanding(P)).toEqual({ ok: false, error: 'landing-fenced', recovery: 'replay' });
  });

  it('an absent journal with cursor 0 and no overlay rows is a safe bootstrap', () => {
    const f = boot(undefined, undefined, false);
    expect(f.store.replayLandingJournal()).toEqual({ ok: true, applied: 0, lastSeq: 0 });
    expect(facts(f).entries).toEqual([]);
  });

  it('a store without a journal port is unavailable (restart), never fenced', () => {
    const db = openCoordDb(path.join(mkTmp('ccrc-ljs-np-'), '.ccrc', 'coord.db'));
    const store = new CoordStore(db);
    const un = { ok: false, error: 'landing-journal-unavailable', recovery: 'restart' };
    expect(store.readLanding(P)).toEqual(un);
    expect(store.writeLandingAuthority({ kind: 'entry', project: P, pr: 1, pinnedSha: HEAD, handoffCommit: HC, setBy: 'lane-a' }, 1)).toEqual(un);
    expect(store.replayLandingJournal()).toEqual(un);
  });

  it('a store with a port is fenced until its boot replay opens it', () => {
    const f = boot(undefined, undefined, false);
    expect(f.store.readLanding(P)).toEqual({ ok: false, error: 'landing-fenced', recovery: 'replay' });
    expect(f.store.replayLandingJournal().ok).toBe(true);
    expect(f.store.readLanding(P).ok).toBe(true);
  });

  it('replay-file-confirmation-before-sql', () => {
    const f = boot();
    const snap0 = snapshot(f);
    created(f, 1); created(f, 2);
    const r = restore(f, snap0, false);
    r.faults.confirm = 'durability';
    expect(r.store.replayLandingJournal()).toEqual({ ok: false, error: 'landing-journal-durability', recovery: 'replay' });
    expect([count(r, 'landing_subjects'), cursor(r)]).toEqual([0, 0]);
  });

  it('replay-parent-confirmation-before-sql', () => {
    const f = boot();
    const snap0 = snapshot(f);
    created(f, 1);
    // the real adapter: the 2nd fsync of a confirmation is the containing directory's
    const r = restore(f, snap0, false);
    r.db.close();
    const failing = boot(f.home, fsyncFailingAt(2), false);
    expect(lines(failing)).toHaveLength(1);
    expect(failing.store.replayLandingJournal()).toEqual({ ok: false, error: 'landing-journal-durability', recovery: 'replay' });
    expect([count(failing, 'landing_subjects'), cursor(failing)]).toEqual([0, 0]);
    expect(failing.store.readLanding(P)).toMatchObject({ ok: false, error: 'landing-fenced' });
  });

  it('journal-before-db', () => {
    const f = boot();
    let seen: unknown = null;
    f.faults.onAppend = () => { seen = { subjects: count(f, 'landing_subjects'), authority: count(f, 'landing_authority'), cursor: cursor(f), entries: count(f, 'landing_entries') }; };
    const r = create(f, 7);
    expect(r).toMatchObject({ ok: true, changed: true, seq: 1, previous: null });
    expect(seen).toEqual({ subjects: 0, authority: 0, cursor: 0, entries: 0 });
    expect([count(f, 'landing_subjects'), cursor(f), count(f, 'landing_entries')]).toEqual([1, 1, 1]);
    expect(lines(f)).toEqual([{ v: 1, seq: 1, at: 1007, setBy: 'lane-a', subject: { id: 1, project: P, pr: 7, binding: { kind: 'no-run' } },
      kind: 'entry', claim: { pinnedSha: HEAD, handoffCommit: HC } }]);
  });

  it('db-failure-replays-on-restart', () => {
    const f = boot();
    f.db.exec("CREATE TRIGGER boom BEFORE INSERT ON landing_authority BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    expect(create(f, 3)).toEqual({ ok: false, error: 'landing-db-apply', recovery: 'replay', mayApply: true });
    expect(lines(f)).toHaveLength(1);
    expect([count(f, 'landing_subjects'), cursor(f)]).toEqual([0, 0]);
    f.db.exec('DROP TRIGGER boom');
    const again = new CoordStore(f.db, { landingJournal: createLandingJournal(f.dir) });
    expect(again.replayLandingJournal()).toEqual({ ok: true, applied: 1, lastSeq: 1 });
    expect([count(f, 'landing_subjects'), count(f, 'landing_authority'), cursor(f)]).toEqual([1, 1, 1]);
  });

  it('refused-command-appends-nothing', () => {
    const f = boot();
    created(f, 1);
    const before = journal(f);
    expect(create(f, 1)).toEqual({ ok: false, error: 'landing-entry-exists' });
    expect(order(f, 9, { afterIds: [1] })).toEqual({ ok: false, error: 'landing-entry-missing' });
    expect(journal(f)).toBe(before);
    expect(cursor(f)).toBe(1);
  });

  it('after-reference-missing-refuses', () => {
    const f = boot();
    created(f, 1);
    const before = journal(f);
    expect(order(f, 1, { afterIds: [999] })).toEqual({ ok: false, error: 'landing-after-missing' });
    expect(journal(f)).toBe(before);
  });

  it('after-reference-cross-project-refuses', () => {
    const f = boot();
    created(f, 1);
    const other = created(f, 5, Q);
    const before = journal(f);
    expect(order(f, 1, { afterIds: [other] })).toEqual({ ok: false, error: 'landing-after-cross-project' });
    expect(journal(f)).toBe(before);
  });

  it('unreadable-source-cannot-journal-placeholders', () => {
    const f = boot();
    rawProjection(f, 5, 3);
    f.db.exec('UPDATE landing_entries SET fixesMain = 7 WHERE id = 5');
    const before = journal(f);
    expect(order(f, 3, { afterIds: [] })).toEqual({ ok: false, error: 'landing-projection-unreadable', recovery: 'restart' });
    expect(journal(f)).toBe(before);
  });

  it('a live order records the complete resulting authority and an effective no-op appends nothing', () => {
    const f = boot();
    const a = created(f, 1); created(f, 2);
    const r = order(f, 2, { afterIds: [a], fixesMain: true });
    expect(r).toMatchObject({ ok: true, changed: true, seq: 3, entry: { afterIds: [a], fixesMain: true, setBy: 'lane-b' }, previous: { afterIds: [] } });
    const bytes = journal(f);
    expect(order(f, 2, { afterIds: [a] })).toMatchObject({ ok: true, changed: false, seq: null });
    expect(journal(f)).toBe(bytes);
  });
});

describe('replay after a database-only restore', () => {
  /** pr 1 and 2 created, pr 2 ordered behind 1 with the flag: three records, then the DB goes back to the start. */
  const history = () => {
    const f = boot();
    const snap0 = snapshot(f);
    const a = created(f, 1);
    const b = created(f, 2);
    order(f, 2, { afterIds: [a], fixesMain: true });
    return { f, snap0, a, b };
  };

  it('recovered subjects retain authority without fabricated projections', () => {
    const { f, snap0, a, b } = history();
    const r = restore(f, snap0);
    expect(count(r, 'landing_entries')).toBe(0);
    const got = facts(r);
    expect(got.entries).toEqual([]);
    expect(got.recovery.hold).toEqual({ reason: 'landing-recovery-unresolved', subjectIds: [a, b] });
    const two = got.recovery.subjects.find((s) => s.id === b)!;
    expect(two.authority).toEqual({ kind: 'set', value: { afterIds: [a], fixesMain: true, setBy: 'lane-b', seq: 3 } });
    expect(two.projection).toEqual({ kind: 'missing', association: 'unmeasured' });
    expect(landingOrder(got.entries, got.flags, got.recovery)).toMatchObject({ head: null, held: { subjectIds: [a, b] } });
  });

  it('missing-subject-is-visible-and-holds', () => {
    const { f, snap0, a, b } = history();
    const r = restore(f, snap0);
    expect(rec(r).subjects.map((s) => s.id)).toEqual([a, b]);
    expect(landingOrder(facts(r).entries, facts(r).flags, rec(r))).toMatchObject({ head: null });
  });

  it('replay-is-idempotent', () => {
    const { f, snap0 } = history();
    const r = restore(f, snap0);
    const snapshotOf = () => JSON.stringify([rows(r, 'SELECT * FROM landing_subjects'), rows(r, 'SELECT * FROM landing_authority'), cursor(r)]);
    const first = snapshotOf();
    expect(r.store.replayLandingJournal()).toEqual({ ok: true, applied: 0, lastSeq: 3 });
    expect(snapshotOf()).toBe(first);
  });

  it('whole-after-can-be-cleared', () => {
    const f = boot();
    const snap0 = snapshot(f);
    const a = created(f, 1); created(f, 2);
    order(f, 2, { afterIds: [a] });
    expect(order(f, 2, { afterIds: [] })).toMatchObject({ ok: true, entry: { afterIds: [] } });
    const r = restore(f, snap0);
    const two = rec(r).subjects.find((s) => s.pr === 2)!;
    expect(two.authority).toMatchObject({ kind: 'set', value: { afterIds: [], seq: 4 } });
  });

  it('whole-fixes-can-be-cleared', () => {
    const f = boot();
    const snap0 = snapshot(f);
    created(f, 1);
    order(f, 1, { fixesMain: true });
    expect(order(f, 1, { fixesMain: false })).toMatchObject({ ok: true, entry: { fixesMain: false } });
    const r = restore(f, snap0);
    expect(rec(r).subjects[0]!.authority).toMatchObject({ kind: 'set', value: { fixesMain: false, seq: 3 } });
  });

  it('bad-suffix-rolls-back-all-replay', () => {
    const { f, snap0 } = history();
    appendFileSync(f.log, '{"v":1,"seq":4,"kind":"nope"}\n');
    const r = restore(f, snap0, false);
    expect(r.store.replayLandingJournal()).toMatchObject({ ok: false, error: 'landing-journal-invalid', invalid: { reason: 'kind', record: 4 } });
    expect([count(r, 'landing_subjects'), count(r, 'landing_authority'), cursor(r)]).toEqual([0, 0, 0]);
  });

  it('missing-journal-with-cursor-refuses', () => {
    const f = boot();
    created(f, 1);
    rmSync(f.log);
    f.db.close();
    const again = boot(f.home, undefined, false);
    expect(again.store.replayLandingJournal()).toEqual({ ok: false, error: 'landing-journal-missing', recovery: 'replay' });
    expect(cursor(again)).toBe(1);
  });

  it('cursor-ahead-refuses', () => {
    const f = boot();
    created(f, 1); created(f, 2);
    writeFileSync(f.log, journal(f).split('\n')[0]! + '\n');
    f.db.close();
    const again = boot(f.home, undefined, false);
    expect(again.store.replayLandingJournal()).toEqual({ ok: false, error: 'landing-journal-cursor', recovery: 'replay' });
    expect(cursor(again)).toBe(2);
  });

  it('replay-never-creates-a-pin', () => {
    const { f, snap0 } = history();
    const r = restore(f, snap0);
    expect([count(r, 'landing_entries'), count(r, 'landing_projection_witness')]).toEqual([0, 0]);
  });

  it('replay-preserves-projection', () => {
    const f = boot();
    created(f, 1); created(f, 2);
    const snap = snapshot(f);
    order(f, 2, { afterIds: [1] });
    const r = restore(f, snap, false);
    const before = JSON.stringify(rows(r, 'SELECT * FROM landing_entries ORDER BY id'));
    expect(r.store.replayLandingJournal()).toEqual({ ok: true, applied: 1, lastSeq: 3 });
    expect(JSON.stringify(rows(r, 'SELECT * FROM landing_entries ORDER BY id'))).toBe(before);
    expect(facts(r).entries.find((e) => e.pr === 2)!.afterIds).toEqual([1]);
  });

  it('no-run-creation-then-unjournalled-binding', () => {
    const f = boot();
    const snap0 = snapshot(f);
    const id = created(f, 4);
    const r = restore(f, snap0);
    const subject = rec(r).subjects[0]!;
    expect(subject.creation).toMatchObject({ kind: 'recorded', seq: 1 });
    expect(subject.projection).toEqual({ kind: 'missing', association: 'unmeasured' });
    // a projection that reappears bound to a run is NOT proved by the historical no-run creation
    const run = openRun(r);
    rawProjection(r, id, 4, P, run);
    expect(rec(r).subjects[0]!.projection).toEqual({ kind: 'association-unmeasured', reason: 'historical-binding-mismatch' });
    expect(landingOrder(facts(r).entries, facts(r).flags, rec(r))).toMatchObject({ head: null });
  });

  it('projection identity conflict quarantines both projects', () => {
    const f = boot();
    const snap0 = snapshot(f);
    const id = created(f, 1);
    const r = restore(f, snap0);
    rawProjection(r, id, 5, Q);
    for (const project of [P, Q]) {
      const got = facts(r, project);
      expect(got.recovery.subjects).toMatchObject([{ id, project: P, pr: 1, projection: { kind: 'identity-conflict', conflicts: [{ id, project: Q, pr: 5 }] } }]);
      expect(landingOrder(got.entries, got.flags, got.recovery)).toMatchObject({ head: null, held: { subjectIds: [id] } });
    }
  });

  it('projection-conflict-is-recovery-not-malformed-history', () => {
    const f = boot();
    const snap0 = snapshot(f);
    const id = created(f, 1);
    const r = restore(f, snap0, false);
    rawProjection(r, id, 5, Q);
    expect(r.store.replayLandingJournal()).toEqual({ ok: true, applied: 1, lastSeq: 1 });
    expect(rec(r).hold).toEqual({ reason: 'landing-recovery-unresolved', subjectIds: [id] });
  });

  it('allocator-reserves-recovered-subject-ids', () => {
    const { f, snap0, b } = history();
    const r = restore(f, snap0);
    const next = create(r, 9);
    expect(next).toMatchObject({ ok: true });
    expect((next as { entry: { id: number } }).entry.id).toBeGreaterThan(b);
    expect(facts(r).nextId).toBe((next as { entry: { id: number } }).entry.id + 1);
  });

  it('recovered duplicates and unresolved sources refuse by their own word', () => {
    const { f, snap0, a } = history();
    const r = restore(f, snap0);
    expect(create(r, 1)).toEqual({ ok: false, error: 'landing-entry-exists' });
    expect(order(r, 1, { afterIds: [] })).toEqual({ ok: false, error: 'landing-recovery-unresolved' });
    rawProjection(r, a, 1);
    expect(order(r, 1, { afterIds: [] })).toMatchObject({ ok: true });
  });

  it('historical run reuse is not association recovery', () => {
    const f = boot();
    const run = openRun(f);
    const snap0 = snapshot(f);
    const a = created(f, 1);
    rawProjection(f, 40, 40, P, run);
    order(f, 1, { afterIds: [40] });
    const r = restore(f, snap0);
    const got = facts(r);
    expect(got.coordinators).toEqual([]);
    expect(got.recovery.subjects.map((s) => [s.id, s.projection.kind])).toEqual([[a, 'missing'], [40, 'missing']]);
    expect(rec(r).subjects.find((s) => s.id === 40)!.historical.binding).toEqual({ kind: 'run', observedRunId: run });
    expect(order(r, 40, { afterIds: [] })).toEqual({ ok: false, error: 'landing-recovery-unresolved' });
  });
});

describe('the fence and uncertain outcomes', () => {
  const allRefused = (f: Fx, run: number, merging: number): void => {
    const fenced = { ok: false, error: 'landing-fenced' };
    expect(f.store.readLanding(P)).toMatchObject(fenced);
    expect(create(f, 50)).toMatchObject(fenced);
    expect(order(f, 1, { fixesMain: true })).toMatchObject(fenced);
    const ev = events(f, run);
    expect(pinRun(f, run, 60)).toMatchObject(fenced);
    expect(runState(f, run)).toBe('awaiting-review');
    expect(events(f, run)).toBe(ev);
    const evm = events(f, merging);
    expect(f.store.advanceLanding({ runId: merging, to: 'working', causedBy: 'coordinator', landing: { kind: 'retreat', ejection: null } })).toMatchObject(fenced);
    expect(runState(f, merging)).toBe('merging');
    expect(events(f, merging)).toBe(evm);
  };
  const withRuns = () => {
    const f = boot();
    created(f, 1);
    const run = openRun(f, P, 1);
    const merging = openRun(f, P, 2);
    expect(pinRun(f, merging, 70)).toMatchObject({ ok: true });
    return { f, run, merging };
  };

  it('complete-append-failure-is-uncertain', () => {
    const { f } = withRuns();
    f.faults.append = { error: 'unwritable' };
    const before = [count(f, 'landing_subjects'), cursor(f)];
    expect(order(f, 1, { fixesMain: true })).toEqual({ ok: false, error: 'landing-journal-append', recovery: 'replay', mayApply: true });
    expect([count(f, 'landing_subjects'), cursor(f)]).toEqual(before);
  });

  it('append-failure-fences-all-entrances', () => {
    const { f, run, merging } = withRuns();
    f.faults.append = { error: 'durability' };
    expect(order(f, 1, { fixesMain: true })).toMatchObject({ ok: false, mayApply: true });
    allRefused(f, run, merging);
    expect(f.store.replayLandingJournal().ok).toBe(true);
    expect(f.store.readLanding(P).ok).toBe(true);
  });

  it('authority-commit-failure-is-uncertain', () => {
    const f = boot();
    failOnce(f.db, 'COMMIT');
    expect(create(f, 1)).toEqual({ ok: false, error: 'landing-db-commit', recovery: 'replay', mayApply: true });
    expect(lines(f)).toHaveLength(1);
    expect(count(f, 'landing_subjects')).toBe(0);
  });

  it('authority-commit-failure-fences-all-entrances', () => {
    const { f, run, merging } = withRuns();
    failOnce(f.db, 'COMMIT');
    expect(order(f, 1, { fixesMain: true })).toMatchObject({ ok: false, error: 'landing-db-commit', mayApply: true });
    vi.restoreAllMocks();
    allRefused(f, run, merging);
  });

  it('plain-nonlanding-needs-no-port', () => {
    const db = openCoordDb(path.join(mkTmp('ccrc-ljs-plain-'), '.ccrc', 'coord.db'));
    const store = new CoordStore(db);
    const o = store.openRun({ program: 'p', title: 't', project: P, wave: 1, waveOf: 1, claimedBy: 'coord-a' });
    if (!('id' in o)) throw new Error('openRun refused');
    store.setSession(o.id, 'project-a-ws1');
    store.advance(o.id, 'dispatched', 'test');
    expect(store.advanceLanding({ runId: o.id, to: 'working', causedBy: 'coordinator', landing: { kind: 'plain' } }))
      .toMatchObject({ ok: true, to: 'working', landing: { kind: 'none' } });
    store.advance(o.id, 'awaiting-review', 'test');
    expect(store.advanceLanding({ runId: o.id, to: 'merging', causedBy: 'coordinator', landing: pinOf(7) }))
      .toEqual({ ok: false, error: 'landing-journal-unavailable', recovery: 'restart' });
    expect(store.run(o.id)).toMatchObject({ ok: true, run: { state: 'awaiting-review' } });
  });

  it('plain-cannot-disguise-retreat', () => {
    const { f, merging } = withRuns();
    const ev = events(f, merging);
    expect(() => f.store.advanceLanding({ runId: merging, to: 'working', causedBy: 'coordinator', landing: { kind: 'plain' } })).toThrow(/does not pair/);
    expect(runState(f, merging)).toBe('merging');
    expect(events(f, merging)).toBe(ev);
  });

  it('pin-commit-failure-is-uncertain', () => {
    const f = boot();
    const run = openRun(f);
    const ev = events(f, run);
    const bytes = journal(f);
    failOnce(f.db, 'COMMIT');
    expect(pinRun(f, run, 7)).toEqual({ ok: false, error: 'landing-db-commit', recovery: 'replay', mayApply: true });
    vi.restoreAllMocks();
    expect(journal(f)).toBe(bytes);
    expect(runState(f, run)).toBe('awaiting-review');
    expect(events(f, run)).toBe(ev);
    expect(f.store.readLanding(P)).toMatchObject({ ok: false, error: 'landing-fenced' });
  });

  it('retreat-commit-failure-is-uncertain', () => {
    const { f, merging } = withRuns();
    failOnce(f.db, 'COMMIT');
    const r = f.store.advanceLanding({ runId: merging, to: 'working', causedBy: 'coordinator', landing: { kind: 'retreat', ejection: null } });
    expect(r).toEqual({ ok: false, error: 'landing-db-commit', recovery: 'replay', mayApply: true });
    vi.restoreAllMocks();
    expect(runState(f, merging)).toBe('merging');
    expect(f.store.readLanding(P)).toMatchObject({ ok: false, error: 'landing-fenced' });
  });

  it('uncertain-rollback-closes-shared-connection', () => {
    const f = boot();
    failOnce(f.db, 'COMMIT', 'ROLLBACK');
    const real = f.db.isTransaction;
    expect(real).toBe(false);
    expect(create(f, 1)).toEqual({ ok: false, error: 'landing-db-commit', recovery: 'restart', mayApply: true });
    expect(f.db.isOpen).toBe(false);
    expect(() => f.db.exec('SELECT 1')).toThrow();
    expect(f.store.readLanding(P)).toEqual({ ok: false, error: 'landing-fenced', recovery: 'restart' });
    expect(f.store.replayLandingJournal()).toEqual({ ok: false, error: 'landing-fenced', recovery: 'restart' });
    expect(f.unusable).not.toHaveBeenCalled();
  });

  it('unprovable-close-fails-stop', () => {
    const f = boot();
    failOnce(f.db, 'COMMIT', 'ROLLBACK');
    const real = f.db.close.bind(f.db);
    vi.spyOn(f.db, 'close').mockImplementation(() => { throw new Error('fixture close fault'); });
    expect(() => create(f, 1)).toThrow('fixture fail-stop');
    expect(f.unusable).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
    f.db.exec('ROLLBACK');
    real();
  });

  it('equal-cursor-reopen-confirms-durability', () => {
    const f = boot();
    created(f, 1);
    f.faults.append = { error: 'unwritable' };
    expect(create(f, 2)).toMatchObject({ ok: false, mayApply: true });
    f.faults.confirm = 'durability';
    expect(f.store.replayLandingJournal()).toEqual({ ok: false, error: 'landing-journal-durability', recovery: 'replay' });
    expect(f.store.readLanding(P)).toMatchObject({ ok: false, error: 'landing-fenced' });
    f.faults.confirm = null;
    expect(f.store.replayLandingJournal()).toEqual({ ok: true, applied: 0, lastSeq: 1 });
    expect(f.store.readLanding(P).ok).toBe(true);
  });
});

describe('the verified-pin witness and association recovery', () => {
  /** pr 1 created no-run (journal seq 1); a run then pins it: the projection reads run X and one witness binds it. */
  const pinnedOver = () => {
    const f = boot();
    const id = created(f, 1);
    const run = openRun(f);
    expect(pinRun(f, run, 1)).toMatchObject({ ok: true, landing: { kind: 'pinned', created: false } });
    return { f, id, run };
  };
  const witness = (f: Fx) => rows(f, 'SELECT * FROM landing_projection_witness');

  it('a verified pin writes one witness at the subject observation, and its mismatch is resolved', () => {
    const { f, id, run } = pinnedOver();
    expect(witness(f)).toEqual([{ entryId: id, project: P, pr: 1, observedSeq: 1, runId: run, pinnedSha: HEAD, handoffCommit: HC }]);
    expect(rec(f).hold).toBeNull();
    expect(facts(f).entries[0]).toMatchObject({ runId: run, afterIds: [], setBy: 'lane-a' });
  });

  it('exact identity does not resolve contradictory restored binding', () => {
    const f = boot();
    const id = created(f, 1);
    const run = openRun(f);
    f.db.prepare('UPDATE landing_entries SET runId = ? WHERE id = ?').run(run, id);
    expect(rec(f).subjects).toMatchObject([{ id, projection: { kind: 'association-unmeasured', reason: 'historical-binding-mismatch' } }]);
    const got = facts(f);
    expect(landingOrder(got.entries, got.flags, got.recovery)).toMatchObject({ head: null });
    expect(order(f, 1, { fixesMain: true })).toEqual({ ok: false, error: 'landing-recovery-unresolved' });
  });

  it('later journal observation invalidates restored witness', () => {
    const { f } = pinnedOver();
    const snap = snapshot(f);
    appendFileSync(f.log, JSON.stringify({ v: 1, seq: 2, at: 9, setBy: 'lane-b', subject: { id: 1, project: P, pr: 1, binding: { kind: 'no-run' } },
      kind: 'order', after: [], fixesMain: false }) + '\n');
    const r = restore(f, snap);
    expect(rec(r).hold).toEqual({ reason: 'landing-recovery-unresolved', subjectIds: [1] });
    expect(witness(r)).toHaveLength(1);
  });

  it('witness binds exact projection association', () => {
    const { f, run } = pinnedOver();
    f.db.prepare('UPDATE landing_projection_witness SET runId = ?').run(run + 1);
    expect(rec(f).hold).not.toBeNull();
  });

  it('witness binds exact pin head', () => {
    const { f } = pinnedOver();
    f.db.prepare('UPDATE landing_entries SET pinnedSha = ?').run(HEAD2);
    expect(rec(f).hold).not.toBeNull();
  });

  it('witness binds exact handoff', () => {
    const { f } = pinnedOver();
    f.db.prepare('UPDATE landing_entries SET handoffCommit = ?').run(HEAD2);
    expect(rec(f).hold).not.toBeNull();
  });

  it('replay-never-mints-witness', () => {
    const f = boot();
    const id = created(f, 1); created(f, 2);
    const snap = snapshot(f);
    order(f, 2, { afterIds: [id] });
    const r = restore(f, snap, false);
    r.db.prepare('UPDATE landing_entries SET runId = ? WHERE id = ?').run(openRun(r), id);
    expect(r.store.replayLandingJournal()).toMatchObject({ ok: true });
    expect(witness(r)).toEqual([]);
    expect(rec(r).subjects.map((s) => s.id)).toEqual([id]);
  });

  it('order-observation-is-not-verification', () => {
    const { f, id } = pinnedOver();
    const before = witness(f);
    expect(order(f, 1, { fixesMain: true })).toMatchObject({ ok: true });
    expect(witness(f)).toEqual(before);
    expect(rows(f, 'SELECT observedSeq, bindingKind FROM landing_subjects WHERE id = ' + id)).toEqual([{ observedSeq: 2, bindingKind: 'run' }]);
    expect(rec(f).hold).toBeNull();
  });

  it('fresh verified pin resolves own association mismatch', () => {
    const f = boot();
    const snap0 = snapshot(f);
    const one = created(f, 1);
    const two = created(f, 2);
    order(f, 1, { afterIds: [two], fixesMain: true });
    const r = restore(f, snap0);
    const stale = openRun(r, P, 1);
    rawProjection(r, one, 1, P, stale);
    expect(rec(r).subjects.map((s) => [s.id, s.projection.kind])).toEqual([[one, 'association-unmeasured'], [two, 'missing']]);
    const run = openRun(r, P, 2);
    const done = pinRun(r, run, 1, HEAD2);
    expect(done).toMatchObject({ ok: true, landing: { kind: 'pinned', created: false, entry: { id: one, runId: run, pinnedSha: HEAD2, afterIds: [two], fixesMain: true, setBy: 'lane-b' } } });
    expect(witness(r)).toEqual([{ entryId: one, project: P, pr: 1, observedSeq: 3, runId: run, pinnedSha: HEAD2, handoffCommit: HC }]);
    expect(r.store.currentEpisode(run)).toMatchObject({ head: HEAD2, pr: 1 });
    expect(rec(r).hold).toEqual({ reason: 'landing-recovery-unresolved', subjectIds: [two] });
  });

  it('failed pin cannot leave verification witness', () => {
    const { f, id, run } = pinnedOver();
    f.db.exec('DELETE FROM landing_projection_witness');
    const run2 = openRun(f, P, 2);
    f.db.exec("CREATE TRIGGER boom BEFORE INSERT ON landing_projection_witness BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    expect(pinRun(f, run2, 1, HEAD2)).toMatchObject({ ok: false, error: 'landing-db-apply', mayApply: true });
    f.db.exec('DROP TRIGGER boom');
    expect(witness(f)).toEqual([]);
    expect(rows(f, `SELECT runId, pinnedSha FROM landing_entries WHERE id = ${id}`)).toEqual([{ runId: run, pinnedSha: HEAD }]);
    expect(runState(f, run2)).toBe('awaiting-review');
  });

  it('conflict-has-no-materialization-exception', () => {
    const f = boot();
    const snap0 = snapshot(f);
    const id = created(f, 1);
    const r = restore(f, snap0);
    rawProjection(r, id, 5, Q);
    const run = openRun(r);
    const ev = events(r, run);
    const entries = count(r, 'landing_entries');
    expect(pinRun(r, run, 1)).toEqual({ ok: false, error: 'landing-identity-conflict' });
    expect(runState(r, run)).toBe('awaiting-review');
    expect([events(r, run), count(r, 'landing_entries'), count(r, 'landing_projection_witness')]).toEqual([ev, entries, 0]);
  });

  it('target-only-not-set-materializes-with-fresh-pin-defaults', () => {
    const f = boot();
    const snap0 = snapshot(f);
    rawProjection(f, 5, 9);
    const src = created(f, 2);
    expect(order(f, 2, { afterIds: [5] })).toMatchObject({ ok: true });
    const r = restore(f, snap0);
    expect(rec(r).subjects.find((s) => s.id === 5)).toMatchObject({ authority: { kind: 'not-set' }, creation: { kind: 'not-recorded' } });
    const run = openRun(r);
    const done = pinRun(r, run, 9, HEAD2);
    expect(done).toMatchObject({ ok: true, landing: { kind: 'pinned', created: true, entry: { id: 5, afterIds: [], fixesMain: false, setBy: 'coordinator', ejections: 0, runId: run } } });
    expect(rows(r, 'SELECT subjectId FROM landing_authority WHERE subjectId = 5')).toEqual([]);
    expect(rec(r).hold).toEqual({ reason: 'landing-recovery-unresolved', subjectIds: [src] });
    // an ordinary pin to an unrelated subject stays refused while the hold stands
    const other = openRun(r, P, 3);
    expect(pinRun(r, other, 77)).toEqual({ ok: false, error: 'landing-recovery-unresolved' });
  });

  it('recovery holds refuse every retreat', () => {
    const f = boot();
    const run = openRun(f);
    expect(pinRun(f, run, 3)).toMatchObject({ ok: true });
    const snap = snapshot(f);
    created(f, 4);
    const r = restore(f, snap);
    expect(rec(r).hold).not.toBeNull();
    const ev = events(r, run);
    expect(r.store.advanceLanding({ runId: run, to: 'working', causedBy: 'coordinator', landing: { kind: 'retreat', ejection: null } }))
      .toEqual({ ok: false, error: 'landing-recovery-unresolved' });
    expect([runState(r, run), events(r, run)]).toEqual(['merging', ev]);
  });

  it('allocator overflow refuses a creation without appending', () => {
    const f = boot();
    rawProjection(f, Number.MAX_SAFE_INTEGER, 1);
    const bytes = journal(f);
    expect(create(f, 2)).toEqual({ ok: false, error: 'landing-id-overflow' });
    expect(journal(f)).toBe(bytes);
  });
});
