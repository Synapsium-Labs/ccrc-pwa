// server/test/history-export.test.ts — the sole-copy export (spec
// docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md §9.15, §9.2 step 6), W1-B4. Two ways in:
//   - sweep.mjs's exportPass (and, from Task 6, exportStep), imported in-process against a REAL store that real
//     scheduled passes ingested, where a case needs a clock, a budget or a statfs answer of its own: injected
//     dependencies, never a variable the shipped code reads (slug history-test-seams-not-env);
//   - the real sweep as the timer runs it (runSweep, and the run-pass driver runDriver where a case needs the pass clock
//     past the store's first hour), with the test-only preloads for faults.
// Every store lives in a mkTmp fixture HOME (makeHistoryBox); nothing reads or writes the live ~/.ccrc, and each test's
// fixture HOMEs are removed when it ends (removeTmpFixturesEachTest).
import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  makeHistoryBox, runSweep, skipOnDarwin, openStoreRO, counters, journalRecords, plantSession, plantTranscript,
  exportDirOf, segmentsOf, segmentRows, runDriver, recoverRow, PRELOADS, CLI, runOnPty, type HistoryBox,
} from './historyHelpers.js';
import { userRow, toolResultRow } from './historyFixtures.js';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';
import { EXPORT_ROW_META_BYTES, HEALTH_META, historyPaths } from '../../ccd/history/lib.mjs';
import { closeWriter, openSegment, openWriter, pruneDryRun, segmentMeta, setMeta } from '../../ccd/history/store.mjs';
import { syncBuiltinESMExports } from 'node:module';

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
  exportStep(db: DatabaseSync, ctx: Record<string, unknown>): Promise<PassResult | null>;
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

  it('an unlinked sidecar whose blob prune tombstoned is no candidate: a stub alone is never offered, so no pass publishes a segment holding only that stub', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-sidecar-pruned-', [row(1, 'a prompt', DAY)], {
      passes: 3,
      plant: (b) => {
        const dir = path.join(b.accountHome['claude-a']!, 'projects', SLUG, U, 'tool-results');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'b9x0-orphan.txt'), 'output no tool_result names');
      },
    });
    expect(q(box, 'SELECT name, entry_id FROM sidecars'), 'the fixture must leave one unlinked sidecar')
      .toEqual([{ name: 'b9x0-orphan.txt', entry_id: null }]);
    const NOW = Date.now();
    const name = `1.${ids.writer}.db`;
    const r = await onStore(box, (db) => {
      // B2 Task 20's tombstone on that sidecar's blob, as prune --apply writes it
      db.prepare("UPDATE blobs SET z = NULL, pruned_ms = ?, fts_indexed = 0 WHERE blob_id = (SELECT blob_id FROM sidecars WHERE name = 'b9x0-orphan.txt')")
        .run(NOW - MIN);
      return SW.exportPass(db, exportCtx(box, ids, () => NOW));
    });
    expect(r, 'the prompt row alone: the pruned sidecar blob is not a candidate').toMatchObject({ state: 'written', segment: name, rows: 1, blobs: 1, complete: true });
    const seg = path.join(exportDirOf(box), name);
    expect(segmentRows(seg, 'blobs').map((b) => b['pruned']), 'no stub of the sidecar\'s blob').toEqual([0]);
    expect(segmentRows(seg, 'sidecars')).toEqual([]);
    expect(marks(box)).toEqual({ [rid(1)]: name });
    // The stub is never marked exported, so a candidate that offered it would be offered again by every later pass.
    const again = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, () => NOW + HOUR)));
    expect(again, 'a second pass finds nothing').toEqual({ state: 'nothing-due', segment: null, rows: 0, blobs: 0, bytes: 0, complete: true });
    expect(segmentsOf(box), 'and publishes no further segment').toEqual([name]);
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

/** One pass through the run-pass driver (B1 Task 24), its clock `min` minutes ahead of the real one. `preloads`, when
 *  given, replaces the driver's default list, so it names the statfs preload itself. */
const driverAt = (box: HistoryBox, min: number, o: { env?: Record<string, string>; preloads?: string[]; sizeBytes?: number } = {}) =>
  runDriver(box, { offsetMs: min * MIN, sizeBytes: o.sizeBytes }, [], { env: o.env ?? {}, preloads: o.preloads });
/** The same pass, which must exit 0. */
const passAt = (box: HistoryBox, min: number, o: { env?: Record<string, string>; sizeBytes?: number } = {}): void => {
  const r = driverAt(box, min, o);
  expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
};

