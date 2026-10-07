// history-holds.test.ts — W1-B1 Task 24: what a pass does when it cannot, or must not, write
// (spec docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md §9.2 "The journal half",
// §9.3 the cap and the floor, §9.10, §9.14 "Holds", §6.11). Pins O8, O10, O19, O23, O37, O46, DM42.
//
// Every case runs the REAL ccd/history/sweep.mjs (or the run-pass driver that imports it) as a child on
// process.execPath, so the 22.16.0 CI leg runs it on 22.16.0, inside a fixture HOME from historyHelpers'
// makeHistoryBox: tmux, gh, ssh, scp, curl and the managers poisoned, the operator's ambient Claude Code
// and tmux env scrubbed. Free space is ALWAYS the statfs preload's answer, never this box's disk. A seam
// is a test-only preload or the driver's injected deps (D-4247, slug history-test-seams-not-env).
//
// Linux-only, like every sweep test (O24): the sweep ships no carrier on macOS.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { floorThreshold } from '../../ccd/history/lib.mjs';
import {
  makeHistoryBox, runSweep, runDriver, preloadOptions, plantSession, plantTranscript, spoolLine, openStoreRO, counters,
  journalRecords, PRELOADS, SWEEP, type HistoryBox,
} from './historyHelpers.js';

beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });

const ID = 'claude-a-demo';
const G1 = '0189abcd-1234-4678-9abc-0123456789ab';
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const SLUG = '-home-u-tree-demo';
const GiB = 1024 ** 3;
const FS_BYTES = 10 * GiB;                       // the fixture filesystem the statfs seam describes
const THRESHOLD = floorThreshold(FS_BYTES);      // lib's own formula, never retyped here
const V2 = 'CREATE TABLE seam_v2 (x INTEGER)';
const V3 = 'CREATE TABLE seam_v3 (x INTEGER)';
const MIN = 60_000;

interface Paths {
  root: string; dbDir: string; db: string; backups: string; spool: string; draining: string;
  journal: string; storeId: string; writer: string; cap: string;
}
function paths(box: HistoryBox): Paths {
  const root = path.join(box.home, '.ccrc', 'history');
  return {
    root, dbDir: path.join(root, 'db'), db: path.join(root, 'db', 'history.db'),
    backups: path.join(root, 'db', 'backups'), spool: path.join(root, 'spool'),
    draining: path.join(root, 'spool', '.draining'), journal: path.join(root, 'journal'),
    storeId: path.join(root, 'store.id'), writer: path.join(root, 'store.writer'),
    cap: path.join(box.home, '.ccrc', 'history-max-gb'),
  };
}
function names(dir: string): string[] { try { return fs.readdirSync(dir).sort(); } catch { return []; } }
function walk(dir: string): { dirs: string[]; files: string[] } {
  const out = { dirs: [dir], files: [] as string[] };
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const w = walk(p); out.dirs.push(...w.dirs); out.files.push(...w.files); } else if (e.isFile()) out.files.push(p);
  }
  return out;
}
const mode = (f: string): number => fs.statSync(f).mode & 0o777;
function q<T>(box: HistoryBox, sql: string, ...args: (string | number)[]): T[] {
  const db = openStoreRO(box);
  try { return db.prepare(sql).all(...args) as T[]; } finally { db.close(); }
}
const metaOf = (box: HistoryBox, k: string): string | null => q<{ v: string }>(box, 'SELECT v FROM meta WHERE k = ?', k)[0]?.v ?? null;
const countOf = (box: HistoryBox, table: string): number => q<{ n: number }>(box, `SELECT count(*) AS n FROM ${table}`)[0]!.n;
const versionOf = (file: string): number => {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version; } finally { db.close(); }
};
const counter = (box: HistoryBox, name: string): number => counters(box)[name] ?? 0;
const draining = (box: HistoryBox): string[] => names(paths(box).draining).filter((n) => n.endsWith('.jsonl'));
type Rec = { k: string; [x: string]: unknown };
const recs = (box: HistoryBox): Rec[] => journalRecords(box) as Rec[];
const spoolRecs = (box: HistoryBox): Rec[] => recs(box).filter((r) => r.k === 'spool');
const epochsOf = (box: HistoryBox): { cc_session_uuid: string; cause: string; seq: number }[] =>
  q(box, 'SELECT e.cc_session_uuid, e.cause, e.seq FROM epochs e JOIN sessions s ON s.session_pk = e.session_pk WHERE s.ccrc_id = ? ORDER BY e.seq', ID);
const userRow = (uuid: string, text: string, ts: string) => ({
  type: 'user', uuid, parentUuid: null, sessionId: U1, cwd: '/home/u/tree/demo', timestamp: ts,
  message: { role: 'user', content: text },
});
const startup = (sid: string, extra: Record<string, unknown> = {}) => ({ v: 1, ev: 'SessionStart', id: ID, sid, src: 'startup', gen: G1, ...extra });
const clearLine = (sid: string) => ({ v: 1, ev: 'SessionStart', id: ID, sid, src: 'clear', gen: G1 });

/** A bound store: one plain scheduled pass on a fleet box creates it (§6.2). */
function boundBox(prefix: string): HistoryBox {
  const box = makeHistoryBox(prefix, { role: 'fleet', shim: true });
  const r = runSweep(box);
  expect(r.code, r.stderr).toBe(0);
  expect(fs.existsSync(paths(box).db)).toBe(true);
  return box;
}

