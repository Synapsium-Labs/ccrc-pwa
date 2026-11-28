// The Docs reader's five layouts, in a real Chrome over the production build (native Docs parity, X2 Task P5.1, spec 2026-11-18 4.2,
// D-8762; acceptance row AR-2), and reader mode's layout rule measured at 412 by 915 (reader-mode plan, XR1.1 Step 0, D-8975).
//
// One row per layout (default, classic, editorial, review, guided) per width (412 by 915, 1280 by 800, 1920 by 1080), the layout chosen
// the way a user chooses it: the device's choice, stored under the library's prefs key before the page loads (`SEED`); the Layout row
// in Page details, where the head draws one (`ROW`); and the visit's `?variant=` with a standalone name (`VARIANT`, one row a width).
// Each row says:
//   - the frame reaches ready, in the layout asked for (the frame's root names a non-default layout; the default has no name);
//   - nothing scrolls sideways, in the console's page or in the frame;
//   - at 412 the head is the one bar and keeps its budgets (`docsHeadBudgets.ts`: the console's part above the frame, the title's top,
//     the bar one tap tall, every control a tap); at 1280 and 1920 the head is the full head, at most `HEAD_MAX` tall;
//   - the contents are reachable: ccrc's Contents on a phone's bar, the frame's own Contents control or its rail at a desk, each a list
//     of the document's headings;
//   - ccrc's appearance is applied, in a light palette and in a dark one: the frame's root carries the host's colours (read as
//     `reader-appearance.browser.test.ts` reads them) and reads the colour scheme the host reads.
// Then the shipped layout rule's rows (`default-only:`; `READER_LAYOUT_RULE` is `default-only`, the coordinator's ruling of 2026-11-28,
// after entering reader mode from `review` at 412 by 915 measured a worst of 2353 ms over five runs, over lab E4's 1.4 s): outside the
// default layout no Reader mode action is drawn and the note shows (beside the Layout select at 412 by 915; a line under the head's row at
// 1280 by 800, where the head has no Layout control: D-9180), with the head's budgets kept; and choosing Default (the Layout select, or
// the command palette at a desk) offers Reader mode, which then reads in the default layout.
// The measuring rows of the earlier rule (`layout-rule:`, Step 0: at 412 by 915, entering reader mode from `review` and from `guided` and
// leaving, five runs each, the time from the tap to the default layout's frame `ready` against lab E4's 1.4 s, the one bar's budgets after
// the return, and that no figure is drawn without a request; one `console.log('layout-rule: …')` line a run) can only run against a build
// whose rule is `remount`, so they run only with `CCRC_MEASURE_REMOUNT=1` set (a quiet-device re-measure at acceptance).
//
// A harness of its own, as `reader-mode.browser.test.ts` has: the production build served from loopback, `/api/docs` answering one leaf
// from fixtures, the leaf opened inside the console. Every row opens its own context, so no row leaves a stored choice to the next.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts
// browser/reader-layouts.browser.test.ts )`, through `ccrc test`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Frame, type Page } from 'playwright-core';
import { SKINS } from '@ccrc/ui';
import { APPEARANCE_SLOTS } from '@synapsium-labs/pinax-lib/frame';
import { DOC_SECTION_SLUGS, DOCS_RESPONSE_HEADERS, READER_LAYOUTS, docsLayoutVariant, type ReaderLayout } from '../../shared/docs';
import { DOCS_TOOL_TEXT } from '../src/docs/docsText';
import { READER_LAYOUT_TEXT, READER_MODE_TEXT, readerLayoutCommandTitle } from '../src/docs/reader/readerModeWords';
import { READER_APPEARANCE_MAP } from '../src/docs/reader/appearance';
import { READER_STORE_PREFIX } from '../src/lib/readerLimits';
import { COMMIT_A, entry, treeOk, treeResponse } from '../test/docsFixtures';
import { openApp, serveDist, sharedDist, type DistServer, type OpenedApp } from './app';
import { CONSOLE_PART_MAX, HEAD_MAX, ONE_BAR_TITLE_MAX_BY_LAYOUT, TAP } from './docsHeadBudgets';
import { resolveChrome } from './harness';

const SECTION = DOC_SECTION_SLUGS[0]!;
const NAME = '2026-11-27-layouts-proof-design.md';
const TITLE = 'Layouts proof';
const SECTIONS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'].map((n) => `The ${n} section`);
const BLOB = 'e'.repeat(40);
/** A document with an h1 and six h2 sections: the library builds its contents only for an h1 and more than two h2, and the one bar's
 *  Contents has something to open only then. No figure, so a Render control never stands in the way of a measure. */
