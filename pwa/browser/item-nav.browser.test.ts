// Moving between items, and the recommended option on a decide item (desktop-polish PL9; spec §2 "Moving between
// items" and §3.2 "The recommendation", D23 and D24), measured in a real Chrome over the production build. The jsdom suites
// (test/waiting-routes.test.tsx, item-view.test.tsx, ledger-words.test.ts) pin the markup, the order and the words; this file
// holds what they cannot: at 360, 390, 900, 1280 and 1920 in both skins, the way back is drawn (Step 0 measured it hidden from
// 900 up, by the shell's `.shell-detail .back-btn` rule, and a bare chevron below), previous and next step through the list
// the item was opened from, the list stays beside the item from 1280, the recommended option carries its mark, every
// control of the strip clears the 44 px tap floor under a coarse pointer, and nothing scrolls sideways or throws.
//
// The fixture is two programmes: `prog-b` holds the blocking decide item (six options, the recommendation on the sixth, a long
// reason) and two more; `prog-a` holds two. `prog-a` sorts first by slug, so prog-b leading is the blocking-first rule. The
// widest case adds enough open items to put "99+" on the navigation's count. Names are neutral: the repository is public.
//
// MUTATION TABLE: see the PR body.
//
//   CCRC_CHROME=$HOME/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome ./node_modules/.bin/vitest run --config vitest.browser.config.ts --maxWorkers=2 browser/item-nav.browser.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type DistServer } from './app';
import { withRunBinding } from '../test/runBindingFixture';

const NOW = Date.now();
const MIN = 60_000;

const session = (id: string, role: string): object => ({
  id, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: `/w/project-a/${id}`,
  workspace: id, name: id, status: 'busy', statusUpdatedAt: NOW - MIN, limits: null, dialogPending: false, version: null,
  model: null, effort: null, ultracode: false, branch: `ws/${id}`, ctxPct: 40, paneCols: null, tasks: null, pr: null,
  archivedAt: null, archivedBytes: null, held: null, hookState: null, askSummary: null, subagents: null, background: null,
  withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket: 'working', bucketSince: NOW - 6 * MIN, unmeasured: [],
  started: true, child: { kind: 'none' }, role,
});

let runId = 100;
const run = (program: string, title: string, claimedBy: string, sessionId: string): object => ({
  id: runId++, program, programTitle: title, wave: 2, waveOf: 5, project: 'project-a', homeProject: 'project-a', sessionId,
  workspace: sessionId, branch: `ws/${sessionId}`, state: 'working', kind: 'work', reviews: null, claimedBy, resumed: false,
  clearedAt: null, openedAt: NOW - 3_600_000, dispatchStartedAt: null, dispatchedAt: NOW - 3_000_000, closedAt: null,
  handoffCommit: null, items: { done: 0, total: 0 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: false,
    clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, reviewCap: null,
});

const SESSIONS = [
  session('prog-b-coord', 'coordinator'), session('prog-b-w1', 'child'),
  session('prog-a-coord', 'coordinator'), session('prog-a-w1', 'child'),
];
const RUNS = [run('prog-b', 'Programme B', 'prog-b-coord', 'prog-b-w1'), run('prog-a', 'Programme A', 'prog-a-coord', 'prog-a-w1')];

const SIX = [
  'Land the library first', 'Keep the planned order', 'Split the wave in two', 'Hold until the review lands',
  'Drop the optional step', 'Ship the smaller change now and follow up with the rest next week',
];
const WHY = 'The smaller change lands today and keeps the review queue short. '.repeat(30).trim();

const item = (id: number, program: string, over: object): object => ({
  id, program, runId: null, kind: 'do', title: `Item ${id} title`, why: 'Why this is needed, in a plain sentence that may run long enough to wrap on a phone.',
  how: ['Open Settings.', 'Set it to Live.'], options: null, recommended: null, recommendedWhy: null, neededBy: 'soon', soonLabel: null,
  state: 'open', stale: false, raisedAt: NOW - 20 * MIN, tickedAt: null, closedAt: null, answer: null, note: null, secretSlot: null,
  secretSet: null, history: [{ at: NOW - 20 * MIN, act: 'raise', note: null }], ...over,
});
/** The combined list draws prog-b first (it holds the blocking item): 1, 2, 3, then prog-a's 4, 5. */
const ITEMS = [
  item(1, 'prog-b', { neededBy: 'blocking', kind: 'decide', options: SIX, recommended: 5, recommendedWhy: WHY, title: 'Choose how the last wave lands' }),
  item(2, 'prog-b', { soonLabel: 'Before wave 6', kind: 'value', title: 'Give the review-round limit' }),
  item(3, 'prog-b', { neededBy: 'later', title: 'Pick a release date' }),
  item(4, 'prog-a', { title: 'Switch the cleanup lane to live' }),
  item(5, 'prog-a', { neededBy: 'later', title: 'Review the requested change' }),
];
const fixture = (items: readonly object[]): AppFixture => {
  const waiting = { items, cleared: [], goals: [] };
  return {
    api: {
      '/api/accounts': { accounts: [], projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false }] },
      '/api/runs': RUNS, '/api/claims': [], '/api/waiting': { ok: true, waiting },
      '/api/programmes/prog-a/goals': { ok: true, goals: { program: 'prog-a', specPath: null, inShort: null, inShortAt: null, modifications: [] } },
    },
    fleetFrames: [
      { type: 'fleet', sessions: withRunBinding(SESSIONS as never[], RUNS as never[]) }, { type: 'runs', runs: RUNS },
      { type: 'waiting', waiting },
    ],
  };
};
/** The widest case: a hundred more open items of prog-a, so the navigation's count reads "99+". */
const CROWD = [...ITEMS, ...Array.from({ length: 100 }, (_, i) => item(100 + i, 'prog-a', { neededBy: 'later', title: `Crowd item ${i}` }))];