describe('O8: modes under an inherited umask 0002', () => {
  it('the DB, its -wal and -shm and every journal file are 0600, every directory 0700, a draining spool file 0600', () => {
    const box = makeHistoryBox('ccrc-hist-o8-', { role: 'fleet', shim: true });
    const p = paths(box);
    // A shell with umask 0002 in front of the sweep, as a hand run or a carrier with no UMask= gives it.
    const umasked = (): void => {
      const r = spawnSync('/bin/sh', ['-c', 'umask 0002; exec "$@"', 'sh', process.execPath, '--no-warnings', SWEEP, '--secrets', '--', ...box.homes], {
        cwd: box.home, encoding: 'utf8',
        env: { ...box.env, HISTORY_TEST_STATFS: 'plenty', NODE_OPTIONS: preloadOptions([PRELOADS.statfs]) },
      });
      expect(r.status, r.stderr).toBe(0);
    };
    umasked();                                                     // creates the store
    expect(fs.existsSync(p.spool), 'the sweep makes the spool directory the hook appends into').toBe(true);
    const spoolFile = path.join(p.spool, `${ID}.jsonl`);
    fs.writeFileSync(spoolFile, `\n${JSON.stringify(startup(U1, { reg: U1 }))}\n`);
    fs.chmodSync(spoolFile, 0o664);                                // what the hook leaves under umask 0002
    // A reader held open keeps the WAL pair on disk past the writer's close, so their modes are measured.
    const ro = new DatabaseSync(p.db, { readOnly: true });
    ro.prepare('SELECT count(*) AS n FROM meta').get();
    try {
      umasked();                                                   // renames the spool file into .draining/
      expect(mode(p.db)).toBe(0o600);
      for (const f of [`${p.db}-wal`, `${p.db}-shm`]) {
        expect(fs.existsSync(f), f).toBe(true);
        expect(mode(f), f).toBe(0o600);
      }
      const tree = walk(p.root);
      expect(tree.dirs.length, 'root, db, spool, spool/.draining, journal and journal/<store_id> at least').toBeGreaterThanOrEqual(6);
      for (const d of tree.dirs) expect(mode(d), d).toBe(0o700);
      const journalFiles = walk(p.journal).files;
      expect(journalFiles.length).toBeGreaterThan(0);
      for (const f of journalFiles) expect(mode(f), f).toBe(0o600);
      expect(draining(box)).toHaveLength(1);
      for (const f of walk(p.draining).files) expect(mode(f), f).toBe(0o600);
    } finally { ro.close(); }
  });
});

describe('O23: mode drift', () => {
  it('a store file chmodded 0644 is restored to 0600 and counted mode_drift; a directory is left for doctor', () => {
    const box = boundBox('ccrc-hist-o23-');
    const p = paths(box);
    const journalFile = walk(p.journal).files[0]!;
    fs.chmodSync(p.db, 0o644);
    fs.chmodSync(journalFile, 0o644);
    fs.chmodSync(p.dbDir, 0o755);
    const before = counter(box, 'mode_drift');
    expect(runSweep(box).code).toBe(0);
    expect(mode(p.db)).toBe(0o600);
    expect(mode(journalFile)).toBe(0o600);
    // Four, not two: SQLite creates -wal and -shm with the DB file's own mode, whatever the umask, so the
    // read-only opens before fixModes (this test's counters() call, the pass's peeks) and the writer's open
    // leave them 0644 beside the 0644 DB (measured on Node 24 and 22.16.0). Their modes are not asserted
    // after the pass: the last close removes them, and the next open recreates them from the DB's mode.
    expect(counter(box, 'mode_drift') - before, 'the DB, its -wal and -shm, and the journal file').toBe(4);
    expect(mode(p.dbDir), 'a directory is doctor\'s to name (§9.3), never chmodded by the pass').toBe(0o755);
    fs.chmodSync(p.dbDir, 0o700);
  });
});

describe('O10: the cap pauses ingest, never the drain', () => {
  it('at the cap cursors hold and capture_paused_at_cap counts; a spool file is still journaled, drained, unlinked and its startup line confirmed', () => {
    const box = boundBox('ccrc-hist-o10-');
    const p = paths(box);
    fs.writeFileSync(p.cap, '1\n');
    // Planted WITH its uuid, so tick N's hint names U1 through $REG/<id>.uuid. Without it no tick could find
    // the transcript, paused or not: boundBox's pass already ran the discovery scan, these ticks fall inside
    // SCAN_INTERVAL_MS, and tick N+1's drain empties .draining/ before candidateFiles reads it. The
    // `entries` assertion below would then hold vacuously, and Step 8's mutant would stay green.
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });
    plantTranscript(box, 'claude-a', SLUG, U1, [userRow('a0000000-0000-4000-8000-000000000001', 'first words', new Date().toISOString())]);
    spoolLine(box, ID, startup(U1, { reg: U1 }));
    const atCap = { sizeBytes: 2 * GiB };                         // over a 1 GB cap, whatever the unit
    expect(runDriver(box, atCap).code).toBe(0);                    // tick N: rename and observe
    expect(draining(box)).toHaveLength(1);
    expect(runDriver(box, atCap).code).toBe(0);                    // tick N+1: journal, drain, unlink
    expect(draining(box)).toEqual([]);
    expect(countOf(box, 'spool_receipts')).toBe(1);
    expect(epochsOf(box)).toEqual([{ cc_session_uuid: U1, cause: 'startup', seq: 1 }]);
    expect(spoolRecs(box).length).toBe(1);
    expect(countOf(box, 'entries'), 'ingest paused: no cursor moved').toBe(0);
    expect(countOf(box, 'ingest_files')).toBe(0);
    expect(counter(box, 'capture_paused_at_cap')).toBeGreaterThanOrEqual(2);
    expect(metaOf(box, 'capture_pause')).toBe('at-cap');
    // The pause lifts with the size; the file is read from its start, so nothing was lost meanwhile.
    expect(runDriver(box, { offsetMs: 31 * MIN }).code).toBe(0);
    expect(countOf(box, 'entries')).toBe(1);
    expect(metaOf(box, 'capture_pause')).toBe('');
  });
});

