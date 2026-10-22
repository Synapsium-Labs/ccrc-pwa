// Instrument's desk, measured in a real Chrome over the production build (W2 desk polish, Task T2e, D-6335). The jsdom
// suites (test/instrument-shell.test.tsx, test/instrument-list.test.tsx) pin the rules that produce this geometry;
// this file holds the geometry: no empty fourth column (the reading column is 860 at 1600 and the detail reaches the
// viewport's edge), one head in the list column (the first row starts higher), and a status row of two lines and
// about 40 px under a fine pointer (three lines, the name, `waiting · needs you` and the context, when a long name and
// the state do not fit side by side, and under 61 px), which under a touch screen is the tap floor again.
//
// The fixture is 13 sessions of one project in every bucket (2 attention, 3 working, 3 done, 3 idle, 2 dead: eight open
// rows by default), with realistic workspace names of 17 to 25 characters, like a fleet's slugs, because a row's height
// is decided by the name beside the state word and a 4-character name hides every wrap. One row is a main checkout
// (no workspace, so no context fact: a one-line row). Fine pointer is the default context; touch is `openApp`'s
// `touch: true`.
//
// MUTATION TABLE (plan Task T2e Step 3 and fix round 1; RUN, this file alone, each mutant reverted):
//   the fourth track unconditional ..................... "at 1600 the session's reading column is 860 …"
//   a literal 32px floor outside (pointer: fine) ....... "under touch emulation, every row and control is at least 44 px"
//   fleet.css's `.sess-actions::before` inset without
//     the border's 2px (the 42 px hit area it documents)  "under touch emulation, every row and control is at least 44 px"
//                                                         (the hit area is the padding box, clientWidth, not the border box)
//   the one-line row's lamp rule removed ............... "the lamp sits on the name's first line in every row …"
//   the state's flex `0 0 auto` as `0 1 auto` + min-width 0  "at 1280 (the 340 column) … every row is at most three lines and under 61 px"
//                                                         (and "at 1280 the two needs-you rows … are exactly three lines")
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
  session('project-a-review-wave-two', 'attention', 'busy'), session('ask-routing-follow-up', 'attention', 'idle'),
  session('desk-density-pass', 'working', 'busy'), session('transcript-search-rungs', 'working', 'busy'),
  session('gauge-window-words', 'working', 'busy'),
  session('inspector-sections-tidy', 'done', 'idle'), session('banner-quiet-line', 'done', 'idle'),
  // A main checkout: no workspace, so no context fact, so a one-line row.
  session('main', 'done', 'idle', { id: 'project-a', workdir: '/w/project-a', workspace: null, name: null, branch: 'main' }),
  session('pool-tag-cleanup-run', 'idle', 'idle'), session('fleet-words-plain-pass', 'idle', 'idle'),
  session('session-header-title', 'idle', 'idle'),
  session('drawer-pty-follow-up', 'dead', 'dead'), session('echo-wait-budget-fix', 'dead', 'dead'),
];
const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false }] },
    '/api/runs': [], '/api/claims': [],
  },
  fleetFrames: [{ type: 'fleet', sessions: SESSIONS }],
};
const SESSION_ROUTE = '/s/project-a-desk-density-pass';

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
 *  column's own head (the wordmark and five doors, 120 px with the count line) sat above it. MEASURED on this fixture
 *  (names of 17 to 25 characters, three-line rows at 61 px): 352 px, at 1280x800, 1440x900 and 1599x900. */
const BEFORE = 352;
/** What T2e removes from that offset on this fixture, written exactly as measured: 352 before, AFTER_OFFSET after, a
 *  saving of BUDGET px, not rounded down. It is the head's chrome (the wordmark and the doors row; the count line
 *  stays), the toggle (44 to 32) and the first group head (44 to 32). */
const AFTER_OFFSET = 223;
const BUDGET = BEFORE - AFTER_OFFSET;

