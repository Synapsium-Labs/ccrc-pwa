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
// THE FOLD AND ITS FLYOUT (desktop polish S5b, D-6530; R120's `strip-hover-flyout`; `lanes-tie-break-soonest-reset`). The
// strip folds by default, so the cases above that count or place all seventeen cards seed the stored choice expanded
// (`seedStripExpanded`), and what the fold itself draws is held at the end of the file, with the shared seventeen-lane
// fixture (`test/seventeenLanes.ts`): (6) folded, at 900, 1280 and 1920 in both skins and palettes, the row is one line,
// `rowFit`'s tracks less one of cards (2, 3 and 6) in the freest-first order, then the end cell, one track wide, holding
// the control and All accounts, every item at one top, nothing cut or sideways; (7) expanded, every lane wraps and the end
// cell follows the last card; (8) from 1920 to 1280 the folded row re-fits, and back; (9) at 1280 and 1920 hovering the
// folded line opens, after the flyout's delay, a panel below it, drawn over the content (positioned, the element at each
// card's centre its own), holding every lane in order inside the viewport, pushing the first session row nowhere, and
// closing after its grace once the pointer leaves. The expected order is worked out here from the rule, tie keys and all
// (`orderOf`), never by the app's decider.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts --maxWorkers=2 browser/lanes-row.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, seedStripExpanded, serveDist, type AppFixture, type AppView, type DistServer } from './app';
import { fleetSession } from '../test/fleetFixture';
import { seventeenLanes } from '../test/seventeenLanes';
import { FLYOUT_CLOSE_MS, FLYOUT_OPEN_MS, foldShown, LANE_CARD_MIN, rowFit } from '../src/fleet/stripFold';
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
 *  first; lanes that tie on it by that window's reset, soonest first (a lane with no reset after one with a reset), then by
 *  the other window's use, lowest first (an unmeasured one after a measured one), then in roster order
 *  (lanes-tie-break-soonest-reset). The fuller window is the weekly one on a tie between the windows. A lane never read
 *  and a lane signed out go last, in roster order. */
function orderOf(lanes: readonly Lane[]): string[] {
  const num = (l: Lane, k: string): number | null => (typeof l.acct[k] === 'number' ? (l.acct[k] as number) : null);
  const used = (l: Lane): number | null => {
    const known = [num(l, 'five'), num(l, 'seven')].filter((p): p is number => p !== null);
    return known.length === 0 ? null : Math.max(...known);
  };
  // The binding window's reset and the other window's use, Infinity where nothing is known so unknown sorts after known.
  const keys = (l: Lane): { reset: number; other: number } => {
    const five = num(l, 'five');
    const seven = num(l, 'seven');
    const sevenBinds = seven !== null && seven === used(l);
    return {
      reset: (sevenBinds ? num(l, 'sevenResetAt') : num(l, 'fiveResetAt')) ?? Infinity,
      other: (sevenBinds ? five : seven) ?? Infinity,
    };
  };
  const ranked = lanes.map((l, i) => ({ l, i, pct: used(l), ...keys(l) })).filter((e) => e.pct !== null && e.l.acct['authDead'] !== true);
  const last = lanes.filter((l) => used(l) === null || l.acct['authDead'] === true);
  const cmp = (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0);
  ranked.sort((x, y) => cmp(x.pct!, y.pct!) || cmp(x.reset, y.reset) || cmp(x.other, y.other) || x.i - y.i);
  return [...ranked.map((e) => e.l.label), ...last.map((l) => l.label)];
}

/** The order of this file's own seventeen lanes. The long-named lane (index 7) and `lane-q` tie at 64% (the weekly window
 *  of one, the 5h of the other), so the soonest reset puts `lane-q` first; the roster alone would put the long name. */
const expectedOrder = (): string[] => orderOf(LANES);

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
            // The tab order the plan states: the control, when there is one, comes before All accounts.
            const control = end!.querySelector<HTMLElement>('[aria-expanded]');
            if (control === null || !(control.compareDocumentPosition(door) & Node.DOCUMENT_POSITION_FOLLOWING)) out.push('the fold control does not precede All accounts');
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