describe('O19: the free-space floor pauses ingest, never the drain', () => {
  it('below the floor: exit 0, capture_paused_low_disk, no cursor advance, and the spool file is still journaled, committed and unlinked', () => {
    const box = boundBox('ccrc-hist-o19-');
    // With its uuid, as in O10, so the transcript is ingestible and `entries` can see an ingest. Two guards
    // stop it here: the pass's low-disk pause (ctx.ingest false) and Task 19's per-chunk floor probe (BK17),
    // which answers low-disk too. Step 8 measures each.
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });
    plantTranscript(box, 'claude-a', SLUG, U1, [userRow('a0000000-0000-4000-8000-000000000002', 'more words', new Date().toISOString())]);
    spoolLine(box, ID, startup(U1, { reg: U1 }));
    const low = { env: { HISTORY_TEST_STATFS: `${THRESHOLD - 4096}:${FS_BYTES}` } };
    const a = runSweep(box, [], low);
    expect(a.code, a.stderr).toBe(0);
    const b = runSweep(box, [], low);
    expect(b.code, b.stderr).toBe(0);
    expect(draining(box)).toEqual([]);
    expect(countOf(box, 'spool_receipts')).toBe(1);
    expect(spoolRecs(box).length).toBe(1);
    expect(countOf(box, 'entries'), 'ingest paused: no cursor moved').toBe(0);
    expect(counter(box, 'capture_paused_low_disk')).toBeGreaterThanOrEqual(2);
    expect(metaOf(box, 'capture_pause')).toBe('low-disk');
  });
});

describe('O37: a journal failure is loud and holds', () => {
  it('the journal directory unwritable: the draining file stays, no drain transaction, journal_write_failed counts, ingest continues; restored, it drains', (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();                     // root ignores the mode this case relies on
    const box = boundBox('ccrc-hist-o37a-');
    const p = paths(box);
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });
    const transcript = plantTranscript(box, 'claude-a', SLUG, U1, [userRow('a0000000-0000-4000-8000-000000000003', 'row one', new Date().toISOString())]);
    expect(runDriver(box, { offsetMs: 31 * MIN }).code).toBe(0);  // the periodic scan maps and ingests it
    expect(countOf(box, 'entries')).toBe(1);
    spoolLine(box, ID, startup(U1, { reg: U1 }));
    expect(runDriver(box, { offsetMs: 32 * MIN }).code).toBe(0);  // renamed, observed
    expect(draining(box)).toHaveLength(1);
    // Break the journal: its files moved aside, its directory made unwritable, so no month file can be made.
    const storeDir = path.join(p.journal, fs.readFileSync(p.storeId, 'utf8').trim());
    const aside = path.join(box.home, 'journal-aside');
    fs.mkdirSync(aside);
    for (const n of names(storeDir)) fs.renameSync(path.join(storeDir, n), path.join(aside, n));
    fs.chmodSync(storeDir, 0o500);
    fs.appendFileSync(transcript, `${JSON.stringify(userRow('a0000000-0000-4000-8000-000000000004', 'row two', new Date().toISOString()))}\n`);
    try {
      const r = runDriver(box, { offsetMs: 63 * MIN });
      expect(r.code, r.stderr).toBe(0);
      expect(draining(box), 'held, never unlinked unjournaled').toHaveLength(1);
      expect(countOf(box, 'spool_receipts'), 'no drain transaction').toBe(0);
      expect(counter(box, 'journal_write_failed')).toBeGreaterThanOrEqual(1);
      expect(metaOf(box, 'journal_unwritable')).toMatch(/^[0-9]+$/);
      expect(countOf(box, 'entries'), 'ingest is unaffected by the journal').toBe(2);
    } finally {
      fs.chmodSync(storeDir, 0o700);
      for (const n of names(aside)) fs.renameSync(path.join(aside, n), path.join(storeDir, n));
    }
    expect(runDriver(box, { offsetMs: 64 * MIN }).code).toBe(0);
    expect(draining(box)).toEqual([]);
    expect(countOf(box, 'spool_receipts')).toBe(1);
    expect(metaOf(box, 'journal_unwritable')).toBe('');
  });

  it('an ENOSPC half record: the file stays; the retry writes the record whole after a newline, earlier lines intact, and unlinks only after', () => {
    const box = boundBox('ccrc-hist-o37b-');
    spoolLine(box, ID, startup(U1, { reg: U1 }));
    expect(runSweep(box).code).toBe(0);                             // renamed
    const storeDir = path.join(paths(box).journal, fs.readFileSync(paths(box).storeId, 'utf8').trim());
    const monthFile = (): string => path.join(storeDir, names(storeDir).find((n) => n.endsWith('.jsonl'))!);
    const before = fs.readFileSync(monthFile(), 'utf8');
    const full = runSweep(box, [], { preloads: [PRELOADS.statfs, PRELOADS.faults], env: { HISTORY_TEST_ENOSPC: '/history/journal/' } });
    expect(full.code, full.stderr).toBe(0);
    expect(draining(box), 'not unlinked while its records are torn').toHaveLength(1);
    expect(countOf(box, 'spool_receipts')).toBe(0);
    const torn = fs.readFileSync(monthFile(), 'utf8');
    // The seam fails the FIRST journal write only. Later in the same tick recordTick (Task 20) appends its
    // `tick` record, and appendJournal fences the torn tail with a newline first (§9.14 "A torn last line"),
    // so the file ends in '\n' and the torn half sits on a line of its own.
    const added = torn.slice(before.length).split('\n').filter((l) => l !== '');
    expect(added.some((l) => { try { JSON.parse(l); return false; } catch { return true; } }), 'the seam left a torn record').toBe(true);
    expect(runSweep(box).code).toBe(0);                             // space is back
    const after = fs.readFileSync(monthFile(), 'utf8');
    expect(after.startsWith(before), 'every line written before the failure is intact').toBe(true);
    const lines = after.split('\n').filter((l) => l !== '');
    const unparsed = lines.filter((l) => { try { JSON.parse(l); return false; } catch { return true; } });
    expect(unparsed.length, 'the torn half stays one malformed line').toBeGreaterThanOrEqual(1);
    expect(spoolRecs(box).some((r) => (r['rec'] as { sid?: string }).sid === U1), 'the retried record is whole').toBe(true);
    expect(draining(box)).toEqual([]);
    expect(countOf(box, 'spool_receipts')).toBe(1);
  });

  it('under a migration hold the DB is open, so a failed journal half is counted and recorded, not only printed', (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();                     // root ignores the mode this case relies on
    const box = boundBox('ccrc-hist-o37c-');
    const p = paths(box);
    spoolLine(box, ID, startup(U1, { reg: U1 }));
    const storeDir = path.join(p.journal, fs.readFileSync(p.storeId, 'utf8').trim());
    const aside = path.join(box.home, 'journal-aside');
    fs.mkdirSync(aside);
    for (const n of names(storeDir)) fs.renameSync(path.join(storeDir, n), path.join(aside, n));
    fs.chmodSync(storeDir, 0o500);
    const before = counter(box, 'journal_write_failed');
    try {
      const r = runDriver(box, { extraMigrations: [V2] }, [], { env: { HISTORY_TEST_STATFS: `${THRESHOLD}:${FS_BYTES}` } });
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toMatch(/^history-sweep: migration-refused$/m);
      expect(r.stdout).toMatch(/^history-sweep: journal-unwritable$/m);
      expect(draining(box), 'held, never unlinked unjournaled').toHaveLength(1);
    } finally {
      fs.chmodSync(storeDir, 0o700);
      for (const n of names(aside)) fs.renameSync(path.join(aside, n), path.join(storeDir, n));
    }
    expect(counter(box, 'journal_write_failed') - before, 'counted on the open DB (§9.10 "Journal append")').toBe(1);
    expect(metaOf(box, 'journal_unwritable')).toMatch(/^[0-9]+$/);
  });
});

