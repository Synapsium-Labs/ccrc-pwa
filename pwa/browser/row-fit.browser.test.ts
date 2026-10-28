// The row-fit measures, in a real Chrome over the production build (foundations follow-up F-e). Two follow-ups after
// the review polish (#661) held their geometry in Playwright scripts outside the repo, because there was no pwa
// browser leg on main until #627 landed; this file is those measures, ported.
//
// - D-5570: an account picker's row fits `.sheet-body`, and so does its keyboard ring, which must be drawn under
//   `:focus-visible`. Measured in the new-session sheet (every row wears its pool tag) and in the swap picker, both its
//   plain list (the measured lane wears "suggested") and its "show other pools" rows (each wears a pool tag), at 360,
//   390, 1280 and 1920. Inside each row the gauges and chevron stay in the row, the name and its tags stay in their
//   group, and a name wraps, or a tag is cut, only when it is wider than the whole group: otherwise the tag or the pill
//   drops under the name.
// - D-5576: every project card keeps its name. On a card that does not hold the selection (the fleet route on a
//   phone; another project's session open from 900 up), open and folded, a name that fits the line draws whole on its
//   chevron's line and the meta wraps inside the toggle; a name longer than the line is cut only at its cap, still on
//   the chevron's line.
//
// - D-6332: at the desk (900 and up) a session row draws its name, its branch and its programme whole, the name (paired
//   or plain) and the branch on at most two lines and never out of their box sideways, and a name or branch longer
//   than that is cut at its second line's end; below 900 a long name and a long programme keep their token-shortened
//   forms. Under a mouse one row's ⋯ is drawn at a time. Measured in the Refined cards, in Instrument's status mode
//   (its default) and in its project mode.
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
import { GROUP_MODE_KEY } from '../src/skins/instrument/FleetTable';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';

const SKINS = [REFINED, INSTRUMENT] as const;
/** The two Phosphor palettes, one per mode. */
const THEMES = [PHOSPHOR, 'light'] as const;
const WIDTHS = [360, 390, 1280, 1920] as const;
const VIEWS: AppView[] = SKINS.flatMap((skin) => THEMES.flatMap((theme) => WIDTHS.map((width) => ({ skin, theme, width }))));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

// ---- the fixture ---------------------------------------------------------------------------------------------------
// Neutral names only. Two kinds of row, because they fail differently. Long labels and pool names, as long as real
// ones get (22 to 25 characters): D-5570's overflow came from the widest row's one-line min-content, which short
// strings never reach, and a label wider than the group is the extreme case where the name wraps inside its pill
// (one has no hyphen to break at, so only `overflow-wrap: anywhere` keeps it there).
// Short ones: a name and a tag that each fit the group but not side by side, so the tag or the pill has to drop
// under the name rather than squeeze it or be cut.

