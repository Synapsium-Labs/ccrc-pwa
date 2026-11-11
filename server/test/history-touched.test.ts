// server/test/history-touched.test.ts
// `ccrc history touched` (W4 addendum P8, P9, P13, P14). Three layers: the pure deciders in `ccd/history/lib.mjs`, imported directly
// like history-lib.test.ts (the one database there is an in-memory node:sqlite table that runs the spec's file select for Review
// Focus 4); the verb itself, spawned against a fixture HOME with its own store (Task 4B, and the cap cases of Task 4C); and a bench
// skipped unless HISTORY_BENCH=1. Every store is a fixture; nothing here touches a live HOME or store.
import { describe, it, expect, beforeAll, beforeEach, onTestFinished } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { makeHistoryBox, runSweep, runCli, withPane, seedFamily, type HistoryBox } from './historyHelpers.js';
import { userRow, assistantRow, boundaryRow, summaryRow, type Row } from './historyFixtures.js';
import { LANE_ROSTER } from './historyAgentFixtures.js';
import { mkTmp } from './tmpHelpers.js';
import { GRAPH_MAX_BYTES, loadGraph } from '../../ccd/compact-card.mjs';
import * as storeLib from '../../ccd/history/store.mjs';
import * as recallLib from '../../ccd/history/recall.mjs';
import {
  READ_VERBS, READ_OPTIONS, VERB_TABLES, parseReadArgs,
  touchedQuery, likeEscape, splitStoredRef, normaliseRefPath, symbolMatches, matchRef, rankTouched, touchedRows,
  makePairIndex, TOUCHED_CANDIDATE_MAX, TOUCHED_LIMIT_DEFAULT, TOUCHED_DISCLOSURE, TOUCHED_CAPPED_NOTE, TOUCHED_ORDERED_CAP, TOUCHED_ORDERED_CAPPED_NOTE, TOUCHED_REFS_CUT_NOTE,
} from '../../ccd/history/lib.mjs';

type Graph = { index: { files: Set<string>; byBase: Map<string, string[]> } };

/** compact-card.mjs's `fileIndex`, restated for the test (lib imports nothing from it). */
function graphOf(files: string[]): Graph {
  const set = new Set(files);
  const byBase = new Map<string, string[]>();
  for (const f of set) {
    const b = f.slice(f.lastIndexOf('/') + 1);
    byBase.set(b, [...(byBase.get(b) ?? []), f]);
  }
  return { index: { files: set, byBase } };
}

type Stored = { nodeId: string; kind: string; value: string; origin: string; root?: string | null };

/** The matching half of the verb, as Task 4B will compose it: split, normalise, match, one row per node and file. */
function run(stored: Stored[], query: string, roots: string[], graph: Graph | null) {
  const q = touchedQuery(query);
  if (q === null || q.kind === 'symbol') throw new Error('a file query');
  const file = normaliseRefPath(q.file, null, roots);
  const matches = [];
  for (const s of stored) {
    const sp = splitStoredRef(s.kind, s.value);
    if (q.kind === 'path-symbol' && !symbolMatches(sp, q.symbol)) continue;
    const norm = normaliseRefPath(sp.path, s.root ?? null, roots);
    const m = matchRef(norm, file.path, graph);
    if (m !== null) matches.push({ nodeId: s.nodeId, file: file.path, match: m, ref: { kind: s.kind, value: s.value, origin: s.origin, line: sp.line, symbol: sp.symbol } });
  }
  return touchedRows(matches);
}

/** Section 3.5 step 1's file select, verbatim: the raw values it returns (the select itself, before any matching). */
function selectedValues(db: DatabaseSync, file: string): string[] {
  const base = file.slice(file.lastIndexOf('/') + 1);
  const rows = db.prepare(
    "SELECT node_id, kind, value, origin FROM node_refs WHERE kind IN ('path','path:symbol','test') AND value LIKE ? ESCAPE '\\'",
  ).all(`%${likeEscape(base)}%`) as { node_id: string; kind: string; value: string; origin: string }[];
  return rows.map((r) => r.value);
}

describe('touched deciders', () => {
  it('the verb\'s values are the spec\'s, verbatim', () => {
    expect(TOUCHED_CANDIDATE_MAX).toBe(10000);
    expect(TOUCHED_LIMIT_DEFAULT).toBe(20);
    expect(TOUCHED_DISCLOSURE).toBe('refs keep one origin each (the first seen) and at most 40 per node; a node may have touched this file without listing it.');
    expect(TOUCHED_CAPPED_NOTE).toBe('(candidates capped at 10000: the ranking covers those only, and newer matches may be missing)');
  });

  it.each([
    ['ccd/x.mjs', { kind: 'path', file: 'ccd/x.mjs' }],
    ['./ccd/x.mjs', { kind: 'path', file: 'ccd/x.mjs' }],
    ['ccd/x.mjs' + ':10-20', { kind: 'path', file: 'ccd/x.mjs' }],
    ['x.mjs' + ':7', { kind: 'path', file: 'x.mjs' }],
    ['server/test/foo.test.ts', { kind: 'path', file: 'server/test/foo.test.ts' }],
    ['ccd/x.mjs:fooBar', { kind: 'path-symbol', file: 'ccd/x.mjs', symbol: 'fooBar' }],
    ['fooBar', { kind: 'symbol', symbol: 'fooBar' }],
    ['_a$b', { kind: 'symbol', symbol: '_a$b' }],
    ['deadbeef', { kind: 'symbol', symbol: 'deadbeef' }],
    ['D-8188', null],
    ['', null],
    ['a b', null],
    ['9lives', null],
  ] as const)('touchedQuery reads %s', (arg, want) => {
    expect(touchedQuery(arg)).toEqual(want);
  });

  it('TC3 ranking: newest first, a tie by node id, a missing time last, origin never ranked', () => {
    const ref = (origin: string) => [{ kind: 'path', value: 'a.ts', origin }];
    const rows = [
      { nodeId: 'n-b', latestMs: 200, refs: ref('tool_use') },
      { nodeId: 'n-z', latestMs: 300, refs: ref('model') },
      { nodeId: 'n-a', latestMs: 200, refs: ref('model') },
      { nodeId: 'n-x', latestMs: 100, refs: ref('tool_use') },
      { nodeId: 'n-n', latestMs: null, refs: ref('tool_use') },
    ];
    expect(rankTouched(rows).map((r) => r.nodeId)).toEqual(['n-z', 'n-a', 'n-b', 'n-x', 'n-n']);
    expect(rows[0].nodeId).toBe('n-b');
  });

  it('TC10 absolute stored ref under the root matches exact', () => {
    const rows = run([{ nodeId: 'n1', kind: 'path', value: '/root/ccd/x.mjs', origin: 'tool_use' }], 'ccd/x.mjs', ['/root'], null);
    expect(rows).toHaveLength(1);
    expect(rows[0].match).toBe('exact');
    expect(normaliseRefPath('/root/ccd/x.mjs', null, ['/root'])).toEqual({ path: 'ccd/x.mjs', outside: false });
    expect(normaliseRefPath('/root/ccd/x.mjs', '/root', [])).toEqual({ path: 'ccd/x.mjs', outside: false });
    expect(normaliseRefPath('/rootless/x.mjs', '/root', ['/root'])).toEqual({ path: '/rootless/x.mjs', outside: true });
  });

  it('TC11 outside root matches only that absolute query', () => {
    const stored = [{ nodeId: 'n1', kind: 'path', value: '/elsewhere/x.mjs', origin: 'tool_use' }];
    const hit = run(stored, '/elsewhere/x.mjs', ['/root'], null);
    expect(hit.map((r) => r.match)).toEqual(['outside']);
    expect(run(stored, 'x.mjs', ['/root'], graphOf(['x.mjs']))).toEqual([]);
    expect(run(stored, 'src/elsewhere/x.mjs', ['/root'], null)).toEqual([]);
    expect(matchRef({ path: '/elsewhere/x.mjs', outside: true }, 'elsewhere/x.mjs', graphOf(['elsewhere/x.mjs']))).toBeNull();
  });

  it('an absolute query is matched by no relative ref, with or without a graph', () => {
    const rel = { path: 'x/y.mjs', outside: false };
    expect(matchRef(rel, '/elsewhere/x/y.mjs', null)).toBeNull();
    expect(matchRef(rel, '/elsewhere/x/y.mjs', graphOf(['/elsewhere/x/y.mjs']))).toBeNull();
    expect(matchRef({ path: '/elsewhere/x/y.mjs', outside: true }, '/elsewhere/x/y.mjs', null)).toBe('outside');
  });

  it('TC12 line suffix is kept as the line, not in the path', () => {
    expect(splitStoredRef('path', 'ccd/x.mjs' + ':10-20')).toEqual({ path: 'ccd/x.mjs', line: '10-20', symbol: null });
    expect(splitStoredRef('path', 'ccd/x.mjs' + ':7')).toEqual({ path: 'ccd/x.mjs', line: '7', symbol: null });
    const rows = run([{ nodeId: 'n1', kind: 'path', value: 'ccd/x.mjs' + ':10-20', origin: 'tool_use' }], 'ccd/x.mjs', [], null);
    expect(rows).toHaveLength(1);
    expect(rows[0].refs[0].line).toBe('10-20');
  });

  it('TC13 a symbol ref matches the file query and the symbol query, case-sensitively', () => {
    const stored = [
      { nodeId: 'n1', kind: 'path:symbol', value: 'ccd/x.mjs:fooBar', origin: 'model' },
      { nodeId: 'n2', kind: 'path:symbol', value: 'ccd/x.mjs:FooBar', origin: 'model' },
    ];
    expect(splitStoredRef('path:symbol', 'ccd/x.mjs:fooBar')).toEqual({ path: 'ccd/x.mjs', line: null, symbol: 'fooBar' });
    expect(run(stored, 'ccd/x.mjs', [], null).map((r) => r.nodeId)).toEqual(['n1', 'n2']);
    // the symbol query: the select is a case-insensitive prefilter, symbolMatches decides
    const bySymbol = stored.filter((s) => symbolMatches(splitStoredRef(s.kind, s.value), 'fooBar'));
    expect(bySymbol.map((s) => s.nodeId)).toEqual(['n1']);
    // a path-symbol query names the file and the symbol
    expect(run(stored, 'ccd/x.mjs:fooBar', [], null).map((r) => r.nodeId)).toEqual(['n1']);
    expect(symbolMatches({ symbol: null }, 'fooBar')).toBe(false);
  });

  it('TC14 a basename ref is no match when two graph files share it, a suffix when one does', () => {
    const stored = [{ nodeId: 'n1', kind: 'path', value: 'x.mjs', origin: 'tool_use' }];
    const two = graphOf(['ccd/x.mjs', 'server/x.mjs']);
    expect(run(stored, 'ccd/x.mjs', [], two)).toEqual([]);
    expect(run(stored, 'server/x.mjs', [], two)).toEqual([]);
    const one = graphOf(['ccd/x.mjs', 'server/y.mjs']);
    expect(run(stored, 'ccd/x.mjs', [], one).map((r) => r.match)).toEqual(['suffix']);
    // a graph that lacks the file loses the suffix match (the graph's unique answer decides, D-8189)
    expect(run(stored, 'ccd/x.mjs', [], graphOf(['server/y.mjs']))).toEqual([]);
    // a boundary that is not a segment boundary never matches
    expect(matchRef({ path: 'x.mjs', outside: false }, 'ccd/ax.mjs', graphOf(['ccd/ax.mjs']))).toBeNull();
  });

  it('D-8189 with no graph a bare basename never matches; two segments do; a `..` ref never does', () => {
    const rel = (p: string) => matchRef({ path: p, outside: false }, 'src/ccd/x.mjs', null);
    expect(rel('ccd/x.mjs')).toBe('suffix');
    expect(rel('x.mjs')).toBeNull();
    expect(rel('../x.mjs')).toBeNull();
    expect(rel('../ccd/x.mjs')).toBeNull();
    expect(rel('src/ccd/x.mjs')).toBe('exact');
    const stored = (value: string) => [{ nodeId: 'n1', kind: 'path', value, origin: 'tool_use' }];
    expect(run(stored('ccd/x.mjs'), 'src/ccd/x.mjs', [], null).map((r) => r.match)).toEqual(['suffix']);
    expect(run(stored('x.mjs'), 'ccd/x.mjs', [], null)).toEqual([]);
    expect(run(stored('../x.mjs'), 'src/x.mjs', [], null)).toEqual([]);
  });

  it('TC19 one file under two kinds is one row listing each ref', () => {
    const f = 'server/test/foo.test.ts';
    const stored = [
      { nodeId: 'A', kind: 'test', value: f, origin: 'tool_use' },
      { nodeId: 'B', kind: 'path', value: `${f}:12`, origin: 'tool_use' },
      { nodeId: 'C', kind: 'test', value: f, origin: 'tool_use' },
      { nodeId: 'C', kind: 'path', value: `${f}:3-4`, origin: 'model' },
    ];
    const rows = run(stored, f, [], null);
    expect(rows.map((r) => [r.nodeId, r.refs.length])).toEqual([['A', 1], ['B', 1], ['C', 2]]);
    expect(rows[1].refs[0].line).toBe('12');
    expect(rows[2].refs.map((r) => r.kind)).toEqual(['test', 'path']);
    expect(rows[2].refs[1].line).toBe('3-4');
  });

  it('touchedRows keeps the strongest match and the node fields of a row', () => {
    const rows = touchedRows([
      { nodeId: 'n', file: 'a.ts', match: 'suffix' as const, ref: 'r1', latestMs: 5 },
      { nodeId: 'n', file: 'a.ts', match: 'exact' as const, ref: 'r2', latestMs: 5 },
      { nodeId: 'n', file: 'b.ts', match: 'suffix' as const, ref: 'r3', latestMs: 5 },
    ]);
    expect(rows).toEqual([
      { nodeId: 'n', file: 'a.ts', match: 'exact', refs: ['r1', 'r2'], latestMs: 5 },
      { nodeId: 'n', file: 'b.ts', match: 'suffix', refs: ['r3'], latestMs: 5 },
    ]);
  });

  it('a query\'s _ matches only itself (Review Focus 4)', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE node_refs (node_id TEXT, kind TEXT, value TEXT, origin TEXT)');
    const ins = db.prepare('INSERT INTO node_refs VALUES (?, ?, ?, ?)');
    ins.run('n1', 'path', 'src/foo_bar.ts', 'tool_use');
    ins.run('n2', 'path', 'src/fooXbar.ts', 'tool_use');
    expect(selectedValues(db, 'src/foo_bar.ts')).toEqual(['src/foo_bar.ts']);   // a stored src/fooXbar.ts is not a candidate
    expect(likeEscape('foo_bar.ts')).toBe('foo\\_bar.ts');
    expect(likeEscape('a%b\\c')).toBe('a\\%b\\\\c');
    db.close();
  });
});


