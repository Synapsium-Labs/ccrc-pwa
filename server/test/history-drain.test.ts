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
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { makeHistoryBox, runSweep, skipOnDarwin, openStoreRO, counters, PRELOADS, SWEEP, type HistoryBox } from './historyHelpers.js';
import { createStore, openWriter, closeWriter } from '../../ccd/history/store.mjs';
import { journalRecord, historyPaths, eventKey, DRAINING_NAME_MAX } from '../../ccd/history/lib.mjs';

skipOnDarwin();

type Ids = { storeId: string; writer: string };
type TickCtx = {
  home: string; ids: Ids | null; now: () => number; homes: string[]; rosterUnreadable: boolean;
  out: (line: string) => void; hints?: string[];
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

// ── Task 16: the two-phase drain ────────────────────────────────────────────────────────────────────────
const ID = 'claude-a-demo';
const u = (n: number): string => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const U0 = u(0x10); const U1 = u(0x11); const U2 = u(0x12); const U3 = u(0x13); const U5 = u(0x15); const U9 = u(0x19);
const G1 = u(0xa1); const G2 = u(0xa2);
const SPOOL = (home: string): string => hist(home, 'spool');
const DRAIN = (home: string): string => hist(home, 'spool', '.draining');
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
    const r = runSweep(box, [], faults({ HISTORY_TEST_FAIL_COMMIT: '1' }));
    expect(r.code, r.stderr).toBe(0);
    expect(drainingNames(box.home)).toEqual([name]);
    expect(receipts(box)).toEqual([]);
    expect(counters(box)['drain_deferred']).toBe(1);
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
