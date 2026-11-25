// Desktop polish Tasks C40 (D-8698) and C42 (D-8714), in a real Chrome over the production build, a phone and a desk
// view.
// - Review 2310 F4, stacked: the flow the C38 rows hold in jsdom (`test/sheet-trap-hide.test.tsx`). A fleet row's Session
//   actions, then Swap account over it, then that sheet's target confirm, then Cancel. Each layer's aria-hidden is read
//   with all three open, right after the Cancel's click returns (the confirm still animating out, which the row's state
//   control holds), and once the confirm has gone: only the sheet directly under the confirm is announced as it closes,
//   and Session actions and the page stay hidden behind it (C38's rule, review 2287).
// - Review 2310 F2 and review 2323 F1, no stack, in the app: the session screen's menu sheet, whose Move to another
//   account row closes it and opens the swap sheet in one commit (`SessionFlows`; the swap sheet is rendered BEFORE the
//   menu sheet in the tree). The page's containers the menu's Radix hid are announced as soon as the swap sheet starts to
//   close, as on main, and the focus Radix gives back to More is not inside a hidden container. Two transcripts: one
//   whose code block holds a live region (`markdown.tsx`'s Copy label: the aria-hidden package keeps the path to it
//   visible and marks its siblings, so an element the page hid itself is planted beside the code block), and one with
//   none (the whole app root is marked; the element is planted at the body's level).
// - Review 2334 F1 and review 2343 F4, the command palette's hand-off: Control+K, Show shortcuts, then Escape on the
//   shortcuts sheet, with an element planted at the body's level. The palette is still animating out as the sheet opens
//   (`['closed', 'open']`, read right after the click); the Escape comes once the palette is gone, or while it is still
//   closing. The page is announced as the sheet closes, and each read names the focused element (review 2353 F6).
// In all of them, every element the page hid itself before the first sheet opened is still hidden at each read and after
// every sheet has gone (Task C40: the sheet never lifts an aria-hidden it did not set). The page is read as its hidden
// containers (every `aria-hidden` element outside the dialogs that the page did not hide itself, the focus guards aside),
// not as `main`'s ancestors, which a live region inside `main` keeps visible (review 2323 F3). Every read is a
// `page.evaluate`, at one of three moments (review 2334 F8, reviews 2343 and 2353 F9): a closing read right after the
// click or key press returns, while the dialog is still animating out (each row's state control holds that); an open
// read after a poll for the dialogs and 300 ms; and an after read once every dialog has unmounted, 100 ms on. The stacked
// row's read once its confirm has unmounted follows its poll at once. What the page hid itself is the sheet's own record, taken in its panel's callback ref as the panel mounts
// (`ui/src/lib/modal-layers.ts`), which these rows measure by its effect.
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts
// browser/sheet-stack-hide.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';
import { servedSocket } from '../test/wirePairing';

const VIEWS: readonly AppView[] = [{ skin: REFINED, theme: PHOSPHOR, width: 390 }, { skin: INSTRUMENT, theme: 'light', width: 1280 }];

// Neutral names only. project-a is tagged into lane-a's pool, so lane-b is the session's one eligible target, drawn
// "suggested" (`row-fit.browser.test.ts`'s swap fixture, cut to what this flow reads).
const NOW = 1_792_362_479;
const POOL = 'pool-a';
const ROSTER = [
  { id: 'lane-a', label: 'lane-a', hue: 'cyan', pool: POOL },
  { id: 'lane-b', label: 'lane-b', hue: 'violet', pool: POOL },
].map((r) => ({ ...r, homeAble: true, hidden: false }));
const usage = (wrapper: string, five: number, seven: number): object => ({
  wrapper, five, seven, ts: NOW, fiveResetAt: NOW + 7_800, sevenResetAt: NOW + 259_800,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false,
});
const SESSION = {
  id: 'project-a-one', wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: '/w/project-a/one', workspace: 'one',
  name: 'one', status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false, version: null, model: null,
  effort: null, ultracode: false, branch: 'ws/one', ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null,
  archivedBytes: null, held: null, hookState: null, askSummary: null, subagents: null, background: null,
  withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket: 'idle', unmeasured: [], started: true,
  child: { kind: 'none' },
};
const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [usage('lane-a', 40, 50), usage('lane-b', 20, 30)], projected: null, roster: ROSTER },
    '/api/projects': { roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a' }] },
    '/api/runs': [],
    '/api/claims': [],
  },
  fleetFrames: [
    { type: 'fleet', sessions: [SESSION] },
    { type: 'pools', pools: { listed: true, enforcement: 'enforced', accountPools: 'enforced',
      byProject: { 'project-a': { state: 'tagged', name: POOL } } } },
  ],
};

