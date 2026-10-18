// server/test/history-export.test.ts — the sole-copy export (spec
// docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md §9.15, §9.2 step 6), W1-B4. Two ways in:
//   - sweep.mjs's exportPass (and, from Task 6, exportStep), imported in-process against a REAL store that real
//     scheduled passes ingested, where a case needs a clock, a budget or a statfs answer of its own: injected
//     dependencies, never a variable the shipped code reads (slug history-test-seams-not-env);
//   - the real sweep as the timer runs it (runSweep, and the run-pass driver runDriver where a case needs the pass clock
//     past the store's first hour), with the test-only preloads for faults.
// Every store lives in a mkTmp fixture HOME (makeHistoryBox); nothing reads or writes the live ~/.ccrc, and each test's
// fixture HOMEs are removed when it ends (removeTmpFixturesEachTest).
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  makeHistoryBox, runSweep, skipOnDarwin, openStoreRO, counters, journalRecords, plantSession, plantTranscript,
  exportDirOf, segmentsOf, segmentRows, type HistoryBox,
} from './historyHelpers.js';
import { userRow } from './historyFixtures.js';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';
import { EXPORT_ROW_META_BYTES, HEALTH_META, historyPaths } from '../../ccd/history/lib.mjs';
import { closeWriter, openSegment, openWriter, pruneDryRun, segmentMeta, setMeta } from '../../ccd/history/store.mjs';

skipOnDarwin();
removeTmpFixturesEachTest();

const ID = 'claude-demo';
const G = '0189abcd-1234-4678-9abc-0123456789ab';
const U = '6f1c2e3a-0b4d-4c5e-8f60-718293a4b5c6';
const SLUG = '-home-u-tree-demo';
const WORK = '/home/u/tree/demo';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const GIB = 1024 ** 3;
const TIB = 1024 ** 4;
/** A row uuid from a small number (the UUID grammar, readable in a failure). */
const rid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** One typed prompt of session U, its timestamp `agoMs` before now. */
const row = (n: number, text: string, agoMs: number): Record<string, unknown> =>
  userRow({ uuid: rid(n), ts: new Date(Date.now() - agoMs).toISOString(), text, sessionId: U, cwd: WORK });

interface PassResult { state: string; segment: string | null; rows: number; blobs: number; bytes: number; complete: boolean }
/** The slice of sweep.mjs these tests call. It grows task by task; every member is a real export. */
interface SweepExport {
  exportPass(db: DatabaseSync, ctx: Record<string, unknown>): Promise<PassResult>;
  newBudget(now?: () => number, limits?: { maxMs?: number; maxBytes?: number; chunkBytes?: number }): Record<string, unknown>;
}
let SW: SweepExport;
beforeAll(async () => { SW = (await import('../../ccd/history/sweep.mjs')) as unknown as SweepExport; });

/** One scheduled pass that must exit 0. */
const pass = (box: HistoryBox): void => {
  const r = runSweep(box);
  expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
};
/** A box whose registry names session U of `claude-demo`, its transcript planted under claude-a and ingested by
 *  `passes` scheduled passes (the first may only create the store). `plant` runs before the passes. Every pass here
 *  runs in the store's first hour, so once the tick holds the export (Task 6) none of them exports. */
function ingestedBox(prefix: string, rows: object[], o: { passes?: number; plant?: (box: HistoryBox) => void } = {}):
  { box: HistoryBox; transcript: string; ids: { storeId: string; writer: string } } {
  const box = makeHistoryBox(prefix);
  plantSession(box, ID, { uuid: U, generation: G, project: 'demo', workdir: WORK });
  const transcript = plantTranscript(box, 'claude-a', SLUG, U, rows);
  o.plant?.(box);
  for (let i = 0; i < (o.passes ?? 2); i += 1) pass(box);
  const P = historyPaths(box.home);
  return { box, transcript, ids: { storeId: fs.readFileSync(P.storeId, 'utf8').trim(), writer: fs.readFileSync(P.writer, 'utf8').trim() } };
}
/** What exportPass (and exportStep) read of a TickCtx, passCtx's names, built in-process. `now` is the pass clock and
 *  the run budget's; `deps` the injected dependencies (Task 6's statfs); `limits` the run budget's. */
