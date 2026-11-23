// One collapsed row per stretch of a turn's tool activity (desktop polish wave 168), in a real Chrome over the production
// build, with the real virtual list.
//
// jsdom lays nothing out and replaces virtuoso, so this file holds what only Chrome can: over a long, tool-heavy session
// in both skins, both palettes, at a phone's and a desk's width, the newest stretch reads as ONE collapsed line with its
// failed call surfaced under it; calls arriving in that closed stretch while the reader is scrolled up leave it closed
// and move nothing the reader is looking at; the row opens in place into the cards (Refined's run groups, Instrument's
// tool cards) with no sideways scroll; and the reader's open row is still open after the list unmounted it on a scroll
// to the top and mounted it again on the way back.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/tool-activity.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const VIEWS: AppView[] = [REFINED, INSTRUMENT].flatMap((skin) => [PHOSPHOR, 'light'].flatMap((theme) =>
  [390, 1280].map((width) => ({ skin, theme, width }))));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

// ---- the fixture: one session, neutral names ----------------------------------------------------------------------
const NOW = 1_792_362_479;
const SESSION = {
  id: 'project-a-one', wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: '/w/project-a/one',
  workspace: 'one', name: 'one', status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false,
  version: null, model: null, effort: null, ultracode: false, branch: 'ws/one', ctxPct: null, paneCols: null,
  tasks: null, pr: null, archivedAt: null, archivedBytes: null, held: null, hookState: null, askSummary: null,
  subagents: null, background: null, withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket: 'working',
  unmeasured: [], started: true, child: { kind: 'none' },
};
const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': {
      accounts: [{
        wrapper: 'lane-a', five: 40, seven: 50, ts: NOW, fiveResetAt: NOW + 7_800, sevenResetAt: NOW + 259_800,
        fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false,
      }],
      projected: null,
      roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', pool: null, homeAble: true, hidden: false }],
    },
    '/api/projects': { roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a' }] },
    '/api/runs': [], '/api/claims': [],
  },
  fleetFrames: [{ type: 'fleet', sessions: [SESSION] }],
};

const TS = new Date((NOW - 600) * 1000).toISOString();
/** A command wider than any column. */
const LONG_COMMAND = `cd /w/project-a && ${'npm run check-everything-in-the-workspace '.repeat(4)}--reporter=verbose`;
let k = 0;
const call = (into: object[], name: string, input: object, isError = false): void => {
  k += 1;
  into.push({ kind: 'tool_use', uuid: `u${k}`, ts: TS, toolId: `t${k}`, name, input: JSON.stringify(input) });
  into.push({ kind: 'tool_result', ts: TS, toolId: `t${k}`, text: isError ? 'exit 1' : 'ok', isError });
};
/** TURNS turns of prose and tools mixed, long enough that the list unmounts its top rows at the bottom; the last turn
 *  ends on a stretch of three calls, the middle one failed, so an append lands in that stretch. */
const TURNS = 24;
const EVENTS: object[] = [];
for (let i = 0; i < TURNS; i += 1) {
  EVENTS.push({ kind: 'user', uuid: `q${i}`, ts: TS, text: `Run step ${i}.` });
  EVENTS.push({ kind: 'assistant', uuid: `a${i}`, ts: TS, text: `Reading for step ${i}, then running it.` });
  call(EVENTS, 'Read', { file_path: `/w/project-a/src/a${i}.ts` });
  call(EVENTS, 'Bash', { command: LONG_COMMAND });
  call(EVENTS, 'Edit', { file_path: `/w/project-a/src/a${i}.ts`, old_string: 'a', new_string: 'b' });
  EVENTS.push({ kind: 'assistant', uuid: `b${i}`, ts: TS, text: `Step ${i} is done.` });
}
EVENTS.push({ kind: 'user', uuid: 'q-last', ts: TS, text: 'Last step.' });
EVENTS.push({ kind: 'assistant', uuid: 'a-last', ts: TS, text: 'Checking first.' });
call(EVENTS, 'Read', { file_path: '/w/project-a/src/last.ts' });
call(EVENTS, 'Bash', { command: 'npm test' }, true);
call(EVENTS, 'Read', { file_path: '/w/project-a/src/after.ts' });
/** Two calls that arrive later, in the last stretch. */
const LATER: object[] = [];
call(LATER, 'Grep', { pattern: 'useSkin' });
call(LATER, 'Bash', { command: 'git status' });

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

/** The newest tool-activity row on screen, and what the reader sees of it. */
async function newest(page: Page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll<HTMLElement>('.tool-activity')];
    const row = rows[rows.length - 1];
    const button = row?.querySelector<HTMLElement>('.tool-activity-row');
    return row === undefined || button === null || button === undefined ? null : {
      text: button.textContent ?? '',
      expanded: button.getAttribute('aria-expanded'),
      height: Math.round(button.getBoundingClientRect().height),
      failedSurfaced: row.querySelector('.tool-activity-first[data-attention="failed"] .tool-dot--err') !== null,
    };
  });
}

