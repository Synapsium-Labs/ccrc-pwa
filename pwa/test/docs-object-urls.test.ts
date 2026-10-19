// Docs W5 part 1, Task 7: the Docs screen's object URLs and saves (spec 2026-10-01 5.4; M5.17's `rasterObjectUrl`,
// `downloadDocFile` and `saveBytes` clauses; refinement (t)). `rasterObjectUrl` makes an object URL of a raster's own
// canonical image type and refuses every other type; every save is an `application/octet-stream` blob clicked
// through a detached `<a download>` inside the call and revoked 30 s later; `downloadDocFile` saves every one of the
// six classes that way. `setup.ts` stubs `URL.createObjectURL` (answering `blob:mock/<n>`) and `URL.revokeObjectURL`;
// the anchor's `click` is spied so jsdom never tries to navigate. Placeholders only (`demo`, `specs/...`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DOCS_API_PREFIX, DOCS_RASTER_TYPES, DOCS_REQUEST_HEADER, DOCS_REQUEST_HEADER_VALUE, contentClass, docsApi,
  type DocContentClass, type DocPin, type RasterMime,
} from '../../shared/docs';
import type { DocsFileAnswer, DocsLoaders, DocsRasterAnswer } from '../src/docs/failures';
import { DOCS_SHOW_NO_BYTES } from '../src/docs/docsText';
import { DOCS_SAVE_REVOKE_MS, downloadDocFile, rasterObjectUrl, saveBytes, showBytes } from '../src/docs/objectUrls';
import { COMMIT_A, SERVED, failedAnswer, fileResponse } from './docsFixtures';

let clicks: HTMLAnchorElement[] = [];

