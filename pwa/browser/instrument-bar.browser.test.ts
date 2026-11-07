// Instrument's desk top bar, measured in a real Chrome over the production build (W2 Task S9, D-5472; desk-nav Task A, D-8100,
// which moved the rail's doors into the bar and renamed this file from `instrument-rail`). The jsdom suite
// (test/instrument-shell.test.tsx) pins the rules and the markup that produce this geometry; this file holds the geometry.
//
// The plan's Step 4: with Waiting on you, Inbox and Runs each printing "99+" and seventeen lanes under the line, the bar
// stays one line at 900, 930, 1100, 1279, 1280 and 1920 (review 1638 A4), by mouse and by touch, nothing in it is cut, and neither it nor the page scrolls
// sideways (each case prints a DESK-NAV-FIGURE line); the doors show their words from 1280 and their tips below that; a
// door's tip is drawn below its icon, centred, opaque, clipped by nothing and on top of the lanes row it lies over, by hover
// and by Tab, the widest (Waiting on you at a count of 1200) and the last (Settings) inside the window (review 1638 F1, A1,
// A4); the current door's underline is 2px of the accent on its bottom edge; and under a coarse pointer every control in the
// bar keeps 44 px, at 900 and 1280.
// Phosphor and light, Instrument.
//
// Chrome comes from `resolveChrome()` in `beforeAll`, which THROWS when neither `CCRC_CHROME` nor
// `/usr/bin/google-chrome` is an executable file: a box without Chrome gives a red leg, never a skipped one.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, seedStripExpanded, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';
import { fleetSession } from '../test/fleetFixture';
import { seventeenLanes } from '../test/seventeenLanes';

const THEMES = [PHOSPHOR, 'light'] as const;
const viewName = (v: AppView): string => `${v.theme}, ${v.width}px, ${v.touch === true ? 'touch' : 'mouse'}`;

const nowSec = Math.floor(Date.now() / 1000);
const item = (id: number): object => ({
  id, program: 'p', runId: null, kind: 'do', title: `Item ${id} title`, why: 'Why.', how: ['Do it.'], options: null,
  neededBy: 'later', soonLabel: null, state: 'open', stale: false, raisedAt: nowSec * 1000 - 60_000, tickedAt: null, closedAt: null,
  answer: null, note: null, secretSlot: null, secretSet: null, history: [{ at: nowSec * 1000 - 60_000, act: 'raise', note: null }],
});
/** Every badge at its widest print, "99+": a hundred open items, a hundred sessions asking, and a hundred runs whose
 *  coordinator is one of them (refined-bar.browser.test.ts's shape, at three digits). */
const LANES = seventeenLanes(nowSec);
/** The fixture with `items` open items: 100 makes Waiting on you print "99+" with the hundred asking sessions (200 in its
 *  name); 1100 makes its count 1200, the widest name the clamp case reads (review 1638 A1). */
function fixtureWith(items: number): AppFixture {
  const waiting = { items: Array.from({ length: items }, (_, i) => item(i + 1)), cleared: [], goals: [] };
  return {
    api: {
      '/api/waiting': { ok: true, waiting },
      '/api/accounts': { accounts: LANES.accounts, projected: null, roster: LANES.roster },
      '/api/claims': [],
    },
    fleetFrames: [
      { type: 'waiting', waiting },
      { type: 'fleet', sessions: Array.from({ length: 100 }, (_, i) => fleetSession({ id: `s${i}`, project: `proj-${i % 3}`, bucket: 'attention' })) },
      {
        type: 'runs',
        runs: Array.from({ length: 100 }, (_, i) => ({
          id: i + 1, program: 'p', programTitle: 'P', wave: 1, waveOf: 1, project: 'x', homeProject: null, state: 'working', closedAt: null,
          sessionId: 's0', claimedBy: 's0',
        })),
      },
    ],
  };
}
const FIXTURE = fixtureWith(100);

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

/** Open Instrument at `view` on `route`, with every lane's card under the line, once the three badges print "99+". */
async function open(view: AppView, route: string, fixture: AppFixture = FIXTURE): Promise<Awaited<ReturnType<typeof openApp>>> {
  const opened = await openApp(browser!, view, fixture);
  await seedStripExpanded(opened.ctx);
  await opened.page.goto(server!.origin + route);
  await opened.page.waitForFunction(() => document.querySelectorAll('header.shell-accounts .account-gauge').length === 17
    && ['Waiting on you, ', 'Inbox, ', 'Runs, '].every((w) => document
      .querySelector(`nav.ins-doors .ins-door[aria-label^="${w}"] .ins-door-count`)?.textContent === '99+'), undefined, { timeout: 20_000 });
  await opened.page.waitForTimeout(300); // the first paint's transitions settle
  return opened;
}

