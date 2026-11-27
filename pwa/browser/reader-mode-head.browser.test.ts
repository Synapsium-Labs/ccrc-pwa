// Reader mode's entry from the Docs head, measured in a real Chrome over the production build (native Docs reader, reader-mode plan
// Task XR1.5, spec 2026-11-20 section 3.1). A tap on the desk head's Reader mode puts the reading container in full screen with
// the frame's document not reloaded, and Back leaves reader mode with the document still shown.
//
// The head's own rows (the one bar's budgets at 412 x 915, 915 x 412 and 360 x 800, and the desk row's one line and 80 px at
// 1280 x 800, 1440 x 900 and 1920 x 1080) are `browser/docs-compact-head.browser.test.ts`'s, which holds the head's harness and
// its budgets (`browser/docsHeadBudgets.ts`). This file keeps the case that needs a real full-screen request, with a small
// harness of its own: the production build served from loopback, `/api/docs` answering one leaf from fixtures, the leaf opened
// inside the console and the reader waited for.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config
// vitest.browser.config.ts browser/reader-mode-head.browser.test.ts )`, through `ccrc test`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import { DOCS_RESPONSE_HEADERS } from '../../shared/docs';
import { READER_FALLBACK_NOTE } from '../src/docs/reader/readerText';
import { READER_MODE_TEXT } from '../src/docs/reader/readerModeWords';
import { COMMIT_A, entry, treeOk, treeResponse } from '../test/docsFixtures';
import { openApp, serveDist, sharedDist, type DistServer, type OpenedApp } from './app';
import { resolveChrome } from './harness';

const PROJECT = 'demo';
const SECTION = 'specs';
const NAME = '2026-10-20-path-identity-design.md';
const TITLE = 'Path identity design';
const BLOB = 'c'.repeat(40);
const DOC = `# ${TITLE}\n\nA path names one document at one ref, so a link means the same thing on every checkout.\n\n`
  + Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1} of the body, long enough to wrap on a phone's width.`).join('\n\n')
  + '\n';
const SIZE = Buffer.byteLength(DOC, 'utf8');

let server: DistServer | undefined;
let browser: Browser | undefined;

