// The programme page with its Work card (programme work map WM4, D-8823; plan Task WM4's width table; spec 2026-11-16 §5), in a
// real Chrome over the production build, at 360, 390, 1280, 1470 and 1920, in both skins and both themes. `test/programme-screen.test.tsx`
// holds the page's behaviour in jsdom (what it reads, keeps and links); this file holds what only an engine can say:
//   * the order: at 360 and 390 one column, Goals, Work, Waiting on you, Runs; from 1280 two columns, Goals then Work on the
//     left and Waiting on you then Runs on the right, Waiting on you level with the top of Goals;
//   * the card's own layout follows ITS width, not the viewport's (D-8806 `layout-by-the-cards-width`): a row is one column at
//     360 and 390 and three (status, title with its tag, facts) from 1280, measured as the row's computed grid tracks;
//   * nothing scrolls sideways, and nothing is clipped or cut short: no phase title, ticket title or epic tag wider than its box,
//     no ellipsis, with a title of 130 unbroken characters and a long epic and phase title that have to wrap, the folded groups
//     opened as well as closed.
//
// The app answers from a fixture (`browser/app.ts`): no server, no ccd. Neutral names only: the repository is public.
//   CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts --maxWorkers=2 browser/programme-work-page.browser.test.ts
// `CCRC_SHOTS=<a directory>` keeps one picture per view.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { WORK_GROUPS, type WorkGroup, type WorkMapView } from '../../shared/plan';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';
import { itemView, waitingView } from '../test/ledgersFixture';

const THEMES = [PHOSPHOR, 'light'];
const SKINS = [REFINED, INSTRUMENT];
// 800 is the one sampled width between 690 and 900: the page is one column there and the card as wide as the page, so the card's 40rem step
// applies, which no wider window reaches the left column of (review 2922 A7).
const WIDTHS = [360, 390, 800, 1280, 1470, 1920];
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

const NOW = Date.now();
const DAY = 86_400_000;
const LONG = 'a-deliberately-long-title-without-a-break-that-has-to-wrap-on-a-phone-screen-and-in-a-narrow-column-and-keeps-going-on-and-on-to-130';
const ZERO = Object.fromEntries(WORK_GROUPS.map((g) => [g, 0])) as Record<WorkGroup, number>;
const EPIC_A = { key: 'epic-a', title: `Epic A ${LONG}` };
const EPIC_B = { key: 'epic-b', title: 'Epic B, the guide' };

type Status = WorkMapView['items'][number]['status'];
const ticket = (key: string, title: string, status: Status, group: WorkGroup, over: Record<string, unknown> = {}): WorkMapView['items'][number] => ({
  key, title, status, group, reason: null, epic: EPIC_A, phases: [], runId: null, wave: null, doneAt: null, itemIds: [], lastFailedRunId: null, ...over,
}) as never;

