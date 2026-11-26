// The PDF frame's real-browser rows (X2 spec 2026-11-18 section 4.4; plan Task P3.2's browser cases; mutation row M11.18;
// the coordinator's two rows of 2026-11-25: the parser's own thread makes no request, and a draw raises no policy
// refusal). Claims about what the engine DOES with the production artefacts, so each row drives a real browser through
// `playwright-core`: the assets are `loadPdfAssets`' (the installed package, hashed as the console hashes them), the page
// is `buildPdfSrcdoc`'s, the policy `pdfCsp`'s, the shell meta is read from the BUILT `index.html`, and the app row opens
// the built console itself. Every PDF is synthetic (`pdfFixture.ts`), every address under `example.invalid` or a loopback
// origin of the harness.
//
// Engines. Every row is written for any engine Playwright drives; the file runs Chromium (`resolveChrome`), the engine
// this box and CI have. Firefox and the phone engines are not measured here (the close-out's device item). One fact is
// Chromium's own and is named where it is used: Chromium never starts a MODULE worker made from a `blob:` URL inside an
// opaque origin, so there the frame parses on its own thread (spec 4.4's fallback); the rows read which thread ran
// (`data-parser`) rather than assume it.
//
// Rows (each wall with its control where one can be built):
//   link            a tapped link annotation shows its target as text and nothing navigates or opens; CONTROL: an anchor
//                   planted in the frame is stopped by the click guard, and reaches its target once both the guard and the
//                   shell meta are taken away (M11.18)
//   actions         a PDF whose open action runs JavaScript (an alert and a form submission) and whose links carry Launch
//                   and JavaScript actions draws, opens no dialog and no page, and makes no request
//   no network      the parser makes no request on whichever thread it runs (the frame's own requests are only `blob:`)
//   no refusal      a draw raises no policy refusal in the frame (a later release needing a source the policy lacks reds)
//   worker          a classic `blob:` worker started under the frame's own policy cannot reach the network; CONTROL: the same
//                   worker with no policy does
//   app             the built console opens a PDF page in its frame, sandbox exactly `allow-scripts`, `csp` equal to the
//                   page's meta; a forced reload of the frame tears it down once and shows why, and no frame comes back
//
// Run: `( cd pwa && ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/pdf-frame.browser.test.ts )`,
// through `ccrc test`.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Frame, type Page } from 'playwright-core';
import { REFINED } from '@ccrc/ui';
import { DOC_SECTION_SLUGS, DOCS_PDF_INLINE_MAX_BYTES, DOCS_RANGE_FRAME_BYTES, DOCS_RESPONSE_HEADERS } from '../../shared/docs';
import { base64Of } from '../src/docs/mockup/load';
import { loadPdfAssets, type PdfAssets } from '../src/docs/pdf/pdfAssets';
import { PDF_SANDBOX, pdfCsp, pdfMeta } from '../src/docs/pdf/pdfPolicy';
import { buildPdfSrcdoc, pdfCspOfPage, pdfUndrawnImages } from '../src/docs/pdf/pdfSrcdoc';
import { PDF_TEXT } from '../src/docs/pdf/pdfWords';
import { BLOB_1, COMMIT_A, entry, treeOk, treeResponse } from '../test/docsFixtures';
import { openApp, serveDist, sharedDist, type DistServer } from './app';
import { resolveChrome, startOrigins, type Origins } from './harness';
import { buildFixturePdf, PDF_LINKS } from './pdfFixture';

const SHELL_META = /<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/i;
let browser: Browser;
let origins: Origins;
let server: DistServer;
let SHELL = '';
let assets: PdfAssets;
const contexts: BrowserContext[] = [];

