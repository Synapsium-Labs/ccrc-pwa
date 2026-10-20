// `deploy/measure-history.py` (spec 2026-10-05 §10.2, §10.7): the read-only census W1's acceptance rows and the
// W2 gate read. Its queries are pinned against a REAL store — made by `store.mjs`'s own `createStore`, so a
// schema change the instrument has not followed reds here — holding planted rows whose answers are worked out
// by hand below (O52), and once against rows the sweep itself drains (O52's event-table half). O32: the
// instrument never classifies a model; `backendOf` in `ccd/history/lib.mjs` is the one rule.
import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { mkTmp } from './tmpHelpers.js';
import { createStore } from '../../ccd/history/store.mjs';
import { SCHEMA_VERSION } from '../../ccd/history/lib.mjs';
import { makeHistoryBox, runSweep, spoolLine, plantSession, openStoreRO, scrubbedEnv } from './historyHelpers.js';
import * as gateT8 from '../../deploy/history-gate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'deploy', 'measure-history.py');
/** Isolated (-I: no user site, no PYTHON* env, no script dir on sys.path) AND bytecode-free (-B): -I ignores PYTHONDONTWRITEBYTECODE, so only -B keeps a loaded instrument from writing deploy/__pycache__ (review 316 F25). */
const PY_ISOLATED = ['-I', '-B'] as const;

/** W2-3 Task 1 (W2-D13): the raw rows measure-history.py prints; deploy/history-gate.mjs builds every window from them. */
type RawRow = [line: number, ts_ms: number | null, msg_id: string | null, request_id: string | null, uuid: string, model: string | null];
type CallRow = [ts_ms: number, rc: number, verb: string];
interface Copy {
  file_id: number; source_key: string; boundary_line: number; after_count: number; summary_line: number | null;
  next_boundary_line: number | null; next_boundary_ts_ms: number | null; last_ts_ms: number | null;
  rows: RawRow[]; models: Array<string | null>; truncated: boolean;
}
interface BoundaryReport { boundary_uuid: string; ts_ms: number; copies: Copy[] }
interface FamilyReport {
  ccrc_id: string; generation: string; found: boolean; merged_generations: string[]; calls: CallRow[]; boundaries: BoundaryReport[];
}
interface W2 { row_cap: number; window_start_ms: number; window_end_ms: number; families: FamilyReport[] }
interface Report {
  store_id: string | null; user_version: number; script_sha256: string; counters: Record<string, number>; w1b_lag_p95_ms: number | null;
  w1c_duplicate_entries: number; w1f_grep_p95_ms: number | null; w2: W2 | null;
}

const measure = (args: string[]): { code: number | null; stdout: string; stderr: string } => {
  const r = spawnSync('python3', [SCRIPT, ...args],
    { encoding: 'utf8', env: { ...scrubbedEnv(process.env), PYTHONDONTWRITEBYTECODE: '1' }, timeout: 60_000 });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};
const report = (args: string[]): Report => {
  const r = measure(args);
  expect(r.code, r.stderr).toBe(0);
  return JSON.parse(r.stdout) as Report;
};

const NOW = 1_790_000_000_000;
const G1 = '0189abcd-1234-5678-9abc-0123456789ab';
const G2 = '0189abcd-1234-5678-9abc-0123456789ac';
const U1 = '11111111-2222-4333-8444-555555555555';
const U2 = '11111111-2222-4333-8444-666666666666';
const OTHER_STORE = '00000000-0000-4000-8000-000000000001';

interface Planted { home: string; db: string; storeId: string; families: string; b1: string; b2: string }

/** A store `createStore` made, holding rows whose answers are worked out by hand in the cases below. */
function plantedStore(): Planted {
  const home = mkTmp('ccrc-measure-history-');
  const { storeId } = createStore(home);
  const dbPath = path.join(home, '.ccrc', 'history', 'db', 'history.db');
  const db = new DatabaseSync(dbPath);
  let b1 = '';
  let b2 = '';
  try {
    for (const t of ['counters', 'ticks', 'recall_calls']) db.exec(`DELETE FROM ${t}`);
    const ins = (sql: string, ...p: Array<string | number | null | Uint8Array>): number => Number(db.prepare(sql).run(...p).lastInsertRowid);
    const blob = ins("INSERT INTO blobs (sha256, codec, z, raw_len) VALUES (?, 'br5', NULL, 0)",
      createHash('sha256').update('measure-history fixture').digest());
    const family = (id: string, gen: string, merged: number | null = null): number =>
      ins('INSERT INTO sessions (ccrc_id, generation, project, first_seen_ms, merged_into) VALUES (?, ?, ?, ?, ?)', id, gen, 'demo', 1, merged);
    const epoch = (pk: number, uuid: string): void => {
      ins("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, confirmed_ms) VALUES (?, 1, ?, 'startup', 'hook', 1)", pk, uuid);
    };
    const transcript = (uuid: string, agent = ''): number =>
      ins('INSERT INTO transcripts (cc_session_uuid, agent_id) VALUES (?, ?)', uuid, agent);
    let ino = 100;
    const file = (tpk: number): number =>
      ins("INSERT INTO ingest_files (dev, ino, transcript_pk, status, parser_version) VALUES (1, ?, ?, 'live', 1)", ino++, tpk);
    let n = 0;
    const put = (fid: number, tpk: number, line: number, type: string, ts: number | null, summary = 0): number => {
      n += 1;
      const eid = ins('INSERT INTO entries (uuid, transcript_pk, type, ts_ms, is_compact_summary, provenance, prov_version, '
        + "struct_rank_ns, struct_file_id, blob_id) VALUES (?, ?, ?, ?, ?, 'harness', 1, 1, 1, ?)", `e-${n}`, tpk, type, ts, summary, blob);
      ins('INSERT INTO memberships (file_id, entry_id, line) VALUES (?, ?, ?)', fid, eid, line);
      return eid;
    };
    const boundary = (eid: number, tpk: number, ord: number): void => {
      ins('INSERT INTO boundaries (entry_id, transcript_pk, ord) VALUES (?, ?, ?)', eid, tpk, ord);
    };

    // demo-a / G1: one main transcript, three boundaries in one copy; the '' family a re-key merged into it.
    const a = family('demo-a', G1);
    family('demo-a', '', a);
    epoch(a, U1);
    const t1 = transcript(U1);
    // The shorter copy (planted below) takes the LOWER file_id, as a real swap usually leaves it, so a copy query
    // that broke the `after` tie by file_id alone would read it: the longest-copy rule, not id order, picks f1.
    const f2 = file(t1);
    const f1 = file(t1);
    put(f1, t1, 1, 'user', 1000);
    put(f1, t1, 2, 'assistant', 1100);
    const eb1 = put(f1, t1, 3, 'system', 2000); boundary(eb1, t1, 1); b1 = `e-${n}`;
    const es1 = put(f1, t1, 4, 'user', 2001, 1);
    for (let k = 0; k < 12; k += 1) put(f1, t1, 5 + k, 'assistant', 3000 + 100 * k);   // lines 5..16: the 10th is 3900
    const eb2 = put(f1, t1, 17, 'system', 5000); boundary(eb2, t1, 2); b2 = `e-${n}`;
    put(f1, t1, 18, 'user', 5001, 1);
    put(f1, t1, 19, 'assistant', 5100);
    put(f1, t1, 20, 'assistant', 5200);
    put(f1, t1, 21, 'assistant', 5300);
    put(f1, t1, 22, 'user', 5400);
    const eb3 = put(f1, t1, 23, 'system', 7000); boundary(eb3, t1, 3);              // after --window-end: no window
    put(f1, t1, 24, 'user', 7001, 1);
    put(f1, t1, 25, 'assistant', 7100);                                               // B2's 4th turn, and the copy's last row
    // A second home's copy of the same transcript, holding B1 with one row after it: the shorter copy is not read.
    ins('INSERT INTO memberships (file_id, entry_id, line) VALUES (?, ?, 1), (?, ?, 2)', f2, eb1, f2, es1);
    // A subagent transcript of the same session: its boundary is not a MAIN boundary.
    const ta = transcript(U1, 'agent-1');
    const fa = file(ta);
    const eba = put(fa, ta, 1, 'system', 2500); boundary(eba, ta, 1);
    put(fa, ta, 2, 'user', 2501, 1);
    put(fa, ta, 3, 'assistant', 2600);
    // demo-b / G2: a family the families file lists under ANOTHER store's id.
    const b = family('demo-b', G2);
    epoch(b, U2);
    const t2 = transcript(U2);
    const f4 = file(t2);
    const ebb = put(f4, t2, 1, 'system', 3000); boundary(ebb, t2, 1);
    put(f4, t2, 2, 'user', 3001, 1);
    put(f4, t2, 3, 'assistant', 3100);

    const call = (key: string, id: string, gen: string, ts: number, verb: string, ms: number, arm: string | null): void => {
      ins('INSERT INTO recall_calls (event_key, ccrc_id, generation, ts_ms, verb, rc, ms, arm) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
        key, id, gen, ts, verb, ms, arm);
    };
    call('k1', 'demo-a', G1, 2500, 'expand', 40, null);    // B1's window
    call('k2', 'demo-a', G1, 3900, 'describe', 40, null);  // B1's window, at its inclusive end
    call('k3', 'demo-a', G1, 3950, 'expand', 40, null);    // after B1's end, before B2
    call('k4', 'demo-a', G1, 1999, 'expand', 40, null);    // before B1
    call('k5', 'demo-a', G1, 2600, 'expand', 40, 'quiz');  // inside B1's window, but a replay arm's
    call('k6', 'demo-a', '', 5200, 'expand', 40, null);    // the merged '' family: B2's window
    call('k7', 'demo-b', G2, 3500, 'expand', 40, null);    // another store's family
    for (let i = 1; i <= 21; i += 1) call(`g${i}`, 'demo-c', G1, 100_000 + i, 'grep', 100 * i, null);   // W1-f's sample
    call('gq', 'demo-c', G1, 100_100, 'grep', 77_777, 'quiz');   // a replay arm's grep: not W1-f's
    call('ge', 'demo-c', G1, 100_200, 'expand', 99_999, null);   // not a grep

    const tick = (ts: number, lag: number | null, behind: number): void => {
      ins('INSERT INTO ticks (ts_ms, lag_ms, bytes, files_behind, bytes_behind) VALUES (?, ?, 0, ?, 0)', ts, lag, behind);
    };
    for (let i = 1; i <= 21; i += 1) tick(NOW - 3_600_000 * i, 1000 * i, 0);   // W1-b's sample
    tick(NOW - 1000, 999_000, 2);                 // behind: catch-up, not W1-b's
    tick(NOW - 2000, null, 0);                    // unmeasured: e.g. its new rows were all first reads
    tick(NOW - 8 * 86_400_000, 888_000, 0);       // older than the week

    for (const [k, v] of [['raw_only', 3], ['variants_sanitize:anthropic', 2], ['variants_sanitize:other', 1]] as const) {
      ins('INSERT INTO counters (name, n) VALUES (?, ?)', k, v);
    }
  } finally {
    db.close();
  }
  const families = path.join(home, 'families.json');
  writeFileSync(families, JSON.stringify([
    { store_id: storeId, ccrc_id: 'demo-a', generation: G1 },
    { store_id: OTHER_STORE, ccrc_id: 'demo-b', generation: G2 },
  ]));
  return { home, db: dbPath, storeId, families, b1, b2 };
}

describe('measure-history.py: one backend rule (O32)', () => {
  const BANNED: ReadonlyArray<readonly [string, RegExp]> = [
    ['a model-name test', /claude/i], ['a prefix comparison', /startswith/i], ['the synthetic-row marker', /<synthetic>/i],
  ];
  it('CONTROL: each pattern finds the test it bans', () => {
    const sample = "if (m or '').startswith('claude') and m != '<synthetic>':";
    for (const [, re] of BANNED) expect(re.test(sample)).toBe(true);
  });
  it('the instrument classifies no model: it reads <counter>:<backend> rows the sweep folded through backendOf', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    for (const [why, re] of BANNED) expect(re.test(src), `measure-history.py carries ${why}`).toBe(false);
    expect(src).toContain('SELECT name, n FROM counters');
  });
});

describe('measure-history.py: the named queries over planted rows (O52)', () => {
  it('W1-b, W1-c and W1-f by nearest rank, and the counters exactly as the sweep folded them', () => {
    const f = plantedStore();
    const rep = report(['--db', f.db, '--now', String(NOW)]);
    expect(Object.keys(rep)[0], 'the report is not headed by its store id').toBe('store_id');
    expect(rep.store_id).toBe(f.storeId);
    expect(rep.user_version, 'the planted store is made by createStore, so it is at the code\'s schema version').toBe(SCHEMA_VERSION);
    expect(rep.counters).toEqual({ raw_only: 3, 'variants_sanitize:anthropic': 2, 'variants_sanitize:other': 1 });
    expect(rep.w1b_lag_p95_ms).toBe(20_000);   // 21 lags 1000..21000 with files_behind 0 in the week: rank ceil(0.95 * 21) = 20
    expect(rep.w1c_duplicate_entries).toBe(0);
    expect(rep.w1f_grep_p95_ms).toBe(2000);    // 21 greps 100..2100 with no arm: rank 20
    expect(rep.w2).toBeNull();
  });

  it('the W2 raw rows: demo-a\'s calls and its two main boundaries, copy by copy and row by row (W2-D13)', () => {
    const f = plantedStore();
    const rep = report(['--db', f.db, '--now', String(NOW), '--families', f.families, '--window-start', '1500', '--window-end', '6000', '--row-cap', '400']);
    // Worked by hand from plantedStore. f1's rows are planted first, so its line L is entry e-L (b1 = e-3, b2 = e-17).
    // calls: demo-a's rows of G1 and of the merged '' family with no arm, at or after 1500, by ts_ms: k4 1999, k1 2500,
    //   k2 3900, k3 3950, k6 5200 (gen ''). k5 (2600) is a replay arm's; k7 is demo-b's; the g* rows are demo-c's.
    // boundaries in [1500, 6000): B1 (2000) and B2 (5000); B3 (7000) is past --window-end, the subagent boundary
    //   (2500) is not a main one, and demo-b is listed under another store, so it is skipped.
    // B1 is held by two copies, listed by file_id: f2 (planted first, the lower id) holds B1 at line 1 and its summary
    //   at line 2, nothing after; f1 holds B1 at line 3 with 22 rows after it (lines 4..25), its summary at line 4,
    //   the next boundary B2 at line 17 (5000), and its last timed row at line 25 (7100). The assistant rows after the
    //   summary and before line 17 are lines 5..16, at 3000..4100. No planted row has a model, msg_id or request_id.
    // B2 is held by f1 alone: line 17, 8 rows after it, summary 18, next boundary B3 at line 23 (7000); its rows are
    //   lines 19..21 (line 22 is a user row, line 25 lies past B3). models run past B3 to line 25, still one null.
    const [f2, f1] = fileIdsByIno(f.db);
    const raw = (line: number, ts: number): RawRow => [line, ts, null, null, `e-${line}`, null];
    expect(f.b1).toBe('e-3');
    expect(f.b2).toBe('e-17');
    // w2 echoes the window it was run over (W2-D13, amended), so assembleReports can refuse a report whose window is not the record's.
    expect(rep.w2).toEqual({ row_cap: 400, window_start_ms: 1500, window_end_ms: 6000, families: [{
      ccrc_id: 'demo-a', generation: G1, found: true, merged_generations: [''],
      calls: [[1999, 0, 'expand'], [2500, 0, 'expand'], [3900, 0, 'describe'], [3950, 0, 'expand'], [5200, 0, 'expand']],
      boundaries: [
        { boundary_uuid: f.b1, ts_ms: 2000, copies: [
          { file_id: f2, source_key: '', boundary_line: 1, after_count: 1, summary_line: 2, next_boundary_line: null,
            next_boundary_ts_ms: null, last_ts_ms: 2001, rows: [], models: [], truncated: false },
          { file_id: f1, source_key: '', boundary_line: 3, after_count: 22, summary_line: 4, next_boundary_line: 17,
            next_boundary_ts_ms: 5000, last_ts_ms: 7100,
            rows: Array.from({ length: 12 }, (_, k) => raw(5 + k, 3000 + 100 * k)), models: [null], truncated: false },
        ] },
        { boundary_uuid: f.b2, ts_ms: 5000, copies: [
          { file_id: f1, source_key: '', boundary_line: 17, after_count: 8, summary_line: 18, next_boundary_line: 23,
            next_boundary_ts_ms: 7000, last_ts_ms: 7100, rows: [raw(19, 5100), raw(20, 5200), raw(21, 5300)], models: [null], truncated: false },
        ] },
      ],
    }] });
  });

  // W2-3 Task 3 (W2-D14, D-5770): O52's window half re-pinned against the Node builder. W1's pin read 3 calls over
  // 14 assistant entries: B1 ended INCLUSIVE at its 10th entry (3900) and B2 at the copy's last row (7100, past B3).
  // Now a window is the first K = 10 assistant TURNS (here one row each: no msg_id or request_id is planted) and ends
  // EXCLUSIVE at turn 11's first row or at the next main boundary, whichever is earlier:
  //   B1 [2000, 4000): turns 3000..3900; calls k1 2500, k2 3900 and k3 3950 (k3 is now inside; k4 1999 is before it);
  //   B2 [5000, 7000), ended by B3's row: turns 5100, 5200, 5300; call k6 5200, the merged '' family's.
  // k5 is a replay arm's and never reaches Node (Task 1), B3 (7000) is past --window-end, the subagent boundary is not
  // a main one, and demo-b is listed under another store. Totals: windows 2, with_call 2, calls 4, turns 13.
  it('W2-3 Task 3: O52 re-pinned against the Node builder: windows 2, with_call 2, calls 4, turns 13, unmeasured 0; calls at exactly 4000 and 7000 stay outside', async () => {
    const g = await t3Gate();
    const f = plantedStore();
    const TOTALS = { windows: 2, with_call: 2, calls: 4, turns: 13, unmeasured: 0 };
    const before = g.buildWindows(t3Planted(f, g.ROW_CAP));
    expect(before.map((w) => [w.boundary_uuid, w.state, w.start_ms, w.end_ms, w.end_inclusive, w.turns, w.calls])).toEqual([
      [f.b1, 'measured', 2000, 4000, false, 10, 3],
      [f.b2, 'measured', 5000, 7000, false, 3, 1],
    ]);
    expect(g.windowTotals(before)).toEqual(TOTALS);
    const db = new DatabaseSync(f.db);
    try {
      const ins = db.prepare("INSERT INTO recall_calls (event_key, ccrc_id, generation, ts_ms, verb, rc, ms, arm) VALUES (?, 'demo-a', ?, ?, 'expand', 0, 40, NULL)");
      ins.run('k8', G1, 4000);   // exactly B1's end: turn 11's first row
      ins.run('k9', G1, 7000);   // exactly B2's end: B3's row
    } finally {
      db.close();
    }
    const after = t3Planted(f, g.ROW_CAP);
    expect(after.calls.map((c) => c[0]), 'CONTROL: both planted calls reach Node').toEqual(expect.arrayContaining([4000, 7000]));
    expect(g.windowTotals(g.buildWindows(after))).toEqual(TOTALS);
  });
});

describe('measure-history.py: read-only, and a missing input is refused, never created', () => {
  it('leaves the store\'s bytes as it found them', () => {
    const f = plantedStore();
    const sha = (): string => createHash('sha256').update(readFileSync(f.db)).digest('hex');
    const before = sha();
    report(['--db', f.db, '--now', String(NOW), '--families', f.families, '--window-start', '0', '--window-end', '9000', '--row-cap', '400']);
    expect(sha()).toBe(before);
  });

  it('a missing store exits 2 and creates nothing; --families without its window exits 2, and without --row-cap exits 2', () => {
    const home = mkTmp('ccrc-measure-history-missing-');
    const p = path.join(home, 'nope.db');
    const r = measure(['--db', p]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(`no history store at ${p}`);
    expect(existsSync(p)).toBe(false);
    const f = plantedStore();
    const w = measure(['--db', f.db, '--families', f.families]);
    expect(w.code).toBe(2);
    expect(w.stderr).toContain('--families needs --window-start and --window-end');
    const c = measure(['--db', f.db, '--families', f.families, '--window-start', '0', '--window-end', '9000']);
    expect(c.code).toBe(2);
    expect(c.stderr).toContain('--families needs --row-cap');
    expect(c.stdout).toBe('');
  });
});

describe('measure-history.py: the store path is percent-encoded into its read-only URI (FR1-d)', () => {
  /** A copy of a planted store under a directory whose name holds characters a SQLite URI reads as syntax. */
  const oddStore = (dirName: string): { db: string; dir: string; root: string } => {
    const f = plantedStore();
    const root = mkTmp('ccrc-measure-history-uri-');
    const dir = path.join(root, dirName);
    mkdirSync(dir);
    const db = path.join(dir, 'h.db');
    copyFileSync(f.db, db);
    return { db, dir, root };
  };
  const OPEN = (db: string): string => [
    'import importlib.util, sqlite3, sys',
    "spec = importlib.util.spec_from_file_location('mh', sys.argv[1]); mh = importlib.util.module_from_spec(spec); spec.loader.exec_module(mh)",
    'c = mh.open_db(sys.argv[2])',
    "try:\n    c.execute('CREATE TABLE zq_written (x)')\n    print('WROTE')\nexcept sqlite3.OperationalError as e:\n    print('READONLY', e)",
    "print(c.execute('SELECT count(*) FROM counters').fetchone()[0] >= 0)",
  ].join('\n') + `\n# ${db}`;

  it.each(['d#x', 'd?x', 'd%23x', 'd x'])('a store under %j opens read-only: a write through the connection fails and nothing is created beside it', (dirName) => {
    const o = oddStore(dirName);
    const r = spawnSync('python3', [...PY_ISOLATED, '-c', OPEN(o.db), SCRIPT, o.db], { encoding: 'utf8', env: { ...scrubbedEnv(process.env), PYTHONDONTWRITEBYTECODE: '1' }, timeout: 60_000 });
    expect(r.stderr).toBe('');
    expect(r.stdout.split('\n')[0]).toMatch(/^READONLY /);
    expect(r.stdout.split('\n')[1]).toBe('True');
    expect(readdirSync(o.root), 'a stray file where the URI parser cut the path').toEqual([dirName]);
    expect(report(['--db', o.db]).user_version).toBeGreaterThan(0);
  });

  it('the isolated launch loads the instrument without writing bytecode beside it (F25)', () => {
    const dir = mkTmp('ccrc-measure-history-pyc-');
    const copy = path.join(dir, 'measure-history.py');
    copyFileSync(SCRIPT, copy);
    const LOAD = ['import importlib.util, sys', "spec = importlib.util.spec_from_file_location('mh', sys.argv[1]); mh = importlib.util.module_from_spec(spec); spec.loader.exec_module(mh)"].join('\n');
    const r = spawnSync('python3', [...PY_ISOLATED, '-c', LOAD, copy], { encoding: 'utf8', env: { ...scrubbedEnv(process.env), PYTHONDONTWRITEBYTECODE: '1' }, timeout: 60_000 });
    expect(r.status, r.stderr).toBe(0);
    expect(readdirSync(dir)).toEqual(['measure-history.py']);
  });
});

describe('measure-history.py reads the event tables the sweep fills (O52)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  const ID = 'demo-quiet-basin';
  const SID = '22222222-3333-4444-8555-666666666666';
  const GEN = '0189abcd-1234-5678-9abc-0123456789ad';

  it('a tick writes one ticks row; a recall line drains to one recall_calls row and a steer line to one steer_receipts row', () => {
    const box = makeHistoryBox('ccrc-measure-history-sweep-', { role: 'fleet' });
    plantSession(box, ID, { uuid: SID, generation: GEN, project: 'demo' });
    let r = runSweep(box);   // first install: the store is created
    expect(r.code, r.stderr).toBe(0);
    const ticks = (): number => {
      const db = openStoreRO(box);
      try { return Number((db.prepare('SELECT count(*) AS n FROM ticks').get() as { n: number }).n); } finally { db.close(); }
    };
    const before = ticks();
    r = runSweep(box);
    expect(r.code, r.stderr).toBe(0);
    expect(ticks()).toBe(before + 1);

    const ts = Date.now();
    spoolLine(box, ID, { v: 1, ev: 'recall', id: ID, cmd: 'grep', rc: 0, ms: 812, gen: GEN, ts });
    spoolLine(box, ID, { v: 1, ev: 'steer', id: ID, sid: SID, leaf: '', gen: GEN, ts: ts + 1 });
    for (let i = 0; i < 2; i += 1) {   // a file renamed this tick is drained the next (§9.2)
      r = runSweep(box);
      expect(r.code, r.stderr).toBe(0);
    }
    const db = openStoreRO(box);
    try {
      expect(db.prepare('SELECT ccrc_id, generation, verb, rc, ms, arm, ts_ms FROM recall_calls').all())
        .toEqual([{ ccrc_id: ID, generation: GEN, verb: 'grep', rc: 0, ms: 812, arm: null, ts_ms: ts }]);
      expect(db.prepare('SELECT ccrc_id, cc_session_uuid, leaf_id, ts_ms FROM steer_receipts').all())
        .toEqual([{ ccrc_id: ID, cc_session_uuid: SID, leaf_id: '', ts_ms: ts + 1 }]);
    } finally {
      db.close();
    }
    const rep = report(['--db', path.join(box.home, '.ccrc', 'history', 'db', 'history.db')]);
    expect(rep.w1f_grep_p95_ms).toBe(812);
  });
});

// ── W1-B3: W1-e, the card line's delivery (spec 2026-10-05 §10.7, §8.6; ruling RC3). END-APPENDED. ────────────
// The sweep measures delivery from each compaction's transcript (card_served:<backend>, card_id_mismatch:<backend>)
// and counts each prediction a later main boundary consumed by its compaction's scope marker
// (card_consumed:main, :other, :unknown). W1-e is read from those counters alone, so each case plants counters in a
// store createStore made, and nothing else.
describe('measure-history.py: W1-e, the card line served and its id mismatches (spec 2026-10-05 §10.7; ruling RC3)', () => {
  interface W1e {
    consumed_main: number; consumed_other: number; consumed_unknown: number; served: number; mismatch: number;
    served_share: number | null; mismatch_share: number | null;
  }
  type ReportW1e = Report & { w1e: W1e };

  /** A real store holding exactly `counters`. */
  const cardStore = (counters: Record<string, number>): string => {
    const home = mkTmp('ccrc-measure-history-w1e-');
    createStore(home);
    const dbPath = path.join(home, '.ccrc', 'history', 'db', 'history.db');
    const db = new DatabaseSync(dbPath);
    try {
      db.exec('DELETE FROM counters');
      const ins = db.prepare('INSERT INTO counters (name, n) VALUES (?, ?)');
      for (const [k, v] of Object.entries(counters)) ins.run(k, v);
    } finally {
      db.close();
    }
    return dbPath;
  };
  const w1eOf = (db: string): W1e => (report(['--db', db, '--now', String(NOW)]) as ReportW1e).w1e;

  it("W1-e CONTROL: the scope words planted below are lib's CARD_CONSUMED_SCOPES, the words the sweep counts under", async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    expect(lib.CARD_CONSUMED_SCOPES).toEqual(['main', 'other', 'unknown']);
  });

  it('W1-e: the served share is over main and unknown consumptions, other reported beside it and out of the denominator: 20 of 21 served, 1 of 21 mismatched', () => {
    const r = w1eOf(cardStore({
      'card_served:anthropic': 19, 'card_served:other': 1, 'card_id_mismatch:anthropic': 1,
      'card_consumed:main': 19, 'card_consumed:unknown': 2, 'card_consumed:other': 5,
      card_written: 30, 'card_skipped:fork-qualified': 2, 'card_withdrawn:low-disk': 4,   // the writer's own: W1-e reads none
    }));
    expect(r).toMatchObject({ consumed_main: 19, consumed_other: 5, consumed_unknown: 2, served: 20, mismatch: 1 });
    expect(r.served_share).toBeCloseTo(20 / 21, 12);
    expect(r.mismatch_share).toBeCloseTo(1 / 21, 12);
  });

  it('W1-e: the mismatch share is of the lines that arrived (served + mismatch), the served share of the main and unknown consumptions', () => {
    // 24 main or unknown consumptions; 19 lines named their own leaf, 1 named another, 4 compactions carried no line.
    // Here the two denominators differ (20 and 24), and main and unknown differ from main alone (20), which the case
    // above cannot tell apart.
    const r = w1eOf(cardStore({
      'card_served:anthropic': 18, 'card_served:unknown': 1, 'card_id_mismatch:other': 1,
      'card_consumed:main': 20, 'card_consumed:unknown': 4,
    }));
    expect(r).toMatchObject({ consumed_main: 20, consumed_other: 0, consumed_unknown: 4, served: 19, mismatch: 1 });
    expect(r.served_share).toBeCloseTo(19 / 24, 12);
    expect(r.mismatch_share).toBeCloseTo(1 / 20, 12);
  });

  it('W1-e: a share with nothing under it is null, never 0; consumptions scoped other alone leave the served share null', () => {
    expect(w1eOf(cardStore({ raw_only: 3 }))).toEqual({
      consumed_main: 0, consumed_other: 0, consumed_unknown: 0, served: 0, mismatch: 0, served_share: null, mismatch_share: null,
    });
    const r = w1eOf(cardStore({ 'card_id_mismatch:anthropic': 2, 'card_consumed:other': 3 }));
    expect(r).toMatchObject({ consumed_main: 0, consumed_other: 3, consumed_unknown: 0, served: 0, mismatch: 2, served_share: null });
    expect(r.mismatch_share).toBe(1);
  });

  it('W1-e sits between W1-c and W1-f in the report, which stays headed by its store id', () => {
    expect(Object.keys(report(['--db', cardStore({}), '--now', String(NOW)]))).toEqual(['store_id', 'user_version', 'script_sha256', 'counters',
      'w1b_lag_p95_ms', 'w1c_duplicate_entries', 'w1e', 'w1f_grep_p95_ms', 'w2', 'census']);   // W2-3 Task 4: census follows w2, null without --census
  });
});

// ── W2-3 Task 1: raw window rows (W2-D13, W2-D16; D-5770, D-5772). END-APPENDED. ─────────────────────────────────
// measure-history.py prints raw rows and decides nothing about a window: deploy/history-gate.mjs builds every window,
// turn and producer from them (W2-D14, W2-D15). Each case below runs the real script against a store createStore made.

/** The planted store's ingest file ids in planting order (ino 100, 101, …): f2, f1, the subagent's file, demo-b's. */
function fileIdsByIno(dbPath: string): number[] {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return (db.prepare('SELECT file_id FROM ingest_files ORDER BY ino').all() as Array<{ file_id: number }>).map((r) => Number(r.file_id));
  } finally {
    db.close();
  }
}

describe('W2-3 Task 1: raw window rows', () => {
  /** plantedStore with models, msg_ids and request_ids set on f1's rows (line L is entry e-L): two rows of one API
   *  message at lines 5 and 6, a `<synthetic>` row at 7, a second model at 14, and a third at 25, past B2's next
   *  boundary (line 23). Every other row keeps a null model. */
  const modelled = (): Planted => {
    const f = plantedStore();
    const db = new DatabaseSync(f.db);
    try {
      const set = db.prepare('UPDATE entries SET model = ?, msg_id = ?, request_id = ? WHERE uuid = ?');
      for (const [uuid, model, msg, req] of [
        ['e-5', 'model-a', 'msg-1', 'req-1'], ['e-6', 'model-a', 'msg-1', 'req-1'], ['e-7', '<synthetic>', null, null],
        ['e-14', 'model-b', 'msg-9', null], ['e-25', 'model-c', null, 'req-20'],
      ] as const) expect(Number(set.run(model, msg, req, uuid).changes), uuid).toBe(1);
    } finally {
      db.close();
    }
    return f;
  };
  const W2_ARGS = (f: Planted, cap: string): string[] =>
    ['--db', f.db, '--now', String(NOW), '--families', f.families, '--window-start', '1500', '--window-end', '6000', '--row-cap', cap];
  const demoA = (rep: Report): FamilyReport => {
    const fam = rep.w2!.families.find((x) => x.ccrc_id === 'demo-a');
    expect(fam, JSON.stringify(rep.w2)).toBeDefined();
    return fam!;
  };
  /** The copy of boundary `uuid` held by file `fileId`. */
  const copyOf = (fam: FamilyReport, uuid: string, fileId: number): Copy => {
    const c = fam.boundaries.find((b) => b.boundary_uuid === uuid)?.copies.find((x) => x.file_id === fileId);
    expect(c, `${uuid} in file ${fileId}`).toBeDefined();
    return c!;
  };

  it('the arm pin: a replay arm\'s call (k5, inside B1) is absent from calls, as its grep is from W1-f', () => {
    const f = plantedStore();
    const rep = report(W2_ARGS(f, '400'));
    expect(demoA(rep).calls.map((c) => c[0])).toEqual([1999, 2500, 3900, 3950, 5200]);
    expect(demoA(rep).calls.map((c) => c[0])).not.toContain(2600);
    expect(rep.w1f_grep_p95_ms).toBe(2000);
  });

  it('merged_generations holds the \'\' row a re-key merged into the family, and that row\'s call (k6) is in calls', () => {
    const fam = demoA(report(W2_ARGS(plantedStore(), '400')));
    expect(fam.merged_generations).toEqual(['']);
    expect(fam.calls).toContainEqual([5200, 0, 'expand']);
  });

  it('a listed family the store does not hold is found: false with empty lists, never an empty list; another store\'s family is skipped', () => {
    const f = plantedStore();
    writeFileSync(f.families, JSON.stringify([
      { store_id: f.storeId, ccrc_id: 'demo-a', generation: G1 },
      { store_id: f.storeId, ccrc_id: 'demo-z', generation: G2 },
      { store_id: OTHER_STORE, ccrc_id: 'demo-b', generation: G2 },
    ]));
    const rep = report(W2_ARGS(f, '400'));
    expect(rep.w2!.families.map((x) => [x.ccrc_id, x.found])).toEqual([['demo-a', true], ['demo-z', false]]);
    expect(rep.w2!.families[1]).toEqual({ ccrc_id: 'demo-z', generation: G2, found: false, merged_generations: [], calls: [], boundaries: [] });
  });

  it('rows carry msg_id, request_id, uuid and model raw: two rows of one message stay two rows, and a <synthetic> row is still a row', () => {
    const f = modelled();
    const [, f1] = fileIdsByIno(f.db);
    const c = copyOf(demoA(report(W2_ARGS(f, '400'))), f.b1, f1);
    expect(c.rows.slice(0, 3)).toEqual([
      [5, 3000, 'msg-1', 'req-1', 'e-5', 'model-a'], [6, 3100, 'msg-1', 'req-1', 'e-6', 'model-a'], [7, 3200, null, null, 'e-7', '<synthetic>'],
    ]);
    expect(c.rows).toHaveLength(12);
    expect(c.rows[9]).toEqual([14, 3900, 'msg-9', null, 'e-14', 'model-b']);
  });

  it('models: every assistant row after the summary to the end of the copy, distinct, by first appearance, past the next boundary', () => {
    const f = modelled();
    const [, f1] = fileIdsByIno(f.db);
    const fam = demoA(report(W2_ARGS(f, '400')));
    // B1 in f1: assistant rows at lines 5..16, 19..21 and 25. Line 25 lies past the next boundary (17) and past B3 (23).
    expect(copyOf(fam, f.b1, f1).models).toEqual(['model-a', '<synthetic>', null, 'model-b', 'model-c']);
    // B2 in f1: lines 19..21 (null) and 25 (model-c), which lies past its next boundary (23).
    expect(copyOf(fam, f.b2, f1).models).toEqual([null, 'model-c']);
  });

  it('truncated: at --row-cap 3 B1\'s rows are cut to three and flagged, B2\'s exactly three are not, and models stay uncapped', () => {
    const f = modelled();
    const [f2, f1] = fileIdsByIno(f.db);
    const rep = report(W2_ARGS(f, '3'));
    expect(rep.w2!.row_cap).toBe(3);
    const fam = demoA(rep);
    const b1 = copyOf(fam, f.b1, f1);
    expect(b1.rows.map((r) => r[0])).toEqual([5, 6, 7]);
    expect(b1.truncated).toBe(true);
    expect(b1.after_count, 'after_count is uncapped').toBe(22);
    expect(b1.models).toEqual(['model-a', '<synthetic>', null, 'model-b', 'model-c']);
    const b2 = copyOf(fam, f.b2, f1);
    expect(b2.rows.map((r) => r[0])).toEqual([19, 20, 21]);
    expect(b2.truncated).toBe(false);
    expect(copyOf(fam, f.b1, f2)).toMatchObject({ rows: [], truncated: false });
  });

  it('--families without --row-cap exits 2 naming it, and a --row-cap below 1 exits 2; the W1 call takes none and reports w2 null', () => {
    const f = plantedStore();
    const none = measure(W2_ARGS(f, '400').slice(0, -2));
    expect(none.code).toBe(2);
    expect(none.stderr).toContain('--families needs --row-cap');
    const zero = measure(W2_ARGS(f, '0'));
    expect(zero.code).toBe(2);
    expect(zero.stderr).toContain('--row-cap must be a positive integer');
    expect(report(['--db', f.db, '--now', String(NOW)]).w2).toBeNull();
  });

  it('script_sha256 is the sha256 of the script\'s own bytes, and a byte-changed copy run from a temp directory reports its own', () => {
    const f = plantedStore();
    const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');
    expect(report(['--db', f.db, '--now', String(NOW)]).script_sha256).toBe(sha(SCRIPT));
    const dir = mkTmp('ccrc-measure-history-sha-');
    const copy = path.join(dir, 'measure-history.py');
    writeFileSync(copy, `${readFileSync(SCRIPT, 'utf8')}\n# one byte-changed copy\n`);
    const r = spawnSync('python3', [...PY_ISOLATED, copy, '--db', f.db, '--now', String(NOW)],
      { encoding: 'utf8', env: { ...scrubbedEnv(process.env), PYTHONDONTWRITEBYTECODE: '1' }, timeout: 60_000 });
    expect(r.status, r.stderr).toBe(0);
    const got = (JSON.parse(r.stdout) as Report).script_sha256;
    expect(got).toBe(sha(copy));
    expect(got).not.toBe(sha(SCRIPT));
  });

  // O32 narrowed (W2-D16, D-5772): the script prints entries.model raw and never tests it. The scan reads the whole
  // source, comments and docstring included, so the prose there keeps these shapes out too.
  const CLASSIFY: ReadonlyArray<readonly [string, RegExp]> = [
    ['a model value on the left of a comparison or membership test',
      /\bmodels?\b['"\]]?\s*(?:==|!=|<>|<=|>=|<|>|=|\bnot\s+in\b|\bin\b|\bis\b|\blike\b|\bglob\b|\bbetween\b)/i],
    ['a model value on the right of a comparison or membership test', /(?:==|!=|<>|\bin|\blike|\bglob)\s*\(?\s*(?:\w+[.[])?['"]?models?\b/i],
    ['a K binding', /^\s*K\s*=/m],
  ];
  it('O32 narrowed, CONTROL: each pattern catches the shape it bans, the 7d01973a2 K line among them', () => {
    const samples = [
      "K = 10   # the window: the first K assistant entries after a main boundary's summary row (ruled Q14)",
      'if model not in seen:', "if row['model'] == wanted:", "WHERE e.model = ? AND e.model LIKE 'x%'", 'if wanted in models:',
      'if model is None:',
    ];
    for (const [why, re] of CLASSIFY) expect(samples.some((s) => re.test(s)), why).toBe(true);
    expect(CLASSIFY[2]![1].test(samples[0]!)).toBe(true);
  });
  it('O32 narrowed: no comparison or membership test is applied to a model value, and no K is bound, in measure-history.py', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    for (const [why, re] of CLASSIFY) expect(src.match(re)?.[0] ?? null, `measure-history.py carries ${why}`).toBeNull();
  });

  // The no-blob pin (W2-D13): the census never reads a body, so it never selects blobs.z and loads no codec.
  const BLOB_READ: ReadonlyArray<readonly [string, RegExp]> = [
    ['a select of blobs.z', /\bz\s+FROM\s+blobs\b|\bblobs\.z\b|\bSELECT\s+z\b/i],
    ['a compression import', /^[ \t]*(?:import|from)[ \t][^\n]*\b(?:zlib|gzip|bz2|lzma|brotli|zstandard|zstd)\b/m],
  ];
  it('the no-blob pin, CONTROL: a planted SELECT z FROM blobs line and each compression import go red', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    expect(BLOB_READ[0]![1].test(`${src}\n    db.execute('SELECT z FROM blobs WHERE blob_id = ?', (1,))\n`)).toBe(true);
    for (const mod of ['zlib', 'gzip', 'bz2', 'lzma', 'brotli', 'zstandard']) {
      expect(BLOB_READ[1]![1].test(`${src}\nimport ${mod}\n`), mod).toBe(true);
    }
    expect(BLOB_READ[1]![1].test('import argparse, hashlib, json, zlib, os'), 'one more name on the import line').toBe(true);
  });
  it('the no-blob pin: measure-history.py selects no blobs.z and imports no compression module', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    for (const [why, re] of BLOB_READ) expect(src.match(re)?.[0] ?? null, `measure-history.py carries ${why}`).toBeNull();
  });

  // The PK-probe pin (W2-D13): a copy is found by ingest_files of the boundary's transcript, then the memberships
  // primary key (file_id, entry_id); never by a scan of memberships keyed on entry_id alone.
  const ENTRY_SCAN = /FROM\s+memberships\b[\s\S]{0,200}?\bWHERE\s+(?:\w+\.)?entry_id\s*(?:=|\bIN\b)/i;
  it('the PK-probe pin, CONTROL: the pattern matches the 7d01973a2 copy query', () => {
    expect(ENTRY_SCAN.test("'FROM memberships m WHERE m.entry_id = ? ORDER BY after DESC, m.file_id LIMIT 1',")).toBe(true);
    expect(ENTRY_SCAN.test("'SELECT m.file_id FROM memberships m JOIN ingest_files f ON f.file_id = m.file_id '\n            'WHERE m.entry_id = ?'"), 'a join between').toBe(true);
  });
  it('the PK-probe pin: no memberships query is keyed on entry_id alone, and the two probes are the ones the script runs', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    expect(src.match(ENTRY_SCAN)?.[0] ?? null).toBeNull();
    expect(src).toContain("'SELECT file_id, source_key FROM ingest_files WHERE transcript_pk = ? ORDER BY file_id'");
    expect(src).toContain("'SELECT 1 FROM memberships WHERE file_id = ? AND entry_id = ?'");
  });

  // ── Fix round 1: each guard in the new SQL has a case that goes red when it is removed. Every case below plants
  // its extra rows into its OWN plantedStore after planting, so no pinned value above moves. ──────────────────────
  const U3 = '11111111-2222-4333-8444-777777777777';
  /** Open the planted store writable and hand `fn` an insert helper, the main transcript's pk and demo-a's session pk. */
  const extend = (f: Planted, fn: (x: {
    ins: (sql: string, ...p: Array<string | number | null>) => number;
    entry: (uuid: string, tpk: number, type: string, ts: number | null) => number;
    mainTpk: number; sessionPk: number;
  }) => void): void => {
    const db = new DatabaseSync(f.db);
    try {
      const ins = (sql: string, ...p: Array<string | number | null>): number => Number(db.prepare(sql).run(...p).lastInsertRowid);
      const blob = Number((db.prepare('SELECT blob_id FROM blobs LIMIT 1').get() as { blob_id: number }).blob_id);
      const entry = (uuid: string, tpk: number, type: string, ts: number | null): number =>
        ins('INSERT INTO entries (uuid, transcript_pk, type, ts_ms, is_compact_summary, provenance, prov_version, '
          + "struct_rank_ns, struct_file_id, blob_id) VALUES (?, ?, ?, ?, 0, 'harness', 1, 1, 1, ?)", uuid, tpk, type, ts, blob);
      const mainTpk = Number((db.prepare("SELECT transcript_pk FROM transcripts WHERE cc_session_uuid = ? AND agent_id = ''").get(U1) as { transcript_pk: number }).transcript_pk);
      const sessionPk = Number((db.prepare("SELECT session_pk FROM sessions WHERE ccrc_id = 'demo-a' AND generation = ?").get(G1) as { session_pk: number }).session_pk);
      fn({ ins, entry, mainTpk, sessionPk });
    } finally {
      db.close();
    }
  };
  const argsFor = (f: Planted, start: string, end: string): string[] =>
    ['--db', f.db, '--now', String(NOW), '--families', f.families, '--window-start', start, '--window-end', end, '--row-cap', '400'];

  it('a copy with no next boundary keeps its assistant rows to the copy\'s end: B3 (f1:23) has next_boundary_line null and row 25', () => {
    const f = plantedStore();
    const [, f1] = fileIdsByIno(f.db);
    const fam = demoA(report(argsFor(f, '1500', '8000')));
    expect(fam.boundaries.map((b) => b.ts_ms)).toEqual([2000, 5000, 7000]);
    const b3 = fam.boundaries[2]!.copies;
    expect(b3).toEqual([{ file_id: f1, source_key: '', boundary_line: 23, after_count: 2, summary_line: 24, next_boundary_line: null,
      next_boundary_ts_ms: null, last_ts_ms: 7100, rows: [[25, 7100, null, null, 'e-25', null]], models: [null], truncated: false }]);
  });

  it('calls are bounded below by --window-start: one below it is absent, one exactly at it is present', () => {
    const f = plantedStore();
    extend(f, ({ ins }) => {
      for (const [key, ts] of [['kb', 1499], ['ke', 1500]] as const) {
        ins("INSERT INTO recall_calls (event_key, ccrc_id, generation, ts_ms, verb, rc, ms, arm) VALUES (?, 'demo-a', ?, ?, 'expand', 0, 40, NULL)", key, G1, ts);
      }
    });
    const calls = demoA(report(argsFor(f, '1500', '6000'))).calls;
    expect(calls.map((c) => c[0])).toEqual([1500, 1999, 2500, 3900, 3950, 5200]);
    expect(calls.map((c) => c[0])).not.toContain(1499);
  });

  it('a boundary with no summary row after it: summary_line null, and rows and models start after the boundary line itself', () => {
    const f = plantedStore();
    extend(f, ({ ins, entry, mainTpk }) => {
      const [, f1] = fileIdsByIno(f.db);
      const eb = entry('x-b', mainTpk, 'system', 7500);
      ins('INSERT INTO boundaries (entry_id, transcript_pk, ord) VALUES (?, ?, 10)', eb, mainTpk);
      ins('INSERT INTO memberships (file_id, entry_id, line) VALUES (?, ?, 26)', f1, eb);
      for (const [uuid, line, ts, model] of [['x-1', 27, 7600, 'model-z'], ['x-2', 28, 7700, null]] as const) {
        const e = entry(uuid, mainTpk, 'assistant', ts);
        if (model !== null) ins('UPDATE entries SET model = ? WHERE entry_id = ?', model, e);
        ins('INSERT INTO memberships (file_id, entry_id, line) VALUES (?, ?, ?)', f1, e, line);
      }
    });
    const [, f1] = fileIdsByIno(f.db);
    const fam = demoA(report(argsFor(f, '1500', '8000')));
    const bx = fam.boundaries.find((b) => b.boundary_uuid === 'x-b');
    expect(bx, JSON.stringify(fam.boundaries.map((b) => b.boundary_uuid))).toBeDefined();
    const c = copyOf(fam, 'x-b', f1);
    expect(c).toMatchObject({ boundary_line: 26, after_count: 2, summary_line: null, next_boundary_line: null, truncated: false });
    expect(c.rows).toEqual([[27, 7600, null, null, 'x-1', 'model-z'], [28, 7700, null, null, 'x-2', null]]);
    expect(c.models).toEqual(['model-z', null]);
  });

  it('a boundary is listed only inside [window_start, window_end) and only in a confirmed epoch', () => {
    const f = plantedStore();
    extend(f, ({ ins, entry, mainTpk, sessionPk }) => {
      let ord = 10;
      const bound = (uuid: string, tpk: number, ts: number, o: number): void => {
        ins('INSERT INTO boundaries (entry_id, transcript_pk, ord) VALUES (?, ?, ?)', entry(uuid, tpk, 'system', ts), tpk, o);
      };
      bound('w-below', mainTpk, 1499, ord++);   // one under the start: absent
      bound('w-start', mainTpk, 1500, ord++);   // exactly the start: present
      bound('w-end', mainTpk, 6000, ord++);     // exactly the end: absent
      // An epoch of the same family that was never confirmed, with a main transcript holding a boundary in the window.
      ins("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, confirmed_ms) VALUES (?, 2, ?, 'startup', 'hook', NULL)", sessionPk, U3);
      const t3 = ins("INSERT INTO transcripts (cc_session_uuid, agent_id) VALUES (?, '')", U3);
      bound('w-unconfirmed', t3, 3000, 1);
    });
    const fam = demoA(report(argsFor(f, '1500', '6000')));
    expect(fam.boundaries.map((b) => b.boundary_uuid)).toEqual(['w-start', f.b1, f.b2]);
    // The ones listed without a copy are still listed, with copies: [] (no file holds them).
    expect(fam.boundaries[0]).toEqual({ boundary_uuid: 'w-start', ts_ms: 1500, copies: [] });
  });

  it('merged_generations follow session_pk, not generation text and not descending pk', () => {
    const f = plantedStore();
    extend(f, ({ ins, sessionPk }) => {
      for (const gen of ['zz', 'aa']) {
        ins("INSERT INTO sessions (ccrc_id, generation, project, first_seen_ms, merged_into) VALUES ('demo-a', ?, 'demo', 1, ?)", gen, sessionPk);
      }
    });
    expect(demoA(report(argsFor(f, '1500', '6000'))).merged_generations).toEqual(['', 'zz', 'aa']);
  });

  it('models and rows read assistant entries only: a user row carrying a model is in neither', () => {
    const f = plantedStore();
    const [, f1] = fileIdsByIno(f.db);
    extend(f, ({ ins }) => {
      ins("UPDATE entries SET model = 'model-user' WHERE uuid = 'e-22'");
    });
    const chk = new DatabaseSync(f.db, { readOnly: true });
    try {
      expect(chk.prepare("SELECT type, model FROM entries WHERE uuid = 'e-22'").get()).toEqual({ type: 'user', model: 'model-user' });
    } finally {
      chk.close();
    }
    const fam = demoA(report(argsFor(f, '1500', '6000')));
    const b2 = copyOf(fam, f.b2, f1);
    expect(b2.rows.map((r) => r[0])).toEqual([19, 20, 21]);
    expect(b2.models).toEqual([null]);
    expect(copyOf(fam, f.b1, f1).models).toEqual([null]);
  });
});

// ── W2-3 Task 2: the gate module is pure and its words are its own (W2-D11, W2-D12; D-5774, D-5775) ──────────
// `deploy/history-gate.mjs` holds every W2 scoring decision (W2-D24) and must stay a pure function of its inputs:
// its imports are `node:crypto` and lib.mjs only, and its text (comments and strings included) never spells a
// clock, a random source, the environment or a dynamic load. Its closed word sets are frozen once, there, and
// pinned here once. FACT_KINDS and LABELS have exactly one declaring file under deploy/ and server/test/ (W2-D12;
// D-5774): importing them is allowed, so this describe reads them off the module and declares neither.
describe('W2-3 Task 2: the gate module is pure and its words are its own', () => {
  const GATE = path.join(ROOT, 'deploy', 'history-gate.mjs');
  const LIB_SPEC = '../ccd/history/lib.mjs';
  const gateSrc = (): string => readFileSync(GATE, 'utf8');
  const gate = async () => import('../../deploy/history-gate.mjs');
  /** Every specifier a static import or re-export names, and every bare `import '…'`. It is anchored at no line start
   *  and skips no text between the keyword and the quote, so a comment (with an apostrophe in it) inside a brace list,
   *  or an import after a `;` on the same line, cannot hide one. A from or import preceded by a word character or a
   *  quote is no keyword (a property name in a string, `'from'`), so the gate may spell it. Any other hit that is no
   *  import is a red too. */
  const specifiers = (text: string): string[] => [
    ...[...text.matchAll(/(?<![\w'"])from\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!),
    ...[...text.matchAll(/(?<![\w'"])import\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!),
  ];
  /** W2-D11's banned spellings, read over the WHOLE text: a comment or a string that spells one is a red too. */
  const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
    ['process.', /\bprocess\.[A-Za-z_$]/],
    ['Date.now', /\bDate\.now\b/],
    ['new Date', /\bnew\s+Date\b/],
    ['Math.random', /\bMath\.random\b/],
    ['performance.', /\bperformance\.[A-Za-z_$]/],
    ['require(', /\brequire\s*\(/],
    ['import(', /\bimport\s*\(/],
    // No random source and no clock under another spelling either (W2-D11): the crypto helpers, the web-crypto fill,
    // the module-qualified form, and a bare clock call (`Date(` without `new`).
    ['randomBytes, randomInt, randomUUID, randomFill', /\brandom(?:Bytes|Int|UUID|Fill(?:Sync)?)\b/],
    ['getRandomValues', /\bgetRandomValues\b/],
    ['crypto.random', /\bcrypto\.random/],
    ['a bare Date(', /(?<!new\s+)\bDate\s*\(/],
  ];
  /** Module-scope declarations only (column 0), the names a reader of the gate could import. */
  const topLevelNames = (text: string): string[] =>
    [...text.matchAll(/^(?:export\s+)?(?:const|let|var|class|(?:async\s+)?function\*?)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]!);
  /** single-definition.test.ts's O14 `declares`, rebuilt here; the names are assembled so this file never
   *  spells a declaration of either one itself. */
  const declares = (name: string): RegExp => new RegExp(`(?:^|[\\s;])(?:export\\s+)?(?:const|let|var)\\s+${name}\\b`);
  const OWN_WORDS = ['FACT' + '_KINDS', 'LAB' + 'ELS'] as const;
  /** A different vocabulary that happens to share the name, measured at 7d01973a2: collectLaneFixture.ts:58
   *  declares a `LABELS` Set of collect-lane box labels from COLLECT_BOX_LABELS. Named, and checked live below. */
  const NAMED_OTHERS: Record<string, { name: string; needle: string }> = {
    'server/test/collectLaneFixture.ts': { name: 'LAB' + 'ELS', needle: 'COLLECT_BOX_LABELS' },
  };
  /** Comment lines dropped, single-definition.test.ts's `stallCodeText` rule: a sentence about a name is no declaration. */
  const codeLinesOf = (text: string): string[] => text.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
  const filesUnder = (dir: string, ext: RegExp): string[] =>
    (readdirSync(dir, { recursive: true, encoding: 'utf8' }) as string[])
      .filter((p) => ext.test(p) && !p.split(path.sep).some((s) => s.startsWith('__') || s === 'node_modules'))
      .map((p) => path.join(dir, p));
  /** single-definition.test.ts's class scan (the four-class `enumerates`), restated: a file holding all four
   *  class words is a holder there, and the gate must never become one. */
  const CLASSES = ['haiku', 'sonnet', 'opus', 'fable'] as const;
  const enumeratesClasses = (text: string): boolean => CLASSES.every((c) =>
    new RegExp(`(?:'${c}'|"${c}"|(?<![\\w'-])${c}\\s*:|(?<![\\w-])${c}(?![\\w-]))`).test(text));

  it('CONTROL: the specifier reader, the banned patterns, the declaration reader and the class scan each see what they look for', () => {
    expect(specifiers("import {\n  a,\n  b,\n} from 'node:fs';\nimport 'node:path';\nexport { c } from './c.mjs';"))
      .toEqual(['node:fs', './c.mjs', 'node:path']);
    // Bypass shapes the first reader missed: a comment with an apostrophe inside the brace list, and an import after a `;`.
    expect(specifiers("import {\n  readFileSync, // the record's file\n} from 'node:fs';"), 'a comment with an apostrophe').toEqual(['node:fs']);
    expect(specifiers("export const a = 1; import { readFileSync } from 'node:fs';"), 'an import after a semicolon').toEqual(['node:fs']);
    const planted: Record<string, string> = {
      'process.': 'const h = process.env.HOME;', 'Date.now': 'const t = Date.now();', 'new Date': 'const d = new Date(0);',
      'Math.random': 'const r = Math.random();', 'performance.': 'const p = performance.now();',
      'require(': "const fs = require('node:fs');", 'import(': "const m = await import('node:fs');",
      'randomBytes, randomInt, randomUUID, randomFill': 'const b = randomBytes(8) + randomInt(9) + randomUUID() + randomFillSync(x);',
      'getRandomValues': 'globalThis.crypto.getRandomValues(a);', 'crypto.random': 'const u = crypto.randomUUID();',
      'a bare Date(': 'const t = Date();',
    };
    for (const [word, re] of FORBIDDEN) {
      expect(re.test(planted[word]!), word).toBe(true);
      expect(re.test('the sweep process. A new Dated row; imports are static'), word).toBe(false);
    }
    // `new Date(0)` belongs to the `new Date` row, so the bare-call row must not double-count it.
    expect(FORBIDDEN.find(([w]) => w === 'a bare Date(')![1].test('const d = new Date(0);')).toBe(false);
    expect(topLevelNames('export const EXIT = 1;\nconst k = 2;\n  const inner = 3;\nexport function f() {}\nclass C {}'))
      .toEqual(['EXIT', 'k', 'f', 'C']);
    expect(declares(OWN_WORDS[0]).test(`export const ${OWN_WORDS[0]} = Object.freeze(['sha']);`)).toBe(true);
    expect(declares(OWN_WORDS[0]).test(`import { ${OWN_WORDS[0]} } from '../deploy/history-gate.mjs';`)).toBe(false);
    expect(declares(OWN_WORDS[1]).test(`const { ${OWN_WORDS[1]} } = gate;`)).toBe(false);
    expect(enumeratesClasses(readFileSync(path.join(ROOT, 'deploy', 'models-op.mjs'), 'utf8')), 'a known holder').toBe(true);
  });

  it('CONTROL: a quoted word from or import (a property name in a string, not a keyword) is no specifier, and the real shapes still read', () => {
    expect(specifiers("if (!Object.hasOwn(body, 'from')) x();"), 'a quote straight after from, no later quote').toEqual([]);
    expect(specifiers("if (!Object.hasOwn(body, 'from') || !Object.hasOwn(body, 'to')) x();"), 'a quote straight after from, a later quote').toEqual([]);
    expect(specifiers("if (!Object.hasOwn(body, 'import') || !Object.hasOwn(body, 'to')) x();"), 'the same for import').toEqual([]);
    expect(specifiers("const a = { from: 1 }; const f = 'from'; const g = 'x';"), 'a word from inside an identifier or a string').toEqual([]);
    expect(specifiers("import {a} from 'node:fs';import 'node:path';export * from './c.mjs';"), 'imports with no space before them').toEqual(['node:fs', './c.mjs', 'node:path']);
  });

  it('imports only node:crypto and lib.mjs, and lib.mjs exactly as W2-D11 lists it', () => {
    const specs = specifiers(gateSrc());
    expect(specs).toContain(LIB_SPEC);
    for (const s of specs) expect(['node:crypto', LIB_SPEC], s).toContain(s);
    expect(gateSrc()).toContain(
      "import { EXIT, UUID_RE, canonicalJson, pickHoldingCopy, producerOf, sha256Hex } from '../ccd/history/lib.mjs';");
  });

  it.each(FORBIDDEN)('the gate source never spells %s (comments and strings included)', (word, re) => {
    const hits = gateSrc().split('\n').map((l, i) => [i + 1, l] as const).filter(([, l]) => re.test(l));
    expect(hits, `${word} at deploy/history-gate.mjs:${hits.map(([n]) => n).join(',')}`).toEqual([]);
  });

  it('O14, local half: the gate declares no name lib.mjs exports', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    const names = topLevelNames(gateSrc());
    expect(names, 'the reader found the gate\'s own declarations').toEqual(expect.arrayContaining(['K', OWN_WORDS[0], 'familyKey']));
    expect(names.filter((n) => Object.prototype.hasOwnProperty.call(lib, n))).toEqual([]);
  });

  it('W2-D12 (D-5774): exactly one file under deploy/ and server/test/ declares each of the gate\'s own word lists, the gate', () => {
    // W2-D12 says "a second file under deploy/ or server/test": every .ts, .mjs and .js file there, not .ts alone.
    const corpus = [...filesUnder(path.join(ROOT, 'deploy'), /\.mjs$/), ...filesUnder(path.join(ROOT, 'server', 'test'), /\.(?:ts|mjs|js)$/)];
    expect(corpus.map((f) => path.relative(ROOT, f))).toEqual(expect.arrayContaining([
      'deploy/history-gate.mjs', 'server/test/measure-history.test.ts', 'server/test/run-tmp.globalsetup.mjs']));
    const texts = new Map(corpus.map((f) => [f, readFileSync(f, 'utf8')] as const));
    for (const name of OWN_WORDS) {
      const re = declares(name);
      const holders = corpus.filter((f) => texts.get(f)!.includes(name) && codeLinesOf(texts.get(f)!).some((l) => re.test(l)))
        .map((f) => path.relative(ROOT, f)).filter((r) => NAMED_OTHERS[r]?.name !== name).sort();
      expect(holders, `${name}: a second declaration`).toEqual(['deploy/history-gate.mjs']);
    }
    for (const [rel, { name, needle }] of Object.entries(NAMED_OTHERS)) {
      const line = codeLinesOf(readFileSync(path.join(ROOT, rel), 'utf8')).find((l) => declares(name).test(l));
      expect(line, `${rel} no longer declares ${name}: remove it from NAMED_OTHERS`).toBeDefined();
      expect(line, `${rel}'s ${name} is no longer the ${needle} set: rule on it`).toContain(needle);
    }
  });

  it('the gate never spells the two small class words, so the class scan never counts it', () => {
    const text = gateSrc();
    expect(text.match(/haiku|sonnet/gi) ?? []).toEqual([]);
    expect(enumeratesClasses(text)).toBe(false);
  });

  it('each constant and word set has its exact value, frozen, with no repeated member', async () => {
    const g = await gate();
    const expected: Record<string, unknown> = {
      K: 10,
      K_UNIT: 'assistant-turns',
      X: { num: 1, den: 10 },
      ROW_CAP: 400,
      BOOTSTRAP: { B: 10000, ci: 95, method: 'percentile', percentile: 'nearest-rank', statistic: 'pooled', prng: 'xoshiro128**' },
      SUBSTREAMS: ['quiz-ci', 'live-ci', 'q18', 'handcheck', 'quiz-sample', 'judge-order'],
      PILOT_SUBSTREAM: 'pilot-sample',
      ASSIGN_LABEL: 'assign',
      FACT_KINDS: ['sha', 'path', 'command', 'error'],
      LABELS: ['correct', 'uncertain', 'fabricated'],
      RUBRIC_IDS: ['v1', 'v1-strict'],
      WRITER_INPUTS: ['excerpt', 'leaf-span'],
      SHA_MIN_PREFIXES: [7, 40],
      ANSWER_STATES: ['value', 'unknown', 'absent'],
      RUN_CLASSES: ['answered', 'infra-failed', 'not-run'],
      QUESTION_OUTCOMES: ['answered', 'rerun', 'run-failed', 'not-run'],
      VERDICTS: ['pass', 'fail', 'halt', 'incomplete'],
      HALT_WORDS: ['absent-rate', 'run-failed', 'handcheck-agreement', 'empty-arm'],
      WINDOW_STATES: ['measured', 'unmeasured'],
      ASSIGNMENT_ARMS: ['treatment', 'control'],
      ACTIVE_EXCLUSIONS: ['merged', 'legacy', 'not-newest', 'no-recent-entry'],
      AMENDMENT_KINDS: ['version-move', 'freeze-exception', 'forced-act'],
      GATE_CODE_FILES: ['deploy/history-gate.mjs', 'deploy/measure-history.py', 'deploy/history-replay.mjs', 'ccd/history/lib.mjs'],
      GATE_REASONS: [
        'store-id-null', 'store-id-duplicate', 'store-id-unlisted', 'family-unassigned', 'row-cap-mismatch', 'window-mismatch', 'code-changed', 'code-unmeasured',
        'writer-malformed', 'writer-leak',
        'question-not-run',
        'field-missing', 'field-unknown', 'field-malformed', 'constant-mismatch', 'value-outside-set', 'model-alias', 'model-forbidden',
        'signed-text-mismatch', 'release-mismatch', 'flag-rejected', 'seed-changed', 'pilot-drift', 'quiz-mismatch', 'quiz-holds-control',
        'pilot-quiz-overlap', 'window-length', 'assignment-mismatch', 'draft-mismatch', 'chain-mismatch', 'post-start-change',
        'amendment-kind', 'amendment-detail-mismatch', 'version-move-unpiloted',
      ],
    };
    const mod = g as unknown as Record<string, unknown>;
    for (const [name, value] of Object.entries(expected)) {
      expect(mod[name], name).toEqual(value);
      if (typeof value === 'object') {
        expect(Object.isFrozen(mod[name]), `${name} is not frozen`).toBe(true);
        if (Array.isArray(value)) expect(new Set(value).size, `${name} repeats a member`).toBe(value.length);
      }
    }
    expect(g.FACT_KINDS, 'D-5775: decisions are not a fact kind').not.toContain('decision');
    expect(g.SUBSTREAMS, 'the pilot\'s label is used only with the pilot\'s own seed').not.toContain(g.PILOT_SUBSTREAM);
    expect(g.SUBSTREAMS, '\'assign\' is a hash label, not a substream').not.toContain(g.ASSIGN_LABEL);
    expect(typeof g.METRIC_TEXT).toBe('string');
    // The ruled text, whole, built by concatenation as the module builds it; the open record's `metric` must equal it.
    expect(g.METRIC_TEXT).toBe('recall calls per post-compaction turn, reported for both arms; gated: the share of treatment '
      + 'windows with at least one ccrc history read-verb call over the first K assistant turns after a main boundary');
  });

  it('familyKey is canonical JSON of (store_id, ccrc_id, generation): equal ids on two stores are two keys', async () => {
    const g = await gate();
    const lib = await import('../../ccd/history/lib.mjs');
    expect(g.familyKey(OTHER_STORE, 'demo-id', G1)).toBe(`["${OTHER_STORE}","demo-id","${G1}"]`);
    expect(g.familyKey(OTHER_STORE, 'demo-id', G1)).toBe(lib.canonicalJson([OTHER_STORE, 'demo-id', G1]));
    expect(g.familyKey(OTHER_STORE, 'demo-id', G1)).not.toBe(g.familyKey('00000000-0000-4000-8000-000000000002', 'demo-id', G1));
    expect(g.familyKey(OTHER_STORE, 'a","b', '')).toBe(`["${OTHER_STORE}","a\\",\\"b",""]`);
  });
});

// ── W2-3 Task 3: windows over assistant turns, and the two copy rules (W2-D14, W2-D15, W2-D16, W2-D17) ─────────────
// END-APPENDED. measure-history.py emits raw rows (Task 1) and deploy/history-gate.mjs builds every window in Node
// (D-5770): K = 10 assistant TURNS, rows grouped by msg_id ?? request_id ?? uuid, an angle-bracketed model's row
// dropped and a null-model row kept; open at the boundary's ts inclusive; end EXCLUSIVE at the earlier of turn 11's
// first row and the next main boundary, else INCLUSIVE at the copy's last timed row; unmeasured when the row cap cut
// the copy before turn 11 was seen, when the copy has no timed row, or (chosen) when a row that would end the window
// has no ts. The window reads W1's longest copy, the producer lib.pickHoldingCopy's (D-5771). Every store below is a
// fixture HOME that createStore made, read by the real script under -I -B; turnStore is plantedStore's sibling.

/** One assistant row as measure-history.py emits it: [line, ts_ms, msg_id, request_id, uuid, model]. */
type T3RawRow = [number, number | null, string | null, string | null, string, string | null];
/** One call: [ts_ms, rc, verb]. */
type T3Call = [number, number, string];
interface T3Copy {
  file_id: number; source_key: string; boundary_line: number; after_count: number; summary_line: number | null;
  next_boundary_line: number | null; next_boundary_ts_ms: number | null; last_ts_ms: number | null;
  rows: T3RawRow[]; models: Array<string | null>; truncated: boolean;
}
interface T3Boundary { boundary_uuid: string; ts_ms: number; copies: T3Copy[] }
interface T3Family { ccrc_id: string; generation: string; found: boolean; merged_generations: string[]; calls: T3Call[]; boundaries: T3Boundary[] }
interface T3Window {
  boundary_uuid: string; ts_ms: number; producer: 'anthropic' | 'other' | 'unknown'; state: 'measured' | 'unmeasured';
  start_ms: number; end_ms: number | null; end_inclusive: boolean; turns: number; calls: number; with_call: boolean;
}
/** The names Task 3 adds to deploy/history-gate.mjs, and the three of Task 2's it reads. */
interface T3Gate {
  K: number; ROW_CAP: number; WINDOW_STATES: readonly string[];
  turnKey(row: T3RawRow): string;
  turnsOf(rows: T3RawRow[]): Array<{ key: string; first_line: number; first_ts_ms: number | null; rows: T3RawRow[] }>;
  windowCopyOf(copies: T3Copy[]): T3Copy | null;
  producerCopyOf(copies: T3Copy[]): T3Copy | null;
  producerOfBoundary(copies: T3Copy[]): 'anthropic' | 'other' | 'unknown';
  windowOf(boundary: T3Boundary, calls: T3Call[], k?: number): T3Window;
  buildWindows(family: T3Family, k?: number): T3Window[];
  windowTotals(windows: T3Window[]): { windows: number; with_call: number; calls: number; turns: number; unmeasured: number };
  splitAtFirstExit8(calls: T3Call[]): { upTo: T3Call[]; after: T3Call[] };
}
const t3Gate = async (): Promise<T3Gate> => (await import('../../deploy/history-gate.mjs')) as unknown as T3Gate;

/** One entry of turnStore's main transcript. */
interface T3Row { type: 'assistant' | 'user' | 'system'; ts: number | null; msg?: string | null; req?: string | null; model?: string | null; summary?: boolean; boundary?: boolean }
/** One copy of that transcript: its rows as indexes into the entries, in file order. */
interface T3CopyPlan { source_key?: string; lines: readonly number[] }
const T3_ID = 'demo-t3';
const T3_GEN = '0189abcd-1234-5678-9abc-0123456789f3';
const T3_SID = '33333333-4444-4555-8666-777777777777';
const t3B = (ts: number | null): T3Row => ({ type: 'system', ts, boundary: true });
const t3S = (ts: number | null): T3Row => ({ type: 'user', ts, summary: true });
const t3A = (ts: number | null, msg: string | null, model: string | null = 'claude-fixture-a', req: string | null = null): T3Row =>
  ({ type: 'assistant', ts, msg, req, model });
/** `n` one-row turns from `t0`, `step` apart, each with its own msg_id. */
const t3Turns = (n: number, t0: number, step = 100): T3Row[] => Array.from({ length: n }, (_, i) => t3A(t0 + i * step, `m${t0 + i * step}`));
/** Turn 10 is two rows (2000, 2010); turn 11 opens at 2100. */
const T3_TEN_SPLIT = (): T3Row[] => [t3B(1000), t3S(1001), ...t3Turns(9, 1100), t3A(2000, 'm10'), t3A(2010, 'm10'), t3A(2100, 'm11'), t3A(2200, 'm12')];
/** P1: B1's only non-unknown model lies after the next main boundary. */
const T3_P1 = (): T3Row[] => [t3B(1000), t3S(1001), t3A(1100, 'm1', null), t3A(1200, 'm2', '<synthetic>'), t3B(2000), t3S(2001), t3A(2100, 'm3', 'claude-fixture-a')];
/** P2: the only non-unknown model is the 4th row, past a row cap of 2; no next boundary. */
const T3_P2 = (): T3Row[] => [t3B(1000), t3S(1001), t3A(1100, 'm1', null), t3A(1200, 'm2', null), t3A(1300, 'm3', null), t3A(1400, 'm4', 'other-fixture-b')];
/** P3: a retired copy (source_key 'seg-1', the smaller file_id) holds one row more than the live copy. */
const T3_P3 = (): T3Row[] => [t3B(1000), t3S(1001), t3A(1100, 'm1', null), t3A(1200, 'm2', 'claude-fixture-a')];
const T3_P3_COPIES: readonly T3CopyPlan[] = [{ source_key: 'seg-1', lines: [0, 1, 2, 3] }, { lines: [0, 1, 2] }];

/** A store createStore made, holding ONE family, listed in `families`, whose one main transcript holds `rows` (entry uuids
 *  `t3-<index>`). `copies` are its ingest files, each a list of row indexes in file order (default: one live copy of every
 *  row). Each boundary's anchor_uuid is its own uuid, so derive's summary pick is the first compact summary after it, the
 *  row Task 1 reads. `calls` are the family's recall_calls rows, arm NULL. */
function turnStore(rows: T3Row[], calls: T3Call[] = [], copies: readonly T3CopyPlan[] = [{ lines: rows.map((_, i) => i) }]): { db: string; families: string } {
  const home = mkTmp('ccrc-measure-history-t3-');
  const { storeId } = createStore(home);
  const dbPath = path.join(home, '.ccrc', 'history', 'db', 'history.db');
  const db = new DatabaseSync(dbPath);
  try {
    for (const t of ['counters', 'ticks', 'recall_calls']) db.exec(`DELETE FROM ${t}`);
    const ins = (sql: string, ...p: Array<string | number | null | Uint8Array>): number => Number(db.prepare(sql).run(...p).lastInsertRowid);
    const blob = ins("INSERT INTO blobs (sha256, codec, z, raw_len) VALUES (?, 'br5', NULL, 0)",
      createHash('sha256').update('measure-history t3 fixture').digest());
    const pk = ins('INSERT INTO sessions (ccrc_id, generation, project, first_seen_ms, merged_into) VALUES (?, ?, ?, ?, NULL)', T3_ID, T3_GEN, 'demo', 1);
    ins("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, confirmed_ms) VALUES (?, 1, ?, 'startup', 'hook', 1)", pk, T3_SID);
    const tpk = ins("INSERT INTO transcripts (cc_session_uuid, agent_id) VALUES (?, '')", T3_SID);
    const ids = rows.map((r, i) => ins('INSERT INTO entries (uuid, transcript_pk, type, ts_ms, is_compact_summary, model, msg_id, request_id, '
      + 'provenance, prov_version, struct_rank_ns, struct_file_id, blob_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, ?)',
    `t3-${i}`, tpk, r.type, r.ts, r.summary === true ? 1 : 0, r.model ?? null, r.msg ?? null, r.req ?? null,
    r.type === 'assistant' ? 'model' : r.summary === true ? 'summary' : 'harness', blob));
    let ord = 0;
    rows.forEach((r, i) => {
      if (r.boundary === true) ins('INSERT INTO boundaries (entry_id, transcript_pk, ord, anchor_uuid) VALUES (?, ?, ?, ?)', ids[i]!, tpk, ++ord, `t3-${i}`);
    });
    copies.forEach((c, k) => {
      const fid = ins("INSERT INTO ingest_files (dev, ino, source_key, transcript_pk, status, parser_version) VALUES (1, ?, ?, ?, 'live', 1)", 300 + k, c.source_key ?? '', tpk);
      c.lines.forEach((i, at) => ins('INSERT INTO memberships (file_id, entry_id, line) VALUES (?, ?, ?)', fid, ids[i]!, at + 1));
    });
    calls.forEach(([ts, rc, verb], k) => ins('INSERT INTO recall_calls (event_key, ccrc_id, generation, ts_ms, verb, rc, ms, arm) VALUES (?, ?, ?, ?, ?, ?, 40, NULL)',
      `t3k${k}`, T3_ID, T3_GEN, ts, verb, rc));
  } finally {
    db.close();
  }
  const families = path.join(home, 'families.json');
  writeFileSync(families, JSON.stringify([{ store_id: storeId, ccrc_id: T3_ID, generation: T3_GEN }]));
  return { db: dbPath, families };
}

/** turnStore's family, through `script` (the real one by default) over every time, at `rowCap`. */
function t3Family(s: { db: string; families: string }, rowCap = 400, script = SCRIPT): T3Family {
  const r = spawnSync('python3', [...PY_ISOLATED, script, '--db', s.db, '--families', s.families, '--window-start', '0', '--window-end', '1000000',
    '--row-cap', String(rowCap)], { encoding: 'utf8', env: { ...scrubbedEnv(process.env), PYTHONDONTWRITEBYTECODE: '1' }, timeout: 60_000 });
  expect(r.status, r.stderr).toBe(0);
  const fams = (JSON.parse(r.stdout) as { w2: { families: T3Family[] } }).w2.families;
  expect(fams.map((x) => [x.ccrc_id, x.found])).toEqual([[T3_ID, true]]);
  return fams[0]!;
}

/** The planted fixture's listed family through the real script over [1500, 6000), O52's own window. */
function t3Planted(f: Planted, rowCap: number): T3Family {
  const fams = (report(['--db', f.db, '--now', String(NOW), '--families', f.families, '--window-start', '1500', '--window-end', '6000',
    '--row-cap', String(rowCap)]) as unknown as { w2: { families: T3Family[] } }).w2.families;
  expect(fams.map((x) => x.ccrc_id), 'demo-b is listed under another store').toEqual(['demo-a']);
  return fams[0]!;
}

/** derive.mjs:313-316's producer for one boundary, composed as derive composes it: holdingCopyOf's copy, its rows in file
 *  order, lib.summaryRowFor's pick (else the boundary row) and lib.producerOfCopy. Opens the store read-only. */
async function t3DeriveProducer(dbPath: string, uuid: string): Promise<{ fileId: number | null; producer: string }> {
  const D = (await import('../../ccd/history/derive.mjs')) as unknown as {
    holdingCopyOf(db: DatabaseSync, b: { entry_id: number; transcript_pk: number }): { file_id: number } | null;
  };
  const L = await import('../../ccd/history/lib.mjs');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const b = db.prepare('SELECT b.entry_id AS entry_id, b.transcript_pk AS transcript_pk, b.anchor_uuid AS anchor_uuid FROM boundaries b '
      + 'JOIN entries e ON e.entry_id = b.entry_id WHERE e.uuid = ?').get(uuid) as { entry_id: number; transcript_pk: number; anchor_uuid: string | null };
    const copy = D.holdingCopyOf(db, b);
    if (copy === null) return { fileId: null, producer: 'unknown' };
    const rows = db.prepare('SELECT e.uuid AS uuid, e.type AS type, e.model AS model, e.provenance AS provenance, e.is_compact_summary AS cs '
      + 'FROM memberships m JOIN entries e ON e.entry_id = m.entry_id WHERE m.file_id = ? ORDER BY m.line')
      .all(copy.file_id) as Array<{ uuid: string; type: string; model: string | null; provenance: string; cs: number }>;
    const pick = L.summaryRowFor({ boundaryUuid: uuid, anchorUuid: b.anchor_uuid,
      rows: rows.map((r) => ({ uuid: r.uuid, isCompactSummary: r.cs === 1, isEcho: r.type === 'user' && r.provenance === 'harness' })) });
    return { fileId: Number(copy.file_id), producer: L.producerOfCopy(rows, rows.findIndex((r) => r.uuid === (pick.uuid ?? uuid))) };
  } finally {
    db.close();
  }
}

describe('W2-3 Task 3: windows over assistant turns', () => {
  /** A window as [state, start, end, end inclusive, turns, calls]. */
  const W = (ws: T3Window[]): unknown[] => ws.map((w) => [w.state, w.start_ms, w.end_ms, w.end_inclusive, w.turns, w.calls]);

  it('RP6: three rows sharing a msg_id are one turn, so turn 11 is the 12th turn and a call at 1950 is inside; the window holds K turns, not every turn seen', async () => {
    const g = await t3Gate();
    const fam = t3Family(turnStore([t3B(1000), t3S(1001), t3A(1100, 'm1'), t3A(1110, 'm1'), t3A(1120, 'm1'), ...t3Turns(11, 1200)], [[1950, 0, 'expand']]));
    const turns = g.turnsOf(fam.boundaries[0]!.copies[0]!.rows);
    expect(turns.map((t) => t.rows.length)).toEqual([3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(turns[0]).toMatchObject({ key: 'm1', first_line: 3, first_ts_ms: 1100 });
    expect(W(g.buildWindows(fam))).toEqual([['measured', 1000, 2100, false, 10, 1]]);
  });

  it('RP6: a call between turn 10 and turn 11 is inside: after turn 10\'s last row, before turn 11\'s first', async () => {
    const g = await t3Gate();
    expect(W(g.buildWindows(t3Family(turnStore(T3_TEN_SPLIT(), [[2050, 0, 'expand']]))))).toEqual([['measured', 1000, 2100, false, 10, 1]]);
  });

  it('RP6: the 11th-turn case: a call at turn 11\'s first ts is outside, one a millisecond earlier inside', async () => {
    const g = await t3Gate();
    expect(W(g.buildWindows(t3Family(turnStore(T3_TEN_SPLIT(), [[2099, 0, 'expand'], [2100, 0, 'expand']]))))).toEqual([['measured', 1000, 2100, false, 10, 1]]);
  });

  it('RP6: a <synthetic> row is not a turn, and the script hands it to Node unread', async () => {
    const g = await t3Gate();
    const fam = t3Family(turnStore([t3B(1000), t3S(1001), ...t3Turns(5, 1100), t3A(1550, 'syn', '<synthetic>'), ...t3Turns(7, 1600)], [[2050, 0, 'expand']]));
    expect(fam.boundaries[0]!.copies[0]!.rows.map((r) => r[5]), 'CONTROL: the row reaches Node').toContain('<synthetic>');
    expect(W(g.buildWindows(fam))).toEqual([['measured', 1000, 2100, false, 10, 1]]);
  });

  it('RP6: two boundaries three turns apart: a call after the second counts once, in the second window', async () => {
    const g = await t3Gate();
    const ws = g.buildWindows(t3Family(turnStore([t3B(1000), t3S(1001), ...t3Turns(3, 1100), t3B(2000), t3S(2001), ...t3Turns(3, 2100)], [[2150, 0, 'expand']])));
    expect(W(ws)).toEqual([['measured', 1000, 2000, false, 3, 0], ['measured', 2000, 2300, true, 3, 1]]);
    expect(g.windowTotals(ws)).toEqual({ windows: 2, with_call: 1, calls: 1, turns: 6, unmeasured: 0 });
  });

  it('RP6: a copy the row cap cut before turn 11 is unmeasured even with a later next boundary; the next window is measured', async () => {
    const g = await t3Gate();
    const fam = t3Family(turnStore([t3B(1000), t3S(1001), ...t3Turns(12, 1100), t3B(3000), t3S(3001), t3A(3100, 'm3100')], [[1500, 0, 'expand']]), 5);
    expect(fam.boundaries[0]!.copies[0]!, 'CONTROL: cut at 5 rows, with a timed next boundary').toMatchObject({ truncated: true, next_boundary_line: 15, next_boundary_ts_ms: 3000 });
    expect(fam.boundaries[0]!.copies[0]!.rows).toHaveLength(5);
    const ws = g.buildWindows(fam);
    expect(W(ws)).toEqual([['unmeasured', 1000, null, false, 0, 0], ['measured', 3000, 3100, true, 1, 0]]);
    expect(g.windowTotals(ws)).toEqual({ windows: 1, with_call: 0, calls: 0, turns: 1, unmeasured: 1 });
    for (const w of ws) expect(g.WINDOW_STATES).toContain(w.state);
  });

  it('RP6 (W2-D17): a null-model row is a turn; only an angle-bracketed model drops its row', async () => {
    const g = await t3Gate();
    const fam = t3Family(turnStore([t3B(1000), t3S(1001), ...t3Turns(4, 1100), t3A(1500, 'm1500', null), ...t3Turns(7, 1600)], [[2150, 0, 'expand']]));
    expect(W(g.buildWindows(fam))).toEqual([['measured', 1000, 2100, false, 10, 0]]);
  });

  it('chosen: a window whose ending row has no ts is unmeasured, whether that row is turn 11\'s first or the next main boundary', async () => {
    const g = await t3Gate();
    const a = t3Family(turnStore([t3B(1000), t3S(1001), ...t3Turns(10, 1100), t3A(null, 'm11'), t3A(2200, 'm12')]));
    expect(W(g.buildWindows(a))).toEqual([['unmeasured', 1000, null, false, 0, 0]]);
    const b = t3Family(turnStore([t3B(1000), t3S(1001), ...t3Turns(2, 1100), t3B(null), t3S(null), t3A(1300, 'm1300')]));
    expect(b.boundaries[0]!.copies[0]!, 'CONTROL: the next boundary is seen, untimed').toMatchObject({ next_boundary_line: 5, next_boundary_ts_ms: null });
    expect(W(g.buildWindows(b))).toEqual([['unmeasured', 1000, null, false, 0, 0]]);
  });

  it('chosen: a boundary with no summary of its own, whose summary search lands past the next main boundary, is unmeasured, never a 0-turn window running to that boundary', async () => {
    const g = await t3Gate();
    // B1 (line 1) has no summary; its twelve turns run 1100 to 2200; B2 (line 14) at 3000 has its summary (line 15). W1's
    // search gives B1 the summary at line 15, past line 14, so its rows are empty. A call at 2150, after turn 11's first
    // row (2100), lies outside any first-K-turns window, and a window that ran to B2 would count it.
    const fam = t3Family(turnStore([t3B(1000), ...t3Turns(12, 1100), t3B(3000), t3S(3001), t3A(3100, 'm3100')], [[2150, 0, 'expand']]));
    expect(fam.boundaries[0]!.copies[0]!, 'CONTROL: B1 reads B2\'s summary, past B2').toMatchObject({ summary_line: 15, next_boundary_line: 14, next_boundary_ts_ms: 3000, truncated: false });
    expect(fam.boundaries[0]!.copies[0]!.rows, 'CONTROL: so its rows are empty').toHaveLength(0);
    const ws = g.buildWindows(fam);
    expect(W(ws)).toEqual([['unmeasured', 1000, null, false, 0, 0], ['measured', 3000, 3100, true, 1, 0]]);
    expect(g.windowTotals(ws)).toEqual({ windows: 1, with_call: 0, calls: 0, turns: 1, unmeasured: 1 });
  });

  it('turnKey is msg_id, then request_id, then uuid; consecutive rows with one key are one turn', async () => {
    const g = await t3Gate();
    expect(g.turnKey([1, 1, 'm', 'r', 'u', null])).toBe('m');
    expect(g.turnKey([1, 1, null, 'r', 'u', null])).toBe('r');
    expect(g.turnKey([1, 1, null, null, 'u', null])).toBe('u');
    expect(g.turnsOf([[1, 1, null, 'r', 'u1', null], [2, 2, null, 'r', 'u2', null], [3, 3, null, null, 'u3', null]]).map((t) => t.key)).toEqual(['r', 'u3']);
  });

  it('copy rules: the window copy has the greatest after_count and ties go to pickHoldingCopy (live, then the smaller file_id); the producer copy is pickHoldingCopy over all', async () => {
    const g = await t3Gate();
    const c = (file_id: number, source_key: string, after_count: number): T3Copy => ({ file_id, source_key, boundary_line: 1, after_count,
      summary_line: null, next_boundary_line: null, next_boundary_ts_ms: null, last_ts_ms: 1, rows: [], models: [], truncated: false });
    expect(g.windowCopyOf([c(1, 'seg-1', 5), c(2, '', 5), c(3, '', 3)])?.file_id, 'a tie: the live copy').toBe(2);
    expect(g.windowCopyOf([c(4, '', 1), c(3, '', 1)])?.file_id, 'a tie of live copies: the smaller file_id').toBe(3);
    expect(g.windowCopyOf([c(1, '', 2), c(2, 'seg-1', 9)])?.file_id, 'the longest, though retired').toBe(2);
    expect(g.producerCopyOf([c(1, 'seg-1', 9), c(3, '', 1), c(2, '', 0)])?.file_id, 'live, then the smaller file_id, whatever the length').toBe(2);
    expect(g.windowCopyOf([])).toBeNull();
    expect(g.producerCopyOf([])).toBeNull();
  });

  it('no timed row, no copy, a family not found: an unmeasured window or none, never a guessed end', async () => {
    const g = await t3Gate();
    const untimed: T3Copy = { file_id: 1, source_key: '', boundary_line: 1, after_count: 0, summary_line: null, next_boundary_line: null,
      next_boundary_ts_ms: null, last_ts_ms: null, rows: [], models: [], truncated: false };
    const w = g.windowOf({ boundary_uuid: 'u-1', ts_ms: 1000, copies: [untimed] }, [[1000, 0, 'expand']]);
    expect(w).toEqual({ boundary_uuid: 'u-1', ts_ms: 1000, producer: 'unknown', state: 'unmeasured', start_ms: 1000, end_ms: null,
      end_inclusive: false, turns: 0, calls: 0, with_call: false });
    expect(g.windowOf({ boundary_uuid: 'u-2', ts_ms: 1000, copies: [] }, []).state).toBe('unmeasured');
    expect(g.buildWindows({ ccrc_id: T3_ID, generation: T3_GEN, found: false, merged_generations: [], calls: [], boundaries: [] })).toEqual([]);
    expect(g.windowTotals([w])).toEqual({ windows: 0, with_call: 0, calls: 0, turns: 0, unmeasured: 1 });
  });

  // Fix round 1 (review of Task 3; D-5770): W2-D14 rules in windowOf that no case above held.
  it('fix round 1: a copy the row cap cut AFTER turn 11\'s first row was seen is measured, ending exclusive at that row', async () => {
    const g = await t3Gate();
    // 12 turns of one row each (1100..2200), cap 11: rows hold turns 1..11, so truncated is true and turn 11 (2100) is seen.
    const fam = t3Family(turnStore([t3B(1000), t3S(1001), ...t3Turns(12, 1100)], [[2050, 0, 'expand'], [2100, 0, 'expand']]), 11);
    const copy = fam.boundaries[0]!.copies[0]!;
    expect(copy, 'CONTROL: cut at 11 rows, no next boundary').toMatchObject({ truncated: true, next_boundary_line: null });
    expect(copy.rows).toHaveLength(11);
    expect(W(g.buildWindows(fam))).toEqual([['measured', 1000, 2100, false, 10, 1]]);
  });

  it('fix round 1: a window opens INCLUSIVE at the boundary\'s ts_ms: a call at exactly that ts is counted, one a millisecond earlier is not', async () => {
    const g = await t3Gate();
    const fam = t3Family(turnStore([t3B(1000), t3S(1001), ...t3Turns(3, 1100)], [[999, 0, 'expand'], [1000, 0, 'expand']]));
    expect(fam.calls.map((c) => c[0]), 'CONTROL: both calls reach Node').toEqual([999, 1000]);
    expect(W(g.buildWindows(fam))).toEqual([['measured', 1000, 1300, true, 3, 1]]);
  });

  it('fix round 1: with no turn 11 and no next boundary the end is INCLUSIVE at the copy\'s last timed row: a call at exactly that ts is counted, one a millisecond later is not', async () => {
    const g = await t3Gate();
    const fam = t3Family(turnStore([t3B(1000), t3S(1001), ...t3Turns(3, 1100)], [[1300, 0, 'expand'], [1301, 0, 'expand']]));
    expect(fam.boundaries[0]!.copies[0]!, 'CONTROL: last timed row 1300, nothing after').toMatchObject({ last_ts_ms: 1300, next_boundary_line: null, truncated: false });
    expect(W(g.buildWindows(fam))).toEqual([['measured', 1000, 1300, true, 3, 1]]);
  });

  it('fix round 1: a family that is not found yields no window, though its report still carries a boundary', async () => {
    const g = await t3Gate();
    const fam = t3Family(turnStore([t3B(1000), t3S(1001), ...t3Turns(3, 1100)], [[1100, 0, 'expand']]));
    expect(g.buildWindows(fam), 'CONTROL: found, it yields a window').toHaveLength(1);
    expect(g.buildWindows({ ...fam, found: false })).toEqual([]);
  });

  it('fix round 1: exactly K turns and nothing after is measured, inclusive at the last row; exactly K+1 turns ends exclusive at turn 11\'s first row', async () => {
    const g = await t3Gate();
    const exactlyK = t3Family(turnStore([t3B(1000), t3S(1001), ...t3Turns(10, 1100)], [[2000, 0, 'expand']]));
    expect(W(g.buildWindows(exactlyK))).toEqual([['measured', 1000, 2000, true, 10, 1]]);
    const kPlus1 = t3Family(turnStore([t3B(1000), t3S(1001), ...t3Turns(11, 1100)], [[2000, 0, 'expand'], [2100, 0, 'expand']]));
    expect(W(g.buildWindows(kPlus1))).toEqual([['measured', 1000, 2100, false, 10, 1]]);
  });

  it('splitAtFirstExit8: the calls up to and including the first exit 8, and the rest apart (spec 10.2:2722, :2728)', async () => {
    const g = await t3Gate();
    const lib = await import('../../ccd/history/lib.mjs');
    const r8 = lib.EXIT.RECALL_OFF;
    expect(r8).toBe(8);
    expect(g.splitAtFirstExit8([[1, 0, 'grep'], [2, r8, 'expand'], [3, r8, 'grep'], [4, 0, 'grep']]))
      .toEqual({ upTo: [[1, 0, 'grep'], [2, r8, 'expand']], after: [[3, r8, 'grep'], [4, 0, 'grep']] });
    expect(g.splitAtFirstExit8([[1, 0, 'grep']])).toEqual({ upTo: [[1, 0, 'grep']], after: [] });
    expect(g.splitAtFirstExit8([])).toEqual({ upTo: [], after: [] });
  });

  it('RA-10 parity: producerOfBoundary over the script\'s output equals derive\'s producerOfCopy over holdingCopyOf\'s copy, and both read one file', async () => {
    const g = await t3Gate();
    const planted = plantedStore();
    const p1 = turnStore(T3_P1());
    const p2 = turnStore(T3_P2());
    const p3 = turnStore(T3_P3(), [], T3_P3_COPIES);
    const cases: Array<[string, string, T3Family]> = [['planted', planted.db, t3Planted(planted, g.ROW_CAP)], ['P1', p1.db, t3Family(p1)],
      ['P2', p2.db, t3Family(p2, 2)], ['P3', p3.db, t3Family(p3)]];
    const seen: string[] = [];
    for (const [name, db, fam] of cases) {
      for (const b of fam.boundaries) {
        const d = await t3DeriveProducer(db, b.boundary_uuid);
        expect(g.producerOfBoundary(b.copies), `${name} ${b.boundary_uuid}`).toBe(d.producer);
        expect(g.producerCopyOf(b.copies)?.file_id, `${name} ${b.boundary_uuid}`).toBe(d.fileId);
        seen.push(`${name}:${d.producer}`);
      }
    }
    expect(seen, 'CONTROL: every backend word is exercised').toEqual(['planted:unknown', 'planted:unknown', 'P1:anthropic', 'P1:anthropic', 'P2:other', 'P3:unknown']);
  });

  it('producer CONTROL: the witness after the next main boundary (P1) and past the row cap (P2) is read; a script whose models stop at its rows loses both', async () => {
    const g = await t3Gate();
    const src = readFileSync(SCRIPT, 'utf8');
    const MAIN = "if __name__ == '__main__':";
    expect(src.split(MAIN).length - 1, 'one entry guard to plant the mutant above').toBe(1);
    const mutant = path.join(mkTmp('ccrc-measure-history-t3-mutant-'), 'measure-history.py');
    writeFileSync(mutant, src.replace(MAIN, [
      '_t3_copy_record = copy_record',
      '',
      '',
      'def copy_record(*a, **kw):   # the mutant: a copy\'s models read from its capped rows, which stop at the next main boundary',
      '    c = _t3_copy_record(*a, **kw)',
      "    c['models'] = list(dict.fromkeys(r[5] for r in c['rows']))",
      '    return c',
      '',
      '',
      MAIN,
    ].join('\n')));
    const p1 = turnStore(T3_P1());
    const p2 = turnStore(T3_P2());
    const real1 = t3Family(p1).boundaries[0]!.copies[0]!;
    const real2 = t3Family(p2, 2).boundaries[0]!.copies[0]!;
    expect(real1.rows.map((r) => r[5]), 'CONTROL: no witness before the next boundary').toEqual([null, '<synthetic>']);
    expect(real1.models).toEqual([null, '<synthetic>', 'claude-fixture-a']);
    expect(real2.rows.map((r) => r[5]), 'CONTROL: no witness under the cap').toEqual([null, null]);
    expect(real2).toMatchObject({ truncated: true, models: [null, 'other-fixture-b'] });
    expect([g.producerOfBoundary([real1]), g.producerOfBoundary([real2])]).toEqual(['anthropic', 'other']);
    const mut1 = t3Family(p1, 400, mutant).boundaries[0]!.copies[0]!;
    const mut2 = t3Family(p2, 2, mutant).boundaries[0]!.copies[0]!;
    expect([g.producerOfBoundary([mut1]), g.producerOfBoundary([mut2])], 'the mutant script loses both witnesses').toEqual(['unknown', 'unknown']);
  });

  it('copy rules disagree (D-5771): on planted B1 the window reads the longest copy and the producer pickHoldingCopy\'s; on P3 the window reads a longer retired copy', async () => {
    const g = await t3Gate();
    const f = plantedStore();
    const fam = t3Planted(f, g.ROW_CAP);
    const b1 = fam.boundaries.find((b) => b.boundary_uuid === f.b1)!;
    expect(b1.copies.map((c) => c.after_count).sort((x, y) => x - y), 'CONTROL: two live copies hold B1').toEqual([1, 22]);
    const win = g.windowCopyOf(b1.copies)!;
    const prod = g.producerCopyOf(b1.copies)!;
    expect([win.after_count, prod.after_count]).toEqual([22, 1]);
    expect(prod.file_id, 'both live, so pickHoldingCopy takes the smaller file_id').toBeLessThan(win.file_id);
    expect(W([g.windowOf(b1, fam.calls)])).toEqual([['measured', 2000, 4000, false, 10, 3]]);
    const p3 = t3Family(turnStore(T3_P3(), [], T3_P3_COPIES)).boundaries[0]!;
    expect(g.windowCopyOf(p3.copies)?.source_key, 'the longest copy, though retired').toBe('seg-1');
    expect(g.producerCopyOf(p3.copies)?.source_key, 'the live copy').toBe('');
    expect(W([g.windowOf(p3, [])])).toEqual([['measured', 1000, 1200, true, 2, 0]]);
    expect(g.producerOfBoundary(p3.copies)).toBe('unknown');
  });

  // ── Final fix wave, item E: a family without a boolean `found` is no family report ──
  it('final E: buildWindows throws a TypeError unless found is a boolean; found:false still answers []', async () => {
    const g = await t3Gate();
    // Task 4's census rows carry no `found`: a W2-5a assembler that passed one in would read zero windows for every family.
    const censusShaped = { ccrc_id: T3_ID, generation: T3_GEN, session_pk: 1, first_seen_ms: 1, last_main_ts_ms: 1, merged_into: null,
      calls: [], boundaries: [] } as unknown as T3Family;
    expect(() => g.buildWindows(censusShaped)).toThrow(TypeError);
    for (const found of [undefined, null, 0, 1, 'true', 'false', {}]) {
      expect(() => g.buildWindows({ ...censusShaped, found } as unknown as T3Family), String(found)).toThrow(/found/);
    }
    expect(g.buildWindows({ ...censusShaped, found: false } as unknown as T3Family), 'CONTROL: found:false is a family the store lacks').toEqual([]);
    expect(g.buildWindows({ ...censusShaped, found: true } as unknown as T3Family), 'CONTROL: found:true with no boundary has no window').toEqual([]);
  });
});

// ── W2-3 Task 4: the census and the active rule (W2-D13 census mode, W2-D20; D-5773 (history-w2-legacy-families-excluded)) ──
// measure-history.py --census emits every sessions row of one store, merged ones included, with its sessions columns,
// its last main entry before --as-of and Task 1's raw rows over [--since, --as-of); it decides nothing.
// history-gate.mjs's activeFamilies applies W2-D20: (a) unmerged with a UUID generation (legacy '' excluded, fixed:
// D-5773); (b) the id's newest unmerged family in recall.mjs's NEWEST_FAMILY_SQL order, spelled in the gate as
// newestFamilyCompare and held equal to recall's by the parity case below; (c) a main entry in
// [as_of - look-back, as_of). Fixture HOMEs only; every id, generation and session uuid is synthetic.
describe('W2-3 Task 4: the census and the active rule', () => {
  const C_AS_OF = 1_800_000_000_000;
  const C_LOOK = 604_800_000;
  const C_SINCE = C_AS_OF - 2 * C_LOOK;
  const C_HOUR = 3_600_000;
  const STORE = '5f0c2d3e-8a1b-4c2d-9e3f-0a1b2c3d4e5f';
  const CG = (n: string): string => `0189abcd-1234-5678-9abc-0123456789${n}`;
  type CallRow = [number, number, string];
  interface CensusFamily {
    ccrc_id: string; generation: string; session_pk: number; merged_into: number | null; first_seen_ms: number;
    last_main_ts_ms: number | null; merged_generations: string[]; calls: CallRow[]; boundaries: unknown[];
  }
  interface Census {
    as_of_ms: number; since_ms: number; row_cap: number;
    ticks: { n: number; first_ts_ms: number | null; last_ts_ms: number | null }; families: CensusFamily[];
  }
  type ReportC = Report & { census: Census | null };
  interface FamilyRef { store_id: string; ccrc_id: string; generation: string }
  interface GateT4 {
    ACTIVE_LOOKBACK_MS: number;
    ACTIVE_EXCLUSIONS: readonly string[];
    newestFamilyCompare(a: CensusFamily, b: CensusFamily): number;
    newestFamilyOf(families: CensusFamily[], ccrcId: string): CensusFamily | null;
    activeFamilies(storeId: string, census: Census, opts?: { lookbackMs?: number }):
      { active: FamilyRef[]; excluded: Array<FamilyRef & { reason: string }> };
  }
  const gateT4 = async (): Promise<GateT4> => (await import('../../deploy/history-gate.mjs')) as unknown as GateT4;
  type Pk = 'tieA' | 'tieB' | 'rekey' | 'rekeyLegacy' | 'legacy' | 'legacyOld' | 'stale' | 'edgeIn' | 'edgeOut' | 'empty';
  interface CensusPlanted { db: string; storeId: string; pk: Record<Pk, number> }

  /** A store createStore made, holding ten sessions rows whose census rows and verdicts are worked out by hand below. */
  function censusStore(): CensusPlanted {
    const home = mkTmp('ccrc-measure-history-census-');
    const { storeId } = createStore(home);
    const dbPath = path.join(home, '.ccrc', 'history', 'db', 'history.db');
    const db = new DatabaseSync(dbPath);
    const pk = {} as Record<Pk, number>;
    try {
      for (const t of ['counters', 'ticks', 'recall_calls']) db.exec(`DELETE FROM ${t}`);
      const ins = (sql: string, ...p: Array<string | number | null | Uint8Array>): number => Number(db.prepare(sql).run(...p).lastInsertRowid);
      const blob = ins("INSERT INTO blobs (sha256, codec, z, raw_len) VALUES (?, 'br5', NULL, 0)",
        createHash('sha256').update('measure-history census fixture').digest());
      const family = (id: string, gen: string, firstSeen: number, merged: number | null = null): number =>
        ins('INSERT INTO sessions (ccrc_id, generation, project, first_seen_ms, merged_into) VALUES (?, ?, ?, ?, ?)', id, gen, 'demo', firstSeen, merged);
      let u = 0;
      /** An epoch of `sessionPk`, confirmed unless `confirmed` is null; answers its cc_session_uuid. */
      const epoch = (sessionPk: number, seq: number, confirmed: number | null = 1): string => {
        u += 1;
        const uuid = `11111111-2222-4333-8444-${String(u).padStart(12, '0')}`;
        ins("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, confirmed_ms) VALUES (?, ?, ?, 'startup', 'hook', ?)",
          sessionPk, seq, uuid, confirmed);
        return uuid;
      };
      const transcript = (uuid: string, agent = ''): number => ins('INSERT INTO transcripts (cc_session_uuid, agent_id) VALUES (?, ?)', uuid, agent);
      let n = 0;
      const entry = (tpk: number, ts: number): void => {
        n += 1;
        ins('INSERT INTO entries (uuid, transcript_pk, type, ts_ms, is_compact_summary, provenance, prov_version, '
          + "struct_rank_ns, struct_file_id, blob_id) VALUES (?, ?, 'assistant', ?, 0, 'harness', 1, 1, 1, ?)", `c-${n}`, tpk, ts, blob);
      };
      /** A confirmed epoch of `sessionPk` whose main transcript holds entries at `ts`; answers its cc_session_uuid. */
      const main = (sessionPk: number, ...ts: number[]): string => {
        const uuid = epoch(sessionPk, 1);
        const t = transcript(uuid);
        for (const x of ts) entry(t, x);
        return uuid;
      };

      // demo-tie: two unmerged UUID families tied on first_seen_ms; NEWEST_FAMILY_SQL answers the greater session_pk.
      pk.tieA = family('demo-tie', CG('b1'), 5000); main(pk.tieA, C_AS_OF - C_HOUR);
      pk.tieB = family('demo-tie', CG('b2'), 5000); main(pk.tieB, C_AS_OF - C_HOUR);
      // demo-rekey: a UUID family and the '' row a re-key merged into it. The merged row is NEWER by first_seen_ms,
      // so an order that let merged rows take part would answer it (recall's merged_into IS NULL keeps it out).
      pk.rekey = family('demo-rekey', CG('b3'), 6000); main(pk.rekey, C_AS_OF - 2 * C_HOUR);
      pk.rekeyLegacy = family('demo-rekey', '', 7000, pk.rekey);
      // demo-legacy: an unmerged legacy '' family, newest of its id and recent, beside an older recent UUID family.
      pk.legacy = family('demo-legacy', '', 9000); main(pk.legacy, C_AS_OF - C_HOUR);
      pk.legacyOld = family('demo-legacy', CG('b4'), 4000); main(pk.legacyOld, C_AS_OF - C_HOUR);
      // demo-stale: its one confirmed main entry is 1 ms before the look-back. A subagent transcript of that epoch
      // and the main transcript of an UNCONFIRMED epoch each hold an entry an hour before as_of; neither counts.
      pk.stale = family('demo-stale', CG('b5'), 1000);
      const staleUuid = main(pk.stale, C_AS_OF - C_LOOK - 1);
      entry(transcript(staleUuid, 'agent-1'), C_AS_OF - C_HOUR);
      entry(transcript(epoch(pk.stale, 2, null)), C_AS_OF - C_HOUR);
      // The look-back's edges: an entry at exactly as_of - look-back is in; one at exactly as_of is not read at all.
      pk.edgeIn = family('demo-edge-in', CG('b6'), 1000); main(pk.edgeIn, C_AS_OF - C_LOOK);
      pk.edgeOut = family('demo-edge-out', CG('b7'), 1000); main(pk.edgeOut, C_AS_OF - C_LOOK - 10, C_AS_OF);
      // demo-empty: no epoch at all.
      pk.empty = family('demo-empty', CG('b8'), 1000);

      const call = (key: string, gen: string, ts: number, verb: string, rc: number, arm: string | null): void => {
        ins('INSERT INTO recall_calls (event_key, ccrc_id, generation, ts_ms, verb, rc, ms, arm) VALUES (?, ?, ?, ?, ?, ?, 40, ?)',
          key, 'demo-tie', gen, ts, verb, rc, arm);
      };
      call('c1', CG('b2'), C_SINCE - 1, 'expand', 0, null);   // before --since
      call('c2', CG('b2'), C_SINCE, 'expand', 0, null);       // at --since: in
      call('c3', CG('b2'), C_AS_OF - 2, 'grep', 0, 'quiz');   // a replay arm's: never a live row
      call('c4', CG('b2'), C_AS_OF - 1, 'grep', 8, null);     // in, rc as recorded
      call('c5', CG('b2'), C_AS_OF, 'expand', 0, null);       // at --as-of: out
      for (const ts of [C_SINCE - 1, C_SINCE, C_AS_OF - 60_000, C_AS_OF]) {
        ins('INSERT INTO ticks (ts_ms, lag_ms, bytes, files_behind, bytes_behind) VALUES (?, 5, 0, 0, 0)', ts);
      }
    } finally {
      db.close();
    }
    return { db: dbPath, storeId, pk };
  }

  const censusArgs = (db: string, asOf = C_AS_OF, since = C_SINCE): string[] =>
    ['--db', db, '--now', String(NOW), '--census', '--as-of', String(asOf), '--since', String(since), '--row-cap', '400'];
  const censusOf = (db: string, asOf = C_AS_OF, since = C_SINCE): Census => {
    const rep = report(censusArgs(db, asOf, since)) as unknown as ReportC;
    expect(rep.census, 'census mode reported no census').not.toBeNull();
    return rep.census!;
  };

  /** A census row for the pure cases: a recent, unmerged UUID family unless `o` says otherwise. */
  const fam = (o: Partial<CensusFamily> & Pick<CensusFamily, 'ccrc_id' | 'session_pk'>): CensusFamily => ({
    generation: CG('c1'), merged_into: null, first_seen_ms: 1000, last_main_ts_ms: C_AS_OF - C_HOUR,
    merged_generations: [], calls: [], boundaries: [], ...o,
  });
  const pure = (families: CensusFamily[]): Census => ({
    as_of_ms: C_AS_OF, since_ms: C_SINCE, row_cap: 400, ticks: { n: 0, first_ts_ms: null, last_ts_ms: null }, families,
  });
  /** The one reason (id, gen) is excluded for, or null when it is active; it is never in both lists, nor twice. */
  const reasonOf = (g: GateT4, c: Census, id: string, gen: string): string | null => {
    const r = g.activeFamilies(STORE, c);
    const on = r.active.filter((f) => f.ccrc_id === id && f.generation === gen);
    const off = r.excluded.filter((f) => f.ccrc_id === id && f.generation === gen);
    expect(on.length + off.length, `${id}/${gen} is reported exactly once`).toBe(1);
    return off.length === 1 ? off[0]!.reason : null;
  };

  it('census: every sessions row, merged ones included, with its sessions columns and its last main entry before as_of', () => {
    const s = censusStore();
    const c = censusOf(s.db);
    expect(c.families.map((f) => [f.ccrc_id, f.generation, f.session_pk, f.merged_into, f.first_seen_ms, f.last_main_ts_ms])).toEqual([
      ['demo-tie', CG('b1'), s.pk.tieA, null, 5000, C_AS_OF - C_HOUR],
      ['demo-tie', CG('b2'), s.pk.tieB, null, 5000, C_AS_OF - C_HOUR],
      ['demo-rekey', CG('b3'), s.pk.rekey, null, 6000, C_AS_OF - 2 * C_HOUR],
      ['demo-rekey', '', s.pk.rekeyLegacy, s.pk.rekey, 7000, null],
      ['demo-legacy', '', s.pk.legacy, null, 9000, C_AS_OF - C_HOUR],
      ['demo-legacy', CG('b4'), s.pk.legacyOld, null, 4000, C_AS_OF - C_HOUR],
      ['demo-stale', CG('b5'), s.pk.stale, null, 1000, C_AS_OF - C_LOOK - 1],   // not the subagent's, not the unconfirmed epoch's
      ['demo-edge-in', CG('b6'), s.pk.edgeIn, null, 1000, C_AS_OF - C_LOOK],
      ['demo-edge-out', CG('b7'), s.pk.edgeOut, null, 1000, C_AS_OF - C_LOOK - 10],   // the entry at as_of is not read
      ['demo-empty', CG('b8'), s.pk.empty, null, 1000, null],
    ]);
    expect(Object.keys(c.families[0]!)).toEqual(['ccrc_id', 'generation', 'session_pk', 'merged_into', 'first_seen_ms',
      'last_main_ts_ms', 'merged_generations', 'calls', 'boundaries']);
    expect(c.families.map((f) => f.merged_generations)).toEqual([[], [], [''], [], [], [], [], [], [], []]);
    expect(c.families.flatMap((f) => f.boundaries), 'the fixture plants no boundary').toEqual([]);
  });

  it('census: calls are the raw rows from since to before as_of, the arm row absent', () => {
    const s = censusStore();
    const c = censusOf(s.db);
    // c1 (since - 1) and c5 (as_of) lie outside; c3 is a replay arm's (arm 'quiz'); c2 and c4 stand, rc as recorded.
    expect(c.families.find((f) => f.session_pk === s.pk.tieB)!.calls).toEqual([[C_SINCE, 0, 'expand'], [C_AS_OF - 1, 8, 'grep']]);
    expect(c.families.filter((f) => f.session_pk !== s.pk.tieB).flatMap((f) => f.calls)).toEqual([]);
  });

  it('census: the ticks summary counts ticks from since to before as_of', () => {
    const c = censusOf(censusStore().db);
    expect({ as_of_ms: c.as_of_ms, since_ms: c.since_ms, row_cap: c.row_cap }).toEqual({ as_of_ms: C_AS_OF, since_ms: C_SINCE, row_cap: 400 });
    expect(c.ticks).toEqual({ n: 2, first_ts_ms: C_SINCE, last_ts_ms: C_AS_OF - 60_000 });
    // The O52 store's ticks all lie near NOW, far outside [1500, 6000): n 0 with null ends.
    expect(censusOf(plantedStore().db, 6000, 1500).ticks).toEqual({ n: 0, first_ts_ms: null, last_ts_ms: null });
  });

  it('census over the O52 store: each family carries the families mode raw rows, calls cut at as_of', () => {
    const f = plantedStore();
    const rep = report(censusArgs(f.db, 6000, 1500)) as unknown as ReportC;
    expect(rep.w2, 'census mode leaves w2 null').toBeNull();
    const c = rep.census!;
    // Every sessions row of THIS store, whatever the families file says: demo-b is listed there under another store.
    expect(c.families.map((x) => [x.ccrc_id, x.generation, x.merged_into === null ? 'live' : 'merged'])).toEqual([
      ['demo-a', G1, 'live'], ['demo-a', '', 'merged'], ['demo-b', G2, 'live']]);
    const g1 = c.families.find((x) => x.ccrc_id === 'demo-a' && x.generation === G1)!;
    expect(c.families.find((x) => x.generation === '')!.merged_into).toBe(g1.session_pk);
    interface W2Family { ccrc_id: string; generation: string; merged_generations: string[]; calls: CallRow[]; boundaries: unknown[] }
    const w2 = (report(['--db', f.db, '--now', String(NOW), '--families', f.families, '--window-start', '1500', '--window-end', '6000',
      '--row-cap', '400']).w2 as unknown as { families: W2Family[] }).families.find((x) => x.ccrc_id === 'demo-a' && x.generation === G1)!;
    expect(g1.boundaries, 'B1 (2000) and B2 (5000) lie in [1500, 6000); B3 (7000) does not').toHaveLength(2);
    expect(g1.boundaries).toEqual(w2.boundaries);
    expect(g1.merged_generations).toEqual(w2.merged_generations);
    expect(g1.calls).toEqual(w2.calls.filter((r) => r[0] < 6000));
    expect(g1.calls.length).toBeGreaterThan(0);
    expect(g1.calls.map((r) => r[0]), "k5 (2600) is a replay arm's call").not.toContain(2600);
  });

  it('census: null without the census flag, and its key follows w2', () => {
    const f = plantedStore();
    expect((report(['--db', f.db, '--now', String(NOW)]) as unknown as ReportC).census).toBeNull();
    expect((report(['--db', f.db, '--now', String(NOW), '--families', f.families, '--window-start', '1500', '--window-end', '6000',
      '--row-cap', '400']) as unknown as ReportC).census).toBeNull();
    expect(Object.keys(report(censusArgs(f.db, 6000, 1500)))).toEqual(['store_id', 'user_version', 'script_sha256', 'counters',
      'w1b_lag_p95_ms', 'w1c_duplicate_entries', 'w1e', 'w1f_grep_p95_ms', 'w2', 'census']);
  });

  it.each(['--as-of', '--since', '--row-cap'])('census refusals: each required flag missing exits 2, here %s', (flag) => {
    const f = plantedStore();
    const args = censusArgs(f.db, 6000, 1500);
    args.splice(args.indexOf(flag), 2);
    const r = measure(args);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--census needs --as-of, --since and --row-cap');
    expect(r.stdout).toBe('');
  });

  it('census refusals: census mode beside families mode exits 2', () => {
    const f = plantedStore();
    const r = measure([...censusArgs(f.db, 6000, 1500), '--families', f.families, '--window-start', '1500', '--window-end', '6000']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--census and --families are exclusive');
    expect(r.stdout).toBe('');
  });

  it('census: the store bytes are unchanged by a census run', () => {
    for (const [db, asOf, since] of [[plantedStore().db, 6000, 1500], [censusStore().db, C_AS_OF, C_SINCE]] as const) {
      const sha = (): string => createHash('sha256').update(readFileSync(db)).digest('hex');
      const before = sha();
      censusOf(db, asOf, since);
      expect(sha(), db).toBe(before);
    }
  });

  it('census: one read snapshot, a sessions row a writer commits mid-census is not in it', () => {
    const s = censusStore();
    // census_report over the real read-only connection, wrapped so that a second connection commits a new sessions
    // row right after the census's FIRST read (the ticks summary). The census must not see it.
    const RACE = [
      'import importlib.util, json, sqlite3, sys',
      "spec = importlib.util.spec_from_file_location('mh', sys.argv[1]); mh = importlib.util.module_from_spec(spec); spec.loader.exec_module(mh)",
      'ro = mh.open_db(sys.argv[2])',
      'rw = sqlite3.connect(sys.argv[2])',
      'class Racing:',
      '    def __init__(self, c):',
      '        self.c, self.reads = c, 0',
      '    def __getattr__(self, k):',
      '        return getattr(self.c, k)',
      '    def execute(self, sql, *a):',
      '        cur = self.c.execute(sql, *a)',
      "        if sql.lstrip()[:6].upper() == 'SELECT':",
      '            self.reads += 1',
      '            if self.reads == 1:',
      "                rw.execute(\"INSERT INTO sessions (ccrc_id, generation, project, first_seen_ms) VALUES ('demo-late', '', 'demo', 1)\")",
      '                rw.commit()',
      '        return cur',
      'r = mh.census_report(Racing(ro), int(sys.argv[3]), int(sys.argv[4]), 400)',
      "print(json.dumps([f['ccrc_id'] for f in r['families']]))",
    ].join('\n');
    const r = spawnSync('python3', [...PY_ISOLATED, '-c', RACE, SCRIPT, s.db, String(C_AS_OF), String(C_SINCE)],
      { encoding: 'utf8', env: { ...scrubbedEnv(process.env), PYTHONDONTWRITEBYTECODE: '1' }, timeout: 60_000 });
    expect(r.status, r.stderr).toBe(0);
    const ids = JSON.parse(r.stdout) as string[];
    expect(ids).toHaveLength(10);
    expect(ids).not.toContain('demo-late');
    expect(censusOf(s.db).families.map((f) => f.ccrc_id), 'CONTROL: the writer committed, and the next census sees it').toContain('demo-late');
  });

  it('active rule: three active families, every other one excluded with exactly one reason', async () => {
    const g = await gateT4();
    const s = censusStore();
    const r = g.activeFamilies(s.storeId, censusOf(s.db));
    const ref = (ccrc_id: string, generation: string): FamilyRef => ({ store_id: s.storeId, ccrc_id, generation });
    // Sorted by familyKey: one store, so by ccrc_id, then generation ('' first).
    expect(r.active).toEqual([ref('demo-edge-in', CG('b6')), ref('demo-rekey', CG('b3')), ref('demo-tie', CG('b2'))]);
    expect(r.excluded).toEqual([
      { ...ref('demo-edge-out', CG('b7')), reason: 'no-recent-entry' },
      { ...ref('demo-empty', CG('b8')), reason: 'no-recent-entry' },
      { ...ref('demo-legacy', ''), reason: 'legacy' },
      { ...ref('demo-legacy', CG('b4')), reason: 'not-newest' },
      { ...ref('demo-rekey', ''), reason: 'merged' },
      { ...ref('demo-stale', CG('b5')), reason: 'no-recent-entry' },
      { ...ref('demo-tie', CG('b1')), reason: 'not-newest' },
    ]);
    expect(new Set(r.excluded.map((x) => x.reason)), 'every reason is an ACTIVE_EXCLUSIONS word, and every word is reached')
      .toEqual(new Set(g.ACTIVE_EXCLUSIONS));
  });

  it('active rule: newest-family parity with recall familiesOf on a first_seen_ms tie', async () => {
    const g = await gateT4();
    const recall = (await import('../../ccd/history/recall.mjs')) as unknown as {
      familiesOf(db: unknown, sel: object): ReadonlyArray<{ sessionPk: number; generation: string }>;
    };
    const s = censusStore();
    const c = censusOf(s.db);
    expect(c.families.filter((f) => f.ccrc_id === 'demo-tie').map((f) => f.first_seen_ms), 'CONTROL: a tie on first_seen_ms')
      .toEqual([5000, 5000]);
    expect(c.families.filter((f) => f.ccrc_id === 'demo-rekey').map((f) => [f.first_seen_ms, f.merged_into === null]),
      'CONTROL: the merged row is the newer by first_seen_ms').toEqual([[6000, true], [7000, false]]);
    const db = new DatabaseSync(s.db, { readOnly: true });
    try {
      for (const id of [...new Set(c.families.map((f) => f.ccrc_id))]) {
        const own = recall.familiesOf(db, { kind: 'family', id, generation: null, project: null, workdir: null, workdirReal: null });
        expect(own, id).toHaveLength(1);
        const mine = g.newestFamilyOf(c.families, id);
        expect(mine === null ? null : [mine.session_pk, mine.generation], id).toEqual([own[0]!.sessionPk, own[0]!.generation]);
      }
    } finally {
      db.close();
    }
    expect(g.newestFamilyOf(c.families, 'demo-tie')!.session_pk, 'the tie goes to the greater session_pk').toBe(s.pk.tieB);
  });

  it('active rule: the look-back edges, an entry at as_of minus the look-back counts and one at as_of does not', async () => {
    const g = await gateT4();
    const at = (last: number | null): string | null =>
      reasonOf(g, pure([fam({ ccrc_id: 'demo-x', session_pk: 1, last_main_ts_ms: last })]), 'demo-x', CG('c1'));
    expect(at(C_AS_OF - C_LOOK)).toBeNull();
    expect(at(C_AS_OF - 1)).toBeNull();
    expect(at(C_AS_OF)).toBe('no-recent-entry');
    expect(at(C_AS_OF - C_LOOK - 1)).toBe('no-recent-entry');
    expect(at(null)).toBe('no-recent-entry');
    expect(g.ACTIVE_LOOKBACK_MS).toBe(7 * 86_400_000);
    const c = pure([fam({ ccrc_id: 'demo-x', session_pk: 1, last_main_ts_ms: C_AS_OF - 1000 })]);
    expect(g.activeFamilies(STORE, c, { lookbackMs: 1000 }).active).toHaveLength(1);
    expect(g.activeFamilies(STORE, c, { lookbackMs: 999 }).excluded.map((x) => x.reason)).toEqual(['no-recent-entry']);
  });

  it('active rule: legacy families are excluded legacy whatever their recency', async () => {
    const g = await gateT4();
    // The id's only row, so its newest, with an entry an hour before as_of: still legacy.
    expect(reasonOf(g, pure([fam({ ccrc_id: 'demo-x', session_pk: 1, generation: '' })]), 'demo-x', '')).toBe('legacy');
    expect(reasonOf(g, pure([fam({ ccrc_id: 'demo-x', session_pk: 1, generation: '', last_main_ts_ms: null })]), 'demo-x', '')).toBe('legacy');
    // A legacy row newer than its id's UUID row: recall answers the legacy row, so the UUID row is not the newest, and
    // the id has no active family.
    const both = pure([fam({ ccrc_id: 'demo-x', session_pk: 1, first_seen_ms: 1000 }), fam({ ccrc_id: 'demo-x', session_pk: 2, generation: '', first_seen_ms: 2000 })]);
    expect(reasonOf(g, both, 'demo-x', CG('c1'))).toBe('not-newest');
    expect(g.activeFamilies(STORE, both).active).toEqual([]);
  });

  it('active rule: one reason per family, in the order merged, legacy, not-newest, no-recent-entry', async () => {
    const g = await gateT4();
    const c = pure([
      fam({ ccrc_id: 'demo-x', session_pk: 1, generation: '', merged_into: 2, first_seen_ms: 9000, last_main_ts_ms: null }),
      fam({ ccrc_id: 'demo-x', session_pk: 2, first_seen_ms: 5000 }),
      fam({ ccrc_id: 'demo-y', session_pk: 3, generation: CG('c2'), merged_into: 4, last_main_ts_ms: null }),
      fam({ ccrc_id: 'demo-y', session_pk: 4, generation: CG('c3') }),
      fam({ ccrc_id: 'demo-z', session_pk: 5, generation: CG('c4'), first_seen_ms: 1000, last_main_ts_ms: null }),
      fam({ ccrc_id: 'demo-z', session_pk: 6, generation: CG('c5'), first_seen_ms: 2000, last_main_ts_ms: null }),
    ]);
    const r = g.activeFamilies(STORE, c);
    expect(r.active.length + r.excluded.length, 'each family is reported once').toBe(6);
    expect(reasonOf(g, c, 'demo-x', '')).toBe('merged');               // merged, legacy and without an entry: merged
    expect(reasonOf(g, c, 'demo-y', CG('c2'))).toBe('merged');         // a merged UUID row
    expect(reasonOf(g, c, 'demo-z', CG('c4'))).toBe('not-newest');     // not the newest and without an entry: not-newest
    expect(reasonOf(g, c, 'demo-z', CG('c5'))).toBe('no-recent-entry');
    expect(reasonOf(g, c, 'demo-x', CG('c1'))).toBeNull();
    expect(reasonOf(g, c, 'demo-y', CG('c3'))).toBeNull();
  });

  it('active rule: newestFamilyCompare orders by first_seen_ms then session_pk, both descending', async () => {
    const g = await gateT4();
    const a = fam({ ccrc_id: 'demo-x', session_pk: 1, first_seen_ms: 2000 });
    const b = fam({ ccrc_id: 'demo-x', session_pk: 2, first_seen_ms: 1000 });
    const c = fam({ ccrc_id: 'demo-x', session_pk: 3, first_seen_ms: 2000 });
    expect(g.newestFamilyCompare(a, b)).toBeLessThan(0);
    expect(g.newestFamilyCompare(b, a)).toBeGreaterThan(0);
    expect(g.newestFamilyCompare(c, a), 'a tie on first_seen_ms goes to the greater session_pk').toBeLessThan(0);
    expect(g.newestFamilyOf([a, b, c], 'demo-x')!.session_pk).toBe(3);
    expect(g.newestFamilyOf([c, a, b], 'demo-x')!.session_pk, 'whatever the input order').toBe(3);
    expect(g.newestFamilyOf([a, b], 'demo-y')).toBeNull();
    expect(g.newestFamilyOf([fam({ ccrc_id: 'demo-x', session_pk: 4, first_seen_ms: 9000, merged_into: 3 }), a], 'demo-x')!.session_pk).toBe(1);
    expect(g.newestFamilyOf([fam({ ccrc_id: 'demo-x', session_pk: 4, merged_into: 3 })], 'demo-x')).toBeNull();
  });

  it('active rule: refuses a census it cannot read rather than answering every family active', async () => {
    const g = await gateT4();
    const c = pure([fam({ ccrc_id: 'demo-x', session_pk: 1 })]);
    expect(() => g.activeFamilies(null as unknown as string, c)).toThrow(TypeError);
    expect(() => g.activeFamilies('', c)).toThrow(TypeError);
    const noAsOf: Partial<Census> = { ...c };
    delete noAsOf.as_of_ms;
    expect(() => g.activeFamilies(STORE, noAsOf as Census)).toThrow(TypeError);
    expect(() => g.activeFamilies(STORE, { ...c, families: undefined } as unknown as Census)).toThrow(TypeError);
    expect(() => g.activeFamilies(STORE, c, { lookbackMs: -1 })).toThrow(TypeError);
    expect(() => g.activeFamilies(STORE, c, { lookbackMs: 1.5 })).toThrow(TypeError);
    expect(g.activeFamilies(STORE, c).active, 'CONTROL: the same census, read whole, answers').toHaveLength(1);
  });

  // ── Edge pins (W2-3 Task 4 implementer): guards the cases above leave to a one-step move ──
  it('census edge: a row merged into a family counts toward the family\'s last main entry', () => {
    const s = censusStore();
    const db = new DatabaseSync(s.db);
    try {
      const uuid = '11111111-2222-4333-8444-99999999aa01';
      db.prepare("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, confirmed_ms) VALUES (?, 1, ?, 'startup', 'hook', 1)")
        .run(s.pk.rekeyLegacy, uuid);
      const tpk = Number(db.prepare("INSERT INTO transcripts (cc_session_uuid, agent_id) VALUES (?, '')").run(uuid).lastInsertRowid);
      const blob = Number((db.prepare('SELECT blob_id AS b FROM entries LIMIT 1').get() as { b: number }).b);
      db.prepare('INSERT INTO entries (uuid, transcript_pk, type, ts_ms, is_compact_summary, provenance, prov_version, '
        + "struct_rank_ns, struct_file_id, blob_id) VALUES ('c-edge-merged', ?, 'assistant', ?, 0, 'harness', 1, 1, 1, ?)").run(tpk, C_AS_OF - 1000, blob);
    } finally {
      db.close();
    }
    const c = censusOf(s.db);
    const last = (pk: number): number | null => c.families.find((f) => f.session_pk === pk)!.last_main_ts_ms;
    // The target's own entry is two hours old; the merged row's, planted above, is 1 s old: the target reads the later.
    expect(last(s.pk.rekey)).toBe(C_AS_OF - 1000);
    expect(last(s.pk.rekeyLegacy), 'the merged row reads its own epochs only').toBe(C_AS_OF - 1000);
    expect(last(s.pk.tieA), 'a family unrelated to the merge is unmoved').toBe(C_AS_OF - C_HOUR);
  });

  it('census edge: a connection already holding a read transaction is reused, not restarted', () => {
    const s = censusStore();
    const CALL = [
      'import importlib.util, json, sys',
      "spec = importlib.util.spec_from_file_location('mh', sys.argv[1]); mh = importlib.util.module_from_spec(spec); spec.loader.exec_module(mh)",
      'ro = mh.open_db(sys.argv[2])',
      "ro.execute('BEGIN')",
      'r = mh.census_report(ro, int(sys.argv[3]), int(sys.argv[4]), 400)',
      "print(json.dumps(len(r['families'])))",
    ].join('\n');
    const r = spawnSync('python3', [...PY_ISOLATED, '-c', CALL, SCRIPT, s.db, String(C_AS_OF), String(C_SINCE)],
      { encoding: 'utf8', env: { ...scrubbedEnv(process.env), PYTHONDONTWRITEBYTECODE: '1' }, timeout: 60_000 });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toBe(10);
  });

  it('census edge: --since after --as-of is not refused, it answers no ticks and no raw rows', () => {
    const c = censusOf(censusStore().db, C_SINCE, C_AS_OF);
    expect(c.ticks).toEqual({ n: 0, first_ts_ms: null, last_ts_ms: null });
    expect(c.families.flatMap((f) => f.calls)).toEqual([]);
    expect(c.families, 'every sessions row is still listed').toHaveLength(10);
  });

  it('census edge: --as-of and --since are read only with --census', () => {
    const f = plantedStore();
    const r = measure(['--db', f.db, '--now', String(NOW), '--as-of', '6000', '--since', '1500']);
    expect(r.code).toBe(0);
    expect((JSON.parse(r.stdout) as ReportC).census).toBeNull();
  });

  it('active rule edge: a look-back of 0 is whole, and excludes every family', async () => {
    const g = await gateT4();
    const c = pure([fam({ ccrc_id: 'demo-x', session_pk: 1, last_main_ts_ms: C_AS_OF - 1 })]);
    const r = g.activeFamilies(STORE, c, { lookbackMs: 0 });   // the default (7 days) would take it active
    expect(r.active).toEqual([]);
    expect(r.excluded.map((x) => x.reason)).toEqual(['no-recent-entry']);
  });

  it('active rule edge: refuses a store id that is not a UUID, an as_of_ms that is not an integer and a families list that is no list', async () => {
    const g = await gateT4();
    const c = pure([fam({ ccrc_id: 'demo-x', session_pk: 1 })]);
    expect(() => g.activeFamilies('not-a-store-id', c)).toThrow(TypeError);
    expect(() => g.activeFamilies(STORE, { ...c, as_of_ms: 1.5 })).toThrow(TypeError);
    // The message names the missing list: without the explicit check the loop over it throws a TypeError of its own.
    expect(() => g.activeFamilies(STORE, { ...c, families: {} } as unknown as Census)).toThrow(/no families list/);
    expect(() => g.activeFamilies(STORE, { ...c, as_of_ms: String(C_AS_OF) as unknown as number })).toThrow(TypeError);
  });

  // Fix round 1 (Task 4 review).
  it('active rule edge: a store id that is not a string is refused, though it reads as a UUID', async () => {
    const g = await gateT4();
    const c = pure([fam({ ccrc_id: 'demo-x', session_pk: 1 })]);
    // An array of one UUID string coerces to that string under a regex test: only a type check refuses it.
    expect(() => g.activeFamilies([STORE] as unknown as string, c)).toThrow(/is not a store id/);
    expect(() => g.activeFamilies({ toString: () => STORE } as unknown as string, c)).toThrow(TypeError);
    expect(g.activeFamilies(STORE, c).active[0]!.store_id, 'CONTROL: the string itself answers').toBe(STORE);
  });

  it('active rule edge: an explicit null look-back is refused, and only an absent or undefined one means the default', async () => {
    const g = await gateT4();
    const c = pure([fam({ ccrc_id: 'demo-x', session_pk: 1, last_main_ts_ms: C_AS_OF - C_LOOK })]);   // exactly the default's lower edge
    expect(() => g.activeFamilies(STORE, c, { lookbackMs: null as unknown as number })).toThrow(TypeError);
    expect(g.activeFamilies(STORE, c).active, 'no opts: the 7-day default').toHaveLength(1);
    expect(g.activeFamilies(STORE, c, {}).active, 'no key: the 7-day default').toHaveLength(1);
    expect(g.activeFamilies(STORE, c, { lookbackMs: undefined }).active, 'undefined: the 7-day default').toHaveLength(1);
    expect(g.activeFamilies(STORE, c, { lookbackMs: C_LOOK - 1 }).active, 'CONTROL: a shorter look-back does exclude it').toEqual([]);
  });

  // P-5 (the run's worker): a malformed census row is refused, never folded into an exclusion or a tie-break.
  const MALFORMED: Array<[string, Partial<Record<keyof CensusFamily, unknown>>]> = [
    ['merged_into is a string', { merged_into: '2' }],
    ['merged_into is missing', { merged_into: undefined }],
    ['generation is not a string', { generation: 5 }],
    ['generation is missing', { generation: undefined }],
    ['ccrc_id is not a string', { ccrc_id: 5 }],
    ['session_pk is not an integer', { session_pk: '1' }],
    ['first_seen_ms is missing', { first_seen_ms: undefined }],
    ['last_main_ts_ms is a string', { last_main_ts_ms: '1799999999000' }],
    ['last_main_ts_ms is missing', { last_main_ts_ms: undefined }],
    ['last_main_ts_ms is a float', { last_main_ts_ms: 1.5 }],
    // Fix round 1: a number is not an integer. NaN and 1.5 pass a typeof test and fail Number.isSafeInteger.
    ['session_pk is NaN', { session_pk: NaN }],
    ['session_pk is a float', { session_pk: 1.5 }],
    ['first_seen_ms is NaN', { first_seen_ms: NaN }],
    ['first_seen_ms is a float', { first_seen_ms: 1000.5 }],
    ['merged_into is NaN', { merged_into: NaN }],
    ['merged_into is a float', { merged_into: 1.5 }],
    ['last_main_ts_ms is NaN', { last_main_ts_ms: NaN }],
  ];
  it.each(MALFORMED)('malformed census row: activeFamilies refuses a row whose %s', async (_name, bad) => {
    const g = await gateT4();
    const good = fam({ ccrc_id: 'demo-y', session_pk: 9 });
    const row = { ...fam({ ccrc_id: 'demo-x', session_pk: 1 }), ...bad } as unknown as CensusFamily;
    expect(() => g.activeFamilies(STORE, pure([good, row]))).toThrow(TypeError);
    expect(g.activeFamilies(STORE, pure([good])).active, 'CONTROL: the well-formed row alone answers').toHaveLength(1);
  });
});

// ── W2-3 Task 5: changed families and the assembled reports (W2-D22, W2-D23, W2-D24; RP7-pure's keying half) ─────
// Pure: every report, record and meta row below is a literal built in this describe, so no store and no python run.
// The windows come from Task 3's buildWindows: a "measured" boundary's one copy holds two assistant turns and no
// next boundary, so its window ends inclusive at the copy's last timed row; an "unmeasured" boundary's copy has no
// timed row (W2-D14). The presence record's keys are W2-D30's grammar, spelled here as text: the gate's prefix is
// module-local and temporary until W2-1 (W2-D23).
import * as gateT5 from '../../deploy/history-gate.mjs';

describe('W2-3 Task 5: changed families and the assembled reports', () => {
  const STORE_A = '00000000-0000-4000-8000-0000000000a5';
  const STORE_B = '00000000-0000-4000-8000-0000000000b5';
  const STORE_X = '00000000-0000-4000-8000-0000000000c5';
  const PY_SHA = createHash('sha256').update('w2-3 task 5: the measure-history.py bytes the record pinned').digest('hex');
  const OTHER_SHA = createHash('sha256').update('w2-3 task 5: other measure-history.py bytes').digest('hex');
  const PFX = 'recall_off:';   // W2-D30's meta prefix, as the presence record writes it
  type Row = [number, number | null, string | null, string | null, string, string | null];
  interface Copy {
    file_id: number; source_key: string; boundary_line: number; after_count: number; summary_line: number | null;
    next_boundary_line: number | null; next_boundary_ts_ms: number | null; last_ts_ms: number | null;
    rows: Row[]; models: string[]; truncated: boolean;
  }
  interface Boundary { boundary_uuid: string; ts_ms: number; copies: Copy[] }
  interface Family {
    ccrc_id: string; generation: string; found: boolean; merged_generations: string[];
    calls: Array<[number, number, string]>; boundaries: Boundary[];
  }
  interface MReport {
    store_id: string | null; user_version: number; script_sha256?: string; counters: Record<string, number>;
    w1b_lag_p95_ms: number | null; w1c_duplicate_entries: number; w1e: null; w1f_grep_p95_ms: number | null;
    w2: { row_cap: number; window_start_ms: number; window_end_ms: number; families: Family[] } | null; census: null;
  }
  interface Ref { store_id: string; ccrc_id: string; generation: string }
  interface Rec {
    nodes: Array<{ label: string; store_id: string }>;
    assignment: Array<Ref & { arm: 'treatment' | 'control' }>;
    gate_code: { release_tag: string; files: Record<string, string> };
    window: { start_ms: number; end_ms: number };
  }
  interface Win { boundary_uuid: string; state: string; calls: number; with_call: boolean }
  type Assembled =
    | { ok: true; families: Array<Ref & { key: string; arm: string; windows: Win[] }>;
        excluded: { not_found: string[]; zero_windows: string[]; unmeasured: { count: number; keys: string[] }; not_listed: string[] };
        code_changed: boolean }
    | { ok: false; reason: string; detail: string };

  /** A boundary whose one copy holds two assistant turns after its summary and no next boundary: measured. */
  const measuredAt = (uuid: string, ts: number): Boundary => ({ boundary_uuid: uuid, ts_ms: ts, copies: [{
    file_id: 1, source_key: '', boundary_line: 10, after_count: 3, summary_line: 11, next_boundary_line: null,
    next_boundary_ts_ms: null, last_ts_ms: ts + 200, models: ['model-t5'], truncated: false,
    rows: [[12, ts + 100, `msg-${uuid}-1`, null, `row-${uuid}-1`, 'model-t5'], [13, ts + 200, `msg-${uuid}-2`, null, `row-${uuid}-2`, 'model-t5']],
  }] });
  /** A boundary whose one copy has no timed row after it: unmeasured. */
  const unmeasuredAt = (uuid: string, ts: number): Boundary => ({ boundary_uuid: uuid, ts_ms: ts, copies: [{
    file_id: 2, source_key: '', boundary_line: 20, after_count: 1, summary_line: 21, next_boundary_line: null,
    next_boundary_ts_ms: null, last_ts_ms: null, models: [], truncated: false, rows: [],
  }] });
  const fam = (id: string, gen: string, boundaries: Boundary[], calls: Array<[number, number, string]> = []): Family =>
    ({ ccrc_id: id, generation: gen, found: true, merged_generations: [], calls, boundaries });
  const missing = (id: string, gen: string): Family =>
    ({ ccrc_id: id, generation: gen, found: false, merged_generations: [], calls: [], boundaries: [] });
  /** The window every fixture report echoes and every fixture record carries as part 2's `window` (W2-D13, W2-D22, amended):
   *  a report over the record's window assembles. */
  const ECHO = { window_start_ms: 0, window_end_ms: 1_209_600_000 } as const;
  const rep = (storeId: string | null, families: Family[], over: Partial<MReport> = {}): MReport => ({
    store_id: storeId, user_version: 1, script_sha256: PY_SHA, counters: {}, w1b_lag_p95_ms: null,
    w1c_duplicate_entries: 0, w1e: null, w1f_grep_p95_ms: null, w2: { row_cap: gateT5.ROW_CAP, ...ECHO, families }, census: null, ...over,
  });
  const rec = (assignment: Rec['assignment'], over: Partial<Rec> = {}): Rec => ({
    nodes: [{ label: 'node-a', store_id: STORE_A }, { label: 'node-b', store_id: STORE_B }],
    assignment,
    gate_code: { release_tag: 'v0.0.0-t5', files: { 'deploy/measure-history.py': PY_SHA } },
    window: { start_ms: ECHO.window_start_ms, end_ms: ECHO.window_end_ms },
    ...over,
  });
  const assemble = (reports: MReport[], record: Rec, opts?: { allowCodeChange?: boolean }): Assembled =>
    gateT5.assembleReports(reports as never, record as never, opts) as unknown as Assembled;
  const key = (s: string, id: string, gen: string): string => gateT5.familyKey(s, id, gen);
  const ok = (r: Assembled): Extract<Assembled, { ok: true }> => {
    if (!r.ok) throw new Error(`refused ${r.reason}: ${r.detail}`);
    return r;
  };
  /** The one-family fixture every refusal case starts from: it assembles. */
  const one = (): { reports: MReport[]; record: Rec } => ({
    reports: [rep(STORE_A, [fam('demo-a', G1, [measuredAt('b-a1', 1000)])])],
    record: rec([{ store_id: STORE_A, ccrc_id: 'demo-a', generation: G1, arm: 'treatment' }]),
  });
  const refusedAs = (r: Assembled, word: string): void => {
    expect(r.ok).toBe(false);
    expect(Object.keys(r).sort(), 'a refusal carries no partial answer').toEqual(['detail', 'ok', 'reason']);
    expect((r as { reason: string }).reason).toBe(word);
    expect(gateT5.GATE_REASONS).toContain(word);
  };

  it('CONTROL: the one-family fixture every refusal case starts from assembles, unstamped', () => {
    const { reports, record } = one();
    const r = ok(assemble(reports, record));
    expect(r.families.map((f) => [f.key, f.arm, f.windows.map((w) => [w.boundary_uuid, w.state])]))
      .toEqual([[key(STORE_A, 'demo-a', G1), 'treatment', [['b-a1', 'measured']]]]);
    expect(r.code_changed).toBe(false);
  });

  it('refuses store-id-null: a report whose store carries no meta store_id', () => {
    const { reports, record } = one();
    refusedAs(assemble([rep(null, reports[0]!.w2!.families)], record), 'store-id-null');
  });

  it('refuses store-id-duplicate: one store measured by two reports', () => {
    const { reports, record } = one();
    refusedAs(assemble([...reports, rep(STORE_A, [])], record), 'store-id-duplicate');
  });

  it('refuses store-id-unlisted: a report from a store outside the record\'s nodes', () => {
    const { reports, record } = one();
    refusedAs(assemble([...reports, rep(STORE_X, [])], record), 'store-id-unlisted');
  });

  it('refuses family-unassigned: a listed family the assignment does not hold, though its id is assigned on another store', () => {
    const { reports, record } = one();
    refusedAs(assemble([...reports, rep(STORE_B, [fam('demo-a', G1, [measuredAt('b-b1', 1000)])])], record), 'family-unassigned');
  });

  it('refuses row-cap-mismatch: a report measured at another row cap, and a W1 report with no w2', () => {
    const { reports, record } = one();
    const fams = reports[0]!.w2!.families;
    refusedAs(assemble([rep(STORE_A, fams, { w2: { row_cap: gateT5.ROW_CAP - 1, ...ECHO, families: fams } })], record), 'row-cap-mismatch');
    refusedAs(assemble([rep(STORE_A, fams, { w2: null })], record), 'row-cap-mismatch');
  });

  it('refuses code-changed: a script_sha256 other than gate_code\'s, both measured', () => {
    const { reports, record } = one();
    const fams = reports[0]!.w2!.families;
    refusedAs(assemble([rep(STORE_A, fams, { script_sha256: OTHER_SHA })], record), 'code-changed');
  });

  it('refuses code-unmeasured: a sha missing on either side, with or without allowCodeChange (W2-D24, amended)', () => {
    const { reports, record } = one();
    const noSha = rep(STORE_A, reports[0]!.w2!.families);
    delete noSha.script_sha256;
    const noPin = rec(record.assignment, { gate_code: { release_tag: 'v0.0.0-t5', files: {} } });
    for (const allowCodeChange of [false, true]) {
      refusedAs(assemble([noSha], record, { allowCodeChange }), 'code-unmeasured');
      refusedAs(assemble(reports, noPin, { allowCodeChange }), 'code-unmeasured');
      refusedAs(assemble([noSha], noPin, { allowCodeChange }), 'code-unmeasured');
    }
  });

  it("refuses window-mismatch: a report whose echoed window is not the record's, one that echoes none, and a record that carries none (W2-D13, W2-D22)", () => {
    const { reports, record } = one();
    const fams = reports[0]!.w2!.families;
    const onB = (w2: MReport['w2']): MReport => rep(STORE_B, [], { w2 });
    expect(ok(assemble([...reports, onB({ row_cap: gateT5.ROW_CAP, ...ECHO, families: [] })], record)).families,
      "CONTROL: two stores over the record's window assemble").toHaveLength(1);
    refusedAs(assemble([...reports, onB({ row_cap: gateT5.ROW_CAP, ...ECHO, window_end_ms: ECHO.window_end_ms + 1, families: [] })], record), 'window-mismatch');
    refusedAs(assemble([...reports, onB({ row_cap: gateT5.ROW_CAP, ...ECHO, window_start_ms: ECHO.window_start_ms + 1, families: [] })], record), 'window-mismatch');
    // Reports that agree with each other and not with the record: the record's window is the reference, one report included.
    const later = { window_start_ms: ECHO.window_start_ms + 86_400_000, window_end_ms: ECHO.window_end_ms + 86_400_000 };
    refusedAs(assemble([rep(STORE_A, fams, { w2: { row_cap: gateT5.ROW_CAP, ...later, families: fams } })], record), 'window-mismatch');
    refusedAs(assemble([rep(STORE_A, fams, { w2: { row_cap: gateT5.ROW_CAP, ...later, families: fams } }),
      onB({ row_cap: gateT5.ROW_CAP, ...later, families: [] })], record), 'window-mismatch');
    const noEcho = rep(STORE_A, fams, { w2: { row_cap: gateT5.ROW_CAP, families: fams } as MReport['w2'] });
    refusedAs(assemble([noEcho], record), 'window-mismatch');
    // A record with no window against a report that echoes none: undefined never matches undefined.
    const noWindow: Partial<Rec> = { ...record };
    delete noWindow.window;
    refusedAs(assemble([noEcho], noWindow as Rec), 'window-mismatch');
  });

  it('allowCodeChange stamps code_changed and refuses nothing: the same families, stamped', () => {
    const { reports, record } = one();
    const plain = ok(assemble(reports, record));
    const stamped = ok(assemble([rep(STORE_A, reports[0]!.w2!.families, { script_sha256: OTHER_SHA })], record, { allowCodeChange: true }));
    expect(stamped.code_changed).toBe(true);
    expect(stamped.families).toEqual(plain.families);
    expect(stamped.excluded).toEqual(plain.excluded);
    expect(ok(assemble(reports, record, { allowCodeChange: true })).code_changed, 'nothing changed, nothing stamped').toBe(false);
  });

  it('RP7-pure keying: one ccrc id and generation string on two stores assembles as two keyed families, each with its own arm', () => {
    const reports = [
      rep(STORE_A, [fam('demo-a', G1, [measuredAt('b-a1', 1000)], [[1100, 0, 'expand']])]),
      rep(STORE_B, [fam('demo-a', G1, [measuredAt('b-b1', 5000), measuredAt('b-b2', 9000)])]),
    ];
    const record = rec([
      { store_id: STORE_A, ccrc_id: 'demo-a', generation: G1, arm: 'treatment' },
      { store_id: STORE_B, ccrc_id: 'demo-a', generation: G1, arm: 'control' },
    ]);
    const r = ok(assemble(reports, record));
    const kA = key(STORE_A, 'demo-a', G1);
    const kB = key(STORE_B, 'demo-a', G1);
    expect(kA).not.toBe(kB);
    expect(r.families.map((f) => [f.key, f.store_id, f.ccrc_id, f.generation, f.arm, f.windows.length]).sort())
      .toEqual([[kA, STORE_A, 'demo-a', G1, 'treatment', 1], [kB, STORE_B, 'demo-a', G1, 'control', 2]].sort());
    expect(r.families.find((f) => f.key === kA)!.windows[0]).toMatchObject({ boundary_uuid: 'b-a1', calls: 1, with_call: true });
    expect(ok(assemble([...reports].reverse(), record)), 'report order changes nothing').toEqual(r);
  });

  it('found:false, 0-window and unmeasured exclusions are counted by key; an assigned family no report lists is not_listed', () => {
    const reports = [rep(STORE_A, [
      fam('demo-a', G1, [measuredAt('b-a1', 1000), unmeasuredAt('b-a2', 3000)]),
      missing('demo-b', G1),
      fam('demo-c', G1, []),
      fam('demo-d', G1, [unmeasuredAt('b-d1', 4000)]),
    ])];
    const record = rec(['demo-a', 'demo-b', 'demo-c', 'demo-d', 'demo-e'].map((id) => ({ store_id: STORE_A, ccrc_id: id, generation: G1, arm: 'treatment' as const })));
    const r = ok(assemble(reports, record));
    expect(r.families.map((f) => [f.key, f.windows.map((w) => w.boundary_uuid)])).toEqual([[key(STORE_A, 'demo-a', G1), ['b-a1']]]);
    expect(r.excluded).toEqual({
      not_found: [key(STORE_A, 'demo-b', G1)],
      zero_windows: [key(STORE_A, 'demo-c', G1), key(STORE_A, 'demo-d', G1)].sort(),
      unmeasured: { count: 2, keys: [JSON.stringify([STORE_A, 'demo-a', G1, 'b-a2']), JSON.stringify([STORE_A, 'demo-d', G1, 'b-d1'])].sort() },
      not_listed: [key(STORE_A, 'demo-e', G1)],
    });
  });

  it('a family listed twice in one report throws: two answers for one key are never merged', () => {
    const { record } = one();
    const twice = rep(STORE_A, [fam('demo-a', G1, [measuredAt('b-a1', 1000)]), fam('demo-a', G1, [])]);
    expect(() => assemble([twice], record)).toThrow(/listed twice in one report/);
  });

  // ── changedFamilies (W2-D23) over W2-D30's rows ──
  const W = { start_ms: 10_000, end_ms: 20_000 };
  const change = (store: string, ts: number, id: string, prev: number | null): { store_id: string; k: string; v: string } =>
    ({ store_id: store, k: `${PFX}change:${ts}:${id}`, v: JSON.stringify({ from: 'absent', to: 'value', prev_seen_ms: prev }) });
  const gap = (store: string, ts: number, from: number | null): { store_id: string; k: string; v: string } =>
    ({ store_id: store, k: `${PFX}gap:${ts}`, v: JSON.stringify({ from, to: ts }) });
  const LIST: Ref[] = [{ store_id: STORE_A, ccrc_id: 'demo-a', generation: G1 }];
  const changedOf = (rows: Array<{ store_id: string; k: string; v: string }>, list: Ref[] = LIST): string[] =>
    gateT5.changedFamilies(rows, W, list).changed;

  it('parseRecallOffRow reads a change row and a gap row, and every other key, the record\'s own state and seen_ms rows included, is other', () => {
    expect(gateT5.parseRecallOffRow(`${PFX}change:15000:demo-a`, JSON.stringify({ from: 'unobserved', to: 'value', prev_seen_ms: null })))
      .toEqual({ kind: 'change', ts_ms: 15_000, id: 'demo-a', from: 'unobserved', to: 'value', prev_seen_ms: null });
    expect(gateT5.parseRecallOffRow(`${PFX}gap:15000`, JSON.stringify({ from: 12_000, to: 15_000 })))
      .toEqual({ kind: 'gap', ts_ms: 15_000, from: 12_000, to: 15_000 });
    for (const k of [`${PFX}state:demo-a`, `${PFX}seen_ms`, 'store_id', 'recall_offchange:1:demo-a']) {
      expect(gateT5.parseRecallOffRow(k, '{}'), k).toEqual({ kind: 'other' });
    }
  });

  it('the temporary recall_off: prefix is module-local: the gate exports no binding of it for another module to read', () => {
    expect(Object.keys(gateT5).filter((n) => /RECALL_OFF/.test(n))).toEqual([]);
  });

  it('parseRecallOffRow throws on a change or gap row off the grammar, never reading it as other', () => {
    const v = JSON.stringify({ from: 'absent', to: 'value', prev_seen_ms: 9000 });
    for (const [k, val] of [
      [`${PFX}change:15x00:demo-a`, v], [`${PFX}change:015000:demo-a`, v], [`${PFX}change:15000:`, v], [`${PFX}change:15000`, v],
      [`${PFX}change:15000:demo-a`, 'not json'], [`${PFX}change:15000:demo-a`, JSON.stringify({ from: 'absent', to: 'value' })],
      [`${PFX}change:15000:demo-a`, JSON.stringify({ from: 'absent', to: 'value', prev_seen_ms: -1 })],
      [`${PFX}gap:15000`, JSON.stringify({ from: 12_000, to: null })], [`${PFX}gap:-1`, JSON.stringify({ from: null, to: 1 })],
    ] as const) expect(() => gateT5.parseRecallOffRow(k, val), `${k} ${val}`).toThrow(/recall-off meta row/);
  });

  it('a change row with prev_seen_ms null reads as -Infinity and drops the family', () => {
    expect(changedOf([change(STORE_A, 15_000, 'demo-a', null)])).toEqual([key(STORE_A, 'demo-a', G1)]);
  });

  it('a change row at exactly window.start_ms drops the family, and one a millisecond before it keeps it', () => {
    expect(changedOf([change(STORE_A, W.start_ms, 'demo-a', 9_000)])).toEqual([key(STORE_A, 'demo-a', G1)]);
    expect(changedOf([change(STORE_A, W.start_ms - 1, 'demo-a', 9_000)])).toEqual([]);
  });

  it('a change row whose prev_seen_ms is exactly window.end_ms keeps the family, and one a millisecond earlier drops it', () => {
    expect(changedOf([change(STORE_A, 20_500, 'demo-a', W.end_ms)])).toEqual([]);
    expect(changedOf([change(STORE_A, 20_500, 'demo-a', W.end_ms - 1)])).toEqual([key(STORE_A, 'demo-a', G1)]);
  });

  it('a change drops every listed generation of its id on its store, and nothing on another store or of another id', () => {
    const list: Ref[] = [
      { store_id: STORE_A, ccrc_id: 'demo-a', generation: G1 }, { store_id: STORE_A, ccrc_id: 'demo-a', generation: G2 },
      { store_id: STORE_B, ccrc_id: 'demo-a', generation: G1 }, { store_id: STORE_A, ccrc_id: 'demo-b', generation: G1 },
    ];
    expect(changedOf([change(STORE_A, 15_000, 'demo-a', 14_000), change(STORE_A, 15_100, 'demo-a', 15_000)], list))
      .toEqual([key(STORE_A, 'demo-a', G1), key(STORE_A, 'demo-a', G2)].sort());
  });

  it('a gap row is reported and drops nothing; the record\'s other rows drop nothing either', () => {
    const r = gateT5.changedFamilies([
      gap(STORE_A, 15_000, 12_000), gap(STORE_B, 11_000, null), gap(STORE_A, 9_000, 8_000),
      { store_id: STORE_A, k: `${PFX}state:demo-a`, v: JSON.stringify({ s: 'value', v: 'x' }) },
      { store_id: STORE_A, k: `${PFX}seen_ms`, v: '15000' },
    ], W, LIST);
    expect(r.changed).toEqual([]);
    expect(r.gaps).toEqual([
      { store_id: STORE_A, ts_ms: 15_000, from: 12_000, to: 15_000 },
      { store_id: STORE_B, ts_ms: 11_000, from: null, to: 11_000 },
    ]);
  });

  // ── Edge pins added after the brief's cases (Task 5) ──
  it('edge: an undefined store_id is store-id-null too, and the refusals come in W2-D22\'s order, the record\'s window first', () => {
    const { reports, record } = one();
    const fams = reports[0]!.w2!.families;
    const undef = rep(STORE_A, fams);
    delete (undef as Partial<MReport>).store_id;
    refusedAs(assemble([undef], record), 'store-id-null');
    const bad = fam('demo-zz', G1, [measuredAt('b-z1', 1000)]);   // not in the assignment
    const wrongCap = (families: Family[], over: Partial<MReport> = {}): MReport =>
      rep(STORE_A, families, { w2: { row_cap: gateT5.ROW_CAP - 1, ...ECHO, families }, ...over });
    refusedAs(assemble([wrongCap([bad])], record), 'family-unassigned');   // the family comes before the row cap
    refusedAs(assemble([wrongCap(fams, { script_sha256: OTHER_SHA })], record), 'row-cap-mismatch');   // the row cap before the sha
    const unsigned = wrongCap(fams);
    delete unsigned.script_sha256;
    refusedAs(assemble([unsigned], record), 'row-cap-mismatch');   // and before an unmeasured sha too
    const later = { window_start_ms: 5, window_end_ms: 6 };
    refusedAs(assemble([rep(STORE_A, fams, { script_sha256: OTHER_SHA, w2: { row_cap: gateT5.ROW_CAP, ...later, families: fams } })], record), 'code-changed');
    const noSha = rep(STORE_A, fams, { w2: { row_cap: gateT5.ROW_CAP, ...later, families: fams } });
    delete noSha.script_sha256;
    refusedAs(assemble([noSha], record), 'code-unmeasured');   // the sha before the window
    const noWin: Partial<Rec> = { ...record };
    delete noWin.window;
    refusedAs(assemble([undef], noWin as Rec), 'window-mismatch');   // the record's window before any report is read
  });

  it('edge: a record window that is not two safe integers is refused even when a report echoes the same, and the flag must be true itself', () => {
    const { reports, record } = one();
    const fams = reports[0]!.w2!.families;
    const echoing = (w2: object): MReport => rep(STORE_A, fams, { w2: { row_cap: gateT5.ROW_CAP, families: fams, ...w2 } as MReport['w2'] });
    refusedAs(assemble([echoing({ window_start_ms: 0 })], { ...record, window: { start_ms: 0 } as Rec['window'] }), 'window-mismatch');
    refusedAs(assemble([echoing({ window_end_ms: 9 })], { ...record, window: { end_ms: 9 } as Rec['window'] }), 'window-mismatch');
    refusedAs(assemble([echoing({ window_start_ms: 0.5, window_end_ms: 1.5 })], { ...record, window: { start_ms: 0.5, end_ms: 1.5 } }), 'window-mismatch');
    refusedAs(assemble([echoing({ window_start_ms: 0, window_end_ms: Number.NaN })], { ...record, window: { start_ms: 0, end_ms: Number.NaN } }), 'window-mismatch');
    const changed = rep(STORE_A, fams, { script_sha256: OTHER_SHA });
    refusedAs(assemble([changed], record, { allowCodeChange: 1 as never }), 'code-changed');
    refusedAs(assemble([changed], record, { allowCodeChange: undefined }), 'code-changed');
  });

  it('edge: code_changed stays stamped when a later report matches the pinned sha', () => {
    const reports = [
      rep(STORE_A, [fam('demo-a', G1, [measuredAt('b-a1', 1000)])], { script_sha256: OTHER_SHA }),
      rep(STORE_B, [fam('demo-b', G1, [measuredAt('b-b1', 1000)])]),
    ];
    const record = rec([
      { store_id: STORE_A, ccrc_id: 'demo-a', generation: G1, arm: 'treatment' },
      { store_id: STORE_B, ccrc_id: 'demo-b', generation: G1, arm: 'control' },
    ]);
    expect(ok(assemble(reports, record, { allowCodeChange: true })).code_changed).toBe(true);
    expect(ok(assemble([...reports].reverse(), record, { allowCodeChange: true })).code_changed).toBe(true);
  });

  it('edge: a found:false family listed twice in one report throws too, and every excluded list is sorted whatever the listing order', () => {
    const { record } = one();
    expect(() => assemble([rep(STORE_A, [missing('demo-a', G1), missing('demo-a', G1)])], record)).toThrow(/listed twice in one report/);
    const ids = ['demo-z', 'demo-y', 'demo-x', 'demo-w', 'demo-v', 'demo-u', 'demo-t'];
    const reports = [rep(STORE_A, [
      missing('demo-z', G1), missing('demo-y', G1),
      fam('demo-x', G1, []), fam('demo-w', G1, []),
      fam('demo-v', G1, [unmeasuredAt('b-v1', 1000), unmeasuredAt('b-v0', 3000)]),
    ])];
    const r = ok(assemble(reports, rec(ids.map((id) => ({ store_id: STORE_A, ccrc_id: id, generation: G1, arm: 'treatment' as const })))));
    const k = (id: string): string => key(STORE_A, id, G1);
    expect(r.excluded.not_found).toEqual([k('demo-y'), k('demo-z')]);
    expect(r.excluded.zero_windows).toEqual([k('demo-v'), k('demo-w'), k('demo-x')]);
    expect(r.excluded.unmeasured.keys).toEqual([JSON.stringify([STORE_A, 'demo-v', G1, 'b-v0']), JSON.stringify([STORE_A, 'demo-v', G1, 'b-v1'])]);
    expect(r.excluded.not_listed).toEqual([k('demo-t'), k('demo-u')]);
  });

  // ── parseRecallOffRow and changedFamilies, the edges ──
  it('edge: parseRecallOffRow reads a near-miss kind, a non-string key and an unrelated key as other, and a colon inside an id whole', () => {
    for (const k of [`${PFX}changes:1:a`, `${PFX}gapped:5`, `${PFX}change`, `${PFX}gap`, `${PFX}`]) {
      expect(gateT5.parseRecallOffRow(k, '{}'), k).toEqual({ kind: 'other' });
    }
    expect(gateT5.parseRecallOffRow(undefined as never, '{}')).toEqual({ kind: 'other' });
    expect(gateT5.parseRecallOffRow(`${PFX}change:7:demo:a`, JSON.stringify({ from: null, to: 'x', prev_seen_ms: 0 })))
      .toEqual({ kind: 'change', ts_ms: 7, id: 'demo:a', from: null, to: 'x', prev_seen_ms: 0 });
    expect(gateT5.parseRecallOffRow(`${PFX}gap:0`, JSON.stringify({ from: 0, to: 0 }))).toEqual({ kind: 'gap', ts_ms: 0, from: 0, to: 0 });
  });

  it('edge: parseRecallOffRow throws on a ts past the safe integers, a value that is no object, and every field off its kind', () => {
    const ch = (b: unknown): string => JSON.stringify(b);
    const good = { from: 'a', to: 'b', prev_seen_ms: 1 };
    for (const [k, val] of [
      [`${PFX}change:99999999999999999999:demo-a`, ch(good)], [`${PFX}gap:99999999999999999999`, ch({ from: null, to: 1 })],
      [`${PFX}change:1:demo-a`, 'null'], [`${PFX}change:1:demo-a`, '[]'], [`${PFX}change:1:demo-a`, '5'], [`${PFX}gap:1`, 'null'],
      [`${PFX}change:1:demo-a`, ch({ to: 'b', prev_seen_ms: 1 })], [`${PFX}change:1:demo-a`, ch({ from: 'a', prev_seen_ms: 1 })],
      [`${PFX}change:1:demo-a`, ch({ ...good, prev_seen_ms: 1.5 })], [`${PFX}change:1:demo-a`, ch({ ...good, prev_seen_ms: '1' })],
      [`${PFX}gap:5`, ch({ from: -1, to: 5 })], [`${PFX}gap:5`, ch({ from: 1.5, to: 5 })], [`${PFX}gap:5`, ch({ from: '1', to: 5 })],
      [`${PFX}gap:5`, ch({ from: 1, to: 1.5 })], [`${PFX}gap:5`, ch({ from: 1, to: -1 })], [`${PFX}gap:5`, ch({ to: 5 })], [`${PFX}gap:5:x`, ch({ from: 1, to: 5 })],
    ] as const) expect(() => gateT5.parseRecallOffRow(k, val), `${k} ${val}`).toThrow(/recall-off meta row/);
  });

  it('edge: a gap row is reported at exactly window.start_ms and not a millisecond before, by its from against window.end_ms, sorted by store then ts', () => {
    const r = gateT5.changedFamilies([
      gap(STORE_B, W.end_ms + 5, W.end_ms),            // from at the end: out
      gap(STORE_B, W.end_ms + 4, W.end_ms - 1),        // from a millisecond before the end: in
      gap(STORE_A, W.start_ms + 2, null),
      gap(STORE_A, W.start_ms, 1),                     // ts at the start: in
      gap(STORE_A, W.start_ms - 1, 1),                 // ts a millisecond before: out
      gap(STORE_A, W.start_ms + 1, 0),
    ], W, LIST);
    expect(r.gaps.map((g) => [g.store_id === STORE_A ? 'A' : 'B', g.ts_ms])).toEqual([
      ['A', W.start_ms], ['A', W.start_ms + 1], ['A', W.start_ms + 2], ['B', W.end_ms + 4],
    ]);
  });

  it('edge: the changed families are sorted and unique whatever the list order', () => {
    const list: Ref[] = [
      { store_id: STORE_A, ccrc_id: 'demo-a', generation: G2 }, { store_id: STORE_A, ccrc_id: 'demo-a', generation: G1 },
      { store_id: STORE_A, ccrc_id: 'demo-a', generation: G2 },
    ];
    expect(changedOf([change(STORE_A, 15_000, 'demo-a', 14_000)], list)).toEqual([key(STORE_A, 'demo-a', G1), key(STORE_A, 'demo-a', G2)]);
  });

  // ── Fix round 1 (Task 5): refusals by throw where the function has no refusal shape, and the null-sha edges ──
  /** A TypeError whose message names the guard, so a guard that language semantics would half-cover still has to be written. */
  const throwsType = (fn: () => unknown, re: RegExp, name: string): void => {
    let caught: unknown;
    try { fn(); } catch (e) { caught = e; }
    expect(caught, name).toBeInstanceOf(TypeError);
    expect((caught as Error).message, name).toMatch(re);
  };

  it('fix round 1: changedFamilies throws a TypeError unless its window is two safe integers with start before end', () => {
    const rows = [change(STORE_A, 15_000, 'demo-a', null)];
    const run = (w: unknown): unknown => gateT5.changedFamilies(rows, w as never, LIST);
    expect(() => run(W), 'CONTROL: the well-formed window answers').not.toThrow();
    for (const [name, w] of [
      ['missing', undefined], ['null', null], ['empty', {}], ['the report spelling', { window_start_ms: W.start_ms, window_end_ms: W.end_ms }],
      ['start missing', { end_ms: W.end_ms }], ['end missing', { start_ms: W.start_ms }], ['NaN start', { start_ms: Number.NaN, end_ms: W.end_ms }],
      ['NaN end', { start_ms: W.start_ms, end_ms: Number.NaN }], ['Infinity end', { start_ms: W.start_ms, end_ms: Infinity }],
      ['fractional start', { start_ms: 0.5, end_ms: W.end_ms }], ['string end', { start_ms: W.start_ms, end_ms: String(W.end_ms) }],
      ['empty window', { start_ms: W.start_ms, end_ms: W.start_ms }], ['reversed window', { start_ms: W.end_ms, end_ms: W.start_ms }],
    ] as const) throwsType(() => run(w), /changedFamilies: the window is/, name);
    expect(() => run({ start_ms: W.start_ms, end_ms: W.start_ms + 1 }), 'a one-millisecond window is a window').not.toThrow();
  });

  it('fix round 1: changedFamilies throws a TypeError on a change or gap row whose store_id is not a string, and reads a foreign row as other', () => {
    const run = (rows: unknown[]): unknown => gateT5.changedFamilies(rows as never, W, LIST);
    const c = change(STORE_A, 15_000, 'demo-a', null);
    const g = gap(STORE_A, 15_000, null);
    expect(() => run([c, g]), 'CONTROL').not.toThrow();
    for (const bad of [undefined, null, 7]) {
      throwsType(() => run([{ ...c, store_id: bad }]), /carries no string store_id/, `change ${String(bad)}`);
      throwsType(() => run([{ ...g, store_id: bad }]), /carries no string store_id/, `gap ${String(bad)}`);
    }
    const noStore: { k: string; v: string } = { k: c.k, v: c.v };
    throwsType(() => run([noStore]), /carries no string store_id/, 'a row with no store_id at all');
    expect(() => run([{ store_id: undefined, k: `${PFX}seen_ms`, v: '1' }]), 'a row that is neither change nor gap is not read').not.toThrow();
  });

  it('fix round 1: assembleReports throws a TypeError on a malformed w2 or family, and keeps the brief\'s row-cap-mismatch for a report with no w2', () => {
    const { reports, record } = one();
    const fams = reports[0]!.w2!.families;
    const withW2 = (w2: unknown): MReport => rep(STORE_A, fams, { w2: w2 as MReport['w2'] });
    const w2Of = (families: unknown): unknown => ({ row_cap: gateT5.ROW_CAP, ...ECHO, families });
    expect(() => assemble([rep(STORE_A, fams)], record), 'CONTROL').not.toThrow();
    // The brief maps a report with no w2 (W1) to a GATE_REASONS word; the words stay.
    refusedAs(assemble([withW2(null)], record), 'row-cap-mismatch');
    refusedAs(assemble([withW2(undefined)], record), 'row-cap-mismatch');
    // A w2 that is no object with a families array is internally malformed.
    for (const [name, w2] of [
      ['families absent', { row_cap: gateT5.ROW_CAP, ...ECHO }], ['families null', w2Of(null)], ['families an object', w2Of({})],
      ['families a string', w2Of('x')], ['w2 a number', 5], ['w2 a string', 'x'],
    ] as const) throwsType(() => assemble([withW2(w2)], record), /w2 is no object holding a families array/, name);
    const goodFam = fams[0]!;
    const withFam = (f: unknown): MReport => rep(STORE_A, [f as Family]);
    const dropped = (k: keyof Family): Record<string, unknown> => { const f: Record<string, unknown> = { ...goodFam }; delete f[k]; return f; };
    for (const [name, f] of [
      ['generation missing', dropped('generation')], ['generation null', { ...goodFam, generation: null }], ['generation a number', { ...goodFam, generation: 3 }],
      ['ccrc_id missing', dropped('ccrc_id')], ['ccrc_id a number', { ...goodFam, ccrc_id: 3 }],
      ['found missing', dropped('found')], ['found undefined', { ...goodFam, found: undefined }], ['found null', { ...goodFam, found: null }],
      ['found a string', { ...goodFam, found: 'true' }], ['family null', null], ['family a string', 'x'],
    ] as const) throwsType(() => assemble([withFam(f)], record), /a listed family needs/, name);
    // An empty-string generation is a string (the legacy family), and a family whose found is false still reads.
    expect(() => assemble([withFam({ ...goodFam, found: false })], record), 'found:false is a boolean').not.toThrow();
  });

  it('fix round 1: a null sha is unmeasured on either side, as a missing one is, and no flag stamps it', () => {
    const { reports, record } = one();
    const fams = reports[0]!.w2!.families;
    const nullSha = rep(STORE_A, fams, { script_sha256: null as never });
    const nullPin = rec(record.assignment, { gate_code: { release_tag: 'v0.0.0-t5', files: { 'deploy/measure-history.py': null as never } } });
    for (const allowCodeChange of [false, true]) {
      refusedAs(assemble([nullSha], record, { allowCodeChange }), 'code-unmeasured');
      refusedAs(assemble(reports, nullPin, { allowCodeChange }), 'code-unmeasured');
      refusedAs(assemble([nullSha], nullPin, { allowCodeChange }), 'code-unmeasured');
    }
  });
});

// ── W2-3 Task 6: the bootstrap, the assignment and Q18 (W2-D18, W2-D19, W2-D21) ─────────────────────────────────────
// Pure: every seed is a parameter. The seed is assembled at runtime and is no real draw; store ids, ccrc ids and
// generations are synthetic. The xoshiro128** reference words were re-derived by an independent implementation.
import * as gate6 from '../../deploy/history-gate.mjs';

describe('W2-3 Task 6: the bootstrap, the assignment and Q18', () => {
  const SEED6 = '5eed'.repeat(16);
  const OTHER_SEED6 = 'd1ce'.repeat(16);
  const STORE6_A = '00000000-0000-4000-8000-0000000000a1';
  const STORE6_B = '00000000-0000-4000-8000-0000000000a2';
  const take = (rng: { nextU32: () => number }, n: number): number[] => Array.from({ length: n }, () => rng.nextU32());
  /** The stream substream(seed, label) must equal: sha256(seed:label)'s first 16 bytes as four little-endian words. */
  const wordsOf = (seed: string, label: string): [number, number, number, number] => {
    const d = createHash('sha256').update(`${seed}:${label}`, 'utf8').digest();
    return [d.readUInt32LE(0), d.readUInt32LE(4), d.readUInt32LE(8), d.readUInt32LE(12)];
  };
  /** An rng that answers the given words in order, then throws. */
  const scripted = (ws: number[]): { nextU32: () => number; used: () => number } => {
    let i = 0;
    return { nextU32: () => { if (i >= ws.length) throw new Error('scripted rng ran dry'); return ws[i++]!; }, used: () => i };
  };
  const fam6 = (store: string, id: string): { store_id: string; ccrc_id: string; generation: string } =>
    ({ store_id: store, ccrc_id: id, generation: G1 });
  const TWELVE = Array.from({ length: 12 }, (_, i) => fam6(STORE6_A, `wrap-a-proj-${String.fromCharCode(97 + i)}`));

  it('xoshiro128** from the state [1, 2, 3, 4] gives the reference words', () => {
    expect(take(gate6.xoshiro128ss([1, 2, 3, 4]), 6)).toEqual([11520, 0, 5927040, 70819200, 2031721883, 1637235492]);
  });

  it('an all-zero state is refused, and so is a state that is not four u32 words', () => {
    expect(() => gate6.xoshiro128ss([0, 0, 0, 0])).toThrow(/all-zero state is refused/);
    expect(() => gate6.xoshiro128ss([1, 2, 3] as unknown as [number, number, number, number])).toThrow(/four u32 words/);
    expect(() => gate6.xoshiro128ss([1, 2, 3, 2 ** 32])).toThrow(/four u32 words/);
  });

  it('a substream is sha256(seed:label)\'s first 16 bytes as four little-endian words; the same seed and label give the same stream twice, another label or seed another', () => {
    const live = take(gate6.substream(SEED6, 'live-ci'), 8);
    expect(live).toEqual(take(gate6.xoshiro128ss(wordsOf(SEED6, 'live-ci')), 8));
    expect(take(gate6.substream(SEED6, 'live-ci'), 8)).toEqual(live);
    expect(take(gate6.substream(SEED6, 'quiz-ci'), 8)).not.toEqual(live);
    expect(take(gate6.substream(OTHER_SEED6, 'live-ci'), 8)).not.toEqual(live);
  });

  it('every SUBSTREAMS label and PILOT_SUBSTREAM opens a stream; any other label, ASSIGN_LABEL included, is refused', () => {
    for (const label of [...gate6.SUBSTREAMS, gate6.PILOT_SUBSTREAM]) expect(() => gate6.substream(SEED6, label)).not.toThrow();
    expect(() => gate6.substream(SEED6, gate6.ASSIGN_LABEL)).toThrow(/is not a substream label/);
    expect(() => gate6.substream(SEED6, 'q19')).toThrow(/is not a substream label/);
    expect(() => gate6.substream('', 'q18')).toThrow(/the seed is a non-empty string/);
  });

  it('randInt draws by rejection: a word at or above the largest multiple of n below 2^32 is drawn again', () => {
    const n = 3 * 2 ** 30;   // the largest multiple of n below 2^32 is n itself: a quarter of the words are redrawn
    const r = scripted([2 ** 32 - 1, 5]);
    expect(gate6.randInt(r, n)).toBe(5);
    expect(r.used()).toBe(2);
    const rng = gate6.substream(SEED6, 'live-ci');
    const seen = new Set<number>();
    for (let i = 0; i < 10_000; i++) {
      const v = gate6.randInt(rng, 7);
      expect(Number.isInteger(v) && v >= 0 && v < 7, String(v)).toBe(true);
      seen.add(v);
    }
    expect(seen.size).toBe(7);
  });

  it('randInt is unbiased on a constructed bound where a bare modulo is not: draws below 2^30 out of [0, 3 * 2^30) are a third, not a half', () => {
    const n = 3 * 2 ** 30;
    const rng = gate6.substream(SEED6, 'live-ci');
    let low = 0;
    for (let i = 0; i < 3000; i++) if (gate6.randInt(rng, n) < 2 ** 30) low += 1;
    expect(low / 3000).toBeGreaterThan(0.30);
    expect(low / 3000).toBeLessThan(0.37);
  });

  it('the nearest-rank ranks are ceil(0.025 B) and ceil(0.975 B): 250 and 9,750 at B = 10,000; 1 and 30 at B = 30', () => {
    expect(gate6.nearestRankBounds(10_000)).toEqual({ lowRank: 250, highRank: 9_750 });
    expect(gate6.nearestRankBounds(gate6.BOOTSTRAP.B)).toEqual({ lowRank: 250, highRank: 9_750 });
    expect(gate6.nearestRankBounds(30)).toEqual({ lowRank: 1, highRank: 30 });
  });

  it('a family with 0 measured windows is not a cluster: the result is the one without it, draw for draw; with none left there is no statistic', () => {
    const real = [{ num: 3, den: 5 }, { num: 0, den: 4 }, { num: 2, den: 2 }];
    const withEmpty = gate6.clusterBootstrap({ clusters: [...real, { num: 0, den: 0 }], B: 400, rng: gate6.substream(SEED6, 'live-ci'), mode: 'share' });
    const without = gate6.clusterBootstrap({ clusters: real, B: 400, rng: gate6.substream(SEED6, 'live-ci'), mode: 'share' });
    expect(withEmpty).toEqual(without);
    expect(withEmpty.point).toEqual({ num: 5, den: 11 });
    const paired = [{ t: 2, c: 1, n: 3 }, { t: 1, c: 1, n: 2 }];
    expect(gate6.clusterBootstrap({ clusters: [...paired, { t: 0, c: 0, n: 0 }], B: 400, rng: gate6.substream(SEED6, 'quiz-ci'), mode: 'paired' }))
      .toEqual(gate6.clusterBootstrap({ clusters: paired, B: 400, rng: gate6.substream(SEED6, 'quiz-ci'), mode: 'paired' }));
    expect(() => gate6.clusterBootstrap({ clusters: [{ num: 0, den: 0 }], B: 400, rng: gate6.substream(SEED6, 'live-ci'), mode: 'share' }))
      .toThrow(/no cluster has a measured unit/);
  });

  it('the statistic is pooled and exact: share is sum(with_call) / sum(windows), paired is (sum t - sum c) / sum n, never reduced, never a float', () => {
    const s = gate6.clusterBootstrap({ clusters: [{ num: 1, den: 3 }, { num: 1, den: 7 }], B: 400, rng: gate6.substream(SEED6, 'live-ci'), mode: 'share' });
    expect(s.point).toEqual({ num: 2, den: 10 });
    const p = gate6.clusterBootstrap({ clusters: [{ t: 3, c: 1, n: 4 }, { t: 1, c: 1, n: 2 }], B: 400, rng: gate6.substream(SEED6, 'quiz-ci'), mode: 'paired' });
    expect(p.point).toEqual({ num: 2, den: 6 });
    for (const r of [s, p]) {
      for (const f of [r.point, r.lower, r.upper]) expect(Number.isSafeInteger(f.num) && Number.isSafeInteger(f.den) && f.den >= 1, JSON.stringify(f)).toBe(true);
      expect(gate6.cmpFrac(r.lower, r.point)).toBeLessThanOrEqual(0);
      expect(gate6.cmpFrac(r.point, r.upper)).toBeLessThanOrEqual(0);
    }
    expect(() => gate6.clusterBootstrap({ clusters: [{ t: 3, c: 1, n: 4 }], B: 400, rng: gate6.substream(SEED6, 'quiz-ci'), mode: 'share' }))
      .toThrow(/is not a share cluster/);
  });

  it('the order is exact: two fractions one float apart compare unequal, and a product past 2^53 compares in BigInt', () => {
    const third = gate6.frac(1, 3);
    const near = gate6.frac(3_002_399_751_580_330, 9_007_199_254_740_991);   // 1/3 - 1/(3 * (2^53 - 1))
    expect(near.num / near.den, 'CONTROL: as floats the two are one value').toBe(1 / 3);
    expect(gate6.cmpFrac(near, third)).toBe(-1);
    expect(gate6.cmpFrac(third, near)).toBe(1);
    expect(gate6.cmpFrac(gate6.frac(2, 6), third)).toBe(0);
    const big = 2 ** 53;
    expect(gate6.cmpFrac(gate6.frac(big - 1, big - 2), gate6.frac(big - 2, big - 3))).toBe(-1);
    expect(() => gate6.frac(1, 0)).toThrow(/not an exact fraction/);
    expect(() => gate6.frac(0.5, 1)).toThrow(/not an exact fraction/);
  });

  it('the same seed and clusters give the same interval twice; B defaults to BOOTSTRAP.B and is injectable', () => {
    const clusters = [{ num: 1, den: 4 }, { num: 0, den: 3 }, { num: 2, den: 2 }, { num: 1, den: 5 }];
    const once = gate6.clusterBootstrap({ clusters, rng: gate6.substream(SEED6, 'live-ci'), mode: 'share' });
    expect(gate6.clusterBootstrap({ clusters, rng: gate6.substream(SEED6, 'live-ci'), mode: 'share' })).toEqual(once);
    expect(gate6.clusterBootstrap({ clusters, B: gate6.BOOTSTRAP.B, rng: gate6.substream(SEED6, 'live-ci'), mode: 'share' })).toEqual(once);
  });

  it('a family\'s arm is bit 0 of the first byte of sha256(seed:assign:canonicalJson([store_id, ccrc_id, generation])), 1 treatment', () => {
    for (const f of TWELVE) {
      const bit = createHash('sha256').update(`${SEED6}:assign:${JSON.stringify([f.store_id, f.ccrc_id, f.generation])}`, 'utf8').digest()[0]! & 1;
      expect(gate6.armOf(SEED6, f), f.ccrc_id).toBe(bit === 1 ? 'treatment' : 'control');
      expect(gate6.ASSIGNMENT_ARMS).toContain(gate6.armOf(SEED6, f));
    }
    expect(new Set(TWELVE.map((f) => gate6.armOf(SEED6, f))).size, 'CONTROL: the fixture holds both arms').toBe(2);
  });

  it('removing one family leaves every other family\'s arm unchanged', () => {
    const all = new Map(gate6.assignArms(SEED6, TWELVE).map((e) => [e.ccrc_id, e.arm]));
    for (let drop = 0; drop < TWELVE.length; drop++) {
      for (const e of gate6.assignArms(SEED6, TWELVE.filter((_, i) => i !== drop))) expect(e.arm, `${drop}: ${e.ccrc_id}`).toBe(all.get(e.ccrc_id));
    }
  });

  it('shuffled input gives the same list, sorted by canonicalJson, and the same assignment_sha256', () => {
    const list = gate6.assignArms(SEED6, TWELVE);
    const shuffled = [...TWELVE.slice(7), ...TWELVE.slice(0, 7).reverse()];
    expect(gate6.assignArms(SEED6, shuffled)).toEqual(list);
    const canon = list.map((e) => JSON.stringify({ arm: e.arm, ccrc_id: e.ccrc_id, generation: e.generation, store_id: e.store_id }));
    expect(canon).toEqual([...canon].sort());
    const sha = createHash('sha256').update(`[${canon.join(',')}]`, 'utf8').digest('hex');
    expect(gate6.assignmentSha256(list)).toBe(sha);
    expect(gate6.assignmentSha256([...list].reverse())).toBe(sha);
    const tampered = list.map((e, i) => (i === 0 ? { ...e, arm: e.arm === 'treatment' ? 'control' : 'treatment' } : e));
    expect(gate6.assignmentSha256(tampered)).not.toBe(sha);
    expect(() => gate6.assignArms(SEED6, [TWELVE[0]!, TWELVE[0]!])).toThrow(/is listed twice/);
  });

  it('RP7-pure: one ccrc id string on two stores is two families with two independent draws (this seed gives them different arms)', () => {
    const a = fam6(STORE6_A, 'wrap-a-proj-a');
    const b = fam6(STORE6_B, 'wrap-a-proj-a');
    expect(gate6.armOf(SEED6, a)).toBe('control');
    expect(gate6.armOf(SEED6, b)).toBe('treatment');
    expect(gate6.assignArms(SEED6, [a, b])).toHaveLength(2);
  });

  it('betaDraw has mean p and variance p (1 - p) rho; rho 0 gives p and draws nothing', () => {
    const rng = gate6.substream(SEED6, 'q18');
    expect(gate6.betaDraw(rng, 0.3, 0)).toBe(0.3);
    expect(rng.nextU32(), 'rho 0 took no word').toBe(gate6.substream(SEED6, 'q18').nextU32());
    const draws = Array.from({ length: 4000 }, () => gate6.betaDraw(rng, 0.3, 0.3));
    const mean = draws.reduce((s, v) => s + v, 0) / draws.length;
    const variance = draws.reduce((s, v) => s + (v - mean) ** 2, 0) / (draws.length - 1);
    expect(mean).toBeGreaterThan(0.28);
    expect(mean).toBeLessThan(0.32);
    expect(variance).toBeGreaterThan(0.055);
    expect(variance).toBeLessThan(0.071);
    expect(draws.every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it('binomialDraw stays in [0, n], gives 0 at p 0 and n at p 1, and has mean n p', () => {
    const rng = gate6.substream(SEED6, 'q18');
    expect(gate6.binomialDraw(rng, 10, 0)).toBe(0);
    expect(gate6.binomialDraw(rng, 10, 1)).toBe(10);
    const draws = Array.from({ length: 2000 }, () => gate6.binomialDraw(rng, 10, 0.3));
    expect(draws.every((k) => Number.isInteger(k) && k >= 0 && k <= 10)).toBe(true);
    const mean = draws.reduce((s, v) => s + v, 0) / draws.length;
    expect(mean).toBeGreaterThan(2.85);
    expect(mean).toBeLessThan(3.15);
  });

  it('expected windows are round(windows * planned_days / covered_days), and a family expecting 0 is dropped', () => {
    expect(gate6.expectedWindows([
      { key: 'k1', windows: 3, covered_days: 7 },
      { key: 'k2', windows: 1, covered_days: 28 },
      { key: 'k3', windows: 1, covered_days: 30 },
      { key: 'k4', windows: 0, covered_days: 14 },
    ], 14)).toEqual([{ key: 'k1', n: 6 }, { key: 'k2', n: 1 }]);
    expect(() => gate6.expectedWindows([{ key: 'k1', windows: 3, covered_days: 0 }], 14)).toThrow(/positive covered_days/);
  });

  const Q18_FAMILIES = Array.from({ length: 12 }, (_, i) => ({ key: `fam-${String(i).padStart(2, '0')}`, windows: 4 + (i % 4), covered_days: 14 }));
  const q18Input = (o: Partial<Parameters<typeof gate6.q18Power>[0]> = {}): Parameters<typeof gate6.q18Power>[0] =>
    ({ families: Q18_FAMILIES, plannedDays: 14, seedHex: SEED6, rho: 0.3, power: 0.5, sims: 24, gridStep: 0.05, B: 200, ...o });

  it('Q18 is deterministic for small injected S and B, and another seed gives other shares', () => {
    const once = gate6.q18Power(q18Input());
    expect(gate6.q18Power(q18Input())).toEqual(once);
    expect(once.procedure).toBe('bisection-on-grid-crn');
    expect(gate6.q18Power(q18Input({ seedHex: OTHER_SEED6 })).points).not.toEqual(once.points);
  });

  it('Q18\'s figure is a grid point at least X whose share and upper neighbour\'s share reach the power level, and the point below it does not', () => {
    const step = q18Input().gridStep;
    const x = gate6.X.num / gate6.X.den;
    // 0.95 is a level where this fixture's shares are not monotone in p (0.55 passes, 0.6 does not), so the
    // upper-neighbour clause decides the figure there.
    for (const power of [...gate6.Q18_DEFAULTS.power, 0.95]) {
      const r = gate6.q18Power(q18Input({ power }));
      expect(r.figure, `power ${power}`).not.toBeNull();
      const fig = r.figure!;
      expect(fig).toBeGreaterThanOrEqual(x);
      const at = (p: number): number | undefined => r.points.find((q) => Math.abs(q.p - p) < 1e-9)?.share;
      expect(at(fig), `power ${power}: the figure's own share`).toBeGreaterThanOrEqual(power);
      const up = at(fig + step);
      if (fig < 1 - 1e-9) expect(up !== undefined && up >= power, `power ${power}: its upper neighbour's share (${up}) reaches it`).toBe(true);
      const below = at(fig - step);
      if (fig > x + 1e-9) expect(below !== undefined && below < power, `power ${power}: the point below's share (${below}) misses it`).toBe(true);
      expect(r.points.map((q) => q.p)).toEqual(r.points.map((q) => q.p).sort((a, b) => a - b));
    }
  });

  it('Q18 answers null, never a number, when no family expects a window or the top of the grid misses the power level', () => {
    expect(gate6.q18Power(q18Input({ families: [{ key: 'fam-00', windows: 1, covered_days: 30 }] })))
      .toEqual({ figure: null, procedure: 'bisection-on-grid-crn', points: [] });
    const one = gate6.q18Power(q18Input({ families: [{ key: 'fam-00', windows: 6, covered_days: 14 }], power: 0.8 }));
    expect(one.figure).toBeNull();
    expect(one.points).toHaveLength(1);
    expect(one.points[0]!.p).toBe(1);
    expect(one.points[0]!.share).toBeLessThan(0.8);
  });

  it('Q18_DEFAULTS are part 1\'s q18_settings, and the grid must divide the span from X to 1', () => {
    expect(gate6.Q18_DEFAULTS).toEqual({ rho_headline: 0.3, power: [0.5, 0.8], lookback_days: 14, sims: 1000, grid_step: 0.005, procedure: 'bisection-on-grid-crn' });
    expect(Object.isFrozen(gate6.Q18_DEFAULTS)).toBe(true);
    expect(() => gate6.q18Power(q18Input({ gridStep: 0.07 }))).toThrow(/does not divide 1 - x/);
  });

  it('no Task 6 function takes a default seed: every seed is a parameter', () => {
    const src = readFileSync(path.join(ROOT, 'deploy', 'history-gate.mjs'), 'utf8');
    const DEFAULT_SEED = /[(,{]\s*seedHex\s*=(?!=)/;
    expect(src.split('\n').filter((l) => DEFAULT_SEED.test(l))).toEqual([]);
    expect(DEFAULT_SEED.test('export function armOf(seedHex = SEED, f) {'), 'CONTROL: the needle sees a default parameter').toBe(true);
    expect(DEFAULT_SEED.test('export function q18Power({ families, seedHex = SEED }) {'), 'CONTROL: and a destructured one').toBe(true);
    expect(DEFAULT_SEED.test("  if (typeof seedHex !== 'string' || seedHex === '') throw"), 'CONTROL: a comparison is not a default').toBe(false);
  });

  // ── Edge pins (added after the brief's cases): each walks a guard or comparison the cases above leave unpinned ──
  it('Edge: a state word must be a u32 (not negative, not fractional), and only the ALL-zero state is refused', () => {
    expect(() => gate6.xoshiro128ss([-1, 2, 3, 4])).toThrow(/four u32 words/);
    expect(() => gate6.xoshiro128ss([1.5, 2, 3, 4])).toThrow(/four u32 words/);
    expect(() => gate6.xoshiro128ss([1, 2, 3, 4, 5] as unknown as [number, number, number, number])).toThrow(/four u32 words/);
    expect(() => gate6.xoshiro128ss([0, 0, 0, 1])).not.toThrow();
    expect(() => gate6.xoshiro128ss([1, 2, 3, 0])).not.toThrow();
    expect(() => gate6.xoshiro128ss([0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff])).not.toThrow();
  });

  it('Edge: a substream seed must be a string, a label that is not a string is no label', () => {
    expect(() => gate6.substream(5 as unknown as string, 'q18')).toThrow(/the seed is a non-empty string/);
    expect(() => gate6.substream(SEED6, undefined as unknown as string)).toThrow(/is not a substream label/);
  });

  it('Edge: randInt redraws a word EQUAL to the limit and keeps limit - 1; n = 2^32 is allowed, 0 and 2^32 + 1 and 1.5 are not', () => {
    const n = 3 * 2 ** 30;   // the limit is n itself
    const at = scripted([n, 5]);
    expect(gate6.randInt(at, n)).toBe(5);
    expect(at.used()).toBe(2);
    const below = scripted([n - 1, 5]);
    expect(gate6.randInt(below, n)).toBe(n - 1);
    expect(below.used()).toBe(1);
    expect(gate6.randInt(scripted([2 ** 32 - 1]), 2 ** 32)).toBe(2 ** 32 - 1);
    expect(gate6.randInt(scripted([123]), 1)).toBe(0);
    // a scripted rng throws when dry, so a guard that is gone cannot hang the case
    for (const bad of [0, 2 ** 32 + 1, 1.5, -3, Number.NaN]) expect(() => gate6.randInt(scripted([1, 2, 3]), bad), String(bad)).toThrow(/is not an integer in \[1, 2\^32\]/);
  });

  it('Edge: nearest-rank bounds at the exact multiples and one past, and B must be a positive integer', () => {
    expect(gate6.nearestRankBounds(1)).toEqual({ lowRank: 1, highRank: 1 });
    expect(gate6.nearestRankBounds(40)).toEqual({ lowRank: 1, highRank: 39 });
    expect(gate6.nearestRankBounds(41)).toEqual({ lowRank: 2, highRank: 40 });
    expect(gate6.nearestRankBounds(1000)).toEqual({ lowRank: 25, highRank: 975 });
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => gate6.nearestRankBounds(bad), String(bad)).toThrow(/is not a positive integer/);
    expect(() => gate6.clusterBootstrap({ clusters: [{ num: 1, den: 2 }], B: 0, rng: scripted([]), mode: 'share' })).toThrow(/is not a positive integer/);
  });

  it('Edge: the interval is the sorted replicates at ranks 1 and 30 of B = 30, drawn B x m words and no more', () => {
    // two clusters {0/1, 1/1}: a replicate picks one of them twice, so it is 0/2, 1/2 or 2/2. Word 0 picks cluster 0, 1 picks cluster 1.
    const clusters = [{ num: 0, den: 1 }, { num: 1, den: 1 }];
    const words: number[] = [];
    for (let b = 0; b < 30; b++) words.push(...(b === 10 ? [0, 0] : b === 20 ? [1, 1] : [0, 1]));
    const r = scripted(words);
    const out = gate6.clusterBootstrap({ clusters, B: 30, rng: r, mode: 'share' });
    expect(r.used()).toBe(60);
    expect(out.point).toEqual({ num: 1, den: 2 });
    expect(out.lower).toEqual({ num: 0, den: 2 });
    expect(out.upper).toEqual({ num: 2, den: 2 });
    // the same rank bounds one replicate in: the extremes at the 2nd place and 2nd from the top are not the interval
    const inner: number[] = [];
    for (let b = 0; b < 30; b++) inner.push(...(b === 10 || b === 11 ? [0, 0] : b === 20 || b === 21 ? [1, 1] : [0, 1]));
    const o2 = gate6.clusterBootstrap({ clusters, B: 30, rng: scripted(inner), mode: 'share' });
    expect([o2.lower, o2.upper]).toEqual([{ num: 0, den: 2 }, { num: 2, den: 2 }]);
  });

  it('Edge: a cluster that is not a count is refused at every bound, in both modes, and an unknown mode is refused', () => {
    const share = (num: number, den: number): unknown => gate6.clusterBootstrap({ clusters: [{ num, den }], B: 10, rng: scripted([]), mode: 'share' });
    expect(() => share(3, 2)).toThrow(/is not a share cluster/);
    expect(() => share(-1, 2)).toThrow(/is not a share cluster/);
    expect(() => share(1, -2)).toThrow(/is not a share cluster/);
    expect(() => share(0.5, 2)).toThrow(/is not a share cluster/);
    const substreamFor = (): { nextU32: () => number } => gate6.substream(SEED6, 'quiz-ci');
    const paired = (t: number, c: number, n: number): unknown => gate6.clusterBootstrap({ clusters: [{ t, c, n }], B: 10, rng: substreamFor(), mode: 'paired' });
    expect(() => paired(4, 1, 3)).toThrow(/is not a paired cluster/);
    expect(() => paired(1, 4, 3)).toThrow(/is not a paired cluster/);
    expect(() => paired(-1, 0, 3)).toThrow(/is not a paired cluster/);
    expect(() => paired(1, -1, 3)).toThrow(/is not a paired cluster/);
    expect(() => paired(1, 0, -3)).toThrow(/is not a paired cluster/);
    expect(() => paired(1.5, 0, 3)).toThrow(/is not a paired cluster/);
    expect(() => paired(3, 3, 3)).not.toThrow();   // t = c = n is allowed: the bound is inclusive
    expect(() => gate6.clusterBootstrap({ clusters: [{ num: 1, den: 2 }] as never, B: 10, rng: scripted([]), mode: 'paired' })).toThrow(/is not a paired cluster/);
    expect(() => gate6.clusterBootstrap({ clusters: [{ num: 1, den: 2 }], B: 10, rng: scripted([]), mode: 'mean' as never })).toThrow(/neither paired nor share/);
  });

  it('Edge: a paired replicate can be negative, and the order stays exact for negative products past 2^53', () => {
    const p = gate6.clusterBootstrap({ clusters: [{ t: 0, c: 2, n: 3 }], B: 10, rng: gate6.substream(SEED6, 'quiz-ci'), mode: 'paired' });
    expect(p.point).toEqual({ num: -2, den: 3 });
    expect(p.lower).toEqual({ num: -2, den: 3 });
    expect(p.upper).toEqual({ num: -2, den: 3 });
    const big = 2 ** 53;
    expect(gate6.cmpFrac(gate6.frac(-(big - 1), big - 2), gate6.frac(-(big - 2), big - 3))).toBe(1);
    expect(gate6.cmpFrac(gate6.frac(-(big - 2), big - 3), gate6.frac(-(big - 1), big - 2))).toBe(-1);
  });

  it('Edge: frac is frozen and refuses a negative or NaN denominator', () => {
    expect(Object.isFrozen(gate6.frac(1, 2))).toBe(true);
    expect(gate6.frac(-3, 4)).toEqual({ num: -3, den: 4 });
    for (const [n, d] of [[1, -1], [1, Number.NaN], [Number.NaN, 1], [2 ** 53, 1], [1, Infinity]] as Array<[number, number]>) {
      expect(() => gate6.frac(n, d), `${n}/${d}`).toThrow(/not an exact fraction/);
    }
  });

  it('Edge: an arm needs a non-empty string seed and a whole family, each field a string', () => {
    const f = fam6(STORE6_A, 'wrap-a-proj-a');
    expect(() => gate6.armOf('', f)).toThrow(/the seed is a non-empty string/);
    expect(() => gate6.armOf(5 as unknown as string, f)).toThrow(/the seed is a non-empty string/);
    for (const bad of [null, undefined, 'x', 7, { ...f, store_id: 7 }, { ...f, ccrc_id: null }, { ...f, generation: 3 }, { ccrc_id: 'c', generation: G1 }, { store_id: 's', generation: G1 }, { store_id: 's', ccrc_id: 'c' }]) {
      expect(() => gate6.armOf(SEED6, bad as never), JSON.stringify(bad)).toThrow(/is not a family/);
    }
    expect(() => gate6.assignArms(SEED6, [null as never])).toThrow(/is not a family/);
  });

  it('Edge: an empty list assigns nothing and hashes the empty array', () => {
    expect(gate6.assignArms(SEED6, [])).toEqual([]);
    expect(gate6.assignmentSha256([])).toBe(createHash('sha256').update('[]', 'utf8').digest('hex'));
    const one = fam6(STORE6_A, 'wrap-a-proj-a');
    const [e] = gate6.assignArms(SEED6, [one]);
    expect(Object.keys(e!).sort()).toEqual(['arm', 'ccrc_id', 'generation', 'store_id']);
    expect(gate6.assignArms(SEED6, [{ ...one, extra: 1 } as never])[0]).toEqual(e);
  });

  it('Edge: a uniform is strictly above 0 (the half step), so a probability below one half-step never succeeds on the all-zero words', () => {
    expect(gate6.binomialDraw(scripted([0, 0]), 1, 1e-17)).toBe(0);   // half a step is 5.55e-17
    expect(gate6.binomialDraw(scripted([0, 0]), 1, 1e-16)).toBe(1);
  });

  it('Edge: betaDraw refuses a mean or a rho outside range, returns a mean of 0 or 1 without a draw, and at rho near 1 answers an endpoint, never NaN', () => {
    for (const bad of [-0.1, 1.5, Number.NaN]) expect(() => gate6.betaDraw(scripted([]), bad, 0.3), `mean ${bad}`).toThrow(/is outside \[0, 1\]/);
    for (const bad of [-0.1, 1, 1.5, Number.NaN]) expect(() => gate6.betaDraw(scripted([]), 0.3, bad), `rho ${bad}`).toThrow(/is outside \[0, 1\)/);
    expect(gate6.betaDraw(scripted([]), 0, 0.3)).toBe(0);
    expect(gate6.betaDraw(scripted([]), 1, 0.3)).toBe(1);
    const rng = gate6.substream(SEED6, 'q18');
    const draws = Array.from({ length: 200 }, () => gate6.betaDraw(rng, 0.3, 1 - 1e-12));
    expect(draws.every((v) => v === 0 || v === 1), 'every draw is an endpoint').toBe(true);
    const ones = draws.filter((v) => v === 1).length;
    expect(ones).toBeGreaterThan(30);   // 200 draws at 0.3: mean 60, sd 6.5
    expect(ones).toBeLessThan(90);
  });

  it('Edge: binomialDraw takes 2n words whatever p, draws nothing at n = 0, and refuses a non-count or a p outside [0, 1]', () => {
    for (const p of [0, 0.3, 1]) {
      const r = scripted([1, 2, 3, 4, 5, 6]);
      gate6.binomialDraw(r, 3, p);
      expect(r.used(), `p ${p}`).toBe(6);
    }
    expect(gate6.binomialDraw(scripted([]), 0, 0.5)).toBe(0);
    for (const bad of [-1, 1.5, Number.NaN]) expect(() => gate6.binomialDraw(scripted([]), bad, 0.5), `n ${bad}`).toThrow(/is not a count/);
    for (const bad of [-0.1, 1.1, Number.NaN]) expect(() => gate6.binomialDraw(scripted([1, 2]), 1, bad), `p ${bad}`).toThrow(/is outside \[0, 1\]/);
  });

  it('Edge: expected windows refuse a non-positive plan, a negative or fractional count and a negative covered_days, and rounding is half-up', () => {
    const one = (o: object): unknown => gate6.expectedWindows([{ key: 'k', windows: 3, covered_days: 7, ...o }], 14);
    expect(() => gate6.expectedWindows([{ key: 'k', windows: 3, covered_days: 7 }], 0)).toThrow(/planned_days 0 is not positive/);
    expect(() => gate6.expectedWindows([{ key: 'k', windows: 3, covered_days: 7 }], -14)).toThrow(/is not positive/);
    expect(() => one({ windows: -1 })).toThrow(/positive covered_days/);
    expect(() => one({ windows: 1.5 })).toThrow(/positive covered_days/);
    expect(() => one({ covered_days: -7 })).toThrow(/positive covered_days/);
    expect(() => one({ covered_days: Number.NaN })).toThrow(/positive covered_days/);
    expect(gate6.expectedWindows([{ key: 'k', windows: 5, covered_days: 28 }], 14)).toEqual([{ key: 'k', n: 3 }]);   // 2.5 rounds up
    expect(gate6.expectedWindows([], 14)).toEqual([]);
  });

  it('Edge: Q18_DEFAULTS.power is frozen too', () => {
    expect(Object.isFrozen(gate6.Q18_DEFAULTS.power)).toBe(true);
  });

  it('Edge: Q18 refuses a power, sims, B, x or step outside range, and a step as wide as the whole span is one interval', () => {
    for (const bad of [0, -0.5, 1.01, Number.NaN]) expect(() => gate6.q18Power(q18Input({ power: bad })), `power ${bad}`).toThrow(/is outside \(0, 1\]/);
    for (const bad of [0, -1, 1.5]) expect(() => gate6.q18Power(q18Input({ sims: bad })), `sims ${bad}`).toThrow(/is not a positive integer/);
    expect(() => gate6.q18Power(q18Input({ B: 0 }))).toThrow(/is not a positive integer/);
    // checked up front, not only when a simulation first bootstraps: no family expecting a window never bootstraps
    expect(() => gate6.q18Power(q18Input({ B: 0, families: [{ key: 'fam-00', windows: 1, covered_days: 30 }] }))).toThrow(/is not a positive integer/);
    expect(() => gate6.q18Power(q18Input({ x: gate6.frac(0, 1) }))).toThrow(/x lies outside \(0, 1\)/);
    expect(() => gate6.q18Power(q18Input({ x: gate6.frac(1, 1) }))).toThrow(/x lies outside \(0, 1\)/);
    expect(() => gate6.q18Power(q18Input({ x: gate6.frac(3, 2) }))).toThrow(/x lies outside \(0, 1\)/);
    for (const bad of [0, -0.05, 0.95, Number.NaN]) expect(() => gate6.q18Power(q18Input({ gridStep: bad })), `step ${bad}`).toThrow(/does not divide 1 - x/);
    expect(() => gate6.q18Power(q18Input({ power: 1 }))).not.toThrow();
    const wide = gate6.q18Power(q18Input({ gridStep: 0.9, power: 0.001 }));
    expect(wide.points.map((q) => q.p)).toEqual([0.1, 1]);
  });

  /** One family expecting 2 windows, rho 0 (so p_f is p itself), x = 1/2, a grid of 1/2 and 1. */
  const oneFamily = (o: object = {}): ReturnType<typeof gate6.q18Power> =>
    gate6.q18Power({ families: [{ key: 'f', windows: 2, covered_days: 14 }], plannedDays: 14, seedHex: SEED6, rho: 0, power: 0.2, sims: 400, gridStep: 0.5, B: 20, x: gate6.frac(1, 2), ...o });

  it('Edge: a simulation whose lower bound EQUALS x passes (>=, not >), and the smallest passing point can be x itself', () => {
    // At p = 1/2 a family treated with k = 1 of 2 has the lower bound 1/2 exactly, a tie with x. Passing shares: k >= 1 is 1/2 * 3/4, k = 2 alone is 1/2 * 1/4.
    const r = oneFamily();
    const at = (p: number): number => r.points.find((q) => Math.abs(q.p - p) < 1e-9)!.share;
    expect(at(0.5)).toBeGreaterThan(0.25);
    expect(at(0.5)).toBeLessThan(0.5);
    expect(at(1)).toBeGreaterThan(0.35);   // p = 1: every treated simulation passes, 1/2 of them
    expect(at(1)).toBeLessThan(0.65);
    expect(r.figure).toBe(0.5);
    expect(r.points.map((q) => q.p)).toEqual([0.5, 1]);
  });

  it('Edge: a share equal to the power level passes, and one a hair above misses', () => {
    const base = oneFamily();
    const top = base.points.find((q) => q.p === 1)!.share;
    expect(oneFamily({ power: top }).figure).not.toBeNull();
    expect(oneFamily({ power: top + 1e-9 }).figure).toBeNull();
  });

  it('Edge: the first word of the q18 stream decides the first family\'s arm (odd is treatment), and the order families arrive in changes nothing', () => {
    const seeds = [SEED6, OTHER_SEED6, 'aa'.repeat(32), 'bb'.repeat(32), 'cc'.repeat(32), 'dd'.repeat(32)];
    const parities = new Set<number>();
    for (const seed of seeds) {
      const first = gate6.substream(seed, 'q18').nextU32() & 1;
      parities.add(first);
      // one family of 1 window, rho 0, p = 1: the single simulation passes iff the family is treated
      const r = gate6.q18Power({ families: [{ key: 'f', windows: 1, covered_days: 14 }], plannedDays: 14, seedHex: seed, rho: 0, power: 1, sims: 1, gridStep: 0.9, B: 20 });
      expect(r.points.find((q) => q.p === 1)!.share, seed.slice(0, 4)).toBe(first);
    }
    expect(parities.size, 'CONTROL: the seeds cover both parities').toBe(2);
    expect(gate6.q18Power(q18Input({ families: [...Q18_FAMILIES].reverse() }))).toEqual(gate6.q18Power(q18Input()));
  });

  // ── Fix round 1 pins ──
  it('Fix 1: a simulation passes on the bootstrap\'s LOWER bound: at p = x with several treated families the lower bound sits below x while the point sits at it', () => {
    // 8 families of 10 windows, rho 0, x = 1/2, grid {1/2, 1}. At p = 1/2 the pooled point is near 1/2 and the lower bound is
    // well below it, so few simulations pass on .lower and about half on .point; at p = 1 every treated one passes.
    const families = Array.from({ length: 8 }, (_, i) => ({ key: `fam-${i}`, windows: 10, covered_days: 14 }));
    const r = gate6.q18Power({ families, plannedDays: 14, seedHex: SEED6, rho: 0, power: 0.5, sims: 400, gridStep: 0.5, B: 200, x: gate6.frac(1, 2) });
    const at = (p: number): number => r.points.find((q) => Math.abs(q.p - p) < 1e-9)!.share;
    expect(at(0.5)).toBeGreaterThan(0.1);
    expect(at(0.5)).toBeLessThan(0.32);   // measured 0.2025 on .lower, 0.5725 on .point, 0.9125 on .upper
    expect(at(1)).toBeGreaterThan(0.95);   // 1 - 2^-8 of simulations have a treated family, and then lower = 1
    expect(r.figure).toBe(1);
  });

  const SEEDS40 = Array.from({ length: 40 }, (_, i) => i.toString(16).padStart(2, '0').repeat(32));

  it('Fix 3a: every grid point restarts the q18 stream: each point\'s share follows the stream\'s first words', () => {
    // one family of 1 window, rho 0, x = 1/2, grid {1/2, 1}. Word 0 is the flip, words 1 and 2 are the one Bernoulli trial.
    const u = (w1: number, w2: number): number => ((w1 >>> 5) * 67108864 + (w2 >>> 6) + 0.5) / 9007199254740992;
    let hits = 0;
    for (const seed of SEEDS40) {
      const rng = gate6.substream(seed, 'q18');
      const [w0, w1, w2] = [rng.nextU32(), rng.nextU32(), rng.nextU32()];
      const treated = (w0 & 1) === 1;
      const r = gate6.q18Power({ families: [{ key: 'f', windows: 1, covered_days: 14 }], plannedDays: 14, seedHex: seed, rho: 0, power: 0.001, sims: 1, gridStep: 0.5, B: 20, x: gate6.frac(1, 2) });
      const at = (p: number): number | undefined => r.points.find((q) => Math.abs(q.p - p) < 1e-9)?.share;
      expect(at(1), seed.slice(0, 2)).toBe(treated ? 1 : 0);
      if (treated) {
        const expected = u(w1, w2) < 0.5 ? 1 : 0;
        expect(at(0.5), `${seed.slice(0, 2)}: the second point starts from the same first words`).toBe(expected);
        hits += expected;
      } else {
        expect(at(0.5), 'an untreated first point misses the power level, so the lower point is never evaluated').toBeUndefined();
      }
    }
    expect(hits, 'CONTROL: the seeds include a treated family whose trial succeeds').toBeGreaterThan(2);
  });

  it('Fix 3b: a control family still draws its p_f and its 2n Binomial words, so the next family\'s flip is the same word either way', () => {
    // family "a" expects 2 windows (rho 0: no Beta words; 1 flip word + 4 trial words), family "b" expects 1. With p = 1 a treated family always
    // passes, so the share is whether "a" (word 0) or "b" (word 5) is treated.
    let differs = 0;
    for (const seed of SEEDS40) {
      const rng = gate6.substream(seed, 'q18');
      const w = Array.from({ length: 6 }, () => rng.nextU32());
      const r = gate6.q18Power({
        families: [{ key: 'b', windows: 1, covered_days: 14 }, { key: 'a', windows: 2, covered_days: 14 }],
        plannedDays: 14, seedHex: seed, rho: 0, power: 1, sims: 1, gridStep: 0.9, B: 20,
      });
      const expected = ((w[0]! & 1) === 1 || (w[5]! & 1) === 1) ? 1 : 0;
      expect(r.points.find((q) => q.p === 1)!.share, seed.slice(0, 2)).toBe(expected);
      if ((w[0]! & 1) === 0 && (w[1]! & 1) !== (w[5]! & 1)) differs += 1;
    }
    expect(differs, 'CONTROL: the seeds include a control "a" whose skipped words would move "b"\'s flip').toBeGreaterThan(2);
  });

  it('Fix 4: a repeated family key is refused, and so is one among families that expect no window', () => {
    const dup = [{ key: 'fam-00', windows: 4, covered_days: 14 }, { key: 'fam-01', windows: 4, covered_days: 14 }, { key: 'fam-00', windows: 6, covered_days: 14 }];
    expect(() => gate6.q18Power(q18Input({ families: dup }))).toThrow(TypeError);
    expect(() => gate6.q18Power(q18Input({ families: dup }))).toThrow(/family key fam-00 is listed twice/);
    const idle = [{ key: 'z', windows: 1, covered_days: 30 }, { key: 'z', windows: 1, covered_days: 30 }];
    expect(() => gate6.q18Power(q18Input({ families: idle }))).toThrow(/is listed twice/);
  });

  it('Fix 5: every parameter is validated before the empty answer: a missing seed or a bad rho is refused when no family expects a window', () => {
    const idle = [{ key: 'z', windows: 1, covered_days: 30 }];
    expect(() => gate6.q18Power(q18Input({ families: idle, seedHex: '' }))).toThrow(TypeError);
    expect(() => gate6.q18Power(q18Input({ families: idle, seedHex: undefined as unknown as string }))).toThrow(/the seed is a non-empty string/);
    for (const bad of [Number.NaN, -0.1, 1, 2]) expect(() => gate6.q18Power(q18Input({ families: idle, rho: bad })), `rho ${bad}`).toThrow(/rho .* is outside \[0, 1\)/);
    expect(() => gate6.q18Power(q18Input({ families: [], plannedDays: 0 }))).toThrow(/is not positive/);
    expect(gate6.q18Power(q18Input({ families: idle, rho: 0 }))).toEqual({ figure: null, procedure: 'bisection-on-grid-crn', points: [] });
  });

  /** The next double above x (x > 0). */
  const nextUp = (x: number): number => {
    const f = new Float64Array([x]);
    const bits = new BigUint64Array(f.buffer);
    bits[0]! += 1n;
    return f[0]!;
  };
  /** True when the uniform made of these two words is exactly `expected`: p = expected misses, the next double up hits. */
  const uniformIs = (words: [number, number], expected: number): boolean =>
    gate6.binomialDraw(scripted([...words]), 1, expected) === 0 && gate6.binomialDraw(scripted([...words]), 1, nextUp(expected)) === 1;

  it('Fix 6: the largest uniform is 1 - 2^-53, never 1: the all-ones words and the next pair down', () => {
    const top = 1 - 2 ** -53;
    expect(uniformIs([0xffffffff, 0xffffffff], top)).toBe(true);
    expect(gate6.binomialDraw(scripted([0xffffffff, 0xffffffff]), 1, 1), 'a probability-1 trial always succeeds').toBe(1);
    // a = 2^27 - 1, b = 2^26 - 2: the sum 2^53 - 1.5 rounds (to even) to 2^53 - 2
    expect(uniformIs([0xffffffff, 0xffffff80], 1 - 2 ** -52)).toBe(true);
    expect(uniformIs([0xffffffff, 0xffffffbf], 1 - 2 ** -52)).toBe(true);   // the low 6 bits of the second word are dropped
  });

  it('Fix 7: the uniform\'s bit layout: 27 bits from the first word, 26 from the second, half a step above', () => {
    expect(uniformIs([0x00000020, 0x00000040], 67108865.5 / 9007199254740992)).toBe(true);   // a = 1, b = 1
    expect(uniformIs([0x7fffffe0, 0xffffffff], 4503599627370495.5 / 9007199254740992)).toBe(true);   // a = 2^26 - 1, b = 2^26 - 1
    expect(uniformIs([0x00000000, 0x00000000], 0.5 / 9007199254740992)).toBe(true);
    expect(uniformIs([0x00000000, 0xffffffff], 67108863.5 / 9007199254740992)).toBe(true);   // b alone: 2^26 - 1
    expect(uniformIs([0x00000040, 0x00000000], 134217728.5 / 9007199254740992)).toBe(true);   // a = 2
  });
});

// ── W2-3 Task 7: the quiz labeller and its texts (W2-D60 to W2-D64, W2-D72, W2-D79) ─────────────────────────────
// Pure: every case calls deploy/history-gate.mjs with literals and reads no store. Departures: D-5776 (the single
// ANSWER field), D-5777 (a 7-character SHA prefix is correct by default), D-5778 (both rubrics widen `uncertain`),
// D-5779 (the writer sees an excerpt by default). The SHA fixtures are built at runtime from a repeated chunk, so no
// 40-character hex literal sits in this file.
import * as t7Gate from '../../deploy/history-gate.mjs';
import { sha256Hex as t7Sha256Hex } from '../../ccd/history/lib.mjs';

describe('W2-3 Task 7: the quiz labeller and its texts', () => {
  const ROOT_R = { repoRoots: ['/r'] };
  const NO_ROOTS = { repoRoots: [] as string[] };
  const SHA40 = '3f9a1c7e2b'.repeat(4);
  const F9 = SHA40.slice(0, 9);
  const at7 = { repoRoots: [] as string[], shaMinPrefix: 7 as const };
  const at40 = { repoRoots: [] as string[], shaMinPrefix: 40 as const };
  const pathAt7 = { repoRoots: ['/r'], shaMinPrefix: 7 as const };
  const CMD39 = 'npm run build -- --filter=pkg-a --watch';
  const CMD50 = 'git push --force-with-lease origin topic-branch-a1';

  it('CONTROL: the fixtures have the lengths the cases below rely on, and Task 2 declared the words this task reads', () => {
    expect([SHA40.length, F9.length, CMD39.length, CMD50.length]).toEqual([40, 9, 39, 50]);
    expect(t7Gate.FACT_KINDS).toEqual(['sha', 'path', 'command', 'error']);
    expect(t7Gate.SHA_MIN_PREFIXES).toEqual([7, 40]);
    expect([...t7Gate.RUBRIC_IDS].sort()).toEqual(['v1', 'v1-strict']);
    expect([...t7Gate.ANSWER_STATES].sort()).toEqual(['absent', 'unknown', 'value']);
    expect(t7Gate.GATE_REASONS).toEqual(expect.arrayContaining(['writer-malformed', 'writer-leak']));
    expect(t7Gate.LABELLER).toEqual({ sha_admit_prefix: 7, path_min: 8, window: 40,
      path_forms: ['absolute', 'repo-relative', 'tail', 'basename'], boundaries: 'v1' });
    expect(Object.isFrozen(t7Gate.LABELLER) && Object.isFrozen(t7Gate.LABELLER.path_forms)).toBe(true);
  });

  it('collapseWs turns every run of Unicode whitespace into one space and trims', () => {
    const [nbsp, em, ls] = [0xa0, 0x2003, 0x2028].map((c) => String.fromCodePoint(c));
    expect(t7Gate.collapseWs(`${nbsp} git\t\tstatus\n${em} --short ${ls}`)).toBe('git status --short');
  });

  describe('admitFact (W2-D62): a plain substring test, no token boundaries', () => {
    it('sha: a 6-character prefix in B admits, and a 7-character one rejects', () => {
      expect(t7Gate.admitFact('sha', F9, `checked out ${F9.slice(0, 6)} earlier`, 'q', NO_ROOTS))
        .toEqual({ admitted: true, hit: null });
      expect(t7Gate.admitFact('sha', F9, `checked out ${F9.slice(0, 7)} earlier`, 'q', NO_ROOTS))
        .toEqual({ admitted: false, hit: { where: 'baseline', variant: F9.slice(0, 7) } });
    });

    it('sha: a 40-character SHA in B rejects a 9-character F, in either case', () => {
      expect(t7Gate.admitFact('sha', F9, `merged ${SHA40}`, 'q', NO_ROOTS).admitted).toBe(false);
      expect(t7Gate.admitFact('sha', F9, `MERGED ${SHA40.toUpperCase()}`, 'q', NO_ROOTS).admitted).toBe(false);
    });

    it('path: a repo-relative tail rejects; the 6-character basename alone does not', () => {
      const F = '/w/proj/src/deep/mod.ts';
      expect(t7Gate.admitFact('path', F, 'opened deep/mod.ts', 'q', { repoRoots: ['/w/proj'] }))
        .toEqual({ admitted: false, hit: { where: 'baseline', variant: 'deep/mod.ts' } });
      expect(t7Gate.admitFact('path', F, 'opened mod.ts', 'q', { repoRoots: ['/w/proj'] }).admitted).toBe(true);
    });

    it('path: F=/r/lib/x.c with lib/x.c in B rejects (a tail has no length floor)', () => {
      expect(t7Gate.admitFact('path', '/r/lib/x.c', 'see lib/x.c', 'q', NO_ROOTS))
        .toEqual({ admitted: false, hit: { where: 'baseline', variant: 'lib/x.c' } });
    });

    it('path: F=/r/go.mod with go.mod in B and root /r rejects (a repo-relative form has no length floor)', () => {
      expect(t7Gate.admitFact('path', '/r/go.mod', 'edit go.mod', 'q', ROOT_R))
        .toEqual({ admitted: false, hit: { where: 'baseline', variant: 'go.mod' } });
      expect(t7Gate.admitFact('path', '/r/go.mod', 'edit go.mod', 'q', NO_ROOTS).admitted, 'CONTROL: without the root, go.mod is only a short basename').toBe(true);
    });

    it('path: a 7-character basename alone admits, and an 8-character one rejects', () => {
      expect(t7Gate.admitFact('path', '/r/src/util.ts', 'edit util.ts', 'q', ROOT_R).admitted).toBe(true);
      expect(t7Gate.admitFact('path', '/r/src/utils.ts', 'edit utils.ts', 'q', ROOT_R))
        .toEqual({ admitted: false, hit: { where: 'baseline', variant: 'utils.ts' } });
    });

    it('path: matching is case-sensitive', () => {
      expect(t7Gate.admitFact('path', '/r/src/config.json', 'read src/Config.json', 'q', ROOT_R).admitted).toBe(true);
    });

    it('command: a 39-character command is matched whole', () => {
      expect(t7Gate.factVariants('command', CMD39, NO_ROOTS)).toEqual([CMD39]);
      expect(t7Gate.admitFact('command', CMD39, `ran ${CMD39.slice(0, 38)}`, 'q', NO_ROOTS).admitted).toBe(true);
      expect(t7Gate.admitFact('command', CMD39, `ran ${CMD39}`, 'q', NO_ROOTS))
        .toEqual({ admitted: false, hit: { where: 'baseline', variant: CMD39 } });
    });

    it('command: at 40 characters or more every 40-character window is a variant, and 39 characters of one admit', () => {
      expect(t7Gate.factVariants('command', CMD50, NO_ROOTS)).toHaveLength(11);
      expect(t7Gate.admitFact('command', CMD50, `x ${CMD50.slice(5, 45)} y`, 'q', NO_ROOTS).admitted).toBe(false);
      expect(t7Gate.admitFact('command', CMD50, `x ${CMD50.slice(5, 44)} y`, 'q', NO_ROOTS).admitted).toBe(true);
    });

    it('command and error: B is collapsed too, so a multi-line rendering still rejects', () => {
      const F = 'git rebase --onto main topic-branch';
      expect(t7Gate.admitFact('command', F, 'ran git rebase\n    --onto main   topic-branch', 'q', NO_ROOTS).admitted).toBe(false);
      expect(t7Gate.admitFact('error', 'fatal: bad object HEAD~3', 'fatal:  bad\nobject HEAD~3', 'q', NO_ROOTS).admitted).toBe(false);
    });

    it('W2-D72: a stub question holding a 7-character SHA prefix fails admission at the question (writer-leak)', () => {
      expect(t7Gate.admitFact('sha', F9, 'nothing of it here', `Which commit begins ${F9.slice(0, 7)}?`, NO_ROOTS))
        .toEqual({ admitted: false, hit: { where: 'question', variant: F9.slice(0, 7) } });
    });

    it('a kind outside FACT_KINDS throws: decisions are not sourced (W2-D60)', () => {
      expect(() => t7Gate.factVariants('decision', 'use the queue', NO_ROOTS)).toThrow(/FACT_KINDS|not one of/);
      expect(() => t7Gate.admitFact('decision', 'use the queue', '', '', NO_ROOTS)).toThrow(/not one of/);
    });
  });

  describe('labelCorrect (W2-D63): only the ANSWER value, with boundaries', () => {
    it('sha: a 40-character SHA for a 9-character F is correct, in either case', () => {
      expect(t7Gate.labelCorrect('sha', F9, `It is ${SHA40}.`, at7)).toBe(true);
      expect(t7Gate.labelCorrect('sha', F9, SHA40.toUpperCase(), at7)).toBe(true);
    });

    it('sha: a 9-character run that diverges after 7 shared characters is not correct', () => {
      expect(t7Gate.labelCorrect('sha', F9, `${F9.slice(0, 7)}00`, at7)).toBe(false);
    });

    it('sha: two SHAs are not correct, and a hedged abc1234 or def5678 is not', () => {
      expect(t7Gate.labelCorrect('sha', F9, `${F9} ${'abcdef1'}`, at7)).toBe(false);
      expect(t7Gate.labelCorrect('sha', 'abc1234ffff', 'abc1234 or def5678', at7)).toBe(false);
    });

    it('sha: a hex run joined to a non-hex letter is no run', () => {
      expect(t7Gate.labelCorrect('sha', F9, `${F9}x`, at7)).toBe(false);
    });

    it('sha: each shaMinPrefix value is pinned, and any other throws', () => {
      expect(t7Gate.labelCorrect('sha', SHA40, SHA40.slice(0, 7), at7)).toBe(true);
      expect(t7Gate.labelCorrect('sha', SHA40, SHA40.slice(0, 7), at40)).toBe(false);
      expect(t7Gate.labelCorrect('sha', SHA40, SHA40.slice(0, 39), at40)).toBe(false);
      expect(t7Gate.labelCorrect('sha', SHA40, SHA40, at40)).toBe(true);
      expect(() => t7Gate.labelCorrect('sha', SHA40, SHA40, { repoRoots: [], shaMinPrefix: 12 as unknown as 7 })).toThrow(/shaMinPrefix/);
    });

    it('path: src/app.tsx for src/app.ts is not correct; src/app.ts and a final period are', () => {
      const F = '/r/src/app.ts';
      expect(t7Gate.labelCorrect('path', F, 'src/app.tsx', pathAt7)).toBe(false);
      expect(t7Gate.labelCorrect('path', F, 'src/app.ts', pathAt7)).toBe(true);
      expect(t7Gate.labelCorrect('path', F, 'It is /r/src/app.ts.', pathAt7)).toBe(true);
    });

    it('path: the left boundary refuses a form glued to a path character', () => {
      expect(t7Gate.labelCorrect('path', '/r/src/app.ts', '~/r/src/app.ts', { repoRoots: [], shaMinPrefix: 7 })).toBe(false);
    });

    it('path: a short repo-relative form needs its right boundary too', () => {
      expect(t7Gate.labelCorrect('path', '/r/go.mod', 'go.mod', pathAt7)).toBe(true);
      expect(t7Gate.labelCorrect('path', '/r/go.mod', 'go.mod5', pathAt7)).toBe(false);
    });

    it('path: a basename alone is not correct', () => {
      expect(t7Gate.labelCorrect('path', '/r/src/app.ts', 'app.ts', pathAt7)).toBe(false);
    });

    it('path: a second path-shaped token that is not one of F\'s forms makes the answer not correct', () => {
      expect(t7Gate.labelCorrect('path', '/r/src/app.ts', '/r/src/app.ts or /r/src/other.ts', pathAt7)).toBe(false);
      expect(t7Gate.labelCorrect('path', '/r/src/app.ts', '/r/src/app.ts (src/app.ts)', pathAt7), 'CONTROL: two of F\'s own forms').toBe(true);
    });

    it('command: npm run test:e2e for npm run test is not correct', () => {
      expect(t7Gate.labelCorrect('command', 'npm run test', 'npm run test:e2e', at7)).toBe(false);
      expect(t7Gate.labelCorrect('command', 'npm run test', '`npm run test`', at7), 'CONTROL: a backtick is a boundary').toBe(true);
    });

    it('command: the left boundary refuses a glued prefix, and a final period is allowed', () => {
      expect(t7Gate.labelCorrect('command', 'npm run test', 'xnpm run test', at7)).toBe(false);
      expect(t7Gate.labelCorrect('command', 'npm run test', 'Run npm run test.', at7)).toBe(true);
    });

    it('command: the value is collapsed before the match', () => {
      expect(t7Gate.labelCorrect('command', 'npm run test', 'npm  run\ttest', at7)).toBe(true);
    });

    it('command and error: "X or Y" is not correct', () => {
      expect(t7Gate.labelCorrect('command', 'npm run test', 'npm run test or npm run lint', at7)).toBe(false);
      expect(t7Gate.labelCorrect('error', 'fatal: bad object HEAD~3', 'either x OR fatal: bad object HEAD~3', at7)).toBe(false);
      expect(t7Gate.labelCorrect('error', 'fatal: a or b', 'fatal: a or b', at7), 'CONTROL: an "or" inside F is F\'s own').toBe(true);
    });
  });

  describe('the answer protocol and its parser (W2-D64, D-5776)', () => {
    it('the last of two ANSWER lines wins', () => {
      expect(t7Gate.parseAnswerField('ANSWER: abc1234\nthinking again\nANSWER: def5678')).toEqual({ state: 'value', value: 'def5678' });
    });

    it('no ANSWER line is absent, even with F in the reply', () => {
      expect(t7Gate.parseAnswerField(`The commit is ${F9}.`)).toEqual({ state: 'absent' });
      expect(t7Gate.parseAnswerField('answer: x\n  ANSWER: y')).toEqual({ state: 'absent' });
    });

    it('UNKNOWN in any case, quoted or bare, is unknown', () => {
      expect(t7Gate.parseAnswerField('ANSWER: unknown')).toEqual({ state: 'unknown' });
      expect(t7Gate.parseAnswerField('ANSWER: "UNKNOWN"')).toEqual({ state: 'unknown' });
    });

    it('one layer of matching quotes or backticks is stripped, and only one', () => {
      expect(t7Gate.parseAnswerField('ANSWER: `npm run test`')).toEqual({ state: 'value', value: 'npm run test' });
      expect(t7Gate.parseAnswerField('ANSWER: "\'x\'"')).toEqual({ state: 'value', value: "'x'" });
      expect(t7Gate.parseAnswerField('ANSWER: "x`')).toEqual({ state: 'value', value: '"x`' });
    });

    it('a hedged abc1234 or def5678 is a value, and not correct', () => {
      const a = t7Gate.parseAnswerField('ANSWER: abc1234 or def5678');
      expect(a).toEqual({ state: 'value', value: 'abc1234 or def5678' });
      expect(t7Gate.labelCorrect('sha', 'abc1234ffff', (a as { value: string }).value, at7)).toBe(false);
    });

    it('every state it answers is an ANSWER_STATES member, and the protocol never parses as an answer', () => {
      for (const t of ['ANSWER: x', 'ANSWER: UNKNOWN', 'none']) expect(t7Gate.ANSWER_STATES).toContain(t7Gate.parseAnswerField(t).state);
      expect(t7Gate.parseAnswerField(t7Gate.ANSWER_PROTOCOL)).toEqual({ state: 'absent' });
      expect(t7Gate.ANSWER_PROTOCOL).toContain('`ANSWER: <single exact value>`');
      expect(t7Gate.ANSWER_PROTOCOL).toContain('`ANSWER: UNKNOWN`');
    });
  });

  describe('the writer prompt and its reply (W2-D72, D-5779)', () => {
    it('the last QUESTION line is the question, trimmed', () => {
      expect(t7Gate.parseQuestionLine('QUESTION: first?\nQUESTION:  Which command rebuilt the cache?  '))
        .toEqual({ ok: true, question: 'Which command rebuilt the cache?' });
    });

    it('600 characters pass and 601 are writer-malformed', () => {
      expect(t7Gate.WRITER_QUESTION_MAX).toBe(600);
      expect(t7Gate.parseQuestionLine(`QUESTION: ${'q'.repeat(600)}`)).toEqual({ ok: true, question: 'q'.repeat(600) });
      expect(t7Gate.parseQuestionLine(`QUESTION: ${'q'.repeat(601)}`)).toEqual({ ok: false, word: 'writer-malformed' });
    });

    it('no QUESTION line, or one with only whitespace, is writer-malformed; so is the prompt itself', () => {
      expect(t7Gate.parseQuestionLine('Which command rebuilt the cache?')).toEqual({ ok: false, word: 'writer-malformed' });
      expect(t7Gate.parseQuestionLine('QUESTION:    ')).toEqual({ ok: false, word: 'writer-malformed' });
      expect(t7Gate.parseQuestionLine(t7Gate.WRITER_PROMPT)).toEqual({ ok: false, word: 'writer-malformed' });
    });
  });

  describe('the rubrics and the label line (W2-D79, D-5778)', () => {
    it('RUBRICS holds exactly the RUBRIC_IDS, and both texts place several candidates and no answer in uncertain', () => {
      expect(Object.keys(t7Gate.RUBRICS).sort()).toEqual([...t7Gate.RUBRIC_IDS].sort());
      for (const id of t7Gate.RUBRIC_IDS) {
        const r = t7Gate.RUBRICS[id as 'v1' | 'v1-strict'];
        expect(r).toContain('several candidate values');
        expect(r).toContain('gives no answer at all');
        expect(r).toContain('of any kind');
        expect(t7Gate.parseLabelLine(r), 'the rubric never parses as a label').toEqual({ ok: false });
      }
      expect(t7Gate.RUBRICS.v1).toContain('without hedging');
      expect(t7Gate.RUBRICS['v1-strict']).toContain('with or without hedging');
    });

    it('the last LABEL line wins, and its label is a LABELS member', () => {
      const r = t7Gate.parseLabelLine('LABEL: uncertain\nOn reflection:\nLABEL: fabricated  ');
      expect(r).toEqual({ ok: true, label: 'fabricated' });
      expect(t7Gate.LABELS).toContain((r as { label: string }).label);
    });

    it('any other word, another case or no line is malformed', () => {
      expect(t7Gate.parseLabelLine('LABEL: correct')).toEqual({ ok: false });
      expect(t7Gate.parseLabelLine('LABEL: Fabricated')).toEqual({ ok: false });
      expect(t7Gate.parseLabelLine('LABEL: fabricated, probably')).toEqual({ ok: false });
      expect(t7Gate.parseLabelLine('fabricated')).toEqual({ ok: false });
    });
  });

  describe('the signed texts (W2-D64, W2-D72, W2-D79)', () => {
    it('each sha constant is lib\'s sha256Hex of its text, over its UTF-8 bytes', () => {
      expect(t7Sha256Hex(String.fromCodePoint(0xe9))).toBe(createHash('sha256').update(Buffer.from([0xc3, 0xa9])).digest('hex'));
      expect(t7Gate.ANSWER_PROTOCOL_SHA256).toBe(t7Sha256Hex(t7Gate.ANSWER_PROTOCOL));
      expect(t7Gate.WRITER_PROMPT_SHA256).toBe(t7Sha256Hex(t7Gate.WRITER_PROMPT));
      expect(t7Gate.RUBRIC_SHA256.v1).toBe(t7Sha256Hex(t7Gate.RUBRICS.v1));
      expect(t7Gate.RUBRIC_SHA256['v1-strict']).toBe(t7Sha256Hex(t7Gate.RUBRICS['v1-strict']));
      expect(new Set([t7Gate.ANSWER_PROTOCOL_SHA256, t7Gate.WRITER_PROMPT_SHA256, t7Gate.RUBRIC_SHA256.v1,
        t7Gate.RUBRIC_SHA256['v1-strict']]).size).toBe(4);
    });

    it('no signed text names a model class, and each is plain ASCII', () => {
      const texts = [t7Gate.ANSWER_PROTOCOL, t7Gate.WRITER_PROMPT, t7Gate.RUBRICS.v1, t7Gate.RUBRICS['v1-strict']];
      const classWord = new RegExp(['hai', 'ku|son', 'net'].join(''), 'i');
      for (const t of texts) {
        expect(t).not.toMatch(classWord);
        expect(t).toMatch(/^[\x20-\x7e\n]+$/);
      }
    });
  });

  describe('edge pins (every guard, one step either side)', () => {
    const [LS, PS] = [0x2028, 0x2029].map((c) => String.fromCodePoint(c));

    it('factVariants: a root with a trailing slash still yields the repo-relative form, and every root counts', () => {
      expect(t7Gate.factVariants('path', '/r/go.mod', { repoRoots: ['/r/'] })).toContain('go.mod');
      expect(t7Gate.factVariants('path', '/r/go.mod', { repoRoots: ['/a', '/r'] })).toContain('go.mod');
      expect(t7Gate.factVariants('path', '/r/go.mod', { repoRoots: ['/r', '/a'] })).toContain('go.mod');
    });

    it('factVariants: a root must end at a slash, and F equal to root plus a slash yields no empty variant', () => {
      expect(t7Gate.factVariants('path', '/rx/y.c', { repoRoots: ['/r'] })).not.toContain('/y.c');
      expect(t7Gate.factVariants('path', '/r/', { repoRoots: ['/r'] })).not.toContain('');
      expect(t7Gate.admitFact('path', '/r/', 'nothing of it', 'q', { repoRoots: ['/r'] }).admitted).toBe(true);
    });

    it('factVariants: no variant is listed twice', () => {
      const v = t7Gate.factVariants('path', '/r/lib/x.c', { repoRoots: ['/r'] });
      expect(new Set(v).size).toBe(v.length);
      expect(v).toContain('lib/x.c');
      expect(t7Gate.factVariants('command', 'a'.repeat(45), NO_ROOTS)).toEqual(['a'.repeat(40)]);
    });

    it('factVariants: sha is lower-cased from F, whatever its case', () => {
      expect(t7Gate.factVariants('sha', 'ABCDEF1234', NO_ROOTS)).toEqual(['abcdef1']);
      expect(t7Gate.admitFact('sha', F9.toUpperCase(), `seen ${F9.slice(0, 7)}`, 'q', NO_ROOTS).admitted).toBe(false);
    });

    it('admitFact: the baseline is tested first, and the first variant in order is the one named', () => {
      const p = F9.slice(0, 7);
      expect(t7Gate.admitFact('sha', F9, `has ${p}`, `q ${p}`, NO_ROOTS).hit).toEqual({ where: 'baseline', variant: p });
      expect(t7Gate.admitFact('path', '/w/proj/src/deep/mod.ts', 'at /w/proj/src/deep/mod.ts', 'q', { repoRoots: ['/w/proj'] }).hit)
        .toEqual({ where: 'baseline', variant: '/w/proj/src/deep/mod.ts' });
    });

    it('labelCorrect: a kind outside FACT_KINDS throws, and so does a bad shaMinPrefix under any kind', () => {
      expect(() => t7Gate.labelCorrect('decision', 'x', 'x', at7)).toThrow(/not one of/);
      expect(() => t7Gate.labelCorrect('path', '/r/a.ts', '/r/a.ts', { repoRoots: [], shaMinPrefix: 12 as unknown as 7 })).toThrow(/shaMinPrefix/);
    });

    it('labelCorrect sha: F is lower-cased too, and a hex run shorter than 7 is not a run', () => {
      expect(t7Gate.labelCorrect('sha', F9.toUpperCase(), SHA40, at7)).toBe(true);
      expect(t7Gate.labelCorrect('sha', F9, `${F9} abcdef`, at7)).toBe(true);
      expect(t7Gate.labelCorrect('sha', F9, F9.slice(0, 6), at7)).toBe(false);
      expect(t7Gate.labelCorrect('sha', F9, 'no hash given', at7)).toBe(false);
    });

    it('labelCorrect path: a final period before whitespace is allowed, a period joined to more is not, and nothing is not', () => {
      const F = '/r/src/app.ts';
      expect(t7Gate.labelCorrect('path', F, 'It is /r/src/app.ts. Thanks', pathAt7)).toBe(true);
      expect(t7Gate.labelCorrect('path', F, 'src/app.ts.bak', pathAt7)).toBe(false);
      expect(t7Gate.labelCorrect('path', F, 'src/app.ts,', pathAt7)).toBe(true);
      expect(t7Gate.labelCorrect('path', F, 'I do not know', pathAt7)).toBe(false);
    });

    it('labelCorrect command: overlapping occurrences are all tried, and only a final period is allowed', () => {
      expect(t7Gate.labelCorrect('command', 'a a', 'xa a a', at7)).toBe(true);
      expect(t7Gate.labelCorrect('command', 'npm run test', 'npm run test. Then lint', at7)).toBe(false);
    });

    it('parseAnswerField: every JavaScript line terminator splits lines, and the value stops at one', () => {
      expect(t7Gate.parseAnswerField('thinking\rANSWER: y')).toEqual({ state: 'value', value: 'y' });
      expect(t7Gate.parseAnswerField(`thinking${LS}ANSWER: y`)).toEqual({ state: 'value', value: 'y' });
      expect(t7Gate.parseAnswerField(`thinking${PS}ANSWER: y`)).toEqual({ state: 'value', value: 'y' });
      expect(t7Gate.parseAnswerField('thinking\r\nANSWER: y\r\ntail')).toEqual({ state: 'value', value: 'y' });
      expect(t7Gate.parseAnswerField(`ANSWER: y${LS}more`)).toEqual({ state: 'value', value: 'y' });
      expect(t7Gate.parseAnswerField('ANSWER: y\r\n')).toEqual({ state: 'value', value: 'y' });
    });

    it('parseAnswerField: a lone quote stays, the value is trimmed before the quotes go, an empty value is a value, UNKNOWN is the whole value', () => {
      expect(t7Gate.parseAnswerField('ANSWER: "')).toEqual({ state: 'value', value: '"' });
      expect(t7Gate.parseAnswerField('ANSWER:   "x"  ')).toEqual({ state: 'value', value: 'x' });
      expect(t7Gate.parseAnswerField('ANSWER:')).toEqual({ state: 'value', value: '' });
      expect(t7Gate.parseAnswerField('ANSWER: unknown device')).toEqual({ state: 'value', value: 'unknown device' });
      expect(t7Gate.parseAnswerField('ANSWER: not unknown')).toEqual({ state: 'value', value: 'not unknown' });
      expect(t7Gate.parseAnswerField('ANSWER: only')).toEqual({ state: 'value', value: 'only' });
    });

    it('parseQuestionLine: 600 code points pass whatever their UTF-16 length, and a last QUESTION: line holding only blanks voids an earlier question', () => {
      const wide = String.fromCodePoint(0x1f600);
      expect(t7Gate.parseQuestionLine(`QUESTION: ${wide.repeat(600)}`)).toEqual({ ok: true, question: wide.repeat(600) });
      expect(t7Gate.parseQuestionLine(`QUESTION: ${wide.repeat(601)}`)).toEqual({ ok: false, word: 'writer-malformed' });
      expect(t7Gate.parseQuestionLine('QUESTION: ok?\nQUESTION:   ')).toEqual({ ok: false, word: 'writer-malformed' });
      expect(t7Gate.parseQuestionLine('QUESTION: only?')).toEqual({ ok: true, question: 'only?' });
    });

    it('parseLabelLine: the last LABEL line that matches wins, a later bad one does not void it, and a line start is required', () => {
      expect(t7Gate.parseLabelLine('LABEL: fabricated\nLABEL: correct')).toEqual({ ok: true, label: 'fabricated' });
      expect(t7Gate.parseLabelLine('LABEL:uncertain')).toEqual({ ok: true, label: 'uncertain' });
      expect(t7Gate.parseLabelLine('  LABEL: uncertain')).toEqual({ ok: false });
      expect(t7Gate.parseLabelLine('LABEL: only')).toEqual({ ok: false });
    });

    it('the exported tables are frozen', () => {
      expect(Object.isFrozen(t7Gate.RUBRICS)).toBe(true);
      expect(Object.isFrozen(t7Gate.RUBRIC_SHA256)).toBe(true);
    });

    // Fix round 1 (review of Task 7): W2-D63 "a second path-shaped token that is not one of F's forms", W2-D61, W2-D72.
    it('labelCorrect path: a hedge whose second value is glued to one of F\'s forms is not correct (only bounded occurrences are masked)', () => {
      const F = '/r/src/app.ts';
      for (const hedge of ['src/app.ts or src/app.tsx', '/r/src/app.ts or /r/src/app.tsx', 'src/app.ts, src/app.ts.bak',
        'src/app.ts or src/app.ts-old', '/r/src/app.ts or x/r/src/app.ts']) {
        expect(t7Gate.labelCorrect('path', F, hedge, pathAt7), hedge).toBe(false);
      }
      expect(t7Gate.labelCorrect('path', F, 'src/app.ts or src/app.ts', pathAt7), 'CONTROL: two bounded occurrences of F\'s own forms').toBe(true);
    });

    it('labelCorrect command: every character of the boundary set glues, on either side', () => {
      for (const c of ['_', '.', ':', '/', '=', '@', '+', '-', 'a', 'Z', '5']) {
        expect(t7Gate.labelCorrect('command', 'npm run test', `npm run test${c}x`, at7), `right ${c}`).toBe(false);
        expect(t7Gate.labelCorrect('command', 'npm run test', `${c}npm run test`, at7), `left ${c}`).toBe(false);
      }
      expect(t7Gate.labelCorrect('command', 'npm run test', '(npm run test), then', at7), 'CONTROL: brackets and commas are not edges').toBe(true);
    });

    it('labelCorrect path: every character of the path boundary sets glues, on either side', () => {
      const F = '/r/src/app.ts';
      for (const c of ['_', '-', 'a', 'Z', '5']) {
        expect(t7Gate.labelCorrect('path', F, `src/app.ts${c}x`, pathAt7), `right ${c}`).toBe(false);
      }
      for (const c of ['_', '-', '.', 'a', 'Z', '5']) {
        expect(t7Gate.labelCorrect('path', F, `${c}src/app.ts`, pathAt7), `left ${c}`).toBe(false);
      }
      expect(t7Gate.labelCorrect('path', F, '(src/app.ts)', pathAt7), 'CONTROL: brackets are not edges').toBe(true);
    });

    it('collapseWs: Unicode White_Space collapses and trims (U+0085 included), and a byte-order mark is not whitespace, at the ends too', () => {
      const [nel, bom] = [0x85, 0xfeff].map((c) => String.fromCodePoint(c));
      expect(t7Gate.collapseWs(`a${nel}${nel}b`)).toBe('a b');
      expect(t7Gate.collapseWs(`a${nel} ${nel}b`)).toBe('a b');
      expect(t7Gate.collapseWs(`a${bom}b`)).toBe(`a${bom}b`);
      expect(t7Gate.collapseWs(`a ${bom} b`)).toBe(`a ${bom} b`);
      expect(t7Gate.collapseWs(`${bom}a`)).toBe(`${bom}a`);
      expect(t7Gate.collapseWs(`a${bom}`)).toBe(`a${bom}`);
      expect(t7Gate.collapseWs(`${nel}a${String.fromCodePoint(0x3000)}`)).toBe('a');
      expect(t7Gate.collapseWs(` ${nel}\t a \n${nel} `)).toBe('a');
      expect(t7Gate.collapseWs(`${nel}`)).toBe('');
    });

    it('parseQuestionLine (W2-D72\'s regex, literally): a bare QUESTION: line is not a QUESTION line, and one holding only blanks is writer-malformed', () => {
      expect(t7Gate.parseQuestionLine('QUESTION: ok?\nQUESTION:')).toEqual({ ok: true, question: 'ok?' });
      expect(t7Gate.parseQuestionLine('QUESTION: ok?\nQUESTION:\n')).toEqual({ ok: true, question: 'ok?' });
      expect(t7Gate.parseQuestionLine('QUESTION: ok?\nQUESTION: ')).toEqual({ ok: false, word: 'writer-malformed' });
      expect(t7Gate.parseQuestionLine('QUESTION: ok?\nQUESTION:\t ')).toEqual({ ok: false, word: 'writer-malformed' });
      expect(t7Gate.parseQuestionLine('QUESTION:')).toEqual({ ok: false, word: 'writer-malformed' });
    });
  });
});

// ── W2-3 Task 8: run classes, the hand-check and the gate (W2-D80, W2-D81, W2-D89; spec §10.2:2713-2718, RP6) ─────
// Pure, every input a parameter, the seed included. decideGate is the W2 gate: W2-5b's `report` gathers its inputs
// and decides nothing (W2-D85). Fractions are compared with Task 6's cmpFrac, never as floats. Seeds are synthetic.
describe('W2-3 Task 8: run classes, the hand-check and the gate', () => {
  type Inputs = Parameters<typeof gateT8.decideGate>[0];
  /** decideGate's verdict; its other answer, the question-not-run refusal, carries `ok: false`. */
  type Verdict = Extract<ReturnType<typeof gateT8.decideGate>, { ok: true }>;
  type Lbl = 'correct' | 'uncertain' | 'fabricated';
  type State = 'value' | 'unknown' | 'absent';
  type Ans = { label: Lbl | null; answerState: State; judgeFailed: boolean };
  type Qn = { qid: string; runFailed: boolean; treatment: Ans; control: Ans };
  type Fr = { num: number; den: number };
  type LiveFam = Inputs['live']['families'][number];
  const SEED = 'ab'.repeat(32);
  const SEED2 = 'cd'.repeat(32);
  const fr = (num: number, den: number): Fr => ({ num, den });
  /** a equals b as a fraction (cross-multiplied, never reduced or divided). */
  const eq = (a: Fr | null | undefined, b: Fr): boolean => a != null && gateT8.cmpFrac(a, b) === 0;
  const fk = (i: number, store = 'store-a'): string => JSON.stringify([store, `demo-${i}`, 'gen']);
  const ans = (label: Lbl | null, answerState: State = 'value', judgeFailed = false): Ans => ({ label, answerState, judgeFailed });
  let qn = 0;
  const q = (t: Ans, c: Ans, runFailed = false): Qn => ({ qid: `q-${++qn}`, runFailed, treatment: t, control: c });
  const R = (): Ans => ans('correct');
  const U = (): Ans => ans('uncertain');
  const F = (): Ans => ans('fabricated');
  /** `n` families, family i holding perFam(i)'s questions. */
  const quizOf = (n: number, perFam: (i: number) => Qn[]): Inputs['quiz'] =>
    ({ families: Array.from({ length: n }, (_, i) => ({ key: fk(i), questions: perFam(i) })) });
  /** k copies of one question shape. */
  const rep = (k: number, make: () => Qn): Qn[] => Array.from({ length: k }, make);
  /** The passing quiz: 20 families of 5; treatment 3 correct and 2 uncertain, control 5 uncertain (60% against 0%). */
  const passingQuiz = (): Inputs['quiz'] => quizOf(20, () => [...rep(3, () => q(R(), U())), ...rep(2, () => q(U(), U()))]);
  const win = (withCall: boolean, state: 'measured' | 'unmeasured' = 'measured') =>
    ({ boundary_uuid: 'b', ts_ms: 0, producer: 'unknown' as const, state, start_ms: 0, end_ms: 1, end_inclusive: false,
      turns: 10, calls: withCall ? 1 : 0, with_call: withCall });
  /** A live family: n measured windows, the first `withCall` of them with a call. */
  const liveFam = (key: string, arm: 'treatment' | 'control', n: number, withCall: number, o: Partial<LiveFam> = {}): LiveFam =>
    ({ key, arm, windows: Array.from({ length: n }, (_, i) => win(i < withCall)), changed: false, unrealised: false, ...o });
  /** The passing live A/B: four treatment families at 5 of 10 (lower bound 1/2), four control families at 0 of 10. */
  const passingLive = (): Inputs['live'] => ({ families: [
    ...[0, 1, 2, 3].map((i) => liveFam(fk(100 + i), 'treatment', 10, 5)),
    ...[0, 1, 2, 3].map((i) => liveFam(fk(200 + i), 'control', 10, 0)),
  ] });
  const base = (o: Partial<Inputs> = {}): Inputs => ({
    seedHex: SEED, halts: { ...gateT8.HALT_DEFAULTS }, codeChanged: false,
    quiz: passingQuiz(), live: passingLive(),
    handcheck: { agreement: { treatment: fr(9, 10), control: fr(9, 10) } },
    ...o,
  });
  const decide = (o: Partial<Inputs> = {}): Verdict => {
    const v = gateT8.decideGate(base(o));
    if (!v.ok) throw new Error(`decideGate refused ${v.reason}: ${v.detail}`);
    return v;
  };
  const GATE_SRC = readFileSync(path.join(ROOT, 'deploy', 'history-gate.mjs'), 'utf8');

  // ── classifyRun and questionOutcome (W2-D80) ──
  const RESULT = { type: 'result', subtype: 'success', is_error: false, result: 'ANSWER: abc1234' };
  const RUN = { spawned: true, stopped: false };

  it('classifyRun: a run not spawned, or cut off by a driver stop, is not-run, whatever it shows', () => {
    expect(gateT8.classifyRun([], null, { spawned: false, stopped: false })).toBe('not-run');
    expect(gateT8.classifyRun([], null, { spawned: true, stopped: true })).toBe('not-run');
    expect(gateT8.classifyRun([], 1, { spawned: true, stopped: true }), 'a stop is not a failure').toBe('not-run');
    expect(gateT8.classifyRun([RESULT], 0, { spawned: true, stopped: true })).toBe('not-run');
  });

  it('classifyRun: model-level non-answers are answered: max turns, permission denials, empty text, no ANSWER line, a non-zero exit with a result', () => {
    expect(gateT8.classifyRun([RESULT], 0, RUN)).toBe('answered');
    expect(gateT8.classifyRun([{ ...RESULT, subtype: 'error_max_turns', is_error: true, result: '' }], 0, RUN)).toBe('answered');
    expect(gateT8.classifyRun([{ ...RESULT, permission_denials: [{ tool_name: 'Bash' }] }], 0, RUN)).toBe('answered');
    expect(gateT8.classifyRun([{ ...RESULT, result: '' }], 0, RUN)).toBe('answered');
    expect(gateT8.classifyRun([{ ...RESULT, result: 'I could not find it.' }], 0, RUN)).toBe('answered');
    expect(gateT8.classifyRun([RESULT], 1, RUN)).toBe('answered');
  });

  it('classifyRun: a spawned run with no result event is infra-failed, whatever the exit code', () => {
    const noResult = [{ type: 'system', subtype: 'init' }, { type: 'assistant', message: { content: [] } }];
    expect(gateT8.classifyRun(noResult, 0, RUN)).toBe('infra-failed');
    expect(gateT8.classifyRun(noResult, 1, RUN), 'a non-zero exit with no result').toBe('infra-failed');
    expect(gateT8.classifyRun([], null, RUN), 'ended by a signal the driver did not send').toBe('infra-failed');
  });

  it('classifyRun: an authentication error is infra-failed, even beside a result event', () => {
    const auth = { type: 'assistant', error: 'authentication_failed', message: { content: [{ type: 'text', text: 'Invalid API key' }] } };
    expect(gateT8.classifyRun([auth, { ...RESULT, is_error: true, result: 'Invalid API key' }], 1, RUN)).toBe('infra-failed');
    expect(gateT8.classifyRun([auth], 1, RUN)).toBe('infra-failed');
  });

  it("classifyRun: every answer is a RUN_CLASSES member, and the gate never spells the driver's stop words", () => {
    expect([...gateT8.RUN_CLASSES].sort()).toEqual(['answered', 'infra-failed', 'not-run']);
    for (const [ev, code, ctx] of [[[RESULT], 0, RUN], [[], 0, RUN], [[], null, { spawned: false, stopped: false }]] as const) {
      expect(gateT8.RUN_CLASSES).toContain(gateT8.classifyRun([...ev], code, ctx));
    }
    // The driver's stop words are its own (W2-D59, and W2-4's unmeasured words by coordinator ruling); a stop reaches
    // the gate only as ctx.stopped. code-changed and code-unmeasured are GATE_REASONS' own spellings as well (the shared
    // spelling the coordinator accepted), so the gate spells them: that is the CONTROL, which also shows GATE_SRC is the
    // gate's real text, so the scan above cannot pass on an empty read.
    for (const word of ['limits-', 'budget-exhausted', 'claude-version-moved', 'tree-moved', 'wrapper-moved',
      'version-unmeasured', 'tree-unmeasured', 'wrapper-unmeasured']) {
      expect(GATE_SRC.includes(word), word).toBe(false);
    }
    for (const word of ['code-changed', 'code-unmeasured']) {
      expect(GATE_SRC.includes(word), `CONTROL: ${word} is a GATE_REASONS word the gate spells`).toBe(true);
    }
  });

  it('questionOutcome: a first infra failure owes a re-run, a second makes the question run-failed', () => {
    expect(gateT8.questionOutcome([])).toBe('not-run');
    expect(gateT8.questionOutcome(['answered'])).toBe('answered');
    expect(gateT8.questionOutcome(['infra-failed'])).toBe('rerun');
    expect(gateT8.questionOutcome(['infra-failed', 'answered'])).toBe('answered');
    expect(gateT8.questionOutcome(['infra-failed', 'infra-failed'])).toBe('run-failed');
    for (const a of [[], ['answered'], ['infra-failed'], ['infra-failed', 'infra-failed']] as const) {
      expect(gateT8.QUESTION_OUTCOMES).toContain(gateT8.questionOutcome([...a]));
    }
    expect(() => gateT8.questionOutcome(['failed' as never])).toThrow(/not a run class/);
  });

  it('questionOutcome: a stop never consumes the re-run', () => {
    expect(gateT8.questionOutcome(['not-run'])).toBe('not-run');
    expect(gateT8.questionOutcome(['not-run', 'not-run'])).toBe('not-run');
    expect(gateT8.questionOutcome(['infra-failed', 'not-run'])).toBe('rerun');
    expect(gateT8.questionOutcome(['not-run', 'infra-failed', 'not-run', 'not-run'])).toBe('rerun');
    expect(gateT8.questionOutcome(['infra-failed', 'not-run', 'not-run', 'infra-failed'])).toBe('run-failed');
    expect(gateT8.questionOutcome(['infra-failed', 'not-run', 'answered'])).toBe('answered');
  });

  // ── the hand-check (W2-D81) ──
  type Item = { id: string; arm: 'treatment' | 'control'; judged: boolean; judgeFailed: boolean };
  const items = (arm: Item['arm'], judged: number, failed: number, correct = 0): Item[] => [
    ...Array.from({ length: judged }, (_, i) => ({ id: `${arm}-j${String(i).padStart(3, '0')}`, arm, judged: true, judgeFailed: false })),
    ...Array.from({ length: failed }, (_, i) => ({ id: `${arm}-f${i}`, arm, judged: false, judgeFailed: true })),
    ...Array.from({ length: correct }, (_, i) => ({ id: `${arm}-c${i}`, arm, judged: false, judgeFailed: false })),
  ];

  it('handcheckSample: ceil(n/5) of the judged answers per arm, and every judge-failed item outside the 20%', () => {
    const all = [...items('treatment', 11, 1, 4), ...items('control', 10, 2, 5)];
    const ids = gateT8.handcheckSample(SEED, all);
    const judgedIn = (arm: string) => ids.filter((id) => id.startsWith(`${arm}-j`)).length;
    expect(judgedIn('treatment'), 'ceil(11/5)').toBe(3);
    expect(judgedIn('control'), 'ceil(10/5)').toBe(2);
    for (const f of all.filter((i) => i.judgeFailed)) expect(ids).toContain(f.id);
    expect(ids.filter((id) => id.includes('-c')), 'an unjudged (correct) answer is never sampled').toEqual([]);
    expect(ids.length).toBe(3 + 2 + 3);
    expect(gateT8.handcheckSample(SEED, items('treatment', 1, 0)).length, 'ceil(1/5)').toBe(1);
    expect(gateT8.handcheckSample(SEED, items('control', 0, 0, 3)), 'nothing judged, nothing sampled').toEqual([]);
    expect(() => gateT8.handcheckSample(SEED, [{ id: 'x', arm: 'treatment', judged: true, judgeFailed: true }])).toThrow(/both judged and judge-failed/);
  });

  it('handcheckSample: seeded, independent of input order, and another seed draws another sample', () => {
    const all = [...items('treatment', 50, 0), ...items('control', 50, 0)];
    const a = gateT8.handcheckSample(SEED, all);
    expect(gateT8.handcheckSample(SEED, all)).toEqual(a);
    expect(gateT8.handcheckSample(SEED, [...all].reverse()), 'input order').toEqual(a);
    expect(gateT8.handcheckSample(SEED2, all)).not.toEqual(a);
    expect(a.length).toBe(20);
  });

  it("applyHandcheck: the operator's label replaces the judge's on the items the operator labelled, and only there", () => {
    const judge = new Map<string, Lbl>([['a', 'fabricated'], ['b', 'uncertain'], ['c', 'fabricated']]);
    const operator = new Map<string, Lbl>([['a', 'uncertain'], ['d', 'fabricated']]);   // a sampled; d judge-failed
    const out = gateT8.applyHandcheck(judge, operator);
    expect([...out.entries()].sort()).toEqual([['a', 'uncertain'], ['b', 'uncertain'], ['c', 'fabricated'], ['d', 'fabricated']]);
    expect(judge.get('a'), 'the judge map is not changed').toBe('fabricated');
    expect(() => gateT8.applyHandcheck(new Map<string, Lbl>([['a', 'correct']]), new Map()), 'the judge never decides correct (W2-D63)').toThrow(/judge label correct/);
    expect(() => gateT8.applyHandcheck(new Map<string, Lbl>([['a', 'fabricated']]), new Map<string, Lbl>([['a', 'correct']])), 'the operator never decides correct either (W2-D63, W2-D79)').toThrow(/operator label correct/);
  });

  it('handcheckAgreement: exact per arm and over both; an arm with no pair is null', () => {
    const pairs = [
      ...Array.from({ length: 10 }, (_, i) => ({ arm: 'treatment' as const, judge: 'fabricated' as Lbl, operator: (i < 8 ? 'fabricated' : 'uncertain') as Lbl })),
      ...Array.from({ length: 3 }, (_, i) => ({ arm: 'control' as const, judge: 'uncertain' as Lbl, operator: (i < 2 ? 'uncertain' : 'fabricated') as Lbl })),
    ];
    const g = gateT8.handcheckAgreement(pairs);
    expect(eq(g.treatment, fr(8, 10))).toBe(true);
    expect(eq(g.control, fr(2, 3))).toBe(true);
    expect(eq(g.all, fr(10, 13))).toBe(true);
    expect(gateT8.handcheckAgreement(pairs.slice(0, 10)).control).toBeNull();
    expect(gateT8.handcheckAgreement([])).toEqual({ treatment: null, control: null, all: null });
  });

  // ── decideGate (W2-D89, RP6, W2-D18's boundaries) ──
  it('decideGate: a passing input passes, and the same seed and inputs give the same verdict twice', () => {
    const inputs = base();
    const before = structuredClone(inputs);
    const v = gateT8.decideGate(inputs) as Verdict;
    expect(v.ok, 'a verdict, not a refusal').toBe(true);
    expect(v.verdict).toBe('pass');
    expect(v.halts).toEqual([]);
    expect(v.stamp).toBeNull();
    expect(eq(v.criteria.accuracy!.point_t, fr(60, 100))).toBe(true);
    expect(eq(v.criteria.uptake!.lower, fr(1, 2))).toBe(true);
    expect(gateT8.decideGate(structuredClone(before))).toEqual(v);
    expect(inputs, 'decideGate changes nothing it is given').toEqual(before);
    expect(gateT8.VERDICTS).toContain(v.verdict);
  });

  it('RP6: 45% with a CI lower bound at or below 0 fails', () => {
    // 20 families of one question: treatment correct in 9 (45%), control in 9; one family +1, one -1, the rest tie.
    const v = decide({ quiz: quizOf(20, (i) => [i < 8 ? q(R(), R()) : i === 8 ? q(R(), U()) : i === 9 ? q(U(), R()) : q(U(), U())]) });
    expect(eq(v.criteria.accuracy!.point_t, fr(9, 20))).toBe(true);
    expect(gateT8.cmpFrac(v.criteria.accuracy!.lower, fr(0, 1))).toBeLessThanOrEqual(0);
    expect(v.criteria.accuracy!.holds).toBe(false);
    expect(v.verdict).toBe('fail');
  });

  it('RP6: 38% with a lower bound above 0 fails', () => {
    // 10 families of 5: treatment correct 2 in nine of them and 1 in the tenth (19 of 50), control none.
    const v = decide({ quiz: quizOf(10, (i) => [...rep(i < 9 ? 2 : 1, () => q(R(), U())), ...rep(i < 9 ? 3 : 4, () => q(U(), U()))]) });
    expect(eq(v.criteria.accuracy!.point_t, fr(19, 50))).toBe(true);
    expect(gateT8.cmpFrac(v.criteria.accuracy!.lower, fr(0, 1))).toBe(1);
    expect(v.criteria.accuracy!.holds).toBe(false);
    expect(v.verdict).toBe('fail');
  });

  it('W2-D18: exactly 40% passes criterion 1', () => {
    const v = decide({ quiz: quizOf(10, () => [...rep(2, () => q(R(), U())), ...rep(3, () => q(U(), U()))]) });
    expect(eq(v.criteria.accuracy!.point_t, fr(2, 5))).toBe(true);
    expect(v.criteria.accuracy!.holds).toBe(true);
    expect(v.verdict).toBe('pass');
  });

  it('W2-D18: a paired lower bound of exactly 0 fails (one positive family in 20)', () => {
    // Family 0: treatment correct, control not; families 1-8: both correct; 9-19: neither. Point 9/20 = 45%. A resample
    // holding no copy of family 0 has difference exactly 0, and (19/20)^20, about 36%, of them do: the 2.5% rank is 0.
    const v = decide({ quiz: quizOf(20, (i) => [i === 0 ? q(R(), U()) : i <= 8 ? q(R(), R()) : q(U(), U())]) });
    expect(eq(v.criteria.accuracy!.point_t, fr(9, 20))).toBe(true);
    expect(eq(v.criteria.accuracy!.lower, fr(0, 1))).toBe(true);
    expect(v.criteria.accuracy!.holds).toBe(false);
    expect(v.verdict).toBe('fail');
  });

  /** 20 families of 10 questions (Q = 200): treatment 6 correct per family; `ft` and `fc` fabricated answers, spread one
   *  per family from family 0, the rest uncertain. */
  const fabQuiz = (ft: number, fc: number): Inputs['quiz'] =>
    quizOf(20, (i) => [q(R(), i < fc ? F() : U()), ...rep(5, () => q(R(), U())), q(i < ft ? F() : U(), U()), ...rep(3, () => q(U(), U()))]);

  it('RP6: fabrication at control + 4 fails', () => {
    const v = decide({ quiz: fabQuiz(9, 1) });   // 4.5% against 0.5%
    expect(eq(v.criteria.fabrication!.t, fr(9, 200))).toBe(true);
    expect(eq(v.criteria.fabrication!.c, fr(1, 200))).toBe(true);
    expect(v.criteria.fabrication!.holds).toBe(false);
    expect(v.verdict).toBe('fail');
  });

  it('W2-D18: fabrication at exactly control + 3 passes, a tie a float comparison gets wrong', () => {
    const v = decide({ quiz: fabQuiz(7, 1) });   // 3.5% against 0.5%: in floats 7/200 > 1/200 + 0.03
    expect(7 / 200 <= 1 / 200 + 0.03, 'CONTROL: the float reading of this tie fails it').toBe(false);
    expect(v.criteria.fabrication!.holds).toBe(true);
    expect(v.verdict).toBe('pass');
  });

  it('RP6: a treatment window share whose lower bound is 9.9% fails even with control at 0, and 0.01 against 0 fails', () => {
    const control = [0, 1].map((i) => liveFam(fk(200 + i), 'control', 100, 0));
    const at99 = decide({ live: { families: [...[0, 1].map((i) => liveFam(fk(100 + i), 'treatment', 1000, 99)), ...control] } });
    expect(eq(at99.criteria.uptake!.lower, fr(99, 1000))).toBe(true);
    expect(at99.criteria.uptake!.holds).toBe(false);
    expect(at99.verdict).toBe('fail');
    const at1 = decide({ live: { families: [...[0, 1].map((i) => liveFam(fk(100 + i), 'treatment', 100, 1)), ...control] } });
    expect(eq(at1.criteria.uptake!.point, fr(1, 100))).toBe(true);
    expect(at1.criteria.uptake!.holds).toBe(false);
    expect(at1.verdict).toBe('fail');
  });

  it('W2-D18: a treatment window share whose lower bound is exactly 10% passes criterion 3', () => {
    const v = decide({ live: { families: [0, 1].map((i) => liveFam(fk(100 + i), 'treatment', 10, 1)) } });
    expect(eq(v.criteria.uptake!.lower, gateT8.X)).toBe(true);
    expect(v.criteria.uptake!.holds).toBe(true);
    expect(v.verdict).toBe('pass');
  });

  it("RP6: dropping control's calls after its first exit 8 changes no verdict", () => {
    // One control family's report, built into windows by Task 3: one boundary at 1000, three turns, no next boundary,
    // so its window is [1000, 1300]. Its first exit-8 call is at 900, before the window; the next is inside it.
    const EXIT8 = 8;   // lib's EXIT.RECALL_OFF
    const calls: Array<[number, number, string]> = [[900, EXIT8, 'grep'], [1150, EXIT8, 'grep']];
    const report = (cs: Array<[number, number, string]>) => ({
      ccrc_id: 'demo-c', generation: 'gen', found: true, merged_generations: [], calls: cs,
      boundaries: [{ boundary_uuid: 'b-1', ts_ms: 1000, copies: [{
        file_id: 1, source_key: '', boundary_line: 1, after_count: 4, summary_line: 2,
        next_boundary_line: null, next_boundary_ts_ms: null, last_ts_ms: 1300,
        rows: [[3, 1100, 'm-1', null, 'u-1', 'model-a'], [4, 1200, 'm-2', null, 'u-2', 'model-a'], [5, 1300, 'm-3', null, 'u-3', 'model-a']],
        models: ['model-a'], truncated: false }] }],
    });
    const split = gateT8.splitAtFirstExit8(calls);
    expect(split.upTo, 'CONTROL: the split is at the first exit 8').toEqual([calls[0]]);
    const full = gateT8.buildWindows(report(calls) as never);
    const upTo = gateT8.buildWindows(report(split.upTo) as never);
    expect([full[0]!.with_call, upTo[0]!.with_call], 'CONTROL: the drop changes the control window').toEqual([true, false]);
    // Treatment sits exactly at X, so a gate that let control into criterion 3 would move with the drop.
    const treatment = [0, 1].map((i) => liveFam(fk(100 + i), 'treatment', 10, 1));
    const withControl = (ws: typeof full): Inputs['live'] => ({ families: [...treatment, { key: fk(200), arm: 'control', windows: ws, changed: false, unrealised: false }] });
    const a = decide({ live: withControl(full) });
    const b = decide({ live: withControl(upTo) });
    expect(a.verdict).toBe('pass');
    expect(b).toEqual(a);
  });

  it('RP6 and W2-D83: quiz uptake, the uptake difference and the task-embedded scores change no verdict', () => {
    const one = { quiz_uptake: { treatment: fr(9, 10), control: fr(0, 10) }, uptake_difference: fr(9, 10), first_call: { treatment: fr(1, 2), control: fr(0, 1) },
      task_embedded: { accuracy: { treatment: fr(1, 1), control: fr(0, 1) }, fabrication: { treatment: fr(0, 1), control: fr(1, 1) } } };
    const two = { quiz_uptake: { treatment: fr(0, 10), control: fr(10, 10) }, uptake_difference: fr(-10, 10), first_call: { treatment: fr(0, 1), control: fr(1, 1) },
      task_embedded: { accuracy: { treatment: fr(0, 1), control: fr(1, 1) }, fabrication: { treatment: fr(1, 1), control: fr(0, 1) } } };
    const a = decide({ reportOnly: one });
    const b = decide({ reportOnly: two });
    const c = decide();
    expect(a.report_only, 'passed through').toEqual(one);
    expect(c.report_only).toBeNull();
    const { report_only: _a, ...ra } = a;
    const { report_only: _b, ...rb } = b;
    const { report_only: _c, ...rc } = c;
    expect(rb).toEqual(ra);
    expect(rc).toEqual(ra);
    // decideGate reads the report-only section in exactly one place: the line that passes it through.
    const start = GATE_SRC.indexOf('export function decideGate(');
    const body = GATE_SRC.slice(start, GATE_SRC.indexOf('\n}\n', start));
    expect(start).toBeGreaterThan(0);
    expect(body.split('reportOnly').length - 1).toBe(1);
  });

  it('W2-D89: an absent rate above absent_rate_max in either arm halts, and criterion 1 is not computed', () => {
    // Q = 100 (20 families of 5); `a` absent answers in the named arm, one per family from family 0.
    const absentQuiz = (arm: 'treatment' | 'control', a: number): Inputs['quiz'] =>
      quizOf(20, (i) => [...rep(3, () => q(R(), U())), q(U(), U()),
        i < a ? (arm === 'treatment' ? q(ans('uncertain', 'absent'), U()) : q(U(), ans('uncertain', 'absent'))) : q(U(), U())]);
    const at5 = decide({ quiz: absentQuiz('treatment', 5) });
    expect(eq(at5.counts.absent.treatment, fr(5, 100))).toBe(true);
    expect(at5.halts, 'exactly 5% is not above 5%').toEqual([]);
    expect(at5.verdict).toBe('pass');
    for (const arm of ['treatment', 'control'] as const) {
      const v = decide({ quiz: absentQuiz(arm, 6) });
      expect(v.halts, arm).toEqual(['absent-rate']);
      expect(v.verdict).toBe('halt');
      expect(v.criteria.accuracy, 'criterion 1 is not computed').toBeNull();
      expect(v.criteria.fabrication, 'criterion 2 still is').not.toBeNull();
      expect(v.criteria.uptake!.holds).toBe(true);
    }
  });

  it('W2-D89: more than run_failed_max of the questions run-failed halts, and criteria 1 and 2 are not computed', () => {
    // 100 frozen questions; `k` of them run-failed, one per family from family 0.
    const rfQuiz = (k: number): Inputs['quiz'] =>
      quizOf(20, (i) => [...rep(3, () => q(R(), U())), q(U(), U()), q(U(), U(), i < k)]);
    const at5 = decide({ quiz: rfQuiz(5) });
    expect(at5.counts).toMatchObject({ Q: 95, run_failed: 5 });
    expect(at5.halts, '5 of 100 frozen questions is not above 5%').toEqual([]);
    expect(at5.verdict).toBe('pass');
    const at6 = decide({ quiz: rfQuiz(6) });
    expect(at6.counts).toMatchObject({ Q: 94, run_failed: 6 });
    expect(at6.halts).toEqual(['run-failed']);
    expect(at6.verdict).toBe('halt');
    expect(at6.criteria.accuracy).toBeNull();
    expect(at6.criteria.fabrication).toBeNull();
    expect(at6.criteria.uptake!.holds, 'criterion 3 is still reported').toBe(true);
  });

  it('W2-D89: hand-check agreement below handcheck_agreement_min halts', () => {
    expect(decide({ handcheck: { agreement: { treatment: fr(8, 10), control: fr(4, 5) } } }).halts, 'exactly 0.8 is not below it').toEqual([]);
    expect(decide({ handcheck: { agreement: { treatment: null, control: null } } }).halts, 'no pair, nothing to disagree').toEqual([]);
    for (const agreement of [{ treatment: fr(7, 10), control: fr(9, 10) }, { treatment: fr(9, 10), control: fr(79, 100) }]) {
      const v = decide({ handcheck: { agreement } });
      expect(v.halts).toEqual(['handcheck-agreement']);
      expect(v.verdict).toBe('halt');
      expect(v.criteria.accuracy!.holds && v.criteria.fabrication!.holds && v.criteria.uptake!.holds, 'every criterion still computed').toBe(true);
    }
    // handcheckAgreement's answer feeds the halt directly.
    const pairs = Array.from({ length: 10 }, (_, i) => ({ arm: 'treatment' as const, judge: 'fabricated' as Lbl, operator: (i < 7 ? 'fabricated' : 'uncertain') as Lbl }));
    const g = gateT8.handcheckAgreement(pairs);
    expect(decide({ handcheck: { agreement: { treatment: g.treatment, control: g.control } } }).halts).toEqual(['handcheck-agreement']);
  });

  it('W2-D89: a judge-failed answer with no operator label holds the verdict incomplete', () => {
    const held = (label: Lbl | null): Inputs['quiz'] =>
      quizOf(20, (i) => [...rep(3, () => q(R(), U())), q(U(), U()), i === 0 ? q(ans(label, 'value', true), U()) : q(U(), U())]);
    const v = decide({ quiz: held(null) });
    expect(v.verdict).toBe('incomplete');
    expect(v.criteria.accuracy).toBeNull();
    expect(v.criteria.fabrication).toBeNull();
    expect(v.criteria.uptake!.holds).toBe(true);
    expect(decide({ quiz: held('uncertain') }).verdict, 'labelled by the operator, it decides').toBe('pass');
    // The hold is the verdict even beside a halt, which is still listed.
    const both = decide({ quiz: held(null), handcheck: { agreement: { treatment: fr(1, 2), control: null } } });
    expect(both.verdict).toBe('incomplete');
    expect(both.halts).toEqual(['handcheck-agreement']);
  });

  it('W2-D23: a changed treatment family stays in criterion 3 and leaves the comparison block', () => {
    const v = decide({ live: { families: [
      liveFam(fk(100), 'treatment', 10, 5, { changed: true }),
      liveFam(fk(101), 'treatment', 10, 1),
      liveFam(fk(200), 'control', 10, 0, { unrealised: true }),
      liveFam(fk(201), 'control', 10, 0),
    ] } });
    expect(eq(v.criteria.uptake!.point, fr(6, 20)), 'the changed family is in the denominator').toBe(true);
    expect(v.comparison.dropped).toEqual([fk(100), fk(200)].sort());
  });

  it('W2-D80: run-failed questions are absent from both arms', () => {
    // 21 frozen: 20 families of one question (treatment correct in 12, control in none), plus one run-failed question
    // whose labels would move both arms and whose judge failed: 1/21 is under 5%, so nothing halts.
    const families = quizOf(20, (i) => [i < 12 ? q(R(), U()) : q(U(), U())]).families
      .map((f, i) => (i === 0 ? { ...f, questions: [...f.questions, q(R(), ans(null, 'absent', true), true)] } : f));
    const v = decide({ quiz: { families } });
    expect(v.counts).toMatchObject({ Q: 20, run_failed: 1 });
    expect(eq(v.criteria.accuracy!.point_t, fr(12, 20))).toBe(true);
    expect(eq(v.counts.absent.control!, fr(0, 20))).toBe(true);
    expect(v.verdict, 'its missing label holds nothing').toBe('pass');
  });

  it('W2-D89: unmeasured windows and treatment families with no measured window are out of criterion 3', () => {
    const v = decide({ live: { families: [
      { ...liveFam(fk(100), 'treatment', 10, 5), windows: [...liveFam(fk(100), 'treatment', 10, 5).windows, win(true, 'unmeasured'), win(true, 'unmeasured')] },
      { ...liveFam(fk(101), 'treatment', 0, 0), windows: [win(true, 'unmeasured')] },
      liveFam(fk(102), 'treatment', 0, 0),
    ] } });
    expect(eq(v.criteria.uptake!.point, fr(5, 10))).toBe(true);
    expect(eq(v.criteria.uptake!.lower, fr(5, 10)), 'one cluster only').toBe(true);
  });

  it('W2-D89 and the coordinator ruling: a treatment set with no cluster left halts empty-arm, and no bootstrap runs on it', () => {
    // Criterion 3: no listed treatment family holds a measured window (one has none, one only an unmeasured one).
    const live = decide({ live: { families: [
      liveFam(fk(102), 'treatment', 0, 0),
      { ...liveFam(fk(103), 'treatment', 0, 0), windows: [win(true, 'unmeasured')] },
      liveFam(fk(200), 'control', 10, 0),
    ] } });
    expect(live.halts).toEqual(['empty-arm']);
    expect(live.verdict).toBe('halt');
    expect(live.criteria.uptake, 'criterion 3 is not computed').toBeNull();
    expect(live.criteria.accuracy!.holds && live.criteria.fabrication!.holds, 'criteria 1 and 2 still are').toBe(true);
    // Criterion 1: every frozen question run-failed leaves no paired cluster; the run-failed halt fires beside it.
    const quiz = decide({ quiz: quizOf(20, () => [q(R(), U(), true)]) });
    expect(quiz.halts).toEqual(['run-failed', 'empty-arm']);
    expect(quiz.verdict).toBe('halt');
    expect(quiz.criteria.accuracy).toBeNull();
    expect(quiz.criteria.uptake!.holds, 'criterion 3 is still reported').toBe(true);
  });

  it('W2-D89: the code-changed stamp is carried onto the verdict', () => {
    const v = decide({ codeChanged: true });
    expect(v.stamp).toBe('code-changed');
    expect(v.verdict).toBe('pass');
    expect(gateT8.GATE_REASONS).toContain('code-changed');
  });

  it('W2-D89: the halt words are HALT_WORDS, and decideGate refuses an input it has no rule for', () => {
    expect([...gateT8.HALT_WORDS].sort()).toEqual(['absent-rate', 'empty-arm', 'handcheck-agreement', 'run-failed']);
    expect(gateT8.HALT_DEFAULTS).toEqual({ handcheck_agreement_min: 0.8, run_failed_max: 0.05, absent_rate_max: 0.05 });
    // A question still not-run at gate time is refused, never thrown, counted, held or halted (W2-D89, amended
    // 2026-10-19): the refusal names the questions, so the operator runs or records them first.
    const notRun = quizOf(20, () => rep(5, () => q(R(), U())));
    (notRun.families[0]!.questions[0]!.treatment as { answerState: string }).answerState = 'not-run';
    (notRun.families[3]!.questions[2]!.control as { answerState: string }).answerState = 'not-run';
    const named = [notRun.families[0]!.questions[0]!.qid, notRun.families[3]!.questions[2]!.qid].sort();
    expect(gateT8.decideGate(base({ quiz: notRun })), 'question-not-run (W2-D89, amended)').toEqual({ ok: false, reason: 'question-not-run',
      detail: `decideGate: 2 question(s) still not-run: ${named.join(', ')}; run or record them first`, questions: named });
    expect(gateT8.GATE_REASONS).toContain('question-not-run');
    expect(() => decide({ quiz: quizOf(20, () => [q(ans('uncertain', 'skipped' as never), U())]) })).toThrow(/has answer state skipped/);
    expect(() => decide({ quiz: quizOf(20, () => [q(ans('correct', 'absent'), U())]) })).toThrow(/absent and labelled correct/);
    expect(() => decide({ quiz: quizOf(20, () => [q(ans(null), U())]) })).toThrow(/no label and is not judge-failed/);
    expect(() => decide({ halts: { ...gateT8.HALT_DEFAULTS, run_failed_max: 1e-7 } })).toThrow(/at most six places/);
  });

  // ── Edge pins: guards and edges the cases above leave unpinned (each is measured against its mutant) ──
  it('edge: classifyRun refuses a malformed call, and reads only the authentication field as an authentication failure', () => {
    expect(() => gateT8.classifyRun('x' as never, 0, RUN)).toThrow(/events must be an array/);
    expect(() => gateT8.classifyRun([], 1.5, RUN)).toThrow(/exitCode must be an integer or null/);
    expect(() => gateT8.classifyRun([], undefined as never, RUN)).toThrow(/exitCode must be an integer or null/);
    expect(() => gateT8.classifyRun([], 0, null as never)).toThrow(/ctx.spawned and ctx.stopped must be booleans/);
    expect(() => gateT8.classifyRun([], 0, { spawned: true } as never)).toThrow(/ctx.spawned and ctx.stopped must be booleans/);
    expect(() => gateT8.classifyRun([], 0, { spawned: 1, stopped: false } as never)).toThrow(/ctx.spawned and ctx.stopped must be booleans/);
    expect(gateT8.classifyRun([RESULT], 0, { spawned: false, stopped: false }), 'a run never spawned is not-run whatever it shows').toBe('not-run');
    expect(gateT8.classifyRun([{ type: 'assistant', error: 'rate_limit' }, RESULT], 0, RUN), 'another error value is no authentication failure').toBe('answered');
    expect(gateT8.classifyRun([null, 'text', 3, RESULT], 0, RUN), 'a non-object event is skipped, not read').toBe('answered');
    expect(gateT8.classifyRun([null, 'text'], 0, RUN)).toBe('infra-failed');
  });

  it('edge: questionOutcome refuses a non-array, and the first two infra failures settle the question for good', () => {
    expect(() => gateT8.questionOutcome('answered' as never)).toThrow(/attempts must be an array/);
    expect(gateT8.questionOutcome(['infra-failed', 'infra-failed', 'answered']), 'a third attempt never resurrects it').toBe('run-failed');
    expect(gateT8.questionOutcome(['infra-failed', 'answered', 'infra-failed']), 'the first answer settles it').toBe('answered');
  });

  it('edge: handcheckSample refuses a malformed item, sorts by code unit and draws without replacement from the handcheck stream', () => {
    const it0 = { id: 'x', arm: 'treatment' as const, judged: true, judgeFailed: false };
    expect(() => gateT8.handcheckSample(SEED, 'x' as never)).toThrow(/items must be an array/);
    expect(() => gateT8.handcheckSample(SEED, [null as never])).toThrow(/non-empty string id/);
    expect(() => gateT8.handcheckSample(SEED, [{ ...it0, id: '' }])).toThrow(/non-empty string id/);
    expect(() => gateT8.handcheckSample(SEED, [{ ...it0, id: 7 as never }])).toThrow(/non-empty string id/);
    expect(() => gateT8.handcheckSample(SEED, [it0, { ...it0 }])).toThrow(/duplicate id x/);
    expect(() => gateT8.handcheckSample(SEED, [{ ...it0, arm: 'both' as never }])).toThrow(/has arm both/);
    expect(() => gateT8.handcheckSample(SEED, [{ ...it0, judged: 1 as never }])).toThrow(/boolean judged and judgeFailed/);
    expect(() => gateT8.handcheckSample(SEED, [{ ...it0, judgeFailed: 'no' as never }])).toThrow(/boolean judged and judgeFailed/);
    // The answer is sorted by code unit ('A' < 'a' < 'b'), whatever order the judge-failed items arrive in.
    const failed = (id: string) => ({ id, arm: 'control' as const, judged: false, judgeFailed: true });
    expect(gateT8.handcheckSample(SEED, [failed('b'), failed('a'), failed('A')])).toEqual(['A', 'a', 'b']);
    // An independent reading of W2-D81: per arm in ASSIGNMENT_ARMS order, a partial Fisher-Yates over the sorted judged
    // ids from the 'handcheck' stream, then the judge-failed ids; ids of mixed case, so a locale sort would move it.
    const ref = (seed: string, its: Item[]): string[] => {
      const rng = gateT8.substream(seed, 'handcheck');
      const out: string[] = [];
      for (const arm of gateT8.ASSIGNMENT_ARMS) {
        const pool = its.filter((i) => i.arm === arm && i.judged).map((i) => i.id).sort();
        const k = Math.ceil(pool.length / 5);
        for (let s = 0; s < k; s += 1) {
          const j = s + gateT8.randInt(rng, pool.length - s);
          [pool[s], pool[j]] = [pool[j]!, pool[s]!];
          out.push(pool[s]!);
        }
      }
      for (const i of its) if (i.judgeFailed) out.push(i.id);
      return out.sort();
    };
    const mixed: Item[] = ['treatment', 'control'].flatMap((arm) =>
      Array.from({ length: 100 }, (_, i) => ({ id: `${i % 2 === 0 ? 'a' : 'B'}-${arm}-${i}`, arm: arm as Item['arm'], judged: true, judgeFailed: false })));
    mixed.push({ id: 'z-failed', arm: 'control', judged: false, judgeFailed: true });
    for (const seed of [SEED, SEED2, 'ef'.repeat(32)]) {
      const got = gateT8.handcheckSample(seed, mixed);
      expect(got, seed).toEqual(ref(seed, mixed));
      expect(new Set(got).size, 'no id is drawn twice').toBe(got.length);
      expect(got.length).toBe(20 + 20 + 1);
    }
  });

  it('edge: applyHandcheck refuses a non-map and a label outside the judge words, from either side', () => {
    expect(() => gateT8.applyHandcheck({} as never, new Map())).toThrow(/both label sets must be Maps/);
    expect(() => gateT8.applyHandcheck(new Map(), [] as never)).toThrow(/both label sets must be Maps/);
    expect(() => gateT8.applyHandcheck(new Map<string, Lbl>([['a', 'bogus' as never]]), new Map())).toThrow(/judge label bogus/);
    expect(() => gateT8.applyHandcheck(new Map(), new Map<string, Lbl>([['a', 'bogus' as never]]))).toThrow(/operator label bogus/);
    expect(gateT8.applyHandcheck(new Map(), new Map()).size).toBe(0);
  });

  it('edge: handcheckAgreement refuses a non-array, an unknown arm and a label outside LABELS; an arm that never agrees is 0, not null', () => {
    const p = { arm: 'treatment' as const, judge: 'fabricated' as Lbl, operator: 'uncertain' as Lbl };
    expect(() => gateT8.handcheckAgreement('x' as never)).toThrow(/pairs must be an array/);
    expect(() => gateT8.handcheckAgreement([null as never])).toThrow(/arm undefined/);
    expect(() => gateT8.handcheckAgreement([{ ...p, arm: 'both' as never }])).toThrow(/arm both/);
    expect(() => gateT8.handcheckAgreement([{ ...p, judge: 'bogus' as never }])).toThrow(/a label outside LABELS/);
    expect(() => gateT8.handcheckAgreement([{ ...p, operator: 'bogus' as never }])).toThrow(/a label outside LABELS/);
    const g = gateT8.handcheckAgreement([p, p]);
    expect(eq(g.treatment, fr(0, 2))).toBe(true);
    expect(g.control).toBeNull();
    expect(eq(g.all, fr(0, 2))).toBe(true);
  });

  it('edge: a halts threshold is read exactly: one, a negative or a non-number is refused, six places are read, and a minimum of 1 is allowed', () => {
    const D = gateT8.HALT_DEFAULTS;
    expect(() => decide({ halts: { ...D, absent_rate_max: 1 } })).toThrow(/halts.absent_rate_max must be a number in \[0, 1\)/);
    expect(() => decide({ halts: { ...D, run_failed_max: 1 } })).toThrow(/halts.run_failed_max must be a number in \[0, 1\)/);
    expect(() => decide({ halts: { ...D, run_failed_max: -0.1 } })).toThrow(/halts.run_failed_max must be a number/);
    expect(() => decide({ halts: { ...D, absent_rate_max: Number.NaN } })).toThrow(/halts.absent_rate_max must be a number/);
    expect(() => decide({ halts: { ...D, absent_rate_max: '0.05' as never } })).toThrow(/halts.absent_rate_max must be a number/);
    expect(() => decide({ halts: { ...D, handcheck_agreement_min: 1.5 } })).toThrow(/halts.handcheck_agreement_min must be a number in \[0, 1\]/);
    expect(() => decide({ halts: { ...D, handcheck_agreement_min: -0.5 } })).toThrow(/halts.handcheck_agreement_min must be a number/);
    expect(() => decide({ halts: undefined as never })).toThrow(/halts.absent_rate_max must be a number/);
    expect(decide({ halts: { ...D, absent_rate_max: 0.000001 } }).halts, 'six places are read').toEqual([]);
    // 1 is a legal minimum: only an arm in full agreement clears it.
    const one = { ...D, handcheck_agreement_min: 1 };
    expect(decide({ halts: one, handcheck: { agreement: { treatment: fr(1, 1), control: fr(3, 3) } } }).halts).toEqual([]);
    expect(decide({ halts: one, handcheck: { agreement: { treatment: fr(1, 1), control: fr(99, 100) } } }).halts).toEqual(['handcheck-agreement']);
    // 0 is a legal run_failed_max: any run-failed question halts, none does not.
    const zero = { ...D, run_failed_max: 0 };
    expect(decide({ halts: zero }).halts).toEqual([]);
    expect(decide({ halts: zero, quiz: quizOf(20, () => [...rep(4, () => q(R(), U())), q(U(), U(), true)]) }).halts).toEqual(['run-failed']);
  });

  it('edge: decideGate refuses a malformed input with a throw, never a default', () => {
    expect(() => gateT8.decideGate(null as never)).toThrow(/inputs must be an object/);
    expect(() => decide({ codeChanged: 'yes' as never })).toThrow(/codeChanged must be a boolean/);
    expect(() => decide({ quiz: { families: [] } })).toThrow(/no frozen question/);
    const fams = passingQuiz().families;
    const dup = { families: [fams[0]!, { ...fams[1]!, key: fams[0]!.key }, ...fams.slice(2)] };
    expect(() => decide({ quiz: dup })).toThrow(/quiz family .* is missing or repeated/);
    const noKey = passingQuiz();
    (noKey.families[0] as { key: unknown }).key = 7;
    expect(() => decide({ quiz: noKey })).toThrow(/quiz family 7 is missing or repeated/);
    const badRf = quizOf(20, () => [q(R(), U())]);
    (badRf.families[0]!.questions[0] as { runFailed: unknown }).runFailed = 'no';
    expect(() => decide({ quiz: badRf })).toThrow(/needs a boolean runFailed/);
    const badJf = quizOf(20, () => [q(R(), U())]);
    (badJf.families[0]!.questions[0]!.control as { judgeFailed: unknown }).judgeFailed = undefined;
    expect(() => decide({ quiz: badJf })).toThrow(/\(control\) needs a boolean judgeFailed/);
    expect(() => decide({ quiz: quizOf(20, () => [q(ans('bogus' as never), U())]) })).toThrow(/\(treatment\) has label bogus/);
    expect(() => decide({ quiz: quizOf(20, () => [q(ans('correct', 'unknown'), U())]) })).toThrow(/is unknown and labelled correct/);
    expect(() => decide({ quiz: quizOf(20, () => [q(null as never, U())]) })).toThrow(/\(treatment\) has answer state undefined/);
    const lf = (o: Partial<LiveFam>[]): Inputs['live'] => ({ families: o.map((x, i) => ({ ...liveFam(fk(300 + i), 'treatment', 2, 1), ...x })) });
    expect(() => decide({ live: lf([{ key: fk(300) }, { key: fk(300) }]) })).toThrow(/live family .* is missing or repeated/);
    expect(() => decide({ live: lf([{ arm: 'both' as never }]) })).toThrow(/has arm both/);
    expect(() => decide({ live: lf([{ changed: 1 as never }]) })).toThrow(/needs boolean changed and unrealised/);
    expect(() => decide({ live: lf([{ unrealised: undefined as never }]) })).toThrow(/needs boolean changed and unrealised/);
    expect(() => decide({ live: lf([{ windows: [{ ...win(true), state: 'weird' as never }] }]) })).toThrow(/has a malformed window/);
    expect(() => decide({ live: lf([{ windows: [{ ...win(true), with_call: 1 as never }] }]) })).toThrow(/has a malformed window/);
    expect(() => decide({ live: lf([{ windows: [null as never] }]) })).toThrow(/has a malformed window/);
    expect(() => decide({ handcheck: { agreement: { treatment: { num: 1, den: 0 }, control: null } } })).toThrow(/handcheck.agreement.treatment must be a fraction or null/);
    expect(() => decide({ handcheck: { agreement: { treatment: null, control: { num: 1.5, den: 2 } } } })).toThrow(/handcheck.agreement.control must be a fraction or null/);
    expect(() => decide({ handcheck: { agreement: { treatment: 'x' as never, control: null } } })).toThrow(/must be a fraction or null/);
  });

  it('edge: the question-not-run refusal lists each question once, sorted by code unit, and never lists a run-failed question', () => {
    const named = (qid: string, mk: () => Qn): Qn => ({ ...mk(), qid });
    const nr = (): Ans => ans(null, 'not-run' as never);
    const bothNotRun = named('a', () => q(nr(), nr()));
    const oneNotRun = named('B', () => q(R(), nr()));
    const failedNotRun = named('c', () => q(nr(), nr(), true));
    const quiz = quizOf(20, (i) => (i === 0 ? [bothNotRun, failedNotRun] : i === 1 ? [oneNotRun] : [q(R(), U())]));
    const out = gateT8.decideGate(base({ quiz }));
    expect(out).toEqual({ ok: false, reason: 'question-not-run', questions: ['B', 'a'], detail: 'decideGate: 2 question(s) still not-run: B, a; run or record them first' });
    // A run-failed question's arms are never read, so a lone one is no refusal.
    const only = quizOf(20, (i) => (i === 0 ? [named('c', () => q(nr(), nr(), true)), q(R(), U())] : [q(R(), U())]));
    expect(gateT8.decideGate(base({ quiz: only })).ok).toBe(true);
  });

  it('edge: the halts are listed in the order absent-rate, run-failed, handcheck-agreement, empty-arm, and the first two beside the hold', () => {
    // 20 families of 5 questions, 6 of them run-failed (family 0 to 5, the last question) and 6 absent treatment answers in the others.
    const quiz = quizOf(20, (i) => [q(R(), U()), q(R(), U()), q(R(), U()), i < 6 ? q(U(), U(), true) : q(U(), U()),
      i >= 6 && i < 12 ? q(ans('uncertain', 'absent'), U()) : q(U(), U())]);
    const v = decide({ quiz, live: { families: [liveFam(fk(200), 'control', 10, 0)] }, handcheck: { agreement: { treatment: fr(1, 2), control: null } } });
    expect(v.halts).toEqual(['absent-rate', 'run-failed', 'handcheck-agreement', 'empty-arm']);
    expect(v.verdict).toBe('halt');
    expect(v.criteria).toEqual({ accuracy: null, fabrication: null, uptake: null });
    expect(v.counts).toMatchObject({ Q: 94, run_failed: 6 });
    expect(eq(v.counts.absent.treatment, fr(6, 94))).toBe(true);
  });

  it('edge: the comparison block lists a family once, sorted, whichever drop it carries; an unrealised treatment family stays in criterion 3', () => {
    const v = decide({ live: { families: [
      liveFam(fk(300), 'control', 10, 0, { unrealised: true }),
      liveFam(fk(100), 'treatment', 10, 5, { changed: true, unrealised: true }),
      liveFam(fk(200), 'treatment', 10, 1, { unrealised: true }),
      liveFam(fk(250), 'treatment', 10, 1),
    ] } });
    expect(v.comparison.dropped).toEqual([fk(100), fk(200), fk(300)]);
    expect(eq(v.criteria.uptake!.point, fr(7, 30)), 'both dropped treatment families are in the denominator').toBe(true);
  });

  it('edge: B and the two substreams: criterion 1 draws from quiz-ci, criterion 3 from live-ci, and skipping one never moves the other', () => {
    // Clusters of unequal shares and sizes, so the pooled denominators vary and a replicate stream can be told from another by its nearest-rank bounds.
    const live: Inputs['live'] = { families: [1, 3, 5, 7, 9, 2, 6, 4].map((n, i) => liveFam(fk(100 + i), 'treatment', 10 - (i % 3), n)) };
    const clusters = live.families.map((f) => ({ num: f.windows.filter((w) => w.with_call).length, den: f.windows.length }));
    const rawQuiz = quizOf(20, (i) => Array.from({ length: 3 + (i % 3) }, (_, j) => q(j < (i * 7) % 6 ? R() : U(), j < (i * 5) % 4 ? R() : U())));
    // decideGate bootstraps the families in key order (D-5787), and fk(i)'s code-unit order is not index order past 9: keys padded to two digits keep this
    // case's cluster order the index order it was measured in, which `paired` below mirrors.
    const quiz: Inputs['quiz'] = { families: rawQuiz.families.map((f, i) => ({ ...f, key: JSON.stringify(['store-a', `demo-${String(i).padStart(2, '0')}`, 'gen']) })) };
    const paired = quiz.families.map((f) => ({ t: f.questions.filter((x) => x.treatment.label === 'correct').length,
      c: f.questions.filter((x) => x.control.label === 'correct').length, n: f.questions.length }));
    for (const seed of [SEED, SEED2, 'ef'.repeat(32)]) {
      const a = decide({ seedHex: seed, live, quiz });
      const wantUp = gateT8.clusterBootstrap({ clusters, B: 10000, rng: gateT8.substream(seed, 'live-ci'), mode: 'share' });
      const wantAcc = gateT8.clusterBootstrap({ clusters: paired, B: 10000, rng: gateT8.substream(seed, 'quiz-ci'), mode: 'paired' });
      expect(a.criteria.uptake!.lower, seed).toEqual(wantUp.lower);
      expect(a.criteria.accuracy!.lower, seed).toEqual(wantAcc.lower);
      expect(a.criteria.uptake!.upper, seed).toEqual(wantUp.upper);
      expect(a.criteria.accuracy!.upper, seed).toEqual(wantAcc.upper);
      // Criterion 1 skipped under an absent-rate halt: criterion 3's interval is the same one.
      const absent = quizOf(20, (i) => [...rep(3, () => q(R(), U())), q(U(), U()), i < 6 ? q(ans('uncertain', 'absent'), U()) : q(U(), U())]);
      const b = decide({ seedHex: seed, live, quiz: absent });
      expect(b.criteria.accuracy).toBeNull();
      expect(b.criteria.uptake!.lower, seed).toEqual(wantUp.lower);
      expect(b.criteria.uptake!.upper, seed).toEqual(wantUp.upper);
    }
    // B is the caller's: B = 1 is a single replicate, which is both bounds.
    const one = decide({ live, quiz, B: 1 });
    const wantOne = gateT8.clusterBootstrap({ clusters, B: 1, rng: gateT8.substream(SEED, 'live-ci'), mode: 'share' });
    expect(one.criteria.uptake!.lower).toEqual(wantOne.lower);
    expect(one.criteria.uptake!.upper).toEqual(wantOne.upper);
    expect(one.criteria.uptake!.lower).not.toEqual(decide({ live, quiz }).criteria.uptake!.lower);
  });

  // ── Fix round 1: inputs the brief's code read as defaults, and the pins it left open ──
  it('fix1: a hand-check section that is missing, or lacks an arm key, is refused; explicit nulls are not', () => {
    const none = { treatment: null, control: null };
    expect(() => decide({ handcheck: undefined as never })).toThrow(/handcheck must be an object/);
    expect(() => decide({ handcheck: null as never })).toThrow(/handcheck must be an object/);
    expect(() => decide({ handcheck: {} as never })).toThrow(/handcheck.agreement must be an object/);
    expect(() => decide({ handcheck: { agreement: null } as never })).toThrow(/handcheck.agreement must be an object/);
    expect(() => decide({ handcheck: { agreement: { treatment: fr(9, 10) } } as never })).toThrow(/handcheck.agreement.control must be present/);
    expect(() => decide({ handcheck: { agreement: { control: fr(9, 10) } } as never })).toThrow(/handcheck.agreement.treatment must be present/);
    expect(() => decide({ handcheck: { agreement: Object.create({ treatment: null, control: null }) } as never }), 'inherited keys are not own').toThrow(/must be present/);
    expect(() => decide({ handcheck: { agreement: { treatment: undefined, control: null } } as never })).toThrow(/handcheck.agreement.treatment must be a fraction or null/);
    const v = decide({ handcheck: { agreement: none } });
    expect(v.halts, 'explicit nulls: no pair, no halt').toEqual([]);
    expect(v.verdict).toBe('pass');
  });

  it('fix1: an agreement is a share in [0, 1], an integer fraction with a positive denominator', () => {
    const at = (treatment: unknown) => (): unknown => decide({ handcheck: { agreement: { treatment, control: null } } as never });
    expect(at(fr(11, 10)), 'above 1').toThrow(/handcheck.agreement.treatment must lie in \[0, 1\]/);
    expect(at(fr(-3, 1)), 'below 0').toThrow(/must lie in \[0, 1\]/);
    expect(at(fr(1, -2)), 'a negative denominator').toThrow(/must be a fraction or null/);
    expect(at(fr(1, 1.5)), 'a fractional denominator').toThrow(/must be a fraction or null/);
    expect(at(fr(1, 0)), 'a zero denominator').toThrow(/must be a fraction or null/);
    expect(at(fr(0.5, 2)), 'a fractional numerator').toThrow(/must be a fraction or null/);
    expect((at(fr(10, 10)) as () => Verdict)().halts, 'exactly 1 is a share').toEqual([]);
    expect((at(fr(0, 5)) as () => Verdict)().halts, 'exactly 0 is a share, and halts').toEqual(['handcheck-agreement']);
  });

  it('fix1: a seven-place threshold with no exponent is refused as "at most six places"', () => {
    expect(String(0.1234567), 'CONTROL: no exponent in this rendering').toBe('0.1234567');
    expect(() => decide({ halts: { ...gateT8.HALT_DEFAULTS, absent_rate_max: 0.1234567 } })).toThrow(/at most six places/);
    expect(() => decide({ halts: { ...gateT8.HALT_DEFAULTS, handcheck_agreement_min: 0.8000001 } })).toThrow(/at most six places/);
  });

  it('fix1: an unlabelled judge-failed CONTROL answer holds the verdict too', () => {
    const quiz = quizOf(20, (i) => [...rep(3, () => q(R(), U())), q(U(), U()), i === 0 ? q(U(), ans(null, 'value', true)) : q(U(), U())]);
    const v = decide({ quiz });
    expect(v.verdict).toBe('incomplete');
    expect(v.criteria.accuracy).toBeNull();
    expect(v.criteria.fabrication).toBeNull();
    expect(v.criteria.uptake!.holds).toBe(true);
    const labelled = quizOf(20, (i) => [...rep(3, () => q(R(), U())), q(U(), U()), i === 0 ? q(U(), ans('uncertain', 'value', true)) : q(U(), U())]);
    expect(decide({ quiz: labelled }).verdict, 'labelled by the operator, it decides').toBe('pass');
  });

  it('fix1: the control arm point accuracy is its correct answers over Q', () => {
    // 10 families of 5; treatment correct in 2, control in 1 of each; a run-failed question in family 0 (Q = 50, 51 frozen).
    const quiz = quizOf(10, (i) => [q(R(), R()), q(R(), U()), ...rep(3, () => q(U(), U())), ...(i === 0 ? [q(R(), R(), true)] : [])]);
    const v = decide({ quiz });
    expect(v.counts).toMatchObject({ Q: 50, run_failed: 1 });
    expect(eq(v.criteria.accuracy!.point_t, fr(20, 50))).toBe(true);
    expect(eq(v.criteria.accuracy!.point_c, fr(10, 50))).toBe(true);
    expect(v.criteria.accuracy!.holds).toBe(true);
  });

  it('fix1: a repeated or non-string qid is refused, a run-failed question\'s included', () => {
    const withQid = (qid: unknown, where: 'live' | 'failed' = 'live') => {
      const quiz = quizOf(20, () => [q(R(), U()), q(U(), U())]);
      (quiz.families[3]!.questions[1] as { qid: unknown }).qid = qid;
      if (where === 'failed') (quiz.families[3]!.questions[1] as { runFailed: boolean }).runFailed = true;
      return quiz;
    };
    const taken = quizOf(20, () => [q(R(), U()), q(U(), U())]);
    (taken.families[7]!.questions[0] as { qid: string }).qid = taken.families[2]!.questions[1]!.qid;
    expect(() => decide({ quiz: taken })).toThrow(/qid .* is missing or repeated/);
    const failedTwin = quizOf(20, () => [q(R(), U()), q(U(), U())]);
    (failedTwin.families[9]!.questions[1] as { qid: string; runFailed: boolean }).qid = failedTwin.families[0]!.questions[0]!.qid;
    (failedTwin.families[9]!.questions[1] as { qid: string; runFailed: boolean }).runFailed = true;
    expect(() => decide({ quiz: failedTwin }), 'a run-failed question still has its own qid').toThrow(/qid .* is missing or repeated/);
    expect(() => decide({ quiz: withQid(7) })).toThrow(/qid 7 is missing or repeated/);
    expect(() => decide({ quiz: withQid(undefined) })).toThrow(/qid undefined is missing or repeated/);
    expect(() => decide({ quiz: withQid(7, 'failed') })).toThrow(/qid 7 is missing or repeated/);
  });

  it('fix1: seedHex and B are refused on every path, a hold, a halt and a refusal included', () => {
    const held = quizOf(20, (i) => [...rep(4, () => q(R(), U())), i === 0 ? q(ans(null, 'value', true), U()) : q(U(), U())]);
    const absentHalt = quizOf(20, (i) => [...rep(3, () => q(R(), U())), q(U(), U()), i < 6 ? q(ans('uncertain', 'absent'), U()) : q(U(), U())]);
    const notRun = quizOf(20, () => rep(5, () => q(R(), U())));
    (notRun.families[0]!.questions[0]!.control as { answerState: string }).answerState = 'not-run';
    for (const [name, quiz] of [['hold', held], ['halt', absentHalt], ['refusal', notRun], ['plain', passingQuiz()]] as const) {
      for (const bad of [42, '', undefined, null]) {
        expect(() => decide({ quiz, seedHex: bad as never }), `${name}: seedHex ${String(bad)}`).toThrow(/seedHex must be a non-empty string/);
      }
      for (const bad of [0, -1, 1.5, null, '10', Number.NaN, 2 ** 53]) {
        expect(() => decide({ quiz, B: bad as never }), `${name}: B ${String(bad)}`).toThrow(/B must be a positive safe integer/);
      }
    }
    expect(decide({ quiz: held, B: undefined }).verdict, 'an absent B takes the default').toBe('incomplete');
    expect(decide({ B: undefined }).verdict).toBe('pass');
    expect(decide({ B: 1 }).ok, 'B = 1 is a positive integer').toBe(true);
  });

  it('fix1: a missing live section is refused; an explicitly empty one halts empty-arm', () => {
    expect(() => decide({ live: undefined as never })).toThrow(/live must be an object with a families array/);
    expect(() => decide({ live: null as never })).toThrow(/live must be an object with a families array/);
    expect(() => decide({ live: {} as never })).toThrow(/live must be an object with a families array/);
    expect(() => decide({ live: { families: 'x' } as never })).toThrow(/live must be an object with a families array/);
    const v = decide({ live: { families: [] } });
    expect(v.halts).toEqual(['empty-arm']);
    expect(v.criteria.uptake).toBeNull();
  });

  // ── Final fix wave, item C (spec 10.2 "Always reported"; W2-D85): the CI's upper bound rides beside its lower ──
  it('final C: the verdict carries the bootstrap upper bound beside the lower, in both criteria, exactly', () => {
    // Criterion 3: four treatment families at 1, 9, 5 and 3 windows of 10 with a call; the pooled point is 18/40, the
    // 2.5% rank is 8/40 and the 97.5% rank is 30/40 (measured with the gate's own substream 'live-ci').
    const live: Inputs['live'] = { families: [
      ...[1, 9, 5, 3].map((n, i) => liveFam(fk(100 + i), 'treatment', 10, n)),
      ...[0, 1, 2, 3].map((i) => liveFam(fk(200 + i), 'control', 10, 0)),
    ] };
    const up = decide({ live }).criteria.uptake!;
    expect(eq(up.point, fr(18, 40))).toBe(true);
    expect(eq(up.lower, fr(8, 40))).toBe(true);
    expect(eq(up.upper, fr(30, 40)), 'the upper bound is the 97.5% rank, not the lower').toBe(true);
    // Criterion 1: the one-positive-family-in-20 quiz has the paired interval [0/20, 3/20].
    const acc = decide({ quiz: quizOf(20, (i) => [i === 0 ? q(R(), U()) : i <= 8 ? q(R(), R()) : q(U(), U())]) }).criteria.accuracy!;
    expect(eq(acc.lower, fr(0, 20))).toBe(true);
    expect(eq(acc.upper, fr(3, 20))).toBe(true);
    // The verdict's bounds are the bootstrap's own.
    const clusters = live.families.filter((f) => f.arm === 'treatment').map((f) => ({ num: f.windows.filter((w) => w.with_call).length, den: f.windows.length }));
    const want = gateT8.clusterBootstrap({ clusters, B: 10000, rng: gateT8.substream(SEED, 'live-ci'), mode: 'share' });
    expect(up.upper).toEqual(want.upper);
  });

  it('final C: a criterion with no cluster left carries no interval at all, lower or upper (empty-arm)', () => {
    const v = decide({ live: { families: [] } });
    expect(v.criteria.uptake).toBeNull();
    const w = decide({ quiz: quizOf(20, () => [q(ans('uncertain'), U(), true)]) });
    expect(w.criteria.accuracy).toBeNull();
  });

  describe('review fix round 1: decideGate is independent of input order (D-5787)', () => {
    // clusterBootstrap draws clusters by index, so the order the caller lists the families in used to move the nearest-rank bounds.
    // Each fixture below is CHECKED to be order-sensitive on the raw bootstrap (the control), so the pins cannot pass vacuously.
    const isPerm = (p: number[]): boolean => [...p].sort((a, b) => a - b).every((v, i) => v === i);
    const keyOrder = <T extends { key: string }>(xs: T[]): T[] => [...xs].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    /** A fixed interleaving of 17 positions, a literal permutation (no randomness). */
    const WEAVE = [3, 12, 0, 9, 15, 6, 1, 13, 4, 16, 8, 2, 11, 5, 14, 7, 10];
    /** The same for 14 positions. */
    const WEAVE14 = [3, 12, 0, 9, 6, 1, 13, 4, 8, 2, 11, 5, 10, 7];
    const ordersOf = <T extends { key: string }>(sorted: T[], weave: number[]): Array<[string, T[]]> => {
      expect(isPerm(weave) && weave.length === sorted.length, 'the interleaving is a permutation of the families').toBe(true);
      return [['by key', [...sorted]], ['reversed', [...sorted].reverse()], ['interleaved', weave.map((i) => sorted[i])]];
    };
    const distinct = (xs: Fr[]): number => new Set(xs.map((x) => `${x.num}/${x.den}`)).size;

    it('criterion 3: three orders of 14 treatment families (and 3 control) give one bound, one verdict, and the key-ordered bootstrap', () => {
      const withCalls = [1, 9, 2, 8, 3, 7, 0, 10, 5, 4, 6, 2, 9, 1];
      const dens = [10, 10, 9, 10, 8, 10, 10, 10, 7, 10, 10, 9, 10, 8];
      const sorted: LiveFam[] = [
        ...withCalls.map((w, i) => liveFam(fk(100 + i), 'treatment', dens[i], Math.min(w, dens[i]))),
        ...[0, 1, 2].map((i) => liveFam(fk(200 + i), 'control', 10, 0)),
      ];
      expect(sorted.map((f) => f.key), 'the fixture is listed in key order').toEqual(keyOrder(sorted).map((f) => f.key));
      const orders = ordersOf(sorted, WEAVE);
      const treatmentOf = (fams: LiveFam[]) => fams.filter((f) => f.arm === 'treatment')
        .map((f) => ({ num: f.windows.filter((w) => w.with_call).length, den: f.windows.length }));
      const raw = (fams: LiveFam[]) => gateT8.clusterBootstrap({ clusters: treatmentOf(fams), B: gateT8.BOOTSTRAP.B, rng: gateT8.substream(SEED, 'live-ci'), mode: 'share' });
      // CONTROL: the raw bootstrap over the treatment clusters depends on the order they are listed in.
      expect(distinct(orders.map(([, fams]) => raw(fams).lower)), 'non-vacuous: the raw order moves the lower bound').toBeGreaterThanOrEqual(2);
      const want = raw(sorted);
      const verdicts = orders.map(([name, fams]) => {
        const listed = fams.map((f) => f.key);
        const v = decide({ live: { families: fams } });
        expect(fams.map((f) => f.key), `${name}: decideGate sorts a copy, never the array it was given`).toEqual(listed);
        return v;
      });
      for (const [i, v] of verdicts.entries()) {
        expect(v.criteria.uptake!.lower, orders[i][0]).toEqual(want.lower);
        expect(v.criteria.uptake!.upper, orders[i][0]).toEqual(want.upper);
        expect(v.criteria.uptake, orders[i][0]).toEqual(verdicts[0].criteria.uptake);
        expect(v.verdict, orders[i][0]).toBe(verdicts[0].verdict);
      }
    });

    it('criterion 1: three orders of 14 quiz families give one paired bound, one verdict, and the key-ordered bootstrap', () => {
      // Family i holds 3 + (i % 3) questions; its treatment and control correct counts differ per family, so the paired clusters differ.
      const sizes = Array.from({ length: 14 }, (_, i) => 3 + (i % 3));
      const treatmentCorrect = [3, 1, 5, 0, 4, 2, 3, 3, 0, 4, 1, 5, 2, 3];
      const controlCorrect = [1, 1, 1, 3, 0, 2, 2, 0, 0, 1, 1, 2, 0, 3];
      const fams = sizes.map((n, i) => ({
        key: JSON.stringify(['store-a', `demo-${String(i).padStart(2, '0')}`, 'gen']),
        questions: Array.from({ length: n }, (_, j) => q(j < Math.min(treatmentCorrect[i], n) ? R() : U(), j < Math.min(controlCorrect[i], n) ? R() : U())),
      }));
      const clustersOf = (xs: typeof fams) => xs.map((f) => ({ t: f.questions.filter((x) => x.treatment.label === 'correct').length,
        c: f.questions.filter((x) => x.control.label === 'correct').length, n: f.questions.length }));
      const orders = ordersOf(fams, WEAVE14);
      expect(fams.map((f) => f.key), 'the fixture is listed in key order').toEqual(keyOrder(fams).map((f) => f.key));
      const raw = (xs: typeof fams) => gateT8.clusterBootstrap({ clusters: clustersOf(xs), B: gateT8.BOOTSTRAP.B, rng: gateT8.substream(SEED, 'quiz-ci'), mode: 'paired' });
      expect(distinct(orders.map(([, xs]) => raw(xs).lower)), 'non-vacuous: the raw order moves the paired lower bound').toBeGreaterThanOrEqual(2);
      const want = raw(fams);
      const verdicts = orders.map(([name, xs]) => {
        const listed = xs.map((f) => f.key);
        const v = decide({ quiz: { families: xs } });
        expect(xs.map((f) => f.key), `${name}: decideGate sorts a copy, never the array it was given`).toEqual(listed);
        return v;
      });
      for (const [i, v] of verdicts.entries()) {
        const a = v.criteria.accuracy!;
        expect(a.lower, orders[i][0]).toEqual(want.lower);
        expect(a.upper, orders[i][0]).toEqual(want.upper);
        expect(a, orders[i][0]).toEqual(verdicts[0].criteria.accuracy);
        expect(v.verdict, orders[i][0]).toBe(verdicts[0].verdict);
      }
    });

    // The order is by CODE UNIT (the module's cmpId), not by locale and not with digit runs read as numbers. Two key schemes
    // separate the comparators: unpadded ids ('demo-10' sorts before 'demo-2' by code unit, after it numerically), and mixed-case
    // store ids ('Store-B' sorts before 'store-a' by code unit, after it by locale). Each is CHECKED to move the bootstrap.
    const codeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
    const SCHEMES: Array<{ name: string; key: (i: number) => string; alt: (a: string, b: string) => number }> = [
      { name: 'unpadded ids (numeric order differs)', key: (i) => fk(i), alt: (a, b) => a.localeCompare(b, undefined, { numeric: true }) },
      { name: 'mixed-case store ids (locale order differs)', key: (i) => JSON.stringify([i % 2 === 0 ? 'store-a' : 'Store-B', `demo-${String(i).padStart(2, '0')}`, 'gen']), alt: (a, b) => a.localeCompare(b) },
    ];

    it('criterion 3: the order is by code unit, not by locale and not numeric (D-5787)', () => {
      const withCalls = [1, 9, 2, 8, 3, 7, 0, 10, 5, 4, 6, 2, 9, 1];
      const dens = [10, 10, 9, 10, 8, 10, 10, 10, 7, 10, 10, 9, 10, 8];
      for (const sc of SCHEMES) {
        const sorted = withCalls.map((w, i) => liveFam(sc.key(i), 'treatment', dens[i], Math.min(w, dens[i])))
          .sort((a, b) => codeUnit(a.key, b.key));
        const share = (f: LiveFam) => ({ num: f.windows.filter((w) => w.with_call).length, den: f.windows.length });
        const boot = (cmp: (a: string, b: string) => number) => gateT8.clusterBootstrap({
          clusters: [...sorted].sort((a, b) => cmp(a.key, b.key)).map(share), B: gateT8.BOOTSTRAP.B, rng: gateT8.substream(SEED, 'live-ci'), mode: 'share' });
        const want = boot(codeUnit);
        const other = boot(sc.alt);
        expect(sorted.map((f) => f.key).join('|') === [...sorted].sort((a, b) => sc.alt(a.key, b.key)).map((f) => f.key).join('|'),
          `${sc.name}: the alternative comparator orders the keys differently`).toBe(false);
        expect(`${other.lower.num}/${other.lower.den} ${other.upper.num}/${other.upper.den}`,
          `${sc.name}: non-vacuous, the alternative order moves a bound`).not.toBe(`${want.lower.num}/${want.lower.den} ${want.upper.num}/${want.upper.den}`);
        for (const [name, fams] of ordersOf(sorted, WEAVE14)) {
          const got = decide({ live: { families: fams } }).criteria.uptake!;
          expect(got.lower, `${sc.name}, ${name}`).toEqual(want.lower);
          expect(got.upper, `${sc.name}, ${name}`).toEqual(want.upper);
        }
      }
    });

    it('criterion 1: the order is by code unit, not by locale and not numeric (D-5787)', () => {
      const sizes = Array.from({ length: 14 }, (_, i) => 3 + (i % 3));
      const treatmentCorrect = [3, 1, 5, 0, 4, 2, 3, 3, 0, 4, 1, 5, 2, 3];
      const controlCorrect = [1, 1, 1, 3, 0, 2, 2, 0, 0, 1, 1, 2, 0, 3];
      for (const sc of SCHEMES) {
        const sorted = sizes.map((n, i) => ({
          key: sc.key(i),
          questions: Array.from({ length: n }, (_, j) => q(j < Math.min(treatmentCorrect[i], n) ? R() : U(), j < Math.min(controlCorrect[i], n) ? R() : U())),
        })).sort((a, b) => codeUnit(a.key, b.key));
        const cluster = (f: (typeof sorted)[number]) => ({ t: f.questions.filter((x) => x.treatment.label === 'correct').length,
          c: f.questions.filter((x) => x.control.label === 'correct').length, n: f.questions.length });
        const boot = (cmp: (a: string, b: string) => number) => gateT8.clusterBootstrap({
          clusters: [...sorted].sort((a, b) => cmp(a.key, b.key)).map(cluster), B: gateT8.BOOTSTRAP.B, rng: gateT8.substream(SEED, 'quiz-ci'), mode: 'paired' });
        const want = boot(codeUnit);
        const other = boot(sc.alt);
        expect(sorted.map((f) => f.key).join('|') === [...sorted].sort((a, b) => sc.alt(a.key, b.key)).map((f) => f.key).join('|'),
          `${sc.name}: the alternative comparator orders the keys differently`).toBe(false);
        expect(`${other.lower.num}/${other.lower.den} ${other.upper.num}/${other.upper.den}`,
          `${sc.name}: non-vacuous, the alternative order moves a bound`).not.toBe(`${want.lower.num}/${want.lower.den} ${want.upper.num}/${want.upper.den}`);
        for (const [name, fams] of ordersOf(sorted, WEAVE14)) {
          const got = decide({ quiz: { families: fams } }).criteria.accuracy!;
          expect(got.lower, `${sc.name}, ${name}`).toEqual(want.lower);
          expect(got.upper, `${sc.name}, ${name}`).toEqual(want.upper);
        }
      }
    });
  });
});

// ── W2-3 Task 9: the counter definitions and the open record (W2-D87, W2-D25, W2-D24, W2-D90; D-5781) ──────────
// Pure: every input is a parameter, the seed included (W2-D19: no function reads a seed from anywhere else). The
// records are synthetic stand-ins: store ids, ccrc ids, generations, model ids and release tags are made up here,
// and every sha- or seed-shaped value is assembled at runtime by hashing a label, so no key-shaped literal is
// committed. Import declarations are hoisted, so this block's own imports may sit at the end of the file.
import * as gate9 from '../../deploy/history-gate.mjs';
import { canonicalJson as cj9, sha256Hex as sha9 } from '../../ccd/history/lib.mjs';

describe('W2-3 Task 9: the counter definitions and the open record', () => {
  type Ref = { store_id: string; ccrc_id: string; generation: string };
  type Rec = Record<string, any>;
  type Err = { path: string; word: string };
  type Spec = { type: string; status: string; value?: unknown; fields?: Record<string, Spec>; items?: Spec };
  const DAY = 86_400_000;
  const T0 = 1_800_000_000_000;
  /** A sha- or seed-shaped value, assembled at runtime from a label. */
  const hex = (label: string): string => sha9(`w2-3 task 9 fixture: ${label}`);
  const SEED = hex('seed');
  const STORE_A = '00000000-0000-4000-8000-0000000000a1';
  const STORE_B = '00000000-0000-4000-8000-0000000000b2';
  const gen = (n: number): string => `0189abcd-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const OPUS = 'claude-opus-9-1';
  const ARM = 'claude-arm-9-1';
  const TAG = 'v0.0.900';
  const CODE: Record<string, string> = Object.fromEntries(gate9.GATE_CODE_FILES.map((f: string) => [f, hex(`code ${f}`)]));
  const refOf = (f: Ref): Ref => ({ store_id: f.store_id, ccrc_id: f.ccrc_id, generation: f.generation });
  const armOf = (f: Ref): string => gate9.armOf(SEED, f);
  /** An amendment whose detail_sha256 is its detail's sha256, which the validator recomputes (W2-D25, amended). */
  const amendment = (kind: string, node: string | null, at: number, detail: Rec): Rec =>
    ({ kind, node_label_ref: node, at_ms: at, detail_sha256: sha9(cj9(detail)), detail });

  /** One (store, id) whose two generations draw opposite arms under SEED: found by search, so the fixture holds
   *  for whatever bit the seed gives. */
  const SPLIT = ((): { treated: Ref; controlled: Ref } => {
    let treated: Ref | null = null;
    let controlled: Ref | null = null;
    for (let n = 200; treated === null || controlled === null; n += 1) {
      const f = { store_id: STORE_A, ccrc_id: 'sess-split', generation: gen(n) };
      if (armOf(f) === 'treatment') treated ??= f;
      else controlled ??= f;
    }
    return { treated, controlled };
  })();
  const FAMILIES: Ref[] = [
    ...[...Array(10)].map((_, i) => ({ store_id: i % 2 === 0 ? STORE_A : STORE_B, ccrc_id: `sess-${i}`, generation: gen(i) })),
    SPLIT.treated, SPLIT.controlled,
  ];
  const ASSIGNMENT: Array<Ref & { arm: string }> = gate9.assignArms(SEED, FAMILIES);
  const SOLO = ASSIGNMENT.filter((a) => a.ccrc_id !== 'sess-split');
  const QUIZ: Ref[] = SOLO.filter((a) => a.arm === 'treatment').map(refOf);
  const CONTROL_SOLO: Ref = refOf(SOLO.find((a) => a.arm === 'control')!);
  const PILOT: Ref[] = [{ store_id: STORE_A, ccrc_id: 'pilot-0', generation: gen(100) }];
  const N_QUESTIONS = 64;

  const labeller = (): Rec => ({ ...gate9.LABELLER, path_forms: [...gate9.LABELLER.path_forms] });
  function draft(): Rec {
    return {
      kind: gate9.OPEN_RECORD_KIND, version: 1, part: 'draft', drafted_ms: T0 - 30 * DAY, supersedes: null,
      nodes: [{ label: 'node-a', store_id: STORE_A }, { label: 'node-b', store_id: STORE_B }],
      account: 'account-a', arm_model: ARM, writer_model: OPUS, judge_model: OPUS,
      // W2-4 Task 8's Step0aOutput, field for field, plus the label and store_id open --draft binds it to (W2-D25, amended).
      step0a: [STORE_A, STORE_B].map((s, i) => ({
        label: `node-${'ab'[i]}`, store_id: s, kind: 'ccrc-history-w2-step0a', v: 1, measured_ms: T0 - 32 * DAY, account: 'account-a',
        settings_mode: 'restricted', claude_code_version: '9.1.0', wrapper_sha256: null,
        flags_accepted: { '--output-format': true, '--verbose': true }, writer_init: { tools: [] }, judge_init: { tools: [] }, box_init: { tools: [] },
        code_shas: { ...CODE }, release_stamp: TAG, budget: 100_000, spend: 1_200,
      })),
      settings_mode: 'restricted', window_plan: { planned_days: 14 },
      k: gate9.K, k_unit: gate9.K_UNIT, x: { ...gate9.X }, metric: gate9.METRIC_TEXT, row_cap: gate9.ROW_CAP,
      bootstrap: { ...gate9.BOOTSTRAP, seed: SEED, substreams: [...gate9.SUBSTREAMS] },
      labeller: { ...labeller(), sha_min_prefix: 7 },
      answer_protocol_sha256: gate9.ANSWER_PROTOCOL_SHA256, writer_prompt_sha256: gate9.WRITER_PROMPT_SHA256,
      rubric_id: 'v1', rubric_sha256: gate9.RUBRIC_SHA256.v1,
      quiz: { kinds: [...gate9.FACT_KINDS], target: 100, min_families: 20, caps: { family: 5, boundary: 3, kind_per_family: 2 },
        halt_floor: { questions: 60, families: 12 }, writer_input: 'excerpt', baseline_files: 'v1' },
      counters_def: { id: 'v1', sha256: gate9.COUNTERS_DEF_V1_SHA256 },
      active_rule: { lookback_ms: 604_800_000, legacy_excluded: true, text: 'a synthetic rule text' },
      q18_settings: { rho_headline: 0.3, power: [0.5, 0.8], lookback_days: 14, sims: 1000, grid_step: 0.005, procedure: 'bisection-on-grid-crn' },
      pilot: {
        seed: hex('pilot seed'), n_fidelity: 5, n_usage: 5, tolerance: 0.25, families: PILOT.map(refOf), frozen_sha256: hex('pilot frozen'),
        writer_model: OPUS,
        used: { labeller: labeller(), sha_min_prefix: 7, writer_input: 'excerpt', baseline_files: 'v1',
          writer_prompt_sha256: gate9.WRITER_PROMPT_SHA256, answer_protocol_sha256: gate9.ANSWER_PROTOCOL_SHA256 },
        code_shas: { ...CODE }, release_stamp: TAG, budget: 3_000_000, spend: 900_000,
      },
      limits: { threshold_pct: 70, max_age_ms: 3_600_000, batch_max: 10, concurrency: 2 },
      pilot_budget: 3_000_000,
      halts: { handcheck_agreement_min: 0.8, run_failed_max: 0.05, absent_rate_max: 0.05 },
      handcheck: { share: 0.2, of: 'judged', per_arm: true, judge_failed: 'always' },
      freezes: { maintenance_from: 'pilot-sourcing', build_from: 'final-rollout', surface: ['deploy/history-*.mjs'] },
      order: { quiz_arms_during_window: true },
      gate_code: { release_tag: TAG, files: { ...CODE } },
    };
  }
  function final(d: Rec = draft()): Rec {
    return {
      ...structuredClone(d), part: 'final', supersedes: gate9.recordSha256(d), finalized_ms: T0 - DAY,
      census: [STORE_A, STORE_B].map((s) => ({ store_id: s, census_ms: T0 - 3 * DAY, census_sha256: hex(`census ${s}`) })),
      registry_drops: [],
      q18: { headline: 0.2, at_power_80: 0.3, at_rho_0: 0.15, rho_hat: 0.1, n_f: {}, coverage: {}, pre_window_uptake: {},
        power_output_sha256: hex('power'), decision: 'keep' },
      pilot_result: { fidelity: [{ pass: true }], usage_extrapolation: {}, step0b_sha256: hex('step0b'), settings_mode: 'restricted',
        absent_rate: { num: 0, den: 10 } },
      spend_budget: 30_000_000,
      assignment: ASSIGNMENT.map((a) => ({ ...a })),
      assignment_sha256: gate9.assignmentSha256(ASSIGNMENT),
      quiz: { ...structuredClone(d.quiz), sha256: hex('quiz'), n_questions: N_QUESTIONS, n_families: QUIZ.length, families: QUIZ.map(refOf) },
      window: { start_ms: T0, end_ms: T0 + 14 * DAY },
      amendments: [],
    };
  }
  const FROZEN = { families: QUIZ.map(refOf), n_questions: N_QUESTIONS };
  type Ctx = { draft: Rec | null; predecessor: Rec | null; frozen: { families: Ref[]; n_questions: number } | null };
  const CTX0: Ctx = { draft: null, predecessor: null, frozen: null };
  const chainOf = (d: Rec): Ctx => ({ draft: d, predecessor: null, frozen: FROZEN });
  const verdict = (r: Rec, ctx: Ctx = CTX0): Err[] => {
    const v = gate9.validateOpenRecord(r, ctx);
    return v.ok ? [] : v.errors;
  };
  /** The validator called as a careless consumer might: with no context, or a partial one. */
  const bare = gate9.validateOpenRecord as unknown as (r: unknown, ctx?: unknown) => { ok: boolean; errors?: Err[] };
  /** Set a dotted path, `a.b[2].c`, on a record. */
  const set = (r: Rec, p: string, value: unknown): Rec => {
    const keys = p.replace(/\[(\d+)\]/g, '.$1').split('.');
    let o = r;
    for (const k of keys.slice(0, -1)) o = o[k];
    o[keys[keys.length - 1]!] = value;
    return r;
  };
  /** A quiz whose families are `fams`, kept consistent with its counts and the frozen file. */
  const withQuiz = (r: Rec, fams: Ref[]): { r: Rec; ctx: Ctx } => {
    r.quiz.families = fams.map(refOf);
    r.quiz.n_families = fams.length;
    return { r, ctx: { draft: draft(), predecessor: null, frozen: { families: fams.map(refOf), n_questions: N_QUESTIONS } } };
  };

  it('the fixture holds: the assignment has both arms, and one id holds a treatment and a control generation', () => {
    expect(new Set(ASSIGNMENT.map((a) => a.arm))).toEqual(new Set(['treatment', 'control']));
    expect(QUIZ.length).toBeGreaterThan(1);
    expect(armOf(SPLIT.treated)).toBe('treatment');
    expect(armOf(SPLIT.controlled)).toBe('control');
  });

  it('COUNTERS_DEF_V1 names exactly the five spec counters and rediscovery, frozen, and its sha is recomputed from it', () => {
    expect(gate9.COUNTERS_DEF_V1.map((c: { name: string }) => c.name))
      .toEqual(['compliance', 'echo_hits', 'lag', 'card_served', 'card_id_mismatch', 'rediscovery']);
    for (const c of gate9.COUNTERS_DEF_V1) expect(c.text.length, c.name).toBeGreaterThan(40);
    expect(Object.isFrozen(gate9.COUNTERS_DEF_V1)).toBe(true);
    for (const c of gate9.COUNTERS_DEF_V1) expect(Object.isFrozen(c), c.name).toBe(true);
    expect(gate9.COUNTERS_DEF_V1_SHA256).toBe(sha9(cj9(gate9.COUNTERS_DEF_V1)));
    expect(gate9.COUNTERS_DEF_V1_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('OPEN_RECORD_V1 holds every row of both tables, pilot families included, and part 2 carries part 1 whole', () => {
    expect(gate9.OPEN_RECORD_KIND).toBe('ccrc-history-w2-open-record');
    expect(gate9.OPEN_RECORD_V1.version).toBe(1);
    const PART1 = ['kind', 'version', 'part', 'drafted_ms', 'supersedes', 'nodes', 'account', 'arm_model', 'writer_model',
      'judge_model', 'step0a', 'settings_mode', 'window_plan', 'k', 'k_unit', 'x', 'metric', 'row_cap', 'bootstrap', 'labeller',
      'answer_protocol_sha256', 'writer_prompt_sha256', 'rubric_id', 'rubric_sha256', 'quiz', 'counters_def', 'active_rule',
      'q18_settings', 'pilot', 'limits', 'pilot_budget', 'halts', 'handcheck', 'freezes', 'order', 'gate_code'];
    const PART2 = ['finalized_ms', 'census', 'registry_drops', 'q18', 'pilot_result', 'spend_budget', 'assignment',
      'assignment_sha256', 'window', 'amendments'];
    expect(Object.keys(gate9.OPEN_RECORD_V1.draft).sort()).toEqual([...PART1].sort());
    expect(Object.keys(gate9.OPEN_RECORD_V1.final).sort()).toEqual([...PART1, ...PART2].sort());
    const spec = gate9.OPEN_RECORD_V1 as unknown as { draft: Record<string, Spec>; final: Record<string, Spec> };
    const sub = (f: Spec | undefined): Record<string, Spec> => f?.fields ?? {};
    expect(sub(spec.draft.pilot).families).toMatchObject({ type: 'array', status: 'measured' });   // W2-D76, D-5781
    expect(Object.keys(sub(sub(spec.draft.pilot).families?.items))).toEqual(['store_id', 'ccrc_id', 'generation']);
    expect(Object.keys(sub(spec.final.quiz))).toEqual([...Object.keys(sub(spec.draft.quiz)), 'sha256', 'n_questions', 'n_families', 'families']);
    expect(sub(spec.draft.active_rule).legacy_excluded).toMatchObject({ status: 'fixed', value: true });
    expect(sub(spec.draft.counters_def).sha256).toMatchObject({ status: 'fixed', value: gate9.COUNTERS_DEF_V1_SHA256 });
    expect(Object.keys(sub(sub(spec.draft.gate_code).files))).toEqual([...gate9.GATE_CODE_FILES]);
  });

  it('a valid chain passes: a draft, a superseding draft with its seed, a final, and an amended final', () => {
    const d1 = draft();
    expect(verdict(d1)).toEqual([]);
    const d2 = set(draft(), 'supersedes', gate9.recordSha256(d1));
    d2.window_plan.planned_days = 21;
    expect(verdict(d2, { draft: null, predecessor: d1, frozen: null })).toEqual([]);
    const f1 = final(d1);
    expect(verdict(f1, chainOf(d1))).toEqual([]);
    const f2 = { ...structuredClone(f1), supersedes: gate9.recordSha256(f1), finalized_ms: T0 + 2 * DAY,
      amendments: [amendment('forced-act', 'node-a', T0 + DAY, { act: 'prune --apply' })] };
    expect(verdict(f2, { draft: d1, predecessor: f1, frozen: FROZEN })).toEqual([]);
    expect(gate9.recordSha256(d1), 'a record\'s sha is its canonical JSON and one newline').toBe(sha9(`${cj9(d1)}\n`));
  });

  it('a missing field is field-missing at its path, pilot families and amendments included; a wrong type is field-malformed', () => {
    const d = draft();
    delete d.account;
    expect(verdict(d)).toEqual([{ path: 'account', word: 'field-missing' }]);
    const p = draft();
    delete p.pilot.families;
    expect(verdict(p)).toEqual([{ path: 'pilot.families', word: 'field-missing' }]);
    const f = final();
    delete f.amendments;
    expect(verdict(f)).toEqual([{ path: 'amendments', word: 'field-missing' }]);
    expect(verdict(set(draft(), 'bootstrap.seed', 'not-a-seed'))).toEqual([{ path: 'bootstrap.seed', word: 'field-malformed' }]);
    expect(verdict(set(draft(), 'step0a[1].budget', 1.5))).toEqual([{ path: 'step0a[1].budget', word: 'field-malformed' }]);
  });

  it('a seed change across a supersede is refused, draft to draft and draft to final', () => {
    const d1 = draft();
    const d2 = set(set(draft(), 'supersedes', gate9.recordSha256(d1)), 'bootstrap.seed', hex('another seed'));
    expect(verdict(d2, { draft: null, predecessor: d1, frozen: null })).toEqual([{ path: 'bootstrap.seed', word: 'seed-changed' }]);
    const other = set(draft(), 'bootstrap.seed', hex('another seed'));
    expect(verdict(set(final(), 'supersedes', gate9.recordSha256(other)), chainOf(other))).toEqual([{ path: 'bootstrap.seed', word: 'seed-changed' }]);
  });

  it.each([
    ['k', 11], ['k_unit', 'assistant-entries'], ['x', { num: 1, den: 20 }], ['metric', 'another metric'], ['row_cap', 401],
    ['bootstrap.B', 1000], ['bootstrap.method', 'bca'], ['bootstrap.substreams', ['quiz-ci']], ['quiz.kinds', ['sha', 'path', 'command', 'error', 'decision']],
    ['labeller.path_min', 9], ['labeller.window', 41], ['labeller.boundaries', 'v2'], ['version', 2], ['kind', 'another-record'],
  ])('a fixed field moved off its module constant is refused: %s', (p, value) => {
    const r = set(draft(), p, value);
    if (p.startsWith('labeller.')) set(r, `pilot.used.${p}`, value);   // the pilot signed under the same labeller
    expect(verdict(r)).toEqual([{ path: p, word: 'constant-mismatch' }]);
  });

  it('legacy_excluded other than true is refused (W2-D20: fixed)', () => {
    expect(verdict(set(draft(), 'active_rule.legacy_excluded', false))).toEqual([{ path: 'active_rule.legacy_excluded', word: 'constant-mismatch' }]);
  });

  it('sha_min_prefix 7 and 40 pass, any other is refused', () => {
    const at = (n: number): Err[] => verdict(set(set(draft(), 'labeller.sha_min_prefix', n), 'pilot.used.sha_min_prefix', n));
    expect(at(7)).toEqual([]);
    expect(at(40)).toEqual([]);
    expect(at(8)).toEqual([{ path: 'labeller.sha_min_prefix', word: 'value-outside-set' }]);
  });

  it('a rubric id outside RUBRIC_IDS is refused, and v1-strict signed with its own sha passes', () => {
    expect(verdict(set(set(draft(), 'rubric_id', 'v1-strict'), 'rubric_sha256', gate9.RUBRIC_SHA256['v1-strict']))).toEqual([]);
    expect(verdict(set(draft(), 'rubric_id', 'v2'))).toEqual([{ path: 'rubric_id', word: 'value-outside-set' }]);
  });

  it('a writer input outside WRITER_INPUTS is refused, and leaf-span signed by both parts passes', () => {
    const at = (w: string): Err[] => verdict(set(set(draft(), 'quiz.writer_input', w), 'pilot.used.writer_input', w));
    expect(at('leaf-span')).toEqual([]);
    expect(at('whole-leaf')).toEqual([{ path: 'quiz.writer_input', word: 'value-outside-set' }]);
  });

  it('a counters_def id other than v1 is refused', () => {
    expect(verdict(set(draft(), 'counters_def.id', 'v2'))).toEqual([{ path: 'counters_def.id', word: 'value-outside-set' }]);
  });

  it.each(['opus', 'claude-opus', 'claude-opus-latest', 'claude-opus-9-1[1m]', 'us.anthropic.claude-opus-9-1', 'claude-opus-9.1'])(
    'an alias-shaped writer model is refused: %s', (id) => {
      expect(verdict(set(set(draft(), 'writer_model', id), 'pilot.writer_model', id))).toEqual([{ path: 'writer_model', word: 'model-alias' }]);
    });

  it('an alias-shaped arm or judge model is refused', () => {
    expect(verdict(set(draft(), 'arm_model', 'claude-arm'))).toEqual([{ path: 'arm_model', word: 'model-alias' }]);
    expect(verdict(set(draft(), 'judge_model', 'claude-opus-latest'))).toEqual([{ path: 'judge_model', word: 'model-alias' }]);
  });

  it('a Fable arm model is refused, in any case', () => {
    expect(verdict(set(draft(), 'arm_model', 'claude-fable-9-1'))).toEqual([{ path: 'arm_model', word: 'model-forbidden' }]);
    expect(verdict(set(draft(), 'arm_model', 'claude-arm-fable-9-1'))).toEqual([{ path: 'arm_model', word: 'model-forbidden' }]);
    expect(verdict(set(draft(), 'arm_model', OPUS)), 'CONTROL: an Opus arm is not Fable').toEqual([]);
  });

  it('a non-Opus judge or writer is refused', () => {
    expect(verdict(set(draft(), 'judge_model', ARM))).toEqual([{ path: 'judge_model', word: 'model-forbidden' }]);
    expect(verdict(set(set(draft(), 'writer_model', ARM), 'pilot.writer_model', ARM))).toEqual([{ path: 'writer_model', word: 'model-forbidden' }]);
  });

  it.each([
    ['answer_protocol_sha256', (): string => sha9(`${gate9.ANSWER_PROTOCOL} `), ['pilot.used.answer_protocol_sha256']],
    ['writer_prompt_sha256', (): string => sha9(`${gate9.WRITER_PROMPT} `), ['pilot.used.writer_prompt_sha256']],
    ['rubric_sha256', (): string => sha9(`${gate9.RUBRICS.v1} `), []],
    ['counters_def.sha256', (): string => sha9(cj9(gate9.COUNTERS_DEF_V1.map((c: { name: string; text: string }, i: number) =>
      (i === 0 ? { name: c.name, text: `${c.text} ` } : c)))), []],
  ])('a signed text changed without a record change is refused: %s', (p, shaOfOld, alsoSigned) => {
    const old = shaOfOld();
    const r = set(draft(), p, old);
    for (const q of alsoSigned) set(r, q, old);   // the pilot signed the same old text
    expect(verdict(r)).toEqual([{ path: p, word: 'signed-text-mismatch' }]);
  });

  it('a step 0a entry or the pilot whose code shas differ from gate_code is code-changed; a release stamp, release-mismatch', () => {
    const s = draft();
    s.step0a[1].code_shas['deploy/history-replay.mjs'] = hex('older replay');
    expect(verdict(s)).toEqual([{ path: 'step0a[1].code_shas', word: 'code-changed' }]);
    expect(verdict(set(draft(), 'step0a[0].release_stamp', 'v0.0.899'))).toEqual([{ path: 'step0a[0].release_stamp', word: 'release-mismatch' }]);
    const p = draft();
    p.pilot.code_shas['ccd/history/lib.mjs'] = hex('older lib');
    expect(verdict(p)).toEqual([{ path: 'pilot.code_shas', word: 'code-changed' }]);
    expect(verdict(set(draft(), 'pilot.release_stamp', 'v0.0.899'))).toEqual([{ path: 'pilot.release_stamp', word: 'release-mismatch' }]);
  });

  it('checkGateCode names each mismatched file, in GATE_CODE_FILES order, and a file absent on either side is code-unmeasured, never code-changed', () => {
    const gc = { release_tag: TAG, files: { ...CODE } };
    expect(gate9.checkGateCode(gc, { ...CODE })).toEqual({ ok: true });
    const files: string[] = [...gate9.GATE_CODE_FILES];
    const two = { ...CODE, [files[3]!]: hex('x'), [files[0]!]: hex('y') };
    expect(gate9.checkGateCode(gc, two)).toEqual({ ok: false, word: 'code-changed', mismatched: [files[0], files[3]] });
    const absent: Record<string, string> = { ...CODE };
    delete absent[files[2]!];
    const gcAbsent = { release_tag: TAG, files: { ...absent } };
    const unmeasured = { ok: false, word: 'code-unmeasured', unmeasured: [files[2]] };
    expect(gate9.checkGateCode(gc, absent), 'absent from the measured shas').toEqual(unmeasured);
    expect(gate9.checkGateCode(gcAbsent, { ...CODE }), 'absent from gate_code').toEqual(unmeasured);
    expect(gate9.checkGateCode(gcAbsent, absent), 'absent on both sides').toEqual(unmeasured);
    expect(gate9.checkGateCode(gc, { ...two, [files[2]!]: undefined } as unknown as Record<string, string>), 'unmeasured is answered before a mismatch')
      .toEqual(unmeasured);
    expect(gate9.GATE_REASONS).toEqual(expect.arrayContaining(['code-changed', 'code-unmeasured']));
  });

  it.each([
    ['pilot.used.labeller', { ...gate9.LABELLER, boundaries: 'v0' }],
    ['pilot.used.sha_min_prefix', 40],
    ['pilot.used.writer_input', 'leaf-span'],
    ['pilot.used.baseline_files', 'v0'],
    ['pilot.used.writer_prompt_sha256', hex('another prompt')],
    ['pilot.used.answer_protocol_sha256', hex('another protocol')],
    ['pilot.writer_model', 'claude-opus-9-2'],
  ])('a pilot section signed under other settings than part 1 is refused: %s', (p, value) => {
    expect(verdict(set(draft(), p, value))).toEqual([{ path: p, word: 'pilot-drift' }]);
  });

  it('quiz.families inconsistent with the frozen file or with n_families is refused', () => {
    expect(verdict(final(), { ...chainOf(draft()), frozen: { families: QUIZ.slice(1), n_questions: N_QUESTIONS } }))
      .toEqual([{ path: 'quiz.families', word: 'quiz-mismatch' }]);
    expect(verdict(final(), { ...chainOf(draft()), frozen: { families: QUIZ, n_questions: N_QUESTIONS - 1 } }))
      .toEqual([{ path: 'quiz.n_questions', word: 'quiz-mismatch' }]);
    expect(verdict(set(final(), 'quiz.n_families', QUIZ.length + 1), chainOf(draft()))).toEqual([{ path: 'quiz.n_families', word: 'quiz-mismatch' }]);
    const dup = withQuiz(final(), [...QUIZ, QUIZ[0]!]);
    dup.r.quiz.n_families = QUIZ.length;
    expect(verdict(dup.r, dup.ctx)).toEqual([{ path: 'quiz.n_families', word: 'quiz-mismatch' }]);
  });

  it('a quiz family whose store and id hold a control-assigned family is refused, at the same or another generation (W2-D77)', () => {
    const same = withQuiz(final(), [...QUIZ, CONTROL_SOLO]);
    expect(verdict(same.r, same.ctx)).toEqual([{ path: `quiz.families[${QUIZ.length}]`, word: 'quiz-holds-control' }]);
    const other = withQuiz(final(), [...QUIZ, SPLIT.treated]);
    expect(verdict(other.r, other.ctx)).toEqual([{ path: `quiz.families[${QUIZ.length}]`, word: 'quiz-holds-control' }]);
    const control = withQuiz(final(), QUIZ.slice(1));
    expect(verdict(control.r, control.ctx), 'CONTROL: a treatment-only id passes').toEqual([]);
  });

  it('a pilot family in the quiz is refused (W2-D76)', () => {
    const o = withQuiz(final(), [...QUIZ, PILOT[0]!]);
    expect(verdict(o.r, o.ctx)).toEqual([{ path: `quiz.families[${QUIZ.length}]`, word: 'pilot-quiz-overlap' }]);
  });

  it('the window is planned_days long, up to one day more: 13 days and 15 days plus 1 ms are refused on a 14-day plan', () => {
    const len = (ms: number): Err[] => verdict(set(final(), 'window.end_ms', T0 + ms), chainOf(draft()));
    expect(len(14 * DAY)).toEqual([]);
    expect(len(15 * DAY)).toEqual([]);
    expect(len(13 * DAY)).toEqual([{ path: 'window', word: 'window-length' }]);
    expect(len(14 * DAY - 1)).toEqual([{ path: 'window', word: 'window-length' }]);
    expect(len(15 * DAY + 1)).toEqual([{ path: 'window', word: 'window-length' }]);
  });

  it('the window is measured against the draft it finalizes', () => {
    const d21 = set(draft(), 'window_plan.planned_days', 21);
    const errs = verdict(final(), chainOf(d21));
    expect(errs).toContainEqual({ path: 'window', word: 'window-length' });
    expect(errs).toContainEqual({ path: 'window_plan', word: 'draft-mismatch' });
  });

  it('a tampered arm is refused, even with its sha recomputed; a wrong sha or order is refused too (W2-D19)', () => {
    const t = final();
    const i = t.assignment.findIndex((a: { arm: string }) => a.arm === 'control');
    t.assignment[i].arm = 'treatment';
    t.assignment_sha256 = gate9.assignmentSha256(t.assignment);
    expect(verdict(t, chainOf(draft()))).toContainEqual({ path: `assignment[${i}].arm`, word: 'assignment-mismatch' });
    expect(verdict(set(final(), 'assignment_sha256', hex('another list')), chainOf(draft()))).toEqual([{ path: 'assignment_sha256', word: 'assignment-mismatch' }]);
    const rev = final();
    rev.assignment.reverse();
    rev.assignment_sha256 = gate9.assignmentSha256(rev.assignment);
    expect(verdict(rev, chainOf(draft()))).toEqual([{ path: 'assignment', word: 'assignment-mismatch' }]);
  });

  it('a final whose part 1 fields differ from its draft is refused', () => {
    const f = set(final(), 'arm_model', 'claude-arm-9-2');
    expect(verdict(f, chainOf(draft()))).toEqual([{ path: 'arm_model', word: 'draft-mismatch' }]);
    expect(verdict(f), 'without its draft and frozen list, the final is refused, never checked on its own')
      .toEqual([{ path: 'ctx.draft', word: 'field-missing' }, { path: 'ctx.frozen', word: 'field-missing' }]);
  });

  it('a predecessor of the other part, or one that is itself invalid, is chain-mismatch', () => {
    expect(verdict(final(), { draft: draft(), predecessor: draft(), frozen: FROZEN })).toEqual([{ path: 'supersedes', word: 'chain-mismatch' }]);
    const bad = set(final(), 'k', 11);
    expect(verdict(set(final(), 'finalized_ms', T0 - DAY / 2), { draft: draft(), predecessor: bad, frozen: FROZEN }))
      .toEqual([{ path: 'supersedes', word: 'chain-mismatch' }]);
  });

  it("a supersedes that is not the superseded record's sha is chain-mismatch: a draft, a first final and an amended final (W2-D25, amended)", () => {
    const d1 = draft();
    const d2 = set(draft(), 'supersedes', hex('not d1'));
    expect(verdict(d2, { draft: null, predecessor: d1, frozen: null })).toEqual([{ path: 'supersedes', word: 'chain-mismatch' }]);
    expect(verdict(set(final(), 'supersedes', hex('not the draft')), chainOf(draft())), 'open --finalize supplies the draft')
      .toEqual([{ path: 'supersedes', word: 'chain-mismatch' }]);
    const f1 = final();
    const f2 = { ...structuredClone(f1), supersedes: gate9.recordSha256(draft()), finalized_ms: T0 - DAY / 2 };
    expect(verdict(f2, { draft: draft(), predecessor: f1, frozen: FROZEN }), 'an amended final names its predecessor, not its draft')
      .toEqual([{ path: 'supersedes', word: 'chain-mismatch' }]);
    expect(verdict(d1, { draft: null, predecessor: d1, frozen: null }), 'a first draft supplied a predecessor')
      .toEqual([{ path: 'supersedes', word: 'chain-mismatch' }]);
    expect(verdict(set(draft(), 'supersedes', gate9.recordSha256(d1))), 'a superseding draft needs its predecessor supplied')
      .toEqual([{ path: 'ctx.predecessor', word: 'field-missing' }]);
  });

  it('a null or missing validation context is refused, never read as a narrower check (W2-D25, amended)', () => {
    expect(bare(draft())).toEqual({ ok: false, errors: [{ path: 'ctx', word: 'field-missing' }] });
    expect(bare(draft(), null)).toEqual({ ok: false, errors: [{ path: 'ctx', word: 'field-missing' }] });
    expect(bare(final(), { draft: draft(), frozen: FROZEN })).toEqual({ ok: false, errors: [{ path: 'ctx.predecessor', word: 'field-missing' }] });
    expect(bare(draft(), { draft: null, predecessor: 'd1', frozen: null })).toEqual({ ok: false, errors: [{ path: 'ctx.predecessor', word: 'field-malformed' }] });
    expect(verdict(final(), { draft: draft(), predecessor: null, frozen: null })).toEqual([{ path: 'ctx.frozen', word: 'field-missing' }]);
    expect(verdict(final(), { draft: null, predecessor: null, frozen: FROZEN })).toEqual([{ path: 'ctx.draft', word: 'field-missing' }]);
    expect(verdict(final(), chainOf(draft())), 'CONTROL: the whole context').toEqual([]);
  });

  it('a field outside the schema is field-unknown at its path: at the top, nested, in a step 0a entry, and a part 2 field in a draft (W2-D25, amended)', () => {
    expect(verdict({ ...draft(), extra: 1 })).toEqual([{ path: 'extra', word: 'field-unknown' }]);
    expect(verdict(set(draft(), 'bootstrap.extra', 1))).toEqual([{ path: 'bootstrap.extra', word: 'field-unknown' }]);
    expect(verdict(set(draft(), 'step0a[1].note', 'x'))).toEqual([{ path: 'step0a[1].note', word: 'field-unknown' }]);
    expect(verdict({ ...draft(), window: { start_ms: T0, end_ms: T0 + 14 * DAY } })).toEqual([{ path: 'window', word: 'field-unknown' }]);
    expect(verdict(set(draft(), 'step0a[0].writer_init.extra', 1)), 'CONTROL: a producer\'s measured object stays open').toEqual([]);
  });

  it("the step 0a entry is W2-4's producer shape: flags_accepted a map of booleans, writer_init, judge_init and box_init non-null (W2-D25, amended; D-5786)", () => {
    expect(verdict(set(draft(), 'step0a[0].writer_init', null))).toEqual([{ path: 'step0a[0].writer_init', word: 'field-missing' }]);
    expect(verdict(set(draft(), 'step0a[1].judge_init', null))).toEqual([{ path: 'step0a[1].judge_init', word: 'field-missing' }]);
    expect(verdict(set(draft(), 'step0a[0].box_init', null)), 'box_init is required, like writer_init and judge_init').toEqual([{ path: 'step0a[0].box_init', word: 'field-missing' }]);
    expect(verdict(set(draft(), 'step0a[0].box_init', { tools: [] })), 'CONTROL: an object').toEqual([]);
    expect(verdict(set(draft(), 'step0a[0].flags_accepted', true))).toEqual([{ path: 'step0a[0].flags_accepted', word: 'field-malformed' }]);
    expect(verdict(set(draft(), 'step0a[0].flags_accepted', { '--verbose': 'yes' })))
      .toEqual([{ path: 'step0a[0].flags_accepted.--verbose', word: 'field-malformed' }]);
    const short = draft();
    delete short.step0a[1].box_init;
    expect(verdict(short)).toEqual([{ path: 'step0a[1].box_init', word: 'field-missing' }]);
  });

  it('a step 0a entry whose store_id names no node of part 1 is value-outside-set (W2-D25, amended)', () => {
    const STORE_C = '00000000-0000-4000-8000-0000000000c3';
    expect(verdict(set(draft(), 'step0a[1].store_id', STORE_C))).toEqual([{ path: 'step0a[1].store_id', word: 'value-outside-set' }]);
    const named = set(draft(), 'step0a[1].store_id', STORE_C);
    named.nodes[1].store_id = STORE_C;   // node B re-pointed to C, its label kept: every node still has exactly one entry
    expect(verdict(named), "CONTROL: the node set is the record's own nodes").toEqual([]);
  });

  it("a step 0a entry whose settings_mode differs from part 1's is value-outside-set (W2-D25, amended)", () => {
    expect(verdict(set(draft(), 'step0a[1].settings_mode', 'fallback'))).toEqual([{ path: 'step0a[1].settings_mode', word: 'value-outside-set' }]);
    expect(verdict(set(draft(), 'settings_mode', 'fallback')), "part 1's settings_mode binds every entry")
      .toEqual([{ path: 'step0a[0].settings_mode', word: 'value-outside-set' }, { path: 'step0a[1].settings_mode', word: 'value-outside-set' }]);
    const d = set(draft(), 'step0a[1].settings_mode', 'fallback');
    expect(verdict(set(final(d), 'pilot_result.settings_mode', 'fallback'), chainOf(d)), "part 2's pilot_result.settings_mode is a later record, not an excuse")
      .toEqual([{ path: 'step0a[1].settings_mode', word: 'value-outside-set' }, { path: 'supersedes', word: 'chain-mismatch' }]);
    const both = set(draft(), 'settings_mode', 'fallback');
    both.step0a.forEach((s: Rec) => { s.settings_mode = 'fallback'; });
    expect(verdict(both), 'CONTROL: part 1 and its step 0a under one settings mode').toEqual([]);
  });

  it("a flag step 0a measured rejected is flag-rejected, whatever part 1's settings mode (W2-D25, amended)", () => {
    expect(verdict(set(draft(), 'step0a[0].flags_accepted', { '--output-format': true, '--verbose': false })))
      .toEqual([{ path: 'step0a[0].flags_accepted.--verbose', word: 'flag-rejected' }]);
    /** Part 1 and every step 0a entry under one settings mode, so the binding holds and only the flags are read. */
    const underMode = (mode: string, flags: Record<string, boolean>): Rec => {
      const r = set(draft(), 'settings_mode', mode);
      r.step0a.forEach((s: Rec) => { s.settings_mode = mode; });
      return set(r, 'step0a[1].flags_accepted', flags);
    };
    expect(verdict(underMode('restricted', { '--restricted': false, '--verbose': true })))
      .toEqual([{ path: 'step0a[1].flags_accepted.--restricted', word: 'flag-rejected' }]);
    expect(verdict(underMode('fallback', { '--restricted': false, '--verbose': true })), 'the fallback excuses no flag, --restricted included')
      .toEqual([{ path: 'step0a[1].flags_accepted.--restricted', word: 'flag-rejected' }]);
    expect(verdict(underMode('fallback', { '--setting-sources': true, '--settings': false })))
      .toEqual([{ path: 'step0a[1].flags_accepted.--settings', word: 'flag-rejected' }]);
    expect(verdict(underMode('fallback', { '--setting-sources': true, '--settings': true })), 'CONTROL: the fallback, every flag accepted').toEqual([]);
  });

  describe('W2-D90: after window start a final may only append amendments', () => {
    // f1 is built per call, never at collection: final() calls this task's recordSha256, which the red run lacks.
    const f1 = (): Rec => final();
    const amend = (over: Rec, at = T0 + 2 * DAY): Rec => ({ ...f1(), supersedes: gate9.recordSha256(f1()), finalized_ms: at, ...over });
    const ctx = (): Ctx => ({ draft: draft(), predecessor: f1(), frozen: FROZEN });
    const forced = amendment('forced-act', 'node-a', T0 + DAY, { act: 'reparse' });

    it('an appended amendment after window start is accepted', () => {
      expect(verdict(amend({ amendments: [forced] }), ctx())).toEqual([]);
    });

    it('any other change after window start is refused, at the boundary instant too', () => {
      const moved = amend({ amendments: [forced], window: { start_ms: T0, end_ms: T0 + 14 * DAY + 3_600_000 } });
      expect(verdict(moved, ctx())).toEqual([{ path: 'window', word: 'post-start-change' }]);
      const atStart = amend({ amendments: [forced], window: { start_ms: T0, end_ms: T0 + 14 * DAY + 3_600_000 } }, T0);
      expect(verdict(atStart, ctx())).toEqual([{ path: 'window', word: 'post-start-change' }]);
      const before = amend({ window: { start_ms: T0 + DAY, end_ms: T0 + 15 * DAY } }, T0 - 1);
      expect(verdict(before, ctx()), 'CONTROL: before window start a final is superseded wholesale').toEqual([]);
    });

    it('a rewritten earlier amendment is refused', () => {
      const f2 = amend({ amendments: [forced] });
      const f3 = { ...structuredClone(f2), supersedes: gate9.recordSha256(f2), finalized_ms: T0 + 3 * DAY,
        amendments: [amendment('forced-act', 'node-a', T0 + DAY, { act: 'prune --apply' }), { ...forced, at_ms: T0 + 2 * DAY }] };
      expect(verdict(f3, { draft: draft(), predecessor: f2, frozen: FROZEN })).toEqual([{ path: 'amendments', word: 'post-start-change' }]);
    });

    it('an amendment kind outside AMENDMENT_KINDS is refused', () => {
      expect(verdict(amend({ amendments: [{ ...forced, kind: 'window-move' }] }), ctx())).toEqual([{ path: 'amendments[0].kind', word: 'amendment-kind' }]);
    });

    it('a version move without a re-pilot sha is refused, and with one it is accepted', () => {
      const move = amendment('version-move', 'node-b', T0 + DAY, { claude_code_version: '9.2.0' });
      expect(verdict(amend({ amendments: [move] }), ctx())).toEqual([{ path: 'amendments[0].detail.repilot_sha256', word: 'version-move-unpiloted' }]);
      const piloted = amendment('version-move', 'node-b', T0 + DAY, { claude_code_version: '9.2.0', repilot_sha256: hex('repilot') });
      expect(verdict(amend({ amendments: [piloted] }), ctx())).toEqual([]);
    });

    it("an amendment whose detail_sha256 is not its detail's sha256 is refused (W2-D25, amended)", () => {
      expect(verdict(amend({ amendments: [{ ...forced, detail_sha256: hex('another detail') }] }), ctx()))
        .toEqual([{ path: 'amendments[0].detail_sha256', word: 'amendment-detail-mismatch' }]);
      expect(verdict(amend({ amendments: [{ ...forced, detail: { act: 'prune --apply' } }] }), ctx()), 'a detail changed under its old sha')
        .toEqual([{ path: 'amendments[0].detail_sha256', word: 'amendment-detail-mismatch' }]);
    });
  });

  it('a malformed final predecessor is chain-mismatch and nothing throws, before and after window start (P-2)', () => {
    const f1 = final();
    const windowless = structuredClone(f1);
    delete windowless.window;
    const under = (pred: Rec, at: number): Err[] => verdict({ ...structuredClone(f1), supersedes: gate9.recordSha256(pred), finalized_ms: at },
      { draft: draft(), predecessor: pred, frozen: FROZEN });
    expect(under(windowless, T0 + 2 * DAY), 'a windowless final, after window start').toEqual([{ path: 'supersedes', word: 'chain-mismatch' }]);
    expect(under(windowless, T0 - DAY / 2), 'a windowless final, before window start').toEqual([{ path: 'supersedes', word: 'chain-mismatch' }]);
    expect(under({ part: 'final' }, T0 + 2 * DAY), 'a bare final').toEqual([{ path: 'supersedes', word: 'chain-mismatch' }]);
    const noAmendments = structuredClone(f1);
    delete noAmendments.amendments;
    expect(under(noAmendments, T0 + 2 * DAY), 'a final without its amendments').toEqual([{ path: 'supersedes', word: 'chain-mismatch' }]);
  });

  it('an assignment that lists one family twice is assignment-mismatch at assignment, never a throw (P-3)', () => {
    const f = final();
    f.assignment.push({ ...f.assignment[0] });
    f.assignment_sha256 = gate9.assignmentSha256(f.assignment);
    expect(verdict(f, chainOf(draft()))).toEqual([{ path: 'assignment', word: 'assignment-mismatch' }]);
  });

  it('a frozen list whose entry is no family is field-malformed at ctx.frozen, never read (P-4)', () => {
    const bad = (item: unknown): Err[] => verdict(final(), { draft: draft(), predecessor: null, frozen: { families: [...QUIZ, item as Ref], n_questions: N_QUESTIONS } });
    const want = [{ path: 'ctx.frozen', word: 'field-malformed' }];
    expect(bad(null)).toEqual(want);
    expect(bad('a-family')).toEqual(want);
    expect(bad([QUIZ[0]])).toEqual(want);
    expect(bad({ store_id: STORE_A, ccrc_id: 'sess-x' })).toEqual(want);
    expect(bad({ store_id: STORE_A, ccrc_id: 'sess-x', generation: 7 })).toEqual(want);
    expect(bad({ store_id: STORE_A, ccrc_id: 'sess-x', generation: gen(9) }), 'CONTROL: a well-formed extra family is a quiz-mismatch, not a malformed context')
      .toEqual([{ path: 'quiz.families', word: 'quiz-mismatch' }]);
  });

  describe('edge pins: the comparisons the cases above leave at their middle', () => {
    it('a quiz family sharing a pilot family\'s store and id at another generation is no overlap (W2-D76 keys by generation)', () => {
      const o = withQuiz(final(), [...QUIZ, { ...PILOT[0]!, generation: gen(101) }]);
      expect(verdict(o.r, o.ctx)).toEqual([]);
    });

    it('a quiz family whose id is a control family\'s on another store holds no control (W2-D77 keys by store and id)', () => {
      const elsewhere = CONTROL_SOLO.store_id === STORE_A ? STORE_B : STORE_A;
      const o = withQuiz(final(), [...QUIZ, { store_id: elsewhere, ccrc_id: CONTROL_SOLO.ccrc_id, generation: gen(301) }]);
      expect(verdict(o.r, o.ctx)).toEqual([]);
    });

    it('a version move whose re-pilot sha is not 64 lowercase hex is unpiloted, and dropping an earlier amendment is post-start-change', () => {
      const forced = amendment('forced-act', 'node-a', T0 + DAY, { act: 'reparse' });
      const f1 = final();
      const f2 = { ...structuredClone(f1), supersedes: gate9.recordSha256(f1), finalized_ms: T0 + 2 * DAY, amendments: [forced] };
      const ctx2: Ctx = { draft: draft(), predecessor: f1, frozen: FROZEN };
      for (const bad of ['not-a-sha', hex('repilot').toUpperCase(), hex('repilot').slice(1), 7]) {
        const move = amendment('version-move', 'node-b', T0 + DAY, { repilot_sha256: bad });
        expect(verdict({ ...structuredClone(f2), amendments: [move] }, ctx2), String(bad))
          .toEqual([{ path: 'amendments[0].detail.repilot_sha256', word: 'version-move-unpiloted' }]);
      }
      const f3 = { ...structuredClone(f2), supersedes: gate9.recordSha256(f2), finalized_ms: T0 + 3 * DAY, amendments: [] };
      expect(verdict(f3, { draft: draft(), predecessor: f2, frozen: FROZEN })).toEqual([{ path: 'amendments', word: 'post-start-change' }]);
    });

    it('a record that is no object, or has no usable part, is refused at once', () => {
      expect(bare(null, CTX0)).toEqual({ ok: false, errors: [{ path: '', word: 'field-malformed' }] });
      expect(bare([], CTX0)).toEqual({ ok: false, errors: [{ path: '', word: 'field-malformed' }] });
      expect(bare({}, CTX0)).toEqual({ ok: false, errors: [{ path: 'part', word: 'field-missing' }] });
      expect(bare({ part: 'other' }, CTX0)).toEqual({ ok: false, errors: [{ path: 'part', word: 'constant-mismatch' }] });
    });

    it('a final\'s frozen list must be an array and a safe-integer count, and a draft ignores the frozen list altogether', () => {
      const frozen = (f: unknown): Err[] => verdict(final(), { draft: draft(), predecessor: null, frozen: f as Ctx['frozen'] });
      const want = [{ path: 'ctx.frozen', word: 'field-malformed' }];
      expect(frozen({ families: QUIZ, n_questions: '64' })).toEqual(want);
      expect(frozen({ families: QUIZ, n_questions: 64.5 })).toEqual(want);
      expect(frozen({ families: 'x', n_questions: N_QUESTIONS })).toEqual(want);
      expect(frozen({})).toEqual(want);
      expect(verdict(draft(), { draft: null, predecessor: null, frozen: {} as Ctx['frozen'] })).toEqual([]);
      expect(verdict(draft(), { draft: null, predecessor: null, frozen: { families: [null], n_questions: 'x' } as unknown as Ctx['frozen'] })).toEqual([]);
    });

    it('a chain of three drafts passes: a predecessor is checked with its own link taken as checked', () => {
      const d1 = draft();
      const d2 = set(draft(), 'supersedes', gate9.recordSha256(d1));
      d2.window_plan.planned_days = 21;
      const d3 = set(draft(), 'supersedes', gate9.recordSha256(d2));
      d3.window_plan.planned_days = 28;
      expect(verdict(d3, { draft: null, predecessor: d2, frozen: null })).toEqual([]);
    });

    it('a link that fails two ways is one chain-mismatch at supersedes (a word is listed once per path)', () => {
      const wrongSha = set(final(), 'supersedes', hex('not the predecessor'));
      expect(verdict(wrongSha, { draft: draft(), predecessor: draft(), frozen: FROZEN })).toEqual([{ path: 'supersedes', word: 'chain-mismatch' }]);
    });
  });

  describe('fix round 1: step 0a per node, no backdating, a positive window, a first final with no amendments', () => {
    const forcedAt = (at: number): Rec => amendment('forced-act', 'node-a', at, { act: 'reparse' });

    it('step 0a is per node: no nodes, a node with no entry and a second entry for one store are each refused (decisions section 4)', () => {
      expect(verdict(set(set(draft(), 'nodes', []), 'step0a', []))).toEqual([{ path: 'nodes', word: 'value-outside-set' }]);
      expect(verdict(set(draft(), 'step0a', []))).toEqual([{ path: 'nodes[0]', word: 'field-missing' }, { path: 'nodes[1]', word: 'field-missing' }]);
      const one = draft();
      one.step0a.pop();
      expect(verdict(one), 'a node with no entry').toEqual([{ path: 'nodes[1]', word: 'field-missing' }]);
      expect(verdict(set(draft(), 'step0a[1].store_id', STORE_A)), 'a second entry for an already-bound store')
        .toEqual([{ path: 'step0a[1].store_id', word: 'value-outside-set' }]);
      const byLabel = set(draft(), 'step0a[1].store_id', '00000000-0000-4000-8000-0000000000c3');
      byLabel.nodes.push({ label: 'node-c', store_id: '00000000-0000-4000-8000-0000000000c3' });
      expect(verdict(byLabel), 'an entry that names node B by label but node C by store covers C only: coverage is by store_id')
        .toEqual([{ path: 'nodes[1]', word: 'field-missing' }]);
      expect(verdict(draft()), 'CONTROL: one entry per node').toEqual([]);
    });

    it('a successor stamped earlier than its valid predecessor is chain-mismatch at its own timestamp; an equal stamp passes', () => {
      const d1 = draft();
      const d2 = set(set(draft(), 'supersedes', gate9.recordSha256(d1)), 'drafted_ms', d1.drafted_ms - 1);
      expect(verdict(d2, { draft: null, predecessor: d1, frozen: null })).toEqual([{ path: 'drafted_ms', word: 'chain-mismatch' }]);
      const d3 = set(draft(), 'supersedes', gate9.recordSha256(d1));
      expect(verdict(d3, { draft: null, predecessor: d1, frozen: null }), 'an equal drafted_ms passes').toEqual([]);
      const f1 = final();
      const f2 = { ...structuredClone(f1), supersedes: gate9.recordSha256(f1), finalized_ms: f1.finalized_ms - 1 };
      expect(verdict(f2, { draft: draft(), predecessor: f1, frozen: FROZEN })).toEqual([{ path: 'finalized_ms', word: 'chain-mismatch' }]);
      const f3 = { ...structuredClone(f1), supersedes: gate9.recordSha256(f1) };
      expect(verdict(f3, { draft: draft(), predecessor: f1, frozen: FROZEN }), 'an equal finalized_ms passes').toEqual([]);
    });

    it('a predecessor that is itself invalid is never compared for its stamp: only supersedes is refused', () => {
      const bad = set(final(), 'k', 11);
      bad.finalized_ms = T0 + DAY;
      const f2 = { ...structuredClone(final()), supersedes: gate9.recordSha256(bad), finalized_ms: T0 - DAY / 2 };
      expect(verdict(f2, { draft: draft(), predecessor: bad, frozen: FROZEN })).toEqual([{ path: 'supersedes', word: 'chain-mismatch' }]);
    });

    it('probe A: backdating a successor below the predecessor\'s window start, to drop its amendments and move the window, is refused', () => {
      const f1 = final();
      const f2 = { ...structuredClone(f1), supersedes: gate9.recordSha256(f1), finalized_ms: T0 + 2 * DAY, amendments: [forcedAt(T0 + DAY)] };
      const moved = { start_ms: T0 + DAY, end_ms: T0 + 15 * DAY };
      const over = (at: number): Rec => ({ ...structuredClone(f2), supersedes: gate9.recordSha256(f2), finalized_ms: at, amendments: [], window: moved });
      const ctx2: Ctx = { draft: draft(), predecessor: f2, frozen: FROZEN };
      expect(verdict(over(T0 - 1), ctx2)).toEqual([{ path: 'finalized_ms', word: 'chain-mismatch' }]);
      expect(verdict(over(T0 + 3 * DAY), ctx2), 'with the timestamp honest, the post-start rule refuses it as before')
        .toEqual([{ path: 'window', word: 'post-start-change' }, { path: 'amendments', word: 'post-start-change' }]);
    });

    it('planned_days below 1 is value-outside-set, and a window that ends at or before its start is window-length', () => {
      for (const days of [0, -1]) {
        expect(verdict(set(draft(), 'window_plan.planned_days', days)), String(days))
          .toEqual([{ path: 'window_plan.planned_days', word: 'value-outside-set' }]);
      }
      expect(verdict(set(draft(), 'window_plan.planned_days', 1)), 'CONTROL: one day is a window').toEqual([]);
      expect(verdict(set(final(), 'window.end_ms', T0), chainOf(draft()))).toEqual([{ path: 'window', word: 'window-length' }]);
      expect(verdict(set(final(), 'window.end_ms', T0 - DAY), chainOf(draft()))).toEqual([{ path: 'window', word: 'window-length' }]);
    });

    it('a first final carries no amendments (they are appended only by open --amend); an amended final carries its predecessor\'s', () => {
      expect(verdict(set(final(), 'amendments', [forcedAt(T0 - DAY)]), chainOf(draft()))).toEqual([{ path: 'amendments', word: 'value-outside-set' }]);
      const f1 = final();
      const f2 = { ...structuredClone(f1), supersedes: gate9.recordSha256(f1), finalized_ms: T0 + 2 * DAY, amendments: [forcedAt(T0 + DAY)] };
      expect(verdict(f2, { draft: draft(), predecessor: f1, frozen: FROZEN }), 'CONTROL: an amended final').toEqual([]);
    });

    it('a draft that fails validation never sets the planned length: the final\'s own window_plan does', () => {
      const short = final();
      short.window.end_ms = T0 + 3 * DAY;
      expect(verdict(short, { draft: set(draft(), 'window_plan.planned_days', {}), predecessor: null, frozen: FROZEN }), 'a non-number gives NaN')
        .toContainEqual({ path: 'window', word: 'window-length' });
      expect(verdict(final(), { draft: set(draft(), 'window_plan.planned_days', '30'), predecessor: null, frozen: FROZEN }), 'a string coerces')
        .not.toContainEqual({ path: 'window', word: 'window-length' });
    });

    it('a ctx.draft that is itself a final is chain-mismatch at supersedes, even when supersedes names it', () => {
      const asDraft = final();
      const f = { ...final(), supersedes: gate9.recordSha256(asDraft) };
      expect(verdict(f, { draft: asDraft, predecessor: null, frozen: FROZEN })).toEqual([{ path: 'supersedes', word: 'chain-mismatch' }]);
    });
  });

  it('every word the validator spells is a GATE_REASONS word, and refuse throws on any other', () => {
    const src = readFileSync(path.join(ROOT, 'deploy', 'history-gate.mjs'), 'utf8');
    const section = src.slice(src.indexOf('// ── W2-3 Task 9:'));
    const words = [...section.matchAll(/refuse\([^;]*?'([a-z0-9-]+)'\)/g)].map((m) => m[1]!);
    expect(words.length).toBeGreaterThan(20);
    for (const w of new Set(words)) expect(gate9.GATE_REASONS, w).toContain(w);
    expect(section).toContain('if (!GATE_REASONS.includes(word)) throw');
  });

  // ── Final fix wave (decisions section 4's defaults, W2-D86, W2-D87, W2-D90, W2-D25, W2-D85) ──
  describe('final fix wave', () => {
    const GATE_TEXT = readFileSync(path.join(ROOT, 'deploy', 'history-gate.mjs'), 'utf8');

    it('final D: every counter text says it is reported per window, by arm and by producer (W2-D87); re-discovery drops changed families from the arm comparison only (W2-D86)', () => {
      const texts = Object.fromEntries(gate9.COUNTERS_DEF_V1.map((c: { name: string; text: string }) => [c.name, c.text]));
      for (const name of ['compliance', 'echo_hits', 'lag', 'card_served', 'card_id_mismatch', 'rediscovery']) {
        expect(texts[name], name).toMatch(/per window, by arm and by producer/);
        expect(texts[name], name).toMatch(/the window's boundary producer/);
      }
      expect(texts.rediscovery).toContain('Changed families are dropped from the arm comparison only.');
      // Every sentence the text had before the wave is kept.
      expect(texts.rediscovery).toContain('Reported as an indicator and a distinct-path count. Bash reads are not counted.');
      expect(texts.compliance).toContain('it is W3\'s baseline and a check that nothing was steered.');
    });

    it('final D: COUNTERS_DEF_V1_SHA256 is a 64-hex literal in the module, and equals the sha of the text it freezes', () => {
      expect(GATE_TEXT).toMatch(/export const COUNTERS_DEF_V1_SHA256 = '[0-9a-f]{64}';/);
      expect(gate9.COUNTERS_DEF_V1_SHA256).toBe(sha9(cj9(gate9.COUNTERS_DEF_V1)));
    });

    it('final D: the sha is not recomputed at load, so a one-word edit to a signed text moves the freeze (mutant: the literal left alone)', () => {
      // A copy of the module with one word of the first text changed and the literal untouched: the equality above is the guard,
      // shown here by recomputing over the edited text.
      const edited = gate9.COUNTERS_DEF_V1.map((c: { name: string; text: string }, i: number) =>
        (i === 0 ? { name: c.name, text: c.text.replace('Per window', 'Per windows') } : c));
      expect(sha9(cj9(edited))).not.toBe(gate9.COUNTERS_DEF_V1_SHA256);
      expect(GATE_TEXT).not.toMatch(/COUNTERS_DEF_V1_SHA256 = sha256Hex/);
    });

    it('final A: a halts value decideGate would throw on is value-outside-set at its key (W2-D90 forbids repairing it after the window)', () => {
      const at = (key: string, v: number): Err[] => verdict(set(draft(), `halts.${key}`, v));
      for (const key of ['run_failed_max', 'absent_rate_max']) {
        for (const bad of [1, 1.5, -0.1, 0.0500001, 1e-7]) {
          expect(at(key, bad), `${key} = ${bad}`).toEqual([{ path: `halts.${key}`, word: 'value-outside-set' }]);
        }
        for (const ok of [0, 0.05, 0.999999, 0.000001]) expect(at(key, ok), `CONTROL ${key} = ${ok}`).toEqual([]);
      }
      for (const bad of [7, 1.5, -0.1, 0.1234567]) {
        expect(at('handcheck_agreement_min', bad), `agreement = ${bad}`).toEqual([{ path: 'halts.handcheck_agreement_min', word: 'value-outside-set' }]);
      }
      for (const ok of [0, 0.8, 1, 0.123456]) expect(at('handcheck_agreement_min', ok), `CONTROL agreement = ${ok}`).toEqual([]);
      expect(verdict(draft()), 'CONTROL: the defaults').toEqual([]);
    });

    it('final A: a halts value that is not a number is still field-malformed (the shape answers first, nothing throws)', () => {
      expect(verdict(set(draft(), 'halts.run_failed_max', '0.05'))).toEqual([{ path: 'halts.run_failed_max', word: 'field-malformed' }]);
    });

    it('final B: a second node with an already-seen store_id is value-outside-set at nodes[i].store_id', () => {
      const two = set(draft(), 'nodes', [{ label: 'node-a', store_id: STORE_A }, { label: 'node-a2', store_id: STORE_A }]);
      two.step0a = [two.step0a[0]];   // one entry, for the one store: before the fix it covered both nodes
      expect(verdict(two)).toEqual([{ path: 'nodes[1].store_id', word: 'value-outside-set' }]);
      const three = set(draft(), 'nodes', [{ label: 'node-a', store_id: STORE_A }, { label: 'node-b', store_id: STORE_B }, { label: 'node-b2', store_id: STORE_B }]);
      expect(verdict(three), 'the later of three, by its own index').toEqual([{ path: 'nodes[2].store_id', word: 'value-outside-set' }]);
      expect(verdict(draft()), 'CONTROL: distinct stores').toEqual([]);
    });

    it('final F: a negative active_rule.lookback_ms is value-outside-set; zero passes; a fraction stays field-malformed', () => {
      expect(verdict(set(draft(), 'active_rule.lookback_ms', -1))).toEqual([{ path: 'active_rule.lookback_ms', word: 'value-outside-set' }]);
      expect(verdict(set(draft(), 'active_rule.lookback_ms', Number.MIN_SAFE_INTEGER))).toEqual([{ path: 'active_rule.lookback_ms', word: 'value-outside-set' }]);
      expect(verdict(set(draft(), 'active_rule.lookback_ms', 0)), 'CONTROL: zero is a look-back activeFamilies reads').toEqual([]);
      expect(verdict(set(draft(), 'active_rule.lookback_ms', 1.5))).toEqual([{ path: 'active_rule.lookback_ms', word: 'field-malformed' }]);
      const census = { as_of_ms: T0, families: [] } as never;
      expect(() => gate9.activeFamilies(STORE_A, census, { lookbackMs: -1 }), 'the value the validator now refuses is one activeFamilies throws on').toThrow();
      expect(() => gate9.activeFamilies(STORE_A, census, { lookbackMs: 0 }), 'and zero is one it reads').not.toThrow();
    });

    it('final G: a final may supersede a pre-window final under a re-frozen quiz, and the successor\'s own quiz is still checked against the new frozen list', () => {
      const d = draft();
      const f1 = final(d);
      const fewer = QUIZ.slice(1);
      const refrozen = { families: fewer.map(refOf), n_questions: N_QUESTIONS + 6 };
      const successor = (over: Rec = {}): Rec => {
        const f: Rec = { ...structuredClone(f1), supersedes: gate9.recordSha256(f1), ...over };
        f.quiz = { ...f.quiz, families: fewer.map(refOf), n_families: fewer.length, n_questions: refrozen.n_questions };
        return f;
      };
      const ctxFor = (frozen: Ctx['frozen']): Ctx => ({ draft: d, predecessor: f1, frozen });
      expect(verdict(successor(), ctxFor(refrozen)), 'before window start, a re-frozen quiz supersedes wholesale (W2-D90)').toEqual([]);
      expect(verdict(successor(), ctxFor(FROZEN)), 'CONTROL: the successor\'s own quiz is checked against ctx.frozen, so the old list refuses it')
        .toEqual([{ path: 'quiz.families', word: 'quiz-mismatch' }, { path: 'quiz.n_questions', word: 'quiz-mismatch' }]);
      // After window start the rule is unchanged: only amendments may be appended, so the quiz is post-start-change.
      expect(verdict(successor({ finalized_ms: T0 + DAY }), ctxFor(refrozen))).toEqual([{ path: 'quiz', word: 'post-start-change' }]);
    });

    it('final G: a predecessor final with a malformed quiz is chain-mismatch and nothing throws', () => {
      const d = draft();
      const f1 = final(d);
      for (const [name, quiz] of [['no quiz', undefined], ['a bare quiz', {}], ['families not an array', { ...f1.quiz, families: 'x' }],
        ['n_questions a string', { ...f1.quiz, n_questions: '64' }], ['a non-family entry', { ...f1.quiz, families: [null] }]] as const) {
        const pred = structuredClone(f1);
        if (quiz === undefined) delete pred.quiz; else pred.quiz = quiz;
        const f2 = { ...structuredClone(f1), supersedes: gate9.recordSha256(pred) };
        expect(verdict(f2, { draft: d, predecessor: pred, frozen: FROZEN }), name).toEqual([{ path: 'supersedes', word: 'chain-mismatch' }]);
      }
    });

    it('ruling box_init: a null box_init with a false box-only flag is field-missing at box_init alone, never flag-rejected (D-5786)', () => {
      const r = set(draft(), 'step0a[0].box_init', null);
      r.step0a[0].flags_accepted = { '--output-format': true, '--box-only-flag': false };
      expect(verdict(r)).toEqual([{ path: 'step0a[0].box_init', word: 'field-missing' }]);
      const withInit = set(draft(), 'step0a[0].flags_accepted', { '--output-format': true, '--box-only-flag': false });
      expect(verdict(withInit), 'CONTROL: with a box_init the false flag is flag-rejected as before')
        .toEqual([{ path: 'step0a[0].flags_accepted.--box-only-flag', word: 'flag-rejected' }]);
    });

    it('final H: a handcheck value other than the one handcheckSample implements is constant-mismatch at its path', () => {
      for (const [key, bad] of [['share', 0.25], ['of', 'all'], ['per_arm', false], ['judge_failed', 'sampled']] as const) {
        expect(verdict(set(draft(), `handcheck.${key}`, bad)), key).toEqual([{ path: `handcheck.${key}`, word: 'constant-mismatch' }]);
      }
      expect(verdict(set(draft(), 'handcheck.share', 0.2)), 'CONTROL: one fifth').toEqual([]);
    });

    it('final H: a q18_settings.procedure other than the one q18Power implements is constant-mismatch', () => {
      expect(verdict(set(draft(), 'q18_settings.procedure', 'grid-scan'))).toEqual([{ path: 'q18_settings.procedure', word: 'constant-mismatch' }]);
      expect(verdict(set(draft(), 'q18_settings.procedure', gate9.Q18_DEFAULTS.procedure)), 'CONTROL').toEqual([]);
    });
  });
});
