// server/test/history-drain.test.ts
// The history sweep's journal, its two-phase spool drain and the epochs a drain declares (spec
// docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md §9.14, §9.2 step 1, §6.1). There are two ways
// in, the same two compact-card.test.ts uses to reach its helper:
//   - the sweep's own functions, imported in-process against a real store in a fixture HOME (exact clocks, no carrier);
//   - the sweep as the box runs it, a real `node --no-warnings` child, for the order of writes, the kills and the
//     exit codes.
// sweep.mjs ships no types. Its internals are reached through the one typed view `Sweep` below, never through `any`.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { makeHistoryBox, runSweep, skipOnDarwin, openStoreRO, counters, PRELOADS, SWEEP, recordDirFsyncs, type HistoryBox } from './historyHelpers.js';
import { createStore, openWriter, closeWriter } from '../../ccd/history/store.mjs';
import { journalRecord, historyPaths, eventKey, DRAINING_NAME_MAX, SPOOL_FILE_MAX, SPOOL_FILE_LINES_MAX } from '../../ccd/history/lib.mjs';

skipOnDarwin();

type Ids = { storeId: string; writer: string };
type TickCtx = {
  home: string; ids: Ids | null; now: () => number; homes: string[]; rosterUnreadable: boolean;
  out: (line: string) => void; hints?: string[]; firstRows?: unknown;
};
/** The slice of sweep.mjs these tests call. It grows task by task; every member is a real export. */
interface Sweep {
  JournalError: new (code: string, cause?: unknown) => Error & { code: string };
  monthOf(ms: number): string;
  journalFilePath(home: string, storeId: string, writer: string, month: string): string;
  appendJournal(home: string, ids: Ids, lines: readonly string[], nowMs: number): void;
  appendOutbox(db: DatabaseSync, home: string, ids: Ids, nowMs: number): { upto: number; count: number };
  deleteOutbox(db: DatabaseSync, uptoSeq: number): void;
  flushOutbox(db: DatabaseSync, home: string, ids: Ids, nowMs: number): number;
  drainingName(id: string, tickMs: number, pid: number): string;
  parseDrainingName(name: string): { id: string; tickMs: number; pid: number } | null;
  idOfDrainingName(name: string): string | null;
  sidecarName(name: string): string;
  listDraining(home: string): string[];
  drainSpool(db: DatabaseSync, c: TickCtx): string[];
  journalHalf(home: string, ids: Ids | null, nowMs: number): { held: string[]; journalFailed: boolean };
  readDrainingText(path: string): { text: string; bytes: number };
  setAsideOversize(db: DatabaseSync, home: string, name: string): boolean;
  tidyDraining(home: string, tickMs: number, pid: number): { nonRegular: number; malformed: number; displaced: string[]; blocked: string[]; kept: string[] };
  ensureSpoolDirs(home: string): boolean;
  renameSpoolFiles(home: string, tickMs: number, pid: number): string[];
}
let SW: Sweep;
beforeAll(async () => { SW = (await import('../../ccd/history/sweep.mjs')) as unknown as Sweep; });

const T = Date.UTC(2026, 9, 5, 12, 0, 0);
const hist = (home: string, ...p: string[]): string => path.join(home, '.ccrc', 'history', ...p);
const storeIds = (home: string): Ids => ({
  storeId: fs.readFileSync(hist(home, 'store.id'), 'utf8').trim(),
  writer: fs.readFileSync(hist(home, 'store.writer'), 'utf8').trim(),
});
const journalDir = (home: string, storeId: string): string => hist(home, 'journal', storeId);
/** Every record of one store's journal, in file-name order (month, then writer), parsed. Empty lines are dropped. */
const journalOf = (home: string, storeId: string): Array<Record<string, unknown>> => {
  const dir = journalDir(home, storeId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => !n.startsWith('.') && n.endsWith('.jsonl')).sort()
    .flatMap((n) => fs.readFileSync(path.join(dir, n), 'utf8').split('\n').filter((l) => l !== '')
      .map((l) => JSON.parse(l) as Record<string, unknown>));
};
const tickRec = (t: number): string => journalRecord('tick', t, { lag_ms: null });
const mode = (p: string): number => fs.statSync(p).mode & 0o777;
const outboxCount = (db: DatabaseSync): number =>
  (db.prepare('SELECT count(*) AS n FROM journal_outbox').get() as { n: number }).n;
/** Runs a sweep function in a child node, the way the box's node runs it: under a chosen umask, a test preload,
 *  or a kill. The body is a file, not `-e`, so the child's argv[1] is a real path and sweep.mjs's main-module check
 *  stays false. */
const drive = (box: HistoryBox, body: string, opts: { umask?: string; env?: Record<string, string> } = {}):
  { status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string } => {
  const file = path.join(box.home, `drive-${process.hrtime.bigint()}.mjs`);
  fs.writeFileSync(file, `import * as S from ${JSON.stringify(pathToFileURL(SWEEP).href)};\n${body}\n`);
  const r = spawnSync('bash', ['-c', `umask ${opts.umask ?? '077'}; exec "$@"`, 'bash', process.execPath, '--no-warnings', file],
    { env: { ...box.env, ...opts.env }, cwd: box.home, encoding: 'utf8' });
  return { status: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr };
};
const appendCall = (box: HistoryBox, ids: Ids, lines: string[], t: number): string =>
  `S.appendJournal(${JSON.stringify(box.home)}, ${JSON.stringify(ids)}, ${JSON.stringify(lines)}, ${t});`;

describe('the journal file: head, month, writer token, modes, torn tail (spec §9.14; O36 layout half)', () => {
  let box: HistoryBox;
  let ids: Ids;
  beforeEach(() => {
    box = makeHistoryBox('ccrc-hist-journal-', { role: 'fleet' });
    ids = createStore(box.home);
  });

  it('a new month file opens with its head record, naming the store, the month and the writer token', () => {
    SW.appendJournal(box.home, ids, [tickRec(T)], T);
    const f = SW.journalFilePath(box.home, ids.storeId, ids.writer, '2026-10');
    expect(f).toBe(path.join(box.home, '.ccrc', 'history', 'journal', ids.storeId, `2026-10.${ids.writer}.jsonl`));
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    expect(JSON.parse(lines[0]!)).toEqual({ v: 1, k: 'head', t: T, store_id: ids.storeId, month: '2026-10', writer: ids.writer });
    expect(lines.slice(1)).toEqual([tickRec(T), '']);
  });

  it('the first append fsyncs the root and journal/ that gained its directories (review 316 F23)', () => {
    const fbox = makeHistoryBox('ccrc-hist-f23j-', { role: 'fleet' });
    const fids = createStore(fbox.home);
    expect(fs.existsSync(hist(fbox.home, 'journal'))).toBe(false);
    expect(recordDirFsyncs(() => SW.appendJournal(fbox.home, fids, [tickRec(T)], T)).dirs.slice(0, 3))
      .toEqual([hist(fbox.home), hist(fbox.home, 'journal'), hist(fbox.home, 'journal', fids.storeId)]);
  });

  it('ensureSpoolDirs fsyncs the root and spool/ when it creates them (review 316 F23)', () => {
    const fbox = makeHistoryBox('ccrc-hist-f23s-', { role: 'fleet' });
    createStore(fbox.home);
    expect(fs.existsSync(hist(fbox.home, 'spool'))).toBe(false);
    expect(recordDirFsyncs(() => SW.ensureSpoolDirs(fbox.home)).dirs).toEqual([hist(fbox.home), hist(fbox.home, 'spool')]);
  });

  it('an append after a UTC month boundary opens a new file with its own head; the old file is untouched', () => {
    const lastMs = Date.UTC(2026, 9, 31, 23, 59, 59, 999);
    SW.appendJournal(box.home, ids, [tickRec(lastMs)], lastMs);
    const oct = SW.journalFilePath(box.home, ids.storeId, ids.writer, '2026-10');
    const before = fs.readFileSync(oct);
    SW.appendJournal(box.home, ids, [tickRec(lastMs + 1)], lastMs + 1);
    expect(SW.monthOf(lastMs + 1)).toBe('2026-11');
    expect(fs.readFileSync(oct)).toEqual(before);
    const nov = SW.journalFilePath(box.home, ids.storeId, ids.writer, '2026-11');
    expect(JSON.parse(fs.readFileSync(nov, 'utf8').split('\n')[0]!)).toMatchObject({ k: 'head', month: '2026-11' });
  });

  it('directories are 0700 and files 0600 under an inherited umask of 0002', () => {
    const r = drive(box, appendCall(box, ids, [tickRec(T)], T), { umask: '0002' });
    expect(r.status, r.stderr).toBe(0);
    expect(mode(hist(box.home, 'journal'))).toBe(0o700);
    expect(mode(journalDir(box.home, ids.storeId))).toBe(0o700);
    expect(mode(SW.journalFilePath(box.home, ids.storeId, ids.writer, '2026-10'))).toBe(0o600);
  });

  it('a journal/<other store_id>/ directory is never appended', () => {
    const otherId = '0f0f0f0f-0000-4000-8000-00000000abcd';
    const other = journalDir(box.home, otherId);
    fs.mkdirSync(other, { recursive: true });
    const theirs = path.join(other, '2026-10.0badc0de.jsonl');
    fs.writeFileSync(theirs, `${JSON.stringify({ v: 1, k: 'head', t: 1, store_id: otherId, month: '2026-10', writer: '0badc0de' })}\n`);
    const before = fs.readFileSync(theirs);
    SW.appendJournal(box.home, ids, [tickRec(T)], T);
    expect(fs.readFileSync(theirs)).toEqual(before);
    expect(fs.readdirSync(other)).toEqual(['2026-10.0badc0de.jsonl']);
    expect(fs.existsSync(SW.journalFilePath(box.home, ids.storeId, ids.writer, '2026-10'))).toBe(true);
  });

  it('a file that ends in a torn line gets a newline first; the torn line and the new record stay two lines (RC4)', () => {
    SW.appendJournal(box.home, ids, [tickRec(T)], T);
    const f = SW.journalFilePath(box.home, ids.storeId, ids.writer, '2026-10');
    fs.appendFileSync(f, '{"v":1,"k":"spool","t":');
    SW.appendJournal(box.home, ids, [tickRec(T + 1)], T + 1);
    expect(fs.readFileSync(f, 'utf8').split('\n').slice(1)).toEqual([tickRec(T), '{"v":1,"k":"spool","t":', tickRec(T + 1), '']);
  });

  it('a kill between a month file\'s create and its head leaves no month file; the next append makes it head first (DI14)', () => {
    const r = drive(box, appendCall(box, ids, [tickRec(T)], T),
      { env: { NODE_OPTIONS: `--import ${pathToFileURL(PRELOADS.faults).href}`, HISTORY_TEST_KILL_AT: 'journal-open:1' } });
    expect(r.signal, r.stderr).toBe('SIGKILL');
    const f = SW.journalFilePath(box.home, ids.storeId, ids.writer, '2026-10');
    expect(fs.existsSync(f), 'a month file exists without its head').toBe(false);
    SW.appendJournal(box.home, ids, [tickRec(T + 1)], T + 1);
    expect(JSON.parse(fs.readFileSync(f, 'utf8').split('\n')[0]!)).toMatchObject({ k: 'head', store_id: ids.storeId });
    expect(fs.readdirSync(journalDir(box.home, ids.storeId)), 'the killed pass\'s temp was not removed').toEqual([path.basename(f)]);
  });

  it('a kill between a month file\'s link and its temp\'s unlink leaves a temp that the next append removes; the month file is intact (D-4308)', () => {
    const r = drive(box, appendCall(box, ids, [tickRec(T)], T),
      { env: { NODE_OPTIONS: `--import ${pathToFileURL(PRELOADS.faults).href}`, HISTORY_TEST_KILL: 'linkSync:.tmp:1:after' } });
    expect(r.signal, r.stderr).toBe('SIGKILL');
    const f = SW.journalFilePath(box.home, ids.storeId, ids.writer, '2026-10');
    expect(fs.existsSync(f), 'the link did not land').toBe(true);
    expect(fs.readdirSync(journalDir(box.home, ids.storeId)).filter((n) => n.endsWith('.tmp')), 'the kill left no temp link').toHaveLength(1);
    SW.appendJournal(box.home, ids, [tickRec(T + 1)], T + 1);
    expect(fs.readdirSync(journalDir(box.home, ids.storeId)), 'the killed pass\'s temp link survived an append to the existing month file').toEqual([path.basename(f)]);
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    expect(JSON.parse(lines[0]!)).toMatchObject({ k: 'head', store_id: ids.storeId, month: '2026-10' });
    expect(lines.slice(1)).toEqual([tickRec(T + 1), '']);
  });

  it('an append cut short by ENOSPC throws JournalError; the next append starts on a fresh line, and both survive', () => {
    const r1 = tickRec(T); const r2 = tickRec(T + 1); const r3 = tickRec(T + 2);
    SW.appendJournal(box.home, ids, [r1], T);
    const r = drive(box,
      `try { ${appendCall(box, ids, [r2], T + 1)} } catch (e) { process.stdout.write(e.name + ' ' + e.code); process.exit(3); }`,
      { env: { NODE_OPTIONS: `--import ${pathToFileURL(PRELOADS.faults).href}`, HISTORY_TEST_ENOSPC: '/journal/' } });
    expect(r.status, r.stderr).toBe(3);
    expect(r.stdout).toBe('JournalError append-failed');
    const whole = Buffer.from(`${r2}\n`);
    const half = whole.subarray(0, Math.floor(whole.length / 2)).toString('utf8');
    SW.appendJournal(box.home, ids, [r3], T + 2);
    const f = SW.journalFilePath(box.home, ids.storeId, ids.writer, '2026-10');
    expect(fs.readFileSync(f, 'utf8').split('\n').slice(1)).toEqual([r1, half, r3, '']);
  });

  it('journalFilePath refuses a store id, writer token or month outside its grammar, so no value leaves its directory', () => {
    const bad: Array<[string, string, string]> = [
      ['..', ids.writer, '2026-10'], [`${ids.storeId}/..`, ids.writer, '2026-10'],
      [ids.storeId, '../x', '2026-10'], [ids.storeId, ids.writer, '2026-13'], [ids.storeId, ids.writer, '../../x'],
    ];
    for (const [sid, w, m] of bad) {
      expect(() => SW.journalFilePath(box.home, sid, w, m), `${sid} ${w} ${m}`).toThrow(/journal: bad-name/);
    }
  });
});

describe('the outbox flush (spec §9.14 "The order of writes" steps 4 and 6; §9.10 "Journal outbox flush")', () => {
  let box: HistoryBox;
  let ids: Ids;
  beforeEach(() => {
    box = makeHistoryBox('ccrc-hist-outbox-', { role: 'fleet' });
    ids = createStore(box.home);
  });
  const drained = (n: number): string => journalRecord('verdict', T, { event_key: 'none', kind: 'drained', file: `x.${n}.1.jsonl` });

  it('appends every row in seq order as one block, then deletes exactly those rows', () => {
    const db = openWriter(historyPaths(box.home).dbFile);
    try {
      db.prepare('INSERT INTO journal_outbox (rec) VALUES (?), (?)').run(drained(1), drained(2));
      expect(SW.flushOutbox(db, box.home, ids, T)).toBe(2);
      const f = SW.journalFilePath(box.home, ids.storeId, ids.writer, '2026-10');
      expect(fs.readFileSync(f, 'utf8').split('\n').slice(1)).toEqual([drained(1), drained(2), '']);
      expect(outboxCount(db)).toBe(0);
      expect(SW.flushOutbox(db, box.home, ids, T)).toBe(0);
      expect(fs.readFileSync(f, 'utf8').split('\n').slice(1)).toEqual([drained(1), drained(2), '']);
    } finally {
      closeWriter(db);
    }
  });

  it('an append that fails leaves every row in the outbox for the next flush; nothing is lost', (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();   // root opens a 0400 file for append regardless of its mode
    SW.appendJournal(box.home, ids, [tickRec(T)], T);
    const f = SW.journalFilePath(box.home, ids.storeId, ids.writer, '2026-10');
    const db = openWriter(historyPaths(box.home).dbFile);
    try {
      db.prepare('INSERT INTO journal_outbox (rec) VALUES (?), (?)').run(drained(1), drained(2));
      fs.chmodSync(f, 0o400);
      expect(() => SW.flushOutbox(db, box.home, ids, T)).toThrow(/journal: append-failed/);
      expect(outboxCount(db)).toBe(2);
      fs.chmodSync(f, 0o600);
      expect(SW.flushOutbox(db, box.home, ids, T)).toBe(2);
      expect(outboxCount(db)).toBe(0);
    } finally {
      closeWriter(db);
    }
  });
});

