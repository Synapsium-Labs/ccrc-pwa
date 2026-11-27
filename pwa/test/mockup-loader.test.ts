// X2 P6.2 (plan 2026-11-18-native-docs-parity, Task P6.2; spec 4.8): the in-walls page loader. A page's relative module
// imports are followed from a bounded scan and inlined bottom up, its import map is read (a sibling inlined, an `https`
// entry offered through Load external, anything else refused), and a fetch shim answers a planned sibling from the set.
// The walls do not move: the sandbox token, the policy and the click guard are pinned here byte for byte. The real
// extractor, planner, loader and build run; only the asset reader is a fake. Placeholders only (project `demo`, hosts
// under `example`).
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DocPin, DocsEntry, DocsPageLocation, DocsShowOk } from '../../shared/docs';
import { DocsAssetContext, type DocsAssetContextValue } from '../src/docs/DocImage';
import { MockupView } from '../src/docs/MockupView';
import { createFetchQueue } from '../src/docs/fetchQueue';
import type { RangeLoader } from '../src/docs/range/readRange';
import { DOCS_VIEW_TEXT, MOCKUP_TEXT, MOCKUP_VERDICT_SENTENCE, fillSentence, kib, mockupVerdictSentence } from '../src/docs/docsText';
import { loaderOverBudget, loaderUnfit, originsOf } from '../src/docs/mockup/census';
import {
  buildMockupSrcdoc, extractMockupRefs, loadMockupAssets, mockupAssetReader, planMockupPage, type MockupBuild, type MockupExtract,
} from '../src/docs/mockup/load';
import { graphKeysBelow, readImportMap, scanScript, scanScriptBytes, scriptChildRefs, scriptJson } from '../src/docs/mockup/modules';
import { scriptTextOrigins } from '../src/docs/mockup/origins';
import { parseMockup } from '../src/docs/mockup/parse';
import { planMockupAssets } from '../src/docs/mockup/plan';
import {
  MOCKUP_CLICK_GUARD, MOCKUP_CSP, MOCKUP_IMPORT_MAP_MAX_ENTRIES, MOCKUP_MAX_ASSET_BYTES, MOCKUP_MAX_ASSETS, MOCKUP_MAX_SRCDOC_CHARS,
  MOCKUP_MODULE_MAX_DEPTH, MOCKUP_SANDBOX_SCRIPTED, MOCKUP_SCRIPT_MAX_REFS, MOCKUP_SCRIPT_SCAN_BYTES, metaFor,
} from '../src/docs/mockup/policy';
import { MOCKUP_FETCH_SHIM_MARK } from '../src/docs/mockup/shim';
import { buildMockupSnapshot } from '../src/docs/mockup/exportMockup';
import type {
  HttpsOrigin, MockupAssetPlan, MockupAssetReader, MockupAssetResult, MockupContext, MockupRangeRead, MockupReadAnswer,
} from '../src/docs/mockup/ports';
import { COMMIT_A, entry, fakeLoaders, holder, treeOk } from './docsFixtures';

// The build's module scan, observed (fix round 1 of review 4066, F1): every call goes to the real function, and the scan
// count case reads how many times the build asked it.
vi.mock('../src/docs/mockup/modules', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/docs/mockup/modules')>();
  return { ...real, scriptChildRefs: vi.fn(real.scriptChildRefs) };
});

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
  /** The page's map rows as the first plan decided them, before a refused map was planned again (D-9152). */
  readonly first: MockupAssetPlan;
  /** The loaded plan, before the build. */
  readonly loaded: MockupAssetPlan;
  readonly plan: MockupAssetPlan;
  readonly build: MockupBuild;
  readonly page: string;
  readonly out: Document;
  readonly calls: { path: string; range: MockupRangeRead | undefined }[];
  /** The parsed page and the load's result, for Export's snapshot. */
  readonly doc: Document;
  readonly result: MockupAssetResult;
}

/** The page through the real pipeline, as the viewer runs it: parse, `planMockupPage`, load, build. `sizes` overrides a
 *  listed size. */