const ITEMS = [
  ticket('t-1', 'Done in the first phase', 'done', 'done', { doneAt: NOW - 9 * DAY, phases: [{ key: 'p1', number: 1, carriedTo: null, carriedFrom: [] }] }),
  ticket('t-2', `Running ${LONG}`, 'working', 'in-progress', { runId: 12, lastMoveAt: NOW - 3 * 60_000, phases: [{ key: 'p2', number: 2, carriedTo: null, carriedFrom: [] }] }),
  ticket('t-3', 'Carried to the third phase', 'not-started', 'not-started', { epic: EPIC_B, phases: [
    { key: 'p2', number: 2, carriedTo: { key: 'p3', number: 3 }, carriedFrom: [] }, { key: 'p3', number: 3, carriedTo: null, carriedFrom: [{ key: 'p2', number: 2 }] }] }),
  ticket('t-4', 'Needs the operator', 'waiting-on-you', 'waiting-on-you', { epic: EPIC_B, itemIds: [7], phases: [{ key: 'p3', number: 3, carriedTo: null, carriedFrom: [] }] }),
  ticket('t-5', 'Stuck on a review', 'stuck', 'held', { runId: 13, phases: [{ key: 'p3', number: 3, carriedTo: null, carriedFrom: [] }] }),
];
const WORK: WorkMapView = {
  source: 'plan', end: null, verdicts: 'read', counts: { ...ZERO, done: 1, 'in-progress': 1, 'waiting-on-you': 1, held: 1, 'not-started': 1 }, items: ITEMS,
  phases: [
    { key: 'p1', number: 1, title: 'Foundations', summary: '', finish: { at: NOW - 9 * DAY }, counts: { ...ZERO, done: 1 }, carried: 0, carriedOut: [], wholeEpics: [], items: ['t-1'] },
    { key: 'p2', number: 2, title: `The build, ${LONG}`, summary: 'The second phase builds the card and mounts it on the page.', finish: null, counts: { ...ZERO, 'in-progress': 1 },
      carried: 1, carriedOut: ['t-3'], wholeEpics: [], items: ['t-2', 't-3'] },
    { key: 'p3', number: 3, title: 'The guide', summary: '', finish: null, counts: { ...ZERO, 'waiting-on-you': 1, held: 1, 'not-started': 1 }, carried: 0, carriedOut: [],
      wholeEpics: ['epic-b'], items: ['t-3', 't-4', 't-5'] },
  ],
  notInPhase: [],
  epics: [
    { ...EPIC_A, done: 1, total: 2, url: null, dropped: false, checkpointsMet: 1, checkpointsTotal: 2, items: ['t-1', 't-2'], checkpoints: [
      { key: 'c-1', title: `Checkpoint ${LONG}`, kind: 'acceptance', state: 'met', metAt: NOW - 8 * DAY, evidence: { pr: 88 }, url: null },
      { key: 'c-2', title: 'Operator switches it on', kind: 'operator-act', state: 'open', metAt: null, evidence: null, url: null }] },
    { ...EPIC_B, done: 0, total: 3, url: null, dropped: false, checkpointsMet: 0, checkpointsTotal: 0, items: ['t-3', 't-4', 't-5'], checkpoints: [] },
  ],
  initiatives: [], doneWhen: [{ text: 'The card shows the plan', proved: true }, { text: 'Plans are declared', proved: false }], beforePlan: null, runs: null,
};

