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
