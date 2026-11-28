// The real-browser leg's harness (native Docs reader spec 2026-10-01 5.7; W5 part 1 Task 12). Three things only:
// which Chrome to drive, three loopback origins that record every request they receive, and fixture bytes built from
// the L0 tables rather than typed. It runs in the browser config's vitest process (`vitest.browser.config.ts`), never
// in the hermetic run, which excludes `browser/**`; `test/browser-leg.test.ts` imports `resolveChrome` alone.
//
// Origins: A is `a.site.localhost` and B is `b.site.localhost`, on two ephemeral ports (same site, two origins: Chrome
// takes the registrable domain `site.localhost` for both, while two ports on `127.0.0.1` are two sites to its CORP
// check), C is `localhost` (another site). Chrome resolves every `*.localhost` name to loopback, so the one
// `127.0.0.1` listener each origin has answers it. Each hit records `Sec-Fetch-Site`, so a case can state what Chrome
// itself called the relation between the page and the request, not what the fixture assumes.
// Every origin serves every route, over plain `node:http`, so a docs fixture carries exactly the headers its route
// answers with (`DOCS_RESPONSE_HEADERS` from `shared/docs.ts`, or a control's subset) and no Fastify is involved.
import { accessSync, constants, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { crc32, deflateSync } from 'node:zlib';
import { DOCS_RASTER_TYPES } from '../../shared/docs';

/** Where Chrome lives on a GitHub `ubuntu-latest` runner, the leg's CI home. */
export const DEFAULT_CHROME = '/usr/bin/google-chrome';

function isExecutableFile(p: string): boolean {
  try {
    if (!statSync(p).isFile()) return false;
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The Chrome the leg drives: `CCRC_CHROME` when it names an executable file, else `fallback` (`DEFAULT_CHROME`)
 *  when that is one. With neither it THROWS, naming both: the browser test calls it in `beforeAll`, so a box with no
 *  Chrome gives a red leg, never a skipped one (spec 5.7). An empty `CCRC_CHROME` counts as unset. `fallback` is a
 *  parameter only so the hermetic test can name a path that does not exist on a box that has Chrome. */
export function resolveChrome(
  env: Readonly<Record<string, string | undefined>> = process.env,
  fallback: string = DEFAULT_CHROME,
): string {
  const named = env['CCRC_CHROME'];
  if (named !== undefined && named !== '' && isExecutableFile(named)) return named;
  if (isExecutableFile(fallback)) return fallback;
  const said = named === undefined || named === '' ? 'unset' : `${JSON.stringify(named)}, which is not an executable file`;
  throw new Error(`no Chrome for the browser leg: CCRC_CHROME is ${said}, and ${fallback} is not an executable file. `
    + 'Set CCRC_CHROME to a Chrome or Chromium binary; this leg never skips.');
}

export type OriginName = 'a' | 'b' | 'c';

/** One request an origin received, recorded before it is answered. `cookie` is null when the request carried no
 *  `Cookie` header. `path` is the pathname with its query. */
export interface OriginHit {
  readonly origin: OriginName;
  readonly method: string;
  readonly path: string;
  readonly cookie: string | null;
  /** The `Sec-Fetch-Site` header Chrome sent (`same-origin`, `same-site`, `cross-site` or `none`); null when absent. */
  readonly fetchSite: string | null;
}

/** A route's answer. `status` absent means 200. `headers` are sent exactly as given, nothing added. */
export interface OriginAnswer {
  readonly status?: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | Uint8Array;
}

/** A fixture route, keyed by pathname in `startOrigins`' table and served by every origin. */
export type OriginRoute = (hit: OriginHit) => OriginAnswer;

export interface Origins {
  readonly a: string;
  readonly b: string;
  readonly c: string;
  /** Every request any origin received, in arrival order, unknown paths included (they answer 404). */
  readonly hits: readonly OriginHit[];
  close(): Promise<void>;
}

function headerText(v: string | string[] | undefined): string | null {
  return v === undefined ? null : Array.isArray(v) ? v.join(', ') : v;
}

const NOT_FOUND: OriginAnswer = { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: 'no such fixture' };

/** Start A, B and C on ephemeral ports, each serving `routes`. */
export async function startOrigins(routes: Readonly<Record<string, OriginRoute>>): Promise<Origins> {
  const hits: OriginHit[] = [];
  const handler = (origin: OriginName) => (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', 'http://fixture.invalid');
    const hit: OriginHit = { origin, method: req.method ?? '', path: url.pathname + url.search, cookie: req.headers.cookie ?? null,
      fetchSite: headerText(req.headers['sec-fetch-site']) };
    hits.push(hit);
    const route = Object.hasOwn(routes, url.pathname) ? routes[url.pathname] : undefined;
    const answer = route === undefined ? NOT_FOUND : route(hit);
    res.writeHead(answer.status ?? 200, { ...answer.headers });
    res.end(answer.body);
  };
  const listen = (origin: OriginName): Promise<Server> => new Promise((resolve, reject) => {
    const server = createServer(handler(origin));
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
  const [sa, sb, sc] = await Promise.all([listen('a'), listen('b'), listen('c')]);
  const port = (s: Server): number => (s.address() as AddressInfo).port;
  const close = (s: Server): Promise<void> => new Promise((resolve) => {
    s.closeAllConnections();
    s.close(() => resolve());
  });
  return {
    a: `http://a.site.localhost:${port(sa)}`,
    b: `http://b.site.localhost:${port(sb)}`,
    c: `http://localhost:${port(sc)}`,
    hits,
    close: async () => { await Promise.all([close(sa), close(sb), close(sc)]); },
  };
}

/** The first hit from index `from` on that `pred` accepts, polled every 50 ms for at most `ms`; null when none came. */
export async function waitForHit(o: Origins, from: number, pred: (h: OriginHit) => boolean, ms: number): Promise<OriginHit | null> {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = o.hits.slice(from).find(pred);
    if (found !== undefined) return found;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, 50));
  }
}

// ---- The artifact tier's golden replay (native Docs HTML artifacts X5, plan Task A5.3) --------------------------------------
// `server/test/artifacts-golden.test.ts` records the REAL artifact instance's status, headers and body for each request of a
// fixture page into `fixtures/artifact-answers.json`, with the two artifact origins as placeholders. `startArtifactReplay`
// serves those answers from two `127.0.0.1` listeners it binds itself (port 0 each: the system picks a free port, no neighbour
// is assumed free), over plain `node:http` (pwa has no fastify), and from a third listener on `http://localhost:<p>` it serves a
// tiny console page that sets one localStorage key and holds the one `<a target="_blank" rel="noopener noreferrer">` the case
// clicks. Every request is recorded with its origin, method, path, `Referer` and the fetch-metadata headers Chromium sent, so a
// case states what the browser sent, never what the fixture assumes.

/** The key the console page sets in its own origin's localStorage; the fixture page reads it from the content origin. */
export const ARTIFACT_CONSOLE_KEY = 'ccrc-console-fixture-key';

/** The `rel` of the console page's link to the wrapper: the Open link's own value (plan Task A5.2). */
export const ARTIFACT_LINK_REL = 'noopener noreferrer';

/** One golden entry: the request as Chromium sends it, and the instance's answer. `host` is a host placeholder. */
export interface ArtifactGoldenEntry {
  readonly name: string;
  readonly request: {
    readonly method: string;
    readonly host: string;
    readonly path: string;
    readonly headers: Readonly<Record<string, string>>;
  };
  readonly response: {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly encoding: 'utf8' | 'base64';
  };
}

export interface ArtifactGolden {
  readonly format: 1;
  readonly token: string;
  readonly entries: readonly ArtifactGoldenEntry[];
}

export type ArtifactSide = 'artifact' | 'content' | 'console';

/** One request a replay listener received. `entry` is the golden entry's name that answered it, null when none matched (the
 *  request answered 404). Absent headers are null. */
export interface ArtifactHit {
  readonly side: ArtifactSide;
  readonly method: string;
  readonly path: string;
  readonly referer: string | null;
  readonly dest: string | null;
  readonly mode: string | null;
  readonly site: string | null;
  readonly serviceWorker: string | null;
  readonly entry: string | null;
}

export interface ArtifactReplay {
  readonly artifactOrigin: string;
  readonly contentOrigin: string;
  readonly consoleOrigin: string;
  /** The wrapper's URL, as the console page's link names it. */
  readonly wrapperUrl: string;
  readonly hits: readonly ArtifactHit[];
  /** The golden entry a hit matched, by name, or undefined. */
  entryOf(hit: ArtifactHit): ArtifactGoldenEntry | undefined;
  close(): Promise<void>;
}

const ARTIFACT_NOT_FOUND = 'no such golden answer';

/** Bind the two replay listeners and the console page's listener. */
export async function startArtifactReplay(golden: ArtifactGolden): Promise<ArtifactReplay> {
  const hits: ArtifactHit[] = [];
  const ports: Record<ArtifactSide, number> = { artifact: 0, content: 0, console: 0 };
  const origins = (): Record<'ARTIFACT_ORIGIN' | 'CONTENT_ORIGIN' | 'ARTIFACT_HOST' | 'CONTENT_HOST', string> => ({
    ARTIFACT_ORIGIN: `http://127.0.0.1:${ports.artifact}`,
    CONTENT_ORIGIN: `http://127.0.0.1:${ports.content}`,
    ARTIFACT_HOST: `127.0.0.1:${ports.artifact}`,
    CONTENT_HOST: `127.0.0.1:${ports.content}`,
  });
  const fill = (s: string): string => Object.entries(origins()).reduce((acc, [k, v]) => acc.split(`{{${k}}}`).join(v), s);
  const sideOfHost = (host: string): ArtifactSide | null =>
    host === '{{ARTIFACT_HOST}}' ? 'artifact' : host === '{{CONTENT_HOST}}' ? 'content' : null;
  const wrapperUrl = (): string => `${fill('{{ARTIFACT_ORIGIN}}')}/a/${golden.token}`;
  const header = (req: IncomingMessage, name: string): string | null => headerText(req.headers[name]);

  const consolePage = (): string => '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>console fixture</title></head><body>'
    + `<script>localStorage.setItem(${JSON.stringify(ARTIFACT_CONSOLE_KEY)}, 'console-secret');</script>`
    + `<a id="open" href="${wrapperUrl()}" target="_blank" rel="${ARTIFACT_LINK_REL}">Open</a></body></html>`;

  const handler = (side: ArtifactSide) => (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', 'http://fixture.invalid');
    const method = req.method ?? '';
    const dest = header(req, 'sec-fetch-dest');
    const base = {
      side, method, path: url.pathname + url.search, referer: header(req, 'referer'), dest,
      mode: header(req, 'sec-fetch-mode'), site: header(req, 'sec-fetch-site'), serviceWorker: header(req, 'service-worker'),
    };
    if (side === 'console') {
      hits.push({ ...base, entry: null });
      if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(consolePage());
      } else {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(ARTIFACT_NOT_FOUND);
      }
      return;
    }
    const found = golden.entries.find((e) => e.request.method === method && sideOfHost(e.request.host) === side
      && e.request.path === url.pathname && (e.request.headers['sec-fetch-dest'] ?? null) === dest);
    hits.push({ ...base, entry: found?.name ?? null });
    if (found === undefined) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(ARTIFACT_NOT_FOUND);
      return;
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(found.response.headers)) headers[k] = fill(v);
    const body = found.response.encoding === 'base64' ? Buffer.from(found.response.body, 'base64') : Buffer.from(fill(found.response.body), 'utf8');
    // A body that held a placeholder changed length when it was filled: the length is the filled body's.
    if ('content-length' in headers) headers['content-length'] = String(body.length);
    res.writeHead(found.response.status, headers);
    res.end(body);
  };

  const listen = (side: ArtifactSide): Promise<Server> => new Promise((resolve, reject) => {
    const server = createServer(handler(side));
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { ports[side] = (server.address() as AddressInfo).port; resolve(server); });
  });
  const [sa, sc, sk] = await Promise.all([listen('artifact'), listen('content'), listen('console')]);
  const stop = (s: Server): Promise<void> => new Promise((resolve) => {
    s.closeAllConnections();
    s.close(() => resolve());
  });
  return {
    artifactOrigin: `http://127.0.0.1:${ports.artifact}`,
    contentOrigin: `http://127.0.0.1:${ports.content}`,
    consoleOrigin: `http://localhost:${ports.console}`,
    wrapperUrl: wrapperUrl(),
    hits,
    entryOf: (hit) => golden.entries.find((e) => e.name === hit.entry),
    close: async () => { await Promise.all([stop(sa), stop(sc), stop(sk)]); },
  };
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([head, typed, crc]);
}

/** A 1x1 RGBA PNG: the table's own magic (never typed here), then IHDR, one deflated row and IEND. */
export function onePixelPng(): Uint8Array<ArrayBuffer> {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); // width
  ihdr.writeUInt32BE(1, 4); // height
  ihdr.set([8, 6, 0, 0, 0], 8); // bit depth 8, colour type 6 (RGBA), deflate, no filter method, no interlace
  const row = Buffer.from([0, 0x2f, 0x6f, 0x9f, 0xff]); // filter byte 0, then one opaque pixel
  return Uint8Array.from(Buffer.concat([
    Buffer.from(DOCS_RASTER_TYPES.png.magic[0][0].bytes),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(row)),
    pngChunk('IEND', new Uint8Array(0)),
  ]));
}
