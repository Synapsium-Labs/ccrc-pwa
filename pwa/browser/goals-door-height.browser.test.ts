// The session's Goals door costs the header at most its own row, and on a phone nothing (desktop-polish PL11, D-7986; spec §2
// "Goals from inside a session", D30: "This is the one change inside a session"; review 1537 F1 and review 1548 F1 to F3, ruled
// in fix rounds 1 and 2), measured in a real Chrome over the production build.
//
// THE PIN. Each case compares the SAME session in and out of a programme. "In" and "out" are fleet rows identical in every
// field the header reads but the id, whose length is the same. "In" is bound to a run of an openable slug (`prog-e…`). "Out"
// is bound to a run of the same slug with an accented letter (`prog-é…`), a slug the console refuses (`programmeIsOpenable`),
// which breaks across lines where "in" does, with the same title. So "out" draws the same coordination line (D-5527: the programme and wave, and the coordinator, which every
// run-bound session drew before PL11) and no Goals door.
//   - EQUAL where the line has slack: the pin's fixtures (names of 8, 13, 26 and 31 characters; a workspace with a PR, one
//     whose cap reads "Check PR", and a main checkout coordinating its run) at 390, 1200, 1279 and 1280, in both skins. A
//     door that always takes a line of its own reds here.
//   - THE BOUND at a desk (900 and up), any width, any content: "in" is never taller than "out" by more than the door's own
//     row, measured from the page as the door's rendered height plus its container's computed row-gap, and no other row of
//     the header changes height (the title, and every one of the coordination line and the chip row that does not hold the
//     door). A door on a line that wraps cannot be height-neutral for every slug and name unless every header reserved its
//     width, in a programme or not, which D30 forbids; one line of the row it stands on is the door's own cost (ruling of
//     fix round 2). The bound reads no font metric, so it holds on CI's Chrome and this box's alike.
//     The sweep is a grid, not the full product: at 900, 1000, 1050, 1199, 1200, 1280, 1440 and 1920, in both skins, seven
//     sessions: a worker (a "Check PR" cap) under slugs of 6, 14, 26 and 46 characters and a 24-character coordinator name;
//     the same worker under a 6-character slug and a 40-character coordinator name; a workspace coordinator with a PR cap;
//     and a main-checkout coordinator.
//   - A COARSE POINTER at a desk (a touch screen) takes the tap floor (the operator's ruling of 2026-10-15: "a mouse keeps …
//     the header its base height"; a coarse pointer takes the floor), bounded the same way: at 1000 and 1280, in both skins.
//
// WHERE THE DOOR STANDS (`sessionHeaderView`'s `goals.slot`). Instrument below 900: a glyph-only key on Back's row; at a desk
// last on the coordination line, or, for a coordinator that holds no run of its own (so it has no coordination line), after
// its last chip. Refined on a phone: first on the coordination line in its rail; at a desk, the rail's last item. Its word shows beside the glyph from 1280 and the
// glyph stands alone below. Where the word is drawn it is visible (computed visibility and opacity), inside the door's box
// and beside the glyph (review 1537 A5).
//
// MUTATION TABLE: see docs/superpowers/plans/2026-11-01-programme-ledgers/pl11.md.
//
//   CCRC_CHROME=$HOME/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome ./node_modules/.bin/vitest run --config vitest.browser.config.ts --maxWorkers=2 browser/goals-door-height.browser.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer } from './app';
import { fleetSession } from '../test/fleetFixture';
import { withRunBinding } from '../test/runBindingFixture';
import type { FleetSession } from '../../shared/api';

const NOW = Date.now();
const MIN = 60_000;

const PR = {
  phase: 'open', number: 123, url: null, title: null, checks: 'pass', checkNames: null, ahead: 1, reason: null,
  checkedAt: null, mergedAt: null, retryAt: null,
} as const;
/** A worker (a dispatched child) with a PR or a "Check PR" cap; a coordinator in a workspace (a PR cap); a coordinator in a
 *  main checkout (no cap, titled by its project). A coordinator claims its own run, so it has no coordination line. */
type Shape = 'pr' | 'check' | 'ws-coord' | 'main';
const SHAPE_WORDS: Record<Shape, string> = {
  pr: 'worker, PR #123', check: 'worker, "Check PR" cap', 'ws-coord': 'workspace coordinator, PR #123', main: 'main-checkout coordinator',
};

/** Coordinators of the workers' runs: names of 24 and 40 characters. */
const COORD = 'project-a-programme-wave';
const COORD_40 = 'project-a-programme-wave-coordinator-abc';