const DOC = `# ${TITLE}\n\nA path names one document at one ref, so a link means the same thing on every checkout.\n\n`
  + SECTIONS.map((s, i) => `## ${s}\n\n${Array.from({ length: 6 }, (_, j) => `Paragraph ${i * 6 + j + 1} of the body, long enough to wrap on a phone's width.`).join('\n\n')}\n`).join('\n');
/** The same document with one Mermaid fence, for the layout rule's "no figure is drawn without a request". */
const FIGURE_DOC = DOC.replace('checkout.\n\n', 'checkout.\n\n```mermaid\nflowchart LR\n  A[path] --> B[ref]\n```\n\n');

interface View { readonly width: number; readonly height: number }
const PHONE: View = { width: 412, height: 915 };
const VIEWS: readonly View[] = [PHONE, { width: 1280, height: 800 }, { width: 1920, height: 1080 }];
const FULL_HEAD_MIN = 600;
/** The library's prefs object under the reader's storage prefix: the key the device's layout lives in (`reader/layoutPref.ts`), spelled out
 *  from the one prefix so this file imports no console module that boots a store. */
const PREFS_KEY = `${READER_STORE_PREFIX}pref:prefs`;
/** A light palette and a dark one, ids of the design system's catalogue. */
const LIGHT = 'light';
const DARK = 'phosphor';

let browser: Browser;
let server: DistServer;
let dist: string;
beforeAll(async () => {
  dist = sharedDist();
  server = await serveDist(dist);
  browser = await chromium.launch({ executablePath: resolveChrome(), headless: true });
}, 180_000);
afterAll(async () => { await browser?.close(); await server?.close(); });

interface OpenOpts {
  readonly view: View;
  readonly layout?: ReaderLayout;
  /** The visit's standalone name (`?variant=`). */
  readonly variant?: string;
  readonly theme?: string;
  readonly text?: string;
}

/** The leaf open inside the console with the reader up. One re-open on the reader's start watchdog falling back (D-7958), as
 *  `docs-compact-head.browser.test.ts` does. A stored layout is written before the page's first script, by the top document only. */
async function open(o: OpenOpts): Promise<OpenedApp> {
  const text = o.text ?? DOC;
  const size = Buffer.byteLength(text);
  const tree = treeOk({ entries: [entry(SECTION, NAME, { committed: { kind: 'file', blob: BLOB, size } })] });
  const app = await openApp(browser, { width: o.view.width, skin: SKINS[0]!.id, theme: o.theme ?? LIGHT, tab: 'console' }, { api: {}, fleetFrames: [] });
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
  if (o.layout !== undefined) {
    await app.ctx.addInitScript(([key, value]) => {
      if (window !== window.top) return;
      try { localStorage.setItem(key, value); } catch { /* no storage: the row then reads the default and says so */ }
    }, [PREFS_KEY, JSON.stringify({ layout: o.layout })] as const);
  }
  const url = `${server.origin}/docs/demo/${SECTION}/${NAME}${o.variant === undefined ? '' : `?variant=${o.variant}`}`;
  const start = async (): Promise<string> => {
    await app.page.goto(url, { waitUntil: 'load' });
    const up = await app.page.waitForFunction(() => {
      if (document.querySelector('.doc-plain-note') !== null) return 'fallback';
      return document.querySelector('.docs-reader iframe') !== null && document.querySelector('.doc-formatting') === null ? 'ready' : null;
    }, undefined, { timeout: 90_000, polling: 100 });
    return (await up.jsonValue()) as string;
  };
  let outcome = await start();
  if (outcome === 'fallback') {
    console.warn(`layouts: the reader's start watchdog fell back at ${o.view.width}x${o.view.height}; opening the leaf once more (D-7958)`);
    outcome = await start();
  }
  if (outcome !== 'ready') throw new Error(`the reader did not come up: ${outcome}`);
  await frameOf(app.page).then((f) => f.waitForFunction(() => document.querySelector('[data-docreader-root]') !== null, undefined, { timeout: 60_000 }));
  return app;
}

async function frameOf(page: Page): Promise<Frame> {
  const frame = await (await page.locator('.docs-reader iframe').last().elementHandle())?.contentFrame();
  if (!frame) throw new Error('reader frame absent');
  return frame;
}

/** The layout the frame's root names: a non-default layout sets `data-docreader-layout`, the default sets none. */
const layoutOf = (frame: Frame): Promise<string> =>
  frame.evaluate(() => document.querySelector('[data-docreader-root]')?.getAttribute('data-docreader-layout') ?? 'default');

/** What the reader's frame is, as the page and the frame say it: its layout (the root's name, the default has none), whether the root has a
 *  reading in force (`data-reading`), and whether the host holds it under the reading ground (`data-reader-hold` on `.docs-reader`) or still
 *  shows "Formatting". The frame is sandboxed with no `allow-same-origin`, so its document is read through Playwright's frame, never
 *  `contentDocument`; a remount swaps one iframe for another, so a poll that finds none (or one still loading) answers `null`. */
interface FrameState { readonly layout: string; readonly reading: boolean; readonly held: boolean; readonly formatting: boolean; readonly readerMode: boolean }
async function stateOf(page: Page): Promise<FrameState | null> {
  try {
    const frame = await frameOf(page);
    const inner = await frame.evaluate(() => {
      const root = document.querySelector('[data-docreader-root]');
      return root === null ? null : { layout: root.getAttribute('data-docreader-layout') ?? 'default', reading: root.hasAttribute('data-reading') };
    });
    if (inner === null) return null;
    const outer = await page.evaluate(() => ({
      held: document.querySelector('.docs-reader')?.hasAttribute('data-reader-hold') === true,
      formatting: document.querySelector('.doc-formatting') !== null,
      readerMode: document.querySelector('.docs-reading')?.hasAttribute('data-reader-mode') === true,
    }));
    return { ...inner, ...outer };
  } catch (e) {
    lastStateError = e instanceof Error ? e.message.split('\n')[0]! : String(e);
    return null;
  }
}
/** Why the last `stateOf` answered null by throwing (a frame that was swapped out mid-read), for a stuck wait's message. */
let lastStateError = '';

/** What the page shows when a wait is stuck: the reader mode attribute, how many frames stand, the fallback note and the hold. */
const stuckOf = (page: Page): Promise<unknown> => page.evaluate(() => ({
  mode: document.querySelector('.docs-reading')?.getAttribute('data-reader-mode') ?? null,
  frames: document.querySelectorAll('.docs-reader iframe').length,
  note: document.querySelector('.doc-plain-note')?.textContent ?? null,
  hold: document.querySelector('.docs-reader')?.hasAttribute('data-reader-hold') ?? null,
  formatting: document.querySelector('.doc-formatting') !== null,
  fullscreen: document.fullscreenElement !== null,
})).catch((e: unknown) => `page unreadable: ${String(e)}`);

/** Polls `stateOf` on the test side every `stepMs` until `ok` holds, and answers the test-side time (`performance.now`) at which it first
 *  did. Throws with the last state when `ms` pass. */
async function settled(page: Page, ok: (s: FrameState) => boolean, what: string, ms = 60_000, stepMs = 20): Promise<number> {
  const until = Date.now() + ms;
  let last: FrameState | null = null;
  for (;;) {
    last = await stateOf(page);
    if (last !== null && ok(last)) return performance.now();
    if (Date.now() > until) {
      throw new Error(`${what}: not reached in ${ms} ms (last state ${JSON.stringify(last)}; last read error ${JSON.stringify(lastStateError)}; page ${JSON.stringify(await stuckOf(page))})`);
    }
    await page.waitForTimeout(stepMs);
  }
}

/** Waits until the frame is in `layout` and shown (a remount swaps one frame for another, so the root names it only once the new one is
 *  in), and answers it. */
async function inLayout(page: Page, layout: ReaderLayout): Promise<Frame> {
  await settled(page, (s) => s.layout === layout && !s.formatting && !s.held, `the frame in the ${layout} layout`, 60_000, 50);
  return frameOf(page);
}

const sideScroll = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const frameSideScroll = (frame: Frame): Promise<number> =>
  frame.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

interface OneBar {
  readonly head: string;
  readonly screenTop: number; readonly frameTop: number; readonly titleInFrame: number; readonly above: number; readonly frameBar: boolean;
  readonly bar: { readonly h: number; readonly divider: string } | null;
  readonly buttons: readonly { readonly name: string; readonly w: number; readonly h: number }[];
  readonly headHeight: number;
}

/** The head as the Docs head budgets read it (`docs-compact-head.browser.test.ts`'s `measure`, with the bar's own box and controls). */
async function headOf(page: Page, frame: Frame): Promise<OneBar> {
  const outer = await page.evaluate(async () => {
    await document.fonts.ready;
    const top = (sel: string): number => document.querySelector(sel)?.getBoundingClientRect().top ?? Number.NaN;
    const head = document.querySelector('.docs-head');
    const kind = head === null ? 'none' : head.classList.contains('docs-one-bar') ? 'one-bar' : head.classList.contains('docs-compact') ? 'compact' : 'full';
    const barEl = document.querySelector('.docs-one-bar .docs-compact-bar');
    const bar = barEl === null ? null : { h: barEl.getBoundingClientRect().height, divider: getComputedStyle(barEl).borderBottomWidth };
    const buttons = [...(barEl?.querySelectorAll('button') ?? [])].map((b) => {
      const r = b.getBoundingClientRect();
      return { name: b.classList.contains('docs-title') ? 'title' : b.getAttribute('aria-label') ?? b.textContent ?? '', w: r.width, h: r.height };
    });
    return { head: kind, screenTop: top('.docs-screen'), frameTop: top('.docs-reader iframe'), bar, buttons, headHeight: head?.getBoundingClientRect().height ?? Number.NaN };
  });
  const inner = await frame.evaluate(async (title) => {
    await document.fonts.ready;
    const tops = [...document.querySelectorAll('h1')].filter((h) => h.textContent?.trim() === title).map((h) => h.getBoundingClientRect().top);
    return { tops, frameBar: document.querySelector('.topbar') !== null };
  }, TITLE);
  if (inner.tops.length === 0) throw new Error(`no h1 in the frame reads ${TITLE}`);
  const titleInFrame = Math.max(...inner.tops);
  return { ...outer, titleInFrame, above: outer.frameTop + titleInFrame, frameBar: inner.frameBar };
}

/** Opens the contents as the layout's width offers them and answers the list's link texts: on a phone, ccrc's own Contents button on the
 *  one bar (the frame's own is off); at a desk, the frame's Contents control when it is drawn, else the rail that is already open. */
async function contentsOf(page: Page, frame: Frame, view: View): Promise<{ via: string; headings: string[]; visible: number }> {
  let via: string;
  if (view.width < FULL_HEAD_MIN) {
    await page.getByRole('button', { name: DOCS_TOOL_TEXT.contents, exact: true }).click();
    via = 'ccrc Contents';
  } else {
    const own = frame.locator('.toc-btn');
    if (await own.isVisible()) { await own.click(); via = 'frame Contents'; } else via = 'rail';
  }
  await frame.waitForFunction(() => {
    const toc = document.querySelector<HTMLElement>('.doc-toc');
    return toc !== null && toc.querySelectorAll('a[href^="#"]').length > 0 && toc.getBoundingClientRect().width > 0;
  }, undefined, { timeout: 15_000 });
  const read = await frame.evaluate(() => {
    const links = [...document.querySelectorAll<HTMLAnchorElement>('.doc-toc a[href^="#"]')];
    const shown = links.filter((a) => { const r = a.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(a).visibility !== 'hidden'; });
    return { headings: links.map((a) => (a.textContent ?? '').trim()), visible: shown.length };
  });
  return { via, ...read };
}

/** The host's colours as the browser resolves each token (opaque sRGB, six-digit lower-case hex) and the scheme it reads, and the frame
 *  root's own: what `reader-appearance.browser.test.ts`'s `hostAppearanceValues` and `assertAppearance` compare, over the colour slots. */
async function appearanceOf(page: Page, frame: Frame): Promise<{ host: { scheme: string; colour: Record<string, string> }; inner: { scheme: string; colour: Record<string, string>; inline: Record<string, string> } }> {
  const host = await page.evaluate((map) => {
    const cs = getComputedStyle(document.documentElement);
    const probe = document.createElement('span');
    probe.hidden = true;
    document.body.append(probe);
    try {
      const colour = Object.fromEntries(Object.entries(map.colour).map(([slot, token]) => {
        const raw = cs.getPropertyValue(token);
        if (!CSS.supports('color', raw)) throw new Error(`unresolved host colour ${token}: ${raw}`);
        probe.style.color = raw;
        const rgb = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(getComputedStyle(probe).color);
        if (!rgb) throw new Error(`expected an opaque sRGB host colour for ${token}`);
        return [slot, `#${rgb.slice(1).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`];
      }));
      return { scheme: cs.colorScheme, colour };
    } finally { probe.remove(); }
  }, READER_APPEARANCE_MAP);
  const inner = await frame.evaluate((colours) => {
    const root = document.querySelector<HTMLElement>('[data-docreader-root]');
    if (!root) throw new Error('reader root absent');
    const cs = getComputedStyle(root);
    return {
      scheme: cs.colorScheme,
      colour: Object.fromEntries(colours.map((slot) => [slot, cs.getPropertyValue(`--${slot}`).trim().toLowerCase()])),
      inline: Object.fromEntries(colours.map((slot) => [slot, root.style.getPropertyValue(`--${slot}`).trim()])),
    };
  }, APPEARANCE_SLOTS.colour);
  return { host, inner };
}

/** Closes a row's context whatever happens, and asks that the page threw nothing. */
async function using(app: OpenedApp, row: () => Promise<void>): Promise<void> {
  try {
    await row();
    expect(app.errors, 'no uncaught error').toEqual([]);
  } finally {
    await app.ctx.close();
  }
}

/** Opens Page details (the compact row's `button.docs-more`, or the one bar's title) and answers the Layout row's select, or null. */
async function layoutSelectOf(page: Page): Promise<ReturnType<Page['locator']> | null> {
  const select = page.getByRole('combobox', { name: READER_LAYOUT_TEXT.label, exact: true });
  if (await select.count() > 0) return select;
  const opener = page.locator('.docs-head button.docs-more, .docs-head button.docs-title').first();
  if (await opener.count() === 0) return null;
  if ((await opener.getAttribute('aria-expanded')) !== 'true') await opener.click();
  await select.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
  return await select.count() > 0 ? select : null;
}

const NAMES = READER_LAYOUT_TEXT.names;

/** Chooses `layout` from the command palette, the desk's way (D-9180): focus leaves the frame (inside it Ctrl+K is the reader's own
 *  jump), the palette opens, the layout's command is searched by its title and picked, and the palette closes. */
async function chooseFromPalette(page: Page, layout: ReaderLayout): Promise<void> {
  const title = readerLayoutCommandTitle(layout);
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); });
  await page.keyboard.press('Control+k');
  const input = page.getByRole('combobox', { name: 'Command palette' });
  await input.waitFor({ timeout: 10_000 });
  await input.fill(title);
  // The palette also offers "Find runs matching '<query>'" for any query, which holds the title inside its own words: not a command.
  const option = page.getByRole('option').filter({ hasText: title }).filter({ hasNotText: 'Find runs matching' });
  await option.first().waitFor({ timeout: 10_000 });
  expect(await option.count(), `the palette lists one command titled ${title}`).toBe(1);
  await option.first().click();
  await input.waitFor({ state: 'detached', timeout: 10_000 });
}

