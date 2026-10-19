// The row-fit measures, in a real Chrome over the production build (foundations follow-up F-e). Two follow-ups after
// the review polish (#661) held their geometry in Playwright scripts outside the repo, because there was no pwa
// browser leg on main until #627 landed; this file is those measures, ported.
//
// - D-5570: an account picker's row fits `.sheet-body`, and so does its keyboard ring. Measured in the new-session
//   sheet (every row wears its pool tag) and in the swap picker, both its plain list (the measured lane wears
//   "suggested") and its "show other pools" rows (each wears a pool tag), at 360, 390, 1280 and 1920.
// - D-5576: every project card keeps its name. On a card that does not hold the selection (the fleet route on a
//   phone; another project's session open from 900 up), open and folded, a name that fits the line draws whole on its
//   chevron's line and the meta wraps inside the toggle; a name longer than the line is cut only at its cap, still on
//   the chevron's line.
//
// Each case runs both skins and both Phosphor palettes, and also asserts no horizontal overflow and no page error.
// `test/account-row-fit.test.tsx` and `test/folded-card-floor.test.ts` keep the CSS and markup pins that produce this
// geometry; this file is where the geometry itself is held.
//
// Chrome comes from `resolveChrome()` in `beforeAll`, which THROWS when neither `CCRC_CHROME` nor
// `/usr/bin/google-chrome` is an executable file: a box without Chrome gives a red leg, never a skipped one.
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';

const SKINS = [REFINED, INSTRUMENT] as const;
/** The two Phosphor palettes, one per mode. */
const THEMES = [PHOSPHOR, 'light'] as const;
const WIDTHS = [360, 390, 1280, 1920] as const;
const VIEWS: AppView[] = SKINS.flatMap((skin) => THEMES.flatMap((theme) => WIDTHS.map((width) => ({ skin, theme, width }))));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

// ---- the fixture ---------------------------------------------------------------------------------------------------
// Neutral names only. The labels and the pool names are as long as real ones get (19 to 29 characters), because
// D-5570's overflow came from the widest row's one-line min-content: short fixture strings fit on any build.

const NOW = 1_792_362_479;
const LONG_PROJECT = 'project-c-with-a-name-longer-than-any-card-is-wide';
const POOL_HOME = 'pool-a-for-the-project';
const POOL_OTHER = 'pool-b-with-a-longer-name';
const ROSTER = [
  { id: 'lane-a', label: 'lane-a-with-a-long-label', hue: 'cyan', pool: POOL_HOME },
  { id: 'lane-b', label: 'lane-b-with-a-longer-label', hue: 'violet', pool: POOL_HOME },
  { id: 'lane-c', label: 'lane-c-with-a-long-label', hue: 'blue', pool: POOL_OTHER },
  { id: 'lane-d', label: 'lane-d-with-a-longest-label', hue: 'amber', pool: POOL_OTHER },
].map((r) => ({ ...r, homeAble: true, hidden: false }));

const usage = (wrapper: string, five: number, seven: number): object => ({
  wrapper, five, seven, ts: NOW, fiveResetAt: NOW + 7_800, sevenResetAt: NOW + 259_800,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false,
});

const STRANDED = { at: 1_760_000_000_000, reason: 'no-destination' };
const session = (project: string, ws: string, extra: object = {}): object => ({
  id: `${project}-${ws}`, wrapper: 'lane-a', home: 'lane-a', project, workdir: `/w/${project}/${ws}`, workspace: ws, name: ws,
  status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false, version: null, model: null, effort: null,
  ultracode: false, branch: `ws/${ws}`, ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null,
  archivedBytes: null, held: null, hookState: null, askSummary: null, subagents: null, background: null,
  withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket: 'idle', unmeasured: [], started: true,
  child: { kind: 'none' }, ...extra,
});
/** A card carrying all of its meta at once: the count, "2 stranded", the attention mark and, folded, "2 working". */
const LONG_META = (project: string): object[] => [
  session(project, 'one', { status: 'busy', bucket: 'working' }),
  session(project, 'two', { dialogPending: true, bucket: 'attention' }),
  session(project, 'three', { stranded: STRANDED }),
  session(project, 'four', { status: 'busy', bucket: 'working', stranded: STRANDED }),
  session(project, 'five'),
];
const SESSIONS = [...LONG_META('project-a'), ...LONG_META(LONG_PROJECT), session('project-b', 'one')];
/** The swap picker's session: project-a is tagged into lane-a's pool, so lane-b is its one eligible target (measured,
 *  so "suggested") and lane-c and lane-d are its crossing rows. */
