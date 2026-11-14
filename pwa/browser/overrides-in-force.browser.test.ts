// D-8382 (#1442), in a real Chrome over the production build, at 360, 390, 1280 and 1920 in both skins. jsdom lays
// nothing out, so `test/overrides-section.test.tsx` and `test/fleet-host-banner.test.tsx` hold the words and the markup;
// this file holds what only an engine can say:
//   * Settings › Automation › Overrides in force, with three overrides standing and two unread: every line on screen,
//     whole, wrapped inside the card (never cut short, never past its edge), no control, nothing scrolling sideways;
//   * Settings › Security › Approvals, its longest line, the same;
//   * the unreachable banner while the reboot is not configured: Reboot is disabled, and both sentences sit inside the
//     viewport, wrapped, with nothing scrolling sideways.
//
// The app answers from a fixture (`browser/app.ts`): no server, no ccd. Run: `( cd pwa && CCRC_CHROME=<a Chrome or
// Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/overrides-in-force.browser.test.ts )`.
// `CCRC_SHOTS=<a directory>` keeps one picture per view.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { chromium, type Browser, type Locator } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { FLEET_REBOOT_NOT_CONFIGURED_TEXT, FLEET_REBOOT_REMEDY_TEXT } from '../../shared/api';
import { approvalsTopologyLine, type OverridesView } from '../../shared/overrides';
import { overrideSwitchNames, type OverrideSwitchName } from '../../shared/switches';
import { SETTINGS_CARDS } from '../src/fleet/settingsText';
import { overrideLines, overridesUnmeasuredLine } from '../src/fleet/overridesWords';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const VIEWS: readonly AppView[] = [360, 390, 1280, 1920].flatMap((width) => [
  { skin: REFINED, theme: PHOSPHOR, width }, { skin: INSTRUMENT, theme: 'light', width },
]);
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

/** Three overrides standing (a registry marker, a `~/.ccrc` file, the longest meaning), two unread. */
const SET: readonly OverrideSwitchName[] = ['child-reclaim-disabled', 'autocompact-disabled', 'graph-gate-off'];
const UNREAD: readonly OverrideSwitchName[] = ['ccrc-card-off', 'compact-card-off'];
const VIEW: OverridesView = {
  overrides: overrideSwitchNames.map((name) => ({
    name, state: SET.includes(name) ? 'set' : UNREAD.includes(name) ? 'unmeasurable' : 'clear',
  })),
  // The longest of the four lines.
  approvals: { boxes: 'one', marker: 'present', file: 'approvals-single-box' },
};
/** Every line the overrides card draws for that answer, from the card's own pure half, so no word is copied here. */
const OVERRIDE_LINES: readonly string[] = [
  ...overrideSwitchNames.filter((n) => SET.includes(n)).flatMap((n) => {
    const l = overrideLines(n);
    return [l.name, l.does, l.without, l.remedy];
  }),
  overridesUnmeasuredLine(UNREAD.length)!,
];
const APPROVALS_LINE = approvalsTopologyLine(VIEW.approvals);

