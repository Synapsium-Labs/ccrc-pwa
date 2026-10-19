// server/test/history-export.test.ts — the sole-copy export (spec
// docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md §9.15, §9.2 step 6), W1-B4. Two ways in:
//   - sweep.mjs's exportPass (and, from Task 6, exportStep), imported in-process against a REAL store that real
//     scheduled passes ingested, where a case needs a clock, a budget or a statfs answer of its own: injected
//     dependencies, never a variable the shipped code reads (slug history-test-seams-not-env);
//   - the real sweep as the timer runs it (runSweep, and the run-pass driver runDriver where a case needs the pass clock
//     past the store's first hour), with the test-only preloads for faults.
// Every store lives in a mkTmp fixture HOME (makeHistoryBox); nothing reads or writes the live ~/.ccrc, and each test's
// fixture HOMEs are removed when it ends (removeTmpFixturesEachTest).
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  makeHistoryBox, runSweep, skipOnDarwin, openStoreRO, counters, journalRecords, plantSession, plantTranscript,
  exportDirOf, segmentsOf, segmentRows, runDriver, recoverRow, PRELOADS, CLI, runOnPty, strandedBlobs, strandedBlobsOn, plantSegment, type HistoryBox,
  runShim, runCli, withPane,
} from './historyHelpers.js';
import { userRow, toolResultRow, boundaryRow } from './historyFixtures.js';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';
import { EXPORT_ROW_META_BYTES, HEALTH_META, RUN_BUDGET_BYTES, RUN_BUDGET_MS, historyPaths } from '../../ccd/history/lib.mjs';
import { MIGRATIONS, closeWriter, openSegment, openWriter, pruneDryRun, segmentMeta, setMeta } from '../../ccd/history/store.mjs';
import { syncBuiltinESMExports } from 'node:module';
import { DatabaseSync as MemDb } from 'node:sqlite';
// ── W1-B4 Task 9: imports under x9 aliases, so no binding collides with Tasks 5–8 above ───────────────────────
import * as x9Fs from 'node:fs';
import * as x9Path from 'node:path';
import { createHash as x9Hash } from 'node:crypto';
import { createHash } from 'node:crypto';
import { brotliDecompressSync } from 'node:zlib';
import { DatabaseSync as X9Db } from 'node:sqlite';
import * as x9Lib from '../../ccd/history/lib.mjs';
import * as x9Store from '../../ccd/history/store.mjs';
import * as x9H from './historyHelpers.js';
// ── W5h-1 Task 1: imports under t1 aliases ───────────────────────────────────────────────────────────────────────
import { spawnSync as t1Spawn } from 'node:child_process';
import { randomBytes as t1Random } from 'node:crypto';

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

/** The one stderr line a pass the run's budget held writes (D-5394): it names BOTH limits of the budget, the time and the bytes, since
 *  either holds a pass, so a hold by the bytes does not read as one by the clock. */
const heldLine = (maxMs: number, maxBytes: number): string =>
  `history-sweep: the export pass was held by the run's budget (${maxMs} ms, ${maxBytes} bytes) before it wrote a due row; it tries again at its next interval\n`;