async function run(
  html: string, files: Files, opts: { sizes?: Record<string, number>; extra?: readonly HttpsOrigin[]; beforeBuild?: () => void } = {},
): Promise<Run> {
  const parsed = parseMockup(html);
  if (!parsed.ok) throw new Error('refused by the pre-scan');
  const entries = Object.entries(files).map(([p, f]) => sized(p, opts.sizes?.[p] ?? bytesOfFile(f).byteLength));
  const ctx = ctxOf(entries);
  const first = planMockupAssets(extractMockupRefs(parsed.doc, PAGE_BASE).refs, ctx);
  const { extract: ex, plan: plan0 } = planMockupPage(parsed.doc, PAGE_BASE, ctx);
  const { reader, calls } = fakeReader(files);
  const result = await loadMockupAssets(plan0, reader, signal());
  opts.beforeBuild?.();
  const build = buildMockupSrcdoc(parsed.doc, result, opts.extra ?? [], true);
  const page = build.ok ? build.page : '';
  return {
    ex, first, loaded: result.plan, plan: build.plan, build, page, out: new DOMParser().parseFromString(page, 'text/html'), calls,
    doc: parsed.doc, result,
  };
}

/** The view over `html`, its siblings read from `files` by path, each listed at its byte length or `sizes`' value; the
 *  reader's calls recorded. */