// THE FOLD AT THE DESK (desktop polish S5b, D-6530; R48) and its flyout (R120, strip-hover-flyout). The strip folds by
// default: with the shared seventeen-lane fixture (`test/seventeenLanes.ts`, which is not this file's own `LANES`) the row
// is ONE line, as many cards as `rowFit` says the line's tracks hold less the one the end cell takes, then the end cell with
// the fold's control and All accounts. The cards' group measures 868, 1248 and 1888 px with an 8 px gap at 900, 1280 and
// 1920 in both skins (measured, T2c's Step 0 and this leg), so a line holds 3, 4 and 7 tracks and a folded one shows 2, 3
// and 6 cards.
const FOLD = seventeenLanes(nowSec);
const FOLD_LANES: readonly Lane[] = FOLD.cases.map((c) => ({ acct: { ...c.acct }, label: c.label }));
const FOLD_ORDER = orderOf(FOLD_LANES);
const FOLD_FIXTURE: AppFixture = {
  api: { '/api/feed': { events: [] }, '/api/accounts': { accounts: FOLD.accounts, projected: null, roster: FOLD.roster } },
  // Nine sessions, so the fleet list has a first session row to measure: the flyout must push nothing down.
  fleetFrames: [{ type: 'fleet', sessions: Array.from({ length: 9 }, (_, i) => fleetSession({
    id: `s${i}`, project: `project-${i % 3}`, bucket: i === 0 ? 'attention' : 'idle',
  })) }],
};
/** The cards a folded line shows at each width, the same in both skins: asserted beside `rowFit`'s own answer. */
const FOLDED_CARDS: Readonly<Record<number, number>> = { 900: 2, 1280: 3, 1920: 6 };

/** Open the app with the fold's fixture: folded (the default) or, with `expanded`, seeded to show every lane. Waits for the
 *  fold's control, which only renders once the row has been measured, and for the first session row. */
async function openFoldedDesk(view: AppView, expanded = false): Promise<Awaited<ReturnType<typeof openApp>>> {
  const opened = await openApp(browser!, view, FOLD_FIXTURE);
  if (expanded) await seedStripExpanded(opened.ctx);
  await opened.page.goto(server!.origin + '/');
  await opened.page.waitForFunction((all) => document.querySelector('header.shell-accounts .accounts-end [aria-expanded]') !== null
    && document.querySelector('.sess-line') !== null
    && (!all || document.querySelectorAll('header.shell-accounts .account-gauge').length === 17), expanded, { timeout: 30_000 });
  await opened.page.waitForTimeout(400); // layout settles
  return opened;
}

/** What the strip's line measures at this moment: the cards' group's content width and column gap (what `useRowWidth`
 *  reads), and every box the fold's line is made of. Plain numbers and words, so the case judges them in Node. */
interface LineMeasure {
  width: number; gap: number; vw: number;
  names: string[]; mounted: number;
  cards: Array<{ left: number; right: number; top: number; bottom: number }>;
  end: { left: number; right: number; top: number; bottom: number } | null;
  control: { left: number; right: number; top: number; bottom: number; text: string; expanded: string | null; cut: boolean } | null;
  door: { left: number; right: number; top: number; bottom: number; cut: boolean } | null;
  row: { left: number; right: number };
  /** Faults in the readings of each card of the line: every window, percentage and countdown has a box inside its card, is
   *  not cut, and is the element at its own centre (the all-lanes case's check, for the folded line). */
  readings: string[];
  sideways: string[];
}