interface PassResult { state: string; segment: string | null; rows: number; blobs: number; bytes: number; complete: boolean }
/** The slice of sweep.mjs these tests call. It grows task by task; every member is a real export. */
interface SweepExport {
  exportPass(db: DatabaseSync, ctx: Record<string, unknown>): Promise<PassResult>;
  exportStep(db: DatabaseSync, ctx: Record<string, unknown>): Promise<PassResult | null>;
  newBudget(now?: () => number, limits?: { maxMs?: number; maxBytes?: number; chunkBytes?: number }): Record<string, unknown>;
  writeChunk(db: DatabaseSync, chunk: Record<string, unknown>): { newEntries: number; minNewTsMs: number | null };
  checkSegmentMarks(db: DatabaseSync, ctx: Record<string, unknown>, record: string): { cleared: number; segments: string[]; stopped: string | null };
  makeIngestCtx(home: string, homes: string[], nowMs: number, ids: { storeId: string; writer: string }): Record<string, unknown>;
  ingestSidecars(db: DatabaseSync, ctx: Record<string, unknown>, budget: Record<string, unknown>, uuids: string[]): Promise<{ bytes: number; complete: boolean }>;
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

/** `db` with every statement it prepares counted when it runs, in order. */
function counting(db: DatabaseSync): { db: DatabaseSync; ran: string[]; calls: Array<{ text: string; method: string }> } {
  const ran: string[] = [];
  const calls: Array<{ text: string; method: string }> = [];   // the same, with how each statement was run
  const wrap = (text: string, st: object): object => new Proxy(st, {
    get(t, p) {
      const v: unknown = Reflect.get(t, p, t);
      if (p === 'run' || p === 'get' || p === 'all' || p === 'iterate') return (...a: unknown[]): unknown => { ran.push(text); calls.push({ text, method: p }); return (v as (...x: unknown[]) => unknown).apply(t, a); };
      return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(t) : v;
    },
  });
  const proxy = new Proxy(db, {
    get(target, prop) {
      if (prop === 'prepare') return (text: string): object => wrap(text, target.prepare(text));
      const v: unknown = Reflect.get(target, prop, target);
      return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(target) : v;
    },
  });
  return { db: proxy, ran, calls };
}

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
    await onStore(box, (db) => { setMeta(db, 'export_attempt_ms', String(NOW - HOUR)); });   // a failed attempt an hour ago (D-5394)
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
    expect(metaOf(box, 'export_attempt_ms'), 'history-off is the operator\'s switch, not a pass the budget held: the attempt clock is neither written nor cleared (D-5394)').toBe(String(NOW - HOUR));
    fs.rmSync(off);
    const next = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, () => NOW)));
    expect(next).toMatchObject({ state: 'written', rows: 2 });
    expect(metaOf(box, 'export_attempt_ms'), 'a pass that ran to its end clears the attempt clock (D-5394)').toBeNull();
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
    expect(strandedBlobs(box), 'D-5395: no live blob is held only by marked entries').toEqual([]);
  }, 300_000);

  it('the check runs on the first step after a bind, and again on a step that finds a segment it saw gone, never otherwise: marks naming a present segment stay; a segment gone after the check has its marks cleared with no bind (D-5636 (history-export-vanished-rearm)); a restore\'s bind after that finds nothing left to clear', async () => {
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
    // a step with no new bind fact and every segment the check saw still here: no check runs
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(2 * MIN + 30_000))));
    expect(metaOf(box, 'export_marks_checked_ms'), 'a check ran with no bind and no segment gone').toBe(String(NOW + 2 * MIN));
    // the segment goes, with no bind since the check: the next step re-arms the check (W5h-1 Task 4, D-5636
    // (history-export-vanished-rearm)), which clears every mark naming it
    fs.rmSync(path.join(exportDirOf(box), name));
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(3 * MIN))));
    expect(Object.values(marks(box)), 'a segment gone after the check left its marks standing').toEqual([null, null]);
    expect(metaOf(box, 'export_marks_checked_ms')).toBe(String(NOW + 3 * MIN));
    expect(counters(box)['export_segment_missing']).toBe(1);
    expect(metaOf(box, HEALTH_META.exportSegmentMissing)).toBe('4');
    expect(strandedBlobs(box), 'D-5395: no live blob is held only by marked entries').toEqual([]);
    // a restore's bind: the next step checks again and finds no mark left naming the missing segment
    await onStore(box, (db) => {
      setMeta(db, `bound:${NOW + 4 * MIN}`, 'restore');
      return SW.exportStep(db, exportCtx(box, ids, at(5 * MIN)));
    });
    expect(Object.values(marks(box))).toEqual([null, null]);
    expect(q(box, 'SELECT count(*) AS n FROM blobs WHERE exported_seg IS NOT NULL')[0]!['n']).toBe(0);
    expect(counters(box)['export_segment_missing']).toBe(1);
    expect(metaOf(box, HEALTH_META.exportSegmentMissing)).toBe('4');
    expect(strandedBlobs(box), 'D-5395: no live blob is held only by marked entries').toEqual([]);
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
    // a restore whose bind fact carries a clock behind the last check's, with the segment gone. The listing record goes
    // too, so only the bind fact can arm this step: with it, the segment gone would re-arm the check whatever the bind's
    // clock (W5h-1 Task 4, D-5636 (history-export-vanished-rearm)), and this case would pin nothing about the clock.
    fs.rmSync(path.join(exportDirOf(box), name));
    await onStore(box, (db) => {
      db.prepare('DELETE FROM meta WHERE k = ?').run('export_marks_checked_listing');
      setMeta(db, `bound:${NOW + 3 * MIN}`, 'restore');
      return SW.exportStep(db, exportCtx(box, ids, at(7 * MIN)));
    });
    expect(Object.values(marks(box)), 'a bind stamped before the last check was never checked').toEqual([null, null]);
    expect(counters(box)['export_segment_missing']).toBe(1);
    expect(strandedBlobs(box), 'D-5395: no live blob is held only by marked entries').toEqual([]);
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
      // D-5725: the fixture's own first step stamped an empty check (a store with no listing record owes one), so the stamp exists; this step's is what must be absent
      expect(metaOf(box, 'export_marks_checked_ms'), 'a failed check is not a check').not.toBe(String(NOW + 2 * MIN));
      // D-5725: the fixture's own first step stamped an empty check, which covers no bind fact, so the record is '[]', not absent
      expect(metaOf(box, 'export_marks_checked_binds'), 'a failed check covers no bind fact').toBe('[]');
      expect(metaOf(box, HEALTH_META.exportMarksCheck), 'the stop is recorded unlistable, beside the count (D-5632)').toBe(`unlistable ${NOW + 2 * MIN} 0`);
      fs.rmSync(planted);
      fs.renameSync(`${planted}.kept`, planted);
      await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(3 * MIN))));
      expect(metaOf(box, 'export_marks_checked_ms'), 'the next step checks again').toBe(String(NOW + 3 * MIN));
      expect(Object.values(marks(box))).toEqual([name, name]);
      expect(metaOf(box, HEALTH_META.exportMarksCheck), 'a check that ran to its done stamp deleted the stop').toBeNull();
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
    // D-5725: the fixture's own first step stamped an empty check (a store with no listing record owes one), so the stamp exists; this step's is what must be absent
    expect(metaOf(box, 'export_marks_checked_ms'), 'a check that met busy is not a check').not.toBe(String(NOW + 2 * MIN));
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(3 * MIN))));
    expect(Object.values(marks(box)), 'the next step checks again').toEqual([null, null]);
    expect(counters(box)['export_segment_missing']).toBe(1);
    expect(strandedBlobs(box), 'D-5395: no live blob is held only by marked entries').toEqual([]);
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

  // W1-B4 whole-branch review, D-5395 (history-export-mark-needs-its-blobs): an entry keeps its mark only while every
  // blob it references is exported or pruned. Three ways the cases above left it marked over a live, unmarked blob.
  // D-5396 (history-export-bind-clears-pruned-referrers): the pruned arm used to keep the entry's mark ("a stub is all there is
  // to export"); but a pruned blob's bytes are held only by the segment its mark names (a stub is never marked), so with that segment
  // gone the entry is cleared too and the next pass writes it again with a stub.
  for (const pruned of [false, true]) {
    it(`D-5395, a bind check: segment 1 moved aside, segment 2 present: ${pruned
      ? 'the entry segment 2 marked is cleared with the blob segment 1 marked although that blob has since been pruned, and the next pass writes the entry again with a stub of it (D-5396)'
      : 'the entry segment 2 marked is cleared with the blobs segment 1 marked, because its own blob is one of them; the next pass carries that blob and the census ends at 0'}`, async () => {
      const { box, transcript, ids } = ingestedBox(`ccrc-history-export-bindref${pruned ? 'p' : ''}-`, [row(1, 'body one', 2 * DAY), row(2, 'another row', 2 * DAY)]);
      const s1 = `1.${ids.writer}.db`;
      const s2 = `2.${ids.writer}.db`;
      const s3 = `3.${ids.writer}.db`;
      passAt(box, 65);
      fs.appendFileSync(transcript, `${JSON.stringify(row(1, 'body two', 2 * DAY))}\n`);   // the late variant clears row 1
      passAt(box, 100);
      passAt(box, 130);
      expect(segmentsOf(box)).toEqual([s1, s2]);
      expect(marks(box), 'CONTROL: row 1 is marked by segment 2 (it carries the late body), row 2 by segment 1').toEqual({ [rid(1)]: s2, [rid(2)]: s1 });
      const blobMarks = (): Array<Record<string, unknown>> => q(box, `SELECT e.uuid AS uuid, b.exported_seg AS seg FROM entries e JOIN blobs b ON b.blob_id = e.blob_id ORDER BY e.uuid`);
      expect(blobMarks(), 'CONTROL: row 1\'s own blob (its first body) went with segment 1').toEqual([{ uuid: rid(1), seg: s1 }, { uuid: rid(2), seg: s1 }]);
      expect(strandedBlobs(box), 'CONTROL: the invariant holds before the bind').toEqual([]);
      if (pruned) {
        // prune took row 1's first body after segment 1 carried it: the store holds a tombstone, and segment 1 the only copy
        await onStore(box, (db) => {
          db.prepare('UPDATE blobs SET z = NULL, pruned_ms = ?, fts_indexed = 0 WHERE blob_id = (SELECT blob_id FROM entries WHERE uuid = ?)').run(Date.now(), rid(1));
        });
      }
      // D-4765's own way out: the operator moves segment 1 aside, and a bind fact makes the next step check the marks
      fs.renameSync(path.join(exportDirOf(box), s1), path.join(exportDirOf(box), `${s1}.aside`));
      await onStore(box, (db) => { setMeta(db, `bound:${Date.now() + 131 * MIN}`, 'restore'); });
      passAt(box, 131);   // the check runs first; the export's cadence still waits (its last pass at +130)
      expect(blobMarks(), 'segment 1\'s blob marks are cleared').toEqual([{ uuid: rid(1), seg: null }, { uuid: rid(2), seg: null }]);
      expect(counters(box)['export_segment_missing']).toBe(1);
      expect(strandedBlobs(box)).toEqual([]);
      if (pruned) {
        expect(marks(box), 'D-5396: row 2 is cleared with its blob, and so is row 1: its first body is pruned, but segment 1 was the only one that held that body, and segment 2 (its late body) does not carry it again')
          .toEqual({ [rid(1)]: null, [rid(2)]: null });
        expect(metaOf(box, HEALTH_META.exportSegmentMissing), 'two blobs, row 2, and row 1 whose pruned blob segment 1 held').toBe('4');
        const firstBody = String(q(box, 'SELECT lower(hex(b.sha256)) AS sha FROM entries e JOIN blobs b ON b.blob_id = e.blob_id WHERE e.uuid = ?', rid(1))[0]!['sha']);
        passAt(box, 200);
        expect(marks(box)).toEqual({ [rid(1)]: s3, [rid(2)]: s3 });
        const seg3 = path.join(exportDirOf(box), s3);
        expect(segmentRows(seg3, 'entries').map((e) => e['uuid']).sort(), 'segment 3 holds both rows').toEqual([rid(1), rid(2)]);
        const carried = segmentRows(seg3, 'blobs');
        expect(carried, 'row 2\'s first body as bytes and row 1\'s pruned first body as a stub').toHaveLength(2);
        expect(carried.filter((b) => b['z'] === null).map((b) => b['sha256']), 'the stub names the pruned blob and holds no bytes').toEqual([firstBody]);
        expect(blobMarks(), 'a stub is never marked: the pruned blob stays unmarked, so every later export of its entry carries the stub again')
          .toEqual([{ uuid: rid(1), seg: null }, { uuid: rid(2), seg: s3 }]);
      } else {
        expect(marks(box), 'and so are the marks of every entry that references one of those blobs, whichever segment marked it').toEqual({ [rid(1)]: null, [rid(2)]: null });
        expect(metaOf(box, HEALTH_META.exportSegmentMissing), 'two blobs, row 2, and row 1 whose blob segment 1 held').toBe('4');
        passAt(box, 200);
        expect(marks(box)).toEqual({ [rid(1)]: s3, [rid(2)]: s3 });
        const seg3 = path.join(exportDirOf(box), s3);
        expect(segmentRows(seg3, 'entries').map((e) => e['uuid']).sort(), 'segment 3 holds both rows').toEqual([rid(1), rid(2)]);
        expect(blobMarks(), 'and carries both first bodies; the late one stays in segment 2').toEqual([{ uuid: rid(1), seg: s3 }, { uuid: rid(2), seg: s3 }]);
        expect(segmentRows(seg3, 'blobs'), 'two bodies').toHaveLength(2);
      }
      expect(segmentsOf(box).filter((n) => !n.endsWith('.aside'))).toEqual([s2, s3]);
      expect(metaOf(box, 'export_due'), 'nothing is left due').toBe('0');
      expect(metaOf(box, HEALTH_META.exportSegmentMissing), 'the WARN clears because nothing is left, not because a pass found nothing due').toBe('0');
      expect(strandedBlobs(box)).toEqual([]);
    }, 600_000);
  }

  /** The loss of history.db (the caller removes any transcript): a rebuild on a pty, ticked until the recovery step finishes. The
   *  journal and the export directory stay. */
  async function rebuildFromSegments(box: HistoryBox): Promise<void> {
    const P = historyPaths(box.home);
    for (const f of [P.dbFile, P.wal, P.shm]) fs.rmSync(f, { force: true });
    const rebuilt = await runOnPty(box, [process.execPath, '--no-warnings', CLI, 'doctor', '--rebuild'], { timeoutMs: 120_000 });
    expect(rebuilt.code, rebuilt.out).toBe(0);
    for (let i = 0; i < 12 && recoverRow(box)?.completed_ms == null; i += 1) {
      const r = runShim(box);
      expect(r.code, `rebuild tick ${i + 1}:\n${r.stdout}\n${r.stderr}`).toBe(0);
    }
    expect(recoverRow(box)?.completed_ms, 'the recovery step finished').not.toBeNull();
  }
  /** `grep term` after a rebuild: the index is still being derived, so the verb answers 7 (fts-pending) until a few ticks have
   *  built it; ticks (at most eight) until the answer is anything else, and returns that answer. */
  function grepAfterRebuild(box: HistoryBox, term: string): ReturnType<typeof runCli> {
    let r = runCli(box, ['grep', term], { env: withPane(box, ID) });
    for (let i = 0; i < 8 && r.code === 7; i += 1) {
      const t = runShim(box);
      expect(t.code, `grep tick ${i + 1}:\n${t.stdout}\n${t.stderr}`).toBe(0);
      r = runCli(box, ['grep', term], { env: withPane(box, ID) });
    }
    return r;
  }

  // D-5396 (history-export-bind-clears-pruned-referrers), end to end on the real verbs. A pruned blob's bytes are held
  // only by the segment its mark names (a stub is never marked): an entry exported again into a later segment for a late variant does not carry that
  // blob again. With the first segment gone and the entry still marked with the second, a rebuild from the live segments
  // met the entry's first body nowhere (export_row_blob_missing) and so placed neither the entry nor its variants
  // (export_row_unplaced), the late body included. The check after a bind now clears the entry, and the next pass writes it
  // again with a stub of the pruned body. The rebuild's own marks keep that true (F1b): replay marks an entry only from a segment
  // that carries the stub, so when the segment that holds it is moved aside in turn, the entry is cleared and written again, and a
  // second rebuild places it. Before, replay marked row 1 with the first segment that carries the row (segment 2, which lacks the
  // stub), and nothing named segment 3 for it.
  it('D-5396, end to end: a late variant re-marks row 1 into segment 2, prune tombstones its first body, segment 1 is moved aside, a bind and a pass; then a rebuild from the live segments alone places row 1 and its variant, marks row 1 with the segment that carries the pruned body as a stub, and still answers "content pruned"; and when that segment is moved aside in turn, a second rebuild places row 1 again (D-5396, refined)', async () => {
    const { box, transcript, ids } = ingestedBox('ccrc-history-export-f1-', [row(1, 'zqf1first body one', 2 * DAY), row(2, 'zqf1other row', 2 * DAY)]);
    const s1 = `1.${ids.writer}.db`;
    const s2 = `2.${ids.writer}.db`;
    const s3 = `3.${ids.writer}.db`;
    passAt(box, 65);
    fs.appendFileSync(transcript, `${JSON.stringify(row(1, 'zqf1late body two', 2 * DAY))}\n`);   // the late variant clears row 1
    passAt(box, 100);
    passAt(box, 130);
    expect(segmentsOf(box)).toEqual([s1, s2]);
    expect(marks(box), 'CONTROL: row 1 is marked by segment 2 (it carries the late body), row 2 by segment 1').toEqual({ [rid(1)]: s2, [rid(2)]: s1 });
    const firstBody = String(q(box, 'SELECT lower(hex(b.sha256)) AS sha FROM entries e JOIN blobs b ON b.blob_id = e.blob_id WHERE e.uuid = ?', rid(1))[0]!['sha']);
    expect(segmentRows(path.join(exportDirOf(box), s1), 'blobs').map((b) => b['sha256']), 'CONTROL: segment 1 holds the first body as bytes').toContain(firstBody);
    expect(segmentRows(path.join(exportDirOf(box), s2), 'blobs').map((b) => b['sha256']), 'CONTROL: segment 2 does not carry it again').not.toContain(firstBody);
    await onStore(box, (db) => {   // prune took row 1's first body after segment 1 carried it
      db.prepare('UPDATE blobs SET z = NULL, pruned_ms = ?, fts_indexed = 0 WHERE blob_id = (SELECT blob_id FROM entries WHERE uuid = ?)').run(Date.now(), rid(1));
    });
    const aside = path.join(box.home, 'export-aside');   // D-4765's own way out, to a place outside the store's export directory
    fs.mkdirSync(aside);
    fs.renameSync(path.join(exportDirOf(box), s1), path.join(aside, s1));
    await onStore(box, (db) => { setMeta(db, `bound:${Date.now() + 131 * MIN}`, 'restore'); });
    passAt(box, 131);   // the bind check
    passAt(box, 200);   // the pass
    expect(segmentsOf(box), 'the live segments').toEqual([s2, s3]);
    // The loss: the transcript and history.db are gone; the journal and the export directory stay.
    fs.rmSync(transcript);
    await rebuildFromSegments(box);
    // the invariant: a rebuild from the live segments places every entry row they carry, each blob it names present as bytes or a stub
    expect(counters(box)['export_row_blob_missing'] ?? 0, 'no row met a blob no live segment holds').toBe(0);
    expect(counters(box)['export_row_unplaced'] ?? 0, 'and no row or variant was left unplaced').toBe(0);
    expect(q(box, 'SELECT uuid FROM entries ORDER BY uuid').map((e) => e['uuid']), 'both rows placed').toEqual([rid(1), rid(2)]);
    // the late body through a read verb: right after a rebuild grep answers 7 (fts-pending) until the ticks have derived the index
    const g1 = grepAfterRebuild(box, 'zqf1late');
    expect(g1.code, `the late body is found by grep once the index is built:\n${g1.stdout}\n${g1.stderr}`).toBe(0);
    expect(g1.stdout, 'and the hit names row 1').toContain(rid(1));
    expect(g1.stdout).toContain('zqf1late body two');
    const stubs = segmentRows(path.join(exportDirOf(box), s3), 'blobs').filter((b) => b['z'] === null).map((b) => b['sha256']);
    expect(stubs, 'a live segment carries the pruned first body as a stub, with no bytes').toEqual([firstBody]);
    expect(q(box, 'SELECT z IS NULL AS stub, pruned_ms IS NOT NULL AS pruned FROM blobs WHERE lower(hex(sha256)) = ?', firstBody),
      'the rebuilt store holds it body-less and pruned').toEqual([{ stub: 1, pruned: 1 }]);
    const late = q(box, `SELECT b.z AS z FROM entry_variants v JOIN entries e ON e.entry_id = v.entry_id JOIN blobs b ON b.blob_id = v.blob_id
      WHERE e.uuid = ? AND b.blob_id <> e.blob_id`, rid(1));
    expect(late, 'row 1\'s late variant is placed').toHaveLength(1);
    expect(brotliDecompressSync(Buffer.from(late[0]!['z'] as string, 'hex')).toString('utf8'), 'with its body, which only segment 2 carries').toContain('zqf1late body two');
    const ex = runCli(box, ['expand', rid(1)], { env: withPane(box, ID) });
    expect(ex.code, `${ex.stdout}\n${ex.stderr}`).toBe(0);
    expect(ex.stdout, 'expand on the pruned first body still says so').toContain('content pruned on');
    expect(strandedBlobs(box), 'D-5395: no live blob is held only by marked entries').toEqual([]);
    // D-5396 (refined): the rebuild marks row 1 with the segment that carries what it needs. Segment 2 holds row 1 but not the
    // pruned first body (its stub is in segment 3 alone), so a mark naming segment 2 would outlive the loss of segment 3.
    expect(marks(box), 'row 1 is marked by segment 3, which carries its pruned first body as a stub, not by segment 2 (the first that carries the row)')
      .toEqual({ [rid(1)]: s3, [rid(2)]: s3 });
    // The loss of segment 3 (moved aside), a bind, the check and a pass, then a second rebuild from what is left.
    fs.renameSync(path.join(exportDirOf(box), s3), path.join(aside, s3));
    await onStore(box, (db) => { setMeta(db, `bound:${Date.now() + 301 * MIN}`, 'restore'); });
    passAt(box, 301);   // the bind check clears segment 3's marks, row 1's with them
    passAt(box, 400);   // the pass writes both rows again
    passAt(box, 500);
    const again = segmentsOf(box);
    expect(again, 'the live segments: segment 2 and the one the pass wrote').toHaveLength(2);
    expect(again[0]).toBe(s2);
    const s4 = again[1]!;
    expect(segmentRows(path.join(exportDirOf(box), s4), 'entries').map((e) => e['uuid']).sort(), 'the new segment carries both rows, row 1 included').toEqual([rid(1), rid(2)]);
    expect(segmentRows(path.join(exportDirOf(box), s4), 'blobs').filter((b) => b['z'] === null).map((b) => b['sha256']),
      'with a stub of the pruned first body').toEqual([firstBody]);
    expect(marks(box), 'both rows are marked by the new segment').toEqual({ [rid(1)]: s4, [rid(2)]: s4 });
    await rebuildFromSegments(box);
    expect(counters(box)['export_row_blob_missing'] ?? 0, 'no row met a blob no live segment holds').toBe(0);
    expect(counters(box)['export_row_unplaced'] ?? 0, 'and no row or variant was left unplaced').toBe(0);
    expect(q(box, 'SELECT uuid FROM entries ORDER BY uuid').map((e) => e['uuid']), 'both rows placed').toEqual([rid(1), rid(2)]);
    const g2 = grepAfterRebuild(box, 'zqf1late');
    expect(g2.code, `the late body is found by grep after the second rebuild:\n${g2.stdout}\n${g2.stderr}`).toBe(0);
    expect(g2.stdout).toContain(rid(1));
    expect(g2.stdout).toContain('zqf1late body two');
    expect(q(box, 'SELECT z IS NULL AS stub, pruned_ms IS NOT NULL AS pruned FROM blobs WHERE lower(hex(sha256)) = ?', firstBody),
      'the second rebuild holds the first body body-less and pruned').toEqual([{ stub: 1, pruned: 1 }]);
    const late2 = q(box, `SELECT b.z AS z FROM entry_variants v JOIN entries e ON e.entry_id = v.entry_id JOIN blobs b ON b.blob_id = v.blob_id
      WHERE e.uuid = ? AND b.blob_id <> e.blob_id`, rid(1));
    expect(late2, 'row 1\'s late variant is placed again').toHaveLength(1);
    expect(brotliDecompressSync(Buffer.from(late2[0]!['z'] as string, 'hex')).toString('utf8')).toContain('zqf1late body two');
    expect(marks(box), 'both rows are marked by the segment that carries the stub').toEqual({ [rid(1)]: s4, [rid(2)]: s4 });
    const ex2 = runCli(box, ['expand', rid(1)], { env: withPane(box, ID) });
    expect(ex2.code, `${ex2.stdout}\n${ex2.stderr}`).toBe(0);
    expect(ex2.stdout, 'expand on the pruned first body says so').toContain('content pruned on');
    expect(strandedBlobs(box), 'D-5395: no live blob is held only by marked entries').toEqual([]);
  }, 1_500_000);

  // D-5396 (history-export-bind-clears-pruned-referrers), F1c: the rows of a segment that link a pruned blob to an entry ANOTHER
  // segment marked. A late variant lands after segment 1 carried row 1, and prune takes that late body before the pass: segment 2
  // holds row 1 again with its variants, the first body's (exported in segment 1, so not carried again) and the late one's, and a
  // stub of the late body. A rebuild from both marked row 1 with segment 1 at its entry row, and segment 2's variant row on the
  // pruned, unmarked late body kept that mark, because segment 2 carries the stub: but segment 1 does not. With segment 2 gone,
  // nothing named it, no pass wrote row 1 again, and the (row 1, late body) link lived in the store alone: a later rebuild dropped it.
  it('D-5396, F1c, end to end: a late variant pruned before the pass; a rebuild from segments 1 and 2 leaves row 1 unmarked (segment 2\'s variant row links the pruned late body, which segment 1 does not carry); with segment 2 moved aside a pass writes row 1 again with the link and a stub, and a second rebuild places the link', async () => {
    const { box, transcript, ids } = ingestedBox('ccrc-history-export-f1c-', [row(1, 'zqf1cfirst body one', 2 * DAY), row(2, 'zqf1cother row', 2 * DAY)]);
    const s1 = `1.${ids.writer}.db`;
    const s2 = `2.${ids.writer}.db`;
    passAt(box, 65);
    fs.appendFileSync(transcript, `${JSON.stringify(row(1, 'zqf1clate body two', 2 * DAY))}\n`);   // the late variant clears row 1
    passAt(box, 100);
    const lateBody = String(q(box, `SELECT lower(hex(b.sha256)) AS sha FROM entry_variants v JOIN entries e ON e.entry_id = v.entry_id
      JOIN blobs b ON b.blob_id = v.blob_id WHERE e.uuid = ? AND v.blob_id <> e.blob_id`, rid(1))[0]!['sha']);
    await onStore(box, (db) => {   // prune took the late body before the pass
      db.prepare('UPDATE blobs SET z = NULL, pruned_ms = ?, fts_indexed = 0 WHERE lower(hex(sha256)) = ?').run(Date.now(), lateBody);
    });
    passAt(box, 130);
    expect(segmentsOf(box)).toEqual([s1, s2]);
    expect(marks(box), 'CONTROL: row 1 is marked by segment 2, row 2 by segment 1').toEqual({ [rid(1)]: s2, [rid(2)]: s1 });
    const seg2 = path.join(exportDirOf(box), s2);
    expect(segmentRows(seg2, 'entries').map((e) => e['uuid']), 'CONTROL: segment 2 carries row 1 again').toEqual([rid(1)]);
    expect(segmentRows(seg2, 'variants').length, 'CONTROL: with both its variants, the first body\'s and the late body\'s').toBe(2);
    expect(segmentRows(seg2, 'blobs').map(pick(['sha256', 'pruned'])), 'CONTROL: and a stub of the late body alone: the first body was exported by segment 1')
      .toEqual([{ sha256: lateBody, pruned: 1 }]);
    const expectRowOneComplete = (what: string): void => {
      expect(counters(box)['export_row_blob_missing'] ?? 0, `${what}: no row met a blob no live segment holds`).toBe(0);
      expect(counters(box)['export_row_unplaced'] ?? 0, `${what}: and no row or variant was left unplaced`).toBe(0);
      expect(q(box, 'SELECT uuid FROM entries ORDER BY uuid').map((e) => e['uuid']), `${what}: both rows placed`).toEqual([rid(1), rid(2)]);
      expect(q(box, 'SELECT count(*) AS n FROM entry_variants v JOIN entries e ON e.entry_id = v.entry_id WHERE e.uuid = ?', rid(1))[0]!['n'],
        `${what}: row 1 holds both its variants, the late body\'s link included`).toBe(2);
      expect(q(box, 'SELECT z IS NULL AS stub, pruned_ms IS NOT NULL AS pruned FROM blobs WHERE lower(hex(sha256)) = ?', lateBody),
        `${what}: the late body is body-less and pruned`).toEqual([{ stub: 1, pruned: 1 }]);
      expect(strandedBlobs(box), `${what}: D-5395, no live blob is held only by marked entries`).toEqual([]);
    };
    // The loss: the transcript and history.db are gone; the journal and the export directory stay (both segments).
    fs.rmSync(transcript);
    await rebuildFromSegments(box);
    expectRowOneComplete('the first rebuild');
    expect(marks(box), 'D-5396, F1c: row 1 is NOT marked by segment 1 (the entry row marked it there, and segment 2\'s variant row then linked a pruned, unmarked blob that segment 1 does not carry); row 2 is')
      .toEqual({ [rid(1)]: null, [rid(2)]: s1 });
    // Segment 2 is moved aside (D-4765's own way out), a bind and a pass: nothing names segment 2, and row 1 is written again.
    const aside = path.join(box.home, 'export-aside');
    fs.mkdirSync(aside);
    fs.renameSync(seg2, path.join(aside, s2));
    await onStore(box, (db) => { setMeta(db, `bound:${Date.now() + 131 * MIN}`, 'restore'); });
    passAt(box, 131);   // the bind check
    passAt(box, 200);   // the pass
    const live = segmentsOf(box);
    expect(live, 'the live segments: segment 1 and the one the pass wrote').toHaveLength(2);
    expect(live[0]).toBe(s1);
    const again = path.join(exportDirOf(box), live[1]!);
    expect(segmentRows(again, 'entries').map((e) => e['uuid']), 'the new segment carries row 1 again').toEqual([rid(1)]);
    expect(segmentRows(again, 'variants').length, 'with both its variants').toBe(2);
    expect(segmentRows(again, 'blobs').map(pick(['sha256', 'pruned'])), 'and a stub of the late body').toEqual([{ sha256: lateBody, pruned: 1 }]);
    expect(marks(box), 'row 1 is marked by it').toEqual({ [rid(1)]: live[1], [rid(2)]: s1 });
    await rebuildFromSegments(box);
    expectRowOneComplete('the second rebuild');
    // The cost of the rule, measured: only the segment being replayed is open, so segment 1 (which marked row 1 at its entry row)
    // and the new segment's variant row on the pruned late body meet again, and row 1 reads unmarked once more. It is one more
    // export, never a loss: the new segment still holds the link and the stub.
    expect(marks(box), 'the second rebuild: the same shape again (the new segment\'s variant row, row 1 marked by segment 1), so row 1 is unmarked once more')
      .toEqual({ [rid(1)]: null, [rid(2)]: s1 });
    passAt(box, 270);   // the pass writes row 1 a third time; its entry row now meets an unmarked entry in the segment that carries the stub
    const third = segmentsOf(box);
    expect(third, 'the live segments: the two before and the third').toHaveLength(3);
    expect(segmentRows(path.join(exportDirOf(box), third[2]!), 'entries').map((e) => e['uuid']), 'the third carries row 1 again').toEqual([rid(1)]);
    await rebuildFromSegments(box);
    expectRowOneComplete('the third rebuild');
    expect(marks(box), 'the third rebuild marks row 1 with the third segment: its entry row meets the unmarked entry the second segment\'s variant row left, and every variant row of it names a blob it carries')
      .toEqual({ [rid(1)]: third[2], [rid(2)]: s1 });
    passAt(box, 340);
    expect(segmentsOf(box), 'and the next pass finds nothing due: the cost was one export').toEqual(third);
  }, 1_500_000);

  it('D-5395, a revived tombstone (writeChunk): a row whose blob prune tombstoned before its export went with a stub; a swap copy that stores the bytes again clears that row\'s mark, and an exported blob that was pruned and revived clears nothing; the next pass carries the bytes', async () => {
    const { box, transcript, ids } = ingestedBox('ccrc-history-export-revive-', [row(1, 'kept text', 2 * DAY), row(2, 'pruned text', 2 * DAY)]);
    const s1 = `1.${ids.writer}.db`;
    const s2 = `2.${ids.writer}.db`;
    const tombstone = (uuid: string) => onStore(box, (db) => {
      // B2 Task 20's tombstone, as prune --apply writes it
      db.prepare('UPDATE blobs SET z = NULL, pruned_ms = ?, fts_indexed = 0 WHERE blob_id = (SELECT blob_id FROM entries WHERE uuid = ?)').run(Date.now(), uuid);
    });
    await tombstone(rid(2));   // never exported: its row travels with a stub
    passAt(box, 65);
    expect(marks(box)).toEqual({ [rid(1)]: s1, [rid(2)]: s1 });
    expect(q(box, 'SELECT b.exported_seg AS exported_seg FROM blobs b JOIN entries e ON e.blob_id = b.blob_id WHERE e.uuid = ? AND b.z IS NULL', rid(2)), 'CONTROL: the stub is no mark')
      .toEqual([{ exported_seg: null }]);
    await tombstone(rid(1));   // exported, THEN pruned: its bytes are in segment 1
    // the swap copy: the same transcript, byte for byte, under another account's home
    const copy = path.join(box.accountHome['claude-b']!, 'projects', SLUG, `${U}.jsonl`);
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.copyFileSync(transcript, copy);
    passAt(box, 100);
    expect(q(box, 'SELECT count(*) AS n FROM blobs WHERE z IS NULL')[0]!['n'], 'the fixture must revive both tombstones').toBe(0);
    expect(marks(box), 'the exported blob keeps its row marked; the never-exported one clears its row\'s').toEqual({ [rid(1)]: s1, [rid(2)]: null });
    expect(strandedBlobs(box)).toEqual([]);
    passAt(box, 130);
    expect(segmentsOf(box)).toEqual([s1, s2]);
    expect(marks(box)).toEqual({ [rid(1)]: s1, [rid(2)]: s2 });
    const seg2 = path.join(exportDirOf(box), s2);
    expect(segmentRows(seg2, 'entries').map((e) => e['uuid'])).toEqual([rid(2)]);
    const sha2 = String(q(box, 'SELECT lower(hex(b.sha256)) AS sha FROM entries e JOIN blobs b ON b.blob_id = e.blob_id WHERE e.uuid = ?', rid(2))[0]!['sha']);
    expect(segmentRows(seg2, 'blobs').map(pick(['sha256', 'pruned'])), 'segment 2 carries the revived bytes').toEqual([{ sha256: sha2, pruned: 0 }]);
    expect(metaOf(box, 'export_due'), 'nothing is left due').toBe('0');
    expect(strandedBlobs(box)).toEqual([]);
  }, 600_000);

  // D-5397 (history-export-replay-bytes-before-stubs). The exporter's real order: a row that fell due after prune travels with a
  // stub (D-4759); ingest's revival on recapture clears its mark (D-5395); the next pass carries the recaptured bytes in a later
  // segment. A rebuild from those two segments must give the text back, though the stub comes first.
  it('D-5397, end to end: a row due after prune travels with a stub in segment 1, a swap copy revives the body and segment 2 carries its bytes; then a rebuild from the two segments alone returns the text, marked by segment 2, and expand prints it', async () => {
    const { box, transcript, ids } = ingestedBox('ccrc-history-export-f2-', [row(1, 'zqf2kept text', 2 * DAY), row(2, 'zqf2pruned then revived text', 2 * DAY)]);
    const s1 = `1.${ids.writer}.db`;
    const s2 = `2.${ids.writer}.db`;
    await onStore(box, (db) => {   // prune took row 2's body before its export
      db.prepare('UPDATE blobs SET z = NULL, pruned_ms = ?, fts_indexed = 0 WHERE blob_id = (SELECT blob_id FROM entries WHERE uuid = ?)').run(Date.now(), rid(2));
    });
    const body = String(q(box, 'SELECT lower(hex(b.sha256)) AS sha FROM entries e JOIN blobs b ON b.blob_id = e.blob_id WHERE e.uuid = ?', rid(2))[0]!['sha']);
    passAt(box, 65);
    const copy = path.join(box.accountHome['claude-b']!, 'projects', SLUG, `${U}.jsonl`);   // the swap copy that stores the body again
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.copyFileSync(transcript, copy);
    passAt(box, 100);
    passAt(box, 130);
    expect(segmentsOf(box)).toEqual([s1, s2]);
    const bodyIn = (seg: string): Array<Record<string, unknown>> => segmentRows(path.join(exportDirOf(box), seg), 'blobs').filter((b) => b['sha256'] === body).map(pick(['pruned']));
    expect([bodyIn(s1), bodyIn(s2)], 'CONTROL: segment 1 carries the body as a stub, segment 2 as bytes').toEqual([[{ pruned: 1 }], [{ pruned: 0 }]]);
    expect(marks(box), 'CONTROL: the revival cleared row 2\'s mark and segment 2 re-marked it').toEqual({ [rid(1)]: s1, [rid(2)]: s2 });
    // The loss: both copies of the text and history.db are gone; the journal and the export directory stay.
    fs.rmSync(transcript);
    fs.rmSync(copy);
    const P = historyPaths(box.home);
    for (const f of [P.dbFile, P.wal, P.shm]) fs.rmSync(f, { force: true });
    const rebuilt = await runOnPty(box, [process.execPath, '--no-warnings', CLI, 'doctor', '--rebuild'], { timeoutMs: 120_000 });
    expect(rebuilt.code, rebuilt.out).toBe(0);
    for (let i = 0; i < 12 && recoverRow(box)?.completed_ms == null; i += 1) {
      const r = runShim(box);
      expect(r.code, `rebuild tick ${i + 1}:\n${r.stdout}\n${r.stderr}`).toBe(0);
    }
    expect(recoverRow(box)?.completed_ms, 'the recovery step finished').not.toBeNull();
    expect(q(box, 'SELECT z IS NULL AS stub, pruned_ms IS NOT NULL AS pruned, exported_seg FROM blobs WHERE lower(hex(sha256)) = ?', body),
      'the body holds its bytes, and segment 2 marked them').toEqual([{ stub: 0, pruned: 0, exported_seg: s2 }]);
    expect(marks(box), 'row 2 is marked by the first segment that carries it').toEqual({ [rid(1)]: s1, [rid(2)]: s1 });
    expect(counters(box)['export_row_blob_missing'] ?? 0).toBe(0);
    expect(counters(box)['export_row_unplaced'] ?? 0).toBe(0);
    expect(counters(box)['export_blob_tombstone_kept'] ?? 0, 'no tombstone was held before the replay').toBe(0);
    const ex = runCli(box, ['expand', rid(2)], { env: withPane(box, ID) });
    expect(ex.code, `${ex.stdout}\n${ex.stderr}`).toBe(0);
    expect(ex.stdout, 'expand prints the text the stub would have hidden').toContain('zqf2pruned then revived text');
    expect(ex.stdout).not.toContain('content pruned on');
    expect(strandedBlobs(box)).toEqual([]);
  }, 900_000);

  it('D-5395, a revived tombstone (ingestSidecar): a linked sidecar whose blob prune tombstoned before the export went with a stub; the same bytes under another name store the blob again and clear the entry that links the first; the next pass carries the bytes', async () => {
    const tr = toolResultRow({
      uuid: rid(2), ts: new Date(Date.now() - 2 * DAY).toISOString(), sessionId: U, cwd: WORK, toolUseId: 'toolu_01B4REVIVE',
      content: 'Output too large. Full output saved to: /home/u/x/tool-results/b4rev001.txt',
    });
    const dirOf = (b: HistoryBox): string => path.join(b.accountHome['claude-a']!, 'projects', SLUG, U, 'tool-results');
    const BODY = 'the tool output of the revive case\n';
    const { box, ids } = ingestedBox('ccrc-history-export-revives-', [row(1, 'a prompt', 2 * DAY), tr], {
      passes: 3,
      plant: (b) => { fs.mkdirSync(dirOf(b), { recursive: true }); fs.writeFileSync(path.join(dirOf(b), 'b4rev001.txt'), BODY); },
    });
    const s1 = `1.${ids.writer}.db`;
    const s2 = `2.${ids.writer}.db`;
    expect(q(box, 'SELECT s.name, e.uuid FROM sidecars s LEFT JOIN entries e ON e.entry_id = s.entry_id'), 'the fixture must link the sidecar to the tool_result row')
      .toEqual([{ name: 'b4rev001.txt', uuid: rid(2) }]);
    await onStore(box, (db) => {
      db.prepare("UPDATE blobs SET z = NULL, pruned_ms = ?, fts_indexed = 0 WHERE blob_id = (SELECT blob_id FROM sidecars WHERE name = 'b4rev001.txt')").run(Date.now());
    });
    passAt(box, 65);
    expect(marks(box)).toEqual({ [rid(1)]: s1, [rid(2)]: s1 });
    fs.writeFileSync(path.join(dirOf(box), 'b4rev002.txt'), BODY);   // the same bytes, under a name no row names
    passAt(box, 100);
    expect(q(box, 'SELECT name, entry_id IS NULL AS unlinked FROM sidecars ORDER BY name'), 'the fixture must read the second file')
      .toEqual([{ name: 'b4rev001.txt', unlinked: 0 }, { name: 'b4rev002.txt', unlinked: 1 }]);
    expect(q(box, 'SELECT count(*) AS n FROM blobs WHERE z IS NULL')[0]!['n'], 'the fixture must revive the tombstone').toBe(0);
    expect(marks(box), 'the entry that links the revived blob is cleared').toEqual({ [rid(1)]: s1, [rid(2)]: null });
    expect(strandedBlobs(box)).toEqual([]);
    passAt(box, 130);
    expect(segmentsOf(box)).toEqual([s1, s2]);
    expect(marks(box)).toEqual({ [rid(1)]: s1, [rid(2)]: s2 });
    const seg2 = path.join(exportDirOf(box), s2);
    const sha = String(q(box, 'SELECT lower(hex(b.sha256)) AS sha FROM sidecars s JOIN blobs b ON b.blob_id = s.blob_id WHERE s.name = ?', 'b4rev001.txt')[0]!['sha']);
    expect(segmentRows(seg2, 'blobs').map(pick(['sha256', 'pruned'])), 'segment 2 carries the revived bytes').toEqual([{ sha256: sha, pruned: 0 }]);
    expect(segmentRows(seg2, 'sidecars').map(pick(['name', 'uuid'])).sort((a, b) => String(a['name']).localeCompare(String(b['name']))),
      'beside the linked sidecar row, the unlinked one that names the same blob').toEqual([{ name: 'b4rev001.txt', uuid: rid(2) }, { name: 'b4rev002.txt', uuid: null }]);
    expect(metaOf(box, 'export_due'), 'nothing is left due').toBe('0');
    expect(strandedBlobs(box)).toEqual([]);
  }, 600_000);

  // ── W1-B4 fix round 1, F6 (review 614): D-5399 (history-export-late-unlinked-sidecar-clears-blob-mark) ─────────────────
  // D-4761 sends an unlinked sidecar row with the blob it names. A LATER unlinked row naming a blob an earlier carrier already
  // exported was never offered again: the unlinked run keeps only unexported blobs and the census counts by the blob's mark. So
  // ingestSidecar's transaction takes a live, exported blob's mark off when it stores a NEW unlinked row naming it, with the marks of
  // the entries that reference it (D-5395's invariant); the next pass then carries the bytes once with every unlinked row naming
  // them. The cases below take the sidecar files in-process through the tick's own ingestSidecars (the real function, on a counting
  // handle) after one real export pass, and read the statements it ran as well as the marks it left.
  const BODY_5399 = 'the tool output a later sidecar repeats byte for byte\n';
  const sideDir5399 = (b: HistoryBox): string => path.join(b.accountHome['claude-a']!, 'projects', SLUG, U, 'tool-results');
  const toolResult5399 = (n: number, file: string): Record<string, unknown> => toolResultRow({
    uuid: rid(n), ts: new Date(Date.now() - 2 * DAY).toISOString(), sessionId: U, cwd: WORK, toolUseId: `toolu_01B4D5399${n}`,
    content: `Output too large. Full output saved to: /home/u/x/tool-results/${file}`,
  });
  /** A box whose rows are exported once: row 1 a prompt, row 2 a tool_result naming `b4s5399a.txt`, whose file (BODY_5399) is the blob's
   *  first carrier (a LINKED sidecar); row 3, with `late`, names a file that has not landed. Segment 1 holds everything. */
  function exportedWithSidecar(prefix: string, o: { late?: boolean } = {}): { box: HistoryBox; ids: { storeId: string; writer: string }; s1: string; blobSha: string } {
    const rows = [row(1, 'a prompt', 2 * DAY), toolResult5399(2, 'b4s5399a.txt'), ...(o.late === true ? [toolResult5399(3, 'b4s5399c.txt')] : [])];
    const { box, ids } = ingestedBox(prefix, rows, {
      passes: 3,
      plant: (b) => { fs.mkdirSync(sideDir5399(b), { recursive: true }); fs.writeFileSync(path.join(sideDir5399(b), 'b4s5399a.txt'), BODY_5399); },
    });
    expect(q(box, 'SELECT s.name, e.uuid FROM sidecars s LEFT JOIN entries e ON e.entry_id = s.entry_id'), 'the fixture must link the first carrier to the tool_result row')
      .toEqual([{ name: 'b4s5399a.txt', uuid: rid(2) }]);
    passAt(box, 65);
    const s1 = `1.${ids.writer}.db`;
    const blobSha = String(q(box, 'SELECT lower(hex(b.sha256)) AS sha FROM sidecars s JOIN blobs b ON b.blob_id = s.blob_id')[0]!['sha']);
    expect(Object.values(marks(box)), 'CONTROL: every row exported').toEqual(Array(rows.length).fill(s1));
    expect(q(box, 'SELECT exported_seg AS seg FROM blobs WHERE lower(hex(sha256)) = ?', blobSha), 'CONTROL: the first carrier exported the blob').toEqual([{ seg: s1 }]);
    return { box, ids, s1, blobSha };
  }
  /** The tick's sidecar step, in-process, on a handle that records the statements: `file` (created or rewritten with `body`, its
   *  mtime moved on when it existed) is taken as the tick takes it. Answers the statements that matter, as short labels. */
  async function takeSidecar5399(box: HistoryBox, ids: { storeId: string; writer: string }, file: string, body: string, db?: DatabaseSync): Promise<string[]> {
    const p5399 = path.join(sideDir5399(box), file);
    const existed = fs.existsSync(p5399);
    fs.mkdirSync(sideDir5399(box), { recursive: true });
    fs.writeFileSync(p5399, body);
    if (existed) { const later = new Date(Date.now() + 5 * MIN); fs.utimesSync(p5399, later, later); }   // the same bytes under a newer mtime: read again
    const run = async (handle: DatabaseSync): Promise<string[]> => {
      const w = counting(handle);
      const r = await SW.ingestSidecars(w.db, SW.makeIngestCtx(box.home, box.homes, Date.now(), ids), SW.newBudget(), [U]);
      expect(r.complete, 'the sidecar step ran to its end').toBe(true);
      return w.ran.flatMap((t) => {
        if (/^INSERT INTO sidecars /.test(t)) return ['row'];
        if (/^UPDATE blobs SET exported_ms = NULL, exported_seg = NULL WHERE blob_id = \?/.test(t)) return ['blob-unmark'];
        if (/^UPDATE entries SET exported_ms = NULL, exported_seg = NULL WHERE entry_id = \?/.test(t)) return ['entry-clear'];
        if (/^UPDATE entries SET exported_ms = NULL, exported_seg = NULL WHERE exported_ms IS NOT NULL/.test(t)) return ['referrer-clear'];
        if (/^INSERT INTO sidecar_seen /.test(t)) return ['seen'];
        return [];
      });
    };
    return db === undefined ? onStore(box, run) : run(db);
  }
  const blobMarkOf5399 = (box: HistoryBox, sha: string): unknown => q(box, 'SELECT exported_seg AS seg FROM blobs WHERE lower(hex(sha256)) = ?', sha)[0]!['seg'];

  it('D-5399, ingest: a NEW unlinked row naming a live, exported blob takes the blob\'s mark off and the marks of the entries that reference it, in the ingest transaction; the census counts the blob due again; the next pass carries the bytes ONCE with the new row and the entry\'s linked one', async () => {
    const { box, ids, s1, blobSha } = exportedWithSidecar('ccrc-history-export-d5399a-');
    const s2 = `2.${ids.writer}.db`;
    const labels = await takeSidecar5399(box, ids, 'b4s5399b.txt', BODY_5399);
    expect(q(box, 'SELECT name, entry_id IS NULL AS unlinked FROM sidecars ORDER BY name'), 'the fixture must store the new row unlinked, on the same blob')
      .toEqual([{ name: 'b4s5399a.txt', unlinked: 0 }, { name: 'b4s5399b.txt', unlinked: 1 }]);
    expect(q(box, 'SELECT count(DISTINCT blob_id) AS n FROM sidecars')[0]!['n']).toBe(1);
    expect(blobMarkOf5399(box, blobSha), 'the blob\'s mark is off').toBeNull();
    expect(strandedBlobs(box), 'D-5395: no live blob is held only by marked entries (the blob is unmarked, so every entry that references it is too)').toEqual([]);
    expect(marks(box), 'the mark of the one entry that references it (row 2, through its linked sidecar) is off with it; row 1 keeps segment 1').toEqual({ [rid(1)]: s1, [rid(2)]: null });
    expect(labels, 'the unlinked row, then the blob\'s mark off, then the four statements that take the referrers\' marks off, then the seen mark: one transaction, in this order')
      .toEqual(['row', 'blob-unmark', 'referrer-clear', 'referrer-clear', 'referrer-clear', 'referrer-clear', 'seen']);
    expect(metaOf(box, 'export_due'), 'the census has not run since (it runs in the tick)').toBe('0');
    passAt(box, 100);   // a tick: the census sees the blob due
    expect(metaOf(box, 'export_due'), 'the census counts the blob due again').toBe('1');
    passAt(box, 130);   // the pass
    expect(segmentsOf(box)).toEqual([s1, s2]);
    const seg2 = path.join(exportDirOf(box), s2);
    expect(segmentRows(seg2, 'blobs').map((b) => b['sha256']), 'segment 2 carries the blob\'s bytes once').toEqual([blobSha]);
    expect(segmentRows(seg2, 'sidecars').map(pick(['name', 'uuid'])).sort((a, b) => String(a['name']).localeCompare(String(b['name']))),
      'with the new unlinked row and the linked one of the entry it re-exports').toEqual([{ name: 'b4s5399a.txt', uuid: rid(2) }, { name: 'b4s5399b.txt', uuid: null }]);
    expect(segmentRows(seg2, 'entries').map((e) => e['uuid']), 'the entry that references the blob is written again; row 1 stays in segment 1').toEqual([rid(2)]);
    expect(marks(box)).toEqual({ [rid(1)]: s1, [rid(2)]: s2 });
    expect(blobMarkOf5399(box, blobSha), 'the blob is marked by the segment that carried it again').toBe(s2);
    expect(metaOf(box, 'export_due'), 'nothing is left due').toBe('0');
    expect(strandedBlobs(box)).toEqual([]);
  }, 600_000);

  it('D-5399, ingest: SEVERAL new unlinked rows for one blob, each in its own tick before the next pass, cost ONE re-export: the first clears the blob\'s mark and its referrers\', the later ones find it clear and run no referrer statement, and the next pass writes the blob once, in one segment, with every unlinked row naming it', async () => {
    const { box, ids, s1, blobSha } = exportedWithSidecar('ccrc-history-export-d5399b-');
    const s2 = `2.${ids.writer}.db`;
    const first = await takeSidecar5399(box, ids, 'b4s5399b.txt', BODY_5399);
    expect(first.filter((l) => l === 'referrer-clear'), 'the first row clears the referrers').toHaveLength(4);
    const second = await takeSidecar5399(box, ids, 'b4s5399d.txt', BODY_5399);
    const third = await takeSidecar5399(box, ids, 'b4s5399e.txt', BODY_5399);
    expect(second, 'the second row: the blob\'s mark is off already, so the statement changes nothing and no referrer is looked at').toEqual(['row', 'blob-unmark', 'seen']);
    expect(third).toEqual(['row', 'blob-unmark', 'seen']);
    expect(q(box, 'SELECT count(*) AS n FROM sidecars WHERE entry_id IS NULL')[0]!['n'], 'the fixture must store three unlinked rows').toBe(3);
    expect(blobMarkOf5399(box, blobSha)).toBeNull();
    passAt(box, 130);   // one pass
    expect(segmentsOf(box), 'ONE segment for all of them').toEqual([s1, s2]);
    const seg2 = path.join(exportDirOf(box), s2);
    expect(segmentRows(seg2, 'blobs').map((b) => b['sha256']), 'the blob\'s bytes once').toEqual([blobSha]);
    expect(segmentRows(seg2, 'sidecars').map(pick(['name', 'uuid'])).sort((a, b) => String(a['name']).localeCompare(String(b['name']))),
      'every unlinked row that names it, and the entry\'s linked one').toEqual([
      { name: 'b4s5399a.txt', uuid: rid(2) }, { name: 'b4s5399b.txt', uuid: null }, { name: 'b4s5399d.txt', uuid: null }, { name: 'b4s5399e.txt', uuid: null }]);
    expect(segmentRows(seg2, 'entries').map((e) => e['uuid']), 'and the one entry once').toEqual([rid(2)]);
    expect(metaOf(box, 'export_due'), 'nothing is left due').toBe('0');
    expect(strandedBlobs(box)).toEqual([]);
  }, 600_000);

  it('D-5399, ingest: a row stored already (the same file rewritten with the same bytes), a LINKED new row (D-4763 as before: only its entry\'s marks), and a new row on a FRESH blob take no blob\'s mark off and run no blob statement', async () => {
    const { box, ids, s1, blobSha } = exportedWithSidecar('ccrc-history-export-d5399c-', { late: true });
    // a new LINKED row on the exported blob: row 3 names b4s5399c.txt, which lands now with the same bytes
    const linked = await takeSidecar5399(box, ids, 'b4s5399c.txt', BODY_5399);
    expect(linked, 'D-4763: the entry\'s marks (the one entry statement), nothing on the blob').toEqual(['row', 'entry-clear', 'seen']);
    expect(q(box, 'SELECT name, entry_id IS NULL AS unlinked FROM sidecars ORDER BY name'), 'the fixture must link it').toEqual([{ name: 'b4s5399a.txt', unlinked: 0 }, { name: 'b4s5399c.txt', unlinked: 0 }]);
    expect(marks(box), 'only the entry it links lost its mark').toEqual({ [rid(1)]: s1, [rid(2)]: s1, [rid(3)]: null });
    expect(blobMarkOf5399(box, blobSha), 'a linked row leaves the blob\'s mark').toBe(s1);
    // a new UNLINKED row on a FRESH blob: no mark to take off, so no blob statement
    const fresh = await takeSidecar5399(box, ids, 'b4s5399f.txt', 'bytes no other file holds\n');
    expect(fresh, 'a fresh blob costs the row and the seen mark, as before').toEqual(['row', 'seen']);
    expect(marks(box)).toEqual({ [rid(1)]: s1, [rid(2)]: s1, [rid(3)]: null });
    // the unlinked row of a blob that is exported and then read again
    const first = await takeSidecar5399(box, ids, 'b4s5399b.txt', BODY_5399);
    expect(first.includes('blob-unmark'), 'CONTROL: the first read of an unlinked row on the exported blob takes its mark off').toBe(true);
    passAt(box, 130);
    const s2 = segmentsOf(box).map((n) => path.basename(n)).filter((n) => n !== s1);
    expect(s2, 'the pass wrote the blob again').toHaveLength(1);
    expect(blobMarkOf5399(box, blobSha), 'CONTROL: the blob is marked again').toBe(s2[0]);
    const before = marks(box);
    const again = await takeSidecar5399(box, ids, 'b4s5399b.txt', BODY_5399);   // read again under a newer mtime: the row exists
    expect(again, 'the row exists (the key is the transcript, the name and the blob): the insert changes nothing and nothing else runs').toEqual(['row', 'seen']);
    expect(blobMarkOf5399(box, blobSha), 'a row stored already took no mark off').toBe(s2[0]);
    expect(marks(box)).toEqual(before);
    expect(strandedBlobs(box)).toEqual([]);
  }, 600_000);

  it('D-5399, ingest: a row whose blob is PRUNED takes no mark off (the live probe is made to lie, because the real ingest revives the tombstone before it stores the row); a tombstone the new row\'s own bytes revive is live again and is taken off with its referrers\'', async () => {
    const { box, ids, s1, blobSha } = exportedWithSidecar('ccrc-history-export-d5399d-');
    await onStore(box, (db) => {   // prune took the exported blob's bytes: the tombstone keeps its mark
      db.prepare('UPDATE blobs SET z = NULL, pruned_ms = ?, fts_indexed = 0 WHERE lower(hex(sha256)) = ?').run(Date.now(), blobSha);
    });
    // The lie: the tick's probe for a live blob (stmts(db).blobLive) answers a row, so the bytes are not stored and the row is
    // stored against the tombstone, the one shape the transaction's own guard (z IS NOT NULL) is for.
    const liar = (db: DatabaseSync): DatabaseSync => new Proxy(db, {
      get(t, k) {
        if (k === 'prepare') {
          return (sql: string): object => {
            const st = t.prepare(sql);
            if (sql !== 'SELECT blob_id FROM blobs WHERE sha256 = ? AND z IS NOT NULL') return st;
            return new Proxy(st, { get(x, m) { const v: unknown = Reflect.get(x, m, x); return m === 'get' ? (): object => ({ blob_id: 1 }) : typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(x) : v; } });
          };
        }
        const v: unknown = Reflect.get(t, k, t);
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
      },
    });
    const lied = await onStore(box, async (db) => takeSidecar5399(box, ids, 'b4s5399b.txt', BODY_5399, liar(db)));
    expect(q(box, 'SELECT name, entry_id IS NULL AS unlinked FROM sidecars ORDER BY name'), 'the fixture must store the row, unlinked, against the tombstone')
      .toEqual([{ name: 'b4s5399a.txt', unlinked: 0 }, { name: 'b4s5399b.txt', unlinked: 1 }]);
    expect(q(box, 'SELECT z IS NULL AS stub FROM blobs WHERE lower(hex(sha256)) = ?', blobSha), 'and the blob is still a tombstone').toEqual([{ stub: 1 }]);
    expect(lied, 'the statement ran and changed nothing: no referrer was looked at').toEqual(['row', 'blob-unmark', 'seen']);
    expect(blobMarkOf5399(box, blobSha), 'a pruned blob keeps its mark').toBe(s1);
    expect(marks(box), 'and so do its referrers').toEqual({ [rid(1)]: s1, [rid(2)]: s1 });
    // The real shape: no lie. The file's bytes are in hand, so the tombstone is revived (D-4589) and the blob is live and, being
    // exported, marked: the new row takes the mark off, with the referrers'.
    const revived = await takeSidecar5399(box, ids, 'b4s5399g.txt', BODY_5399);
    expect(revived.includes('blob-unmark') && revived.filter((l) => l === 'referrer-clear').length === 4, 'the revived blob is taken off with its referrers').toBe(true);
    expect(q(box, 'SELECT z IS NULL AS stub FROM blobs WHERE lower(hex(sha256)) = ?', blobSha), 'the fixture must revive the tombstone').toEqual([{ stub: 0 }]);
    expect(blobMarkOf5399(box, blobSha)).toBeNull();
    expect(marks(box)).toEqual({ [rid(1)]: s1, [rid(2)]: null });
    expect(strandedBlobs(box)).toEqual([]);
  }, 600_000);
});

