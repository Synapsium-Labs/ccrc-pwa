// history-cli.test.ts — W1-B1 Task 27: `ccrc history status`
// (spec docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md §8.1–§8.4, §6.9, §5.1's dispatch).
// Pins S13, S15, C28, C36 (its status rows), C45 (the status --json half), O29; and the review focus on
// status's cost (no scan of entries, blobs or memberships; under 2 s on a seeded store).
//
// The CLI runs as the box runs it: a child on process.execPath with --no-warnings (node:sqlite's
// ExperimentalWarning stays off stderr), HOME a fixture from historyHelpers' makeHistoryBox (tmux, gh, ssh, the
// managers and curl poisoned; CLAUDECODE, TMUX, TMUX_PANE and CCRC_RECALL_* scrubbed), and the statfs preload
// deciding free space. CLI tests skip on darwin (O24) except §8.3's Darwin row, which runs natively there.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { makeHistoryBox, runSweep, preloadOptions, PRELOADS, CLI, REPO, type HistoryBox } from './historyHelpers.js';
import * as healthCp from 'node:child_process';
import * as healthFs from 'node:fs';
import * as healthPath from 'node:path';
import * as healthHh from './historyHelpers.js';
import * as healthStore from '../../ccd/history/store.mjs';

const U9 = '99999999-9999-4999-8999-999999999999';
const ID = 'claude-a-demo';
const G1 = '0189abcd-1234-4678-9abc-0123456789ab';
const CCRC = path.join(REPO, 'ccd', 'ccrc');

interface Envelope {
  v: number; exit: number; reason?: string; store_id: string | null; coverage: string; role: string;
  user_version: number | null; code_version: number; migration: string; lag: number | 'unmeasured';
  indexed_through_ms: number | null; last_tick_ms: number | null; bytes_behind_last3: number[];
  size_bytes: number | null; cap_gb: number; cap_file: string; cap_malformed: boolean; capture_pause: string;
  free_bytes: number | null; threshold_bytes: number | null; fts: string | null; snapshot_bytes: number | null;
  journal: { bytes: number; newest_month: string | null; outbox: number; growth_30d_bytes: number; skipped: number; unwritable: boolean; other_store_dirs: string[] };
  export: Record<string, { horizon_days: number | null; retention_days: number | null; due_blobs: number; overdue_blobs: number; segments: number }>;
  recovering: { step: string; cursor: string } | null; op: { verb: string; pid: number; alive: boolean; start_ms: number } | null;
  history_off: boolean; shim_mtime_ms: number | null; counters: Record<string, number>;
  health: { pass: string | null; warn: unknown[]; fail: unknown[] };
}
interface StatusRun { code: number | null; env: Envelope; stdout: string; stderr: string; ms: number }

/** `status --json` exactly as doctor runs it (§9.6), on the statfs preload; extra preloads and env per case. */
function status(box: HistoryBox, opts: { preloads?: string[]; env?: Record<string, string>; args?: string[] } = {}): StatusRun {
  const preloads = opts.preloads ?? [PRELOADS.statfs];
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['--no-warnings', CLI, ...(opts.args ?? ['status', '--json'])], {
    cwd: box.home, encoding: 'utf8',
    env: { ...box.env, HISTORY_TEST_STATFS: 'plenty', NODE_OPTIONS: preloadOptions(preloads), ...opts.env },
  });
  const ms = Date.now() - t0;
  const line = (r.stdout ?? '').trim().split('\n').at(-1) ?? '';
  let env = {} as Envelope;
  try { env = JSON.parse(line) as Envelope; } catch { /* a human-format or failed run: the case reads stdout */ }
  return { code: r.status, env, stdout: r.stdout ?? '', stderr: r.stderr ?? '', ms };
}
const hist = (box: HistoryBox, ...p: string[]): string => path.join(box.home, '.ccrc', 'history', ...p);
const dbFile = (box: HistoryBox): string => hist(box, 'db', 'history.db');
function boundBox(prefix: string): HistoryBox {
  const box = makeHistoryBox(prefix, { role: 'fleet', shim: true });
  const r = runSweep(box);
  expect(r.code, r.stderr).toBe(0);
  return box;
}
const storeIdOf = (box: HistoryBox): string => fs.readFileSync(hist(box, 'store.id'), 'utf8').trim();
const metaStoreId = (box: HistoryBox): string => {
  const db = new DatabaseSync(dbFile(box), { readOnly: true });
  try { return (db.prepare("SELECT v FROM meta WHERE k = 'store_id'").get() as { v: string }).v; } finally { db.close(); }
};
/** C45: every envelope, whatever its exit, carries store_id and coverage=this-box. */
function expectIdentity(env: Envelope): void {
  expect(Object.keys(env)).toContain('store_id');
  expect(env.coverage).toBe('this-box');
}