function measureLine(): LineMeasure {
  const strip = document.querySelector<HTMLElement>('header.shell-accounts .accounts-strip')!;
  const cs = getComputedStyle(strip);
  const box = (el: Element): { left: number; right: number; top: number; bottom: number } => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  };
  const cards = [...strip.querySelectorAll<HTMLElement>(':scope > .account-gauge')];
  const end = strip.querySelector<HTMLElement>(':scope > .accounts-end');
  const control = end?.querySelector<HTMLElement>('[aria-expanded]') ?? null;
  const door = end?.querySelector<HTMLElement>('[data-command="go-accounts"]') ?? null;
  const header = document.querySelector<HTMLElement>('header.shell-accounts')!;
  const sideways: string[] = [];
  if (document.documentElement.scrollWidth > window.innerWidth + 0.5) sideways.push('the page');
  if (header.scrollWidth > header.clientWidth + 0.5) sideways.push('the header');
  if (strip.scrollWidth > strip.clientWidth + 0.5) sideways.push('the row');
  const sr = strip.getBoundingClientRect();
  const readings: string[] = [];
  for (const card of cards) {
    const name = card.querySelector('.account-gauge-label')?.textContent ?? '?';
    const cr = card.getBoundingClientRect();
    if (card.scrollWidth > card.clientWidth + 0.5) readings.push(`${name}'s card holds more than it shows`);
    for (const el of card.querySelectorAll<HTMLElement>('.acct-reset, .acct-pct, .acct-win')) {
      const er = el.getBoundingClientRect();
      const what = `${name}'s ${el.className.split(' ')[0]} "${el.textContent}"`;
      if (el.getClientRects().length === 0 || er.width < 1 || er.height < 1) { readings.push(`${what} has no box`); continue; }
      if (er.left < cr.left - 0.5 || er.right > cr.right + 0.5 || er.top < cr.top - 0.5 || er.bottom > cr.bottom + 0.5) readings.push(`${what} is outside its card`);
      if (el.scrollWidth > el.clientWidth + 0.5) readings.push(`${what} is cut`);
      const hit = document.elementFromPoint((er.left + er.right) / 2, (er.top + er.bottom) / 2);
      if (hit === null || !el.contains(hit)) readings.push(`${what} is covered by ${hit?.className ?? 'nothing'}`);
    }
  }
  return {
    width: strip.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), gap: parseFloat(cs.columnGap) || 0, vw: window.innerWidth,
    names: cards.map((c) => c.querySelector('.account-gauge-label')?.textContent ?? ''), mounted: document.querySelectorAll('.account-gauge').length,
    cards: cards.map(box), end: end === null ? null : box(end),
    control: control === null ? null : { ...box(control), text: control.textContent ?? '', expanded: control.getAttribute('aria-expanded'), cut: control.scrollWidth > control.clientWidth + 0.5 },
    door: door === null ? null : { ...box(door), cut: door.scrollWidth > door.clientWidth + 0.5 },
    row: { left: sr.left, right: sr.right }, readings, sideways,
  };
}

/** The faults of a FOLDED line at `width`: `rowFit`'s tracks less one of cards, in the freest-first order, then the end
 *  cell (one track) holding the control and All accounts, every item at one top, nothing cut or sideways. The count is
 *  worked out from the measured width and gap by the L1 functions and held against the figure the width gives. */