describe('the bar fits on one line with every badge at 99+', () => {
  for (const touch of [false, true]) {
    for (const theme of THEMES) {
      for (const width of [900, 930, 1100, 1279, 1280, 1920]) {
        const view: AppView = { skin: INSTRUMENT, theme, width, touch };
        it(viewName(view), async () => {
          const { ctx, page, errors } = await open(view, '/');
          try {
            const m = await page.evaluate(() => {
              const bar = document.querySelector<HTMLElement>('.ins-topbar')!;
              const b = bar.getBoundingClientRect();
              const tops = [...bar.children].map((c) => Math.round(c.getBoundingClientRect().top));
              const parts: [string, Element | null][] = [
                ...[...bar.querySelectorAll('nav.ins-doors > .ins-door')].map((d): [string, Element] => [d.getAttribute('aria-label')!, d]),
                ['⌘K', bar.querySelector('.ins-command > :last-child')],
                ['bell', bar.querySelector('.ins-bar-doors > .bell')],
                ['Settings', bar.querySelector('.ins-bar-doors > .ins-door')],
                ['+', bar.querySelector('.ins-new')],
              ];
              const outside = parts.filter(([, el]) => {
                if (el === null) return true;
                const r = el.getBoundingClientRect();
                return r.width === 0 || r.left < b.left - 0.5 || r.right > b.right + 0.5 || r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5;
              }).map(([n]) => n);
              const doors = document.querySelector('nav.ins-doors')!.getBoundingClientRect();
              const field = bar.querySelector('.ins-command')!.getBoundingClientRect();
              return {
                tops, outside, doorCount: parts.length - 4,
                barScroll: bar.scrollWidth - bar.clientWidth,
                pageScroll: document.documentElement.scrollWidth - window.innerWidth,
                figure: { bar: Math.round(b.width), doors: Math.round(doors.width), field: Math.round(field.width) },
              };
            });
            console.log(`DESK-NAV-FIGURE ${viewName(view)}: bar ${m.figure.bar} px, doors ${m.figure.doors} px, command field ${m.figure.field} px`);
            expect(m.doorCount, 'the wordmark door and six doors are measured').toBe(7);
            for (const t of m.tops) expect(Math.abs(t - m.tops[0]!), `one line: tops ${m.tops.join(', ')}`).toBeLessThanOrEqual(1);
            expect(m.outside, 'every door, ⌘K, the bell, Settings and + inside the bar').toEqual([]);
            expect(m.barScroll, 'the bar does not scroll sideways').toBeLessThanOrEqual(0);
            expect(m.pageScroll, 'the page does not scroll sideways').toBeLessThanOrEqual(0);
            expect(errors).toEqual([]);
          } finally {
            await ctx.close();
          }
        }, 60_000);
      }
    }
  }
});

describe('the doors show words from 1280', () => {
  for (const width of [900, 1279, 1280, 1920]) {
    it(`${width}px`, async () => {
      const { ctx, page } = await open({ skin: INSTRUMENT, theme: PHOSPHOR, width }, '/');
      try {
        const m = await page.evaluate(() => {
          const doors = [...document.querySelectorAll<HTMLElement>('nav.ins-doors > .ins-door:not(.ins-home)')];
          const shown = (el: Element | null): boolean => el !== null && el.getBoundingClientRect().width > 0
            && getComputedStyle(el).visibility === 'visible';
          return {
            doors: doors.length,
            words: doors.filter((d) => shown(d.querySelector('.ins-door-word'))).length,
            tips: doors.filter((d) => d.querySelector('.ins-door-tip') !== null).length,
          };
        });
        expect(m.doors).toBe(6);
        expect(m.words, 'doors showing their word').toBe(width >= 1280 ? 6 : 0);
        expect(m.tips, 'doors with a tip').toBe(width >= 1280 ? 0 : 6);
      } finally {
        await ctx.close();
      }
    }, 60_000);
  }
});

interface TipFit {
  readonly opacity: number;
  /** What is drawn at the tip's centre: `tip` when the tip (or a child) is on top, else the element that covers it. The
   *  tip takes no pointer events, so the probe turns them on for the one read (review 1638 F1). */
  readonly onTop: string;
  /** Whether a lane card lies under that point: the tip is drawn over the lanes row, not beside it. */
  readonly overLanes: boolean;
  /** Clipping ancestors (any overflow but visible) whose box does not hold the whole tip. */
  readonly clippedBy: string[];
  readonly inViewport: boolean;
  /** The tip's top less the door's bottom (>= 0 is below it), and its centre less the door's. */
  readonly below: number;
  readonly offCentre: number;
}