/** A slug of `n` characters, openable (`in`, `prog-e…`) or refused (`out`, `prog-é…`: the grammar takes ASCII only). Both
 *  keep the hyphen and their letters, so a long slug breaks at the same places either way: a dot for the hyphen broke the
 *  "out" slug anywhere and the "in" one after its hyphen, a line apart at 46 characters, which was the fixture, not the door. */
const slugOf = (side: 'in' | 'out', n: number): string => `prog-${side === 'in' ? 'e' : 'é'}${'abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmn'.slice(0, n - 6)}`;

interface Pair {
  readonly key: string;
  readonly name: string;
  readonly shape: Shape;
  readonly slug: number;
  readonly coord: string;
  readonly inRun: number;
  readonly outRun: number;
}
/** `pi-…` in the programme, `po-…` out of it: ids of one length. */
const idOf = (side: 'pi' | 'po', p: Pair): string => `${side}-${p.key}`;
const words = (p: Pair): string => `${p.name.length} chars, ${SHAPE_WORDS[p.shape]}, slug ${p.slug}, coordinator ${p.coord.length}`;

let runId = 100;
const pair = (key: string, name: string, shape: Shape, slug = 6, coord = COORD): Pair =>
  ({ key, name, shape, slug, coord, inRun: runId++, outRun: runId++ });

/** The equal cases' fixtures: names of 8, 13, 26 and 31 characters, a workspace with a PR or a "Check PR" cap, and a main
 *  checkout coordinating its run (neutral names: the repository is public). */
const NAMES = ['goals-ab', 'goals-door-ab', 'goals-door-height-pin-abcd', 'goals-door-height-pin-abcdefghi'] as const;
const EQUAL_PAIRS: readonly Pair[] = NAMES.flatMap((name) => (['pr', 'check', 'main'] as const).map((shape) => pair(`e${name.length}-${shape}`, name, shape)));

/** The bound's sweep (ruling of fix round 2): slugs of 6, 14, 26 and 46 characters, a 40-character coordinator name, a
 *  workspace coordinator with a PR cap and a main-checkout coordinator. */
const SWEEP_PAIRS: readonly Pair[] = [
  ...[6, 14, 26, 46].map((slug) => pair(`s${slug}`, 'goals-door-ab', 'check', slug)),
  pair('c40', 'goals-door-ab', 'check', 6, COORD_40),
  pair('wsc', 'goals-door-ab', 'ws-coord'),
  pair('mc', 'goals-door-ab', 'main'),
];
/** A coarse pointer at a desk: a worker, and both coordinators. */
const COARSE_PAIRS: readonly Pair[] = SWEEP_PAIRS.filter((p) => ['s6', 'wsc', 'mc'].includes(p.key));

const row = (id: string, p: Pair, run: number): FleetSession => (p.shape === 'main'
  ? fleetSession({
    id, wrapper: 'lane-a', home: 'lane-a', project: p.name, workdir: `/w/${p.name}`, workspace: null, name: null,
    status: 'idle', bucket: 'idle', statusUpdatedAt: NOW - MIN, bucketSince: NOW - 6 * MIN, model: 'claude-opus-5-5',
    effort: 'high', branch: 'main', ctxPct: 40, pr: null, role: 'coordinator',
  })
  : p.shape === 'ws-coord'
    ? fleetSession({
      id, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: `/w/project-a/${p.name}`, workspace: p.name, name: p.name,
      status: 'idle', bucket: 'idle', statusUpdatedAt: NOW - MIN, bucketSince: NOW - 6 * MIN, model: 'claude-opus-5-5',
      effort: 'high', branch: `ws/${p.name}`, ctxPct: 40, pr: PR as FleetSession['pr'], role: 'coordinator',
    })
    // A dispatched worker: its child mark names the run that minted it.
    : fleetSession({
      id, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: `/w/project-a/${p.name}`, workspace: p.name, name: p.name,
      status: 'idle', bucket: 'idle', statusUpdatedAt: NOW - MIN, bucketSince: NOW - 6 * MIN, model: 'claude-opus-5-5',
      effort: 'high', branch: `ws/${p.name}`, ctxPct: 40, pr: p.shape === 'pr' ? PR as FleetSession['pr'] : null, role: 'child',
      child: { kind: 'child', runId: run },
    }));
