// Native Docs reader, completion plan Task 7 (C1): the DOM extractor, the reader adapter and the bounded loader
// (`load.ts`; base spec 2026-10-01 5.6.3's element table, Budgets and Loader bullets, as amended for D-8659 and D-8660;
// rows M5.12 and the plan's NDR-C1-T7-N1..N5). Every nested-discovery row goes through the REAL `extractCssRefs`,
// `loadMockupAssets` and `extendMockupAssetPlan`, never a hand-fed discovery list. Placeholders only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOCS_CLASS_CAP, contentClass, docsApi, type DocPin, type DocsEntry } from '../../shared/docs';
import { createFetchQueue, DOCS_PWA_FETCH_CONCURRENCY } from '../src/docs/fetchQueue';
import { extractMockupRefs, loadMockupAssets, mockupAssetReader } from '../src/docs/mockup/load';
import { parseMockup } from '../src/docs/mockup/parse';
import { planMockupAssets } from '../src/docs/mockup/plan';
import { MOCKUP_MAX_ASSET_BYTES } from '../src/docs/mockup/policy';
import type { MockupAssetPlan, MockupAssetReader, MockupContext, MockupReadAnswer, MockupRef } from '../src/docs/mockup/ports';
import { COMMIT_A, COMMIT_B, FP_1, SERVED, draftOf, entry, fakeLoaders, failedAnswer, holder, treeOk } from './docsFixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

const MIB = 1024 * 1024;
const B = MOCKUP_MAX_ASSET_BYTES;
const enc = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);
const bytesOf = (n: number): Uint8Array<ArrayBuffer> => new Uint8Array(n).fill(7);
const PAGE_BASE = 'specs/m.html' as const;

/** A tick of the event loop, enough for every settled promise to run its continuations. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise<void>((r) => { setTimeout(r, 0); });
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

interface Deferred { readonly promise: Promise<MockupReadAnswer>; resolve(a: MockupReadAnswer): void }
function deferred(): Deferred {
  let resolve!: (a: MockupReadAnswer) => void;
  const promise = new Promise<MockupReadAnswer>((r) => { resolve = r; });
  return { promise, resolve };
}

/** A reader over `replies` (by path); a path in `gates` waits for its gate. Records every call, and the peak of reads
 *  in flight at once. A path with no reply fails `not-found`. */
function fakeReader(replies: Record<string, Uint8Array<ArrayBuffer> | string | { failed: string }>, gates: Map<string, Deferred> = new Map()) {
  const calls: DocPin[] = [];
  let inflight = 0;
  let peak = 0;
  const reader: MockupAssetReader = {
    read: async (pin) => {
      calls.push(pin);
      inflight += 1;
      peak = Math.max(peak, inflight);
      try {
        const gate = gates.get(pin.path);
        if (gate !== undefined) return await gate.promise;
        const r = replies[pin.path];
        if (r === undefined) return { kind: 'failed', failure: 'not-found' };
        if (typeof r === 'string') return { kind: 'ok', bytes: enc(r) };
        if ('failed' in r) return { kind: 'failed', failure: r.failed };
        return { kind: 'ok', bytes: r };
      } finally {
        inflight -= 1;
      }
    },
  };
  return { reader, calls, paths: () => calls.map((c) => c.path), inflight: () => inflight, peak: () => peak };
}

const sized = (path: string, size: number, over: Partial<DocsEntry> = {}): DocsEntry =>
  entry('specs', path, { committed: { kind: 'file', blob: '1'.repeat(40), size }, ...over });

function ctxOf(entries: DocsEntry[], pinCommit: string = COMMIT_A): MockupContext {
  const pin: DocPin = { kind: 'committed', commit: pinCommit, servedRef: SERVED, section: 'specs', path: 'm.html' };
  return { project: 'demo', pin, tree: treeOk({ entries: [entry('specs', 'm.html'), ...entries], drafts: holder() }) };
}

const root = (raw: string, kind: MockupRef['kind'] = 'image'): MockupRef => ({ key: `r:${raw}`, raw, basePath: PAGE_BASE, kind, depth: 0 });
const signal = (): AbortSignal => new AbortController().signal;
const rawsOf = (p: MockupAssetPlan): string[] => p.rows.map((r) => r.ref.raw);
const verdictsOf = (p: MockupAssetPlan): string[] => p.rows.map((r) => r.verdict.v);
const rowOf = (p: MockupAssetPlan, raw: string) => p.rows.find((r) => r.ref.raw === raw)!;
const assetId = (pin: DocPin): string => docsApi.file('demo', pin);

