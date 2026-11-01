// The BUILT reader keeps the frame's assets out of the shell's precache (native Docs reader, wave 8a; spec rows A9,
// M8.13, M8.14 as read by refinement (i)). Nothing in the source tree shows what the bundler and the PWA plugin emit,
// so this file runs the app's own `vite build` (its own config, into a temporary directory, as fonts-built.test.ts
// and markdown-worker-built.test.ts do) and reads the output:
// - exactly one emitted file is the Mermaid script's chunk, and the generated service worker does not precache it
//   (`globIgnores` in vite.config.ts; without it the plugin's size ceiling throws and the build fails);
// - the guard, bootstrap, enhance and reader stylesheet chunks, and the render job's chunk, ARE precached, so a client
//   offline can still open and render a document in the reader;
// - each of the five frame assets reaches the bundle as exactly one chunk holding its text exactly;
// - the built shell holds the one Content-Security-Policy meta, `frame-src 'none'`, before any script, style,
//   stylesheet link or module preload;
// - the Geist pair is still precached.
// A `?raw` import is emitted as a JS string literal: quotes, newlines and non-ASCII characters are escaped in the
// chunk, and every frame script opens with `"use strict";` and a newline, so a chunk is never found by matching the
// asset's raw text. It is found by CONTENT: a node child imports every emitted chunk that is a bare string module,
// hashes its default export (sha256 of the UTF-8 bytes) and the hash is looked up in the library's manifest.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { FRAME_MANIFEST } from '@synapsium-labs/docserver/frame';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PWA = path.join(import.meta.dirname, '..');
let out = '';
let hashed: Array<{ file: string; sha256: string }> = [];

// Runs in a node child, cwd the PWA package: a production build of the app's own config into argv[1]. Not in this
// file's jsdom realm, whose URL the PWA plugin's file writes reject. CCRC_SW_DENYLIST is left unset (the env below
// carries only PATH, HOME and NODE_ENV).
const BUILDER = `
import { build } from 'vite';
await build({ configFile: 'vite.config.ts', logLevel: 'error', build: { outDir: process.argv[1], emptyOutDir: true } });
`;

// Runs in a node child over the emitted assets directory (argv[1]). A chunk is a candidate only when it opens with no
// static import and closes with `export{x as default}`: a bare string module, which has nothing to run. Each candidate
// is imported, and one whose default export is a string is hashed (sha256 of its UTF-8 bytes). Prints one JSON line.
const HASHER = `
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = process.argv[1];
const found = [];
for (const file of readdirSync(dir).filter((n) => n.endsWith('.js')).sort()) {
  const text = readFileSync(path.join(dir, file), 'utf8');
  if (/^\\s*import\\b/.test(text) || !/export\\s*\\{\\s*[\\w$]+\\s+as\\s+default\\s*\\}\\s*;?\\s*$/.test(text)) continue;
  let mod;
  try { mod = await import(pathToFileURL(path.join(dir, file)).href); } catch { continue; }
  if (typeof mod.default !== 'string') continue;
  found.push({ file, sha256: createHash('sha256').update(mod.default, 'utf8').digest('hex') });
}
process.stdout.write(JSON.stringify(found) + '\\n');
`;

const childEnv = (): Record<string, string> => {
  const env: Record<string, string> = { PATH: process.env['PATH'] ?? '', NODE_ENV: 'production' };
  if (process.env['HOME'] !== undefined) env['HOME'] = process.env['HOME'];
  return env;
};

beforeAll(() => {
  out = mkdtempSync(path.join(tmpdir(), 'ccrc-reader-built-'));
  execFileSync(process.execPath, ['--input-type=module', '-e', BUILDER, out],
    { cwd: PWA, env: childEnv(), encoding: 'utf8', timeout: 170_000, stdio: ['ignore', 'pipe', 'pipe'] });
  const printed = execFileSync(process.execPath, ['--input-type=module', '-e', HASHER, path.join(out, 'assets')],
    { cwd: PWA, env: childEnv(), encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
  hashed = JSON.parse(printed.trim().split('\n').pop() ?? '[]') as typeof hashed;
}, 240_000);

afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true });
});

const sw = (): string => readFileSync(path.join(out, 'sw.js'), 'utf8');