const NOW = 1_792_362_479;
const LONG_PROJECT = 'project-c-with-a-name-longer-than-any-card-is-wide';
const POOL_HOME = 'pool-a-for-the-project';
const POOL_SHORT = 'pool-b';
const POOL_LONG = 'pool-c-with-a-longer-name';
const ROSTER = [
  { id: 'lane-a', label: 'lane-a-with-a-long-label', hue: 'cyan', pool: POOL_HOME },
  { id: 'lane-b', label: 'lane-b', hue: 'violet', pool: POOL_HOME },
  { id: 'lane-c', label: 'lane-c-label', hue: 'blue', pool: POOL_SHORT },
  // No hyphen to break at, and wider than the group at 360: only `overflow-wrap: anywhere` on `.acct-ident` keeps it
  // inside its pill (with `normal` it runs out of the chip and the group).
  { id: 'lane-d', label: 'laneDwithAnUnbrokenLabel', hue: 'amber', pool: POOL_LONG },
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
/** A card carrying all of its meta at once: the count, "2 stranded" and, folded, "3 working". No member asks the
 *  operator: a card holding an operator-facing question is held open (D-6088 rule 5), so the attention mark is never
 *  on a folded header, and the fleet-rollup render suite pins that card per skin. */
const LONG_META = (project: string): object[] => [
  session(project, 'one', { status: 'busy', bucket: 'working' }),
  session(project, 'two', { status: 'busy', bucket: 'working' }),
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

/** These cases measure the project cards, which Instrument draws in its project mode (D-5473): seed that mode before
 *  the first paint. Refined ignores the key. */
const openCards = async (view: AppView): ReturnType<typeof openApp> => {
  const opened = await openApp(browser!, view, FIXTURE);
  await opened.ctx.addInitScript((key) => {
    try { localStorage.setItem(key, 'project'); } catch { /* no storage: Instrument opens on status */ }
  }, GROUP_MODE_KEY);
  return opened;
};

/** Open the app at `route` in `view` and wait for the shell to stamp the skin and theme it was asked for. */
async function boot(view: AppView, route: string): Promise<{ page: Page; errors: string[]; close: () => Promise<void> }> {
  const { ctx, page, errors } = await openCards(view);
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
   *  how far its own furthest item (the group, the gauges, the chevron) runs past its content box; how far the furthest item of its identity group (the name, the pill, the pool tag) runs past the group, into
   *  the gauges (<= 0 fits); whether the name chip draws all of its text; whether the name breaks over lines
   *  although its one-line chip is no wider than the group; and whether the pool tag is cut although its text is no
   *  wider than the group. Either of the last two means the group squeezed its items where it should have wrapped
   *  them: the pill and the tag drop under the name. */
  readonly over: readonly {
    readonly label: string; readonly row: number; readonly ring: number; readonly ringDrawn: boolean;
    readonly content: number; readonly ident: number;
    readonly nameWhole: boolean; readonly nameWrapsNeedlessly: boolean; readonly poolCutNeedlessly: boolean;
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
    /** How many lines an element's text is laid out on: its text nodes' line boxes only, never the chip's dot. */
    const lines = (el: HTMLElement): number => {
      const tops = new Set<number>();
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let t = walk.nextNode(); t !== null; t = walk.nextNode()) {
        const range = document.createRange();
        range.selectNodeContents(t);
        for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top));
      }
      return tops.size;
    };
    /** The element's width with its text held on one line, measured and then put back. */
    const oneLineWidth = (el: HTMLElement): number => {
      const was = el.style.whiteSpace;
      el.style.whiteSpace = 'nowrap';
      const w = el.getBoundingClientRect().width;
      el.style.whiteSpace = was;
      return w;
    };
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
        ringDrawn: row.matches(':focus-visible') && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0,
        content: Math.max(...[...row.children].map((k) => k.getBoundingClientRect().right)) - (right - parseFloat(cs.paddingRight)),
        ident: group === null ? NaN : Math.max(...items) - group.getBoundingClientRect().right,
        nameWhole: chip !== null && chip.scrollWidth <= chip.clientWidth + 0.5,
        nameWrapsNeedlessly: chip !== null && group !== null && lines(chip) > 1 && oneLineWidth(chip) <= group.clientWidth,
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
    expect.soft(r.ring, `${where}: ${r.label}'s keyboard ring is cut by the sheet body`).toBeLessThanOrEqual(0.5);
    expect.soft(r.ringDrawn, `${where}: ${r.label}'s keyboard ring is not drawn under :focus-visible`).toBe(true);
    expect.soft(r.content, `${where}: ${r.label}'s gauges or chevron run out of the row`).toBeLessThanOrEqual(0.5);
    expect.soft(r.ident, `${where}: ${r.label}'s name or tags run out of their group into the gauges`).toBeLessThanOrEqual(0.5);
    expect.soft(r.nameWhole, `${where}: ${r.label}'s name is cut`).toBe(true);
    expect.soft(r.nameWrapsNeedlessly, `${where}: ${r.label}'s name breaks over lines beside a tag that could drop under it`).toBe(false);
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
  expect(m.width, `${where}: the long name runs past its cap (${m.cap.toFixed(1)}px)`).toBeLessThanOrEqual(m.cap + 0.5);
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

// ---- D-6332 --------------------------------------------------------------------------------------------------------
// One project card of rows whose names are 12, 30, 60 and 104 characters long, made of hyphenated tokens (so the name
// breaks where the card breaks it), a row with a short name and a very long branch, and a short row the desk opens.
// Every row is busy: a card of idle rows renders folded, with no rows at all.

const NAME_12 = 'north-to-sea';
const NAME_30 = 'quiet-river-gentle-bridge-lamp';
const NAME_60 = 'amber-field-narrow-garden-stone-silver-harbor-morning-cedars';
const NAME_104 = `${NAME_60}-${NAME_30}-${NAME_12}`;
/** 60 characters joined by underscores: `shortenByToken` splits at `_`, CSS does not, so the name has a short form (it is a
 *  `Fit` pair) and no break point of its own in the full form. */
const NAME_SNAKE = 'alpha_beta_gamma_delta_epsilon_zeta_theta_iota_kappa_lambdas';
/** Two names at or under the 28-character budget's reach that `shortenByToken` leaves whole, so each draws as ONE plain
 *  `.sess-label` (no `Fit` pair): 40 characters with no separator at all, and 26 joined by `_`, which CSS does not break
 *  at. Each is wider than the desk's narrowest track. */
const NAME_UNBROKEN = 'quietriverbridgelampgardenstoneharborsea';
const NAME_SNAKE_26 = 'alpha_beta_gamma_delta_eps';
const NAME_BRANCH_ROW = 'branch-row';
const NAME_SELECTED = 'short-select';
const BRANCH_120 = `ws/${'garden-stone-silver-harbor-morning/'.repeat(3)}quiet-rivers`;
const FIT_PROJECT = 'project-d';
/** Two rows held by two open runs, so their context cell is the programme and its wave (`ProgrammeWave`): slugs longer
 *  than `PROGRAMME_BUDGET` (16), so each draws a `Fit` pair, hyphen-joined so the full form wraps where CSS breaks it. */
const PROG_A = 'harbor-lights-desk-programme-for-rows';
const PROG_B = 'garden-stone-polish-of-the-fleet';
const PROG_A_SHORT = 'harbor-lights…';
const PROG_B_SHORT = 'garden-stone…';
const NAME_PROG_A = 'prog-row-a';
const NAME_PROG_B = 'prog-row-b';
/** Three needs-you rows (bucket `attention`) whose names are 30, 60 and 104 hyphen-joined characters, each with a short
 *  branch for its context cell: in Instrument's status mode the state word (`waiting`, and its marker) goes on that
 *  context line, never on a line of its own under a long name (R21's F2, the operator's R121). */
const NAME_N30 = 'needs-reply-gentle-bridge-lamp';
const NAME_N60 = 'needs-reply-narrow-garden-stone-silver-harbor-morning-cedars';
const NAME_N104 = `${NAME_N60}-quiet-river-gentle-bridge-lamp-north-to-sea`;

const fitRow = (slug: string, name: string, branch: string | null, extra: object = {}): object =>
  session(FIT_PROJECT, slug, { name, branch, status: 'busy', bucket: 'working', ...extra });
const fitRun = (id: number, program: string, slug: string): object => ({
  id, program, programTitle: program, wave: 1, waveOf: 2, project: FIT_PROJECT, homeProject: null,
  sessionId: `${FIT_PROJECT}-${slug}`, workspace: slug, branch: null, state: 'working', closedAt: null, kind: 'work',
  reviews: null,
});
const FIT_RUNS = [fitRun(501, PROG_A, 'rproga'), fitRun(502, PROG_B, 'rprogb')];
const FIT_SESSIONS = [
  fitRow('r12', NAME_12, null),
  fitRow('r30', NAME_30, null),
  fitRow('r60', NAME_60, null),
  fitRow('r104', NAME_104, null),
  fitRow('rsnake', NAME_SNAKE, null),
  fitRow('runbroken', NAME_UNBROKEN, null),
  fitRow('rsnake26', NAME_SNAKE_26, null),
  fitRow('rbranch', NAME_BRANCH_ROW, BRANCH_120),
  fitRow('rproga', NAME_PROG_A, null, { held: `program:${PROG_A} wave:1/2 run:501` }),
  fitRow('rprogb', NAME_PROG_B, null, { held: `program:${PROG_B} wave:1/2 run:502` }),
  fitRow('rn30', NAME_N30, 'ws/rn30', { bucket: 'attention', status: 'idle' }),
  fitRow('rn60', NAME_N60, 'ws/rn60', { bucket: 'attention', status: 'idle' }),
  fitRow('rn104', NAME_N104, 'ws/rn104', { bucket: 'attention', status: 'idle' }),
  fitRow('rsel', NAME_SELECTED, null),
];
const FIT_SELECTED = `${FIT_PROJECT}-rsel`;
const FIT_FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [usage('lane-a', 40, 50)], projected: null, roster: ROSTER },
    '/api/projects': { roots: ['/w'], projects: [{ name: FIT_PROJECT, workdir: `/w/${FIT_PROJECT}` }] },
    '/api/runs': FIT_RUNS,
    '/api/claims': [],
  },
  fleetFrames: [{ type: 'fleet', sessions: FIT_SESSIONS }, { type: 'runs', runs: FIT_RUNS }],
};

