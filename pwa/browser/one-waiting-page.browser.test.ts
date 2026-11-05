// One Waiting on you page, and Goals from inside a session (desktop-polish PL11, D-7986; spec §2 "One Waiting on you page" and
// "Goals from inside a session", D29 and D30), measured in a real Chrome over the production build at 390 and 1280 in both
// skins. The jsdom suites (test/waiting-routes.test.tsx, programme-screen.test.tsx, programme-box-card.test.tsx,
// session-header-view.test.ts, skin-switch.test.tsx) pin the markup and the paths; this file walks what an operator walks:
//   - a programme box's chip opens the one list filtered to its programme, an item opened there steps along that filtered list,
//     its way back returns to the filtered list with the rail's filter set, and clearing the filter shows every programme;
//   - a session in a programme shows the Goals icon in its chrome (a 44 px door on a phone, its word beside it at a desk), and
//     it opens that programme's Goals page; a session in no programme shows none; nothing scrolls sideways or throws.
//
// The fixture is two programmes in project-a: `prog-b` holds the blocking item and two more, `prog-a` holds two; each has a
// coordinator and one worker. `solo` is a session in no programme. Names are neutral: the repository is public.
//
// MUTATION TABLE: see docs/superpowers/plans/2026-11-01-programme-ledgers/pl11.md.
//
//   CCRC_CHROME=$HOME/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome ./node_modules/.bin/vitest run --config vitest.browser.config.ts --maxWorkers=2 browser/one-waiting-page.browser.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer } from './app';
import { GROUP_MODE_KEY } from '../src/skins/instrument/FleetTable';
import { withRunBinding } from '../test/runBindingFixture';

const NOW = Date.now();
const MIN = 60_000;

const session = (id: string, role: string): object => ({
  id, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: `/w/project-a/${id}`,
  workspace: id, name: id, status: 'idle', statusUpdatedAt: NOW - MIN, limits: null, dialogPending: false, version: null,
  model: 'opus', effort: 'high', ultracode: false, branch: `ws/${id}`, ctxPct: 40, paneCols: null, tasks: null, pr: null,
  archivedAt: null, archivedBytes: null, held: null, hookState: null, askSummary: null, subagents: null, background: null,
  withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket: 'idle', bucketSince: NOW - 6 * MIN, unmeasured: [],
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
  session('prog-a-coord', 'coordinator'), session('prog-a-w1', 'child'), session('solo', 'none'),
];
const RUNS = [run('prog-b', 'Programme B', 'prog-b-coord', 'prog-b-w1'), run('prog-a', 'Programme A', 'prog-a-coord', 'prog-a-w1')];

const item = (id: number, program: string, over: object): object => ({
  id, program, runId: null, kind: 'do', title: `Item ${id} title`, why: 'Why this is needed, in a plain sentence.',
  how: ['Open Settings.'], options: null, recommended: null, recommendedWhy: null, neededBy: 'soon', soonLabel: null,
  state: 'open', stale: false, raisedAt: NOW - 20 * MIN, tickedAt: null, closedAt: null, answer: null, note: null, secretSlot: null,
  secretSet: null, history: [{ at: NOW - 20 * MIN, act: 'raise', note: null }], ...over,
});
/** The combined list draws prog-b first (it holds the blocking item): 1, 2, 3, then prog-a's 4, 5. */
const ITEMS = [
  item(1, 'prog-b', { neededBy: 'blocking' }), item(2, 'prog-b', {}), item(3, 'prog-b', { neededBy: 'later' }),
  item(4, 'prog-a', {}), item(5, 'prog-a', { neededBy: 'later' }),
];
const goals = (program: string): object => ({ program, specPath: null, inShort: null, inShortAt: null, modifications: [] });
const WAITING = { items: ITEMS, cleared: [], goals: [] };
const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false }] },
    '/api/projects': { roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a' }] },
    '/api/runs': RUNS, '/api/claims': [], '/api/waiting': { ok: true, waiting: WAITING },
    '/api/programmes/prog-a/goals': { ok: true, goals: goals('prog-a') },
    '/api/programmes/prog-b/goals': { ok: true, goals: goals('prog-b') },
    '/api/programmes/prog-a/secrets': { ok: true, program: 'prog-a', slots: [] },
  },
  fleetFrames: [
    { type: 'fleet', sessions: withRunBinding(SESSIONS as never[], RUNS as never[]) }, { type: 'runs', runs: RUNS },
    { type: 'waiting', waiting: WAITING },
  ],
};

const SKINS = [REFINED, INSTRUMENT] as const;
const WIDTHS = [390, 1280] as const;

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

/** The app at `path` in `skin` at `width`, with Instrument in its project mode (its cards draw the programme boxes), once
 *  `ready` is drawn. */
async function open(skin: string, width: number, path: string, ready: string) {
  const opened = await openApp(browser!, { skin, theme: 'light', width }, FIXTURE);
  await opened.ctx.addInitScript(([key]) => {
    try { localStorage.setItem(key, 'project'); } catch { /* the default mode is then measured */ }
  }, [GROUP_MODE_KEY] as const);
  await opened.page.goto(server!.origin + path);
  await opened.page.waitForSelector(ready, { timeout: 20_000 });
  await opened.page.evaluate(async () => { await document.fonts.ready; });
  await opened.page.waitForTimeout(300); // the first paint's transitions settle
  return opened;
}

