// The file route's representation and bounds (design 2026-10-01, section 3.6, section 5.1, section 5.2, section
// 6.6; W3 refinement (g)), through `registerDocsReadRoutes` over W2's real adapter and a scripted `CcdRunner`
// (`docsRouteHelpers.ts`): M5.1 (only a raster is raw bytes; every other class is JSON), M5.2 (the declared raster
// type must be true of the bytes, else 422 `raster-mismatch` with no bytes), the show bound (decoded bytes held to the
// bound the server declared; W2's review carry) and M5.6 (`immutable` only on a committed raster 200; `no-store`
// on every JSON body, every draft and every failure).
//
// The raster magic is read from L0's table, never typed here; fixtures carry placeholders only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DOCS_CACHE_IMMUTABLE } from '../src/docs/policy.js';
import { DOCS_MAX_DOC_BYTES, DOCS_RASTER_TYPES, type DocPin, type RasterType } from '../../shared/docs.js';
import {
  FIXTURE_COMMIT, FIXTURE_SERVED, PWA_HEADERS, committedEntry, docsApp, draftEntry, line, okRes, scripted, sha256Hex,
  showLine, treeOk,
} from './docsRouteHelpers.js';

const apps: FastifyInstance[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const app of apps.splice(0)) await app.close();
});

const JSON_TYPE = 'application/json; charset=utf-8';
const BLOB = 'b'.repeat(40);
const enc = encodeURIComponent;

const committed = (path: string): DocPin =>
  ({ kind: 'committed', commit: FIXTURE_COMMIT, servedRef: FIXTURE_SERVED, section: 'specs', path });
const draft = (path: string, bytes: Uint8Array): DocPin =>
  ({ kind: 'draft', branch: 'ws/a', head: FIXTURE_COMMIT, section: 'specs', path, fp: sha256Hex(bytes) });

/** The file GET URL of `pin`, in `docsApi`'s key order. */
function urlOf(pin: DocPin): string {
  const q = pin.kind === 'committed'
    ? `commit=${pin.commit}&servedRef=${enc(pin.servedRef)}&section=${pin.section}&path=${enc(pin.path)}`
    : `branch=${enc(pin.branch)}&head=${pin.head}&section=${pin.section}&path=${enc(pin.path)}&fp=${pin.fp}`;
  return `/api/docs/demo/file?${q}`;
}

/** One file GET of `pin`, whose show ccd answers with `bytes` (a valid answer), on a fresh app. */
async function getFile(pin: DocPin, bytes: Uint8Array, verbs?: string[] | null) {
  const rec = scripted(() => okRes(showLine(pin, bytes)));
  const made = await docsApp({ run: rec.run, verbs });
  apps.push(made.app);
  return { res: await made.app.inject({ url: urlOf(pin), headers: PWA_HEADERS }), rec };
}

/** Bytes of raster type `t`: 16 bytes holding its first magic alternative's runs at their offsets, from L0. */
function rasterBytes(t: RasterType): Uint8Array {
  const out = new Uint8Array(16).fill(0x2e);
  for (const run of DOCS_RASTER_TYPES[t].magic[0]) out.set(run.bytes, run.at);
  return out;
}

const TEXT = Buffer.from('<p>x</p>\n', 'utf8');

describe('M5.1 — the representation is a function of the path\'s class: only a raster is raw bytes', () => {
  it('a.png holding PNG magic answers 200 image/png with exactly its bytes, immutable', async () => {
    const bytes = rasterBytes('png');
    const { res, rec } = await getFile(committed('a.png'), bytes);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe(DOCS_CACHE_IMMUTABLE);
    expect(new Uint8Array(res.rawPayload)).toEqual(bytes);
    expect(rec.calls).toHaveLength(1);
  });

  const CLASSES: readonly (readonly [string, string])[] = [
    ['a.md', 'markdown'], ['a.svg', 'svg'], ['a.html', 'html'], ['a.json', 'text'], ['a.woff2', 'other'],
    ['a.pdf', 'other'], ['a', 'other'],
  ];

  it.each(CLASSES)('%s answers 200 JSON {ok, contentClass: %s, show, from: ccd}, no-store', async (path, cls) => {
    const pin = committed(path);
    const { res, rec } = await getFile(pin, TEXT);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe(JSON_TYPE);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toStrictEqual({ ok: true, contentClass: cls, show: JSON.parse(showLine(pin, TEXT)), from: 'ccd' });
    expect(rec.calls).toHaveLength(1);
  });
});