describe('the export in the tick (W1-B4 Task 6; spec §9.2 step 6, §9.15 "Preflight")', () => {

  it('the cadence: no pass in the store\'s first hour, one after it, then at most hourly; a pass that finds nothing due still moves the clock', () => {
    const { box, ids } = ingestedBox('ccrc-history-export-cadence-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    passAt(box, 30);
    expect(segmentsOf(box), 'a pass inside the first hour after the store\'s first tick').toEqual([]);
    expect(metaOf(box, HEALTH_META.exportPassMs)).toBeNull();
    const t65 = Date.now();
    passAt(box, 65);
    expect(segmentsOf(box)).toEqual([`1.${ids.writer}.db`]);
    const first = Number(metaOf(box, HEALTH_META.exportPassMs));
    expect(first).toBeGreaterThanOrEqual(t65 + 65 * MIN);
    passAt(box, 95);
    expect(metaOf(box, HEALTH_META.exportPassMs), 'a second pass inside the hour').toBe(String(first));
    const t130 = Date.now();
    passAt(box, 130);
    expect(segmentsOf(box), 'nothing new was due').toEqual([`1.${ids.writer}.db`]);
    expect(Number(metaOf(box, HEALTH_META.exportPassMs))).toBeGreaterThanOrEqual(t130 + 130 * MIN);
  }, 300_000);

  it('O40: below the home filesystem\'s own floor the pass is skipped (no segment, export_paused_low_disk +1, the pause in meta) and the same pass still ingests', () => {
    const { box, transcript } = ingestedBox('ccrc-history-export-o40-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    fs.appendFileSync(transcript, `${JSON.stringify(row(3, 'three, written after the last pass', HOUR))}\n`);
    passAt(box, 65, { env: { HISTORY_TEST_STATFS_EXPORT: `1000:${10 * GIB}` } });
    expect(segmentsOf(box)).toEqual([]);
    expect(counters(box)['export_paused_low_disk']).toBe(1);
    expect(metaOf(box, HEALTH_META.exportPaused)).toBe('low-disk');
    expect(metaOf(box, HEALTH_META.exportPassMs), 'a pause is not a pass').toBeNull();
    expect(q(box, 'SELECT count(*) AS n FROM entries')[0]!['n'], 'capture is unaffected: the appended row was ingested in the same pass').toBe(3);
  }, 300_000);

  it('O40: an export probe that never settles is a pause at its 5 s deadline, and the pass ends and exits 0', () => {
    const { box } = ingestedBox('ccrc-history-export-hang-', [row(1, 'one', DAY)]);
    const t = Date.now();
    passAt(box, 65, { env: { HISTORY_TEST_STATFS_EXPORT: 'hang' } });
    const ms = Date.now() - t;
    expect(ms, 'the probe was not bounded by its deadline').toBeLessThan(60_000);
    expect(ms, 'the export never probed').toBeGreaterThanOrEqual(4_500);
    expect(segmentsOf(box)).toEqual([]);
    expect(counters(box)['export_paused_low_disk']).toBe(1);
    expect(metaOf(box, HEALTH_META.exportPaused)).toBe('unsettled');
  }, 300_000);

  it('O40 / RC9: the preflight statfs-es ~/.ccrc/history/export and never db/, even with db/ a link onto a roomier volume; a refusal writes nothing, and the next preflight that admits clears the pause, even when its pass is then held', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-vol-', [row(1, 'one', DAY), row(2, 'two', DAY)], {
      plant: (b) => {
        // db/ a link onto a "volume", made before the first install as §9.3 "Store location" says, target 0700
        const vol = path.join(b.home, 'vol', 'history-db');
        fs.mkdirSync(vol, { recursive: true, mode: 0o700 });
        fs.chmodSync(vol, 0o700);
        fs.mkdirSync(b.root, { recursive: true, mode: 0o700 });
        fs.symlinkSync(vol, path.join(b.root, 'db'));
      },
    });
    expect(fs.lstatSync(path.join(box.root, 'db')).isSymbolicLink(), 'the fixture must store through a linked db/').toBe(true);
    const seen: string[] = [];
    const statfs = async (p: string): Promise<{ bsize: number; bavail: number; blocks: number }> => {
      seen.push(p);
      return p.endsWith('/export') ? { bsize: 1, bavail: 1000, blocks: 10 * GIB } : { bsize: 1, bavail: 4 * TIB, blocks: 8 * TIB };
    };
    const later = Date.now() + 2 * HOUR;
    const r = await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => later, { deps: { statfs } })));
    expect(seen, 'the export probed something other than its own directory').toEqual([path.join(box.root, 'export')]);
    expect(r).toEqual({ state: 'paused', segment: null, rows: 0, blobs: 0, bytes: 0, complete: false });
    expect(segmentsOf(box)).toEqual([]);
    expect(counters(box)['export_paused_low_disk']).toBe(1);
    expect(metaOf(box, HEALTH_META.exportPaused)).toBe('low-disk');
    expect(fs.statSync(path.join(box.root, 'export')).mode & 0o777).toBe(0o700);
    expect(fs.statSync(exportDirOf(box)).mode & 0o777).toBe(0o700);
    const roomy = async (): Promise<{ bsize: number; bavail: number; blocks: number }> => ({ bsize: 1, bavail: 4 * TIB, blocks: 8 * TIB });
    // Room is back, and history-off is set: the preflight admits, then the pass is held before its first row.
    const off = historyPaths(box.home).off;
    fs.writeFileSync(off, '');
    const held = await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => later, { deps: { statfs: roomy } })));
    expect(held).toEqual({ state: 'held', segment: null, rows: 0, blobs: 0, bytes: 0, complete: false });
    expect(metaOf(box, HEALTH_META.exportPaused), 'an admitting preflight clears the pause, even when its pass is held').toBe('');
    fs.rmSync(off);
    const ok = await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => later, { deps: { statfs: roomy } })));
    expect(ok).toMatchObject({ state: 'written', segment: `1.${ids.writer}.db` });
    expect(metaOf(box, HEALTH_META.exportPaused)).toBe('');
  }, 120_000);

  it('outside the capture pause: a store at its cap pauses ingest and still exports', () => {
    const { box, ids } = ingestedBox('ccrc-history-export-cap-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    passAt(box, 65, { sizeBytes: 60 * GIB });   // over the default 50 GiB cap
    expect(counters(box)['capture_paused_at_cap'], 'the fixture must put the store at its cap').toBeGreaterThanOrEqual(1);
    expect(segmentsOf(box)).toEqual([`1.${ids.writer}.db`]);
  }, 300_000);

  it('never on the recover arm: while a recovery step is registered no export pass runs; the first tick after it completes exports', () => {
    const { box, ids } = ingestedBox('ccrc-history-export-recover-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const db = openWriter(historyPaths(box.home).dbFile);
    try {
      // a recovery step as a restore's commit registers one (B2 Task 25's registerRecovery)
      db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', ?, NULL, NULL)").run(Date.now());
    } finally {
      closeWriter(db);
    }
    passAt(box, 65);
    expect(segmentsOf(box), 'an export pass ran on the recover arm').toEqual([]);
    expect(recoverRow(box), 'the fixture\'s recovery step must complete in one pass').toMatchObject({ completed_ms: expect.any(Number) });
    passAt(box, 66);
    expect(segmentsOf(box)).toEqual([`1.${ids.writer}.db`]);
  }, 300_000);

  it('the cadence waits from the later of the last pass and the last caught-failure attempt, whichever clock is older; lib decides, the step passes both (RD2)', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-clocks-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const later = Date.now() + 5 * HOUR;
    const seen: string[] = [];
    const roomy = async (p: string): Promise<{ bsize: number; bavail: number; blocks: number }> => {
      seen.push(p);
      return { bsize: 1, bavail: 4 * TIB, blocks: 8 * TIB };
    };
    const stepWith = (pass: number | null, attempt: number | null): Promise<PassResult | null> => onStore(box, (db) => {
      for (const [k, v] of [[HEALTH_META.exportPassMs, pass], ['export_attempt_ms', attempt]] as const) {
        db.prepare('DELETE FROM meta WHERE k = ?').run(k);
        if (v !== null) setMeta(db, k, String(v));
      }
      return SW.exportStep(db, exportCtx(box, ids, () => later, { deps: { statfs: roomy } }));
    });
    expect(await stepWith(later - 3 * HOUR, later - 10 * MIN), 'a failed attempt ten minutes ago, the last pass hours ago').toBeNull();
    expect(await stepWith(later - 10 * MIN, later - 3 * HOUR), 'a pass ten minutes ago, the last failed attempt hours ago').toBeNull();
    expect(await stepWith(null, later - 10 * MIN), 'a failed attempt ten minutes ago and no pass ever: the attempt, not the first tick, anchors the wait').toBeNull();
    expect(seen, 'a waiting step probes nothing').toEqual([]);
    expect(segmentsOf(box)).toEqual([]);
    expect(await stepWith(later - 3 * HOUR, later - 2 * HOUR), 'both over an hour old').toMatchObject({ state: 'written', segment: `1.${ids.writer}.db` });
    expect(seen).toEqual([path.join(box.root, 'export')]);
  }, 120_000);

  // A planted entry where an export directory belongs must never throw out of every tick. exportStep swallows two things before its
  // probe: ensureExportDirs (the probe then decides) and removeStaleSegmentTemps (counted export_write_failed, the step goes on).
  for (const where of ['export', 'export/<store_id>'] as const) {
    it(`a regular file where ${where} must be a directory: exportStep resolves, both swallows count or hold, the planted file is left alone, and the pass fails and is counted`, async () => {
      const { box, ids } = ingestedBox('ccrc-history-export-planted-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
      const planted = where === 'export' ? path.join(box.root, 'export') : path.join(box.root, 'export', ids.storeId);
      fs.mkdirSync(path.dirname(planted), { recursive: true, mode: 0o700 });
      fs.writeFileSync(planted, 'a planted file');
      const later = Date.now() + 2 * HOUR;
      const roomy = async (): Promise<{ bsize: number; bavail: number; blocks: number }> => ({ bsize: 1, bavail: 4 * TIB, blocks: 8 * TIB });
      const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      let r: PassResult | null;
      try {
        r = await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => later, { deps: { statfs: roomy } })));
      } finally {
        err.mockRestore();
      }
      // statfs on export/ answers (a file there is on the filesystem too), so the preflight admits and exportPass meets the entry itself.
      expect(r).toEqual({ state: 'failed', segment: null, rows: 0, blobs: 0, bytes: 0, complete: false });
      expect(counters(box)['export_write_failed'], 'the stale-temp removal (ENOTDIR on the listing) and the pass itself, one each').toBe(2);
      expect(counters(box)['export_paused_low_disk'], 'a planted entry is a failed pass, not a pause').toBeUndefined();
      expect(fs.readFileSync(planted, 'utf8'), 'the planted file is never removed or replaced').toBe('a planted file');
      expect(metaOf(box, 'export_attempt_ms'), 'the failed pass counts for the cadence').toBe(String(later));
      expect(metaOf(box, HEALTH_META.exportPassMs), 'and is not a pass').toBeNull();
    }, 120_000);
  }

  it.skipIf(process.getuid?.() === 0)('export/ cannot be made at all: the swallowed mkdir leaves the probe to fail on the missing directory, which is a low-disk pause and not a throw', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-nomkdir-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const later = Date.now() + 2 * HOUR;
    fs.chmodSync(box.root, 0o500);   // no entry can be added under ~/.ccrc/history: mkdir of export/ fails EACCES
    try {
      // the real statfs, in-process: it answers ENOENT on the missing export/
      const r = await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => later)));
      expect(r).toEqual({ state: 'paused', segment: null, rows: 0, blobs: 0, bytes: 0, complete: false });
    } finally {
      fs.chmodSync(box.root, 0o700);
    }
    expect(fs.existsSync(path.join(box.root, 'export'))).toBe(false);
    expect(counters(box)['export_paused_low_disk']).toBe(1);
    expect(counters(box)['export_write_failed'], 'a missing directory is not a failed removal').toBeUndefined();
    expect(metaOf(box, HEALTH_META.exportPaused)).toBe('low-disk');
  }, 120_000);
});