const RUNS = [{
  id: 12, program: 'prog-a', programTitle: 'Programme A', wave: 2, waveOf: 5, project: 'project-a', homeProject: 'project-a', sessionId: 'project-a-w12',
  workspace: 'ws-12', branch: 'ws/12', state: 'working', kind: 'work', reviews: null, claimedBy: 'project-a-coord', resumed: false, clearedAt: null,
  openedAt: NOW - 3_600_000, dispatchStartedAt: null, dispatchedAt: NOW - 3_000_000, closedAt: null, handoffCommit: null, items: { done: 1, total: 4 },
  unreadMail: 0, health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: false, clearError: null,
    coordKickoffPendingSince: null }, childReclaim: null, reviewCap: null, hadChild: false,
}];
const GOALS = {
  program: 'prog-a', specPath: null, inShort: 'A console view of what the programme is building, in a sentence that is long enough to wrap on a phone.',
  inShortAt: NOW - 3 * DAY, modifications: [],
};
const FIXTURE: AppFixture = {
  api: {
    '/api/programmes/prog-a/plan': { ok: true, plan: { program: 'prog-a', planned: true, initiatives: [], epics: [], doneWhen: [] }, work: WORK },
    '/api/programmes/prog-a/goals': { ok: true, goals: GOALS },
    '/api/programmes/prog-a/secrets': { ok: true, program: 'prog-a', slots: [] },
    '/api/projects': { roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a' }] },
    '/api/runs': { runs: RUNS, nextBefore: null }, '/api/claims': [],
    '/api/programmes': {
      ok: true, closedToday: { operator: 0, sweep: 0, coordinator: 0 },
      programmes: [{ slug: 'prog-a', title: 'Programme A', currentWave: 2, waveOf: 5, claimedBy: 'project-a-coord', coordinatorGone: false,
        waves: { working: 1, waiting: 0, queued: 0, done: 1, failed: 0 }, lastMoveAt: NOW - 2 * 3_600_000, ending: null }],
    },
    '/api/runs/find': { ok: true, exact: null, runs: [], reviewsOf: [], next: null },
    '/api/accounts': { accounts: [], projected: null, roster: [] },
    '/api/feed': { events: [] },
  },
  fleetFrames: [
    { type: 'fleet', sessions: [] }, { type: 'runs', runs: RUNS }, { type: 'coord', coord: { pause: 'clear' } },
    { type: 'waiting', waiting: waitingView({ items: [itemView({ id: 7, program: 'prog-a' })] }) },
  ],
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

interface Box { left: number; right: number; top: number; bottom: number; width: number }
interface Measured {
  viewport: number; pageScrollWidth: number; pageClientWidth: number;
  root: { scrollWidth: number; clientWidth: number; box: Box };
  goals: Box; work: Box; waiting: Box; runs: Box;
  /** The card's own width, inside its box: what the layout rows switch on. */
  cardWidth: number;
  /** The first ticket row's computed grid tracks, in px: one on a phone, two (status | title, the facts under the title) from a 26rem card,
   *  three (status | title | facts) from a 40rem card. */
  tracks: number[];
  rem: number;
  /** The width of the plain ticket's `.wk-what` (its title with its tag): the room a title has (review 2922 F2). */
  titleTrack: number;
  /** The head's programme icon and its title (the amendment of fix round 1): the icon stands on the title's line, as tall as its text. */
  head: { ico: Box; title: Box; lineHeight: number; fontSize: number; kicker: boolean };
  /** Each epic tag's height in lines: more than one means it broke. */
  tagLines: number[];
  headings: { phases: number; finishedInsideSummary: boolean };
  ellipsis: string[];
  clipped: string[];
  /** Every phase title, ticket title and epic tag: is it inside the card and as wide as its text needs? */
  titles: { cls: string; overflows: boolean; outside: boolean }[];
}

/** The page's geometry, measured in the page, with every folded group opened so a title inside one is measured too. */
const measure = (root: Element): Measured => {
  for (const d of root.querySelectorAll('details')) (d as HTMLDetailsElement).open = true;
  const box = (e: Element): Box => {
    const r = e.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
  };
  const one = (sel: string): Element => {
    const found = root.querySelector(sel);
    if (found === null) throw new Error(`no ${sel}`);
    return found;
  };
  const card = one('.wk-card');
  const cardBox = box(card);
  const row = one('.wk-row');
  return {
    viewport: window.innerWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
    pageClientWidth: document.documentElement.clientWidth,
    root: { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, box: box(root) },
    goals: box(one('.pv-main > .pv-card')), work: box(card.closest('.pv-card')!), cardWidth: cardBox.width, waiting: box(one('section[aria-label="Waiting on you"]')), runs: box(one('[data-testid="programme-runs"]')),
    tracks: getComputedStyle(row).gridTemplateColumns.split(' ').map(parseFloat),
    rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
    titleTrack: box(one('.wk-row[data-ticket="t-4"] .wk-what')).width,
    head: {
      ico: box(one('.pv-head .pv-ico')), title: box(one('.pv-head .pv-title')), lineHeight: parseFloat(getComputedStyle(one('.pv-head .pv-title')).lineHeight),
      fontSize: parseFloat(getComputedStyle(one('.pv-head .pv-title')).fontSize), kicker: root.querySelector('.pv-kicker') !== null,
    },
    tagLines: [...card.querySelectorAll('.wk-epic')].map((e) => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight))),
    headings: { phases: card.querySelectorAll('h3.wk-phase-head').length, finishedInsideSummary: card.querySelector('details.wk-phase > summary > h3.wk-phase-head') !== null },
    ellipsis: [...root.querySelectorAll('*')].filter((e) => getComputedStyle(e).textOverflow === 'ellipsis').map((e) => e.tagName.toLowerCase()),
    clipped: [...root.querySelectorAll('*')]
      .filter((e) => e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0 && getComputedStyle(e).display !== 'inline')
      .map((e) => e.tagName.toLowerCase() + '.' + (e.getAttribute('class') ?? '')),
    titles: [...card.querySelectorAll('.wk-phase-title, .wk-ticket-title, .wk-epic, .wk-chip-title')].map((e) => ({
      cls: e.getAttribute('class') ?? '',
      overflows: e.scrollWidth > e.clientWidth + 1,
      outside: box(e).right > cardBox.right + 0.5 || box(e).left < cardBox.left - 0.5,
    })),
  };
};

