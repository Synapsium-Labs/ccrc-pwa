// Reader mode, proved end to end in a real Chrome over the run's one production build (native Docs reader, reader-mode plan
// Tasks XR1.2, XR1.3, XR1.4, XR2.1 and XR2.3 as amended 2026-11-24, D-8975; spec 2026-11-20 sections 3.3, 4.1, 4.2, 5.3, 5.4 and
// 6.5). The rows are the plan's browser rows for what jsdom cannot see: the focus wrap (jsdom 30 has no `inert` and no tab order
// across a frame), the history of a tab whose first entry is the document, the first paint of a mount made while reader mode is
// on, the overlay's geometry, and the library's screen pages on the real 1.2.0 release.
//
// A harness of its own (the production build served from loopback, `/api/docs` answering one leaf from fixtures, the leaf opened
// inside the console and the reader waited for), as `reader-places.browser.test.ts` and `reader-mode-head.browser.test.ts` have;
// those two files keep their own rows. Two rules of the headless page, both measured in `reader-mode-lab.browser.test.ts`: it has
// no system focus until `page.bringToFront()`, and a second `focus()` on an element already active is a no-op, so a row that
// needs the frame's document focused blurs the iframe first. Every row opens its own context (so no row leaves state to the next),
// and `open` removes the device's remembered turn (`ccrc-reader-turn`) before the page's first script, so a row that chose Scroll
// never leaves a later row in Scroll.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config
// vitest.browser.config.ts browser/reader-mode.browser.test.ts )`, through `ccrc test`.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Frame, type Page } from 'playwright-core';
import { SKINS } from '@ccrc/ui';
import { DOC_SECTION_SLUGS, DOCS_RESPONSE_HEADERS } from '../../shared/docs';
import { READER_MODE_TEXT } from '../src/docs/reader/readerModeWords';
import { COMMIT_A, entry, treeOk, treeResponse } from '../test/docsFixtures';
import { openApp, serveDist, sharedDist, type DistServer, type OpenedApp } from './app';
import { resolveChrome } from './harness';

const SECTION = DOC_SECTION_SLUGS[0]!;
const NAME = '2026-11-27-reader-proof-design.md';
const BLOB = 'd'.repeat(40);
const TAP = 44;
/** The device's remembered turn (`useReaderMode.ts#READER_TURN_STORAGE_KEY`), spelled out: this file reads the page's storage only,
 *  and imports no console module that boots a store. */
const READER_TURN_STORAGE_KEY = 'ccrc-reader-turn';

/** Long enough to turn through several screens at every size the rows use: one short line a section, so a resize does not
 *  re-wrap a line, and a link in each, so a tap target is always at hand. The first paragraph holds the links the rows use. */
const LONG = `# Reader proof\n\n[an outside page](https://example.org/page)\n\n[this very page](${NAME}#part-5)\n\n`
  + Array.from({ length: 70 }, (_, i) => `## Part ${i}\n\nLine ${i} of the proof, see [part ${(i + 20) % 70}](#part-${(i + 20) % 70}).\n\n`).join('');
/** A page with few tab stops, for the rows that Tab through the whole frame. */
const SHORT = '# Short proof\n\nOne paragraph with [a link](#end), and one more line.\n\n## End\n\nThe last line.\n';

let browser: Browser;
let server: DistServer;
let dist: string;
beforeAll(async () => {
  dist = sharedDist();
  server = await serveDist(dist);
  browser = await chromium.launch({ executablePath: resolveChrome(), headless: true });
}, 180_000);
afterAll(async () => { await browser?.close(); await server?.close(); });

/** The turn's key is removed before the page's first script on every load of a row. */
let clearTurn = '';
beforeEach(() => {
  clearTurn = `try { localStorage.removeItem(${JSON.stringify(READER_TURN_STORAGE_KEY)}); } catch { /* none */ }`;
});

/** Runs in every frame of the page: in a sandboxed reader frame it keeps the frame's end of the port the console hands it with
 *  its hello, so a row can speak on the port as the frame's own script would (`reader-places.browser.test.ts`'s hook). */
const PORT_HOOK = `(() => {
  if (window.top === window) return;
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.t !== 'hello' || !e.ports || e.ports.length !== 1) return;
    window.__ccrcPort = e.ports[0];
  }, true);
})();`;

/** Runs in every reader frame from its document's start: on each animation frame it records whether the library's chrome (the
 *  bar's inner row, the running head, the progress line) is drawn, and the root's reading attribute, with an absolute time. */
