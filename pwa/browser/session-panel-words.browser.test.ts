// Session helpers H3 (D-8875; spec 2026-11-19-session-helpers-design §4.4 and §4.5): the whole session panel in a real
// Chrome over the production build, at each width of the plan's acceptance matrix (360, 390, 1280, 1600 for the rail and
// 1920), in both skins, dark and light. The session runs two subagents, the broker holds three recorded entries and two
// worktrees for it (one whose presence on disk was not measured), and its Helpers section draws a row of every state with a
// stale roster. With every door of the panel open (the details on a phone, the Helpers head under the transcript, the
// finished fold):
//   - the panel says no condition word of the broker, none of their sentences and no bare `unmeasured`, in its text, its
//     titles or its accessible names, and draws no subagent or delegated toggle and no recorded entry;
//   - the Helpers section is drawn once (the strip under the transcript, or the rail's section at 1600 and up in Refined),
//     and so is the worktrees section, whose rows each start their path on the screen;
//   - nothing scrolls the page sideways, no page error is thrown, and on a touch screen the details door and the Helpers
//     head take the tap floor.
// With `CCRC_SHOTS=<dir>` it saves one picture per view, before its assertions, so the same file run over `origin/main`
// gives the matrix's "before" column.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts
// --maxWorkers=2 browser/session-panel-words.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { backlogFrame, longTranscript, openApp, serveDist, sharedDist, type AppFixture, type DistServer } from './app';
import { fleetSession } from '../test/fleetFixture';
import { activity, frame, lease } from '../test/delegationFixture';
import { LIVENESS_QUALIFIER } from '../src/fleet/delegationWords';
import type { AgentHelperView, WorkflowView } from '../../shared/workflows';

const NOW = Date.now();
const ID = 'lane-a-project-a-amber-reach';
const SESSION = fleetSession({
  id: ID, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: '/w/project-a/amber-reach',
  workspace: 'amber-reach', name: 'amber-reach', status: 'busy', bucket: 'working', model: 'model-x', effort: 'high',
  tasks: { done: 2, total: 5, running: 1, active: null },
  subagents: [{ name: 'code-reviewer', startedAt: NOW - 60_000 }, { name: 'explorer', startedAt: NOW - 30_000 }],
});
const EVENTS = longTranscript(30);
const LAST_TEXT = (EVENTS.at(-1) as { text: string }).text;
const agent = (id: string, o: Partial<AgentHelperView> = {}): AgentHelperView => ({
  id, description: `Measure the ${id} sources`, agentType: 'general-purpose', model: 'Sonnet', effort: 'high', state: 'running',
  startedAt: NOW - 725_000, endedAt: null, lastActivityAt: NOW - 20_000, tokens: 41_000, summary: null, hasReport: false, ...o,
});
const workflow: WorkflowView = {
  id: 'wf_00000000-aaa', name: 'review-panel', state: 'running', done: 7, failed: 0, total: 12, phase: 'Verify', phases: ['Build', 'Verify'],
  startedAt: NOW - 362_000, endedAt: null, tokens: 2_500_000, tokensUnmeasured: 0, agents: [], agentsOmitted: 0, lastActivityAt: NOW - 4_000,
};
const AGENTS: AgentHelperView[] = [
  agent('server'), agent('hook', { state: 'unlisted' }), agent('fleet', { state: 'unmeasured' }),
  agent('panel', { state: 'done', endedAt: NOW - 148_000, startedAt: NOW - 400_000, summary: 'header facts only', hasReport: true }),
  agent('mockup', { state: 'failed', endedAt: NOW - 137_000, startedAt: NOW - 200_000, summary: 'headless browser not found' }),
];
const LEASES = [
  lease({ leaseId: 'p-l1', parentId: ID, project: 'project-a', adminRecord: 'agent-p1', liveness: 'live',
    canonicalPath: '/w/project-a/.claude/worktrees/agent-p1', disposition: 'retained', expiresAt: null }),
  // A long path in one unbroken run: it must wrap inside the row, never size the header past the screen.
  lease({ leaseId: 'p-l2', parentId: ID, project: 'project-a', adminRecord: 'agent-p2', liveness: 'stale', workspace: 'unmeasured',
    sourceKind: 'raw', canonicalPath: '/w/project-a/.claude/worktrees/agent-a1b2c3d4e5f6-a-very-long-worktree-name',
    disposition: 'ephemeral', expiresAt: null }),
];
const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': {
      accounts: [{
        wrapper: 'lane-a', five: 40, seven: 50, ts: Math.floor(NOW / 1000), fiveResetAt: null, sevenResetAt: null,
        fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false,
      }],
      projected: null,
      roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', pool: null, homeAble: true, hidden: false }],
    },
    '/api/projects': { roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a' }] },
    '/api/runs': [], '/api/claims': [],
  },
  fleetFrames: [
    { type: 'fleet', sessions: [SESSION] },
    { type: 'delegation', delegation: frame({ activities: [
      activity({ activityId: 'e1', parentId: ID, displayName: 'reconcile every reader of the projection frame' }),
      activity({ activityId: 'e2', parentId: ID, displayName: 'read the plan', liveness: 'stale' }),
      activity({ activityId: 'e3', parentId: ID, displayName: null, liveness: 'unmeasured' }),
    ], leases: LEASES }) },
  ],
  socketFrames: {
    [`/ws/session/${ID}`]: [backlogFrame(EVENTS), {
      type: 'workflows', workflows: [workflow], agents: AGENTS, agentsUnmeasured: { why: 'stale', hookAgeMs: 41 * 60_000 },
    }],
  },
};

