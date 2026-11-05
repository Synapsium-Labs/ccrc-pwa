// The session's Goals door costs the header no height (desktop-polish PL11, D-7986; spec §2 "Goals from inside a session",
// D30: "nothing else in the session's chrome changes"; review 1537 F1, ruled in fix round 1), measured in a real Chrome over
// the production build.
//
// THE PIN. The SAME session in and out of a programme draws a `.chat-head` of the same height at 390, 1200, 1279 and 1280, in
// both skins. At 900 and 1199 the door stands on the coordination line, which may be full there, and the "in" header is at most
// 14 px taller (the ruling's allowance: one more coordination line). The cases cover names of 8, 13, 26 and 31 characters,
// each in three shapes:
//   - a workspace with a PR (its cap reads `#123`);
//   - a workspace without one (its cap reads "Check PR": every workspace draws the cap, `hasPrCap`);
//   - a main checkout, which draws no cap and is titled by its project, here a coordinator that claims the run.
// "In" and "out" are fleet rows identical in every field the header reads but the id, whose length is the same. "In" is bound
// to a run of `prog-a`. "Out" is bound to a run of `prog.a`, a slug the console refuses (`programmeIsOpenable`), with the same
// title. So "out" draws the same coordination line (D-5527: the programme and wave, and the coordinator, which every run-bound
// session drew before PL11) and no Goals door.
//
// WHERE THE DOOR STANDS. Instrument below 900: a glyph-only key on Back's row. Everywhere else: last on the coordination line,
// or, for a coordinator that holds no run of its own (so it has no coordination line), after its last chip in Instrument and
// as an item of the chip rail in Refined. Its word shows beside the glyph from 1280 and the glyph stands alone below: at 1200
// the word took Instrument's line onto a second one under a "Check PR" cap (+13 px, measured in fix round 1). Where the word is
// drawn it is visible (computed visibility and opacity), inside the door's box and beside the glyph (review 1537 A5).
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

/** Names of 8, 13, 26 and 31 characters: a workspace's, or a main checkout's project (neutral: the repository is public). */
const NAMES = ['goals-ab', 'goals-door-ab', 'goals-door-height-pin-abcd', 'goals-door-height-pin-abcdefghi'] as const;
const PR = {
  phase: 'open', number: 123, url: null, title: null, checks: 'pass', checkNames: null, ahead: 1, reason: null,
  checkedAt: null, mergedAt: null, retryAt: null,
} as const;
type Shape = 'pr' | 'check' | 'main';
const SHAPES: readonly Shape[] = ['pr', 'check', 'main'];
const SHAPE_WORDS: Record<Shape, string> = { pr: 'PR #123', check: '"Check PR" cap', main: 'main checkout, no cap' };

/** `pi-…` in the programme, `po-…` out of it: ids of one length. */
const idOf = (side: 'pi' | 'po', name: string, shape: Shape): string => `${side}-${name.length}-${shape}`;
/** A coordinator's name as long as a real one, in a worker's coordination line. */
const COORD = 'project-a-programme-wave';

let runId = 100;
const PAIRS = NAMES.flatMap((name) => SHAPES.map((shape) => ({ name, shape, inRun: runId++, outRun: runId++ })));

const row = (id: string, name: string, shape: Shape, run: number): FleetSession => (shape === 'main'
  // A main checkout: titled by its project, no PR cap, and the coordinator that claims the run.
  ? fleetSession({
    id, wrapper: 'lane-a', home: 'lane-a', project: name, workdir: `/w/${name}`, workspace: null, name: null,
    status: 'idle', bucket: 'idle', statusUpdatedAt: NOW - MIN, bucketSince: NOW - 6 * MIN, model: 'claude-opus-5-5',
    effort: 'high', branch: 'main', ctxPct: 40, pr: null, role: 'coordinator',
  })
  // A dispatched worker: its child mark names the run that minted it.
  : fleetSession({
    id, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: `/w/project-a/${name}`, workspace: name, name,
    status: 'idle', bucket: 'idle', statusUpdatedAt: NOW - MIN, bucketSince: NOW - 6 * MIN, model: 'claude-opus-5-5',
    effort: 'high', branch: `ws/${name}`, ctxPct: 40, pr: shape === 'pr' ? PR as FleetSession['pr'] : null, role: 'child',
    child: { kind: 'child', runId: run },
  }));
const SESSIONS: FleetSession[] = [
  fleetSession({ id: COORD, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: `/w/project-a/${COORD}`,
    workspace: COORD, name: COORD, status: 'idle', bucket: 'idle', role: 'coordinator' }),
  ...PAIRS.flatMap(({ name, shape, inRun, outRun }) => [
    row(idOf('pi', name, shape), name, shape, inRun), row(idOf('po', name, shape), name, shape, outRun),
  ]),
];

