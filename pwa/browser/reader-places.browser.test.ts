// Back places in the production reader (X2 Task P5.3; the parity spec's section 4.7, D-8763), driven in a real Chrome
// through Playwright over the run's one build (`sharedDist`, `serveDist`). jsdom has no srcdoc frame and no user
// activation, so lab E16 and the rows that need the frame's own Back are measured here.
//
// Lab E16 (P5.3 Step 0): does a tap in the reader frame give the console the user activation Chromium needs before it
// counts an entry `pushState` made as one Back stops at? The places are pushed in answer to a port message, so they
// rely on that. Firefox cannot run on this box; its row is the device stage's.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Frame, type Page } from 'playwright-core';
import { SKINS } from '@ccrc/ui';
import { DOC_SECTION_SLUGS, DOCS_RESPONSE_HEADERS } from '../../shared/docs';
import { COMMIT_A, entry, treeOk, treeResponse } from '../test/docsFixtures';
import { openApp, serveDist, sharedDist, type DistServer, type OpenedApp } from './app';
import { resolveChrome } from './harness';

const SECTION = DOC_SECTION_SLUGS[0]!;
const BLOB = 'b'.repeat(40);
/** A figure to open full screen, and enough headings to jump between. */
const DOC = '# Places\n\nA short document with a figure.\n\n```mermaid\nflowchart LR\n  A[Start] --> B[End]\n```\n\n'
  + Array.from({ length: 40 }, (_, i) => `## Part ${i}\n\nA paragraph of the document. See [part ${(i + 20) % 40}](#part-${(i + 20) % 40}).\n\n`).join('');

let browser: Browser;
let server: DistServer;
beforeAll(async () => {
  const dist = sharedDist();
  server = await serveDist(dist);
  browser = await chromium.launch({ executablePath: resolveChrome(), headless: true });
}, 180_000);
afterAll(async () => { await browser?.close(); await server?.close(); });

/** Serves every doc under the section with `text`, and opens `name` in the console. */
async function open(name: string, text = DOC, others: readonly string[] = []): Promise<OpenedApp> {
  const size = Buffer.byteLength(text);
  const tree = treeOk({ entries: [name, ...others].map((n) => entry(SECTION, n, { committed: { kind: 'file', blob: BLOB, size } })) });
  const app = await openApp(browser, { width: 1280, skin: SKINS[0]!.id, theme: 'light', tab: 'console' }, { api: {}, fleetFrames: [] });
  await app.ctx.route((u) => u.pathname.startsWith('/api/docs/'), async (route) => {
    if (route.request().method() !== 'GET') { await route.fulfill({ status: 204 }); return; }
    const pathname = new URL(route.request().url()).pathname;
    const path = decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1));
    const payload = pathname.endsWith('/tree') ? treeResponse(tree) : {
      ok: true, contentClass: 'markdown', from: 'ccd', show: {
        v: 1, verb: 'docs-show', ok: true, elapsedMs: 3, source: 'committed', section: SECTION, path,
        size, sha256: BLOB.padEnd(64, '0'), encoding: 'utf8', text, commit: COMMIT_A, blob: BLOB, onRef: 'contains',
      },
    };
    await route.fulfill({ status: 200, headers: { ...DOCS_RESPONSE_HEADERS, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(payload) });
  });
  await app.page.goto(`${server.origin}/docs/demo/${SECTION}/${name}`, { waitUntil: 'domcontentloaded' });
  await ready(app.page);
  return app;
}

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelector('.docs-reader iframe') !== null && document.querySelector('.doc-formatting') === null,
    undefined, { timeout: 90_000 });
}

async function frameOf(page: Page): Promise<Frame> {
  const frame = await (await page.locator('.docs-reader iframe').elementHandle())?.contentFrame();
  if (!frame) throw new Error('reader frame absent');
  return frame;
}