/** The three ways a row list is drawn: Refined's project cards, and Instrument's status mode (its default: the mode
 *  key is NOT seeded) and project mode. */
const FIT_MODES = [
  { skin: REFINED, mode: 'cards' },
  { skin: INSTRUMENT, mode: 'status' },
  { skin: INSTRUMENT, mode: 'project' },
] as const;
const FIT_THEMES = THEMES;
const fitViews = (widths: readonly number[]): { view: AppView; mode: string }[] =>
  FIT_MODES.flatMap(({ skin, mode }) => FIT_THEMES.flatMap((theme) => widths.map((width) => ({ view: { skin, theme, width }, mode }))));

async function bootFit(view: AppView, mode: string, route: string): Promise<{ page: Page; errors: string[]; close: () => Promise<void> }> {
  const { ctx, page, errors } = await openApp(browser!, view, FIT_FIXTURE);
  if (mode === 'project') {
    await ctx.addInitScript((key) => {
      try { localStorage.setItem(key, 'project'); } catch { /* no storage: Instrument opens on status */ }
    }, GROUP_MODE_KEY);
  }
  await page.goto(server!.origin + route);
  await page.waitForFunction(([skin, theme]) => {
    const root = document.documentElement;
    return root.getAttribute('data-skin') === skin && (root.getAttribute('data-theme') ?? 'phosphor') === theme;
  }, [view.skin, view.theme] as const, { timeout: 20_000 });
  await page.locator('.sess-line').first().waitFor();
  return { page, errors, close: () => ctx.close() };
}

