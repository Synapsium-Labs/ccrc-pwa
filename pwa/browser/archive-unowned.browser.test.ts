// The Archive screen's "Work no session owns" section (desktop polish H4, D-8828), measured in a real Chrome over the
// production build, in both skins and both palettes, at the plan's matrix widths (360, 390, 1280, 1600 and 1920; H4 took 360
// and 1280, session helpers HF2 the rest). HF2 also holds, in a real Chrome, the focus when the section's rows leave (review
// 2988 F6) and the fleet foot's both-state row breaking between its halves (F8). The jsdom suite
// (test/archive-unowned-work.test.tsx) pins the markup and the words; this file holds what it cannot: every control lies
// inside its row, each control's hit area is at least `--tap-min`, the page never scrolls sideways, and no row carries a
// title (a phone shows none, and a title is where a liveness word would hide).
//
// The fixture is the Archive with both kinds of row: two unowned trees (one with a hidden lease, so it offers Not delegated,
// and one with no lease and no path, so it offers nothing and shows its admin record) and two worktrees whose parent and
// worker are both unlisted (one kept, one inferred), beside two archived workspaces. When `H4_SHOTS` names a directory, each
// case also saves its page as a PNG there (the task note's screenshots, taken in a window tall enough to hold the page); nothing is written otherwise.
//
//   CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts --maxWorkers=1 browser/archive-unowned.browser.test.ts
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer } from './app';
import { DEAD_LIFECYCLE, fleetSession } from '../test/fleetFixture';
import { frame, lease, unowned } from '../test/delegationFixture';

const ago = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString();

const SESSIONS = [
  fleetSession({ id: 'lane-a-project-a', project: 'project-a', workspace: null, name: 'lane-a-project-a', status: 'idle' }),
  fleetSession({
    id: 'lane-b-project-a', project: 'project-a', workspace: 'lane-b-project-a', status: 'dead', lifecycle: DEAD_LIFECYCLE,
    branch: 'ws/lane-b-project-a', archivedAt: Math.floor(Date.now() / 1000) - 2 * 86_400, archivedBytes: 410_000_000,
  }),
  fleetSession({
    id: 'lane-c-project-b', project: 'project-b', workspace: 'lane-c-project-b', status: 'dead', lifecycle: DEAD_LIFECYCLE,
    branch: 'ws/lane-c-project-b', archivedAt: Math.floor(Date.now() / 1000) - 5 * 86_400, archivedBytes: 1_200_000_000,
  }),
];

const DELEGATION = frame({
  unowned: [
    unowned({ project: 'project-a', adminRecord: 'agent-a1b2c3d4', canonicalPath: '/work/project-a/.claude/worktrees/agent-a1b2c3d4-with-a-long-worktree-name',
      verdict: 'conflicting', attemptedAt: ago(3), leaseId: '0b0c3f8e-5d55-4c1e-9a77-2f1d8c3e4a10' }),
    unowned({ project: 'project-b', adminRecord: 'agent-e5f6a7b8', canonicalPath: null, verdict: 'unresolved', attemptedAt: ago(9), workspace: 'unmeasured' }),
  ],
  leases: [
    lease({ leaseId: '1c1d4a9f-6e66-4d2f-8b88-3a2e9d4f5b21', parentId: 'coord-gone', via: 'worker-gone', group: 'offline-coordinator', project: 'project-a',
      adminRecord: 'agent-c9d0e1f2', canonicalPath: '/work/project-a/.claude/worktrees/agent-c9d0e1f2', disposition: 'retained', expiresAt: null }),
    lease({ leaseId: '2d2e5bab-7f77-4e3a-9c99-4b3fae5a6c32', parentId: 'coord-gone', via: null, group: 'offline-coordinator', project: 'project-b', sourceKind: 'raw',
      adminRecord: 'agent-d1e2f3a4', canonicalPath: '/work/project-b/.claude/worktrees/agent-d1e2f3a4', disposition: 'ephemeral', expiresAt: null,
      firstObservedAt: '2026-10-26T12:00:00.000Z' }),
  ],
});

const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false }] },
    '/api/runs': [], '/api/claims': [],
  },
  fleetFrames: [
    { type: 'fleet', sessions: SESSIONS },
    { type: 'delegation', delegation: DELEGATION },
  ],
};

