// D-8142: a coordinator's fleet card says `coordinator`, first on its context line, in a real Chrome over the production
// build. One legible fact at every width: the word is drawn whole (not cut, not wrapped), inside its row, on the first
// line of the context; a long branch beside it keeps the token-shortened form below the desk and its two-line clamp at the
// desk (D-6332), and a child's card never wears it. `test/card-header-facts.test.tsx` holds the model and the markup;
// this file holds the geometry. Measured in Refined's cards and in Instrument's status and project modes, in the Phosphor
// palette and the light theme, at 360, 390, 1280, 1470 and 1920.
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/role-fact.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { GROUP_MODE_KEY } from '../src/skins/instrument/FleetTable';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const THEMES = [PHOSPHOR, 'light'] as const;
const WIDTHS = [360, 390, 1280, 1470, 1920] as const;
const MODES = [
  { skin: REFINED, mode: 'cards' },
  { skin: INSTRUMENT, mode: 'status' },
  { skin: INSTRUMENT, mode: 'project' },
] as const;
const CASES = MODES.flatMap(({ skin, mode }) => THEMES.flatMap((theme) =>
  WIDTHS.map((width) => ({ view: { skin, theme, width } as AppView, mode }))));
const named = (v: AppView, mode: string): string => `${v.skin}, ${v.theme}, ${v.width}px, ${mode}`;

const PROJECT = 'project-a';
const BRANCH_60 = 'feat/garden-stone-silver-harbor-morning-cedars-quiet-river-run';
const ROSTER = [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', pool: 'pool-a', homeAble: true, hidden: false }];
const row = (ws: string, extra: object = {}): object => ({
  id: `${PROJECT}-${ws}`, wrapper: 'lane-a', home: 'lane-a', project: PROJECT, workdir: `/w/${PROJECT}/${ws}`, workspace: ws,
  name: ws, status: 'busy', statusUpdatedAt: null, limits: null, dialogPending: false, version: null, model: null,
  effort: null, ultracode: false, branch: `ws/${ws}`, ctxPct: null, paneCols: null, tasks: null, pr: null,
  archivedAt: null, archivedBytes: null, held: null, hookState: null, askSummary: null, subagents: null, background: null,
  withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket: 'working', unmeasured: [], started: true,
  child: { kind: 'none' }, role: 'coordinator', ...extra,
});
const PR = { phase: 'open', number: 123, url: null, title: null, checks: 'pass', checkNames: null, ahead: 1, reason: null,
  checkedAt: 1, mergedAt: null, retryAt: null };
const SESSIONS = [
  row('coord-branch', { branch: BRANCH_60 }),
  row('coord-pr', { pr: PR }),
  row('child-branch', { role: 'child', branch: BRANCH_60 }),
  row('selected'),
];
const SELECTED = `${PROJECT}-selected`;
const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: ROSTER },
    '/api/projects': { roots: ['/w'], projects: [{ name: PROJECT, workdir: `/w/${PROJECT}` }] },
    '/api/runs': [],
    '/api/claims': [],
  },
  fleetFrames: [{ type: 'fleet', sessions: SESSIONS }],
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

async function boot(view: AppView, mode: string): Promise<{ page: Page; errors: string[]; close: () => Promise<void> }> {
  const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
  if (mode === 'project') {
    await ctx.addInitScript((key) => {
      try { localStorage.setItem(key, 'project'); } catch { /* no storage: Instrument opens on status */ }
    }, GROUP_MODE_KEY);
  }
  await page.goto(server!.origin + (view.width >= 900 ? `/s/${SELECTED}` : '/'));
  await page.waitForFunction(([skin, theme]) => {
    const root = document.documentElement;
    return root.getAttribute('data-skin') === skin && (root.getAttribute('data-theme') ?? 'phosphor') === theme;
  }, [view.skin, view.theme] as const, { timeout: 20_000 });
  await page.locator('.sess-line').first().waitFor();
  return { page, errors, close: () => ctx.close() };
}

interface RowRole {
  readonly name: string;
  readonly roles: number;
  readonly text: string;
  readonly cut: boolean;
  readonly inside: boolean;
  readonly oneLine: boolean;
  readonly firstOnLine: boolean;
  readonly contextOneLine: boolean;
}

/** Per row: its name, how many `.sess-role` cells it draws, and the first one's geometry. */
function measure(page: Page): Promise<RowRole[]> {
  return page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.sess-line')].map((line) => {
    const open = line.querySelector('.sess-open');
    const name = (open?.querySelector('.sr-only') ?? open?.querySelector('.sess-label'))?.textContent ?? '';
    const roles = line.querySelectorAll<HTMLElement>('.sess-role');
    const role = roles[0];
    const ctx = line.querySelector<HTMLElement>('.sess-meta--context');
    const empty = { name, roles: roles.length, text: '', cut: false, inside: true, oneLine: true, firstOnLine: true, contextOneLine: true };
    if (role === undefined || ctx === undefined || ctx === null) return empty;
    const r = role.getBoundingClientRect();
    const l = line.getBoundingClientRect();
    const c = ctx.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(role).lineHeight) || r.height;
    return {
      ...empty,
      text: role.textContent ?? '',
      cut: role.scrollWidth > role.clientWidth + 0.5,
      inside: r.left >= l.left - 0.5 && r.right <= l.right + 0.5 && r.top >= l.top - 0.5 && r.bottom <= l.bottom + 0.5,
      oneLine: r.height <= lh * 1.5,
      // The role is the first cell of the context line: its left edge is the context's, its top the context's first line.
      firstOnLine: Math.abs(r.left - c.left) <= 1 && r.top - c.top <= lh,
      contextOneLine: c.height <= lh * 1.5,
    };
  }));
}

const sideScroll = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

describe('D-8142: the card says coordinator', () => {
  for (const { view, mode } of CASES) {
    it(`a coordinator's card wears the word whole, a child's does not (${named(view, mode)})`, async () => {
      const { page, errors, close } = await boot(view, mode);
      try {
        const rows = await measure(page);
        for (const name of ['coord-branch', 'coord-pr']) {
          const r = rows.find((x) => x.name === name);
          expect(r, `${name} is drawn`).toBeDefined();
          expect(r!.roles, `${name}: exactly one role cell`).toBe(1);
          expect(r!.text, `${name}: the word`).toBe('coordinator');
          expect(r!.cut, `${name}: the word is not cut`).toBe(false);
          expect(r!.inside, `${name}: the word is inside its row`).toBe(true);
          expect(r!.oneLine, `${name}: the word is on one line`).toBe(true);
          expect(r!.firstOnLine, `${name}: the word begins the context line`).toBe(true);
        }
        // The PR row and, below the desk, the branch row keep their context on one line (the desk clamps a branch to two, D-6332).
        expect(rows.find((x) => x.name === 'coord-pr')!.contextOneLine, 'the PR context is one line').toBe(true);
        if (view.width < 900) {
          expect(rows.find((x) => x.name === 'coord-branch')!.contextOneLine, 'the branch context is one line').toBe(true);
        }
        const kid = rows.find((x) => x.name === 'child-branch');
        expect(kid, 'the child row is drawn').toBeDefined();
        expect(kid!.roles, 'a child wears no role').toBe(0);
        expect(await sideScroll(page), 'no horizontal overflow').toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await close();
      }
    });
  }
});
