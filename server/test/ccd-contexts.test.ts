// D-6054 (ARCH-34, #536): ccd's function-to-context manifest.
//
// `ccd/ccd` is one bash file of some 40k lines, and nothing recorded which bounded context each of its functions
// belongs to. `ccd/contexts.tsv` does: one row per function, naming one context of the 08-10 spec (C1 to C9, or K
// for the kernels and platform files). This suite holds three things:
//   1. COVERAGE: every `name() {` in `ccd/ccd` has exactly one row, and every row names a function that exists, in
//      a context the spec defines. A new function without a row is red here, in the PR that adds it.
//   2. THE CALL GRAPH: a reference from one function's region to another defined name is an edge
//      (`consolidationCensus.ts`'s `ccdCallGraph`, whose known width is written there). Edges whose ends sit in two
//      contexts are listed by `ccdCrossContextCalls`; a call INTO K is not one (a kernel serves every context).
//   3. THE RATCHET: the cross-context edges are a MANIFEST, `ccd/contexts-edges.tsv`: one sorted
//      `caller -> callee` per line. The computed edge set must be a subset of it, so a NEW edge is red here and its
//      line in the manifest is the diff a reviewer reads (a count would only say "one more"). A removed edge needs no
//      edit: the test warns which manifest lines no longer exist, to be deleted when convenient, so two PRs that
//      each remove an edge never race a number. A function that moves context changes the edges: say why in the PR.
// No byte of `ccd/ccd` changes for any of this: the manifest is data beside it, and no installer reads it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CCD_CONTEXTS, bashCodeOf, ccdLauncherIn, ccdCallGraph, ccdContextRows, ccdCrossContextCalls, ccdFunctionDefinitions,
  ccdHeredocBraces,
} from './consolidationCensus.js';

/** The allowed cross-context edges (D-6925): one `caller -> callee` per line, sorted. */
const EDGES_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ccd', 'contexts-edges.tsv');
const edgeOf = (siteText: string): string => {
  const m = /^(\S+) \(\w+\) -> (\S+) \(\w+\)$/.exec(siteText)!;
  return `${m[1]} -> ${m[2]}`;
};
/** The manifest's edges, from its text: blank lines and `#` comments are skipped. */
const manifestEdges = (text: string): string[] =>
  text.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('#'));
/** Computed edges the manifest does not allow, and manifest edges no longer computed. */
const checkEdges = (computed: readonly string[], manifest: readonly string[]): { extra: string[]; stale: string[] } => {
  const allowed = new Set(manifest); const have = new Set(computed);
  return { extra: [...have].filter((e) => !allowed.has(e)).sort(), stale: [...allowed].filter((e) => !have.has(e)).sort() };
};

