// Session helpers H2 (D-8872; spec 2026-11-19-session-helpers-design §4 and §10): the Helpers section's place, in a real
// Chrome over the production build.
//
// What jsdom cannot hold:
//   - "1600: in the rail, not the column; hidden rail: back in the column above the composer": Refined at 1600 places
//     the section in the inspector rail, and hiding the rail brings it back under the transcript (the same fallback the
//     mail and task strips take); showing it again moves it back;
//   - "1280: in the column": below 1600 it sits in the strips under the transcript, above the composer;
//   - "360: collapsed it is the head and two lines; open it is at most half the viewport and one scroll body": §10's
//     phone layout, with the head at least 44 px and no sideways page scroll;
//   - review 3072 F6 and F7: at 360 a row's elapsed time is in line 2 and line 1 draws none, at 1280 it is on line 1 and
//     line 2 draws none; at either width no fact splits across two lines, and a state with its times wider than the line
//     breaks only between its words, never inside one (review 3099 F2 and F3, session helpers H3);
//   - review 3123 F4 and F13 (session helpers HF2, D-8877): in the 1600 px rail, with a state group wider than its line, the
//     group takes two lines and breaks only between its words, no fact or word splits, and no line of line 2 starts with a
//     separator, between its facts or inside a group.
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

async function openSession(v: AppView, fixture: AppFixture = FIXTURE) {
  const opened = await openApp(browser!, v, fixture);
  await opened.page.goto(`${server!.origin}/s/${ID}`);
  await opened.page.waitForFunction((text) => document.body.textContent?.includes(text) === true, LAST_TEXT, { timeout: 20_000 });
  await opened.page.waitForFunction(() => document.querySelector('.helpers-strip') !== null, null, { timeout: 20_000 });
  await opened.page.waitForTimeout(400);
  return opened;
}

/** Where each running row draws its elapsed time, and every fact, or word of a state group, that the width split across two
 *  lines. A state group itself may take two lines, between its words (review 3099 F2: the coordinator's ruling). */
const lines = (page: Page): Promise<{ line1: boolean[]; line2: boolean[]; split: string[] }> => page.evaluate(() => {
  const shown = (e: Element | null): boolean => e !== null && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;
  const rows = [...document.querySelectorAll('.chat-strips .helpers-strip .helpers-main [data-helper-row]')];
  // A group is an inline block: it spans two lines when its box is taller than one line of its own text.
  const split = [...document.querySelectorAll('.chat-strips .helpers-strip .helper-fact:not(.helper-state), .chat-strips .helpers-strip .helper-state .helper-word')]
    .filter((g) => shown(g) && g.getBoundingClientRect().height > 1.5 * parseFloat(getComputedStyle(g).lineHeight)).map((g) => g.textContent ?? '');
  return {
    line1: rows.map((r) => shown(r.querySelector(':scope > .helper-elapsed'))),
    line2: rows.map((r) => shown(r.querySelector('.helper-elapsed-inline'))),
    split,
  };
});

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
      // Review 3072 F7: in the narrow rail no line 2 runs past its row (a group wider than the line breaks between words).
      const overflow = await page.evaluate(() => [...document.querySelectorAll('.ref-inspector .helper-line2')]
        .filter((l) => l.scrollWidth > l.clientWidth + 1).map((l) => l.textContent ?? ''));
      expect(overflow).toEqual([]);
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
      await page.locator('.chat-strips .helpers-strip button[aria-expanded]').first().click();
      await page.waitForTimeout(200);
      const l = await lines(page);
      expect(l.line1.length, 'running rows drawn').toBeGreaterThan(0);
      expect(l.line1.every(Boolean), 'at the desk elapsed is on line 1').toBe(true);
      expect(l.line2.some(Boolean), 'and line 2 draws none').toBe(false);
      expect(l.split, 'no fact splits across lines').toEqual([]);
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
        const box = s.getBoundingClientRect();
        const glance = [...s.querySelectorAll('[data-helper-glance]')].map((g) => {
          const state = g.querySelector('.helper-glance-state')!.getBoundingClientRect();
          const glyph = g.querySelector('.helper-glyph')!.getBoundingClientRect();
          const what = g.querySelector('.helper-glance-what')!.getBoundingClientRect();
          return {
            right: state.right <= box.right + 1,
            // the glyph leads the line, the description takes the room between it and the state word, on one line
            order: glyph.right <= what.left + 1 && what.right <= state.left + 1,
            roomy: what.width >= box.width / 2,
            oneLine: Math.abs(glyph.top - state.top) < 8 && Math.abs(what.top - state.top) < 8,
          };
        });
        return { head: head.height, glance };
      });
      expect(collapsed.head, 'the head is the tap floor at least').toBeGreaterThanOrEqual(44);
      expect(collapsed.glance).toHaveLength(2);
      for (const g of collapsed.glance) {
        expect(g.right, 'the state word stays visible').toBe(true);
        expect(g.order, 'glyph, then line 1, then the state word').toBe(true);
        expect(g.roomy, 'line 1 has the room left by the glyph and the state word').toBe(true);
        expect(g.oneLine, 'one line').toBe(true);
      }
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
      const l = await lines(page);
      expect(l.line1.length, 'running rows drawn').toBeGreaterThan(0);
      expect(l.line1.some(Boolean), 'on a phone line 1 draws no elapsed').toBe(false);
      expect(l.line2.every(Boolean), 'and line 2 draws it (§10)').toBe(true);
      expect(l.split, 'no fact splits across lines').toEqual([]);
      expect((await place(page)).sideScroll).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  }, 60_000);
});

