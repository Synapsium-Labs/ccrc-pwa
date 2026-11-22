// The Models sheet on an Anthropic lane, at a phone, a laptop and a wide desk (model-class-advance wave 9, Task A4.3), in a
// real Chrome over the production build: opened from an Anthropic lane's fold on the Accounts screen (a roster row with
// `telemetry: 'anthropic'`) at 360x740, 1280x800 and 1920x1080, with a read that has every Anthropic line drawn (a class held
// on one id while its alias moved to another, a catalogue and a launch that disagree, an orphaned saved level, a class
// with no id, and one the lane's build cannot launch). At each size nothing scrolls sideways, nothing a card holds leaves
// the card, the one control (Revert, since an Anthropic lane offers no Hold or Release) is inside the sheet and at least 44px
// tall. When `CCRC_BROWSER_SHOTS` names a directory the open sheet is saved there as `models-anthropic-<width>.png`.
//
// Run: `( cd pwa && CCRC_BROWSER_SHOTS=<dir> CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/models-sheet-anthropic.browser.test.ts )`.
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer, type OpenedApp } from './app';

const SIZES = [
  { width: 360, height: 740 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];

const now = Date.now();
const classAdv = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ family: null, hold: null, previous: null, revertable: false, lastMove: null, ...over });
const MODELS = {
  ok: true, lane: 'lane-a',
  models: {
    kind: 'read',
    classes: {
      // held on 9-1 while the alias has moved to 9-2; the catalogue and the launch disagree about the alias's id
      opus: {
        model: 'claude-opus-9-1', label: 'Opus 9.1', efforts: ['low', 'high'], source: 'use', cacheTarget: 'claude-opus-9-1', seenId: 'claude-opus-9-2',
        aliasId: 'claude-opus-9-2', unobserved: true, orphanedEffort: { id: 'claude-opus-9-0', level: 'high' },
      },
      sonnet: { model: 'claude-sonnet-9-1', label: 'Sonnet 9.1', efforts: null, source: 'cache', cacheTarget: 'claude-sonnet-9-1' },
      haiku: { model: null, label: null, efforts: null, unobserved: true, unlaunchable: { needs: '9.10.0-with-a-build-label-long-enough-to-wrap-on-a-phone', laneVersion: '9.0.1' } },
      fable: { model: null, label: null, efforts: null, unobserved: true },
    },
    advance: {
      state: 'ok', detail: null, pending: null,
      classes: {
        opus: classAdv({
          family: 'opus', hold: { at: '2026-11-18T08:00:00Z', by: 'hand', model: 'claude-opus-9-1' },
          previous: { model: 'claude-opus-9-0', effort: 'high' }, revertable: true,
        }),
        sonnet: classAdv({ family: 'sonnet' }),
        haiku: classAdv({ family: 'haiku' }),
        fable: classAdv({ family: 'fable' }),
      },
    },
  },
};
const ROSTER = [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false, pool: null, provider: 'anthropic', kind: 'sign-in', telemetry: 'anthropic' }];
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

async function openSheet(browser: Browser, origin: string, size: (typeof SIZES)[number]): Promise<OpenedApp> {
  const opened = await openApp(browser, { width: size.width, skin: REFINED, theme: PHOSPHOR }, FIXTURE);
  const { page } = opened;
  await page.setViewportSize(size);
  await page.goto(`${origin}/`);
  await page.evaluate(() => {
    history.pushState(null, '', '/accounts');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  const card = page.locator('.accounts-row[data-lane="lane-a"]');
  await card.waitFor({ timeout: 30_000 });
  await card.getByRole('button', { name: 'Models for lane-a' }).click();
  await page.waitForSelector('[data-frame="models"] .acct-models-class', { timeout: 20_000 });
  await page.waitForTimeout(500); // the sheet's entry transition
  return opened;
}

describe('the Models sheet on an Anthropic lane at a phone, a laptop and a wide desk', () => {
  for (const size of SIZES) {
    it(`${size.width}x${size.height}`, async () => {
      const opened = await openSheet(browser!, server!.origin, size);
      try {
        const { page } = opened;
        const at = `${size.width}x${size.height}`;
        const m = await page.evaluate(measure);
        expect(m.classes, at).toBe(4);
        expect(m.pageOverflow, `${at}: no horizontal page scroll`).toBeLessThanOrEqual(0);
        expect(m.sheetOverflow, `${at}: nothing scrolls sideways in the sheet`).toBeLessThanOrEqual(1);
        expect(m.escapes, `${at}: nothing leaves its card`).toEqual([]);
        // An Anthropic lane offers no Hold and no Release: Revert on the held class is the one control.
        expect(m.controls, at).toEqual(['Revert the opus class']);
        expect(m.badControls, `${at}: the control is visible, inside the sheet and 44px to 64px tall`).toEqual([]);
        const shots = process.env['CCRC_BROWSER_SHOTS'];
        if (shots !== undefined && shots !== '') await page.screenshot({ path: path.join(shots, `models-anthropic-${size.width}.png`) });
        // On a phone the four cards are taller than the sheet: the lower half is saved too, scrolled to its end.
        if (shots !== undefined && shots !== '' && size.width < 900) {
          await page.evaluate(() => {
            for (const el of document.querySelectorAll<HTMLElement>('.sheet-panel, .sheet-panel *')) if (el.scrollHeight > el.clientHeight + 1) el.scrollTop = el.scrollHeight;
          });
          await page.waitForTimeout(200);
          await page.screenshot({ path: path.join(shots, `models-anthropic-${size.width}-end.png`) });
        }
        // The Anthropic lines are drawn, each once.
        const kinds = await page.evaluate(() => [...document.querySelectorAll('[data-frame="models"] [data-fact]')].map((e) => e.getAttribute('data-fact')));
        expect(kinds.sort(), at).toEqual([
          'alias', 'disagree', 'held', 'no-id', 'orphaned', 'source', 'source', 'supervisor', 'unlaunchable', 'unobserved',
        ]);
        const [c0, c1, c2, c3] = m.cards as [Geometry['cards'][number], Geometry['cards'][number], Geometry['cards'][number], Geometry['cards'][number]];
        if (size.width >= 900) {
          expect(Math.abs(c0.top - c1.top), `${at}: cards one and two share a row`).toBeLessThanOrEqual(1);
          expect(Math.abs(c2.top - c3.top), `${at}: cards three and four share a row`).toBeLessThanOrEqual(1);
        } else {
          for (const c of [c1, c2, c3]) expect(Math.abs(c.left - c0.left), `${at}: one column`).toBeLessThanOrEqual(1);
        }
        expect(opened.errors).toEqual([]);
      } finally {
        await opened.ctx.close();
      }
    }, 120_000);
  }
});