describe('a tick flushes the outbox first (spec §9.2 "First, the outbox"), as the box runs it', () => {
  it('a verdict row a crash left in the outbox reaches the journal on the next pass, and leaves the outbox', () => {
    const box = makeHistoryBox('ccrc-hist-outbox-tick-', { role: 'fleet' });
    const first = runSweep(box);   // the first pass binds a new store
    expect(first.code, first.stderr).toBe(0);
    const ids = storeIds(box.home);
    const rec = journalRecord('verdict', T, { event_key: 'none', kind: 'drained', file: 'x.1.1.jsonl' });
    const db = openWriter(historyPaths(box.home).dbFile);
    try { db.prepare('INSERT INTO journal_outbox (rec) VALUES (?)').run(rec); } finally { closeWriter(db); }
    const r = runSweep(box);
    expect(r.code, r.stderr).toBe(0);
    expect(journalOf(box.home, ids.storeId)).toContainEqual(JSON.parse(rec));
    const ro = openStoreRO(box);
    try { expect(outboxCount(ro)).toBe(0); } finally { ro.close(); }
  });
});

// ── Task 16: the two-phase drain ────────────────────────────────────────────────────────────────────────
const ID = 'claude-a-demo';
const ID2 = 'claude-a-other';
const u = (n: number): string => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const U0 = u(0x10); const U1 = u(0x11); const U2 = u(0x12); const U3 = u(0x13); const U5 = u(0x15); const U9 = u(0x19);
const G1 = u(0xa1); const G2 = u(0xa2);
const SPOOL = (home: string): string => hist(home, 'spool');
const DRAIN = (home: string): string => hist(home, 'spool', '.draining');
const REJECTED = (home: string): string => path.join(DRAIN(home), 'rejected');
/** One spool line exactly as the hook appends it: fenced, `\n<json>\n` (§5.1). A string is planted as is. */
const spool = (home: string, id: string, rec: Record<string, unknown> | string): void => {
  fs.mkdirSync(SPOOL(home), { recursive: true });
  fs.appendFileSync(path.join(SPOOL(home), `${id}.jsonl`), `\n${typeof rec === 'string' ? rec : JSON.stringify(rec)}\n`);
};
const drainingNames = (home: string): string[] =>
  (fs.existsSync(DRAIN(home)) ? fs.readdirSync(DRAIN(home)).filter((n) => n.endsWith('.jsonl')).sort() : []);
const obsOf = (home: string, name: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(DRAIN(home), name.replace(/\.jsonl$/, '.obs')), 'utf8')) as Record<string, unknown>;
const rowsOf = <R,>(box: HistoryBox, sql: string): R[] => {
  const db = openStoreRO(box);
  try { return db.prepare(sql).all() as unknown as R[]; } finally { db.close(); }
};
type Receipt = { event_key: string; received_ms: number; ts_ms: number; ts_source: string };
const receipts = (box: HistoryBox): Receipt[] =>
  rowsOf<Receipt>(box, 'SELECT event_key, received_ms, ts_ms, ts_source FROM spool_receipts ORDER BY event_key');
/** Each journaled draining file: its `file` record's t and the `spool` records after it, in journal order. */
const fileBlocks = (records: Array<Record<string, unknown>>): Array<{ name: string; t: number; spool: Array<Record<string, unknown>> }> => {
  const out: Array<{ name: string; t: number; spool: Array<Record<string, unknown>> }> = [];
  for (const r of records) {
    if (r['k'] === 'file') out.push({ name: String(r['name']), t: Number(r['t']), spool: [] });
    else if (r['k'] === 'spool' && out.length > 0) out[out.length - 1]!.spool.push(r);
  }
  return out;
};
const setReg = (box: HistoryBox, id: string, field: 'uuid' | 'generation' | 'project' | 'workdir', value: string | null | { unreadable: true }): void => {
  const p = path.join(box.reg, `${id}.${field}`);
  fs.mkdirSync(box.reg, { recursive: true });
  fs.rmSync(p, { recursive: true, force: true });
  if (value === null) return;
  if (typeof value === 'object') { fs.mkdirSync(p); return; }   // a directory where a value belongs: read as unreadable
  fs.writeFileSync(p, value);                                     // ccd's _reg_set writes printf '%s': no newline
};
const moveDb = (box: HistoryBox, from: string, to: string): void => {
  fs.mkdirSync(to, { recursive: true });
  for (const f of ['history.db', 'history.db-wal', 'history.db-shm']) {
    const p = path.join(from, f);
    if (fs.existsSync(p)) fs.renameSync(p, path.join(to, f));
  }
};
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

describe('draining names (spec §5.1 SPOOL_ID_MAX, §9.2 step 1)', () => {
  it('a 224-char id fits the draining name (DRAINING_NAME_MAX, D-4303), its sidecar and the sidecar\'s temp in 255 bytes, with a 7-digit pid', () => {
    const id = 'a'.repeat(224);
    const name = SW.drainingName(id, 1_791_244_261_576, 4_194_304);
    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(DRAINING_NAME_MAX);
    expect(Buffer.byteLength(`${SW.sidecarName(name)}.tmp`)).toBeLessThanOrEqual(255);
    expect(SW.parseDrainingName(name)).toEqual({ id, tickMs: 1_791_244_261_576, pid: 4_194_304 });
  });

  it('a dotted id drains under itself: the last three dot-components are the tick, the pid and the extension', () => {
    expect(SW.idOfDrainingName(SW.drainingName('a.b.c', 900, 12))).toBe('a.b.c');
    expect(SW.sidecarName('a.b.c.900.12.jsonl')).toBe('a.b.c.900.12.obs');
    expect(SW.parseDrainingName('a.b.c.jsonl')).toBeNull();
    expect(SW.parseDrainingName('x.12345678901234567.1.jsonl'), 'a 17-digit tick, which lib\'s drainingNameOk refuses').toBeNull();
    expect(SW.parseDrainingName('...900.12.jsonl')).toBeNull();
  });

  it('held files are listed in journaling order (tick ms, then pid, then name), never in lexical order', () => {
    const box = makeHistoryBox('ccrc-hist-order-', { role: 'fleet' });
    fs.mkdirSync(DRAIN(box.home), { recursive: true });
    for (const n of ['x.1000.7.jsonl', 'x.900.100.jsonl', 'x.900.99.jsonl', 'x.1100.1.jsonl', 'x.1100.1.obs', 'x.1100.1.obs.tmp']) {
      fs.writeFileSync(path.join(DRAIN(box.home), n), '');
    }
    expect(SW.listDraining(box.home)).toEqual(['x.900.99.jsonl', 'x.900.100.jsonl', 'x.1000.7.jsonl', 'x.1100.1.jsonl']);
  });

  it('two renames in one millisecond never replace a draining file: the second waits in spool/ (§9.2 "never reused")', () => {
    const box = makeHistoryBox('ccrc-hist-reuse-', { role: 'fleet' });
    fs.mkdirSync(SPOOL(box.home), { recursive: true, mode: 0o700 });
    const spooled = path.join(SPOOL(box.home), 'claude-a-demo.jsonl');
    fs.writeFileSync(spooled, '\n{"first":1}\n');
    expect(SW.renameSpoolFiles(box.home, 1000, 7)).toEqual(['claude-a-demo.1000.7.jsonl']);
    fs.writeFileSync(spooled, '\n{"second":2}\n');
    expect(SW.renameSpoolFiles(box.home, 1000, 7), 'the name is taken: nothing is renamed onto it').toEqual([]);
    expect(fs.readFileSync(path.join(DRAIN(box.home), 'claude-a-demo.1000.7.jsonl'), 'utf8')).toContain('first');
    expect(fs.readFileSync(spooled, 'utf8'), 'the line waits for the next half').toContain('second');
    expect(SW.renameSpoolFiles(box.home, 1001, 7)).toEqual(['claude-a-demo.1001.7.jsonl']);
    expect(fs.readFileSync(path.join(DRAIN(box.home), 'claude-a-demo.1001.7.jsonl'), 'utf8')).toContain('second');
  });

  it('a draining name whose observation sidecar is present is taken too: the rename waits (§9.2 "never reused")', () => {
    const box = makeHistoryBox('ccrc-hist-reuse-obs-', { role: 'fleet' });
    fs.mkdirSync(SPOOL(box.home), { recursive: true, mode: 0o700 });
    fs.mkdirSync(DRAIN(box.home), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(DRAIN(box.home), 'claude-a-demo.2000.7.obs'), 'kept');
    fs.writeFileSync(path.join(SPOOL(box.home), 'claude-a-demo.jsonl'), '\n{"x":1}\n');
    expect(SW.renameSpoolFiles(box.home, 2000, 7)).toEqual([]);
    expect(fs.existsSync(path.join(SPOOL(box.home), 'claude-a-demo.jsonl'))).toBe(true);
    expect(fs.readFileSync(path.join(DRAIN(box.home), 'claude-a-demo.2000.7.obs'), 'utf8'), 'the .obs is never inherited or replaced').toBe('kept');
  });
});

