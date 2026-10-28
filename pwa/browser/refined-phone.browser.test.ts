// Refined's phone header, accounts strip and `+ New` (W2 Task S5, D-5471; the strip is the full one again, desktop-polish
// S5a), in a real Chrome over the production build.
//
// What jsdom cannot hold: at 360, 390 and 438 in both palettes, with a three-digit Runs count and five lanes, the
// header is one row with nothing cut, every door is at least 44 x 44 under the phone's touch screen, the readout is one
// line, the strip's lane cards sit in two columns, the `+ New` clears the last card once the list is scrolled to its
// end and sits above a 34 px home indicator (emulated through the DevTools protocol, so `env(safe-area-inset-bottom)` is
// non-zero), a real toast (`ToastHost`'s, raised by the update line's dismiss) sits above it, and the page does not
// scroll sideways (R13 F1 and F2, carried by T2b, D-6328). At 900,
// 1280 and 1920 no `+ New` is mounted (the bar's button is the door). Instrument's phone keeps today's head and round
// `+` (S11). With seventeen lanes at 360 and 390 the folded strip's four cards read most free first, each shows its
// windows, every countdown it prints is seen (a client rect inside the card, not covered), and All accounts has a row of
// its own under the cards; the same checks run over the phone's PANEL, which holds all seventeen (T2c, D-6329; R18 F4,
// F5; S5c).
//
// THE FOLD AND THE PHONE'S PANEL (desktop polish S5b, D-6530; S5c, phone-strip-tap-panel, phone-fold-two-lines). Below
// 900 px the strip is always folded and the stored choice (`seedStripExpanded`) is neither read nor written. With the
// same seventeen lanes (`test/seventeenLanes.ts`, the fixture every strip suite shares) a phone shows two lines of the
// tracks its grid draws: four cards in two rows of two below 700 (360, 390, 438 and 699), eight in two rows of four from
// 700 (700 and 899); the control and All accounts share one row, nothing scrolls sideways, and the first session row sits
// at most 440 px down in Refined and at most 540 px down in Instrument at 390x844, with the choice stored expanded too.
// A real tap on the control (`locator.tap()`, a touch screen below 900) opens the panel: every lane in order, hung from
// the strip's bottom edge, drawn over the content with no push of the page, bounded by the room left under the strip and
// scrolling inside itself when it is taller (also with a release waiting). A tap outside the strip and the panel, Escape
// and a second tap on the control close it; closing leaves focus on the control, on screen.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/refined-phone.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
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
      // A three-digit Runs badge: 120 runs whose worker (`s0`) waits on the operator (T2d, D-6330).
      runs: Array.from({ length: 120 }, (_, i) => ({
        id: i + 1, program: 'p', programTitle: 'P', wave: 1, waveOf: 1, project: 'x', homeProject: null, state: 'working', closedAt: null,
        sessionId: 's0', claimedBy: null,
      })),
    },
  ],
};

/** The home indicator's height on a phone with one, emulated as the bottom safe-area inset (R13 F2: a zero inset
 *  proved nothing about `--safe-bottom`). */
const HOME_INDICATOR = 34;

/** Give the page a bottom safe-area inset of `HOME_INDICATOR` px before it is navigated. A Chrome without the command
 *  rejects it, and the case goes red, never measures at zero. */
async function insetHomeIndicator(ctx: BrowserContext, page: Page): Promise<void> {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom: HOME_INDICATOR } });
}

/** A release waits (the shape `update-indicator.browser.test.ts` uses), so the update line and its dismiss mount: the
 *  dismiss raises a real toast through `ToastHost`, which is what R13 F1 asked the toast case to measure. */