const PAINT_PROBE = `(() => {
  if (window.top === window) return;
  const samples = [];
  window.__paint = samples;
  const drawn = (el) => {
    if (!el) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const tick = () => {
    const root = document.querySelector('[data-docreader-root]');
    if (root) {
      samples.push({
        t: performance.timeOrigin + performance.now(),
        reading: root.getAttribute('data-reading'),
        bar: drawn(root.querySelector('.topbar-inner')),
        head: drawn(root.querySelector('.running-head')),
        progress: drawn(root.querySelector(':scope > .doc-progress, .doc-progress')),
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

interface View { readonly width: number; readonly height: number }
const DESK: View = { width: 1280, height: 800 };
const PHONE: View = { width: 412, height: 915 };
const PHONE_LANDSCAPE: View = { width: 915, height: 412 };
const PHONE_SMALL: View = { width: 360, height: 800 };

interface OpenOpts {
  readonly view: View;
  readonly text?: string;
  /** A touch screen (below 900 wide there always is one). */
  readonly touch?: boolean;
  /** The Docs address is the first page of a tab of its own (a Docs tab): a new tab opened by `window.open`, as the app's own link
   *  with `target="_blank"` opens one, whose first history entry is the document. (A Playwright `newPage` starts on an
   *  `about:blank` entry that stays below the page, measured: `history.length` 2.) */
  readonly docsTab?: boolean;
  readonly hookPort?: boolean;
  readonly paintProbe?: boolean;
  /** `requestFullscreen` is refused on the reading container, so reader mode opens as the fill. */
  readonly refuseFullScreen?: boolean;
  /** Another page is loaded first, so the Docs page is not the tab's first entry. */
  readonly prelude?: boolean;
}

/** The leaf open inside the console (or as a Docs tab), the reader frame ready and the Reader mode entry drawn. */
async function open(o: OpenOpts): Promise<OpenedApp> {
  const text = o.text ?? LONG;
  const size = Buffer.byteLength(text);
  const tree = treeOk({ entries: [entry(SECTION, NAME, { committed: { kind: 'file', blob: BLOB, size } })] });
  const app = await openApp(browser, {
    width: Math.max(o.view.width, 900), skin: SKINS[0]!.id, theme: 'light', ...(o.docsTab === true ? {} : { tab: 'console' as const }),
    ...(o.touch === true ? { touch: true } : {}),
  }, { api: {}, fleetFrames: [] });
  await app.page.setViewportSize(o.view);
  await app.ctx.route((u) => u.pathname.startsWith('/api/docs/'), async (route) => {
    if (route.request().method() !== 'GET') { await route.fulfill({ status: 204 }); return; }
    const pathname = new URL(route.request().url()).pathname;
    const payload = pathname.endsWith('/tree') ? treeResponse(tree) : {
      ok: true, contentClass: 'markdown', from: 'ccd', show: {
        v: 1, verb: 'docs-show', ok: true, elapsedMs: 3, source: 'committed', section: SECTION, path: NAME,
        size, sha256: BLOB.padEnd(64, '0'), encoding: 'utf8', text, commit: COMMIT_A, blob: BLOB, onRef: 'contains',
      },
    };
    await route.fulfill({ status: 200, headers: { ...DOCS_RESPONSE_HEADERS, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(payload) });
  });
  await app.ctx.addInitScript(clearTurn);
  if (o.hookPort === true) await app.ctx.addInitScript(PORT_HOOK);
  if (o.paintProbe === true) await app.ctx.addInitScript(PAINT_PROBE);
  if (o.refuseFullScreen === true) {
    await app.ctx.addInitScript(() => {
      Element.prototype.requestFullscreen = function refused(): Promise<void> { return Promise.reject(new TypeError('refused for the row')); };
    });
  }
  const url = `${server.origin}/docs/demo/${SECTION}/${NAME}`;
  let opened = app;
  if (o.docsTab === true) {
    // A tab of its own: `window.open` from the first page, whose new tab's first entry is the document.
    const [popup] = await Promise.all([app.ctx.waitForEvent('page'), app.page.evaluate((u) => { window.open(u, '_blank'); }, url)]);
    const errors: string[] = [];
    popup.on('pageerror', (e) => { errors.push(e.message); });
    await popup.setViewportSize(o.view);
    opened = { ...app, page: popup, errors };
  } else {
    if (o.prelude === true) await app.page.goto(`${server.origin}/`, { waitUntil: 'domcontentloaded' });
    await app.page.goto(url, { waitUntil: 'domcontentloaded' });
  }
  const page = opened.page;
  await page.waitForFunction(() => document.querySelector('.docs-reader iframe') !== null && document.querySelector('.doc-formatting') === null,
    undefined, { timeout: 90_000 });
  await page.getByRole('button', { name: READER_MODE_TEXT.enter, exact: true }).first().waitFor({ timeout: 60_000 });
  const frame = await frameOf(page);
  await frame.waitForFunction(() => document.querySelector('[data-docreader-root]') !== null, undefined, { timeout: 90_000 });
  await page.bringToFront();
  // The row starts from a device with no remembered turn.
  expect(await page.evaluate((k) => localStorage.getItem(k), READER_TURN_STORAGE_KEY), 'no remembered turn at the start').toBeNull();
  return opened;
}

async function frameOf(page: Page): Promise<Frame> {
  const frame = await (await page.locator('.docs-reader iframe').last().elementHandle())?.contentFrame();
  if (!frame) throw new Error('reader frame absent');
  return frame;
}

/** Evaluates `expression` in the console's page with NO user gesture (Playwright's own `evaluate` runs with one). */
async function quietEval<T>(page: Page, expression: string): Promise<T> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: false });
    if (r.exceptionDetails !== undefined) throw new Error(`quietEval threw: ${JSON.stringify(r.exceptionDetails)}`);
    return r.result.value as T;
  } finally {
    await cdp.detach();
  }
}

/** Polls `read` until it answers `want`, or fails with the last answer. */
async function becomes<T>(read: () => Promise<T>, want: T, what: string, page: Page, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  let got = await read();
  while (JSON.stringify(got) !== JSON.stringify(want)) {
    if (Date.now() > until) throw new Error(`${what}: wanted ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    await page.waitForTimeout(100);
    got = await read();
  }
}

interface Where { readonly index: number; readonly length: number; readonly url: string }
/** The tab's history, read with no gesture: the entry the page stands on (the Navigation API's index), how many entries there
 *  are (`history.length`), and the address. */
const whereOf = (page: Page): Promise<Where> => quietEval<Where>(page,
  '({ index: navigation.currentEntry.index, length: history.length, url: location.href })');

interface Mode { readonly attr: string | null; readonly full: boolean; readonly overlay: boolean; readonly guards: number }
const modeOf = (page: Page): Promise<Mode> => page.evaluate(() => ({
  attr: document.querySelector('.docs-reading')?.getAttribute('data-reader-mode') ?? null,
  full: document.fullscreenElement?.classList.contains('docs-reading') === true,
  overlay: document.querySelector('.docs-reading-bottom') !== null,
  guards: document.querySelectorAll('.docs-reading-guard').length,
}));

/** Taps the head's Reader mode, and waits for reader mode: full screen granted, or the fill alone when `how` says. */
async function enter(page: Page, how: 'full-screen' | 'fill' = 'full-screen'): Promise<void> {
  await page.getByRole('button', { name: READER_MODE_TEXT.enter, exact: true }).first().click();
  await page.waitForFunction((h) => document.querySelector('.docs-reading')?.getAttribute('data-reader-mode') === h, how, { timeout: 15_000 });
  if (how === 'full-screen') {
    await page.waitForFunction(() => document.fullscreenElement?.classList.contains('docs-reading') === true, undefined, { timeout: 15_000 });
  }
  const frame = await frameOf(page);
  // The reading is in force in the frame once the library has applied the turn.
  await frame.waitForFunction(() => document.querySelector('[data-docreader-root]')?.hasAttribute('data-reading') === true, undefined, { timeout: 15_000 });
}

/** The viewport's width and height as the page sees them. */
const sizeOf = (page: Page): Promise<{ w: number; h: number }> => page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));

/** A tap on the frame's top band (the top 15% of the view, at least 48 px): the frame's `menu` act shows the overlay. */
async function showOverlay(page: Page): Promise<void> {
  const { w } = await sizeOf(page);
  await page.mouse.click(w / 2, 20);
  await page.locator('.docs-reading-bottom').waitFor({ timeout: 10_000 });
}
const overlayShown = (page: Page): Promise<boolean> => page.evaluate(() => document.querySelector('.docs-reading-bottom') !== null);

/** Gives the frame's document the system focus: the iframe is blurred first, since a second `focus()` on an active element does
 *  nothing (the lab's M-4). */
async function focusFrame(page: Page): Promise<Frame> {
  await page.bringToFront();
  await page.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>('.docs-reader iframe')!;
    if (document.activeElement === iframe) iframe.blur();
    iframe.focus();
  });
  const frame = await frameOf(page);
  await frame.waitForFunction(() => document.hasFocus(), undefined, { timeout: 5_000 });
  return frame;
}

/** Speaks on the frame's port, as the frame's own script would (needs `hookPort`). */
const speak = (frame: Frame, msg: unknown): Promise<void> => frame.evaluate((m) => {
  (window as unknown as { __ccrcPort: MessagePort }).__ccrcPort.postMessage(m);
}, msg);

