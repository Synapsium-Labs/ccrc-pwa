// D-8558: a refused close whose coordinator the registry no longer holds, on /waiting, measured in a real Chrome over the production
// build at 390, 1280 and 1920, in both skins and a light and a dark palette. The jsdom suite (test/waiting-screen.test.tsx) pins the
// words and the calls; this file holds what it cannot: that the item's three doors (Close this run, Hand to a coordinator, Close and
// end the programme) sit on the row at the tap floor with no sideways scroll, and that the close-run sheet (its reasons, the typed
// reason and the programme's end) fits each width with Close this run and Keep it reachable. Names are neutral: the repository is
// public.
//
//   CCRC_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./node_modules/.bin/vitest run --config vitest.browser.config.ts --maxWorkers=2 browser/waiting-close-run.browser.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, REFINED, THEMES } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer } from './app';

const NOW = Date.now();
const MIN = 60_000;

// A planned run of a programme whose coordinator was forgotten: no fleet row names it, so nothing on the page can open it.
const RUN = {
  id: 201, program: 'prog-c', programTitle: 'Programme C with a title long enough to wrap on a phone', wave: 1, waveOf: 1,
  project: 'project-a', homeProject: 'project-a', sessionId: null, workspace: null, branch: null, state: 'planned', kind: 'work',
  reviews: null, claimedBy: 'prog-c-gone', resumed: false, clearedAt: null, openedAt: NOW - 30 * 24 * 60 * MIN, dispatchStartedAt: null,
  dispatchedAt: null, closedAt: null, handoffCommit: null, items: { done: 0, total: 0 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: false,
    clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, reviewCap: null, hadChild: false,
};
const DOORS = ['close-run', 'hand-to-coordinator', 'end-programme'];
const WAITING = {
  items: [{
    id: 7, program: 'prog-c', runId: 201, kind: 'do', title: 'Coordinator not reached: Programme C, wave 1 of 1',
    why: 'ccrc would close this run on its own after a warning, but the warning could not be delivered.\nIts coordinator is gone, and its session no longer exists',
    how: ['Read why ccrc did not close it.', 'Take the control on this row.'], options: null, neededBy: 'soon', soonLabel: null,
    state: 'open', stale: false, raisedAt: NOW - 20 * MIN, tickedAt: null, closedAt: null, answer: null, note: null, secretSlot: null,
    secretSet: null, history: [{ at: NOW - 20 * MIN, act: 'raise', note: null }],
    action: { verb: 'close-refused', runId: 201, doors: DOORS },
  }],
  cleared: [],
  goals: [],
};
const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false }] },
    '/api/runs': [RUN], '/api/claims': [], '/api/waiting': { ok: true, waiting: WAITING },
  },
  fleetFrames: [{ type: 'fleet', sessions: [] }, { type: 'runs', runs: [RUN] }, { type: 'waiting', waiting: WAITING }],
};

const SKINS = [REFINED, INSTRUMENT] as const;
const WIDTHS = [390, 1280, 1920] as const;
const ALL_PALETTES = THEMES.map((t) => t.id);
const PALETTES = [ALL_PALETTES[0]!, ALL_PALETTES[ALL_PALETTES.length - 1]!];
const TAP_FLOOR = 44;

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

async function open(skin: string, theme: string, width: number): Promise<{ ctx: Awaited<ReturnType<typeof openApp>>['ctx']; page: Page; errors: string[] }> {
  const opened = await openApp(browser!, { skin, theme, width }, FIXTURE);
  await opened.page.goto(`${server!.origin}/waiting`);
  await opened.page.waitForSelector('.wl-acts', { timeout: 20_000 });
  await opened.page.evaluate(async () => { await document.fonts.ready; });
  await opened.page.waitForTimeout(250);
  return opened;
}

const sideways = (): number => document.documentElement.scrollWidth - document.documentElement.clientWidth;
const doorBoxes = (): { door: string; left: number; right: number; height: number }[] =>
  [...document.querySelectorAll<HTMLElement>('.wl-acts [data-door]')].map((d) => {
    const r = d.getBoundingClientRect();
    return { door: d.dataset['door'] ?? '', left: r.left, right: r.right, height: r.height };
  });

describe.each(SKINS)('a refused close under a forgotten coordinator, in %s', (skin) => {
  for (const theme of PALETTES) {
    for (const width of WIDTHS) {
      it(`at ${width} (${theme}): three doors and no dead one, at the tap floor, inside the row, no sideways scroll`, async () => {
        const { ctx, page, errors } = await open(skin, theme, width);
        try {
          expect(await page.evaluate(sideways), 'sideways scroll').toBe(0);
          const doors = await page.evaluate(doorBoxes);
          expect(doors.map((d) => d.door)).toEqual(DOORS);
          for (const d of doors) {
            expect(d.height, `${d.door} reaches the ${TAP_FLOOR}px floor`).toBeGreaterThanOrEqual(TAP_FLOOR - 0.5);
            expect(d.left, `${d.door} left edge`).toBeGreaterThanOrEqual(0);
            expect(d.right, `${d.door} right edge`).toBeLessThanOrEqual(width + 0.5);
          }
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      });
    }
  }

  for (const width of WIDTHS) {
    it(`the close-run sheet at ${width}: its reasons, the typed reason and the programme's end fit, and both answers are reachable`, async () => {
      const { ctx, page, errors } = await open(skin, PALETTES[0]!, width);
      try {
        await page.getByRole('button', { name: 'Close and end the programme', exact: true }).click();
        await page.getByText('Close run 201?').waitFor({ timeout: 10_000 });
        await page.waitForTimeout(600); // the phone sheet slides in before it is measured
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('Something else').check();
        await dialog.getByLabel('The reason, in a few words').fill('landed in another programme');
        expect(await dialog.getByLabel('End it: its work is done').isChecked(), 'the end door opens with done picked').toBe(true);
        expect(await page.evaluate(sideways), 'sideways scroll').toBe(0);
        const overflow = await page.evaluate(() => {
          const body = document.querySelector<HTMLElement>('.sheet-body') ?? document.querySelector<HTMLElement>('.sheet-panel')!;
          return body.scrollWidth - body.clientWidth;
        });
        expect(overflow, 'no sideways scroll in the sheet').toBeLessThanOrEqual(1);
        const vh = page.viewportSize()!.height;
        for (const name of ['Close this run', 'Keep it']) {
          const b = await dialog.getByRole('button', { name, exact: true }).boundingBox();
          expect(b, `${name} is drawn`).not.toBeNull();
          expect(b!.x).toBeGreaterThanOrEqual(0);
          expect(b!.x + b!.width, `${name} inside the width`).toBeLessThanOrEqual(width + 0.5);
          expect(b!.y + b!.height, `${name} inside the height`).toBeLessThanOrEqual(vh + 0.5);
          expect(b!.height, `${name} at the tap floor`).toBeGreaterThanOrEqual(TAP_FLOOR - 1);
        }
        const field = await dialog.getByLabel('The reason, in a few words').boundingBox();
        expect(field!.x + field!.width, 'the reason field is inside the width').toBeLessThanOrEqual(width + 0.5);
        expect(await dialog.getByRole('button', { name: 'Close this run', exact: true }).isEnabled()).toBe(true);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});
