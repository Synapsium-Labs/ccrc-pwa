// The real-browser rows of native Docs reader spec 2026-10-01 5.8 that W5 owns: M5.B5 (an SVG drawn as Docs draws one,
// a `data:` image, runs nothing and fetches nothing) and M5.B6 (`DOCS_RESPONSE_HEADERS` keep a docs raster out of
// another origin's page, an SVG labelled as a raster inert, and a JSON docs response from executing as a script).
// These are claims about what Chrome DOES with the production values, which jsdom cannot show, so each row drives a
// real Chrome through `playwright-core` (spec 5.7) over the production header values (`shared/docs.ts`), the
// production SVG URL builder (`svgDataUrl`, `docs/DocImage.tsx`) and fixture bytes built from the L0 raster table.
// Every property has a control that inverts it, run in the same Chrome against the same origins, so a property that
// holds only because the fixture never loaded, or because the detector is blind, is red.
//
// Chrome comes from `resolveChrome()` in `beforeAll`, which THROWS when neither `CCRC_CHROME` nor
// `/usr/bin/google-chrome` is an executable file: a box without Chrome gives a red leg, never a skipped one.
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts )`.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { DOCS_RASTER_TYPES, DOCS_RESPONSE_HEADERS, sniffRaster } from '../../shared/docs';
import { svgDataUrl } from '../src/docs/DocImage';
import { onePixelPng, resolveChrome, startOrigins, waitForHit, type OriginAnswer, type OriginHit, type OriginRoute, type Origins } from './harness';

/** How long a property waits, after the page's `load`, for a script or a request that should never come. Each
 *  property's control waits for the same thing to come and sees it well inside this window. */
const SETTLE_MS = 1500;
/** How long a control waits for the thing it proves can happen. */
const CONTROL_MS = 20_000;
const MARK = 'ccrc-marker';
const JSON_TYPE = 'application/json; charset=utf-8';
const COOKIE = { name: 'ccrc_demo', value: 'a' } as const;

type DocsHeader = keyof typeof DOCS_RESPONSE_HEADERS;

/** `DOCS_RESPONSE_HEADERS` less the named ones: a control's headers. Never a hand-typed copy of the values. */
function docsHeadersWithout(...names: DocsHeader[]): Record<string, string> {
  const h: Record<string, string> = { ...DOCS_RESPONSE_HEADERS };
  for (const n of names) delete h[n];
  return h;
}

const PNG = onePixelPng();

let o: Origins;
let browser: Browser;
let ctx: BrowserContext;
let page: Page;
let consoleLines: string[];

/** An SVG that, if anything in it runs, says so twice (an `onload` and a `<script>`, each a console line and a
 *  request to A naming `tag`), and that asks B for an external image. Built from `o`, so only after the origins start. */
function hostileSvg(tag: string): string {
  const mark = (how: string): string => `fetch('${o.a}/marker/${tag}-${how}');console.log('${MARK} ${tag}-${how}')`;
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" '
    + `onload="${mark('onload')}">`
    + `<script>${mark('script')}</script>`
    + `<image href="${o.b}/external/${tag}.png" width="1" height="1"/>`
    + '<rect width="1" height="1" fill="#2f6f9f"/></svg>';
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/** A plain page (no CSP of its own; no favicon request). */
function htmlPage(body: string): OriginAnswer {
  return {
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>fixture</title></head><body>${body}</body></html>`,
  };
}

/** A script element whose outcome lands in `document.title`: `load` once it ran, `error` when it was refused. */
const scriptPage = (src: string): OriginAnswer =>
  htmlPage(`<script src="${src}" onload="document.title='load'" onerror="document.title='error'"></script>`);

const JSON_BODY = JSON.stringify(['ccrc-docs', 'demo']);

