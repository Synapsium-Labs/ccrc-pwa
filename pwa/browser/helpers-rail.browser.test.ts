// Session helpers H2 (D-8872; spec 2026-11-19-session-helpers-design §4 and §10): the Helpers section's place, in a real
// Chrome over the production build.
//
// What jsdom cannot hold:
//   - "1600: in the rail, not the column; hidden rail: back in the column above the composer": Refined at 1600 places
//     the section in the inspector rail, and hiding the rail brings it back under the transcript (the same fallback the
//     mail and task strips take); showing it again moves it back;
//   - "1280: in the column": below 1600 it sits in the strips under the transcript, above the composer;
//   - "360: collapsed it is the head and two lines; open it is at most half the viewport and one scroll body": §10's
//     phone layout, with the head at least 44 px and no sideways page scroll.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts
// --maxWorkers=2 browser/helpers-rail.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { backlogFrame, longTranscript, openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';
import { fleetSession } from '../test/fleetFixture';
import type { AgentHelperView, WorkflowView } from '../../shared/workflows';

const NOW = 1_792_362_479;
const ID = 'lane-a-project-a-quiet-basin';
const SESSION = fleetSession({
  id: ID, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: '/w/project-a/quiet-basin',
  workspace: 'quiet-basin', name: 'quiet-basin', status: 'busy', bucket: 'working', model: 'model-x', effort: 'high',
});
const EVENTS = longTranscript(40);
const LAST_TEXT = (EVENTS.at(-1) as { text: string }).text;
const ms = NOW * 1000;
const agent = (id: string, o: Partial<AgentHelperView> = {}): AgentHelperView => ({
  id, description: `Measure the ${id} sources`, agentType: 'general-purpose', model: 'Sonnet', effort: 'high', state: 'running',
  startedAt: ms - 725_000, endedAt: null, lastActivityAt: ms - 20_000, tokens: 41_000, summary: null, hasReport: false, ...o,
});
const workflow: WorkflowView = {
  id: 'wf_00000000-aaa', name: 'review-panel', state: 'running', done: 7, failed: 0, total: 12, phase: 'Verify', phases: ['Build', 'Verify'],
  startedAt: ms - 362_000, endedAt: null, tokens: 2_500_000, tokensUnmeasured: 0, agents: [], agentsOmitted: 0, lastActivityAt: ms - 4_000,
};
const AGENTS: AgentHelperView[] = [
  agent('server'), agent('transcript', { startedAt: ms - 708_000 }), agent('hook'), agent('fleet'),
  agent('panel', { state: 'done', endedAt: ms - 148_000, startedAt: ms - 400_000, summary: 'header facts only', hasReport: true }),
];

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
  socketFrames: {
    [`/ws/session/${ID}`]: [backlogFrame(EVENTS), { type: 'workflows', workflows: [workflow], agents: AGENTS }],
  },
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

const view = (width: number): AppView => ({ skin: REFINED, theme: PHOSPHOR, width });

async function openSession(v: AppView) {
  const opened = await openApp(browser!, v, FIXTURE);
  await opened.page.goto(`${server!.origin}/s/${ID}`);
  await opened.page.waitForFunction((text) => document.body.textContent?.includes(text) === true, LAST_TEXT, { timeout: 20_000 });
  await opened.page.waitForFunction(() => document.body.textContent?.includes('Measure the server sources') === true, null, { timeout: 20_000 });
  await opened.page.waitForTimeout(400);
  return opened;
}

interface Place { rail: boolean; column: boolean; aboveComposer: boolean; sideScroll: number }
const place = (page: Page): Promise<Place> => page.evaluate(() => {
  const composer = document.querySelector('.composer')!.getBoundingClientRect();
  const strip = document.querySelector('.chat-strips .helpers-strip');
  return {
    rail: document.querySelector('.ref-inspector [data-section="helpers"]') !== null,
    column: strip !== null,
    aboveComposer: strip !== null && strip.getBoundingClientRect().bottom <= composer.top + 1,
    sideScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});

describe('the Helpers section\'s place, by width', () => {
  it('1600: in the rail, not the column; a hidden rail brings it back above the composer; shown again it moves back', async () => {
    const { ctx, page, errors } = await openSession(view(1600));
    try {
      expect(await place(page)).toEqual({ rail: true, column: false, aboveComposer: false, sideScroll: 0 });
      await page.locator('[data-command="toggle-inspector"]').click();
      await page.waitForFunction(() => document.querySelector('.ref-inspector') === null);
      await page.waitForTimeout(300);
      expect(await place(page), 'hidden rail: the column').toEqual({ rail: false, column: true, aboveComposer: true, sideScroll: 0 });
      await page.keyboard.press('i');
      await page.waitForFunction(() => document.querySelector('.ref-inspector') !== null);
      await page.waitForTimeout(300);
      expect(await place(page), 'shown again: the rail').toEqual({ rail: true, column: false, aboveComposer: false, sideScroll: 0 });
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  }, 60_000);

  it('1280: in the strips under the transcript, above the composer', async () => {
    const { ctx, page, errors } = await openSession(view(1280));
    try {
      expect(await place(page)).toEqual({ rail: false, column: true, aboveComposer: true, sideScroll: 0 });
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  }, 60_000);

  it('360: collapsed, the head and line 1 of the first two running rows; open, one scroll body at most half the viewport', async () => {
    const { ctx, page, errors } = await openSession(view(360));
    try {
      expect(await place(page)).toEqual({ rail: false, column: true, aboveComposer: true, sideScroll: 0 });
      const collapsed = await page.evaluate(() => {
        const s = document.querySelector('.chat-strips .helpers-strip')!;
        const head = s.querySelector('button[aria-expanded]')!.getBoundingClientRect();
        const glance = [...s.querySelectorAll('[data-helper-glance]')].map((g) => {
          const state = g.querySelector('.helper-glance-state')!.getBoundingClientRect();
          return { right: state.right <= s.getBoundingClientRect().right + 1, lines: Math.round(g.getBoundingClientRect().height / parseFloat(getComputedStyle(g).lineHeight || '16')) };
        });
        return { head: head.height, glance };
      });
      expect(collapsed.head, 'the head is the tap floor at least').toBeGreaterThanOrEqual(44);
      expect(collapsed.glance).toHaveLength(2);
      for (const g of collapsed.glance) expect(g.right, 'the state word stays visible').toBe(true);
      await page.locator('.chat-strips .helpers-strip button[aria-expanded]').first().click();
      await page.waitForTimeout(200);
      const opened = await page.evaluate(() => {
        const s = document.querySelector('.chat-strips .helpers-strip')!;
        const rows = s.querySelector('.helpers-rows') as HTMLElement;
        return { height: s.getBoundingClientRect().height, vh: window.innerHeight, scrolls: getComputedStyle(rows).overflowY, rows: s.querySelectorAll('[data-helper-row]').length };
      });
      expect(opened.height).toBeLessThanOrEqual(opened.vh / 2 + 1);
      expect(opened.scrolls).toBe('auto');
      expect(opened.rows).toBeGreaterThanOrEqual(5);
      expect((await place(page)).sideScroll).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  }, 60_000);
});