const open = async (view: AppView) => {
  const app = await openApp(browser!, view, FIXTURE);
  await app.page.goto(server!.origin + '/programmes/prog-a');
  const root = app.page.locator('.pv[data-program="prog-a"]');
  await root.locator('.wk-card .wk-row[data-ticket="t-2"]').waitFor({ timeout: 30_000 });
  await root.locator('[data-testid="programme-runs"]').waitFor({ timeout: 30_000 });
  return { ...app, root };
};

/** The card's row layout by the card's own width, as the stylesheet's two container steps say it (`card-width-steps`): one track below 26rem, two
 *  from 26rem (status | title, the facts under it), three from 40rem (status | title | facts); the status track is 6.75rem and then 7.5rem. */
const assertRowLayout = (m: Measured, at: string, width: number): void => {
  const want: readonly [number | null, number] = m.cardWidth >= 40 * m.rem ? [7.5, 3] : m.cardWidth >= 26 * m.rem ? [6.75, 2] : [null, 1];
  expect(m.tracks.length, `${at}: a ${Math.round(m.cardWidth)}px card draws ${m.tracks.length} row tracks, not ${want[1]}`).toBe(want[1]);
  if (want[0] !== null) expect(m.tracks[0], `${at}: the status track`).toBeCloseTo(want[0] * m.rem, 0);
  // From 800 up a row is never stacked in one column; the 800 case is the one that reaches the second step on a window under 900.
  if (width >= 800) expect(m.tracks.length, `${at}: a row is stacked on a wide window`).toBeGreaterThanOrEqual(2);
};

let phoneTrack: Promise<number> | undefined;
/** The title room at 360, Refined light: the floor every wider window has to keep. Measured once. */
const phoneTitleTrack = (): Promise<number> => {
  phoneTrack ??= (async () => {
    const { ctx, root } = await open({ skin: REFINED, theme: 'light', width: 360 });
    try { return (await root.evaluate(measure)).titleTrack; } finally { await ctx.close(); }
  })();
  return phoneTrack;
};

