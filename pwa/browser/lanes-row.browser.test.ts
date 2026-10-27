// The lanes row in a real Chrome over the production build (desktop-polish T2c, D-6329; R18 F4/F5, R27). Both desk
// bars mount the full accounts strip under their line, inside the frame's header (`header.shell-accounts`): a card per
// lane, most free first, and All accounts in the track after the last card. What jsdom cannot hold lives here, with
// SEVENTEEN neutral lanes in the roster (one rolled over, one never read, one measured at 0%, one critical, one signed
// out, one weekly-only, one with a long name), so the row wraps onto several lines at the widths below:
//
//  1. At 900, 1280 and 1920, in both skins and both palettes: the row spans the header under the bar's line; every card
//     is whole inside the row, and every countdown it prints is seen (a client rect inside its card, the element at its
//     centre its own); the cards are in the order the lanes' binding use gives (lowest first, a lane never read and a
//     sign-in expired last); All accounts, the go-accounts door, sits in the track after the last card; the long name is
//     cut, with its full name in its `title`; nothing scrolls sideways.
//  2. In Refined with a release waiting and two banners up (the halt, the fleet-host banner; fresh and stale), the update line
//     is a row of its own under the header and the banner stack, and the lanes row sits above it: the banners are mounted
//     and have a height, nothing overlaps, the detail pane starts below the line.
//  3. Under a coarse pointer (a touch screen, emulated with `openApp`'s `touch`: headless Chrome ignores the DevTools
//     pointer media feature, measured) every card and All accounts is at least 44 px tall, at a desk and on a phone.
//  4. New session ends at the bar line's content edge (its right edge less the header's gutter, +-1 px): the lanes row
//     under the line must not move it.
//  5. The meter's inset ring (D-6329) reaches the session screen: the Workflows strip draws a `Meter` per row, and each
//     track wears the 1 px inset ring in the tertiary ink (review 940 O5).
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts --maxWorkers=2 browser/lanes-row.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, seedStripExpanded, serveDist, type AppFixture, type AppView, type DistServer } from './app';
import { fleetSession } from '../test/fleetFixture';
import type { WorkflowView } from '../../shared/workflows';

