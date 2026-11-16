// Getting around on a phone (desktop-polish PL10, D-7952; spec 2026-10-31 §2, D25; §9 "Getting around on a phone"), in a real
// Chrome over the production build, in both skins.
//
// At 360 and 390 the bottom bar of the console's places shows on the combined list, the item view, the programme view, Docs,
// Settings and the fleet: fixed to the bottom of the viewport, seven doors in one row (the places, fleet first, then Search),
// every door at least 44 x 44 inside the viewport, its word whole, no sideways scroll, the page's last line clear of it and the
// fleet's `+ New` above it. In an open session there is none. At 900 and 1280 there is none either. On a long item at a phone
// width the strip with the way back, Previous and Next stays in view after a scroll to the end, above the bar.
//
// MUTATION TABLE (RUN, each mutant on the working tree, this file alone unless named, then restored from a saved copy, sha256
// equal before and after; desktop-polish PL10):
//   B1 `.shell-phone-nav` without `position: fixed` ........... "at 360/390: the bar is fixed to the foot …" (both skins)
//   B2 `.phone-bar-door` 36px tall, no `min-height` ........... the same four cases (a door under 44)
//   B3 the shell's `--safe-bottom` lift removed ............... "at 360/390: on the fleet, + New sits above the bar" (both skins)
//   B4 `.wi-nav` without `position: sticky` ................... "at 360/390: previous and next stay in view on a long item …"
//   B5 the detail view's bottom padding removed ............... "at 360/390: the bar is fixed to the foot …" (the last line under it)
//   B7 `.phone-bar-count` at `top: 0` (refined-phone.browser) . every case of the two header-and-bar describes (badge over glyph)
// The width gate and the session gate are jsdom's (`test/phone-bar.test.tsx`, P1 and P2), since the frame mounts by script.
import { appendFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer } from './app';
import { withRunBinding } from '../test/runBindingFixture';

const NOW = Date.now();
const MIN = 60_000;

const session = (id: string, role: string): object => ({
  id, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: `/w/project-a/${id}`,
  workspace: id, name: id, status: 'idle', statusUpdatedAt: NOW - MIN, limits: null, dialogPending: false, version: null,
  model: null, effort: null, ultracode: false, branch: `ws/${id}`, ctxPct: 40, paneCols: null, tasks: null, pr: null,
  archivedAt: null, archivedBytes: null, held: null, hookState: null, askSummary: null, subagents: null, background: null,
  withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket: 'idle', bucketSince: NOW - 6 * MIN, unmeasured: [],
  started: true, child: { kind: 'none' }, role,
});
const run = (id: number, program: string, title: string, claimedBy: string, sessionId: string): object => ({
  id, program, programTitle: title, wave: 2, waveOf: 5, project: 'project-a', homeProject: 'project-a', sessionId,
  workspace: sessionId, branch: `ws/${sessionId}`, state: 'working', kind: 'work', reviews: null, claimedBy, resumed: false,
  clearedAt: null, openedAt: NOW - 3_600_000, dispatchStartedAt: null, dispatchedAt: NOW - 3_000_000, closedAt: null,
  handoffCommit: null, items: { done: 0, total: 0 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: false,
    clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, reviewCap: null, hadChild: false,
});
const SESSIONS = [session('prog-a-coord', 'coordinator'), session('prog-a-w1', 'child')];
const RUNS = [run(100, 'prog-a', 'Programme A', 'prog-a-coord', 'prog-a-w1')];
const LONG = 'The smaller change lands today and keeps the review queue short. '.repeat(60).trim();
const item = (id: number, over: object): object => ({
  id, program: 'prog-a', runId: null, kind: 'do', title: `Item ${id} title`, why: 'Why this is needed.', how: ['Open Settings.'],
  options: null, recommended: null, recommendedWhy: null, neededBy: 'soon', soonLabel: null, state: 'open', stale: false,
  raisedAt: NOW - 20 * MIN, tickedAt: null, closedAt: null, answer: null, note: null, secretSlot: null, secretSet: null,
  history: [{ at: NOW - 20 * MIN, act: 'raise', note: null }], ...over,
});
const ITEMS = [item(1, { why: LONG, how: [LONG, LONG] }), item(2, {}), item(3, {})];
const GOALS = { program: 'prog-a', specPath: 'docs/superpowers/specs/2026-10-31-a-design.md', inShort: 'In short.', inShortAt: NOW, modifications: [] };
const FIXTURE: AppFixture = (() => {
  const waiting = { items: ITEMS, cleared: [], goals: [GOALS] };
  return {
    api: {
      '/api/accounts': { accounts: [], projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false }] },
      '/api/runs': RUNS, '/api/claims': [], '/api/waiting': { ok: true, waiting },
      '/api/programmes/prog-a/goals': { ok: true, goals: GOALS },
    },
    fleetFrames: [
      { type: 'fleet', sessions: withRunBinding(SESSIONS as never[], RUNS as never[]) }, { type: 'runs', runs: RUNS },
      { type: 'waiting', waiting },
    ],
  };
})();