describe('O46: a hold keeps epochs', () => {
  it('a refused migration holds the drain; a startup line held across a /clear chains before the clear once unpaused, journaled once', () => {
    const box = boundBox('ccrc-hist-o46-');
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });
    spoolLine(box, ID, startup(U1));                                // no reg: only the observation can confirm it
    const refused = { extraMigrations: [V2] };
    const lowRoom = { env: { HISTORY_TEST_STATFS: `${THRESHOLD}:${FS_BYTES}` } };
    const h1 = runDriver(box, refused, [], lowRoom);
    expect(h1.code, h1.stderr).toBe(0);
    expect(h1.stdout).toMatch(/^history-sweep: migration-refused$/m);
    expect(draining(box)).toHaveLength(1);
    expect(spoolRecs(box).length, 'journaled at the hold, from its sidecar').toBe(1);
    plantSession(box, ID, { uuid: U2, generation: G1, project: 'demo' });   // the pane /clears to U2
    spoolLine(box, ID, clearLine(U2));
    for (let i = 0; i < 6; i += 1) expect(runDriver(box, refused, [], lowRoom).code).toBe(0);
    expect(draining(box)).toHaveLength(2);
    expect(spoolRecs(box).length, 'a held file is journaled once, never again per tick').toBe(2);
    expect(countOf(box, 'spool_receipts')).toBe(0);
    expect(counter(box, 'migration_refused_low_disk')).toBeGreaterThanOrEqual(7);
    expect(metaOf(box, 'migration')).toBe('refuse-low-disk');
    // Unpaused: this build's schema, room to spare.
    expect(runSweep(box).code).toBe(0);
    expect(draining(box)).toEqual([]);
    expect(epochsOf(box)).toEqual([
      { cc_session_uuid: U1, cause: 'startup', seq: 1 },
      { cc_session_uuid: U2, cause: 'clear', seq: 2 },
    ]);
    expect(q<{ n: number }>(box, 'SELECT count(*) AS n FROM sessions WHERE ccrc_id = ?', ID)[0]!.n).toBe(1);
  });

  it('under store-missing the held file is journaled into journal/<store_id>/<month>.<token>.jsonl, the token read from store.writer with no DB', () => {
    const box = boundBox('ccrc-hist-o46b-');
    const p = paths(box);
    const storeId = fs.readFileSync(p.storeId, 'utf8').trim();
    const token = fs.readFileSync(p.writer, 'utf8').trim();
    for (const f of [p.db, `${p.db}-wal`, `${p.db}-shm`]) fs.rmSync(f, { force: true });
    spoolLine(box, ID, startup(U1, { reg: U1 }));
    const r = runSweep(box);
    expect(r.code, 'store-missing is a refusal, exit 5').toBe(5);
    expect(r.stdout).toMatch(/^history-sweep: store-missing$/m);
    expect(fs.existsSync(p.db), 'nothing created').toBe(false);
    const own = names(path.join(p.journal, storeId)).filter((n) => n.endsWith(`.${token}.jsonl`));
    expect(own).toHaveLength(1);
    const text = fs.readFileSync(path.join(p.journal, storeId, own[0]!), 'utf8');
    expect(text).toMatch(/"k":"spool"/);
    expect(draining(box)).toHaveLength(1);
  });

  it('under an unsettled statfs the pass ends inside the deadline, opens no DB, prints store-unreachable and still journals', () => {
    const box = boundBox('ccrc-hist-o46c-');
    const p = paths(box);
    const token = fs.readFileSync(p.writer, 'utf8').trim();
    const dbMtime = fs.statSync(p.db).mtimeMs;
    spoolLine(box, ID, startup(U1, { reg: U1 }));
    const t0 = Date.now();
    const r = runSweep(box, [], { env: { HISTORY_TEST_STATFS: 'hang' } });
    expect(Date.now() - t0, 'STATFS_DEADLINE_MS is 5 s; the child must not wait on the probe').toBeLessThan(15_000);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^history-sweep: store-unreachable$/m);
    expect(fs.statSync(p.db).mtimeMs).toBe(dbMtime);
    expect(walk(p.journal).files.some((f) => f.endsWith(`.${token}.jsonl`) && /"k":"spool"/.test(fs.readFileSync(f, 'utf8')))).toBe(true);
  }, 30_000);

  it('with store.writer absent only the observation runs: the sidecar is written, no record journaled', () => {
    const box = boundBox('ccrc-hist-o46d-');
    const p = paths(box);
    fs.rmSync(p.writer);
    spoolLine(box, ID, startup(U1, { reg: U1 }));
    const r = runSweep(box);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^history-sweep: held$/m);
    expect(draining(box)).toHaveLength(1);
    expect(names(p.draining).some((n) => n.endsWith('.obs')), 'observed at the rename').toBe(true);
    expect(spoolRecs(box)).toEqual([]);
  });
});