/** The desk routes select `FIT_SELECTED`: exactly one row wears `.sess-line--active`, and it is that short row (a route
 *  that failed to resolve would leave the fixture's selected row a silent no-op). */
async function expectSelectedRow(page: Page): Promise<void> {
  const active = page.locator('.sess-line--active');
  expect(await active.count(), 'exactly one row is the selected row').toBe(1);
  expect(await active.locator('.sess-label').first().textContent(), 'and it is the selected short row').toBe(NAME_SELECTED);
}

interface FitBox {
  /** The name or the context cell drew a pair of forms (`Fit`), or only plain text. */
  readonly paired: boolean;
  readonly fullShown: boolean;
  readonly shortShown: boolean;
  /** The text of the form that is drawn. */
  readonly drawn: string;
  readonly height: number;
  readonly width: number;
  readonly lineHeight: number;
  readonly scrollHeight: number;
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly title: string | null;
  readonly openTitle: string | null;
}

/** Measure the name (`part: 'name'`) or the branch (`'branch'`) of the row whose name is `name`. */
function measureFit(page: Page, name: string, part: 'name' | 'branch'): Promise<FitBox> {
  return page.evaluate(([want, which]) => {
    const line = [...document.querySelectorAll<HTMLElement>('.sess-line')].find((l) => {
      const open = l.querySelector('.sess-open');
      return (open?.querySelector('.sr-only') ?? open?.querySelector('.sess-label'))?.textContent === want;
    });
    if (line === undefined) throw new Error(`no row named ${want}`);
    const open = line.querySelector<HTMLElement>('.sess-open')!;
    const box = which === 'name'
      ? (line.querySelector<HTMLElement>('.sess-label-fit') ?? line.querySelector<HTMLElement>('.sess-label')!)
      : line.querySelector<HTMLElement>('.sess-context[data-context="branch"]');
    if (box === null) throw new Error(`no ${which} on the row named ${want}`);
    const full = box.querySelector<HTMLElement>('.fit-full');
    const short = box.querySelector<HTMLElement>('.fit-short');
    const shown = (el: HTMLElement | null): boolean => el !== null && getComputedStyle(el).display !== 'none';
    const r = box.getBoundingClientRect();
    const cs = getComputedStyle(box);
    return {
      paired: full !== null && short !== null,
      fullShown: full === null ? true : shown(full),
      shortShown: shown(short),
      drawn: (shown(short) ? short : full ?? box)?.textContent ?? '',
      height: r.height,
      width: r.width,
      lineHeight: parseFloat(cs.lineHeight),
      scrollHeight: box.scrollHeight,
      scrollWidth: box.scrollWidth,
      clientWidth: box.clientWidth,
      clientHeight: box.clientHeight,
      title: box.getAttribute('title'),
      openTitle: open.getAttribute('title'),
    };
  }, [name, part] as const);
}

