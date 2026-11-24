// A Docs tab in a real Chrome over the production build (desktop polish wave 174). At a desk a Docs route draws the reader
// alone: no fleet column, no accounts strip, no console top bar, in both skins. So at 1280 x 800:
//   - the reader fills the tab: the detail pane starts at the page's left edge (no gutter where the nav column was) and
//     spans the viewport, and nothing scrolls sideways;
//   - the tab bar's one link back is reached by the keyboard right after the skip link, shows a visible focus ring, and
//     is named "Console, opens in a new tab"; it opens the console in a new tab (`target="_blank"`, href `/`);
//   - the tab's title names the document.
// At 390 x 844, a phone, a Docs route is the console's Docs screen, as before: no tab bar, no link back, nothing scrolling
// sideways. Every case prints its figures on a `DOT-FIGURE` line.
//
// No server, no ccd: `/api/docs` answers one leaf from fixtures, as docs-compact-head.browser.test.ts's sessions do.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config
// vitest.browser.config.ts browser/docs-own-tab.browser.test.ts )`, through `ccrc test`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import { DOC_SECTION_SLUGS, DOCS_RESPONSE_HEADERS } from '../../shared/docs';
import { COMMIT_A, entry, treeOk, treeResponse } from '../test/docsFixtures';
import { openApp, serveDist, sharedDist, type DistServer, type OpenedApp } from './app';
import { resolveChrome } from './harness';

