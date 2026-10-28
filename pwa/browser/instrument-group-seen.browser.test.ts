// Mark all seen beside a status group's head, measured in a real Chrome over the production build (desktop polish T3a,
// D-6331). The jsdom suites (test/instrument-list.test.tsx, test/instrument-shell.test.tsx) pin the markup and the rules
// that produce this geometry; this file holds the geometry itself, which jsdom cannot lay out:
//
//  1. At 1280 and 1920 under a fine pointer, in Phosphor & Ink (dark) and Phosphor Daylight (light): the wrapper that
//     holds a BADGED head and its Mark all seen button is exactly as tall as an unbadged group head, so a badge adds no
//     height to the list (`.ins-group-seen` takes `--row-h` with the heads in the dense desk block). The button sits on
//     the head's row, not below it, and it is a sibling of the fold row, never inside it (the row is itself a button).
//  2. At 360 and 390 (touch, as `openApp` gives below 900): the button's word is one line, keeps the 44 px tap floor, and
//     the document does not scroll sideways: the fold row takes the squeeze, never the door's word (`shrink-0`).
//
// The fixture is project-a with a Needs-you row, three unseen Done rows (a real `bucketSince`, and no ack stored, so
// every Done row is past it), a Working row and an Idle row (a folded group). Status mode is the default.
//
// MUTATION TABLE (RUN, this file alone, each mutant reverted from a saved copy):
//   `.ins-group-seen,` removed from instrument.css's dense desk rule ... case 1, all four
//                                                         (`expected 44 to be close to 32`: the ghost Button's tap floor is back)
//   `shrink-0` removed from the button ................................ case 2, all four
//                                                         (`the word's lines: expected 2 to be 1`: the fold row's width wins the squeeze)
//   the button given `w-0` (a door that cannot hold its word) ......... case 1 (`expected 41 to be close to 32`) and case 2
//                                                         (`expected 3 to be 1`), all eight
//   `size="fit"` removed (the Button's default full width) ............ all eight: `expected 156.1875 to be close to 32` at a desk and
//                                                         `the fold row's width: expected 0 to be greater than 164` on a phone
//                                                         (the fold row had no width and its count and badge stacked)
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts --maxWorkers=1 browser/instrument-group-seen.browser.test.ts )`.
// Chrome comes from `resolveChrome()` in `beforeAll`, which THROWS when none is found: a red leg, never a skipped one.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type DistServer } from './app';
import { fleetSession } from '../test/fleetFixture';

const THEMES = [PHOSPHOR, 'light'] as const;
const DESK_WIDTHS = [1280, 1920] as const;
const PHONE_WIDTHS = [360, 390] as const;

/** The tap floor, in px (`min-h-tap`). */
const TAP = 44;

/** A real watermark: `bucketSince` is the fleet host's clock, and no ack is stored, so a badged row is unseen. */
const SINCE = 1_800_000_000_000;

const row = (ws: string, bucket: string, status: string, n: number) => fleetSession({
  id: `project-a-${ws}`, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: `/w/project-a/${ws}`,
  workspace: ws, name: ws, branch: `ws/${ws}`, status: status as 'idle', ctxPct: 40,
  bucket: bucket as 'idle', bucketSince: SINCE + n,
});
const SESSIONS = [
  row('review-wave-two', 'attention', 'idle', 1),
  row('desk-density-pass', 'working', 'busy', 2),
  row('inspector-sections-tidy', 'done', 'idle', 3),
  row('banner-quiet-line', 'done', 'idle', 4),
  row('transcript-search-rungs', 'done', 'idle', 5),
  row('pool-tag-cleanup-run', 'idle', 'idle', 6),
];
const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false }] },
    '/api/runs': [], '/api/claims': [],
  },
  fleetFrames: [{ type: 'fleet', sessions: SESSIONS }],
};

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

async function open(theme: string, width: number, touch: boolean) {
  const opened = await openApp(browser!, { skin: INSTRUMENT, theme, width, touch }, FIXTURE);
  await opened.page.goto(server!.origin + '/');
  await opened.page.waitForSelector('.ins-group-seen', { timeout: 20_000 });
  await opened.page.waitForTimeout(600); // the first paint's transitions and the fleet frame settle
  return opened;
}

describe('a badged status group head keeps the height of an unbadged one (fine pointer, at a desk)', () => {
  for (const theme of THEMES) {
    for (const width of DESK_WIDTHS) {
      it(`${width}px, ${theme}: the head and its Mark all seen are one row, as tall as an unbadged head, and the button is no descendant of the fold row`, async () => {
        const { ctx, page, errors } = await open(theme, width, false);
        try {
          const m = await page.evaluate(() => {
            const rect = (el: Element) => {
              const r = el.getBoundingClientRect();
              return { top: r.top, bottom: r.bottom, height: r.height };
            };
            return [...document.querySelectorAll<HTMLElement>('[data-status-group]')].map((section) => {
              const wrapper = section.firstElementChild!;
              const head = wrapper.querySelector('.ins-group-head');
              const door = wrapper.querySelector('.ins-group-seen');
              return {
                group: section.dataset['statusGroup']!,
                wrapper: rect(wrapper),
                head: head === null ? null : rect(head),
                door: door === null ? null : rect(door),
                doorInsideHead: door !== null && head !== null && head.contains(door),
                doorUnderHead: door !== null && door.closest('.ins-group-head') !== null,
                doorIsSibling: door !== null && head !== null && door.parentElement === head.parentElement,
              };
            });
          });
          const badged = m.filter((g) => g.door !== null);
          const plain = m.filter((g) => g.door === null);
          // The fixture holds both kinds: Needs you and Done are badged; Working and Idle (a folded group) are not.
          expect(badged.map((g) => g.group).sort(), 'badged groups').toEqual(['attention', 'done']);
          expect(plain.map((g) => g.group).sort(), 'unbadged groups').toEqual(['idle', 'working']);
          const floor = plain[0]!.wrapper.height;
          for (const g of plain) expect(g.wrapper.height, `${g.group} wrapper`).toBe(floor);
          for (const g of badged) {
            expect(g.wrapper.height, `${g.group}: the badged wrapper against an unbadged head`).toBeCloseTo(floor, 2);
            expect(g.head!.height, `${g.group}: the fold row`).toBeCloseTo(floor, 2);
            expect(g.door!.height, `${g.group}: the button`).toBeLessThanOrEqual(floor + 0.01);
            // On the head's row, not below it: the button's box sits inside the head's vertical extent.
            expect(g.door!.top, `${g.group}: the button starts on the head's row`).toBeGreaterThanOrEqual(g.head!.top - 0.5);
            expect(g.door!.bottom, `${g.group}: the button ends on the head's row`).toBeLessThanOrEqual(g.head!.bottom + 0.5);
            expect(g.doorInsideHead, `${g.group}: the button inside the fold row`).toBe(false);
            expect(g.doorUnderHead, `${g.group}: the button under .ins-group-head`).toBe(false);
            expect(g.doorIsSibling, `${g.group}: the button is the fold row's sibling`).toBe(true);
          }
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      });
    }
  }
});

