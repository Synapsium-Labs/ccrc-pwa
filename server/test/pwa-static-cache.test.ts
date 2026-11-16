// The PWA's static files must let a deployed release reach a browser that already
// has the service worker installed.
//
// Measured on a live server (2026-10-16): every release ships `sw.js` at the same
// size (the precache manifest's hashed names keep their length) with mtime 0 (the
// release tarball's), so @fastify/static's default validator, the weak ETag
// `W/"<size hex>-<mtime>"`, was `W/"82a-0"` for every release. The browser's update
// check revalidates `sw.js` with `If-None-Match`, got a 304 every time, and never
// installed the new worker, so the old bundle stayed in place after every deploy.
// `pwaStaticOptions` sends no size/mtime validator at all: the non-hashed files are
// `no-cache` and always answered in full (they are small), and only the
// content-hashed `/assets/*` files are cached, as `immutable`.
//
// The first-load compression plan (2026-11-03, Task 3): the build writes a Brotli (`<file>.br`) and a gzip
// (`<file>.gz`) copy beside each script, stylesheet and SVG under assets/, and `pwaStaticOptions` turns on
// @fastify/static's `preCompressed`, so a browser gets the copy its Accept-Encoding takes, with the file's own type
// and cache policy, and every file answer varies on Accept-Encoding. The shell has no copy and is sent as it is.
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { brotliCompressSync, brotliDecompressSync, gunzipSync, gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PWA_ASSET_CACHE, PWA_SHELL_CACHE, pwaStaticOptions } from '../src/pwaStatic.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// The copies a build writes (`pwa/build/compressAssets.ts`), made here with node:zlib: a script with both, a stylesheet
// with its .gz only (the build leaves out a copy that is not smaller, each encoding alone), and the tiny script below
// with none.
const APP = 'assets/app-EfGh5678.js';
const STYLE = 'assets/style-IjKl9012.css';
const appBytes = Buffer.from(Array.from({ length: 400 }, (_, i) => `export const value${i % 37}=${i};`).join(''));
const styleBytes = Buffer.from(Array.from({ length: 300 }, (_, i) => `.row-${i % 23}{padding:${i % 7}px}`).join(''));

let root: string;
let app: FastifyInstance;

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'pwa-static-'));
  mkdirSync(path.join(root, 'assets'));
  writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>fixture</title>');
  writeFileSync(path.join(root, 'sw.js'), 'self.__WB_MANIFEST = [];');
  writeFileSync(path.join(root, 'manifest.webmanifest'), '{}');
  writeFileSync(path.join(root, 'assets', 'index-AbCd1234.js'), 'console.log(1)');
  writeFileSync(path.join(root, APP), appBytes);
  writeFileSync(path.join(root, `${APP}.br`), brotliCompressSync(appBytes));
  writeFileSync(path.join(root, `${APP}.gz`), gzipSync(appBytes));
  writeFileSync(path.join(root, STYLE), styleBytes);
  writeFileSync(path.join(root, `${STYLE}.gz`), gzipSync(styleBytes));
  // The release tarball's mtime, as measured: 0 on every file.
  for (const f of ['index.html', 'sw.js', 'manifest.webmanifest', 'assets/index-AbCd1234.js',
    APP, `${APP}.br`, `${APP}.gz`, STYLE, `${STYLE}.gz`]) {
    utimesSync(path.join(root, f), 0, 0);
  }
  app = Fastify();
  await app.register(fastifyStatic, pwaStaticOptions(root));
  app.setNotFoundHandler((_req, reply) => reply.type('text/html').sendFile('index.html'));
  await app.ready();
});

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe('the PWA static files carry no size/mtime validator', () => {
  it('sw.js is no-cache with no ETag or Last-Modified, so a revalidation is answered in full', async () => {
    const res = await app.inject({ method: 'GET', url: '/sw.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['etag'], 'a size-mtime ETag repeats across releases').toBeUndefined();
    expect(res.headers['last-modified'], 'the release mtime is 0 on every file').toBeUndefined();
    expect(res.headers['cache-control']).toBe(PWA_SHELL_CACHE);
  });

  it("the browser's update check with the old validator gets a 200, never a 304", async () => {
    const res = await app.inject({
      method: 'GET', url: '/sw.js',
      headers: { 'if-none-match': 'W/"18-0"', 'if-modified-since': new Date(0).toUTCString() },
    });
    expect(res.statusCode, 'a 304 here is what kept every browser on the old bundle').toBe(200);
    expect(res.body).toBe('self.__WB_MANIFEST = [];');
  });

  it('index.html, served directly and as the SPA fallback, is no-cache too', async () => {
    for (const url of ['/index.html', '/s/project-a']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['etag'], url).toBeUndefined();
      expect(res.headers['cache-control'], url).toBe(PWA_SHELL_CACHE);
    }
  });

  it('other non-hashed files (the web manifest) are no-cache', async () => {
    const res = await app.inject({ method: 'GET', url: '/manifest.webmanifest' });
    expect(res.headers['cache-control']).toBe(PWA_SHELL_CACHE);
  });

  it('only the content-hashed /assets/* files are cached, as immutable', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/index-AbCd1234.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe(PWA_ASSET_CACHE);
    expect(PWA_ASSET_CACHE).toMatch(/\bimmutable\b/);
    expect(PWA_SHELL_CACHE).toBe('no-cache');
  });
});

