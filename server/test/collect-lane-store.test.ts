// Child reclamation wave 10 (path-identity spec 2026-10-12 §5.2, §5.3, §5.9): the collector switch's row reader and its
// ONE writer. A fixture coord.db (mkTmp) and the real journal adapter at a fixture path, wrapped where a case must count
// or fail its calls. Never a live coord.db, never a journal resolved from the real HOME.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  appendFileSync, chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type CollectLaneWrite } from '../src/coord/store.js';
import { collectLaneJournalAt, defaultCollectLaneJournalPath } from '../src/coord/collectLaneJournal.js';
import {
  collectLaneControl, collectLaneEffective, measureCollectLaneRow,
  type CollectLaneControl, type CollectLaneJournal, type CollectLaneRowRead, type CollectLaneWriteRequest,
} from '../src/collectLane.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const AT = Date.parse('2026-10-12T12:00:00Z');
const NODE_A = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';
const NODE_B = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const ROOT_USER = process.getuid?.() === 0;

type Journal = CollectLaneJournal & { readonly logPath: string };
/** A store on a fresh fixture database, its file (for a second connection), its HOME and the journal beside it. */
const opened = (): { s: CoordStore; file: string; home: string; j: Journal } => {
  const home = mkTmp('ccrc-collect-lane-store-');
  const file = path.join(home, '.ccrc', 'coord.db');
  return { s: new CoordStore(openCoordDb(file)), file, home,
    j: collectLaneJournalAt(defaultCollectLaneJournalPath(path.join(home, '.ccrc'))) };
};
/** The row exactly as SQLite holds it, read without the store, every INTEGER as a bigint. */
const rawRow = (s: CoordStore): unknown => {
  const st = s.db.prepare('SELECT id, choice, fleetNodeId, markerRetiredAt, generation, updatedAt FROM collect_lane_settings');
  st.setReadBigInts(true);
  return st.all();
};
const SEED_READ: CollectLaneRowRead =
  { kind: 'row', row: { choice: 'off', fleetNodeId: null, markerRetiredAt: null, generation: 0n, updatedAt: 0n } };
const SEED_RAW = { id: 1n, choice: 'off', fleetNodeId: null, markerRetiredAt: null, generation: 0n, updatedAt: 0n };

/** Each request with its expectations taken NOW, from the store and the journal it will be written through. */
const live = (s: CoordStore, j: CollectLaneJournal, fleetNodeId: string): CollectLaneWriteRequest =>
  ({ kind: 'live', fleetNodeId, expected: s.collectLaneRow(), expectedJournal: j.read() });
const retire = (s: CoordStore, j: CollectLaneJournal): CollectLaneWriteRequest =>
  ({ kind: 'retire', expected: s.collectLaneRow(), expectedJournal: j.read() });
const OFF: CollectLaneWriteRequest = { kind: 'off' };

/** A journal that records each call into `log`, then delegates to `inner`, or throws `fail` from the append. */
const recorder = (inner: CollectLaneJournal, log: string[], o: { onAppend?: () => void; fail?: Error } = {}):
  CollectLaneJournal & { appends(): number } => ({
  read: () => { log.push('journal'); return inner.read(); },
  appendGeneration: (generation: number) => {
    log.push(`append:${generation}`);
    o.onAppend?.();
    if (o.fail !== undefined) throw o.fail;
    inner.appendGeneration(generation);
  },
  appends: () => log.filter((e) => e.startsWith('append:')).length,
});
const fileBytes = (p: string): Buffer | null => (existsSync(p) && lstatSync(p).isFile() ? readFileSync(p) : null);
/** Writes through a counting journal and proves the call consumed nothing: no append, the row and the journal file
 *  byte-identical. Returns the answer for the case's own assertion. */
const consumesNothing = (s: CoordStore, j: Journal, req: CollectLaneWriteRequest, at = AT): CollectLaneWrite => {
  const rowBefore = rawRow(s);
  const fileBefore = fileBytes(j.logPath);
  const rec = recorder(j, []);
  const w = s.setCollectLane(req, at, rec);
  expect(rec.appends(), 'a generation was appended').toBe(0);
  expect(rawRow(s)).toEqual(rowBefore);
  expect(fileBytes(j.logPath)).toEqual(fileBefore);
  return w;
};
const fsError = (message: string, code: unknown): Error => Object.assign(new Error(message), { code });
const controlOf = (s: CoordStore, j: CollectLaneJournal): CollectLaneControl =>
  collectLaneControl(measureCollectLaneRow(s.collectLaneRow()), j.read());