const fixture = (health: unknown): AppFixture => ({
  api: {
    '/api/fleet/overrides': VIEW,
    '/api/fleet/health': health,
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
});
const CONNECTED = { mode: 'remote', connected: true, downSince: null, rebootConfigured: true };
const DOWN_UNCONFIGURED = { mode: 'remote', connected: false, downSince: Date.now() - 5 * 60_000, rebootConfigured: false };

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
interface Line { text: string; box: Box; scrollWidth: number; clientWidth: number; clipped: boolean }
interface Measured {
  viewport: number;
  pageScrollWidth: number;
  pageClientWidth: number;
  box: { scrollWidth: number; clientWidth: number; box: Box };
  lines: Line[];
}

/** The lines `wanted` names inside `el`, each one's box and whether it is set to cut short, and the page's width. */
const measure = (el: Locator, wanted: readonly string[]): Promise<Measured> => el.evaluate((root, want): Measured => {
  const box = (e: Element): Box => {
    const r = e.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  };
  const ps = [...root.querySelectorAll('p, span')].filter((p) => want.includes(p.textContent ?? ''));
  const seen = new Set<string>();
  return {
    viewport: window.innerWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
    pageClientWidth: document.documentElement.clientWidth,
    box: { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, box: box(root) },
    lines: ps.filter((p) => { const t = p.textContent ?? ''; if (seen.has(t)) return false; seen.add(t); return true; }).map((p) => {
      const cs = getComputedStyle(p);
      return {
        text: p.textContent ?? '', box: box(p), scrollWidth: p.scrollWidth, clientWidth: p.clientWidth,
        clipped: cs.whiteSpace === 'nowrap' || cs.textOverflow === 'ellipsis',
      };
    }),
  };
}, wanted);

function expectFits(m: Measured, wanted: readonly string[], what: string): void {
  expect(m.lines.map((l) => l.text).sort(), `a line is missing from ${what}`).toEqual([...wanted].sort());
  expect(m.pageScrollWidth, 'the page scrolls sideways').toBeLessThanOrEqual(m.pageClientWidth);
  expect(m.box.scrollWidth, `${what} overflows sideways`).toBeLessThanOrEqual(m.box.clientWidth);
  expect(m.box.box.right, `${what} runs past the viewport`).toBeLessThanOrEqual(m.viewport);
  for (const l of m.lines) {
    expect(l.clipped, `"${l.text}" is set to cut short rather than wrap`).toBe(false);
    expect(l.scrollWidth, `"${l.text}" overflows its line box`).toBeLessThanOrEqual(l.clientWidth);
    expect(l.box.left, `"${l.text}" starts left of ${what}`).toBeGreaterThanOrEqual(m.box.box.left - 0.5);
    expect(l.box.right, `"${l.text}" runs past ${what}`).toBeLessThanOrEqual(m.box.box.right + 0.5);
  }
}

describe('Settings › Automation › Overrides in force, at every width, in both skins (D-8382)', () => {
  it('CONTROL: three rows of four lines and the unread line', () => {
    expect(OVERRIDE_LINES).toHaveLength(13);
  });

  for (const view of VIEWS) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, fixture(CONNECTED));
      try {
        await page.goto(server!.origin + '/settings/automation');
        const section = page.getByRole('region', { name: SETTINGS_CARDS.automation.overrides.title });
        for (const line of OVERRIDE_LINES) {
          await expect.poll(() => section.getByText(line, { exact: true }).first().isVisible(), { timeout: 20_000 }).toBe(true);
        }
        for (const role of ['button', 'switch', 'checkbox', 'radio', 'textbox'] as const) {
          expect(await section.getByRole(role).count(), `the card offers a ${role}`).toBe(0);
        }
        const m = await measure(section, OVERRIDE_LINES);
        expectFits(m, OVERRIDE_LINES, 'the card');
        // A remedy is a long sentence: at phone width it wraps onto more than one line rather than running out.
        if (view.width <= 390) {
          const remedy = m.lines.find((l) => l.text.startsWith('To lift it,'))!;
          expect(remedy.box.bottom - remedy.box.top, 'a remedy did not wrap at phone width').toBeGreaterThan(30);
        }
        const shots = process.env.CCRC_SHOTS;
        if (shots) await section.screenshot({ path: path.join(shots, `overrides-${view.skin}-${view.width}.png`) });
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});

describe('Settings › Security › Approvals, at every width, in both skins (D-8382)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, fixture(CONNECTED));
      try {
        await page.goto(server!.origin + '/settings/security');
        const section = page.getByRole('region', { name: SETTINGS_CARDS.security.approvals.title });
        await expect.poll(() => section.getByText(APPROVALS_LINE, { exact: true }).isVisible(), { timeout: 20_000 }).toBe(true);
        expect(await section.getByRole('button').count(), 'the card offers a button').toBe(0);
        expectFits(await measure(section, [APPROVALS_LINE]), [APPROVALS_LINE], 'the card');
        const shots = process.env.CCRC_SHOTS;
        if (shots) await section.screenshot({ path: path.join(shots, `approvals-${view.skin}-${view.width}.png`) });
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});

describe('the unreachable banner while the reboot is not configured, at every width, in both skins (D-8382)', () => {
  const WORDS = [FLEET_REBOOT_NOT_CONFIGURED_TEXT, FLEET_REBOOT_REMEDY_TEXT];
  for (const view of VIEWS) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, fixture(DOWN_UNCONFIGURED));
      try {
        await page.goto(server!.origin + '/');
        const remedy = page.locator('[data-reboot="remedy"]').filter({ visible: true }).first();
        await expect.poll(() => remedy.isVisible(), { timeout: 20_000 }).toBe(true);
        const banner = remedy.locator('xpath=ancestor::*[@role="status" or @role="alert"][1]');
        const reboot = banner.getByRole('button', { name: 'Reboot' });
        expect(await reboot.isDisabled(), 'Reboot is enabled though the server says it is not configured').toBe(true);
        expectFits(await measure(banner, WORDS), WORDS, 'the banner');
        const shots = process.env.CCRC_SHOTS;
        if (shots) await page.screenshot({ path: path.join(shots, `reboot-unconfigured-${view.skin}-${view.width}.png`) });
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});