describe('the two-phase drain, as the box runs it (spec §9.2 step 1, §9.14 "The order of writes")', () => {
  let box: HistoryBox;
  let ids: Ids;
  beforeEach(() => {
    box = makeHistoryBox('ccrc-hist-drain-', { role: 'fleet' });
    const r = runSweep(box);   // the first pass binds a new store and makes spool/ and spool/.draining/
    expect(r.code, r.stderr).toBe(0);
    ids = storeIds(box.home);
  });
  const faults = (env: Record<string, string>): Parameters<typeof runSweep>[2] =>
    ({ preloads: [PRELOADS.statfs, PRELOADS.faults], env });

  it('a line appended to a renamed spool file between ticks is drained with it (O6)', () => {
    spool(box.home, ID, { v: 1, ev: 'Stop', id: ID });
    expect(runSweep(box).code).toBe(0);                           // tick N: renamed and observed, not read
    const [name] = drainingNames(box.home);
    expect(name).toMatch(new RegExp(`^${ID}\\.\\d+\\.\\d+\\.jsonl$`));
    expect(fs.existsSync(path.join(DRAIN(box.home), name!.replace(/\.jsonl$/, '.obs')))).toBe(true);
    fs.appendFileSync(path.join(DRAIN(box.home), name!), `\n${JSON.stringify({ v: 1, ev: 'Stop', id: ID })}\n`);
    expect(runSweep(box).code).toBe(0);                           // tick N+1: journaled and drained, both lines
    expect(receipts(box).map((r) => r.event_key).sort()).toEqual([eventKey(name!, 1), eventKey(name!, 2)].sort());
    expect(drainingNames(box.home)).toEqual([]);
    expect(fs.readdirSync(DRAIN(box.home))).toEqual([]);
  });

  it('a drained file is one `file` record then parsed `spool` records; rejected lines are counted and never journaled (O36)', () => {
    spool(box.home, ID, 'x'.repeat(50 * 1024));                                   // free text, not a record
    spool(box.home, ID, { v: 1, ev: 'Stop', id: ID, text: 'hello from a stray writer' });   // a key the grammar lacks
    spool(box.home, ID, { v: 1, ev: 'Stop', id: ID });
    expect(runSweep(box).code).toBe(0);
    const [name] = drainingNames(box.home);
    expect(runSweep(box).code).toBe(0);
    expect(counters(box)['spool_line_rejected']).toBe(2);
    const blocks = fileBlocks(journalOf(box.home, ids.storeId)).filter((b) => b.name === name);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.spool).toEqual([{ v: 1, k: 'spool', t: blocks[0]!.t, ord: 3, rec: { v: 1, ev: 'Stop', id: ID } }]);
    const text = fs.readdirSync(journalDir(box.home, ids.storeId)).map((n) => fs.readFileSync(path.join(journalDir(box.home, ids.storeId), n), 'utf8')).join('');
    expect(text).not.toContain('hello from a stray writer');
    expect(text).not.toContain('x'.repeat(64));
  });

  it('a line naming another id, or an id outside the grammar, is rejected and forms no path (C66 spool half)', () => {
    spool(box.home, ID, { v: 1, ev: 'Stop', id: '..' });
    spool(box.home, ID, { v: 1, ev: 'Stop', id: 'claude-b-other' });
    spool(box.home, ID, { v: 1, ev: 'Stop', id: ID });
    const before = new Set(walk(hist(box.home)));
    expect(runSweep(box).code).toBe(0);
    const [name] = drainingNames(box.home);
    expect(runSweep(box).code).toBe(0);
    expect(counters(box)['spool_line_rejected']).toBe(2);
    expect(receipts(box).map((r) => r.event_key)).toEqual([eventKey(name!, 3)]);
    const made = walk(hist(box.home)).filter((p) => !before.has(p));
    expect(made.filter((p) => p.includes('claude-b-other'))).toEqual([]);
    expect(fileBlocks(journalOf(box.home, ids.storeId)).find((b) => b.name === name)!.spool.map((s) => s['ord'])).toEqual([3]);
  });

  it('writes in the ruled order: sidecar, journal, fsync, mark, FULL commit, verdicts, fsync, unlink, outbox delete (O26, O33)', () => {
    spool(box.home, ID, { v: 1, ev: 'Stop', id: ID });
    expect(runSweep(box).code).toBe(0);
    const [name] = drainingNames(box.home);
    const obs = name!.replace(/\.jsonl$/, '.obs');
    const log = path.join(box.home, 'oplog.txt');
    const r = runSweep(box, [], faults({ HISTORY_TEST_RECORD: log }));
    expect(r.code, r.stderr).toBe(0);
    const evs = fs.readFileSync(log, 'utf8').split('\n')
      .filter((e) => /^(sidecar|journal-write|journal-fsync|commit|unlink|outbox-delete)\b/.test(e))
      .map((e) => e.replace(/\d{4}-\d{2}\.[0-9a-f]{8}\.jsonl$/, '<journal>'));
    const from = evs.indexOf(`sidecar ${obs}`);
    expect(from, evs.join('\n')).toBeGreaterThanOrEqual(0);
    expect(evs.slice(from, from + 11)).toEqual([
      `sidecar ${obs}`,             // the sidecar records the journaling time before the append (DI14)
      'journal-write <journal>',    // the `file` and `spool` records, one write
      'journal-fsync <journal>',
      `sidecar ${obs}`,             // the journaled mark
      'commit sync=2',              // the drain transaction, FULL, with the `drained` outbox row
      'journal-write <journal>',    // its verdicts
      'journal-fsync <journal>',
      `unlink ${name}`,
      `unlink ${obs}`,
      'outbox-delete',
      'commit sync=1',
    ]);
  });

  it('a kill after the sidecar mark and before the commit: the next tick journals nothing again and commits once (O33)', () => {
    spool(box.home, ID, { v: 1, ev: 'Stop', id: ID });
    expect(runSweep(box).code).toBe(0);
    const [name] = drainingNames(box.home);
    const killed = runSweep(box, [], faults({ HISTORY_TEST_KILL_AT: 'sidecar:2' }));
    expect(killed.code, killed.stderr).toBeNull();
    expect(obsOf(box.home, name!)['journaled']).toMatchObject({ storeId: ids.storeId, writer: ids.writer });
    expect(receipts(box)).toEqual([]);
    expect(runSweep(box).code).toBe(0);
    const blocks = fileBlocks(journalOf(box.home, ids.storeId)).filter((b) => b.name === name);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.spool).toHaveLength(1);
    expect(receipts(box)).toHaveLength(1);
    expect(journalOf(box.home, ids.storeId).filter((x) => x['kind'] === 'drained' && x['file'] === name)).toHaveLength(1);
    expect(drainingNames(box.home)).toEqual([]);
  });

  it('a kill after the journal fsync and before the mark: the lines are journaled again, received once, keyed by place (O33, O48)', () => {
    spool(box.home, ID, { v: 1, ev: 'Stop', id: ID, ts: 1_700_000_000_000 });
    spool(box.home, ID, { v: 1, ev: 'Stop', id: ID });                       // no ts: the receive time stands in
    expect(runSweep(box).code).toBe(0);
    const [name] = drainingNames(box.home);
    const killed = runSweep(box, [], faults({ HISTORY_TEST_KILL_AT: 'journal-fsync:1' }));
    expect(killed.code, killed.stderr).toBeNull();
    expect(obsOf(box.home, name!)['journaled']).toBeNull();
    expect(runSweep(box).code).toBe(0);
    const blocks = fileBlocks(journalOf(box.home, ids.storeId)).filter((b) => b.name === name);
    expect(blocks).toHaveLength(2);
    expect(blocks[1]!.t, 'a re-journal changed the receive time').toBe(blocks[0]!.t);
    expect(blocks.map((b) => b.spool.map((s) => s['ord']))).toEqual([[1, 2], [1, 2]]);
    const got = receipts(box);
    expect(got.map((r) => r.event_key).sort()).toEqual([eventKey(name!, 1), eventKey(name!, 2)].sort());
    expect(got.find((r) => r.event_key === eventKey(name!, 1))).toMatchObject({ ts_source: 'line', ts_ms: 1_700_000_000_000, received_ms: blocks[0]!.t });
    expect(got.find((r) => r.event_key === eventKey(name!, 2))).toMatchObject({ ts_source: 'received', ts_ms: blocks[0]!.t, received_ms: blocks[0]!.t });
  });

  it('a commit that fails leaves the draining file for the next tick, which drains it without journaling it again (O6b)', () => {
    spool(box.home, ID, { v: 1, ev: 'Stop', id: ID });
    expect(runSweep(box).code).toBe(0);
    const [name] = drainingNames(box.home);
    const r = runSweep(box, [], faults({ HISTORY_TEST_FAIL_COMMIT: '1:5' }));   // 5: SQLITE_BUSY, a busy commit
    expect(r.code, r.stderr).toBe(0);
    expect(drainingNames(box.home)).toEqual([name]);
    expect(receipts(box)).toEqual([]);
    expect(counters(box)['drain_deferred']).toBe(1);
    expect(runSweep(box).code).toBe(0);
    expect(receipts(box)).toHaveLength(1);
    expect(drainingNames(box.home)).toEqual([]);
    expect(fileBlocks(journalOf(box.home, ids.storeId)).filter((b) => b.name === name)).toHaveLength(1);
  });

  // D-4346 (history-permanent-failures-classified): a drain failure is decided by its SQLite result code.
  /** Both ids spooled before ONE rename pass, so they share a tick and pid, and the first id lists first. */
  const twoDraining = (): [string, string] => {
    spool(box.home, ID, { v: 1, ev: 'Stop', id: ID });
    spool(box.home, ID2, { v: 1, ev: 'Stop', id: ID2 });
    expect(runSweep(box).code).toBe(0);
    const n = drainingNames(box.home);
    expect(n).toHaveLength(2);
    return [n[0]!, n[1]!];
  };

  it.each([['locked', '1:6'], ['busy-snapshot', '1:517']])('a %s commit defers like a busy one: the file stays, drain_deferred counts, exit 0, and the next pass drains it', (_what, code) => {
    spool(box.home, ID, { v: 1, ev: 'Stop', id: ID });
    expect(runSweep(box).code).toBe(0);
    const [name] = drainingNames(box.home);
    const r = runSweep(box, [], faults({ HISTORY_TEST_FAIL_COMMIT: code }));
    expect(r.code, r.stderr).toBe(0);
    expect(drainingNames(box.home)).toEqual([name]);
    expect(receipts(box)).toEqual([]);
    expect(counters(box)['drain_deferred']).toBe(1);
    expect(runSweep(box).code).toBe(0);
    expect(receipts(box)).toHaveLength(1);
    expect(drainingNames(box.home)).toEqual([]);
    expect(fileBlocks(journalOf(box.home, ids.storeId)).filter((b) => b.name === name)).toHaveLength(1);
  });

  it.each([['UNIQUE', '1:2067'], ['NOT NULL', '1:1299'], ['MISMATCH', '1:20']])('a commit the store refused for the file\'s own rows (%s) sets that file aside into .draining/rejected/, counted once, and the next file drains in the same tick', (_what, code) => {
    const [first, second] = twoDraining();
    const r = runSweep(box, [], faults({ HISTORY_TEST_FAIL_COMMIT: code }));
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toContain(`history-sweep: drain-rejected: ${first}: injected commit failure`);
    expect(fs.existsSync(path.join(REJECTED(box.home), first))).toBe(true);
    expect(fs.existsSync(path.join(DRAIN(box.home), first.replace(/\.jsonl$/, '.obs')))).toBe(false);
    expect(fs.statSync(REJECTED(box.home)).mode & 0o777).toBe(0o700);
    expect(counters(box)['drain_rejected']).toBe(1);
    expect(counters(box)['drain_deferred']).toBeUndefined();
    expect(receipts(box).map((x) => x.event_key)).toEqual([eventKey(second, 1)]);
    const names = fileBlocks(journalOf(box.home, ids.storeId)).map((b) => b.name);
    expect(names).toContain(first);   // journal first: nothing lost
    expect(names).toContain(second);
    expect(drainingNames(box.home)).toEqual([]);
    expect(runSweep(box).code).toBe(0);
    expect(counters(box)['drain_rejected']).toBe(1);
  });

  it('a foreign trigger\'s RAISE (1811) fails the pass loudly: exit 1, its message on stderr, both files kept and journaled once, nothing deferred or rejected; dropping it drains both', () => {
    const [first, second] = twoDraining();
    const w = openWriter(historyPaths(box.home).dbFile);
    try { w.exec("CREATE TRIGGER fixture_refuse BEFORE INSERT ON spool_receipts BEGIN SELECT RAISE(ABORT, 'fixture-planted-trigger'); END"); } finally { closeWriter(w); }
    const r = runSweep(box);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/internal error: fixture-planted-trigger/);   // node's message is the RAISE text
    expect(drainingNames(box.home)).toEqual([first, second].sort());
    expect(counters(box)['drain_deferred']).toBeUndefined();
    expect(counters(box)['drain_rejected']).toBeUndefined();
    expect(fs.existsSync(REJECTED(box.home))).toBe(false);
    const w2 = openWriter(historyPaths(box.home).dbFile);
    try { w2.exec('DROP TRIGGER fixture_refuse'); } finally { closeWriter(w2); }
    expect(runSweep(box).code).toBe(0);
    expect(drainingNames(box.home)).toEqual([]);
    expect(receipts(box).map((x) => x.event_key).sort()).toEqual([eventKey(first, 1), eventKey(second, 1)].sort());
    const blocks = fileBlocks(journalOf(box.home, ids.storeId));
    for (const n of [first, second]) expect(blocks.filter((b) => b.name === n), n).toHaveLength(1);
  });

  it.each([['full disk', '1:13'], ['corrupt', '1:11'], ['I/O', '1:266'], ['no result code', '1']])('an injected %s commit failure fails the pass (exit 1) and keeps the file for the next pass', (_what, code) => {
    spool(box.home, ID, { v: 1, ev: 'Stop', id: ID });
    expect(runSweep(box).code).toBe(0);
    const [name] = drainingNames(box.home);
    const r = runSweep(box, [], faults({ HISTORY_TEST_FAIL_COMMIT: code }));
    expect(r.code, r.stderr).toBe(1);
    expect(drainingNames(box.home)).toEqual([name]);
    expect(receipts(box)).toEqual([]);
    expect(counters(box)['drain_deferred']).toBeUndefined();
    expect(counters(box)['drain_rejected']).toBeUndefined();
    expect(runSweep(box).code).toBe(0);
    expect(receipts(box)).toHaveLength(1);
    expect(drainingNames(box.home)).toEqual([]);
    expect(fileBlocks(journalOf(box.home, ids.storeId)).filter((b) => b.name === name)).toHaveLength(1);
  });

  it('a duplicate line is a no-op; the same key with a different payload is counted and never throws (O7)', () => {
    const rec = { v: 1, ev: 'recall', id: ID, cmd: 'grep', rc: 0, ms: 12, gen: G1 };
    spool(box.home, ID, rec);
    expect(runSweep(box).code).toBe(0);
    const [name] = drainingNames(box.home);
    const obs = name!.replace(/\.jsonl$/, '.obs');
    const saved = path.join(box.home, 'saved');
    fs.mkdirSync(saved);
    for (const n of [name!, obs]) fs.copyFileSync(path.join(DRAIN(box.home), n), path.join(saved, n));
    expect(runSweep(box).code).toBe(0);
    expect(rowsOf(box, 'SELECT event_key FROM recall_calls')).toHaveLength(1);
    // the same file again, as a crash between the commit and the unlink would leave it
    for (const n of [name!, obs]) fs.copyFileSync(path.join(saved, n), path.join(DRAIN(box.home), n));
    expect(runSweep(box).code).toBe(0);
    expect(receipts(box)).toHaveLength(1);
    expect(rowsOf(box, 'SELECT event_key FROM recall_calls')).toHaveLength(1);
    expect(counters(box)['receipt_collision'] ?? 0).toBe(0);
    expect(drainingNames(box.home)).toEqual([]);
    // the same place, a different payload
    fs.writeFileSync(path.join(DRAIN(box.home), name!), `\n${JSON.stringify({ ...rec, ms: 13 })}\n`);
    fs.copyFileSync(path.join(saved, obs), path.join(DRAIN(box.home), obs));
    const r = runSweep(box);
    expect(r.code, r.stderr).toBe(0);
    expect(counters(box)['receipt_collision']).toBe(1);
    expect(rowsOf<{ ms: number }>(box, 'SELECT ms FROM recall_calls')).toEqual([{ ms: 12 }]);
  });

  it('a recall line is a recall_calls row and a steer line a steer_receipts row; a gen-less recall joins the registry generation, journaled (FE2)', () => {
    setReg(box, ID, 'generation', G1);
    spool(box.home, ID, { v: 1, ev: 'recall', id: ID, cmd: 'grep', rc: 0, ms: 12, gen: G2 });
    spool(box.home, ID, { v: 1, ev: 'recall', id: ID, cmd: 'describe', rc: 3, ms: 7 });
    spool(box.home, ID, { v: 1, ev: 'steer', id: ID, sid: U1, leaf: '', ts: 5 });
    expect(runSweep(box).code).toBe(0);
    const [name] = drainingNames(box.home);
    expect(runSweep(box).code).toBe(0);
    expect(rowsOf(box, 'SELECT ccrc_id, generation, verb, rc, ms, arm FROM recall_calls ORDER BY verb DESC')).toEqual([
      { ccrc_id: ID, generation: G2, verb: 'grep', rc: 0, ms: 12, arm: null },
      { ccrc_id: ID, generation: G1, verb: 'describe', rc: 3, ms: 7, arm: null },
    ]);
    expect(rowsOf(box, 'SELECT ccrc_id, cc_session_uuid, leaf_id, ts_ms FROM steer_receipts')).toEqual([
      { ccrc_id: ID, cc_session_uuid: U1, leaf_id: '', ts_ms: 5 },
    ]);
    expect(journalOf(box.home, ids.storeId).filter((x) => x['kind'] === 'generation-joined')).toEqual([
      expect.objectContaining({ k: 'verdict', event_key: eventKey(name!, 2), ccrc_id: ID, generation: G1, via: 'registry' }),
    ]);
  });

  it('under a hold the journal half journals and holds each file once; the drain takes it when the hold ends (§9.14 Holds)', () => {
    spool(box.home, ID, { v: 1, ev: 'Stop', id: ID });
    expect(runSweep(box).code).toBe(0);
    const [name] = drainingNames(box.home);
    const aside = path.join(box.home, 'aside');
    moveDb(box, hist(box.home, 'db'), aside);                         // store.id present, DB absent: store-missing
    const held = runSweep(box);
    expect(held.code).toBe(5);
    expect(held.stdout).toContain('history-sweep: store-missing');
    expect(drainingNames(box.home)).toEqual([name]);
    expect(obsOf(box.home, name!)['journaled']).toMatchObject({ storeId: ids.storeId, writer: ids.writer });
    expect(runSweep(box).code).toBe(5);
    expect(fileBlocks(journalOf(box.home, ids.storeId)).filter((b) => b.name === name), 'journaled twice while held').toHaveLength(1);
    moveDb(box, aside, hist(box.home, 'db'));
    expect(runSweep(box).code).toBe(0);
    expect(receipts(box)).toHaveLength(1);
    expect(drainingNames(box.home)).toEqual([]);
    expect(fileBlocks(journalOf(box.home, ids.storeId)).filter((b) => b.name === name)).toHaveLength(1);
  });

  it('under a hold the journal half renames first, so a spool file is journaled in the pass that renames it (§9.2)', () => {
    const aside = path.join(box.home, 'aside');
    moveDb(box, hist(box.home, 'db'), aside);
    spool(box.home, ID, { v: 1, ev: 'Stop', id: ID });
    expect(runSweep(box).code).toBe(5);
    const [name] = drainingNames(box.home);
    expect(name).toMatch(new RegExp(`^${ID}\\.\\d+\\.\\d+\\.jsonl$`));
    expect(obsOf(box.home, name!)['journaled'], 'renamed after the journaling loop').toMatchObject({ storeId: ids.storeId, writer: ids.writer });
    expect(fileBlocks(journalOf(box.home, ids.storeId)).filter((b) => b.name === name)).toHaveLength(1);
    moveDb(box, aside, hist(box.home, 'db'));
  });

  it('a link planted in .draining/ is never followed: it and the sidecar its observation wrote are removed, counted non_regular', () => {
    fs.symlinkSync('/dev/null', path.join(DRAIN(box.home), `${ID}.900.1.jsonl`));
    const r = runSweep(box);
    expect(r.code, r.stderr).toBe(0);
    expect(fs.readdirSync(DRAIN(box.home))).toEqual([]);
    expect(counters(box)['non_regular']).toBe(1);
    expect(receipts(box)).toEqual([]);
  });

  // D-4337 (history-spool-file-size-cap, FR1-c): a draining file over SPOOL_FILE_MAX is decided from its stat and never read.
  describe('an oversized draining file (D-4337)', () => {
    const sparse = (file: string, size: number, head = ''): void => {
      fs.writeFileSync(file, head, { mode: 0o600 });
      fs.truncateSync(file, size);                                      // a hole: no disk, no read cost
    };
    const ticksIn = (): number => journalOf(box.home, ids.storeId).filter((x) => x['k'] === 'tick').length;
    const OVER = `${ID}.900.1.jsonl`;
    const ASIDE = (name: string): string => path.join(DRAIN(box.home), 'oversize', name);   // D-4337: the set-aside directory

    it('is moved aside into .draining/oversize/, counted once, never journaled or drained; the tick row is recorded and other files drain', () => {
      sparse(path.join(DRAIN(box.home), OVER), SPOOL_FILE_MAX + 1);
      spool(box.home, ID, { v: 1, ev: 'Stop', id: ID });
      const before = ticksIn();
      const r1 = runSweep(box);                                          // the oversize file is met before this tick renames the spool file
      expect(r1.code, r1.stderr).toBe(0);
      expect(fs.existsSync(path.join(DRAIN(box.home), OVER))).toBe(false);
      expect(fs.statSync(ASIDE(OVER)).size).toBe(SPOOL_FILE_MAX + 1);   // kept, untouched
      expect(counters(box)['spool_oversize']).toBe(1);
      const [name] = drainingNames(box.home);
      expect(name).not.toBe(OVER);
      const r2 = runSweep(box);
      expect(r2.code, r2.stderr).toBe(0);
      expect(counters(box)['spool_oversize'], 'counted once per file, not per tick').toBe(1);
      expect(receipts(box).map((x) => x.event_key)).toEqual([eventKey(name!, 1)]);   // the other file drained normally
      expect(fs.existsSync(ASIDE(OVER))).toBe(true);
      expect(fileBlocks(journalOf(box.home, ids.storeId)).map((b) => b.name)).toEqual([name]);   // the oversize name is never journaled
      expect(ticksIn() - before).toBe(2);
      expect(drainingNames(box.home)).toEqual([]);
    });

    it('a 252-byte draining name (D-4303) over the cap is set aside under its own name and counted: a <name>.oversize spelling would overflow NAME_MAX and wedge every tick', () => {
      const LONG = 'a'.repeat(224);
      const n = SW.drainingName(LONG, 1_791_244_261_576, 4_194_304);
      expect(Buffer.byteLength(n)).toBe(252);
      expect(Buffer.byteLength(`${n}.oversize`), 'CONTROL: the old spelling is over NAME_MAX').toBeGreaterThan(255);
      sparse(path.join(DRAIN(box.home), n), SPOOL_FILE_MAX + 1);
      spool(box.home, ID, { v: 1, ev: 'Stop', id: ID });
      const before = ticksIn();
      const r1 = runSweep(box);
      expect(r1.code, r1.stderr).toBe(0);
      expect(counters(box)['spool_oversize']).toBe(1);
      expect(fs.statSync(ASIDE(n)).size).toBe(SPOOL_FILE_MAX + 1);
      expect(fs.existsSync(path.join(DRAIN(box.home), n))).toBe(false);
      expect(fs.statSync(path.join(DRAIN(box.home), 'oversize')).mode & 0o777).toBe(0o700);
      const r2 = runSweep(box);
      expect(r2.code, r2.stderr).toBe(0);
      expect(counters(box)['spool_oversize'], 'counted once per file, not per tick').toBe(1);
      expect(ticksIn() - before).toBe(2);
      expect(receipts(box)).toHaveLength(1);                             // the other file drained: the tick completed
    });

    it('a regular file planted at .draining/oversize is removed and counted non_regular like a planted link; the file is set aside and the tick exits 0 (FR4 round 1)', () => {
      sparse(path.join(DRAIN(box.home), OVER), SPOOL_FILE_MAX + 1);
      fs.writeFileSync(path.join(DRAIN(box.home), 'oversize'), 'stray', { mode: 0o600 });
      spool(box.home, ID, { v: 1, ev: 'Stop', id: ID });
      const r1 = runSweep(box);
      expect(r1.code, r1.stderr).toBe(0);
      expect(counters(box)['non_regular']).toBe(1);
      expect(counters(box)['spool_oversize']).toBe(1);
      expect(fs.statSync(ASIDE(OVER)).size).toBe(SPOOL_FILE_MAX + 1);
      expect(receipts(box)).toHaveLength(0);
      const r2 = runSweep(box);
      expect(r2.code, r2.stderr).toBe(0);
      expect(receipts(box)).toHaveLength(1);                             // the other file drained: later ticks are not wedged
    });

    it.skipIf(process.getuid?.() === 0)('any other failed move leaves the file in place and the tick exits 0; it is recounted at each tick (FR4 round 1)', () => {
      const dir = path.join(DRAIN(box.home), 'oversize');
      fs.mkdirSync(dir, { mode: 0o500 });                                // a rename into it fails EACCES
      try {
        sparse(path.join(DRAIN(box.home), OVER), SPOOL_FILE_MAX + 1);
        spool(box.home, ID, { v: 1, ev: 'Stop', id: ID });
        const r1 = runSweep(box);
        expect(r1.code, r1.stderr).toBe(0);
        expect(fs.existsSync(path.join(DRAIN(box.home), OVER)), 'left in place').toBe(true);
        expect(counters(box)['spool_oversize']).toBe(1);
        const r2 = runSweep(box);
        expect(r2.code, r2.stderr).toBe(0);
        expect(counters(box)['spool_oversize'], 'one recount per tick, no crash').toBe(2);
        expect(receipts(box)).toHaveLength(1);                           // other files still drain
        fs.chmodSync(dir, 0o700);
        expect(runSweep(box).code).toBe(0);
        expect(fs.existsSync(ASIDE(OVER)), 'set aside once the failure clears').toBe(true);
      } finally { fs.chmodSync(dir, 0o700); }
    });

    it('the count is committed before the move: a count that cannot commit leaves the file in place for the next tick, counted nowhere', () => {
      const f = path.join(DRAIN(box.home), OVER);
      sparse(f, SPOOL_FILE_MAX + 1);
      const db = { prepare: () => { throw new Error('busy'); }, exec: () => { throw new Error('busy'); } } as unknown as DatabaseSync;
      expect(SW.setAsideOversize(db, box.home, OVER)).toBe(true);        // oversize: never journaled
      expect(fs.existsSync(f), 'unmoved').toBe(true);
      expect(fs.existsSync(ASIDE(OVER))).toBe(false);
      expect(runSweep(box).code).toBe(0);                                // a healthy tick counts it and moves it
      expect(counters(box)['spool_oversize']).toBe(1);
      expect(fs.existsSync(ASIDE(OVER))).toBe(true);
    });

    it('the oversize directory a set-aside creates is fsynced into .draining/ (review 316 F23)', () => {
      sparse(path.join(DRAIN(box.home), OVER), SPOOL_FILE_MAX + 1);
      const db = openWriter(historyPaths(box.home).dbFile);
      try {
        const { out, dirs } = recordDirFsyncs(() => SW.setAsideOversize(db, box.home, OVER));
        expect(out).toBe(true);
        expect(dirs).toContain(DRAIN(box.home));
        expect(fs.existsSync(ASIDE(OVER))).toBe(true);
      } finally { closeWriter(db); }
    });

    it('a file at exactly SPOOL_FILE_MAX is still drained: its valid line is received, its one huge line is rejected', () => {
      sparse(path.join(DRAIN(box.home), OVER), SPOOL_FILE_MAX, `\n${JSON.stringify({ v: 1, ev: 'Stop', id: ID })}\n`);
      const r = runSweep(box);
      expect(r.code, r.stderr).toBe(0);
      expect(counters(box)['spool_oversize']).toBeUndefined();
      expect(receipts(box).map((x) => x.event_key)).toEqual([eventKey(OVER, 1)]);
      expect(drainingNames(box.home)).toEqual([]);
    });

    it('a spool/ file over the cap is renamed into .draining/ like any other and set aside at the next tick', () => {
      sparse(hist(box.home, 'spool', `${ID}.jsonl`), SPOOL_FILE_MAX + 4096);
      expect(runSweep(box).code).toBe(0);
      const [name] = drainingNames(box.home);
      expect(name).toMatch(new RegExp(`^${ID}\\.\\d+\\.\\d+\\.jsonl$`));
      expect(counters(box)['spool_oversize']).toBeUndefined();
      expect(runSweep(box).code).toBe(0);
      expect(counters(box)['spool_oversize']).toBe(1);
      expect(fs.readdirSync(DRAIN(box.home))).toEqual(['oversize']);   // its observation sidecar went with it
      expect(fs.readdirSync(path.join(DRAIN(box.home), 'oversize'))).toEqual([name!]);
      expect(receipts(box)).toEqual([]);
    });

    it('under a hold the journal half never reads it (no crash, nothing journaled); the drain sets it aside and counts it when the hold ends', () => {
      sparse(path.join(DRAIN(box.home), OVER), SPOOL_FILE_MAX + 1);
      const aside = path.join(box.home, 'aside');
      moveDb(box, hist(box.home, 'db'), aside);
      const held = runSweep(box);
      expect(held.code, held.stderr).toBe(5);
      expect(drainingNames(box.home)).toEqual([OVER]);
      expect(fileBlocks(journalOf(box.home, ids.storeId))).toEqual([]);
      moveDb(box, aside, hist(box.home, 'db'));
      expect(runSweep(box).code).toBe(0);
      expect(counters(box)['spool_oversize']).toBe(1);
      expect(fs.existsSync(ASIDE(OVER))).toBe(true);
    });

    it('is decided from its stat before any open: an oversize file the sweep could not even open is still set aside', () => {
      const f = path.join(DRAIN(box.home), OVER);
      sparse(f, SPOOL_FILE_MAX + 1);
      fs.chmodSync(f, 0o000);                                            // an open(2) would fail EACCES
      const r = runSweep(box);
      expect(r.code, r.stderr).toBe(0);
      expect(counters(box)['spool_oversize']).toBe(1);
      expect(fs.existsSync(ASIDE(OVER))).toBe(true);
    });

    it('readDrainingText refuses it from the descriptor\'s size, before reading a byte', () => {
      const f = path.join(box.home, 'big.jsonl');
      sparse(f, SPOOL_FILE_MAX + 1);
      expect(() => SW.readDrainingText(f)).toThrow(expect.objectContaining({ code: 'SPOOL_OVERSIZE' }));
      sparse(f, 10);
      expect(SW.readDrainingText(f).bytes).toBe(10);
    });

    describe('its line arm: a file within SPOOL_FILE_MAX holding more than SPOOL_FILE_LINES_MAX lines (review 316 F6)', () => {
      // a V8 heap of half the carrier's MemoryMax=1G; runSweep's own NODE_OPTIONS is replaced, so the statfs preload is named again
      const HEAP_HALF = { NODE_OPTIONS: `--import ${pathToFileURL(PRELOADS.statfs).href} --max-old-space-size=512` };

      it('is set aside into .draining/oversize/, counted spool_overlines once and never spool_oversize, never journaled or drained; the other file drains', () => {
        fs.writeFileSync(path.join(DRAIN(box.home), OVER), 'a\n'.repeat(SPOOL_FILE_LINES_MAX + 1), { mode: 0o600 });
        spool(box.home, ID, { v: 1, ev: 'Stop', id: ID });
        const r1 = runSweep(box);
        expect(r1.code, r1.stderr).toBe(0);
        expect(fs.existsSync(path.join(DRAIN(box.home), OVER))).toBe(false);
        expect(fs.statSync(ASIDE(OVER)).size).toBe(2 * (SPOOL_FILE_LINES_MAX + 1));
        expect(counters(box)['spool_overlines']).toBe(1);
        expect(counters(box)['spool_oversize']).toBeUndefined();
        expect(counters(box)['spool_line_rejected']).toBeUndefined();
        const [name] = drainingNames(box.home);
        expect(name).not.toBe(OVER);                                       // the spool file this tick renamed, which drains at the next tick
        const r2 = runSweep(box);
        expect(r2.code, r2.stderr).toBe(0);
        expect(counters(box)['spool_overlines']).toBe(1);
        expect(receipts(box).map((x) => x.event_key)).toEqual([eventKey(name!, 1)]);
        expect(fileBlocks(journalOf(box.home, ids.storeId)).map((b) => b.name)).toEqual([name]);
        expect(drainingNames(box.home)).toEqual([]);
      });

      it('a file of exactly SPOOL_FILE_LINES_MAX lines drains: every line read, none set aside', () => {
        fs.writeFileSync(path.join(DRAIN(box.home), OVER), 'a\n'.repeat(SPOOL_FILE_LINES_MAX), { mode: 0o600 });
        const r = runSweep(box);
        expect(r.code, r.stderr).toBe(0);
        expect(counters(box)['spool_overlines']).toBeUndefined();
        expect(counters(box)['spool_line_rejected']).toBe(SPOOL_FILE_LINES_MAX);
        expect(fs.existsSync(path.join(DRAIN(box.home), OVER))).toBe(false);
        expect(fs.existsSync(path.join(DRAIN(box.home), 'oversize'))).toBe(false);
      });

      it('empty lines take no ordinal, so a file of 4 × SPOOL_FILE_LINES_MAX newlines and one line drains it', () => {
        fs.writeFileSync(path.join(DRAIN(box.home), OVER), '\n'.repeat(4 * SPOOL_FILE_LINES_MAX) + JSON.stringify({ v: 1, ev: 'Stop', id: ID }) + '\n', { mode: 0o600 });
        const r = runSweep(box);
        expect(r.code, r.stderr).toBe(0);
        expect(receipts(box).map((x) => x.event_key)).toEqual([eventKey(OVER, 1)]);
        expect(counters(box)['spool_overlines']).toBeUndefined();
      });

      it('under a hold the journal half leaves it unread (exit 5, nothing journaled); the drain sets it aside, spool_overlines, when the hold ends', () => {
        fs.writeFileSync(path.join(DRAIN(box.home), OVER), 'a\n'.repeat(SPOOL_FILE_LINES_MAX + 1), { mode: 0o600 });
        const aside = path.join(box.home, 'aside');
        moveDb(box, hist(box.home, 'db'), aside);
        const held = runSweep(box);
        expect(held.code, held.stderr).toBe(5);
        expect(drainingNames(box.home)).toEqual([OVER]);
        expect(fileBlocks(journalOf(box.home, ids.storeId))).toEqual([]);
        moveDb(box, aside, hist(box.home, 'db'));
        expect(runSweep(box).code).toBe(0);
        expect(counters(box)['spool_overlines']).toBe(1);
        expect(fs.existsSync(ASIDE(OVER))).toBe(true);
      });

      it('readDrainingText throws SPOOL_OVERLINES past the line cap and reads a file at it', () => {
        const f = path.join(box.home, 'lines.jsonl');
        fs.writeFileSync(f, 'a\n'.repeat(SPOOL_FILE_LINES_MAX + 1));
        expect(() => SW.readDrainingText(f)).toThrow(expect.objectContaining({ code: 'SPOOL_OVERLINES' }));
        fs.writeFileSync(f, 'a\n'.repeat(SPOOL_FILE_LINES_MAX));
        expect(SW.readDrainingText(f).bytes).toBe(2 * SPOOL_FILE_LINES_MAX);
      });

      it('review 316 F6: 24 MiB of 2-byte lines under a 512 MiB heap is set aside and the pass exits 0', () => {
        fs.writeFileSync(path.join(DRAIN(box.home), OVER), Buffer.alloc(24 * 1024 * 1024, 'a\n'), { mode: 0o600 });
        try {
          const r = runSweep(box, [], { env: HEAP_HALF });
          expect(r.code, `${r.signal} ${r.stderr}`).toBe(0);            // at HEAD the child died on SIGABRT: status null
          expect(counters(box)['spool_overlines']).toBe(1);
          expect(fs.existsSync(ASIDE(OVER))).toBe(true);
          expect(receipts(box)).toEqual([]);
        } finally { fs.rmSync(ASIDE(OVER), { force: true }); }
      }, 120_000);

      it('review 316 F6, its newline sibling: 64 MiB of newlines and one line, under both caps, drains under a 512 MiB heap', () => {
        fs.writeFileSync(path.join(DRAIN(box.home), OVER),
          Buffer.concat([Buffer.alloc(SPOOL_FILE_MAX - 4096, 0x0a), Buffer.from(JSON.stringify({ v: 1, ev: 'Stop', id: ID }) + '\n')]), { mode: 0o600 });
        try {
          const r = runSweep(box, [], { env: HEAP_HALF });
          expect(r.code, `${r.signal} ${r.stderr}`).toBe(0);            // at HEAD: SIGABRT
          expect(receipts(box).map((x) => x.event_key)).toEqual([eventKey(OVER, 1)]);
          expect(counters(box)['spool_overlines']).toBeUndefined();
        } finally { fs.rmSync(path.join(DRAIN(box.home), OVER), { force: true }); }
      }, 120_000);
    });
  });

  // D-4347 (history-planted-entries-never-wedge): a planted or leftover entry at one of the sweep's own names in
  // .draining/ or the journal never wedges, blocks or redirects a pass (review 316 F8, F9, F20).
  describe('a planted entry in .draining/ never wedges the drain (review 316 F8, F9, F20; D-4347 (history-planted-entries-never-wedge))', () => {
    const PL = (): string => path.join(DRAIN(box.home), 'planted');
    /** The drain areas under .draining/planted/: one `<tickMs>.<pid>` directory per drain that set something aside (FU3). */
    const areas = (): string[] => (fs.existsSync(PL()) ? fs.readdirSync(PL()).sort() : []);
    /** Every area's copy of `name` (and `rest` under it) that exists. */
    const plantedHits = (name: string, ...rest: string[]): string[] =>
      areas().map((a) => path.join(PL(), a, name, ...rest)).filter((p) => fs.existsSync(p));
    /** The one area's copy of `name`; it must be in exactly one area. */
    const PLANTED = (name: string, ...rest: string[]): string => {
      const hits = plantedHits(name, ...rest);
      expect(hits, `${name} is in exactly one area`).toHaveLength(1);
      return hits[0]!;
    };
    const regularFile = (): string => path.join(DRAIN(box.home), `${ID}.900.1.jsonl`);
    const writeRegular = (): void => { fs.writeFileSync(regularFile(), `\n${JSON.stringify({ v: 1, ev: 'Stop', id: ID })}\n`); };

    it('an empty directory at a draining name is set aside into .draining/planted/ and counted non_regular once; two passes exit 0 and a spooled line drains', () => {
      fs.mkdirSync(path.join(DRAIN(box.home), `${ID}.900.1.jsonl`));
      spool(box.home, ID, { v: 1, ev: 'Stop', id: ID });
      expect(runSweep(box).code).toBe(0);
      expect(runSweep(box).code).toBe(0);
      expect(fs.statSync(PLANTED(`${ID}.900.1.jsonl`)).isDirectory()).toBe(true);
      expect(areas()).toEqual([expect.stringMatching(/^[0-9]+\.[0-9]+$/)]);
      expect(fs.existsSync(path.join(DRAIN(box.home), 'rejected')), 'a planted entry never touches D-4346\'s directory').toBe(false);
      expect(counters(box)['non_regular']).toBe(1);
      expect(receipts(box)).toHaveLength(1);
    });

    it('the same with a NON-EMPTY directory: it is set aside whole, never recursed into or deleted', () => {
      fs.mkdirSync(path.join(DRAIN(box.home), `${ID}.900.1.jsonl`));
      fs.writeFileSync(path.join(DRAIN(box.home), `${ID}.900.1.jsonl`, 'keep'), '');
      spool(box.home, ID, { v: 1, ev: 'Stop', id: ID });
      expect(runSweep(box).code).toBe(0);
      expect(runSweep(box).code).toBe(0);
      expect(fs.existsSync(PLANTED(`${ID}.900.1.jsonl`, 'keep'))).toBe(true);
      expect(counters(box)['non_regular']).toBe(1);
      expect(receipts(box)).toHaveLength(1);
    });

    it.each([['.obs'], ['.obs.tmp']])('a directory holding a file at the sidecar name %s is set aside and the file drains', (suffix) => {
      writeRegular();
      fs.mkdirSync(path.join(DRAIN(box.home), `${ID}.900.1${suffix}`));
      fs.writeFileSync(path.join(DRAIN(box.home), `${ID}.900.1${suffix}`, 'keep'), '');
      const r = runSweep(box);
      expect(r.code, r.stderr).toBe(0);
      expect(receipts(box).map((x) => x.event_key)).toEqual([eventKey(`${ID}.900.1.jsonl`, 1)]);
      expect(counters(box)['journal_write_failed']).toBeUndefined();
      expect(counters(box)['non_regular']).toBe(1);
      expect(fs.existsSync(PLANTED(`${ID}.900.1${suffix}`, 'keep'))).toBe(true);
    });

    it('a FIFO at a sidecar temp name never blocks a hold pass', () => {
      writeRegular();
      expect(spawnSync('mkfifo', [path.join(DRAIN(box.home), `${ID}.900.1.obs.tmp`)]).status).toBe(0);
      const aside = path.join(box.home, 'aside');
      moveDb(box, hist(box.home, 'db'), aside);
      const r = runSweep(box, [], { timeoutMs: 30_000 });
      expect(r.code, `${r.signal} ${r.stderr}`).toBe(5);
      expect(r.ms).toBeLessThan(25_000);
      moveDb(box, aside, hist(box.home, 'db'));
      expect(runSweep(box).code).toBe(0);
      expect(drainingNames(box.home)).toEqual([]);
    });

    it('a directory at a journal month-file temp name never fails an append', () => {
      const dir = hist(box.home, 'journal', ids.storeId);
      fs.mkdirSync(dir, { recursive: true });
      const m = SW.monthOf(Date.now());
      fs.mkdirSync(path.join(dir, `.${m}.${ids.writer}.jsonl.4242.tmp`));
      fs.mkdirSync(path.join(dir, `.${m}.${ids.writer}.jsonl.4243.tmp`));
      fs.writeFileSync(path.join(dir, `.${m}.${ids.writer}.jsonl.4243.tmp`, 'keep'), '');
      spool(box.home, ID, { v: 1, ev: 'Stop', id: ID });
      expect(runSweep(box).code).toBe(0);
      expect(runSweep(box).code).toBe(0);
      expect(counters(box)['journal_write_failed']).toBeUndefined();
      expect(receipts(box)).toHaveLength(1);
      expect(fs.existsSync(path.join(dir, `.${m}.${ids.writer}.jsonl.4242.tmp`))).toBe(false);
      expect(fs.existsSync(path.join(dir, `.${m}.${ids.writer}.jsonl.4243.tmp`, 'keep'))).toBe(true);
    });

    it('a regular file at spool/.draining is removed and counted, and the drain goes on', () => {
      fs.rmSync(DRAIN(box.home), { recursive: true });
      fs.writeFileSync(DRAIN(box.home), 'stray');
      spool(box.home, ID, { v: 1, ev: 'Stop', id: ID });
      const r1 = runSweep(box);
      expect(r1.code, r1.stderr).toBe(0);
      expect(fs.statSync(DRAIN(box.home)).isDirectory()).toBe(true);
      expect(counters(box)['non_regular']).toBe(1);
      const r2 = runSweep(box);
      expect(r2.code, r2.stderr).toBe(0);
      expect(receipts(box)).toHaveLength(1);
    });

    it('a FIFO or a link at this month\'s journal file fails the append loudly, never waits on it or writes through it', () => {
      const f = SW.journalFilePath(box.home, ids.storeId, ids.writer, SW.monthOf(Date.now()));
      const outside = path.join(box.home, 'outside');
      const big = Array.from({ length: 2000 }, () => `\n${JSON.stringify({ v: 1, ev: 'Stop', id: ID })}\n`).join('');
      for (const plant of ['fifo', 'link']) {
        fs.rmSync(f, { force: true });
        if (plant === 'fifo') expect(spawnSync('mkfifo', [f]).status).toBe(0);
        else { fs.writeFileSync(outside, ''); fs.symlinkSync(outside, f); }
        fs.writeFileSync(path.join(DRAIN(box.home), `${ID}.900.1.jsonl`), big);
        const r = runSweep(box, [], { timeoutMs: 30_000 });
        expect(r.code, `${plant}: ${r.signal} ${r.stderr}`).toBe(0);
        expect(r.ms).toBeLessThan(25_000);
        expect(receipts(box), plant).toEqual([]);
        if (plant === 'link') expect(fs.readFileSync(outside, 'utf8'), 'written through the link').toBe('');
      }
      fs.rmSync(f, { force: true });
      expect(runSweep(box).code).toBe(0);
      expect(drainingNames(box.home)).toEqual([]);
      expect(counters(box)['journal_write_failed']).toBeGreaterThanOrEqual(2);
    });

    // review 316 F9: readSidecar admits only the whole grammar observe() writes, on the drain and the hold alike.
    const validObs = { v: 1, observedMs: T, uuid: { state: 'absent' }, generation: { state: 'absent' }, project: { state: 'absent' }, workdir: { state: 'absent' },
      late: null, journalT: null, journaled: null, heldMatches: {} };
    const startupFile = (): void => {
      fs.writeFileSync(regularFile(), `\n${JSON.stringify(start(ID, U1, 'startup', { reg: U1 }))}\n`);
    };
    const MALFORMED: Array<[string, Record<string, unknown>]> = [
      ['only v and observedMs', { v: 1, observedMs: T }],
      ['heldMatches null', { ...validObs, heldMatches: null }],
      ['journalT fractional', { ...validObs, journalT: 1.5 }],
    ];

    it.each(MALFORMED)('a malformed sidecar (%s) is removed, counted sidecar_malformed once and observed again; the file drains', (_why, bad) => {
      startupFile();
      fs.writeFileSync(path.join(DRAIN(box.home), `${ID}.900.1.obs`), JSON.stringify(bad));
      const r = runSweep(box);
      expect(r.code, r.stderr).toBe(0);
      expect(counters(box)['sidecar_malformed']).toBe(1);
      expect(receipts(box)).toHaveLength(1);
      expect(drainingNames(box.home)).toEqual([]);
    });

    it('a malformed sidecar under a hold is observed again, never thrown', () => {
      startupFile();
      fs.writeFileSync(path.join(DRAIN(box.home), `${ID}.900.1.obs`), JSON.stringify({ v: 1, observedMs: T }));
      const aside = path.join(box.home, 'aside');
      moveDb(box, hist(box.home, 'db'), aside);
      const held = runSweep(box);
      expect(held.code, held.stderr).toBe(5);
      expect(held.stderr).not.toMatch(/TypeError/);
      moveDb(box, aside, hist(box.home, 'db'));
      const r = runSweep(box);
      expect(r.code, r.stderr).toBe(0);
      expect(receipts(box)).toHaveLength(1);
    });

    // review 316 F20: a sidecar whose draining file is gone is the sweep's own debris.
    it('a kill between a drained file\'s unlink and its sidecar\'s leaves an orphan the next drain removes', () => {
      spool(box.home, ID, { v: 1, ev: 'Stop', id: ID });
      expect(runSweep(box).code).toBe(0);                                // renamed
      const [name] = drainingNames(box.home);
      const killed = runSweep(box, [], faults({ HISTORY_TEST_KILL: `unlinkSync:${name!}:1:after` }));
      expect(killed.code).toBeNull();
      expect(fs.existsSync(path.join(DRAIN(box.home), name!.replace(/\.jsonl$/, '.obs')))).toBe(true);
      expect(fs.existsSync(path.join(DRAIN(box.home), name!))).toBe(false);
      const r = runSweep(box);
      expect(r.code, r.stderr).toBe(0);
      expect(fs.readdirSync(DRAIN(box.home)).filter((n) => n.endsWith('.obs') || n.endsWith('.obs.tmp'))).toEqual([]);
      expect(receipts(box)).toHaveLength(1);
    });

    it('an oversize file\'s orphaned sidecar and a stale sidecar temp are removed, uncounted', () => {
      fs.writeFileSync(path.join(DRAIN(box.home), `${ID}.900.1.obs`), JSON.stringify(validObs));
      fs.writeFileSync(path.join(DRAIN(box.home), `${ID}.901.1.obs.tmp`), '{}');
      const r = runSweep(box);
      expect(r.code, r.stderr).toBe(0);
      expect(fs.readdirSync(DRAIN(box.home))).toEqual([]);
      expect(counters(box)['non_regular']).toBeUndefined();
      expect(counters(box)['sidecar_malformed']).toBeUndefined();
    });

    // FU3 (NR-RF4a, M17): a set-aside never collides, a directory that cannot be moved costs at most its own
    // draining file, and one left at a draining name is counted once and skipped.
    const stopLine = (id: string): string => `\n${JSON.stringify({ v: 1, ev: 'Stop', id })}\n`;
    const plantDir = (name: string, file: string): string => {
      const d = path.join(DRAIN(box.home), name);
      fs.mkdirSync(d);
      fs.writeFileSync(path.join(d, file), '');
      return d;
    };

    it('a directory planted again at a sidecar name it held before goes into a new area; nothing holds (FU3, NR-RF4a)', () => {
      writeRegular();
      plantDir(`${ID}.900.1.obs`, 'keep');
      const r1 = runSweep(box);
      expect(r1.code, r1.stderr).toBe(0);
      writeRegular();                                              // the same draining name again
      plantDir(`${ID}.900.1.obs`, 'keep2');                        // and the same sidecar name, already in planted/
      fs.writeFileSync(path.join(DRAIN(box.home), `${ID2}.902.1.jsonl`), stopLine(ID2));
      const r2 = runSweep(box);
      expect(r2.code, r2.stderr).toBe(0);
      expect(counters(box)['journal_write_failed']).toBeUndefined();   // at e0c14f811: 1, and both files held
      expect(counters(box)['non_regular']).toBe(2);
      expect(counters(box)['spool_displaced']).toBeUndefined();   // one shared area would have displaced the second file
      expect(journalOf(box.home, ids.storeId).filter((x) => x['k'] === 'file' && x['name'] === `${ID}.900.1.jsonl`), 'journaled on both drains').toHaveLength(2);
      expect(drainingNames(box.home)).toEqual([]);
      expect(receipts(box).map((x) => x.event_key).sort()).toEqual([eventKey(`${ID}.900.1.jsonl`, 1), eventKey(`${ID2}.902.1.jsonl`, 1)].sort());
      expect(areas()).toHaveLength(2);
      expect(PLANTED(`${ID}.900.1.obs`, 'keep')).not.toBe(PLANTED(`${ID}.900.1.obs`, 'keep2'));
    });

    it('a regular file at .draining/planted is removed and counted non_regular, and a planted directory is still set aside (FU3)', () => {
      fs.writeFileSync(PL(), 'stray');
      fs.mkdirSync(path.join(DRAIN(box.home), `${ID}.900.1.jsonl`));
      const r = runSweep(box);
      expect(r.code, r.stderr).toBe(0);
      expect(counters(box)['non_regular']).toBe(2);
      expect(fs.statSync(PLANTED(`${ID}.900.1.jsonl`)).isDirectory()).toBe(true);
    });

    // Moving a directory to another parent needs write permission on the directory itself (its `..`); root bypasses that.
    describe.skipIf(process.getuid?.() === 0)('a directory that cannot be moved (FU3)', () => {
      it.each([['.obs'], ['.obs.tmp']])('a non-empty 0500 directory at the sidecar name %s displaces only its own file: set aside unjournaled with its bytes, counted spool_displaced, and a later file drains', (suffix) => {
        writeRegular();
        fs.writeFileSync(path.join(DRAIN(box.home), `${ID2}.902.1.jsonl`), stopLine(ID2));
        const d = plantDir(`${ID}.900.1${suffix}`, 'keep');
        fs.chmodSync(d, 0o500);
        try {
          const r = runSweep(box);
          expect(r.code, r.stderr).toBe(0);
          expect(r.stderr).toContain(`history-sweep: spool-displaced: ${ID}.900.1.jsonl\n`);
          expect(counters(box)['journal_write_failed']).toBeUndefined();   // at e0c14f811: 1, and the later file held too
          expect(counters(box)['spool_displaced']).toBe(1);
          expect(counters(box)['non_regular']).toBe(1);
          expect(receipts(box).map((x) => x.event_key)).toEqual([eventKey(`${ID2}.902.1.jsonl`, 1)]);
          expect(drainingNames(box.home)).toEqual([]);
          expect(fs.readFileSync(PLANTED(`${ID}.900.1.jsonl`), 'utf8')).toBe(stopLine(ID));   // its bytes kept
          expect(journalOf(box.home, ids.storeId).filter((x) => x['k'] === 'file').map((x) => x['name'])).toEqual([`${ID2}.902.1.jsonl`]);
          const r2 = runSweep(box);                                  // the directory stays, now at an orphan name
          expect(r2.code, r2.stderr).toBe(0);
          expect(counters(box)['non_regular']).toBe(2);              // counted once on each drain that meets it
          expect(counters(box)['spool_displaced']).toBe(1);
          expect(fs.statSync(d).isDirectory()).toBe(true);
          expect(areas().filter((a) => fs.readdirSync(path.join(PL(), a)).length === 0), 'a failed move leaves no empty area').toEqual([]);
        } finally { fs.chmodSync(d, 0o700); }
      });

      // FU3F: with the set-aside area unmakeable too, the live file cannot be displaced; it is skipped, never a hold.
      it.each([['.obs'], ['.obs.tmp']])('two planted entries — an unusable planted area and a non-empty directory at a live sidecar name %s — never hold the drain (FU3F)', (suffix) => {
        writeRegular();                                            // A, first in drain order
        fs.writeFileSync(path.join(DRAIN(box.home), `${ID2}.902.1.jsonl`), stopLine(ID2));   // B
        const d = plantDir(`${ID}.900.1${suffix}`, 'keep');
        fs.chmodSync(d, 0o500);
        fs.mkdirSync(PL());
        fs.writeFileSync(path.join(PL(), 'keep'), '');
        fs.chmodSync(PL(), 0o500);                                 // non-empty, so it cannot be removed; no area can be made in it
        try {
          const r = runSweep(box);
          expect(r.code, r.stderr).toBe(0);
          expect(counters(box)['journal_write_failed']).toBeUndefined();   // at HEAD~: 1, and B held
          expect(r.stderr).toContain(`history-sweep: spool-blocked: ${ID}.900.1.jsonl\n`);
          expect(counters(box)['spool_blocked']).toBe(1);
          expect(counters(box)['spool_displaced']).toBeUndefined();
          expect(receipts(box).map((x) => x.event_key)).toEqual([eventKey(`${ID2}.902.1.jsonl`, 1)]);   // B drained
          expect(drainingNames(box.home)).toEqual([`${ID}.900.1.jsonl`]);   // A is still a live draining file
          expect(fs.readFileSync(path.join(DRAIN(box.home), `${ID}.900.1.jsonl`), 'utf8')).toBe(stopLine(ID));
          expect(journalOf(box.home, ids.storeId).filter((x) => x['k'] === 'file').map((x) => x['name'])).toEqual([`${ID2}.902.1.jsonl`]);   // never journaled by this drain
        } finally { fs.chmodSync(PL(), 0o700); fs.chmodSync(d, 0o700); }
      });

      it('CONTROL (FU3F): the same fixture with a usable planted/ displaces A, and B drains', () => {
        writeRegular();
        fs.writeFileSync(path.join(DRAIN(box.home), `${ID2}.902.1.jsonl`), stopLine(ID2));
        const d = plantDir(`${ID}.900.1.obs`, 'keep');
        fs.chmodSync(d, 0o500);
        fs.mkdirSync(PL());
        fs.writeFileSync(path.join(PL(), 'keep'), '');
        fs.chmodSync(PL(), 0o700);
        try {
          const r = runSweep(box);
          expect(r.code, r.stderr).toBe(0);
          expect(r.stderr).toContain(`history-sweep: spool-displaced: ${ID}.900.1.jsonl\n`);
          expect(counters(box)['spool_displaced']).toBe(1);
          expect(counters(box)['spool_blocked']).toBeUndefined();
          expect(counters(box)['journal_write_failed']).toBeUndefined();
          expect(receipts(box).map((x) => x.event_key)).toEqual([eventKey(`${ID2}.902.1.jsonl`, 1)]);
          expect(drainingNames(box.home)).toEqual([]);
        } finally { fs.chmodSync(d, 0o700); }
      });

      it.each([['.obs'], ['.obs.tmp']])('an EMPTY 0500 directory at the sidecar name %s is removed and its file drains', (suffix) => {
        writeRegular();
        const d = path.join(DRAIN(box.home), `${ID}.900.1${suffix}`);
        fs.mkdirSync(d, { mode: 0o500 });
        fs.chmodSync(d, 0o500);
        const r = runSweep(box);
        expect(r.code, r.stderr).toBe(0);
        expect(fs.existsSync(d)).toBe(false);
        expect(counters(box)['journal_write_failed']).toBeUndefined();   // at e0c14f811 for .obs: 1, the file held
        expect(counters(box)['spool_displaced']).toBeUndefined();
        expect(counters(box)['non_regular']).toBe(1);
        expect(receipts(box).map((x) => x.event_key)).toEqual([eventKey(`${ID}.900.1.jsonl`, 1)]);
      });

      it('a non-empty 0500 directory at a draining name is counted once per drain and never observed (M17)', () => {
        const d = plantDir(`${ID}.900.1.jsonl`, 'keep');
        fs.chmodSync(d, 0o500);
        try {
          for (const n of [1, 2]) {
            const r = runSweep(box);
            expect(r.code, r.stderr).toBe(0);
            expect(counters(box)['non_regular'], `after drain ${n}`).toBe(n);   // at e0c14f811: 2, then 4
            expect(fs.existsSync(path.join(DRAIN(box.home), `${ID}.900.1.obs`))).toBe(false);
          }
          expect(fs.statSync(d).isDirectory()).toBe(true);
          expect(areas().filter((a) => fs.readdirSync(path.join(PL(), a)).length === 0), 'a failed move leaves no empty area').toEqual([]);
        } finally { fs.chmodSync(d, 0o700); }
      });

      it('an EMPTY 0500 directory at a draining name is removed, counted once', () => {
        const d = path.join(DRAIN(box.home), `${ID}.900.1.jsonl`);
        fs.mkdirSync(d);
        fs.chmodSync(d, 0o500);
        const r = runSweep(box);
        expect(r.code, r.stderr).toBe(0);
        expect(fs.existsSync(d)).toBe(false);
        expect(counters(box)['non_regular']).toBe(1);
      });
    });

    // M16: tidyDraining's live-sidecar 'other' arm and listDraining's ENOTDIR answer, each red when its guard is deleted.
    it.each([['a FIFO'], ['a symlink']])('%s at a live file\'s sidecar name is removed and counted non_regular, never sidecar_malformed; the file drains (M16)', (kind) => {
      writeRegular();
      const obs = path.join(DRAIN(box.home), `${ID}.900.1.obs`);
      if (kind === 'a FIFO') expect(spawnSync('mkfifo', [obs]).status).toBe(0);
      else fs.symlinkSync(path.join(box.home, 'nowhere'), obs);
      const r = runSweep(box, [], { timeoutMs: 30_000 });
      expect(r.code, `${r.signal} ${r.stderr}`).toBe(0);
      expect(counters(box)['non_regular']).toBe(1);
      expect(counters(box)['sidecar_malformed']).toBeUndefined();
      expect(receipts(box).map((x) => x.event_key)).toEqual([eventKey(`${ID}.900.1.jsonl`, 1)]);
    });

    it('a regular file at spool/.draining under a hold with no spool file: the hold pass exits 5, never an ENOTDIR internal error (M16)', () => {
      fs.rmSync(DRAIN(box.home), { recursive: true });
      fs.writeFileSync(DRAIN(box.home), 'stray');
      const aside = path.join(box.home, 'aside');
      moveDb(box, hist(box.home, 'db'), aside);
      try {
        const r = runSweep(box);
        expect(r.code, r.stderr).toBe(5);
        expect(r.stderr).not.toMatch(/internal error/);
      } finally { moveDb(box, aside, hist(box.home, 'db')); }
    });
  });

  it('while a file is held, a startup sid the observation did not name is recorded the first time .uuid names it', () => {
    setReg(box, ID, 'uuid', U0);
    spool(box.home, ID, { v: 1, ev: 'SessionStart', id: ID, sid: U1, src: 'startup' });
    expect(runSweep(box).code).toBe(0);
    const [name] = drainingNames(box.home);
    expect(obsOf(box.home, name!)['uuid']).toEqual({ state: 'value', value: U0 });
    const aside = path.join(box.home, 'aside');
    moveDb(box, hist(box.home, 'db'), aside);
    setReg(box, ID, 'uuid', U1);
    expect(runSweep(box).code).toBe(5);
    expect((obsOf(box.home, name!)['heldMatches'] as Record<string, number>)[U1]).toEqual(expect.any(Number));
    moveDb(box, aside, hist(box.home, 'db'));
  });

  it('a store whose store.writer is gone cannot name its journal: no tick runs, the journal half observes only, and the pass says held (§9.10 "Writer token")', () => {
    spool(box.home, ID, { v: 1, ev: 'Stop', id: ID });
    expect(runSweep(box).code).toBe(0);
    const [name] = drainingNames(box.home);
    fs.rmSync(hist(box.home, 'store.writer'));
    const r = runSweep(box);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^history-sweep: held$/m);
    expect(r.stdout).not.toContain('journal-unwritable');
    expect(drainingNames(box.home)).toEqual([name]);
    expect(obsOf(box.home, name!)['journaled']).toBeNull();
    expect(receipts(box)).toEqual([]);
    expect(counters(box)['journal_write_failed']).toBeUndefined();
  });

  // Review Focus 3 (ruled at Task 16's preflight, B4): the longest and the dotted ids, carried through the rename, the
  // observation sidecar, its temp and the id parsed back out of the draining name, with no ENAMETOOLONG.
  it('a 224-char id is spooled, renamed, observed and drained end to end, leaving no sidecar or temp behind (Review Focus 3)', () => {
    const LONG = 'a'.repeat(224);
    spool(box.home, LONG, { v: 1, ev: 'Stop', id: LONG });
    expect(runSweep(box).code).toBe(0);                                  // tick N: renamed and observed
    const [name] = drainingNames(box.home);
    expect(name).toMatch(/^a{224}\.\d+\.\d+\.jsonl$/);
    expect(fs.existsSync(path.join(DRAIN(box.home), name!.replace(/\.jsonl$/, '.obs')))).toBe(true);
    const r = runSweep(box);                                             // tick N+1: journaled and drained
    expect(r.code, r.stderr).toBe(0);
    expect(receipts(box).map((x) => x.event_key)).toEqual([eventKey(name!, 1)]);
    expect(drainingNames(box.home)).toEqual([]);
    expect(fs.readdirSync(DRAIN(box.home)), 'an .obs or .obs.tmp residue').toEqual([]);
    expect(counters(box)['spool_line_rejected']).toBeUndefined();
  });

  it('a dotted id drains under itself end to end: the id parses back out of the draining name (Review Focus 3)', () => {
    spool(box.home, 'a.b.c', { v: 1, ev: 'Stop', id: 'a.b.c' });
    expect(runSweep(box).code).toBe(0);
    const [name] = drainingNames(box.home);
    expect(name).toMatch(/^a\.b\.c\.\d+\.\d+\.jsonl$/);
    expect(SW.idOfDrainingName(name!)).toBe('a.b.c');
    const r = runSweep(box);
    expect(r.code, r.stderr).toBe(0);
    expect(receipts(box).map((x) => x.event_key)).toEqual([eventKey(name!, 1)]);
    expect(drainingNames(box.home)).toEqual([]);
    expect(fs.readdirSync(DRAIN(box.home))).toEqual([]);
    expect(counters(box)['spool_line_rejected']).toBeUndefined();
  });

  it('the bound: a 224-char id with a 7-digit pid and a 13-digit tick drains, its 250-byte sidecar and 254-byte temp included (Review Focus 3, D-4303)', () => {
    // process.pid cannot be forced to seven digits, so the file is planted as the symlink case plants one.
    const LONG = 'a'.repeat(224);
    const n = SW.drainingName(LONG, 1_791_244_261_576, 4_194_304);
    expect(Buffer.byteLength(n)).toBe(252);
    // a gen-less recall joins the registry generation: the registry path is `<id>.generation`, 235 bytes
    setReg(box, LONG, 'generation', G1);
    fs.writeFileSync(path.join(DRAIN(box.home), n), `\n${JSON.stringify({ v: 1, ev: 'recall', id: LONG, cmd: 'grep', rc: 0, ms: 1 })}\n`);
    const r = runSweep(box);
    expect(r.code, r.stderr).toBe(0);                                    // ENAMETOOLONG would be a nonzero exit or no receipt
    expect(receipts(box).map((x) => x.event_key)).toEqual([eventKey(n, 1)]);
    expect(rowsOf(box, 'SELECT ccrc_id, generation FROM recall_calls')).toEqual([{ ccrc_id: LONG, generation: G1 }]);
    expect(fs.readdirSync(DRAIN(box.home))).toEqual([]);
  });
});