describe('M5.2 — a raster\'s declared type must be true of its bytes', () => {
  const DECLARED: readonly (readonly [string, RasterType])[] = [
    ['a.png', 'png'], ['a.jpg', 'jpeg'], ['a.gif', 'gif'], ['a.webp', 'webp'],
  ];
  const ACTUAL: readonly (readonly [string, Uint8Array])[] = [
    ['png', rasterBytes('png')], ['jpeg', rasterBytes('jpeg')], ['gif', rasterBytes('gif')], ['webp', rasterBytes('webp')],
    ['svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf8')], ['empty', new Uint8Array(0)],
    ['3 bytes', Uint8Array.of(1, 2, 3)],
  ];
  const CELLS = DECLARED.flatMap(([path, declared]) => ACTUAL.map(([actual, bytes]) => [path, actual, declared, bytes] as const));

  it.each(CELLS)('declared %s, actual %s', async (path, actual, declared, bytes) => {
    const { res, rec } = await getFile(committed(path), bytes);
    expect(rec.calls).toHaveLength(1);
    if (actual === declared) {
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe(DOCS_RASTER_TYPES[declared].mime);
      expect(new Uint8Array(res.rawPayload)).toEqual(bytes);
      return;
    }
    expect(res.statusCode).toBe(422);
    expect(res.headers['content-type']).toBe(JSON_TYPE);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toStrictEqual({ ok: false, failure: 'raster-mismatch', declared, size: bytes.byteLength });
  });
});

describe('the show bound: decoded bytes are held to the bound the server declared (refinement (g); W2 carry)', () => {
  it('a committed .md answer of DOCS_MAX_DOC_BYTES + 1 valid bytes passes the adapter and is refused here: 502 malformed-answer {why: oversize}', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { res, rec } = await getFile(committed('a.md'), Buffer.alloc(DOCS_MAX_DOC_BYTES + 1, 0x61));
    expect(res.statusCode).toBe(502);
    expect(res.json()).toStrictEqual({ ok: false, failure: 'malformed-answer', why: 'oversize' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(warn.mock.calls).toEqual([['ccrc-server: docs show answer over the bound the server asked for']]);
    expect(rec.calls).toHaveLength(1);
  });

  it('a listed size of 5: a 6-byte answer under the listed blob is 502 oversize; a 5-byte one is 200', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let bytes: Uint8Array = Buffer.from('abcdef', 'utf8');
    const pin = committed('a.md');
    const rec = scripted((argv) => okRes(argv[0] === 'docs-tree'
      ? line(treeOk({ entries: [committedEntry('a.md', BLOB, 5)] }))
      : showLine(pin, bytes, { blob: BLOB })));
    const { app } = await docsApp({ run: rec.run });
    apps.push(app);
    expect((await app.inject({ url: '/api/docs/demo/tree', headers: PWA_HEADERS })).statusCode).toBe(200);
    const over = await app.inject({ url: urlOf(pin), headers: PWA_HEADERS });
    expect(over.statusCode).toBe(502);
    expect(over.json()).toStrictEqual({ ok: false, failure: 'malformed-answer', why: 'oversize' });
    bytes = Buffer.from('abcde', 'utf8');
    expect((await app.inject({ url: urlOf(pin), headers: PWA_HEADERS })).statusCode).toBe(200);
    expect(rec.calls.map((argv) => argv[0])).toEqual(['docs-tree', 'docs-show', 'docs-show']);
  });

  it('a draft whose fp -> size map holds 5: a 6-byte answer under that fingerprint is 502 oversize', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bytes = Buffer.from('abcdef', 'utf8');
    const pin = draft('a.md', bytes);
    const rec = scripted((argv) => okRes(argv[0] === 'docs-tree'
      ? line(treeOk({ entries: [draftEntry('a.md', sha256Hex(bytes), 5)] }))
      : showLine(pin, bytes)));
    const { app } = await docsApp({ run: rec.run });
    apps.push(app);
    expect((await app.inject({ url: urlOf(pin), headers: PWA_HEADERS })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/docs/demo/tree', headers: PWA_HEADERS })).statusCode).toBe(200);
    const over = await app.inject({ url: urlOf(pin), headers: PWA_HEADERS });
    expect(over.statusCode).toBe(502);
    expect(over.json()).toStrictEqual({ ok: false, failure: 'malformed-answer', why: 'oversize' });
    expect(rec.calls.map((argv) => argv[0])).toEqual(['docs-show', 'docs-tree', 'docs-show']);
  });
});

describe("the JSON show is the verified bytes, never the answer's own content field (W2 review, check 8)", () => {
  it("a utf8 .md whose text is a lone surrogate (its UTF-8 is U+FFFD's) is served as U+FFFD", async () => {
    const pin = committed('a.md');
    const bytes = Buffer.from('\ufffd', 'utf8');
    const rec = scripted(() => okRes(showLine(pin, bytes, { encoding: 'utf8', b64: undefined, text: '\ud800' })));
    const made = await docsApp({ run: rec.run });
    apps.push(made.app);
    const res = await made.app.inject({ url: urlOf(pin), headers: PWA_HEADERS });
    expect(res.statusCode).toBe(200);
    expect(res.json().show).toMatchObject({ encoding: 'utf8', size: 3, text: '\ufffd' });
    expect(rec.calls).toHaveLength(1);
  });

  it('a base64 .md carrying a stray text beside its b64: 200, the show carries the b64 alone', async () => {
    const pin = committed('a.md');
    const rec = scripted(() => okRes(showLine(pin, TEXT, { text: 'not the bytes' })));
    const made = await docsApp({ run: rec.run });
    apps.push(made.app);
    const res = await made.app.inject({ url: urlOf(pin), headers: PWA_HEADERS });
    expect(res.statusCode).toBe(200);
    const show = res.json().show;
    expect(Object.hasOwn(show, 'text')).toBe(false);
    expect(Buffer.from(show.b64, 'base64')).toEqual(TEXT);
  });
});

describe('M5.6 — Cache-Control: immutable only on a committed raster 200', () => {
  it('a draft raster 200, a committed JSON 200 and a draft JSON 200 are no-store', async () => {
    const png = rasterBytes('png');
    const draftRaster = await getFile(draft('a.png', png), png);
    expect(draftRaster.res.statusCode).toBe(200);
    expect(draftRaster.res.headers['content-type']).toBe('image/png');
    expect(draftRaster.res.headers['cache-control']).toBe('no-store');
    for (const pin of [committed('a.md'), draft('a.md', TEXT)]) {
      const { res } = await getFile(pin, TEXT);
      expect(res.statusCode, pin.kind).toBe(200);
      expect(res.headers['content-type'], pin.kind).toBe(JSON_TYPE);
      expect(res.headers['cache-control'], pin.kind).toBe('no-store');
    }
  });

  it('every failure is no-store: 404 absent-path, 422 raster-mismatch, 502 malformed-answer, 503 caps-unknown', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const pin = committed('a.md');
    const rec = scripted(() => okRes(line({ v: 1, verb: 'docs-show', ok: false, elapsedMs: 2, failure: 'absent-path' })));
    const made = await docsApp({ run: rec.run });
    apps.push(made.app);
    const absent = await made.app.inject({ url: urlOf(pin), headers: PWA_HEADERS });
    const mismatch = (await getFile(committed('a.png'), TEXT)).res;
    const oversize = (await getFile(pin, Buffer.alloc(DOCS_MAX_DOC_BYTES + 1, 0x61))).res;
    const unknown = (await getFile(pin, TEXT, null)).res;
    expect([absent, mismatch, oversize, unknown].map((r) => r.statusCode)).toEqual([404, 422, 502, 503]);
    for (const r of [absent, mismatch, oversize, unknown]) {
      expect(r.headers['cache-control'], String(r.statusCode)).toBe('no-store');
      expect(r.headers['content-type'], String(r.statusCode)).toBe(JSON_TYPE);
    }
  });
});