// ── Task 4B: the verb itself, run as a session runs it (W4 addendum P8, P14) ─────────────────────────────────────────
// One fixture store, built once: a family with one confirmed epoch whose launch directory is a temp directory (the verb's
// root), into which each case plants its own graphify-out/graph.json. Nodes and refs are written straight into the derived
// tables through a writer handle that is closed before the CLI runs; every case names its own files and symbols, so a case's
// answer is its own. The CLI runs against the fixture HOME only.
describe.skipIf(process.platform === 'darwin')('touched, spawned: the read verb (Task 4B)', () => {
  const ID = 'lane-a-demo';
  const PROJECT = 'demo';
  const TA = 'a1a1a1a1-1111-4111-8111-111111111111';
  const G1 = '0189abcd-1234-4678-9abc-0123456789ab';
  const T0 = Date.UTC(2026, 9, 1, 10, 0, 0);
  const HEAVY = 240_000;
  type CliRun = ReturnType<typeof runCli>;

  let box: HistoryBox;
  let root = '';
  let dbFile = '';
  let ids: { session_pk: number; seq: number; tpk: number };

  const rid = (n: number): string => `${TA.slice(0, 8)}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
  const iso = (k: number): string => new Date(T0 + k * 1000).toISOString();
  function turns(cwd: string): Row[] {
    const rows: Row[] = [];
    for (let i = 1; i <= 2; i += 1) {
      rows.push(userRow({ uuid: rid(2 * i - 1), ts: iso(2 * i - 1), sessionId: TA, cwd, text: `fixture question ${i}` }));
      rows.push(assistantRow({ uuid: rid(2 * i), ts: iso(2 * i), sessionId: TA, cwd, text: `Fixture answer ${i}.`, requestId: `req_${i}`, msgId: `msg_${i}` }));
    }
    // Two manual compactions, so the store holds two boundaries (the as-of cut case plants nodes on them).
    for (let c = 1; c <= 2; c += 1) {
      const base = { sessionId: TA, cwd };
      const [u, a, x, b, sm] = [1, 2, 3, 4, 5].map((i) => rid(100 * c + i));
      rows.push(userRow({ ...base, uuid: u!, ts: iso(50 * c), text: `fixture request ${c}` }));
      rows.push(assistantRow({ ...base, uuid: a!, ts: iso(50 * c + 1), text: `Fixture answer ${c}.`, requestId: `req_c_${c}`, msgId: `msg_c_${c}` }));
      rows.push(userRow({ ...base, uuid: x!, ts: iso(50 * c + 2), text: `fixture follow-up ${c}` }));
      rows.push(boundaryRow({ ...base, uuid: b!, ts: iso(50 * c + 3), trigger: 'manual', headUuid: x!, anchorUuid: sm!, tailUuid: x!, allUuids: [x!] }));
      rows.push(summaryRow({ ...base, uuid: sm!, ts: iso(50 * c + 4), text: ['This session is being continued from a previous conversation. The summary below covers the earlier portion.',
        '<summary>', '1. Primary Request and Intent:', `   Fixture request ${c}.`, '8. Current Work:', `   Wrote part ${c}.`, '9. Optional Next Step:', '   Continue.', '</summary>'].join('\n') }));
    }
    return rows;
  }
  function withDb<T>(fn: (db: DatabaseSync) => T): T {
    const db = new DatabaseSync(dbFile);
    try { return fn(db); } finally { db.close(); }
  }
  let nodeSeq = 0;
  /** A native leaf of the family's epoch with its refs; `agentTranscript` puts it on a subagent's transcript. */
  function plant(id: string, o: { latest?: number; gist?: string | null; refs?: Array<[string, string, string?]>; tpk?: number; boundary?: number; epoch?: number } = {}): string {
    nodeSeq += 1;
    const latest = o.latest ?? T0 + nodeSeq * 1000;
    withDb((db) => {
      db.prepare(`INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, gist, topics,
        summary_blob_id, boundary_entry_id, span_start_uuid, earliest_ms, latest_ms, src_chars, desc_count, desc_chars,
        directive_flag, capped, parser_version, created_ms)
        VALUES (?, ?, ?, ?, 'native_leaf', 0, 'fixture', ?, NULL, NULL, ?, NULL, ?, ?, 0, 0, 0, 0, 0, 1, ?)`)
        .run(id, ids.session_pk, o.epoch ?? ids.seq, o.tpk ?? ids.tpk, o.gist === undefined ? `Gist of ${id}. Second sentence.` : o.gist, o.boundary ?? null, latest - 500, latest, Date.now());
      const ins = db.prepare('INSERT INTO node_refs (node_id, kind, value, origin) VALUES (?, ?, ?, ?)');
      db.exec('BEGIN');
      for (const [kind, value, origin] of o.refs ?? []) ins.run(id, kind, value, origin ?? 'tool_use');
      db.exec('COMMIT');
    });
    return id;
  }
  const graphDir = (): string => path.join(root, 'graphify-out');
  const graphFile = (): string => path.join(graphDir(), 'graph.json');
  function plantGraph(nodes: Array<{ label: string; file: string }>, extra: Record<string, unknown> = {}): void {
    fs.mkdirSync(graphDir(), { recursive: true });
    fs.writeFileSync(graphFile(), JSON.stringify({
      ...extra, nodes: nodes.map((n, i) => ({ id: `g${i}`, label: n.label, source_file: n.file })), links: [],
    }));
  }
  const touched = (args: string[], env: Record<string, string> = {}): CliRun =>
    runCli(box, ['touched', ...args], { env: { ...withPane(box, ID), ...env } });
  const touchedJson = (args: string[]): CliRun => touched([...args, '--json']);
  const items = (r: CliRun): Array<Record<string, any>> => (r.json?.['items'] ?? []) as Array<Record<string, any>>;
  const lines = (r: CliRun): string[] => r.stdout.split('\n');
  /** The row lines of a human answer: those that open with a node id and name its kind. */
  const rowLines = (r: CliRun): string[] => lines(r).filter((l) => /^L[0-9a-z]+ native_leaf /.test(l));
  const headers = (r: CliRun): string[] => lines(r).filter((l) => l.startsWith('touched '));

  beforeAll(() => {
    root = mkTmp('ccrc-hist-touched-root-');
    box = makeHistoryBox('ccrc-hist-touched-', { roster: LANE_ROSTER });
    const sw = runSweep(box);
    expect(sw.code, sw.stderr).toBe(0);
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: turns(root) });
    dbFile = path.join(box.root, 'db', 'history.db');
    ids = withDb((db) => {
      const fam = db.prepare('SELECT session_pk FROM sessions WHERE ccrc_id = ? AND generation = ?').get(ID, G1) as { session_pk: number };
      const ep = db.prepare('SELECT seq FROM epochs WHERE session_pk = ? AND confirmed_ms IS NOT NULL ORDER BY seq LIMIT 1').get(fam.session_pk) as { seq: number };
      const tr = db.prepare("SELECT transcript_pk FROM transcripts WHERE cc_session_uuid = ? AND agent_id = ''").get(TA) as { transcript_pk: number };
      db.prepare('UPDATE epochs SET cwd = ?, cwd_real = ? WHERE session_pk = ?').run(root, root, fam.session_pk);
      return { session_pk: Number(fam.session_pk), seq: Number(ep.seq), tpk: Number(tr.transcript_pk) };
    });
  }, 600_000);
  beforeEach(() => { fs.rmSync(graphDir(), { recursive: true, force: true }); });

  it('CONTROL: the fixture family answers a read verb, and its root is the epoch directory', () => {
    plant('Lc0ntr0l1', { refs: [['path', 'ccd/control.mjs']] });
    const r = touchedJson(['ccd/control.mjs']);
    expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
    expect(items(r).map((i) => i['nodeId'])).toEqual(['Lc0ntr0l1']);
  }, HEAVY);

  it('TC1 no graph.json: a path answers from refs, and a symbol answers from path:symbol refs only, through the bounded symbol select', () => {
    plant('Lt01n1', { refs: [['path', 'ccd/tc1.mjs'], ['path:symbol', 'ccd/tc1b.mjs:tc1sym', 'model']] });
    const byPath = touched(['ccd/tc1.mjs']);
    expect(byPath.code, `${byPath.stderr}${byPath.stdout}`).toBe(0);
    expect(headers(byPath)).toEqual(['touched ccd/tc1.mjs (no graph)']);
    expect(rowLines(byPath)).toHaveLength(1);
    expect(rowLines(byPath)[0]).toContain(' exact refs path/tool_use ');
    const bySymbol = touched(['tc1sym']);
    expect(bySymbol.code, `${bySymbol.stderr}${bySymbol.stdout}`).toBe(0);
    expect(headers(bySymbol)).toEqual(['touched ccd/tc1b.mjs (no graph)']);
    expect(rowLines(bySymbol)[0]).toContain(' exact refs path:symbol/model symbol tc1sym ');
  }, HEAVY);

  it('TC2 a symbol with a graph: two files whose nodes carry the label are two groups', () => {
    plant('Lt02a', { latest: T0 + 9000, refs: [['path', 'a/tc2a.mjs']] });
    plant('Lt02b', { latest: T0 + 8000, refs: [['path', 'b/tc2b.mjs']] });
    plantGraph([{ label: 'tc2foo', file: 'a/tc2a.mjs' }, { label: 'tc2foo', file: 'b/tc2b.mjs' }, { label: 'other', file: 'c/other.mjs' }]);
    const r = touched(['tc2foo']);
    expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
    expect(headers(r)).toEqual(['touched a/tc2a.mjs (graph)', 'touched b/tc2b.mjs (graph)']);
    expect(items(touchedJson(['tc2foo'])).map((i) => [i['nodeId'], i['file']])).toEqual([['Lt02a', 'a/tc2a.mjs'], ['Lt02b', 'b/tc2b.mjs']]);
  }, HEAVY);

  it('TC4 a cut is shown: 25 matches at the default limit print 20 rows and (+5 not shown); --limit 25 prints all', () => {
    for (let i = 1; i <= 25; i += 1) plant(`Lt04n${String(i).padStart(2, '0')}`, { latest: T0 + 100_000 + i * 1000, refs: [['path', 'ccd/tc4.mjs']] });
    const r = touched(['ccd/tc4.mjs']);
    expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
    expect(rowLines(r)).toHaveLength(20);
    expect(r.stdout).toContain('(+5 not shown)');
    expect(r.stdout).toContain('shown 20 of 25');
    expect(rowLines(r)[0], 'newest first (TC3)').toMatch(/^Lt04n25 /);
    const all = touched(['ccd/tc4.mjs', '--limit', '25']);
    expect(rowLines(all)).toHaveLength(25);
    expect(all.stdout).not.toContain('not shown');
    expect(touchedJson(['ccd/tc4.mjs']).json?.['total']).toBe(25);
  }, HEAVY);

  it('TC5 read-only: the store bytes, mtime and user_version are unchanged, and nothing is written under graphify-out', () => {
    plant('Lt05n1', { refs: [['path', 'ccd/tc5.mjs'], ['path:symbol', 'ccd/tc5.mjs:tc5sym']] });
    plantGraph([{ label: 'tc5sym', file: 'ccd/tc5.mjs' }]);
    const store = (): { sha: string; mtimeMs: number; version: number } => ({
      sha: createHash('sha256').update(fs.readFileSync(dbFile)).digest('hex'),
      mtimeMs: fs.statSync(dbFile).mtimeMs,
      version: withDb((db) => Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)),
    });
    const listing = (): string[] => fs.readdirSync(graphDir()).sort();
    const before = store();
    const dir = listing();
    for (const args of [['ccd/tc5.mjs'], ['tc5sym'], ['ccd/tc5.mjs:tc5sym', '--json']]) {
      const r = touched(args);
      expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
    }
    expect(store()).toEqual(before);
    expect(listing(), 'nothing new under graphify-out').toEqual(dir);
    expect(dir).toEqual(['graph.json']);
  }, HEAVY);

  it('TC6 not the card\'s tag: a node whose only ref for the file is model-origin is listed', () => {
    plant('Lt06n1', { refs: [['path', 'ccd/tc6.mjs', 'model']] });
    const r = touched(['ccd/tc6.mjs']);
    expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
    expect(rowLines(r)).toHaveLength(1);
    expect(rowLines(r)[0]).toContain(' refs path/model ');
    expect(items(touchedJson(['ccd/tc6.mjs']))[0]?.['refs']).toEqual([{ kind: 'path', value: 'ccd/tc6.mjs', origin: 'model', line: null, symbol: null }]);
  }, HEAVY);

  it('TC7 a graph over GRAPH_MAX_BYTES: a symbol query falls back to path:symbol refs only (as TC1), and a path query answers', () => {
    plant('Lt07n1', { refs: [['path', 'o/tc7.mjs'], ['path:symbol', 'p/tc7other.mjs:tc7sym']] });
    fs.mkdirSync(graphDir(), { recursive: true });
    const fd = fs.openSync(graphFile(), 'w');
    try {
      fs.writeSync(fd, '{"nodes":[{"id":"g0","label":"tc7sym","source_file":"o/tc7.mjs"}],"links":[],"pad":"');
      const chunk = Buffer.alloc(1024 * 1024, 'x');
      for (let n = 0; n <= GRAPH_MAX_BYTES / chunk.length; n += 1) fs.writeSync(fd, chunk);
      fs.writeSync(fd, '"}');
    } finally { fs.closeSync(fd); }
    try {
      expect(fs.statSync(graphFile()).size, 'CONTROL: the fixture graph is over the bound').toBeGreaterThan(GRAPH_MAX_BYTES);
      const sym = touched(['tc7sym']);
      expect(sym.code, `${sym.stderr}${sym.stdout}`).toBe(0);
      expect(headers(sym), 'only the path:symbol ref answers; the label\'s file is unknown').toEqual(['touched p/tc7other.mjs (no graph)']);
      const byPath = touched(['o/tc7.mjs']);
      expect(byPath.code, `${byPath.stderr}${byPath.stdout}`).toBe(0);
      expect(headers(byPath)).toEqual(['touched o/tc7.mjs (no graph)']);
    } finally {
      fs.rmSync(graphFile(), { force: true });
    }
  }, HEAVY);

  it('a malformed graph answers as no graph (failure row 28)', () => {
    plant('Lt28n1', { refs: [['path', 'ccd/tc28.mjs'], ['path:symbol', 'ccd/tc28b.mjs:tc28sym']] });
    fs.mkdirSync(graphDir(), { recursive: true });
    fs.writeFileSync(graphFile(), '{ this is not json');
    for (const [arg, head] of [['ccd/tc28.mjs', 'touched ccd/tc28.mjs (no graph)'], ['tc28sym', 'touched ccd/tc28b.mjs (no graph)']] as const) {
      const r = touched([arg]);
      expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
      expect(headers(r)).toEqual([head]);
    }
    fs.writeFileSync(graphFile(), JSON.stringify({ nodes: [], links: 'x' }));
    expect(headers(touched(['ccd/tc28.mjs']))).toEqual(['touched ccd/tc28.mjs (no graph)']);
  }, HEAVY);

  // Review Focus 4 through the verb: `_` and `%` in a name match only themselves. The JS matcher would drop an `aXb` decoy that a bare
  // `_` let into the select, so the escape shows only in what the select hands the cap: 10,001 newer decoys that an unescaped
  // pattern admits fill the candidate cap and push the real, older node out (an exit 3 and a cap line), where an escaped pattern
  // admits none of them and the real node is the one row. Each case names its own files and symbol, so no other case sees the decoys.
  it('a file name holding _ matches only itself through the verb: 10,001 newer aXb decoys neither fill the cap nor push the real node out', () => {
    plant('Lt26real', { latest: T0 + 500_000, refs: [['path', 'ccd/tc26_ab.mjs']] });
    const decoys: Array<[string, string]> = [];
    for (let i = 1; i <= 10_001; i += 1) decoys.push(['path', `ccd/tc26Xab.mjs:${i}`]);
    plant('Lt26decoy', { latest: T0 + 900_000, refs: decoys });
    const j = touchedJson(['ccd/tc26_ab.mjs']);
    expect(j.code, `${j.stderr}${j.stdout.slice(0, 400)}`).toBe(0);
    expect(items(j).map((i) => i['nodeId'])).toEqual(['Lt26real']);
    expect(j.json, 'the decoys were never candidates, so nothing is capped').not.toHaveProperty('candidatesCapped');
    const d = touchedJson(['ccd/tc26Xab.mjs']);
    expect(d.json?.['total'], 'CONTROL: the decoy name finds the decoy node (the row is too big to print), so the decoys are in the store').toBe(1);
  }, HEAVY);

  it('a symbol holding _ matches only itself through the verb: 10,001 newer fooXbar decoys neither fill the cap nor push the real node out', () => {
    plant('Lt27real', { latest: T0 + 500_000, refs: [['path:symbol', 'ccd/tc27.mjs:tc27foo_bar', 'model']] });
    const decoys: Array<[string, string]> = [];
    for (let i = 1; i <= 10_001; i += 1) decoys.push(['path:symbol', `ccd/tc27d${i}.mjs:tc27fooXbar`]);
    plant('Lt27decoy', { latest: T0 + 900_000, refs: decoys });
    const j = touchedJson(['tc27foo_bar']);
    expect(j.code, `${j.stderr}${j.stdout.slice(0, 400)}`).toBe(0);
    expect(items(j).map((i) => i['nodeId'])).toEqual(['Lt27real']);
    expect(j.json).not.toHaveProperty('candidatesCapped');
    expect(touchedJson(['tc27fooXbar']).json?.['total'], 'CONTROL: the decoy symbol finds the decoy refs, so they are in the store').toBeGreaterThan(1000);
  }, HEAVY);

  it('a query holding % is bad-args, exit 2', () => {
    const r = touchedJson(['tc28a%b']);
    expect([r.code, r.json?.['reason']]).toEqual([2, 'bad-args']);
  }, HEAVY);

  // D-8190: a graph.json that is no regular file is "no graph". loadGraph opens its path, and opening a FIFO with no writer blocks
  // for good; a blocked synchronous open cannot be interrupted by vitest's timeout, so each of these cases runs the verb in a child
  // with a hard timeout and asserts the child ended by itself.
  describe('a graph.json that is not a regular file (D-8190)', () => {
    const BOUND_MS = 60_000;   // the mutant hangs for good, so a wide bound keeps its signal and spares a loaded box a false red
    const bounded = (args: string[]): CliRun => runCli(box, ['touched', ...args], { env: withPane(box, ID), timeoutMs: BOUND_MS });
    const endedByItself = (r: CliRun): void => {
      expect(r.signal, `the child was killed by the ${BOUND_MS} ms bound (it hung): ${r.stderr}`).toBeNull();
      expect(r.ms).toBeLessThan(BOUND_MS - 1000);
    };
    const mkfifo = (at: string): void => { execFileSync('mkfifo', [at]); };

    it('a FIFO graph.json is no graph, promptly, for a path query and a symbol query', () => {
      plant('Lt35n1', { refs: [['path', 'ccd/tc35.mjs'], ['path:symbol', 'ccd/tc35b.mjs:tc35sym', 'model']] });
      fs.mkdirSync(graphDir(), { recursive: true });
      mkfifo(graphFile());
      const byPath = bounded(['ccd/tc35.mjs']);
      endedByItself(byPath);
      expect(byPath.code, `${byPath.stderr}${byPath.stdout}`).toBe(0);
      expect(headers(byPath)).toEqual(['touched ccd/tc35.mjs (no graph)']);
      const bySymbol = bounded(['tc35sym']);
      endedByItself(bySymbol);
      expect(bySymbol.code, `${bySymbol.stderr}${bySymbol.stdout}`).toBe(0);
      expect(headers(bySymbol), 'only the path:symbol ref answers; no graph names the label\'s files').toEqual(['touched ccd/tc35b.mjs (no graph)']);
    }, HEAVY);

    it('a graph.json that links to a FIFO elsewhere is no graph, promptly', () => {
      plant('Lt36n1', { refs: [['path', 'ccd/tc36.mjs']] });
      const elsewhere = path.join(mkTmp('ccrc-hist-touched-fifo-'), 'pipe');
      mkfifo(elsewhere);
      fs.mkdirSync(graphDir(), { recursive: true });
      fs.symlinkSync(elsewhere, graphFile());
      const r = bounded(['ccd/tc36.mjs']);
      endedByItself(r);
      expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
      expect(headers(r)).toEqual(['touched ccd/tc36.mjs (no graph)']);
    }, HEAVY);

    it('CONTROL: a link to a regular graph file still loads (the stat follows links)', () => {
      plant('Lt37n1', { refs: [['path', 'ccd/tc37.mjs']] });
      const elsewhere = path.join(mkTmp('ccrc-hist-touched-link-'), 'g.json');
      fs.writeFileSync(elsewhere, JSON.stringify({ nodes: [{ id: 'g0', label: 'tc37sym', source_file: 'ccd/tc37.mjs' }], links: [] }));
      fs.mkdirSync(graphDir(), { recursive: true });
      fs.symlinkSync(elsewhere, graphFile());
      const r = bounded(['tc37sym']);
      endedByItself(r);
      expect(headers(r)).toEqual(['touched ccd/tc37.mjs (graph)']);
    }, HEAVY);
  });

  // Review 1822: one stored ref is one row, and the node is counted once, when a symbol query's label file and the ref's own path name one file.
  it('a symbol query lists a relative path:symbol ref once, under the graph\'s file, and counts the node once', () => {
    plant('Lt38n1', { refs: [['path:symbol', 'tc38x.mjs:tc38foo', 'model']] });
    plantGraph([{ label: 'tc38foo', file: 'ccd/tc38x.mjs' }]);
    const j = touchedJson(['tc38foo']);
    expect(j.code, `${j.stderr}${j.stdout}`).toBe(0);
    expect(j.json?.['total'], 'one node, one file: one row').toBe(1);
    expect(items(j).map((i) => [i['nodeId'], i['file'], i['match']])).toEqual([['Lt38n1', 'ccd/tc38x.mjs', 'suffix']]);
    expect(headers(touched(['tc38foo']))).toEqual(['touched ccd/tc38x.mjs (graph)']);
  }, HEAVY);

  it('TC8 scope: --project and --workspace together are refused, exit 2', () => {
    const r = touchedJson(['ccd/x.mjs', '--project', '--workspace']);
    expect([r.code, r.json?.['reason']]).toEqual([2, 'bad-args']);
  }, HEAVY);

  it('TC9 agents hidden (P7): a subagent node naming the file is hidden without --agents and listed with agent:<id> with it', () => {
    const tpk = withDb((db) => {
      db.prepare("INSERT INTO transcripts (cc_session_uuid, agent_id) VALUES (?, 'agtc9')").run(TA);
      return Number((db.prepare("SELECT transcript_pk FROM transcripts WHERE cc_session_uuid = ? AND agent_id = 'agtc9'").get(TA) as { transcript_pk: number }).transcript_pk);
    });
    plant('Lt09main', { latest: T0 + 5000, refs: [['path', 'ccd/tc9.mjs']] });
    plant('Lt09agent', { latest: T0 + 6000, tpk, refs: [['path', 'ccd/tc9.mjs']] });
    const off = touched(['ccd/tc9.mjs']);
    expect(rowLines(off).map((l) => l.split(' ')[0])).toEqual(['Lt09main']);
    expect(off.stdout).not.toContain('agent:');
    expect(items(touchedJson(['ccd/tc9.mjs'])).map((i) => i['nodeId'])).toEqual(['Lt09main']);
    const on = touched(['ccd/tc9.mjs', '--agents']);
    expect(rowLines(on).map((l) => l.split(' ')[0])).toEqual(['Lt09agent', 'Lt09main']);
    expect(rowLines(on)[0]).toMatch(/^Lt09agent native_leaf agent:agtc9 /);
    expect(rowLines(on)[1]).not.toContain('agent:');
    expect(items(touchedJson(['ccd/tc9.mjs', '--agents'])).map((i) => i['agentId'])).toEqual(['agtc9', null]);
  }, HEAVY);

  it('TC15 disclosure: every answer, empty ones included, ends with the disclosure line; --json carries it as note', () => {
    plant('Lt15n1', { refs: [['path', 'ccd/tc15.mjs']] });
    for (const arg of ['ccd/tc15.mjs', 'ccd/tc15-nothing.mjs']) {
      const r = touched([arg]);
      expect(r.code, `${r.stderr}${r.stdout}`).toBe(arg.includes('nothing') ? 3 : 0);
      expect(lines(r).filter((l) => l !== '').at(-1)).toBe(TOUCHED_DISCLOSURE);
      const j = touchedJson([arg]);
      expect(j.json?.['note']).toBe(TOUCHED_DISCLOSURE);
      expect(j.json).not.toHaveProperty('candidatesCapped');
    }
    const empty = touched(['ccd/tc15-nothing.mjs']);
    expect(headers(empty)).toEqual(['touched ccd/tc15-nothing.mjs (no graph)']);
    expect(empty.stdout).toContain('shown 0 of 0');
  }, HEAVY);

  it('TC16 candidates capped: 6,000 symbol refs and 4,001 file refs, 10,001 together, print the cap line; --json carries candidatesCapped', () => {
    const refs: Array<[string, string]> = [];
    for (let i = 0; i < 6000; i += 1) refs.push(['path:symbol', `cap/s${i}.mjs:tc16foo`]);
    for (let i = 1; i <= 4001; i += 1) refs.push(['path', `lib/tc16-file.mjs:${i}`]);
    plant('Lt16n1', { refs });
    plantGraph([{ label: 'tc16foo', file: 'lib/tc16-file.mjs' }]);
    const r = touched(['tc16foo']);
    expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
    expect(TOUCHED_ORDERED_CAP, 'the ordered cap is on (P13, measured)').toBe(true);
    expect(r.stdout).toContain(TOUCHED_ORDERED_CAPPED_NOTE);
    expect(r.stdout).not.toContain(TOUCHED_CAPPED_NOTE);
    const j = touchedJson(['tc16foo']);
    expect(j.json?.['candidatesCapped']).toBe(true);
    expect(j.json?.['candidatesCappedNote']).toBe(TOUCHED_ORDERED_CAPPED_NOTE);
    expect(j.json?.['note']).toBe(TOUCHED_DISCLOSURE);
    expect(lines(r).filter((l) => l !== '').at(-1), 'the disclosure still ends the answer').toBe(TOUCHED_DISCLOSURE);
  }, HEAVY);

  it('TC16 CONTROL: 10,000 candidates together are not capped', () => {
    const refs: Array<[string, string]> = [];
    for (let i = 0; i < 6000; i += 1) refs.push(['path:symbol', `cap/c${i}.mjs:tc16bar`]);
    for (let i = 1; i <= 4000; i += 1) refs.push(['path', `lib/tc16-bar.mjs:${i}`]);
    plant('Lt16n2', { refs });
    plantGraph([{ label: 'tc16bar', file: 'lib/tc16-bar.mjs' }]);
    const j = touchedJson(['tc16bar']);
    expect(j.code, `${j.stderr}${j.stdout}`).toBe(0);
    expect(j.json).not.toHaveProperty('candidatesCapped');
  }, HEAVY);

  it('VERB_TABLES.touched lists every table its path reads: the context, its own selects, and the as-of cut\'s lineage and descendants', () => {
    expect([...VERB_TABLES.touched]).toEqual([
      'meta', 'redact_hashes', 'sessions', 'epochs', 'transcripts', 'entries', 'ingest_files', 'derivation_state',
      'nodes', 'node_refs', 'node_sources', 'node_children', 'memberships', 'boundaries',
    ]);
  });

  it('TC17 one verb list (A7): the read-verb whitelist is derived from one list and includes touched', () => {
    expect(READ_VERBS).toContain('touched');
    expect([...READ_VERBS]).toEqual(Object.keys(READ_OPTIONS));
    expect(parseReadArgs('touched', ['ccd/x.mjs', '--agents', '--limit', '100']).ok).toBe(true);
    expect(parseReadArgs('touched', ['ccd/x.mjs', '--limit', '101'])).toEqual({ ok: false, reason: 'bad-args' });
    expect(parseReadArgs('touched', [])).toEqual({ ok: false, reason: 'bad-args' });
    expect(parseReadArgs('touched', ['a', 'b'])).toEqual({ ok: false, reason: 'bad-args' });
  });

  it('TC18 a test-kind ref: /root/server/test/foo.test.ts stored as kind test is listed for server/test/foo.test.ts, exact', () => {
    plant('Lt18n1', { refs: [['test', `${root}/server/test/tc18.test.ts`]] });
    const r = touchedJson(['server/test/tc18.test.ts']);
    expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
    expect(items(r).map((i) => [i['nodeId'], i['match'], i['file']])).toEqual([['Lt18n1', 'exact', 'server/test/tc18.test.ts']]);
    expect(touched(['server/test/tc18.test.ts']).stdout).toContain(' exact refs test/tool_use ');
  }, HEAVY);

  it('TC21 header provenance (P14): no header carries a sha, with or without a graph', () => {
    plant('Lt21n1', { refs: [['path', 'ccd/tc21.mjs']] });
    const BUILT = 'abcdef0123456789abcdef0123456789abcdef01';
    for (const graph of [false, true]) {
      if (graph) plantGraph([{ label: 'x', file: 'ccd/tc21.mjs' }], { built_at_commit: BUILT });
      const r = touched(['ccd/tc21.mjs']);
      expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
      expect(headers(r)).toEqual([`touched ccd/tc21.mjs (${graph ? 'graph' : 'no graph'})`]);
      expect(r.stdout).not.toContain(BUILT.slice(0, 7));
    }
  }, HEAVY);

  it('TC22 a symbol with a graph and refs together (P8): the labelled file\'s node and a path:symbol ref in an unlabelled file are both listed', () => {
    plant('Lt22a', { latest: T0 + 4000, refs: [['path', 'a/tc22a.mjs']] });
    plant('Lt22b', { latest: T0 + 3000, refs: [['path:symbol', 'ccd/tc22y.mjs:tc22foo']] });
    plantGraph([{ label: 'tc22foo', file: 'a/tc22a.mjs' }]);
    const r = touchedJson(['tc22foo']);
    expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
    expect(items(r).map((i) => [i['nodeId'], i['file']])).toEqual([['Lt22a', 'a/tc22a.mjs'], ['Lt22b', 'ccd/tc22y.mjs']]);
  }, HEAVY);

  it('TC23 symbol candidates capped (P8, P13): no graph and 10,001 path:symbol refs naming the symbol print the ordered cap line, the newest listed first', () => {
    const refs: Array<[string, string]> = [];
    for (let i = 0; i < TOUCHED_CANDIDATE_MAX; i += 1) refs.push(['path:symbol', `cap/t${i}.mjs:tc23foo`]);
    plant('Lt23old', { latest: T0 + 1000, refs });
    plant('Lt23new', { latest: T0 + 9_000_000, refs: [['path:symbol', 'cap/tnew.mjs:tc23foo']] });
    const r = touched(['tc23foo']);
    expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
    expect(r.stdout).toContain(TOUCHED_ORDERED_CAPPED_NOTE);
    const j = touchedJson(['tc23foo']);
    expect(j.json?.['candidatesCapped']).toBe(true);
    expect(items(j)[0]?.['nodeId']).toBe('Lt23new');   // the order: the newest of 10,001 candidates first
  }, HEAVY);

  /** `rows` refs to `lib/<tag>.mjs:<i>` spread over nodes of 40 refs (the store's cap), each node `stamp(j)` old; `inScope: false` puts them in an epoch no scope holds. */
  function plantFiller(tag: string, rows: number, stamp: (j: number) => number, inScope = true): void {
    for (let j = 0; j * 40 < rows; j += 1) {
      const refs: Array<[string, string]> = [];
      for (let i = j * 40 + 1; i <= Math.min(rows, (j + 1) * 40); i += 1) refs.push(['path', `lib/${tag}.mjs:${i}`]);
      plant(`${tag}f${j}`, { latest: stamp(j), refs, ...(inScope ? {} : { epoch: 999 }) });
    }
  }
  const newestRefs = (tag: string, k: number): Array<[string, string]> => Array.from({ length: k }, (_, i) => ['path', `lib/${tag}.mjs:${50_000 + i}`]);

  it('TC20 the ordered cap (P13): candidates past the cap whose newest match was inserted last are capped, and the newest is listed first', () => {
    plantFiller('Lt20', 10_001, (j) => T0 + 1000 + j);
    plant('Lt20new', { latest: T0 + 9_000_000, refs: newestRefs('Lt20', 1) });
    const j = touchedJson(['lib/Lt20.mjs']);
    expect(j.code, `${j.stderr}${j.stdout}`).toBe(0);
    expect(j.json?.['candidatesCapped']).toBe(true);
    expect(items(j)[0]?.['nodeId']).toBe('Lt20new');
  }, HEAVY);

  it('TC20b the select itself orders (its LIMIT is 10,001): 10,001 older candidates, then the 3 newest, inserted last: all 3 are kept', () => {
    plantFiller('Lt20b', 10_001, (j) => T0 + 1000 + j);
    plant('Lt20bnew', { latest: T0 + 9_000_000, refs: newestRefs('Lt20b', 3) });
    const j = touchedJson(['lib/Lt20b.mjs']);
    expect(j.code, `${j.stderr}${j.stdout}`).toBe(0);
    const [first] = items(j);
    expect(first?.['nodeId']).toBe('Lt20bnew');
    expect(first?.['refs']).toHaveLength(3);
    expect(first).not.toHaveProperty('refsCut');
  }, HEAVY);

  it('TC24 the cut inside a node\'s refs (P13): that node\'s row says its refs were cut, in the human line and as refsCut', () => {
    // 9,990 newest candidates sit in an epoch no scope holds, so the one in-scope row is the node the cut falls inside (10 of its 20 refs kept).
    plantFiller('Lt24', 9_990, (j) => T0 + 8_000_000 + j, false);
    plant('Lt24mid', { latest: T0 + 5_000_000, refs: newestRefs('Lt24', 20) });
    plant('Lt24old', { latest: T0 + 1000, refs: newestRefs('Lt24', 5).map(([k, v]) => [k, `${v}0`] as [string, string]) });
    const j = touchedJson(['lib/Lt24.mjs']);
    expect(j.code, `${j.stderr}${j.stdout}`).toBe(0);
    expect(j.json?.['candidatesCappedNote']).toBe(TOUCHED_ORDERED_CAPPED_NOTE);
    expect(items(j).map((i) => [i['nodeId'], i['refsCut'], (i['refs'] as unknown[]).length])).toEqual([['Lt24mid', true, 10]]);
    const h = rowLines(touched(['lib/Lt24.mjs']));
    expect(h).toHaveLength(1);
    expect(h[0]).toMatch(/\(refs cut at the cap\) <ccrc-recall /);
    expect(TOUCHED_REFS_CUT_NOTE).toBe('(refs cut at the cap)');
  }, HEAVY);

  it('TC25 a symbol with a graph merges its selects under the order before its one cut: the newest match, from the file select, is listed first', () => {
    for (let j = 0; j < 250; j += 1) plant(`Lt25f${j}`, { latest: T0 + 1000 + j, refs: Array.from({ length: 40 }, (_, i) => ['path:symbol', `cap/m${j}x${i}.mjs:tc25foo`] as [string, string]) });
    plant('Lt25new', { latest: T0 + 9_000_000, refs: [['path', 'lib/tc25-file.mjs']] });
    plantGraph([{ label: 'tc25foo', file: 'lib/tc25-file.mjs' }]);
    const j = touchedJson(['tc25foo']);
    expect(j.code, `${j.stderr}${j.stdout}`).toBe(0);
    expect(j.json?.['candidatesCapped']).toBe(true);
    expect(items(j)[0]?.['nodeId']).toBe('Lt25new');
  }, HEAVY);

  it('P8 a path-symbol query tests its symbol: a path:symbol ref of another symbol is not listed, the same symbol and a plain path ref are', () => {
    plant('Lt31a', { refs: [['path:symbol', 'ccd/tc31.mjs:otherSym']] });
    plant('Lt31b', { refs: [['path:symbol', 'ccd/tc31.mjs:fooBar']] });
    plant('Lt31c', { refs: [['path', 'ccd/tc31.mjs']] });
    const r = touchedJson(['ccd/tc31.mjs:fooBar']);
    expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
    expect(items(r).map((i) => i['nodeId']).sort()).toEqual(['Lt31b', 'Lt31c']);
    expect(items(touchedJson(['ccd/tc31.mjs'])).map((i) => i['nodeId']).sort(), 'CONTROL: the path query lists all three').toEqual(['Lt31a', 'Lt31b', 'Lt31c']);
  }, HEAVY);

  it('W2-D36 the as-of cut: a node the cut hides is absent, and the same query without the cut lists it', () => {
    const b = withDb((db) => db.prepare('SELECT e.entry_id AS id, e.uuid AS uuid FROM boundaries b JOIN entries e ON e.entry_id = b.entry_id ORDER BY b.ord').all() as unknown as Array<{ id: number; uuid: string }>);
    expect(b.length, 'CONTROL: the store holds two boundaries').toBe(2);
    plant('Lt30vis', { boundary: Number(b[0]!.id), refs: [['path', 'ccd/tc30.mjs']] });
    plant('Lt30hid', { boundary: Number(b[1]!.id), refs: [['path', 'ccd/tc30.mjs']] });
    expect(items(touchedJson(['ccd/tc30.mjs'])).map((i) => i['nodeId']).sort(), 'CONTROL: without a cut both are listed').toEqual(['Lt30hid', 'Lt30vis']);
    const storeId = fs.readFileSync(path.join(box.root, 'store.id'), 'utf8').trim();
    fs.writeFileSync(path.join(box.root, 'headless-on'), `store ${storeId}\n${ID} ${G1}\n`, { mode: 0o600 });
    const cut = runCli(box, ['touched', 'ccd/tc30.mjs', '--json'], { env: { CCRC_RECALL_SESSION: ID, CCRC_RECALL_ARM: 'treatment', CCRC_RECALL_ASOF: b[0]!.uuid } });
    expect(cut.code, `${cut.stderr}${cut.stdout}`).toBe(0);
    expect(items(cut).map((i) => i['nodeId'])).toEqual(['Lt30vis']);
  }, HEAVY);

  it('under an as-of cut (describe\'s rule) a node with a hidden source row loses its mined (tool_use) refs, and its row goes when none is left; model refs and a visible source stay', () => {
    const b = withDb((db) => db.prepare('SELECT e.entry_id AS id, e.uuid AS uuid FROM boundaries b JOIN entries e ON e.entry_id = b.entry_id ORDER BY b.ord').all() as unknown as Array<{ id: number; uuid: string }>);
    const visible = withDb((db) => Number((db.prepare('SELECT min(entry_id) AS id FROM entries').get() as { id: number }).id));
    const hidden = Number(b[1]!.id);
    const src = (node: string, entry: number): void => withDb((db) => { db.prepare('INSERT INTO node_sources (node_id, entry_id, ord) VALUES (?, ?, 0)').run(node, entry); });
    const f = 'ccd/tc33.mjs';
    // all four nodes are shown by the cut (their boundary is the first); only the sources differ
    plant('Lt33mined', { boundary: Number(b[0]!.id), refs: [['path', f, 'tool_use']] });
    src('Lt33mined', hidden);
    plant('Lt33model', { boundary: Number(b[0]!.id), refs: [['path', f, 'model']] });
    src('Lt33model', hidden);
    plant('Lt33both', { boundary: Number(b[0]!.id), refs: [['path', f, 'tool_use'], ['test', `${root}/${f}`, 'model']] });
    src('Lt33both', hidden);
    plant('Lt33seen', { boundary: Number(b[0]!.id), refs: [['path', f, 'tool_use']] });
    src('Lt33seen', visible);
    expect(items(touchedJson([f])).map((i) => i['nodeId']).sort(), 'CONTROL: without a cut all four are listed').toEqual(['Lt33both', 'Lt33mined', 'Lt33model', 'Lt33seen']);
    const storeId = fs.readFileSync(path.join(box.root, 'store.id'), 'utf8').trim();
    fs.writeFileSync(path.join(box.root, 'headless-on'), `store ${storeId}\n${ID} ${G1}\n`, { mode: 0o600 });
    const cut = runCli(box, ['touched', f, '--json'], { env: { CCRC_RECALL_SESSION: ID, CCRC_RECALL_ARM: 'treatment', CCRC_RECALL_ASOF: b[0]!.uuid } });
    expect(cut.code, `${cut.stderr}${cut.stdout}`).toBe(0);
    const by = new Map(items(cut).map((i) => [i['nodeId'], (i['refs'] as Array<{ kind: string; origin: string }>).map((r) => `${r.kind}/${r.origin}`)]));
    expect([...by.keys()].sort(), 'the node whose only ref was mined from a hidden row is not listed').toEqual(['Lt33both', 'Lt33model', 'Lt33seen']);
    expect(by.get('Lt33both'), 'its tool_use ref is dropped, its model ref stays').toEqual(['test/model']);
    expect(by.get('Lt33seen')).toEqual(['path/tool_use']);
  }, HEAVY);

  it('with a graph present a suffix match needs the graph\'s unique answer; with no graph a ref of two segments is a suffix (D-8189)', () => {
    plant('Lt34n1', { refs: [['path', 'ccd/tc34.mjs']] });
    const q = 'src/ccd/tc34.mjs';
    const listed = (): string[] => items(touchedJson([q])).map((i) => `${String(i['nodeId'])}/${String(i['match'])}`);
    expect(listed(), 'no graph: a two-segment ref is a suffix').toEqual(['Lt34n1/suffix']);
    plantGraph([{ label: 'a', file: 'src/ccd/tc34.mjs' }, { label: 'b', file: 'other/ccd/tc34.mjs' }]);   // two files end in /ccd/tc34.mjs: ambiguous
    expect(listed(), 'a graph with the basename ambiguous lists nothing').toEqual([]);
    plantGraph([{ label: 'a', file: 'lib/other.mjs' }]);   // a graph that lacks the file
    expect(listed(), 'a graph that lacks the file lists nothing').toEqual([]);
    plantGraph([{ label: 'a', file: 'src/ccd/tc34.mjs' }]);   // a graph that holds it once
    expect(listed(), 'a graph with a unique answer lists it as a suffix').toEqual(['Lt34n1/suffix']);
  }, HEAVY);

  it('a graph with no nodes answers as no graph (failure row 28)', () => {
    plant('Lt32n1', { refs: [['path', 'lib/tc32.mjs']] });
    plantGraph([]);
    const r = touched(['lib/tc32.mjs']);
    expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
    expect(headers(r)).toEqual(['touched lib/tc32.mjs (no graph)']);
  }, HEAVY);

  it('a gist and a ref value holding a secret-shaped string print redacted, in the human page and in --json', () => {
    const SECRET = 'ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
    plant('Lt41n1', { gist: `Leaked ${SECRET} in the log. Second sentence.`, refs: [['path:symbol', `sec/${SECRET}.mjs:tc41sym`], ['path', 'ccd/tc41.mjs']] });
    for (const arg of ['tc41sym', 'ccd/tc41.mjs']) {
      const h = touched([arg]);
      const j = touchedJson([arg]);
      expect(h.code, `${h.stderr}${h.stdout}`).toBe(0);
      expect(h.stdout, `human ${arg}`).not.toContain(SECRET);
      expect(j.stdout, `json ${arg}`).not.toContain(SECRET);
      expect(j.stdout).toContain('[redacted]');
    }
  }, HEAVY);

  it('the 20,000-character cap: the human page and the --json envelope each stay within it, and a cut prints (+k not shown)', () => {
    for (let i = 1; i <= 100; i += 1) {
      plant(`Lt42n${String(i).padStart(3, '0')}`, {
        latest: T0 + 500_000 + i * 1000,
        gist: `Long gist number ${i} ${'word '.repeat(40)}`,
        refs: [1, 2, 3, 4].map((k) => ['path:symbol', `ccd/tc42.mjs:symbolNumber${k}WithAVeryLongName${'x'.repeat(40)}`, 'tool_use'] as [string, string, string?]),
      });
    }
    const h = touched(['ccd/tc42.mjs', '--limit', '100']);
    const j = touchedJson(['ccd/tc42.mjs', '--limit', '100']);
    expect(h.code, `${h.stderr}`).toBe(0);
    expect(h.stdout.length).toBeLessThanOrEqual(20_000);
    expect(j.stdout.length).toBeLessThanOrEqual(20_000);
    const shown = Number(j.json?.['shown']);
    expect(shown, 'the page was cut').toBeLessThan(100);
    expect(j.json?.['total']).toBe(100);
    expect(rowLines(h).length).toBeLessThan(100);
    expect(h.stdout).toMatch(/\(\+\d+ not shown\)/);
    expect(items(j)).toHaveLength(shown);
  }, HEAVY);

  it('W2-D35 the as-of cut hides a whole epoch: its root header does not print and its nodes are not listed', () => {
    const b = withDb((db) => db.prepare('SELECT e.entry_id AS id, e.uuid AS uuid FROM boundaries b JOIN entries e ON e.entry_id = b.entry_id ORDER BY b.ord').all() as unknown as Array<{ id: number; uuid: string }>);
    const root2 = mkTmp('ccrc-hist-touched-root2-');
    const U2 = 'c3c3c3c3-3333-4333-8333-333333333333';
    const seq2 = ids.seq + 100;
    withDb((db) => db.prepare(`INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, started_ms, cwd, cwd_real, confirmed_ms)
      VALUES (?, ?, ?, 'fixture', 'fixture', ?, ?, ?, ?)`).run(ids.session_pk, seq2, U2, T0 + 900_000, root2, root2, T0 + 900_000));
    try {
      plant('Lt50one', { boundary: Number(b[0]!.id), refs: [['path', 'ccd/tc50.mjs']] });
      plant('Lt50two', { boundary: Number(b[0]!.id), refs: [['path', 'ccd/tc50.mjs']] });
      withDb((db) => db.prepare('UPDATE nodes SET epoch_seq = ? WHERE node_id = ?').run(seq2, 'Lt50two'));
      const plain = touched(['ccd/tc50.mjs']);
      expect(rowLines(plain).map((l) => l.split(' ')[0]).sort(), 'CONTROL: without a cut both epochs answer').toEqual(['Lt50one', 'Lt50two']);
      expect(headers(plain), 'CONTROL: one header per root').toHaveLength(2);
      const storeId = fs.readFileSync(path.join(box.root, 'store.id'), 'utf8').trim();
      fs.writeFileSync(path.join(box.root, 'headless-on'), `store ${storeId}\n${ID} ${G1}\n`, { mode: 0o600 });
      const cut = runCli(box, ['touched', 'ccd/tc50.mjs'], { env: { CCRC_RECALL_SESSION: ID, CCRC_RECALL_ARM: 'treatment', CCRC_RECALL_ASOF: b[0]!.uuid } });
      expect(cut.code, `${cut.stderr}${cut.stdout}`).toBe(0);
      expect(rowLines(cut).map((l) => l.split(' ')[0])).toEqual(['Lt50one']);
      expect(headers(cut), 'the hidden epoch\'s root prints no header').toHaveLength(1);
    } finally {
      withDb((db) => {
        db.prepare("DELETE FROM node_refs WHERE node_id IN ('Lt50one', 'Lt50two')").run();
        db.prepare("DELETE FROM nodes WHERE node_id IN ('Lt50one', 'Lt50two')").run();
        db.prepare('DELETE FROM epochs WHERE session_pk = ? AND seq = ?').run(ids.session_pk, seq2);
      });
    }
  }, HEAVY);

  it('the human page holds its own cap: an XML-escaped gist grows the human row past its JSON item (120 characters become 600), and the page stays within 20,000 with (+k not shown)', () => {
    for (let i = 1; i <= 100; i += 1) {
      plant(`Lt51n${String(i).padStart(3, '0')}`, { latest: T0 + 700_000 + i * 1000, gist: '&'.repeat(200), refs: [['path', 'ccd/tc51.mjs']] });
    }
    const h = touched(['ccd/tc51.mjs', '--limit', '100']);
    const j = touchedJson(['ccd/tc51.mjs', '--limit', '100']);
    expect(h.code, `${h.stderr}`).toBe(0);
    expect(h.stdout.length, 'the human page').toBeLessThanOrEqual(20_000);
    expect(j.stdout.length, 'the --json envelope').toBeLessThanOrEqual(20_000);
    expect(h.stdout).toMatch(/\(\+\d+ not shown\)/);
  }, HEAVY);

  it('a sample answer: the text and JSON forms agree on the rows, and the human form ends with shown, next and the disclosure', () => {
    plant('Lt99n1', { latest: T0 + 70_000, gist: 'Fixed the parser. It was slow.', refs: [['path', 'ccd/tc99.mjs' + ':10-20'], ['test', `${root}/ccd/tc99.mjs`, 'model']] });
    const r = touched(['ccd/tc99.mjs']);
    const j = touchedJson(['ccd/tc99.mjs']);
    expect(r.code).toBe(0);
    expect(items(j)).toHaveLength(1);
    expect(items(j)[0]).toMatchObject({
      nodeId: 'Lt99n1', nodeKind: 'native_leaf', match: 'exact', file: 'ccd/tc99.mjs', gist: 'Fixed the parser.', agentId: null,
      family: { ccrcId: ID, generation: G1 },
    });
    expect(rowLines(r)[0]).toContain('refs path/tool_use line 10-20, test/model ');
    const tail = lines(r).filter((l) => l !== '');
    expect(tail.at(-1)).toBe(TOUCHED_DISCLOSURE);
    expect(tail.at(-2)).toMatch(/^next: .* describe Lt99n1/);
    expect(tail.at(-3)).toBe('shown 1 of 1');
    if (process.env['TOUCHED_SAMPLE'] !== undefined) fs.writeFileSync(process.env['TOUCHED_SAMPLE'], `${r.stdout}\n----\n${j.stdout}`);
  }, HEAVY);

  it('touched takes one argument: none, or one that is no path or symbol, is bad-args', () => {
    for (const args of [[], ['a b'], ['9lives']]) {
      const r = touchedJson(args);
      expect([r.code, r.json?.['reason']], args.join(' ')).toEqual([2, 'bad-args']);
    }
  }, HEAVY);

  it('touched answers the read verbs\' store exits (failure row 32): the same code and reason as tree on each store state', () => {
    const ask = (b: HistoryBox, verb: 'tree' | 'touched'): [number | null, unknown] => {
      const r = runCli(b, verb === 'tree' ? ['tree', '--json'] : ['touched', 'ccd/x.mjs', '--json'], { env: withPane(b, ID) });
      return [r.code, r.json?.['reason']];
    };
    const fresh = makeHistoryBox('ccrc-hist-touched-exit-a-', { roster: LANE_ROSTER });
    expect(ask(fresh, 'touched')).toEqual(ask(fresh, 'tree'));
    expect(ask(fresh, 'touched')[0]).toBe(6);
    const zero = makeHistoryBox('ccrc-hist-touched-exit-b-', { roster: LANE_ROSTER });
    fs.mkdirSync(path.join(zero.root, 'db'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(zero.root, 'db', 'history.db'), '', { mode: 0o600 });
    expect(ask(zero, 'touched')).toEqual(ask(zero, 'tree'));
    expect(ask(zero, 'touched')).toEqual([5, 'store-zero-byte']);
    const server = makeHistoryBox('ccrc-hist-touched-exit-c-', { role: 'server', roster: LANE_ROSTER });
    expect(ask(server, 'touched')).toEqual(ask(server, 'tree'));
    expect(ask(server, 'touched')[0]).toBe(9);
  }, HEAVY);
});


// ── Task 4C: touched's cost at the measured node_refs size (W4 addendum P9, P13) ─────────────────────────────────────
// Skipped unless HISTORY_BENCH=1. One fixture store at the size act M3 measured on the one session-hosting node (68,456
// node_refs rows, 5,697 nodes), its kinds in the proportions classifyRef gives a mixed corpus, built through a writer handle
// on a fixture HOME under the temp root. It times runTouched in-process on a read-only handle, in both forms (the unordered
// selects, and P13's ordered ones, through runTouched's `ordered` argument; the ordered form is the default now), cold and warm.
// Measured (14.5 MB fixture, 20 runs, p95 ms, unordered vs ordered; cold/warm): path 24.1 vs 16.0 / 24.3 vs 15.7, symbol with graph
// 33.7 vs 32.4 / 31.5 vs 32.5, symbol without graph 10.7 vs 11.7 / 10.4 vs 11.5, worst case (cut hit, 79,456 rows) 31.5 vs 39.0 /
// 31.2 vs 35.8: the ordered p95 is under 2 s on every shape, so TOUCHED_ORDERED_CAP is true (P13). Two cells add a realistic graph
// (about 78 MB of graph.json, a symbol spanning 150 basenames) and a 20-root project scope whose graphs are links to one file.
// Cold is a freshly opened read-only handle per run (the OS page cache cannot be dropped here, so it is a cold handle and
// statement cache, not a cold disk); warm is 20 timed runs on one handle after one untimed. Figures go to $HISTORY_BENCH_OUT
// (default: beside the fixture, removed with the run).
describe.skipIf(process.platform === 'darwin')('touched bench (Task 4C)', () => {
  const RUNS = 20;
  const REFS_TOTAL = 68_456;
  const NODES_TOTAL = 5_697;
  /** The kinds' shares of the corpus, summing to 1: what classifyRef yields for refs mined from tool calls and summaries. */
  const MIX: Array<[string, number]> = [
    ['path', 0.60], ['path:symbol', 0.12], ['test', 0.10], ['url', 0.06], ['sha', 0.05], ['d-number', 0.04], ['issue', 0.03],
  ];
  const QFILE = 'ccd/history/recall.mjs';
  const QSYM = 'runTouched';
  const SYM_FILES = [QFILE, 'ccd/history/cli.mjs', 'server/test/history-touched.test.ts'];

  function prng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pct = (xs: number[], p: number): number => {
    const s = [...xs].sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
  };
  const r2 = (n: number): number => Math.round(n * 100) / 100;

  it.skipIf(process.env['HISTORY_BENCH'] !== '1')('touched cost at the measured node_refs size', async () => {
    const rnd = prng(8188);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
    const root = mkTmp('ccrc-hist-touched-bench-root-');
    const box = makeHistoryBox('ccrc-hist-touched-bench-', { roster: LANE_ROSTER });
    const ID = 'lane-a-demo';
    const TA = 'a1a1a1a1-1111-4111-8111-111111111111';
    const G1 = '0189abcd-1234-4678-9abc-0123456789ab';
    const sw = runSweep(box);
    expect(sw.code, sw.stderr).toBe(0);
    seedFamily(box, { id: ID, project: 'demo', uuid: TA, generation: G1, rows: [
      userRow({ uuid: `${TA.slice(0, 8)}-0000-4000-8000-000000000001`, ts: new Date(Date.UTC(2026, 9, 1)).toISOString(), sessionId: TA, cwd: root, text: 'bench question' }),
      assistantRow({ uuid: `${TA.slice(0, 8)}-0000-4000-8000-000000000002`, ts: new Date(Date.UTC(2026, 9, 1, 0, 0, 1)).toISOString(), sessionId: TA, cwd: root, text: 'Bench answer.', requestId: 'req_1', msgId: 'msg_1' }),
    ] });
    const dbFile = path.join(box.root, 'db', 'history.db');
    const store = (await import('../../ccd/history/store.mjs')) as unknown as {
      openReader(p: string): DatabaseSync; openWriter(p: string): DatabaseSync; userVersion(db: DatabaseSync): number;
    };
    const R = (await import('../../ccd/history/recall.mjs')) as unknown as {
      runTouched(rc: unknown, a: { arg: string; limit: number; ordered?: boolean }): { exit: number; total: number; items: Array<Record<string, any>> };
      TOUCHED_SELECTS: Record<'file' | 'symbol' | 'fileOrdered' | 'symbolOrdered', string>;
    };
    const lib = (await import('../../ccd/history/lib.mjs')) as unknown as { makePairIndex(x: unknown[]): unknown };

    // ── the fixture ──
    const W = store.openWriter(dbFile);
    const fam = W.prepare('SELECT session_pk FROM sessions WHERE ccrc_id = ? AND generation = ?').get(ID, G1) as { session_pk: number };
    const ep = W.prepare('SELECT seq FROM epochs WHERE session_pk = ? AND confirmed_ms IS NOT NULL ORDER BY seq LIMIT 1').get(fam.session_pk) as { seq: number };
    const tr = W.prepare("SELECT transcript_pk FROM transcripts WHERE cc_session_uuid = ? AND agent_id = ''").get(TA) as { transcript_pk: number };
    W.prepare('UPDATE epochs SET cwd = ?, cwd_real = ? WHERE session_pk = ?').run(root, root, fam.session_pk);
    const T0 = Date.UTC(2026, 8, 1);
    const SPAN = 70 * 86_400_000;
    const nodeIds: string[] = [];
    const insNode = W.prepare(`INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, gist, topics, summary_blob_id,
      boundary_entry_id, span_start_uuid, earliest_ms, latest_ms, src_chars, desc_count, desc_chars, directive_flag, capped, parser_version, created_ms)
      VALUES (?, ?, ?, ?, ?, 0, 'fixture', ?, NULL, NULL, NULL, NULL, ?, ?, 0, 0, 0, 0, 0, 1, ?)`);
    W.exec('BEGIN');
    for (let i = 0; i < NODES_TOTAL; i += 1) {
      const id = `Lb${i.toString(36).padStart(5, '0')}`;
      nodeIds.push(id);
      const latest = T0 + Math.floor(rnd() * SPAN);
      const gist = `Worked on step ${i} of the bench change and ran the suite. ${'Then it adjusted the parser and the tests for the case. '.repeat(1 + Math.floor(rnd() * 3))}`;
      insNode.run(id, fam.session_pk, ep.seq, tr.transcript_pk, rnd() < 0.85 ? 'native_leaf' : 'raw_leaf', gist, latest - 600_000, latest, Date.now());
    }
    W.exec('COMMIT');

    // value pools
    const DIRS = ['ccd/history', 'ccd', 'server/src/coord', 'server/src', 'server/test', 'agent/src', 'pwa/src/screens', 'pwa/src/lib', 'pwa/test', 'shared', 'ui/src/components', 'deploy', 'docs/superpowers/specs', 'docs/superpowers/plans', '.github/workflows'];
    const STEMS = ['store', 'derive', 'lib', 'sweep', 'card', 'steer', 'census', 'routes', 'schema', 'watch', 'dispatch', 'turnidle', 'api', 'Screen', 'Words', 'index', 'config', 'tokens', 'helpers', 'fixtures'];
    const EXTS = ['mjs', 'ts', 'tsx', 'md', 'json', 'sh', 'css'];
    const files: string[] = [];
    for (let i = 0; files.length < 900; i += 1) files.push(`${pick(DIRS)}/${pick(STEMS)}${i % 7 === 0 ? i : ''}.${pick(EXTS)}`);
    const SYMS = ['runGrep', 'runTree', 'runDescribe', 'readContext', 'classifyRef', 'capRefs', 'openReader', 'sweepStalls', 'planRun', 'decideScope', 'parseReadArgs', 'makePairIndex'];
    const tests = files.filter((f) => /\.(?:ts|mjs)$/.test(f)).slice(0, 250).map((f) => `${f.replace(/\.[a-z]+$/, '')}.test.ts`);
    const hex = (n: number): string => { let s = ''; while (s.length < n) s += Math.floor(rnd() * 16).toString(16); return /[a-f]/.test(s) ? s : `a${s.slice(1)}`; };
    const abs = (f: string): string => (rnd() < 0.4 ? `${root}/${f}` : f);
    const suf = (): string => (rnd() < 0.35 ? (rnd() < 0.5 ? `:${1 + Math.floor(rnd() * 900)}` : `:${1 + Math.floor(rnd() * 400)}-${401 + Math.floor(rnd() * 400)}`) : '');
    const gen: Record<string, () => string> = {
      path: () => `${abs(pick(files))}${suf()}`,
      'path:symbol': () => `${pick(files)}:${pick(SYMS)}`,
      test: () => abs(pick(tests)),
      url: () => `https://github.com/example-org/example-repo/pull/${1 + Math.floor(rnd() * 2700)}`,
      sha: () => hex(7 + Math.floor(rnd() * 6)),
      'd-number': () => `D-${6000 + Math.floor(rnd() * 2300)}`,
      issue: () => `#${1 + Math.floor(rnd() * 2700)}`,
    };
    const quota = new Map<string, number>();
    let left = REFS_TOTAL;
    MIX.forEach(([k, share], i) => { const n = i === MIX.length - 1 ? left : Math.round(REFS_TOTAL * share); quota.set(k, n); left -= n; });
    const perNode = new Map<string, number>();
    const seenRef = new Set<string>();
    const insRef = W.prepare('INSERT INTO node_refs (node_id, kind, value, origin) VALUES (?, ?, ?, ?)');
    const planted = { file: 0, symbol: 0 };
    const put = (kind: string, value: string, hot?: 'file' | 'symbol'): boolean => {
      if ((quota.get(kind) ?? 0) <= 0) return false;
      for (let tries = 0; tries < 50; tries += 1) {
        const id = pick(nodeIds);
        const key = `${id}\0${kind}\0${value}`;
        if (seenRef.has(key) || (perNode.get(id) ?? 0) >= 40) continue;
        seenRef.add(key);
        perNode.set(id, (perNode.get(id) ?? 0) + 1);
        quota.set(kind, quota.get(kind)! - 1);
        insRef.run(id, kind, value, rnd() < 0.7 ? 'tool_use' : rnd() < 0.8 ? 'model' : 'meta');
        if (hot !== undefined) planted[hot] += 1;
        return true;
      }
      return false;
    };
    W.exec('BEGIN');
    // The queried file and symbol: planted rows, so each query returns a realistic number of matches.
    for (let i = 0; i < 140; i += 1) put('path', `${abs(QFILE)}${suf()}`, 'file');
    for (let i = 0; i < 20; i += 1) put('path:symbol', `${QFILE}:${pick(SYMS)}`, 'file');
    for (let i = 0; i < 10; i += 1) put('path', `docs/tools/recall.mjs${suf()}`, 'file');               // a decoy sharing the basename
    for (let i = 0; i < 25; i += 1) put('path:symbol', `${QFILE}:${QSYM}`, 'symbol');
    for (let i = 0; i < 5; i += 1) put('path:symbol', `ccd/history/cli.mjs:${QSYM}`, 'symbol');
    for (let i = 0; i < 6; i += 1) put('path:symbol', `server/test/history-touched.test.ts:${QSYM}`, 'symbol');
    for (let i = 0; i < 100; i += 1) put('path', `${abs('ccd/history/cli.mjs')}${suf()}`);
    for (let i = 0; i < 60; i += 1) put('test', abs('server/test/history-touched.test.ts'));
    for (const [kind] of MIX) { while ((quota.get(kind) ?? 0) > 0) put(kind, gen[kind]!()); }
    W.exec('COMMIT');
    W.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    W.close();
    const bytes = fs.statSync(dbFile).size + (fs.existsSync(`${dbFile}-wal`) ? fs.statSync(`${dbFile}-wal`).size : 0);

    // a graph for the symbol-with-graph shape: the symbol's label on three files, among others
    const writeGraph = (on: boolean): void => {
      fs.rmSync(path.join(root, 'graphify-out'), { recursive: true, force: true });
      if (!on) return;
      fs.mkdirSync(path.join(root, 'graphify-out'), { recursive: true });
      const nodes = [...SYM_FILES.map((f) => ({ label: QSYM, file: f })), ...files.slice(0, 200).map((f) => ({ label: pick(SYMS), file: f }))];
      fs.writeFileSync(path.join(root, 'graphify-out', 'graph.json'), JSON.stringify({ nodes: nodes.map((n, i) => ({ id: `g${i}`, label: n.label, source_file: n.file })), links: [] }));
    };

    function contextOn(db: DatabaseSync) {
      const version = store.userVersion(db);
      const fams = db.prepare('SELECT session_pk, ccrc_id, generation, first_seen_ms FROM sessions WHERE ccrc_id = ? AND merged_into IS NULL ORDER BY session_pk').all(ID) as
        { session_pk: number; ccrc_id: string; generation: string; first_seen_ms: number }[];
      const sessionPks = fams.map((f) => Number(f.session_pk));
      const storeId = (db.prepare("SELECT v FROM meta WHERE k = 'store_id'").get() as { v: string } | undefined)?.v ?? null;
      return {
        db, version, storeId, nowMs: Date.now(), home: box.home, id: ID, gen: G1, scopeArgs: [], pairIdx: lib.makePairIndex([]),
        scope: { kind: 'family', id: ID, generation: G1, project: 'demo', workdir: null, sessionPks, transcriptPks: [Number(tr.transcript_pk)],
          families: fams.map((f) => ({ sessionPk: Number(f.session_pk), ccrcId: f.ccrc_id, generation: f.generation, firstSeenMs: Number(f.first_seen_ms) })) },
      };
    }
    const counts = (() => {
      const d = new DatabaseSync(dbFile, { readOnly: true });
      try {
        return {
          node_refs: (d.prepare('SELECT count(*) AS c FROM node_refs').get() as { c: number }).c,
          nodes: (d.prepare('SELECT count(*) AS c FROM nodes').get() as { c: number }).c,
          byKind: d.prepare('SELECT kind, count(*) AS c FROM node_refs GROUP BY kind ORDER BY c DESC').all(),
          matchesFile: (d.prepare("SELECT count(*) AS c FROM node_refs WHERE kind IN ('path','path:symbol','test') AND value LIKE '%recall.mjs%'").get() as { c: number }).c,
          matchesSymbol: (d.prepare("SELECT count(*) AS c FROM node_refs WHERE kind = 'path:symbol' AND value LIKE '%:runTouched'").get() as { c: number }).c,
        };
      } finally { d.close(); }
    })();
    expect(counts.node_refs).toBe(REFS_TOTAL);
    expect(counts.nodes).toBe(NODES_TOTAL);
    // ── Review 1822: the wide-label cell, a symbol whose graph label spans 165 distinct basenames, at this fixture's size ──
    // The graph holds only the 165 label nodes (a few tens of KB, so its parse is negligible); the store gets two refs on each of
    // the 165 files, removed after the cell (the shapes below run on the fixture as built). The select count is measured by
    // wrapping the handle's `prepare` and counting the executions of the four candidate selects: no production seam.
    const os = await import('node:os');
    const msSince = (t0: bigint): number => Number(process.hrtime.bigint() - t0) / 1e6;
    const wideResults: Array<Record<string, unknown>> = [];
    {
      const SPAN165 = 165;
      const wide = Array.from({ length: SPAN165 }, (_, i) => `bench165/d${i}/b165f${i}.ts`);
      const w = store.openWriter(dbFile);
      const ins = w.prepare('INSERT INTO node_refs (node_id, kind, value, origin) VALUES (?, ?, ?, ?)');
      w.exec('BEGIN');
      wide.forEach((f, i) => { for (let k = 0; k < 2; k += 1) ins.run(nodeIds[(i * 37 + k) % nodeIds.length]!, 'path', f, 'tool_use'); });
      w.exec('COMMIT');
      w.close();
      const wideRefs = (() => { const d = new DatabaseSync(dbFile, { readOnly: true }); try { return (d.prepare('SELECT count(*) AS c FROM node_refs').get() as { c: number }).c; } finally { d.close(); } })();
      fs.rmSync(path.join(root, 'graphify-out'), { recursive: true, force: true });
      fs.mkdirSync(path.join(root, 'graphify-out'), { recursive: true });
      const wideGraph = path.join(root, 'graphify-out', 'graph.json');
      fs.writeFileSync(wideGraph, JSON.stringify({ nodes: wide.map((f, i) => ({ id: `w${i}`, label: QSYM, source_file: f })), links: [] }));
      const wideBytes = fs.statSync(wideGraph).size;
      const executed: number[] = [];
      const ask = (rc: ReturnType<typeof contextOn>) => {
        let n = 0;
        const sels = new Set<string>(Object.values(R.TOUCHED_SELECTS));
        const counted = { prepare: (sql: string) => { const st = rc.db.prepare(sql); if (!sels.has(sql)) return st; return { all: (...a: unknown[]) => { n += 1; return (st.all as (...x: unknown[]) => unknown[])(...a); } }; }, exec: (sql: string) => rc.db.exec(sql) };
        const out = R.runTouched({ ...rc, db: counted }, { arg: QSYM, limit: 20, ordered: true });
        executed.push(n);
        return out;
      };
      const load0 = os.loadavg()[0]!;
      const cold: number[] = [];
      for (let i = 0; i < RUNS; i += 1) {
        const db = store.openReader(dbFile);
        const t0 = process.hrtime.bigint();
        const out = ask(contextOn(db));
        cold.push(msSince(t0));
        expect(out.exit, 'wide symbol cold').toBe(0);
        db.close();
      }
      const db = store.openReader(dbFile);
      const rc = contextOn(db);
      const first = ask(rc);
      const warm: number[] = [];
      for (let i = 0; i < RUNS; i += 1) { const t0 = process.hrtime.bigint(); ask(rc); warm.push(msSince(t0)); }
      db.close();
      const load1 = os.loadavg()[0]!;
      wideResults.push({
        cell: `symbol over ${SPAN165} basenames, ordered`, refs: wideRefs, graphBytes: wideBytes, graphNodes: SPAN165, total: first.total,
        selectCounts: [...new Set(executed)], expectedSelects: SPAN165 + 1,
        cold: { p50: r2(pct(cold, 50)), p95: r2(pct(cold, 95)), max: r2(Math.max(...cold)) },
        warm: { p50: r2(pct(warm, 50)), p95: r2(pct(warm, 95)), max: r2(Math.max(...warm)) },
        loadBefore: r2(load0), loadAfter: r2(load1),
      });
      console.log(`wide symbol cell: ${JSON.stringify(wideResults[0])}`);
      fs.rmSync(path.join(root, 'graphify-out'), { recursive: true, force: true });
      const d = store.openWriter(dbFile);
      d.exec("DELETE FROM node_refs WHERE value LIKE 'bench165/%'");
      d.close();
    }

    // ── Review 1822: the reduced-cache cell, peak RSS of one `touched` symbol call in a child process, one graph against three distinct ones ──
    // Each root's graph.json is its own file of about 19 MB (at most 20 MB), with the symbol's label on three files of its own, so the
    // reduced cache has a parsed graph to release before the next root's parse. The child reads `process.resourceUsage().maxRSS`.
    const rssResults: Array<Record<string, unknown>> = [];
    {
      const rssDir = mkTmp('ccrc-hist-touched-rss-');
      onTestFinished(() => { fs.rmSync(rssDir, { recursive: true, force: true }); });
      const RSS_NODES = 56_000;
      const RSS_LINKS = 110_000;
      const rssRoots: string[] = [root];
      for (let k = 1; k < 3; k += 1) { const d = path.join(rssDir, `root${k}`); fs.mkdirSync(d, { recursive: true }); rssRoots.push(d); }
      const graphInfo: Array<{ bytes: number; nodes: number; links: number }> = [];
      rssRoots.forEach((d, k) => {
        const gdir = path.join(d, 'graphify-out');
        fs.rmSync(gdir, { recursive: true, force: true });
        fs.mkdirSync(gdir, { recursive: true });
        const fd = fs.openSync(path.join(gdir, 'graph.json'), 'w');
        let buf = '{"nodes":[';
        for (let i = 0; i < RSS_NODES; i += 1) {
          const file = i < 3 ? `rss${k}/d${i}/r${k}f${i}.ts` : `src/g${k}pkg${i % 400}/mod${i % 30_000}.ts`;
          buf += `${i === 0 ? '' : ','}{"id":"g${k}n${i}","label":"${i < 3 ? QSYM : `sym${k}x${i}`}","source_file":"${file}","file_type":"code","source_location":"L${i % 900}"}`;
          if (buf.length > 1 << 20) { fs.writeSync(fd, buf); buf = ''; }
        }
        buf += '],"links":[';
        for (let i = 0; i < RSS_LINKS; i += 1) {
          buf += `${i === 0 ? '' : ','}{"source":"g${k}n${(i * 7) % RSS_NODES}","target":"g${k}n${(i * 13 + 1) % RSS_NODES}","relation":"calls","confidence":"EXTRACTED"}`;
          if (buf.length > 1 << 20) { fs.writeSync(fd, buf); buf = ''; }
        }
        buf += ']}';
        fs.writeSync(fd, buf);
        fs.closeSync(fd);
        const bytes = fs.statSync(path.join(gdir, 'graph.json')).size;
        expect(bytes, `graph ${k} is at most 20 MB`).toBeLessThanOrEqual(20 * 1024 * 1024);
        graphInfo.push({ bytes, nodes: RSS_NODES, links: RSS_LINKS });
      });
      const w = store.openWriter(dbFile);
      const insE = w.prepare('INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, started_ms, cwd, cwd_real, confirmed_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const extraSeqs = [1, 2].map((j) => Number(ep.seq) + 100 + j);
      extraSeqs.forEach((seq, j) => insE.run(fam.session_pk, seq, `c0000000-0000-4000-8000-${String(j).padStart(12, '0')}`, 'clear', 'fixture', 1, rssRoots[j + 1]!, rssRoots[j + 1]!, 1));
      w.close();
      const childFile = path.join(rssDir, 'child.mjs');
      fs.writeFileSync(childFile, `
import { DatabaseSync } from 'node:sqlite';
const [storeUrl, recallUrl, libUrl, dbFile, id, gen, home, tpk, only] = process.argv.slice(2);
const store = await import(storeUrl); const R = await import(recallUrl); const lib = await import(libUrl);
const db = store.openReader(dbFile);
const version = store.userVersion(db);
let fams = db.prepare('SELECT session_pk, ccrc_id, generation, first_seen_ms FROM sessions WHERE ccrc_id = ? AND merged_into IS NULL ORDER BY session_pk').all(id);
const sessionPks = fams.map((f) => Number(f.session_pk));
const storeId = db.prepare("SELECT v FROM meta WHERE k = 'store_id'").get()?.v ?? null;
const rc = { db, version, storeId, nowMs: Date.now(), home, id, gen, scopeArgs: [], pairIdx: lib.makePairIndex([]),
  scope: { kind: 'family', id, generation: gen, project: 'demo', workdir: null, sessionPks, transcriptPks: [Number(tpk)],
    families: fams.map((f) => ({ sessionPk: Number(f.session_pk), ccrcId: f.ccrc_id, generation: f.generation, firstSeenMs: Number(f.first_seen_ms) })) } };
const t0 = Date.now();
const out = R.runTouched(rc, { arg: ${JSON.stringify(QSYM)}, limit: 20, ordered: true });
console.log(JSON.stringify({ maxRssKB: process.resourceUsage().maxRSS, ms: Date.now() - t0, exit: out.exit, total: out.total, items: out.items.length }));
`);
      const url = (rel: string): string => new URL(rel, import.meta.url).href;
      const runChild = (): { maxRssKB: number; ms: number; exit: number; total: number; items: number } => JSON.parse(execFileSync(process.execPath, [childFile, url('../../ccd/history/store.mjs'), url('../../ccd/history/recall.mjs'), url('../../ccd/history/lib.mjs'), dbFile, ID, G1, box.home, String(tr.transcript_pk), 'x'], { encoding: 'utf8', timeout: 120_000 }).trim().split('\n').pop()!);
      const rss = (name: string, hideExtra: boolean): void => {
        const w2 = store.openWriter(dbFile);
        w2.prepare('UPDATE epochs SET confirmed_ms = ? WHERE session_pk = ? AND seq IN (?, ?)').run(hideExtra ? null : 1, fam.session_pk, extraSeqs[0]!, extraSeqs[1]!);
        w2.close();
        const runs = [runChild(), runChild(), runChild()];
        rssResults.push({ cell: name, roots: hideExtra ? 1 : 3, graphs: hideExtra ? [graphInfo[0]] : graphInfo, runs, peakRssMB: runs.map((r) => Math.round(r.maxRssKB / 1024)) });
      };
      // baseline: one root with no graph at all
      const keep = path.join(root, 'graphify-out');
      fs.renameSync(keep, `${keep}.off`);
      rss('baseline: 1 root, no graph', true);
      fs.renameSync(`${keep}.off`, keep);
      rss('(i) 1 root, one graph', true);
      rss('(ii) 3 roots, 3 distinct graphs', false);
      console.log(`rss cells: ${JSON.stringify(rssResults)}`);
      const d2 = store.openWriter(dbFile);
      d2.prepare('DELETE FROM epochs WHERE session_pk = ? AND seq IN (?, ?)').run(fam.session_pk, extraSeqs[0]!, extraSeqs[1]!);
      d2.close();
      fs.rmSync(keep, { recursive: true, force: true });
    }

    const shapes = [
      { name: 'path', arg: QFILE, graph: false },
      { name: 'symbol with graph', arg: QSYM, graph: true },
      { name: 'symbol without graph', arg: QSYM, graph: false },
      // Beyond the measured size, for the worst case of the cut: 11,000 more path refs (79,456 rows in all) on one basename.
      { name: 'path, capped (+11000 rows)', arg: 'src/hot5/index.ts', graph: false },
    ] as const;
    const ms = (t0: bigint): number => Number(process.hrtime.bigint() - t0) / 1e6;
    const results: Array<Record<string, unknown>> = [];
    const answers = new Map<string, string[]>();
    for (const shape of shapes) {
      if (shape.name.startsWith('path, capped')) {
        const w = store.openWriter(dbFile);
        const ins = w.prepare('INSERT INTO node_refs (node_id, kind, value, origin) VALUES (?, ?, ?, ?)');
        w.exec('BEGIN');
        for (let i = 0; i < 11_000; i += 1) ins.run(nodeIds[i % nodeIds.length]!, 'path', `src/hot${i}/index.ts`, 'tool_use');
        w.exec('COMMIT');
        w.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        w.close();
      }
      writeGraph(shape.graph);
      for (const form of ['unordered', 'ordered'] as const) {
        const ordered = form === 'ordered';
        const ask = (rc: unknown) => R.runTouched(rc, { arg: shape.arg, limit: 20, ordered });
        const cold: number[] = [];
        for (let i = 0; i < RUNS; i += 1) {
          const db = store.openReader(dbFile);
          const t0 = process.hrtime.bigint();
          const out = ask(contextOn(db));
          cold.push(ms(t0));
          expect(out.exit, `${shape.name} ${form}`).toBe(0);
          db.close();
        }
        const db = store.openReader(dbFile);
        const rc = contextOn(db);
        const first = ask(rc);
        answers.set(`${shape.name}/${form}`, first.items.map((it) => String(it['nodeId'])));
        const warm: number[] = [];
        for (let i = 0; i < RUNS; i += 1) { const t0 = process.hrtime.bigint(); ask(rc); warm.push(ms(t0)); }
        // the select alone: the rows each candidate select returns, and its time warm
        const sels = shape.name.startsWith('path') ? [[ordered ? R.TOUCHED_SELECTS.fileOrdered : R.TOUCHED_SELECTS.file, shape.arg.endsWith('index.ts') ? '%index.ts%' : '%recall.mjs%']]
          : [[ordered ? R.TOUCHED_SELECTS.symbolOrdered : R.TOUCHED_SELECTS.symbol, `%:${QSYM}`],
            ...(shape.graph ? ['recall.mjs', 'cli.mjs', 'history-touched.test.ts'].map((b) => [ordered ? R.TOUCHED_SELECTS.fileOrdered : R.TOUCHED_SELECTS.file, `%${b}%`]) : [])];
        const selWarm: number[] = [];
        let candidateRows = 0;
        for (let i = 0; i < RUNS; i += 1) {
          const t0 = process.hrtime.bigint();
          let n = 0;
          for (const [sql, pat] of sels as string[][]) n += (db.prepare(sql!).all(pat!, 10_001) as unknown[]).length;
          selWarm.push(ms(t0));
          candidateRows = n;
        }
        const plans = (sels as string[][]).map(([sql, pat]) => ({ pattern: pat, plan: (db.prepare(`EXPLAIN QUERY PLAN ${sql!.replace('LIMIT ?', 'LIMIT 10001')}`).all(pat!) as Array<{ detail: string }>).map((p) => p.detail) }));
        db.close();
        results.push({
          shape: shape.name, form, total: first.total, candidateRows,
          cold: { p50: r2(pct(cold, 50)), p95: r2(pct(cold, 95)), max: r2(Math.max(...cold)) },
          warm: { p50: r2(pct(warm, 50)), p95: r2(pct(warm, 95)), max: r2(Math.max(...warm)) },
          selectsWarm: { p50: r2(pct(selWarm, 50)), p95: r2(pct(selWarm, 95)) }, plans,
        });
      }
    }
    // ── the graph cells (final fix wave): a realistic graph, and a project scope whose roots link one graph file ──
    const BIG_NODES = Number(process.env['HISTORY_BENCH_GRAPH_NODES'] ?? 320_000);
    const BIG_LINKS = Number(process.env['HISTORY_BENCH_GRAPH_LINKS'] ?? 480_000);
    const bigDir = mkTmp('ccrc-hist-touched-biggraph-');
    // The case's own teardown: the 78 MB graph, the fixture store and the roots go with it, not with the file's end (all under the temp root).
    onTestFinished(() => { for (const d of [bigDir, box.home, root]) fs.rmSync(d, { recursive: true, force: true }); });
    const bigFile = path.join(bigDir, 'graph.json');
    {
      const fd = fs.openSync(bigFile, 'w');
      const SPAN_FILES = 150;   // the symbol's label sits on 150 files, each with its own basename
      let buf = '{"nodes":[';
      const flush = (): void => { fs.writeSync(fd, buf); buf = ''; };
      for (let i = 0; i < BIG_NODES; i += 1) {
        const file = i < SPAN_FILES ? `bench/d${i}/f${i}.ts` : `src/pkg${i % 400}/mod${i % 30_000}.ts`;
        buf += `${i === 0 ? '' : ','}{"id":"n${i}","label":"${i < SPAN_FILES ? QSYM : `sym${i % 90_000}`}","source_file":"${file}","file_type":"code","source_location":"L${i % 900}"}`;
        if (buf.length > 1 << 20) flush();
      }
      buf += '],"links":[';
      for (let i = 0; i < BIG_LINKS; i += 1) {
        buf += `${i === 0 ? '' : ','}{"source":"n${(i * 7) % BIG_NODES}","target":"n${(i * 13 + 1) % BIG_NODES}","relation":"calls","confidence":"EXTRACTED"}`;
        if (buf.length > 1 << 20) flush();
      }
      buf += ']}';
      flush();
      fs.closeSync(fd);
    }
    const graphBytes = fs.statSync(bigFile).size;
    {
      const w = store.openWriter(dbFile);
      const ins = w.prepare('INSERT OR IGNORE INTO node_refs (node_id, kind, value, origin) VALUES (?, ?, ?, ?)');
      w.exec('BEGIN');
      for (let i = 0; i < 150; i += 1) for (let k = 0; k < 2; k += 1) ins.run(nodeIds[(i * 37 + k) % nodeIds.length]!, 'path', `bench/d${i}/f${i}.ts`, 'tool_use');
      w.exec('COMMIT');
      w.close();
    }
    const graphCells: Array<Record<string, unknown>> = [];
    const cell = (name: string, arg: string): void => {
      for (const form of ['unordered', 'ordered'] as const) {
        const ask = (rc: unknown) => R.runTouched(rc, { arg, limit: 20, ordered: form === 'ordered' });
        let peakRss = 0;
        const note = (): void => { peakRss = Math.max(peakRss, process.memoryUsage().rss); };
        const cold: number[] = [];
        for (let i = 0; i < RUNS; i += 1) {
          const db = store.openReader(dbFile);
          const t0 = process.hrtime.bigint();
          const out = ask(contextOn(db));
          cold.push(ms(t0));
          note();
          expect(out.exit, `${name} ${form}`).toBe(0);
          db.close();
        }
        const db = store.openReader(dbFile);
        const rc = contextOn(db);
        const first = ask(rc);
        const warm: number[] = [];
        for (let i = 0; i < RUNS; i += 1) { const t0 = process.hrtime.bigint(); ask(rc); warm.push(ms(t0)); note(); }
        db.close();
        graphCells.push({
          cell: name, form, total: first.total, graphBytes,
          cold: { p50: r2(pct(cold, 50)), p95: r2(pct(cold, 95)), max: r2(Math.max(...cold)) },
          warm: { p50: r2(pct(warm, 50)), p95: r2(pct(warm, 95)), max: r2(Math.max(...warm)) },
          peakRssMB: Math.round(peakRss / 1048576), heapUsedMBAfter: Math.round(process.memoryUsage().heapUsed / 1048576),
        });
      }
    };
    fs.rmSync(path.join(root, 'graphify-out'), { recursive: true, force: true });
    fs.mkdirSync(path.join(root, 'graphify-out'), { recursive: true });
    fs.symlinkSync(bigFile, path.join(root, 'graphify-out', 'graph.json'));
    cell('(a) one root, graph of 78 MB, symbol over 150 basenames', QSYM);
    {
      // (b) a project scope: 20 roots, each a worktree whose graph.json links the one file
      const extra: string[] = [];
      onTestFinished(() => { for (const d of extra) fs.rmSync(d, { recursive: true, force: true }); });   // the 19 worktree roots go with the case
      for (let i = 0; i < 19; i += 1) {
        const d = path.join(mkTmp('ccrc-hist-touched-wt-'));
        fs.mkdirSync(path.join(d, 'graphify-out'), { recursive: true });
        fs.symlinkSync(bigFile, path.join(d, 'graphify-out', 'graph.json'));
        extra.push(d);
      }
      const w = store.openWriter(dbFile);
      const insE = w.prepare('INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, started_ms, cwd, cwd_real, confirmed_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      extra.forEach((d, i) => insE.run(fam.session_pk, Number(ep.seq) + 1 + i, `b0000000-0000-4000-8000-${String(i).padStart(12, '0')}`, 'clear', 'fixture', 1, d, d, 1));
      w.close();
      cell('(b) 20 roots linking one 78 MB graph, symbol over 150 basenames', QSYM);
      cell('(b) 20 roots linking one 78 MB graph, path query', QFILE);
    }
    const gcRows = graphCells.map((c) => {
      const k = c['cold'] as { p50: number; p95: number }; const w = c['warm'] as { p50: number; p95: number };
      return `${String(c['cell']).slice(0, 62).padEnd(62)} ${String(c['form']).padEnd(9)} total=${String(c['total']).padStart(4)}  cold p50 ${k.p50} p95 ${k.p95}  warm p50 ${w.p50} p95 ${w.p95}  rss ${String(c['peakRssMB'])} MB`;
    });
    console.log(`graph ${graphBytes} bytes\n${gcRows.join('\n')}`);
    // the ordered form answers the same rows as the unordered while nothing is capped
    for (const shape of shapes.slice(0, 3)) expect(answers.get(`${shape.name}/ordered`), shape.name).toEqual(answers.get(`${shape.name}/unordered`));
    const out = process.env['HISTORY_BENCH_OUT'] ?? path.join(path.dirname(root), 'touched-bench.json');   // the run's temp root goes with the run: name a path to keep the figures
    fs.writeFileSync(out, JSON.stringify({ fixtureBytes: bytes, counts, planted, runs: RUNS, results, graphBytes, graphCells, wideResults, rssResults }, null, 2));
    const rows = results.map((r) => {
      const c = r['cold'] as { p50: number; p95: number }; const w = r['warm'] as { p50: number; p95: number };
      return `${String(r['shape']).padEnd(22)} ${String(r['form']).padEnd(9)} cand=${String(r['candidateRows']).padStart(4)} total=${String(r['total']).padStart(4)}  cold p50 ${c.p50} p95 ${c.p95}  warm p50 ${w.p50} p95 ${w.p95}`;
    });
    fs.writeFileSync(`${out}.txt`, `${rows.join('\n')}\ngraph ${graphBytes} bytes\n${gcRows.join('\n')}\n`);
    console.log(`touched bench: fixture ${bytes} bytes, ${counts.node_refs} node_refs, ${counts.nodes} nodes\n${rows.join('\n')}`);
  }, 1_800_000);
});