const BANNED = [...new Set(Object.values(LIVENESS_QUALIFIER).flatMap((q) => [q.word, q.title])), 'unmeasured'];

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

const SKINS = [REFINED, INSTRUMENT] as const;
const THEMES = [PHOSPHOR, 'light'] as const;
const WIDTHS = [360, 390, 1280, 1600, 1920] as const;

describe.each(SKINS)('the whole session panel in %s (H3)', (skin) => {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      it(`${theme} at ${width}: no condition word or unmeasured, each section once, no sideways scroll`, async () => {
        const { ctx, page, errors } = await openApp(browser!, { skin, theme, width }, FIXTURE);
        try {
          await page.goto(`${server!.origin}/s/${ID}`);
          await page.waitForFunction((text) => document.body.textContent?.includes(text) === true, LAST_TEXT, { timeout: 20_000 });
          await page.waitForFunction(() => document.querySelector('[data-helper-row]') !== null || document.querySelector('.helpers-strip') !== null, null, { timeout: 20_000 });
          const door = page.getByRole('button', { name: 'Session details' });
          if (await door.count() > 0 && await door.getAttribute('aria-expanded') === 'false') await door.click();
          const head = page.locator('.chat-strips .helpers-strip button[aria-expanded="false"]').first();
          if (await head.count() > 0) await head.click();
          const fold = page.locator('.helpers-fold-toggle[aria-expanded="false"]').first();
          if (await fold.count() > 0) await fold.click();
          await page.waitForSelector('.sess-worktrees .proj-work >> nth=1', { state: 'attached', timeout: 20_000 });
          await page.evaluate(async () => { await document.fonts.ready; });
          await page.waitForTimeout(400);
          const shots = process.env['CCRC_SHOTS'];
          if (shots !== undefined && shots !== '') await page.screenshot({ path: `${shots}/panel-${skin}-${theme}-${width}.png` });

          const read = await page.evaluate(() => {
            const texts = [document.body.innerText];
            for (const el of document.querySelectorAll('*')) {
              for (const a of ['title', 'aria-label', 'aria-description']) { const v = el.getAttribute(a); if (v !== null && v !== '') texts.push(v); }
            }
            const box = (sel: string): number => {
              const el = document.querySelector<HTMLElement>(sel);
              return el === null ? 0 : el.getBoundingClientRect().height;
            };
            const clipOf = (el: Element): DOMRect => (el.closest('.ref-chip-rail') ?? el.closest('.chat-head')!).getBoundingClientRect();
            return {
              texts,
              sideScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              toggles: document.querySelectorAll('.sess-subagents, .sess-entries, .sess-subagent-list').length,
              helpers: document.querySelectorAll('.chat-strips .helpers-strip').length + document.querySelectorAll('[data-section="helpers"]').length,
              worktrees: document.querySelectorAll('.sess-worktrees').length,
              paths: [...document.querySelectorAll<HTMLElement>('.sess-worktrees .proj-work-name-text')].map((p) => {
                const r = p.getBoundingClientRect();
                const c = clipOf(p);
                // On the screen where it starts, and drawn whole: no part of it cut away.
                return r.width > 0 && r.left >= c.left - 0.5 && r.left < c.right && p.scrollWidth <= p.clientWidth + 1;
              }),
              coarse: matchMedia('(pointer: coarse)').matches,
              door: box('.chat-details-toggle'),
              helpersHead: box('.chat-strips .helpers-strip > * > button[aria-expanded]') || box('.chat-strips .helpers-strip button[aria-expanded]'),
              line2Overflow: [...document.querySelectorAll('.helper-line2')].filter((l) => l.scrollWidth > l.clientWidth + 1).length,
            };
          });
          expect(read.sideScroll, 'sideways scroll').toBe(0);
          const all = read.texts.join(' \n ').toLowerCase();
          expect(BANNED.filter((w) => all.includes(w.toLowerCase())), 'no condition word, sentence or unmeasured').toEqual([]);
          expect(all, 'no subagent or entry count or name').not.toMatch(/\b\d+ subagents?\b|\d+ delegated|⑂|reconcile every reader|read the plan|code-reviewer/);
          expect(read.toggles, 'no toggle and no entry list').toBe(0);
          expect(read.helpers, 'the Helpers section, once').toBe(1);
          expect(read.worktrees, 'the worktrees section, once').toBe(1);
          expect(read.paths, 'each worktree path starts on the screen and is drawn whole').toEqual([true, true]);
          expect(read.line2Overflow, 'no Helpers line 2 runs past its row').toBe(0);
          if (read.coarse) {
            if (read.door > 0) expect(read.door, 'the details door takes the tap floor').toBeGreaterThanOrEqual(44);
            if (read.helpersHead > 0) expect(read.helpersHead, 'the Helpers head takes the tap floor').toBeGreaterThanOrEqual(44);
          }
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }, 60_000);
    }
  }
});
