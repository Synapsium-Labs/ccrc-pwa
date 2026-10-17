import path from 'node:path';
import type { FastifyStaticOptions } from '@fastify/static';

/** The cache policy of the PWA's non-hashed files (`index.html`, `sw.js`, the web manifest, icons). */
export const PWA_SHELL_CACHE = 'no-cache';
/** The cache policy of Vite's content-hashed `/assets/*` files: a new build gives a new name. */
export const PWA_ASSET_CACHE = 'public, max-age=31536000, immutable';

/**
 * How `dist-pwa/` is served. @fastify/static's default validators are a weak ETag built from the
 * file's size and mtime, and a Last-Modified from its mtime. A release unpacks every file with
 * mtime 0, and `sw.js` keeps the same size from release to release (its precache manifest names
 * hashed files of fixed length), so both validators stayed the same across releases and the
 * browser's service-worker update check got a 304 every time: a deploy never reached a browser
 * that had the worker installed (measured 2026-10-16: `W/"82a-0"` on every release since v0.0.202).
 * So no validator is sent; the shell files are `no-cache` and always answered in full (they are
 * small), and only the content-hashed assets are cached.
 */
export function pwaStaticOptions(root: string): FastifyStaticOptions {
  const assets = path.join(root, 'assets') + path.sep;
  return {
    root,
    etag: false,
    lastModified: false,
    cacheControl: false,
    // @fastify/static 10 hands `setHeaders` the Fastify reply (not the raw response).
    setHeaders: (reply, file) => {
      reply.header('cache-control', file.startsWith(assets) ? PWA_ASSET_CACHE : PWA_SHELL_CACHE);
    },
  };
}