// ── Task 17: epochs and families ────────────────────────────────────────────────────────────────────────
interface SweepEpochs {
  confirmCandidates(db: DatabaseSync, c: TickCtx): void;
  registryBackfill(db: DatabaseSync, c: TickCtx): void;
  ensureFamily(db: DatabaseSync, ccrcId: string, generation: string, project: string, nowMs: number):
    { sessionPk: number; created: boolean; generation: string };
  scanDue(db: DatabaseSync, nowMs: number): boolean;
  tick(db: DatabaseSync, ctx: unknown): Promise<void>;
  passCtx(o: Record<string, unknown>): TickCtx;
  newFirstRowCache(): unknown;
}
let EP: SweepEpochs;
beforeAll(async () => { EP = (await import('../../ccd/history/sweep.mjs')) as unknown as SweepEpochs; });

const WEEK = 7 * 24 * 60 * 60 * 1000;
const start = (id: string, sid: string, src: 'startup' | 'resume' | 'clear', extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ v: 1, ev: 'SessionStart', id, sid, src, ...extra });
type Family = { session_pk: number; ccrc_id: string; generation: string; project: string; merged_into: number | null };
type Epoch = { seq: number; cc_session_uuid: string; cause: string; declared_by: string; confirmed_ms: number | null };
const familiesOf = (db: DatabaseSync): Family[] =>
  db.prepare('SELECT session_pk, ccrc_id, generation, project, merged_into FROM sessions ORDER BY session_pk').all() as unknown as Family[];
