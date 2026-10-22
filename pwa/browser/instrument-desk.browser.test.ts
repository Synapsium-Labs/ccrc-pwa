// Instrument's desk, measured in a real Chrome over the production build (W2 desk polish, Task T2e, D-6335). The jsdom
// suites (test/instrument-shell.test.tsx, test/instrument-list.test.tsx) pin the rules that produce this geometry;
// this file holds the geometry: no empty fourth column (the reading column is 860 at 1600 and the detail reaches the
// viewport's edge), one head in the list column (the first row starts higher), and a status row of two lines and about
// 40 px under a fine pointer, which under a touch screen is the tap floor again.
//
// The fixture is 12 sessions of one project in every bucket (2 attention, 3 working, 2 done, 3 idle, 2 dead: seven open
// rows by default), so the first-row offset and the row heights are measured on the fleet the operator's notes
// described, never an empty one. Fine pointer is the default context; touch is `openApp`'s `touch: true`.
//
// MUTATION TABLE (plan Task T2e Step 3; RUN, this file alone, each mutant reverted):
//   the fourth track unconditional ..................... "at 1600 the session's reading column is 860 …"
//   a literal 32px floor outside (pointer: fine) ....... "under touch emulation, every row and control is at least 44 px"
// The plain move of the dense block's media prelude (without `(pointer: fine)`) is NOT red here: its floors are
// `--row-h`, which is 44 under a coarse pointer already. That mutant is test/instrument-list.test.tsx's.
//
// Chrome comes from `resolveChrome()` in `beforeAll`, which THROWS when neither `CCRC_CHROME` nor
// `/usr/bin/google-chrome` is an executable file: a box without Chrome gives a red leg, never a skipped one.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type DistServer } from './app';

const THEMES = [PHOSPHOR, 'light'] as const;

const session = (ws: string, bucket: string, status: string, extra: object = {}): object => ({
  id: `project-a-${ws}`, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: `/w/project-a/${ws}`,
  workspace: ws, name: ws, status, statusUpdatedAt: null, limits: null, dialogPending: false, version: null, model: null,
  effort: null, ultracode: false, branch: `ws/${ws}`, ctxPct: 40, paneCols: null, tasks: null, pr: null, archivedAt: null,
  archivedBytes: null, held: null, hookState: null, askSummary: null, subagents: null, background: null,
  withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket, unmeasured: [], started: true,
  child: { kind: 'none' }, ...extra,
});
const SESSIONS = [
  session('ws-a', 'attention', 'busy'), session('ws-b', 'attention', 'idle'),
  session('ws-c', 'working', 'busy'), session('ws-d', 'working', 'busy'), session('ws-e', 'working', 'busy'),
  session('ws-f', 'done', 'idle'), session('ws-g', 'done', 'idle'),
  session('ws-h', 'idle', 'idle'), session('ws-i', 'idle', 'idle'), session('ws-j', 'idle', 'idle'),
  session('ws-k', 'dead', 'dead'), session('ws-l', 'dead', 'dead'),
];
const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false }] },
    '/api/runs': [], '/api/claims': [],
  },
  fleetFrames: [{ type: 'fleet', sessions: SESSIONS }],
};
const SESSION_ROUTE = '/s/project-a-ws-c';

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

async function open(theme: string, width: number, height: number, route: string, touch = false) {
  const opened = await openApp(browser!, { skin: INSTRUMENT, theme, width, touch }, FIXTURE);
  await opened.page.setViewportSize({ width, height });
  await opened.page.goto(server!.origin + route);
  await opened.page.waitForSelector('.shell-nav .sess-line', { timeout: 20_000 });
  await opened.page.waitForTimeout(600); // the first paint's transitions and the fleet frame settle
  return opened;
}