const TS = new Date((NOW - 600) * 1000).toISOString();
/** The session screen's transcript: one answer holding a code block, whose Copy label is a live region, or plain text. */
const FRAMES = (live: boolean): object[] => [
  { type: 'backlog', uuid: 'u-1', offset: 1, file: '/w/t.jsonl', missing: false, searchComplete: true, fileMeasured: true,
    events: [
      { kind: 'user', uuid: 'q1', ts: TS, text: 'show the command' },
      { kind: 'assistant', uuid: 'a1', ts: TS,
        text: live ? 'Here it is:\n\n```sh\nnpm test\n```\n\nRun it from the package.' : 'Run npm test from the package.' },
    ] },
  { type: 'status', status: 'idle', statusUpdatedAt: null },
];

let dist: string | undefined;
let server: DistServer | undefined;
let browser: Browser | undefined;
beforeAll(async () => {
  const executablePath = resolveChrome(); // throws on a box with no Chrome: red, never skipped
  dist = sharedDist();
  server = await serveDist(dist);
  browser = await chromium.launch({ executablePath, headless: true });
}, 180_000);
afterAll(async () => { await browser?.close(); await server?.close(); });

interface Layers {
  /** Each mounted dialog in document order (the order they opened): its title, its state, and whether it or an ancestor
   *  is aria-hidden. */
  readonly dialogs: readonly { readonly title: string; readonly state: string | null; readonly hidden: boolean }[];
  /** The page's hidden containers: every `aria-hidden="true"` element outside the dialogs (neither inside one nor holding
   *  one) that the page did not hide itself before the first sheet opened, Radix's focus guards aside. */
  readonly pageMarks: readonly string[];
  /** Whether any of those is hidden: the page is aria-hidden behind a dialog. */
  readonly page: boolean;
  /** Whether the focused element (when it is not the body and not in a dialog) sits inside a hidden container. */
  readonly focusHidden: boolean;
  /** The focused element's accessible name (its `aria-label`, else its text), or `BODY`. */
  readonly active: string;
  /** The elements hidden before the first sheet opened that are no longer `aria-hidden="true"`. */
  readonly lostOwn: readonly string[];
  /** Where the focus is: `page` (outside every dialog), or the dialog holding it, as its title and state
   *  (`Shortcuts:closed`), the palette's drawer being `palette:<state>`. */
  readonly focusIn: string;
}

/** Remember every element hidden from assistive technology before any sheet opens, by reference, on the window. */
const rememberOwn = (page: Page): Promise<number> => page.evaluate(() => {
  const own = [...document.querySelectorAll('[aria-hidden="true"]')];
  (window as unknown as { __c40Own: Element[] }).__c40Own = own;
  return own.length;
});

const read = (page: Page): Promise<Layers> => page.evaluate(() => {
  const up = (el: Element | null): boolean => {
    for (let at = el; at !== null; at = at.parentElement) if (at.getAttribute('aria-hidden') === 'true') return true;
    return false;
  };
  const dialogs = [...document.querySelectorAll('[role="dialog"]')].map((d) => ({
    title: (d.querySelector('h2')?.textContent ?? '').trim(), state: d.getAttribute('data-state'), hidden: up(d),
  }));
  const own = (window as unknown as { __c40Own: Element[] }).__c40Own;
  const name = (el: Element): string => `${el.tagName}.${el.getAttribute('class') ?? ''}`.slice(0, 80);
  const lostOwn = own.filter((el) => el.isConnected && el.getAttribute('aria-hidden') !== 'true').map(name);
  const open = [...document.querySelectorAll('[role="dialog"]')];
  const pageMarks = [...document.querySelectorAll('[aria-hidden="true"]')]
    .filter((el) => !own.includes(el) && !el.hasAttribute('data-radix-focus-guard')
      && !open.some((d) => d.contains(el) || el.contains(d)))
    .map(name);
  const active = document.activeElement;
  const focusHidden = active !== null && active !== document.body && !open.some((d) => d.contains(active)) && up(active);
  const activeName = active === null || active === document.body ? 'BODY'
    : (active.getAttribute('aria-label') ?? active.textContent ?? '').trim().slice(0, 40);
  const holder = active === null ? null : active.closest('[role="dialog"]');
  const focusIn = holder === null ? 'page'
    : `${holder.querySelector('[role="combobox"]') !== null ? 'palette' : (holder.querySelector('h2')?.textContent ?? '').trim()}:${holder.getAttribute('data-state')}`;
  return { dialogs, pageMarks, page: pageMarks.length > 0, focusHidden, active: activeName, lostOwn, focusIn };
});

