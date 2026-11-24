// A Docs tab in a real Chrome over the production build (desktop polish wave 174). At a desk a Docs route draws the reader
// alone: no fleet column, no accounts strip, no console top bar, in both skins. So at 1280 x 800:
//   - the reader fills the tab: the detail pane starts at the page's left edge (no gutter where the nav column was) and
//     spans the viewport, and nothing scrolls sideways;
//   - the tab bar's one link back is reached by the keyboard right after the skip link, shows a visible focus ring, and
//     is named "Console, opens in a new tab"; it opens the console in a new tab (`target="_blank"`, href `/`);
//   - the tab's title names the document.
// Below the desk width (fix round 1, L1): a tab whose first page was a Docs address stays a Docs tab, so a Docs tab
// resized from 1280 to 640 and back keeps the same reader, opens no fleet socket and scrolls nothing sideways, and a Docs
// address loaded first at 390 x 844 draws the reader alone with a link back that moves in place. A phone that moves to Docs
// inside the console keeps the console's Docs screen, as before: no tab bar, no link back. Every case prints its figures on
// a `DOT-FIGURE` line.
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

const LEAF = `/docs/${PROJECT}/${SECTION}/${NAME}`;

/** Wait for the Docs screen to draw its leaf (the reader up, or its plain fallback). */
async function leafDrawn(app: OpenedApp): Promise<void> {
  await app.page.waitForFunction(() => document.querySelector('.docs-reader iframe, .doc-plain') !== null, null,
    { timeout: 90_000, polling: 100 });
}

/** The app open at `view` in `skin`, with every fleet socket the page opens counted on `window.__sockets`, loaded at
 *  `first`. */
async function openAt(view: { width: number; height: number }, skin: string, first: string): Promise<OpenedApp> {
  const app = await openApp(browser!, { width: view.width, skin, theme: 'light' }, { api: {}, fleetFrames: [] });
  await app.page.setViewportSize(view);
  await answerDocs(app);
  await app.ctx.addInitScript(() => {
    const Real = window.WebSocket;
    const w = window as unknown as { __sockets: number; WebSocket: typeof WebSocket };
    w.__sockets = 0;
    w.WebSocket = class extends Real {
      constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols); w.__sockets += 1; }
    };
  });
  await app.page.goto(`${server!.origin}${first}`, { waitUntil: 'load' });
  return app;
}

/** The leaf loaded first at `view` in `skin`, once the Docs screen has drawn it. */
async function openLeaf(view: { width: number; height: number }, skin: string): Promise<OpenedApp> {
  const app = await openAt(view, skin, LEAF);
  await leafDrawn(app);
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
        expect(f.detailWidth).toBe(1280);
        expect(f.viewport).toBe(1280);
        // The Docs screen sits in the pane with no column beside it: its left edge is the page's (fix round 1, A6).
        expect(f.screenLeft).toBe(0);
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
        // What the note states (fix round 1, A6): a 2px solid ring, and the tap floor, 44px.
        expect(back!.outlineStyle).toBe('solid');
        expect(back!.outlineWidth).toBe('2px');
        expect(back!.height).toBe(44);
        const named = app.page.getByRole('link', { name: 'Console, opens in a new tab', exact: true });
        expect(await named.count()).toBe(1);
      } finally {
        await app.ctx.close();
      }
    }, 180_000);
  }
});

describe('a Docs tab below the desk width, in a real Chrome', () => {
  for (const skin of [REFINED, INSTRUMENT]) {
    it(`${skin}: resized from 1280 to 640 and back, it stays a Docs tab with the same reader and opens no fleet socket`, async () => {
      const app = await openLeaf(DESK, skin);
      try {
        await app.page.evaluate(() => { (window as unknown as { __reader: Element | null }).__reader = document.querySelector('.docs-screen'); });
        for (const view of [{ width: 640, height: 800 }, DESK]) {
          await app.page.setViewportSize(view);
          await app.page.waitForTimeout(300);
          const f = await app.page.evaluate(() => ({
            docsTab: document.querySelector('.app-shell')?.getAttribute('data-tab') ?? null,
            sameReader: document.querySelector('.docs-screen') === (window as unknown as { __reader: Element | null }).__reader,
            phoneBar: document.querySelectorAll('.shell-phone-nav').length,
            nav: document.querySelectorAll('.shell-nav').length,
            sockets: (window as unknown as { __sockets: number }).__sockets,
            scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            title: document.title,
          }));
          console.log(`DOT-FIGURE ${skin} resize ${view.width} ${JSON.stringify(f)}`);
          expect(f.docsTab).toBe('docs');
          expect(f.sameReader).toBe(true);
          expect(f.phoneBar).toBe(0);
          expect(f.nav).toBe(0);
          expect(f.sockets).toBe(0);
          expect(f.scrollX).toBe(0);
          expect(f.title).toBe(`${NAME} · ${PROJECT} · Docs · ccrc`);
        }
        expect(app.errors).toEqual([]);
      } finally {
        await app.ctx.close();
      }
    }, 180_000);

    it(`${skin} at 390: a Docs address loaded first draws the reader alone, its link back moving in place`, async () => {
      const app = await openLeaf(PHONE, skin);
      try {
        const f = await app.page.evaluate(() => {
          const bar = document.querySelector('header.shell-tab-bar');
          const back = bar?.querySelector('a') ?? null;
          return {
            docsTab: document.querySelector('.app-shell')?.getAttribute('data-tab') ?? null,
            tabBar: bar === null ? 0 : 1,
            phoneBar: document.querySelectorAll('.shell-phone-nav').length,
            backHref: back?.getAttribute('href') ?? null, backTarget: back?.getAttribute('target') ?? null,
            backHeight: back?.getBoundingClientRect().height ?? 0,
            screen: document.querySelectorAll('.shell-detail .docs-screen').length,
            sockets: (window as unknown as { __sockets: number }).__sockets,
            scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            title: document.title,
          };
        });
        console.log(`DOT-FIGURE ${skin} 390 first ${JSON.stringify(f)}`);
        expect(f.docsTab).toBe('docs');
        expect(f.tabBar).toBe(1);
        expect(f.phoneBar).toBe(0);
        expect(f.backHref).toBe('/');
        expect(f.backTarget).toBeNull();
        expect(f.backHeight).toBe(44);
        expect(f.screen).toBe(1);
        expect(f.sockets).toBe(0);
        expect(f.scrollX).toBe(0);
        expect(f.title).toBe(`${NAME} · ${PROJECT} · Docs · ccrc`);
        expect(await app.page.getByRole('link', { name: 'Console', exact: true }).count()).toBe(1);
        expect(app.errors).toEqual([]);
      } finally {
        await app.ctx.close();
      }
    }, 180_000);
  }
});

