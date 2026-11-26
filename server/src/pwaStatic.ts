import path from 'node:path';
import type { FastifyStaticOptions } from '@fastify/static';

/** The cache policy of the PWA's non-hashed files (`index.html`, `sw.js`, the web manifest, icons). */
export const PWA_SHELL_CACHE = 'no-cache';
/** The cache policy of Vite's content-hashed `/assets/*` files: a new build gives a new name. */
export const PWA_ASSET_CACHE = 'public, max-age=31536000, immutable';

/**
 * The static plugin's `allowedPath` filter: false for the built review page, by every spelling it can be asked for
 * under (draft-review design §3.5; review finding N6 and advisory own-2). The page is a navigation with its own
 * header policy and is served only by its own route (`review/routes.ts`), which sends `no-store` and the policy; the
 * plugin would send it without them (and with `no-cache`), through the exempt static wildcard. @fastify/static hands
 * the filter a path it has already decoded once and normalised; this decodes it once more anyway, a conservative
 * choice (a failed decode answers false, so it can only refuse too much, never too little), then normalises it with
 * `path.posix.normalize` (a dot-segment or a doubled slash adds no spelling), lower-cases it (a case-insensitive file
 * system would otherwise serve `/Review.html`) and strips its leading and trailing slashes before it is compared.
 * A sibling named after the page (`review.html.br`, `review.html.gz`) is refused too, so the rule does not rest on
 * the build writing no compressed copy of the page. A refused path falls through to the plugin's not-found handler,
 * which answers the app shell, never the page. The router and the plugin's own path checks already refuse several of
 * today's odd spellings, so only the unit rows of `pwa-static-cache.test.ts` show the case rule red.
 */
function servesPwaPath(pathName: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathName);
  } catch {
    return false;
  }
  const spelled = path.posix.normalize(decoded).toLowerCase().replace(/^\/+|\/+$/g, '');
  return spelled !== 'review.html' && !spelled.startsWith('review.html.');
}

/**
 * How `dist-pwa/` is served. @fastify/static's default validators are a weak ETag built from the
 * file's size and mtime, and a Last-Modified from its mtime. A release unpacks every file with
 * mtime 0, and `sw.js` keeps the same size from release to release (its precache manifest names
 * hashed files of fixed length), so both validators stayed the same across releases and the
 * browser's service-worker update check got a 304 every time: a deploy never reached a browser
 * that had the worker installed (measured 2026-10-16: `W/"82a-0"` on every release since v0.0.202).
 * So no validator is sent; the shell files are `no-cache` and always answered in full (they are
 * small), and only the content-hashed assets are cached.
 *
 * The build writes a Brotli (`<file>.br`) and a gzip (`<file>.gz`) copy beside each script,
 * stylesheet and SVG under `assets/` (`pwa/build/compressAssets.ts`), and `preCompressed` sends the
 * one @fastify/static picks: br, gzip or deflate by the request's Accept-Encoding q-values (br first
 * among equals) and `*` read as gzip. A missing copy falls through to the next accepted coding, and
 * then to the file itself, which is also the answer when no coding is accepted. The build never
 * writes a `.deflate` copy, so a deflate pick always falls through. @fastify/static then sets
 * Content-Encoding and the file's own Content-Type, and adds `Vary: Accept-Encoding` to every
 * file it answers, the uncompressed fallback included. `setHeaders` is handed the path it sent,
 * which for a copy is under `assets/` too, so a copy keeps its file's cache policy. The server
 * would send a copy found beside a shell file too; the shell is sent as it is because the build
 * writes no shell copy (it walks `assets/` only). Only these public, content-hashed files are
 * compressed: nothing that carries a secret or a request's input is (the first-load compression
 * plan of 2026-11-03, refinements (f) and (b)).
 */
export function pwaStaticOptions(root: string): FastifyStaticOptions {
  const assets = path.join(root, 'assets') + path.sep;
  return {
    root,
    allowedPath: servesPwaPath,
    etag: false,
    lastModified: false,
    cacheControl: false,
    preCompressed: true,
    // @fastify/static 10 hands `setHeaders` the Fastify reply (not the raw response).
    setHeaders: (reply, file) => {
      reply.header('cache-control', file.startsWith(assets) ? PWA_ASSET_CACHE : PWA_SHELL_CACHE);
    },
  };
}