const THEMES = [PHOSPHOR, 'light'];
const SKINS = [REFINED, INSTRUMENT];
const WIDTHS = [900, 1280, 1920];
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px${v.touch === true ? ', touch' : ''}`;

const MIN = 60_000;
const nowSec = Math.floor(Date.now() / 1000);
const LONG = 'lane-with-a-much-longer-name';

/** One lane as the wire gives it, and what the card must show. */
interface Lane {
  readonly acct: Record<string, unknown>;
  readonly label: string;
}

/** Seventeen lanes, `lane-a` ... `lane-q`. Index 1 rolled over (5h zeroed by the server), 2 never read, 3 measured at 0%,
 *  4 critical (97%), 5 signed out, 6 weekly-only, 7 the long name. */
const LANES: readonly Lane[] = Array.from({ length: 17 }, (_, i) => {
  const acct: Record<string, unknown> = {
    wrapper: `w${i}`, five: 8 + ((i * 11) % 60), seven: 15 + ((i * 7) % 50), ts: nowSec - 60,
    fiveResetAt: nowSec + 3600 * (1 + (i % 4)) + 600, sevenResetAt: nowSec + 86_400 * (1 + (i % 5)) + 7200,
    fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false,
  };
  if (i === 1) Object.assign(acct, { five: 0, fiveRolledOver: true, fiveResetAt: nowSec - 120 });
  if (i === 2) Object.assign(acct, { five: null, seven: null, fiveResetAt: null, sevenResetAt: null });
  if (i === 3) Object.assign(acct, { five: 0, seven: 0 });
  if (i === 4) Object.assign(acct, { five: 97, seven: 64 });
  if (i === 5) Object.assign(acct, { authDead: true, five: 55, seven: 40 });
  if (i === 6) Object.assign(acct, { five: null, fiveResetAt: null, seven: 35 });
  return { acct, label: i === 7 ? LONG : `lane-${String.fromCharCode(97 + i)}` };
});

/** The lanes most free first, worked out here from the rule and not by the app's decider: by the fuller window, lowest
 *  first, ties in roster order; a lane never read and a lane signed out go last, in roster order. */
function expectedOrder(): string[] {
  const used = (l: Lane): number | null => {
    const known = [l.acct['five'], l.acct['seven']].filter((p): p is number => typeof p === 'number');
    return known.length === 0 ? null : Math.max(...known);
  };
  const ranked = LANES.map((l, i) => ({ l, i, pct: used(l) })).filter((e) => e.pct !== null && e.l.acct['authDead'] !== true);
  const last = LANES.filter((l) => used(l) === null || l.acct['authDead'] === true);
  ranked.sort((x, y) => x.pct! - y.pct! || x.i - y.i);
  return [...ranked.map((e) => e.l.label), ...last.map((l) => l.label)];
}

/** Per lane, the windows its card must show, and for each whether a countdown must print (a reset ahead, not rolled over). */
function expectedWindows(): Record<string, Array<{ win: string; counted: boolean }>> {
  const out: Record<string, Array<{ win: string; counted: boolean }>> = {};
  for (const { acct, label } of LANES) {
    const rows: Array<{ win: string; counted: boolean }> = [];
    for (const [win, pct, at, rolled] of [['5h', 'five', 'fiveResetAt', 'fiveRolledOver'], ['7d', 'seven', 'sevenResetAt', 'sevenRolledOver']] as const) {
      if (acct[pct] === null) continue;
      const reset = acct[at];
      rows.push({ win, counted: typeof reset === 'number' && reset > nowSec && acct[rolled] !== true });
    }
    out[label] = rows;
  }
  return out;
}

const ACCOUNTS = {
  accounts: LANES.map((l) => l.acct), projected: null,
  roster: LANES.map((l, i) => ({ id: `w${i}`, label: l.label, hue: ['cyan', 'violet', 'blue', 'magenta', 'amber', 'green'][i % 6], homeAble: true, hidden: false })),
};
const FIXTURE: AppFixture = {
  api: { '/api/feed': { events: [] }, '/api/accounts': ACCOUNTS },
  fleetFrames: [{ type: 'fleet', sessions: [] }],
};

/** A node the update plane measured, behind the release `desiredTag` names (the shape `update-indicator.browser.test.ts` uses). */
const node = (role: 'fleet' | 'server', id: string) => ({
  nodeId: id, role, label: role, os: 'linux',
  current: { sha: 'bd2bf57a91c3e0d4f6a8b2c5e7d9f1a3b5c7e9d1', ref: 'main', builtAt: '2026-09-20T12:00:00Z', dirty: false, version: 'v0.0.7' },
  stampRead: 'ok', installState: 'complete', provenance: 'verified', caps: ['update-gate'], agentOps: role === 'server' ? null : [],
  highestVersion: 'v0.0.7', previousVersion: null, floorRead: 'measured', previousRead: 'absent',
  measuredAt: Date.now() - MIN, reachable: true, unreachableSince: null, channel: 'stable', desiredTag: 'v0.0.9', resolveDetail: null,
  request: null, report: null, update: { state: 'idle', target: null, startedAt: null, detail: null },
});
const WAITING = {
  catalogue: { lastOkAt: Date.now() - 4 * MIN, lastError: null }, releases: [],
  nodes: [node('fleet', '0b6e1c62-7a4f-4d0e-9c1a-3f2d5e8a9b10'), node('server', '5f3a9d21-2c8b-4e6f-a1d7-8b0c4e2f6a93')], intent: [],
};

/** The same nodes with the fleet node's last update failed: the halt banner (and its Ack) stands. */
const HALTED = {
  ...WAITING,
  nodes: [
    { ...node('fleet', '0b6e1c62-7a4f-4d0e-9c1a-3f2d5e8a9b10'), update: { state: 'failed', target: 'v0.0.9', startedAt: 1, detail: 'gate: unit not up' } },
    node('server', '5f3a9d21-2c8b-4e6f-a1d7-8b0c4e2f6a93'),
  ],
};
/** A remote fleet whose agent link is down: the fleet-host banner. */
const HOST_DOWN = { mode: 'remote', connected: false, downSince: Date.now() - 5 * MIN };

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

/** Open the app and wait until the desk bar, all seventeen cards and its New session door are in place. The strip folds by
 *  default (S5b, D-6530), so this opener seeds the stored choice expanded: it is the all-lanes opener. */
async function openDesk(view: AppView, fixture: AppFixture = FIXTURE): Promise<Awaited<ReturnType<typeof openApp>>> {
  const opened = await openApp(browser!, view, fixture);
  await seedStripExpanded(opened.ctx);
  await opened.page.goto(server!.origin + '/');
  await opened.page.waitForFunction(() => document.querySelectorAll('header.shell-accounts .account-gauge').length === 17
    && document.querySelector('.ref-bar-new, .ins-new') !== null, undefined, { timeout: 30_000 });
  await opened.page.waitForTimeout(300); // layout settles
  return opened;
}

const DESKS: AppView[] = SKINS.flatMap((skin) => THEMES.flatMap((theme) => WIDTHS.map((width) => ({ skin, theme, width }))));

describe("at 900, 1280 and 1920 the lanes row spans the header under the bar's line, every card whole, most free first", () => {
  for (const view of DESKS) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openDesk(view);
      try {
        const faults = await page.evaluate(({ order, windows, long }) => {
          const out: string[] = [];
          const header = document.querySelector<HTMLElement>('header.shell-accounts')!;
          const line = header.querySelector<HTMLElement>('.ref-bar, .ins-topbar');
          const row = header.querySelector<HTMLElement>('.accounts-strip');
          if (line === null) return ['no bar line'];
          if (row === null) return ['the header holds no lanes row'];
          const hr = header.getBoundingClientRect();
          const lr = line.getBoundingClientRect();
          const rr = row.getBoundingClientRect();
          const hs = getComputedStyle(header);
          const gutterL = hr.left + parseFloat(hs.paddingLeft) + parseFloat(hs.borderLeftWidth);
          const gutterR = hr.right - parseFloat(hs.paddingRight) - parseFloat(hs.borderRightWidth);
          if (rr.top < lr.bottom - 0.5) out.push(`the row (top ${rr.top}) is not under the bar's line (bottom ${lr.bottom})`);
          if (rr.bottom > hr.bottom + 0.5) out.push(`the row runs out of the header (${rr.bottom} > ${hr.bottom})`);
          if (Math.abs(rr.left - gutterL) > 1 || Math.abs(rr.right - gutterR) > 1) {
            out.push(`the row does not span the header's content (${rr.left}..${rr.right} vs ${gutterL}..${gutterR})`);
          }

          const cards = [...row.querySelectorAll<HTMLElement>('.account-gauge')];
          const names = cards.map((c) => c.querySelector<HTMLElement>('.account-gauge-label')!.textContent ?? '');
          if (names.join('|') !== order.join('|')) out.push(`the cards read [${names}], not [${order}]`);
          for (const [i, card] of cards.entries()) {
            const name = names[i]!;
            const cr = card.getBoundingClientRect();
            if (cr.left < rr.left - 0.5 || cr.right > rr.right + 0.5) out.push(`${name}'s card is not whole inside the row (${cr.left}..${cr.right} in ${rr.left}..${rr.right})`);
            if (card.scrollWidth > card.clientWidth + 0.5) out.push(`${name}'s card holds more than it shows (${card.scrollWidth} > ${card.clientWidth})`);
            const rows = [...card.querySelectorAll<HTMLElement>('.acct-row')];
            const want = windows[name] ?? [];
            const wins = rows.map((r) => r.querySelector('.acct-win')?.textContent ?? '');
            if (wins.join() !== want.map((w) => w.win).join()) out.push(`${name} shows [${wins}], not [${want.map((w) => w.win)}]`);
            for (const [j, r] of rows.entries()) {
              const reset = r.querySelector<HTMLElement>('.acct-reset');
              if (want[j]?.counted === true && (reset === null || reset.textContent === '' || reset.textContent === '↻ —')) {
                out.push(`${name}'s ${wins[j]} row prints no countdown (${JSON.stringify(reset?.textContent ?? null)})`);
              }
            }
            // Every countdown and reading printed is SEEN: a client rect with area, inside the card, and the element at
            // its centre is its own (nothing clips or covers it).
            for (const el of card.querySelectorAll<HTMLElement>('.acct-reset, .acct-pct, .acct-win')) {
              const er = el.getBoundingClientRect();
              const what = `${name}'s ${el.className.split(' ')[0]} "${el.textContent}"`;
              if (el.getClientRects().length === 0 || er.width < 1 || er.height < 1) { out.push(`${what} has no box`); continue; }
              if (er.left < cr.left - 0.5 || er.right > cr.right + 0.5 || er.top < cr.top - 0.5 || er.bottom > cr.bottom + 0.5) {
                out.push(`${what} is outside its card (${Math.round(er.left)}..${Math.round(er.right)} x ${Math.round(er.top)}..${Math.round(er.bottom)} vs ${Math.round(cr.left)}..${Math.round(cr.right)} x ${Math.round(cr.top)}..${Math.round(cr.bottom)})`);
              }
              if (el.scrollWidth > el.clientWidth + 0.5) out.push(`${what} is cut`);
              const hit = document.elementFromPoint((er.left + er.right) / 2, (er.top + er.bottom) / 2);
              if (hit === null || !el.contains(hit)) out.push(`${what} is covered by ${hit?.className ?? 'nothing'}`);
            }
          }

          // The long name is cut, its whole name in the title.
          const longLabel = cards.map((c) => c.querySelector<HTMLElement>('.account-gauge-label')!).find((l) => l.textContent === long);
          if (longLabel === undefined) out.push('no card for the long name');
          else {
            if (longLabel.title !== long) out.push(`the long name's title is "${longLabel.title}"`);
            if (longLabel.scrollWidth <= longLabel.clientWidth + 0.5) out.push('the long name is not cut');
          }

          // All accounts: the go-accounts door, in the track after the last card (same line, to its right).
          const end = row.querySelector<HTMLElement>('.accounts-end');
          const door = end?.querySelector<HTMLElement>('[data-command="go-accounts"]'); // not 'button': the fold's control may come first
          if (end === null || door === null || door === undefined) out.push('no All accounts cell');
          else {
            if (door.textContent?.trim() !== 'All accounts') out.push(`the end door reads "${door.textContent}"`);
            if (door.getAttribute('data-command') !== 'go-accounts') out.push(`the end door's command is ${door.getAttribute('data-command')}`);
            if (cards.at(-1)!.compareDocumentPosition(end) !== Node.DOCUMENT_POSITION_FOLLOWING) out.push('All accounts does not follow the last card in the DOM');
            const er = end.getBoundingClientRect();
            const dr = door.getBoundingClientRect();
            const last = cards.at(-1)!.getBoundingClientRect();
            if (er.left < last.right - 0.5) out.push(`All accounts (left ${er.left}) is not after the last card (right ${last.right})`);
            const mid = (er.top + er.bottom) / 2;
            if (mid < last.top - 0.5 || mid > last.bottom + 0.5) out.push('All accounts is not on the last card\'s line');
            if (dr.left < er.left - 0.5 || dr.right > er.right + 0.5 || dr.right > rr.right + 0.5) out.push(`All accounts' door is not whole in its cell (${dr.left}..${dr.right} in ${er.left}..${er.right})`);
            if (door.scrollWidth > door.clientWidth + 0.5) out.push("All accounts' words are cut");
          }

          if (document.documentElement.scrollWidth > window.innerWidth + 0.5) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} > ${window.innerWidth})`);
          if (header.scrollWidth > header.clientWidth + 0.5) out.push('the header scrolls sideways');
          if (row.scrollWidth > row.clientWidth + 0.5) out.push('the row scrolls sideways');
          return out;
        }, { order: expectedOrder(), windows: expectedWindows(), long: LONG });
        expect(faults).toEqual([]);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});

/** The page answers the view until `fail()`, then HTTP 500: the hook keeps the last good view and reports the failure
 *  beside it, which is what a stale view is (update-indicator.browser.test.ts's, as it does). */
async function answerViewThenFail(page: Page): Promise<{ fail(): void }> {
  const state = { failing: false };
  await page.context().route('**/api/updates', async (route) => {
    if (state.failing) await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"down"}' });
    else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HALTED) });
  });
  return { fail: () => { state.failing = true; } };
}

/** The frame's boxes at a desk in Refined, top to bottom, as faults when two overlap or come out of order. */
function stackFaults(): string[] {
  const out: string[] = [];
  const box = (sel: string): DOMRect | null => document.querySelector(sel)?.getBoundingClientRect() ?? null;
  const header = box('header.shell-accounts');
  const line = box('header.shell-accounts .ref-bar');
  const row = box('header.shell-accounts .accounts-strip');
  const banners = document.querySelector<HTMLElement>('.shell-banners');
  const indicator = banners?.querySelector<HTMLElement>('.update-indicator') ?? null;
  const detail = box('main.shell-detail');
  if (header === null || line === null || row === null || banners === null || indicator === null || detail === null) {
    return ['a box of the stack is missing'];
  }
  const ir = indicator.getBoundingClientRect();
  const br = banners.getBoundingClientRect();
  if (document.querySelectorAll('.update-indicator').length !== 1) out.push('not one update line in the page');
  if (document.querySelector('header.shell-accounts .update-indicator') !== null) out.push('the update line is inside the header');
  if (line.bottom > row.top + 0.5) out.push(`the lanes row (top ${row.top}) is not under the bar's line (bottom ${line.bottom})`);
  if (row.bottom > header.bottom + 0.5) out.push('the lanes row runs out of the header');
  if (header.bottom > br.top + 0.5) out.push(`the banner slot (top ${br.top}) overlaps the header (bottom ${header.bottom})`);
  // The banners really are mounted (the halt and the fleet-host banner, each with a box), in this order, each under the
  // header, none over its neighbour, and the update line after the last of them, in the DOM and on the page.
  const banner = [...banners.querySelectorAll<HTMLElement>(':scope > .banner-slot:not([hidden]) > *')];
  const names = banner.map((e) => e.className.split(' ')[0] ?? e.tagName);
  if (banner.length < 2) out.push(`${banner.length} banners mounted, not the halt and the fleet-host banner (${names})`);
  if (banners.querySelector('.halt-banner') === null) out.push('no halt banner');
  let above = header.bottom;
  for (const e of banner) {
    const er = e.getBoundingClientRect();
    if (er.height < 1) out.push(`a banner (${e.className}) has no height`);
    if (er.top < above - 0.5) out.push(`a banner (${e.className}, top ${er.top}) overlaps what is above it (bottom ${above})`);
    if (e.compareDocumentPosition(indicator) !== Node.DOCUMENT_POSITION_FOLLOWING) out.push(`a banner (${e.className}) does not precede the update line in the DOM`);
    above = Math.max(above, er.bottom);
  }
  if (ir.top < above - 0.5) out.push(`the update line (top ${ir.top}) is over a banner (bottom ${above})`);
  if (ir.top < header.bottom - 0.5) out.push(`the update line (top ${ir.top}) is over the header (bottom ${header.bottom})`);
  if (ir.top < br.top - 0.5 || ir.bottom > br.bottom + 0.5) out.push('the update line is not whole inside the banner slot');
  if (ir.left < -0.5 || ir.right > window.innerWidth + 0.5) out.push('the update line is outside the viewport');
  if (detail.top < ir.bottom - 0.5) out.push(`the detail pane (top ${detail.top}) starts over the update line (bottom ${ir.bottom})`);
  if (document.documentElement.scrollWidth > window.innerWidth + 0.5) out.push('the page scrolls sideways');
  return out;
}