const ROUTES: Readonly<Record<string, OriginRoute>> = {
  // M5.B5: the SVG exactly as Docs draws one, an <img> whose src is svgDataUrl's data: URL.
  '/b5/data-img': () => htmlPage(`<img id="i" alt="d" src="${svgDataUrl(utf8(hostileSvg('b5')))}">`),
  // M5.B5's control: the same SVG as a top-level blob:image/svg+xml document, opened by a page on A.
  '/b5/blob-top': () => htmlPage('<script>'
    + `const t = ${JSON.stringify(hostileSvg('b5c')).replaceAll('<', '\\u003c')};`
    + "location.href = URL.createObjectURL(new Blob([t], { type: 'image/svg+xml' }));</script>"),
  // M5.B6: a docs raster on A, with the production headers and with CORP removed (the control).
  '/docs/raster.png': () => ({ headers: { ...DOCS_RESPONSE_HEADERS, 'content-type': DOCS_RASTER_TYPES.png.mime }, body: PNG }),
  '/control/raster-no-corp.png': () => ({
    headers: { ...docsHeadersWithout('cross-origin-resource-policy'), 'content-type': DOCS_RASTER_TYPES.png.mime }, body: PNG,
  }),
  // CORP `same-site` in place of the docs headers' `same-origin`: what tells the two apart (B is same site, C is not).
  '/control/raster-same-site.png': () => ({
    headers: { ...DOCS_RESPONSE_HEADERS, 'cross-origin-resource-policy': 'same-site', 'content-type': DOCS_RASTER_TYPES.png.mime }, body: PNG,
  }),
  '/b6/img-docs': () => htmlPage(`<img id="i" alt="r" src="${o.a}/docs/raster.png">`),
  '/b6/img-no-corp': () => htmlPage(`<img id="i" alt="r" src="${o.a}/control/raster-no-corp.png">`),
  '/b6/img-same-site': () => htmlPage(`<img id="i" alt="r" src="${o.a}/control/raster-same-site.png">`),
  // M5.B6: an SVG body labelled as a raster, opened top-level; its control is the same body labelled as SVG, bare.
  '/docs/svg-as.png': () => ({ headers: { ...DOCS_RESPONSE_HEADERS, 'content-type': DOCS_RASTER_TYPES.png.mime }, body: hostileSvg('b6svg') }),
  '/control/svg.svg': () => ({ headers: { 'content-type': 'image/svg+xml' }, body: hostileSvg('b6svgc') }),
  // The one-variable controls of that case: the label alone, and the headers alone.
  '/control/svg-docs-headers.svg': () => ({ headers: { ...DOCS_RESPONSE_HEADERS, 'content-type': 'image/svg+xml' }, body: hostileSvg('b6svgh') }),
  '/control/svg-as-png-bare.png': () => ({ headers: { 'content-type': DOCS_RASTER_TYPES.png.mime }, body: hostileSvg('b6svgp') }),
  // M5.B6: a JSON docs response as B's <script src>, with every header, with nosniff alone (no CORP), and bare.
  '/docs/doc.json': () => ({ headers: { ...DOCS_RESPONSE_HEADERS, 'content-type': JSON_TYPE }, body: JSON_BODY }),
  '/control/doc-nosniff-only.json': () => ({ headers: { ...docsHeadersWithout('cross-origin-resource-policy'), 'content-type': JSON_TYPE }, body: JSON_BODY }),
  '/control/doc-bare.json': () => ({
    headers: { ...docsHeadersWithout('cross-origin-resource-policy', 'x-content-type-options'), 'content-type': JSON_TYPE }, body: JSON_BODY,
  }),
  '/b6/script-docs': () => scriptPage(`${o.a}/docs/doc.json`),
  '/b6/script-nosniff-only': () => scriptPage(`${o.a}/control/doc-nosniff-only.json`),
  '/b6/script-bare': () => scriptPage(`${o.a}/control/doc-bare.json`),
};

beforeAll(async () => {
  const executablePath = resolveChrome(); // throws on a box with no Chrome: red, never skipped
  o = await startOrigins(ROUTES);
  browser = await chromium.launch({ executablePath, headless: true });
});

afterAll(async () => {
  await browser?.close();
  await o?.close();
});

beforeEach(async () => {
  ctx = await browser.newContext();
  await ctx.addCookies([{ ...COOKIE, url: o.a }]);
  page = await ctx.newPage();
  consoleLines = [];
  page.on('console', (m) => { consoleLines.push(m.text()); });
});

afterEach(async () => {
  await ctx.close();
});

const marks = (): string[] => consoleLines.filter((l) => l.includes(MARK));
const since = (from: number): OriginHit[] => o.hits.slice(from);
/** Chrome's own request for a document's icon (an SVG or image document has none of its own): not the document's doing. */
const notIcon = (h: OriginHit): boolean => h.path !== '/favicon.ico';
const where = (h: OriginHit): string => `${h.origin} ${h.path}`;

