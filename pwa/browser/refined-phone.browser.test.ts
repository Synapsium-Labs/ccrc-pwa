// Refined's phone header, accounts strip and `+ New` (W2 Task S5, D-5471; the strip is the full one again, desktop-polish
// S5a), in a real Chrome over the production build.
//
// What jsdom cannot hold: at 360, 390 and 438 in both palettes, with a three-digit Inbox count and five lanes, the
// header is one row with nothing cut, every door is at least 44 x 44 under the phone's touch screen, the readout is one
// line, the strip's lane cards sit in two columns, the `+ New` clears the last card once the list is scrolled to its
// end and sits above the home indicator, a toast's host sits above it, and the page does not scroll sideways. At 900,
// 1280 and 1920 no `+ New` is mounted (the bar's button is the door). Instrument's phone keeps today's head and round
// `+` (S11). With seventeen lanes at 360 and 390 the cards run most free first, every countdown a card prints is seen
// (a client rect inside the card, not covered), a long label stays inside its card with its whole name in the `title`,
// and All accounts has a row of its own under the cards (T2c, D-6329; R18 F4, F5).
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
        await page.waitForFunction(() => document.querySelectorAll('.ref-phone-head .account-gauge').length === 5
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
          const lefts = new Set([...document.querySelectorAll<HTMLElement>('.ref-phone-head .account-gauge')]
            .map((g) => Math.round(g.getBoundingClientRect().left)));
          if (lefts.size !== 2) out.push(`the cards sit in ${lefts.size} columns`);
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

/** One lane of the 17-lane fixture and what its card must show. */
interface LaneCase { acct: Record<string, unknown>; label: string; windows: string[]; counted: boolean[] }

/** 17 lanes: one rolled over, one signed out, one never read, one with a long label, a few with a window but no reset,
 *  the rest reading both windows with a reset ahead. `counted` is, per shown window, whether a countdown must print. */
function seventeen(): { fixture: AppFixture; cases: LaneCase[] } {
  const cases: LaneCase[] = Array.from({ length: 17 }, (_, i) => {
    const base = {
      wrapper: `w${i}`, five: 20 + i * 4, seven: 10 + i * 3, ts: nowSec - 60, fiveResetAt: nowSec + 7200 as number | null,
      sevenResetAt: nowSec + 3 * 86400 as number | null, fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false,
    } as Record<string, unknown>;
    let label = `lane-${String.fromCharCode(97 + i)}`;
    let counted = [true, true];
    if (i === 0) { Object.assign(base, { five: 0, fiveRolledOver: true, fiveResetAt: nowSec - 60 }); counted = [false, true]; }
    if (i === 1) base.authDead = true;
    if (i === 2) { Object.assign(base, { five: null, seven: null, fiveResetAt: null, sevenResetAt: null }); counted = []; }
    if (i === 3) label = 'lane-with-a-very-long-name-q';
    if (i === 4) { Object.assign(base, { seven: null, fiveResetAt: null, sevenResetAt: null }); counted = [false]; }
    if (i === 5) { Object.assign(base, { five: null, fiveResetAt: null, sevenResetAt: null }); counted = [false]; }
    const windows = [base.five !== null ? '5h' : null, base.seven !== null ? '7d' : null].filter((w): w is string => w !== null);
    return { acct: base, label, windows, counted };
  });
  return {
    cases,
    fixture: {
      ...FIXTURE,
      api: {
        ...FIXTURE.api,
        '/api/accounts': {
          accounts: cases.map((c) => c.acct),
          projected: null,
          roster: cases.map((c, i) => ({ id: `w${i}`, label: c.label, hue: 'cyan', homeAble: true, hidden: false })),
        },
      },
    },
  };
}

/** The lanes most free first, worked out here from the rule and not by the app's decider: by the fuller window, lowest
 *  first, ties in roster order; a lane never read and a lane signed out go last, in roster order. */
function mostFreeFirst(cases: readonly LaneCase[]): LaneCase[] {
  const used = (c: LaneCase): number | null => {
    const known = [c.acct['five'], c.acct['seven']].filter((p): p is number => typeof p === 'number');
    return known.length === 0 ? null : Math.max(...known);
  };
  const ranked = cases.map((c, i) => ({ c, i, pct: used(c) })).filter((e) => e.pct !== null && e.c.acct['authDead'] !== true);
  const last = cases.filter((c) => used(c) === null || c.acct['authDead'] === true);
  ranked.sort((x, y) => x.pct! - y.pct! || x.i - y.i);
  return [...ranked.map((e) => e.c), ...last];
}

describe("with 17 lanes the phone's strip keeps every card readable", () => {
  for (const theme of THEMES) {
    for (const width of [360, 390]) {
      it(`with 17 lanes at 360 and 390 the cards run most free first, each shows its windows and every countdown it prints is seen, a long label is cut inside its card, All accounts has a row of its own under the cards, and nothing scrolls sideways: ${theme}, ${width}px`, async () => {
        const { fixture, cases } = seventeen();
        const { ctx, page, errors } = await openApp(browser!, { skin: REFINED, theme, width }, fixture);
        try {
          await page.goto(server!.origin + '/');
          await page.waitForFunction(() => document.querySelectorAll('.ref-phone-head .account-gauge').length === 17, undefined, { timeout: 20_000 });
          await page.waitForTimeout(200);
          const faults = await page.evaluate((expected) => {
            const out: string[] = [];
            const cards = [...document.querySelectorAll<HTMLElement>('.ref-phone-head .account-gauge')];
            const labelOf = (c: HTMLElement): string => c.querySelector('.account-gauge-label')?.textContent ?? '';
            const names = cards.map(labelOf);
            if (cards.length !== expected.length) out.push(`${cards.length} cards, not ${expected.length}`);
            if (names.join('|') !== expected.map((e) => e.label).join('|')) out.push(`the cards read [${names}], not most free first [${expected.map((e) => e.label)}]`);
            const vw = window.innerWidth;
            for (const card of cards) {
              const want = expected.find((e) => e.label === labelOf(card));
              if (want === undefined) { out.push(`${labelOf(card)} is not a lane of the fixture`); continue; }
              const cr = card.getBoundingClientRect();
              const rows = [...card.querySelectorAll<HTMLElement>('.acct-row')];
              const wins = rows.map((r) => r.querySelector('.acct-win')?.textContent ?? '');
              if (wins.join() !== want.windows.join()) out.push(`${want.label} shows [${wins}], not [${want.windows}]`);
              for (const [j, row] of rows.entries()) {
                const reset = row.querySelector('.acct-reset')?.textContent ?? '';
                if (want.counted[j] === true && (reset === '' || reset === '↻ —')) out.push(`${want.label}'s ${wins[j]} row prints no countdown (${JSON.stringify(reset)})`);
              }
              if (cr.left < -0.5 || cr.right > vw + 0.5) out.push(`${want.label}'s card runs past the viewport`);
              if (card.scrollWidth > card.clientWidth + 0.5) out.push(`${want.label}'s card holds more than it shows (${card.scrollWidth} > ${card.clientWidth})`);
              // Every window, percentage and countdown is SEEN (F4): a client rect with area, inside the card, and the
              // element at its centre is its own, so nothing clips or covers it.
              for (const el of card.querySelectorAll<HTMLElement>('.acct-win, .acct-pct, .acct-reset')) {
                const er = el.getBoundingClientRect();
                const what = `${want.label}'s ${el.className.split(' ')[0]} "${el.textContent}"`;
                if (el.getClientRects().length === 0 || er.width < 1 || er.height < 1) { out.push(`${what} has no box`); continue; }
                if (er.left < cr.left - 0.5 || er.right > cr.right + 0.5 || er.top < cr.top - 0.5 || er.bottom > cr.bottom + 0.5) out.push(`${what} is outside its card`);
                const hit = document.elementFromPoint((er.left + er.right) / 2, (er.top + er.bottom) / 2);
                if (hit === null || !el.contains(hit)) out.push(`${what} is covered by ${hit?.className ?? 'nothing'}`);
              }
              // A long label's spill is cut (F5): the label stays inside the card, with its whole name in the title.
              const label = card.querySelector<HTMLElement>('.account-gauge-label')!;
              const lr = label.getBoundingClientRect();
              if (lr.right > cr.right + 0.5 || lr.left < cr.left - 0.5) out.push(`${want.label}'s name sticks out of its card`);
              if (label.title !== want.label) out.push(`${want.label}'s title is "${label.title}"`);
            }
            const lefts = new Set(cards.map((c) => Math.round(c.getBoundingClientRect().left)));
            if (lefts.size !== 2) out.push(`the cards sit in ${lefts.size} columns`);
            // All accounts: a row of its own, under every card, whole and a finger's height.
            const end = document.querySelector<HTMLElement>('.ref-phone-head .accounts-end');
            const door = end?.querySelector<HTMLElement>('button');
            if (end === null || door === null || door === undefined) out.push('no All accounts');
            else {
              const er = end.getBoundingClientRect();
              const dr = door.getBoundingClientRect();
              const lowest = Math.max(...cards.map((c) => c.getBoundingClientRect().bottom));
              if (er.top < lowest - 0.5) out.push(`All accounts (top ${er.top}) is not under the cards (bottom ${lowest})`);
              if (dr.left < -0.5 || dr.right > vw + 0.5) out.push('All accounts is outside the viewport');
              if (dr.height < 43.5) out.push(`All accounts is ${Math.round(dr.height)} tall`);
              if (door.getAttribute('data-command') !== 'go-accounts') out.push('All accounts is not the go-accounts door');
            }
            if (document.documentElement.scrollWidth > window.innerWidth + 0.5) out.push('the page scrolls sideways');
            return out;
          }, mostFreeFirst(cases).map((c) => ({ label: c.label, windows: c.windows, counted: c.counted })));
          expect(faults).toEqual([]);
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }, 60_000);
    }
  }
});
