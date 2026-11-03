// The real-browser row native Docs reader spec 2026-10-01 5.8 gives W5 Export: M5.B9, a hostile export opened
// top-level. One corpus plants every channel a script-free document can open, aimed at origin B: an `img`, CSS `url()`
// and `@import`, `link rel=prefetch`, `preload` and `stylesheet`, `meta http-equiv=refresh`, `base`, a `form`
// submission, `object` and `embed`, `iframe`, and a raw-HTML link that is clicked. Three builds of it are opened
// top-level, from `file://` and from origin A (a static route sending only a content type, with the harness's cookie set
// for A): production (`buildExport` as shipped) reaches neither B nor A's `/api/`; construction only (the CSP meta
// removed) the same, navigation included, because nothing from the input became an element; meta only (the corpus
// interpolated into a string page under the production meta) closes every fetch-type channel, and only navigation
// (the refresh, the clicked link), excluded by name, may reach B, because a CSP meta does not stop navigation (lab 3).
// The CONTROL, the string page with no meta, reaches B on a fetch-type channel: the detector is not blind. Chrome's
// local-network checks are off, so they cannot make a property hold. Under this config `.css?raw` reads as an empty
// string: the stylesheet's own text is docs-export.test.tsx's to hold.
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/docs-export.browser.test.ts )`.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import type { DocLinkContextValue } from '../src/docs/DocLink';
import { detachUrls } from '../src/docs/docsLinks';
import { buildExport } from '../src/docs/export/buildExport';
import { DOCS_EXPORT_CSP } from '../src/docs/export/policy';
import { exportProvenance } from '../src/docs/export/provenance';
import { UNREQUESTED_ENTRY, type HighlightStore } from '../src/lib/highlightStore';
import { parseMarkdown } from '../src/lib/markdownParse';
import { COMMIT_A, SERVED, entry, pageAt, treeOk } from '../test/docsFixtures';
import { resolveChrome, startOrigins, type OriginHit, type Origins } from './harness';

const SETTLE_MS = 1500;
const COOKIE = { name: 'ccrc_demo', value: 'a' } as const;
type Build = 'production' | 'construction' | 'meta' | 'control' | 'meta-click' | 'control-click';
const BUILDS: readonly Build[] = ['production', 'construction', 'meta', 'control', 'meta-click', 'control-click'];
/** The two refresh-free string pages, the only ones whose planted button and link are still on the page when they are
 *  clicked (every other raw corpus carries a `meta refresh 0`, which leaves for B first). */
const CLICK_BUILDS: readonly Build[] = ['meta-click', 'control-click'];
/** The channels that fetch, by the path each plants on B; and the two that navigate. */
/** The fetch-type channels that need no click, each of which the control must reach for the meta build's closure to mean something. */
const FETCH_PATHS = ['/img.png', '/raw-img.png', '/import.css', '/bg.png', '/prefetch', '/preload', '/sheet.css', '/object', '/embed', '/iframe', '/form'];
const CLICK_PATHS_FREE = FETCH_PATHS.filter((p) => p !== '/form');
const NAVIGATION_PATHS = ['/refresh', '/planted'];
/** What Chrome asks of a page a navigation landed on (its icon): a consequence of the navigation, not a channel of the file. */
const LANDING_PATHS = ['/favicon.ico'];

let o: Origins;
let browser: Browser;
let dir: string;
const html: Partial<Record<Build, string>> = {};

/** The hostile corpus, every channel aimed at `b`, as raw HTML (a string page's body) and as Markdown (the export's). */
function corpus(b: string, refresh = true): { raw: string; markdown: string; heading: string } {
  const heading = refresh ? `Report </title><meta http-equiv="refresh" content="0;url=${b}/refresh">` : 'Report';
  const raw = [
    ...(refresh ? [`<meta http-equiv="refresh" content="0;url=${b}/refresh">`] : []),
    `<img src="${b}/raw-img.png" alt="r">`,
    `<style>@import url(${b}/import.css); body { background: url(${b}/bg.png) }</style>`,
    `<link rel="prefetch" href="${b}/prefetch"><link rel="preload" href="${b}/preload" as="image"><link rel="stylesheet" href="${b}/sheet.css">`,
    `<base href="${b}/base/">`,
    `<form action="${b}/form" method="get"><button id="planted-submit">go</button></form>`,
    `<object data="${b}/object"></object><embed src="${b}/embed">`,
    `<iframe src="${b}/iframe"></iframe>`,
    `<a id="planted" href="${b}/planted">planted</a>`,
  ].join('\n');
  return { raw, markdown: `# ${heading}\n\n![img](${b}/img.png)\n\n${raw}\n`, heading };
}