/** Review 1466 F18: the widest counts the bar prints, "99+" on Waiting on you and on Runs (120 open items, 120 runs whose
 *  coordinator asks the operator: a session binds one run, D-8049), and one on the Inbox. */
const FIXTURE_99: AppFixture = (() => {
  const asking = { ...(session('ask-1', 'child') as Record<string, unknown>), status: 'waiting', bucket: 'attention' };
  const many = Array.from({ length: 120 }, (_, i) => run(1000 + i, 'prog-a', 'Programme A', 'ask-1', 'ask-1'));
  const waiting = { items: Array.from({ length: 120 }, (_, i) => item(10 + i, {})), cleared: [], goals: [GOALS] };
  return {
    api: { ...FIXTURE.api, '/api/runs': many, '/api/waiting': { ok: true, waiting } },
    fleetFrames: [
      { type: 'fleet', sessions: withRunBinding([...SESSIONS, asking] as never[], many as never[]) }, { type: 'runs', runs: many },
      { type: 'waiting', waiting },
    ],
  };
})();

const SKINS = [REFINED, INSTRUMENT] as const;
const PHONES = [360, 390] as const;
const DESKS = [900, 1280] as const;
const PHONE_DOORS = ['go-fleet', 'go-waiting', 'go-inbox', 'go-runs', 'go-accounts', 'go-docs', 'open-palette'];
/** Each page with the selector that says it is drawn. */
const PAGES = [
  ['/waiting', '.wl-group'], ['/waiting/2', '.wi'], ['/programmes/prog-a', '.pv'], ['/docs', '.shell-detail'],
  ['/settings', '.shell-detail h1'], ['/', '.shell-nav .fleet'],
] as const;

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

/** A phone's safe-area insets, emulated through the DevTools protocol before the page is navigated, so `env(safe-area-inset-*)`
 *  is non-zero (headless Chrome answers 0 otherwise, which is why review 1466's F1 and F2 were invisible here). A Chrome without
 *  the command rejects it, and the case goes red, never measures at zero. */
interface Insets { readonly top?: number; readonly bottom?: number }
/** A notched phone: a 47 px status bar and a 34 px home indicator. */
const NOTCHED: Insets = { top: 47, bottom: 34 };

async function open(skin: string, width: number, path: string, ready: string, insets?: Insets, fixture: AppFixture = FIXTURE) {
  const opened = await openApp(browser!, { skin, theme: 'light', width }, fixture);
  if (insets !== undefined) {
    const cdp = await opened.ctx.newCDPSession(opened.page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets });
  }
  await opened.page.goto(server!.origin + path);
  await opened.page.waitForSelector(ready, { timeout: 20_000 });
  await opened.page.evaluate(async () => { await document.fonts.ready; });
  await opened.page.waitForTimeout(250); // the first paint's transitions settle
  return opened;
}

