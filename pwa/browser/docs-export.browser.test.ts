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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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

// This config reads no `vite.config.ts`, so Vite's file-system fence refuses `@ccrc/ui`'s `.css?raw`. The stylesheet module
// is replaced by one that reads the same three files from disk and strips them as `exportStylesheetPart` does, so the file
// under test still carries the real stylesheet text.
vi.mock('../src/docs/export/stylesheet', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
  const part = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@font-face\s*\{[^}]*\}/g, '').trim();
  const parts = ['../../ui/src/styles/tokens.css', '../../ui/src/components/prose.css', '../src/docs/export/export.css'].map((f) => part(read(f)));
  return { exportStylesheetPart: part, EXPORT_CSS: parts.join('\n') };
});

const SETTLE_MS = 1500;
const COOKIE = { name: 'ccrc_demo', value: 'a' } as const;
type Build = 'production' | 'construction' | 'meta' | 'control';
const BUILDS: readonly Build[] = ['production', 'construction', 'meta', 'control'];
/** The channels that fetch, by the path each plants on B; and the two that navigate. */
const FETCH_PATHS = ['/img.png', '/raw-img.png', '/import.css', '/bg.png', '/prefetch', '/preload', '/sheet.css', '/object', '/embed', '/iframe', '/form'];
const NAVIGATION_PATHS = ['/refresh', '/planted'];
/** What Chrome asks of a page a navigation landed on (its icon): a consequence of the navigation, not a channel of the file. */
const LANDING_PATHS = ['/favicon.ico'];

let o: Origins;
let browser: Browser;
let dir: string;
const html: Partial<Record<Build, string>> = {};

/** The hostile corpus, every channel aimed at `b`, as raw HTML (a string page's body) and as Markdown (the export's). */
function corpus(b: string): { raw: string; markdown: string; heading: string } {
  const heading = `Report </title><meta http-equiv="refresh" content="0;url=${b}/refresh">`;
  const raw = [
    `<meta http-equiv="refresh" content="0;url=${b}/refresh">`,
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
function stringPage(b: string, meta: boolean): string {
  const { raw, heading } = corpus(b);
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
  dir = mkdtempSync(path.join(tmpdir(), 'ccrc-export-b9-'));
  for (const n of BUILDS) writeFileSync(path.join(dir, `${n}.html`), html[n] ?? '');
  browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-features=LocalNetworkAccessChecks'] });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await o?.close();
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

/** Opens `build` top-level from `where`, clicks the planted link and button if they exist, waits, and answers every hit
 *  any origin received meanwhile. */
async function openAndWatch(build: Build, where: 'file' | 'a'): Promise<OriginHit[]> {
  const ctx = await browser.newContext();
  await ctx.addCookies([{ ...COOKIE, url: o.a }]);
  const tab = await ctx.newPage();
  const from = o.hits.length;
  const url = where === 'file' ? pathToFileURL(path.join(dir, `${build}.html`)).href : `${o.a}/export/${build}.html`;
  await tab.goto(url, { waitUntil: 'load' }).catch(() => undefined);
  for (const id of ['#planted-submit', '#planted']) {
    if (await tab.locator(id).count().catch(() => 0) > 0) await tab.locator(id).click({ timeout: 2000 }).catch(() => undefined);
  }
  await tab.waitForTimeout(SETTLE_MS);
  await ctx.close();
  return o.hits.slice(from);
}

const onB = (hits: readonly OriginHit[]): OriginHit[] => hits.filter((h) => h.origin === 'b');
const onApi = (hits: readonly OriginHit[]): OriginHit[] => hits.filter((h) => h.origin === 'a' && h.path.startsWith('/api/'));
const fetchType = (h: OriginHit): boolean => FETCH_PATHS.some((p) => h.path.startsWith(p));

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
    expect(onB(hits).filter((h) => ![...NAVIGATION_PATHS, ...LANDING_PATHS].some((p) => h.path.startsWith(p)))).toEqual([]);
    expect(onApi(hits)).toEqual([]);
  });

  it.each(['file', 'a'] as const)('CONTROL: the string page with no meta, opened from %s, reaches B on a fetch-type channel', async (where) => {
    const hits = await openAndWatch('control', where);
    expect(onB(hits).some(fetchType)).toBe(true);
  });
});