// ── W1-B4 Task 9: the census's oldest due-since, and status --json's export block (spec §9.6, §9.15) ─────────────
// The census case runs sweep.mjs's exportCensus in-process against a real store; the status cases spawn the real
// CLI, as doctor does. Every HOME is a fixture (makeHistoryBox); nothing reads or writes the live ~/.ccrc.
interface X9Sweep {
  exportCensus(db: X9Db, nowMs: number, budget: Record<string, unknown>): boolean;
  newBudget(now?: () => number, limits?: { maxMs?: number; maxBytes?: number; chunkBytes?: number }): Record<string, unknown>;
}
interface X9Item { word: string; detail: string; remedy: string }
interface X9Export {
  due_blobs: number; segments: number | null; segment_bytes: number | null;
  last_pass_ms: number | null; due_oldest_ms: number | null | 'unmeasured'; paused_low_disk: boolean;
}
interface X9Envelope { exit: number; export: Record<string, X9Export>; health: { pass: string | null; warn: X9Item[]; fail: X9Item[] } }
const X9_MIN = 60_000;
const X9_HOUR = 3_600_000;

describe('W1-B4 Task 9: the census records when the oldest due blob became due (spec §9.15 "The gap guard")', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });

  /** A store holding two due blobs, each with one referrer row in a transcript of its own whose one file is present
   *  and was last written five and three hours ago (so neither is overdue), and a census in progress over one 30-day
   *  home (horizon 0). Under the per-copy rule (B2's D-4735 (history-export-due-per-copy)) each row is due from its file's last
   *  write, so the two rows need two files to fall due at two times. Each time is whole seconds, so a file's mtime
   *  set by utimes reads back exactly. `cursor` is the census state as a pass left it. Runs exportCensus to its end;
   *  answers the two meta values. */
  async function x9Census(prefix: string, cursor: (ids: { a: number; b: number }, home: string) => Record<string, unknown>):
    Promise<{ due: string | null; oldest: string | null; tA: number; tB: number }> {
    const sw = (await import('../../ccd/history/sweep.mjs')) as unknown as X9Sweep;
    const box = x9H.makeHistoryBox(prefix);
    x9Store.createStore(box.home);
    const home = box.homes[0]!;
    const now = Date.now();
    const tA = Math.floor((now - 5 * X9_HOUR) / 1000) * 1000;
    const tB = Math.floor((now - 3 * X9_HOUR) / 1000) * 1000;
    const db = x9Store.openWriter(x9Lib.historyPaths(box.home).dbFile);
    try {
      /** One transcript with one present file of `home`, last written at `atMs`: its rows' per-copy clock. */
      const transcript = (uuid: string, name: string, ino: number, atMs: number): { t: number; f: number } => {
        const file = x9Path.join(home, 'projects', '-home-u-tree-demo', name);
        x9Fs.mkdirSync(x9Path.dirname(file), { recursive: true });
        x9Fs.writeFileSync(file, '{}\n');
        x9Fs.utimesSync(file, atMs / 1000, atMs / 1000);
        const t = Number(db.prepare('INSERT INTO transcripts (cc_session_uuid) VALUES (?)').run(uuid).lastInsertRowid);
        const f = Number(db.prepare("INSERT INTO ingest_files (dev, ino, source_key, transcript_pk, status, parser_version) VALUES (1, ?, '', ?, 'live', 1)")
          .run(ino, t).lastInsertRowid);
        db.prepare('INSERT INTO file_paths (path, file_id, last_seen_ms) VALUES (?, ?, ?)').run(file, f, now);
        return { t, f };
      };
      const older = transcript('90909090-0000-4000-8000-000000000001', 'x9-census-a.jsonl', 2, tA);
      const younger = transcript('90909090-0000-4000-8000-000000000002', 'x9-census-b.jsonl', 3, tB);
      const blob = (text: string): number => Number(db.prepare('INSERT INTO blobs (sha256, codec, z, raw_len) VALUES (?, ?, ?, ?)')
        .run(x9Hash('sha256').update(text).digest(), x9Store.CODEC, x9Store.brotli(Buffer.from(text)), Buffer.byteLength(text)).lastInsertRowid);
      const a = blob('x9 the older due row');
      const b = blob('x9 the younger due row');
      const entry = (uuid: string, at: { t: number; f: number }, blobId: number, tsMs: number): void => {
        db.prepare("INSERT INTO entries (uuid, transcript_pk, type, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms) VALUES (?, ?, 'user', 'operator', 1, 1, ?, ?, ?)")
          .run(uuid, at.t, at.f, blobId, tsMs);
      };
      entry('90909090-0000-4000-8000-0000000000a1', older, a, tA);
      entry('90909090-0000-4000-8000-0000000000b1', younger, b, tB);
      db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('export-census', 1, ?, NULL)")
        .run(JSON.stringify(cursor({ a, b }, home)));
      expect(sw.exportCensus(db, now, sw.newBudget(() => now)), 'the census ran to its end').toBe(true);
      return { due: x9Store.getMeta(db, 'export_due'), oldest: x9Store.getMeta(db, x9Lib.HEALTH_META.exportDueOldestMs), tA, tB };
    } finally {
      x9Store.closeWriter(db);
    }
  }

  it('over two due blobs, a census B4 started records the EARLIER due-since: with a horizon of 0, the older file\'s last write (the per-copy clock)', async () => {
    const r = await x9Census('ccrc-hist-x9-census-', (_ids, home) => ({ last: 0, due: 0, overdue: 0, homeDays: { [home]: 30 }, startMs: Date.now(), dueOldest: null }));
    expect(r.due).toBe('2');
    expect(r.oldest).toBe(String(r.tA));
  });

  it('a census a B1 pass started carries no dueOldest: B4 resumes it, reads the field as null, and records the due-since of the blobs it counted', async () => {
    const r = await x9Census('ccrc-hist-x9-census-b1-', (ids, home) => ({ last: ids.a, due: 1, overdue: 0, homeDays: { [home]: 30 }, startMs: Date.now() }));
    expect(r.due).toBe('2');
    expect(r.oldest).toBe(String(r.tB));
  });

  it('a due blob nothing on disk holds back dates by the last write its recorded files saw, never the epoch; one with no clock on record leaves the due-since unmeasured, never "nothing due"', async () => {
    const sw = (await import('../../ccd/history/sweep.mjs')) as unknown as X9Sweep;
    const box = x9H.makeHistoryBox('ccrc-hist-x9-census-gone-');
    x9Store.createStore(box.home);
    const home = box.homes[0]!;
    const now = Date.now();
    const tGone = Math.floor((now - 4 * X9_HOUR) / 1000) * 1000;
    const db = x9Store.openWriter(x9Lib.historyPaths(box.home).dbFile);
    try {
      const t = Number(db.prepare('INSERT INTO transcripts (cc_session_uuid) VALUES (?)').run('90909090-0000-4000-8000-000000000003').lastInsertRowid);
      // Ingested, then deleted out of band: its path no longer stats, and its recorded mtime is all that dates it.
      const f = Number(db.prepare("INSERT INTO ingest_files (dev, ino, source_key, transcript_pk, mtime_ns, status, parser_version) VALUES (1, 4, '', ?, ?, 'live', 1)")
        .run(t, BigInt(tGone) * 1_000_000n).lastInsertRowid);
      db.prepare('INSERT INTO file_paths (path, file_id, last_seen_ms) VALUES (?, ?, ?)')
        .run(x9Path.join(home, 'projects', '-home-u-tree-demo', 'x9-gone.jsonl'), f, now);
      const b = Number(db.prepare('INSERT INTO blobs (sha256, codec, z, raw_len) VALUES (?, ?, ?, ?)')
        .run(x9Hash('sha256').update('x9 gone').digest(), x9Store.CODEC, x9Store.brotli(Buffer.from('x9 gone')), 7).lastInsertRowid);
      db.prepare("INSERT INTO entries (uuid, transcript_pk, type, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms) VALUES (?, ?, 'user', 'operator', 1, 1, ?, ?, ?)")
        .run('90909090-0000-4000-8000-0000000000c1', t, f, b, tGone);
      /** One whole census over one 180-day home (horizon 150 days: only a file gone from disk makes this row due). */
      const census = (): string | null => {
        db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('export-census', 1, ?, NULL) ON CONFLICT (step, version) DO UPDATE SET cursor = excluded.cursor, completed_ms = NULL")
          .run(JSON.stringify({ last: 0, due: 0, overdue: 0, homeDays: { [home]: 180 }, startMs: now, dueOldest: null }));
        expect(sw.exportCensus(db, now, sw.newBudget(() => now)), 'the census ran to its end').toBe(true);
        return x9Store.getMeta(db, x9Lib.HEALTH_META.exportDueOldestMs);
      };
      expect(census(), 'the recorded last write, 4 h ago: never \'0\' (1970)').toBe(String(tGone));
      expect(x9Store.getMeta(db, 'export_due')).toBe('1');
      // The same file with no mtime on record (B1's transcriptFiles reads it as 0): still due and counted, and undated.
      db.prepare('UPDATE ingest_files SET mtime_ns = NULL WHERE file_id = ?').run(f);
      expect(census(), 'due but undated is unmeasured, never \'\' (nothing due)').toBe('unmeasured');
      expect(x9Store.getMeta(db, 'export_due')).toBe('1');
    } finally {
      x9Store.closeWriter(db);
    }
  });
});

describe('W1-B4 Task 9: status --json reads the export pass and counts segments; doctor\'s export-due waits for a gap (spec §9.6, §9.15)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });

  /** A bound store after B1's first-install pass (the export's hourly clock has not run out, so no pass wrote
   *  anything), then `meta` planted as the pass and the census leave it. */
  function x9Bound(prefix: string, meta: Record<string, string>): { box: x9H.HistoryBox; storeId: string } {
    const box = x9H.makeHistoryBox(prefix, { role: 'fleet', shim: true });
    const r = x9H.runSweep(box);
    expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
    const P = x9Lib.historyPaths(box.home);
    const db = x9Store.openWriter(P.dbFile);
    try { for (const [k, v] of Object.entries(meta)) x9Store.setMeta(db, k, v); } finally { x9Store.closeWriter(db); }
    return { box, storeId: x9Fs.readFileSync(P.storeId, 'utf8').trim() };
  }
  /** `ccrc history status --json` as doctor runs it: exit 0 and a clean stderr. */
  function x9Status(box: x9H.HistoryBox): X9Envelope {
    const r = x9H.runCli(box, ['status', '--json']);
    expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stderr).toBe('');
    return r.json as unknown as X9Envelope;
  }
  const exportOf = (e: X9Envelope): X9Export => e.export[x9Lib.HARNESSES[0]!]!;

  it('the export block names the last pass, the oldest due-since and the pause from meta, and counts segments by name and size without opening one', () => {
    const now = Date.now();
    const { box, storeId } = x9Bound('ccrc-hist-x9-env-', {
      [x9Lib.HEALTH_META.exportPassMs]: String(now - 10 * X9_MIN),
      [x9Lib.HEALTH_META.exportDueOldestMs]: String(now - 40 * X9_MIN),
      [x9Lib.HEALTH_META.exportPaused]: 'low-disk',
    });
    const dir = x9Path.join(box.root, x9Lib.EXPORT_DIR, storeId);
    x9Fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    // Not a database: status must count it by name and size. A read of it would fail on its first statement.
    const body = 'not a database: status never opens a segment\n';
    x9Fs.writeFileSync(x9Path.join(dir, '1.0a1b2c3d.db'), body, { mode: 0o600 });
    x9Fs.writeFileSync(x9Path.join(dir, '.2.0a1b2c3d.db.tmp'), 'a writer\'s temp is no segment', { mode: 0o600 });
    const e = x9Status(box);
    expect(exportOf(e)).toMatchObject({
      segments: 1, segment_bytes: Buffer.byteLength(body),
      last_pass_ms: now - 10 * X9_MIN, due_oldest_ms: now - 40 * X9_MIN, paused_low_disk: true,
    });
    expect(e.health.warn.map((i) => i.word)).toContain('export-paused-low-disk');
    // CONTROL: a store none of them touched. Its first pass's census counted nothing due, so meta holds '' and
    // due_oldest_ms reads null: nothing due, which is not 'unmeasured'.
    const bare = x9Bound('ccrc-hist-x9-env-bare-', {});
    expect(exportOf(x9Status(bare.box))).toMatchObject({
      segments: 0, segment_bytes: 0, last_pass_ms: null, due_oldest_ms: null, paused_low_disk: false,
    });
    // No overloaded null: a key no census of this build wrote reads 'unmeasured', never null ("nothing due").
    const never = x9Bound('ccrc-hist-x9-env-never-', { export_due: '3', [x9Lib.HEALTH_META.exportPassMs]: String(now - 10 * X9_MIN) });
    const ndb = x9Store.openWriter(x9Lib.historyPaths(never.box.home).dbFile);
    try { ndb.prepare('DELETE FROM meta WHERE k = ?').run(x9Lib.HEALTH_META.exportDueOldestMs); } finally { x9Store.closeWriter(ndb); }
    const ne = x9Status(never.box);
    expect(exportOf(ne).due_oldest_ms).toBe('unmeasured');
    expect(ne.health.warn.map((i) => i.word), 'an unmeasured due-since fires no wait arm').not.toContain('export-due');
    // No epoch: a stored '0' is not a time, so status never relays 1970 and doctor never counts 29 million minutes.
    const epoch = x9Bound('ccrc-hist-x9-env-epoch-', {
      export_due: '3', [x9Lib.HEALTH_META.exportPassMs]: String(now - 10 * X9_MIN), [x9Lib.HEALTH_META.exportDueOldestMs]: '0',
    });
    const ee = x9Status(epoch.box);
    expect(exportOf(ee).due_oldest_ms).toBe('unmeasured');
    expect(ee.health.warn.map((i) => i.word)).not.toContain('export-due');
  }, 120_000);

  it('an export directory that cannot be listed reads segments and segment_bytes null, never 0: unmeasured is not empty (spec §9.15 "Who reads it")', () => {
    const { box, storeId } = x9Bound('ccrc-hist-x9-env-unlistable-', {});
    // export/<store_id> planted as a regular FILE: readdir answers ENOTDIR, which listSegments throws (only ENOENT is "none").
    // A file works as root too, where a chmod 000 directory would still list.
    const exportRoot = x9Path.join(box.root, x9Lib.EXPORT_DIR);
    x9Fs.mkdirSync(exportRoot, { recursive: true, mode: 0o700 });
    x9Fs.writeFileSync(x9Path.join(exportRoot, storeId), 'not a directory\n', { mode: 0o600 });
    const r = x9H.runCli(box, ['status', '--json']);
    expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stderr).toBe('');
    expect(exportOf(r.json as unknown as X9Envelope)).toMatchObject({ segments: null, segment_bytes: null });
    // CONTROL: the same store with the directory simply absent (no export yet) is zero, which is a measurement.
    const absent = x9Bound('ccrc-hist-x9-env-absentdir-', {});
    expect(exportOf(x9Status(absent.box))).toMatchObject({ segments: 0, segment_bytes: 0 });
  }, 120_000);

  it('doctor\'s inputs through status: a due count with a fresh pass and a young due-since is no WARN; a due-since over two intervals, or a pass over 2 h old, WARNs export-due', () => {
    const now = Date.now();
    const passKey = x9Lib.HEALTH_META.exportPassMs;
    const oldestKey = x9Lib.HEALTH_META.exportDueOldestMs;
    const steady = x9Bound('ccrc-hist-x9-steady-', { export_due: '3', [passKey]: String(now - 10 * X9_MIN), [oldestKey]: String(now - 90 * X9_MIN) });
    expect(x9Status(steady.box).health.warn.map((i) => i.word)).not.toContain('export-due');
    const waited = x9Bound('ccrc-hist-x9-waited-', { export_due: '3', [passKey]: String(now - 10 * X9_MIN), [oldestKey]: String(now - 3 * X9_HOUR) });
    expect(x9Status(waited.box).health.warn.find((i) => i.word === 'export-due')?.detail).toContain('3 unexported blob(s) are due, the oldest for');
    const stale = x9Bound('ccrc-hist-x9-stale-', { export_due: '3', [passKey]: String(now - 3 * X9_HOUR) });
    expect(x9Status(stale.box).health.warn.find((i) => i.word === 'export-due')?.detail).toContain('3 unexported blob(s) are due, and the last export pass completed');
  }, 120_000);
});

// ── W1-B4 Task 10 (item g ruling): a file row with no path left exports under its store identity ─────────────────
// B1 retires an ingest_files row exactly when a new file reuses its (dev, ino), and re-points the retired row's paths to
// the new one. Retired generations of one inode therefore accumulate, each with no path and its own source_key.
describe('a file with no path left (W1-B4 Task 10; D-5393 (history-export-pathless-file-identity))', () => {
  it('two retired generations of one (dev, ino) in two transcripts export under their own source_key, never both as \'\': each file row, structural path and membership names its own file', async () => {
    const U2 = '7d2e3f4a-5b6c-4d7e-8f90-a1b2c3d4e5f6';
    const { box, ids } = ingestedBox('ccrc-history-export-pathless-', [row(1, 'a first prompt', 2 * DAY), row(2, 'a second prompt', DAY)], {
      plant: (b) => {
        plantSession(b, 'claude-b-demo', { uuid: U2, generation: '0189abcd-1234-4678-9abc-0123456789ac', project: 'demo', workdir: WORK });
        plantTranscript(b, 'claude-b', SLUG, U2,
          [userRow({ uuid: rid(3), ts: new Date(Date.now() - DAY).toISOString(), text: 'a prompt of the other transcript', sessionId: U2, cwd: WORK })]);
      },
    });
    // B1's retire key is 'retired:' + a sha256 hex, per generation. The fixture makes the retired state directly: both
    // rows take one (dev, ino), their own retired key, and lose their paths, as a re-point leaves them.
    const keyA = `retired:${'a1'.repeat(32)}`;
    const keyB = `retired:${'b2'.repeat(32)}`;
    await onStore(box, (db) => {
      const st = db.prepare('SELECT f.file_id AS id, f.dev AS dev, f.ino AS ino, t.cc_session_uuid AS u FROM ingest_files f '
        + 'JOIN transcripts t ON t.transcript_pk = f.transcript_pk ORDER BY f.file_id');
      st.setReadBigInts(true);
      const files = st.all() as Array<{ id: bigint; dev: bigint; ino: bigint; u: string }>;
      expect(files.map((f) => f.u), 'the fixture holds one file per transcript').toEqual([U, U2]);
      for (const f of files) {
        db.prepare("UPDATE ingest_files SET dev = ?, ino = ?, source_key = ?, status = 'retired' WHERE file_id = ?")
          .run(files[0]!.dev, files[0]!.ino, f.u === U ? keyA : keyB, f.id);
        db.prepare('DELETE FROM file_paths WHERE file_id = ?').run(f.id);
      }
    });
    expect(q(box, 'SELECT count(DISTINCT dev || \':\' || ino) AS inodes, count(*) AS files, (SELECT count(*) FROM file_paths) AS paths FROM ingest_files'),
      'CONTROL: two generations of one inode, and no path left on either').toEqual([{ inodes: 1, files: 2, paths: 0 }]);

    const r = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids)));
    const name = `1.${ids.writer}.db`;
    expect(r).toMatchObject({ state: 'written', segment: name, rows: 3, complete: true });
    const seg = path.join(exportDirOf(box), name);
    const byPath = (a: Record<string, unknown>, b: Record<string, unknown>): number => (String(a['path']) < String(b['path']) ? -1 : 1);
    expect(segmentRows(seg, 'files').map(pick(['path', 'cc_session_uuid'])).sort(byPath),
      'each file row carries its own non-empty source_key as its path').toEqual([{ path: keyA, cc_session_uuid: U }, { path: keyB, cc_session_uuid: U2 }]);
    expect(segmentRows(seg, 'memberships').map(pick(['path', 'uuid'])).sort(byUuid),
      'each membership names its own file\'s path').toEqual([{ path: keyA, uuid: rid(1) }, { path: keyA, uuid: rid(2) }, { path: keyB, uuid: rid(3) }]);
    expect(segmentRows(seg, 'entries').map(pick(['uuid', 'struct_path'])).sort(byUuid),
      'and so does each entry\'s structural file').toEqual([{ uuid: rid(1), struct_path: keyA }, { uuid: rid(2), struct_path: keyA }, { uuid: rid(3), struct_path: keyB }]);
  }, 120_000);
});