describe('the server registers the PWA root through pwaStaticOptions', () => {
  it('server.ts hands fastifyStatic the shared options, not its own', () => {
    const src = readFileSync(path.join(here, '..', 'src', 'server.ts'), 'utf8');
    const calls = [...src.matchAll(/app\.register\(\s*fastifyStatic\s*,\s*(.+?)\);/g)].map((m) => (m[1] ?? '').trim());
    expect(calls, 'one registration of the PWA root').toHaveLength(1);
    expect(calls[0]).toBe('pwaStaticOptions(pwaRoot)');
  });
});

// The first-load compression plan (2026-11-03, Task 3). @fastify/static negotiates the request's Accept-Encoding: the
// coding with the highest q-value wins, its own order (br, gzip, deflate) breaks ties, and a missing copy falls through
// to the next accepted coding and then to the file itself. Chrome on Android sends `gzip, deflate, br, zstd`.
describe('the hashed /assets/* files are sent precompressed, chosen by Accept-Encoding', () => {
  const CHROME = 'gzip, deflate, br, zstd';
  const get = (url: string, acceptEncoding?: string) => app.inject({
    method: 'GET', url, headers: acceptEncoding === undefined ? {} : { 'accept-encoding': acceptEncoding },
  });
  const variesOnEncoding = (vary: unknown): boolean =>
    String(vary ?? '').toLowerCase().split(',').map((t) => t.trim()).includes('accept-encoding');
  const mediaType = (type: unknown): string => String(type ?? '').split(';')[0]!.trim().toLowerCase();

  it('pwaStaticOptions turns on preCompressed', () => {
    expect(pwaStaticOptions(root).preCompressed).toBe(true);
  });

  it('a browser that takes br gets the .br: br, varying on Accept-Encoding, the asset cache and type, bytes that decode to the asset', async () => {
    const plain = await get(`/${APP}`);
    expect(mediaType(plain.headers['content-type'])).toMatch(/javascript/);
    for (const ae of [CHROME, 'br']) {
      const res = await get(`/${APP}`, ae);
      expect(res.statusCode, ae).toBe(200);
      expect(res.headers['content-encoding'], ae).toBe('br');
      expect(variesOnEncoding(res.headers['vary']), ae).toBe(true);
      expect(res.headers['cache-control'], ae).toBe(PWA_ASSET_CACHE);
      expect(mediaType(res.headers['content-type']), ae).toBe(mediaType(plain.headers['content-type']));
      expect(res.rawPayload.equals(readFileSync(path.join(root, `${APP}.br`))), ae).toBe(true);
      expect(brotliDecompressSync(res.rawPayload).equals(appBytes), ae).toBe(true);
    }
  });

  it('a browser that takes gzip and not br gets the .gz', async () => {
    for (const ae of ['gzip, deflate', 'gzip']) {
      const res = await get(`/${APP}`, ae);
      expect(res.statusCode, ae).toBe(200);
      expect(res.headers['content-encoding'], ae).toBe('gzip');
      expect(variesOnEncoding(res.headers['vary']), ae).toBe(true);
      expect(res.headers['cache-control'], ae).toBe(PWA_ASSET_CACHE);
      expect(gunzipSync(res.rawPayload).equals(appBytes), ae).toBe(true);
    }
  });

  it('a browser that takes neither gets the file itself, still immutable and still varying on Accept-Encoding', async () => {
    for (const ae of [undefined, 'identity', 'zstd']) {
      const res = await get(`/${APP}`, ae);
      expect(res.statusCode, String(ae)).toBe(200);
      expect(res.headers['content-encoding'], String(ae)).toBeUndefined();
      expect(variesOnEncoding(res.headers['vary']), String(ae)).toBe(true);
      expect(res.headers['cache-control'], String(ae)).toBe(PWA_ASSET_CACHE);
      expect(res.rawPayload.equals(appBytes), String(ae)).toBe(true);
    }
  });

  it('q-values order the codings: br;q=0.5, gzip;q=1 gets the .gz', async () => {
    const res = await get(`/${APP}`, 'br;q=0.5, gzip;q=1');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(res.rawPayload).equals(appBytes)).toBe(true);
    expect(res.headers['cache-control']).toBe(PWA_ASSET_CACHE);
  });

  it('a refused coding is never sent: br;q=0, gzip gets the .gz, and br;q=0 alone gets the file', async () => {
    const gz = await get(`/${APP}`, 'br;q=0, gzip');
    expect(gz.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(gz.rawPayload).equals(appBytes)).toBe(true);
    const plain = await get(`/${APP}`, 'br;q=0');
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.rawPayload.equals(appBytes)).toBe(true);
    expect(variesOnEncoding(plain.headers['vary'])).toBe(true);
  });

  it('a copy the build left out is skipped: br falls back to the .gz, and a file with no copy is sent as itself', async () => {
    const style = await get(`/${STYLE}`, CHROME);
    expect(style.headers['content-encoding']).toBe('gzip');
    expect(style.headers['cache-control']).toBe(PWA_ASSET_CACHE);
    expect(gunzipSync(style.rawPayload).equals(styleBytes)).toBe(true);
    const tiny = await get('/assets/index-AbCd1234.js', CHROME);
    expect(tiny.headers['content-encoding']).toBeUndefined();
    expect(tiny.headers['cache-control']).toBe(PWA_ASSET_CACHE);
    expect(tiny.body).toBe('console.log(1)');
  });

  // The fixture holds no copy beside a shell file, exactly as the build leaves the tree (it writes copies
  // under `assets/` only, rows FLC-T1-M2 and FLC-T2-M3), so this case records the server's answer for that
  // tree; it is not a server-side guard, since @fastify/static would send a shell copy if one existed (see
  // the plan's refinement (f)).
  it('with no shell copy on disk, the shell and the SPA fallback are sent as they are: /, index.html, a Docs page and another route through the fallback, sw.js, the manifest', async () => {
    const shell = '<!doctype html><title>fixture</title>';
    const cases: [string, string][] = [
      ['/', shell], ['/index.html', shell], ['/docs/demo/specs/a.md', shell], ['/s/project-a', shell],
      ['/sw.js', 'self.__WB_MANIFEST = [];'], ['/manifest.webmanifest', '{}'],
    ];
    for (const [url, body] of cases) {
      const res = await get(url, CHROME);
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-encoding'], url).toBeUndefined();
      expect(res.headers['cache-control'], url).toBe(PWA_SHELL_CACHE);
      expect(res.body, url).toBe(body);
    }
  });
});
