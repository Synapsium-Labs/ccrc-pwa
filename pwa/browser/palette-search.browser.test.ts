// The top search finds sessions (D-6714, plan 2026-10-22-desktop-polish Task T5a), in a real Chrome over the production
// build: in Refined and Instrument at 390, 1280 and 1920, Ctrl+K opens the palette, a project name lists that project's
// sessions after the commands with the coordinator first, each option named exactly, Enter opens the session, and
// nothing scrolls sideways. And the palette's focus restore (T5a carries R41): at 390 on the fleet view the phone swap
// hides <main>, so a close hands focus to the fleet column's landmark, never the body.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts --maxWorkers=2 browser/palette-search.browser.test.ts )`.
//
// Chrome comes from `resolveChrome()` in `beforeAll`, which THROWS when neither `CCRC_CHROME` nor
// `/usr/bin/google-chrome` is an executable file: a box without Chrome gives a red leg, never a skipped one.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { fleetSession } from '../test/fleetFixture';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type DistServer } from './app';

const FIRST = fleetSession({
  id: 'project-a-one', project: 'project-a', workdir: '/w/project-a', name: 'first', workspace: 'ws-a', bucket: 'attention',
  statusUpdatedAt: 3,
});
const LEAD = fleetSession({
  id: 'project-a-lead', project: 'project-a', workdir: '/w/project-a', name: 'lead', role: 'coordinator', bucket: 'idle',
  statusUpdatedAt: 2,
});
// A custom title wins the session's label ('Release notes, project-b'), so its underlying name is distinctive.
const OTHER = fleetSession({
  id: 'project-b-one', project: 'project-b', workdir: '/w/project-b', name: 'other-name', title: 'Release notes', bucket: 'idle',
});

const FIXTURE: AppFixture = {
  api: { '/api/projects': { roots: ['/w'], projects: [
    { name: 'project-a', workdir: '/w/project-a' }, { name: 'project-b', workdir: '/w/project-b' },
  ] } },
  fleetFrames: [{ type: 'fleet', sessions: [FIRST, LEAD, OTHER] }],
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

async function openFleet(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(server!.origin + '/');
  await page.locator('main#content').waitFor({ state: 'attached', timeout: 20_000 });
  // The fleet frame has landed when the worker's row is drawn (Needs you; Instrument folds its Idle group, the lead's).
  await page.getByText('first', { exact: true }).first().waitFor({ state: 'attached', timeout: 20_000 });
}

const sideways = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

describe('the top search lists a project\'s sessions after the commands, the coordinator first (D-6714)', () => {
  for (const skin of [REFINED, INSTRUMENT]) for (const width of [390, 1280, 1920]) {
    it(`${skin} at ${width}`, async () => {
      const { ctx, page, errors } = await openApp(browser!, { skin, theme: PHOSPHOR, width }, FIXTURE);
      try {
        await openFleet(page);
        await page.keyboard.press('Control+k');
        const input = page.getByRole('combobox', { name: 'Command palette' });
        await input.waitFor({ timeout: 10_000 });
        await input.fill('project-a');
        const lead = page.getByRole('option', { name: 'lead, coordinator, project-a', exact: true });
        const first = page.getByRole('option', { name: 'first, project-a', exact: true });
        await lead.waitFor({ timeout: 5_000 });
        const names = await page.getByRole('option').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
        // Every option before the sessions is a command (no aria-label); the two sessions follow, coordinator first.
        const firstSession = names.findIndex((n) => n !== null);
        expect(names.slice(firstSession)).toEqual(['lead, coordinator, project-a', 'first, project-a']);
        expect(await first.count()).toBe(1);
        expect(await sideways(page), 'nothing scrolls sideways').toBe(false);
        // No command matches a project name, so the coordinator is the first option and Enter opens it.
        expect(firstSession).toBe(0);
        await page.keyboard.press('Enter');
        await page.waitForURL(new RegExp(`/s/${encodeURIComponent(LEAD.id)}$`), { timeout: 10_000 });
        // The palette closes (its exit animation runs first, so wait for it to go).
        await input.waitFor({ state: 'detached', timeout: 5_000 });
        expect(await sideways(page)).toBe(false);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});

describe('a custom title hides the name: the top search finds the session by either (R64)', () => {
  for (const skin of [REFINED, INSTRUMENT]) for (const width of [390, 1280]) {
    it(`${skin} at ${width}`, async () => {
      const { ctx, page, errors } = await openApp(browser!, { skin, theme: PHOSPHOR, width }, FIXTURE);
      try {
        await openFleet(page);
        await page.keyboard.press('Control+k');
        const input = page.getByRole('combobox', { name: 'Command palette' });
        await input.waitFor({ timeout: 10_000 });
        const shown = page.getByRole('option', { name: 'Release notes, project-b', exact: true });
        const sessionNames = (): Promise<string[]> => page.getByRole('option').evaluateAll(
          (els) => els.map((e) => e.getAttribute('aria-label')).filter((n): n is string => n !== null));
        // By the hidden name.
        await input.fill('other-name');
        await shown.waitFor({ timeout: 5_000 });
        expect(await shown.count()).toBe(1);
        expect(await sessionNames(), 'the hidden name finds the one session, shown by its title').toEqual(['Release notes, project-b']);
        // By the shown title.
        await input.fill('Release notes');
        await shown.waitFor({ timeout: 5_000 });
        expect(await shown.count()).toBe(1);
        expect(await sessionNames(), 'the shown title finds the same session').toEqual(['Release notes, project-b']);
        // Enter on the hidden name opens it.
        await input.fill('other-name');
        await shown.waitFor({ timeout: 5_000 });
        await page.keyboard.press('Enter');
        await page.waitForURL(/\/s\/project-b-one$/, { timeout: 10_000 });
        await input.waitFor({ state: 'detached', timeout: 5_000 });
        expect(await sideways(page), 'nothing scrolls sideways').toBe(false);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});

describe("a close hands focus to the landmark on screen, never the body (T5a carries R41)", () => {
  for (const skin of [REFINED, INSTRUMENT]) {
    it(`${skin} at 390 on the fleet view: the fleet column's landmark`, async () => {
      const { ctx, page } = await openApp(browser!, { skin, theme: PHOSPHOR, width: 390 }, FIXTURE);
      try {
        await openFleet(page);
        expect(await page.locator('main#content').isVisible(), 'the phone swap hides main on the fleet view').toBe(false);
        await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); });
        await page.keyboard.press('Control+k');
        await page.getByRole('combobox').waitFor({ timeout: 10_000 });
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => document.querySelector('[role="combobox"]') === null, undefined, { timeout: 5_000 });
        await page.waitForFunction(() => document.activeElement !== document.body, undefined, { timeout: 5_000 });
        expect(await page.evaluate(() => document.activeElement?.id)).toBe('fleet');
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});