/** A worker's run is claimed by the coordinator; a main checkout's run is the one it claims itself, with no worker yet. */
const run = (id: number, program: string, owner: string, shape: Shape): object => ({
  id, program, programTitle: 'Programme A', wave: 2, waveOf: 5, project: 'project-a', homeProject: 'project-a',
  sessionId: shape === 'main' ? null : owner, workspace: shape === 'main' ? null : owner,
  branch: shape === 'main' ? null : `ws/${owner}`, state: 'working', kind: 'work', reviews: null,
  claimedBy: shape === 'main' ? owner : COORD, resumed: false, clearedAt: null, openedAt: NOW - 3_600_000,
  dispatchStartedAt: null, dispatchedAt: NOW - 3_000_000, closedAt: null, handoffCommit: null, items: { done: 0, total: 0 },
  unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: false,
    clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, reviewCap: null,
});
const RUNS = PAIRS.flatMap(({ name, shape, inRun, outRun }) => [
  run(inRun, 'prog-a', idOf('pi', name, shape), shape), run(outRun, 'prog.a', idOf('po', name, shape), shape),
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
/** Height-neutral widths, and the band where the door may take one more coordination line (at most `BAND_PX`). */
const NEUTRAL = [390, 1200, 1279, 1280] as const;
const BAND = [900, 1199] as const;
const BAND_PX = 14;
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

/** Where the drawn Goals door stands, and its word as drawn. */
interface DoorPlace {
  readonly slot: 'coordination-line' | 'chip-row' | 'back-row' | 'title-row' | 'none' | 'several';
  /** The word's text when it is displayed, else `null`. */
  readonly word: string | null;
  /** A displayed word is visible (computed visibility and opacity), inside the door's box, and beside the glyph. */
  readonly wordShown: boolean;
  /** The door is inside the viewport as drawn: a phone's rail shows it without a swipe. */
  readonly inView: boolean;
}

/** Opens session `id` in the running app by the router's own history move (no reload) and returns its header's height and
 *  where its Goals door stands, once the header names it and, in the programme, once the door is drawn. */
async function measure(page: Page, id: string, title: string, inProgramme: boolean): Promise<{ h: number; door: DoorPlace }> {
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
    let slot: DoorPlace['slot'] = doors.length === 0 ? 'none' : doors.length > 1 ? 'several' : 'title-row';
    let word: string | null = null;
    let wordShown = false;
    let inView = false;
    const door = doors.length === 1 ? doors[0]! : null;
    if (door !== null) {
      const box = door.getBoundingClientRect();
      inView = box.left >= -0.5 && box.right <= innerWidth + 0.5 && box.width > 0;
      if (door.closest('.chat-coord') !== null) slot = 'coordination-line';
      else if (door.closest('.chat-meta') !== null) slot = 'chip-row';
      else {
        const back = head.querySelector<HTMLElement>('.chat-back, .back-btn');
        const title = head.querySelector<HTMLElement>('.chat-title');
        const d = door.getBoundingClientRect();
        const onRow = (e: HTMLElement | null): boolean => {
          if (e === null || !shown(e)) return false;
          const r = e.getBoundingClientRect();
          return r.top < d.bottom && r.bottom > d.top;
        };
        slot = onRow(back) && !onRow(title) ? 'back-row' : 'title-row';
      }
      const w = door.querySelector<HTMLElement>('.chat-coord-goals-word, .keycap-word');
      if (w !== null && getComputedStyle(w).display !== 'none') {
        word = w.textContent;
        const cs = getComputedStyle(w);
        const wr = w.getBoundingClientRect();
        const dr = door.getBoundingClientRect();
        const glyph = door.querySelector('svg')!.getBoundingClientRect();
        wordShown = cs.visibility === 'visible' && Number(cs.opacity) === 1 && wr.width > 0
          && wr.left >= dr.left - 0.5 && wr.right <= dr.right + 0.5 && wr.top >= dr.top - 0.5 && wr.bottom <= dr.bottom + 0.5
          && wr.left >= glyph.right - 0.5;
      }
    }
    return { h: head.getBoundingClientRect().height, door: { slot, word, wordShown, inView } };
  });
}

describe.each(SKINS)('the Goals door costs the session header no height in %s', (skin) => {
  for (const width of [...NEUTRAL, ...BAND]) {
    const band = (BAND as readonly number[]).includes(width);
    it(`at ${width}: the same session in and out of a programme draws a header ${band ? `at most ${BAND_PX} px taller` : 'of one height'}; the door stands ${skin === INSTRUMENT && width < 900 ? "on Back's row" : 'on the coordination line'}, ${width >= WORD_FROM ? 'its word beside the glyph' : 'the glyph alone'}`, async () => {
      const { ctx, page, errors } = await openApp(browser!, { skin, theme: 'light', width }, FIXTURE);
      try {
        await page.goto(`${server!.origin}/s/${idOf('po', NAMES[0], 'pr')}`);
        await page.waitForSelector('.chat-head .chat-title-text', { timeout: 20_000 });
        await page.waitForTimeout(300); // the first paint's transitions settle
        const wrong: string[] = [];
        for (const { name, shape } of PAIRS) {
          const at = `${name.length} chars, ${SHAPE_WORDS[shape]}`;
          // Instrument below 900: Back's row. A coordinator that holds no run has no coordination line: in the shared header its
          // door stands after its last chip; in Refined's rail, the line it would stand on is an item of the chip rail.
          const where = skin === INSTRUMENT && width < 900 ? 'back-row' : skin === INSTRUMENT && shape === 'main' ? 'chip-row' : 'coordination-line';
          const out = await measure(page, idOf('po', name, shape), name, false);
          const inside = await measure(page, idOf('pi', name, shape), name, true);
          const grew = inside.h - out.h;
          if (band ? Math.abs(grew) > BAND_PX + 0.25 : Math.abs(grew) > 0.5) wrong.push(`${at}: height ${out.h} -> ${inside.h}`);
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
        expect(wrong, `${skin} at ${width}`).toEqual([]);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 180_000);
  }
});