describe('DM42: no migration without a snapshot', () => {
  it('v1 -> v2: backups/pre-v2.db opens at user_version 1 with the same store_id, the live store reads 2, and the pass did nothing else', () => {
    const box = boundBox('ccrc-hist-dm42a-');
    const p = paths(box);
    spoolLine(box, ID, startup(U1, { reg: U1 }));
    const r = runDriver(box, { extraMigrations: [V2] });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^history-sweep: migrated$/m);
    const pre = path.join(p.backups, 'pre-v2.db');
    expect(fs.existsSync(pre)).toBe(true);
    expect(versionOf(pre)).toBe(1);
    const snap = new DatabaseSync(pre, { readOnly: true });
    try {
      expect((snap.prepare("SELECT v FROM meta WHERE k = 'store_id'").get() as { v: string }).v).toBe(fs.readFileSync(p.storeId, 'utf8').trim());
    } finally { snap.close(); }
    expect(versionOf(p.db)).toBe(2);
    expect(countOf(box, 'spool_receipts'), 'a pass that migrates does nothing else but the journal half').toBe(0);
    expect(draining(box)).toHaveLength(1);
    expect(spoolRecs(box).length).toBe(1);
  });

  it('a VACUUM INTO killed mid-copy leaves only the .tmp and the attempt marker at user_version 1; the next tick removes the .tmp first and migrates', () => {
    const box = boundBox('ccrc-hist-dm42b-');
    const p = paths(box);
    const killed = runDriver(box, { extraMigrations: [V2] }, [], {
      preloads: [PRELOADS.statfs, PRELOADS.faults], env: { HISTORY_TEST_KILL_SQL: 'VACUUM INTO' },
    });
    expect(killed.signal).toBe('SIGKILL');
    expect(names(p.backups)).toEqual(['.pre-v2.attempt', '.pre-v2.db.tmp']);
    expect(versionOf(p.db)).toBe(1);
    const retry = runDriver(box, { extraMigrations: [V2] });
    expect(retry.code, retry.stderr).toBe(0);                    // a fresh VACUUM INTO refuses an existing file
    expect(names(p.backups)).toEqual(['pre-v2.db']);
    expect(versionOf(p.db)).toBe(2);
  });

  it('v2 -> v3 keeps only pre-v3.db, and an operator <ts>.db is never touched', () => {
    const box = boundBox('ccrc-hist-dm42c-');
    const p = paths(box);
    expect(runDriver(box, { extraMigrations: [V2] }).code).toBe(0);
    const ts = path.join(p.backups, '20261005T000000Z.db');
    fs.writeFileSync(ts, 'an operator backup, bytes the writer must not touch');
    expect(runDriver(box, { extraMigrations: [V2, V3] }).code).toBe(0);
    expect(names(p.backups)).toEqual(['20261005T000000Z.db', 'pre-v3.db']);
    expect(fs.readFileSync(ts, 'utf8')).toBe('an operator backup, bytes the writer must not touch');
    expect(versionOf(p.db)).toBe(3);
  });

  it('refuse-low-disk: no file, no migration, no cursor advance, no drain transaction, the spool file journaled once and held', () => {
    const box = boundBox('ccrc-hist-dm42d-');
    const p = paths(box);
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });
    plantTranscript(box, 'claude-a', SLUG, U1, [userRow('a0000000-0000-4000-8000-000000000005', 'held words', new Date().toISOString())]);
    spoolLine(box, ID, startup(U1, { reg: U1 }));
    const lowRoom = { env: { HISTORY_TEST_STATFS: `${THRESHOLD}:${FS_BYTES}` } };
    for (const offsetMs of [31 * MIN, 62 * MIN]) {
      const r = runDriver(box, { extraMigrations: [V2], offsetMs }, [], lowRoom);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toMatch(/^history-sweep: migration-refused$/m);
    }
    expect(names(p.backups).filter((n) => n.startsWith('pre-v') || n.startsWith('.pre-v'))).toEqual([]);
    expect(versionOf(p.db)).toBe(1);
    expect(countOf(box, 'entries')).toBe(0);
    expect(countOf(box, 'spool_receipts')).toBe(0);
    expect(draining(box)).toHaveLength(1);
    expect(spoolRecs(box).length).toBe(1);
    expect(counter(box, 'migration_refused_low_disk')).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------------------
// D-4242 (history-fts-backfill-pauses-with-ingest): the FTS backfill grows db/, so it is held with ingest. The
// tick's guard is `if (ctx.ingest && !(ing !== null && ing.paused)) deriveFts(...)`; each half has a pin here,
// measured red with that half deleted. What still runs under the pause is pinned beside it: a late pair's
// re-index and its merge step (§9.2: only ingest pauses).
// ---------------------------------------------------------------------------------------------------------
describe('D-4242: a pending FTS backfill waits for the pause to lift; a late pair still re-indexes and merges', () => {
  const ROW_A = 'a0000000-0000-4000-8000-0000000000a1';
  const ROW_B = 'a0000000-0000-4000-8000-0000000000b2';
  const ROW_C = 'a0000000-0000-4000-8000-0000000000c3';
  const tag = (n: number): string => `zq${String(n).repeat(3)}-${'0123456789abcdef'.repeat(2)}_${'fedcba9876543210'.repeat(2)}`;
  const probeThrow = { preloads: [PRELOADS.statfs, PRELOADS.faults], env: { HISTORY_TEST_FTS_PROBE: 'throw' } };
  const hint = (box: HistoryBox): void => { spoolLine(box, ID, { v: 1, ev: 'Stop', id: ID }); };
  const matchCount = (box: HistoryBox, phrase: string): number =>
    q<{ n: number }>(box, 'SELECT count(*) AS n FROM blobs_fts WHERE blobs_fts MATCH ?', phrase)[0]!.n;
  const unindexed = (box: HistoryBox): number => q<{ n: number }>(box, 'SELECT count(*) AS n FROM blobs WHERE fts_indexed = 0')[0]!.n;
  const stepDone = (box: HistoryBox, step: string): boolean =>
    q<{ c: number | null }>(box, 'SELECT completed_ms AS c FROM derivation_state WHERE step = ? AND version = 1', step)[0]?.c != null;
  const secret = (box: HistoryBox, value: string): void => {
    fs.mkdirSync(path.join(box.home, '.cc-secrets'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(box.home, '.cc-secrets', 'late.env'), `ZQ_LATE_VALUE=${value}\n`, { mode: 0o600 });
  };
  /** A store whose row A (holding `value`) is indexed in clear, and whose row B is captured but unindexed behind a
   *  re-opened ('fts', 1) backfill; the pair for `value` is not known yet. Returns the transcript for later appends. */
  function pendingBox(prefix: string, value: string): { box: HistoryBox; transcript: string } {
    const box = boundBox(prefix);
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });
    const now = new Date().toISOString();
    const transcript = plantTranscript(box, 'claude-a', SLUG, U1, [userRow(ROW_A, `note ${value} end`, now)]);
    spoolLine(box, ID, startup(U1, { reg: U1 }));
    for (const offsetMs of [31 * MIN, 62 * MIN]) expect(runDriver(box, { offsetMs }).code).toBe(0);
    expect(countOf(box, 'entries')).toBe(1);
    expect(stepDone(box, 'fts')).toBe(true);                           // CONTROL: A is indexed and the backfill completed
    expect(matchCount(box, '"note"')).toBe(1);
    fs.appendFileSync(transcript, `${JSON.stringify({ ...userRow(ROW_B, 'zqbeta words', now), parentUuid: ROW_A })}\n`);
    hint(box);
    const r = runSweep(box, [], probeThrow);                           // B is captured while the probe fails: not indexed
    expect(r.code, r.stderr).toBe(0);
    expect(countOf(box, 'entries')).toBe(2);
    expect(unindexed(box)).toBe(1);
    expect(stepDone(box, 'fts')).toBe(false);                          // the completed backfill re-opened
    return { box, transcript };
  }
  const lateValueGone = (box: HistoryBox, value: string): void => {
    const tail = value.slice(value.indexOf('_') + 1);
    expect(matchCount(box, `"${tail.slice(0, 8)}"*`)).toBe(0);         // the late pair's re-index ran
    expect(matchCount(box, '"note"')).toBe(1);                         // A is still indexed, redacted
    expect(stepDone(box, 'fts-merge')).toBe(true);                     // and its merge step completed
  };

  it('below the free-space floor (the pass-level pause): the backfill leaves B unindexed; the re-index and merge steps still run; lifted, it indexes', () => {
    const value = tag(1);
    const { box } = pendingBox('ccrc-hist-d4242a-', value);
    expect(matchCount(box, `"${value.slice(value.indexOf('_') + 1).slice(0, 8)}"*`)).toBe(1);   // CONTROL: the late value is in the index in clear
    secret(box, value);
    const low = { env: { HISTORY_TEST_STATFS: `${THRESHOLD - 4096}:${FS_BYTES}` } };
    const r = runSweep(box, [], low);
    expect(r.code, r.stderr).toBe(0);
    expect(counter(box, 'capture_paused_low_disk')).toBeGreaterThanOrEqual(1);
    expect(unindexed(box)).toBe(1);                                    // fts_indexed stays 0 for B
    expect(stepDone(box, 'fts')).toBe(false);
    lateValueGone(box, value);
    const ok = runSweep(box);
    expect(ok.code, ok.stderr).toBe(0);
    expect(unindexed(box)).toBe(0);                                    // CONTROL: the pause was the only thing holding B back
    expect(stepDone(box, 'fts')).toBe(true);
  });

  it('over the cap (the pass-level pause): the backfill leaves B unindexed; the re-index and merge steps still run', () => {
    const value = tag(2);
    const { box } = pendingBox('ccrc-hist-d4242b-', value);
    secret(box, value);
    fs.writeFileSync(paths(box).cap, '1\n');
    const r = runDriver(box, { sizeBytes: 2 * GiB });
    expect(r.code, r.stderr).toBe(0);
    expect(counter(box, 'capture_paused_at_cap')).toBeGreaterThanOrEqual(1);
    expect(unindexed(box)).toBe(1);
    expect(stepDone(box, 'fts')).toBe(false);
    lateValueGone(box, value);
    fs.unlinkSync(paths(box).cap);
    expect(runDriver(box, { sizeBytes: 0 }).code).toBe(0);
    expect(unindexed(box)).toBe(0);
  });

  it('the per-chunk floor stopping this run\'s ingest (the pass started with room): the backfill is held with it', () => {
    const value = tag(3);
    const { box, transcript } = pendingBox('ccrc-hist-d4242c-', value);
    secret(box, value);
    fs.appendFileSync(transcript, `${JSON.stringify({ ...userRow(ROW_C, 'zqgamma words', new Date().toISOString()), parentUuid: ROW_B })}\n`);
    hint(box);
    // The pass-level probe answers plenty (ingest is on); every per-chunk probe after it answers below the floor.
    const r = runSweep(box, [], { env: { HISTORY_TEST_STATFS_AFTER: `1:${THRESHOLD - 4096}:${FS_BYTES}` } });
    expect(r.code, r.stderr).toBe(0);
    expect(countOf(box, 'entries'), 'the chunk was refused: C is not captured').toBe(2);
    expect(unindexed(box)).toBe(1);
    expect(stepDone(box, 'fts')).toBe(false);
    lateValueGone(box, value);
  });
});