/** Measure the tip of the bar door whose name starts with `name`, once its transition has settled. */
async function measureTip(page: Page, name: string): Promise<TipFit> {
  await page.waitForTimeout(300);
  return page.evaluate((n) => {
    const door = document.querySelector<HTMLElement>(`header.shell-accounts .ins-door[aria-label^="${n}"]`)!;
    const tip = door.querySelector<HTMLElement>('.ins-door-tip')!;
    const t = tip.getBoundingClientRect();
    const d = door.getBoundingClientRect();
    const cx = t.left + t.width / 2;
    const cy = t.top + t.height / 2;
    tip.style.pointerEvents = 'auto';
    const hit = document.elementFromPoint(cx, cy);
    const under = document.elementsFromPoint(cx, cy);
    tip.style.pointerEvents = '';
    const onTop = hit !== null && (hit === tip || tip.contains(hit))
      ? 'tip' : `${hit?.tagName.toLowerCase()}.${[...(hit?.classList ?? [])].join('.')}`;
    const clippedBy: string[] = [];
    for (let el = tip.parentElement; el !== null && el !== document.documentElement; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const r = el.getBoundingClientRect();
      if (t.left < r.left || t.right > r.right || t.top < r.top || t.bottom > r.bottom) {
        clippedBy.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`);
      }
    }
    return {
      opacity: parseFloat(getComputedStyle(tip).opacity),
      onTop,
      overLanes: under.some((el) => el.closest('.accounts-strip') !== null),
      clippedBy,
      inViewport: t.left >= 0 && t.top >= 0 && t.right <= window.innerWidth && t.bottom <= window.innerHeight && t.width > 0,
      below: t.top - d.bottom,
      offCentre: (t.left + t.width / 2) - (d.left + d.width / 2),
    };
  }, name);
}

describe('the tip is drawn below the icon, by hover and by Tab', () => {
  for (const theme of THEMES) {
    for (const width of [900, 1279]) {
      for (const route of ['/', '/runs']) {
        it(`${theme}, ${width}px, ${route}`, async () => {
          const { ctx, page, errors } = await open({ skin: INSTRUMENT, theme, width }, route);
          try {
            // Hover.
            await page.hover('nav.ins-doors .ins-door[aria-label^="Runs"]');
            const hovered = await measureTip(page, 'Runs');
            expect(hovered.opacity, 'hover: opacity').toBe(1);
            expect(hovered.clippedBy, 'hover: clipped by').toEqual([]);
            expect(hovered.onTop, 'hover: the tip is drawn on top').toBe('tip');
            expect(hovered.overLanes, 'hover: over the lanes row').toBe(true);
            expect(hovered.inViewport, 'hover: in the viewport').toBe(true);
            expect(hovered.below, 'hover: below the door').toBeGreaterThanOrEqual(0);
            expect(Math.abs(hovered.offCentre), 'hover: centred on the door').toBeLessThanOrEqual(2);
            await page.mouse.move(width - 10, 700);

            // Tab, from the top of the page, until the Accounts door has the focus.
            await page.locator('body').click({ position: { x: width - 10, y: 700 } });
            let reached = false;
            for (let i = 0; i < 40 && !reached; i += 1) {
              await page.keyboard.press('Tab');
              reached = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Accounts'
                && document.activeElement.matches('.ins-door:focus-visible'));
            }
            expect(reached, 'Tab reaches the Accounts door').toBe(true);
            const tabbed = await measureTip(page, 'Accounts');
            expect(tabbed.opacity, 'Tab: opacity').toBe(1);
            expect(tabbed.clippedBy, 'Tab: clipped by').toEqual([]);
            expect(tabbed.onTop, 'Tab: the tip is drawn on top').toBe('tip');
            expect(tabbed.overLanes, 'Tab: over the lanes row').toBe(true);
            expect(tabbed.inViewport, 'Tab: in the viewport').toBe(true);
            expect(tabbed.below, 'Tab: below the door').toBeGreaterThanOrEqual(0);
            expect(Math.abs(tabbed.offCentre), 'Tab: centred on the door').toBeLessThanOrEqual(2);
            expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
            expect(errors).toEqual([]);
          } finally {
            await ctx.close();
          }
        }, 60_000);
      }
    }
  }
});

describe('the widest tips, by hover: Waiting on you and Settings (review 1638 A1, A4)', () => {
  for (const theme of THEMES) {
    for (const width of [900, 1279]) {
      for (const [door, items] of [['Waiting on you', 1100], ['Settings', 100]] as const) {
        it(`${theme}, ${width}px, ${door}${door === 'Waiting on you' ? ', its count at 1200' : ''}`, async () => {
          const { ctx, page, errors } = await open({ skin: INSTRUMENT, theme, width }, '/', fixtureWith(items));
          try {
            if (door === 'Waiting on you') {
              await page.waitForSelector('nav.ins-doors .ins-door[aria-label="Waiting on you, 1200 waiting on you"]', { timeout: 20_000 });
            }
            await page.hover(`header.shell-accounts .ins-door[aria-label^="${door}"]`);
            const fit = await measureTip(page, door);
            expect(fit.opacity, 'opacity').toBe(1);
            expect(fit.inViewport, 'inside the window').toBe(true);
            expect(fit.clippedBy, 'clipped by').toEqual([]);
            expect(fit.onTop, 'drawn on top').toBe('tip');
            expect(fit.below, 'below the door').toBeGreaterThanOrEqual(0);
            expect(Math.abs(fit.offCentre), 'centred on the door').toBeLessThanOrEqual(2);
            expect(errors).toEqual([]);
          } finally {
            await ctx.close();
          }
        }, 60_000);
      }
    }
  }
});

describe("the current door's underline", () => {
  for (const theme of THEMES) {
    for (const [route, door] of [['/runs', 'Runs'], ['/', 'ccrc, Fleet']] as const) {
      it(`${theme}, 1280px, ${route}: 2px of the accent on ${door}'s bottom edge`, async () => {
        const { ctx, page } = await open({ skin: INSTRUMENT, theme, width: 1280 }, route);
        try {
          const m = await page.evaluate((name) => {
            const el = document.querySelector<HTMLElement>(`header.shell-accounts .ins-door[aria-label^="${name}"]`)!;
            const after = getComputedStyle(el, '::after');
            const probe = document.createElement('div');
            probe.style.cssText = 'position:absolute;visibility:hidden;background:var(--accent)';
            document.body.append(probe);
            const accent = getComputedStyle(probe).backgroundColor;
            probe.remove();
            const current = [...document.querySelectorAll('header.shell-accounts [aria-current="page"]')].map((c) => c.getAttribute('aria-label'));
            return {
              current, content: after.content, height: after.height, background: after.backgroundColor, accent,
              bottom: parseFloat(after.bottom), position: after.position,
            };
          }, door);
          expect(m.current, 'the one current door').toHaveLength(1);
          expect(m.current[0]!.startsWith(door), m.current[0]!).toBe(true);
          expect(m.content, 'the underline is drawn').not.toBe('none');
          expect(m.position).toBe('absolute');
          expect(m.height).toBe('2px');
          expect(m.background, 'the accent').toBe(m.accent);
          expect(Math.abs(m.bottom), "on the door's bottom edge").toBeLessThanOrEqual(1);
        } finally {
          await ctx.close();
        }
      }, 60_000);
    }
  }
});

