// X2 P6.2 (plan 2026-11-18-native-docs-parity, Task P6.2; spec 4.8): the in-walls page loader. A page's relative module
// imports are followed from a bounded scan and inlined bottom up, its import map is read (a sibling inlined, an `https`
// entry offered through Load external, anything else refused), and a fetch shim answers a planned sibling from the set.
// The walls do not move: the sandbox token, the policy and the click guard are pinned here byte for byte. The real
// extractor, planner, loader and build run; only the asset reader is a fake. Placeholders only (project `demo`, hosts
// under `example`).
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { DocPin, DocsEntry, DocsPageLocation, DocsShowOk } from '../../shared/docs';
import { DocsAssetContext, type DocsAssetContextValue } from '../src/docs/DocImage';
import { MockupView } from '../src/docs/MockupView';
import { createFetchQueue } from '../src/docs/fetchQueue';
import type { RangeLoader } from '../src/docs/range/readRange';
import { DOCS_VIEW_TEXT, MOCKUP_TEXT, MOCKUP_VERDICT_SENTENCE, fillSentence, kib, mockupVerdictSentence } from '../src/docs/docsText';
import { loaderOverBudget, originsOf } from '../src/docs/mockup/census';
import {
  buildMockupSrcdoc, extractMockupRefs, loadMockupAssets, mockupAssetReader, type MockupBuild, type MockupExtract,
} from '../src/docs/mockup/load';
import { graphKeysBelow, readImportMap, scanScript, scriptJson } from '../src/docs/mockup/modules';
import { parseMockup } from '../src/docs/mockup/parse';
import { planMockupAssets } from '../src/docs/mockup/plan';
import {
  MOCKUP_CLICK_GUARD, MOCKUP_CSP, MOCKUP_MAX_ASSET_BYTES, MOCKUP_MAX_ASSETS, MOCKUP_MODULE_MAX_DEPTH, MOCKUP_SANDBOX_SCRIPTED,
  MOCKUP_SCRIPT_MAX_REFS, MOCKUP_SCRIPT_SCAN_BYTES, metaFor,
} from '../src/docs/mockup/policy';
import { MOCKUP_FETCH_SHIM_MARK } from '../src/docs/mockup/shim';
import type {
  HttpsOrigin, MockupAssetPlan, MockupAssetReader, MockupContext, MockupRangeRead, MockupReadAnswer,
} from '../src/docs/mockup/ports';
import { COMMIT_A, entry, fakeLoaders, holder, treeOk } from './docsFixtures';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const MIB = 1024 * 1024;
const enc = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);
const PAGE_BASE = 'specs/m.html' as const;
const BASE_URI = 'https://console.example/docs/demo/specs/m.html';
const signal = (): AbortSignal => new AbortController().signal;

const sized = (path: string, size: number): DocsEntry =>
  entry('specs', path, { committed: { kind: 'file', blob: createHash('sha1').update(path).digest('hex'), size } });

function ctxOf(entries: DocsEntry[]): MockupContext {
  const pin: DocPin = { kind: 'committed', commit: COMMIT_A, servedRef: 'refs/remotes/origin/main', section: 'specs', path: 'm.html' };
  return { project: 'demo', pin, tree: treeOk({ entries: [entry('specs', 'm.html'), ...entries], drafts: holder() }) };
}