describe('collectLaneRow reads the row raw (path-identity spec 2026-10-12 §5.2)', () => {
  it('collectLaneRow reads every value raw: the seed as bigints, a deleted row as absent, a dropped table as unreadable, never a throw', () => {
    const { s } = opened();
    expect(s.collectLaneRow()).toEqual(SEED_READ);
    s.db.exec('UPDATE collect_lane_settings SET generation = 9223372036854775807');
    expect(s.collectLaneRow()).toMatchObject({ kind: 'row', row: { generation: 9223372036854775807n } });
    s.db.exec('DELETE FROM collect_lane_settings');
    expect(s.collectLaneRow()).toEqual({ kind: 'absent' });
    s.db.exec('DROP TABLE collect_lane_settings');
    const r = s.collectLaneRow();
    expect(r.kind).toBe('unreadable');
    expect(r.kind === 'unreadable' ? r.detail : '').toMatch(/no such table/);
  });
});

describe('setCollectLane: journal before database, one transaction (path-identity spec 2026-10-12 §5.2, §5.9)', () => {
  it('append observes the old row', () => {
    const { s, j } = opened();
    const seen: CollectLaneRowRead[] = [];
    const rec = recorder(j, [], { onAppend: () => { seen.push(s.collectLaneRow()); } });
    expect(s.setCollectLane(live(s, rec, NODE_A), AT, rec)).toMatchObject({ kind: 'written', generation: 1 });
    expect(seen).toEqual([SEED_READ]);
    expect(rawRow(s)).toEqual([{ id: 1n, choice: 'live', fleetNodeId: NODE_A, markerRetiredAt: null, generation: 1n,
      updatedAt: BigInt(AT) }]);
  });

  it('call order is row, journal, append, update', () => {
    const { s, j } = opened();
    const log: string[] = [];
    const rec = recorder(j, log);
    const req = live(s, rec, NODE_A);
    log.length = 0;
    const realRow = s.collectLaneRow.bind(s);
    const realPrepare = s.db.prepare.bind(s.db);
    const rowSpy = vi.spyOn(s, 'collectLaneRow').mockImplementation(() => { log.push('row'); return realRow(); });
    const prepareSpy = vi.spyOn(s.db, 'prepare').mockImplementation((sql: string) => {
      if (sql.startsWith('UPDATE collect_lane_settings')) log.push('update');
      return realPrepare(sql);
    });
    try {
      expect(s.setCollectLane(req, AT, rec).kind).toBe('written');
    } finally {
      rowSpy.mockRestore();
      prepareSpy.mockRestore();
    }
    // The last two are the post-commit re-read, the caller's proof.
    expect(log).toEqual(['row', 'journal', 'append:1', 'update', 'row', 'journal']);
  });

  it('bootstrap Live writes generation 1, with row and journal agreeing', () => {
    const { s, j } = opened();
    expect(s.setCollectLane(live(s, j, NODE_A), AT, j)).toEqual({
      kind: 'written', generation: 1, before: SEED_READ, journalBefore: { kind: 'missing' },
      after: { kind: 'row', row: { choice: 'live', fleetNodeId: NODE_A, markerRetiredAt: null, generation: 1n,
        updatedAt: BigInt(AT) } },
      journalAfter: { kind: 'ok', max: 1, records: 1 },
    });
    expect(readFileSync(j.logPath, 'utf8')).toBe('{"generation":1}\n');
    expect(controlOf(s, j)).toMatchObject({ kind: 'coherent', generation: 1, bootstrap: false });
  });

  it('written carries the journal read before the append as journalBefore', () => {
    const { s, j } = opened();
    expect(s.setCollectLane(live(s, j, NODE_A), AT, j))
      .toMatchObject({ kind: 'written', journalBefore: { kind: 'missing' }, journalAfter: { kind: 'ok', max: 1, records: 1 } });
    expect(s.setCollectLane(retire(s, j), AT + 1, j)).toMatchObject({ kind: 'written', generation: 2,
      journalBefore: { kind: 'ok', max: 1, records: 1 }, journalAfter: { kind: 'ok', max: 2, records: 2 } });
  });

  it('an append failure leaves the row unchanged and rolls back', () => {
    const { s, j } = opened();
    const rec = recorder(j, [], { fail: fsError('ENOSPC: no space left on device, write', 'ENOSPC') });
    expect(s.setCollectLane(live(s, rec, NODE_A), AT, rec)).toEqual({ kind: 'failed', phase: 'append', code: 'ENOSPC' });
    expect(rawRow(s)).toEqual([SEED_RAW]);
    expect(j.read()).toEqual({ kind: 'missing' });
    // Rolled back: the next write opens its own transaction.
    expect(s.setCollectLane(live(s, j, NODE_A), AT, j)).toMatchObject({ kind: 'written', generation: 1 });
  });

  it('a database failure after append leaves the journal ahead', () => {
    const { s, j } = opened();
    s.db.exec("CREATE TRIGGER cls_fail BEFORE UPDATE ON collect_lane_settings BEGIN SELECT RAISE(ABORT, 'injected'); END;");
    const w = s.setCollectLane(live(s, j, NODE_A), AT, j);
    expect(w).toMatchObject({ kind: 'failed', phase: 'update' });
    expect(w.kind === 'failed' ? w.code : '').toMatch(/^ERR_SQLITE_/);
    expect(rawRow(s)).toEqual([SEED_RAW]);
    expect(j.read()).toEqual({ kind: 'ok', max: 1, records: 1 });
    expect(controlOf(s, j)).toMatchObject({ kind: 'mismatch', journalMax: 1, rowGeneration: 0 });
  });

  it('a COMMIT failure leaves the journal ahead', () => {
    const { s, j } = opened();
    const req = live(s, j, NODE_A);
    const realExec = s.db.exec.bind(s.db);
    const spy = vi.spyOn(s.db, 'exec').mockImplementation((sql: string) => {
      if (sql === 'COMMIT') throw fsError('disk I/O error', 'ERR_SQLITE_ERROR');
      realExec(sql);
    });
    let w: CollectLaneWrite | undefined;
    try {
      w = s.setCollectLane(req, AT, j);
    } finally {
      spy.mockRestore();
    }
    expect(w).toEqual({ kind: 'failed', phase: 'commit', code: 'ERR_SQLITE_ERROR' });
    expect(rawRow(s)).toEqual([SEED_RAW]);
    expect(j.read()).toEqual({ kind: 'ok', max: 1, records: 1 });
    expect(controlOf(s, j)).toMatchObject({ kind: 'mismatch', journalMax: 1, rowGeneration: 0 });
  });

  it('conflict, marker-still-controls, state-unmeasurable and unchanged consume no generation and leave the row byte-identical', () => {
    const { s, file, j } = opened();
    // marker-still-controls: Off before the latch, on the bootstrap.
    expect(consumesNothing(s, j, OFF)).toMatchObject({ kind: 'refused', code: 'marker-still-controls' });
    expect(s.setCollectLane(live(s, j, NODE_A), AT, j)).toMatchObject({ kind: 'written', generation: 1 });
    // unchanged: the same Live again, with the row it found.
    const before = s.collectLaneRow();
    expect(consumesNothing(s, j, live(s, j, NODE_A), AT + 1)).toEqual({ kind: 'unchanged', before });
    // state-unmeasurable: a write at an instant below 1.
    expect(consumesNothing(s, j, live(s, j, NODE_B), 0)).toMatchObject({ kind: 'refused', code: 'state-unmeasurable' });
    // conflict: the row changed after the expectation was taken (a hand edit that moves only updatedAt).
    const staleRow = live(s, j, NODE_B);
    const other = new DatabaseSync(file);
    other.exec('UPDATE collect_lane_settings SET updatedAt = 5');
    other.close();
    expect(consumesNothing(s, j, staleRow)).toMatchObject({ kind: 'refused', code: 'conflict' });
    // conflict: the journal changed after the expectation was taken.
    const staleJournal = live(s, j, NODE_B);
    appendFileSync(j.logPath, '{"generation":2}\n');
    expect(consumesNothing(s, j, staleJournal)).toMatchObject({ kind: 'refused', code: 'conflict' });
  });

  it('Off wins over a stale Live, clears the node and keeps the latch', () => {
    const { s, j } = opened();
    expect(s.setCollectLane(retire(s, j), AT, j)).toMatchObject({ kind: 'written', generation: 1 });
    expect(s.setCollectLane(live(s, j, NODE_A), AT + 1, j)).toMatchObject({ kind: 'written', generation: 2 });
    const staleLive = live(s, j, NODE_B);
    expect(s.setCollectLane(OFF, AT + 2, j)).toMatchObject({ kind: 'written', generation: 3 });
    expect(consumesNothing(s, j, staleLive, AT + 3)).toMatchObject({ kind: 'refused', code: 'conflict' });
    expect(rawRow(s)).toEqual([{ id: 1n, choice: 'off', fleetNodeId: null, markerRetiredAt: BigInt(AT), generation: 3n,
      updatedAt: BigInt(AT + 2) }]);
    expect(j.read()).toEqual({ kind: 'ok', max: 3, records: 3 });
  });

  it.each([
    ['ahead: journal 7, row 1', 'off'], ['ahead: journal 7, row 1', 'live'],
    ['behind: journal 4, row 5', 'off'], ['behind: journal 4, row 5', 'live'],
  ] as const)('repair from either direction allocates above both maxima (%s; %s)', (dir, choice) => {
    const { s, j } = opened();
    expect(s.setCollectLane(retire(s, j), AT, j)).toMatchObject({ kind: 'written', generation: 1 });   // the latch: Off may repair
    const ahead = dir.startsWith('ahead');
    if (ahead) {
      appendFileSync(j.logPath, '{"generation":7}\n');
    } else {
      appendFileSync(j.logPath, '{"generation":4}\n');
      s.db.exec('UPDATE collect_lane_settings SET generation = 5');
    }
    const want = ahead ? 8 : 6;
    expect(controlOf(s, j)).toMatchObject({ kind: 'mismatch' });
    const req = choice === 'off' ? OFF : live(s, j, NODE_A);
    expect(s.setCollectLane(req, AT + 1, j)).toMatchObject({ kind: 'written', generation: want });
    expect(j.read()).toMatchObject({ kind: 'ok', max: want });
    expect(controlOf(s, j)).toMatchObject({ kind: 'coherent', generation: want });
  });

  it.each(['malformed', 'not-regular'] as const)('a malformed or not-regular journal refuses every request with no append (%s)', (fault) => {
    for (const kind of ['live', 'off', 'retire'] as const) {
      const { s, j } = opened();
      mkdirSync(path.dirname(j.logPath), { recursive: true });
      if (fault === 'malformed') writeFileSync(j.logPath, '{"generation":1}\n{"generation":');
      else mkdirSync(j.logPath);
      // Off is asked over a latched row, so its answer cannot be marker-still-controls.
      if (kind === 'off') s.db.exec(`UPDATE collect_lane_settings SET markerRetiredAt = ${AT}, generation = 1, updatedAt = ${AT}`);
      const req = kind === 'live' ? live(s, j, NODE_A) : kind === 'off' ? OFF : retire(s, j);
      expect(consumesNothing(s, j, req), kind).toMatchObject({ kind: 'refused', code: 'state-unmeasurable' });
    }
  });

  it('retire never heals', () => {
    // Ahead: a journal at 3 beside the seed.
    const a = opened();
    mkdirSync(path.dirname(a.j.logPath), { recursive: true });
    writeFileSync(a.j.logPath, '{"generation":3}\n');
    expect(consumesNothing(a.s, a.j, retire(a.s, a.j))).toMatchObject({ kind: 'refused', code: 'not-coherent' });
    // Behind: a row at 2 beside a journal at 1.
    const b = opened();
    mkdirSync(path.dirname(b.j.logPath), { recursive: true });
    writeFileSync(b.j.logPath, '{"generation":1}\n');
    b.s.db.exec('UPDATE collect_lane_settings SET generation = 2, updatedAt = 1');
    expect(consumesNothing(b.s, b.j, retire(b.s, b.j))).toMatchObject({ kind: 'refused', code: 'not-coherent' });
    // Coherent and unset: the latch at `at`, the choice and the node kept.
    const c = opened();
    expect(c.s.setCollectLane(live(c.s, c.j, NODE_A), AT, c.j)).toMatchObject({ kind: 'written', generation: 1 });
    expect(c.s.setCollectLane(retire(c.s, c.j), AT + 5, c.j)).toMatchObject({ kind: 'written', generation: 2 });
    expect(rawRow(c.s)).toEqual([{ id: 1n, choice: 'live', fleetNodeId: NODE_A, markerRetiredAt: BigInt(AT + 5),
      generation: 2n, updatedAt: BigInt(AT + 5) }]);
    // Set: unchanged.
    expect(consumesNothing(c.s, c.j, retire(c.s, c.j), AT + 9)).toEqual({ kind: 'unchanged', before: c.s.collectLaneRow() });
  });

  it('an absent row refuses everything and nothing is inserted', () => {
    const { s, j } = opened();
    s.db.exec('DELETE FROM collect_lane_settings');
    for (const req of [live(s, j, NODE_A), OFF, retire(s, j)]) {
      expect(consumesNothing(s, j, req), req.kind).toMatchObject({ kind: 'refused', code: 'state-unmeasurable' });
    }
    expect(rawRow(s)).toEqual([]);
    expect(j.read()).toEqual({ kind: 'missing' });
  });

  it('failed.code is an errno word, never a path', () => {
    const { s, home, j } = opened();
    const named = fsError(`EACCES: permission denied, open '${j.logPath}'`, 'EACCES');
    const w = s.setCollectLane(live(s, j, NODE_A), AT, recorder(j, [], { fail: named }));
    expect(w).toEqual({ kind: 'failed', phase: 'append', code: 'EACCES' });
    expect(JSON.stringify(w)).not.toContain(home);
    const wordless = fsError(`a failure at ${j.logPath}`, 42);
    expect(s.setCollectLane(live(s, j, NODE_A), AT, recorder(j, [], { fail: wordless })))
      .toEqual({ kind: 'failed', phase: 'append', code: 'UNKNOWN' });
    if (!ROOT_USER) {
      // The real adapter, in a directory it cannot create the journal in: Node's message names the path; the answer does not.
      const roHome = mkTmp('ccrc-collect-lane-ro-');
      const roDir = path.join(roHome, 'ro');
      mkdirSync(roDir);
      chmodSync(roDir, 0o500);
      try {
        const ro = collectLaneJournalAt(defaultCollectLaneJournalPath(roDir));
        const wr = s.setCollectLane(live(s, ro, NODE_A), AT, ro);
        expect(wr).toEqual({ kind: 'failed', phase: 'append', code: 'EACCES' });
        expect(JSON.stringify(wr)).not.toContain(roHome);
      } finally {
        chmodSync(roDir, 0o700);
      }
    }
    expect(rawRow(s)).toEqual([SEED_RAW]);
  });

  it('a defect before the append propagates as itself, never as a failed answer', () => {
    const { s, j } = opened();
    const broken: CollectLaneJournal = {
      read: () => { throw new Error('a journal read must never throw'); },
      appendGeneration: (g: number) => j.appendGeneration(g),
    };
    expect(() => s.setCollectLane(OFF, AT, broken)).toThrow('a journal read must never throw');
    const spy = vi.spyOn(s, 'collectLaneRow').mockImplementation(() => { throw new Error('a row read must never throw'); });
    try {
      expect(() => s.setCollectLane(OFF, AT, j)).toThrow('a row read must never throw');
    } finally {
      spy.mockRestore();
    }
    expect(rawRow(s)).toEqual([SEED_RAW]);
    // Rolled back: the next write opens its own transaction.
    expect(s.setCollectLane(retire(s, j), AT, j)).toMatchObject({ kind: 'written', generation: 1 });
  });
});

