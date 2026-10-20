// The main landmark draws no ring when script focuses it (D-5679), in a real Chrome over the production build.
//
// `#content` (`.shell-detail`, `tabIndex={-1}`) takes focus from script only: the skip link, and the command palette
// handing focus back after a command took its opener away. Chrome marks a script focus that follows a keyboard action
// as `:focus-visible`, and base.css's page-wide `:focus-visible` outline would draw a 2px accent line along the whole
// pane. jsdom computes no cascade, so this file holds what Chrome computes, at 360, 390, 1280 and 1920 in both skins
// and both palettes: after Ctrl+K → Go to Runs from the body, and after the skip link on /runs, `#content` has the focus and
// its computed outline style is `none`.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/content-focus-ring.browser.test.tsx )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';

const VIEWS: AppView[] = [REFINED, INSTRUMENT].flatMap((skin) => [PHOSPHOR, 'light'].flatMap((theme) =>
  [360, 390, 1280, 1920].map((width) => ({ skin, theme, width }))));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;
const FIXTURE: AppFixture = {
  api: { '/api/projects': { roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a' }] } },
  fleetFrames: [{ type: 'fleet', sessions: [] }],
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

/** `#content`: whether it holds the focus, and its computed outline style. */
const content = (page: Page) => page.evaluate(() => {
  const m = document.getElementById('content') as HTMLElement;
  return { focused: document.activeElement === m, outline: getComputedStyle(m).outlineStyle };
});

async function paletteToRuns(page: Page): Promise<void> {
  await page.keyboard.press('Control+k');
  const input = page.getByRole('combobox');
  await input.waitFor({ timeout: 10_000 });
  await input.fill('Go to Runs');
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/runs$/, { timeout: 10_000 });
}

async function skipLink(page: Page): Promise<void> {
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
}

describe('#content draws no ring when script focuses it after a key', () => {
  // The skip link starts on /runs: on a phone the fleet route hides the detail pane (the swap), so there is no
  // landmark on screen to skip to.
  for (const [what, start, act] of [['Ctrl+K → Go to Runs', '/', paletteToRuns], ['the skip link', '/runs', skipLink]] as const) {
    for (const view of VIEWS) {
      it(`${what}: ${named(view)}`, async () => {
        const { ctx, page } = await openApp(browser!, view, FIXTURE);
        try {
          await page.emulateMedia({ reducedMotion: 'reduce' });
          await page.goto(server!.origin + start);
          await page.locator('main#content').waitFor({ state: 'attached', timeout: 20_000 });
          await act(page);
          await page.waitForFunction(() => document.activeElement?.id === 'content', undefined, { timeout: 5_000 });
          expect(await content(page)).toEqual({ focused: true, outline: 'none' });
        } finally {
          await ctx.close();
        }
      }, 60_000);
    }
  }
});
