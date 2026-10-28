// Instrument's desk, measured in a real Chrome over the production build (W2 desk polish, Task T2e, D-6335; T2g, D-6715).
// The jsdom suites (test/instrument-shell.test.tsx, test/instrument-list.test.tsx) pin the rules that produce this
// geometry; this file holds the geometry: no empty fourth column (the reading column is 860 at 1600 and the detail
// reaches the viewport's edge), no head in the list column (T2e removed its chrome and T2g its count line; this fixture
// has no pool lag, so nothing else draws there and the first row starts higher), a status row of two lines and at most
// 42 px under a fine pointer when its name and state fit (every row at most three lines and under 61 px: the name,
// `waiting · needs you` and the context, when a long name and the state do not fit side by side; T3b, R21's F2 and
// D-7252: the state word then ends the context line instead, but only where the whole context fits beside it, which at
// 1600 makes project-a-review-wave-two two lines), which under a touch
// screen is the tap floor again, the status bar's count whole at 900 under both pointers, and the rail's Inbox count pill on
// its Inbox door's top-right corner.
//
// The fixture is 14 sessions across two projects, in every bucket (3 attention, 3 working, 3 done, 3 idle, 2 dead: nine
// open rows by default), with realistic workspace names of 17 to 25 characters, like a fleet's slugs, because a row's
// height is decided by the name beside the state word and a 4-character name hides every wrap. Two rows are main
// checkouts (no workspace, so no context fact): project-a's is a one-line row, and project-b's, which needs the
// operator, drops its state under a long branch name and is two. Fine pointer is the default context; touch is
// `openApp`'s `touch: true`.
//
// MUTATION TABLE (plan Task T2e Step 3 and fix round 1; RUN, this file alone, each mutant reverted):
//   the fourth track unconditional ..................... "at 1600 the session's reading column is 860 …"
//   a literal 32px floor outside (pointer: fine) ....... "under touch emulation, every row and control is at least 44 px"
//   fleet.css's `.sess-actions::before` inset without
//     the border's 2px (the 42 px hit area it documents)  "under touch emulation, every row and control is at least 44 px"
//                                                         (the hit area is the padding box, clientWidth, not the border box)
//   the lamp's alignment rule removed ................. "the lamp sits on the name's first line in every row …"
//   the dense body as the old grid (`grid-template-columns:
//     minmax(0, 1fr) fit-content(60%)`, context `grid-column: 1 / -1`)  "at 1280 (the 340 column) … every row is at most three lines and under 61 px"
//                                                         (`lines: expected 4 to be less than or equal to 3`), "…exactly three lines" (`expected 4 to be 3`)
//   the dense body `flex-flow: row nowrap` ............. the same cases (`lines: expected 4 to be 3`, `name: expected false to be true`)
// W2 desk polish, Task T2g (D-6715; plan Step 3, RUN, this file alone with -t "T2g", each mutant reverted):
//   `ListColumn` without `headCount={false}` ........... "at 1280x800 the first row starts 27 px higher than after T2e, no less"
//                                                         (`expected 223 to be less than or equal to 196`)
//   `FleetHead`'s nothing-to-draw `return null` removed  the same case (`expected 212 to be less than or equal to 196`: the empty head
//                                                         keeps its padding, and the column's gap beside it)
//   `.ins-status-summary { max-width: 6ch }` ........... "at 900 the status bar's count is whole, with two open runs" (both pointers;
//                                                         `expected 211 to be less than or equal to 40`)
// T2e review R32, F7 (carried into T2g; RUN with -t "Inbox count", each mutant reverted):
//   `.ins-rail-count` without `position: absolute` ..... "at 1280x800 the count pill sits on the Inbox door's top-right corner, inside the door"
//                                                         (`top inset 13.203125 vs --sp-1 4: expected 9.203125 to be less than or equal to 2`; both themes)
//   `.ins-rail-count` without `right: var(--sp-1)` ..... the same case (`right inset 16.203125 vs --sp-1 4: expected 12.203125 to be less than or equal to 2`)
// Desktop polish T3b (R21's F2, the operator's R121, D-7252; RUN, this file alone, each mutant restored from a saved
// copy with its sha256 checked):
//   the context's `width: max-content` removed (the
//     state word may narrow the context again) ....... the 1280 needs-you case, both themes (`the state word does not
//                                                         narrow the context: expected true to be false`)
//   the four state-on-context rules removed ........... the 1600 case, both themes (`lines: expected 3 to be 2`)
//   the state's `float: right` removed ................ the two dense-row cases and the 1600 case, both themes
//                                                         (`rows that fit: expected [ 'project-a' ] …`)
//   the name's `display: inline-flex` removed ......... the two dense-row cases, both themes (the same message)
// The plan's row 8 (Step 0's `flex: none` removed) does not apply: Step 0 found the count whole at 900 under both pointers, so
// T2g added no `flex: none`.
// The state's `flex: 0 0 auto` as `0 1 auto` + `min-width: 0` is NOT red here (a wrapped flex line is decided on max-content
// sizes before any shrinking, so the layout is identical): test/instrument-list.test.tsx's rule pin catches it.
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
  // A main checkout of a second project that needs the operator, with a long branch for its name (a main checkout's
  // label is its branch): no context fact, and the name and `waiting · needs you` do not fit side by side at 340, so
  // the row is two lines with no context.
  session('main', 'attention', 'idle', {
    id: 'project-b', project: 'project-b', workdir: '/w/project-b', workspace: null, name: null, branch: 'project-b-with-a-long-name',
  }),
];
const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false }] },
    '/api/runs': [], '/api/claims': [],
  },
  fleetFrames: [{ type: 'fleet', sessions: SESSIONS }],
};
// The same fleet with two open runs (T2g, D-6715): the status bar's count then reads "… · 2 runs", its longest form.
const RUNS = [1, 2].map((id) => ({
  id, program: 'programme-a', programTitle: 'Programme A', wave: 1, waveOf: 2, project: 'project-a', homeProject: null,
  state: 'working', closedAt: null,
}));
const WITH_RUNS: AppFixture = {
  api: { ...FIXTURE.api, '/api/runs': RUNS },
  fleetFrames: [{ type: 'fleet', sessions: SESSIONS }, { type: 'runs', runs: RUNS }],
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

async function open(theme: string, width: number, height: number, route: string, touch = false, fixture: AppFixture = FIXTURE) {
  const opened = await openApp(browser!, { skin: INSTRUMENT, theme, width, touch }, fixture);
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
/** What T2e removes from that offset on this fixture, written exactly as measured: 352 before, 223 after, a saving of
 *  129 px, not rounded down (AFTER_OFFSET and BUDGET below). It is the head's chrome (the wordmark and the doors row; the count line
 *  stays until T2g), the toggle (44 to 32) and the first group head (44 to 32). */
const AFTER_OFFSET = 223;
const BUDGET = BEFORE - AFTER_OFFSET;

describe("the rail's Inbox count (T2e review R32, F7)", () => {
  for (const theme of THEMES) {
    it(`at 1280x800 the count pill sits on the Inbox door's top-right corner, inside the door (${theme})`, async () => {
      const { ctx, page } = await open(theme, 1280, 800, '/');
      try {
        await page.waitForSelector('.ins-rail-count', { timeout: 20_000 });
        const m = await page.evaluate(() => {
          const door = document.querySelector('.ins-rail-item[aria-label="Inbox, 3 waiting for you"]')!;
          const pill = door.querySelector('.ins-rail-count')!;
          // `--sp-1` as the page resolves it: the width of a probe that takes the token.
          const probe = document.createElement('div');
          probe.style.cssText = 'position:absolute;visibility:hidden;width:var(--sp-1)';
          document.body.append(probe);
          const sp1 = probe.getBoundingClientRect().width;
          probe.remove();
          const d = door.getBoundingClientRect();
          const p = pill.getBoundingClientRect();
          return {
            sp1, pillText: pill.textContent,
            inside: { left: p.left - d.left, top: p.top - d.top, right: d.right - p.right, bottom: d.bottom - p.bottom },
          };
        });
        expect(m.pillText, 'the pill prints the count').toBe('3');
        expect(m.sp1, '--sp-1 resolves to a length').toBeGreaterThan(0);
        // Inside the door's box (a pixel of rounding).
        for (const [edge, gap] of Object.entries(m.inside)) expect(gap, `the pill's ${edge} edge is inside the door`).toBeGreaterThanOrEqual(-1);
        // On its top-right corner: the `--sp-1` inset from the right and the top edges, give or take the border and a pixel.
        expect(Math.abs(m.inside.right - m.sp1), `right inset ${m.inside.right} vs --sp-1 ${m.sp1}`).toBeLessThanOrEqual(2);
        expect(Math.abs(m.inside.top - m.sp1), `top inset ${m.inside.top} vs --sp-1 ${m.sp1}`).toBeLessThanOrEqual(2);
      } finally {
        await ctx.close();
      }
    });
  }
});

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

/** The first row's offset at 1280x800 on `/` after T2e (fd15dd7e0, Step 0 of T2g, both themes, a fine pointer), and what
 *  T2g removes from it: the head (15 px, the count line gone and no lag in this fixture, so no head at all) and the `.fleet` column's
 *  row gap beside it (12 px), written exactly as measured: 223 before, 27 saved. After the change the measured offset is
 *  196 px, exactly the budget (1280x800, both themes). */
const AFTER_T2E = 223;
const SAVING = 27;

describe('one count at the desk (T2g, D-6715)', () => {
  for (const theme of THEMES) {
    it(`at 1280x800 the first row starts ${SAVING} px higher than after T2e, no less (${theme})`, async () => {
      const { ctx, page } = await open(theme, 1280, 800, '/');
      try {
        const offset = await page.evaluate(() => {
          const nav = document.querySelector('.shell-nav')!.getBoundingClientRect();
          return Math.round(document.querySelector('.shell-nav .sess-line')!.getBoundingClientRect().top - nav.top);
        });
        expect(offset).toBeLessThanOrEqual(AFTER_T2E - SAVING);
      } finally {
        await ctx.close();
      }
    });
  }

  // Green at the base (Step 0 measured it whole there): a guard for the one count left, which must not be cut with an
  // ellipsis now that the column's copy is gone.
  for (const touch of [false, true]) {
    it(`at 900 the status bar's count is whole, with two open runs (${touch ? 'touch' : 'fine pointer'})`, async () => {
      const { ctx, page } = await open(PHOSPHOR, 900, 800, '/', touch, WITH_RUNS);
      try {
        await page.waitForFunction(() => (document.querySelector('.ins-status-summary')?.textContent ?? '').includes('run'),
          undefined, { timeout: 20_000 });
        const m = await page.evaluate(() => {
          const el = document.querySelector<HTMLElement>('.ins-status-summary')!;
          return { text: el.textContent ?? '', scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
        });
        expect(m.text).toContain('run');
        expect(m.scrollWidth, m.text).toBeLessThanOrEqual(m.clientWidth);
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
    // A clamped name or branch (D-6332's desk clamp) still has text boxes for its lines past the clamp, under the drawn
    // ones: only a centre inside the element's own box counts (T3b).
    const centres = (els: Element[]): number[] => {
      const out: number[] = [];
      for (const el of els) {
        const own = el.getBoundingClientRect();
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n !== null; n = walk.nextNode()) {
          if ((n.textContent ?? '').trim() === '') continue;
          const p = n.parentElement!;
          if (p.closest('.sr-only') !== null) continue;
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
      const contextEl = line.querySelector('.sess-meta--context');
      const contextLines = centres(contextEl === null ? [] : [contextEl]);
      return {
        id: li.getAttribute('data-row')!, height: box.height, lines: lineCount(centres([...body.children])),
        nameLines: lineCount(nameLines),
        // The state word shares the name's first line (the two centres lie within a line's tolerance).
        beside: stateLines.length > 0 && Math.abs((stateLines[0] ?? NaN) - (nameLines[0] ?? NaN)) <= 6,
        // The state word shares the context's first line (T3b, R21's F2): a row with a context draws it there.
        onContext: stateLines.length > 0 && Math.abs((stateLines[0] ?? NaN) - (contextLines[0] ?? NaN)) <= 6,
        contextLines: lineCount(contextLines),
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

/** The two main checkouts: no workspace, so no context fact. */
const MAIN_CHECKOUTS = ['project-a', 'project-b'];
const NAMES = SESSIONS.map((s) => (s as { workspace: string | null }).workspace).filter((w): w is string => w !== null);

describe('dense rows under a fine pointer', () => {
  it('the fixture carries realistic names: 17 to 25 characters, like a fleet\'s workspace slugs', () => {
    expect(Math.min(...NAMES.map((n) => n.length))).toBeGreaterThanOrEqual(17);
    expect(Math.max(...NAMES.map((n) => n.length))).toBe(25);
  });

  for (const theme of THEMES) {
    for (const [width, column] of [[1280, 340], [1600, 420]] as const) {
      it(`at ${width} (the ${column} column) a row whose name and state fit on one line is two lines and at most 42 px, the state word takes a line of its own only when neither the name's line nor the context's has room for it, and every row is at most three lines and under 61 px (${theme})`, async () => {
        const { ctx, page } = await open(theme, width, 900, '/');
        try {
          const rows = await measureRows(page);
          expect(rows.length, 'open rows').toBeGreaterThanOrEqual(5);
          for (const r of rows) {
            expect(r.asks, `${r.id}: no ask`).toBe(false);
            expect(r.name, `${r.id}: name`).toBe(true);
            expect(r.state, `${r.id}: state word`).toBe(true);
            expect(r.context, `${r.id}: context`).toBe(!MAIN_CHECKOUTS.includes(r.id)); // a main checkout has none
            // Every fact is drawn, at most as name, state, context: three lines, under the 61 px of main's rows.
            expect(r.lines, `${r.id}: lines`).toBeLessThanOrEqual(3);
            expect(r.height, `${r.id}: height`).toBeLessThan(61);
            if (r.nameLines === 1 && r.beside) {
              // The name and the state fit side by side: the name and state line, then the context (a main checkout
              // has none: one line).
              expect(r.lines, `${r.id}: lines`).toBe(r.id === 'project-a' ? 1 : 2);
              expect(r.height, `${r.id}: height`).toBeLessThanOrEqual(42);
            }
            if (r.context) {
              // T3b (D-7252): beside the name or ending the context line, the state word takes no line of its own; it
              // takes one only when neither line has room for it.
              const own = r.beside || r.onContext ? 0 : 1;
              expect(r.lines, `${r.id}: the name's lines, the context's, and the state's own only if it has no room`).toBe(r.nameLines + r.contextLines + own);
            }
          }
          // The rows that fit, exactly: at 340 neither needs-you row nor the second main checkout (a 26-character name
          // beside `waiting · needs you`); at 420 only project-a-review-wave-two and project-b do not.
          const fit = rows.filter((r) => r.nameLines === 1 && r.beside).map((r) => r.id).sort();
          const open = ['project-a', 'project-a-banner-quiet-line', 'project-a-desk-density-pass', 'project-a-gauge-window-words',
            'project-a-inspector-sections-tidy', 'project-a-transcript-search-rungs'];
          expect(fit, 'rows that fit').toEqual(width === 1280 ? open : [...open, 'project-a-ask-routing-follow-up'].sort());
        } finally {
          await ctx.close();
        }
      });
    }

    it(`at 1280 the two workspace needs-you rows, a long name beside "waiting · needs you", are exactly three lines: the name, the state, the context, whose branch would not fit whole beside the state; the second main checkout is the name and the state (${theme})`, async () => {
      const { ctx, page } = await open(theme, 1280, 800, '/');
      try {
        const rows = (await measureRows(page)).filter((r) => r.needsYou);
        expect(rows.map((r) => r.id).sort()).toEqual(['project-a-ask-routing-follow-up', 'project-a-project-a-review-wave-two', 'project-b']);
        for (const r of rows) {
          expect(r.lines, `${r.id}: lines`).toBe(r.id === 'project-b' ? 2 : 3);
          expect(r.beside, `${r.id}: the state word has dropped to its own line`).toBe(false);
          // T3b (D-7252): the state word ends the context line only where the whole context fits beside it, and a
          // `ws/<name>` branch of 24 to 28 characters does not, beside `waiting · needs you` in the 340 column.
          if (r.id !== 'project-b') expect(r.onContext, `${r.id}: the state word does not narrow the context`).toBe(false);
        }
      } finally {
        await ctx.close();
      }
    });

    it(`at 1600 every row is two lines (one for the main checkout project-a), project-a-review-wave-two included, its state word on the context line (${theme})`, async () => {
      const { ctx, page } = await open(theme, 1600, 900, '/');
      try {
        const rows = await measureRows(page);
        for (const r of rows) {
          // T3b (R21's F2, D-7252): the needs-you row whose name and state do not fit side by side has a branch that
          // fits whole beside `waiting · needs you` in the 420 column, so the state word ends the context line, and the
          // row is two lines, not three.
          expect(r.lines, `${r.id}: lines`).toBe(r.id === 'project-a' ? 1 : 2);
          if (r.id === 'project-a-project-a-review-wave-two') expect(r.onContext, `${r.id}: the state word is on the context line`).toBe(true);
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
        // name is centred in the floor, so the lamp has to be too; in the second main checkout the state has dropped to a
        // second line with no context, and the lamp stays on the first.
        expect(rows.find((r) => r.id === 'project-a')!.lines, 'the main checkout is one line').toBe(1);
        expect(rows.find((r) => r.id === 'project-b')!.lines, 'the second main checkout is two lines, no context').toBe(2);
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