beforeAll(async () => {
  const executablePath = resolveChrome(); // throws on a box with no Chrome: red, never skipped
  server = await serveDist(sharedDist());
  browser = await chromium.launch({ executablePath, headless: true });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

const JSON_TYPE = 'application/json; charset=utf-8';

/** A tree holding one committed leaf. */
const TREE = treeOk({ entries: [entry(SECTION, NAME, { committed: { kind: 'file', blob: BLOB, size: SIZE } })] });

/** `/api/docs/demo/tree` answers `TREE` and the file the leaf's Markdown; any other `/api/docs` request answers 204. */
async function answerDocs(app: OpenedApp): Promise<void> {
  await app.ctx.route((u) => u.pathname.startsWith('/api/docs/'), async (route) => {
    const req = route.request();
    if (req.method() !== 'GET') {
      await route.fulfill({ status: 204 });
      return;
    }
    const headers = { ...DOCS_RESPONSE_HEADERS, 'content-type': JSON_TYPE };
    if (new URL(req.url()).pathname.endsWith('/tree')) {
      await route.fulfill({ status: 200, headers, body: Buffer.from(JSON.stringify(treeResponse(TREE)), 'utf8') });
      return;
    }
    const show = {
      v: 1, verb: 'docs-show', ok: true, elapsedMs: 3, source: 'committed', section: SECTION, path: NAME, size: SIZE,
      sha256: BLOB.padEnd(64, '0'), encoding: 'utf8', text: DOC, commit: COMMIT_A, blob: BLOB, onRef: 'contains',
    };
    await route.fulfill({ status: 200, headers, body: Buffer.from(JSON.stringify({ ok: true, contentClass: 'markdown', from: 'ccd', show }), 'utf8') });
  });
}

interface View { readonly width: number; readonly height: number; readonly skin: string }

/** A context at `view`, a mouse, with the leaf open inside the console and the reader up. One re-open on a fallback (the reader's
 *  start watchdog can pass on a loaded runner, D-7958); anything else that is not ready throws: the figure is about the reader page. */
async function openLeaf(view: View): Promise<OpenedApp> {
  const app = await openApp(browser!, {
    width: Math.max(view.width, 900), skin: view.skin, theme: 'light', tab: 'console' as const,
  }, { api: {}, fleetFrames: [] });
  await app.page.setViewportSize({ width: view.width, height: view.height });
  await answerDocs(app);
  const url = `${server!.origin}/docs/${PROJECT}/${SECTION}/${NAME}`;
  const start = async (): Promise<unknown> => {
    await app.page.goto(url, { waitUntil: 'load' });
    const up = await app.page.waitForFunction((note) => {
      if ([...document.querySelectorAll('.doc-plain-note')].some((n) => n.textContent === note)) return 'fallback';
      return document.querySelector('.docs-reader iframe') !== null && document.querySelector('.doc-formatting') === null ? 'ready' : null;
    }, READER_FALLBACK_NOTE, { timeout: 90_000, polling: 100 });
    return up.jsonValue();
  };
  let outcome = await start();
  if (outcome === 'fallback') outcome = await start();
  if (outcome !== 'ready') throw new Error(`the reader did not come up: ${String(outcome)}`);
  return app;
}

/** Opens the leaf at `view`, runs `check`, asks that the page threw nothing, and closes the context whatever happens. */
async function at(view: View, check: (app: OpenedApp) => Promise<void>): Promise<void> {
  const app = await openLeaf(view);
  try {
    await check(app);
    expect(app.errors, 'no page error').toEqual([]);
  } finally {
    await app.ctx.close();
  }
}

describe('Reader mode from the desk head (X6 XR1.5)', () => {
  it.each([INSTRUMENT, REFINED])('%s: reader mode: the button enters, and the container goes full screen with the frame not reloaded', async (skin) => {
    await at({ width: 1280, height: 800, skin }, async ({ page }) => {
      await page.waitForSelector('.docs-head.docs-full .docs-actions .docs-reader-mode', { timeout: 30_000 });
      // Mark the frame's element and count its `load` events from here on: a remount or a reload would show.
      await page.evaluate(() => {
        const frame = document.querySelector<HTMLIFrameElement>('.docs-reader iframe')!;
        const mark = window as unknown as { __frame: Element; __loads: number };
        mark.__frame = frame;
        mark.__loads = 0;
        frame.addEventListener('load', () => { mark.__loads += 1; });
      });
      await page.getByRole('button', { name: READER_MODE_TEXT.enter }).click();
      await page.waitForFunction(() => document.fullscreenElement?.classList.contains('docs-reading') === true, undefined, { timeout: 15_000 });
      const on = await page.evaluate(() => {
        const mark = window as unknown as { __frame: Element; __loads: number };
        return {
          attr: document.querySelector('.docs-reading')?.getAttribute('data-reader-mode') ?? null,
          sameFrame: document.querySelector('.docs-reader iframe') === mark.__frame && mark.__frame.isConnected,
          loads: mark.__loads,
          fullscreen: document.fullscreenElement?.className ?? null,
        };
      });
      console.log(`XR15-FIGURE ${skin} 1280x800 enter ${JSON.stringify(on)}`);
      expect(on.fullscreen, 'the reading container is the full-screen element').toContain('docs-reading');
      expect(on.attr, 'reader mode is drawn').not.toBeNull();
      expect(on.sameFrame, 'the frame is the same element').toBe(true);
      expect(on.loads, 'the frame was not reloaded').toBe(0);
      // Leave by the browser's Back (the overlay is not part of this task): reader mode off, the document still shown.
      await page.evaluate(() => history.back());
      await page.waitForFunction(() => document.fullscreenElement === null && document.querySelector('.docs-reading')?.hasAttribute('data-reader-mode') === false,
        undefined, { timeout: 15_000 });
      const off = await page.evaluate(() => {
        const mark = window as unknown as { __frame: Element; __loads: number };
        return {
          sameFrame: document.querySelector('.docs-reader iframe') === mark.__frame && mark.__frame.isConnected,
          loads: mark.__loads, path: location.pathname,
        };
      });
      expect(off.path, 'still on the document').toContain(NAME);
      expect(off.sameFrame, 'the document is still shown, in the same frame').toBe(true);
      expect(off.loads, 'still not reloaded').toBe(0);
      expect(await page.getByRole('button', { name: READER_MODE_TEXT.enter }).isVisible(), 'the entry is back').toBe(true);
    });
  }, 180_000);
});
