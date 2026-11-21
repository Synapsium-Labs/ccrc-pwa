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
//     head take the tap floor;
//   - session helpers HF2 (D-8877, review 3123 F3 and F6): below the desk a worktree's path takes its row's full width on a
//     line of its own, and at every width it breaks only after a `/` unless a segment is wider than its line; and a raw
//     worktree's `inferred` and `Bash call …` chips sit side by side; and the composer, its key-hint row included, lies
//     inside the session's pane and the window (F5, F7), the Helpers strip giving way, never past its head.
// With `CCRC_SHOTS=<dir>` it saves one picture per view, before its assertions, so the same file run over `origin/main`
// gives the matrix's "before" column.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts
// --maxWorkers=2 browser/session-panel-words.browser.test.ts )`.
import { appendFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { backlogFrame, longTranscript, openApp, serveDist, sharedDist, type AppFixture, type DistServer } from './app';
import { fleetSession } from '../test/fleetFixture';
import { activity, frame, lease } from '../test/delegationFixture';
import { PANEL_BANNED } from '../test/panelCensus';
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
              // HF2 (review 3123 F5 and F7): with every door open the composer, its key-hint row included, still lies inside the
              // session's pane and the window: the strips give way before it does.
              composerIn: (() => {
                const chat = document.querySelector('.chat')!.getBoundingClientRect();
                const composer = document.querySelector('.composer')!.getBoundingClientRect();
                const hints = document.querySelector('.composer-hints')?.getBoundingClientRect() ?? null;
                const bottom = Math.max(composer.bottom, hints?.bottom ?? 0);
                return { inPane: bottom <= chat.bottom + 0.5, inWindow: bottom <= window.innerHeight + 0.5, over: Math.round(bottom - Math.min(chat.bottom, window.innerHeight)) };
              })(),
              helpersHeadShown: (() => {
                const head = document.querySelector('.chat-strips .helpers-strip button[aria-expanded]');
                const strip = document.querySelector('.chat-strips .helpers-strip');
                if (head === null || strip === null) return true; // in the rail, not the strips
                return strip.getBoundingClientRect().bottom >= head.getBoundingClientRect().bottom - 0.5;
              })(),
              // HF2 (review 3123 F3): below the desk a path takes its row's full width, on a line of its own; and it breaks only
              // after a `/`, unless the segment it breaks in is wider than its line.
              pathLayout: [...document.querySelectorAll<HTMLElement>('.sess-worktrees .proj-work-name')].map((part) => {
                const text = part.querySelector<HTMLElement>('.proj-work-name-text')!;
                const parts = part.closest('.proj-work-parts')!.getBoundingClientRect();
                const r = part.getBoundingClientRect();
                const siblings = [...part.parentElement!.children].filter((c) => c !== part).map((c) => c.getBoundingClientRect());
                const ownLine = siblings.every((b) => b.bottom <= r.top + 1 || b.top >= r.bottom - 1);
                const full = r.width >= parts.width - 1;
                // Each character's line, from its box; a line starts where a character's top moves down.
                const chars: Array<{ c: string; top: number; at: number }> = [];
                const str = text.textContent ?? '';
                let offset = 0;
                const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
                for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
                  const t = n.textContent ?? '';
                  for (let i = 0; i < t.length; i++) {
                    const range = document.createRange();
                    range.setStart(n, i); range.setEnd(n, i + 1);
                    const box = range.getClientRects()[0];
                    if (box !== undefined) chars.push({ c: t[i]!, top: box.top, at: offset + i });
                  }
                  offset += t.length;
                }
                const probe = document.createElement('span');
                probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
                text.appendChild(probe);
                const segWidth = (at: number): number => {
                  const start = str.lastIndexOf('/', at - 1) + 1;
                  const end = str.indexOf('/', at);
                  probe.textContent = str.slice(start, end === -1 ? str.length : end + 1);
                  return probe.getBoundingClientRect().width;
                };
                const badBreaks: string[] = [];
                for (let i = 1; i < chars.length; i++) {
                  if (chars[i]!.top - chars[i - 1]!.top < 2) continue;
                  const at = chars[i]!.at;
                  if (str[at - 1] !== '/' && segWidth(at) <= text.clientWidth + 1) badBreaks.push(`${str.slice(0, at)} | ${str.slice(at)}`);
                }
                probe.remove();
                // A positive control: every character of the path was read, so a check of its breaks cannot pass on nothing.
                return { ownLine, full, badBreaks, read: chars.length === str.length && str.length > 0 };
              }),
              // HF2 (review 3123 F6; D-6999): a raw worktree's two chips, `inferred` and its `Bash call …`, sit side by side.
              chipPairs: [...document.querySelectorAll('.sess-worktrees .proj-work')].flatMap((row) => {
                const chips = [...row.querySelectorAll<HTMLElement>('.proj-work-chip')];
                const inferred = chips.find((c) => c.textContent === 'inferred');
                const call = chips.find((c) => (c.textContent ?? '').startsWith('Bash call'));
                if (inferred === undefined || call === undefined) return [];
                const a = inferred.getBoundingClientRect();
                const b = call.getBoundingClientRect();
                return [Math.abs(a.top - b.top) < 2 && b.left >= a.right - 1];
              }),
            };
          });
          // HF2's record (review 3123 F5 and F7), measured and written down, never asserted here: where the composer, its key-hint
          // row and the details end against the viewport and the status bar, with every door open.
          const measureTo = process.env['CCRC_MEASURE'];
          if (measureTo !== undefined && measureTo !== '') {
            const m = await page.evaluate(() => {
              const rect = (sel: string): { top: number; bottom: number } | null => {
                const el = document.querySelector(sel);
                if (el === null) return null;
                const r = el.getBoundingClientRect();
                return { top: Math.round(r.top * 10) / 10, bottom: Math.round(r.bottom * 10) / 10 };
              };
              return {
                vh: window.innerHeight, scrollH: document.documentElement.scrollHeight, head: rect('.chat-head'),
                worktrees: rect('.sess-worktrees'), strips: rect('.chat-strips'), composer: rect('.composer'),
                hints: rect('.composer-hints'), statusBar: rect('.ins-status'), list: rect('.chat-list'),
                pane: rect('.shell-detail'), statusRow: rect('.shell-status'), chat: rect('.chat'), body: rect('.chat-body'),
              };
            });
            appendFileSync(measureTo, `${JSON.stringify({ skin, theme, width, ...m })}\n`);
          }
          expect(read.sideScroll, 'sideways scroll').toBe(0);
          const all = read.texts.join(' \n ').toLowerCase();
          expect(PANEL_BANNED.filter((w) => all.includes(w.toLowerCase())), 'no condition word, sentence or unmeasured').toEqual([]);
          expect(all, 'no subagent or entry count or name').not.toMatch(/\b\d+ subagents?\b|\d+ delegated|⑂|reconcile every reader|read the plan|code-reviewer/);
          expect(read.toggles, 'no toggle and no entry list').toBe(0);
          expect(read.helpers, 'the Helpers section, once').toBe(1);
          expect(read.worktrees, 'the worktrees section, once').toBe(1);
          expect(read.paths, 'each worktree path starts on the screen and is drawn whole').toEqual([true, true]);
          expect(read.line2Overflow, 'no Helpers line 2 runs past its row').toBe(0);
          expect(read.composerIn, 'the composer and its key hints inside the pane and the window').toMatchObject({ inPane: true, inWindow: true });
          expect(read.helpersHeadShown, 'the Helpers strip never gives way past its head').toBe(true);
          expect(read.chipPairs.length, 'the raw worktree draws both chips').toBe(1);
          expect(read.chipPairs, 'inferred and its Bash call, side by side (D-6999)').toEqual([true]);
          for (const [i, p] of read.pathLayout.entries()) {
            if (width < 900) {
              expect(p.ownLine, `path ${i}: on a line of its own`).toBe(true);
              expect(p.full, `path ${i}: the row's full width`).toBe(true);
            }
            expect(p.read, `path ${i}: every character measured`).toBe(true);
            expect(p.badBreaks, `path ${i}: breaks only after a "/" where it can`).toEqual([]);
          }
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
