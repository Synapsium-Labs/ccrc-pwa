// The archive sheet's coordinator question in a real Chrome (D-8199), over the production build: 360, 390, 1280 and 1920
// wide, both skins, both themes. Archiving a coordinator that claims open runs asks what happens to them — Release, Hand
// over to a live coordinator picked from its project's, or End programme — one tap, then a confirm. jsdom lays nothing
// out, so what the sheet FITS is measured here: every answer and the picker inside the window, at the tap floor, and
// nothing running sideways, on the question and on the confirm.
//
//   CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/archive-claims-sheet.browser.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer, type OpenedApp } from './app';
import { withRunBinding } from '../test/runBindingFixture';

const NOW = Date.now();
const MIN = 60_000;
const COORD = 'project-a-coord';
const HEIR = 'project-a-heir';

const session = (id: string, name: string, role: string): object => ({
  id, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: `/w/project-a/${id}`,
  workspace: id, name, status: 'idle', statusUpdatedAt: NOW - MIN, limits: null, dialogPending: false, version: null,
  model: 'opus', effort: 'high', ultracode: false, branch: `ws/${id}`, ctxPct: 40, paneCols: null, tasks: null, pr: null,
  archivedAt: null, archivedBytes: null, held: null, hookState: null, askSummary: null, subagents: null, background: null,
  withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket: 'idle', bucketSince: NOW - 6 * MIN, unmeasured: [],
  started: true, child: { kind: 'none' }, role, presence: 'alive',
});

// The longest programme name the sheet lists, so the runs line wraps rather than runs sideways.
const PROGRAM = `programme-a-${'long-name-'.repeat(5)}end`;
let runId = 300;
const run = (sessionId: string, wave: number): object => ({
  id: runId++, program: PROGRAM, programTitle: 'Programme A', wave, waveOf: 5, project: 'project-a', homeProject: 'project-a',
  sessionId, workspace: sessionId, branch: `ws/${sessionId}`, state: 'working', kind: 'work', reviews: null, claimedBy: COORD,
  resumed: false, clearedAt: null, openedAt: NOW - 3_600_000, dispatchStartedAt: null, dispatchedAt: NOW - 3_000_000,
  closedAt: null, handoffCommit: null, items: { done: 0, total: 0 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: false,
    clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, reviewCap: null, hadChild: false,
});

const SESSIONS = [
  session(COORD, 'coordinator-a', 'coordinator'),
  // A long name, so the picker's chosen option and the confirm's title are the worst case.
  session(HEIR, `heir-with-a-${'long-name-'.repeat(3)}end`, 'coordinator'),
  session('project-a-w1', 'w1', 'child'), session('project-a-w2', 'w2', 'child'),
];
const RUNS = [run('project-a-w1', 2), run('project-a-w2', 3)];

const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false }] },
    '/api/projects': { roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a' }] },
    '/api/runs': { runs: RUNS, nextBefore: null }, '/api/claims': [],
  },
  fleetFrames: [
    { type: 'fleet', sessions: withRunBinding(SESSIONS as never[], RUNS as never[]) }, { type: 'runs', runs: RUNS },
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

/** The coordinator's session screen, its ⋯ menu, and Archive: the sheet opens on the coordinator question. */
async function openSheet(width: number, skin: string, theme: string): Promise<OpenedApp> {
  const opened = await openApp(browser!, { skin, theme, width }, FIXTURE);
  await opened.page.goto(`${server!.origin}/s/${COORD}`);
  await opened.page.waitForSelector('.chat-head .keycap--more', { timeout: 20_000 });
  await opened.page.locator('.chat-head .keycap--more').first().click();
  await opened.page.locator('[data-command="session-archive"] >> visible=true').first().click();
  await opened.page.getByText('It coordinates 2 open runs. What happens to them?').waitFor({ timeout: 20_000 });
  return opened;
}

const measure = (page: Page) => page.evaluate(async () => {
  const panel = [...document.querySelectorAll<HTMLElement>('.sheet-panel')].at(-1)!;
  await Promise.all(panel.getAnimations().map((a) => a.finished.catch(() => undefined)));
  const body = panel.querySelector<HTMLElement>('.sheet-body') ?? panel;
  const box = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { text: el.textContent ?? '', top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height };
  };
  const pr = panel.getBoundingClientRect();
  return {
    panel: { w: pr.width },
    vw: innerWidth, vh: innerHeight,
    buttons: [...panel.querySelectorAll('.sheet-footer button')].map(box),
    picker: [...panel.querySelectorAll('select')].map(box),
    pageX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    overflowX: body.scrollWidth - body.clientWidth,
  };
});

type Measured = Awaited<ReturnType<typeof measure>>;

function expectFits(m: Measured, where: string): void {
  for (const b of [...m.buttons, ...m.picker]) {
    expect(b.top, `${where}: ${b.text} starts inside the window`).toBeGreaterThanOrEqual(0);
    expect(b.bottom, `${where}: ${b.text} ends inside the window`).toBeLessThanOrEqual(m.vh + 1);
    expect(b.left, `${where}: ${b.text} left edge`).toBeGreaterThanOrEqual(0);
    expect(b.right, `${where}: ${b.text} right edge`).toBeLessThanOrEqual(m.vw + 1);
    expect(b.h, `${where}: ${b.text} at the tap floor`).toBeGreaterThanOrEqual(43);
  }
  expect(m.pageX, `${where}: no sideways page scroll`).toBeLessThanOrEqual(0);
  expect(m.overflowX, `${where}: no sideways scroll in the sheet`).toBeLessThanOrEqual(1);
}

for (const skin of [REFINED, INSTRUMENT]) {
  for (const theme of ['light', 'dark']) {
    describe(`the archive sheet's coordinator question, ${skin} ${theme}`, () => {
      for (const width of [360, 390, 1280, 1920]) {
        it(`at ${width}px the three answers, the picker and the confirm sit inside the window`, async () => {
          const { ctx, page, errors } = await openSheet(width, skin, theme);
          try {
            const asked = await measure(page);
            expect(asked.buttons.map((b) => b.text)).toEqual(['Release runs', 'Hand over', 'End programme', 'Cancel']);
            expect(asked.picker).toHaveLength(1);
            expectFits(asked, `the question at ${width}`);
            await page.getByRole('combobox', { name: 'Hand over to' }).selectOption(HEIR);
            await page.getByRole('button', { name: /^Hand over to heir-with-a-/ }).click();
            await page.getByText(/^Hand its 2 runs to heir-with-a-.* and archive\?$/).waitFor();
            const confirm = await measure(page);
            expect(confirm.buttons.map((b) => b.text)).toEqual(['Hand over and archive', 'Back', 'Cancel']);
            expectFits(confirm, `the confirm at ${width}`);
            if (width >= 1280) expect(Math.round(confirm.panel.w), 'the desk dialog is 560px wide').toBe(560);
            expect(errors).toEqual([]);
          } finally {
            await ctx.close();
          }
        });
      }
    });
  }
}