describe('FR2-a (D-4338): a failed sidecar write is the journal hold, never a failed pass', () => {
  // The observation sidecar lives on the home filesystem beside the journal, and the drain writes it BEFORE the
  // journal append (§9.2), so a full home filesystem fails it first. HISTORY_TEST_ENOSPC='/.draining/' fails the
  // FIRST write under .draining/ (a sidecar's temp), the smallest seam that reaches it.
  const ENOSPC = { preloads: [PRELOADS.faults], env: { HISTORY_TEST_ENOSPC: '/.draining/' } };

  it('a scheduled pass: the file renamed on the previous pass stays held, journal_write_failed counts, ingest continues, the next tick drains it', () => {
    const box = boundBox('ccrc-hist-fr2a1-');
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });
    const transcript = plantTranscript(box, 'claude-a', SLUG, U1, [userRow('a0000000-0000-4000-8000-000000000003', 'row one', new Date().toISOString())]);
    expect(runDriver(box, { offsetMs: 31 * MIN }).code).toBe(0);
    expect(countOf(box, 'entries')).toBe(1);
    spoolLine(box, ID, startup(U1, { reg: U1 }));
    expect(runDriver(box, { offsetMs: 32 * MIN }).code).toBe(0);    // renamed and observed
    expect(draining(box)).toHaveLength(1);
    fs.appendFileSync(transcript, `${JSON.stringify(userRow('a0000000-0000-4000-8000-000000000004', 'row two', new Date().toISOString()))}\n`);
    const r = runDriver(box, { offsetMs: 63 * MIN }, [], ENOSPC);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).not.toMatch(/internal error/);
    expect(draining(box), 'held, never unlinked').toHaveLength(1);
    expect(countOf(box, 'spool_receipts'), 'no drain transaction').toBe(0);
    expect(counter(box, 'journal_write_failed')).toBeGreaterThanOrEqual(1);
    expect(metaOf(box, 'journal_unwritable')).toMatch(/^[0-9]+$/);
    expect(countOf(box, 'entries'), 'ingest is unaffected by the sidecar').toBe(2);
    expect(runDriver(box, { offsetMs: 64 * MIN }).code).toBe(0);
    expect(draining(box)).toEqual([]);
    expect(countOf(box, 'spool_receipts')).toBe(1);
    expect(metaOf(box, 'journal_unwritable')).toBe('');
  });

  it('a scheduled pass: the observation at the rename failing leaves the file held without a sidecar, counted; the next tick observes and drains it', () => {
    const box = boundBox('ccrc-hist-fr2a2-');
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });
    plantTranscript(box, 'claude-a', SLUG, U1, [userRow('a0000000-0000-4000-8000-000000000003', 'row one', new Date().toISOString())]);
    spoolLine(box, ID, startup(U1, { reg: U1 }));
    const r = runDriver(box, { offsetMs: 31 * MIN }, [], ENOSPC);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).not.toMatch(/internal error/);
    expect(countOf(box, 'entries'), 'the tick went on to ingest').toBe(1);
    expect(draining(box), 'renamed, so held').toHaveLength(1);
    expect(counter(box, 'journal_write_failed')).toBeGreaterThanOrEqual(1);
    expect(metaOf(box, 'journal_unwritable')).toMatch(/^[0-9]+$/);
    expect(runSweep(box).code).toBe(0);
    expect(draining(box)).toEqual([]);
    expect(countOf(box, 'spool_receipts')).toBe(1);
  });

  it('a hold pass whose sidecar write keeps failing (a directory in the temp\'s place): every file held, journal-unwritable, exit 0; cleared, it drains', () => {
    const box = boundBox('ccrc-hist-fr2a4-');
    spoolLine(box, ID, startup(U1, { reg: U1 }));
    expect(runSweep(box).code).toBe(0);                             // renamed and observed
    const side = names(paths(box).draining).find((n) => n.endsWith('.obs'))!;
    fs.rmSync(path.join(paths(box).draining, side));                // unobserved again
    fs.mkdirSync(path.join(paths(box).draining, `${side}.tmp`));    // no sidecar can be written, on any attempt
    const r = runSweep(box, [], { env: { HISTORY_TEST_STATFS: 'hang' } });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).not.toMatch(/internal error/);
    expect(r.stdout).toMatch(/^history-sweep: journal-unwritable$/m);
    expect(draining(box)).toHaveLength(1);
    const s = runSweep(box);                                        // scheduled: counted, tick goes on
    expect(s.code, s.stderr).toBe(0);
    expect(counter(box, 'journal_write_failed')).toBeGreaterThanOrEqual(1);
    expect(draining(box)).toHaveLength(1);
    fs.rmdirSync(path.join(paths(box).draining, `${side}.tmp`));
    expect(runSweep(box).code).toBe(0);
    expect(draining(box)).toEqual([]);
  }, 30_000);

  it('a hold pass (store-unreachable): the sidecar failing prints journal-unwritable and exits 0, the file held', () => {
    const box = boundBox('ccrc-hist-fr2a3-');
    spoolLine(box, ID, startup(U1, { reg: U1 }));
    const r = runSweep(box, [], { ...ENOSPC, env: { ...ENOSPC.env, HISTORY_TEST_STATFS: 'hang' } });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).not.toMatch(/internal error/);
    expect(r.stdout).toMatch(/^history-sweep: store-unreachable$/m);
    expect(r.stdout).toMatch(/^history-sweep: journal-unwritable$/m);
    expect(draining(box)).toHaveLength(1);
    expect(runSweep(box).code).toBe(0);
    expect(draining(box)).toEqual([]);
  }, 30_000);
});