/** The bar as drawn: its box, its doors' commands, boxes and whether each word is whole. Null when it is not mounted. */
const measureBar = (page: Page) => page.evaluate(() => {
  const bar = document.querySelector<HTMLElement>('nav.shell-phone-nav');
  if (bar === null) return null;
  const r = bar.getBoundingClientRect();
  const doors = [...bar.querySelectorAll<HTMLElement>('[data-command]')].map((d) => {
    const b = d.getBoundingClientRect();
    const word = d.querySelector<HTMLElement>('.phone-bar-word');
    return {
      command: d.getAttribute('data-command'), w: b.width, h: b.height, left: b.left, right: b.right, top: b.top,
      wordWhole: word !== null && word.scrollWidth <= word.clientWidth + 0.5,
    };
  });
  return {
    position: getComputedStyle(bar).position, top: r.top, bottom: r.bottom, innerHeight, innerWidth, doors,
    sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});

describe.each(SKINS)('the phone bar in %s', (skin) => {
  for (const width of PHONES) {
    it(`at ${width}: the bar is fixed to the foot on every ledger page, Docs, Settings and the fleet, seven doors, each at least 44 x 44, words whole`, async () => {
      for (const [path, ready] of PAGES) {
        const { ctx, page, errors } = await open(skin, width, path, ready);
        try {
          const shots = process.env['CCRC_SHOTS'];
          if (shots !== undefined && shots !== '') await page.screenshot({ path: `${shots}/phone-bar-${skin}-${width}${path.replace(/\//g, '_')}.png` });
          const bar = await measureBar(page);
          expect(bar, `${path}: the bar`).not.toBeNull();
          expect(bar!.position, path).toBe('fixed');
          expect(Math.abs(bar!.bottom - bar!.innerHeight), `${path}: at the viewport's foot ${JSON.stringify(bar)}`).toBeLessThanOrEqual(0.5);
          expect(bar!.doors.map((d) => d.command), path).toEqual(PHONE_DOORS);
          for (const d of bar!.doors) {
            expect(d.h, `${path} ${d.command} height`).toBeGreaterThanOrEqual(44);
            expect(d.w, `${path} ${d.command} width`).toBeGreaterThanOrEqual(44);
            expect(d.left, `${path} ${d.command}`).toBeGreaterThanOrEqual(0);
            expect(d.right, `${path} ${d.command}`).toBeLessThanOrEqual(bar!.innerWidth + 0.5);
            expect(d.wordWhole, `${path} ${d.command}: its word is whole ${JSON.stringify(d)}`).toBe(true);
          }
          expect(bar!.sideways, `${path}: sideways scroll`).toBe(0);
          // The page's last line clears the bar: scrolled to the end, nothing of the page is under it.
          const clear = await page.evaluate(() => {
            window.scrollTo(0, document.documentElement.scrollHeight);
            const top = document.querySelector('nav.shell-phone-nav')!.getBoundingClientRect().top;
            const pane = document.querySelector<HTMLElement>(location.pathname === '/' ? '.shell-nav .fleet' : '.shell-detail')!;
            const last = [...pane.querySelectorAll<HTMLElement>('*')].filter((e) => e.children.length === 0 && e.getBoundingClientRect().height > 0).at(-1);
            return last === undefined ? null : { lastBottom: last.getBoundingClientRect().bottom, barTop: top };
          });
          if (clear !== null) expect(clear.lastBottom, `${path}: the last line ${JSON.stringify(clear)}`).toBeLessThanOrEqual(clear.barTop + 0.5);
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }
    });

    // Review 1466 F1 (fix round 1): the bar stands on the home indicator, so a page reserves the bar AND the inset under it.
    it(`at ${width} with a 34 px home indicator: every page's last line clears the bar`, async () => {
      for (const [path, ready] of PAGES) {
        const { ctx, page, errors } = await open(skin, width, path, ready, { bottom: NOTCHED.bottom });
        try {
          const clear = await page.evaluate(() => {
            window.scrollTo(0, document.documentElement.scrollHeight);
            const bar = document.querySelector('nav.shell-phone-nav')!.getBoundingClientRect();
            const pane = document.querySelector<HTMLElement>(location.pathname === '/' ? '.shell-nav .fleet' : '.shell-detail')!;
            const last = [...pane.querySelectorAll<HTMLElement>('*')].filter((e) => e.children.length === 0 && e.getBoundingClientRect().height > 0).at(-1);
            return { lastBottom: last?.getBoundingClientRect().bottom ?? null, barTop: bar.top, barHeight: bar.height };
          });
          // The inset is real: the bar is its row plus the indicator.
          expect(clear.barHeight, `${path}: the bar stands on the inset ${JSON.stringify(clear)}`).toBeGreaterThanOrEqual(44 + NOTCHED.bottom!);
          if (clear.lastBottom !== null) expect(clear.lastBottom, `${path}: the last line ${JSON.stringify(clear)}`).toBeLessThanOrEqual(clear.barTop + 0.5);
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }
    });

    // Review 1466 F2 (fix round 1; the coordinator's ruling: in reach is below the status bar). An installed app draws under the
    // status bar; the strip's controls sit below it and its own opaque ground covers it, at rest and stuck.
    it(`at ${width} under a 47 px status bar: the strip's controls sit below it, on the strip's own ground, at rest and stuck`, async () => {
      const { ctx, page, errors } = await open(skin, width, '/waiting/1', '.wi', NOTCHED);
      try {
        const measure = () => page.evaluate((inset) => {
          const strip = document.querySelector<HTMLElement>('.wi-nav')!;
          const tops = ['.wi-back', '[aria-label="Previous item"]', '[aria-label="Next item"]']
            .map((q) => strip.querySelector<HTMLElement>(q)!.getBoundingClientRect().top);
          const r = strip.getBoundingClientRect();
          // What a reader sees in the status bar's band: the strip itself, when the strip is there.
          const under = document.elementFromPoint(Math.round(innerWidth / 2), Math.round(inset / 2));
          return {
            stripTop: r.top, controlsTop: Math.min(...tops), coversBand: under !== null && strip.contains(under),
            ground: getComputedStyle(strip).backgroundColor, scrolled: window.scrollY,
          };
        }, NOTCHED.top!);
        const rest = await measure();
        expect(rest.controlsTop, `at rest ${JSON.stringify(rest)}`).toBeGreaterThanOrEqual(NOTCHED.top!);
        await page.evaluate(() => { window.scrollTo(0, document.documentElement.scrollHeight); });
        const stuck = await measure();
        expect(stuck.scrolled, JSON.stringify(stuck)).toBeGreaterThan(400);
        expect(Math.abs(stuck.stripTop), `stuck at the top ${JSON.stringify(stuck)}`).toBeLessThanOrEqual(0.5);
        expect(stuck.controlsTop, `stuck ${JSON.stringify(stuck)}`).toBeGreaterThanOrEqual(NOTCHED.top!);
        expect(stuck.coversBand, `the strip covers the status bar's band ${JSON.stringify(stuck)}`).toBe(true);
        expect(stuck.ground, 'an opaque ground').toMatch(/^rgb\(/);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });

    it(`at ${width}: on the fleet, + New sits above the bar`, async () => {
      const { ctx, page, errors } = await open(skin, width, '/', '.shell-nav .fleet');
      try {
        const at = await page.evaluate(() => {
          const fab = document.querySelector<HTMLElement>('[data-command="new-session"]');
          const bar = document.querySelector<HTMLElement>('nav.shell-phone-nav');
          return fab === null || bar === null ? null : { fabBottom: fab.getBoundingClientRect().bottom, barTop: bar.getBoundingClientRect().top };
        });
        expect(at, 'the fab and the bar').not.toBeNull();
        expect(at!.fabBottom, JSON.stringify(at)).toBeLessThanOrEqual(at!.barTop);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });

    it(`at ${width}: no bar in an open session`, async () => {
      const { ctx, page, errors } = await open(skin, width, '/s/prog-a-w1', '.composer');
      try {
        expect(await page.locator('nav.shell-phone-nav').count()).toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });

    it(`at ${width}: previous and next stay in view on a long item, above the bar`, async () => {
      const { ctx, page, errors } = await open(skin, width, '/waiting/1', '.wi');
      try {
        const at = await page.evaluate(() => {
          const before = document.documentElement.scrollHeight - innerHeight;
          window.scrollTo(0, document.documentElement.scrollHeight);
          const strip = document.querySelector<HTMLElement>('.wi-nav')!.getBoundingClientRect();
          const next = document.querySelector<HTMLElement>('.wi-nav [aria-label="Next item"]')!.getBoundingClientRect();
          const back = document.querySelector<HTMLElement>('.wi-nav .wi-back')!.getBoundingClientRect();
          const barTop = document.querySelector('nav.shell-phone-nav')!.getBoundingClientRect().top;
          return { scrollable: before, scrolled: window.scrollY, stripTop: strip.top, nextTop: next.top, nextBottom: next.bottom, backBottom: back.bottom, barTop };
        });
        expect(at.scrollable, `the item is long enough to scroll ${JSON.stringify(at)}`).toBeGreaterThan(400);
        expect(at.scrolled, JSON.stringify(at)).toBeGreaterThan(400);
        expect(at.stripTop, `the strip is at the top of the viewport ${JSON.stringify(at)}`).toBeGreaterThanOrEqual(-0.5);
        expect(at.stripTop, JSON.stringify(at)).toBeLessThanOrEqual(0.5);
        expect(at.nextTop, JSON.stringify(at)).toBeGreaterThanOrEqual(0);
        expect(at.nextBottom, JSON.stringify(at)).toBeLessThanOrEqual(at.barTop);
        expect(at.backBottom, JSON.stringify(at)).toBeLessThanOrEqual(at.barTop);
        await page.click('.wi-nav [aria-label="Next item"]');
        await page.waitForFunction(() => location.pathname === '/waiting/2');
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }

  // Review 1466 F13 (fix round 1): with a pinned spec the band's pills keep the band's end, and the Spec link follows them.
  for (const width of [390, 1280] as const) {
    it(`at ${width}: with a pinned spec the band's pills keep their place, the Spec link right after them`, async () => {
      const { ctx, page, errors } = await open(skin, width, '/waiting/2', '.wi-band .wi-spec');
      try {
        const band = await page.evaluate(() => {
          const b = document.querySelector<HTMLElement>('.wi-band')!;
          const pills = [...b.querySelectorAll<HTMLElement>('.wi-pill')].map((p) => p.getBoundingClientRect());
          const spec = b.querySelector<HTMLElement>('.wi-spec')!.getBoundingClientRect();
          const inner = b.getBoundingClientRect().right - parseFloat(getComputedStyle(b).paddingRight);
          const box = (r: DOMRect) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
          return { pills: pills.map(box), spec: box(spec), inner };
        });
        expect(band.pills.length, JSON.stringify(band)).toBeGreaterThan(0);
        const last = band.pills.at(-1)!;
        expect(Math.abs(band.spec.right - band.inner), `the Spec link ends the band ${JSON.stringify(band)}`).toBeLessThanOrEqual(0.5);
        // On one line (their boxes overlap in height), the Spec link follows the last pill by the band's gap; wrapped, it starts
        // its own line and the pills keep the end of theirs.
        const oneLine = last.top < band.spec.bottom && band.spec.top < last.bottom;
        if (oneLine) expect(band.spec.left - last.right, `the Spec link follows the last pill ${JSON.stringify(band)}`).toBeLessThanOrEqual(8.5);
        else expect(Math.abs(last.right - band.inner), `the pills end their line ${JSON.stringify(band)}`).toBeLessThanOrEqual(0.5);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }

  // Review 1466 F18 (fix round 1): a cut word ends in an ellipsis, and the widest badge stays inside its own door and clear of
  // its glyph's centre point, at 320, 360 and 390; it may cover the glyph's top edge (review 1481 F4, accepted). Each door's box can be written out so a
  // change to the bar's rules can be measured against the boxes before it (the coordinator's condition on 15125): set
  // CCRC_BAR_BOXES to a file and each width's boxes are appended to it.
  it('at 320, 360 and 390: "99+" badges stay inside their doors, clear of the glyph\'s centre point, and a cut word ends in an ellipsis', async () => {
    for (const width of [320, 360, 390]) {
      const { ctx, page, errors } = await open(skin, width, '/waiting', '.wl-group', undefined, FIXTURE_99);
      try {
        await page.waitForFunction(() => document.querySelectorAll('.shell-phone-nav .phone-bar-count').length === 3, undefined, { timeout: 20_000 });
        const at = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.shell-phone-nav [data-command]')].map((d) => {
          const b = d.getBoundingClientRect();
          const badge = d.querySelector<HTMLElement>('.phone-bar-count');
          const g = d.querySelector('svg')!.getBoundingClientRect();
          const word = d.querySelector<HTMLElement>('.phone-bar-word')!;
          const r = badge?.getBoundingClientRect() ?? null;
          return {
            command: d.getAttribute('data-command'), left: b.left, right: b.right, w: b.width, h: b.height,
            badge: r === null ? null : { left: r.left, right: r.right, top: r.top, bottom: r.bottom, text: badge!.textContent },
            cx: g.left + g.width / 2, cy: g.top + g.height / 2, overflow: getComputedStyle(word).textOverflow,
          };
        }));
        const boxes = process.env['CCRC_BAR_BOXES'];
        if (boxes !== undefined && boxes !== '') {
          appendFileSync(boxes, `${skin} ${width} ${JSON.stringify(at.map((d) => [d.command, +d.left.toFixed(2), +d.w.toFixed(2), +d.h.toFixed(2)]))}\n`);
        }
        expect.soft(at.filter((d) => d.badge?.text === '99+').map((d) => d.command), `${width}`).toEqual(['go-waiting', 'go-runs']);
        for (const d of at) {
          expect.soft(d.h, `${width} ${d.command}`).toBeGreaterThanOrEqual(44);
          expect.soft(d.w, `${width} ${d.command}`).toBeGreaterThanOrEqual(44);
          expect.soft(d.overflow, `${width} ${d.command}: a cut word ends in an ellipsis`).toBe('ellipsis');
          if (d.badge === null) continue;
          const say = `${width} ${d.command} ${JSON.stringify(d)}`;
          expect.soft(d.badge.left, `${say}: inside its door`).toBeGreaterThanOrEqual(d.left - 0.5);
          expect.soft(d.badge.right, `${say}: inside its door`).toBeLessThanOrEqual(d.right + 0.5);
          const coversMiddle = d.badge.left < d.cx && d.badge.right > d.cx && d.badge.top < d.cy && d.badge.bottom > d.cy;
          expect.soft(coversMiddle, `${say}: clear of the glyph's centre point`).toBe(false);
        }
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }
  });

  for (const width of DESKS) {
    it(`at ${width}: no bar at a desk`, async () => {
      for (const [path, ready] of [['/waiting', '.wl-group'], ['/waiting/2', '.wi'], ['/', '.shell-nav .fleet']] as const) {
        const { ctx, page, errors } = await open(skin, width, path, ready);
        try {
          expect(await page.locator('nav.shell-phone-nav').count(), path).toBe(0);
          // No fleet place at a desk: the one go-fleet there is Instrument's wordmark door, the way home (desk-nav Task A,
          // D-8100, `phone-bar-browser-allows-the-home-door`), as the jsdom twin of this case reads; Refined draws none.
          const home = page.locator('[data-command="go-fleet"]');
          expect(await home.count(), `${path}: no fleet place at a desk`).toBe(skin === INSTRUMENT ? 1 : 0);
          if (skin === INSTRUMENT) {
            expect(await page.locator('header nav[aria-label="Primary"] > [data-command="go-fleet"] [data-wordmark]').count(),
              `${path}: it is the wordmark door, in the header's Primary nav`).toBe(1);
          }
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }
    });
  }
});