describe('FR1 review F3: the blob-cache hit branch of the file route, on ONE app with two GETs each', () => {
  /** One app whose tree lists a committed `path` of `bytes` (blob `BLOB`), and whose show answers `bytes`. */
  async function oneApp(path: string, bytes: Uint8Array) {
    const pin = committed(path);
    const rec = scripted((argv) => okRes(argv[0] === 'docs-tree'
      ? line(treeOk({ entries: [committedEntry(path, BLOB, bytes.byteLength)] }))
      : showLine(pin, bytes, { blob: BLOB })));
    const { app, docs } = await docsApp({ run: rec.run });
    apps.push(app);
    expect((await app.inject({ url: '/api/docs/demo/tree', headers: PWA_HEADERS })).statusCode).toBe(200);
    return { app, docs, rec, pin };
  }
  const shows = (rec: { calls: string[][] }): number => rec.calls.filter((argv) => argv[0] === 'docs-show').length;

  it('a .png holding SVG text answers 422 raster-mismatch with no bytes on BOTH reads, the second from the cache (zero execs)', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf8');
    const { app, docs, rec, pin } = await oneApp('a.png', svg);
    const first = await app.inject({ url: urlOf(pin), headers: PWA_HEADERS });
    expect(shows(rec)).toBe(1);
    expect(docs.lanes.byNode.get(docs.lanes.primary)?.caches.blobs.size()).toBe(1);
    const second = await app.inject({ url: urlOf(pin), headers: PWA_HEADERS });
    expect(shows(rec)).toBe(1);
    for (const res of [first, second]) {
      expect(res.statusCode).toBe(422);
      expect(res.headers['content-type']).toBe(JSON_TYPE);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.json()).toStrictEqual({ ok: false, failure: 'raster-mismatch', declared: 'png', size: svg.byteLength });
      expect(res.rawPayload.includes(svg)).toBe(false);
    }
  });

  it('a true committed .png answers raw image/png, immutable, with exactly its bytes on BOTH reads, the second with zero execs', async () => {
    const png = rasterBytes('png');
    const { app, rec, pin } = await oneApp('a.png', png);
    const first = await app.inject({ url: urlOf(pin), headers: PWA_HEADERS });
    expect(shows(rec)).toBe(1);
    const second = await app.inject({ url: urlOf(pin), headers: PWA_HEADERS });
    expect(shows(rec)).toBe(1);
    expect(rec.calls).toHaveLength(2);
    for (const res of [first, second]) {
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['cache-control']).toContain('immutable');
      expect(res.headers['cache-control']).toBe(DOCS_CACHE_IMMUTABLE);
      expect(new Uint8Array(res.rawPayload)).toEqual(png);
    }
  });
});
