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
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_VERSION, formatPassMarker, procStartOf, bootIdOf, redactField, makePairIndex } from '../../ccd/history/lib.mjs';
import { f2Cases } from './fixtures/history/f2Cases.js';
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
  pass: { pid: number; start_ms: number; live: boolean } | null;
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

  it('RF5b F11: a bound store missing a table status reads answers ONE envelope, exit 5 store-read-failed with its store_id; doctor reads status-unreadable', () => {
    const box = boundBox('ccrc-hist-cli-rf5b11a-');
    const db = new DatabaseSync(dbFile(box));
    db.exec('DROP TABLE counters');
    db.close();
    const r = status(box);
    expect(r.code).toBe(5);
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
    expect(r.env.exit).toBe(5);
    expect(r.env.reason).toBe('store-read-failed');
    expect(r.env.store_id).toBe(storeIdOf(box));
    expectIdentity(r.env);
    expect(r.env.health.fail).toEqual([expect.objectContaining({ word: 'status-unreadable', detail: expect.stringContaining('store-read-failed') })]);
    expect(r.stderr).toContain('no such table: counters');
  });

  it('RF5b F11: a v1 column status names gone (ticks.bytes_behind dropped) answers the same exit 5 store-read-failed', () => {
    const box = boundBox('ccrc-hist-cli-rf5b11b-');
    const db = new DatabaseSync(dbFile(box));
    db.exec('ALTER TABLE ticks DROP COLUMN bytes_behind');
    db.close();
    const r = status(box);
    expect([r.code, r.env.exit, r.env.reason]).toEqual([5, 5, 'store-read-failed']);
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
    expect(r.stderr).toContain('no such column');
  });

  it('RF5b F11: the human form of a failed status read names exit 5 store-read-failed', () => {
    const box = boundBox('ccrc-hist-cli-rf5b11c-');
    const db = new DatabaseSync(dbFile(box));
    db.exec('DROP TABLE counters');
    db.close();
    const r = status(box, { args: ['status'] });
    expect(r.code).toBe(5);
    expect(r.stdout).toContain('exit 5 store-read-failed');
  });

  // FU4 M30 (review 316 F11): readStoreAnswered classifies ONLY a StoreError and SQLite's own error (code ERR_SQLITE_ERROR) as a
  // store word; any other throw is a defect in the reader and stays exit 1 with no envelope. The preload fails the preparation of
  // the counters read, which only readStore (past the binding read) issues.
  // FU6 (B3M7): cli.mjs's catch prints only `e.message` (never the error's class), so the injected message names no class and
  // what is asserted is that the defect ESCAPED: the internal-error exit code, an empty stdout, and the message on stderr.
  it('M30: a plain TypeError out of the status read is a programming defect: exit 1, no envelope, its message on stderr, never store-read-failed', () => {
    const box = boundBox('ccrc-hist-cli-m30a-');
    const r = status(box, { preloads: [PRELOADS.statfs, PRELOADS.faults], env: { HISTORY_TEST_THROW_PREPARE: 'TypeError@FROM counters' } });
    expect(r.code, r.stderr).toBe(1);
    expect(r.stdout.trim(), 'no envelope is answered for a defect').toBe('');
    expect(r.stderr).toContain('ccrc history: internal error: fixture-planted');
    expect(r.stderr).not.toContain('store-read-failed');
  });

  it('M30: a StoreError out of the status read answers its own word (store-missing), exit 5, one envelope', () => {
    const box = boundBox('ccrc-hist-cli-m30b-');
    const r = status(box, { preloads: [PRELOADS.statfs, PRELOADS.faults], env: { HISTORY_TEST_THROW_PREPARE: 'StoreError:store-missing@FROM counters' } });
    expect(r.code, r.stderr).toBe(5);
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
    expect([r.env.exit, r.env.reason]).toEqual([5, 'store-missing']);
    expect(r.env.store_id).toBe(storeIdOf(box));
  });

  // HA2 H-32 (spec §8.3, §12): stderr takes the final redaction pass as stdout does. The preload throws the planted
  // value as the message of a SQLite error (the status read's store-read-failed line) or of a plain Error (the entry
  // guard's internal-error line). A token shape the belt knows needs no registered pair.
  const ha2Leak = (texts: string[], v: string): string[] => {
    const windows = Array.from({ length: v.length - 7 }, (_, i) => v.slice(i, i + 8));
    return texts.flatMap((t, i) => windows.filter((w) => t.includes(w)).slice(0, 1).map((w) => `#${i}: ${w}`));
  };
  const ha2Token = (): string => `ghp_${randomBytes(27).toString('base64url').slice(0, 36).replace(/[-_]/g, 'q')}`;

  it('H-32: the store-read-failed line and the internal-error line of status carry no planted token', () => {
    const box = boundBox('ccrc-hist-cli-ha2-h32-');
    const V = ha2Token();
    const sq = status(box, { preloads: [PRELOADS.statfs, PRELOADS.faults], env: { HISTORY_TEST_THROW_PREPARE: `SqliteError:${V}@FROM counters` } });
    expect([sq.code, sq.env.reason], sq.stderr).toEqual([5, 'store-read-failed']);
    expect(sq.stderr, 'CONTROL: the line is written, with the message in its place').toContain('ccrc history: store-read-failed: ');
    expect(ha2Leak([sq.stderr, sq.stdout], V)).toEqual([]);
    const plain = status(box, { preloads: [PRELOADS.statfs, PRELOADS.faults], env: { HISTORY_TEST_THROW_PREPARE: `Error:${V}@FROM counters` } });
    expect(plain.code, plain.stderr).toBe(1);
    expect(plain.stderr, 'CONTROL: the guard line is written').toContain('ccrc history: internal error: ');
    expect(ha2Leak([plain.stderr, plain.stdout], V)).toEqual([]);
  });

  // D-4613 rounds 4 to 6, retitled by fix round 1 (review 441 F8): errLine's text is not framed by the CLI, so it takes ONE
  // whole-text final belt (redactFinalLines), no tag split. This pin guards that belt: a forged frame tag in a thrown message keeps
  // no secret in its bare attribute. (The round-4 tag split itself, redactFinalText's, is guarded by history-lib (d).)
  it('H-32: errLine\'s whole-text final belt masks a forged frame tag\'s bare attribute in a thrown message on stderr', () => {
    const box = boundBox('ccrc-hist-cli-ha2-h32-tag-');
    const sq = status(box, { preloads: [PRELOADS.statfs, PRELOADS.faults], env: { HISTORY_TEST_THROW_PREPARE: 'SqliteError:boom <ccrc-recall password: hunter2hunter2 x> tail@FROM counters' } });
    expect([sq.code, sq.env.reason], sq.stderr).toEqual([5, 'store-read-failed']);
    expect(sq.stderr, 'CONTROL: the line is written, the tag and the text around it kept').toMatch(/store-read-failed: boom <ccrc-recall .*> tail/);
    expect(sq.stderr).not.toContain('hunter2hunter2');
  });

  // D-5021 (fix round 1, review 441 F2): errLine's text meets no field pass, so the final belt runs it first. Values that hold < > & " and a
  // backslash were printed whole or in part by the final form's value classes alone. Red when redactFinalLines drops the field pass.
  it('H-32: a thrown message holding secrets with < > & " and a backslash is masked whole on stderr, through both doors (D-5021)', () => {
    const box = boundBox('ccrc-hist-cli-ha2-h32-f2-');
    const cases: Array<[string, string[]]> = [
      ['"token": "ab<cdXQ"', ['ab<', 'cdXQ']],
      ['{"password": "hun&ter2YZ"}', ['hun&', 'ter2YZ']],
      ['{"api_key":"abc\\"defWV"}', ['abc\\', 'defWV']],
      ['Authorization: Bearer abc&defUT', ['&defUT', 'abc&']],
      ['password=abc<defSR', ['<defSR', 'abc<']],
      ['x-ccrc-mail-token: ab<c>d&e\\fghPQ', ['<c>', 'd&e', 'e\\f', 'fghPQ']],
      ['{"x-ccrc-mail-token": "ab<c>d&e\\"fgh\\\\ijON"}', ['<c>', 'd&e', 'fgh', 'ijON']],
    ];
    const message = cases.map(([c]) => c).join('\n');
    const doors: Array<[string, string, number, string]> = [
      ['internal-error line', `Error:${message}@FROM counters`, 1, 'ccrc history: internal error: '],
      ['store-read-failed line', `SqliteError:${message}@FROM counters`, 5, 'ccrc history: store-read-failed: '],
    ];
    for (const [door, spec, code, head] of doors) {
      const r = status(box, { preloads: [PRELOADS.statfs, PRELOADS.faults], env: { HISTORY_TEST_THROW_PREPARE: spec } });
      expect(r.code, `${door}: ${r.stderr}`).toBe(code);
      expect(r.stderr, `CONTROL ${door}: the line is written`).toContain(head);
      expect(r.stderr.match(/\[redacted\]/g) ?? [], `CONTROL ${door}: one mark per case`).toHaveLength(cases.length);
      for (const [c, runs] of cases) for (const run of runs) expect(r.stderr, `${door}: ${c} leaves ${run}`).not.toContain(run);
    }
  });

  // D-5021 (ruling 5020): the shared table of f2Cases (history-lib (j3)'s) through errLine: the five characters in the JSON, Bearer, named
  // and box-token forms, whole where the form's class admits the character, the field pass's own output where it ends. Red when the
  // field pass leaves redactFinalLines.
  it('H-32: the F2 table (every form, each of < > & " and a backslash) through errLine: whole where the class admits, equal to the field pass where it ends (D-5021)', () => {
    const box = boundBox('ccrc-hist-cli-ha2-h32-f2t-');
    const cases = f2Cases().filter((c) => c.viaStream);
    const message = ['first', ...cases.map((c) => c.input)].join('\n');
    const NONE = makePairIndex([]);
    for (const [door, spec, code, head] of [
      ['internal-error line', `Error:${message}@FROM counters`, 1, 'ccrc history: internal error: '],
      ['store-read-failed line', `SqliteError:${message}@FROM counters`, 5, 'ccrc history: store-read-failed: '],
    ] as const) {
      const r = status(box, { preloads: [PRELOADS.statfs, PRELOADS.faults], env: { HISTORY_TEST_THROW_PREPARE: spec } });
      expect(r.code, `${door}: ${r.stderr}`).toBe(code);
      expect(r.stderr, `CONTROL ${door}: the line is written`).toContain(`${head}first`);
      const lines = r.stderr.split('\n');
      for (const c of cases) {
        const why = `${door}: ${c.form} with ${JSON.stringify(c.char)}`;
        const want = redactField(c.input, NONE);
        expect(lines, `${why}: the line is the field pass's own output`).toContain(want);
        // a class that ends at the character prints its tail on its own line, so a whole-mask case is judged on its own line
        for (const run of c.runs) expect(want, `${why}: leaves ${run}`).not.toContain(run);
      }
    }
  });

  // D-4614 (round 5): the CLI's own prefix must not swallow the message it carries.
  it('H-32: a message that starts with a context key behind the CLI prefix is masked on stderr (D-4614)', () => {
    const box = boundBox('ccrc-hist-cli-ha2-h32-pfx-');
    const plain = status(box, { preloads: [PRELOADS.statfs, PRELOADS.faults], env: { HISTORY_TEST_THROW_PREPARE: 'Error:TOKEN=abcdef0123456789@FROM counters' } });
    expect(plain.code, plain.stderr).toBe(1);
    expect(plain.stderr, 'CONTROL: the line is written with the key in its place').toMatch(/ccrc history: internal error: TOKEN=/);
    expect(plain.stderr).not.toContain('abcdef0123456789');
    const sq = status(box, { preloads: [PRELOADS.statfs, PRELOADS.faults], env: { HISTORY_TEST_THROW_PREPARE: 'SqliteError:<ccrc-recall TOKEN="abcdef0123456789">@FROM counters' } });
    expect(sq.stderr, 'CONTROL: the line is written').toContain('ccrc history: store-read-failed: ');
    expect(sq.stderr, 'an unframed forged tag with a quoted value').not.toContain('abcdef0123456789');
  });

  // D-4613 (round 6): errLine's text is one unframed whole-text pass, so a value on the next line and a PEM block are masked.
  it('H-32: a JSON-form pair whose value is on the next line, and a PEM block, in a thrown message are masked on stderr (D-4613 round 6)', () => {
    const box = boundBox('ccrc-hist-cli-ha2-h32-ml-');
    const json = status(box, { preloads: [PRELOADS.statfs, PRELOADS.faults], env: { HISTORY_TEST_THROW_PREPARE: 'Error:{"token":\n"s3cr3tVALUE123"}@FROM counters' } });
    expect(json.code, json.stderr).toBe(1);
    expect(json.stderr, 'CONTROL: the line is written').toContain('ccrc history: internal error: ');
    expect(json.stderr).not.toContain('s3cr3tVALUE123');
    const pem = status(box, { preloads: [PRELOADS.statfs, PRELOADS.faults], env: { HISTORY_TEST_THROW_PREPARE: 'Error:-----BEGIN PRIVATE KEY-----\nMIIBVgIBADANBgkqhkiG9w0BAQEFAASCAUAwggE8\n-----END PRIVATE KEY-----@FROM counters' } });
    expect(pem.code, pem.stderr).toBe(1);
    expect(pem.stderr, 'CONTROL: the line is written').toContain('ccrc history: internal error: ');
    expect(pem.stderr).not.toContain('MIIB');
  });

  it('H-32: no stderr write in cli.mjs prints an error message except through errLine, which redacts', () => {
    const src = fs.readFileSync(path.join(REPO, 'ccd', 'history', 'cli.mjs'), 'utf8');
    // H-168: scan by line, not by regex up to ';' (an argument can hold one). Every write stands on one line, so the count below
    // proves the scan sees them all; a new write is a deliberate edit of this number and of the allowlist beside it.
    const writes = src.split('\n').filter((l) => /process\.stderr\.write\(/.test(l));
    expect(writes.length, 'the scan sees every stderr write').toBe(8);   // W2-1 removed the recall-off stub's one write with the stub
    expect(writes.filter((w) => /\.message|String\(e\)|\$\{e\b/.test(w)), 'a raw error text on stderr').toEqual([]);
    // Each write's argument is a fixed line (it starts `ccrc history` or `${USAGE}`), errLine's redactFinalLines, the op relay's `text`, or
    // an EMPTY write (D-5022: the signal handler's and the exit's wait for stderr to drain write nothing, they only wait on a callback).
    const allowed = /process\.stderr\.write\((?:[`']ccrc history|`\$\{USAGE\}|redactFinalLines\(|text\)|'', )/;
    expect(writes.filter((w) => !allowed.test(w)), 'a write whose argument is neither a fixed line, errLine\'s redactFinal nor the relay text').toEqual([]);
    const fn = /function errLine\([^)]*\) \{([\s\S]*?)\n\}/.exec(src);
    expect(fn, 'errLine is defined').not.toBeNull();
    expect(fn![1]).toContain('redactFinalLines(');
    // D-4613 round 5: the other lines the CLI never frames take the per-line belt too (emitRefusal's human line, the operator relay's emit)
    expect(src).toContain('redactFinalLines(refusalLine(r.exit, r.reason), pairIdx)');
    // D-5747 (W5h-2 Task 3): the relay's emit reads each SOURCE stream through its look-behind, lib redactAfter, whose every reading is redactFinalLines
    expect(src).toContain('const r = healthLib.redactAfter(behind[k], text, idx);');
    expect(src).toContain('emit(r.emit, fromStderr);');
    expect((src.match(/\berrLine\(/g) ?? []).length, 'the definition and the three message sites').toBeGreaterThanOrEqual(5);
  });

  // HA2 H-78 (D-4604): status's fts word is the word grep is gated by, both reading the same three facts.
  it('H-78: status fts reads fts-pending while a repair rebuild is open or the backfill row is incomplete, as grep does', () => {
    const box = boundBox('ccrc-hist-cli-ha2-h78-');
    expect(status(box).env.fts, 'CONTROL: a finished backfill is ready').toBe('ready');
    const db = new DatabaseSync(dbFile(box));
    try {
      db.exec("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('fts-rebuild', 1, NULL, NULL)");
      expect(status(box).env.fts, 'an open rebuild row').toBe('fts-pending');
      db.exec("DELETE FROM derivation_state WHERE step = 'fts-rebuild'");
      expect(status(box).env.fts, 'CONTROL: the rebuild row closed').toBe('ready');
      db.exec("UPDATE derivation_state SET completed_ms = NULL WHERE step = 'fts' AND version = 1");
      expect(status(box).env.fts, 'a backfill that has not completed').toBe('fts-pending');
    } finally { db.close(); }
  });

  // HA2 H-24 (D-4599): a bound store at user_version 0 is damage, not a pending migration.
  it('H-24: status on a store at user_version 0 answers 5 store-schema-missing', () => {
    const box = boundBox('ccrc-hist-cli-ha2-h24-');
    const db = new DatabaseSync(dbFile(box));
    try { db.exec('PRAGMA user_version = 0'); } finally { db.close(); }
    const r = status(box);
    expect([r.code, r.env.reason], r.stderr).toEqual([5, 'store-schema-missing']);
    expect(r.env.user_version).toBe(0);
  });

  // FU4 M31 (review 316 F11 named "corrupt"): a bound store with the page at offset 2 * 4096 destroyed, the WAL checkpointed
  // first. MEASURED: the damage is caught BEFORE readStoreAnswered, by measureStoreFacts' peekStoreId (its read of the db's own
  // meta.store_id, the binding read), which fails: store-unmeasured, never store-read-failed (that word is
  // the F11 cases above, whose binding read passes). Either way it is ONE envelope with exit 5, not exit 1 with empty stdout.
  it('M31: a bound store with a page destroyed past the header answers ONE envelope, exit 5, never exit 1 with empty stdout', () => {
    const box = boundBox('ccrc-hist-cli-m31-');
    const db = new DatabaseSync(dbFile(box));
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');   // every page is in the main file, so the damage is what a read meets
    db.close();
    const fd = fs.openSync(dbFile(box), 'r+');
    try { fs.writeSync(fd, Buffer.alloc(4096, 0xa5), 0, 4096, 2 * 4096); } finally { fs.closeSync(fd); }
    const r = status(box);
    expect(r.code, r.stderr).toBe(5);
    expect(r.stdout.trim(), 'one JSON envelope, never an empty stdout').not.toBe('');
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
    expect(r.env.exit).toBe(5);
    expect(r.env.reason, r.stderr).toBe('store-unmeasured');
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
    expect([e.user_version, e.code_version, e.migration]).toEqual([SCHEMA_VERSION, SCHEMA_VERSION, 'none']);
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
    expect(e.pass, 'D-5016: no pass marker, no pass fact (the key is always present, additive)').toBeNull();
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

  it('an unknown verb is bad-args with the usage on stderr, and --json carries the reason; --help prints the usage (W1-B2)', () => {
    const box = boundBox('ccrc-hist-cli-bad-');
    const plain = status(box, { args: ['frobnicate', 'x'] });
    expect(plain.code).toBe(2);
    expect(plain.stderr).toMatch(/^usage: ccrc history <verb> \[options\]$/m);
    const json = status(box, { args: ['frobnicate', '--json'] });
    expect([json.code, json.env.reason]).toEqual([2, 'bad-args']);
    expectIdentity(json.env);
    expect(status(box, { args: [] }).code).toBe(2);
    expect(status(box, { args: ['status', 'extra'] }).code).toBe(2);
    const help = status(box, { args: ['--help'] });
    expect(help.code).toBe(0);
    expect(help.stdout).toMatch(/^usage: ccrc history <verb> \[options\]$/m);
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

  // D-5016 (history-doctor-reads-a-live-pass): status measures the scheduled pass's marker (`pass: { pid, start_ms, live }`), and the
  // health decision reads a LIVE pass as a fresh tick (started within TICK_STALE_MS) or as hung (past it). `live` is an IDENTITY test:
  // the pid's start time (/proc/<pid>/stat field 22) and the boot id, measured now, equal the marker's.
  describe('the pass marker (D-5016)', () => {
    const MIN = 60_000;
    const passFile = (box: healthHh.HistoryBox): string => healthPath.join(box.home, '.ccrc', 'history', 'pass');
    const identityOf = (pid: number): { procStart: string; bootId: string } => {
      const procStart = procStartOf(healthFs.readFileSync(`/proc/${pid}/stat`, 'utf8'));
      const bootId = bootIdOf(healthFs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8'));
      if (procStart === null || bootId === null) throw new Error('this box has no /proc identity');
      return { procStart, bootId };
    };
    /** A bound store whose last tick is 40 minutes old, on a box whose shim is long placed: the tick-stale baseline. */
    const staleBox = (prefix: string): healthHh.HistoryBox => {
      const box = healthHh.makeHistoryBox(prefix, { role: 'fleet', shim: true });
      ageFile(shimOf(box), 120 * MIN);
      tickedStore(box, Date.now() - 40 * MIN);
      const db = healthStore.openWriter(dbFile(box));       // lag measured as of now, so only the tick is old (no lag-high beside it)
      try { healthStore.setMeta(db, 'last_zero_behind_ms', String(Date.now())); } finally { healthStore.closeWriter(db); }
      return box;
    };
    const plant = (box: healthHh.HistoryBox, pid: number, ago: number, identity = identityOf(pid)): void => {
      healthFs.mkdirSync(healthPath.dirname(passFile(box)), { recursive: true, mode: 0o700 });
      healthFs.writeFileSync(passFile(box), formatPassMarker(pid, Date.now() - ago, identity), { mode: 0o600 });
    };
    const failOf = (r: { env: Envelope | null }): Array<{ word: string; detail: string }> => r.env!['health']['fail'];

    it('(c) CONTROL: with no marker, a 40 min old tick is FAIL tick-stale as it always was, and pass is null', () => {
      const box = staleBox('ccrc-history-pass-none-');
      const r = statusOf(box);
      expect(r.env!['pass']).toBeNull();
      expect(wordsOf(failOf(r))).toEqual(['tick-stale']);
      expect(failOf(r)[0]!.detail).toContain('the last tick ran 40 min ago');
    });

    it('(a) a marker whose identity measures equal (a live pass) started 7 min ago: pass.live, and the 40 min old tick is no tick-stale FAIL', () => {
      const box = staleBox('ccrc-history-pass-fresh-');
      plant(box, process.pid, 7 * MIN);
      const r = statusOf(box);
      expect(r.env!['pass']).toMatchObject({ pid: process.pid, live: true });
      expect(r.env!['pass']['start_ms']).toBeGreaterThan(Date.now() - 8 * MIN);
      expect(wordsOf(failOf(r))).toEqual([]);
    });

    it('(b) the same live pass started 11 min ago is FAIL tick-stale naming a pass that is still running', () => {
      const box = staleBox('ccrc-history-pass-hung-');
      plant(box, process.pid, 11 * MIN);
      const r = statusOf(box);
      expect(r.env!['pass']['live']).toBe(true);
      expect(wordsOf(failOf(r))).toEqual(['tick-stale']);
      expect(failOf(r)[0]!.detail).toContain(`the scheduled pass (pid ${process.pid}) started 11 min ago and is still running`);
    });

    it('(d) a dead pid, a LIVE pid with another start time (a reused pid), another boot id and a malformed marker each read as not live', () => {
      const box = staleBox('ccrc-history-pass-notlive-');
      const dead = spawnSync(process.execPath, ['-e', '']).pid!;              // a pid that has already exited
      const me = identityOf(process.pid);
      const cases: Array<[string, () => void, boolean]> = [
        ['a dead pid with a start time it once had', () => plant(box, dead, 2 * MIN, { procStart: String(Number(me.procStart) + 1), bootId: me.bootId }), false],
        ['a live pid recorded with a start time one tick off', () => plant(box, process.pid, 2 * MIN, { procStart: String(Number(me.procStart) + 1), bootId: me.bootId }), false],
        ['a live pid recorded under another boot id', () => plant(box, process.pid, 2 * MIN, { procStart: me.procStart, bootId: '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e' }), false],
        ['CONTROL: the same live pid, recorded as measured', () => plant(box, process.pid, 2 * MIN), true],
      ];
      for (const [what, arrange, live] of cases) {
        arrange();
        const r = statusOf(box);
        expect(r.env!['pass'], what).toMatchObject({ pid: expect.any(Number), live });
        expect(wordsOf(failOf(r)), what).toEqual(live ? [] : ['tick-stale']);
        if (!live) expect(failOf(r)[0]!.detail, what).not.toContain('still running');
      }
      for (const junk of ['', 'garbage\n', `${process.pid} 1 2\n`, `import ${process.pid} ${Date.now()}\n`]) {
        healthFs.writeFileSync(passFile(box), junk, { mode: 0o600 });
        const r = statusOf(box);
        expect(r.env!['pass'], JSON.stringify(junk)).toBeNull();
        expect(wordsOf(failOf(r)), JSON.stringify(junk)).toEqual(['tick-stale']);
      }
      healthFs.rmSync(passFile(box));
      healthCp.execFileSync('mkfifo', [passFile(box)]);                        // a FIFO is never waited on, and names no pass
      const fifo = statusOf(box, ['--json'], { preloads: [], env: {}, timeoutMs: 8_000 });
      expect(fifo.env!['pass']).toBeNull();
      expect(wordsOf(failOf(fifo))).toEqual(['tick-stale']);
    });

    it('(d) a marker a KILLED pass left reads live while its process stands and not live once it is killed', async () => {
      const box = staleBox('ccrc-history-pass-killed-');
      const child = healthCp.spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
      try {
        await new Promise<void>((resolve, reject) => { child.once('spawn', () => resolve()); child.once('error', reject); });
        plant(box, child.pid!, 2 * MIN);
        expect(statusOf(box).env!['pass']).toMatchObject({ pid: child.pid, live: true });
        const gone = new Promise<void>((resolve) => child.once('exit', () => resolve()));
        child.kill('SIGKILL');
        await gone;
        const r = statusOf(box);
        expect(r.env!['pass']).toMatchObject({ pid: child.pid, live: false });
        expect(wordsOf(failOf(r))).toEqual(['tick-stale']);
      } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
    });

    // D-5026 (batch A2, item 4): status reads the marker, then measures its pid's identity. A pass that writes no tick (held, migrated) and
    // ends through its `finally` between the two reads must not read as a dead marker started after the last tick. The faults preload
    // removes the marker at the identity measure's own read (HISTORY_TEST_UNLINK_ON_PROC_STAT), once.
    it('(D-5026) a marker removed between status\'s read of it and its identity measure is no marker (pass null, no death FAIL); one that stays is still a death', () => {
      const box = healthHh.makeHistoryBox('ccrc-history-passgone-', { role: 'fleet', shim: true });
      ageFile(shimOf(box), 120 * MIN);
      tickedStore(box, Date.now() - 5 * MIN);                                   // a fresh tick: only a death can FAIL
      const dead = spawnSync(process.execPath, ['-e', '']).pid!;                // a pid that has already exited: its identity measures nothing
      const me = identityOf(process.pid);
      const arrange = (): void => plant(box, dead, 2 * MIN, { procStart: me.procStart, bootId: me.bootId });
      arrange();
      const stays = statusOf(box);
      expect(stays.env!['pass'], 'CONTROL: no preload, the marker is still there: a dead one, started after the last tick').toMatchObject({ pid: dead, live: false });
      expect(wordsOf(failOf(stays))).toEqual(['tick-stale']);
      expect(failOf(stays)[0]!.detail).toContain('ended without writing a tick');
      arrange();
      const gone = statusOf(box, ['--json'], { preloads: [healthHh.PRELOADS.faults], env: { HISTORY_TEST_UNLINK_ON_PROC_STAT: passFile(box) } });
      expect(healthFs.existsSync(passFile(box)), 'the seam removed the marker at the identity measure').toBe(false);
      expect(gone.env!['pass'], 'the pass ended through its finally: no marker').toBeNull();
      expect(wordsOf(failOf(gone))).toEqual([]);
    });

    // D-5026 (batch A3): the other arm of status's second read. When the marker is there again with DIFFERENT text, another pass wrote
    // its own marker in the gap: status parses that text and measures its identity once, and reports what that measure says (live, not
    // live, or no marker when it does not parse). It is never `pass: null` for a marker that is there and measures live. The faults
    // preload replaces the marker at the identity measure's own read (HISTORY_TEST_SWAP_ON_PROC_STAT, the text in ..._TEXT), once.
    it('(D-5026) a marker REPLACED between status\'s read of it and its identity measure is measured once and reported as that measure says: a new live pass reads live (no death FAIL), a new dead one reads dead, a malformed one is no marker', () => {
      const box = healthHh.makeHistoryBox('ccrc-history-passswap-', { role: 'fleet', shim: true });
      ageFile(shimOf(box), 120 * MIN);
      tickedStore(box, Date.now() - 5 * MIN);                                   // a fresh tick: only a death can FAIL
      const dead = spawnSync(process.execPath, ['-e', '']).pid!;                // a pid that has already exited: its identity measures nothing
      const dead2 = spawnSync(process.execPath, ['-e', '']).pid!;               // another one, for the replacement that is dead too
      const me = identityOf(process.pid);
      const arrange = (): void => plant(box, dead, 2 * MIN, { procStart: me.procStart, bootId: me.bootId });
      const swapped = (text: string): { code: number | null; stdout: string; env: Envelope | null } =>
        statusOf(box, ['--json'], { preloads: [healthHh.PRELOADS.faults], env: { HISTORY_TEST_SWAP_ON_PROC_STAT: passFile(box), HISTORY_TEST_SWAP_ON_PROC_STAT_TEXT: text } });

      arrange();
      const liveStart = Date.now() - 1 * MIN;
      const liveText = formatPassMarker(process.pid, liveStart, me);
      const live = swapped(liveText);
      expect(healthFs.readFileSync(passFile(box), 'utf8'), 'the seam replaced the marker at the identity measure').toBe(liveText);
      expect(live.env!['pass'], 'a new pass wrote its own marker in the gap: it is reported live, not as no pass at all').toMatchObject({ pid: process.pid, live: true });
      expect(live.env!['pass']['start_ms'], 'the replacement\'s start, not the dead marker\'s').toBe(liveStart);
      expect(wordsOf(failOf(live)), 'a live pass is no death').toEqual([]);

      arrange();
      const deadText = formatPassMarker(dead2, Date.now() - 1 * MIN, me);
      const another = swapped(deadText);
      expect(another.env!['pass'], 'the replacement\'s own measure says not live, and that stands (no loop)').toMatchObject({ pid: dead2, live: false });
      expect(wordsOf(failOf(another))).toEqual(['tick-stale']);
      expect(failOf(another)[0]!.detail).toContain('ended without writing a tick');

      arrange();
      const junk = swapped('garbage\n');
      expect(junk.env!['pass'], 'a replacement that is not in the grammar is no marker').toBeNull();
      expect(wordsOf(failOf(junk))).toEqual([]);
    });

    // D-5026 (history-pass-death-record; fix round 2, review 462 F1): `status` reads the record a pass left when it found a pass that
    // ended without its tick (`pass_died`: the parsed record, null only when absent). One that is there and cannot be read is
    // 'unmeasured' and reaches doctor as status-unreadable (the no-overloaded-null rule), never as "no death".
    const diedFile = (box: healthHh.HistoryBox): string => healthPath.join(box.home, '.ccrc', 'history', 'pass-died');
    const plantDied = (box: healthHh.HistoryBox, startMsAgo: number, count = 1): void => {
      healthFs.mkdirSync(healthPath.dirname(diedFile(box)), { recursive: true, mode: 0o700 });
      healthFs.writeFileSync(diedFile(box), `${JSON.stringify({ pid: 4242, start_ms: Date.now() - startMsAgo, found_ms: Date.now() - startMsAgo + 2 * MIN, count })}\n`, { mode: 0o600 });
    };
    it('(D-5026) an open death record beside a young LIVE pass is FAIL tick-stale naming the death: status gives pass_died, the live pass holds nothing back', () => {
      const box = staleBox('ccrc-history-passdied-open-');
      plant(box, process.pid, 0.5 * MIN);
      expect(wordsOf(failOf(statusOf(box))), 'CONTROL: a live young pass alone is fresh').toEqual([]);
      plantDied(box, 20 * MIN, 2);
      const r = statusOf(box);
      expect(r.env!['pass_died']).toMatchObject({ pid: 4242, count: 2 });
      expect(wordsOf(failOf(r))).toEqual(['tick-stale']);
      expect(failOf(r)[0]!.detail).toContain('the sweep has recorded 2 scheduled pass(es) that ended without writing a tick since its last clear');
      expect(failOf(r)[0]!.detail).toContain('pid 4242');
    });
    it('(D-5026) a record whose start is at or before the last tick is closed (the removal after its tick was cut off), and an absent one is null', () => {
      const box = staleBox('ccrc-history-passdied-closed-');
      expect(statusOf(box).env!['pass_died'], 'absent is null').toBeNull();
      plantDied(box, 41 * MIN);                                                 // the tick is 40 min old: this pass started before it
      plant(box, process.pid, 0.5 * MIN);
      const r = statusOf(box);
      expect(r.env!['pass_died']).toMatchObject({ count: 1 });
      expect(wordsOf(failOf(r))).toEqual([]);
    });
    it('(D-5026) a record that is there and cannot be read or parsed is pass_died "unmeasured" and FAIL status-unreadable naming it, never no death', () => {
      const box = healthHh.makeHistoryBox('ccrc-history-passdied-unreadable-', { role: 'fleet', shim: true });
      ageFile(shimOf(box), 60 * MIN);
      tickedStore(box, Date.now());
      expect(statusOf(box).env!['health']['pass'], 'CONTROL: a fresh tick and no record is PASS ok').toBe('ok');
      healthFs.mkdirSync(healthPath.dirname(diedFile(box)), { recursive: true, mode: 0o700 });
      for (const junk of ['', 'garbage\n', '{"pid":4242,"start_ms":1,"found_ms":2}\n', '{"pid":4242,"start_ms":1,"found_ms":2,"count":0}\n']) {
        healthFs.writeFileSync(diedFile(box), junk, { mode: 0o600 });
        const r = statusOf(box);
        expect(r.env!['pass_died'], JSON.stringify(junk)).toBe('unmeasured');
        expect(wordsOf(failOf(r)), JSON.stringify(junk)).toEqual(['status-unreadable']);
        expect(failOf(r)[0]!.detail, JSON.stringify(junk)).toContain('pass-died');
      }
      healthFs.rmSync(diedFile(box));
      healthFs.mkdirSync(diedFile(box), { mode: 0o700 });                                       // a planted directory is not "absent" either
      const dir = statusOf(box);
      expect(dir.env!['pass_died']).toBe('unmeasured');
      expect(wordsOf(failOf(dir))).toEqual(['status-unreadable']);
    });

    // W5h-2 Task 4 (D-5748 (history-op-marker-identity)): the op marker names its process as the pass marker does, and status's
    // op.alive is lib's decideOpLive over what it measures now. A marker behind a reused pid (D-5026's residual (i)) no longer reads
    // as a live operator pass, so it holds back neither the death line nor the freshness FAILs; a legacy three-field marker, from a
    // pass of the older build, is read by the kill probe, with EPERM not live.
    const opFile = (box: healthHh.HistoryBox): string => healthPath.join(box.home, '.ccrc', 'history', 'op');
    const plantOp = (box: healthHh.HistoryBox, text: string): void => {
      healthFs.mkdirSync(healthPath.dirname(opFile(box)), { recursive: true, mode: 0o700 });
      healthFs.writeFileSync(opFile(box), text, { mode: 0o600 });
    };
    it('(D-5748) an op marker naming a live pid with another start time (a reused pid) is op.alive false: no op-running WARN, and the death line it hid FAILs tick-stale', () => {
      const box = staleBox('ccrc-history-op-reused-');
      plantDied(box, 20 * MIN);
      const me = identityOf(process.pid);
      const start = Date.now() - 30 * MIN;
      plantOp(box, `prune ${process.pid} ${start} ${me.procStart} ${me.bootId}\n`);
      const held = statusOf(box);
      expect(held.env!['op'], 'CONTROL: the identity measured equal is a live operator pass').toEqual({ verb: 'prune', pid: process.pid, alive: true, start_ms: start });
      expect(wordsOf(held.env!['health']['warn'])).toContain('op-running');
      expect(wordsOf(failOf(held)), 'CONTROL: a live operator pass holds the death line back (D-5026, batch A2)').toEqual([]);
      plantOp(box, `prune ${process.pid} ${start} ${String(Number(me.procStart) + 1)} ${me.bootId}\n`);
      const r = statusOf(box);
      expect(r.env!['op']).toEqual({ verb: 'prune', pid: process.pid, alive: false, start_ms: start });
      expect(wordsOf(r.env!['health']['warn'])).not.toContain('op-running');
      expect(wordsOf(failOf(r))).toEqual(['tick-stale']);
      expect(failOf(r)[0]!.detail).toContain('ended without writing a tick');
    });
    it.skipIf(process.getuid?.() === 0)('(D-5748) a legacy three-field op marker is read by the kill probe: this test\'s own pid is live, and pid 1, which this user may not signal, is not', () => {
      const box = staleBox('ccrc-history-op-legacy-');
      plantOp(box, `prune ${process.pid} 1700000000000\n`);
      const own = statusOf(box);
      expect(own.env!['op'], 'the rollout window: an older build\'s pass reads live').toEqual({ verb: 'prune', pid: process.pid, alive: true, start_ms: 1700000000000 });
      expect(wordsOf(failOf(own))).toEqual([]);
      expect(() => process.kill(1, 0), 'CONTROL: pid 1 is another user\'s process here').toThrow(/EPERM/);
      plantOp(box, 'prune 1 1700000000000\n');
      const r = statusOf(box);
      expect(r.env!['op']).toEqual({ verb: 'prune', pid: 1, alive: false, start_ms: 1700000000000 });
      expect(wordsOf(failOf(r))).toEqual(['tick-stale']);
    });
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

  // F2: the sweep's readSmall opens ONCE, nonblocking, and judges the type on the descriptor (the `_reg_read` lesson: a
  // FIFO with no writer blocks in open(2) for ever; D-4347 (history-planted-entries-never-wedge)). status must do the same: a FIFO named *.obs returns within
  // a bound and is reported unmeasured.
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

  it('a FIFO at history-max-gb, op, accounts.sh or store.id never blocks status (review 316 F10)', () => {
    const box = healthHh.makeHistoryBox('ccrc-history-health-ctl-fifo-', { role: 'fleet', shim: true });
    ageFile(shimOf(box), 60 * 60_000);
    tickedStore(box, Date.now());
    const cap = healthPath.join(box.home, '.ccrc', 'history-max-gb');
    const op = healthPath.join(box.home, '.ccrc', 'history', 'op');
    const acc = healthPath.join(box.home, '.ccrc', 'accounts.sh');
    const sid = healthPath.join(box.home, '.ccrc', 'history', 'store.id');
    for (const file of [cap, op, acc, sid]) {
      const saved = healthFs.existsSync(file) ? healthFs.readFileSync(file, 'utf8') : null;
      healthFs.rmSync(file, { force: true });
      healthCp.execFileSync('mkfifo', [file]);
      try {
        const r = statusOf(box, ['--json'], { preloads: [], env: {}, timeoutMs: 8_000 });
        if (file === sid) {
          expect(r.code, file).toBe(5);
          expect(r.env!['reason'], file).toBe('store-unmeasured');
        } else {
          expect(r.code, file).toBe(0);
          if (file === cap) {
            expect(r.env!['cap_malformed']).toBe(true);
            expect(r.env!['cap_gb']).toBe(50);
          }
        }
      } finally {
        healthFs.rmSync(file, { force: true });
        if (saved !== null) healthFs.writeFileSync(file, saved);
      }
    }
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

  // review 316 F9 and F20 (D-4347 (history-planted-entries-never-wedge)): status judges a sidecar by the sweep's own predicate, and an orphan is not held.
  const fullObs = (observedMs: number): Record<string, unknown> => ({
    v: 1, observedMs, uuid: { state: 'absent' }, generation: { state: 'absent' }, project: { state: 'absent' }, workdir: { state: 'absent' },
    late: null, journalT: null, journaled: null, heldMatches: {},
  });
  it('a sidecar that fails the observation grammar is not a held file (review 316 F9)', () => {
    const box = healthHh.makeHistoryBox('ccrc-history-health-sidecar-grammar-', { role: 'fleet', shim: true });
    ageFile(shimOf(box), 60 * 60_000);
    tickedStore(box, Date.now());
    const dir = healthPath.join(box.home, '.ccrc', 'history', 'spool', '.draining');
    healthFs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    healthFs.writeFileSync(healthPath.join(dir, 'x.900.1.jsonl'), '');
    const old = Date.now() - 6 * 60 * 60_000;
    healthFs.writeFileSync(healthPath.join(dir, 'x.900.1.obs'), JSON.stringify({ v: 1, observedMs: old, journaled: null }), { mode: 0o600 });
    expect(wordsOf(statusOf(box).env!['health']['fail'])).not.toContain('journal-unwritable');
    healthFs.writeFileSync(healthPath.join(dir, 'x.900.1.obs'), JSON.stringify(fullObs(old)), { mode: 0o600 });   // CONTROL
    expect(wordsOf(statusOf(box).env!['health']['fail'])).toContain('journal-unwritable');
  });

  // FU3F review F2: a blocked file (a directory at its sidecar name, planted/ unusable) is spool-planted, never a journal hold or an unmeasured read.
  it.each([['.obs.tmp'], ['.obs']])('a file blocked by a directory at %s is not a held file however old, and the counted block is WARN spool-planted (FU3F review F2)', (suffix) => {
    const box = healthHh.makeHistoryBox('ccrc-history-health-blocked-', { role: 'fleet', shim: true });
    ageFile(shimOf(box), 60 * 60_000);
    tickedStore(box, Date.now());
    const db = healthStore.openWriter(dbFile(box));
    try { db.prepare('INSERT INTO counters (name, n) VALUES (?, ?)').run('spool_blocked', 1); } finally { healthStore.closeWriter(db); }
    const dir = healthPath.join(box.home, '.ccrc', 'history', 'spool', '.draining');
    healthFs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    healthFs.writeFileSync(healthPath.join(dir, 'x.900.1.jsonl'), '');
    const planted = healthPath.join(dir, `x.900.1${suffix}`);
    healthFs.mkdirSync(planted);
    healthFs.writeFileSync(healthPath.join(planted, 'keep'), '');
    if (suffix === '.obs.tmp') healthFs.writeFileSync(healthPath.join(dir, 'x.900.1.obs'), JSON.stringify(fullObs(Date.now() - 6 * 60 * 60_000)), { mode: 0o600 });
    const h = statusOf(box).env!['health'];
    expect(wordsOf(h['fail'])).not.toContain('journal-unwritable');
    expect(wordsOf(h['fail'])).not.toContain('status-unreadable');
    expect(wordsOf(h['warn'])).toContain('spool-planted');
    if (suffix === '.obs.tmp') {   // CONTROL: the same sidecar with no directory beside it is a hold
      healthFs.rmSync(planted, { recursive: true });
      expect(wordsOf(statusOf(box).env!['health']['fail'])).toContain('journal-unwritable');
    }
  });

  // FU6 (B3M11), measured: the FU3F two-entry fixture through the REAL sweep (blocked A, drained B), then status. A's regular
  // sidecar still says `journaled: null` and is six hours old, but A is blocked (a non-empty directory at its sidecar-temp
  // name, `planted/` unusable), so the only line status prints for it is WARN spool-planted: no FAIL journal-unwritable, no
  // FAIL status-unreadable, no oldest-unjournaled age. This CONTROL pins that answer; the skip it rests on is the one the case
  // above mutates. Root bypasses the 0500 modes, so the fixture cannot block there.
  it.skipIf(process.getuid?.() === 0)('a blocked file and a drained one through the real sweep: status prints WARN spool-planted and no FAIL for the blocked file\'s age (FU6, B3M11 CONTROL)', () => {
    const box = healthHh.makeHistoryBox('ccrc-history-health-blocked-real-', { role: 'fleet', shim: true });
    ageFile(shimOf(box), 60 * 60_000);
    tickedStore(box, Date.now());
    const dir = healthPath.join(box.home, '.ccrc', 'history', 'spool', '.draining');
    healthFs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stop = (id: string): string => `\n${JSON.stringify({ v: 1, ev: 'Stop', id })}\n`;
    healthFs.writeFileSync(healthPath.join(dir, 'claude-a-demo.900.1.jsonl'), stop('claude-a-demo'));        // A, first in drain order
    healthFs.writeFileSync(healthPath.join(dir, 'claude-a-other.902.1.jsonl'), stop('claude-a-other'));      // B
    const plantedMs = Date.now() - 6 * 60 * 60_000;
    healthFs.writeFileSync(healthPath.join(dir, 'claude-a-demo.900.1.obs'), JSON.stringify(fullObs(plantedMs)), { mode: 0o600 });
    const tmp = healthPath.join(dir, 'claude-a-demo.900.1.obs.tmp');
    healthFs.mkdirSync(tmp);
    healthFs.writeFileSync(healthPath.join(tmp, 'keep'), '');
    healthFs.chmodSync(tmp, 0o500);
    const planted = healthPath.join(dir, 'planted');
    healthFs.mkdirSync(planted);
    healthFs.writeFileSync(healthPath.join(planted, 'keep'), '');
    healthFs.chmodSync(planted, 0o500);                                                                       // no area can be made in it
    try {
      const r = healthHh.runSweep(box);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stderr).toContain('history-sweep: spool-blocked: claude-a-demo.900.1.jsonl\n');
      expect(healthFs.readdirSync(dir).filter((n) => n.endsWith('.jsonl'))).toEqual(['claude-a-demo.900.1.jsonl']);   // B drained, A stays live
      expect(healthFs.existsSync(healthPath.join(dir, 'claude-a-demo.900.1.obs')), 'A keeps its sidecar').toBe(true);
      // FU9 (B4M6): the CONTROL's own precondition, measured after the sweep. The absence of a FAIL below means something only
      // while A is still a held-looking file (`journaled: null`, the planted six-hour-old observation) that the sweep skipped
      // unjournaled, and B (A's neighbour, another id) is gone from `.draining/` through the drain.
      const obs = JSON.parse(healthFs.readFileSync(healthPath.join(dir, 'claude-a-demo.900.1.obs'), 'utf8')) as { journaled: unknown; observedMs: number };
      expect(obs.journaled, 'A was skipped, never journaled').toBeNull();
      expect(obs.observedMs, 'A\'s rename-time observation is the planted one').toBe(plantedMs);
      expect(healthFs.readdirSync(dir).filter((n) => n.startsWith('claude-a-other')), 'B drained: nothing of it is left in .draining/').toEqual([]);
      const h = statusOf(box).env!['health'];
      expect(wordsOf(h['fail'])).not.toContain('journal-unwritable');
      expect(wordsOf(h['fail'])).not.toContain('status-unreadable');
      expect(wordsOf(h['warn'])).toContain('spool-planted');
    } finally { healthFs.chmodSync(planted, 0o700); healthFs.chmodSync(tmp, 0o700); }
  });

  // FU8 (FP5): the drain skips a draining file whose bytes or sidecar it cannot read, and holds its id's later files behind it;
  // none of them is a journal hold. Status walks the drain's journaling order, so `x.1000.1`, which sorts before `x.900.1`
  // lexically, is still known to wait behind it. Root opens a mode-000 file, so these skip as root.
  describe.skipIf(process.getuid?.() === 0)('a draining file or sidecar the sweep cannot read (FU8, FP5)', () => {
    it.each([['file'], ['sidecar']])('an unreadable %s and its id\'s later file are not held files however old; the counted skip is WARN spool-planted', (what) => {
      const box = healthHh.makeHistoryBox('ccrc-history-health-unreadable-', { role: 'fleet', shim: true });
      ageFile(shimOf(box), 60 * 60_000);
      tickedStore(box, Date.now());
      const db = healthStore.openWriter(dbFile(box));
      try { db.prepare('INSERT INTO counters (name, n) VALUES (?, ?)').run('spool_unreadable', 1); } finally { healthStore.closeWriter(db); }
      const dir = healthPath.join(box.home, '.ccrc', 'history', 'spool', '.draining');
      healthFs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      for (const stem of ['x.900.1', 'x.1000.1']) {
        healthFs.writeFileSync(healthPath.join(dir, `${stem}.jsonl`), '', { mode: 0o600 });
        healthFs.writeFileSync(healthPath.join(dir, `${stem}.obs`), JSON.stringify(fullObs(Date.now() - 6 * 60 * 60_000)), { mode: 0o600 });
      }
      const locked = healthPath.join(dir, what === 'file' ? 'x.900.1.jsonl' : 'x.900.1.obs');
      healthFs.chmodSync(locked, 0o000);
      try {
        const h = statusOf(box).env!['health'];
        expect(wordsOf(h['fail'])).not.toContain('journal-unwritable');   // at cf544c151: FAIL journal-unwritable, a journal-space remedy
        if (what === 'file') expect(wordsOf(h['fail'])).not.toContain('status-unreadable');
        else expect(wordsOf(h['fail']), 'a sidecar status cannot read stays unmeasured').toContain('status-unreadable');
        const warn = (h['warn'] as Array<{ word: string; detail: string }>).find((i) => i.word === 'spool-planted');
        expect(warn?.detail).toContain('1 skipped drain(s) of a draining file or its sidecar the sweep could not read');
        healthFs.chmodSync(locked, 0o600);                                   // CONTROL: readable, both are held files
        expect(wordsOf(statusOf(box).env!['health']['fail'])).toContain('journal-unwritable');
      } finally { healthFs.chmodSync(locked, 0o600); }
    });
  });

  // FU8: a directory at a live file's sidecar name holds its id's later files too (the drain blocks or defers that file and
  // holds the id behind it, or moves the directory and drains them all in order), so none of them is a held file before that
  // drain; and a link at a draining name is no unopenable file (the drain removes it, counted non_regular, and drains the
  // id's later files), so it holds nothing behind it.
  const heldPair = (prefix: string): { box: healthHh.HistoryBox; dir: string } => {
    const box = healthHh.makeHistoryBox(prefix, { role: 'fleet', shim: true });
    ageFile(shimOf(box), 60 * 60_000);
    tickedStore(box, Date.now());
    const dir = healthPath.join(box.home, '.ccrc', 'history', 'spool', '.draining');
    healthFs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    healthFs.writeFileSync(healthPath.join(dir, 'x.1000.1.jsonl'), '', { mode: 0o600 });
    healthFs.writeFileSync(healthPath.join(dir, 'x.1000.1.obs'), JSON.stringify(fullObs(Date.now() - 6 * 60 * 60_000)), { mode: 0o600 });
    return { box, dir };
  };

  it('a directory at a draining file\'s sidecar-temp name skips its id\'s later file too, however old; without it both are held files (FU8)', () => {
    const { box, dir } = heldPair('ccrc-history-health-planted-later-');
    healthFs.writeFileSync(healthPath.join(dir, 'x.900.1.jsonl'), '', { mode: 0o600 });
    healthFs.writeFileSync(healthPath.join(dir, 'x.900.1.obs'), JSON.stringify(fullObs(Date.now() - 6 * 60 * 60_000)), { mode: 0o600 });
    const planted = healthPath.join(dir, 'x.900.1.obs.tmp');
    healthFs.mkdirSync(planted);
    expect(wordsOf(statusOf(box).env!['health']['fail'])).not.toContain('journal-unwritable');   // at cf544c151: FAIL, x.1000.1 read as a held file
    healthFs.rmSync(planted, { recursive: true });                                                 // CONTROL: no planted entry, both are held files
    expect(wordsOf(statusOf(box).env!['health']['fail'])).toContain('journal-unwritable');
  });

  it('a link at a draining name holds nothing behind it: its id\'s later file is still a held file (FU8 CONTROL)', () => {
    const { box, dir } = heldPair('ccrc-history-health-link-later-');
    healthFs.symlinkSync(healthPath.join(box.home, 'nowhere'), healthPath.join(dir, 'x.900.1.jsonl'));
    expect(wordsOf(statusOf(box).env!['health']['fail'])).toContain('journal-unwritable');
  });

  // FU8 (FP3): a link or a file at spool/ stops the hook and the drain alike. Status names it under WARN spool-planted from its
  // own lstat (so the clause clears when the entry goes), and reads no spool/.draining through it.
  it.each([['a link to a directory'], ['a regular file']])('%s at spool/ is WARN spool-planted, and status reads no .draining through it (FU8, FP3)', (kind) => {
    const box = healthHh.makeHistoryBox('ccrc-history-health-spool-refused-', { role: 'fleet', shim: true });
    ageFile(shimOf(box), 60 * 60_000);
    tickedStore(box, Date.now());
    const spoolDir = healthPath.join(box.home, '.ccrc', 'history', 'spool');
    const outside = healthPath.join(box.home, 'outside');
    healthFs.mkdirSync(healthPath.join(outside, '.draining'), { recursive: true, mode: 0o700 });
    healthFs.writeFileSync(healthPath.join(outside, '.draining', 'x.900.1.jsonl'), '', { mode: 0o600 });
    healthFs.writeFileSync(healthPath.join(outside, '.draining', 'x.900.1.obs'), JSON.stringify(fullObs(Date.now() - 6 * 60 * 60_000)), { mode: 0o600 });
    healthCp.execFileSync('mkfifo', [healthPath.join(outside, `${ID}.jsonl`)]);               // a refused node in the link's target (FR2f)
    healthFs.rmSync(spoolDir, { recursive: true, force: true });
    if (kind === 'a link to a directory') healthFs.symlinkSync(outside, spoolDir);
    else healthFs.writeFileSync(spoolDir, 'stray');
    const h = statusOf(box).env!['health'];
    const warn = (h['warn'] as Array<{ word: string; detail: string }>).find((i) => i.word === 'spool-planted');
    expect(warn?.detail).toContain('spool/ is not a real directory');                     // at cf544c151: no word names it
    expect(warn?.detail, 'nothing is counted through a link at spool/ (FR2f, whole-round review #2)').not.toContain('node(s) at spool/<id>.jsonl');
    expect(wordsOf(h['fail']), 'nothing read through it').not.toContain('journal-unwritable');   // at cf544c151, the link: FAIL, read through it
    expect(wordsOf(h['fail'])).not.toContain('status-unreadable');                        // at cf544c151, the file: FAIL, its readdir ENOTDIR
    healthFs.rmSync(spoolDir, { recursive: true, force: true });                         // a link is removed, never its target
    healthFs.mkdirSync(spoolDir, { mode: 0o700 });                                        // CONTROL: a real directory again
    expect(wordsOf(statusOf(box).env!['health']['warn'])).not.toContain('spool-planted');
    expect(healthFs.existsSync(healthPath.join(outside, '.draining', 'x.900.1.obs'))).toBe(true);
  });

  // FR2c (review 344 F3; D-4418 (history-spool-append-regular-file-only)): a node the hook refuses at spool/<id>.jsonl silences
  // that id's spool lines until it is removed. Status counts such nodes under WARN spool-planted from its own lstat (no counter),
  // never opening or following one, so the clause clears when the node goes; a regular sibling, a dot-name and a name outside
  // the id grammar are not counted. A live link to a regular file is counted too, because status reads by lstat and never
  // follows a link: a stat would follow it to a regular file and leave it uncounted (review 351 F3).
  it.each([['a FIFO'], ['a dangling link'], ['a link to a regular file'], ['a directory']])('%s at spool/<id>.jsonl is WARN spool-planted from status\'s own lstat, and the clause clears when it goes (FR2c, F3)', (kind) => {
    const box = healthHh.makeHistoryBox('ccrc-history-health-spool-node-', { role: 'fleet', shim: true });
    ageFile(shimOf(box), 60 * 60_000);
    tickedStore(box, Date.now());
    const spoolDir = healthPath.join(box.home, '.ccrc', 'history', 'spool');
    healthFs.mkdirSync(spoolDir, { recursive: true, mode: 0o700 });
    const node = healthPath.join(spoolDir, `${ID}.jsonl`);
    if (kind === 'a FIFO') healthCp.execFileSync('mkfifo', [node]);
    else if (kind === 'a dangling link') healthFs.symlinkSync(healthPath.join(box.home, 'nowhere'), node);
    else if (kind === 'a link to a regular file') {
      const target = healthPath.join(box.home, 'spool-target.jsonl');
      healthFs.writeFileSync(target, '\n{}\n', { mode: 0o600 });
      healthFs.symlinkSync(target, node);
    }
    else healthFs.mkdirSync(node);
    healthFs.writeFileSync(healthPath.join(spoolDir, 'claude-a-other.jsonl'), '\n{}\n', { mode: 0o600 });   // a regular sibling
    healthCp.execFileSync('mkfifo', [healthPath.join(spoolDir, '.hidden.jsonl')]);                            // a dot-name no hook writes
    healthFs.mkdirSync(healthPath.join(spoolDir, 'not an id.jsonl'));                                           // outside the id grammar
    const warn = (statusOf(box).env!['health']['warn'] as Array<{ word: string; detail: string; remedy: string }>).find((i) => i.word === 'spool-planted');
    expect(warn?.detail).toContain('1 node(s) at spool/<id>.jsonl are not regular files');                   // at be9df58ba: no word names it
    expect(warn?.remedy).toContain('~/.ccrc/history/spool/<id>.jsonl');
    healthFs.rmSync(node, { recursive: true });                                                                  // CONTROL: removed, the clause clears
    expect(wordsOf(statusOf(box).env!['health']['warn'])).not.toContain('spool-planted');
  });

  // FR2c: absent is not unreadable. A spool/ status cannot list (0300), or whose names it cannot lstat (0600, a node at a spool
  // name planted first), is named unmeasured, never read as "no refused node". At 0600 spool/.draining is unreadable too.
  it.skipIf(process.getuid?.() === 0).each([['0300', 'could not read spool/;'], ['0600', 'could not read spool/, spool/.draining;']])('a spool/ of mode %s is FAIL status-unreadable naming spool/, never "no refused node" (FR2c)', (m, said) => {
    const box = healthHh.makeHistoryBox('ccrc-history-health-spool-unlisted-', { role: 'fleet', shim: true });
    ageFile(shimOf(box), 60 * 60_000);
    tickedStore(box, Date.now());
    const spoolDir = healthPath.join(box.home, '.ccrc', 'history', 'spool');
    healthFs.mkdirSync(spoolDir, { recursive: true, mode: 0o700 });
    healthFs.writeFileSync(healthPath.join(spoolDir, `${ID}.jsonl`), '\n{}\n', { mode: 0o600 });
    healthFs.chmodSync(spoolDir, parseInt(m, 8));
    try {
      const fail = statusOf(box).env!['health']['fail'] as Array<{ word: string; detail: string }>;
      expect(fail.find((i) => i.word === 'status-unreadable')?.detail).toContain(said);   // at be9df58ba, 0300: no status-unreadable at all
    } finally { healthFs.chmodSync(spoolDir, 0o700); }
  });

  it('an observation sidecar whose draining file is gone is not a held file, however old (review 316 F20)', () => {
    const box = healthHh.makeHistoryBox('ccrc-history-health-sidecar-orphan-', { role: 'fleet', shim: true });
    ageFile(shimOf(box), 60 * 60_000);
    tickedStore(box, Date.now());
    const dir = healthPath.join(box.home, '.ccrc', 'history', 'spool', '.draining');
    healthFs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    healthFs.writeFileSync(healthPath.join(dir, 'x.900.1.obs'), JSON.stringify(fullObs(Date.now() - 6 * 60 * 60_000)), { mode: 0o600 });
    expect(wordsOf(statusOf(box).env!['health']['fail'])).not.toContain('journal-unwritable');
    healthFs.writeFileSync(healthPath.join(dir, 'x.900.1.jsonl'), '');                                              // CONTROL: its file is live
    expect(wordsOf(statusOf(box).env!['health']['fail'])).toContain('journal-unwritable');
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

// ── W2-1 Task 3: recall-off through the CLI door (W2-D26, W2-D27, W2-D28; D-5763, D-5764) ──────────────────────────
// B2's stub answered only its refusals. Since W2-1 recall-off is an operator verb of the door that relays import, prune
// and reparse: the CLI parses its argv (bad-args and bad-id spawn nothing), runs the gate, and spawns the shim, whose pass
// decides the rest under the lock; the CLI relays the pass's lines and its result.
describe('W2-1 recall-off: the CLI door relays the shim', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  const G2 = '0189abcd-1234-4678-9abc-0123456789ac';
  function rBox(prefix: string): HistoryBox {
    const box = makeHistoryBox(prefix);
    expect(runSweep(box).code).toBe(0);
    healthHh.plantSession(box, ID, { generation: G1 });
    return box;
  }

  it('the write form runs the shim and relays its line, human on stdout and --json on stderr beside the envelope', () => {
    const box = rBox('ccrc-hist-cli-w21a-');
    const human = healthHh.runCli(box, ['recall-off', ID]);
    expect(human.code, `${human.stdout}${human.stderr}`).toBe(0);
    expect(human.stdout).toContain(`history-sweep: recall-off/${ID} written`);
    expect(fs.readFileSync(hist(box, 'recall-off', ID), 'utf8')).toBe(`${G1}\n`);
    const json = healthHh.runCli(box, ['recall-off', ID, '--generation', G1, '--json']);
    expect(json.json, json.stdout).toMatchObject({ exit: 0 });
    expect(json.stderr).toContain(`history-sweep: recall-off/${ID} written`);
    expect(json.stdout.trim().split('\n'), 'stdout is the envelope alone').toHaveLength(1);
  }, 60_000);

  it('C16, spawned: the two new words reach the envelope as exit-2 reasons, and the human line names the word and the operator', () => {
    const box = rBox('ccrc-hist-cli-w21b-');
    const mm = healthHh.runCli(box, ['recall-off', ID, '--generation', G2, '--json']);
    expect([mm.code, mm.json?.['reason']], `${mm.stdout}${mm.stderr}`).toEqual([2, 'generation-mismatch']);
    fs.writeFileSync(path.join(box.reg, `${ID}.generation`), 'not-a-generation');
    const mf = healthHh.runCli(box, ['recall-off', ID, '--json']);
    expect([mf.code, mf.json?.['reason']], `${mf.stdout}${mf.stderr}`).toEqual([2, 'generation-malformed']);
    const human = healthHh.runCli(box, ['recall-off', ID]);
    expect(human.code).toBe(2);
    expect(human.stderr).toContain('ccrc history recall-off: refused: generation-malformed; ');
    expect(fs.existsSync(hist(box, 'recall-off')), 'every refusal comes before any write').toBe(false);
  }, 60_000);

  it('bad-args and bad-id are the CLI\'s own and spawn nothing; a valid form reaches the shim with its argv as typed', () => {
    const box = rBox('ccrc-hist-cli-w21c-');
    healthHh.stubShim(box, { stdout: '{"rc":0}\n', exit: 0 });
    const ROWS: ReadonlyArray<readonly [readonly string[], string]> = [
      [[ID, '--generation', G1.toUpperCase()], 'bad-args'], [[ID, '--generation', ` ${G1}`], 'bad-args'],
      [[ID, '--generation', G1, '--clear'], 'bad-args'], [['--clear-all', ID], 'bad-args'],
      [['--clear-all', '--generation', G1], 'bad-args'], [[], 'bad-args'], [['../x', '--clear'], 'bad-id'],
    ];
    for (const [args, word] of ROWS) {
      const r = healthHh.runCli(box, ['recall-off', ...args, '--json']);
      expect([r.code, r.json?.['reason']], JSON.stringify(args)).toEqual([2, word]);
    }
    expect(fs.existsSync(path.join(box.home, 'stub-shim-argv')), 'no refusal spawned the shim').toBe(false);
    // CONTROL: a valid form does reach the stand-in.
    const ok = healthHh.runCli(box, ['recall-off', ID, '--generation', G1, '--json']);
    expect(ok.code, `${ok.stdout}${ok.stderr}`).toBe(0);
    expect(fs.readFileSync(path.join(box.home, 'stub-shim-argv'), 'utf8')).toContain(`--op recall-off ${ID} --generation ${G1}`);
  }, 60_000);

  it('--clear-all relays its summary line, the operator\'s check at close: human on stdout, --json on stderr', () => {
    const box = rBox('ccrc-hist-cli-w21d-');
    expect(healthHh.runCli(box, ['recall-off', ID]).code).toBe(0);
    fs.mkdirSync(hist(box, 'recall-off', 'claude-d-dir'));
    const human = healthHh.runCli(box, ['recall-off', '--clear-all']);
    expect(human.code, human.stderr).toBe(0);
    expect(human.stdout).toContain('{"rc":0,"reason":null,"cleared":1,"skipped":["claude-d-dir"]}');
    const json = healthHh.runCli(box, ['recall-off', '--clear-all', '--json']);
    expect(json.json, json.stdout).toMatchObject({ exit: 0 });
    expect(json.stderr).toContain('{"rc":0,"reason":null,"cleared":0,"skipped":["claude-d-dir"]}');
  }, 60_000);

  it('a designed rc 1 prints the arm\'s own line and one line naming the operator; an rc 1 with no result keeps the generic words (final wave B1)', () => {
    const box = rBox('ccrc-hist-cli-w21e-');
    fs.mkdirSync(hist(box, 'recall-off'), { recursive: true });
    expect(spawnSync('mkfifo', [hist(box, 'recall-off', ID)]).status).toBe(0);
    const human = healthHh.runCli(box, ['recall-off', ID, '--clear']);
    expect(human.code, `${human.stdout}${human.stderr}`).toBe(1);
    expect(`${human.stdout}${human.stderr}`, 'the arm\'s own line, naming the entry').toContain(`recall-off/${ID}`);
    expect(`${human.stdout}${human.stderr}`, 'no generic words after a result the relay received').not.toContain('gave no result');
    expect(human.stderr, 'one line that names the operator (R-X-OPERATOR)').toContain('ccrc history recall-off: the history writer stopped, as the line above says; ccrc history\'s operator verbs are the operator\'s to run');
    const json = healthHh.runCli(box, ['recall-off', ID, '--clear', '--json']);
    expect([json.code, json.json?.['exit']], `${json.stdout}${json.stderr}`).toEqual([1, 1]);
    // CONTROL: the same verb, an rc 1 and no result line (a shim that wrote something else): the generic words stay.
    healthHh.stubShim(box, { stdout: 'not json\n', exit: 1 });
    const bare = healthHh.runCli(box, ['recall-off', ID, '--clear']);
    expect(bare.code).toBe(1);
    expect(bare.stderr).toContain('ccrc history recall-off: internal error: the history writer gave no result');
  }, 60_000);

  it('a stated rc 1 from another verb keeps the generic words; only recall-off prints the stated line (r761 F3)', () => {
    const box = rBox('ccrc-hist-cli-w21f-');
    healthHh.stubShim(box, { stdout: '{"rc":1}\n', exit: 1 });
    const other = healthHh.runCli(box, ['doctor', '--backup']);
    // CONTROL: the verb reached the stand-in, so the words below are the CLI's own for a shim that stated rc 1.
    expect(fs.readFileSync(path.join(box.home, 'stub-shim-argv'), 'utf8'), 'doctor --backup reached the shim').toContain('--op');
    expect(other.code, `${other.stdout}${other.stderr}`).toBe(1);
    expect(other.stderr, 'another verb: the generic words').toContain('ccrc history doctor: internal error: the history writer gave no result');
    expect(other.stderr, 'another verb: not the recall-off line').not.toContain('as the line above says');
    // CONTROL: the same stand-in under recall-off prints the stated line, so the difference is the verb.
    const ro = healthHh.runCli(box, ['recall-off', ID]);
    expect(ro.code, `${ro.stdout}${ro.stderr}`).toBe(1);
    expect(ro.stderr).toContain('ccrc history recall-off: the history writer stopped, as the line above says');
  }, 60_000);

  it('README states the verb, its flag and its refusal words (W2-1)', () => {
    const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
    expect(readme).toContain('`recall-off <id> [--generation <uuid>] [--clear]` and `recall-off --clear-all`');
    expect(readme).toContain('with no dry run');
    for (const w of ['generation-mismatch', 'generation-malformed', 'generation-unreadable']) expect(readme).toContain(`\`${w}\``);
  });
});

// ── W2-1 Task 4: status --json's recall_off block (W2-D31) ───────────────────────────────────────────────────────
describe('status recall_off: the presence record, counts only (W2-D31; W2-1 Task 4)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  type RecallOffBlock = { seen_ms: number | null; files: number; unreadable: number };
  const blockOf = (env: Envelope): RecallOffBlock => (env as unknown as { recall_off: RecallOffBlock }).recall_off;
  const RID = 'claude-a-roffid';
  const RID2 = 'claude-b-roffid';

  it('after a write and a tick, seen_ms is later than the write; files and unreadable count the state rows; no id is printed', () => {
    const box = boundBox('ccrc-hist-cli-roff-');
    const dir = hist(box, 'recall-off');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, RID), `${G1}\n`, { mode: 0o600 });
    fs.symlinkSync(path.join(box.home, 'nowhere'), path.join(dir, RID2));   // a link: unreadable, never absent
    const wrote = fs.statSync(path.join(dir, RID)).mtimeMs;
    const t = runSweep(box);
    expect(t.code, t.stderr).toBe(0);
    const s = status(box);
    expect(s.code, s.stderr).toBe(0);
    const ro = blockOf(s.env);
    expect(Object.keys(ro).sort()).toEqual(['files', 'seen_ms', 'unreadable']);
    expect(ro.seen_ms).toBeGreaterThan(wrote);
    expect([ro.files, ro.unreadable]).toEqual([2, 1]);
    expect(s.stdout, 'status is identity-free').not.toContain(RID);
    expect(s.stdout).not.toContain(RID2);
    const human = status(box, { args: ['status'] });
    expect(human.code).toBe(0);
    expect(human.stdout.split('\n')).toContain(`recall-off: seen=${new Date(ro.seen_ms!).toISOString()} files=2 unreadable=1`);
  });

  it('with no store read, the block is there and says nothing was observed', () => {
    const shimOnly = makeHistoryBox('ccrc-hist-cli-roff-none-', { role: 'fleet', shim: true });
    const s = status(shimOnly);
    expect(s.code).toBe(6);
    expect(blockOf(s.env)).toEqual({ seen_ms: null, files: 0, unreadable: 0 });
  });
});

// ── W2-2a Task 5 (W2-D39, W2-D45): the seam variables inside a pane are refused before any tmux spawn ─────────────
// Spec §8.2: the headless seam is honoured only when TMUX_PANE is unset; inside a pane the answer is exit 2
// headless-in-pane (C4's in-pane half; C31's "set inside a pane"). W2-2a refuses; it reads no value beyond whether it is
// empty. The env identity, ARM, ASOF and the marker are W2-2b's. The pure describe runs everywhere.
describe('W2-D39: decideSeamInPane refuses the seam variables inside a pane (W2-2a Task 5)', () => {
  const lib = async () => await import('../../ccd/history/lib.mjs');
  const NONE: { session: string | null; arm: string | null; asof: string | null } = { session: null, arm: null, asof: null };
  const ASOF = 'd4d4d4d4-4444-4444-8444-444444444444';
  const IN_PANE = { ok: false, rc: 2, reason: 'headless-in-pane' };

  it('the seam is engaged iff one of its three values is non-empty (W2-D45)', async () => {
    const { recallSeamEngaged } = await lib();
    expect(recallSeamEngaged(NONE)).toBe(false);
    expect(recallSeamEngaged({ session: '', arm: '', asof: '' }), 'an empty variable is unset').toBe(false);
    expect(recallSeamEngaged({ ...NONE, session: ID })).toBe(true);
    expect(recallSeamEngaged({ ...NONE, arm: 'fixture-arm' })).toBe(true);
    expect(recallSeamEngaged({ ...NONE, asof: ASOF })).toBe(true);
    expect(recallSeamEngaged({ session: '', arm: '', asof: 'not-a-uuid' }), 'no value is checked here').toBe(true);
  });

  it('a pane with any seam value is 2 headless-in-pane; no pane, or no seam value, passes to the tmux path', async () => {
    const { decideSeamInPane, REASONS, EXIT } = await lib();
    expect(REASONS['headless-in-pane'], 'the W1 word, not a new one').toBe(EXIT.REFUSED);
    const engaged = [{ ...NONE, session: ID }, { ...NONE, arm: 'fixture-arm' }, { ...NONE, asof: ASOF }, { session: ID, arm: 'fixture-arm', asof: ASOF }];
    for (const recall of engaged) {
      expect(decideSeamInPane({ pane: '%1', recall }), JSON.stringify(recall)).toEqual(IN_PANE);
      expect(decideSeamInPane({ pane: null, recall }), `no pane: ${JSON.stringify(recall)}`).toEqual({ ok: true });
    }
    expect(decideSeamInPane({ pane: '%1', recall: NONE }), 'CONTROL: a pane and no seam is today\'s path').toEqual({ ok: true });
    expect(decideSeamInPane({ pane: '%1', recall: { session: '', arm: '', asof: '' } }), 'CONTROL: empty values are no seam').toEqual({ ok: true });
  });

  it('TMUX_PANE set means defined: an empty or malformed pane is still a pane', async () => {
    const { decideSeamInPane } = await lib();
    for (const pane of ['', '-x', '%', 'not a pane']) {
      expect(decideSeamInPane({ pane, recall: { ...NONE, asof: ASOF } }), JSON.stringify(pane)).toEqual(IN_PANE);
      expect(decideSeamInPane({ pane, recall: NONE }), `CONTROL: ${JSON.stringify(pane)} with no seam`).toEqual({ ok: true });
    }
  });
});

// The same rule, spawned, on one seeded family: in a pane every read verb and the --regex door answer
// headless-in-pane with no tmux call, no counter line and nothing recalled; the CONTROL is the same pane with no seam
// variable, which derives the identity and recalls the family's word.
describe('W2-D39: the read verbs refuse the seam variables inside a pane, before any tmux spawn (C4, C31; W2-2a Task 5)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  const SP_T = 'c3c3c3c3-3333-4333-8333-333333333333';
  const SP_ROW = 'c3c3c3c3-0000-4000-8000-000000000001';
  const WORD = 'zqseampane';
  const ASOF = 'd4d4d4d4-4444-4444-8444-444444444444';
  const SEAM: ReadonlyArray<readonly [string, Record<string, string>]> = [
    ['CCRC_RECALL_SESSION alone', { CCRC_RECALL_SESSION: ID }],
    ['CCRC_RECALL_ARM alone', { CCRC_RECALL_ARM: 'fixture-arm' }],
    ['CCRC_RECALL_ASOF alone (C31)', { CCRC_RECALL_ASOF: ASOF }],
    ['all three', { CCRC_RECALL_SESSION: ID, CCRC_RECALL_ARM: 'fixture-arm', CCRC_RECALL_ASOF: ASOF }],
  ];
  /** Every read verb and the --regex child's door, each with argv that parses; the refusal comes before the store. */
  const VERBS: ReadonlyArray<readonly string[]> = [
    ['grep', WORD, '--json'], ['grep', '--regex', 'zqseam(pane|none)', '--json'], ['describe', SP_ROW, '--json'],
    ['expand', SP_ROW, '--json'], ['tree', '--json'],
  ];
  type Run = ReturnType<typeof healthHh.runCli>;
  const ans = (r: Run): unknown[] => [r.code, r.json?.['reason']];
  const calls = (box: HistoryBox): string => path.join(box.home, 'tmux-calls');
  const spool = (box: HistoryBox): string => {
    const p = hist(box, 'spool', `${ID}.jsonl`);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  };
  const ENVELOPE_KEYS = ['scope', 'indexed_through_ms', 'lag_s', 'items', 'shown', 'total', 'next', 'store_id'] as const;
  let seeded: HistoryBox | null = null;
  /** One family, one question and its answer, both carrying WORD; captured once for the describe. */
  async function seededBox(): Promise<HistoryBox> {
    if (seeded !== null) return seeded;
    const fx = await import('./historyFixtures.js');
    const box = makeHistoryBox('ccrc-hist-cli-seampane-', { role: 'fleet', shim: true });
    const base = { sessionId: SP_T, cwd: '/home/u/tree/demo' };
    healthHh.seedFamily(box, { id: ID, project: 'demo', uuid: SP_T, generation: G1, rows: [
      fx.userRow({ ...base, uuid: SP_ROW, ts: '2026-10-01T10:00:01.000Z', text: `${WORD} the question` }),
      fx.assistantRow({ ...base, uuid: 'c3c3c3c3-0000-4000-8000-000000000002', ts: '2026-10-01T10:00:02.000Z',
        text: `${WORD} the answer`, requestId: 'req_seampane_1', msgId: 'msg_seampane_1' }),
    ] });
    seeded = box;
    return box;
  }

  it('C4 and C31, in-pane half: each seam variable in a pane is 2 headless-in-pane for every read verb, with no tmux call, no counter line and nothing recalled; CONTROL: the same pane without it reads the family', async () => {
    const box = await seededBox();
    const pane = healthHh.withPane(box, ID);
    fs.rmSync(calls(box), { force: true });
    // CONTROL: the same pane and family, no seam variable. Every verb derives the identity from tmux, and the family's
    // text, counts and a counter line are there to be hidden.
    for (const argv of VERBS) {
      const r = healthHh.runCli(box, [...argv], { env: pane });
      const what = `CONTROL ${argv.join(' ')}: ${r.stderr}`;
      expect(r.json?.['reason'], what).not.toBe('headless-in-pane');
      if (argv[0] === 'grep' || argv[0] === 'expand') {
        expect(r.code, what).toBe(0);
        expect(r.stdout, `${what} the family's text is recalled`).toContain(WORD);
      }
      if (argv[0] === 'tree') {
        expect(r.code, what).toBe(0);
        expect(r.json?.['scope'], `${what} the header counts the transcript`).toMatchObject({ transcripts: 1 });
      }
    }
    expect(fs.readFileSync(calls(box), 'utf8').trim().split('\n'), 'CONTROL: tmux was asked once per verb').toHaveLength(VERBS.length);
    const counted = spool(box);
    expect(counted, 'CONTROL: a read with an identity writes a counter line').not.toBe('');
    fs.rmSync(calls(box), { force: true });
    for (const [label, seam] of SEAM) {
      for (const argv of VERBS) {
        const r = healthHh.runCli(box, [...argv], { env: { ...pane, ...seam } });
        const what = `${label}, ${argv.join(' ')}`;
        expect(ans(r), `${what}: ${r.stderr}${r.stdout}`).toEqual([2, 'headless-in-pane']);
        expect(`${r.stdout}${r.stderr}`, `${what}: nothing recalled`).not.toContain(WORD);
        expect(ENVELOPE_KEYS.map((k) => r.json?.[k]), `${what}: no scope, count, cursor or store id`)
          .toEqual([null, null, null, [], 0, 0, null, null]);
      }
      const human = healthHh.runCli(box, ['grep', WORD], { env: { ...pane, ...seam } });
      expect(human.code, label).toBe(2);
      expect(human.stdout.trim(), `${label}: the human refusal line`).toMatch(/^exit 2 headless-in-pane: /);
      expect(human.stdout, label).not.toContain(WORD);
    }
    expect(fs.existsSync(calls(box)), 'no tmux spawn under any seam variable').toBe(false);
    expect(spool(box), 'no counter line: no identity was derived').toBe(counted);
  }, 240_000);

  // W2-2b Task 3 changed this case in place: with no pane a seam value now takes the headless path (W2-D46 step 1),
  // which on this box, with no marker, answers headless-unarmed; with nothing set the answer is still no-identity.
  it('no pane: a seam variable takes the headless path, which on a box with no marker answers 2 headless-unarmed for every read verb, with no tmux call and no counter line; CONTROL: with none set, no-identity (C4 complete, C30)', async () => {
    const box = await seededBox();
    healthHh.withPane(box, ID);   // a working tmux IS on PATH; the env below carries no TMUX_PANE
    fs.rmSync(calls(box), { force: true });
    const counted = spool(box);
    for (const [label, seam] of SEAM) {
      for (const argv of VERBS) {
        const r = healthHh.runCli(box, [...argv], { env: seam });
        expect(ans(r), `${label}, ${argv.join(' ')}: ${r.stderr}${r.stdout}`).toEqual([2, 'headless-unarmed']);
        expect(r.stdout, label).not.toContain(WORD);
      }
    }
    for (const argv of VERBS) {
      expect(ans(healthHh.runCli(box, [...argv])), `CONTROL, nothing set, ${argv.join(' ')}`).toEqual([2, 'no-identity']);
    }
    expect(fs.existsSync(calls(box)), 'no tmux spawn').toBe(false);
    expect(spool(box), 'no counter line: nothing was admitted').toBe(counted);
  }, 240_000);

  it('an empty or malformed TMUX_PANE is a pane; an empty seam variable, or a CCRC_RECALL_ name outside the three, is no seam (W2-D45)', async () => {
    const box = await seededBox();
    const pane = healthHh.withPane(box, ID);
    fs.rmSync(calls(box), { force: true });
    for (const p of ['', '-x']) {
      const r = healthHh.runCli(box, ['grep', WORD, '--json'], { env: { ...pane, TMUX_PANE: p, CCRC_RECALL_ASOF: ASOF } });
      expect(ans(r), `TMUX_PANE=${JSON.stringify(p)}: ${r.stderr}`).toEqual([2, 'headless-in-pane']);
      const control = healthHh.runCli(box, ['grep', WORD, '--json'], { env: { ...pane, TMUX_PANE: p } });
      expect(ans(control), `CONTROL: TMUX_PANE=${JSON.stringify(p)} with no seam is today's answer`).toEqual([2, 'no-identity']);
    }
    expect(fs.existsSync(calls(box)), 'neither pane is %<n>, so tmux is never asked').toBe(false);
    const empty = healthHh.runCli(box, ['grep', WORD, '--json'],
      { env: { ...pane, CCRC_RECALL_SESSION: '', CCRC_RECALL_ARM: '', CCRC_RECALL_ASOF: '' } });
    expect(ans(empty), `three empty variables are no seam: ${empty.stderr}`).toEqual([0, undefined]);
    expect(empty.stdout).toContain(WORD);
    const other = healthHh.runCli(box, ['grep', WORD, '--json'], { env: { ...pane, CCRC_RECALL_OTHER: ASOF } });
    expect(ans(other), `a name outside the three is not read: ${other.stderr}`).toEqual([0, undefined]);
    expect(other.stdout).toContain(WORD);
  }, 240_000);
});

// ── W2-2b Task 3 (W2-D41, W2-D46): the headless path's own two decisions, pure ─────────────────────────────────────
describe('W2-2b Task 3: the env path\'s own decisions and its source shape (R1; W2-D40, W2-D41, W2-D46)', () => {
  type Lib = {
    decideEnvProject(i: { verdict: Record<string, unknown>; storedProject: string }): unknown;
    decideHeadlessRead(i: { recallOff: string; arm: string }): unknown;
    SCOPE_SOURCES: readonly string[]; RECALL_ARMS: readonly string[]; EXIT: Record<string, number>;
  };
  const lib = async (): Promise<Lib> => (await import('../../ccd/history/lib.mjs')) as unknown as Lib;
  const verdict = (o: Record<string, unknown>): Record<string, unknown> =>
    ({ ok: true, kind: 'family', source: 'env', id: 'acct-a-seamx', generation: null, project: 'demo', workdir: null, ...o });
  const CROSS = { ok: false, rc: 2, reason: 'cross-project' };

  it('seam pure decideEnvProject: on env the registry project decideScope used must be the stored one, else 2 cross-project; a verdict with no project, and a tmux verdict, pass', async () => {
    const L = await lib();
    expect(L.SCOPE_SOURCES, 'W2-D41: the env source').toEqual(['tmux', 'env']);
    expect(L.decideEnvProject({ verdict: verdict({}), storedProject: 'demo' })).toEqual({ ok: true });
    for (const kind of ['family', 'project', 'workspace']) {
      expect(L.decideEnvProject({ verdict: verdict({ kind }), storedProject: 'other' }), kind).toEqual(CROSS);
    }
    expect(L.decideEnvProject({ verdict: verdict({ project: null }), storedProject: 'demo' }), 'no project used: nothing to compare').toEqual({ ok: true });
    expect(L.decideEnvProject({ verdict: verdict({ source: 'tmux' }), storedProject: 'other' }), 'CONTROL: the guard is the env path alone').toEqual({ ok: true });
  });

  it('seam pure decideHeadlessRead: recall-off naming the resolved generation is exit 8 first, then ARM=control is exit 8; the treatment arm reads, and any other arm withholds', async () => {
    const L = await lib();
    const [CONTROL_ARM, TREATMENT] = [L.RECALL_ARMS[0]!, L.RECALL_ARMS[1]!];
    expect(L.EXIT['RECALL_OFF']).toBe(8);
    expect(L.decideHeadlessRead({ recallOff: 'off', arm: TREATMENT })).toEqual({ ok: false, rc: 8, why: 'recall-off' });
    expect(L.decideHeadlessRead({ recallOff: 'off', arm: CONTROL_ARM }), 'step 5 comes before step 6').toEqual({ ok: false, rc: 8, why: 'recall-off' });
    expect(L.decideHeadlessRead({ recallOff: 'none', arm: CONTROL_ARM })).toEqual({ ok: false, rc: 8, why: 'arm' });
    expect(L.decideHeadlessRead({ recallOff: 'stale', arm: CONTROL_ARM })).toEqual({ ok: false, rc: 8, why: 'arm' });
    expect(L.decideHeadlessRead({ recallOff: 'none', arm: TREATMENT })).toEqual({ ok: true });
    expect(L.decideHeadlessRead({ recallOff: 'stale', arm: TREATMENT }), 'CONTROL: a stale file is no switch').toEqual({ ok: true });
    expect(L.decideHeadlessRead({ recallOff: 'none', arm: 'placebo' }), 'fail closed').toEqual({ ok: false, rc: 8, why: 'arm' });
  });

  // R1 and W2-D40 at the source: no answer moves when the read is hoisted, repeated or moved past the dispatch, so
  // the pin reads cli.mjs. It reads the text only: no in-process test imports cli.mjs.
  it('seam source: R1, the marker is read on one ccd/history code line, inside readContextEnv, which readContextIn calls on one line after its in-pane refusal; readContextEnv reads no generation chain (W2-D40) and fails closed on a tmux answer', () => {
    const dir = path.join(REPO, 'ccd', 'history');
    const code = (l: string): boolean => !/^\s*(\/\/|\/?\*)/.test(l);
    const READ = /\breadBounded\([^,]*\.headlessOn, (?:[A-Za-z_$][\w$]*\.)?HEADLESS_LIST_MAX_BYTES, false\)/;
    const reads = fs.readdirSync(dir).filter((n) => n.endsWith('.mjs')).sort()
      .flatMap((n) => fs.readFileSync(path.join(dir, n), 'utf8').split('\n').filter((l) => code(l) && READ.test(l)).map((l) => `${n}:${l}`));
    expect(reads, 'R1: one read, in cli.mjs, of R1\'s exact line')
      .toEqual(['cli.mjs:  const marker = headlessMarkerOf(readBounded(P.headlessOn, HEADLESS_LIST_MAX_BYTES, false));']);
    const cli = fs.readFileSync(path.join(dir, 'cli.mjs'), 'utf8').split('\n');
    /** A function's lines in cli.mjs: its first line through the next line that is exactly `}`. */
    const body = (head: string): string[] => {
      const at = cli.findIndex((l) => l.startsWith(head));
      expect(at, `${head} is found`).toBeGreaterThan(-1);
      return cli.slice(at, cli.indexOf('}', at) + 1);
    };
    const env = body('async function readContextEnv(');
    const inn = body('async function readContextIn(');
    expect(env.filter((l) => READ.test(l)), 'the one read is readContextEnv\'s').toHaveLength(1);
    const DISPATCH = '  if (recallSeamEngaged(recall)) return readContextEnv(home, P, parsed, nowMs, seen, recall, pane);';
    expect(cli.filter((l) => code(l) && /\breadContextEnv\(/.test(l) && !l.startsWith('async function readContextEnv(')),
      'readContextEnv is called on one line, readContextIn\'s dispatch').toEqual([DISPATCH]);
    const refusalAt = inn.indexOf('  if (!inPane.ok) return refusal(inPane.rc, inPane.reason, null, null, null);');
    expect(refusalAt, 'CONTROL: W2-2a\'s in-pane refusal is readContextIn\'s').toBeGreaterThan(-1);
    expect(inn.indexOf(DISPATCH), 'the dispatch comes after the in-pane refusal').toBeGreaterThan(refusalAt);
    const envCode = env.filter(code).join('\n');
    for (const chain of [/resolveGeneration/, /CCRC_SESSION_GENERATION/, /process\.env/, /'generation'\)/]) {
      expect(envCode, `W2-D40: readContextEnv reads no generation chain: ${String(chain)}`).not.toMatch(chain);
    }
    expect(inn.filter(code).join('\n'), 'CONTROL: readContextIn\'s tmux path reads it').toMatch(/resolveGeneration/);
    expect(env, 'fail closed: a tmux answer is a defect, never read on as the headless path')
      .toContain("  if (head.path !== 'headless') throw new TypeError('readContextEnv: decideHeadless answered the tmux path');");
  });
});

// ── W2-2b Task 3 (W2-D40, W2-D41, W2-D45, W2-D46; D-5767): the headless path, spawned ─────────────────────────────
// One box, captured once, holds:
//   - (X, GX1): boundary N at ts(4) keeps one row; a row after it (ts 6) the cut hides; its epoch ran in ws-link, a link
//     to ws-real (cwd_real), both removed after seeding, so the stored anchor no longer resolves on the box;
//   - (X, GX2): X purged and reused, rows only after T_N; $REG/X.generation says GX2; $REG/X.workdir names another dir;
//   - OF (demo, epoch in ws-real, rows before T_N) and OL (demo, another cwd, rows after T_N);
//   - LEG: a legacy '' family re-keyed into (LEG, GLM) (DM18b's merge); LEG2: an unmerged '' family and a newer
//     (LEG2, GL9); NT: a family whose first row is a boundary with no stamp (the store half refuses it);
//   - XP: a registry project 'other', no family.
// The marker lists (X, GX1), (LEG, GLM), (LEG2, ''), (NT, GNT).
describe('W2-2b Task 3: the headless path, wired in the W2-D46 order (C4, C16, C24, C30, C50; W2-D40, W2-D41, W2-D45, W2-D46; D-5767)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  const X = 'acct-a-seamx';
  const OF = 'acct-a-seamof';
  const OL = 'acct-a-seamol';
  const XP = 'acct-b-seamxp';
  const LEG = 'acct-a-seamleg';
  const LEG2 = 'acct-a-seamlg2';
  const NT = 'acct-a-seamnt';
  const GX1 = '0189abcd-1234-4678-9abc-00000000e201';
  const GX2 = '0189abcd-1234-4678-9abc-00000000e202';
  const GOF = '0189abcd-1234-4678-9abc-00000000e203';
  const GOL = '0189abcd-1234-4678-9abc-00000000e204';
  const GLM = '0189abcd-1234-4678-9abc-00000000e205';
  const GL9 = '0189abcd-1234-4678-9abc-00000000e206';
  const GNT = '0189abcd-1234-4678-9abc-00000000e207';
  const OTHER_STORE = '0189abcd-1234-4678-9abc-00000000e2ff';
  const TX1 = 'e2b30001';
  const TX2 = 'e2b30002';
  const TOF = 'e2b30003';
  const TOL = 'e2b30004';
  const TLEG = 'e2b30005';
  const TLG2 = 'e2b30006';
  const TLG9 = 'e2b30007';
  const TNT = 'e2b30008';
  const u = (tag: string, i: number): string => `${tag}-0000-4000-8000-${String(i).padStart(12, '0')}`;
  const ts = (i: number): string => new Date(Date.UTC(2026, 9, 1, 10, 0, i)).toISOString();
  const N = u(TX1, 4);
  const NL = u(TLEG, 4);
  const NL2 = u(TLG2, 4);
  const NB = u(TNT, 1);
  const NB2 = u(TNT, 4);
  type Fx = typeof import('./historyFixtures.js');
  type Run = ReturnType<typeof healthHh.runCli>;
  interface EnvFx { box: HistoryBox; marker: string; realRp: string; list: string; sid: string; control: string; treatment: string }
  const ans = (r: Run): unknown[] => [r.code, r.json?.['reason']];
  const PANE_ENV: Record<string, string> = { TMUX_PANE: healthHh.PANE };
  const markerText = (storeId: string, pairs: ReadonlyArray<readonly [string, string]>): string =>
    `store ${storeId}\n${pairs.map(([id, g]) => `${id} ${g === '' ? '-' : g}\n`).join('')}`;
  /** A boundary N at ts(4) keeping row 3, its summary at ts(5), rows 1 to 3 before it and row 6 after it. */
  const leafRows = (fx: Fx, tag: string, cwd: string, word: string): object[] => {
    const b = { sessionId: u(tag, 0), cwd };
    return [
      fx.userRow({ ...b, uuid: u(tag, 1), ts: ts(1), text: `${word}pre the question` }),
      fx.assistantRow({ ...b, uuid: u(tag, 2), ts: ts(2), parentUuid: u(tag, 1), text: `${word}pre the answer`, requestId: `req_${tag}_2`, msgId: `msg_${tag}_2` }),
      fx.userRow({ ...b, uuid: u(tag, 3), ts: ts(3), parentUuid: u(tag, 2), text: `${word}pre kept by the boundary` }),
      fx.boundaryRow({ ...b, uuid: u(tag, 4), ts: ts(4), parentUuid: u(tag, 3), trigger: 'manual', headUuid: u(tag, 3), anchorUuid: u(tag, 5), tailUuid: u(tag, 3), allUuids: [u(tag, 3)] }),
      fx.summaryRow({ ...b, uuid: u(tag, 5), ts: ts(5), parentUuid: u(tag, 4), text: `<summary>\n1. Primary Request and Intent:\n   ${word} intent\n</summary>` }),
      fx.userRow({ ...b, uuid: u(tag, 6), ts: ts(6), parentUuid: u(tag, 5), text: `${word}post after the boundary` }),
    ];
  };
  const plainRows = (fx: Fx, tag: string, cwd: string, at: number, word: string): object[] => [
    fx.userRow({ sessionId: u(tag, 0), cwd, uuid: u(tag, 1), ts: ts(at), text: `${word} the question` }),
    fx.assistantRow({ sessionId: u(tag, 0), cwd, uuid: u(tag, 2), ts: ts(at + 1), parentUuid: u(tag, 1), text: `${word} the answer`, requestId: `req_${tag}_2`, msgId: `msg_${tag}_2` }),
  ];
  /** NB is the transcript's first row, a boundary with no stamp, so asOfCut finds no stamp at or before it; NB2 is stamped. */
  const ntRows = (fx: Fx): object[] => {
    const b = { sessionId: u(TNT, 0), cwd: '/home/u/tree/legacy' };
    const first = { ...fx.boundaryRow({ ...b, uuid: NB, ts: ts(1), trigger: 'manual', headUuid: u(TNT, 9), anchorUuid: u(TNT, 2), tailUuid: u(TNT, 9), allUuids: [] }) } as Record<string, unknown>;
    delete first['timestamp'];
    return [
      first,
      fx.summaryRow({ ...b, uuid: u(TNT, 2), ts: ts(2), parentUuid: NB, text: '<summary>\n1. Primary Request and Intent:\n   zqseamnt intent\n</summary>' }),
      fx.userRow({ ...b, uuid: u(TNT, 3), ts: ts(3), parentUuid: u(TNT, 2), text: 'zqseamntpre before the second boundary' }),
      fx.boundaryRow({ ...b, uuid: NB2, ts: ts(4), parentUuid: u(TNT, 3), trigger: 'manual', headUuid: u(TNT, 3), anchorUuid: u(TNT, 5), tailUuid: u(TNT, 3), allUuids: [u(TNT, 3)] }),
      fx.summaryRow({ ...b, uuid: u(TNT, 5), ts: ts(5), parentUuid: NB2, text: '<summary>\n1. Primary Request and Intent:\n   zqseamnttwo intent\n</summary>' }),
    ];
  };
  let built: EnvFx | null = null;
  /** The box, captured once for the describe (the seededBox precedent above): every case may run alone under -t. */
  async function envFx(): Promise<EnvFx> {
    if (built !== null) return built;
    const fx = await import('./historyFixtures.js');
    const L = (await import('../../ccd/history/lib.mjs')) as unknown as { RECALL_ARMS: readonly string[] };
    const box = makeHistoryBox('ccrc-hist-cli-seamenv-', { role: 'fleet', shim: true });
    const real = path.join(box.home, 'ws-real');
    const link = path.join(box.home, 'ws-link');
    fs.mkdirSync(real);
    fs.symlinkSync(real, link);
    const realRp = fs.realpathSync(real);
    healthHh.seedFamily(box, { id: X, project: 'demo', uuid: u(TX1, 0), generation: GX1, rows: leafRows(fx, TX1, link, 'zqseamx') });
    healthHh.seedFamily(box, { id: OF, project: 'demo', uuid: u(TOF, 0), generation: GOF, rows: plainRows(fx, TOF, real, 1, 'zqseamofword') });
    healthHh.seedFamily(box, { id: OL, project: 'demo', uuid: u(TOL, 0), generation: GOL, rows: plainRows(fx, TOL, '/home/u/tree/elsewhere', 30, 'zqseamolword') });
    healthHh.seedFamily(box, { id: X, project: 'demo', uuid: u(TX2, 0), generation: GX2, rows: plainRows(fx, TX2, '/home/u/tree/reuse', 20, 'zqseamxreuse') });
    healthHh.seedFamily(box, { id: LEG, project: 'legacy', uuid: u(TLEG, 0), generation: null, rows: leafRows(fx, TLEG, '/home/u/tree/legacy', 'zqseamleg') });
    // DM18b's re-key: a generation minted later for a uuid the '' family holds merges that family into (LEG, GLM).
    healthHh.plantSession(box, LEG, { generation: GLM });
    healthHh.spoolLine(box, LEG, { v: 1, ev: 'SessionStart', id: LEG, sid: u(TLEG, 0), src: 'resume', reg: u(TLEG, 0), gen: GLM });
    healthHh.seedFamily(box, { id: LEG2, project: 'legacy', uuid: u(TLG2, 0), generation: null, rows: leafRows(fx, TLG2, '/home/u/tree/legacy', 'zqseamlg2') });
    healthHh.seedFamily(box, { id: LEG2, project: 'legacy', uuid: u(TLG9, 0), generation: GL9, rows: plainRows(fx, TLG9, '/home/u/tree/legacy', 40, 'zqseamlg2new') });
    healthHh.seedFamily(box, { id: NT, project: 'legacy', uuid: u(TNT, 0), generation: GNT, rows: ntRows(fx) });
    for (let i = 0; i < 2; i += 1) { const s = runSweep(box); expect(s.code, s.stderr).toBe(0); }
    healthHh.plantSession(box, X, { workdir: '/home/u/tree/elsewhere' });
    healthHh.plantSession(box, XP, { project: 'other' });
    fs.rmSync(link);
    fs.rmSync(real, { recursive: true });
    healthHh.withPane(box, X);
    const sid = metaStoreId(box);
    built = {
      box, marker: path.join(box.root, 'headless-on'), realRp, sid,
      list: markerText(sid, [[X, GX1], [LEG, GLM], [LEG2, ''], [NT, GNT]]),
      control: L.RECALL_ARMS[0]!, treatment: L.RECALL_ARMS[1]!,
    };
    return built;
  }
  const armWith = (f: EnvFx, text: string): void => {
    fs.rmSync(f.marker, { force: true });
    fs.writeFileSync(f.marker, text, { mode: 0o600 });
  };
  const ENV = (f: EnvFx, o: Record<string, string> = {}): Record<string, string> =>
    ({ CCRC_RECALL_SESSION: X, CCRC_RECALL_ARM: f.treatment, CCRC_RECALL_ASOF: N, ...o });
  const run = (f: EnvFx, argv: readonly string[], env: Record<string, string>): Run => healthHh.runCli(f.box, [...argv], { env });
  const calls = (f: EnvFx): string => path.join(f.box.home, 'tmux-calls');
  /** The recall lines in spool/<id>.jsonl, oldest first. */
  const lines = (f: EnvFx, id: string): Array<Record<string, unknown>> => {
    const p = hist(f.box, 'spool', `${id}.jsonl`);
    if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, 'utf8').split('\n').filter((l) => l !== '')
      .map((l) => JSON.parse(l) as Record<string, unknown>).filter((r) => r['ev'] === 'recall');
  };
  /** The --json scope's families as `id:generation`, sorted. */
  const gens = (r: Run): string[] => {
    const s = r.json?.['scope'] as { families?: Array<{ ccrc_id: string; generation: string }> } | null | undefined;
    return (s?.families ?? []).map((x) => `${x.ccrc_id}:${x.generation}`).sort();
  };

  it('seam fixture: CONTROL: the families, epochs, boundaries and registry are what the cases assume, and asOfCutOf cuts at N, NL, NL2 and NB2 but not at NB', async () => {
    const f = await envFx();
    const R = (await import('../../ccd/history/recall.mjs')) as unknown as { asOfCutOf(rc: { db: unknown }, asof: string): { ok: boolean; reason?: string } };
    const db = healthHh.openStoreRO(f.box);
    try {
      expect(db.prepare(`SELECT ccrc_id, generation, project, merged_into IS NOT NULL AS merged FROM sessions
        WHERE ccrc_id IN (?, ?, ?, ?, ?, ?) ORDER BY ccrc_id, generation`).all(X, OF, OL, LEG, LEG2, NT)).toEqual([
        { ccrc_id: LEG, generation: '', project: 'legacy', merged: 1 },
        { ccrc_id: LEG, generation: GLM, project: 'legacy', merged: 0 },
        { ccrc_id: LEG2, generation: '', project: 'legacy', merged: 0 },
        { ccrc_id: LEG2, generation: GL9, project: 'legacy', merged: 0 },
        { ccrc_id: NT, generation: GNT, project: 'legacy', merged: 0 },
        { ccrc_id: OF, generation: GOF, project: 'demo', merged: 0 },
        { ccrc_id: OL, generation: GOL, project: 'demo', merged: 0 },
        { ccrc_id: X, generation: GX1, project: 'demo', merged: 0 },
        { ccrc_id: X, generation: GX2, project: 'demo', merged: 0 },
      ]);
      expect(db.prepare(`SELECT s.ccrc_id AS id, s.generation AS g, e.cwd AS cwd, e.cwd_real AS cwd_real FROM epochs e
        JOIN sessions s ON s.session_pk = e.session_pk WHERE e.confirmed_ms IS NOT NULL AND s.ccrc_id IN (?, ?, ?)
        ORDER BY s.ccrc_id, s.generation`).all(X, OF, OL), 'the anchor is stored: cwd verbatim, cwd_real resolved at ingest').toEqual([
        { id: OF, g: GOF, cwd: path.join(f.box.home, 'ws-real'), cwd_real: f.realRp },
        { id: OL, g: GOL, cwd: '/home/u/tree/elsewhere', cwd_real: null },
        { id: X, g: GX1, cwd: path.join(f.box.home, 'ws-link'), cwd_real: f.realRp },
        { id: X, g: GX2, cwd: '/home/u/tree/reuse', cwd_real: null },
      ]);
      expect(db.prepare(`SELECT x.uuid AS uuid, x.ts_ms IS NULL AS unstamped FROM boundaries b JOIN entries x ON x.entry_id = b.entry_id
        WHERE x.uuid IN (?, ?, ?, ?, ?) ORDER BY x.uuid`).all(N, NL, NL2, NB, NB2)).toEqual([
        { uuid: N, unstamped: 0 }, { uuid: NL, unstamped: 0 }, { uuid: NL2, unstamped: 0 }, { uuid: NB, unstamped: 1 }, { uuid: NB2, unstamped: 0 },
      ]);
      for (const b of [N, NL, NL2, NB2]) expect(R.asOfCutOf({ db }, b).ok, b).toBe(true);
      expect(R.asOfCutOf({ db }, NB), 'no stamp at or before NB: the store half refuses').toMatchObject({ ok: false, reason: 'asof-invalid' });
    } finally {
      db.close();
    }
    expect(fs.readFileSync(path.join(f.box.reg, `${X}.generation`), 'utf8'), 'the registry says the reused life').toBe(GX2);
    expect(fs.readFileSync(path.join(f.box.reg, `${X}.project`), 'utf8')).toBe('demo');
    expect(fs.existsSync(f.realRp), 'the anchor no longer resolves on this box').toBe(false);
  }, 900_000);

  it('seam ladder: each step of W2-D46 answers its own word in order, with no tmux call; nothing is counted before step 4 admits the family, and every call after it is counted (C16, C30)', async () => {
    const f = await envFx();
    const L = (await import('../../ccd/history/lib.mjs')) as unknown as { REASONS: Record<string, number> };
    expect([L.REASONS['headless-malformed'], L.REASONS['headless-arm-unknown']], 'C16: both words are exit 2').toEqual([2, 2]);
    fs.rmSync(calls(f), { force: true });
    fs.rmSync(f.marker, { force: true });
    let seen = lines(f, X).length;
    const step = (what: string, env: Record<string, string>, want: readonly unknown[], counted: boolean, storeNamed: boolean): Run => {
      const r = run(f, ['grep', 'zqseamxpre', '--json'], env);
      expect(ans(r), `${what}: ${r.stderr}${r.stdout}`).toEqual([...want]);
      expect(r.json?.['store_id'] ?? null, `${what}: the store is named from step 3 on, never before`).toBe(storeNamed ? f.sid : null);
      const now = lines(f, X).length;
      expect(now - seen, `${what}: a counter line iff step 4 admitted the family`).toBe(counted ? 1 : 0);
      seen = now;
      return r;
    };
    // Row 0: the server-role row answers before the seam is looked at.
    const ccrcEnv = path.join(f.box.home, '.ccrc', 'ccrc.env');
    fs.writeFileSync(ccrcEnv, 'CCRC_ROLE=server\n');
    try {
      step('row 0, a server role', ENV(f), [9, undefined], false, false);
    } finally {
      fs.writeFileSync(ccrcEnv, 'CCRC_ROLE=fleet\n');
    }
    // W2-D45: empty values are unset, so this is the tmux path, which with no pane is no-identity.
    step('empty values are unset', { CCRC_RECALL_SESSION: '', CCRC_RECALL_ARM: '', CCRC_RECALL_ASOF: '' }, [2, 'no-identity'], false, false);
    // Step 1, in its order.
    step('step 1, no marker (C30)', ENV(f), [2, 'headless-unarmed'], false, false);
    armWith(f, 'not a marker\n');
    step('step 1, a malformed marker (C16)', ENV(f), [2, 'headless-malformed'], false, false);
    armWith(f, f.list);
    step('step 1, SESSION unset', { CCRC_RECALL_ARM: f.treatment, CCRC_RECALL_ASOF: N }, [2, 'no-identity'], false, false);
    step('step 1, a bad id', ENV(f, { CCRC_RECALL_SESSION: '../x' }), [2, 'bad-id'], false, false);
    step('step 1, an id on no list line (C30)', ENV(f, { CCRC_RECALL_SESSION: 'acct-z-unlisted' }), [2, 'headless-unlisted'], false, false);
    step('step 1, ARM empty (C16)', ENV(f, { CCRC_RECALL_ARM: '' }), [2, 'headless-arm-unknown'], false, false);
    step('step 1, ARM off the vocabulary', ENV(f, { CCRC_RECALL_ARM: 'placebo' }), [2, 'headless-arm-unknown'], false, false);
    step('step 1, ASOF not a uuid', ENV(f, { CCRC_RECALL_ASOF: 'not-a-uuid' }), [2, 'asof-invalid'], false, false);
    // Step 2: the harness, still $REG/<id>.harness (W2-D40's residual).
    const harness = path.join(f.box.reg, `${X}.harness`);
    fs.writeFileSync(harness, 'codex');
    try {
      step('step 2, an unsupported harness', ENV(f), [2, 'harness-unsupported'], false, false);
      // W2-D46's order across steps 1, 2 and 3: an input that fails two adjacent steps answers the earlier word. Each
      // pair's CONTROL is the later step's row alone: the harness row above, and Task 4's store-table row.
      fs.rmSync(f.marker);
      step('step 1 before step 2: no marker, and an unsupported harness', ENV(f), [2, 'headless-unarmed'], false, false);
      armWith(f, f.list);
      const storeIdFile = hist(f.box, 'store.id');
      const savedStoreId = fs.readFileSync(storeIdFile);
      fs.writeFileSync(storeIdFile, `${OTHER_STORE}\n`);
      try {
        step('step 2 before step 3: an unsupported harness, and another store\'s store.id', ENV(f), [2, 'harness-unsupported'], false, false);
      } finally {
        fs.writeFileSync(storeIdFile, savedStoreId);
      }
    } finally {
      fs.rmSync(harness);
    }
    // Step 4: the family from ASOF, the store line and the pair. The store is named; nothing is counted.
    step('step 4, an ASOF no row has', ENV(f, { CCRC_RECALL_ASOF: u('e2b3ffff', 1) }), [2, 'asof-invalid'], false, true);
    step('step 4, an ASOF that is no boundary', ENV(f, { CCRC_RECALL_ASOF: u(TX1, 1) }), [2, 'asof-invalid'], false, true);
    step('step 4, a boundary of another id', ENV(f, { CCRC_RECALL_ASOF: NL }), [2, 'asof-invalid'], false, true);
    armWith(f, markerText(OTHER_STORE, [[X, GX1]]));
    step('step 4, another store marker', ENV(f), [2, 'headless-unlisted'], false, true);
    // R3: the store line is answered before any ASOF row is read, so a fault planted on asOfFamilySql's own text never
    // fires for a foreign marker. CONTROL: under this store's own line the same fault fires, a read failure before the
    // admission (5, uncounted).
    const faulted = (): Run => healthHh.runCli(f.box, ['grep', 'zqseamxpre', '--json'],
      { preloads: [PRELOADS.faults], env: { ...ENV(f), HISTORY_TEST_THROW_PREPARE: 'SqliteError:zqseamfault@AS into_merged_into' } });
    const foreign = faulted();
    expect(ans(foreign), `step 4, another store marker, its ASOF read faulted: ${foreign.stderr}`).toEqual([2, 'headless-unlisted']);
    armWith(f, f.list);
    const own = faulted();
    expect(ans(own), `CONTROL, step 4, this store's line, the ASOF read faulted: ${own.stderr}`).toEqual([5, 'store-read-failed']);
    expect(lines(f, X).length, 'neither faulted call is counted: neither was admitted').toBe(seen);
    armWith(f, markerText(f.sid, [[X, GX2]]));
    step('step 4, the id listed under another generation (C30)', ENV(f), [2, 'headless-unlisted'], false, true);
    step('step 4 before step 6: ARM=control on an unlisted pair is not 8', ENV(f, { CCRC_RECALL_ARM: f.control }), [2, 'headless-unlisted'], false, true);
    armWith(f, f.list);
    // Step 5: recall-off naming the resolved generation: exit 8, counted (C30).
    const off = hist(f.box, 'recall-off', X);
    fs.mkdirSync(path.dirname(off), { recursive: true });
    fs.writeFileSync(off, `${GX1}\n`);
    try {
      step('step 5, recall-off naming G1 (C30)', ENV(f), [8, undefined], true, true);
    } finally {
      fs.rmSync(off);
    }
    // The lines carry the resolved generation here; Task 4 adds the arm to them (R4) and pins it in its own ladder.
    expect(lines(f, X).at(-1), 'the step-5 line: the resolved generation').toMatchObject({ gen: GX1, cmd: 'grep', rc: 8 });
    // Step 6: ARM=control: exit 8, counted (C30).
    step('step 6, ARM=control (C30)', ENV(f, { CCRC_RECALL_ARM: f.control }), [8, undefined], true, true);
    expect(lines(f, X).at(-1)).toMatchObject({ gen: GX1, rc: 8 });
    // Step 7: the treatment arm reads.
    const r = step('step 7, the treatment arm', ENV(f), [0, undefined], true, true);
    expect(r.stdout).toContain('zqseamxpre');
    expect(lines(f, X).at(-1)).toMatchObject({ gen: GX1, rc: 0 });
    expect(fs.existsSync(calls(f)), 'no step of the headless path asks tmux').toBe(false);
    // Step 3, on a box whose first tick has not run: 6, the store never opened. Its CONTROL is every step-4 row above,
    // which named the store, so step 3 had passed.
    const bare = makeHistoryBox('ccrc-hist-cli-seamenv3-', { role: 'fleet', shim: true });
    fs.mkdirSync(bare.root, { recursive: true });
    fs.writeFileSync(path.join(bare.root, 'headless-on'), markerText(OTHER_STORE, [[X, GX1]]), { mode: 0o600 });
    expect(status(bare).code, 'CONTROL: the shim-only row of the table is 6').toBe(6);
    const r3 = healthHh.runCli(bare, ['grep', 'zqseamxpre', '--json'], { env: ENV(f) });
    expect(ans(r3), `step 3, no store: ${r3.stderr}`).toEqual([6, undefined]);
    expect(r3.json?.['store_id'] ?? null).toBeNull();
  }, 900_000);

  it('seam reuse: W2-D40 purge and reuse, (X, G1) listed and ASOF in its transcript while the registry and CCRC_SESSION_GENERATION both say G2: the default scope and --session X read G1, and recall-off is judged against G1; CONTROL: the tmux path reads G2 (C48 stays tmux-only)', async () => {
    const f = await envFx();
    armWith(f, f.list);
    const env = ENV(f, { CCRC_SESSION_GENERATION: GX2 });
    for (const extra of [[], ['--session', X]]) {
      const r = run(f, ['grep', 'zqseamxpre', ...extra, '--json'], env);
      expect(ans(r), `${extra.join(' ')}: ${r.stderr}`).toEqual([0, undefined]);
      expect(gens(r), `${extra.join(' ')}: the family ASOF sits in`).toEqual([`${X}:${GX1}`]);
      expect(r.stdout).toContain('zqseamxpre');
    }
    const off = hist(f.box, 'recall-off', X);
    fs.mkdirSync(path.dirname(off), { recursive: true });
    fs.writeFileSync(off, `${GX2}\n`);
    try {
      expect(ans(run(f, ['grep', 'zqseamxpre', '--json'], env)), 'recall-off naming G2 is stale for the resolved G1: the call reads').toEqual([0, undefined]);
      expect(ans(run(f, ['grep', 'zqseamxreuse', '--json'], { ...PANE_ENV, CCRC_SESSION_GENERATION: GX2 })), 'CONTROL: the tmux path resolves G2, so the same file is off').toEqual([8, undefined]);
    } finally {
      fs.rmSync(off);
    }
    // CONTROL, C48 stays tmux-only: no CCRC_SESSION_GENERATION and $REG/<id>.generation = G2: the tmux scope is (X, G2).
    const t = run(f, ['grep', 'zqseamxreuse', '--json'], PANE_ENV);
    expect(ans(t), t.stderr).toEqual([0, undefined]);
    expect(gens(t)).toEqual([`${X}:${GX2}`]);
  }, 900_000);

  it('seam legacy: W2-D40, a merged legacy family is admitted under the family it merged into, and an unmerged legacy family is read by its exact empty key, never the newest; that call is counted with no gen', async () => {
    const f = await envFx();
    armWith(f, f.list);
    const m = run(f, ['grep', 'zqseamlegpre', '--json'], ENV(f, { CCRC_RECALL_SESSION: LEG, CCRC_RECALL_ASOF: NL }));
    expect(ans(m), m.stderr).toEqual([0, undefined]);
    expect(gens(m), 'the merged family is read as the one it merged into').toEqual([`${LEG}:${GLM}`]);
    expect(lines(f, LEG).at(-1)).toMatchObject({ gen: GLM, rc: 0 });
    for (const extra of [[], ['--session', LEG2]]) {
      const r = run(f, ['grep', 'zqseamlg2pre', ...extra, '--json'], ENV(f, { CCRC_RECALL_SESSION: LEG2, CCRC_RECALL_ASOF: NL2 }));
      expect(ans(r), `${extra.join(' ')}: ${r.stderr}`).toEqual([0, undefined]);
      expect(gens(r), `${extra.join(' ')}: the exact empty key`).toEqual([`${LEG2}:`]);
    }
    const last = lines(f, LEG2).at(-1)!;
    expect(last, 'counted').toMatchObject({ rc: 0 });
    expect('gen' in last, 'no gen: the resolved generation is not a uuid (decisions section 7)').toBe(false);
    // CONTROL: LEG2's newest family is (LEG2, GL9), which the tmux path reads from the registry.
    healthHh.withPane(f.box, LEG2);
    try {
      const t = run(f, ['grep', 'zqseamlg2new', '--json'], PANE_ENV);
      expect(ans(t), t.stderr).toEqual([0, undefined]);
      expect(gens(t)).toEqual([`${LEG2}:${GL9}`]);
    } finally {
      healthHh.withPane(f.box, X);
    }
  }, 900_000);

  it('seam cut: W2-D46 step 7 sets the cut from ASOF through asOfCutOf, so the W2-2a doors hide what follows N; the store half refusing at step 7 is counted (D-5765)', async () => {
    const f = await envFx();
    armWith(f, f.list);
    const at = (argv: readonly string[], env: Record<string, string>): unknown[] => ans(run(f, argv, env));
    // CONTROL: the tmux path reads (X, G1) with no cut when CCRC_SESSION_GENERATION names G1.
    const noCut = { ...PANE_ENV, CCRC_SESSION_GENERATION: GX1 };
    expect(at(['grep', 'zqseamxpost', '--json'], noCut), 'CONTROL: with no cut the row after N is there').toEqual([0, undefined]);
    expect(at(['expand', u(TX1, 6), '--json'], noCut)).toEqual([0, undefined]);
    expect(at(['grep', 'zqseamxpost', '--json'], ENV(f)), 'under ASOF=N the row after N is absent').toEqual([3, undefined]);
    expect(at(['grep', 'zqseamxpre', '--json'], ENV(f))).toEqual([0, undefined]);
    expect(at(['expand', u(TX1, 6), '--json'], ENV(f)), 'hidden means absent: exit 3, never out-of-scope (W2-D36)').toEqual([3, undefined]);
    expect(at(['expand', u(TX1, 1), '--json'], ENV(f))).toEqual([0, undefined]);
    const rx = run(f, ['grep', '--regex', 'zqseamx(pre|post)', '--json'], ENV(f));
    expect(ans(rx), rx.stderr).toEqual([0, undefined]);
    expect(rx.stdout).toContain('zqseamxpre');
    expect(rx.stdout, 'the regex child gets the cut too').not.toContain('zqseamxpost');
    const tree = run(f, ['tree', '--json'], ENV(f));
    expect(ans(tree), tree.stderr).toEqual([0, undefined]);
    expect(tree.json?.['scope'], 'the header counts what the cut shows').toMatchObject({ transcripts: 1, families_total: 1 });
    // NT's first boundary has no stamp at or before it: the store half answers asof-invalid after admission, counted (R5a).
    const before = lines(f, NT).length;
    const nt = run(f, ['grep', 'zqseamntpre', '--json'], ENV(f, { CCRC_RECALL_SESSION: NT, CCRC_RECALL_ASOF: NB }));
    expect(ans(nt), nt.stderr).toEqual([2, 'asof-invalid']);
    expect(lines(f, NT).length - before, 'counted: step 4 admitted the family').toBe(1);
    expect(lines(f, NT).at(-1)).toMatchObject({ gen: GNT, rc: 2 });
    expect(at(['grep', 'zqseamntpre', '--json'], ENV(f, { CCRC_RECALL_SESSION: NT, CCRC_RECALL_ASOF: NB2 })), 'CONTROL: the stamped boundary of the same family cuts').toEqual([0, undefined]);
  }, 900_000);

  it('seam widened: W2-D41, --project and --session stay legal on env and are cut, a family with no visible epoch is dropped from the scope and its count; the env-only guard answers cross-project when the registry project is not the stored one', async () => {
    const f = await envFx();
    armWith(f, f.list);
    // CONTROL: the tmux path (X's registry life, G2) sees the project's four families, OL's text included.
    const t = run(f, ['tree', '--project', '--json'], PANE_ENV);
    expect(ans(t), t.stderr).toEqual([0, undefined]);
    // The --json scope names at most SCOPE_FAMILIES_JSON_MAX families (oldest first) and counts all of them.
    expect(t.json?.['scope'], 'CONTROL: four families in the project').toMatchObject({ kind: 'project', families_total: 4 });
    expect(gens(t)).toEqual([`${OF}:${GOF}`, `${OL}:${GOL}`, `${X}:${GX1}`].sort());
    expect(ans(run(f, ['grep', 'zqseamolword', '--project', '--json'], PANE_ENV))).toEqual([0, undefined]);
    // Under ASOF=N: OL and (X, G2) hold only rows stamped after T_N, so they leave the scope and its count.
    const e = run(f, ['tree', '--project', '--json'], ENV(f));
    expect(ans(e), e.stderr).toEqual([0, undefined]);
    expect(e.json?.['scope']).toMatchObject({ kind: 'project', families_total: 2 });
    expect(gens(e)).toEqual([`${OF}:${GOF}`, `${X}:${GX1}`]);
    expect(ans(run(f, ['grep', 'zqseamolword', '--project', '--json'], ENV(f))), 'a dropped family text is absent').toEqual([3, undefined]);
    expect(ans(run(f, ['grep', 'zqseamofword', '--project', '--json'], ENV(f)))).toEqual([0, undefined]);
    // --session <other> takes the other id's newest family, then the cut (W2-D40's residual).
    expect(ans(run(f, ['grep', 'zqseamofword', '--session', OF, '--json'], ENV(f)))).toEqual([0, undefined]);
    expect(ans(run(f, ['grep', 'zqseamolword', '--session', OL, '--json'], ENV(f)))).toEqual([3, undefined]);
    // The env-only guard: $REG/X.project names another project than the family's stored one.
    const proj = path.join(f.box.reg, `${X}.project`);
    const before = lines(f, X).length;
    fs.writeFileSync(proj, 'other');
    try {
      expect(ans(run(f, ['grep', 'zqseamxpre', '--json'], ENV(f))), 'the guard: cross-project').toEqual([2, 'cross-project']);
      expect(lines(f, X).length - before, 'counted: the guard is step 7, after admission').toBe(1);
      expect(ans(run(f, ['grep', 'zqseamxreuse', '--json'], PANE_ENV)), 'CONTROL: the tmux path has no such guard').toEqual([0, undefined]);
      fs.rmSync(proj);
      expect(ans(run(f, ['grep', 'zqseamxpre', '--json'], ENV(f))), 'no registry project: the default scope used none, and reads').toEqual([0, undefined]);
      expect(ans(run(f, ['grep', 'zqseamxpre', '--project', '--json'], ENV(f))), 'and --project needs one').toEqual([2, 'project-unreadable']);
    } finally {
      fs.writeFileSync(proj, 'demo');
    }
  }, 900_000);

  it('seam workspace: D-5767, --workspace on env anchors on the stored cwd_real or cwd of the epoch ASOF sits in, never on the registry workdir, and matches it as stored, with no realpath at read time', async () => {
    const f = await envFx();
    armWith(f, f.list);
    expect(fs.readFileSync(path.join(f.box.reg, `${X}.workdir`), 'utf8'), 'CONTROL: the registry names another workdir').toBe('/home/u/tree/elsewhere');
    const e = run(f, ['tree', '--workspace', '--json'], ENV(f));
    expect(ans(e), e.stderr).toEqual([0, undefined]);
    expect(e.json?.['scope']).toMatchObject({ kind: 'workspace' });
    expect(gens(e), 'the G1 family and OF, whose epochs ran in the anchor; never OL, the registry workdir').toEqual([`${OF}:${GOF}`, `${X}:${GX1}`]);
    expect(ans(run(f, ['grep', 'zqseamofword', '--workspace', '--json'], ENV(f)))).toEqual([0, undefined]);
    // CONTROL: the tmux path anchors on $REG/<id>.workdir, as spec 8.2 says: OL alone.
    const t = run(f, ['tree', '--workspace', '--json'], PANE_ENV);
    expect(ans(t), t.stderr).toEqual([0, undefined]);
    expect(gens(t)).toEqual([`${OL}:${GOL}`]);
  }, 900_000);

  it('seam C50: on the env path the CLI answers the decideScope verdict with source env, flag set by flag; an unknown source is refused', async () => {
    const f = await envFx();
    armWith(f, f.list);
    const L = (await import('../../ccd/history/lib.mjs')) as unknown as { decideScope(i: Record<string, unknown>): Record<string, unknown> };
    const pres = (p: string): Record<string, unknown> =>
      (fs.existsSync(p) ? { state: 'value', value: fs.readFileSync(p, 'utf8') } : { state: 'absent' });
    const ROWS: ReadonlyArray<readonly string[]> = [
      [], ['--project'], ['--workspace'], ['--session', X], ['--session', OF], ['--session', XP], ['--project', '--workspace'], ['--session', '../x'],
    ];
    for (const extra of ROWS) {
      const at = extra.indexOf('--session');
      const session = at < 0 ? null : extra[at + 1]!;
      const v = L.decideScope({
        source: 'env', id: X, generation: { value: GX1, via: 'asof' },
        flags: { project: extra.includes('--project'), workspace: extra.includes('--workspace'), session },
        reg: {
          project: pres(path.join(f.box.reg, `${X}.project`)),
          workdir: { state: 'value', value: f.realRp },
          sessionProject: session === null ? null
            : (/^[A-Za-z0-9._-]+$/.test(session) ? pres(path.join(f.box.reg, `${session}.project`)) : { state: 'absent' }),
        },
      });
      const want = v['ok'] === true ? [0, v['kind']] : [v['rc'], v['reason']];
      if (extra.length === 0) expect(want, 'CONTROL: decideScope admits source env, so the default row is a family verdict').toEqual([0, 'family']);
      const r = run(f, ['tree', ...extra, '--json'], ENV(f));
      const got = r.code === 0 ? [0, (r.json?.['scope'] as Record<string, unknown>)['kind']] : [r.code, r.json?.['reason']];
      expect(got, `${extra.join(' ') || '(default)'}: ${r.stderr}`).toEqual(want);
    }
    expect(L.decideScope({
      source: 'relay', id: X, generation: { value: GX1, via: 'asof' }, flags: { project: false, workspace: false, session: null },
      reg: { project: { state: 'value', value: 'demo' }, workdir: { state: 'absent' }, sessionProject: null },
    }), 'an unknown source is refused, not defaulted').toEqual({ ok: false, rc: 2, reason: 'no-identity' });
  }, 900_000);

  it('seam C24: under env an admitted call writes one fenced recall line with the resolved gen and no query text, drained to a recall_calls row; a tmux call carries no arm; under history-off nothing is written', async () => {
    const f = await envFx();
    armWith(f, f.list);
    const p = hist(f.box, 'spool', `${X}.jsonl`);
    const text = (): string => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
    const t0 = text();
    expect(ans(run(f, ['grep', 'zqseamxpre', '--json'], ENV(f)))).toEqual([0, undefined]);
    const added = text().slice(t0.length);
    expect(added, 'fenced as the hook fences its lines').toMatch(/^\n\{.*\}\n$/);
    const line = JSON.parse(added.trim()) as Record<string, unknown>;
    expect(line).toMatchObject({ v: 1, ev: 'recall', id: X, gen: GX1, cmd: 'grep', rc: 0 });
    // Every key but `arm`, which Task 4 adds (R4); its key set is Task 4's ladder's.
    expect(Object.keys(line).filter((k) => k !== 'arm').sort()).toEqual(['cmd', 'ev', 'gen', 'id', 'ms', 'rc', 'ts', 'v']);
    expect(added, 'no query text (G5)').not.toContain('zqseamxpre');
    const t1 = text();
    expect(ans(run(f, ['grep', 'zqseamxreuse', '--json'], PANE_ENV))).toEqual([0, undefined]);
    const tmuxLine = JSON.parse(text().slice(t1.length).trim()) as Record<string, unknown>;
    expect(tmuxLine, 'a tmux call').toMatchObject({ id: X, gen: GX2, cmd: 'grep', rc: 0 });
    expect('arm' in tmuxLine, 'a tmux call writes no arm (W2-D43)').toBe(false);
    // The drain, with the marker set aside so the tick sees the box as it is outside a window.
    fs.rmSync(f.marker, { force: true });
    // Two ticks: the first journals the spool file, the second drains it (the seeding loop's rule).
    for (let i = 0; i < 2; i += 1) { const s = runSweep(f.box); expect(s.code, s.stderr).toBe(0); }
    const db = healthHh.openStoreRO(f.box);
    try {
      const rows = db.prepare('SELECT generation, verb, rc, arm FROM recall_calls WHERE ccrc_id = ? AND rc = 0 ORDER BY ts_ms, event_key')
        .all(X) as Array<Record<string, unknown>>;
      expect(rows.map((x) => ({ generation: x['generation'], verb: x['verb'], rc: x['rc'] })), 'the env call is a row of its family').toEqual(expect.arrayContaining([{ generation: GX1, verb: 'grep', rc: 0 }]));
      expect(rows.filter((x) => x['generation'] === GX2).map((x) => x['arm']), 'the tmux calls').toContain(null);
      expect(rows.filter((x) => x['generation'] === GX2 && x['arm'] !== null), 'no tmux call has an arm').toEqual([]);
    } finally {
      db.close();
    }
    // history-off: nothing is written (C24).
    armWith(f, f.list);
    const offFile = path.join(f.box.home, '.ccrc', 'history-off');
    fs.writeFileSync(offFile, '');
    try {
      const t2 = text();
      run(f, ['grep', 'zqseamxpre', '--json'], ENV(f));
      expect(text(), 'under history-off no counter line').toBe(t2);
    } finally {
      fs.rmSync(offFile);
    }
  }, 900_000);

  it('seam marker read: W2-D44, the marker is read only through store.mjs\'s bounded reader: a link to a valid list and a FIFO are headless-malformed; a list of exactly HEADLESS_LIST_MAX_BYTES bytes is read, and one byte more is malformed', async () => {
    const f = await envFx();
    const L = (await import('../../ccd/history/lib.mjs')) as unknown as { HEADLESS_LIST_MAX_BYTES: number };
    const MAX = L.HEADLESS_LIST_MAX_BYTES;
    expect(MAX).toBe(65_536);
    const q = (): unknown[] => ans(run(f, ['grep', 'zqseamxpre', '--json'], ENV(f)));
    const aside = path.join(f.box.home, 'list-aside');
    fs.writeFileSync(aside, f.list);
    fs.rmSync(f.marker, { force: true });
    fs.symlinkSync(aside, f.marker);
    expect(q(), 'a link is never followed').toEqual([2, 'headless-malformed']);
    fs.rmSync(f.marker);
    fs.copyFileSync(aside, f.marker);
    expect(q(), 'CONTROL: the same text as a regular file').toEqual([0, undefined]);
    fs.rmSync(f.marker);
    expect(spawnSync('mkfifo', [f.marker]).status).toBe(0);
    expect(q(), 'a FIFO is no regular file, and is never waited on').toEqual([2, 'headless-malformed']);
    fs.rmSync(f.marker);
    const head = f.list.endsWith('\n') ? f.list : `${f.list}\n`;
    const padded = (n: number): string => `${head}#${'x'.repeat(n - head.length - 2)}\n`;
    expect(Buffer.byteLength(padded(MAX))).toBe(MAX);
    armWith(f, padded(MAX));
    expect(q(), 'exactly HEADLESS_LIST_MAX_BYTES bytes: read whole').toEqual([0, undefined]);
    armWith(f, padded(MAX + 1));
    expect(q(), 'one byte more: malformed, never read as a prefix').toEqual([2, 'headless-malformed']);
    armWith(f, f.list);
  }, 900_000);

  it('seam workspace edge space: D-6445, --workspace on env matches the stored anchor untrimmed: the epoch ASOF sits in ran in "a ", so the scope is its families, never the sibling "a" in the same project', async () => {
    const fx = await import('./historyFixtures.js');
    const L = (await import('../../ccd/history/lib.mjs')) as unknown as { RECALL_ARMS: readonly string[] };
    const XS = 'acct-a-seamxs';
    const SPW = 'acct-a-seamsw';
    const SPN = 'acct-a-seamsn';
    const GXS = '0189abcd-1234-4678-9abc-00000000e211';
    const GSW = '0189abcd-1234-4678-9abc-00000000e212';
    const GSN = '0189abcd-1234-4678-9abc-00000000e213';
    const TXS = 'e2b30011';
    const TSW = 'e2b30012';
    const TSN = 'e2b30013';
    const box = makeHistoryBox('ccrc-hist-cli-seamsp-', { role: 'fleet', shim: true });
    // Two real sibling directories whose names differ only by the space at the end; both resolve to themselves.
    const spaced = path.join(fs.realpathSync(box.home), 'tree', 'a ');
    const plain = path.join(fs.realpathSync(box.home), 'tree', 'a');
    fs.mkdirSync(spaced, { recursive: true });
    fs.mkdirSync(plain, { recursive: true });
    healthHh.seedFamily(box, { id: XS, project: 'demo', uuid: u(TXS, 0), generation: GXS, rows: leafRows(fx, TXS, spaced, 'zqseamxs') });
    healthHh.seedFamily(box, { id: SPW, project: 'demo', uuid: u(TSW, 0), generation: GSW, rows: plainRows(fx, TSW, spaced, 1, 'zqseamsw') });
    healthHh.seedFamily(box, { id: SPN, project: 'demo', uuid: u(TSN, 0), generation: GSN, rows: plainRows(fx, TSN, plain, 1, 'zqseamsn') });
    healthHh.plantSession(box, XS, { workdir: '/home/u/tree/elsewhere' });
    const db = healthHh.openStoreRO(box);
    try {
      expect(db.prepare(`SELECT s.ccrc_id AS id, e.cwd AS cwd, e.cwd_real AS cwd_real FROM epochs e
        JOIN sessions s ON s.session_pk = e.session_pk WHERE e.confirmed_ms IS NOT NULL AND s.ccrc_id IN (?, ?, ?) ORDER BY s.ccrc_id`).all(XS, SPW, SPN),
      'CONTROL: the stored anchor keeps the space at its end, cwd verbatim and cwd_real resolved at ingest').toEqual([
        { id: SPN, cwd: plain, cwd_real: plain },
        { id: SPW, cwd: spaced, cwd_real: spaced },
        { id: XS, cwd: spaced, cwd_real: spaced },
      ]);
    } finally {
      db.close();
    }
    const marker = path.join(box.root, 'headless-on');
    fs.writeFileSync(marker, markerText(metaStoreId(box), [[XS, GXS]]), { mode: 0o600 });
    const env = { CCRC_RECALL_SESSION: XS, CCRC_RECALL_ARM: L.RECALL_ARMS[1]!, CCRC_RECALL_ASOF: u(TXS, 4) };
    const r = healthHh.runCli(box, ['tree', '--workspace', '--json'], { env });
    expect(ans(r), r.stderr).toEqual([0, undefined]);
    expect(r.json?.['scope']).toMatchObject({ kind: 'workspace' });
    const got = ((r.json?.['scope'] as { families?: Array<{ ccrc_id: string; generation: string }> }).families ?? [])
      .map((x) => `${x.ccrc_id}:${x.generation}`).sort();
    expect(got, 'the families whose epochs ran in "a "; never the sibling "a" of the same project').toEqual([`${SPW}:${GSW}`, `${XS}:${GXS}`]);
  }, 900_000);
});

// ── W2-2b Task 3 (W2-D47): the box verbs ignore the seam (C28 extended) ──────────────────────────────────────────────
describe('W2-2b Task 3: box verbs ignore the seam (W2-D47; C28 extended)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });

  it('seam box verbs: status, doctor and an operator verb answer with SESSION and ARM set, in a pane or not, as with none, and write no counter line; CONTROL: a read verb under the same values takes the headless path', async () => {
    const L = (await import('../../ccd/history/lib.mjs')) as unknown as { RECALL_ARMS: readonly string[] };
    const box = boundBox('ccrc-hist-cli-w2d47-');
    const pane = healthHh.withPane(box, ID);
    const tmuxCalls = path.join(box.home, 'tmux-calls');
    const seam: Record<string, string> = { CCRC_RECALL_SESSION: ID, CCRC_RECALL_ARM: L.RECALL_ARMS[1]! };
    const spoolDir = hist(box, 'spool');
    const before = fs.readdirSync(spoolDir).sort();
    const base = status(box);
    expect([base.code, base.env.exit], 'CONTROL: status with nothing set').toEqual([0, 0]);
    const d0 = healthHh.runCli(box, ['doctor', '--json']);
    const envs: Array<Record<string, string>> = [seam, { ...seam, CCRC_RECALL_ASOF: U9 }, { ...seam, ...pane }];
    for (const env of envs) {
      const what = JSON.stringify(env);
      const s = status(box, { env });
      expect([s.code, s.env.exit, s.env.reason], `C28 extended, status --json: ${what}`).toEqual([0, 0, undefined]);
      const d = healthHh.runCli(box, ['doctor', '--json'], { env });
      expect([d.code, d.json?.['exit'], d.json?.['reason']], `doctor --json: ${what}`).toEqual([d0.code, d0.json?.['exit'], d0.json?.['reason']]);
    }
    healthHh.stubShim(box, { stdout: '{"rc":0}\n', exit: 0 });
    const op = healthHh.runCli(box, ['recall-off', ID, '--generation', G1, '--json'], { env: seam });
    expect(op.code, `${op.stdout}${op.stderr}`).toBe(0);
    expect(fs.readFileSync(path.join(box.home, 'stub-shim-argv'), 'utf8'), 'the operator verb reached its door as typed').toContain(`--op recall-off ${ID} --generation ${G1}`);
    expect(fs.readdirSync(spoolDir).sort(), 'no box verb wrote a counter line').toEqual(before);
    expect(fs.existsSync(tmuxCalls), 'no box verb asked tmux').toBe(false);
    // CONTROL: the same values reach a read verb: with no pane the headless path (no marker on this box), in a pane
    // W2-2a's refusal. So the box verbs above ignored values the read path reads.
    const read = healthHh.runCli(box, ['tree', '--json'], { env: seam });
    expect([read.code, read.json?.['reason']], read.stderr).toEqual([2, 'headless-unarmed']);
    const inPane = healthHh.runCli(box, ['tree', '--json'], { env: { ...seam, ...pane } });
    expect([inPane.code, inPane.json?.['reason']]).toEqual([2, 'headless-in-pane']);
  }, 240_000);
});


// ── W2-2b Task 4 (W2-D43, W2-D46): a counted env call carries its arm; nothing before step 4 is counted ────────────
// recallLine (cli.mjs) is the single writer of `arm`: a RECALL_ARMS word on every counted env call, none on a tmux call,
// and no line at all for any other value. A counter line is written iff step 4 admitted the family, and none under
// history-off. The marker is written here in W2-D44's grammar by hand, never through formatHeadlessList: these cases
// test the counter, and a fixture built by the formatter under test could hide its defect.
describe('W2-D43 and W2-D46: the counter line on the env path carries its arm (W2-2b Task 4)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  const AL_T = 'e5e5e5e5-5555-4555-8555-555555555555';
  const AL_ID2 = 'acct-b-demo';
  const AL_T2 = 'f6f6f6f6-6666-4666-8666-666666666666';
  const OTHER_STORE = 'abababab-abab-4bab-8bab-abababababab';
  const NOT_STORED = 'c7c7c7c7-7777-4777-8777-777777777777';
  const ENV_KEYS = ['arm', 'cmd', 'ev', 'gen', 'id', 'ms', 'rc', 'ts', 'v'];
  const TMUX_KEYS = ['cmd', 'ev', 'gen', 'id', 'ms', 'rc', 'ts', 'v'];
  type Run = ReturnType<typeof healthHh.runCli>;
  type Line = Record<string, unknown>;
  const ans = (r: Run): unknown[] => [r.code, r.json?.['reason']];
  /** Every regular file under spool/, with its bytes: a refusal before step 4 must leave all of it as it was. */
  const spoolState = (box: HistoryBox): Array<[string, string]> => {
    const dir = hist(box, 'spool');
    return fs.readdirSync(dir).sort().filter((n) => fs.statSync(path.join(dir, n)).isFile())
      .map((n): [string, string] => [n, fs.readFileSync(path.join(dir, n), 'utf8')]);
  };
  const linesOf = (box: HistoryBox, id: string): Line[] => {
    const p = hist(box, 'spool', `${id}.jsonl`);
    return (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Line);
  };
  /** The lines `run` added to spool/<id>.jsonl. */
  const added = (box: HistoryBox, id: string, run: () => Run): { r: Run; lines: Line[] } => {
    const before = linesOf(box, id).length;
    const r = run();
    return { r, lines: linesOf(box, id).slice(before) };
  };
  const writeMarker = (box: HistoryBox, storeId: string, pairs: ReadonlyArray<readonly [string, string]>): void => {
    fs.writeFileSync(hist(box, 'headless-on'), `store ${storeId}\n${pairs.map(([i, g]) => `${i} ${g}\n`).join('')}`);
  };
  let seeded: { box: HistoryBox; asof: string; asofLegacy: string } | null = null;
  /** Two families, each one manual compaction: (ID, G1), and AL_ID2's legacy '' family (a gen-less line, no
   *  $REG/<id>.generation). Captured once for the describe; every case restores what it changes. */
  async function seededBox(): Promise<{ box: HistoryBox; asof: string; asofLegacy: string }> {
    if (seeded !== null) return seeded;
    const fx = await import('./historyFixtures.js');
    const box = makeHistoryBox('ccrc-hist-cli-zqarmline-', { role: 'fleet', shim: true });
    const a = fx.compactionSequence({ n: 1, trigger: 'manual', sessionId: AL_T, seed: 0xe5, tailRows: 0 });
    healthHh.seedFamily(box, { id: ID, project: 'demo', uuid: AL_T, generation: G1, rows: a.rows });
    const b = fx.compactionSequence({ n: 1, trigger: 'manual', sessionId: AL_T2, seed: 0xf6, tailRows: 0 });
    healthHh.seedFamily(box, { id: AL_ID2, project: 'demo', uuid: AL_T2, generation: null, rows: b.rows });
    seeded = { box, asof: a.boundaryUuids[0]!, asofLegacy: b.boundaryUuids[0]! };
    return seeded;
  }

  it('recallLine writes a RECALL_ARMS word or no line at all, and gen only as a UUID (W2-D43)', () => {
    // A child process: importing cli.mjs sets the importing process's umask, so no case imports it in this worker.
    const box = makeHistoryBox('ccrc-hist-cli-recallline-', { role: 'fleet', shim: false });
    const src = [
      `import { recallLine } from ${JSON.stringify(pathToFileURL(CLI).href)};`,
      `const base = { id: ${JSON.stringify(ID)}, cmd: 'tree', rc: 0, ms: 1, ts: 1759312800000 };`,
      `const g = ${JSON.stringify(G1)};`,
      'process.stdout.write(JSON.stringify({',
      '  tmux: recallLine({ ...base, gen: g }),',
      '  tmuxNull: recallLine({ ...base, gen: g, arm: null }),',
      "  control: recallLine({ ...base, gen: g, arm: 'control', rc: 8 }),",
      "  treatment: recallLine({ ...base, gen: g, arm: 'treatment' }),",
      "  legacy: recallLine({ ...base, gen: '', arm: 'treatment' }),",
      "  unknown: recallLine({ ...base, gen: g, arm: 'fixture' }),",
      "  empty: recallLine({ ...base, gen: g, arm: '' }),",
      '}));',
    ].join('\n');
    const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', src],
      { cwd: box.home, env: box.env, encoding: 'utf8', timeout: 60_000, killSignal: 'SIGTERM' });
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as Record<string, string | null>;
    const keys = (k: string): string[] => Object.keys(JSON.parse(out[k]!) as Line).sort();
    expect(keys('tmux'), 'a tmux call: today\'s line, no arm').toEqual(TMUX_KEYS);
    expect(out['tmuxNull'], 'null means no arm, exactly as absent does').toBe(out['tmux']);
    expect(keys('control'), 'W2-D43: the control arm is written').toEqual(ENV_KEYS);
    expect(JSON.parse(out['control']!)).toMatchObject({ id: ID, gen: G1, rc: 8, arm: 'control' });
    expect(JSON.parse(out['treatment']!)).toMatchObject({ id: ID, gen: G1, rc: 0, arm: 'treatment' });
    expect(keys('legacy'), 'a legacy family: the arm, and no gen (section 7)').toEqual(ENV_KEYS.filter((k) => k !== 'gen'));
    expect(out['unknown'], 'a word outside RECALL_ARMS: no line, never a line without its arm').toBeNull();
    expect(out['empty'], 'an empty arm is no word: no line').toBeNull();
  }, 120_000);

  it('the ladder: each refusal at steps 1 to 4 writes no counter line; each answer after the admission writes one, carrying its arm; the tmux CONTROL carries none', async () => {
    const { box, asof } = await seededBox();
    const sid = storeIdOf(box);
    const marker = hist(box, 'headless-on');
    const env = (o: Record<string, string> = {}): Record<string, string> =>
      ({ CCRC_RECALL_SESSION: ID, CCRC_RECALL_ARM: 'treatment', CCRC_RECALL_ASOF: asof, ...o });
    const tree = (o: Record<string, string> = {}, args: string[] = []): Run =>
      healthHh.runCli(box, ['tree', ...args, '--json'], { env: env(o) });
    fs.rmSync(marker, { force: true });
    const before = spoolState(box);
    const none = (r: Run, want: unknown[], what: string): void => {
      expect(ans(r), `${what}: ${r.stderr}${r.stdout}`).toEqual(want);
      expect(spoolState(box), `${what}: no counter line before step 4 admits the family (W2-D46)`).toEqual(before);
    };
    // Step 1, in W2-D46's order.
    none(tree(), [2, 'headless-unarmed'], 'step 1, no marker');
    fs.writeFileSync(marker, 'not a marker\n');
    none(tree(), [2, 'headless-malformed'], 'step 1, a malformed marker');
    writeMarker(box, sid, [[ID, G1]]);
    none(tree({ CCRC_RECALL_SESSION: '' }), [2, 'no-identity'], 'step 1, SESSION unset');
    none(tree({ CCRC_RECALL_SESSION: '..' }), [2, 'bad-id'], 'step 1, a bad id');
    writeMarker(box, sid, [[AL_ID2, '-']]);
    none(tree(), [2, 'headless-unlisted'], 'step 1, not on a list line');
    writeMarker(box, sid, [[ID, G1]]);
    none(tree({ CCRC_RECALL_ARM: 'bogus' }), [2, 'headless-arm-unknown'], 'step 1, ARM');
    none(tree({ CCRC_RECALL_ASOF: 'not-a-uuid' }), [2, 'asof-invalid'], 'step 1, the ASOF grammar');
    // Step 2: the harness, still read from $REG/<id>.harness on the env path (W2-D40's residual).
    const harness = path.join(box.reg, `${ID}.harness`);
    fs.writeFileSync(harness, 'codex');
    try { none(tree(), [2, 'harness-unsupported'], 'step 2, the harness'); } finally { fs.rmSync(harness); }
    // Step 3: the store table.
    const storeIdFile = hist(box, 'store.id');
    const savedStoreId = fs.readFileSync(storeIdFile);
    fs.writeFileSync(storeIdFile, `${OTHER_STORE}\n`);
    try { none(tree(), [5, 'store-mismatch'], 'step 3, the store table'); } finally { fs.writeFileSync(storeIdFile, savedStoreId); }
    // Step 3, faulted: the table's own store-id read, then the read-only open, then decideStatusRead. Each refuses
    // before the admission.
    const faults = (o: Record<string, string>): Run =>
      healthHh.runCli(box, ['tree', '--json'], { preloads: [PRELOADS.faults], env: env(o) });
    // The faults preload counts reader opens: n=1 is measureReach's own (measureStoreFacts' peekStoreId), which §8.3's
    // table reads as an unreadable meta store_id; n=2 is readContextEnv's openReader, the CLI's read-only open.
    none(faults({ HISTORY_TEST_FAIL_QUERY_ONLY: '1' }), [5, 'store-unmeasured'], 'step 3, the table: the store id unreadable');
    none(faults({ HISTORY_TEST_FAIL_QUERY_ONLY: '2' }), [5, 'store-read-failed'], 'step 3, the read-only open');
    const userVersionOf = (): number => {
      const w = new DatabaseSync(dbFile(box));
      try { return Number((w.prepare('PRAGMA user_version').get() as { user_version: number }).user_version); } finally { w.close(); }
    };
    const setUserVersion = (n: number): void => {
      const w = new DatabaseSync(dbFile(box));
      try { w.exec(`PRAGMA user_version = ${n}`); } finally { w.close(); }
    };
    const savedVersion = userVersionOf();
    expect(savedVersion, 'CONTROL: the store has a version to restore').toBeGreaterThan(0);
    setUserVersion(0);
    try { none(tree(), [5, 'store-schema-missing'], 'step 3, decideStatusRead'); } finally { setUserVersion(savedVersion); }
    // Step 4: the family from ASOF; a defect and a failed read of its rows, before the admission (a fault planted on
    // asOfFamilySql's own text); then the store line. None admits, so none is counted: the defect leaves bare, rc 1.
    none(tree({ CCRC_RECALL_ASOF: NOT_STORED }), [2, 'asof-invalid'], 'step 4, an ASOF the store does not hold');
    const d4 = faults({ HISTORY_TEST_THROW_PREPARE: 'TypeError@AS into_merged_into' });
    expect(d4.stderr, 'CONTROL: it is the defect arm').toContain('ccrc history: internal error: ');
    none(d4, [1, undefined], 'step 4, a defect before the admission');
    none(faults({ HISTORY_TEST_THROW_PREPARE: 'SqliteError:zqarmline-planted@AS into_merged_into' }), [5, 'store-read-failed'],
      'step 4, a failed read before the admission');
    writeMarker(box, OTHER_STORE, [[ID, G1]]);
    none(tree(), [2, 'headless-unlisted'], 'step 4, another store\'s marker');
    writeMarker(box, sid, [[ID, G1]]);
    // CONTROL, one step later: step 5 (recall-off naming the resolved generation) is after the admission: one line, with
    // the arm and the resolved generation.
    fs.mkdirSync(hist(box, 'recall-off'), { recursive: true });
    fs.writeFileSync(hist(box, 'recall-off', ID), `${G1}\n`);
    const s5 = ((): { r: Run; lines: Line[] } => {
      try { return added(box, ID, () => tree()); } finally { fs.rmSync(hist(box, 'recall-off', ID)); }
    })();
    expect(ans(s5.r), `step 5: ${s5.r.stderr}`).toEqual([8, undefined]);
    expect(s5.lines, 'step 5: exactly one counter line').toHaveLength(1);
    expect(Object.keys(s5.lines[0]!).sort()).toEqual(ENV_KEYS);
    expect(s5.lines[0]).toMatchObject({ v: 1, ev: 'recall', id: ID, gen: G1, cmd: 'tree', rc: 8, arm: 'treatment' });
    // Step 6: ARM=control is exit 8, counted, with its own arm (W2-D42).
    const s6 = added(box, ID, () => tree({ CCRC_RECALL_ARM: 'control' }));
    expect(ans(s6.r), `step 6: ${s6.r.stderr}`).toEqual([8, undefined]);
    expect(s6.lines.map((l) => [l['rc'], l['arm'], l['gen']])).toEqual([[8, 'control', G1]]);
    // Step 7: the verb's own answer, and a scope refusal after the admission, each counted with the arm.
    const s7 = added(box, ID, () => tree());
    expect(ans(s7.r), `step 7: ${s7.r.stderr}`).toEqual([0, undefined]);
    expect(s7.lines.map((l) => [l['rc'], l['arm'], l['gen']])).toEqual([[0, 'treatment', G1]]);
    const s7b = added(box, ID, () => tree({}, ['--session', '..']));
    expect(ans(s7b.r), `step 7, scope: ${s7b.r.stderr}`).toEqual([2, 'bad-id']);
    expect(s7b.lines.map((l) => [l['rc'], l['arm']]), 'a refusal after the admission is counted').toEqual([[2, 'treatment']]);
    // CONTROL: the same family from its pane, no seam: counted, with no arm. Then an empty ARM in the pane: empty is
    // unset (W2-D45), so it is no seam, and the tmux path still writes its line with no arm.
    const pane = healthHh.withPane(box, ID);
    const t = added(box, ID, () => healthHh.runCli(box, ['tree', '--json'], { env: pane }));
    expect(ans(t.r), `tmux: ${t.r.stderr}`).toEqual([0, undefined]);
    expect(t.lines.map((l) => Object.keys(l).sort()), 'W2-D43: never an arm on a tmux call').toEqual([TMUX_KEYS]);
    const te = added(box, ID, () => healthHh.runCli(box, ['tree', '--json'], { env: { ...pane, CCRC_RECALL_ARM: '' } }));
    expect(ans(te.r), `tmux, empty ARM: ${te.r.stderr}`).toEqual([0, undefined]);
    expect(te.lines.map((l) => Object.keys(l).sort()), 'an empty ARM in a pane: counted, no arm').toEqual([TMUX_KEYS]);
  }, 240_000);

  it('a defect after the admission is counted rc 1 with its arm, and a legacy family\'s arm line carries no gen (W2-D43; section 7)', async () => {
    const { box, asof, asofLegacy } = await seededBox();
    writeMarker(box, storeIdOf(box), [[ID, G1], [AL_ID2, '-']]);
    // pairIndexOf, the last read of readContext (step 7), is the one statement over redact_hashes: the throw comes after
    // the admission, inside readContext, so it leaves as a ReadDefect.
    const d = added(box, ID, () => healthHh.runCli(box, ['tree', '--json'], {
      preloads: [PRELOADS.faults],
      env: { CCRC_RECALL_SESSION: ID, CCRC_RECALL_ARM: 'treatment', CCRC_RECALL_ASOF: asof, HISTORY_TEST_THROW_PREPARE: 'TypeError@FROM redact_hashes' },
    }));
    expect(d.r.code, d.r.stderr).toBe(1);
    expect(d.r.stderr, 'CONTROL: it is the defect arm').toContain('ccrc history: internal error: ');
    expect(d.lines, 'the defect: exactly one counter line').toHaveLength(1);
    expect(d.lines[0]).toMatchObject({ ev: 'recall', id: ID, gen: G1, cmd: 'tree', rc: 1, arm: 'treatment' });
    // The legacy family: the resolved generation is '' (W2-D40), so the line carries the arm and no gen.
    const l = added(box, AL_ID2, () => healthHh.runCli(box, ['tree', '--json'],
      { env: { CCRC_RECALL_SESSION: AL_ID2, CCRC_RECALL_ARM: 'treatment', CCRC_RECALL_ASOF: asofLegacy } }));
    expect(ans(l.r), `legacy: ${l.r.stderr}${l.r.stdout}`).toEqual([0, undefined]);
    expect(l.lines.map((x) => Object.keys(x).sort())).toEqual([ENV_KEYS.filter((k) => k !== 'gen')]);
    expect(l.lines[0]).toMatchObject({ id: AL_ID2, rc: 0, arm: 'treatment' });
  }, 240_000);

  it('a store read failure after the admission is exit 5 and counted with its arm; CONTROL: the same fault before the admission is not counted (W2-D46; review 829 F1)', async () => {
    const { box, asof } = await seededBox();
    // The same statement fault as the case above, but SQLite's own error: pairIndexOf's read of redact_hashes (step 7) throws
    // after the admission, inside readContext, so it leaves through readFailure as ONE exit-5 answer, and the line carries
    // the family the admission found (a readFailure with no id or generation would write none).
    const env = {
      CCRC_RECALL_SESSION: ID, CCRC_RECALL_ARM: 'treatment', CCRC_RECALL_ASOF: asof,
      HISTORY_TEST_THROW_PREPARE: 'SqliteError:fixture-planted-read-fault@FROM redact_hashes',
    };
    const run = (): { r: Run; lines: Line[] } => added(box, ID, () => healthHh.runCli(box, ['tree', '--json'], { preloads: [PRELOADS.faults], env }));
    // CONTROL: the marker does not list (ID, G1), so step 4 refuses before the statement is ever prepared: the fault does
    // not fire, and nothing is counted. It is what shows the fault below lands after the admission.
    writeMarker(box, storeIdOf(box), [[AL_ID2, '-']]);
    const pre = run();
    expect(ans(pre.r), `before the admission: ${pre.r.stderr}`).toEqual([2, 'headless-unlisted']);
    expect(pre.lines, 'CONTROL: step 4 refused, so no counter line').toEqual([]);
    writeMarker(box, storeIdOf(box), [[ID, G1], [AL_ID2, '-']]);
    const post = run();
    expect(ans(post.r), `after the admission: ${post.r.stderr}`).toEqual([5, 'store-read-failed']);
    expect(post.lines, 'a read failure after the admission: exactly one counter line').toHaveLength(1);
    expect(Object.keys(post.lines[0]!).sort()).toEqual(ENV_KEYS);
    expect(post.lines[0]).toMatchObject({ ev: 'recall', id: ID, gen: G1, cmd: 'tree', rc: 5, arm: 'treatment' });
  }, 240_000);

  it('under history-off nothing is written on the env path either; CONTROL: without the switch the same call writes its line', async () => {
    const { box, asof } = await seededBox();
    writeMarker(box, storeIdOf(box), [[ID, G1]]);
    const env = { CCRC_RECALL_SESSION: ID, CCRC_RECALL_ARM: 'treatment', CCRC_RECALL_ASOF: asof };
    const off = path.join(box.home, '.ccrc', 'history-off');
    const before = spoolState(box);
    fs.writeFileSync(off, '');
    try {
      const r = healthHh.runCli(box, ['tree', '--json'], { env });
      expect(ans(r), `the CLI still reads under the switch: ${r.stderr}`).toEqual([0, undefined]);
      expect(spoolState(box), 'and writes no line (W2-D46)').toEqual(before);
    } finally {
      fs.rmSync(off);
    }
    const c = added(box, ID, () => healthHh.runCli(box, ['tree', '--json'], { env }));
    expect(ans(c.r), c.r.stderr).toEqual([0, undefined]);
    expect(c.lines.map((l) => [l['rc'], l['arm']]), 'CONTROL: the switch removed, the line is written').toEqual([[0, 'treatment']]);
  }, 240_000);
});

// ── W2-2b Task 4: the C-R pin (W2-D43, W2-D13) ──────────────────────────────────────────────────────────────────────
// A treatment-arm run on a listed family that is also a live A/B family writes a non-null arm, and W2-3's window does not
// count it. The window is W2-3's merged pipeline, run as W2-1's RP8 runs it: measure-history.py's raw rows (its `calls`
// select `arm IS NULL`, W2-D13), then history-gate.mjs's buildWindows, windowTotals and splitAtFirstExit8. Both run
// read-only: the script is spawned isolated (-I) and bytecode-free (-B), and the gate is imported dynamically.
describe('C-R: a treatment-arm run on a live A/B family writes a non-null arm, and the window does not count it (W2-2b Task 4)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  const CR_T = 'a7a7a7a7-7777-4777-8777-a7a7a7a7a7a7';
  const CR_MEASURE = path.join(REPO, 'deploy', 'measure-history.py');
  type CrCall = [ts_ms: number, rc: number, verb: string];
  interface CrBoundary { boundary_uuid: string; ts_ms: number; copies: unknown[] }
  interface CrFamily { ccrc_id: string; generation: string; found: boolean; merged_generations: string[]; calls: CrCall[]; boundaries: CrBoundary[] }
  interface CrWindow { state: 'measured' | 'unmeasured'; start_ms: number; end_ms: number | null; end_inclusive: boolean; turns: number; calls: number; with_call: boolean }
  interface CrGate {
    ROW_CAP: number;
    buildWindows(family: CrFamily, k?: number): CrWindow[];
    windowOf(boundary: CrBoundary, calls: CrCall[], k?: number): CrWindow;
    windowTotals(windows: CrWindow[]): { windows: number; with_call: number; calls: number; turns: number; unmeasured: number };
    splitAtFirstExit8(calls: CrCall[]): { upTo: CrCall[]; after: CrCall[] };
  }

  it('C-R: the live call alone is in the measure\'s calls, the window and the first-exit-8 split; CONTROL: with the arm filter dropped, all three are', async () => {
    const fx = await import('./historyFixtures.js');
    const gate = (await import('../../deploy/history-gate.mjs')) as unknown as CrGate;
    const box = makeHistoryBox('ccrc-hist-cli-zqarmline-cr-', { role: 'fleet', shim: true });
    // One manual compaction, then two assistant turns, the second stamped a day past now: fewer than K turns and no next
    // boundary, so the boundary's window ends inclusive at that row and spans every call this case makes (W2-D14).
    const late = Date.now() + 86_400_000;
    const seq = fx.compactionSequence({ n: 1, trigger: 'manual', sessionId: CR_T, seed: 0xa7, tailRows: 0 });
    const rows = [
      ...seq.rows,
      fx.assistantRow({ uuid: 'a7a7a7a7-0000-4000-8000-0000000000f1', ts: '2026-10-01T11:00:00.000Z', sessionId: CR_T,
        text: 'Fixture answer after the summary.', requestId: 'req_cr_1', msgId: 'msg_cr_1' }),
      fx.assistantRow({ uuid: 'a7a7a7a7-0000-4000-8000-0000000000f2', ts: new Date(late).toISOString(), sessionId: CR_T,
        text: 'Fixture answer, stamped late.', requestId: 'req_cr_2', msgId: 'msg_cr_2' }),
    ];
    healthHh.seedFamily(box, { id: ID, project: 'demo', uuid: CR_T, generation: G1, rows });
    const sid = storeIdOf(box);
    // The quiz family is listed (W2-D44's grammar, by hand), and it is a live A/B family on the treatment side: no
    // recall-off file.
    fs.writeFileSync(hist(box, 'headless-on'), `store ${sid}\n${ID} ${G1}\n`);
    const seam = { CCRC_RECALL_SESSION: ID, CCRC_RECALL_ASOF: seq.boundaryUuids[0]! };
    const live = healthHh.runCli(box, ['tree', '--json'], { env: healthHh.withPane(box, ID) });
    expect([live.code, live.json?.['reason']], `the live call: ${live.stderr}`).toEqual([0, undefined]);
    const treat = healthHh.runCli(box, ['tree', '--json'], { env: { ...seam, CCRC_RECALL_ARM: 'treatment' } });
    expect([treat.code, treat.json?.['reason']], `the treatment arm: ${treat.stderr}${treat.stdout}`).toEqual([0, undefined]);
    const ctrl = healthHh.runCli(box, ['tree', '--json'], { env: { ...seam, CCRC_RECALL_ARM: 'control' } });
    expect([ctrl.code, ctrl.json?.['reason']], `the control arm: ${ctrl.stderr}`).toEqual([8, undefined]);
    for (let i = 0; i < 2; i += 1) expect(runSweep(box).code).toBe(0);   // tick N renames the lines, tick N+1 drains them

    // C-R: the rows hold each call's arm, a non-null one for each eval call.
    const got = ((): Array<{ ts_ms: number; rc: number; verb: string; arm: string | null }> => {
      const db = healthHh.openStoreRO(box);
      try {
        return db.prepare('SELECT ts_ms, rc, verb, arm FROM recall_calls WHERE ccrc_id = ? ORDER BY ts_ms, event_key').all(ID) as
          Array<{ ts_ms: number; rc: number; verb: string; arm: string | null }>;
      } finally {
        db.close();
      }
    })();
    expect(got.map((g) => [Number(g.rc), g.arm]), 'C-R: the live call has no arm, each eval call its own').toEqual([[0, null], [0, 'treatment'], [8, 'control']]);
    const all = got.map((g): CrCall => [Number(g.ts_ms), Number(g.rc), g.verb]);

    // W2-3's window over the listed family.
    const families = path.join(box.home, 'cr-families.json');
    fs.writeFileSync(families, JSON.stringify([{ store_id: sid, ccrc_id: ID, generation: G1 }]));
    const m = spawnSync('python3', ['-I', '-B', CR_MEASURE, '--db', hist(box, 'db', 'history.db'), '--families', families,
      '--window-start', String(Date.parse('2026-10-01T00:00:00.000Z')), '--window-end', String(late + 1), '--row-cap', String(gate.ROW_CAP)],
    { encoding: 'utf8', env: { ...box.env, PYTHONDONTWRITEBYTECODE: '1' }, timeout: 60_000 });
    expect(m.status, m.stderr).toBe(0);
    const fams = (JSON.parse(m.stdout) as { w2: { families: CrFamily[] } }).w2.families;
    expect(fams.map((f) => [f.ccrc_id, f.generation, f.found])).toEqual([[ID, G1, true]]);
    const fam = fams[0]!;
    expect(fam.calls.map((c) => [c[1], c[2]]), 'C-R: the measure\'s calls hold the live call alone').toEqual([[0, 'tree']]);
    const windows = gate.buildWindows(fam);
    expect(windows.map((w) => w.state), 'one measured window').toEqual(['measured']);
    const w = windows[0]!;
    for (const c of all) expect(w.start_ms <= c[0] && c[0] <= w.end_ms!, `CONTROL: the window spans the call at ${c[0]}`).toBe(true);
    expect(gate.windowTotals(windows).calls, 'C-R: the window counts the live call alone').toBe(1);
    expect(gate.splitAtFirstExit8(fam.calls), 'the control arm\'s exit 8 is no live first exit 8').toEqual({ upTo: fam.calls, after: [] });
    // CONTROL: the same window over every row of the family, the arm filter dropped, counts all three, and the split
    // finds the control arm's exit 8. So only the arm keeps the eval calls out.
    expect(gate.windowOf(fam.boundaries[0]!, all).calls, 'CONTROL: no arm filter').toBe(3);
    expect(gate.splitAtFirstExit8(all).upTo.at(-1)?.[1], 'CONTROL: the unfiltered split stops at the control arm\'s exit 8').toBe(8);
  }, 240_000);
});

// ── W2-2b Task 5 (W2-D44, W2-D45, W2-D46, W2-D47, W2-D48): README states the headless seam ────────────────────────────
// The operator-facing account of the seam, held to lib: every exit-2 word the seam answers (each `headless-*` REASONS
// word, derived, plus `asof-invalid`) is named, and step 1's words come in W2-D46's order; the marker's path is SWITCHES';
// its two bounds are HEADLESS_LIST_MAX_BYTES (in KiB) and HEADLESS_LIST_MAX_PAIRS; the arm words are RECALL_ARMS'. A word,
// a bound or a path that moves in lib reds here until README follows. Pure: it reads README and imports lib, nothing else.
describe('README states the headless seam: its variables, the marker, the refusal words in their order (W2-2b Task 5)', () => {
  const SEAM = '**The headless seam';
  /** The Session history section: its heading to the next `---` rule. */
  const section = (): string => {
    const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
    const from = readme.indexOf('### Session history: lossless recall');
    expect(from, 'README has no Session history section').toBeGreaterThan(-1);
    const to = readme.indexOf('\n---\n', from);
    expect(to, 'the Session history section has no end').toBeGreaterThan(from);
    return readme.slice(from, to);
  };
  /** The seam paragraph, whitespace (line breaks included) collapsed to single spaces. */
  const paragraph = (): string => {
    const s = section();
    const at = s.indexOf(SEAM);
    expect(at, 'the Session history section has no headless seam paragraph').toBeGreaterThan(-1);
    expect(s.split(SEAM).length - 1, 'the seam paragraph is written more than once').toBe(1);
    const end = s.indexOf('\n\n', at);
    return (end < 0 ? s.slice(at) : s.slice(at, end)).replace(/\s+/g, ' ');
  };

  it('names the three variables, the driver as their one caller, empty as unset, and the verbs that ignore them', () => {
    const p = paragraph();
    for (const n of ['CCRC_RECALL_SESSION', 'CCRC_RECALL_ARM', 'CCRC_RECALL_ASOF']) expect(p, `README does not name ${n}`).toContain(`\`${n}\``);
    expect(p).toContain('`deploy/history-replay.mjs`');
    expect(p).toContain('Nothing else is meant to set them');
    expect(p).toContain('A variable counts as set only when it is non-empty');
    expect(p).toContain('`status`, `doctor` and the operator verbs ignore all three');
  });

  it('states the marker from lib: its path, its grammar, both bounds and the arm words', async () => {
    const { SWITCHES, HEADLESS_LIST_MAX_BYTES, HEADLESS_LIST_MAX_PAIRS, RECALL_ARMS } = await import('../../ccd/history/lib.mjs');
    const p = paragraph();
    expect(p).toContain(`\`~/${SWITCHES.headlessOn}\``);
    expect(p).toContain('`store <store_id>`');
    expect(p).toContain('`<ccrc_id> <generation>`');
    expect(HEADLESS_LIST_MAX_BYTES % 1024, 'CONTROL: the byte bound is a whole number of KiB').toBe(0);
    expect(p).toContain(`more than ${HEADLESS_LIST_MAX_BYTES / 1024} KiB`);
    expect(p).toContain(`more than ${HEADLESS_LIST_MAX_PAIRS.toLocaleString('en-US')} families`);
    for (const a of RECALL_ARMS) expect(p, `README does not name the arm ${a}`).toContain(`\`${a}\``);
  });

  it('names every exit-2 word of the seam, each a REASONS word of exit 2, with step 1 in W2-D46 order', async () => {
    const { REASONS, EXIT } = await import('../../ccd/history/lib.mjs');
    const p = paragraph();
    const words = [...Object.keys(REASONS).filter((w) => w.startsWith('headless-')), 'asof-invalid'];
    expect(words, 'CONTROL: the derivation sees the seam words').toEqual(expect.arrayContaining([
      'headless-unarmed', 'headless-in-pane', 'headless-unlisted', 'headless-malformed', 'headless-arm-unknown', 'asof-invalid']));
    for (const w of words) {
      expect(REASONS[w], `${w} is not an exit-2 word`).toBe(EXIT.REFUSED);
      expect(p, `README does not name ${w}`).toContain(`\`${w}\``);
    }
    const ORDER = ['headless-in-pane', 'headless-unarmed', 'headless-malformed', 'no-identity', 'bad-id',
      'headless-unlisted', 'headless-arm-unknown', 'asof-invalid'];
    const at = ORDER.map((w) => p.indexOf(`\`${w}\``));
    expect(ORDER.filter((_, k) => at[k]! < 0), 'a step-1 word is missing').toEqual([]);
    expect([...at].sort((a, b) => a - b), 'README states step 1 out of W2-D46 order').toEqual(at);
    expect(p).toContain('exit 2');
    expect(p).toContain('exit 8');
  });
});