/** The `#i` image's naturalWidth once it has loaded or failed. */
function imageWidth(p: Page): Promise<number> {
  return p.evaluate(() => new Promise<number>((resolve) => {
    const i = document.getElementById('i') as HTMLImageElement;
    const done = (): void => resolve(i.naturalWidth);
    if (i.complete) done();
    else { i.addEventListener('load', done); i.addEventListener('error', done); }
  }));
}

/** What a `scriptPage` script did: `load` (it ran) or `error` (it was refused). */
async function scriptOutcome(p: Page): Promise<string> {
  await p.waitForFunction(() => document.title === 'load' || document.title === 'error', undefined, { timeout: CONTROL_MS });
  return p.title();
}

describe('the fixtures are what they claim', () => {
  it('the raster is a real PNG by the L0 table, and A draws it for itself (width 1)', async () => {
    expect(sniffRaster('png', PNG)).toBe('match');
    await page.goto(`${o.a}/b6/img-docs`);
    expect(await imageWidth(page)).toBe(1);
  });
});

describe('M5.B5: an SVG drawn as Docs draws it, a data: image, runs nothing and requests nothing', () => {
  it('the page on A draws the SVG; no script runs (no marker request, no console line) and no request leaves the page', async () => {
    const from = o.hits.length;
    await page.goto(`${o.a}/b5/data-img`, { waitUntil: 'load' });
    await page.waitForTimeout(SETTLE_MS);
    expect(since(from).map(where), 'the only request is the page itself').toEqual(['a /b5/data-img']);
    expect(marks(), 'a script in the SVG ran').toEqual([]);
    expect(await imageWidth(page), 'the SVG was drawn, so nothing ran because nothing may').toBe(1);
  });

  it('control: the same SVG as a top-level blob:image/svg+xml runs as A, and its fetch carries A\'s cookie', async () => {
    const from = o.hits.length;
    await page.goto(`${o.a}/b5/blob-top`);
    await page.waitForURL(/^blob:/, { waitUntil: 'load' });
    // The settle window is proven here, each run: what a running SVG does has arrived by SETTLE_MS after its load
    // (in practice before it, as an inline script runs while the page loads), so a property that waits that long has
    // waited longer than a running script needs.
    const hit = await waitForHit(o, from, (h) => h.origin === 'a' && h.path === '/marker/b5c-script', SETTLE_MS);
    expect(hit, `the blob document's script did not request its marker within ${SETTLE_MS} ms of load`).not.toBeNull();
    expect(hit?.cookie ?? '').toContain(`${COOKIE.name}=${COOKIE.value}`);
    expect(await waitForHit(o, from, (h) => h.origin === 'a' && h.path === '/marker/b5c-onload', SETTLE_MS)).not.toBeNull();
    expect(await waitForHit(o, from, (h) => h.origin === 'b' && h.path === '/external/b5c.png', SETTLE_MS)).not.toBeNull();
    await expect.poll(() => marks().sort(), { timeout: SETTLE_MS }).toEqual([`${MARK} b5c-onload`, `${MARK} b5c-script`]);
  });
});

