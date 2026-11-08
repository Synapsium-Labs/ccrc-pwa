// The Docs reader's compact phone head, measured in a real Chrome over the production build (native Docs reader, the
// phone-header plan of 2026-11-03, refinements (a), (b), (d), (i)). The operator's phone, a Pixel 10 Pro XL in Chrome on
// Android, has a CSS viewport of about 412 x 915; on it 311.5 px sat above a reader doc's title (measured at the base:
// the console's part 234.5 and the reader frame's own top 77), and the mockup the operator picked (one console row)
// draws 133. So, at 412 x 915 with the reader up:
//   - the head is the compact row, and the console's part above the frame (the row and the gap under it) is at most
//     CONSOLE_PART_MAX px, in either skin;
//   - in Refined, the phone's skin, the title's top is at most PHONE_TITLE_MAX px below the top of the page;
//   - every control on the row is at least one tap (44 x 44), and the row, the mockup's 1 px divider inside it, is one
//     tap tall (its border box, as getBoundingClientRect reads it);
//   - on a draft leaf of a ref view with a long branch name, the ref is cut and the draft badge is whole, inside the label;
//   - on a leaf under a 46-character directory in a ref view, the ref still has room on the first line (the directory
//     gives way first), and the badge is inside the label;
//   - Page details opens the truth line under the row, and Escape closes it with focus back on the button.
// At 599 the head is still the row; at 600 and wider it is the full head, which desk-nav Part B (D-8101) makes one row
// (back, the crumbs, the actions) over one dense truth line: the title's figure and the head's height at 1280 under a
// mouse, the row on one line, the crumbs giving way before any action's words, the words hidden under the container
// query with each action keeping its name, no sideways scroll, and a touch laptop (1280 x 800 and a phone turned
// sideways, 915 x 412) keeping the 44 px floor. Every case prints its figures on a `PHH-FIGURE` line for the plan's
// Results.
//
// The figure is the iframe's top in the page plus the doc title's top inside the frame (Playwright's frame evaluation),
// at the frame's scroll 0, once the reader is up ("Formatting…" gone, no fallback note) and both documents' fonts have
// loaded. The title is the LOWEST `h1` reading TITLE, so a heading the reader may draw in its own bar never stands in for
// it. No server, no ccd: `/api/docs` answers one leaf from fixtures, as reader-frame.browser.test.ts's sessions do.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config
// vitest.browser.config.ts browser/docs-compact-head.browser.test.ts )`, through `ccrc test`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import { DOC_SECTION_SLUGS, DOCS_RESPONSE_HEADERS } from '../../shared/docs';
import { DOCS_HEAD_TEXT } from '../src/docs/docsText';
import { READER_FALLBACK_NOTE } from '../src/docs/reader/readerText';
import { COMMIT_A, draftOf, entry, holder, treeOk, treeResponse } from '../test/docsFixtures';
import { openApp, serveDist, sharedDist, type DistServer, type OpenedApp } from './app';
import { resolveChrome } from './harness';

const PROJECT = 'demo';
const SECTION = DOC_SECTION_SLUGS[0]!;
const NAME = '2026-10-20-path-identity-design.md';
const TITLE = 'Path identity design';
const BLOB = 'c'.repeat(40);
const DOC = `# ${TITLE}\n\nA path names one document at one ref, so a link means the same thing on every checkout.\n\n`
  + Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1} of the body, long enough to wrap on a phone's width.`).join('\n\n')
  + '\n';
const SIZE = Buffer.byteLength(DOC, 'utf8');
/** A branch name long enough to overflow the label's first line at 412 px. */
const LONG_BRANCH = 'ws/a-long-workspace-branch-for-the-phone-header';

/** A parent directory as long as this repository's own plan directories run (46 characters), so the row's first line
 *  holds the directory and nothing else unless the ref is given its own room. */
const LONG_DIR = '2026-10-27-one-long-directory-name-for-the-row';

/** The picked mockup's figure is 133 px above the title. The console's part, its row and the gap under it, is 48 (44 + 4),
 *  and CONSOLE_PART_MAX is the binding pin. The reader frame's own top (its body margin, its bar and the gap under the
 *  bar) measured 77: the shared reader library's, so not ccrc's to pin. The title therefore sits at 125, with 8 px of
 *  slack under 133, kept so that a 1 px change in the library does not red a ccrc test. */
