// The Sheet's focused panel draws no ring (D-5931), in a real Chrome over the production build.
//
// The Sheet focuses its panel on open (`tabIndex={-1}`, `useSheetFocus`). Chrome marks a script focus that follows a
// keyboard action as `:focus-visible`, and `pwa/src/styles/base.css`'s page-wide `:focus-visible` outline is
// unlayered, so it beats a layered `outline-none` utility: every keyboard-opened sheet painted a 2px accent ring around
// the whole panel. jsdom computes no cascade, so this file holds what Chrome computes: the `?` shortcuts sheet and the
// New session sheet (Enter on its button), at 360, 390, 1280 and 1920 in both skins and both palettes — the panel has
// the focus, and its computed outline style is `none`.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/sheet-focus-ring.browser.test.tsx )`.
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

/** The open panel: whether it holds the focus, matches `:focus-visible`, and its computed outline style. */
const panel = (page: Page) => page.evaluate(() => {
  const p = document.querySelector('.sheet-panel[data-state="open"]') as HTMLElement;
  return { focused: document.activeElement === p, outline: getComputedStyle(p).outlineStyle };
});

async function openShortcuts(page: Page): Promise<void> {
  await page.keyboard.press('?');
}

async function openNewSession(page: Page): Promise<void> {
  const fab = page.locator('button.fab[aria-label="New session"]');
  await fab.waitFor({ timeout: 20_000 });
  await fab.focus();
  await page.keyboard.press('Enter');
}

describe('a keyboard-opened Sheet focuses its panel and draws no ring on it', () => {
  for (const [what, open] of [['the ? shortcuts sheet', openShortcuts], ['the New session sheet', openNewSession]] as const) {
    for (const view of VIEWS) {
      it(`${what}: ${named(view)}`, async () => {
        const { ctx, page } = await openApp(browser!, view, FIXTURE);
        try {
          await page.emulateMedia({ reducedMotion: 'reduce' });
          await page.goto(server!.origin + '/');
          await page.locator('main, [data-page-scaffold]').first().waitFor({ timeout: 20_000 });
          await open(page);
          await page.locator('.sheet-panel[data-state="open"]').waitFor({ timeout: 10_000 });
          await page.waitForFunction(() => document.activeElement?.classList.contains('sheet-panel') === true, undefined, { timeout: 5_000 });
          expect(await panel(page)).toEqual({ focused: true, outline: 'none' });
        } finally {
          await ctx.close();
        }
      }, 60_000);
    }
  }
});