type Files = Record<string, string | Uint8Array<ArrayBuffer>>;
const bytesOfFile = (f: string | Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> => (typeof f === 'string' ? enc(f) : f);

/** A reader over `files` by path, recording each call's range argument. */
function fakeReader(files: Files) {
  const calls: { path: string; range: MockupRangeRead | undefined }[] = [];
  const reader: MockupAssetReader = {
    read: async (pin, _signal, range) => {
      calls.push({ path: pin.path, range });
      const f = files[pin.path];
      return f === undefined ? { kind: 'failed', failure: 'not-found' } : { kind: 'ok', bytes: bytesOfFile(f) };
    },
  };
  return { reader, calls };
}

interface Run {
  readonly ex: MockupExtract;
  readonly plan: MockupAssetPlan;
  readonly build: MockupBuild;
  readonly page: string;
  readonly out: Document;
  readonly calls: { path: string; range: MockupRangeRead | undefined }[];
}

/** The page through the real pipeline: parse, extract, plan, load, build. `sizes` overrides a listed size. */
async function run(html: string, files: Files, opts: { sizes?: Record<string, number>; extra?: readonly HttpsOrigin[] } = {}): Promise<Run> {
  const parsed = parseMockup(html);
  if (!parsed.ok) throw new Error('refused by the pre-scan');
  const ex = extractMockupRefs(parsed.doc, PAGE_BASE);
  const entries = Object.entries(files).map(([p, f]) => sized(p, opts.sizes?.[p] ?? bytesOfFile(f).byteLength));
  const plan0 = planMockupAssets(ex.refs, ctxOf(entries));
  const { reader, calls } = fakeReader(files);
  const result = await loadMockupAssets(plan0, reader, signal());
  const build = buildMockupSrcdoc(parsed.doc, result, opts.extra ?? [], true);
  const page = build.ok ? build.page : '';
  return { ex, plan: build.plan, build, page, out: new DOMParser().parseFromString(page, 'text/html'), calls };
}

const rowOf = (r: Run, raw: string) => r.plan.rows.find((x) => x.ref.raw === raw)!;
const verdictOf = (r: Run, raw: string) => rowOf(r, raw).verdict;
const JS_PREFIX = 'data:text/javascript;base64,';
const decode = (url: string): string => {
  expect(url.startsWith(JS_PREFIX)).toBe(true);
  const bin = atob(url.slice(JS_PREFIX.length));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};
const mapsOf = (d: Document): Element[] => [...d.querySelectorAll('script[type="importmap"]')];
const importsOf = (d: Document): Record<string, string> => {
  const maps = mapsOf(d);
  expect(maps).toHaveLength(1);
  return (JSON.parse(maps[0]!.textContent ?? '') as { imports: Record<string, string> }).imports;
};
const ID_RE = /#mockup\/\d+/g;
const count = (hay: string, needle: string): number => hay.split(needle).length - 1;

/** The shim's text from a built page, run against a stub window: `original` stands in for the browser's own fetch. */
function shimOf(out: Document) {
  const el = [...out.querySelectorAll('script:not([type])')].find((s) => (s.textContent ?? '').startsWith(MOCKUP_FETCH_SHIM_MARK));
  if (el === undefined) throw new Error('no fetch shim in the page');
  const original = vi.fn(async (_input: unknown) => { throw new TypeError('blocked by connect-src'); });
  const win: { fetch: (input: unknown, init?: unknown) => Promise<Response> } = { fetch: original };
  // The test runs code this module built itself, never page text.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('window', 'document', el.textContent ?? '')(win, { baseURI: BASE_URI });
  return { fetch: win.fetch, original, text: el.textContent ?? '' };
}

// ---------------------------------------------------------------------------------------------------------------
describe('X2 P6.2 the plan\'s seven cases', () => {
  it('loader: a two-module graph renders', async () => {
    const r = await run('<!doctype html><html><head><script type="module" src="main.js"></script></head><body></body></html>', {
      'main.js': "import { b } from './b.js';\ndocument.body.dataset.v = b;\n",
      'b.js': "export const b = 'B';\n",
    });
    expect(verdictOf(r, 'main.js')).toMatchObject({ v: 'inline', kind: 'module' });
    expect(rowOf(r, './b.js').ref).toMatchObject({ spec: 'import', kind: 'module', depth: 1, basePath: 'specs/main.js' });
    expect(verdictOf(r, './b.js')).toMatchObject({ v: 'inline', kind: 'module' });
    const main = r.out.querySelector('script[type="module"]')!.getAttribute('src')!;
    const mainText = decode(main);
    const ids = mainText.match(ID_RE)!;
    expect(ids).toHaveLength(1);
    expect(mainText).toBe(`import { b } from '${ids[0]}';\ndocument.body.dataset.v = b;\n`);
    expect(decode(importsOf(r.out)[ids[0]!]!)).toBe("export const b = 'B';\n");
  });

  it('loader: an import map naming siblings renders', async () => {
    const r = await run(`<!doctype html><html><head><script type="importmap">{"imports":{"lib":"./lib.js"}}</script>
<script type="module">import { v } from 'lib'; document.body.dataset.v = v;</script></head><body></body></html>`, {
      'lib.js': "export const v = 'L';\n",
    });
    expect(r.ex.unsupported.map((u) => u.element)).not.toContain('script[type=importmap]');
    expect(rowOf(r, './lib.js').ref).toMatchObject({ spec: 'map', mapKey: 'lib', kind: 'module' });
    expect(verdictOf(r, './lib.js')).toMatchObject({ v: 'inline' });
    expect(r.plan.rows.map((x) => x.ref.raw)).not.toContain('lib');
    expect(decode(importsOf(r.out)['lib']!)).toBe("export const v = 'L';\n");
    // The inline module keeps its bare name: the map resolves it.
    expect([...r.out.querySelectorAll('script[type="module"]')].map((s) => s.textContent)).toEqual(["import { v } from 'lib'; document.body.dataset.v = v;"]);
  });

  it('loader: an import map naming https asks Load external', async () => {
    const html = `<!doctype html><html><head><script type="importmap">{"imports":{"three":"https://cdn.example/three.module.js"}}</script>
<script type="module">import * as T from 'three'; document.body.dataset.v = typeof T;</script></head><body></body></html>`;
    const r = await run(html, {});
    expect(verdictOf(r, 'https://cdn.example/three.module.js')).toEqual({ v: 'external', origin: 'https://cdn.example', via: 'src' });
    const origins = originsOf(r.plan.rows, [], 'console.example');
    expect(origins.offered.map((o) => o.origin)).toEqual(['https://cdn.example']);
    expect(importsOf(r.out)['three']).toBe('https://cdn.example/three.module.js');
    // Until it is chosen the policy is the base one: the map's entry is in the page, and the policy blocks it.
    expect(r.page.startsWith(metaFor(MOCKUP_CSP))).toBe(true);
    const chosen = await run(html, {}, { extra: ['https://cdn.example' as HttpsOrigin] });
    expect(chosen.page).toContain("script-src 'unsafe-inline' data: https://cdn.example;");
  });

  it('loader: an import map naming data: is refused', async () => {
    const r = await run(`<!doctype html><html><head><script type="importmap">{"imports":{"x":"data:text/javascript,export default 1"}}</script>
<script type="module">import x from 'x'; document.body.dataset.v = x;</script></head><body></body></html>`, {});
    expect(r.ex.unsupported.map((u) => u.element)).toContain('script[type=importmap]');
    expect(r.plan.rows.map((x) => x.ref.raw)).not.toContain('data:text/javascript,export default 1');
    expect(mapsOf(r.out)).toHaveLength(0);
    expect(r.page).not.toContain('data:text/javascript,export');
  });

  it('loader: a sibling fetch answers from the set, others fail', async () => {
    const r = await run(`<!doctype html><html><head><script>fetch('data.json').then((x) => x.json());</script></head><body></body></html>`, {
      'data.json': '{"n":1}',
      'other.json': '{"n":2}',
    });
    expect(verdictOf(r, 'data.json')).toMatchObject({ v: 'inline', kind: 'fetch', mime: 'application/json' });
    expect(r.calls.map((c) => c.path)).toEqual(['data.json']);
    const shim = shimOf(r.out);
    const ok = await shim.fetch('data.json');
    expect(ok.headers.get('content-type')).toBe('application/json');
    expect(await ok.json()).toEqual({ n: 1 });
    await expect(shim.fetch('other.json')).rejects.toThrow(TypeError);
    expect(shim.original).toHaveBeenCalledTimes(1);
  });

  it('loader: a page over 5 MiB shows Download and Source with the reason', async () => {
    const html = "<!doctype html><html><head><script>fetch('a.json');fetch('b.json');fetch('c.json');</script></head><body></body></html>";
    const sizes: Record<string, number> = { 'a.json': 2 * MIB, 'b.json': 2 * MIB, 'c.json': MIB + 1 };
    const files = Object.keys(sizes).map((p) => sized(p, sizes[p]!));
    const reader: MockupAssetReader = { read: async () => ({ kind: 'ok', bytes: enc('{}') }) };
    const assets: DocsAssetContextValue = { loaders: fakeLoaders().loaders, queue: createFetchQueue(), onDraftAsset: () => {} };
    const page: DocsPageLocation & { kind: 'path' } = {
      kind: 'path', project: 'demo', section: 'specs', path: 'm.html', dirSlash: false, ref: null, at: null, view: 'effective', frame: 'inline',
    };
    const show: DocsShowOk = {
      v: 1, verb: 'docs-show', ok: true, elapsedMs: 1, source: 'committed', section: 'specs', path: 'm.html', size: enc(html).byteLength,
      sha256: 'c'.repeat(64), encoding: 'utf8', text: html, commit: COMMIT_A,
    };
    const download = createElement('button', { type: 'button' }, 'Download');
    const { container } = render(createElement(DocsAssetContext, { value: assets },
      createElement(MockupView, { show, context: ctxOf(files), reader, page, relist: () => {}, download })));
    expect(await screen.findByText(fillSentence(MOCKUP_TEXT.overBudget, { n: MOCKUP_MAX_ASSETS, size: kib(MOCKUP_MAX_ASSET_BYTES) }))).toBeTruthy();
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('button', { name: DOCS_VIEW_TEXT.source })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy();
  });

  it('loader: MOCKUP_SANDBOX_SCRIPTED, MOCKUP_CSP and the click guard unchanged', () => {
    expect(MOCKUP_SANDBOX_SCRIPTED).toBe('allow-scripts');
    expect(MOCKUP_CSP).toBe("default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; media-src data: blob:; base-uri 'none'; form-action 'none'");
    expect(MOCKUP_CLICK_GUARD).toBe("<script>document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href],area[href]');if(!a)return;e.preventDefault();var h=a.getAttribute('href')||'';if(h.charAt(0)==='#'&&h.length>1){var id=decodeURIComponent(h.slice(1));var t=document.getElementById(id)||document.getElementsByName(id)[0];if(t)t.scrollIntoView();}},true);</script>");
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('X2 P6.2 module graphs', () => {
  it('a cycle is reported not loaded, never guessed', async () => {
    const r = await run('<!doctype html><html><head><script type="module" src="a.js"></script></head><body></body></html>', {
      'a.js': "import './b.js';\nexport const a = 1;\n",
      'b.js': "import './a.js';\nexport const b = 2;\n",
    });
    expect(verdictOf(r, './b.js')).toMatchObject({ v: 'inline' });
    const back = r.plan.rows.find((x) => x.ref.raw === './a.js')!;
    expect(back.verdict).toEqual({ v: 'unsupported', why: 'cycle' });
    expect(mockupVerdictSentence(back.verdict, false)).toBe(MOCKUP_VERDICT_SENTENCE.unsupported.cycle);
    const ids = decode(r.out.querySelector('script[type="module"]')!.getAttribute('src')!).match(ID_RE)!;
    expect(decode(importsOf(r.out)[ids[0]!]!)).toBe("import './a.js';\nexport const b = 2;\n");
  });

  it('a dynamic import the scan cannot follow is reported not loaded; a literal https one stays the script-text census\'s', async () => {
    const r = await run(`<!doctype html><html><head><script type="module">
const a = await import('./lazy.js');
const b = await import(name);
const c = await import('https://cdn.example/x.js');
</script></head><body></body></html>`, { 'lazy.js': 'export default 1;' });
    const dyn = r.plan.rows.filter((x) => x.verdict.v === 'unsupported' && x.verdict.why === 'dynamic').map((x) => x.ref.raw);
    expect(dyn).toEqual(['./lazy.js', 'import(name)']);
    expect(r.calls).toEqual([]);
    expect(r.plan.rows.map((x) => x.ref.raw)).not.toContain('https://cdn.example/x.js');
    expect(r.ex.scriptTexts.join('\n')).toContain("import('https://cdn.example/x.js')");
  });

  it('a module, a map key and a fetched JSON holding a closing script tag, a comment opener, a line separator or a NUL change nothing that runs', async () => {
    const hostile = "</script><script>document.title='owned'</script><!-- \u2028 \u0000";
    const key = `k${hostile}`;
    const r = await run(`<!doctype html><html><head><script type="importmap">${JSON.stringify({ imports: { [key]: './lib.js' } }).replace(/</g, '\\u003c')}</script>
<script type="module" src="main.js"></script><script>fetch('data.json');</script></head><body></body></html>`, {
      'main.js': `import './lib.js';\nexport const s = ${JSON.stringify(hostile)};\n`,
      'lib.js': `export const t = ${JSON.stringify(hostile)};\n`,
      'data.json': JSON.stringify({ s: hostile }),
    });
    expect(r.build.ok).toBe(true);
    // Every script in the built page is one the build meant: the click guard, the shim, the map, the module and the classic one.
    const scripts = [...r.out.querySelectorAll('script')];
    expect(scripts.map((s) => s.getAttribute('type') ?? (s.textContent ?? '').slice(0, 12))).toEqual([
      MOCKUP_CLICK_GUARD.slice('<script>'.length, '<script>'.length + 12), MOCKUP_FETCH_SHIM_MARK.slice(0, 12), 'importmap', 'module',
      "fetch('data.",
    ]);
    expect(r.out.title).toBe('');
    // The key's text stays in the map, inert inside a JSON string, its angle brackets escaped.
    const map = mapsOf(r.out)[0]!.textContent ?? '';
    expect(map).toContain('k\\u003c/script\\u003e\\u003cscript\\u003edocument.title=');
    expect(Object.keys(importsOf(r.out))).toContain(key);
    const shim = shimOf(r.out);
    expect(await (await shim.fetch('data.json')).json()).toEqual({ s: hostile });
    for (const s of scripts) expect(s.textContent ?? '').not.toMatch(/<\/script|<!--|\u2028|\u0000/i);
  });

  it('a three-deep graph is inlined bottom up, each module once', async () => {
    const files = {
      'main.js': "import './b.js';\nexport const m = 'M';\n",
      'b.js': "import './c.js';\nexport const b = 'B';\n",
      'c.js': "export const c = 'C';\n",
    };
    const r = await run('<!doctype html><html><head><script type="module" src="main.js"></script></head><body></body></html>', files);
    const imports = importsOf(r.out);
    const order = Object.values(imports).map(decode);
    expect(order).toHaveLength(2);
    expect(order[0]).toBe("export const c = 'C';\n");
    expect(order[1]).toMatch(/^import '#mockup\/\d+';\nexport const b = 'B';\n$/);
    expect(count(r.page, JS_PREFIX)).toBe(3);
    expect(verdictOf(r, './c.js')).toMatchObject({ v: 'inline' });
    expect(rowOf(r, './c.js').ref.depth).toBe(2);
  });

  it('an import map with a sibling, an https and a refused entry is refused whole', async () => {
    const r = await run(`<!doctype html><html><head><script type="importmap">{"imports":{"lib":"./lib.js","three":"https://cdn.example/t.js","old":"http://cdn.example/o.js"}}</script>
<script type="module">import 'lib';</script></head><body></body></html>`, { 'lib.js': 'export default 1;' });
    expect(r.ex.unsupported.map((u) => u.element)).toContain('script[type=importmap]');
    expect(r.plan.rows.map((x) => x.ref.raw)).toEqual(['lib']);
    expect(verdictOf(r, 'lib')).toEqual({ v: 'unsupported', why: 'bare' });
    expect(originsOf(r.plan.rows, [], 'console.example').offered).toEqual([]);
    expect(mapsOf(r.out)).toHaveLength(0);
    expect(r.calls).toEqual([]);
  });

  it('a specifier may name only a sibling or https: data:, blob:, javascript:, http: and a climb out are refused', async () => {
    const r = await run(`<!doctype html><html><head><script type="module" src="main.js"></script></head><body></body></html>`, {
      'main.js': [
        "import 'data:text/javascript,1';", "import 'blob:https://x.example/1';", "import 'javascript:1';",
        "import 'http://cdn.example/h.js';", "import '../../../../x.js';", "import '/root.js';",
      ].join('\n'),
    });
    expect(r.plan.rows.slice(1).map((x) => [x.ref.raw, x.verdict])).toEqual([
      ['data:text/javascript,1', { v: 'refused', why: 'scheme' }],
      ['blob:https://x.example/1', { v: 'refused', why: 'scheme' }],
      ['javascript:1', { v: 'refused', why: 'scheme' }],
      ['http://cdn.example/h.js', { v: 'refused', why: 'scheme' }],
      ['../../../../x.js', { v: 'refused', why: 'above-root' }],
      ['/root.js', { v: 'refused', why: 'root-relative' }],
    ]);
    expect(mapsOf(r.out)).toHaveLength(0);
  });

  it('the graph depth is bounded: depth MOCKUP_MODULE_MAX_DEPTH loads, one deeper is module-depth', async () => {
    const files: Files = {};
    for (let i = 0; i <= MOCKUP_MODULE_MAX_DEPTH + 1; i += 1) {
      files[`m${i}.js`] = i <= MOCKUP_MODULE_MAX_DEPTH ? `import './m${i + 1}.js';\n` : 'export default 1;\n';
    }
    const r = await run('<!doctype html><html><head><script type="module" src="m0.js"></script></head><body></body></html>', files);
    expect(verdictOf(r, `./m${MOCKUP_MODULE_MAX_DEPTH}.js`)).toMatchObject({ v: 'inline' });
    expect(rowOf(r, `./m${MOCKUP_MODULE_MAX_DEPTH}.js`).ref.depth).toBe(MOCKUP_MODULE_MAX_DEPTH);
    expect(verdictOf(r, `./m${MOCKUP_MODULE_MAX_DEPTH + 1}.js`)).toEqual({ v: 'unsupported', why: 'module-depth' });
    expect(r.calls.map((c) => c.path)).not.toContain(`m${MOCKUP_MODULE_MAX_DEPTH + 1}.js`);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('X2 P6.2 the scan\'s bounds', () => {
  it('scanScript reads a text of exactly MOCKUP_SCRIPT_SCAN_BYTES, and refuses one byte more', () => {
    const tail = "import './z.js';";
    const at = ' '.repeat(MOCKUP_SCRIPT_SCAN_BYTES - tail.length) + tail;
    expect(at.length).toBe(MOCKUP_SCRIPT_SCAN_BYTES);
    expect(scanScript(at).specifiers.map((s) => s.raw)).toEqual(['./z.js']);
    const over = scanScript(` ${at}`);
    expect(over.over).toBe(true);
    expect(over.specifiers).toEqual([]);
  });

  it('a module of MOCKUP_SCRIPT_MAX_REFS imports gives each its row; one more is one scan-limit row', async () => {
    const n = MOCKUP_SCRIPT_MAX_REFS;
    const at = await run('<!doctype html><html><head><script type="module" src="main.js"></script></head><body></body></html>', {
      'main.js': Array.from({ length: n }, (_, i) => `import './x${i}.js';`).join('\n'),
    });
    expect(at.plan.rows).toHaveLength(1 + n);
    expect(at.plan.rows.some((x) => x.verdict.v === 'unsupported' && x.verdict.why === 'scan-limit')).toBe(false);
    const over = await run('<!doctype html><html><head><script type="module" src="main.js"></script></head><body></body></html>', {
      'main.js': Array.from({ length: n + 5 }, (_, i) => `import './x${i}.js';`).join('\n'),
    });
    expect(over.plan.rows).toHaveLength(1 + n + 1);
    expect(over.plan.rows.at(-1)!.ref.raw).toBe(`./x${n}.js`);
    expect(over.plan.rows.at(-1)!.verdict).toEqual({ v: 'unsupported', why: 'scan-limit' });
  });

  it('a text full of import( with no closing parenthesis is scanned in linear time, its list capped', () => {
    // Measured against the same length of text with no `import(`: a search past the census window per call made this text
    // about ten times slower than that baseline (V8's `indexOf` is fast, so a fixed time bound could not tell them apart).
    const text = 'import(x '.repeat(200_000);
    const plain = 'impart(x '.repeat(200_000);
    scanScript(plain);
    const b0 = performance.now();
    scanScript(plain);
    const base = performance.now() - b0;
    const t0 = performance.now();
    const s = scanScript(text);
    const took = performance.now() - t0;
    expect(took, `baseline ${base.toFixed(0)} ms`).toBeLessThan(Math.max(250, 4 * base));
    expect(s.over).toBe(false);
    expect(s.dynamic.length).toBe(MOCKUP_SCRIPT_MAX_REFS + 1);
    expect(s.dynamic[0]!.text.length).toBeLessThanOrEqual(120);
  });

  it('graphKeysBelow walks a layered graph by its edges: each key once, each file asked once', () => {
    const width = 4;
    const layers = 8;
    const name = (l: number, j: number): string => `m${l}_${j}`;
    const asked: string[] = [];
    const children = (file: string): [string, string][] => {
      asked.push(file);
      const l = file === 'root' ? -1 : Number(file.slice(1, file.indexOf('_')));
      if (l + 1 >= layers) return [];
      return Array.from({ length: width }, (_, j): [string, string] => [`${file}>${name(l + 1, j)}`, name(l + 1, j)]);
    };
    const keys = graphKeysBelow('root', children);
    expect(keys).toHaveLength(width + (layers - 1) * width * width);
    expect(new Set(keys).size).toBe(keys.length);
    expect(asked).toHaveLength(1 + layers * width);
  });

  it('the lexer skips comments, strings, templates and regular expressions', () => {
    const s = scanScript([
      "// import './no1.js';",
      "/* import './no2.js'; */",
      "const t = `import './no3.js' ${'x'}`;",
      "const re = /import '.\\/no4.js'/g;",
      "const q = \"import './no5.js'\";",
      "import a from './yes1.js';",
      "export { b } from \"./yes2.js\";",
      "export * from './yes3.js';",
      "import './yes4.js';",
      "x = import.meta.url;",
      "y = obj.import('./no6.js');",
    ].join('\n'));
    expect(s.specifiers.map((x) => x.raw)).toEqual(['./yes1.js', './yes2.js', './yes3.js', './yes4.js']);
    expect(s.dynamic).toEqual([]);
  });

  it('readImportMap refuses an unreadable map, another top-level key, a non-string value, a sibling prefix and too many entries', () => {
    expect(readImportMap('{"imports":{"a":"./a.js","b":"https://cdn.example/b.js","c/":"https://cdn.example/c/"}}')).toEqual({
      ok: true, entries: [['a', './a.js'], ['b', 'https://cdn.example/b.js'], ['c/', 'https://cdn.example/c/']],
    });
    for (const bad of [
      '{', '[]', '{"imports":{},"scopes":{}}', '{"imports":{"a":1}}', '{"imports":{"a/":"./a/"}}', '{"imports":{"a":"a.js"}}',
      '{"imports":{"a":"blob:https://x.example/1"}}', '{"imports":{"a":"javascript:1"}}', '{"imports":{"a":"//cdn.example/a.js"}}',
    ]) {
      expect(readImportMap(bad), bad).toEqual({ ok: false });
    }
  });

  it('scriptJson cannot end a script, open a comment or break a line in it', () => {
    const s = scriptJson({ "</script><!--\u2028\u2029\u0000&>": ['</SCRIPT>'] });
    expect(s).not.toMatch(/<|>|&|\u2028|\u2029|\u0000/);
    expect(JSON.parse(s)).toEqual({ "</script><!--\u2028\u2029\u0000&>": ['</SCRIPT>'] });
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('X2 P6.2 the fetch shim', () => {
  const PAGE = "<!doctype html><html><head><script>fetch('data.json'); fetch('model.glb');</script></head><body></body></html>";
  const GLB = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 0xff, 0x00, 0x80]);

  it('answers a planned sibling by each relative form and by its absolute URL; a cross-origin and a data: URL go to the original fetch', async () => {
    const r = await run(PAGE, { 'data.json': '{"n":1}', 'model.glb': GLB });
    const shim = shimOf(r.out);
    for (const form of ['data.json', './data.json', 'sub/../data.json', new URL('data.json', BASE_URI).href, new Request(new URL('data.json', BASE_URI))]) {
      expect(await (await shim.fetch(form)).json(), String(form)).toEqual({ n: 1 });
    }
    expect(shim.original).not.toHaveBeenCalled();
    await expect(shim.fetch('https://other.example/docs/demo/specs/data.json')).rejects.toThrow(TypeError);
    await expect(shim.fetch('data:application/json,{}')).rejects.toThrow(TypeError);
    await expect(shim.fetch('data.json', { method: 'POST' })).rejects.toThrow(TypeError);
    expect(shim.original).toHaveBeenCalledTimes(3);
  });

  it('answers a sibling in a subdirectory, named in a script with arrow functions and a finally', async () => {
    const r = await run(`<!doctype html><html><head><script>fetch('data/points.json').then(async (r) => {
  document.body.dataset.type = r.headers.get('content-type');
  document.body.dataset.v = String((await r.json()).n);
}, (e) => { document.body.dataset.v = 'failed:' + e.name; }).finally(() => { document.body.dataset.done = '1'; });</script></head><body></body></html>`, {
      'data/points.json': '{"n":7}',
    });
    expect(verdictOf(r, 'data/points.json')).toMatchObject({ v: 'inline', kind: 'fetch' });
    expect(await (await shimOf(r.out).fetch('data/points.json')).json()).toEqual({ n: 7 });
  });

  it('answers a JSON and a binary model with their bytes and their type', async () => {
    const r = await run(PAGE, { 'data.json': '{"n":1}', 'model.glb': GLB });
    const shim = shimOf(r.out);
    // It answers on a later task, as a network answer would, never within the calling script's microtasks.
    let settled = false;
    const pending = shim.fetch('data.json').then((x) => { settled = true; return x; });
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(settled).toBe(false);
    const json = await pending;
    expect(json.headers.get('content-type')).toBe('application/json');
    expect([...new Uint8Array(await json.arrayBuffer())]).toEqual([...enc('{"n":1}')]);
    const glb = await shim.fetch('./model.glb');
    expect(glb.status).toBe(200);
    expect(glb.headers.get('content-type')).toBe('model/gltf-binary');
    expect([...new Uint8Array(await glb.arrayBuffer())]).toEqual([...GLB]);
  });

  it('a page that fetches nothing and imports nothing builds as before: no map, no shim, the module\'s own bytes', async () => {
    const r = await run(`<!doctype html><html><head><link rel="stylesheet" href="s.css"><script src="c.js"></script>
<script type="module" src="m.js"></script></head><body><img src="i.png"></body></html>`, {
      's.css': 'body{color:red}', 'c.js': 'document.title = "c";', 'm.js': 'document.body.dataset.m = "1";', 'i.png': new Uint8Array([137, 80, 78, 71]),
    });
    expect(mapsOf(r.out)).toHaveLength(0);
    expect(r.page).not.toContain(MOCKUP_FETCH_SHIM_MARK);
    expect(decode(r.out.querySelector('script[type="module"]')!.getAttribute('src')!)).toBe('document.body.dataset.m = "1";');
    expect(r.plan.rows.map((x) => x.verdict.v)).toEqual(['inline', 'inline', 'inline', 'inline']);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('X2 P6.2 budgets and the range seam', () => {
  it('a sibling above 2 MiB is read through the range seam and reserved in full', async () => {
    const big = 3 * MIB;
    const r = await run("<!doctype html><html><head><script>fetch('big.glb');</script></head><body></body></html>", {
      'big.glb': new Uint8Array([1, 2, 3]),
    }, { sizes: { 'big.glb': big } });
    const v = verdictOf(r, 'big.glb');
    expect(v).toMatchObject({ v: 'inline', kind: 'fetch', size: big, range: { kind: 'blob' } });
    expect(r.plan.reservedBytes).toBe(big);
    expect(r.calls).toEqual([{ path: 'big.glb', range: { pin: (v as { range: unknown }).range, size: big } }]);
  });

  it('the reader adapter reads a range request through the loaders\' range seam, checked frame by frame', async () => {
    const bytes = new Uint8Array(1000).map((_, i) => i % 251);
    const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
    const prepare = vi.fn<RangeLoader['prepare']>(async () => ({ s: 'ok', value: { snapshot: 's1', size: bytes.length, digest: sha(bytes) } }));
    const frame = vi.fn<RangeLoader['frame']>(async (_t, snapshot, offset, length) => {
      const part = bytes.subarray(offset, offset + length);
      return { s: 'ok', value: { snapshot, offset, bytesB64: Buffer.from(part).toString('base64'), digest: sha(part), total: bytes.length } };
    });
    const f = fakeLoaders();
    const reader = mockupAssetReader('demo', { ...f.loaders, range: { prepare, frame } }, createFetchQueue());
    const pin: DocPin = { kind: 'committed', commit: COMMIT_A, servedRef: 'refs/remotes/origin/main', section: 'specs', path: 'big.glb' };
    const range: MockupRangeRead = { pin: { kind: 'blob', sha: 'a'.repeat(40) }, size: bytes.length };
    const answer: MockupReadAnswer = await reader.read(pin, signal(), range);
    expect(answer).toEqual({ kind: 'ok', bytes });
    expect(prepare).toHaveBeenCalledWith({ project: 'demo', pin, range: range.pin, size: bytes.length }, expect.anything());
    const none = mockupAssetReader('demo', { file: f.loaders.file, raster: f.loaders.raster }, createFetchQueue());
    expect(await none.read(pin, signal(), range)).toEqual({ kind: 'failed', failure: 'range-unavailable' });
  });

  it('the budget admits 5 MiB exactly and refuses one byte more, and the over-budget answer follows', async () => {
    const html = "<!doctype html><html><head><script>fetch('a.json');fetch('b.json');</script></head><body></body></html>";
    const files = { 'a.json': '{}', 'b.json': '{}' };
    const at = await run(html, files, { sizes: { 'a.json': 2 * MIB, 'b.json': MOCKUP_MAX_ASSET_BYTES - 2 * MIB } });
    expect(at.plan.reservedBytes).toBe(MOCKUP_MAX_ASSET_BYTES);
    expect(at.plan.rows.map((x) => x.verdict.v)).toEqual(['inline', 'inline']);
    expect(loaderOverBudget(at.plan.rows)).toBe(false);
    const over = await run(html, files, { sizes: { 'a.json': 2 * MIB, 'b.json': MOCKUP_MAX_ASSET_BYTES - 2 * MIB + 1 } });
    expect(verdictOf(over, 'b.json')).toEqual({ v: 'skipped', why: 'over-budget' });
    expect(loaderOverBudget(over.plan.rows)).toBe(true);
  });

  it('the budget admits 64 assets and refuses the 65th', async () => {
    const names = (n: number): string[] => Array.from({ length: n }, (_, i) => `d${i}.json`);
    const page = (n: number): string => `<!doctype html><html><head><script>${names(n).map((x) => `fetch('${x}');`).join('')}</script></head><body></body></html>`;
    const files = (n: number): Files => Object.fromEntries(names(n).map((x) => [x, '{}']));
    const at = await run(page(MOCKUP_MAX_ASSETS), files(MOCKUP_MAX_ASSETS));
    expect(at.plan.rows.every((x) => x.verdict.v === 'inline')).toBe(true);
    expect(at.plan.admitted.size).toBe(MOCKUP_MAX_ASSETS);
    expect(loaderOverBudget(at.plan.rows)).toBe(false);
    const over = await run(page(MOCKUP_MAX_ASSETS + 1), files(MOCKUP_MAX_ASSETS + 1));
    expect(verdictOf(over, `d${MOCKUP_MAX_ASSETS}.json`)).toEqual({ v: 'skipped', why: 'over-budget' });
    expect(loaderOverBudget(over.plan.rows)).toBe(true);
  });

  it('an image over the budget keeps today\'s answer: the page frames with the image not loaded', async () => {
    const r = await run('<!doctype html><html><body><img src="a.png"><img src="b.png"><img src="c.png"></body></html>', {
      'a.png': new Uint8Array([1]), 'b.png': new Uint8Array([1]), 'c.png': new Uint8Array([1]),
    }, { sizes: { 'a.png': 2 * MIB, 'b.png': 2 * MIB, 'c.png': 2 * MIB } });
    expect(verdictOf(r, 'c.png')).toEqual({ v: 'skipped', why: 'over-budget' });
    expect(loaderOverBudget(r.plan.rows)).toBe(false);
  });
});