describe('C36, the Darwin row: native on macOS', () => {
  it.runIf(process.platform === 'darwin')('on macOS status answers 9 before anything else', () => {
    const box = makeHistoryBox('ccrc-hist-cli-darwin-', { role: 'fleet', shim: true });
    const r = status(box);
    expect(r.code).toBe(9);
    expect(r.env.exit).toBe(9);
    expectIdentity(r.env);
  });
});

describe('ccrc history status (Linux)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });

  it('C28 + C45: a box verb, identity-free — exit 0 with no TMUX_PANE on a bound store, and no spool line written', () => {
    const box = boundBox('ccrc-hist-cli-c28-');
    expect(box.env['TMUX_PANE'], 'the fixture env carries no pane').toBeUndefined();
    const spool = hist(box, 'spool');
    const before = fs.readdirSync(spool).sort();
    const r = status(box);
    expect(r.code, r.stderr).toBe(0);
    expect(r.env.exit).toBe(0);
    expect(r.env.reason).toBeUndefined();
    expect(r.env.store_id).toBe(storeIdOf(box));
    expectIdentity(r.env);
    expect(fs.readdirSync(spool).sort(), 'status writes no counter line (slug history-box-verbs-no-counter-line)').toEqual(before);
    expect(r.stderr, '--no-warnings keeps node:sqlite\'s ExperimentalWarning off stderr').toBe('');
  });

  it('C36: the no-store table, row by row, through status --json', () => {
    // a server role recorded, with a stale shim, store.id and DB all present → 9
    const server = boundBox('ccrc-hist-cli-c36a-');
    fs.writeFileSync(path.join(server.home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=server\n');
    const s = status(server);
    expect(s.code).toBe(9);
    expectIdentity(s.env);
    // no shim, no store.id, no DB → 9 (never installed)
    const bare = makeHistoryBox('ccrc-hist-cli-c36b-', { role: 'fleet', shim: false });
    expect(status(bare).code).toBe(9);
    // the shim only → 6 (the first tick has not created the store)
    const shimOnly = makeHistoryBox('ccrc-hist-cli-c36c-', { role: 'fleet', shim: true });
    const six = status(shimOnly);
    expect(six.code).toBe(6);
    expect(six.env.reason, 'exit 6 has one meaning and carries no reason').toBeUndefined();
    expectIdentity(six.env);
    // the same with a journal/<uuid>/ directory → 5 store-recoverable
    fs.mkdirSync(hist(shimOnly, 'journal', U9), { recursive: true });
    const rec = status(shimOnly);
    expect([rec.code, rec.env.reason]).toEqual([5, 'store-recoverable']);
    // the same with a leftover history.db-wal instead → 5 store-wal-orphaned
    const wal = makeHistoryBox('ccrc-hist-cli-c36d-', { role: 'fleet', shim: true });
    fs.mkdirSync(hist(wal, 'db'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(hist(wal, 'db', 'history.db-wal'), '');
    const w = status(wal);
    expect([w.code, w.env.reason]).toEqual([5, 'store-wal-orphaned']);
    // store.id without a DB → 5 store-missing, naming the store
    const missing = boundBox('ccrc-hist-cli-c36e-');
    for (const f of ['history.db', 'history.db-wal', 'history.db-shm']) fs.rmSync(hist(missing, 'db', f), { force: true });
    const m = status(missing);
    expect([m.code, m.env.reason]).toEqual([5, 'store-missing']);
    expect(m.env.store_id).toBe(storeIdOf(missing));
    // a 0-byte store → 5 store-zero-byte
    const zero = boundBox('ccrc-hist-cli-c36f-');
    for (const f of ['history.db-wal', 'history.db-shm']) fs.rmSync(hist(zero, 'db', f), { force: true });
    fs.truncateSync(dbFile(zero), 0);
    const z = status(zero);
    expect([z.code, z.env.reason]).toEqual([5, 'store-zero-byte']);
    expect(fs.statSync(dbFile(zero)).size, 'never opened empty, never written').toBe(0);
  });

  it('S13: a DB with no store.id and no matching pending marker — the sweep refuses with no write, status exits 5 store-unbound naming meta.store_id', () => {
    const box = boundBox('ccrc-hist-cli-s13-');
    const id = metaStoreId(box);
    fs.rmSync(hist(box, 'store.id'));
    const mtime = fs.statSync(dbFile(box)).mtimeMs;
    const r = runSweep(box);
    expect(r.code).toBe(5);
    expect(r.stdout).toMatch(/^history-sweep: store-unbound$/m);
    expect(fs.existsSync(hist(box, 'store.id')), 'the sweep never adopts').toBe(false);
    expect(fs.statSync(dbFile(box)).mtimeMs).toBe(mtime);
    const s = status(box);
    expect([s.code, s.env.reason]).toEqual([5, 'store-unbound']);
    expect(s.env.store_id, 'the --adopt remedy needs no sqlite3').toBe(id);
  });

  it('S15: no store.id and no DB, but evidence a store existed — the sweep creates nothing and status names the same word', () => {
    const cases: [string, (b: HistoryBox) => void, string][] = [
      ['a journal/<uuid>/ directory', (b) => fs.mkdirSync(hist(b, 'journal', U9), { recursive: true }), 'store-recoverable'],
      ['a regular db/backups/x.db', (b) => { fs.mkdirSync(hist(b, 'db', 'backups'), { recursive: true }); fs.writeFileSync(hist(b, 'db', 'backups', 'x.db'), 'x'); }, 'store-recoverable'],
      ['a leftover history.db-wal', (b) => { fs.mkdirSync(hist(b, 'db'), { recursive: true }); fs.writeFileSync(hist(b, 'db', 'history.db-wal'), ''); }, 'store-wal-orphaned'],
    ];
    for (const [what, plant, word] of cases) {
      const box = makeHistoryBox('ccrc-hist-cli-s15-', { role: 'fleet', shim: true });
      plant(box);
      const r = runSweep(box);
      expect(r.code, what).toBe(5);
      expect(r.stdout, what).toMatch(new RegExp(`^history-sweep: ${word}$`, 'm'));
      expect(fs.existsSync(dbFile(box)), what).toBe(false);
      expect(fs.existsSync(hist(box, 'store.id')), what).toBe(false);
      const s = status(box);
      expect([s.code, s.env.reason], what).toEqual([5, word]);
    }
    const fresh = makeHistoryBox('ccrc-hist-cli-s15-none-', { role: 'fleet', shim: true });
    expect(runSweep(fresh).code, 'with none of them, a first install creates the store').toBe(0);
    expect(fs.existsSync(dbFile(fresh))).toBe(true);
    expect(status(fresh).code).toBe(0);
  });

  it('O29: an interrupted install wedges nothing — the pending case opens on the next tick, the unbound case stays 5', () => {
    const pending = boundBox('ccrc-hist-cli-o29a-');
    fs.renameSync(hist(pending, 'store.id'), hist(pending, 'store.id.pending'));   // killed between link() and the rename
    expect(status(pending).code, 'store.id.pending matches: the writer finishes it').toBe(6);
    expect(runSweep(pending).code).toBe(0);
    expect(fs.readFileSync(hist(pending, 'store.id'), 'utf8').trim()).toBe(metaStoreId(pending));
    const done = status(pending);
    expect(done.code).toBe(0);
    expect(done.env.counters['store_creation_completed']).toBe(1);
    const unbound = boundBox('ccrc-hist-cli-o29b-');
    fs.rmSync(hist(unbound, 'store.id'));
    expect(status(unbound).code).toBe(5);
    expect(runSweep(unbound).code).toBe(5);
    expect(status(unbound).code).toBe(5);
  });

  it('a stat that never settles answers 5 store-unreachable inside the 2 s bound, without opening the DB', () => {
    const box = boundBox('ccrc-hist-cli-unreach-');
    const r = status(box, { preloads: [PRELOADS.statfs], env: { HISTORY_TEST_STAT_HANG: 'history.db' } });
    expect([r.code, r.env.reason]).toEqual([5, 'store-unreachable']);
    expect(r.env.store_id).toBe(storeIdOf(box));
    expect(r.ms, 'CLI_STAT_DEADLINE_MS is 2000; the process exits explicitly past a pinned thread').toBeLessThan(10_000);
  });

  it('a bound store that is not in WAL mode answers 5 store-not-wal with its store_id', () => {
    const box = boundBox('ccrc-hist-cli-notwal-');
    const db = new DatabaseSync(dbFile(box));
    db.exec('PRAGMA journal_mode = DELETE');
    db.close();
    const r = status(box);
    expect([r.code, r.env.reason]).toEqual([5, 'store-not-wal']);
    expect(r.env.store_id).toBe(storeIdOf(box));
  });

  it('an unreadable store.writer is a binding read that failed: 5 store-unmeasured with its store_id, never a healthy 0 (§5.3 "Binding reads")', () => {
    const box = boundBox('ccrc-hist-cli-writer-');
    fs.writeFileSync(hist(box, 'store.writer'), 'not a writer token\n');   // off WRITER_RE: measured unreadable
    const r = status(box);
    expect([r.code, r.env.reason]).toEqual([5, 'store-unmeasured']);
    expect(r.env.store_id).toBe(storeIdOf(box));
  });

  it('an unreadable cap file reads malformed, as the sweep reads it: the default applies and doctor can WARN', () => {
    const box = boundBox('ccrc-hist-cli-capdir-');
    fs.mkdirSync(path.join(box.home, '.ccrc', 'history-max-gb'));     // present, but no read of it succeeds
    const r = status(box);
    expect(r.code, r.stderr).toBe(0);
    expect([r.env.cap_gb, r.env.cap_malformed]).toEqual([50, true]);
  });

  it('the envelope reports the durability state (§8.4 status): versions, migration, ticks, journal, cap, op, switch', () => {
    const box = boundBox('ccrc-hist-cli-env-');
    expect(runSweep(box).code).toBe(0);                       // a second tick: one more ticks row
    fs.writeFileSync(path.join(box.home, '.ccrc', 'history-max-gb'), 'abc\n');
    const dead = spawnSync(process.execPath, ['-e', '']).pid!;  // a pid that has already exited
    fs.writeFileSync(hist(box, 'op'), `import ${dead} 1700000000000\n`);
    fs.writeFileSync(path.join(box.home, '.ccrc', 'history-off'), '');
    const r = status(box);
    expect(r.code, r.stderr).toBe(0);
    const e = r.env;
    expect(e.v).toBe(1);
    expect([e.user_version, e.code_version, e.migration]).toEqual([1, 1, 'none']);
    expect(typeof e.last_tick_ms).toBe('number');
    expect(e.bytes_behind_last3.length).toBeGreaterThanOrEqual(1);
    expect(e.bytes_behind_last3.length).toBeLessThanOrEqual(3);
    expect(e.size_bytes).toBeGreaterThan(0);
    expect([e.cap_gb, e.cap_malformed]).toEqual([50, true]);
    expect(e.cap_file.endsWith(path.join('.ccrc', 'history-max-gb')), 'doctor names the file from here (O13)').toBe(true);
    expect(e.free_bytes).toBeGreaterThan(0);
    expect(e.threshold_bytes).toBeGreaterThan(0);
    expect(['ready', 'fts-pending', 'fts5-absent']).toContain(e.fts);
    expect(e.journal.newest_month).toMatch(/^[0-9]{4}-[0-9]{2}$/);
    expect(e.journal.bytes).toBeGreaterThan(0);
    expect(e.journal.outbox).toBe(0);
    expect(e.journal.other_store_dirs).toEqual([]);
    expect(e.op).toEqual({ verb: 'import', pid: dead, alive: false, start_ms: 1700000000000 });
    expect(e.history_off).toBe(true);
    expect(typeof e.shim_mtime_ms).toBe('number');
    expect(e.recovering).toBeNull();
    expect(Object.keys(e.export)).toEqual(['claude-code']);
    expect(e.health.pass).toBeNull();
    expect((e.health.warn as Array<{ word: string }>).map((i) => i.word)).toEqual(expect.arrayContaining(['off', 'cap-malformed']));
  });

  it('another store\'s journal directory beside this one is listed, never read as this store\'s', () => {
    const box = boundBox('ccrc-hist-cli-other-');
    fs.mkdirSync(hist(box, 'journal', U9), { recursive: true });
    expect(status(box).env.journal.other_store_dirs).toEqual([U9]);
  });

  it('the human form leads with the header line §8.3 names', () => {
    const box = boundBox('ccrc-hist-cli-human-');
    const r = status(box, { args: ['status'] });
    expect(r.code).toBe(0);
    expect(r.stdout.split('\n')[0]).toMatch(new RegExp(`^scope=box coverage=this-box store=${storeIdOf(box)} indexed-through=\\S+ lag=\\S+$`));
  });

  it('every other verb is bad-args in W1-B1, with a usage line, and --json carries the reason', () => {
    const box = boundBox('ccrc-hist-cli-bad-');
    const plain = status(box, { args: ['grep', 'x'] });
    expect(plain.code).toBe(2);
    expect(plain.stderr).toMatch(/^usage: ccrc history status \[--json\]/m);
    const json = status(box, { args: ['describe', 'L0', '--json'] });
    expect([json.code, json.env.reason]).toEqual([2, 'bad-args']);
    expectIdentity(json.env);
    expect(status(box, { args: [] }).code).toBe(2);
  });

  it('the ccrc dispatch line reaches cli.mjs: `ccrc history status --json` answers as the module does, `ccrc history` alone is bad-args', () => {
    const box = boundBox('ccrc-hist-cli-dispatch-');
    const env = { ...box.env, HISTORY_TEST_STATFS: 'plenty', NODE_OPTIONS: preloadOptions([PRELOADS.statfs]) };
    const via = spawnSync('bash', [CCRC, 'history', 'status', '--json'], { cwd: box.home, env, encoding: 'utf8' });
    expect(via.status, via.stderr).toBe(0);
    expect((JSON.parse(via.stdout.trim()) as Envelope).store_id).toBe(storeIdOf(box));
    const none = spawnSync('bash', [CCRC, 'history'], { cwd: box.home, env, encoding: 'utf8' });
    expect(none.status).toBe(2);
  });

  it('cost: on 200k entries and 10k ticks status answers in under 2 s and none of its statements scans entries, blobs or memberships', () => {
    const box = boundBox('ccrc-hist-cli-cost-');
    const db = new DatabaseSync(dbFile(box));
    db.exec('BEGIN');
    const blob = db.prepare("INSERT INTO blobs (sha256, codec, z, raw_len) VALUES (?, 'br5', ?, 1)").run(Buffer.alloc(32, 7), Buffer.from([0]));
    const tr = db.prepare('INSERT INTO transcripts (cc_session_uuid) VALUES (?)').run(U9);
    const ent = db.prepare("INSERT INTO entries (uuid, transcript_pk, type, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id) VALUES (?, ?, 'user', 'operator', 1, 0, 0, ?)");
    for (let i = 0; i < 200_000; i += 1) ent.run(`seed-${i}`, tr.lastInsertRowid, blob.lastInsertRowid);
    const tick = db.prepare('INSERT INTO ticks (ts_ms, lag_ms, bytes, files_behind, bytes_behind) VALUES (?, 0, 0, 0, 0)');
    for (let i = 0; i < 10_000; i += 1) tick.run(Date.now() - (10_000 - i) * 120_000);
    db.exec('COMMIT');
    db.close();
    const r = status(box);
    expect(r.code, r.stderr).toBe(0);
    expect(r.ms).toBeLessThan(2000);
    // Every statement status prepares, read from the module itself (a child: importing it here would set
    // this worker's umask), through EXPLAIN QUERY PLAN against the seeded store.
    const sql = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e',
      `const m = await import(${JSON.stringify(pathToFileURL(CLI).href)}); process.stdout.write(JSON.stringify(m.STATUS_SQL));`],
    { encoding: 'utf8' });
    expect(sql.status, sql.stderr).toBe(0);
    const statements = Object.values(JSON.parse(sql.stdout) as Record<string, string>);
    expect(statements.length, 'a scan over no statements proves nothing').toBeGreaterThanOrEqual(5);
    const ro = new DatabaseSync(dbFile(box), { readOnly: true });
    try {
      const plan = (s: string): string => (ro.prepare(`EXPLAIN QUERY PLAN ${s}`).all() as { detail: string }[]).map((x) => x.detail).join(' | ');
      expect(plan('SELECT count(*) FROM entries'), 'CONTROL: the matcher sees a scan when there is one').toMatch(/\bSCAN entries\b/);
      for (const s of statements) expect(plan(s), s).not.toMatch(/\bSCAN (entries|blobs|memberships)\b/);
    } finally { ro.close(); }
  });
});

// ── task 28: the status health block — the measured snapshot through deriveHealth ──
// Every spawn carries the statfs preload at 'plenty' (the box's real free
// space never decides a test) and the scrubbed, contained env makeHistoryBox
// built (no ambient CLAUDECODE, TMUX or CLAUDE_CONFIG_DIR; a tmux poison).
describe('status health: the measured snapshot through deriveHealth (task 28)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  type Envelope = Record<string, any>;
  const statusOf = (box: healthHh.HistoryBox, args: string[] = ['--json'], seam?: { preloads: string[]; env: Record<string, string>; timeoutMs?: number }): { code: number | null; stdout: string; env: Envelope | null } => {
    const r = healthCp.spawnSync(process.execPath, ['--no-warnings', healthHh.CLI, 'status', ...args], {
      env: { ...box.env, NODE_OPTIONS: healthHh.preloadOptions([healthHh.PRELOADS.statfs, ...(seam?.preloads ?? [])]), HISTORY_TEST_STATFS: 'plenty', ...(seam?.env ?? {}) },
      cwd: box.home, encoding: 'utf8', ...(seam?.timeoutMs === undefined ? {} : { timeout: seam.timeoutMs, killSignal: 'SIGKILL' as const }),
    });
    const last = r.stdout.trim().split('\n').pop() ?? '';
    if (args.includes('--json') && last === '') throw new Error(`status printed no envelope (exit ${r.status}, signal ${r.signal}): ${r.stderr}`);
    return { code: r.status, stdout: r.stdout, env: args.includes('--json') ? (JSON.parse(last) as Envelope) : null };
  };
  const wordsOf = (list: Array<{ word: string }>): string[] => list.map((i) => i.word);
  const shimOf = (box: healthHh.HistoryBox): string => healthPath.join(box.home, '.local', 'bin', 'ccd-history-sweep');
  const ageFile = (file: string, ms: number): void => { const t = (Date.now() - ms) / 1000; healthFs.utimesSync(file, t, t); };
  const dbFile = (box: healthHh.HistoryBox): string => healthPath.join(box.home, '.ccrc', 'history', 'db', 'history.db');
  /** A store task 12 created, with one ticks row at `tickMs` and lag measured
   *  (last_zero_behind_ms, task 20's meta) as of that tick. */
  const tickedStore = (box: healthHh.HistoryBox, tickMs: number): void => {
    healthStore.createStore(box.home);
    const db = healthStore.openWriter(dbFile(box));
    try {
      db.prepare('INSERT INTO ticks (ts_ms, lag_ms, bytes, files_behind, bytes_behind) VALUES (?, ?, ?, ?, ?)').run(tickMs, 0, 0, 0, 0);
      healthStore.setMeta(db, 'last_zero_behind_ms', String(tickMs));
      healthStore.setMeta(db, 'capture_pause', '');
    } finally { healthStore.closeWriter(db); }
  };

  it('a fresh shim with no store yet (exit 6) is PASS first-tick-pending, and nothing else', () => {
    const box = healthHh.makeHistoryBox('ccrc-history-health-grace-', { role: 'fleet', shim: true });
    const { code, env } = statusOf(box);
    expect(code).toBe(6);
    expect(env!['health']).toEqual({ pass: 'first-tick-pending', warn: [], fail: [] });
  });

  it('the human status prints the health line too', () => {
    const box = healthHh.makeHistoryBox('ccrc-history-health-human-', { role: 'fleet', shim: true });
    expect(statusOf(box, []).stdout).toContain('health: PASS first-tick-pending');
  });

  it('past the grace with no tick yet is FAIL tick-stale, with its remedy', () => {
    const box = healthHh.makeHistoryBox('ccrc-history-health-stale-', { role: 'fleet', shim: true });
    ageFile(shimOf(box), 10 * 60_000);
    const { env } = statusOf(box);
    expect(env!['health']['pass']).toBeNull();
    expect(wordsOf(env!['health']['fail'])).toEqual(['tick-stale']);
    expect(env!['health']['fail'][0]['remedy']).toContain('journalctl --user -u ccd-history-sweep');
  });

  it('a bound store that ticked just now, with lag measured, is PASS ok', () => {
    const box = healthHh.makeHistoryBox('ccrc-history-health-ok-', { role: 'fleet', shim: true });
    ageFile(shimOf(box), 60 * 60_000);
    tickedStore(box, Date.now());
    const { code, env } = statusOf(box);
    expect(code).toBe(0);
    const h = env!['health'];
    expect({ pass: h['pass'], warn: wordsOf(h['warn']), fail: wordsOf(h['fail']) }).toEqual({ pass: 'ok', warn: [], fail: [] });
    expect(['root', 'own']).toContain(env!['store_device']);
  });

  it('history-off with no tick for an hour is WARN off, never the stale-tick FAIL', () => {
    const box = healthHh.makeHistoryBox('ccrc-history-health-off-', { role: 'fleet', shim: true });
    ageFile(shimOf(box), 2 * 60 * 60_000);
    tickedStore(box, Date.now() - 60 * 60_000);
    healthFs.writeFileSync(healthPath.join(box.home, '.ccrc', 'history-off'), '');
    const { env } = statusOf(box);
    expect(wordsOf(env!['health']['warn'])).toContain('off');
    expect(wordsOf(env!['health']['fail'])).not.toContain('tick-stale');
  });

  // Task 28F item 3: a failed extras read is unmeasured, never a healthy default. The smallest seam: the breaker
  // table the envelope never reads, so the status read itself still succeeds (exit 0) and only the extras fail.
  it('a store whose breaker table cannot be read is FAIL status-unreadable naming it, with exit still 0', () => {
    const box = healthHh.makeHistoryBox('ccrc-history-health-extras-', { role: 'fleet', shim: true });
    ageFile(shimOf(box), 60 * 60_000);
    tickedStore(box, Date.now());
    const db = healthStore.openWriter(dbFile(box));
    try { db.exec('DROP TABLE breaker'); } finally { healthStore.closeWriter(db); }
    const { code, env } = statusOf(box);
    expect(code).toBe(0);
    const fail = env!['health']['fail'] as Array<{ word: string; detail: string }>;
    expect(wordsOf(fail)).toEqual(['status-unreadable']);
    expect(fail[0]!.detail).toContain('breaker');
    expect(env!['health']['pass']).toBeNull();
  });

  it('an unreadable spool/.draining is FAIL status-unreadable; an absent one is no held file, still PASS ok', () => {
    const box = healthHh.makeHistoryBox('ccrc-history-health-draining-', { role: 'fleet', shim: true });
    ageFile(shimOf(box), 60 * 60_000);
    tickedStore(box, Date.now());
    const draining = healthPath.join(box.home, '.ccrc', 'history', 'spool', '.draining');
    healthFs.rmSync(draining, { recursive: true, force: true });
    expect(healthFs.existsSync(draining)).toBe(false);
    expect(statusOf(box).env!['health']['pass']).toBe('ok');
    // A regular file where the directory belongs: readdir answers ENOTDIR, which is unreadable, not absent.
    healthFs.mkdirSync(healthPath.dirname(draining), { recursive: true, mode: 0o700 });
    healthFs.writeFileSync(draining, '', { mode: 0o600 });
    const fail = statusOf(box).env!['health']['fail'] as Array<{ word: string; detail: string }>;
    expect(wordsOf(fail)).toEqual(['status-unreadable']);
    expect(fail[0]!.detail).toContain('spool/.draining');
  });

  // Task 28F review round 1 (F1): the two guards that had no pin. A sidecar that cannot be read for any reason but
  // ENOENT is unmeasured (EISDIR here; mode 000 is skipped under root), never "no held file".
  it('a spool/.draining sidecar that cannot be read (a directory named *.obs) is FAIL status-unreadable naming spool/.draining', () => {
    const box = healthHh.makeHistoryBox('ccrc-history-health-sidecar-eisdir-', { role: 'fleet', shim: true });
    ageFile(shimOf(box), 60 * 60_000);
    tickedStore(box, Date.now());
    const draining = healthPath.join(box.home, '.ccrc', 'history', 'spool', '.draining');
    healthFs.mkdirSync(healthPath.join(draining, 'x.obs'), { recursive: true, mode: 0o700 });
    const fail = statusOf(box).env!['health']['fail'] as Array<{ word: string; detail: string }>;
    expect(wordsOf(fail)).toEqual(['status-unreadable']);
    expect(fail[0]!.detail).toContain('spool/.draining');
  });

  it('a spool/.draining sidecar with mode 000 is FAIL status-unreadable (skipped as root, which reads it anyway)', (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();
    const box = healthHh.makeHistoryBox('ccrc-history-health-sidecar-eacces-', { role: 'fleet', shim: true });
    ageFile(shimOf(box), 60 * 60_000);
    tickedStore(box, Date.now());
    const dir = healthPath.join(box.home, '.ccrc', 'history', 'spool', '.draining');
    healthFs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    healthFs.writeFileSync(healthPath.join(dir, 'x.obs'), '{}', { mode: 0o000 });
    const fail = statusOf(box).env!['health']['fail'] as Array<{ word: string; detail: string }>;
    expect(wordsOf(fail)).toEqual(['status-unreadable']);
    expect(fail[0]!.detail).toContain('spool/.draining');
  });

  it('an unparseable sidecar is skipped as the sweep skips it: no held file, still PASS ok', () => {
    const box = healthHh.makeHistoryBox('ccrc-history-health-sidecar-junk-', { role: 'fleet', shim: true });
    ageFile(shimOf(box), 60 * 60_000);
    tickedStore(box, Date.now());
    const dir = healthPath.join(box.home, '.ccrc', 'history', 'spool', '.draining');
    healthFs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    healthFs.writeFileSync(healthPath.join(dir, 'x.obs'), 'not json', { mode: 0o600 });
    expect(statusOf(box).env!['health']['pass']).toBe('ok');
  });

  // F2: the sweep's readSmall stats BEFORE it opens (the `_reg_read` lesson: a FIFO with no writer blocks in open(2)
  // for ever). status must do the same: a FIFO named *.obs returns within a bound and is reported unmeasured.
  it('a FIFO named *.obs in spool/.draining does not hang status: it returns, FAIL status-unreadable naming spool/.draining', () => {
    const box = healthHh.makeHistoryBox('ccrc-history-health-sidecar-fifo-', { role: 'fleet', shim: true });
    ageFile(shimOf(box), 60 * 60_000);
    tickedStore(box, Date.now());
    const dir = healthPath.join(box.home, '.ccrc', 'history', 'spool', '.draining');
    healthFs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    healthCp.execFileSync('mkfifo', [healthPath.join(dir, 'x.obs')]);
    const t0 = Date.now();
    const r = statusOf(box, ['--json'], { preloads: [], env: {}, timeoutMs: 8_000 });
    expect(r.code).toBe(0);
    expect(Date.now() - t0).toBeLessThan(7_000);
    const fail = r.env!['health']['fail'] as Array<{ word: string; detail: string }>;
    expect(wordsOf(fail)).toEqual(['status-unreadable']);
    expect(fail[0]!.detail).toContain('spool/.draining');
  });

  it('a regular-file sidecar reached through a symlink is read as the sweep reads it (statSync follows): a held one is journal-unwritable once old', () => {
    const box = healthHh.makeHistoryBox('ccrc-history-health-sidecar-link-', { role: 'fleet', shim: true });
    ageFile(shimOf(box), 60 * 60_000);
    tickedStore(box, Date.now());
    const dir = healthPath.join(box.home, '.ccrc', 'history', 'spool', '.draining');
    healthFs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const real = healthPath.join(box.home, 'real.obs');
    healthFs.writeFileSync(real, JSON.stringify({ v: 1, observedMs: Date.now() - 6 * 60 * 60_000, journaled: null }), { mode: 0o600 });
    healthFs.symlinkSync(real, healthPath.join(dir, 'x.obs'));
    const words = wordsOf(statusOf(box).env!['health']['fail']);
    expect(words).not.toContain('status-unreadable');
  });

  // F1's second arm: the extras' own reader open fails after the envelope's read succeeded (seam: the third
  // `PRAGMA query_only = ON`, preload-faults' Task 28F block).
  it('a reader open that fails after the status read succeeded is FAIL status-unreadable naming the store, exit still 0', () => {
    const box = healthHh.makeHistoryBox('ccrc-history-health-extras-open-', { role: 'fleet', shim: true });
    ageFile(shimOf(box), 60 * 60_000);
    tickedStore(box, Date.now());
    const r = statusOf(box, ['--json'], { preloads: [healthHh.PRELOADS.faults], env: { HISTORY_TEST_FAIL_QUERY_ONLY: '3' } });
    expect(r.code).toBe(0);
    const fail = r.env!['health']['fail'] as Array<{ word: string; detail: string }>;
    expect(wordsOf(fail)).toEqual(['status-unreadable']);
    expect(fail[0]!.detail).toContain('store');
    expect(r.env!['health']['pass']).toBeNull();
  });

  it('db/ linked to a 0755 target FAILs mode-wrong naming the TARGET and its chmod; a 0700 target passes; the link\'s own mode is never read', () => {
    const box = healthHh.makeHistoryBox('ccrc-history-health-modes-', { role: 'fleet', shim: true });
    ageFile(shimOf(box), 60 * 60_000);
    const target = healthPath.join(box.home, 'volume', 'history-db');
    healthFs.mkdirSync(target, { recursive: true, mode: 0o700 });
    healthFs.mkdirSync(healthPath.join(box.home, '.ccrc', 'history'), { recursive: true, mode: 0o700 });
    healthFs.symlinkSync(target, healthPath.join(box.home, '.ccrc', 'history', 'db'));
    tickedStore(box, Date.now());
    healthFs.chmodSync(target, 0o755);
    const wrong = statusOf(box).env!['health'];
    const item = (wrong['fail'] as Array<{ word: string; detail: string; remedy: string }>).find((i) => i.word === 'mode-wrong');
    expect(item, JSON.stringify(wrong)).toBeDefined();
    expect(item!.detail).toContain(`${target} is 0755, wants 0700`);
    expect(item!.remedy).toContain(`chmod 0700 ${target}`);
    healthFs.chmodSync(target, 0o700);
    expect(wordsOf(statusOf(box).env!['health']['fail'])).not.toContain('mode-wrong');
  });
});
