// server/test/history-drain.test.ts
// The history sweep's journal, its two-phase spool drain and the epochs a drain declares (spec
// docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md §9.14, §9.2 step 1, §6.1). There are two ways
// in, the same two compact-card.test.ts uses to reach its helper:
//   - the sweep's own functions, imported in-process against a real store in a fixture HOME (exact clocks, no carrier);
//   - the sweep as the box runs it, a real `node --no-warnings` child, for the order of writes, the kills and the
//     exit codes.
// sweep.mjs ships no types. Its internals are reached through the one typed view `Sweep` below, never through `any`.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { makeHistoryBox, runSweep, skipOnDarwin, openStoreRO, PRELOADS, SWEEP, type HistoryBox } from './historyHelpers.js';
import { createStore, openWriter, closeWriter } from '../../ccd/history/store.mjs';
import { journalRecord, historyPaths } from '../../ccd/history/lib.mjs';

skipOnDarwin();

type Ids = { storeId: string; writer: string };
/** The slice of sweep.mjs these tests call. It grows task by task; every member is a real export. */
interface Sweep {
  JournalError: new (code: string, cause?: unknown) => Error & { code: string };
  monthOf(ms: number): string;
  journalFilePath(home: string, storeId: string, writer: string, month: string): string;
  appendJournal(home: string, ids: Ids, lines: readonly string[], nowMs: number): void;
  appendOutbox(db: DatabaseSync, home: string, ids: Ids, nowMs: number): { upto: number; count: number };
  deleteOutbox(db: DatabaseSync, uptoSeq: number): void;
  flushOutbox(db: DatabaseSync, home: string, ids: Ids, nowMs: number): number;
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