describe('M5.B6: the docs response headers', () => {
  it('pages on B (same site) and C (another site) <img> a docs raster: naturalWidth 0 on both, though the request arrives', async () => {
    for (const at of [o.b, o.c]) {
      const from = o.hits.length;
      await page.goto(`${at}/b6/img-docs`);
      expect(await imageWidth(page), `${at} drew A's docs raster`).toBe(0);
      expect(since(from).filter((h) => h.origin === 'a').map(where)).toEqual(['a /docs/raster.png']);
    }
  });

  it('the relations are what the titles say: Chrome calls A\'s request from B same-site and from C cross-site', async () => {
    for (const [at, name, site] of [[o.b, 'b', 'same-site'], [o.c, 'c', 'cross-site']] as const) {
      const from = o.hits.length;
      await page.goto(`${at}/b6/img-docs`);
      await imageWidth(page);
      const hit = await waitForHit(o, from, (h) => h.origin === 'a' && h.path === '/docs/raster.png', CONTROL_MS);
      expect(hit?.fetchSite, `${name} is ${site} to A`).toBe(site);
    }
  });

  it('control: without CORP the same raster is drawn on both, width 1', async () => {
    for (const at of [o.b, o.c]) {
      await page.goto(`${at}/b6/img-no-corp`);
      expect(await imageWidth(page), `${at} did not draw the raster without CORP`).toBe(1);
    }
  });

  it('control: CORP same-site in place of same-origin draws the raster on B (same site), width 1, and not on C; same-origin is what keeps B out', async () => {
    await page.goto(`${o.b}/b6/img-same-site`);
    expect(await imageWidth(page), 'B (same site) did not draw a CORP same-site raster').toBe(1);
    await page.goto(`${o.c}/b6/img-same-site`);
    expect(await imageWidth(page), 'C (another site) drew a CORP same-site raster').toBe(0);
    const from = o.hits.length;
    await page.goto(`${o.b}/b6/img-docs`);
    expect(await imageWidth(page), 'B drew the docs-headers raster, so same-origin is no stricter than same-site').toBe(0);
    expect(since(from).filter((h) => h.origin === 'a').map(where), 'the docs-headers request still arrives').toEqual(['a /docs/raster.png']);
  });

  it('an SVG body labelled image/png with every docs header, opened top-level, runs no script (the label and the headers together)', async () => {
    const from = o.hits.length;
    await page.goto(`${o.a}/docs/svg-as.png`, { waitUntil: 'load' });
    await page.waitForTimeout(SETTLE_MS);
    expect(since(from).filter(notIcon).map(where)).toEqual(['a /docs/svg-as.png']);
    expect(marks()).toEqual([]);
  });

  it('control: the same body labelled image/svg+xml with no docs headers runs its script, within the settle window', async () => {
    const from = o.hits.length;
    await page.goto(`${o.a}/control/svg.svg`, { waitUntil: 'load' });
    expect(await waitForHit(o, from, (h) => h.origin === 'a' && h.path === '/marker/b6svgc-script', SETTLE_MS),
      `the bare SVG's script did not request its marker within ${SETTLE_MS} ms of load`).not.toBeNull();
  });

  it('one variable: the same body labelled image/svg+xml WITH every docs header is inert (the CSP alone stops it)', async () => {
    const from = o.hits.length;
    await page.goto(`${o.a}/control/svg-docs-headers.svg`, { waitUntil: 'load' });
    await page.waitForTimeout(SETTLE_MS);
    expect(since(from).filter(notIcon).map(where)).toEqual(['a /control/svg-docs-headers.svg']);
    expect(marks()).toEqual([]);
  });

  it('one variable: the same body labelled image/png WITHOUT any docs header is an image document that does not decode and runs no script (the label alone)', async () => {
    const from = o.hits.length;
    await page.goto(`${o.a}/control/svg-as-png-bare.png`, { waitUntil: 'load' });
    await page.waitForTimeout(SETTLE_MS);
    expect(since(from).filter(notIcon).map(where)).toEqual(['a /control/svg-as-png-bare.png']);
    expect(marks()).toEqual([]);
    expect(await page.evaluate(() => document.contentType), 'the label did not make Chrome treat it as an image').toBe('image/png');
    expect(await page.evaluate(() => document.querySelector('img')?.naturalWidth), 'the SVG body decoded as a PNG').toBe(0);
  });

  it("B's <script src> of a JSON docs response does not execute, with every header and with nosniff alone; the request arrives", async () => {
    for (const [pagePath, docPath] of [['/b6/script-docs', '/docs/doc.json'], ['/b6/script-nosniff-only', '/control/doc-nosniff-only.json']]) {
      const from = o.hits.length;
      await page.goto(`${o.b}${pagePath}`);
      expect(await scriptOutcome(page), `${docPath} executed on B`).toBe('error');
      expect(since(from).filter((h) => h.origin === 'a').map(where)).toEqual([`a ${docPath}`]);
    }
  });

  it('control: without nosniff (and CORP) the same JSON is not refused as B\'s script (load, not error: the script element took it, which is all this proves)', async () => {
    await page.goto(`${o.b}/b6/script-bare`);
    expect(await scriptOutcome(page)).toBe('load');
  });
});