/** Chooses `layout` the way the width offers it: the Layout row in Page details on a phone, the command palette at a desk. */
async function chooseLayout(page: Page, view: View, layout: ReaderLayout): Promise<void> {
  if (view.width >= FULL_HEAD_MIN) { await chooseFromPalette(page, layout); return; }
  const select = await layoutSelectOf(page);
  expect(select, `${view.width}x${view.height}: the Layout select`).not.toBeNull();
  await select!.selectOption({ label: NAMES[layout] });
}

describe('layouts: each layout at each width, chosen by the stored device choice', () => {
  for (const view of VIEWS) {
    for (const layout of READER_LAYOUTS) {
      it(`layouts: ${layout} at ${view.width}x${view.height}: ready in the layout, no sideways scroll, the head's budgets, the contents reachable`, async () => {
        const app = await open({ view, layout });
        await using(app, async () => {
          const { page } = app;
          const frame = await inLayout(page, layout);
          expect(await layoutOf(frame), 'the frame is in the layout the device chose').toBe(layout);
          expect(await sideScroll(page), 'the console\'s page scrolls sideways').toBeLessThanOrEqual(0);
          expect(await frameSideScroll(frame), 'the frame scrolls sideways').toBeLessThanOrEqual(0);
          const head = await headOf(page, frame);
          const phone = view.width < FULL_HEAD_MIN;
          console.log(`layouts: figure ${layout} ${view.width}x${view.height} ${JSON.stringify({ ...head, buttons: head.buttons.map((b) => `${b.name} ${b.w.toFixed(0)}x${b.h.toFixed(0)}`) })}`);
          if (phone) {
            expect(head.head, 'the head is the one bar').toBe('one-bar');
            expect(head.screenTop, 'nothing of the console draws above the Docs screen').toBe(0);
            expect(head.frameTop - head.screenTop, 'the bar and the gap under it').toBeLessThanOrEqual(CONSOLE_PART_MAX);
            expect(head.frameBar, 'the frame draws no bar of its own').toBe(false);
            expect(head.bar, 'the bar is drawn').not.toBeNull();
            expect(head.bar!.h, 'the bar is one tap tall, its divider inside').toBeLessThanOrEqual(TAP + 0.5);
            expect(head.bar!.h, 'the bar is a whole tap tall').toBeGreaterThanOrEqual(TAP - 0.5);
            for (const b of head.buttons) {
              expect(b.w, `${b.name} is at least a tap wide`).toBeGreaterThanOrEqual(TAP);
              expect(b.h, `${b.name} is at least a tap tall`).toBeGreaterThanOrEqual(TAP);
            }
          } else {
            expect(head.head, 'a desk draws the full head').toBe('full');
            // The whole head: with the rule's note (outside the default layout) it is one note line taller (`DESK_NOTE_LINE_MAX`, D-9180).
            expect(head.headHeight, 'the head at a desk').toBeLessThanOrEqual(HEAD_MAX + (layout === 'default' ? 0 : DESK_NOTE_LINE_MAX));
          }
          const toc = await contentsOf(page, frame, view);
          console.log(`layouts: figure ${layout} ${view.width}x${view.height} contents ${JSON.stringify(toc)}`);
          for (const section of SECTIONS) expect(toc.headings, `the contents list names "${section}"`).toContain(section);
          expect(toc.visible, 'the contents list is drawn').toBeGreaterThanOrEqual(SECTIONS.length);
          expect(await sideScroll(page), 'opening the contents scrolled the page sideways').toBeLessThanOrEqual(0);
          expect(await frameSideScroll(frame), 'opening the contents scrolled the frame sideways').toBeLessThanOrEqual(0);
        });
      }, 180_000);

      // Its own row, so a layout whose own title block sits lower than the one bar's budget is named alone and hides no other figure.
      // The budget is the layout's own (`ONE_BAR_TITLE_MAX_BY_LAYOUT`, D-9177); the console's part and the bar are the same in every layout,
      // so each row asserts them unchanged beside it.
      it.runIf(view.width < FULL_HEAD_MIN)(`layouts: ${layout} at ${view.width}x${view.height}: the title's top is at most ${ONE_BAR_TITLE_MAX_BY_LAYOUT[layout]} px below the page (D-9177), the console's part and the bar unchanged`, async () => {
        const app = await open({ view, layout });
        await using(app, async () => {
          const frame = await inLayout(app.page, layout);
          const head = await headOf(app.page, frame);
          console.log(`layouts: figure ${layout} ${view.width}x${view.height} title ${JSON.stringify({ above: head.above, frameTop: head.frameTop, titleInFrame: head.titleInFrame, max: ONE_BAR_TITLE_MAX_BY_LAYOUT[layout] })}`);
          expect(head.above, `px above the title in the ${layout} layout`).toBeLessThanOrEqual(ONE_BAR_TITLE_MAX_BY_LAYOUT[layout]);
          expect(head.head, 'the head is the one bar').toBe('one-bar');
          expect(head.frameTop - head.screenTop, 'the console\'s part: the bar and the gap under it').toBeLessThanOrEqual(CONSOLE_PART_MAX);
          expect(head.bar, 'the bar is drawn').not.toBeNull();
          expect(head.bar!.h, 'the bar is one tap tall').toBeLessThanOrEqual(TAP + 0.5);
          expect(head.bar!.h, 'the bar is a whole tap tall').toBeGreaterThanOrEqual(TAP - 0.5);
        });
      }, 180_000);

      it(`layouts: ${layout} at ${view.width}x${view.height}: ccrc's appearance is applied, in a light palette and in a dark one`, async () => {
        for (const theme of [LIGHT, DARK]) {
          const app = await open({ view, layout, theme });
          await using(app, async () => {
            const { page } = app;
            const frame = await inLayout(page, layout);
            const { host, inner } = await appearanceOf(page, frame);
            console.log(`layouts: figure ${layout} ${view.width}x${view.height} ${theme} ${JSON.stringify({ scheme: inner.scheme, surface: inner.colour['surface'], ink: inner.colour['ink'] })}`);
            expect(inner.colour, `${theme}: the frame's root carries the host's colours`).toEqual(host.colour);
            expect(inner.scheme, `${theme}: and reads the host's colour scheme`).toBe(host.scheme);
            for (const slot of APPEARANCE_SLOTS.colour) expect(inner.inline[slot], `${theme}: ${slot} is set on the root`).not.toBe('');
            expect(host.scheme, `${theme}: CONTROL, the palette drew its own mode`).toBe(theme === DARK ? 'dark' : 'light');
            expect(await frameSideScroll(frame), `${theme}: the frame scrolls sideways`).toBeLessThanOrEqual(0);
          });
        }
      }, 240_000);
    }
  }
});

