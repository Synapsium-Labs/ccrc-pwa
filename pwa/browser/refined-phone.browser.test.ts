// Refined's phone header, accounts strip and `+ New` (W2 Task S5, D-5471; the strip is the full one again, desktop-polish
// S5a), in a real Chrome over the production build.
//
// What jsdom cannot hold: at 360, 390 and 438 in both palettes, with a three-digit Inbox count and five lanes, the
// header is one row with nothing cut, every door is at least 44 x 44 under the phone's touch screen, the readout is one
// line, the strip's lane cards sit in two columns, the `+ New` clears the last card once the list is scrolled to its
// end and sits above the home indicator, a toast's host sits above it, and the page does not scroll sideways. At 900,
// 1280 and 1920 no `+ New` is mounted (the bar's button is the door). Instrument's phone keeps today's head and round
// `+` (S11). With seventeen lanes at 360 and 390, strip expanded, the cards run most free first, every countdown a card
// prints is seen (a client rect inside the card, not covered), a long label stays inside its card with its whole name in
// the `title`, and All accounts has a row of its own under the cards (T2c, D-6329; R18 F4, F5).
//
// THE FOLD (desktop polish S5b, D-6530). The strip folds by default: with the same seventeen lanes (`test/seventeenLanes.ts`,
// the fixture every strip suite shares) a phone shows its freest four and one control, the control and All accounts
// share one row, nothing scrolls sideways, and the first session row sits at most 440 px down at 390x844 (it sat at 805
// with the strip expanded, the figure the expanded case pins within 4 px). The four cards are two rows of two below 700
// and one row of four from 700 (699, 700 and 899 are measured), and after "Show fewer" the control holds focus and is on
// screen. A case that counts every lane seeds the stored choice expanded (`seedStripExpanded`).
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/refined-phone.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, seedStripExpanded, serveDist, type AppFixture, type AppView, type DistServer } from './app';
import { fleetSession } from '../test/fleetFixture';
import { seventeenLanes, type LaneCase } from '../test/seventeenLanes';

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

/** The 17-lane fixture (`test/seventeenLanes.ts`, the one every strip suite shares) as this file's app fixture. */
function seventeen(): { fixture: AppFixture; cases: LaneCase[] } {
  const { cases, accounts, roster } = seventeenLanes(nowSec);
  return {
    cases,
    fixture: { ...FIXTURE, api: { ...FIXTURE.api, '/api/accounts': { accounts, projected: null, roster } } },
  };
}

/** The lanes most free first, worked out here from the rule and not by the app's decider: by the fuller window, lowest
 *  first; a lane never read and a lane signed out go last, in roster order. The shared fixture holds no exact tie on that
 *  use, so the keys the app breaks one with (the binding window's reset, the other window's use, then the roster;
 *  lanes-tie-break-soonest-reset) never decide here, and the roster order stands in for them. lanes-row.browser.test.ts's
 *  fixture holds a tie and writes the keys out. */