function renderView(html: string, files: Files, sizes: Record<string, number> = {}) {
  const entries = Object.entries(files).map(([p, f]) => sized(p, sizes[p] ?? bytesOfFile(f).byteLength));
  const { reader, calls } = fakeReader(files);
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
    createElement(MockupView, { show, context: ctxOf(entries), reader, page, relist: () => {}, download })));
  return { container, calls };
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
    // With scripts off the frame shows as before: nothing would load. Run scripts brings the answer.
    fireEvent.click(await screen.findByRole('button', { name: MOCKUP_TEXT.runScripts }));
    expect(await screen.findByText(fillSentence(MOCKUP_TEXT.overBudget, { n: MOCKUP_MAX_ASSETS, size: kib(MOCKUP_MAX_ASSET_BYTES) }))).toBeTruthy();
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('button', { name: DOCS_VIEW_TEXT.source })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy();
    // Stop scripts stays, and takes the reader back to the static frame (fix round 1 of review 4066, A13).
    fireEvent.click(screen.getByRole('button', { name: MOCKUP_TEXT.stopScripts }));
    expect(await screen.findByRole('button', { name: MOCKUP_TEXT.runScripts })).toBeTruthy();
    expect(container.querySelector('iframe')).not.toBeNull();
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
    // The script-text census offers its origin, from the page's script text, as the viewer reads it (review 4066, A11).
    const scriptOrigins = [...new Set(r.ex.scriptTexts.flatMap((t) => scriptTextOrigins(t)))];
    expect(scriptOrigins).toEqual(['https://cdn.example']);
    expect(originsOf(r.plan.rows, scriptOrigins, 'console.example').offered.map((o) => o.origin)).toEqual(['https://cdn.example']);
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
    // The hostile markup is nowhere in the page as markup: a parse of it can make no element of it (review 4066, A11).
    expect(r.page).not.toContain("</script><script>document.title='owned'");
    expect(r.out.querySelectorAll('script')).toHaveLength(5);
    // The key's text stays in the map, inert inside a JSON string, its angle brackets escaped.
    const map = mapsOf(r.out)[0]!.textContent ?? '';
    expect(map).toContain('k\\u003c/script\\u003e\\u003cscript\\u003edocument.title=');
    expect(Object.keys(importsOf(r.out))).toContain(key);
    const shim = shimOf(r.out);
    expect(await (await shim.fetch('data.json')).json()).toEqual({ s: hostile });
    for (const s of scripts) expect(s.textContent ?? '').not.toMatch(/<\/script|<!--|\u2028|\u0000/i);
  });

  it('an inline module whose text holds <!-- is left as written: its imports are html-comment, and no hidden markup goes live', async () => {
    const html = `<!doctype html><html><head><script type="module">import "./a.js"; //<!--<script>
</script><script type="importmap">{"imports":{"x":"data:text/javascript,1"}}</script> --></script></head><body></body></html>`;
    const r = await run(html, { 'a.js': 'export default 1;' });
    const original = parseMockup(html);
    if (!original.ok) throw new Error('refused');
    const text = original.doc.querySelector('script[type="module"]')!.textContent;
    // Its own word and sentence, not the escape one (review 4066, A7).
    expect(verdictOf(r, './a.js')).toEqual({ v: 'unsupported', why: 'html-comment' });
    expect(mockupVerdictSentence(verdictOf(r, './a.js'), false)).toBe(MOCKUP_VERDICT_SENTENCE.unsupported['html-comment']);
    expect(r.calls).toEqual([]);
    expect(mapsOf(r.out)).toHaveLength(0);
    expect([...r.out.querySelectorAll('script[type="module"]')].map((s) => s.textContent)).toEqual([text]);
  });

  it('a literal https dynamic import in a sibling module is offered through Load external', async () => {
    const r = await run('<!doctype html><html><head><script type="module" src="main.js"></script></head><body></body></html>', {
      'main.js': "const m = await import('https://cdn.example/lazy.js');\n",
    });
    expect(verdictOf(r, 'https://cdn.example/lazy.js')).toEqual({ v: 'external', origin: 'https://cdn.example', via: 'src' });
    expect(originsOf(r.plan.rows, [], 'console.example').offered.map((o) => o.origin)).toEqual(['https://cdn.example']);
  });

  it('a page map entry named __proto__ is written back like any other', async () => {
    const r = await run(`<!doctype html><html><head><script type="importmap">{"imports":{"__proto__":"./lib.js"}}</script>
<script type="module">import '__proto__';</script></head><body></body></html>`, { 'lib.js': 'export default 1;' });
    const text = mapsOf(r.out)[0]!.textContent ?? '';
    expect(text).toContain(`"__proto__":"${JS_PREFIX}`);
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

  it('scanScriptBytes decides its bound on the byte length alone: high bytes at the bound are read, one byte more is refused (review 4066, F2)', () => {
    const head = enc("import './z.js';\nconst s = '");
    const tail = enc("';\n");
    const fill = MOCKUP_SCRIPT_SCAN_BYTES - head.length - tail.length;
    const at = new Uint8Array(MOCKUP_SCRIPT_SCAN_BYTES);
    at.set(head, 0);
    // Two-byte UTF-8 (U+00E9) throughout, so every byte of the fill is above 0x7f; an odd fill ends in one ASCII byte.
    for (let i = 0; i + 1 < fill; i += 2) { at[head.length + i] = 0xc3; at[head.length + i + 1] = 0xa9; }
    if (fill % 2 === 1) at[head.length + fill - 1] = 0x78;
    at.set(tail, head.length + fill);
    expect(at.length).toBe(MOCKUP_SCRIPT_SCAN_BYTES);
    const read = scanScriptBytes(at);
    expect(read.over).toBe(false);
    expect(read.specifiers.map((s) => s.raw)).toEqual(['./z.js']);
    const more = new Uint8Array(MOCKUP_SCRIPT_SCAN_BYTES + 1);
    more.set(at, 0);
    more[MOCKUP_SCRIPT_SCAN_BYTES] = 0x20;
    expect(scanScriptBytes(more)).toEqual({ specifiers: [], dynamic: [], literals: [], over: true });
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

  it('readImportMap reads MOCKUP_IMPORT_MAP_MAX_ENTRIES entries, and refuses one more (review 4066, F4)', () => {
    const map = (n: number): string => JSON.stringify({ imports: Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, `./m${i}.js`])) });
    const at = readImportMap(map(MOCKUP_IMPORT_MAP_MAX_ENTRIES));
    expect(at.ok).toBe(true);
    expect(at.ok && at.entries).toHaveLength(MOCKUP_IMPORT_MAP_MAX_ENTRIES);
    expect(at.ok && at.entries.at(-1)).toEqual([`k${MOCKUP_IMPORT_MAP_MAX_ENTRIES - 1}`, `./m${MOCKUP_IMPORT_MAP_MAX_ENTRIES - 1}.js`]);
    expect(readImportMap(map(MOCKUP_IMPORT_MAP_MAX_ENTRIES + 1))).toEqual({ ok: false });
  });

  it('an empty import map is read, kept in the page, and refuses nothing (review 4066, A12)', async () => {
    expect(readImportMap('{"imports":{}}')).toEqual({ ok: true, entries: [] });
    const r = await run(`<!doctype html><html><head><script type="importmap">{"imports":{}}</script>
<script type="module" src="main.js"></script></head><body></body></html>`, { 'main.js': "import './b.js';\n", 'b.js': 'export default 1;\n' });
    expect(r.ex.unsupported.map((u) => u.element)).not.toContain('script[type=importmap]');
    expect(r.plan.importMapRefused).toBeUndefined();
    expect(mapsOf(r.out)).toHaveLength(1);
    expect(Object.keys(importsOf(r.out))).toHaveLength(1);
    expect(verdictOf(r, './b.js')).toMatchObject({ v: 'inline' });
  });

  it('readImportMap refuses an unreadable map, another top-level key, a non-string value and a sibling prefix', () => {
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

  it('the scan keeps, and the byte scan decodes, only the literals a fetch could name (review 4066, F1)', () => {
    const text = "const a = ''; const b = 'x'; const c = `t.json`; const d = 'pts.json?v=1'; const e = 'é.png'; const f = 'm.glb';";
    expect(scanScript(text).literals.map((l) => l.raw)).toEqual(['t.json', 'pts.json?v=1', 'm.glb']);
    expect(scanScriptBytes(enc(text)).literals.map((l) => l.raw)).toEqual(['t.json', 'pts.json?v=1', 'm.glb']);
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
    // A frame whose bytes are not its digest's fails the read with that word, and no bytes (review 4066, A11).
    const lying = vi.fn<RangeLoader['frame']>(async (_t, snapshot, offset, length) => {
      const part = bytes.subarray(offset, offset + length);
      return { s: 'ok', value: { snapshot, offset, bytesB64: Buffer.from(part).toString('base64'), digest: 'f'.repeat(64), total: bytes.length } };
    });
    const checked = mockupAssetReader('demo', { ...f.loaders, range: { prepare, frame: lying } }, createFetchQueue());
    expect(await checked.read(pin, signal(), range)).toEqual({ kind: 'failed', failure: 'range-frame-digest' });
    expect(lying).toHaveBeenCalled();
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

// ---------------------------------------------------------------------------------------------------------------
describe('X2 P6.2 fix round 1 (review 4066)', () => {
  /** `n` bytes of a module: `head`, then a line comment filling it out. */
  const sizedModule = (head: string, n: number): string => `${head}//${'x'.repeat(n - head.length - 3)}\n`;

  it('the build scans each module once, however many roots the cut refuses (F1)', async () => {
    const roots = 20;
    // Seven uses of one 1 MiB image pass the page cap at the seventh: every module root after them is refused by the cut.
    const imgs = '<img src="i.png">'.repeat(7);
    const mods = Array.from({ length: roots }, (_, i) => `<script type="module">import './s${i}.js';</script>`).join('');
    const files: Files = { 'i.png': new Uint8Array(MIB).fill(7), 'a.js': 'export default 1;\n' };
    for (let i = 0; i < roots; i += 1) files[`s${i}.js`] = "import './a.js';\n";
    const scans = vi.mocked(scriptChildRefs);
    const r = await run(`<!doctype html><html><head></head><body>${imgs}${mods}</body></html>`, files, { beforeBuild: () => scans.mockClear() });
    expect(r.build.ok).toBe(true);
    for (let i = 0; i < roots; i += 1) expect(verdictOf(r, `./s${i}.js`)).toEqual({ v: 'skipped', why: 'over-budget' });
    // One scan for each module the cut walks below (s0 to s19, and a.js once), never one per root.
    expect(scans.mock.calls).toHaveLength(roots + 1);
  });

  const refusals: readonly [string, string, unknown][] = [
    ['root-relative', '/x.js', { v: 'refused', why: 'root-relative' }],
    ['a climb out of the root', '../../../../x.js', { v: 'refused', why: 'above-root' }],
    ['an unlisted path in another section', '../plans/x.js', { v: 'missing', why: 'absent-at-commit' }],
    ['out of the Docs sections', '../x.js', { v: 'refused', why: 'repo' }],
    ['a backslash form', './sub\\x.js', { v: 'refused', why: 'malformed' }],
  ];
  for (const [label, value, verdict] of refusals) {
    it(`an import map whose entry is ${label}, which the planner refuses, is refused whole and removed, as an unreadable one is (F3, D-9152)`, async () => {
      const map = JSON.stringify({ imports: { lib: './lib.js', bad: value } });
      const r = await run(`<!doctype html><html><head><script type="importmap">${map}</script>
<script type="module">import 'lib';</script></head><body></body></html>`, { 'lib.js': 'export default 1;', 'x.js': 'export default 2;' });
      // The first plan's verdict on the entry: neither inline nor an https offer.
      expect(r.first.rows.find((x) => x.ref.mapKey === 'bad')!.verdict).toEqual(verdict);
      expect(r.plan.importMapRefused).toBe(true);
      expect(r.ex.unsupported.map((u) => u.element)).toContain('script[type=importmap]');
      expect(r.plan.rows.filter((x) => x.ref.spec === 'map')).toEqual([]);
      expect(verdictOf(r, 'lib')).toEqual({ v: 'unsupported', why: 'bare' });
      expect(mapsOf(r.out)).toHaveLength(0);
      expect(r.calls).toEqual([]);
    });
  }

  it('a map entry over its class cap keeps its own row, and the written map holds no value it did not replace (D-9152, the ruling)', async () => {
    const r = await run(`<!doctype html><html><head><script type="importmap">{"imports":{"lib":"./lib.js","ok":"./ok.js","three":"https://cdn.example/t.js"}}</script>
<script type="module">import 'lib'; import 'ok';</script></head><body></body></html>`, {
      'lib.js': 'export default 1;', 'ok.js': 'export default 2;',
    }, { sizes: { 'lib.js': 3 * MIB } });
    expect(r.plan.importMapRefused).toBeUndefined();
    expect(r.ex.unsupported.map((u) => u.element)).not.toContain('script[type=importmap]');
    const lib = verdictOf(r, './lib.js');
    expect(lib).toEqual({ v: 'skipped', why: 'too-large' });
    expect(mockupVerdictSentence(lib, false)).toBe(MOCKUP_VERDICT_SENTENCE.skipped['too-large']);
    const written = importsOf(r.out);
    expect(Object.keys(written)).toEqual(['ok', 'three']);
    expect(decode(written['ok']!)).toBe('export default 2;');
    expect(written['three']).toBe('https://cdn.example/t.js');
    expect(mapsOf(r.out)[0]!.textContent).not.toContain('./lib.js');
  });

  it('a map entry over the asset budget still gives the over-budget answer, not a refused map (D-9152, the ruling)', async () => {
    const imgs = Array.from({ length: MOCKUP_MAX_ASSETS }, (_, i) => `<img src="i${i}.png">`).join('');
    const html = `<!doctype html><html><head></head><body>${imgs}<script type="importmap">{"imports":{"lib":"./lib.js"}}</script>
<script type="module">import 'lib';</script></body></html>`;
    const files: Files = { 'lib.js': 'export default 1;' };
    for (let i = 0; i < MOCKUP_MAX_ASSETS; i += 1) files[`i${i}.png`] = new Uint8Array([i]);
    const r = await run(html, files);
    expect(r.plan.importMapRefused).toBeUndefined();
    expect(verdictOf(r, './lib.js')).toEqual({ v: 'skipped', why: 'over-budget' });
    expect(Object.keys(importsOf(r.out))).toEqual([]);
    expect(loaderUnfit(r.loaded.rows, r.plan.rows)).toBe('budget');
    renderView(html, files);
    fireEvent.click(await screen.findByRole('button', { name: MOCKUP_TEXT.runScripts }));
    expect(await screen.findByText(fillSentence(MOCKUP_TEXT.overBudget, { n: MOCKUP_MAX_ASSETS, size: kib(MOCKUP_MAX_ASSET_BYTES) }))).toBeTruthy();
  });

  const PNG = (b: number): string => `data:image/png;base64,${btoa(String.fromCharCode(b))}`;
  const REFUSED_MAP = '<script type="importmap">{"imports":{"bad":"/x.js"}}</script>';

  it('a refused map\'s plan keeps its mark through a stylesheet\'s extension, so the build\'s keys are the plan\'s (review of the round, M1)', async () => {
    const r = await run(`<!doctype html><html><head>${REFUSED_MAP}<link rel="stylesheet" href="s.css"></head>
<body><img src="j.png"><img src="k.png"></body></html>`, {
      's.css': 'body{background:url(i.png)}', 'i.png': new Uint8Array([1]), 'j.png': new Uint8Array([2]), 'k.png': new Uint8Array([3]),
    });
    expect(r.loaded.rows.map((x) => x.ref.raw)).toContain('i.png');
    expect(r.loaded.importMapRefused).toBe(true);
    expect(r.plan.importMapRefused).toBe(true);
    expect(mapsOf(r.out)).toHaveLength(0);
    expect([...r.out.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual([PNG(2), PNG(3)]);
  });

  it('Export extracts a refused map\'s page as the plan did: each image gets its own bytes (review of the round, M2)', async () => {
    const r = await run(`<!doctype html><html><head>${REFUSED_MAP}</head><body><img src="j.png"><img src="k.png"></body></html>`, {
      'j.png': new Uint8Array([2]), 'k.png': new Uint8Array([3]),
    });
    expect(r.result.plan.importMapRefused).toBe(true);
    const snap = buildMockupSnapshot(r.doc, r.result);
    const out = new DOMParser().parseFromString(snap.html, 'text/html');
    expect([...out.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual([PNG(2), PNG(3)]);
  });

  it('a map inside a noscript is refused, never moved to life (review of the round, N1)', async () => {
    const r = await run(`<!doctype html><html><head></head><body><noscript><script type="importmap">{"imports":{"lib":"./lib.js"}}</script></noscript>
<script type="module">import 'lib';</script></body></html>`, { 'lib.js': 'export default 1;' });
    expect(r.ex.unsupported.map((u) => u.element)).toContain('script[type=importmap]');
    expect(verdictOf(r, 'lib')).toEqual({ v: 'unsupported', why: 'bare' });
    expect(r.out.head.querySelector('script[type="importmap"]')).toBeNull();
  });

  it('an import map element with a src is refused whole (A3)', async () => {
    const r = await run(`<!doctype html><html><head><script type="importmap" src="m.json">{"imports":{"lib":"./lib.js"}}</script>
<script type="module">import 'lib';</script></head><body></body></html>`, { 'lib.js': 'export default 1;' });
    expect(r.ex.unsupported.map((u) => u.element)).toContain('script[type=importmap]');
    expect(verdictOf(r, 'lib')).toEqual({ v: 'unsupported', why: 'bare' });
    expect(mapsOf(r.out)).toHaveLength(0);
  });

  it('a map after a module script, in the body, is moved to the head ahead of every module script (A5)', async () => {
    const r = await run(`<!doctype html><html><head><script type="module" src="main.js"></script></head><body>
<script type="importmap">{"imports":{"lib":"./lib.js"}}</script></body></html>`, {
      'main.js': "import 'lib';\nimport './b.js';\n", 'lib.js': 'export default 1;\n', 'b.js': 'export default 2;\n',
    });
    const scripts = [...r.out.querySelectorAll('script')];
    const map = scripts.findIndex((s) => s.getAttribute('type') === 'importmap');
    const firstModule = scripts.findIndex((s) => s.getAttribute('type') === 'module');
    expect(map).toBeGreaterThanOrEqual(0);
    expect(map).toBeLessThan(firstModule);
    expect(r.out.head.contains(scripts[map]!)).toBe(true);
    expect(Object.keys(importsOf(r.out))).toEqual(['lib', expect.stringMatching(ID_RE)]);
  });

  it('a diamond: a module two others import is written once (A8)', async () => {
    const r = await run('<!doctype html><html><head><script type="module" src="main.js"></script></head><body></body></html>', {
      'main.js': "import './b.js';\nimport './c.js';\n",
      'b.js': "import './d.js';\nexport const b = 1;\n",
      'c.js': "import './d.js';\nexport const c = 1;\n",
      'd.js': "export const d = 'D';\n",
    });
    const values = Object.values(importsOf(r.out)).map(decode);
    expect(values).toHaveLength(3);
    expect(values.filter((t) => t === "export const d = 'D';\n")).toHaveLength(1);
    expect(count(r.page, JS_PREFIX)).toBe(4);
  });

  it('a page within the budget whose modules pass the page cap is told why, not framed with a script silently not loaded (A1)', async () => {
    const big = 2 * MIB - 50_000;
    const files: Files = {
      'a.js': sizedModule("import './b.js';\n", big),
      'b.js': sizedModule("import './c.js';\n", big),
      'c.js': sizedModule('export default 1;\n', MOCKUP_MAX_ASSET_BYTES - 2 * big - 1000),
    };
    const html = '<!doctype html><html><head><script type="module" src="a.js"></script><script type="module" src="b.js"></script><script type="module" src="c.js"></script></head><body></body></html>';
    const r = await run(html, files);
    expect(r.loaded.reservedBytes).toBeLessThanOrEqual(MOCKUP_MAX_ASSET_BYTES);
    expect(r.build.ok).toBe(true);
    expect(verdictOf(r, 'a.js')).toMatchObject({ v: 'inline' });
    expect(verdictOf(r, 'b.js')).toEqual({ v: 'skipped', why: 'over-budget' });
    expect(loaderOverBudget(r.loaded.rows)).toBe(false);
    expect(loaderUnfit(r.loaded.rows, r.plan.rows)).toBe('page');
    // The view: with scripts run it says why and does not frame; Stop scripts takes it back to the static frame.
    const v = renderView(html, files);
    fireEvent.click(await screen.findByRole('button', { name: MOCKUP_TEXT.runScripts }));
    expect(await screen.findByText(fillSentence(MOCKUP_TEXT.overPageCap, { chars: MOCKUP_MAX_SRCDOC_CHARS.toLocaleString('en-US') }))).toBeTruthy();
    expect(v.container.querySelector('iframe')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: MOCKUP_TEXT.stopScripts }));
    expect(await screen.findByRole('button', { name: MOCKUP_TEXT.runScripts })).toBeTruthy();
    expect(v.container.querySelector('iframe')).not.toBeNull();
  }, 60_000);

  it('the view passes a range read through for a fetched sibling above 2 MiB (A9)', async () => {
    const v = renderView("<!doctype html><html><head><script>fetch('big.glb');</script></head><body></body></html>", {
      'big.glb': new Uint8Array([1, 2, 3]),
    }, { 'big.glb': 3 * MIB });
    await vi.waitFor(() => expect(v.calls).toHaveLength(1));
    expect(v.calls[0]).toMatchObject({ path: 'big.glb', range: { size: 3 * MIB, pin: { kind: 'blob' } } });
  });
});