describe('layouts: chosen by the visit\'s ?variant= (a standalone name)', () => {
  // The five standalone names, each to its layout (`DOCS_VARIANT_LAYOUT`), one row per width: `B` and `classic` and the others
  // together, so each name is read in a real page at least once and each width reads one.
  const NAMES_BY_WIDTH: readonly (readonly [View, ReaderLayout])[] = [[PHONE, 'review'], [VIEWS[1]!, 'editorial'], [VIEWS[2]!, 'guided']];
  for (const [view, layout] of NAMES_BY_WIDTH) {
    const variant = docsLayoutVariant(layout);
    it(`layouts: ?variant=${variant} (${layout}) at ${view.width}x${view.height}: the frame is in the layout, and no stored choice was written`, async () => {
      const app = await open({ view, variant });
      await using(app, async () => {
        const { page } = app;
        const frame = await inLayout(page, layout);
        expect(await layoutOf(frame), 'the frame is in the visit\'s layout').toBe(layout);
        expect(await sideScroll(page)).toBeLessThanOrEqual(0);
        expect(await frameSideScroll(frame)).toBeLessThanOrEqual(0);
        const stored = await page.evaluate((k) => localStorage.getItem(k), PREFS_KEY);
        const storedLayout = stored === null ? null : (JSON.parse(stored) as { layout?: unknown }).layout ?? null;
        console.log(`layouts: figure ?variant=${variant} ${view.width}x${view.height} ${JSON.stringify({ layout: await layoutOf(frame), stored })}`);
        expect(storedLayout, 'a visit\'s variant is never the device\'s choice').toBeNull();
        if (view.width < FULL_HEAD_MIN) expect(await page.locator('.docs-head.docs-one-bar').count(), 'the one bar').toBe(1);
      });
    }, 180_000);
  }

  it('layouts: ?variant=classic and ?variant=AB at 1280x800 name classic and the default; an unknown name opens the device\'s layout', async () => {
    const view = VIEWS[1]!;
    for (const [variant, layout] of [['classic', 'classic'], ['AB', 'default'], ['nope', 'review']] as const) {
      // `nope` names nothing: the visit falls back to the device's own choice, here review.
      const app = await open({ view, variant, ...(variant === 'nope' ? { layout: 'review' as const } : {}) });
      await using(app, async () => {
        const frame = await inLayout(app.page, layout);
        expect(await layoutOf(frame), `?variant=${variant}`).toBe(layout);
      });
    }
  }, 240_000);
});