interface ProgrammeBox {
  readonly fullShown: boolean;
  readonly shortShown: boolean;
  /** The text of the programme form that is drawn, and the wave tail beside it. */
  readonly drawn: string;
  readonly wave: string;
  /** How far the programme's right edge runs past the `.sess-body` content box, in px (zero or less is inside). */
  readonly overhang: number;
}

/** Measure the programme cell (`ProgrammeWave`) of the row whose name is `name`. */
function measureProgramme(page: Page, name: string): Promise<ProgrammeBox> {
  return page.evaluate((want) => {
    const line = [...document.querySelectorAll<HTMLElement>('.sess-line')]
      .find((l) => l.querySelector('.sess-open .sess-label')?.textContent === want);
    if (line === undefined) throw new Error(`no row named ${want}`);
    const prog = line.querySelector<HTMLElement>('.sess-pw-prog');
    if (prog === null) throw new Error(`no programme on the row named ${want}`);
    const full = prog.querySelector<HTMLElement>('.fit-full');
    const short = prog.querySelector<HTMLElement>('.fit-short');
    const shown = (el: HTMLElement | null): boolean => el !== null && getComputedStyle(el).display !== 'none';
    const body = line.querySelector<HTMLElement>('.sess-body')!;
    const bs = getComputedStyle(body);
    const edge = body.getBoundingClientRect().right - parseFloat(bs.paddingRight);
    return {
      fullShown: shown(full),
      shortShown: shown(short),
      drawn: (shown(short) ? short : full)?.textContent ?? '',
      wave: line.querySelector('.sess-pw-wave')?.textContent ?? '',
      overhang: prog.getBoundingClientRect().right - edge,
    };
  }, name);
}

interface StatusRow {
  readonly height: number;
  /** Lines drawn by the name, and by the whole body (name, state word, context), counted as clusters of text centres. */
  readonly nameLines: number;
  readonly lines: number;
  /** The state cell's first line sits on the context's first line (centres within 6 px), and on the name's first. */
  readonly onContext: boolean;
  readonly besideName: boolean;
  readonly needsYou: boolean;
}

/** Measure an Instrument status row's lines, the way `instrument-desk.browser.test.ts` counts them: a line is a cluster
 *  of text boxes whose vertical centres lie within 6 px of each other (the name's 15 px and the state's 12 px share a
 *  line though their tops differ). */
function measureStatusRow(page: Page, name: string): Promise<StatusRow> {
  return page.evaluate((want) => {
    // A clamped name's lines past the clamp still have text boxes, under the drawn ones: only a centre inside the
    // element's own box counts.
    const centres = (els: Element[]): number[] => {
      const out: number[] = [];
      for (const el of els) {
        const own = el.getBoundingClientRect();
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n !== null; n = walk.nextNode()) {
          if ((n.textContent ?? '').trim() === '' || n.parentElement!.closest('.sr-only') !== null) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          for (const rc of range.getClientRects()) {
            const c = rc.top + rc.height / 2;
            if (rc.width > 0 && rc.height > 0 && c >= own.top && c <= own.bottom) out.push(c);
          }
        }
      }
      return out.sort((a, b) => a - b);
    };
    const lineCount = (cs: number[]): number => {
      let n = 0;
      let last = -Infinity;
      for (const c of cs) if (c - last > 6) { n += 1; last = c; }
      return n;
    };
    const line = [...document.querySelectorAll<HTMLElement>('.sess-line')].find((l) => {
      const open = l.querySelector('.sess-open');
      return (open?.querySelector('.sr-only') ?? open?.querySelector('.sess-label'))?.textContent === want;
    });
    if (line === undefined) throw new Error(`no row named ${want}`);
    const body = line.querySelector('.sess-body')!;
    const labels = [...line.querySelectorAll('.sess-open .sess-label')].filter((l) => l.getBoundingClientRect().width > 0);
    const state = line.querySelector('.sess-meta:not(.sess-meta--context)');
    const context = line.querySelector('.sess-meta--context');
    const nameC = centres(labels);
    const stateC = centres(state === null ? [] : [state]);
    const contextC = centres(context === null ? [] : [context]);
    const near = (a: number | undefined, b: number | undefined): boolean => a !== undefined && b !== undefined && Math.abs(a - b) <= 6;
    return {
      height: (line.closest('li') ?? line).getBoundingClientRect().height,
      nameLines: lineCount(nameC), lines: lineCount(centres([...body.children])),
      onContext: near(stateC[0], contextC[0]), besideName: near(stateC[0], nameC[0]),
      needsYou: (state?.textContent ?? '').includes('needs you'),
    };
  }, name);
}