describe('FR2-b (D-4339): a stale pre-migration temp is removed before the room check, and is not counted against it', () => {
  const SIZE = 1000;                                              // the store's measured size, the seam's answer
  const atTheLine = { env: { HISTORY_TEST_STATFS: `${THRESHOLD + SIZE}:${FS_BYTES}` } };   // free == threshold + size: refused (planCopy needs MORE)
  const plant = (box: HistoryBox, name: string, bytes: number): string => {
    const p = path.join(paths(box).backups, name);
    fs.mkdirSync(paths(box).backups, { recursive: true, mode: 0o700 });
    fs.writeFileSync(p, Buffer.alloc(bytes, 0x61), { mode: 0o600 });
    return p;
  };

  it('CONTROL: with no stale temp, room exactly at threshold + size refuses the copy', () => {
    const box = boundBox('ccrc-hist-fr2b0-');
    const r = runDriver(box, { extraMigrations: [V2], sizeBytes: SIZE }, [], atTheLine);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^history-sweep: migration-refused$/m);
    expect(versionOf(paths(box).db)).toBe(1);
  });

  it('a partial .tmp that eats the margin no longer blocks admission: it is removed first, its bytes are room, and the pass migrates', () => {
    const box = boundBox('ccrc-hist-fr2b1-');
    const tmp = plant(box, '.pre-v2.db.tmp', 4096);
    const jr = plant(box, '.pre-v2.db.tmp-journal', 512);
    const r = runDriver(box, { extraMigrations: [V2], sizeBytes: SIZE }, [], atTheLine);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^history-sweep: migrated$/m);
    expect(fs.existsSync(tmp) || fs.existsSync(jr)).toBe(false);
    expect(versionOf(paths(box).db)).toBe(2);
    expect(names(paths(box).backups)).toEqual(['pre-v2.db']);
  });

  it('a refused migration still removes the stale temps: a temp never outlives the pass that held the lock', () => {
    const box = boundBox('ccrc-hist-fr2b2-');
    const tmp = plant(box, '.pre-v2.db.tmp', 512);
    const tight = { env: { HISTORY_TEST_STATFS: `${THRESHOLD}:${FS_BYTES}` } };   // short by more than the temp frees
    const r = runDriver(box, { extraMigrations: [V2], sizeBytes: SIZE }, [], tight);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^history-sweep: migration-refused$/m);
    expect(fs.existsSync(tmp)).toBe(false);
  });

  it('a temp for an OLDER target, on a store already at the code version, is removed too (nothing to migrate)', () => {
    const box = boundBox('ccrc-hist-fr2b3-');
    const a = plant(box, '.pre-v1.db.tmp', 128);
    const b = plant(box, '.pre-v7.db.tmp-journal', 128);
    const keep = [plant(box, 'pre-v1.db', 64), plant(box, '.pre-v2.attempt', 2), plant(box, '20261005T000000Z.db', 64)];
    expect(runSweep(box).code).toBe(0);
    expect(fs.existsSync(a) || fs.existsSync(b)).toBe(false);
    expect(keep.every((f) => fs.existsSync(f)), 'a finished snapshot, an attempt marker and an operator backup are not temps').toBe(true);
  });

  // Root bypasses mode 0o100, so backups/ cannot be made unlistable as uid 0.
  it.skipIf(process.getuid?.() === 0)('an unlistable backups/ on a store at the code version: the scheduled pass exits 0 and ingests (no new crash loop)', () => {
    const box = boundBox('ccrc-hist-fr2b4-');
    fs.mkdirSync(paths(box).backups, { recursive: true, mode: 0o700 });
    fs.chmodSync(paths(box).backups, 0o100);
    spoolLine(box, ID, startup(U1, { reg: U1 }));
    try {
      for (let i = 0; i < 2; i += 1) {
        const r = runSweep(box);
        expect(r.code, `pass ${i}: ${r.stderr}`).toBe(0);
        expect(r.stderr).not.toMatch(/internal error/);
      }
      expect(epochsOf(box), 'the pass captured').toEqual([{ cc_session_uuid: U1, cause: 'startup', seq: 1 }]);
    } finally { fs.chmodSync(paths(box).backups, 0o700); }
  });

  it('a directory planted under a temp name on a store at the code version: the scheduled pass exits 0', () => {
    const box = boundBox('ccrc-hist-fr2b5-');
    const d = path.join(paths(box).backups, '.pre-v2.db.tmp');
    fs.mkdirSync(d, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(d, 'inner'), 'x');
    const r = runSweep(box);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).not.toMatch(/internal error/);
  });
});