const scrollTopOf = (frame: Frame): Promise<number> => frame.evaluate(() => Math.round(document.scrollingElement?.scrollTop ?? 0));
const shareOf = (frame: Frame): Promise<number> => frame.evaluate(() => {
  const s = document.scrollingElement!;
  return s.scrollTop / Math.max(1, s.scrollHeight - s.clientHeight);
});
const frameHeight = (frame: Frame): Promise<number> => frame.evaluate(() => window.innerHeight);

/** The overlay's controls, in the strip, with their rectangles. */
interface Box { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
const boxOf = (page: Page, selector: string): Promise<Box | null> => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (el === null) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}, selector);

/** Closes a row's context whatever happens, and asks that the page threw nothing. */
async function using(app: OpenedApp, row: () => Promise<void>): Promise<void> {
  try {
    await row();
    expect(app.errors, 'no uncaught error').toEqual([]);
  } finally {
    await app.ctx.close();
  }
}

describe('reader mode: the container, the sheets and the frame (XR1.2)', () => {
  it('reader mode: refused full screen leaves the fill covering the head and banners', async () => {
    const app = await open({ view: DESK, refuseFullScreen: true });
    await using(app, async () => {
      const page = app.page;
      const head = await boxOf(page, '.docs-head');
      expect(head, 'the head is drawn before entering').not.toBeNull();
      await enter(page, 'fill');
      const m = await modeOf(page);
      const hits = await page.evaluate((h) => {
        const inside = (x: number, y: number): boolean => document.elementFromPoint(x, y)?.closest('.docs-reading') != null;
        return {
          headCentre: inside(h!.x + h!.w / 2, h!.y + h!.h / 2),
          topLeft: inside(4, 4),
          topRight: inside(window.innerWidth - 4, 4),
          fullScreen: document.fullscreenElement !== null,
        };
      }, head);
      console.log(`XRB-FIGURE refused-full-screen ${JSON.stringify({ head, mode: m, hits })}`);
      expect(m.attr, 'reader mode is the fill').toBe('fill');
      expect(hits.fullScreen, 'no element is full screen').toBe(false);
      expect(hits.headCentre, 'the point at the head\'s centre is inside the reading container').toBe(true);
      expect(hits.topLeft, 'the top left corner (a banner\'s place) is inside the container').toBe(true);
      expect(hits.topRight, 'the top right corner is inside the container').toBe(true);
    });
  }, 180_000);

  it('reader mode: the external-link sheet shows inside reader mode', async () => {
    const app = await open({ view: DESK });
    await using(app, async () => {
      const page = app.page;
      await enter(page);
      const frame = await frameOf(page);
      const link = await frame.getByRole('link', { name: 'an outside page', exact: true }).boundingBox();
      if (link === null) throw new Error('the outside link has no box');
      await page.mouse.click(link.x + link.width / 2, link.y + link.height / 2);
      await page.waitForFunction(() => document.querySelector('[role="dialog"][data-state="open"]') !== null, undefined, { timeout: 15_000 });
      const sheet = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"][data-state="open"]')!;
        const r = dialog.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return {
          inPortal: dialog.closest('.docs-reading-portal') !== null,
          inContainer: dialog.closest('.docs-reading') !== null,
          hitInDialog: hit !== null && dialog.contains(hit),
          w: r.width, h: r.height, fullScreen: document.fullscreenElement?.classList.contains('docs-reading') === true,
          text: dialog.textContent?.includes('example.org') === true,
        };
      });
      console.log(`XRB-FIGURE link-sheet ${JSON.stringify(sheet)}`);
      expect(sheet.fullScreen, 'the container is still the full-screen element').toBe(true);
      expect(sheet.inPortal, 'the dialog is inside .docs-reading-portal').toBe(true);
      expect(sheet.inContainer, 'and so inside the reading container').toBe(true);
      expect(sheet.w * sheet.h, 'the dialog has a box').toBeGreaterThan(0);
      expect(sheet.hitInDialog, 'the dialog is visible at its centre').toBe(true);
      expect(sheet.text, 'and it names the link\'s address').toBe(true);
    });
  }, 180_000);

  it('reader mode: no allowfullscreen or allow attribute on the reader frame', async () => {
    const app = await open({ view: DESK });
    await using(app, async () => {
      const iframe = app.page.locator('.docs-reader iframe').last();
      expect(await iframe.getAttribute('allowfullscreen'), 'no allowfullscreen').toBeNull();
      expect(await iframe.getAttribute('allow'), 'no allow').toBeNull();
      await enter(app.page);
      expect(await iframe.getAttribute('allowfullscreen'), 'none in reader mode either').toBeNull();
      expect(await iframe.getAttribute('allow'), 'no allow in reader mode either').toBeNull();
      expect(await iframe.getAttribute('sandbox'), 'the sandbox is exactly allow-scripts').toBe('allow-scripts');
    });
  }, 180_000);
});

