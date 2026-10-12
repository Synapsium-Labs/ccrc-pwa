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
import { makeHistoryBox, runSweep, spoolLine, plantSession, openStoreRO, scrubbedEnv } from './historyHelpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'deploy', 'measure-history.py');
/** Isolated (-I: no user site, no PYTHON* env, no script dir on sys.path) AND bytecode-free (-B): -I ignores PYTHONDONTWRITEBYTECODE, so only -B keeps a loaded instrument from writing deploy/__pycache__ (review 316 F25). */
const PY_ISOLATED = ['-I', '-B'] as const;

interface Window { boundary_uuid: string; boundary_ts_ms: number; end_ts_ms: number | null; assistant_entries: number; calls: number | null }
interface W2 {
  windows: number; with_call: number; calls: number; assistant_entries: number; per_turn_rate: number | null; unmeasured: number;
  by_family: Array<{ ccrc_id: string; generation: string; windows: Window[] }>;
}
interface Report {
  store_id: string | null; user_version: number; counters: Record<string, number>; w1b_lag_p95_ms: number | null;
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
    expect(rep.user_version).toBe(1);
    expect(rep.counters).toEqual({ raw_only: 3, 'variants_sanitize:anthropic': 2, 'variants_sanitize:other': 1 });
    expect(rep.w1b_lag_p95_ms).toBe(20_000);   // 21 lags 1000..21000 with files_behind 0 in the week: rank ceil(0.95 * 21) = 20
    expect(rep.w1c_duplicate_entries).toBe(0);
    expect(rep.w1f_grep_p95_ms).toBe(2000);    // 21 greps 100..2100 with no arm: rank 20
    expect(rep.w2).toBeNull();
  });

  it('the W2 window statistic: two windows, both with a call, three calls over fourteen assistant entries', () => {
    const f = plantedStore();
    const rep = report(['--db', f.db, '--now', String(NOW), '--families', f.families, '--window-start', '1500', '--window-end', '6000']);
    // B1: the first 10 turns after its summary end at 3900; k1 (2500) and k2 (3900, inclusive) count; k3, k4 are
    //     outside, k5 is a replay arm's. B2: 4 turns after its summary (5100, 5200, 5300, 7100), fewer than 10, so
    //     it ends at the copy's last row (7100); k6, the merged '' family's, counts. B3 (7000) is past
    //     --window-end, the subagent boundary is not a main one, and demo-b is listed under another store.
    expect(rep.w2).toMatchObject({ windows: 2, with_call: 2, calls: 3, assistant_entries: 14, unmeasured: 0 });
    expect(rep.w2!.per_turn_rate).toBeCloseTo(3 / 14, 12);
    expect(rep.w2!.by_family).toEqual([{ ccrc_id: 'demo-a', generation: G1, windows: [
      { boundary_uuid: f.b1, boundary_ts_ms: 2000, end_ts_ms: 3900, assistant_entries: 10, calls: 2 },
      { boundary_uuid: f.b2, boundary_ts_ms: 5000, end_ts_ms: 7100, assistant_entries: 4, calls: 1 },
    ] }]);
  });
});

describe('measure-history.py: read-only, and a missing input is refused, never created', () => {
  it('leaves the store\'s bytes as it found them', () => {
    const f = plantedStore();
    const sha = (): string => createHash('sha256').update(readFileSync(f.db)).digest('hex');
    const before = sha();
    report(['--db', f.db, '--now', String(NOW), '--families', f.families, '--window-start', '0', '--window-end', '9000']);
    expect(sha()).toBe(before);
  });

  it('a missing store exits 2 and creates nothing; --families without its window exits 2', () => {
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