const SKINS = [REFINED, INSTRUMENT] as const;
const THEMES = [PHOSPHOR, 'light'] as const;
/** The plan's acceptance matrix widths (session helpers HF2, D-8877: the Archive section's matrix; H4 measured 360 and 1280). */
const WIDTHS = [360, 390, 1280, 1600, 1920] as const;

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

interface Measure {
  readonly rows: number;
  readonly outside: readonly string[];
  readonly shortTargets: readonly string[];
  readonly floor: number;
  readonly sidewaysScroll: boolean;
  readonly titled: readonly string[];
  readonly headText: string;
}

describe('Archive: Work no session owns, in a real Chrome', () => {
  for (const skin of SKINS) {
    for (const theme of THEMES) {
      for (const width of WIDTHS) {
        it(`${skin} ${theme} at ${width}px: every control inside its row and at least --tap-min, no title, no sideways scroll`, async () => {
          const opened = await openApp(browser!, { skin, theme, width }, FIXTURE);
          try {
            await opened.page.goto(`${server!.origin}/archive`);
            await opened.page.waitForSelector('[data-unowned-row]', { timeout: 20_000 });
            await opened.page.evaluate(async () => { await document.fonts.ready; });
            await opened.page.waitForTimeout(400); // the first paint's transitions settle
            // HF2: one picture per view when `CCRC_SHOTS` names a directory, before the assertions, so the same file run over
            // `origin/main` gives the matrix's "before" column.
            const matrixShots = process.env['CCRC_SHOTS'];
            if (matrixShots !== undefined && matrixShots !== '') await opened.page.screenshot({ path: path.join(matrixShots, `archive-${skin}-${theme}-${width}.png`) });
            const m = await opened.page.evaluate((): Measure => {
              const floor = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap-min'));
              const rows = [...document.querySelectorAll<HTMLElement>('[data-unowned-row]')];
              const section = rows[0]!.closest('section')!;
              const outside: string[] = [];
              const shortTargets: string[] = [];
              for (const row of rows) {
                const r = row.getBoundingClientRect();
                for (const b of row.querySelectorAll<HTMLElement>('button')) {
                  const br = b.getBoundingClientRect();
                  const name = b.getAttribute('aria-label') ?? b.textContent ?? '';
                  if (br.left < r.left - 0.5 || br.right > r.right + 0.5 || br.top < r.top - 0.5 || br.bottom > r.bottom + 0.5) outside.push(name);
                  if (br.height < floor - 0.5) shortTargets.push(`${name}: ${br.height}`);
                }
              }
              return {
                rows: rows.length, outside, shortTargets, floor,
                sidewaysScroll: document.documentElement.scrollWidth > window.innerWidth + 0.5,
                titled: [...section.querySelectorAll<HTMLElement>('[title]:not([title=""])')].map((e) => e.getAttribute('title') ?? ''),
                headText: section.querySelector('h2')?.textContent ?? '',
              };
            });
            expect(m.floor, 'the token resolves').toBe(44);
            expect(m.rows, 'two unowned trees and two worktrees').toBe(4);
            expect(m.headText).toBe('Work no session owns 4 · presence on disk not measured for 1 tree');
            expect(m.outside, 'a control outside its row').toEqual([]);
            expect(m.shortTargets, 'a control under the tap floor').toEqual([]);
            expect(m.titled, 'a row carrying a title').toEqual([]);
            expect(m.sidewaysScroll, 'the page scrolls sideways').toBe(false);
            expect(opened.errors, 'uncaught page errors').toEqual([]);
            const shots = process.env['H4_SHOTS'];
            if (shots !== undefined && shots !== '') {
              mkdirSync(shots, { recursive: true });
              // The page scrolls in an inner container, so a full-page capture of a short window shows the bottom bar over the
              // list (review 2966 M5): a window tall enough to hold the whole page shows it as the operator would scroll to it.
              await opened.page.setViewportSize({ width, height: 2000 });
              await opened.page.waitForTimeout(300);
              await opened.page.screenshot({ path: path.join(shots, `archive-unowned-${width}-${skin}-${theme}.png`), fullPage: true });
            }
          } finally {
            await opened.ctx.close();
          }
        }, 90_000);
      }
    }
  }
});