function mostFreeFirst(cases: readonly LaneCase[]): LaneCase[] {
  const used = (c: LaneCase): number | null => {
    const known = [c.acct.five, c.acct.seven].filter((p): p is number => typeof p === 'number');
    return known.length === 0 ? null : Math.max(...known);
  };
  const ranked = cases.map((c, i) => ({ c, i, pct: used(c) })).filter((e) => e.pct !== null && e.c.acct.authDead !== true);
  const last = cases.filter((c) => used(c) === null || c.acct.authDead === true);
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
          await seedStripExpanded(ctx); // the strip folds by default; this case counts every lane
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
            const door = end?.querySelector<HTMLElement>('[data-command="go-accounts"]'); // not 'button': the fold's control comes first
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

// The fold's words for the fixture: 13 lanes hidden, of which `w1` has a lapsed sign-in and `w16` sits at its 5h limit.
const FOLDED_WORDS = '+13 more · 1 sign-in expired · 1 rate-limited';

/** Open the app with the 17-lane fixture, folded unless `expanded`, and wait for the strip's cards (`cards` of them), its
 *  control and a session row. */
async function openFolded(view: AppView, cards: number, expanded = false, sessionRows?: number): Promise<Awaited<ReturnType<typeof openApp>> & { order: string[] }> {
  const { fixture: base, cases } = seventeen();
  // `sessionRows` swaps the fleet for that many sessions in one project (the first project card opens, so each is a
  // session row, as the first fixture's attention session opens its card): a document tall enough that folding the strip cannot shorten it below the scrolled position.
  const fixture: AppFixture = sessionRows === undefined ? base : {
    ...base,
    fleetFrames: [{ type: 'fleet', sessions: Array.from({ length: sessionRows }, (_, i) => fleetSession({ id: `s${i}`, project: 'proj-0', bucket: i === 0 ? 'attention' : 'idle' })) }],
  };
  const opened = await openApp(browser!, view, fixture);
  if (expanded) await seedStripExpanded(opened.ctx);
  await opened.page.goto(server!.origin + '/');
  await opened.page.waitForFunction((n) => document.querySelectorAll('.accounts-strip .account-gauge').length === n
    && document.querySelector('.accounts-end [aria-expanded]') !== null && document.querySelector('.sess-line') !== null, cards, { timeout: 20_000 });
  await opened.page.waitForTimeout(300);
  return { ...opened, order: mostFreeFirst(cases).map((c) => c.label) };
}

const FOLDED_VIEWS: AppView[] = [
  ...THEMES.flatMap((theme) => [360, 390].map((width) => ({ skin: REFINED, theme, width }))),
  { skin: INSTRUMENT, theme: PHOSPHOR, width: 390 },
];

describe('the folded phone strip is four cards and one control', () => {
  for (const view of FOLDED_VIEWS) {
    it(`folded, with 17 lanes at 360 and 390, four cards and one control at least 44 px tall, nothing scrolls sideways, and the first session row sits at most 440 px down at 390×844: ${named(view)}`, async () => {
      const { ctx, page, errors, order } = await openFolded(view, 4);
      try {
        const found = await page.evaluate(({ expected, expectedWords }) => {
          const out: string[] = [];
          const strip = document.querySelector<HTMLElement>('.accounts-strip')!;
          const cards = [...strip.querySelectorAll<HTMLElement>('.account-gauge')];
          const names = cards.map((c) => c.querySelector('.account-gauge-label')?.textContent ?? '');
          if (names.join('|') !== expected.join('|')) out.push(`the cards read [${names}], not the freest four [${expected}]`);
          // Mounted, never CSS-hidden: the whole document holds those four cards and no more.
          const all = document.querySelectorAll('.account-gauge').length;
          if (all !== 4) out.push(`${all} cards are mounted, not 4`);
          const lefts = new Set(cards.map((c) => Math.round(c.getBoundingClientRect().left)));
          if (lefts.size !== 2) out.push(`the cards sit in ${lefts.size} columns`);
          const vw = window.innerWidth;
          for (const [i, c] of cards.entries()) {
            const r = c.getBoundingClientRect();
            if (r.left < -0.5 || r.right > vw + 0.5) out.push(`${names[i]}'s card runs past the viewport`);
          }
          const end = strip.querySelector<HTMLElement>('.accounts-end')!;
          const control = end.querySelector<HTMLElement>('[aria-expanded]');
          const door = end.querySelector<HTMLElement>('[data-command="go-accounts"]');
          if (control === null || door === null) return [...out, 'the end cell lacks the control or All accounts'];
          const cr = control.getBoundingClientRect();
          const dr = door.getBoundingClientRect();
          const lowest = Math.max(...cards.map((c) => c.getBoundingClientRect().bottom));
          if (control.getAttribute('aria-expanded') !== 'false') out.push(`aria-expanded is ${control.getAttribute('aria-expanded')}`);
          if (control.getAttribute('aria-controls') !== strip.id || strip.id === '') out.push('aria-controls does not name the cards\' group');
          if (control.hasAttribute('data-command') || control.hasAttribute('data-action')) out.push('the control is a door');
          if (control.textContent !== expectedWords) out.push(`the control reads "${control.textContent}"`);
          if (cr.height < 43.5) out.push(`the control is ${Math.round(cr.height)} tall`);
          if (dr.height < 43.5) out.push(`All accounts is ${Math.round(dr.height)} tall`);
          if (cr.top < lowest - 0.5) out.push(`the control (top ${cr.top}) is not under the cards (bottom ${lowest})`);
          if (Math.abs(cr.top - dr.top) > 1) out.push(`the control (top ${cr.top}) and All accounts (top ${dr.top}) are not on one row`);
          if (cr.left < -0.5 || dr.right > vw + 0.5 || cr.right > dr.left + 0.5) out.push(`the end row is cut or overlaps (${cr.left}..${cr.right}, ${dr.left}..${dr.right} in ${vw})`);
          if (control.scrollWidth > control.clientWidth + 0.5) out.push("the control's words are cut");
          if (document.documentElement.scrollWidth > vw + 0.5) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
          // The first session row, in document order, at Refined's 390×844 (Instrument's head is its own, so only its cards
          // and control are held here).
          const sess = document.querySelector('.sess-line')!.getBoundingClientRect().top;
          if (strip.closest('.ref-phone-head') !== null && vw === 390 && sess > 440) out.push(`the first session row is ${Math.round(sess)} px down, not at most 440`);
          return out;
        }, { expected: order.slice(0, 4), expectedWords: FOLDED_WORDS });
        expect(found).toEqual([]);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 60_000);
  }

  it('expanded, with 17 lanes at 390×844 the first session row sits where the expanded strip put it (805, within 4 px)', async () => {
    const { ctx, page, errors } = await openFolded({ skin: REFINED, theme: PHOSPHOR, width: 390 }, 17, true);
    try {
      const found = await page.evaluate(() => ({
        top: document.querySelector('.sess-line')!.getBoundingClientRect().top,
        words: document.querySelector('.accounts-end [aria-expanded]')?.textContent,
        expanded: document.querySelector('.accounts-end [aria-expanded]')?.getAttribute('aria-expanded'),
      }));
      expect(found.words).toBe('Show fewer');
      expect(found.expanded).toBe('true');
      expect(Math.abs(found.top - 805), `the first session row is at ${found.top}`).toBeLessThanOrEqual(4);
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  }, 60_000);

  for (const theme of THEMES) {
    for (const [width, rows] of [[699, 2], [700, 1], [899, 1]] as const) {
      it(`at 699 the folded strip is two rows of two, and at 700 and 899 one row of four: ${theme}, ${width}px`, async () => {
        const { ctx, page, errors } = await openFolded({ skin: REFINED, theme, width }, 4);
        try {
          const found = await page.evaluate(() => {
            const cards = [...document.querySelectorAll<HTMLElement>('.accounts-strip .account-gauge')];
            const distinct = (xs: number[]): number => new Set(xs.map((x) => Math.round(x))).size;
            const boxes = cards.map((c) => c.getBoundingClientRect());
            return { count: cards.length, rows: distinct(boxes.map((b) => b.top)), columns: distinct(boxes.map((b) => b.left)), sideways: document.documentElement.scrollWidth > innerWidth + 0.5 };
          });
          expect(found).toEqual({ count: 4, rows, columns: 4 / rows, sideways: false });
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }, 60_000);
    }
  }

  // Refined only: Instrument's fleet list scrolls inside its own column, so its document never grows tall enough to hold the case.
  for (const view of FOLDED_VIEWS.filter((v) => v.theme === PHOSPHOR && v.skin === REFINED)) {
    it(`after Show fewer the control is focused and on screen: ${named(view)}`, async () => {
      // Thirty session rows: once the strip folds the document is still taller than the scrolled position plus the screen,
      // so the browser's own scroll clamp cannot bring the control back and only the product's scroll-into-view can.
      const { ctx, page, errors } = await openFolded(view, 17, true, 30);
      try {
        // Chrome's scroll anchoring would hold the control where it is when the cards above it go away, which the browsers
        // without it (Safari, so every iPhone) do not: switch it off, so the case sees what the product itself does.
        await page.addStyleTag({ content: '*, *::before, *::after { overflow-anchor: none !important; }' });
        // Scroll the page until the control sits near the top of the screen, as it does after a long look down the list,
        // then fold with a real click.
        const scrolled = await page.evaluate(() => {
          const doc = document.scrollingElement!;
          const top = document.querySelector('.accounts-end [aria-expanded]')!.getBoundingClientRect().top + doc.scrollTop;
          doc.scrollTo(0, Math.max(0, top - 6));
          return doc.scrollTop;
        });
        expect(scrolled, 'the page scrolled down to the control').toBeGreaterThan(300);
        await page.waitForTimeout(150);
        await page.locator('.accounts-end [aria-expanded]').click();
        await page.waitForFunction(() => document.querySelectorAll('.accounts-strip .account-gauge').length === 4, undefined, { timeout: 10_000 });
        await page.waitForTimeout(400); // the scroll into view settles
        const found = await page.evaluate((scrolledTo) => {
          const control = document.querySelector<HTMLElement>('.accounts-end [aria-expanded]')!;
          const r = control.getBoundingClientRect();
          const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
          const doc = document.scrollingElement!;
          return {
            // The clamp cannot have moved the page: it is still where the case left it, with room to spare below.
            roomToScroll: doc.scrollHeight >= scrolledTo + window.innerHeight,
            expanded: control.getAttribute('aria-expanded'), focused: document.activeElement === control,
            onScreen: r.top >= -0.5 && r.bottom <= window.innerHeight + 0.5 && r.left >= -0.5 && r.right <= window.innerWidth + 0.5,
            uncovered: hit !== null && control.contains(hit),
          };
        }, scrolled);
        expect(found).toEqual({ roomToScroll: true, expanded: 'false', focused: true, onScreen: true, uncovered: true });
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 60_000);
  }
});
