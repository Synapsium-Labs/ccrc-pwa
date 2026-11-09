// The controls on /waiting (runs rebuild §8.7 and §10, F21, Task 24; D-8076), measured in a real Chrome over the production
// build at 360, 390, 1280, 1470 and 1920, in both skins and every palette. The jsdom suites (test/waiting-screen.test.tsx,
// item-view.test.tsx, abandon-sheet.test.tsx, keep-run-sheet.test.tsx) pin the markup, the words and the calls; this file
// holds what they cannot: that an end-run row's two controls and a review cap's Lift cap sit at the right end of the row from
// 640 up and on their own line below it, that each reaches the 44px floor, that the page never scrolls sideways, and that the
// sheets they open fit the width. Names are neutral on purpose: the repository is public.
//
//   CCRC_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./node_modules/.bin/vitest run --config vitest.browser.config.ts --maxWorkers=2 browser/waiting-controls.browser.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, REFINED, THEMES } from '@ccrc/ui';
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
const run = (id: number, program: string, title: string, claimedBy: string, sessionId: string, over: object = {}): object => ({
  id, program, programTitle: title, wave: 2, waveOf: 5, project: 'project-a', homeProject: 'project-a', sessionId, workspace: sessionId,
  branch: `ws/${sessionId}`, state: 'working', kind: 'work', reviews: null, claimedBy, resumed: false, clearedAt: null,
  openedAt: NOW - 3_600_000, dispatchStartedAt: null, dispatchedAt: NOW - 3_000_000, closedAt: null, handoffCommit: null,
  items: { done: 0, total: 0 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: false,
    clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, reviewCap: null, hadChild: false, ...over,
});

const SESSIONS = [session('prog-b-coord', 'coordinator'), session('prog-b-w1', 'child'), session('prog-a-coord', 'coordinator'), session('prog-a-w1', 'child')];
const RUNS = [
  run(100, 'prog-b', 'Programme B', 'prog-b-coord', 'prog-b-w1'),
  run(101, 'prog-a', 'Programme A', 'prog-a-coord', 'prog-a-w1', { reviewCap: { rounds: 3, cap: 3, askedAt: NOW - MIN, liftedAt: null } }),
];

const item = (id: number, program: string, over: object): object => ({
  id, program, runId: null, kind: 'do', title: `Item ${id} title`, why: 'Why this is needed, in a plain sentence that may run long enough to wrap on a phone.',
  how: ['Open Settings.', 'Set it to Live.'], options: null, neededBy: 'soon', soonLabel: null, state: 'open', stale: false,
  raisedAt: NOW - 20 * MIN, tickedAt: null, closedAt: null, answer: null, note: null, secretSlot: null, secretSet: null,
  history: [{ at: NOW - 20 * MIN, act: 'raise', note: null }], ...over,
});
const WAITING = {
  items: [
    item(1, 'prog-b', {
      runId: 100, title: 'End run: Programme B, wave 2', action: { verb: 'end-run', runId: 100, stuckReason: null },
      why: 'The worker has been silent for two days and its branch is behind main.\nIts coordinator did not answer',
    }),
    item(2, 'prog-b', { title: 'An ordinary item' }),
  ],
  cleared: [],
  goals: [],
};
const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false }] },
    '/api/runs': RUNS, '/api/claims': [], '/api/waiting': { ok: true, waiting: WAITING },
    '/api/coord/review-cap/101': { ok: true, askedAt: NOW - MIN, liftedAt: null, ask: { run: 101, rounds: 3, cap: 3, lastReview: null } },
  },
  fleetFrames: [
    { type: 'fleet', sessions: withRunBinding(SESSIONS as never[], RUNS as never[]) }, { type: 'runs', runs: RUNS },
    { type: 'waiting', waiting: WAITING },
  ],
};

const SKINS = [REFINED, INSTRUMENT] as const;
const WIDTHS = [360, 390, 1280, 1470, 1920] as const;
const PALETTES = THEMES.map((t) => t.id);
const TAP_FLOOR = 44;
/** Where the controls leave the row's line and drop below it (§8.1). */
const SIDE_FROM = 640;

let server: DistServer | undefined;
let browser: Browser | undefined;

beforeAll(async () => {
  const executablePath = resolveChrome(); // throws on a box with no Chrome: red, never skipped
  const dist = sharedDist();
  server = await serveDist(dist);
  browser = await chromium.launch({ executablePath, headless: true });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

interface Box { top: number; bottom: number; left: number; right: number; height: number }
/** The boxes of one row's pieces, in the page: the `li`, the row's own button, and the control group beside or below it. */
const boxesOf = (selector: string): { li: Box; row: Box; acts: Box; buttons: Box[] } | null => {
  const box = (el: Element): Box => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }; };
  const mark = document.querySelector(selector);
  const li = mark?.closest('li');
  const acts = li?.querySelector('.wl-acts');
  if (!mark || !li || !acts) return null;
  return { li: box(li), row: box(mark), acts: box(acts), buttons: [...acts.querySelectorAll('button')].map(box) };
};

async function open(skin: string, theme: string, width: number, path: string, ready: string): Promise<{ ctx: Awaited<ReturnType<typeof openApp>>['ctx']; page: Page; errors: string[] }> {
  const opened = await openApp(browser!, { skin, theme, width }, FIXTURE);
  await opened.page.goto(server!.origin + path);
  await opened.page.waitForSelector(ready, { timeout: 20_000 });
  await opened.page.evaluate(async () => { await document.fonts.ready; });
  await opened.page.waitForTimeout(250);
  return opened;
}

const sideways = (): number => document.documentElement.scrollWidth - document.documentElement.clientWidth;