describe('focus: the wrap around the frame (XR1.2)', () => {
  /** Presses `key` until the console's active element is not the reader's iframe (at most `cap` presses): the press that left the
   *  frame. Returns how many presses it took. */
  async function leaveFrame(page: Page, key: string, cap = 40): Promise<number> {
    for (let n = 1; n <= cap; n += 1) {
      await page.keyboard.press(key);
      const inFrame = await page.evaluate(() => document.activeElement === document.querySelector('.docs-reader iframe'));
      if (!inFrame) return n;
    }
    return cap;
  }
  const activeOf = (page: Page): Promise<{ cls: string; tag: string; inFrame: boolean }> => page.evaluate(() => {
    const a = document.activeElement;
    return { cls: a?.className?.toString() ?? '', tag: a?.tagName ?? '', inFrame: a === document.querySelector('.docs-reader iframe') };
  });

  it('focus: Tab from the last ccrc control lands in the frame', async () => {
    const app = await open({ view: DESK, text: SHORT });
    await using(app, async () => {
      const page = app.page;
      await enter(page);
      await showOverlay(page);
      await page.locator('.docs-reading-aa').focus();
      expect((await activeOf(page)).cls, 'the last control, Aa, holds focus').toContain('docs-reading-aa');
      await page.keyboard.press('Tab');
      const after = await activeOf(page);
      console.log(`XRB-FIGURE tab-from-aa ${JSON.stringify(after)}`);
      expect(after.inFrame, 'Tab from Aa lands on the reader\'s iframe').toBe(true);
      const frame = await frameOf(page);
      await frame.waitForFunction(() => document.hasFocus(), undefined, { timeout: 5_000 });
      await page.keyboard.press('?');
      await frame.waitForFunction(() => document.querySelector('.keys.open') !== null, undefined, { timeout: 10_000 });
    });
  }, 180_000);

  it('focus: Tab out of the frame\'s last control lands on the first ccrc control', async () => {
    const app = await open({ view: DESK, text: SHORT });
    await using(app, async () => {
      const page = app.page;
      await enter(page);
      await showOverlay(page);
      await focusFrame(page);
      const presses = await leaveFrame(page, 'Tab');
      const after = await activeOf(page);
      console.log(`XRB-FIGURE tab-out ${JSON.stringify({ presses, after })}`);
      expect(after.cls, 'the first ccrc control, Exit, holds focus').toContain('docs-reading-exit');
    });
  }, 180_000);

  it('focus: Shift+Tab out of the frame\'s first control lands on the last ccrc control', async () => {
    const app = await open({ view: DESK, text: SHORT });
    await using(app, async () => {
      const page = app.page;
      await enter(page);
      await showOverlay(page);
      await focusFrame(page);
      const presses = await leaveFrame(page, 'Shift+Tab');
      const after = await activeOf(page);
      console.log(`XRB-FIGURE shift-tab-out ${JSON.stringify({ presses, after })}`);
      expect(after.cls, 'the last ccrc control, Aa, holds focus').toContain('docs-reading-aa');
    });
  }, 180_000);

  it('focus: with the overlay hidden, Shift+Tab out of the frame\'s first control returns focus to the frame', async () => {
    const app = await open({ view: DESK, text: SHORT });
    await using(app, async () => {
      const page = app.page;
      await enter(page);
      expect(await overlayShown(page), 'the overlay is hidden on entry').toBe(false);
      await focusFrame(page);
      // The leading guard's own focus is counted, so a press that left the frame is told from one that did not.
      await page.evaluate(() => {
        const w = window as unknown as { __guard: number };
        w.__guard = 0;
        document.addEventListener('focusin', (e) => {
          if ((e.target as Element).classList?.contains('docs-reading-guard')) w.__guard += 1;
        }, true);
      });
      let presses = 0;
      for (; presses < 40; presses += 1) {
        await page.keyboard.press('Shift+Tab');
        if ((await page.evaluate(() => (window as unknown as { __guard: number }).__guard)) > 0) { presses += 1; break; }
      }
      const guards = await page.evaluate(() => (window as unknown as { __guard: number }).__guard);
      const after = await activeOf(page);
      console.log(`XRB-FIGURE shift-tab-hidden ${JSON.stringify({ presses, guards, after })}`);
      expect(guards, 'the press left the frame by the leading guard').toBeGreaterThan(0);
      expect(after.inFrame, 'with no ccrc control drawn, focus is back in the frame').toBe(true);
      expect(await overlayShown(page), 'and the overlay is still hidden').toBe(false);
      const frame = await frameOf(page);
      expect(await frame.evaluate(() => document.hasFocus()), 'the frame\'s document has the focus').toBe(true);
    });
  }, 180_000);

  it('focus: a head control cannot take focus while reader mode is on', async () => {
    // In the fill (full screen refused), where only ccrc's own hiding keeps the page behind it from focus: in real full screen the
    // browser makes everything outside the full-screen element unfocusable by itself (measured: with `hideAsPage` applying no
    // `inert`, no control took focus in full screen), so a row in full screen could not tell the hiding from the browser's.
    const app = await open({ view: DESK, refuseFullScreen: true });
    await using(app, async () => {
      const page = app.page;
      await enter(page, 'fill');
      const tried = await page.evaluate(() => {
        const inside = (el: Element): boolean => el.closest('.docs-reading') !== null;
        const controls = [...document.querySelectorAll<HTMLElement>('.docs-head a[href], .docs-head button, .skip-link, header a[href], header button')]
          .filter((el) => !inside(el));
        const before = document.activeElement;
        const results = controls.map((el) => {
          const was = document.activeElement;
          el.focus();
          const took = document.activeElement === el;
          if (took) el.blur();
          return { name: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30), took, unchanged: was === document.activeElement || took };
        });
        return { n: controls.length, results, unchanged: document.activeElement === before, inert: controls.filter((el) => el.closest('[inert]') !== null).length };
      });
      console.log(`XRB-FIGURE head-focus ${JSON.stringify(tried)}`);
      expect(tried.n, 'there are head controls outside the container to try').toBeGreaterThan(2);
      expect(tried.results.filter((r) => r.took), 'none of them takes focus').toEqual([]);
      expect(tried.unchanged, 'the active element is unchanged by the attempts').toBe(true);
      expect(tried.inert, 'every one sits in an inert subtree').toBe(tried.n);
    });
  }, 180_000);
});