async function foldedFaults(page: Page, width: number): Promise<string[]> {
  const m = await page.evaluate(measureLine);
  const out: string[] = [];
  const tracks = rowFit(m.width, LANE_CARD_MIN, m.gap);
  const want = foldShown(true, tracks);
  if (want !== FOLDED_CARDS[width]) out.push(`${m.width} px and a ${m.gap} px gap fit ${tracks} tracks and fold to ${want} cards, not ${FOLDED_CARDS[width]}`);
  if (m.names.length !== want) out.push(`${m.names.length} cards, not ${want}`);
  if (m.mounted !== m.names.length) out.push(`${m.mounted} cards are mounted, the line shows ${m.names.length}: a lane is mounted and hidden`);
  if (m.names.join('|') !== FOLD_ORDER.slice(0, m.names.length).join('|')) out.push(`the cards read [${m.names}], not the freest first [${FOLD_ORDER.slice(0, m.names.length)}]`);
  const { end, control, door } = m;
  if (end === null || control === null || door === null) return [...out, 'the end cell lacks its control or All accounts'];
  const tops = [...m.cards.map((c) => c.top), end.top, control.top];
  if (Math.max(...tops) - Math.min(...tops) > 1) out.push(`the line's items are not at one top (${tops.map((t) => t.toFixed(1))})`);
  const last = m.cards.at(-1)!;
  for (let i = 1; i < m.cards.length; i++) if (m.cards[i]!.left < m.cards[i - 1]!.right - 0.5) out.push('the cards are not left to right');
  if (end.left < last.right - 0.5) out.push(`the end cell (left ${end.left}) is not after the last card (right ${last.right})`);
  if (Math.abs((end.right - end.left) - (last.right - last.left)) > 1.5) out.push(`the end cell is ${Math.round(end.right - end.left)} px wide, one track is ${Math.round(last.right - last.left)}`);
  if (end.right > m.row.right + 0.5) out.push('the end cell runs past the row');
  if (control.left < end.left - 0.5 || control.right > end.right + 0.5) out.push(`the control is not whole in the end cell (${control.left}..${control.right} in ${end.left}..${end.right})`);
  if (door.left < end.left - 0.5 || door.right > end.right + 0.5 || door.top < end.top - 0.5 || door.bottom > end.bottom + 0.5) out.push('All accounts is not whole in the end cell');
  if (door.left < control.right - 0.5 && door.top < control.bottom - 0.5 && door.bottom > control.top + 0.5) out.push('All accounts overlaps the control');
  if (control.cut) out.push("the control's words are cut");
  if (door.cut) out.push("All accounts' words are cut");
  if (control.expanded !== 'false') out.push(`the control's aria-expanded is ${control.expanded}`);
  const words = `+${17 - m.names.length} more · 1 sign-in expired · 1 rate-limited`;
  if (control.text !== words) out.push(`the control reads "${control.text}", not "${words}"`);
  out.push(...m.readings);
  if (m.sideways.length > 0) out.push(`${m.sideways.join(', ')} scrolls sideways`);
  return out;
}

/** The folded line's views: both skins, both palettes, the three desk widths. */
const FOLD_VIEWS: AppView[] = DESKS;