const SWAP_SESSION = 'project-a-one';
/** Open from 900 up, so neither long-meta card holds the selection. */
const OTHER_SESSION = 'project-b-one';

const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': {
      accounts: [usage('lane-a', 40, 50), usage('lane-b', 20, 30), usage('lane-c', 60, 70), usage('lane-d', 10, 20)],
      projected: null, roster: ROSTER,
    },
    '/api/projects': {
      roots: ['/w'],
      projects: ['project-a', 'project-b', LONG_PROJECT].map((name) => ({ name, workdir: `/w/${name}` })),
    },
    '/api/runs': [],
    '/api/claims': [],
  },
  fleetFrames: [
    { type: 'fleet', sessions: SESSIONS },
    { type: 'pools', pools: { listed: true, enforcement: 'enforced', accountPools: 'enforced',
      byProject: { 'project-a': { state: 'tagged', name: POOL_HOME } } } },
  ],
};

// ---- the leg -------------------------------------------------------------------------------------------------------

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

/** Open the app at `route` in `view` and wait for the shell to stamp the skin and theme it was asked for. */
async function boot(view: AppView, route: string): Promise<{ page: Page; errors: string[]; close: () => Promise<void> }> {
  const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
  await page.goto(server!.origin + route);
  await page.waitForFunction(([skin, theme]) => {
    const root = document.documentElement;
    return root.getAttribute('data-skin') === skin && (root.getAttribute('data-theme') ?? 'phosphor') === theme;
  }, [view.skin, view.theme] as const, { timeout: 20_000 });
  return { page, errors, close: () => ctx.close() };
}

/** How far the page scrolls sideways: 0 when nothing overflows the viewport. */
const sideScroll = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// ---- D-5570 --------------------------------------------------------------------------------------------------------

interface RowFit {
  /** How many rows the open sheet's account lists draw. */
  readonly rows: number;
  readonly pools: number;
  readonly suggested: number;
  /** Per row: how far its right edge, and its keyboard ring's, run past the sheet body's right edge (<= 0 fits);
   *  how far the furthest item of its identity group (the name, the pill, the pool tag) runs past the group, into
   *  the gauges (<= 0 fits); whether the name chip draws all of its text; and whether the pool tag is cut although
   *  its text is no wider than the group (it should have dropped under the name instead). */
  readonly over: readonly {
    readonly label: string; readonly row: number; readonly ring: number; readonly ident: number;
    readonly nameWhole: boolean; readonly poolCutNeedlessly: boolean;
  }[];
}

/** Measure every row of every `.acct-list` in the topmost sheet body. The ring is measured, not assumed: each row is
 *  focused as a keyboard focus is (`focusVisible`), and its reach is its own computed outline width plus offset. */
function measureRows(page: Page): Promise<RowFit> {
  return page.evaluate(() => {
    const body = [...document.querySelectorAll<HTMLElement>('.sheet-body')].at(-1);
    if (body === undefined) throw new Error('no sheet body is open');
    const edge = body.getBoundingClientRect().right;
    const rows = [...body.querySelectorAll<HTMLElement>('.acct-list > button')];
    const over = rows.map((row) => {
      row.focus({ focusVisible: true } as FocusOptions);
      const cs = getComputedStyle(row);
      const reach = row.matches(':focus-visible') ? parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset) : NaN;
      const right = row.getBoundingClientRect().right;
      const group = row.querySelector<HTMLElement>('.acct-ident');
      const chip = row.querySelector<HTMLElement>('.chip');
      const pool = row.querySelector<HTMLElement>('.acct-pool');
      const items = group === null ? [] : [...group.children].map((k) => k.getBoundingClientRect().right);
      return {
        label: chip?.textContent ?? '',
        row: right - edge,
        ring: right + reach - edge,
        ident: group === null ? NaN : Math.max(...items) - group.getBoundingClientRect().right,
        nameWhole: chip !== null && chip.scrollWidth <= chip.clientWidth + 0.5,
        poolCutNeedlessly: pool !== null && group !== null
          && pool.scrollWidth > pool.clientWidth + 0.5 && pool.scrollWidth <= group.clientWidth,
      };
    });
    (document.activeElement as HTMLElement | null)?.blur();
    return {
      rows: rows.length,
      pools: body.querySelectorAll('.acct-list .acct-pool').length,
      suggested: body.querySelectorAll('.acct-list .acct-suggested').length,
      over,
    };
  });
}