describe.each(SKINS)('the controls on /waiting in %s', (skin) => {
  for (const theme of PALETTES) {
    for (const width of WIDTHS) {
      it(`the list at ${width} (${theme}): controls on the row from 640 and below it under, at the tap floor, no sideways scroll`, async () => {
        const { ctx, page, errors } = await open(skin, theme, width, '/waiting', '.wl-acts');
        try {
          expect(await page.evaluate(sideways), 'sideways scroll').toBe(0);
          const rows = [
            ['an end-run row', await page.evaluate(boxesOf, '.wl-item[data-item="1"]'), 2],
            ['a review cap row', await page.evaluate(boxesOf, '.wl-capitem[data-run="101"]'), 1],
          ] as const;
          for (const [name, b, n] of rows) {
            expect(b, `${name} carries its controls`).not.toBeNull();
            expect(b!.buttons, `${name}: ${n} control(s)`).toHaveLength(n);
            for (const btn of b!.buttons) expect(btn.height, `${name}: a control reaches the ${TAP_FLOOR}px floor`).toBeGreaterThanOrEqual(TAP_FLOOR - 0.5);
            // Nothing leaves the viewport on either side.
            expect(b!.acts.left, `${name}: left edge`).toBeGreaterThanOrEqual(0);
            expect(b!.acts.right, `${name}: right edge`).toBeLessThanOrEqual(width + 0.5);
            if (width >= SIDE_FROM) {
              // At the right end of the row, on the row's own line.
              expect(b!.acts.left, `${name}: beside the row`).toBeGreaterThanOrEqual(b!.row.right - 0.5);
              expect(b!.acts.top, `${name}: not below the row`).toBeLessThan(b!.row.bottom);
              expect(Math.abs(b!.li.right - b!.acts.right), `${name}: at the right end`).toBeLessThanOrEqual(1);
            } else {
              // On a line of its own below the row.
              expect(b!.acts.top, `${name}: below the row`).toBeGreaterThanOrEqual(b!.row.bottom - 0.5);
            }
          }
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      });
    }
  }

  for (const width of [1280, 1470, 1920] as const) {
    it(`the list beside an open item at ${width}: the controls sit under the row in the column, whatever the viewport`, async () => {
      const { ctx, page, errors } = await open(skin, PALETTES[0]!, width, '/waiting/2', '.wl-beside .wl-acts');
      try {
        expect(await page.evaluate(sideways), 'sideways scroll').toBe(0);
        const rows = [
          ['an end-run row', await page.evaluate(boxesOf, '.wl-beside .wl-item[data-item="1"]')],
          ['a review cap row', await page.evaluate(boxesOf, '.wl-beside .wl-capitem[data-run="101"]')],
        ] as const;
        for (const [name, b] of rows) {
          expect(b, `${name} carries its controls`).not.toBeNull();
          expect(b!.acts.top, `${name}: below the row, not beside it`).toBeGreaterThanOrEqual(b!.row.bottom - 0.5);
          // The row keeps the column's width, so its words do not break one to a line.
          expect(b!.row.right - b!.row.left, `${name}: the row is not squeezed`).toBeGreaterThan(240);
        }
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }

  for (const width of [360, 1280] as const) {
    it(`the sheets at ${width}: Abandon run, Keep the run and Lift cap each open inside the viewport with their answers reachable`, async () => {
      const { ctx, page, errors } = await open(skin, PALETTES[0]!, width, '/waiting', '.wl-acts');
      try {
        for (const [open, title, confirm] of [
          ['Abandon run', 'Abandon run 100?', 'Abandon run 100'],
          ['Keep the run', 'Keep run 100?', 'Keep the run'],
          ['Lift cap', 'Lift the review cap?', null],
        ] as const) {
          await page.getByRole('button', { name: open, exact: true }).click();
          await page.getByText(title).waitFor({ timeout: 10_000 });
          await page.waitForTimeout(600); // the phone sheet slides in before it is measured
          expect(await page.evaluate(sideways), `${open}: sideways scroll`).toBe(0);
          if (confirm !== null) {
            const b = await page.getByRole('dialog').getByRole('button', { name: confirm, exact: true }).boundingBox();
            expect(b, `${open}: the confirm is drawn`).not.toBeNull();
            expect(b!.x, `${open}: confirm left`).toBeGreaterThanOrEqual(0);
            expect(b!.x + b!.width, `${open}: confirm right`).toBeLessThanOrEqual(width + 0.5);
            expect(b!.y + b!.height, `${open}: confirm above the fold`).toBeLessThanOrEqual(page.viewportSize()!.height + 0.5);
          }
          await page.keyboard.press('Escape');
          await page.getByText(title).waitFor({ state: 'detached', timeout: 10_000 });
        }
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });

    it(`the item view at ${width}: Abandon run and Keep the run in the panel, no Mark done, no sideways scroll`, async () => {
      const { ctx, page, errors } = await open(skin, PALETTES[0]!, width, '/waiting/1', '.wi');
      try {
        expect(await page.evaluate(sideways), 'sideways scroll').toBe(0);
        const panel = page.locator('.wi-act');
        expect(await panel.getByRole('button', { name: 'Abandon run', exact: true }).count()).toBe(1);
        expect(await panel.getByRole('button', { name: 'Keep the run', exact: true }).count()).toBe(1);
        expect(await panel.getByRole('button', { name: 'Mark done' }).count()).toBe(0);
        for (const name of ['Abandon run', 'Keep the run']) {
          const b = await panel.getByRole('button', { name, exact: true }).boundingBox();
          expect(b!.height, `${name} reaches the floor`).toBeGreaterThanOrEqual(TAP_FLOOR - 0.5);
          expect(b!.x + b!.width, `${name} inside the viewport`).toBeLessThanOrEqual(width + 0.5);
        }
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});