describe('Session actions, Swap account, its confirm, Cancel (Task C40, review 2310 F4)', () => {
  for (const view of VIEWS) {
    it(`${view.skin}, ${view.width}px: only the sheet under the closing confirm is announced; nothing the page hid is lifted`, async () => {
      const { page, ctx, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await page.goto(`${server!.origin}/fleet`);
        // The session's card (Refined) or status group (Instrument) is drawn folded: unfold it to reach the row.
        await page.locator('button[aria-expanded="false"]', { hasText: '▸' }).first().click();
        const actions = page.getByRole('button', { name: /^Actions for / }).first();
        await actions.waitFor();
        const remembered = await rememberOwn(page);
        expect(remembered, 'CONTROL: the page hides some elements itself (icons, decoration)').toBeGreaterThan(0);

        await actions.click();
        await page.getByRole('button', { name: 'Swap account' }).click();
        await page.locator('.sheet-body .acct-list > button', { has: page.locator('.acct-suggested') }).click();
        await expect.poll(async () => (await read(page)).dialogs.length, { timeout: 10_000 }).toBe(3);
        await page.waitForTimeout(300);
        const open = await read(page);
        expect(open.dialogs.map((d) => d.hidden), 'CONTROL: the confirm hides both sheets under it').toEqual([true, true, false]);
        expect(open.page, 'CONTROL: the page is hidden behind three dialogs').toBe(true);
        expect(open.lostOwn, 'an element the page hid itself was lifted with three dialogs open').toEqual([]);

        await page.getByRole('dialog').last().getByRole('button', { name: 'Cancel' }).click();
        const closing = await read(page);
        expect(closing.dialogs.map((d) => d.state), 'CONTROL: the confirm is animating out, both sheets open')
          .toEqual(['open', 'open', 'closed']);
        expect(closing.dialogs.map((d) => d.hidden).slice(0, 2), 'as the confirm closes, only the sheet under it is announced')
          .toEqual([true, false]);
        expect(closing.page, 'the page was announced behind two open sheets as the confirm closed').toBe(true);
        expect(closing.lostOwn, 'an element the page hid itself was lifted as the confirm closed').toEqual([]);

        await expect.poll(async () => (await read(page)).dialogs.length, { timeout: 10_000 }).toBe(2);
        const gone = await read(page);
        expect(gone.dialogs.map((d) => d.hidden), 'after the confirm unmounted, only the top sheet is announced').toEqual([true, false]);
        expect(gone.page, 'the page was announced behind two open sheets after the confirm unmounted').toBe(true);
        expect(gone.lostOwn, 'an element the page hid itself was lifted after the confirm unmounted').toEqual([]);

        await page.keyboard.press('Escape');
        await expect.poll(async () => (await read(page)).dialogs.length, { timeout: 10_000 }).toBe(1);
        await page.keyboard.press('Escape');
        await expect.poll(async () => (await read(page)).dialogs.length, { timeout: 10_000 }).toBe(0);
        await page.waitForTimeout(100);
        const after = await read(page);
        expect(after.page, 'the page stayed hidden after every sheet left').toBe(false);
        expect(after.lostOwn, 'an element the page hid itself was left announced for good').toEqual([]);
        expect(errors).toEqual([]);
      } finally { await ctx.close(); }
    });
  }
});