beforeAll(async () => {
  const executablePath = resolveChrome(); // a box with no Chrome is a red file, never a skipped one
  origins = await startOrigins({
    '/host': () => ({ headers: { 'content-type': 'text/html; charset=utf-8' }, body: '<!doctype html><title>host</title><body></body>' }),
    // An opaque-origin worker can read the loopback control response when CSP is absent.
    '/x': () => ({ headers: { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }, body: 'reached' }),
  });
  const dist = sharedDist();
  server = await serveDist(dist);
  const found = SHELL_META.exec(readFileSync(path.join(dist, 'index.html'), 'utf8'));
  if (found === null || !found[0].includes("frame-src 'none'")) throw new Error("the built index.html holds no frame-src 'none' shell meta");
  SHELL = found[0];
  assets = await loadPdfAssets();
  browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-features=LocalNetworkAccessChecks'] });
}, 240_000);

afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close().catch(() => undefined);
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
  await origins?.close();
});

const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

/** The page the console builds for `bytes`, from the production builder and assets. */
function pageFor(bytes: Uint8Array): string {
  return buildPdfSrcdoc({
    pdfB64: base64Of(bytes), viewer: assets.viewer, worker: assets.worker, fonts: assets.fonts, cmaps: assets.cmaps,
    hashes: assets.hashes, undrawn: pdfUndrawnImages(bytes),
  });
}

interface Hosted {
  readonly ctx: BrowserContext;
  readonly page: Page;
  readonly frame: Frame;
  /** Every request the context saw after the host page loaded, by URL. */
  readonly requests: string[];
  readonly dialogs: string[];
  readonly popups: number;
  /** The `load` events the host saw on the frame element. */
  loads(): Promise<number>;
}

/** Origin A's host page, with the built shell meta unless `shell: false`, holding one frame with the PDF frame's attributes
 *  and `srcdoc`. Resolves once the frame's document exists. */
async function host(srcdoc: string, o: { shell?: boolean; csp?: string | null; noCanvas?: boolean } = {}): Promise<Hosted> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  contexts.push(ctx);
  if (o.noCanvas === true) {
    await ctx.addInitScript(() => {
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        value() { throw new Error('fixture: canvas unavailable'); },
      });
    });
  }
  const page = await ctx.newPage();
  const requests: string[] = [];
  const dialogs: string[] = [];
  let popups = 0;
  ctx.on('page', () => { popups += 1; });
  page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
  await page.goto(`${origins.a}/host`);
  if (o.shell !== false) await page.evaluate((meta) => { document.head.insertAdjacentHTML('afterbegin', meta); }, SHELL);
  ctx.on('request', (r) => requests.push(r.url()));
  const csp = o.csp === undefined ? pdfCspOfPage(srcdoc) : o.csp;
  await page.evaluate(({ srcdoc, csp, sandbox }) => {
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', sandbox);
    if (csp !== null) f.setAttribute('csp', csp);
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.style.width = '900px';
    f.style.height = '800px';
    (window as unknown as { __loads: number }).__loads = 0;
    f.addEventListener('load', () => { (window as unknown as { __loads: number }).__loads += 1; });
    f.srcdoc = srcdoc;
    document.body.appendChild(f);
  }, { srcdoc, csp, sandbox: PDF_SANDBOX });
  let frame: Frame | undefined;
  for (let i = 0; i < 200 && frame === undefined; i += 1) {
    frame = page.frames().find((f) => f !== page.mainFrame());
    if (frame === undefined) await sleep(50);
  }
  if (frame === undefined) throw new Error('the frame never appeared');
  return {
    ctx, page, frame, requests, dialogs, get popups() { return popups; },
    loads: () => page.evaluate(() => (window as unknown as { __loads: number }).__loads),
  };
}

/** Wait until the frame's body says `shown` or `failed`; answers that word, with the parser's thread and refusals. */
async function drawn(frame: Frame, ms = 60_000): Promise<{ state: string; parser: string | null; refused: string | null; last: string | null }> {
  const end = Date.now() + ms;
  for (;;) {
    const r = await frame.evaluate(() => ({
      state: document.body?.getAttribute('data-state') ?? '', parser: document.body?.getAttribute('data-parser') ?? null,
      refused: document.body?.getAttribute('data-refused') ?? null, last: document.body?.getAttribute('data-refused-last') ?? null,
    })).catch(() => ({ state: '', parser: null, refused: null, last: null }));
    if (r.state === 'shown' || r.state === 'failed') return r;
    if (Date.now() > end) throw new Error(`the frame never drew (state ${JSON.stringify(r.state)})`);
    await sleep(100);
  }
}

