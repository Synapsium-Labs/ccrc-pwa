// The delegation broker's rows on a project card (wave 4, PR2), measured in a real Chrome over the production build at
// 390, 1280 and 1920, in both skins and both palettes. The jsdom suites (test/project-card.test.tsx,
// test/fleet-rollup-render.test.tsx) pin the markup; this file holds what they cannot: that every row of delegated work,
// every worktree with its chips and every group member fits its card at each width, with no sideways scroll.
//
// The fixture is one card, project-a: a programme (`port-api`: its coordinator, which has delegated work, and one worker,
// whose live activity is a chip on its row and whose worktree sits under the coordinator `via` it) and a session in no
// programme, whose delegated work and raw worktree (a long name and a long path, a works-on chip, `inferred` and the
// creating Bash call) nest under it; both heads' folds are opened. Both groups are opened too: a worktree whose parent
// is gone and one unowned tree.
// Instrument is put in its project mode (`GROUP_MODE_KEY`), where it draws the same project cards as Refined.
//
//   CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts --maxWorkers=2 browser/delegation-rows.browser.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type DistServer } from './app';
import { GROUP_MODE_KEY } from '../src/skins/instrument/FleetTable';
import { withRunBinding } from '../test/runBindingFixture';
import { activity, frame, lease, unowned } from '../test/delegationFixture';

const NOW = Date.now();

const session = (id: string, project: string, extra: object = {}): object => ({
  id, wrapper: 'lane-a', home: 'lane-a', project, workdir: `/w/${project}/${id}`,
  workspace: id, name: id, status: 'busy', statusUpdatedAt: NOW - 60_000, limits: null, dialogPending: false, version: null,
  model: null, effort: null, ultracode: false, branch: `ws/${id}`, ctxPct: 40, paneCols: null, tasks: null, pr: null,
  archivedAt: null, archivedBytes: null, held: null, hookState: null, askSummary: null, subagents: null, background: null,
  withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket: 'working', bucketSince: NOW - 60_000, unmeasured: [],
  started: true, child: { kind: 'none' }, ...extra,
});

const RUNS = [{
  id: 100, program: 'port-api', programTitle: 'Port the API', wave: 2, waveOf: 4, project: 'project-a', homeProject: 'project-a',
  sessionId: 'port-w1', workspace: 'port-w1', branch: 'ws/port-w1', state: 'working', kind: 'work', reviews: null,
  claimedBy: 'port-coord', resumed: false, clearedAt: null, openedAt: NOW - 3_600_000, dispatchStartedAt: null,
  dispatchedAt: NOW - 3_000_000, closedAt: null, handoffCommit: null, items: { done: 0, total: 0 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: false,
    clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, reviewCap: null,
}];

const SESSIONS = [
  session('port-coord', 'project-a', { role: 'coordinator' }),
  session('port-w1', 'project-a', { role: 'child' }),
  session('lone-tidy-pass', 'project-a'),
];

const LONG_PATH = '/w/project-a/.claude/worktrees/agent-a1b2c3d4e5f6-a-very-long-worktree-name-that-should-wrap-rather-than-push';
const DELEGATION = frame({
  activities: [
    activity({ activityId: 'a-lone', parentId: 'lone-tidy-pass',
      displayName: 'map every caller of the projection decider across the server and the PWA trees' }),
    activity({ activityId: 'a-coord', parentId: 'port-coord', displayName: 'read the plan' }),
    activity({ activityId: 'a-chip', parentId: 'port-w1', placement: 'chip', displayName: 'check the wire' }),
  ],
  leases: [
    lease({ leaseId: 'l-lone', parentId: 'lone-tidy-pass', sourceKind: 'raw', project: 'project-b', adminRecord: 'agent-l1',
      canonicalPath: LONG_PATH }),
    lease({ leaseId: 'l-via', parentId: 'port-w1', adminRecord: 'agent-v1', canonicalPath: '/w/project-a/.claude/worktrees/agent-v1' }),
    lease({ leaseId: 'l-off', parentId: 'coord-gone', group: 'offline-coordinator', sourceKind: 'raw', adminRecord: 'agent-o1',
      canonicalPath: '/w/project-a/.claude/worktrees/agent-o1' }),
  ],
  unowned: [unowned({ adminRecord: 'agent-u1', canonicalPath: '/w/project-a/.claude/worktrees/agent-u1' })],
});

const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false }] },
    '/api/runs': RUNS, '/api/claims': [],
  },
  // A current server's frames: each worker carries the run binding over RUNS (D-7182, C7d), then the projection.
  fleetFrames: [
    { type: 'fleet', sessions: withRunBinding(SESSIONS as never[], RUNS as never[]) },
    { type: 'runs', runs: RUNS },
    { type: 'delegation', delegation: DELEGATION },
  ],
};

