// D-8142, D-8817: a coordinator's fleet card wears the role BADGE (the word `coordinator` is its accessible name, not drawn),
// first on its context line, in a real Chrome over the production build. One legible fact at every width: the badge is drawn
// whole (not cut, not wrapped), 16px square, inside its row, on the first line of the context; a long branch beside it keeps the token-shortened form below the desk and its two-line clamp at the
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
import { withRunBinding } from '../test/runBindingFixture';

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
  readonly label: string;
  readonly text: string;
  readonly width: number;
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
    const empty = { name, roles: roles.length, label: '', text: '', width: 0, cut: false, inside: true, oneLine: true, firstOnLine: true, contextOneLine: true };
    if (role === undefined || ctx === undefined || ctx === null) return empty;
    const r = role.getBoundingClientRect();
    const l = line.getBoundingClientRect();
    const c = ctx.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(role).lineHeight) || r.height;
    return {
      ...empty,
      label: role.getAttribute('aria-label') ?? '',
      text: role.textContent ?? '',
      width: r.width,
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

describe('D-8142, D-8817: the card wears the coordinator badge', () => {
  for (const { view, mode } of CASES) {
    it(`a coordinator's card wears the badge whole, a child's does not (${named(view, mode)})`, async () => {
      const { page, errors, close } = await boot(view, mode);
      try {
        const rows = await measure(page);
        for (const name of ['coord-branch', 'coord-pr']) {
          const r = rows.find((x) => x.name === name);
          expect(r, `${name} is drawn`).toBeDefined();
          expect(r!.roles, `${name}: exactly one role cell`).toBe(1);
          expect(r!.label, `${name}: the accessible name`).toBe('coordinator');
          expect(r!.text, `${name}: no visible word`).toBe('');
          expect(r!.width, `${name}: the badge is its icon's 16px`).toBe(16);
          expect(r!.cut, `${name}: the badge is not cut`).toBe(false);
          expect(r!.inside, `${name}: the badge is inside its row`).toBe(true);
          expect(r!.oneLine, `${name}: the badge is on one line`).toBe(true);
          expect(r!.firstOnLine, `${name}: the badge begins the context line`).toBe(true);
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

// D-8817, review 2905 F1: in the session header the badge is the line's own glyph size and sits where the Goals door's glyph
// sits, and it adds nothing to the header's height. A coordinator that holds a programme's run, so its header draws the
// Goals door, is opened at each width in each skin and theme.
const HEAD_NOW = Date.now();
const headRow = (id: string, extra: object = {}): object => ({
  ...row(id, extra), id: `${PROJECT}-${id}`, statusUpdatedAt: HEAD_NOW - 60_000, bucketSince: HEAD_NOW - 60_000, started: true,
});
const HEAD_RUN = {
  id: 301, program: 'billing', programTitle: 'Billing rework', wave: 3, waveOf: 6, project: PROJECT, homeProject: PROJECT,
  sessionId: `${PROJECT}-head-w1`, workspace: 'head-w1', branch: 'ws/head-w1', state: 'working', kind: 'work', reviews: null,
  claimedBy: `${PROJECT}-head-coord`, resumed: false, clearedAt: null, openedAt: HEAD_NOW - 3_600_000, dispatchStartedAt: null,
  dispatchedAt: HEAD_NOW - 3_000_000, closedAt: null, handoffCommit: null, items: { done: 0, total: 0 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: false,
    clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, reviewCap: null, hadChild: false,
};
// The coordinator is a workspace session, as the fleet's coordinators are, so Instrument's header draws the role detail on a line of its own.
const HEAD_SESSIONS = [headRow('head-coord', { ctxPct: 40 }), headRow('head-w1', { role: 'child' })];
const HEAD_FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: ROSTER },
    '/api/projects': { roots: ['/w'], projects: [{ name: PROJECT, workdir: `/w/${PROJECT}` }] },
    '/api/runs': [HEAD_RUN], '/api/claims': [],
  },
  fleetFrames: [{ type: 'fleet', sessions: withRunBinding(HEAD_SESSIONS as never[], [HEAD_RUN] as never[]) }, { type: 'runs', runs: [HEAD_RUN] }],
};

interface HeadMeasure {
  readonly badge: { readonly w: number; readonly h: number; readonly cy: number; readonly fontPx: number; readonly cls: string; readonly text: string } | null;
  readonly goals: { readonly w: number; readonly h: number; readonly cy: number; readonly top: number; readonly bottom: number } | null;
  readonly box: { readonly cy: number; readonly top: number; readonly bottom: number } | null;
  readonly headH: number;
  /** The header's height with the word in the badge's place, as `main` drew it: a plain `.chat-fact` holding `coordinator`. */
  readonly headHWord: number;
}

async function measureHead(page: Page): Promise<HeadMeasure> {
  return page.evaluate(() => {
    const head = document.querySelector<HTMLElement>('.chat-head')!;
    const role = head.querySelector<HTMLElement>('.chat-fact-role');
    const badgeEl = role?.querySelector<HTMLElement>('[role="img"][aria-label="coordinator"]') ?? null;
    const bsvg = badgeEl?.querySelector('svg')?.getBoundingClientRect();
    const gsvg = head.querySelector('.chat-coord-goals svg')?.getBoundingClientRect();
    const rr = role?.getBoundingClientRect();
    // Everything of the badge and the Goals glyph is read BEFORE the probe below swaps the badge's markup.
    const badge = badgeEl === null || bsvg === undefined ? null
      : { w: bsvg.width, h: bsvg.height, cy: bsvg.top + bsvg.height / 2, fontPx: parseFloat(getComputedStyle(badgeEl).fontSize), cls: badgeEl.className, text: badgeEl.textContent ?? '' };
    const headH = head.getBoundingClientRect().height;
    let headHWord = headH;
    if (role !== null) {
      // The word where the badge is, in the markup `main` drew it in (a plain `.chat-fact`), measured, then put back.
      const saved = role.innerHTML;
      role.classList.remove('chat-fact-role');
      role.innerHTML = 'coordinator';
      headHWord = head.getBoundingClientRect().height;
      role.innerHTML = saved;
      role.classList.add('chat-fact-role');
    }
    return {
      badge,
      goals: gsvg === undefined ? null : { w: gsvg.width, h: gsvg.height, cy: gsvg.top + gsvg.height / 2, top: gsvg.top, bottom: gsvg.bottom },
      box: rr === undefined ? null : { cy: rr.top + rr.height / 2, top: rr.top, bottom: rr.bottom },
      headH, headHWord,
    };
  });
}

describe('D-8817: the header\'s role badge is the line\'s glyph, in place', () => {
  for (const { skin, theme, width } of MODES.flatMap(({ skin }) => skin === REFINED || skin === INSTRUMENT ? [{ skin }] : [])
    .filter((m, i, all) => all.findIndex((x) => x.skin === m.skin) === i)
    .flatMap(({ skin }) => THEMES.flatMap((theme) => [360, 1280].map((width) => ({ skin, theme, width }))))) {
    it(`${skin}, ${theme}, ${width}px: 1em like the Goals glyph, on its centre line, and no height added`, async () => {
      const { ctx, page, errors } = await openApp(browser!, { skin, theme, width } as AppView, HEAD_FIXTURE);
      try {
        await page.goto(server!.origin + `/s/${PROJECT}-head-coord`);
        await page.waitForSelector('.chat-head', { timeout: 20_000 });
        await page.evaluate(async () => { await document.fonts.ready; });
        const toggle = page.getByRole('button', { name: /details/i });
        if (await toggle.count() > 0 && (await toggle.first().getAttribute('aria-expanded')) === 'false') await toggle.first().click();
        await page.waitForSelector('.chat-fact-role', { timeout: 10_000 });
        await page.waitForTimeout(300);
        const m = await measureHead(page);
        expect(m.badge, 'the header draws the badge').not.toBeNull();
        expect(m.badge!.text, 'no visible word').toBe('');
        expect(m.badge!.cls, 'the card\'s role rule is not on the header badge').not.toContain('sess-role');
        expect(m.badge!.w, 'the glyph is 1em wide').toBeCloseTo(m.badge!.fontPx, 0);
        expect(m.badge!.h, 'the glyph is 1em tall').toBeCloseTo(m.badge!.fontPx, 0);
        // The Goals door is drawn in every Refined header and in Instrument's desk header; Instrument's phone header has none,
        // and there the badge is measured against its own line only.
        if (skin === REFINED || width >= 900) expect(m.goals, 'the Goals door is drawn in this header').not.toBeNull();
        if (m.goals !== null) expect(m.badge!.w, 'the same size as the Goals door\'s glyph').toBeCloseTo(m.goals.w, 0);
        // On its neighbour's centre line when they share a row (the box overlaps the Goals glyph's rows), else centred in its own box.
        const sharesRow = m.goals !== null && m.box !== null && m.goals.top < m.box.bottom && m.goals.bottom > m.box.top;
        if (sharesRow) expect(Math.abs(m.badge!.cy - m.goals!.cy), 'on the Goals glyph\'s centre line').toBeLessThanOrEqual(2);
        else expect(Math.abs(m.badge!.cy - m.box!.cy), 'centred in its own line box').toBeLessThanOrEqual(1);
        expect(Math.abs(m.headH - m.headHWord), 'the header is the height it was with the word in the badge\'s place').toBeLessThanOrEqual(0.5);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});