describe('layouts: chosen through the Layout row in Page details', () => {
  // Each row opens the leaf in the default layout, opens Page details, and picks a layout in the Layout row: the frame is mounted in it,
  // the choice is the device's (stored), and it is the layout of the next load. At 412 the Layout row is Page details' own; the desk
  // (1280 and 1920) has none (D-9180) and chooses from the command palette, its rows below.
  for (const view of VIEWS.filter((v) => v.width < FULL_HEAD_MIN)) {
    for (const layout of READER_LAYOUTS.filter((l) => l !== 'default')) {
      it(`layouts: the Layout row picks ${layout} at ${view.width}x${view.height}, and the choice is kept for the next load`, async () => {
        const app = await open({ view });
        await using(app, async () => {
          const { page } = app;
          const select = await layoutSelectOf(page);
          console.log(`layouts: figure row ${layout} ${view.width}x${view.height} ${JSON.stringify({ drawn: select !== null })}`);
          expect(select, 'Page details draws the Layout row beside a ready reader').not.toBeNull();
          expect(await select!.inputValue(), 'the row holds the layout the frame is in').toBe('default');
          expect((await select!.locator('option').allTextContents()), 'the row offers the five layouts, default first').toEqual(READER_LAYOUTS.map((l) => NAMES[l]));
          await select!.selectOption({ label: NAMES[layout] });
          const frame = await inLayout(page, layout);
          expect(await layoutOf(frame)).toBe(layout);
          expect(await sideScroll(page)).toBeLessThanOrEqual(0);
          expect(await frameSideScroll(frame)).toBeLessThanOrEqual(0);
          const stored = await page.evaluate((k) => localStorage.getItem(k), PREFS_KEY);
          expect((JSON.parse(stored ?? '{}') as { layout?: unknown }).layout, 'the choice is stored for the device').toBe(layout);
          await page.reload({ waitUntil: 'load' });
          const after = await inLayout(page, layout);
          expect(await layoutOf(after), 'the next load opens in the stored layout').toBe(layout);
        });
      }, 240_000);
    }
  }

  // The desk's head has no Layout control (D-9180): its row is crowded at its widths. The desk widths choose through the command palette,
  // one command per layout (one row, for `guided`, at 1280 by 800); the desk head's budgets are held in every layout (below).
  it('layouts: a palette Layout pick at 1280x800 is kept for the next load', async () => {
    const view = VIEWS[1]!;
    const app = await open({ view });
    await using(app, async () => {
      const { page } = app;
      expect(await page.getByRole('combobox', { name: READER_LAYOUT_TEXT.label, exact: true }).count(), 'the desk draws a Layout select').toBe(0);
      await chooseFromPalette(page, 'guided');
      const frame = await inLayout(page, 'guided');
      expect(await layoutOf(frame)).toBe('guided');
      expect(await sideScroll(page)).toBeLessThanOrEqual(0);
      expect(await frameSideScroll(frame)).toBeLessThanOrEqual(0);
      const stored = await page.evaluate((k) => localStorage.getItem(k), PREFS_KEY);
      expect((JSON.parse(stored ?? '{}') as { layout?: unknown }).layout, 'the choice is stored for the device').toBe('guided');
      await page.reload({ waitUntil: 'load' });
      const after = await inLayout(page, 'guided');
      expect(await layoutOf(after), 'the next load opens in the stored layout').toBe('guided');
    });
  }, 240_000);
});

/** One line of the desk's layout note, in px (D-9180): the note is `.docs-note`, `--text-sm` over `--leading-normal`, a line of its own
 *  under the head's row, and its box is 19.5 px tall at 1280 by 800 and at 1920 by 1080 in every layout outside the default (measured,
 *  one text line, 4 px under the truth line), so the head with it is 99.5 px. Rounded up to 20, so a note that wraps to a second line
 *  (39 px; a longer sentence, a narrower column) reds here. */
const DESK_NOTE_LINE_MAX = 20;

/** The desk head as the budgets read it (`docs-compact-head.browser.test.ts`'s `deskFigure`, with the rule's note): the controls'
 *  midlines against the Back control's, the row's height, the head from its top to the truth line's bottom (`head`) and to the bottom
 *  of the head's last note (`headAll`), the note's own box and lines, whether any Layout select is drawn in the head, and what scrolls
 *  sideways. */
