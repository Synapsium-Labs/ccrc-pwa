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
      'w1b_lag_p95_ms', 'w1c_duplicate_entries', 'w1e', 'w1f_grep_p95_ms', 'w2']);
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
   *  or an import after a `;` on the same line, cannot hide one. The gate's own text never spells a quote straight
   *  after the word from, except in its one import line, so a hit that is no import is a red too. */
  const specifiers = (text: string): string[] => [
    ...[...text.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!),
    ...[...text.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!),
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