describe('the programme page with its Work card, per width, skin and theme (WM4)', () => {
  for (const width of WIDTHS) {
    it(`the width table holds at ${width}px, in both skins and both themes`, async () => {
      for (const skin of SKINS) {
        for (const theme of THEMES) {
          const view: AppView = { skin, theme, width };
          const at = named(view);
          const { ctx, page, errors, root } = await open(view);
          try {
            const shots = process.env.CCRC_SHOTS;
            if (shots) {
              // As the operator sees it first: folded groups closed. The shell scrolls inside its own pane, so the picture is taken
              // from a window tall enough to hold the page whole.
              await page.setViewportSize({ width, height: 2600 });
              await root.screenshot({ path: path.join(shots, `programme-${skin}-${theme}-${width}.png`) });
            }
            const m = await root.evaluate(measure);

            // No sideways scroll, nothing clipped or cut short.
            expect(m.root.scrollWidth, `${at}: the page root overflows sideways`).toBeLessThanOrEqual(m.root.clientWidth);
            expect(m.pageScrollWidth, `${at}: the page scrolls sideways`).toBeLessThanOrEqual(m.pageClientWidth);
            expect(m.root.box.right, `${at}: the page runs past the viewport`).toBeLessThanOrEqual(m.viewport + 0.5);
            expect(m.ellipsis, `${at}: text is cut short with an ellipsis`).toEqual([]);
            expect(m.clipped, `${at}: an element is wider than its box`).toEqual([]);
            expect(m.titles.length, `${at}: the card draws its titles`).toBeGreaterThan(8);
            expect(m.titles.filter((t) => t.overflows || t.outside), `${at}: a phase title, ticket title or epic tag is clipped`).toEqual([]);
            expect(m.headings.phases, `${at}: three phase headings`).toBe(3);
            expect(m.headings.finishedInsideSummary, `${at}: the finished phase keeps its heading inside its summary`).toBe(true);

            // The page's order (plan Task WM4's table): two columns from 900, one column under it.
            if (width >= 900) {
              expect(Math.abs(m.work.left - m.goals.left), `${at}: Work and Goals do not share a left edge`).toBeLessThan(1);
              expect(m.work.top, `${at}: Work is not below Goals`).toBeGreaterThanOrEqual(m.goals.bottom - 0.5);
              expect(m.waiting.left, `${at}: Waiting on you is not in the right column`).toBeGreaterThanOrEqual(m.work.right - 0.5);
              expect(Math.abs(m.waiting.top - m.goals.top), `${at}: Waiting on you does not head the right column`).toBeLessThan(1);
              expect(Math.abs(m.runs.left - m.waiting.left), `${at}: Runs is not in Waiting on you's column`).toBeLessThan(1);
              expect(m.runs.top, `${at}: Runs is not below Waiting on you`).toBeGreaterThanOrEqual(m.waiting.bottom - 0.5);
            } else {
              for (const b of [m.work, m.waiting, m.runs]) expect(Math.abs(b.left - m.goals.left), `${at}: one column`).toBeLessThan(1);
              expect(m.work.top, `${at}: Work is not below Goals`).toBeGreaterThanOrEqual(m.goals.bottom - 0.5);
              expect(m.waiting.top, `${at}: Waiting on you is not below Work`).toBeGreaterThanOrEqual(m.work.bottom - 0.5);
              expect(m.runs.top, `${at}: Runs is not below Waiting on you`).toBeGreaterThanOrEqual(m.waiting.bottom - 0.5);
            }
            assertRowLayout(m, at, width);
            // The head: the programme icon before the title on the title's own line, sized to its text, and no kicker word.
            expect(m.head.kicker, `${at}: the head still draws its kicker`).toBe(false);
            expect(m.head.ico.right, `${at}: the icon is not before the title`).toBeLessThanOrEqual(m.head.title.left + 0.5);
            expect(Math.abs((m.head.ico.top + m.head.ico.bottom) / 2 - (m.head.title.top + m.head.title.bottom) / 2), `${at}: the icon is not on the title's line`)
              .toBeLessThanOrEqual(m.head.lineHeight / 2 + 1);
            expect(m.head.ico.bottom - m.head.ico.top, `${at}: the icon is not sized to the title's text`).toBeLessThanOrEqual(m.head.fontSize * 1.2);
            expect(m.head.ico.bottom - m.head.ico.top, `${at}: the icon is not sized to the title's text`).toBeGreaterThanOrEqual(m.head.fontSize * 0.8);
            // F2 of review 2922: a title has at least the room on a desk that it has on a phone.
            const ref = await phoneTitleTrack();
            expect(m.titleTrack, `${at}: a ticket's title has less room (${Math.round(m.titleTrack)}px) than on a phone (${Math.round(ref)}px)`).toBeGreaterThanOrEqual(ref - 1);
            expect(errors, `${at}: page errors`).toEqual([]);
          } finally {
            await ctx.close();
          }
        }
      }
    }, 300_000);
  }
});