const SKINS = [REFINED, INSTRUMENT] as const;
const WIDTHS = [360, 390, 900, 1280, 1920] as const;
const BESIDE_FROM = 1280;

let dist: string | undefined;
let server: DistServer | undefined;
let browser: Browser | undefined;

beforeAll(async () => {
  const executablePath = resolveChrome(); // throws on a box with no Chrome: red, never skipped
  dist = buildDist();
  server = await serveDist(dist);
  browser = await chromium.launch({ executablePath, headless: true });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
  removeDist(dist);
});

/** The app at `path`, once `ready` (the item page's `.wi` by default) is drawn. */
async function open(skin: string, width: number, path: string, items: readonly object[] = ITEMS, touch = false, ready = '.wi') {
  const opened = await openApp(browser!, { skin, theme: 'light', width, touch }, fixture(items));
  await opened.page.goto(server!.origin + path);
  await opened.page.waitForSelector(ready, { timeout: 20_000 });
  await opened.page.evaluate(async () => { await document.fonts.ready; });
  await opened.page.waitForTimeout(250); // the first paint's transitions settle
  return opened;
}

/** Whether `selector` is drawn: in the layout, not `display: none` or hidden, with a box of some size inside the viewport's width. */
const drawn = (page: Page, selector: string): Promise<boolean> => page.evaluate((sel) => {
  const el = document.querySelector<HTMLElement>(sel);
  if (el === null) return false;
  const k = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return k.display !== 'none' && k.visibility !== 'hidden' && r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= innerWidth + 0.5;
}, selector);

const sideways = (page: Page): Promise<number> => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const here = (page: Page): Promise<string> => page.evaluate(() => decodeURIComponent(location.pathname + location.search));

