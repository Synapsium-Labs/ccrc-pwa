// Settings › Automation › Browser tools (D-8121), in a real Chrome over the production build, at 360, 390, 1280 and 1920
// in both skins. `test/browser-tools.test.tsx` holds the card's words and readers in jsdom; this file holds what only an
// engine can say: the card draws the fleet node's default, the two server names and the count, nothing in it or on the
// page overflows sideways (the longest server name is 43 characters of mono text), and its door brings Stop leftovers
// into view.
//
// The app answers from a fixture (`browser/app.ts`): no server, no ccd. Run: `( cd pwa && CCRC_CHROME=<a Chrome or
// Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/browser-tools-card.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { BOX_SETTING_SPECS, BROWSER_MCP_SERVERS_DEFAULT, type BoxSettingName } from '../../shared/api';
import { BROWSER_TEXT } from '../src/fleet/browserMcpWords';
import { PANE_SCOPE_STOP_TEXT } from '../src/fleet/paneScopeStopWords';
import { fleetSession } from '../test/fleetFixture';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const VIEWS: readonly AppView[] = [360, 390, 1280, 1920].flatMap((width) => [
  { skin: REFINED, theme: PHOSPHOR, width }, { skin: INSTRUMENT, theme: 'light', width },
]);
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;
const MIN = 60_000;

/** Every shown setting `ok` at its default, the browser default `off`: the document `ccrc settings --json` writes. */
const settingsDoc = () => ({
  v: 2, at: Math.floor((Date.now() - 2 * MIN) / 1000), reader: 'timer',
  settings: (Object.entries(BOX_SETTING_SPECS) as [BoxSettingName, { cls: string }][])
    .filter(([, t]) => t.cls !== 'omit')
    .map(([key, t]) => (t.cls === 'is-set' ? { key, state: 'ok', from: 'default' }
      : t.cls === 'origin' ? { key, state: 'ok', value: 'default', from: 'default' }
        : { key, state: 'ok', value: key === 'CCRC_BROWSER_MCP_DEFAULT' ? 'off' : '1', from: 'default' })),
  deadline: { plainMs: 900000, minMs: 900000, maxMs: 900000 },
  backups: { state: 'ok', kept: 0, withData: 0, bytes: 0 },
  disk: { state: 'ok', availBytes: 19_327_352_832, sizeBytes: 161_061_273_600 },
});
const fleetNode = {
  nodeId: '0b6e1c62-7a4f-4d0e-9c1a-3f2d5e8a9b10', role: 'fleet', label: 'fleet', os: 'linux',
  current: { sha: 'bd2bf57a91c3e0d4f6a8b2c5e7d9f1a3b5c7e9d1', ref: 'main', builtAt: '2026-09-20T12:00:00Z', dirty: false, version: 'v0.0.7' },
  stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['update-gate'], agentOps: [], highestVersion: 'v0.0.7', previousVersion: null,
  floorRead: 'measured', previousRead: 'absent', measuredAt: Date.now() - MIN, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: 'v0.0.7', resolveDetail: null, request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  settings: { state: 'ok', doc: settingsDoc(), ageS: 120, stale: false },
};

const FIXTURE: AppFixture = {
  api: {
    '/api/updates': { catalogue: { lastOkAt: Date.now() - 4 * MIN, lastError: null }, releases: [], nodes: [fleetNode], intent: [] },
    '/api/accounts': { accounts: [], projected: null, roster: [] },
    '/api/projects': { roots: ['/w'], projects: [] },
    '/api/runs': { runs: [] },
    '/api/claims': [],
  },
  fleetFrames: [
    { type: 'fleet', sessions: [
      fleetSession({ id: 'demo-quiet-basin', presence: 'alive', browserMcp: 'on' }),
      fleetSession({ id: 'demo-still-pond', presence: 'alive', browserMcp: 'off' }),
      fleetSession({ id: 'demo-calm-mesa', presence: 'alive', browserMcp: 'off' }),
    ] },
    { type: 'runs', runs: [] },
    { type: 'coord', coord: { pause: 'clear', paneScopeStop: 'clear' } },
  ],
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

interface Box { left: number; right: number; top: number; bottom: number }

describe('Settings › Automation › Browser tools at every width, in both skins (D-8121)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const app = await openApp(browser!, view, FIXTURE);
      const { ctx, page, errors } = app;
      try {
        await page.goto(server!.origin + '/settings/automation');
        const section = page.getByRole('region', { name: 'Browser tools' });
        await expect.poll(() => section.getByText(BROWSER_TEXT.defaultOff).isVisible(), { timeout: 20_000 }).toBe(true);
        for (const n of BROWSER_MCP_SERVERS_DEFAULT.split(',')) expect(await section.getByText(n, { exact: true }).isVisible(), n).toBe(true);
        await expect.poll(() => section.getByText('1 of 3 running sessions uses a browser.').isVisible(), { timeout: 10_000 }).toBe(true);

        const m = await section.evaluate((el) => {
          const box = (e: Element): Box => {
            const r = e.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
          };
          const card = el.querySelector(':scope > div:last-child')!;
          const detail = document.querySelector('.shell-detail');
          return {
            viewport: window.innerWidth,
            pageScrollWidth: document.documentElement.scrollWidth, pageClientWidth: document.documentElement.clientWidth,
            detail: detail === null ? null : { scrollWidth: detail.scrollWidth, clientWidth: detail.clientWidth },
            section: { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth },
            card: { scrollWidth: card.scrollWidth, clientWidth: card.clientWidth, box: box(card) },
            texts: [...card.querySelectorAll('p, dt, dd, button')].map((e) => ({ text: e.textContent ?? '', box: box(e) })),
          };
        });
        expect(m.card.scrollWidth, 'the card overflows sideways').toBeLessThanOrEqual(m.card.clientWidth);
        expect(m.section.scrollWidth, 'the section overflows sideways').toBeLessThanOrEqual(m.section.clientWidth);
        if (m.detail !== null) expect(m.detail.scrollWidth, 'the detail pane scrolls sideways').toBeLessThanOrEqual(m.detail.clientWidth);
        expect(m.pageScrollWidth, 'the page scrolls sideways').toBeLessThanOrEqual(m.pageClientWidth);
        expect(m.card.box.left).toBeGreaterThanOrEqual(0);
        expect(m.card.box.right, 'the card runs past the viewport').toBeLessThanOrEqual(m.viewport);
        for (const t of m.texts) {
          expect(t.box.left, `"${t.text}" starts left of its card`).toBeGreaterThanOrEqual(m.card.box.left - 0.5);
          expect(t.box.right, `"${t.text}" runs past its card`).toBeLessThanOrEqual(m.card.box.right + 0.5);
        }

        // The door brings Stop leftovers' card into view.
        await section.getByRole('button', { name: BROWSER_TEXT.stopLeftovers }).click();
        const stop = page.getByRole('region', { name: PANE_SCOPE_STOP_TEXT.title });
        await expect.poll(async () => {
          const b = await stop.boundingBox();
          const h = page.viewportSize()?.height ?? 0;
          return b !== null && b.y < h && b.y + b.height > 0;
        }, { timeout: 10_000 }).toBe(true);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});