describe('on a phone, Mark all seen keeps its word on one line and the tap floor', () => {
  for (const theme of THEMES) {
    for (const width of PHONE_WIDTHS) {
      it(`${width}px, ${theme} (touch): one line, at least ${TAP} px tall, and the page does not scroll sideways`, async () => {
        const { ctx, page, errors } = await open(theme, width, true);
        try {
          const m = await page.evaluate(() => {
            const doors = [...document.querySelectorAll<HTMLElement>('.ins-group-seen')];
            return {
              doors: doors.map((door) => {
                // The lines the word's text is laid on: the distinct tops of its client rects.
                const range = document.createRange();
                range.selectNodeContents(door);
                const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
                const r = door.getBoundingClientRect();
                const cs = getComputedStyle(door);
                const head = door.parentElement!.querySelector('.ins-group-head')!.getBoundingClientRect();
                const wrapper = door.parentElement!.getBoundingClientRect();
                return {
                  label: door.getAttribute('aria-label'), text: door.textContent, lines: tops.size, height: r.height,
                  left: r.left, right: r.right, headRight: head.right, headHeight: head.height, headWidth: head.width,
                  wrapperWidth: wrapper.width,
                  lineBoxPlusPadding: parseFloat(cs.lineHeight) + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
                    + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth),
                };
              }),
              innerWidth: window.innerWidth,
              sideScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            };
          });
          expect(m.doors.map((d) => d.label).sort(), 'the doors on the page').toEqual(['Mark all seen, Done', 'Mark all seen, Needs you']);
          for (const d of m.doors) {
            expect(d.text, d.label ?? '').toBe('Mark all seen');
            expect(d.lines, `${d.label}: the word's lines`).toBe(1);
            expect(d.height, `${d.label}: the tap floor`).toBeGreaterThanOrEqual(TAP - 0.5);
            // One line: no taller than the floor, or than one line box with its padding when that is more.
            expect(d.height, `${d.label}: one line high`).toBeLessThanOrEqual(Math.max(TAP, d.lineBoxPlusPadding) + 0.5);
            // The fold row keeps a row of its own beside the door: the door is sized to its word (`size="fit"`), so the
            // row is not squeezed to nothing and does not wrap its count and badge onto more lines.
            expect(d.headWidth, `${d.label}: the fold row's width`).toBeGreaterThan(d.wrapperWidth / 2);
            expect(d.headHeight, `${d.label}: the fold row is one line`).toBeLessThanOrEqual(TAP + 0.5);
            expect(d.right, `${d.label}: inside the viewport`).toBeLessThanOrEqual(m.innerWidth + 0.5);
            expect(d.left, `${d.label}: after the fold row's start`).toBeGreaterThanOrEqual(d.headRight - 0.5);
          }
          expect(m.sideScroll, 'the page scrolls sideways').toBeLessThanOrEqual(0);
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      });
    }
  }
});
