// The draft review page's server half for the real-browser leg (native Docs draft review, X3, wave R2 Task R2.3; spec
// 2026-11-18 section 3.5). A loopback HTTP server over the run's one production build (`app.ts`'s `sharedDist`) that
// answers, for the paths the review page needs, exactly as the real server does: every header and every body is read from
// the L0 module (`shared/docsReview.ts`), never typed a second time here.
//
// TEST HARNESS ONLY. Nothing shipped imports this file: it sits under `pwa/browser/`, which the production build never
// reaches (its two entries are the shell and `review.html`, `vite.config.ts`) and which the hermetic run excludes
// (`browser/**`, pinned by `test/browser-leg.test.ts`). No existing guard proves the negative "no file under `pwa/src`
// imports from `pwa/browser/`": the ring rules (`server/test/rings/pwa-rings.test.ts`) read import edges for two rules that
// are not this one, and `browser-leg.test.ts` pins the exclusion, not the absence of an importer.
//
// Departure D-9027 from the plan's "`pwa/browser/app.ts` (a `reviewServer` mode ...)": `app.ts` is another task's file, and
// its own header says a second need gets a module of its own. `app.ts` routes `/api` through the browser context; this
// server is a real origin, because the rows here measure what a navigation does (the service worker row, the page's own
// response headers), which a context route cannot show. The static serving below repeats `app.ts`'s `serveDist` (its
// content-type table and its path fallback) because `serveDist` owns its own listener and exports no handler.
//
// Two copies of `app.ts`, kept as copies on purpose: the `TYPES` table below is `app.ts`'s content-type table, and the `/health`
// body is the one `app.ts`'s fixture answers (no capability words). `app.ts` is held by another task, and its own header says a
// second need gets a module of its own, so neither is imported or moved from it here. A later task that owns `app.ts` can export
// both and drop these copies.
//
// The answers:
//   GET  /review (any query)       the dist's `review.html` bytes, `text/html; charset=utf-8`, plus every `REVIEW_PAGE_HEADERS` entry
//   GET  /review.html, /review/    404 `REVIEW_NOT_FOUND` as JSON, `cache-control: no-store`
//   POST /api/review/open          the read door: the marker header first, then the JSON body's token (`isReviewToken`, then the
//                                  seeded store). 200 `application/octet-stream` with every `REVIEW_OPEN_HEADERS` entry and the
//                                  shared-at, version and idle-days headers; otherwise 404 `REVIEW_NOT_FOUND` as JSON with every
//                                  `REVIEW_OPEN_HEADERS` entry. A body over `REVIEW_OPEN_BODY_BYTES` reads as no token here
//                                  (the real door answers 413 `too-large`; the page never sends one), and so does a body whose
//                                  media type is not `application/json` (the real door's parser maps every other media type to an
//                                  absent token).
//   any other /api/*               `{}` JSON, as `app.ts`'s fixture answers (the shell's pollers read it as nothing to say);
//                                  `/health` answers the server with no capability words, as `app.ts` does
//   /ws/*                          404
//   every other path               the dist file, or the shell's `index.html` for a path that is not a file
// Every request is recorded, with the answer it got, for the test to read.
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { Browser, BrowserContext } from 'playwright-core';
import {
  REVIEW_IDLE_DAYS, REVIEW_IDLE_DAYS_HEADER, REVIEW_MARKER_HEADER, REVIEW_MARKER_VALUE, REVIEW_NOT_FOUND, REVIEW_OPEN_BODY_BYTES,
  REVIEW_OPEN_CONTENT_TYPE, REVIEW_OPEN_HEADERS, REVIEW_PAGE_CONTENT_TYPE, REVIEW_PAGE_HEADERS, REVIEW_PAGE_NOT_FOUND_HEADERS,
  REVIEW_SHARED_AT_HEADER, REVIEW_VERSION_HEADER, isReviewToken,
} from '../../shared/docsReview';
import { sharedDist } from './app';

/** The one 404 body of the read door and of the page's two refused paths: the L0 object, serialised as the real routes send it. */
const NOT_FOUND_JSON = JSON.stringify(REVIEW_NOT_FOUND);

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

/** What the test seeds for one token: the snapshot's bytes and the three numbers the read door answers beside them. */
export interface ReviewSeed {
  readonly bytes: Uint8Array | string;
  readonly sharedAt: number;
  readonly version: number;
}

/** Which answer a request got. */
export type ReviewAnswer =
  | 'review-page' | 'review-not-found' | 'open-200' | 'open-not-found' | 'api-empty' | 'ws-not-found' | 'dist-file' | 'shell';

/** One request the server received, recorded when it was answered. `url` is the request target (path and query). */
export interface ReviewRecord {
  readonly seq: number;
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  /** The `Referer` header, or null when the request carried none. */
  readonly referer: string | null;
  readonly answer: ReviewAnswer;
}

