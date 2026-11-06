// Names in chat open their objects (chat reading Task L, D-8062; spec 2026-11-06 section 4), in a real Chrome over the
// production build, at 1280 and 390 in Refined. One assistant message names a run, an item, a document and a PR. Following
// `run 1527` lands on the runs board with that run's row marked and in view; `item 340` opens the item; the document path
// opens the Docs reader at the session's branch (`?ref=ws/one`); `#651` opens a new page with no opener. The jsdom suites
// (test/chat-links.test.tsx, chat-refs.test.ts, runs-arrival.test.tsx) pin the markup and the decisions; this file holds the
// whole path through the shell's router, its pane reset and a real popup. Names are neutral: the repository is public.
//
//   CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/chat-links.browser.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer, type OpenedApp } from './app';

const NOW = Date.now();
const MIN = 60_000;

const SESSION = {
  id: 'project-a-one', wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: '/w/project-a/one',
  workspace: 'one', name: 'one', status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false,
  version: null, model: null, effort: null, ultracode: false, branch: 'ws/one', ctxPct: null, paneCols: null,
  tasks: null, pr: null, archivedAt: null, archivedBytes: null, held: null, hookState: null, askSummary: null,
  subagents: null, background: null, withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket: 'working',
  unmeasured: [], started: true, child: { kind: 'none' },
};

const run = (id: number, workspace: string): object => ({
  id, program: 'prog-a', programTitle: 'Programme A', wave: 2, waveOf: 5, project: 'project-a', homeProject: 'project-a',
  sessionId: null, workspace, branch: `ws/${workspace}`, state: 'working', kind: 'work', reviews: null,
  claimedBy: 'project-a-coord', resumed: false, clearedAt: null, openedAt: NOW - 3_600_000, dispatchStartedAt: null,
  dispatchedAt: NOW - 3_000_000, closedAt: null, handoffCommit: null, items: { done: 0, total: 0 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: false,
    clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, reviewCap: null,
});
/** Enough runs ahead of 1527 that its row starts below the fold at 390: the arrival has to scroll. Run 12 is a small id the
 *  console holds, so "run 12" links only through the held ids `SessionScreen` passes (review 1586 F5). */
const RUNS = [...Array.from({ length: 24 }, (_, i) => run(1500 + i, `ws-${i}`)), run(1527, 'ws-target'), run(12, 'ws-small')];

const ITEM = {
  id: 340, program: 'prog-a', runId: null, kind: 'do', title: 'Item 340 title', why: 'Why this is needed.',
  how: ['Open Settings.'], options: null, recommended: null, recommendedWhy: null, neededBy: 'soon', soonLabel: null,
  state: 'open', stale: false, raisedAt: NOW - 20 * MIN, tickedAt: null, closedAt: null, answer: null, note: null,
  secretSlot: null, secretSet: null, history: [{ at: NOW - 20 * MIN, act: 'raise', note: null }],
};
/** A small id the console holds only in its cleared trail: "item 41" links only through it (review 1586 F5). */
const CLEARED = {
  ...ITEM, id: 41, title: 'Item 41 title', state: 'done', tickedAt: NOW - 10 * MIN, closedAt: NOW - 10 * MIN,
  history: [{ at: NOW - 20 * MIN, act: 'raise', note: null }, { at: NOW - 10 * MIN, act: 'tick', note: null }],
};
const WAITING = { items: [ITEM], cleared: [CLEARED], goals: [] };

const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': {
      accounts: [], projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false }],
    },
    '/api/projects': {
      roots: ['/w'],
      projects: [{ name: 'project-a', workdir: '/w/project-a', repo: { state: 'named', slug: 'owner-a/repo-a' } }],
    },
    '/api/runs': { runs: [], nextBefore: null }, '/api/claims': [], '/api/waiting': { ok: true, waiting: WAITING },
    // The board's caps dial reads this; an empty answer would stop the board.
    '/api/coord/caps': { ok: true, caps: { maxConcurrentWorkers: 4 }, usage: { running: 1 }, updatedAt: null },
  },
  fleetFrames: [
    { type: 'fleet', sessions: [SESSION] }, { type: 'runs', runs: RUNS }, { type: 'waiting', waiting: WAITING },
    // The pools frame starts the projects read (`useProjectRows`), which carries the project's measured repository.
    { type: 'pools', pools: { listed: false, enforcement: 'unknown', accountPools: 'unavailable' } },
  ],
};

const TS = new Date(NOW - 10 * MIN).toISOString();
const TEXT = 'Waiting on run 1527 and item 340. The plan is docs/superpowers/specs/2026-11-06-x-design.md, merged in #651.';
/** Held small ids, and names written as a link's text (review 1586 F1 and F5). */
const HELD = 'Held: run 12 and item 41. See [`run 1526`](/runs) and [`#652`](https://example.com/x).';
const EVENTS: object[] = [
  { kind: 'user', uuid: 'u1', ts: TS, text: 'Where are we?' },
  { kind: 'assistant', uuid: 'a1', ts: TS, text: TEXT },
  { kind: 'assistant', uuid: 'a2', ts: TS, text: HELD },
];

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

/** The session's chat at `width`, its message drawn. */
async function openChat(width: number): Promise<OpenedApp> {
  const opened = await openApp(browser!, { skin: REFINED, theme: 'light', width }, FIXTURE);
  await opened.ctx.routeWebSocket(/\/ws\/session\//, (ws) => {
    ws.send(JSON.stringify({
      type: 'backlog', uuid: 'u-1', events: EVENTS, offset: 1, file: '/w/t.jsonl', missing: false,
      searchComplete: true, fileMeasured: true,
    }));
  });
  await opened.page.goto(`${server!.origin}/s/${SESSION.id}`);
  await opened.page.getByText('Waiting on', { exact: false }).first().waitFor({ timeout: 20_000 });
  return opened;
}

