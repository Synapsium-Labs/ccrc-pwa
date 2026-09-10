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
import { tl, GRAPH, graphJson } from './compactCardFixtures.js';
import {
  EXIT, WINDOW_CAP, CHUNK, isBoundaryLine, readWindow, parseArgs,
  extensionsOf, tokenRegex, mineTokens, fileIndex, resolveToken, workingSet, WORKSET_CAP,
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

  it('the token regex is DERIVED from the graph\'s own extensions, longest first, anchored on both sides', () => {
    expect(extensionsOf(['a/b.ts', 'c.tsx', 'ccd/ccd', 'x.d.mts', '.hidden', 'noext.'])).toEqual(['mts', 'tsx', 'ts']);
    expect(tokenRegex([])).toBeNull();
    expect('run foo.tsx and bar.ts, not baz.tsz nor _qux.ts_'.match(tokenRegex(['tsx', 'ts'])!)).toEqual(['foo.tsx', 'bar.ts']);
    expect('a c++ file x.c+ and y.c'.match(tokenRegex(['c+', 'c'])!)).toEqual(['x.c+', 'y.c']);   // escaped
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
  it('the set keeps at most WORKSET_CAP files', () => {
    const many = fileIndex(Array.from({ length: 150 }, (_, i) => `f${i}.ts`));
    const tokens = [...many.files].map((t) => ({ token: t, tag: 'touched' as const }));
    expect(workingSet(tokens, many, '/w').files).toHaveLength(WORKSET_CAP);
    expect(WORKSET_CAP).toBe(100);
  });
});