describe('crash and collision safety (W1-B4 Task 7; spec §9.15 "Write", "Mark", §9.10)', () => {
  const FAULTS = [PRELOADS.statfs, PRELOADS.faults];
  /** Every blob and entry mark the store holds: none means nothing was marked. */
  const marked = (box: HistoryBox): number =>
    Number(q(box, 'SELECT (SELECT count(*) FROM blobs WHERE exported_ms IS NOT NULL) + (SELECT count(*) FROM entries WHERE exported_ms IS NOT NULL) AS n')[0]!['n']);

  it('O39: a kill mid-write leaves only the temp; nothing is marked; the next pass removes it and writes the segment', () => {
    const { box, ids } = ingestedBox('ccrc-history-export-killw-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const name = `1.${ids.writer}.db`;
    const r = driverAt(box, 65, { preloads: FAULTS, env: { HISTORY_TEST_KILL_SQL: 'INTO families' } });
    expect(r.signal, `${r.stdout}\n${r.stderr}`).toBe('SIGKILL');
    expect(segmentsOf(box), 'a kill mid-write left more than its temp').toEqual([`.${name}.tmp`]);
    expect(marked(box)).toBe(0);
    passAt(box, 70);
    expect(segmentsOf(box), 'the stale temp outlived the next pass').toEqual([name]);
    expect(marks(box)).toEqual({ [rid(1)]: name, [rid(2)]: name });
  }, 300_000);

  it('O39: a kill just before the link leaves only the temp and nothing marked (CONTROL: marking before the link reds here)', () => {
    const { box, ids } = ingestedBox('ccrc-history-export-killb-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const name = `1.${ids.writer}.db`;
    const r = driverAt(box, 65, { preloads: FAULTS, env: { HISTORY_TEST_KILL: `linkSync:.${name}.tmp:1:before` } });
    expect(r.signal, `${r.stdout}\n${r.stderr}`).toBe('SIGKILL');
    expect(segmentsOf(box)).toEqual([`.${name}.tmp`]);
    expect(marked(box), 'rows were marked with no segment to hold them').toBe(0);
    passAt(box, 70);
    expect(segmentsOf(box)).toEqual([name]);
    expect(marks(box)).toEqual({ [rid(1)]: name, [rid(2)]: name });
  }, 300_000);

  it('O39: a kill between the link and the marks: the next pass writes the same rows into the next segment, and both hold them', () => {
    const { box, ids } = ingestedBox('ccrc-history-export-killa-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const s1 = `1.${ids.writer}.db`;
    const s2 = `2.${ids.writer}.db`;
    const r = driverAt(box, 65, { preloads: FAULTS, env: { HISTORY_TEST_KILL: `linkSync:.${s1}.tmp:1:after` } });
    expect(r.signal, `${r.stdout}\n${r.stderr}`).toBe('SIGKILL');
    expect(segmentsOf(box), 'the link happened and the temp is still there').toEqual([`.${s1}.tmp`, s1]);
    expect(marked(box)).toBe(0);
    passAt(box, 70);
    expect(segmentsOf(box)).toEqual([s1, s2]);
    expect(marks(box)).toEqual({ [rid(1)]: s2, [rid(2)]: s2 });
    expect(metaOf(box, 'export_seq')).toBe('2');
    const uuidsOf = (n: string): unknown[] => segmentRows(path.join(exportDirOf(box), n), 'entries').map((e) => e['uuid']).sort();
    expect(uuidsOf(s1)).toEqual([rid(1), rid(2)]);
    expect(uuidsOf(s2), 'the repeated rows are not the same as the published ones').toEqual(uuidsOf(s1));
  }, 300_000);

  it('a counter behind the directory: the next number is past every name on disk, of any writer, and past meta\'s; the name on disk is untouched', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-behind-', [row(1, 'one', DAY)]);
    const dir = path.join(box.root, 'export', ids.storeId);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const theirs = path.join(dir, '5.0badc0de.db');
    fs.writeFileSync(theirs, 'a segment another writer of this store published', { mode: 0o600 });
    await onStore(box, (db) => { setMeta(db, 'export_seq', '2'); });   // a restored store whose counter is behind
    passAt(box, 65);
    expect(segmentsOf(box)).toEqual(['5.0badc0de.db', `6.${ids.writer}.db`]);
    expect(fs.readFileSync(theirs, 'utf8')).toBe('a segment another writer of this store published');
    expect(metaOf(box, 'export_seq')).toBe('6');
    expect(marks(box)).toEqual({ [rid(1)]: `6.${ids.writer}.db` });
  }, 300_000);

  it('an existing name is never replaced: a name taken between the listing and the link sends the pass to the next number (CONTROL: publishing by rename reds here)', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-eexist-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const taken = `/export/${ids.storeId}/1.${ids.writer}.db`;
    let planted = 0;
    // The name appears between the pass's listing and its publish: whichever node:fs call publishes the segment, its
    // target is planted first, exactly once. syncBuiltinESMExports() carries the patch to store.mjs's named imports.
    const plant = (to: unknown): void => {
      if (planted === 0 && String(to).endsWith(taken)) { fs.writeFileSync(String(to), 'planted by the test'); planted += 1; }
    };
    const realLink = fs.linkSync;
    const realRename = fs.renameSync;
    (fs as { linkSync: unknown }).linkSync = (from: fs.PathLike, to: fs.PathLike): void => { plant(to); realLink(from, to); };
    (fs as { renameSync: unknown }).renameSync = (from: fs.PathLike, to: fs.PathLike): void => { plant(to); realRename(from, to); };
    syncBuiltinESMExports();
    let r: PassResult;
    try {
      r = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids)));
    } finally {
      (fs as { linkSync: unknown }).linkSync = realLink;
      (fs as { renameSync: unknown }).renameSync = realRename;
      syncBuiltinESMExports();
    }
    expect(planted, 'the name was never taken: the publish reached neither link nor rename').toBe(1);
    expect(fs.readFileSync(path.join(exportDirOf(box), `1.${ids.writer}.db`), 'utf8'), 'an existing name was written over')
      .toBe('planted by the test');
    expect(r).toMatchObject({ state: 'written', segment: `2.${ids.writer}.db` });
    expect(segmentsOf(box)).toEqual([`1.${ids.writer}.db`, `2.${ids.writer}.db`]);
    expect(marks(box)).toEqual({ [rid(1)]: `2.${ids.writer}.db`, [rid(2)]: `2.${ids.writer}.db` });
    expect(counters(box)['export_seq_taken']).toBe(1);
    expect(metaOf(box, 'export_seq')).toBe('2');
    const h = openSegment(path.join(exportDirOf(box), `2.${ids.writer}.db`));
    try {
      expect(segmentMeta(h).seq, 'the segment\'s own number disagrees with its name').toBe(2);
    } finally {
      h.close();
    }
  }, 120_000);

  it('the EEXIST retry is bounded: names that keep being taken fail the pass after eight tries past the first, one number each and never the same twice, and the temp goes', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-bound-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const NOW = Date.now();
    const tried: string[] = [];
    const realLink = fs.linkSync;
    // Every link meets a name that has just appeared (nothing is planted: the number the pass takes next can come only from
    // what it tried). After 30 calls the real link goes through, so a pass with no bound ends written, never in a loop.
    (fs as { linkSync: unknown }).linkSync = (from: fs.PathLike, to: fs.PathLike): void => {
      if (tried.length >= 30) { realLink(from, to); return; }
      tried.push(path.basename(String(to)));
      throw Object.assign(new Error(`EEXIST: file already exists, link '${String(from)}' -> '${String(to)}'`), { code: 'EEXIST' });
    };
    syncBuiltinESMExports();
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let r: PassResult;
    try {
      r = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, () => NOW)));
    } finally {
      err.mockRestore();
      (fs as { linkSync: unknown }).linkSync = realLink;
      syncBuiltinESMExports();
    }
    expect(r, 'a pass with no bound goes on past eight tries').toEqual({ state: 'failed', segment: null, rows: 0, blobs: 0, bytes: 0, complete: false });
    expect(tried, 'one publish, then eight retries, each under a number not tried before').toEqual(Array.from({ length: 9 }, (_, i) => `${i + 1}.${ids.writer}.db`));
    expect(counters(box)['export_seq_taken']).toBe(8);
    expect(counters(box)['export_write_failed']).toBe(1);
    expect(segmentsOf(box), 'the failed pass left its temp or published a segment').toEqual([]);
    expect(marks(box)).toEqual({ [rid(1)]: null, [rid(2)]: null });
    expect(metaOf(box, 'export_attempt_ms'), 'the failed pass counts for the cadence').toBe(String(NOW));
    expect(metaOf(box, 'export_mark_fails'), 'nothing was published, so this is no mark failure').toBeNull();
  }, 120_000);

  it('a failed segment write removes its temp, marks nothing, is counted, and the pass exits 0; the next tick ingests, and the export retries an hour later', () => {
    const { box, transcript, ids } = ingestedBox('ccrc-history-export-fail-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const r = driverAt(box, 65, { preloads: FAULTS, env: { HISTORY_TEST_THROW_SQL: 'INTO families' } });
    expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stderr).toContain('history-sweep: an export segment write failed and nothing was marked');
    expect(segmentsOf(box)).toEqual([]);
    expect(marked(box)).toBe(0);
    expect(counters(box)['export_write_failed']).toBe(1);
    expect(metaOf(box, HEALTH_META.exportPassMs), 'a failed pass is not a pass').toBeNull();
    fs.appendFileSync(transcript, `${JSON.stringify(row(3, 'three', HOUR))}\n`);
    passAt(box, 100);
    expect(q(box, 'SELECT count(*) AS n FROM entries')[0]!['n'], 'the tick after a failed export still ingests').toBe(3);
    expect(segmentsOf(box), 'a failed pass retried inside its hour').toEqual([]);
    passAt(box, 130);
    expect(segmentsOf(box)).toEqual([`1.${ids.writer}.db`]);
    expect(marks(box)).toEqual({ [rid(1)]: `1.${ids.writer}.db`, [rid(2)]: `1.${ids.writer}.db`, [rid(3)]: `1.${ids.writer}.db` });
  }, 300_000);

  it('a stale temp goes before the preflight: a pass paused for room after a kill mid-write leaves no temp on the filesystem it measured (CONTROL: removing it only after an admit reds here)', () => {
    const { box, ids } = ingestedBox('ccrc-history-export-killp-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const name = `1.${ids.writer}.db`;
    const r = driverAt(box, 65, { preloads: FAULTS, env: { HISTORY_TEST_KILL_SQL: 'INTO families' } });
    expect(r.signal, `${r.stdout}\n${r.stderr}`).toBe('SIGKILL');
    expect(segmentsOf(box)).toEqual([`.${name}.tmp`]);
    passAt(box, 70, { env: { HISTORY_TEST_STATFS_EXPORT: `1000:${10 * GIB}` } });
    expect(counters(box)['export_paused_low_disk'], 'the follow-up pass must be paused for room').toBe(1);
    expect(segmentsOf(box), 'the paused pass kept a dead segment\'s temp on the filesystem it measured').toEqual([]);
  }, 300_000);

  it('a pass that published its segment and could not mark it backs off: the next segment waits two hours, not one, so a store that cannot take its marks does not publish a copy every hour; a marked pass ends the backoff', () => {
    const { box, ids } = ingestedBox('ccrc-history-export-markfail-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const s1 = `1.${ids.writer}.db`;
    const s2 = `2.${ids.writer}.db`;
    // the mark transaction's blob update throws, the stand-in for db/'s volume refusing the WAL growth (SQLITE_FULL)
    const r = driverAt(box, 65, { preloads: FAULTS, env: { HISTORY_TEST_THROW_SQL: 'UPDATE blobs SET exported_ms = ?, exported_seg = ? WHERE blob_id' } });
    expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stderr).toContain(`history-sweep: export segment ${s1} was published and could not be marked`);
    expect(segmentsOf(box), 'the segment was published before its mark failed').toEqual([s1]);
    expect(marked(box)).toBe(0);
    expect(counters(box)['export_write_failed']).toBe(1);
    expect(metaOf(box, 'export_mark_fails')).toBe('1');
    passAt(box, 130);   // over an hour after the failed attempt: a second copy of the same rows would be published here
    expect(segmentsOf(box), 'the pass after a mark failure came back within two hours of it').toEqual([s1]);
    passAt(box, 190);   // over two hours after it
    expect(segmentsOf(box)).toEqual([s1, s2]);
    expect(marks(box)).toEqual({ [rid(1)]: s2, [rid(2)]: s2 });
    expect(metaOf(box, 'export_mark_fails'), 'a marked pass ends the backoff').toBe('0');
  }, 300_000);

  // RD3: a busy error between the link and the marks. No preload throws a busy (B2's HISTORY_TEST_THROW_SQL throws
  // ERR_SQLITE_ERROR with no errcode), so these two cases run exportPass in-process on the test's OWN writer connection:
  // node:fs's linkSync is wrapped to see the link (the EEXIST case's idiom), and that connection's exec answers the next
  // `n` BEGIN IMMEDIATEs after the link with SQLITE_BUSY (errcode 5, what B1's isBusy reads): the stand-in for another
  // connection holding the write lock past busy_timeout. Every other statement runs as it would. Shipped code reads no seam.
  const roomy = async (): Promise<{ bsize: number; bavail: number; blocks: number }> => ({ bsize: 1, bavail: 4 * TIB, blocks: 8 * TIB });
  async function busyAfterLink(box: HistoryBox, ids: { storeId: string; writer: string }, nowMs: number, n: number): Promise<unknown> {
    return onStore(box, async (db) => {
      let linked = false;
      let busied = 0;
      const realLink = fs.linkSync;
      (fs as { linkSync: unknown }).linkSync = (from: fs.PathLike, to: fs.PathLike): void => { realLink(from, to); linked = true; };
      syncBuiltinESMExports();
      const realExec = db.exec.bind(db);
      (db as unknown as { exec: (sql: string) => void }).exec = (sql: string): void => {
        if (linked && busied < n && sql === 'BEGIN IMMEDIATE') {
          busied += 1;
          throw Object.assign(new Error(`database is locked (BEGIN ${busied} after the link)`), { code: 'ERR_SQLITE_ERROR', errcode: 5, errstr: 'database is locked' });
        }
        realExec(sql);
      };
      try {
        return await SW.exportPass(db, exportCtx(box, ids, () => nowMs)).then(() => null, (e: unknown) => e);
      } finally {
        (fs as { linkSync: unknown }).linkSync = realLink;
        syncBuiltinESMExports();
      }
    });
  }

  it('a busy error between the link and the marks: the pass records the published segment\'s number and the attempt clock, then rethrows it, so the next step publishes nothing new; a busy is not a mark failure (RD3)', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-busy-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const NOW = Date.now() + 2 * HOUR;   // past the store's first hour: only the attempt clock can hold the next step
    const s1 = `1.${ids.writer}.db`;
    const s2 = `2.${ids.writer}.db`;
    const err = (await busyAfterLink(box, ids, NOW, 1)) as { errcode?: number; message?: string } | null;
    expect(err?.errcode, 'the busy error was not rethrown').toBe(5);
    expect(err?.message).toBe('database is locked (BEGIN 1 after the link)');
    expect(segmentsOf(box), 'the segment was published before the busy mark').toEqual([s1]);
    expect(marks(box)).toEqual({ [rid(1)]: null, [rid(2)]: null });
    expect(metaOf(box, 'export_seq'), 'the published segment\'s number').toBe('1');
    expect(metaOf(box, 'export_attempt_ms'), 'the attempt clock').toBe(String(NOW));
    expect(metaOf(box, 'export_mark_fails'), 'a busy is the lock\'s, not the volume\'s: no backoff').toBeNull();
    expect(counters(box)['export_write_failed'], 'a busy ends the tick; it is not a failed write').toBeUndefined();
    const next = await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => NOW + 5 * MIN, { deps: { statfs: roomy } })));
    expect(next, 'the next step published the same rows again').toBeNull();
    expect(segmentsOf(box)).toEqual([s1]);
    // an hour on, the unmarked rows go into the next segment, as after a kill between the link and the marks
    const later = await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => NOW + 65 * MIN, { deps: { statfs: roomy } })));
    expect(later).toMatchObject({ state: 'written', segment: s2 });
    expect(marks(box)).toEqual({ [rid(1)]: s2, [rid(2)]: s2 });
  }, 120_000);

  it('RD3\'s residual: when that record meets busy too, the first error is the one rethrown, nothing is recorded, and the next pass repeats the rows into the next segment, which replay absorbs', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-busy2-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const NOW = Date.now() + 2 * HOUR;
    const s1 = `1.${ids.writer}.db`;
    const s2 = `2.${ids.writer}.db`;
    const err = (await busyAfterLink(box, ids, NOW, 2)) as { errcode?: number; message?: string } | null;
    expect(err?.errcode, 'the busy error was not rethrown').toBe(5);
    expect(err?.message, 'the record\'s own error escaped in place of the mark\'s').toBe('database is locked (BEGIN 1 after the link)');
    expect(segmentsOf(box)).toEqual([s1]);
    expect(metaOf(box, 'export_attempt_ms'), 'a record that met busy recorded nothing').toBeNull();
    expect(metaOf(box, 'export_seq')).toBeNull();
    const next = await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => NOW + 5 * MIN, { deps: { statfs: roomy } })));
    expect(next).toMatchObject({ state: 'written', segment: s2 });
    const uuidsOf = (n: string): unknown[] => segmentRows(path.join(exportDirOf(box), n), 'entries').map((e) => e['uuid']).sort();
    expect(uuidsOf(s2), 'the residual: the same rows in two segments, which Task 10\'s replay absorbs').toEqual(uuidsOf(s1));
    expect(marks(box)).toEqual({ [rid(1)]: s2, [rid(2)]: s2 });
  }, 120_000);
});

