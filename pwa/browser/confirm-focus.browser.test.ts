// Desktop polish Task C38 (D-8670), in a real Chrome over the production build, a phone and a desk view: a switch card's
// confirm sheet, closed without a write, gives the focus back to its radio group, on the checked radio, the choice that
// stands (item 5, review 1703); the page is not aria-hidden while the sheet closes (item 1, PR10b's reviews), nor after a
// sheet that has gone opens and closes again; and Shift+Tab pressed first stays in the sheet (item 2). Two shapes of
// switch card: Worktrees left behind opens its sheet on the tap and disables its fieldset in that commit; Shadow lanes
// opens it on the server's 409 to a write that disabled the fieldset while it waited (as Cleanup and Stall watch do).
// Both drop the focus to the page in Chrome before the sheet can read its opener. `test/sheet-trap-hide.test.tsx` holds
// the same rules in jsdom. RED FIRST, measured 2026-11-16 against origin/main 0c573d7f3: every close row and both
// Shift+Tab rows failed there (the root aria-hidden while closing, then the focus on BODY; Shift+Tab on the page's
// Search). The re-open row passes on main, which has no lift; it pins the lift's own reopen (red under the first build).
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts
// browser/confirm-focus.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import type { DelegationAdoptView } from '../../shared/delegation-adopt';
import { LANE_ARM_TEXT as LT, ROSTER_CARD_SHADOW_LOG } from '../../shared/lane-arm';
import { COORDINATOR_ROSTER_CARD_LIVE_MARKER } from '../../shared/switches';
import { DELEGATION_ADOPT_TEXT as T } from '../src/fleet/delegationAdoptWords';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const VIEWS: readonly AppView[] = [{ skin: REFINED, theme: PHOSPHOR, width: 390 }, { skin: INSTRUMENT, theme: 'light', width: 1280 }];
const SHADOW: DelegationAdoptView = {
  state: 'clear', caps: { verb: 'present', audit: 'present' }, refused: { on: null, off: null },
  adoption: { mode: 'shadow', adopted: 0, wouldAdopt: 2, waiting: 0, unchanged: 0, unaudited: 0, conflicting: 0, unsupported: 0, uncensused: 0, owed: 0, keeps: { items: [], more: 0 } },
};
const laneView = { ok: true, lanes: [{ lane: 'roster-card', stored: 'shadow', detail: null, live: false, updatedAt: 0,
  imported: { result: 'absent', at: 1 }, marker: COORDINATOR_ROSTER_CARD_LIVE_MARKER }] };
const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [] },
    '/api/projects': { roots: ['/w'], projects: [] },
    '/api/runs': { runs: [] },
    '/api/claims': [],
  },
  fleetFrames: [{ type: 'fleet', sessions: [] }, { type: 'runs', runs: [] }, { type: 'coord', coord: { pause: 'clear' } }],
};

let dist: string | undefined;
let server: DistServer | undefined;
let browser: Browser | undefined;
beforeAll(async () => {
  const executablePath = resolveChrome();
  dist = sharedDist();
  server = await serveDist(dist);
  browser = await chromium.launch({ executablePath, headless: true });
}, 180_000);
afterAll(async () => { await browser?.close(); await server?.close(); });

const where = (page: Page): Promise<string> => page.evaluate(() => {
  const a = document.activeElement as HTMLElement | null;
  if (a === null || a === document.body) return 'BODY';
  const label = a instanceof HTMLInputElement ? [...(a.labels ?? [])].map((l) => l.textContent).join(' ') : a.textContent;
  return `${a.tagName}${a.getAttribute('role') ? `[${a.getAttribute('role')}]` : ''}:${(label ?? '').trim().slice(0, 30)}`;
});

async function app(view: AppView) {
  const opened = await openApp(browser!, view, FIXTURE);
  await opened.ctx.route('**/api/coord/delegation-adopt', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ...SHADOW }) }));
  await opened.ctx.route('**/api/coord/lane-arm', (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(laneView) });
    return r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'confirm-required',
      lane: 'roster-card', confirmKey: 'k', facts: { stored: 'shadow', updatedAt: 0, shadowLog: ROSTER_CARD_SHADOW_LOG } }) });
  });
  await opened.page.goto(server!.origin + '/settings/automation');
  return opened;
}

type How = 'Cancel' | 'Escape' | 'scrim';

