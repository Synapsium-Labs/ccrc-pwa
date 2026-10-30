// Settings › Automation › Roll idle sessions (D-7453), in a real Chrome over the production build, at phone, laptop and
// wide widths. `test/settings-roll-idle.test.tsx` holds the card's behaviour in jsdom; this file holds what only an
// engine can say: the card draws its two choices with the default checked, nothing in it or on the page overflows
// sideways, and each choice can be reached and picked, its write answered by the stub below.
//
// The app answers from a fixture (`browser/app.ts`): no server, no ccd. `GET`/`POST /api/coord/roll-idle` answer from
// one stored value that starts at the default a fresh store reads, as the server's door does. Run: `( cd pwa &&
// CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts
// browser/roll-idle-card.browser.test.ts )`. `CCRC_SHOTS=<a directory>` keeps one picture per width.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { CLAUDE_ROLL_TARGETS, CLAUDE_ROLL_TARGETS_DEFAULT, isClaudeRollTargets, type ClaudeRollTargets } from '../../shared/claudeVersion';
import { ROLL_IDLE_LABELS } from '../src/fleet/RollIdleSection';
import { SETTINGS_CARDS } from '../src/fleet/settingsText';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';

/** Phone, laptop and wide, each in the skin that width boots by default. */
const VIEWS: readonly (AppView & { readonly band: string })[] = [
  { band: 'phone', skin: REFINED, theme: PHOSPHOR, width: 390 },
  { band: 'laptop', skin: INSTRUMENT, theme: 'light', width: 1280 },
  { band: 'wide', skin: INSTRUMENT, theme: PHOSPHOR, width: 1920 },
];
const named = (v: (typeof VIEWS)[number]): string => `${v.band}: ${v.skin}, ${v.theme}, ${v.width}px`;

const TITLE = SETTINGS_CARDS.automation.roll.title;
const DOOR = '/api/coord/roll-idle';

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
  dist = buildDist();
  server = await serveDist(dist);
  browser = await chromium.launch({ executablePath, headless: true });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
  removeDist(dist);
});

interface Box { left: number; right: number; top: number; bottom: number }
interface Measured {
  viewport: number;
  pageScrollWidth: number;
  pageClientWidth: number;
  detail: { scrollWidth: number; clientWidth: number } | null;
  section: { scrollWidth: number; clientWidth: number; box: Box };
  card: { scrollWidth: number; clientWidth: number; box: Box };
  options: { label: string; box: Box }[];
}

describe('Settings › Automation › Roll idle sessions at phone, laptop and wide (D-7453)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      // The card's own door: one stored value, read by GET and written by POST. A route registered after `openApp`'s
      // runs first (Playwright), so this answers the door and every other `/api` path falls through to the fixture.
      let stored: ClaudeRollTargets = CLAUDE_ROLL_TARGETS_DEFAULT;
      const posts: unknown[] = [];
      await ctx.route(`**${DOOR}`, async (r) => {
        const req = r.request();
        if (req.method() === 'POST') {
          const body = req.postDataJSON() as { targets?: unknown } | null;
          posts.push(body);
          if (!isClaudeRollTargets(body?.targets)) {
            return r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'bad-request' }) });
          }
          stored = body.targets;
        }
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          ok: true, targets: stored, default: CLAUDE_ROLL_TARGETS_DEFAULT, choices: CLAUDE_ROLL_TARGETS,
        }) });
      });
      try {
        await page.goto(server!.origin + '/settings/automation');
        const section = page.getByRole('region', { name: TITLE });
        const coordinators = section.getByRole('radio', { name: ROLL_IDLE_LABELS.coordinators });
        const off = section.getByRole('radio', { name: ROLL_IDLE_LABELS.off });
        // The card renders with its two choices, and the default (what a fresh store answers) is checked.
        await expect.poll(() => coordinators.isChecked(), { timeout: 20_000 }).toBe(true);
        expect(await section.getByRole('radio').count(), 'the card does not offer exactly two choices').toBe(2);
        expect(await off.isChecked()).toBe(false);
        expect(CLAUDE_ROLL_TARGETS_DEFAULT).toBe('coordinators');

        const m = await section.evaluate((el): Measured => {
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
            section: { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, box: box(el) },
            card: { scrollWidth: card.scrollWidth, clientWidth: card.clientWidth, box: box(card) },
            options: [...el.querySelectorAll('input[type="radio"]')].map((input) => {
              const label = input.closest('label');
              if (label === null) throw new Error('a choice has no label');
              return { label: label.textContent ?? '', box: box(label) };
            }),
          };
        });
        const shots = process.env.CCRC_SHOTS;
        if (shots) await section.screenshot({ path: path.join(shots, `roll-idle-${view.band}-${view.width}.png`) });

        expect(m.options.map((o) => o.label)).toEqual([ROLL_IDLE_LABELS.coordinators, ROLL_IDLE_LABELS.off]);
        // Nothing overflows sideways: the card, its section, the detail pane and the page.
        expect(m.card.scrollWidth, 'the card overflows sideways').toBeLessThanOrEqual(m.card.clientWidth);
        expect(m.section.scrollWidth, 'the section overflows sideways').toBeLessThanOrEqual(m.section.clientWidth);
        if (m.detail !== null) expect(m.detail.scrollWidth, 'the detail pane scrolls sideways').toBeLessThanOrEqual(m.detail.clientWidth);
        expect(m.pageScrollWidth, 'the page scrolls sideways').toBeLessThanOrEqual(m.pageClientWidth);
        expect(m.card.box.left, 'the card starts left of the viewport').toBeGreaterThanOrEqual(0);
        expect(m.card.box.right, 'the card runs past the viewport').toBeLessThanOrEqual(m.viewport);
        for (const o of m.options) {
          expect(o.box.left, `${o.label} starts left of its card`).toBeGreaterThanOrEqual(m.card.box.left - 0.5);
          expect(o.box.right, `${o.label} runs past its card`).toBeLessThanOrEqual(m.card.box.right + 0.5);
          expect(o.box.bottom - o.box.top, `${o.label} has no height`).toBeGreaterThan(0);
        }

        // Each choice is reachable and picks: Off by a tap or click, then Coordinators again from the keyboard.
        await off.click();
        await expect.poll(() => off.isChecked(), { timeout: 10_000 }).toBe(true);
        expect(await coordinators.isChecked()).toBe(false);
        expect(stored).toBe('off');
        await expect.poll(() => section.getByRole('group', { name: TITLE }).isDisabled(), { timeout: 10_000 }).toBe(false);
        await off.focus();
        await page.keyboard.press('ArrowUp');
        await expect.poll(() => coordinators.isChecked(), { timeout: 10_000 }).toBe(true);
        await expect.poll(() => stored, { timeout: 10_000 }).toBe('coordinators');
        expect(posts).toEqual([{ targets: 'off' }, { targets: 'coordinators' }]);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});