describe('a Docs page reached inside the console on a phone, in a real Chrome, unchanged', () => {
  for (const skin of [REFINED, INSTRUMENT]) {
    it(`${skin} at 390: the console's Docs screen, with no tab bar, no link back and nothing scrolling sideways`, async () => {
      const app = await openAt(PHONE, skin, '/fleet');
      try {
        await app.page.waitForFunction(() => document.querySelector('.app-shell') !== null, null, { timeout: 90_000, polling: 100 });
        // An in-app move, as `navigate` makes one: a push, then the router's own notice.
        await app.page.evaluate((to) => { history.pushState(null, '', to); dispatchEvent(new PopStateEvent('popstate')); }, LEAF);
        await leafDrawn(app);
        const f = await app.page.evaluate(() => ({
          tabBar: document.querySelectorAll('header.shell-tab-bar').length,
          docsTab: document.querySelector('.app-shell')?.getAttribute('data-tab') ?? null,
          back: [...document.querySelectorAll('a')].filter((a) => (a.textContent ?? '').startsWith('Console')).length,
          screen: document.querySelectorAll('.shell-detail .docs-screen').length,
          drawn: (() => {
            const r = document.querySelector('.shell-detail .docs-screen')?.getBoundingClientRect();
            return r === undefined ? null : { width: r.width, height: r.height };
          })(),
          sockets: (window as unknown as { __sockets: number }).__sockets,
          scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          title: document.title,
        }));
        console.log(`DOT-FIGURE ${skin} 390 in-app ${JSON.stringify(f)}`);
        // The console's one fleet stream: the counter the Docs tab cases read as 0 counts here.
        expect(f.sockets).toBe(1);
        // The reader is drawn, not only mounted: a box the width of the phone.
        expect(f.drawn).not.toBeNull();
        expect(f.drawn!.width).toBe(390);
        expect(f.drawn!.height).toBeGreaterThan(0);
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

// A TAB OPENED FROM THE CONSOLE (fix round 2, R4): the console marks its own tab in the tab's store, and a new tab opened
// from it, by a plain new-tab anchor (the bar's Docs place) or by a command (the palette's "Go to Docs", `useFollowLink`),
// has no opener and gets no copy of that mark, so it starts as a Docs tab.
describe('a tab opened from the console, in a real Chrome', () => {
  for (const how of ['the bar’s Docs place', 'the palette’s Go to Docs'] as const) {
    it(`by ${how}: a Docs tab, with no copy of the console's mark`, async () => {
      const app = await openAt(DESK, REFINED, '/fleet');
      try {
        await app.page.waitForFunction(() => document.querySelector('.app-shell') !== null, null, { timeout: 90_000, polling: 100 });
        await app.page.waitForTimeout(300);
        const mark = await app.page.evaluate(() => sessionStorage.getItem('ccrc-tab'));
        const opened = app.ctx.waitForEvent('page', { timeout: 30_000 });
        if (how === 'the bar’s Docs place') {
          await app.page.click('nav[aria-label="Primary"] a[href="/docs"]');
        } else {
          await app.page.keyboard.press('Control+k');
          await app.page.waitForTimeout(300);
          await app.page.keyboard.type('Go to Docs');
          await app.page.waitForTimeout(300);
          await app.page.keyboard.press('Enter');
        }
        const tab = await opened;
        await tab.waitForLoadState('load');
        await tab.waitForFunction(() => document.querySelector('.app-shell') !== null, null, { timeout: 90_000, polling: 100 });
        const f = await tab.evaluate(() => ({
          path: location.pathname,
          docsTab: document.querySelector('.app-shell')?.getAttribute('data-tab') ?? null,
          mark: sessionStorage.getItem('ccrc-tab'),
          opener: window.opener === null,
        }));
        const here = await app.page.evaluate(() => ({ path: location.pathname, docsTab: document.querySelector('.app-shell')?.getAttribute('data-tab') ?? null }));
        console.log(`DOT-FIGURE opened ${how} ${JSON.stringify({ mark, f, here })}`);
        expect(mark, 'the console marked its own tab').toBe('console');
        expect(f.path).toBe('/docs');
        expect(f.docsTab).toBe('docs');
        expect(f.mark, 'the new tab starts with no mark').toBeNull();
        expect(f.opener).toBe(true);
        expect(here).toEqual({ path: '/fleet', docsTab: null });
      } finally {
        await app.ctx.close();
      }
    }, 180_000);
  }
});