describe('snapshots (path-identity spec 2026-10-12 §5.3, §5.9)', () => {
  const NODE_NOW = { kind: 'known', connectionEpoch: 1, nodeId: NODE_A, measuredAt: AT } as const;
  const effective = (control: CollectLaneControl, marker: boolean) => collectLaneEffective({
    switches: { paused: false, marker }, epoch: { before: 1, after: 1 }, caps: { collect: true, reclaimPause: true },
    control, node: NODE_NOW,
  });
  /** A `VACUUM INTO` copy of the database as it stands: the backup's own mechanism (backup-coord.mjs). */
  const snapshot = (s: CoordStore): string => {
    const p = path.join(mkTmp('ccrc-collect-lane-snap-'), 'coord.db');
    s.db.prepare('VACUUM INTO ?').run(p);
    return p;
  };
  const restored = (p: string): CoordStore => new CoordStore(openCoordDb(p));

  it('a stale same-node Live snapshot is stopped by the later journal', () => {
    const { s, j } = opened();
    expect(s.setCollectLane(retire(s, j), AT, j)).toMatchObject({ kind: 'written', generation: 1 });
    expect(s.setCollectLane(live(s, j, NODE_A), AT + 1, j)).toMatchObject({ kind: 'written', generation: 2 });
    const snap = snapshot(s);
    expect(s.setCollectLane(OFF, AT + 2, j)).toMatchObject({ kind: 'written', generation: 3 });
    expect(effective(controlOf(s, j), false), 'CONTROL: the live database is Off').toMatchObject({ kind: 'shadowed', why: 'off' });
    const old = restored(snap);
    expect(old.collectLaneRow()).toMatchObject({ kind: 'row', row: { choice: 'live', fleetNodeId: NODE_A, generation: 2n } });
    expect(controlOf(old, j)).toMatchObject({ kind: 'mismatch', journalMax: 3, rowGeneration: 2 });
    expect(effective(controlOf(old, j), false)).toEqual({ kind: 'safety-stopped', why: 'generation-mismatch' });
  });

  it('a pre-latch snapshot cannot revive the marker', () => {
    const { s, j } = opened();
    const snap = snapshot(s);
    expect(s.setCollectLane(retire(s, j), AT, j)).toMatchObject({ kind: 'written', generation: 1 });
    expect(effective(controlOf(s, j), true), 'CONTROL: after the latch a re-created marker is ignored')
      .toMatchObject({ kind: 'shadowed', why: 'off', notes: { markerRecreated: true } });
    const old = restored(snap);
    const noJournal = collectLaneJournalAt(defaultCollectLaneJournalPath(path.join(mkTmp('ccrc-collect-lane-none-'), '.ccrc')));
    expect(effective(controlOf(old, noJournal), true), 'CONTROL: the same snapshot with no journal is the bootstrap, live by the file')
      .toMatchObject({ kind: 'live', armedBy: 'legacy-marker' });
    expect(controlOf(old, j)).toMatchObject({ kind: 'mismatch', journalMax: 1, rowGeneration: 0 });
    expect(effective(controlOf(old, j), true)).toEqual({ kind: 'safety-stopped', why: 'generation-mismatch' });
  });

  it('restoring both files to one older point is coherent: the stated whole-state boundary', () => {
    // Spec §5.3: "Restore both database and journal to the same older point | The older pair is coherent; this design
    // cannot detect a whole-state rollback." Pinned so the boundary is measured, not claimed: after such a restore the
    // operator raises the cleanup pause and makes a fresh confirmed Settings transition before allowing Live.
    const { s, j } = opened();
    expect(s.setCollectLane(retire(s, j), AT, j)).toMatchObject({ kind: 'written', generation: 1 });
    expect(s.setCollectLane(live(s, j, NODE_A), AT + 1, j)).toMatchObject({ kind: 'written', generation: 2 });
    const snap = snapshot(s);
    const kept = defaultCollectLaneJournalPath(path.join(mkTmp('ccrc-collect-lane-kept-'), '.ccrc'));
    mkdirSync(path.dirname(kept), { recursive: true });
    copyFileSync(j.logPath, kept);
    expect(s.setCollectLane(OFF, AT + 2, j)).toMatchObject({ kind: 'written', generation: 3 });
    const old = restored(snap);
    const oldJournal = collectLaneJournalAt(kept);
    expect(controlOf(old, oldJournal)).toMatchObject({ kind: 'coherent', generation: 2 });
    expect(effective(controlOf(old, oldJournal), false)).toMatchObject({ kind: 'live', armedBy: 'settings' });
  });
});