// The page keeps the last view when a re-read comes back unreadable, and says so, at the two ends of the table (spec §5.1; review 2268
// F15). The first read answers the view; the fleet's runs frame then moves this programme's run, the page reads again, and the
// answer is the server's own `unreadable` word.
describe('an unreadable re-read keeps the last view (WM4)', () => {
  for (const width of [360, 1280]) {
    for (const [skin, theme] of [[REFINED, 'light'], [INSTRUMENT, PHOSPHOR]] as const) {
      it(`at ${width}px, ${skin}, ${theme}`, async () => {
        const fixture: AppFixture = { ...FIXTURE, api: { ...FIXTURE.api } };
        const { ctx, page, errors, send, root } = await (async () => {
          const app = await openApp(browser!, { skin, theme, width }, fixture);
          await app.page.goto(server!.origin + '/programmes/prog-a');
          const r = app.page.locator('.pv[data-program="prog-a"]');
          await r.locator('.wk-card .wk-row[data-ticket="t-2"]').waitFor({ timeout: 30_000 });
          return { ...app, root: r };
        })();
        try {
          (fixture.api as Record<string, unknown>)['/api/programmes/prog-a/plan'] = {
            ok: true, plan: { program: 'prog-a', planned: true, initiatives: [], epics: [], doneWhen: [] }, work: { unreadable: 'run-unreadable' },
          };
          send('/ws/fleet', { type: 'runs', runs: [{ ...RUNS[0]!, state: 'awaiting-review' }] });
          const note = root.locator('.wk-card .wk-unreadable');
          await note.waitFor({ timeout: 30_000 });
          expect(await note.textContent()).toBe('The work could not be read: the runs could not be read');
          expect(await root.locator('.wk-headline').textContent(), 'the last view is still drawn').toBe('1 of 5 done');
          const shots = process.env.CCRC_SHOTS;
          if (shots) {
            await page.setViewportSize({ width, height: 2600 });
            await root.screenshot({ path: path.join(shots, `unreadable-${skin}-${theme}-${width}.png`) });
          }
          const m = await root.evaluate(measure);
          expect(m.pageScrollWidth, 'the page scrolls sideways').toBeLessThanOrEqual(m.pageClientWidth);
          expect(m.titles.filter((t) => t.overflows || t.outside), 'a title is clipped').toEqual([]);
          expect(errors, 'page errors').toEqual([]);
        } finally {
          await ctx.close();
        }
      }, 120_000);
    }
  }
});

// The same page with titles of ordinary length: what the operator sees first, and the pictures the task note links (`CCRC_SHOTS`).
describe('the page with ordinary titles (WM4)', () => {
  const PLAIN = JSON.parse(JSON.stringify(WORK).replaceAll(LONG, 'with a plain name')) as WorkMapView;
  for (const width of [360, 800, 1280]) {
    for (const theme of ['light', PHOSPHOR]) {
      it(`at ${width}px, ${REFINED}, ${theme}`, async () => {
        const fixture: AppFixture = { ...FIXTURE, api: { ...FIXTURE.api,
          '/api/programmes/prog-a/plan': { ok: true, plan: { program: 'prog-a', planned: true, initiatives: [], epics: [], doneWhen: [] }, work: PLAIN } } };
        const app = await openApp(browser!, { skin: REFINED, theme, width }, fixture);
        try {
          await app.page.goto(server!.origin + '/programmes/prog-a');
          const root = app.page.locator('.pv[data-program="prog-a"]');
          await root.locator('.wk-card .wk-row[data-ticket="t-2"]').waitFor({ timeout: 30_000 });
          await root.locator('[data-testid="programme-runs"]').waitFor({ timeout: 30_000 });
          const shots = process.env.CCRC_SHOTS;
          if (shots) {
            await app.page.setViewportSize({ width, height: 2600 });
            await root.screenshot({ path: path.join(shots, `plain-${REFINED}-${theme}-${width}.png`) });
          }
          const m = await root.evaluate(measure);
          expect(m.pageScrollWidth, 'the page scrolls sideways').toBeLessThanOrEqual(m.pageClientWidth);
          expect(m.titles.filter((t) => t.overflows || t.outside), 'a title is clipped').toEqual([]);
          // F2 of review 2922: a plain-name epic tag stays on one line, so it never breaks inside a word.
          expect(m.tagLines.filter((n) => n !== 1), `at ${width}px an epic tag broke across lines`).toEqual([]);
          expect(m.titleTrack, `at ${width}px a title has less room than on a phone`).toBeGreaterThanOrEqual((await phoneTitleTrack()) - 1);
          expect(app.errors, 'page errors').toEqual([]);
        } finally {
          await app.ctx.close();
        }
      }, 120_000);
    }
  }
});