/** Scroll the transcript to a place and give the virtual list time to settle there. */
async function scrollTo(page: Page, where: 'top' | 'middle' | 'bottom'): Promise<void> {
  await page.evaluate((w) => {
    const s = document.querySelector<HTMLElement>('.chat-scroller')!;
    s.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: w === 'bottom' ? 100 : -100 }));
    s.scrollTop = w === 'top' ? 0 : w === 'middle' ? Math.round((s.scrollHeight - s.clientHeight) / 2) : s.scrollHeight;
  }, where);
  await page.waitForTimeout(600);
}

describe('one collapsed row per stretch of tool activity (desktop polish wave 168)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        let send: ((frame: object) => void) | null = null;
        await ctx.routeWebSocket(/\/ws\/session\//, (ws) => {
          send = (frame) => ws.send(JSON.stringify(frame));
          send({
            type: 'backlog', uuid: 'u-1', events: EVENTS, offset: 1, file: '/w/t.jsonl', missing: false,
            searchComplete: true, fileMeasured: true,
          });
        });
        await page.goto(`${server!.origin}/s/${SESSION.id}`);
        await page.waitForSelector('.tool-activity-row', { timeout: 20_000 });
        await page.waitForTimeout(600);

        // Collapsed by default, one line, its words, and its failed call surfaced under it.
        const tapMin = await page.evaluate(() =>
          Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap-min')));
        let last = await newest(page);
        expect(last, 'no tool-activity row on screen').not.toBeNull();
        expect(last!.expanded).toBe('false');
        expect(last!.text).toContain('Tool activity');
        expect(last!.text).toContain('3 calls');
        expect(last!.text).toContain('1 failed');
        expect(last!.height, 'the row is not one line').toBeLessThanOrEqual(Math.ceil(tapMin) + 1);
        expect(last!.failedSurfaced, 'the failed call is not surfaced on the collapsed row').toBe(true);
        // Collapsed, no tool card is drawn outside the surfaced one.
        const loose = await page.evaluate(() =>
          [...document.querySelectorAll('.toolcard')].filter((c) => c.closest('.tool-activity-first') === null).length);
        expect(loose, 'a tool card is drawn outside a collapsed row').toBe(0);

        // Calls arrive in the closed stretch while the reader is scrolled up: nothing they look at moves.
        await scrollTo(page, 'middle');
        const anchor = async () => page.evaluate(() => {
          const s = document.querySelector<HTMLElement>('.chat-scroller')!;
          const top = s.getBoundingClientRect().top;
          const item = [...s.querySelectorAll<HTMLElement>('.chat-item')].find((el) => el.getBoundingClientRect().top >= top);
          return { scrollTop: Math.round(s.scrollTop), text: item?.textContent ?? '', at: Math.round((item?.getBoundingClientRect().top ?? 0) - top) };
        });
        const before = await anchor();
        expect(before.text, 'no row in view at the middle').not.toBe('');
        expect(send, 'the session socket never opened').not.toBeNull();
        send!({ type: 'events', uuid: 'u-1', events: LATER, offset: 2 });
        await page.waitForTimeout(800);
        const after = await anchor();
        expect(after.text, 'the row in view changed').toBe(before.text);
        expect(Math.abs(after.at - before.at), 'the row in view moved').toBeLessThanOrEqual(1);
        expect(Math.abs(after.scrollTop - before.scrollTop), 'the scroll position moved').toBeLessThanOrEqual(1);
        await scrollTo(page, 'bottom');
        last = await newest(page);
        expect(last!.text).toContain('5 calls');
        expect(last!.expanded, 'the arriving calls opened the row').toBe('false');

        // Opened, the row shows the cards in place, held to the column.
        await page.locator('.tool-activity-row').last().click();
        await page.waitForTimeout(300);
        const opened = await page.evaluate(() => {
          const rows = [...document.querySelectorAll<HTMLElement>('.tool-activity')];
          const body = rows[rows.length - 1]!.querySelector<HTMLElement>('.tool-activity-body');
          const scroller = document.querySelector<HTMLElement>('.chat-scroller')!;
          return {
            groups: body?.querySelectorAll('.ref-tool-group').length ?? -1,
            cards: body?.querySelectorAll('.toolcard').length ?? -1,
            scrollerSide: scroller.scrollWidth - scroller.clientWidth,
            pageSide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        });
        if (view.skin === REFINED) {
          // Read, the failed Bash (alone, as before), and the run after it: Read, Grep, git status.
          expect(opened.groups, "Refined's run groups are inside the opened row").toBe(2);
        } else {
          expect(opened.cards, "Instrument's five tool cards are inside the opened row").toBe(5);
        }
        expect(opened.scrollerSide, 'the transcript has no sideways scroll').toBe(0);
        expect(opened.pageSide, 'the page has no sideways scroll').toBe(0);

        // The reader's choice outlives the list unmounting the row.
        await scrollTo(page, 'top');
        const openAtTop = await page.locator('.tool-activity-row[aria-expanded="true"]').count();
        expect(openAtTop, 'the opened row is still mounted at the top: the transcript is too short to test this').toBe(0);
        await scrollTo(page, 'bottom');
        last = await newest(page);
        expect(last!.expanded, 'the opened row closed after a scroll away and back').toBe('true');
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});