const REFINED_DESKS: AppView[] = THEMES.flatMap((theme) => WIDTHS.map((width) => ({ skin: REFINED, theme, width })));

describe('in Refined with a release waiting the update row sits below the banners and under the lanes row, nothing overlapping', () => {
  for (const view of REFINED_DESKS) {
    it(named(view), async () => {
      const waiting: AppFixture = { ...FIXTURE, api: { ...FIXTURE.api, '/api/updates': HALTED, '/api/fleet/health': HOST_DOWN } };
      const { ctx, page, errors } = await openApp(browser!, view, waiting);
      try {
        await seedStripExpanded(ctx); // the row's cards are counted below: every lane
        const answers = await answerViewThenFail(page);
        await page.goto(server!.origin + '/');
        await page.waitForFunction(() => document.querySelectorAll('header.shell-accounts .account-gauge').length === 17
          && document.querySelector('.shell-banners .update-indicator-dismiss') !== null
          && document.querySelector('.shell-banners .halt-banner') !== null, undefined, { timeout: 30_000 });
        await page.waitForTimeout(300);
        const fresh = await page.evaluate(stackFaults);
        expect(fresh, 'a fresh view').toEqual([]);
        const freshHeight = await page.evaluate(() => document.querySelector('.shell-banners .update-indicator')!.getBoundingClientRect().height);

        // STALE: the next read fails, and a visibilitychange makes it now.
        answers.fail();
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await page.waitForSelector('.shell-banners .update-indicator-stale', { timeout: 30_000 });
        await page.waitForTimeout(300);
        const stale = await page.evaluate(stackFaults);
        expect(stale, 'a stale view').toEqual([]);
        const staleHeight = await page.evaluate(() => document.querySelector('.shell-banners .update-indicator')!.getBoundingClientRect().height);
        // The halt banner says the stale words on a line of its own, so the stack grows; the update line keeps its height.
        expect(staleHeight, 'the stale words leave the update line one row tall').toBeCloseTo(freshHeight, 0);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});

// A phone's card is 50 px from its content when it has two windows, and 36 px (a weekly-only lane) or 40 px (never read) when
// it does not and the floor is gone, measured at 390 and 360 in both skins. The grid stretches a card to the tallest in its row,
// so the 17 lanes above never show it: each short card shares a row with a two-window one. A lone short card is a row of its
// own: two more signed-out weekly-only lanes sort after the rest, so the last card, odd one out, stands alone on the phone.
const SHORT_LANES = ['lane-r', 'lane-s'].map((label, k) => ({
  acct: { wrapper: `w${17 + k}`, five: null, seven: 35, ts: nowSec - 60, fiveResetAt: null, sevenResetAt: nowSec + 86_400 * 2, fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: true },
  entry: { id: `w${17 + k}`, label, hue: 'cyan', homeAble: true, hidden: false },
}));
const PHONE_FIXTURE: AppFixture = {
  ...FIXTURE,
  api: { ...FIXTURE.api, '/api/accounts': {
    ...ACCOUNTS, accounts: [...ACCOUNTS.accounts, ...SHORT_LANES.map((l) => l.acct)], roster: [...ACCOUNTS.roster, ...SHORT_LANES.map((l) => l.entry)],
  } },
};

// A touch screen at a desk (a tablet in landscape, a touch laptop) and a phone (390, always touch).
const COARSE: AppView[] = [
  ...SKINS.flatMap((skin) => THEMES.flatMap((theme) => WIDTHS.map((width) => ({ skin, theme, width, touch: true })))),
  ...SKINS.map((skin) => ({ skin, theme: PHOSPHOR, width: 390 })),
];

describe('under coarse emulation every card and All accounts is at least 44 px tall', () => {
  for (const view of COARSE) {
    it(named(view), async () => {
      const want = view.width < 900 ? 19 : 17; // the phone's roster adds the two short lanes
      const opened = await openApp(browser!, view, view.width < 900 ? PHONE_FIXTURE : FIXTURE);
      const { ctx, page, errors } = opened;
      try {
        await seedStripExpanded(ctx); // every card is measured, not just the folded line's
        await page.goto(server!.origin + '/');
        await page.waitForFunction((n) => document.querySelectorAll('.accounts-strip .account-gauge').length === n, want, { timeout: 30_000 });
        await page.waitForTimeout(300);
        const small = await page.evaluate((count) => {
          if (!matchMedia('(pointer: coarse)').matches) return ['the coarse pointer was not emulated'];
          const out: string[] = [];
          const cards = [...document.querySelectorAll<HTMLElement>('.accounts-strip .account-gauge')];
          const end = document.querySelector<HTMLElement>('.accounts-strip .accounts-end [data-command="go-accounts"]');
          // The fold's control (the strip is expanded here, so it reads "Show fewer") is a finger's height too.
          const control = document.querySelector<HTMLElement>('.accounts-strip .accounts-end [aria-expanded]');
          if (cards.length !== count) out.push(`${cards.length} cards, not ${count}`);
          if (end === null) out.push('no All accounts');
          if (control === null) out.push('no fold control');
          for (const el of [...cards, ...(end === null ? [] : [end]), ...(control === null ? [] : [control])]) {
            const r = el.getBoundingClientRect();
            if (r.height < 43.5) out.push(`${el.querySelector('.account-gauge-label')?.textContent ?? el.textContent?.trim() ?? '?'} is ${Math.round(r.width)} x ${r.height.toFixed(1)}`);
          }
          return out;
        }, want);
        expect(small).toEqual([]);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});

describe("New session ends at the bar line's content edge", () => {
  for (const view of DESKS) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openDesk(view);
      try {
        const found = await page.evaluate(() => {
          const header = document.querySelector<HTMLElement>('header.shell-accounts')!;
          const hr = header.getBoundingClientRect();
          const hs = getComputedStyle(header);
          const contentRight = hr.right - parseFloat(hs.paddingRight) - parseFloat(hs.borderRightWidth);
          const btn = document.querySelector<HTMLElement>('.ref-bar-new, .ins-new')!;
          const r = btn.getBoundingClientRect();
          const line = header.querySelector<HTMLElement>('.ref-bar, .ins-topbar')!.getBoundingClientRect();
          return {
            gap: contentRight - r.right, gutter: hr.right - contentRight, name: btn.getAttribute('aria-label') ?? btn.textContent?.replace(/^\+/, '').trim(),
            inLine: r.top >= line.top - 0.5 && r.bottom <= line.bottom + 0.5, inViewport: r.left >= -0.5 && r.right <= window.innerWidth + 0.5,
          };
        });
        expect(found.name).toBe('New session');
        expect(found.gutter, "the header's gutter is not zero").toBeGreaterThan(0);
        expect(Math.abs(found.gap), `New session is ${found.gap} px short of the bar line's content edge`).toBeLessThanOrEqual(1);
        expect(found.inLine, 'New session is on the bar line').toBe(true);
        expect(found.inViewport, 'New session is inside the viewport').toBe(true);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});

// The Accounts screen opened from a card: the page itself must not scroll. A window nobody measured speaks "not measured" in
// an `sr-only` span, which is absolutely positioned: with no positioned ancestor in the rows it escapes the detail pane (the
// scroller) and stretches the document, and the lane arrival then scrolls the document and cuts off the header.
const DESK_SKINS: AppView[] = SKINS.map((skin) => ({ skin, theme: PHOSPHOR, width: 1280 }));

describe('on /accounts at 1280, in both skins, opened from a card, the document does not scroll and the header stays at the top', () => {
  for (const view of DESK_SKINS) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openDesk(view);
      try {
        // The weekly-only lane's card (its other window is unmeasured), by its name.
        await page.locator('header.shell-accounts .account-gauge', { hasText: 'lane-g' }).click();
        await page.waitForFunction(() => location.pathname === '/accounts' && document.querySelectorAll('.accounts-row').length === 17, undefined, { timeout: 30_000 });
        await page.waitForTimeout(600); // the arrival's scroll and focus settle
        const found = await page.evaluate(() => ({
          scrollHeight: document.documentElement.scrollHeight, viewport: window.innerHeight, scrollY: window.scrollY,
          headerTop: document.querySelector('header.shell-accounts')!.getBoundingClientRect().top,
          unmeasured: [...document.querySelectorAll('.accounts-row .sr-only')].filter((e) => /not measured/i.test(e.textContent ?? '')).length,
        }));
        expect(found.unmeasured, 'an unmeasured window speaks on the screen (the fixture reaches the case)').toBeGreaterThan(0);
        expect(found.scrollHeight, 'the document is as tall as the viewport').toBe(found.viewport);
        expect(found.scrollY, 'the document has not scrolled').toBe(0);
        expect(found.headerTop, "the header's top stays at 0").toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});

// Review 940 O5's reach: the meter track's ring is an inset box-shadow (no layout), and `WorkflowStrip` on the session screen
// draws a `Meter` per workflow row, which nothing had rendered. Its rows come from the session socket's `workflows` frame.
const RING_SESSION = fleetSession({ id: 'project-a-lanes-ring', wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: '/w/project-a', workspace: 'lanes-ring', status: 'busy', bucket: 'working' });
const RING_FIXTURE: AppFixture = { ...FIXTURE, fleetFrames: [{ type: 'fleet', sessions: [RING_SESSION] }] };
const workflow = (id: string, name: string, done: number): WorkflowView => ({
  id, name, state: 'running', done, failed: 0, total: 4, phase: null, phases: null, startedAt: null, endedAt: null,
  tokens: null, tokensUnmeasured: 0, agents: [], agentsOmitted: 0,
});
/** One empty meter (0 of 4, the case the ring exists for) and one part-filled (2 of 4). */
const WORKFLOWS = [workflow('wf_ring_empty', 'workflow-a', 0), workflow('wf_ring_part', 'workflow-b', 2)];
const RING_VIEWS: AppView[] = [
  ...SKINS.flatMap((skin) => THEMES.map((theme) => ({ skin, theme, width: 1280 }))),
  ...SKINS.map((skin) => ({ skin, theme: PHOSPHOR, width: 390 })),
];

describe("the meter's inset ring reaches WorkflowStrip on the session screen", () => {
  for (const view of RING_VIEWS) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, RING_FIXTURE);
      try {
        await ctx.routeWebSocket(/\/ws\/session\//, (ws) => {
          ws.send(JSON.stringify({ type: 'backlog', uuid: 'u-1', events: [], offset: 1, file: '/w/t.jsonl', missing: false, searchComplete: true, fileMeasured: true }));
          ws.send(JSON.stringify({ type: 'workflows', workflows: WORKFLOWS }));
        });
        await page.goto(`${server!.origin}/s/${RING_SESSION.id}`);
        const reached = await page.waitForSelector('.workflow-line .limit-track', { timeout: 20_000 }).then(() => true, () => false);
        expect(reached, "the Workflows strip drew no meter: the session socket's workflows frame did not reach WorkflowStrip").toBe(true);
        await page.waitForTimeout(300);
        const found = await page.evaluate(() => {
          const probe = document.body.appendChild(document.createElement('i'));
          probe.style.color = 'var(--ink-tertiary)';
          const ink = getComputedStyle(probe).color;
          probe.remove();
          const tracks = [...document.querySelectorAll<HTMLElement>('.workflow-line .limit-track')];
          const faults: string[] = [];
          for (const [i, t] of tracks.entries()) {
            const r = t.getBoundingClientRect();
            const shadow = getComputedStyle(t).boxShadow;
            // A computed box-shadow lists every layer; the ring is the layer with the tertiary ink, inset, 0 0 0 1px.
            const layers = shadow.split(/,(?![^(]*\))/).map((l) => l.trim());
            const ring = layers.some((l) => l.includes(ink) && /(^|\s)inset(\s|$)/.test(l) && l.replace(ink, '').replace(/inset/, '').trim().split(/\s+/).join(' ') === '0px 0px 0px 1px');
            if (!ring) faults.push(`track ${i} wears no 1px inset ring in ${ink}: box-shadow "${shadow}"`);
            if (r.width < 1 || r.height < 1) faults.push(`track ${i} has no box (${r.width} x ${r.height})`);
          }
          return { count: tracks.length, ink, faults };
        });
        expect(found.count, 'both workflow rows draw a meter').toBe(WORKFLOWS.length);
        expect(found.faults).toEqual([]);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});