/** A workflow whose state group (running, its phase, its agents, its failures and its times) is wider than the rail's line. */
const WIDE_FIXTURE: AppFixture = {
  ...FIXTURE,
  socketFrames: {
    [`/ws/session/${ID}`]: [backlogFrame(EVENTS), { type: 'workflows', agents: AGENTS, workflows: [workflow, {
      ...workflow, id: 'wf_00000000-bbb', name: 'reader-sweep', failed: 2, phase: 'Verify readers', lastActivityAt: ms - 9_000,
    }] }],
  },
};

/** In `root`'s Helpers section: every fact, or word of a state group, that its width split across two lines; every state group
 *  that took two lines; and every separator of a line 2 that starts a line (nothing before it on its own line). */
const railLines = (page: Page, root: string): Promise<{ split: string[]; twoLine: string[]; leading: string[] }> => page.evaluate((root) => {
  const scope = document.querySelector(root);
  if (scope === null) return { split: ['no section'], twoLine: [], leading: [] };
  const shown = (e: Element): boolean => getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;
  const tall = (e: Element): boolean => e.getBoundingClientRect().height > 1.5 * parseFloat(getComputedStyle(e).lineHeight);
  const split = [...scope.querySelectorAll('.helper-fact:not(.helper-state), .helper-state .helper-word')]
    .filter((g) => shown(g) && tall(g)).map((g) => g.textContent ?? '');
  const twoLine = [...scope.querySelectorAll('.helper-state')].filter((g) => shown(g) && tall(g)).map((g) => g.textContent ?? '');
  const leading: string[] = [];
  for (const line of scope.querySelectorAll('.helper-line2')) {
    if (!shown(line)) continue;
    // Every drawn character of the line, in order, with its box; a separator starts a line when no drawn character before it
    // sits on its line (its top within a few pixels).
    const chars: Array<{ c: string; top: number }> = [];
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      const t = n.textContent ?? '';
      for (let i = 0; i < t.length; i++) {
        if (/\s/.test(t[i]!)) continue;
        const r = document.createRange();
        r.setStart(n, i); r.setEnd(n, i + 1);
        const box = r.getClientRects()[0];
        if (box !== undefined && box.width > 0) chars.push({ c: t[i]!, top: box.top });
      }
    }
    chars.forEach((ch, i) => {
      if (ch.c !== '·') return;
      const prev = chars[i - 1];
      if (prev === undefined || Math.abs(prev.top - ch.top) > 4) leading.push(line.textContent ?? '');
    });
  }
  return { split, twoLine, leading };
}, root);

describe('the 1600 px rail\'s line 2 (review 3123 F4 and F13, session helpers HF2)', () => {
  it('a state group wider than the line takes two lines, breaks only between its words, and no separator starts a line', async () => {
    const { ctx, page, errors } = await openSession(view(1600), WIDE_FIXTURE);
    try {
      expect(await place(page)).toEqual({ rail: true, column: false, aboveComposer: false, sideScroll: 0 });
      await page.waitForFunction(() => document.querySelector('.ref-inspector [data-helper-row="wf_00000000-bbb"]') !== null, null, { timeout: 20_000 });
      const r = await railLines(page, '.ref-inspector [data-section="helpers"]');
      expect(r.twoLine.length, 'the fixture holds a state group wider than the rail\'s line').toBeGreaterThan(0);
      expect(r.split, 'no fact or word splits across lines').toEqual([]);
      expect(r.leading, 'no separator starts a line').toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  }, 60_000);
});