const nonBlob = (urls: readonly string[]): string[] => urls.filter((u) => !u.startsWith('blob:'));

describe('pdf frame: link annotation does not navigate (M11.18)', () => {
  it('a tapped link shows its target as text; nothing navigates, opens or is requested', async () => {
    const h = await host(pageFor(buildFixturePdf()));
    expect((await drawn(h.frame)).state).toBe('shown');
    const hitsBefore = origins.hits.length;
    const targets = await h.frame.$$eval('.pdf-link', (els) => els.map((e) => e.getAttribute('data-target')));
    expect(targets).toEqual(expect.arrayContaining([PDF_LINKS.uri]));
    expect(await h.frame.$$eval('a[href], area[href]', (els) => els.length), 'the viewer draws no anchor').toBe(0);
    await h.frame.locator(`.pdf-link[data-target="${PDF_LINKS.uri}"]`).click();
    expect(await h.frame.locator('#pdf-link').innerText()).toBe(PDF_LINKS.uri);
    await sleep(1500);
    expect(await h.loads(), 'one load: the page itself').toBe(1);
    expect(h.frame.url()).toBe('about:srcdoc');
    expect(h.popups).toBe(0);
    expect(nonBlob(h.requests)).toEqual([]);
    expect(origins.hits.length).toBe(hitsBefore);
  });

  it('CONTROL: a planted anchor is stopped by the guard, and reaches its target once the guard and the shell meta are gone', async () => {
    const plant = async (f: Frame, row: string): Promise<void> => {
      await f.evaluate(({ href }) => {
        const a = document.createElement('a');
        a.href = href;
        a.id = 'planted';
        a.textContent = 'planted';
        document.body.prepend(a);
      }, { href: `${origins.b}/x?row=${row}` });
      await f.locator('#planted').click();
    };
    const guarded = await host(pageFor(buildFixturePdf()), { shell: false });
    await drawn(guarded.frame);
    await plant(guarded.frame, 'guarded');
    await sleep(1500);
    expect(origins.hits.filter((x) => x.path === '/x?row=guarded'), 'the guard stops it with no shell meta').toEqual([]);
    expect(await guarded.loads()).toBe(1);
    // The same page with its click guard cut out (the guard is the second element, right after the meta).
    const page = pageFor(buildFixturePdf());
    const cut = page.replace(/^(<meta [^>]*>)<script>[^<]*<\/script>/, '$1');
    expect(cut.length).toBeLessThan(page.length);
    const open = await host(cut, { shell: false, csp: null });
    await drawn(open.frame).catch(() => undefined);
    await plant(open.frame, 'open');
    const end = Date.now() + 10_000;
    while (Date.now() < end && !origins.hits.some((x) => x.path === '/x?row=open')) await sleep(100);
    expect(origins.hits.some((x) => x.path === '/x?row=open'), 'with neither wall the anchor is followed').toBe(true);
  });
});

describe('pdf frame: JavaScript and Launch actions do nothing', () => {
  it('the open action (an alert and a form submission) and the Launch and JavaScript links run nothing and reach nothing', async () => {
    const h = await host(pageFor(buildFixturePdf()));
    expect((await drawn(h.frame)).state).toBe('shown');
    // Every link annotation the page carries (the address, the Launch and the JavaScript one) is tapped.
    const links = h.frame.locator('.pdf-link');
    const n = await links.count();
    expect(n, 'the three link annotations are drawn').toBe(3);
    for (let i = 0; i < n; i += 1) await links.nth(i).click();
    expect(await links.evaluateAll((els) => els.map((e) => e.getAttribute('data-target'))))
      .toEqual(expect.arrayContaining([PDF_LINKS.uri]));
    await sleep(1500);
    expect(h.dialogs).toEqual([]);
    expect(h.popups).toBe(0);
    expect(await h.loads()).toBe(1);
    expect(nonBlob(h.requests)).toEqual([]);
    expect(await h.frame.evaluate(() => document.body.getAttribute('data-state'))).toBe('shown');
  });
});

