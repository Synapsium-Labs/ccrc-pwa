// The PDF frame's labs PDF-L1 to PDF-L3 (X2 spec 2026-11-18 sections 4.4 and 8; plan Task P3.3). Measurements, recorded
// in X2's plan (Results, wave P3), each with the bound it is held to. Production artefacts as in pdf-frame.browser.test.ts:
// `loadPdfAssets`, `buildPdfSrcdoc`, the built shell meta, synthetic PDFs from `pdfFixture.ts`.
//
//   PDF-L1  the parser in an opaque origin: which thread it ran on (a MODULE `blob:` worker never starts in Chromium's
//           opaque origin, so there it is the frame's own thread), that a classic `blob:` worker under the frame's policy
//           has no network (pdf-frame.browser.test.ts's worker row holds that with its control), and whether the console
//           stays responsive while the frame parses a PDF at the ceiling: the host page's 16 ms timer, its largest gap
//   PDF-L2  a srcdoc at the ceiling: PDFs of DOCS_PDF_INLINE_MAX_BYTES - 1 and DOCS_PDF_INLINE_MAX_BYTES bytes, with the
//           viewer, the parser, the fonts and the CMaps inline, draw (the page's character count and the time are recorded)
//   PDF-L3  a JPEG 2000 image (the WebAssembly decoders are off, and the script fallback is reached only by an import the
//           policy refuses): the page draws, the frame's note names the image kind as not shown, and the image's pixels
//           are not on the canvas
//
// Chromium only on this box (`resolveChrome`); Firefox and the phone engines are the close-out's device item.
// The pinch row uses Chromium's CDP touch driver; the PDF-L1–L3 assertions do not assume a particular engine.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Frame, type Page } from 'playwright-core';
import { DOCS_PDF_INLINE_MAX_BYTES } from '../../shared/docs';
import { base64Of } from '../src/docs/mockup/load';
import { loadPdfAssets, type PdfAssets } from '../src/docs/pdf/pdfAssets';
import { PDF_SANDBOX } from '../src/docs/pdf/pdfPolicy';
import { buildPdfSrcdoc, pdfCspOfPage, pdfUndrawnImages } from '../src/docs/pdf/pdfSrcdoc';
import { sharedDist } from './app';
import { resolveChrome, startOrigins, type Origins } from './harness';
import { buildFixturePdf, buildScanFixturePdf, buildTextFixturePdf } from './pdfFixture';

const SHELL_META = /<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/i;
let browser: Browser;
let origins: Origins;
let SHELL = '';
let assets: PdfAssets;
const contexts: BrowserContext[] = [];

beforeAll(async () => {
  const executablePath = resolveChrome();
  origins = await startOrigins({
    '/host': () => ({ headers: { 'content-type': 'text/html; charset=utf-8' }, body: '<!doctype html><title>host</title><body></body>' }),
  });
  const found = SHELL_META.exec(readFileSync(path.join(sharedDist(), 'index.html'), 'utf8'));
  if (found === null || !found[0].includes("frame-src 'none'")) throw new Error("the built index.html holds no frame-src 'none' shell meta");
  SHELL = found[0];
  assets = await loadPdfAssets();
  browser = await chromium.launch({ executablePath, headless: true });
}, 240_000);

afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close().catch(() => undefined);
});

afterAll(async () => {
  await browser?.close();
  await origins?.close();
});

const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });
const ENGINE = (): string => `${browser.browserType().name()} ${browser.version()}`;

function pageFor(bytes: Uint8Array): string {
  return buildPdfSrcdoc({
    pdfB64: base64Of(bytes), viewer: assets.viewer, worker: assets.worker, fonts: assets.fonts, cmaps: assets.cmaps,
    hashes: assets.hashes, undrawn: pdfUndrawnImages(bytes),
  });
}

interface Run {
  readonly page: Page; readonly frame: Frame; readonly ms: number; readonly state: string;
  readonly parser: string | null; readonly gapMs: number;
  readonly phases: { mount: number; prepare: number; parse: number; paint: number } | null;
}

