// The Models sheet at a phone, a laptop and a wide desk (model-class-advance wave R4, Task 20 as re-planned), in a real
// Chrome over the production build: opened from a Codex lane's fold on the Accounts screen at 360x740, 1280x800 and
// 1920x1080, with a read that has every class drawn (a held class, two revertable ones, an empty one, a pending intent and a
// model label long enough that no phone row holds it on one line), carrying the proof that the fleet box ends a revert's hold
// by itself, so Revert is the one control drawn (no Hold, no Release: revert-holds-until-newer, D-8757). At each size nothing scrolls sideways (the page, or the
// sheet), nothing a card holds leaves the card, and every control is visible, inside the sheet and at least 44px tall.
//
// F14: it also measures the layout (two cards to a row from 900, one column below), a refusal note and a note that the act
// MAY have run drawn in their cards, a long unbroken advance detail, the Revert confirm against the viewport, and one view
// under a second skin and a light theme.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/models-sheet.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer, type OpenedApp } from './app';

const SIZES = [
  { width: 360, height: 740 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];
/** The views each size is measured in: the console's own skin and theme, and one more skin under a light theme. */
const VIEWS = [
  ...SIZES.map((size) => ({ size, skin: REFINED, theme: PHOSPHOR as string })),
  { size: SIZES[1]!, skin: INSTRUMENT, theme: 'light' },
  { size: SIZES[0]!, skin: INSTRUMENT, theme: 'light' },
];
/** An advance detail the verb printed: one long unbroken path-like string, which no line holds on a phone. */
const LONG_DETAIL = '/srv/lane-a/state/advance/with-a-very-long-unbroken-directory-name-that-has-no-break-opportunity/advance-file-that-cannot-be-read.json could not be read: EACCES.';

const now = Date.now();
const LONG_LABEL = 'Lane A Model Opus Tier With A Catalogue Label Long Enough To Wrap On Any Phone Row';
const classAdv = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ family: 'family-a', hold: null, previous: null, revertable: false, lastMove: null, ...over });
const MODELS = {
  ok: true, lane: 'lane-a',
  models: {
    kind: 'read',
    revertHoldEnds: true,
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
        sonnet: classAdv({ previous: { model: 'model-5-beta', effort: null }, revertable: true }),
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

interface Geometry {
  pageOverflow: number;
  sheetOverflow: number;
  /** Controls of the sheet that are hidden, outside the panel, or under 44px tall. */
  badControls: string[];
  controls: string[];
  classes: number;
  /** Text boxes that leave their card (or, with no cards, the panel). */
  escapes: string[];
  /** The cards' left and top, in order. */
  cards: { left: number; top: number }[];
}

/** One measure of the open sheet, in the page. */
function measure(): Geometry {
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
  const inside = (el: HTMLElement, c: DOMRect, label: string): void => {
    const e = el.getBoundingClientRect();
    // A box that leaves its container, or text that overflows its own box (a line that does not wrap).
    if (e.right > c.right + 0.5 || e.left < c.left - 0.5 || el.scrollWidth > el.clientWidth + 1) escapes.push(`${label}: ${(el.textContent ?? '').slice(0, 30)}`);
  };
  for (const card of panel.querySelectorAll<HTMLElement>('.acct-models-class')) {
    const c = card.getBoundingClientRect();
    for (const el of card.querySelectorAll<HTMLElement>('p, h3, button')) inside(el, c, card.getAttribute('data-testid') ?? 'card');
  }
  for (const el of panel.querySelectorAll<HTMLElement>('[data-frame="models"] > .acct-models-note, [data-frame="models"] > .acct-models-failed')) inside(el, box, 'panel');
  return {
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    sheetOverflow: panel.scrollWidth - panel.clientWidth,
    badControls: bad,
    controls: controls.map((b) => b.getAttribute('aria-label') ?? b.textContent ?? ''),
    classes: panel.querySelectorAll('.acct-models-class').length,
    escapes,
    cards: [...panel.querySelectorAll<HTMLElement>('.acct-models-class')].map((c) => { const r = c.getBoundingClientRect(); return { left: r.left, top: r.top }; }),
  };
}

async function openSheet(browser: Browser, origin: string, view: (typeof VIEWS)[number], fixture: AppFixture): Promise<OpenedApp> {
  const opened = await openApp(browser, { width: view.size.width, skin: view.skin, theme: view.theme }, fixture);
  const { page } = opened;
  await page.setViewportSize(view.size);
  await page.goto(`${origin}/fleet`);
  await page.evaluate(() => {
    history.pushState(null, '', '/accounts');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  const card = page.locator('.accounts-row[data-lane="lane-a"]');
  await card.waitFor({ timeout: 30_000 });
  await card.getByRole('button', { name: 'Models for lane-a' }).click();
  await page.waitForSelector('[data-frame="models"] .acct-models-class, [data-frame="models"] .acct-models-note', { timeout: 20_000 });
  await page.waitForTimeout(500); // the sheet's entry transition
  return opened;
}

const nameOf = (v: (typeof VIEWS)[number]): string => `${v.size.width}x${v.size.height} ${v.skin}/${v.theme}`;

describe('the Models sheet at a phone, a laptop and a wide desk', () => {
  for (const view of VIEWS) {
    it(nameOf(view), async () => {
      const opened = await openSheet(browser!, server!.origin, view, FIXTURE);
      try {
        const { page } = opened;
        const at = nameOf(view);
        const m = await page.evaluate(measure);
        expect(m.classes, at).toBe(4);
        expect(m.pageOverflow, `${at}: no horizontal page scroll`).toBeLessThanOrEqual(0);
        expect(m.sheetOverflow, `${at}: nothing scrolls sideways in the sheet`).toBeLessThanOrEqual(1);
        expect(m.escapes, `${at}: nothing leaves its card`).toEqual([]);
        // Revert on sonnet and opus, the two classes with something on record to put back; the held haiku and fable carry
        // no control, and nothing is a Hold or a Release: two controls, both drawn and tappable.
        expect(m.controls.sort(), at).toEqual(['Revert the opus class', 'Revert the sonnet class']);
        expect(m.badControls, `${at}: every control visible, inside the sheet and 44px to 64px tall`).toEqual([]);
        // LAYOUT: two cards to a row from 900 wide, one column below.
        const [c0, c1, c2, c3] = m.cards as [Geometry['cards'][number], Geometry['cards'][number], Geometry['cards'][number], Geometry['cards'][number]];
        if (view.size.width >= 900) {
          expect(Math.abs(c0.top - c1.top), `${at}: cards one and two share a row`).toBeLessThanOrEqual(1);
          expect(Math.abs(c2.top - c3.top), `${at}: cards three and four share a row`).toBeLessThanOrEqual(1);
          expect(c1.left, `${at}: the second card sits right of the first`).toBeGreaterThan(c0.left + 50);
          expect(c2.top, `${at}: the second row sits below the first`).toBeGreaterThan(c0.top + 50);
        } else {
          for (const c of [c1, c2, c3]) expect(Math.abs(c.left - c0.left), `${at}: one column`).toBeLessThanOrEqual(1);
          expect(c1.top, at).toBeGreaterThan(c0.top);
          expect(c2.top, at).toBeGreaterThan(c1.top);
          expect(c3.top, at).toBeGreaterThan(c2.top);
        }

        // A refusal note and a note that the act MAY have run, drawn in their cards (the POST is answered by the test).
        let posts = 0;
        await page.context().route('**/api/models/lane-a', async (route) => {
          if (route.request().method() !== 'POST') { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MODELS) }); return; }
          posts += 1;
          const refused = posts === 1;
          await route.fulfill({
            status: refused ? 409 : 502, contentType: 'application/json',
            body: JSON.stringify(refused ? { ok: false, error: 'lane-act-refused', verbCode: 'settings-unwritable' } : { ok: false, error: 'outcome-unknown', cause: 'timeout' }),
          });
        });
        await page.getByRole('button', { name: 'Revert the sonnet class' }).click();
        await page.getByRole('dialog', { name: /Revert the sonnet class\?/ }).getByRole('button', { name: 'Put back and hold' }).click();
        await page.waitForSelector('[data-testid="models-note-sonnet"][data-kind="refused"]', { timeout: 10_000 });
        await page.getByRole('button', { name: 'Revert the opus class' }).click();
        await page.getByRole('dialog', { name: /Revert the opus class\?/ }).getByRole('button', { name: 'Put back and hold' }).click();
        await page.waitForSelector('[data-testid="models-note-opus"][data-kind="unknown"]', { timeout: 10_000 });
        const withNotes = await page.evaluate(measure);
        expect(withNotes.escapes, `${at}: the notes wrap inside their cards`).toEqual([]);
        expect(withNotes.pageOverflow, `${at}: the notes add no page scroll`).toBeLessThanOrEqual(0);
        expect(withNotes.sheetOverflow, `${at}: the notes add no sheet scroll`).toBeLessThanOrEqual(1);
        expect(withNotes.badControls, `${at}: controls stay tappable beside a note`).toEqual([]);
        // The two kinds are two inks.
        const inks = await page.evaluate(() => ['refused', 'unknown'].map((k) => getComputedStyle(document.querySelector(`.acct-models-refusal[data-kind="${k}"]`)!).color));
        expect(inks[0], `${at}: a refusal and a "may have run" note are not the same ink`).not.toBe(inks[1]);

        // The Revert confirm fits the viewport.
        await page.getByRole('button', { name: 'Revert the opus class' }).click();
        const dialog = page.getByRole('dialog', { name: /Revert the opus class\?/ });
        await dialog.waitFor({ timeout: 10_000 });
        await page.waitForTimeout(500);
        const fit = await page.evaluate(() => {
          const panel = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find((d) => /Revert the opus class\?/.test(d.textContent ?? ''))!;
          const r = panel.getBoundingClientRect();
          const buttons = [...panel.querySelectorAll<HTMLElement>('button')].filter((b) => /Put back and hold|Cancel/.test(b.textContent ?? ''));
          return {
            left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: innerWidth, vh: innerHeight,
            buttons: buttons.map((b) => { const x = b.getBoundingClientRect(); return { name: b.textContent, left: x.left, right: x.right, top: x.top, bottom: x.bottom }; }),
          };
        });
        expect(fit.left, `${at}: the confirm starts inside the viewport`).toBeGreaterThanOrEqual(-0.5);
        expect(fit.right, `${at}: the confirm ends inside the viewport`).toBeLessThanOrEqual(fit.vw + 0.5);
        expect(fit.top, at).toBeGreaterThanOrEqual(-0.5);
        expect(fit.bottom, at).toBeLessThanOrEqual(fit.vh + 0.5);
        expect(fit.buttons.map((b) => b.name).sort(), at).toEqual(['Cancel', 'Put back and hold']);
        for (const b of fit.buttons) {
          expect(b.left, `${at}: ${b.name}`).toBeGreaterThanOrEqual(-0.5);
          expect(b.right, `${at}: ${b.name}`).toBeLessThanOrEqual(fit.vw + 0.5);
          expect(b.bottom, `${at}: ${b.name}`).toBeLessThanOrEqual(fit.vh + 0.5);
        }
        expect(opened.errors).toEqual([]);
      } finally {
        await opened.ctx.close();
      }
    }, 120_000);
  }

  for (const size of SIZES) {
    it(`${size.width}x${size.height}: a long unbroken advance detail wraps inside the sheet`, async () => {
      const unreadable = { ...MODELS, models: { ...MODELS.models, advance: { state: 'unreadable', detail: LONG_DETAIL, pending: null, classes: null } } };
      const opened = await openSheet(browser!, server!.origin, { size, skin: REFINED, theme: PHOSPHOR },
        { ...FIXTURE, api: { ...FIXTURE.api, '/api/models/lane-a': unreadable } });
      try {
        const at = `${size.width}x${size.height}`;
        await opened.page.waitForSelector('[data-testid="models-advance"][data-state="unreadable"]', { timeout: 10_000 });
        const m = await opened.page.evaluate(measure);
        const detailInside = await opened.page.evaluate(() => {
          const p = document.querySelector<HTMLElement>('[data-testid="models-advance"]')!.getBoundingClientRect();
          const panel = document.querySelector<HTMLElement>('.sheet-panel')!.getBoundingClientRect();
          return { right: p.right, panelRight: panel.right, height: p.height };
        });
        expect(detailInside.right, `${at}: the detail stays inside the panel`).toBeLessThanOrEqual(detailInside.panelRight + 0.5);
        expect(detailInside.height, `${at}: a long path takes more than one line`).toBeGreaterThan(20);
        expect(m.pageOverflow, `${at}: no horizontal page scroll`).toBeLessThanOrEqual(0);
        expect(m.sheetOverflow, `${at}: nothing scrolls sideways in the sheet`).toBeLessThanOrEqual(1);
        expect(m.escapes, `${at}: nothing leaves the panel`).toEqual([]);
        expect(opened.errors).toEqual([]);
      } finally {
        await opened.ctx.close();
      }
    }, 120_000);
  }
});