// ── W1-B4 whole-branch review, FIX-A (D-5394 (history-export-select-due-transcripts)) ───────────────────────────────
// The selection offered every unexported row older than the shortest home's cutoff, through a keyset that never seeks;
// a node with one 30-day home beside 180-day homes spent the run budget on rows that could not be taken. A row is due
// exactly when its transcript is (the per-copy rule reads no row time; D-4248), so the pass offers only the rows of
// lib's dueTranscriptKeys, pages by a row value that seeks, and records a pass the budget held with nothing taken.
describe('the selection reaches the due rows within its budget (W1-B4 whole-branch review; D-5394 (history-export-select-due-transcripts))', () => {
  const sweepSrc = (): string => fs.readFileSync(new URL('../../ccd/history/sweep.mjs', import.meta.url), 'utf8');
  /** The text of a module-private `const NAME = '…' + '…';` SQL string in sweep.mjs, without evaluating the source. */
  const sqlOf = (name: string): string => {
    const m = new RegExp(`^const ${name} = ([^;]*);$`, 'm').exec(sweepSrc());
    if (m === null) throw new Error(`sweep.mjs declares no ${name}`);
    return [...m[1]!.matchAll(/'([^']*)'/g)].map((x) => x[1]).join('');
  };

  it('(a) no export keyset spells the OR form: both time-ordered keysets seek by the row value (ts_ms, entry_id) > (?, ?)', () => {
    // `(ts_ms > ? OR (ts_ms = ? AND entry_id > ?))` reads every row from the start of the index on each page: measured 11 ms
    // a 256-row page at 10% of a million rows and 125 ms at 99.9%, against 0.2-0.5 ms at every position for the row value.
    // The two spell one order, so no behaviour pins it; the source does.
    const OR_KEYSET = /\bts_ms\s*>\s*\?\s*OR\s*\(\s*ts_ms\s*=\s*\?/;
    const code = sweepSrc().replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');   // a comment may name the form it replaced
    expect(OR_KEYSET.exec(code)?.[0] ?? null, 'the OR keyset never seeks').toBeNull();
    const sqls = [...sweepSrc().matchAll(/^const (EXPORT_[A-Z_]+_SQL) = /gm)].map((m) => m[1]!);
    expect(sqls, 'CONTROL: the scan reaches the keyset constants it names').toEqual(expect.arrayContaining(['EXPORT_DUE_ENTRIES_SQL', 'EXPORT_TRANSCRIPT_ENTRIES_SQL']));
    for (const name of sqls) expect(OR_KEYSET.exec(sqlOf(name))?.[0] ?? null, `${name} spells no OR keyset`).toBeNull();
    expect(sqlOf('EXPORT_DUE_ENTRIES_SQL'), 'the older rows by time').toContain('(ts_ms, entry_id) > (?, ?)');
    expect(sqlOf('EXPORT_TRANSCRIPT_ENTRIES_SQL'), 'one transcript\'s rows').toContain('(ts_ms, entry_id) > (?, ?)');
  });

  it('(b) the time-ordered phases read entries_unexported through a unary-plus filter on the due transcripts, with no sort; the per-transcript phase reads entries_ts', () => {
    // Without the unary plus SQLite takes the IN list for a seek on entries_ts (transcript_pk, ts_ms) and sorts the rows
    // in a temp b-tree, measured on a table of 20 rows and on 50,000. The plan is the pin: the plus is not decoration.
    const db = new MemDb(':memory:');
    try {
      for (const m of MIGRATIONS) db.exec(m);
      db.exec('PRAGMA foreign_keys = OFF');
      db.exec("INSERT INTO blobs (blob_id, sha256, codec, z, raw_len) VALUES (1, x'01', 'raw', x'00', 1)");
      db.exec("INSERT INTO transcripts (transcript_pk, cc_session_uuid, harness, agent_id) VALUES (1, 'u1', 'claude-code', ''), (2, 'u2', 'claude-code', '')");
      const ins = db.prepare("INSERT INTO entries (uuid, transcript_pk, type, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms) "
        + "VALUES (?, ?, 'user', 'x', 1, 0, 1, 1, ?)");
      for (let i = 0; i < 300; i += 1) ins.run(`e${i}`, i < 298 ? 1 : 2, 1_700_000_000_000 + i * 1000);
      const plan = (name: string): string => {
        const sql = sqlOf(name);
        const args = Array.from({ length: (sql.match(/\?/g) ?? []).length }, () => 0);
        return (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as Array<{ detail: string }>).map((r) => r.detail).join(' | ');
      };
      for (const name of ['EXPORT_DUE_ENTRIES_SQL', 'EXPORT_NULL_TS_ENTRIES_SQL']) {
        expect(plan(name), name).toContain('SEARCH entries USING INDEX entries_unexported');
      }
      expect(plan('EXPORT_DUE_ENTRIES_SQL'), 'the index orders the page: no sort').not.toContain('TEMP B-TREE');
      for (const name of ['EXPORT_DUE_ENTRIES_SQL', 'EXPORT_NULL_TS_ENTRIES_SQL']) {
        expect(sqlOf(name), `${name} filters to the due transcripts`).toContain('AND +transcript_pk IN (SELECT value FROM json_each(?))');
      }
      expect(plan('EXPORT_TRANSCRIPT_ENTRIES_SQL')).toContain('SEARCH entries USING INDEX entries_ts');
      expect(plan('EXPORT_TRANSCRIPT_ENTRIES_SQL')).not.toContain('TEMP B-TREE');
      // The transcripts that still hold an unexported row: a scan of the partial index, which holds only unexported rows, so it
      // is bounded by them and not by the store's age (the per-transcript probe through entries_ts reads every exported row of
      // a transcript that has none left to find). Not a seek: no index is led by transcript_pk and exported_ms.
      expect(plan('EXPORT_UNEXPORTED_TRANSCRIPTS_SQL'), 'only the partial index').toMatch(/^SCAN entries USING INDEX entries_unexported\b/);
      expect(plan('EXPORT_UNEXPORTED_TRANSCRIPTS_SQL')).not.toContain('entries_ts');
    } finally {
      db.close();
    }
  });

  // The refuter's prototype: a pass whose clock moves 1 ms a read, a 100 ms budget and one row a page, over 300 rows of a
  // 180-day home's fresh file ahead of 2 rows of a 30-day home's file older than its horizon. A pass that offers every
  // row spends the whole budget on the 300 before it reaches the 2; one that offers only due transcripts' rows takes them.
  for (const kind of ['timed', 'untimed'] as const) {
    it(`(b) ${kind} rows of a transcript not yet due never stand ahead of the due rows: 300 of them cost the budget nothing, and the 2 due rows are taken`, async () => {
      const U2 = '7d2e3f4a-5b6c-4d7e-8f90-a1b2c3d4e5f6';
      const N = 300;
      const strip = (r: Record<string, unknown>): Record<string, unknown> => {
        if (kind === 'timed') return r;
        const { timestamp: _t, ...rest } = r;   // a row with no timestamp has no ts_ms: the first run of the selection
        return rest;
      };
      const early = Array.from({ length: N }, (_, i) => strip(row(i + 1, `a prompt not yet due ${i}`, 20 * DAY + (N - i) * MIN)));
      const { box, ids } = ingestedBox(`ccrc-history-export-starve-${kind}-`, early, {
        plant: (b) => {
          plantSession(b, 'claude-b-demo', { uuid: U2, generation: '0189abcd-1234-4678-9abc-0123456789ac', project: 'demo', workdir: WORK });
          const f = plantTranscript(b, 'claude-b', SLUG, U2, [1, 2].map((k) => strip(
            userRow({ uuid: rid(1000 + k), ts: new Date(Date.now() - DAY + k * MIN).toISOString(), text: `a due prompt ${k}`, sessionId: U2, cwd: WORK }))));
          const old = new Date(Date.now() - 2 * DAY);
          fs.utimesSync(f, old, old);   // last written two days ago: past a 30-day home's horizon (0)
        },
      });
      expect(q(box, 'SELECT count(*) AS n FROM entries')[0]!['n'], 'the fixture must hold the 300 and the 2').toBe(N + 2);
      expect(q(box, 'SELECT count(*) AS n FROM entries WHERE ts_ms IS NULL')[0]!['n']).toBe(kind === 'timed' ? 0 : N + 2);
      const lastEarly = Number(q(box, 'SELECT max(entry_id) AS n FROM entries WHERE uuid < ?', rid(1000))[0]!['n']);
      const firstDue = Number(q(box, 'SELECT min(entry_id) AS n FROM entries WHERE uuid > ?', rid(1000))[0]!['n']);
      expect(firstDue, 'the due rows come after the others in entry_id order, as the untimed run pages').toBeGreaterThan(lastEarly);
      const NOW = Date.now();
      let t = NOW;
      const clock = (): number => t++;   // 1 ms a read
      const r = await onStore(box, (db) => {
        setMeta(db, `retention:${box.accountHome['claude-a']!}`, '180');   // claude-a's copy waits 150 days; claude-b keeps the 30-day default
        return SW.exportPass(db, exportCtx(box, ids, clock, { limits: { maxMs: 100 }, deps: { exportPageRows: 1 } }));
      });
      expect(r, 'the 2 due rows, not a pass held on the 300 that cannot be taken').toMatchObject({ state: 'written', segment: `1.${ids.writer}.db`, rows: 2, complete: true });
      const marked = Object.entries(marks(box)).filter(([, v]) => v !== null).map(([k]) => k).sort();
      expect(marked).toEqual([rid(1001), rid(1002)]);
    }, 300_000);
  }

  /** A box whose only transcript is not due (a 180-day home, a fresh file) and holds an unlinked sidecar: phase 4 offers its
   *  blob, which no pass takes before the file's date. */
  const heldBox = (prefix: string) => ingestedBox(prefix, [row(1, 'a prompt', DAY)], {
    passes: 3,
    plant: (b) => {
      const dir = path.join(b.accountHome['claude-a']!, 'projects', SLUG, U, 'tool-results');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'b9x0-orphan.txt'), 'output no tool_result names');
    },
  });
  const roomy = async (): Promise<{ bsize: number; bavail: number; blocks: number }> => ({ bsize: 1, bavail: 4 * TIB, blocks: 8 * TIB });

  it('(c) a pass the run budget ends before it takes a row records its attempt and says so once, so the next step waits its interval, not the next tick; a pass that runs to its end then clears the record', async () => {
    const { box, ids } = heldBox('ccrc-history-export-held-');
    expect(q(box, 'SELECT name, entry_id FROM sidecars'), 'the fixture must leave one unlinked sidecar').toEqual([{ name: 'b9x0-orphan.txt', entry_id: null }]);
    const T = Date.now() + 2 * HOUR;   // past the store's first hour: the cadence would run a pass here
    // The run's clock reads, in order: the budget's start, the pass's own, the check before the selection, and the check
    // after the first page of candidates. From the fourth read on the 90 s budget is spent.
    let reads = 0;
    const clock = (): number => { reads += 1; return reads <= 3 ? T : T + 200_000; };
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let r: PassResult;
    let lines: string[];
    try {
      r = await onStore(box, (db) => {
        setMeta(db, `retention:${box.accountHome['claude-a']!}`, '180');
        return SW.exportPass(db, exportCtx(box, ids, clock));
      });
      lines = err.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('history-sweep:'));
    } finally {
      err.mockRestore();
    }
    expect(r, 'held: the budget ended the selection before a row was taken').toEqual({ state: 'held', segment: null, rows: 0, blobs: 0, bytes: 0, complete: false });
    expect(reads, 'the fixture ran out of budget in the selection, not before it').toBeGreaterThanOrEqual(4);
    expect(lines, 'one line, naming the held export pass and the budget').toHaveLength(1);
    expect(lines[0], 'the default budget: 90 s and 512 MiB, both named').toBe(heldLine(RUN_BUDGET_MS, RUN_BUDGET_BYTES));
    expect(metaOf(box, 'export_attempt_ms'), 'the attempt is recorded').toBe(String(T));
    expect(metaOf(box, HEALTH_META.exportPassMs), 'and a held pass is still not a pass').toBeNull();
    expect(segmentsOf(box)).toEqual([]);
    expect(await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => T + 10 * MIN, { deps: { statfs: roomy } }))),
      'ten minutes on, the cadence waits from the attempt, not from the first tick two hours back').toBeNull();
    // CONTROL: the same box with a budget that lasts is complete, nothing due; that pass clears the record (D-5394 (e)).
    const next = await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => T + 61 * MIN, { deps: { statfs: roomy } })));
    expect(next, 'an hour after the attempt the step runs, and with room in its budget the sidecar is no row to take')
      .toEqual({ state: 'nothing-due', segment: null, rows: 0, blobs: 0, bytes: 0, complete: true });
    expect(metaOf(box, HEALTH_META.exportPassMs)).toBe(String(T + 61 * MIN));
    expect(metaOf(box, 'export_attempt_ms'), 'a pass that ran to its end clears the attempt clock').toBeNull();
  }, 300_000);

  it('(c) a pass that TOOK rows but wrote none because the budget ended records its attempt and says so once, like one that took nothing', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-held-taken-', [row(1, 'one', 2 * DAY), row(2, 'two', DAY)]);
    const T = Date.now() + 2 * HOUR;   // past the store's first hour: the cadence would run a pass here
    // The run's clock reads, in order: the budget's start, the pass's own, the check before the selection, the check after the
    // first page of candidates (which took both rows), and the writer's check before its first row. From the fourth read on
    // the 90 s budget is spent, so the selection ends with rows taken and the writer writes none.
    let reads = 0;
    const clock = (): number => { reads += 1; return reads <= 3 ? T : T + 200_000; };
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let r: PassResult;
    let lines: string[];
    try {
      r = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, clock)));
      lines = err.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('history-sweep:'));
    } finally {
      err.mockRestore();
    }
    expect(reads, 'the writer\'s own check was reached: rows were taken, then the budget ended the write').toBeGreaterThanOrEqual(5);
    expect(r, 'held: no segment was published').toEqual({ state: 'held', segment: null, rows: 0, blobs: 0, bytes: 0, complete: false });
    expect(segmentsOf(box), 'and no temp is left').toEqual([]);
    expect(marks(box)).toEqual({ [rid(1)]: null, [rid(2)]: null });
    expect(lines, 'one line, naming the held export pass and the budget').toHaveLength(1);
    expect(lines[0], 'the default budget: 90 s and 512 MiB, both named').toBe(heldLine(RUN_BUDGET_MS, RUN_BUDGET_BYTES));
    expect(metaOf(box, 'export_attempt_ms'), 'the attempt is recorded').toBe(String(T));
    expect(metaOf(box, HEALTH_META.exportPassMs), 'and a held pass is still not a pass').toBeNull();
    expect(await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => T + 10 * MIN, { deps: { statfs: roomy } }))),
      'ten minutes on, the cadence waits from the attempt, not from the first tick two hours back').toBeNull();
    // CONTROL: with a budget that lasts, the same box writes both rows, and that pass clears the record.
    const next = await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => T + 61 * MIN, { deps: { statfs: roomy } })));
    expect(next, 'an hour after the attempt the step runs').toMatchObject({ state: 'written', rows: 2, complete: true });
    expect(metaOf(box, 'export_attempt_ms'), 'a pass that ran to its end clears the attempt clock').toBeNull();
  }, 300_000);

  // The export is the tick's last step and shares the run's 90 s / 512 MiB budget with ingest, the FTS backfill, nodes and
  // cards, so on a node with a backlog it starts on a budget the earlier steps already spent. That pass is held before it
  // selects anything, and it records its attempt and says so like the two holds above, so the next step waits its interval
  // instead of re-running the bind-check read, the mkdir, the temp sweep and the statfs every tick, silently (D-5394).
  for (const spent of ['bytes', 'clock'] as const) {
    it(`(c) an export step that starts on a budget already spent (${spent}) records its attempt and says so once, so the next step waits its interval; a step with a budget that lasts then writes the rows and clears the record`, async () => {
      const { box, ids } = ingestedBox(`ccrc-history-export-held-early-${spent}-`, [row(1, 'one', 2 * DAY), row(2, 'two', DAY)]);
      const T = Date.now() + 2 * HOUR;   // past the store's first hour: the cadence runs a pass here
      // The budget is spent as the pass starts: no byte of the run's allowance is left, or no millisecond of its clock.
      const limits = spent === 'bytes' ? { maxBytes: 0 } : { maxMs: 0 };
      const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      let r: PassResult | null;
      let lines: string[];
      try {
        r = await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => T, { deps: { statfs: roomy }, limits })));
        lines = err.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('history-sweep:'));
      } finally {
        err.mockRestore();
      }
      expect(r, 'held: the budget was spent before the selection began').toEqual({ state: 'held', segment: null, rows: 0, blobs: 0, bytes: 0, complete: false });
      expect(lines, 'one line, naming the held export pass and the budget').toHaveLength(1);
      expect(lines[0], `a budget spent by the ${spent}: the line names both limits as the run holds them, so a hold by the bytes does not read as one by the clock`)
        .toBe(spent === 'bytes' ? heldLine(RUN_BUDGET_MS, 0) : heldLine(0, RUN_BUDGET_BYTES));
      expect(metaOf(box, 'export_attempt_ms'), 'the attempt is recorded').toBe(String(T));
      expect(metaOf(box, HEALTH_META.exportPassMs), 'and a held pass is still not a pass').toBeNull();
      expect(segmentsOf(box)).toEqual([]);
      expect(marks(box)).toEqual({ [rid(1)]: null, [rid(2)]: null });
      expect(await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => T + 10 * MIN, { deps: { statfs: roomy } }))),
        'ten minutes on, the cadence waits from the attempt, not from the first tick two hours back').toBeNull();
      // CONTROL: an hour after the attempt, with a budget that lasts, the same box writes both rows, and that pass clears the record.
      const next = await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => T + 61 * MIN, { deps: { statfs: roomy } })));
      expect(next, 'an hour after the attempt the step runs').toMatchObject({ state: 'written', rows: 2, complete: true });
      expect(metaOf(box, 'export_attempt_ms'), 'a pass that ran to its end clears the attempt clock').toBeNull();
      expect(metaOf(box, HEALTH_META.exportPassMs)).toBe(String(T + 61 * MIN));
    }, 300_000);
  }

  // `complete` is false only when due rows were left behind. planSegment takes a pass's first row whatever its size, so with
  // a small room that one row can leave nothing of the bound; if it was the only due row, nothing is left and the pass is
  // complete, and a bind check's export_segment_missing resets at that pass instead of one interval later.
  for (const room of ['the first row forced past a small room', 'a room the first row fills exactly'] as const) {
    it(`(f) ${room}, and no other row due: the pass reads complete, so the WARN a bind check set resets to 0 at that pass`, async () => {
      const { box, ids } = ingestedBox('ccrc-history-export-complete-', [row(1, 'the only due row', DAY)]);
      const z = Number(q(box, 'SELECT length(b.z) AS n FROM entries e JOIN blobs b ON b.blob_id = e.blob_id WHERE e.uuid = ?', rid(1))[0]!['n']);
      const maxBytes = room === 'a room the first row fills exactly' ? EXPORT_ROW_META_BYTES + z : 1;
      const NOW = Date.now();
      const name = `1.${ids.writer}.db`;
      await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, () => NOW)));
      expect(marks(box)).toEqual({ [rid(1)]: name });
      // the segment stays on the box it came from, and a restore's bind fact makes the next step check the marks. The check
      // charges the stored bytes it rewrites to the run's budget (D-5632 (history-export-bind-check-batched)), so it runs in a
      // step of its own, inside the hour after the pass at NOW, and the pass below has its small budget to itself.
      fs.rmSync(path.join(exportDirOf(box), name));
      await onStore(box, (db) => {
        setMeta(db, `bound:${NOW + MIN}`, 'restore');
        return SW.exportStep(db, exportCtx(box, ids, () => NOW + 2 * MIN));
      });
      expect(counters(box)['export_segment_missing'], 'the check ran in its own step and cleared the marks').toBe(1);
      const T = NOW + 2 * HOUR;
      const r = await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => T, { deps: { statfs: roomy }, limits: { maxBytes } })));
      expect(r, 'the row went into the second segment, and nothing was left behind').toMatchObject({ state: 'written', segment: `2.${ids.writer}.db`, rows: 1, complete: true });
      expect(marks(box)).toEqual({ [rid(1)]: `2.${ids.writer}.db` });
      expect(metaOf(box, HEALTH_META.exportSegmentMissing), 'the pass left no due row behind, so the WARN resets at this pass').toBe('0');
    }, 300_000);
  }

  it('(f) CONTROL: a due row left behind on a later page still reads incomplete, and the WARN stands until a complete pass', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-incomplete-', [row(1, 'one', 3 * DAY), row(2, 'two', 2 * DAY), row(3, 'three', DAY)]);
    await onStore(box, (db) => { setMeta(db, HEALTH_META.exportSegmentMissing, '4'); });
    // room 1 and one row a page: the first page's row is forced and leaves nothing of the room, and it is the NEXT page that
    // holds the due row left behind, which the selection reads to tell
    const r = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, () => Date.now(), { limits: { maxBytes: 1 }, deps: { exportPageRows: 1 } })));
    expect(r).toMatchObject({ state: 'written', segment: `1.${ids.writer}.db`, rows: 1, complete: false });
    expect(marks(box)).toEqual({ [rid(1)]: `1.${ids.writer}.db`, [rid(2)]: null, [rid(3)]: null });
    expect(metaOf(box, HEALTH_META.exportSegmentMissing), 'due rows were left behind: the WARN stands').toBe('4');
    const next = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, () => Date.now() + HOUR)));
    expect(next).toMatchObject({ state: 'written', segment: `2.${ids.writer}.db`, rows: 2, complete: true });
    expect(metaOf(box, HEALTH_META.exportSegmentMissing), 'a complete pass resets it').toBe('0');
  }, 300_000);

  /** `db` as a pass sees it, every `.all()` recorded with its statement's text: the pass is the real one, the handle its own. */
  const watched = (db: DatabaseSync, calls: Array<{ sql: string; args: unknown[] }>): DatabaseSync => new Proxy(db, {
    get(target, prop) {
      const v = Reflect.get(target, prop) as unknown;
      if (typeof v !== 'function') return v;
      if (prop !== 'prepare') return (v as (...a: unknown[]) => unknown).bind(target);
      return (sql: string) => {
        const st = target.prepare(sql);
        return new Proxy(st, {
          get(t, p) {
            const f = Reflect.get(t, p) as unknown;
            if (typeof f !== 'function') return f;
            if (p !== 'all') return (f as (...a: unknown[]) => unknown).bind(t);
            return (...args: unknown[]) => { calls.push({ sql, args }); return (f as (...a: unknown[]) => unknown).apply(t, args); };
          },
        });
      };
    },
  });

  it('(N3) the due set the pass binds and walks holds only the due transcripts that still hold an unexported row, so it is bounded by what the pass can take and not by the store\'s age; with nothing due the holders are not asked and phases 1 to 3 do not run', async () => {
    const U2 = '7d2e3f4a-5b6c-4d7e-8f90-a1b2c3d4e5f6';
    const { box, ids } = ingestedBox('ccrc-history-export-holders-', [row(1, 'one', 3 * DAY), row(2, 'two', 2 * DAY)], {
      plant: (b) => {
        plantSession(b, 'claude-b-demo', { uuid: U2, generation: '0189abcd-1234-4678-9abc-0123456789ac', project: 'demo', workdir: WORK });
        plantTranscript(b, 'claude-b', SLUG, U2, [userRow({ uuid: rid(3), ts: new Date(Date.now() - DAY).toISOString(), text: 'the other transcript', sessionId: U2, cwd: WORK })]);
      },
    });
    const pkOf = (u: string): number => Number(q(box, 'SELECT transcript_pk AS pk FROM transcripts WHERE cc_session_uuid = ?', u)[0]!['pk']);
    const pkU = pkOf(U);
    const pkU2 = pkOf(U2);
    const homeA = `retention:${box.accountHome['claude-a']!}`;
    const homeB = `retention:${box.accountHome['claude-b']!}`;
    const T = Date.now() + 2 * HOUR;
    /** One pass at `at`, the homes set to `days`; answers the result and what the pass bound, walked and asked. */
    const run = async (at: number, days: { a: number; b: number }) => {
      const calls: Array<{ sql: string; args: unknown[] }> = [];
      const r = await onStore(box, (db) => {
        setMeta(db, homeA, String(days.a));
        setMeta(db, homeB, String(days.b));
        return SW.exportPass(watched(db, calls), exportCtx(box, ids, () => at));
      });
      const bound = calls.filter((c) => c.sql.includes('json_each(?)')).map((c) => JSON.parse(String(c.args.find((a) => typeof a === 'string' && a.startsWith('[')))) as number[]);
      const walked = calls.filter((c) => c.sql.startsWith('SELECT entry_id, ts_ms, transcript_pk FROM entries WHERE transcript_pk = ?')).map((c) => Number(c.args[0]));
      const asked = calls.filter((c) => c.sql.startsWith('SELECT DISTINCT transcript_pk FROM entries')).length;
      const rowRuns = calls.filter((c) => c.sql.startsWith('SELECT entry_id, ts_ms, transcript_pk FROM entries')).length;   // phases 1, 2 and 3
      const sidecarRuns = calls.filter((c) => c.sql.startsWith('SELECT DISTINCT s.blob_id AS blob_id FROM sidecars')).length;   // phase 4
      return { r, bound, walked, asked, rowRuns, sidecarRuns };
    };
    // Nothing due (both homes at 180 days, both files fresh): the holders are not asked and nothing is bound or walked.
    const none = await run(T, { a: 180, b: 180 });
    expect(none.r).toEqual({ state: 'nothing-due', segment: null, rows: 0, blobs: 0, bytes: 0, complete: true });
    expect(none.asked, 'no due transcript, nothing to intersect').toBe(0);
    expect(none.rowRuns, 'and phases 1, 2 and 3 can offer nothing, so none of their statements runs').toBe(0);
    expect(none.bound).toEqual([]);
    expect(none.walked).toEqual([]);
    expect(none.sidecarRuns, 'the unlinked sidecars are no due transcript\'s rows: phase 4 still runs').toBeGreaterThanOrEqual(1);
    // U due (claude-a at 30 days), U2 not: both rows of U go, and the list was U alone.
    const first = await run(T + MIN, { a: 30, b: 180 });
    expect(first.r).toMatchObject({ state: 'written', rows: 2, complete: true });
    expect(first.asked, 'the holders are asked once').toBe(1);
    expect(first.bound.length, 'phases 1 and 3 each bound the list').toBeGreaterThanOrEqual(2);
    expect(first.bound.every((l) => JSON.stringify(l) === JSON.stringify([pkU]))).toBe(true);
    expect(first.walked).toEqual([pkU]);
    // Both due, U fully exported: the due set is [U, U2] but U holds no unexported row, so the list is U2 alone.
    const second = await run(T + 2 * MIN, { a: 30, b: 30 });
    expect(second.r, 'U2\'s row goes; the exported U is no candidate however the list reads').toMatchObject({ state: 'written', rows: 1, complete: true });
    expect(second.asked).toBe(1);
    expect(second.bound.length).toBeGreaterThanOrEqual(2);
    expect(second.bound.every((l) => JSON.stringify(l) === JSON.stringify([pkU2])), `the list bound: ${JSON.stringify(second.bound)}`).toBe(true);
    expect(second.walked, 'and phase 2 walks U2 alone').toEqual([pkU2]);
    expect(marks(box)[rid(3)]).toBe(`2.${ids.writer}.db`);
  }, 300_000);

  it('(e) a pass that ran to its end clears the attempt clock, so one dated in the future (the wall clock stepped back after a failed attempt) no longer keeps the cadence answering run', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-attempt-', [row(1, 'one', 2 * DAY), row(2, 'two', DAY)]);
    const T = Date.now() + 2 * HOUR;
    const seed = (at: number) => onStore(box, (db) => { setMeta(db, 'export_attempt_ms', String(at)); });
    await seed(T + 5 * HOUR);
    const w = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, () => T)));
    expect(w).toMatchObject({ state: 'written', rows: 2, complete: true });
    expect(metaOf(box, 'export_attempt_ms'), 'a written pass clears it').toBeNull();
    expect(await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => T + 10 * MIN, { deps: { statfs: roomy } }))),
      'and the cadence waits from the pass: with the future attempt kept it would read a clock gone backwards and run').toBeNull();
    await seed(T + 5 * HOUR);
    const n = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, () => T + HOUR)));
    expect(n).toEqual({ state: 'nothing-due', segment: null, rows: 0, blobs: 0, bytes: 0, complete: true });
    expect(metaOf(box, 'export_attempt_ms'), 'a pass that finds nothing due is a completed pass too').toBeNull();
    expect(metaOf(box, HEALTH_META.exportPassMs)).toBe(String(T + HOUR));
  }, 300_000);
});

