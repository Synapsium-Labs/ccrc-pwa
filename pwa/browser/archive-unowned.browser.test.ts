// The Archive screen's "Work no session owns" section (desktop polish H4, D-8828), measured in a real Chrome over the
// production build, in both skins and both palettes, at a phone's width (360) and at a desk (1280). The jsdom suite
// (test/archive-unowned-work.test.tsx) pins the markup and the words; this file holds what it cannot: every control lies
// inside its row, each control's hit area is at least `--tap-min`, the page never scrolls sideways, and no row carries a
// title (a phone shows none, and a title is where a liveness word would hide).
//
// The fixture is the Archive with both kinds of row: two unowned trees (one with a hidden lease, so it offers Not delegated,
// and one with no lease and no path, so it offers nothing and shows its admin record) and two worktrees whose parent and
// worker are both unlisted (one kept, one inferred), beside two archived workspaces. When `H4_SHOTS` names a directory, each
// case also saves its page as a PNG there (the task note's screenshots); nothing is written otherwise.
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
const WIDTHS = [360, 1280] as const;

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