const coordinatorRow = (name: string): FleetSession => fleetSession({
  id: name, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: `/w/project-a/${name}`, workspace: name, name,
  status: 'idle', bucket: 'idle', role: 'coordinator',
});
const ALL_PAIRS = [...EQUAL_PAIRS, ...SWEEP_PAIRS];
const SESSIONS: FleetSession[] = [
  coordinatorRow(COORD), coordinatorRow(COORD_40),
  ...ALL_PAIRS.flatMap((p) => [row(idOf('pi', p), p, p.inRun), row(idOf('po', p), p, p.outRun)]),
];

const coordinates = (shape: Shape): boolean => shape === 'main' || shape === 'ws-coord';
/** A worker's run is claimed by its coordinator; a coordinator's run is the one it claims itself, with no worker yet. */
const run = (id: number, program: string, owner: string, p: Pair): object => ({
  id, program, programTitle: 'Programme A', wave: 2, waveOf: 5, project: 'project-a', homeProject: 'project-a',
  sessionId: coordinates(p.shape) ? null : owner, workspace: coordinates(p.shape) ? null : owner,
  branch: coordinates(p.shape) ? null : `ws/${owner}`, state: 'working', kind: 'work', reviews: null,
  claimedBy: coordinates(p.shape) ? owner : p.coord, resumed: false, clearedAt: null, openedAt: NOW - 3_600_000,
  dispatchStartedAt: null, dispatchedAt: NOW - 3_000_000, closedAt: null, handoffCommit: null, items: { done: 0, total: 0 },
  unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: false,
    clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, reviewCap: null,
});
const RUNS = ALL_PAIRS.flatMap((p) => [
  run(p.inRun, slugOf('in', p.slug), idOf('pi', p), p), run(p.outRun, slugOf('out', p.slug), idOf('po', p), p),
]);

const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false }] },
    '/api/projects': { roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a' }, ...NAMES.map((n) => ({ name: n, workdir: `/w/${n}` }))] },
    '/api/runs': RUNS, '/api/claims': [],
  },
  fleetFrames: [{ type: 'fleet', sessions: withRunBinding(SESSIONS as never[], RUNS as never[]) }, { type: 'runs', runs: RUNS }],
};

const SKINS = [REFINED, INSTRUMENT] as const;
type Skin = (typeof SKINS)[number];
/** Where the line has slack for the pin's fixtures: "in" and "out" are equal. */
const EQUAL_WIDTHS = [390, 1200, 1279, 1280] as const;
/** The desk widths the bound sweeps. */
const DESK_WIDTHS = [900, 1000, 1050, 1199, 1200, 1280, 1440, 1920] as const;
const COARSE_WIDTHS = [1000, 1280] as const;
/** The width from which the door's word shows beside its glyph (chat.css). */
const WORD_FROM = 1280;

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

type Slot = 'coordination-line' | 'chip-row' | 'back-row' | 'title-row' | 'none' | 'several';
/** Where the drawn Goals door stands, and its word as drawn. */
interface DoorPlace {
  readonly slot: Slot;
  /** The word's text when it is displayed, else `null`. */
  readonly word: string | null;
  /** A displayed word is visible (computed visibility and opacity), inside the door's box, and beside the glyph. */
  readonly wordShown: boolean;
  /** The door is inside the viewport as drawn: a phone's rail shows it without a swipe. */
  readonly inView: boolean;
  /** The door's own row: its rendered height plus its container's computed row-gap, in px; `null` with no single door. */
  readonly row: number | null;
  /** The door's rendered height, and its content box's height above its tallest child's (its glyph's or its word's): 0 when
   *  it is as tall as what it shows, more under a floor (`min-height`). */
  readonly height: number;
  readonly floor: number;
}
/** The header's rows: the title, the coordination line and the chip row (`null` where it is not drawn), each with whether it
 *  holds the door. */
interface Rows {
  readonly title: number;
  readonly coord: { readonly h: number; readonly door: boolean } | null;
  readonly meta: { readonly h: number; readonly door: boolean } | null;
}

/** Opens session `id` in the running app by the router's own history move (no reload) and returns its header's height, its
 *  rows and where its Goals door stands, once the header names it and, in the programme, once the door is drawn. */