const PHONE_TITLE_MAX = 133;
const CONSOLE_PART_MAX = 48;
/** The floor every control on the row reaches (`--tap-min`). */
const TAP = 44;
const PHONE = { width: 412, height: 915 } as const;

let dist: string | undefined;
let server: DistServer | undefined;
let browser: Browser | undefined;

beforeAll(async () => {
  const executablePath = resolveChrome(); // throws on a box with no Chrome: red, never skipped
  dist = sharedDist();
  server = await serveDist(dist);
  browser = await chromium.launch({ executablePath, headless: true });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

const JSON_TYPE = 'application/json; charset=utf-8';
const bodyOf = (value: unknown): Buffer => Buffer.from(JSON.stringify(value), 'utf8');

/** The one committed leaf on origin's default branch. */
const COMMITTED_TREE = treeOk({ entries: [entry(SECTION, NAME, { committed: { kind: 'file', blob: BLOB, size: SIZE } })] });

/** The same leaf in a ref view of a long local branch, with a draft over it held by that branch's checkout. */
function draftTree(leaf = NAME): ReturnType<typeof treeOk> {
  const base = treeOk({
    entries: [entry(SECTION, leaf, { committed: { kind: 'file', blob: BLOB, size: SIZE }, draft: draftOf('modified') })],
    drafts: { ...holder(), branch: LONG_BRANCH },
  });
  return {
    ...base,
    ref: { ...base.ref, requested: LONG_BRANCH, served: `refs/heads/${LONG_BRANCH}`, name: LONG_BRANCH, side: 'local', via: 'local' },
  };
}

/** `/api/docs/demo/tree` answers `tree` and `/api/docs/demo/file` the leaf's Markdown; any other `/api/docs` request (a
 *  refresh) answers 204. Routed after `openApp`'s own `/api` route, so this one answers first. */
async function answerDocs(app: OpenedApp, tree = COMMITTED_TREE, leaf = NAME): Promise<void> {
  await app.ctx.route((u) => u.pathname.startsWith('/api/docs/'), async (route) => {
    const req = route.request();
    if (req.method() !== 'GET') {
      await route.fulfill({ status: 204 });
      return;
    }
    const headers = { ...DOCS_RESPONSE_HEADERS, 'content-type': JSON_TYPE };
    if (new URL(req.url()).pathname.endsWith('/tree')) {
      await route.fulfill({ status: 200, headers, body: bodyOf(treeResponse(tree)) });
      return;
    }
    const show = {
      v: 1, verb: 'docs-show', ok: true, elapsedMs: 3, source: 'committed', section: SECTION, path: leaf, size: SIZE,
      sha256: BLOB.padEnd(64, '0'), encoding: 'utf8', text: DOC, commit: COMMIT_A, blob: BLOB, onRef: 'contains',
    };
    await route.fulfill({ status: 200, headers, body: bodyOf({ ok: true, contentClass: 'markdown', from: 'ccd', show }) });
  });
}

interface View {
  readonly width: number; readonly height: number; readonly skin: string; readonly touch?: boolean;
  /** `fine`: a mouse at any width (the context opens at a desk width, with no touch, and is then resized). */
  readonly pointer?: 'fine';
}

/** A context at `view` (a touch screen below 900 px, or when `touch` asks; a mouse when `pointer` is `fine`), its
 *  `/api/docs` answering `tree`. */
async function openView(view: View, tree = COMMITTED_TREE, leaf = NAME): Promise<OpenedApp> {
  const opened = view.pointer === 'fine' ? Math.max(view.width, 900) : view.width;
  const app = await openApp(browser!, { width: opened, skin: view.skin, theme: 'light', touch: view.touch }, { api: {}, fleetFrames: [] });
  await app.page.setViewportSize({ width: view.width, height: view.height });
  await answerDocs(app, tree, leaf);
  return app;
}

/** A context at `view` with the leaf open and the reader up. Throws when the reader fell back to the plain view or never
 *  came up: the figure is about the reader page. One re-open on a fallback, D-7958: the reader's start watchdog (2 s for a
 *  small document) can pass on a loaded runner, so a `fallback` re-navigates the same page once, and says so on the
 *  console; a second `fallback`, a timeout and every other outcome throw as before. */
async function openLeaf(view: View, tree = COMMITTED_TREE, leaf = NAME): Promise<OpenedApp> {
  const app = await openView(view, tree, leaf);
  const url = `${server!.origin}/docs/${PROJECT}/${SECTION}/${leaf}`;
  const start = async (): Promise<unknown> => {
    await app.page.goto(url, { waitUntil: 'load' });
    const up = await app.page.waitForFunction((note) => {
      if ([...document.querySelectorAll('.doc-plain-note')].some((n) => n.textContent === note)) return 'fallback';
      return document.querySelector('.docs-reader iframe') !== null && document.querySelector('.doc-formatting') === null ? 'ready' : null;
    }, READER_FALLBACK_NOTE, { timeout: 90_000, polling: 100 });
    return up.jsonValue();
  };
  let outcome = await start();
  if (outcome === 'fallback') {
    console.warn(`PHH-RETRY ${view.skin} ${view.width}x${view.height}: the reader's start watchdog fell back; opening the leaf once more (D-7958)`);
    outcome = await start();
  }
  if (outcome !== 'ready') throw new Error(`the reader did not come up: ${String(outcome)}`);
  return app;
}

interface Figure {
  readonly head: 'compact' | 'full';
  /** `.docs-screen`'s top in the page. */
  readonly screenTop: number;
  /** The reader iframe's top in the page. */
  readonly frameTop: number;
  /** The doc title's top inside the frame. */
  readonly titleInFrame: number;
  /** The frame's own scroll offset when the title was read (0 expected). */
  readonly frameScroll: number;
  /** px above the title: `frameTop + titleInFrame`. */
  readonly above: number;
}

async function measure(page: Page): Promise<Figure> {
  const outer = await page.evaluate(async () => {
    await document.fonts.ready;
    const top = (sel: string): number => document.querySelector(sel)?.getBoundingClientRect().top ?? Number.NaN;
    const head: 'compact' | 'full' = document.querySelector('.docs-head.docs-compact') === null ? 'full' : 'compact';
    return { head, screenTop: top('.docs-screen'), frameTop: top('.docs-reader iframe') };
  });
  const handle = await page.locator('.docs-reader iframe').elementHandle({ timeout: 30_000 });
  const frame = await handle?.contentFrame();
  if (frame === null || frame === undefined) throw new Error('the reader iframe has no content frame');
  const inner = await frame.evaluate(async (title) => {
    await document.fonts.ready;
    const tops = [...document.querySelectorAll('h1')]
      .filter((h) => h.textContent?.trim() === title)
      .map((h) => h.getBoundingClientRect().top);
    return { tops, scroll: window.scrollY };
  }, TITLE);
  if (inner.tops.length === 0) throw new Error(`no h1 in the frame reads ${TITLE}`);
  const titleInFrame = Math.max(...inner.tops);
  return { ...outer, titleInFrame, frameScroll: inner.scroll, above: outer.frameTop + titleInFrame };
}

/** Opens the leaf at `view`, runs `check`, asks that the page threw nothing, and closes the context whatever happens. */
async function at(view: View, check: (app: OpenedApp) => Promise<void>, tree = COMMITTED_TREE, leaf = NAME): Promise<void> {
  const app = await openLeaf(view, tree, leaf);
  try {
    await check(app);
    expect(app.errors, 'no page error').toEqual([]);
  } finally {
    await app.ctx.close();
  }
}

describe('a phone draws one console row above the reader (refinements (a), (i))', () => {
  it(`412 x 915, Refined: the title is at most ${PHONE_TITLE_MAX} px down, ${CONSOLE_PART_MAX} of them the console's`, async () => {
    await at({ ...PHONE, skin: REFINED }, async ({ page }) => {
      const f = await measure(page);
      console.log(`PHH-FIGURE refined 412x915 ${JSON.stringify(f)}`);
      expect(f.head).toBe('compact');
      expect(f.screenTop, 'nothing of the console draws above the Docs screen').toBe(0);
      expect(f.frameScroll, 'the frame is at its top').toBe(0);
      expect(f.frameTop - f.screenTop, 'the row and the gap under it').toBeLessThanOrEqual(CONSOLE_PART_MAX);
      expect(f.above, 'px above the title').toBeLessThanOrEqual(PHONE_TITLE_MAX);
    });
  }, 120_000);

  it(`412 x 915, Instrument: the same row, and at most ${CONSOLE_PART_MAX} px of the console above the frame`, async () => {
    await at({ ...PHONE, skin: INSTRUMENT }, async ({ page }) => {
      const f = await measure(page);
      console.log(`PHH-FIGURE instrument 412x915 ${JSON.stringify(f)}`);
      expect(f.head).toBe('compact');
      expect(f.frameTop - f.screenTop, 'the row and the gap under it').toBeLessThanOrEqual(CONSOLE_PART_MAX);
    });
  }, 120_000);

  it('599 x 915: still the row (the compact width ends at 600)', async () => {
    await at({ width: 599, height: 915, skin: REFINED }, async ({ page }) => {
      const f = await measure(page);
      console.log(`PHH-FIGURE refined 599x915 ${JSON.stringify(f)}`);
      expect(f.head).toBe('compact');
    });
  }, 120_000);

  it('412 x 915: back, Share, Export and Page details, each at least one tap, on a row one tap tall', async () => {
    await at({ ...PHONE, skin: REFINED }, async ({ page }) => {
      const row = await page.evaluate(() => {
        const bar = document.querySelector('.docs-compact-bar');
        if (bar === null) return null;
        const box = (e: Element): { w: number; h: number } => {
          const r = e.getBoundingClientRect();
          return { w: r.width, h: r.height };
        };
        return {
          bar: box(bar),
          divider: getComputedStyle(bar).borderBottomWidth,
          buttons: [...bar.querySelectorAll('button')].map((b) => ({ name: b.getAttribute('aria-label') ?? '', ...box(b) })),
          lines: [...bar.querySelectorAll('.docs-compact-where, .docs-compact-name')].map((e) => box(e).h),
        };
      });
      console.log(`PHH-FIGURE refined 412x915 row ${JSON.stringify(row)}`);
      expect(row, 'the compact row is drawn').not.toBeNull();
      const r = row!;
      expect(r.buttons.map((b) => b.name).slice(0, 3)).toEqual([DOCS_HEAD_TEXT.back, DOCS_HEAD_TEXT.share, DOCS_HEAD_TEXT.exportPlainView]);
      expect(r.buttons[3]?.name).toMatch(/^Page details/);
      expect(r.buttons).toHaveLength(4);
      for (const b of r.buttons) {
        expect(b.w, b.name).toBeGreaterThanOrEqual(TAP);
        expect(b.h, b.name).toBeGreaterThanOrEqual(TAP);
      }
      expect(r.bar.h, 'the row is one tap tall, its divider inside').toBeLessThanOrEqual(TAP + 0.5);
      expect(r.bar.h, 'the row is a whole tap tall').toBeGreaterThanOrEqual(TAP - 0.5);
      expect(r.divider, 'the mockup\'s 1 px divider').toBe('1px');
      expect(r.lines.reduce((s, h) => s + h, 0), 'the label\'s two lines fit the row').toBeLessThanOrEqual(TAP);
    });
  }, 120_000);

  it('412 x 915: a draft in a ref view of a long branch; the ref is cut, the draft badge is whole and inside the label (refinement (g))', async () => {
    const app = await openView({ ...PHONE, skin: REFINED }, draftTree());
    try {
      await app.page.goto(`${server!.origin}/docs/${PROJECT}/${SECTION}/${NAME}?ref=${LONG_BRANCH}`, { waitUntil: 'load' });
      await app.page.waitForFunction(() => document.querySelector('.docs-compact-where .docs-badge') !== null, undefined, { timeout: 30_000 });
      const got = await app.page.evaluate(() => {
        const rect = (sel: string): { left: number; right: number; top: number; mid: number } | null => {
          const r = document.querySelector(sel)?.getBoundingClientRect();
          return r === undefined ? null : { left: r.left, right: r.right, top: r.top, mid: (r.top + r.bottom) / 2 };
        };
        const text = document.querySelector('.docs-compact-where-ref');
        const badge = document.querySelector('.docs-compact-where .docs-badge');
        return {
          label: rect('.docs-compact-label'), badge: rect('.docs-compact-where .docs-badge'), ref: rect('.docs-compact-where-ref'),
          textCut: text === null ? null : text.scrollWidth > text.clientWidth,
          badgeWhole: badge === null ? null : badge.scrollWidth <= badge.clientWidth + 1,
          words: badge?.textContent ?? null,
        };
      });
      console.log(`PHH-FIGURE refined 412x915 long-branch-draft ${JSON.stringify(got)}`);
      expect(got.textCut, 'the long ref overflows and is cut').toBe(true);
      expect(got.badgeWhole, 'the badge is not cut').toBe(true);
      expect(got.label).not.toBeNull();
      expect(got.badge).not.toBeNull();
      expect(got.badge!.left).toBeGreaterThanOrEqual(got.label!.left - 0.5);
      expect(got.badge!.right, 'the badge lies inside the label').toBeLessThanOrEqual(got.label!.right + 0.5);
      // The badge stays on the ref's line (the ref's span is in this fixture, so it is the one measured): were the row to
      // stack them, the badge would sit lower and still be inside the label. The two are centred on one line, and the badge
      // is the taller box, so their tops differ by 1.4 px and their centres by none: the centres are compared.
      expect(got.ref).not.toBeNull();
      expect(Math.abs(got.badge!.mid - got.ref!.mid), 'the badge is on the ref\'s line').toBeLessThanOrEqual(1);
      expect(app.errors, 'no page error').toEqual([]);
    } finally {
      await app.ctx.close();
    }
  }, 120_000);

  it('412 x 915: a ref view of a leaf under a 46-character directory still draws the ref, and the badge is inside the label (refinement (g))', async () => {
    const leaf = `${LONG_DIR}/${NAME}`;
    const app = await openView({ ...PHONE, skin: REFINED }, draftTree(leaf), leaf);
    try {
      await app.page.goto(`${server!.origin}/docs/${PROJECT}/${SECTION}/${leaf}?ref=${LONG_BRANCH}`, { waitUntil: 'load' });
      await app.page.waitForFunction(() => document.querySelector('.docs-compact-where-ref') !== null, undefined, { timeout: 30_000 });
      const got = await app.page.evaluate(() => {
        const box = (sel: string): { left: number; right: number; width: number } | null => {
          const r = document.querySelector(sel)?.getBoundingClientRect();
          return r === undefined ? null : { left: r.left, right: r.right, width: r.width };
        };
        // The separator's own space is drawn: the first character of the ref's text has a box of its own.
        const ref = document.querySelector('.docs-compact-where-ref');
        const first = document.createRange();
        if (ref?.firstChild != null) { first.setStart(ref.firstChild, 0); first.setEnd(ref.firstChild, 1); }
        return {
          label: box('.docs-compact-label'), crumb: box('.docs-compact-where-crumb'), ref: box('.docs-compact-where-ref'),
          badge: box('.docs-compact-where .docs-badge'), separatorW: first.getBoundingClientRect().width,
          refText: ref?.textContent ?? null,
        };
      });
      console.log(`PHH-FIGURE refined 412x915 long-directory-ref ${JSON.stringify(got)}`);
      expect(got.ref, 'the ref is drawn').not.toBeNull();
      expect(got.ref!.width, 'the ref has room for at least four mono characters').toBeGreaterThan(24);
      expect(got.separatorW, 'the separator\'s space is drawn').toBeGreaterThan(0);
      expect(got.badge).not.toBeNull();
      expect(got.label).not.toBeNull();
      expect(got.badge!.right, 'the badge lies inside the label').toBeLessThanOrEqual(got.label!.right + 0.5);
      expect(got.ref!.right, 'the ref ends before the badge').toBeLessThanOrEqual(got.badge!.left + 0.5);
      expect(app.errors, 'no page error').toEqual([]);
    } finally {
      await app.ctx.close();
    }
  }, 120_000);

  it('412 x 915: Page details opens the truth line under the row; Escape closes it, focus back on the button (refinement (d))', async () => {
    await at({ ...PHONE, skin: REFINED }, async ({ page }) => {
      const more = page.locator('.docs-compact-bar .docs-more');
      expect(await more.count(), 'Page details is on the row').toBe(1);
      expect(await page.locator('.docs-truth').isVisible(), 'the truth line is behind the tap').toBe(false);
      await more.click();
      expect(await more.getAttribute('aria-expanded')).toBe('true');
      expect(await page.locator('.docs-truth').isVisible()).toBe(true);
      // Escape is pressed from inside the open panel, so the panel's own handler and the focus's return to the button are
      // what close it: a click leaves focus on the button, where the button's handler alone would do.
      const inside = page.locator('.docs-more-panel').getByRole('button', { name: DOCS_HEAD_TEXT.copyCommit });
      await inside.focus();
      expect(await page.evaluate(() => document.activeElement?.closest('.docs-more-panel') !== null), 'focus is in the panel').toBe(true);
      expect(await page.locator('.docs-more-panel').getByRole('link', { name: DOCS_HEAD_TEXT.github }).isVisible()).toBe(true);
      const f = await measure(page);
      console.log(`PHH-FIGURE refined 412x915 panel-open ${JSON.stringify(f)}`);
      expect(f.frameTop, 'the frame stays under the open panel').toBeGreaterThan(CONSOLE_PART_MAX);
      await page.keyboard.press('Escape');
      expect(await more.getAttribute('aria-expanded')).toBe('false');
      expect(await page.locator('.docs-truth').isVisible()).toBe(false);
      expect(await page.evaluate(() => document.activeElement?.classList.contains('docs-more') ?? false), 'focus is on Page details')
        .toBe(true);
    });
  }, 120_000);
});


/** The desk head's figure (desk-nav Part B, D-8101): at 1280 x 800 under a mouse, the doc title's top in the page. The
 *  base measured 378 in Refined, with a head of three 44 px rows and their gaps; the head is now one row and one dense
 *  line, and this tree measured 310 in Instrument and 306 in Refined. The reader frame's own bar (101 px to the title
 *  inside the frame) stays until the library take-up moves it into the head row, so the pin is this tree's figure: the
 *  next 10 px step above 310 (departure b-before-take-up). */
const DESK_TITLE_MAX = 320;
/** The head itself, from the top of `.docs-head` to the bottom of the truth line, under a mouse at 1280: the row (one tap),
 *  the 4 px gap and the dense line (28 px) is 76. */
const HEAD_MAX = 80;
/** The dense line's height under a mouse (`--docs-line-h` inside `@media (pointer: fine)`). */
const DENSE = 28;
/** A leaf three directories down, so the row has middle crumbs to give way. */
const DEEP = `${LONG_DIR}/${NAME}`;
const DEEP_TREE = treeOk({ entries: [entry(SECTION, DEEP, { committed: { kind: 'file', blob: BLOB, size: SIZE } })] });

interface Box { readonly top: number; readonly bottom: number; readonly left: number; readonly right: number; readonly height: number; readonly mid: number }
interface Control extends Box { readonly name: string }
interface RowFigure {
  readonly head: Box | null; readonly row: Box | null; readonly truth: Box | null; readonly back: Box | null; readonly here: Box | null;
  readonly commit: Box | null; readonly chip: Box | null; readonly controls: readonly Control[]; readonly truthControls: readonly Control[];
  readonly words: readonly { readonly text: string; readonly shown: boolean; readonly cut: boolean }[];
  readonly fine: boolean; readonly scrollW: number; readonly innerW: number; readonly folded: boolean; readonly crumbCut: boolean;
  readonly rowW: number;
}

/** The full head's geometry, read in the page. */
async function rowFigure(page: Page): Promise<RowFigure> {
  return page.evaluate(async () => {
    await document.fonts.ready;
    const box = (e: Element | null | undefined): Box | null => {
      if (e === null || e === undefined) return null;
      const b = e.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, height: b.height, mid: (b.top + b.bottom) / 2 };
    };
    const control = (e: Element): Control => ({ name: e.getAttribute('aria-label') ?? e.textContent ?? '', ...box(e)! });
    const head = document.querySelector('.docs-head.docs-full');
    const row = head?.querySelector(':scope > .docs-head-bar') ?? null;
    const truth = head?.querySelector(':scope > .docs-truth') ?? null;
    const shown = (e: Element): boolean => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0;
    return {
      head: box(head), row: box(row), truth: box(truth), back: box(row?.querySelector('.docs-back')),
      here: box(row?.querySelector('.docs-crumb-here')), commit: box(truth?.querySelector('.docs-truth-commit')),
      chip: box(truth?.querySelector('.docs-fresh')),
      controls: row === null ? [] : [...row.querySelectorAll('button, a')].filter(shown).map(control),
      truthControls: truth === null ? [] : [...truth.querySelectorAll('button')].filter(shown).map(control),
      words: row === null ? [] : [...row.querySelectorAll('.docs-action-words')].map((w) => ({
        text: w.textContent ?? '', shown: shown(w), cut: w.scrollWidth > w.clientWidth + 0.5,
      })),
      fine: matchMedia('(pointer: fine)').matches,
      scrollW: document.documentElement.scrollWidth, innerW: innerWidth,
      folded: row?.querySelector('.docs-crumbs-more') !== null && row?.querySelector('.docs-crumbs-more') !== undefined,
      crumbCut: row === null ? false : [...row.querySelectorAll('.docs-crumb, .docs-crumb-here')].some((c) => c.scrollWidth > c.clientWidth + 0.5),
      rowW: row?.getBoundingClientRect().width ?? Number.NaN,
    };
  });
}

describe('the desk head (desk-nav Part B)', () => {
  it.each([INSTRUMENT, REFINED])(`1280 x 800, %s: the title is at most ${DESK_TITLE_MAX} px down, the head at most ${HEAD_MAX}`, async (skin) => {
    await at({ width: 1280, height: 800, skin }, async ({ page }) => {
      const f = await measure(page);
      const r = await rowFigure(page);
      const headH = r.truth!.bottom - r.head!.top;
      console.log(`PHH-FIGURE ${skin} 1280x800 desk ${JSON.stringify({ ...f, headH, fine: r.fine })}`);
      expect(f.head).toBe('full');
      expect(r.fine, 'a mouse').toBe(true);
      expect(f.frameScroll, 'the frame is at its top').toBe(0);
      expect(headH, 'the head, from its top to the bottom of the truth line').toBeLessThanOrEqual(HEAD_MAX);
      expect(f.above, 'px above the title').toBeLessThanOrEqual(DESK_TITLE_MAX);
    });
  }, 120_000);

  it.each([INSTRUMENT, REFINED])('1280 x 800, %s: the row is one line, and the truth line one dense line holding its chip and commit', async (skin) => {
    await at({ width: 1280, height: 800, skin }, async ({ page }) => {
      const r = await rowFigure(page);
      console.log(`PHH-FIGURE ${skin} 1280x800 row ${JSON.stringify({ row: r.row, truth: r.truth, controls: r.controls.map((c) => [c.name, c.height]) })}`);
      expect(r.controls.map((c) => c.name)).toEqual([DOCS_HEAD_TEXT.back, 'Docs', PROJECT, SECTION, DOCS_HEAD_TEXT.github, DOCS_HEAD_TEXT.share, DOCS_HEAD_TEXT.exportPlainView]);
      for (const c of [...r.controls, r.here!]) {
        expect(Math.abs(c.mid - r.back!.mid), `${'name' in c ? c.name : 'the page crumb'} on the row's line`).toBeLessThanOrEqual(1);
      }
      expect(r.row!.height, 'the row is one tap tall').toBeLessThanOrEqual(TAP + 0.5);
      expect(r.words.every((w) => w.shown && !w.cut), 'every action shows its words').toBe(true);
      expect(r.truth!.height, 'the dense line').toBeLessThanOrEqual(DENSE + 0.5);
      for (const [what, b] of [['the chip', r.chip], ['the commit', r.commit]] as const) {
        expect(b, what).not.toBeNull();
        expect(b!.top, what).toBeGreaterThanOrEqual(r.truth!.top - 0.5);
        expect(b!.bottom, what).toBeLessThanOrEqual(r.truth!.bottom + 0.5);
        expect(b!.left, what).toBeGreaterThanOrEqual(r.truth!.left - 0.5);
        expect(b!.right, what).toBeLessThanOrEqual(r.truth!.right + 0.5);
      }
    });
  }, 120_000);

  it('at 600 the crumbs give way first: the middle crumbs are cut while every action keeps its words', async () => {
    await at({ width: 600, height: 960, skin: REFINED }, async ({ page }) => {
      const r = await rowFigure(page);
      console.log(`PHH-FIGURE refined 600x960 deep-row ${JSON.stringify({ rowW: r.rowW, folded: r.folded, crumbCut: r.crumbCut, words: r.words })}`);
      expect(r.folded || r.crumbCut, 'the middle crumbs give way').toBe(true);
      expect(r.words.length).toBe(3);
      expect(r.words.every((w) => w.shown && !w.cut), 'every action keeps its words').toBe(true);
      expect(r.scrollW, 'no sideways scroll').toBeLessThanOrEqual(r.innerW);
    }, DEEP_TREE, DEEP);
  }, 120_000);

  it.each([
    [600, 960, true],
    [768, 1024, true],
    [1280, 800, false],
  ] as const)('%i x %i: the full head, no sideways scroll; crumbs folded: %s', async (width, height, folded) => {
    await at({ width, height, skin: REFINED }, async ({ page }) => {
      const f = await measure(page);
      const r = await rowFigure(page);
      console.log(`PHH-FIGURE refined ${width}x${height} ${JSON.stringify({ ...f, headH: r.truth!.bottom - r.head!.top, fine: r.fine })}`);
      expect(f.head).toBe('full');
      expect(await page.locator('.docs-more').count()).toBe(0);
      expect(await page.locator('.docs-truth').isVisible()).toBe(true);
      expect(await page.locator('.docs-head-bar .docs-actions').getByRole('link', { name: DOCS_HEAD_TEXT.github }).isVisible()).toBe(true);
      expect(r.folded).toBe(folded);
      expect(r.scrollW, 'no sideways scroll').toBeLessThanOrEqual(r.innerW);
    }, DEEP_TREE, DEEP);
  }, 120_000);

  it('600 x 960 under a mouse: the truth line is dense there too, and nothing scrolls sideways', async () => {
    await at({ width: 600, height: 960, skin: REFINED, pointer: 'fine' }, async ({ page }) => {
      const f = await measure(page);
      const r = await rowFigure(page);
      console.log(`PHH-FIGURE refined 600x960 mouse ${JSON.stringify({ ...f, headH: r.truth!.bottom - r.head!.top, fine: r.fine })}`);
      expect(f.head).toBe('full');
      expect(r.fine, 'a mouse').toBe(true);
      expect(r.truth!.height, 'the dense line').toBeLessThanOrEqual(DENSE + 0.5);
      expect(r.truth!.bottom - r.head!.top, 'the head').toBeLessThanOrEqual(HEAD_MAX);
      expect(r.words.every((w) => w.shown && !w.cut), 'every action shows its words').toBe(true);
      expect(r.scrollW, 'no sideways scroll').toBeLessThanOrEqual(r.innerW);
    }, DEEP_TREE, DEEP);
  }, 120_000);

  it('a row narrower than the container query hides the action words, and each action keeps its name', async () => {
    // A listing keeps the full head at every width, so a phone's directory page is where the row is that narrow.
    const app = await openView({ width: 412, height: 915, skin: REFINED }, DEEP_TREE, DEEP);
    try {
      await app.page.goto(`${server!.origin}/docs/${PROJECT}/${SECTION}/${LONG_DIR}/`, { waitUntil: 'load' });
      await app.page.waitForFunction(() => document.querySelector('.docs-head-bar .docs-actions .docs-share') !== null, undefined, { timeout: 30_000 });
      const r = await rowFigure(app.page);
      console.log(`PHH-FIGURE refined 412x915 listing-row ${JSON.stringify({ rowW: r.rowW, words: r.words, controls: r.controls.map((c) => c.name) })}`);
      expect(r.words.length).toBeGreaterThan(0);
      expect(r.words.some((w) => w.shown), 'no word shows').toBe(false);
      expect(r.controls.map((c) => c.name)).toEqual(expect.arrayContaining([DOCS_HEAD_TEXT.github, DOCS_HEAD_TEXT.share]));
      expect(r.scrollW, 'no sideways scroll').toBeLessThanOrEqual(r.innerW);
      expect(app.errors, 'no page error').toEqual([]);
    } finally {
      await app.ctx.close();
    }
  }, 120_000);

  it.each([
    [1280, 800],
    [915, 412],
  ] as const)('a touch laptop keeps the floor: %i x %i under a coarse pointer, every control in the row and the truth line one tap tall', async (width, height) => {
    await at({ width, height, skin: REFINED, touch: true }, async ({ page }) => {
      const f = await measure(page);
      const r = await rowFigure(page);
      console.log(`PHH-FIGURE refined ${width}x${height} touch ${JSON.stringify({ ...f, headH: r.truth!.bottom - r.head!.top, fine: r.fine })}`);
      expect(f.head).toBe('full');
      expect(r.fine, 'a coarse pointer').toBe(false);
      for (const c of [...r.controls, ...r.truthControls]) expect(c.height, c.name).toBeGreaterThanOrEqual(TAP - 0.5);
      expect(r.truth!.height, 'the line keeps the floor').toBeGreaterThanOrEqual(TAP - 0.5);
    });
  }, 120_000);
});
