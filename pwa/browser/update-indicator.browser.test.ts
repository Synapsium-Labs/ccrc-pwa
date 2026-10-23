// The fleet's update line in a real Chrome over the production build (desktop-polish T2a, D-6327). The full-width
// "update available" banner is gone; one quiet line, `UpdateIndicator`, has a dismiss × beside it and is placed by skin
// (ruled departure `refined-desk-indicator-in-a-row-under-the-bar`): at a desk Refined holds it in one full-width row
// directly under the app bar (the frame's `.shell-banners` slot, `data-form="row"`, after the banner stack, so the bar's
// first line is what it was and "New session" never moves); Instrument holds it in the status bar (`data-form="status"`);
// below 900 both skins hold the same 44px row. What jsdom cannot hold lives here, with SEVENTEEN lanes in the roster
// (the bar's gauges give up their room first):
//
//  1. At the desk the bar's first line (`header.shell-accounts`) holds no indicator; the row under it holds exactly one,
//     its door, words, stale words and × whole inside the row and the viewport; every gauge that shows is whole, "New
//     session" is whole inside the viewport and the bar; the page does not scroll sideways; no page errors. Refined at
//     900, 1280 and 1920 and Instrument (status bar) at 900, both palettes, with a FRESH view and then a STALE one (a later
//     poll failed, so the stale words follow the version): the route answers the view once and HTTP 500 afterwards, and a
//     `visibilitychange` (the hook re-polls when the page becomes visible, `useUpdatesView`) makes the second read at
//     once, so the 60 s poll is never waited for.
//  2. Every control of the line is at least 24 x 24 under a fine pointer and at least 44 x 44 under touch, in each form:
//     Refined's desk row, Instrument's status bar and the phone rows (390, always touch). The coarse pointer at a desk is
//     a touch screen: headless Chrome ignores the DevTools pointer media feature (measured, as refined-bar does), so
//     `openApp` takes `touch`.
//
// The gauge check below is refined-bar.browser.test.ts's, rewritten and not imported: that file is a test file (its
// `beforeAll` builds the app), and it keeps the check inline.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts --maxWorkers=2 browser/update-indicator.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';

