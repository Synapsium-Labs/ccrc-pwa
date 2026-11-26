// Reader mode's measurements before any code (X6 Task XR1.1 Step 0; the reader-mode spec's section 4.5), driven in a real
// Chrome through Playwright over the run's one build (`sharedDist`, `serveDist`). The production Docs page mounts a ready
// reader frame; the rows put a wrapper around its host full screen from the console's own window, as reader mode's
// reading container will, and read what the sandboxed frame can and cannot do from inside it:
//   M-3  inside the frame, `document.fullscreenEnabled` is false and `requestFullscreen` rejects (no `allowfullscreen`,
//        no `allow`: the sandbox is exactly `allow-scripts`);
//   M-4  with the wrapper full screen and the frame focused, `?` opens the library's keys sheet (keys reach the frame);
//   M-7  (the frame's half) inside the frame, `navigator.wakeLock` is absent or its request is refused.
// M-1's refusal without activation and M-5's Esc are the device item's (FS-8, FS-5): Playwright evaluates with a gesture,
// and headless Chrome owns no Esc. Each row logs one `M-<n>` line for the plan's Results, then asserts it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Frame, type Page } from 'playwright-core';
import { SKINS } from '@ccrc/ui';
import { DOC_SECTION_SLUGS, DOCS_RESPONSE_HEADERS } from '../../shared/docs';
import { COMMIT_A, entry, treeOk, treeResponse } from '../test/docsFixtures';
import { openApp, serveDist, sharedDist, type DistServer, type OpenedApp } from './app';
import { resolveChrome } from './harness';

const SECTION = DOC_SECTION_SLUGS[0]!;
const BLOB = 'b'.repeat(40);
const DOC = '# Lab\n\nA document to read in reader mode.\n\n'
  + Array.from({ length: 30 }, (_, i) => `## Part ${i}\n\nA paragraph of the document, long enough to wrap on a phone.\n\n`).join('');

let browser: Browser;
let server: DistServer;
beforeAll(async () => {
  const dist = sharedDist();
  server = await serveDist(dist);
  browser = await chromium.launch({ executablePath: resolveChrome(), headless: true });
}, 180_000);
afterAll(async () => { await browser?.close(); await server?.close(); });

/** Serves every doc under the section with `DOC`, and opens `name` in the console at `width`. */
async function open(name: string, width: number): Promise<OpenedApp> {
  const size = Buffer.byteLength(DOC);
  const tree = treeOk({ entries: [entry(SECTION, name, { committed: { kind: 'file', blob: BLOB, size } })] });
  const app = await openApp(browser, { width, skin: SKINS[0]!.id, theme: 'light', tab: 'console' }, { api: {}, fleetFrames: [] });
  await app.ctx.route((u) => u.pathname.startsWith('/api/docs/'), async (route) => {
    if (route.request().method() !== 'GET') { await route.fulfill({ status: 204 }); return; }
    const pathname = new URL(route.request().url()).pathname;
    const path = decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1));
    const payload = pathname.endsWith('/tree') ? treeResponse(tree) : {
      ok: true, contentClass: 'markdown', from: 'ccd', show: {
        v: 1, verb: 'docs-show', ok: true, elapsedMs: 3, source: 'committed', section: SECTION, path,
        size, sha256: BLOB.padEnd(64, '0'), encoding: 'utf8', text: DOC, commit: COMMIT_A, blob: BLOB, onRef: 'contains',
      },
    };
    await route.fulfill({ status: 200, headers: { ...DOCS_RESPONSE_HEADERS, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(payload) });
  });
  await app.page.goto(`${server.origin}/docs/demo/${SECTION}/${name}`, { waitUntil: 'domcontentloaded' });
  await app.page.waitForFunction(() => document.querySelector('.docs-reader iframe') !== null && document.querySelector('.doc-formatting') === null,
    undefined, { timeout: 90_000 });
  return app;
}

async function frameOf(page: Page): Promise<Frame> {
  const frame = await (await page.locator('.docs-reader iframe').elementHandle())?.contentFrame();
  if (!frame) throw new Error('reader frame absent');
  return frame;
}

/** Waits until the frame's document has its reader root (the library's enhance ran). */
async function frameReady(frame: Frame): Promise<void> {
  await frame.waitForFunction(() => document.querySelector('[data-docreader-root]') !== null, undefined, { timeout: 90_000 });
}

/** Puts the reader host's parent full screen from the console's window: the wrapper stands in for the reading container. */
async function wrapperFullScreen(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const host = document.querySelector('.docs-reader');
    const wrapper = host?.parentElement ?? null;
    if (wrapper === null) return 'no wrapper';
    try {
      await wrapper.requestFullscreen({ navigationUI: 'hide' });
    } catch (e) {
      return `refused: ${e instanceof Error ? e.name : typeof e}`;
    }
    return document.fullscreenElement === wrapper ? null : 'not the full-screen element';
  });
}

