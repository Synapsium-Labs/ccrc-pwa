// The draft review page in a real browser (native Docs draft review, X3, wave R2 Task R2.3; spec 2026-11-18 section 3.5,
// row M-X3.16 and the Review Focus row "installed PWA does not answer /review"). The page is the built `review.html` of the
// run's one production build, served by `reviewServer.ts` with the exact headers of the real route (`REVIEW_PAGE_HEADERS`) and
// the real read door's answers (`REVIEW_OPEN_HEADERS` and the three number headers), from a store this file seeds. Chromium
// only: the leg launches Chromium. The phone's WebKit and desktop Firefox are measured by the operator on the same page,
// opened from the reader lab.
//
// Rows:
//   M-X3.16            `/review#lab` under the page's exact header policy: the Markdown copy's inline style draws, its `data:` PNG
//                      draws, the mockup copy's nested frame draws its swatch and its `data:` font is measured in that nested
//                      frame, the canary script of each frame did not run (the script element is in the frame's DOM, its global is
//                      unset and no frame holds the red block reading SCRIPT RAN that it would add), and a click on a link inside a
//                      frame leaves that frame's URL unchanged and reaches nothing, and a tap on the mockup copy's no-target permalink
//                      (`link-self`, D-9029) leaves the reader with the copy, kept or put back by the page with its sentence
//                      (`restored`), never gone. Lab mode sends no request to `/api/`. Every verdict is
//                      collected and logged as `M-X3.16 Chromium <version>: <key> <verdict>` before any is asserted, so the run's output
//                      is the record even when a verdict fails.
//   hostile snapshot   a snapshot with a `<script>` and an `onerror` image, opened through the real flow (fragment, tap Open
//                      draft): neither runs, and the frame cannot read the review origin's cookie.
//   10 MiB snapshot    a snapshot of `DOCS_EXPORT_MAX_BYTES` opens and its last element is in the frame's DOM.
//   links              a click on a link inside the frame does not navigate it and opens nothing; a click on an anchor with no
//                      target (the frame's own navigation, which the page's policy blocks through `frame-src`, spec section 3.5, though
//                      Chromium then navigates the FRAME to its error page) reaches nothing and leaves the top page where it was, and
//                      the page puts its own copy back once with one sentence (D-9029); a click on one with `target="_top"` or
//                      `target="_blank"` leaves the frame, its copy and the top page where they were, with no restore
//                      (CONTROL: the same anchor in a page with no such policy navigates and is recorded); the page's listed
//                      link opens a new tab whose request carries no `Referer` (CONTROL: the same link from a page with the default
//                      referrer policy does).
//   restore bound      (D-9029, three restores within any ten seconds; Playwright's clock installed on the context, so no row
//                      waits in real time) four fast taps (the page's clock paused) give three restores and then the frame is
//                      left on the error page with the stop sentence; four taps with the clock moved 11 s before each are each
//                      restored, the copy back every time.
//   D-9029 measurements  what a real copy carries besides the mockup's permalink, each in the real flow and each recording one
//                      `M-X3.16 Chromium <version>: ...` line: an in-page fragment link (`href="#id"`, no target), a footnote
//                      reference and back link tapped four times fast (the page's clock paused), a Markdown-arm permalink (https, no target) and a no-target link
//                      tapped before the copy's own `load` (a named residual). Asserted only what must hold whatever the engine does:
//                      no request left, no tab opened, the top page is still `/review` (and, for the first and third, the copy is in
//                      the frame afterwards); whether the frame scrolled, how many restores happened and the sentences are recorded.
//   harness door       the harness's read door answers the real door's 404 body, with the real headers, for no marker, an unknown
//                      token and a body whose media type is not JSON (CONTROL: a seeded token with the marker and JSON answers 200).
//   installed PWA      `installed PWA does not answer /review`: with the built service worker controlling the page, a navigation
//                      to `/review` reaches the server, not the worker, and carries the page's policy (CONTROL: a navigation to a
//                      shell route is answered by the worker and reaches the server not at all, so the row can see a worker answer).
//
// How the frames are read: the copy frames are `sandbox=""` (no `allow-scripts`, an opaque origin). Playwright's `frame.evaluate`
// still runs in them (a CDP evaluation is not a page script, so the sandbox does not stop it), and the page's policy is untouched:
// no message channel is added and nothing is widened. What the read shows is the frame's main-world globals and DOM; the
// canary's absence is read beside the canary's presence in the DOM, so a missing global is not a read of nothing.
//
// Run: `( cd pwa && ccrc test -- ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/docs-review.browser.test.ts )`
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Frame, type Page } from 'playwright-core';
import { DOCS_EXPORT_MAX_BYTES } from '../../shared/docs';
import {
  REVIEW_MARKER_HEADER, REVIEW_MARKER_VALUE, REVIEW_NOT_FOUND, REVIEW_OPEN_HEADERS, REVIEW_PAGE_CSP, REVIEW_PAGE_HEADERS,
} from '../../shared/docsReview';
import { resolveChrome } from './harness';
import { startReviewServer, type ReviewRecord, type ReviewServer } from './reviewServer';

const SHARED_AT = Date.parse('2026-11-25T10:00:00Z');
const LAB_GROUND = 'rgb(11, 13, 12)';
const LAB_SWATCH = 'rgb(31, 122, 77)';

let server: ReviewServer;
let browser: Browser;
let version = '';
const contexts: BrowserContext[] = [];

beforeAll(async () => {
  const executablePath = resolveChrome(); // throws on a box with no Chrome: red, never skipped
  server = await startReviewServer();
  browser = await chromium.launch({ executablePath, headless: true });
  version = browser.version();
}, 120_000);

afterAll(async () => {
  for (const c of contexts.splice(0)) await c.close().catch(() => undefined);
  await browser?.close();
  await server?.close();
});

afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close().catch(() => undefined);
});

// ---- helpers ---------------------------------------------------------------------------------------------------------------