describe('one head in the list column', () => {
  for (const theme of THEMES) {
    it(`at 1280x800 the first row starts ${BUDGET} px higher than on origin/main, no less (${theme})`, async () => {
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

/** Every open row's measures in the list column, taken in the page. A line is a cluster of text boxes whose vertical
 *  centres lie within 6 px of each other (the name's 15 px and the state word's 12 px share a line though their tops
 *  differ). A row's lines are the clusters of everything its body draws: the name, the state word and the context. */
async function measureRows(page: import('playwright-core').Page) {
  return page.evaluate(() => {
    // The vertical centres of the text boxes the elements draw: the text nodes only (a Range over an element also
    // returns the element's own box, whose centre sits between two wrapped lines), and not the screen-reader copy of a
    // name (`.sr-only`). A text node that is not drawn (the shortened form of a long name, `display: none`) has no box.
    const centres = (els: Element[]): number[] => {
      const out: number[] = [];
      for (const el of els) {
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n !== null; n = walk.nextNode()) {
          if ((n.textContent ?? '').trim() === '') continue;
          const p = n.parentElement!;
          if (p.closest('.sr-only') !== null) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          for (const rc of range.getClientRects()) if (rc.width > 0 && rc.height > 0) out.push(rc.top + rc.height / 2);
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
    const shown = (el: Element | null, row: DOMRect): boolean => {
      if (el === null || (el.textContent ?? '').trim() === '') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top >= row.top - 1 && r.bottom <= row.bottom + 1;
    };
    const mid = (el: Element): number => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
    return [...document.querySelectorAll<HTMLElement>('.shell-nav li.ins-row')].map((li) => {
      const box = li.getBoundingClientRect();
      const line = li.querySelector('.sess-line')!;
      const body = line.querySelector('.sess-body')!;
      const labels = [...li.querySelectorAll('.sess-open .sess-label')].filter((l) => l.getBoundingClientRect().width > 0);
      const nameLines = centres(labels);
      // The state cell: the state word and its marker (`needs you`), the first `.sess-meta`; the context is the second.
      const state = line.querySelector('.sess-meta:not(.sess-meta--context)');
      const stateLines = centres(state === null ? [] : [state]);
      return {
        id: li.getAttribute('data-row')!, height: box.height, lines: lineCount(centres([...body.children])),
        nameLines: lineCount(nameLines),
        // The state word shares the name's first line (the two centres lie within a line's tolerance).
        beside: stateLines.length > 0 && Math.abs((stateLines[0] ?? NaN) - (nameLines[0] ?? NaN)) <= 6,
        needsYou: (state?.textContent ?? '').includes('needs you'),
        name: shown(li.querySelector('.sess-open'), box), state: shown(state, box),
        context: shown(li.querySelector('.sess-meta--context'), box),
        asks: li.querySelector('.sess-ask, .sess-subagent-list') !== null,
        // The lamp's centre and the centre of the name's FIRST line, in px below the row's top.
        lamp: mid(line.firstElementChild!) - box.top, nameFirst: (nameLines[0] ?? NaN) - box.top,
      };
    });
  });
}

const NAMES = SESSIONS.map((s) => (s as { workspace: string | null }).workspace).filter((w): w is string => w !== null);

describe('dense rows under a fine pointer', () => {
  it('the fixture carries realistic names: 17 to 25 characters, like a fleet\'s workspace slugs', () => {
    expect(Math.min(...NAMES.map((n) => n.length))).toBeGreaterThanOrEqual(17);
    expect(Math.max(...NAMES.map((n) => n.length))).toBe(25);
  });

  for (const theme of THEMES) {
    for (const [width, column] of [[1280, 340], [1600, 420]] as const) {
      it(`at ${width} (the ${column} column) a row whose name and state fit on one line is two lines and at most 42 px, and every row is at most three lines and under 61 px (${theme})`, async () => {
        const { ctx, page } = await open(theme, width, 900, '/');
        try {
          const rows = await measureRows(page);
          expect(rows.length, 'open rows').toBeGreaterThanOrEqual(5);
          for (const r of rows) {
            expect(r.asks, `${r.id}: no ask`).toBe(false);
            expect(r.name, `${r.id}: name`).toBe(true);
            expect(r.state, `${r.id}: state word`).toBe(true);
            expect(r.context, `${r.id}: context`).toBe(r.id !== 'project-a'); // a main checkout has none
            // Every fact is drawn, at most as name, state, context: three lines, under the 61 px of main's rows.
            expect(r.lines, `${r.id}: lines`).toBeLessThanOrEqual(3);
            expect(r.height, `${r.id}: height`).toBeLessThan(61);
            if (r.nameLines === 1 && r.beside) {
              // The name and the state fit side by side: the name and state line, then the context (a main checkout
              // has none: one line).
              expect(r.lines, `${r.id}: lines`).toBe(r.id === 'project-a' ? 1 : 2);
              expect(r.height, `${r.id}: height`).toBeLessThanOrEqual(42);
            }
          }
          expect(rows.filter((r) => r.nameLines === 1 && r.beside).length, 'rows that fit').toBeGreaterThanOrEqual(5);
        } finally {
          await ctx.close();
        }
      });
    }

    it(`at 1280 the two needs-you rows, a long name beside "waiting · needs you", are exactly three lines: the name, the state, the context (${theme})`, async () => {
      const { ctx, page } = await open(theme, 1280, 800, '/');
      try {
        const rows = (await measureRows(page)).filter((r) => r.needsYou);
        expect(rows.map((r) => r.id).sort()).toEqual(['project-a-ask-routing-follow-up', 'project-a-project-a-review-wave-two']);
        for (const r of rows) {
          expect(r.lines, `${r.id}: lines`).toBe(3);
          expect(r.beside, `${r.id}: the state word has dropped to its own line`).toBe(false);
        }
      } finally {
        await ctx.close();
      }
    });

    it(`at 1600 every row but project-a-review-wave-two is two lines (one for the main checkout), and that row is three (${theme})`, async () => {
      const { ctx, page } = await open(theme, 1600, 900, '/');
      try {
        const rows = await measureRows(page);
        for (const r of rows) {
          const want = r.id === 'project-a-project-a-review-wave-two' ? 3 : r.id === 'project-a' ? 1 : 2;
          expect(r.lines, `${r.id}: lines`).toBe(want);
        }
      } finally {
        await ctx.close();
      }
    });

    it(`the lamp sits on the name's first line in every row: one, two and three lines (${theme})`, async () => {
      const { ctx, page } = await open(theme, 1280, 800, '/');
      try {
        const rows = await measureRows(page);
        // The comment in instrument.css says the lamp sits on the name's line; in a one-line row (no context fact) the
        // name is centred in the floor, so the lamp has to be too.
        expect(rows.find((r) => r.id === 'project-a')!.lines, 'the main checkout is one line').toBe(1);
        expect(new Set(rows.map((r) => r.lines)), 'one-, two- and three-line rows are all in the fixture').toEqual(new Set([1, 2, 3]));
        for (const r of rows) {
          expect(Math.abs(r.lamp - r.nameFirst), `${r.id}: lamp ${r.lamp} vs name ${r.nameFirst}`).toBeLessThanOrEqual(1);
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
          // The actions button is 32 px with a ::before hit overlay grown by a negative inset. The overlay is absolutely
          // positioned, so its inset is measured from the button's PADDING box (clientWidth/clientHeight: 30 px, the
          // 1px border excluded), and the hit area is that box grown by the inset on each side. The border box (32)
          // would read two pixels too generous, and fleet.css's documented naive inset (a 42 px target) would pass.
          const actions = [...document.querySelectorAll<HTMLElement>('.shell-nav .sess-actions')].map((el) => {
            const inset = parseFloat(getComputedStyle(el, '::before').top);
            return { w: Math.round(el.clientWidth - 2 * inset), h: Math.round(el.clientHeight - 2 * inset) };
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