/** `ccrc history doctor --adopt` on a REAL terminal (historyHelpers' runOnPty, shared with history-recover.test.ts): the
 *  irreversible forms refuse without one (§8.4). Its safety timer kills the pty's whole process group. */
const adoptOnPty = (box: HistoryBox): Promise<{ code: number; out: string }> =>
  runOnPty(box, [process.execPath, '--no-warnings', CLI, 'doctor', '--adopt'], { timeoutMs: 40_000 });

describe('marks that move (W1-B4 Task 8; spec §9.15 "Mark", "After a bind")', () => {
  it('O39: a variant first seen after its entry was exported clears that entry\'s marks, and the next pass writes the entry again with both variants', () => {
    const { box, transcript, ids } = ingestedBox('ccrc-history-export-variant-', [row(1, 'body one', 2 * DAY), row(2, 'another row', 2 * DAY)]);
    const s1 = `1.${ids.writer}.db`;
    const s2 = `2.${ids.writer}.db`;
    passAt(box, 65);
    expect(marks(box)).toEqual({ [rid(1)]: s1, [rid(2)]: s1 });
    // the same uuid with another body, as a later copy of the row writes it (B1's DM2: one entry, two variants)
    fs.appendFileSync(transcript, `${JSON.stringify(row(1, 'body two', 2 * DAY))}\n`);
    passAt(box, 100);   // the scan reads the appended line; the export waits, its last pass at +65
    expect(q(box, 'SELECT count(*) AS n FROM entry_variants')[0]!['n'], 'the fixture must make a variant').toBe(2);
    expect(marks(box), 'the late variant left its entry marked').toEqual({ [rid(1)]: null, [rid(2)]: s1 });
    passAt(box, 130);
    expect(segmentsOf(box)).toEqual([s1, s2]);
    expect(marks(box)).toEqual({ [rid(1)]: s2, [rid(2)]: s1 });
    const seg2 = path.join(exportDirOf(box), s2);
    expect(segmentRows(seg2, 'entries').map((e) => e['uuid'])).toEqual([rid(1)]);
    const both = q(box, `SELECT lower(hex(b.sha256)) AS sha FROM entry_variants v JOIN entries e ON e.entry_id = v.entry_id
      JOIN blobs b ON b.blob_id = v.blob_id WHERE e.uuid = ? ORDER BY sha`, rid(1)).map((r) => r['sha']);
    expect(segmentRows(seg2, 'variants').map((v) => v['blob_sha256']).sort()).toEqual(both);
    // the first body's bytes are in segment 1 already: segment 2 carries only the new one
    expect(segmentRows(seg2, 'blobs')).toHaveLength(1);
  }, 300_000);

  it('O39: after an adopt with the segments left behind, the first tick clears every mark naming a missing segment, export_segment_missing +1, and the rows export again under the new writer', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-adopt-', [row(1, 'one', 2 * DAY), row(2, 'two', DAY)]);
    const P = historyPaths(box.home);
    passAt(box, 65);
    expect(Object.values(marks(box))).toEqual([`1.${ids.writer}.db`, `1.${ids.writer}.db`]);
    // the store comes to "this box" and its export directory stays on the one it came from (§8.4's carry, not done)
    fs.renameSync(exportDirOf(box), path.join(box.home, 'export-left-behind'));
    fs.rmSync(P.storeId);
    fs.rmSync(P.writer);
    const adopt = await adoptOnPty(box);
    expect(adopt.code, adopt.out).toBe(0);
    const writer = fs.readFileSync(P.writer, 'utf8').trim();
    expect(writer, 'adopt mints a new writer token').not.toBe(ids.writer);
    expect(q(box, "SELECT v FROM meta WHERE k LIKE 'bound:%'")).toEqual([{ v: 'adopt' }]);
    passAt(box, 70);   // the first tick after the bind; the cadence still waits (last pass at +65)
    expect(Object.values(marks(box)), 'a mark still names a segment this box does not have').toEqual([null, null]);
    expect(q(box, 'SELECT count(*) AS n FROM blobs WHERE exported_ms IS NOT NULL')[0]!['n']).toBe(0);
    expect(counters(box)['export_segment_missing']).toBe(1);
    expect(metaOf(box, HEALTH_META.exportSegmentMissing), 'two entries\' marks and two blobs\'').toBe('4');
    expect(segmentsOf(box), 'the check wrote a segment').toEqual([]);
    passAt(box, 130);
    const again = `2.${writer}.db`;
    expect(segmentsOf(box)).toEqual([again]);
    expect(Object.values(marks(box))).toEqual([again, again]);
    expect(metaOf(box, HEALTH_META.exportSegmentMissing), 'the re-export left nothing due behind: the WARN clears').toBe('0');
    expect(counters(box)['export_segment_missing'], 'a second check ran without a second bind').toBe(1);
  }, 300_000);

  it('the check runs on the first step after a bind and not again until the next one: marks naming a present segment stay; a restore\'s bind clears those naming a missing one', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-bindcheck-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const NOW = Date.now();
    const at = (ms: number) => (): number => NOW + ms;
    const name = `1.${ids.writer}.db`;
    await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(0))));
    expect(Object.values(marks(box))).toEqual([name, name]);
    // an adopt's bind fact, as B2's insertBindFacts writes it; the segment IS here, so nothing is cleared
    await onStore(box, (db) => {
      setMeta(db, `bound:${NOW + MIN}`, 'adopt');
      return SW.exportStep(db, exportCtx(box, ids, at(2 * MIN)));
    });
    expect(metaOf(box, 'export_marks_checked_ms')).toBe(String(NOW + 2 * MIN));
    expect(Object.values(marks(box))).toEqual([name, name]);
    expect(counters(box)['export_segment_missing']).toBeUndefined();
    expect(metaOf(box, HEALTH_META.exportSegmentMissing)).toBeNull();
    // the segment goes, with no bind since the check: no check runs, and the marks stay
    fs.rmSync(path.join(exportDirOf(box), name));
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(3 * MIN))));
    expect(Object.values(marks(box)), 'a check ran with no bind since the last one').toEqual([name, name]);
    // a restore's bind: the next step clears every mark naming the missing segment
    await onStore(box, (db) => {
      setMeta(db, `bound:${NOW + 4 * MIN}`, 'restore');
      return SW.exportStep(db, exportCtx(box, ids, at(5 * MIN)));
    });
    expect(Object.values(marks(box))).toEqual([null, null]);
    expect(q(box, 'SELECT count(*) AS n FROM blobs WHERE exported_seg IS NOT NULL')[0]!['n']).toBe(0);
    expect(counters(box)['export_segment_missing']).toBe(1);
    expect(metaOf(box, HEALTH_META.exportSegmentMissing)).toBe('4');
  }, 120_000);

  it('the check follows the bind facts it has not covered, never their clocks: a bind stamped before the last check (a box whose clock is behind) still runs it', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-bindkey-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const NOW = Date.now();
    const at = (ms: number) => (): number => NOW + ms;
    const name = `1.${ids.writer}.db`;
    await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(0))));
    await onStore(box, (db) => {
      setMeta(db, `bound:${NOW + 5 * MIN}`, 'adopt');
      return SW.exportStep(db, exportCtx(box, ids, at(6 * MIN)));
    });
    expect(metaOf(box, 'export_marks_checked_ms')).toBe(String(NOW + 6 * MIN));
    expect(Object.values(marks(box))).toEqual([name, name]);
    // a restore whose bind fact carries a clock behind the last check's, with the segment gone
    fs.rmSync(path.join(exportDirOf(box), name));
    await onStore(box, (db) => {
      setMeta(db, `bound:${NOW + 3 * MIN}`, 'restore');
      return SW.exportStep(db, exportCtx(box, ids, at(7 * MIN)));
    });
    expect(Object.values(marks(box)), 'a bind stamped before the last check was never checked').toEqual([null, null]);
    expect(counters(box)['export_segment_missing']).toBe(1);
  }, 120_000);

  // The check lists export/<store_id>/. A listing that fails for any reason but ENOENT is "unreadable", never "absent":
  // only a proven absence (the adopt case above) clears the marks. A regular file where the directory must be, at the
  // directory itself or at its parent export/, fails the listing with ENOTDIR, which an existsSync guard would have read
  // as an absent directory and cleared every mark on (review of Task 8).
  for (const where of ['export/<store_id>', 'export'] as const) {
    it(`a check that cannot list export/<store_id>/ (a regular file where ${where} must be a directory) is counted and retried, never thrown out of the tick and never read as an absent directory: the marks stay, and the next step checks again`, async () => {
      const { box, ids } = ingestedBox('ccrc-history-export-bindlist-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
      const NOW = Date.now();
      const at = (ms: number) => (): number => NOW + ms;
      const name = `1.${ids.writer}.db`;
      await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(0))));
      const dir = exportDirOf(box);
      const planted = where === 'export' ? path.dirname(dir) : dir;
      fs.renameSync(planted, `${planted}.kept`);
      fs.writeFileSync(planted, 'a stray file under the directory\'s name');   // listing under it fails ENOTDIR
      // the cadence waits inside the hour after the pass at NOW, so only the check runs
      const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      let lines: string[] = [];
      try {
        await onStore(box, async (db) => {
          setMeta(db, `bound:${NOW + MIN}`, 'adopt');
          await SW.exportStep(db, exportCtx(box, ids, at(2 * MIN)));   // resolves: the step never throws it
        });
        lines = err.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('history-sweep: the export marks could not be checked'));
      } finally {
        err.mockRestore();
      }
      expect(lines, 'one stderr line, naming the directory').toHaveLength(1);
      expect(lines[0]).toContain(`against ${dir}: `);
      expect(lines[0]).toContain('ENOTDIR');
      expect(counters(box)['export_marks_check_failed']).toBe(1);
      expect(Object.values(marks(box)), 'a check that could not list cleared marks').toEqual([name, name]);
      expect(counters(box)['export_segment_missing'], 'an unreadable directory is not a missing segment').toBeUndefined();
      expect(metaOf(box, 'export_marks_checked_ms'), 'a failed check is not a check').toBeNull();
      expect(metaOf(box, 'export_marks_checked_binds'), 'a failed check covers no bind fact').toBeNull();
      fs.rmSync(planted);
      fs.renameSync(`${planted}.kept`, planted);
      await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(3 * MIN))));
      expect(metaOf(box, 'export_marks_checked_ms'), 'the next step checks again').toBe(String(NOW + 3 * MIN));
      expect(Object.values(marks(box))).toEqual([name, name]);
    }, 120_000);
  }

  // Beyond the brief's list (flagged in the Task 8 report): the check's `if (isBusy(e)) throw e` had no case. The
  // test's own writer connection answers its next BEGIN IMMEDIATE with SQLITE_BUSY (errcode 5), once, the stand-in for
  // another connection holding the write lock past busy_timeout (the RD3 idiom above); shipped code reads no seam.
  it('a busy error in the check is the lock\'s: the step rethrows it, nothing is counted export_marks_check_failed or recorded, and the next step checks again', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-bindbusy-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const NOW = Date.now();
    const at = (ms: number) => (): number => NOW + ms;
    const name = `1.${ids.writer}.db`;
    await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(0))));
    fs.rmSync(path.join(exportDirOf(box), name));   // the segment is gone, so the check has marks to clear
    const err = await onStore(box, async (db) => {
      setMeta(db, `bound:${NOW + MIN}`, 'restore');
      let busied = 0;
      const realExec = db.exec.bind(db);
      (db as unknown as { exec: (sql: string) => void }).exec = (sql: string): void => {
        if (busied < 1 && sql === 'BEGIN IMMEDIATE') {
          busied += 1;
          throw Object.assign(new Error('database is locked (the check)'), { code: 'ERR_SQLITE_ERROR', errcode: 5, errstr: 'database is locked' });
        }
        realExec(sql);
      };
      return SW.exportStep(db, exportCtx(box, ids, at(2 * MIN))).then(() => null, (e: unknown) => e);
    }) as { errcode?: number; message?: string } | null;
    expect(err?.errcode, 'the busy error was not rethrown').toBe(5);
    expect(err?.message).toBe('database is locked (the check)');
    expect(counters(box)['export_marks_check_failed'], 'a busy is the lock\'s, not a failed listing').toBeUndefined();
    expect(Object.values(marks(box)), 'a check that met busy cleared marks').toEqual([name, name]);
    expect(metaOf(box, 'export_marks_checked_ms'), 'a check that met busy is not a check').toBeNull();
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(3 * MIN))));
    expect(Object.values(marks(box)), 'the next step checks again').toEqual([null, null]);
    expect(counters(box)['export_segment_missing']).toBe(1);
  }, 120_000);

  it('a sidecar linked after its entry was exported clears that entry\'s marks, and the next pass writes the entry again with the sidecar row and its bytes; the census\'s due count returns to 0', () => {
    const late = toolResultRow({
      uuid: rid(2), ts: new Date(Date.now() - 2 * DAY).toISOString(), sessionId: U, cwd: WORK, toolUseId: 'toolu_01B4LATE',
      content: 'Output too large. Full output saved to: /home/u/x/tool-results/b4late01.txt',
    });
    const { box, ids } = ingestedBox('ccrc-history-export-latesc-', [row(1, 'a prompt', 2 * DAY), late]);
    const s1 = `1.${ids.writer}.db`;
    const s2 = `2.${ids.writer}.db`;
    passAt(box, 65);
    expect(marks(box)).toEqual({ [rid(1)]: s1, [rid(2)]: s1 });
    // the tool's output file lands after its row was exported (a tick behind its JSONL line, or held back by a copy
    // still behind: §9.2 step 4)
    const dir = path.join(box.accountHome['claude-a']!, 'projects', SLUG, U, 'tool-results');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'b4late01.txt'), 'the late tool output body\n');
    passAt(box, 100);   // a scan tick (over 30 min after the last): it finds and links the sidecar; the export waits
    expect(q(box, 'SELECT s.name, e.uuid FROM sidecars s LEFT JOIN entries e ON e.entry_id = s.entry_id'), 'the fixture must link the sidecar to the exported row')
      .toEqual([{ name: 'b4late01.txt', uuid: rid(2) }]);
    expect(marks(box), 'the late sidecar left its entry marked').toEqual({ [rid(1)]: s1, [rid(2)]: null });
    expect(metaOf(box, 'export_due'), 'the census counts the late sidecar\'s blob due').toBe('1');
    passAt(box, 130);
    expect(segmentsOf(box)).toEqual([s1, s2]);
    expect(marks(box)).toEqual({ [rid(1)]: s1, [rid(2)]: s2 });
    const side = q(box, 'SELECT lower(hex(b.sha256)) AS sha, b.exported_seg FROM sidecars s JOIN blobs b ON b.blob_id = s.blob_id')[0]!;
    expect(side['exported_seg'], 'the sidecar\'s bytes stayed store-only').toBe(s2);
    const seg2 = path.join(exportDirOf(box), s2);
    expect(segmentRows(seg2, 'entries').map((e) => e['uuid'])).toEqual([rid(2)]);
    expect(segmentRows(seg2, 'sidecars').map(pick(['name', 'uuid', 'blob_sha256'])))
      .toEqual([{ name: 'b4late01.txt', uuid: rid(2), blob_sha256: side['sha'] }]);
    expect(segmentRows(seg2, 'blobs').map((b) => b['sha256']), 'segment 2 carries only the sidecar\'s new bytes').toEqual([side['sha']]);
    expect(metaOf(box, 'export_due'), 'nothing is left due').toBe('0');
  }, 300_000);

  // Beyond the brief's list (flagged in the Task 8 report): `ins.changes === 1` in ingestSidecar's clear had no case. A
  // sidecar file rewritten with the same bytes is read again (its seen-file mark misses), but its row exists already
  // (the table's key is the transcript, the name and the blob), so it is no NEW row and clears nothing.
  it('a sidecar read again is no new row: the same file rewritten with the same bytes leaves its exported entry marked', () => {
    const again = toolResultRow({
      uuid: rid(2), ts: new Date(Date.now() - 2 * DAY).toISOString(), sessionId: U, cwd: WORK, toolUseId: 'toolu_01B4AGAIN',
      content: 'Output too large. Full output saved to: /home/u/x/tool-results/b4again1.txt',
    });
    const { box, ids } = ingestedBox('ccrc-history-export-latesc2-', [row(1, 'a prompt', 2 * DAY), again]);
    const s1 = `1.${ids.writer}.db`;
    const s2 = `2.${ids.writer}.db`;
    passAt(box, 65);
    const dir = path.join(box.accountHome['claude-a']!, 'projects', SLUG, U, 'tool-results');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'b4again1.txt');
    fs.writeFileSync(file, 'the late tool output body\n');
    passAt(box, 100);   // links the sidecar to the exported row: its marks are cleared
    passAt(box, 130);   // the entry is written again with the sidecar row
    expect(marks(box)).toEqual({ [rid(1)]: s1, [rid(2)]: s2 });
    const seenBefore = q(box, 'SELECT mtime_ns FROM sidecar_seen')[0]!['mtime_ns'];
    const later = new Date(Date.now() + 5 * MIN);
    fs.utimesSync(file, later, later);   // the same bytes under a newer mtime
    passAt(box, 165);   // the file is read again
    expect(q(box, 'SELECT mtime_ns FROM sidecar_seen')[0]!['mtime_ns'], 'the fixture must make the tick read the sidecar again').not.toEqual(seenBefore);
    expect(q(box, 'SELECT count(*) AS n FROM sidecars')[0]!['n'], 'the same bytes are no second row').toBe(1);
    expect(marks(box), 'a sidecar already stored cleared its entry\'s marks').toEqual({ [rid(1)]: s1, [rid(2)]: s2 });
  }, 300_000);
});