// ── The final fix wave: a project scope's many roots, and the graph cache (W4-4 whole-branch review) ──────────────────────
// A family with many confirmed epochs of distinct launch directories (what --project widens to) answers an empty query with one
// header per distinct graph state, inside the 20,000-character cap; a graph file linked from several roots is loaded once; a graph
// is loaded only for a root that needs it. Each case builds its own fixture family, in a store of its own.
describe.skipIf(process.platform === 'darwin')('touched, project scope and the graph cache (final fix wave)', () => {
  const FID = 'lane-a-demo';
  const FTA = 'a1a1a1a1-1111-4111-8111-111111111111';
  const FG1 = '0189abcd-1234-4678-9abc-0123456789ab';
  const HEAVY = 240_000;

  type Fx = { box: HistoryBox; root: string; dbFile: string; sessionPk: number; seq: number; tpk: number };
  function fixtureFamily(prefix: string): Fx {
    const root = mkTmp(`${prefix}root-`);
    const box = makeHistoryBox(prefix, { roster: LANE_ROSTER });
    const sw = runSweep(box);
    expect(sw.code, sw.stderr).toBe(0);
    const at = (s: number): string => new Date(Date.UTC(2026, 9, 1, 0, 0, s)).toISOString();
    seedFamily(box, { id: FID, project: 'demo', uuid: FTA, generation: FG1, rows: [
      userRow({ uuid: `${FTA.slice(0, 8)}-0000-4000-8000-000000000001`, ts: at(1), sessionId: FTA, cwd: root, text: 'fixture question' }),
      assistantRow({ uuid: `${FTA.slice(0, 8)}-0000-4000-8000-000000000002`, ts: at(2), sessionId: FTA, cwd: root, text: 'Fixture answer.', requestId: 'req_1', msgId: 'msg_1' }),
    ] });
    const dbFile = path.join(box.root, 'db', 'history.db');
    const db = new DatabaseSync(dbFile);
    try {
      const fam = db.prepare('SELECT session_pk FROM sessions WHERE ccrc_id = ? AND generation = ?').get(FID, FG1) as { session_pk: number };
      const ep = db.prepare('SELECT seq FROM epochs WHERE session_pk = ? AND confirmed_ms IS NOT NULL ORDER BY seq LIMIT 1').get(fam.session_pk) as { seq: number };
      const tr = db.prepare("SELECT transcript_pk FROM transcripts WHERE cc_session_uuid = ? AND agent_id = ''").get(FTA) as { transcript_pk: number };
      db.prepare('UPDATE epochs SET cwd = ?, cwd_real = ? WHERE session_pk = ?').run(root, root, fam.session_pk);
      return { box, root, dbFile, sessionPk: Number(fam.session_pk), seq: Number(ep.seq), tpk: Number(tr.transcript_pk) };
    } finally { db.close(); }
  }
  /** One more confirmed epoch of the family per directory, each with its own launch directory; the new epochs' seqs. */
  function addEpochs(fx: Fx, dirs: string[]): number[] {
    const db = new DatabaseSync(fx.dbFile);
    try {
      const ins = db.prepare('INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, started_ms, cwd, cwd_real, confirmed_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const seqs: number[] = [];
      db.exec('BEGIN');
      dirs.forEach((d, i) => {
        const seq = fx.seq + 1 + i;
        ins.run(fx.sessionPk, seq, `b0000000-0000-4000-8000-${String(i).padStart(12, '0')}`, 'clear', 'fixture', 1, d, d, 1);
        seqs.push(seq);
      });
      db.exec('COMMIT');
      return seqs;
    } finally { db.close(); }
  }
  function addNode(fx: Fx, id: string, epoch: number, refs: Array<[string, string]>): void {
    const db = new DatabaseSync(fx.dbFile);
    try {
      db.prepare(`INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, gist, topics, summary_blob_id, boundary_entry_id,
        span_start_uuid, earliest_ms, latest_ms, src_chars, desc_count, desc_chars, directive_flag, capped, parser_version, created_ms)
        VALUES (?, ?, ?, ?, 'native_leaf', 0, 'fixture', 'A gist.', NULL, NULL, NULL, NULL, 1000, 2000, 0, 0, 0, 0, 0, 1, 3000)`).run(id, fx.sessionPk, epoch, fx.tpk);
      const ins = db.prepare("INSERT INTO node_refs (node_id, kind, value, origin) VALUES (?, ?, ?, 'tool_use')");
      for (const [k, v] of refs) ins.run(id, k, v);
    } finally { db.close(); }
  }
  const graphJson = (nodes: Array<{ label: string; file: string }>): string => JSON.stringify({
    nodes: nodes.map((n, i) => ({ id: `g${i}`, label: n.label, source_file: n.file })), links: [],
  });
  function putGraph(dir: string, content: string | { linkTo: string }): void {
    fs.mkdirSync(path.join(dir, 'graphify-out'), { recursive: true });
    const g = path.join(dir, 'graphify-out', 'graph.json');
    if (typeof content === 'string') fs.writeFileSync(g, content);
    else fs.symlinkSync(content.linkTo, g);
  }
  function contextOn(fx: Fx, db: DatabaseSync) {
    const fams = db.prepare('SELECT session_pk, ccrc_id, generation, first_seen_ms FROM sessions WHERE ccrc_id = ? AND merged_into IS NULL').all(FID) as
      { session_pk: number; ccrc_id: string; generation: string; first_seen_ms: number }[];
    return {
      db, version: storeLib.userVersion(db), schema: undefined, storeId: null, nowMs: Date.now(), home: fx.box.home, id: FID, gen: FG1, scopeArgs: [],
      pairIdx: makePairIndex([]),
      scope: { kind: 'project', id: FID, generation: FG1, project: 'demo', workdir: null, sessionPks: [fx.sessionPk], transcriptPks: [fx.tpk],
        families: fams.map((f) => ({ sessionPk: Number(f.session_pk), ccrcId: f.ccrc_id, generation: f.generation, firstSeenMs: Number(f.first_seen_ms) })) },
    };
  }
  const touchedIn = (fx: Fx, a: { arg: string; limit: number; loadGraph?: (p: string, m: number) => unknown; graphCache?: Map<string, unknown> }) => {
    const db = storeLib.openReader(fx.dbFile) as unknown as DatabaseSync;
    try {
      const rc = contextOn(fx, db);
      return (recallLib as unknown as { runTouched(rc: unknown, a: unknown): { exit: number; total: number; blocks: string[] } }).runTouched(rc, a);
    } finally { db.close(); }
  };

  it('an empty answer under --project (about 600 roots) prints one header per distinct graph state and stays within the 20,000-character cap', () => {
    const fx = fixtureFamily('ccrc-hist-touched-wide-');
    putGraph(fx.root, graphJson([{ label: 'x', file: 'ccd/other.mjs' }]));
    addEpochs(fx, Array.from({ length: 599 }, (_, i) => path.join(fx.root, `wt-${i}`, 'a-fairly-long-worktree-directory-name')));
    const r = runCli(fx.box, ['touched', 'ccd/none.mjs', '--project'], { env: withPane(fx.box, FID) });
    expect(r.code, `${r.stderr}${r.stdout.slice(0, 400)}`).toBe(3);
    expect(r.stdout.length).toBeLessThanOrEqual(20_000);
    const heads = r.stdout.split('\n').filter((l) => l.startsWith('touched '));
    expect(heads.sort(), 'one `graph` line and one `no graph` line, never one per root').toEqual(['touched ccd/none.mjs (graph)', 'touched ccd/none.mjs (no graph)']);
    const j = runCli(fx.box, ['touched', 'ccd/none.mjs', '--project', '--json'], { env: withPane(fx.box, FID) });
    expect(j.stdout.length).toBeLessThanOrEqual(20_000);
  }, HEAVY);

  it('a graph file linked from several roots is loaded once (cached by its real path), and a root no row needs loads none', () => {
    const fx = fixtureFamily('ccrc-hist-touched-gcache-');
    const shared = path.join(mkTmp('ccrc-hist-touched-gshared-'), 'g.json');
    fs.writeFileSync(shared, graphJson([{ label: 'cacheSym', file: 'ccd/cache.mjs' }]));
    const r2 = mkTmp('ccrc-hist-touched-gr2-');
    const r3 = mkTmp('ccrc-hist-touched-gr3-');
    const r4 = mkTmp('ccrc-hist-touched-gr4-');
    putGraph(fx.root, { linkTo: shared });
    putGraph(r2, { linkTo: shared });
    putGraph(r3, graphJson([{ label: 'cacheSym', file: 'ccd/cache.mjs' }]));   // a copy: its own real path, so its own load
    putGraph(r4, graphJson([{ label: 'cacheSym', file: 'ccd/cache4.mjs' }]));
    const seqs = addEpochs(fx, [r2, r3, r4]);
    const calls: string[] = [];
    const counting = (p: string, m: number) => { calls.push(p); return loadGraph(p, m); };
    // A symbol query reads every root's graph for its label: three real files, four roots.
    touchedIn(fx, { arg: 'cacheSym', limit: 20, loadGraph: counting });
    expect(calls.length, calls.join(' ')).toBe(3);
    expect(new Set(calls).size).toBe(3);
    // A path query whose one ref matches exactly loads only the graph its header names: the root of the one row, never the others'.
    addNode(fx, 'Lcl0001', seqs[2]!, [['path', 'ccd/lazy.mjs']]);
    calls.length = 0;
    const out = touchedIn(fx, { arg: 'ccd/lazy.mjs', limit: 20, loadGraph: counting });
    expect(out.total).toBe(1);
    expect(calls.length, calls.join(' ')).toBe(1);
  }, HEAVY);

  it('the real-path graph cache holds only the reduced graph: no nodes, links, byFile or degree, for a symbol query and a path query', () => {
    const fx = fixtureFamily('ccrc-hist-touched-reduced-');
    const r2 = mkTmp('ccrc-hist-touched-red2-');
    const r3 = mkTmp('ccrc-hist-touched-red3-');
    putGraph(fx.root, graphJson([{ label: 'redSym', file: 'ccd/red1.mjs' }, { label: 'other', file: 'ccd/other1.mjs' }]));
    putGraph(r2, graphJson([{ label: 'redSym', file: 'ccd/red2.mjs' }, { label: 'other', file: 'ccd/other2.mjs' }]));
    putGraph(r3, graphJson([{ label: 'nothing', file: 'ccd/red3.mjs' }]));
    const seqs = addEpochs(fx, [r2, r3]);
    addNode(fx, 'Lrd0001', fx.seq, [['path', 'ccd/red1.mjs']]);
    addNode(fx, 'Lrd0002', seqs[0]!, [['path', 'ccd/red2.mjs']]);
    const check = (cache: Map<string, unknown>, labelFiles: string[][]): void => {
      expect(cache.size, 'three distinct graph files were read').toBe(3);
      const held = [...cache.values()] as Array<Record<string, unknown> | null>;
      for (const g of held) {
        expect(g).not.toBeNull();
        for (const heavy of ['nodes', 'links', 'byFile', 'degree']) expect(g, `the cache holds a parsed graph's ${heavy}`).not.toHaveProperty(heavy);
        expect(Array.isArray(g!['labelFiles'])).toBe(true);
      }
      expect(held.map((g) => g!['labelFiles']).sort()).toEqual(labelFiles.sort());
    };
    const symCache = new Map<string, unknown>();
    const sym = touchedIn(fx, { arg: 'redSym', limit: 20, graphCache: symCache });
    expect(sym.total, 'the reduced graph answers the same rows').toBe(2);
    check(symCache, [['ccd/red1.mjs'], ['ccd/red2.mjs'], []]);
    const pathCache = new Map<string, unknown>();
    const byPath = touchedIn(fx, { arg: 'ccd/red1.mjs', limit: 20, graphCache: pathCache });
    expect(byPath.total).toBe(1);
    expect(pathCache.size, 'a path query reads only the graph its one row names').toBe(1);
    for (const g of pathCache.values()) {
      for (const heavy of ['nodes', 'links', 'byFile', 'degree']) expect(g, heavy).not.toHaveProperty(heavy);
      expect((g as { labelFiles: string[] }).labelFiles, 'a path query keeps no label files').toEqual([]);
    }
  }, HEAVY);
});