/** The urls `sw.js` hands to `precacheAndRoute`, as the build wrote them (relative to the shell root). */
const precached = (): string[] => {
  const manifest = /precacheAndRoute\(\[(.*?)\],/s.exec(sw());
  expect(manifest, 'sw.js calls precacheAndRoute with a manifest').not.toBeNull();
  return [...manifest![1]!.matchAll(/url:"([^"]+)"/g)].map((m) => m[1]!);
};

/** The emitted chunk (`assets/<name>`) whose default export hashes to `sha256`; exactly one, or the test says so. */
const chunkOf = (sha256: string): string => {
  const hits = hashed.filter((h) => h.sha256 === sha256).map((h) => `assets/${h.file}`);
  expect(hits, `exactly one emitted chunk carries the asset hashed ${sha256}`).toHaveLength(1);
  return hits[0]!;
};

describe('the built reader and the precache (A9, M8.13, M8.14 as read by refinement (i))', () => {
  it('exactly one emitted file matches mermaid.frame-*.js', () => {
    const hits = readdirSync(path.join(out, 'assets')).filter((n) => /^mermaid\.frame-.+\.js$/.test(n));
    expect(hits).toHaveLength(1);
  });

  it('sw.js precaches no file that carries the Mermaid asset', () => {
    const urls = precached();
    const mermaid = chunkOf(FRAME_MANIFEST.mermaid.sha256);
    expect(urls).not.toContain(mermaid);
    expect(urls.filter((u) => path.posix.basename(u).startsWith('mermaid.frame-'))).toEqual([]);
    // The chunk found by content is the one the build named for the Mermaid module, so the two ways of finding it agree.
    expect(path.posix.basename(mermaid)).toMatch(/^mermaid\.frame-.+\.js$/);
  });

  it('sw.js precaches the chunks that carry guard, bootstrap, enhance and the reader css', () => {
    const urls = precached();
    for (const key of ['guard', 'bootstrap', 'enhance', 'css'] as const) {
      expect(urls, `${key} (${FRAME_MANIFEST[key].path})`).toContain(chunkOf(FRAME_MANIFEST[key].sha256));
    }
    // And the render job's lazy chunk, so a client offline can still render. Found by its name pattern AND its
    // content: lib/readerRenderJob.ts's chunk exports `answerRenderJob` (the parse worker's first render job imports it).
    const assets = path.join(out, 'assets');
    const job = readdirSync(assets).filter((n) => /^readerRenderJob-.+\.js$/.test(n)
      && /\banswerRenderJob\b/.test(readFileSync(path.join(assets, n), 'utf8')));
    expect(job, 'one emitted readerRenderJob chunk that exports answerRenderJob').toHaveLength(1);
    expect(urls).toContain(`assets/${job[0]}`);
  });

  it("the emitted chunks carry each frame asset's text exactly", () => {
    const chunks = (['guard', 'bootstrap', 'enhance', 'css', 'mermaid'] as const).map((k) => chunkOf(FRAME_MANIFEST[k].sha256));
    expect(new Set(chunks).size).toBe(5);
  });

  it('the built index.html holds the one frame-src none meta before any script', () => {
    const html = readFileSync(path.join(out, 'index.html'), 'utf8');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const all = [...doc.querySelectorAll('*')];
    const metas = all.filter((e) => e.tagName === 'META' && (e.getAttribute('http-equiv') ?? '').toLowerCase() === 'content-security-policy');
    expect(metas).toHaveLength(1);
    const directives = (metas[0]!.getAttribute('content') ?? '').split(';').map((d) => d.trim()).filter((d) => d !== '')
      .map((d) => d.split(/[\t\n\f\r ]+/));
    expect(directives).toEqual([['frame-src', "'none'"]]);
    const at = all.indexOf(metas[0]!);
    // Every element that can start a load or run code: scripts, styles, stylesheet links and module preloads.
    const loads = all.filter((e) => e.tagName === 'SCRIPT' || e.tagName === 'STYLE'
      || (e.tagName === 'LINK' && ['stylesheet', 'modulepreload'].includes((e.getAttribute('rel') ?? '').toLowerCase())));
    expect(loads.length).toBeGreaterThan(0);
    for (const el of loads) expect(at, `the meta precedes <${el.tagName.toLowerCase()} ${el.getAttribute('rel') ?? el.getAttribute('src') ?? ''}>`).toBeLessThan(all.indexOf(el));
  });

  it("ccrc's own Geist woff2 files are still precached", () => {
    const urls = precached();
    const assets = readdirSync(path.join(out, 'assets'));
    for (const re of [/^Geist-Variable-[\w-]+\.woff2$/, /^GeistMono-Variable-[\w-]+\.woff2$/]) {
      const hits = assets.filter((n) => re.test(n));
      expect(hits, `one emitted file matching ${re}`).toHaveLength(1);
      expect(urls).toContain(`assets/${hits[0]}`);
    }
  });
});