/** Soft, so one red run reports every state and every row rather than the first. */
function expectFits(fit: RowFit, where: string): void {
  for (const r of fit.over) {
    expect.soft(r.row, `${where}: ${r.label}'s row runs past the sheet body`).toBeLessThanOrEqual(0.5);
    expect.soft(r.ring, `${where}: ${r.label}'s keyboard ring is cut by the sheet body (or was not drawn)`).toBeLessThanOrEqual(0.5);
    expect.soft(r.ident, `${where}: ${r.label}'s name or tags run out of their group into the gauges`).toBeLessThanOrEqual(0.5);
    expect.soft(r.nameWhole, `${where}: ${r.label}'s name is cut`).toBe(true);
    expect.soft(r.poolCutNeedlessly, `${where}: ${r.label}'s pool tag is cut beside the name instead of dropping under it`).toBe(false);
  }
}

describe('D-5570: an account picker row fits the sheet body, ring and all', () => {
  for (const view of VIEWS) {
    it(`the new-session sheet, and the swap picker's suggested and crossing rows (${named(view)})`, async () => {
      const { page, errors, close } = await boot(view, '/');
      try {
        await page.getByRole('button', { name: 'New session' }).first().click();
        await page.locator('.sheet-body .acct-list > button').nth(ROSTER.length - 1).waitFor();
        const fresh = await measureRows(page);
        expect(fresh.rows, 'the new-session sheet draws every account').toBe(ROSTER.length);
        expect(fresh.pools, 'every new-session row wears its pool tag').toBe(ROSTER.length);
        expectFits(fresh, 'new session');
        expect(await sideScroll(page)).toBe(0);

        await page.goto(`${server!.origin}/s/${SWAP_SESSION}`);
        await page.getByRole('button', { name: 'More' }).click();
        await page.getByRole('button', { name: 'Move to another account' }).click();
        await page.locator('.sheet-body .acct-suggested').waitFor();
        const plain = await measureRows(page);
        expect(plain, 'the swap picker offers the one eligible lane, suggested').toMatchObject({ rows: 1, suggested: 1, pools: 0 });
        expectFits(plain, 'swap, suggested');

        await page.getByRole('button', { name: /other pool/i }).click();
        await page.locator('.sheet-body .acct-pool').nth(1).waitFor();
        const crossing = await measureRows(page);
        expect(crossing, 'the crossing rows wear their pool tags').toMatchObject({ rows: 3, suggested: 1, pools: 2 });
        expectFits(crossing, 'swap, crossing');
        expect(await sideScroll(page)).toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await close();
      }
    });
  }
});

// ---- D-5576 --------------------------------------------------------------------------------------------------------

interface CardName {
  readonly holdsSelection: boolean;
  readonly expanded: string | null;
  /** The name's box, and the width its text needs. */
  readonly width: number;
  readonly textWidth: number;
  /** The cap D-5574 gives it: the toggle's content box less the chevron's 1em and the toggle's gap. */
  readonly cap: number;
  /** The name's box overlaps its chevron's line, and starts after the chevron. */
  readonly onChevronLine: boolean;
  /** How far the toggle's furthest item runs past the toggle (<= 0 fits). */
  readonly toggleOverrun: number;
  /** Some item of the toggle sits wholly below the name: the meta wrapped to a second line. */
  readonly wrapped: boolean;
}

