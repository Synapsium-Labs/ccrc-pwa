// Settings › Integrations (D-8932), in a real Chrome over the production build, at a phone, a laptop
// and a wide screen, in both skins and both themes. `test/settings-integrations.test.tsx` holds the section's behaviour in
// jsdom; this file holds what only an engine can say:
//   * the page draws its five cards (Linear, Project linking, GitHub, Docs folders, Docs settings) in order, and nothing scrolls sideways;
//   * the read-only GitHub card's lines wrap inside the card, with no text cut short and no control in it;
//   * the section's row on the Settings index is whole inside the index, at least a tap tall, and opens the page;
//   * an old link to Security for Linear lands on Integrations: Security's pointer is drawn, wraps, and its link opens it.
//
// The app answers from a fixture (`browser/app.ts`): no server, no ccd. Run: `( cd pwa && CCRC_CHROME=<a Chrome or
// Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/settings-integrations.browser.test.ts )`.
// `CCRC_SHOTS=<a directory>` keeps one picture of the page per view.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { GITHUB_TEXT } from '../src/fleet/githubWords';
import { SECURITY_MOVED_TEXT, SETTINGS_CARDS } from '../src/fleet/settingsText';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const THEMES = [PHOSPHOR, 'light'];
const SKINS = [REFINED, INSTRUMENT];
const WIDTHS = [360, 1280, 1920];
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;
const NOW = Date.now();

const linking = (measured: unknown, teamKey: string | null) =>
  ({ teamKey, override: null, mode: 'private', initiatives: 'on', linearOwner: null, ownsTeam: false, measured });
