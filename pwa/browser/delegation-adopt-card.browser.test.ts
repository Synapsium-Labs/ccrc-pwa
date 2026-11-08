// Settings › Automation › Worktrees left behind (D-8114), in a real Chrome over the production build, at 360, 390, 1280 and
// 1920 in both skins. `test/delegation-adopt-section.test.tsx` holds the card's behaviour in jsdom; this file holds what only
// an engine can say: the card in shadow with a full list of long names, then with the sheet open, then with a refusal shown
// (the fleet box's change check missing), then a server whose sign-in is dark (`sign-in-unarmed`, review 1665 N6), nothing in
// the card or on the page overflowing sideways, and the two choices
// reached and picked: Keep them only after the sheet's confirm, Do not keep at once, each write answered by the stub below.
//
// The app answers from a fixture (`browser/app.ts`): no server, no ccd. `GET`/`POST /api/coord/delegation-adopt` answer from
// one stored view that starts in shadow with the switch off. Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary>
// ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/delegation-adopt-card.browser.test.ts )`.
// `CCRC_SHOTS=<a directory>` keeps one picture per view.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import type { DelegationAdoptionKeep } from '../../shared/api';
import type { DelegationAdoptView } from '../../shared/delegation-adopt';
import { DELEGATION_ADOPT_REFUSAL_TEXT, DELEGATION_ADOPT_TEXT as T, delegationAdoptRefusedLine } from '../src/fleet/delegationAdoptWords';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const VIEWS: readonly AppView[] = [360, 390, 1280, 1920].flatMap((width) => [
  { skin: REFINED, theme: PHOSPHOR, width }, { skin: INSTRUMENT, theme: 'light', width },
]);
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;
const DOOR = '/api/coord/delegation-adopt';

/** Fifty worktrees with the longest names the card is likely to meet: one long token each, which must wrap, not push. */
const KEEPS: DelegationAdoptionKeep[] = Array.from({ length: 50 }, (_, i) => ({
  project: 'project-with-a-rather-long-name', worktree: `agent-a${String(i).padStart(2, '0')}-0123456789abcdef0123456789abcdef`,
  parent: 'session-0123456789abcdef0123456789abcdef',
  ...(i % 2 === 0 ? { changes: { dirty: true, aheadOfBase: i, branchAheadOfBase: i % 3 === 0 ? 'no-branch' as const : 1 } } : {}),
}));
const SHADOW: DelegationAdoptView = {
  state: 'clear', caps: { verb: 'present', audit: 'present' }, refused: { on: null, off: null },
  adoption: { mode: 'shadow', adopted: 0, wouldAdopt: 53, waiting: 1, unchanged: 3, unaudited: 0, conflicting: 0, unsupported: 0, uncensused: 0, owed: 0, keeps: { items: KEEPS, more: 3 } },
};
const NO_CHECK: DelegationAdoptView = {
  ...SHADOW, caps: { verb: 'present', audit: 'absent' }, refused: { on: 'fleet-audit-missing', off: null },
  adoption: { ...SHADOW.adoption!, mode: 'unmeasured', wouldAdopt: 0, keeps: undefined },
};

/** A server whose sign-in is dark: the view reads whole, with on refused for the caller (review 1665 N6). */
const DARK: DelegationAdoptView = { ...SHADOW, refused: { on: 'sign-in-unarmed', off: null } };

const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [] },
    '/api/projects': { roots: ['/w'], projects: [] },
    '/api/runs': { runs: [] },
    '/api/claims': [],
  },
  fleetFrames: [
    { type: 'fleet', sessions: [] },
    { type: 'runs', runs: [] },
    { type: 'coord', coord: { pause: 'clear' } },
  ],
};

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

interface Box { left: number; right: number; top: number; bottom: number }
interface Measured {
  viewport: number;
  pageScrollWidth: number;
  pageClientWidth: number;
  detail: { scrollWidth: number; clientWidth: number } | null;
  section: { scrollWidth: number; clientWidth: number };
  card: { scrollWidth: number; clientWidth: number; box: Box };
  texts: { text: string; box: Box }[];
}