describe('no empty fourth column', () => {
  for (const theme of THEMES) {
    it(`at 1600 the session's reading column is 860 and the detail reaches the viewport's right edge (${theme})`, async () => {
      const { ctx, page, errors } = await open(theme, 1600, 900, SESSION_ROUTE);
      try {
        await page.waitForSelector('.composer', { timeout: 20_000 });
        const m = await page.evaluate(() => {
          const detail = document.querySelector('main.shell-detail')!.getBoundingClientRect();
          return {
            tracks: getComputedStyle(document.querySelector('.app-shell')!).gridTemplateColumns.split(' '),
            detailRight: Math.round(detail.right),
            composerW: Math.round(document.querySelector('.composer')!.getBoundingClientRect().width),
            inspectors: document.querySelectorAll('aside.shell-inspector').length,
            sideScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        });
        // Three tracks (the rail, the list, the detail): the 320 px fourth track is S12's, with the Inspector part.
        expect(m.tracks, 'grid tracks').toEqual(['52px', '420px', '1128px']);
        expect(m.inspectors, 'Instrument places no inspector yet').toBe(0);
        expect(m.composerW, 'the reading column').toBe(860);
        expect(m.detailRight, "the detail reaches the viewport's right edge").toBe(1600);
        expect(m.sideScroll).toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }

  it('the tracks follow the width: 52 340 below 1600, 52 420 from 1600, never a fourth', async () => {
    for (const [width, tracks] of [[1280, ['52px', '340px', '888px']], [1599, ['52px', '340px', '1207px']],
      [1920, ['52px', '420px', '1448px']]] as const) {
      const { ctx, page } = await open(PHOSPHOR, width, 900, '/');
      try {
        const got = await page.evaluate(() => getComputedStyle(document.querySelector('.app-shell')!).gridTemplateColumns.split(' '));
        expect(got, `${width}px`).toEqual(tracks);
      } finally {
        await ctx.close();
      }
    }
  });
});

/** The first row's offset below the list column's top at 1280x800 on `/`, on origin/main (c34f82830, Step 0): the
 *  column's own head (the wordmark and five doors, 120 px with the count line) sat above it. MEASURED: 352 px. */
const BEFORE = 352;
/** What T2e removes from that offset on this fixture. MEASURED after the change: the offset is 223 px, a saving of
 *  129 px, written here rounded down to a multiple of ten (ruling 4). It is the head's chrome (the wordmark and the
 *  doors row, the count line stays), the toggle (44 to 32) and the first group head (44 to 32). */
const BUDGET = 120;

describe('one head in the list column', () => {
  for (const theme of THEMES) {
    it(`at 1280x800 the first row starts at least ${BUDGET} px higher than on origin/main (${theme})`, async () => {
      const { ctx, page } = await open(theme, 1280, 800, '/');
      try {
        const offset = await page.evaluate(() => {
          const nav = document.querySelector('.shell-nav')!.getBoundingClientRect();
          return Math.round(document.querySelector('.shell-nav .sess-line')!.getBoundingClientRect().top - nav.top);
        });
        expect(offset).toBeLessThanOrEqual(BEFORE - BUDGET);
      } finally {
        await ctx.close();
      }
    });
  }
});

describe('dense rows under a fine pointer', () => {
  for (const theme of THEMES) {
    it(`a status row without an ask is at most two lines and 42 px, with its name, state word and context visible (${theme})`, async () => {
      const { ctx, page } = await open(theme, 1280, 800, '/');
      try {
        const rows = await page.evaluate(() => {
          // A line is a run of text boxes that overlap vertically: the name (15 px) and the state word (12 px) share
          // one line though their boxes' tops differ.
          const lines = (el: Element): number => {
            const spans: [number, number][] = [];
            const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            for (let n = walk.nextNode(); n !== null; n = walk.nextNode()) {
              if ((n.textContent ?? '').trim() === '') continue;
              const p = n.parentElement!;
              if (p.closest('.sr-only, [aria-hidden="true"]') !== null && p.closest('.fit-full') === null) continue;
              const range = document.createRange();
              range.selectNodeContents(n);
              for (const rc of range.getClientRects()) if (rc.width > 0 && rc.height > 0) spans.push([rc.top, rc.bottom]);
            }
            spans.sort((a, b) => a[0] - b[0]);
            let count = 0;
            let end = -Infinity;
            for (const [top, bottom] of spans) {
              if (top >= end) count += 1;
              end = Math.max(end, bottom);
            }
            return count;
          };
          const shown = (el: Element | null, row: DOMRect): boolean => {
            if (el === null || (el.textContent ?? '').trim() === '') return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && r.top >= row.top - 1 && r.bottom <= row.bottom + 1;
          };
          return [...document.querySelectorAll<HTMLElement>('.shell-nav li.ins-row')].map((li) => {
            const box = li.getBoundingClientRect();
            const line = li.querySelector('.sess-line')!;
            return {
              id: li.getAttribute('data-row'), height: box.height, lines: lines(line),
              name: shown(li.querySelector('.sess-open'), box), state: shown(li.querySelector('.sess-state'), box),
              context: shown(li.querySelector('.sess-meta--context'), box),
              asks: li.querySelector('.sess-ask, .sess-subagent-list') !== null,
            };
          });
        });
        expect(rows.length, 'open rows').toBeGreaterThanOrEqual(5);
        for (const r of rows) {
          expect(r.asks, `${r.id}: no ask`).toBe(false);
          expect(r.height, `${r.id}: height`).toBeLessThanOrEqual(42);
          expect(r.lines, `${r.id}: lines`).toBeLessThanOrEqual(2);
          expect(r.name, `${r.id}: name`).toBe(true);
          expect(r.state, `${r.id}: state word`).toBe(true);
          expect(r.context, `${r.id}: context`).toBe(true);
        }
      } finally {
        await ctx.close();
      }
    });
  }
});

describe('a touch screen keeps the tap floor', () => {
  for (const theme of THEMES) {
    it(`under touch emulation, every row and control is at least 44 px (${theme})`, async () => {
      const { ctx, page } = await open(theme, 1280, 800, '/', true);
      try {
        expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches),
          'the context emulates a coarse pointer').toBe(true);
        const m = await page.evaluate(() => {
          const h = (sel: string): number[] => [...document.querySelectorAll(sel)].map((el) => Math.round(el.getBoundingClientRect().height));
          // The actions button is 32 px with a ::before hit overlay grown by a negative inset; the hit area is the
          // button's box grown by that inset on each side.
          const actions = [...document.querySelectorAll<HTMLElement>('.shell-nav .sess-actions')].map((el) => {
            const r = el.getBoundingClientRect();
            const inset = parseFloat(getComputedStyle(el, '::before').top);
            return { w: Math.round(r.width - 2 * inset), h: Math.round(r.height - 2 * inset) };
          });
          return { rows: h('.shell-nav li.ins-row'), heads: h('.ins-group-head'), options: h('.ins-toggle-option'), actions };
        });
        expect(m.rows.length, 'rows').toBeGreaterThanOrEqual(5);
        expect(m.heads.length, 'group heads').toBeGreaterThanOrEqual(3);
        expect(m.options.length, 'toggle options').toBe(2);
        for (const v of m.rows) expect(v, 'row').toBeGreaterThanOrEqual(44);
        for (const v of m.heads) expect(v, 'group head').toBeGreaterThanOrEqual(44);
        for (const v of m.options) expect(v, 'toggle option').toBeGreaterThanOrEqual(44);
        expect(m.actions.length, 'actions buttons').toBeGreaterThanOrEqual(5);
        for (const a of m.actions) {
          expect(a.h, 'actions hit area, tall').toBeGreaterThanOrEqual(44);
          expect(a.w, 'actions hit area, wide').toBeGreaterThanOrEqual(44);
        }
      } finally {
        await ctx.close();
      }
    });
  }
});