interface DeskFigure {
  readonly head: number; readonly headAll: number; readonly rowH: number; readonly backMid: number;
  readonly mids: readonly { readonly name: string; readonly mid: number; readonly w: number; readonly left: number }[];
  readonly select: boolean;
  readonly note: { readonly text: string; readonly inRow: boolean; readonly inHead: boolean; readonly h: number; readonly lines: number } | null;
  readonly readerAction: boolean;
  readonly actions: readonly string[];
  readonly scrollW: number; readonly innerW: number;
}
async function deskFigureOf(page: Page, expectNote: boolean): Promise<DeskFigure> {
  await page.locator('.docs-full .docs-head-bar .docs-actions button').first().waitFor({ state: 'visible', timeout: 30_000 });
  if (expectNote) await page.locator('.docs-full > p.docs-note[data-layout-note]').waitFor({ state: 'visible', timeout: 30_000 });
  return page.evaluate(async (enterName) => {
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const head = document.querySelector('.docs-head.docs-full')!;
    const row = head.querySelector(':scope > .docs-head-bar')!;
    const truth = head.querySelector(':scope > .docs-truth')!;
    const mid = (e: Element): number => { const r = e.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
    const shown = (e: Element | null): boolean => e !== null && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0;
    const noteEl = head.querySelector('p.docs-note[data-layout-note]');
    const lines = (e: Element): number => {
      const range = document.createRange();
      range.selectNodeContents(e);
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
    };
    const top = head.getBoundingClientRect().top;
    const truthBottom = truth.getBoundingClientRect().bottom;
    return {
      head: truthBottom - top,
      headAll: Math.max(truthBottom, noteEl?.getBoundingClientRect().bottom ?? 0) - top,
      rowH: row.getBoundingClientRect().height,
      backMid: mid(row.querySelector('.docs-back')!),
      mids: [...row.querySelectorAll('button, a, select, label, p.docs-note')].filter((e) => shown(e)).map((c) => {
        const b = c.getBoundingClientRect();
        return { name: c.getAttribute('aria-label') ?? (c.textContent ?? '').slice(0, 40), mid: mid(c), w: Math.round(b.width * 10) / 10, left: Math.round(b.left * 10) / 10 };
      }),
      select: head.querySelector('select, .docs-layout-row') !== null,
      note: noteEl === null ? null : {
        text: noteEl.textContent ?? '', inRow: row.contains(noteEl), inHead: noteEl.parentElement === head,
        h: noteEl.getBoundingClientRect().height, lines: lines(noteEl),
      },
      readerAction: [...row.querySelectorAll('button')].some((b) => shown(b) && b.getAttribute('aria-label') === enterName),
      actions: [...row.querySelectorAll(':scope > .docs-actions > a, :scope > .docs-actions > button')].map((c) => c.getAttribute('aria-label') ?? c.className),
      scrollW: document.documentElement.scrollWidth, innerW: innerWidth,
    };
  }, READER_MODE_TEXT.enter);
}

/** The desk head's budgets (D-9180): no Layout control in the head, the actions row on one line one tap tall, no sideways scroll, and the
 *  head at most `HEAD_MAX` with no note, at most `HEAD_MAX` plus one note line with it. `withNote`: the layout rule's note stands (under
 *  `default-only`, outside the default layout): its own line under the row, in the desk's words, one line of text. */
function expectDeskBudgets(f: DeskFigure, where: string, withNote: boolean): void {
  expect(f.select, `${where}: a Layout control is drawn in the desk head`).toBe(false);
  for (const c of f.mids) expect(Math.abs(c.mid - f.backMid), `${where}: ${c.name} on the row's line`).toBeLessThanOrEqual(1);
  expect(f.rowH, `${where}: the row is one line, one tap tall`).toBeLessThanOrEqual(TAP + 0.5);
  expect(f.head, `${where}: the head, from its top to the bottom of the truth line`).toBeLessThanOrEqual(HEAD_MAX);
  if (withNote) {
    expect(f.note, `${where}: the note`).not.toBeNull();
    expect(f.note!.text, `${where}: the note's words`).toBe(READER_LAYOUT_TEXT.deskNote);
    expect(f.note!.inRow, `${where}: the note is inside the actions row`).toBe(false);
    expect(f.note!.inHead, `${where}: the note is a line of the head, beside the Print note and the update note`).toBe(true);
    expect(f.note!.lines, `${where}: the note is one line of text`).toBe(1);
    expect(f.note!.h, `${where}: the note is one line tall`).toBeLessThanOrEqual(DESK_NOTE_LINE_MAX);
    expect(f.headAll, `${where}: the head with its note`).toBeLessThanOrEqual(HEAD_MAX + DESK_NOTE_LINE_MAX);
  } else {
    expect(f.note, `${where}: a note in the default layout`).toBeNull();
    expect(f.headAll, `${where}: the head with no note`).toBeLessThanOrEqual(HEAD_MAX);
  }
  expect(f.scrollW, `${where}: no sideways scroll`).toBeLessThanOrEqual(f.innerW);
}

describe('layouts: the desk head has no Layout control, and its layout note is a line of its own (D-9180)', () => {
  for (const view of VIEWS.filter((v) => v.width >= FULL_HEAD_MIN)) {
    for (const layout of READER_LAYOUTS) {
      it(`layouts: the desk head at ${view.width}x${view.height} in ${layout}: the actions row on one line, the head at most HEAD_MAX with no note, at most HEAD_MAX plus one note line with it`, async () => {
        const app = await open({ view, layout });
        await using(app, async () => {
          const { page } = app;
          await inLayout(page, layout);
          const f = await deskFigureOf(page, layout !== 'default');
          console.log(`layouts: figure desk ${layout} ${view.width}x${view.height} ${JSON.stringify(f)}`);
          expectDeskBudgets(f, `${layout} at ${view.width}x${view.height}`, layout !== 'default');
        });
      }, 180_000);
    }
  }
});

// ---- the shipped layout rule, `default-only` (the coordinator's ruling of 2026-11-28) ------------------------------------------------
// Reader mode is offered in the default layout alone. In another layout no Reader mode action is drawn (the one bar draws none, the desk
// row draws none), and a note says why (beside the Layout select in Page details; a line under the desk head's row, in the desk's words,
// which name the palette command); Default, chosen in the select or from the palette, offers Reader mode again, and entering reads in
// the default layout (the frame is in it already: nothing remounts).

const OTHER_LAYOUTS = READER_LAYOUTS.filter((l) => l !== 'default');
const RULE_VIEWS: readonly View[] = [PHONE, VIEWS[1]!];

/** How many Reader mode actions the page draws: the one bar's control or the desk row's action, by their name. */
const readerActions = (page: Page): Promise<number> => page.getByRole('button', { name: READER_MODE_TEXT.enter, exact: true }).count();

describe('default-only: reader mode is offered in the default layout alone', () => {
  for (const layout of OTHER_LAYOUTS) {
    it(`default-only: in ${layout} at 412x915 and 1280x800, no Reader mode action is drawn, the note shows beside the Layout select, and the one bar or the desk head keeps its budgets`, async () => {
      for (const view of RULE_VIEWS) {
        const where = `${layout} at ${view.width}x${view.height}`;
        const app = await open({ view, layout });
        await using(app, async () => {
          const { page } = app;
          const frame = await inLayout(page, layout);
          expect(await readerActions(page), `${where}: a Reader mode action is drawn`).toBe(0);
          if (view.width < FULL_HEAD_MIN) {
            const head = await headOf(page, frame);
            console.log(`default-only: figure ${where} ${JSON.stringify({ head: head.head, above: head.above, part: head.frameTop - head.screenTop, bar: head.bar?.h, buttons: head.buttons.map((b) => `${b.name} ${b.w.toFixed(0)}x${b.h.toFixed(0)}`) })}`);
            expect(head.head, `${where}: the head is the one bar`).toBe('one-bar');
            expect(head.frameTop - head.screenTop, `${where}: the console's part`).toBeLessThanOrEqual(CONSOLE_PART_MAX);
            expect(head.above, `${where}: the title's top`).toBeLessThanOrEqual(ONE_BAR_TITLE_MAX_BY_LAYOUT[layout]);
            expect(head.bar!.h, `${where}: the bar is one tap tall`).toBeLessThanOrEqual(TAP + 0.5);
            expect(head.bar!.h, `${where}: and a whole tap`).toBeGreaterThanOrEqual(TAP - 0.5);
            for (const b of head.buttons) {
              expect(b.w, `${where}: ${b.name} is a tap wide`).toBeGreaterThanOrEqual(TAP);
              expect(b.h, `${where}: ${b.name} is a tap tall`).toBeGreaterThanOrEqual(TAP);
            }
            // The Layout select and its note are Page details': opened after the bar's budgets are read.
            const select = await layoutSelectOf(page);
            expect(select, `${where}: Page details draws the Layout select`).not.toBeNull();
            expect(await select!.inputValue()).toBe(layout);
            const noteId = await select!.getAttribute('aria-describedby');
            expect(noteId, `${where}: the select names its note`).not.toBeNull();
            const note = page.locator(`[id="${noteId}"]`);
            expect(await note.textContent(), `${where}: the note`).toBe(READER_LAYOUT_TEXT.note);
            expect(await note.isVisible(), `${where}: the note is drawn`).toBe(true);
            expect(await note.evaluate((n, id) => n.closest('.docs-layout-row')?.querySelector('select')?.getAttribute('aria-describedby') === id, noteId), `${where}: the note is beside the select`).toBe(true);
            expect(await readerActions(page), `${where}: Page details drew a Reader mode action`).toBe(0);
          } else {
            const f = await deskFigureOf(page, true);
            console.log(`default-only: figure ${where} ${JSON.stringify(f)}`);
            expect(f.readerAction, `${where}: the desk row draws Reader mode`).toBe(false);
            expect(f.note?.text, `${where}: the note says which palette command gives the default layout back`).toBe(READER_LAYOUT_TEXT.deskNote);
            expectDeskBudgets(f, where, true);
          }
          expect(await sideScroll(page), `${where}: the page scrolls sideways`).toBeLessThanOrEqual(0);
          expect(await frameSideScroll(frame), `${where}: the frame scrolls sideways`).toBeLessThanOrEqual(0);
        });
      }
    }, 360_000);
  }

  it('default-only: choosing Default in the Layout select offers Reader mode, and entering reads in default (412x915 and 1280x800)', async () => {
    for (const view of RULE_VIEWS) {
      const where = `${view.width}x${view.height}`;
      const app = await open({ view, layout: 'review' });
      await using(app, async () => {
        const { page } = app;
        await inLayout(page, 'review');
        expect(await readerActions(page), `${where}: CONTROL: no action in review`).toBe(0);
        await chooseLayout(page, view, 'default');
        const frame = await inLayout(page, 'default');
        expect(await layoutOf(frame)).toBe('default');
        const action = page.getByRole('button', { name: READER_MODE_TEXT.enter, exact: true }).first();
        await action.waitFor({ state: 'visible', timeout: 30_000 });
        expect(await page.getByText(READER_LAYOUT_TEXT.note, { exact: true }).count(), `${where}: the note is gone once Default is chosen`).toBe(0);
        expect(await page.getByText(READER_LAYOUT_TEXT.deskNote, { exact: true }).count(), `${where}: the desk's note is gone once Default is chosen`).toBe(0);
        await action.click();
        const ready = await settled(page, (s) => s.layout === 'default' && s.reading && s.readerMode && !s.held && !s.formatting, `${where}: reader mode on in the default layout`, 30_000);
        console.log(`default-only: figure ${where} entered in default at ${ready.toFixed(0)}`);
        expect(await layoutOf(await frameOf(page)), `${where}: reader mode reads in default`).toBe('default');
        expect(await sideScroll(page), `${where}: the page scrolls sideways`).toBeLessThanOrEqual(0);
      });
    }
  }, 360_000);
});

// ---- the layout rule `remount`, measured (reader-mode plan XR1.1 Step 0, spec 4.3, D-8975) -------------------------------------------
// OPT-IN: these rows enter reader mode from another layout, which only a build whose `READER_LAYOUT_RULE` is `remount` offers, and the
// shipped rule is `default-only` (the rows above). They run only with `CCRC_MEASURE_REMOUNT=1`, against such a build (a quiet-device
// re-measure at acceptance, which may restore `remount`).
// At 412 by 915 the reader is on ccrc's bar (a host-bar mount). Entering reader mode from `review` or `guided` mounts the document again
// in the default layout, and leaving mounts the reader's own layout back. The rule stays `remount`
// only when each of these holds, in every run: the time from the tap on Reader mode to the default layout's frame `ready` is the
// figure the plan sets against lab E4's 1.4 s (printed per run, never asserted as a pass: the plan's Results record it); after leaving, the
// one bar keeps `TAP` and `CONSOLE_PART_MAX` and holds the title where the layout had it before the entry, and the layout's own title
// budget (`ONE_BAR_TITLE_MAX_BY_LAYOUT`, its own row, below); and no figure is drawn that was not asked for. A red there means the rule
// is `default-only`, and the constant is the plan's to change, not this file's.

const MEASURE_REMOUNT = process.env['CCRC_MEASURE_REMOUNT'] === '1';
const RUNS = 5;
const E4_MS = 1400;
/** The reading, per run, for the plan's Results. */
interface RuleRun {
  readonly from: ReaderLayout; readonly run: number; readonly enterToReadyMs: number; readonly leaveToReadyMs: number;
  /** The title's top below the page, before entering and after the return. */
  readonly aboveBefore: number; readonly aboveAfter: number;
}
const ruleRuns: RuleRun[] = [];

async function figuresOf(frame: Frame): Promise<string[]> {
  return frame.evaluate(() => [...document.querySelectorAll('figure.mermaid-figure')].map((f) => `${f.getAttribute('data-docreader-draw')}:${f.querySelectorAll('svg').length}`));
}

describe.runIf(MEASURE_REMOUNT)('layout-rule: reader mode from another layout at 412x915 (opt-in: CCRC_MEASURE_REMOUNT=1, a build whose rule is remount)', () => {
  for (const from of ['review', 'guided'] as const) {
    it(`layout-rule: entering reader mode from ${from} remounts in default (${RUNS} runs), leaving restores ${from}, the one bar keeps its budgets, no figure is drawn without a request`, async () => {
      for (let run = 1; run <= RUNS; run += 1) {
        const app = await open({ view: PHONE, layout: from, text: FIGURE_DOC });
        await using(app, async () => {
          const { page } = app;
          const before = await inLayout(page, from);
          const figuresBefore = await figuresOf(before);
          expect(figuresBefore, `run ${run}: the fence is on request before anything is asked`).toEqual(['on-request:0']);
          const stored = await page.evaluate((k) => localStorage.getItem(k), PREFS_KEY);
          // The one bar as the layout draws it before anything is entered: what the return is held against (the title block of `review` and
          // `guided` sits lower than the default's whatever the rule is, so the budget alone cannot say the remount moved it).
          const headBefore = await headOf(page, before);
          // Enter: from the tap's dispatch (the test side's clock) to the default layout's frame ready and shown: the new frame's root has no
          // layout name and carries the reading, and the host's hold under the reading ground is lifted (it lifts two animation frames
          // after the frame's `ready`, so the figure includes those). The poll is 20 ms apart, so a figure is good to about that.
          const entered = performance.now();
          await page.getByRole('button', { name: READER_MODE_TEXT.enter, exact: true }).first().click();
          const ready = await settled(page, (s) => s.layout === 'default' && s.reading && s.readerMode && !s.held && !s.formatting, `run ${run}: the default layout's frame ready`, 30_000);
          const inReader = await frameOf(page);
          const enterToReadyMs = ready - entered;
          expect(await layoutOf(inReader), `run ${run}: reader mode reads in the default layout`).toBe('default');
          expect(await figuresOf(inReader), `run ${run}: no figure is drawn in reader mode without a request`).toEqual(['on-request:0']);
          // Leave: the overlay's Exit, then the reader's own layout back, ready.
          await page.mouse.click(PHONE.width / 2, 20);
          await page.locator('.docs-reading-bottom').waitFor({ timeout: 10_000 });
          const left = performance.now();
          await page.locator('.docs-reading-exit').click();
          const back = await settled(page, (s) => s.layout === from && !s.readerMode && !s.held && !s.formatting, `run ${run}: ${from} restored`, 30_000);
          const leaveToReadyMs = back - left;
          const after = await frameOf(page);
          // The one bar's budgets after the return.
          const head = await headOf(page, after);
          ruleRuns.push({ from, run, enterToReadyMs, leaveToReadyMs, aboveBefore: headBefore.above, aboveAfter: head.above });
          console.log(`layout-rule: ${from} 412x915 run ${run}/${RUNS}: enter to ready ${enterToReadyMs.toFixed(0)} ms (lab E4 ${E4_MS} ms: ${enterToReadyMs <= E4_MS ? 'under' : 'OVER'}), leave to ready ${leaveToReadyMs.toFixed(0)} ms`);
          expect(await layoutOf(after), `run ${run}: leaving restored ${from}`).toBe(from);
          expect(await page.evaluate((k) => localStorage.getItem(k), PREFS_KEY), `run ${run}: reader mode wrote the stored layout`).toBe(stored);
          console.log(`layout-rule: ${from} 412x915 run ${run}/${RUNS}: one bar after the return ${JSON.stringify({ head: head.head, console: head.frameTop - head.screenTop, titleTop: head.above, titleTopBefore: headBefore.above, bar: head.bar?.h, taps: head.buttons.map((b) => `${b.name} ${b.w.toFixed(0)}x${b.h.toFixed(0)}`) })}`);
          expect(head.head, `run ${run}: the head is the one bar again`).toBe('one-bar');
          expect(head.frameTop - head.screenTop, `run ${run}: CONSOLE_PART_MAX`).toBeLessThanOrEqual(CONSOLE_PART_MAX);
          expect(Math.abs(head.above - headBefore.above), `run ${run}: the return left the title where the layout had it (${headBefore.above} before, ${head.above} after)`).toBeLessThanOrEqual(1);
          expect(head.bar!.h, `run ${run}: the bar is one tap tall`).toBeLessThanOrEqual(TAP + 0.5);
          expect(head.bar!.h, `run ${run}: and a whole tap`).toBeGreaterThanOrEqual(TAP - 0.5);
          for (const b of head.buttons) {
            expect(b.w, `run ${run}: ${b.name} is a tap wide`).toBeGreaterThanOrEqual(TAP);
            expect(b.h, `run ${run}: ${b.name} is a tap tall`).toBeGreaterThanOrEqual(TAP);
          }
          expect(await figuresOf(after), `run ${run}: no figure is drawn after the return without a request`).toEqual(['on-request:0']);
          expect(await sideScroll(page), `run ${run}: the page scrolls sideways`).toBeLessThanOrEqual(0);
        });
      }
      const mine = ruleRuns.filter((r) => r.from === from);
      const worst = Math.max(...mine.map((r) => r.enterToReadyMs));
      console.log(`layout-rule: ${from} 412x915 summary: ${mine.length} runs, enter to ready ${mine.map((r) => r.enterToReadyMs.toFixed(0)).join(', ')} ms, worst ${worst.toFixed(0)} ms against lab E4 ${E4_MS} ms (${worst <= E4_MS ? 'under' : 'OVER'}); leave to ready worst ${Math.max(...mine.map((r) => r.leaveToReadyMs)).toFixed(0)} ms`);
      expect(mine, 'every run was recorded').toHaveLength(RUNS);
    }, 900_000);
  }

  // The literal Step 0 criterion, on the figures the rows above recorded (they run first, in this order): after the return the one bar's
  // title is within the layout's own `ONE_BAR_TITLE_MAX_BY_LAYOUT` entry. It is its own row because it is the one criterion a layout can
  // break without the remount moving anything. A red here is the plan's "any breaks", and the rule's constant is the plan's to set
  // (`default-only`), never this file's.
  for (const from of ['review', 'guided'] as const) {
    const max = ONE_BAR_TITLE_MAX_BY_LAYOUT[from];
    it(`layout-rule: after the return to ${from} the one bar's title is within ONE_BAR_TITLE_MAX_BY_LAYOUT (${max} px)`, () => {
      const mine = ruleRuns.filter((r) => r.from === from);
      expect(mine, 'the rows above recorded the runs').toHaveLength(RUNS);
      const worst = Math.max(...mine.map((r) => r.aboveAfter));
      console.log(`layout-rule: ${from} 412x915 title after the return: ${mine.map((r) => r.aboveAfter.toFixed(1)).join(', ')} px (before entering ${mine.map((r) => r.aboveBefore.toFixed(1)).join(', ')}), budget ${max}: ${worst <= max ? 'holds' : 'BREAKS'}`);
      expect(worst, `the title's top below the page after the return to ${from}`).toBeLessThanOrEqual(max);
    });
  }
});