describe('the session menu\'s Move to another account (Task C40, review 2310 F2, review 2323 F1 and F3)', () => {
  for (const view of VIEWS) {
    for (const live of [true, false]) {
      const shape = live ? 'a chat with a live region' : 'a chat with no live region';
      it(`${view.skin}, ${view.width}px, ${shape}: the page is announced as the swap sheet closes; nothing the page hid is lifted`, async () => {
        const { page, ctx, errors } = await openApp(browser!, view, FIXTURE);
        try {
          await ctx.routeWebSocket(/\/ws\/session\//, (ws) => {
            servedSocket(ws);
            for (const frame of FRAMES(live)) ws.send(JSON.stringify(frame));
          });
          await page.goto(`${server!.origin}/s/${SESSION.id}`);
          await page.waitForSelector(live ? '.chat-item .code-block [aria-live]' : '.chat-item .msg-assist', { timeout: 30_000 });
          await page.getByRole('button', { name: 'More' }).waitFor();
          // Measured (Task C40): with the live-region transcript the menu marks no element the page hid itself, so one is
          // planted where the shape needs it: beside the path to the live region (a direct child of the answer holding the
          // code block), or, with no live region, at the body's level, beside the app root the menu marks.
          await page.evaluate((withLive) => {
            const planted = document.createElement('span');
            planted.setAttribute('aria-hidden', 'true');
            planted.className = 'c40-planted';
            planted.textContent = '*';
            const at = withLive ? document.querySelector('.chat-item .code-block')!.parentElement! : document.body;
            at.appendChild(planted);
          }, live);
          const remembered = await rememberOwn(page);
          expect(remembered, 'CONTROL: the page hides some elements itself (icons, decoration)').toBeGreaterThan(0);

          await page.getByRole('button', { name: 'More' }).click();
          await expect.poll(async () => (await read(page)).dialogs.length, { timeout: 10_000 }).toBe(1);
          await page.waitForTimeout(300);
          // The shape review 2310 F2 needs: an element the page hid itself that the menu's Radix has marked, so the
          // aria-hidden package takes it as the page's and will never put it back once anything lifts it.
          const marked = await page.evaluate(() => (window as unknown as { __c40Own: Element[] }).__c40Own
            .filter((el) => el.isConnected && el.hasAttribute('data-aria-hidden')).length);
          expect(marked, 'CONTROL: the menu marked an element the page hid itself').toBeGreaterThan(0);

          await page.getByRole('button', { name: 'Move to another account' }).click();
          // Review 2334 F4: the shape is an overlap, the menu still animating out as the swap sheet opens.
          expect((await read(page)).dialogs.map((d) => d.state).sort(), 'CONTROL: the menu is closing as the swap sheet opens')
            .toEqual(['closed', 'open']);
          await page.locator('.sheet-body .acct-suggested').waitFor();
          await expect.poll(async () => (await read(page)).dialogs.length, { timeout: 10_000 }).toBe(1);
          await page.waitForTimeout(300);
          const swapOpen = await read(page);
          expect(swapOpen.page, 'CONTROL: the page is hidden while the swap sheet is open').toBe(true);
          expect(swapOpen.lostOwn, 'an element the page hid itself was lifted as the menu handed to the swap sheet').toEqual([]);

          await page.keyboard.press('Escape');
          const closing = await read(page);
          expect(closing.dialogs.map((d) => d.state), 'CONTROL: the swap sheet is animating out').toEqual(['closed']);
          expect(closing.active, 'CONTROL: Radix gave the focus back to More as the swap sheet started to close').toBe('More');
          expect(closing.pageMarks, 'the page\'s containers are still aria-hidden while the swap sheet closes').toEqual([]);
          expect(closing.focusHidden, 'the focus is inside an aria-hidden container while the swap sheet closes').toBe(false);
          expect(closing.lostOwn, 'the closing swap sheet lifted an element the page hid itself').toEqual([]);
          await expect.poll(async () => (await read(page)).dialogs.length, { timeout: 10_000 }).toBe(0);
          await page.waitForTimeout(100);
          const after = await read(page);
          expect(after.pageMarks, 'the page stayed hidden after the swap sheet left').toEqual([]);
          expect(after.active, 'CONTROL: the focus is still on More after the swap sheet left').toBe('More');
          expect(after.focusHidden, 'the focus is inside an aria-hidden container after the swap sheet left').toBe(false);
          expect(after.lostOwn, 'an element the page hid itself was left announced for good').toEqual([]);
          expect(errors).toEqual([]);
        } finally { await ctx.close(); }
      });
    }
  }
});