const nameOf = (text: string): string => /^([A-Za-z_][A-Za-z0-9_]*)\(/.exec(text)![1]!;

describe('ccd/contexts.tsv: coverage (D-6054)', () => {
  it('CONTROL: every bash function definition in ccd/ccd has the one shape the census reads', () => {
    // A definition in another shape (`function name {`, `function name() {`, an indented `name() {`, `name () {`)
    // would be a function with no row that coverage could not see. awk's `function f(s) {` takes arguments, so
    // it is not bash's, and is not matched.
    const loose = /^\s*(?:function\s+[A-Za-z_][A-Za-z0-9_]*\s*(?:\(\s*\))?\s*\{|[A-Za-z_][A-Za-z0-9_]*\s*\(\s*\)\s*\{)/;
    const strict = new Set(ccdFunctionDefinitions().map((s) => s.line));
    const other = readFileSync(ccdLauncherIn(), 'utf8').split('\n')
      .flatMap((t, i) => (loose.test(bashCodeOf(t)) && !strict.has(i + 1) ? [`line ${i + 1}: ${t.trim()}`] : []));
    expect(other, 'definitions in a shape the manifest census does not read; write them as `name() {` at column 0')
      .toEqual([]);
    expect(strict.size, 'the definition census found too few functions: its pattern has gone stale').toBeGreaterThan(500);
  });

  it('CONTROL: no column-0 `}` sits inside a heredoc body in a function, so no region ends early', () => {
    // A region ends at its first column-0 `}`. One inside a heredoc would end it there, and the calls after it
    // would leave the call graph and so escape the ratchet. Indent the brace, or move the heredoc's text out.
    expect(ccdHeredocBraces().map((s) => `line ${s.line}: ${s.text}`),
      'heredoc lines the call graph would misread as a function\'s end').toEqual([]);
  });

  it('every function ccd/ccd defines has exactly one row, and every row names one that exists', () => {
    const defs = ccdFunctionDefinitions().map((s) => nameOf(s.text));
    expect(new Set(defs).size, 'ccd/ccd defines a function twice').toBe(defs.length);
    const rows = ccdContextRows().map((r) => r.text.split('\t'));
    const malformed = rows.filter((r) => r.length !== 2).map((r) => r.join('\\t'));
    expect(malformed, 'rows are `<name><TAB><context>`').toEqual([]);
    const names = rows.map((r) => r[0]!);
    const dup = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dup, 'a function mapped twice: one function, one context').toEqual([]);
    const mapped = new Set(names);
    expect(defs.filter((n) => !mapped.has(n)),
      'functions ccd/ccd defines with no row in ccd/contexts.tsv: add one, naming its context (see the file header)')
      .toEqual([]);
    const defined = new Set(defs);
    expect(names.filter((n) => !defined.has(n)), 'rows naming a function ccd/ccd does not define: remove them')
      .toEqual([]);
  });

  it('every row names a context the 08-10 spec defines, and the rows run in definition order', () => {
    const allowed = new Set<string>(CCD_CONTEXTS);
    const rows = ccdContextRows().map((r) => r.text.split('\t'));
    expect(rows.filter(([, c]) => !allowed.has(c!)).map((r) => r.join(' ')), `contexts are ${CCD_CONTEXTS.join(', ')}`)
      .toEqual([]);
    // Order is for the reviewer, who reads a function's row beside its neighbours'.
    expect(rows.map((r) => r[0]), 'rows run in the order ccd/ccd defines the functions')
      .toEqual(ccdFunctionDefinitions().map((s) => nameOf(s.text)));
  });
});

describe('ccd call graph: the extraction rules, on a fixture tree (D-6054)', () => {
  let root = '';
  beforeAll(() => {
    // The fixture's functions are named f* with no leading underscore: a test-local `_x() {` in a string reads as an
    // override of a shipped ccd function to the harness-integrity scan (#943), and these are not overrides.
    root = mkdtempSync(path.join(tmpdir(), 'ccd-contexts-'));
    mkdirSync(path.dirname(ccdLauncherIn(root)), { recursive: true });
    writeFileSync(ccdLauncherIn(root), [
      '#!/usr/bin/env bash',
      'fk() { fa; }',
      'fa() {   # calls fb in this comment only',
      '  # fc in a comment line is not a call',
      '  local fb=1',
      '  echo "${fc:-}" "$fb"',
      '  fb; fb; fk',
      '}',
      'TOP=$(fc)',
      'fb() { fc',
      '       fa; }',
      '',
      'X=$(fk)',
      'fc() {',
      '  fk',
      '}',
      'fd() { fa; }',
      'fe() {',
      '  cat <<-EOF',
      '}',
      '\tEOF',
      '  fa',
      '}',
    ].join('\n'));
    writeFileSync(path.join(root, 'ccd', 'contexts.tsv'),
      ['# header', 'fk\tK', 'fa\tC1', 'fb\tC2', 'fc\tC2', 'fd\tC1', 'fe\tC2', ''].join('\n'));
  });
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  it('regions end at a column-0 `}` or the next definition; comments, expansions and assignments are not calls', () => {
    const edges = ccdCallGraph(root).map((e) => `${e.caller}>${e.callee}@${e.line}`);
    // fa: `fb` twice is one edge; the comment lines, `local fb=1`, `${fc` and `$fb` are not calls; TOP's `fc` after
    // `}` is outside every region. fb: a one-liner continued below, so its region runs to the next definition and
    // takes `fa` from the continuation and `fk` from the top-level line between (a known width). fc: `fk` only.
    // fe: the heredoc's column-0 `}` ends its region (the blind spot), so its `fa` is lost; see the next row.
    expect(edges).toEqual(
      ['fk>fa@2', 'fa>fb@7', 'fa>fk@7', 'fb>fc@10', 'fb>fa@11', 'fb>fk@13', 'fc>fk@15', 'fd>fa@17']);
  });

  it('a column-0 `}` inside a heredoc body is listed, and so is a heredoc that never closes', () => {
    expect(ccdHeredocBraces(root).map((s) => `${s.line} ${s.text}`)).toEqual(['20 }']);
    const open = mkdtempSync(path.join(tmpdir(), 'ccd-contexts-open-'));
    try {
      mkdirSync(path.dirname(ccdLauncherIn(open)), { recursive: true });
      writeFileSync(ccdLauncherIn(open), ['ff() {', "  cat <<'JSON'", '  {}', '}', 'fg() { :; }'].join('\n'));
      expect(ccdHeredocBraces(open).map((s) => `${s.line} ${s.text}`)).toEqual(['4 }', '2 <<JSON never closes']);
    } finally { rmSync(open, { recursive: true, force: true }); }
  });

  it('a cross-context edge joins two contexts, a call into K is not one, and each site says both ends', () => {
    // fb -> fc is inside C2, fd -> fa inside C1, and every edge to fk goes into K; fk -> fa goes OUT of K, and counts.
    expect(ccdCrossContextCalls(root).map((s) => `${s.line} ${s.text}`))
      .toEqual(['2 fk (K) -> fa (C1)', '7 fa (C1) -> fb (C2)', '11 fb (C2) -> fa (C1)']);
  });

  it('a fixture whose ccd gains a cross-context call the manifest lacks is caught', () => {
    // fa (C1) -> fb (C2) and fb (C2) -> fa (C1) are the fixture's cross-context edges; a manifest holding one fails the other.
    const fixture = ccdCrossContextCalls(root).map((s) => edgeOf(s.text));
    expect(checkEdges(fixture, ['fa -> fb']).extra).toEqual(['fb -> fa', 'fk -> fa']);
  });
});

describe('ccd cross-context references: the ratchet (D-6054)', () => {
  it('the K rows are pinned: a row moved into K drops the count by its callers, so it is a visible diff here', () => {
    // A call into K is not counted, so relabelling a much-called function K would lower the count without removing a
    // call. A K row is a kernel or platform helper every context uses; add one here only with that reason in the PR.
    expect(ccdContextRows().map((r) => r.text.split('\t')).filter(([, c]) => c === 'K').map(([n]) => n)).toEqual([
      '_plat_mv_notdir', '_plat_ln_swap', '_plat_ctime', '_plat_mtime', '_plat_size', '_plat_btime', '_plat_devino',
      '_plat_bytes', '_plat_epoch_ms', '_plat_workdirid_pane', '_plat_cp_replace', '_plat_mktemp', '_plat_mktemp_d', '_plat_mode',
      '_plat_date_to_epoch', '_plat_sha256', '_plat_sha256_check', '_plat_uuid', '_plat_ppid', '_plat_cgroup',
      '_plat_timeout', '_plat_timeout_capability', '_plat_timeout_strict', 'die', '_json_str', '_fmt_eta', '_now_s_to',
      '_now_s', '_file_read_to',
    ]);
  });

  it('every computed cross-context edge is in ccd/contexts-edges.tsv; edges gone from the code are listed to delete', () => {
    const sites = ccdCrossContextCalls();
    const pairs = new Map<string, number>();
    for (const s of sites) {
      const [, a, b] = /\((\w+)\) -> \S+ \((\w+)\)$/.exec(s.text)!;
      pairs.set(`${a} -> ${b}`, (pairs.get(`${a} -> ${b}`) ?? 0) + 1);
    }
    const table = [...pairs].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([k, n]) => `  ${k}: ${n}`);
    const { extra, stale } = checkEdges(sites.map((s) => edgeOf(s.text)), manifestEdges(readFileSync(EDGES_FILE, 'utf8')));
    if (stale.length > 0) console.warn(`ccd-contexts: ${stale.length} manifest edges no longer exist; delete from ccd/contexts-edges.tsv:\n  ${stale.join('\n  ')}`);
    expect(extra,
      `ccd/ccd now makes cross-context calls the manifest does not allow. By context pair:\n${table.join('\n')}\n`
      + "Call the owning context's function from inside its context, or move the function whose row is wrong; if the "
      + 'edge is truly needed, add its `caller -> callee` line to ccd/contexts-edges.tsv (sorted) and say why in the PR.').toEqual([]);
  });

  it('the manifest is sorted and has no duplicate line, so a reviewer reads each edge once', () => {
    const lines = manifestEdges(readFileSync(EDGES_FILE, 'utf8'));
    expect(lines).toEqual([...new Set(lines)].sort());
  });

  it('the edge check fails an edge the manifest lacks and names a manifest edge the code no longer makes', () => {
    expect(checkEdges(['a -> b', 'c -> d'], ['a -> b'])).toEqual({ extra: ['c -> d'], stale: [] });
    expect(checkEdges(['a -> b'], ['a -> b', 'x -> y'])).toEqual({ extra: [], stale: ['x -> y'] });
    expect(checkEdges(['a -> b'], ['a -> b'])).toEqual({ extra: [], stale: [] });
  });

  it('the listing covers every context pair it counts, and no edge into K', () => {
    const sites = ccdCrossContextCalls();
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.filter((s) => s.text.endsWith('(K)'))).toEqual([]);
    expect(sites.filter((s) => { const m = /\((\w+)\) -> \S+ \((\w+)\)$/.exec(s.text); return !m || m[1] === m[2]; }))
      .toEqual([]);
  });
});
