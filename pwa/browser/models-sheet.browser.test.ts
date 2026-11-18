// The Models sheet at a phone, a laptop and a wide desk (model-class-advance wave R4, Task 20 as re-planned), in a real
// Chrome over the production build: opened from a Codex lane's fold on the Accounts screen at 360x740, 1280x800 and
// 1920x1080, with a read that has every class drawn (a held class, a revertable one, an empty one, a pending intent and a
// model label long enough that no phone row holds it on one line). At each size nothing scrolls sideways (the page, or the
// sheet), nothing a card holds leaves the card, and every control is visible, inside the sheet and at least 44px tall.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/models-sheet.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer } from './app';

const SIZES = [
  { width: 360, height: 740 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];

const now = Date.now();
const LONG_LABEL = 'Lane A Model Opus Tier With A Catalogue Label Long Enough To Wrap On Any Phone Row';
const classAdv = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ family: 'family-a', hold: null, previous: null, revertable: false, lastMove: null, ...over });
const MODELS = {
  ok: true, lane: 'lane-a',
  models: {
    kind: 'read',
    classes: {
      haiku: { model: 'model-6-alpha', label: 'Model Alpha 6', efforts: null },
      sonnet: { model: 'model-6-beta', label: 'Model Beta 6', efforts: null },
      opus: { model: 'vendor/model-opus-tier-7', label: LONG_LABEL, efforts: null },
      fable: { model: null, label: null, efforts: null },
    },
    advance: {
      state: 'ok', detail: null,
      pending: { how: 'hand', class: 'sonnet', from: 'model-6-beta', to: 'model-6.1-beta', emptied: [], at: '2026-11-18T08:00:00Z' },
      classes: {
        haiku: classAdv({ hold: { at: '2026-11-18T08:00:00Z', by: 'hand' } }),
        sonnet: classAdv(),
        opus: classAdv({
          previous: { model: 'vendor/model-opus-tier-6-with-an-unbroken-identifier-that-is-long', effort: 'high' }, revertable: true,
          lastMove: { at: '2026-11-17T09:00:00Z', how: 'advance', from: 'vendor/model-opus-tier-6-with-an-unbroken-identifier-that-is-long', to: 'vendor/model-opus-tier-7', ok: true, canary: 'passed' },
        }),
        fable: classAdv({ family: null, hold: { at: '2026-11-18T08:30:00Z', by: 'revert' } }),
      },
    },
  },
};
const ROSTER = [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false, pool: null, provider: 'openai', kind: 'codex', managed: true }];
const READY = { state: { word: 'signed-in', source: 'checked just now', at: now }, ready: true, check: { verdict: 'ok', at: now } };
const FIXTURE: AppFixture = {
  api: {
    '/api/feed': { events: [] },
    '/api/accounts': {
      accounts: [{ wrapper: 'lane-a', five: null, seven: 30, ts: Math.floor(now / 1000) - 60, fiveResetAt: null, sevenResetAt: null, fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false }],
      projected: null, roster: ROSTER, lanes: { 'lane-a': READY },
      connect: { accountOps: 'available', gate: 'armed', origin: 'https', caps: ['account-v2'], stepUpFreshUntil: now + 3_600_000 },
    },
    '/api/models/lane-a': MODELS,
  },
  fleetFrames: [{ type: 'fleet', sessions: [] }],
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

interface Measure {
  pageOverflow: number;
  sheetOverflow: number;
  /** Controls of the sheet that are hidden, outside the panel, or under 44px tall. */
  badControls: string[];
  controls: string[];
  classes: number;
  /** Text boxes that leave their card. */
  escapes: string[];
}

describe('the Models sheet at a phone, a laptop and a wide desk', () => {
  for (const size of SIZES) {
    it(`${size.width}x${size.height}`, async () => {
      const opened = await openApp(browser!, { width: size.width, skin: REFINED, theme: PHOSPHOR }, FIXTURE);
      try {
        const { page } = opened;
        await page.setViewportSize(size);
        await page.goto(`${server!.origin}/`);
        await page.evaluate(() => {
          history.pushState(null, '', '/accounts');
          dispatchEvent(new PopStateEvent('popstate'));
        });
        const card = page.locator('.accounts-row[data-lane="lane-a"]');
        await card.waitFor({ timeout: 30_000 });
        await card.getByRole('button', { name: 'Models' }).click();
        await page.waitForSelector('[data-frame="models"] .acct-models-class', { timeout: 20_000 });
        await page.waitForTimeout(500); // the sheet's entry transition
        const m = await page.evaluate((): Measure => {
          const panel = document.querySelector<HTMLElement>('.sheet-panel')!;
          const box = panel.getBoundingClientRect();
          const controls = [...panel.querySelectorAll<HTMLElement>('button')].filter((b) => b.closest('[data-frame="models"]') !== null);
          const bad: string[] = [];
          for (const b of controls) {
            const r = b.getBoundingClientRect();
            const style = getComputedStyle(b);
            const name = b.getAttribute('aria-label') ?? b.textContent ?? '';
            if (r.width === 0 || r.height === 0 || style.visibility === 'hidden' || style.display === 'none') bad.push(`${name}: not visible`);
            else {
              if (r.height < 43.5) bad.push(`${name}: ${r.height}px tall`);
              // A card beside a taller one in its row must not stretch its button (seen at 1280: an 85px Release).
              if (r.height > 64) bad.push(`${name}: stretched to ${r.height}px`);
              if (r.left < box.left - 0.5 || r.right > box.right + 0.5) bad.push(`${name}: outside the sheet`);
            }
          }
          const escapes: string[] = [];
          for (const card of panel.querySelectorAll<HTMLElement>('.acct-models-class')) {
            const c = card.getBoundingClientRect();
            for (const el of card.querySelectorAll<HTMLElement>('p, h3, button')) {
              const e = el.getBoundingClientRect();
              if (e.right > c.right + 0.5 || e.left < c.left - 0.5) escapes.push(`${card.getAttribute('data-testid')}: ${(el.textContent ?? '').slice(0, 30)}`);
            }
          }
          return {
            pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            sheetOverflow: panel.scrollWidth - panel.clientWidth,
            badControls: bad,
            controls: controls.map((b) => b.getAttribute('aria-label') ?? b.textContent ?? ''),
            classes: panel.querySelectorAll('.acct-models-class').length,
            escapes,
          };
        });
        const at = `${size.width}x${size.height}`;
        expect(m.classes, at).toBe(4);
        expect(m.pageOverflow, `${at}: no horizontal page scroll`).toBeLessThanOrEqual(0);
        expect(m.sheetOverflow, `${at}: nothing scrolls sideways in the sheet`).toBeLessThanOrEqual(1);
        expect(m.escapes, `${at}: nothing leaves its card`).toEqual([]);
        // Hold on sonnet and opus, Release on haiku and fable, Revert on opus: five controls, all drawn and tappable.
        expect(m.controls.sort(), at).toEqual([
          'Hold the opus class', 'Hold the sonnet class', 'Release the fable class', 'Release the haiku class', 'Revert the opus class',
        ]);
        expect(m.badControls, `${at}: every control visible, inside the sheet, at least 44px and at most 64px tall`).toEqual([]);
        expect(opened.errors).toEqual([]);
      } finally {
        await opened.ctx.close();
      }
    }, 120_000);
  }
});