// The fleet foot's Archived row is the door to the section when nothing is archived (review 2966 F5): the same row, at the
// tap floor, drawn inside the column, and it goes to /archive.
const DOOR_FIXTURE: AppFixture = {
  ...FIXTURE,
  fleetFrames: [
    { type: 'fleet', sessions: [SESSIONS[0]!] },
    { type: 'delegation', delegation: DELEGATION },
  ],
};

describe('Fleet foot: the Archived row is the door to work no session owns, with nothing archived', () => {
  for (const skin of SKINS) {
    for (const theme of THEMES) {
      for (const width of WIDTHS) {
        it(`${skin} ${theme} at ${width}px: one row, at least --tap-min, inside the page, to /archive`, async () => {
          const opened = await openApp(browser!, { skin, theme, width }, DOOR_FIXTURE);
          try {
            await opened.page.goto(`${server!.origin}/fleet`);
            await opened.page.waitForSelector('.fleet-archived-row', { timeout: 20_000 });
            await opened.page.evaluate(async () => { await document.fonts.ready; });
            await opened.page.waitForTimeout(400);
            const m = await opened.page.evaluate(() => {
              const floor = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap-min'));
              const rows = [...document.querySelectorAll<HTMLElement>('.fleet-archived-row')];
              const r = rows[0]!.getBoundingClientRect();
              return { count: rows.length, text: rows[0]!.textContent ?? '', height: r.height, floor, right: r.right, vw: window.innerWidth,
                sideways: document.documentElement.scrollWidth > window.innerWidth + 0.5 };
            });
            expect(m.count, 'one row, not two').toBe(1);
            expect(m.text).toBe('Work no session owns · 4');
            expect(m.height).toBeGreaterThanOrEqual(m.floor - 0.5);
            expect(m.right).toBeLessThanOrEqual(m.vw + 0.5);
            expect(m.sideways, 'the page scrolls sideways').toBe(false);
            const shots = process.env['H4_SHOTS'];
            if (shots !== undefined && shots !== '') {
              await opened.page.setViewportSize({ width, height: 1400 });
              await opened.page.waitForTimeout(300);
              await opened.page.screenshot({ path: path.join(shots, `fleet-door-${width}-${skin}-${theme}.png`), fullPage: true });
            }
            await opened.page.click('.fleet-archived-row');
            await opened.page.waitForURL(/\/archive$/, { timeout: 10_000 });
            await opened.page.waitForSelector('[data-unowned-row]', { timeout: 20_000 });
            expect(opened.errors, 'uncaught page errors').toEqual([]);
          } finally {
            await opened.ctx.close();
          }
        }, 90_000);
      }
    }
  }
});

// Session helpers HF2 (D-8877; review 2988 F6): the focus when the section's rows leave, in a real Chrome, where jsdom only
// asserted it. A control holds the focus; one of two rows leaves (a new frame) and the section's heading takes it; the last
// leaves and the section goes, and the page body takes it: a real box the browser focuses, never `body`.
const FOCUS_LEASES = DELEGATION.leases;
const FOCUS_FIXTURE: AppFixture = {
  ...FIXTURE,
  fleetFrames: [
    { type: 'fleet', sessions: SESSIONS },
    { type: 'delegation', delegation: frame({ leases: FOCUS_LEASES }) },
  ],
};