const here = (page: Page): Promise<string> => page.evaluate(() => decodeURIComponent(location.pathname + location.search));
const sideScroll = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/** The item ids the list page draws, in its order. */
const listed = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...document.querySelectorAll('.wl-groups .wl-item[data-item]')].map((e) => e.getAttribute('data-item') ?? ''));

describe.each(SKINS)('one Waiting on you page in %s', (skin) => {
  for (const width of WIDTHS) {
    it(`at ${width}: a programme chip opens the filtered list; an item steps along it and goes back to it; clearing shows every programme`, async () => {
      const { ctx, page, errors } = await open(skin, width, '/', 'section.pg-box .pg-waiting');
      try {
        await page.locator('section.pg-box', { hasText: 'Programme A' }).locator('.pg-waiting').click();
        await page.waitForSelector('.wl-groups .wl-item');
        expect(await here(page)).toBe('/waiting?programme=prog-a');
        expect(await listed(page)).toEqual(['4', '5']);
        expect(await page.textContent('.wl-rail [aria-pressed="true"] .wl-rail-name')).toBe('Programme A');
        expect(await sideScroll(page), 'sideways scroll on the filtered list').toBe(0);

        await page.click('.wl-groups .wl-item[data-item="4"]');
        await page.waitForSelector('.wi');
        expect(await here(page)).toBe('/waiting/4?from=waiting:prog-a');
        expect(await page.textContent('.wi-nav .wi-pos')).toBe('1 of 2');
        await page.click('.wi-nav [aria-label="Next item"]');
        await page.waitForFunction(() => location.pathname === '/waiting/5');
        expect(await page.textContent('.wi-nav .wi-pos')).toBe('2 of 2');
        expect(await page.isDisabled('.wi-nav [aria-label="Next item"]'), 'the filtered list ends at its last item').toBe(true);
        expect(await sideScroll(page), 'sideways scroll on the item').toBe(0);

        await page.click('.wi-nav .wi-back');
        await page.waitForSelector('.wl-groups .wl-item');
        expect(await here(page)).toBe('/waiting?programme=prog-a');
        expect(await listed(page)).toEqual(['4', '5']);
        expect(await page.textContent('.wl-rail [aria-pressed="true"] .wl-rail-name')).toBe('Programme A');

        await page.click('.wl-rail .wl-rail-btn:has-text("All programmes")');
        await page.waitForFunction(() => location.search === '');
        expect(await here(page)).toBe('/waiting');
        expect(await listed(page)).toEqual(['1', '2', '3', '4', '5']);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});

/** The Goals door in the session's header, as drawn: its box, whether it is inside the viewport, and its visible word. */
const goalsDoor = (page: Page) => page.evaluate(() => {
  const el = document.querySelector<HTMLElement>('.chat-head .keycap--goals');
  if (el === null) return null;
  const r = el.getBoundingClientRect();
  const word = el.querySelector<HTMLElement>('.keycap-word');
  const glyph = el.querySelector('svg')!.getBoundingClientRect();
  const head = document.querySelector<HTMLElement>('.chat-head')!;
  const shown = word !== null && getComputedStyle(word).display !== 'none';
  const wr = word?.getBoundingClientRect();
  return {
    w: r.width, h: r.height, inside: r.left >= 0 && r.right <= innerWidth + 0.5 && r.width > 0,
    word: shown ? word.textContent : null,
    // Beside the glyph, on its row, as the other doors' words sit (chat.css's from-900 rule): never under it.
    beside: shown && wr !== undefined && wr.left >= glyph.right - 0.5 && wr.top < glyph.bottom && wr.bottom > glyph.top,
    headFits: head.scrollWidth <= head.clientWidth + 1,
  };
});

describe.each(SKINS)('Goals from inside a session in %s', (skin) => {
  for (const width of WIDTHS) {
    it(`at ${width}: a session in a programme shows the Goals icon at phone and desk widths, and it opens that programme's Goals page`, async () => {
      const { ctx, page, errors } = await open(skin, width, '/s/prog-a-w1', '.chat-head .keycap--goals');
      try {
        const door = await goalsDoor(page);
        expect(door, 'the Goals door').not.toBeNull();
        expect(door!.inside, 'inside the viewport').toBe(true);
        expect(door!.headFits, 'the header does not overflow').toBe(true);
        if (width < 900) {
          expect(Math.min(door!.w, door!.h), 'a 44 px door on a phone').toBeGreaterThanOrEqual(43.5);
          expect(door!.word, 'a glyph alone on a phone').toBeNull();
        } else {
          expect(door!.word, 'its word at a desk').toBe('Goals');
          expect(door!.beside, 'the word beside the glyph, on its row').toBe(true);
        }
        expect(await sideScroll(page), 'sideways scroll').toBe(0);
        await page.click('.chat-head .keycap--goals');
        await page.waitForSelector('.pv .pv-title');
        expect(await here(page)).toBe('/programmes/prog-a');
        expect(await page.textContent('.pv .pv-title')).toBe('Programme A');
        // The Goals page draws no list of its own, and links the filtered one.
        expect(await page.locator('.pv .wl-item').count()).toBe(0);
        expect(await page.getAttribute('.pv .pv-waiting a', 'href')).toBe('/waiting?programme=prog-a');
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });

    it(`at ${width}: a session in no programme shows no Goals icon`, async () => {
      const { ctx, page, errors } = await open(skin, width, '/s/solo', '.chat-head .keycap--more');
      try {
        await page.waitForTimeout(300); // the runs frame has landed: a door that would come, would have come
        expect(await page.locator('.chat-head .keycap--goals').count()).toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});
