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
import { COMMIT_A, COMMIT_B, draftOf, entry, holder, treeOk, treeResponse } from '../test/docsFixtures';
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

  it("at 600 the action words give way first (fix round 2): the actions are icons on the crumbs' line, each keeping its name, and the page's name shows", async () => {
    await at({ width: 600, height: 960, skin: REFINED }, async ({ page }) => {
      const r = await rowFigure(page);
      console.log(`PHH-FIGURE refined 600x960 deep-row ${JSON.stringify({ rowW: r.rowW, folded: r.folded, crumbCut: r.crumbCut, words: r.words })}`);
      expect(r.words.length).toBe(3);
      expect(r.words.some((w) => w.shown), 'no word shows').toBe(false);
      expect(r.folded, 'the middle crumbs are folded').toBe(true);
      expect(r.controls.map((c) => c.name)).toEqual(expect.arrayContaining([DOCS_HEAD_TEXT.github, DOCS_HEAD_TEXT.share, DOCS_HEAD_TEXT.exportPlainView]));
      for (const c of r.controls) expect(Math.abs(c.mid - r.back!.mid), `${c.name} on the row's line`).toBeLessThanOrEqual(1);
      expect(r.here!.right - r.here!.left, "the page's name").toBeGreaterThanOrEqual(TAP);
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

  it('600 x 960 under a mouse: the truth line is dense there too, on at most two lines (its facts wrap rather than clip, F2), and nothing scrolls sideways', async () => {
    await at({ width: 600, height: 960, skin: REFINED, pointer: 'fine' }, async ({ page }) => {
      const f = await measure(page);
      const r = await rowFigure(page);
      console.log(`PHH-FIGURE refined 600x960 mouse ${JSON.stringify({ ...f, headH: r.truth!.bottom - r.head!.top, fine: r.fine })}`);
      expect(f.head).toBe('full');
      expect(r.fine, 'a mouse').toBe(true);
      expect(r.truth!.height, 'two dense lines at most').toBeLessThanOrEqual(2 * DENSE + 0.5);
      expect(r.truth!.bottom - r.head!.top, 'the head').toBeLessThanOrEqual(HEAD_MAX + DENSE);
      expect(r.row!.height, 'the row is one line, its actions as icons (fix round 2)').toBeLessThanOrEqual(TAP + 0.5);
      expect(r.scrollW, 'no sideways scroll').toBeLessThanOrEqual(r.innerW);
    }, DEEP_TREE, DEEP);
  }, 120_000);

  it('a row narrower than the container query hides the action words, and each action keeps its name', async () => {
    // No leaf at 600 px or wider has a row under the query's 530 px in either skin, so the head is narrowed here by hand
    // to 500 px: the container query keys on the row's own width, whatever narrows it.
    await at({ width: 1280, height: 800, skin: REFINED }, async ({ page }) => {
      await page.evaluate(() => { (document.querySelector('.docs-head.docs-full') as HTMLElement).style.width = '500px'; });
      const r = await rowFigure(page);
      console.log(`PHH-FIGURE refined 1280x800 narrowed-row ${JSON.stringify({ rowW: r.rowW, words: r.words, controls: r.controls.map((c) => c.name) })}`);
      expect(r.rowW).toBeLessThan(530);
      expect(r.words.length).toBe(3);
      expect(r.words.some((w) => w.shown), 'no word shows').toBe(false);
      expect(r.controls.map((c) => c.name)).toEqual(expect.arrayContaining([DOCS_HEAD_TEXT.github, DOCS_HEAD_TEXT.share, DOCS_HEAD_TEXT.exportPlainView]));
    });
  }, 120_000);

  it('412 x 915: a listing below 600 px draws the head as main draws it, its figure equal to the base (F2(b))', async () => {
    const app = await openView({ width: 412, height: 915, skin: REFINED }, DEEP_TREE, DEEP);
    try {
      await app.page.goto(`${server!.origin}/docs/${PROJECT}/${SECTION}/${LONG_DIR}/`, { waitUntil: 'load' });
      await app.page.waitForFunction(() => document.querySelector('.docs-head .docs-actions') !== null, undefined, { timeout: 30_000 });
      const got = await app.page.evaluate(async () => {
        await document.fonts.ready;
        const head = document.querySelector('.docs-head');
        const top = (sel: string): number => document.querySelector(sel)?.getBoundingClientRect().top ?? Number.NaN;
        const h = head?.getBoundingClientRect();
        return {
          full: document.querySelector('.docs-full') !== null,
          kids: [...(head?.children ?? [])].map((c) => c.className),
          headTop: h?.top ?? Number.NaN, headH: h?.height ?? Number.NaN,
          bar: top('.docs-head-bar'), truth: top('.docs-truth'), actions: top('.docs-head > .docs-actions'),
        };
      });
      console.log(`PHH-FIGURE refined 412x915 listing ${JSON.stringify(got)}`);
      expect(got.full, 'no desk head below 600 px').toBe(false);
      expect(got.kids).toEqual(['docs-head-bar', 'docs-truth', 'docs-actions']);
      // The base (main at 435773d66) measured this listing's head at 224.5 px, its truth line at 92.5 and its actions at
      // 188.5, from a head top of 8.
      expect({ headH: got.headH, truth: got.truth - got.headTop, actions: got.actions - got.headTop }, 'the base\'s figure')
        .toEqual({ headH: 224.5, truth: 84.5, actions: 180.5 });
      expect(app.errors, 'no page error').toEqual([]);
    } finally {
      await app.ctx.close();
    }
  }, 120_000);

  // Fix round 1, F2: the states whose truth line is longest. A failed fetch's chip carries its sentence and the last good
  // fetch's age; a diverged local branch carries the relation in the warning tone; a dangling origin/HEAD adds its note.
  // At each width every fact lies wholly inside the head, and the line never scrolls: it wraps rather than clip.
  const FAILED_DEEP = ((): ReturnType<typeof treeOk> => {
    const base = DEEP_TREE;
    const MIN = 60_000;
    return { ...base, freshness: { ...base.freshness, stamp: { okAgeMs: 179 * MIN, attemptAgeMs: 4 * MIN, lastOutcome: 'fetch-transport', okCommit: COMMIT_A } } };
  })();
  const DIVERGED_DEEP = ((): ReturnType<typeof treeOk> => ({
    ...DEEP_TREE,
    ref: { ...DEEP_TREE.ref, requested: 'lane-a', served: 'refs/heads/lane-a', name: 'lane-a', side: 'local', via: 'local', relation: 'diverged', counterpart: { ref: 'refs/remotes/origin/lane-a', commit: COMMIT_B, ahead: 2, behind: 3, count: 'measured' } },
  }))();
  const DANGLING_DEEP = ((): ReturnType<typeof treeOk> => ({
    ...DEEP_TREE,
    ref: { ...DEEP_TREE.ref, via: 'default:origin-main', tried: [{ ref: 'refs/remotes/origin/feat-a', result: 'dangling' }] },
  }))();
  const LONG_LINES = [
    ['a failed fetch', FAILED_DEEP, ''],
    ['a diverged branch', DIVERGED_DEEP, '?ref=lane-a'],
    ['a dangling origin/HEAD', DANGLING_DEEP, ''],
  ] as const;
  const LINE_CASES = LONG_LINES.flatMap(([what, tree, query]) =>
    [INSTRUMENT, REFINED].flatMap((skin) => ([[600, 960], [768, 1024], [1280, 800]] as const).map(([w, h]) => [what, skin, w, h, tree, query] as const)));

  it.each(LINE_CASES)('%s, %s, %i x %i under a mouse: every fact of the truth line lies inside the head, and the line clips nothing (F2)', async (what, skin, width, height, tree, query) => {
    const app = await openView({ width, height, skin, pointer: 'fine' }, tree, DEEP);
    try {
      await app.page.goto(`${server!.origin}/docs/${PROJECT}/${SECTION}/${DEEP}${query}`, { waitUntil: 'load' });
      await app.page.waitForFunction(() => document.querySelector('.docs-full > .docs-truth .docs-fresh') !== null, undefined, { timeout: 30_000 });
      const got = await app.page.evaluate(async () => {
        await document.fonts.ready;
        const head = document.querySelector('.docs-head.docs-full')!.getBoundingClientRect();
        const line = document.querySelector('.docs-full > .docs-truth') as HTMLElement;
        const facts = [...line.children].map((e) => {
          const b = e.getBoundingClientRect();
          return { cls: e.className, text: e.textContent ?? '', left: b.left, right: b.right, top: b.top, bottom: b.bottom, cut: (e as HTMLElement).scrollWidth > (e as HTMLElement).clientWidth + 0.5 };
        });
        return {
          head: { left: head.left, right: head.right, top: head.top, bottom: head.bottom },
          lineScroll: line.scrollWidth, lineClient: line.clientWidth, lineH: line.getBoundingClientRect().height, facts,
          classes: facts.map((f) => f.cls),
        };
      });
      console.log(`PHH-FIGURE ${skin} ${width}x${height} long-line ${what} ${JSON.stringify({ lineH: got.lineH, scroll: got.lineScroll, client: got.lineClient })}`);
      expect(got.lineScroll, `${what}: the line does not scroll`).toBe(got.lineClient);
      for (const f of got.facts) {
        expect(f.left, `${f.cls} inside the head`).toBeGreaterThanOrEqual(got.head.left - 0.5);
        expect(f.right, `${f.cls} inside the head`).toBeLessThanOrEqual(got.head.right + 0.5);
        expect(f.top, `${f.cls} inside the head`).toBeGreaterThanOrEqual(got.head.top - 0.5);
        expect(f.bottom, `${f.cls} inside the head`).toBeLessThanOrEqual(got.head.bottom + 0.5);
        if (!f.cls.includes('docs-truth-via')) expect(f.cut, `${f.cls} is never cut`).toBe(false);
      }
      const need = what === 'a failed fetch' ? '.docs-fresh' : what === 'a diverged branch' ? 'docs-truth-relation' : 'docs-truth-dangling';
      expect(got.classes.some((c) => c.includes(need.replace('.', ''))), `${what}: its fact is drawn`).toBe(true);
    } finally {
      await app.ctx.close();
    }
  }, 120_000);

  // Fix round 1, F1: the states whose actions are widest. A modified draft opened in a ref view shows GitHub's may-differ
  // marker and Open committed version; a committed leaf served from a local branch ahead of origin shows the marker
  // alone. Whatever the actions take, the page's own name stays visible and at least a tap wide, and every action
  // stays inside the head (on a second line when the row cannot hold them beside the crumbs' floor).
  const DRAFT_DEEP = treeOk({
    entries: [entry(SECTION, DEEP, { committed: { kind: 'file', blob: BLOB, size: SIZE }, draft: draftOf('modified') })],
    drafts: holder(),
  });
  const AHEAD_DEEP = ((): ReturnType<typeof treeOk> => {
    const base = treeOk({ entries: [entry(SECTION, DEEP, { committed: { kind: 'file', blob: BLOB, size: SIZE } })] });
    return {
      ...base,
      ref: { ...base.ref, requested: 'lane-a', served: 'refs/heads/lane-a', name: 'lane-a', side: 'local', via: 'local', relation: 'local-ahead', counterpart: { ref: 'refs/remotes/origin/lane-a', commit: COMMIT_B, ahead: 2, behind: 0, count: 'measured' } },
    };
  })();
  /** GitHub's longest refusal (a repository name that cannot be linked), fix round 1, F5. */
  const REFUSED_DEEP = { ...DEEP_TREE, github: { state: 'named' as const, slug: 'not a slug' } };
  const WIDE_STATES = [
    ['a modified draft', DRAFT_DEEP, 'main', '.docs-head-bar .docs-actions a[aria-label="Open committed version"]'],
    ['a local ref ahead of origin', AHEAD_DEEP, 'lane-a', '.docs-head-bar .docs-actions .docs-action-note'],
    ["GitHub's refusal", REFUSED_DEEP, 'main', '.docs-head-bar .docs-actions .docs-action-off'],
  ] as const;
  const WIDE_CASES = WIDE_STATES.flatMap(([what, tree, ref, ready]) =>
    [INSTRUMENT, REFINED].flatMap((skin) => ([[600, 960], [768, 1024], [1280, 800]] as const).map(([w, h]) => [what, skin, w, h, tree, ref, ready] as const)));

  it.each(WIDE_CASES)("%s, %s, %i x %i under a mouse: the page's name stays visible and a tap wide, and every action stays in the head (F1)", async (what, skin, width, height, tree, ref, ready) => {
    const app = await openView({ width, height, skin, pointer: 'fine' }, tree, DEEP);
    try {
      await app.page.goto(`${server!.origin}/docs/${PROJECT}/${SECTION}/${DEEP}?ref=${ref}`, { waitUntil: 'load' });
      await app.page.waitForFunction((sel) => document.querySelector(sel) !== null, ready, { timeout: 30_000 });
      // The widest settled actions: the reader is up, so Export reads "Export (plain view)" (before it, "Export" or a wait).
      await app.page.waitForFunction(() => document.querySelector('.docs-full .docs-export')?.getAttribute('aria-label') === 'Export (plain view)', undefined, { timeout: 90_000 });
      const got = await app.page.evaluate(async () => {
        await document.fonts.ready;
        const r = (e: Element | null): DOMRect | null => e?.getBoundingClientRect() ?? null;
        const head = r(document.querySelector('.docs-head.docs-full'));
        const nav = r(document.querySelector('.docs-full .docs-crumbs'));
        const here = document.querySelector('.docs-full .docs-crumb-here');
        const h = r(here);
        const seen = h === null || nav === null ? 0 : Math.max(0, Math.min(h.right, nav.right) - Math.max(h.left, nav.left));
        const actions = [...document.querySelectorAll('.docs-full .docs-actions > *')].map((e) => {
          const b = e.getBoundingClientRect();
          return { cls: e.className, left: b.left, right: b.right, top: b.top, bottom: b.bottom };
        });
        return {
          head, hereText: here?.textContent ?? '', hereW: h?.width ?? 0, seen, actions,
          rowH: r(document.querySelector('.docs-full > .docs-head-bar'))?.height ?? 0,
          scrollW: document.documentElement.scrollWidth, innerW: innerWidth,
        };
      });
      console.log(`PHH-FIGURE ${skin} ${width}x${height} wide-${ref} ${JSON.stringify({ seen: got.seen, rowH: got.rowH, actions: got.actions.length })}`);
      expect(got.hereText, `${what}: the page's name`).toBe(NAME);
      expect(got.seen, `${what}: the visible width of the page's name`).toBeGreaterThanOrEqual(TAP);
      expect(got.actions.length).toBeGreaterThan(0);
      for (const a of got.actions) {
        expect(a.left, `${a.cls} inside the head`).toBeGreaterThanOrEqual(got.head!.left - 0.5);
        expect(a.right, `${a.cls} inside the head`).toBeLessThanOrEqual(got.head!.right + 0.5);
        expect(a.top, `${a.cls} inside the head`).toBeGreaterThanOrEqual(got.head!.top - 0.5);
        expect(a.bottom, `${a.cls} inside the head`).toBeLessThanOrEqual(got.head!.bottom + 0.5);
      }
      expect(got.scrollW, 'no sideways scroll').toBeLessThanOrEqual(got.innerW);
    } finally {
      await app.ctx.close();
    }
  }, 120_000);

  // Fix round 2: the ORDER in which the row gives way when room runs short (desk-nav Part B, D-8101). The action words
  // hide first (each icon keeps its name), then the middle crumbs fold behind `…`, then the page's name shortens to its
  // floor, and only then do the actions wrap onto a second line.
  const DRAFT_LONG = draftTree(DEEP);
  /** Opens `path?ref=` at `view` with `tree`, once the actions have settled (Export reads "Export (plain view)"). */
  async function openRow(view: View, tree: ReturnType<typeof treeOk>, ref: string): Promise<OpenedApp> {
    const app = await openView(view, tree, DEEP);
    await app.page.goto(`${server!.origin}/docs/${PROJECT}/${SECTION}/${DEEP}?ref=${ref}`, { waitUntil: 'load' });
    await app.page.waitForFunction(() => document.querySelector('.docs-full .docs-export')?.getAttribute('aria-label') === 'Export (plain view)', undefined, { timeout: 90_000 });
    return app;
  }
  interface RowState {
    readonly words: boolean; readonly folded: boolean; readonly nameWhole: boolean; readonly seen: number; readonly rowH: number;
    readonly actionsOnLine: boolean; readonly crumbs: readonly { readonly text: string; readonly w: number; readonly inside: boolean }[];
    readonly scrollW: number; readonly innerW: number;
  }
  /** The row as laid out now, two frames after any resize. */
  async function rowState(page: Page): Promise<RowState> {
    return page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const row = document.querySelector('.docs-full > .docs-head-bar')!;
      const nav = row.querySelector('.docs-crumbs')!.getBoundingClientRect();
      const here = row.querySelector('.docs-crumb-here') as HTMLElement;
      const h = here.getBoundingClientRect();
      const actions = row.querySelector('.docs-actions')?.getBoundingClientRect();
      const words = [...row.querySelectorAll('.docs-action-words')];
      return {
        words: words.length > 0 && words.every((w) => getComputedStyle(w).display !== 'none'),
        folded: row.querySelector('.docs-crumbs-more') !== null,
        // To the subpixel: integer scrollWidth and clientWidth agree on a name cut by a fraction, which still draws `…`.
        nameWhole: ((): boolean => { const t = document.createRange(); t.selectNodeContents(here); return t.getBoundingClientRect().width <= h.width + 0.01; })(),
        seen: Math.max(0, Math.min(h.right, nav.right) - Math.max(h.left, nav.left)),
        rowH: row.getBoundingClientRect().height,
        actionsOnLine: actions === undefined || actions.top < nav.bottom - 0.5,
        crumbs: [...row.querySelectorAll('.docs-crumb, .docs-crumb-here, .docs-crumbs-more')].map((c) => {
          const b = c.getBoundingClientRect();
          return { text: c.textContent ?? '', w: b.width, inside: b.left >= nav.left - 0.5 && b.right <= nav.right + 0.5 };
        }),
        scrollW: document.documentElement.scrollWidth, innerW: innerWidth,
      };
    });
  }
  const SWEEP = Array.from({ length: (1480 - 900) / 20 + 1 }, (_, i) => 900 + 20 * i);

  it.each([INSTRUMENT, REFINED])("the modified draft at 1280 x 800, %s, under a mouse: the action words hide, and the page's whole name shows (fix round 2, item 1)", async (skin) => {
    const app = await openRow({ width: 1280, height: 800, skin, pointer: 'fine' }, DRAFT_DEEP, 'main');
    try {
      const r = await rowState(app.page);
      console.log(`PHH-FIGURE ${skin} 1280x800 draft-name ${JSON.stringify({ seen: r.seen, words: r.words, folded: r.folded, rowH: r.rowH })}`);
      expect(r.words, 'the action words are hidden').toBe(false);
      expect(r.nameWhole, "the page's whole name").toBe(true);
      expect(r.folded, 'every crumb is drawn').toBe(false);
      expect(r.actionsOnLine, 'one row').toBe(true);
      expect(app.errors, 'no page error').toEqual([]);
    } finally {
      await app.ctx.close();
    }
  }, 120_000);

  it.each([INSTRUMENT, REFINED].flatMap((skin) => ([[600, 960], [768, 1024]] as const).map(([w, h]) => [skin, w, h] as const)))('the modified draft, %s, %i x %i under a mouse: one action row, the actions as icons (fix round 2, item 1)', async (skin, width, height) => {
    const app = await openRow({ width, height, skin, pointer: 'fine' }, DRAFT_DEEP, 'main');
    try {
      const r = await rowState(app.page);
      console.log(`PHH-FIGURE ${skin} ${width}x${height} draft-row ${JSON.stringify({ seen: r.seen, words: r.words, folded: r.folded, rowH: r.rowH })}`);
      expect(r.words, 'the action words are hidden').toBe(false);
      expect(r.actionsOnLine, 'the actions share the crumbs\' line').toBe(true);
      expect(r.rowH, 'one row').toBeLessThanOrEqual(TAP + 0.5);
      expect(r.seen, "the page's name").toBeGreaterThanOrEqual(TAP);
    } finally {
      await app.ctx.close();
    }
  }, 120_000);

  it.each([INSTRUMENT, REFINED])('the modified draft, %s, under a mouse, 900 to 1480 px in 20 px steps: a wider window never shows less of the name (fix round 2, item 1)', async (skin) => {
    const app = await openRow({ width: 900, height: 800, skin, pointer: 'fine' }, DRAFT_DEEP, 'main');
    try {
      const seen: [number, number, string][] = [];
      for (const w of SWEEP) {
        await app.page.setViewportSize({ width: w, height: 800 });
        const r = await rowState(app.page);
        seen.push([w, Math.round(r.seen * 10) / 10, `${r.words ? 'w' : 'i'}${r.folded ? 'f' : 'u'}${r.actionsOnLine ? '1' : '2'}`]);
      }
      console.log(`PHH-FIGURE ${skin} sweep draft-name ${JSON.stringify(seen)}`);
      for (let i = 1; i < seen.length; i++) {
        expect(seen[i]![1], `the name at ${seen[i]![0]} against ${seen[i - 1]![0]}`).toBeGreaterThanOrEqual(seen[i - 1]![1] - 0.5);
      }
    } finally {
      await app.ctx.close();
    }
  }, 300_000);

  // Review 1704 F2 (Task C16, D-8139): in GitHub's refusal state the sentence gives way (an ellipsis from a small basis,
  // its whole words in its `title`) before the page's name does, so a wider window never shows less of the name here
  // either. Before, the sentence (439 px) never shrank: the actions wrapped to a line of their own below about 1100 px,
  // handing the name a whole line, and the name dropped from whole to six characters one pixel wider; at 768 it showed
  // six characters on one line. From 900 the desk sidebar takes its column, so the row is narrower at 900 (544 px in
  // Instrument) than at 768 (752): the sweep is monotonic from 900, as the draft's is, and 768 shows the whole name.
  const REFUSAL_SWEEP = [768, ...SWEEP.filter((w) => w <= 1320)];
  it.each([INSTRUMENT, REFINED].flatMap((skin) => (['fine', 'coarse'] as const).map((pointer) => [skin, pointer] as const)))("GitHub's refusal, %s, a %s pointer, at 768 and 900 to 1320 px in 20 px steps: a wider window never shows less of the name (review 1704 F2)", async (skin, pointer) => {
    const view: View = pointer === 'fine' ? { width: 768, height: 800, skin, pointer } : { width: 768, height: 800, skin, touch: true };
    const app = await openRow(view, REFUSED_DEEP, 'main');
    try {
      const seen: [number, number, string][] = [];
      let whole768 = false;
      for (const w of REFUSAL_SWEEP) {
        await app.page.setViewportSize({ width: w, height: 800 });
        const r = await rowState(app.page);
        if (w === 768) whole768 = r.nameWhole;
        seen.push([w, Math.round(r.seen * 10) / 10, `${r.words ? 'w' : 'i'}${r.folded ? 'f' : 'u'}${r.actionsOnLine ? '1' : '2'}`]);
        expect(r.scrollW, `no sideways scroll at ${w}`).toBeLessThanOrEqual(r.innerW);
      }
      console.log(`PHH-FIGURE ${skin} ${pointer} sweep refusal-name ${JSON.stringify(seen)}`);
      expect(whole768, "the page's whole name at 768").toBe(true);
      for (let i = 2; i < seen.length; i++) {
        expect(seen[i]![1], `the name at ${seen[i]![0]} against ${seen[i - 1]![0]}`).toBeGreaterThanOrEqual(seen[i - 1]![1] - 0.5);
      }
      const off = await app.page.evaluate(() => {
        const e = document.querySelector('.docs-full .docs-action-off') as HTMLElement;
        return { title: e.title, text: e.textContent ?? '' };
      });
      expect(off.title, 'the sentence keeps its whole words in its title').toBe(off.text);
      expect(app.errors, 'no page error').toEqual([]);
    } finally {
      await app.ctx.close();
    }
  }, 300_000);

  const CRUMB_STATES = [
    ["GitHub's refusal", REFUSED_DEEP, 'main'],
    ['a modified draft, deep, on a long branch', DRAFT_LONG, LONG_BRANCH],
    ['a committed deep leaf', DEEP_TREE, 'main'],
  ] as const;
  const CRUMB_CASES = CRUMB_STATES.flatMap(([what, tree, ref]) =>
    [INSTRUMENT, REFINED].flatMap((skin) => (['fine', 'coarse'] as const).map((pointer) => [what, skin, pointer, tree, ref] as const)));

  it.each(CRUMB_CASES)('%s, %s, a %s pointer, 900 to 1480 px in 20 px steps: every drawn crumb is a tap wide and wholly inside the crumbs (fix round 2, item 2)', async (what, skin, pointer, tree, ref) => {
    const view: View = pointer === 'fine' ? { width: 900, height: 800, skin, pointer } : { width: 900, height: 800, skin, touch: true };
    const app = await openRow(view, tree, ref);
    try {
      const log: [number, string, number][] = [];
      for (const w of SWEEP) {
        await app.page.setViewportSize({ width: w, height: 800 });
        const r = await rowState(app.page);
        log.push([w, `${r.words ? 'w' : 'i'}${r.folded ? 'f' : 'u'}${r.actionsOnLine ? '1' : '2'}`, Math.round(Math.min(...r.crumbs.map((c) => c.w)) * 10) / 10]);
        for (const c of r.crumbs) {
          expect(c.w, `${what} at ${w}: ${c.text} is a tap wide`).toBeGreaterThanOrEqual(TAP - 0.5);
          expect(c.inside, `${what} at ${w}: ${c.text} is wholly inside the crumbs`).toBe(true);
        }
        expect(r.scrollW, `${what} at ${w}: no sideways scroll`).toBeLessThanOrEqual(r.innerW);
      }
      console.log(`PHH-FIGURE ${skin} ${pointer} sweep crumbs ${what} ${JSON.stringify(log)}`);
      expect(app.errors, 'no page error').toEqual([]);
    } finally {
      await app.ctx.close();
    }
  }, 300_000);

  // `…` unfolds every crumb: the crumbs' floor is then five crumbs' (their basis counts the crumbs drawn), so the row
  // wraps the actions before any crumb goes under it. The draft whose head is narrowed by hand to 460 px is the case a
  // fixed three-crumb basis clips: three floors and the icons fit one line there, five do not.
  const UNFOLD_CASES = [INSTRUMENT, REFINED].flatMap((skin) => ([
    ['a modified draft, its head 460 px wide', 1280, 800, DRAFT_DEEP, 'main', 460],
    ['a modified draft on a long branch', 768, 1024, DRAFT_LONG, LONG_BRANCH, null],
  ] as const).map(([what, w, h, tree, ref, narrow]) => [what, skin, w, h, tree, ref, narrow] as const));

  it.each(UNFOLD_CASES)('%s, %s, %i x %i under a mouse: `…` unfolds every crumb, and each is still a tap wide and wholly visible, its focus ring too (fix round 2, item 2)', async (what, skin, width, height, tree, ref, narrow) => {
    const app = await openRow({ width, height, skin, pointer: 'fine' }, tree, ref);
    try {
      if (narrow !== null) {
        await app.page.evaluate((w) => { (document.querySelector('.docs-head.docs-full') as HTMLElement).style.width = `${w}px`; }, narrow);
      }
      await app.page.locator('.docs-full .docs-crumbs-more').waitFor({ timeout: 10_000 });
      await app.page.locator('.docs-full .docs-crumbs-more').click();
      const r = await rowState(app.page);
      console.log(`PHH-FIGURE ${skin} ${width}x${height} unfolded ${what} ${JSON.stringify({ crumbs: r.crumbs.map((c) => Math.round(c.w)), rowH: r.rowH, actionsOnLine: r.actionsOnLine })}`);
      expect(r.folded, 'every crumb is drawn').toBe(false);
      expect(r.crumbs.length).toBe(5);
      for (const c of r.crumbs) {
        expect(c.w, `${c.text} is a tap wide`).toBeGreaterThanOrEqual(TAP - 0.5);
        expect(c.inside, `${c.text} is wholly inside the crumbs`).toBe(true);
      }
      // Keyboard focus on the first crumb, by Tab from back (a programmatic focus may not match :focus-visible): its
      // ring is drawn inside its box, and the box inside the crumbs'.
      await app.page.locator('.docs-full .docs-back').focus();
      await app.page.keyboard.press('Tab');
      const ring = await app.page.evaluate(() => {
        const a = document.activeElement as HTMLElement;
        if (!a.classList.contains('docs-crumb')) throw new Error(`Tab from back reached ${a.className}, not the first crumb`);
        const nav = document.querySelector('.docs-full .docs-crumbs')!.getBoundingClientRect();
        const b = a.getBoundingClientRect();
        const cs = getComputedStyle(a);
        const off = Number.parseFloat(cs.outlineOffset) + Number.parseFloat(cs.outlineWidth);
        return { inset: off <= 0.5, inside: b.left >= nav.left - 0.5 && b.right <= nav.right + 0.5, style: cs.outlineStyle };
      });
      expect(ring.style, 'a ring is drawn').not.toBe('none');
      expect(ring.inset, 'the ring is drawn inside the crumb').toBe(true);
      expect(ring.inside, 'the crumb is wholly inside the crumbs').toBe(true);
    } finally {
      await app.ctx.close();
    }
  }, 120_000);

  // Review 1704 F1 (Task C16, D-8139): a deep path the user unfolds with `…` wraps rather than clip its start, as the
  // compact head's panel does. Five directories are nine crumbs and seven are eleven; their floors (about 563 and 687 px)
  // are wider than the row at 600 (584 px) and at 900 (544 in Instrument, 564 in Refined), where one line clipped "Docs"
  // to nothing. Every crumb is then a tap wide and wholly inside the crumbs, and the first Tab stop after back, "Docs",
  // is seen.
  const deepPath = (dirs: number): string => [...Array.from({ length: dirs }, (_, i) => `dir-${String.fromCharCode(97 + i)}`), NAME].join('/');
  const DEEPER_CASES = [INSTRUMENT, REFINED].flatMap((skin) => ([5, 7] as const).flatMap((dirs) =>
    ([[600, 960], [900, 800]] as const).map(([w, h]) => [skin, dirs, w, h] as const)));

  it.each(DEEPER_CASES)('%s, %i directories, %i x %i under a mouse: the unfolded crumbs wrap, every crumb whole and the first Tab stop seen (review 1704 F1)', async (skin, dirs, width, height) => {
    const path = deepPath(dirs);
    const tree = treeOk({ entries: [entry(SECTION, path, { committed: { kind: 'file', blob: BLOB, size: SIZE } })] });
    const app = await openView({ width, height, skin, pointer: 'fine' }, tree, path);
    try {
      await app.page.goto(`${server!.origin}/docs/${PROJECT}/${SECTION}/${path}`, { waitUntil: 'load' });
      await app.page.waitForFunction(() => document.querySelector('.docs-full .docs-export')?.getAttribute('aria-label') === 'Export (plain view)', undefined, { timeout: 90_000 });
      await app.page.locator('.docs-full .docs-crumbs-more').click();
      const r = await rowState(app.page);
      const rows = await app.page.evaluate(() => {
        const nav = document.querySelector('.docs-full .docs-crumbs')!.getBoundingClientRect();
        return [...document.querySelectorAll('.docs-full .docs-crumbs li')].map((li) => {
          const b = li.getBoundingClientRect();
          return { text: li.textContent ?? '', inside: b.left >= nav.left - 0.5 && b.right <= nav.right + 0.5 && b.top >= nav.top - 0.5 && b.bottom <= nav.bottom + 0.5 };
        });
      });
      console.log(`PHH-FIGURE ${skin} ${width}x${height} unfolded-${dirs} ${JSON.stringify({ crumbs: r.crumbs.map((c) => Math.round(c.w)), rowH: r.rowH, actionsOnLine: r.actionsOnLine })}`);
      expect(r.crumbs.length, 'every crumb is drawn').toBe(dirs + 4);
      for (const c of r.crumbs) {
        expect(c.w, `${c.text} is a tap wide`).toBeGreaterThanOrEqual(TAP - 0.5);
        expect(c.inside, `${c.text} is wholly inside the crumbs`).toBe(true);
      }
      for (const li of rows) expect(li.inside, `${li.text}'s item, separator included, is inside the crumbs`).toBe(true);
      expect(r.scrollW, 'no sideways scroll').toBeLessThanOrEqual(r.innerW);
      await app.page.locator('.docs-full .docs-back').focus();
      await app.page.keyboard.press('Tab');
      const first = await app.page.evaluate(() => {
        const a = document.activeElement as HTMLElement;
        const nav = document.querySelector('.docs-full .docs-crumbs')!.getBoundingClientRect();
        const b = a.getBoundingClientRect();
        return { text: a.textContent ?? '', seen: Math.max(0, Math.min(b.right, nav.right) - Math.max(b.left, nav.left)), w: b.width };
      });
      expect(first.text, 'the first Tab stop after back').toBe(DOCS_HEAD_TEXT.index);
      expect(first.seen, 'it is seen whole').toBeGreaterThanOrEqual(first.w - 0.5);
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
