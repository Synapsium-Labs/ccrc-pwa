// An item page whose text holds a long run with no spaces (desktop-polish Task C32, D-8585), measured in a real Chrome over the
// production build. The operator saw it on a live item on desktop: a How step that held a run of words joined by slashes and
// commas widened the card past its column, so the Why paragraph and every How step ran under the side panel and off the window's
// right edge. Cause (measured): `.wi-card` is a grid with one implicit `auto` column, so the min-content width of a child that
// cannot wrap (the How list carried no `overflow-wrap`) sets that column wider than the card, and every other child, the Why
// text with it, is laid out in that widened column.
//
// This file renders such an item at desktop widths in both skins and holds what the jsdom suites cannot: the item card stays in
// its column and left of the side panel, every element inside the card and inside the panel ends inside its own box, and the
// page never scrolls sideways. A second item, ticked and waiting on the coordinator, puts the panel's status line under the
// same long run. At a phone width the same page holds with no sideways scroll, so the one-column layout is unchanged.
//
// The long run is built here, about 400 characters of neutral words joined by slashes and commas; a second How step is one long
// outside address, so a link (`TextLink`) is measured too. The programme's title is a long run as well, for the band.
//
//   CCRC_CHROME=$HOME/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome ./node_modules/.bin/vitest run --config vitest.browser.config.ts --maxWorkers=2 browser/item-wrap.browser.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer } from './app';
import { withRunBinding } from '../test/runBindingFixture';

const NOW = Date.now();
const MIN = 60_000;

/** About 400 characters with no space: neutral words joined by slashes and commas, as a path-like list of ids runs together. */
const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'theta', 'iota', 'kappa', 'lambda'];
const RUN = Array.from({ length: 44 }, (_, i) => `${i === 0 ? '' : i % 2 === 0 ? ',' : '/'}${WORDS[i % WORDS.length]}${i}`).join('');
const ADDRESS = `https://example.com/${Array.from({ length: 36 }, (_, i) => `segment${i}`).join('/')}`;

const session = (id: string, role: string): object => ({
  id, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: `/w/project-a/${id}`,
  workspace: id, name: id, status: 'busy', statusUpdatedAt: NOW - MIN, limits: null, dialogPending: false, version: null,
  model: null, effort: null, ultracode: false, branch: `ws/${id}`, ctxPct: 40, paneCols: null, tasks: null, pr: null,
  archivedAt: null, archivedBytes: null, held: null, hookState: null, askSummary: null, subagents: null, background: null,
  withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket: 'working', bucketSince: NOW - 6 * MIN, unmeasured: [],
  started: true, child: { kind: 'none' }, role,
});
const RUNS = [{
  id: 100, program: 'prog-a', programTitle: `Programme ${RUN}`, wave: 2, waveOf: 5, project: 'project-a', homeProject: 'project-a',
  sessionId: 'prog-a-w1', workspace: 'prog-a-w1', branch: 'ws/prog-a-w1', state: 'working', kind: 'work', reviews: null,
  claimedBy: 'prog-a-coord', resumed: false, clearedAt: null, openedAt: NOW - 3_600_000, dispatchStartedAt: null,
  dispatchedAt: NOW - 3_000_000, closedAt: null, handoffCommit: null, items: { done: 0, total: 0 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: false,
    clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, reviewCap: null, hadChild: false,
}];
const SESSIONS = [session('prog-a-coord', 'coordinator'), session('prog-a-w1', 'child')];

const item = (id: number, over: object): object => ({
  id, program: 'prog-a', runId: null, kind: 'decide', title: `Check ${RUN}`, why: `The run reads ${RUN} and needs a ruling.`,
  how: [`Open ${RUN}.`, `Read ${ADDRESS} first.`, 'Set it to Live.'], options: [`Keep ${RUN}`, 'Hold it'], recommended: 0,
  recommendedWhy: `Because ${RUN} is the current set.`, neededBy: 'blocking', soonLabel: null, state: 'open', stale: false,
  raisedAt: NOW - 3 * 60 * MIN, tickedAt: null, closedAt: null, answer: null, note: null, secretSlot: null, secretSet: null,
  history: [{ at: NOW - 3 * 60 * MIN, act: 'raise', note: null }, { at: NOW - 2 * 60 * MIN, act: 'tick', note: null },
    { at: NOW - 60 * MIN, act: 'return', note: `Still reads ${RUN}.` }],
  ...over,
});
/** Item 1 is open (the decision's options, its reasons and the note field in the panel); item 2 waits on the coordinator (the
 *  panel's status line). */
const ITEMS = [item(1, {}), item(2, { kind: 'do', options: null, recommended: null, recommendedWhy: null, state: 'checking', tickedAt: NOW - 5 * MIN })];

const fixture = (): AppFixture => {
  const waiting = { items: ITEMS, cleared: [], goals: [] };
  return {
    api: {
      '/api/accounts': { accounts: [], projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false }] },
      '/api/runs': RUNS, '/api/claims': [], '/api/waiting': { ok: true, waiting },
    },
    fleetFrames: [
      { type: 'fleet', sessions: withRunBinding(SESSIONS as never[], RUNS as never[]) }, { type: 'runs', runs: RUNS },
      { type: 'waiting', waiting },
    ],
  };
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

async function open(skin: string, width: number, path: string) {
  const opened = await openApp(browser!, { skin, theme: 'light', width }, fixture());
  await opened.page.goto(server!.origin + path);
  await opened.page.waitForSelector('.wi-detail', { timeout: 20_000 });
  await opened.page.evaluate(async () => { await document.fonts.ready; });
  await opened.page.waitForTimeout(250); // the first paint's transitions settle
  return opened;
}