beforeEach(() => {
  vi.mocked(URL.createObjectURL).mockClear();
  vi.mocked(URL.revokeObjectURL).mockClear();
  clicks = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function record(this: HTMLAnchorElement) {
    clicks.push(this);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Every Blob handed to `URL.createObjectURL`, in call order. */
const blobs = (): Blob[] => vi.mocked(URL.createObjectURL).mock.calls.map(([b]) => b as Blob);
/** The URL `URL.createObjectURL` answered for its `i`th call. */
const urlOf = (i: number): string => vi.mocked(URL.createObjectURL).mock.results[i]?.value as string;
const bytesOf = async (b: Blob): Promise<number[]> => [...new Uint8Array(await b.arrayBuffer())];

/** The declared type's own magic, built from L0's table (never spelled here), plus two bytes of body. */
const rasterBytes = (t: keyof typeof DOCS_RASTER_TYPES): Uint8Array<ArrayBuffer> => {
  const out: number[] = [];
  for (const run of DOCS_RASTER_TYPES[t].magic[0]!) {
    for (let i = 0; i < run.bytes.length; i += 1) out[run.at + i] = run.bytes[i]!;
  }
  return new Uint8Array([...Array.from(out, (b) => b ?? 0), 0, 255]);
};

const pinAt = (path: string): DocPin =>
  ({ kind: 'committed', commit: COMMIT_A, servedRef: SERVED, section: 'specs', path });

describe('rasterObjectUrl (spec 5.4; M5.17)', () => {
  it.each(Object.entries(DOCS_RASTER_TYPES))('makes a %s object URL typed exactly from the table', async (t, row) => {
    const bytes = rasterBytes(t as keyof typeof DOCS_RASTER_TYPES);
    const url = rasterObjectUrl(bytes, row.mime);
    expect(url).toBe(urlOf(0));
    expect(url.startsWith('blob:')).toBe(true);
    expect(blobs()).toHaveLength(1);
    expect(blobs()[0]!.type).toBe(row.mime);
    expect(await bytesOf(blobs()[0]!)).toEqual([...bytes]);
  });

  it.each(['image/svg+xml', 'text/html', 'application/octet-stream', 'IMAGE/PNG', 'image/png ', ''])(
    'throws for %j and makes no object URL', (mime) => {
      expect(() => rasterObjectUrl(rasterBytes('png'), mime as RasterMime)).toThrow(/is not a raster type/);
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    });
});

describe('saveBytes (spec 5.4; M5.17; refinement (t))', () => {
  it('clicks a detached <a download=name> inside the call, typed application/octet-stream, and revokes after 30 s', async () => {
    vi.useFakeTimers();
    const bytes = new Uint8Array([60, 104, 49, 62, 0, 255]);
    saveBytes('a.html', bytes);
    // No await between the call and these lines: the click happened inside it.
    expect(clicks).toHaveLength(1);
    const a = clicks[0]!;
    expect(a.download).toBe('a.html');
    expect(a.getAttribute('href')).toBe(urlOf(0));
    expect(a.isConnected).toBe(false);
    expect(blobs()).toHaveLength(1);
    expect(blobs()[0]!.type).toBe('application/octet-stream');
    vi.advanceTimersByTime(DOCS_SAVE_REVOKE_MS - 1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(urlOf(0));
    expect(DOCS_SAVE_REVOKE_MS).toBe(30000);
    vi.useRealTimers();
    expect(await bytesOf(blobs()[0]!)).toEqual([60, 104, 49, 62, 0, 255]);
  });
});

describe('showBytes: a docs-show answer as bytes', () => {
  const show = fileResponse('x').show;
  it('encodes utf8 text as UTF-8', () => {
    expect([...showBytes({ ...show, encoding: 'utf8', text: 'é<' })!]).toEqual([0xc3, 0xa9, 0x3c]);
  });
  it('decodes base64 exactly, high bytes and NUL included', () => {
    expect([...showBytes({ ...show, encoding: 'base64', text: undefined, b64: 'AP88' })!]).toEqual([0, 255, 60]);
  });
  it('answers null when the field its encoding names is missing, or the base64 does not decode', () => {
    expect(showBytes({ ...show, encoding: 'utf8', text: undefined })).toBeNull();
    expect(showBytes({ ...show, encoding: 'base64', text: 'x', b64: undefined })).toBeNull();
    expect(showBytes({ ...show, encoding: 'base64', b64: '%%%' })).toBeNull();
  });
});

describe('downloadDocFile (spec 5.4; M5.17): octet-stream for every class', () => {
  const PATHS: readonly (readonly [DocContentClass, string])[] = [
    ['markdown', 'a.md'], ['raster', 'i.png'], ['svg', 'd.svg'], ['html', 'm.html'], ['text', 't.txt'], ['other', 'x.pdf'],
  ];

  function loadersFor(cls: DocContentClass, path: string) {
    const raster = vi.fn<DocsLoaders['raster']>(async (): Promise<DocsRasterAnswer> =>
      ({ s: 'ok', value: { bytes: rasterBytes('png'), mime: 'image/png' } }));
    const file = vi.fn<DocsLoaders['file']>(async (): Promise<DocsFileAnswer> => {
      const r = fileResponse('<x>');
      return {
        s: 'ok',
        value: { ...r, contentClass: cls === 'raster' ? 'other' : cls, show: { ...r.show, path } },
      };
    });
    return { raster, file };
  }

  it('the six paths are the six classes', () => {
    expect(PATHS.map(([, p]) => contentClass(p))).toEqual(PATHS.map(([c]) => c));
    expect(new Set(PATHS.map(([c]) => c)).size).toBe(6);
  });

  it.each(PATHS)('%s (%s): saved as application/octet-stream through saveBytes, never its own type', async (cls, path) => {
    const l = loadersFor(cls, path);
    const answer = await downloadDocFile('demo', pinAt(path), path, l);
    expect(answer).toEqual({ s: 'ok', value: undefined });
    expect(l.raster).toHaveBeenCalledTimes(cls === 'raster' ? 1 : 0);
    expect(l.file).toHaveBeenCalledTimes(cls === 'raster' ? 0 : 1);
    expect((cls === 'raster' ? l.raster : l.file).mock.calls[0]?.slice(0, 2)).toEqual(['demo', pinAt(path)]);
    expect(blobs()).toHaveLength(1);
    expect(blobs()[0]!.type).toBe('application/octet-stream');
    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.download).toBe(path);
    expect(await bytesOf(blobs()[0]!)).toEqual(cls === 'raster' ? [...rasterBytes('png')] : [60, 120, 62]);
  });

  it('a base64 answer saves its decoded bytes', async () => {
    const r = fileResponse('');
    const file = vi.fn<DocsLoaders['file']>(async () =>
      ({ s: 'ok', value: { ...r, contentClass: 'other', show: { ...r.show, encoding: 'base64', text: undefined, b64: 'AP88' } } }));
    expect(await downloadDocFile('demo', pinAt('x.pdf'), 'x.pdf', { raster: vi.fn(), file })).toEqual({ s: 'ok', value: undefined });
    expect(await bytesOf(blobs()[0]!)).toEqual([0, 255, 60]);
  });

  it('a failure is answered as is, and nothing is made or clicked', async () => {
    const file = vi.fn<DocsLoaders['file']>(async () => failedAnswer('absent-path'));
    const raster = vi.fn<DocsLoaders['raster']>(async () => ({ s: 'unreachable' }));
    expect(await downloadDocFile('demo', pinAt('a.md'), 'a.md', { raster, file })).toEqual(failedAnswer('absent-path'));
    expect(await downloadDocFile('demo', pinAt('i.png'), 'i.png', { raster, file })).toEqual({ s: 'unreachable' });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(clicks).toHaveLength(0);
  });

  it('an answer with no bytes in its encoding field is malformed-answer, and nothing is saved', async () => {
    const r = fileResponse('');
    const file = vi.fn<DocsLoaders['file']>(async () => ({ s: 'ok', value: { ...r, show: { ...r.show, text: undefined } } }));
    expect(await downloadDocFile('demo', pinAt('a.md'), 'a.md', { raster: vi.fn(), file })).toEqual(
      { s: 'failed', body: { ok: false, failure: 'malformed-answer', why: DOCS_SHOW_NO_BYTES } });
    expect(clicks).toHaveLength(0);
  });

  it('with no loaders it reads through api.docs: the marker header and the one URL builder', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(fileResponse('hi')),
      { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } }));
    vi.stubGlobal('fetch', fetchSpy);
    expect(await downloadDocFile('demo', pinAt('a.md'), 'a.md')).toEqual({ s: 'ok', value: undefined });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(docsApi.file('demo', pinAt('a.md')));
    expect(url.startsWith(DOCS_API_PREFIX + '/')).toBe(true);
    expect(new Headers(init.headers).get(DOCS_REQUEST_HEADER)).toBe(DOCS_REQUEST_HEADER_VALUE);
    expect(await bytesOf(blobs()[0]!)).toEqual([104, 105]);
  });
});