describe('folded, the lanes row is one line of the freest cards and the end cell', () => {
  for (const view of FOLD_VIEWS) {
    it(`folded with 17 lanes at 900, 1280 and 1920 in both skins, the row is one line: rowFit's tracks less one of cards, then the end cell with the control and All accounts, every item at one top, and nothing scrolls sideways: ${named(view)}`, async () => {
      const { ctx, page, errors } = await openFoldedDesk(view);
      try {
        expect(await foldedFaults(page, view.width)).toEqual([]);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});

describe('expanded, every lane wraps and the end cell follows the last card', () => {
  for (const view of FOLD_VIEWS) {
    it(`expanded, every lane wraps and the end cell follows the last card: ${named(view)}`, async () => {
      const { ctx, page, errors } = await openFoldedDesk(view, true);
      try {
        const m = await page.evaluate(measureLine);
        const tracks = rowFit(m.width, LANE_CARD_MIN, m.gap)!;
        const out: string[] = [];
        if (m.names.join('|') !== FOLD_ORDER.join('|')) out.push(`the cards read [${m.names}], not every lane freest first [${FOLD_ORDER}]`);
        const rows = new Set(m.cards.map((c) => Math.round(c.top))).size;
        if (rows !== Math.ceil(17 / tracks)) out.push(`${rows} lines of cards, not ${Math.ceil(17 / tracks)} (${tracks} tracks hold 17)`);
        const { end, control, door } = m;
        if (end === null || control === null || door === null) out.push('the end cell lacks its control or All accounts');
        else {
          const last = m.cards.at(-1)!;
          if (end.left < last.right - 0.5) out.push(`the end cell (left ${end.left}) is not after the last card (right ${last.right})`);
          const mid = (end.top + end.bottom) / 2;
          if (mid < last.top - 0.5 || mid > last.bottom + 0.5) out.push("the end cell is not on the last card's line");
          if (control.text !== 'Show fewer' || control.expanded !== 'true') out.push(`the control reads "${control.text}", aria-expanded ${control.expanded}`);
          if (control.cut || door.cut) out.push('the end cell\'s words are cut');
          if (control.right > end.right + 0.5 || door.right > end.right + 0.5) out.push('the end cell holds more than it shows');
        }
        for (const [i, c] of m.cards.entries()) if (c.left < m.row.left - 0.5 || c.right > m.row.right + 0.5) out.push(`${m.names[i]} is not whole in the row`);
        if (m.sideways.length > 0) out.push(`${m.sideways.join(', ')} scrolls sideways`);
        expect(out).toEqual([]);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});

describe('the folded row re-fits when the window changes', () => {
  for (const skin of SKINS) {
    for (const theme of THEMES) {
      it(`from 1920 to 1280 the folded row re-fits: ${named({ skin, theme, width: 1920 })}`, async () => {
        const { ctx, page, errors } = await openFoldedDesk({ skin, theme, width: 1920 });
        try {
          expect(await foldedFaults(page, 1920), 'at 1920').toEqual([]);
          await page.setViewportSize({ width: 1280, height: 900 });
          await page.waitForFunction(() => document.querySelectorAll('header.shell-accounts .accounts-strip > .account-gauge').length === 3, undefined, { timeout: 10_000 });
          await page.waitForTimeout(300);
          expect(await foldedFaults(page, 1280), 'at 1280').toEqual([]);
          await page.setViewportSize({ width: 1920, height: 900 });
          await page.waitForFunction(() => document.querySelectorAll('header.shell-accounts .accounts-strip > .account-gauge').length === 6, undefined, { timeout: 10_000 });
          await page.waitForTimeout(300);
          expect(await foldedFaults(page, 1920), 'back at 1920').toEqual([]);
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }, 90_000);
    }
  }
});

// The flyout: hovering the folded line opens a panel below it, drawn over the content, holding every lane in order. When
// `CCRC_BROWSER_SHOTS` names a directory, each view's open flyout is screenshotted into it (never written otherwise).
const FLYOUT_VIEWS: AppView[] = DESKS.filter((v) => v.width >= 1280);

describe('hovering the folded line opens a flyout below it', () => {
  for (const view of FLYOUT_VIEWS) {
    it(`hovering the folded line opens a flyout below it, drawn over the content, holding every lane in order, and nothing scrolls sideways: ${named(view)}`, async () => {
      const { ctx, page, errors } = await openFoldedDesk(view);
      try {
        const sessTop = (): Promise<number> => page.evaluate(() => document.querySelector('.sess-line')!.getBoundingClientRect().top);
        const before = await sessTop();
        expect(await page.locator('.accounts-flyout').count(), 'no flyout before the pointer comes').toBe(0);

        const hoveredAt = Date.now();
        await page.hover('header.shell-accounts .accounts-strip');
        await page.waitForSelector('.accounts-flyout', { timeout: 5_000 });
        const opened = Date.now() - hoveredAt;
        expect(opened, `the flyout opened after ${opened} ms, before its ${FLYOUT_OPEN_MS} ms delay`).toBeGreaterThanOrEqual(FLYOUT_OPEN_MS - 20);
        await page.waitForTimeout(100); // paint

        const found = await page.evaluate(() => {
          const strip = document.querySelector<HTMLElement>('header.shell-accounts .accounts-strip')!;
          const fly = strip.querySelector<HTMLElement>('.accounts-flyout')!;
          const cards = [...fly.querySelectorAll<HTMLElement>('.account-gauge')];
          const line = [...strip.querySelectorAll<HTMLElement>(':scope > .account-gauge, :scope > .accounts-end')];
          const fr = fly.getBoundingClientRect();
          const header = document.querySelector<HTMLElement>('header.shell-accounts')!;
          return {
            names: cards.map((c) => c.querySelector('.account-gauge-label')?.textContent ?? ''),
            flyTop: fr.top, flyBottom: fr.bottom, flyLeft: fr.left, flyRight: fr.right, lineBottom: Math.max(...line.map((e) => e.getBoundingClientRect().bottom)),
            headerBottom: header.getBoundingClientRect().bottom, position: getComputedStyle(fly).position, vw: window.innerWidth,
            // Its stacking level and the content's, as computed (`auto` reads NaN, taken as 0): at 1920 the panel ends above the
            // first session row, so hit-testing alone cannot tell it from a panel in flow.
            z: Number.parseInt(getComputedStyle(fly).zIndex, 10) || 0,
            contentZ: Math.max(...['main.shell-detail', '.shell-banners', '.sess-line'].map((sel) => Number.parseInt(getComputedStyle(document.querySelector(sel) ?? document.body).zIndex, 10) || 0)), vh: window.innerHeight,
            cards: cards.map((c) => {
              const r = c.getBoundingClientRect();
              const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
              return { right: r.right, left: r.left, top: r.top, bottom: r.bottom, ownHit: hit !== null && c.contains(hit) };
            }),
            sideways: [
              document.documentElement.scrollWidth > window.innerWidth + 0.5 ? 'the page' : '',
              header.scrollWidth > header.clientWidth + 0.5 ? 'the header' : '',
              fly.scrollWidth > fly.clientWidth + 0.5 ? 'the flyout' : '',
            ].filter((x) => x !== ''),
          };
        });
        const out: string[] = [];
        if (found.names.join('|') !== FOLD_ORDER.join('|')) out.push(`the flyout reads [${found.names}], not every lane freest first [${FOLD_ORDER}]`);
        if (found.flyTop < found.lineBottom - 0.5) out.push(`the flyout (top ${found.flyTop}) is not below the line (bottom ${found.lineBottom})`);
        if (found.position !== 'absolute' && found.position !== 'fixed') out.push(`the flyout is ${found.position}-positioned: it must be drawn over the content, not placed in it`);
        if (found.z <= found.contentZ || found.z <= 0) out.push(`the flyout's z-index (${found.z}) is not above the content's (${found.contentZ})`);
        if (found.flyBottom <= found.headerBottom) out.push(`the flyout (bottom ${found.flyBottom}) does not reach past the header (bottom ${found.headerBottom})`);
        for (const [i, c] of found.cards.entries()) {
          if (c.right > found.vw + 0.5 || c.left < -0.5) out.push(`${found.names[i]}'s card is outside the viewport horizontally (${c.left}..${c.right})`);
          if (c.top < -0.5 || c.bottom > found.vh + 0.5) out.push(`${found.names[i]}'s card is outside the viewport vertically (${c.top}..${c.bottom})`);
          if (!c.ownHit) out.push(`the element at the centre of ${found.names[i]}'s card is not the card: the flyout is drawn under something`);
        }
        if (found.sideways.length > 0) out.push(`${found.sideways.join(', ')} scrolls sideways`);
        const after = await sessTop();
        if (Math.abs(after - before) > 0.5) out.push(`the first session row moved from ${before} to ${after}: the flyout pushes the content`);
        expect(out).toEqual([]);

        const shots = process.env['CCRC_BROWSER_SHOTS'];
        if (shots !== undefined && shots !== '') await page.screenshot({ path: path.join(shots, `flyout-${view.skin}-${view.theme}-${view.width}.png`) });

        // The pointer leaves: the flyout stays for the grace, then closes.
        const leftAt = Date.now();
        await page.mouse.move(view.width / 2, 880);
        await page.waitForSelector('.accounts-flyout', { state: 'detached', timeout: 5_000 });
        const closed = Date.now() - leftAt;
        expect(closed, `the flyout closed after ${closed} ms, before its ${FLYOUT_CLOSE_MS} ms grace`).toBeGreaterThanOrEqual(FLYOUT_CLOSE_MS - 20);
        expect(await sessTop(), 'the first session row, once closed').toBeCloseTo(before, 0);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});