/** Evaluates `expression` in the console's page with NO user gesture. Playwright's own `evaluate` runs with one, so a
 *  read through it would activate the page it reads (measured 2026-11-26: every such read answered `isActive` true). */
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

/** The console's transient user activation, read with no gesture. */
const activeNow = (page: Page): Promise<boolean> => quietEval<boolean>(page, 'navigator.userActivation.isActive');

/** Waits, reading with no gesture, until the console's transient activation has lapsed. */
async function lapse(page: Page): Promise<void> {
  const until = Date.now() + 15_000;
  while (await activeNow(page)) {
    if (Date.now() > until) throw new Error('the console\'s activation never lapsed');
    await page.waitForTimeout(200);
  }
}

describe('lab E16 (P5.3 Step 0): a tap in the frame and the console\'s activation, desktop Chromium', () => {
  it('E16: with no tap the console\'s activation lapses and stays lapsed, and a raw tap in the frame activates the console', async () => {
    const app = await open('places.md');
    try {
      const page = app.page;
      const frame = await frameOf(page);
      const text = frame.getByText('A short document with a figure.');
      // The tap's point, in the page's coordinates, taken before the baseline: Playwright's locator calls run their own
      // checks in the frame with a gesture, which would activate the frame and so the console.
      const box = await text.boundingBox();
      if (box === null) throw new Error('the text has no box');
      // The harness's navigation leaves the console activated for a few seconds; the baseline is that activation lapsed.
      await lapse(page);
      await page.waitForTimeout(1500);
      const before = await activeNow(page);
      // Why the tap below is raw: Playwright's checks for a click, with no click (`trial`), run in the frame with a gesture
      // and activate the console by themselves (measured 2026-11-26: `afterChecks` true), so a locator click's reading
      // would not tell the tap apart from them. Logged, not asserted: it is the harness's behaviour, not the console's.
      await text.click({ trial: true });
      const afterChecks = await activeNow(page);
      await lapse(page);
      await page.waitForTimeout(1500);
      const beforeTap = await activeNow(page);
      // The browser's own Back (its toolbar button or Alt+Left) is the one Chromium's skip applies to, and headless
      // Chromium has neither: measured on 2026-11-26, Alt+Left left the page on the entry pushed last. So this lab reads
      // the console's transient activation, the stand-in for what the skip reads; the device stage measures the skip.
      // A raw tap: only the input events, through the browser, as a finger's are, on the text inside the frame.
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      const afterTap = await activeNow(page);
      // A sanity check of the push and the pop, with no gesture of the console's own. Script's `history.back()` steps one
      // entry whatever the activation, so this proves no skip rule.
      const url = page.url();
      const length = await quietEval<number>(page, 'history.length');
      await quietEval(page, 'history.pushState({ ...(history.state ?? {}), e16: 1 }, "", location.href)');
      const pushed = await quietEval<number>(page, 'history.length');
      await quietEval(page, 'new Promise((r) => { addEventListener("popstate", () => r(null), { once: true }); history.back(); })');
      const back = await quietEval<{ e16: number | null; href: string }>(page, '({ e16: history.state?.e16 ?? null, href: location.href })');
      console.log(`E16-FIGURES ${JSON.stringify({ before, afterChecks, beforeTap, afterTap, length, pushed, e16: back.e16 })}`);
      expect(before, 'no transient activation 1.5 s after it lapsed, with no tap').toBe(false);
      expect(beforeTap, 'and none again, 1.5 s after the checks\' activation lapsed, just before the tap').toBe(false);
      expect(afterTap, 'the raw tap in the frame activates the console (an ancestor of the frame)').toBe(true);
      expect(pushed, 'the push added one entry').toBe(length + 1);
      expect(back.e16, 'script\'s Back left the pushed entry').toBeNull();
      expect(back.href, 'and stayed on the doc').toBe(url);
      expect(app.errors, 'no uncaught error').toEqual([]);
    } finally {
      await app.ctx.close();
    }
  }, 120_000);
});