/** The standard-font title at (72,720) must leave ink: a layout, empty canvas, or paint that skipped text is not L2. */
function titlePainted(frame: Frame): Promise<boolean> {
  return frame.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.pdf-page canvas');
    if (canvas === null) return false;
    const k = canvas.width / 612;
    const data = canvas.getContext('2d')!.getImageData(Math.floor(72 * k), Math.floor(50 * k), Math.floor(150 * k), Math.floor(24 * k)).data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! > 128 && data[i]! < 160 && data[i + 1]! < 160 && data[i + 2]! < 160) return true;
    }
    return false;
  });
}

/** Mount the frame on A's host page under the built shell meta, with the host's 16 ms timer running, and wait for the frame
 *  to draw; answers the time from mount to `shown` and the timer's largest gap over that time. */
async function draw(srcdoc: string, hasTouch = false): Promise<Run> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch });
  contexts.push(ctx);
  const page = await ctx.newPage();
  await page.goto(`${origins.a}/host`);
  await page.evaluate((meta) => { document.head.insertAdjacentHTML('afterbegin', meta); }, SHELL);
  await page.evaluate(() => {
    const w = window as unknown as { __gap: number; __last: number };
    w.__gap = 0;
    w.__last = performance.now();
    setInterval(() => { const now = performance.now(); w.__gap = Math.max(w.__gap, now - w.__last); w.__last = now; }, 16);
  });
  await sleep(200);
  const t0 = Date.now();
  const mountAt = await page.evaluate(({ srcdoc, csp, sandbox }) => {
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', sandbox);
    f.setAttribute('csp', csp);
    f.style.width = '900px';
    f.style.height = '800px';
    const w = window as unknown as { __gap: number; __last: number };
    w.__gap = 0;
    w.__last = performance.now();
    const at = performance.timeOrigin + w.__last;
    f.srcdoc = srcdoc;
    document.body.appendChild(f);
    return at;
  }, { srcdoc, csp: pdfCspOfPage(srcdoc), sandbox: PDF_SANDBOX });
  let frame: Frame | undefined;
  let state = '';
  let parser: string | null = null;
  const end = Date.now() + 90_000;
  while (Date.now() < end) {
    frame ??= page.frames().find((f) => f !== page.mainFrame());
    if (frame !== undefined) {
      const r = await frame.evaluate(() => [document.body?.getAttribute('data-state') ?? '', document.body?.getAttribute('data-parser') ?? null])
        .catch(() => ['', null]);
      state = r[0] ?? '';
      parser = r[1] ?? null;
      if (state === 'shown' || state === 'failed') break;
    }
    await sleep(50);
  }
  const ms = Date.now() - t0;
  const gapMs = await page.evaluate(() => (window as unknown as { __gap: number }).__gap);
  if (frame === undefined) throw new Error('the frame never appeared');
  const stamps = await frame.evaluate(() => ['pdf-boot', 'pdf-parse', 'pdf-parsed', 'pdf-first-page'].map((name) => {
    const mark = performance.getEntriesByName(name, 'mark').at(-1);
    return mark === undefined ? null : performance.timeOrigin + mark.startTime;
  }));
  const [boot, parse, parsed, paint] = stamps;
  const phases = boot == null || parse == null || parsed == null || paint == null ? null : {
    mount: Math.round(boot - mountAt), prepare: Math.round(parse - boot), parse: Math.round(parsed - parse), paint: Math.round(paint - parsed),
  };
  return { page, frame, ms, state, parser, gapMs: Math.round(gapMs), phases };
}

function longFixture(): Uint8Array {
  const font = assets.fonts['LiberationSans-Regular.ttf'];
  if (font === undefined) throw new Error('the bundled TrueType face is missing');
  return buildTextFixturePdf(Buffer.from(font, 'base64'));
}

async function drawPageAt(frame: Frame, page: number): Promise<void> {
  const box = frame.locator(`.pdf-page[data-page="${page}"]`);
  await box.evaluate((node) => node.scrollIntoView({ block: 'start' }));
  await box.locator('canvas').waitFor({ timeout: 10_000 });
}