// ── W1-B4 whole-branch review, FIX-B: what the mark invariant costs (D-5395 (history-export-mark-needs-its-blobs)) ───
// The invariant is kept by clearing the referrers of a blob a bind check unmarks or a revival brings back, and by asking
// the store, at a replayed entry, which blobs it references. Neither may cost the ingest's hot path a statement for a
// fresh blob, and neither may scan a table the schema indexes for the lookup.
describe('D-5395: the mark invariant adds no statement for a fresh blob and reads each reference through its index', () => {
  const sweepSrc = (): string => fs.readFileSync(new URL('../../ccd/history/sweep.mjs', import.meta.url), 'utf8');
  const referrerSql = (): string[] => {
    const m = /const REFERRER_CLEAR_SQL = Object\.freeze\(\[([\s\S]*?)\]\);/.exec(sweepSrc());
    if (m === null) throw new Error('sweep.mjs declares no REFERRER_CLEAR_SQL');
    return [...m[1]!.matchAll(/'([^']*)'/g)].map((x) => x[1]!);
  };
  const gatherSql = (): string => {
    const m = /entryBlobStates: db\.prepare\(`([\s\S]*?)`\)/.exec(sweepSrc());
    if (m === null) throw new Error('sweep.mjs declares no entryBlobStates');
    return m[1]!;
  };

  it('the referrer clears search entries_blob, entry_variants_blob, sidecars_blob and boundaries_kept, and the replay lookup seeks every table it reads: no scan of entries, variants or boundaries, sidecars through the transcript prefix', () => {
    const db = new MemDb(':memory:');
    try {
      for (const m of MIGRATIONS) db.exec(m);
      db.exec('PRAGMA foreign_keys = OFF');
      db.exec('BEGIN');
      const it = db.prepare("INSERT INTO transcripts (transcript_pk, cc_session_uuid, harness, agent_id) VALUES (?, ?, 'claude-code', '')");
      const ib = db.prepare("INSERT INTO blobs (blob_id, sha256, codec, z, raw_len) VALUES (?, ?, 'raw', x'00', 1)");
      const ie = db.prepare("INSERT INTO entries (uuid, transcript_pk, type, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms, exported_ms) "
        + "VALUES (?, ?, 'user', 'x', 1, 0, 1, ?, ?, 1)");
      const isc = db.prepare('INSERT INTO sidecars (transcript_pk, name, blob_id, entry_id, first_seen_ms) VALUES (?, ?, ?, ?, 1)');
      const iv = db.prepare('INSERT INTO entry_variants (entry_id, blob_id, first_file_id, first_seen_ms) VALUES (?, ?, 1, 1)');
      const ik = db.prepare('INSERT INTO boundaries (entry_id, transcript_pk, ord, kept_blob_id) VALUES (?, ?, ?, ?)');
      for (let t = 1; t <= 200; t += 1) it.run(t, `u${t}`);
      for (let i = 1; i <= 4000; i += 1) {
        ib.run(i, `h${i}`);
        ie.run(`e${i}`, 1 + (i % 200), i, 1000 + i);
        if (i % 10 === 0) { isc.run(1 + (i % 200), `s${i}`, i, i); iv.run(i, i - 1); ik.run(i, 1 + (i % 200), i, i - 2); }
      }
      db.exec('COMMIT');
      db.exec('ANALYZE');   // the planner as a real store's statistics leave it
      const plan = (sql: string, args: Array<number | string>): string => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as Array<{ detail: string }>).map((r) => r.detail).join(' | ');
      const sqls = referrerSql();
      expect(sqls, 'one clear for each of the four references').toHaveLength(4);
      ['entries_blob', 'entry_variants_blob', 'sidecars_blob', 'boundaries_kept'].forEach((ix, k) => {
        const p = plan(sqls[k]!, ['[0]']);
        expect(p, `clear ${k + 1} searches ${ix}`).toMatch(new RegExp(`USING (COVERING )?INDEX ${ix}(_prov)? \\(`));   // schema v2 adds entries_blob_prov beside entries_blob, both keyed by blob_id
        expect(p, `clear ${k + 1} scans nothing but the list of blob ids it is given`).not.toMatch(/\bSCAN (?!json_each)/);
      });
      const gather = plan(gatherSql(), [5, 5, 6, 5, 5]);
      expect(gather, 'the replay lookup scans none of the tables it reads').not.toMatch(/\bSCAN\b/);
      expect(gather, 'and reads a transcript\'s linked sidecars through the key\'s transcript prefix').toContain('SEARCH sidecars USING INDEX sqlite_autoindex_sidecars_1 (transcript_pk=?)');
    } finally {
      db.close();
    }
  });

  it('D-5396: the replay lookup names a blob\'s sha256 only for a pruned blob no mark names, the one case where replay asks the segment whether it carries the blob: a live, an exported and an exported-then-pruned blob cost no lookup', () => {
    const db = new MemDb(':memory:');
    try {
      for (const m of MIGRATIONS) db.exec(m);
      db.exec('PRAGMA foreign_keys = OFF');
      db.exec('BEGIN');
      db.prepare("INSERT INTO transcripts (transcript_pk, cc_session_uuid, harness, agent_id) VALUES (1, 'u1', 'claude-code', '')").run();
      // blob 1 live and unmarked (the entry's own), 2 live and exported (a variant), 3 pruned and unmarked (a variant), 4 pruned
      // and exported (a linked sidecar), 5 pruned and unmarked (the boundary's kept blob)
      const ib = db.prepare("INSERT INTO blobs (blob_id, sha256, codec, z, raw_len, exported_ms, exported_seg) VALUES (?, ?, 'raw', ?, 1, ?, ?)");
      const sha = (n: number): Buffer => createHash('sha256').update(`d5396 lookup ${n}`).digest();
      ib.run(1, sha(1), Buffer.from('z'), null, null);
      ib.run(2, sha(2), Buffer.from('z'), 1, '9.0a1b2c3d.db');
      ib.run(3, sha(3), null, null, null);
      ib.run(4, sha(4), null, 1, '9.0a1b2c3d.db');
      ib.run(5, sha(5), null, null, null);
      db.prepare("INSERT INTO entries (entry_id, uuid, transcript_pk, type, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms) VALUES (1, 'e1', 1, 'user', 'x', 1, 0, 1, 1, 1000)").run();
      db.prepare('INSERT INTO entry_variants (entry_id, blob_id, first_file_id, first_seen_ms) VALUES (1, 2, 1, 1)').run();
      db.prepare('INSERT INTO entry_variants (entry_id, blob_id, first_file_id, first_seen_ms) VALUES (1, 3, 1, 1)').run();
      db.prepare("INSERT INTO sidecars (transcript_pk, name, blob_id, entry_id, first_seen_ms) VALUES (1, 's', 4, 1, 1)").run();
      db.prepare('INSERT INTO boundaries (entry_id, transcript_pk, ord, kept_blob_id) VALUES (1, 1, 1, 5)').run();
      db.exec('COMMIT');
      const rows = db.prepare(gatherSql()).all(1, 1, 1, 1, 1) as Array<{ pruned: number; exported: number; sha: Uint8Array | null }>;
      const key = (r: { pruned: number; exported: number }): string => `${r.pruned ? 'pruned' : 'live'}/${r.exported ? 'exported' : 'unmarked'}`;
      expect(rows.map((r) => key(r)).sort(), 'the five blobs the entry references').toEqual(
        ['live/exported', 'live/unmarked', 'pruned/exported', 'pruned/unmarked', 'pruned/unmarked']);
      expect(rows.filter((r) => r.sha !== null).map((r) => key(r)), 'only the pruned, unmarked ones carry a sha256 to look up').toEqual(['pruned/unmarked', 'pruned/unmarked']);
      expect(rows.filter((r) => r.sha !== null).map((r) => Buffer.from(r.sha as Uint8Array).toString('hex')).sort(),
        'the sha256 of those two blobs').toEqual([sha(3).toString('hex'), sha(5).toString('hex')].sort());
    } finally {
      db.close();
    }
  });

  // D-5632 (history-export-bind-check-batched): the same case in batches of one blob, so every batch boundary falls between
  // two of the references and the pruned blob is a batch of its own (D-5396 under the keyset).
  for (const bounds of [{ name: 'one batch', deps: {}, statements: 4 }, { name: 'one blob a batch', deps: { exportBindBytes: 1, exportBindBatch: 1 }, statements: 20 }] as const) {
  it(`the bind check clears the entries that reference a blob whose mark it clears, through each of the four references (its own blob, a variant, a linked sidecar, a kept blob) and whether that blob is live or pruned since (D-5396), and keeps those whose blobs it did not clear: ${bounds.name}`, async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-refs-', [row(1, 'a prompt', DAY)]);
    const S1 = `1.${ids.writer}.db`;                                                                // the segment this box no longer has
    const S2 = path.basename(plantSegment(box, ids.storeId, { seq: 2, writer: ids.writer, blobs: [], rows: [] }));   // one it has
    const r = await onStore(box, async (db) => {
      const one = (sql: string): number => Number((db.prepare(sql).get() as { n: number }).n);
      const tp = one('SELECT transcript_pk AS n FROM transcripts');
      const file = one('SELECT file_id AS n FROM ingest_files');
      const blob = (name: string, seg: string | null, live: boolean): number => Number(db.prepare(
        'INSERT INTO blobs (sha256, codec, z, raw_len, pruned_ms, exported_ms, exported_seg) VALUES (?, ?, ?, 4, ?, ?, ?)')
        .run(createHash('sha256').update(name).digest(), 'br5', live ? Buffer.from('zz') : null, live ? null : 1, seg === null ? null : 1, seg).lastInsertRowid);
      const entry = (uuid: string, blobId: number, seg = S2): number => Number(db.prepare(
        "INSERT INTO entries (uuid, transcript_pk, type, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms, exported_ms, exported_seg) VALUES (?, ?, 'user', 'x', 1, 0, ?, ?, 1, 1, ?)")
        .run(uuid, tp, file, blobId, seg).lastInsertRowid);
      const held = blob('held in a segment that is here', S2, true);
      const lost = { own: blob('own', S1, true), variant: blob('variant', S1, true), sidecar: blob('sidecar', S1, true), kept: blob('kept', S1, true) };
      const stub = blob('pruned since', S1, false);
      const eOwn = entry(rid(11), lost.own);
      const eVar = entry(rid(12), held);
      const eSide = entry(rid(13), held);
      const eKept = entry(rid(14), held);
      const eCtl = entry(rid(15), held);
      const eStub = entry(rid(16), held);
      entry(rid(17), blob('a stub no segment carried', null, false), S1);   // marked with the missing segment, over no blob that segment marked
      db.prepare('INSERT INTO entry_variants (entry_id, blob_id, first_file_id, first_seen_ms) VALUES (?, ?, ?, 1)').run(eVar, lost.variant, file);
      db.prepare('INSERT INTO entry_variants (entry_id, blob_id, first_file_id, first_seen_ms) VALUES (?, ?, ?, 1)').run(eStub, stub, file);
      db.prepare('INSERT INTO sidecars (transcript_pk, name, blob_id, entry_id, first_seen_ms) VALUES (?, ?, ?, ?, 1)').run(tp, 'linked.txt', lost.sidecar, eSide);
      db.prepare('INSERT INTO boundaries (entry_id, transcript_pk, ord, kept_blob_id) VALUES (?, ?, 1, ?)').run(eKept, tp, lost.kept);
      expect(strandedBlobsOn(db), 'CONTROL: marked blobs strand nobody').toEqual([]);
      const watch = counting(db);
      const out = SW.checkSegmentMarks(watch.db, { paths: historyPaths(box.home), ids, now: () => Date.now(), deps: bounds.deps, budget: SW.newBudget() }, '["bound:1"]');
      return { out, stranded: strandedBlobsOn(db), ran: watch.ran };
    });
    expect(r.out.segments).toEqual([S1]);
    expect(r.ran.filter((t) => /^UPDATE entries SET exported_ms = NULL, exported_seg = NULL WHERE exported_ms IS NOT NULL/.test(t)),
      'the referrers of the five blobs whose marks went (four live, one pruned since) are cleared set-wise: four statements a batch, one for each reference, however many blobs').toHaveLength(bounds.statements);
    const left = q(box, 'SELECT uuid, exported_seg FROM entries WHERE uuid >= ? ORDER BY uuid', rid(11)).map((e) => [e['uuid'], e['exported_seg']]);
    expect(left, 'the four that reference a live blob whose mark went are cleared, and so is the one whose lost blob was pruned since (D-5396), and the one marked with the missing segment itself; the one with a blob in a present segment keeps its mark').toEqual([
      [rid(11), null], [rid(12), null], [rid(13), null], [rid(14), null], [rid(15), S2], [rid(16), null], [rid(17), null]]);
    expect(r.out.cleared, 'five blob marks (a pruned one included), the entry marked with the missing segment, and the five entries that reference a blob whose mark went (the pruned one\'s too)').toBe(11);
    expect(metaOf(box, HEALTH_META.exportSegmentMissing)).toBe('11');
    expect(r.stranded).toEqual([]);
  }, 120_000);
  }

  it('the bind check pages its lost blob ids by a blob_id keyset, at most the row cap a page (ctx.deps.exportBindBatch overrides it), and hands each page to the referrer clears: ceil(N/cap) batches of four statements, and the same cleared count and end state as one batch', async () => {
    /** One box with the same fixture every time: five live blobs lost across TWO missing segments (S1, S3), one pruned stub S1
     *  marked and an entry that references it (D-5396), each live lost blob referenced by an entry that a PRESENT segment (S2)
     *  marked through a different reference, and one entry marked with the missing segment itself. With `lostCount` 4 the
     *  fifth live blob and its entry are left out, so the lost ids are 6 (an exact multiple of a batch of 2) or 5 (a partial
     *  last batch). */
    const fixture = async (prefix: string, batch: number | undefined, lostCount: 4 | 5 = 5) => {
      const { box, ids } = ingestedBox(prefix, [row(1, 'a prompt', DAY)]);
      const S1 = `1.${ids.writer}.db`;
      const S3 = `3.${ids.writer}.db`;
      const S2 = path.basename(plantSegment(box, ids.storeId, { seq: 2, writer: ids.writer, blobs: [], rows: [] }));
      const r = await onStore(box, async (db) => {
        const one = (sql: string): number => Number((db.prepare(sql).get() as { n: number }).n);
        const tp = one('SELECT transcript_pk AS n FROM transcripts');
        const file = one('SELECT file_id AS n FROM ingest_files');
        const blob = (name: string, seg: string, live: boolean): number => Number(db.prepare(
          'INSERT INTO blobs (sha256, codec, z, raw_len, pruned_ms, exported_ms, exported_seg) VALUES (?, ?, ?, 4, ?, 1, ?)')
          .run(createHash('sha256').update(name).digest(), 'br5', live ? Buffer.from('zz') : null, live ? null : 1, seg).lastInsertRowid);
        const entry = (uuid: string, blobId: number, seg: string): number => Number(db.prepare(
          "INSERT INTO entries (uuid, transcript_pk, type, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms, exported_ms, exported_seg) VALUES (?, ?, 'user', 'x', 1, 0, ?, ?, 1, 1, ?)")
          .run(uuid, tp, file, blobId, seg).lastInsertRowid);
        const held = blob('held in a segment that is here', S2, true);
        const lost = [blob('a', S1, true), blob('b', S1, true), blob('c', S1, true), blob('d', S3, true), ...(lostCount === 5 ? [blob('e', S3, true)] : [])];
        const stub = blob('a stub', S1, false);
        const own = entry(rid(21), lost[0]!, S2);                       // its own blob lost
        const variant = entry(rid(22), held, S2);
        const sidecar = entry(rid(23), held, S2);
        const kept = entry(rid(24), held, S2);
        const own2 = lostCount === 5 ? entry(rid(25), lost[4]!, S2) : 0;
        entry(rid(26), held, S1);                                        // marked with a missing segment itself
        entry(rid(27), held, S2);                                        // references nothing lost: keeps its mark
        const stubbed = entry(rid(28), stub, S2);                        // its own blob was pruned since segment 1 carried it (D-5396): cleared too
        db.prepare('INSERT INTO entry_variants (entry_id, blob_id, first_file_id, first_seen_ms) VALUES (?, ?, ?, 1)').run(variant, lost[1]!, file);
        db.prepare('INSERT INTO sidecars (transcript_pk, name, blob_id, entry_id, first_seen_ms) VALUES (?, ?, ?, ?, 1)').run(tp, 'linked.txt', lost[2]!, sidecar);
        db.prepare('INSERT INTO boundaries (entry_id, transcript_pk, ord, kept_blob_id) VALUES (?, ?, 1, ?)').run(kept, tp, lost[3]!);
        void own; void own2; void stubbed;
        expect(strandedBlobsOn(db), 'CONTROL: marked blobs strand nobody').toEqual([]);
        const watch = counting(db);
        const out = SW.checkSegmentMarks(watch.db, { paths: historyPaths(box.home), ids, now: () => 1, deps: batch === undefined ? {} : { exportBindBatch: batch }, budget: SW.newBudget() }, '["bound:1"]');
        return { out, stranded: strandedBlobsOn(db), ran: watch.ran, calls: watch.calls };
      });
      // how the lost ids were read (D-5632): a page of at most the row cap at a time, and one empty page that ends the phase
      const lostSelect = r.calls.filter((c) => c.text.startsWith('SELECT blob_id AS id, coalesce(length(z), 0) AS bytes FROM blobs'));
      const arms = r.ran.filter((t) => /^UPDATE entries SET exported_ms = NULL, exported_seg = NULL WHERE exported_ms IS NOT NULL/.test(t)).length;
      const state = {
        blobs: q(box, 'SELECT lower(hex(sha256)) AS sha, exported_ms, exported_seg FROM blobs WHERE z IS NOT NULL OR pruned_ms IS NOT NULL ORDER BY sha'),
        entries: q(box, 'SELECT uuid, exported_ms, exported_seg FROM entries ORDER BY uuid'),
      };
      return { cleared: r.out.cleared, segments: r.out.segments, arms, stranded: r.stranded, state, S1, S2, S3, lostSelect: lostSelect.map((c) => c.method) };
    };
    const one = await fixture('ccrc-history-export-batch-one-', undefined);
    const two = await fixture('ccrc-history-export-batch-two-', 2);
    expect(one.segments, 'two missing segments').toEqual([one.S1, one.S3]);
    expect(one.lostSelect, 'six ids in one page of at most the default cap, then the empty page that ends the phase').toEqual(['all', 'all']);
    expect(two.lostSelect, 'six ids at two a page: three pages, then the empty one').toEqual(['all', 'all', 'all', 'all']);
    expect(one.arms, 'six ids (five live and the pruned one, which a bind check hands over too: D-5396) fit one default batch: four statements, one for each reference').toBe(4);
    expect(two.arms, 'six ids in batches of two: exactly three batches (an exact multiple, so no empty fourth), four statements each').toBe(12);
    // blobs: five live + the stub = 6; entries: the six referrers (own x2, variant, sidecar, kept, and the stub's) + the one marked S1 itself = 7
    expect(one.cleared).toBe(13);
    expect(two.cleared, 'the batch size moves no count').toBe(one.cleared);
    expect(two.stranded).toEqual([]);
    // the end state, by content (the two boxes mint their own writer names, so compare with the names normalised)
    const norm = (st: typeof one.state, who: typeof one): unknown => JSON.parse(JSON.stringify(st).replaceAll(who.S1, 'S1').replaceAll(who.S2, 'S2').replaceAll(who.S3, 'S3'));
    expect(norm(two.state, two), 'the same end state as one unbounded batch').toEqual(norm(one.state, one));
    expect((one.state.entries as Array<Record<string, unknown>>).filter((e) => e['exported_seg'] !== null).map((e) => e['uuid']).sort(),
      'only the entry that references nothing lost keeps its mark').toEqual([rid(27)]);
    // A partial last batch: five ids in batches of two are two full batches and one of a single id (a batch left unflushed loses it).
    const fourOne = await fixture('ccrc-history-export-batch-four-one-', undefined, 4);
    const four = await fixture('ccrc-history-export-batch-four-two-', 2, 4);
    expect(fourOne.arms, 'five ids in one default batch').toBe(4);
    expect(four.arms, 'five ids in batches of two: two full batches and a last of one id, four statements each').toBe(12);
    expect(four.lostSelect, 'five ids at two a page: two full pages, a page of one, then the empty one').toEqual(['all', 'all', 'all', 'all']);
    // blobs: four live + the stub = 5; entries: the four live referrers, the stub's, and the one marked S1 itself = 6
    expect(fourOne.cleared).toBe(11);
    expect(four.cleared, 'the batch size moves no count').toBe(fourOne.cleared);
    expect(four.stranded).toEqual([]);
    expect(norm(four.state, four), 'and no end state').toEqual(norm(fourOne.state, fourOne));
  }, 300_000);

  it('the hot path: a chunk that stores a fresh blob runs the insert and the id read and nothing about marks; a revival adds the revive, one read, and the four referrer clears only when the blob is unmarked', async () => {
    const { box } = ingestedBox('ccrc-history-export-hotpath-', [row(1, 'a prompt', DAY)]);
    const sha = (n: number): Buffer => createHash('sha256').update(`hotpath ${n}`).digest();
    const chunkOf = (blobs: Array<{ sha: Buffer; z: Buffer }>): Record<string, unknown> => ({
      blobs: new Map(blobs.map((b) => [b.sha.toString('hex'), { sha: b.sha, z: b.z, rawLen: 4 }])), counts: new Map(), rows: [],
      transcriptPk: 1, fileId: 1, rankNs: 0n, first: null, cursor: { offset: 0, tailSha: null }, size: 0, mtimeNs: 0n, rawError: null,
      nowMs: Date.now(), pairIdx: null, ccUuid: U,
    });
    const body = Buffer.from('zz');
    const marksSql = /UPDATE entries SET exported_ms = NULL|UPDATE blobs SET codec|exported_ms IS NULL/;
    const ran = await onStore(box, (raw) => {
      // a tombstone never exported, one exported and then pruned
      const put = raw.prepare('INSERT INTO blobs (sha256, codec, z, raw_len, pruned_ms, exported_ms, exported_seg) VALUES (?, ?, NULL, 4, 1, ?, ?)');
      put.run(sha(2), 'br5', null, null);
      put.run(sha(3), 'br5', 1, '9.0a1b2c3d.db');
      const fresh = counting(raw);
      SW.writeChunk(fresh.db, chunkOf([{ sha: sha(1), z: body }]));
      const revived = counting(raw);
      SW.writeChunk(revived.db, chunkOf([{ sha: sha(2), z: body }]));
      const kept = counting(raw);
      SW.writeChunk(kept.db, chunkOf([{ sha: sha(3), z: body }]));
      return { fresh: fresh.ran, revived: revived.ran, kept: kept.ran };
    });
    const touching = (l: string[]): string[] => l.filter((t) => /\bblobs\b|UPDATE entries/.test(t) && !/ingest_files/.test(t));
    expect(touching(ran.fresh), 'a fresh blob: the insert and the id read').toHaveLength(2);
    expect(ran.fresh.filter((t) => marksSql.test(t)), 'and nothing about marks').toEqual([]);
    expect(touching(ran.revived), 'a revived blob nobody exported: the insert, the revive, the unmarked read, four clears, the id read').toHaveLength(8);
    expect(ran.revived.filter((t) => /UPDATE entries SET exported_ms = NULL/.test(t))).toHaveLength(4);
    expect(touching(ran.kept), 'a revived blob a segment carried: no clear').toHaveLength(4);
    expect(ran.kept.filter((t) => /UPDATE entries SET exported_ms = NULL/.test(t))).toEqual([]);
    expect(q(box, 'SELECT count(*) AS n FROM blobs WHERE z IS NULL')[0]!['n'], 'all three are stored').toBe(0);
  }, 120_000);
});