describe('reader place: Back, and a Docs page that is a tab\'s first entry (XR1.3)', () => {
  it('reader place: Back from reader mode shows the doc in the normal view, a second Back leaves it', async () => {
    const app = await open({ view: DESK, prelude: true });
    await using(app, async () => {
      const page = app.page;
      const doc = page.url();
      const before = await whereOf(page);
      await enter(page);
      const during = await whereOf(page);
      await page.goBack();
      await page.waitForFunction(() => document.fullscreenElement === null && document.querySelector('.docs-reading')?.hasAttribute('data-reader-mode') === false,
        undefined, { timeout: 15_000 });
      await becomes(() => whereOf(page).then((w) => w.index), before.index, 'the entry after the first Back', page);
      const after = await whereOf(page);
      const shown = await page.evaluate(() => ({
        frame: document.querySelector('.docs-reader iframe') !== null,
        entry: document.querySelector('.docs-head .docs-reader-mode') !== null || document.querySelector('.docs-reader-mode') !== null,
        console: document.querySelector('.docs-head') !== null,
      }));
      console.log(`XRB-FIGURE back-places ${JSON.stringify({ before, during, after, shown })}`);
      expect(during.index, 'entering pushed the place').toBe(before.index + 1);
      expect(after.url, 'the first Back stayed on the document').toBe(doc);
      expect(shown.frame && shown.console && shown.entry, 'the doc is in the normal view with its head and the entry').toBe(true);
      await page.goBack();
      await page.waitForFunction(() => location.pathname === '/', undefined, { timeout: 15_000 });
      expect(new URL(page.url()).pathname, 'the second Back left the document').toBe('/');
    });
  }, 180_000);

  it('reader place: on a Docs page that is the first history entry in its own tab, entering reader mode, then Exit, and again Back, each leave reader mode and stay on the document, and no entry before the page is consumed', async () => {
    const app = await open({ view: DESK, docsTab: true });
    await using(app, async () => {
      const page = app.page;
      const doc = page.url();
      const steps: Array<{ step: string } & Where & Mode> = [];
      const note = async (step: string): Promise<{ w: Where; m: Mode }> => {
        const w = await whereOf(page);
        const m = await modeOf(page);
        steps.push({ step, ...w, ...m });
        return { w, m };
      };
      const start = await note('start');
      expect(start.w.index, 'the page is the tab\'s first entry').toBe(0);
      expect(start.w.length, 'and the only one').toBe(1);
      expect(start.m.attr, 'reader mode is off').toBeNull();

      // 1. Enter.
      await enter(page);
      await becomes(() => whereOf(page).then((w) => w.length), 2, 'history length after entering', page);
      const entered = await note('entered');
      expect(entered.m.attr, 'reader mode is on').not.toBeNull();
      expect(entered.w.index, 'on the pushed place').toBe(1);
      expect(entered.w.length, 'one entry added').toBe(2);
      expect(entered.w.url, 'the address is the document\'s').toBe(doc);

      // 2. Exit (the overlay's button).
      await showOverlay(page);
      await page.locator('.docs-reading-exit').click();
      await page.waitForFunction(() => document.querySelector('.docs-reading')?.hasAttribute('data-reader-mode') === false, undefined, { timeout: 15_000 });
      await becomes(() => whereOf(page).then((w) => w.index), 0, 'the entry after Exit', page);
      const exited = await note('exited');
      expect(exited.m.attr, 'reader mode is off').toBeNull();
      expect(exited.m.full, 'no full screen').toBe(false);
      expect(exited.w.index, 'back on the first entry, none before it consumed').toBe(0);
      expect(exited.w.length, 'the tab keeps its two entries (the place is a forward one)').toBe(2);
      expect(exited.w.url, 'still on the document').toBe(doc);
      expect(await page.locator('.docs-reader iframe').count(), 'the document is shown').toBe(1);

      // 3. Enter again.
      await enter(page);
      await becomes(() => whereOf(page).then((w) => w.index), 1, 'the entry after entering again', page);
      const again = await note('entered again');
      expect(again.m.attr, 'reader mode is on').not.toBeNull();
      expect(again.w.length, 'the place replaced the forward one: still two entries').toBe(2);
      expect(again.w.url, 'the document\'s address').toBe(doc);

      // 4. Back.
      await page.goBack();
      await page.waitForFunction(() => document.fullscreenElement === null && document.querySelector('.docs-reading')?.hasAttribute('data-reader-mode') === false,
        undefined, { timeout: 15_000 });
      await becomes(() => whereOf(page).then((w) => w.index), 0, 'the entry after Back', page);
      const back = await note('back');
      expect(back.m.attr, 'reader mode is off').toBeNull();
      expect(back.w.index, 'on the first entry').toBe(0);
      expect(back.w.length, 'two entries still, none lost').toBe(2);
      expect(back.w.url, 'still on the document').toBe(doc);
      expect(await page.locator('.docs-reader iframe').count(), 'the document is shown').toBe(1);
      console.log(`XRB-FIGURE own-tab ${JSON.stringify(steps)}`);
    });
  }, 240_000);

  it('reader ops: Esc in the fill, focus in the frame, leaves reader mode', async () => {
    const app = await open({ view: DESK, prelude: true, refuseFullScreen: true });
    await using(app, async () => {
      const page = app.page;
      const doc = page.url();
      const before = await whereOf(page);
      await enter(page, 'fill');
      const frame = await focusFrame(page);
      const during = await whereOf(page);
      expect(during.index, 'entering pushed the place').toBe(before.index + 1);
      expect(await modeOf(page).then((m) => m.full), 'full screen was refused: it is the fill').toBe(false);
      await frame.evaluate(() => document.hasFocus());
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('.docs-reading')?.hasAttribute('data-reader-mode') === false, undefined, { timeout: 15_000 });
      await becomes(() => whereOf(page).then((w) => w.index), before.index, 'the entry after Esc', page);
      const after = await whereOf(page);
      const shown = await page.evaluate(() => ({ head: document.querySelector('.docs-head') !== null, frame: document.querySelector('.docs-reader iframe') !== null }));
      console.log(`XRB-FIGURE esc-fill ${JSON.stringify({ before, during, after, shown })}`);
      expect(after.index, 'one history step was consumed: the entry below the place').toBe(before.index);
      expect(after.url, 'the document is still the page').toBe(doc);
      expect(shown, 'the document is shown in the normal view').toEqual({ head: true, frame: true });
    });
  }, 180_000);
});