/** The chat with its second message, the held ids and the names written as a link's text, drawn too. */
async function openHeld(width: number): Promise<OpenedApp> {
  const opened = await openChat(width);
  await opened.page.getByText('Held:', { exact: false }).first().waitFor({ timeout: 20_000 });
  return opened;
}

/** The chat's link whose text is `name`. */
const link = (page: Page, name: string) => page.locator('.msg-assist a', { hasText: name });

const here = (page: Page): Promise<string> => page.evaluate(() => location.pathname + location.search);

for (const width of [1280, 390]) {
  describe(`names in chat open their objects, Refined at ${width}px (D-8062)`, () => {
    it('run 1527 lands on the board with its row marked and in view', async () => {
      const { ctx, page, errors } = await openChat(width);
      try {
        const a = link(page, 'run 1527');
        await a.scrollIntoViewIfNeeded();
        await a.click();
        await page.locator('.run-row[data-arrived="true"]').waitFor({ timeout: 20_000 });
        expect(await here(page)).toBe('/runs?run=1527');
        const row = await page.evaluate(() => {
          const el = document.querySelector<HTMLElement>('.run-row[data-arrived="true"]')!;
          const r = el.getBoundingClientRect();
          return {
            title: el.title, focused: document.activeElement === el, top: r.top, bottom: r.bottom, vh: innerHeight,
            marked: document.querySelectorAll('[data-arrived]').length,
          };
        });
        expect(row.title.startsWith('run 1527 '), row.title).toBe(true);
        expect(row.focused, 'the arrived row has focus').toBe(true);
        expect(row.marked, 'one row is marked').toBe(1);
        expect(row.top >= 0 && row.bottom <= row.vh, `the row is in view: ${row.top}..${row.bottom} of ${row.vh}`).toBe(true);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });

    it('item 340 opens the item', async () => {
      const { ctx, page, errors } = await openChat(width);
      try {
        const a = link(page, 'item 340');
        await a.scrollIntoViewIfNeeded();
        await a.click();
        await page.waitForSelector('.wi', { timeout: 20_000 });
        expect(await here(page)).toBe('/waiting/340');
        await page.getByText('Item 340 title').first().waitFor({ timeout: 20_000 });
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });

    it('a document path opens the Docs reader at the session\'s branch', async () => {
      const { ctx, page } = await openChat(width);
      try {
        const a = link(page, 'docs/superpowers/specs/2026-11-06-x-design.md');
        expect(await a.getAttribute('href')).toBe('/docs/project-a/specs/2026-11-06-x-design.md?ref=ws/one');
        await a.scrollIntoViewIfNeeded();
        await a.click();
        await page.waitForFunction(() => location.pathname.startsWith('/docs/'), undefined, { timeout: 20_000 });
        expect(await here(page)).toBe('/docs/project-a/specs/2026-11-06-x-design.md?ref=ws/one');
      } finally {
        await ctx.close();
      }
    });

    it('a held small run and a cleared item link through the ids the console holds', async () => {
      const { ctx, page, errors } = await openHeld(width);
      try {
        expect(await link(page, 'run 12').getAttribute('href')).toBe('/runs?run=12');
        const a = link(page, 'item 41');
        expect(await a.getAttribute('href')).toBe('/waiting/41');
        await a.scrollIntoViewIfNeeded();
        await a.click();
        await page.getByText('Item 41 title').first().waitFor({ timeout: 20_000 });
        expect(await here(page)).toBe('/waiting/41');
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });

    it('a name written as a link\'s text draws that link alone, and one click does the link\'s one thing', async () => {
      const { ctx, page, errors } = await openHeld(width);
      try {
        const nested = await page.evaluate(() => document.querySelectorAll('.msg-assist a a').length);
        expect(nested, 'no link inside a link').toBe(0);
        const pr = link(page, '#652');
        expect(await pr.count()).toBe(1);
        expect(await pr.getAttribute('href')).toBe('https://example.com/x');
        const board = link(page, 'run 1526');
        expect(await board.count()).toBe(1);
        expect(await board.getAttribute('href')).toBe('/runs');
        let popups = 0;
        page.on('popup', () => { popups += 1; });
        await board.scrollIntoViewIfNeeded();
        await board.click();
        await page.waitForFunction(() => location.pathname === '/runs', undefined, { timeout: 20_000 });
        expect(await here(page), 'the link\'s own address, never the name\'s').toBe('/runs');
        expect(popups).toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });

    it('#651 opens a new page with no opener', async () => {
      const { ctx, page, errors } = await openChat(width);
      try {
        await ctx.route('https://github.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>issue</p>' }));
        const a = link(page, '#651');
        expect(await a.getAttribute('href')).toBe('https://github.com/owner-a/repo-a/issues/651');
        await a.scrollIntoViewIfNeeded();
        const [popup] = await Promise.all([page.waitForEvent('popup', { timeout: 20_000 }), a.click()]);
        await popup.waitForLoadState('domcontentloaded');
        expect(popup.url()).toBe('https://github.com/owner-a/repo-a/issues/651');
        expect(await popup.evaluate(() => window.opener === null)).toBe(true);
        expect(await here(page), 'the app stays on the session').toBe(`/s/${SESSION.id}`);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  });
}
