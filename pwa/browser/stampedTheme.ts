// The palette a browser case asks for is the palette the page draws (desktop polish wave 188). Not a test file (no
// `*.browser.test.*` in its name). A case hands `openApp` a theme id and the app stamps it on `<html>` before the first
// paint; a value the app does not keep resolves to the system choice instead, which is light in a context that sets no
// colour scheme, so a case named for the dark palette measured the light one twice and nothing went red. `openApp`
// refuses such a value; this reads back what the page actually carries, so a case's title and its palette cannot part.
// Its light half is true in any context that sets no colour scheme, kept or not; the phosphor half is the one that proves
// the choice was kept, because a fall back to the system choice stamps light there.
import type { Page } from 'playwright-core';
import { expect } from 'vitest';
import { PHOSPHOR, SYSTEM } from '@ccrc/ui';

/** The theme `<html>` carries: its `data-theme`, or `PHOSPHOR` when it has none (PHOSPHOR is applied by removing the
 *  attribute, `applyTheme` in @ccrc/ui). */
export async function stampedTheme(page: Page): Promise<string> {
  return (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) ?? PHOSPHOR;
}

/** Assert that the page carries the palette `theme` names. `theme` is a concrete palette id: `SYSTEM` names no one
 *  palette (the colour scheme picks it), so it is refused here rather than compared. */
export async function expectStampedTheme(page: Page, theme: string): Promise<void> {
  if (theme === SYSTEM) throw new Error('expectStampedTheme: SYSTEM names no one palette; pass the palette id the case measures');
  expect(await stampedTheme(page), `the page carries the theme the case asked for (${theme})`).toBe(theme);
}