// ---------------------------------------------------------------------------------------------------------------
describe('extractMockupRefs: the element table, in DOM order (base 5.6.3)', () => {
  const HTML = `<!doctype html><html><head>
<link rel="stylesheet" href="a.css">
<link rel="icon" href="fav.ico">
<style>.s{background:url(s1.png)}</style>
<script src="x.js"></script><script type="module" src="m.mjs"></script>
<script>import('https://cdn.example/lib.js')</script>
<script type="importmap">{"imports":{}}</script>
<base href="/x/"><meta http-equiv="refresh" content="5">
</head><body style="background:url(b.png)">
<img src="i.png" srcset="s1.png 1x, s2.png 2x">
<picture><source srcset="p.webp"><img src="q.png"></picture>
<video poster="v.png" src="v.mp4"><source src="v2.mp4"><track src="t.vtt"></video>
<input type="image" src="in.png"><input type="text" src="not-an-image.png">
<svg><image href="h.png" xlink:href="xh.png"/><filter><feImage href="fe.png"/></filter></svg>
<a href="l.html">l</a><map><area href="ar.html"></map>
<iframe src="f.html"></iframe><object data="o.swf"></object><embed src="e.swf"><form action="/x"></form>
</body></html>`;

  function extract(html: string = HTML) {
    const parsed = parseMockup(html);
    if (!parsed.ok) throw new Error('refused');
    return { doc: parsed.doc, ex: extractMockupRefs(parsed.doc, PAGE_BASE) };
  }

  it('lists page-level references in DOM order with their kinds, depth 0 and the page as the base', () => {
    const { ex } = extract();
    expect(ex.refs.map((r) => [r.raw, r.kind])).toEqual([
      ['a.css', 'css'], ['s1.png', 'image'], ['x.js', 'script'], ['m.mjs', 'module'], ['b.png', 'image'],
      ['i.png', 'image'], ['s1.png', 'image'], ['s2.png', 'image'], ['p.webp', 'image'], ['q.png', 'image'],
      ['v.png', 'image'], ['in.png', 'image'], ['h.png', 'image'], ['xh.png', 'image'], ['fe.png', 'image'],
    ]);
    for (const r of ex.refs) {
      expect(r.depth).toBe(0);
      expect(r.basePath).toBe(PAGE_BASE);
    }
  });

  it('keys are unique and deterministic: the same page gives the same keys, a clone too', () => {
    const { doc, ex } = extract();
    const keys = ex.refs.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(extractMockupRefs(doc, PAGE_BASE).refs.map((r) => r.key)).toEqual(keys);
    expect(extractMockupRefs(doc.cloneNode(true) as Document, PAGE_BASE).refs.map((r) => r.key)).toEqual(keys);
  });

  it('a and area are never references', () => {
    const { ex } = extract();
    expect(ex.refs.map((r) => r.raw)).not.toContain('l.html');
    expect(ex.refs.map((r) => r.raw)).not.toContain('ar.html');
    expect(ex.unsupported.map((u) => u.element)).not.toContain('a');
  });

  it('the unsupported elements are a separate list for the viewer\'s census, never references', () => {
    const { ex } = extract();
    expect(ex.unsupported.map((u) => u.element)).toEqual([
      'link', 'script[type=importmap]', 'base', 'meta[http-equiv=refresh]', 'video[src]', 'source[src]', 'track[src]',
      'iframe', 'object', 'embed', 'form[action]',
    ]);
    expect(new Set(ex.unsupported.map((u) => u.key)).size).toBe(ex.unsupported.length);
    for (const raw of ['fav.ico', 'v.mp4', 'v2.mp4', 't.vtt', 'f.html', 'o.swf', 'e.swf', 'not-an-image.png']) {
      expect(ex.refs.map((r) => r.raw)).not.toContain(raw);
    }
  });

  it('returns inline script text for the origin census, never as a reference', () => {
    const { ex } = extract();
    expect(ex.scriptTexts).toEqual(["import('https://cdn.example/lib.js')"]);
    expect(ex.refs.map((r) => r.raw)).not.toContain('https://cdn.example/lib.js');
  });

  it('a link whose rel holds the stylesheet token is css, among other tokens too', () => {
    const { ex } = extract('<link rel="alternate stylesheet" href="b.css"><link rel="STYLESHEET" href="c.css"><link rel="preload" href="d.css">');
    expect(ex.refs.map((r) => [r.raw, r.kind])).toEqual([['b.css', 'css'], ['c.css', 'css']]);
    expect(ex.unsupported.map((u) => u.element)).toEqual(['link']);
  });

  it('srcset is taken candidate by candidate, commas inside a URL kept; a candidate that fails to parse is dropped and listed', () => {
    const { ex } = extract('<img srcset="a.png 1x, data:image/png;base64,AAA 2x, b.png 100w, c.png 5q, d.png">');
    expect(ex.refs.map((r) => r.raw)).toEqual(['a.png', 'data:image/png;base64,AAA', 'b.png', 'd.png']);
    expect(ex.dropped).toEqual([{ element: 'img[srcset]', text: 'c.png 5q' }]);
  });

  it('style elements and style attributes go through the CSS scan at depth 0 relative to the page, in text order', () => {
    const { ex } = extract('<style>@import "i.css"; @font-face{src:url(f.woff2)} .a{background:url(b.png)}</style><p style="background:url(c.png)">x</p>');
    expect(ex.refs.map((r) => [r.raw, r.kind, r.depth, r.basePath])).toEqual([
      ['i.css', 'css', 0, PAGE_BASE], ['f.woff2', 'font', 0, PAGE_BASE], ['b.png', 'image', 0, PAGE_BASE], ['c.png', 'image', 0, PAGE_BASE],
    ]);
  });

  it('an SVG style element is scanned like an HTML one, at depth 0 relative to the page, and apply rewrites its text', () => {
    const { doc, ex } = extract('<svg><style>.a{background:url(s.png)} @font-face{src:url(f.woff2)}</style><rect style="fill:url(#g);background:url(r.png)"/></svg>');
    expect(ex.refs.map((r) => [r.raw, r.kind, r.depth, r.basePath])).toEqual([
      ['s.png', 'image', 0, PAGE_BASE], ['f.woff2', 'font', 0, PAGE_BASE], ['#g', 'image', 0, PAGE_BASE], ['r.png', 'image', 0, PAGE_BASE],
    ]);
    ex.apply(new Map([[ex.refs[0]!.key, 'data:A']]));
    expect(doc.querySelector('svg style')!.textContent).toBe('.a{background:url(data:A)} @font-face{src:url(f.woff2)}');
  });

  it('an SVG script element\'s text goes to the census list, like an HTML inline script', () => {
    const { ex } = extract("<svg><script>import('https://cdn.example/lib.js')</script></svg><script>import('https://other.example/x.js')</script>");
    expect(ex.scriptTexts).toEqual(["import('https://cdn.example/lib.js')", "import('https://other.example/x.js')"]);
    expect(ex.refs).toEqual([]);
  });

  it('adopts nothing into the live document', () => {
    const adopt = vi.spyOn(document, 'adoptNode');
    const imp = vi.spyOn(document, 'importNode');
    const { doc } = extract();
    expect(adopt).not.toHaveBeenCalled();
    expect(imp).not.toHaveBeenCalled();
    expect(doc).not.toBe(document);
    expect(document.querySelector('img[src="i.png"]')).toBeNull();
  });

  it('apply writes a replacement at each reference\'s own site: an attribute, one srcset candidate, a style text, an svg href', () => {
    const { doc, ex } = extract();
    const keyOf = (raw: string, n = 0): string => ex.refs.filter((r) => r.raw === raw)[n]!.key;
    ex.apply(new Map([
      [keyOf('i.png'), 'data:A'], [keyOf('s1.png', 1), 'data:B,C'], [keyOf('b.png'), 'data:D'], [keyOf('xh.png'), 'data:E'],
      [keyOf('h.png'), 'data:F'],
    ]));
    expect(doc.querySelector('img')!.getAttribute('src')).toBe('data:A');
    expect(doc.querySelector('img')!.getAttribute('srcset')).toBe('data:B,C 1x, s2.png 2x');
    expect(doc.body.getAttribute('style')).toBe('background:url(data:D)');
    const image = doc.querySelector('svg image')!;
    expect(image.getAttribute('href')).toBe('data:F');
    expect(image.getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe('data:E');
    // The style element's own token was not named: its text is as written.
    expect(doc.querySelector('style')!.textContent).toBe('.s{background:url(s1.png)}');
  });

  it('apply on a srcset replaces only the named candidates and keeps separators and descriptors', () => {
    const { doc, ex } = extract('<img srcset="  a.png 1x ,b.png 2x,\n c.png 3x">');
    ex.apply(new Map([[ex.refs[1]!.key, 'data:x,y']]));
    expect(doc.querySelector('img')!.getAttribute('srcset')).toBe('  a.png 1x ,data:x,y 2x,\n c.png 3x');
  });

  it('apply on a style element and a style attribute rewrites only the chosen tokens', () => {
    const { doc, ex } = extract('<style>.a{background:url(a.png)} .b{background:url(b.png)}</style><p style="background:url(c.png)"></p>');
    ex.apply(new Map([[ex.refs[1]!.key, 'data:B'], [ex.refs[2]!.key, 'data:C']]));
    expect(doc.querySelector('style')!.textContent).toBe('.a{background:url(a.png)} .b{background:url(data:B)}');
    expect(doc.querySelector('p')!.getAttribute('style')).toBe('background:url(data:C)');
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('mockupAssetReader: the existing Docs loaders and the screen\'s queue (no HTTP client of its own)', () => {
  const pin = (path: string): DocPin => ({ kind: 'committed', commit: COMMIT_A, servedRef: SERVED, section: 'specs', path });

  it('a raster path reads through loaders.raster, with the queue\'s job signal; every other path through loaders.file', async () => {
    const f = fakeLoaders();
    f.raster.mockResolvedValueOnce({ s: 'ok', value: { bytes: bytesOf(5), mime: 'image/png' } });
    f.file.mockResolvedValueOnce({
      s: 'ok',
      value: {
        ok: true, contentClass: 'text', from: 'ccd',
        show: { v: 1, verb: 'docs-show', ok: true, elapsedMs: 1, source: 'committed', section: 'specs', path: 's.css', size: 4, sha256: 'c'.repeat(64), encoding: 'utf8', text: 'a{b}' },
      },
    });
    const queue = createFetchQueue();
    const run = vi.spyOn(queue, 'run');
    const reader = mockupAssetReader('demo', f.loaders, queue);
    const ac = new AbortController();
    expect(await reader.read(pin('i.png'), ac.signal)).toEqual({ kind: 'ok', bytes: bytesOf(5) });
    expect(f.raster).toHaveBeenCalledTimes(1);
    expect(f.file).not.toHaveBeenCalled();
    expect(f.raster.mock.calls[0]![0]).toBe('demo');
    expect(f.raster.mock.calls[0]![1]).toEqual(pin('i.png'));
    const a = await reader.read(pin('s.css'), ac.signal);
    expect(a).toEqual({ kind: 'ok', bytes: enc('a{b}') });
    expect(f.file).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect(f.file.mock.calls[0]![2]).toBeInstanceOf(AbortSignal);
  });

  it('a base64 file answer is decoded to its bytes; an answer with no bytes is a failed malformed-answer', async () => {
    const f = fakeLoaders();
    const show = { v: 1 as const, verb: 'docs-show' as const, ok: true as const, elapsedMs: 1, source: 'committed' as const, section: 'specs' as const, path: 'f.woff2', size: 3, sha256: 'c'.repeat(64) };
    f.file.mockResolvedValueOnce({ s: 'ok', value: { ok: true, contentClass: 'other', from: 'ccd', show: { ...show, encoding: 'base64', b64: btoa('\u0001\u0002\u0003') } } });
    f.file.mockResolvedValueOnce({ s: 'ok', value: { ok: true, contentClass: 'other', from: 'ccd', show: { ...show, encoding: 'base64' } } });
    const reader = mockupAssetReader('demo', f.loaders, createFetchQueue());
    expect(await reader.read(pin('f.woff2'), signal())).toEqual({ kind: 'ok', bytes: Uint8Array.from([1, 2, 3]) });
    expect(await reader.read(pin('f.woff2'), signal())).toEqual({ kind: 'failed', failure: 'malformed-answer' });
  });

  it('a not-ok answer keeps its word whole: a docs failure word, else the client slot word', async () => {
    const f = fakeLoaders();
    const answers = [
      failedAnswer('draft-changed'), failedAnswer('worktree-moved'), failedAnswer('unknown-commit'), failedAnswer('a-word-from-a-newer-server'),
      { s: 'auth' as const }, { s: 'unreachable' as const }, { s: 'no-docs-route' as const },
      { s: 'unexpected-response' as const, status: 502, contentType: 'text/html' },
    ];
    for (const a of answers) f.file.mockResolvedValueOnce(a);
    const reader = mockupAssetReader('demo', f.loaders, createFetchQueue());
    const got: string[] = [];
    for (let i = 0; i < answers.length; i += 1) {
      const r = await reader.read(pin('s.css'), signal());
      got.push(r.kind === 'failed' ? r.failure : r.kind);
    }
    expect(got).toEqual(['draft-changed', 'worktree-moved', 'unknown-commit', 'a-word-from-a-newer-server', 'auth', 'unreachable', 'no-docs-route', 'unexpected-response']);
    f.raster.mockResolvedValueOnce({ s: 'auth' });
    expect(await reader.read(pin('i.png'), signal())).toEqual({ kind: 'failed', failure: 'auth' });
  });

  it('makes no request of its own and one call per read: no retry, no relist', async () => {
    const fetchSpy = vi.fn(() => { throw new Error('the reader fetched'); });
    vi.stubGlobal('fetch', fetchSpy);
    const f = fakeLoaders();
    f.file.mockResolvedValue(failedAnswer('draft-changed'));
    const reader = mockupAssetReader('demo', f.loaders, createFetchQueue());
    await reader.read(pin('s.css'), signal());
    expect(f.file).toHaveBeenCalledTimes(1);
    expect(f.tree).not.toHaveBeenCalled();
    expect(f.refresh).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('an aborted signal rejects with its reason and starts no read', async () => {
    const f = fakeLoaders();
    const ac = new AbortController();
    ac.abort(new Error('gone'));
    const reader = mockupAssetReader('demo', f.loaders, createFetchQueue());
    await expect(reader.read(pin('i.png'), ac.signal)).rejects.toThrow('gone');
    expect(f.raster).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('loadMockupAssets: the loader (plan Task 7 RED loader; D-8660)', () => {
  it('reads every admitted pin once, at most two at a time (peak exactly 2, never 3), in row order', async () => {
    const names = ['a.png', 'b.png', 'c.png', 'd.png', 'e.png', 'f.png'];
    const gates = new Map(names.map((n) => [n, deferred()] as const));
    const f = fakeReader(Object.fromEntries(names.map((n) => [n, 'PNG'])), gates);
    const ctx = ctxOf(names.map((n) => sized(n, 3)));
    const done = loadMockupAssets(planMockupAssets(names.map((n) => root(n)), ctx), f.reader, signal());
    await flush();
    expect(DOCS_PWA_FETCH_CONCURRENCY).toBe(2);
    expect(f.paths()).toEqual(['a.png', 'b.png']);
    expect(f.inflight()).toBe(2);
    for (const n of names) {
      gates.get(n)!.resolve({ kind: 'ok', bytes: enc('PNG') });
      await flush();
      expect(f.inflight()).toBeLessThanOrEqual(2);
    }
    const result = await done;
    expect(f.peak()).toBe(2);
    expect(f.paths()).toEqual(names);
    expect(verdictsOf(result.plan)).toEqual(names.map(() => 'inline'));
    expect(result.actualBytes).toBe(18);
  });

  it('on abort it starts no further read and rejects with the signal\'s reason', async () => {
    const names = ['a.png', 'b.png', 'c.png', 'd.png'];
    const gates = new Map(names.map((n) => [n, deferred()] as const));
    const f = fakeReader({}, gates);
    const ac = new AbortController();
    const done = loadMockupAssets(planMockupAssets(names.map((n) => root(n)), ctxOf(names.map((n) => sized(n, 3)))), f.reader, ac.signal);
    const settled = done.then(() => 'resolved', (e: unknown) => e);
    await flush();
    expect(f.paths()).toEqual(['a.png', 'b.png']);
    const reason = new Error('unmounted');
    ac.abort(reason);
    expect(await settled).toBe(reason);
    gates.get('a.png')!.resolve({ kind: 'ok', bytes: enc('PNG') });
    gates.get('b.png')!.resolve({ kind: 'ok', bytes: enc('PNG') });
    await flush();
    expect(f.paths()).toEqual(['a.png', 'b.png']);
  });

  it('an already-aborted signal starts no read at all', async () => {
    const f = fakeReader({ 'a.png': 'PNG' });
    const ac = new AbortController();
    ac.abort(new DOMException('aborted', 'AbortError'));
    await expect(loadMockupAssets(planMockupAssets([root('a.png')], ctxOf([sized('a.png', 3)])), f.reader, ac.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.calls).toEqual([]);
  });

  it('a duplicate loads once, and both rows share its bytes', async () => {
    const f = fakeReader({ 'a.png': 'PNG' });
    const plan = planMockupAssets([root('a.png'), { ...root('./a.png'), key: 'dup' }], ctxOf([sized('a.png', 3)]));
    const result = await loadMockupAssets(plan, f.reader, signal());
    expect(f.paths()).toEqual(['a.png']);
    expect(result.plan.rows).toHaveLength(2);
    expect(result.assets.size).toBe(1);
    expect(result.actualBytes).toBe(3);
    expect(result.plan.reservedBytes).toBe(3);
  });

  it('assets are keyed by the pin\'s own API URL and hold the table MIME with the bytes', async () => {
    const f = fakeReader({ 'a.png': 'PNG' });
    const result = await loadMockupAssets(planMockupAssets([root('a.png')], ctxOf([sized('a.png', 3)])), f.reader, signal());
    const pin = f.calls[0]!;
    expect([...result.assets.keys()]).toEqual([assetId(pin)]);
    expect(result.assets.get(assetId(pin))).toEqual({ mime: 'image/png', bytes: enc('PNG') });
  });

  it.each(['draft-changed', 'worktree-moved', 'worktree-gone', 'unknown-commit'])(
    'a %s on an asset is that row\'s failed word, with one read: no relist, no retry, no replan', async (word) => {
      const f = fakeReader({ 'a.png': { failed: word }, 'b.png': 'PNG' });
      const initial = planMockupAssets([root('a.png'), root('b.png')], ctxOf([sized('a.png', 3), sized('b.png', 3)]));
      const result = await loadMockupAssets(initial, f.reader, signal());
      expect(rowOf(result.plan, 'a.png').verdict).toEqual({ v: 'failed', failure: word });
      expect(rowOf(result.plan, 'a.png').size).toEqual({ kind: 'listed', bytes: 3 });
      expect(rowOf(result.plan, 'b.png').verdict.v).toBe('inline');
      expect(f.paths()).toEqual(['a.png', 'b.png']);
      expect(result.plan.context).toBe(initial.context);
      expect(result.plan.reservedBytes).toBe(6);
    });

  it('unknown-commit on a historical context fails directly: no other read, no switch to the latest commit', async () => {
    const f = fakeReader({ 'a.png': { failed: 'unknown-commit' } });
    const initial = planMockupAssets([root('a.png')], ctxOf([sized('a.png', 3)], COMMIT_B));
    const result = await loadMockupAssets(initial, f.reader, signal());
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toMatchObject({ kind: 'committed', commit: COMMIT_B });
    expect(rowOf(result.plan, 'a.png').verdict).toEqual({ v: 'failed', failure: 'unknown-commit' });
    expect(rowOf(result.plan, 'a.png').size).toEqual({ kind: 'class-cap', bytes: DOCS_CLASS_CAP.raster });
  });

  it('auth stays failed with its own word, never missing', async () => {
    const f = fakeReader({ 'a.png': { failed: 'auth' } });
    const result = await loadMockupAssets(planMockupAssets([root('a.png')], ctxOf([sized('a.png', 3)])), f.reader, signal());
    expect(rowOf(result.plan, 'a.png').verdict).toEqual({ v: 'failed', failure: 'auth' });
    expect(result.assets.size).toBe(0);
  });

  it('bytes over the reservation are failed size-mismatch, never in assets, counted in actualBytes beside an unchanged reservedBytes', async () => {
    const f = fakeReader({ 'a.png': bytesOf(150), 'b.png': bytesOf(100) });
    const result = await loadMockupAssets(planMockupAssets([root('a.png'), root('b.png')], ctxOf([sized('a.png', 100), sized('b.png', 100)])), f.reader, signal());
    expect(rowOf(result.plan, 'a.png').verdict).toEqual({ v: 'failed', failure: 'size-mismatch' });
    expect(rowOf(result.plan, 'a.png').size).toEqual({ kind: 'listed', bytes: 100 });
    expect(rowOf(result.plan, 'b.png').verdict.v).toBe('inline');
    expect([...result.assets.keys()]).toEqual([assetId(f.calls[1]!)]);
    expect(result.actualBytes).toBe(250);
    expect(result.plan.reservedBytes).toBe(200);
  });

  it('a historical admission reserves the class cap: a reply smaller AND larger than the tip\'s listed size is accepted, one over the cap is failed', async () => {
    const cap = DOCS_CLASS_CAP.raster;
    const ctx = ctxOf([sized('small.png', 10), sized('big.png', 10), sized('over.png', 10)], COMMIT_B);
    const f = fakeReader({ 'small.png': bytesOf(3), 'big.png': bytesOf(5000) });
    const result = await loadMockupAssets(planMockupAssets([root('small.png')], ctx), f.reader, signal());
    expect(rowOf(result.plan, 'small.png').verdict.v).toBe('inline');
    expect(rowOf(result.plan, 'small.png').size).toEqual({ kind: 'class-cap', bytes: cap });
    const bigger = await loadMockupAssets(planMockupAssets([root('big.png')], ctx), f.reader, signal());
    expect(rowOf(bigger.plan, 'big.png').verdict.v).toBe('inline');
    expect(bigger.assets.size).toBe(1);
    const f2 = fakeReader({ 'over.png': bytesOf(cap + 1) });
    const over = await loadMockupAssets(planMockupAssets([root('over.png')], ctx), f2.reader, signal());
    expect(rowOf(over.plan, 'over.png').verdict).toEqual({ v: 'failed', failure: 'size-mismatch' });
    expect(over.assets.size).toBe(0);
    expect(over.actualBytes).toBe(cap + 1);
    expect(over.plan.reservedBytes).toBe(cap);
  });

  it('a reader that rejects rejects the load with that error (a defect or an abort), and starts nothing further', async () => {
    const calls: string[] = [];
    const reader: MockupAssetReader = {
      read: async (pin) => {
        calls.push(pin.path);
        throw new Error('defect');
      },
    };
    const names = ['a.png', 'b.png', 'c.png'];
    await expect(loadMockupAssets(planMockupAssets(names.map((n) => root(n)), ctxOf(names.map((n) => sized(n, 3)))), reader, signal())).rejects.toThrow('defect');
    await flush();
    expect(calls.length).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('nested discovery through the real CSS scan, the real loader and extendMockupAssetPlan (NDR-C1-T7-N1..N5)', () => {
  // N1: two root stylesheets; reply-completion order must not change what is admitted.
  async function twoSheets(releaseFirst: 'p0.css' | 'p1.css') {
    const entries = [
      sized('p0.css', 40), sized('p1.css', 40), sized('f.png', MIB), sized('c0.png', 2 * MIB), sized('c1.png', 2 * MIB),
    ];
    const gates = new Map([['p0.css', deferred()], ['p1.css', deferred()]]);
    const f = fakeReader({ 'f.png': 'PNG', 'c0.png': 'PNG', 'c1.png': 'PNG' }, gates);
    const initial = planMockupAssets([root('p0.css', 'css'), root('p1.css', 'css'), root('f.png')], ctxOf(entries));
    const done = loadMockupAssets(initial, f.reader, signal());
    await flush();
    expect(f.paths()).toEqual(['p0.css', 'p1.css']);
    const other = releaseFirst === 'p0.css' ? 'p1.css' : 'p0.css';
    const css = (n: string): string => (n === 'p0.css' ? 'a{background:url(c0.png)}' : 'a{background:url(c1.png)}');
    gates.get(releaseFirst)!.resolve({ kind: 'ok', bytes: enc(css(releaseFirst)) });
    await flush();
    gates.get(other)!.resolve({ kind: 'ok', bytes: enc(css(other)) });
    const result = await done;
    return { result, f, initial };
  }

  it('N1: reversing the completion order of P0 and P1 gives the identical admitted row, pin and reservation order under a tight budget', async () => {
    const forward = await twoSheets('p0.css');
    const reversed = await twoSheets('p1.css');
    const shape = (p: MockupAssetPlan) => p.rows.map((r) => [r.ref.raw, r.verdict.v, r.size?.bytes ?? null]);
    expect(shape(reversed.result.plan)).toEqual(shape(forward.result.plan));
    // Parents in row order: P0's child is fed first, so it takes the budget; P1's does not fit.
    expect(shape(forward.result.plan)).toEqual([
      ['p0.css', 'inline', 40], ['p1.css', 'inline', 40], ['f.png', 'inline', MIB],
      ['c0.png', 'inline', 2 * MIB], ['c1.png', 'skipped', null],
    ]);
    expect(forward.result.plan.reservedBytes).toBe(40 + 40 + MIB + 2 * MIB);
    expect(reversed.result.plan.reservedBytes).toBe(forward.result.plan.reservedBytes);
    expect(reversed.f.paths()).not.toContain('c1.png');
    expect(reversed.f.paths()).toContain('c0.png');
  });

  // N2: token order within one parent.
  const sheetFixtures: Array<[string, string, string[]]> = [
    ['font before image',
      '@import "i.css"; @font-face { font-family: example; src: url("a.woff2") } .hero { background-image: url("a.png") }',
      ['i.css', 'a.woff2', 'a.png']],
    ['image before font',
      '@import "i.css"; .hero { background-image: url("a.png") } @font-face { font-family: example; src: url("a.woff2") }',
      ['i.css', 'a.png', 'a.woff2']],
  ];
  it.each(sheetFixtures)('N2: %s keeps token occurrence order at the same depth and parent (never sorted by kind)', async (_name, css, order) => {
    const entries = [sized('p0.css', css.length), sized('i.css', 0), sized('a.woff2', 10), sized('a.png', 10)];
    const f = fakeReader({ 'p0.css': css, 'i.css': '', 'a.woff2': 'F', 'a.png': 'P' });
    const result = await loadMockupAssets(planMockupAssets([root('p0.css', 'css')], ctxOf(entries)), f.reader, signal());
    expect(rawsOf(result.plan)).toEqual(['p0.css', ...order]);
    expect(result.plan.rows.slice(1).every((r) => r.ref.depth === 1 && r.verdict.v === 'inline')).toBe(true);
    // Reservations are admitted in the same order, so the plan's own sum does not depend on kind.
    expect(f.paths()).toEqual(['p0.css', ...order]);
  });

  it('exact-pin, listing and draft-withheld outcomes of nested references are decided against the captured context, which the result keeps', async () => {
    const css = 'a{background:url(ok.png)} b{background:url(gone.png)} c{background:url(held.png)} d{background:url(absent.png)}';
    const pin: DocPin = { kind: 'draft', branch: 'main', head: COMMIT_A, section: 'specs', path: 'm.html', fp: FP_1 };
    const tree = treeOk({
      entries: [
        entry('specs', 'm.html', { draft: draftOf('modified') }),
        sized('s.css', css.length),
        sized('ok.png', 10, { draft: draftOf('modified', { fp: 'e'.repeat(64), size: 20 }) }),
        sized('gone.png', 10, { draft: draftOf('deleted', { fp: null }) }),
        sized('held.png', 10, { draft: draftOf('modified', { fp: null }) }),
      ],
      drafts: holder(),
    });
    const ctx: MockupContext = { project: 'demo', pin, tree };
    const initial = planMockupAssets([root('s.css', 'css')], ctx);
    const f = fakeReader({ 's.css': css, 'ok.png': 'PNG' });
    const result = await loadMockupAssets(initial, f.reader, signal());
    expect(result.plan.context).toBe(initial.context);
    expect(result.plan.context).toBe(ctx);
    expect(rowOf(result.plan, 'ok.png').verdict).toMatchObject({ v: 'inline', draft: true, size: 20, pin: { kind: 'draft', fp: 'e'.repeat(64) } });
    expect(rowOf(result.plan, 'gone.png').verdict).toEqual({ v: 'missing', why: 'deleted-in-worktree' });
    expect(rowOf(result.plan, 'held.png').verdict).toEqual({ v: 'missing', why: 'draft-withheld' });
    expect(rowOf(result.plan, 'absent.png').verdict).toEqual({ v: 'missing', why: 'absent-at-commit' });
    expect(f.paths()).toEqual(['s.css', 'ok.png']);
  });

  // N3: duplicates, failed or not.
  it('N3: a root failure rediscovered in CSS causes exactly one read and one reservation, both rows failed with its word', async () => {
    const css = 'a{background:url(r.png)}';
    const entries = [sized('r.png', 700), sized('p.css', css.length)];
    const gates = new Map([['p.css', deferred()]]);
    const f = fakeReader({ 'r.png': { failed: 'unreachable' } }, gates);
    const initial = planMockupAssets([root('r.png'), root('p.css', 'css')], ctxOf(entries));
    const done = loadMockupAssets(initial, f.reader, signal());
    await flush();
    expect(f.paths()).toEqual(['r.png', 'p.css']);
    gates.get('p.css')!.resolve({ kind: 'ok', bytes: enc(css) });
    const result = await done;
    expect(f.paths().filter((p) => p === 'r.png')).toHaveLength(1);
    const rows = result.plan.rows.filter((r) => r.ref.raw === 'r.png');
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.verdict).toEqual({ v: 'failed', failure: 'unreachable' });
      expect(r.size).toEqual({ kind: 'listed', bytes: 700 });
    }
    expect(result.plan.reservedBytes).toBe(700 + css.length);
    expect(result.assets.size).toBe(1);
  });

  it('N3: a duplicate pin across root and CSS that succeeded is also read and reserved once', async () => {
    const css = 'a{background:url(r.png)}';
    const f = fakeReader({ 'r.png': 'PNG', 'p.css': css });
    const result = await loadMockupAssets(planMockupAssets([root('r.png'), root('p.css', 'css')], ctxOf([sized('r.png', 3), sized('p.css', css.length)])), f.reader, signal());
    expect(f.paths().filter((p) => p === 'r.png')).toHaveLength(1);
    expect(result.plan.reservedBytes).toBe(3 + css.length);
    expect(result.actualBytes).toBe(3 + css.length);
  });

  // N4 / N5: reservations never shrink or recycle, through the real extension.
  const INITIAL_TOTAL = B - 1024;
  async function recycle(imageAnswer: MockupReadAnswer) {
    const css = 'a{background:url("child.png")}';
    const sheetListed = INITIAL_TOTAL - 8192 - 4 * MIB;
    const entries = [sized('img.png', 8192), sized('s.css', sheetListed), sized('f1.png', 2 * MIB), sized('f2.png', 2 * MIB), sized('child.png', 2048)];
    const gates = new Map([['img.png', deferred()], ['s.css', deferred()]]);
    const f = fakeReader({ 'f1.png': 'F', 'f2.png': 'F', 'child.png': 'C' }, gates);
    const initial = planMockupAssets([root('img.png'), root('s.css', 'css'), root('f1.png'), root('f2.png')], ctxOf(entries));
    // Before any reply: the admitted reservations total exactly B - 1024, fewer than 64 rows, each within its class cap.
    expect(initial.reservedBytes).toBe(INITIAL_TOTAL);
    expect(initial.rows.length).toBeLessThan(64);
    expect(initial.rows.every((r) => r.verdict.v === 'inline' && r.size !== null && r.size.bytes <= DOCS_CLASS_CAP[contentClass(r.ref.raw)])).toBe(true);
    expect(rowOf(initial, 'img.png').size).toEqual({ kind: 'listed', bytes: 8192 });
    const done = loadMockupAssets(initial, f.reader, signal());
    await flush();
    expect(f.paths()).toEqual(['img.png', 's.css']);
    gates.get('img.png')!.resolve(imageAnswer);
    await flush();
    gates.get('s.css')!.resolve({ kind: 'ok', bytes: enc(css) });
    const result = await done;
    return { result, f, initial };
  }

  it('N4: a smaller successful reply returns nothing to the budget, so the next over-budget nested row is skipped with zero reads', async () => {
    const { result, f, initial } = await recycle({ kind: 'ok', bytes: bytesOf(4096) });
    expect(rowOf(result.plan, 'img.png').verdict.v).toBe('inline');
    expect(rowOf(result.plan, 'img.png').size).toEqual({ kind: 'listed', bytes: 8192 });
    expect(result.actualBytes).toBeGreaterThanOrEqual(4096);
    expect(result.plan.reservedBytes).toBe(initial.reservedBytes);
    expect(result.plan.reservedBytes).toBe(INITIAL_TOTAL);
    // (B - 1024) + 2048 > B: the child does not fit, and nothing recycled 4096 bytes to make it fit.
    expect(rowOf(result.plan, 'child.png').verdict).toEqual({ v: 'skipped', why: 'over-budget' });
    expect(rowOf(result.plan, 'child.png').size).toBeNull();
    expect(f.paths()).not.toContain('child.png');
    expect(INITIAL_TOTAL + 2048).toBeGreaterThan(B);
  });

  it('N5: a failed reply returns nothing to the budget, so the next over-budget nested row is skipped with zero reads', async () => {
    const { result, f, initial } = await recycle({ kind: 'failed', failure: 'unreachable' });
    expect(rowOf(result.plan, 'img.png').verdict).toEqual({ v: 'failed', failure: 'unreachable' });
    expect(rowOf(result.plan, 'img.png').size).toEqual({ kind: 'listed', bytes: 8192 });
    expect(result.plan.reservedBytes).toBe(initial.reservedBytes);
    expect(result.plan.reservedBytes).toBe(INITIAL_TOTAL);
    expect(rowOf(result.plan, 'child.png').verdict).toEqual({ v: 'skipped', why: 'over-budget' });
    expect(rowOf(result.plan, 'child.png').size).toBeNull();
    expect(f.paths()).not.toContain('child.png');
  });

  it('the sum of the admitted rows\' reservations is plan.reservedBytes after loading, whatever the replies', async () => {
    const { result } = await recycle({ kind: 'ok', bytes: bytesOf(10) });
    const seen = new Set<string>();
    let sum = 0;
    for (const r of result.plan.rows) {
      if (r.size === null || seen.has(r.ref.raw)) continue;
      seen.add(r.ref.raw);
      sum += r.size.bytes;
    }
    expect(sum).toBe(result.plan.reservedBytes);
  });
});
