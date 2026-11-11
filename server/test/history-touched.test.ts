// server/test/history-touched.test.ts
// `ccrc history touched`'s pure deciders (W4 addendum P8, Task 4A): `ccd/history/lib.mjs`, imported directly like
// history-lib.test.ts. Pure: the one database is an in-memory node:sqlite table that runs the spec's file select
// (section 3.5 step 1) for Review Focus 4. Nothing here touches a HOME or a live store.
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
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

/** Section 3.5 step 1's file select, verbatim, then the matching; the files that come back as exact. */
function matchedFiles(db: DatabaseSync, file: string): string[] {
  const base = file.slice(file.lastIndexOf('/') + 1);
  const rows = db.prepare(
    "SELECT node_id, kind, value, origin FROM node_refs WHERE kind IN ('path','path:symbol','test') AND value LIKE ? ESCAPE '\\'",
  ).all(`%${likeEscape(base)}%`) as { node_id: string; kind: string; value: string; origin: string }[];
  return rows
    .map((r) => splitStoredRef(r.kind, r.value).path)
    .filter((p) => matchRef({ path: p, outside: false }, file, null) === 'exact');
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

  it('TC3 ranking: newest first, a tie by node id, a missing time last', () => {
    const rows = [
      { nodeId: 'n-b', latestMs: 200 },
      { nodeId: 'n-z', latestMs: 300 },
      { nodeId: 'n-a', latestMs: 200 },
      { nodeId: 'n-x', latestMs: 100 },
      { nodeId: 'n-n', latestMs: null },
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
    expect(likeEscape('foo_bar.ts')).toBe('foo\\_bar.ts');
    expect(likeEscape('a%b\\c')).toBe('a\\%b\\\\c');
    expect(matchedFiles(db, 'src/foo_bar.ts')).toEqual(['src/foo_bar.ts']);   // a stored src/fooXbar.ts is not a candidate
    db.close();
  });
});