/** The production export of the corpus, built as Docs builds it: parsed, detached, rendered by `buildExport`. */
async function production(b: string): Promise<string> {
  const { markdown, heading } = corpus(b);
  const outcome = parseMarkdown(markdown, 'docs');
  if (outcome.kind !== 'tree') throw new Error(`the corpus did not parse: ${outcome.kind}`);
  const tree = treeOk({ entries: [entry('specs', 'a.md')] });
  const page = pageAt('/docs/demo/specs/a.md');
  if (page.kind !== 'path') throw new Error('fixture');
  const link: Omit<DocLinkContextValue, 'urls'> = {
    project: 'demo', pageRef: null, view: 'effective', section: 'specs', path: 'a.md', tree, pageSource: 'committed', onFragment: () => {},
  };
  const pin = { kind: 'committed', commit: COMMIT_A, servedRef: SERVED, section: 'specs', path: 'a.md' } as const;
  const provenance = exportProvenance({ tree, page, pin, show: null, exportedAt: 0, readAt: 0, plainView: true });
  const detached = detachUrls(outcome.tree);
  const result = await buildExport({
    title: heading, name: 'a.html', theme: null, commit: COMMIT_A, provenance, assets: null,
    body: { kind: 'tree', tree: detached.tree, urls: detached.urls, link, store: EMPTY_STORE },
  });
  if (!result.ok) throw new Error('the corpus did not fit');
  return new TextDecoder().decode(result.bytes);
}

/** A store that has nothing and asks nothing: the corpus has no code. */
const EMPTY_STORE: HighlightStore = {
  mode: 'docs', debounceMs: 0, keyOf: () => ({ kind: 'unregistered' }), seed: () => undefined,
  peek: () => UNREQUESTED_ENTRY, copySkip: () => null, request: () => () => undefined, show: () => () => undefined,
  subscribe: () => () => () => undefined, settled: () => true, evictUnreferenced: () => undefined,
  heldKeys: () => ({ entries: 0, subscribers: 0, listeners: 0 }), releaseAll: () => undefined,
};

/** The corpus interpolated into a string page, with or without the production CSP meta. */
function stringPage(b: string, meta: boolean, refresh = true): string {
  const { raw, heading } = corpus(b, refresh);
  const csp = meta ? `<meta http-equiv="Content-Security-Policy" content="${DOCS_EXPORT_CSP}">` : '';
  return `<!doctype html><html><head><meta charset="utf-8">${csp}<title>${heading}</title></head>`
    + `<body><h1>${heading}</h1><img src="${b}/img.png" alt="img">${raw}</body></html>`;
}