const THEMES = [PHOSPHOR, 'light'];
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px, ${v.touch === true ? 'touch' : 'mouse'}`;

const MIN = 60_000;
const nowSec = Math.floor(Date.now() / 1000);
const LANES = Array.from({ length: 17 }, (_, i) => `lane-${String.fromCharCode(97 + i)}`); // lane-a ... lane-q

/** A node the update plane measured, behind the release `desiredTag` names (the shape `update-indicator.test.tsx` uses). */
const node = (role: 'fleet' | 'server', id: string) => ({
  nodeId: id, role, label: role, os: 'linux',
  current: { sha: 'bd2bf57a91c3e0d4f6a8b2c5e7d9f1a3b5c7e9d1', ref: 'main', builtAt: '2026-09-20T12:00:00Z', dirty: false, version: 'v0.0.7' },
  stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['update-gate'], agentOps: role === 'server' ? null : [], highestVersion: 'v0.0.7', previousVersion: null,
  floorRead: 'measured', previousRead: 'absent',
  measuredAt: Date.now() - MIN, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: 'v0.0.9', resolveDetail: null, request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
});
const WAITING = {
  catalogue: { lastOkAt: Date.now() - 4 * MIN, lastError: null }, releases: [],
  nodes: [node('fleet', '0b6e1c62-7a4f-4d0e-9c1a-3f2d5e8a9b10'), node('server', '5f3a9d21-2c8b-4e6f-a1d7-8b0c4e2f6a93')], intent: [],
};

const FIXTURE: AppFixture = {
  api: {
    '/api/updates': WAITING,
    '/api/feed': { events: [] },
    '/api/accounts': {
      accounts: LANES.map((_, i) => ({
        wrapper: `w${i}`, five: 100 - ((i * 7) % 90), seven: 50, ts: nowSec - 60, fiveResetAt: null, sevenResetAt: null,
        fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false,
      })),
      projected: null,
      roster: LANES.map((label, i) => ({ id: `w${i}`, label, hue: 'cyan', homeAble: true, hidden: false })),
    },
  },
  fleetFrames: [{ type: 'fleet', sessions: [] }],
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

/** The page answers the view until `fail.on`, then HTTP 500: the hook keeps the last good view and reports the failure
 *  beside it, which is what a stale view is. Registered after `openApp`'s routes, so it wins for this path. */
async function answerViewThenFail(page: Page): Promise<{ fail(): void }> {
  const state = { failing: false };
  await page.context().route('**/api/updates', async (route) => {
    if (state.failing) await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"down"}' });
    else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(WAITING) });
  });
  return { fail: () => { state.failing = true; } };
}

/** Everything about the line and where it sits that a real layout can get wrong, as faults (empty when nothing is).
 *  `holderSel` is the box that must hold the one indicator (Refined's `.shell-banners` row, Instrument's `.ins-status`);
 *  `barSel` is the app bar's box (Refined) that must hold none; `stale` says the stale words must be on the line. */
async function lineFaults(page: Page, holderSel: string, barSel: string | null, stale: boolean): Promise<{ faults: string[]; holderHeight: number; barHeight: number }> {
  return page.evaluate(({ holderSel: hs, barSel: bs, stale: wantStale }) => {
    const out: string[] = [];
    const holder = document.querySelector<HTMLElement>(hs);
    const bar = bs === null ? null : document.querySelector<HTMLElement>(bs);
    if (holder === null) return { faults: [`no ${hs}`], holderHeight: 0, barHeight: 0 };
    if (bs !== null && bar === null) out.push(`no ${bs}`);
    if (document.querySelectorAll('.update-indicator').length !== 1) out.push(`${document.querySelectorAll('.update-indicator').length} indicators in the page, not one`);
    if (bar !== null && bar.querySelector('.update-indicator') !== null) out.push("the bar's first line holds an indicator");
    const line = holder.querySelector<HTMLElement>('.update-indicator');
    const hb = holder.getBoundingClientRect();
    if (line === null) return { faults: [...out, `the indicator is not inside ${hs}`], holderHeight: hb.height, barHeight: bar?.getBoundingClientRect().height ?? 0 };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const inside = (what: string, r: { left: number; right: number; top: number; bottom: number }, b: DOMRect, where: string): void => {
      if (r.left < b.left - 0.5 || r.right > b.right + 0.5 || r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5) {
        out.push(`${what} is not whole inside ${where} (${Math.round(r.left)}..${Math.round(r.right)} x ${Math.round(r.top)}..${Math.round(r.bottom)} in ${Math.round(b.left)}..${Math.round(b.right)} x ${Math.round(b.top)}..${Math.round(b.bottom)})`);
      }
      if (r.left < -0.5 || r.right > vw + 0.5 || r.top < -0.5 || r.bottom > vh + 0.5) out.push(`${what} is not whole inside the viewport`);
    };
    const whole = (what: string, r: { left: number; right: number; top: number; bottom: number }): void => inside(what, r, hb, 'its holder');
    const form = line.dataset['form'];
    if (form !== (bs === null ? 'status' : 'row')) out.push(`the indicator's form is ${form}`);
    const door = line.querySelector<HTMLElement>('.update-indicator-door');
    const dismiss = line.querySelector<HTMLElement>('.update-indicator-dismiss');
    if (door === null) out.push('no door');
    else {
      const dr = door.getBoundingClientRect();
      whole('the door', dr);
      // The words themselves: a text range over the door's contents, so a word cut by `overflow` still shows as outside.
      const range = document.createRange();
      range.selectNodeContents(door);
      const wr = range.getBoundingClientRect();
      whole('the words', wr);
      if (wr.right > dr.right + 0.5 || wr.left < dr.left - 0.5) out.push('the words stick out of their door');
      if (door.scrollWidth > door.clientWidth + 0.5) out.push("the door's words overflow its box");
      if (!(door.textContent ?? '').includes('v0.0.9 available')) out.push(`the words read "${door.textContent}"`);
    }
    if (dismiss === null) out.push('no ×'); else whole('the ×', dismiss.getBoundingClientRect());
    const staleEl = line.querySelector<HTMLElement>('.update-indicator-stale');
    if (wantStale) {
      if (staleEl === null) out.push('the stale words are not on the line');
      else {
        whole('the stale words', staleEl.getBoundingClientRect());
        if (staleEl.scrollWidth > staleEl.clientWidth + 0.5) out.push('the stale words overflow their box');
      }
    } else if (staleEl !== null) out.push('stale words on a fresh view');
    // One line: the line's parts share one row (their centres agree), and every part has its top inside the holder.
    for (const c of [...line.children] as HTMLElement[]) {
      const r = c.getBoundingClientRect();
      if (r.height > 0 && (r.top < hb.top - 0.5 || r.top > hb.bottom - 0.5)) out.push(`${c.className || c.tagName} starts outside the holder's first line`);
    }
    const centres = [...line.children].map((c) => c.getBoundingClientRect()).filter((r) => r.height > 0).map((r) => (r.top + r.bottom) / 2);
    if (Math.max(...centres) - Math.min(...centres) > 2) out.push('the parts of the line are not on one row');
    // The bar (Refined): every direct child lies whole inside it and the viewport, "New session" included, and every
    // gauge that shows is whole inside its row with its reading whole (refined-bar's check).
    if (bar !== null) {
      const bb = bar.getBoundingClientRect();
      for (const c of [...bar.querySelector('.ref-bar')!.children] as HTMLElement[]) {
        const r = c.getBoundingClientRect();
        if (r.width > 0) inside(`the bar's ${c.className.split(' ').pop()}`, r, bb, 'the bar');
      }
      const fresh = bar.querySelector<HTMLElement>('.ref-bar-new');
      if (fresh === null) out.push('no New session');
      else inside('New session', fresh.getBoundingClientRect(), bb, 'the bar');
      const lanes = bar.querySelector<HTMLElement>('.accounts-compact-lanes');
      const wrap = bar.querySelector<HTMLElement>('.accounts-compact');
      if (lanes !== null && wrap !== null) {
        const r = lanes.getBoundingClientRect();
        const d = wrap.getBoundingClientRect();
        const shown = [...lanes.querySelectorAll<HTMLElement>('.accounts-compact-gauge')]
          .filter((g) => getComputedStyle(g).visibility !== 'hidden' && g.getBoundingClientRect().top < r.bottom - 1);
        for (const g of shown) {
          const gr = g.getBoundingClientRect();
          const pct = g.querySelector<HTMLElement>('.accounts-compact-pct')!;
          const pr = pct.getBoundingClientRect();
          const name = g.querySelector<HTMLElement>('.accounts-compact-name')!.textContent;
          if (gr.right > r.right + 0.5) out.push(`${name} sticks out of the row (${gr.right} > ${r.right})`);
          if (pr.right > r.right + 0.5 || pr.right > d.right + 0.5) out.push(`${name}'s ${pct.textContent} is cut`);
          if (pct.scrollWidth > pct.clientWidth + 0.5) out.push(`${name}'s reading overflows its box`);
        }
        const more = wrap.querySelector<HTMLElement>('.accounts-compact-more');
        if (more !== null && more.getBoundingClientRect().right > d.right + 0.5) out.push('+n is cut');
      }
    }
    if (document.documentElement.scrollWidth > window.innerWidth + 0.5) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} > ${window.innerWidth})`);
    return { faults: out, holderHeight: hb.height, barHeight: bar?.getBoundingClientRect().height ?? 0 };
  }, { holderSel, barSel, stale });
}

const BAR = 'header.shell-accounts';   // Refined's app bar: its first line, which holds no indicator
const ROW = '.shell-banners';          // the row under it that holds the one
const STATUS_BAR = '.ins-status';

// Refined at 900, 1280 and 1920 and Instrument at 900, both palettes.
const DESKS: AppView[] = THEMES.flatMap((theme) => [
  ...[900, 1280, 1920].map((width) => ({ skin: REFINED, theme, width })),
  { skin: INSTRUMENT, theme, width: 900 },
]);

describe("at the desk the bar's first line is unchanged and the update line is one row under it, nothing clipped, fresh and stale", () => {
  for (const view of DESKS) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        const answers = await answerViewThenFail(page);
        await page.goto(server!.origin + '/');
        const refined = view.skin === REFINED;
        const holder = refined ? ROW : STATUS_BAR;
        const bar = refined ? BAR : null;
        await page.waitForSelector(`${holder} .update-indicator-dismiss`, { timeout: 20_000 });
        if (refined) await page.waitForFunction(() => document.querySelectorAll('.ref-bar .accounts-compact-gauge').length > 0, undefined, { timeout: 20_000 });
        await page.waitForTimeout(300); // the gauges' ResizeObserver settles
        const fresh = await lineFaults(page, holder, bar, false);
        expect(fresh.faults, 'a fresh view').toEqual([]);

        // STALE: the next read fails, and a visibilitychange makes it now (the hook's own refresh on a page that returns).
        answers.fail();
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await page.waitForSelector(`${holder} .update-indicator-stale`, { timeout: 20_000 });
        await page.waitForTimeout(300);
        const stale = await lineFaults(page, holder, bar, true);
        expect(stale.faults, 'a stale view').toEqual([]);
        expect(stale.barHeight, 'the stale words leave the bar one line tall').toBeCloseTo(fresh.barHeight, 0);
        expect(stale.holderHeight, 'and the line one row tall').toBeCloseTo(fresh.holderHeight, 0);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});

// The door and the × in each form: Refined's desk row (900), Instrument's status bar (900) and the phone row (390, always touch).
const FORMS: AppView[] = THEMES.flatMap((theme) => [
  { skin: REFINED, theme, width: 900, touch: false },
  { skin: REFINED, theme, width: 900, touch: true },
  { skin: INSTRUMENT, theme, width: 900, touch: false },
  { skin: INSTRUMENT, theme, width: 900, touch: true },
  { skin: REFINED, theme, width: 390 },
  { skin: INSTRUMENT, theme, width: 390 },
]);

describe('at least 24 px under a fine pointer, 44 px under touch', () => {
  for (const view of FORMS) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await page.goto(server!.origin + '/');
        await page.waitForSelector('.update-indicator-dismiss', { timeout: 20_000 });
        await page.waitForTimeout(300);
        const touch = view.touch === true || view.width < 900;
        const floor = touch ? 44 : 24;
        const found = await page.evaluate(({ wantTouch }) => {
          const pointer = wantTouch ? matchMedia('(pointer: coarse)').matches : matchMedia('(pointer: fine)').matches;
          const form = document.querySelector<HTMLElement>('.update-indicator')?.dataset['form'] ?? null;
          const controls = [...document.querySelectorAll<HTMLElement>('.update-indicator-door, .update-indicator-dismiss')]
            .map((c) => { const r = c.getBoundingClientRect(); return { name: c.getAttribute('aria-label') ?? '?', w: r.width, h: r.height }; });
          return { pointer, form, count: document.querySelectorAll('.update-indicator').length, controls };
        }, { wantTouch: touch });
        expect(found.pointer, touch ? 'the coarse pointer was emulated' : 'the pointer is fine').toBe(true);
        expect(found.count).toBe(1);
        expect(found.form).toBe(view.width < 900 || view.skin === REFINED ? 'row' : 'status');
        expect(found.controls.map((c) => c.name.startsWith('Dismiss') ? 'dismiss' : 'door').sort()).toEqual(['dismiss', 'door']);
        const small = found.controls.filter((c) => c.w < floor - 0.5 || c.h < floor - 0.5)
          .map((c) => `${c.name} is ${Math.round(c.w)} x ${Math.round(c.h)}`);
        expect(small, `every control is at least ${floor} x ${floor}`).toEqual([]);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});
