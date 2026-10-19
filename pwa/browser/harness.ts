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