beforeAll(async () => {
  const executablePath = resolveChrome(); // throws on a box with no Chrome: red, never skipped
  const page = (name: Build) => (): { headers: Record<string, string>; body: string } =>
    ({ headers: { 'content-type': 'text/html; charset=utf-8' }, body: html[name] ?? '' });
  o = await startOrigins(Object.fromEntries(BUILDS.map((n) => [`/export/${n}.html`, page(n)])));
  const prod = await production(o.b);
  html.production = prod;
  html.construction = prod.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
  html.meta = stringPage(o.b, true);
  html.control = stringPage(o.b, false);
  html['meta-click'] = stringPage(o.b, true, false);
  html['control-click'] = stringPage(o.b, false, false);
  dir = mkdtempSync(path.join(tmpdir(), 'ccrc-export-b9-'));
  for (const n of BUILDS) writeFileSync(path.join(dir, `${n}.html`), html[n] ?? '');
  browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-features=LocalNetworkAccessChecks'] });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await o?.close();
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

/** Opens `build` top-level from `where`, clicks `click` when given (one click a page: a submit leaves it), waits, and answers every hit any origin received meanwhile. A click build
 *  clicks the planted button and link, and a missing element FAILS (it never skips): a click that did not happen would
 *  leave the channel it carries unproven. */
async function openAndWatch(build: Build, where: 'file' | 'a', click: '#planted-submit' | '#planted' | null = null): Promise<OriginHit[]> {
  const ctx = await browser.newContext();
  await ctx.addCookies([{ ...COOKIE, url: o.a }]);
  const tab = await ctx.newPage();
  const from = o.hits.length;
  const url = where === 'file' ? pathToFileURL(path.join(dir, `${build}.html`)).href : `${o.a}/export/${build}.html`;
  await tab.goto(url, { waitUntil: 'load' }).catch(() => undefined);
  if (CLICK_BUILDS.includes(build) !== (click !== null)) throw new Error(`${build}: a click build names its click, and no other does`);
  if (click !== null) await tab.locator(click).click({ timeout: 5000, noWaitAfter: true }); // a missing element fails here, it never skips
  await tab.waitForTimeout(SETTLE_MS);
  await ctx.close();
  return o.hits.slice(from);
}

const onB = (hits: readonly OriginHit[]): OriginHit[] => hits.filter((h) => h.origin === 'b');
const onApi = (hits: readonly OriginHit[]): OriginHit[] => hits.filter((h) => h.origin === 'a' && h.path.startsWith('/api/'));

describe('M5.B9: the hostile export opened top-level (spec 2026-10-01 5.8)', () => {
  it('the production file holds none of the corpus as an element (the precondition of what follows)', () => {
    const doc = new DOMParser().parseFromString(html.production ?? '', 'text/html');
    expect(doc.querySelectorAll('img, link, base, form, object, embed, iframe, script, meta[http-equiv="refresh"]')).toHaveLength(0);
  });

  it.each(['file', 'a'] as const)('production, opened from %s: nothing reaches B, and nothing reaches A\'s /api/', async (where) => {
    const hits = await openAndWatch('production', where);
    expect(onB(hits)).toEqual([]);
    expect(onApi(hits)).toEqual([]);
  });

  it.each(['file', 'a'] as const)('construction only (no CSP meta), opened from %s: the same, navigation included', async (where) => {
    const hits = await openAndWatch('construction', where);
    expect(onB(hits)).toEqual([]);
    expect(onApi(hits)).toEqual([]);
  });

  it.each(['file', 'a'] as const)('meta only (a string page under the meta), opened from %s: every fetch-type channel closed; only navigation, by name', async (where) => {
    const hits = await openAndWatch('meta', where);
    expect(onB(hits).filter((h) => !NAVIGATION_PATHS.some((p) => h.path.startsWith(p)) && !LANDING_PATHS.some((p) => h.path.startsWith(p)))).toEqual([]);
    expect(onApi(hits)).toEqual([]);
  });

  it.each(['file', 'a'] as const)('meta only, refresh-free, the form submitted, opened from %s: nothing reaches B', async (where) => {
    const hits = await openAndWatch('meta-click', where, '#planted-submit');
    expect(onB(hits)).toEqual([]);
    expect(onApi(hits)).toEqual([]);
  });

  it.each(['file', 'a'] as const)('meta only, refresh-free, the link clicked, opened from %s: only that navigation reaches B, by name', async (where) => {
    const hits = await openAndWatch('meta-click', where, '#planted');
    expect(onB(hits).filter((h) => !LANDING_PATHS.some((p) => h.path.startsWith(p))).map((h) => h.path)).toEqual(['/planted']);
    expect(onApi(hits)).toEqual([]);
  });

  it.each(['file', 'a'] as const)('CONTROL: the string page with no meta, opened from %s, reaches B on every fetch-type channel that needs no click', async (where) => {
    const hits = await openAndWatch('control', where);
    expect(CLICK_PATHS_FREE.filter((p) => !onB(hits).some((h) => h.path.startsWith(p)))).toEqual([]);
  });

  it.each(['file', 'a'] as const)('CONTROL: the refresh-free string page with no meta, the form submitted, opened from %s, reaches B on /form', async (where) => {
    const hits = await openAndWatch('control-click', where, '#planted-submit');
    expect(onB(hits).some((h) => h.path.startsWith('/form'))).toBe(true);
  });

  it.each(['file', 'a'] as const)('CONTROL: the same page, the link clicked, opened from %s, reaches B on /planted', async (where) => {
    const hits = await openAndWatch('control-click', where, '#planted');
    expect(onB(hits).some((h) => h.path.startsWith('/planted'))).toBe(true);
  });
});