const exportCtx = (box: HistoryBox, ids: { storeId: string; writer: string }, now: () => number = () => Date.now(),
  o: { deps?: Record<string, unknown>; limits?: { maxMs?: number; maxBytes?: number }; homes?: string[] } = {}): Record<string, unknown> => ({
  home: box.home, paths: historyPaths(box.home), ids, now, out: () => {}, deps: o.deps ?? {},
  homes: o.homes ?? box.homes, rosterUnreadable: false,
  parsed: { secrets: [], homes: o.homes ?? box.homes, rosterUnreadable: false },
  budget: SW.newBudget(now, o.limits ?? {}),
});
/** `fn` on a writer handle of the box's store, closed when it settles. */
async function onStore<T>(box: HistoryBox, fn: (db: DatabaseSync) => T | Promise<T>): Promise<T> {
  const db = openWriter(historyPaths(box.home).dbFile);
  try { return await fn(db); } finally { closeWriter(db); }
}
/** A row with its integers as numbers when safe (bigint otherwise) and its BLOBs as lowercase hex: segmentRows' rule,
 *  so the store's rows and a segment's compare directly. */
const plain = (r: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(r).map(([k, v]) => [k,
  typeof v === 'bigint' && v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v)
    : v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v]));
/** One query on the box's store, read-only. */
const q = (box: HistoryBox, sql: string, ...args: Array<string | number>): Array<Record<string, unknown>> => {
  const db = openStoreRO(box);
  try {
    const st = db.prepare(sql);
    st.setReadBigInts(true);
    return (st.all(...args) as Array<Record<string, unknown>>).map(plain);
  } finally {
    db.close();
  }
};
const metaOf = (box: HistoryBox, k: string): string | null => {
  const r = q(box, 'SELECT v FROM meta WHERE k = ?', k);
  return r.length === 0 ? null : String(r[0]!['v']);
};
/** Every entry's exported_seg (null when unmarked), by uuid. */
const marks = (box: HistoryBox): Record<string, unknown> =>
  Object.fromEntries(q(box, 'SELECT uuid, exported_seg FROM entries ORDER BY uuid').map((r) => [String(r['uuid']), r['exported_seg'] ?? null]));