const epochsOf = (db: DatabaseSync, id: string, generation: string): Epoch[] =>
  db.prepare('SELECT e.seq, e.cc_session_uuid, e.cause, e.declared_by, e.confirmed_ms FROM epochs e JOIN sessions s ON s.session_pk = e.session_pk WHERE s.ccrc_id = ? AND s.generation = ? ORDER BY e.seq')
    .all(id, generation) as unknown as Epoch[];
const candidatesOf = (db: DatabaseSync): Array<{ cc_session_uuid: string; ccrc_id: string; cause: string }> =>
  db.prepare('SELECT cc_session_uuid, ccrc_id, cause FROM epoch_candidates ORDER BY first_seen_ms, cc_session_uuid')
    .all() as unknown as Array<{ cc_session_uuid: string; ccrc_id: string; cause: string }>;
const counterOf = (db: DatabaseSync, name: string): number =>
  (db.prepare('SELECT n FROM counters WHERE name = ?').get(name) as { n: number } | undefined)?.n ?? 0;
const verdictsOf = (home: string, storeId: string): Array<Record<string, unknown>> =>
  journalOf(home, storeId).filter((r) => r['k'] === 'verdict');
/** A transcript whose first row is uuid-less (as a bridge-session row is) and whose first uuid row carries `cwd`. */
const firstRows = (cwd: string): string =>
  `${JSON.stringify({ type: 'bridge-session' })}\n${JSON.stringify({ type: 'user', uuid: 'row-1', cwd, message: { role: 'user', content: 'hi' } })}\n`;
