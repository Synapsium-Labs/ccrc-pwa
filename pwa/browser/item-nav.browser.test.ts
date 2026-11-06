// Moving between items, and the recommended option on a decide item (desktop-polish PL9; spec §2 "Moving between
// items" and §3.2 "The recommendation", D23 and D24), measured in a real Chrome over the production build. The jsdom suites
// (test/waiting-routes.test.tsx, item-view.test.tsx, ledger-words.test.ts) pin the markup, the order and the words; this file
// holds what they cannot: at 360, 390, 900, 1280 and 1920 in both skins, the way back is drawn (Step 0 measured it hidden from
// 900 up, by the shell's `.shell-detail .back-btn` rule, and a bare chevron below), previous and next step through the list
// the item was opened from, from 900 the list stays beside the item in the frame's left column in place of the fleet (the
// coordinator's ruling: as the fleet stays beside an open session), the recommended option carries its mark, every
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
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer } from './app';
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
/** The server's health with a critical disk (93% used): the fleet's banner stack shows the disk banner (fix round 1, F1). */
const GIB = 2 ** 30;
const CRITICAL_DISK = {
  mode: 'remote', connected: true, downSince: null,
  disk: {
    at: NOW, level: 'critical', pressure: true, holders: [], expectedMounts: [],
    filesystems: [{ dev: 'dev-a', mount: 'mount-a', fsType: 'ext4', roots: ['projects'], sizeBytes: Math.round((41 * GIB * 100) / 7),
      availBytes: 41 * GIB, freeBytes: 41 * GIB, files: 1000, filesFree: 900, readOnly: false, level: 'critical' }],
  },
};
const fixture = (items: readonly object[], health?: object): AppFixture => {
  const waiting = { items, cleared: [], goals: [] };
  return {
    api: {
      ...(health === undefined ? {} : { '/api/fleet/health': health }),
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
/** From here the frame shows two columns, and on the item route its left one holds the list the item was opened from. */
const BESIDE_FROM = 900;

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

/** The app at `path`, once `ready` (the item page's `.wi` by default) is drawn. */
async function open(skin: string, width: number, path: string, items: readonly object[] = ITEMS, touch = false, ready = '.wi', health?: object) {
  const opened = await openApp(browser!, { skin, theme: 'light', width, touch }, fixture(items, health));
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

    // ONE WAITING ON YOU PAGE (desktop-polish PL11, D-7986; spec §2, D29): the programme view drew its own share of the list until
    // PL11; a programme's list is now the one list filtered to it, and an item opened there steps along it and goes back to it.
    it(`at ${width}: opened from the list filtered to a programme, the steps stay in that programme and the way back returns to it`, async () => {
      const { ctx, page, errors } = await open(skin, width, '/waiting?programme=prog-a', ITEMS, false, '.wl-groups .wl-item[data-item="4"]');
      try {
        await page.click('.wl-groups .wl-item[data-item="4"]');
        await page.waitForSelector('.wi');
        expect(await here(page)).toBe('/waiting/4?from=waiting:prog-a');
        expect(await page.textContent('.wi-nav .wi-pos')).toBe('1 of 2');
        expect(await page.isDisabled('.wi-nav [aria-label="Previous item"]'), 'the first item has no previous').toBe(true);
        await page.click('.wi-nav [aria-label="Next item"]');
        await page.waitForFunction(() => location.pathname === '/waiting/5');
        expect(await page.isDisabled('.wi-nav [aria-label="Next item"]'), 'the last item has no next').toBe(true);
        expect(await drawn(page, '.wi-nav .wi-back')).toBe(true);
        await page.click('.wi-nav .wi-back');
        await page.waitForSelector('.wl-groups');
        expect(await here(page)).toBe('/waiting?programme=prog-a');
        expect(await page.locator('.wl-groups .wl-item').count(), 'the filtered list: prog-a\'s two items').toBe(2);
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
        const beside = await drawn(page, '.shell-nav .wl-beside');
        expect(beside, 'the list beside the item, in the left column').toBe(width >= BESIDE_FROM);
        // The fleet column is not in the left column while the list is: one column, one list.
        expect(await page.locator('.shell-nav .fleet').count(), 'the fleet column beside the item').toBe(width >= BESIDE_FROM ? 0 : 1);
        if (beside) {
          const geo = await page.evaluate(() => {
            const list = document.querySelector('.wl-beside')!.getBoundingClientRect();
            const it = document.querySelector('.shell-detail .wl-route')!.getBoundingClientRect();
            const current = document.querySelector('.wl-beside .wl-item[aria-current="page"]')?.getAttribute('data-item') ?? null;
            return { side: list.right <= it.left + 0.5, top: list.top <= it.bottom && it.top <= list.bottom, current };
          });
          expect(geo, 'the list is to the left of the item, beside it, the open item marked').toEqual({ side: true, top: true, current: '1' });
          await page.click('.wl-beside .wl-item[data-item="3"]');
          await page.waitForFunction(() => location.pathname === '/waiting/3');
          expect(await drawn(page, '.shell-nav .wl-beside')).toBe(true);
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

  // Instrument draws the fleet's banner stack inside the fleet column, which the item route's column replaces on a desk; the
  // stack must show there exactly as on the list (fix round 1, F1). Refined draws it under its bar on every route.
  for (const width of [900, 1280] as const) {
    it(`at ${width}: the fleet's banners show on an item as on the list (a critical disk banner), once`, async () => {
      for (const path of ['/waiting', '/waiting/1']) {
        const { ctx, page, errors } = await open(skin, width, path, ITEMS, false, path === '/waiting' ? '.wl-grid' : '.wi', CRITICAL_DISK);
        try {
          await page.waitForSelector('[data-banner="disk"] [role="status"]', { timeout: 20_000 });
          expect(await page.locator('[data-banner="disk"]').count(), `one disk banner on ${path}`).toBe(1);
          expect(await drawn(page, '[data-banner="disk"] [role="status"]'), `the disk banner is drawn on ${path}`).toBe(true);
          if (path !== '/waiting') expect(await drawn(page, '.shell-nav .wl-beside'), 'the list is still beside the item').toBe(true);
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }
    });

    // Follow-up F1: on the item route the stack keeps the fleet column's spacing, so a banner sits where it sits on the list:
    // its left and right gutters and the gap above it, inside the left column in Instrument (`.shell-nav`), and its own box
    // under the bar in Refined, which this round leaves as it was.
    it(`at ${width}: a banner on an item keeps the gutters and the gap above it that it has on the list`, async () => {
      const at: Record<string, { left: number; right: number; top: number }> = {};
      for (const path of ['/waiting', '/waiting/1']) {
        const { ctx, page, errors } = await open(skin, width, path, ITEMS, false, path === '/waiting' ? '.wl-grid' : '.wi', CRITICAL_DISK);
        try {
          await page.waitForSelector('[data-banner="disk"] [role="status"]', { timeout: 20_000 });
          at[path] = await page.evaluate((inNav) => {
            const banner = document.querySelector('[data-banner="disk"] > *')!.getBoundingClientRect();
            if (!inNav) return { left: banner.left, right: banner.right, top: banner.top };
            const nav = document.querySelector('.shell-nav')!.getBoundingClientRect();
            return { left: banner.left - nav.left, right: nav.right - banner.right, top: banner.top - nav.top };
          }, skin === INSTRUMENT);
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }
      const [list, item] = [at['/waiting']!, at['/waiting/1']!];
      expect(Math.abs(item.left - list.left), `left gutter ${JSON.stringify(at)}`).toBeLessThanOrEqual(1);
      expect(Math.abs(item.right - list.right), `right gutter ${JSON.stringify(at)}`).toBeLessThanOrEqual(1);
      expect(Math.abs(item.top - list.top), `gap above ${JSON.stringify(at)}`).toBeLessThanOrEqual(1);
    });

    // Carry C (D-7951), review 1408 F1: slots stay mounted while their banner does not show, so with no banner to show the box
    // must take no room: the list beside the item starts at the top of the left column, as it did before the box (Instrument).
    // Refined draws no box there at all; its one stack is under its bar, and that box takes no room either by its own `:has`
    // test, so Refined's branch bears load on that rule (review 1437 A3: it passed with or without the gate before).
    it(`at ${width}: with no banner to show, the box above the list beside an item takes no room`, async () => {
      const { ctx, page, errors } = await open(skin, width, '/waiting/1');
      try {
        await page.waitForSelector('.shell-nav .wl-beside', { timeout: 20_000 });
        const desk = await page.evaluate(() => {
          const box = document.querySelector<HTMLElement>('.ref-frame > .shell-banners');
          if (box === null) return null;
          return { shown: box.querySelectorAll(':scope > .banner-slot > *, :scope > .banner-more').length, height: box.getBoundingClientRect().height };
        });
        const at = await page.evaluate(() => {
          const box = document.querySelector<HTMLElement>('.shell-nav .wl-banners');
          if (box === null) return null;
          const shown = box.querySelectorAll(':scope > .banner-slot > *, :scope > .banner-more').length;
          const r = box.getBoundingClientRect();
          const nav = document.querySelector('.shell-nav')!.getBoundingClientRect();
          const beside = document.querySelector('.shell-nav .wl-beside')!.getBoundingClientRect();
          return { shown, height: r.height, besideTop: beside.top - nav.top };
        });
        if (skin === INSTRUMENT) {
          expect(at, 'the box is mounted in Instrument').not.toBeNull();
          expect(at!.shown, 'no banner shows in this fixture').toBe(0);
          expect(at!.height, `the empty box's height ${JSON.stringify(at)}`).toBeLessThanOrEqual(0.5);
          expect(at!.besideTop, `the list's top in the column ${JSON.stringify(at)}`).toBeLessThanOrEqual(0.5);
        } else {
          expect(at, 'Refined draws its stack under its bar, not in the column').toBeNull();
          expect(desk, 'Refined\'s stack under its bar').not.toBeNull();
          expect(desk!.shown, 'no banner shows in this fixture').toBe(0);
          expect(desk!.height, `Refined's empty stack under its bar ${JSON.stringify(desk)}`).toBeLessThanOrEqual(0.5);
        }
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });

    it(`at ${width}: the bare list keeps the fleet in the left column, and its own list in the detail pane`, async () => {
      const { ctx, page, errors } = await open(skin, width, '/waiting', ITEMS, false, '.wl-grid');
      try {
        expect(await page.locator('.shell-nav .fleet').count(), 'the fleet column').toBe(1);
        expect(await page.locator('.wl-beside').count(), 'no list beside').toBe(0);
        expect(await drawn(page, '.shell-detail .wl-grid'), 'the list in the detail pane').toBe(true);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }

  it('at 1920: the strip ends where the item does, so the position and the steps line up with it', async () => {
    const { ctx, page } = await open(skin, 1920, '/waiting/2');
    try {
      const edges = await page.evaluate(() => ({
        strip: document.querySelector('.wi-nav')!.getBoundingClientRect().right,
        item: document.querySelector('.shell-detail .wi')!.getBoundingClientRect().right,
        steps: document.querySelector('.wi-nav .wi-steps-nav')!.getBoundingClientRect().right,
      }));
      expect(Math.abs(edges.strip - edges.item), JSON.stringify(edges)).toBeLessThanOrEqual(1);
      expect(edges.steps).toBeLessThanOrEqual(edges.item + 0.5);
    } finally {
      await ctx.close();
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
