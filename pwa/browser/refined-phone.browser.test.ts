// Refined's phone header, gauges and `+ New` (W2 Task S5, D-5471), in a real Chrome over the production build.
//
// What jsdom cannot hold: at 360, 390 and 438 in both palettes, with a three-digit Inbox count and five lanes, the
// header is one row with nothing cut, every door is at least 44 x 44 under the phone's touch screen, the readout is one
// line, the gauges sit in two columns, the `+ New` clears the last card once the list is scrolled to its end and sits
// above the home indicator, a toast's host sits above it, and the page does not scroll sideways. At 900, 1280 and 1920
// no `+ New` is mounted (the bar's button is the door). Instrument's phone keeps today's head and round `+` (S11).
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/refined-phone.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';
import { fleetSession } from '../test/fleetFixture';

const THEMES = [PHOSPHOR, 'light'];
const PHONES: AppView[] = THEMES.flatMap((theme) => [360, 390, 438].map((width) => ({ skin: REFINED, theme, width })));
const DESKS: AppView[] = THEMES.flatMap((theme) => [900, 1280, 1920].map((width) => ({ skin: REFINED, theme, width })));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

const nowSec = Math.floor(Date.now() / 1000);
const LANES = ['alpha', 'beta', 'gamma', 'delta', 'eps'];
const FIXTURE: AppFixture = {
  api: {
    '/api/feed': {
      events: Array.from({ length: 120 }, (_, i) => ({
        seq: i + 1, at: Date.now() - i * 1000, kind: 'mail', sessionId: 's', title: 't', body: 'b', runId: null,
      })),
    },
    '/api/accounts': {
      accounts: LANES.map((_, i) => ({
        wrapper: `w${i}`, five: [100, 88, 76, 40, 30][i], seven: 50, ts: nowSec - 60, fiveResetAt: null, sevenResetAt: null,
        fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false,
      })),
      projected: null,
      roster: LANES.map((label, i) => ({ id: `w${i}`, label, hue: 'cyan', homeAble: true, hidden: false })),
    },
  },
  fleetFrames: [
    {
      type: 'fleet',
      sessions: Array.from({ length: 9 }, (_, i) => fleetSession({
        id: `s${i}`, project: `proj-${i % 3}`, bucket: i === 0 ? 'attention' : 'idle',
      })),
    },
    {
      type: 'runs',
      runs: Array.from({ length: 3 }, (_, i) => ({
        id: i + 1, program: 'p', programTitle: 'P', wave: 1, waveOf: 1, project: 'x', homeProject: null, state: 'working', closedAt: null,
      })),
    },
  ],
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

describe("Refined's phone header is one row of finger-sized doors, and `+ New` clears the list and the toast", () => {
  for (const view of PHONES) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await page.goto(server!.origin + '/');
        await page.waitForFunction(() => document.querySelectorAll('.ref-phone-head .accounts-compact-gauge').length === 5
          && document.querySelector('.ref-phone-head [aria-label="Inbox, 120 unread"]') !== null
          && document.querySelectorAll('.proj-card').length > 0 && document.querySelector('.ref-fab') !== null, undefined, { timeout: 20_000 });
        await page.waitForTimeout(200); // the FAB's ResizeObserver publishes
        const faults = await page.evaluate(() => {
          const out: string[] = [];
          if (!matchMedia('(pointer: coarse)').matches) out.push('the coarse pointer was not emulated');
          const row = document.querySelector<HTMLElement>('.ref-phone-row')!;
          const rr = row.getBoundingClientRect();
          const parts = [row.querySelector<HTMLElement>('[data-wordmark]')!, ...row.querySelectorAll<HTMLElement>('[data-command]')];
          if (parts.length !== 5) out.push(`the row holds ${parts.length} parts, not the wordmark and four doors`);
          const mid = (el: HTMLElement): number => { const r = el.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
          const line = mid(parts.at(-1)!);
          for (const p of parts) {
            const r = p.getBoundingClientRect();
            const name = p.getAttribute('aria-label') ?? 'the wordmark';
            if (Math.abs(mid(p) - line) > 8) out.push(`${name} wrapped off the row`);
            if (r.right > rr.right + 0.5 || r.left < rr.left - 0.5) out.push(`${name} is cut`);
            if (p.matches('[data-command]') && (r.width < 43.5 || r.height < 43.5)) out.push(`${name} is ${Math.round(r.width)} x ${Math.round(r.height)}`);
          }
          const badge = row.querySelector<HTMLElement>('.ref-phone-badge');
          if (badge === null) out.push('no badge on Inbox');
          else {
            const br = badge.getBoundingClientRect();
            if (br.right > rr.right + 0.5) out.push('the badge is cut');
            // The glyph is the door's only visible label: a "99+" may sit on its top-right corner, never its middle.
            const g = badge.closest('[data-command]')!.querySelector('svg')!.getBoundingClientRect();
            const cx = (g.left + g.right) / 2;
            const cy = (g.top + g.bottom) / 2;
            if (br.left < cx - 0.5 || br.bottom > cy + 0.5) out.push(`the badge covers the glyph's middle (${Math.round(br.left)},${Math.round(br.bottom)} vs ${Math.round(cx)},${Math.round(cy)})`);
          }
          const sub = document.querySelector<HTMLElement>('.ref-phone-sub .fleet-count');
          if (sub === null) out.push('no readout');
          else if (sub.getClientRects().length !== 1) out.push('the readout wraps');
          const lefts = new Set([...document.querySelectorAll<HTMLElement>('.ref-phone-head .accounts-compact-gauge')]
            .map((g) => Math.round(g.getBoundingClientRect().left)));
          if (lefts.size !== 2) out.push(`the gauges sit in ${lefts.size} columns`);
          const fab = document.querySelector<HTMLElement>('.ref-fab')!.getBoundingClientRect();
          if (fab.height < 43.5) out.push(`+ New is ${Math.round(fab.height)} tall`);
          if (fab.bottom > window.innerHeight - 8) out.push('+ New sits on the home indicator');
          // A toast's host, as ToastHost draws it, empty: its bottom edge is where the first toast's would be.
          const host = document.createElement('div');
          host.className = 'toast-host pointer-events-none fixed inset-x-0 bottom-[calc(var(--sp-6)+var(--safe-bottom)+var(--composer-h,0px)+var(--phone-nav-h,0px))] z-toast grid justify-items-center gap-2 px-4';
          document.body.append(host);
          const hr = host.getBoundingClientRect();
          host.remove();
          if (hr.bottom > fab.top + 0.5) out.push(`a toast would sit on + New (${hr.bottom} > ${fab.top})`);
          if (document.documentElement.scrollWidth > window.innerWidth + 0.5) out.push('the page scrolls sideways');
          return out;
        });
        expect(faults).toEqual([]);
        // The last card clears + New once the list is scrolled to its end.
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(100);
        const covered = await page.evaluate(() => {
          const cards = [...document.querySelectorAll<HTMLElement>('.proj-card')];
          const last = cards.at(-1)!.getBoundingClientRect();
          const fab = document.querySelector<HTMLElement>('.ref-fab')!.getBoundingClientRect();
          return last.bottom > fab.top + 0.5 && last.right > fab.left ? `the last card runs under + New (${last.bottom} > ${fab.top})` : null;
        });
        expect(covered).toBeNull();
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 60_000);
  }

  for (const view of DESKS) {
    it(`no + New at a desk: ${named(view)}`, async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await page.goto(server!.origin + '/');
        await page.waitForFunction(() => document.querySelector('.ref-bar') !== null && document.querySelectorAll('.proj-card').length > 0, undefined, { timeout: 20_000 });
        const seen = await page.evaluate(() => ({
          fab: document.querySelectorAll('.ref-fab, .fab').length,
          head: document.querySelectorAll('.ref-phone-head').length,
          nav: getComputedStyle(document.documentElement).getPropertyValue('--phone-nav-h').trim(),
          sideways: document.documentElement.scrollWidth > window.innerWidth + 0.5,
        }));
        expect(seen).toEqual({ fab: 0, head: 0, nav: '0px', sideways: false });
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 60_000);
  }

  it("Instrument's phone keeps today's head and round +", async () => {
    const { ctx, page, errors } = await openApp(browser!, { skin: INSTRUMENT, theme: PHOSPHOR, width: 390 }, FIXTURE);
    try {
      await page.goto(server!.origin + '/');
      // Wait on the fleet itself, not one grouping's rows: the list may open grouped by status or by project.
      await page.waitForFunction(() => document.querySelector('.fleet-head') !== null && document.querySelector('.fab') !== null
        && document.body.innerText.includes('9 sessions'), undefined, { timeout: 20_000 });
      const seen = await page.evaluate(() => ({
        head: document.querySelectorAll('.fleet-head').length,
        fab: document.querySelectorAll('.fab').length,
        refined: document.querySelectorAll('.ref-phone-head, .ref-fab').length,
      }));
      expect(seen).toEqual({ head: 1, fab: 1, refined: 0 });
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  }, 60_000);
});