const PROJECT = 'demo';
const SECTION = DOC_SECTION_SLUGS[0]!;
const NAME = '2026-11-24-docs-own-tab-design.md';
const BLOB = 'e'.repeat(40);
const DOC = '# Docs in their own tab\n\n'
  + Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1}: a document opened beside the session it came from.`).join('\n\n')
  + '\n';
const SIZE = Buffer.byteLength(DOC, 'utf8');
const TREE = treeOk({ entries: [entry(SECTION, NAME, { committed: { kind: 'file', blob: BLOB, size: SIZE } })] });
const JSON_TYPE = 'application/json; charset=utf-8';
const bodyOf = (value: unknown): Buffer => Buffer.from(JSON.stringify(value), 'utf8');
const DESK = { width: 1280, height: 800 } as const;
const PHONE = { width: 390, height: 844 } as const;

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

/** `/api/docs/demo/tree` answers the one leaf's listing and `/api/docs/demo/file` its Markdown; any other `/api/docs`
 *  request answers 204. Routed after `openApp`'s own `/api` route, so this one answers first. */
async function answerDocs(app: OpenedApp): Promise<void> {
  await app.ctx.route((u) => u.pathname.startsWith('/api/docs/'), async (route) => {
    const req = route.request();
    if (req.method() !== 'GET') { await route.fulfill({ status: 204 }); return; }
    const headers = { ...DOCS_RESPONSE_HEADERS, 'content-type': JSON_TYPE };
    if (new URL(req.url()).pathname.endsWith('/tree')) {
      await route.fulfill({ status: 200, headers, body: bodyOf(treeResponse(TREE)) });
      return;
    }
    const show = {
      v: 1, verb: 'docs-show', ok: true, elapsedMs: 3, source: 'committed', section: SECTION, path: NAME, size: SIZE,
      sha256: BLOB.padEnd(64, '0'), encoding: 'utf8', text: DOC, commit: COMMIT_A, blob: BLOB, onRef: 'contains',
    };
    await route.fulfill({ status: 200, headers, body: bodyOf({ ok: true, contentClass: 'markdown', from: 'ccd', show }) });
  });
}

/** The leaf open at `view` in `skin`, once the Docs screen has drawn its leaf (the reader up, or its plain fallback). */
async function openLeaf(view: { width: number; height: number }, skin: string): Promise<OpenedApp> {
  const app = await openApp(browser!, { width: view.width, skin, theme: 'light' }, { api: {}, fleetFrames: [] });
  await app.page.setViewportSize(view);
  await answerDocs(app);
  await app.page.goto(`${server!.origin}/docs/${PROJECT}/${SECTION}/${NAME}`, { waitUntil: 'load' });
  await app.page.waitForFunction(() => document.querySelector('.docs-reader iframe, .doc-plain') !== null, null,
    { timeout: 90_000, polling: 100 });
  return app;
}

interface DeskFigure {
  readonly nav: number; readonly accounts: number; readonly primary: number; readonly tabBar: number;
  readonly detailLeft: number; readonly detailWidth: number; readonly screenLeft: number; readonly viewport: number;
  readonly scrollX: number; readonly title: string;
}

async function deskFigure(app: OpenedApp): Promise<DeskFigure> {
  return app.page.evaluate(() => {
    const detail = document.querySelector('.shell-detail')!.getBoundingClientRect();
    const docs = document.querySelector('.docs-screen')!.getBoundingClientRect();
    return {
      nav: document.querySelectorAll('.shell-nav').length,
      accounts: document.querySelectorAll('.shell-accounts').length,
      primary: document.querySelectorAll('nav[aria-label="Primary"]').length,
      tabBar: document.querySelectorAll('header.shell-tab-bar').length,
      detailLeft: detail.left, detailWidth: detail.width, screenLeft: docs.left,
      viewport: document.documentElement.clientWidth,
      scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      title: document.title,
    };
  });
}

describe('a Docs tab at a desk, in a real Chrome', () => {
  for (const skin of [REFINED, INSTRUMENT]) {
    it(`${skin} at 1280: the reader alone fills the tab, nothing scrolls sideways, and the title names the document`, async () => {
      const app = await openLeaf(DESK, skin);
      try {
        const f = await deskFigure(app);
        console.log(`DOT-FIGURE ${skin} 1280 ${JSON.stringify(f)}`);
        expect(f.nav).toBe(0);
        expect(f.accounts).toBe(0);
        expect(f.primary).toBe(0);
        expect(f.tabBar).toBe(1);
        expect(f.detailLeft).toBe(0);
        expect(Math.abs(f.detailWidth - f.viewport)).toBeLessThanOrEqual(1);
        // The Docs screen sits in the pane with no column beside it: its left edge is within the pane's own padding.
        expect(f.screenLeft).toBeLessThan(64);
        expect(f.scrollX).toBe(0);
        expect(f.title).toBe(`${NAME} · ${PROJECT} · Docs · ccrc`);
        expect(app.errors).toEqual([]);
      } finally {
        await app.ctx.close();
      }
    }, 180_000);

    it(`${skin} at 1280: the link back is the keyboard's next stop after the skip link, with a visible ring and its name`, async () => {
      const app = await openLeaf(DESK, skin);
      try {
        // From the frame's first stop, the skip link, the keyboard's next stop is the link back.
        await app.page.focus('.skip-link');
        const first = await app.page.evaluate(() => document.activeElement?.className ?? '');
        await app.page.keyboard.press('Tab');
        const back = await app.page.evaluate(() => {
          const a = document.activeElement as HTMLAnchorElement | null;
          if (a === null) return null;
          const cs = getComputedStyle(a);
          return {
            inBar: a.closest('header.shell-tab-bar') !== null,
            text: a.textContent, href: a.getAttribute('href'), target: a.getAttribute('target'),
            focusVisible: a.matches(':focus-visible'), outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth,
            height: a.getBoundingClientRect().height,
          };
        });
        console.log(`DOT-FIGURE ${skin} focus ${first} ${JSON.stringify(back)}`);
        expect(first).toContain('skip-link');
        expect(back).not.toBeNull();
        expect(back!.inBar).toBe(true);
        expect(back!.href).toBe('/');
        expect(back!.target).toBe('_blank');
        expect(back!.focusVisible).toBe(true);
        expect(back!.outlineStyle).not.toBe('none');
        expect(Number.parseFloat(back!.outlineWidth)).toBeGreaterThan(0);
        expect(back!.height).toBeGreaterThanOrEqual(24);
        const named = app.page.getByRole('link', { name: 'Console, opens in a new tab', exact: true });
        expect(await named.count()).toBe(1);
      } finally {
        await app.ctx.close();
      }
    }, 180_000);
  }
});

describe('a Docs route on a phone, in a real Chrome, unchanged', () => {
  for (const skin of [REFINED, INSTRUMENT]) {
    it(`${skin} at 390: the console's Docs screen, with no tab bar, no link back and nothing scrolling sideways`, async () => {
      const app = await openLeaf(PHONE, skin);
      try {
        const f = await app.page.evaluate(() => ({
          tabBar: document.querySelectorAll('header.shell-tab-bar').length,
          docsTab: document.querySelector('.app-shell')?.getAttribute('data-tab') ?? null,
          back: [...document.querySelectorAll('a')].filter((a) => (a.textContent ?? '').startsWith('Console')).length,
          screen: document.querySelectorAll('.shell-detail .docs-screen').length,
          scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          title: document.title,
        }));
        console.log(`DOT-FIGURE ${skin} 390 ${JSON.stringify(f)}`);
        expect(f.tabBar).toBe(0);
        expect(f.docsTab).toBeNull();
        expect(f.back).toBe(0);
        expect(f.screen).toBe(1);
        expect(f.scrollX).toBe(0);
        expect(f.title).toBe('ccrc');
        expect(app.errors).toEqual([]);
      } finally {
        await app.ctx.close();
      }
    }, 180_000);
  }
});