describe.each(SKINS)('moving between items in %s', (skin) => {
  for (const width of WIDTHS) {
    it(`at ${width}: the way back is drawn, previous and next step through the combined list, no sideways scroll`, async () => {
      const { ctx, page, errors } = await open(skin, width, '/waiting', ITEMS, false, '.wl-group');
      try {
        await page.click('.wl-groups .wl-item[data-item="2"]');
        await page.waitForSelector('.wi');
        expect(await here(page)).toBe('/waiting/2');
        expect(await drawn(page, '.wi-nav .wi-back'), 'the way back').toBe(true);
        expect(await page.textContent('.wi-nav .wi-pos')).toBe('2 of 5');
        await page.click('.wi-nav [aria-label="Next item"]');
        await page.waitForFunction(() => location.pathname === '/waiting/3');
        expect(await page.textContent('.wi-nav .wi-pos')).toBe('3 of 5');
        await page.click('.wi-nav [aria-label="Previous item"]');
        await page.waitForFunction(() => location.pathname === '/waiting/2');
        expect(await sideways(page), 'sideways scroll').toBe(0);
        await page.click('.wi-nav .wi-back');
        await page.waitForFunction(() => location.pathname === '/waiting'); // the list beside is a `.wl-group` too
        await page.waitForSelector('.wl-grid');
        expect(await here(page)).toBe('/waiting');
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });

    it(`at ${width}: opened from the programme view, the steps stay in that programme and the way back returns to it`, async () => {
      const { ctx, page, errors } = await open(skin, width, '/programmes/prog-a', ITEMS, false, '.pv .wl-item[data-item="4"]');
      try {
        await page.click('.pv .wl-item[data-item="4"]');
        await page.waitForSelector('.wi');
        expect(await here(page)).toBe('/waiting/4?from=programme:prog-a');
        expect(await page.textContent('.wi-nav .wi-pos')).toBe('1 of 2');
        expect(await page.isDisabled('.wi-nav [aria-label="Previous item"]'), 'the first item has no previous').toBe(true);
        await page.click('.wi-nav [aria-label="Next item"]');
        await page.waitForFunction(() => location.pathname === '/waiting/5');
        expect(await page.isDisabled('.wi-nav [aria-label="Next item"]'), 'the last item has no next').toBe(true);
        expect(await drawn(page, '.wi-nav .wi-back')).toBe(true);
        await page.click('.wi-nav .wi-back');
        await page.waitForSelector('.pv');
        expect(await here(page)).toBe('/programmes/prog-a');
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });

    it(`at ${width}: the list ${width >= BESIDE_FROM ? 'stays beside' : 'is not drawn beside'} the item, and the recommended option is marked`, async () => {
      const { ctx, page, errors } = await open(skin, width, '/waiting/1');
      try {
        const shots = process.env['CCRC_SHOTS'];
        if (shots !== undefined && shots !== '') await page.screenshot({ path: `${shots}/item-nav-${skin}-${width}.png`, fullPage: true });
        const beside = await drawn(page, '.wl-beside');
        expect(beside, 'the list beside the item').toBe(width >= BESIDE_FROM);
        if (beside) {
          const geo = await page.evaluate(() => {
            const list = document.querySelector('.wl-beside')!.getBoundingClientRect();
            const it = document.querySelector('.wl-route-item')!.getBoundingClientRect();
            const current = document.querySelector('.wl-beside .wl-item[aria-current="page"]')?.getAttribute('data-item') ?? null;
            return { side: list.right <= it.left + 0.5, top: Math.abs(list.top - it.top) < 2, current };
          });
          expect(geo, 'the list is to the left of the item, level with it, the open item marked').toEqual({ side: true, top: true, current: '1' });
          await page.click('.wl-beside .wl-item[data-item="3"]');
          await page.waitForFunction(() => location.pathname === '/waiting/3');
          expect(await drawn(page, '.wl-beside')).toBe(true);
          await page.click('.wl-beside .wl-item[data-item="1"]');
          await page.waitForFunction(() => location.pathname === '/waiting/1');
        }
        // Six options, the mark on the sixth alone, its reasons drawn above the choices.
        expect(await page.locator('.wi-act input[type="radio"]').count()).toBe(7);
        const mark = await page.evaluate(() => [...document.querySelectorAll('.wi-act .wi-rec')].map((m) => m.closest('label')?.textContent ?? ''));
        expect(mark).toHaveLength(1);
        expect(mark[0]).toContain('Ship the smaller change now');
        expect(await drawn(page, '.wi-act .wi-rec'), 'the Recommended mark').toBe(true);
        expect(await drawn(page, '.wi-act .wi-why-rec'), 'the reasons').toBe(true);
        expect(await page.evaluate(() => {
          const why = document.querySelector('.wi-act .wi-why-rec')!.getBoundingClientRect();
          const choices = document.querySelector('.wi-act fieldset')!.getBoundingClientRect();
          return why.bottom <= choices.top + 0.5;
        }), 'the reasons are above the choices').toBe(true);
        expect(await sideways(page), 'sideways scroll').toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }

  it('the widest case: a long reason, six options and "99+" on the navigation, at 360 and 1920, with no sideways scroll', async () => {
    for (const width of [360, 1920]) {
      const { ctx, page, errors } = await open(skin, width, '/waiting/1', CROWD);
      try {
        if (width >= 900) {
          expect(await page.evaluate(() => document.body.textContent?.includes('99+') ?? false), 'the navigation count reads 99+').toBe(true);
        }
        expect(await page.textContent('.wi-nav .wi-pos')).toBe('1 of 105');
        expect(await drawn(page, '.wi-nav .wi-back')).toBe(true);
        expect(await sideways(page), `sideways scroll at ${width}`).toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }
  });

  for (const width of [390, 1280] as const) {
    it(`at ${width} under a coarse pointer: the way back, Previous and Next clear the 44 px tap floor`, async () => {
      const { ctx, page } = await open(skin, width, '/waiting/2', ITEMS, true);
      try {
        const heights = await page.evaluate(() => ['.wi-nav .wi-back', '.wi-nav [aria-label="Previous item"]', '.wi-nav [aria-label="Next item"]']
          .map((sel) => Math.round(document.querySelector(sel)!.getBoundingClientRect().height)));
        for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
      } finally {
        await ctx.close();
      }
    });
  }
});