describe('pdf frame: the parser makes no request, and a draw raises no policy refusal', () => {
  it('on whichever thread the parser runs (Chromium: the frame\'s own), the frame asks for nothing but its own blob:', async () => {
    const h = await host(pageFor(buildFixturePdf()));
    const r = await drawn(h.frame);
    expect(r.state).toBe('shown');
    expect(['worker', 'own-thread']).toContain(r.parser);
    console.info(`pdf-frame: the parser ran on ${String(r.parser)} (${browser.browserType().name()} ${browser.version()})`);
    expect(nonBlob(h.requests)).toEqual([]);
    expect(await h.frame.evaluate(() => document.querySelectorAll('.pdf-page canvas').length)).toBe(1);
  });

  it('a draw raises no refusal of the frame\'s policy', async () => {
    const h = await host(pageFor(buildFixturePdf()));
    const r = await drawn(h.frame);
    expect(r.state).toBe('shown');
    expect({ refused: r.refused, last: r.last }).toEqual({ refused: null, last: null });
  });
});

it('pdf frame: a failed first paint shows the download reason rather than reporting a blank page as shown', async () => {
  const h = await host(pageFor(buildFixturePdf()), { noCanvas: true });
  expect((await drawn(h.frame)).state).toBe('failed');
  expect(await h.frame.locator('#pdf-note').innerText()).toContain('Download it');
});

describe('pdf frame: worker has no network', () => {
  // A probe run under `pdfCsp` (the production policy) with its own hash: a classic `blob:` worker asks origin B; a module
  // worker is attempted too, and whether it started is recorded (Chromium: never, in an opaque origin).
  const probe = (b: string): string => `(function(){var r={};function done(){document.body.setAttribute('data-probe',JSON.stringify(r));}`
    + "var src='fetch(\"" + b + "/x?row=worker\").then(function(){self.postMessage(\"net:yes\")},function(){self.postMessage(\"net:no\")})';"
    + "try{var w=new Worker(URL.createObjectURL(new Blob([src],{type:'text/javascript'})));w.addEventListener('message',function(e){r.classic=e.data;done();});"
    + "w.addEventListener('error',function(){r.classic='error';done();});}catch(e){r.classic='threw';done();}"
    + "try{var m=new Worker(URL.createObjectURL(new Blob(['self.postMessage(1)'],{type:'text/javascript'})),{type:'module'});"
    + "m.addEventListener('message',function(){r.module='started';done();});m.addEventListener('error',function(){r.module='error';done();});}"
    + "catch(e){r.module='threw';done();}})();";

  const run = async (withPolicy: boolean): Promise<Record<string, string>> => {
    const js = probe(origins.b);
    const { createHash } = await import('node:crypto');
    const csp = pdfCsp([createHash('sha256').update(js, 'utf8').digest('base64')]);
    const page = (withPolicy ? pdfMeta(csp) : '') + `<script>${js}</script>`;
    // No shell meta in either run: a srcdoc frame inherits its parent's policy, so the shell's would wall the control too.
    // The walled run is the frame's own policy alone.
    const h = await host(page, { shell: false, csp: withPolicy ? csp : null });
    const end = Date.now() + 10_000;
    let seen: Record<string, string> = {};
    while (Date.now() < end) {
      const raw = await h.frame.evaluate(() => document.body.getAttribute('data-probe')).catch(() => null);
      seen = raw === null ? {} : (JSON.parse(raw) as Record<string, string>);
      if (seen['classic'] !== undefined && seen['module'] !== undefined) break;
      await sleep(100);
    }
    return seen;
  };

  it('a classic blob: worker under the frame\'s policy cannot reach the network; CONTROL: with no policy it does', async () => {
    const before = origins.hits.filter((x) => x.path === '/x?row=worker').length;
    const walled = await run(true);
    expect(walled['classic']).toBe('net:no');
    expect(origins.hits.filter((x) => x.path === '/x?row=worker').length).toBe(before);
    console.info(`pdf-frame: a module blob: worker in the frame: ${String(walled['module'])} (${browser.browserType().name()} ${browser.version()})`);
    const open = await run(false);
    expect(open['classic']).toBe('net:yes');
    expect(origins.hits.filter((x) => x.path === '/x?row=worker').length).toBeGreaterThan(before);
  });
});