const transcriptIn = (home: string, slug: string, uuid: string, text: string): string => {
  const dir = path.join(home, 'projects', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${uuid}.jsonl`), text);
  return path.join(dir, `${uuid}.jsonl`);
};

describe('epochs and families, decided at drain (spec §6.1, §9.2 step 1, §9.14 verdicts)', () => {
  let box: HistoryBox;
  let ids: Ids;
  let db: DatabaseSync;
  let clock: { ms: number };
  let c: TickCtx;
  beforeEach(() => {
    box = makeHistoryBox('ccrc-hist-epoch-', { role: 'fleet' });
    ids = createStore(box.home);
    db = openWriter(historyPaths(box.home).dbFile);
    clock = { ms: T };
    c = { home: box.home, ids, now: () => clock.ms, homes: box.homes, rosterUnreadable: false, out: () => undefined };
  });
  afterEach(() => { closeWriter(db); });
  /** Two drains: the first renames and observes the spool, the second journals and drains it (§9.2: read at N+1). */
  const pass = (): void => { SW.drainSpool(db, c); clock.ms += 1000; SW.drainSpool(db, c); clock.ms += 1000; };

  it('a startup line whose own reg names its sid is an epoch at drain, even with .uuid moved on before the observation (DM19, CT6)', () => {
    setReg(box, ID, 'uuid', U9); setReg(box, ID, 'generation', G1); setReg(box, ID, 'project', 'demo');
    spool(box.home, ID, start(ID, U1, 'startup', { reg: U1 }));
    pass();
    expect(epochsOf(db, ID, G1)).toEqual([{ seq: 1, cc_session_uuid: U1, cause: 'startup', declared_by: 'hook', confirmed_ms: expect.any(Number) }]);
    expect(familiesOf(db)).toEqual([expect.objectContaining({ ccrc_id: ID, generation: G1, project: 'demo', merged_into: null })]);
  });

  it('a line the observed .uuid names is an epoch; one nothing names is a candidate, dropped and counted after 7 days (DM19)', () => {
    setReg(box, ID, 'uuid', U1); setReg(box, ID, 'generation', G1);
    spool(box.home, ID, start(ID, U1, 'startup'));                  // ccd's own start: .uuid names it
    spool(box.home, ID, start(ID, U2, 'startup', { reg: U9 }));     // a nested `claude -p`: its own sid, the pane's reg
    pass();
    expect(epochsOf(db, ID, G1).map((e) => e.cc_session_uuid)).toEqual([U1]);
    expect(candidatesOf(db)).toEqual([{ cc_session_uuid: U2, ccrc_id: ID, cause: 'startup' }]);
    clock.ms += 60_000;
    EP.confirmCandidates(db, c);
    expect(candidatesOf(db)).toHaveLength(1);
    clock.ms = T + WEEK + 10_000;
    EP.confirmCandidates(db, c);
    expect(candidatesOf(db)).toEqual([]);
    expect(epochsOf(db, ID, G1).map((e) => e.cc_session_uuid)).toEqual([U1]);
    expect(counterOf(db, 'epoch_unconfirmed')).toBe(1);
    expect(verdictsOf(box.home, ids.storeId).filter((v) => v['kind'] === 'epoch-unconfirmed')).toEqual([
      expect.objectContaining({ event_key: 'none', ccrc_id: ID, cc_session_uuid: U2, superseded: false }),
    ]);
  });

  it('a candidate the registry names at a later tick within 7 days is confirmed then, in its own FULL transaction, journaled right after', () => {
    setReg(box, ID, 'uuid', U9); setReg(box, ID, 'generation', G1);
    spool(box.home, ID, start(ID, U2, 'startup', { reg: U9 }));
    pass();
    expect(candidatesOf(db)).toHaveLength(1);
    setReg(box, ID, 'uuid', U2);
    clock.ms += 60_000;
    EP.confirmCandidates(db, c);
    expect(epochsOf(db, ID, G1)).toEqual([expect.objectContaining({ cc_session_uuid: U2, cause: 'startup', declared_by: 'hook' })]);
    expect(candidatesOf(db)).toEqual([]);
    expect(verdictsOf(box.home, ids.storeId).filter((v) => v['kind'] === 'epoch-confirmed').at(-1))
      .toMatchObject({ event_key: 'none', by: 'later-tick', cc_session_uuid: U2, generation: G1 });
    expect(outboxCount(db)).toBe(0);
  });

  it('a startup candidate whose sid lost to a later /clear of the same id is dropped as superseded (§9.2, §14 risk 24)', () => {
    setReg(box, ID, 'uuid', U2); setReg(box, ID, 'generation', G1);
    spool(box.home, ID, start(ID, U1, 'startup', { reg: U9 }));
    spool(box.home, ID, start(ID, U2, 'clear'));
    pass();
    clock.ms = T + WEEK + 10_000;
    EP.confirmCandidates(db, c);
    expect(counterOf(db, 'epoch_unconfirmed')).toBe(1);
    expect(counterOf(db, 'epoch_unconfirmed_superseded')).toBe(1);
    expect(verdictsOf(box.home, ids.storeId).find((v) => v['kind'] === 'epoch-unconfirmed')).toMatchObject({ cc_session_uuid: U1, superseded: true });
  });

  it('every decision read from the registry is a verdict carrying its line\'s event_key, reached through the outbox (§9.14)', () => {
    setReg(box, ID, 'uuid', U9); setReg(box, ID, 'generation', G1); setReg(box, ID, 'project', 'demo');
    spool(box.home, ID, start(ID, U1, 'startup', { reg: U1 }));
    pass();
    const recs = journalOf(box.home, ids.storeId);
    const name = String(recs.find((r) => r['k'] === 'file')!['name']);
    expect(recs.filter((r) => r['k'] === 'verdict').map((r) => [r['kind'], r['event_key']])).toEqual([
      ['generation-joined', eventKey(name, 1)], ['family', eventKey(name, 1)], ['epoch-confirmed', eventKey(name, 1)], ['drained', 'none'],
    ]);
    expect(recs.find((r) => r['kind'] === 'generation-joined')).toMatchObject({ ccrc_id: ID, generation: G1, via: 'registry' });
    expect(recs.find((r) => r['kind'] === 'family')).toMatchObject({ ccrc_id: ID, generation: G1, project: 'demo' });
    expect(recs.find((r) => r['kind'] === 'epoch-confirmed')).toMatchObject({ cc_session_uuid: U1, cause: 'startup', declared_by: 'hook', by: 'reg' });
    expect(outboxCount(db)).toBe(0);
  });

  it('a gen-less resume line after a swap joins the generation the registry reads (DM19b)', () => {
    setReg(box, ID, 'uuid', U1); setReg(box, ID, 'generation', G1);
    spool(box.home, ID, start(ID, U1, 'resume', { reg: U1 }));
    pass();
    expect(familiesOf(db).map((f) => f.generation)).toEqual([G1]);
    expect(epochsOf(db, ID, G1).map((e) => e.cc_session_uuid)).toEqual([U1]);
  });

  // FU3F round 1, F1: a blocked file's id waits, in order, so no id's later file drains before its earlier one (the epoch chain numbers in drain order).
  it.skipIf(process.getuid?.() === 0)('a blocked file holds back its own id\'s later files, so the epoch chain keeps its order once the block lifts (FU3F review F1)', () => {
    setReg(box, ID, 'uuid', U2); setReg(box, ID, 'generation', G1);
    const dr = DRAIN(box.home);
    fs.mkdirSync(dr, { recursive: true });
    fs.writeFileSync(path.join(dr, `${ID}.900.1.jsonl`), `\n${JSON.stringify(start(ID, U1, 'startup', { reg: U1 }))}\n`);   // A, blocked
    fs.writeFileSync(path.join(dr, `${ID}.901.1.jsonl`), `\n${JSON.stringify(start(ID, U2, 'clear'))}\n`);                  // B, the same id, later
    const d = path.join(dr, `${ID}.900.1.obs`);
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, 'keep'), '');
    fs.chmodSync(d, 0o500);
    const pl = path.join(dr, 'planted');
    fs.mkdirSync(pl);
    fs.writeFileSync(path.join(pl, 'keep'), '');
    fs.chmodSync(pl, 0o500);
    try {
      SW.drainSpool(db, c); clock.ms += 1000; SW.drainSpool(db, c); clock.ms += 1000;
      expect(counterOf(db, 'spool_blocked')).toBeGreaterThanOrEqual(1);
      expect(epochsOf(db, ID, G1), 'B waits behind A: nothing of the id drained').toEqual([]);
      expect(drainingNames(box.home)).toEqual([`${ID}.900.1.jsonl`, `${ID}.901.1.jsonl`]);
    } finally { fs.chmodSync(pl, 0o700); fs.chmodSync(d, 0o700); }
    for (let i = 0; i < 3; i++) { SW.drainSpool(db, c); clock.ms += 1000; }   // the block lifted: the next tidy sets the entry aside
    expect(drainingNames(box.home)).toEqual([]);
    expect(epochsOf(db, ID, G1).map((e) => [e.seq, e.cc_session_uuid, e.cause])).toEqual([[1, U1, 'startup'], [2, U2, 'clear']]);
  });

  it('a gen-less clear line on that row joins the same family: one family, the clear chained after the resume (DM19b CONTROL)', () => {
    setReg(box, ID, 'uuid', U2); setReg(box, ID, 'generation', G1);
    spool(box.home, ID, start(ID, U1, 'resume', { reg: U1 }));
    spool(box.home, ID, start(ID, U2, 'clear'));
    pass();
    expect(familiesOf(db)).toHaveLength(1);
    expect(epochsOf(db, ID, G1).map((e) => [e.seq, e.cc_session_uuid, e.cause])).toEqual([[1, U1, 'resume'], [2, U2, 'clear']]);
  });

  it('with .generation absent a gen-less line joins the legacy \'\' family, counted family_gen_absent (DM19b)', () => {
    setReg(box, ID, 'uuid', U1);
    spool(box.home, ID, start(ID, U1, 'resume', { reg: U1 }));
    pass();
    expect(epochsOf(db, ID, '').map((e) => e.cc_session_uuid)).toEqual([U1]);
    expect(counterOf(db, 'family_gen_absent')).toBe(1);
    expect(counterOf(db, 'family_gen_unreadable')).toBe(0);
  });

  it('with .generation unreadable it joins \'\' too, counted family_gen_unreadable and never family_gen_absent (DM19b, IV5)', () => {
    setReg(box, ID, 'uuid', U1); setReg(box, ID, 'generation', { unreadable: true });
    spool(box.home, ID, start(ID, U1, 'resume', { reg: U1 }));
    pass();
    expect(epochsOf(db, ID, '').map((e) => e.cc_session_uuid)).toEqual([U1]);
    expect(counterOf(db, 'family_gen_unreadable')).toBe(1);
    expect(counterOf(db, 'family_gen_absent')).toBe(0);
  });

  it('one ccrc id with two generations is two families (DM18)', () => {
    setReg(box, ID, 'generation', G1);
    spool(box.home, ID, start(ID, U1, 'startup', { reg: U1, gen: G1 }));
    pass();
    setReg(box, ID, 'generation', G2);
    spool(box.home, ID, start(ID, U2, 'startup', { reg: U2, gen: G2 }));
    pass();
    expect(familiesOf(db).map((f) => [f.ccrc_id, f.generation])).toEqual([[ID, G1], [ID, G2]]);
    expect(epochsOf(db, ID, G1).map((e) => e.cc_session_uuid)).toEqual([U1]);
    expect(epochsOf(db, ID, G2).map((e) => e.cc_session_uuid)).toEqual([U2]);
  });

  it('a generation minted later for a row whose \'\' family holds a confirmed uuid merges that family into (id, G) (DM18b)', () => {
    setReg(box, ID, 'uuid', U1);
    spool(box.home, ID, start(ID, U1, 'startup', { reg: U1 }));
    pass();
    expect(epochsOf(db, ID, '').map((e) => e.cc_session_uuid)).toEqual([U1]);
    setReg(box, ID, 'generation', G1);
    spool(box.home, ID, start(ID, U1, 'resume', { reg: U1, gen: G1 }));
    pass();
    const fams = familiesOf(db);
    const legacy = fams.find((f) => f.generation === '')!;
    const keyed = fams.find((f) => f.generation === G1)!;
    expect(legacy.merged_into).toBe(keyed.session_pk);
    expect(epochsOf(db, ID, G1).map((e) => [e.seq, e.cc_session_uuid])).toEqual([[1, U1]]);
    expect(epochsOf(db, ID, '')).toEqual([]);
    expect(counterOf(db, 'family_rekeyed')).toBe(1);
    expect(verdictsOf(box.home, ids.storeId).filter((v) => v['kind'] === 'rekeyed')).toEqual([expect.objectContaining({ ccrc_id: ID, generation: G1 })]);
  });

  it('re-keying into an (id, G) that already holds a gen-less clear keeps both, the \'\' family\'s epochs first; a replay of (id, \'\') lands in (id, G) (DM18b)', () => {
    setReg(box, ID, 'uuid', U1);
    spool(box.home, ID, start(ID, U1, 'startup', { reg: U1 }));
    pass();                                                          // ('' ) holds U1
    setReg(box, ID, 'generation', G1); setReg(box, ID, 'uuid', U2);
    spool(box.home, ID, start(ID, U2, 'clear'));
    pass();                                                          // (G1) holds U2, joined through the registry
    expect(epochsOf(db, ID, G1).map((e) => e.cc_session_uuid)).toEqual([U2]);
    spool(box.home, ID, start(ID, U1, 'resume', { reg: U1, gen: G1 }));
    pass();                                                          // the evidence: U1, confirmed in '', under G1
    const fams = familiesOf(db);
    const legacy = fams.find((f) => f.generation === '')!;
    const keyed = fams.find((f) => f.generation === G1)!;
    expect(legacy.merged_into).toBe(keyed.session_pk);
    expect(epochsOf(db, ID, G1).map((e) => [e.seq, e.cc_session_uuid])).toEqual([[1, U1], [2, U2]]);
    expect(EP.ensureFamily(db, ID, '', 'demo', clock.ms)).toEqual({ sessionPk: keyed.session_pk, created: false, generation: G1 });
  });

  it('a row that gains a generation re-keys its \'\' family at the next registry scan too (§6.10 "A respawn that mints a missing generation")', () => {
    setReg(box, ID, 'uuid', U1);
    spool(box.home, ID, start(ID, U1, 'startup', { reg: U1 }));
    pass();
    setReg(box, ID, 'generation', G1);
    EP.registryBackfill(db, c);
    const keyed = familiesOf(db).find((f) => f.generation === G1)!;
    expect(familiesOf(db).find((f) => f.generation === '')!.merged_into).toBe(keyed.session_pk);
    expect(epochsOf(db, ID, G1).map((e) => e.cc_session_uuid)).toEqual([U1]);
    expect(counterOf(db, 'family_rekeyed')).toBe(1);
  });

  it('an Anthropic→gateway→Anthropic swap keeps one family and one epoch, with nothing unconfirmed (DM18c)', () => {
    setReg(box, ID, 'uuid', U1); setReg(box, ID, 'generation', G1); setReg(box, ID, 'project', 'demo');
    for (const h of box.homes.slice(0, 3)) transcriptIn(h, 'demo', U1, firstRows(path.join(box.home, 'work')));
    spool(box.home, ID, start(ID, U1, 'startup', { reg: U1, gen: G1 }));
    for (let i = 0; i < 3; i += 1) spool(box.home, ID, start(ID, U1, 'resume', { reg: U1, gen: G1 }));
    pass();
    expect(familiesOf(db)).toHaveLength(1);
    expect(epochsOf(db, ID, G1).map((e) => [e.seq, e.cc_session_uuid, e.cause])).toEqual([[1, U1, 'startup']]);
    expect(candidatesOf(db)).toEqual([]);
    expect(counterOf(db, 'epoch_unconfirmed')).toBe(0);
  });

  it('a uuid two families claim stays with the first claim; the second is counted (DM23)', () => {
    spool(box.home, 'x-first', start('x-first', U1, 'startup', { reg: U1, gen: G1 }));
    spool(box.home, 'y-second', start('y-second', U1, 'startup', { reg: U1, gen: G2 }));
    pass();
    expect(epochsOf(db, 'x-first', G1).map((e) => e.cc_session_uuid)).toEqual([U1]);
    expect(epochsOf(db, 'y-second', G2)).toEqual([]);
    expect(counterOf(db, 'uuid_two_sessions')).toBe(1);
  });

  it('a new uuid file with no SessionStart(clear) line is never a clear epoch: /clear is declared, not inferred (DM11)', () => {
    setReg(box, ID, 'uuid', U1); setReg(box, ID, 'generation', G1);
    transcriptIn(box.homes[0]!, 'demo', U1, firstRows(path.join(box.home, 'work')));
    transcriptIn(box.homes[0]!, 'demo', U2, firstRows(path.join(box.home, 'work')));
    pass();
    EP.registryBackfill(db, c);
    expect(epochsOf(db, ID, G1).map((e) => [e.cc_session_uuid, e.cause, e.declared_by])).toEqual([[U1, 'import', 'registry']]);
    expect((db.prepare("SELECT count(*) AS n FROM epochs WHERE cause = 'clear' OR cc_session_uuid = ?").get(U2) as { n: number }).n).toBe(0);
  });

  it('a planted clear line naming another project\'s transcript chains unconfirmed and is counted after 7 days (DM46)', () => {
    const work = path.join(box.home, 'work', 'x'); fs.mkdirSync(work, { recursive: true });
    const elsewhere = path.join(box.home, 'work', 'other'); fs.mkdirSync(elsewhere, { recursive: true });
    setReg(box, ID, 'uuid', U0); setReg(box, ID, 'generation', G1); setReg(box, ID, 'workdir', work);
    transcriptIn(box.homes[0]!, 'other', U5, firstRows(elsewhere));
    spool(box.home, ID, start(ID, U5, 'clear', { gen: G1 }));
    pass();
    expect(epochsOf(db, ID, G1)).toEqual([expect.objectContaining({ cc_session_uuid: U5, cause: 'clear', confirmed_ms: null })]);
    clock.ms += 60_000;
    EP.confirmCandidates(db, c);
    expect(epochsOf(db, ID, G1)[0]!.confirmed_ms).toBeNull();
    setReg(box, ID, 'uuid', U5);                                      // .uuid names it only after the window: too late
    clock.ms = T + WEEK + 10_000;
    EP.confirmCandidates(db, c);
    expect(epochsOf(db, ID, G1)[0]!.confirmed_ms, 'confirmed past its 7 days').toBeNull();
    expect(counterOf(db, 'epoch_unconfirmed')).toBe(1);
    expect(candidatesOf(db)).toEqual([]);
  });

  it('a registry scan does not confirm a clear epoch past its 7 days (DM46, IV4, D-4297)', () => {
    const work = path.join(box.home, 'work', 'x'); fs.mkdirSync(work, { recursive: true });
    const elsewhere = path.join(box.home, 'work', 'other'); fs.mkdirSync(elsewhere, { recursive: true });
    setReg(box, ID, 'uuid', U0); setReg(box, ID, 'generation', G1); setReg(box, ID, 'workdir', work);
    transcriptIn(box.homes[0]!, 'other', U5, firstRows(elsewhere));
    spool(box.home, ID, start(ID, U5, 'clear', { gen: G1 }));
    pass();
    setReg(box, ID, 'uuid', U5);                                      // .uuid names it only after the window: too late
    clock.ms = T + WEEK + 10_000;
    EP.confirmCandidates(db, c);
    EP.registryBackfill(db, c);                                       // the scan must not graft what the window dropped
    expect(epochsOf(db, ID, G1)).toEqual([expect.objectContaining({ cc_session_uuid: U5, cause: 'clear', declared_by: 'hook', confirmed_ms: null })]);
    expect(counterOf(db, 'epoch_unconfirmed')).toBe(1);
    expect(verdictsOf(box.home, ids.storeId).filter((v) => v['kind'] === 'mapping')).toEqual([]);
  });

  it('two quick /clears in the pane\'s own project both confirm: the first by location, the second by .uuid (DM46)', () => {
    const work = path.join(box.home, 'work', 'x'); fs.mkdirSync(work, { recursive: true });
    setReg(box, ID, 'uuid', U2); setReg(box, ID, 'generation', G1); setReg(box, ID, 'workdir', work);
    transcriptIn(box.homes[0]!, 'x', U1, firstRows(work));
    spool(box.home, ID, start(ID, U1, 'clear', { gen: G1 }));
    spool(box.home, ID, start(ID, U2, 'clear', { gen: G1 }));
    pass();
    expect(epochsOf(db, ID, G1).map((e) => [e.seq, e.cc_session_uuid, e.confirmed_ms !== null])).toEqual([[1, U1, true], [2, U2, true]]);
    const by = verdictsOf(box.home, ids.storeId).filter((v) => v['kind'] === 'epoch-confirmed').map((v) => [v['cc_session_uuid'], v['by']]);
    expect(by).toEqual([[U1, 'location'], [U2, 'observed']]);
  });

  it('held files for one id drain in journaling order, so their epochs take seq in line order (O50)', () => {
    setReg(box, ID, 'generation', G1);
    fs.mkdirSync(DRAIN(box.home), { recursive: true });
    const put = (name: string, rec: Record<string, unknown>): void => { fs.writeFileSync(path.join(DRAIN(box.home), name), `\n${JSON.stringify(rec)}\n`); };
    put(`${ID}.1100.1.jsonl`, start(ID, U3, 'clear', { gen: G1 }));
    put(`${ID}.900.1.jsonl`, start(ID, U1, 'startup', { reg: U1, gen: G1 }));
    put(`${ID}.1000.1.jsonl`, start(ID, U2, 'clear', { gen: G1 }));
    SW.drainSpool(db, c);
    expect(epochsOf(db, ID, G1).map((e) => [e.seq, e.cc_session_uuid, e.cause])).toEqual([[1, U1, 'startup'], [2, U2, 'clear'], [3, U3, 'clear']]);
  });

  it('a line appended after the rename is decided from the registry as the journaling re-read it, not as the rename saw it (§9.2)', () => {
    setReg(box, ID, 'uuid', U0); setReg(box, ID, 'generation', G1);
    spool(box.home, ID, start(ID, U0, 'startup'));
    SW.drainSpool(db, c);                                             // renames at T: the observation reads .uuid = U0
    const [name] = drainingNames(box.home);
    setReg(box, ID, 'uuid', U1);
    fs.appendFileSync(path.join(DRAIN(box.home), name!), `\n${JSON.stringify(start(ID, U1, 'resume', { ts: T + 30_000 }))}\n`);
    clock.ms = T + 60_000;
    SW.drainSpool(db, c);
    expect(epochsOf(db, ID, G1).map((e) => [e.seq, e.cc_session_uuid])).toEqual([[1, U0], [2, U1]]);
    expect(verdictsOf(box.home, ids.storeId).filter((v) => v['kind'] === 'epoch-confirmed').map((v) => v['by'])).toEqual(['observed', 'observed']);
  });

  // ── RF5b F16: the location rule's per-tick walk and first-row memory (review 316) ─────────────────────────
  /** Replaces node:fs members for one body, as history-ingest.test.ts's D-4298 case does: syncBuiltinESMExports() carries
   *  each replacement to sweep.mjs's named imports, and the finally restores them. `wrap` gets the real function. */
  const patchedFs = async <T,>(wrap: Record<string, (real: (...a: unknown[]) => unknown) => (...a: unknown[]) => unknown>, body: () => Promise<T> | T): Promise<T> => {
    const live = fs as unknown as Record<string, unknown>;
    const real: Record<string, unknown> = {};
    for (const k of Object.keys(wrap)) { real[k] = live[k]; live[k] = wrap[k]!(real[k] as (...a: unknown[]) => unknown); }
    syncBuiltinESMExports();
    try { return await body(); } finally { for (const k of Object.keys(wrap)) live[k] = real[k]; syncBuiltinESMExports(); }
  };
  const clearsOf = (n: number, gen: string = G1): Array<Record<string, unknown>> => Array.from({ length: n }, (_, i) => start(ID, u(0x100 + i), 'clear', { gen }));
  const tickCtx = (): TickCtx => EP.passCtx({
    home: box.home, P: historyPaths(box.home), ids, parsed: { homes: box.homes, secrets: [], rosterUnreadable: false },
    now: () => clock.ms, out: () => undefined, deps: {}, pause: null, ingest: false,
  });

  it('RF5b F16: a tick\'s location rule walks each rostered projects/ once, however many clear lines and candidates it decides', async () => {
    setReg(box, ID, 'uuid', U9); setReg(box, ID, 'generation', G1); setReg(box, ID, 'workdir', path.join(box.home, 'work', 'x'));
    for (const h of box.homes) for (let i = 0; i < 20; i++) fs.mkdirSync(path.join(h, 'projects', `slug-${i}`), { recursive: true });
    for (const rec of clearsOf(40)) spool(box.home, ID, rec);
    const ctx = tickCtx();
    await EP.tick(db, ctx);                                           // renames and observes
    clock.ms += 60_000;
    let walks = 0;
    await patchedFs({ readdirSync: (real) => (p, ...rest) => { if (String(p).endsWith('/projects')) walks += 1; return real(p, ...rest); } },
      () => EP.tick(db, ctx));                                        // journals, drains 40 clear lines, then decides 40 candidates
    expect(candidatesOf(db), 'the 40 clear epochs are waiting candidates: each lookup found no transcript').toHaveLength(40);
    expect(walks).toBe(box.homes.length);
  });

  it('RF5b F16: an admitted first row is read once per tick by uuid', async () => {
    setReg(box, ID, 'uuid', U9); setReg(box, ID, 'generation', G1); setReg(box, ID, 'workdir', path.join(box.home, 'work', 'x'));
    const file = transcriptIn(box.homes[0]!, 'x', U1, firstRows('/home/u/elsewhere'));   // a cwd that differs: nothing confirms
    for (let i = 0; i < 5; i++) spool(box.home, ID, start(ID, U1, 'clear', { gen: G1 }));
    SW.drainSpool(db, c); clock.ms += 1000;                           // the rename and observation
    c.firstRows = EP.newFirstRowCache();
    let opens = 0;
    await patchedFs({ openSync: (real) => (p, ...rest) => { if (String(p) === file) opens += 1; return real(p, ...rest); } }, () => {
      SW.drainSpool(db, c);                                           // 5 clear lines for one uuid
      clock.ms += 60_000;
      EP.confirmCandidates(db, c);                                    // and its waiting candidate
    });
    expect(candidatesOf(db).map((k) => k.cc_session_uuid)).toEqual([U1]);
    expect(opens).toBe(1);
  });

  it('RF5b F16 (D-4298 kept): a first-row read that fails is not remembered: the next lookup this tick reads again and confirms by location', async () => {
    const work = path.join(box.home, 'work', 'x'); fs.mkdirSync(work, { recursive: true });
    setReg(box, ID, 'uuid', U9); setReg(box, ID, 'generation', G1); setReg(box, ID, 'workdir', work);
    const file = transcriptIn(box.homes[0]!, 'x', U1, firstRows(work));
    spool(box.home, ID, start(ID, U1, 'clear', { gen: G1 }));
    spool(box.home, ID, start(ID, U1, 'clear', { gen: G1 }));
    SW.drainSpool(db, c); clock.ms += 1000;
    c.firstRows = EP.newFirstRowCache();
    const eio = Object.assign(new Error('EIO: i/o error, read'), { code: 'EIO', errno: -5, syscall: 'read' });
    let faulted = 0;
    await patchedFs({ readSync: (real) => (fd, ...rest) => {
      if (faulted === 0 && fs.readlinkSync(`/proc/self/fd/${String(fd)}`) === file) { faulted += 1; throw eio; }
      return real(fd, ...rest);
    } }, () => { SW.drainSpool(db, c); });
    expect(faulted, 'the fault never fired').toBe(1);
    expect(epochsOf(db, ID, G1)).toEqual([expect.objectContaining({ cc_session_uuid: U1, cause: 'clear', confirmed_ms: expect.any(Number) })]);
    expect(verdictsOf(box.home, ids.storeId).filter((v) => v['kind'] === 'epoch-confirmed'))
      .toEqual([expect.objectContaining({ cc_session_uuid: U1, by: 'location' })]);
  });

  it('RF5b F16: a walk that could not list a directory misses only that tick: the next tick\'s fresh walk confirms by location, nothing dropped or counted', async () => {
    const work = path.join(box.home, 'work', 'x'); fs.mkdirSync(work, { recursive: true });
    setReg(box, ID, 'uuid', U9); setReg(box, ID, 'generation', G1); setReg(box, ID, 'workdir', work);
    transcriptIn(box.homes[0]!, 'x', U1, firstRows(work));
    spool(box.home, ID, start(ID, U1, 'clear', { gen: G1 }));
    const ctx = tickCtx();
    await EP.tick(db, ctx);                                           // renames and observes
    clock.ms += 60_000;
    const eio = Object.assign(new Error('EIO'), { code: 'EIO', errno: -5, syscall: 'scandir' });
    let faulted = 0;
    const slugDir = `${box.homes[0]}/projects/x`;
    await patchedFs({ readdirSync: (real) => (p, ...rest) => {
      if (faulted === 0 && String(p) === slugDir) { faulted += 1; throw eio; }
      return real(p, ...rest);
    } }, async () => {
      await EP.tick(db, ctx);                                         // its walk skips projects/x: the clear epoch waits
      // FU4 M32: the fault HAS cost this tick the confirmation (it is no other walker's miss), so "misses only that tick" is
      // this case's own showing rather than a mutation's: U1's epoch exists, still unconfirmed, and nothing says "location" yet.
      expect(faulted, 'the fault fired in the second tick\'s walk').toBe(1);
      expect(epochsOf(db, ID, G1).filter((e) => e.cc_session_uuid === U1)).toEqual([expect.objectContaining({ cause: 'clear', confirmed_ms: null })]);
      clock.ms += 60_000;
      await EP.tick(db, ctx);                                         // a FRESH walk finds it
    });
    expect(faulted, 'the fault never fired').toBe(1);
    // the tick's registry scan also maps .uuid (U9) as an import epoch: only U1's clear epoch is under test
    expect(epochsOf(db, ID, G1).filter((e) => e.cc_session_uuid === U1)).toEqual([expect.objectContaining({ cause: 'clear', confirmed_ms: expect.any(Number) })]);
    expect(verdictsOf(box.home, ids.storeId).filter((v) => v['kind'] === 'epoch-confirmed' && v['cc_session_uuid'] === U1))
      .toEqual([expect.objectContaining({ by: 'location' })]);
    expect(counterOf(db, 'epoch_unconfirmed')).toBe(0);
    expect(candidatesOf(db)).toEqual([]);
  });
});

describe('the tick runs the epoch steps, as the box runs it (spec §9.2, §6.1 "Backfill")', () => {
  it('a first pass maps every $REG/<id>.uuid that names no epoch: a family and a registry mapping, journaled once', () => {
    const box = makeHistoryBox('ccrc-hist-backfill-', { role: 'fleet' });
    setReg(box, ID, 'uuid', U1); setReg(box, ID, 'generation', G1); setReg(box, ID, 'project', 'demo');
    const r = runSweep(box);
    expect(r.code, r.stderr).toBe(0);
    const ids = storeIds(box.home);
    expect(rowsOf(box, 'SELECT ccrc_id, generation, project FROM sessions')).toEqual([{ ccrc_id: ID, generation: G1, project: 'demo' }]);
    expect(rowsOf(box, 'SELECT cc_session_uuid, cause, declared_by FROM epochs')).toEqual([{ cc_session_uuid: U1, cause: 'import', declared_by: 'registry' }]);
    const kinds = (): unknown[] => verdictsOf(box.home, ids.storeId).map((v) => [v['kind'], v['event_key'], v['declared_by'] ?? null]);
    expect(kinds()).toEqual([['family', 'none', null], ['mapping', 'none', 'registry']]);
    expect(runSweep(box).code).toBe(0);
    expect(kinds()).toEqual([['family', 'none', null], ['mapping', 'none', 'registry']]);
  });

  it('a candidate is confirmed by a later scheduled pass once .uuid names it', () => {
    const box = makeHistoryBox('ccrc-hist-candidate-', { role: 'fleet' });
    expect(runSweep(box).code).toBe(0);                     // binds the store; its scan finds an empty registry
    setReg(box, ID, 'uuid', U9); setReg(box, ID, 'generation', G1);
    spool(box.home, ID, start(ID, U2, 'startup', { reg: U9 }));
    expect(runSweep(box).code).toBe(0);
    expect(runSweep(box).code).toBe(0);
    expect(rowsOf(box, 'SELECT cc_session_uuid FROM epoch_candidates')).toEqual([{ cc_session_uuid: U2 }]);
    setReg(box, ID, 'uuid', U2);
    expect(runSweep(box).code).toBe(0);
    expect(rowsOf(box, 'SELECT cc_session_uuid, cause FROM epochs')).toEqual([{ cc_session_uuid: U2, cause: 'startup' }]);
    expect(rowsOf(box, 'SELECT cc_session_uuid FROM epoch_candidates')).toEqual([]);
  });

  // D-4342 (history-epoch-causes-widened-for-rollback): B1 spools no fork, but a B2 box rolled back to B1 can
  // hold a fork candidate; its confirmation must journal a verdict the reader accepts, not throw on every tick.
  it("a fork candidate left by a rolled-back B2 build is confirmed, not a crash-looping pass (D-4342)", () => {
    const box = makeHistoryBox('ccrc-hist-forkcand-', { role: 'fleet' });
    expect(runSweep(box).code).toBe(0);
    const w = openWriter(historyPaths(box.home).dbFile);
    try {
      w.prepare("INSERT INTO epoch_candidates (cc_session_uuid, ccrc_id, generation, cause, ts_ms, first_seen_ms) VALUES (?, ?, ?, 'fork', NULL, ?)").run(U2, ID, G1, Date.now());
    } finally {
      closeWriter(w);
    }
    setReg(box, ID, 'uuid', U2); setReg(box, ID, 'generation', G1);
    const r = runSweep(box);
    expect(r.code, r.stderr).toBe(0);
    expect(rowsOf(box, 'SELECT cc_session_uuid, cause FROM epochs')).toEqual([{ cc_session_uuid: U2, cause: 'fork' }]);
    expect(rowsOf(box, 'SELECT cc_session_uuid FROM epoch_candidates')).toEqual([]);
  });
});

describe('a sidecar that cannot be written is the journal failure, held per file (FR2-a, D-4338)', () => {
  it('journalHalf holds EVERY file and reports journalFailed: no throw, the later file still tried; a repaired sidecar path journals both', () => {
    const box = makeHistoryBox('ccrc-hist-fr2a-half-', { role: 'fleet' });
    const ids = createStore(box.home);
    const ID2 = 'claude-b-demo';
    const names = [ID, ID2].map((id, i) => {
      fs.mkdirSync(DRAIN(box.home), { recursive: true, mode: 0o700 });
      const name = SW.drainingName(id, T + i, 4242);
      fs.writeFileSync(path.join(DRAIN(box.home), name), `\n${JSON.stringify(start(id, U1, 'startup'))}\n`);
      fs.mkdirSync(path.join(DRAIN(box.home), `${SW.sidecarName(name)}.tmp`));   // no sidecar can be written, on any attempt
      fs.writeFileSync(path.join(DRAIN(box.home), `${SW.sidecarName(name)}.tmp`, 'keep'), '');   // non-empty: removeEntry keeps it (D-4347 (history-planted-entries-never-wedge))
      return name;
    });
    const r = SW.journalHalf(box.home, ids, T);
    expect(r.journalFailed).toBe(true);
    expect([...r.held].sort()).toEqual([...names].sort());
    for (const n of names) fs.rmSync(path.join(DRAIN(box.home), `${SW.sidecarName(n)}.tmp`), { recursive: true });
    const again = SW.journalHalf(box.home, ids, T + 10);
    expect(again.journalFailed).toBe(false);
    expect(fileBlocks(journalOf(box.home, ids.storeId)).map((b) => b.name).sort()).toEqual([...names].sort());
  });
});