const node = (role: 'fleet' | 'server', id: string) => ({
  nodeId: id, role, label: role, os: 'linux',
  current: { sha: 'bd2bf57a91c3e0d4f6a8b2c5e7d9f1a3b5c7e9d1', ref: 'main', builtAt: '2026-09-20T12:00:00Z', dirty: false, version: 'v0.0.7' },
  stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['update-gate'], agentOps: role === 'server' ? null : [], highestVersion: 'v0.0.7', previousVersion: null,
  floorRead: 'measured', previousRead: 'absent',
  measuredAt: Date.now() - 60_000, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: 'v0.0.9', resolveDetail: null, request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
});
const WAITING: AppFixture = {
  ...FIXTURE,
  api: {
    ...FIXTURE.api,
    '/api/updates': {
      catalogue: { lastOkAt: Date.now() - 240_000, lastError: null }, releases: [],
      nodes: [node('fleet', '0b6e1c62-7a4f-4d0e-9c1a-3f2d5e8a9b10'), node('server', '5f3a9d21-2c8b-4e6f-a1d7-8b0c4e2f6a93')], intent: [],
    },
  },
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
        await insetHomeIndicator(ctx, page);
        await page.goto(server!.origin + '/');
        await page.waitForFunction(() => document.querySelectorAll('.ref-phone-head .account-gauge').length === 5
          && document.querySelector('.ref-phone-head [aria-label="Inbox, 1 waiting for you"]') !== null
          && document.querySelector('.ref-phone-head [aria-label="Runs, 120 needs you"]') !== null
          && document.querySelectorAll('.proj-card').length > 0 && document.querySelector('.ref-fab') !== null, undefined, { timeout: 20_000 });
        await page.waitForTimeout(200); // the FAB's ResizeObserver publishes
        const faults = await page.evaluate((inset) => {
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
          const badges = [...row.querySelectorAll<HTMLElement>('.ref-phone-badge')];
          if (badges.length !== 2) out.push(`${badges.length} badges, not Inbox's and Runs'`);
          for (const badge of badges) {
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
          if (window.innerHeight - fab.bottom < inset + 8) out.push(`+ New sits on the home indicator (${window.innerHeight - fab.bottom} px clear of the edge, inset ${inset})`);
          if (document.documentElement.scrollWidth > window.innerWidth + 0.5) out.push('the page scrolls sideways');
          return out;
        }, HOME_INDICATOR);
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

  for (const view of PHONES) {
    it(`a real toast sits above + New, over a ${HOME_INDICATOR} px home indicator: ${named(view)}`, async () => {
      const { ctx, page, errors } = await openApp(browser!, view, WAITING);
      try {
        await insetHomeIndicator(ctx, page);
        await page.goto(server!.origin + '/');
        await page.waitForFunction(() => document.querySelector('.ref-fab') !== null
          && document.querySelector('.update-indicator-dismiss') !== null, undefined, { timeout: 20_000 });
        await page.waitForTimeout(200); // the FAB's ResizeObserver publishes
        await page.click('.update-indicator-dismiss');
        await page.waitForSelector('.toast-host .toast', { timeout: 20_000 });
        await page.waitForTimeout(400); // the toast's entry animation settles
        const seen = await page.evaluate(() => {
          const fab = document.querySelector<HTMLElement>('.ref-fab')!.getBoundingClientRect();
          const toasts = [...document.querySelectorAll<HTMLElement>('.toast-host .toast')].map((t) => t.getBoundingClientRect());
          return { fabTop: fab.top, toastBottom: Math.max(...toasts.map((t) => t.bottom)), count: toasts.length };
        });
        expect(seen.count).toBe(1);
        expect(seen.toastBottom, `the toast's bottom ${seen.toastBottom} vs + New's top ${seen.fabTop}`).toBeLessThanOrEqual(seen.fabTop + 0.5);
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
  // The tie keys are not written out here (see above): an exact tie in the shared fixture must be noticed, not ordered by guess.
  for (let i = 1; i < ranked.length; i++) if (ranked[i]!.pct === ranked[i - 1]!.pct) throw new Error(`the shared fixture now ties on binding use (${ranked[i]!.c.label}): write the tie keys into mostFreeFirst, as lanes-row's orderOf does`);
  return [...ranked.map((e) => e.c), ...last];
}

/** Open the phone's panel with a real tap on the fold's control (the context has a touch screen below 900) and wait for it. */
async function openPanel(page: Page): Promise<void> {
  await page.locator('.accounts-end [aria-expanded]').tap();
  await page.waitForSelector('.accounts-flyout', { timeout: 10_000 });
  await page.waitForTimeout(150); // paint
}

/** The readability checks of a group of lane cards: `cardSel` selects the group's cards, `expected` the lanes in order, and
 *  `inside` the box the group sits in (the panel), whose cards are scrolled into view before their rects are judged. Runs
 *  in the page. */
function cardFaults({ expected, cardSel, inside }: { expected: Array<{ label: string; windows: string[]; counted: boolean[] }>; cardSel: string; inside: string | null }): string[] {
  const out: string[] = [];
  const cards = [...document.querySelectorAll<HTMLElement>(cardSel)];
  const labelOf = (c: HTMLElement): string => c.querySelector('.account-gauge-label')?.textContent ?? '';
  const names = cards.map(labelOf);
  if (cards.length !== expected.length) out.push(`${cards.length} cards, not ${expected.length}`);
  if (names.join('|') !== expected.map((e) => e.label).join('|')) out.push(`the cards read [${names}], not most free first [${expected.map((e) => e.label)}]`);
  const vw = window.innerWidth;
  const box = inside === null ? null : document.querySelector<HTMLElement>(inside);
  for (const card of cards) {
    const want = expected.find((e) => e.label === labelOf(card));
    if (want === undefined) { out.push(`${labelOf(card)} is not a lane of the fixture`); continue; }
    // A card below the panel's visible area is scrolled into view inside the panel before it is judged.
    if (box !== null) card.scrollIntoView({ block: 'nearest' });
    const cr = card.getBoundingClientRect();
    if (box !== null) {
      const pr = box.getBoundingClientRect();
      if (cr.top < pr.top - 0.5 || cr.bottom > pr.bottom + 0.5) out.push(`${want.label}'s card is not inside the panel's visible box once scrolled to`);
    }
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
  return out;
}

describe("with 17 lanes the phone's strip keeps every card readable", () => {
  for (const theme of THEMES) {
    for (const width of [360, 390]) {
      it(`with 17 lanes at 360 and 390 the folded line's four cards and the tapped panel's seventeen run most free first, each shows its windows and every countdown it prints is seen, a long label is cut inside its card, All accounts sits on a row under the cards, and nothing scrolls sideways: ${theme}, ${width}px`, async () => {
        const { ctx, page, errors, order } = await openFolded({ skin: REFINED, theme, width }, 4);
        const { cases } = seventeen();
        const expected = mostFreeFirst(cases).map((c) => ({ label: c.label, windows: c.windows, counted: c.counted }));
        expect(order).toEqual(expected.map((e) => e.label));
        try {
          // The folded line: its four freest cards, then the control and All accounts on one row under them.
          const cardsOfLine = await page.evaluate(cardFaults, { expected: expected.slice(0, 4), cardSel: '.ref-phone-head .accounts-strip > .account-gauge', inside: null });
          const end = await page.evaluate(() => {
            const out: string[] = [];
            const strip = document.querySelector<HTMLElement>('.ref-phone-head .accounts-strip')!;
            const cards = [...strip.querySelectorAll<HTMLElement>(':scope > .account-gauge')];
            const endCell = strip.querySelector<HTMLElement>(':scope > .accounts-end');
            const door = endCell?.querySelector<HTMLElement>('[data-command="go-accounts"]'); // not 'button': the fold's control comes first
            const vw = window.innerWidth;
            if (endCell === null || door === null || door === undefined) out.push('no All accounts');
            else {
              const er = endCell.getBoundingClientRect();
              const dr = door.getBoundingClientRect();
              const lowest = Math.max(...cards.map((c) => c.getBoundingClientRect().bottom));
              if (er.top < lowest - 0.5) out.push(`All accounts (top ${er.top}) is not under the cards (bottom ${lowest})`);
              if (dr.left < -0.5 || dr.right > vw + 0.5) out.push('All accounts is outside the viewport');
              if (dr.height < 43.5) out.push(`All accounts is ${Math.round(dr.height)} tall`);
              // The tab order the plan states: the control, when there is one, comes before All accounts.
              const control = endCell.querySelector<HTMLElement>('[aria-expanded]');
              if (control === null || !(control.compareDocumentPosition(door) & Node.DOCUMENT_POSITION_FOLLOWING)) out.push('the fold control does not precede All accounts');
            }
            if (document.documentElement.scrollWidth > window.innerWidth + 0.5) out.push('the page scrolls sideways');
            return out;
          });
          expect([...cardsOfLine, ...end], 'the folded line').toEqual([]);

          // The panel a real tap opens: all seventeen, each scrolled into the panel's visible box before it is judged.
          await openPanel(page);
          const inPanel = await page.evaluate(cardFaults, { expected, cardSel: '.accounts-flyout .account-gauge', inside: '.accounts-flyout' });
          const sideways = await page.evaluate(() => {
            const out: string[] = [];
            if (document.documentElement.scrollWidth > window.innerWidth + 0.5) out.push('the page scrolls sideways');
            const fly = document.querySelector<HTMLElement>('.accounts-flyout')!;
            if (fly.scrollWidth > fly.clientWidth + 0.5) out.push('the panel scrolls sideways');
            return out;
          });
          expect([...inPanel, ...sideways], 'the panel').toEqual([]);
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

/** Open the app with the 17-lane fixture, with the stored choice expanded when `expanded` (a phone ignores it), and wait for the strip's cards (`cards` of them), its
 *  control and a session row. */
async function openFolded(view: AppView, cards: number, expanded = false, sessionRows?: number, waiting = false): Promise<Awaited<ReturnType<typeof openApp>> & { order: string[] }> {
  const { fixture: seeded, cases } = seventeen();
  // `waiting` adds a release waiting (the update line mounts above the list, and the strip sits lower).
  const base: AppFixture = waiting ? { ...seeded, api: { ...seeded.api, '/api/updates': WAITING.api['/api/updates'] } } : seeded;
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
  if (waiting) await opened.page.waitForSelector('.update-indicator', { timeout: 20_000 });
  await opened.page.waitForTimeout(300);
  return { ...opened, order: mostFreeFirst(cases).map((c) => c.label) };
}

/** How far down the first session row may sit at 390x844, folded, by skin. Refined's head is a phone header of its own and
 *  holds 440. Instrument's first row sits under its own chrome, the fleet head and the table's toggle, tabs and group
 *  header, which a fold of the strip cannot shorten, so its target is the figure measured there (533.8 px): the
 *  instrument-first-row-is-its-chrome ruling. */
const FIRST_ROW_MAX: Record<string, number> = { [REFINED]: 440, [INSTRUMENT]: 540 };

// One palette: these cases measure geometry (card counts, columns, tops, scroll width), which a palette does not change.
const FOLDED_VIEWS: AppView[] = [
  ...[PHOSPHOR].flatMap((theme) => [360, 390].map((width) => ({ skin: REFINED, theme, width }))),
  { skin: INSTRUMENT, theme: PHOSPHOR, width: 390 },
];

describe('the folded phone strip is four cards and one control', () => {
  for (const view of FOLDED_VIEWS) {
    const rowMax = FIRST_ROW_MAX[view.skin]!;
    it(`folded, with 17 lanes, four cards and one control at least 44 px tall and nothing scrolls sideways${view.width === 390 ? `, and the first session row sits at most ${rowMax} px down at 390×844` : ''}: ${named(view)}`, async () => {
      const { ctx, page, errors, order } = await openFolded(view, 4);
      try {
        const found = await page.evaluate(({ expected, expectedWords, rowMax }) => {
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
          // A phone's control names the panel it opens (not the cards' group, which is a desk's), and no panel is mounted while it is shut.
          const controls = control.getAttribute('aria-controls');
          if (controls === null || controls === '' || controls === strip.id) out.push(`aria-controls is ${JSON.stringify(controls)}, not the panel's id`);
          else if (document.getElementById(controls) !== null) out.push('the panel is mounted while the control is shut');
          if (control.hasAttribute('data-command') || control.hasAttribute('data-action')) out.push('the control is a door');
          if (control.textContent !== expectedWords) out.push(`the control reads "${control.textContent}"`);
          if (cr.height < 43.5) out.push(`the control is ${Math.round(cr.height)} tall`);
          if (dr.height < 43.5) out.push(`All accounts is ${Math.round(dr.height)} tall`);
          if (cr.top < lowest - 0.5) out.push(`the control (top ${cr.top}) is not under the cards (bottom ${lowest})`);
          if (Math.abs(cr.top - dr.top) > 1) out.push(`the control (top ${cr.top}) and All accounts (top ${dr.top}) are not on one row`);
          if (cr.left < -0.5 || dr.right > vw + 0.5 || cr.right > dr.left + 0.5) out.push(`the end row is cut or overlaps (${cr.left}..${cr.right}, ${dr.left}..${dr.right} in ${vw})`);
          if (control.scrollWidth > control.clientWidth + 0.5) out.push("the control's words are cut");
          if (document.documentElement.scrollWidth > vw + 0.5) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
          // The first session row, in document order, at 390×844, against the skin's own bound.
          const sess = document.querySelector('.sess-line')!.getBoundingClientRect().top;
          if (vw === 390 && sess > rowMax) out.push(`the first session row is ${Math.round(sess)} px down, not at most ${rowMax}`);
          return out;
        }, { expected: order.slice(0, 4), expectedWords: FOLDED_WORDS, rowMax });
        expect(found).toEqual([]);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 60_000);
  }

  it(`with the stored choice expanded a phone still shows the folded line: four cards, the control not expanded, the choice left as it was, and the first session row at most ${FIRST_ROW_MAX[REFINED]} px down at 390×844`, async () => {
    const { ctx, page, errors } = await openFolded({ skin: REFINED, theme: PHOSPHOR, width: 390 }, 4, true);
    try {
      const found = await page.evaluate(() => ({
        top: document.querySelector('.sess-line')!.getBoundingClientRect().top,
        words: document.querySelector('.accounts-end [aria-expanded]')?.textContent,
        expanded: document.querySelector('.accounts-end [aria-expanded]')?.getAttribute('aria-expanded'),
        cards: document.querySelectorAll('.account-gauge').length,
        stored: localStorage.getItem('ccrc-accounts-strip'),
      }));
      expect(found.cards).toBe(4);
      expect(found.words).toBe(FOLDED_WORDS);
      expect(found.expanded).toBe('false');
      expect(found.top, `the first session row is at ${found.top}`).toBeLessThanOrEqual(FIRST_ROW_MAX[REFINED]!);
      // A tap opens and closes the panel and writes no choice: what a desk stored is still there afterwards.
      await openPanel(page);
      await page.locator('.accounts-end [aria-expanded]').tap();
      await page.waitForSelector('.accounts-flyout', { state: 'detached', timeout: 10_000 });
      expect(await page.evaluate(() => localStorage.getItem('ccrc-accounts-strip')), 'the stored choice after a tap and a second tap').toBe(found.stored);
      expect(found.stored, 'the seeded choice stands').toBe('expanded');
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  }, 60_000);

  // Two lines of the tracks the grid draws: 2 columns below 700, 4 from 700, and always two lines (measured, not computed).
  const GRID_VIEWS: Array<{ skin: string; width: number; cards: number; columns: number }> = [
    { skin: REFINED, width: 699, cards: 4, columns: 2 }, { skin: REFINED, width: 700, cards: 8, columns: 4 }, { skin: REFINED, width: 899, cards: 8, columns: 4 },
    { skin: INSTRUMENT, width: 700, cards: 8, columns: 4 },
  ];
  for (const { skin, width, cards, columns } of GRID_VIEWS) {
    it(`at 699 the folded strip is two rows of two, and at 700 and 899 two rows of four: ${skin}, ${PHOSPHOR}, ${width}px`, async () => {
      const { ctx, page, errors } = await openFolded({ skin, theme: PHOSPHOR, width }, cards);
      try {
        const found = await page.evaluate(() => {
          const cards = [...document.querySelectorAll<HTMLElement>('.accounts-strip .account-gauge')];
          const distinct = (xs: number[]): number => new Set(xs.map((x) => Math.round(x))).size;
          const boxes = cards.map((c) => c.getBoundingClientRect());
          return {
            count: cards.length, mounted: document.querySelectorAll('.account-gauge').length, rows: distinct(boxes.map((b) => b.top)), columns: distinct(boxes.map((b) => b.left)),
            expanded: document.querySelector('.accounts-end [aria-expanded]')?.getAttribute('aria-expanded'), sideways: document.documentElement.scrollWidth > innerWidth + 0.5,
          };
        });
        expect(found).toEqual({ count: cards, mounted: cards, rows: 2, columns, expanded: 'false', sideways: false });
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 60_000);
  }

  // Refined only: Instrument's fleet list scrolls inside its own column, so its document never grows tall enough to hold the case.
  const REFINED_FOLDED = FOLDED_VIEWS.filter((v) => v.theme === PHOSPHOR && v.skin === REFINED);
  for (const view of REFINED_FOLDED) {
    it(`after a second tap closes the panel the control is focused and on screen, and Escape from a focused panel card hands focus to the control: ${named(view)}`, async () => {
      // Thirty session rows, and the page scrolled until the control sits near the top of the screen, as after a long look
      // down the list: the panel's close must leave the control where the operator's thumb is.
      const { ctx, page, errors } = await openFolded(view, 4, false, 30);
      try {
        const scrolled = await page.evaluate(() => {
          const doc = document.scrollingElement!;
          const top = document.querySelector('.accounts-end [aria-expanded]')!.getBoundingClientRect().top + doc.scrollTop;
          doc.scrollTo(0, Math.max(0, top - 6));
          return doc.scrollTop;
        });
        expect(scrolled, 'the page scrolled down to the control').toBeGreaterThan(100);
        await page.waitForTimeout(150);
        const control = (): Promise<{ expanded: string | null; focused: boolean; onScreen: boolean; uncovered: boolean; scroll: number; panels: number }> => page.evaluate(() => {
          const c = document.querySelector<HTMLElement>('.accounts-end [aria-expanded]')!;
          const r = c.getBoundingClientRect();
          const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
          return {
            expanded: c.getAttribute('aria-expanded'), focused: document.activeElement === c,
            onScreen: r.top >= -0.5 && r.bottom <= window.innerHeight + 0.5 && r.left >= -0.5 && r.right <= window.innerWidth + 0.5,
            uncovered: hit !== null && c.contains(hit), scroll: document.scrollingElement!.scrollTop, panels: document.querySelectorAll('.accounts-flyout').length,
          };
        });
        await openPanel(page);
        expect(await control(), 'open').toMatchObject({ expanded: 'true', focused: true, onScreen: true, panels: 1 });
        await page.locator('.accounts-end [aria-expanded]').tap();
        await page.waitForSelector('.accounts-flyout', { state: 'detached', timeout: 10_000 });
        await page.waitForTimeout(300);
        const closed = await control();
        expect(closed, 'after the second tap').toMatchObject({ expanded: 'false', focused: true, onScreen: true, uncovered: true, panels: 0 });
        expect(Math.abs(closed.scroll - scrolled), 'the page did not move').toBeLessThanOrEqual(1);

        // Escape from a focused card of the panel: the panel closes and the control holds focus.
        await openPanel(page);
        await page.focus('.accounts-flyout .account-gauge[tabindex="0"]');
        await page.keyboard.press('Escape');
        await page.waitForSelector('.accounts-flyout', { state: 'detached', timeout: 10_000 });
        expect(await control(), 'after Escape from a panel card').toMatchObject({ expanded: 'false', focused: true, onScreen: true, panels: 0 });
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 60_000);
  }
});

// What the tapped panel measures: boxes and words, judged in Node.
interface PanelMeasure {
  names: string[];
  panelTop: number; panelBottom: number; panelClient: number; panelScroll: number; overflowY: string; position: string;
  stripBottom: number; vh: number; docHeight: number; firstRowTop: number;
  controlHeight: number; controlExpanded: string | null; controlsId: string | null; panelId: string;
  sideways: string[]; ownHit: boolean; lastReached: boolean; docScrollTop: number;
}

/** Measure the open panel. `reach` scrolls it to its end first and judges the last card (scrolling inside itself). */
function measurePanel(reach: boolean): PanelMeasure {
  const strip = document.querySelector<HTMLElement>('.accounts-strip')!;
  const fly = document.querySelector<HTMLElement>('.accounts-flyout')!;
  const control = document.querySelector<HTMLElement>('.accounts-end [aria-expanded]')!;
  const cards = [...fly.querySelectorAll<HTMLElement>('.account-gauge')];
  const docTop = document.scrollingElement!.scrollTop;
  const before = { docHeight: document.documentElement.scrollHeight, firstRowTop: document.querySelector('.sess-line')!.getBoundingClientRect().top };
  let lastReached = true;
  if (reach) {
    fly.scrollTop = fly.scrollHeight;
    const lr = cards.at(-1)!.getBoundingClientRect();
    const pr = fly.getBoundingClientRect();
    const hit = document.elementFromPoint((lr.left + lr.right) / 2, (lr.top + lr.bottom) / 2);
    lastReached = lr.bottom <= pr.bottom + 0.5 && lr.top >= pr.top - 0.5 && lr.bottom <= window.innerHeight + 0.5 && hit !== null && cards.at(-1)!.contains(hit);
    fly.scrollTop = 0;
  }
  const fr = fly.getBoundingClientRect();
  const sr = strip.getBoundingClientRect();
  const cr = control.getBoundingClientRect();
  // A point inside the panel's visible box: its middle, clipped to the viewport. What is there must be the panel's own.
  const px = (fr.left + fr.right) / 2;
  const py = (Math.max(fr.top, 0) + Math.min(fr.bottom, window.innerHeight)) / 2;
  const at = document.elementFromPoint(px, py);
  return {
    names: cards.map((c) => c.querySelector('.account-gauge-label')?.textContent ?? ''),
    panelTop: fr.top, panelBottom: fr.bottom, panelClient: fly.clientHeight, panelScroll: fly.scrollHeight, overflowY: getComputedStyle(fly).overflowY, position: getComputedStyle(fly).position,
    stripBottom: sr.bottom, vh: window.innerHeight, ...before, docScrollTop: docTop,
    controlHeight: cr.height, controlExpanded: control.getAttribute('aria-expanded'), controlsId: control.getAttribute('aria-controls'), panelId: fly.id,
    sideways: [
      document.documentElement.scrollWidth > window.innerWidth + 0.5 ? 'the page' : '',
      fly.scrollWidth > fly.clientWidth + 0.5 ? 'the panel' : '',
    ].filter((x) => x !== ''),
    ownHit: at !== null && fly.contains(at), lastReached,
  };
}

/** A point on the page outside the strip and the panel that is no door, button or link (nothing there reacts to a tap; the page's own scroll root, a tabindex -1 section, is not a door), or
 *  null when the grid finds none. Runs in the page. */
function pointOutside(): { x: number; y: number } | null {
  const strip = document.querySelector('.accounts-strip')!;
  const live = 'a, button, input, textarea, select, summary, [role="link"], [role="button"], [role="tab"], [data-command], [data-action], [tabindex]:not([tabindex="-1"])';
  for (let y = 12; y < window.innerHeight; y += 20) {
    for (let x = 6; x < window.innerWidth; x += 24) {
      const el = document.elementFromPoint(x, y);
      if (el === null || strip.contains(el) || el.closest(live) !== null) continue;
      return { x, y };
    }
  }
  return null;
}

// The phone's panel at 390x844: a tap on the control opens every lane in a panel that hangs from the strip, is drawn over
// the content, is bounded by the room under the strip, and closes on a tap outside, on Escape and on a second tap.
const PANEL_VIEWS: AppView[] = [REFINED, INSTRUMENT].flatMap((skin) => THEMES.map((theme) => ({ skin, theme, width: 390 })));

describe("the phone's panel", () => {
  for (const view of PANEL_VIEWS) {
    it(`a tap on the control opens all seventeen lanes in a panel under the strip, over the content, within the viewport, pushing nothing; a tap outside and Escape close it: ${named(view)}`, async () => {
      const { ctx, page, errors, order } = await openFolded(view, 4);
      try {
        const before = await page.evaluate(measurePanelBaseline);
        await openPanel(page);
        const m = await page.evaluate(measurePanel, true);
        const out: string[] = [];
        if (m.names.join('|') !== order.join('|')) out.push(`the panel reads [${m.names}], not every lane most free first [${order}]`);
        if (m.position !== 'absolute') out.push(`the panel is ${m.position}-positioned`);
        if (m.panelTop < m.stripBottom - 0.5) out.push(`the panel (top ${m.panelTop}) is not under the strip (bottom ${m.stripBottom})`);
        if (m.panelBottom > m.vh + 0.5) out.push(`the panel (bottom ${m.panelBottom}) runs below the viewport (${m.vh})`);
        const room = m.vh - m.stripBottom;
        if (m.panelClient > room + 0.5) out.push(`the panel is ${m.panelClient} tall in a room of ${room}`);
        if (m.panelScroll > m.panelClient + 1 && m.overflowY !== 'auto' && m.overflowY !== 'scroll') out.push(`the panel is taller than it shows and does not scroll (${m.overflowY})`);
        if (!m.lastReached) out.push('the last card is not reachable inside the panel');
        if (Math.abs(m.docHeight - before.docHeight) > 0.5) out.push(`the page's height went from ${before.docHeight} to ${m.docHeight}: the panel pushes the page`);
        if (Math.abs(m.firstRowTop - before.firstRowTop) > 0.5) out.push(`the first session row moved from ${before.firstRowTop} to ${m.firstRowTop}: the panel pushes the content`);
        if (m.sideways.length > 0) out.push(`${m.sideways.join(', ')} scrolls sideways`);
        if (!m.ownHit) out.push('the element at the panel\'s middle is not the panel: it is drawn under something');
        if (m.controlHeight < 43.5) out.push(`the control is ${Math.round(m.controlHeight)} tall`);
        if (m.controlExpanded !== 'true') out.push(`the control's aria-expanded is ${m.controlExpanded}`);
        if (m.controlsId !== m.panelId || m.panelId === '') out.push(`aria-controls (${m.controlsId}) does not name the panel (${m.panelId})`);
        expect(out).toEqual([]);

        // A tap outside the strip and the panel, on something that is no door, closes it.
        const point = await page.evaluate(pointOutside);
        expect(point, 'a point outside the strip and the panel that is no door').not.toBeNull();
        await page.touchscreen.tap(point!.x, point!.y);
        await page.waitForSelector('.accounts-flyout', { state: 'detached', timeout: 10_000 });
        expect(await page.evaluate(() => document.querySelector('.accounts-end [aria-expanded]')?.getAttribute('aria-expanded')), 'after a tap outside').toBe('false');

        // Escape closes it too.
        await openPanel(page);
        await page.keyboard.press('Escape');
        await page.waitForSelector('.accounts-flyout', { state: 'detached', timeout: 10_000 });
        expect(await page.evaluate(() => document.querySelector('.accounts-end [aria-expanded]')?.getAttribute('aria-expanded')), 'after Escape').toBe('false');
        // Closed, the page is where it was.
        expect(await page.evaluate(measurePanelBaseline)).toEqual(before);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 60_000);

    it(`with a release waiting the panel stays inside the viewport, bounded by the room under the strip, and scrolls inside itself to its last card: ${named(view)}`, async () => {
      const { ctx, page, errors } = await openFolded(view, 4, false, undefined, true);
      try {
        const before = await page.evaluate(measurePanelBaseline);
        await openPanel(page);
        const m = await page.evaluate(measurePanel, true);
        const out: string[] = [];
        const room = m.vh - m.stripBottom;
        if (m.panelTop < m.stripBottom - 0.5) out.push(`the panel (top ${m.panelTop}) is not under the strip (bottom ${m.stripBottom})`);
        if (m.panelBottom > m.vh + 0.5) out.push(`the panel (bottom ${m.panelBottom}) runs below the viewport (${m.vh})`);
        if (m.panelClient > room + 0.5) out.push(`the panel is ${m.panelClient} tall in a room of ${room}`);
        if (view.skin === INSTRUMENT && m.panelScroll <= m.panelClient + 0.5) out.push(`the panel fits (${m.panelScroll} in ${m.panelClient}): the case does not exercise its scrolling`);
        if (m.panelScroll > m.panelClient + 1 && m.overflowY !== 'auto' && m.overflowY !== 'scroll') out.push(`the panel is taller than it shows and does not scroll (${m.overflowY})`);
        if (!m.lastReached) out.push('the last card is not reachable by scrolling inside the panel');
        if (m.docScrollTop !== before.docScrollTop) out.push('the page scrolled when the panel opened');
        if (Math.abs(m.docHeight - before.docHeight) > 0.5) out.push(`the page's height went from ${before.docHeight} to ${m.docHeight}`);
        if (Math.abs(m.firstRowTop - before.firstRowTop) > 0.5) out.push(`the first session row moved from ${before.firstRowTop} to ${m.firstRowTop}`);
        if (m.sideways.length > 0) out.push(`${m.sideways.join(', ')} scrolls sideways`);
        if (!m.ownHit) out.push('the element at the panel\'s middle is not the panel');
        expect(out).toEqual([]);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 60_000);
  }
});

/** The page's height and its first session row's top: what an open panel must leave where it was. Runs in the page. */
function measurePanelBaseline(): { docHeight: number; firstRowTop: number; docScrollTop: number } {
  return {
    docHeight: document.documentElement.scrollHeight,
    firstRowTop: document.querySelector('.sess-line')!.getBoundingClientRect().top,
    docScrollTop: document.scrollingElement!.scrollTop,
  };
}