describe('reader mode: a new mount made while it is on (XR1.4)', () => {
  interface PaintSample { t: number; reading: string | null; bar: boolean; head: boolean; progress: boolean }
  interface ShownSample { t: number; shown: boolean }

  for (const view of [PHONE, DESK]) {
    it(`reader mode: a new mount made while reader mode is on paints its first frame with the reader's chrome hidden (${view.width} by ${view.height})`, async () => {
      const app = await open({ view, paintProbe: true });
      await using(app, async () => {
        const page = app.page;
        await enter(page);
        // The old frame is marked, so the sampler follows the new one only.
        await page.evaluate(() => {
          const old = document.querySelector('.docs-reader iframe')!;
          old.setAttribute('data-old', '');
          const w = window as unknown as { __shown: Array<{ t: number; shown: boolean }>; __stop: boolean };
          w.__shown = [];
          w.__stop = false;
          const tick = (): void => {
            const fresh = document.querySelector('.docs-reader iframe:not([data-old])');
            const shown = fresh !== null && (fresh as HTMLElement).checkVisibility({ checkVisibilityCSS: true, opacityProperty: true });
            w.__shown.push({ t: performance.timeOrigin + performance.now(), shown });
            if (!w.__stop) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        const oldFrame = await frameOf(page);
        // A link to this very page, spelled with its file name: the body's live mount opens the document again (`openAt`).
        const link = await oldFrame.getByRole('link', { name: 'this very page', exact: true }).boundingBox();
        if (link === null) throw new Error('the same-page link has no box');
        await page.mouse.click(link.x + link.width / 2, link.y + link.height / 2);
        await page.waitForFunction(() => document.querySelector('.docs-reader iframe:not([data-old])') !== null, undefined, { timeout: 30_000 });
        const fresh = await (await page.locator('.docs-reader iframe:not([data-old])').elementHandle())?.contentFrame();
        if (!fresh) throw new Error('the new frame is absent');
        await fresh.waitForFunction(() => document.querySelector('[data-docreader-root]')?.hasAttribute('data-reading') === true, undefined, { timeout: 30_000 });
        await page.waitForTimeout(700);
        await page.evaluate(() => { (window as unknown as { __stop: boolean }).__stop = true; });
        const shownRaw = await page.evaluate(() => (window as unknown as { __shown: ShownSample[] }).__shown);
        const painted = await fresh.evaluate(() => (window as unknown as { __paint: PaintSample[] }).__paint);
        // A frame sample is seen by the user when the console's latest sample at or before it has the new iframe shown.
        const seen = (t: number): boolean => {
          let last: ShownSample | null = null;
          for (const s of shownRaw) { if (s.t <= t + 8) last = s; else break; }
          return last !== null && last.shown;
        };
        const firstDrawn = painted.findIndex((s) => s.bar || s.head || s.progress);
        const offenders = painted.filter((s) => (s.bar || s.head || s.progress) && s.reading === null && seen(s.t));
        const everDrawn = painted.filter((s) => s.bar || s.head || s.progress);
        const hiddenWhileDrawn = everDrawn.filter((s) => !seen(s.t)).length;
        console.log(`XRB-FIGURE first-paint ${view.width}x${view.height} ${JSON.stringify({
          frameSamples: painted.length, firstSample: painted[0] ?? null, firstDrawn, drawnSamples: everDrawn.length,
          unreadSamples: painted.filter((s) => s.reading === null).length, seenDrawn: offenders.length, hiddenWhileDrawn,
          shownSamples: shownRaw.length, shownFirst: shownRaw.find((s) => s.shown)?.t ?? null,
        })}`);
        expect(painted.length, 'the new frame painted (it was sampled on each of its animation frames)').toBeGreaterThan(0);
        expect(painted.at(-1)?.reading, 'the new frame ends in the reading in force').toBe('screens');
        expect(offenders, 'no painted sample of the new frame shows the bar, the running head or the progress line').toEqual([]);
        expect(painted.filter((s) => (s.bar || s.head || s.progress) && seen(s.t)), 'and none of the chrome was ever drawn and visible').toEqual([]);
      });
    }, 240_000);
  }
});

describe('reader ops: the overlay (XR2.1)', () => {
  for (const view of [PHONE, PHONE_LANDSCAPE]) {
    it(`reader ops: a second menu act hides the overlay, and a tap on the layer or anywhere on the top strip hides it (${view.width} by ${view.height})`, async () => {
      const app = await open({ view, touch: true, hookPort: true });
      await using(app, async () => {
        const page = app.page;
        await enter(page);
        expect(await overlayShown(page), 'hidden on entry').toBe(false);
        const { w, h } = await sizeOf(page);

        // 1. The menu act from a tap on the frame's top band shows it; a second menu act, spoken on the frame's port, hides it.
        await showOverlay(page);
        const frame = await frameOf(page);
        await page.waitForTimeout(400);
        await speak(frame, { t: 'reader', act: 'menu' });
        await becomes(() => overlayShown(page), false, 'the overlay after a second menu act', page);
        const m1 = await modeOf(page);
        expect(m1.attr, 'reader mode stays on').not.toBeNull();

        // 2. A tap on the layer, between the strips, hides it and does nothing else.
        await page.waitForTimeout(400);
        await showOverlay(page);
        const layerPoint = { x: w / 2, y: h / 2 };
        const hitLayer = await page.evaluate((p) => document.elementFromPoint(p.x, p.y)?.className?.toString() ?? '', layerPoint);
        expect(hitLayer, 'the point between the strips is the layer').toContain('docs-reading-layer');
        const before = await whereOf(page);
        await page.mouse.click(layerPoint.x, layerPoint.y);
        await becomes(() => overlayShown(page), false, 'the overlay after a tap on the layer', page);
        const m2 = await modeOf(page);
        const after = await whereOf(page);
        expect(m2.attr, 'reader mode stays on after the layer\'s tap').not.toBeNull();
        expect(after.index, 'no history step').toBe(before.index);

        // 3. A tap anywhere on the top strip hides it: its left end, its middle and its right end.
        const strip = await (async () => {
          await page.waitForTimeout(400);
          await showOverlay(page);
          return boxOf(page, '.docs-reading-top');
        })();
        expect(strip, 'the top strip is drawn').not.toBeNull();
        expect(strip!.h, 'the strip is at least the tap floor tall').toBeGreaterThanOrEqual(TAP);
        const points = [strip!.x + 4, strip!.x + strip!.w / 2, strip!.x + strip!.w - 4];
        const hits: string[] = [];
        for (const x of points) {
          if (!(await overlayShown(page))) { await page.waitForTimeout(400); await showOverlay(page); }
          const y = strip!.y + strip!.h / 2;
          hits.push(await page.evaluate((p) => document.elementFromPoint(p.x, p.y)?.closest('.docs-reading-top')?.className?.toString() ?? 'miss', { x, y }));
          await page.mouse.click(x, y);
          await becomes(() => overlayShown(page), false, `the overlay after a tap on the top strip at ${Math.round(x)}`, page);
        }
        const m3 = await modeOf(page);
        console.log(`XRB-FIGURE overlay-hides ${view.width}x${view.height} ${JSON.stringify({ hitLayer, strip, hits, mode: m3 })}`);
        expect(hits.every((c) => c.includes('docs-reading-top')), `every top-strip tap landed on the strip (${hits.join(', ')})`).toBe(true);
        expect(m3.attr, 'reader mode is still on').not.toBeNull();
      });
    }, 240_000);
  }

  for (const view of [PHONE, PHONE_SMALL]) {
    it(`overlay: at a phone's width Exit, the turn setting and Aa share one row and the progress stays in the viewport (${view.width} by ${view.height})`, async () => {
      const app = await open({ view });
      await using(app, async () => {
        const page = app.page;
        await enter(page);
        await showOverlay(page);
        const { w, h } = await sizeOf(page);
        const names = ['.docs-reading-exit', '.docs-reading-turn:nth-of-type(1)', '.docs-reading-turn:nth-of-type(2)', '.docs-reading-aa'] as const;
        const boxes = await Promise.all(names.map((n) => boxOf(page, n)));
        const percent = await boxOf(page, '.docs-reading-percent');
        const text = await page.locator('.docs-reading-percent').textContent();
        console.log(`XRB-FIGURE overlay-row ${view.width}x${view.height} ${JSON.stringify({ viewport: { w, h }, boxes, percent, text })}`);
        for (const [i, b] of boxes.entries()) {
          expect(b, `${names[i]} is drawn`).not.toBeNull();
          expect(b!.w, `${names[i]} is at least ${TAP} wide`).toBeGreaterThanOrEqual(TAP - 0.5);
          expect(b!.h, `${names[i]} is at least ${TAP} tall`).toBeGreaterThanOrEqual(TAP - 0.5);
        }
        const centres = boxes.map((b) => b!.y + b!.h / 2);
        expect(Math.max(...centres) - Math.min(...centres), 'Exit, both turn choices and Aa share one row (their centres within 1 px)').toBeLessThanOrEqual(1);
        const lefts = boxes.map((b) => b!.x);
        expect(lefts, 'in the strip\'s order: Exit, Pages, Scroll, Aa').toEqual([...lefts].sort((a, b) => a - b));
        expect(percent, 'the progress text is drawn').not.toBeNull();
        expect(percent!.x, 'the progress stays inside the viewport at its left').toBeGreaterThanOrEqual(0);
        expect(percent!.x + percent!.w, 'and at its right').toBeLessThanOrEqual(w + 0.5);
        expect(percent!.y, 'and at its top').toBeGreaterThanOrEqual(0);
        expect(percent!.y + percent!.h, 'and at its bottom').toBeLessThanOrEqual(h + 0.5);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'nothing scrolls sideways').toBe(true);
      });
    }, 180_000);
  }
});

describe('screen pages, on the real 1.2.0 release (XR2.3)', () => {
  it('screen pages: ArrowRight, a right tap and a swipe each turn forward and the progress rises', async () => {
    const app = await open({ view: DESK, touch: true });
    await using(app, async () => {
      const page = app.page;
      await enter(page);
      const frame = await focusFrame(page);
      expect(await frame.evaluate(() => document.querySelector('[data-docreader-root]')?.getAttribute('data-reading')), 'Pages is the default turn').toBe('screens');
      const h = await frameHeight(frame);
      const { w } = await sizeOf(page);
      const readings: Array<{ by: string; top: number; share: number }> = [{ by: 'start', top: await scrollTopOf(frame), share: await shareOf(frame) }];
      const turn = async (by: string, act: () => Promise<void>): Promise<void> => {
        const before = readings.at(-1)!;
        await act();
        await becomes(async () => (await scrollTopOf(frame)) > before.top, true, `the frame's scroll after ${by}`, page);
        await page.waitForTimeout(300);
        readings.push({ by, top: await scrollTopOf(frame), share: await shareOf(frame) });
      };
      await turn('ArrowRight', () => page.keyboard.press('ArrowRight'));
      await turn('right tap', () => page.mouse.click(w - 40, 400));
      await turn('swipe', async () => {
        const cdp = await page.context().newCDPSession(page);
        try {
          const at = (x: number, y: number) => [{ x, y, id: 1 }];
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(900, 400) });
          for (const x of [860, 800, 740, 700]) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(x, 402) });
          }
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } finally {
          await cdp.detach();
        }
      });
      // The overlay's own percentage, shown once the reading is done.
      await page.waitForTimeout(700);
      await showOverlay(page);
      const percent = await page.locator('.docs-reading-percent').textContent();
      console.log(`XRB-FIGURE pages ${JSON.stringify({ h, readings, percent })}`);
      for (let i = 1; i < readings.length; i += 1) {
        const step = readings[i]!.top - readings[i - 1]!.top;
        expect(step, `${readings[i]!.by}: one turn moves about a screen (${step} px of ${h})`).toBeGreaterThanOrEqual(h / 3 - 2);
        // A turn lands the next block's top at the top of the view, so it may pass a screen by the gap between two blocks.
        expect(step, `${readings[i]!.by}: and no more than about a screen`).toBeLessThanOrEqual(h * 1.25);
        expect(readings[i]!.share, `${readings[i]!.by}: the frame's progress rose`).toBeGreaterThan(readings[i - 1]!.share);
      }
      const shown = Number.parseInt(percent ?? '', 10);
      expect(shown, `the overlay's percentage rose above 0 (${percent})`).toBeGreaterThan(0);
      expect(Math.abs(shown - readings.at(-1)!.share * 100), 'and it follows the frame\'s own share').toBeLessThanOrEqual(6);
    });
  }, 240_000);

  /** Taps an in-document link in Pages and reads where the frame is while it settles: the target is reached, and it is not a turn
   *  on top (the library's tap on a link never turns). `by` is the finger or the mouse. */
  async function linkTap(by: 'touch' | 'mouse'): Promise<void> {
    const app = await open({ view: DESK, touch: by === 'touch' });
    await using(app, async () => {
      const page = app.page;
      await enter(page);
      const frame = await frameOf(page);
      const h = await frameHeight(frame);
      const top0 = await scrollTopOf(frame);
      const link = await frame.getByRole('link', { name: 'part 20', exact: true }).first().boundingBox();
      if (link === null) throw new Error('the in-document link has no box');
      expect(link.y, 'the link is in the first screen, so tapping it scrolls nothing by itself').toBeLessThan(h);
      const x = link.x + link.width / 2;
      const y = link.y + link.height / 2;
      if (by === 'touch') await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
      const at = (): Promise<{ top: number; scroll: number }> => frame.evaluate(() => ({
        top: document.getElementById('part-20')!.getBoundingClientRect().top, scroll: Math.round(document.scrollingElement!.scrollTop),
      }));
      await becomes(async () => { const r = await at(); return r.top >= -1 && r.top < 300; }, true, 'the fragment\'s target at the top of the frame', page);
      const reached = await at();
      // The place the link took the frame to holds: the frame is read again once the jump has settled.
      await page.waitForTimeout(800);
      const later = await at();
      console.log(`XRB-FIGURE link-tap ${by} ${JSON.stringify({ h, top0, reached, later })}`);
      expect(reached.scroll, 'the link took the frame away from the top').toBeGreaterThan(top0 + h);
      expect(reached.top, 'the target is where a link puts it (not a screen further: no turn on top)').toBeGreaterThanOrEqual(-1);
      expect(reached.top, 'and in the upper part of the view').toBeLessThan(h / 3);
      expect(later.scroll, 'and the frame stays at the target once the jump has settled').toBe(reached.scroll);
    });
  }

  it('screen pages: a link tap opens the link, not a turn', () => linkTap('touch'), 180_000);

  // Known failure, not ccrc's (under the library's report): with a mouse, in real full screen, in Pages, the library's in-document jump scrolls back to where it was about 170 to 200 ms later, and this row reds the day the library is fixed.
  it.fails('screen pages: a link tap opens the link, not a turn (a mouse, no touch screen)', () => linkTap('mouse'), 180_000);

  it('screen pages: a resize keeps the place and lands on a whole line', async () => {
    const app = await open({ view: DESK });
    await using(app, async () => {
      const page = app.page;
      await enter(page);
      const frame = await focusFrame(page);
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(400);
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(400);
      /** The first line of the document's own text that shows (text of the library's chrome is left out), its text, its top, and
       *  whether the line is whole. A line has shown when a quarter of its box is in the view: a text box's last few pixels are
       *  the line's leading, a line already read, never one on screen. It is whole when all of it is in the view; one between the
       *  two is cut by the top edge. */
      const firstLine = (): Promise<{ text: string; top: number; whole: boolean; scroll: number; height: number }> => frame.evaluate(() => {
        const scroll = Math.round(document.scrollingElement!.scrollTop);
        const height = document.scrollingElement!.scrollHeight;
        const walker = document.createTreeWalker(document.querySelector('[data-docreader-root]')!, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
          const el = n.parentElement;
          if (el === null || el.closest('[data-docreader-chrome]') !== null || (n.textContent ?? '').trim() === '') continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          for (const rect of range.getClientRects()) {
            if (rect.height <= 0) continue;
            const shown = (rect.bottom - Math.max(rect.top, 0)) / rect.height;
            if (shown > 0.25) return { text: (n.textContent ?? '').trim(), top: rect.top, whole: shown >= 0.99, scroll, height };
          }
        }
        return { text: '', top: Number.NaN, whole: false, scroll, height };
      });
      /** Waits until the first line holds still, and answers it. */
      const settled = async (): Promise<Awaited<ReturnType<typeof firstLine>>> => {
        let last = await firstLine();
        let same = 0;
        for (let i = 0; i < 60 && same < 4; i += 1) {
          await page.waitForTimeout(150);
          const now = await firstLine();
          same = JSON.stringify(now) === JSON.stringify(last) ? same + 1 : 0;
          last = now;
        }
        return last;
      };
      const wide = await settled();
      /** Where the line the reader was on, by its text, sits in the view now (its top), or NaN when it is nowhere. */
      const topOfText = (text: string): Promise<number> => frame.evaluate((t) => {
        const walker = document.createTreeWalker(document.querySelector('[data-docreader-root]')!, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
          if ((n.textContent ?? '').trim() !== t || n.parentElement?.closest('[data-docreader-chrome]') != null) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          return range.getBoundingClientRect().top;
        }
        return Number.NaN;
      }, text);
      const lines = [{ at: '1280 by 800', ...wide, kept: wide.top }];
      for (const width of [900, 412, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        await page.waitForFunction((x) => window.innerWidth === x, width, { timeout: 10_000 });
        const line = await settled();
        lines.push({ at: `${width} by 800`, ...line, kept: await topOfText(wide.text) });
      }
      console.log(`XRB-FIGURE resize ${JSON.stringify(lines)}`);
      expect(await modeOf(page).then((m) => m.attr), 'reader mode is still on after the resizes').not.toBeNull();
      expect(wide.scroll, 'the reader had turned away from the top').toBeGreaterThan(300);
      // CONTROL: the layout really moved at the narrower widths (the document is a different height, and the place sits at another
      // offset), so the row cannot pass by nothing having re-laid out, with no place kept.
      for (const l of lines.filter((x) => !x.at.startsWith('1280'))) {
        expect(l.height, `${l.at}: the document laid out at another height (${l.height} against ${wide.height})`).not.toBe(wide.height);
        expect(l.scroll, `${l.at}: and the place is at another offset (${l.scroll} against ${wide.scroll})`).not.toBe(wide.scroll);
      }
      for (const l of lines) {
        // The place is kept: the line the reader was on is still at the top of the view (within a heading and a line of it: the
        // library shows whole the line the top edge cut, which may be the heading above), never somewhere the old scroll offset left it.
        expect(l.kept, `${l.at}: the line the reader was on is at the top of the view (its top ${l.kept})`).toBeGreaterThanOrEqual(-1);
        expect(l.kept, `${l.at}: and not further down than a heading and a line (its top ${l.kept})`).toBeLessThanOrEqual(120);
        expect(l.whole, `${l.at}: the first line shown is whole (top ${l.top})`).toBe(true);
      }
    });
  }, 240_000);

  it('scroll: a tap below the band turns nothing', async () => {
    const app = await open({ view: DESK });
    await using(app, async () => {
      const page = app.page;
      await enter(page);
      await showOverlay(page);
      await page.getByRole('radio', { name: READER_MODE_TEXT.turnScroll, exact: true }).click();
      await becomes(() => page.evaluate((k) => localStorage.getItem(k), READER_TURN_STORAGE_KEY), 'scroll', 'the remembered turn', page);
      const frame = await frameOf(page);
      await frame.waitForFunction(() => document.querySelector('[data-docreader-root]')?.getAttribute('data-reading') === 'scroll', undefined, { timeout: 10_000 });
      // Hide the overlay (its layer would take the tap), then tap below the band.
      await page.mouse.click(640, 400);
      await becomes(() => overlayShown(page), false, 'the overlay after a tap on its layer', page);
      const { w } = await sizeOf(page);
      // Each tap is read on its own, so a turn by one tap cannot be undone by the other.
      const top0 = await scrollTopOf(frame);
      await page.mouse.click(w - 40, 400);
      await page.waitForTimeout(700);
      const afterRight = await scrollTopOf(frame);
      // Down by about a screen by the frame's own scroll, so a back turn has somewhere to go.
      await frame.evaluate(() => { window.scrollTo(0, window.innerHeight); });
      await page.waitForTimeout(400);
      const moved = await scrollTopOf(frame);
      await page.mouse.click(60, 400);
      await page.waitForTimeout(700);
      const afterLeft = await scrollTopOf(frame);
      console.log(`XRB-FIGURE scroll-tap ${JSON.stringify({ top0, afterRight, moved, afterLeft })}`);
      expect(afterRight, 'a right tap below the band changed no scroll position').toBe(top0);
      expect(moved, 'CONTROL: the frame was moved down by about a screen').toBeGreaterThan(top0 + 700);
      expect(afterLeft, 'a left tap, with a screen above to turn back to, changed no scroll position').toBe(moved);
      // The same taps do turn in Pages (the control): switch back, tap right, then left.
      await showOverlay(page);
      await page.getByRole('radio', { name: READER_MODE_TEXT.turnScreens, exact: true }).click();
      await frame.waitForFunction(() => document.querySelector('[data-docreader-root]')?.getAttribute('data-reading') === 'screens', undefined, { timeout: 10_000 });
      await page.mouse.click(640, 400);
      await becomes(() => overlayShown(page), false, 'the overlay after a second tap on its layer', page);
      await page.mouse.click(w - 40, 400);
      await becomes(async () => (await scrollTopOf(frame)) > afterLeft + 300, true, 'the right tap in Pages', page);
      await page.waitForTimeout(400);
      const turned = await scrollTopOf(frame);
      await page.mouse.click(60, 400);
      await becomes(async () => (await scrollTopOf(frame)) < turned - 300, true, 'the left tap in Pages', page);
    });
  }, 240_000);

  it('size: Aa\'s text size applies in reader mode and after it', async () => {
    const app = await open({ view: DESK });
    await using(app, async () => {
      const page = app.page;
      await enter(page);
      const frame = await frameOf(page);
      const sizeNow = (): Promise<number> => frame.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-docreader-root] p')!).fontSize));
      const before = await sizeNow();
      await showOverlay(page);
      await page.locator('.docs-reading-aa').click();
      // The overlay and its layer are gone, and the frame's settings menu is open.
      await becomes(() => overlayShown(page), false, 'the overlay after Aa', page);
      await frame.waitForFunction(() => { const m = document.querySelector('.aa-menu'); return m !== null && !m.hasAttribute('hidden'); }, undefined, { timeout: 10_000 });
      await frame.locator('.aa-menu input[data-pref="size"][value="xl"]').check();
      await becomes(async () => (await sizeNow()) > before, true, 'the body text size after choosing XL', page);
      const inReader = await sizeNow();
      // Close the menu by a tap in the frame outside it (Esc is the browser's in real full screen, spec 5.4, so it is not used here;
      // a tap with a menu open is the menu's outside press and turns nothing), then leave reader mode by the overlay's Exit.
      const top = await scrollTopOf(frame);
      await page.mouse.click(60, 600);
      await frame.waitForFunction(() => document.querySelector('.aa-menu')?.hasAttribute('hidden') === true, undefined, { timeout: 10_000 });
      expect(await modeOf(page).then((m) => m.attr), 'the tap closed the menu and left reader mode on').not.toBeNull();
      expect(await scrollTopOf(frame), 'and it turned no page').toBe(top);
      await showOverlay(page);
      await page.locator('.docs-reading-exit').click();
      await page.waitForFunction(() => document.querySelector('.docs-reading')?.hasAttribute('data-reader-mode') === false, undefined, { timeout: 15_000 });
      const frameAfter = await frameOf(page);
      const after = await frameAfter.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-docreader-root] p')!).fontSize));
      console.log(`XRB-FIGURE size ${JSON.stringify({ before, inReader, after })}`);
      expect(inReader, 'XL is larger than the default').toBeGreaterThan(before);
      expect(inReader, 'XL is 22 px').toBe(22);
      expect(after, 'the size holds after leaving reader mode').toBe(inReader);
    });
  }, 240_000);
});