async function measure(page: Page, id: string, title: string, inProgramme: boolean): Promise<{ h: number; door: DoorPlace; rows: Rows }> {
  await page.evaluate((path) => {
    history.pushState(null, '', path);
    dispatchEvent(new PopStateEvent('popstate'));
  }, `/s/${id}`);
  await page.waitForFunction((t) => document.querySelector('.chat-head .chat-title-text')?.textContent === t, title, { timeout: 20_000 });
  if (inProgramme) await page.waitForSelector('.chat-head :is(.chat-coord-goals, .keycap--goals)', { timeout: 20_000 });
  else await page.waitForTimeout(150);
  await page.evaluate(async () => { await document.fonts.ready; });
  return page.evaluate(() => {
    const head = document.querySelector<HTMLElement>('.chat-head')!;
    const shown = (e: Element): boolean => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0;
    const doors = [...head.querySelectorAll<HTMLElement>('.chat-coord-goals, .keycap--goals')].filter(shown);
    let slot: Slot = doors.length === 0 ? 'none' : doors.length > 1 ? 'several' : 'title-row';
    let word: string | null = null;
    let wordShown = false;
    let inView = false;
    let row: number | null = null;
    let height = 0;
    let floor = 0;
    const door = doors.length === 1 ? doors[0]! : null;
    if (door !== null) {
      const box = door.getBoundingClientRect();
      inView = box.left >= -0.5 && box.right <= innerWidth + 0.5 && box.width > 0;
      const gap = parseFloat(getComputedStyle(door.parentElement!).rowGap);
      row = box.height + (Number.isFinite(gap) ? gap : 0);
      height = box.height;
      const ds = getComputedStyle(door);
      const inner = box.height - ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
        .reduce((n, k) => n + parseFloat(ds[k as 'paddingTop']), 0);
      const tallest = Math.max(0, ...[...door.children].filter(shown).map((c) => c.getBoundingClientRect().height));
      floor = Math.max(0, inner - tallest);
      if (door.closest('.chat-coord') !== null) slot = 'coordination-line';
      else if (door.closest('.chat-meta') !== null) slot = 'chip-row';
      else {
        const back = head.querySelector<HTMLElement>('.chat-back, .back-btn');
        const title = head.querySelector<HTMLElement>('.chat-title');
        const onRow = (e: HTMLElement | null): boolean => {
          if (e === null || !shown(e)) return false;
          const r = e.getBoundingClientRect();
          return r.top < box.bottom && r.bottom > box.top;
        };
        slot = onRow(back) && !onRow(title) ? 'back-row' : 'title-row';
      }
      const w = door.querySelector<HTMLElement>('.chat-coord-goals-word, .keycap-word');
      if (w !== null && getComputedStyle(w).display !== 'none') {
        word = w.textContent;
        const cs = getComputedStyle(w);
        const wr = w.getBoundingClientRect();
        const glyph = door.querySelector('svg')!.getBoundingClientRect();
        wordShown = cs.visibility === 'visible' && Number(cs.opacity) === 1 && wr.width > 0
          && wr.left >= box.left - 0.5 && wr.right <= box.right + 0.5 && wr.top >= box.top - 0.5 && wr.bottom <= box.bottom + 0.5
          && wr.left >= glyph.right - 0.5;
      }
    }
    const rowOf = (sel: string): { h: number; door: boolean } | null => {
      const e = head.querySelector<HTMLElement>(sel);
      return e === null || !shown(e) ? null : { h: e.getBoundingClientRect().height, door: door !== null && e.contains(door) };
    };
    const rows = { title: head.querySelector<HTMLElement>('.chat-title')!.getBoundingClientRect().height, coord: rowOf('.chat-coord'), meta: rowOf('.chat-meta') };
    return { h: head.getBoundingClientRect().height, door: { slot, word, wordShown, inView, row, height, floor }, rows };
  });
}

/** Where `sessionHeaderView`'s `goals.slot` puts the door, as each skin draws it: Refined's desk rail holds it last. */
const expectedSlot = (skin: Skin, width: number, shape: Shape): Slot => (skin === REFINED
  ? (width < 900 ? 'coordination-line' : 'chip-row')
  : width < 900 ? 'back-row' : coordinates(shape) ? 'chip-row' : 'coordination-line');

/** Opens the app at `width` and checks every pair: "out" draws no door; "in" draws one, in its slot and in view, with the word
 *  from 1280 only; and the height is `equal`, or within the door's own row with no other row changed. */