/** A request that left the loopback server: every `https:` host of a link is routed here, fulfilled with a stub page and recorded. */
interface External {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

interface Session {
  readonly ctx: BrowserContext;
  readonly page: Page;
  readonly external: External[];
  /** Every page opened by `page` (a popup of a link), in order. */
  readonly popups: Page[];
}

/** The time a row with a pinned clock pauses the page's clock at (milliseconds on the installed clock, which starts at 0). */
const CLOCK_PAUSE_AT = 3_600_000;
/** The step a spaced row moves the page's clock by before each tap: more than the page's ten-second restore window. */
const SPACED_MS = 11_000;

/** `pinClock` installs Playwright's clock on the context before the page loads (it mocks the page's `performance.now()`, which
 *  the review page's restore bound reads); a row then pauses it with `pauseClock` or moves it with `clock.fastForward`. */
async function session(serviceWorkers: 'allow' | 'block' = 'block', pinClock = false): Promise<Session> {
  const ctx = await server.newContext(browser, serviceWorkers);
  contexts.push(ctx);
  if (pinClock) await ctx.clock.install({ time: 0 });
  const external: External[] = [];
  await ctx.route((url) => url.hostname !== '127.0.0.1', async (route) => {
    external.push({ url: route.request().url(), headers: await route.request().allHeaders() });
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>external</title>' });
  });
  const page = await ctx.newPage();
  const popups: Page[] = [];
  page.on('popup', (p) => { popups.push(p); });
  return { ctx, page, external, popups };
}

const token = (): string => randomBytes(32).toString('base64url');

/** The recorded external requests for exactly `url`, in arrival order (a request is read by what it asked for, never by its place). */
const externalFor = (s: Session, url: string): External[] => s.external.filter((e) => e.url === url);

/** The iframe matched by `selector` inside `scope`, as a frame handle. */
async function frameIn(scope: Page | Frame, selector: string): Promise<Frame> {
  const handle = await scope.waitForSelector(selector, { state: 'attached', timeout: 30_000 });
  const frame = await handle.contentFrame();
  if (frame === null) throw new Error(`${selector} has no content frame`);
  return frame;
}

/** Seed `html` as a snapshot, open it through the real flow (the fragment, then a tap on Open draft) and return the copy's frame. */
async function openDraft(s: Session, html: string): Promise<{ readonly frame: Frame; readonly tok: string }> {
  const tok = token();
  server.seed(tok, { bytes: html, sharedAt: SHARED_AT, version: 1 });
  await s.page.goto(`/review#${tok}`);
  await s.page.getByRole('button', { name: 'Open draft' }).waitFor({ timeout: 30_000 });
  expect(new URL(s.page.url()).hash, 'the page cleared the fragment before anything else').toBe('');
  await s.page.getByRole('button', { name: 'Open draft' }).click();
  return { frame: await frameIn(s.page, 'iframe.review-frame'), tok };
}

/** Pause the page's clock (a session made with `pinClock`), so no real time passes for the restore bound: every tap that follows is "fast". */
const pauseClock = (s: Session): Promise<void> => s.page.clock.pauseAt(CLOCK_PAUSE_AT);

/** The window a negative is watched for: long enough for a navigation or a request to have started. */
const WATCH_MS = 1000;

// ---- M-X3.16 -----------------------------------------------------------------------------------------------------------------

describe('M-X3.16: the review page\'s copy frames under the page\'s exact header policy', () => {
  it('draws the copies, runs no canary and leaves a link tap inert (Chromium)', async () => {
    const s = await session();
    const mark = server.requests.length;
    const nav = await s.page.goto('/review#lab');
    expect(nav?.status(), 'the page was answered').toBe(200);
    expect(nav?.headers()['content-security-policy'], 'the page was served under its exact policy').toBe(REVIEW_PAGE_CSP);
    for (const [name, value] of Object.entries(REVIEW_PAGE_HEADERS)) {
      expect(nav?.headers()[name], `the page's ${name} header`).toBe(value);
    }

    // Every verdict is logged as it is read and collected; the assertion is one, after the last line, so a failing run still
    // records each key.
    const failed: string[] = [];
    const check = (key: string, ok: boolean, good: string, bad: string, detail: string): void => {
      console.log(`M-X3.16 Chromium ${version}: ${key} ${ok ? good : bad}`);
      if (!ok) failed.push(`${key} ${bad}: ${detail}`);
    };

    // The frames: the Markdown copy, the mockup copy and the mockup's nested frame (the deepest the copy holds).
    const md = await frameIn(s.page, 'figure[data-copy="markdown"] iframe');
    const mock = await frameIn(s.page, 'figure[data-copy="mockup"] iframe');
    await md.waitForSelector('img.ccrc-export-img', { state: 'attached', timeout: 30_000 });
    const nested = await frameIn(mock, 'iframe');
    await nested.waitForSelector('.lab-swatch', { state: 'attached', timeout: 30_000 });

    // The page's own result block names the engine it measured in and the OS class `deviceOf` reads, so the log line and the
    // page agree. The engine word is Chromium here; the OS word is whatever this box's Chromium reports, one of the six.
    const resultHead = (await s.page.locator('.review-lab-result').innerText()).split('\n')[0] ?? '';
    const head = /^review-lab 1 · (\S+) · (\S+)$/.exec(resultHead);
    check('engine', head?.[1] === 'Chromium' && ['Android', 'iOS', 'macOS', 'Windows', 'Linux', 'other'].includes(head[2] ?? ''), 'named', 'misnamed',
      `the page's result block starts ${JSON.stringify(resultHead)}`);
    console.log(`M-X3.16 Chromium ${version}: result block head ${JSON.stringify(resultHead)}`);

    // CONTROL for the reads below: a global the test itself writes in a frame's main world is read back by the same kind of
    // evaluate. That shows only that a read of a global in each sandboxed frame sees what is set in that frame's main world; it
    // does not show that a page script would have set one there, which is why the canary's presence in the DOM is read as well.
    for (const [name, frame] of [['markdown', md], ['mockup', mock], ['nested', nested]] as const) {
      await frame.evaluate(() => { (window as unknown as Record<string, unknown>)['__labProbe'] = 7; });
      expect(await frame.evaluate(() => (window as unknown as Record<string, unknown>)['__labProbe']), `the ${name} frame's main world is readable`).toBe(7);
    }

    // inline-style: the Markdown copy's own stylesheet draws (its page ground; an unstyled frame is transparent).
    const ground = await md.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check('inline-style', ground === LAB_GROUND, 'drew', 'did-not-draw', `body background ${ground}, expected ${LAB_GROUND}`);

    // data-image: the `data:` PNG decoded at its 64 by 16 size.
    const image = await md.evaluate(() => {
      const img = document.querySelector<HTMLImageElement>('img.ccrc-export-img');
      return img === null ? null : { complete: img.complete, w: img.naturalWidth, h: img.naturalHeight, src: img.src.slice(0, 15) };
    });
    check('data-image', image !== null && image.complete && image.w === 64 && image.h === 16 && image.src === 'data:image/png;', 'drew', 'did-not-draw',
      `image ${JSON.stringify(image)}`);

    // nested-frame: the mockup copy's inner frame draws its swatch (120 by 24, its own colour).
    const swatch = await nested.evaluate(() => {
      const el = document.querySelector('.lab-swatch');
      if (el === null) return null;
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, w: cs.width, h: cs.height };
    });
    check('nested-frame', swatch !== null && swatch.bg === LAB_SWATCH && swatch.w === '120px' && swatch.h === '24px', 'drew', 'did-not-draw',
      `swatch ${JSON.stringify(swatch)}, expected ${LAB_SWATCH} 120px by 24px`);

    // data-font: measured in the nested frame, where the face is declared (the deepest frame a copy holds). `check` alone is true
    // for a family nothing declares, so the face must also be listed by its name and read `loaded`.
    const font = await nested.evaluate(async () => {
      await document.fonts.ready;
      const faces = [...document.fonts].map((f) => ({ family: f.family.replace(/["']/g, ''), status: f.status }));
      return { check: document.fonts.check('16px ReviewLabFace'), faces };
    });
    const face = font.faces.find((f) => f.family === 'ReviewLabFace');
    check('data-font', font.check && face?.status === 'loaded', 'drew', 'did-not-draw', `fonts ${JSON.stringify(font)}`);

    // script-off: no canary ran in any frame (its global is unset) and no frame holds the red block reading SCRIPT RAN that a
    // canary that ran would add (the markers' own colours are read as well, though the canary no longer touches them).
    // The canary's script element is in the Markdown copy's DOM and in the mockup's nested frame's DOM (parsed, not run), so the
    // absence of its global below is not vacuous.
    const scriptHolds = (f: Frame): Promise<boolean> =>
      f.evaluate(() => [...document.scripts].some((el) => (el.textContent ?? '').includes('__reviewLabCanary')));
    const present = [await scriptHolds(md), await scriptHolds(nested)];
    const canary = await Promise.all([md, mock, nested].map((f) => f.evaluate(() => (window as unknown as Record<string, unknown>)['__reviewLabCanary'])));
    const blocksIn = (f: Frame): Promise<number> => f.evaluate(() => [...document.querySelectorAll('div')].filter((d) => d.textContent === 'SCRIPT RAN').length);
    const blocks = await Promise.all([md, mock, nested].map(blocksIn));
    // CONTROL: a block like the canary's, added to a frame by the test, is counted by the same read, so a zero above is a measurement.
    await md.evaluate(() => {
      const d = document.createElement('div');
      d.id = 'lab-control-block';
      d.textContent = 'SCRIPT RAN';
      document.body.appendChild(d);
    });
    expect(await blocksIn(md), 'CONTROL: the block read counts a block that is there').toBe(1);
    await md.evaluate(() => { document.getElementById('lab-control-block')?.remove(); });
    expect(await blocksIn(md), 'CONTROL: and counts none once it is removed').toBe(0);
    const groundAfter = await md.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const swatchAfter = await nested.evaluate(() => getComputedStyle(document.querySelector('.lab-swatch')!).backgroundColor);
    check('script-off', present.every(Boolean) && canary.every((c) => c === undefined) && blocks.every((n) => n === 0) && groundAfter === LAB_GROUND && swatchAfter === LAB_SWATCH,
      'unchanged', 'changed',
      `canary script in the Markdown frame and in the nested frame ${JSON.stringify(present)}, canary globals ${JSON.stringify(canary)}, SCRIPT RAN blocks ${JSON.stringify(blocks)}, ground ${groundAfter}, swatch ${swatchAfter}`);

    // link-inert: a tap on each link leaves its frame's URL unchanged and reaches nothing: no frame navigation, no new tab, no
    // request for the link's host. The Markdown copy's link and the mockup's outer list link are the two real anchors; the inner "a link"
    // has no href in Export's output (it is clicked as well, as a no-op, and the page's line does not ask the operator to tap it).
    const urlOf = (f: Frame): Promise<string> => f.evaluate(() => location.href);
    const before = { md: [md.url(), await urlOf(md)], mock: [mock.url(), await urlOf(mock)], nested: [nested.url(), await urlOf(nested)] };
    const navigated: string[] = [];
    s.page.on('framenavigated', (f) => { navigated.push(f.url()); });
    const popupsBefore = s.popups.length;
    await md.locator('article a').click({ timeout: 10_000 });
    await mock.locator('.ccrc-export-notes a[target="_blank"]').click({ timeout: 10_000 });
    await nested.locator('a').first().click({ timeout: 10_000 });
    await new Promise((r) => setTimeout(r, WATCH_MS));
    const after = { md: [md.url(), await urlOf(md)], mock: [mock.url(), await urlOf(mock)], nested: [nested.url(), await urlOf(nested)] };
    const stillThere = await Promise.all([md.locator('article h1').innerText(), nested.locator('.lab-text').innerText()]);
    check('link-inert',
      JSON.stringify(after) === JSON.stringify(before) && navigated.length === 0 && s.popups.length === popupsBefore && s.external.length === 0
        && stillThere[0] === 'Review lab page' && stillThere[1].startsWith('Review lab sample'),
      'unchanged', 'changed',
      `urls before ${JSON.stringify(before)} after ${JSON.stringify(after)}; frame navigations ${JSON.stringify(navigated)}; new tabs ${s.popups.length - popupsBefore}; external ${JSON.stringify(s.external)}`);

    // link-self (D-9029): a tap on the no-target permalink of the mockup copy's "Links in this page" list. Chromium blocks the
    // frame from leaving (no request, the top page stays) but navigates the frame to its error page, and the page puts its own
    // copy back with one sentence: the verdict is `restored`. `kept` (the frame never left) is a pass as well; `gone` is the failure.
    // The copy is read back through a fresh handle to the frame element, because a restore replaces its document.
    const mockFrame = s.page.locator('figure[data-copy="mockup"] iframe');
    const selfTarget = mock.locator('.ccrc-export-notes a:not([target])');
    expect(await selfTarget.count(), 'the mockup copy lists exactly one link with no target').toBe(1);
    const selfHref = (await selfTarget.getAttribute('href')) ?? '';
    const externalBeforeSelf = s.external.length;
    const popupsBeforeSelf = s.popups.length;
    const requestsBeforeSelf = server.requests.length;
    const selfNavigated: string[] = [];
    s.page.on('framenavigated', (f) => { selfNavigated.push(f.url()); });
    await selfTarget.click({ timeout: 10_000 });
    await new Promise((r) => setTimeout(r, WATCH_MS));
    const mockBack = await frameIn(s.page, 'figure[data-copy="mockup"] iframe');
    await mockBack.waitForSelector('.ccrc-export-notes', { state: 'attached', timeout: 10_000 }).catch(() => undefined);
    const selfCopy = await mockBack.evaluate(() => document.querySelectorAll('.ccrc-export-notes a').length).catch(() => 0);
    const selfRestores = await mockFrame.getAttribute('data-restores');
    const selfNote = await s.page.locator('figure[data-copy="mockup"] .review-restore-note').count()
      ? await s.page.locator('figure[data-copy="mockup"] .review-restore-note').innerText() : null;
    const selfWord = selfCopy === 2 && mockBack.url() === 'about:srcdoc'
      ? (selfRestores === '1' && selfNote === RESTORED_NO_LINKS ? 'restored' : selfRestores === '0' && selfNote === null && selfNavigated.length === 0 ? 'kept' : 'gone')
      : 'gone';
    check('link-self', selfWord !== 'gone', selfWord, 'gone',
      `tapped ${selfHref}; the mockup frame is at ${mockBack.url()} with ${selfCopy} listed links, restores ${JSON.stringify(selfRestores)}, sentence ${JSON.stringify(selfNote)}, frame navigations ${JSON.stringify(selfNavigated)}`);
    expect(new URL(s.page.url()).pathname, 'the top page did not move').toBe('/review');
    expect(s.external.length - externalBeforeSelf, 'the tap reached no host').toBe(0);
    expect(s.popups.length - popupsBeforeSelf, 'the tap opened no tab').toBe(0);
    expect(server.requests.slice(requestsBeforeSelf).filter((r) => r.url !== '/favicon.ico').map((r) => `${r.method} ${r.url}`), 'the tap and the restore made no request').toEqual([]);

    // Lab mode makes no request to the server's API: nothing from the page's load to here reached `/api/`.
    const apiCalls = server.requests.slice(mark).filter((r) => r.url.startsWith('/api/')).map((r) => `${r.method} ${r.url}`);
    check('no-api', apiCalls.length === 0, 'none', 'requested', `lab mode sent ${JSON.stringify(apiCalls)} to /api/`);
    // CONTROL: a fetch the test makes from the lab page to an `/api/` path (its policy allows `connect-src 'self'`) is recorded, so
    // the empty list above is a measurement.
    const controlMark = server.requests.length;
    await s.page.evaluate(() => fetch('/api/lab-control').then((r) => r.status));
    expect(server.requests.slice(controlMark).filter((r) => r.url.startsWith('/api/')).map((r) => r.url),
      'CONTROL: the harness records a request to /api/ when one is made').toEqual(['/api/lab-control']);

    // CONTROL for the watch: a request for the link's own host, made by the test in a page of the same context, is recorded.
    const control = await s.ctx.newPage();
    await control.goto('https://example.org/review-lab');
    expect(externalFor(s, 'https://example.org/review-lab').length, 'the watch records a request for the link\'s host when one is made').toBe(1);
    await control.close();

    expect(failed, `M-X3.16 Chromium ${version}: every verdict read as intended`).toEqual([]);
  }, 120_000);
});

// ---- the real flow -----------------------------------------------------------------------------------------------------------

/** A minimal copy: a document with a known marker element, plus whatever `extra` the case plants after it. */
const copy = (extra: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Seeded copy</title></head><body><h1 id="seeded">Seeded copy</h1>${extra}</body></html>`;

/** The sentences the page shows beside a restored copy (D-9029), written out here so a changed word reads red. */
const RESTORED_WITH_LINKS = 'That link opens outside this page. Use the links listed above.';
const RESTORED_NO_LINKS = 'That link cannot open from this page.';
const RESTORE_STOPPED = 'This copy kept leaving its frame, so it is no longer redrawn. Open the link you were sent to read it again.';

/** The page's restore count for the copy frame (`data-restores`), or `null` when there is no such frame. */
const restoresOf = (page: Page): Promise<string | null> => page.locator('iframe.review-frame').first().getAttribute('data-restores');
/** The sentence beside the copy, or `null` when the page shows none. */
const noteOf = async (page: Page): Promise<string | null> => {
  const note = page.locator('.review-restore-note');
  return (await note.count()) === 0 ? null : note.first().innerText();
};

/**
 * One tap on an anchor of the copy that tries to leave the frame (`attrs` is '' for no target, ` target="_top"` for the page,
 * ` target="_blank"` for a new tab), on a fresh copy opened through the real flow. The target is a distinct `https:` path on a host
 * the context routes and records. `restored` says what the page is expected to do: the no-target tap navigates the frame to
 * Chromium's error page, and the page puts its own copy back (one restore, one sentence); `_top` and `_blank` leave the copy where
 * it was, with NO restore (count zero, no sentence). Either way no request leaves, the top page does not move and no tab opens.
 * Logs `M-X3.16 Chromium <version>: self-navigation <label> <outcome>` and returns what departed from the expectation.
 */
async function selfNavigation(label: string, attrs: string, restored: boolean): Promise<{ readonly label: string; readonly problems: string[] }> {
  const linkHref = `https://links.example.org/self-nav-${label.replace(/\W/g, '')}`;
  const linkPath = new URL(linkHref).pathname;
  const t = await session();
  const { frame } = await openDraft(t, copy(`<p><a id="nav" href="${linkHref}"${attrs}>go</a></p>`));
  await frame.waitForSelector('#nav', { state: 'attached', timeout: 30_000 });
  const mark = server.requests.length;
  const navigated: string[] = [];
  t.page.on('framenavigated', (f) => { navigated.push(f.url()); });
  const urlBefore = [frame.url(), await frame.evaluate(() => location.href)];
  await frame.locator('#nav').click({ timeout: 10_000 });
  await new Promise((r) => setTimeout(r, WATCH_MS));
  // Under load the frame's navigation and the page's restore can land after the watch window (measured once, beside another
  // browser file): when a restore is expected, wait for its count, bounded; a missing one is still reported below.
  if (restored) await expect.poll(() => restoresOf(t.page), { timeout: 15_000 }).toBe('1').catch(() => undefined);
  // A restore replaces the frame's document, so the copy is read back through a fresh handle to the same frame element.
  const back = await frameIn(t.page, 'iframe.review-frame');
  await back.waitForSelector('#seeded', { state: 'attached', timeout: 10_000 }).catch(() => undefined);
  const urlAfter = [back.url(), await back.evaluate(() => location.href).catch((e: Error) => `unreadable: ${e.message}`)];
  const copyText = await back.evaluate(() => document.getElementById('seeded')?.textContent ?? null).catch((e: Error) => `unreadable: ${e.message}`);
  const topPath = new URL(t.page.url()).pathname;
  const restores = await restoresOf(t.page);
  const note = await noteOf(t.page);
  const reached = [
    ...externalFor(t, linkHref).map((e) => e.url),
    ...server.requests.slice(mark).filter((r) => r.url.includes(linkPath)).map((r) => r.url),
  ];
  const asked = server.requests.slice(mark).filter((r) => r.url !== '/favicon.ico').map((r) => `${r.method} ${r.url}`);
  const outcome = copyText === 'Seeded copy'
    ? `the copy is in its frame at ${urlAfter[0]}, restores ${restores}, sentence ${JSON.stringify(note)}`
    : `the copy is gone: frame url ${JSON.stringify(urlAfter)} (was ${JSON.stringify(urlBefore)}), copy ${JSON.stringify(copyText)}`;
  console.log(`M-X3.16 Chromium ${version}: self-navigation ${label} ${outcome}; frame navigations ${navigated.length}; top page ${topPath}; requests for ${linkPath}: ${reached.length}; new tabs ${t.popups.length}`);
  const problems: string[] = [];
  if (JSON.stringify(urlAfter) !== JSON.stringify(urlBefore)) problems.push(`the frame's URL changed from ${JSON.stringify(urlBefore)} to ${JSON.stringify(urlAfter)}`);
  if (copyText !== 'Seeded copy') problems.push(`the copy is not there: ${JSON.stringify(copyText)}`);
  if (restored) {
    if (navigated.length === 0) problems.push('the frame never navigated, so there was nothing to restore');
    if (restores !== '1') problems.push(`the page's restore count is ${JSON.stringify(restores)}, expected "1"`);
    if (note !== RESTORED_WITH_LINKS) problems.push(`the sentence is ${JSON.stringify(note)}`);
  } else {
    if (navigated.length > 0) problems.push(`frame navigations ${JSON.stringify(navigated)}`);
    if (restores !== '0') problems.push(`the page's restore count is ${JSON.stringify(restores)}, expected "0"`);
    if (note !== null) problems.push(`a sentence is shown: ${JSON.stringify(note)}`);
  }
  if (topPath !== '/review') problems.push(`the top page is at ${topPath}`);
  if (t.popups.length > 0) problems.push(`${t.popups.length} new tab(s)`);
  if (reached.length > 0) problems.push(`requests for ${linkPath}: ${JSON.stringify(reached)}`);
  if (asked.length > 0) problems.push(`the server saw requests after the tap: ${JSON.stringify(asked)}`);
  return { label, problems };
}

/**
 * A copy that leaves its frame again and again, fast: the no-target link is tapped four times on one copy with the page's clock
 * paused, so all four taps fall inside the page's ten-second window. The first three taps are
 * each restored (the count reads 1, 2, 3, the copy is back, one sentence); the fourth is not, so the frame stays on Chromium's
 * error page, the count stays 3 and the sentence is the stop sentence. No tap, no restore and no stop made a request.
 */
async function repeatedSelfNavigation(): Promise<{ readonly label: string; readonly problems: string[] }> {
  const linkHref = 'https://links.example.org/self-nav-repeated';
  const linkPath = new URL(linkHref).pathname;
  const t = await session('block', true);
  const first = await openDraft(t, copy(`<p><a id="nav" href="${linkHref}">go</a></p>`));
  await first.frame.waitForSelector('#nav', { state: 'attached', timeout: 30_000 });
  await pauseClock(t);
  const mark = server.requests.length;
  const problems: string[] = [];
  const seen: string[] = [];
  // The frame element is read afresh each time: a restore replaces its document.
  const current = (): Promise<Frame> => frameIn(t.page, 'iframe.review-frame');
  for (let i = 1; i <= 3; i += 1) {
    const frame = await current();
    await frame.locator('#nav').click({ timeout: 10_000 });
    const reached = await expect.poll(() => restoresOf(t.page), { timeout: 15_000, message: `restore ${i}` }).toBe(String(i)).then(() => true, () => false);
    const back = await current();
    await back.waitForSelector('#nav', { state: 'attached', timeout: 15_000 }).catch(() => undefined);
    seen.push(`tap ${i}: count ${await restoresOf(t.page)}, sentence ${JSON.stringify(await noteOf(t.page))}, frame ${back.url()}`);
    if (!reached) problems.push(`tap ${i} was not restored`);
    if ((await back.evaluate(() => document.getElementById('seeded')?.textContent ?? null).catch(() => null)) !== 'Seeded copy') problems.push(`after tap ${i} the copy is not back`);
    if ((await noteOf(t.page)) !== RESTORED_WITH_LINKS) problems.push(`after tap ${i} the sentence is not the restore sentence`);
  }
  await (await current()).locator('#nav').click({ timeout: 10_000 });
  await new Promise((r) => setTimeout(r, WATCH_MS));
  const finalUrl = (await current()).url();
  const finalCount = await restoresOf(t.page);
  const finalNote = await noteOf(t.page);
  const reachedLink = [...externalFor(t, linkHref).map((e) => e.url), ...server.requests.slice(mark).filter((r) => r.url.includes(linkPath)).map((r) => r.url)];
  const asked = server.requests.slice(mark).filter((r) => r.url !== '/favicon.ico').map((r) => `${r.method} ${r.url}`);
  console.log(`M-X3.16 Chromium ${version}: self-navigation repeated ${seen.join('; ')}; tap 4: frame ${finalUrl}, count ${finalCount}, sentence ${JSON.stringify(finalNote)}; top page ${new URL(t.page.url()).pathname}; requests for ${linkPath}: ${reachedLink.length}; new tabs ${t.popups.length}`);
  if (!finalUrl.startsWith('chrome-error://')) problems.push(`after the fourth tap the frame is at ${finalUrl}, expected Chromium's error page`);
  if (finalCount !== '3') problems.push(`after the fourth tap the restore count is ${JSON.stringify(finalCount)}, expected "3"`);
  if (finalNote !== RESTORE_STOPPED) problems.push(`after the fourth tap the sentence is ${JSON.stringify(finalNote)}`);
  if (new URL(t.page.url()).pathname !== '/review') problems.push('the top page moved');
  if (t.popups.length > 0) problems.push(`${t.popups.length} new tab(s)`);
  if (reachedLink.length > 0) problems.push(`requests for ${linkPath}: ${JSON.stringify(reachedLink)}`);
  if (asked.length > 0) problems.push(`the server saw requests after the first tap: ${JSON.stringify(asked)}`);
  return { label: 'repeated', problems };
}

/**
 * A reader who taps the no-target link four times, each tap more than ten seconds after the last (the page's clock is paused and
 * moved by `SPACED_MS` before each tap): every tap is restored, the count reads 1, 2, 3, 4, the copy is back each time with the
 * restore sentence, and the page never shows the stop sentence. No request after the first tap, the top page stays, no new tab.
 */
async function spacedSelfNavigation(): Promise<{ readonly label: string; readonly problems: string[] }> {
  const linkHref = 'https://links.example.org/self-nav-spaced';
  const linkPath = new URL(linkHref).pathname;
  const t = await session('block', true);
  const first = await openDraft(t, copy(`<p><a id="nav" href="${linkHref}">go</a></p>`));
  await first.frame.waitForSelector('#nav', { state: 'attached', timeout: 30_000 });
  await pauseClock(t);
  const mark = server.requests.length;
  const problems: string[] = [];
  const seen: string[] = [];
  const current = (): Promise<Frame> => frameIn(t.page, 'iframe.review-frame');
  for (let i = 1; i <= 4; i += 1) {
    await t.page.clock.fastForward(SPACED_MS);
    const frame = await current();
    await frame.locator('#nav').click({ timeout: 10_000 });
    const reached = await expect.poll(() => restoresOf(t.page), { timeout: 15_000, message: `restore ${i}` }).toBe(String(i)).then(() => true, () => false);
    const back = await current();
    await back.waitForSelector('#nav', { state: 'attached', timeout: 15_000 }).catch(() => undefined);
    const sentence = await noteOf(t.page);
    seen.push(`tap ${i}: count ${await restoresOf(t.page)}, sentence ${JSON.stringify(sentence)}, frame ${back.url()}`);
    if (!reached) problems.push(`tap ${i} was not restored`);
    if ((await back.evaluate(() => document.getElementById('seeded')?.textContent ?? null).catch(() => null)) !== 'Seeded copy') problems.push(`after tap ${i} the copy is not back`);
    if (sentence !== RESTORED_WITH_LINKS) problems.push(`after tap ${i} the sentence is ${JSON.stringify(sentence)}, expected the restore sentence`);
  }
  const reachedLink = [...externalFor(t, linkHref).map((e) => e.url), ...server.requests.slice(mark).filter((r) => r.url.includes(linkPath)).map((r) => r.url)];
  const asked = server.requests.slice(mark).filter((r) => r.url !== '/favicon.ico').map((r) => `${r.method} ${r.url}`);
  console.log(`M-X3.16 Chromium ${version}: self-navigation spaced ${seen.join('; ')}; top page ${new URL(t.page.url()).pathname}; requests for ${linkPath}: ${reachedLink.length}; new tabs ${t.popups.length}`);
  if (new URL(t.page.url()).pathname !== '/review') problems.push('the top page moved');
  if (t.popups.length > 0) problems.push(`${t.popups.length} new tab(s)`);
  if (reachedLink.length > 0) problems.push(`requests for ${linkPath}: ${JSON.stringify(reachedLink)}`);
  if (asked.length > 0) problems.push(`the server saw requests after the first tap: ${JSON.stringify(asked)}`);
  return { label: 'spaced', problems };
}

describe('the review page: the real flow in Chromium', () => {
  it('a snapshot holding a script and an onerror image runs neither, and its frame cannot read the origin\'s cookie', async () => {
    const s = await session();
    await s.ctx.addCookies([{ name: 'ccrc_leak', value: 'secret-cookie-value', url: server.origin }]);
    const hostile = copy('<script>window.__reviewPwned=1</script><img src=x onerror="window.__reviewPwned=2"><p id="after">after</p>');
    const mark = server.requests.length;
    const { frame } = await openDraft(s, hostile);
    await frame.waitForSelector('#after', { state: 'attached', timeout: 30_000 });

    // CONTROL: the cookie exists on the review origin and the page itself can read it, so a leak would show.
    expect(await s.page.evaluate(() => document.cookie), 'the cookie is set on the review origin').toContain('ccrc_leak=secret-cookie-value');
    // The seeded markup is in the frame (so the frame loaded and the payload was parsed there), and neither payload ran.
    expect(await frame.evaluate(() => document.getElementById('seeded')?.textContent), 'the copy loaded in the frame').toBe('Seeded copy');
    expect(await frame.evaluate(() => document.scripts.length), 'the script element is in the DOM, parsed and not run').toBe(1);
    expect(await frame.evaluate(() => (window as unknown as Record<string, unknown>)['__reviewPwned']), 'neither payload ran').toBeUndefined();
    expect(await s.page.evaluate(() => (window as unknown as Record<string, unknown>)['__reviewPwned']), 'nor in the page').toBeUndefined();
    // The frame is an opaque origin: reading its cookie throws (or answers nothing), and never the origin's cookie.
    const read = await frame.evaluate(() => {
      try {
        return { value: document.cookie };
      } catch (e) {
        return { threw: (e as Error).name };
      }
    });
    console.log(`review cookie read in the frame: ${JSON.stringify(read)}`);
    expect('threw' in read ? read.threw : read.value, 'the frame cannot read the cookie').toMatch(/^(SecurityError|)$/);
    // The `src=x` of the failing image reached no server (the page's policy allows `data:` images only).
    const since = server.requests.slice(mark);
    expect(since.filter((r: ReviewRecord) => r.url === '/x'), 'the image\'s src was never requested').toEqual([]);
    // The one open request carried the marker and answered 200.
    expect(since.filter((r) => r.url === '/api/review/open').map((r) => [r.method, r.answer, r.headers[REVIEW_MARKER_HEADER]]),
      'the read door was asked once, with the marker').toEqual([['POST', 'open-200', REVIEW_MARKER_VALUE]]);
  }, 120_000);

  it('a snapshot of DOCS_EXPORT_MAX_BYTES opens and its last element is in the frame\'s DOM', async () => {
    const s = await session();
    const head = '<!doctype html><html><head><meta charset="utf-8"><title>Big copy</title></head><body>\n';
    const tail = '<p id="review-last-element">the last element</p>\n</body></html>\n';
    const room = DOCS_EXPORT_MAX_BYTES - head.length - tail.length; // all ASCII, so a character is a byte
    const para = '<p>A plain paragraph of the large snapshot, with words in it so it is text and not padding.</p>\n';
    const count = Math.floor(room / para.length);
    // The remainder is one comment of the exact length that is left, so the document is exactly the cap.
    const rest = room - count * para.length;
    const pad = rest >= 7 ? `<!--${'x'.repeat(rest - 7)}-->` : ' '.repeat(rest);
    const html = head + para.repeat(count) + pad + tail;
    expect(Buffer.byteLength(html, 'utf8'), 'the snapshot is exactly the export cap').toBe(DOCS_EXPORT_MAX_BYTES);
    const { frame } = await openDraft(s, html);
    await frame.waitForSelector('#review-last-element', { state: 'attached', timeout: 90_000 });
    expect(await frame.evaluate(() => document.getElementById('review-last-element')?.textContent), 'the last element is in the frame\'s DOM').toBe('the last element');
    expect(await frame.evaluate(() => document.querySelectorAll('p').length), 'every paragraph is in the DOM').toBe(count + 1);
  }, 180_000);

  it('a click on a link inside the frame navigates nothing; the listed link opens a new tab whose request carries no Referer', async () => {
    const s = await session();
    const href = 'https://links.example.org/listed';
    const { frame } = await openDraft(s, copy(`<p><a id="in-frame" href="${href}" target="_blank" rel="noopener noreferrer">a link</a></p>`));
    await frame.waitForSelector('#in-frame', { state: 'attached', timeout: 30_000 });

    // A tap inside the frame: the frame's URL is unchanged, no tab opens, no request leaves the loopback.
    const before = [frame.url(), await frame.evaluate(() => location.href)];
    const navigated: string[] = [];
    s.page.on('framenavigated', (f) => { navigated.push(f.url()); });
    await frame.locator('#in-frame').click({ timeout: 10_000 });
    await new Promise((r) => setTimeout(r, WATCH_MS));
    expect([frame.url(), await frame.evaluate(() => location.href)], 'the frame\'s URL is unchanged').toEqual(before);
    expect(await frame.evaluate(() => document.getElementById('seeded')?.textContent), 'and its copy is still there').toBe('Seeded copy');
    expect(navigated, 'no frame navigated').toEqual([]);
    expect(s.popups, 'no tab opened').toHaveLength(0);
    expect(s.external, 'nothing was requested for the link\'s host').toEqual([]);

    // The frame's own navigation (spec section 3.5: `frame-src` falls back to `'none'` under the page's policy). Each tap is on a
    // fresh copy in a session of its own (a tap that navigates the frame would leave the next one nothing to tap), read and logged
    // as it happens; the assertion is at the end of this row, so the measurements after it still run.
    // The no-target tap navigates the frame to Chromium's error page and the page puts its own copy back (D-9029), once and with its
    // sentence; `_top` and `_blank` leave the copy where it was, with no restore. The restore bound has rows of its own below.
    const taps = [
      await selfNavigation('no-target', '', true),
      await selfNavigation('_top', ' target="_top"', false),
      await selfNavigation('_blank', ' target="_blank"', false),
    ];

    // The page's own list: one top-level anchor for the link, which opens a new tab with no Referer.
    const listed = s.page.locator(`.review-links a[href="${href}"]`);
    expect(await listed.count(), 'the page lists the copy\'s link once').toBe(1);
    const popup = s.page.waitForEvent('popup', { timeout: 15_000 });
    await listed.click();
    await popup;
    await expect.poll(() => externalFor(s, href).length, { timeout: 15_000, message: 'the new tab requested the link' }).toBe(1);
    expect(externalFor(s, href)[0]?.headers['referer'], 'the listed link\'s request carries no Referer').toBeUndefined();

    // CONTROL: the same link from a page with the default referrer policy (the shell) carries one, so the capture can see a Referer.
    const controlHref = `${href}?control=1`;
    const shell = await s.ctx.newPage();
    await shell.goto('/');
    await shell.evaluate((h) => {
      const a = document.createElement('a');
      a.href = h;
      a.target = '_blank';
      a.id = 'referer-control';
      a.textContent = 'control';
      document.body.append(a);
    }, controlHref);
    const second = shell.waitForEvent('popup', { timeout: 15_000 });
    await shell.locator('#referer-control').click();
    await second;
    await expect.poll(() => externalFor(s, controlHref).length, { timeout: 15_000, message: 'the control tab requested the link' }).toBe(1);
    expect(externalFor(s, controlHref)[0]?.headers['referer'], 'CONTROL: a link from a default-policy page carries a Referer').toContain(server.origin);

    // CONTROL for the frame's own navigation: the same kind of anchor (no target) in a page with no such policy navigates that page,
    // and the request for it is recorded, so the empty record above is a measurement.
    const controlSelf = 'https://links.example.org/self-nav-control';
    await shell.evaluate((h) => {
      const a = document.createElement('a');
      a.href = h;
      a.id = 'self-nav-control';
      a.textContent = 'control';
      document.body.append(a);
    }, controlSelf);
    await shell.locator('#self-nav-control').click();
    await expect.poll(() => externalFor(s, controlSelf).length, { timeout: 15_000, message: 'the control anchor navigated its page' }).toBe(1);
    for (const t of taps) {
      expect(t.problems, `the ${t.label} self-navigation row: the copy, the top page and the request log read as the page's restore rule says`).toEqual([]);
    }
  }, 120_000);

  // The restore bound (D-9029): at most three restores within any ten seconds. Each row has its own budget, since each polls per tap.
  it('a copy that leaves its frame four times fast (the page\'s clock paused) is restored three times, then left with the stop sentence', async () => {
    const t = await repeatedSelfNavigation();
    expect(t.problems, 'the fast taps read as the restore bound says').toEqual([]);
  }, 120_000);

  it('four taps, the page\'s clock moved 11 seconds before each, are each restored and the copy stays', async () => {
    const t = await spacedSelfNavigation();
    expect(t.problems, 'the spaced taps read as the restore bound says').toEqual([]);
  }, 120_000);
});

// ---- D-9029 measurements: what real copies carry besides the mockup's permalink (R2.3 review round) --------------------------------

/** What one read of the review page and its copy frame found: the frame's URL, whether the seeded copy is in it, the page's restore
 *  count and sentence, and the top page's path. Every field is read afresh, because a restore replaces the frame's document. */
interface Snap {
  readonly frameUrl: string;
  readonly copy: string | null;
  readonly restores: string | null;
  readonly note: string | null;
  readonly top: string;
}

async function snap(t: Session): Promise<Snap> {
  const f = await frameIn(t.page, 'iframe.review-frame');
  await f.waitForSelector('#seeded', { state: 'attached', timeout: 3_000 }).catch(() => undefined);
  const copyText = await f.evaluate(() => document.getElementById('seeded')?.textContent ?? null).catch(() => null);
  return { frameUrl: f.url(), copy: copyText, restores: await restoresOf(t.page), note: await noteOf(t.page), top: new URL(t.page.url()).pathname };
}

const describeSnap = (s: Snap): string =>
  `frame ${s.frameUrl}, copy ${s.copy === 'Seeded copy' ? 'there' : 'gone'}, restores ${JSON.stringify(s.restores)}, sentence ${JSON.stringify(s.note)}`;

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, WATCH_MS));

/** The requests the server saw after `mark`, as `METHOD url`, less the browser's own favicon probe. */
const askedSince = (mark: number): string[] =>
  server.requests.slice(mark).filter((r) => r.url !== '/favicon.ico').map((r) => `${r.method} ${r.url}`);

/** What must hold whatever the engine does on a tap: nothing left the loopback, no tab opened, the top page is still `/review`. */
function mustHold(t: Session, mark: number, snapshot: Snap): void {
  expect(askedSince(mark), 'the tap made no request to the server').toEqual([]);
  expect(t.external, 'the tap reached no other host').toEqual([]);
  expect(t.popups, 'the tap opened no tab').toHaveLength(0);
  expect(snapshot.top, 'the top page did not move').toBe('/review');
}

describe('D-9029 measurements: links of a real copy other than the mockup permalink (Chromium)', () => {
  it('a tap on an in-page fragment link (href="#id", no target)', async () => {
    const t = await session();
    const { frame } = await openDraft(t, copy(
      '<p><a id="jump" href="#far-target">jump</a></p><div style="height:6000px">spacer</div><p id="far-target">far target</p>'));
    await frame.waitForSelector('#far-target', { state: 'attached', timeout: 30_000 });
    const position = (f: Frame): Promise<{ readonly top: number; readonly height: number } | null> =>
      f.evaluate(() => ({ top: Math.round(document.getElementById('far-target')!.getBoundingClientRect().top), height: window.innerHeight }))
        .catch(() => null);
    const before = await position(frame);
    const mark = server.requests.length;
    const navigated: string[] = [];
    t.page.on('framenavigated', (f) => { navigated.push(f.url()); });
    await frame.locator('#jump').click({ timeout: 10_000 });
    await settle();
    const after = await snap(t);
    const afterPosition = await position(await frameIn(t.page, 'iframe.review-frame'));
    const scrolled = before !== null && afterPosition !== null && afterPosition.top < before.top;
    // Recorded as observed, never asserted either way: whether the frame scrolled, and whether a restore happened.
    console.log(`M-X3.16 Chromium ${version}: fragment-link ${describeSnap(after)}; target top before ${JSON.stringify(before)} after ${JSON.stringify(afterPosition)}, scrolled ${scrolled ? 'yes' : 'no'}; frame navigations ${JSON.stringify(navigated)}; requests ${JSON.stringify(askedSince(mark))}; top page ${after.top}`);
    mustHold(t, mark, after);
    expect(after.copy, 'the copy is in the frame afterwards').toBe('Seeded copy');
  }, 120_000);

  it('a footnote reference and its back link, tapped four times fast (href="#fn-1" and href="#fnref-1", no target; the page\'s clock paused)', async () => {
    const t = await session('block', true);
    const { frame } = await openDraft(t, copy(
      '<p>Text<sup><a href="#fn-1" id="fnref-1">1</a></sup></p><div style="height:3000px">spacer</div><ol><li id="fn-1">A note. <a href="#fnref-1" id="fn-back">↩</a></li></ol>'));
    await frame.waitForSelector('#fn-back', { state: 'attached', timeout: 30_000 });
    await pauseClock(t);
    const mark = server.requests.length;
    const steps: string[] = [];
    let last: Snap | null = null;
    for (const [i, selector] of ['#fnref-1', '#fn-back', '#fnref-1', '#fn-back'].entries()) {
      const f = await frameIn(t.page, 'iframe.review-frame');
      let tapped = 'tapped';
      try {
        await f.locator(selector).click({ timeout: 5_000 });
      } catch (e) {
        tapped = `tap failed (${(e as Error).message.split('\n')[0]})`;
      }
      await settle();
      last = await snap(t);
      steps.push(`tap ${i + 1} ${selector} ${tapped}: ${describeSnap(last)}`);
    }
    // Recorded, not asserted: the restore count and sentence after each tap, and whether the fourth tap met the bound.
    console.log(`M-X3.16 Chromium ${version}: footnote-pair ${steps.join('; ')}; after the fourth tap the copy is ${last?.copy === 'Seeded copy' ? 'still there' : 'gone'}; requests ${JSON.stringify(askedSince(mark))}`);
    mustHold(t, mark, last ?? await snap(t));
  }, 120_000);

  it('a tap on a Markdown-arm permalink (https, rel="noopener noreferrer", no target: the shape ExportLink writes)', async () => {
    const href = 'https://github.com/example-org/example-repo/blob/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/docs/x.md';
    const t = await session();
    const { frame } = await openDraft(t, copy(`<p><a id="permalink" href="${href}" rel="noopener noreferrer">x.md</a></p>`));
    await frame.waitForSelector('#permalink', { state: 'attached', timeout: 30_000 });
    const mark = server.requests.length;
    await frame.locator('#permalink').click({ timeout: 10_000 });
    await settle();
    const after = await snap(t);
    console.log(`M-X3.16 Chromium ${version}: markdown-permalink ${describeSnap(after)}; requests ${JSON.stringify(askedSince(mark))}; requests for the link's host ${externalFor(t, href).length}; top page ${after.top}`);
    mustHold(t, mark, after);
    expect(after.copy, 'the copy is back in the frame, as for the mockup permalink').toBe('Seeded copy');
  }, 120_000);

  // A MEASUREMENT OF A NAMED RESIDUAL (R2.3 review, I1): a no-target link tapped before the copy's own `load` fires. The page counts
  // its own draws against the frame's `load` events, so a navigation that lands before the first `load` could read as the draw's own.
  // This row tries to get one click in first, with a copy near the cap so its parse is long, and records what happened. It asserts
  // nothing about the restore: only that no request left and the top page is still `/review`. If no click lands before `load`, it
  // records `tap-before-load: not reached before load` and passes.
  it('tap-before-load: a no-target link tapped before the copy\'s own load (a measurement of a named residual)', async () => {
    const href = 'https://links.example.org/tap-before-load';
    const t = await session();
    const head = '<!doctype html><html><head><meta charset="utf-8"><title>Early tap copy</title></head><body><h1 id="seeded">Seeded copy</h1>';
    const link = `<p><a id="early" href="${href}">early</a></p>`;
    const tail = '<p id="review-last-element">the last element</p></body></html>\n';
    const para = '<p>A plain paragraph of the large snapshot, with words in it so it is text and not padding.</p>\n';
    const count = Math.floor((DOCS_EXPORT_MAX_BYTES - head.length - link.length - tail.length) / para.length);
    const html = head + link + para.repeat(count) + tail;
    expect(Buffer.byteLength(html, 'utf8'), 'the snapshot is within the export cap').toBeLessThanOrEqual(DOCS_EXPORT_MAX_BYTES);
    const tok = token();
    server.seed(tok, { bytes: html, sharedAt: SHARED_AT, version: 1 });
    await t.page.goto(`/review#${tok}`);
    await t.page.getByRole('button', { name: 'Open draft' }).waitFor({ timeout: 30_000 });
    // The test counts the frame element's `load` events from the top page's side, so the row can say whether its click came first.
    await t.page.evaluate(() => {
      const w = window as unknown as { __frameLoads: number };
      w.__frameLoads = 0;
      new MutationObserver((records) => {
        for (const r of records) {
          for (const n of r.addedNodes) {
            if (n instanceof HTMLIFrameElement) n.addEventListener('load', () => { w.__frameLoads += 1; });
          }
        }
      }).observe(document.getElementById('review-root')!, { childList: true, subtree: true });
    });
    const loads = (): Promise<number> => t.page.evaluate(() => (window as unknown as { __frameLoads: number }).__frameLoads);
    await t.page.getByRole('button', { name: 'Open draft' }).click();
    let outcome = 'tap-before-load: not reached before load';
    let mark = server.requests.length;
    try {
      const handle = await t.page.waitForSelector('iframe.review-frame', { state: 'attached', timeout: 60_000 });
      mark = server.requests.length; // the open request is answered once the frame exists
      const early = await handle.contentFrame();
      if (early !== null) {
        await early.waitForSelector('#early', { state: 'attached', timeout: 20_000 });
        await early.evaluate(() => { document.getElementById('early')?.click(); });
        // The click was dispatched before this read, so a count of zero here means it came before any `load` of the frame element.
        const loadsAfterClick = await loads();
        if (loadsAfterClick === 0) outcome = 'tap-before-load: reached before load';
        else outcome += ` (the frame element had fired ${loadsAfterClick} load(s) by then)`;
      }
    } catch (e) {
      outcome += ` (${(e as Error).message.split('\n')[0]})`;
    }
    await new Promise((r) => setTimeout(r, WATCH_MS * 2));
    const after = await snap(t);
    console.log(`M-X3.16 Chromium ${version}: ${outcome}; ${describeSnap(after)}; frame loads ${await loads()}; requests ${JSON.stringify(askedSince(mark))}; requests for the link's host ${externalFor(t, href).length}; top page ${after.top}`);
    mustHold(t, mark, after);
  }, 180_000);
});

// ---- the harness's read door -------------------------------------------------------------------------------------------------

describe('the harness read door answers the real door\'s 404', () => {
  it('answers the L0 body and the open headers for no marker, an unknown token and a body that is not JSON', async () => {
    const good = token();
    server.seed(good, { bytes: '<p>x</p>', sharedAt: SHARED_AT, version: 1 });
    const post = (headers: Record<string, string>, body: string): Promise<Response> =>
      fetch(`${server.origin}/api/review/open`, { method: 'POST', headers, body });
    const marker = { [REVIEW_MARKER_HEADER]: REVIEW_MARKER_VALUE };
    // CONTROL: the marker, JSON and a seeded token answer 200, so the three refusals below are the door's answers, not a dead route.
    const ok = await post({ ...marker, 'content-type': 'application/json' }, JSON.stringify({ token: good }));
    expect(ok.status, 'CONTROL: a seeded token with the marker and JSON opens').toBe(200);
    await ok.arrayBuffer();
    const refusals: Array<[string, Response]> = [
      ['no marker', await post({ 'content-type': 'application/json' }, JSON.stringify({ token: good }))],
      ['an unknown token', await post({ ...marker, 'content-type': 'application/json' }, JSON.stringify({ token: token() }))],
      ['a body that is not application/json', await post({ ...marker, 'content-type': 'text/plain' }, JSON.stringify({ token: good }))],
    ];
    for (const [name, res] of refusals) {
      expect(res.status, `${name}: 404`).toBe(404);
      expect(await res.text(), `${name}: the L0 body`).toBe(JSON.stringify(REVIEW_NOT_FOUND));
      expect(res.headers.get('content-type'), `${name}: JSON`).toBe('application/json; charset=utf-8');
      for (const [header, value] of Object.entries(REVIEW_OPEN_HEADERS)) expect(res.headers.get(header), `${name}: ${header}`).toBe(value);
    }
  }, 60_000);
});

// ---- installed PWA ------------------------------------------------------------------------------------------------------------

describe('installed PWA does not answer /review (Review Focus)', () => {
  it('with the built service worker controlling the page, a navigation to /review reaches the server and carries the page\'s policy', async () => {
    const s = await session('allow');
    await s.page.goto('/');
    // The worker registers, activates and takes the page (autoUpdate claims), or after `ready` a reload puts the page under it.
    // Each wait has its own bound, well under the test's, and names itself: a worker that never installs fails here, not as the
    // test's own timeout.
    await s.page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 15_000 }).catch(async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const limit = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new Error('the built service worker was not installed and active within 20s (navigator.serviceWorker.ready)')); }, 20_000);
      });
      try {
        await Promise.race([s.page.evaluate(() => navigator.serviceWorker.ready.then(() => true)), limit]);
      } finally {
        clearTimeout(timer);
      }
      await s.page.reload({ waitUntil: 'load', timeout: 15_000 });
      await s.page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 15_000 })
        .catch(() => { throw new Error('the built service worker is active but did not control the page after a reload within 15s'); });
    });
    expect(await s.page.evaluate(() => navigator.serviceWorker.controller !== null), 'the built worker controls the page').toBe(true);
    expect(s.ctx.serviceWorkers().length, 'Playwright sees the worker').toBeGreaterThan(0);

    const documentNavigations = (from: number, url: string): ReviewRecord[] =>
      server.requests.slice(from).filter((r) => r.url === url && r.headers['sec-fetch-mode'] === 'navigate');

    // CONTROL: a navigation to a shell route is answered by the worker, and no navigation for it reaches the server. So the row
    // can see a worker answer; were `/review` on the worker's list, it would read the same way.
    const mark = server.requests.length;
    const shell = await s.page.goto('/settings');
    expect(shell?.fromServiceWorker(), 'CONTROL: the worker answered /settings').toBe(true);
    expect(await s.page.title(), 'CONTROL: with the shell').toBe('ccrc');
    expect(documentNavigations(mark, '/settings'), 'CONTROL: the server saw no navigation for /settings').toEqual([]);

    // The row: `/review`, bare and with a link tracker's query, reaches the server and is answered under the page's policy.
    for (const url of ['/review', '/review?utm_source=newsletter']) {
      const from = server.requests.length;
      const resp = await s.page.goto(url);
      expect(resp?.fromServiceWorker(), `${url} was not answered by the worker`).toBe(false);
      expect(documentNavigations(from, url).map((r) => [r.method, r.answer]), `the server recorded the navigation to ${url}`).toEqual([['GET', 'review-page']]);
      expect(resp?.headers()['content-security-policy'], `${url} carries the page's policy`).toBe(REVIEW_PAGE_CSP);
      expect(resp?.headers()['cache-control'], `${url} is never cached`).toBe('no-store');
      const html = await resp!.text();
      expect(html, `${url} is the review page`).toContain('<title>Draft for review</title>');
      expect(html, `${url} is not the shell`).not.toContain('<div id="root">');
      expect(await s.page.title()).toBe('Draft for review');
    }
  }, 120_000);
});