describe('Archive: the focus when the section\'s rows leave, in a real Chrome (HF2, review 2988 F6)', () => {
  for (const skin of SKINS) {
    for (const width of WIDTHS) {
      it(`${skin} at ${width}px: one of two leaves, the heading; the last leaves, the page body`, async () => {
        const opened = await openApp(browser!, { skin, theme: PHOSPHOR, width }, FOCUS_FIXTURE);
        try {
          await opened.page.goto(`${server!.origin}/archive`);
          await opened.page.waitForSelector('[data-unowned-row]', { timeout: 20_000 });
          await opened.page.waitForTimeout(300);
          const [first, second] = FOCUS_LEASES as readonly { leaseId: string; adminRecord: string }[];
          await opened.page.getByRole('button', { name: `Keep worktree (${first!.adminRecord})` }).focus();
          expect(await opened.page.evaluate(() => document.activeElement?.closest('[data-unowned-row]') !== null), 'CONTROL: a row\'s control holds it').toBe(true);
          opened.send('/ws/fleet', { type: 'delegation', delegation: frame({ leases: FOCUS_LEASES.filter((l) => l.leaseId !== first!.leaseId) }) });
          await opened.page.waitForFunction(() => document.querySelectorAll('[data-unowned-row]').length === 1, null, { timeout: 10_000 });
          await opened.page.waitForTimeout(200);
          const one = await opened.page.evaluate(() => {
            const a = document.activeElement;
            return { heading: a !== null && a.matches('section h2 > span'), body: a === document.body };
          });
          expect(one, 'one of two leaves: the section\'s heading').toEqual({ heading: true, body: false });
          await opened.page.getByRole('button', { name: `Keep worktree (${second!.adminRecord})` }).focus();
          opened.send('/ws/fleet', { type: 'delegation', delegation: frame({ leases: [] }) });
          await opened.page.waitForFunction(() => document.querySelector('[data-unowned-row]') === null, null, { timeout: 10_000 });
          await opened.page.waitForTimeout(200);
          const last = await opened.page.evaluate(() => {
            const a = document.activeElement;
            const box = a === null ? null : a.getBoundingClientRect();
            return {
              pageBody: a !== null && a.matches('[data-page-body]'), body: a === document.body,
              boxed: box !== null && box.width > 0 && box.height > 0 && getComputedStyle(a!).display !== 'contents',
            };
          });
          expect(last, 'the last leaves: the page body, a real box').toEqual({ pageBody: true, body: false, boxed: true });
          expect(opened.errors, 'uncaught page errors').toEqual([]);
        } finally {
          await opened.ctx.close();
        }
      }, 90_000);
    }
  }
});

// Session helpers HF2 (review 2988 F8): with both halves to say, the foot row at a phone's width breaks only between them, so
// neither half is cut and no word of one is left alone on a line ("owns · 4" alone, before).
describe('Fleet foot: the both-state Archived row breaks between its halves (HF2, review 2988 F8)', () => {
  for (const skin of SKINS) {
    for (const width of WIDTHS) {
      it(`${skin} at ${width}px: each half whole on its line(s), the break between them`, async () => {
        const opened = await openApp(browser!, { skin, theme: PHOSPHOR, width }, FIXTURE);
        try {
          await opened.page.goto(`${server!.origin}/fleet`);
          await opened.page.waitForSelector('.fleet-archived-row', { timeout: 20_000 });
          await opened.page.evaluate(async () => { await document.fonts.ready; });
          await opened.page.waitForTimeout(400);
          const footShots = process.env['CCRC_SHOTS'];
          if (footShots !== undefined && footShots !== '') {
            await opened.page.locator('.fleet-archived-row').scrollIntoViewIfNeeded();
            await opened.page.screenshot({ path: path.join(footShots, `foot-${skin}-${width}.png`) });
          }
          const m = await opened.page.evaluate(() => {
            const row = document.querySelector<HTMLElement>('.fleet-archived-row')!;
            // Each drawn character's line (its box's top), and the text of each line.
            const lines: Array<{ top: number; text: string }> = [];
            const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
            for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
              const t = n.textContent ?? '';
              for (let i = 0; i < t.length; i++) {
                const range = document.createRange();
                range.setStart(n, i); range.setEnd(n, i + 1);
                const box = range.getClientRects()[0];
                if (box === undefined) continue;
                const line = lines.find((l) => Math.abs(l.top - box.top) < 4);
                if (line === undefined) lines.push({ top: box.top, text: t[i]! }); else line.text += t[i]!;
              }
            }
            return { text: (row.textContent ?? '').replace(/ /g, ' '), lines: lines.map((l) => l.text.replace(/ /g, ' ').trim()) };
          });
          expect(m.text, 'both halves').toMatch(/^Archived on disk · 2 · .+ · Work no session owns · 4$/);
          if (m.lines.length > 1) {
            expect(m.lines, 'two lines, broken between the halves').toHaveLength(2);
            expect(m.lines[0], 'the archived half whole, then its separator').toMatch(/^Archived on disk · 2 · .+ ·$/);
            expect(m.lines[1], 'the unowned half whole').toBe('Work no session owns · 4');
          }
          expect(opened.errors, 'uncaught page errors').toEqual([]);
        } finally {
          await opened.ctx.close();
        }
      }, 90_000);
    }
  }
});