describe('the command palette\'s hand-off to a sheet (Task C40, review 2334 F1; Task C42, review 2343 F4)', () => {
  for (const view of VIEWS) {
    for (const paletteGone of [true, false]) {
      const variant = paletteGone ? 'the palette gone' : 'the palette still closing';
      it(`${view.skin}, ${view.width}px, ${variant}: Show shortcuts from the palette, then Escape: the page is announced as the sheet closes; nothing the page hid is lifted`, async () => {
        const { page, ctx, errors } = await openApp(browser!, view, FIXTURE);
        try {
          await page.goto(`${server!.origin}/fleet`);
          await page.getByRole('button', { name: /^Settings/ }).first().waitFor();
          // An element the page hid itself at the body's level, beside the app root the palette marks.
          await page.evaluate(() => {
            const planted = document.createElement('span');
            planted.setAttribute('aria-hidden', 'true');
            planted.className = 'c40-planted';
            planted.textContent = '*';
            document.body.appendChild(planted);
          });
          await rememberOwn(page);
          await page.keyboard.press('Control+k');
          const input = page.getByRole('combobox', { name: 'Command palette' });
          await input.waitFor({ timeout: 10_000 });
          const marked = await page.evaluate(() => document.querySelector('.c40-planted')!.hasAttribute('data-aria-hidden'));
          expect(marked, 'CONTROL: the palette marked the element the page hid itself').toBe(true);
          await input.fill('shortcuts');
          await page.getByRole('option', { name: /Show shortcuts/ }).click();
          // Review 2343 F4: the shape is an overlap, the palette still animating out as the sheet opens.
          expect((await read(page)).dialogs.map((d) => d.state).sort(), 'CONTROL: the palette is closing as the sheet opens')
            .toEqual(['closed', 'open']);
          if (paletteGone) {
            await expect.poll(async () => (await read(page)).dialogs.length, { timeout: 10_000 }).toBe(1);
            await page.waitForTimeout(300);
            const open = await read(page);
            expect(open.page, 'CONTROL: the page is hidden while the shortcuts sheet is open').toBe(true);
            expect(open.lostOwn, 'an element the page hid itself was lifted as the palette handed to the sheet').toEqual([]);
          } else {
            // The Escape goes to the sheet once its panel holds the focus; the palette is still mounted then (its state
            // control after the Escape holds that).
            await page.waitForFunction(() => document.activeElement?.closest('[role="dialog"][data-state="open"]') != null,
              undefined, { timeout: 10_000 });
          }

          await page.keyboard.press('Escape');
          const closing = await read(page);
          expect(closing.dialogs.map((d) => d.state), paletteGone ? 'CONTROL: the shortcuts sheet is animating out'
            : 'CONTROL: the palette and the shortcuts sheet are both animating out').toEqual(paletteGone ? ['closed'] : ['closed', 'closed']);
          expect(closing.pageMarks, 'the page\'s containers are still aria-hidden while the sheet the palette handed to closes').toEqual([]);
          // Review 2353 F6: the focused element itself. Measured: the focus is in the closing shortcuts sheet, except that at
          // 1280 with the palette still closing the Escape puts it in the closing palette's input (outside C42; c42.md).
          if (paletteGone) {
            expect(closing.focusIn, 'the focus is not in the closing shortcuts sheet').toBe('Keyboard shortcuts:closed');
          } else {
            expect(closing.focusIn, 'the focus is not in a closing dialog').toMatch(/:closed$/);
          }
          expect(closing.focusHidden, 'the focus is inside an aria-hidden container while the sheet closes').toBe(false);
          expect(closing.lostOwn, 'the closing sheet lifted an element the page hid itself').toEqual([]);
          await expect.poll(async () => (await read(page)).dialogs.length, { timeout: 10_000 }).toBe(0);
          await page.waitForTimeout(100);
          const after = await read(page);
          expect(after.pageMarks, 'the page stayed hidden after the sheet left').toEqual([]);
          // Measured (five runs at each width): with the palette gone, Radix leaves the focus on the body once the sheet has
          // left; with the palette still closing, it ends on a page control, the one named "Fleet" at 390 and the one named
          // "❯Select a session" at 1280. Where it lands then is measured, not explained.
          if (paletteGone) expect(after.active, 'CONTROL: Radix left the focus on the body').toBe('BODY');
          else {
            expect([after.focusIn, after.active], 'the focus moved off the page control it lands on')
              .toEqual(['page', view.width === 390 ? 'Fleet' : '❯Select a session']);
          }
          expect(after.focusHidden, 'the focus is inside an aria-hidden container after the sheet left').toBe(false);
          expect(after.lostOwn, 'an element the page hid itself was left announced for good').toEqual([]);
          expect(errors).toEqual([]);
        } finally { await ctx.close(); }
      });
    }
  }
});
