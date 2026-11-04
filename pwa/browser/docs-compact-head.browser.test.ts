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
// At 599 the head is still the row; at 600, 768 and 1280 it is the full header, as before (its truth line on the page,
// its crumbs folded below the desk width), and the phone turned sideways (915 x 412, a touch screen) is a desk width that
// keeps the full header too: that case records what it costs. Every case prints its figures on a `PHH-FIGURE` line for
// the plan's Results.
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

interface View { readonly width: number; readonly height: number; readonly skin: string; readonly touch?: boolean }

/** A context at `view` (a touch screen below 900 px, or when `touch` asks), its `/api/docs` answering `tree`. */
async function openView(view: View, tree = COMMITTED_TREE, leaf = NAME): Promise<OpenedApp> {
  const app = await openApp(browser!, { width: view.width, skin: view.skin, theme: 'light', touch: view.touch }, { api: {}, fleetFrames: [] });
  await app.page.setViewportSize({ width: view.width, height: view.height });
  await answerDocs(app, tree, leaf);
  return app;
}

/** A context at `view` with the leaf open and the reader up. Throws when the reader fell back to the plain view or never
 *  came up: the figure is about the reader page. */
async function openLeaf(view: View): Promise<OpenedApp> {
  const app = await openView(view);
  await app.page.goto(`${server!.origin}/docs/${PROJECT}/${SECTION}/${NAME}`, { waitUntil: 'load' });
  const up = await app.page.waitForFunction((note) => {
    if ([...document.querySelectorAll('.doc-plain-note')].some((n) => n.textContent === note)) return 'fallback';
    return document.querySelector('.docs-reader iframe') !== null && document.querySelector('.doc-formatting') === null ? 'ready' : null;
  }, READER_FALLBACK_NOTE, { timeout: 90_000, polling: 100 });
  const outcome = await up.jsonValue();
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
async function at(view: View, check: (app: OpenedApp) => Promise<void>): Promise<void> {
  const app = await openLeaf(view);
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

describe('a tablet and a desktop keep the full header (refinement (b))', () => {
  it.each([
    [600, 960, true],
    [768, 1024, true],
    [1280, 800, false],
  ] as const)('%i x %i: the full header, its truth line and View on GitHub on the page; crumbs folded: %s', async (width, height, folded) => {
    await at({ width, height, skin: REFINED }, async ({ page }) => {
      const f = await measure(page);
      console.log(`PHH-FIGURE refined ${width}x${height} ${JSON.stringify(f)}`);
      expect(f.head).toBe('full');
      expect(await page.locator('.docs-more').count()).toBe(0);
      expect(await page.locator('.docs-truth').isVisible()).toBe(true);
      expect(await page.locator('.docs-actions').getByRole('link', { name: DOCS_HEAD_TEXT.github }).isVisible()).toBe(true);
      expect(await page.locator('.docs-crumbs-more').count()).toBe(folded ? 1 : 0);
    });
  }, 120_000);

  it('915 x 412, a phone turned sideways: a desk width, so the full header, as today; the figure records its cost (refinement (b))', async () => {
    await at({ width: 915, height: 412, skin: REFINED, touch: true }, async ({ page }) => {
      const f = await measure(page);
      console.log(`PHH-FIGURE refined 915x412 ${JSON.stringify(f)}`);
      expect(f.head).toBe('full');
      expect(await page.locator('.docs-more').count()).toBe(0);
    });
  }, 120_000);
});