it('PDF frame releases distant canvases on a 52-page scroll and redraws the first page on return', async () => {
  const { frame, state } = await draw(pageFor(longFixture()));
  expect(state).toBe('shown');
  const canvas = frame.locator('.pdf-page canvas');
  const first = frame.locator('.pdf-page[data-page="1"] canvas');
  await first.waitFor();
  for (let page = 2; page <= 52; page += 1) {
    await drawPageAt(frame, page);
    if (page === 6) expect(await first.count(), 'the first page was evicted').toBe(0);
    const stores = await canvas.evaluateAll((nodes) => nodes.map((n) => {
      const c = n as HTMLCanvasElement;
      return c.width * c.height;
    }));
    expect(stores.length, `live canvases after scrolling to page ${page}`).toBeLessThanOrEqual(4);
    expect(stores.reduce((sum, pixels) => sum + pixels, 0)).toBeLessThanOrEqual(4 * 4 * 1024 * 1024);
  }
  await drawPageAt(frame, 1);
  expect(await first.count(), 'returning recreates the first canvas').toBe(1);
});

it('PDF frame shows a later page link target in view without navigating', async () => {
  const { page, frame, state } = await draw(pageFor(longFixture()));
  expect(state).toBe('shown');
  await drawPageAt(frame, 52);
  const mainUrl = page.url();
  const link = frame.locator('.pdf-page[data-page="52"] .pdf-link');
  await link.click();
  const target = frame.locator('#pdf-link');
  expect(await target.innerText()).toBe('https://example.invalid/link');
  expect(await target.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight;
  })).toBe(true);
  expect(await frame.evaluate(() => getSelection()?.toString())).toBe('https://example.invalid/link');
  expect(frame.url()).toBe('about:srcdoc');
  expect(page.url()).toBe(mainUrl);
  expect(page.context().pages()).toEqual([page]);
});

it('PDF frame refits the current page on width change and applies successive zoom inputs', async () => {
  const { page, frame, state } = await draw(pageFor(longFixture()));
  expect(state).toBe('shown');
  await drawPageAt(frame, 20);
  const box = frame.locator('.pdf-page[data-page="20"]');
  const width = () => box.evaluate((e) => e.getBoundingClientRect().width);
  const original = await width();
  await page.locator('iframe').evaluate((e) => { e.style.width = '440px'; });
  await expect.poll(width).toBeLessThan(original * 0.6);
  const fit = await width();
  await frame.evaluate(() => {
    const larger = document.getElementById('pdf-larger')!;
    larger.click();
    larger.click();
  });
  await expect.poll(width).toBe(Math.floor(fit * 1.25 ** 2));
  await frame.locator('#pdf-fit').click();
  await expect.poll(width).toBe(fit);
  expect(await box.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return r.top < innerHeight && r.bottom > 0;
  })).toBe(true);
  expect(await frame.locator('.pdf-page').count()).toBe(52);
  await box.locator('canvas').waitFor();
});

it('PDF frame zooms on a two-finger spread in touch-enabled Chromium', async () => {
  const { page, frame, state } = await draw(pageFor(buildFixturePdf()), true);
  expect(state).toBe('shown');
  const box = frame.locator('.pdf-page');
  const width = () => box.evaluate((e) => e.getBoundingClientRect().width);
  const original = await width();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 260, y: 240, id: 1 }, { x: 360, y: 240, id: 2 }] });
  try {
    // Drive one changed contact. The CDP input trace on this engine delivered the first
    // changed contact, but did not consistently deliver a second before the assertion.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 260, y: 240, id: 1 }, { x: 410, y: 240, id: 2 }] });
    await expect.poll(width).toBe(Math.floor(original * 1.5));
  } finally {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  expect(await frame.locator('#pdf-zoom').innerText()).toBe('150%');
  expect(await frame.locator('.pdf-page').count()).toBe(1);
});

