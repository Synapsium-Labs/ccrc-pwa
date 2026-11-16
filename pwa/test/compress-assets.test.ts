// The PWA's precompressed assets, the build step alone (native Docs reader, the first-load compression plan of
// 2026-11-03, Task 1): `build/compressAssets.ts` over a temporary directory. Every script, stylesheet and SVG gets a
// Brotli copy and a gzip copy beside it, each smaller and each decoding to the file's bytes; a copy that would not be
// smaller is not written, each encoding decided alone; every other file is left alone; no file it was given changes
// its name or a byte. What the real build emits is read by reader-built.test.ts.
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { brotliCompressSync, brotliDecompressSync, constants, gunzipSync, gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { BROTLI_QUALITY, compressAssets } from '../build/compressAssets';

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A fresh directory holding `files` (a relative name to its content). */
function dirWith(files: Record<string, string | Buffer>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ccrc-compress-'));
  made.push(dir);
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), body);
  }
  return dir;
}

/** Every file under `dir`, by its relative name, to its sha256. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!d.isFile()) continue;
    const abs = path.join(d.parentPath, d.name);
    out[path.relative(dir, abs)] = createHash('sha256').update(readFileSync(abs)).digest('hex');
  }
  return out;
}

// The shapes of what the bundle emits: a few kilobytes each, as repetitive as minified output, and no colour value.
const script = (n: number): string => Array.from({ length: n }, (_, i) => `export const value${i % 37}=${i};`).join('');
const styles = (n: number): string => Array.from({ length: n }, (_, i) => `.row-${i % 23}{padding:${i % 7}px}`).join('');
const svg = (n: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg">${Array.from({ length: n }, (_, i) => `<path d="M${i} 0L0 ${i}"/>`).join('')}</svg>`;

const BUNDLE: Record<string, string> = {
  'index-AbCd1234.js': script(400),
  'index-EfGh5678.css': styles(300),
  'icon-IjKl9012.svg': svg(200),
};

describe('compressAssets (first-load compression plan, Task 1)', () => {
  it('writes a .br and a .gz beside each script, stylesheet and SVG, each smaller and each decoding to the file', () => {
    const dir = dirWith(BUNDLE);
    const report = compressAssets(dir);
    expect(report.map((r) => r.file)).toEqual(Object.keys(BUNDLE).sort());
    for (const name of Object.keys(BUNDLE)) {
      const bytes = readFileSync(path.join(dir, name));
      const br = readFileSync(path.join(dir, `${name}.br`));
      const gz = readFileSync(path.join(dir, `${name}.gz`));
      expect(br.length, `${name}.br`).toBeLessThan(bytes.length);
      expect(gz.length, `${name}.gz`).toBeLessThan(bytes.length);
      expect(brotliDecompressSync(br).equals(bytes), `${name}.br`).toBe(true);
      expect(gunzipSync(gz).equals(bytes), `${name}.gz`).toBe(true);
    }
    expect(report.every((r) => r.br.kind === 'written' && r.gz.kind === 'written')).toBe(true);
  });

  it('changes no name and no byte of a file it was given, and adds exactly the copies', () => {
    const dir = dirWith(BUNDLE);
    const before = snapshot(dir);
    compressAssets(dir);
    const after = snapshot(dir);
    for (const [name, sha] of Object.entries(before)) expect(after[name], name).toBe(sha);
    expect(Object.keys(after).sort())
      .toEqual([...Object.keys(before), ...Object.keys(before).flatMap((n) => [`${n}.br`, `${n}.gz`])].sort());
  });

  it('writes no copy that is not smaller than its file, deciding each encoding alone', () => {
    // One byte: neither encoding is smaller. Twenty of one letter: Brotli's copy is smaller (about nine bytes), gzip's
    // is not (its frame alone is eighteen).
    const dir = dirWith({ 'tiny-AbCd1234.js': 'x', 'pad-EfGh5678.js': 'a'.repeat(20) });
    const report = compressAssets(dir);
    expect(report.map((r) => [r.file, r.br.kind, r.gz.kind])).toEqual([
      ['pad-EfGh5678.js', 'written', 'not-smaller'],
      ['tiny-AbCd1234.js', 'not-smaller', 'not-smaller'],
    ]);
    expect(Object.keys(snapshot(dir)).sort()).toEqual(['pad-EfGh5678.js', 'pad-EfGh5678.js.br', 'tiny-AbCd1234.js']);
  });

  it('leaves every other file alone: fonts, images, the shell, other text and copies already there', () => {
    const dir = dirWith({
      'Geist-AbCd1234.woff2': randomBytes(4096),
      'icon-EfGh5678.png': randomBytes(4096),
      'index.html': `<!doctype html><script>${script(100)}</script>`,
      'notes.txt': script(100),
      'data-IjKl9012.json': JSON.stringify(Array.from({ length: 300 }, (_, i) => i % 9)),
      'stray-MnOp3456.js.br': script(100),
      'stray-MnOp3456.js.gz': script(100),
    });
    const before = snapshot(dir);
    expect(compressAssets(dir)).toEqual([]);
    expect(snapshot(dir)).toEqual(before);
  });

  it('reaches a file in a directory below', () => {
    const dir = dirWith({ 'sub/chunk-QrSt7890.js': script(300) });
    expect(compressAssets(dir).map((r) => r.file)).toEqual([path.join('sub', 'chunk-QrSt7890.js')]);
    expect(brotliDecompressSync(readFileSync(path.join(dir, 'sub', 'chunk-QrSt7890.js.br'))).toString()).toBe(script(300));
    expect(gunzipSync(readFileSync(path.join(dir, 'sub', 'chunk-QrSt7890.js.gz'))).toString()).toBe(script(300));
  });

  it('the .br is Brotli at BROTLI_QUALITY, a ruled value, in text mode and the .gz gzip at level 9: the bytes zlib gives', () => {
    // The coordinator's ruling of 2026-11-03: 11, or 9 when 11 breaks the build bounds. The bytes below read the constant,
    // so that switch is one line in build/compressAssets.ts and reds nothing here.
    expect([9, 11], 'BROTLI_QUALITY is one of the two ruled values').toContain(BROTLI_QUALITY);
    const dir = dirWith(BUNDLE);
    compressAssets(dir);
    for (const name of Object.keys(BUNDLE)) {
      const bytes = readFileSync(path.join(dir, name));
      const br = brotliCompressSync(bytes, {
        params: {
          [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
          [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
          [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
        },
      });
      expect(readFileSync(path.join(dir, `${name}.br`)).equals(br), `${name}.br`).toBe(true);
      expect(readFileSync(path.join(dir, `${name}.gz`)).equals(gzipSync(bytes, { level: 9 })), `${name}.gz`).toBe(true);
    }
  });

  it('running it twice changes nothing', () => {
    const dir = dirWith(BUNDLE);
    compressAssets(dir);
    const once = snapshot(dir);
    compressAssets(dir);
    expect(snapshot(dir)).toEqual(once);
  });

  it('throws on a directory that is not there: a build with no assets/ is a broken build', () => {
    const dir = dirWith({});
    expect(() => compressAssets(path.join(dir, 'assets'))).toThrow(/ENOENT/);
  });
});