describe('a touch screen keeps the floor', () => {
  for (const [theme, width] of THEMES.flatMap((t) => [900, 1280].map((w) => [t, w] as const))) {
    it(`at ${width} under a coarse pointer every bar control is at least 44 x 44 (${theme})`, async () => {
      const { ctx, page } = await open({ skin: INSTRUMENT, theme, width, touch: true }, '/');
      try {
        const m = await page.evaluate(() => {
          const controls = [...document.querySelectorAll<HTMLElement>('.ins-topbar button')];
          return {
            coarse: matchMedia('(pointer: coarse)').matches,
            bell: document.querySelector('.ins-topbar .bell') !== null,
            count: controls.length,
            small: controls.map((c) => [c.getAttribute('aria-label') ?? c.textContent, c.getBoundingClientRect()] as const)
              .filter(([, r]) => r.width < 44 - 0.5 || r.height < 44 - 0.5)
              .map(([n, r]) => `${n}: ${r.width} x ${r.height}`),
          };
        });
        expect(m.coarse, 'the coarse pointer is emulated').toBe(true);
        expect(m.bell, 'the bell is in the bar').toBe(true);
        // The wordmark door, six doors, the command field, the bell, Settings and +.
        expect(m.count, 'controls measured').toBe(11);
        expect(m.small).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 60_000);
  }
});