// ── W1-B4 whole-branch review, FIX-C: a boundary that attaches a live kept blob to an exported entry (D-5395) ─────────
// writeChunk's blob loop (storeBlob's revival clear) runs before its rows loop creates a reference, so an EXISTING entry that
// gains its boundary over a kept blob the store holds live and unmarked would keep its mark. The reviewer's synthetic state:
// a transcript with a user row and a compact_boundary row is exported whole (both entries and the kept blob with segment 1);
// with foreign keys off, the entry's boundaries row goes and the kept blob is deleted ("fresh") or tombstoned unmarked
// ("revived"); a swap copy of the transcript then gives the entry its boundary back.
describe('a boundary that attaches a live kept blob to an exported entry clears its mark (W1-B4 whole-branch review, FIX-C; D-5395 (history-export-mark-needs-its-blobs))', () => {
  it('the guard costs a statement only for an entry that existed and gains its boundary: a new entry, and an entry whose boundary is already there, run none (the hot path)', async () => {
    const { box } = ingestedBox('ccrc-history-export-boundary-cost-', [row(1, 'a prompt', DAY)]);
    const sha = (n: number): Buffer => createHash('sha256').update(`boundary cost ${n}`).digest();
    const body = Buffer.from('zz');
    const E1 = rid(30);
    const E2 = rid(31);
    const entry = (uuid: string) => ({ uuid, type: 'user', subtype: null, role: 'user', model: null, parentUuid: null, tsMs: 1, requestId: null,
      apiBlockIndex: null, msgId: null, sourceToolUseId: null, toolName: null, isCompactSummary: 0 });
    const rowOf = (uuid: string, own: number, at: number, kept: number | null): Record<string, unknown> => ({
      kind: 'row', at, entry: entry(uuid), provenance: 'x', sha: sha(own), json: '{}', ftsText: null, ftsOverCap: false,
      boundary: kept === null ? null : { trigger: 'auto', headUuid: 'h', anchorUuid: 'a', tailUuid: 't', preTokens: 1, postTokens: 1, durationMs: 1, missing: [] },
      kept: kept === null ? null : { sha: sha(kept) },
    });
    const chunkOf = (rows: Array<Record<string, unknown>>, blobs: number[]): Record<string, unknown> => ({
      blobs: new Map(blobs.map((n) => [sha(n).toString('hex'), { sha: sha(n), z: body, rawLen: 4 }])), counts: new Map(), rows,
      transcriptPk: 1, fileId: 1, rankNs: 0n, first: null, cursor: { offset: 0, tailSha: null }, size: 0, mtimeNs: 0n, rawError: null,
      nowMs: Date.now(), pairIdx: null, ccUuid: U,
    });
    const STATE = 'SELECT z IS NULL AS pruned, exported_ms IS NOT NULL AS exported FROM blobs WHERE blob_id = ?';
    const states = (ran: string[]): number => ran.filter((t) => t === STATE).length;
    const out = await onStore(box, (raw) => {
      const write = (rows: Array<Record<string, unknown>>, blobs: number[]): string[] => { const w = counting(raw); SW.writeChunk(w.db, chunkOf(rows, blobs)); return w.ran; };
      const created = write([rowOf(E1, 1, 1000, null)], [1]);                    // a new entry, no boundary yet
      raw.prepare("UPDATE entries SET exported_ms = 1, exported_seg = '9.0a1b2c3d.db' WHERE uuid = ?").run(E1);
      const gained = write([rowOf(E1, 1, 1000, 2)], [1, 2]);                     // the entry existed: it gains its boundary over a kept blob stored fresh
      const markAfter = q(box, 'SELECT exported_ms FROM entries WHERE uuid = ?', E1);
      const again = write([rowOf(E1, 1, 1000, 2)], [1, 2]);                      // the boundary is already there
      const fresh = write([rowOf(E2, 3, 2000, 4)], [3, 4]);                      // a new entry with its boundary
      return { created: states(created), gained: states(gained), again: states(again), fresh: states(fresh), markAfter };
    });
    expect(out.created, 'a new entry without a boundary').toBe(0);
    expect(out.gained, 'an existing entry that gains its boundary reads the kept blob\'s state once').toBe(1);
    expect(out.markAfter, 'and loses its mark, the kept blob being live and unmarked').toEqual([{ exported_ms: null }]);
    expect(out.again, 'an entry whose boundary is already there inserts nothing and reads nothing').toBe(0);
    expect(out.fresh, 'a new entry with its boundary reads nothing: it holds no mark').toBe(0);
  }, 120_000);

  // D-5396: replay's rows now ask lib segmentMayMarkEntry (unmarkEntryOverBlobIn), so this is the case that holds the ingest's own
  // arm (unmarkEntryOverBlob, lib entryMayHoldMark) to its state check: a kept blob a segment already carried licenses the mark.
  // (A pruned kept blob cannot reach it: the chunk's blob loop revives a tombstone first, and a revived blob is live and unmarked.)
  it('an existing entry that gains its boundary over a kept blob a segment already carried (live and exported) keeps its mark: the ingest\'s arm reads the blob\'s state, and an exported blob licenses the mark (D-5395)', async () => {
    const { box } = ingestedBox('ccrc-history-export-boundary-exported-', [row(1, 'a prompt', DAY)]);
    const sha = (n: number): Buffer => createHash('sha256').update(`boundary exported ${n}`).digest();
    const body = Buffer.from('zz');
    const E1 = rid(40);
    const entry = (uuid: string) => ({ uuid, type: 'user', subtype: null, role: 'user', model: null, parentUuid: null, tsMs: 1, requestId: null,
      apiBlockIndex: null, msgId: null, sourceToolUseId: null, toolName: null, isCompactSummary: 0 });
    const rowOf = (kept: number | null): Record<string, unknown> => ({
      kind: 'row', at: 1000, entry: entry(E1), provenance: 'x', sha: sha(1), json: '{}', ftsText: null, ftsOverCap: false,
      boundary: kept === null ? null : { trigger: 'auto', headUuid: 'h', anchorUuid: 'a', tailUuid: 't', preTokens: 1, postTokens: 1, durationMs: 1, missing: [] },
      kept: kept === null ? null : { sha: sha(kept) },
    });
    const chunkOf = (rows: Array<Record<string, unknown>>, blobs: number[]): Record<string, unknown> => ({
      blobs: new Map(blobs.map((n) => [sha(n).toString('hex'), { sha: sha(n), z: body, rawLen: 4 }])), counts: new Map(), rows,
      transcriptPk: 1, fileId: 1, rankNs: 0n, first: null, cursor: { offset: 0, tailSha: null }, size: 0, mtimeNs: 0n, rawError: null,
      nowMs: Date.now(), pairIdx: null, ccUuid: U,
    });
    const after = await onStore(box, (raw) => {
      SW.writeChunk(raw, chunkOf([rowOf(null)], [1]));   // the entry, no boundary yet
      raw.prepare("UPDATE entries SET exported_ms = 1, exported_seg = '9.0a1b2c3d.db' WHERE uuid = ?").run(E1);
      raw.prepare("UPDATE blobs SET exported_ms = 1, exported_seg = '9.0a1b2c3d.db' WHERE sha256 = ?").run(sha(1));   // the entry's own blob went with it, so the chunk's blob loop (storeBlob) clears no referrer
      raw.prepare("INSERT INTO blobs (sha256, codec, z, raw_len, exported_ms, exported_seg) VALUES (?, 'br5', ?, 4, 1, '9.0a1b2c3d.db')").run(sha(2), body);
      SW.writeChunk(raw, chunkOf([rowOf(2)], [1, 2]));   // it gains its boundary over the exported blob
      return raw.prepare('SELECT e.exported_seg AS seg, (SELECT count(*) FROM boundaries b WHERE b.entry_id = e.entry_id) AS boundaries FROM entries e WHERE e.uuid = ?').get(E1) as Record<string, unknown>;
    });
    expect(after['boundaries'], 'CONTROL: the entry gained its boundary').toBe(1);
    expect(after['seg'], 'and keeps its mark: the kept blob is exported, so the entry needs no pass for it').toBe('9.0a1b2c3d.db');
  }, 120_000);

  for (const variant of ['fresh', 'revived'] as const) {
    it(`${variant}: the swap copy re-inserts the boundary over a ${variant === 'fresh' ? 'kept blob that is stored again' : 'tombstoned kept blob that is revived'}; the entry loses its mark with it, the next pass carries the blob, and nothing is left stranded or due`, async () => {
      const at = (agoMs: number): string => new Date(Date.now() - agoMs).toISOString();
      const { box, transcript, ids } = ingestedBox(`ccrc-history-export-boundary-${variant}-`, [
        row(1, 'a prompt', 3 * DAY),
        boundaryRow({ uuid: rid(2), parentUuid: rid(1), ts: at(2 * DAY), trigger: 'auto', headUuid: rid(1), anchorUuid: rid(1), tailUuid: rid(1), allUuids: [rid(1)], sessionId: U, cwd: WORK }),
      ]);
      const s1 = `1.${ids.writer}.db`;
      const s2 = `2.${ids.writer}.db`;
      const kept = q(box, 'SELECT bd.kept_blob_id AS k, lower(hex(b.sha256)) AS sha FROM boundaries bd JOIN blobs b ON b.blob_id = bd.kept_blob_id JOIN entries e ON e.entry_id = bd.entry_id WHERE e.uuid = ?', rid(2));
      expect(kept, 'the fixture must hold the boundary and its kept blob').toHaveLength(1);
      const keptId = Number(kept[0]!['k']);
      const keptSha = String(kept[0]!['sha']);
      passAt(box, 65);
      expect(marks(box), 'CONTROL: the export marks both entries').toEqual({ [rid(1)]: s1, [rid(2)]: s1 });
      expect(q(box, 'SELECT exported_seg FROM blobs WHERE blob_id = ?', keptId), 'CONTROL: and the kept blob goes with segment 1').toEqual([{ exported_seg: s1 }]);
      await onStore(box, (db) => {
        db.exec('PRAGMA foreign_keys = OFF');
        db.prepare('DELETE FROM boundaries WHERE entry_id = (SELECT entry_id FROM entries WHERE uuid = ?)').run(rid(2));
        if (variant === 'fresh') db.prepare('DELETE FROM blobs WHERE blob_id = ?').run(keptId);
        else db.prepare('UPDATE blobs SET z = NULL, pruned_ms = ?, exported_ms = NULL, exported_seg = NULL, fts_indexed = 0 WHERE blob_id = ?').run(Date.now(), keptId);
      });
      expect(q(box, 'SELECT count(*) AS n FROM boundaries')[0]!['n'], 'CONTROL: the entry has no boundary now').toBe(0);
      // the swap copy: the same transcript, byte for byte, under another account's home
      const copy = path.join(box.accountHome['claude-b']!, 'projects', SLUG, `${U}.jsonl`);
      fs.mkdirSync(path.dirname(copy), { recursive: true });
      fs.copyFileSync(transcript, copy);
      passAt(box, 100);
      const back = q(box, 'SELECT bd.kept_blob_id AS k, b.z IS NOT NULL AS live, b.exported_ms AS exported FROM boundaries bd JOIN blobs b ON b.blob_id = bd.kept_blob_id');
      expect(back, 'the boundary is back over a live, unmarked kept blob').toEqual([{ k: back[0]!['k'], live: 1, exported: null }]);
      expect(marks(box), 'the entry that gained it lost its mark; the other keeps its own').toEqual({ [rid(1)]: s1, [rid(2)]: null });
      expect(strandedBlobs(box)).toEqual([]);
      passAt(box, 130);
      expect(segmentsOf(box)).toEqual([s1, s2]);
      expect(marks(box)).toEqual({ [rid(1)]: s1, [rid(2)]: s2 });
      const seg2 = path.join(exportDirOf(box), s2);
      expect(segmentRows(seg2, 'entries').map((e) => e['uuid']), 'segment 2 carries the entry again').toEqual([rid(2)]);
      expect(segmentRows(seg2, 'blobs').map(pick(['sha256', 'pruned'])), 'with the kept blob\'s bytes').toEqual([{ sha256: keptSha, pruned: 0 }]);
      expect(metaOf(box, 'export_due'), 'nothing is left due').toBe('0');
      expect(strandedBlobs(box)).toEqual([]);
    }, 600_000);
  }
});