describe('Settings › Automation › Worktrees left behind at every width, in both skins (D-8114)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      let current: DelegationAdoptView = SHADOW;
      const posts: unknown[] = [];
      // The write waits on the case, so the card can be measured while it holds the choice.
      let answer: () => void = () => undefined;
      const held = (): Promise<void> => new Promise((done) => { answer = done; });
      let hold: Promise<void> | null = null;
      await ctx.route(`**${DOOR}`, async (r) => {
        const req = r.request();
        if (req.method() === 'POST') {
          const body = req.postDataJSON() as { on?: unknown } | null;
          posts.push(body);
          if (typeof body?.on !== 'boolean') {
            return r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'bad-request' }) });
          }
          if (hold !== null) await hold;
          current = { ...current, state: body.on ? 'set' : 'clear' };
        }
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ...current }) });
      });
      try {
        await page.goto(server!.origin + '/settings/automation');
        const section = page.getByRole('region', { name: T.title });
        const off = section.getByRole('radio', { name: T.off });
        const on = section.getByRole('radio', { name: T.on });
        await expect.poll(() => off.isChecked(), { timeout: 20_000 }).toBe(true);
        expect(await section.getByRole('radio').count(), 'the card does not offer exactly two choices').toBe(2);
        expect(await on.isChecked()).toBe(false);
        expect(await section.getByRole('group', { name: T.legend }).isVisible(), 'the switch is not visible').toBe(true);
        expect(await section.getByRole('listitem').count(), 'the list is not drawn whole').toBe(50);

        const measure = (): Promise<Measured> => section.evaluate((el): Measured => {
          const box = (e: Element): Box => {
            const r = e.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
          };
          const card = el.querySelector(':scope > div:last-child');
          if (card === null) throw new Error('the card has no body');
          const detail = document.querySelector('.shell-detail');
          return {
            viewport: window.innerWidth,
            pageScrollWidth: document.documentElement.scrollWidth,
            pageClientWidth: document.documentElement.clientWidth,
            detail: detail === null ? null : { scrollWidth: detail.scrollWidth, clientWidth: detail.clientWidth },
            section: { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth },
            card: { scrollWidth: card.scrollWidth, clientWidth: card.clientWidth, box: box(card) },
            texts: [...card.querySelectorAll('p, label, legend, li')].map((e) => ({ text: e.textContent ?? '', box: box(e) })),
          };
        });
        const fits = (m: Measured): void => {
          expect(m.card.scrollWidth, 'the card overflows sideways').toBeLessThanOrEqual(m.card.clientWidth);
          expect(m.section.scrollWidth, 'the section overflows sideways').toBeLessThanOrEqual(m.section.clientWidth);
          if (m.detail !== null) expect(m.detail.scrollWidth, 'the detail pane scrolls sideways').toBeLessThanOrEqual(m.detail.clientWidth);
          expect(m.pageScrollWidth, 'the page scrolls sideways').toBeLessThanOrEqual(m.pageClientWidth);
          expect(m.card.box.left, 'the card starts left of the viewport').toBeGreaterThanOrEqual(0);
          expect(m.card.box.right, 'the card runs past the viewport').toBeLessThanOrEqual(m.viewport);
          for (const t of m.texts) {
            expect(t.box.left, `"${t.text}" starts left of its card`).toBeGreaterThanOrEqual(m.card.box.left - 0.5);
            expect(t.box.right, `"${t.text}" runs past its card`).toBeLessThanOrEqual(m.card.box.right + 0.5);
            expect(t.box.bottom - t.box.top, `"${t.text}" has no height`).toBeGreaterThan(0);
          }
        };
        fits(await measure());
        const shots = process.env.CCRC_SHOTS;
        if (shots) fs.mkdirSync(shots, { recursive: true });
        /** The viewport, with one line of the card scrolled to its middle. */
        const viewAt = async (text: string, file: string): Promise<void> => {
          await section.getByText(text).evaluate((e) => { e.scrollIntoView({ block: 'center' }); });
          await page.screenshot({ path: path.join(shots!, file) });
        };
        if (shots) await section.screenshot({ path: path.join(shots, `delegation-adopt-shadow-${view.skin}-${view.width}.png`) });

        // Keep them asks first: the sheet opens, nothing is sent, and the radio stays where the server put it.
        await on.click();
        const sheet = page.getByRole('dialog');
        await expect.poll(() => sheet.isVisible(), { timeout: 10_000 }).toBe(true);
        expect(await sheet.getByText(/This would keep 53 worktrees/).count(), 'the sheet does not name the count').toBe(1);
        expect(await sheet.getByText(/mailed/).count(), 'the sheet does not say the owners are mailed').toBe(1);
        expect(posts, 'a tap sent a write before the confirm').toEqual([]);
        await page.waitForTimeout(500);   // the sheet's own entrance, so the picture shows it at rest
        if (shots) await page.screenshot({ path: path.join(shots, `delegation-adopt-confirm-${view.skin}-${view.width}.png`) });
        await sheet.getByRole('button', { name: 'Cancel' }).click();
        await expect.poll(() => sheet.isVisible(), { timeout: 10_000 }).toBe(false);
        expect(posts).toEqual([]);

        // Confirmed: the write waits on the answer, the choice is held with its line on screen and still fitting.
        hold = held();
        await on.click();
        await sheet.getByRole('button', { name: T.confirmLabel }).click();
        await expect.poll(() => section.getByText(T.asked).isVisible(), { timeout: 10_000 }).toBe(true);
        expect(await off.isChecked(), 'the tap moved the radio before the server said so').toBe(true);
        expect(await on.isDisabled(), 'the choice is not held while the tap waits').toBe(true);
        fits(await measure());
        hold = null;
        answer();
        await expect.poll(() => on.isChecked(), { timeout: 10_000 }).toBe(true);
        await expect.poll(() => on.isDisabled(), { timeout: 10_000 }).toBe(false);
        expect(await section.getByText(T.asked).count()).toBe(0);

        // And back from the keyboard: Do not keep asks nothing.
        await on.focus();
        await page.keyboard.press('ArrowUp');
        await expect.poll(() => off.isChecked(), { timeout: 10_000 }).toBe(true);
        expect(posts).toEqual([{ on: true }, { on: false }]);

        // A refusal shown: the fleet box's change check is missing, so Keep them cannot be chosen, and the card says why.
        current = NO_CHECK;
        await page.reload();
        await expect.poll(() => section.getByText(delegationAdoptRefusedLine(T.on, 'fleet-audit-missing')).isVisible(), { timeout: 20_000 }).toBe(true);
        expect(await section.getByText(DELEGATION_ADOPT_REFUSAL_TEXT['fleet-audit-missing'], { exact: false }).count()).toBeGreaterThan(0);
        expect(await on.isDisabled(), 'a refused choice is offered').toBe(true);
        expect(await off.isDisabled()).toBe(false);
        fits(await measure());
        if (shots) await section.screenshot({ path: path.join(shots, `delegation-adopt-refused-${view.skin}-${view.width}.png`) });
        // The section's own picture is mostly the list; this one is the viewport with the refusal line in it.
        if (shots) await viewAt(delegationAdoptRefusedLine(T.on, 'fleet-audit-missing'), `delegation-adopt-refused-view-${view.skin}-${view.width}.png`);

        // Sign-in dark: the view still reads whole (the switch, the list), and Keep them is refused in the card's own words.
        current = DARK;
        await page.reload();
        await expect.poll(() => section.getByText(delegationAdoptRefusedLine(T.on, 'sign-in-unarmed')).isVisible(), { timeout: 20_000 }).toBe(true);
        expect(await off.isChecked(), 'a dark server\'s view did not read').toBe(true);
        expect(await on.isDisabled(), 'a refused choice is offered').toBe(true);
        expect(await off.isDisabled()).toBe(false);
        expect(await section.getByRole('listitem').count(), 'the list is not drawn whole').toBe(50);
        fits(await measure());
        if (shots) await section.screenshot({ path: path.join(shots, `delegation-adopt-signin-${view.skin}-${view.width}.png`) });
        if (shots) await viewAt(delegationAdoptRefusedLine(T.on, 'sign-in-unarmed'), `delegation-adopt-signin-view-${view.skin}-${view.width}.png`);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});
