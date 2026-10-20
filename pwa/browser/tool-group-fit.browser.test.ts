// Refined's grouped tool rows hold the reading column when opened (D-5475, W2 Task S13b), in a real Chrome over the
// production build.
//
// An opened group shows today's tool cards in `.ref-tool-group-body`, a one-column grid. Its implicit `auto` track
// sized itself to a card's one-line header, so a long Bash command pushed every card in the group past the column and
// gave `.chat-scroller` hundreds of pixels of sideways scroll (926px at 360). jsdom computes no layout, so this file
// holds what Chrome computes: a transcript whose runs include a long command, every group opened, at 360, 390, 1280
// and 1920 in both skins and both palettes — no tool card's right edge passes its group's (Refined), the scroller and
// the page have no sideways scroll, and no page error is thrown. Instrument draws no groups (its set says `'none'`),
// so it holds the scroller half only.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/tool-group-fit.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';

const VIEWS: AppView[] = [REFINED, INSTRUMENT].flatMap((skin) => [PHOSPHOR, 'light'].flatMap((theme) =>
  [360, 390, 1280, 1920].map((width) => ({ skin, theme, width }))));
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
/** A command wider than any column: a card's header is one line, so this is the input that sized the grid track. */
const LONG_COMMAND = `cd /w/project-a && ${'npm run check-everything-in-the-workspace '.repeat(4)}--reporter=verbose`;
const EVENTS: object[] = [];
let k = 0;
const call = (name: string, input: object): void => {
  k += 1;
  EVENTS.push({ kind: 'tool_use', uuid: `u${k}`, ts: TS, toolId: `t${k}`, name, input: JSON.stringify(input) });
  EVENTS.push({ kind: 'tool_result', ts: TS, toolId: `t${k}`, text: 'ok', isError: false });
};
EVENTS.push({ kind: 'user', uuid: 'q1', ts: TS, text: 'Run the checks.' });
EVENTS.push({ kind: 'assistant', uuid: 'a1', ts: TS, text: 'Reading first, then running them.' });
call('Read', { file_path: '/w/project-a/src/a.ts' });
call('Bash', { command: LONG_COMMAND });
call('Edit', { file_path: '/w/project-a/src/a.ts', old_string: 'a', new_string: 'b' });
EVENTS.push({ kind: 'assistant', uuid: 'a2', ts: TS, text: 'Once more.' });
call('Bash', { command: LONG_COMMAND });

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

describe('an opened tool group holds the reading column (D-5475)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await ctx.routeWebSocket(/\/ws\/session\//, (ws) => {
          ws.send(JSON.stringify({
            type: 'backlog', uuid: 'u-1', events: EVENTS, offset: 1, file: '/w/t.jsonl', missing: false,
            searchComplete: true, fileMeasured: true,
          }));
        });
        await page.goto(`${server!.origin}/s/${SESSION.id}`);
        await page.waitForSelector('.chat-item', { timeout: 20_000 });
        const rows = page.locator('.ref-tool-group-row');
        const groups = await rows.count();
        if (view.skin === REFINED) expect(groups, 'Refined folds the runs into groups').toBeGreaterThan(0);
        else expect(groups, 'Instrument draws no groups').toBe(0);
        for (let i = 0; i < groups; i += 1) {
          const row = rows.nth(i);
          await row.scrollIntoViewIfNeeded();
          if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click();
        }
        await page.waitForTimeout(300);
        const m = await page.evaluate(() => {
          const scroller = document.querySelector<HTMLElement>('.chat-scroller');
          const over = [...document.querySelectorAll<HTMLElement>('.ref-tool-group')].flatMap((g) => {
            const right = g.getBoundingClientRect().right;
            return [...g.querySelectorAll<HTMLElement>('.ref-tool-group-body > *')]
              .map((c) => Math.round(c.getBoundingClientRect().right - right))
              .filter((d) => d > 1);
          });
          return {
            cards: document.querySelectorAll('.ref-tool-group-body > *').length,
            over,
            scrollerSide: scroller ? scroller.scrollWidth - scroller.clientWidth : -1,
            pageSide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        });
        if (view.skin === REFINED) expect(m.cards, 'the opened groups show their cards').toBeGreaterThan(0);
        expect(m.over, 'no card passes its group').toEqual([]);
        expect(m.scrollerSide, 'the transcript has no sideways scroll').toBe(0);
        expect(m.pageSide, 'the page has no sideways scroll').toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});