async function checkPairs(skin: Skin, width: number, pairs: readonly Pair[], mode: 'equal' | 'bound', touch = false): Promise<void> {
  const { ctx, page, errors } = await openApp(browser!, { skin, theme: 'light', width, touch }, FIXTURE);
  try {
    await page.goto(`${server!.origin}/s/${idOf('po', pairs[0]!)}`);
    await page.waitForSelector('.chat-head .chat-title-text', { timeout: 20_000 });
    await page.waitForTimeout(300); // the first paint's transitions settle
    const wrong: string[] = [];
    for (const p of pairs) {
      const at = words(p);
      const out = await measure(page, idOf('po', p), p.name, false);
      const inside = await measure(page, idOf('pi', p), p.name, true);
      const grew = inside.h - out.h;
      if (mode === 'equal') {
        if (Math.abs(grew) > 0.5) wrong.push(`${at}: height ${out.h} -> ${inside.h}`);
      } else {
        const own = inside.door.row ?? 0;
        if (grew > own + 0.5) wrong.push(`${at}: height ${out.h} -> ${inside.h} (+${grew}), above the door's own row ${own}`);
        if (Math.abs(inside.rows.title - out.rows.title) > 0.5) wrong.push(`${at}: the title row ${out.rows.title} -> ${inside.rows.title}`);
        for (const k of ['coord', 'meta'] as const) {
          const a = out.rows[k];
          const b = inside.rows[k];
          if (b?.door === true) continue;
          if ((a === null) !== (b === null) || (a !== null && b !== null && Math.abs(a.h - b.h) > 0.5)) {
            wrong.push(`${at}: the ${k} row, which does not hold the door, ${a?.h ?? 'absent'} -> ${b?.h ?? 'absent'}`);
          }
        }
      }
      // The door's own row is one line of the row it stands on: on a fine pointer at a desk the door is as tall as its glyph and
      // word, as the line's links are, so a taller door cannot buy itself a taller row; a coarse pointer takes the tap floor
      // (44 px), as every door on a touch screen does (the operator's ruling of 2026-10-15).
      if (width >= 900 && !touch && inside.door.floor > 0.5) wrong.push(`${at}: the door stands ${inside.door.floor} px above its glyph and word on a fine pointer (${inside.door.height} px tall)`);
      if (touch && inside.door.height < 43.5) wrong.push(`${at}: on a coarse pointer the door is ${inside.door.height} px tall, under the tap floor`);
      const where = expectedSlot(skin, width, p.shape);
      if (out.door.slot !== 'none') wrong.push(`${at}: out of a programme, a door is drawn (${out.door.slot})`);
      if (inside.door.slot !== where) wrong.push(`${at}: the door is on the ${inside.door.slot}, not the ${where}`);
      if (!inside.door.inView) wrong.push(`${at}: the door is outside the viewport`);
      if (width >= WORD_FROM) {
        if (inside.door.word !== 'Goals' || !inside.door.wordShown) {
          wrong.push(`${at}: the word is ${JSON.stringify(inside.door.word)}, shown ${inside.door.wordShown}`);
        }
      } else if (inside.door.word !== null) {
        wrong.push(`${at}: the word ${JSON.stringify(inside.door.word)} is drawn below ${WORD_FROM}`);
      }
    }
    expect(wrong, `${skin} at ${width}${touch ? ', touch' : ''}`).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
}

const placeWords = (skin: Skin, width: number): string =>
  `the door stands ${skin === REFINED ? (width < 900 ? 'first on the coordination line' : "last in the chip rail") : width < 900 ? "on Back's row" : 'on the coordination line or after the last chip'}, ${width >= WORD_FROM ? 'its word beside the glyph' : 'the glyph alone'}`;

describe.each(SKINS)('the Goals door costs the session header no height where the line has slack, in %s', (skin) => {
  for (const width of EQUAL_WIDTHS) {
    it(`at ${width}: the same session in and out of a programme draws a header of one height; ${placeWords(skin, width)}`, async () => {
      await checkPairs(skin, width, EQUAL_PAIRS, 'equal');
    }, 180_000);
  }
});

describe.each(SKINS)('at a desk the Goals door costs the session header at most its own row, in %s', (skin) => {
  for (const width of DESK_WIDTHS) {
    it(`at ${width}: "in" is never taller than "out" by more than the door's own row, and no other row changes; ${placeWords(skin, width)}`, async () => {
      await checkPairs(skin, width, SWEEP_PAIRS, 'bound');
    }, 180_000);
  }
  for (const width of COARSE_WIDTHS) {
    it(`at ${width} with a coarse pointer: the door takes the tap floor, and "in" is never taller than "out" by more than the door's own row`, async () => {
      await checkPairs(skin, width, COARSE_PAIRS, 'bound', true);
    }, 180_000);
  }
});
