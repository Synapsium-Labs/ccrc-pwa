// The abandon sheet in a real Chrome (the runs rebuild, D-8073; spec 2026-11-04 section 9.1, check 13, o11), over the production
// build: 360, 390, 1280, 1470 and 1920 wide, both skins, both themes. jsdom lays nothing out, so what the sheet FITS is measured
// here: at a desk the dialog is the 560px one at 1280 and at 1470 alike (o11), and on the shortest phone the longest sheet (a
// 122-character title over the longest consequence sentence) keeps Confirm and Cancel reachable, the sheet scrolling inside itself.
//
//   CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/abandon-sheet.browser.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer, type OpenedApp } from './app';

const NOW = Date.now();
const H = 3_600_000;
const TITLE_122 = `Programme A with a title that runs on and on to a hundred and twenty-two characters so the sheet's name line wraps ${'x'.repeat(12)}`.slice(0, 122);

const RUN = {
  id: 1501, program: 'prog-a', programTitle: TITLE_122, wave: 2, waveOf: 5,
  project: 'project-a', homeProject: 'project-a', sessionId: 'project-a-w1501', workspace: `ws-${'long-name-'.repeat(4)}end`, branch: 'ws/1501',
  state: 'working', kind: 'work', reviews: null, claimedBy: 'project-a-coord', resumed: false, clearedAt: null,
  openedAt: NOW - 3 * H, dispatchStartedAt: null, dispatchedAt: NOW - 2 * H, closedAt: null, handoffCommit: null,
  items: { done: 1, total: 4 }, unreadMail: 0, waitsOn: 'worker',
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: false,
    clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, reviewCap: null, hadChild: false,
};

const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false }] },
    '/api/projects': { roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a', repo: { state: 'named', slug: 'owner-a/repo-a' } }] },
    '/api/runs': { runs: [RUN], nextBefore: null }, '/api/claims': [],
    '/api/coord/caps': { ok: true, caps: { maxConcurrentWorkers: 4 }, usage: { running: 1 }, updatedAt: null },
  },
  fleetFrames: [
    { type: 'fleet', sessions: [] }, { type: 'runs', runs: [RUN] },
    { type: 'pools', pools: { listed: false, enforcement: 'unknown', accountPools: 'unavailable' } },
  ],
};

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

async function openSheet(width: number, skin: string, theme: string, height?: number): Promise<OpenedApp> {
  const opened = await openApp(browser!, { skin, theme, width }, FIXTURE);
  if (height !== undefined) await opened.page.setViewportSize({ width, height });
  await opened.page.goto(`${server!.origin}/runs`);
  await opened.page.getByRole('button', { name: 'Abandon run 1501' }).first().click();
  await opened.page.locator('.sheet-panel[data-state="open"]').waitFor({ timeout: 20_000 });
  return opened;
}

const measure = (page: Page) => page.evaluate(async () => {
  const panel = document.querySelector<HTMLElement>('.sheet-panel')!;
  await Promise.all(panel.getAnimations().map((a) => a.finished.catch(() => undefined)));
  const body = document.querySelector<HTMLElement>('.sheet-body') ?? panel;
  const buttons = [...panel.querySelectorAll<HTMLButtonElement>('.sheet-footer button')].map((b) => {
    const r = b.getBoundingClientRect();
    return { text: b.textContent ?? '', top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height };
  });
  const pr = panel.getBoundingClientRect();
  return {
    panel: { w: pr.width, top: pr.top, bottom: pr.bottom }, vw: innerWidth, vh: innerHeight, buttons,
    bodyScrolls: body.scrollHeight > body.clientHeight + 1, pageX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    overflowX: body.scrollWidth - body.clientWidth,
  };
});

for (const skin of [REFINED, INSTRUMENT]) {
  for (const theme of ['light', 'dark']) {
    describe(`the abandon sheet, ${skin} ${theme}`, () => {
      for (const width of [360, 390, 1280, 1470, 1920]) {
        it(`at ${width}px both answers sit inside the window and nothing runs sideways`, async () => {
          const { ctx, page, errors } = await openSheet(width, skin, theme);
          try {
            const m = await measure(page);
            expect(m.buttons.map((b) => b.text)).toEqual(['Abandon run 1501', 'Keep it']);
            for (const b of m.buttons) {
              expect(b.top, `${b.text} starts inside the window`).toBeGreaterThanOrEqual(0);
              expect(b.bottom, `${b.text} ends inside the window`).toBeLessThanOrEqual(m.vh + 1);
              expect(b.left).toBeGreaterThanOrEqual(0);
              expect(b.right).toBeLessThanOrEqual(m.vw + 1);
              expect(b.h, `${b.text} at the tap floor`).toBeGreaterThanOrEqual(43);
            }
            expect(m.pageX, 'no sideways page scroll').toBeLessThanOrEqual(0);
            expect(m.overflowX, 'no sideways scroll in the sheet').toBeLessThanOrEqual(1);
            if (width >= 1280) {
              // o11: the same 560px dialog at 1280 and at 1470 (and at 1920).
              expect(Math.round(m.panel.w), 'the desk dialog is 560px wide').toBe(560);
            }
            expect(errors).toEqual([]);
          } finally { await ctx.close(); }
        }, 60_000);
      }

      it('at 360 by 667 a 122-character title over the long consequence sentence leaves Confirm and Cancel reachable', async () => {
        expect(TITLE_122).toHaveLength(122);
        const { ctx, page } = await openSheet(360, skin, theme, 667);
        try {
          const m = await measure(page);
          for (const b of m.buttons) {
            expect(b.top, `${b.text} starts inside the window`).toBeGreaterThanOrEqual(0);
            expect(b.bottom, `${b.text} ends inside the window`).toBeLessThanOrEqual(667 + 1);
          }
          expect(m.panel.top, 'the panel stays inside the window').toBeGreaterThanOrEqual(0);
          expect(m.panel.bottom).toBeLessThanOrEqual(667 + 1);
          // Everything above the answers is the sheet's own scroller, never the page's.
          expect(m.pageX).toBeLessThanOrEqual(0);
        } finally { await ctx.close(); }
      }, 60_000);
    });
  }
}
