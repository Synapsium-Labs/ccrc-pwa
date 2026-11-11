// The digest's "Out of step" section at every width (D-5923; plan Task DT4, D-5924; spec 2026-10-20 §4.6), in a real Chrome
// over the production build: 360, 390, 1280 and 1920 wide, both skins, both themes. jsdom cannot lay a line out, so what a
// line FITS is measured here: no sideways page scroll, every line inside its box and the window, a long id broken inside
// its line, every line with a target at its row's floor (`--row-h`: the tap floor under a touch screen, Instrument's
// dense row under a fine pointer, D-5461), and a tap on a run line landing on `/runs/<id>` and on a session
// line on `/s/<id>`. Names are neutral.
//
//   CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/digest-widths.browser.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import {
  FIXTURE_NOW_MS, fleetApi, fleetFixture, fleetFrame, openApp, serveDist, sharedDist, type AppFixture, type DistServer,
  type OpenedApp,
} from './app';

const MATRIX = { widths: [360, 390, 1280, 1920], skins: [REFINED, INSTRUMENT], themes: ['light', 'dark'] } as const;

const H = 3_600_000;
const DAY_END = Date.parse('2026-11-10T07:00:00Z');
const data = fleetFixture(2);
const zero = { 'run-quiet': 0, 'claimant-gone': 0, 'mail-parked': 0, 'mail-held': 0, 'parent-mismatch': 0, 'review-waiting': 0,
  'question-orphaned': 0 };
const LONG = `project-a-${'very-long-session-name-'.repeat(6)}end`;
const DRIFT = {
  totals: { ...zero, 'run-quiet': 1, 'mail-parked': 1, 'question-orphaned': 1, 'parent-mismatch': 1 },
  lines: [
    { key: 'run-quiet:12', kind: 'run-quiet', subject: JSON.stringify({ runId: 12, program: 'prog-a' }), detail: 'd', ageMs: 30 * H,
      sessionId: null, runId: 12 },
    { key: 'mail-parked:4', kind: 'mail-parked', subject: JSON.stringify({ deliveryId: 4, sessionId: 'ws-0' }), detail: 'd',
      ageMs: 3 * 24 * H, sessionId: 'ws-0', runId: null },
    { key: 'question-orphaned:ask:7', kind: 'question-orphaned', subject: JSON.stringify({ askId: 7, sessionId: LONG }), detail: 'd',
      ageMs: 5 * H, sessionId: LONG, runId: null },
    { key: 'parent-mismatch:ws-1', kind: 'parent-mismatch', subject: JSON.stringify({ sessionId: 'ws-1', runId: 12 }), detail: 'd',
      ageMs: 40 * 60_000, sessionId: 'ws-1', runId: null },
  ],
};
const DIGEST = {
  v: 1, day: '2026-11-10', hourUtc: 7, fromMs: DAY_END - 24 * H, toMs: DAY_END,
  totals: { decisions: 0, answers: 0, allows: 0, denies: 0, handOvers: 0, lapses: 0, calls: 0, guardForbidden: 0 },
  byCoordinator: [], lines: [], drift: DRIFT, sentAt: null, pushed: false,
};
const RUN = {
  id: 12, program: 'prog-a', programTitle: 'Programme A', wave: 1, waveOf: 2, project: 'project-a', homeProject: 'project-a',
  sessionId: null, workspace: null, branch: null, state: 'working', kind: 'work', reviews: null, claimedBy: null, resumed: false,
  clearedAt: null, openedAt: FIXTURE_NOW_MS - 30 * H, dispatchStartedAt: null, dispatchedAt: null, closedAt: null,
  handoffCommit: null, items: { done: 0, total: 1 }, unreadMail: 0, childReclaim: null, reviewCap: null, hadChild: false,
};

const FIXTURE: AppFixture = {
  api: fleetApi(data, { '/api/digest': DIGEST, '/api/runs': { runs: [RUN], nextBefore: null } }),
  fleetFrames: [fleetFrame(data.sessions), { type: 'runs', runs: [RUN] }],
};

let server: DistServer | undefined;
let browser: Browser | undefined;

