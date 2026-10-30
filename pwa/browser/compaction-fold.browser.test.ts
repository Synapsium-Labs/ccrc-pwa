// The compaction card folds on the server's flag (W7 C7i, D-7187, D-7361), in a real Chrome over the production build.
//
// Since C7i the PWA folds a user- or assistant-kind row into the compaction card when its event carries `ChatEvent`'s
// `compaction: true` (the server's fact, D-7186), and matches no text. This file holds what Chrome draws for a
// transcript with three such rows at 360, 390, 1280 and 1920 in both skins and both palettes: a flagged recap and a
// flagged marker-only summary (D-7361: a summary in other words, which rendered as text before C7i) each draw one
// closed card whose body opens on a tap, and the recap sentence from a server without the flag (the skew row) is
// drawn as the text it is. Neither the transcript nor the page scrolls sideways, and no page error is thrown.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/compaction-fold.browser.test.ts )`.
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
const RECAP = 'This session is being continued from a previous conversation that ran out of context.\n\nSummary:\nthe recap body';
const MARKER_ONLY = 'Summary of the work so far: the census landed.\n\n## Next\n\nthe marker-only body';
const UNFLAGGED = 'This session is being continued from a previous conversation, typed by a server without the flag.';
const EVENTS: object[] = [
  { kind: 'user', uuid: 'r1', ts: TS, text: RECAP, compaction: true },
  { kind: 'assistant', uuid: 'a1', ts: TS, text: 'Picking up from the recap.' },
  { kind: 'user', uuid: 'm1', ts: TS, text: MARKER_ONLY, compaction: true },
  { kind: 'assistant', uuid: 'a2', ts: TS, text: 'Picking up from the summary.' },
  { kind: 'user', uuid: 'u1', ts: TS, text: UNFLAGGED },
  { kind: 'assistant', uuid: 'a3', ts: TS, text: 'Done.' },
];

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

describe('a flagged row folds into the compaction card; an unflagged one is its text (C7i, D-7187, D-7361)', () => {
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
        await page.getByText('Done.').waitFor({ timeout: 20_000 });
        const closed = await page.evaluate(() => ({
          cards: document.querySelectorAll('.compaction').length,
          open: document.querySelectorAll('.compaction--open').length,
          sys: document.querySelectorAll('.compaction--sys').length,
          text: document.querySelector('.chat-scroller')?.textContent ?? '',
        }));
        expect([closed.cards, closed.open, closed.sys], 'two closed recap cards').toEqual([2, 0, 0]);
        expect(closed.text, 'the recap body is folded').not.toContain('the recap body');
        expect(closed.text, 'the marker-only body is folded (D-7361)').not.toContain('the marker-only body');
        expect(closed.text, 'the unflagged recap sentence is drawn as text (the skew row)').toContain('typed by a server without the flag');

        const heads = page.locator('.compaction-head');
        await heads.nth(1).scrollIntoViewIfNeeded();
        await heads.nth(1).click();
        await page.locator('.compaction--open').waitFor({ timeout: 10_000 });
        const opened = await page.evaluate(() => ({
          text: document.querySelector('.compaction--open .compaction-body')?.textContent ?? '',
          scrollerSide: ((s) => (s ? s.scrollWidth - s.clientWidth : -1))(document.querySelector<HTMLElement>('.chat-scroller')),
          pageSide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }));
        expect(opened.text, 'the marker-only card opens to its summary').toContain('the marker-only body');
        expect(opened.scrollerSide, 'the transcript has no sideways scroll').toBe(0);
        expect(opened.pageSide, 'the page has no sideways scroll').toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});