function measureCard(page: Page, project: string): Promise<CardName> {
  return page.evaluate((name) => {
    const card = [...document.querySelectorAll<HTMLElement>('.proj-card')]
      .find((c) => c.querySelector('.proj-card-name')?.textContent === name);
    if (card === undefined) throw new Error(`no card for ${name}`);
    const toggle = card.querySelector<HTMLElement>('.proj-card-toggle')!;
    const label = card.querySelector<HTMLElement>('.proj-card-name')!;
    const chevron = card.querySelector<HTMLElement>('.proj-card-chevron')!;
    const t = toggle.getBoundingClientRect();
    const n = label.getBoundingClientRect();
    const c = chevron.getBoundingClientRect();
    const tcs = getComputedStyle(toggle);
    const content = toggle.clientWidth - parseFloat(tcs.paddingLeft) - parseFloat(tcs.paddingRight);
    const items = [...toggle.children].map((k) => k.getBoundingClientRect()).filter((r) => r.width > 0);
    return {
      holdsSelection: card.hasAttribute('data-holds-selection'),
      expanded: toggle.getAttribute('aria-expanded'),
      width: n.width,
      textWidth: label.scrollWidth,
      cap: content - parseFloat(tcs.fontSize) - parseFloat(tcs.columnGap),
      onChevronLine: n.top < c.bottom && n.bottom > c.top && n.left >= c.right - 0.5,
      toggleOverrun: Math.max(...items.map((r) => r.right)) - t.right,
      wrapped: items.some((r) => r.top >= n.bottom - 0.5),
    };
  }, project);
}

function expectWholeName(m: CardName, where: string): void {
  expect(m.holdsSelection, `${where}: the card must not hold the selection`).toBe(false);
  expect(m.textWidth, `${where}: the name is cut (${m.width.toFixed(1)}px of ${m.textWidth}px)`).toBeLessThanOrEqual(Math.ceil(m.width) + 0.5);
  expect(m.onChevronLine, `${where}: the name left its chevron's line`).toBe(true);
  expect(m.toggleOverrun, `${where}: the meta runs past the toggle`).toBeLessThanOrEqual(0.5);
  // The fixture is the hard case in every view: the meta does not fit beside the whole name, so it has wrapped.
  expect(m.wrapped, `${where}: the meta did not wrap, so this view never tested the floor`).toBe(true);
}

function expectCappedName(m: CardName, where: string): void {
  expect(m.holdsSelection, `${where}: the card must not hold the selection`).toBe(false);
  expect(m.textWidth, `${where}: the long name should need more than its line`).toBeGreaterThan(m.width);
  expect(m.width, `${where}: the long name is cut before its cap (${m.cap.toFixed(1)}px)`).toBeGreaterThanOrEqual(m.cap - 0.5);
  expect(m.onChevronLine, `${where}: the long name left its chevron's line`).toBe(true);
  expect(m.toggleOverrun, `${where}: the long name runs past the toggle`).toBeLessThanOrEqual(0.5);
  expect(m.wrapped, `${where}: the meta did not drop under the long name`).toBe(true);
}

describe('D-5576: every project card keeps its name, open and folded', () => {
  for (const view of VIEWS) {
    it(`a long meta wraps under a whole name; a long name is cut only at its cap (${named(view)})`, async () => {
      const route = view.width < 900 ? '/' : `/s/${OTHER_SESSION}`;
      const { page, errors, close } = await boot(view, route);
      try {
        for (const project of ['project-a', LONG_PROJECT]) {
          const card = page.locator('.proj-card', { has: page.locator('.proj-card-name', { hasText: project }) });
          const toggle = card.locator('.proj-card-toggle');
          await toggle.waitFor();
          const check = project === LONG_PROJECT ? expectCappedName : expectWholeName;
          const open = await measureCard(page, project);
          expect(open.expanded).toBe('true');
          check(open, `${project}, open`);
          await toggle.click();
          await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('false');
          const folded = await measureCard(page, project);
          check(folded, `${project}, folded`);
        }
        expect(await sideScroll(page)).toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await close();
      }
    });
  }
});