beforeAll(async () => {
  const executablePath = resolveChrome(); // throws on a box with no Chrome: red, never skipped
  server = await serveDist(sharedDist());
  browser = await chromium.launch({ executablePath, headless: true });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

async function openDigest(width: number, skin: string, theme: string): Promise<OpenedApp> {
  const opened = await openApp(browser!, { skin, theme, width }, FIXTURE);
  await opened.page.goto(`${server!.origin}/digest`);
  await opened.page.locator('.digest-drift-line').first().waitFor({ timeout: 20_000 });
  // The session and run lines are controls only once the fleet's frames have landed.
  await opened.page.locator('.digest-drift-open').nth(2).waitFor({ timeout: 20_000 });
  return opened;
}

for (const width of MATRIX.widths) {
  for (const skin of MATRIX.skins) {
    for (const theme of MATRIX.themes) {
      describe(`the digest's Out of step section, ${skin} ${theme} at ${width}px`, () => {
        it('lays every line inside its box with no sideways scroll, each control at its row floor', async () => {
          const { ctx, page, errors } = await openDigest(width, skin, theme);
          try {
            const m = await page.evaluate(() => {
              const probe = document.createElement('div');
              probe.style.cssText = 'position:absolute;visibility:hidden;min-height:var(--row-h);width:1px';
              document.body.appendChild(probe);
              const floor = probe.getBoundingClientRect().height;
              probe.remove();
              const lines = [...document.querySelectorAll<HTMLElement>('.digest-drift-line')].map((li) => {
                const r = li.getBoundingClientRect();
                const open = li.querySelector<HTMLElement>('.digest-drift-open');
                const subject = li.querySelector<HTMLElement>('.digest-drift-subject')!;
                return {
                  kind: li.dataset['kind'] ?? '', overflow: li.scrollWidth - li.clientWidth, left: r.left, right: r.right,
                  open: open === null ? null : open.getBoundingClientRect().height,
                  subjectOverflow: subject.scrollWidth - subject.clientWidth,
                  why: li.querySelector('.digest-drift-why')?.textContent ?? null,
                };
              });
              return {
                floor, lines, vw: innerWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                title: document.querySelector('.digest-drift-title')?.textContent ?? null,
                totals: document.querySelector('.digest-drift-totals')?.textContent ?? null,
              };
            });
            expect(m.title).toBe('Out of step');
            expect(m.totals).toBe('1 run quiet · 1 mail parked · 1 wrong parent · 1 question orphaned');
            expect(m.lines.map((l) => l.kind)).toEqual(['run-quiet', 'mail-parked', 'question-orphaned', 'parent-mismatch']);
            expect(m.page, 'no sideways page scroll').toBeLessThanOrEqual(0);
            for (const l of m.lines) {
              expect(l.overflow, `${l.kind} fits its box`).toBeLessThanOrEqual(1);
              expect(l.subjectOverflow, `${l.kind}'s subject breaks inside its line`).toBeLessThanOrEqual(1);
              expect(l.right, `${l.kind} ends inside the window`).toBeLessThanOrEqual(m.vw + 1);
              expect(l.left, `${l.kind} starts inside the window`).toBeGreaterThanOrEqual(-1);
              if (l.open !== null) expect(l.open, `${l.kind} at its row floor`).toBeGreaterThanOrEqual(m.floor - 1);
            }
            // The orphaned question names a session the fleet no longer lists: no control, and the word says why.
            expect(m.lines[2]!.open).toBeNull();
            expect(m.lines[2]!.why).toBe('session gone');
            expect(errors.filter((e) => !e.includes('Transition was skipped'))).toEqual([]);
          } finally {
            await ctx.close();
          }
        });
      });
    }
    it(`${skin} at ${width}px: a run line opens /runs/<id> and a session line /s/<id>`, async () => {
      const { ctx, page, errors } = await openDigest(width, skin, 'light');
      try {
        await page.locator('.digest-drift-line[data-kind="run-quiet"] .digest-drift-open').click();
        await page.waitForFunction(() => location.pathname === '/runs/12', undefined, { timeout: 20_000 });
        await page.goBack();
        await page.locator('.digest-drift-open').nth(2).waitFor({ timeout: 20_000 });
        await page.locator('.digest-drift-line[data-kind="mail-parked"] .digest-drift-open').click();
        await page.waitForFunction(() => location.pathname === '/s/ws-0', undefined, { timeout: 20_000 });
        expect(errors.filter((e) => !e.includes('Transition was skipped'))).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
}
