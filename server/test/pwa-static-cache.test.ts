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
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PWA_ASSET_CACHE, PWA_SHELL_CACHE, pwaStaticOptions } from '../src/pwaStatic.js';

const here = path.dirname(fileURLToPath(import.meta.url));

let root: string;
let app: FastifyInstance;

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'pwa-static-'));
  mkdirSync(path.join(root, 'assets'));
  writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>fixture</title>');
  writeFileSync(path.join(root, 'sw.js'), 'self.__WB_MANIFEST = [];');
  writeFileSync(path.join(root, 'manifest.webmanifest'), '{}');
  writeFileSync(path.join(root, 'assets', 'index-AbCd1234.js'), 'console.log(1)');
  // The release tarball's mtime, as measured: 0 on every file.
  for (const f of ['index.html', 'sw.js', 'manifest.webmanifest', 'assets/index-AbCd1234.js']) {
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