const FIXTURE: AppFixture = {
  api: {
    '/api/hierarchy': { ok: true, coordinators: [{ id: 'cc-coord-a', live: true }], projects: [] },
    '/api/linear/workspaces': { ok: true, store: 'ok', legacy: null, workspaces: [] },
    '/api/accounts': { accounts: [], projected: null, roster: [] },
    '/api/docs/settings': { ok: true, settings: { rules: [], defaultBranches: {} } },
    '/api/feed': { events: [] },
    '/api/projects': {
      roots: ['/w'],
      projects: [
        { name: 'project-a', workdir: '/w/project-a', linking: linking({ state: 'measured', visibility: 'private', slug: 'owner/repo', template: 'present', at: NOW - 3 * 3_600_000 }, 'AAA') },
        // The newest reading that speaks to the sign-in is a refusal: the card's longest line, in amber.
        { name: 'project-b', workdir: '/w/project-b', linking: linking({ state: 'failed', reason: 'unauthenticated', at: NOW - 600_000 }, null) },
      ],
    },
  },
  fleetFrames: [{ type: 'fleet', sessions: [] }, { type: 'coord', coord: { pause: 'clear' } }],
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

/** One card's containment, measured in the page. */
const contained = (el: Element) => {
  const r = el.getBoundingClientRect();
  return {
    left: r.left, right: r.right, width: r.width, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
    viewport: window.innerWidth, pageScroll: document.documentElement.scrollWidth, pageClient: document.documentElement.clientWidth,
    ellipsis: [...el.querySelectorAll('*')].filter((e) => getComputedStyle(e).textOverflow === 'ellipsis').length,
    clipped: [...el.querySelectorAll('*')]
      .filter((e) => e.tagName !== 'SELECT' && e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0)
      .map((e) => e.tagName.toLowerCase() + '.' + (e.getAttribute('class') ?? '')),
    lines: [...el.querySelectorAll('p')].map((p) => { const b = p.getBoundingClientRect(); return { left: b.left, right: b.right, height: b.height }; }),
    controls: el.querySelectorAll('button, input, select, textarea, a').length,
  };
};

describe('Settings › Integrations, per width, skin and theme (D-8932)', () => {
  for (const width of WIDTHS) {
    it(`the page at ${width}px: five cards in order, the GitHub card read-only and whole, nothing scrolls sideways`, async () => {
      for (const skin of SKINS) for (const theme of THEMES) {
        const view: AppView = { skin, theme, width };
        const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
        try {
          const at = named(view);
          await page.goto(server!.origin + '/settings/integrations');
          const github = page.getByRole('region', { name: SETTINGS_CARDS.integrations.github.title });
          await github.locator('[data-github-state="refused"]').waitFor({ timeout: 30_000 });
          // Scoped to the section's page: at a desk the fleet column beside it has headings of its own.
          const settings = page.locator('.settings-page');
          expect(await settings.getByRole('heading', { level: 2 }).allTextContents(), `${at}: the page's heading`).toEqual(['Integrations']);
          expect(await settings.getByRole('heading', { level: 3 }).allTextContents(), `${at}: the cards, in order`).toEqual(['Linear', 'Project linking', 'GitHub', 'Docs folders', 'Docs settings']);
          const docs = page.getByRole('region', { name: 'Docs settings' });
          await docs.getByRole('button', { name: 'Save Docs settings' }).waitFor({ timeout: 30_000 });
          const shots = process.env.CCRC_SHOTS;
          if (shots) await page.screenshot({ path: path.join(shots, `integrations-${skin}-${theme}-${width}.png`), fullPage: true });

          expect(await github.getByText(GITHUB_TEXT.uses).count(), `${at}: what ccrc uses today`).toBe(1);
          expect(await github.getByText(GITHUB_TEXT.coming).count(), `${at}: a stored key is coming`).toBe(1);
          const m = await github.evaluate(contained);
          expect(m.controls, `${at}: the card is read-only`).toBe(0);
          expect(m.scrollWidth, `${at}: the GitHub card overflows sideways`).toBeLessThanOrEqual(m.clientWidth);
          expect(m.ellipsis, `${at}: text is cut short`).toBe(0);
          expect(m.clipped, `${at}: an element is wider than its box`).toEqual([]);
          expect(m.left, `${at}: the card starts left of the viewport`).toBeGreaterThanOrEqual(0);
          expect(m.right, `${at}: the card runs past the viewport`).toBeLessThanOrEqual(m.viewport);
          expect(m.lines.length, `${at}: the purpose line and the card's three lines`).toBeGreaterThanOrEqual(4);
          for (const l of m.lines) {
            expect(l.right, `${at}: a line runs past the card`).toBeLessThanOrEqual(m.right + 0.5);
            expect(l.left, `${at}: a line starts left of the card`).toBeGreaterThanOrEqual(m.left - 0.5);
            expect(l.height, `${at}: a line has no height`).toBeGreaterThan(0);
          }
          expect(m.pageScroll, `${at}: the page scrolls sideways`).toBeLessThanOrEqual(m.pageClient);
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }
    }, 240_000);
  }

  for (const width of [360, 1280]) {
    it(`at ${width}px the index row opens the page, and Security's pointer lands an old link on it`, async () => {
      for (const skin of SKINS) {
        const view: AppView = { skin, theme: 'light', width };
        const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
        try {
          const at = named(view);
          await page.goto(server!.origin + '/settings');
          const row = page.locator('a.settings-index-row[data-section="integrations"]');
          await row.waitFor({ timeout: 30_000 });
          const box = await row.evaluate((a) => {
            const r = a.getBoundingClientRect();
            const nav = a.closest('nav')!.getBoundingClientRect();
            return { height: r.height, left: r.left, right: r.right, navLeft: nav.left, navRight: nav.right, scroll: a.scrollWidth, client: a.clientWidth,
              pageScroll: document.documentElement.scrollWidth, pageClient: document.documentElement.clientWidth };
          });
          expect(box.height, `${at}: the row is under a tap tall`).toBeGreaterThanOrEqual(43.5);
          expect(box.left, `${at}: the row starts left of the index`).toBeGreaterThanOrEqual(box.navLeft - 0.5);
          expect(box.right, `${at}: the row runs past the index`).toBeLessThanOrEqual(box.navRight + 0.5);
          expect(box.scroll, `${at}: the row's words overflow it`).toBeLessThanOrEqual(box.client + 1);
          expect(box.pageScroll, `${at}: the index scrolls sideways`).toBeLessThanOrEqual(box.pageClient);
          await row.click();
          await page.getByRole('heading', { level: 2, name: 'Integrations' }).waitFor({ timeout: 30_000 });
          expect(new URL(page.url()).pathname).toBe('/settings/integrations');

          // An item written before the move names /settings/security: the place the cards held there says where they went.
          await page.goto(server!.origin + '/settings/security');
          const moved = page.locator('[data-security-moved]');
          await moved.waitFor({ timeout: 30_000 });
          expect(await moved.textContent()).toContain(SECURITY_MOVED_TEXT.note);
          const m = await moved.evaluate((p) => { const r = p.getBoundingClientRect(); return { right: r.right, left: r.left, viewport: window.innerWidth, scroll: p.scrollWidth, client: p.clientWidth }; });
          expect(m.right, `${at}: the pointer runs past the viewport`).toBeLessThanOrEqual(m.viewport);
          expect(m.scroll, `${at}: the pointer overflows`).toBeLessThanOrEqual(m.client + 1);
          expect(await page.locator('.settings-page').getByRole('heading', { level: 3, name: 'Linear' }).count(), `${at}: Security holds no Linear card`).toBe(0);
          await moved.getByRole('link', { name: SECURITY_MOVED_TEXT.link }).click();
          await page.getByRole('heading', { level: 3, name: 'Project linking' }).waitFor({ timeout: 30_000 });
          expect(new URL(page.url()).pathname).toBe('/settings/integrations');
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }
    }, 120_000);
  }
});
