// server/test/compact-card.test.ts
// The compaction card's helper, imported directly (the `shared/mark.mjs`
// precedent: a deploy-side node script the PWA never bundles, unit-tested
// from vitest) and run as the hook runs it (`node <helper> <cmd> …`), for the
// exit codes and the files it leaves behind.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { tl, GRAPH, graphJson, node } from './compactCardFixtures.js';
import {
  EXIT, WINDOW_CAP, CHUNK, isBoundaryLine, readWindow, parseArgs,
  extensionsOf, tokenRegex, mineTokens, fileIndex, resolveToken, workingSet, WORKSET_CAP,
  GRAPH_MAX_BYTES, readBoundedDescriptor, loadGraph, loadLabels, fileFacts, renderCard, slotIsMine, cardCommand,
  normalizeSummary, filesSectionChars, citedCount, measureCommand,
} from '../../ccd/compact-card.mjs';

const HELPER = path.resolve(__dirname, '../../ccd/compact-card.mjs');
let dir: string;
beforeEach(() => { dir = mkTmp('ccrc-compact-card-'); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const write = (name: string, text: string): string => {
  const p = path.join(dir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return p;
};
/** The helper as the hook runs it. */
const helper = (args: string[], input = ''): { status: number | null; stdout: string; stderr: string } => {
  const r = spawnSync(process.execPath, [HELPER, ...args], { input, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

describe('readWindow — the transcript since the last boundary (spec §3.2)', () => {
  const boundary = tl.boundary();
  const row = (i: number): string => tl.user(`row ${i}`);

  it('returns the lines from the LAST boundary to EOF, boundary line included', () => {
    const p = write('t.jsonl', [row(1), boundary, row(2), boundary, row(3), row(4)].join('\n') + '\n');
    const w = readWindow(p);
    expect(w.boundary).toBe(true);
    expect(w.text.split('\n').filter(Boolean)).toEqual([boundary, row(3), row(4)]);
  });

  it('a "compact_boundary" literal that is NOT the harness row is not a boundary — the prototype\'s false positive', () => {
    // The RAW bytes must carry the needle `"compact_boundary"` — a literal
    // inside a JSON string is escaped by JSON.stringify and would never be
    // scanned. A `user` row whose own top-level `subtype` is the literal is the
    // shape: it is found FIRST by the backwards scan and must be rejected.
    const decoy = JSON.stringify({ type: 'user', subtype: 'compact_boundary', message: { role: 'user', content: 'not the harness' } });
    expect(decoy.includes('"compact_boundary"')).toBe(true);
    const p = write('t.jsonl', [row(1), boundary, row(2), decoy, row(3)].join('\n') + '\n');
    const w = readWindow(p);
    expect(w.boundary).toBe(true);
    expect(w.text.split('\n').filter(Boolean)).toEqual([boundary, row(2), decoy, row(3)]);
  });

  it('a boundary whose needle STRADDLES a chunk edge, several chunks back, is found', () => {
    // Deterministic: with a 4 KiB chunk, place the needle so the edge
    // `size - k*chunk` falls 8 bytes into it. `(size - needleOffset) % chunk`
    // is the needle's distance past the nearest edge counted from EOF.
    const chunk = 4096, want = 8;
    const build = (padLen: number): string => [row(1), boundary, tl.user('x'.repeat(padLen)), row(9)].join('\n') + '\n';
    let padLen = 3 * chunk;
    let text = build(padLen);
    const needle = text.indexOf('"compact_boundary"');
    const cur = (Buffer.byteLength(text) - needle) % chunk;
    padLen += (want - cur + chunk) % chunk;
    text = build(padLen);
    expect((Buffer.byteLength(text) - needle) % chunk).toBe(want);
    const p = write('t.jsonl', text);
    const w = readWindow(p, WINDOW_CAP, chunk);
    expect(w.boundary).toBe(true);
    expect(w.text.startsWith(boundary)).toBe(true);
    expect(w.text.trimEnd().endsWith(row(9))).toBe(true);
    expect(CHUNK).toBe(1024 * 1024);
  });

  it('with no boundary the whole file is the window', () => {
    const text = [row(1), row(2)].join('\n') + '\n';
    expect(readWindow(write('t.jsonl', text))).toEqual({ text, boundary: false });
  });

  it('with no boundary and a file over the cap, the window is the last cap bytes REALIGNED to a line start', () => {
    const text = Array.from({ length: 50 }, (_, i) => row(i)).join('\n') + '\n';
    const p = write('t.jsonl', text);
    const w = readWindow(p, 300);
    expect(w.boundary).toBe(false);
    expect(w.text.length).toBeLessThanOrEqual(300);
    expect(text.endsWith(w.text)).toBe(true);
    for (const l of w.text.split('\n').filter(Boolean)) expect(() => JSON.parse(l)).not.toThrow();
    expect(WINDOW_CAP).toBe(16 * 1024 * 1024);
  });

  it('isBoundaryLine confirms only the harness shape', () => {
    expect(isBoundaryLine(boundary)).toBe(true);
    expect(isBoundaryLine(JSON.stringify({ type: 'user', subtype: 'compact_boundary' }))).toBe(false);
    expect(isBoundaryLine(JSON.stringify({ type: 'system', subtype: 'turn_duration' }))).toBe(false);
    expect(isBoundaryLine('not json')).toBe(false);
  });

  it('a boundary further back than `cap` bytes from EOF is not found — the boundary path honours the byte budget too', () => {
    // Regression for the review's Finding 2: a file smaller than one chunk
    // but bigger than `cap`, with the boundary at its HEAD, used to be read
    // wholesale in the first (only) chunk — the read length consulted
    // `chunkSize` and `pos` but never `cap` — so the found-boundary return
    // carried the whole file regardless of `cap`. The fix bounds each read to
    // `cap - total`, so the backward search never looks past `cap` bytes from
    // EOF; a boundary further back than that is correctly treated as absent
    // and the result falls back to the (already-capped) tail window.
    const text = [boundary, ...Array.from({ length: 2000 }, (_, i) => row(i))].join('\n') + '\n';
    const p = write('t.jsonl', text);
    const cap = 500;
    expect(Buffer.byteLength(text)).toBeGreaterThan(cap);
    const w = readWindow(p, cap);
    expect(Buffer.byteLength(w.text)).toBeLessThanOrEqual(cap);
  });
});

describe('the CLI contract', () => {
  it('parseArgs reads --kebab-flags into camelCase, --steer as a boolean, and refuses a bare word', () => {
    expect(parseArgs(['card', '--max-chars', '4000', '--steer', '--scope', 'main']))
      .toEqual({ cmd: 'card', opts: { maxChars: '4000', steer: true, scope: 'main' } });
    expect(parseArgs(['card', 'stray'])).toEqual({ error: 'unexpected argument stray' });
    expect(parseArgs(['card', '--out'])).toEqual({ error: '--out needs a value' });
  });
  it('exits 2 on no subcommand, an unknown one, or a missing required flag, with nothing on stdout', () => {
    for (const args of [[], ['frobnicate'], ['card', '--transcript', 'x'], ['measure'], ['measure', '--trigger', 'weird']]) {
      const r = helper(args);
      expect(r.status, args.join(' ')).toBe(EXIT.USAGE);
      expect(r.stdout).toBe('');
      expect(r.stderr).toMatch(/^compact-card: /);
    }
  });

  it('invoked through a symlink, the entry guard still fires — the same usage exit as the direct path', () => {
    // Regression for the review's Finding 1: the entry guard compared
    // `resolve(process.argv[1])` (path-resolved, symlinks left alone)
    // against `import.meta.url` (which Node resolves through symlinks for
    // the main module), so through a symlink the two never matched, `main`
    // was never called, and the process exited 0 having done nothing —
    // silent, because the hook discards stderr and reads only the exit code.
    const link = path.join(dir, 'compact-card-link.mjs');
    fs.symlinkSync(HELPER, link);
    const r = spawnSync(process.execPath, [link], { encoding: 'utf8' });
    expect(r.status).toBe(EXIT.USAGE);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^compact-card: /);
  });
});

describe('mining — the working set out of the window (spec §3.2)', () => {
  const re = tokenRegex(['ts', 'sh', 'md']);

  it('tags Edit/Write/MultiEdit/NotebookEdit edited, Read touched, Bash tokens touched, the previous summary carried; skips lines that do not parse', () => {
    const win = [
      tl.toolUse('Edit', { file_path: '/w/server/src/a.ts', old_string: 'x', new_string: 'y' }),
      tl.toolUse('Write', { file_path: '/w/b.ts', content: '' }),
      tl.toolUse('MultiEdit', { file_path: '/w/m.ts', edits: [] }),
      tl.toolUse('NotebookEdit', { notebook_path: '/w/n.ipynb' }),
      tl.toolUse('Read', { file_path: '/w/c.ts' }),
      tl.toolUse('Bash', { command: 'sed -n 1,5p server/src/d.ts && cat -n ccd/e.sh | head' }),
      tl.summary('touched docs/f.md and server/src/a.ts; not g.tsz'),
      tl.toolUse('Grep', { pattern: 'x', path: 'server/src/z.ts' }),   // not a mined tool
      'not json at all',
    ].join('\n');
    expect(mineTokens(win, re)).toEqual([
      { token: '/w/server/src/a.ts', tag: 'edited' }, { token: '/w/b.ts', tag: 'edited' },
      { token: '/w/m.ts', tag: 'edited' }, { token: '/w/n.ipynb', tag: 'edited' },
      { token: '/w/c.ts', tag: 'touched' },
      { token: 'server/src/d.ts', tag: 'touched' }, { token: 'ccd/e.sh', tag: 'touched' },
      { token: 'docs/f.md', tag: 'carried' }, { token: 'server/src/a.ts', tag: 'carried' },
    ]);
  });

  it('a summary whose content is an array of text blocks is mined too, and a null regex mines only Edit/Read', () => {
    const arr = JSON.stringify({ type: 'user', isCompactSummary: true,
      message: { role: 'user', content: [{ type: 'text', text: 'see docs/f.md' }] } });
    expect(mineTokens(arr, re)).toEqual([{ token: 'docs/f.md', tag: 'carried' }]);
    const win = [tl.toolUse('Read', { file_path: '/w/c' }), tl.toolUse('Bash', { command: 'cat a.ts' })].join('\n');
    expect(mineTokens(win, null)).toEqual([{ token: '/w/c', tag: 'touched' }]);
  });

  it('the token regex is DERIVED from the graph\'s own extensions, longest first, with the leading lookbehind and the trailing lookahead both in effect', () => {
    expect(extensionsOf(['a/b.ts', 'c.tsx', 'ccd/ccd', 'x.d.mts', '.hidden', 'noext.'])).toEqual(['mts', 'tsx', 'ts']);
    expect(tokenRegex([])).toBeNull();
    expect('run foo.tsx and bar.ts, not baz.tsz nor _qux.ts_'.match(tokenRegex(['tsx', 'ts'])!)).toEqual(['foo.tsx', 'bar.ts']);
    expect('a c++ file x.c+ and y.c'.match(tokenRegex(['c+', 'c'])!)).toEqual(['x.c+', 'y.c']);   // escaped
  });

  it('a 64 KB run of class characters with no file token mines in linear time — the leading lookbehind is a cost guard, not a match guard', () => {
    // One unbroken run of allowed characters with no "." in it at all, so no
    // extension can ever match — exactly the shape that forces the engine to
    // restart its greedy scan at every position when the lookbehind is gone.
    // Bound is 1000ms; shipped cost on this string is ~1ms (three orders of
    // magnitude of headroom, so ordinary load cannot flake it) — without the
    // lookbehind the same string measured ~7.5s (server/test's own machine).
    const run = 'src/a-b_c/'.repeat(Math.ceil(65536 / 10)).slice(0, 65536);
    expect(run.includes('.')).toBe(false);
    const win = tl.toolUse('Bash', { command: run });
    const t0 = Date.now();
    mineTokens(win, re);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe('resolution — against the graph\'s own files (spec §3.2)', () => {
  const files = fileIndex(['server/src/pane/statusline.ts', 'server/src/watch.ts', 'pwa/src/watch.ts', 'ccd/ccd']);

  it('the index groups files by basename — the shape that keeps resolution O(tokens)', () => {
    expect(files.byBase.get('watch.ts')).toEqual(['server/src/watch.ts', 'pwa/src/watch.ts']);
    expect(files.byBase.get('ccd')).toEqual(['ccd/ccd']);
    expect(files.files.size).toBe(4);
  });

  it('strips the cwd and ./, matches exactly, then by a UNIQUE path-segment suffix', () => {
    expect(resolveToken('/w/server/src/watch.ts', files, '/w')).toEqual({ path: 'server/src/watch.ts' });
    expect(resolveToken('./server/src/watch.ts', files, '/w')).toEqual({ path: 'server/src/watch.ts' });
    expect(resolveToken('pane/statusline.ts', files, '/w')).toEqual({ path: 'server/src/pane/statusline.ts' });
    expect(resolveToken('ccd/ccd', files, '/w')).toEqual({ path: 'ccd/ccd' });
  });
  it('two suffix matches are AMBIGUOUS, never a guess', () => {
    expect(resolveToken('watch.ts', files, '/w')).toEqual({ reason: 'ambiguous' });
  });
  it('an absolute path outside the tree is OUTSIDE; an unknown path is NOMATCH', () => {
    expect(resolveToken('/etc/hosts.ts', files, '/w')).toEqual({ reason: 'outside' });
    expect(resolveToken('server/src/nope.ts', files, '/w')).toEqual({ reason: 'nomatch' });
    expect(resolveToken('/w', files, '/w')).toEqual({ reason: 'nomatch' });
  });
  it('a segment boundary is required — statusline.ts does not match xstatusline.ts', () => {
    expect(resolveToken('statusline.ts', fileIndex(['a/xstatusline.ts']), '/w')).toEqual({ reason: 'nomatch' });
  });
});

describe('the working set — ranked, counted, capped (spec §3.2)', () => {
  const files = fileIndex(['a.ts', 'b.ts', 'c.ts', 'd.ts']);
  it('ranks edited > touched > carried, then by count, then path; the strongest tag wins for a file', () => {
    const tokens = [
      { token: 'c.ts', tag: 'carried' as const }, { token: 'c.ts', tag: 'touched' as const },
      { token: 'b.ts', tag: 'touched' as const }, { token: 'b.ts', tag: 'touched' as const },
      { token: 'a.ts', tag: 'edited' as const }, { token: 'd.ts', tag: 'carried' as const },
      { token: '/x/out.ts', tag: 'touched' as const }, { token: 'zz.ts', tag: 'touched' as const },
    ];
    const { files: ws, stats } = workingSet(tokens, files, '/w');
    expect(ws).toEqual([
      { path: 'a.ts', tag: 'edited', count: 1 }, { path: 'b.ts', tag: 'touched', count: 2 },
      { path: 'c.ts', tag: 'touched', count: 2 }, { path: 'd.ts', tag: 'carried', count: 1 },
    ]);
    expect(stats).toEqual({ tokens: 8, resolved: 6, ambiguous: 0, outside: 1, nomatch: 1 });
  });
  it('the count term decides a same-tag tie when counts differ — path-alphabetical alone would give the OPPOSITE order', () => {
    const same = fileIndex(['a.ts', 'z.ts']);
    const tokens = [
      { token: 'a.ts', tag: 'touched' as const },
      { token: 'z.ts', tag: 'touched' as const }, { token: 'z.ts', tag: 'touched' as const }, { token: 'z.ts', tag: 'touched' as const },
    ];
    expect(workingSet(tokens, same, '/w').files).toEqual([
      { path: 'z.ts', tag: 'touched', count: 3 }, { path: 'a.ts', tag: 'touched', count: 1 },
    ]);
  });
  it('a token whose tag is not in TAGS is ignored — counted nowhere, no entry, never upgrades or corrupts an existing one', () => {
    const one = fileIndex(['a/b.ts']);
    const tokens = [{ token: 'a/b.ts', tag: 'bogus' as any }, { token: 'a/b.ts', tag: 'edited' as const }];
    const { files: ws, stats } = workingSet(tokens, one, '/w');
    expect(ws).toEqual([{ path: 'a/b.ts', tag: 'edited', count: 1 }]);
    expect(stats).toEqual({ tokens: 2, resolved: 1, ambiguous: 0, outside: 0, nomatch: 0 });
  });
  it('the set keeps at most WORKSET_CAP files', () => {
    const many = fileIndex(Array.from({ length: 150 }, (_, i) => `f${i}.ts`));
    const tokens = [...many.files].map((t) => ({ token: t, tag: 'touched' as const }));
    expect(workingSet(tokens, many, '/w').files).toHaveLength(WORKSET_CAP);
    expect(WORKSET_CAP).toBe(100);
  });
});

describe('the card from the graph (spec §3.2)', () => {
  const plant = (): { graph: string; labels: string } => ({
    graph: write('graphify-out/graph.json', graphJson(GRAPH, 'deadbeefcafe')),
    labels: write('graphify-out/.graphify_labels.json', JSON.stringify(GRAPH.labels)),
  });
  const FOOTER = 'Re-derive any node with `graphify explain "<symbol>"`; cite path:symbol:line rather than re-reading whole files.';

  it('loadGraph reads node-link JSON: nodes by id and by file, the edges under `links`, degree per node, the basename index; refuses an oversized file before parsing', () => {
    const { graph } = plant();
    const g = loadGraph(graph);
    expect(g.files.size).toBe(12);
    expect(g.index.byBase.get('watch.ts')).toEqual(['server/src/watch.ts']);
    expect(g.byFile.get('server/src/pane/statusline.ts')!.map((n) => n.id)).toEqual(['f_statusline', 'parseStatusline', 'parseCtxPct']);
    expect(g.degree.get('parseStatusline')).toBe(2);   // contains + calls
    expect(g.degree.get('s1')).toBe(5);                // contains + 4 calls
    expect(g.degree.get('f_hook')).toBe(0);
    expect(() => loadGraph(write('bad.json', '{"nodes": 3}'))).toThrow(/nodes\/links/);
    expect(() => loadGraph(graph, 100)).toThrow(/too large/);
    expect(GRAPH_MAX_BYTES).toBe(96 * 1024 * 1024);
    expect(loadLabels(path.join(dir, 'absent.json'))).toEqual({});
  });

  it('keeps graph parsing bounded to one descriptor: exactly maxBytes is accepted, maxBytes + 1 is refused, including growth after fstat', () => {
    const json = graphJson(GRAPH, 'deadbeefcafe');
    const cap = Buffer.byteLength(json);
    const graph = write('at-cap.json', json);
    expect(loadGraph(graph, cap).files.size).toBe(12);
    expect(() => loadGraph(write('over-cap.json', json + ' '), cap)).toThrow(/too large/);

    const fd = fs.openSync(graph, 'r');
    let grew = false;
    try {
      expect(() => readBoundedDescriptor(fd, cap, (readFd, buffer, offset, length, position) => {
        if (!grew) { fs.appendFileSync(graph, ' '); grew = true; }
        return fs.readSync(readFd, buffer, offset, length, position);
      })).toThrow(/too large/);
    } finally {
      fs.closeSync(fd);
    }
    expect(grew).toBe(true);
  });

  it('fileFacts: the community label, top FIVE symbols by degree, the top three dependents OUTSIDE the working set with the rest counted', () => {
    const { graph, labels } = plant();
    const g = loadGraph(graph), l = loadLabels(labels);
    const ws = new Set(['server/src/pane/statusline.ts', 'server/src/watch.ts']);
    expect(fileFacts('server/src/pane/statusline.ts', g, l, ws)).toEqual({
      community: 'watch.ts', symbols: ['parseCtxPct:L105', 'parseStatusline:L132'], usedBy: ['server/src/fleet.ts'] });
    // watch.ts is IN the set, so its imports_from/calls into statusline.ts are not "outside"
    expect(fileFacts('server/src/pane/statusline.ts', g, l, new Set(['server/src/pane/statusline.ts'])).usedBy)
      .toEqual(['server/src/watch.ts', 'server/src/fleet.ts']);    // watch.ts carries 2 links (calls + imports_from), fleet.ts 1
    expect(fileFacts('ccd/session-hook.sh', g, l, ws)).toEqual({ community: null, symbols: [], usedBy: [] });
    // six symbols → five, by degree then label; four dependents, by link count then path
    expect(fileFacts('server/src/big.ts', g, l, new Set(['server/src/big.ts']))).toEqual({
      community: 'big.ts', symbols: ['s1:L10', 's2:L20', 's3:L30', 's4:L40', 's5:L50'],
      usedBy: ['server/src/d1.ts', 'server/src/d2.ts', 'server/src/d3.ts', 'server/src/d4.ts'] });
    // no `metadata.kind`, no L1 node named after the file: the top-degree node stands in
    expect(fileFacts('shared/api.ts', g, l, new Set(['shared/api.ts']))).toEqual({
      community: 'api.ts', symbols: ['FLEET_PROTO:L5'], usedBy: ['pwa/src/session/ModelSheet.tsx', 'server/src/fleet.ts'] });
  });

  it('fileFacts treats only metadata.kind=file as a file node; an L1 basename lookalike loses to the top-degree representative and that representative is not a symbol', () => {
    const l1Basename = node('skew_l1', 'skew.ts', 'server/src/skew.ts', 1, 1);
    const topDegree = node('skew_top', 'topDegree', 'server/src/skew.ts', 42, 3);
    const other = node('skew_other', 'other', 'server/src/skew.ts', 77, 3);
    const content = { ...GRAPH, nodes: [...GRAPH.nodes, l1Basename, topDegree, other], links: [
      ...GRAPH.links,
      { ...GRAPH.links[0], source: 'skew_top', target: 'f_statusline', relation: 'calls' },
      { ...GRAPH.links[0], source: 'skew_top', target: 'f_watch', relation: 'calls' },
    ] };
    const graph = write('graphify-out/graph.json', graphJson(content, 'deadbeefcafe'));
    const labels = write('graphify-out/.graphify_labels.json', JSON.stringify({ ...GRAPH.labels, '1': 'L1 basename', '3': 'top degree' }));
    expect(fileFacts('server/src/skew.ts', loadGraph(graph), loadLabels(labels), new Set(['server/src/skew.ts']))).toEqual({
      community: 'top degree', symbols: ['other:L77', 'skew.ts:L1'], usedBy: [],
    });
  });

  it('renders the card: header with the graph commit and freshness, one line per file, blast radius, the footer', () => {
    const { graph, labels } = plant();
    const set = { v: 1, at: 1, scope: 'main', agent: null, transcript: '/t', cwd: '/w', built: 'deadbeefcafe',
      fresh: 'fresh', steered: false, stats: null,
      files: [{ path: 'server/src/pane/statusline.ts', tag: 'edited', count: 3 }, { path: 'server/src/watch.ts', tag: 'touched', count: 1 }] };
    const text = renderCard(set as any, loadGraph(graph), loadLabels(labels), { maxChars: 4000, maxFiles: 12, built: 'deadbeefcafe', fresh: 'fresh', scope: 'main', agent: null });
    expect(text.split('\n')).toEqual([
      'graphify card — this context\'s working set at compaction, from graphify-out/ (built at deadbeef, fresh):',
      '- server/src/pane/statusline.ts [edited] · community "watch.ts" · symbols parseCtxPct:L105 parseStatusline:L132 · used by server/src/fleet.ts',
      '- server/src/watch.ts [touched] · community "watch.ts" · symbols sweepMail:L40',
      'Blast radius: 1 file imports or calls something in these 2 files.',
      FOOTER,
    ]);
    const sub = renderCard(set as any, loadGraph(graph), loadLabels(labels), { maxChars: 4000, maxFiles: 12, built: '', fresh: '', scope: 'subagent', agent: 'a43142b934b4bf501' });
    expect(sub.split('\n')[0]).toBe('graphify card — this context\'s working set at compaction (subagent a43142b934b4bf501), from graphify-out/ (built at unknown):');
  });

  it('truncation drops WHOLE files from the bottom and always says how many were not shown', () => {
    const { graph, labels } = plant();
    const g = loadGraph(graph), l = loadLabels(labels);
    const files = [...g.files].sort().map((p) => ({ path: p, tag: 'touched' as const, count: 1 }));
    const set = { v: 1, at: 1, scope: 'main', agent: null, transcript: '/t', cwd: '/w', built: 'b', fresh: 'fresh', steered: false, served: false, stats: null, files };
    const o = { built: 'b', fresh: 'fresh', scope: 'main' as const, agent: null };
    const full = renderCard(set as any, g, l, { maxChars: 4000, maxFiles: 12, ...o });
    expect(full).not.toContain('files not shown');
    const capped = renderCard(set as any, g, l, { maxChars: 4000, maxFiles: 2, ...o });
    expect(capped).toContain('(+10 files not shown)');
    expect(capped.split('\n').filter((x) => x.startsWith('- '))).toHaveLength(2);
    const tight = renderCard(set as any, g, l, { maxChars: 420, maxFiles: 12, ...o });
    expect(tight.length).toBeLessThanOrEqual(420);
    expect(tight).toMatch(/\(\+\d+ files not shown\)/);
    for (const line of tight.split('\n')) expect(line.endsWith('·')).toBe(false);   // never mid-line
    expect(tight).toContain(FOOTER);
  });

  it('when one file still overflows, its `used by` list collapses to its count — never mid-line', () => {
    const { graph, labels } = plant();
    const g = loadGraph(graph), l = loadLabels(labels);
    const set = { v: 1, at: 1, scope: 'main', agent: null, transcript: '/t', cwd: '/w', built: 'b', fresh: 'fresh', steered: false, served: false, stats: null,
      files: [{ path: 'server/src/big.ts', tag: 'edited' as const, count: 1 }] };
    const o = { built: 'b', fresh: 'fresh', scope: 'main' as const, agent: null, maxFiles: 12 };
    const full = renderCard(set as any, g, l, { maxChars: 4000, ...o });
    expect(full).toContain('· used by server/src/d1.ts server/src/d2.ts server/src/d3.ts (+1)');
    const collapsed = renderCard(set as any, g, l, { maxChars: full.length - 1, ...o });
    expect(collapsed).toMatch(/· used by \(\+4\)$/m);
    expect(collapsed).not.toContain('server/src/d1.ts');
    expect(collapsed.length).toBeLessThan(full.length);
  });

  it('drops a pathological final row whole when it alone exceeds the ceiling, while retaining the disclosure, blast radius, and footer', () => {
    const { graph, labels } = plant();
    const set = { v: 1, at: 1, scope: 'main', agent: null, transcript: '/t', cwd: '/w', built: 'b', fresh: 'fresh', steered: false, served: false, stats: null,
      files: [{ path: `server/src/${'x'.repeat(1000)}.ts`, tag: 'edited' as const, count: 1 }] };
    const text = renderCard(set as any, loadGraph(graph), loadLabels(labels),
      { maxChars: 400, maxFiles: 12, built: 'b', fresh: 'fresh', scope: 'main', agent: null });
    expect(text.length).toBeLessThanOrEqual(400);
    expect(text.split('\n')).toEqual([
      'graphify card — this context\'s working set at compaction, from graphify-out/ (built at b, fresh):',
      '(+1 files not shown)',
      'Blast radius: 0 files import or call something in these 1 files.',
      FOOTER,
    ]);
  });

  /** The set the HOOK writes before the helper runs (Task 2's shape): the
   *  slot the helper must find its own `nonce` in, and the fields it carries. */
  const hookSet = (set: string, at: number, nonce = `nonce-${at}`, extra: object = {}): void =>
    fs.writeFileSync(set, JSON.stringify({ v: 1, at, nonce, scope: 'main', agent: null, transcript: '/t', parentLive: null, liveAgents: 0,
      cwd: dir, built: null, fresh: null, steered: false, served: false, files: null, stats: null, ...extra }) + '\n');

  it('cardCommand rewrites the hook\'s set and writes the card, `at`, `nonce`, and `transcript` before `files`, the hook\'s fields carried, and exits 0', () => {
    const { graph, labels } = plant();
    const transcript = write('t.jsonl', [
      tl.toolUse('Read', { file_path: path.join(dir, 'server/src/pane/statusline.ts') }),
      tl.boundary(),
      tl.toolUse('Edit', { file_path: path.join(dir, 'server/src/pane/statusline.ts') }),
      tl.toolUse('Bash', { command: 'sed -n 1,40p server/src/watch.ts; cat /etc/passwd.ts' }),
      tl.summary('carried pwa/src/lib/models.ts'),
    ].join('\n') + '\n');
    const out = path.join(dir, 'reg', 'x.compactcard'), set = path.join(dir, 'reg', 'x.compactset');
    fs.mkdirSync(path.join(dir, 'reg'));
    hookSet(set, 1789330000000, 'nonce-a1', { scope: 'subagent', agent: 'a1', transcript, parentLive: false, liveAgents: 1 });
    const rc = cardCommand({ transcript, cwd: dir, graph, labels, out, set, maxChars: 4000, maxFiles: 12,
      built: 'deadbeefcafe', fresh: 'fresh', scope: 'subagent', agent: 'a1', at: 1789330000000, nonce: 'nonce-a1' });
    expect(rc).toBe(EXIT.OK);
    const s = JSON.parse(fs.readFileSync(set, 'utf8'));
    expect(Object.keys(s)).toEqual(['v', 'at', 'nonce', 'scope', 'agent', 'transcript', 'parentLive', 'liveAgents', 'cwd', 'built', 'fresh', 'steered', 'served', 'files', 'stats']);
    expect(s).toMatchObject({ v: 1, at: 1789330000000, nonce: 'nonce-a1', scope: 'subagent', agent: 'a1', transcript, parentLive: false, liveAgents: 1,
      cwd: dir, built: 'deadbeefcafe', fresh: 'fresh', steered: false, served: false,
      files: [{ path: 'server/src/pane/statusline.ts', tag: 'edited', count: 1 },
              { path: 'server/src/watch.ts', tag: 'touched', count: 1 },
              { path: 'pwa/src/lib/models.ts', tag: 'carried', count: 1 }],
      stats: { tokens: 4, resolved: 3, ambiguous: 0, outside: 1, nomatch: 0 } });
    const card = fs.readFileSync(out, 'utf8').split('\n');
    expect(card[0]).toBe('nonce-a1');
    expect(card[1]).toContain('(subagent a1)');
    expect(card[2]).toBe('- server/src/pane/statusline.ts [edited] · community "watch.ts" · symbols parseCtxPct:L105 parseStatusline:L132 · used by server/src/fleet.ts');
    expect(fs.readdirSync(path.join(dir, 'reg')).sort()).toEqual(['x.compactcard', 'x.compactset']);   // no temp left
  });

  it('THE SLOT CHECK: a newer owner with the same at but another nonce is refused — exit 1, nothing written', () => {
    const { graph, labels } = plant();
    const transcript = write('t.jsonl', tl.toolUse('Read', { file_path: path.join(dir, 'server/src/watch.ts') }) + '\n');
    const out = path.join(dir, 'x.compactcard'), set = path.join(dir, 'x.compactset');
    const args = { transcript, cwd: dir, graph, labels, out, set, maxChars: 4000, maxFiles: 12,
      built: 'b', fresh: 'fresh', scope: 'main' as const, agent: null, at: 7, nonce: 'older-nonce' };
    expect(() => cardCommand(args)).toThrow(/slot/);                 // no set: the hook always writes one first
    hookSet(set, 7, 'newer-nonce', { scope: 'ambiguous', transcript: null }); // same millisecond, another owner
    const before = fs.readFileSync(set, 'utf8');
    expect(() => cardCommand(args)).toThrow(/slot/);
    expect(fs.readFileSync(set, 'utf8')).toBe(before);
    expect(fs.existsSync(out)).toBe(false);
    expect(slotIsMine(set, 'newer-nonce')).not.toBeNull();
    expect(slotIsMine(set, 'older-nonce')).toBeNull();
    expect(slotIsMine(path.join(dir, 'absent'), 'older-nonce')).toBeNull();
  });

  it('rechecks the nonce after render staging and before the first target write', () => {
    const { graph, labels } = plant();
    const transcript = write('t.jsonl', tl.toolUse('Read', { file_path: path.join(dir, 'server/src/watch.ts') }) + '\n');
    const set = path.join(dir, 'reg', 'x.compactset'), out = path.join(dir, 'reg', 'x.compactcard');
    fs.mkdirSync(path.join(dir, 'reg'));
    hookSet(set, 1, 'older-nonce');
    const later = JSON.stringify({ v: 1, at: 1, nonce: 'later-nonce' }) + '\n';
    let writes = 0;
    const writeAtomic = (): void => { writes++; };
    const args = { transcript, cwd: dir, graph, labels, out, set, maxChars: 4000, maxFiles: 12,
      built: 'b', fresh: 'fresh', scope: 'main' as const, agent: null, at: 1, nonce: 'older-nonce', writeAtomic };
    Object.defineProperty(args, 'maxChars', {
      enumerable: true,
      get: () => { fs.writeFileSync(set, later); return 4000; },
    });
    expect(() => cardCommand(args)).toThrow(/slot/);
    expect(writes).toBe(0);
    expect(fs.readFileSync(set, 'utf8')).toBe(later);
    expect(fs.existsSync(out)).toBe(false);
  });

  it('an empty working set writes the set with files [] and NO card, exit 3', () => {
    const { graph, labels } = plant();
    const transcript = write('t.jsonl', tl.user('hello') + '\n');
    const out = path.join(dir, 'x.compactcard'), set = path.join(dir, 'x.compactset');
    hookSet(set, 1);
    expect(cardCommand({ transcript, cwd: dir, graph, labels, out, set, maxChars: 4000, maxFiles: 12,
      built: '', fresh: '', scope: 'main', agent: null, at: 1, nonce: 'nonce-1' })).toBe(EXIT.EMPTY);
    expect(JSON.parse(fs.readFileSync(set, 'utf8'))).toMatchObject({ files: [], built: null, fresh: null, stats: { tokens: 0 }, steered: false, served: false });
    expect(fs.existsSync(out)).toBe(false);
  });

  it('a card-write failure restores the exact hook-owned bytes and removes only its matching nonce card', () => {
    const { graph, labels } = plant();
    const transcript = write('t.jsonl', tl.toolUse('Read', { file_path: path.join(dir, 'server/src/watch.ts') }) + '\n');
    const set = path.join(dir, 'reg', 'x.compactset'), out = path.join(dir, 'reg', 'x.compactcard');
    fs.mkdirSync(path.join(dir, 'reg'));
    hookSet(set, 1, 'rollback-nonce');
    const initial = fs.readFileSync(set, 'utf8');
    const writeAtomic = (target: string, text: string): void => {
      if (target === out) {
        fs.writeFileSync(out, 'rollback-nonce\npartial card\n');
        throw new Error('card write failed');
      }
      fs.writeFileSync(target, text);
    };
    expect(() => cardCommand({ transcript, cwd: dir, graph, labels, out, set, maxChars: 4000, maxFiles: 12,
      built: 'b', fresh: 'fresh', scope: 'main', agent: null, at: 1, nonce: 'rollback-nonce', writeAtomic })).toThrow(/card write failed/);
    expect(fs.readFileSync(set, 'utf8')).toBe(initial);
    expect(fs.existsSync(out)).toBe(false);
    expect(fs.readdirSync(path.join(dir, 'reg')).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('a directory at the card path and its sentinel survive rollback', () => {
    const { graph, labels } = plant();
    const transcript = write('t.jsonl', tl.toolUse('Read', { file_path: path.join(dir, 'server/src/watch.ts') }) + '\n');
    const set = path.join(dir, 'reg', 'x.compactset'), out = path.join(dir, 'reg', 'x.compactcard');
    fs.mkdirSync(path.join(dir, 'reg'));
    hookSet(set, 1, 'directory-nonce');
    const initial = fs.readFileSync(set, 'utf8');
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(out, 'sentinel'), 'directory survives\n');
    expect(() => cardCommand({ transcript, cwd: dir, graph, labels, out, set, maxChars: 4000, maxFiles: 12,
      built: 'b', fresh: 'fresh', scope: 'main', agent: null, at: 1, nonce: 'directory-nonce' })).toThrow();
    expect(fs.readFileSync(set, 'utf8')).toBe(initial);
    expect(fs.statSync(out).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(out, 'sentinel'), 'utf8')).toBe('directory survives\n');
    expect(fs.readdirSync(path.join(dir, 'reg')).sort()).toEqual(['x.compactcard', 'x.compactset']);
  });

  it('helper rollback never restores or removes a later owner with another nonce', () => {
    const { graph, labels } = plant();
    const transcript = write('t.jsonl', tl.toolUse('Read', { file_path: path.join(dir, 'server/src/watch.ts') }) + '\n');
    const set = path.join(dir, 'reg', 'x.compactset'), out = path.join(dir, 'reg', 'x.compactcard');
    fs.mkdirSync(path.join(dir, 'reg'));
    hookSet(set, 1, 'older-nonce');
    const laterSet = '{"v":1,"at":1,"nonce":"later-nonce"}\n';
    const laterCard = 'later-nonce\nlater card\n';
    const writeAtomic = (target: string, text: string): void => {
      if (target === out) {
        fs.writeFileSync(set, laterSet);
        fs.writeFileSync(out, laterCard);
        throw new Error('slot taken during card write');
      }
      fs.writeFileSync(target, text);
    };
    expect(() => cardCommand({ transcript, cwd: dir, graph, labels, out, set, maxChars: 4000, maxFiles: 12,
      built: 'b', fresh: 'fresh', scope: 'main', agent: null, at: 1, nonce: 'older-nonce', writeAtomic })).toThrow(/slot taken/);
    expect(fs.readFileSync(set, 'utf8')).toBe(laterSet);
    expect(fs.readFileSync(out, 'utf8')).toBe(laterCard);
  });

  it('helper rollback claims its partial card before B installs, so B survives byte-for-byte', () => {
    const { graph, labels } = plant();
    const transcript = write('t.jsonl', tl.toolUse('Read', { file_path: path.join(dir, 'server/src/watch.ts') }) + '\n');
    const set = path.join(dir, 'reg', 'x.compactset'), out = path.join(dir, 'reg', 'x.compactcard');
    fs.mkdirSync(path.join(dir, 'reg'));
    hookSet(set, 1, 'older-nonce');
    const laterCard = 'later-nonce\nlater card\n';
    const writeAtomic = (target: string, text: string): void => {
      if (target === out) {
        fs.writeFileSync(out, 'older-nonce\npartial card\n');
        throw new Error('card write failed');
      }
      fs.writeFileSync(target, text);
    };
    let claimed = false;
    expect(() => cardCommand({ transcript, cwd: dir, graph, labels, out, set, maxChars: 4000, maxFiles: 12,
      built: 'b', fresh: 'fresh', scope: 'main', agent: null, at: 1, nonce: 'older-nonce', writeAtomic,
      rollbackHook: (phase) => {
        if (phase === 'cardClaimed') {
          claimed = true;
          fs.writeFileSync(out, laterCard);
        }
      } })).toThrow(/card write failed/);
    expect(claimed).toBe(true);
    expect(fs.readFileSync(out, 'utf8')).toBe(laterCard);
    expect(fs.readdirSync(path.join(dir, 'reg')).filter((n) => n.endsWith('.compactcard.tmp'))).toEqual([]);
  });

  it('helper rollback retains a displaced B card when C wins the no-clobber restore race', () => {
    const { graph, labels } = plant();
    const transcript = write('t.jsonl', tl.toolUse('Read', { file_path: path.join(dir, 'server/src/watch.ts') }) + '\n');
    const set = path.join(dir, 'reg', 'x.compactset'), out = path.join(dir, 'reg', 'x.compactcard');
    fs.mkdirSync(path.join(dir, 'reg'));
    hookSet(set, 1, 'older-nonce');
    const laterCard = 'later-nonce\nlater card\n';
    const currentCard = 'current-nonce\ncurrent card\n';
    const writeAtomic = (target: string, text: string): void => {
      if (target === out) {
        fs.writeFileSync(out, laterCard);
        throw new Error('card write failed');
      }
      fs.writeFileSync(target, text);
    };
    let claim = '';
    expect(() => cardCommand({ transcript, cwd: dir, graph, labels, out, set, maxChars: 4000, maxFiles: 12,
      built: 'b', fresh: 'fresh', scope: 'main', agent: null, at: 1, nonce: 'older-nonce', writeAtomic,
      rollbackHook: (phase, path) => {
        if (phase === 'cardClaimed') {
          claim = path;
          fs.writeFileSync(out, currentCard);
        }
      } })).toThrow(/card write failed/);
    expect(fs.readFileSync(out, 'utf8')).toBe(currentCard);
    expect(claim).not.toBe('');
    expect(fs.readFileSync(claim, 'utf8')).toBe(laterCard);
  });

  it('helper rollback retains B after a successful restore when C replaces its live link', () => {
    const { graph, labels } = plant();
    const transcript = write('t.jsonl', tl.toolUse('Read', { file_path: path.join(dir, 'server/src/watch.ts') }) + '\n');
    const set = path.join(dir, 'reg', 'x.compactset'), out = path.join(dir, 'reg', 'x.compactcard');
    fs.mkdirSync(path.join(dir, 'reg'));
    hookSet(set, 1, 'older-nonce');
    const laterCard = 'later-nonce\nlater card\n';
    const currentCard = 'current-nonce\ncurrent card\n';
    const writeAtomic = (target: string, text: string): void => {
      if (target === out) {
        fs.writeFileSync(out, laterCard);
        throw new Error('card write failed');
      }
      fs.writeFileSync(target, text);
    };
    let claim = '';
    expect(() => cardCommand({ transcript, cwd: dir, graph, labels, out, set, maxChars: 4000, maxFiles: 12,
      built: 'b', fresh: 'fresh', scope: 'main', agent: null, at: 1, nonce: 'older-nonce', writeAtomic,
      rollbackHook: (phase, path) => {
        if (phase === 'cardRestored') {
          claim = path;
          expect(fs.readFileSync(out, 'utf8')).toBe(laterCard);
          fs.rmSync(out);
          fs.writeFileSync(out, currentCard);
        }
      } })).toThrow(/card write failed/);
    expect(fs.readFileSync(out, 'utf8')).toBe(currentCard);
    expect(claim).not.toBe('');
    expect(fs.readFileSync(claim, 'utf8')).toBe(laterCard);
  });

  it('helper set rollback atomically claims A before B lands, so B survives byte-for-byte', () => {
    const { graph, labels } = plant();
    const transcript = write('t.jsonl', tl.toolUse('Read', { file_path: path.join(dir, 'server/src/watch.ts') }) + '\n');
    const set = path.join(dir, 'reg', 'x.compactset'), out = path.join(dir, 'reg', 'x.compactcard');
    fs.mkdirSync(path.join(dir, 'reg'));
    hookSet(set, 1, 'older-nonce');
    const laterSet = '{"v":1,"at":2,"nonce":"later-nonce","scope":"main","files":null}\n';
    const writeAtomic = (target: string, text: string): void => {
      if (target === out) {
        fs.writeFileSync(out, 'older-nonce\npartial card\n');
        throw new Error('card write failed');
      }
      fs.writeFileSync(target, text);
    };
    let claimed = false;
    expect(() => cardCommand({ transcript, cwd: dir, graph, labels, out, set, maxChars: 4000, maxFiles: 12,
      built: 'b', fresh: 'fresh', scope: 'main', agent: null, at: 1, nonce: 'older-nonce', writeAtomic,
      rollbackHook: (phase, claim) => {
        if (phase === 'setClaimed') {
          claimed = true;
          expect(JSON.parse(fs.readFileSync(claim, 'utf8')).nonce).toBe('older-nonce');
          fs.writeFileSync(set, laterSet);
        }
      } })).toThrow(/card write failed/);
    expect(claimed).toBe(true);
    expect(fs.readFileSync(set, 'utf8')).toBe(laterSet);
    expect(fs.readdirSync(path.join(dir, 'reg')).filter((n) => n.includes('compactset-'))).toEqual([]);
  });

  it('helper set rollback retains claimed B when C wins before no-clobber restoration', () => {
    const { graph, labels } = plant();
    const transcript = write('t.jsonl', tl.toolUse('Read', { file_path: path.join(dir, 'server/src/watch.ts') }) + '\n');
    const set = path.join(dir, 'reg', 'x.compactset'), out = path.join(dir, 'reg', 'x.compactcard');
    fs.mkdirSync(path.join(dir, 'reg'));
    hookSet(set, 1, 'older-nonce');
    const laterSet = '{"v":1,"at":2,"nonce":"later-nonce","scope":"main","files":null}\n';
    const currentSet = '{"v":1,"at":3,"nonce":"current-nonce","scope":"main","files":null}\n';
    const writeAtomic = (target: string, text: string): void => {
      if (target === out) {
        fs.writeFileSync(set, laterSet);
        fs.writeFileSync(out, 'older-nonce\npartial card\n');
        throw new Error('card write failed');
      }
      fs.writeFileSync(target, text);
    };
    let claim = '';
    expect(() => cardCommand({ transcript, cwd: dir, graph, labels, out, set, maxChars: 4000, maxFiles: 12,
      built: 'b', fresh: 'fresh', scope: 'main', agent: null, at: 1, nonce: 'older-nonce', writeAtomic,
      rollbackHook: (phase, claimPath) => {
        if (phase === 'setClaimed') {
          claim = claimPath;
          expect(fs.readFileSync(claim, 'utf8')).toBe(laterSet);
          fs.writeFileSync(set, currentSet);
        }
      } })).toThrow(/card write failed/);
    expect(fs.readFileSync(set, 'utf8')).toBe(currentSet);
    expect(claim).not.toBe('');
    expect(fs.readFileSync(claim, 'utf8')).toBe(laterSet);
  });

  it('helper set rollback retains B after a successful restore when C replaces it', () => {
    const { graph, labels } = plant();
    const transcript = write('t.jsonl', tl.toolUse('Read', { file_path: path.join(dir, 'server/src/watch.ts') }) + '\n');
    const set = path.join(dir, 'reg', 'x.compactset'), out = path.join(dir, 'reg', 'x.compactcard');
    fs.mkdirSync(path.join(dir, 'reg'));
    hookSet(set, 1, 'older-nonce');
    const laterSet = '{"v":1,"at":2,"nonce":"later-nonce","scope":"main","files":null}\n';
    const currentSet = '{"v":1,"at":3,"nonce":"current-nonce","scope":"main","files":null}\n';
    const writeAtomic = (target: string, text: string): void => {
      if (target === out) {
        fs.writeFileSync(set, laterSet);
        fs.writeFileSync(out, 'older-nonce\npartial card\n');
        throw new Error('card write failed');
      }
      fs.writeFileSync(target, text);
    };
    let claim = '';
    expect(() => cardCommand({ transcript, cwd: dir, graph, labels, out, set, maxChars: 4000, maxFiles: 12,
      built: 'b', fresh: 'fresh', scope: 'main', agent: null, at: 1, nonce: 'older-nonce', writeAtomic,
      rollbackHook: (phase, claimPath) => {
        if (phase === 'setRestored') {
          claim = claimPath;
          expect(fs.readFileSync(set, 'utf8')).toBe(laterSet);
          fs.rmSync(set);
          fs.writeFileSync(set, currentSet);
        }
      } })).toThrow(/card write failed/);
    expect(fs.readFileSync(set, 'utf8')).toBe(currentSet);
    expect(claim).not.toBe('');
    expect(fs.readFileSync(claim, 'utf8')).toBe(laterSet);
  });

  it('a directory at the set path and its sentinel survive rollback', () => {
    const { graph, labels } = plant();
    const transcript = write('t.jsonl', tl.toolUse('Read', { file_path: path.join(dir, 'server/src/watch.ts') }) + '\n');
    const set = path.join(dir, 'reg', 'x.compactset'), out = path.join(dir, 'reg', 'x.compactcard');
    fs.mkdirSync(path.join(dir, 'reg'));
    hookSet(set, 1, 'directory-nonce');
    const writeAtomic = (target: string, text: string): void => {
      if (target === out) {
        fs.writeFileSync(out, 'directory-nonce\npartial card\n');
        throw new Error('card write failed');
      }
      fs.writeFileSync(target, text);
    };
    expect(() => cardCommand({ transcript, cwd: dir, graph, labels, out, set, maxChars: 4000, maxFiles: 12,
      built: 'b', fresh: 'fresh', scope: 'main', agent: null, at: 1, nonce: 'directory-nonce', writeAtomic,
      rollbackHook: (phase) => {
        if (phase === 'setBeforeClaim') {
          fs.rmSync(set);
          fs.mkdirSync(set);
          fs.writeFileSync(path.join(set, 'sentinel'), 'directory survives\n');
        }
      } })).toThrow(/card write failed/);
    expect(fs.statSync(set).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(set, 'sentinel'), 'utf8')).toBe('directory survives\n');
    expect(fs.existsSync(out)).toBe(false);
    expect(fs.readdirSync(path.join(dir, 'reg')).sort()).toEqual(['x.compactset']);
  });

  it('requires a nonempty --nonce for card ownership, before touching its inputs', () => {
    const args = ['card', '--transcript', 't', '--cwd', 'c', '--graph', 'g', '--labels', 'l', '--out', 'o', '--set', 's',
      '--max-chars', '1', '--max-files', '1', '--built', 'b', '--fresh', 'f', '--scope', 'main', '--at', '1'];
    const missing = helper(args);
    expect(missing.status).toBe(EXIT.USAGE);
    expect(missing.stderr).toContain('--nonce is required');
    expect(helper([...args, '--nonce', '']).status).toBe(EXIT.USAGE);
  });

  it('as the hook runs it: exit 0 with nothing on stdout; a malformed graph is exit 1 with nothing rewritten; --steer is accepted and changes nothing', () => {
    const { graph, labels } = plant();
    const transcript = write('t.jsonl', tl.toolUse('Read', { file_path: path.join(dir, 'server/src/watch.ts') }) + '\n');
    const out = path.join(dir, 'x.compactcard'), set = path.join(dir, 'x.compactset');
    hookSet(set, 1);
    const args = ['card', '--transcript', transcript, '--cwd', dir, '--graph', graph, '--labels', labels,
      '--out', out, '--set', set, '--max-chars', '4000', '--max-files', '12', '--built', 'b', '--fresh', 'fresh', '--scope', 'main', '--at', '1', '--nonce', 'nonce-1'];
    const ok = helper(args);
    expect(ok).toEqual({ status: EXIT.OK, stdout: '', stderr: '' });
    fs.rmSync(out); hookSet(set, 1);
    expect(helper([...args, '--steer']).status).toBe(EXIT.OK);
    expect(JSON.parse(fs.readFileSync(set, 'utf8')).steered).toBe(false);
    fs.rmSync(out); hookSet(set, 1);
    fs.writeFileSync(graph, '{not json');
    const bad = helper(args);
    expect(bad.status).toBe(EXIT.FAILURE);
    expect(bad.stdout).toBe('');
    expect(JSON.parse(fs.readFileSync(set, 'utf8')).files, 'a failure rewrites nothing').toBeNull();
    expect(helper([...args, '--scope', 'nope']).status).toBe(EXIT.USAGE);
    expect(helper([...args, '--at', 'soon']).status).toBe(EXIT.USAGE);
  });

  it('END TO END, an AMBIGUOUS basename: a graph with two files named `watch.ts` resolves neither — the bare basename is never a guess, exit 3, `stats.ambiguous` says why', () => {
    // Built from GRAPH plus one extra node (the Task 4 review's suggestion) —
    // the fixture module itself is untouched. `pwa/src/watch.ts` shares its
    // basename with the fixture's own `server/src/watch.ts`, so the graph's
    // own basename index carries two candidates for the bare token `watch.ts`.
    const dup = node('f_watch2', 'watch.ts', 'pwa/src/watch.ts', 1, 1, 'file');
    const content = { ...GRAPH, nodes: [...GRAPH.nodes, dup] };
    const graph = write('graphify-out/graph.json', graphJson(content, 'deadbeefcafe'));
    const labels = write('graphify-out/.graphify_labels.json', JSON.stringify(GRAPH.labels));
    expect(loadGraph(graph).index.byBase.get('watch.ts')).toEqual(['server/src/watch.ts', 'pwa/src/watch.ts']);
    const transcript = write('t.jsonl', tl.toolUse('Bash', { command: 'cat watch.ts' }) + '\n');
    const out = path.join(dir, 'x.compactcard'), set = path.join(dir, 'x.compactset');
    hookSet(set, 1);
    const rc = cardCommand({ transcript, cwd: dir, graph, labels, out, set, maxChars: 4000, maxFiles: 12,
      built: 'b', fresh: 'fresh', scope: 'main', agent: null, at: 1, nonce: 'nonce-1' });
    expect(rc).toBe(EXIT.EMPTY);
    const s = JSON.parse(fs.readFileSync(set, 'utf8'));
    expect(s.files).toEqual([]);
    expect(s.stats).toMatchObject({ tokens: 1, resolved: 0, ambiguous: 1, outside: 0, nomatch: 0 });
    expect(fs.existsSync(out)).toBe(false);
  });
});

describe('measure — the summary the session will see (spec §3.4)', () => {
  it('normalises as the harness does: the FIRST <analysis> dropped, <summary> REPLACED by a Summary: line, blank runs collapsed, trimmed', () => {
    const raw = '\n<analysis>scratch\nwork</analysis>\n\n\n<summary>\n  Hello world\n\n\n\nmore\n</summary>\n<analysis>kept: only the first goes</analysis>\n\n';
    expect(normalizeSummary(raw)).toBe('Summary:\nHello world\n\nmore\n<analysis>kept: only the first goes</analysis>');
    expect(normalizeSummary('plain text')).toBe('plain text');
  });

  it('filesChars spans the "Files and Code Sections" heading to the next numbered heading, tolerating # ** case and a colon; null when absent', () => {
    const a = '1. Primary Request:\nx\n3. Files and Code Sections:\n- a.ts\n- b.ts\n4. Errors and fixes:\nnone\n';
    expect(filesSectionChars(a)).toBe('3. Files and Code Sections:\n- a.ts\n- b.ts\n'.length);
    const b = '**1. Primary Request**\nx\n## **3. files and code sections**\n- a.ts\n**4. Errors and Fixes:**\nnone';
    expect(filesSectionChars(b)).toBe('## **3. files and code sections**\n- a.ts\n'.length);
    expect(filesSectionChars('3. Files and Code Sections:\n- only section, to EOF')).toBe('3. Files and Code Sections:\n- only section, to EOF'.length);
    expect(filesSectionChars('no headings here\n\x60\x60\x60ts\ncode\n\x60\x60\x60')).toBeNull();
  });

  it('the heading scan recognizes Markdown backtick fences, not arbitrary triple-backtick substrings (Minor 2, fix round 1, D-2553)', () => {
    const F3 = '\x60'.repeat(3), F4 = '\x60'.repeat(4);
    // An inline triple-backtick string is prose, rather than a fence that
    // makes the real heading below look like code.
    const inline = `3. Files and Code Sections:\n- a.ts ${F3} literal\n4. Next:\nnone`;
    expect(filesSectionChars(inline)).toBe(`3. Files and Code Sections:\n- a.ts ${F3} literal\n`.length);
    expect(measureCommand(inline, null, 'auto').fences).toBe(0);

    // A three-backtick opener accepts a wider Markdown closing fence. The
    // literal triple-backtick string in its code must not form another fence.
    const triple = `3. Files and Code Sections:\n${F3}ts\n1. not a real heading\nliteral ${F3} stays code\n${F4}\n- b.ts\n4. Next:\nnone`;
    expect(filesSectionChars(triple)).toBe(`3. Files and Code Sections:\n${F3}ts\n1. not a real heading\nliteral ${F3} stays code\n${F4}\n- b.ts\n`.length);
    expect(measureCommand(triple, null, 'auto').fences).toBe(1);

    // A four-backtick opener stays open across a shorter triple-backtick line;
    // only an equally wide close ends the fenced region.
    const four = `3. Files and Code Sections:\n   ${F4}ts\n${F3}\n1. still code\nliteral ${F3} stays code\n   ${F4}\n- b.ts\n4. Next:\nnone`;
    expect(filesSectionChars(four)).toBe(`3. Files and Code Sections:\n   ${F4}ts\n${F3}\n1. still code\nliteral ${F3} stays code\n   ${F4}\n- b.ts\n`.length);
    expect(measureCommand(four, null, 'auto').fences).toBe(1);

    // A fake Files heading inside a fence is not a candidate start; only the
    // following prose heading starts the measured section.
    const nestedStart = `${F3}\n3. Files and Code Sections:\n- fake.ts\n${F3}\n3. Files and Code Sections:\n- real.ts\n4. Next:\nnone`;
    expect(filesSectionChars(nestedStart)).toBe('3. Files and Code Sections:\n- real.ts\n'.length);
    // An unmatched opening fence covers the remaining text, including what
    // otherwise looks like a terminating numbered heading.
    const unpaired = `3. Files and Code Sections:\n- a.ts\n${F3}\n4. not a real heading`;
    expect(filesSectionChars(unpaired)).toBe(unpaired.length);
    expect(measureCommand(unpaired, null, 'auto').fences).toBe(0);
  });

  it('cited counts a set file when its path appears, or a UNIQUE suffix of at least two segments does — never a bare basename', () => {
    const paths = ['server/src/pane/statusline.ts', 'server/src/watch.ts', 'pwa/src/watch.ts'];
    expect(citedCount('touched server/src/pane/statusline.ts', paths)).toBe(1);
    expect(citedCount('see pane/statusline.ts', paths)).toBe(1);            // unique 2-segment suffix
    expect(citedCount('see statusline.ts', paths)).toBe(0);                 // a bare basename is not a citation
    expect(citedCount('see src/watch.ts', paths)).toBe(0);                  // ambiguous within the set
    expect(citedCount('see server/src/watch.ts and pwa/src/watch.ts', paths)).toBe(2);
  });

  it('full paths and unique suffixes require both path-character boundaries (Minor 3, fix round 1)', () => {
    const paths = ['a/b/c.ts', 'x/a/b/c.ts'];
    // Only the longer path is actually named; the shorter one is not a
    // standalone citation just because its characters occur in the longer
    // path's own text (path-segment-aligned per spec §3.4).
    expect(citedCount('see x/a/b/c.ts here', paths)).toBe(1);
    // Naming BOTH, each at its own path-character boundaries, credits both.
    expect(citedCount('see a/b/c.ts and x/a/b/c.ts', paths)).toBe(2);
    // A full path must not be credited as the prefix of another token.
    expect(citedCount('see a/b/c.tsx', ['a/b/c.ts', 'a/b/c.tsx'])).toBe(1);
    // Nor can a unique multi-segment suffix begin inside a larger path token.
    expect(citedCount('see nota/b/c.ts', ['x/a/b/c.ts'])).toBe(0);
  });

  it('measureCommand: the fields, and null — never 0 or main — without a set or without files', () => {
    const F = '\x60\x60\x60';                                       // a fence, never literal in a test file
    const text = `3. Files and Code Sections:\n- server/src/watch.ts\n${F}ts\nx\n${F}\n4. Next:\n${F}\ny\n${F}\n${F}`;
    const set = { v: 1, at: 1, nonce: 'nonce-1', scope: 'subagent', agent: 'a1', transcript: '/t', cwd: '/w', built: 'b', fresh: 'fresh', steered: true,
      files: [{ path: 'server/src/watch.ts', tag: 'edited', count: 1 }, { path: 'pwa/src/lib/models.ts', tag: 'touched', count: 1 }], stats: null };
    const t0 = Date.now();
    const m = measureCommand(text, set as any, 'auto');
    const t1 = Date.now();
    expect(m).toMatchObject({ trigger: 'auto', scope: 'subagent', chars: text.length, fences: 2, cited: 1, setSize: 2, steered: true, served: false });
    expect(measureCommand(text, { ...set, served: true } as any, 'auto').served).toBe(true);
    expect(m.filesChars).toBe(`3. Files and Code Sections:\n- server/src/watch.ts\n${F}ts\nx\n${F}\n`.length);
    // Number.isInteger alone stays green under a constant or frozen `at` —
    // pin it against a real window captured around the call (Minor 4a).
    expect(Number.isInteger(m.at)).toBe(true);
    expect(m.at).toBeGreaterThanOrEqual(t0);
    expect(m.at).toBeLessThanOrEqual(t1);
    expect(measureCommand(text, null, 'manual')).toMatchObject({ scope: null, cited: null, setSize: null, steered: false, served: false, trigger: 'manual' });
    expect(measureCommand(text, { ...set, scope: 'ambiguous', files: null } as any, 'auto')).toMatchObject({ scope: 'ambiguous', cited: null, setSize: null });
    expect(measureCommand(text, { ...set, scope: 'parent' } as any, 'auto').scope).toBeNull();
  });

  it('a malformed files[] entry makes set-derived fields unknown, while a valid empty set remains measured empty (Minor 1, fix round 1)', () => {
    const base = { v: 1, at: 1, nonce: 'nonce-1', scope: 'main', agent: null, transcript: '/t', cwd: '/w', built: 'b', fresh: 'fresh', steered: false, served: false, stats: null };
    // Any malformed entry invalidates the working-set denominator. It must
    // never crash, phantom-cite, or turn the result into a smaller valid set.
    expect(() => measureCommand('nothing relevant here', { ...base, files: [null] } as any, 'auto')).not.toThrow();
    expect(measureCommand('nothing relevant here', { ...base, files: [null] } as any, 'auto')).toMatchObject({ setSize: null, cited: null });
    expect(measureCommand('no numbers here at all', { ...base, files: [{ path: 5 }] } as any, 'auto')).toMatchObject({ setSize: null, cited: null });
    const phantom = measureCommand('mentions undefined right here', { ...base, files: [{}] } as any, 'auto');
    expect(phantom).toMatchObject({ setSize: null, cited: null });
    expect(measureCommand('', { ...base, files: [{ path: '' }] } as any, 'auto')).toMatchObject({ setSize: null, cited: null });
    // Mixed malformed and valid entries are still unknown, not a filtered
    // denominator that makes the valid path look complete.
    const mixed = measureCommand('touched server/src/watch.ts', { ...base,
      files: [null, {}, { path: '' }, { path: 5 }, { path: 'server/src/watch.ts', tag: 'edited', count: 1 }] } as any, 'auto');
    expect(mixed).toMatchObject({ setSize: null, cited: null });
    expect(measureCommand('', { ...base, files: [] } as any, 'auto')).toMatchObject({ setSize: 0, cited: 0 });
  });

  it('as the hook runs it: stdin in, one JSON line out, the trailing newline jq -r adds is not counted; exit 2 on a bad trigger; a bad set is NO set', () => {
    const set = write('s.compactset', JSON.stringify({ v: 1, at: 1, nonce: 'nonce-1', scope: 'main', agent: null, transcript: '/t', cwd: null, built: null, fresh: null, steered: false, served: false, files: [], stats: null }) + '\n');
    const r = helper(['measure', '--set', set, '--trigger', 'manual'], 'hello world\n');
    expect(r.status).toBe(EXIT.OK);
    expect(r.stdout.split('\n').filter(Boolean)).toHaveLength(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ chars: 11, scope: 'main', cited: 0, setSize: 0, trigger: 'manual', served: false });
    expect(helper(['measure', '--trigger', 'weird'], 'x').status).toBe(EXIT.USAGE);
    const bad = helper(['measure', '--set', write('bad.compactset', '{nope'), '--trigger', 'auto'], 'x');
    expect(bad.status).toBe(EXIT.OK);
    expect(JSON.parse(bad.stdout)).toMatchObject({ chars: 1, scope: null, cited: null, setSize: null });
    expect(helper(['measure', '--set', path.join(dir, 'absent'), '--trigger', 'auto'], 'x').status).toBe(EXIT.OK);
  });

  it('a set whose files[] carries a malformed entry leaves the real CLI set-derived fields unknown (Minor 1, fix round 1)', () => {
    const set = write('malformed-files.compactset', JSON.stringify({ v: 1, at: 1, nonce: 'n', scope: 'main',
      agent: null, transcript: '/t', cwd: null, built: null, fresh: null, steered: false, served: false,
      files: [null, { path: '' }, { path: 5 }], stats: null }) + '\n');
    const r = helper(['measure', '--set', set, '--trigger', 'auto'], 'mentions undefined nowhere useful');
    expect(r.status).toBe(EXIT.OK);
    expect(JSON.parse(r.stdout)).toMatchObject({ setSize: null, cited: null });
  });
});