/** The name of the row that holds the focus, or null when the focus is in no row. */
function focusedRow(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const line = document.activeElement?.closest('.sess-line');
    if (line === null || line === undefined) return null;
    const open = line.querySelector('.sess-open');
    return (open?.querySelector('.sr-only') ?? open?.querySelector('.sess-label'))?.textContent ?? null;
  });
}

/** The names of the rows whose ⋯ is drawn (computed opacity 1), in list order. */
function litActions(page: Page): Promise<string[]> {
  return page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.sess-line')].flatMap((l) => {
    const actions = l.querySelector<HTMLElement>('.sess-actions');
    if (actions === null || getComputedStyle(actions).opacity !== '1') return [];
    const open = l.querySelector('.sess-open');
    return [(open?.querySelector('.sr-only') ?? open?.querySelector('.sess-label'))?.textContent ?? ''];
  }));
}

describe('D-6332: a session row shows its name whole where it has room', () => {
  it('the fixture names are exactly 12, 30, 60, 104 and 60 (underscored) characters, and the branch is 120', () => {
    expect([NAME_12, NAME_30, NAME_60, NAME_104, NAME_SNAKE, BRANCH_120].map((n) => n.length)).toEqual([12, 30, 60, 104, 60, 120]);
    expect([NAME_UNBROKEN, NAME_SNAKE_26].map((n) => n.length)).toEqual([40, 26]);
    expect([NAME_N30, NAME_N60, NAME_N104].map((n) => n.length)).toEqual([30, 60, 104]);
  });

  for (const { view, mode } of fitViews([1280, 1920])) {
    it(`at 1280 and 1920, a 30-character name renders whole in both skins (${named(view)}, ${mode})`, async () => {
      const { page, errors, close } = await bootFit(view, mode, `/s/${FIT_SELECTED}`);
      try {
        await expectSelectedRow(page);
        const twelve = await measureFit(page, NAME_12, 'name');
        expect(twelve.paired, 'a 12-character name has no shortened form').toBe(false);
        const m = await measureFit(page, NAME_30, 'name');
        expect(m.paired, 'the 30-character name draws both forms').toBe(true);
        expect(m.fullShown, 'the full form is drawn').toBe(true);
        expect(m.shortShown, 'the shortened form is not').toBe(false);
        expect(m.drawn).toBe(NAME_30);
        expect(m.scrollHeight, 'nothing of the name is clipped').toBeLessThanOrEqual(m.clientHeight + 0.5);
        expect(m.height, 'at most two lines').toBeLessThanOrEqual(2 * twelve.height + 1);
        expect(await sideScroll(page)).toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await close();
      }
    });

    it(`a name longer than the track is shortened to fill it (${named(view)}, ${mode})`, async () => {
      const { page, errors, close } = await bootFit(view, mode, `/s/${FIT_SELECTED}`);
      try {
        await expectSelectedRow(page);
        const one = await measureFit(page, NAME_12, 'name');
        for (const name of [NAME_60, NAME_104]) {
          const m = await measureFit(page, name, 'name');
          const where = `the ${name.length}-character name`;
          expect(m.fullShown && !m.shortShown, `${where} draws its full form`).toBe(true);
          expect(m.height, `${where} is exactly two lines tall`).toBeGreaterThanOrEqual(2 * one.height - 1);
          expect(m.height, `${where} is no taller than two lines`).toBeLessThanOrEqual(2 * one.height + 1);
          if (name === NAME_104) expect(m.scrollHeight, `${where} is cut where its second line ends`).toBeGreaterThan(m.clientHeight);
          expect(m.scrollWidth, `${where} stays inside its box sideways (${m.scrollWidth} of ${m.clientWidth}px)`).toBeLessThanOrEqual(m.clientWidth + 1);
          expect(m.openTitle, `${where} keeps its full text in the row button's title`).toBe(name);
        }
        const branch = await measureFit(page, NAME_BRANCH_ROW, 'branch');
        expect(branch.fullShown && !branch.shortShown, 'a long branch draws its full form').toBe(true);
        expect(branch.height, 'a long branch is exactly two lines tall').toBeGreaterThanOrEqual(2 * branch.lineHeight - 1);
        expect(branch.height, 'a long branch is no taller than two lines').toBeLessThanOrEqual(2 * branch.lineHeight + 1);
        expect(branch.scrollHeight, 'a long branch is cut where its second line ends').toBeGreaterThan(branch.clientHeight);
        expect(branch.title, 'a long branch keeps its full text in title').toBe(BRANCH_120);
        expect(await sideScroll(page)).toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await close();
      }
    });
  }

  for (const { view, mode } of fitViews([1280, 1920])) {
    it(`a name with no break point wraps inside the track instead of running out of it (${named(view)}, ${mode})`, async () => {
      const { page, errors, close } = await bootFit(view, mode, `/s/${FIT_SELECTED}`);
      try {
        await expectSelectedRow(page);
        const one = await measureFit(page, NAME_12, 'name');
        const m = await measureFit(page, NAME_SNAKE, 'name');
        expect(m.fullShown && !m.shortShown, 'the underscored name draws its full form').toBe(true);
        expect(m.scrollWidth, `no sideways overflow (${m.scrollWidth} of ${m.clientWidth}px)`).toBeLessThanOrEqual(m.clientWidth + 1);
        expect(m.height, 'at most two lines tall').toBeLessThanOrEqual(2 * one.height + 1);
        expect(m.openTitle, 'its full text stays in the row button title').toBe(NAME_SNAKE);
        expect(await sideScroll(page)).toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await close();
      }
    });
  }

  for (const { view, mode } of fitViews([1280, 1920]).filter((v) => v.mode === 'status')) {
    it(`a needs-you row keeps its state word on the context line, however long its name (${named(view)}, ${mode})`, async () => {
      const { page, errors, close } = await bootFit(view, mode, `/s/${FIT_SELECTED}`);
      try {
        await expectSelectedRow(page);
        for (const name of [NAME_N30, NAME_N60, NAME_N104]) {
          const r = await measureStatusRow(page, name);
          const where = `the ${name.length}-character needs-you row (${r.height}px, ${r.nameLines} name lines)`;
          expect(r.needsYou, `${where} reads needs you`).toBe(true);
          expect(r.onContext, `${where}: the state word is on the context line`).toBe(true);
          expect(r.besideName, `${where}: the state word is not beside the name`).toBe(false);
          // The name's lines and the context's one: the state word takes no line of its own.
          expect(r.lines, `${where}: lines`).toBe(r.nameLines + 1);
        }
        expect(await sideScroll(page)).toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await close();
      }
    });
  }

  for (const { view, mode } of fitViews([1280])) {
    it(`a plain name with no break point wraps inside its box on at most two lines (${named(view)}, ${mode})`, async () => {
      const { page, errors, close } = await bootFit(view, mode, `/s/${FIT_SELECTED}`);
      try {
        await expectSelectedRow(page);
        const one = await measureFit(page, NAME_12, 'name');
        for (const name of [NAME_UNBROKEN, NAME_SNAKE_26]) {
          const m = await measureFit(page, name, 'name');
          const where = `the ${name.length}-character plain name`;
          expect(m.paired, `${where} has no shortened form`).toBe(false);
          expect(m.drawn).toBe(name);
          expect(m.scrollWidth, `${where} stays inside its box sideways (${m.scrollWidth} of ${m.clientWidth}px)`).toBeLessThanOrEqual(m.clientWidth + 1);
          expect(m.height, `${where} is at most two lines tall`).toBeLessThanOrEqual(2 * one.height + 1);
        }
        expect(await sideScroll(page)).toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await close();
      }
    });
  }

  for (const { view, mode } of fitViews([1280, 1920])) {
    it(`the programme slug renders whole at the desk (${named(view)}, ${mode})`, async () => {
      const { page, errors, close } = await bootFit(view, mode, `/s/${FIT_SELECTED}`);
      try {
        await expectSelectedRow(page);
        for (const [name, prog] of [[NAME_PROG_A, PROG_A], [NAME_PROG_B, PROG_B]] as const) {
          const m = await measureProgramme(page, name);
          expect(m.fullShown && !m.shortShown, `the programme of ${name} draws its full form`).toBe(true);
          expect(m.drawn).toBe(prog);
          expect(m.wave, 'its wave tail is whole').toBe(' · wave 1 of 2');
          expect(m.overhang, `the programme of ${name} stays inside the row's body (${m.overhang}px past it)`).toBeLessThanOrEqual(1);
        }
        expect(await sideScroll(page)).toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await close();
      }
    });

    it(`under a mouse one row shows its ⋯ at a time (${named(view)}, ${mode})`, async () => {
      const { page, errors, close } = await bootFit(view, mode, `/s/${FIT_SELECTED}`);
      try {
        await expectSelectedRow(page);
        // At rest, away from the list, the selected row alone shows its ⋯.
        await page.mouse.move(view.width - 4, 896);
        expect(await litActions(page), 'at rest only the selected row shows ⋯').toEqual([NAME_SELECTED]);
        // A hovered row shows its own, and the selected row's goes dark while it is hovered: never two.
        await page.locator('.sess-line').filter({ has: page.locator(`.sess-label[aria-label="${NAME_12}"]`) }).hover();
        expect(await litActions(page), 'hovering another row shows that row\'s ⋯ and no other').toEqual([NAME_12]);
        expect(errors).toEqual([]);
      } finally {
        await close();
      }
    });

    it(`a ⋯ given focus back by a sheet closed with the mouse lights no second ⋯ at rest (${named(view)}, ${mode})`, async () => {
      const { page, errors, close } = await bootFit(view, mode, `/s/${FIT_SELECTED}`);
      try {
        await expectSelectedRow(page);
        // Open another row's actions sheet with the mouse and close it on its scrim: the sheet gives the focus back to
        // that row's ⋯, by script after a pointer, so it is not `:focus-visible`.
        const row = page.locator('.sess-line').filter({ has: page.locator(`.sess-label[aria-label="${NAME_12}"]`) });
        await row.locator('.sess-actions').click();
        await page.locator('.sheet-scrim').waitFor();
        await page.locator('.sheet-scrim').click({ position: { x: 4, y: 4 } });
        await page.locator('.sheet-scrim').waitFor({ state: 'detached' });
        expect(await focusedRow(page), 'the closed sheet gave the focus back to that row').toBe(NAME_12);
        await page.mouse.move(view.width - 4, 896);
        expect(await litActions(page), 'at rest only the selected row shows ⋯').toEqual([NAME_SELECTED]);
        // A keyboard's focus keeps the reveal: the row the next Tab lands in draws its ⋯.
        await page.keyboard.press('Tab');
        const keyed = await focusedRow(page);
        expect(keyed, 'the Tab landed in a row').not.toBeNull();
        expect(await litActions(page), 'the keyboard-focused row shows its ⋯').toContain(keyed);
        expect(errors).toEqual([]);
      } finally {
        await close();
      }
    });
  }

  for (const { view, mode } of fitViews([360, 390])) {
    it(`on a phone a 30-character name keeps its token-shortened form (${named(view)}, ${mode})`, async () => {
      const { page, errors, close } = await bootFit(view, mode, '/');
      try {
        const m = await measureFit(page, NAME_30, 'name');
        expect(m.paired).toBe(true);
        expect(m.shortShown, 'the shortened form is drawn').toBe(true);
        expect(m.fullShown, 'the full form is not').toBe(false);
        expect(m.drawn).toBe('quiet-river-gentle-bridge…');
        for (const [name, short] of [[NAME_PROG_A, PROG_A_SHORT], [NAME_PROG_B, PROG_B_SHORT]] as const) {
          const p = await measureProgramme(page, name);
          expect(p.shortShown && !p.fullShown, `the programme of ${name} keeps its token-shortened form`).toBe(true);
          expect(p.drawn).toBe(short);
        }
        expect(await sideScroll(page)).toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await close();
      }
    });
  }
});
