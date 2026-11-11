// server/test/history-touched.test.ts
// `ccrc history touched`'s pure deciders (W4 addendum P8, Task 4A): `ccd/history/lib.mjs`, imported directly like
// history-lib.test.ts. Pure: the one database is an in-memory node:sqlite table that runs the spec's file select
// (section 3.5 step 1) for Review Focus 4. Nothing here touches a HOME or a live store.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { makeHistoryBox, runSweep, runCli, withPane, seedFamily, type HistoryBox } from './historyHelpers.js';
import { userRow, assistantRow, boundaryRow, summaryRow, type Row } from './historyFixtures.js';
import { LANE_ROSTER } from './historyAgentFixtures.js';
import { mkTmp } from './tmpHelpers.js';
import { GRAPH_MAX_BYTES } from '../../ccd/compact-card.mjs';
import {
  READ_VERBS, READ_OPTIONS, parseReadArgs,
  touchedQuery, likeEscape, splitStoredRef, normaliseRefPath, symbolMatches, matchRef, rankTouched, touchedRows,
  TOUCHED_CANDIDATE_MAX, TOUCHED_LIMIT_DEFAULT, TOUCHED_DISCLOSURE, TOUCHED_CAPPED_NOTE,
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
    ['ccd/x.mjs:10-20', { kind: 'path', file: 'ccd/x.mjs' }],
    ['x.mjs:7', { kind: 'path', file: 'x.mjs' }],
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

  it('R3 an absolute query is matched by no relative ref, with or without a graph', () => {
    const rel = { path: 'x/y.mjs', outside: false };
    expect(matchRef(rel, '/elsewhere/x/y.mjs', null)).toBeNull();
    expect(matchRef(rel, '/elsewhere/x/y.mjs', graphOf(['/elsewhere/x/y.mjs']))).toBeNull();
    expect(matchRef({ path: '/elsewhere/x/y.mjs', outside: true }, '/elsewhere/x/y.mjs', null)).toBe('outside');
  });

  it('TC12 line suffix is kept as the line, not in the path', () => {
    expect(splitStoredRef('path', 'ccd/x.mjs:10-20')).toEqual({ path: 'ccd/x.mjs', line: '10-20', symbol: null });
    expect(splitStoredRef('path', 'ccd/x.mjs:7')).toEqual({ path: 'ccd/x.mjs', line: '7', symbol: null });
    const rows = run([{ nodeId: 'n1', kind: 'path', value: 'ccd/x.mjs:10-20', origin: 'tool_use' }], 'ccd/x.mjs', [], null);
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
    // a graph that lacks the file loses the suffix match (Ruling R8)
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
  function plant(id: string, o: { latest?: number; gist?: string | null; refs?: Array<[string, string, string?]>; tpk?: number; boundary?: number } = {}): string {
    nodeSeq += 1;
    const latest = o.latest ?? T0 + nodeSeq * 1000;
    withDb((db) => {
      db.prepare(`INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, gist, topics,
        summary_blob_id, boundary_entry_id, span_start_uuid, earliest_ms, latest_ms, src_chars, desc_count, desc_chars,
        directive_flag, capped, parser_version, created_ms)
        VALUES (?, ?, ?, ?, 'native_leaf', 0, 'fixture', ?, NULL, NULL, ?, NULL, ?, ?, 0, 0, 0, 0, 0, 1, ?)`)
        .run(id, ids.session_pk, ids.seq, o.tpk ?? ids.tpk, o.gist === undefined ? `Gist of ${id}. Second sentence.` : o.gist, o.boundary ?? null, latest - 500, latest, Date.now());
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
    expect(r.stdout).toContain(TOUCHED_CAPPED_NOTE);
    const j = touchedJson(['tc16foo']);
    expect(j.json?.['candidatesCapped']).toBe(true);
    expect(j.json?.['candidatesCappedNote']).toBe(TOUCHED_CAPPED_NOTE);
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

  it('TC23 symbol candidates capped (P8, P13): no graph and 10,001 path:symbol refs naming the symbol print the cap line', () => {
    const refs: Array<[string, string]> = [];
    for (let i = 0; i <= TOUCHED_CANDIDATE_MAX; i += 1) refs.push(['path:symbol', `cap/t${i}.mjs:tc23foo`]);
    plant('Lt23n1', { refs });
    const r = touched(['tc23foo']);
    expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
    expect(r.stdout).toContain(TOUCHED_CAPPED_NOTE);
    expect(touchedJson(['tc23foo']).json?.['candidatesCapped']).toBe(true);
  }, HEAVY);

  it.todo('TC20 the ordered cap (P13): held until Task 4C\'s p95 measurement settles it');
  it.todo('TC23 order: under the ordered cap the newest of 10,001 symbol candidates is listed first (held with TC20)');

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

  it('a graph with no nodes answers as no graph (R11, failure row 28)', () => {
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
    plant('Lt99n1', { latest: T0 + 70_000, gist: 'Fixed the parser. It was slow.', refs: [['path', 'ccd/tc99.mjs:10-20'], ['test', `${root}/ccd/tc99.mjs`, 'model']] });
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