const sideways = (page: Page): Promise<number> => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

interface Geometry {
  /** The item card's right edge past its own grid column's (the detail grid's first track), in px; 0 or less is inside. */
  readonly cardPastColumn: number;
  /** The item card's right edge past the side panel's left edge, in px (desktop only, where they sit side by side). */
  readonly cardPastPanel: number | null;
  /** The band's right edge past the item root's. */
  readonly bandPast: number;
  /** Every element inside a card or the band whose box ends past that container's right edge, with how far. */
  readonly spills: readonly string[];
  /** A card or the band that scrolls sideways inside itself. */
  readonly scrolls: readonly string[];
}

/** The geometry this file holds, measured in the page. */
const geometry = (page: Page): Promise<Geometry> => page.evaluate(() => {
  const box = (el: Element): DOMRect => el.getBoundingClientRect();
  const root = document.querySelector('.shell-detail .wi')!;
  const detail = root.querySelector('.wi-detail')!;
  const [card, panel] = [...detail.children] as HTMLElement[];
  const band = root.querySelector('.wi-band') as HTMLElement;
  const columns = getComputedStyle(detail).gridTemplateColumns.split(' ').map(parseFloat);
  const firstEnd = box(detail).left + parseFloat(getComputedStyle(detail).paddingLeft) + columns[0]!;
  const sideBySide = columns.length > 1;
  const spills: string[] = [];
  const scrolls: string[] = [];
  for (const [name, c] of [['card', card!], ['panel', panel!], ['band', band]] as const) {
    const edge = box(c).right;
    if (c.scrollWidth > c.clientWidth + 0.5) scrolls.push(`${name}: scrollWidth ${c.scrollWidth} > clientWidth ${c.clientWidth}`);
    for (const el of c.querySelectorAll('*')) {
      const r = box(el);
      if (r.width === 0 && r.height === 0) continue;
      const past = r.right - edge;
      if (past > 0.5) spills.push(`${name} > ${el.tagName.toLowerCase()}.${[...el.classList].join('.')}: ${Math.round(past)}px past`);
    }
  }
  return {
    cardPastColumn: Math.round(box(card!).right - firstEnd),
    cardPastPanel: sideBySide ? Math.round(box(card!).right - box(panel!).left) : null,
    bandPast: Math.round(box(band).right - box(root).right),
    spills: spills.slice(0, 12),
    scrolls,
  };
});

describe.each([REFINED, INSTRUMENT] as const)('an item whose text holds a long run with no spaces, in %s', (skin) => {
  for (const width of [1280, 1920] as const) {
    for (const id of [1, 2] as const) {
      it(`at ${width}, item ${id}: the card, its text and the side panel stay inside their columns, with no sideways scroll`, async () => {
        const { ctx, page, errors } = await open(skin, width, `/waiting/${id}`);
        try {
          const shots = process.env['CCRC_SHOTS'];
          if (shots !== undefined && shots !== '') await page.screenshot({ path: `${shots}/item-wrap-${skin}-${width}-${id}.png`, fullPage: true });
          const g = await geometry(page);
          expect(g.cardPastColumn, `the card past its column ${JSON.stringify(g)}`).toBeLessThanOrEqual(0);
          expect(g.cardPastPanel, `the card past the panel's left edge ${JSON.stringify(g)}`).not.toBeNull();
          expect(g.cardPastPanel!, `the card past the panel's left edge ${JSON.stringify(g)}`).toBeLessThan(0);
          expect(g.bandPast, `the band past the item ${JSON.stringify(g)}`).toBeLessThanOrEqual(0);
          expect(g.spills, 'elements ending past their card').toEqual([]);
          expect(g.scrolls, 'a card scrolling sideways').toEqual([]);
          expect(await sideways(page), 'sideways scroll').toBe(0);
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      });
    }
  }

  // The card's column is its own (`minmax(0, 1fr)`), so even a child that cannot wrap at all, a probe placed in the card with
  // `white-space: nowrap`, overflows by itself and moves nothing else: the title, the Why text and the How steps still end
  // inside the card. On the implicit `auto` track the probe's min-content widened the column and took every sibling with it.
  it('at 1280: a child that cannot wrap at all does not widen the card\'s column for the rest of its text', async () => {
    const { ctx, page, errors } = await open(skin, 1280, '/waiting/1');
    try {
      const spilt = await page.evaluate((run) => {
        const card = document.querySelector('.shell-detail .wi-detail > .wi-card')!;
        const probe = document.createElement('p');
        probe.style.whiteSpace = 'nowrap';
        probe.style.margin = '0';
        probe.textContent = run;
        card.appendChild(probe);
        const edge = card.getBoundingClientRect().right;
        return [...card.querySelectorAll('.wi-what, .wi-text, .wi-steps, .wi-steps li, .wi-history')]
          .filter((el) => el.getBoundingClientRect().right - edge > 0.5)
          .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}: ${Math.round(el.getBoundingClientRect().right - edge)}px past`);
      }, RUN);
      expect(spilt, 'the card\'s text past its edge beside a child that cannot wrap').toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  });

  it('at 390, both items: one column, every element inside its card, no sideways scroll', async () => {
    for (const id of [1, 2] as const) {
      const { ctx, page, errors } = await open(skin, 390, `/waiting/${id}`);
      try {
        const g = await geometry(page);
        expect(g.cardPastPanel, 'one column on a phone').toBeNull();
        expect(g.cardPastColumn, `item ${id} ${JSON.stringify(g)}`).toBeLessThanOrEqual(0);
        expect(g.spills, `item ${id}`).toEqual([]);
        expect(g.scrolls, `item ${id}`).toEqual([]);
        expect(await sideways(page), `sideways scroll, item ${id}`).toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }
  });
});
