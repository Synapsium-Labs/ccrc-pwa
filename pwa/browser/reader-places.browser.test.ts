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
import { docsDrawFor, READER_E17_MERMAID } from '../src/docs/reader/policy';
import { COMMIT_A, entry, treeOk, treeResponse } from '../test/docsFixtures';
import { openApp, serveDist, sharedDist, type DistServer, type OpenedApp } from './app';
import { resolveChrome } from './harness';
// The library's own position token (`tokenOf` makes one from an anchor, `parseToken` reads one): its enhance entry does not
// export them, so this file imports the installed library file by its path.
import { parseToken, tokenOf } from '../node_modules/@synapsium-labs/pinax-lib/dist/enhance/nav.js';

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

/** Runs in every frame of the page and, in a sandboxed reader frame, keeps the frame's end of the port the console hands it with
 *  its hello (the `else` branch of `reader-frame.browser.test.ts`'s `hookScript`): a row can then speak on the port as the
 *  frame's own script would. The console's own window is left alone. */
const PORT_HOOK = `(() => {
  if (window.top === window) return;
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.t !== 'hello' || !e.ports || e.ports.length !== 1) return;
    window.__ccrcPort = e.ports[0];
  }, true);
})();`;

/** Serves every doc under the section with `text`, and opens `name` in the console. `hookPort` installs `PORT_HOOK` first. */
async function open(name: string, text = DOC, others: readonly string[] = [], hookPort = false, fragment = ''): Promise<OpenedApp> {
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
  if (hookPort) await app.ctx.addInitScript(PORT_HOOK);
  await app.page.goto(`${server.origin}/docs/demo/${SECTION}/${name}${fragment}`, { waitUntil: 'domcontentloaded' });
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
      const tapX = box.x + box.width / 2;
      const tapY = box.y + box.height / 2;
      // The tap must land on the reader's iframe (read with no gesture): a raw tap on anything else would prove nothing.
      const hit = await quietEval<string | null>(page, `document.elementFromPoint(${tapX}, ${tapY})?.tagName ?? null`);
      const hitInReader = await quietEval<boolean>(page, `document.elementFromPoint(${tapX}, ${tapY}) === document.querySelector('.docs-reader iframe')`);
      const everBefore = await quietEval<boolean>(page, 'navigator.userActivation.hasBeenActive');
      await page.mouse.click(tapX, tapY);
      const afterTap = await activeNow(page);
      const everAfter = await quietEval<boolean>(page, 'navigator.userActivation.hasBeenActive');
      // A sanity check of the push and the pop, with no gesture of the console's own. Script's `history.back()` steps one
      // entry whatever the activation, so this proves no skip rule.
      const url = page.url();
      const length = await quietEval<number>(page, 'history.length');
      await quietEval(page, 'history.pushState({ ...(history.state ?? {}), e16: 1 }, "", location.href)');
      const pushed = await quietEval<number>(page, 'history.length');
      await quietEval(page, 'new Promise((r) => { addEventListener("popstate", () => r(null), { once: true }); history.back(); })');
      const back = await quietEval<{ e16: number | null; href: string }>(page, '({ e16: history.state?.e16 ?? null, href: location.href })');
      console.log(`E16-FIGURES ${JSON.stringify({ before, afterChecks, beforeTap, afterTap, hit, everBefore, everAfter, length, pushed, e16: back.e16 })}`);
      expect(hitInReader, `the tap point is the reader's iframe (it is a ${hit})`).toBe(true);
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

// ---------------------------------------------------------------------------------------------------------------------
// The rows (P5.3 Step 1), on the built app. Back is `page.goBack()`; the console's state is read with `quietEval`.

interface PlaceState { readonly kind: string; readonly seq: number; readonly visit: string; readonly id?: string; readonly from?: string }
const placeOf = (page: Page): Promise<PlaceState | null> => quietEval<PlaceState | null>(page, 'history.state?.docsPlace ?? null');
const lengthOf = (page: Page): Promise<number> => quietEval<number>(page, 'history.length');

/** Polls `read` until it answers `want`, or fails with the last answer. */
async function becomes<T>(read: () => Promise<T>, want: T, what: string, page: Page): Promise<void> {
  const until = Date.now() + 15_000;
  let got = await read();
  while (JSON.stringify(got) !== JSON.stringify(want)) {
    if (Date.now() > until) throw new Error(`${what}: wanted ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    await page.waitForTimeout(100);
    got = await read();
  }
}

/** Draws the first figure when the reader draws on request, then opens it full screen through its "Full screen" button. */
async function openOverlay(page: Page): Promise<Frame> {
  const frame = await frameOf(page);
  const figure = frame.locator('figure.mermaid-figure').first();
  if (docsDrawFor(READER_E17_MERMAID) === 'on-request') await figure.locator('.fig-render-btn').click();
  await frame.waitForFunction(() => document.querySelector('figure.mermaid-figure')?.getAttribute('data-docreader-draw') === 'drawn',
    undefined, { timeout: 90_000 });
  await figure.getByRole('button', { name: 'Full screen' }).click();
  await frame.locator('.fig-overlay.open').waitFor({ timeout: 10_000 });
  return frame;
}
const overlayOpen = async (frame: Frame): Promise<boolean> => (await frame.locator('.fig-overlay.open').count()) > 0;

describe('P5.3 rows: Back places in the built app, desktop Chromium', () => {
  it('places: overlay Back closes it, and the page stays', async () => {
    const app = await open('places.md');
    try {
      const page = app.page;
      const url = page.url();
      const length = await lengthOf(page);
      const frame = await openOverlay(page);
      expect(await lengthOf(page), 'opening the overlay pushed one entry').toBe(length + 1);
      expect(await placeOf(page), 'tagged as the visit\'s first place, an overlay').toMatchObject({ kind: 'overlay', seq: 1 });
      expect(page.url(), 'the entry\'s URL is the doc\'s').toBe(url);
      await page.goBack();
      await becomes(() => overlayOpen(frame), false, 'the overlay after Back', page);
      expect(page.url(), 'the page stays').toBe(url);
      expect(await placeOf(page), 'on the base entry').toBeNull();
      expect(await frame.locator('figure.mermaid-figure').count(), 'in the same frame').toBeGreaterThan(0);
      expect(app.errors, 'no uncaught error').toEqual([]);
    } finally {
      await app.ctx.close();
    }
  }, 180_000);

  it('places: Esc then exactly one Back consumed', async () => {
    const app = await open('places.md');
    try {
      const page = app.page;
      const url = page.url();
      const frame = await openOverlay(page);
      expect(await placeOf(page)).toMatchObject({ kind: 'overlay' });
      await page.keyboard.press('Escape');
      await becomes(() => overlayOpen(frame), false, 'the overlay after Esc', page);
      // The console steps back by itself, onto the base entry: history.state is no longer the place's.
      await becomes(() => placeOf(page), null, 'the entry after the frame\'s own close', page);
      expect(page.url(), 'still on the doc').toBe(url);
      // The next Back is the user's own and leaves the doc.
      await page.goBack();
      await becomes(() => Promise.resolve(page.url() !== url), true, 'the page after one more Back', page);
      expect(app.errors, 'no uncaught error').toEqual([]);
    } finally {
      await app.ctx.close();
    }
  }, 180_000);

  it('places: a real jump\'s from token passes the parser', async () => {
    const app = await open('places.md');
    try {
      const page = app.page;
      const frame = await frameOf(page);
      const scrollY = (): Promise<number> => frame.evaluate(() => Math.round(document.scrollingElement?.scrollTop ?? window.scrollY));
      const y0 = await scrollY();
      const length = await lengthOf(page);
      // The body's own link (its text is lower case; the contents' entry for the same heading reads "Part 20", and is hidden).
      await frame.getByRole('link', { name: 'part 20', exact: true }).click();
      await becomes(() => lengthOf(page), length + 1, 'history after an in-document link', page);
      const place = await placeOf(page);
      expect(place, 'a jump place').toMatchObject({ kind: 'jump', seq: 1, id: 'part-20' });
      expect(typeof place?.from, 'with the library\'s position token').toBe('string');
      const anchor = parseToken(place?.from ?? null);
      expect(anchor, 'a token the library itself reads').not.toBeNull();
      expect(tokenOf(anchor), 'and the form its own tokenOf makes').toBe(place?.from);
      expect(await scrollY(), 'the frame went to the heading').toBeGreaterThan(y0 + 100);
      await page.goBack();
      await becomes(() => placeOf(page), null, 'the entry after Back', page);
      await becomes(() => scrollY().then((y) => Math.abs(y - y0) < 40), true, 'the frame\'s position after Back', page);
      expect(app.errors, 'no uncaught error').toEqual([]);
    } finally {
      await app.ctx.close();
    }
  }, 180_000);

  it('places: Back from a jump made at the top of the document returns to the top', async () => {
    const app = await open('places.md');
    try {
      const page = app.page;
      const frame = await frameOf(page);
      const scrollY = (): Promise<number> => frame.evaluate(() => Math.round(document.scrollingElement?.scrollTop ?? window.scrollY));
      const y0 = await scrollY();
      const length = await lengthOf(page);
      // No scrolling first: the reader is at the top when it jumps.
      await frame.getByRole('link', { name: 'part 20', exact: true }).click();
      await becomes(() => lengthOf(page), length + 1, 'history after an in-document link', page);
      const place = await placeOf(page);
      expect(place, 'a jump place').toMatchObject({ kind: 'jump', id: 'part-20' });
      // What the library answers for `from` at the top, logged: a token (the place had a block or a scroll offset) or none.
      console.log(`TOP-JUMP-FROM ${JSON.stringify({ y0, from: place?.from ?? null })}`);
      expect(await scrollY(), 'the frame went to the heading').toBeGreaterThan(y0 + 100);
      await page.goBack();
      await becomes(() => placeOf(page), null, 'the entry after Back', page);
      // With or without a `from`, Back returns the reader to where it was: the top.
      await becomes(() => scrollY().then((y) => Math.abs(y - y0) < 40), true, 'the frame\'s position after Back', page);
      expect(app.errors, 'no uncaught error').toEqual([]);
    } finally {
      await app.ctx.close();
    }
  }, 180_000);

  it('places: Back from a jump with no from sends the top token, and the library\'s restore ends at the top', async () => {
    const app = await open('places.md');
    try {
      const page = app.page;
      let frame = await frameOf(page);
      const scrollY = (): Promise<number> => frame.evaluate(() => Math.round(document.scrollingElement?.scrollTop ?? window.scrollY));
      const y0 = await scrollY();
      const length = await lengthOf(page);
      // Jump from the top, as the case above does.
      await frame.getByRole('link', { name: 'part 20', exact: true }).click();
      await becomes(() => lengthOf(page), length + 1, 'history after an in-document link', page);
      expect(await placeOf(page), 'a jump place').toMatchObject({ kind: 'jump', id: 'part-20' });
      await becomes(() => scrollY().then((y) => y > y0 + 100), true, 'the frame away from the top', page);
      // Chromium answers a `from` even at the top, so that case never reaches the library's `restore` on the top token. Force
      // the no-`from` path: the jump's place loses its `from` in the tab record and in the entry's state, which then agree.
      // The page keeps its own copy of the record once it has written one, and a pop reads that copy, not the store; so the
      // page is reloaded on the jump's entry after the rewrite (the reload continues the visit and reads the store).
      await quietEval(page, `(() => {
        const key = 'ccrc:docs:v1:places';
        const rec = JSON.parse(sessionStorage.getItem(key));
        for (const p of rec.places) if (p.kind === 'jump') delete p.from;
        sessionStorage.setItem(key, JSON.stringify(rec));
        const s = history.state;
        if (s && s.docsPlace) {
          const docsPlace = { ...s.docsPlace };
          delete docsPlace.from;
          history.replaceState({ ...s, docsPlace }, '', location.href);
        }
        return null;
      })()`);
      const fromsNow = (): Promise<{ record: boolean[]; state: boolean | null }> => quietEval(page, `(() => {
        const rec = JSON.parse(sessionStorage.getItem('ccrc:docs:v1:places'));
        return {
          record: rec.places.filter((p) => p.kind === 'jump').map((p) => 'from' in p),
          state: history.state?.docsPlace ? 'from' in history.state.docsPlace : null,
        };
      })()`);
      const assertNoFrom = async (when: string): Promise<void> => {
        const read = await fromsNow();
        expect(read.record.length, `${when}: the record holds the jump place`).toBeGreaterThan(0);
        expect(read.record.every((has) => !has), `${when}: the record's jump place has no from`).toBe(true);
        expect(read.state, `${when}: the entry's state agrees`).toBe(false);
      };
      await assertNoFrom('after the rewrite');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await ready(page);
      frame = await frameOf(page);
      expect(await placeOf(page), 'the reloaded entry still stands as the jump place').toMatchObject({ kind: 'jump', id: 'part-20' });
      await becomes(() => scrollY().then((y) => y > y0 + 100), true, 'the reloaded frame at the heading', page);
      await assertNoFrom('after the reload');
      await page.goBack();
      await becomes(() => placeOf(page), null, 'the entry after Back', page);
      // No `from`: the console sends the top token, and the library's own restore takes the frame to the top.
      await becomes(() => scrollY().then((y) => Math.abs(y - y0) < 40), true, 'the frame\'s position after Back', page);
      expect(app.errors, 'no uncaught error').toEqual([]);
    } finally {
      await app.ctx.close();
    }
  }, 180_000);

  it('places: a jump puts its id in the address, Back restores it, Forward returns', async () => {
    const app = await open('places.md');
    try {
      const page = app.page;
      const frame = await frameOf(page);
      const scrollY = (): Promise<number> => frame.evaluate(() => Math.round(document.scrollingElement?.scrollTop ?? window.scrollY));
      const y0 = await scrollY();
      const before = page.url();
      const base = before.split('#')[0]!;
      const length = await lengthOf(page);
      await frame.getByRole('link', { name: 'part 20', exact: true }).click();
      await becomes(() => lengthOf(page), length + 1, 'history after an in-document link', page);
      expect(page.url(), 'path and query unchanged, the fragment the id').toBe(`${base}#part-20`);
      const y1 = await scrollY();
      expect(y1).toBeGreaterThan(y0 + 100);
      await page.goBack();
      await becomes(() => placeOf(page), null, 'the entry after Back', page);
      expect(page.url(), 'Back restores the earlier address').toBe(before);
      await becomes(() => scrollY().then((y) => Math.abs(y - y0) < 40), true, 'the frame\'s position after Back', page);
      await page.goForward();
      await becomes(() => Promise.resolve(page.url()), `${base}#part-20`, 'the address after Forward', page);
      expect(await placeOf(page), 'the jump\'s place again').toMatchObject({ kind: 'jump', id: 'part-20' });
      await becomes(() => scrollY().then((y) => Math.abs(y - y1) < 40), true, 'the frame\'s position after Forward', page);
      expect(app.errors, 'no uncaught error').toEqual([]);
    } finally {
      await app.ctx.close();
    }
  }, 180_000);

  it('places: a copied jump address opened in a fresh tab opens at the id', async () => {
    const app = await open('places.md');
    let fresh: OpenedApp | null = null;
    try {
      const frame0 = await frameOf(app.page);
      await frame0.getByRole('link', { name: 'part 20', exact: true }).click();
      await becomes(() => Promise.resolve(app.page.url().endsWith('#part-20')), true, 'the address after the jump', app.page);
      const copied = app.page.url();
      // A new browser context: nothing of the first tab's history or storage is shared.
      expect(copied.endsWith('#part-20')).toBe(true);
      fresh = await open('places.md', DOC, [], false, '#part-20');
      const page = fresh.page;
      const frame = await frameOf(page);
      await becomes(
        () => frame.evaluate(() => {
          const el = document.getElementById('part-20');
          if (el === null) return false;
          const r = el.getBoundingClientRect();
          return r.top >= 0 && r.top < window.innerHeight;
        }),
        true, 'the heading in view', page,
      );
      expect(page.url(), 'the fresh tab stands on the copied address itself').toBe(copied);
      expect(await placeOf(page), 'no place in the fresh entry\'s state').toBeNull();
      expect(fresh.errors, 'no uncaught error').toEqual([]);
    } finally {
      await fresh?.ctx.close();
      await app.ctx.close();
    }
  }, 240_000);

  /** Speaks on the frame's own port, as the frame's script would. */
  const speak = (frame: Frame, msg: unknown): Promise<void> => frame.evaluate((m) => {
    (window as unknown as { __ccrcPort: MessagePort }).__ccrcPort.postMessage(m);
  }, msg);

  it('places: place with a URL refused by the parser', async () => {
    const app = await open('places.md', DOC, [], true);
    try {
      const page = app.page;
      const frame = await frameOf(page);
      const length = await lengthOf(page);
      const state = await quietEval<string>(page, 'JSON.stringify(history.state)');
      await speak(frame, { t: 'place', kind: 'overlay', url: 'https://example.invalid/' });
      await speak(frame, { t: 'place', kind: 'other' });
      await page.waitForTimeout(600);
      expect(await lengthOf(page), 'nothing pushed').toBe(length);
      expect(await quietEval<string>(page, 'JSON.stringify(history.state)'), 'and nothing changed').toBe(state);
      // The control, the same way: a well-formed place does push one.
      await speak(frame, { t: 'place', kind: 'overlay' });
      await becomes(() => lengthOf(page), length + 1, 'history after a well-formed place', page);
      expect(await placeOf(page)).toMatchObject({ kind: 'overlay', seq: 1 });
    } finally {
      await app.ctx.close();
    }
  }, 180_000);

  it('places: a hash whose from fails the library\'s anchor grammar or passes 4096 characters is refused by the parser', async () => {
    const app = await open('places.md', DOC, [], true);
    try {
      const page = app.page;
      const frame = await frameOf(page);
      const length = await lengthOf(page);
      const state = await quietEval<string>(page, 'JSON.stringify(history.state)');
      const token = tokenOf({ line: 'a', offset: 0, y: 0 });
      if (token === null) throw new Error('tokenOf made no token');
      // Valid-looking JSON padded with white space: at 4096 characters the library reads it as a token, at 4097 it does not.
      const atLimit = token + ' '.repeat(4096 - token.length);
      const long = token + ' '.repeat(4097 - token.length);
      expect(atLimit.length).toBe(4096);
      expect(long.length).toBe(4097);
      expect(parseToken(atLimit), 'the library reads 4096 characters as a token').not.toBeNull();
      expect(parseToken(long), 'and 4097 as none').toBeNull();
      const url = page.url();
      await speak(frame, { t: 'hash', id: 'part-1', push: 'true', from: 'not a token' });
      await speak(frame, { t: 'hash', id: 'part-1', push: 'true', from: long });
      await page.waitForTimeout(600);
      expect(await lengthOf(page), 'nothing pushed').toBe(length);
      expect(await quietEval<string>(page, 'JSON.stringify(history.state)'), 'and nothing changed').toBe(state);
      expect(page.url(), 'a push downgraded to a fragment move would change the address').toBe(url);
      // The controls: a token of the library's own pushes one, and so does one of exactly 4096 characters.
      await speak(frame, { t: 'hash', id: 'part-1', push: 'true', from: token });
      await becomes(() => lengthOf(page), length + 1, 'history after a well-formed jump', page);
      expect(await placeOf(page)).toMatchObject({ kind: 'jump', id: 'part-1', from: token });
      await speak(frame, { t: 'hash', id: 'part-2', push: 'true', from: atLimit });
      await becomes(() => lengthOf(page), length + 2, 'history after a jump whose token is 4096 characters', page);
      expect((await placeOf(page))?.from?.length).toBe(4096);
    } finally {
      await app.ctx.close();
    }
  }, 180_000);
});