// ── W5h-1 Task 1: the check after a bind in bounded, resumable batches (D-5632 (history-export-bind-check-batched)) ─────
describe('the check after a bind runs in bounded, resumable batches (W5h-1 Task 1; D-5632)', () => {
  const roomy = async (): Promise<{ bsize: number; bavail: number; blocks: number }> => ({ bsize: 1, bavail: 4 * TIB, blocks: 8 * TIB });
  /** A box whose store, besides the ingested row, holds `lost` live blobs of `zBytes` incompressible stored bytes, each marked
   *  with a segment this box lacks (S1) and referenced by its own entry marked with one it has (S2); with `kept`, as many live
   *  blobs marked S2 (each with its own S2 entry) interleaved by blob_id with the first lost ones; `stubs` pruned blobs marked
   *  S1, each referenced the same way (D-5396); and one entry marked S1 itself over a blob S2 holds. No bind fact yet, and
   *  every step here runs inside the store's first hour, so the export pass waits unless a case moves the clock past it. */
  async function lostBox(prefix: string, o: { lost: number; zBytes: number; kept?: number; stubs?: number }):
    Promise<{ box: HistoryBox; ids: { storeId: string; writer: string }; S1: string; S2: string }> {
    const { box, ids } = ingestedBox(prefix, [row(1, 'a prompt', DAY)]);
    const S1 = `1.${ids.writer}.db`;
    const S2 = path.basename(plantSegment(box, ids.storeId, { seq: 2, writer: ids.writer, blobs: [], rows: [] }));
    await onStore(box, (db) => {
      const one = (sql: string): number => Number((db.prepare(sql).get() as { n: number }).n);
      const tp = one('SELECT transcript_pk AS n FROM transcripts');
      const file = one('SELECT file_id AS n FROM ingest_files');
      const blob = (z: Buffer | null, seg: string): number => Number(db.prepare(
        'INSERT INTO blobs (sha256, codec, z, raw_len, pruned_ms, exported_ms, exported_seg) VALUES (?, ?, ?, ?, ?, 1, ?)')
        .run(t1Random(32), 'br5', z, z === null ? 4 : z.length, z === null ? 1 : null, seg).lastInsertRowid);
      const entry = (n: number, blobId: number, seg: string): void => {
        db.prepare("INSERT INTO entries (uuid, transcript_pk, type, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms, exported_ms, exported_seg) VALUES (?, ?, 'user', 'x', 1, 0, ?, ?, 1, 1, ?)")
          .run(rid(n), tp, file, blobId, seg);
      };
      db.exec('BEGIN');
      let n = 100;
      const held = blob(t1Random(64), S2);
      for (let i = 0; i < o.lost; i += 1) {
        entry(n++, blob(t1Random(o.zBytes), S1), S2);                                // its own blob lost
        if (i < (o.kept ?? 0)) entry(n++, blob(t1Random(o.zBytes), S2), S2);           // a blob a present segment holds
      }
      for (let i = 0; i < (o.stubs ?? 0); i += 1) entry(n++, blob(null, S1), S2);     // pruned since S1 carried it
      entry(n++, held, S1);                                                             // marked with the missing segment itself
      db.exec('COMMIT');
    });
    expect(strandedBlobs(box), 'CONTROL: marked blobs strand nobody').toEqual([]);
    return { box, ids, S1, S2 };
  }
  const bind = (box: HistoryBox, ms: number): Promise<void> => onStore(box, (db) => { setMeta(db, `bound:${ms}`, 'restore'); });
  /** The marks, the check's meta and its counter, the box's own segment names normalised and no clock. */
  const endState = (b: { box: HistoryBox; S1: string; S2: string }): Record<string, unknown> => {
    const norm = (v: unknown): unknown => (v === b.S1 ? 'S1' : v === b.S2 ? 'S2' : v ?? null);
    return {
      blobs: q(b.box, 'SELECT exported_seg FROM blobs ORDER BY blob_id').map((r) => norm(r['exported_seg'])),
      entries: q(b.box, 'SELECT uuid, exported_seg FROM entries ORDER BY uuid').map((r) => [r['uuid'], norm(r['exported_seg'])]),
      missing: metaOf(b.box, HEALTH_META.exportSegmentMissing),
      stop: metaOf(b.box, HEALTH_META.exportMarksCheck),
      binds: metaOf(b.box, 'export_marks_checked_binds'),
      counted: metaOf(b.box, 'export_marks_counted'),
      counter: counters(b.box)['export_segment_missing'] ?? 0,
    };
  };
  /** The test's writer connection answers its `nth` BEGIN IMMEDIATE with SQLITE_BUSY, the stand-in for another connection
   *  holding the write lock (the idiom of the busy case above); shipped code reads no seam. */
  const busyAt = (db: DatabaseSync, nth: number): void => {
    let begins = 0;
    const realExec = db.exec.bind(db);
    (db as unknown as { exec: (sql: string) => void }).exec = (sql: string): void => {
      if (sql === 'BEGIN IMMEDIATE' && (begins += 1) === nth) {
        throw Object.assign(new Error(`database is locked (BEGIN ${nth})`), { code: 'ERR_SQLITE_ERROR', errcode: 5, errstr: 'database is locked' });
      }
      realExec(sql);
    };
  };
  /** exportStep in a child of its own, SIGKILLed right after its `killAt`-th batch has committed and checkpointed: a kill,
   *  not a throw, so no `finally` and no stop record runs (the faults preload's idiom). */
  function killAfterBatch(box: HistoryBox, ids: { storeId: string; writer: string }, nowMs: number, bindBytes: number, killAt: number): ReturnType<typeof t1Spawn> {
    const script = path.join(box.home, 'kill-after-batch.mjs');
    fs.writeFileSync(script, [
      'const [sweepUrl, storeUrl, libUrl, home, idsJson, nowText, bytesText, killText] = process.argv.slice(2);',
      'const SW = await import(sweepUrl); const ST = await import(storeUrl); const L = await import(libUrl);',
      'const P = L.historyPaths(home); const now = () => Number(nowText); let seen = 0;',
      'const db = ST.openWriter(P.dbFile);',
      'const die = () => { process.kill(process.pid, "SIGKILL"); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10_000); };',
      'const deps = { exportBindBytes: Number(bytesText), afterMarkBatch: () => { if ((seen += 1) === Number(killText)) die(); } };',
      'await SW.exportStep(db, { home, paths: P, ids: JSON.parse(idsJson), now, out: () => {}, deps, homes: [], rosterUnreadable: false, parsed: { secrets: [], homes: [], rosterUnreadable: false }, budget: SW.newBudget(now) });',
      'process.exit(3);',
    ].join('\n'));
    const url = (rel: string): string => new URL(rel, import.meta.url).href;
    return t1Spawn(process.execPath, ['--no-warnings', script, url('../../ccd/history/sweep.mjs'), url('../../ccd/history/store.mjs'),
      url('../../ccd/history/lib.mjs'), box.home, JSON.stringify(ids), String(nowMs), String(bindBytes), String(killAt)],
    { env: box.env, cwd: box.home, encoding: 'utf8', timeout: 60_000 });
  }

  it('a check the run budget stops resumes on the next step: no batch starts on a spent budget; the stop records its first time and the marks cleared so far; exportSegmentMissing accumulates; the done stamp comes after the last batch; the counter is bumped once; the end state is one uninterrupted check\'s', async () => {
    const NOW = Date.now();
    const at = (ms: number) => (): number => NOW + ms;
    const step = { deps: { exportBindBytes: 2000 }, limits: { maxBytes: 2000 } };   // two 1000-byte blobs a batch, one batch a step
    const a = await lostBox('ccrc-history-export-bindstep-', { lost: 6, zBytes: 1000 });
    const b = await lostBox('ccrc-history-export-bindwhole-', { lost: 6, zBytes: 1000 });
    for (const x of [a, b]) await bind(x.box, NOW + MIN);
    await onStore(a.box, (db) => SW.exportStep(db, exportCtx(a.box, a.ids, at(2 * MIN), step)));
    expect(metaOf(a.box, HEALTH_META.exportMarksCheck), 'step 1: one batch (two blobs and their two referrers), then the budget').toBe(`budget ${NOW + 2 * MIN} 4`);
    expect(metaOf(a.box, HEALTH_META.exportSegmentMissing)).toBe('4');
    // D-5725: the fixture's own first step stamped an empty check, which covers no bind fact, so the record is '[]', not absent
    expect(metaOf(a.box, 'export_marks_checked_binds'), 'the done stamp waits for the last batch').toBe('[]');
    // D-5725: the fixture's own first step stamped an empty check, so the stamp exists; this step's is what must be absent
    expect(metaOf(a.box, 'export_marks_checked_ms')).not.toBe(String(NOW + 2 * MIN));
    expect(counters(a.box)['export_segment_missing'], 'the first batch that clears counts the check').toBe(1);
    expect(strandedBlobs(a.box), 'D-5395 at the commit').toEqual([]);
    await onStore(a.box, (db) => SW.exportStep(db, exportCtx(a.box, a.ids, at(3 * MIN), step)));
    expect(metaOf(a.box, HEALTH_META.exportMarksCheck), 'step 2 resumes: the first stop\'s time kept, the cleared marks added').toBe(`budget ${NOW + 2 * MIN} 8`);
    expect(metaOf(a.box, HEALTH_META.exportSegmentMissing), 'accumulated, never overwritten').toBe('8');
    expect(counters(a.box)['export_segment_missing'], 'once per check, however many steps').toBe(1);
    expect(strandedBlobs(a.box)).toEqual([]);
    await onStore(a.box, (db) => SW.exportStep(db, exportCtx(a.box, a.ids, at(4 * MIN), { deps: { exportBindBytes: 2000 } })));
    expect(metaOf(a.box, HEALTH_META.exportMarksCheck), 'the done stamp deletes the stop').toBeNull();
    expect(metaOf(a.box, 'export_marks_checked_ms')).toBe(String(NOW + 4 * MIN));
    expect(metaOf(a.box, HEALTH_META.exportSegmentMissing), 'six blobs, their six referrers and the entry marked S1 itself').toBe('13');
    await onStore(b.box, (db) => SW.exportStep(db, exportCtx(b.box, b.ids, at(2 * MIN), { deps: { exportBindBytes: 2000 } })));
    expect(endState(b), 'CONTROL: one uninterrupted check').toMatchObject({ missing: '13', stop: null, counted: null, counter: 1 });
    expect(endState(a), 'three steps end where one does').toEqual(endState(b));
  }, 300_000);

  it('a segment that arrives and one moved aside between two steps of one unfinished check: each step recomputes the missing set, what an earlier step cleared stays cleared, marks naming the arrived segment stand, the moved-aside segment\'s marks clear, D-5395 holds after every step, and the done stamp covers a bind fact written mid-check', async () => {
    const NOW = Date.now();
    const at = (ms: number) => (): number => NOW + ms;
    const step = { deps: { exportBindBytes: 2000 }, limits: { maxBytes: 2000 } };   // two 1000-byte blobs a batch, one batch a step
    const x = await lostBox('ccrc-history-export-bindmove-', { lost: 6, zBytes: 1000 });
    const lost = q(x.box, 'SELECT blob_id FROM blobs WHERE exported_seg = ? ORDER BY blob_id', x.S1).map((r) => Number(r['blob_id']));
    expect(lost, 'CONTROL: six lost blobs, marked with the segment this box lacks').toHaveLength(6);
    const segOf = (id: number): unknown => q(x.box, 'SELECT exported_seg FROM blobs WHERE blob_id = ?', id)[0]!['exported_seg'] ?? null;
    await bind(x.box, NOW + MIN);
    await onStore(x.box, (db) => SW.exportStep(db, exportCtx(x.box, x.ids, at(2 * MIN), step)));
    expect(metaOf(x.box, HEALTH_META.exportMarksCheck), 'step 1 stops at the budget after one batch').toBe(`budget ${NOW + 2 * MIN} 4`);
    expect(lost.slice(0, 2).map(segOf), 'step 1 cleared the first two lost blobs').toEqual([null, null]);
    expect(strandedBlobs(x.box)).toEqual([]);
    // between the two steps: the carry of S1 finishes, S2 is moved aside, and a second bind fact is written
    expect(path.basename(plantSegment(x.box, x.ids.storeId, { seq: 1, writer: x.ids.writer, blobs: [], rows: [] }))).toBe(x.S1);
    fs.renameSync(path.join(exportDirOf(x.box), x.S2), path.join(x.box.home, 'moved-aside-segment'));
    await bind(x.box, NOW + 2 * MIN + 30_000);
    for (let n = 3; n < 10 && (n === 3 || metaOf(x.box, HEALTH_META.exportMarksCheck) !== null); n += 1) {
      await onStore(x.box, (db) => SW.exportStep(db, exportCtx(x.box, x.ids, at(n * MIN), step)));
      expect(strandedBlobs(x.box), `D-5395 after the step at minute ${n}`).toEqual([]);
    }
    expect(metaOf(x.box, HEALTH_META.exportMarksCheck), 'the check finished').toBeNull();
    expect(lost.slice(0, 2).map(segOf), 'an earlier step\'s clears stay cleared: the arrived segment restores no mark').toEqual([null, null]);
    expect(lost.slice(2).map(segOf), 'marks naming the segment that arrived stand').toEqual([x.S1, x.S1, x.S1, x.S1]);
    expect(q(x.box, 'SELECT count(*) AS n FROM blobs WHERE exported_seg = ?', x.S2)[0]!['n'], 'the moved-aside segment\'s blob marks clear').toBe(0);
    expect(q(x.box, 'SELECT count(*) AS n FROM entries WHERE exported_seg = ?', x.S2)[0]!['n'], 'and its entry marks').toBe(0);
    expect(metaOf(x.box, 'export_marks_checked_binds'), 'the done stamp covers every bind fact seen, the one written mid-check too')
      .toBe(JSON.stringify([`bound:${NOW + MIN}`, `bound:${NOW + 2 * MIN + 30_000}`].sort()));
    expect(counters(x.box)['export_segment_missing'], 'one check, however many steps and however its missing set moved').toBe(1);
  }, 300_000);

  it('D-5395 at every commit: a busy at any BEGIN of the check leaves no live blob unmarked under marked entries, and the next step ends where an uninterrupted check does', async () => {
    const NOW = Date.now();
    const ctl = await lostBox('ccrc-history-export-bindtx-ctl-', { lost: 6, zBytes: 1000 });
    await bind(ctl.box, NOW + MIN);
    await onStore(ctl.box, (db) => SW.exportStep(db, exportCtx(ctl.box, ctl.ids, () => NOW + 2 * MIN, { deps: { exportBindBytes: 2000 } })));
    for (const nth of [2, 3, 4, 5]) {
      const x = await lostBox(`ccrc-history-export-bindtx${nth}-`, { lost: 6, zBytes: 1000 });
      await bind(x.box, NOW + MIN);
      const err = await onStore(x.box, (db) => {
        busyAt(db, nth);
        return SW.exportStep(db, exportCtx(x.box, x.ids, () => NOW + 2 * MIN, { deps: { exportBindBytes: 2000 } })).then(() => null, (e: unknown) => e);
      }) as { errcode?: number } | null;
      expect(err?.errcode, `busy at BEGIN ${nth} was not rethrown`).toBe(5);
      expect(strandedBlobs(x.box), `D-5395 at every commit point (busy at BEGIN ${nth})`).toEqual([]);
      // D-5725: the fixture's own first step stamped an empty check, which covers no bind fact, so the record is '[]', not absent
      expect(metaOf(x.box, 'export_marks_checked_binds'), `a check that met busy at BEGIN ${nth} is not done`).toBe('[]');
      await onStore(x.box, (db) => SW.exportStep(db, exportCtx(x.box, x.ids, () => NOW + 3 * MIN, { deps: { exportBindBytes: 2000 } })));
      expect(endState(x), `busy at BEGIN ${nth}, then the next step`).toEqual(endState(ctl));
    }
  }, 300_000);

  for (const killAt of [1, 4] as const) {
    it(`a kill after batch ${killAt} of 4, then the next step: the same marks, meta and counter as one uninterrupted check, and D-5395 holds at the kill`, async () => {
      const NOW = Date.now();
      const a = await lostBox(`ccrc-history-export-bindkill${killAt}-`, { lost: 6, zBytes: 1000 });
      const b = await lostBox(`ccrc-history-export-bindnokill${killAt}-`, { lost: 6, zBytes: 1000 });
      for (const x of [a, b]) await bind(x.box, NOW + MIN);
      const r = killAfterBatch(a.box, a.ids, NOW + 2 * MIN, 2000, killAt);
      expect(r.signal, `${r.stdout}\n${r.stderr}`).toBe('SIGKILL');
      expect(strandedBlobs(a.box), 'D-5395 at the kill').toEqual([]);
      // D-5725: the fixture's own first step stamped an empty check, which covers no bind fact, so the record is '[]', not absent
      expect(metaOf(a.box, 'export_marks_checked_binds'), 'a killed check is not done').toBe('[]');
      expect(counters(a.box)['export_segment_missing'], 'the first batch that cleared counted the check before the kill').toBe(1);
      for (const x of [a, b]) await onStore(x.box, (db) => SW.exportStep(db, exportCtx(x.box, x.ids, () => NOW + 3 * MIN, { deps: { exportBindBytes: 2000 } })));
      expect(endState(a), 'killed, then resumed').toEqual(endState(b));
      expect(endState(b)).toMatchObject({ missing: '13', stop: null, counted: null, counter: 1 });
    }, 300_000);
  }

  it('each batch is one page of a blob_id keyset, then of an entry_id keyset, cut at the byte bound (always one row) and the row cap; marks a present segment holds stay; each page seeks by the primary key', async () => {
    const NOW = Date.now();
    const x = await lostBox('ccrc-history-export-bindkeyset-', { lost: 5, zBytes: 1000, kept: 5, stubs: 2 });
    await bind(x.box, NOW + MIN);
    const batches: Array<{ ids: number; bytes: number }> = [];
    const plans = await onStore(x.box, async (db) => {
      const watch = counting(db);
      await SW.exportStep(watch.db, exportCtx(x.box, x.ids, () => NOW + 2 * MIN, {
        deps: { exportBindBytes: 2500, exportBindBatch: 3, afterMarkBatch: (m: { ids: number; bytes: number }) => { batches.push({ ids: m.ids, bytes: m.bytes }); } },
      }));
      return { blobs: watch.calls.find((c) => c.text.startsWith('SELECT blob_id AS id'))!.text, entries: watch.calls.find((c) => c.text.startsWith('SELECT entry_id AS id'))!.text };
    });
    // The plans on the store's schema with no statistics: this fixture's own sqlite_stat1, taken while the store held one row,
    // makes any plan a scan (measured), so the seek is read where only the SQL decides it.
    const schema = new MemDb(':memory:');
    let explained: { blobs: string; entries: string };
    try {
      for (const m of MIGRATIONS) schema.exec(m);
      const plan = (sql: string): string => (schema.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(0, '[]', 1) as Array<{ detail: string }>).map((p) => p.detail).join(' | ');
      explained = { blobs: plan(plans.blobs), entries: plan(plans.entries) };
    } finally {
      schema.close();
    }
    // lost blobs of 1000 bytes interleaved with kept ones, then two stubs: 2500 bytes take two lost blobs, twice; then the last
    // lost blob and both stubs (0 bytes) fill the cap of three; then the entry marked S1 itself
    expect(batches).toEqual([{ ids: 2, bytes: 2000 }, { ids: 2, bytes: 2000 }, { ids: 3, bytes: 1000 }, { ids: 1, bytes: 0 }]);
    expect(explained.blobs, 'the blob page seeks by blob_id').toContain('SEARCH blobs USING INTEGER PRIMARY KEY (rowid>?)');
    expect(explained.entries, 'the entry page seeks by entry_id').toContain('SEARCH entries USING INTEGER PRIMARY KEY (rowid>?)');
    expect(q(x.box, 'SELECT count(*) AS n FROM blobs WHERE exported_seg = ?', x.S1)[0]!['n'], 'every lost blob mark is cleared').toBe(0);
    expect(q(x.box, 'SELECT count(*) AS n FROM blobs WHERE exported_seg = ?', x.S2)[0]!['n'], 'every blob S2 holds keeps its mark').toBe(6);
    expect(q(x.box, 'SELECT count(*) AS n FROM entries WHERE exported_seg = ?', x.S2)[0]!['n'], 'the entries over kept blobs keep theirs').toBe(5);
    expect(metaOf(x.box, HEALTH_META.exportSegmentMissing), 'seven blob marks, their seven referrers and the entry marked S1').toBe('15');
    expect(metaOf(x.box, HEALTH_META.exportMarksCheck)).toBeNull();
    expect(strandedBlobs(x.box)).toEqual([]);
  }, 120_000);

  it('one TRUNCATE checkpoint after each batch keeps the WAL to about a batch: 2,000 blobs of 8 KiB at 1 MiB a batch peak under 2 MiB at a commit, and leave 0 bytes after each checkpoint', async () => {
    const NOW = Date.now();
    const x = await lostBox('ccrc-history-export-bindwal-', { lost: 2000, zBytes: 8192 });
    await onStore(x.box, (db) => {
      setMeta(db, `bound:${NOW + MIN}`, 'restore');
      db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    });
    const wal = historyPaths(x.box.home).wal;
    const size = (): number => { try { return fs.statSync(wal).size; } catch { return 0; } };
    const atCommit: number[] = [];
    const afterBatch: number[] = [];
    const checkpoints = await onStore(x.box, async (db) => {
      const realExec = db.exec.bind(db);
      (db as unknown as { exec: (sql: string) => void }).exec = (sql: string): void => { realExec(sql); if (sql === 'COMMIT') atCommit.push(size()); };
      const watch = counting(db);
      await SW.exportStep(watch.db, exportCtx(x.box, x.ids, () => NOW + 2 * MIN, { deps: { exportBindBytes: 1024 * 1024, afterMarkBatch: () => { afterBatch.push(size()); } } }));
      return watch.ran.filter((t) => t === 'PRAGMA wal_checkpoint(TRUNCATE)').length;
    });
    expect(afterBatch, '16 batches of 128 blobs, then the entry marked S1').toHaveLength(17);
    expect(Math.max(...atCommit), `the WAL at each commit: ${atCommit.join(',')}`).toBeLessThan(2 * 1024 * 1024);
    expect(afterBatch.every((n) => n === 0), `the WAL after each checkpoint: ${afterBatch.join(',')}`).toBe(true);
    expect(checkpoints, 'one checkpoint a batch, and one before the first').toBe(afterBatch.length + 1);
    expect(metaOf(x.box, HEALTH_META.exportMarksCheck)).toBeNull();
  }, 300_000);

  it('a reader on an older snapshot: each checkpoint answers busy at once (busy_timeout 0 around it, the writer\'s restored after), the check stops wal-held once the WAL passes the ceiling, and the next step after the reader ends finishes', async () => {
    const NOW = Date.now();
    const x = await lostBox('ccrc-history-export-bindheld-', { lost: 40, zBytes: 8192 });
    await bind(x.box, NOW + MIN);
    const deps = { exportBindBytes: 16 * 1024, exportBindWalCeiling: 64 * 1024 };
    const reader = new MemDb(historyPaths(x.box.home).dbFile, { readOnly: true });
    let ms = 0;
    let timeout = 0;
    let firstStep: { record: string | null; left: number } = { record: null, left: -1 };
    try {
      reader.exec('BEGIN');
      reader.prepare('SELECT count(*) AS n FROM blobs').get();   // holds its snapshot until it closes
      const t0 = Date.now();
      timeout = await onStore(x.box, async (db) => {
        await SW.exportStep(db, exportCtx(x.box, x.ids, () => NOW + 2 * MIN, { deps }));
        return Number((db.prepare('PRAGMA busy_timeout').get() as { timeout: number }).timeout);
      });
      ms = Date.now() - t0;
      // D-5639: a second step with the reader STILL open, at a later now. The WAL the first step could not truncate stands past
      // the ceiling, so the step's checkpoint before its first batch measures it and the check stops wal-held without writing
      // one: the cleared count, the marks and the record's since all stay as the first step left them.
      firstStep = { record: metaOf(x.box, HEALTH_META.exportMarksCheck), left: Number(q(x.box, 'SELECT count(*) AS n FROM blobs WHERE exported_seg = ?', x.S1)[0]!['n']) };
      await onStore(x.box, (db) => SW.exportStep(db, exportCtx(x.box, x.ids, () => NOW + 2 * MIN + 30_000, { deps })));
    } finally {
      reader.close();
    }
    expect(firstStep.record ?? 'no stop', 'the first step stopped wal-held').toMatch(new RegExp(`^wal-held ${NOW + 2 * MIN} [1-9][0-9]*$`));
    expect(q(x.box, 'SELECT count(*) AS n FROM blobs WHERE exported_seg = ?', x.S1)[0]!['n'], 'the second step, behind the held WAL, cleared nothing: no batch ran').toBe(firstStep.left);
    expect(metaOf(x.box, HEALTH_META.exportMarksCheck), 'and its record keeps its since and its cleared count').toBe(firstStep.record);
    expect(ms, 'a busy checkpoint waited for the reader').toBeLessThan(5000);
    expect(timeout, 'the writer\'s busy_timeout is restored').toBe(x9Lib.BUSY_TIMEOUT_MS);
    expect(metaOf(x.box, HEALTH_META.exportMarksCheck) ?? 'no stop', 'stopped at the WAL ceiling').toMatch(new RegExp(`^wal-held ${NOW + 2 * MIN} [1-9][0-9]*$`));
    const left = Number(q(x.box, 'SELECT count(*) AS n FROM blobs WHERE exported_seg = ?', x.S1)[0]!['n']);
    expect(left, 'some batches ran, and not all').toBeGreaterThan(0);
    expect(left).toBeLessThan(40);
    // D-5725: the fixture's own first step stamped an empty check, which covers no bind fact, so the record is '[]', not absent
    expect(metaOf(x.box, 'export_marks_checked_binds')).toBe('[]');
    expect(strandedBlobs(x.box)).toEqual([]);
    await onStore(x.box, (db) => SW.exportStep(db, exportCtx(x.box, x.ids, () => NOW + 3 * MIN, { deps })));
    expect(metaOf(x.box, HEALTH_META.exportMarksCheck), 'with the reader gone the check ends').toBeNull();
    expect(q(x.box, 'SELECT count(*) AS n FROM blobs WHERE exported_seg = ?', x.S1)[0]!['n']).toBe(0);
    expect(metaOf(x.box, HEALTH_META.exportSegmentMissing), 'forty blobs, forty referrers and the entry marked S1').toBe('81');
  }, 300_000);

  it('a stop record standing when no check is owed (a B4 build finished the check without deleting it, before a roll-forward) is deleted by the next step with the once-a-check flag, and status shows neither word', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-bindstale-', [row(1, 'one', DAY)]);
    const NOW = Date.now();
    await onStore(box, (db) => {
      // every bind fact covered by the last check's record, so lib decideMarkCheck owes no check
      setMeta(db, `bound:${NOW - DAY}`, 'restore');
      setMeta(db, 'export_marks_checked_binds', JSON.stringify([`bound:${NOW - DAY}`]));
      setMeta(db, HEALTH_META.exportMarksCheck, `wal-held ${NOW - 2 * DAY} 5`);
      setMeta(db, 'export_marks_counted', '1');
    });
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => NOW + 2 * MIN)));
    // D-5725: the fixture's own first step stamped an empty check (a store with no listing record owes one), so the stamp exists; this step's is what must be absent
    expect(metaOf(box, 'export_marks_checked_ms'), 'CONTROL: no check was owed, so none ran').not.toBe(String(NOW + 2 * MIN));
    expect(metaOf(box, HEALTH_META.exportMarksCheck), 'a stop record no owed check stands behind is deleted').toBeNull();
    expect(metaOf(box, 'export_marks_counted'), 'and the once-a-check flag with it').toBeNull();
    const st = runCli(box, ['status', '--json']);
    expect(st.code, `${st.stdout}\n${st.stderr}`).toBe(0);
    const health = (st.json as unknown as { health: { warn: Array<{ word: string }>; fail: Array<{ word: string }> } }).health;
    const words = [...health.warn, ...health.fail].map((i) => i.word);
    expect(words).not.toContain('export-marks-unchecked');
    expect(words).not.toContain('export-marks-stalled');
  }, 120_000);

  it('a once-a-check flag standing alone when no check is owed (a check killed after a batch, then finished by a B4 build after a rollback) is deleted by the next step, so the next check counts once', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-bindflag-', [row(1, 'one', DAY)]);
    const NOW = Date.now();
    const s1 = `1.${ids.writer}.db`;
    await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, () => NOW)));
    expect(Object.values(marks(box))).toEqual([s1]);
    await onStore(box, (db) => {
      // every bind fact covered, no stop record, and the flag a killed check left
      setMeta(db, `bound:${NOW - DAY}`, 'restore');
      setMeta(db, 'export_marks_checked_binds', JSON.stringify([`bound:${NOW - DAY}`]));
      setMeta(db, 'export_marks_counted', '1');
    });
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => NOW + 2 * MIN)));
    // D-5725: the fixture's own first step stamped an empty check (a store with no listing record owes one), so the stamp exists; this step's is what must be absent
    expect(metaOf(box, 'export_marks_checked_ms'), 'CONTROL: no check was owed, so none ran').not.toBe(String(NOW + 2 * MIN));
    expect(metaOf(box, 'export_marks_counted'), 'a once-a-check flag no owed check stands behind is deleted').toBeNull();
    // a later bind with the segment gone: its check clears the mark and counts itself
    fs.rmSync(path.join(exportDirOf(box), s1));
    await bind(box, NOW + 3 * MIN);
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => NOW + 4 * MIN)));
    expect(Object.values(marks(box)), 'CONTROL: the later check cleared the gone segment\'s mark').toEqual([null]);
    expect(counters(box)['export_segment_missing'], 'the later check counted itself once (O39)').toBe(1);
  }, 120_000);

  it('history-off planted between two batches stops the check before the next (off), keeping what it cleared; the next step after it goes finishes', async () => {
    const NOW = Date.now();
    const x = await lostBox('ccrc-history-export-bindoff-', { lost: 6, zBytes: 1000 });
    await bind(x.box, NOW + MIN);
    const off = historyPaths(x.box.home).off;
    await onStore(x.box, (db) => SW.exportStep(db, exportCtx(x.box, x.ids, () => NOW + 2 * MIN, { deps: { exportBindBytes: 2000, afterMarkBatch: () => { fs.writeFileSync(off, ''); } } })));
    expect(metaOf(x.box, HEALTH_META.exportMarksCheck), 'history-off stopped the check after its first batch').toBe(`off ${NOW + 2 * MIN} 4`);
    // D-5725: the fixture's own first step stamped an empty check, which covers no bind fact, so the record is '[]', not absent
    expect(metaOf(x.box, 'export_marks_checked_binds')).toBe('[]');
    expect(strandedBlobs(x.box)).toEqual([]);
    fs.rmSync(off);
    await onStore(x.box, (db) => SW.exportStep(db, exportCtx(x.box, x.ids, () => NOW + 3 * MIN, { deps: { exportBindBytes: 2000 } })));
    expect(metaOf(x.box, HEALTH_META.exportMarksCheck)).toBeNull();
    expect(metaOf(x.box, HEALTH_META.exportSegmentMissing)).toBe('13');
  }, 120_000);

  it('any other error between batches is counted and recorded failed with one stderr line; the batch before it stays committed, and the next step finishes', async () => {
    const NOW = Date.now();
    const x = await lostBox('ccrc-history-export-bindfail-', { lost: 6, zBytes: 1000 });
    await bind(x.box, NOW + MIN);
    let seen = 0;
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let lines: string[] = [];
    try {
      await onStore(x.box, (db) => SW.exportStep(db, exportCtx(x.box, x.ids, () => NOW + 2 * MIN, {
        deps: { exportBindBytes: 2000, afterMarkBatch: () => { if ((seen += 1) === 1) throw new Error('a fault between two batches'); } },
      })));
      lines = err.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('history-sweep: the export marks could not be checked'));
    } finally {
      err.mockRestore();
    }
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('a fault between two batches');
    expect(counters(x.box)['export_marks_check_failed']).toBe(1);
    expect(metaOf(x.box, HEALTH_META.exportMarksCheck), 'the stop is recorded with the count').toBe(`failed ${NOW + 2 * MIN} 0`);
    expect(metaOf(x.box, HEALTH_META.exportSegmentMissing), 'the batch before the fault committed').toBe('4');
    expect(strandedBlobs(x.box)).toEqual([]);
    await onStore(x.box, (db) => SW.exportStep(db, exportCtx(x.box, x.ids, () => NOW + 3 * MIN, { deps: { exportBindBytes: 2000 } })));
    expect(metaOf(x.box, HEALTH_META.exportMarksCheck)).toBeNull();
    expect(metaOf(x.box, HEALTH_META.exportSegmentMissing)).toBe('13');
  }, 120_000);

  it('R3: the export pass still runs in a step whose check stopped short, and nothing is lost: the rows the check cleared go into the next segment, the rest after the check ends', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-bindpass-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const NOW = Date.now();
    const s1 = `1.${ids.writer}.db`;
    const s2 = `2.${ids.writer}.db`;
    const s3 = `3.${ids.writer}.db`;
    await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, () => NOW)));
    expect(Object.values(marks(box))).toEqual([s1, s1]);
    fs.rmSync(path.join(exportDirOf(box), s1));
    await bind(box, NOW + MIN);
    const T = NOW + 2 * HOUR;
    const deps = { statfs: roomy, exportBindBytes: 1, exportBindWalCeiling: 1 };   // one blob a batch; any held WAL stops it
    const reader = new MemDb(historyPaths(box.home).dbFile, { readOnly: true });
    let r: PassResult | null;
    try {
      reader.exec('BEGIN');
      reader.prepare('SELECT count(*) AS n FROM blobs').get();
      r = await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => T, { deps })));
    } finally {
      reader.close();
    }
    expect(metaOf(box, HEALTH_META.exportMarksCheck) ?? 'no stop', 'the check stopped after one batch').toMatch(new RegExp(`^wal-held ${T} 2$`));
    expect(r, 'R3: the pass ran behind a check that stopped short').toMatchObject({ state: 'written', segment: s2, rows: 1 });
    expect(marks(box)).toEqual({ [rid(1)]: s2, [rid(2)]: s1 });
    expect(strandedBlobs(box)).toEqual([]);
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => T + MIN, { deps })));
    expect(metaOf(box, HEALTH_META.exportMarksCheck), 'with the reader gone the check ends').toBeNull();
    expect(marks(box), 'only the missing segment\'s marks go; the new segment\'s stay').toEqual({ [rid(1)]: s2, [rid(2)]: null });
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => T + 61 * MIN, { deps })));
    expect(marks(box)).toEqual({ [rid(1)]: s2, [rid(2)]: s3 });
    expect(strandedBlobs(box)).toEqual([]);
  }, 300_000);
});

// ── W5h-1 Task 2: status reads the check's stop record, and doctor's two words come from it (D-5633) ───────────────
// The real CLI against a store B1's first scheduled pass made (fixture HOMEs only, as B4 Task 9's describes above). The
// record is planted exactly as Task 1's check leaves it: '<word> <sinceMs> <cleared>' in HEALTH_META.exportMarksCheck.
describe('W5h-1 Task 2: status reads export_marks_check; a stopped check WARNs, a stalled one FAILs, a malformed one is unmeasured (D-5633)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });

  /** A bound store after its first scheduled pass. */
  function w5Bound(prefix: string): x9H.HistoryBox {
    const box = x9H.makeHistoryBox(prefix, { role: 'fleet', shim: true });
    const r = x9H.runSweep(box);
    expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
    return box;
  }
  /** The check's stop record set to `v`, or deleted when `v` is null (the done stamp's delete). */
  function w5Plant(box: x9H.HistoryBox, v: string | null): void {
    const db = x9Store.openWriter(x9Lib.historyPaths(box.home).dbFile);
    try {
      if (v === null) db.prepare('DELETE FROM meta WHERE k = ?').run(x9Lib.HEALTH_META.exportMarksCheck);
      else x9Store.setMeta(db, x9Lib.HEALTH_META.exportMarksCheck, v);
    } finally { x9Store.closeWriter(db); }
  }
  /** `ccrc history status --json`'s health, as doctor reads it. */
  function w5Health(box: x9H.HistoryBox): X9Envelope['health'] {
    const r = x9H.runCli(box, ['status', '--json']);
    expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
    return (r.json as unknown as X9Envelope).health;
  }
  const w5Words = (h: X9Envelope['health']): string[] => [...h.warn, ...h.fail].map((i) => i.word);

  it('planted, the record WARNs export-marks-unchecked; an escalating word past the stall FAILs export-marks-stalled instead; deleted, neither', () => {
    const box = w5Bound('ccrc-hist-w5h2-status-');
    expect(w5Words(w5Health(box)), 'CONTROL: a fresh store has no check standing').not.toContain('export-marks-unchecked');
    w5Plant(box, `budget ${Date.now() - 30 * X9_MIN} 4`);
    const warned = w5Health(box);
    const item = warned.warn.find((i) => i.word === 'export-marks-unchecked');
    expect(item, JSON.stringify(warned)).toBeDefined();
    expect(item!.detail).toContain('it last stopped on budget (');
    expect(item!.detail).toContain('has cleared 4 mark(s) so far');
    expect(warned.fail.map((i) => i.word)).not.toContain('status-unreadable');
    w5Plant(box, `wal-held ${Date.now() - x9Lib.EXPORT_MARKS_STALL_MS - X9_HOUR} 4`);
    const failed = w5Health(box);
    expect(failed.fail.map((i) => i.word)).toContain('export-marks-stalled');
    expect(failed.warn.map((i) => i.word), 'the FAIL replaces the WARN').not.toContain('export-marks-unchecked');
    w5Plant(box, null);
    const words = w5Words(w5Health(box));
    expect(words).not.toContain('export-marks-unchecked');
    expect(words).not.toContain('export-marks-stalled');
  }, 120_000);

  it('a record the parser refuses is unmeasured: FAIL status-unreadable naming export_marks_check, never "no check standing"', () => {
    const box = w5Bound('ccrc-hist-w5h2-malformed-');
    w5Plant(box, 'budget soon 4');
    const h = w5Health(box);
    const unread = h.fail.find((i) => i.word === 'status-unreadable');
    expect(unread, JSON.stringify(h)).toBeDefined();
    expect(unread!.detail).toContain(x9Lib.HEALTH_META.exportMarksCheck);
    expect(w5Words(h)).not.toContain('export-marks-unchecked');
  }, 120_000);
});