/** Opens a card's confirm from the keyboard: its radio pair's checked choice focused, then ArrowDown to the other. */
async function openFromKeyboard(page: Page, card: 'adopt' | 'lanes'): Promise<void> {
  const section = page.getByRole('region', { name: card === 'adopt' ? T.title : LT.title });
  const first = section.getByRole('radio', { name: card === 'adopt' ? T.off : LT.shadow });
  await expect.poll(() => first.isChecked(), { timeout: 20_000 }).toBe(true);
  await first.focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => page.getByRole('dialog').isVisible(), { timeout: 10_000 }).toBe(true);
}

async function close(page: Page, how: How): Promise<void> {
  if (how === 'Cancel') await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  else if (how === 'Escape') await page.keyboard.press('Escape');
  else await page.mouse.click(5, 5);
}

describe('a switch card\'s confirm, closed without a write (Task C38)', () => {
  for (const view of VIEWS) {
    const named = `${view.skin}, ${view.width}px`;
    for (const card of ['adopt', 'lanes'] as const) {
      for (const how of ['Cancel', 'Escape', 'scrim'] as const) {
        it(`${named}: ${card === 'adopt' ? 'Worktrees left behind' : 'Shadow lanes'}, ${how}: the focus is back on the group's checked radio, and the page was announced while the sheet closed`, async () => {
          const { page, ctx, errors } = await app(view);
          try {
            await openFromKeyboard(page, card);
            await close(page, how);
            // In the same task as the close, while the panel animates out: no ancestor of the page's content is hidden.
            const hidden = await page.evaluate(() => {
              const out: string[] = [];
              for (let el: Element | null = document.querySelector('main'); el !== null; el = el.parentElement) {
                if (el.getAttribute('aria-hidden') === 'true') out.push(el.id || el.tagName);
              }
              return { out, panel: document.querySelector('[role="dialog"]') !== null };
            });
            expect(hidden.panel, 'CONTROL: the panel is still mounted, animating out').toBe(true);
            expect(hidden.out, 'the page is aria-hidden while the sheet closes').toEqual([]);
            await expect.poll(() => page.getByRole('dialog').count(), { timeout: 10_000 }).toBe(0);
            await page.waitForTimeout(300);
            expect(await where(page), 'the focus did not come back to the radio group, on its checked radio')
              .toBe(`INPUT:${card === 'adopt' ? T.off : LT.shadow}`);
            expect(errors).toEqual([]);
          } finally { await ctx.close(); }
        });
      }
    }
    it(`${named}: a confirm closed, gone, then opened and closed again leaves the page announced`, async () => {
      const { page, ctx } = await app(view);
      try {
        const rootHidden = (): Promise<boolean> => page.evaluate(() => {
          for (let el: Element | null = document.querySelector('main'); el !== null; el = el.parentElement) {
            if (el.getAttribute('aria-hidden') === 'true') return true;
          }
          return false;
        });
        for (const round of [1, 2, 3]) {
          await openFromKeyboard(page, 'adopt');
          expect(await rootHidden(), `CONTROL: open ${round} hides the page`).toBe(true);
          await close(page, 'Cancel');
          await expect.poll(() => page.getByRole('dialog').count(), { timeout: 10_000 }).toBe(0);
          await page.waitForTimeout(100);
          expect(await rootHidden(), `the page stayed aria-hidden after close ${round}`).toBe(false);
        }
      } finally { await ctx.close(); }
    });
    it(`${named}: Shift+Tab pressed first stays in the sheet, on its last control`, async () => {
      const { page, ctx } = await app(view);
      try {
        await openFromKeyboard(page, 'adopt');
        await page.waitForTimeout(400);
        const sheet = page.getByRole('dialog');
        expect(await sheet.evaluate((d) => d === document.activeElement), 'CONTROL: the panel holds the focus on open').toBe(true);
        await page.keyboard.press('Shift+Tab');
        expect(await sheet.evaluate((d) => d.contains(document.activeElement)), 'Shift+Tab pressed first left the sheet').toBe(true);
        expect(await where(page)).toBe('BUTTON:Cancel');
        await page.keyboard.press('Shift+Tab');
        expect(await sheet.evaluate((d) => d.contains(document.activeElement)), 'a second Shift+Tab left the sheet').toBe(true);
      } finally { await ctx.close(); }
    });
  }
});