describe('reader mode Step 0 (XR1.1): what the sandboxed frame can do, desktop Chromium on the 1.2.0 release', () => {
  for (const width of [1280, 412]) {
    it(`M-3: inside the frame, fullscreenEnabled is false and requestFullscreen rejects, at ${width} wide`, async () => {
      const app = await open('lab.md', width);
      try {
        const frame = await frameOf(app.page);
        await frameReady(frame);
        const reading = await frame.evaluate(async () => {
          const enabled = document.fullscreenEnabled;
          let outcome: string;
          try {
            await document.documentElement.requestFullscreen();
            outcome = 'resolved';
          } catch (e) {
            outcome = `rejected ${e instanceof Error ? e.name : typeof e}`;
          }
          return { enabled, outcome, element: document.fullscreenElement === null ? null : 'set' };
        });
        const sandbox = await app.page.locator('.docs-reader iframe').getAttribute('sandbox');
        const allow = await app.page.locator('.docs-reader iframe').getAttribute('allow');
        const allowFullscreen = await app.page.locator('.docs-reader iframe').getAttribute('allowfullscreen');
        console.log(`M-3 ${JSON.stringify({ width, ...reading, sandbox, allow, allowFullscreen })}`);
        expect(sandbox, 'the frame\'s sandbox is exactly allow-scripts').toBe('allow-scripts');
        expect(allow, 'no allow attribute on the frame').toBeNull();
        expect(allowFullscreen, 'no allowfullscreen attribute on the frame').toBeNull();
        expect(reading.enabled, 'fullscreenEnabled inside the frame').toBe(false);
        expect(reading.outcome.startsWith('rejected'), `requestFullscreen inside the frame (${reading.outcome})`).toBe(true);
        expect(reading.element, 'no full-screen element inside the frame').toBeNull();
        expect(app.errors, 'no uncaught error').toEqual([]);
      } finally {
        await app.ctx.close();
      }
    }, 120_000);
  }

  it('M-4: with the wrapper full screen and the frame focused, ? opens the library\'s keys sheet', async () => {
    const app = await open('lab.md', 1280);
    try {
      const page = app.page;
      const frame = await frameOf(page);
      await frameReady(frame);
      // A headless page holds no system focus until it is brought to the front. The library's mount focused the iframe before
      // that (`focus`, step 8), so the iframe is already the console's active element while its document has no focus, and a
      // second `focus()` on an element already active is a no-op (measured 2026-11-26: the frame's `hasFocus()` stayed false
      // and no key reached it until the console's focus moved). So the row blurs the iframe first, then focuses it.
      await page.bringToFront();
      // The frame counts the keydowns that reach its document, so a red tells "no key arrived" from "the sheet did not open".
      await frame.evaluate(() => {
        const w = window as Window & { __labKeys?: string[] };
        w.__labKeys = [];
        document.addEventListener('keydown', (e) => { w.__labKeys!.push(e.key); }, true);
      });
      const refused = await wrapperFullScreen(page);
      // Focus the frame as reader mode does, by its element's own `focus()`, then send `?` through the browser's input.
      await page.evaluate(() => {
        const iframe = document.querySelector('.docs-reader iframe') as HTMLIFrameElement;
        if (document.activeElement === iframe) iframe.blur();
        iframe.focus();
      });
      const focused = await page.evaluate(() => document.activeElement === document.querySelector('.docs-reader iframe'));
      await frame.waitForFunction(() => document.hasFocus(), undefined, { timeout: 5_000 }).catch(() => undefined);
      const frameHasFocus = await frame.evaluate(() => document.hasFocus());
      await page.keyboard.press('?');
      const opened = await frame.waitForFunction(() => document.querySelector('.keys.open') !== null, undefined, { timeout: 10_000 })
        .then(() => true, () => false);
      const keys = await frame.evaluate(() => (window as Window & { __labKeys?: string[] }).__labKeys ?? []);
      const stillFull = await page.evaluate(() => document.fullscreenElement !== null);
      console.log(`M-4 ${JSON.stringify({ refused, focused, frameHasFocus, keys, opened, stillFull })}`);
      expect(refused, 'the wrapper goes full screen').toBeNull();
      expect(focused, 'the reader\'s iframe holds focus').toBe(true);
      expect(frameHasFocus, 'the frame\'s document has focus').toBe(true);
      expect(keys, 'the key reached the frame').toEqual(['?']);
      expect(opened, '? opened the library\'s keys sheet inside the frame').toBe(true);
      expect(stillFull, 'the wrapper is still full screen').toBe(true);
      expect(app.errors, 'no uncaught error').toEqual([]);
    } finally {
      await app.ctx.close();
    }
  }, 120_000);

  it('M-7 (the frame\'s half): inside the frame the wake lock is absent or refused, while the console\'s window has one', async () => {
    const app = await open('lab.md', 412);
    try {
      const page = app.page;
      const frame = await frameOf(page);
      await frameReady(frame);
      const inFrame = await frame.evaluate(async () => {
        const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } };
        if (nav.wakeLock === undefined) return 'absent';
        try {
          const s = await nav.wakeLock.request('screen');
          await s.release();
          return 'granted';
        } catch (e) {
          return `refused ${e instanceof Error ? e.name : typeof e}`;
        }
      });
      const inConsole = await page.evaluate(async () => {
        const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ type: string; release(): Promise<void> }> } };
        if (nav.wakeLock === undefined) return 'absent';
        try {
          const s = await nav.wakeLock.request('screen');
          const type = s.type;
          await s.release();
          return `granted ${type}`;
        } catch (e) {
          return `refused ${e instanceof Error ? e.name : typeof e}`;
        }
      });
      console.log(`M-7 ${JSON.stringify({ inFrame, inConsole })}`);
      expect(inFrame === 'absent' || inFrame.startsWith('refused'), `the frame's wake lock (${inFrame})`).toBe(true);
      expect(app.errors, 'no uncaught error').toEqual([]);
    } finally {
      await app.ctx.close();
    }
  }, 120_000);
});