// ── W5h-1 Task 3: a carried segment counts only when it is whole and this store's (D-5634 (history-export-segment-whole-check)) ──
// An adopt carries export/<store_id>/ by hand, and the check after the bind used to compare NAMES only: a file cut short by a
// copy, a file that is not SQLite, another store's segment or another segment's bytes under a marked name counted as present,
// and its marks stood over text no segment on this box holds. Each case below exports two segments in-process, damages the
// second, plants a bind fact and runs one step: the damaged one is treated as missing and left exactly where it is.
describe('a carried segment counts only when it is whole and this store\'s (W5h-1 Task 3; spec §9.15 "After a bind"; D-5634)', () => {
  const OTHER_STORE = '0189abcd-1234-4678-9abc-0000000000f9';
  /** Rows 1 to 3 exported in two in-process passes: row 1 into segment 1 (a run budget of one byte bounds it), rows 2 and 3
   *  into segment 2 an hour later. Answers the box, its ids, the two names, a clock and the export directory. */
  async function twoSegments(prefix: string): Promise<{ box: HistoryBox; ids: { storeId: string; writer: string }; s1: string; s2: string; at: (ms: number) => () => number; dir: string }> {
    const { box, ids } = ingestedBox(prefix, [row(1, 'oldest', 3 * DAY), row(2, 'middle', 2 * DAY), row(3, 'newest', DAY)]);
    const NOW = Date.now();
    const at = (ms: number) => (): number => NOW + ms;
    const s1 = `1.${ids.writer}.db`;
    const s2 = `2.${ids.writer}.db`;
    await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(0), { limits: { maxBytes: 1 } })));
    await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(HOUR))));
    expect(marks(box), 'CONTROL: row 1 in segment 1, rows 2 and 3 in segment 2').toEqual({ [rid(1)]: s1, [rid(2)]: s2, [rid(3)]: s2 });
    return { box, ids, s1, s2, at, dir: exportDirOf(box) };
  }
  /** Every name in the export directory with its inode, size and mtime: what the check must never change. */
  const listing = (dir: string): Array<[string, number, number, number]> =>
    fs.readdirSync(dir).sort().map((n) => { const st = fs.statSync(path.join(dir, n)); return [n, st.ino, st.size, st.mtimeMs]; });
  /** One step with a new bind fact at `bindMs`, run at `stepMs`, with stderr captured: the lines the check printed about a damaged segment. */
  async function bindStep(box: HistoryBox, ids: { storeId: string; writer: string }, at: (ms: number) => () => number, bindMs: number, stepMs: number): Promise<string[]> {
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await onStore(box, async (db) => {
        setMeta(db, `bound:${at(bindMs)()}`, 'adopt');
        await SW.exportStep(db, exportCtx(box, ids, at(stepMs)));
      });
      return err.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('history-sweep: export segment '));
    } finally {
      err.mockRestore();
    }
  }

  const DAMAGE: Array<[string, string, (dir: string, s1: string, s2: string, box: HistoryBox, ids: { storeId: string; writer: string }) => void]> = [
    ['cut to half its length (a copy still running, or one that stopped)', 'short', (dir, _s1, s2) => {
      const p = path.join(dir, s2);
      fs.truncateSync(p, Math.floor(fs.statSync(p).size / 2));
    }],
    ['cut to 0 bytes', 'short', (dir, _s1, s2) => { fs.truncateSync(path.join(dir, s2), 0); }],
    ['a file that is not SQLite, at the same length', 'not-sqlite', (dir, _s1, s2) => {
      const p = path.join(dir, s2);
      fs.writeFileSync(p, Buffer.alloc(fs.statSync(p).size, 'x'));
    }],
    ['another store\'s segment under its name', 'foreign', (dir, _s1, s2, box, ids) => {
      fs.rmSync(path.join(dir, s2));
      plantSegment(box, ids.storeId, { seq: 2, writer: ids.writer, metaStoreId: OTHER_STORE, blobs: [{ text: 'another store\'s body' }], rows: [] });
    }],
    ['segment 1\'s bytes copied under segment 2\'s name (whole, this store\'s, but renamed)', 'renamed', (dir, s1, s2) => {
      fs.copyFileSync(path.join(dir, s1), path.join(dir, s2));
    }],
  ];
  for (const [what, verdict, damage] of DAMAGE) {
    it(`segment 2 ${what}: the check after a bind reads it ${verdict}, clears only the marks naming it, counts export_segment_damaged once, records its name for doctor, and leaves export/ as it was; the next pass exports its rows again`, async () => {
      const { box, ids, s1, s2, at, dir } = await twoSegments(`ccrc-history-export-segdmg-${verdict}-`);
      damage(dir, s1, s2, box, ids);
      const before = listing(dir);
      const lines = await bindStep(box, ids, at, HOUR + MIN, HOUR + 2 * MIN);   // the cadence waits (last pass at +1 h): only the check runs
      expect(marks(box), 'a mark still names a segment that is not whole or not this store\'s').toEqual({ [rid(1)]: s1, [rid(2)]: null, [rid(3)]: null });
      expect(q(box, 'SELECT DISTINCT exported_seg AS seg FROM blobs WHERE exported_seg IS NOT NULL').map((r) => r['seg'])).toEqual([s1]);
      expect(counters(box)['export_segment_damaged']).toBe(1);
      expect(counters(box)['export_segment_missing'], 'its marks were cleared as a missing segment\'s are').toBe(1);
      expect(metaOf(box, HEALTH_META.exportSegmentDamaged)).toBe(JSON.stringify([s2]));
      expect(lines, 'one line, naming the segment, its directory and its verdict').toEqual([
        `history-sweep: export segment ${s2} in ${dir} is ${verdict}: its marks are cleared and its rows export again; it is left in place\n`,
      ]);
      expect(listing(dir), 'the check renamed, removed or wrote something under export/').toEqual(before);
      expect(strandedBlobs(box)).toEqual([]);
      await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(2 * HOUR + 3 * MIN))));
      const s3 = `3.${ids.writer}.db`;
      expect(marks(box), 'rows 2 and 3 export again, into the next number past the damaged name').toEqual({ [rid(1)]: s1, [rid(2)]: s3, [rid(3)]: s3 });
      expect(strandedBlobs(box)).toEqual([]);
    }, 120_000);
  }

  it('CONTROL: two whole segments of this store stay present: the check clears nothing, counts nothing and writes no record', async () => {
    const { box, ids, s1, s2, at } = await twoSegments('ccrc-history-export-segwhole-');
    const lines = await bindStep(box, ids, at, HOUR + MIN, HOUR + 2 * MIN);
    expect(metaOf(box, 'export_marks_checked_ms'), 'CONTROL: the check ran').toBe(String(at(HOUR + 2 * MIN)()));
    expect(marks(box)).toEqual({ [rid(1)]: s1, [rid(2)]: s2, [rid(3)]: s2 });
    expect(counters(box)['export_segment_damaged']).toBeUndefined();
    expect(counters(box)['export_segment_missing']).toBeUndefined();
    expect(metaOf(box, HEALTH_META.exportSegmentDamaged), 'a clean check writes no record').toBeNull();
    expect(lines).toEqual([]);
  }, 120_000);

  it('the record follows the files: a later check counts and prints only a name it has not recorded; once the damaged files are moved out of export/<store_id>/, the next check empties the record', async () => {
    const { box, ids, s1, s2, at, dir } = await twoSegments('ccrc-history-export-segrecord-');
    fs.truncateSync(path.join(dir, s2), 0);
    await bindStep(box, ids, at, HOUR + MIN, HOUR + 2 * MIN);
    expect(metaOf(box, HEALTH_META.exportSegmentDamaged)).toBe(JSON.stringify([s2]));
    // segment 1 is cut too; segment 2 is still in place, still damaged, and already recorded
    fs.truncateSync(path.join(dir, s1), 0);
    const again = await bindStep(box, ids, at, HOUR + 3 * MIN, HOUR + 4 * MIN);
    expect(again, 'one line, for the name not yet recorded').toEqual([
      `history-sweep: export segment ${s1} in ${dir} is short: its marks are cleared and its rows export again; it is left in place\n`,
    ]);
    expect(counters(box)['export_segment_damaged'], 'a name already recorded is not counted again').toBe(2);
    expect(metaOf(box, HEALTH_META.exportSegmentDamaged), 'in (seq, writer) order').toBe(JSON.stringify([s1, s2]));
    expect(marks(box)).toEqual({ [rid(1)]: null, [rid(2)]: null, [rid(3)]: null });
    for (const s of [s1, s2]) fs.renameSync(path.join(dir, s), path.join(box.home, `${s}.aside`));   // the remedy: out of export/<store_id>/
    await bindStep(box, ids, at, HOUR + 5 * MIN, HOUR + 6 * MIN);
    expect(metaOf(box, HEALTH_META.exportSegmentDamaged), 'the WARN clears once the files are out and a check runs').toBe('[]');
    expect(counters(box)['export_segment_damaged']).toBe(2);
  }, 120_000);

  it('status reads the check\'s record and never a segment: the WARN export-segment-damaged names it; a record that does not read back is status-unreadable, never "nothing damaged"', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-segstatus-', [row(1, 'one', DAY)]);
    type Health = { health: { warn: Array<{ word: string; detail: string; remedy: string }>; fail: Array<{ word: string; detail: string }> } };
    const status = (): Health => {
      const r = runCli(box, ['status', '--json']);
      expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
      return r.json as unknown as Health;
    };
    const name = `2.${ids.writer}.db`;
    await onStore(box, (db) => setMeta(db, HEALTH_META.exportSegmentDamaged, JSON.stringify([name])));
    const warned = status().health.warn.find((i) => i.word === 'export-segment-damaged');
    expect(warned?.detail).toContain(name);
    expect(warned?.remedy).toContain('move each named file out of');
    await onStore(box, (db) => setMeta(db, HEALTH_META.exportSegmentDamaged, 'not a list'));
    const h = status().health;
    expect(h.warn.map((i) => i.word)).not.toContain('export-segment-damaged');
    expect(h.fail.map((i) => i.word), 'a record that does not read back was read as "nothing damaged"').toContain('status-unreadable');
    expect(h.fail.find((i) => i.word === 'status-unreadable')!.detail).toContain(HEALTH_META.exportSegmentDamaged);
    await onStore(box, (db) => setMeta(db, HEALTH_META.exportSegmentDamaged, '[]'));
    const clean = status().health;
    expect(clean.warn.map((i) => i.word)).not.toContain('export-segment-damaged');
    expect(clean.fail.map((i) => i.word)).not.toContain('status-unreadable');
  }, 120_000);

  // ── W5h-1 Task 3 fix round 1 (FR1-F2): the two catches in the check that keep one bad file or one bad meta value from
  // failing every step (the check would never finish, and doctor would FAIL export-marks-stalled after 24 h). ──────────
  it('a file of the right length that is SQLite but holds no segment meta reads meta-unreadable: treated as missing, recorded, and the check still finishes (no failed stop record)', async () => {
    const { box, ids, s1, s2, at, dir } = await twoSegments('ccrc-history-export-segmeta-');
    // a plain SQLite database with one table: whole by its header, but segmentMeta cannot read a segment's meta from it
    const plain = path.join(box.home, 'plain.db');
    const db = new MemDb(plain);
    db.exec('CREATE TABLE t (a INTEGER); INSERT INTO t VALUES (1);');
    db.close();
    fs.copyFileSync(plain, path.join(dir, s2));
    const facts = x9Store.segmentFileFacts(path.join(dir, s2));
    expect(x9Lib.decideSegmentWhole(facts), 'CONTROL: the file passes the length test, so the case reaches the meta read').toBe('whole');
    const lines = await bindStep(box, ids, at, HOUR + MIN, HOUR + 2 * MIN);
    expect(lines).toEqual([
      `history-sweep: export segment ${s2} in ${dir} is meta-unreadable: its marks are cleared and its rows export again; it is left in place\n`,
    ]);
    expect(marks(box)).toEqual({ [rid(1)]: s1, [rid(2)]: null, [rid(3)]: null });
    expect(metaOf(box, HEALTH_META.exportSegmentDamaged)).toBe(JSON.stringify([s2]));
    expect(counters(box)['export_segment_damaged']).toBe(1);
    expect(counters(box)['export_marks_check_failed'], 'the throw reached exportStep\'s catch').toBeUndefined();
    expect(metaOf(box, HEALTH_META.exportMarksCheck), 'a failed stop record stands').toBeNull();
    expect(metaOf(box, 'export_marks_checked_ms'), 'the done stamp was not written').toBe(String(at(HOUR + 2 * MIN)()));
  }, 120_000);

  it('a damaged record that does not read back, standing when the check runs, is rewritten whole from this check\'s names (each counts as new); the check still finishes', async () => {
    const { box, ids, s1, s2, at, dir } = await twoSegments('ccrc-history-export-segbadrec-');
    await onStore(box, (db) => setMeta(db, HEALTH_META.exportSegmentDamaged, 'not a list'));
    fs.truncateSync(path.join(dir, s2), 0);
    const lines = await bindStep(box, ids, at, HOUR + MIN, HOUR + 2 * MIN);
    expect(lines).toHaveLength(1);
    expect(metaOf(box, HEALTH_META.exportSegmentDamaged)).toBe(JSON.stringify([s2]));
    expect(counters(box)['export_segment_damaged']).toBe(1);
    expect(counters(box)['export_marks_check_failed'], 'the throw reached exportStep\'s catch').toBeUndefined();
    expect(metaOf(box, HEALTH_META.exportMarksCheck), 'a failed stop record stands').toBeNull();
    expect(metaOf(box, 'export_marks_checked_ms'), 'the done stamp was not written').toBe(String(at(HOUR + 2 * MIN)()));
    expect(marks(box)).toEqual({ [rid(1)]: s1, [rid(2)]: null, [rid(3)]: null });
  }, 120_000);

  // ── FR1-F1 (D-5641 (history-export-damaged-record-remeasured)): a repair in place clears the record without a bind ──
  /** One step with NO new bind fact (so no check is owed), at `stepMs`, with stderr captured. */
  async function plainStep(box: HistoryBox, ids: { storeId: string; writer: string }, at: (ms: number) => () => number, stepMs: number): Promise<string[]> {
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(stepMs))));
      return err.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('history-sweep: export segment '));
    } finally {
      err.mockRestore();
    }
  }
  const warnWords = (box: HistoryBox): string[] => {
    const r = runCli(box, ['status', '--json']);
    expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
    return (r.json as unknown as { health: { warn: Array<{ word: string }> } }).health.warn.map((i) => i.word);
  };

  it('a recorded segment put back whole under its name leaves the record on the next step with no bind: doctor\'s WARN goes, nothing is counted, cleared or marked, and a segment still short stays recorded', async () => {
    const { box, ids, s1, s2, at, dir } = await twoSegments('ccrc-history-export-segrepair-');
    const good = fs.readFileSync(path.join(dir, s2));
    fs.truncateSync(path.join(dir, s2), Math.floor(good.length / 2));
    await bindStep(box, ids, at, HOUR + MIN, HOUR + 2 * MIN);
    expect(metaOf(box, HEALTH_META.exportSegmentDamaged)).toBe(JSON.stringify([s2]));
    expect(warnWords(box), 'CONTROL: the WARN stands while the file is short').toContain('export-segment-damaged');
    const marksBefore = marks(box);
    const still = await plainStep(box, ids, at, HOUR + 3 * MIN);
    expect(still, 'a name that still fails stays, silently').toEqual([]);
    expect(metaOf(box, HEALTH_META.exportSegmentDamaged)).toBe(JSON.stringify([s2]));
    fs.writeFileSync(path.join(dir, s2), good);   // the WARN's first remedy: a whole copy back, under the same name
    const lines = await plainStep(box, ids, at, HOUR + 4 * MIN);
    expect(lines).toEqual([`history-sweep: export segment ${s2} in ${dir} is whole again; it leaves the damaged record\n`]);
    expect(metaOf(box, HEALTH_META.exportSegmentDamaged)).toBe('[]');
    expect(warnWords(box)).not.toContain('export-segment-damaged');
    expect(counters(box)['export_segment_damaged'], 'not counted again').toBe(1);
    expect(marks(box), 'nothing cleared or marked').toEqual(marksBefore);
    expect(await plainStep(box, ids, at, HOUR + 5 * MIN), 'an empty record is left alone').toEqual([]);
    expect(metaOf(box, HEALTH_META.exportSegmentDamaged)).toBe('[]');
    void s1;
  }, 120_000);

  it('a damaged record that does not read back is left alone by a step that owes no check: no throw, the pass still runs, status names it unmeasured', async () => {
    const { box, ids, at } = await twoSegments('ccrc-history-export-segbadrec2-');
    await onStore(box, (db) => setMeta(db, HEALTH_META.exportSegmentDamaged, 'not a list'));
    await plainStep(box, ids, at, HOUR + 3 * MIN);
    expect(metaOf(box, HEALTH_META.exportSegmentDamaged)).toBe('not a list');
  }, 120_000);
});

// ── W5h-1 Task 4: the check re-arms when a segment it saw is gone (D-5636 (history-export-vanished-rearm)) ──────────
// The listing record is meta export_marks_checked_listing: lib segmentListingRecord's `<count> <digest>` over every segment
// name the last check listed, damaged ones included, plus each segment a pass published since (added in the pass's mark
// transaction). Every step lists export/<store_id>/ and re-arms the check when the names differ from the record.
describe('the check re-arms when a segment it saw is gone (W5h-1 Task 4; D-5636 (history-export-vanished-rearm))', () => {
  const t4Roomy = async (): Promise<{ bsize: number; bavail: number; blocks: number }> => ({ bsize: 1, bavail: 4 * TIB, blocks: 8 * TIB });
  const LISTING = 'export_marks_checked_listing';

  it('a segment moved aside after the first tick re-arms the check on the next step with no bind: its marks are cleared and its rows export again', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-vanish-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const NOW = Date.now();
    const at = (ms: number) => (): number => NOW + ms;
    const s1 = `1.${ids.writer}.db`;
    const s2 = `2.${ids.writer}.db`;
    await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(0))));
    expect(Object.values(marks(box))).toEqual([s1, s1]);
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(2 * MIN))));
    // D-5725: the fixture's own first step stamped an empty check, so its stamp is not null; the step after the pass must not have stamped
    expect(metaOf(box, 'export_marks_checked_ms'), 'the first tick after the pass: nothing gone, no check').not.toBe(String(NOW + 2 * MIN));
    // moved aside, outside any bind (an operator's tidy-up, a disk move): no bind fact is written
    fs.renameSync(path.join(exportDirOf(box), s1), path.join(box.home, 'moved-aside.db'));
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(3 * MIN))));
    expect(Object.values(marks(box)), 'a segment gone after the first tick left its marks standing').toEqual([null, null]);
    expect(metaOf(box, 'export_marks_checked_ms')).toBe(String(NOW + 3 * MIN));
    expect(counters(box)['export_segment_missing']).toBe(1);
    expect(metaOf(box, HEALTH_META.exportSegmentMissing), 'two entries\' marks and two blobs\'').toBe('4');
    expect(metaOf(box, LISTING), 'the check records what it saw: no segment').toBe(`0 ${'0'.repeat(32)}`);
    expect(strandedBlobs(box), 'D-5395: no live blob is held only by marked entries').toEqual([]);
    // an hour on, the cadence is due: the rows export again, into the next number
    const again = await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(65 * MIN), { deps: { statfs: t4Roomy } })));
    expect(again).toMatchObject({ state: 'written', segment: s2, complete: true });
    expect(segmentsOf(box)).toEqual([s2]);
    expect(Object.values(marks(box))).toEqual([s2, s2]);
    expect(metaOf(box, HEALTH_META.exportSegmentMissing), 'the re-export left nothing due behind: the WARN clears').toBe('0');
    expect(counters(box)['export_segment_missing'], 'one check cleared marks').toBe(1);
  }, 120_000);

  it('a segment a pass published does not re-arm the check: the pass adds its name to the listing record in its mark transaction', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-vanishpub-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const NOW = Date.now();
    const at = (ms: number) => (): number => NOW + ms;
    const s1 = `1.${ids.writer}.db`;
    // D-5725: the fixture's own first step stamped an empty check and made the record, so a stamp exists; it must not move
    const stamped = metaOf(box, 'export_marks_checked_ms');
    expect(metaOf(box, LISTING), 'CONTROL: the fixture\'s empty check made the record').toBe(`0 ${'0'.repeat(32)}`);
    await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(0))));
    for (const m of [2, 3, 4]) await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(m * MIN))));
    expect(metaOf(box, 'export_marks_checked_ms'), 'a step re-armed the check on the pass\'s own segment').toBe(stamped);
    expect(Object.values(marks(box))).toEqual([s1, s1]);
    expect(metaOf(box, LISTING), 'the pass started the record at its own segment').toBe(`1 ${x9Lib.segmentListingDigest([s1])}`);
  }, 120_000);

  it('a segment that goes before a pass stays in the listing record: the pass adds its own name and never starts the record over, so the next step still re-arms', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-vanishpre-', [row(1, 'one', 2 * DAY), row(2, 'two', DAY)]);
    const NOW = Date.now();
    const at = (ms: number) => (): number => NOW + ms;
    const s1 = `1.${ids.writer}.db`;
    const s2 = `2.${ids.writer}.db`;
    // a budget of one byte: the first due row still travels, alone (D-4760), so the second is left for a later pass
    const first = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(0), { limits: { maxBytes: 1 } })));
    expect(first, 'the fixture must leave a row for a second pass').toMatchObject({ state: 'written', segment: s1, rows: 1, complete: false });
    expect(marks(box)).toEqual({ [rid(1)]: s1, [rid(2)]: null });
    fs.rmSync(path.join(exportDirOf(box), s1));
    // the pass runs before any step measures the directory (as when the segment goes inside a step, after its listing)
    const second = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(5 * MIN))));
    expect(second).toMatchObject({ state: 'written', segment: s2 });
    expect(marks(box)).toEqual({ [rid(1)]: s1, [rid(2)]: s2 });
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(6 * MIN))));
    expect(marks(box), 'the pass\'s record forgot the segment that went before it').toEqual({ [rid(1)]: null, [rid(2)]: s2 });
    expect(counters(box)['export_segment_missing']).toBe(1);
    expect(strandedBlobs(box)).toEqual([]);
  }, 120_000);

  it('a carry that adds a segment clears nothing, and the check records it so the next step is quiet; one that adds a segment while another is gone still clears the gone one\'s marks', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-vanishcarry-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const NOW = Date.now();
    const at = (ms: number) => (): number => NOW + ms;
    const s1 = `1.${ids.writer}.db`;
    const OLD = 'c0ffee00';   // the writer of the box the store came from
    await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(0))));
    // a segment carried in late from the old box: this store's, whole, and named by no mark here
    const carried = path.basename(plantSegment(box, ids.storeId, { seq: 1, writer: OLD, blobs: [], rows: [] }));
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(2 * MIN))));
    expect(metaOf(box, 'export_marks_checked_ms'), 'the record cannot tell an add from a loss: the step checks').toBe(String(NOW + 2 * MIN));
    expect(Object.values(marks(box)), 'a carry that adds a segment cleared marks').toEqual([s1, s1]);
    expect(counters(box)['export_segment_missing']).toBeUndefined();
    expect(metaOf(box, HEALTH_META.exportSegmentMissing)).toBeNull();
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(3 * MIN))));
    expect(metaOf(box, 'export_marks_checked_ms'), 'the check did not record the listing it saw: every step checks again').toBe(String(NOW + 2 * MIN));
    // one more carried in while this box's own segment goes: the count is unchanged, the digest is not
    fs.rmSync(path.join(exportDirOf(box), carried));
    plantSegment(box, ids.storeId, { seq: 2, writer: OLD, blobs: [], rows: [] });
    fs.rmSync(path.join(exportDirOf(box), s1));
    plantSegment(box, ids.storeId, { seq: 3, writer: OLD, blobs: [], rows: [] });
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(4 * MIN))));
    expect(Object.values(marks(box)), 'a segment gone behind a carry of the same count left its marks standing').toEqual([null, null]);
    expect(counters(box)['export_segment_missing']).toBe(1);
  }, 120_000);

  it('a damaged segment moved out of export/<store_id>/ re-arms the check with no bind, and the damaged record empties: every listed name counts in the record, damaged ones included', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-vanishdmg-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const NOW = Date.now();
    const at = (ms: number) => (): number => NOW + ms;
    const s1 = `1.${ids.writer}.db`;
    const p1 = path.join(exportDirOf(box), s1);
    await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(0))));
    fs.truncateSync(p1, fs.statSync(p1).size - 1);   // one byte short of its header's page_size x page_count
    // a bind: the check reads segment 1 short (Task 3), clears its marks and records its name; its one stderr line is
    // spied, not printed (W5h-1 Task 4 fix round 1, F4)
    const errDmg = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let shortLines: string[] = [];
    try {
      await onStore(box, (db) => { setMeta(db, `bound:${NOW + MIN}`, 'restore'); return SW.exportStep(db, exportCtx(box, ids, at(2 * MIN))); });
      shortLines = errDmg.mock.calls.map((c) => String(c[0])).filter((l) => l.includes(` export segment ${s1} `) && l.includes(' is short:'));
    } finally {
      errDmg.mockRestore();
    }
    expect(shortLines, 'the check says once that the segment is short').toHaveLength(1);
    expect(metaOf(box, HEALTH_META.exportSegmentDamaged), 'CONTROL: the check recorded the damaged name').toBe(JSON.stringify([s1]));
    expect(metaOf(box, LISTING), 'the record counts the damaged name').toBe(`1 ${x9Lib.segmentListingDigest([s1])}`);
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(3 * MIN))));
    expect(metaOf(box, 'export_marks_checked_ms'), 'a damaged file left in place re-armed the check').toBe(String(NOW + 2 * MIN));
    fs.renameSync(p1, path.join(box.home, `${s1}.aside`));   // the remedy: out of export/<store_id>/
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(4 * MIN))));
    expect(metaOf(box, 'export_marks_checked_ms'), 'a damaged segment moved aside did not re-arm the check').toBe(String(NOW + 4 * MIN));
    expect(metaOf(box, HEALTH_META.exportSegmentDamaged), 'the damaged record empties once the file is out').toBe('[]');
    expect(metaOf(box, LISTING)).toBe(`0 ${'0'.repeat(32)}`);
  }, 120_000);

  it('CONTROL: a listing that fails for any reason but ENOENT is never read as a segment gone: with no bind, no check runs, nothing is counted and the marks stay', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-vanishlist-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const NOW = Date.now();
    const at = (ms: number) => (): number => NOW + ms;
    const s1 = `1.${ids.writer}.db`;
    await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(0))));
    const dir = exportDirOf(box);
    fs.renameSync(dir, `${dir}.kept`);
    fs.writeFileSync(dir, 'a stray file under the directory\'s name');   // listing it fails ENOTDIR
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let lines: string[] = [];
    try {
      await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(2 * MIN))));
      lines = err.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('history-sweep: the export marks could not be checked'));
    } finally {
      err.mockRestore();
    }
    expect(counters(box)['export_marks_check_failed'], 'an unlistable directory was read as a segment gone').toBeUndefined();
    expect(lines).toEqual([]);
    // D-5725: the fixture's own first step stamped an empty check, so the stamp exists; this step's is what must be absent
    expect(metaOf(box, 'export_marks_checked_ms')).not.toBe(String(NOW + 2 * MIN));
    expect(Object.values(marks(box))).toEqual([s1, s1]);
  }, 120_000);

  it('a listing that fails never deletes the stop record of a check the listing re-armed: unmeasured is not "no check owed"; the next measured step finishes the check', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-vanishstop-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const NOW = Date.now();
    const at = (ms: number) => (): number => NOW + ms;
    const s1 = `1.${ids.writer}.db`;
    await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(0))));
    const dir = exportDirOf(box);
    fs.rmSync(path.join(dir, s1));   // gone outside any bind: only the listing owes the check
    // one blob a batch and a one-byte run budget: the re-armed check stops at the budget after its first batch
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(3 * MIN), { deps: { exportBindBytes: 1 }, limits: { maxBytes: 1 } })));
    expect(metaOf(box, HEALTH_META.exportMarksCheck), 'CONTROL: the vanish-owed check stopped at the budget').toBe(`budget ${NOW + 3 * MIN} 2`);
    expect(Object.values(marks(box)).filter((v) => v === s1), 'CONTROL: one mark still names the gone segment').toHaveLength(1);
    fs.renameSync(dir, `${dir}.kept`);
    fs.writeFileSync(dir, 'a stray file under the directory\'s name');   // listing it fails ENOTDIR
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(4 * MIN))));
    expect(metaOf(box, HEALTH_META.exportMarksCheck), 'an unmeasured listing deleted the stop record of a check it could not see finish')
      .toBe(`budget ${NOW + 3 * MIN} 2`);
    expect(Object.values(marks(box)).filter((v) => v === s1), 'nothing cleared while the directory could not be listed').toHaveLength(1);
    fs.rmSync(dir);
    fs.renameSync(`${dir}.kept`, dir);
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(5 * MIN))));
    expect(metaOf(box, HEALTH_META.exportMarksCheck), 'listed again, the check finishes').toBeNull();
    expect(Object.values(marks(box))).toEqual([null, null]);
    expect(strandedBlobs(box)).toEqual([]);
  }, 120_000);

  // ── W5h-1 Task 4 fix round 1 (D-5725 (history-export-listing-record-born-at-a-check)) ──────────────────────────────
  it('a store with no listing record owes one check, whatever its listing holds: marks naming a segment, the export directory emptied, no bind: the next step clears them and the done stamp writes the record (D-5725)', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-norecord-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const NOW = Date.now();
    const at = (ms: number) => (): number => NOW + ms;
    const s1 = `1.${ids.writer}.db`;
    await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(0))));
    expect(Object.values(marks(box))).toEqual([s1, s1]);
    // a store upgraded from B4 has no listing record: the pass above may have made one, so it is removed
    await onStore(box, (db) => { db.prepare('DELETE FROM meta WHERE k = ?').run(LISTING); });
    fs.rmSync(exportDirOf(box), { recursive: true });   // the directory is absent (ENOENT): it lists as none, measured, not unlistable
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(2 * MIN))));
    expect(Object.values(marks(box)), 'no record and an empty listing: the marks naming the gone segment stood').toEqual([null, null]);
    expect(counters(box)['export_segment_missing']).toBe(1);
    expect(metaOf(box, LISTING), 'the check\'s done stamp writes the record').toBe(`0 ${'0'.repeat(32)}`);
    expect(strandedBlobs(box)).toEqual([]);
  }, 120_000);

  it('a pass never creates the listing record, so a segment that goes after a pass seeded nothing still re-arms the check: the record is born at a check\'s done stamp (D-5725)', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-norecordpass-', [row(1, 'one', 2 * DAY), row(2, 'two', DAY)]);
    const NOW = Date.now();
    const at = (ms: number) => (): number => NOW + ms;
    const s1 = `1.${ids.writer}.db`;
    const s2 = `2.${ids.writer}.db`;
    const first = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(0), { limits: { maxBytes: 1 } })));
    expect(first, 'the fixture must leave a row for a second pass').toMatchObject({ state: 'written', segment: s1, rows: 1, complete: false });
    await onStore(box, (db) => { db.prepare('DELETE FROM meta WHERE k = ?').run(LISTING); });   // a store with no record yet
    const second = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(5 * MIN))));
    expect(second).toMatchObject({ state: 'written', segment: s2 });
    expect(metaOf(box, LISTING), 'a pass created the record from its own name').toBeNull();
    fs.rmSync(path.join(exportDirOf(box), s1));
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(6 * MIN))));
    expect(marks(box), 'the record a pass seeded matched the listing, and the old segment\'s marks stood').toEqual({ [rid(1)]: null, [rid(2)]: s2 });
    expect(metaOf(box, LISTING)).toBe(`1 ${x9Lib.segmentListingDigest([s2])}`);
  }, 120_000);

  it('the done stamp writes the listing measured at the START of its step: a segment that goes while the check runs re-arms the next step (D-5725\'s sibling: FR1-F3)', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-stampstart-', [row(1, 'one', 3 * DAY), row(2, 'two', 2 * DAY), row(3, 'three', DAY)]);
    const NOW = Date.now();
    const at = (ms: number) => (): number => NOW + ms;
    const [s1, s2, s3] = [1, 2, 3].map((n) => `${n}.${ids.writer}.db`);
    // a one-byte budget makes each pass take one row, so three passes leave one segment a row
    for (const m of [0, 1, 2]) await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(m * 10), { limits: { maxBytes: 1 } })));
    expect(Object.values(marks(box)).sort()).toEqual([s1, s2, s3]);
    fs.rmSync(path.join(exportDirOf(box), s1));   // the missing set is {s1}; s2's marks are not in it
    let seen = 0;
    const gone = (): void => { if ((seen += 1) === 1) fs.rmSync(path.join(exportDirOf(box), s2)); };
    await onStore(box, (db) => {
      setMeta(db, `bound:${NOW + MIN}`, 'restore');
      return SW.exportStep(db, exportCtx(box, ids, at(3 * MIN), { deps: { exportBindBatch: 1, afterMarkBatch: gone } }));
    });
    expect(seen, 'CONTROL: the hook ran between the check\'s batches').toBeGreaterThanOrEqual(1);
    expect(Object.values(marks(box)).filter((v) => v === s1), 'CONTROL: the check cleared s1\'s marks').toEqual([]);
    expect(Object.values(marks(box)).filter((v) => v === s2), 'CONTROL: s2 was not in this check\'s missing set').toHaveLength(1);
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(4 * MIN))));
    expect(Object.values(marks(box)).filter((v) => v === s2), 'the done stamp recorded a listing measured after s2 went: the next step stayed quiet').toEqual([]);
    expect(strandedBlobs(box)).toEqual([]);
  }, 120_000);
});