describe('PDF-L1: the parser in an opaque origin, and the console while it parses', () => {
  it.each([256 * 1024, 1024 * 1024, DOCS_PDF_INLINE_MAX_BYTES])('a %i-byte PDF draws; mount, parse and first paint are timed', async (size) => {
    const run = await draw(pageFor(buildFixturePdf({ size })));
    console.info(`PDF-L1 (${ENGINE()}): ${size} bytes; parser ${String(run.parser)}; 16 ms host timer's max gap ${run.gapMs} ms; phase ms ${JSON.stringify(run.phases)}`);
    expect(run.state).toBe('shown');
    expect(['worker', 'own-thread']).toContain(run.parser);
    expect(run.phases).not.toBeNull();
    for (const ms of Object.values(run.phases!)) expect(ms).toBeGreaterThanOrEqual(0);
  });
  it('opens a 52-page PDF with an embedded TrueType font and draws only near the view', async () => {
    const bytes = longFixture();
    const run = await draw(pageFor(bytes));
    expect(run.state).toBe('shown');
    await sleep(300); // let the opening intersection callbacks settle before counting mounted canvases
    const { pages, canvases } = await run.frame.evaluate(() => ({
      pages: document.querySelectorAll('.pdf-page').length, canvases: document.querySelectorAll('.pdf-page canvas').length,
    }));
    console.info(`PDF-L1 text (${ENGINE()}): ${bytes.length} bytes; parser ${String(run.parser)}; 16 ms host timer's max gap ${run.gapMs} ms; phase ms ${JSON.stringify(run.phases)}; ${canvases}/${pages} canvases on open`);
    expect(run.phases).not.toBeNull();
    expect(pages).toBe(52);
    expect(canvases).toBeGreaterThanOrEqual(1);
    expect(canvases).toBeLessThan(5);
    expect(await titlePainted(run.frame)).toBe(true);
  });
});

describe('PDF-L2: a srcdoc at the ceiling, with the viewer, the parser, the fonts and the CMaps inline', () => {
  it.each([DOCS_PDF_INLINE_MAX_BYTES - 1, DOCS_PDF_INLINE_MAX_BYTES])('a PDF of %i bytes draws', async (size) => {
    const bytes = buildFixturePdf({ size });
    expect(bytes.length).toBe(size);
    const srcdoc = pageFor(bytes);
    const run = await draw(srcdoc);
    console.info(`PDF-L2 (${ENGINE()}): ${size} bytes; a page of ${srcdoc.length} characters; ${run.state} in ${run.ms} ms`);
    expect(run.state).toBe('shown');
    expect(await titlePainted(run.frame), 'the fixture title left ink on the first page').toBe(true);
  });
});

it('a 300 dpi grayscale scan paints without an omission note', async () => {
  const bytes = buildScanFixturePdf();
  expect(bytes.length).toBeLessThan(DOCS_PDF_INLINE_MAX_BYTES);
  const run = await draw(pageFor(bytes));
  expect(run.state).toBe('shown');
  const pixel = await run.frame.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.pdf-page canvas')!;
    return Array.from(canvas.getContext('2d')!.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data);
  });
  expect(pixel).toEqual([80, 80, 80, 255]);
  expect(await run.frame.locator('#pdf-note').isHidden()).toBe(true);
});

describe('PDF-L3: an image that needs WebAssembly', () => {
  it('a JPEG 2000 image is not drawn, the note says so, and the rest of the page is', async () => {
    const bytes = buildFixturePdf({ jpx: true });
    expect(pdfUndrawnImages(bytes)).toEqual(['JPEG 2000']);
    const run = await draw(pageFor(bytes));
    expect(run.state).toBe('shown');
    const note = await run.frame.locator('#pdf-note').innerText();
    expect(note).toContain('JPEG 2000');
    // The image sits at (72, 500) to (136, 564) in PDF points on a 612 x 792 page, 4 points to its pixel; its fill is
    // (40, 120, 200) with a white diagonal. Read the canvas at its pixel (12, 4), off the diagonal: PDF (122, 546).
    const px = await run.frame.evaluate(() => {
      const c = document.querySelector('.pdf-page canvas') as HTMLCanvasElement;
      const k = c.width / 612;
      const d = c.getContext('2d')!.getImageData(Math.round(122 * k), Math.round((792 - 546) * k), 1, 1).data;
      return [d[0], d[1], d[2]];
    });
    console.info(`PDF-L3 (${ENGINE()}): the image's blue reads rgb(${px.join(', ')}) on the canvas; the note: ${note}`);
    expect(px, 'the JPEG 2000 sample is the white page background').toEqual([255, 255, 255]);
    expect(await titlePainted(run.frame), 'the rest of the PDF still paints').toBe(true);
  });
});