export interface ReviewServer {
  /** `http://127.0.0.1:<port>`. */
  readonly origin: string;
  /** Every request, in arrival order. */
  readonly requests: readonly ReviewRecord[];
  /** Put `token` in the store: the read door answers its snapshot until the seed is replaced. */
  seed(token: string, snapshot: ReviewSeed): void;
  /** A fresh context on the server's origin (`baseURL`), at a desktop size. Service workers are blocked unless `'allow'`
   *  asks for them (the installed-PWA row): a worker that took over a page would answer requests this server never sees. */
  newContext(browser: Browser, serviceWorkers?: 'allow' | 'block'): Promise<BrowserContext>;
  close(): Promise<void>;
}

const flat = (headers: IncomingHttpHeaders): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) if (value !== undefined) out[name] = Array.isArray(value) ? value.join(', ') : value;
  return out;
};

/** The request body, read to at most `REVIEW_OPEN_BODY_BYTES`; null when it is longer. */
function boundedBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > REVIEW_OPEN_BODY_BYTES) over = true;
      else chunks.push(chunk);
    });
    req.on('end', () => { resolve(over ? null : Buffer.concat(chunks).toString('utf8')); });
    req.on('error', () => { resolve(null); });
  });
}

/** The token a body names, or null when it is not JSON, holds no string `token`, or the string is not a token. */
function tokenOf(body: string | null): string | null {
  if (body === null) return null;
  try {
    const token = (JSON.parse(body) as { token?: unknown } | null)?.token;
    return typeof token === 'string' && isReviewToken(token) ? token : null;
  } catch {
    return null;
  }
}

/** Start the review server on an ephemeral loopback port over `dist` (the run's shared build by default). */
export async function startReviewServer(dist: string = sharedDist()): Promise<ReviewServer> {
  const root = path.resolve(dist);
  const store = new Map<string, ReviewSeed>();
  const requests: ReviewRecord[] = [];

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(url, 'http://review.invalid').pathname);
    } catch {
      pathname = '/';
    }
    const record = (answer: ReviewAnswer): void => {
      const headers = flat(req.headers);
      requests.push({ seq: requests.length, method, url, headers, referer: headers['referer'] ?? null, answer });
    };
    const json = (status: number, body: string, headers: Readonly<Record<string, string>>): void => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
      res.end(body);
    };

    if (method === 'GET' && pathname === '/review') {
      let bytes: Buffer;
      try {
        bytes = await readFile(path.join(root, 'review.html'));
      } catch {
        record('review-not-found');
        json(404, NOT_FOUND_JSON, REVIEW_PAGE_NOT_FOUND_HEADERS);
        return;
      }
      record('review-page');
      res.writeHead(200, { ...REVIEW_PAGE_HEADERS, 'content-type': REVIEW_PAGE_CONTENT_TYPE });
      res.end(bytes);
      return;
    }
    if (method === 'GET' && (pathname === '/review.html' || pathname === '/review/')) {
      record('review-not-found');
      json(404, NOT_FOUND_JSON, REVIEW_PAGE_NOT_FOUND_HEADERS);
      return;
    }
    if (method === 'POST' && pathname === '/api/review/open') {
      // The marker first, before any token lookup (the body is still drained, so the socket is reusable).
      const marked = req.headers[REVIEW_MARKER_HEADER] === REVIEW_MARKER_VALUE;
      const body = await boundedBody(req);
      // Only an `application/json` body can name a token: the real door's parser maps every other media type to no token.
      const mediaType = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
      const token = marked && mediaType === 'application/json' ? tokenOf(body) : null;
      const seed = token === null ? undefined : store.get(token);
      if (seed === undefined) {
        record('open-not-found');
        json(404, NOT_FOUND_JSON, REVIEW_OPEN_HEADERS);
        return;
      }
      record('open-200');
      res.writeHead(200, {
        ...REVIEW_OPEN_HEADERS,
        [REVIEW_SHARED_AT_HEADER]: String(seed.sharedAt),
        [REVIEW_VERSION_HEADER]: String(seed.version),
        [REVIEW_IDLE_DAYS_HEADER]: String(REVIEW_IDLE_DAYS),
        'content-type': REVIEW_OPEN_CONTENT_TYPE,
      });
      res.end(seed.bytes);
      return;
    }
    if (pathname === '/health') {
      record('api-empty');
      json(200, JSON.stringify({ ok: true, build: null, caps: [] }), {});
      return;
    }
    if (pathname.startsWith('/api/')) {
      record('api-empty');
      json(200, '{}', {});
      return;
    }
    if (pathname.startsWith('/ws/')) {
      record('ws-not-found');
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    let file = path.resolve(root, `.${pathname}`);
    let answer: ReviewAnswer = 'dist-file';
    if (!file.startsWith(root + path.sep) || !existsSync(file) || statSync(file).isDirectory()) {
      file = path.join(root, 'index.html');
      answer = 'shell';
    }
    record(answer);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  };

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    requests,
    seed: (token, snapshot) => { store.set(token, snapshot); },
    newContext: (browser, serviceWorkers = 'block') => browser.newContext({
      baseURL: origin, viewport: { width: 1280, height: 900 }, serviceWorkers,
    }),
    close: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}