describe('the real viewer: a PDF page of the built console', () => {
  const PROJECT = 'demo';
  const SECTION = DOC_SECTION_SLUGS[0]!;
  const json = 'application/json; charset=utf-8';
  const bytes = buildFixturePdf();
  const tree = treeResponse(treeOk({ entries: [entry(SECTION, 'x.pdf', { committed: { kind: 'file', blob: BLOB_1, size: bytes.length } })] }));
  const show = {
    v: 1, verb: 'docs-show', ok: true, elapsedMs: 2, source: 'committed', section: SECTION, path: 'x.pdf', size: bytes.length,
    sha256: 'b'.repeat(64), encoding: 'base64', b64: base64Of(bytes), commit: COMMIT_A, blob: BLOB_1, onRef: 'contains',
  };

  it('opens in its frame, with the walls on the element, and a forced reload tears it down once', async () => {
    const app = await openApp(browser, { width: 1280, skin: REFINED, theme: 'light' }, { api: {}, fleetFrames: [] });
    contexts.push(app.ctx);
    await app.ctx.route((u) => u.pathname.startsWith('/api/docs/'), async (route) => {
      const u = new URL(route.request().url());
      const body = u.pathname.endsWith('/tree') ? tree : { ok: true, contentClass: 'pdf', from: 'ccd', show };
      await route.fulfill({ status: 200, headers: { ...DOCS_RESPONSE_HEADERS, 'content-type': json }, body: JSON.stringify(body) });
    });
    await app.page.goto(`${server.origin}/docs/${PROJECT}/${SECTION}`);
    const row = app.page.getByRole('button').and(app.page.getByTitle('x.pdf', { exact: true }));
    await row.waitFor();
    const readFeedback = async (): Promise<number | undefined> => app.page.evaluate(() =>
      (window as unknown as { pdfFeedbackMs?: number }).pdfFeedbackMs);
    await app.page.evaluate((opening) => {
      const w = window as unknown as { pdfFeedbackMs?: number };
      document.addEventListener('click', () => {
        const tap = performance.now();
        const tick = () => {
          if (document.querySelector('iframe.docs-pdf-frame')) return;
          if ([...document.querySelectorAll('[role=status]')].some((e) => e.textContent === opening)) {
            // Sample the next frame: the console had a paint opportunity before recording feedback.
            requestAnimationFrame(() => { w.pdfFeedbackMs = Math.round(performance.now() - tap); });
          } else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }, { once: true, capture: true });
    }, PDF_TEXT.loading);
    await row.click();
    const el = app.page.locator('iframe.docs-pdf-frame');
    await el.waitFor({ timeout: 60_000 });
    const feedbackMs = await readFeedback();
    expect(feedbackMs, 'the opening status gets a paint opportunity before the frame mounts').toBeGreaterThanOrEqual(0);
    console.info(`pdf-frame: listing tap to opening feedback ${String(feedbackMs)} ms (${browser.browserType().name()} ${browser.version()})`);
    expect(await el.getAttribute('sandbox')).toBe('allow-scripts');
    expect(await el.getAttribute('referrerpolicy')).toBe('no-referrer');
    for (const a of ['src', 'name', 'allow', 'allowfullscreen']) expect(await el.getAttribute(a), a).toBeNull();
    const srcdoc = (await el.getAttribute('srcdoc')) ?? '';
    expect(await el.getAttribute('csp')).toBe(pdfCspOfPage(srcdoc));
    const frame = app.page.frames().find((f) => f.url() === 'about:srcdoc' && f !== app.page.mainFrame());
    expect(frame, 'the frame').toBeDefined();
    expect((await drawn(frame!)).state).toBe('shown');
    await frame!.evaluate(() => { location.reload(); }).catch(() => undefined);
    const notice = app.page.getByText(PDF_TEXT.navigated);
    await notice.waitFor({ timeout: 30_000 });
    expect(await app.page.locator('iframe.docs-pdf-frame').count()).toBe(0);
    await sleep(2000);
    expect(await app.page.locator('iframe.docs-pdf-frame').count(), 'no frame comes back by itself').toBe(0);
    expect(app.errors).toEqual([]);
  });

  it.each([
    [DOCS_PDF_INLINE_MAX_BYTES - 1, true],
    [DOCS_PDF_INLINE_MAX_BYTES, true],
    [DOCS_PDF_INLINE_MAX_BYTES + 1, false],
  ] as const)('lists a %i-byte PDF, inline: %s, and downloads its original bytes', async (size, inline) => {
    const fixture = buildFixturePdf({ size });
    const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
    const digest = hash(fixture);
    const snapshot = 'a'.repeat(32);
    const list = treeResponse(treeOk({ entries: [entry(SECTION, 'boundary.pdf', {
      committed: { kind: 'file', blob: BLOB_1, size },
    })] }));
    const ranges: Array<'prepare' | number> = [];
    const app = await openApp(browser, { width: 1280, skin: REFINED, theme: 'light' }, { api: {}, fleetFrames: [] });
    contexts.push(app.ctx);
    await app.ctx.route((u) => u.pathname.startsWith('/api/docs/'), async (route) => {
      const u = new URL(route.request().url());
      const reply = (body: unknown) => route.fulfill({
        status: 200, headers: { ...DOCS_RESPONSE_HEADERS, 'content-type': json }, body: JSON.stringify(body),
      });
      if (u.pathname.endsWith('/tree')) return reply(list);
      if (!u.pathname.endsWith('/range')) return route.fallback();
      const q = u.searchParams;
      if (q.get('prepare') === '1') {
        ranges.push('prepare');
        return reply({ ok: true, prepared: { snapshot, size, digest } });
      }
      const offset = Number(q.get('offset'));
      const length = Number(q.get('length'));
      const part = fixture.subarray(offset, offset + length);
      ranges.push(offset);
      return reply({ ok: true, frame: { snapshot, offset, total: size, bytesB64: base64Of(part), digest: hash(part) } });
    });
    await app.page.goto(`${server.origin}/docs/${PROJECT}/${SECTION}`);
    await app.page.getByRole('button').and(app.page.getByTitle('boundary.pdf', { exact: true })).click();
    const frames = app.page.locator('iframe.docs-pdf-frame');
    if (inline) {
      await frames.waitFor({ timeout: 60_000 });
      const frame = await frames.elementHandle().then((el) => el?.contentFrame());
      expect(frame, 'the PDF frame').toBeTruthy();
      expect((await drawn(frame!)).state).toBe('shown');
    } else {
      await app.page.getByText(/Docs draws PDFs of up to/).waitFor();
      expect(await frames.count()).toBe(0);
      expect(ranges, 'opening a Download-only PDF does not read it').toEqual([]);
    }
    const [saved] = await Promise.all([
      app.page.waitForEvent('download', { timeout: 30_000 }),
      app.page.getByRole('button', { name: 'Download', exact: true }).click(),
    ]);
    expect(saved.suggestedFilename()).toBe('boundary.pdf');
    expect(hash(readFileSync(await saved.path()))).toBe(digest);
    const offsets = Array.from({ length: Math.ceil(size / DOCS_RANGE_FRAME_BYTES) }, (_, i) => i * DOCS_RANGE_FRAME_BYTES);
    expect(ranges).toEqual(['prepare', ...offsets]);
    expect(await frames.count()).toBe(inline ? 1 : 0);
  });
});