const SKINS = [REFINED, INSTRUMENT] as const;
const THEMES = [PHOSPHOR, 'light'] as const;
const WIDTHS = [390, 1280, 1920] as const;

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

async function open(skin: string, theme: string, width: number) {
  const opened = await openApp(browser!, { skin, theme, width }, FIXTURE);
  await opened.ctx.addInitScript(([key]) => {
    try { localStorage.setItem(key, 'project'); } catch { /* the default mode is then measured, and the rows are absent */ }
  }, [GROUP_MODE_KEY] as const);
  await opened.page.goto(server!.origin + '/');
  await opened.page.waitForSelector('.proj-group-toggle', { timeout: 20_000 });
  // Both groups start closed, and the two heads' children fold (two of them reach `CHILD_FOLD_MIN`): open each, as the
  // operator would, so every row is drawn.
  for (const name of ['Offline coordinator', 'Unowned work']) {
    await opened.page.locator('.proj-group-toggle', { hasText: name }).click();
  }
  const folded = opened.page.locator('.proj-children-toggle[aria-expanded="false"]');
  for (let n = await folded.count(); n > 0; n = await folded.count()) await folded.first().click();
  await opened.page.waitForSelector('.proj-work >> nth=5', { timeout: 20_000 });
  await opened.page.evaluate(async () => { await document.fonts.ready; });
  await opened.page.waitForTimeout(400); // the first paint's transitions settle
  return opened;
}

interface RowFit {
  readonly text: string;
  readonly inCard: boolean;
  readonly overflow: number;
  readonly cells: { readonly text: string; readonly inRow: boolean; readonly width: number }[];
}

/** Every delegation row on the page: whether it sits inside its card, how far its content overflows its own box, and
 *  whether each of its chips sits inside the row with a width of its own. */
const measureRows = (): RowFit[] => [...document.querySelectorAll<HTMLElement>('.proj-work')].map((row) => {
  const card = row.closest('.proj-card')!.getBoundingClientRect();
  const r = row.getBoundingClientRect();
  const within = (a: DOMRect, b: DOMRect): boolean => a.left >= b.left - 0.5 && a.right <= b.right + 0.5;
  return {
    text: row.textContent ?? '',
    inCard: within(r, card),
    overflow: row.scrollWidth - row.clientWidth,
    cells: [...row.querySelectorAll<HTMLElement>('.proj-work-chip, .sess-workson')].map((c) => {
      const cr = c.getBoundingClientRect();
      return { text: c.textContent ?? '', inRow: within(cr, r), width: cr.width };
    }),
  };
});

describe.each(SKINS)('delegation rows on a project card in %s', (skin) => {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      it(`at ${width} (${theme}): no sideways scroll, no page error, every row and chip inside its card`, async () => {
        const { ctx, page, errors } = await open(skin, theme, width);
        try {
          const shots = process.env['CCRC_SHOTS'];
          if (shots !== undefined && shots !== '') {
            await page.screenshot({ path: `${shots}/delegation-${skin}-${theme}-${width}.png`, fullPage: true });
          }
          const sideScroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(sideScroll, 'sideways scroll').toBe(0);
          const rows = await page.evaluate(measureRows);
          // The lone session's two, the coordinator's activity and the worker's worktree in the box, and one per group.
          expect(rows, 'six delegation rows').toHaveLength(6);
          for (const row of rows) {
            expect(row.inCard, `${row.text}: inside its card`).toBe(true);
            expect(row.overflow, `${row.text}: nothing overflows the row`).toBeLessThanOrEqual(1);
            for (const c of row.cells) {
              expect(c.inRow, `${c.text}: inside its row`).toBe(true);
              expect(c.width, `${c.text}: drawn`).toBeGreaterThan(0);
            }
          }
          const chips = rows.flatMap((r) => r.cells.map((c) => c.text));
          expect(chips.filter((t) => t === 'inferred'), 'each raw worktree wears inferred').toHaveLength(2);
          expect(chips.some((t) => t.includes('project-b')), 'the works-on chip').toBe(true);
          // R9: the worker's live activity is a chip on its row, never a row.
          const r9 = await page.evaluate(() => [...document.querySelectorAll('.sess-meta-chip')].map((e) => e.textContent));
          expect(r9).toContain('1 delegated');
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      });
    }
  }
});