const pick = (keys: readonly string[]) => (r: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(keys.map((k) => [k, r[k]]));
const byUuid = (a: Record<string, unknown>, b: Record<string, unknown>): number => {
  const x = String(a['uuid']); const y = String(b['uuid']);
  return x < y ? -1 : x > y ? 1 : 0;
};

describe('the export pass, in-process (W1-B4 Task 5; spec §9.15 "What is due", "The pass")', () => {
  it('O39: due rows go into ONE segment with their blobs as stored, their named columns, the family, epoch and transcript rows that place them and their memberships by file identity; the marks come after the link; nothing is journaled; a second pass writes nothing new', async () => {
    const { box, transcript, ids } = ingestedBox('ccrc-history-export-o39-', [
      row(1, 'first prompt', 3 * DAY), row(2, 'second prompt', 2 * DAY), row(3, 'third prompt', DAY),
    ]);
    const NOW = Date.now();
    const name = `1.${ids.writer}.db`;
    const journal = journalRecords(box);
    const before = await onStore(box, (db) => pruneDryRun(db, NOW + DAY));
    expect(before, 'every row is a prune candidate and none is exported yet').toEqual({ blobs: 3, bytes: before.bytes, exported: 0 });

    const r = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, () => NOW)));
    expect(r).toEqual({ state: 'written', segment: name, rows: 3, blobs: 3, bytes: r.bytes, complete: true });
    expect(r.bytes).toBeGreaterThan(0);
    expect(segmentsOf(box), 'one segment, under its name, and no temp left').toEqual([name]);
    const seg = path.join(exportDirOf(box), name);
    expect(fs.statSync(seg).mode & 0o777).toBe(0o600);
    const h = openSegment(seg);
    try {
      // the fixture homes carry no cleanupPeriodDays: 30 days, horizon 0, so the cutoff is the pass's clock
      expect(segmentMeta(h)).toEqual({ storeId: ids.storeId, writer: ids.writer, seq: 1, harnesses: ['claude-code'], cutoffMs: NOW, format: 1 });
    } finally {
      h.close();
    }

    // the blobs, as stored, each marked with this segment AFTER the link
    const blobs = q(box, 'SELECT sha256, codec, raw_len, z, exported_ms, exported_seg FROM blobs ORDER BY sha256');
    expect(blobs.map(pick(['exported_ms', 'exported_seg']))).toEqual(blobs.map(() => ({ exported_ms: NOW, exported_seg: name })));
    expect(segmentRows(seg, 'blobs').map(pick(['sha256', 'codec', 'raw_len', 'z', 'pruned']))
      .sort((a, b) => (String(a['sha256']) < String(b['sha256']) ? -1 : 1)))
      .toEqual(blobs.map((b) => ({ sha256: b['sha256'], codec: b['codec'], raw_len: b['raw_len'], z: b['z'], pruned: 0 })));

    // every referrer's named columns, its blob by sha256, its transcript by natural key
    const cols = ['uuid', 'type', 'subtype', 'role', 'model', 'parent_uuid', 'ts_ms', 'request_id', 'api_block_index', 'msg_id',
      'source_tool_use_id', 'tool_name', 'is_compact_summary', 'provenance', 'prov_version', 'parse_state'];
    const stored = q(box, `SELECT ${cols.map((c) => `e.${c}`).join(', ')}, lower(hex(b.sha256)) AS blob_sha256, e.exported_ms,
      e.exported_seg FROM entries e JOIN blobs b ON b.blob_id = e.blob_id ORDER BY e.uuid`);
    expect(stored.map(pick(['exported_ms', 'exported_seg']))).toEqual(stored.map(() => ({ exported_ms: NOW, exported_seg: name })));
    const segEntries = segmentRows(seg, 'entries').sort(byUuid);
    expect(segEntries.map(pick([...cols, 'blob_sha256']))).toEqual(stored.map(pick([...cols, 'blob_sha256'])));
    expect(segEntries.map(pick(['cc_session_uuid', 'agent_id']))).toEqual(stored.map(() => ({ cc_session_uuid: U, agent_id: '' })));

    // the rows that place them: the family's natural key and project, the transcript, every epoch naming it
    expect(segmentRows(seg, 'families').map(pick(['ccrc_id', 'generation', 'project']))).toEqual([{ ccrc_id: ID, generation: G, project: 'demo' }]);
    expect(segmentRows(seg, 'transcripts').map(pick(['cc_session_uuid', 'agent_id', 'harness'])))
      .toEqual([{ cc_session_uuid: U, agent_id: '', harness: 'claude-code' }]);
    expect(segmentRows(seg, 'epochs').map(pick(['ccrc_id', 'generation', 'seq', 'cc_session_uuid', 'cause', 'declared_by', 'cwd'])))
      .toEqual(q(box, `SELECT s.ccrc_id, s.generation, e.seq, e.cc_session_uuid, e.cause, e.declared_by, e.cwd
        FROM epochs e JOIN sessions s ON s.session_pk = e.session_pk ORDER BY s.ccrc_id, s.generation, e.seq`));

    // memberships by (path, dev, ino, line): the identity the store measured, which is the file's as it stats now
    const st = fs.statSync(transcript, { bigint: true });
    const copies = q(box, `SELECT p.path, f.dev, f.ino, e.uuid, m.line FROM memberships m JOIN ingest_files f ON f.file_id = m.file_id
      JOIN file_paths p ON p.file_id = f.file_id JOIN entries e ON e.entry_id = m.entry_id ORDER BY e.uuid`);
    expect(copies.map((c) => [c['dev'], c['ino']])).toEqual(copies.map(() => [Number(st.dev), Number(st.ino)]));
    expect(segmentRows(seg, 'memberships').map(pick(['path', 'dev', 'ino', 'uuid', 'line'])).sort(byUuid)).toEqual(copies);
    expect(segmentRows(seg, 'files').map(pick(['path', 'dev', 'ino', 'cc_session_uuid', 'agent_id'])))
      .toEqual([{ path: copies[0]!['path'], dev: Number(st.dev), ino: Number(st.ino), cc_session_uuid: U, agent_id: '' }]);

    // the pass journals nothing; prune now counts what the export holds and touches none of it (§6.6)
    expect(journalRecords(box)).toEqual(journal);
    expect(await onStore(box, (db) => pruneDryRun(db, NOW + DAY))).toEqual({ ...before, exported: 3 });
    expect(metaOf(box, HEALTH_META.exportPassMs)).toBe(String(NOW));
    expect(metaOf(box, 'export_seq')).toBe('1');

    // a second pass: nothing is due that is not already exported
    const again = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, () => NOW + HOUR)));
    expect(again).toEqual({ state: 'nothing-due', segment: null, rows: 0, blobs: 0, bytes: 0, complete: true });
    expect(segmentsOf(box)).toEqual([name]);
    expect(metaOf(box, HEALTH_META.exportPassMs), 'a pass that finds nothing is still a pass').toBe(String(NOW + HOUR));
  }, 120_000);

  it('O39 / BK12: a hot blob with a young referrer — the due old rows are exported with the blob\'s bytes and the blob is marked; the young row waits', async () => {
    // Under the per-copy rule (B2's D-4735 (history-export-due-per-copy)) every row of one transcript shares its files' clock, so
    // the young referrer is a second session's row, in a transcript under claude-b, a home measured below at 180 days
    // (due 150 days after its file's last write). Session U's transcript sits under claude-a, on the 30-day default:
    // its rows are due from its file's last write, which is before this pass.
    const U2 = '7d2e3f4a-5b6c-4d7e-8f90-a1b2c3d4e5f6';
    const { box, ids } = ingestedBox('ccrc-history-export-hot-', [
      row(1, 'the same prompt', 40 * DAY), row(2, 'an old prompt of its own', 40 * DAY),
    ], {
      plant: (b) => {
        plantSession(b, 'claude-b-demo', { uuid: U2, generation: '0189abcd-1234-4678-9abc-0123456789ac', project: 'demo', workdir: WORK });
        plantTranscript(b, 'claude-b', SLUG, U2,
          [userRow({ uuid: rid(3), ts: new Date(Date.now() - DAY).toISOString(), text: 'the same prompt', sessionId: U2, cwd: WORK })]);
      },
    });
    const shaOf = (n: number): unknown =>
      q(box, 'SELECT lower(hex(b.sha256)) AS sha FROM entries e JOIN blobs b ON b.blob_id = e.blob_id WHERE e.uuid = ?', rid(n))[0]?.['sha'];
    expect(shaOf(3), 'the fixture must make one blob of the two sessions\' same prompt').toBe(shaOf(1));
    const name = `1.${ids.writer}.db`;
    const r = await onStore(box, (db) => {
      setMeta(db, `retention:${box.accountHome['claude-b']!}`, '180');   // claude-b measured at 180 days: its copy waits 150 days
      return SW.exportPass(db, exportCtx(box, ids));
    });
    expect(r).toMatchObject({ state: 'written', segment: name, rows: 2, blobs: 2 });
    expect(marks(box)).toEqual({ [rid(1)]: name, [rid(2)]: name, [rid(3)]: null });
    const hot = q(box, 'SELECT lower(hex(b.sha256)) AS sha, b.exported_seg FROM entries e JOIN blobs b ON b.blob_id = e.blob_id WHERE e.uuid = ?', rid(3))[0]!;
    expect(hot['exported_seg'], 'the young referrer\'s blob travelled with the old row').toBe(name);
    const seg = path.join(exportDirOf(box), name);
    expect(segmentRows(seg, 'blobs').map((b) => b['sha256'])).toContain(hot['sha']);
    expect(segmentRows(seg, 'entries').map((e) => e['uuid']).sort()).toEqual([rid(1), rid(2)]);
  }, 120_000);

  it('Q15, per copy: a 30-day home that holds only a swap copy brings nothing forward, because the 180-day home\'s copy holds every row back; once that copy is gone from disk the 30-day copy alone decides, and the rows go', async () => {
    const rows = [row(1, 'one', 2 * DAY), row(2, 'two', DAY)];
    const { box, transcript, ids } = ingestedBox('ccrc-history-export-swap-', rows, {
      // the swap copy: the same transcript under claude-b, a home that keeps Claude Code's 30-day default
      plant: (b) => { plantTranscript(b, 'claude-b', SLUG, U, rows); },
    });
    expect(q(box, 'SELECT count(*) AS n FROM ingest_files')[0]!['n'], 'the fixture must hold two copies').toBe(2);
    expect(q(box, 'SELECT count(*) AS n FROM transcripts')[0]!['n'], 'of ONE transcript').toBe(1);
    const r = await onStore(box, (db) => {
      setMeta(db, `retention:${box.accountHome['claude-a']!}`, '180');   // claude-a measured at 180 days: its copy waits 150 days
      return SW.exportPass(db, exportCtx(box, ids));
    });
    expect(r, 'the node-shortest rule would have exported both rows now').toEqual({ state: 'nothing-due', segment: null, rows: 0, blobs: 0, bytes: 0, complete: true });
    expect(segmentsOf(box)).toEqual([]);
    expect(marks(box)).toEqual({ [rid(1)]: null, [rid(2)]: null });
    fs.rmSync(transcript);   // claude-a's copy gone from disk: it has passed its due date (§9.15 "A file's due date")
    const next = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids)));
    expect(next).toMatchObject({ state: 'written', segment: `1.${ids.writer}.db`, rows: 2, complete: true });
    expect(marks(box)).toEqual({ [rid(1)]: `1.${ids.writer}.db`, [rid(2)]: `1.${ids.writer}.db` });
  }, 120_000);

  it('per copy: a transcript whose every holding file is gone has its rows taken whatever their own time, though the ts prefilter (the shortest home\'s horizon) would pass over them: that text may already be the store\'s only copy', async () => {
    const { box, transcript, ids } = ingestedBox('ccrc-history-export-gone-', [row(1, 'one', 2 * DAY), row(2, 'two', DAY)]);
    const r0 = await onStore(box, (db) => {
      for (const h of box.homes) setMeta(db, `retention:${h}`, '180');   // every home at 180 days: the cutoff is 150 days back
      return SW.exportPass(db, exportCtx(box, ids));
    });
    expect(r0, 'CONTROL: while its file is on disk, nothing is due').toEqual({ state: 'nothing-due', segment: null, rows: 0, blobs: 0, bytes: 0, complete: true });
    fs.rmSync(transcript);   // deleted early, days after its rows were written
    const r = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids)));
    expect(r).toMatchObject({ state: 'written', segment: `1.${ids.writer}.db`, rows: 2, complete: true });
    expect(marks(box)).toEqual({ [rid(1)]: `1.${ids.writer}.db`, [rid(2)]: `1.${ids.writer}.db` });
  }, 120_000);

  it('per copy: once its transcript is due, a young row held only by a file gone from disk is taken though an older file of that transcript stays on disk: the pass offers every row the census counts due', async () => {
    // Copy A (claude-a, the ingested transcript) holds both rows, written now. Copy B (claude-b) holds row 1 only,
    // last written 160 days ago. Every home keeps 180 days, so the ts prefilter's cutoff is 150 days back, and row 2,
    // 35 days old, is younger than it.
    const rows = [row(1, 'one', 200 * DAY), row(2, 'two', 35 * DAY)];
    const { box, transcript, ids } = ingestedBox('ccrc-history-export-older-', rows, {
      plant: (b) => {
        const copyB = plantTranscript(b, 'claude-b', SLUG, U, [rows[0]!]);
        const at = new Date(Date.now() - 160 * DAY);
        fs.utimesSync(copyB, at, at);
      },
    });
    expect(q(box, 'SELECT count(*) AS n FROM ingest_files')[0]!['n'], 'the fixture must hold two copies').toBe(2);
    expect(q(box, 'SELECT count(*) AS n FROM transcripts')[0]!['n'], 'of ONE transcript').toBe(1);
    const r0 = await onStore(box, (db) => {
      for (const h of box.homes) setMeta(db, `retention:${h}`, '180');
      return SW.exportPass(db, exportCtx(box, ids));
    });
    expect(r0, 'CONTROL: copy A, written now, holds both rows back').toEqual({ state: 'nothing-due', segment: null, rows: 0, blobs: 0, bytes: 0, complete: true });
    fs.rmSync(transcript);   // copy A deleted early: copy B decides, and its 150 days passed 10 days ago
    const r = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids)));
    expect(r, 'row 2 too, though only copy A ever held it and the ts prefilter passes over it')
      .toMatchObject({ state: 'written', segment: `1.${ids.writer}.db`, rows: 2, complete: true });
    expect(marks(box)).toEqual({ [rid(1)]: `1.${ids.writer}.db`, [rid(2)]: `1.${ids.writer}.db` });
  }, 120_000);

  it('a row whose blob prune tombstoned travels with a stub of that blob (sha256, codec, raw_len, no bytes); the stub is never marked exported, the row is', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-stub-', [row(1, 'kept text', 2 * DAY), row(2, 'pruned text', 2 * DAY)]);
    const NOW = Date.now();
    const name = `1.${ids.writer}.db`;
    const prunedSha = String(q(box, 'SELECT lower(hex(b.sha256)) AS sha FROM entries e JOIN blobs b ON b.blob_id = e.blob_id WHERE e.uuid = ?', rid(2))[0]!['sha']);
    const r = await onStore(box, (db) => {
      // B2 Task 20's tombstone, as prune --apply writes it
      db.prepare('UPDATE blobs SET z = NULL, pruned_ms = ?, fts_indexed = 0 WHERE blob_id = (SELECT blob_id FROM entries WHERE uuid = ?)')
        .run(NOW - MIN, rid(2));
      return SW.exportPass(db, exportCtx(box, ids, () => NOW));
    });
    expect(r).toMatchObject({ state: 'written', segment: name, rows: 2, blobs: 1 });
    const segBlobs = segmentRows(path.join(exportDirOf(box), name), 'blobs');
    expect(segBlobs.find((b) => b['sha256'] === prunedSha), 'the pruned row\'s blob has no stub').toMatchObject({ z: null, pruned: 1 });
    expect(segBlobs.filter((b) => b['pruned'] === 0)).toHaveLength(1);
    expect(q(box, 'SELECT exported_ms, exported_seg FROM blobs WHERE lower(hex(sha256)) = ?', prunedSha))
      .toEqual([{ exported_ms: null, exported_seg: null }]);
    expect(marks(box)).toEqual({ [rid(1)]: name, [rid(2)]: name });
  }, 120_000);

  it('an unlinked sidecar travels with its blob, and is a candidate of its own while nothing else carries that blob', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-sidecar-', [row(1, 'a prompt', DAY)], {
      passes: 3,
      plant: (b) => {
        const dir = path.join(b.accountHome['claude-a']!, 'projects', SLUG, U, 'tool-results');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'b9x0-orphan.txt'), 'output no tool_result names');
      },
    });
    expect(q(box, 'SELECT name, entry_id FROM sidecars'), 'the fixture must leave one unlinked sidecar')
      .toEqual([{ name: 'b9x0-orphan.txt', entry_id: null }]);
    const name = `1.${ids.writer}.db`;
    const r = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids)));
    expect(r).toMatchObject({ state: 'written', segment: name, rows: 2, blobs: 2 });
    const side = q(box, 'SELECT lower(hex(b.sha256)) AS sha, b.exported_seg FROM sidecars s JOIN blobs b ON b.blob_id = s.blob_id')[0]!;
    expect(side['exported_seg']).toBe(name);
    const seg = path.join(exportDirOf(box), name);
    expect(segmentRows(seg, 'sidecars').map(pick(['cc_session_uuid', 'agent_id', 'name', 'uuid', 'blob_sha256'])))
      .toEqual([{ cc_session_uuid: U, agent_id: '', name: 'b9x0-orphan.txt', uuid: null, blob_sha256: side['sha'] }]);
    expect(segmentRows(seg, 'blobs').map((b) => b['sha256'])).toContain(side['sha']);
  }, 120_000);

  it('the bound: a segment takes at least one row even past it, stops there, and the rest go into the next pass\'s segment', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-bound-', [
      row(1, 'oldest', 3 * DAY), row(2, 'middle', 2 * DAY), row(3, 'newest', DAY),
    ]);
    const NOW = Date.now();
    // a run byte budget of ONE byte: what is left of it bounds the segment, and every blob is larger
    const r1 = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, () => NOW, { limits: { maxBytes: 1 } })));
    expect(r1).toMatchObject({ state: 'written', segment: `1.${ids.writer}.db`, rows: 1, blobs: 1, complete: false });
    expect(marks(box)).toEqual({ [rid(1)]: `1.${ids.writer}.db`, [rid(2)]: null, [rid(3)]: null });
    const r2 = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, () => NOW + HOUR)));
    expect(r2).toMatchObject({ state: 'written', segment: `2.${ids.writer}.db`, rows: 2, complete: true });
    expect(marks(box)).toEqual({ [rid(1)]: `1.${ids.writer}.db`, [rid(2)]: `2.${ids.writer}.db`, [rid(3)]: `2.${ids.writer}.db` });
  }, 120_000);

  it('the wall clock: when the run\'s clock runs out mid-segment, the rows already written are published and marked, and the rest wait', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-clock-', [
      row(1, 'oldest', 3 * DAY), row(2, 'middle', 2 * DAY), row(3, 'newest', DAY),
    ]);
    const NOW = Date.now();
    const dir = path.join(box.root, 'export', ids.storeId);
    // The writer reads the run's clock once before each row. Once the segment's temp exists, the clock's first read
    // answers NOW and its second answers two run budgets later: one row is written, then the clock has run out.
    let readsSinceTemp = 0;
    const clock = (): number => {
      if (fs.existsSync(dir) && fs.readdirSync(dir).some((n) => n.endsWith('.tmp'))) readsSinceTemp += 1;
      return readsSinceTemp >= 2 ? NOW + 2 * 90_000 : NOW;
    };
    const r = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, clock)));
    expect(r).toMatchObject({ state: 'written', segment: `1.${ids.writer}.db`, rows: 1, complete: false });
    expect(segmentsOf(box)).toEqual([`1.${ids.writer}.db`]);
    expect(marks(box)).toEqual({ [rid(1)]: `1.${ids.writer}.db`, [rid(2)]: null, [rid(3)]: null });
  }, 120_000);

  it('history-off between rows: the temp is removed, nothing is published or marked, and the next pass writes', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-off-', [row(1, 'one', 2 * DAY), row(2, 'two', DAY)]);
    const NOW = Date.now();
    const dir = path.join(box.root, 'export', ids.storeId);
    const off = historyPaths(box.home).off;
    // The operator's switch appears once the segment's temp exists: the clock the writer reads before its first row
    // plants it, exactly between the temp's creation and that row.
    const clock = (): number => {
      if (!fs.existsSync(off) && fs.existsSync(dir) && fs.readdirSync(dir).some((n) => n.endsWith('.tmp'))) fs.writeFileSync(off, '');
      return NOW;
    };
    const r = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, clock)));
    expect(r).toEqual({ state: 'held', segment: null, rows: 0, blobs: 0, bytes: 0, complete: false });
    expect(fs.existsSync(off), 'the switch never appeared: the case proved nothing').toBe(true);
    expect(segmentsOf(box), 'a temp or a segment was left').toEqual([]);
    expect(marks(box)).toEqual({ [rid(1)]: null, [rid(2)]: null });
    expect(metaOf(box, HEALTH_META.exportPassMs), 'a held pass is not a pass').toBeNull();
    fs.rmSync(off);
    const next = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, () => NOW)));
    expect(next).toMatchObject({ state: 'written', rows: 2 });
  }, 120_000);

  it('no rostered home, no horizon: nothing is selected and no directory is made', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-nohome-', [row(1, 'one', DAY)]);
    const r = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, () => Date.now(), { homes: [] })));
    expect(r).toEqual({ state: 'no-horizon', segment: null, rows: 0, blobs: 0, bytes: 0, complete: false });
    expect(fs.existsSync(path.join(box.root, 'export'))).toBe(false);
    expect(marks(box)).toEqual({ [rid(1)]: null });
  }, 120_000);

  it('a page boundary: the next page\'s first due row is held to what is left of the bound, never taken whatever its size (one row a page)', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-page-', [
      row(1, 'oldest', 3 * DAY), row(2, 'middle', 2 * DAY), row(3, 'newest', DAY),
    ]);
    const z1 = Number(q(box, 'SELECT length(b.z) AS n FROM entries e JOIN blobs b ON b.blob_id = e.blob_id WHERE e.uuid = ?', rid(1))[0]!['n']);
    expect(z1, 'the fixture\'s first row must leave room under the bound').toBeLessThan(EXPORT_ROW_META_BYTES / 2);
    // A bound of one and a half rows' metadata: the first row fits with room left over, and no second row can.
    const r = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, () => Date.now(),
      { limits: { maxBytes: 1.5 * EXPORT_ROW_META_BYTES }, deps: { exportPageRows: 1 } })));
    expect(r).toMatchObject({ state: 'written', segment: `1.${ids.writer}.db`, rows: 1, complete: false });
    expect(marks(box)).toEqual({ [rid(1)]: `1.${ids.writer}.db`, [rid(2)]: null, [rid(3)]: null });
  }, 120_000);

  it('row metadata counts toward the bound: many small rows fill a segment to about the bound and never past it by more than the schema\'s pages', async () => {
    const N = 300;
    const { box, ids } = ingestedBox('ccrc-history-export-meta-', Array.from({ length: N }, (_, i) => row(i + 1, `short prompt ${i}`, DAY + i * MIN)));
    const bound = 100 * EXPORT_ROW_META_BYTES;
    const r = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, () => Date.now(), { limits: { maxBytes: bound } })));
    expect(r).toMatchObject({ state: 'written', segment: `1.${ids.writer}.db`, complete: false });
    expect(r.rows, 'the bound counted blob bytes alone: every small row fit').toBeLessThanOrEqual(100);
    // Task 4's format-1 schema pages: 56 KiB on a prototype of its tables; 64 KiB allowed.
    expect(fs.statSync(path.join(exportDirOf(box), `1.${ids.writer}.db`)).size).toBeLessThanOrEqual(bound + 64 * 1024);
  }, 120_000);
});
